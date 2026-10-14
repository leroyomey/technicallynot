// Technically Not tools · desktop-check/tests/no-agents-page.main.js — main-process side of
// no-agents-page.js: the window size (from thread-helpers.main.js), and three things pushed to
// the window on the app's own channels, as the main process pushes them: a folder-trust question,
// a stuck-loop notice for the bell, and a press on a Windows notification ("go to this agent").
// No CLI runs and no prompt is sent.
'use strict';
const threadHelpers = require('./thread-helpers.main.js');

module.exports = win => ({
  ...threadHelpers(win),

  ask(ask) {
    win.webContents.send('trust:ask', ask);
    return true;
  },

  done(id) {
    win.webContents.send('trust:done', { id });
    return true;
  },

  // { id, paneId, on, since, at, repeats, period, tools } as desktop/agent-loops.js pushes it
  loop(loop) {
    win.webContents.send('agent:loop', loop);
    return true;
  },

  jump(paneId) {
    win.webContents.send('attention:jump', { paneId });
    return true;
  },
});
