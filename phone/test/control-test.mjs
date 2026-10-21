// Test of phone/src/control.mjs:  node phone/test/control-test.mjs  (plain Node, no browser).
// The phone as a controller of a paired computer's agents, against the computer's real code:
// desktop/remote-api.js sends the lists and reads the operations, desktop/remote-control.js checks
// each operation and answers it, exactly as remote-service.js wires them. Messages cross as JSON,
// as the sealed session carries them. What it proves: the phone reads the agent list with its
// tickets, "you may control", the open project, finished tasks and a question's options; a
// prompt, Interrupt, Stop, a choice and a start from the phone are taken by the computer and their
// words come back; held-back and forged operations are refused there; nothing is sent without
// control or without a session; the phone's checks of a prompt agree with the computer's.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { createControl, promptOk, bindingPick } from '../src/control.mjs';

const require = createRequire(import.meta.url);
const api = require('../../desktop/remote-api.js');
const ctl = require('../../desktop/remote-control.js');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const PHONE = 'ph-0123456789';
const KEY = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

// A hand-moved clock and timers for both sides.
function clock() {
  const c = { t: 1_000_000, list: [] };
  c.now = () => c.t;
  c.timers = {
    set: (fn, ms) => {
      const h = { fn, at: c.t + ms };
      c.list.push(h);
      return h;
    },
    clear: h => {
      c.list = c.list.filter(x => x !== h);
    },
  };
  c.move = ms => {
    c.t += ms;
    for (const h of [...c.list].sort((a, b) => a.at - b.at))
      if (h.at <= c.t && c.list.includes(h)) {
        c.list = c.list.filter(x => x !== h);
        h.fn();
      }
  };
  return c;
}

// The computer: its agents, what it lets this phone do, and every delivery it was asked for.
function computer(c, phone) {
  const w = {
    on: true,
    delivered: [],
    agents: [
      {
        id: 'p1',
        name: 'Moss',
        cli: 'Claude Code',
        status: 'working',
        since: 900_000,
        task: 'Add card payments',
        p: KEY,
      },
      {
        id: 'p2',
        name: 'Rook',
        cli: 'OpenCode',
        status: 'idle',
        since: 800_000,
        task: 'Write tests',
        p: KEY,
      },
    ],
    items: [],
    toPhone: [],
  };
  const running = name => ({
    name,
    cli: name === 'Moss' ? 'Claude Code' : 'OpenCode',
    mode: 'run',
    running: true,
    hand: false,
    instance: 'i-' + name,
    pid: 4242,
    startedAt: 5,
  });
  const deliver = kind => o => {
    w.delivered.push({ kind, ...(typeof o === 'object' ? o : { panelId: o }) });
    return kind === 'prompt' ? 'sent' : kind === 'start' ? 'started' : 'done';
  };
  const toPhone = (id, obj) => {
    if (id !== PHONE) return false;
    w.toPhone.push(obj);
    phone.onMessage(PHONE, JSON.parse(JSON.stringify(obj)));
    return true;
  };
  w.control = ctl.createControl({
    rights: id => (id === PHONE && w.on ? 'pairing-1' : ''),
    live: id => id === PHONE,
    peerName: () => 'Pixel',
    agentNow: id => (id === 'p1' ? running('Moss') : id === 'p2' ? running('Rook') : null),
    clis: () => ['Claude Code', 'Codex'],
    openKey: () => KEY,
    remoteStarted: () => 0,
    send: toPhone,
    log: () => {},
    prompt: deliver('prompt'),
    interrupt: deliver('interrupt'),
    stop: deliver('stop'),
    start: deliver('start'),
    choose: deliver('choose'),
    thread: deliver('thread'),
    busy: () => false,
    now: c.now,
    random: n => crypto.randomBytes(n),
    timers: c.timers,
  });
  w.api = api.createRemoteApi({
    send: toPhone,
    items: () => w.items,
    agents: () => w.agents,
    project: () => ({ root: KEY, head: HEAD }),
    showDetail: () => true,
    pick: (id, s, it) => (w.on ? ctl.withPick(s, it) : s),
    readPick: ctl.readPick,
    ticket: (id, panelId) => (w.on ? w.control.ticketFor(id, panelId) : ''),
    stamp: id => (w.on ? w.control.stamp(id) : 0),
    starts: () => (w.on ? ['claude', 'codex'] : null),
    reply: ctl.shapeReply,
    now: c.now,
    timers: c.timers,
  });

  // What the phone sends: read as remote-service.js reads it, through shapeOp into the checks.
  w.fromPhone = obj => {
    const plain = JSON.parse(JSON.stringify(obj));
    const r = w.control.receive(PHONE, api.shapeOp(plain) || { t: plain.t, n: plain.n });
    if (process.env.DEBUG) console.log('recv', plain.t, JSON.stringify(r));
    return r;
  };
  return w;
}

