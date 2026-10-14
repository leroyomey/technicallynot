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

  // The test window keeps drawing while the user's own windows cover it: with background throttling
  // on (the app's setting) a covered window counts as hidden, and the Details part rightly waits to
  // draw until it shows, so a check right after mounting found it empty (seen 2026-10-14 when the
  // test ran after waiting in line). Only this test's window; it is never shown or focused here.
  awake() {
    win.webContents.setBackgroundThrottling(false);
    return true;
  },
});
