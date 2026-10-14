// Technically Not tools · desktop-check/tests/focus-rings.main.js — main-process side of
// focus-rings.js. A test window is never the active window (it must not take the keyboard from
// the user), and a page in a window that is not active matches no :focus rule, so no ring is ever
// drawn and the test would see nothing. This asks the browser to treat the page as focused, which
// changes only what the page's styles match: the window itself is not focused, raised or shown.
'use strict';

module.exports = win => ({
  async actFocused(on) {
    // The command needs the debugger attached ("No target available" otherwise). The app's
    // desktop/preview-emulation.js usually attached it already; attach it here when not.
    const tools = win.webContents.debugger;
    if (!tools.isAttached()) tools.attach('1.3');
    await tools.sendCommand('Emulation.setFocusEmulationEnabled', {
      enabled: !!on,
    });
    return true;
  },
});
