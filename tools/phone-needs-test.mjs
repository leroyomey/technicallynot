// Test of phone/src/needs.mjs and desktop/phone-answer.js:  node tools/phone-needs-test.mjs
// The computer's side is the app's real sender (desktop/remote-api.js) and the draft answer rules
// (desktop/phone-answer.js); messages go between them as JSON text, as they would over a session. A
// clock and timers moved by hand. Plain Node.
import { createRequire } from 'node:module';
import {
  createNeeds,
  shape,
  bindingOf,
  bindingOf2,
  WAYS,
  STALE_MS,
  BEAT_MS,
  REPLY_MS,
} from '../phone/src/needs.mjs';
const require = createRequire(import.meta.url);
const { createRemoteApi, shape: desktopShape } = require('../desktop/remote-api.js'),
  {
    phoneAnswers,
    bindingOf: desktopBinding,
    WAYS: desktopWays,
    PER_MINUTE,
  } = require('../desktop/phone-answer.js');

let passed = 0,
  failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else {
    failed++;
    console.log(
      'FAIL ' +
        name +
        (detail ? '  ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')
    );
  }
};
const wire = m => JSON.parse(JSON.stringify(m));
const tick = () => new Promise(r => setImmediate(r));

// One computer and one phone with a "session" between them: what one sends, the other gets, unless
// the test holds it back.
function pair({
  rightsOf = () => ({ see: true, answer: true }),
  detail = () => true,
  deliver = null,
} = {}) {
  const w = {
    t: 1700000000000,
    wallOffset: 0,
    timers: [],
    items: [],
    toPhone: [],
    toPc: [],
    session: true,
    delivered: [],
    changed: 0,
    names: { p1: 'Moss', p2: 'Kite' },
  };
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
  w.advance = async ms => {
    const end = w.t + ms;
    for (;;) {
      const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.clear(due);
      w.t = Math.max(w.t, due.at);
      due.fn();
      await w.flush();
    }
    w.t = end;
  };
  const out = (id, obj) => {
    if (!w.session) return false;
    w.toPhone.push(wire(obj));
    return true;
  };
  w.api = createRemoteApi({
    send: out,
    items: () => w.items,
    agentName: pane => w.names[pane] || '',
    showDetail: detail,
    now: () => w.t,
    timers,
  });
  w.answers = phoneAnswers({
    items: () => w.items,
    rights: rightsOf,
    showDetail: detail,
    agentName: pane => w.names[pane] || '',
    send: out,
    now: () => w.t,
    deliver: deliver
      ? (...a) => deliver(w, ...a)
      : (item, say, from) => {
          w.delivered.push({ item, say, from });
          w.items = w.items.filter(x => x.id !== item.id);
          return true;
        },
  });
  w.needs = createNeeds({
    send: async (id, obj) => {
      await tick();
      if (!w.session || w.sendFails) return false;
      w.toPc.push(wire(obj));
      return true;
    },
    on: {
      changed: () => {
        w.changed++;
      },
    },
    now: () => w.t,
    wall: () => w.t + w.wallOffset,
    timers,
  });

  // Carries everything waiting, both ways, until nothing is left.
  w.flush = async () => {
    for (let n = 0; n < 500; n++) {
      await w.needs.idle();
      if (!w.toPhone.length && !w.toPc.length) break;
      if (w.toPhone.length) {
        w.needs.onMessage('pc', w.toPhone.shift());
        continue;
      }
      const m = w.toPc.shift(),
        before = JSON.stringify(w.items);
      await w.answers.receive('ph', m);
      w.api.onMessage('ph', m);
      if (JSON.stringify(w.items) !== before) w.api.changed();
    }
    await w.needs.idle();
  };
  w.start = async () => {
    w.session = true;
    w.needs.sessionStarted('pc');
    w.api.sessionStarted('ph');
    await w.flush();
  };
  w.end = async () => {
    w.session = false;
    w.toPhone.length = 0;
    w.toPc.length = 0;
    w.needs.sessionEnded('pc');
    w.api.sessionEnded('ph');
    await w.needs.idle();
  };
  w.view = () => w.needs.view('pc');
  w.item = id => w.view().items.find(x => x.id === id);
  w.say = (id, say) => {
    const it = w.item(id);
    return w.needs.answer('pc', id, it ? it.of : 'none', say);
  };

  // What a hostile phone could send, straight to the computer's rules; gives the computer's result
  // and its reply.
  w.raw = async m => {
    const r = await w.answers.receive('ph', m),
      back = w.toPhone.pop();
    w.toPhone.length = 0;
    return [r, back];
  };
  w.ofPc = id => {
    const it = w.items.find(x => x.id === id);
    return desktopBinding(
      desktopShape(
        {
          id: it.id,
          kind: it.kind,
          agent: w.names[it.paneId] || '',
          detail: it.detail,
          since: it.since,
          inferred: it.inferred,
        },
        true
      )
    );
  };
  return w;
}
const item = (id, kind, paneId, detail, since = 1700000000000, inferred = false) => ({
  id,
  paneId,
  kind,
  detail,
  since,
  inferred,
});

