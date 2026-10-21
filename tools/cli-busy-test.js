// Test of the thread's "Compacting" line (src/scripts/158-cli-busy.js): node tools/cli-busy-test.js
//
// When a built-in command such as /compact starts (a slash command the CLI took, Claude Code's
// PreCompact hook), what the thread shows while it runs, and each way it ends: the record's
// compact line, the next task, the screen going quiet, a menu command that never worked, and the
// time limit. The script runs in a Node sandbox with a fake clock, a fake panel status and a
// stand-in for the app's event stream: no window opens, no CLI starts.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'scripts', '158-cli-busy.js'),
  'utf8'
);

// One fresh copy of the script, with its own clock, panel status, turns and timers.
function load() {
  const world = {
    now: 1_000_000,
    status: 'idle',
    turn: null,
    listener: null,
    timers: new Map(),
    nextTimer: 1,
    refreshes: 0,
  };
  const RealDate = Date;

  class FakeDate extends RealDate {
    static now() {
      return world.now;
    }
  }
  const window = {
    tnaiNative: {
      agentEvents: {
        on: fn => {
          world.listener = fn;
          return () => {};
        },
      },
    },
    TnaiTurns: { get: () => world.turn },
    TnaiThreadList: { refresh: () => world.refreshes++ },
  };
  const document = {
    querySelector: () => ({ dataset: { status: world.status } }),
  };
  const sandbox = {
    window,
    document,
    CSS: { escape: text => text },
    Date: FakeDate,
    setInterval: fn => {
      const id = world.nextTimer++;
      world.timers.set(id, fn);
      return id;
    },
    clearInterval: id => world.timers.delete(id),
  };
  vm.runInNewContext(source, sandbox);
  const busy = window.TnaiCliBusy;

  // Moves the clock on, one tick a second, as the real interval would.
  world.wait = ms => {
    const end = world.now + ms;
    while (world.now < end) {
      world.now = Math.min(end, world.now + 1000);
      for (const fn of [...world.timers.values()]) fn();
    }
  };
  world.send = event => world.listener({ paneId: 'p1', at: world.now, ...event });
  return { busy, world };
}

// ---------------------------------------------------------------- a /compact from the prompt box
{
  const { busy, world } = load();
  world.send({ kind: 'command', command: '/compact' });
  const shown = busy.get('p1');
  check('a compact shows at once', !!shown);
  check('its words', shown?.words === 'Compacting conversation', shown?.words);
  check('a compact is exact, not inferred', shown?.inferred === false);
  check('the list repaints', world.refreshes > 0);
  check('a ticker runs', world.timers.size === 1);

  world.wait(42_000);
  check('the clock runs', busy.get('p1')?.clock === '0:42', busy.get('p1')?.clock);
  check('still shown while the screen is quiet', !!busy.get('p1'));

  // Claude Code writes compact_boundary: the turn's compactedAt (42)
  world.turn = { compactedAt: world.now };
  world.wait(1000);
  check('the record ends it', busy.get('p1') === null);
  check('the ticker stops', world.timers.size === 0);
}

// ---------------------------------------------------------------- PreCompact, automatic
{
  const { busy, world } = load();
  world.send({ kind: 'compact-start', trigger: 'auto' });
  check(
    'an automatic compact says the context was full',
    busy.get('p1')?.words === 'Compacting conversation (context was full)'
  );

  // the same compact also reported from the prompt box keeps its first moment
  const since = busy.get('p1').since;
  world.wait(3000);
  world.send({ kind: 'command', command: '/compact' });
  check('one compact, one start', busy.get('p1')?.since === since);

  // an old compact line in the record does not end this one
  busy.noted('p1', { text: 'The conversation was compacted here', at: since - 60_000 });
  check('an older compact line is ignored', !!busy.get('p1'));

  // the reader's note for this compact (Codex, OpenCode, Claude Code) ends it
  busy.noted('p1', { text: 'The conversation was compacted here', at: world.now });
  check('the reader’s compact line ends it', busy.get('p1') === null);
}

// ---------------------------------------------------------------- the next task ends it
{
  const { busy, world } = load();
  world.send({ kind: 'command', command: '/compact' });
  world.wait(2000);
  world.send({ kind: 'prompt', text: '/compact' });
  check('the compact reported as a prompt is not a next task', !!busy.get('p1'));
  world.wait(2000);
  world.send({ kind: 'prompt', text: 'Fix the login page' });
  check('the next task ends it', busy.get('p1') === null);

  world.send({ kind: 'compact-start', trigger: 'auto' });
  world.wait(5000);
  world.send({ kind: 'stop' });
  check('a task that ends ends it', busy.get('p1') === null);

  // a helper's events are not the thread's
  world.send({ kind: 'compact-start', trigger: 'auto', agentId: 'helper' });
  check('a helper’s compact is not shown on the lead', busy.get('p1') === null);
}

// ---------------------------------------------------------------- the screen says it is done
{
  const { busy, world } = load();
  world.send({ kind: 'command', command: '/compact' });
  world.status = 'working';
  world.wait(10_000);
  world.status = 'idle';
  world.wait(1000);
  check('a short quiet keeps it', !!busy.get('p1'));
  world.wait(3000);
  check('a longer quiet after work ends it', busy.get('p1') === null);
}

// ---------------------------------------------------------------- other commands
{
  const { busy, world } = load();
  world.send({ kind: 'command', command: '/init' });
  check('a command is not shown before the CLI works on it', busy.get('p1') === null);
  world.status = 'working';
  world.wait(1000);
  const shown = busy.get('p1');
  check('then it shows', shown?.words === 'Running /init', shown?.words);
  check('and it is inferred from the screen', shown?.inferred === true);
  world.status = 'idle';
  world.wait(4000);
  check('it ends when the screen is quiet', busy.get('p1') === null);

  world.send({ kind: 'command', command: '/model' });
  world.wait(11_000);
  check('a menu command that never worked is dropped', busy.get('p1') === null);
  check('and the ticker stops', world.timers.size === 0);

  world.send({ kind: 'command', command: '/compress' });
  check('Cursor Agent’s /compress is a compact', busy.get('p1')?.compact === true);
}

// ---------------------------------------------------------------- the limit
{
  const { busy, world } = load();
  world.send({ kind: 'command', command: '/compact' });
  world.wait(9 * 60 * 1000);
  check('a long compact stays', !!busy.get('p1'));
  world.wait(2 * 60 * 1000);
  check('no line stays past the limit', busy.get('p1') === null);
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
