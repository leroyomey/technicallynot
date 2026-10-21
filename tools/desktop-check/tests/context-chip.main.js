// Technically Not tools · desktop-check/tests/context-chip.main.js — Main-process side of
// context-chip.js (loaded by run.js): sets the window's content size, so the chip is looked at at
// every window size the app supports.
'use strict';

module.exports = win => ({
  size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    return win.getContentBounds();
  },
});
