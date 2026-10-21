// Test of desktop/remote-type.js: node tools/remote-type-test.js (plain Node; also run it in
// Electron's Node). Typing from a paired computer into a watched terminal: the two messages, what
// a batch writes, every check of the typed side in its order, and the typing side's batching, on
// a clock the test moves by hand. Nothing here opens a window or a socket.
const T = require('../desktop/remote-type.js');
const { createViews } = require('../desktop/remote-view.js');
const MAX_PLAIN = require('../desktop/remote-noise.js').MAX_PLAIN;

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// Characters nobody can see are built from their numbers, never typed (lessons.md).
const C = n => String.fromCharCode(n);
const ESC = C(0x1b),
  ZW = C(0x200b),
  RLO = C(0x202e),
  LS = C(0x2028),
  NUL = C(0),
  BEL = C(7);
const hex = n => n.toString(16).padStart(16, '0');
const TICKET = 'ab'.repeat(8),
  VIEW = hex(900),
  ROUND = hex(77);

// A clock and timers the test moves by hand.
function clock() {
  let t = 1000;
  const list = [];
  return {
    now: () => t,
    timers: {
      set(fn, ms) {
        const h = { fn, at: t + ms };
        list.push(h);
        return h;
      },
      clear(h) {
        const i = list.indexOf(h);
        if (i >= 0) list.splice(i, 1);
      },
    },
    pending: () => list.length,
    go(ms) {
      const end = t + ms;
      for (;;) {
        list.sort((a, b) => a.at - b.at);
        const h = list[0];
        if (!h || h.at > end) break;
        list.shift();
        t = h.at;
        h.fn();
      }
      t = end;
    },
  };
}

// ---- the two messages ----
let nN = 0;
const msg = (over = {}) => ({
  t: 'type',
  n: hex(++nN),
  c: 5,
  ms: 10,
  v: VIEW,
  id: 'pane-1',
  to: TICKET,
  r: ROUND,
  s: 1,
  f: 3,
  k: [{ x: 'ls' }, 'Enter'],
  ...over,
});
{
  const s = T.shapeType(msg());
  check('a batch is read field by field', !!s && s.k.length === 2 && s.k[1] === 'Enter');
  check('a field not named is not kept', T.shapeType(msg({ extra: 1 })).extra === undefined);
  check('an unknown key name is refused whole', T.shapeType(msg({ k: ['ShiftTab'] })) === null);
  check('Shift+Tab is not a key here', !T.KEY_NAMES.includes('ShiftTab'));
  check('a raw escape in text is refused', T.shapeType(msg({ k: [{ x: ESC + '[A' }] })) === null);
  check('a bell in text is refused', T.shapeType(msg({ k: [{ x: 'a' + BEL }] })) === null);
  check('a NUL in text is refused', T.shapeType(msg({ k: [{ x: NUL }] })) === null);
  check('a zero-width character is refused', T.shapeType(msg({ k: [{ x: 'a' + ZW }] })) === null);
  check('a direction mark is refused', T.shapeType(msg({ k: [{ x: RLO + 'x' }] })) === null);
  check('a line separator is refused', T.shapeType(msg({ k: [{ x: 'a' + LS }] })) === null);
  check('a line end in typed text is refused', T.shapeType(msg({ k: [{ x: 'a\nb' }] })) === null);
  check('empty text is refused', T.shapeType(msg({ k: [{ x: '' }] })) === null);
  check('no keys is refused', T.shapeType(msg({ k: [] })) === null);
  check(
    'more than 32 items is refused',
    T.shapeType(msg({ k: Array(33).fill('Left') })) === null &&
      !!T.shapeType(msg({ k: Array(32).fill('Left') }))
  );
  check(
    'a piece of text over 64 characters is refused',
    T.shapeType(msg({ k: [{ x: 'a'.repeat(65) }] })) === null &&
      !!T.shapeType(msg({ k: [{ x: 'a'.repeat(64) }] }))
  );
  check(
    'more than 256 characters of text in one batch is refused',
    T.shapeType(msg({ k: Array(5).fill({ x: 'a'.repeat(52) }) })) === null &&
      !!T.shapeType(msg({ k: Array(4).fill({ x: 'a'.repeat(64) }) }))
  );
  check('a paste is read', T.shapeType(msg({ k: undefined, p: 'one\ntwo' })).p === 'one\ntwo');
  check('a paste and keys together are refused', T.shapeType(msg({ p: 'x' })) === null);
  check(
    'a paste over 1500 characters is refused',
    T.shapeType(msg({ k: undefined, p: 'a'.repeat(1501) })) === null
  );
  check(
    'a paste that does not fit one sealed message is refused',
    T.shapeType(msg({ k: undefined, p: C(0x4e2d).repeat(1400) })) === null &&
      Buffer.byteLength(C(0x4e2d).repeat(1400)) > MAX_PLAIN
  );
  check(
    'a paste with a carriage return is refused (the typing side makes it a line end)',
    T.shapeType(msg({ k: undefined, p: 'a\rb' })) === null
  );
  check('a paste with an escape is refused', T.shapeType(msg({ k: undefined, p: ESC })) === null);
  check('batch number 0 is refused', T.shapeType(msg({ s: 0 })) === null);
  check('picture number 0 is refused', T.shapeType(msg({ f: 0 })) === null);
  check('a ticket of the wrong form is refused', T.shapeType(msg({ to: 'zz' })) === null);
  check('a round of the wrong form is refused', T.shapeType(msg({ r: 'x' })) === null);
  check('a row id with a line end is refused', T.shapeType(msg({ id: 'a\nb' })) === null);
  check('another type is not this file', T.shapeType({ ...msg(), t: 'prompt' }) === null);
  check(
    'a reply is one word; an unknown word reads as refused',
    T.shapeTyped({ t: 'typed', n: hex(1), state: 'done' }).state === 'done' &&
      T.shapeTyped({ t: 'typed', n: hex(1), state: 'yes, and here is why' }).state === 'refused' &&
      T.shapeTyped({ t: 'typed', n: 'x' }) === null
  );
}

