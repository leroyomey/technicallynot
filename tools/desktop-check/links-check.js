/*
 * Technically Not tools · desktop-check/links-check.js — Waits and links between agents that
 * message each other (desktop/agent-links.js) in plain Node: a question makes a wait and an answer
 * ends it and links the two; a finished task without an answer tells the waiter once (never for a
 * task that began before the question arrived, never twice in a row); a closed panel tells the
 * waiter; rings of waits are found; links end by themselves (both at rest, a new task from the
 * user, quiet, panel closed); waits expire. Run: node tools/desktop-check/links-check.js (~0.1 s).
 */
'use strict';
const links = require('../../desktop/agent-links');
const T = links._test,
  { WAIT_MS, QUIET_MS, REST_MS, NOTICE_GAP_MS } = T.TIMES;

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
let clock = 1e6,
  told = [],
  why = [],
  changes = 0;
const fresh = () => {
  T.reset();
  clock = 1e6;
  told = [];
  why = [];
  changes = 0;
  T.clock(() => clock);
};
const start = (paneId, task = '') => links.turn({ paneId, startedAt: clock, endedAt: 0, task });
const end = (paneId, endedBy = 'stop') =>
  links.turn({ paneId, startedAt: clock - 1, endedAt: clock, endedBy });
const later = ms => {
  clock += ms;
  T.expire();
};
links.init({
  changed: () => changes++,
  notify: (waiter, kind, target, reason) => {
    told.push(waiter + ':' + kind + ':' + target);
    why.push(reason);
  },
});

fresh();
links.sent('A', 'B', { text: 'Here is the file list. No reply needed.' });
check(!links.of('A').waitsOn.length, 'a message with no question makes no wait');
links.sent('A', 'B', { text: 'Which file do you take? No reply needed.' });
check(!links.of('A').waitsOn.length, '"no reply needed" makes no wait even with a question mark');
links.sent('A', 'B', { text: 'Which file do you take?' });
check(
  links.of('A').waitsOn.join() === 'B' && !links.of('B').waitsOn.length,
  'a question makes A wait on B, not B on A'
);
check(
  !links.of('A').with.length,
  'one message each way is needed before they count as working together'
);
check(changes > 0, 'the UI is told about the change');
links.sent('B', 'A', { text: 'I take main.js.' });
check(!links.of('A').waitsOn.length, 'the answer ends the wait');
check(
  links.of('A').with.join() === 'B' && links.of('B').with.join() === 'A',
  'a message and its answer link the two'
);
check(!told.length, 'an answered question tells nobody anything');

fresh();
links.sent('A', 'B', { ask: true, text: 'status' });
check(links.of('A').waitsOn.join() === 'B', '`tnai ask` always makes a wait');
start('B');
end('B');
check(
  told.join() === 'A:ended:B' && !links.of('A').waitsOn.length,
  'B finished the task it read the question in without answering: A is told once and no longer waits'
);
check(why[0] === '', 'a normal finish gives the notice no reason');
for (const by of ['interrupted', 'aborted', 'error', 'exit']) {
  fresh();
  links.sent('A', 'B', { ask: true, text: 'status' });
  start('B');
  end('B', by);
  check(
    told.join() === 'A:ended:B' && why[0] === by,
    'a task that ended by "' + by + '" tells A why no answer came'
  );
}
fresh();
links.sent('A', 'B', { ask: true, text: 'status' });
start('B');
end('B');
links.sent('A', 'B', { ask: true, text: 'status again' });
start('B');
end('B');
check(
  told.length === 1 && !links.of('A').waitsOn.length,
  'a second unanswered question soon after ends quietly: two agents cannot wake each other in a loop'
);
later(NOTICE_GAP_MS + 1);
links.sent('A', 'B', { ask: true, text: 'status' });
start('B');
end('B');
check(told.length === 2, 'after the gap A is told again');

