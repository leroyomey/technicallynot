/*
 * Technically Not tools · desktop-check/loop-check.js — Logic check of desktop/agent-loops.js in
 * plain Node (no Electron, no CLI): normal work that repeats reads and screenshots stays quiet, a
 * real loop gives exactly one notice, and it clears when the agent moves on, its turn ends or a new
 * task comes. ~0 s. Run: node tools/desktop-check/loop-check.js
 */
'use strict';
const loops = require('../../desktop/agent-loops');
let clock = 1e12,
  pushes = [],
  ok = true;
loops.init(
  (ch, p) => {
    if (ch === 'agent:loop') pushes.push(p);
  },
  { now: () => clock }
);
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
let n = 0;

// One finished call: Pre then Post (result), `gap` seconds after the previous one. result === null:
// it failed (no PostToolUse).
function call(pane, tool, input, result, gap = 20, agentId) {
  clock += gap * 1000;
  const id = 't' + ++n,
    base = {
      tool_name: tool,
      tool_input: input,
      tool_use_id: id,
      ...(agentId ? { agent_id: agentId } : {}),
    };
  loops.hook(pane, { hook_event_name: 'PreToolUse', ...base });
  if (result !== null)
    loops.hook(pane, { hook_event_name: 'PostToolUse', ...base, tool_response: result });
}
const shot = { action: 'screenshot', tabId: 7 },
  CHROME = 'mcp__claude-in-chrome__computer';
const ons = () => pushes.filter(p => p.on),
  offs = () => pushes.filter(p => !p.on);

// 1. Long real browser work: 40 screenshots of a page that changes between them, clicks and scrolls
// at different places, re-reading one file.
loops.hook('A', { hook_event_name: 'UserPromptSubmit', prompt: 'list the app on directories' });
for (let i = 0; i < 40; i++) {
  call('A', CHROME, shot, [{ type: 'image', data: 'page-' + i }]);
  call(
    'A',
    CHROME,
    { action: 'scroll', coordinate: [600, 400], scroll_direction: 'down' },
    'Scrolled'
  );
  if (i % 5 === 0)
    call(
      'A',
      'Read',
      { file_path: 'advertising/copy/directory-listings.txt' },
      { content: 'kit v' + Math.floor(i / 10) }
    );
}
check(!pushes.length, 'long browser session with a changing page: no notice');

// Same screenshot 7 times (under 8) over 3 min: quiet.
for (let i = 0; i < 7; i++) call('A', CHROME, shot, [{ type: 'image', data: 'same' }], 30);
check(!pushes.length, '7 identical screenshots with the same result: no notice');

// A quick burst of 10 identical failing calls in 30 s: under the 2-minute span, quiet.
for (let i = 0; i < 10; i++) call('A', 'Bash', { command: 'npm test' }, null, 3);
check(!pushes.length, 'a 30 s retry burst: no notice');

// Waiting on a background task (TaskOutput) 30 times: never a loop.
for (let i = 0; i < 30; i++) call('A', 'TaskOutput', { task_id: 'b1' }, { status: 'running' }, 20);
check(!pushes.length, 'waiting on a background task: no notice');

// 2. A real loop: click the same spot, screenshot shows the same page, again and again (cycle of
// 2), 20 s apart.
loops.hook('B', { hook_event_name: 'UserPromptSubmit', prompt: 'submit the form' });
const click = { action: 'left_click', coordinate: [812, 640] };
for (let i = 0; i < 12; i++) {
  call('B', CHROME, click, 'Clicked');
  call('B', CHROME, shot, [{ type: 'image', data: 'stuck-page' }]);
}
check(
  ons().length === 1 && ons()[0].paneId === 'B' && ons()[0].period === 2 && ons()[0].browser,
  'click + same screenshot cycle: exactly one notice (' + ons().length + ')'
);
check(loops.list().length === 1, 'list() holds the open loop for a reloaded window');
call('B', CHROME, { action: 'navigate', url: 'https://example.com/other' }, 'Navigated');
check(
  offs().length === 1 && offs()[0].id === ons()[0].id && offs()[0].why === 'moved-on',
  'a different step clears it'
);
check(!loops.list().length, 'nothing open after it moved on');

