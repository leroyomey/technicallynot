// Technically Not tools · desktop-check/tests/window-move-perf.main.js — Main-process side of
// window-move-perf.js: maximizes, restores, minimizes and moves Technically Not's window like the
// user would when carrying it between monitors.
'use strict';
module.exports = win => ({
  setBounds(x, y, w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setBounds({ x, y, width: w, height: h });
    return win.getBounds();
  },
  maximize() {
    win.maximize();
    return win.getBounds();
  },
  unmaximize() {
    win.unmaximize();
    return win.getBounds();
  },
  minimize() {
    win.minimize();
    return true;
  },
  restore() {
    win.restore();
    return win.getBounds();
  },
});
