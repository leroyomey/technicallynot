/*
 * Technically Not tools · desktop-check/tests/thread-history.main.js — Main-process side of
 * thread-history.js. Stands in for the two calls of the thread list (`threads:list`,
 * `threads:peek`: the test profile has no saved conversations) with rows the test makes up, counts
 * every call, and records `pty:start` instead of launching anything (no process, no CLI, no
 * credits): a recorded start answers as a started session that holds the conversation it resumed.
 * `installReal` is for the run with --real-project: the test's project is then a copy of this
 * repo in a temp folder, which has no saved conversations of its own, so the app's own reader
 * (desktop/thread-list.js) is pointed at this repo's real folder. It only reads: sizes, times, the
 * first bytes of each file, and the last bytes of one that is looked at. Starts are recorded there
 * too, so nothing can be resumed by mistake. It also sizes the test window for the pictures; the
 * window is never focused or shown by this file.
 */
'use strict';
const path = require('path');
const { ipcMain } = require('electron');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = win => {
  const got = { lists: 0, peeks: [], starts: [] };
  let rows = [];
  let more = false;
  let excerpts = {};
  let fail = false;

  // Every start is written down and answered as started; no process is made.
  function recordStarts() {
    let pid = 930000;
    ipcMain.removeHandler('pty:start');
    ipcMain.handle('pty:start', (_event, options) => {
      got.starts.push(JSON.parse(JSON.stringify(options || {})));
      return {
        ok: true,
        value: {
          paneId: options.paneId,
          agent: options.agent,
          pid: ++pid,
          sessionId: options.resumeId || '',
          resumable: !!options.resumeId,
          cwd: '',
        },
      };
    });
  }

  return {
    async size(width, height) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(width, height);
      await sleep(450);
      return win.getContentSize();
    },

    install(list, peeks, hasMore) {
      rows = Array.isArray(list) ? list : [];
      excerpts = peeks && typeof peeks === 'object' ? peeks : {};
      more = hasMore === true;
      ipcMain.removeHandler('threads:list');
      ipcMain.handle('threads:list', () => {
        got.lists++;
        return fail
          ? { ok: false, error: 'made-up failure', threads: [], more: false }
          : { ok: true, project: 'C:\\made-up', threads: rows, more };
      });
      ipcMain.removeHandler('threads:peek');
      ipcMain.handle('threads:peek', (_event, key) => {
        got.peeks.push(String(key));
        return Object.hasOwn(excerpts, key) ? excerpts[key] : null;
      });
      recordStarts();
      return true;
    },

    // The real past conversations of this repo, read by the app's own reader. Read-only.
    installReal() {
      const repo = path.resolve(__dirname, '..', '..', '..');
      const reader = require(path.join(repo, 'desktop', 'thread-list.js')).createThreadList({
        root: () => repo,
      });
      ipcMain.removeHandler('threads:list');
      ipcMain.handle('threads:list', () => {
        got.lists++;
        return reader.list();
      });
      ipcMain.removeHandler('threads:peek');
      ipcMain.handle('threads:peek', (_event, key) => {
        got.peeks.push('one');
        return reader.peek(String(key || '')).catch(() => null);
      });
      recordStarts();
      return true;
    },
    setRows(list) {
      rows = Array.isArray(list) ? list : [];
      return true;
    },
    setMore(hasMore) {
      more = hasMore === true;
      return true;
    },
    failing(on) {
      fail = on === true;
      return true;
    },
    got: () => got,
  };
};