// ---- what a batch writes ----
{
  const b = m => T.bytesFor(T.shapeType(m), 'Claude Code');
  check('letters and Enter', b(msg()) === 'ls\r');
  check(
    'the arrows, Esc and Ctrl+C are their terminal bytes',
    b(msg({ k: ['Up', 'Down', 'Left', 'Right', 'Esc', 'CtrlC'] })) ===
      ESC + '[A' + ESC + '[B' + ESC + '[D' + ESC + '[C' + ESC + C(3)
  );
  check(
    'a paste into an agent CLI is one bracketed paste, its lines as one input',
    b(msg({ k: undefined, p: 'a\nb' })) === ESC + '[200~a\rb' + ESC + '[201~'
  );
  check(
    'a paste of one line into a plain terminal is the line, with no Enter',
    T.bytesFor(T.shapeType(msg({ k: undefined, p: 'dir' })), 'Terminal') === 'dir'
  );
  check(
    'a paste of several lines into a plain terminal is refused (each line would run)',
    T.bytesFor(T.shapeType(msg({ k: undefined, p: 'a\nb' })), 'Terminal') === ''
  );
  check(
    'which batches can send or choose',
    T.kindOf(T.shapeType(msg({ k: [{ x: 'ab' }, 'Backspace', 'Left'] }))) === 'line' &&
      T.kindOf(T.shapeType(msg({ k: ['Esc', 'CtrlC'] }))) === 'stop' &&
      T.kindOf(T.shapeType(msg())) === 'commit' &&
      T.kindOf(T.shapeType(msg({ k: ['Down'] }))) === 'commit' &&
      T.kindOf(T.shapeType(msg({ k: undefined, p: 'x' }))) === 'commit'
  );
  check(
    'the log line counts and never quotes',
    T.summary(T.countOf(T.shapeType(msg({ k: [{ x: 'secret' }, 'Enter', 'CtrlC'] })))) ===
      '6 characters, 1 Enter, 1 Ctrl+C'
  );
}

