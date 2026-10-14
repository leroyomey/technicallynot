/*
 * Technically Not tools · desktop-check/tests/real-intervene.main.js — Main-process side of
 * real-intervene: reads attention-service's draft state for a pane, and records what the app
 * counted as typed into a pane (attention.typed) and what was written to its terminal (pty-service
 * write), with times.
 */
'use strict';
module.exports = () => {
  const attention = require('../../../desktop/attention-service'),
    ptys = require('../../../desktop/pty-service'); // the same module instances main.js uses
  const typed = [],
    written = [];
  const t0 = attention.typed,
    w0 = ptys.write;
  attention.typed = (paneId, data) => {
    typed.push({ paneId, at: Date.now(), data: String(data ?? '') });
    return t0(paneId, data);
  };
  ptys.write = (paneId, data) => {
    written.push({ paneId, at: Date.now(), data: String(data ?? '') });
    return w0.call(ptys, paneId, data);
  };
  return {
    draft: paneId => attention.hasDraft(paneId),
    typed: paneId => typed.filter(x => x.paneId === paneId).map(x => x.data.slice(0, 60)),
    written: (paneId, since) =>
      written
        .filter(x => x.paneId === paneId && x.at >= since)
        .map(x => '+' + (x.at - since) + 'ms ' + x.data.slice(0, 50)),
  };
};
