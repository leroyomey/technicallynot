// Technically Not tools · desktop-check/tests/cli-screen-scroll-jump.main.js — Main-process side of
// cli-screen-scroll-jump.js (loaded by run.js): real mouse-wheel notches through Chromium's input
// pipeline (webContents.sendInputEvent), so both xterm's own scroller and Technically Not's wheel
// handler see them as they would a real mouse.
'use strict';

module.exports = win => ({
  // One notch per call: wheelTicksY +1 = wheel up (towards older output), -1 = down.
  wheel(x, y, ticks) {
    win.webContents.sendInputEvent({
      type: 'mouseWheel',
      x: Math.round(x),
      y: Math.round(y),
      deltaX: 0,
      deltaY: ticks * 100,
      wheelTicksX: 0,
      wheelTicksY: ticks,
      canScroll: true,
    });
    return true;
  },
  move(x, y) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x), y: Math.round(y) });
    return true;
  },
  setSize(w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    return win.getContentBounds();
  },
});