// ---- the typed side ----
// A stand-in of everything createTyping is handed, one rule's value at a time.
function typedSide(over = {}) {
  const k = clock();
  const world = {
    right: 'pair-1',
    vs: {
      v: VIEW,
      panelId: 'pane-1',
      ticket: TICKET,
      s: 3,
      dirty: false,
      dirtyAt: 0,
      times: [
        [1, 100],
        [2, 200],
        [3, 300],
      ],
    },
    ticket: TICKET,
    agent: { cli: 'Claude Code', name: 'Moss', running: true, mode: 'run', pid: 5, startedAt: 9 },
    fresh: true,
    deliver: 'done',
    logOk: true,
    sent: [],
    writes: [],
    lines: [],
    marks: [],
    guards: [],
    ...over,
  };
  const typing = T.createTyping({
    rights: () => world.right,
    fresh: (id, m, ms) => (world.freshMs = ms) && world.fresh,
    view: () => (world.vs ? { ...world.vs, times: world.vs.times.map(x => [...x]) } : null),
    ticket: () => world.ticket,
    agentNow: () => world.agent,
    questionOpen: () => {
      if (world.asking === 'unknown') throw new Error('not readable');
      return world.asking === true;
    },
    deliver: o => {
      world.guards.push(o.guard);
      if (world.deliver === 'done' && o.guard() === true) world.writes.push(o.data);
      return world.deliver === 'done' && !o.guard() ? 'refused' : world.deliver;
    },
    send: (id, obj) => world.sent.push(obj) > 0,
    log: e => {
      if (!world.logOk) throw new Error('full');
      const line = { ...e, head: '' };
      world.lines.push(line);
      return head => (line.head = head);
    },
    peerName: () => 'Laptop (…ab12)',
    typed: e => world.marks.push(e),
    mono: k.now,
    random: n => Buffer.alloc(n, 7),
  });
  const last = () => world.sent[world.sent.length - 1];
  return { world, typing, k, last };
}

{
  const { world, typing, last } = typedSide();
  const r = typing.receive('B', msg());
  check('a fresh batch is typed', world.writes[0] === 'ls\r' && last().state === 'done', r);
  check("the freshness asked is 5 seconds, not a prompt's 60", world.freshMs === 5000);
  check(
    'the mark names the computer where the keys land',
    world.marks[0].name === 'Laptop (…ab12)' && world.marks[0].panelId === 'pane-1'
  );
  check(
    'one list line, with counts and no letter of what was typed',
    world.lines.length === 1 &&
      world.lines[0].head === '2 characters, 1 Enter' &&
      !JSON.stringify(world.lines).includes('ls')
  );
  check('the reply carries no typed text', !JSON.stringify(world.sent).includes('ls'));
  typing.receive('B', msg({ s: 2, k: [{ x: 'pwd' }, 'Enter'] }));
  check(
    'the next batch of the round adds to the same line',
    world.lines.length === 1 && world.lines[0].head === '5 characters, 2 Enters'
  );
}

{
  const { world, typing } = typedSide({ right: '' });
  const r = typing.receive('B', msg());
  check(
    'no typing right: silence, nothing typed',
    r.silent === 'off' && !world.sent.length && !world.writes.length
  );
}

{
  const { world, typing } = typedSide();
  let silent = 0;
  for (let i = 0; i < 25; i++) {
    const r = typing.receive('B', { t: 'type', n: 'bad' });
    if (r.silent === 'limit') silent++;
  }
  check(
    'counted first: 20 a minute, a message of the wrong shape counts too, then silence',
    silent === 5 && !world.sent.length
  );
}

{
  const { world, typing, k, last } = typedSide();
  for (let s = 1; s <= 20; s++) typing.receive('B', msg({ s }));
  const r = typing.receive('B', msg({ s: 21 }));
  check(
    'the 21st batch in a minute gets silence',
    r.silent === 'limit' && world.writes.length === 20
  );
  k.go(60 * 1000);
  world.vs.times = [[3, k.now()]];
  typing.receive('B', msg({ s: 21 }));
  check('a minute later it is taken again', last().state === 'done' && world.writes.length === 21);
}

{
  const { world, typing } = typedSide();
  for (let i = 1; i <= 5; i++) typing.receive('B', msg({ s: i, k: undefined, p: 'x' + i }));
  check(
    'four pastes a minute, the fifth gets silence',
    world.writes.length === 4 && world.sent.length === 4
  );
}

