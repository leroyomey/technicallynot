// Technically Not tools · desktop-check/tests/decision-click-delay.main.js — main-process side of
// decision-click-delay.js: the made-up transcript and the window size (thread-helpers.main.js),
// and the "project context changed" push the app gets when a result is saved or marked, sent
// without saving anything (the window test stands in for the saved results themselves).
'use strict';
const threadHelpers = require('./thread-helpers.main.js');

module.exports = win => ({
  ...threadHelpers(win),

  // What desktop/agent-context.js sends after it saved a result or a mark.
  contextChanged() {
    win.webContents.send('context:changed');
    return true;
  },
});
