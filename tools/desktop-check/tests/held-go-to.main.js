/*
 * Technically Not tools · desktop-check/tests/held-go-to.main.js — Main-process side of
 * held-go-to.js: puts text in a panel's draft (as if typed there) and holds a `tnai send` message
 * for it, which is what makes the app show its "Prompt held" card; then takes both away again.
 */
'use strict';
const attention = require('../../../desktop/attention-service');

module.exports = () => ({
  hold(paneId) {
    attention.typed(paneId, 'my own prompt');
    const result = attention.holdIfDraft(paneId, {
      text: 'hello from a test agent',
      from: 'Claude Code · Tester',
    });
    return result?.heldId || '';
  },
  cleanup(paneId, heldId) {
    attention.cancelHeld(heldId);
    attention.typed(paneId, '\x03');
    return true;
  },
});