{
  const { world, typing, last } = typedSide();
  const m = msg();
  typing.receive('B', m);
  const before = world.sent.length;
  typing.receive('B', { ...m, s: 2 });
  check(
    'a one-time number is taken once',
    world.sent.length === before && world.writes.length === 1
  );
  void last;
}

{
  const { world, typing, last } = typedSide({ fresh: false });
  typing.receive('B', msg());
  check('held back by the relay: refused', last().state === 'refused' && !world.writes.length);
}

{
  const { world, typing, last } = typedSide({ vs: null });
  typing.receive('B', msg());
  check(
    'no view open for that computer: changed',
    last().state === 'changed' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ v: hex(5) }));
  check(
    'another view than the open one: changed',
    last().state === 'changed' && !world.writes.length
  );
  typing.receive('B', msg({ id: 'pane-2' }));
  check(
    'another panel than the watched one: changed',
    last().state === 'changed' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide({ ticket: 'cd'.repeat(8) });
  typing.receive('B', msg());
  check(
    'the panel runs something else now (its ticket changed): changed',
    last().state === 'changed' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ to: 'cd'.repeat(8) }));
  check(
    "a ticket that is not the panel's: changed",
    last().state === 'changed' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ f: 4 }));
  check(
    'a picture number the view never sent: refused',
    last().state === 'refused' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ s: 2 }));
  check('a round must start at 1', last().state === 'refused' && !world.writes.length);
  typing.receive('B', msg({ s: 1 }));
  typing.receive('B', msg({ s: 3 }));
  check('a gap in a round is refused', last().state === 'refused' && world.writes.length === 1);
  typing.receive('B', msg({ s: 4 }));
  check(
    'and the round stays ended after a gap',
    last().state === 'refused' && world.writes.length === 1
  );
  typing.receive('B', msg({ s: 1, r: hex(78) }));
  check('a new round starts again at 1', last().state === 'done' && world.writes.length === 2);
  typing.receive('B', msg({ s: 2 }));
  check('a batch of the old round after a new one began is refused', last().state === 'refused');
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ s: 1 }));
  typing.receive('B', msg({ s: 1 }));
  check(
    'the same batch number twice is applied once',
    world.writes.length === 1 && last().state === 'refused'
  );
}

{
  const { world, typing, last } = typedSide({ agent: null });
  typing.receive('B', msg());
  check('the panel runs nothing now: refused', last().state === 'refused' && !world.writes.length);
}

{
  const { world, typing, last } = typedSide({
    agent: {
      cli: 'Terminal',
      name: 'PowerShell',
      running: true,
      mode: 'run',
      pid: 5,
      startedAt: 9,
    },
  });
  typing.receive('B', msg({ k: undefined, p: 'a\nb' }));
  check(
    'a paste of several lines into a plain terminal is refused, nothing typed',
    last().state === 'refused' && !world.writes.length
  );
}

// Stale: the screen moved on since the picture the typing computer drew.
{
  const { world, typing, last } = typedSide();
  world.vs.s = 4;
  world.vs.times.push([4, 400]);
  typing.receive('B', msg({ f: 3 }));
  check(
    'Enter on an older picture is refused as stale',
    last().state === 'stale' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  world.vs.dirty = true;
  world.vs.dirtyAt = 500;
  typing.receive('B', msg({ f: 3 }));
  check(
    'Enter while a changed screen waits to be sent is refused as stale',
    last().state === 'stale' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  world.vs.s = 4;
  world.vs.times.push([4, 400]);
  typing.receive('B', msg({ f: 3, k: [{ x: 'y' }] }));
  check(
    'a letter on an older picture with no chain of own typing is stale too',
    last().state === 'stale' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide();
  world.vs.s = 4;
  world.vs.times.push([4, 400]);
  typing.receive('B', msg({ f: 3, k: ['CtrlC'] }));
  check(
    'Ctrl+C alone lands on an older picture',
    last().state === 'done' && world.writes[0] === C(3)
  );
  typing.receive('B', msg({ s: 2, f: 3, k: ['Esc', 'Esc'] }));
  check(
    'Esc alone lands on an older picture',
    last().state === 'done' && world.writes[1] === ESC + ESC
  );
}

{
  // the echo: letters typed one batch after another while their own pictures are on the way
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'l' }] }));
  const landed = k.now();
  k.go(300);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  world.vs.dirty = true;
  world.vs.dirtyAt = k.now();
  typing.receive('B', msg({ s: 2, f: 3, k: [{ x: 's' }] }));
  check(
    'a letter after own letters lands while their echo is on its way',
    last().state === 'done' && world.writes.join('') === 'ls',
    last()
  );
  k.go(300);
  typing.receive('B', msg({ s: 3, f: 3, k: ['Enter'] }));
  check('but Enter waits for the newest picture: stale', last().state === 'stale');
  void landed;
}

