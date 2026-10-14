/*
 * Technically Not tools · desktop-check/tests/agent-talk.main.js — Main-process helper for
 * agent-talk.js: pushes mesh-in / mesh-out events on the real agent:event channel, as
 * desktop/agent-mesh.js does through the hooks note.
 */
'use strict';

module.exports = win => ({
  emit(e) {
    win.webContents.send('agent:event', e);
    return true;
  },
});
