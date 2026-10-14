// Test of desktop/remote-api.js: node tools/remote-api-test.js (plain Node; also run it in
// Electron's Node). Two computers' "needs you" lists over a stand-in for the encrypted session, on
// a clock the test moves by hand: only the listed fields leave, the text switch works per device,
// large lists are split, heartbeats run only while items are open, and a quiet or offline computer
// never keeps showing "waiting".
const noise = require('../desktop/remote-noise.js');
const {
  createRemoteApi,
  BEAT_MS,
  STALE_MS,
  MAX_ITEMS,
  ROSTER_MS,
  MAX_AGENTS,
} = require('../desktop/remote-api.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const w = { t: 1700000000000, timers: [], wire: [], cut: false, session: true, hold: null };
const timers = {
  set: (fn, ms) => {
    const h = { at: w.t + ms, fn };
    w.timers.push(h);
    return h;
  },
  clear: h => {
    const i = w.timers.indexOf(h);
    if (i >= 0) w.timers.splice(i, 1);
  },
};

function advance(ms) {
  const end = w.t + ms;
  for (;;) {
    const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    timers.clear(due);
    w.t = Math.max(w.t, due.at);
    due.fn();
  }
  w.t = end;
}

function computer(id, other) {
  const c = { id, local: [], agents: [], detail: true, seen: [] };
  c.api = createRemoteApi({
    now: () => w.t,
    timers,
    items: () => c.local,
    agents: () => c.agents,
    agentName: paneId => ({ p1: 'Moss', p2: 'Willow' })[paneId] || '',
    showDetail: () => c.detail,
    tellFrom: peer => (typeof c.from === 'function' ? c.from(peer) : 0),
    on: { remote: (from, view) => c.seen.push({ from, ...view }) },
    send(to, obj) {
      if (!w.session) return false;

      // throws when it would not fit one envelope, as the real link does
      noise.pad(Buffer.from(JSON.stringify(obj)));
      w.wire.push({ from: id, to, obj });
      const deliver = () => other().api.onMessage(id, JSON.parse(JSON.stringify(obj)));
      if (w.hold) w.hold.push(deliver);
      else if (!w.cut) deliver();
      return true;
    },
  });
  return c;
}
const a = computer('dev-a', () => b),
  b = computer('dev-b', () => a);

// As with the real link: both sides know the session before either one's first list arrives.
const start = () => {
  w.hold = [];
  a.api.sessionStarted('dev-b');
  b.api.sessionStarted('dev-a');
  const q = w.hold;
  w.hold = null;
  q.forEach(d => d());
};
const last = c => c.seen.at(-1);

// ---- the list, field by field ----
a.local = [
  {
    id: 'permission:7',
    paneId: 'p1',
    kind: 'permission',
    tool: 'Bash',
    detail: 'Bash: npm run deploy',
    since: 1700000000123,
    inferred: false,
    text: 'the held prompt text',
    held: ['secret prompt'],
    cwd: 'C:\\Users\\me\\project',
    output: 'terminal output',
  },
];
start();
const got = b.api.view('dev-a');
check('a session start sends the full list', got.state === 'live' && got.items.length === 1);
check(
  'an item has exactly the listed fields',
  JSON.stringify(Object.keys(got.items[0]).sort()) ===
    JSON.stringify(['agent', 'detail', 'id', 'inferred', 'kind', 'since']),
  Object.keys(got.items[0])
);
check(
  '…with the agent name looked up from the roster',
  got.items[0].agent === 'Moss' &&
    got.items[0].kind === 'permission' &&
    got.items[0].detail === 'Bash: npm run deploy' &&
    got.items[0].since === 1700000000123 &&
    got.items[0].inferred === false
);
const wire = JSON.stringify(w.wire);
check(
  'nothing else left the computer: no prompt text, output, path or panel id',
  !/held prompt|secret prompt|terminal output|Users|p1|tool/.test(wire),
  wire.slice(0, 200)
);
check(
  'a computer with nothing open reports an empty list, and sends no heartbeat',
  a.api.view('dev-b').items.length === 0 && a.api.view('dev-b').state === 'live'
);

// ---- changes ----
const n0 = w.wire.length;
a.api.changed();
check('an unchanged list is not sent again', w.wire.length === n0);
a.local.push({
  id: 'menu:p2',
  paneId: 'p2',
  kind: 'menu',
  detail: 'Pick a color?',
  since: 1700000005000,
  inferred: true,
});
a.api.changed();
check(
  'an added item is sent at once, inferred stays labeled',
  b.api.view('dev-a').items.length === 2 &&
    b.api.view('dev-a').items[1].inferred === true &&
    b.api.view('dev-a').items[1].agent === 'Willow'
);
a.local.shift();
a.api.changed();
check(
  'a cleared item is removed on the other computer',
  b.api.view('dev-a').items.length === 1 && b.api.view('dev-a').items[0].id === 'menu:p2'
);

// ---- the text switch, per device ----
a.detail = false;
a.api.detailChanged('dev-b');
check(
  'text switched off for that device: the detail field is left out',
  !('detail' in b.api.view('dev-a').items[0]) && !/Pick a color/.test(JSON.stringify(w.wire.at(-1)))
);
a.detail = true;
a.api.detailChanged('dev-b');

// A guessed item's text is a line read from the terminal screen: never sent, whatever the switch
// says.
check(
  'switch on: a guessed menu still carries no text, on the wire or in the view',
  !('detail' in b.api.view('dev-a').items[0]) &&
    b.api.view('dev-a').items[0].inferred === true &&
    !/Pick a color/.test(JSON.stringify(w.wire))
);
a.local.push({
  id: 'permission:9',
  paneId: 'p2',
  kind: 'permission',
  detail: 'Bash: npm test',
  since: 1700000006000,
  inferred: false,
});
a.api.changed();
advance(50);
const told = () => b.api.view('dev-a').items.find(i => i.id === 'permission:9');
check(
  'switch on: what the agent itself reported carries its text',
  told()?.detail === 'Bash: npm test'
);
a.detail = false;
a.api.detailChanged('dev-b');
check('switch off: that text is left out too', told() && !('detail' in told()));
a.detail = true;
a.api.detailChanged('dev-b');
check('…and back on', told()?.detail === 'Bash: npm test');
a.local.pop();
a.api.changed();
advance(50);

// ---- untrusted text on both sides ----
a.local = [
  {
    id: 'x\u001b[31m' + 'i'.repeat(200),
    paneId: 'p1',
    kind: 'made-up-kind',
    detail: 'line one\nline two \u001b]0;title\u0007 ' + 'd'.repeat(300),
    since: 'yesterday',
    inferred: 'yes',
  },
];
a.api.changed();
const odd = b.api.view('dev-a').items[0];
check(
  'control characters are removed and text is clipped',
  !/[\u0000-\u001f]/.test(odd.id + odd.detail) && odd.id.length <= 80 && odd.detail.length <= 100
);
check(
  'an unknown kind becomes "other", a bad time 0, inferred only when really true',
  odd.kind === 'other' && odd.since === 0 && odd.inferred === false
);
b.api.onMessage('dev-a', {
  t: 'needs',
  g: 999,
  i: 0,
  n: 1,
  items: [
    {
      id: 'evil',
      kind: 'permission',
      agent: { toString: () => 'x' },
      detail: 'ok',
      since: 5,
      inferred: true,
      run: 'rm -rf',
      paneId: 'p9',
    },
    'text',
    null,
    { kind: 'menu' },
  ],
});
const ev = b.api.view('dev-a').items;
check(
  'a received item is read field by field: extra fields dropped, items without an id dropped',
  ev.length === 1 && !('run' in ev[0]) && !('paneId' in ev[0]) && typeof ev[0].agent === 'string',
  ev
);
check(
  'a guessed item that arrives with text (a computer on older code) is shown without it',
  ev[0].inferred === true && !('detail' in ev[0]),
  ev
);
const keep = JSON.stringify(b.api.view('dev-a'));
for (const bad of [
  { t: 'run', cmd: 'x' },
  { t: 'needs', g: 1000, i: 1, n: 2, items: [] },
  { t: 'needs', g: 'x', i: 0, n: 1, items: [] },
  { t: 'needs', g: 1001, i: 0, n: 1, items: 'no' },
  { t: 'needs', g: 1002, i: 0, n: 500, items: [] },
  null,
  'needs',
  { t: 'attention.answer', id: 'evil' },
])
  b.api.onMessage('dev-a', bad);
check(
  'any other message type or a malformed list changes nothing',
  JSON.stringify(b.api.view('dev-a')) === keep
);
b.api.onMessage('dev-x', { t: 'needs', g: 1, i: 0, n: 1, items: [{ id: 'q', kind: 'menu' }] });
check('a message from a computer without a session is ignored', b.api.view('dev-x') === null);

// ---- a list too large for one envelope ----
a.local = Array.from({ length: 300 }, (_, i) => ({
  id: 'menu:pane-' + i,
  paneId: 'p1',
  kind: 'menu',
  detail: 'Question number ' + i + ' ' + 'x'.repeat(70),
  since: 1700000000000 + i,
  inferred: true,
}));
const n1 = w.wire.length;
a.api.changed();
const parts = w.wire.slice(n1);
check(
  'a long list goes as several messages that each fit one envelope',
  parts.length > 1 && parts.every(p => Buffer.byteLength(JSON.stringify(p.obj)) <= noise.MAX_PLAIN),
  parts.length
);
check(
  '…and arrives whole, capped at ' + MAX_ITEMS + ' items',
  b.api.view('dev-a').items.length === MAX_ITEMS &&
    b.api.view('dev-a').items[MAX_ITEMS - 1].id === 'menu:pane-' + (MAX_ITEMS - 1)
);
b.api.onMessage('dev-a', { ...parts[0].obj, g: 5000 });
b.api.onMessage('dev-a', { ...parts[2].obj, g: 5000 });
check(
  'a list with a missing part is dropped, the last whole one stays',
  b.api.view('dev-a').items.length === MAX_ITEMS
);

// ---- heartbeat and "last heard" ----
a.local = [
  { id: 'menu:p2', paneId: 'p2', kind: 'menu', detail: 'Pick a color?', since: 1, inferred: true },
];
a.api.changed();
const beats = () => w.wire.filter(m => m.obj.t === 'beat' && m.from === 'dev-a').length,
  b0 = beats();
advance(5 * BEAT_MS + 1000);
check(
  'while items are open a heartbeat goes about once a minute',
  beats() - b0 === 5,
  beats() - b0
);
check(
  '…and the other computer keeps it live',
  b.api.view('dev-a').state === 'live' &&
    w.wire.filter(m => m.obj.t === 'beat' && m.from === 'dev-b').length === 0
);
check(
  'a heartbeat is small and names nothing',
  JSON.stringify(w.wire.filter(m => m.obj.t === 'beat').at(-1).obj) === '{"t":"beat"}'
);
w.cut = true;
const seenBefore = b.seen.length;
advance(STALE_MS + 5000); // the relay holds one direction back while still saying "online"
check(
  'two missed heartbeats: marked "last heard", the items are not shown as waiting',
  b.api.view('dev-a').state === 'last_heard' &&
    b.seen.length === seenBefore + 1 &&
    last(b).state === 'last_heard' &&
    last(b).heard > 0
);
w.cut = false;
advance(BEAT_MS);
check('the next heartbeat makes it live again', b.api.view('dev-a').state === 'live');
a.local = [];
a.api.changed();
const b1 = beats();
advance(10 * BEAT_MS);
check(
  'nothing open: the list is cleared there and heartbeats stop',
  b.api.view('dev-a').items.length === 0 && beats() === b1 && w.timers.length === 0,
  w.timers.length
);

// ---- offline, no session, forget ----
a.local = [
  { id: 'menu:p2', paneId: 'p2', kind: 'menu', detail: 'Pick a color?', since: 1, inferred: true },
];
a.api.changed();
b.api.sessionEnded('dev-a');
a.api.sessionEnded('dev-b');
check(
  'the other computer went offline: no waiting item is kept, only when it was last heard',
  b.api.view('dev-a').state === 'offline' &&
    b.api.view('dev-a').items.length === 0 &&
    b.api.view('dev-a').heard > 0
);
const b2 = beats(),
  n2 = w.wire.length;
a.local.push({ id: 'menu:p3', paneId: 'p1', kind: 'menu', detail: 'x', since: 2, inferred: true });
a.api.changed();
advance(5 * BEAT_MS);
check(
  'without a session nothing is sent and no heartbeat runs',
  w.wire.length === n2 && beats() === b2 && w.timers.length === 0
);
w.session = false;
a.api.sessionStarted('dev-b');
w.session = true;
check('a send that did not go out is not remembered as sent', w.wire.length === n2);
start();
check(
  'the next session start sends the full current list',
  b.api.view('dev-a').state === 'live' && b.api.view('dev-a').items.length === 2
);

// A session that starts again must not leave the view offline when the first list is lost (here:
// the other side has nothing open, so no beat either).
a.local = [];
a.api.changed();
b.api.sessionEnded('dev-a');
a.api.sessionEnded('dev-b');
w.session = false;
a.api.sessionStarted('dev-b');
w.session = true;
b.api.sessionStarted('dev-a');
check(
  'a session start makes an offline view live even if the first list is lost',
  b.api.view('dev-a').state === 'live' && last(b).state === 'live'
);
b.api.forget('dev-a');
check('forget drops everything known about that computer', b.api.view('dev-a') === null);

// ---- the agent list (phase 1, "See") ----
const c = computer('dev-c', () => d),
  d = computer('dev-d', () => c);
const begin = () => {
  w.hold = [];
  c.api.sessionStarted('dev-d');
  d.api.sessionStarted('dev-c');
  const q = w.hold;
  w.hold = null;
  q.forEach(x => x());
};
const sentAgents = () => w.wire.filter(m => m.from === 'dev-c' && m.obj.t === 'agents').length;
begin();
check(
  'a computer with no agents sends no agent list',
  sentAgents() === 0 && d.api.view('dev-c').agents.length === 0
);
const { shapeAgent, projectKey } = require('../desktop/remote-api.js'),
  KEY = 'a'.repeat(40),
  NAMED = 'n' + 'b'.repeat(40);
c.agents = [
  {
    id: 'p1',
    name: 'Moss',
    cli: 'Claude Code',
    status: 'working',
    since: 1700000000500,
    task: 'Fix the login page',
    p: KEY,
    project: 'C:\\Users\\me\\secret',
    pid: 4242,
    output: 'terminal output',
  },
  {
    id: 'p2',
    name: 'Willow',
    cli: 'Codex',
    status: 'idle',
    since: 0,
    task: '',
    p: 'C:\\Users\\me\\secret',
  },
];
c.api.agentsChanged();
const seenAgents = () => d.api.view('dev-c').agents;
check(
  'a started agent arrives with exactly the listed fields',
  seenAgents().length === 2 &&
    JSON.stringify(Object.keys(seenAgents()[0]).sort()) ===
      JSON.stringify(['cli', 'id', 'name', 'p', 'since', 'status', 'task']),
  seenAgents()
);

// The key of an agent's project (section 6e) rides in its row, behind the same switch as the task,
// and only in its fixed forms.
check(
  'project key: it arrives with its agent; what is no key is not sent',
  seenAgents()[0].p === KEY && !('p' in seenAgents()[1])
);
check(
  'project key: a first-commit id of either length and a name key pass',
  [KEY, 'c'.repeat(64), NAMED].every(
    k => shapeAgent({ id: 'x', name: 'X', p: k }, true).p === k && projectKey(k) === k
  )
);
check(
  'project key: not sent with the switch off',
  !('p' in shapeAgent({ id: 'x', name: 'X', p: KEY }, false))
);
check(
  'project key: a folder, a name, upper case, a wrong length or a non-string is no key',
  [
    'C:\\Users\\me\\secret',
    'Project',
    KEY.toUpperCase(),
    KEY + 'a',
    NAMED + 'a',
    'n',
    '',
    null,
    7,
    {},
    [KEY],
  ].every(v => !('p' in shapeAgent({ id: 'x', name: 'X', p: v }, true)) && projectKey(v) === '')
);
check(
  '…name, CLI, status and task as sent; an empty task is left out',
  seenAgents()[0].name === 'Moss' &&
    seenAgents()[0].cli === 'Claude Code' &&
    seenAgents()[0].status === 'working' &&
    seenAgents()[0].task === 'Fix the login page' &&
    !('task' in seenAgents()[1])
);
check(
  'no folder, process id or output left with it',
  !/secret|4242|terminal output/.test(JSON.stringify(w.wire.filter(m => m.obj.t === 'agents')))
);
const nA = sentAgents();
c.agents[0].status = 'idle';
c.api.agentsChanged();
c.agents[0].status = 'needs';
c.api.agentsChanged();
c.agents[0].status = 'working';
c.api.agentsChanged();
check(
  'status changes inside a few seconds are held back',
  sentAgents() === nA && seenAgents()[0].status === 'working'
);
c.agents[0].status = 'needs';
c.api.agentsChanged();
advance(ROSTER_MS + 10);
check(
  '…and go as one message with the newest state',
  sentAgents() === nA + 1 && seenAgents()[0].status === 'needs'
);
advance(ROSTER_MS + 10);
c.api.agentsChanged();
check('an unchanged agent list is not sent again', sentAgents() === nA + 1);
c.detail = false;
c.api.detailChanged('dev-d');
advance(ROSTER_MS + 10);
check(
  'text switched off for that computer: no task leaves',
  !seenAgents().some(x => 'task' in x) && !/login page/.test(JSON.stringify(w.wire.at(-1)))
);
c.detail = true;
c.api.detailChanged('dev-d');
advance(ROSTER_MS + 10);
d.api.onMessage('dev-c', {
  t: 'agents',
  g: 900,
  i: 0,
  n: 1,
  agents: [
    {
      id: 'x\u0000\u202e',
      name: 'N'.repeat(300),
      cli: {},
      status: 'root',
      since: -5,
      task: 'T'.repeat(500),
    },
    { id: 'y' },
    'text',
    null,
    { id: 'x\u0000\u202e', name: 'again' },
  ],
});
const oddA = seenAgents();
check(
  'an odd agent list is read as untrusted text: clipped, unknown status idle, no name no row, no double id',
  oddA.length === 1 &&
    oddA[0].name.length <= 60 &&
    oddA[0].task.length <= 120 &&
    oddA[0].status === 'idle' &&
    oddA[0].since === 0 &&
    !/[\u0000-\u001f\u202e]/.test(oddA[0].id),
  oddA
);
d.api.onMessage('dev-c', {
  t: 'agents',
  g: 901,
  i: 0,
  n: 1,
  agents: Array.from({ length: MAX_AGENTS + 50 }, (_, k) => ({
    id: 'a' + k,
    name: 'A' + k,
    status: 'working',
  })),
});
check('more agents than the limit are cut off', seenAgents().length === MAX_AGENTS);
const beatsC = () => w.wire.filter(m => m.from === 'dev-c' && m.obj.t === 'beat').length;
c.agents = [{ id: 'p1', name: 'Moss', cli: 'Claude Code', status: 'working' }];
c.api.agentsChanged();
advance(ROSTER_MS + 10);
const bA = beatsC();
advance(BEAT_MS + 10);
check('a computer with a working agent sends the heartbeat', beatsC() === bA + 1);
w.cut = true;
advance(STALE_MS + BEAT_MS);
check(
  'a working agent whose computer stops answering is no longer shown as live',
  d.api.view('dev-c').state === 'last_heard'
);
w.cut = false;
advance(BEAT_MS + 10);
check('…and is live again at its next heartbeat', d.api.view('dev-c').state === 'live');
c.agents = [{ id: 'p1', name: 'Moss', cli: 'Claude Code', status: 'idle' }];
c.api.agentsChanged();
advance(ROSTER_MS + 10);
const bB = beatsC();
advance(3 * BEAT_MS);
check(
  'only idle agents: no heartbeat, and the view stays live',
  beatsC() === bB && d.api.view('dev-c').state === 'live' && seenAgents()[0].status === 'idle'
);
c.agents = [];
c.api.agentsChanged();
advance(ROSTER_MS + 10);
check('the last agent closed: an empty list is sent once', seenAgents().length === 0);
c.agents = [{ id: 'p1', name: 'Moss', cli: 'Claude Code', status: 'working' }];
c.api.agentsChanged();
advance(ROSTER_MS + 10);
d.api.sessionEnded('dev-c');
check(
  'a session that ended keeps no agent of that computer',
  d.api.view('dev-c').agents.length === 0 && d.api.view('dev-c').state === 'offline'
);
c.api.sessionEnded('dev-d');
begin();
check(
  'the next session start sends the agents again',
  seenAgents().length === 1 && seenAgents()[0].name === 'Moss'
);
c.api.stop();
d.api.stop();

// ---- a yes or no to a permission prompt (section 6c): the "can" hint, sending `answer`, reading
// `answered` ----
{
  const { bindingOf } = require('../desktop/phone-answer.js'),
    { REPLY_MS } = require('../desktop/remote-api.js');
  const mk = (id, other, extra) => {
    const x = { id, local: [], may: [], detail: true, seen: [], answers: [], reply: null };
    x.api = createRemoteApi({
      now: () => w.t,
      timers,
      items: () => x.local,
      agentName: () => 'Moss',
      showDetail: () => x.detail,
      canAnswer: () => x.may,
      on: { remote: (from, view) => x.seen.push(view) },
      ...extra,
      send(to, obj) {
        if (!w.session) return false;
        w.wire.push({ from: id, to, obj });
        if (obj.t === 'answer') {
          x.answers.push(obj);
          return true;
        }
        other().api.onMessage(id, JSON.parse(JSON.stringify(obj)));
        return true;
      },
    });
    return x;
  };
  const e = mk('dev-e', () => f, { bind: bindingOf }),
    f = mk('dev-f', () => e, { bind: bindingOf }),
    plain = mk('dev-g', () => f, {}); // e asks, f is asked; g has no binding handed in
  e.api.sessionStarted('dev-f');
  f.api.sessionStarted('dev-e');
  f.api.sessionStarted('dev-g');
  plain.api.sessionStarted('dev-f');
  const P = (n, detail, more) => ({
    id: 'permission:' + n,
    paneId: 'p1',
    kind: 'permission',
    detail,
    since: 1700000000000 + n,
    inferred: false,
    ...more,
  });
  f.local = [
    P(1, 'Bash: npm test'),
    P(2, 'Write: a.txt'),
    P(3, 'Bash: ls', { inferred: true }),
    { id: 'menu:p1', paneId: 'p1', kind: 'menu', detail: 'Pick?', since: 5, inferred: true },
    {
      id: 'trust:p1',
      paneId: 'p1',
      kind: 'trust',
      detail: 'Trust this folder?',
      since: 6,
      inferred: false,
    },
  ];
  f.api.changed();
  const it = n => e.api.view('dev-f').items.find(i => i.id === 'permission:' + n);
  check(
    'can: nothing is answerable unless the app says so',
    e.api.view('dev-f').items.length === 5 &&
      e.api.view('dev-f').items.every(i => !('can' in i) && !('of' in i)) &&
      !/"can"/.test(JSON.stringify(w.wire.filter(m => m.from === 'dev-f')))
  );
  f.may = ['permission:1', 'permission:3', 'menu:p1', 'trust:p1', 'permission:99'];
  f.api.answerChanged('dev-e');
  check(
    'can: only a permission prompt this computer itself reported, with its text, is sent with the hint',
    it(1).can === true &&
      typeof it(1).of === 'string' &&
      e.api.view('dev-f').items.filter(i => i.can).length === 1,
    e.api.view('dev-f').items
  );
  check(
    'can: the binding is the one the answering side computes over the same item',
    it(1).of ===
      bindingOf({
        id: 'permission:1',
        kind: 'permission',
        agent: 'Moss',
        detail: 'Bash: npm test',
        since: 1700000000001,
        inferred: false,
      })
  );
  f.api.answerChanged('dev-g');
  check(
    'can: a computer that has no binding handed in shows nothing as answerable',
    plain.api.view('dev-f').items.every(i => !('can' in i)) &&
      plain.api.answer('dev-f', 'permission:1', 'yes', it(1).of) === 'not_sent'
  );
  f.detail = false;
  f.api.detailChanged('dev-e');
  check('can: no hint without the text', !('can' in it(1)) && !('detail' in it(1)));
  f.detail = true;
  f.api.detailChanged('dev-e');
  e.api.onMessage('dev-f', {
    t: 'needs',
    g: 7000,
    i: 0,
    n: 1,
    items: [
      { id: 'menu:x', kind: 'menu', detail: 'x', since: 1, can: true },
      { id: 'trust:x', kind: 'trust', detail: 'Trust?', since: 1, can: true },
      {
        id: 'permission:g',
        kind: 'permission',
        detail: 'Bash: ls',
        since: 1,
        inferred: true,
        can: true,
      },
      { id: 'permission:n', kind: 'permission', since: 1, can: true },
      { id: 'permission:t', kind: 'permission', detail: 'Bash: ls', since: 1, can: 'yes' },
    ],
  });
  check(
    'can: a hint on a menu, a trust prompt, an inferred or textless item, or one that is not true, is not taken',
    e.api.view('dev-f').items.length === 5 && e.api.view('dev-f').items.every(i => !('can' in i)),
    e.api.view('dev-f').items
  );
  f.api.changed();
  f.api.detailChanged('dev-e');

  // Longer commands (6f, change 8): `full` and `can2` through the two hooks, between two computers
  // that have them and one that has not.
  {
    const { withFull, readFull, bindingFor, bindingOf2 } = require('../desktop/remote-control.js'),
      hooks = {
        bind: bindingFor,
        full: (s, it) => withFull(s, it.tool, it.whole === true ? undefined : it.full),
        read: readFull,
      };

    // h asks, k is asked; o is a version without the hooks
    let h, k;
    h = mk('dev-h', () => k, hooks);
    k = mk('dev-k', () => h, hooks);
    const old = mk('dev-o', () => k, { bind: bindingOf });
    h.api.sessionStarted('dev-k');
    k.api.sessionStarted('dev-h');
    k.api.sessionStarted('dev-o');
    old.api.sessionStarted('dev-k');
    const multi = 'git add -A &&\n  git commit -m "wip"',
      TAB = String.fromCharCode(9);
    k.local = [
      P(1, 'Bash: npm test', { whole: true, tool: 'Bash' }),
      P(2, 'Bash: git add -A && git commit -m "wip"', { tool: 'Bash', full: multi }),
      P(3, 'Bash: echo a b', { tool: 'Bash', full: 'echo a' + TAB + 'b' }),
      P(4, 'Bash: something long…', { tool: 'Bash' }),
      P(5, 'Write: a.txt', { tool: 'Write', full: 'a\nb' }),
    ];
    k.may = ['permission:1', 'permission:2', 'permission:3', 'permission:4'];
    k.api.changed();
    const at = (x, n) => x.api.view('dev-k').items.find(i => i.id === 'permission:' + n),
      wireOf = n =>
        w.wire
          .filter(m => m.from === 'dev-k' && m.to === 'dev-h' && m.obj.t === 'needs')
          .at(-1)
          .obj.items.find(i => i.id === 'permission:' + n);
    check(
      'full: on the wire a `whole` item carries `can`, a longer command `full` and `can2` and never `can`, and the rest neither',
      wireOf(1).can === true &&
        wireOf(1).can2 === undefined &&
        wireOf(1).full === undefined &&
        wireOf(2).can2 === true &&
        wireOf(2).full === multi &&
        wireOf(2).can === undefined &&
        [3, 4, 5].every(
          n =>
            wireOf(n).can === undefined &&
            wireOf(n).can2 === undefined &&
            wireOf(n).full === undefined
        ),
      [1, 2, 3, 4, 5].map(wireOf)
    );
    check(
      'full: the receiving computer keeps every line and binds the answer with v2',
      at(h, 2).can2 === true &&
        at(h, 2).full === multi &&
        at(h, 2).can === undefined &&
        at(h, 2).of ===
          bindingOf2({
            id: 'permission:2',
            kind: 'permission',
            agent: 'Moss',
            detail: 'Bash: git add -A && git commit -m "wip"',
            since: 1700000000002,
            inferred: false,
            full: multi,
          }) &&
        at(h, 1).can === true &&
        at(h, 1).of ===
          bindingOf({
            id: 'permission:1',
            kind: 'permission',
            agent: 'Moss',
            detail: 'Bash: npm test',
            since: 1700000000001,
            inferred: false,
          }),
      at(h, 2)
    );

    // this stand-in wire hands everything k sends to h: o gets its own copy here
    for (const m of w.wire
      .filter(x => x.from === 'dev-k' && x.to === 'dev-o' && x.obj.t === 'needs')
      .slice(-1))
      old.api.onMessage('dev-k', JSON.parse(JSON.stringify(m.obj)));
    check(
      'full: a version without the hooks shows no button for it and keeps none of its text',
      at(old, 2).can === undefined &&
        at(old, 2).can2 === undefined &&
        at(old, 2).full === undefined &&
        at(old, 2).of === undefined &&
        at(old, 1).can === true &&
        old.api.answer('dev-k', 'permission:2', 'yes', at(h, 2).of) === 'not_sent'
    );
    const sentN = h.answers.length;
    check(
      'full: an answer for it is sent with the v2 binding, and only with it',
      h.api.answer('dev-k', 'permission:2', 'yes', at(h, 1).of) === 'not_sent' &&
        h.api.answer('dev-k', 'permission:2', 'yes', at(h, 2).of) === 'sent' &&
        h.answers.length === sentN + 1 &&
        h.answers.at(-1).of === at(h, 2).of &&
        Object.keys(h.answers.at(-1)).sort().join() === 'id,of,say,t',
      h.answers.at(-1)
    );
    const raw = (more, g) =>
      h.api.onMessage('dev-k', {
        t: 'needs',
        g,
        i: 0,
        n: 1,
        items: [
          {
            id: 'permission:9',
            kind: 'permission',
            agent: 'Moss',
            detail: 'Bash: x',
            since: 9,
            inferred: false,
            ...more,
          },
        ],
      });
    const nine = () => h.api.view('dev-k').items.find(i => i.id === 'permission:9');
    const wrong = [
      { can2: true, can: true, full: multi },
      { can2: 'true', full: multi },
      { can2: true },
      { can2: true, full: multi + ' ' },
      { can2: true, full: 'a' + TAB + 'b' },
      { can2: true, full: 'x'.repeat(1201) },
      { can2: true, full: ['a'] },
      { full: multi },
      { can2: true, full: multi, inferred: true },
      { can2: true, full: multi, kind: 'trust' },
      { can2: true, full: multi, detail: '' },
    ];
    const kept = wrong.map((more, i) => {
      raw(more, 9000 + i);
      const it = nine();
      return (
        it &&
        it.can === undefined &&
        it.can2 === undefined &&
        it.full === undefined &&
        it.of === undefined
      );
    });
    check(
      'full: as it arrives, `can2` with `can`, a `can2` that is not true, no command, a command the rule refuses, or another kind of item: not answerable, and nothing of `full` is kept',
      kept.every(Boolean),
      kept
    );
    raw({ can2: true, full: multi }, 9100);
    check(
      'full: (and the same item with a clean command is)',
      nine().can2 === true && nine().full === multi && typeof nine().of === 'string'
    );
    h.api.stop();
    k.api.stop();
    old.api.stop(); // the answer above waits for its word: no timer of these three is left behind
  }

  // choose (6i): "option N of the question that was shown". The operation's shape, and a question's
  // options through the two hooks.
  {
    const { shapeOp } = require('../desktop/remote-api.js'),
      { withPick, readPick, bindingPick } = require('../desktop/remote-control.js');
    const base = {
      t: 'choose',
      n: '0123456789abcdef',
      c: 3,
      ms: 12,
      id: 'p1',
      to: 'fedcba9876543210',
      of: 'AAAAAAAAAAAAAAAA',
      pick: 2,
    };
    check(
      'choose: the operation is read field by field: the binding, one whole number from 1 to 9, and nothing else of the message',
      JSON.stringify(shapeOp({ ...base, key: 'enter', text: 'rm -rf', keys: ['up'], run: 1 })) ===
        JSON.stringify(base)
    );
    const notOne = [
      { pick: 0 },
      { pick: 10 },
      { pick: '2' },
      { pick: 2.5 },
      { pick: [2] },
      { pick: -1 },
      { pick: undefined },
      { of: 'AAAA' },
      { of: 'A'.repeat(17) },
      { of: 'AAAAAAAAAAAAAAA!' },
      { of: 7 },
      { to: 'nope' },
      { id: '' },
      { n: 'x' },
      { c: 0 },
      { ms: -1 },
    ];
    check(
      'choose: 0, 10, a text, a fraction, a list, a short or long or odd binding, no ticket, no row, no number: not a choice',
      notOne.every(more => shapeOp({ ...base, ...more }) === null),
      notOne.filter(more => shapeOp({ ...base, ...more }) !== null)
    );
    check(
      'choose: a key name is not an operation at all',
      shapeOp({ ...base, t: 'key', k: 'enter' }) === null &&
        shapeOp({ t: 'act', n: base.n, c: 3, ms: 0, id: 'p1', to: base.to, do: 'key' }) === null
    );
    const hooks = {
      pick: (peerId, sh, it) => (peerId === 'dev-q' ? withPick(sh, it) : sh),
      readPick,
    };
    let q, r;
    q = mk('dev-q', () => r, hooks);
    r = mk('dev-r', () => q, hooks);
    const plain2 = mk('dev-s', () => r, {});
    q.api.sessionStarted('dev-r');
    r.api.sessionStarted('dev-q');
    r.api.sessionStarted('dev-s');
    plain2.api.sessionStarted('dev-r');
    const menu = (n, more) => ({
      id: 'question:' + n,
      paneId: 'p1',
      kind: 'menu',
      detail: 'Which database?',
      since: 1700000000000 + n,
      inferred: false,
      ...more,
    });
    r.local = [
      menu(1, { opts: ['Postgres', 'SQLite'], ask: 'q1' }),
      menu(2, { opts: ['a', 'a'], ask: 'q2' }),
      menu(3, {}),
      menu(4, { opts: ['x', 'y'], ask: 'q4', inferred: true }),
      P(5, 'Bash: ls', { opts: ['x', 'y'] }),
    ];
    r.api.changed();
    const sentTo = to =>
        w.wire.filter(m => m.from === 'dev-r' && m.to === to && m.obj.t === 'needs').at(-1).obj
          .items,
      got = (x, n) => x.api.view('dev-r').items.find(i => i.id === 'question:' + n);

    // this stand-in wire hands everything r sends to q: s gets its own copy here
    for (const m of w.wire
      .filter(x => x.from === 'dev-r' && x.to === 'dev-s' && x.obj.t === 'needs')
      .slice(-1))
      plain2.api.onMessage('dev-r', JSON.parse(JSON.stringify(m.obj)));

    // …and q, which was also handed s's copy, gets its own once more, last
    for (const m of w.wire
      .filter(x => x.from === 'dev-r' && x.to === 'dev-q' && x.obj.t === 'needs')
      .slice(-1))
      q.api.onMessage('dev-r', JSON.parse(JSON.stringify(m.obj)));
    check(
      'choose: the option labels and the agent row leave only for the computer the app names, on a question the CLI reported, with its text',
      JSON.stringify(sentTo('dev-q').find(i => i.id === 'question:1').opts) ===
        '["Postgres","SQLite"]' &&
        sentTo('dev-q').find(i => i.id === 'question:1').row === 'p1' &&
        sentTo('dev-q').filter(i => 'opts' in i || 'row' in i).length === 1 &&
        sentTo('dev-s').every(i => !('opts' in i) && !('row' in i)) &&
        !JSON.stringify(sentTo('dev-q')).includes('"ask"'),
      sentTo('dev-q')
    );
    check(
      'choose: the receiving computer reads them by the same rule and makes the binding over everything it was shown',
      got(q, 1).opts.join() === 'Postgres,SQLite' &&
        got(q, 1).row === 'p1' &&
        got(q, 1).kof ===
          bindingPick({
            id: 'question:1',
            kind: 'menu',
            agent: 'Moss',
            detail: 'Which database?',
            since: 1700000000001,
            row: 'p1',
            opts: ['Postgres', 'SQLite'],
          }) &&
        got(q, 2).opts === undefined &&
        got(q, 3).kof === undefined,
      got(q, 1)
    );
    check(
      'choose: one changed label, another row, another text or another time gives another binding',
      new Set(
        [['Postgres', 'SQLite'], ['Postgres', 'MySQL'], ['SQLite', 'Postgres'], ['Postgres']].map(
          o =>
            bindingPick({
              id: 'question:1',
              kind: 'menu',
              agent: 'Moss',
              detail: 'Which database?',
              since: 1,
              row: 'p1',
              opts: o,
            })
        )
      ).size === 4 &&
        bindingPick({
          id: 'question:1',
          kind: 'menu',
          agent: 'Moss',
          detail: 'Which database?',
          since: 1,
          row: 'p2',
          opts: ['a'],
        }) !==
          bindingPick({
            id: 'question:1',
            kind: 'menu',
            agent: 'Moss',
            detail: 'Which database?',
            since: 1,
            row: 'p1',
            opts: ['a'],
          })
    );
    check(
      'choose: a version without the hooks keeps none of it and sends no choice',
      plain2.api.view('dev-r').items.every(i => !('opts' in i) && !('kof' in i)) &&
        plain2.api.choose('dev-r', 'question:1', 1, got(q, 1).kof).state === 'not_sent'
    );
    check(
      "choose: without the other computer's word that it takes operations nothing is sent, whatever the item says",
      q.api.choose('dev-r', 'question:1', 1, got(q, 1).kof).state === 'not_sent'
    );
    q.api.stop();
    r.api.stop();
    plain2.api.stop();
  }

  // sending
  const n0 = e.answers.length;
  check(
    'answer: an item without the hint, an unknown item, another binding, a word that is not yes or no: nothing is sent',
    [
      e.api.answer('dev-f', 'permission:2', 'yes', 'x'),
      e.api.answer('dev-f', 'permission:9', 'yes', it(1).of),
      e.api.answer('dev-f', 'permission:1', 'yes', 'AAAAAAAAAAAAAAAA'),
      e.api.answer('dev-f', 'permission:1', 'once', it(1).of),
      e.api.answer('dev-f', 'permission:1', ['yes'], it(1).of),
      e.api.answer('dev-x', 'permission:1', 'yes', it(1).of),
    ].every(r => r === 'not_sent') && e.answers.length === n0
  );
  w.session = false;
  const t0 = w.timers.length;
  check(
    'answer: a send that does not go out says "not sent" at once, and nothing queues (no timer, nothing sent later)',
    e.api.answer('dev-f', 'permission:1', 'yes', it(1).of) === 'not_sent' &&
      it(1).answer === 'not_sent' &&
      e.answers.length === n0 &&
      w.timers.length === t0,
    it(1)
  );
  w.session = true;
  check(
    'answer: pressed again with a session it is sent: id, binding and yes, nothing else',
    e.api.answer('dev-f', 'permission:1', 'yes', it(1).of) === 'sent' &&
      JSON.stringify(e.answers.at(-1)) ===
        JSON.stringify({ t: 'answer', id: 'permission:1', of: it(1).of, say: 'yes' }) &&
      it(1).answer === 'sent' &&
      it(1).said === 'yes',
    e.answers.at(-1)
  );
  check(
    'answer: one press while it waits',
    e.api.answer('dev-f', 'permission:1', 'no', it(1).of) === 'sent' && e.answers.length === n0 + 1
  );

  // 15: what comes back is untrusted
  const calm = () => JSON.stringify(e.api.view('dev-f'));
  let was = calm();
  for (const bad of [
    { t: 'answered', id: 'permission:2', of: 'x', ok: true },
    { t: 'answered', id: 'permission:1', of: 'AAAAAAAAAAAAAAAA', ok: true },
    { t: 'answered', id: ['permission:1'], of: it(1).of, ok: true },
    { t: 'answered', id: 'permission:1', ok: true },
    { t: 'answered' },
  ])
    e.api.onMessage('dev-f', bad);
  e.api.onMessage('dev-g', { t: 'answered', id: 'permission:1', of: it(1).of, ok: true });
  check(
    '15: an "answered" for another item, another binding, without one, or from another computer changes nothing',
    calm() === was
  );
  e.api.onMessage('dev-f', {
    t: 'answered',
    id: 'permission:1',
    of: it(1).of,
    ok: false,
    why: '<b>Call 555-0100 to fix this</b>' + 'x'.repeat(4000),
    text: 'more',
    title: 'x',
  });
  check(
    '15: a long or odd reason becomes the one word "refused": none of its text is kept',
    it(1).answer === 'refused' &&
      !/555|<b>|more/.test(calm()) &&
      Object.keys(it(1)).sort().join() === 'agent,answer,can,detail,id,inferred,kind,of,said,since',
    it(1)
  );
  was = calm();
  e.api.onMessage('dev-f', { t: 'answered', id: 'permission:1', of: it(1).of, ok: true });
  check('15: a second "answered" for one press changes nothing', calm() === was);
  check(
    'answer: a refused one may be pressed again',
    e.api.answer('dev-f', 'permission:1', 'no', it(1).of) === 'sent' &&
      e.answers.at(-1).say === 'no'
  );
  for (const why of ['not_allowed', 'failed']) {
    if (it(1).answer !== 'sent') e.api.answer('dev-f', 'permission:1', 'no', it(1).of);
    e.api.onMessage('dev-f', { t: 'answered', id: 'permission:1', of: it(1).of, ok: false, why });
    check('answer: the reason "' + why + '" is one of the known words', it(1).answer === why);
  }
  check(
    'answer: after "failed" (taken there, already gone) it is not pressed again',
    e.api.answer('dev-f', 'permission:1', 'yes', it(1).of) === 'failed'
  );

  // no confirmation
  f.local.push(P(4, 'Bash: npm ci'));
  f.may.push('permission:4');
  f.api.changed();
  e.api.answer('dev-f', 'permission:4', 'yes', it(4).of);
  const seenN = e.seen.length;
  advance(REPLY_MS - 1000);
  check('answer: not confirmed yet shows as sent', it(4).answer === 'sent');
  advance(2000);
  check(
    'answer: no word after 15 s says "no reply" (never "failed"), tells the page, and may be pressed again',
    it(4).answer === 'no_reply' &&
      e.seen.length === seenN + 1 &&
      e.api.answer('dev-f', 'permission:4', 'yes', it(4).of) === 'sent'
  );
  advance(REPLY_MS + 1000);
  e.api.onMessage('dev-f', { t: 'answered', id: 'permission:4', of: it(4).of, ok: true });
  check(
    'answer: a confirmation that comes late is still taken',
    it(4).answer === 'answered' &&
      e.api.answer('dev-f', 'permission:4', 'no', it(4).of) === 'answered'
  );

  // the result lives exactly as long as the item it belongs to
  f.local[0] = P(1, 'Bash: rm -rf build');
  f.api.changed();
  check(
    'answer: the same id with another text is another prompt: no old result on it',
    it(1).can === true && !('answer' in it(1)) && it(4).answer === 'answered'
  );
  f.local = f.local.filter(x => x.id !== 'permission:4');
  f.api.changed();
  check("answer: an answered item leaves when the other computer's list no longer has it", !it(4));
  e.api.answer('dev-f', 'permission:1', 'yes', it(1).of);
  e.api.sessionEnded('dev-f');
  check(
    'answer: the session ended: no item, no result, no timer',
    e.api.view('dev-f').items.length === 0 &&
      e.api.answer('dev-f', 'permission:1', 'yes', 'x') === 'not_sent'
  );
  check(
    'listening: only while a computer has a session',
    e.api.listening() === false && f.api.listening() === true
  );
  e.api.stop();
  f.api.stop();
  plain.api.stop();
}

// ---- which project is open (section 6d, "same project, seen"): two commit ids, nothing else ----
{
  const { PROJECT_MS, shapeProject } = require('../desktop/remote-api.js');
  const R = 'a'.repeat(40),
    H1 = 'b'.repeat(40),
    H2 = 'c'.repeat(40),
    R256 = 'd'.repeat(64);
  const mk = (id, other) => {
    const x = { id, project: null, detail: true, seen: [], throws: false };
    x.api = createRemoteApi({
      now: () => w.t,
      timers,
      items: () => [],
      project: () => {
        if (x.throws) throw new Error('no folder');
        return x.project;
      },
      showDetail: () => x.detail,
      on: { remote: (from, view) => x.seen.push(view) },
      send(to, obj) {
        if (!w.session) return false;
        noise.pad(Buffer.from(JSON.stringify(obj)));
        w.wire.push({ from: id, to, obj });
        other().api.onMessage(id, JSON.parse(JSON.stringify(obj)));
        return true;
      },
    });
    return x;
  };
  const p = mk('dev-p', () => q),
    q = mk('dev-q', () => p);
  const sentP = () => w.wire.filter(m => m.from === 'dev-p' && m.obj.t === 'project');
  const seen = () => q.api.view('dev-p').project;
  p.api.sessionStarted('dev-q');
  q.api.sessionStarted('dev-p');
  check(
    'project: a computer with no project sends nothing about one',
    sentP().length === 0 && seen() === null
  );
  p.project = {
    root: R,
    head: H1,
    top: 'C:\\Users\\me\\secret',
    name: 'Secret project',
    branch: 'main',
    gitDir: 'C:\\Users\\me\\secret\\.git',
  };
  p.api.projectChanged();
  check(
    'project: the two ids arrive',
    JSON.stringify(seen()) === JSON.stringify({ root: R, head: H1 }),
    seen()
  );
  check(
    'project: exactly the type and the two ids left: no folder, name or branch',
    JSON.stringify(sentP().at(-1).obj) === JSON.stringify({ t: 'project', root: R, head: H1 }) &&
      !/secret|main|Secret/.test(JSON.stringify(sentP()))
  );
  const n1 = sentP().length;
  p.api.projectChanged();
  advance(PROJECT_MS + 10);
  p.api.projectChanged();
  check('project: unchanged ids are not sent again', sentP().length === n1);
  p.project = { root: R, head: H2 };
  p.api.projectChanged();
  p.project = { root: R, head: H1 };
  p.api.projectChanged();
  p.project = { root: R, head: H2 };
  p.api.projectChanged();
  check(
    'project: changes inside the wait go as one message with the newest ids',
    sentP().length === n1 + 1 && seen().head === H2,
    sentP().length - n1
  );
  advance(PROJECT_MS + 10);
  check(
    'project: nothing more follows when the newest ids were the ones sent',
    sentP().length === n1 + 1
  );
  p.project = { root: R, head: H1 };
  p.api.projectChanged();
  p.project = { root: R, head: H2 };
  p.api.projectChanged();
  const n2 = sentP().length,
    held = seen().head;
  advance(PROJECT_MS + 10);
  check(
    'project: a change held back by the wait goes when the wait ends',
    held === H1 && sentP().length === n2 + 1 && seen().head === H2,
    seen()
  );
  advance(PROJECT_MS + 10);

  // the text switch covers it, at once
  p.project = { root: R, head: H2 };
  p.api.projectChanged();
  p.detail = false;
  p.api.detailChanged('dev-q');
  check(
    'project: switch off: the other computer forgets it at once, not after the wait',
    seen() === null && JSON.stringify(sentP().at(-1).obj) === JSON.stringify({ t: 'project' })
  );
  p.detail = true;
  p.api.detailChanged('dev-q');
  check('project: switch on: it is told again at once', seen() && seen().head === H2, seen());
  advance(PROJECT_MS + 10);

  // the folder closed
  p.project = null;
  p.api.projectChanged();
  check('project: no project any more: the other computer forgets it', seen() === null);
  const n3 = sentP().length;
  p.api.projectChanged();
  advance(PROJECT_MS + 10);
  p.api.projectChanged();
  check('project: "no project" is said once', sentP().length === n3);
  p.throws = true;
  p.api.projectChanged();
  p.throws = false;
  check('project: a reader that throws is read as no project', sentP().length === n3);

  // received: untrusted
  const shapes = [
    [{ root: R, head: H1 }, true],
    [{ root: R256, head: R256 }, true],
    [{ root: R }, true],
    [{ root: R, head: 'HEAD' }, true],
    [{ root: R.toUpperCase(), head: H1 }, false],
    [{ root: R + 'a', head: H1 }, false],
    [{ root: R.slice(1), head: H1 }, false],
    [{ root: '--upload-pack=x' + 'a'.repeat(25), head: H1 }, false],
    [{ root: [R], head: H1 }, false],
    [{ head: H1 }, false],
    [null, false],
    ['text', false],
  ];
  check(
    'project: only a commit id in lower-case hex of 40 or 64 characters is a root; anything else is no project',
    shapes.every(([v, ok]) => !!shapeProject(v) === ok),
    shapes.map(([v]) => !!shapeProject(v))
  );
  check(
    'project: a head that is not a commit id is read as none, never passed on',
    shapeProject({ root: R, head: 'HEAD' }).head === '' &&
      shapeProject({ root: R, head: '-n1 ' + 'a'.repeat(36) }).head === '' &&
      shapeProject({ root: R, head: H1 + '\n' }).head === ''
  );
  q.api.onMessage('dev-p', {
    t: 'project',
    root: R,
    head: H1,
    name: '<b>x</b>',
    top: 'C:\\x',
    extra: { a: 1 },
    n: 99,
  });
  check(
    'project: nothing but the two ids is kept from a message',
    Object.keys(seen()).sort().join() === 'head,root' &&
      !/<b>|C:/.test(JSON.stringify(q.api.view('dev-p')))
  );
  q.api.onMessage('dev-p', { t: 'project', root: '../../etc', head: '; rm -rf /' });
  check('project: a message without a real root clears what was known', seen() === null);
  q.api.onMessage('dev-x', { t: 'project', root: R, head: H1 });
  check('project: a computer without a session is not listened to', q.api.view('dev-x') === null);
  const emits = q.seen.length;
  q.api.onMessage('dev-p', { t: 'project', root: R, head: H1 });
  q.api.onMessage('dev-p', { t: 'project', root: R, head: H1 });
  check('project: the same ids twice tell the page once', q.seen.length === emits + 1);

  // sessions
  p.project = { root: R, head: H1 };
  p.api.projectChanged();
  advance(PROJECT_MS + 10);
  q.api.sessionEnded('dev-p');
  check(
    'project: a session that ended keeps no project of that computer',
    seen() === null && q.api.view('dev-p').state === 'offline'
  );
  p.api.sessionEnded('dev-q');
  p.api.sessionStarted('dev-q');
  q.api.sessionStarted('dev-p');
  check('project: the next session start sends it again', seen() && seen().head === H1, seen());
  w.session = false;
  p.project = { root: R, head: H2 };
  advance(PROJECT_MS + 10);
  p.api.projectChanged();
  w.session = true;
  check('project: a send that did not go out is not counted as sent', seen().head === H1);
  p.api.projectChanged();
  check('project: it goes at the next change or session', seen().head === H2, seen());
  p.api.stop();
  q.api.stop();
}

// ---- control (section 6f): the ticket and the counter on the agent list, "you may control", the
// three operations and their replies ---- The rules that decide whether an operation is carried out
// are remote-control.js's (tools/remote-control-test.js). Here: what leaves, field by field, and
// what is read back. A number in a check's name is the numbered test of the design it
// belongs to.
{
  const {
    shapeAgent,
    shapeControl,
    shapeOp,
    START_CLIS,
    REPLY_MS,
    CONTROL_MS,
    QUEUED_MS,
    OPS_MAX,
  } = require('../desktop/remote-api.js');
  const { shapeReply, CLIS } = require('../desktop/remote-control.js');
  const T1 = '0123456789abcdef',
    T2 = 'fedcba9876543210',
    KEY = 'a'.repeat(40),
    N = i => i.toString(16).padStart(16, '0');
  const all = {};
  const mk = (id, extra) => {
    const x = (all[id] = {
      id,
      agents: [],
      detail: true,
      seen: [],
      ops: [],
      tickets: {},
      on: false,
      starts: [],
      c: 0,
      n: 0,
      asked: [],
    });
    x.api = createRemoteApi({
      now: () => w.t,
      timers,
      items: () => [],
      agents: () => x.agents,
      showDetail: () => x.detail,
      on: { remote: (from, view) => x.seen.push(view) },
      ticket: (peer, panelId) => {
        x.asked.push(peer + ' ' + panelId);
        return x.tickets[panelId] || '';
      },
      stamp: () => (x.on ? ++x.c : 0),
      starts: () => (x.on ? x.starts : null),
      reply: shapeReply,
      nonce: () => N(++x.n),
      ...extra,
      send(to, obj) {
        if (!w.session) return false;
        noise.pad(Buffer.from(JSON.stringify(obj)));
        w.wire.push({ from: id, to, obj });
        if (['prompt', 'act', 'start'].includes(obj.t)) x.ops.push(obj);
        all[to].api.onMessage(id, JSON.parse(JSON.stringify(obj)));
        return true;
      },
    });
    return x;
  };
  const h = mk('dev-h'),
    k = mk('dev-k'); // h asks, k is asked
  const from = (x, t) =>
    w.wire
      .filter(m => m.from === x.id && m.to === (x === k ? 'dev-h' : 'dev-k') && m.obj.t === t)
      .map(m => m.obj);
  const view = () => h.api.view('dev-k'),
    op = n => view().ops.find(e => e.n === n),
    row = id => view().agents.find(a => a.id === id);
  check(
    'control: the CLI words that may cross are the ones remote-control.js looks up',
    JSON.stringify(START_CLIS) === JSON.stringify(Object.keys(CLIS)),
    START_CLIS
  );

  // the shapes
  check(
    'ticket: 16 lower-case hex characters in a row, behind the text switch, and nothing else',
    shapeAgent({ id: 'p', name: 'P', to: T1 }, true).to === T1 &&
      !('to' in shapeAgent({ id: 'p', name: 'P', to: T1 }, false)) &&
      [
        T1.toUpperCase(),
        T1 + 'a',
        T1.slice(1),
        '',
        null,
        7,
        [T1],
        { toString: () => T1 },
        'g'.repeat(16),
      ].every(v => !('to' in shapeAgent({ id: 'p', name: 'P', to: v }, true)))
  );
  check(
    'review 15, 14g: "it may be watched" is read only from a real true',
    shapeControl({ t: 'control', c: 4, clis: [], watch: true }).watch === true &&
      ['true', 1, 'yes', {}, [true], null].every(
        v => shapeControl({ t: 'control', c: 4, clis: [], watch: v }).watch === false
      )
  );
  check(
    'control message: a counter and the fixed CLI words in their fixed order; anything else is "no control"',
    JSON.stringify(
      shapeControl({
        t: 'control',
        c: 4,
        clis: ['codex', 'zsh', 'claude', 'codex', 'constructor', 7],
        run: 'x',
      })
    ) ===
      // sync: the git hand-over, say: agents messaging agents; each is true only for a real true
      JSON.stringify({ c: 4, clis: ['claude', 'codex'], watch: false, sync: false, say: false }) &&
      [
        { t: 'control' },
        { c: 0, clis: [] },
        { c: 1.5, clis: [] },
        { c: -1, clis: [] },
        { c: 2 ** 31, clis: [] },
        { c: '4', clis: [] },
        { c: 4 },
        { c: 4, clis: 'claude' },
        null,
        'x',
      ].every(v => shapeControl(v) === null)
  );
  const P = { t: 'prompt', n: N(1), c: 3, ms: 250, id: 'terminal-1-abcd', to: T1, text: 'Fix it' };
  check(
    'operation: a prompt, an interrupt, a stop and a start are read field by field, and nothing else is kept',
    JSON.stringify(shapeOp({ ...P, agent: 'Codex', paste: false, model: 'x', cwd: 'C:\\' })) ===
      JSON.stringify(P) &&
      JSON.stringify(shapeOp({ ...P, t: 'act', do: 'stop', text: 'x', force: true })) ===
        JSON.stringify({ t: 'act', n: N(1), c: 3, ms: 250, id: P.id, to: T1, do: 'stop' }) &&
      shapeOp({ ...P, t: 'act', do: 'interrupt' }).do === 'interrupt' &&
      JSON.stringify(
        shapeOp({
          t: 'start',
          n: N(1),
          c: 3,
          ms: 0,
          cli: 'codex',
          project: KEY,
          text: 'Go',
          model: 'x',
          effort: 'max',
          name: 'Evil',
          cwd: 'C:\\',
        })
      ) ===
        JSON.stringify({
          t: 'start',
          n: N(1),
          c: 3,
          ms: 0,
          cli: 'codex',
          project: KEY,
          text: 'Go',
        }) &&
      !(
        'text' in
        shapeOp({ t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: 'c'.repeat(64) })
      )
  );
  const bad = [
    { ...P, n: 'x' },
    { ...P, n: 'ABCDEF0123456789' },
    { ...P, n: undefined },
    { ...P, c: 0 },
    { ...P, c: '3' },
    { ...P, c: undefined },
    { ...P, ms: -1 },
    { ...P, ms: 1.5 },
    { ...P, ms: '5' },
    { ...P, ms: undefined },
    { ...P, id: '' },
    { ...P, id: 'a\u200bb' },
    { ...P, id: ' a' },
    { ...P, id: 7 },
    { ...P, to: 'short' },
    { ...P, to: undefined },
    { ...P, text: '' },
    { ...P, text: ['Fix it'] },
    { ...P, text: undefined },
    { ...P, t: 'act' },
    { ...P, t: 'act', do: 'kill' },
    { ...P, t: 'act', do: ['stop'] },
    { ...P, t: 'type' },
    { ...P, t: 'run' },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'constructor', project: KEY },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'Claude Code', project: KEY },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: ['claude'], project: KEY },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: 'n' + 'b'.repeat(40) },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: 'C:\\Users\\me' },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: '' },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: KEY, text: '' },
    { t: 'start', n: N(1), c: 3, ms: 0, cli: 'claude', project: KEY, text: 5 },
    null,
    'prompt',
  ];
  check(
    'operation: a bad number, counter, time, id, ticket, text, a third "do", an unknown CLI word ("constructor"), a name-form or folder project: not an operation',
    bad.every(m => shapeOp(m) === null),
    bad.map(m => shapeOp(m) === null)
  );

  // off (the default): nothing new leaves
  k.agents = [
    { id: 'p1', name: 'Moss', cli: 'Claude Code', status: 'idle', since: 1 },
    { id: 'p2', name: 'Wren', cli: 'Codex', status: 'idle', since: 1 },
  ];

  // the stand-in hands a ticket out whatever the switch says: that none leaves while it is off is
  // this file's rule
  k.tickets = { p1: T1 };
  h.api.sessionStarted('dev-k');
  k.api.sessionStarted('dev-h');
  check(
    'control off: no "control" message, no counter on the agent list, the view says no control',
    from(k, 'control').length === 0 &&
      from(k, 'agents').length === 1 &&
      !('c' in from(k, 'agents')[0]) &&
      view().control === null &&
      view().ops.length === 0,
    from(k, 'agents')
  );
  check(
    'control off: nothing is sent for a prompt, an interrupt, a stop or a start',
    [
      h.api.prompt('dev-k', 'p1', 'Fix it'),
      h.api.act('dev-k', 'p1', 'stop'),
      h.api.start('dev-k', 'claude', KEY, ''),
    ].every(r => r.state === 'not_sent' && r.n === '') &&
      h.ops.length === 0 &&
      view().ops.length === 0
  );

  // 7 at this level: a ticket is a hint the app's rules give per row; a row without one (a
  // Terminal, a typed CLI, a sign-in run) carries none.
  k.on = true;
  k.starts = ['codex', 'claude', 'zsh'];
  k.agents[1].to = T2; // the app's own list can never set a ticket
  advance(ROSTER_MS + 10);
  k.api.controlChanged('dev-h');
  check(
    'control on: "you may control" goes with a counter and the fixed words, before the rows',
    JSON.stringify(from(k, 'control').at(-1)) ===
      JSON.stringify({ t: 'control', c: 1, clis: ['claude', 'codex'] }) &&
      w.wire.findLastIndex(m => m.obj.t === 'control') <
        w.wire.findLastIndex(m => m.obj.t === 'agents'),
    from(k, 'control')
  );
  check(
    "7: the row the rules gave a ticket carries it; a row without one carries none, whatever the app's own list says",
    from(k, 'agents').at(-1).agents[0].to === T1 &&
      !('to' in from(k, 'agents').at(-1).agents[1]) &&
      row('p1').to === T1 &&
      !('to' in row('p2')),
    from(k, 'agents').at(-1)
  );
  check(
    'the ticket is asked for that computer and that panel as the list is sent',
    k.asked.includes('dev-h p1') && k.asked.includes('dev-h p2')
  );
  check(
    'the agent list carries the counter of change 13',
    from(k, 'agents').at(-1).c === 2 &&
      JSON.stringify(view().control) ===
        JSON.stringify({ clis: ['claude', 'codex'], watch: false, sync: false, say: false }),
    [from(k, 'agents').at(-1), view().control]
  );
  k.detail = false;
  k.api.detailChanged('dev-h');
  advance(ROSTER_MS + 10);
  check(
    'text switch off: "no longer" is said at once, and no ticket or counter leaves',
    JSON.stringify(from(k, 'control').at(-1)) === JSON.stringify({ t: 'control' }) &&
      view().control === null &&
      !('to' in row('p1')) &&
      !('c' in from(k, 'agents').at(-1)) &&
      h.api.prompt('dev-k', 'p1', 'Fix it').state === 'not_sent'
  );
  k.detail = true;
  k.api.detailChanged('dev-h');
  advance(ROSTER_MS + 10);
  check('…and on again', row('p1').to === T1 && view().control !== null);

  // how often
  advance(CONTROL_MS + 10);
  const c0 = from(k, 'control').length;
  k.api.controlChanged();
  advance(CONTROL_MS + 10);
  k.api.controlChanged('dev-h');
  check(
    '"you may control" is not sent again while nothing changed',
    from(k, 'control').length === c0
  );
  k.starts = ['claude'];
  k.api.controlChanged();
  k.starts = ['claude', 'opencode'];
  k.api.controlChanged();
  k.starts = ['cursor'];
  k.api.controlChanged();
  check(
    'changes of the CLI list inside a few seconds go as one message with the newest',
    from(k, 'control').length === c0 + 1 &&
      (advance(CONTROL_MS + 10), from(k, 'control').length === c0 + 2) &&
      JSON.stringify(view().control.clis) === JSON.stringify(['cursor']),
    from(k, 'control').slice(c0)
  );
  k.starts = ['claude', 'codex'];
  k.api.controlChanged();
  advance(CONTROL_MS + 10);

  // sending
  k.agents[0].status = 'needs';
  k.api.agentsChanged();
  advance(5000); // a list, and so a counter, that arrived five seconds ago
  const sentAt = w.t,
    newest = [...from(k, 'control'), ...from(k, 'agents')]
      .map(m => m.c || 0)
      .reduce((x, y) => Math.max(x, y), 0);
  const p1 = h.api.prompt('dev-k', 'p1', 'Fix the login page');
  check(
    'prompt: sent with a one-time number, the newest counter, the time since it arrived, the row id, its ticket and the text, and nothing else',
    p1.state === 'asked' &&
      JSON.stringify(h.ops.at(-1)) ===
        JSON.stringify({
          t: 'prompt',
          n: p1.n,
          c: newest,
          ms: 5000,
          id: 'p1',
          to: T1,
          text: 'Fix the login page',
        }) &&
      /^[0-9a-f]{16}$/.test(p1.n),
    h.ops.at(-1)
  );
  check(
    'prompt: the view shows it as asked, without its text or the ticket',
    JSON.stringify(op(p1.n)) ===
      JSON.stringify({ n: p1.n, kind: 'prompt', id: 'p1', state: 'asked', at: sentAt }) &&
      !JSON.stringify(view().ops).includes('login'),
    view().ops
  );
  check(
    'prompt: one press while it waits for its first word',
    h.api.prompt('dev-k', 'p1', 'Fix the login page').n === p1.n && h.ops.length === 1
  );
  const n1 = h.ops.length;
  check(
    'prompt: a row without a ticket, an unknown row, no text, text that is not text: nothing is sent',
    [
      h.api.prompt('dev-k', 'p2', 'Fix it'),
      h.api.prompt('dev-k', 'p9', 'Fix it'),
      h.api.prompt('dev-k', 'p1', ''),
      h.api.prompt('dev-k', 'p1', ['Fix it']),
      h.api.prompt('dev-x', 'p1', 'Fix it'),
      h.api.act('dev-k', 'p2', 'stop'),
      h.api.act('dev-k', 'p1', 'kill'),
      h.api.act('dev-k', 'p1', ['stop']),
    ].every(r => r.state === 'not_sent') && h.ops.length === n1
  );

  // 3 at this level: the limit is bytes of the whole message; never shortened, never split.
  check(
    '3: a prompt that does not fit one message is not sent, cut or split; one that just fits goes whole',
    h.api.prompt('dev-k', 'p1', 'x'.repeat(4000)).state === 'too_long' &&
      h.api.prompt('dev-k', 'p1', 'ह'.repeat(1400)).state === 'too_long' &&
      h.ops.length === n1 &&
      h.api.prompt('dev-k', 'p1', 'x'.repeat(3900)).state === 'asked' &&
      h.ops.at(-1).text.length === 3900 &&
      h.ops.length === n1 + 1,
    h.ops.length - n1
  );
  w.session = false;
  const t0 = w.timers.length;
  const lost = h.api.prompt('dev-k', 'p1', 'Second');
  check(
    'prompt: a send that does not go out says "not sent" at once, and nothing queues',
    lost.state === 'not_sent' &&
      op(lost.n).state === 'not_sent' &&
      w.timers.length === t0 &&
      h.ops.length === n1 + 1
  );
  w.session = true;
  const a1 = h.api.act('dev-k', 'p1', 'interrupt'),
    a2 = h.api.act('dev-k', 'p1', 'stop');
  check(
    'interrupt and stop: the row id, its ticket and one of two words',
    JSON.stringify(h.ops.at(-2)) ===
      JSON.stringify({
        t: 'act',
        n: a1.n,
        c: newest,
        ms: 5000,
        id: 'p1',
        to: T1,
        do: 'interrupt',
      }) &&
      h.ops.at(-1).do === 'stop' &&
      op(a2.n).do === 'stop' &&
      op(a2.n).kind === 'act',
    h.ops.slice(-2)
  );
  const s1 = h.api.start('dev-k', 'codex', KEY, 'Write the tests'),
    s2 = h.api.start('dev-k', 'claude', KEY, '');
  check(
    "start: a CLI word, the project by its first commit's id and an optional first prompt; no folder, name, model or effort",
    JSON.stringify(h.ops.at(-2)) ===
      JSON.stringify({
        t: 'start',
        n: s1.n,
        c: newest,
        ms: 5000,
        cli: 'codex',
        project: KEY,
        text: 'Write the tests',
      }) &&
      JSON.stringify(Object.keys(h.ops.at(-1))) ===
        JSON.stringify(['t', 'n', 'c', 'ms', 'cli', 'project']) &&
      op(s1.n).cli === 'codex',
    h.ops.slice(-2)
  );
  const n2 = h.ops.length;
  check(
    '15: a CLI that computer did not list, "constructor", a name-form key, a folder, no key: no start is sent',
    [
      h.api.start('dev-k', 'opencode', KEY, ''),
      h.api.start('dev-k', 'constructor', KEY, ''),
      h.api.start('dev-k', ['claude'], KEY, ''),
      h.api.start('dev-k', 'claude', 'n' + 'b'.repeat(40), 'x'),
      h.api.start('dev-k', 'claude', 'C:\\Users\\me\\app', 'x'),
      h.api.start('dev-k', 'claude', '', 'x'),
      h.api.start('dev-k', 'claude', KEY, 7),
    ].every(r => r.state === 'not_sent') && h.ops.length === n2
  );

  // an operation that arrives here is not this file's to read: the service hands it to
  // remote-control.js, or drops it
  const calm = () => JSON.stringify(view()),
    kv = JSON.stringify(k.api.view('dev-h'));
  check(
    'a prompt, an act or a start that reaches this file changes nothing: it stays ignored like any other type',
    kv === JSON.stringify(k.api.view('dev-h')) && k.seen.every(s => s.ops.length === 0)
  );

  // 27: replies are read only for a number this computer sent, of that kind, and only as fixed
  // words
  let was = calm();
  for (const m of [
    { t: 'prompted', n: N(999), ok: true, state: 'sent' },
    { t: 'started', n: p1.n, ok: true },
    { t: 'acted', n: p1.n, ok: true, state: 'done' },
    { t: 'acted', n: p1.n, ok: false, state: 'failed' },
    { t: 'started', n: p1.n, ok: false, why: 'refused' },
    { t: 'prompted', n: [p1.n], ok: true, state: 'sent' },
    { t: 'prompted', ok: true, state: 'sent' },
    { t: 'prompted', n: s1.n, ok: true, state: 'sent' },
    { t: 'answered', n: p1.n, ok: true },
  ])
    h.api.onMessage('dev-k', m);
  k.api.onMessage('dev-h', { t: 'prompted', n: p1.n, ok: true, state: 'sent' });
  check(
    '27: a reply for a number nobody sent, of another kind, without a number, or to the other computer changes nothing',
    calm() === was
  );
  h.api.onMessage('dev-k', {
    t: 'prompted',
    n: p1.n,
    ok: true,
    state: 'queued',
    reason: 'draft',
    text: 'The user is speaking a prompt',
    error: 'x'.repeat(3000),
  });
  check(
    '27: "queued" is taken as that one word: no reason, detail or error text is kept',
    op(p1.n).state === 'queued' &&
      !/speaking|draft|xxx/.test(calm()) &&
      Object.keys(op(p1.n)).join() === 'n,kind,id,state,at',
    op(p1.n)
  );
  advance(REPLY_MS + 1000);
  check(
    'a prompt the other computer holds does not turn into "no reply" after 15 s',
    op(p1.n).state === 'queued'
  );
  h.api.onMessage('dev-k', { t: 'prompted', n: p1.n, ok: true, state: 'sent' });
  check('the last word of a held prompt is taken', op(p1.n).state === 'sent');
  was = calm();
  h.api.onMessage('dev-k', { t: 'prompted', n: p1.n, ok: false, state: 'failed' });
  h.api.onMessage('dev-k', { t: 'prompted', n: p1.n, ok: true, state: 'queued' });
  check('27: after its last word a further reply changes nothing', calm() === was);
  check(
    'no word in 15 s says "no reply" (never "failed") and tells the page',
    op(a1.n).state === 'no_reply' &&
      op(s1.n).state === 'no_reply' &&
      op(lost.n).state === 'not_sent'
  );
  h.api.onMessage('dev-k', { t: 'acted', n: a1.n, ok: true, state: 'unsent' });
  h.api.onMessage('dev-k', { t: 'acted', n: a2.n, ok: true, state: 'unsent' });
  check(
    'a word that comes late is still taken; "unsent" is a word for an interrupt only',
    op(a1.n).state === 'unsent' && op(a2.n).state === 'no_reply',
    [op(a1.n), op(a2.n)]
  );
  h.api.onMessage('dev-k', { t: 'acted', n: a2.n, ok: true, state: 'done' });
  h.api.onMessage('dev-k', { t: 'started', n: s1.n, ok: true, why: 'failed', state: 'x' });
  h.api.onMessage('dev-k', {
    t: 'started',
    n: s2.n,
    ok: false,
    why: '<b>Call 555-0100</b>' + 'y'.repeat(2000),
  });
  check(
    '27: stop "done", a start "started", and an odd reason becomes the one word "refused"',
    op(a2.n).state === 'done' &&
      op(s1.n).state === 'started' &&
      op(s2.n).state === 'refused' &&
      !/555|<b>|yyy/.test(calm()),
    view().ops
  );
  const f1 = h.api.prompt('dev-k', 'p1', 'Third');
  h.api.onMessage('dev-k', { t: 'prompted', n: f1.n, ok: false, state: 'failed' });
  const f2 = h.api.prompt('dev-k', 'p1', 'Fourth');

  // "done" is no word for a prompt
  h.api.onMessage('dev-k', { t: 'prompted', n: f2.n, ok: true, state: 'done' });
  check(
    '27: "failed" is read as failed; a word of another kind reads as refused',
    op(f1.n).state === 'failed' && op(f2.n).state === 'refused',
    [op(f1.n), op(f2.n)]
  );
  const u1 = h.api.prompt('dev-k', 'p1', 'No sign');
  h.api.onMessage('dev-k', { t: 'prompted', n: u1.n, ok: true, state: 'unconfirmed', reason: 'x' });
  const u2 = h.api.act('dev-k', 'p1', 'interrupt');
  h.api.onMessage('dev-k', { t: 'acted', n: u2.n, ok: true, state: 'unconfirmed' });
  check(
    '27: "unconfirmed" is the last word of a prompt, read as itself (never as failed or sent); it is no word for an interrupt',
    op(u1.n).state === 'unconfirmed' &&
      op(u2.n).state === 'refused' &&
      (h.api.onMessage('dev-k', { t: 'prompted', n: u1.n, ok: true, state: 'sent' }),
      op(u1.n).state === 'unconfirmed'),
    [op(u1.n), op(u2.n)]
  );
  const q1 = h.api.prompt('dev-k', 'p1', 'Fifth');
  h.api.onMessage('dev-k', { t: 'prompted', n: q1.n, ok: true, state: 'queued' });
  const emits = h.seen.length;
  advance(QUEUED_MS - 1000);
  check(
    'a held prompt waits for its last word…',
    op(q1.n).state === 'queued' && h.seen.length === emits
  );
  advance(2000);
  check(
    '…and says "no reply" when none came after the time the other computer holds it',
    op(q1.n).state === 'no_reply' && h.seen.length === emits + 1
  );
  const noReply = mk('dev-m', { reply: null });
  noReply.api.sessionStarted('dev-k');
  k.api.sessionStarted('dev-m');
  advance(ROSTER_MS + CONTROL_MS);
  check(
    'without the reply shaping handed in, a computer sends no operation at all',
    noReply.api.view('dev-k').control !== null &&
      noReply.api.prompt('dev-k', 'p1', 'Fix it').state === 'not_sent' &&
      noReply.ops.length === 0
  );

  // 30 at this level: the counter echoed is always the newest that arrived, with the time since
  // then
  k.agents[0].status = 'working';
  k.api.agentsChanged();
  advance(ROSTER_MS + 10);
  advance(1234);
  const newer = from(k, 'agents')
      .filter(m => m.c)
      .at(-1).c,
    late = h.api.prompt('dev-k', 'p1', 'Sixth');
  check(
    '30: an operation echoes the newest counter and the milliseconds since that list arrived',
    late.state === 'asked' &&
      h.ops.at(-1).c === newer &&
      newer > newest &&
      h.ops.at(-1).ms === ROSTER_MS + 10 + 1234,
    h.ops.at(-1)
  );

  // only the newest few are kept
  for (let i = 0; i < OPS_MAX + 5; i++) h.api.prompt('dev-k', 'p1', 'More ' + i);
  check(
    'the operations shown per computer are bounded, newest first',
    view().ops.length === OPS_MAX && view().ops[0].n === h.ops.at(-1).n,
    view().ops.length
  );

  // the switch went off, the session ended
  const open = h.api.prompt('dev-k', 'p1', 'Still open'),
    heldN = h.api.prompt('dev-k', 'p1', 'Held there');
  h.api.onMessage('dev-k', { t: 'prompted', n: heldN.n, ok: true, state: 'queued' });
  k.on = false;
  k.api.controlChanged('dev-h');
  advance(ROSTER_MS + 10);
  check(
    'the switch went off: said at once, the rows lose their tickets, nothing more is sent',
    JSON.stringify(from(k, 'control').at(-1)) === JSON.stringify({ t: 'control' }) &&
      view().control === null &&
      !('to' in row('p1')) &&
      !('c' in from(k, 'agents').at(-1)) &&
      h.api.prompt('dev-k', 'p1', 'After').state === 'not_sent'
  );
  k.on = true;
  k.api.controlChanged('dev-h');
  advance(ROSTER_MS + CONTROL_MS);
  const again = h.api.prompt('dev-k', 'p1', 'Open at the end');
  h.api.sessionEnded('dev-k');
  k.api.sessionEnded('dev-h');
  check(
    'the session ended: what had no word yet says "no reply", a held one keeps waiting, and nothing of the control is kept',
    op(again.n).state === 'no_reply' &&
      op(open.n).state === 'no_reply' &&
      op(heldN.n).state === 'queued' &&
      view().control === null &&
      view().agents.length === 0 &&
      h.api.prompt('dev-k', 'p1', 'x').state === 'not_sent',
    [op(again.n), op(heldN.n)]
  );
  h.api.sessionStarted('dev-k');
  k.api.sessionStarted('dev-h');
  h.api.onMessage('dev-k', { t: 'prompted', n: heldN.n, ok: true, state: 'sent' });
  check(
    "a new session: control and tickets are told again, and the held prompt's last word is still taken",
    view().control !== null &&
      row('p1').to === T1 &&
      op(heldN.n).state === 'sent' &&
      h.api.prompt('dev-k', 'p1', 'After the new session').state === 'asked'
  );
  h.api.forget('dev-k');
  check('forget drops the operations with everything else', h.api.view('dev-k') === null);
  h.api.stop();
  k.api.stop();
  noReply.api.stop();
}

