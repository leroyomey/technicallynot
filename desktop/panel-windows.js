// Technically Not desktop · panel-windows.js — Pop-out windows: a panel (the Live preview page's
// preview, tnai-panel-<id>) or the composer (38, tnai-composer). Technically Not's own window may
// open an empty same-origin child under one of those names (about:blank) and move live UI into it,
// so terminals stay on the same pty and nothing runs twice. Same preload and security settings as
// the main window; anything else asked of window.open is refused. Any pop-out can be kept on top
// (setOnTop); a panel window can be sized to its content (size, Live preview device).
'use strict';
const { screen } = require('electron');
const NAME = /^tnai-(panel-[\w-]{1,80}|composer)$/;
const open = new Map(); // frame name -> child BrowserWindow
const frameless = process.platform !== 'darwin';

// A frameless window's bounds include Windows' invisible resize border, and Electron reads
// window.open's left/width as its content: a pop-out saved at its outer bounds (screenX /
// outerWidth) came back 16 px wider and 8 px further left each time. The asked-for bounds are
// applied as outer bounds when the window opens (secure).
const asked = new Map(); // frame name -> { left, top, width, height } from window.open's features

// { x, y, w, h }: Electron bounds minus the page's screenX/screenY/outerWidth/outerHeight, measured
// on the first pop-out
let border = null;

// setWindowOpenHandler result for a pop-out request, or null when the request is anything else.
function allow({ url, frameName, features }, preload) {
  if (url !== 'about:blank' || !NAME.test(frameName || '')) return null;
  const want = {};
  for (const [, k, v] of String(features || '').matchAll(
    /(?:^|,)\s*(left|top|width|height)\s*=\s*(-?\d+)/g
  ))
    want[k] = +v;
  asked.set(frameName, want);
  const composer = frameName === 'tnai-composer';
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      minWidth: 360,
      minHeight: composer ? 130 : 240,
      title: 'Technically Not',
      backgroundColor: '#0f0a1f',
      autoHideMenuBar: true,
      // No OS title bar: like the main window, the pop-out's own top row
      // carries Technically Not's window buttons (66 attach, control below).
      ...(frameless ? { titleBarStyle: 'hidden' } : {}),
      ...(composer ? { maximizable: false, fullscreenable: false } : {}),
      webPreferences: {
        preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    },
  };
}

// A pop-out never loads anything: it stays the empty document Technically Not fills. It shows at
// the main window's zoom, and a remembered position that is no longer on any screen (monitor
// unplugged) is moved back next to Technically Not.
function secure(child, parent, frameName) {
  const contents = child.webContents;
  contents.on('will-navigate', event => event.preventDefault());
  const zoom = () => {
    if (!parent.isDestroyed() && !contents.isDestroyed())
      contents.setZoomFactor(parent.webContents.getZoomFactor());
  };
  contents.on('did-finish-load', zoom);
  zoom();
  const want = frameName && asked.get(frameName);
  if (frameName) asked.delete(frameName);

  // The page's screenX/outerWidth (what pop-outs save and window.open gets back) include the
  // invisible border, Electron's bounds don't: the asked-for bounds are applied through that
  // difference, so a window reopens exactly where and as wide as it was. It is measured once (the
  // first pop-out corrects itself a moment after it opens), then applied as each window opens.
  const through = d =>
    child.setBounds({
      x: want.left != null ? want.left + d.x : child.getBounds().x,
      y: want.top != null ? want.top + d.y : child.getBounds().y,
      width: want.width != null ? want.width + d.w : child.getBounds().width,
      height: want.height != null ? want.height + d.h : child.getBounds().height,
    });
  if (frameless && want && Object.keys(want).length) {
    if (border) through(border);
    else
      contents
        .executeJavaScript('[screenX, screenY, outerWidth, outerHeight]')
        .then(([sx, sy, ow, oh]) => {
          if (child.isDestroyed() || child.isMaximized()) return;
          const c = child.getBounds();
          border = { x: c.x - sx, y: c.y - sy, w: c.width - ow, h: c.height - oh };
          through(border);
        })
        .catch(() => {});
  }
  const b = child.getBounds();
  const onScreen = screen
    .getAllDisplays()
    .some(
      ({ workArea: a }) =>
        b.x < a.x + a.width - 40 &&
        a.x < b.x + b.width - 40 &&
        b.y >= a.y - 8 &&
        b.y < a.y + a.height - 40
    );
  if (!onScreen) child.center();
  if (frameName) {
    open.set(frameName, child);
    child.on('closed', () => {
      if (open.get(frameName) === child) open.delete(frameName);
    });
  }
}

