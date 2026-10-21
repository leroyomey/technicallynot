// Test of desktop/remote-log.js: node tools/remote-log-test.js (plain Node; also run it in
// Electron's Node). Another computer reads a running agent's conversation: the closed shape of an
// entry, the secret mask, paths and addresses, the packing into parts, the cut at the pairing time,
// the answering side's rate, one-time numbers, budget and endings, and the reading side's bounds.
// Fake secrets are put together at run time, so no scanner reads one in this file.
'use strict';
const {
  shapeLogEntry,
  maskSecrets,
  packAnswer,
  applyCut,
  createLogKeys,
  createLogAnswerer,
  createLogReader,
  createRevs,
  LOG_ENTRIES,
  LOG_PARTS,
  ENTRY_BYTES,
  HELD_ENTRIES,
  ASKS_MIN,
} = require('../desktop/remote-log.js');
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
const keysOf = entry => Object.keys(entry).sort().join(',');
const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

// ---------- the closed shape (finding 2) ----------
{
  const you = shapeLogEntry({
    kind: 'you',
    text: 'build it',
    at: 5,
    added: ['Rook is busy in this project'],
    __proto__: { evil: true },
  });
  check('you: only k, text and at', keysOf(you) === 'at,k,text', you);
  const act = shapeLogEntry({
    kind: 'act',
    id: 'x1',
    tool: 'Bash',
    verb: 'Ran',
    what: 'npm test',
    note: 'runs the tests',
    full: 'npm test --all',
    at: 7,
  });
  check('act: only k, verb, what and at', keysOf(act) === 'at,k,verb,what', act);
  const say = shapeLogEntry({ kind: 'say', text: 'done', model: 'opus', at: 9 });
  check('say: no model', keysOf(say) === 'at,k,text', say);
  const ask = shapeLogEntry({
    kind: 'ask',
    id: 'q',
    press: true,
    questions: [{ question: 'Which?', options: ['A', 'B'] }],
  });
  check(
    'ask: questions as q and options only',
    keysOf(ask) === 'k,questions' && keysOf(ask.questions[0]) === 'options,q',
    ask
  );
  check(
    'result, from, an unknown kind and a picture are never sent',
    [
      { kind: 'result', id: 'x', text: 'secret output' },
      { kind: 'from', who: 'Rook', text: 'hi' },
      { kind: 'thinking', text: 'hmm' },
      { kind: 'image', text: 'data:' },
      null,
      'you',
    ].every(entry => shapeLogEntry(entry) === null)
  );
  check(
    'an unknown verb reads Used',
    shapeLogEntry({ kind: 'act', verb: 'Deleted everything', what: 'x' }).verb === 'Used'
  );
  check(
    'shaping twice changes nothing',
    [you, act, say, ask, shapeLogEntry({ kind: 'worked', ms: 1200, at: 3 })].every(
      entry => JSON.stringify(shapeLogEntry(entry)) === JSON.stringify(entry)
    )
  );
  const long = shapeLogEntry({ kind: 'you', text: 'x'.repeat(5000) });
  check('you is cut at 1,000 characters with cut', long.text.length === 1000 && long.cut === true);
  const longSay = shapeLogEntry({ kind: 'say', text: 'y'.repeat(5000) });
  check('say is cut at 2,000 characters', longSay.text.length === 2000 && longSay.cut === true);
  const wide = shapeLogEntry({ kind: 'say', text: '\u{1F600}'.repeat(2000) });
  check(
    'an entry of wide characters still fits 3,000 bytes',
    Buffer.byteLength(JSON.stringify(wide)) <= ENTRY_BYTES
  );
  const many = shapeLogEntry({
    kind: 'ask',
    questions: [1, 2, 3, 4].map(n => ({
      question: 'q'.repeat(500),
      options: Array.from({ length: 9 }, () => 'o'.repeat(200)),
    })),
  });
  check(
    'ask: at most 2 questions of 300, 6 options of 80',
    many.questions.length === 2 &&
      many.questions[0].q.length === 300 &&
      many.questions[0].options.length === 6 &&
      many.questions[0].options[0].length === 80,
    many
  );
  check(
    'act what is at most 100 characters',
    shapeLogEntry({ kind: 'act', verb: 'Ran', what: 'z'.repeat(400) }).what.length === 100
  );
}