// ---- finished tasks crossing over ----
{
  const {
    shapeReport,
    fitReport,
    REPORTS_MIN,
    REPORTS_HELD,
    REPORTS_MAX,
    REPORT_KEEP_MS,
    REPORT_OFFLINE_MS,
    REPORT_TEXT,
  } = require('../desktop/remote-api.js');
  const MAX = noise.MAX_PLAIN,
    bytes = o => Buffer.byteLength(JSON.stringify(o)),
    chars = t => Array.from(t).length;
  const KEY = 'c'.repeat(40),
    face = String.fromCodePoint(0x1f600),
    rlo = String.fromCharCode(0x202e),
    zw = String.fromCharCode(0x200b),
    half = String.fromCharCode(0xd83d);
  const base = {
    id: 'p1',
    name: 'Moss',
    cli: 'Claude Code',
    at: 1700000000500,
    task: 'Run the tests',
    did: 'Ran the tests; two failed',
    text: 'All done.\n\n- one\n- two',
    p: KEY,
  };

  // the shaping, field by field
  const shaped = shapeReport({
    ...base,
    more: 12,
    secret: 'x',
    cwd: 'C:\\Users\\me',
    result: 'the whole answer',
    log: 'terminal output',
  });
  check(
    'a report is read field by field: only the named fields, in a fixed order',
    JSON.stringify(Object.keys(shaped)) ===
      JSON.stringify(['id', 'name', 'cli', 'at', 'task', 'did', 'text', 'more', 'p']) &&
      shaped.text === 'All done.\n\n- one\n- two' &&
      shaped.more === 12 &&
      shaped.p === KEY,
    shaped
  );
  const dirty = shapeReport({
    ...base,
    name: 'Mo' + rlo + 'ss' + zw,
    task: 'a\u0007b\nc',
    did: 'x'.repeat(500),
    text: 'one' + rlo + '\r\n\r\n\r\n\ttwo  \u0000 words' + half + '\n\n\nthree\n\n',
    p: '../etc',
  });
  check(
    'every text is cleaned: no control, zero-width or direction characters, no half surrogate, a name cannot read as something else',
    dirty.name === 'Mo ss' &&
      dirty.task === 'a b c' &&
      !/[\u0000-\u0009\u000b-\u001f\u200b\u202e]/.test(dirty.text) &&
      !/\p{Cs}/u.test(dirty.text),
    dirty
  );
  check(
    'the answer keeps its line breaks, blank lines are joined to one, lines are trimmed',
    dirty.text === 'one\n\ntwo words\n\nthree',
    dirty.text
  );
  check(
    'the task is 120 characters at most, the short result 240, the name 60',
    chars(shapeReport({ ...base, task: 'y'.repeat(300) }).task) === 120 &&
      chars(dirty.did) === 240 &&
      chars(shapeReport({ ...base, name: 'n'.repeat(99) }).name) === 60
  );
  check(
    'a key that is not one of the fixed forms is no key',
    !('p' in dirty) && shapeReport({ ...base, p: 'n' + 'a'.repeat(40) }).p === 'n' + 'a'.repeat(40)
  );
  check(
    '"characters left out" is a whole number above zero or nothing',
    [-1, 1.5, '7', null, NaN, Infinity].every(m => shapeReport({ ...base, more: m }).more === 0) &&
      shapeReport({ ...base, more: 1e12 }).more === 9999999
  );
  check(
    'without an id, a name, a time or anything said there is no report',
    [{ id: '' }, { name: '' }, { at: 0 }, { at: 'now' }, { did: '', text: ' \n ' }].every(
      x => shapeReport({ ...base, ...x }) === null
    ) &&
      shapeReport(null) === null &&
      shapeReport('x') === null &&
      shapeReport({ ...base, did: '', text: 'x' }) !== null &&
      shapeReport({ ...base, text: '' }) !== null
  );
  check(
    'reading a report that was read before changes nothing',
    JSON.stringify(shapeReport(dirty)) === JSON.stringify(dirty) &&
      JSON.stringify(shapeReport(shaped)) === JSON.stringify(shaped)
  );
  check(
    'a text of any size is cut to a fixed number of whole characters',
    chars(shapeReport({ ...base, text: face.repeat(9000) }).text) === REPORT_TEXT &&
      !/\p{Cs}/u.test(shapeReport({ ...base, text: face.repeat(9000) }).text)
  );

  // what leaves fits one sealed message, whatever the answer holds
  const long = Array.from(
    { length: 400 },
    (_, i) => 'Line ' + i + ' of the answer, with "quotes", a back\\slash and ' + face
  ).join('\n');
  const fit = fitReport({ ...base, text: long });
  let pads = true;
  try {
    noise.pad(Buffer.from(JSON.stringify(fit)));
  } catch {
    pads = false;
  }
  check(
    'a long answer leaves as ONE message that fits one envelope',
    fit.t === 'report' && bytes(fit) <= MAX && pads && bytes(fit) > MAX - 40,
    bytes(fit)
  );
  check(
    'it carries the first part, cut on a whole character, and says how many characters are left out',
    long.startsWith(fit.text) &&
      !/\p{Cs}/u.test(fit.text) &&
      fit.more === chars(long) - chars(fit.text) &&
      fit.more > 0,
    [chars(fit.text), fit.more]
  );
  check('the cut is marked by the number, not by words put into the text', !fit.text.endsWith('…'));
  const wide = fitReport({
    id: face.repeat(80),
    name: face.repeat(60),
    cli: face.repeat(40),
    at: 1700000000500,
    task: face.repeat(120),
    did: ('"' + face).repeat(120),
    text: ('\\' + face + '\n').repeat(4000),
    p: 'f'.repeat(64),
  });
  check(
    'every other field at its longest, in four-byte characters: it still fits, and still carries some of the answer',
    bytes(wide) <= MAX && chars(wide.text) > 250 && wide.more > 0,
    [bytes(wide), chars(wide.text)]
  );
  const short = fitReport({ ...base, secret: 'x' });
  check(
    'a short answer goes whole, with nothing left out and nothing but the named fields',
    short.text === base.text &&
      short.more === 0 &&
      !('secret' in short) &&
      JSON.stringify(Object.keys(short)) ===
        JSON.stringify(['t', 'id', 'name', 'cli', 'at', 'task', 'did', 'text', 'more', 'p']),
    short
  );
  check(
    'what leaves reads back unchanged on the other side',
    JSON.stringify({ t: 'report', ...shapeReport(fit) }) === JSON.stringify(fit) &&
      JSON.stringify({ t: 'report', ...shapeReport(wide) }) === JSON.stringify(wide)
  );
  check(
    'nothing to tell is no message',
    fitReport(null) === null &&
      fitReport({ ...base, id: '' }) === null &&
      fitReport({ ...base, did: '', text: '' }) === null
  );

  // two computers
  w.session = true;
  w.cut = false;
  w.hold = null;
  const s = computer('dev-s', () => r),
    r = computer('dev-r', () => s);
  const sent = () => w.wire.filter(m => m.from === 'dev-s' && m.obj.t === 'report'),
    view = () => r.api.view('dev-s');
  const begin = () => {
    w.hold = [];
    s.api.sessionStarted('dev-r');
    r.api.sessionStarted('dev-s');
    const q = w.hold;
    w.hold = null;
    q.forEach(d => d());
  };
  check(
    'before any session a finished task is kept, not sent',
    s.api.reported({ ...base, at: w.t }) === true && sent().length === 0
  );
  begin();
  check(
    'a session that starts gets the recent result',
    sent().length === 1 &&
      view().reports.length === 1 &&
      view().reports[0].did === base.did &&
      view().reports[0].text === base.text &&
      view().reports[0].p === KEY,
    view().reports
  );
  check(
    'the receiver stamps when it arrived and gives it a key of its own',
    view().reports[0].got === w.t &&
      typeof view().reports[0].key === 'string' &&
      !('sig' in view().reports[0])
  );
  advance(1000);
  const seenBefore = r.seen.length;
  s.api.reported({
    ...base,
    id: 'p2',
    name: 'Willow',
    at: w.t,
    did: 'Fixed the login page',
    text: long,
    cwd: 'C:\\secret',
    result: long,
  });
  check(
    'a task that finishes during a session goes at once, as one message',
    sent().length === 2 &&
      bytes(sent()[1].obj) <= MAX &&
      view().reports.length === 2 &&
      view().reports[1].name === 'Willow' &&
      view().reports[1].more > 0 &&
      r.seen.length === seenBefore + 1
  );
  check(
    'nothing but the named fields is on the wire',
    sent().every(m =>
      Object.keys(m.obj).every(k =>
        ['t', 'id', 'name', 'cli', 'at', 'task', 'did', 'text', 'more', 'p'].includes(k)
      )
    ) && !JSON.stringify(sent()).includes('secret')
  );
  advance(1000);
  s.api.reported({ ...base, at: w.t, did: 'Ran them again; all pass', text: 'All pass now.' });
  check(
    'a later result of the same agent replaces the earlier one and is the newest',
    view().reports.length === 2 &&
      view().reports[1].id === 'p1' &&
      view().reports[1].did === 'Ran them again; all pass' &&
      view().reports[0].id === 'p2'
  );
  check(
    'nothing but a result is said in return',
    w.wire.filter(m => m.from === 'dev-r' && /report|prompted|acted|answered/.test(m.obj.t))
      .length === 0
  );

  // the same result again, bad ones, "no longer"
  const pushes = r.seen.length,
    gotWas = view().reports[1].got;
  advance(5000);
  r.api.onMessage('dev-s', JSON.parse(JSON.stringify(sent().at(-1).obj)));
  check(
    'the same result again changes nothing: no push, the arrival time stays',
    r.seen.length === pushes && view().reports[1].got === gotWas
  );
  for (const bad of [
    { t: 'report', id: 'p9' },
    { t: 'report', id: 'p9', name: 'X', at: w.t },
    { t: 'report', id: 'p9', name: '', at: w.t, did: 'x' },
    { t: 'report', id: '\u0000', name: 'X', at: w.t, did: 'x' },
    { t: 'report', id: 'p9', name: 'X', at: -1, did: 'x' },
    { t: 'report2', id: 'p9', name: 'X', at: w.t, did: 'x' },
  ])
    r.api.onMessage('dev-s', bad);
  check(
    'a report of the wrong shape, and a type that is not on the list, change nothing',
    r.seen.length === pushes && view().reports.length === 2
  );
  r.api.onMessage('dev-nobody', { t: 'report', id: 'p9', name: 'X', at: w.t, did: 'x' });
  check(
    'a report from a computer without a session is not kept',
    r.api.view('dev-nobody') === null
  );
  r.api.onMessage('dev-s', {
    t: 'report',
    id: 'p7',
    name: '<img src=x>',
    cli: 'Codex',
    at: 5,
    did: 'x',
    text: 'y',
    more: 3,
    to: 'f'.repeat(16),
    can: true,
    extra: { a: 1 },
  });
  check(
    'a field that is not named is not kept, and text stays text',
    JSON.stringify(Object.keys(view().reports.at(-1)).sort()) ===
      JSON.stringify(
        ['at', 'cli', 'did', 'got', 'id', 'key', 'more', 'name', 'task', 'text'].sort()
      ) && view().reports.at(-1).name === '<img src=x>'
  );
  r.api.onMessage('dev-s', { t: 'report' });
  check(
    '"no longer" from that computer drops everything held from it',
    view().reports.length === 0 && r.seen.length === pushes + 2
  );

  // the text switch
  s.detail = false;
  s.api.detailChanged('dev-r');
  const bare = () => sent().filter(m => Object.keys(m.obj).length === 1).length;
  check(
    'the text switch goes off: the other computer is told "no longer" once',
    bare() === 1 && JSON.stringify(sent().at(-1).obj) === JSON.stringify({ t: 'report' })
  );
  const n0 = sent().length;
  s.api.reported({
    ...base,
    id: 'p3',
    name: 'Kite',
    at: w.t,
    did: 'Done while the switch was off',
  });
  s.api.detailChanged('dev-r');
  advance(120000);
  check(
    'with the switch off nothing of a finished task is sent, and "no longer" is not said twice',
    sent().length === n0
  );

  // Review 14, finding 1: the app notes the moment the switch went on (`tellFrom`), and nothing
  // that ended before it is told.
  let from = w.t;
  s.from = () => from;
  s.detail = true;
  s.api.detailChanged('dev-r');
  advance(120000);
  check(
    'review 14, 1: switched on again: neither the task that finished while it was off nor the ones from before are sent',
    sent().length === n0 && view().reports.length === 0,
    view().reports.map(x => x.name)
  );
  s.api.reported({
    ...base,
    id: 'p3',
    name: 'Kite',
    at: from - 1,
    did: 'Ended a moment before it went on, handed over after',
  });
  check(
    'review 14, 1: nor a task that ended before that moment and is handed over after it',
    sent().length === n0
  );
  s.api.reported({ ...base, id: 'p3', name: 'Kite', at: w.t, did: 'Ended after it went on' });
  check(
    'a task that ends after it went on is sent',
    sent().length === n0 + 1 &&
      view().reports.length === 1 &&
      view().reports[0].did === 'Ended after it went on'
  );
  s.from = () => {
    throw new Error('no store');
  };
  s.api.reported({ ...base, id: 'p4', name: 'Fern', at: w.t, did: 'x' });
  s.from = () => NaN;
  s.api.reported({ ...base, id: 'p5', name: 'Ash', at: w.t, did: 'x' });
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  begin();
  check(
    'a from-time that cannot be read means never: nothing is sent, not at a session start either',
    sent().length === n0 + 1
  );
  from = 0;
  s.from = () => from;
  advance(120000);

  // the rate, set by the sender
  advance(120000);
  const n1 = sent().length;
  for (let i = 0; i < 10; i++)
    s.api.reported({ ...base, id: 'q' + i, name: 'Agent ' + i, at: w.t, did: 'first of ' + i });
  check(
    'ten tasks finish at once: ' +
      REPORTS_MIN +
      ' reports go in that minute, and one timer waits for the rest',
    sent().length === n1 + REPORTS_MIN &&
      w.timers.filter(h => /sendReports/.test(String(h.fn))).length === 1,
    sent().length - n1
  );
  s.api.reported({ ...base, id: 'q7', name: 'Agent 7', at: w.t, did: 'second of 7' });
  advance(59000);
  check('the rest wait, nothing more inside the minute', sent().length === n1 + REPORTS_MIN);
  advance(2000);
  const late = sent()
    .slice(n1 + REPORTS_MIN)
    .map(m => m.obj.did);
  check(
    'when the minute has room the newest of each waiting agent goes, an older one of the same agent was replaced',
    late.length === 4 &&
      late.includes('second of 7') &&
      !late.includes('first of 7') &&
      late.includes('first of 9'),
    late
  );
  advance(120000);
  const n2 = sent().length;
  for (let i = 0; i < REPORTS_MIN + REPORTS_HELD + 6; i++)
    s.api.reported({ ...base, id: 'w' + i, name: 'Waiter ' + i, at: w.t, did: 'd' + i });
  advance(10 * 60000);
  check(
    'no more than ' + REPORTS_HELD + ' ever wait: the oldest fall out, the newest are sent',
    sent().length === n2 + REPORTS_MIN + REPORTS_HELD &&
      sent().at(-1).obj.id === 'w' + (REPORTS_MIN + REPORTS_HELD + 5),
    sent().length - n2
  );
  check(
    'once all went no report timer is left',
    w.timers.every(h => !/sendReports/.test(String(h.fn))),
    w.timers.filter(h => /sendReports/.test(String(h.fn))).length
  );

  // what the receiver keeps, and how often it takes one
  check(
    'the receiver keeps the newest ' + REPORTS_MAX + ' of a computer',
    view().reports.length === REPORTS_MAX &&
      view().reports.at(-1).id === 'w' + (REPORTS_MIN + REPORTS_HELD + 5),
    view().reports.length
  );
  advance(120000);
  const p2 = r.seen.length;
  for (let i = 0; i < 40; i++)
    r.api.onMessage('dev-s', { t: 'report', id: 'flood' + i, name: 'F', at: w.t, did: 'x' + i });
  check(
    'forty in one go from a changed app: ' + REPORTS_MAX + ' are taken, the rest dropped unread',
    r.seen.length === p2 + REPORTS_MAX &&
      view().reports.length === REPORTS_MAX &&
      view().reports.at(-1).id === 'flood' + (REPORTS_MAX - 1),
    r.seen.length - p2
  );
  for (let i = 0; i < 40; i++) r.api.onMessage('dev-s', { t: 'report', id: 'bad' + i });
  advance(61000);
  r.api.onMessage('dev-s', { t: 'report', id: 'after', name: 'F', at: w.t, did: 'later' });
  check(
    'a minute later one is taken again',
    view().reports.at(-1).id === 'after' && view().reports.length === REPORTS_MAX
  );

  // sessions
  advance(120000);
  const kept = view().reports.length,
    n3 = sent().length;
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  check(
    'the session ended: nothing is live, the finished tasks stay with their times',
    view().state === 'offline' && view().agents.length === 0 && view().reports.length === kept
  );
  s.api.reported({
    ...base,
    id: 'away',
    name: 'Away',
    at: w.t,
    did: 'Finished while the other computer was away',
  });
  check('a task that finishes with no session is not sent', sent().length === n3);
  advance(30 * 60000);
  begin();
  check(
    'the next session gets it, with the other recent ones, inside the rate',
    view().reports.at(-1).id === 'away' && sent().length - n3 === REPORTS_MIN,
    sent().length - n3
  );

  // the minute has room again: each new session would re-send the six recent ones if the count were
  // kept per session
  advance(120000);
  const n4 = sent().length;
  for (let i = 0; i < 5; i++) {
    s.api.sessionEnded('dev-r');
    r.api.sessionEnded('dev-s');
    begin();
  }
  check(
    'a computer that restarts its session five times in one minute is sent ' +
      REPORTS_MIN +
      ' reports in all, not ' +
      REPORTS_MIN +
      ' per session',
    sent().length - n4 === REPORTS_MIN,
    sent().length - n4
  );
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  advance(REPORT_KEEP_MS + 60000);
  const n5 = sent().length;
  begin();
  advance(120000);
  check('a result older than an hour is not sent to a later session', sent().length === n5);

  // Review 14, finding 2: the hour counts from the task's own end time, not from the moment it was
  // handed over.
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  check(
    'review 14, 2: a task that ended more than an hour ago is not even kept',
    s.api.reported({ ...base, id: 'old1', name: 'Old', at: w.t - REPORT_KEEP_MS - 1, did: 'x' }) ===
      false
  );
  check(
    '(one that ended 59 minutes ago is kept)',
    s.api.reported({
      ...base,
      id: 'old2',
      name: 'Old',
      at: w.t - REPORT_KEEP_MS + 60000,
      did: 'x',
    }) === true
  );
  advance(120000);
  begin();
  advance(120000);
  check(
    'review 14, 2: and is not sent to a session that starts two minutes later: its hour has passed, though it was handed over just now',
    sent().length === n5
  );
  s.api.reported({ ...base, id: 'old3', name: 'Old', at: w.t - REPORT_KEEP_MS - 1, did: 'x' });
  check(
    'review 14, 2: nor is one that ended an hour ago sent during a session',
    sent().length === n5
  );

  // Review 14, finding 4: this computer stops telling (connecting off, signed out, Forget made
  // here).
  s.api.reported({ ...base, id: 'p1', at: w.t, did: 'Before it stopped telling' });
  const n6 = sent().length,
    held6 = view().reports.length;
  s.api.takeBack('dev-r');
  s.api.takeBack('dev-r');
  s.api.takeBack();
  check(
    'review 14, 4: taking back tells the other computer "no longer" once, and it drops what it held',
    held6 > 0 &&
      sent().length === n6 + 1 &&
      JSON.stringify(sent().at(-1).obj) === JSON.stringify({ t: 'report' }) &&
      view().reports.length === 0,
    [held6, sent().length - n6]
  );

  // …and what a computer left behind when it went away without a word has an end too.
  advance(120000);
  s.api.reported({ ...base, id: 'p1', at: w.t, did: 'Left behind' });
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  advance(REPORT_OFFLINE_MS - 60000);
  check(
    'a computer without a session: after 23 hours 59 minutes its finished task is still there',
    view().state === 'offline' && view().reports.some(x => x.did === 'Left behind')
  );
  advance(120000);
  check(
    'review 14, 4: after a day without a session it is dropped when it is read',
    view().reports.length === 0
  );
  begin();
  s.api.reported({ ...base, id: 'p1', at: w.t, did: 'Back' });
  const n7 = sent().length;

  // the switch went off while the other computer was away
  s.api.sessionEnded('dev-r');
  r.api.sessionEnded('dev-s');
  check('(the receiver still holds what it was sent)', view().reports.length > 0);
  s.detail = false;
  begin();
  check(
    'a session that starts with the switch off begins with "no longer": what was sent before is dropped',
    JSON.stringify(sent().at(-1).obj) === JSON.stringify({ t: 'report' }) &&
      sent().length === n7 + 1 &&
      view().reports.length === 0
  );
  s.detail = true;
  s.api.detailChanged('dev-r');
  r.api.onMessage('dev-s', { t: 'report', id: 'p1', name: 'Moss', at: w.t, did: 'one more' });
  r.api.forgetReports('dev-s');
  check('a paused pairing keeps none of them', view().reports.length === 0);
  r.api.onMessage('dev-s', { t: 'report', id: 'p1', name: 'Moss', at: w.t, did: 'and another' });
  r.api.forget('dev-s');
  check('forget drops them with everything else', r.api.view('dev-s') === null);
  s.api.stop();
  r.api.stop();
  check('after stop nothing more is told', s.api.reported({ ...base, at: w.t }) === false);
}

a.api.stop();
b.api.stop();
advance(10 * BEAT_MS);
check('stop leaves no timer running', w.timers.length === 0);

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);
