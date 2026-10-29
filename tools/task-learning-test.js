// Technically Not tools · task-learning-test.js — learning from what threads deliver
// (desktop/task-learning.js): the rules say nothing below their minimum number of tasks, find
// heavy conversations, repeated slow commands and where the time went, and a finished task is kept
// with its tokens, its conversation size at the start and its time split, then given back once per
// session with a prompt and every time in `tnai context`.
// Run: node tools/task-learning-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const learning = require('../desktop/task-learning.js');
const { learn, words, median, normalize, HEAVY } = learning.pure;

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const NOW = Date.parse('2026-10-28T12:00:00Z');
const task = (fields, minutesAgo = 10) => ({ at: NOW - minutesAgo * 60000, ms: 60000, ...fields });

// 1. the small helpers
check(median([3, 1, 2]) === 2, 'median of an odd list');
check(median([4, 1, 2, 3]) === 2.5, 'median of an even list');
check(median([]) === 0, 'median of nothing');
check(normalize('  npm   test \n --x ') === 'npm test --x', 'a command is normalized');

// 2. too few tasks: no lesson
{
  const few = [task({ ctxStart: 200000, tokens: 900000 }), task({ ctxStart: 1000, tokens: 50000 })];
  check(learn(few, NOW).length === 0, 'two tasks teach nothing');
}

// 3. heavy conversations cost more: the context lesson, with its numbers
{
  const records = [];
  for (let index = 0; index < 6; index++) {
    records.push(task({ ctxStart: 300000, tokens: 1200000 }));
    records.push(task({ ctxStart: 20000, tokens: 200000 }));
  }
  const lessons = learn(records, NOW);
  const context = lessons.find(lesson => lesson.key === 'context');
  check(!!context, 'heavy tasks found');
  check(context?.heavyMedian === 1200000 && context?.lightMedian === 200000, 'their medians');
  check(context?.tasks === 12, 'the tasks it rests on');
  const text = words(context, 400000);
  check(/400k tokens/.test(text) && /1\.2M/.test(text) && /200k/.test(text), 'said in numbers');
  check(/\/compact/.test(text), 'says what to do');
}

// 4. heavy and light cost the same: no context lesson
{
  const records = [];
  for (let index = 0; index < 6; index++) {
    records.push(task({ ctxStart: 300000, tokens: 210000 }));
    records.push(task({ ctxStart: 20000, tokens: 200000 }));
  }
  check(!learn(records, NOW).some(lesson => lesson.key === 'context'), 'no lesson when equal');
}

// 5. old tasks are left out
{
  const records = [];
  for (let index = 0; index < 6; index++) {
    records.push(task({ ctxStart: 300000, tokens: 1200000 }, 60 * 24 * 60));
    records.push(task({ ctxStart: 20000, tokens: 200000 }, 60 * 24 * 60));
  }
  check(learn(records, NOW).length === 0, 'tasks older than the window teach nothing');
}

// 6. a command that is the slowest step again and again
{
  const slow = ms => ({ kind: 'run', what: 'node tools/desktop-check/check.js  thread', ms });
  const records = [
    task({ slow: [slow(90000)] }),
    task({ slow: [slow(120000)] }),
    task({ slow: [slow(60000)] }),
    task({ slow: [{ kind: 'run', what: 'git status', ms: 1000 }] }),
    task({ slow: [{ kind: 'read', what: 'big.js', ms: 90000 }] }),
  ];
  const lesson = learn(records, NOW).find(item => item.key === 'slow');
  check(lesson?.commands.length === 1, 'one slow command');
  check(lesson?.commands[0].what === 'node tools/desktop-check/check.js thread', 'named');
  check(lesson?.commands[0].median === 90000 && lesson?.commands[0].tasks === 3, 'its numbers');
  check(/1m 30s in 3 tasks \(longest 2m 00s\)/.test(words(lesson)), 'said in time');

  // two runs are not enough
  check(!learn(records.slice(1), NOW).some(item => item.key === 'slow'), 'two runs say nothing');
}

// 7. where the time went
{
  const records = [];
  for (let index = 0; index < 10; index++)
    records.push(task({ parts: { run: 50000, read: 10000, write: 40000 } }));
  const lesson = learn(records, NOW).find(item => item.key === 'share');
  check(lesson?.kind === 'run' && Math.round(lesson.share * 100) === 50, 'commands took half');
  check(/Running commands took 50%/.test(words(lesson)), 'said');

  // the agent's own thinking and writing is not a lesson
  const own = records.map(record => ({ ...record, parts: { write: 90000, read: 10000 } }));
  check(!learn(own, NOW).some(item => item.key === 'share'), 'thinking alone teaches nothing');
}