// ---------- control characters and markup (finding 12) ----------
{
  const say = shapeLogEntry({
    kind: 'say',
    text: 'red \x1b[31mtext\u202E <img src=x onerror=alert(1)> ![x](https://example.invalid/a.png)',
  });
  check('no ESC and no direction override arrive', !/[\x1b\u202E]/.test(say.text), say.text);
}

// ---------- paths and addresses (finding 2) ----------
{
  check(
    'a path outside the project leaves as its last part',
    shapeLogEntry({ kind: 'act', verb: 'Read', what: 'C:/Users/someone/x.txt' }).what === '…/x.txt'
  );
  check(
    'a path inside a command is shortened too',
    shapeLogEntry({ kind: 'act', verb: 'Ran', what: 'type C:\\Users\\someone\\notes.md' }).what ===
      'type …/notes.md'
  );
  check(
    'a path inside the project is left as it is',
    shapeLogEntry({ kind: 'act', verb: 'Edited', what: 'src/app.js' }).what === 'src/app.js'
  );
  check(
    'an address keeps scheme, host and path only',
    shapeLogEntry({ kind: 'act', verb: 'Opened', what: 'https://u:p@h/p?token=1#x' }).what ===
      'https://h/p'
  );
}

// ---------- the secret mask (finding 22) ----------
{
  const samples = [
    'sk' + '-ant-' + 'api03-' + 'a1B2c3D4e5F6g7H8i9J0',
    'sk' + '-' + 'proj' + 'A1b2C3d4E5f6G7h8I9j0K1l2',
    'gh' + 'p_' + 'A'.repeat(36),
    'github' + '_pat_' + 'B'.repeat(40),
    'xo' + 'xb-' + '1234567890-abcdefghij',
    'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
    'AI' + 'za' + 'C'.repeat(35),
    'ey' + 'Jhbgcioi' + '.ey' + 'Jzdwiioi' + '.signature',
    '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----',
  ];
  for (const secret of samples) {
    const you = shapeLogEntry({ kind: 'you', text: 'use ' + secret + ' now' });
    const say = shapeLogEntry({ kind: 'say', text: 'I used ' + secret + '.' });
    const act = shapeLogEntry({ kind: 'act', verb: 'Ran', what: 'run ' + secret });
    check(
      'hidden in you, say and act: ' + secret.slice(0, 12),
      [you.text, say.text, act.what].every(t => t.includes('[hidden]') && !t.includes(secret)),
      [you.text, say.text, act.what]
    );
  }
  check(
    'a bearer token and named values are hidden',
    maskSecrets('curl -H "Authorization: Bearer abcdefghijklmnop" x') ===
      'curl -H "Authorization: Bearer [hidden]" x' &&
      maskSecrets('password=hunter22 token: abc123xyz') === 'password=[hidden] token: [hidden]',
    [maskSecrets('Bearer abcdefghijklmnop'), maskSecrets('password=hunter22 token: abc123xyz')]
  );
  check(
    'ordinary words are left alone',
    maskSecrets('the task-list and max_tokens: 100 and desk-top') ===
      'the task-list and max_tokens: 100 and desk-top'
  );
  let touched = 0;
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const hex = '0123456789abcdef';
  const b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < 1000; i++) {
    const set = i % 2 ? hex : b64;
    let word = '';
    for (let j = 0; j < 40; j++) word += set[Math.floor(rand() * set.length)];
    const text = 'commit ' + word + ' is fine';
    if (maskSecrets(text) !== text) touched++;
  }
  check('1,000 random hex and base64 strings are not touched', touched === 0, touched);
}

