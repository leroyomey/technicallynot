// Test of the thread controls and past conversations of another computer (plan item 44):
// desktop/remote-thread.js, and the parts of desktop/remote-control.js (doThread, doResume) and
// desktop/remote-api.js (shapeOp) that carry them. node tools/remote-thread-test.js (plain Node,
// no window). Stand-ins for everything the app hands in; a clock and timers moved by hand.
'use strict';
const crypto = require('crypto');
const rt = require('../desktop/remote-thread.js');
const { createControl, shapeReply } = require('../desktop/remote-control.js');
const { shapeOp } = require('../desktop/remote-api.js');
const { MAX_PLAIN } = require('../desktop/remote-noise.js');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const wire = message => JSON.parse(JSON.stringify(message));
const tick = () => new Promise(resolve => setImmediate(resolve));

// odd characters are built from numbers, never written as themselves
const ch = String.fromCharCode;
const ZW = ch(0x200b);
const RLO = ch(0x202e);
const KEY = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const P1 = 'terminal-1759999999999-ab12';
const P2 = 'terminal-1759999999999-cd34';

const agent = (over = {}) => ({
  name: 'Moss',
  cli: 'Claude Code',
  mode: 'run',
  running: true,
  hand: false,
  instance: 'conv-1',
  pid: 4242,
  startedAt: 1699999990000,
  ...over,
});

function timersFor(w) {
  return {
    set: (fn, ms) => {
      const handle = { at: w.t + ms, fn };
      w.timers.push(handle);
      return handle;
    },
    clear: handle => {
      const at = w.timers.indexOf(handle);
      if (at >= 0) w.timers.splice(at, 1);
    },
  };
}

function advance(w, ms) {
  const end = w.t + ms;
  for (;;) {
    const due = w.timers.filter(h => h.at <= end).sort((x, y) => x.at - y.at)[0];
    if (!due) break;
    w.timers.splice(w.timers.indexOf(due), 1);
    w.t = Math.max(w.t, due.at);
    due.fn();
  }
  w.t = end;
}

// ---------------------------------------------------------------- 1. the values
{
  const v = rt.threadValue;
  check('rename: a plain name is taken as it is', v('rename', 'Willow 2') === 'Willow 2');
  check('rename: an empty name is refused', v('rename', '') === null);
  check('rename: a name must start with a letter or a number', v('rename', '-x') === null);
  check('rename: 41 characters is too long', v('rename', 'a'.repeat(41)) === null);
  check('rename: 40 characters is fine', v('rename', 'a'.repeat(40)) === 'a'.repeat(40));
  check(
    'rename: a zero-width or direction character is refused, never cleaned into another name',
    v('rename', 'Mo' + ZW + 'ss') === null && v('rename', 'Moss' + RLO) === null
  );
  check('rename: a line break is refused', v('rename', 'Moss\nKite') === null);
  check(
    'model: Claude Code ids are taken',
    v('model', 'claude-opus-5-5') === 'claude-opus-5-5' &&
      v('model', 'sonnet[1m]') === 'sonnet[1m]' &&
      v('model', 'opus') === 'opus'
  );
  check(
    'model: a space, a slash command or a shell character is refused',
    v('model', 'opus; rm') === null &&
      v('model', '/clear') === null &&
      v('model', 'a b') === null &&
      v('model', 'x'.repeat(65)) === null
  );
  check(
    'effort: only the five words',
    rt.EFFORTS.every(e => v('effort', e) === e) && v('effort', 'ultra') === null
  );
  check(
    'close: no value, anything else refused',
    v('close', undefined) === '' && v('close', '') === '' && v('close', 'x') === null
  );
  check('an unknown word is refused', v('delete', 'x') === null && v('__proto__', 'x') === null);
  check(
    'which CLI takes what: only Claude Code switches model and effort from here',
    rt.threadCan('Claude Code', 'model') &&
      rt.threadCan('Claude Code', 'effort') &&
      !rt.threadCan('Codex', 'model') &&
      !rt.threadCan('OpenCode', 'effort') &&
      !rt.threadCan('Cursor Agent', 'model') &&
      rt.threadCan('Codex', 'rename') &&
      rt.threadCan('Codex', 'close') &&
      !rt.threadCan('Terminal', 'close') &&
      !rt.threadCan('constructor', 'close')
  );
}

