// Technically Not tools · desktop-check/tests/trust-ask.main.js — Main-process helpers for
// trust-ask.js: push a folder-trust question (main.js askInPane's trust:ask) or its trust:done to
// the window.
'use strict';
module.exports = win => ({
  ask(ask) {
    win.webContents.send('trust:ask', ask);
    return true;
  },
  done(id) {
    win.webContents.send('trust:done', { id });
    return true;
  },
});