// ---------- packing (finding 5) ----------
{
  const big = [];
  for (let i = 0; i < 500; i++)
    big.push({ pos: i * 100, shaped: shapeLogEntry({ kind: 'say', text: 's'.repeat(2000) }) });
  const packed = packAnswer(big);
  check(
    '500 long entries: at most 6 parts, each at most one sealed message',
    packed.parts.length <= LOG_PARTS &&
      packed.parts.every(
        part =>
          Buffer.byteLength(
            JSON.stringify({
              t: 'log',
              n: 'f'.repeat(16),
              i: 5,
              parts: 6,
              rev: 2147483647,
              more: true,
              cursor: 9e15,
              next: 9e15,
              older: true,
              fresh: true,
              entries: part,
            })
          ) <= MAX_PLAIN
      ) &&
      packed.more === true,
    packed.parts.length
  );
  const small = [];
  for (let i = 0; i < 200; i++)
    small.push({ pos: i, shaped: shapeLogEntry({ kind: 'note', text: 'n' + i }) });
  const p2 = packAnswer(small);
  const flat = p2.parts.flat();
  check(
    'at most 80 entries, the newest, oldest first, the cursor at the oldest sent',
    flat.length === LOG_ENTRIES &&
      flat[0].text === 'n120' &&
      flat[79].text === 'n199' &&
      p2.cursor === 120 &&
      p2.more === true,
    [flat.length, flat[0] && flat[0].text, p2.cursor]
  );
  const group = [
    { pos: 1, shaped: { k: 'note', text: 'a' } },
    { pos: 2, shaped: { k: 'note', text: 'b' } },
    { pos: 2, shaped: { k: 'note', text: 'c' } },
  ];
  const p3 = packAnswer(group);
  check(
    'a line all or nothing; everything fits',
    p3.parts.flat().length === 3 && p3.more === false
  );
}

// ---------- the cut at the pairing (decision B, finding 16) ----------
{
  const cutAt = 1000000;
  const entries = [
    { pos: 1, shaped: { k: 'you', text: 'old', at: cutAt - 60000 } },
    { pos: 2, shaped: { k: 'say', text: 'old answer' } },
    { pos: 3, shaped: { k: 'you', text: 'new', at: cutAt + 60000 } },
    { pos: 4, shaped: { k: 'say', text: 'new answer' } },
  ];
  const { kept, older } = applyCut(entries, cutAt);
  check(
    'only entries after the pairing leave; one without a time takes the one before it',
    kept.map(e => e.shaped.text).join('|') === 'new|new answer' && older === true
  );
  const cursor = [
    { pos: 1, shaped: { k: 'you', text: 'no time' } },
    { pos: 2, shaped: { k: 'say', text: 'no time either' } },
  ];
  check(
    'a record without times (Cursor) sends nothing older than the cut',
    applyCut(cursor, cutAt).kept.length === 0
  );
}

// ---------- the handle and the counter (findings 3, 14) ----------
{
  const keys = createLogKeys(n => Buffer.alloc(n, 3));
  const agent = { instance: 'i1', name: 'Rook', cli: 'Claude Code', pid: 4, startedAt: 9 };
  const one = keys.handle('pair', 'b', 'p3', agent, 'session-1');
  check('a handle is 16 hex', /^[0-9a-f]{16}$/.test(one));
  check(
    'a new conversation in the same panel is a new handle',
    keys.handle('pair', 'b', 'p3', agent, 'session-2') !== one
  );
  check(
    'a new agent in the same panel is a new handle',
    keys.handle('pair', 'b', 'p3', { ...agent, instance: 'i2' }, 'session-1') !== one
  );
  check('no conversation, no handle', keys.handle('pair', 'b', 'p3', agent, '') === '');
  const revs = createRevs();
  revs.bump('p1', 'a');
  revs.bump('p1', 'a');
  revs.bump('p2', 'b');
  check(
    'two agents count apart, a new instance starts at 0',
    revs.of('p1', 'a') === 2 && revs.of('p2', 'b') === 1 && revs.of('p1', 'other') === 0
  );
}

// ---------- the answering computer (findings 5, 6, 8, 9, 15, 17, 21) ----------
const sample = count =>
  Array.from({ length: count }, (_, i) => ({
    kind: 'say',
    text: 'line ' + i,
    at: 2000000 + i,
    pos: i * 10,
  }));

