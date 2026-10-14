/*
 * Technically Not tools · desktop-check/tests/permission-reload.main.js — Main-process side of
 * permission-reload.js: registers hooks for a pane id without a CLI and holds Claude Code-shaped
 * PermissionRequest hooks open across a window reload (one asked before it, one asked while the
 * page is reloading), keeping each reply here.
 */
'use strict';
const hooks = require('../../../desktop/agent-hooks.js');

module.exports = win => {
  const replies = {};
  const ask = (key, url, tool, input) => {
    replies[key] = fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PermissionRequest',
        tool_name: tool,
        tool_input: input,
      }),
    }).then(
      r => r.text(),
      e => 'error: ' + e.message
    );
  };
  return {
    async register(paneId) {
      await hooks.launchOptions(paneId, 'Claude Code');
      return hooks.endpoint(paneId).hook;
    },
    ask(key, url, tool, input) {
      ask(key, url, tool, input);
      return true;
    },
    // Asked the moment the reload starts: the old page is going away and the new one has no
    // listeners yet.
    askOnReload(key, url, tool, input) {
      win.webContents.once('did-start-loading', () => ask(key, url, tool, input));
      return true;
    },
    pending() {
      return hooks.pendingPermissions().map(p => p.detail);
    },
    async reply(key, ms) {
      return Promise.race([
        replies[key],
        new Promise(r => setTimeout(() => r('still waiting'), ms)),
      ]);
    },
  };
};
