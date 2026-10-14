/*
 * Technically Not tools · desktop-check/snapshot-window-check.js — The snapshot window inside the
 * overlay (desktop/snapshot-overlay.html), driven in a hidden window with the real
 * snapshot-preload.js: its choices, keys, remembered switches, what the main process is told, that
 * a press on it starts no selection, that it leaves when a drag starts, and its measurements. Never
 * covers the screen and never touches the clipboard. Run: npx electron
 * tools/desktop-check/snapshot-window-check.js [picture.png] (with a path, also saves pictures of
 * the window and of the marker toolbar) Not proven here: the capture, the crop and the clipboard
 * (the `snapshot` desktop test, with the user's mouse idle).
 */
'use strict';
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const W = 1280,
  H = 800,
  desktop = path.join(__dirname, '..', '..', 'desktop');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-snapwin-')));

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  const told = [];
  for (const name of ['ready', 'select', 'clip', 'cancel', 'large', 'compose'])
    ipcMain.on('snapshot:' + name, (_e, value) => told.push([name, value]));
  ipcMain.handle('snapshot:crop', (_e, r) => {
    const x = Math.round(r.x * W),
      y = Math.round(r.y * H),
      width = Math.round(r.w * W),
      height = Math.round(r.h * H);
    return {
      png: nativeImage
        .createFromBitmap(Buffer.alloc(width * height * 4, 200), { width, height })
        .toPNG(),
      width,
      height,
      x,
      y,
    };
  });
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    frame: false,
    webPreferences: {
      preload: path.join(desktop, 'snapshot-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await win.loadFile(path.join(desktop, 'snapshot-overlay.html'));
    const run = code => win.webContents.executeJavaScript('(() => {' + code + '})()', true);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const last = name => told.filter(t => t[0] === name).pop()?.[1];
    await run(`window.t_box = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      window.t_mouse = (type, x, y, buttons) => (document.elementFromPoint(x, y) || document.body).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
      window.t_key = k => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      window.t_drag = (x0, y0, x1, y1) => { t_mouse('mousedown', x0, y0, 1); t_mouse('mousemove', (x0 + x1) / 2, (y0 + y1) / 2, 1); t_mouse('mousemove', x1, y1, 1); };`);
    win.webContents.send(
      'snapshot:image',
      nativeImage
        .createFromBitmap(Buffer.alloc(64 * 40 * 4, 120), { width: 64, height: 40 })
        .toDataURL()
    );
    await wait(400);
    check(
      told.some(t => t[0] === 'ready'),
      'the overlay reports ready'
    );

    // 1. The window: one slim row, centered, every choice in it, every sentence of the old big
    // window as a tip.
    const first =
      await run(`const p = t_box(pal), row = [...pal.querySelectorAll('.pal-grip, button, kbd')].filter(e => !e.parentElement.closest('button')).map(t_box), modes = [...pal.querySelectorAll('.mode')].map(t_box);
      const icons = [...pal.querySelectorAll('.pal-grip, .ib')].map(e => { const o = t_box(e), i = t_box(e.querySelector('svg')); return { size: o.w + 'x' + o.h, share: i.w / o.w, off: Math.max(Math.abs(o.x + o.w / 2 - i.x - i.w / 2), Math.abs(o.y + o.h / 2 - i.y - i.h / 2)) }; });
      const inner = [...pal.querySelectorAll('button kbd')].map(k => { const o = t_box(k.parentElement), i = t_box(k), line = parseFloat(getComputedStyle(k.parentElement).borderTopWidth); return [i.y - o.y - line, o.b - i.b - line, o.r - i.r - line]; });
      return { shown: getComputedStyle(pal).display, left: p.x, right: innerWidth - p.r, h: p.h, w: p.w, modes, mode: pal.dataset.mode, hint: hint.textContent, hintBox: t_box(hint), icons, inner,
        buttons: pal.querySelectorAll('button').length, keys: [...pal.querySelectorAll('kbd')].map(k => k.textContent).join(' '), font: getComputedStyle(pal).fontFamily, fontsOk: document.fonts.check('13px Outfit'),
        words: pal.textContent.replace(/\\s+/g, ' ').trim(), tips: [...pal.querySelectorAll('*')].flatMap(e => [e.dataset.tip, e.dataset.tipShot, e.dataset.tipClip]).filter(Boolean), grip: pal.querySelector('.pal-grip').dataset.tip,
        mids: row.map(r => r.y + r.h / 2), heights: [...new Set(row.filter(r => r.h !== 20).map(r => r.h))], pad: [row[0].x - p.x, p.r - row[row.length - 1].r, Math.min(...row.map(r => r.y)) - p.y, p.b - Math.max(...row.map(r => r.b))],
        gaps: [...pal.children].map(t_box).map((r, i, all) => i ? r.x - all[i - 1].r : null).slice(1), switches: [...pal.querySelectorAll('[data-opt]')].map(e => e.getAttribute('role') + ' ' + e.getAttribute('aria-checked') + ' ' + e.getAttribute('aria-disabled')) };`);
    check(
      first.shown === 'flex' && first.mode === 'shot',
      'the snapshot window is shown, on Screenshot'
    );
    check(
      Math.abs(first.left - first.right) <= 1,
      'it is centered (' + first.left + ' / ' + first.right + ')'
    );
    check(
      first.buttons === 6 &&
        first.keys === 'S C Enter Esc' &&
        first.words === 'ScreenshotS ClipC Whole screenEnter Esc',
      'it holds every choice with its key (' +
        first.buttons +
        ' buttons; ' +
        first.keys +
        '; ' +
        first.words +
        ')'
    );
    check(
      first.h === 48 &&
        first.mids.every(m => Math.abs(m - first.mids[0]) <= 0.5) &&
        first.heights.join() === '30',
      'it is one row, 48 px high: every control is 30 px high on one center line (' +
        first.h +
        ' high, ' +
        first.w +
        ' wide; centers ' +
        [...new Set(first.mids)].join(' ') +
        ')'
    );
    check(
      first.pad.every(v => Math.abs(v - first.pad[0]) <= 0.5),
      'the same room on all four sides of the row (left, right, top, bottom: ' +
        first.pad.join(' ') +
        ')'
    );
    check(
      new Set(first.gaps.map(g => Math.round(g * 10))).size === 1,
      'the same gap between its groups (' + first.gaps.join(' ') + ')'
    );
    check(
      first.icons.length === 4 &&
        first.icons.every(i => i.size === '30x30' && i.share <= 0.6 && i.off <= 1),
      'the grip, the two switches and × are 30 px squares, each icon at most 60% of it and centered within 1 px (' +
        first.icons
          .map(i => i.size + ' ' + Math.round(i.share * 100) + '% off ' + i.off)
          .join('; ') +
        ')'
    );
    check(
      first.modes[0].y === first.modes[1].y &&
        first.modes[0].h === first.modes[1].h &&
        first.inner.every(k => k.every(v => Math.abs(v - k[0]) <= 0.5)),
      'Screenshot and Clip are a pair, and each key label has the same room above, below and to its right (' +
        first.inner.map(k => k.join(' ')).join('; ') +
        ')'
    );
    check(
      first.switches.join() === 'switch false false,switch false false',
      'the marker and enlarge switches are switches, off and usable (' +
        first.switches.join('; ') +
        ')'
    );
    check(
      /Drag to copy a snapshot/.test(first.hint) && first.hintBox.w <= 1,
      'the old hint words stay for screen readers, out of sight (' + first.hintBox.w + ' px wide)'
    );
    const SENTENCES = [
      'Pick one, then drag over the screen',
      'A picture, ready to paste',
      'Up to 30 s of video, no sound',
      'Use the marker first',
      'Box, arrow, pen, text, numbers, blur, block out',
      'Enlarge small pictures',
      'Stays sharp on sites that stretch them',
      'Stop with the Stop button, the snapshot key, or at 30 s',
      'The marker is for screenshots; a clip is recorded as it is',
      'This window is never in your picture or clip',
    ];
    const lost = SENTENCES.filter(t => !first.tips.some(tip => tip.includes(t)));
    check(
      !lost.length && first.grip === 'Drag to move · double-click to put it back',
      'every sentence of the big window is a tip now, and the grip says how to move it (' +
        first.tips.length +
        ' tips; lost: ' +
        (lost.join(' | ') || 'none') +
        ')'
    );
    check(first.fontsOk, 'the app font loads in this page (' + first.font.slice(0, 20) + ')');

    // 2. Choices by click and by key; what is remembered; what the main process hears.
    const picks = await run(`const out = {}; const click = sel => pal.querySelector(sel).click();
      const sw = () => [...pal.querySelectorAll('[data-opt]')]; click('[data-mode=clip]'); click('[data-opt=markup]'); click('[data-opt=large]');
      out.clip = [pal.dataset.mode, hint.textContent.slice(0, 21), sw().map(b => b.getAttribute('aria-disabled') + ' ' + b.getAttribute('aria-checked') + ' ' + getComputedStyle(b.querySelector('svg')).opacity).join(), t_box(pal).h, sw().map(b => b.dataset.tip), localStorage.getItem('tnai.snapshot.markup.v1'), localStorage.getItem('tnai.snapshot.large.v1'), t_box(pal).w];
      out.shotTips = (t_key('s'), sw().map(b => b.dataset.tip + ' / ' + b.getAttribute('aria-disabled'))); click('[data-mode=clip]');
      t_key('s'); out.s = [pal.dataset.mode, t_box(pal).h, t_box(pal).w]; t_key('c'); out.c = pal.dataset.mode; t_key('c'); out.c2 = pal.dataset.mode;
      click('[data-opt=markup]'); out.m = [pal.querySelector('[data-opt=markup]').getAttribute('aria-checked'), localStorage.getItem('tnai.snapshot.markup.v1'), /mark it up/.test(hint.textContent)];
      t_key('m'); out.m2 = [pal.querySelector('[data-opt=markup]').getAttribute('aria-checked'), localStorage.getItem('tnai.snapshot.markup.v1')];
      click('[data-opt=large]'); out.l = [pal.querySelector('[data-opt=large]').getAttribute('aria-checked'), localStorage.getItem('tnai.snapshot.large.v1')];
      return out;`);
    await wait(100);
    check(
      picks.clip[0] === 'clip' &&
        picks.clip[1] === 'Drag to record a clip' &&
        picks.clip[2] === 'true false 0.4,true false 0.4' &&
        picks.clip[5] !== '1' &&
        picks.clip[6] !== '1',
      'Clip by click: the marker and enlarge switches are grayed and a click on them does nothing (' +
        picks.clip.slice(0, 3).join(', ') +
        ')'
    );
    check(
      picks.clip[4][0] === 'The marker is for screenshots; a clip is recorded as it is' &&
        /a clip is recorded as it is/.test(picks.clip[4][1]) &&
        /^Use the marker first \(M\).* \/ false$/.test(picks.shotTips[0]) &&
        /^Enlarge small pictures \(L\).* \/ false$/.test(picks.shotTips[1]),
      'in Clip their tips say why, and on Screenshot they say what they do, with the key (' +
        picks.clip[4].join(' | ') +
        ')'
    );
    check(
      picks.s[0] === 'shot' && picks.c === 'clip' && picks.c2 === 'shot',
      'S picks Screenshot, C switches to Clip and back'
    );
    check(
      picks.clip[3] === picks.s[1] && picks.clip[7] === picks.s[2],
      'the window keeps its size between Screenshot and Clip (' +
        picks.clip[7] +
        ' × ' +
        picks.clip[3] +
        ' / ' +
        picks.s[2] +
        ' × ' +
        picks.s[1] +
        ')'
    );
    check(
      picks.m[0] === 'true' &&
        picks.m[1] === '1' &&
        picks.m[2] &&
        picks.m2[0] === 'false' &&
        picks.m2[1] === '0',
      'the marker switch and M turn markup on and off, remembered'
    );
    check(
      picks.l[0] === 'true' && picks.l[1] === '1' && last('large') === true,
      'the enlarge switch is remembered and the main process is told'
    );
    await run(`t_key('l');`);
    await wait(100);
    check(last('large') === false, 'L turns it off again');

    // 3. A press on the window starts no selection; a drag elsewhere hides it, shows the size, and
    // is reported.
    const before = told.length;
    const onIt =
      await run(`const k = t_box(pal.querySelector(':scope > .pal-set > kbd')), x = k.x + k.w / 2, y = k.y + k.h / 2; t_mouse('mousedown', x, y, 1); t_mouse('mousemove', x - 300, y - 300, 1); t_mouse('mouseup', x - 300, y - 300, 0);
      return { sel: getComputedStyle(sel).display, pal: getComputedStyle(pal).display };`);
    await wait(100);
    check(
      onIt.sel === 'none' && onIt.pal === 'flex' && told.length === before,
      'a drag that starts on the window selects nothing'
    );
    const towed =
      await run(`const a = t_box(pal), g = t_box(pal.querySelector('.pal-grip')), x = g.x + g.w / 2, y = g.y + g.h / 2, grip = pal.querySelector('.pal-grip');
      t_mouse('mousedown', a.x + a.w / 2, a.y + a.h / 2, 1); t_mouse('mousemove', a.x + a.w / 2 - 90, a.y + a.h / 2 - 90, 1); t_mouse('mouseup', a.x + a.w / 2 - 90, a.y + a.h / 2 - 90, 0); const still = t_box(pal);
      t_mouse('mousedown', x, y, 1); t_mouse('mouseup', x, y, 0); const pressed = localStorage.getItem('tnai.snapshot.pal.v1');
      t_mouse('mousedown', x, y, 1); t_mouse('mousemove', x - 300, y - 200, 1); t_mouse('mouseup', x - 300, y - 200, 0); const b = t_box(pal), saved = localStorage.getItem('tnai.snapshot.pal.v1');
      grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); const c = t_box(pal);
      return { stayed: still.x === a.x && still.y === a.y, pressed, dx: b.x - a.x, dy: b.y - a.y, saved, center: [(b.x + b.w / 2) / innerWidth, (b.y + b.h / 2) / innerHeight], back: [c.x - a.x, c.y - a.y], after: localStorage.getItem('tnai.snapshot.pal.v1'), side: pal.dataset.side };`);
    const kept = (() => {
      try {
        return JSON.parse(towed.saved);
      } catch {
        return null;
      }
    })();
    check(
      towed.stayed && towed.pressed === null,
      'only its grip drags it, and a press on the grip without a move remembers nothing (' +
        towed.stayed +
        ', ' +
        towed.pressed +
        ')'
    );
    check(
      towed.dx === -300 && towed.dy === -200,
      'its grip drags it aside (' + towed.dx + ', ' + towed.dy + ')'
    );
    check(
      kept &&
        Math.abs(kept.x - towed.center[0]) < 1e-6 &&
        Math.abs(kept.y - towed.center[1]) < 1e-6,
      'the place is remembered as its center, in fractions of the screen (' + towed.saved + ')'
    );
    check(
      towed.after === null && towed.back[0] === 0 && towed.back[1] === 0 && towed.side === 'bottom',
      'a double-click on the grip forgets the place and puts it back at once (' +
        towed.back.join(', ') +
        '; ' +
        towed.after +
        ')'
    );
    const mid = await run(
      `t_drag(200, 450, 600, 700); return { pal: getComputedStyle(pal).display, sel: t_box(sel), size: size.textContent, sizeShown: getComputedStyle(size).display, sizeBox: t_box(size) };`
    );
    check(mid.pal === 'none', 'the window leaves when the drag starts');
    check(
      mid.sizeShown === 'block' && mid.size === '400 × 250' && mid.sizeBox.y >= mid.sel.b,
      'the size is shown under the selection (' + mid.size + ')'
    );
    await run(`t_mouse('mouseup', 600, 700, 0);`);
    await wait(100);
    const picked = last('select');
    check(
      picked &&
        Math.abs(picked.x - 200 / W) < 1e-6 &&
        Math.abs(picked.w - 400 / W) < 1e-6 &&
        Math.abs(picked.h - 250 / H) < 1e-6,
      'the selection is reported to the main process (' + JSON.stringify(picked) + ')'
    );
    await run(`pal.querySelector('[data-act=whole]').click();`);
    await wait(100);
    check(
      last('select')?.w === 1 && last('select')?.h === 1,
      'Whole screen reports the whole screen'
    );
    if (process.argv[2]) {
      await run(`sel.style.display = 'none'; dim.style.display = ''; pal.style.display = '';`);
      await wait(300);
      fs.writeFileSync(process.argv[2], (await win.webContents.capturePage()).toPNG());
    }

    // 4. Clip: a drag asks for a clip, not a picture.
    await run(
      `pal.style.display = ''; t_key('c'); t_drag(200, 450, 600, 700); t_mouse('mouseup', 600, 700, 0); t_key('c');`
    );
    await wait(100);
    check(
      Math.abs((last('clip')?.w || 0) - 400 / W) < 1e-6,
      'with Clip chosen the drag asks for a clip'
    );

    // 4b. Cancel (before the marker: after Enter the real overlay is gone).
    await run(`pal.querySelector('[data-act=cancel]').click();`);
    await wait(100);
    check(
      told.some(t => t[0] === 'cancel'),
      "the window's × cancels"
    );

    // 5. The marker: the toolbar opens after the drag, with all its controls, inside the screen;
    // nothing of the window is on the canvas.
    await run(`t_key('m'); t_drag(300, 420, 800, 640); t_mouse('mouseup', 800, 640, 0);`);
    await wait(500);
    const bar = await run(`const b = t_box(bar), buttons = [...bar.querySelectorAll('button')];
      const off = buttons.filter(x => x.firstElementChild).map(x => { const o = t_box(x), i = t_box(x.firstElementChild); return Math.max(Math.abs(o.x + o.w / 2 - i.x - i.w / 2), Math.abs(o.y + o.h / 2 - i.y - i.h / 2)); });
      return { shown: getComputedStyle(bar).display, pal: getComputedStyle(pal).display, b, count: buttons.length, groups: [...bar.querySelectorAll('.cap')].map(c => c.textContent).join(' '),
        sizes: [...new Set(buttons.filter(x => x.dataset.act !== 'copy').map(x => t_box(x).w + 'x' + t_box(x).h))].join(' '), off: Math.max(...off), paper: [paper.width, paper.height], selB: t_box(sel).b };`);
    check(
      bar.shown === 'flex' && bar.pal === 'none',
      'with the marker on, the toolbar opens after the drag and the window stays away'
    );
    check(
      bar.count === 17 && bar.groups === 'Draw Hide Fix Color',
      'the toolbar keeps its 17 controls, in named groups (' + bar.count + '; ' + bar.groups + ')'
    );
    check(
      bar.sizes === '30x30' && bar.off <= 1,
      'its buttons are one size and each icon is centered (' +
        bar.sizes +
        ', off by ' +
        bar.off +
        ')'
    );
    check(
      bar.b.x >= 16 && bar.b.r <= W - 16 && bar.b.y >= bar.selB && bar.b.b <= H - 16,
      'it sits under the selection, inside the screen'
    );
    check(
      bar.paper[0] === 500 && bar.paper[1] === 220,
      'the canvas is exactly the selection (' + bar.paper.join(' × ') + ')'
    );
    if (process.argv[2]) {
      await wait(200);
      fs.writeFileSync(
        process.argv[2].replace(/\.png$/, '-marker.png'),
        (await win.webContents.capturePage()).toPNG()
      );
    }
    await run(`t_key('Enter');`);
    await wait(400);
    const composed = last('compose'),
      size = composed ? nativeImage.createFromBuffer(Buffer.from(composed)).getSize() : null;
    check(
      size?.width === 500 && size?.height === 220,
      'Enter hands back a picture of exactly the selection (' + JSON.stringify(size) + ')'
    );

    // 6. Where it opens: bottom center above the taskbar, top center when the pointer is low, or
    // where it was dragged last time (kept on screen).
    const opened = async (query, saved) => {
      await run(
        saved == null
          ? `localStorage.removeItem('tnai.snapshot.pal.v1');`
          : `localStorage.setItem('tnai.snapshot.pal.v1', ${JSON.stringify(saved)});`
      );
      await win.loadFile(path.join(desktop, 'snapshot-overlay.html'), { query });
      return win.webContents.executeJavaScript(
        `document.fonts.ready.then(() => new Promise(r => setTimeout(r, 150))).then(() => { const b = pal.getBoundingClientRect();
        return { side: pal.dataset.side, left: b.left, right: innerWidth - b.right, top: b.top, bottom: innerHeight - b.bottom, w: b.width, h: b.height, cx: (b.left + b.width / 2) / innerWidth, cy: (b.top + b.height / 2) / innerHeight, key: localStorage.getItem('tnai.snapshot.pal.v1') }; })`,
        true
      );
    };
    const near = (a, b) => Math.abs(a - b) <= 1,
      centered = p => near(p.left, p.right),
      inside = p => p.left >= 0 && p.right >= 0 && p.top >= 0 && p.bottom >= 0;
    const show = p => JSON.stringify([p.side, p.left, p.right, p.top, p.bottom, p.w, p.h]);
    const high = await opened({ py: '0.2', inset: '48' }, null);
    check(
      high.side === 'bottom' && centered(high) && near(high.bottom, 28 + 48),
      'pointer high: it opens bottom center, 28 px above the taskbar (side, left, right, top, bottom, w, h: ' +
        show(high) +
        ')'
    );
    const low = await opened({ py: '0.8', inset: '48' }, null);
    check(
      low.side === 'top' && centered(low) && near(low.top, 28),
      'pointer in the lower 40%: it opens top center, 28 px from the top (' + show(low) + ')'
    );
    const edge = await opened({ py: '0.6', inset: '48' }, null);
    check(
      edge.side === 'bottom' && near(edge.bottom, 76),
      'pointer exactly at 60%: still the bottom (' + show(edge) + ')'
    );
    const bare = await opened({}, null),
      odd = await opened({ py: 'low', inset: '-40' }, null);
    check(
      bare.side === 'bottom' &&
        centered(bare) &&
        near(bare.bottom, 28) &&
        odd.side === 'bottom' &&
        centered(odd) &&
        near(odd.bottom, 28),
      'nothing or nonsense in the address: bottom center, no taskbar room (' +
        show(bare) +
        ' ' +
        show(odd) +
        ')'
    );
    check(
      near(high.w, low.w) && near(high.h, low.h) && near(high.w, bare.w),
      'it is the same size wherever it opens (' + [high.w, low.w, bare.w].join(' ') + ' wide)'
    );
    const put = await opened({ py: '0.8', inset: '48' }, '{"x":0.3,"y":0.25}');
    check(
      put.side === 'top' && Math.abs(put.cx - 0.3) * W <= 1 && Math.abs(put.cy - 0.25) * H <= 1,
      'a remembered place wins over the pointer rule (center ' +
        put.cx.toFixed(4) +
        ', ' +
        put.cy.toFixed(4) +
        '; ' +
        show(put) +
        ')'
    );
    const lowHalf = await opened({ py: '0.2' }, '{"x":0.7,"y":0.75}');
    check(
      lowHalf.side === 'bottom' &&
        Math.abs(lowHalf.cx - 0.7) * W <= 1 &&
        Math.abs(lowHalf.cy - 0.75) * H <= 1,
      'its side follows the half it sits in (' + show(lowHalf) + ')'
    );
    const corner = await opened({ py: '0.2' }, '{"x":1,"y":1}'),
      other = await opened({ py: '0.2' }, '{"x":0,"y":0}');
    check(
      inside(corner) &&
        near(corner.right, 8) &&
        near(corner.bottom, 8) &&
        corner.side === 'bottom' &&
        inside(other) &&
        near(other.left, 8) &&
        near(other.top, 8) &&
        other.side === 'top' &&
        near(corner.w, high.w) &&
        near(other.w, high.w),
      'a remembered place at the screen edge is brought fully on screen, 8 px in, at full size (' +
        show(corner) +
        ' ' +
        show(other) +
        ')'
    );
    const junk = await opened({ py: '0.2' }, '{"x":5,"y":"up"}'),
      torn = await opened({ py: '0.8' }, '{"x":0.5');
    check(
      junk.side === 'bottom' &&
        centered(junk) &&
        near(junk.bottom, 28) &&
        torn.side === 'top' &&
        near(torn.top, 28),
      'a remembered place that cannot be read is ignored (' + show(junk) + ' ' + show(torn) + ')'
    );
    await opened({ py: '0.2', inset: '48' }, null);
    const flung =
      await run(`const mouse = (type, x, y, buttons, el) => (el || document.elementFromPoint(x, y) || document.body).dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons }));
      const grip = pal.querySelector('.pal-grip'), box = () => { const b = pal.getBoundingClientRect(); return [b.left, innerWidth - b.right, b.top, innerHeight - b.bottom]; }, out = [];
      for (const [x, y] of [[-900, -900], [5000, 5000], [5000, -900], [-900, 5000]]) { const g = grip.getBoundingClientRect(); mouse('mousedown', g.left + g.width / 2, g.top + g.height / 2, 1, grip); mouse('mousemove', x, y, 1, document.body); mouse('mouseup', x, y, 0, document.body); out.push(box().concat(pal.dataset.side)); }
      const key = localStorage.getItem('tnai.snapshot.pal.v1'); grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      return { out, key, back: box().concat(pal.dataset.side), after: localStorage.getItem('tnai.snapshot.pal.v1') };`);
    check(
      flung.out.every(b => b.slice(0, 4).every(v => v >= 8 - 1)) &&
        flung.out.map(b => b[4]).join(' ') === 'top bottom top bottom',
      'dragged past every screen corner it stays fully on screen (left, right, top, bottom room: ' +
        JSON.stringify(flung.out) +
        ')'
    );
    const again = await opened({ py: '0.2', inset: '48' }, flung.key);
    check(
      inside(again) && near(again.left, 8) && near(again.bottom, 8),
      'and it opens there the next time (' + show(again) + ')'
    );
    check(
      flung.after === null &&
        near(flung.back[0], flung.back[1]) &&
        near(flung.back[3], 76) &&
        flung.back[4] === 'bottom',
      'a double-click on the grip puts it back above the taskbar (' +
        JSON.stringify(flung.back) +
        ')'
    );

    // 6b. At 1024 px wide: the row fits, and every tip is 8 px clear of it on the side away from
    // the nearer screen edge, and on the screen, wherever the row sits.
    win.setContentSize(1024, 768);
    await wait(200);
    try {
      win.webContents.debugger.attach();
      await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', {
        enabled: true,
      });

      // a hidden window has no focus of its own: the page is told it has it, so a focused control
      // shows its tip (the user's own window keeps the real focus)
    } catch {}
    const tipsAt = async (query, saved, clip, picture) => {
      await opened(query, saved);
      const got =
        await run(`if (${clip}) pal.querySelector('[data-mode=clip]').click(); const p = pal.getBoundingClientRect(), meter = document.createElement('canvas').getContext('2d'); meter.font = '400 12px ' + getComputedStyle(pal).fontFamily;
        const tips = [...pal.querySelectorAll('[data-tip]')].map(e => { e.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); if (e.focus) e.focus();
          const b = e.getBoundingClientRect(), cs = getComputedStyle(e, '::after'), drawn = cs.content !== 'none', line = parseFloat(getComputedStyle(e).borderTopWidth), dx = parseFloat(e.style.getPropertyValue('--tip-dx')) || 0;
          const w = meter.measureText(e.dataset.tip).width + 16, left = b.left + b.width / 2 + dx - w / 2, o = { tip: e.dataset.tip, left, right: innerWidth - left - w, drawn, dx };
          if (drawn) { const h = parseFloat(cs.height) + 8; o.wide = parseFloat(cs.width) + 16 - w; o.shown = cs.content;
            if (cs.top === 'auto' || parseFloat(cs.top) < 0) { const bottom = b.top + line - (parseFloat(cs.bottom) - (b.height - 2 * line)) - parseFloat(cs.marginBottom); o.clear = p.top - bottom; o.room = bottom - h; o.where = 'above'; }
            else { const top = b.top + line + parseFloat(cs.top) + parseFloat(cs.marginTop); o.clear = top - p.bottom; o.room = innerHeight - top - h; o.where = 'below'; } }
          return o; });
        return { side: pal.dataset.side, left: p.left, right: innerWidth - p.right, w: p.width, h: p.height, wide: innerWidth, scroll: document.documentElement.scrollWidth, tips };`);
      if (picture && process.argv[2]) {
        await run(`pal.querySelector('[data-opt=markup]').focus();`);
        await wait(300);
        fs.writeFileSync(
          process.argv[2].replace(/\.png$/, picture),
          (await win.webContents.capturePage()).toPNG()
        );
      }
      return got;
    };
    const narrow = [
      ['bottom center', await tipsAt({ py: '0.2', inset: '48' }, null, false, '-1024.png')],
      ['top center, Clip', await tipsAt({ py: '0.8', inset: '48' }, null, true, '-1024-clip.png')],
      ['bottom right corner', await tipsAt({}, '{"x":1,"y":1}', false)],
      ['top left corner, Clip', await tipsAt({}, '{"x":0,"y":0}', true)],
    ];
    for (const [name, n] of narrow) {
      const drawn = n.tips.filter(t => t.drawn),
        want = n.side === 'bottom' ? 'above' : 'below',
        worst = Math.min(...n.tips.flatMap(t => [t.left, t.right]));
      check(
        n.wide === 1024 && n.left >= 8 && n.right >= 8 && n.h === 48 && n.scroll <= 1024,
        '1024 wide, ' +
          name +
          ': the row is whole and one row (' +
          n.w +
          ' × ' +
          n.h +
          ', ' +
          n.left +
          ' left, ' +
          n.right +
          ' right)'
      );
      check(
        n.tips.length === 7 && worst >= 7.5,
        '1024 wide, ' +
          name +
          ': all 7 tips stay on the screen, 8 px in at the least (nearest ' +
          worst.toFixed(1) +
          '; moved by ' +
          n.tips.map(t => t.dx).join(' ') +
          ')'
      );
      check(
        drawn.length === 6 &&
          drawn.every(
            t =>
              t.where === want &&
              Math.abs(t.clear - 8) <= 0.5 &&
              t.room >= 0 &&
              Math.abs(t.wide) <= 1 &&
              t.shown.includes(t.tip.slice(0, 12))
          ),
        '1024 wide, ' +
          name +
          ': a control reached with Tab shows its tip ' +
          want +
          ' the row, 8 px clear of it, as wide as measured (' +
          drawn.length +
          ' drawn; clear ' +
          [...new Set(drawn.map(t => t.clear))].join(' ') +
          '; room left ' +
          Math.min(...drawn.map(t => t.room)) +
          ')'
      );
    }
    win.setContentSize(W, H);
    await run(`localStorage.removeItem('tnai.snapshot.pal.v1');`);
    await wait(200);
  } catch (error) {
    check(false, 'ran without an error: ' + error.message);
  }

  // 7. The accent picked in the app: read from the app's page by the service, shown by the snapshot
  // window and by the clip's recording frame.
  try {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const dir = app.getPath('userData'),
      page = path.join(dir, 'index.html');
    fs.writeFileSync(
      page,
      '<!doctype html><html data-accent="rose"><body>stand-in for the app page</body></html>'
    );
    const appWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await appWin.loadFile(page);
    const { readAccent } = require('../../desktop/snapshot-service');
    check((await readAccent()) === 'rose', 'the service reads the accent from the app page');
    await appWin.webContents.executeJavaScript(
      'document.documentElement.dataset.accent = "made-up"'
    );
    check(
      (await readAccent()) === 'rose',
      'an accent it does not know is not taken (the last one stays)'
    );
    appWin.destroy();
    await win.loadFile(path.join(desktop, 'snapshot-overlay.html'), { query: { accent: 'teal' } });
    const teal = await win.webContents.executeJavaScript(
      `[getComputedStyle(sel).borderTopColor, getComputedStyle(document.querySelector('.mode[aria-pressed=true]')).boxShadow, getComputedStyle(pal).backgroundColor]`
    );
    check(
      teal[0] === 'rgb(44, 201, 181)' && /44, 201, 181/.test(teal[1]) && /16, 34, 42/.test(teal[2]),
      'the snapshot window takes the accent handed to it (' + teal[0] + '; ' + teal[2] + ')'
    );
    await win.loadFile(path.join(desktop, 'snapshot-overlay.html'), { query: { accent: '"><b>' } });
    check(
      (await win.webContents.executeJavaScript(`getComputedStyle(sel).borderTopColor`)) ===
        'rgb(189, 99, 255)',
      'anything else in the address leaves it purple'
    );
    const frame = new BrowserWindow({
      show: false,
      width: W,
      height: H,
      useContentSize: true,
      frame: false,
      transparent: true,
      webPreferences: {
        preload: path.join(desktop, 'snapshot-clip-preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    await frame.loadFile(path.join(desktop, 'snapshot-frame.html'), {
      query: { accent: 'neutral' },
    });
    frame.webContents.send('clip:frame', {
      left: 300,
      top: 300,
      width: 500,
      height: 250,
      maxMs: 30000,
    });
    await wait(200);
    frame.webContents.send('clip:recording');
    await wait(400);
    const f = await frame.webContents
      .executeJavaScript(`(() => { const b = badge.getBoundingClientRect(), s = stop.getBoundingClientRect(), v = view.getBoundingClientRect(), cs = getComputedStyle(badge);
      return { shown: cs.display, h: b.height, above: v.top - b.bottom, left: b.left - v.left, room: [s.top - b.top, b.bottom - s.bottom, b.right - s.right].map(n => Math.round(n * 10) / 10), bg: cs.backgroundColor, radius: cs.borderRadius, time: time.textContent, font: document.fonts.check('12px Outfit') }; })()`);
    check(
      f.shown === 'flex' && f.h === 32 && f.above === 10 && f.left === 0,
      "the recording badge sits 10 px above the area's left corner (" +
        JSON.stringify([f.h, f.above, f.left]) +
        ')'
    );
    check(
      f.room[0] === f.room[1] && f.room[0] === f.room[2],
      'Stop has the same room above, below and to its right (' + f.room.join(' ') + ')'
    );
    check(
      /27, 27, 34/.test(f.bg) && f.radius === '10px' && f.font,
      'the badge is glass in the accent handed to it, in the app font (' +
        f.bg +
        ', ' +
        f.radius +
        ')'
    );
    check(/^0:00 \/ 0:30$/.test(f.time), 'it counts the time (' + f.time + ')');
    if (process.argv[2])
      fs.writeFileSync(
        process.argv[2].replace(/\.png$/, '-frame.png'),
        (await frame.webContents.capturePage()).toPNG()
      );
    frame.destroy();
  } catch (error) {
    check(false, 'the accent part ran without an error: ' + error.message);
  }
  console.log(failed ? 'FAILED ' + failed : 'ALL OK');
  app.exit(failed ? 1 : 0);
});
