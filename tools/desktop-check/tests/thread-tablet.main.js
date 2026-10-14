// Technically Not tools · desktop-check/tests/thread-tablet.main.js — the main-process half of
// the thread-tablet test: it sizes the test window and switches touch on and off, so a page reads
// `(pointer: coarse)` the way it does on a tablet. The window is never focused by this file; a
// minimized one is brought back inactive before a size (see `size`).
'use strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => {
  const send = async (method, params) => {
    const tools = win.webContents.debugger;
    if (!tools.isAttached()) tools.attach('1.3');
    return tools.sendCommand(method, params);
  };

  return {
    // The test window keeps drawing while the user's own windows cover it: with background
    // throttling on (the app's setting) a covered or minimized window drew no frames, took no new
    // size and its terminal never refit, so every state failed as "wider than its box" (seen twice
    // on 2026-10-14, the page 1515 by 947 at every size). Only this test's window; it is never
    // focused here.
    awake() {
      win.webContents.setBackgroundThrottling(false);
      return true;
    },

    // what the window is to the system, for the line that says a size was not taken
    state: () =>
      [
        win.isMinimized() ? 'minimized' : 'not minimized',
        win.isVisible() ? 'shown' : 'hidden',
        win.getContentSize().join('×'),
      ].join(', '),

    // A window minimized from outside takes no size (three runs in a row once), so this test brings
    // it back: showInactive restores it without taking the keyboard, so it may appear over other
    // windows but never takes anyone's typing.
    async size(width, height) {
      if (win.isMinimized() || !win.isVisible()) {
        win.showInactive();
        await sleep(300);
      }
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(width, height);
      await sleep(450);
      return win.getContentSize();
    },

    // Touch as the first way of pointing: the page's own media queries see a tablet. Mouse moves
    // are NOT turned into touches (`Emulation.setEmitTouchEventsForMouse`): that draws a round
    // finger cursor over the test window, on the user's own screen, and the test only reads sizes.
    async touch(on) {
      await send('Emulation.setTouchEmulationEnabled', { enabled: !!on, maxTouchPoints: 5 });
      await sleep(250);
      return true;
    },
  };
};
