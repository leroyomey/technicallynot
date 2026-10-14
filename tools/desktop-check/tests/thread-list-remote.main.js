// Technically Not tools · desktop-check/tests/thread-list-remote.main.js — the main-process half
// of the thread-list-remote test. It sizes the test window, hands the window one state as the
// remote service would push it (made up by the test; nothing is paired and nothing is sent
// anywhere), and writes down what the window asks the remote service, handing each call on
// unchanged. The window is never focused or shown by this file.
'use strict';

const { ipcMain } = require('electron');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const WATCHED = ['remote:view', 'remote:unview', 'remote:prompt', 'remote:act'];

module.exports = win => {
  const calls = [];
  let spied = null;

  return {
    async size(width, height) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(width, height);
      await sleep(450);
      return win.getContentSize();
    },

    show(state) {
      win.webContents.send('remote:change', state);
      return true;
    },

    // The channels that are written down from now on.
    spy() {
      if (spied) return spied;
      spied = [];
      for (const channel of WATCHED) {
        const own = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get(channel);
        if (typeof own !== 'function') continue;
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (event, ...args) => {
          calls.push(channel);
          return own(event, ...args);
        });
        spied.push(channel);
      }
      return spied;
    },

    calls: () => calls.slice(),
  };
};
