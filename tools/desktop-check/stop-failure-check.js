/*
 * Technically Not tools · desktop-check/stop-failure-check.js — Plain node check (no Electron, no
 * CLI, no usage): Claude Code's StopFailure hook (an API error such as a usage limit ended the
 * turn) ends the pane's turn in desktop/agent-turns.js with endedBy 'error', no answer, and without
 * starting the prompts that waited; Stop still starts them. Run: node
 * tools/desktop-check/stop-failure-check.js
 */
'use strict';
const turns = require('../../desktop/agent-turns');
const pushed = [];
turns.init((channel, payload) => pushed.push({ channel, payload }));
let failed = 0;
const check = (name, ok) => {
  console.log((ok ? 'ok   ' : 'FAIL ') + name);
  if (!ok) failed++;
};
const hook = (pane, event, extra = {}) =>
  turns.claudeHook(pane, { hook_event_name: event, session_id: 's-' + pane, ...extra });
const last = pane =>
  [...pushed].reverse().find(p => p.channel === 'agent:turn' && p.payload.paneId === pane)?.payload;

// Usage limit: a task with a queued prompt ends on StopFailure; the queued prompt doesn't start.
hook('p1', 'UserPromptSubmit', { prompt: 'build the thing' });
hook('p1', 'UserPromptSubmit', { prompt: 'and then this' });
check('task runs before the failure', turns.busy('p1'));
hook('p1', 'StopFailure', {
  error: 'rate_limit',
  last_assistant_message: 'You have hit your usage limit',
});
check('StopFailure ends the turn', !turns.busy('p1'));
check(
  'ended by error, no answer',
  last('p1')?.endedBy === 'error' &&
    last('p1')?.result === '' &&
    last('p1')?.task === 'build the thing'
);

// Control: Stop still ends the turn and starts the waiting prompt as the next task.
hook('p2', 'UserPromptSubmit', { prompt: 'first' });
hook('p2', 'UserPromptSubmit', { prompt: 'second' });
hook('p2', 'Stop', { last_assistant_message: 'done' });
check('Stop starts the waiting prompt', turns.busy('p2') && last('p2')?.task === 'second');

// agent-loops resets on StopFailure like Stop (no throw), and the hook settings subscribe to it.
require('../../desktop/agent-loops').hook('p1', { hook_event_name: 'StopFailure' });
check(
  'hook settings subscribe to StopFailure',
  /StopFailure: on\(\)/.test(
    require('fs').readFileSync(
      require('path').join(__dirname, '../../desktop/agent-hooks.js'),
      'utf8'
    )
  )
);

turns.forget('p1');
turns.forget('p2');
console.log(failed ? failed + ' failed' : 'all ok');
process.exit(failed ? 1 : 0);