// 1. The shaping and the binding are the desktop's, for every odd input.
{
  const odd = [
    null,
    7,
    'x',
    {},
    { id: '' },
    { id: 'a' },
    {
      id: 'a',
      kind: 'permission',
      agent: 'Moss',
      since: 5,
      inferred: true,
      detail: 'Allow npm install?',
    },
    { id: 'a', kind: 'nope', agent: 'x'.repeat(200), since: -1, detail: '' },
    { id: 'a‮b\u0000c', kind: 'question', agent: 'M​oss\nline two', since: 1e15, detail: '   ' },
    {
      id: 'x'.repeat(300),
      kind: 'menu',
      detail: 'y'.repeat(300),
      since: 12.7,
      extra: { deep: true },
      __proto__: { polluted: 1 },
    },
    { id: 5, kind: 'draft', detail: 0 },
  ];
  ok(
    'the phone shapes an item exactly as the computer does, for every odd input',
    odd.every(o => JSON.stringify(shape(o)) === JSON.stringify(desktopShape(o, true))),
    odd.map(o => JSON.stringify(shape(o)) === JSON.stringify(desktopShape(o, true)))
  );
  const shaped = odd.map(o => shape(o)).filter(Boolean);
  ok(
    'both sides tie an answer to a prompt by the same bytes',
    (await Promise.all(shaped.map(async s => (await bindingOf(s)) === desktopBinding(s)))).every(
      Boolean
    ) && shaped.length >= 5
  );
  const base = {
      id: 'permission:p1',
      kind: 'permission',
      agent: 'Moss',
      since: 5,
      inferred: false,
      detail: 'Read: README.md',
    },
    b0 = await bindingOf(base);
  const changed = await Promise.all(
    [
      { detail: 'Bash: rm -rf /' },
      { kind: 'trust' },
      { agent: 'Kite' },
      { since: 6 },
      { inferred: true },
      { id: 'permission:p2' },
    ].map(c => bindingOf({ ...base, ...c }))
  );
  {
    const { bindingOf2: desktop2 } = require('../desktop/remote-control.js'),
      long = { ...base, detail: 'Bash: a && b', full: 'a &&\n  b' };
    ok(
      'the binding for a longer command (v2) is the same bytes on both sides, and is not the v1 binding',
      (await bindingOf2(long)) === desktop2(long) &&
        (await bindingOf2(long)) !== (await bindingOf(long)) &&
        (await bindingOf2({ ...long, full: 'a &&\n  c' })) !== (await bindingOf2(long))
    );
  }
  ok(
    'any change to what the user was shown gives another binding',
    changed.every(b => b !== b0) && new Set(changed).size === changed.length
  );
  ok(
    'the only thing a phone may answer is a permission prompt, on both sides',
    JSON.stringify(WAYS) === '{"permission":"choice"}' &&
      JSON.stringify(WAYS) === JSON.stringify(desktopWays)
  );
}