{
  // review 23, L6: a question opened while the letters were on their way: no echo is assumed
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'l' }] }));
  k.go(300);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  world.vs.dirty = true;
  world.vs.dirtyAt = k.now();
  world.asking = true;
  typing.receive('B', msg({ s: 2, f: 3, k: [{ x: '1' }] }));
  check(
    'L6: a letter on a changed picture is stale while a question is open there',
    last().state === 'stale' && world.writes.join('') === 'l'
  );
}

{
  // review 23, L6: when the question state cannot be read, no echo is assumed either
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'l' }] }));
  k.go(300);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  world.asking = 'unknown';
  typing.receive('B', msg({ s: 2, f: 3, k: [{ x: 's' }] }));
  check('L6: an unknown question state counts as open', last().state === 'stale');
}

{
  // a change from before the chain began is not an echo
  const { world, typing, k, last } = typedSide();
  world.vs.s = 4;
  world.vs.times.push([4, k.now() - 50]);
  typing.receive('B', msg({ s: 1, f: 4, k: [{ x: 'l' }] }));
  k.go(300);
  world.vs.s = 5;
  world.vs.times.push([5, k.now() - 400]);
  typing.receive('B', msg({ s: 2, f: 4, k: [{ x: 's' }] }));
  check(
    'a picture that left before the own letters landed is not their echo',
    last().state === 'stale'
  );
}

{
  // the chain ends after ECHO_MS without a batch
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'l' }] }));
  k.go(T.ECHO_MS + 1);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  typing.receive('B', msg({ s: 2, f: 3, k: [{ x: 's' }] }));
  check('after two seconds without a batch the echo rule is over', last().state === 'stale');
}

{
  // Enter ends the chain: letters after it need a fresh picture
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'y' }, 'Enter'] }));
  k.go(300);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  typing.receive('B', msg({ s: 2, f: 3, k: [{ x: 'y' }] }));
  check('after Enter the next letter needs the newest picture', last().state === 'stale');
}

{
  // letters, then Enter on the newest picture, then output: the letters' chain ended with Enter
  const { world, typing, k, last } = typedSide();
  typing.receive('B', msg({ s: 1, f: 3, k: [{ x: 'l' }] }));
  k.go(300);
  typing.receive('B', msg({ s: 2, f: 3, k: ['Enter'] }));
  check('Enter on the newest picture lands', last().state === 'done');
  k.go(100);
  world.vs.s = 4;
  world.vs.times.push([4, k.now()]);
  k.go(200);
  typing.receive('B', msg({ s: 3, f: 3, k: [{ x: 'x' }] }));
  check('output after Enter is not an echo of the letters before it', last().state === 'stale');
}

{
  // the guard in the turn of the write
  const { world, typing, last } = typedSide();
  world.deliver = 'done';
  const realView = world.vs;
  const t2 = T.createTyping({
    rights: () => world.right,
    fresh: () => true,
    view: () => world.vs,
    ticket: () => world.ticket,
    agentNow: () => world.agent,
    deliver: o => {
      world.vs = null;
      return o.guard() ? 'done' : 'refused';
    },
    send: (id, obj) => world.sent.push(obj) > 0,
    log: () => () => {},
    mono: () => 1,
    random: n => Buffer.alloc(n, 3),
  });
  t2.receive('B', msg());
  check('the view ending between the check and the write: refused', last().state === 'refused');
  world.vs = realView;
  void typing;
}

{
  const { world, typing, last } = typedSide({ logOk: false });
  typing.receive('B', msg());
  check(
    'no list line can be written: nothing is typed',
    last().state === 'refused' && !world.writes.length
  );
}