const settle = () => new Promise(r => setTimeout(r, 0));

async function world() {
  const c = clock();
  const sent = [];
  const box = {};
  const phone = createControl({
    send: (id, obj) => {
      sent.push(obj);
      return box.w ? (box.w.fromPhone(obj), true) : false;
    },
    now: c.now,
    wall: c.now,
    timers: c.timers,
  });
  box.w = computer(c, phone);
  return { c, phone, w: box.w, sent };
}

// ---- 1. what the phone reads ----
{
  const { c, phone, w } = await world();
  phone.sessionStarted(PHONE);
  w.api.sessionStarted(PHONE);
  await settle();
  c.move(4000);
  await settle();
  const v = phone.view(PHONE);
  check('R1 the agent list arrives with both rows', v && v.agents.length === 2, v && v.agents);
  check(
    'R2 every row carries its ticket while control is on',
    v.agents.every(a => /^[0-9a-f]{16}$/.test(a.to))
  );
  check(
    'R3 the task and the project key are kept',
    v.agents[0].task === 'Add card payments' && v.agents[0].p === KEY
  );
  check(
    'R4 "you may control" with the CLIs that can start',
    v.control && v.control.clis.join() === 'claude,codex',
    v.control
  );
  check(
    'R5 the open project arrives',
    v.project && v.project.root === KEY && v.project.head === HEAD
  );
  check('R6 the session reads as live', v.state === 'live');

  // a finished task
  w.api.reported({
    id: 'p1',
    name: 'Moss',
    cli: 'Claude Code',
    at: c.t,
    task: 'Add card payments',
    did: 'Built the form',
    text: 'Did: built it\n\n\nNext: tests',
    p: KEY,
  });
  c.move(1000);
  await settle();
  const r = phone.view(PHONE).reports;
  check(
    'R7 a finished task arrives with its short result',
    r.length === 1 && r[0].did === 'Built the form',
    r
  );
  check(
    'R8 blank lines are joined as the sender joins them',
    r[0] && r[0].text === 'Did: built it\n\nNext: tests',
    r[0] && r[0].text
  );

  // a question with its options
  w.items = [
    {
      id: 'm1',
      kind: 'menu',
      agent: 'Moss',
      since: 990_000,
      detail: 'Which plan?',
      paneId: 'p2',
      opts: ['Small', 'Large'],
    },
  ];
  w.api.itemsChanged?.();
  w.api.sessionStarted(PHONE);
  phone.sessionStarted(PHONE);
  w.api.sessionStarted(PHONE);
  await settle();
  c.move(4000);
  await settle();
  const ch = phone.view(PHONE).choices;
  check(
    'R9 a question that takes a choice arrives with its options and row',
    ch.length === 1 && ch[0].opts.join() === 'Small,Large' && ch[0].row === 'p2',
    ch
  );
  const sameKof = ch[0] && ch[0].kof === ctl.bindingPick({ ...ch[0] });
  check('R10 the phone binds the choice with the same bytes as the computer', sameKof, ch[0]);

  // ---- 2. operations ----
  const before = w.delivered.length;
  const p = await phone.prompt(PHONE, 'p1', 'Run the tests');
  await settle();
  check('O1 a prompt leaves', p.state === 'asked', p);
  check(
    'O2 the computer delivers it to that agent',
    w.delivered.length === before + 1 &&
      w.delivered.at(-1).kind === 'prompt' &&
      w.delivered.at(-1).text === 'Run the tests',
    w.delivered.at(-1)
  );
  const pv = phone.view(PHONE).ops.find(o => o.n === p.n);
  check('O3 its word comes back: sent', pv && pv.state === 'sent', pv);

  const i = await phone.act(PHONE, 'p1', 'interrupt');
  await settle();
  check(
    'O4 Interrupt is taken and answered done',
    phone.view(PHONE).ops.find(o => o.n === i.n)?.state === 'done' &&
      w.delivered.at(-1).kind === 'interrupt'
  );
  const s = await phone.act(PHONE, 'p2', 'stop');
  await settle();
  check(
    'O5 Stop is taken and answered done',
    phone.view(PHONE).ops.find(o => o.n === s.n)?.state === 'done' &&
      w.delivered.at(-1).kind === 'stop'
  );
  const bad = await phone.act(PHONE, 'p2', 'kill');
  check('O6 a word that is not interrupt or stop is never sent', bad.state === 'not_sent');

  const k = await phone.choose(PHONE, 'm1', 2, ch[0].kof);
  await settle();
  check(
    'O7 a choice is taken: option 2 of that question',
    phone.view(PHONE).ops.find(o => o.n === k.n)?.state === 'done' &&
      w.delivered.at(-1).kind === 'choose' &&
      w.delivered.at(-1).pick === 2,
    w.delivered.at(-1)
  );
  const k2 = await phone.choose(PHONE, 'm1', 3, ch[0].kof);
  check('O8 an option outside the list is never sent', k2.state === 'not_sent');
  const k3 = await phone.choose(PHONE, 'm1', 1, 'wrongbinding');
  check('O9 a choice with another binding is never sent', k3.state === 'not_sent');

  const st = await phone.start(PHONE, 'claude', 'Fix the gift card tax');
  await settle();
  check(
    'O10 a start in the open project is taken',
    phone.view(PHONE).ops.find(o => o.n === st.n)?.state === 'started' &&
      w.delivered.at(-1).kind === 'start',
    w.delivered.at(-1)
  );
  const st2 = await phone.start(PHONE, 'cursor', '');
  check('O11 a CLI the computer did not offer is never sent', st2.state === 'not_sent');

  // a prompt the computer will refuse: the phone's check agrees
  check(
    "O12 the phone and the computer agree on a prompt's first character",
    !promptOk('/clear') &&
      !promptOk('!rm -rf') &&
      promptOk('Run it') &&
      promptOk('2 more tests') &&
      ctl.promptText('/clear') === '' &&
      ctl.promptText('Run it') !== ''
  );
  const r1 = await phone.prompt(PHONE, 'p1', '/clear');
  await settle();
  check(
    'O13 a slash command sent anyway is refused there',
    phone.view(PHONE).ops.find(o => o.n === r1.n)?.state === 'refused'
  );

  // ---- 2b. the thread's own controls (plan item 44) ----
  const thread = async (id, what, value) => {
    const r = await phone.thread(PHONE, id, what, value);
    await settle();
    return phone.view(PHONE).ops.find(o => o.n === r.n)?.state || r.state;
  };
  check(
    'T1 a rename of a Claude Code thread is done',
    (await thread('p1', 'rename', 'Payments')) === 'done' &&
      w.delivered.at(-1).kind === 'thread' &&
      w.delivered.at(-1).value === 'Payments',
    w.delivered.at(-1)
  );
  check('T2 its effort can be switched', (await thread('p1', 'effort', 'max')) === 'done');
  check(
    'T3 a model for an OpenCode thread is refused there (it opens its own picker)',
    (await thread('p2', 'model', 'opus')) === 'refused'
  );
  check(
    'T4 a name that does not start with a word is refused there',
    (await thread('p1', 'rename', '/clear')) === 'refused'
  );
  check(
    'T5 the access level is not an operation the phone can send',
    (await phone.thread(PHONE, 'p1', 'access', 'full')).state === 'not_sent'
  );
  check(
    'T6 Close is taken',
    (await thread('p2', 'close')) === 'done' && w.delivered.at(-1).what === 'close'
  );

  // ---- 3. refusals ----

  // a held-back operation: more than 60 s past its counter
  const held = await phone.prompt(PHONE, 'p1', 'Late words');
  await settle();
  const msgCount = w.delivered.length;
  check('H0 (setup) it left', held.state === 'asked');
  {
    // the newest counter the computer sent, echoed as if the relay had held the message a minute
    const c0 = w.toPhone.filter(m => m.t === 'agents' && m.c).at(-1).c;
    c.move(61_000);
    const n = 'f'.repeat(16);
    const r = w.fromPhone({
      t: 'prompt',
      n,
      c: c0,
      ms: 0,
      id: 'p1',
      to: phone.view(PHONE).agents[0].to,
      text: 'Old counter',
    });
    check(
      'H1 an operation that echoes a stale counter is not delivered',
      w.delivered.length === msgCount,
      r
    );
  }
  {
    const r = w.fromPhone({
      t: 'prompt',
      n: 'e'.repeat(16),
      c: 99,
      ms: 0,
      id: 'p1',
      to: '0'.repeat(16),
      text: 'Forged ticket',
    });
    check('H2 a forged ticket is not delivered', w.delivered.length === msgCount, r);
  }

  // control taken away: the phone's buttons have nothing to send
  w.on = false;
  w.api.controlChanged(PHONE);
  c.move(4000);
  await settle();
  const off = phone.view(PHONE);
  check('H3 "no longer" reaches the phone', off.control === null, off.control);
  const none = await phone.prompt(PHONE, 'p1', 'Anything');
  check('H4 with control off nothing is sent', none.state === 'not_sent');

  // session ends
  phone.sessionEnded(PHONE);
  const gone = phone.view(PHONE);
  check(
    'H5 an ended session reads as offline and keeps its rows as last heard',
    gone.state === 'offline' && gone.agents.length === 2
  );
  check(
    'H6 nothing is sent without a session',
    (await phone.act(PHONE, 'p1', 'stop')).state === 'not_sent'
  );
}