// 2. The list arrives, changes, and clears; names and text come from the computer, shaped.
{
  const w = pair();
  w.items = [
    item('q1', 'permission', 'p1', 'Allow npm install stripe?'),
    item('q2', 'question', 'p2', 'What should the banner say?'),
    item('q3', 'menu', 'p1', 'Which layout?'),
    item('q4', 'error', 'p2', 'Out of credits'),
    item('q5', 'trust', 'p1', 'Trust this folder?'),
    item('q6', 'permission', 'p2', 'Allow?', 1700000000000, true),
    item('q7', 'permission', 'p1', ''),
  ];
  ok(
    'before a session the phone knows nothing of the computer',
    w.view() === null && w.needs.all().length === 0
  );
  await w.start();
  const v = w.view();
  ok(
    'the list arrives with the session',
    v.state === 'live' && v.items.map(x => x.id).join() === 'q1,q2,q3,q4,q5,q6,q7',
    v
  );
  ok(
    'each item has its agent, kind and text',
    v.items[0].agent === 'Moss' &&
      v.items[0].kind === 'permission' &&
      v.items[0].detail === 'Allow npm install stripe?' &&
      v.items[1].agent === 'Kite'
  );
  ok(
    'only a permission prompt with its text, not inferred, can be answered here: not a question, menu, error, trust, an inferred one or one without text',
    v.items.map(x => x.way || '-').join() === 'choice,-,-,-,-,-,-',
    v.items.map(x => x.way)
  );
  w.items = w.items.slice(1);
  w.api.changed();
  await w.flush();
  ok(
    "a cleared item leaves the phone's list",
    w
      .view()
      .items.map(x => x.id)
      .join() === 'q2,q3,q4,q5,q6,q7'
  );
  w.items = [];
  w.api.changed();
  await w.flush();
  ok(
    'an empty list is "nothing reported", and the computer is still live',
    w.view().items.length === 0 && w.view().state === 'live'
  );
  ok('the listener was told each time', w.changed >= 3, w.changed);
}

// 3. A long list comes in parts and is put together; a broken sequence is dropped whole.
{
  const w = pair();
  w.items = Array.from({ length: 120 }, (_, i) =>
    item(
      'q' + i,
      'question',
      'p1',
      'A question with enough text to fill an envelope quickly, number ' + i
    )
  );
  w.needs.sessionStarted('pc');
  w.api.sessionStarted('ph');
  const parts = w.toPhone.length;
  await w.flush();
  ok(
    '120 items travel as several messages and arrive as one list',
    parts > 1 && w.view().items.length === 120 && w.view().items[119].id === 'q119',
    [parts, w.view().items.length]
  );
  w.items = w.items.slice(0, 60);
  w.api.changed();
  const held = w.toPhone.splice(1, 1);
  await w.flush(); // one part lost on the way
  ok(
    'a list with a part missing changes nothing',
    w.view().items.length === 120 && held.length === 1,
    w.view().items.length
  );
  const many = Array.from({ length: 300 }, (_, i) => ({ id: 'z' + i, kind: 'question' }));
  w.needs.onMessage('pc', { t: 'needs', g: 999, i: 0, n: 1, items: many.concat(many) });
  await w.needs.idle();
  ok(
    'more than 200 items, or the same id twice, are cut',
    w.view().items.length === 200 && new Set(w.view().items.map(x => x.id)).size === 200
  );
  for (const bad of [
    { t: 'needs', g: 1000, i: 1, n: 2, items: [] },
    { t: 'needs', g: 'x', i: 0, n: 1, items: [] },
    { t: 'needs', g: 1001, i: 0, n: 65, items: [] },
    { t: 'needs', g: 1002, i: 0, n: 1, items: 'no' },
    { t: 'other' },
    null,
    5,
    { t: 'needs' },
  ])
    w.needs.onMessage('pc', bad);
  await w.needs.idle();
  ok('malformed list messages change nothing', w.view().items.length === 200);
  w.needs.onMessage('stranger', { t: 'needs', g: 1, i: 0, n: 1, items: [{ id: 'evil' }] });
  await w.needs.idle();
  ok(
    'a list from a device with no session is ignored',
    w.needs.view('stranger') === null && w.needs.all().length === 1
  );
}

