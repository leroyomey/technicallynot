// Technically Not desktop · snapshot-service.js — Gyazo-style snapshot to the clipboard: a global
// shortcut (Ctrl+Shift+Alt+S unless changed in Settings, while Technically Not runs) captures the
// display under the cursor at its native pixel size, shows it frozen in a full-screen frameless
// overlay (snapshot-overlay.html) where the user drags a rectangle (Esc / focus loss cancels), then
// crops and writes the image to the clipboard. With markup turned on in the overlay (M), the
// selection stays open there: the overlay asks for its pixels (`snapshot:crop`), the user blurs,
// blocks out and draws on them, and the finished PNG comes back (`snapshot:compose`) to be copied
// instead. With "copy enlarged" turned on in the overlay (L), a picture under 1200 px wide is
// copied in whole multiples of its pixels. With C in the overlay the selection is recorded as a
// short clip instead (snapshot-clip.js); while one runs, the shortcut stops it. Everything stays in
// memory: nothing is written to disk. A small non-focusable "Snapshot copied" card with a thumbnail
// confirms it without taking focus. State (registered or why not) goes to the window as
// `snapshot:state`.
'use strict';
const path = require('path');
const {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
} = require('electron');

const fs = require('fs');
const { execFile } = require('child_process');
const clip = require('./snapshot-clip');

// the developer self-test switch, never on in a release build
const { selfTest } = require('./build-info');
const attachments = require('./attachment-service');
const shelf = require('./snapshot-shelf');

// The shortcut is the user's choice (Settings › Keyboard, 62-snapshot-shortcut.js), kept in
// userData/snapshot-shortcut.json.
const DEFAULT = 'Control+Shift+Alt+S';
const label = acc =>
  acc
    .split('+')
    .map(p => (p === 'Control' ? 'Ctrl' : p))
    .join('+');
let accelerator = DEFAULT,
  registered = null; // registered: the accelerator this app holds right now
let state = { accelerator: label(DEFAULT), isDefault: true, registered: false, error: null };
let notify = () => {};
let session = null; // the open capture: { overlay, display, image, ready, finish, crop, region }
const MAX_COMPOSED = 256 * 1024 * 1024; // a marked-up PNG larger than this is refused

function setState(patch) {
  state = { ...state, ...patch };
  notify(state);
}
const file = () => path.join(app.getPath('userData'), 'snapshot-shortcut.json');
let clipping = null,
  clipSoon = false; // the last clip's result (a promise); a clip is about to start
const onPress = () => {
  if (clip.active()) return void clip.stop();
  start().then(
    r => r?.error && failed(r.error),
    e => failed(e?.message || 'snapshot failed')
  );
}; // while a clip records, the shortcut ends it

// A snapshot that failed says why on the existing card (no thumbnail), instead of showing nothing.
// Only the reason's first part, as plain text: the card is a fixed 240 px wide and its text goes
// into the page as it is.
const failed = text => {
  try {
    confirm(
      screen.getDisplayNearestPoint(screen.getCursorScreenPoint()),
      null,
      'Snapshot failed',
      String(text).split(':')[0].replace(/[<>&]/g, '').slice(0, 40)
    );
  } catch {}
};

