// Technically Not tools · desktop-check/tests/real-draft-keys.main.js — Main-process side of
// real-draft-keys: attention-service's draft state for a pane.
'use strict';
module.exports = () => {
  // the same module instance main.js uses
  const attention = require('../../../desktop/attention-service');
  return {
    draft: paneId => attention.hasDraft(paneId),
    clear: paneId => attention.inputEmpty(paneId),
  }; // clear: the count back to empty between cases
};