// 4. Last heard and offline: nothing keeps waiting, and nothing can be answered meanwhile. The rule runs on a clock that cannot be set back.
{
  const w = pair();
  w.items = [item('q1', 'permission', 'p1', 'Allow?')];
  await w.start();
  await w.advance(BEAT_MS + 1000);
  ok('heartbeats keep the computer live while it has open items', w.view().state === 'live');
  w.session = false;
  w.wallOffset = -3600000; // nothing arrives any more, and the phone's time of day is set back an hour
  await w.advance(STALE_MS + 5000);
  ok(
    'two missed heartbeats: last heard, the item still shown, whatever the time of day says',
    w.view().state === 'last_heard' && w.view().items.length === 1 && w.view().heard > 0,
    w.view()
  );
  ok(
    'an item of a computer that is not live cannot be answered: nothing is sent',
    (await w.say('q1', 'yes')) === 'not_live' && w.toPc.length === 0
  );
  w.session = true;
  w.wallOffset = 0;
  await w.advance(BEAT_MS);
  await w.flush();
  ok('a heartbeat brings it back to live', w.view().state === 'live');
  await w.end();
  ok(
    'the session ended: offline, no item kept, last heard remembered',
    w.view().state === 'offline' && w.view().items.length === 0 && w.view().heard > 0,
    w.view()
  );
  await w.start();
  ok(
    'a new session brings the list again',
    w.view().state === 'live' && w.view().items.length === 1
  );
  w.needs.forget('pc');
  await w.needs.idle();
  ok('forgetting the computer forgets what was known of it', w.view() === null);
}

// 5. Answering a permission prompt: yes or no, once, for the prompt that was shown.
{
  const w = pair();
  w.items = [
    item('q1', 'permission', 'p1', 'Allow npm install stripe?'),
    item('q2', 'question', 'p2', 'What should the banner say?'),
    item('q3', 'menu', 'p1', 'Which layout?'),
    item('q4', 'permission', 'p2', 'Allow deleting 3 files?'),
    item('q5', 'trust', 'p1', 'Trust this folder?'),
  ];
  await w.start();
  const r = w.say('q1', 'yes');
  await tick();
  await tick();
  ok('the answer leaves', (await r) === 'sent' && w.item('q1').answer === 'sent');
  ok(
    'a second answer to the same prompt is not sent',
    (await w.say('q1', 'no')) === 'again' && w.toPc.length === 1
  );
  ok(
    'what travels is the id, the binding and yes: nothing else',
    JSON.stringify(Object.keys(w.toPc[0]).sort()) === '["id","of","say","t"]' &&
      w.toPc[0].say === 'yes',
    w.toPc[0]
  );
  await w.flush();
  ok(
    'the computer delivers "yes" for that prompt, from that phone',
    JSON.stringify(w.delivered) ===
      JSON.stringify([
        { item: { id: 'q1', paneId: 'p1', kind: 'permission' }, say: 'yes', from: 'ph' },
      ]),
    w.delivered
  );
  ok("and the item is gone from the phone's list", !w.item('q1') && w.view().items.length === 4);
  ok(
    'a question, a menu and a trust prompt are answered at the computer: nothing is sent',
    (await w.say('q2', 'yes')) === 'kind' &&
      (await w.say('q3', 'yes')) === 'kind' &&
      (await w.say('q5', 'yes')) === 'kind' &&
      w.toPc.length === 0
  );
  ok(
    'anything but yes or no, an unknown item, an unknown computer: nothing is sent',
    (await w.say('q4', 'maybe')) === 'bad' &&
      (await w.say('q4', { text: 'x' })) === 'bad' &&
      (await w.say('nope', 'yes')) === 'gone' &&
      (await w.needs.answer('nobody', 'q4', 'x', 'yes')) === 'not_live' &&
      w.toPc.length === 0
  );
  ok(
    '"no" is delivered as no',
    (await w.say('q4', 'no')) === 'sent' && (await w.flush(), w.delivered[1].say === 'no')
  );
}

