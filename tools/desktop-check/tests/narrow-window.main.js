// Technically Not tools · desktop-check/tests/narrow-window.main.js — Main-process side of
// narrow-window.js: sets the window's content size and the page zoom (the app's own, or full
// scale).
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = win => ({
  // The test window keeps drawing whatever happens to it. With background throttling on (the app's
  // own setting, desktop/main.js) a minimized or hidden window counts as hidden to its page and its
  // animations stand still, and the audit then reads half-faded labels as cut. Only this test's
  // window, only while the test runs; the app is not changed. Returns what the window was before.
  awake() {
    const was = this.state();
    win.webContents.setBackgroundThrottling(false);
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.showInactive();
    return was;
  },
  minimum: () => win.getMinimumSize(),
  only: () => process.env.TNAI_FIT_ONLY || '',
  // What the window is to the system, for the test's "are frames drawn" line.
  state: () =>
    [
      win.isMinimized() ? 'minimized' : 'not minimized',
      win.isVisible() ? 'shown' : 'hidden',
      win.isFocused() ? 'focused' : 'not focused',
      win.getBounds().width + '×' + win.getBounds().height,
    ].join(', '),
  setMinimum(w, h) {
    win.setMinimumSize(w, h);
    return win.getMinimumSize();
  },
  // zoom: null keeps the factor main.js picks on resize; a number (1 = the website demo) overrides
  // it until the next resize.
  async size(w, h, zoom = null) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    await sleep(450);
    if (zoom) {
      win.webContents.setZoomFactor(zoom);
      await sleep(300);
    }
    return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
  },
});
