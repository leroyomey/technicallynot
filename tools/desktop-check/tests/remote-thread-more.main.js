// Technically Not tools · desktop-check/tests/remote-thread-more.main.js — main-process side of
// remote-thread-more.js (plan item 44): everything remote-agents.main.js has (a made-up state
// pushed as the remote service would push it), plus stand-ins for the thread controls' channels
// that write down every call and answer as the real service would. Nothing is paired and nothing
// is sent anywhere; the window is never focused or shown by this file.
'use strict';
const remoteAgents = require('./remote-agents.main.js');

module.exports = win => {
  const base = remoteAgents(win);
  const asked = [];
  return {
    ...base,

    // remote:thread, remote:resume, remote:askPast, remote:past, remote:askLog, remote:log:
    // each call is written down; `past` and `log` answer what the test says.
    stubs(pastHeld, logHeld) {
      const { ipcMain } = require('electron');
      const answer = (channel, value) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, ...args) => {
          asked.push({ ch: channel, args });
          return { ok: true, value: typeof value === 'function' ? value(...args) : value };
        });
      };
      answer('remote:thread', () => ({ sent: 'asked', n: '0123456789abcdef' }));
      answer('remote:resume', () => ({ sent: 'asked', n: 'fedcba9876543210' }));
      answer('remote:askPast', { state: 'asked' });
      answer('remote:past', pastHeld || null);
      answer('remote:askLog', { state: 'asked' });
      answer('remote:log', logHeld || null);
      return true;
    },
    asked: () => asked,
  };
};