function answerer(over = {}) {
  const world = {
    t: 5000000,
    sent: [],
    reads: 0,
    reads2: [],
    allowed: true,
    phone: false,
    handle: 'aaaaaaaaaaaaaaaa',
    record: { sessionId: 's1' },
    room: 70,
    onRead: [],
    entries: sample(10),
  };
  world.a = createLogAnswerer({
    now: () => world.t,
    may: () => world.allowed,
    isPhone: () => world.phone,
    check: (peerId, panelId, lk) =>
      lk === world.handle && panelId === 'p1' ? { record: world.record } : null,
    read: async (record, where) => {
      world.reads++;
      world.reads2.push({ record, where });
      return {
        entries: world.entries,
        more: false,
        next: 999,
        fresh: true,
        ...(over.read ? over.read() : {}),
      };
    },
    cutFrom: () => 1000000,
    onRead: (peerId, panelId) => world.onRead.push(peerId + ':' + panelId),
    send: (to, obj) => {
      if (over.onSend) over.onSend(world, obj);
      world.sent.push({ to, obj: JSON.parse(JSON.stringify(obj)) });
      return true;
    },
    room: () => world.room,
    rev: () => 3,
  });
  return world;
}
let nonce = 0;
const nextN = () => (++nonce).toString(16).padStart(16, '0');
const askOf = (extra = {}) => ({
  t: 'logask',
  n: nextN(),
  id: 'p1',
  lk: 'aaaaaaaaaaaaaaaa',
  ...extra,
});