// 6. Review 9, 3: the app reuses an item id for the agent's next prompt. A yes for one prompt must not count for the next.
{
  const w = pair();
  w.items = [item('permission:p1', 'permission', 'p1', 'Read: README.md', 1700000000000)];
  await w.start();
  const shown = w.item('permission:p1');
  w.items = [item('permission:p1', 'permission', 'p1', 'Bash: rm -rf /', 1700000000000)]; // replaced in place: same id, same since
  ok(
    'a tap that arrives after the prompt changed is refused by the computer, and nothing is delivered',
    (await w.raw({ t: 'answer', id: shown.id, of: shown.of, say: 'yes' }))[1].why === 'refused' &&
      w.delivered.length === 0,
    w.delivered
  );
  w.api.changed();
  await w.flush();
  ok(
    'on the phone the new prompt is a new thing: the old binding answers nothing',
    w.item('permission:p1').of !== shown.of &&
      (await w.needs.answer('pc', shown.id, shown.of, 'yes')) === 'gone' &&
      w.toPc.length === 0
  );
  await w.say('permission:p1', 'no');
  await w.flush();
  ok(
    'the new prompt takes its own answer',
    w.delivered.length === 1 && w.delivered[0].say === 'no'
  );
  w.items = [item('permission:p1', 'permission', 'p1', 'Bash: npm test', 1700000000000)];
  w.api.changed();
  await w.flush();
  ok(
    'and a third prompt under the same id is open again, not shown as answered',
    w.item('permission:p1').answer === null &&
      (await w.say('permission:p1', 'yes')) === 'sent' &&
      (await w.flush(), w.delivered.length === 2)
  );
}

// 7. The computer's rules hold whatever the phone sends (a changed phone app with a real pairing).
{
  const w = pair();
  w.items = [
    item('q1', 'permission', 'p1', 'Allow?'),
    item('q2', 'question', 'p2', 'Say?'),
    item('q3', 'menu', 'p1', 'Which?'),
    item('q5', 'trust', 'p1', 'Trust this folder?'),
    item('q6', 'permission', 'p2', 'Allow (guessed)?', 1700000000000, true),
    item('q7', 'permission', 'p1', ''),
  ];
  await w.start();
  const why = async m => (await w.raw(m))[1].why;
  ok(
    'an answer for an item that is not open is refused',
    (await why({ t: 'answer', id: 'q9', of: 'AAAAAAAAAAAAAAAA', say: 'yes' })) === 'refused'
  );
  ok(
    'a question, a menu, a trust prompt, an inferred item and one without text are refused, with the right binding too',
    (
      await (async () => {
        const all = [];
        for (const id of ['q2', 'q3', 'q5', 'q6', 'q7'])
          all.push(await why({ t: 'answer', id, of: w.ofPc(id), say: 'yes' }));
        return all;
      })()
    ).every(x => x === 'refused')
  );
  ok(
    'a text, a wrong word, a missing or wrong binding are refused',
    (await why({ t: 'answer', id: 'q1', of: w.ofPc('q1'), text: '!rm -rf ~' })) === 'refused' &&
      (await why({ t: 'answer', id: 'q1', of: w.ofPc('q1'), say: 'YES' })) === 'refused' &&
      (await why({ t: 'answer', id: 'q1', say: 'yes' })) === 'refused' &&
      (await why({ t: 'answer', id: 'q1', of: w.ofPc('q2'), say: 'yes' })) === 'refused' &&
      (await why({ t: 'answer', id: 'q1', of: { toString: () => w.ofPc('q1') }, say: 'yes' })) ===
        'refused'
  );
  ok(
    'every refusal about an item reads the same: it does not say what is open or of which kind',
    true
  );
  ok('nothing was delivered by any of that', w.delivered.length === 0);
  ok(
    "anything that is not an answer is not this file's",
    w.answers.receive('ph', { t: 'needs' }).ignored &&
      w.answers.receive('ph', null).ignored &&
      w.toPhone.length === 0
  );
  const extra = await w.raw({
    t: 'answer',
    id: 'q1',
    of: w.ofPc('q1'),
    say: 'yes',
    paneId: 'p2',
    kind: 'question',
    text: 'also this',
    cmd: 'x',
  });
  ok(
    "extra fields are not carried: the item and its kind are the computer's own",
    extra[0].ok === true &&
      JSON.stringify(w.delivered[0]) ===
        JSON.stringify({
          item: { id: 'q1', paneId: 'p1', kind: 'permission' },
          say: 'yes',
          from: 'ph',
        }),
    w.delivered[0]
  );
}

