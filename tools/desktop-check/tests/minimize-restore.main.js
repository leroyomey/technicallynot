// Technically Not tools · desktop-check/tests/minimize-restore.main.js — Main-process side of
// minimize-restore.js: minimizes and restores Technically Not's window like the user would and
// reports its background-throttling setting.
'use strict';
module.exports = win => ({
  throttling: () => win.webContents.getBackgroundThrottling(),
  minimize() {
    win.minimize();
    return true;
  },
  restore() {
    win.restore();
    return !win.isMinimized();
  },
  isMinimized: () => win.isMinimized(),
});
