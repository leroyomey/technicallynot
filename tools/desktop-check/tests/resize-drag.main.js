// Technically Not tools · desktop-check/tests/resize-drag.main.js — Main-process side of
// resize-drag.js: drags the window's size in small steps like a hand on its edge (a resize event
// per step), reports the zoom main.js picked and how often it changed, counts the sizes sent to
// each pty, and reuses idle-work.main.js's CPU profile of the window by function.
'use strict';
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = win => {
  const work = require('./idle-work.main.js')(win);

  // Sizes sent to each pty since the last takeResizes() (pty-service's resize is the one path the
  // page's pty:resize takes).
  const ptys = require('../../../desktop/pty-service'),
    counts = {},
    real = ptys.resize;
  ptys.resize = (paneId, cols, rows) => {
    counts[paneId] = (counts[paneId] || 0) + 1;
    return real.call(ptys, paneId, cols, rows);
  };
  return {
    takeResizes() {
      const out = Object.values(counts);
      for (const k of Object.keys(counts)) delete counts[k];
      return out;
    },
    profileStart: work.profileStart,
    profileStop: work.profileStop,
    size(w, h) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(w, h);
      return win.getContentSize();
    },
    // `steps` sizes ~16 ms apart from one size to the other; returns how many times the zoom factor
    // changed on the way.
    async drag(fromW, fromH, toW, toH, steps) {
      let zoom = win.webContents.getZoomFactor(),
        changes = 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        win.setContentSize(
          Math.round(fromW + (toW - fromW) * t),
          Math.round(fromH + (toH - fromH) * t)
        );
        await sleep(16);
        const z = win.webContents.getZoomFactor();
        if (z !== zoom) {
          zoom = z;
          changes++;
        }
      }
      return { content: win.getContentSize(), zoom, changes };
    },
  };
};
