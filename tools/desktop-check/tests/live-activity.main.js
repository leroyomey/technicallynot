/*
 * Technically Not tools · desktop-check/tests/live-activity.main.js — Main-process side of
 * live-activity.js: agent events go through the real desktop/agent-hooks.js (`note` → emit →
 * `agent:event`, with real sequence numbers); turns and permission prompts are pushed on their real
 * channels. Nothing is launched, no prompt is sent.
 */
'use strict';
const hooks = require('../../../desktop/agent-hooks');
const files = require('../../../desktop/fs-service');

module.exports = win => ({
  root: () => files.root(),
  event(paneId, event) {
    hooks.note(paneId, event);
    return true;
  },
  turn(t) {
    win.webContents.send('agent:turn', t);
    return true;
  },
  permission(p) {
    win.webContents.send('agent:permission', p);
    return true;
  },
});