// Always on top, for any open pop-out (IPC panel:onTop from the main window).
function setOnTop(frameName, on) {
  const child = NAME.test(frameName || '') ? open.get(frameName) : null;
  if (!child || child.isDestroyed()) return false;

  // Windows: level 'normal' keeps it plainly topmost. Electron's default ('floating') also moves it
  // behind the taskbar, and while the taskbar is not topmost (a fullscreen window elsewhere)
  // Windows then drops the window's topmost state, so On top failed at random.
  child.setAlwaysOnTop(!!on, process.platform === 'win32' ? 'normal' : 'floating');
  return child.isAlwaysOnTop() === !!on;
}

// Composer window sized to its content: width/height are the CSS px its content needs (scaled by
// the window's zoom). The width is a minimum (the user may widen it); the height is exactly the
// content's, locked (no dead space below the composer), and follows the content as it grows or
// shrinks.
function fit(frameName, width, height) {
  const child = frameName === 'tnai-composer' ? open.get(frameName) : null;
  if (!child || child.isDestroyed() || !(width > 0) || !(height > 0)) return null;
  if (child.isMaximized()) child.unmaximize();
  const zoom = child.webContents.getZoomFactor(),
    [ow, oh] = child.getSize(),
    [cw, ch] = child.getContentSize();
  const minW = Math.ceil(width * zoom) + (ow - cw),
    minH = Math.ceil(height * zoom) + (oh - ch);
  child.setMinimumSize(minW, minH);
  child.setMaximumSize(0, minH); // 0: no width limit
  const w = Math.max(ow, minW),
    h = minH;
  if (w !== ow || h !== oh) child.setSize(w, h);
  return child.getBounds();
}

// A panel window sized to its content (Live preview: the device at 100% plus the panel's own bars),
// in CSS px scaled by the window's zoom, shrunk to fit the screen it is on and moved back inside
// it. Returns the content bounds, or null.
function size(frameName, width, height) {
  const child = /^tnai-panel-/.test(frameName) ? open.get(frameName) : null;
  if (!child || child.isDestroyed() || !(width > 0) || !(height > 0)) return null;
  if (child.isMaximized()) child.unmaximize();
  const zoom = child.webContents.getZoomFactor(),
    [ow, oh] = child.getSize(),
    [cw, ch] = child.getContentSize();
  const area = screen.getDisplayMatching(child.getBounds()).workArea;
  const w = Math.min(Math.ceil(width * zoom), area.width - (ow - cw)),
    h = Math.min(Math.ceil(height * zoom), area.height - (oh - ch));
  child.setContentSize(w, h);
  const b = child.getBounds();
  child.setPosition(
    Math.max(area.x, Math.min(b.x, area.x + area.width - b.width)),
    Math.max(area.y, Math.min(b.y, area.y + area.height - b.height))
  );
  return child.getContentBounds();
}

// The pop-out's own window buttons (66 attach): minimize, maximize/restore, close; 'state' says
// what it can do and whether it is maximized.
function control(frameName, action) {
  const child = NAME.test(frameName || '') ? open.get(frameName) : null;
  if (!child || child.isDestroyed() || process.platform === 'darwin') return null;
  if (action === 'minimize' && child.isMinimizable()) child.minimize();
  else if (action === 'maximize' && child.isMaximizable())
    child.isMaximized() ? child.unmaximize() : child.maximize();
  else if (action === 'close') {
    child.close();
    return { closed: true };
  } else if (action !== 'state') return null;
  return {
    maximized: child.isMaximized(),
    maximizable: child.isMaximizable(),
    minimizable: child.isMinimizable(),
  };
}

module.exports = { allow, secure, setOnTop, fit, size, control };