// Only Electron accelerators built by the settings picker: Ctrl/Alt/Shift + one key, or a lone F
// key / Print Screen.
const KEY =
  /^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|PrintScreen|Scrolllock|Pause|num[0-9]|numadd|numsub|nummult|numdiv|numdec|[-=[\]\\;',./`])$/;

function valid(acc) {
  if (typeof acc !== 'string' || acc.length > 60) return false;
  const parts = acc.split('+'),
    key = parts.pop();
  if (
    !KEY.test(key) ||
    new Set(parts).size !== parts.length ||
    !parts.every(m => ['Control', 'Alt', 'Shift'].includes(m))
  )
    return false;

  // a plain letter would be taken from every app
  return parts.some(m => m !== 'Shift') || /^(?:F\d+|PrintScreen|Pause|Scrolllock)$/.test(key);
}

// Holds `acc` as the global shortcut; a shortcut held by another app (or another Technically Not)
// is reported, never thrown.
function register(acc) {
  if (registered) {
    try {
      globalShortcut.unregister(registered);
    } catch {}
    registered = null;
  }

  // tests call start() directly; the user's own Technically Not keeps its shortcut
  if (selfTest) return true;
  let ok = false;
  try {
    ok = globalShortcut.register(acc, onPress);
  } catch {}
  if (ok) registered = acc;
  return ok;
}
const publish = ok =>
  setState({
    accelerator: label(accelerator),
    isDefault: accelerator === DEFAULT,
    registered: ok && !selfTest,
    error: ok
      ? null
      : label(accelerator) +
        ' is already used by another app, so the snapshot shortcut is off. Pick another in Settings › Keyboard.',
  });

function init(onState) {
  notify = onState || notify;
  ipcMain.on('snapshot:ready', event => {
    if (session && event.sender === session.overlay.webContents) session.ready = true;
  });
  ipcMain.on('snapshot:select', (event, rect) => {
    if (session && event.sender === session.overlay.webContents) session.finish(rect);
  });
  ipcMain.on('snapshot:cancel', event => {
    if (session && event.sender === session.overlay.webContents) session.finish(null);
  });
  ipcMain.on('snapshot:clip', (event, rect) => {
    if (session?.finish && event.sender === session.overlay?.webContents)
      session.finish(null, null, rect);
  });
  ipcMain.handle('snapshot:crop', (event, rect) =>
    session?.crop && event.sender === session.overlay?.webContents ? session.crop(rect) : null
  );
  ipcMain.on('snapshot:large', (event, on) => {
    if (session && event.sender === session.overlay?.webContents) session.large = on === true;
  });
  ipcMain.on('snapshot:compose', (event, png) => {
    if (session?.finish && event.sender === session.overlay?.webContents) session.finish(null, png);
  });
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8')).accelerator;
    if (valid(saved)) accelerator = saved;
  } catch {}
  publish(register(accelerator));
  app.on('will-quit', () => {
    if (registered)
      try {
        globalShortcut.unregister(registered);
      } catch {}
  });
}

// Settings: switch to a new shortcut (null = the default). One another app holds is refused and the
// old one stays.
function setShortcut(acc) {
  const next = acc == null ? DEFAULT : acc;
  if (!valid(next))
    return {
      ok: false,
      error: 'That key cannot be a snapshot shortcut. Use Ctrl or Alt with a key, or an F key.',
    };
  const previous = accelerator;
  if (next !== previous || !registered) {
    if (!register(next)) {
      register(previous);
      publish(!!registered || selfTest);
      return { ok: false, error: label(next) + ' is already used by another app. Pick another.' };
    }
    accelerator = next;
  }
  try {
    if (next === DEFAULT) fs.rmSync(file(), { force: true });
    else fs.writeFileSync(file(), JSON.stringify({ accelerator: next }));
  } catch {}
  publish(true);
  return { ok: true, state };
}

// The screen source for a display: matched by display id, else by its position in the display list.
async function grab(display) {
  const size = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const index = screen.getAllDisplays().findIndex(d => d.id === display.id);
  const source =
    sources.find(s => String(s.display_id) === String(display.id)) ||
    (sources.length === 1 ? sources[0] : sources[index]);
  if (!source || source.thumbnail.isEmpty()) throw new Error('screen capture unavailable');
  return source.thumbnail;
}

// "Copy enlarged" (L in the overlay): a picture under 1200 px wide with every screen pixel as a
// whole block of pixels (2× to 8×, no side over 4096 px), never smoothed, so a site that stretches
// small pictures has nothing left to blur. Null when it is large enough already.
function enlarge(image) {
  const { width: w, height: h } = image.getSize(),
    f = Math.min(8, Math.ceil(1200 / w), Math.floor(4096 / Math.max(w, h)));
  const src = image.toBitmap();
  if (!(f >= 2) || src.length !== w * h * 4) return null;
  const row = w * f * 4,
    out = Buffer.alloc(row * h * f);
  for (let y = 0; y < h; y++) {
    const line = out.subarray(y * f * row, y * f * row + row);
    for (let x = 0; x < w; x++) {
      const px = src.subarray((y * w + x) * 4, (y * w + x) * 4 + 4);
      for (let k = 0; k < f; k++) px.copy(line, (x * f + k) * 4);
    }
    for (let k = 1; k < f; k++) line.copy(out, (y * f + k) * row);
  }
  return nativeImage.createFromBitmap(out, { width: w * f, height: h * f });
}