// 3. The same failing command 9 times over 4 min: one notice, flagged failed; the turn ending
// clears it.
pushes = [];
for (let i = 0; i < 9; i++) call('C', 'Bash', { command: 'node build.js' }, null, 30);

// starts after the 9th, which makes the 9th count as failed
call('C', 'Read', { file_path: 'x' }, 'x');
check(
  ons().length === 1 && ons()[0].failed && ons()[0].period === 1 && ons()[0].tools[0] === 'Bash',
  'same failing command: one notice, marked failed'
);
pushes = [];
for (let i = 0; i < 10; i++) call('D', 'Read', { file_path: 'a.js' }, 'same text', 20);
check(ons().length === 1, 'same file read with the same text 10× over 3 min: one notice');
for (let i = 0; i < 6; i++) call('D', 'Read', { file_path: 'a.js' }, 'same text', 20);
check(ons().length === 1, 'still looping: no repeated notice');
loops.hook('D', { hook_event_name: 'Stop' });
check(offs().length === 1 && offs()[0].why === 'turn', 'turn end clears it');

// 4. A sub-agent's loop is its own; a task-notification turn doesn't clear it; SubagentStop does.
pushes = [];
for (let i = 0; i < 9; i++) call('E', 'Grep', { pattern: 'foo' }, 'no matches', 20, 'sub1');
check(ons().length === 1 && ons()[0].agentId === 'sub1', 'sub-agent loop reported with its id');
loops.hook('E', {
  hook_event_name: 'UserPromptSubmit',
  prompt: '<task-notification>done</task-notification>',
});
check(!offs().length, 'a background hand-back is not a new task');
loops.hook('E', { hook_event_name: 'SubagentStop', agent_id: 'sub1' });
check(offs().length === 1, 'sub-agent stop clears it');
loops.forget('B');

// 5. A sub-agent that outgrows a small job: one 'overrun' notice past 20 min or 10 changed files; a
// lead never gets one.
pushes = [];
const over = () => pushes.filter(p => p.on && p.kind === 'overrun');
for (let i = 0; i < 9; i++)
  call('F', 'Edit', { file_path: 'src/f' + i + '.js' }, 'ok' + i, 10, 'sub2');
for (let i = 0; i < 5; i++) call('F', 'Edit', { file_path: 'src/f0.js' }, 'again' + i, 10, 'sub2');
check(!over().length, '9 different files, one of them edited six times, in 2 min: no notice');
call('F', 'Write', { file_path: 'src/f9.js' }, 'ok', 10, 'sub2');
check(
  over().length === 1 &&
    over()[0].wide &&
    !over()[0].long &&
    over()[0].files === 10 &&
    over()[0].agentId === 'sub2',
  '10th different file: one notice, for many files'
);
for (let i = 0; i < 80; i++) call('F', 'Read', { file_path: 'r' + i }, 'text' + i, 20, 'sub2');
check(over().length === 1, 'still running past 20 min: no second notice');
check(
  loops.list().some(l => l.kind === 'overrun'),
  'list() holds the open notice for a reloaded window'
);
loops.hook('F', { hook_event_name: 'SubagentStop', agent_id: 'sub2' });
check(
  pushes.some(p => !p.on && p.id === over()[0].id),
  'sub-agent stop clears it'
);
pushes = [];
for (let i = 0; i < 61; i++) call('G', 'Read', { file_path: 'g' + i }, 'text' + i, 20, 'sub3');
check(
  over().length === 1 && over()[0].long && !over()[0].wide && !pushes.some(p => p.on && !p.kind),
  'a sub-agent 20 min into different reads: one notice, for time, and no loop notice'
);
loops.hook('G', { hook_event_name: 'Stop' });
check(
  pushes.some(p => !p.on && p.why === 'turn'),
  'its lead’s turn ending clears it'
);
pushes = [];
for (let i = 0; i < 100; i++) call('H', 'Edit', { file_path: 'h' + i + '.js' }, 'ok' + i, 20);
check(!pushes.length, 'a lead 33 min in with 100 changed files: no notice');

console.log(ok ? 'loop-check: all passed' : 'loop-check: FAILED');
process.exit(ok ? 0 : 1);