// ---- 4. replies nobody asked for, and the clock ----
{
  const { c, phone, w } = await world();
  phone.sessionStarted(PHONE);
  w.api.sessionStarted(PHONE);
  await settle();
  c.move(4000);
  await settle();
  phone.onMessage(PHONE, { t: 'prompted', n: '1'.repeat(16), ok: true, state: 'sent' });
  check(
    'Q1 a reply for an operation never sent changes nothing',
    phone.view(PHONE).ops.length === 0
  );

  // an operation that gets no word
  const realSend = w.fromPhone;
  w.fromPhone = () => ({ silent: 'test' });
  const p = await phone.prompt(PHONE, 'p1', 'No answer');
  c.move(15_001);
  check(
    'Q2 no word in 15 s reads as no reply',
    phone.view(PHONE).ops.find(o => o.n === p.n)?.state === 'no_reply'
  );
  w.fromPhone = realSend;

  // a wrong word for its kind
  const a = await phone.act(PHONE, 'p1', 'stop');
  phone.onMessage(PHONE, { t: 'prompted', n: a.n, ok: true, state: 'sent' });
  check(
    'Q3 a reply of another kind is not taken',
    phone.view(PHONE).ops.find(o => o.n === a.n)?.state !== 'sent'
  );

  // a junk agent list
  phone.onMessage(PHONE, {
    t: 'agents',
    g: 7,
    i: 0,
    n: 1,
    agents: [
      { id: 'x', name: '' },
      { id: 'y‮', name: 'Ok', status: 'hacked', to: 'nothex' },
    ],
  });
  const rows = phone.view(PHONE).agents;
  check(
    'Q4 junk rows are shaped: a row without a name goes, an unknown status is idle, a bad ticket is dropped',
    rows.length === 1 && rows[0].status === 'idle' && !rows[0].to && rows[0].id === 'y',
    rows
  );

  // stale
  w.api.stop();
  c.move(200_000);
  check(
    'Q5 a computer not heard for over two minutes reads as stale',
    phone.view(PHONE).state === 'stale'
  );
  check(
    "Q6 the binding helper is the same as the computer's",
    (await bindingPick({
      id: 'm',
      kind: 'menu',
      agent: 'A',
      detail: 'Q',
      since: 1,
      row: 'p1',
      opts: ['a', 'b'],
    })) ===
      ctl.bindingPick({
        id: 'm',
        kind: 'menu',
        agent: 'A',
        detail: 'Q',
        since: 1,
        row: 'p1',
        opts: ['a', 'b'],
      })
  );
  phone.stop();
  w.api.stop();
}

console.log(`control: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
