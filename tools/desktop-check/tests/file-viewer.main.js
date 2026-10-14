// Technically Not tools · desktop-check/tests/file-viewer.main.js — Main-process side of the
// file-viewer test: lists pop-out windows and fetches what they are served; the default-app opener
// is replaced so the test never launches apps on this PC.
'use strict';
const { BrowserWindow, session, shell } = require('electron');

module.exports = win => {
  const opened = [],
    shown = [];
  shell.openPath = async full => {
    opened.push(full);
    return '';
  };
  shell.showItemInFolder = full => {
    shown.push(full);
  };
  const popouts = () => BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed());

  // The file itself: the view under the window's own title bar page (file-viewer.js, frameless), or
  // the window's page on macOS.
  const fileContents = w =>
    w.contentView?.children?.find(v => v.webContents)?.webContents || w.webContents;
  return {
    windows: () =>
      popouts().map(w => ({
        title: w.getTitle(),
        url: fileContents(w).getURL(),
        js: fileContents(w).getLastWebPreferences?.()?.javascript,
      })),
    served: async url => {
      const r = await session.fromPartition('tnai-file-viewer').fetch(url);
      const body = Buffer.from(await r.arrayBuffer());
      return {
        status: r.status,
        type: r.headers.get('content-type'),
        length: body.length,
        tail: body.subarray(-20).toString('utf8'),
      };
    },
    shot: async (match, name) => {
      const w = popouts().find(x => new RegExp(match).test(x.getTitle()));
      if (!w) return false;
      const img = await fileContents(w).capturePage();
      const out = require('path').join(__dirname, '..', '..', 'browser-check', 'out');
      require('fs').mkdirSync(out, { recursive: true });
      require('fs').writeFileSync(
        require('path').join(out, 'desktop-' + name + '.png'),
        img.toPNG()
      );
      return true;
    },
    closeAll: () => {
      popouts().forEach(w => w.close());
      return true;
    },
    // The window's own top row (frameless on Windows and Linux): a real click on one of its
    // buttons, and what the window did.
    press: async (match, act) => {
      const w = popouts().find(x => new RegExp(match).test(x.getTitle()));
      if (!w || w.webContents === fileContents(w)) return false;
      return w.webContents.executeJavaScript(
        '(() => { const b = document.querySelector(\'button[data-act="' +
          act +
          '"]\'); if (!b) return false; b.click(); return true; })()'
      );
    },
    // The same button pressed with real mouse events at its middle, and a picture of the top row: a
    // click must land on the button, not only run its handler.
    click: async (match, act) => {
      const w = popouts().find(x => new RegExp(match).test(x.getTitle()));
      if (!w || w.webContents === fileContents(w)) return false;
      const r = await w.webContents.executeJavaScript(
        '(() => { const b = document.querySelector(\'button[data-act="' +
          act +
          '"]\'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; })()'
      );
      if (!r || !r.w || !r.h) return r || false;

      // the file's view covers the bar page from here down
      r.fileTop = w.contentView.children.find(v => v.webContents)?.getBounds().y;
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp'])
        w.webContents.sendInputEvent({ type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
      return r;
    },
    barShot: async (match, name) => {
      const w = popouts().find(x => new RegExp(match).test(x.getTitle()));
      if (!w) return false;
      const img = await w.webContents.capturePage();
      const out = require('path').join(__dirname, '..', '..', 'browser-check', 'out');
      require('fs').writeFileSync(
        require('path').join(out, 'desktop-' + name + '.png'),
        img.toPNG()
      );
      return { size: img.getSize(), content: w.getContentSize(), bounds: w.getBounds() };
    },
    state: match => {
      const w = popouts().find(x => new RegExp(match).test(x.getTitle()));
      return w
        ? {
            open: true,
            min: w.isMinimized(),
            max: w.isMaximized(),
            bar: w.webContents !== fileContents(w),
            title: w.getTitle(),
          }
        : { open: false };
    },
    opened: () => ({ opened, shown }),
  };
};