{
  const { world, typing, last } = typedSide({ deliver: 'failed' });
  typing.receive('B', msg());
  check('a write that failed says failed', last().state === 'failed');
  world.deliver = 'done';
  typing.receive('B', msg({ s: 2 }));
  check('and the round is over after it', last().state === 'refused');
}

{
  // review 23, L7: a prompt half-way in that input: the typer hears "changed", the round ends
  const { world, typing, last } = typedSide({ deliver: 'changed' });
  typing.receive('B', msg());
  check('L7: a write held for a prompt in flight says changed', last().state === 'changed');
  world.deliver = 'done';
  typing.receive('B', msg({ s: 2 }));
  check('L7: and the round is over after it', last().state === 'refused');
}

{
  const { world, typing, last } = typedSide();
  typing.receive('B', msg({ s: 1 }));
  typing.endFor('B');
  typing.receive('B', msg({ s: 2 }));
  check('the right ended: a batch of the old round is refused', last().state === 'refused');
  typing.quit();
  const r = typing.receive('B', msg({ s: 1, r: hex(79) }));
  check('after quit nothing is read', r.ignored === true && world.writes.length === 1);
}

// The ticket of a plain terminal.
{
  const shell = {
    cli: 'Terminal',
    name: 'PowerShell',
    running: true,
    mode: 'run',
    pid: 11,
    startedAt: 22,
  };
  const w = { right: 'pair-1', a: shell };
  const make = seed =>
    T.createTyping({
      rights: () => w.right,
      agentNow: () => w.a,
      random: n => Buffer.alloc(n, seed),
    });
  const t1 = make(1);
  const tk = t1.ticketFor('B', 'pane-9');
  check(
    'a plain terminal gets a ticket for a computer with the typing right',
    /^[0-9a-f]{16}$/.test(tk)
  );
  check('the same panel and process: the same ticket', t1.ticketFor('B', 'pane-9') === tk);
  check('another computer: another ticket', t1.ticketFor('C', 'pane-9') !== tk);
  check('another start of the app: another ticket', make(2).ticketFor('B', 'pane-9') !== tk);
  w.a = { ...shell, pid: 12 };
  check('the shell restarted: another ticket', t1.ticketFor('B', 'pane-9') !== tk);
  w.a = { ...shell, mode: 'login' };
  check('a sign-in run gets none', t1.ticketFor('B', 'pane-9') === '');
  w.a = { ...shell, cli: 'Claude Code' };
  check(
    "an agent gets none from here (its ticket is remote-control.js's)",
    t1.ticketFor('B', 'pane-9') === ''
  );
  w.a = { ...shell, running: false };
  check('a stopped shell gets none', t1.ticketFor('B', 'pane-9') === '');
  w.a = shell;
  w.right = '';
  check('without the typing right there is none', t1.ticketFor('B', 'pane-9') === '');
}

// ---- the watched side's numbers, from the real live view ----
{
  const k = clock();
  const sent = [];
  let tick = 0;
  const views = createViews({
    rights: () => 'pair-1',
    granted: () => true,
    live: () => true,
    fresh: () => true,
    ticket: () => TICKET,
    agentName: () => 'Moss',
    peerName: () => 'Laptop',
    send: (id, obj) => sent.push(obj) > 0,
    screen: () => {},
    allowance: { read: () => ({}), write: () => {} },
    log: () => () => {},
    room: () => 100,
    now: () => 1e12 + k.now(),
    mono: () => k.now() + tick,
    timers: k.timers,
  });
  views.receive('B', { t: 'view', n: VIEW, c: 1, ms: 0, id: 'pane-1', to: TICKET });
  const screen = text => ({ cols: 10, rows: 1, lines: [[text]] });
  views.rows('pane-1', screen('a'));
  const st1 = views.typingState('B');
  check(
    'the open view as the typing checks read it',
    !!st1 && st1.v === VIEW && st1.panelId === 'pane-1' && st1.s === 1 && st1.dirty === false,
    st1
  );
  check('when each picture left', st1.times.length === 1 && st1.times[0][0] === 1);
  check('another computer has no view', views.typingState('C') === null);
  views.rows('pane-1', screen('ab'));
  const st2 = views.typingState('B');
  check(
    'a changed screen that waits for its picture is dirty',
    st2.dirty === true && st2.dirtyAt > 0,
    st2
  );
  k.go(1000);
  const st3 = views.typingState('B');
  check('once it left it is the newest picture', st3.s === 2 && st3.dirty === false, st3);
  views.endFor('B', 'off');
  check('the view ended: nothing to type into', views.typingState('B') === null);
  views.quit();
}

