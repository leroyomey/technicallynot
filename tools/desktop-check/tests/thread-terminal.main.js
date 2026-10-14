// Technically Not tools · desktop-check/tests/thread-terminal.main.js — the main-process half of
// the thread-terminal test: it sizes the test window, so the Terminal page's top row can be
// measured at 1440 and at 1280 wide.
'use strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => ({
  async size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await sleep(450);
    return win.getContentSize();
  },
});