// 8. At most once, whatever the delivery does, and a limit per phone.
for (const [how, deliver] of [
  ['says no', () => false],
  [
    'throws',
    () => {
      throw new Error('typed, then broke');
    },
  ],
  [
    'is slow and fails',
    async () => {
      await tick();
      return false;
    },
  ],
  [
    'is slow and works',
    async () => {
      await tick();
      return true;
    },
  ],
]) {
  let calls = 0;
  const w = pair({
    deliver: (ww, ...a) => {
      calls++;
      return deliver(...a);
    },
  });
  w.items = [item('q1', 'permission', 'p1', 'Allow?')];
  await w.start();
  const m = { t: 'answer', id: 'q1', of: w.ofPc('q1'), say: 'yes' },
    first = await w.raw(m);
  for (let i = 0; i < 12; i++) await w.raw(m);
  ok(
    'a delivery that ' + how + ': the agent is reached once, however often the phone repeats',
    calls === 1 && (how.endsWith('works') ? first[0].ok === true : first[1].why === 'failed'),
    [calls, first]
  );
}
{
  const w = pair({ deliver: () => true }); // the item stays open: the stand-in for an agent that has not moved on yet
  w.items = Array.from({ length: 700 }, (_, i) =>
    item('q' + i, 'permission', 'p1', 'Allow ' + i + '?')
  );
  await w.start();
  const first = { t: 'answer', id: 'q0', of: w.ofPc('q0'), say: 'yes' };
  ok('(setup) taken', (await w.raw(first))[0].ok === true);
  let taken = 0;
  for (let i = 1; i <= PER_MINUTE + 10; i++)
    if ((await w.raw({ t: 'answer', id: 'q' + i, of: w.ofPc('q' + i), say: 'yes' }))[0].ok) taken++;
  ok('more answers in a minute than the limit are refused', taken === PER_MINUTE - 1, taken);
  const [over, back] = await w.raw({ t: 'answer', id: 'q699', of: w.ofPc('q699'), say: 'yes' });
  ok(
    'past the limit nothing is sent back at all (review 10, 3)',
    over.refused === 'limit' && back === undefined,
    [over, back]
  );
  for (let k = 0; k < 30; k++) {
    await w.advance(61000);
    for (let i = 0; i < PER_MINUTE; i++)
      await w.raw({
        t: 'answer',
        id: 'q' + (40 + k * PER_MINUTE + i),
        of: w.ofPc('q' + (40 + k * PER_MINUTE + i)),
        say: 'yes',
      });
  }
  await w.advance(61000);
  ok(
    'a prompt that is still open is never answered twice, however many others came after (it used to be forgotten after 500)',
    (await w.raw(first))[1].why === 'refused'
  );
}

// 8b. Review 10, 4: a prompt that comes back under the same id and text (OpenCode asks again when its server did not take the reply)

// is not delivered a second time from one press; it can be answered again only once it was seen closed for a minute.
{
  let calls = 0;
  const w = pair({
    deliver: () => {
      calls++;
      return true;
    },
  });
  const one = item('q1', 'permission', 'p1', 'Bash: npm test'),
    other = { t: 'answer', id: 'zz', of: 'AAAAAAAAAAAAAAAA', say: 'yes' };
  w.items = [one];
  await w.start();
  const m = { t: 'answer', id: 'q1', of: w.ofPc('q1'), say: 'yes' };
  ok('(setup) taken once', (await w.raw(m))[0].ok === true && calls === 1);
  w.items = [];
  w.items = [one]; // closed and asked again before any other message arrived
  ok(
    'asked again at once: the same press is not delivered twice',
    (await w.raw(m))[1].why === 'refused' && calls === 1,
    calls
  );
  w.items = [];
  await w.raw(other);
  await w.advance(30000);
  w.items = [one];
  ok(
    'seen closed, back within a minute: still not delivered',
    (await w.raw(m))[1].why === 'refused' && calls === 1,
    calls
  );
  w.items = [];
  await w.advance(61000);
  await w.raw(other);
  w.items = [one];
  ok(
    'closed for more than a minute: it is a new prompt and takes one answer',
    (await w.raw(m))[0].ok === true &&
      calls === 2 &&
      (await w.raw(m))[1].why === 'refused' &&
      calls === 2,
    calls
  );
}

