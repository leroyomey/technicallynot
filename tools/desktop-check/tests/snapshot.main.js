// Technically Not tools · desktop-check/tests/snapshot.main.js — Main-process side of the snapshot
// test: opens the real overlay (snapshot-service start), drags a fixed rectangle into it with real
// input events (or presses Esc), and reports the clipboard image size, the expected size at the
// display's scale factor, and any image file written meanwhile. `markup` turns markup on with M
// (remembered by the next overlay), draws a block-out, an arrow, a box (undone), a numbered marker,
// a text, a blur and a highlighter line (erased) with real input, moves the arrow and stretches the
// block-out with the Move tool, resizes the selection by two grips, copies with Enter and reads
// pixels back; `whole` copies the whole screen with Enter; `clip` presses C, drags an area, lets
// the recorder run about 2 s behind the camera frame, stops it and reports the saved video, frames
// and clipboard line (the files are deleted again). The user's clipboard (text or image) is saved
// first and restored by `restore`.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clipboard, ClipboardItem, nativeImage } = require('electron');
const snapshot = require('../../../desktop/snapshot-service');

const IMAGE = /\.(png|jpe?g|bmp|gif|webp|tiff?)$/i;

// Image files under a folder (a few levels deep) with their modified times.
function images(dir, depth, into = new Map()) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return into;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) images(p, depth - 1, into);
    else if (e.isFile() && IMAGE.test(e.name)) {
      try {
        into.set(p, fs.statSync(p).mtimeMs);
      } catch {}
    }
  }
  return into;
}

// The clipboard's image (Electron's async clipboard), or null.
async function clipImage() {
  for (const item of await clipboard.read()) {
    const type = item.types.find(t => /^image\/png$/i.test(t));
    if (!type) continue;
    const img = nativeImage.createFromBuffer(
      Buffer.from(await (await item.getType(type)).arrayBuffer())
    );
    if (!img.isEmpty()) return img;
  }
  return null;
}