// ---- the typing side ----
function typingSide(over = {}) {
  const k = clock();
  const world = {
    view: { peer: 'A', agent: 'pane-1', v: VIEW, state: 'on', s: 3, at: 900 },
    fields: { id: 'pane-1', to: TICKET, c: 5, ms: 0 },
    allowed: true,
    out: [],
    statuses: [],
    sendOk: true,
    ...over,
  };
  let n = 0;
  const typer = T.createTyper({
    send: (id, obj) => world.sendOk && world.out.push(obj) > 0,
    fields: () => world.fields,
    seen: () => world.view,
    allowed: () => world.allowed,
    nonce: () => hex(++n),
    on: { changed: s => world.statuses.push(s) },
    mono: k.now,
    timers: k.timers,
  });
  const answer = state => {
    const m = world.out[world.out.length - 1];
    return typer.reply('A', { t: 'typed', n: m.n, state });
  };
  return { world, typer, k, answer };
}

{
  const { world, typer, k, answer } = typingSide();
  check(
    'a key with a view open goes at once',
    typer.press('A', 'pane-1', [{ x: 'l' }]) === 'sending'
  );
  const m1 = world.out[0];
  check(
    'it carries the view, the round, batch 1 and the picture drawn',
    m1.v === VIEW && m1.s === 1 && m1.f === 3 && m1.to === TICKET && m1.k[0].x === 'l'
  );
  typer.press('A', 'pane-1', [{ x: 's' }]);
  typer.press('A', 'pane-1', [{ x: 't' }]);
  typer.press('A', 'pane-1', ['Backspace']);
  check(
    'while one is on its way, the next keys are gathered (letters in a row as one piece) and the box says how many',
    world.out.length === 1 && typer.status().waiting === 2 && typer.status().sending === true,
    typer.status()
  );
  k.go(100);
  answer('done');
  check(
    'the reply sends what was gathered, as batch 2',
    world.out.length === 1 || world.out[1].s === 2
  );
  k.go(T.GAP_MS);
  check(
    'after the gap the gathered keys left together',
    world.out.length === 2 && world.out[1].k.length === 2
  );
  answer('done');
  check('the round goes on', typer.status().on === true && typer.status().said === 'done');
}

{
  const { world, typer, k, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'ls' }]);
  answer('done');
  k.go(T.GAP_MS);
  typer.press('A', 'pane-1', ['Enter']);
  check('Enter waits until a picture newer than the last batch arrived', world.out.length === 1);
  world.view = { ...world.view, s: 4, at: k.now() };
  typer.frame();
  check(
    "the new picture lets it go, with that picture's number",
    world.out.length === 2 && world.out[1].f === 4
  );
}

{
  const { world, typer, k, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'x' }]);
  answer('done');
  k.go(T.GAP_MS);
  typer.press('A', 'pane-1', ['Enter']);
  k.go(T.CATCH_UP_MS);
  check('a still screen (no echo): Enter goes after three seconds', world.out.length === 2);
}

