// Technically Not tools · desktop-check/tests/thread-collapse.main.js — the main-process half of
// the thread-collapse, thread-side and thread-ground tests: it sizes the test window and sends one
// real key press with its modifier keys. The window is never focused or shown by this file.
'use strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => ({
  async size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await sleep(450);
    return win.getContentSize();
  },

  // A real key, as the keyboard would send it: keyCode is Electron's name ("Left", "Right", "B").
  async key(keyCode, modifiers) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: modifiers || [] });
    await sleep(30);
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: modifiers || [] });
    await sleep(120);
    return true;
  },
});