module.exports = (_win, profile) => {
  // The user's clipboard, copied type by type so `restore` can put it back.
  const saved = (async () => {
    const items = [];
    for (const item of await clipboard.read().catch(() => [])) {
      const data = {};
      for (const t of item.types) {
        try {
          data[t] = await item.getType(t);
        } catch {}
      }
      if (Object.keys(data).length) items.push(data);
    }
    return items;
  })();
  const until = async (fn, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await new Promise(r => setTimeout(r, 30));
    }
    return null;
  };
  const scan = () => new Map([...images(profile, 6), ...images(os.tmpdir(), 1)]);

  async function open() {
    const done = snapshot.start();
    const overlay = await until(() => snapshot.ready() && snapshot.overlay());
    if (!overlay) throw new Error('overlay never showed the frozen screen');
    return { done, overlay };
  }
  return {
    state: () => snapshot.state(),
    // Drag from (fx, fy) over (fw, fh) — fractions of the display — and return what landed on the
    // clipboard.
    drag: async (fx, fy, fw, fh) => {
      await clipboard.writeText('before snapshot');
      const before = scan(),
        started = Date.now();
      const { done, overlay } = await open();
      const [cw, ch] = overlay.getContentSize(),
        bounds = overlay.getBounds();
      const display = require('electron').screen.getDisplayMatching(bounds);
      const x0 = Math.round(fx * cw),
        y0 = Math.round(fy * ch),
        x1 = Math.round((fx + fw) * cw),
        y1 = Math.round((fy + fh) * ch);
      const wc = overlay.webContents,
        send = e => wc.sendInputEvent(e),
        pause = () => new Promise(r => setTimeout(r, 20));
      send({ type: 'mouseMove', x: x0, y: y0 });
      await pause();
      send({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
      await pause();
      for (let i = 1; i <= 5; i++) {
        send({
          type: 'mouseMove',
          x: Math.round(x0 + ((x1 - x0) * i) / 5),
          y: Math.round(y0 + ((y1 - y0) * i) / 5),
          modifiers: ['leftButtonDown'],
        });
        await pause();
      }
      send({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
      const result = await Promise.race([
        done,
        new Promise(r => setTimeout(() => r({ timeout: true }), 5000)),
      ]);
      const img = await clipImage(),
        after = scan();
      const written = [...after]
        .filter(([p, t]) => (!before.has(p) || before.get(p) !== t) && t >= started - 1000)
        .map(([p]) => p);
      return {
        result,
        overlayClosed: overlay.isDestroyed(),
        size: img ? img.getSize() : null,
        text: await clipboard.readText(),
        expected: {
          width: Math.round((x1 - x0) * display.scaleFactor),
          height: Math.round((y1 - y0) * display.scaleFactor),
        },
        scale: display.scaleFactor,
        display: display.size,
        content: [cw, ch],
        written,
      };
    },
    // Copy enlarged: off by default, L turns it on, the next overlay remembers it and a small drag
    // is copied in whole multiples of its pixels.
    large: async (fx, fy, fw, fh) => {
      const pause = (ms = 20) => new Promise(r => setTimeout(r, ms)),
        finished = done =>
          Promise.race([done, new Promise(r => setTimeout(() => r({ timeout: true }), 8000))]);
      const first = await open(),
        wc1 = first.overlay.webContents;
      const startedOff = await wc1.executeJavaScript('large');
      wc1.sendInputEvent({ type: 'keyDown', keyCode: 'L' });
      wc1.sendInputEvent({ type: 'keyUp', keyCode: 'L' });
      await pause(40);
      const on = await wc1.executeJavaScript('large'),
        hint = await wc1.executeJavaScript('hint.textContent');
      wc1.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await finished(first.done);

      const { done, overlay } = await open();
      const wc = overlay.webContents,
        send = e => wc.sendInputEvent(e);
      const remembered = await wc.executeJavaScript('large');

      // the next overlay copies at exact size again
      await wc.executeJavaScript('localStorage.setItem("tnai.snapshot.large.v1", "0")');
      const [cw, ch] = overlay.getContentSize(),
        display = require('electron').screen.getDisplayMatching(overlay.getBounds());
      const x0 = Math.round(fx * cw),
        y0 = Math.round(fy * ch),
        x1 = Math.round((fx + fw) * cw),
        y1 = Math.round((fy + fh) * ch);
      send({ type: 'mouseMove', x: x0, y: y0 });
      await pause();
      send({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
      await pause();
      for (let i = 1; i <= 5; i++) {
        send({
          type: 'mouseMove',
          x: Math.round(x0 + ((x1 - x0) * i) / 5),
          y: Math.round(y0 + ((y1 - y0) * i) / 5),
          modifiers: ['leftButtonDown'],
        });
        await pause();
      }
      send({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
      const result = await finished(done);
      const img = await clipImage(),
        size = img ? img.getSize() : null,
        bitmap = img ? img.toBitmap() : null,
        f = result.enlarged || 0;

      // Every pixel of the first block equals its first pixel: whole pixels, not smoothed.
      let whole = !!bitmap && f >= 2;
      for (let y = 0; whole && y < f; y++)
        for (let x = 0; x < f; x++) {
          const i = (y * size.width + x) * 4;
          if (bitmap[i] !== bitmap[0] || bitmap[i + 1] !== bitmap[1] || bitmap[i + 2] !== bitmap[2])
            whole = false;
        }
      return {
        startedOff,
        on,
        hint,
        remembered,
        result,
        size,
        whole,
        selection: {
          width: Math.round((x1 - x0) * display.scaleFactor),
          height: Math.round((y1 - y0) * display.scaleFactor),
        },
      };
    },
    // Markup: M is remembered by the next overlay; a drag then stays open with the toolbar; marks
    // are drawn with real input; Enter copies the marked-up picture.
    markup: async (fx, fy, fw, fh) => {
      await clipboard.writeText('before markup');
      const pause = (ms = 20) => new Promise(r => setTimeout(r, ms)),
        finished = done =>
          Promise.race([done, new Promise(r => setTimeout(() => r({ timeout: true }), 8000))]);
      const key = async (wc, keyCode, modifiers = []) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await pause(40);
      };
      const first = await open();
      const startedOff = await first.overlay.webContents.executeJavaScript('markup');
      await key(first.overlay.webContents, 'M');
      const on = await first.overlay.webContents.executeJavaScript('markup'),
        hint = await first.overlay.webContents.executeJavaScript('hint.textContent');
      first.overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await finished(first.done);

      const { done, overlay } = await open();
      const wc = overlay.webContents,
        js = code => wc.executeJavaScript(code),
        send = e => wc.sendInputEvent(e);
      const remembered = await js('markup');
      const [cw, ch] = overlay.getContentSize(),
        display = require('electron').screen.getDisplayMatching(overlay.getBounds());
      const x0 = Math.round(fx * cw),
        y0 = Math.round(fy * ch),
        w = Math.round(fw * cw),
        h = Math.round(fh * ch);
      const drag = async (ax, ay, bx, by) => {
        send({ type: 'mouseMove', x: ax, y: ay });
        await pause();
        send({ type: 'mouseDown', x: ax, y: ay, button: 'left', clickCount: 1 });
        await pause();
        for (let i = 1; i <= 5; i++) {
          send({
            type: 'mouseMove',
            x: Math.round(ax + ((bx - ax) * i) / 5),
            y: Math.round(ay + ((by - ay) * i) / 5),
            modifiers: ['leftButtonDown'],
          });
          await pause();
        }
        send({ type: 'mouseUp', x: bx, y: by, button: 'left', clickCount: 1 });
        await pause(40);
      };
      const click = async (x, y) => {
        send({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        await pause();
        send({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await pause(60);
      };

      // a point of the selection, in overlay px
      const inside = (px, py) => [Math.round(x0 + w * px), Math.round(y0 + h * py)];
      await drag(x0, y0, x0 + w, y0 + h);
      let opened = false;
      for (let i = 0; i < 120 && !opened; i++) {
        opened = await js('phase === "markup"').catch(() => false);
        if (!opened) await pause(50);
      }
      const toolbar = await js(
        '(() => { const b = bar.getBoundingClientRect(); return { shown: getComputedStyle(bar).display, left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: innerWidth, vh: innerHeight, buttons: bar.querySelectorAll("button").length }; })()'
      );
      const counts = [],
        count = async () => counts.push(await js('ops.length'));
      await key(wc, 'K');
      await drag(...inside(0.1, 0.1), ...inside(0.45, 0.5));
      await count(); // block out
      await key(wc, 'A');
      await drag(...inside(0.55, 0.8), ...inside(0.95, 0.8));
      await count(); // arrow
      await key(wc, 'R');
      await drag(...inside(0.6, 0.1), ...inside(0.9, 0.4));
      await count(); // box …
      await key(wc, 'Z', ['control']);
      await count(); // … undone
      await key(wc, 'N');
      await click(...inside(0.75, 0.25));
      await count(); // numbered marker
      await key(wc, 'T');
      await click(...inside(0.55, 0.55));
      const typingIn = await js('document.activeElement === note');
      for (const c of ['H', 'i']) {
        send({ type: 'char', keyCode: c });
        await pause();
      }

      // letters typed into the text box must not switch tools
      const toolWhileTyping = await js('tool');
      await key(wc, 'Enter');
      await count();
      const text = await js('ops.length && ops[ops.length - 1].text');
      await key(wc, 'B');
      await drag(...inside(0.1, 0.6), ...inside(0.45, 0.95));
      await count(); // blur
      await key(wc, 'H');
      await drag(...inside(0.55, 0.95), ...inside(0.95, 0.95));
      await count(); // highlighter …
      await key(wc, 'E');
      await click(...inside(0.75, 0.95));
      await count(); // … erased
      const settled = async () => {
        for (let i = 0; i < 120; i++) {
          if (await js('phase === "markup"').catch(() => false)) return true;
          await pause(50);
        }
        return false;
      };
      await key(wc, 'V');
      await drag(...inside(0.7, 0.8), ...inside(0.7, 0.7));
      await count(); // Move tool: the arrow goes up …
      await drag(...inside(0.45, 0.5), ...inside(0.5, 0.55));
      await count(); // … and the block-out is stretched by its corner
      await drag(x0, y0, x0 + 20, y0 + 10);
      const shrunk = await settled(); // the selection resized by its top-left grip …
      await drag(x0 + w, y0 + h, x0 + w + 40, y0 + h + 30);
      const grown = await settled(); // … and by its bottom-right one
      const frame = await js('frame'),
        wanted = { x: x0 + 20, y: y0 + 10, w: w + 20, h: h + 20 };
      const tools = await js('ops.map(o => o.tool).join(",")');
      const stillText = await clipboard.readText();

      // the next overlay copies at once again
      await js('localStorage.setItem("tnai.snapshot.markup.v1", "0")');
      send({ type: 'keyDown', keyCode: 'Enter' });
      const result = await finished(done);
      const img = await clipImage(),
        size = img ? img.getSize() : null,
        bitmap = img ? img.toBitmap() : null;

      // A pixel of the copied picture at a point of the selection, as [r, g, b] (the bitmap is
      // BGRA).
      const pixel = (px, py) => {
        if (!bitmap) return null;
        const x = Math.min(size.width - 1, Math.round(size.width * px)),
          y = Math.min(size.height - 1, Math.round(size.height * py)),
          i = (y * size.width + x) * 4;
        return [bitmap[i + 2], bitmap[i + 1], bitmap[i]];
      };
      const spot = (px, py) => {
        const [sx, sy] = inside(px, py);
        return pixel((sx - frame.x) / frame.w, (sy - frame.y) / frame.h);
      }; // a point of the first selection, in the final picture
      return {
        startedOff,
        on,
        hint,
        remembered,
        opened,
        toolbar,
        counts,
        typingIn,
        toolWhileTyping,
        text,
        tools,
        stillText,
        result,
        overlayClosed: overlay.isDestroyed(),
        size,
        shrunk,
        grown,
        frame,
        wanted,
        expected: {
          width: Math.round(frame.w * display.scaleFactor),
          height: Math.round(frame.h * display.scaleFactor),
        },
        block: spot(0.275, 0.3),
        stretched: spot(0.475, 0.525),
        arrow: spot(0.65, 0.7),
        arrowWas: spot(0.65, 0.8),
      };
    },
    // Clip: C in the overlay, a drag starts the recorder and shows the frame; stopped after about 2
    // s, the video and frames are saved and one line is on the clipboard.
    clip: async (fx, fy, fw, fh) => {
      const { BrowserWindow, screen } = require('electron');
      await clipboard.writeText('before clip');
      const pause = (ms = 20) => new Promise(r => setTimeout(r, ms)),
        within = (p, ms) =>
          Promise.race([p, new Promise(r => setTimeout(() => r({ timeout: true }), ms))]);
      const { done, overlay } = await open();
      const wc = overlay.webContents,
        send = e => wc.sendInputEvent(e);
      const [cw, ch] = overlay.getContentSize(),
        display = screen.getDisplayMatching(overlay.getBounds());
      send({ type: 'keyDown', keyCode: 'C' });
      send({ type: 'keyUp', keyCode: 'C' });
      await pause(60);
      const hint = await wc.executeJavaScript('hint.textContent');
      const x0 = Math.round(fx * cw),
        y0 = Math.round(fy * ch),
        x1 = Math.round((fx + fw) * cw),
        y1 = Math.round((fy + fh) * ch);
      send({ type: 'mouseMove', x: x0, y: y0 });
      await pause();
      send({ type: 'mouseDown', x: x0, y: y0, button: 'left', clickCount: 1 });
      await pause();
      for (let i = 1; i <= 5; i++) {
        send({
          type: 'mouseMove',
          x: Math.round(x0 + ((x1 - x0) * i) / 5),
          y: Math.round(y0 + ((y1 - y0) * i) / 5),
          modifiers: ['leftButtonDown'],
        });
        await pause();
      }
      send({ type: 'mouseUp', x: x1, y: y1, button: 'left', clickCount: 1 });
      const result = await within(done, 5000);
      const frame = await until(() => {
        const f = snapshot.clipFrame();
        return f && !f.isDestroyed() && f.isVisible() && f;
      }, 8000);
      const shown = frame
        ? {
            bounds: frame.getBounds(),
            hidden:
              typeof frame.isContentProtected === 'function' ? frame.isContentProtected() : null,
            onTop: frame.isAlwaysOnTop(),
            focusable: frame.isFocusable(),
          }
        : null;
      const second = await snapshot.start(); // a second snapshot while a clip runs is refused
      await pause(2500);
      const badge =
        frame && !frame.isDestroyed()
          ? await frame.webContents
              .executeJavaScript('document.getElementById("time").textContent')
              .catch(() => null)
          : null;
      const stopped = snapshot.stopClip();
      const out = await within(snapshot.clip() || Promise.resolve({ none: true }), 15000);
      await pause(200);
      const size = file => {
        try {
          return fs.statSync(file).size;
        } catch {
          return 0;
        }
      };
      const video = out.video ? size(out.video) : 0,
        frames = (out.frames || []).map(size),
        first = out.frames?.[0] ? nativeImage.createFromPath(out.frames[0]).getSize() : null;
      const text = await clipboard.readText();
      const left = BrowserWindow.getAllWindows().filter(w =>
        /clip (frame|recorder)/.test(w.getTitle())
      ).length;
      for (const file of [out.video, ...(out.frames || [])]) {
        try {
          if (file) fs.unlinkSync(file);
        } catch {}
      }
      const sf = display.scaleFactor,
        pw = (x1 - x0) * sf,
        ph = (y1 - y0) * sf,
        k = Math.min(1, 1280 / Math.max(pw, ph));
      return {
        hint,
        result,
        shown,
        area: {
          x: display.bounds.x + x0,
          y: display.bounds.y + y0,
          width: x1 - x0,
          height: y1 - y0,
        },
        second,
        badge,
        stopped,
        out: { ...out, frames: (out.frames || []).length },
        video,
        frames,
        first,
        expected: { width: Math.round((pw * k) / 2) * 2, height: Math.round((ph * k) / 2) * 2 },
        text,
        sameText: text === out.text,
        left,
      };
    },
    // Enter with nothing selected copies the whole screen.
    whole: async () => {
      const { done, overlay } = await open();
      const [cw, ch] = overlay.getContentSize(),
        display = require('electron').screen.getDisplayMatching(overlay.getBounds());
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      const result = await Promise.race([
        done,
        new Promise(r => setTimeout(() => r({ timeout: true }), 5000)),
      ]);
      const img = await clipImage();
      return {
        result,
        overlayClosed: overlay.isDestroyed(),
        size: img ? img.getSize() : null,
        expected: {
          width: Math.round(cw * display.scaleFactor),
          height: Math.round(ch * display.scaleFactor),
        },
      };
    },
    // Esc cancels: the overlay closes and the clipboard is untouched.
    escape: async () => {
      await clipboard.writeText('kept by Esc');
      const { done, overlay } = await open();
      overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      const result = await Promise.race([
        done,
        new Promise(r => setTimeout(() => r({ timeout: true }), 5000)),
      ]);
      return {
        result,
        overlayClosed: overlay.isDestroyed(),
        text: await clipboard.readText(),
        image: !!(await clipImage()),
      };
    },
    // Paste the clipboard into whatever has focus in Technically Not's window (the composer
    // prompt).
    paste: () => {
      _win.webContents.paste();
      return true;
    },
    restore: async () => {
      const items = await saved;
      if (!items.length) {
        await clipboard.clear();
        return 0;
      }
      try {
        await clipboard.write(items.map(data => new ClipboardItem(data)));
      } catch {
        const text = items.find(d => d['text/plain']);
        if (text) await clipboard.writeText(await text['text/plain'].text());
      }
      return items.length;
    },
  };
};
