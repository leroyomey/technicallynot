// Technically Not tools · desktop-check/tests/composer-popout.main.js — Main-process side of
// composer-popout.js (loaded by run.js): counts Technically Not's windows, reports the composer
// window's bounds, security settings and always-on-top state, moves/resizes it like the user would,
// types into it with real input events, and closes it with the title-bar ×.
'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = win => {
  const popouts = () => BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed());
  const first = () => {
    const w = popouts()[0];
    if (!w) throw new Error('no pop-out window');
    return w;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  return {
    count: () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()).length,
    info: () =>
      popouts().map(w => {
        const p = w.webContents.getLastWebPreferences() || {};
        return {
          title: w.getTitle(),
          url: w.webContents.getURL(),
          visible: w.isVisible(),
          bounds: w.getBounds(),
          onTop: w.isAlwaysOnTop(),
          zoom: w.webContents.getZoomFactor(),
          mainZoom: win.webContents.getZoomFactor(),
          contextIsolation: p.contextIsolation,
          sandbox: p.sandbox,
          nodeIntegration: p.nodeIntegration,
        };
      }),
    setBounds(b) {
      first().setBounds(b);
      return first().getBounds();
    },
    // Real keyboard input into the pop-out (its focused element gets it); Enter only when asked.
    async type(text, enter) {
      const w = first();
      w.focus();
      w.webContents.focus();
      await wait(150);
      for (const ch of text) {
        w.webContents.sendInputEvent({ type: 'char', keyCode: ch });
        await wait(8);
      }
      if (enter) {
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        w.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
      }
      return true;
    },
    // A real mouse click at CSS-px coordinates inside the pop-out (scaled by its zoom).
    async click(x, y) {
      const w = first(),
        z = w.webContents.getZoomFactor(),
        at = { x: Math.round(x * z), y: Math.round(y * z) };
      w.focus();
      w.webContents.focus();
      await wait(100);
      w.webContents.sendInputEvent({ type: 'mouseMove', ...at });
      w.webContents.sendInputEvent({ type: 'mouseDown', ...at, button: 'left', clickCount: 1 });
      await wait(30);
      w.webContents.sendInputEvent({ type: 'mouseUp', ...at, button: 'left', clickCount: 1 });
      return true;
    },
    close() {
      first().close();
      return true;
    },
    // Screenshot of the pop-out window itself: tools/browser-check/out/desktop-<name>.png.
    async shot(name) {
      const out = path.resolve(__dirname, '..', '..', 'browser-check', 'out');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(
        path.join(out, 'desktop-' + name + '.png'),
        (await first().webContents.capturePage()).toPNG()
      );
      return true;
    },
    // The runner prints only its tail; the full log also goes to
    // tools/browser-check/out/desktop-composer-popout.log. A localhost page (like a Live preview
    // page) that asks for a tnai-panel-* window and tells its parent what it got; stops after 20 s.
    spoofPage() {
      const page =
        '<script>let w; try { w = window.open("about:blank", "tnai-panel-spoof"); } catch (e) { w = e.message } parent.postMessage(String(w), "*")</script>';
      const server = require('http').createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(page);
      });
      return new Promise(resolve =>
        server.listen(0, '127.0.0.1', () => {
          setTimeout(() => server.close(), 20000).unref();
          resolve('http://127.0.0.1:' + server.address().port + '/');
        })
      );
    },
    report(lines) {
      const out = path.resolve(__dirname, '..', '..', 'browser-check', 'out');
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'desktop-composer-popout.log'), lines.join('\n') + '\n');
      return true;
    },
  };
};
