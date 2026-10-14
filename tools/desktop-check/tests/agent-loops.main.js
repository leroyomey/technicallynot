/*
 * Technically Not tools · desktop-check/tests/agent-loops.main.js — Main-process side of
 * agent-loops.js: plays Claude Code hook payloads over HTTP to the real desktop/agent-hooks.js
 * server (which feeds the real desktop/agent-loops.js), on a test clock that moves 20 s per tool
 * call so minutes pass at once. No CLI runs and no prompt is sent (no usage).
 */
'use strict';
const http = require('http');

module.exports = () => {
  const hooks = require('../../../desktop/agent-hooks');
  let clock = Date.now();

  // the clock only; pushes still go to the window
  require('../../../desktop/agent-loops').init(null, { now: () => clock });
  const post = (url, body) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        res => {
          res.resume();
          res.on('end', resolve);
        }
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  let n = 0;
  return {
    // calls: [[tool, input, result]] each as PreToolUse + PostToolUse, 20 s apart on the test
    // clock.
    async play(paneId, calls, prompt) {
      await hooks.launchOptions(paneId, 'Claude Code');
      const url = hooks.endpoint(paneId).hook,
        base = { session_id: 'agent-loops-test', cwd: process.cwd() };
      if (prompt) await post(url, { ...base, hook_event_name: 'UserPromptSubmit', prompt });
      for (const [tool, input, result] of calls) {
        clock += 20000;
        const id = 'toolu_' + ++n;
        await post(url, {
          ...base,
          hook_event_name: 'PreToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: id,
        });
        await post(url, {
          ...base,
          hook_event_name: 'PostToolUse',
          tool_name: tool,
          tool_input: input,
          tool_use_id: id,
          tool_response: result,
        });
      }
      return true;
    },
    done(paneId) {
      hooks.forget(paneId);
      require('../../../desktop/agent-loops').init(null, { now: Date.now });
      return true;
    },
  };
};
