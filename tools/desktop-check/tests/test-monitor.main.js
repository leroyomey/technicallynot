// Technically Not tools · desktop-check/tests/test-monitor.main.js — main-process side of
// test-monitor.js: which monitor the test window opened on, and which one is the main (primary).
'use strict';
const { screen } = require('electron');

module.exports = win => ({
  where: () => {
    const bounds = win.getBounds();
    const on = screen.getDisplayMatching(bounds);
    const main = screen.getPrimaryDisplay();
    return { window: on.bounds, main: main.bounds, apart: on.id !== main.id };
  },
});