{
  const { world, typer, k, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  answer('done');
  k.go(T.GAP_MS);
  typer.press('A', 'pane-1', [{ x: 'b' }, 'Enter', { x: 'c' }]);
  check(
    'letters before a held Enter go at once; Enter and what follows wait',
    world.out.length === 2 && world.out[1].k.length === 1 && typer.status().waiting === 2
  );
  void k;
}

{
  const { world, typer, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  answer('done');
  typer.press('A', 'pane-1', ['CtrlC']);
  check('Ctrl+C never waits for the picture (only the gap)', typer.status().waiting === 1);
  void world;
}

{
  const { world, typer, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  typer.press('A', 'pane-1', [{ x: 'b' }]);
  answer('stale');
  check(
    'a stale word ends the round, and the gathered keys are not sent (said, not kept)',
    world.out.length === 1 && typer.status().on === false && typer.status().said === 'stale'
  );
  typer.press('A', 'pane-1', [{ x: 'c' }]);
  check(
    'the next key starts a new round at 1',
    world.out[1].s === 1 && world.out[1].r !== world.out[0].r
  );
}

{
  const { world, typer, k } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  k.go(T.REPLY_MS);
  check(
    'no reply in 8 seconds: the round ends with "no reply", nothing sent again',
    typer.status().said === 'no_reply' && world.out.length === 1
  );
}

{
  const { world, typer } = typingSide();
  world.view = { ...world.view, s: 0, at: 0 };
  check(
    'a view with no picture yet: a key is not sent',
    typer.press('A', 'pane-1', [{ x: 'a' }]) === 'not_typing' && !world.out.length
  );
}

{
  const { world, typer } = typingSide({ view: null });
  check(
    'no view open: not typing, nothing sent',
    typer.press('A', 'pane-1', [{ x: 'a' }]) === 'not_typing' && !world.out.length
  );
}

{
  const { world, typer } = typingSide({ allowed: false });
  check(
    'that computer does not allow typing: nothing sent',
    typer.press('A', 'pane-1', [{ x: 'a' }]) === 'not_typing' && !world.out.length
  );
}

{
  const { world, typer } = typingSide();
  world.view = { ...world.view, state: 'ended' };
  check(
    'a view that ended is stale: nothing is sent',
    typer.press('A', 'pane-1', ['Enter']) === 'not_typing' && !world.out.length
  );
}

{
  const { world, typer } = typingSide();
  check(
    'another agent than the one watched: nothing sent',
    typer.press('A', 'pane-2', [{ x: 'a' }]) === 'not_typing' && !world.out.length
  );
}

{
  const { world, typer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  const r = typer.press('A', 'pane-1', Array(32).fill({ x: 'aaaaaaaaa' }));
  check(
    'more than one batch can hold: those keys are not taken, and it is said',
    r === 'too_much' && typer.status().said === 'too_much' && typer.status().waiting === 0
  );
  void world;
}

{
  const { world, typer, k, answer } = typingSide();
  for (let i = 0; i < 25; i++) {
    typer.press('A', 'pane-1', [{ x: 'a' }]);
    if (world.out.length > i) answer('done');
    k.go(T.GAP_MS);
  }
  check('the typing side keeps to 20 batches a minute', world.out.length === 20, world.out.length);
  k.go(60 * 1000);
  check('the rest go when the minute has room', world.out.length > 20);
}

{
  const { world, typer } = typingSide();
  check(
    'a paste goes as one batch',
    typer.paste('A', 'pane-1', 'one\r\ntwo') === 'sending' && world.out[0].p === 'one\ntwo'
  );
  check(
    'a paste over 1500 characters is not sent',
    typer.paste('A', 'pane-1', 'a'.repeat(1501)) === 'too_long'
  );
}

{
  const { world, typer } = typingSide({ sendOk: false });
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  check(
    'a send that did not leave ends the round with "failed"',
    typer.status().said === 'failed' && typer.status().on === false
  );
  void world;
}

{
  const { world, typer, k } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  typer.press('A', 'pane-1', [{ x: 'b' }]);
  typer.end();
  check(
    'leaving the box with keys waiting says they were not sent',
    typer.status().said === 'ended_unsent'
  );
  k.go(T.REPLY_MS + T.IDLE_MS);
  check('no timer is left', k.pending() === 0);
  void world;
}

{
  const { typer, k, answer } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  answer('done');
  k.go(T.IDLE_MS);
  check('a minute without a key ends the round', typer.status().on === false);
}

{
  const { typer, world } = typingSide();
  typer.press('A', 'pane-1', [{ x: 'a' }]);
  const n = world.out[0].n;
  check(
    'a reply from another computer is not read',
    typer.reply('C', { t: 'typed', n, state: 'done' }) === false
  );
  check(
    'a reply to another number is not read',
    typer.reply('A', { t: 'typed', n: hex(999), state: 'done' }) === false
  );
}

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);
