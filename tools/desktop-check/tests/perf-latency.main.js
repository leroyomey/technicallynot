/*
 * Technically Not tools · desktop-check/tests/perf-latency.main.js — Main-process side of
 * perf-latency.js: gives the page the keyboard inside the app (never OS focus) and timestamps
 * the terminal round trip in the main process: when a key's pty:write arrives, and when output
 * carrying a given text leaves as pty:data (so the renderer can split window → main → shell → main
 * → window). Times are Date.now() in ms.
 */
'use strict';
const { ipcMain } = require('electron');

module.exports = win => {
  const writes = [],
    outs = [],
    resizes = [];
  ipcMain.on('pty:resize', (_e, paneId, cols, rows) => {
    resizes.push({ paneId, cols, rows, t: Date.now() });
    if (resizes.length > 200) resizes.shift();
  });
  ipcMain.on('pty:write', (_e, paneId, data) => {
    writes.push({ paneId, data: String(data), t: Date.now() });
    if (writes.length > 200) writes.shift();
  });
  const send = win.webContents.send.bind(win.webContents);
  win.webContents.send = (channel, ...args) => {
    if (channel === 'pty:data') {
      const t = Date.now();
      for (const b of [].concat(args[0] || []))
        outs.push({ paneId: b.paneId, data: String(b.data), t });
      if (outs.length > 400) outs.splice(0, outs.length - 400);
    }
    return send(channel, ...args);
  };
  return {
    // The page gets the keyboard inside the app only: the window itself is never focused, so
    // a run does not take the keyboard from the person at the PC.
    async focus() {
      win.webContents.focus();
      await new Promise(r => setTimeout(r, 150));
      return win.isFocused();
    },
    now: () => Date.now(),
    resizes: from => resizes.filter(r => r.t >= from).map(r => ({ ...r, t: r.t - from })),
    // The first write of `text` into the panel at/after `from`, and the first output after that
    // write that contains `echo`.
    trip(paneId, text, echo, from) {
      const w = writes.find(x => x.t >= from && x.paneId === paneId && x.data.includes(text));
      const o = w && outs.find(x => x.t >= w.t && x.paneId === paneId && x.data.includes(echo));
      return { write: w?.t || 0, out: o?.t || 0 };
    },
  };
};