fresh();
start('B');
links.sent('A', 'B', { text: 'Can you check this?', delivered: false });
end('B');
check(
  !told.length && links.of('A').waitsOn.join() === 'B',
  'B ended a task that began before the question reached it: A still waits and is not told'
);
links.delivered('A', 'B', true);
start('B');
end('B');
check(told.join() === 'A:ended:B', 'the task after delivery ending without an answer tells A');
fresh();
links.sent('A', 'B', { text: 'Can you check this?', delivered: false });
links.delivered('A', 'B', false);
check(
  !links.of('A').waitsOn.length && !told.length,
  'a queued question that was dropped leaves no wait'
);

fresh();
start('B');
clock += 2000;
links.sent('A', 'B', { ask: true, text: 'q' });
end('B');
check(
  told.join() === 'A:ended:B',
  'delivery reported a moment after the task that reads it began (a CLI confirms a prompt by starting): that task counts'
);
fresh();
start('B');
clock += T.TIMES.ARM_MS + 1;
links.sent('A', 'B', { ask: true, text: 'q' });
end('B');
check(
  !told.length && links.of('A').waitsOn.join() === 'B',
  'a question typed into a task long under way is not tied to that task'
);
fresh();
links.sent('A', 'B', { text: 'ok?', delivered: false });
start('B');
clock += 1000;
links.delivered('A', 'B', true);
end('B');
check(
  told.join() === 'A:ended:B',
  'a queued question confirmed just after its task began is tied to that task'
);

fresh();
links.sent('A', 'B', { ask: true, text: 'q' });
links.gone('B');
check(
  told.join() === 'A:gone:B' && !links.of('A').waitsOn.length,
  "B's panel closed: A is told no answer is coming"
);
fresh();
links.sent('A', 'B', { ask: true, text: 'q' });
links.gone('A');
check(
  !told.length && !links.state().waits.length,
  'the waiting panel closed: its wait is dropped and nobody is told'
);

fresh();
check(
  !links.sent('A', 'B', { ask: true, text: 'q' }).ring.length,
  'a first question closes no ring'
);
const two = links.sent('B', 'A', { text: 'What about you?' });
check(
  !two.ring.length && links.of('B').waitsOn.join() === 'A' && !links.of('A').waitsOn.length,
  'a question sent back is the answer and a new wait the other way, not a ring'
);
fresh();
links.sent('A', 'B', { ask: true, text: 'q' });
links.sent('B', 'C', { ask: true, text: 'q' });
const three = links.sent('C', 'A', { ask: true, text: 'q' });
check(
  three.ring.join() === 'A,B' && links.of('A').ring && links.of('B').ring && links.of('C').ring,
  'A waits on B, B on C, C on A: the ring is found and the sender hears who is in it'
);
links.sent('A', 'C', { text: 'answer' });
check(!links.of('A').ring && !links.of('C').ring, 'one answer breaks the ring');

fresh();
links.sent('A', 'B', { text: 'take a.js' });
links.sent('B', 'A', { text: 'ok, done' });
start('A');
later(REST_MS + 1);
check(links.of('B').with.join() === 'A', 'the link stays while one of them works');
end('A');
later(REST_MS - 1000);
check(links.of('A').with.join() === 'B', 'both at rest: the link stays for a moment');
start('B', '[from Claude Code · A] one more thing');
later(REST_MS + 1);
check(links.of('A').with.join() === 'B', 'a task that came from the other agent keeps the link');
end('B');
later(REST_MS + 1);
check(
  !links.of('A').with.length && !links.of('B').with.length,
  'both at rest for the rest time: the link ends by itself'
);

