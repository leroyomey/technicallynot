// Technically Not tools · task-time-test.js — the numbers behind the "Worked for" block's time bar
// and cost word (src/scripts/187-task-time.js `split` and `cost`): a task's time split by kind of
// step from the tool's own dated record, steps that overlap counted once, records that do not date
// every step left out, and a request's tokens added once however many lines repeat them.
// Run: node tools/task-time-test.js
'use strict';
const time = require('../src/scripts/187-task-time.js');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const S = 1000;
const T0 = Date.parse('2026-10-28T10:00:00Z');
const at = seconds => T0 + seconds * S;
const msOf = (result, kind) => result?.parts.find(part => part.kind === kind)?.ms || 0;

// 1. a plain task: read, edit, a failed test, a helper, words in between
{
  const entries = [
    { kind: 'you', text: 'Make the page faster', at: at(0) },
    { kind: 'say', text: 'I will look.', at: at(5) },
    { kind: 'act', id: 'a1', verb: 'Read', what: 'bench.js', at: at(10) },
    { kind: 'result', id: 'a1', at: at(40) },
    { kind: 'act', id: 'a2', verb: 'Edited', what: 'bench.js', at: at(50) },
    { kind: 'result', id: 'a2', at: at(110) },
    { kind: 'act', id: 'a3', verb: 'Ran', what: 'npm test', at: at(120) },
    { kind: 'result', id: 'a3', failed: true, at: at(300) },
    { kind: 'act', id: 'a4', verb: 'Started a sub-agent', what: 'check the numbers', at: at(310) },
    { kind: 'result', id: 'a4', at: at(385) },
    { kind: 'say', text: 'Done.', at: at(400) },
    { kind: 'worked', ms: 420 * S, at: at(420) },
  ];
  const result = time.split(entries);
  check(!!result, 'a dated task is split');
  check(result.end - result.start === 420 * S, 'the task runs from the prompt to its end');
  check(msOf(result, 'read') === 30 * S, 'reading: 30 s');
  check(msOf(result, 'edit') === 60 * S, 'editing: 60 s');
  check(msOf(result, 'run') === 180 * S, 'running commands: 180 s');
  check(msOf(result, 'helper') === 75 * S, 'helpers: 75 s');
  check(msOf(result, 'write') === 75 * S, 'the time between steps is thinking and writing: 75 s');
  const sum = result.parts.reduce((total, part) => total + part.ms, 0);
  check(sum === 420 * S, 'the parts add up to the whole task');
  check(
    result.parts.find(part => part.kind === 'run').slowest.what === 'npm test',
    'a part names its slowest step'
  );
  check(
    result.parts.map(part => part.kind).join() === 'read,edit,run,helper,write',
    'parts stand in the fixed order, kinds with no time left out'
  );
}

// 2. steps at the same time are counted once, the time going to the first kind in the list
{
  const entries = [
    { kind: 'you', at: at(0) },
    { kind: 'act', id: 'r1', verb: 'Read', at: at(10) },
    { kind: 'act', id: 'r2', verb: 'Ran', what: 'npm run build', at: at(10) },
    { kind: 'result', id: 'r1', at: at(20) },
    { kind: 'result', id: 'r2', at: at(70) },
    { kind: 'worked', ms: 80 * S, at: at(80) },
  ];
  const result = time.split(entries);
  check(msOf(result, 'run') === 60 * S, 'a command and a read at once: the command takes the time');
  check(msOf(result, 'read') === 0, 'the overlapped read adds nothing');
  check(msOf(result, 'write') === 20 * S, 'before and after the steps: thinking and writing');
}

// 3. a question to the user is time waiting for you
{
  const entries = [
    { kind: 'you', at: at(0) },
    { kind: 'ask', id: 'q1', at: at(5) },
    { kind: 'result', id: 'q1', at: at(65) },
    { kind: 'worked', ms: 70 * S, at: at(70) },
  ];
  check(msOf(time.split(entries), 'you') === 60 * S, 'a question waits 60 s for you');
}

// 4. records that do not date every step get no bar
{
  // Codex: a step is dated only when it is done, its result not at all
  const codex = [
    { kind: 'you', at: at(0) },
    { kind: 'act', id: 'c1', verb: 'Ran', at: at(30) },
    { kind: 'result', id: 'c1' },
    { kind: 'worked', ms: 40 * S, at: at(40) },
  ];
  check(time.split(codex) === null, 'results without a date: no bar (Codex)');

  // Cursor Agent: no dates at all
  const cursor = [
    { kind: 'act', id: 'k1', verb: 'Read' },
    { kind: 'result', id: 'k1' },
    { kind: 'worked', ms: 0 },
  ];
  check(time.split(cursor) === null, 'no dates: no bar (Cursor Agent)');

  // a task with words only has nothing to split
  const words = [
    { kind: 'you', at: at(0) },
    { kind: 'say', at: at(4) },
    { kind: 'worked', ms: 9 * S, at: at(9) },
  ];
  check(time.split(words) === null, 'no steps: no bar');
}

// 5. a step with no result (stopped) runs to the task's end; a re-read cut before the prompt
//    starts from the "worked" time
{
  const entries = [
    { kind: 'act', id: 's1', verb: 'Ran', what: 'npm start', at: at(10) },
    { kind: 'worked', ms: 60 * S, at: at(60) },
  ];
  const result = time.split(entries);
  check(result.start === at(0), 'no prompt in the record: the start is the end less the task time');
  check(msOf(result, 'run') === 50 * S, 'a step with no result runs to the end');
}

// 6. tokens: each request once, its newest line winning
{
  const entries = [
    { kind: 'say', usage: { id: 'm1', input: 10, output: 5, cacheRead: 100, cacheWrite: 20 } },
    { kind: 'act', usage: { id: 'm1', input: 10, output: 40, cacheRead: 100, cacheWrite: 20 } },
    { kind: 'act', usage: { id: 'm2', input: 3, output: 7, cacheRead: 200, cacheWrite: 0 } },
    { kind: 'result', id: 'x' },
  ];
  const tokens = time.cost(entries);
  check(
    tokens.input === 13 && tokens.output === 47,
    'a request repeated on two lines counts once, newest wins'
  );
  check(
    time.totalOf(tokens) === 13 + 47 + 300 + 20,
    'the total adds input, output and both caches'
  );
  check(time.cost([{ kind: 'say' }]) === null, 'no tokens in the record: none shown');
}

// 7. the words
check(time.shortNumber(84000) === '84k' && time.shortNumber(1250000) === '1.3M', 'short numbers');
check(
  time.shortNumber(950) === '950' && time.shortNumber(8400) === '8.4k',
  'short numbers under ten thousand'
);
check(time.duration(250 * S) === '4m 10s' && time.duration(42 * S) === '42s', 'durations');
check(time.duration(3900 * S) === '1h 05m', 'durations over an hour');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
