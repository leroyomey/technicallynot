// Technically Not tools · desktop-check/tests/thread-details.main.js — main-process side of
// thread-details.js: it sizes the test window (and says the smallest size the app allows), and
// pushes a message to the window on a channel the app's own main process uses (a turn with queued
// prompts, held prompts, an agent event), so the details part is fed the way it is in real use.
// Nothing here sends a prompt to an agent.
'use strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => ({
  minimum: () => win.getMinimumSize(),
  async size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await sleep(450);
    return win.getContentSize();
  },
  emit(channel, payload) {
    win.webContents.send(channel, payload);
    return true;
  },
});