fresh();
links.sent('A', 'B', { text: 'x' });
links.sent('B', 'A', { text: 'y' });
start('A', '[TN.ai] build the settings page');
check(!links.of('B').with.length, "a new task from the user ends that agent's links");
fresh();
links.sent('A', 'B', { text: 'x' });
links.sent('B', 'A', { text: 'y' });
start('A', 'now fix the login page');
check(
  !links.of('B').with.length,
  "a prompt the user typed straight into the terminal ends that agent's links too"
);
for (const task of [
  '',
  '[from Technically Not] main.js changed on disk.',
  '[TN.ai] [from Technically Not] note',
  '[TN.ai] Task from Lead: build it',
  '[TN.ai] New task from Lead (related to your earlier work): x',
  '[TN.ai] Follow-up from Lead: x',
  '[TN.ai] Revived for a related task from Lead: x',
  '[TN.ai] Sub-agent Scout (id 12345678) finished "look": done',
  'You are "Scout", a sub-agent that Lead started in Technically Not.',
  '<task-notification><summary>done</summary></task-notification>',
  '[TN.ai] Your context is at 150k tokens, so',
  '[TN.ai] The user attached the skill "x" to you',
  '/compact',
  '[TN.ai] You asked for /compact, so Technically Not will run /compact in this session',
  '[TN.ai] Technically Not hands your work to a fresh Codex agent right after this reply.',
  '[TN.ai] /clear has run in this session. Before it you wrote down what must survive',
  '[TN.ai handoff: you take over from Lead (Claude Code), which the user handed off]',
  '[TN.ai auto-continue 1/3] Continue with the next step you recommended',
  'Your usage limit has reset. Continue the task you were working on when the limit was reached',
]) {
  fresh();
  links.sent('A', 'B', { text: 'x' });
  links.sent('B', 'A', { text: 'y' });
  start('A', task);
  check(
    links.of('B').with.join() === 'A',
    "not the user's new task, the link stays: " + (task.slice(0, 44) || '(empty task)')
  );
}
fresh();
links.sent('A', 'B', { text: 'x' });
links.sent('B', 'A', { text: 'and you?' });
start('A', '[TN.ai] something else');
check(
  links.of('A').with.join() === 'B' || links.of('B').waitsOn.join() === 'A',
  'but not while a question between them is open'
);

fresh();
links.sent('A', 'B', { text: 'x' });
links.sent('B', 'A', { text: 'y' });
start('A');
start('B');
later(QUIET_MS + 1);
check(
  !links.of('A').with.length,
  'no message between two working agents for the quiet time: the link ends'
);
fresh();
links.sent('A', 'B', { text: 'x' });
links.sent('B', 'A', { text: 'y' });
links.gone('B');
check(!links.of('A').with.length, 'a closed panel ends its links');
fresh();
links.sent('A', 'B', { ask: true, text: 'q' });
later(WAIT_MS + 1);
check(
  !links.of('A').waitsOn.length && !told.length,
  'a wait that never resolves expires without a prompt'
);
fresh();
links.sent('A', 'B', { text: 'x' });
later(QUIET_MS + 1);
links.sent('B', 'A', { text: 'y' });
check(!links.of('A').with.length, 'a reply long after the first message is not an exchange');
links.sent('A', 'A', { ask: true, text: 'q' });
check(!links.of('A').waitsOn.length, 'an agent never waits on itself');

// A hand-over: the retiring agent's questions and links go to its successor, and its closing panel
// tells nobody an answer is lost.
fresh();
links.sent('A', 'B', { ask: true, text: 'q' });
links.sent('C', 'A', { ask: true, text: 'q' });
links.sent('A', 'D', { text: 'x' });
links.sent('D', 'A', { text: 'y' });
check(
  links.waiting('A', 'B') && !links.waiting('B', 'A'),
  'waiting(a, b) is true only for the one that asked'
);
links.moved('A', 'N');
links.gone('A');
check(
  links.of('N').waitsOn.join() === 'B' && links.of('C').waitsOn.join() === 'N',
  'the successor now waits on B, and C waits on the successor'
);
check(
  links.of('N').with.join() === 'D' && links.of('D').with.join() === 'N',
  'its link moved to the successor'
);
check(!told.length, 'the old panel closing tells nobody that an answer is lost');
start('N');
end('N');
check(
  told.join() === 'C:ended:N',
  'the successor finishing its own task without answering tells the one that asked'
);
fresh();
links.sent('A', 'N', { ask: true, text: 'take over?' });
links.sent('N', 'A', { text: 'yes' });
links.sent('A', 'N', { ask: true, text: 'ready?' });
links.moved('A', 'N');
check(
  !links.of('N').waitsOn.length && !links.of('N').with.length && !links.state().waits.length,
  'nothing pairs the successor with itself'
);

