/*
 * Technically Not tools · desktop-check/tests/plan-lapse.main.js — Main-process side of
 * plan-lapse.js: the fake accounts server of plan-lock.main.js (reused as is), a short
 * PowerShell-panel notice (TNAI_LAPSE_SHELL_MS), and a fake Claude Code turn driven through
 * Technically Not's real hook server (no CLI runs): UserPromptSubmit starts the turn, a
 * PermissionRequest is held open until the window answers it, Stop ends the turn.
 */
'use strict';
const hooks = require('../../../desktop/agent-hooks.js');
const turns = require('../../../desktop/agent-turns.js');

module.exports = win => {
  process.env.TNAI_LAPSE_SHELL_MS = '4000';
  const lock = require('./plan-lock.main.js')(win);
  const T = require('../../../desktop/user-auth')._test;
  let url = '',
    asked = null;
  const post = body =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.text());
  return {
    ...lock,
    focus: () => {
      T.focus();
      return true;
    },
    version: () => T.version(),
    async turnStart(paneId) {
      await hooks.launchOptions(paneId, 'Claude Code');
      url = hooks.endpoint(paneId).hook;
      await post({ hook_event_name: 'UserPromptSubmit', prompt: 'Edit src/app.js' });
      return turns.busy(paneId);
    },
    busy: paneId => turns.busy(paneId),
    // The hook stays open until the window answers the card (or 590 s pass): kept here, read back
    // by askReply.
    ask: () => {
      asked = post({
        hook_event_name: 'PermissionRequest',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/app.js' },
      });
      return true;
    },
    askReply: async () => {
      const t = await Promise.race([asked, new Promise(r => setTimeout(() => r('timeout'), 5000))]);
      return t;
    },
    async turnStop(paneId) {
      await post({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
      return turns.busy(paneId);
    },
  };
};
