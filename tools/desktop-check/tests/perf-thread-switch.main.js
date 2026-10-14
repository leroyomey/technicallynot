// Technically Not tools · desktop-check/tests/perf-thread-switch.main.js — main-process side of
// perf-thread-switch.js: the same helpers as thread-helpers.main.js (a made-up Claude Code
// transcript written where the app looks for a panel's session, and the window's size), plus
// what the window is to the system, for the test's "is it drawing" line.
'use strict';

const threadHelpers = require('./thread-helpers.main.js');

module.exports = win => {
  // A window the user's own windows cover counts as hidden to its page while background
  // throttling is on (the app's own setting, desktop/main.js), and its animation frames stop:
  // the timings then waited forever (a 405 s timeout, 2026-10-14). Only this test's window, only
  // while the test runs. The window is never restored, shown or focused here.
  win.webContents.setBackgroundThrottling(false);
  return {
    ...threadHelpers(win),
    state: () =>
      [
        win.isMinimized() ? 'minimized' : 'not minimized',
        win.isVisible() ? 'shown' : 'hidden',
        win.isFocused() ? 'focused' : 'not focused',
        win.getContentSize().join(' x '),
      ].join(', '),
  };
};
