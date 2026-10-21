// Test of phone/src/conversation.mjs:  node phone/test/conversation-test.mjs  (plain Node).
// The phone reads an agent's conversation from a paired computer, against the computer's real
// answerer (desktop/remote-log.js createLogAnswerer). Messages cross as JSON. What it proves: the
// phone asks with the row's log handle and gets the entries in the computer's shaping; "Show
// earlier" and "what came since" join the held list; a phone is refused while the computer says
// phones may not read (the gate before the phone's own review); answers nobody asked for, junk
// parts and "no longer" are handled; the phone's shaping equals the computer's.
import { createRequire } from 'node:module';
import { createConversation, shapeLogEntry } from '../src/conversation.mjs';

const require = createRequire(import.meta.url);
const log = require('../../desktop/remote-log.js');

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
const LK = 'aaaaaaaaaaaaaaaa';
const settle = () => new Promise(r => setTimeout(r, 5));

function sample(count, from = 0) {
  const out = [];
  for (let i = from; i < from + count; i++)
    out.push(
      i % 2
        ? { kind: 'say', text: 'Answer ' + i, at: 1000 + i, pos: 1000 + i * 10 }
        : { kind: 'you', text: 'Prompt ' + i, at: 1000 + i, pos: 1000 + i * 10 }
    );
  return out;
}

function world({ phoneRefused = false } = {}) {
  const w = { t: 1_000_000, sent: [], timers: [] };
  let n = 0;
  w.phone = createConversation({
    now: () => w.t,
    timers: {
      set: (fn, ms) => (w.timers.push({ fn, at: w.t + ms }), w.timers.at(-1)),
      clear: h => (w.timers = w.timers.filter(x => x !== h)),
    },
    nonce: () => (++n).toString(16).padStart(16, '0'),
    row: (peer, agentId) => (peer === PHONE && agentId === 'p1' ? { id: 'p1', lk: LK } : null),
    send: (to, obj) => {
      w.sent.push(obj);
      w.answerer.receive(PHONE, JSON.parse(JSON.stringify(obj)));
      return true;
    },
  });
  w.read = { entries: sample(10), more: true, cursor: 50, next: 999, fresh: true };
  w.answerer = log.createLogAnswerer({
    now: () => w.t,
    may: () => true,
    isPhone: () => phoneRefused,
    check: (peerId, panelId, lk) =>
      lk === LK && panelId === 'p1' ? { record: { sessionId: 's1' } } : null,
    read: async () => w.read,
    cutFrom: () => 0,
    send: (to, obj) => {
      w.phone.receive(to, JSON.parse(JSON.stringify(obj)));
      return true;
    },
    room: () => 70,
    rev: () => 3,
  });
  return w;
}

{
  const w = world();
  const r = await w.phone.ask(PHONE, 'p1');
  await settle();
  check(
    "C1 the ask leaves with the row's handle",
    r.state === 'asked' && w.sent[0].t === 'logask' && w.sent[0].lk === LK,
    w.sent[0]
  );
  const got = w.phone.get(PHONE, 'p1');
  check(
    'C2 the conversation arrives: ten entries in order',
    got && got.state === 'held' && got.entries.length === 10 && got.entries[0].text === 'Prompt 0',
    got
  );
  check(
    "C3 the entries are in the computer's shaping",
    got.entries[1].k === 'say' && got.entries[1].at === 1001
  );
  check('C4 "more" says earlier entries exist', got.more === true);

  // too often
  const again = await w.phone.ask(PHONE, 'p1', 'new');
  check(
    'C5 a second ask within five seconds waits',
    again.state === 'too_often' && again.wait > 0,
    again
  );

  // Show earlier
  w.t += 6000;
  w.read = { entries: sample(4, 100), more: false, cursor: -1, next: 999 };
  const e = await w.phone.ask(PHONE, 'p1', 'earlier');
  await settle();
  const g2 = w.phone.get(PHONE, 'p1');
  check(
    'C6 "Show earlier" sends the cursor and puts the older entries first',
    e.state === 'asked' &&
      w.sent.at(-1).cursor === 1000 &&
      g2.entries.length === 14 &&
      g2.entries[0].text === 'Prompt 100',
    g2 && g2.entries.slice(0, 2)
  );

  // what came since
  w.t += 6000;
  w.read = { entries: sample(2, 200), more: false, cursor: -1, next: 1200 };
  await w.phone.ask(PHONE, 'p1', 'new');
  await settle();
  const g3 = w.phone.get(PHONE, 'p1');
  check(
    'C7 "what came since" sends `after` and adds at the end',
    w.sent.at(-1).after === 999 &&
      g3.entries.length === 16 &&
      g3.entries.at(-1).text === 'Answer 201',
    w.sent.at(-1)
  );

  // an agent without a handle
  check(
    'C8 an agent whose row carries no handle is never asked',
    (await w.phone.ask(PHONE, 'p2')).state === 'not_sent'
  );

  // junk and answers nobody asked for
  check(
    'C9 a part for a number never asked changes nothing',
    w.phone.receive(PHONE, {
      t: 'log',
      n: 'f'.repeat(16),
      i: 0,
      parts: 1,
      entries: [{ k: 'say', text: 'x' }],
    }) === false
  );
  w.phone.receive(PHONE, { t: 'log' });
  check('C10 "no longer" drops what is held', w.phone.get(PHONE, 'p1') === null);
}

{
  const w = world({ phoneRefused: true });
  await w.phone.ask(PHONE, 'p1');
  await settle();
  const got = w.phone.get(PHONE, 'p1');
  check(
    'C11 while the computer refuses phones, nothing of the conversation arrives',
    !got || got.entries.length === 0,
    got
  );
}

// the phone shapes as the computer shapes
{
  const inputs = [
    { kind: 'say', text: 'Key sk-ant-abcdefghijklmnop and C:\\Users\\me\\secret\\file.txt', at: 5 },
    { kind: 'act', verb: 'Opened', what: 'https://user:pw@example.com/path?q=1#x' },
    { kind: 'act', verb: 'Deleted', what: '/home/me/x.txt' },
    { kind: 'ask', questions: [{ q: 'Which?', options: ['A', 'B', ''] }] },
    { kind: 'worked', ms: 1234 },
    { kind: 'result', text: 'never leaves' },
    { kind: 'you', text: 'x'.repeat(5000) },
    { kind: 'say', text: 'password=hunter2 and Bearer abcdefghijkl' },
  ];
  const same = inputs.every(
    i => JSON.stringify(shapeLogEntry(i)) === JSON.stringify(log.shapeLogEntry(i))
  );
  check(
    'C12 every kind is shaped exactly as the computer shapes it',
    same,
    inputs
      .map(i => [shapeLogEntry(i), log.shapeLogEntry(i)])
      .find(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
  );
}

console.log(`conversation: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