// 8. the whole path: tasks end, are kept with their tokens and split, and come back
(async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-learning-'));
  const root = path.join(folder, 'project');
  let ends = null;
  let turn = null;
  let pushed = 0;
  learning.init({
    dir: folder,
    settleMs: 5,
    changed: () => pushed++,
    project: () => root,
    turns: {
      onEnd: fn => (ends = fn),
      state: () => (turn ? [turn] : []),
    },
  });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  let clock = NOW;

  // twelve tasks on one pane: the conversation grows, so later ones begin heavy and cost more
  for (let index = 0; index < 12; index++) {
    const context = index < 6 ? 10000 + index * 1000 : 200000 + index * 10000;
    const tokens = index < 7 ? 100000 : 900000;
    turn = {
      paneId: 'p1',
      agent: 'Claude Code',
      startedAt: clock,
      endedAt: clock + 30000,
      tokens: { input: 0, output: 1000, cacheRead: tokens - 1000, cacheWrite: 0 },
      subTokens: null,
      context: { tokens: context },
    };
    clock += 60000;
    ends('p1');
    if (index === 11)
      learning.split('p1', turn.endedAt, [
        { kind: 'run', ms: 20000, slowest: { what: 'npm   test', ms: 20000 } },
        { kind: 'write', ms: 10000, slowest: null },
      ]);
    await wait(20);
  }
  const files = fs.readdirSync(path.join(folder, 'task-learning'));
  const records = fs
    .readFileSync(path.join(folder, 'task-learning', files[0]), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  check(records.length === 12, 'every task kept');
  check(records[0].ctxStart === undefined, 'the first task has no known start size');
  check(records[1].ctxStart === 10000, 'the next starts at the size the last one ended');
  check(records[11].tokens === 900000 && records[11].agent === 'Claude Code', 'tokens kept');
  check(records[11].parts?.run === 20000 && records[11].slow?.[0]?.what === 'npm test', 'split');

  // the lesson comes with a prompt while the conversation is heavy, once
  turn.context.tokens = HEAVY + 50000;
  const first = learning.forPrompt('p1');
  check(/Technically Not learned/.test(first) && /200k tokens/.test(first), 'given with a prompt');
  check(learning.forPrompt('p1') === '', 'once per session');

  // after a compact it may come again when the conversation grows back
  turn.context.tokens = 5000;
  check(learning.forPrompt('p1') === '', 'not while the conversation is small');
  turn.context.tokens = HEAVY + 1;
  check(/Technically Not learned/.test(learning.forPrompt('p1')), 'again once heavy again');

  // `tnai context` always has it
  check(/Learned from 12 measured tasks/.test(learning.forContext(root)), 'in tnai context');

  // the window's view: lessons in the user's words, the usual task, this task's record
  const view = learning.view('p1', records[11].at + 3000);
  check(view?.count === 12, 'view counts the tasks');
  check(view?.usual?.agent === 'Claude Code' && view.usual.tasks === 12, 'the usual task');
  check(view?.task?.tokens === 900000 && view.task.ctxStart > HEAVY, 'this task found');
  const userContext = view?.lessons.find(lesson => lesson.key === 'context');
  check(/^Big conversations cost more/.test(userContext?.text || ''), 'user words');
  check(/agents told to work in fewer steps/.test(userContext?.note || ''), 'what agents hear');

  // "Tell agents" off: kept from prompts and tnai context, said so in Details, the window told
  check(pushed === 12, 'the window is told of every kept task');
  pushed = 0;
  check(learning.setMuted('p1', 'context', true) === true, 'switched off');
  check(pushed === 1, 'the window is told');
  check(!/Learned from/.test(learning.forContext(root)), 'not in tnai context');
  turn.context.tokens = 5000;
  learning.forPrompt('p1');
  turn.context.tokens = HEAVY + 1;
  check(learning.forPrompt('p1') === '', 'not with a prompt');
  check(/agents are not told/.test(learning.view('p1', 0).lessons[0].note), 'Details says so');
  check(learning.setMuted('p1', 'nonsense', true) === false, 'an unknown lesson is refused');
  learning.setMuted('p1', 'context', false);
  check(/Learned from/.test(learning.forContext(root)), 'back on');

  // a CLI without a prompt hook: the same lessons on one line, once per session
  learning.forget('p1');
  turn.context.tokens = HEAVY + 1;
  const note = learning.noteFor('p1');
  check(/^Your conversation is at/.test(note) && !/\n/.test(note), 'one line for other CLIs');
  check(learning.noteFor('p1') === '', 'that once per session too');

  // a stopped thread's history is never kept
  turn = { ...turn, history: true, startedAt: clock, endedAt: clock + 1000 };
  ends('p1');
  await wait(20);
  const after = fs.readFileSync(path.join(folder, 'task-learning', files[0]), 'utf8');
  check(after.trim().split('\n').length === 12, 'history is not a new task');

  fs.rmSync(folder, { recursive: true, force: true });
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
