/*
 * Technically Not tools · desktop-check/tests/held-typing.main.js — Main-process side of
 * held-typing.js: puts text in a panel's draft (as if typed there) and holds a `tnai send` message
 * for it (attention-service holdIfDraft), then cancels it and clears the draft.
 */
'use strict';
const attention = require('../../../desktop/attention-service');

module.exports = () => ({
  hold(paneId) {
    attention.typed(paneId, 'my own prompt');
    const r = attention.holdIfDraft(paneId, {
      text: 'hello from a test agent',
      from: 'Claude Code · Tester',
    });
    return r?.heldId || '';
  },
  cleanup(paneId, heldId) {
    attention.cancelHeld(heldId);
    attention.typed(paneId, '\x03');
    return true;
  },
});
