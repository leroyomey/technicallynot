// Technically Not tools · desktop-check/tests/cli-screen-size-bounce.main.js — Main-process side of
// cli-screen-size-bounce.js (loaded by run.js): agent-mesh.main.js's fake `claude` on PATH (never
// the real CLI, no credits), and a record of every size sent to a pty.
'use strict';
const ptys = require('../../../desktop/pty-service');

module.exports = (win, profile) => {
  const mesh = require('./agent-mesh.main.js')(win, profile);
  const real = ptys.resize,
    calls = [];
  ptys.resize = (paneId, cols, rows) => {
    calls.push({ paneId, size: cols + 'x' + rows });
    return real(paneId, cols, rows);
  };
  return {
    ...mesh,
    // The sizes sent to this panel's pty since the last clear(), in order.
    resizes: paneId => calls.filter(c => c.paneId === paneId).map(c => c.size),
    clear() {
      calls.length = 0;
      return true;
    },
  };
};
