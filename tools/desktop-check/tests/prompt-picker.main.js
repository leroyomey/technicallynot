// Technically Not tools · desktop-check/tests/prompt-picker.main.js — main-process side of
// prompt-picker.js: it sizes the test window. Nothing here sends a prompt.
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
