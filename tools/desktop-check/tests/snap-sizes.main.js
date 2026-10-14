// Technically Not tools · desktop-check/tests/snap-sizes.main.js — Main-process side of
// snap-sizes.js: reads the window minimum, lowers it the way a Windows Snap half/quarter would
// need, sets the content size (instantly, or in animated steps like a snap), and reports the zoom
// factor main.js picked.
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = win => ({
  minimum: () => win.getMinimumSize(),
  // $env:TNAI_SNAP_ONLY='animated' skips the fixed sizes (quick reruns of the refit rounds).
  only: () => process.env.TNAI_SNAP_ONLY || '',
  setMinimum(w, h) {
    win.setMinimumSize(w, h);
    return win.getMinimumSize();
  },
  async size(w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    await sleep(450);
    return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
  },
  // A snap animates the window between sizes; resize events arrive every frame. `steps` sizes ~16
  // ms apart.
  async animate(fromW, fromH, toW, toH, steps = 14, settle = 450) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      win.setContentSize(
        Math.round(fromW + (toW - fromW) * t),
        Math.round(fromH + (toH - fromH) * t)
      );
      await sleep(16);
    }
    await sleep(settle);
    return { content: win.getContentSize(), zoom: win.webContents.getZoomFactor() };
  },
});
