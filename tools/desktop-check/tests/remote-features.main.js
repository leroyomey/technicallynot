// Technically Not tools · desktop-check/tests/remote-features.main.js — main-process side of
// remote-features.js: everything thread-remote.main.js has (a made-up state pushed as the remote
// service would push it, the spy on what the window asks, the window size, the held conversation),
// plus what `remote:feature` answers for another computer's Changes, skills and CLIs, made up and
// labeled so. Nothing is paired and nothing is sent anywhere; the window is never focused or shown.
'use strict';
const threadRemote = require('./thread-remote.main.js');

module.exports = win => ({
  ...threadRemote(win),

  // held: { changes, skills, clis } as remote-features.js holds them ({ state, at, value } each,
  // or null). Every ask is counted by kind in `featureAsks`.
  featureStub(held) {
    const { ipcMain } = require('electron');
    module.exports.featureAsks = {};
    ipcMain.removeHandler('remote:askFeature');
    ipcMain.handle('remote:askFeature', (event, computerId, kind) => {
      module.exports.featureAsks[kind] = (module.exports.featureAsks[kind] || 0) + 1;
      return { ok: true, value: { state: 'asked' } };
    });
    ipcMain.removeHandler('remote:feature');
    ipcMain.handle('remote:feature', (event, computerId, kind) => ({
      ok: true,
      value: (held && held[kind]) || null,
    }));
    return true;
  },
  featureAsks: () => module.exports.featureAsks || {},
});
