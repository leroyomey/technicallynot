// Technically Not tools · desktop-check/tests/remote-typing.main.js — main-process side of
// remote-typing.js: everything thread-remote.main.js has (a made-up state pushed as the remote
// service would push it, a made-up live-view model, the spy on what the window asks, the window
// size), plus stand-ins for the typing calls (`remote:type`, `remote:typePaste`, `remote:typeEnd`)
// that write down what the window sent and answer as the real service would. Nothing is paired and
// nothing is sent anywhere; the window is never focused or shown by this file.
'use strict';
const threadRemote = require('./thread-remote.main.js');

module.exports = win => ({
  ...threadRemote(win),

  // answer: the state each `remote:type` and `remote:typePaste` answers ('sending' by default).
  typeStub(answer = 'sending') {
    const { ipcMain } = require('electron');
    module.exports.typed = [];
    for (const ch of ['remote:type', 'remote:typePaste', 'remote:typeEnd']) {
      ipcMain.removeHandler(ch);
      ipcMain.handle(ch, (event, ...args) => {
        module.exports.typed.push({ ch, args });
        return { ok: true, value: ch === 'remote:typeEnd' ? true : { state: answer } };
      });
    }
    return true;
  },
  typed: () => module.exports.typed || [],
});