// ---------------------------------------------------------------- 2. the wire shapes
{
  const head = { n: '0123456789abcdef', c: 3, ms: 10 };
  const to = 'f'.repeat(16);
  const one = shapeOp({ ...head, t: 'thread', id: P1, to, do: 'rename', v: 'Kite', extra: 1 });
  check(
    'shapeOp: a rename keeps its fields and nothing else',
    !!one &&
      JSON.stringify(Object.keys(one).sort()) ===
        JSON.stringify(['c', 'do', 'id', 'ms', 'n', 't', 'to', 'v']) &&
      one.v === 'Kite',
    one
  );
  const closeOp = shapeOp({ ...head, t: 'thread', id: P1, to, do: 'close', v: 'x' });
  check('shapeOp: a close with a value is no operation', closeOp === null);
  check(
    'shapeOp: a close carries no value',
    shapeOp({ ...head, t: 'thread', id: P1, to, do: 'close' })?.v === undefined
  );
  check(
    'shapeOp: no ticket, no thread operation',
    shapeOp({ ...head, t: 'thread', id: P1, do: 'close' }) === null
  );
  check(
    'shapeOp: a bad value is no operation',
    shapeOp({ ...head, t: 'thread', id: P1, to, do: 'model', v: 'a b' }) === null
  );
  const resume = shapeOp({ ...head, t: 'resume', h: 'c'.repeat(16), project: KEY, id: P1 });
  check(
    'shapeOp: a resume carries the handle and the project, never a row, a path or an id',
    !!resume &&
      JSON.stringify(Object.keys(resume).sort()) ===
        JSON.stringify(['c', 'h', 'ms', 'n', 'project', 't']),
    resume
  );
  check(
    'shapeOp: a resume with a handle of the wrong form, or a name-form project, is none',
    shapeOp({ ...head, t: 'resume', h: 'C'.repeat(16), project: KEY }) === null &&
      shapeOp({ ...head, t: 'resume', h: 'c'.repeat(16), project: 'n' + KEY }) === null
  );
  check(
    'shapeReply: busy is a word of its own for a thread operation, anything else unknown is refused',
    shapeReply({ t: 'threaded', n: head.n, ok: false, state: 'busy' }).state === 'busy' &&
      shapeReply({ t: 'threaded', n: head.n, ok: false, state: 'whatever' }).state === 'refused' &&
      shapeReply({ t: 'threaded', n: head.n, ok: true, state: 'done' }).ok === true &&
      shapeReply({ t: 'resumed', n: head.n, ok: true, state: 'started' }).ok === true &&
      shapeReply({ t: 'resumed', n: head.n, ok: true, state: 'busy' }).ok === false
  );
}

// ---------------------------------------------------------------- 3. the checks (remote-control)
function world() {
  const w = {
    t: 1700000000000,
    timers: [],
    sent: [],
    logs: [],
    nn: 0,
    rights: { A: 'pair-1' },
    live: { A: true },
    agents: {
      [P1]: agent(),
      [P2]: agent({ name: 'Fern', cli: 'Codex', instance: 'conv-2', pid: 4343 }),
    },
    clis: ['Claude Code', 'OpenCode'],
    open: KEY,
    remote: 0,
    calls: { thread: [], resume: [] },
    threadSays: 'done',
    resumeSays: 'started',
    pastRows: new Map([['c'.repeat(16), { cli: 'Claude Code', id: 'conv-old', title: 'Fix it' }]]),
  };
  w.control = createControl({
    rights: id => w.rights[id] ?? '',
    live: id => w.live[id] === true,
    peerName: () => 'Desk',
    agentNow: id => (Object.hasOwn(w.agents, id) ? w.agents[id] : null),
    clis: () => w.clis,
    openKey: () => w.open,
    remoteStarted: () => w.remote,
    send: (id, obj) => {
      w.sent.push({ peer: id, ...wire(obj) });
      return true;
    },
    log: entry => w.logs.push(entry),
    thread: o => {
      w.calls.thread.push(o);
      return typeof w.threadSays === 'function' ? w.threadSays(o) : w.threadSays;
    },
    past: { find: (peerId, h) => (peerId === 'A' ? w.pastRows.get(h) || null : null) },
    resume: o => {
      w.calls.resume.push(o);
      return w.resumeSays;
    },
    now: () => w.t,
    timers: timersFor(w),
  });
  w.n = () => (++w.nn).toString(16).padStart(16, '0');
  const head = () => ({ n: w.n(), c: w.control.stamp('A'), ms: 0 });
  w.thread = (what, value, over = {}) => {
    const id = 'id' in over ? over.id : P1;
    const op = { t: 'thread', ...head(), id, to: w.control.ticketFor('A', id), do: what, ...over };
    if (value !== undefined) op.v = value;
    return op;
  };
  w.resume = (over = {}) => ({ t: 'resume', ...head(), h: 'c'.repeat(16), project: KEY, ...over });
  w.go = async m => {
    const before = w.sent.length;
    const r = await w.control.receive('A', wire(m));
    return { r, back: w.sent.slice(before) };
  };
  return w;
}

