// Technically Not tools · desktop-check/tests/thread-tablet.main.js — the main-process half of
// the thread-tablet test: it sizes the test window and switches touch on and off, so a page reads
// `(pointer: coarse)` the way it does on a tablet. The window is never focused or shown by this
// file.
'use strict';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => {
  const send = async (method, params) => {
    const tools = win.webContents.debugger;
    if (!tools.isAttached()) tools.attach('1.3');
    return tools.sendCommand(method, params);
  };

  return {
    async size(width, height) {
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