// 9. Rights are read at each answer: see AND answer, and the text must be sent to that phone.
{
  let may = { see: true, answer: true },
    detail = true;
  const w = pair({ rightsOf: () => may, detail: () => detail });
  w.items = [
    item('q1', 'permission', 'p1', 'Allow?'),
    item('q2', 'permission', 'p2', 'Allow more?'),
  ];
  await w.start();
  const m = id => ({ t: 'answer', id, of: w.ofPc(id), say: 'yes' });
  may = { see: true, answer: false };
  ok(
    'a phone without the answer right is told so, about its own rights only',
    (await w.raw(m('q1')))[1].why === 'not_allowed'
  );
  may = { see: false, answer: true };
  ok('answering needs seeing', (await w.raw(m('q1')))[1].why === 'not_allowed');
  may = null;
  ok(
    'a phone this computer does not know is refused',
    (await w.raw(m('q1')))[1].why === 'not_allowed'
  );
  may = { see: true, answer: true };
  detail = false;
  ok(
    'a phone that is not sent the question text cannot answer it',
    (await w.raw(m('q1')))[1].why === 'refused'
  );
  detail = true;
  ok(
    'nothing was delivered so far, and with both rights and the text it is',
    w.delivered.length === 0 && (await w.raw(m('q1')))[0].ok === true && w.delivered.length === 1
  );
  const thrower = pair({
    rightsOf: () => {
      throw new Error('x');
    },
  });
  thrower.items = [item('q1', 'permission', 'p1', 'Allow?')];
  ok(
    'rights that cannot be read mean no',
    thrower.answers.receive('ph', { t: 'answer', id: 'q1', of: thrower.ofPc('q1'), say: 'yes' })
      .refused === 'not_allowed'
  );
  // The phone without the text shows no buttons at all.
  const blind = pair({ detail: () => false });
  blind.items = [item('q1', 'permission', 'p1', 'Allow?')];
  await blind.start();
  ok(
    'without the text the phone has nothing to tap, and sends nothing',
    blind.item('q1').way === null &&
      blind.item('q1').detail === undefined &&
      (await blind.say('q1', 'yes')) === 'kind' &&
      blind.toPc.length === 0
  );
}

