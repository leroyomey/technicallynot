/*
 * Technically Not tools · desktop-check/stall-log-check.js — desktop/stall-log.js names what
 * blocked the main process. Plain Node, no Electron, about 2 s: a named section that blocks 300 ms
 * must appear in the stall line with its name; a block outside any named section says so; a short
 * section (under 20 ms) is not named; a quiet period logs nothing. Blocks with a sleep
 * (Atomics.wait), not a busy loop. Run: node tools/desktop-check/stall-log-check.js
 */
'use strict';

// The stall lines alone: the profile that turns on after a stall would add its own line to each
// message after the first (stall-profile-check.js checks that part).
if (!process.env.TNAI_STALL_PROFILE) process.env.TNAI_STALL_PROFILE = '0';
const stalls = require('../../desktop/stall-log');
const lines = [],
  realWarn = console.warn;
console.warn = msg => {
  if (String(msg).startsWith('[tnai stall]')) lines.push(String(msg));
  else realWarn(msg);
};

// blocks this thread without using the CPU
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

(async () => {
  stalls.start('');
  await wait(600);
  check(lines.length === 0, 'a quiet main process logs no stall (' + lines.length + ')');
  const out = stalls.timed('ipc demo:block', n => {
    sleep(300);
    return n + 1;
  })(41);
  await wait(400);
  check(out === 42, 'a timed function still returns its own result');
  check(
    lines.length === 1 &&
      /blocked ~\d+ ms at \S+ · longest named section: ipc demo:block (29\d|3\d\d) ms · own CPU \d+ ms of \d+ ms( · main thread CPU \d+ ms)?( · in callbacks \d+ ms)?( · garbage collection [^·]*)? · heap \d+ of \d+ MB$/.test(
        lines[0]
      ),
    'a named section that blocks 300 ms is named in the stall line: ' + (lines[0] || 'no line')
  );

  // The block here is a sleep, so the process's own CPU time must be far below the blocked time (a
  // block of our own code would be near it; that side is not tested: it would need a busy loop,
  // which the checks never run on the user's PC).
  const cpu =
    /own CPU (\d+) ms of (\d+) ms(?: · main thread CPU \d+ ms)?(?: · in callbacks \d+ ms)?(?: · garbage collection [^·]*)? · heap \d+ of \d+ MB$/.exec(
      lines[0] || ''
    );
  check(
    !!cpu && +cpu[1] < 150 && +cpu[2] > 350 && +cpu[2] < 900,
    'the line holds the own CPU time of the stalled interval, low for a sleeping block, then the heap: ' +
      (cpu ? cpu[0] : 'no field')
  );
  stalls.timed('ipc demo:quick', () => sleep(5))();
  sleep(300);
  await wait(400);
  check(
    lines.length === 2 &&
      / · no named section · own CPU \d+ ms of \d+ ms( · main thread CPU \d+ ms)?( · in callbacks \d+ ms)?( · garbage collection [^·]*)? · heap \d+ of \d+ MB$/.test(
        lines[1]
      ),
    'a block outside any named section says so, and a 5 ms section is not blamed: ' +
      (lines[1] || 'no line')
  );

  // An async function in pieces (stalls.sections): the run after a wait is named, with the name the
  // function set; the wait itself is not counted.
  const got = await stalls.sections('demo', async (span, n) => {
    span.name = 'demo after wait';
    await span.rest(wait(350));
    sleep(400);
    return n * 2;
  })(21); // 400: late by 150 ms or more wherever the 250 ms tick stands
  await wait(400);
  check(got === 42, 'a function in sections still returns its own result');
  check(
    lines.length === 3 &&
      / · longest named section: demo after wait (39\d|4\d\d) ms · /.test(lines[2]),
    'the run after an await is named, without the 350 ms it waited: ' + (lines[2] || 'no line')
  );
  let rejected = false;
  try {
    await stalls.sections('demo', async span => {
      await span.rest(Promise.reject(new Error('x')));
    })();
  } catch {
    rejected = true;
  }
  check(rejected, 'a function in sections that rejects still rejects');
  let threw = false;
  try {
    stalls.timed('ipc demo:throws', () => {
      throw new Error('x');
    })();
  } catch {
    threw = true;
  }
  check(threw, 'a timed function that throws still throws');

  // Timers (named from stalls.start on): a slow timer callback is named with the place it was set;
  // one whose own named section covers the run keeps that more exact name; the callback's
  // arguments, the timer object, clearTimeout and util.promisify are unchanged.
  const before = lines.length;

  function slowFlush() {
    sleep(300);
  }
  setTimeout(slowFlush, 10);
  await wait(700);
  check(
    lines.length === before + 1 &&
      / · longest named section: timer slowFlush stall-log-check\.js:\d+ (29\d|3\d\d) ms · /.test(
        lines[before]
      ),
    'a slow timer callback is named, with the place the timer was set: ' +
      (lines[before] || 'no line')
  );
  setTimeout(() => stalls.timed('demo inside timer', () => sleep(300))(), 10);
  await wait(700);
  check(
    lines.length === before + 2 &&
      / · longest named section: demo inside timer (29\d|3\d\d) ms · /.test(lines[before + 1]),
    'a named section inside a timer keeps its own name: ' + (lines[before + 1] || 'no line')
  );
  const got2 = await new Promise(resolve => {
    const timer = setTimeout(
      function (a, b) {
        resolve([a, b, this === timer]);
      },
      5,
      'x',
      2
    );
  });
  check(
    got2.join() === 'x,2,true',
    'a timer callback still gets its arguments and its timer as `this`: ' + got2.join()
  );
  let fired = false;
  clearTimeout(
    setTimeout(() => {
      fired = true;
    }, 20)
  );
  const tick = setInterval(() => {}, 10);
  clearInterval(tick);
  const slept = await require('util').promisify(setTimeout)(30, 'later');
  await wait(60);
  check(
    !fired && slept === 'later',
    'clearTimeout, clearInterval and util.promisify(setTimeout) work as before'
  );

  // A child process's event names the program it ran and its listener, also a once-listener (gone
  // after the emit).
  const beforeChild = lines.length;
  await new Promise(resolve => {
    const child = require('child_process').spawn(process.execPath, ['-e', ''], {
      windowsHide: true,
    });

    // 400 ms: a 300 ms block that starts just before the 250 ms stall tick shows only 50 ms late
    // (learned 2026-10-21: this line failed every run for that reason)
    child.once('close', function slowCloseListener() {
      sleep(400);
      resolve();
    });
  });
  await wait(700);

  // the process start itself may log a stall of its own first (a busy PC), so any new line counts
  const childLine = lines
    .slice(beforeChild)
    .find(line =>
      / · longest named section: event ChildProcess\.close node .*slowCloseListener.* (39\d|4\d\d) ms · /.test(
        line
      )
    );
  check(
    !!childLine,
    'a slow child process event names the program and the listener: ' +
      (childLine || lines.slice(beforeChild).join(' | ') || 'no line')
  );

  // Garbage collection: Node's own record of a pause reaches the stall log (needs `node
  // --expose-gc` to make one on purpose).
  if (global.gc) {
    stalls.gcSince();
    const keep = Array.from({ length: 200000 }, (_, i) => ({ i }));
    const t0 = performance.now();
    global.gc();
    const took = performance.now() - t0;
    await new Promise(resolve => setImmediate(resolve)); // where the stall line reads it
    const g = stalls.gcSince();
    check(
      keep.length > 0 && took >= 1 && g.total >= 1 && g.longest >= 1,
      'a garbage collection pause is recorded one step later in the same turn of the loop: forced one took ' +
        took.toFixed(1) +
        ' ms, recorded ' +
        JSON.stringify(g)
    );
  } else console.log('skip garbage collection (run with node --expose-gc to check it)');
  console.warn = realWarn;
  console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})();
