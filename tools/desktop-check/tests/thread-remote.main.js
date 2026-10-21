// Technically Not tools · desktop-check/tests/thread-remote.main.js — main-process side of
// thread-remote.js: everything remote-agents.main.js has (a made-up state pushed as the remote
// service would push it, a made-up live-view picture, the recorded starts, and a record of what
// the window asks the remote service), plus the window size for the pictures. Nothing is paired
// and nothing is sent anywhere; the window is never focused or shown by this file.
'use strict';
const remoteAgents = require('./remote-agents.main.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => ({
  ...remoteAgents(win),

  // Late join: what `remote:log` answers (a made-up held conversation, or null) and what
  // `remote:askLog` answers; every ask is counted in `asks`. Nothing is paired or sent.
  logStub(held, askState = 'asked') {
    const { ipcMain } = require('electron');
    module.exports.asks = 0;
    ipcMain.removeHandler('remote:log');
    ipcMain.handle('remote:log', () => ({ ok: true, value: held || null }));
    ipcMain.removeHandler('remote:askLog');
    ipcMain.handle('remote:askLog', () => {
      module.exports.asks++;
      return { ok: true, value: { state: askState } };
    });
    return true;
  },
  logAsks: () => module.exports.asks || 0,

  async size(width, height) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await sleep(450);
    return win.getContentSize();
  },
});