// Opens the overlay on the display under the cursor. Resolves { copied, width, height } or {
// cancelled } once the user is done.
async function start() {
  if (session || clipSoon || clip.active()) return { cancelled: true, busy: true };

  // asked now, used when the overlay loads: the capture never waits for it
  const accentSoon = readAccent();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  session = { display, ready: false };
  let image;
  try {
    image = await grab(display);
  } catch (error) {
    session = null;
    throw error;
  }
  const overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    show: false,
    backgroundColor: '#000000',
    title: 'Technically Not snapshot',
    webPreferences: {
      preload: path.join(__dirname, 'snapshot-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  Object.assign(session, { overlay, image });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', event => event.preventDefault());

  // A selection (fractions of the screen) in capture pixels, or null when it is under 2 px.
  const area = rect => {
    if (!rect || typeof rect !== 'object') return null;
    const { width: W, height: H } = image.getSize(),
      clamp = v => Math.min(1, Math.max(0, Number(v) || 0));
    const x = Math.round(clamp(rect.x) * W),
      y = Math.round(clamp(rect.y) * H);
    const w = Math.min(W - x, Math.round(clamp(rect.w) * W)),
      h = Math.min(H - y, Math.round(clamp(rect.h) * H));
    return w >= 2 && h >= 2 ? { x, y, width: w, height: h } : null;
  };

  // Markup: the selection's pixels for the overlay to draw on, and where they start in the capture
  // (the overlay asks again when the selection is moved or resized). The region is remembered: only
  // a PNG of exactly that size is accepted back.
  session.crop = rect => {
    const region = area(rect);
    if (!region) return null;
    session.region = region;
    return {
      png: image.crop(region).toPNG(),
      width: region.width,
      height: region.height,
      x: region.x,
      y: region.y,
    };
  };
  const done = new Promise(resolve => {
    session.finish = async (rect, composed, clipRect) => {
      const s = session;
      if (!s || s.overlay !== overlay) return;
      session = null;
      let result = { cancelled: true };
      if (clipRect) {
        // record this area instead of copying it
        const region = area(clipRect);
        if (region) {
          result = { clip: true, width: region.width, height: region.height };
          clipSoon = true;
          clipping = record(display, region);
        }
      } else if (composed != null) {
        // A marked-up snapshot that cannot be used is dropped, never replaced by the unmarked crop:
        // the markup may hide something.
        const usable =
          s.region &&
          (Buffer.isBuffer(composed) || composed instanceof Uint8Array) &&
          composed.length > 0 &&
          composed.length <= MAX_COMPOSED;
        let marked = null;
        try {
          if (usable) marked = nativeImage.createFromBuffer(Buffer.from(composed));
        } catch {}
        const size = marked && !marked.isEmpty() ? marked.getSize() : null;
        if (size && size.width === s.region.width && size.height === s.region.height) {
          // The overlay's PNG goes on as it came: encoding the decoded picture again held the main
          // thread about 100 ms (stalls.log, snapshot:compose).
          result = {
            copied: true,
            width: size.width,
            height: size.height,
            marked: true,
            png: Buffer.from(composed),
          };
          s.cropped = marked;
        } else result = { cancelled: true, error: 'marked-up snapshot was not usable' };
      } else if (rect) {
        const region = area(rect);
        if (region) {
          const cropped = image.crop(region);
          result = {
            copied: true,
            width: region.width,
            height: region.height,
            png: cropped.toPNG(),
          };
          s.cropped = cropped;
        }
      }

      // the card keeps showing the selection itself
      const big = result.copied && s.large ? enlarge(s.cropped) : null;
      if (big) {
        const size = big.getSize();
        Object.assign(result, {
          enlarged: size.width / result.width,
          width: size.width,
          height: size.height,
          png: big.toPNG(),
        });
      }
      if (!overlay.isDestroyed()) overlay.destroy();

      // Electron's async clipboard (W3C-style): a PNG Blob, which Windows also offers as a bitmap
      // to apps that paste images.
      if (result.copied) {
        try {
          await clipboard.write([
            new ClipboardItem({ 'image/png': new Blob([result.png], { type: 'image/png' }) }),
          ]);
        } catch (error) {
          result = { cancelled: true, error: 'clipboard write failed: ' + error.message };
        }

        // the Snapshots box keeps it too, so several taken back to back can each be copied again
        // (with the picture already decoded, so the box does not decode the PNG again)
        if (result.copied)
          shelf.addPicture(result.png, result.width, result.height, big || s.cropped);
        delete result.png;
      }
      if (result.copied) {
        confirm(display, s.cropped);
        try {
          attachments.sweep();
        } catch {}

        // the picture replaced what was on the clipboard: a clip that was never pasted goes
        // (attachment-service.js)
      }
      resolve(result);
    };
  });
  let focused = false;
  overlay.on('focus', () => {
    focused = true;
  });
  overlay.on('blur', () => {
    if (focused) session?.finish?.(null);
  });
  overlay.on('closed', () => session?.overlay === overlay && session.finish(null));
  overlay.webContents.once('did-finish-load', () => {
    // A JPEG of the frozen frame is only for display; the crop comes from the full-quality capture
    // above.
    overlay.webContents.send(
      'snapshot:image',
      'data:image/jpeg;base64,' + image.toJPEG(90).toString('base64')
    );
  });
  overlay.once('ready-to-show', () => {
    // Set the bounds again once shown: a window created on a display with another scale factor can
    // come out mis-sized.
    overlay.setBounds(display.bounds);
    overlay.show();
    overlay.setBounds(display.bounds);
    overlay.focus();
  });

  // Where the snapshot controls open: the pointer's height on this display (0 top to 1 bottom; they
  // open away from it) and the room the taskbar takes at the bottom (they sit above it).
  const bounds = display.bounds,
    py = (screen.getCursorScreenPoint().y - bounds.y) / bounds.height,
    inset = bounds.y + bounds.height - display.workArea.y - display.workArea.height;
  overlay
    .loadFile(path.join(__dirname, 'snapshot-overlay.html'), {
      query: { accent: await accentSoon, py: String(py), inset: String(inset) },
    })

    // a failed load ends the session instead of leaving every later press "busy"
    .catch(() => session?.finish?.(null));
  return done;
}

// The accent picked in the app (data-accent on its page), so the snapshot window, the recording
// frame and the card match it. Read from the app's own window when a snapshot starts; the last one
// read (purple at first) when no window answers within 300 ms.
const ACCENTS = {
  purple: '#1a1433',
  blue: '#141a33',
  teal: '#10222a',
  rose: '#2a1426',
  sunset: '#2a1a14',
  neutral: '#1b1b22',
}; // each accent's solid panel color (src/styles/07-purple-glass.css)
let accent = 'purple';

async function readAccent() {
  try {
    const win = BrowserWindow.getAllWindows().find(
      w => !w.isDestroyed() && w.webContents.getURL().split(/[?#]/)[0].endsWith('/index.html')
    );
    const got =
      win &&
      (await Promise.race([
        win.webContents.executeJavaScript('document.documentElement.dataset.accent'),
        new Promise(resolve => setTimeout(resolve, 300)),
      ]));
    if (Object.hasOwn(ACCENTS, got)) accent = got;
  } catch {}
  return accent;
}

// A clip of the area (snapshot-clip.js). When it is kept, one line naming its video and frames goes
// to the clipboard, and the card confirms it with the first frame.
async function record(display, region) {
  // the overlay has left the screen before the first frame
  await new Promise(r => setTimeout(r, 150));
  const run = clip
    .start(display, region, accent)
    .catch(error => ({ cancelled: true, error: error.message }));
  clipSoon = false;
  const out = await run;
  if (!out.saved) return out;

  // unused until it is pasted in the app (attachment-service.js)
  attachments.hold([out.video, ...out.frames]);
  try {
    await clipboard.writeText(out.text);
  } catch (error) {
    attachments.discard(out.video);
    return { cancelled: true, error: 'clipboard write failed: ' + error.message };
  } // a clip nobody can paste is not kept
  out.file = await copyClip(out.video, out.text);
  shelf.addClip(out.video, out.frames, out.text);
  try {
    attachments.sweep();

    // an earlier clip that was never pasted, and that the clipboard no longer names, is deleted now
  } catch {}
  try {
    confirm(
      display,
      nativeImage.createFromPath(out.frames[0]),
      'Clip copied',
      out.file ? 'Paste it as a video with Ctrl+V' : 'Paste its line with Ctrl+V'
    );
  } catch {}
  return out;
}

// The clip's video on the clipboard as a copied file, together with its text line (Windows keeps
// both in one copy): whatever takes pasted files (a website, a chat app, a folder, the composer)
// gets the video, a terminal or a plain text box gets the line. Electron's clipboard writes no file
// list, so Windows PowerShell does it; the path and the line travel as environment variables, never
// as command text. Resolves false when it could not (other systems, PowerShell missing or slow):
// the line written before it stays.
function copyClip(file, text) {
  if (process.platform !== 'win32' || !file) return Promise.resolve(false);
  const script =
    "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.DataObject; $l = New-Object System.Collections.Specialized.StringCollection; [void]$l.Add($env:TNAI_CLIP_FILE); $d.SetFileDropList($l); $d.SetText($env:TNAI_CLIP_TEXT, 'UnicodeText'); [System.Windows.Forms.Clipboard]::SetDataObject($d, $true)";
  return new Promise(resolve => {
    try {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command', script],
        {
          windowsHide: true,
          timeout: 10000,
          env: { ...process.env, TNAI_CLIP_FILE: file, TNAI_CLIP_TEXT: text },
        },
        error => resolve(!error)
      );
    } catch {
      resolve(false);
    }
  });
}

// "Snapshot copied": a small card at the bottom of that display with a thumbnail of the capture,
// shown without focus and ignoring the mouse, gone after 2 s.
function confirm(
  display,
  cropped,
  label = 'Snapshot copied',
  how = 'Paste it anywhere with Ctrl+V'
) {
  // Thumbnail fits in 220×140 CSS px; rendered at the display's scale factor so it stays sharp.
  // Physical capture px → CSS px via scaleFactor.
  const sf = display.scaleFactor || 1,
    size = cropped?.getSize(),
    fit = size ? Math.min(1, 220 / (size.width / sf), 140 / (size.height / sf)) : 0;
  const tw = size ? Math.max(1, Math.round((size.width / sf) * fit)) : 0,
    th = size ? Math.max(1, Math.round((size.height / sf) * fit)) : 0;
  const thumb = size
    ? cropped
        .resize({
          width: Math.max(1, Math.round(tw * sf)),
          height: Math.max(1, Math.round(th * sf)),
          quality: 'good',
        })
        .toDataURL()
    : '';
  const width = Math.max(240, tw + 48),
    height = thumb ? th + 100 : 68,
    area = display.workArea;
  const pill = new BrowserWindow({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + area.height - height - 28),
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
    },
  });
  pill.setIgnoreMouseEvents(true);
  pill.setAlwaysOnTop(true, 'screen-saver');
  pill.webContents.on('will-navigate', event => event.preventDefault());
  const img = thumb ? `<img src="${thumb}" width="${tw}" height="${th}" alt="">` : '';
  const html =
    '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}body{display:grid;place-items:center;font:13px/1.4 system-ui,"Segoe UI",sans-serif}div{display:grid;justify-items:center;gap:2px;background:' +
    ACCENTS[accent] +
    ';color:#eee9ff;padding:12px 16px;border-radius:18px;box-shadow:0 0 0 1px rgba(214,196,255,.16)}img{display:block;margin-bottom:6px;border-radius:10px;background:#fff}small{color:#8e85ab;font-size:12px}</style><body><div>' +
    img +
    '<span>' +
    label +
    '</span><small>' +
    how +
    '</small></div>';
  pill.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  pill.once('ready-to-show', () => pill.showInactive());
  setTimeout(
    () => {
      if (!pill.isDestroyed()) pill.destroy();
    },
    thumb ? 2000 : 1400
  );
}

module.exports = {
  init,
  start,
  setShortcut,
  copyClip,
  readAccent,
  state: () => state,
  overlay: () => session?.overlay || null,
  ready: () => !!session?.ready,
  clip: () => clipping,
  clipFrame: () => clip.frame(),
  stopClip: () => clip.stop(),
};