async function controlChecks() {
  {
    const w = world();
    const x = await w.go(w.thread('rename', 'Kite'));
    check(
      'a rename with the row ticket reaches the delivery with the checked name and who asked',
      w.calls.thread.length === 1 &&
        w.calls.thread[0].what === 'rename' &&
        w.calls.thread[0].value === 'Kite' &&
        w.calls.thread[0].from === 'Desk' &&
        w.calls.thread[0].panelId === P1 &&
        x.back[0].t === 'threaded' &&
        x.back[0].ok === true,
      x.back
    );
    check(
      'it is written to the control list before the delivery, with its value',
      w.logs.length === 1 && w.logs[0].op === 'rename' && w.logs[0].head === 'Kite'
    );
    const guard = w.calls.thread[0].guard;
    check('the guard holds right after', guard() === true);
    w.rights.A = '';
    check('the guard says no once full control went off', guard() === false);
  }
  {
    const w = world();
    const bad = w.thread('rename', 'Kite', { to: '0'.repeat(16) });
    const x = await w.go(bad);
    check(
      'a wrong ticket is refused and nothing is delivered',
      w.calls.thread.length === 0 && x.back[0].t === 'threaded' && x.back[0].state === 'refused'
    );
  }
  {
    const w = world();
    const x = await w.go(w.thread('model', 'opus', { id: P2 }));
    check(
      'a model for Codex is refused here, not typed (its picker needs its own screen)',
      w.calls.thread.length === 0 && x.back[0].state === 'refused'
    );
    const y = await w.go(w.thread('close', undefined, { id: P2 }));
    check('a close for Codex is taken', w.calls.thread.length === 1 && y.back[0].ok === true);
  }
  {
    const w = world();
    w.threadSays = 'busy';
    const x = await w.go(w.thread('effort', 'high'));
    check(
      'busy comes back as busy, so the other computer can say "switch when it is idle"',
      x.back[0].ok === false && x.back[0].state === 'busy'
    );
    w.threadSays = 'deleted everything';
    const y = await w.go(w.thread('effort', 'low'));
    check('an unknown word from the delivery reads as failed', y.back[0].state === 'failed');
  }
  {
    const w = world();
    const once = w.thread('rename', 'Kite');
    await w.go(once);
    const again = await w.go(once);
    check(
      'the same one-time number twice is refused the second time',
      w.calls.thread.length === 1 && again.back[0].state === 'refused'
    );
  }
  {
    const w = world();
    w.rights.A = '';
    const x = await w.go(w.thread('rename', 'Kite'));
    check(
      'full control off: nothing is done and nothing is sent back',
      w.calls.thread.length === 0 && x.back.length === 0 && x.r.silent === 'off'
    );
  }
  {
    const w = world();
    for (let i = 0; i < 7; i++) await w.go(w.thread('rename', 'Kite' + i));
    check('6 a minute for one computer, the 7th gets silence', w.calls.thread.length === 6);
    w.t += 61000;
    await w.go(w.thread('rename', 'Kite9'));
    check('a minute later it is taken again', w.calls.thread.length === 7);
  }
  {
    const w = world();
    const x = await w.go(w.resume());
    check(
      'a resume reaches the delivery with the CLI and the conversation from this computer’s own list',
      w.calls.resume.length === 1 &&
        w.calls.resume[0].cli === 'Claude Code' &&
        w.calls.resume[0].id === 'conv-old' &&
        x.back[0].t === 'resumed' &&
        x.back[0].ok === true,
      w.calls.resume
    );
    check(
      'it is written to the control list',
      w.logs.some(e => e.op === 'resume')
    );
    const guard = w.calls.resume[0].guard;
    check(
      'its guard holds for a panel of this project only',
      guard(KEY) === true && guard(OTHER) === false && guard('') === false
    );
  }
  {
    const w = world();
    const x = await w.go(w.resume({ h: 'd'.repeat(16) }));
    check(
      'a handle that is not in the list sent is refused',
      w.calls.resume.length === 0 && x.back[0].state === 'refused'
    );
    const y = await w.go(w.resume({ project: OTHER }));
    check(
      'another project than the one open here is refused',
      w.calls.resume.length === 0 && y.back[0].state === 'refused'
    );
    w.clis = ['OpenCode'];
    const z = await w.go(w.resume());
    check(
      'a CLI that is not ready here is refused',
      w.calls.resume.length === 0 && z.back[0].state === 'refused'
    );
  }
  {
    const w = world();
    w.remote = 3;
    const x = await w.go(w.resume());
    check(
      'with 3 agents from other computers open, a resume is refused like a start',
      w.calls.resume.length === 0 && x.back[0].state === 'refused'
    );
  }
  {
    const w = world();
    for (let i = 0; i < 4; i++) await w.go(w.resume());
    check('a resume is counted with the starts: 3 a minute', w.calls.resume.length === 3);
  }
}

