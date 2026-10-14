// Technically Not tools · desktop-check/tests/cli-screen-regrow-duplicate.main.js — Main-process
// side of cli-screen-regrow-duplicate.js (loaded by run.js): hands the test a saved panel log to
// replay, only when TNAI_REGROW_LOG names one (userData\scrollback\<paneId>.log).
'use strict';
const fs = require('fs');

module.exports = () => ({
  log() {
    const f = process.env.TNAI_REGROW_LOG;
    try {
      return f ? fs.readFileSync(f, 'utf8') : '';
    } catch {
      return '';
    }
  },
  // The rows the terminal holds after the replay, next to the log (<log>.rows.txt), to read where a
  // repeat is left.
  rows(text) {
    const f = process.env.TNAI_REGROW_LOG;
    if (!f) return '';
    fs.writeFileSync(f + '.rows.txt', String(text));
    return f + '.rows.txt';
  },
});
