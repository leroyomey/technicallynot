// Technically Not tools · desktop-check/tests/cli-screen-size-sync.main.js — Main-process side of
// cli-screen-size-sync.js (loaded by run.js): holds the next pty start open for a while, so the
// test can resize the panel inside it.
'use strict';
const ptys = require('../../../desktop/pty-service');

module.exports = () => ({
  // The next start waits ms before it runs (once), and reports the size it was asked for through
  // asked().
  hold(ms) {
    const real = ptys.start;
    this._asked = null;
    ptys.start = async options => {
      ptys.start = real;
      this._asked = { cols: options.cols, rows: options.rows };
      await new Promise(r => setTimeout(r, ms));
      return real(options);
    };
    return true;
  },
  asked() {
    return this._asked || null;
  },
});