// ---------------------------------------------------------------- 4. the real actions
async function actionChecks() {
  const make = (over = {}) => {
    const w = { renamed: [], closed: [], typed: [], notes: [] };
    w.actions = rt.createThreadActions({
      agentNow: id => (id === P1 ? agent() : id === P2 ? agent({ cli: 'Codex' }) : null),
      busy: () => false,
      blocked: () => false,
      taken: (id, name) => id !== P1 || name.toLowerCase() === 'lead',
      rename: async (id, name, from) => {
        w.renamed.push([id, name, from]);
        return true;
      },
      close: async (id, from) => {
        w.closed.push([id, from]);
        return true;
      },
      type: async (id, text, cli) => {
        w.typed.push([id, text, cli]);
        return { ok: true, state: 'sent' };
      },
      noted: (id, words) => w.notes.push(words),
      ...over,
    });
    return w;
  };
  const yes = () => true;
  {
    const w = make();
    const word = await w.actions.run({
      panelId: P1,
      what: 'rename',
      value: 'Kite',
      from: 'Desk',
      guard: yes,
    });
    check(
      'rename goes through the window’s own rename with who asked',
      word === 'done' && w.renamed.length === 1 && w.renamed[0][2] === 'Desk'
    );
  }

  // review 23, L5: a name another agent here has is refused, letter case ignored
  {
    const w = make();
    const word = await w.actions.run({
      panelId: P1,
      what: 'rename',
      value: 'LEAD',
      from: 'Desk',
      guard: yes,
    });
    check('L5: a rename to a name another agent has is refused', word === 'refused');
    check('L5: nothing reaches the window', w.renamed.length === 0);
  }
  {
    const w = make({ taken: undefined });
    const word = await w.actions.run({
      panelId: P1,
      what: 'rename',
      value: 'Kite',
      from: 'Desk',
      guard: yes,
    });
    check('L5: without the names known, a rename is refused', word === 'refused');
  }
  {
    const w = make({
      taken: () => {
        throw new Error('x');
      },
    });
    const word = await w.actions.run({
      panelId: P1,
      what: 'rename',
      value: 'Kite',
      from: 'Desk',
      guard: yes,
    });
    check('L5: a check that throws refuses', word === 'refused' && w.renamed.length === 0);
  }
  {
    const w = make();
    const word = await w.actions.run({
      panelId: P1,
      what: 'model',
      value: 'opus',
      from: 'Desk',
      guard: yes,
    });
    check(
      'a model is typed as the CLI’s own command and said where it lands',
      word === 'done' &&
        w.typed.length === 1 &&
        w.typed[0][1] === '/model opus' &&
        w.notes.length === 1 &&
        w.notes[0].includes('Desk')
    );
  }
  {
    const w = make({ busy: () => true });
    const word = await w.actions.run({
      panelId: P1,
      what: 'effort',
      value: 'high',
      from: 'Desk',
      guard: yes,
    });
    check('a working agent gets nothing typed: busy', word === 'busy' && w.typed.length === 0);
  }
  {
    const w = make({ blocked: () => true });
    const word = await w.actions.run({
      panelId: P1,
      what: 'effort',
      value: 'high',
      from: 'Desk',
      guard: yes,
    });
    check(
      'an open question or the user’s unsent text: nothing typed into that input',
      word === 'busy' && w.typed.length === 0
    );
  }
  {
    const w = make({ busy: () => undefined });
    const word = await w.actions.run({
      panelId: P1,
      what: 'effort',
      value: 'high',
      from: 'Desk',
      guard: yes,
    });
    check('a busy check that cannot answer reads as busy', word === 'busy' && w.typed.length === 0);
  }
  {
    const w = make();
    const word = await w.actions.run({
      panelId: P2,
      what: 'model',
      value: 'gpt',
      from: 'Desk',
      guard: yes,
    });
    check('Codex: a model is refused here too', word === 'refused' && w.typed.length === 0);
  }
  {
    const w = make();
    const no = () => false;
    const words = [];
    for (const what of ['rename', 'close', 'model'])
      words.push(
        await w.actions.run({
          panelId: P1,
          what,
          value: what === 'model' ? 'opus' : 'Kite',
          from: 'Desk',
          guard: no,
        })
      );
    check(
      'a guard that says no at the write: nothing renamed, closed or typed',
      words.every(word => word === 'refused') &&
        !w.renamed.length &&
        !w.closed.length &&
        !w.typed.length
    );
  }
  {
    const w = make({ close: async () => false });
    const word = await w.actions.run({
      panelId: P1,
      what: 'close',
      value: '',
      from: 'Desk',
      guard: yes,
    });
    check('a close the window did not do reads as failed', word === 'failed');
  }
  {
    const w = make({ type: async () => ({ ok: false }) });
    const word = await w.actions.run({
      panelId: P1,
      what: 'model',
      value: 'opus',
      from: 'Desk',
      guard: yes,
    });
    check(
      'a command the CLI did not take reads as failed, and nothing is said',
      word === 'failed' && !w.notes.length
    );
  }
}

