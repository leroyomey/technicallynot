// Test of prompts sent while a thread compacts (feature 12, 2026-10-28):
// node tools/compact-hold-test.js
//
// A prompt from the prompt box sent while the thread's CLI compacts its conversation is held by
// Technically Not (desktop/attention-service.js), shown in the conversation as waiting, and sent
// when the compact ends: in order, each one exactly once. The window tells main when a compact
// begins and ends (src/scripts/158-cli-busy.js). Part 1 runs the real attention-service with a
// stand-in CLI; part 2 runs 158 in a Node sandbox with a fake clock; part 3 checks the words the
// conversation and the bell use. No window opens and no CLI starts.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail === '' ? '' : ' · ' + JSON.stringify(detail)));
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Waits until the test says yes or the time is up (deliveries wait about 0.8 s each).
async function waitFor(test, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await pause(50);
  }
  return test();
}

// ---------------------------------------------------------------- part 1: main holds and sends
async function mainPart() {
  const attention = require(path.join(ROOT, 'desktop', 'attention-service.js'));
  const world = { busy: false, typed: [], delivered: [], events: [] };
  attention.init(
    (channel, payload) => {
      world.events.push(channel);
      if (channel === 'attention:delivered') world.delivered.push(payload);
    },
    {
      turns: { busy: () => world.busy, onEnd: () => {} },
      hooks: { pendingPermissions: () => [] },
      submit: async (paneId, text) => {
        world.typed.push(paneId + ':' + text);
        return { ok: true, state: 'sent' };
      },
      cli: () => 'Claude Code',
    }
  );
  const heldFor = paneId => attention.list().held.filter(entry => entry.paneId === paneId);

  // nothing runs: a prompt goes straight to the CLI
  check(
    'an idle thread holds nothing',
    attention.holdIfBlocked('p1', { text: 'plain', ifBusy: true }) === null
  );

  // a compact begins: the prompt box's prompts are held, marked "compact"
  attention.setCompacting('p1', true);
  check('main knows it compacts', attention.compacting('p1') === true);
  const first = attention.holdIfBlocked('p1', { text: 'first while compacting', ifBusy: true });
  check('a prompt during a compact is held', first?.state === 'held', first);
  check('its reason is the compact', first?.reason === 'compact', first?.reason);
  const second = attention.holdIfBlocked('p1', { text: 'second while compacting', ifBusy: true });
  check('a second one is held too', second?.state === 'held', second);
  const listed = heldFor('p1');
  check('both are listed for the window', listed.length === 2, listed.length);
  check(
    'the list says why: compact',
    listed.every(entry => entry.why === 'compact'),
    listed.map(entry => entry.why)
  );
  check(
    'the list keeps the order',
    listed[0]?.text === 'first while compacting' && listed[1]?.text === 'second while compacting'
  );

  // another thread is not held by this compact
  check(
    'another thread is not held',
    attention.holdIfBlocked('p2', { text: 'elsewhere', ifBusy: true }) === null
  );

  // senders that never wait for a task (a decision's answer) are not held by a compact alone
  attention.setCompacting('p3', true);
  check(
    'a sender without ifBusy goes straight on',
    attention.holdIfBlocked('p3', { text: 'answer', ifBusy: false }) === null
  );
  attention.setCompacting('p3', false);

  // while it compacts, nothing is typed in
  await pause(1300);
  check('nothing is sent while it compacts', world.typed.length === 0, world.typed);

  // the compact ends: both go out, in order, once each
  attention.setCompacting('p1', false);
  check('main knows it ended', attention.compacting('p1') === false);
  await waitFor(() => world.typed.length >= 2);
  await pause(1200);
  check(
    'both are sent after the compact, in order',
    world.typed.join('|') === 'p1:first while compacting|p1:second while compacting',
    world.typed
  );
  check('each is sent exactly once', world.typed.length === 2, world.typed.length);
  check('the window hears each delivery once', world.delivered.length === 2, world.delivered);
  check('nothing stays held', heldFor('p1').length === 0, heldFor('p1'));

  // a busy agent that also compacts (an automatic compact inside a task): its task comes first
  world.busy = true;
  attention.setCompacting('p4', true);
  const during = attention.holdIfBlocked('p4', { text: 'inside a task', ifBusy: true });
  check('inside a task the reason is the task', during?.reason === 'busy', during?.reason);
  attention.setCompacting('p4', false);
  await pause(1200);
  check('still held while the task runs', world.typed.length === 2, world.typed);
  world.busy = false;

  // a window that starts anew forgets every compact, and the held prompts go out
  attention.setCompacting('p5', true);
  attention.holdIfBlocked('p5', { text: 'before the reload', ifBusy: true });
  attention.setCompacting('', false);
  check('a fresh window clears every compact', attention.compacting('p5') === false);
  await waitFor(() => world.typed.includes('p5:before the reload'));
  check('its held prompt goes out', world.typed.includes('p5:before the reload'), world.typed);

  // a thread that closes forgets its compact
  attention.setCompacting('p6', true);
  attention.exited('p6');
  check('a closed thread forgets its compact', attention.compacting('p6') === false);

  // a second "began" does not restart anything, an "ended" for nothing does nothing
  attention.setCompacting('p7', false);
  check('an end with no compact is harmless', attention.compacting('p7') === false);
}