// 10. What the phone shows of an answer follows the computer's word, and only for an answer it sent.
{
  const w = pair({ rightsOf: () => ({ see: true, answer: false }) });
  w.items = [
    item('q1', 'permission', 'p1', 'Allow?'),
    item('q2', 'permission', 'p2', 'Allow more?'),
  ];
  await w.start();
  await w.say('q1', 'yes');
  await w.flush();
  ok(
    'a refused answer shows why, and the item stays open',
    w.item('q1').answer === 'refused:not_allowed' && w.view().items.length === 2,
    w.item('q1')
  );
  ok('a refused answer may be sent again', (await w.say('q1', 'yes')) === 'sent');
  w.toPc.length = 0;
  w.needs.onMessage('pc', { t: 'answered', id: 'q2', of: w.item('q2').of, ok: true });
  await w.needs.idle();
  ok(
    'an "answered" for a prompt the phone never answered changes nothing',
    w.item('q2').answer === null
  );
  w.needs.onMessage('pc', {
    t: 'answered',
    id: 'q1',
    of: w.item('q1').of,
    ok: false,
    why: 'x‮y'.repeat(30),
  });
  await w.needs.idle();
  ok(
    'the reason is one short cleaned line',
    w.item('q1').answer.startsWith('refused:') &&
      w.item('q1').answer.length <= 28 &&
      !/[‮]/.test(w.item('q1').answer),
    w.item('q1').answer
  );
  const w2 = pair();
  w2.items = [item('q1', 'permission', 'p1', 'Allow?')];
  await w2.start();
  w2.sendFails = true;
  ok(
    'an answer that could not leave says so, and the item is open to answer again',
    (await w2.say('q1', 'yes')) === 'not_sent' && w2.item('q1').answer === null
  );
  w2.sendFails = false;
  const silent = pair({ deliver: () => true });
  silent.items = [item('q1', 'permission', 'p1', 'Allow?')];
  await silent.start();
  await silent.say('q1', 'yes');
  silent.toPc.length = 0; // the answer left, and the computer never says a word about it
  await silent.advance(REPLY_MS - 1000);
  ok(
    'an answer the computer has not confirmed yet shows as sent',
    silent.item('q1').answer === 'sent'
  );
  await silent.advance(2000);
  ok(
    'and after a quarter of a minute it says so, and the buttons are not off for good',
    silent.item('q1').answer === 'refused:no_reply' && (await silent.say('q1', 'yes')) === 'sent'
  );
  const going = w2.say('q1', 'yes');
  await w2.end();
  await going;
  ok(
    'the session ending while an answer leaves keeps no answer state',
    w2.view().items.length === 0 && w2.view().state === 'offline'
  );
}

// 11. The cases that are this file's rules and not the wiring's: test 3 (wider

// grants), test 8 (two devices at once), test 13 (the agent renamed between the list and the answer).
{
  const w = pair({
    deliver: (ww, it, say, from) => {
      ww.delivered.push({ id: it.id, say, from });
      return true;
    },
  }); // the prompt stays open, as a slow agent's does
  w.items = [
    item('permission:r1', 'permission', 'p1', 'Bash: npm test'),
    item('permission:r2', 'permission', 'p2', 'Bash: git status'),
  ];
  await w.start();
  const m = (id, say) => ({ t: 'answer', id, of: w.ofPc(id), say });
  const words = [];
  for (const say of [
    'session',
    'always',
    'once',
    'Yes',
    'YES',
    ['yes'],
    { toString: () => 'yes' },
    true,
    1,
    '',
    undefined,
  ])
    words.push((await w.raw(m('permission:r1', say)))[1]?.why);
  ok(
    '"session", "always", "once", "Yes", an array, an object, true: refused, nothing delivered, and the prompt is not used up',
    words.every(x => x === 'refused') &&
      w.delivered.length === 0 &&
      (await w.raw(m('permission:r1', 'yes')))[0].ok === true &&
      w.delivered.length === 1,
    words
  );
  const one = w.answers.receive('pc-a', m('permission:r2', 'yes')),
    two = w.answers.receive('pc-b', m('permission:r2', 'no')),
    three = w.answers.receive('pc-a', m('permission:r2', 'yes'));
  ok(
    'two devices answer one prompt in the same moment: the first is taken, the others refused, one delivery',
    one.ok === true &&
      two.refused === 'refused' &&
      three.refused === 'refused' &&
      w.delivered.filter(d => d.id === 'permission:r2').length === 1 &&
      w.delivered.find(d => d.id === 'permission:r2').from === 'pc-a',
    [one, two, three]
  );
  const w2 = pair();
  w2.items = [item('permission:r3', 'permission', 'p1', 'Bash: npm ci')];
  await w2.start();
  const shown = { t: 'answer', id: 'permission:r3', of: w2.ofPc('permission:r3'), say: 'yes' };
  w2.names.p1 = 'Someone else';
  ok(
    'the agent was renamed after the list was sent: the answer for the old name is refused, nothing delivered',
    (await w2.raw(shown))[1].why === 'refused' && w2.delivered.length === 0
  );
  w2.names.p1 = 'Moss';
  ok(
    'and with the name it was shown under it is taken',
    (await w2.raw(shown))[0].ok === true && w2.delivered.length === 1
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