// ---------------------------------------------------------------- 5. past conversations
async function pastChecks() {
  const threads = [];
  for (let i = 0; i < 45; i++)
    threads.push({
      key: 'Claude Code\nid-' + i,
      cli: i === 3 ? 'Terminal' : 'Claude Code',
      id: 'id-' + i,
      title:
        i === 0
          ? 'Use the key sk-ant-' + 'x'.repeat(30) + ' here'
          : 'Conversation ' + i + ' ' + 'é'.repeat(70),
      at: 1700000000000 - i,
    });
  const make = (over = {}) => {
    const w = { t: 1700000000000, sent: [], lists: 0, may: true, same: true };
    w.answerer = rt.createPastAnswerer({
      now: () => w.t,
      may: () => w.may,
      sameProject: () => w.same,
      list: async () => {
        w.lists++;
        return { threads };
      },
      send: (peerId, obj) => {
        w.sent.push(wire(obj));
        return true;
      },
      ...over,
    });
    return w;
  };
  const settle = async () => {
    for (let i = 0; i < 5; i++) await tick();
  };
  {
    const w = make();
    w.answerer.receive('A', { t: 'pastask', n: '1'.repeat(16) });
    await settle();
    const rows = w.sent.flatMap(part => part.rows);
    check(
      'at most 30 rows, newest first, other kinds of panel left out',
      rows.length === 30 && !rows.some(r => r.cli !== 'claude')
    );
    check(
      'every part fits one sealed message, at most 2 parts',
      w.sent.length <= 2 && w.sent.every(part => Buffer.byteLength(JSON.stringify(part)) <= 4094)
    );
    check(
      'a handle is 16 random hex, never the conversation id',
      rows.every(r => /^[0-9a-f]{16}$/.test(r.h) && !r.h.includes('id-'))
    );
    check(
      'a key pasted into the first words is masked',
      !JSON.stringify(rows).includes('sk-ant-' + 'x'.repeat(30))
    );
    check(
      'nothing but the four fields crosses',
      rows.every(
        r => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(['at', 'cli', 'h', 'title'])
      )
    );
    const first = rows[0].h;
    const found = w.answerer.find('A', first);
    check('the handle finds the conversation it was made for', !!found && found.id === 'id-0');
    check('another computer cannot use it', w.answerer.find('C', first) === null);
    w.answerer.receive('A', { t: 'pastask', n: '2'.repeat(16) });
    await settle();
    check(
      'one-time: a new list ends the handles of the one before',
      w.answerer.find('A', first) === null
    );
    const latest = w.sent[w.sent.length - 1].rows[0].h;
    w.may = false;
    check('the right went off: the handle reads nothing', w.answerer.find('A', latest) === null);
    w.may = true;
    w.t += 30 * 60 * 1000;
    check('after 30 minutes the handle reads nothing', w.answerer.find('A', latest) === null);
  }
  {
    const w = make();
    for (let i = 0; i < 6; i++)
      w.answerer.receive('A', { t: 'pastask', n: (i + 1).toString(16).padStart(16, '0') });
    await settle();
    check(
      '4 asks a minute for one computer: the rest are not answered and read nothing',
      w.lists <= 4
    );
  }
  {
    const w = make();
    w.may = false;
    w.answerer.receive('A', { t: 'pastask', n: '3'.repeat(16) });
    w.may = true;
    w.same = false;
    w.answerer.receive('A', { t: 'pastask', n: '4'.repeat(16) });
    await settle();
    check(
      'without the conversations right, or with another project open there: nothing is read or sent',
      w.lists === 0 && w.sent.length === 0
    );
  }
  {
    const w = make();
    w.answerer.receive('A', { t: 'pastask', n: '5'.repeat(16) });
    w.answerer.receive('A', { t: 'pastask', n: '5'.repeat(16) });
    await settle();
    check('the same number twice is answered once', w.lists === 1);
    w.answerer.endFor('A');
    check(
      'the session ended: every handle goes',
      w.answerer.find('A', w.sent[0].rows[0].h) === null
    );
  }

  // the reading side
  {
    const w = { t: 1700000000000, timers: [], sent: [], changed: 0 };
    let next = 0;
    const reader = rt.createPastReader({
      now: () => w.t,
      timers: timersFor(w),
      nonce: () => (++next).toString(16).padStart(16, '0'),
      send: (peerId, obj) => {
        w.sent.push({ peerId, ...wire(obj) });
        return true;
      },
      on: { changed: () => w.changed++ },
    });
    const asked = reader.ask('A');
    check(
      'an ask sends pastask with a number only',
      asked.state === 'asked' &&
        JSON.stringify(Object.keys(w.sent[0]).sort()) === JSON.stringify(['n', 'peerId', 't'])
    );
    check('asking again within 10 seconds is too often', reader.ask('A').state === 'too_often');
    const n = w.sent[0].n;
    const row = { h: 'e'.repeat(16), cli: 'claude', title: 'Hello', at: 5 };
    check(
      'a list from another computer is not taken',
      reader.receive('C', { t: 'past', n, i: 0, parts: 1, rows: [row] }) === false
    );
    check(
      'a list for a number nobody asked is not taken',
      reader.receive('A', { t: 'past', n: 'f'.repeat(16), i: 0, parts: 1, rows: [row] }) === false
    );
    reader.receive('A', { t: 'past', n, i: 0, parts: 2, rows: [row] });
    check('one part of two: still reading', reader.get('A').state === 'reading');
    reader.receive('A', {
      t: 'past',
      n,
      i: 1,
      parts: 2,
      rows: [
        { ...row, h: 'd'.repeat(16), cli: 'nope' },
        { ...row, h: '9'.repeat(16), title: 'x' + RLO },
      ],
    });
    const got = reader.get('A');
    check(
      'the whole list is held, a row of an unknown CLI dropped, names shown as the app names them',
      got.state === 'ready' && got.rows.length === 2 && got.rows[0].cli === 'Claude Code',
      got
    );
    check('invisible characters in a title are cleaned', !got.rows[1].title.includes(RLO));
    check(
      'has() knows the handles held',
      reader.has('A', 'e'.repeat(16)) && !reader.has('A', 'd'.repeat(16))
    );
    reader.drop('A');
    check(
      'the session ended: nothing is held',
      reader.get('A') === null && !reader.has('A', 'e'.repeat(16))
    );
    w.t += 11000;
    reader.ask('A');
    advance(w, 16000);
    check('no answer within 15 seconds: no_reply', reader.get('A').state === 'no_reply');
  }
}

(async () => {
  await controlChecks();
  await actionChecks();
  await pastChecks();
  void crypto;
  void MAX_PLAIN;
  console.log(passed + ' passed, ' + failed + ' failed (Node ' + process.versions.node + ')');
  process.exitCode = failed ? 1 : 0;
})().catch(error => {
  console.log('ERROR ' + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