// ---------------------------------------------------------------- part 2: 158 tells main
function rendererPart() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'scripts', '158-cli-busy.js'), 'utf8');
  const world = { now: 1_000_000, status: 'idle', turn: null, listener: null, timers: new Map() };
  const told = [];
  let nextTimer = 1;

  class FakeDate extends Date {
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
      attention: {
        compacting: (paneId, on) => {
          told.push(paneId + ':' + on);
          return Promise.resolve();
        },
      },
    },
    TnaiTurns: { get: () => world.turn },
    TnaiThreadList: { refresh: () => {} },
  };
  const sandbox = {
    window,
    document: { querySelector: () => ({ dataset: { status: world.status } }) },
    CSS: { escape: text => text },
    Date: FakeDate,
    setInterval: fn => {
      const id = nextTimer++;
      world.timers.set(id, fn);
      return id;
    },
    clearInterval: id => world.timers.delete(id),
  };
  vm.runInNewContext(source, sandbox);
  const wait = ms => {
    const end = world.now + ms;
    while (world.now < end) {
      world.now = Math.min(end, world.now + 1000);
      for (const fn of [...world.timers.values()]) fn();
    }
  };
  const send = (paneId, event) => world.listener({ paneId, at: world.now, ...event });

  check('a fresh window tells main to forget old compacts', told[0] === ':false', told);

  // /compact from the prompt box, ended by the record
  told.length = 0;
  send('a', { kind: 'command', command: '/compact' });
  check('a /compact tells main it began', told.join() === 'a:true', told);
  send('a', { kind: 'compact-start', trigger: 'manual' });
  check('the PreCompact hook for the same compact tells nothing new', told.join() === 'a:true');
  world.turn = { compactedAt: world.now };
  wait(1000);
  check('the record ending it tells main it ended', told.join() === 'a:true,a:false', told);
  world.turn = null;

  // automatic compact (PreCompact), ended by the next task
  told.length = 0;
  send('b', { kind: 'compact-start', trigger: 'auto' });
  world.now += 2000;
  send('b', { kind: 'stop' });
  check('a task end ends it for main', told.join() === 'b:true,b:false', told);

  // Cursor Agent's /compress, ended by its reader's compact line (122 → noted)
  told.length = 0;
  send('c', { kind: 'command', command: '/compress' });
  window.TnaiCliBusy.noted('c', { text: 'The conversation was compacted here', at: world.now });
  check('a reader note ends it for main', told.join() === 'c:true,c:false', told);

  // a compact the screen showed working, then quiet (inferred end)
  told.length = 0;
  send('d', { kind: 'command', command: '/compact' });
  world.status = 'working';
  wait(3000);
  world.status = 'idle';
  wait(4000);
  check('the screen going quiet ends it for main', told.join() === 'd:true,d:false', told);

  // the time limit ends it
  told.length = 0;
  send('e', { kind: 'command', command: '/summarize' });
  wait(10 * 60 * 1000 + 2000);
  check('the time limit ends it for main', told.join() === 'e:true,e:false', told);

  // a command that is no compact never tells main
  told.length = 0;
  send('f', { kind: 'command', command: '/model' });
  wait(12000);
  check('a menu command tells main nothing', told.length === 0, told);

  // a command that takes a compact's place ends that compact
  told.length = 0;
  send('g', { kind: 'command', command: '/compact' });
  send('g', { kind: 'command', command: '/init' });
  check('another command in its place ends it', told.join() === 'g:true,g:false', told);
}

// ---------------------------------------------------------------- part 3: the words shown
function wordsPart() {
  const readable = fs.readFileSync(
    path.join(ROOT, 'src', 'scripts', '122-thread-readable.js'),
    'utf8'
  );
  const needsYou = fs.readFileSync(path.join(ROOT, 'src', 'scripts', '71-needs-you.js'), 'utf8');
  check(
    'the queued bubble has words for a compact',
    /compact: 'Waiting · it gets this when compacting ends'/.test(readable)
  );
  check(
    'a compact-held prompt is no "Needs you" card',
    /const waiting = h => h\.why === 'busy' \|\| h\.why === 'compact'/.test(needsYou)
  );
  check('the bell says it is compacting', /is compacting · your message waits/.test(needsYou));
}

(async () => {
  await mainPart();
  rendererPart();
  wordsPart();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
