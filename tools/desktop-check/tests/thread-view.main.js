// Technically Not tools · desktop-check/tests/thread-view.main.js — main-process side of
// thread-view.js: sizes the real test window (lowering the window minimum first, the way a Windows
// Snap half or quarter would need) so the thread layout can be measured in low and narrow windows.
// It never focuses, shows or moves the window.
'use strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => ({
  minimum: () => win.getMinimumSize(),
  content: () => win.getContentSize(),
  setMinimum(width, height) {
    win.setMinimumSize(width, height);
    return win.getMinimumSize();
  },
  async size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await sleep(450);
    return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
  },
});
