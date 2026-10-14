/*
 * Technically Not tools · desktop-check/tests/idle-cost.main.js — Main-process side of
 * idle-cost.js: the app's own CPU use per process kind since the last call (Electron's
 * app.getAppMetrics; percent of one core), and whether the test window is shown and in front.
 */
'use strict';
const { app } = require('electron');

module.exports = win => ({
  // The first call starts a measuring period; each later call returns the average since the call
  // before it.
  cpu() {
    const out = {};
    for (const m of app.getAppMetrics()) {
      const k =
        m.type === 'Tab'
          ? 'window'
          : m.type === 'GPU'
            ? 'graphics'
            : m.type === 'Browser'
              ? 'main'
              : 'other';
      out[k] = Math.round(((out[k] || 0) + (m.cpu?.percentCPUUsage || 0)) * 10) / 10;
    }
    return out;
  },
  state: () => ({
    visible: win.isVisible(),
    focused: win.isFocused(),
    minimized: win.isMinimized(),
  }),
});
