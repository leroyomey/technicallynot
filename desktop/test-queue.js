/*
 * Technically Not desktop · test-queue.js — `tnai test` (agent-shim.js runs the tests,
 * agent-mesh.js grants the turn): one agent's test run at a time on this computer, first come first
 * served, so several agents' tests never load the PC at once. The turn is held by the shim's open
 * connection: it ends when the run ends, is interrupted or its panel closes.
 */
'use strict';

let running = null; // { paneId, name, project, since, socket }
const queue = []; // { paneId, name, project, socket, grant }

function next() {
  while (!running && queue.length) {
    const q = queue.shift();
    if (q.socket.destroyed) continue;
    running = {
      paneId: q.paneId,
      name: q.name,
      project: q.project,
      since: Date.now(),
      socket: q.socket,
    };
    const mine = running;
    q.socket.once('close', () => {
      if (running === mine) {
        running = null;
        next();
      }
    });
    q.grant();
  }
}

// Resolves when it is this caller's turn: { waited (s), after: names that ran first }, or null when
// its command ended while waiting.
function turn(paneId, name, project, socket) {
  const asked = Date.now(),
    ahead = [running?.name, ...queue.map(q => q.name)].filter(Boolean);
  return new Promise(resolve => {
    const q = {
      paneId,
      name,
      project,
      socket,
      grant: () =>
        resolve({ waited: Math.round((Date.now() - asked) / 1000), after: [...new Set(ahead)] }),
    };
    socket.once('close', () => {
      const i = queue.indexOf(q);
      if (i >= 0) {
        queue.splice(i, 1);
        resolve(null);
      }
    });
    queue.push(q);
    next();
  });
}

module.exports = { turn };