// A truthful clear (agent-turns.js `clearedAt`): the cleared agent's own waits end silently, a
// question already typed into it ends and its asker is told once, a held one stays, links end.
fresh();
links.sent('A', 'B', { ask: true, text: 'which file?' });
links.sent('C', 'A', { ask: true, text: 'done yet?' });
links.sent('D', 'A', { ask: true, text: 'later?', delivered: false });
links.sent('A', 'E', { text: 'x' });
links.sent('E', 'A', { text: 'y' });
const clearedTurn = { paneId: 'A', startedAt: clock, endedAt: 0, task: 'new work', clearedAt: 5 };
links.turn(clearedTurn);
check(!links.of('A').waitsOn.length, "a cleared agent's own question no longer waits");
check(!links.of('C').waitsOn.length, 'a question typed into the cleared agent ends');
check(links.of('D').waitsOn.join() === 'A', 'a question still held for it stays');
check(!links.of('E').with.length, "the cleared agent's links end");
check(
  told.join() === 'C:ended:A' && why.join() === 'cleared',
  'only the asker of a typed-in question is told, with the reason "cleared"'
);
links.sent('C', 'A', { ask: true, text: 'again?' });
links.turn(clearedTurn);
check(
  links.of('C').waitsOn.join() === 'A' && told.length === 1,
  'the same clear seen again in later turn events does nothing'
);
fresh();
links.sent('C', 'A', { ask: true, text: 'done yet?' });
links.turn({ paneId: 'A', startedAt: clock, endedAt: 0, task: 'new work', clearedAt: 0 });
check(links.of('C').waitsOn.join() === 'A', 'a task without a clear keeps the waits');

// Claude Code's record of a clear (agent-turns.js claudeClearedIn): the new session file's own
// "/clear" command line, at or after the panel's last task began; a resumed or forked session has
// none of its own.
{
  const fs = require('fs'),
    os = require('os'),
    path = require('path');
  const { claudeClearedIn } = require('../../desktop/agent-turns')._test;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-links-clear-'));
  const write = (name, lines) => {
    const file = path.join(folder, name);
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    return file;
  };
  const clearLine = when => ({
    type: 'user',
    isSidechain: false,
    message: {
      role: 'user',
      content: '<command-name>/clear</command-name>\n  <command-message>clear</command-message>',
    },
    timestamp: new Date(when).toISOString(),
  });
  const prompt = (text, when) => ({
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: new Date(when).toISOString(),
  });
  const since = Date.parse('2026-10-15T10:00:00Z');
  const fresh = write('cleared.jsonl', [
    { type: 'mode', mode: 'normal' },
    clearLine(since + 5000),
    prompt('next task', since + 9000),
  ]);
  const resumed = write('resumed.jsonl', [clearLine(since - 86400e3), prompt('old', since - 1)]);
  const plain = write('plain.jsonl', [prompt('see /clear and <command-name>/clear', since + 1)]);
  check(claudeClearedIn(fresh, since) === since + 5000, 'a new session that opens with /clear');
  check(claudeClearedIn(resumed, since) === 0, 'a resumed session cleared long ago is no clear');
  check(claudeClearedIn(plain, since) === 0, 'a prompt that only mentions /clear is no clear');
  check(claudeClearedIn(path.join(folder, 'none.jsonl'), since) === 0, 'a missing file: 0');
  fs.rmSync(folder, { recursive: true, force: true });
}

T.reset();
console.log(ok ? '\nPASS links-check' : '\nFAIL links-check');
process.exit(ok ? 0 : 1);
