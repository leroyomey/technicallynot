/*
 * Technically Not tools · desktop-check/tests/plan-lock-startup.main.js — Main-process side of
 * plan-lock-startup: turns the plan lock on (throwaway profile = signed out, so the app is locked
 * from its first IPC call) and records every console error the page logs while it starts under the
 * lock (not Chromium's benign "ResizeObserver loop" notice).
 */
'use strict';
module.exports = win => {
  process.env.TNAI_ENFORCE_PLAN = '1';
  delete process.env.TNAI_DEV_UNLOCK;

  // The app ships with no accounts server (package.json `tnaiAccountsUrl` is empty), and without
  // one the lock is never enforced. The lock code is still there, so this test gives it an address
  // on this PC where nothing listens: a signed-out start needs no answer from it.
  process.env.TNAI_ACCOUNTS_URL = 'http://127.0.0.1:9';

  // drop the unlocked state computed before this file ran
  require('../../../desktop/user-auth')._test.restart();
  const errors = [];
  win.webContents.on('console-message', e => {
    if (e.level === 'error' && !/^ResizeObserver loop/.test(e.message))
      errors.push(e.message + ' @ ' + e.sourceId + ':' + e.lineNumber);
  });
  return {
    errors: () => errors.splice(0),
    unlock: () => {
      process.env.TNAI_ENFORCE_PLAN = '0';
      return true;
    },
  };
};