(async () => {
  {
    const w = answerer();
    w.a.receive('b', askOf());
    await settle();
    const parts = w.sent.filter(s => s.obj.t === 'log');
    check(
      'an ask is answered with its entries, shaped, newest last',
      parts.length === 1 &&
        parts[0].obj.entries.length === 10 &&
        parts[0].obj.entries[9].text === 'line 9' &&
        parts[0].obj.rev === 3 &&
        parts[0].obj.fresh === true,
      parts.map(p => p.obj)
    );
    check('one Devices line', w.onRead.join() === 'b:p1');
    w.t += 6000;
    w.a.receive('b', askOf());
    w.t += 6000;
    w.a.receive('b', askOf());
    await settle();
    check('three asks of one agent in one session write one line', w.onRead.length === 1);
  }
  {
    const w = answerer();
    for (let i = 0; i < 200; i++) w.a.receive('b', askOf());
    await settle();
    check('200 asks in a row: at most 6 reads in that minute', w.reads <= ASKS_MIN, w.reads);

    // each ask waits for the one before it to finish, so only the count holds them back
    const w2 = answerer();
    for (let i = 0; i < 20; i++) {
      w2.a.receive('b', askOf());
      await settle();
      w2.t += 1000;
    }
    check('20 asks spread over a minute: exactly 6 reads', w2.reads === ASKS_MIN, w2.reads);
  }
  {
    const w = answerer();
    const ask = askOf();
    w.a.receive('b', ask);
    await settle();
    w.a.receive('b', { ...ask });
    await settle();
    check('the same logask twice sends one answer', w.sent.length === 1, w.sent.length);
  }
  {
    const w = answerer();
    w.allowed = false;
    w.a.receive('b', askOf());
    await settle();
    check('switch off: nothing read, nothing sent', w.reads === 0 && w.sent.length === 0);
    w.allowed = true;
    w.phone = true;
    w.a.receive('b', askOf());
    await settle();
    check('a phone pairing: nothing sent', w.reads === 0 && w.sent.length === 0);
    w.phone = false;
    w.a.receive('b', askOf({ lk: 'bbbbbbbbbbbbbbbb' }));
    await settle();
    check('a wrong handle reads nothing and sends nothing', w.reads === 0 && w.sent.length === 0);
    w.a.receive('b', { t: 'pastask', n: nextN() });
    await settle();
    check('a past-conversations kind is not known', w.reads === 0 && w.sent.length === 0);
    w.onRead.length = 0;
    w.a.receive('b', askOf({ id: 'p9', lk: 'aaaaaaaaaaaaaaaa' }));
    await settle();
    check('a refused ask writes no Devices line', w.onRead.length === 0 && w.reads === 0);
  }
  {
    const w = answerer();
    w.a.receive('b', askOf({ sub: 'helper-1' }));
    await settle();
    check(
      'an ask with sub is answered as if it were absent',
      w.reads2.length === 1 && !('sub' in w.reads2[0].where)
    );
  }
  {
    // the conversation changed between the ask and the read
    const w = answerer({
      read: () => {
        return {};
      },
    });
    const real = w.a;
    w.record = { sessionId: 's1' };
    w.a.receive('b', askOf());
    w.record = { sessionId: 's2' };
    await settle();
    check('a session that changed between ask and read sends nothing', w.sent.length === 0);
    void real;
  }
  {
    // the switch goes off between part 2 and part 3
    const w = answerer({
      onSend: (world, obj) => {
        if (obj.t === 'log' && obj.i === 1) world.allowed = false;
      },
    });
    w.entries = sample(300).map(e => ({ ...e, text: 't'.repeat(1900) }));
    w.a.receive('b', askOf());
    await settle();
    const parts = w.sent.filter(s => s.obj.t === 'log');
    check(
      'the switch going off after part 2: part 3 never leaves',
      parts.length === 2 && parts.every(p => p.obj.i < 2),
      parts.map(p => p.obj.i)
    );
  }
  {
    // no room on the stream line: one busy
    const w = answerer();
    w.room = 0;
    w.a.receive('b', askOf());
    await settle();
    check('no room at all: nothing is sent', w.sent.length === 0);
    w.room = 1;
    w.t += 6000;
    w.entries = sample(300).map(e => ({ ...e, text: 't'.repeat(1900) }));
    w.a.receive('b', askOf());
    await settle();
    check(
      'room for one only: one busy, never half an answer',
      w.sent.length === 1 && w.sent[0].obj.busy === true,
      w.sent.map(s => s.obj)
    );
  }
  {
    // 24 log messages a minute for all computers together
    const w = answerer();
    w.entries = sample(300).map(e => ({ ...e, text: 't'.repeat(1900) }));
    for (const peer of ['b', 'c', 'd', 'e', 'f']) w.a.receive(peer, askOf());
    await settle();
    await settle();
    const logs = w.sent.filter(s => s.obj.t === 'log');
    const partials = new Map();
    for (const s of logs) if (!s.obj.busy) partials.set(s.obj.n, (partials.get(s.obj.n) || 0) + 1);
    check(
      'five computers at once: at most 24 log messages in the minute, every answer whole',
      logs.length <= 24 &&
        [...partials].every(([n, count]) => {
          const first = logs.find(s => s.obj.n === n && s.obj.i === 0);
          return first && first.obj.parts === count;
        }),
      [logs.length, [...partials.values()]]
    );
  }
  {
    // a read for a computer that left is not run; endFor stops what is under way
    const w = answerer();
    w.a.receive('b', askOf());
    w.a.endFor('b');
    await settle();
    check('a stalled read for a computer that left is not run', w.reads === 0 && !w.sent.length);
    w.a.receive('b', askOf());
    const said = w.a.noLonger('b');
    await settle();
    check(
      '"no longer" is one message without a number, and nothing else follows',
      said === true && w.sent.length === 1 && JSON.stringify(w.sent[0].obj) === '{"t":"log"}'
    );
  }

  // ---------- the reading computer (findings 8, 13, 20) ----------
  function reader() {
    const world = { t: 1, sent: [], timers: [], changed: 0, rows: {} };
    world.r = createLogReader({
      now: () => world.t,
      timers: {
        set: (fn, ms) => {
          const handle = { fn, at: world.t + ms };
          world.timers.push(handle);
          return handle;
        },
        clear: handle => {
          world.timers = world.timers.filter(h => h !== handle);
        },
      },
      nonce: nextN,
      row: (peerId, agentId) => world.rows[peerId + ':' + agentId] || null,
      send: (to, obj) => {
        world.sent.push({ to, obj });
        return true;
      },
      on: { changed: () => world.changed++ },
    });
    world.rows['a:p1'] = { id: 'p1', lk: 'aaaaaaaaaaaaaaaa' };
    return world;
  }
  const answer = (n, entries, extra = {}) => ({
    t: 'log',
    n,
    i: 0,
    parts: 1,
    rev: 2,
    fresh: true,
    entries,
    ...extra,
  });
  {
    const w = reader();
    check(
      'an unasked log is dropped',
      w.r.receive('a', answer(nextN(), [{ k: 'note', text: 'x' }])) === false &&
        w.r.get('a', 'p1') === null
    );
    check('a row without a handle asks nothing', w.r.ask('a', 'p2').state === 'not_sent');
    w.r.ask('a', 'p1');
    const n = w.sent[0].obj.n;
    check('the ask names the row id and its handle only', keysOf(w.sent[0].obj) === 'id,lk,n,t');
    check('a second ask within 5 seconds is too often', w.r.ask('a', 'p1').state === 'too_often');
    check('from another computer it is dropped', w.r.receive('c', answer(n, [])) === false);
    check(
      'a part with parts: 1000 is dropped',
      w.r.receive('a', answer(n, [], { parts: 1000 })) === false
    );
    w.t += 6000;
    w.r.ask('a', 'p1');
    const n2 = w.sent[w.sent.length - 1].obj.n;
    const entries = Array.from({ length: 81 }, (_, i) => ({ k: 'note', text: 'e' + i }));
    entries.push({ k: 'you', text: 'x', __proto__: { polluted: true }, added: ['z'] });
    check('81 entries and a __proto__ key do not throw', w.r.receive('a', answer(n2, entries)));
    const got = w.r.get('a', 'p1');
    check(
      'at most 80 entries are kept, each shaped',
      got.entries.length === 80 && got.entries.every(e => keysOf(e) === 'k,text') && !{}.polluted,
      got.entries.length
    );
    check(
      'nothing of the words is in the mark',
      !JSON.stringify(w.r.mark('a', 'p1')).includes('e1')
    );
  }
  {
    const w = reader();
    w.r.ask('a', 'p1');
    const n = w.sent[0].obj.n;
    w.r.receive('a', answer(n, [{ k: 'note', text: 'one' }], { parts: 2 }));
    w.t += 16000;
    w.timers.filter(h => h.at <= w.t).forEach(h => h.fn());
    check(
      'a half answer is dropped after 15 seconds and says no reply',
      w.r.get('a', 'p1').state === 'no_reply' && w.r.get('a', 'p1').entries.length === 0
    );
  }
  {
    const w = reader();
    for (let i = 1; i <= 7; i++) w.rows['a:p' + i] = { id: 'p' + i, lk: 'aaaaaaaaaaaaaaaa' };
    for (let i = 1; i <= 7; i++) {
      w.r.ask('a', 'p' + i);
      const n = w.sent[w.sent.length - 1].obj.n;
      w.r.receive('a', answer(n, [{ k: 'note', text: 'agent ' + i }]));
      w.t += 11000;
    }
    check(
      'seven agents of one computer: six are held, the oldest went',
      w.r.held('a').length === 6 && w.r.get('a', 'p1') === null,
      w.r.held('a')
    );
    w.r.receive('a', { t: 'log' });
    check('"no longer" drops everything of that computer', w.r.held('a').length === 0);
  }
  {
    // Show earlier until 400
    const w = reader();
    w.r.ask('a', 'p1');
    let n = w.sent[w.sent.length - 1].obj.n;
    const page = from =>
      Array.from({ length: 80 }, (_, i) => ({ k: 'note', text: 'n' + (from + i) }));
    w.r.receive('a', answer(n, page(1000), { more: true, cursor: 500 }));
    let rounds = 0;
    for (; rounds < 10; rounds++) {
      w.t += 11000;
      const asked = w.r.ask('a', 'p1', 'earlier');
      if (asked.state !== 'asked') break;
      const message = w.sent[w.sent.length - 1].obj;
      check('Show earlier sends the cursor it was given', message.cursor === 500 - rounds * 10);
      n = message.n;
      w.r.receive(
        'a',
        answer(n, page(900 - rounds * 80), { more: true, cursor: 490 - rounds * 10, fresh: false })
      );
    }
    const got = w.r.get('a', 'p1');
    check(
      'Show earlier stops at 400 entries',
      got.entries.length === HELD_ENTRIES && got.full === true && rounds === 4,
      [got.entries.length, rounds]
    );
  }
  {
    // what is new is added after what is held
    const w = reader();
    w.r.ask('a', 'p1');
    const n = w.sent[0].obj.n;
    w.r.receive('a', answer(n, [{ k: 'note', text: 'first' }], { next: 120 }));
    w.t += 6000;
    w.r.ask('a', 'p1', 'new');
    const message = w.sent[w.sent.length - 1].obj;
    w.r.receive('a', answer(message.n, [{ k: 'note', text: 'second' }], { fresh: false }));
    check(
      'a new turn is asked from where the last answer ended and added after it',
      message.after === 120 &&
        w.r
          .get('a', 'p1')
          .entries.map(e => e.text)
          .join() === 'first,second'
    );
  }

  console.log(`${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('ERROR ' + (error.stack || error));
  process.exit(1);
});
