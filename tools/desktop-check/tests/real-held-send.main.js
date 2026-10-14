// Technically Not tools · desktop-check/tests/real-held-send.main.js — Main-process side of
// real-held-send: reads attention-service's draft state for a pane.
'use strict';
module.exports = () => {
  // the same module instance main.js uses
  const attention = require('../../../desktop/attention-service');
  return {
    draft: paneId => attention.hasDraft(paneId),
    held: () => attention.list().held.map(h => ({ paneId: h.paneId, waitDraft: h.waitDraft })),
  };
};
