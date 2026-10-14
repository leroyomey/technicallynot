// Test of desktop/remote-trust.js: node tools/remote-trust-test.js (plain Node; also run it in
// Electron's Node). Three or four computers of one account with a stand-in for their encrypted
// sessions: Forget everywhere, Stop remote everywhere, and Keep or Forget on the computer that is
// asked.
const crypto = require('crypto');
const keys = require('../desktop/remote-keys.js');
const { createTrust } = require('../desktop/remote-trust.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// A set of computers, all paired with each other and online unless listed as offline.
function world(ids, offline) {
  const w = {
    comps: {},
    online: new Set(ids.filter(i => !(offline || []).includes(i))),
    queue: [],
    lose: null,
  };
  const session = (x, y) =>
    w.online.has(x) &&
    w.online.has(y) &&
    !!w.comps[x].store.pairing(y) &&
    !!w.comps[y].store.pairing(x);
  w.session = session;
  w.run = () => {
    for (let i = 0; i < 500 && w.queue.length; i++) w.queue.shift()();
  };
  const backend = disk => ({
    available: () => true,
    encrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
    decrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
    read: () => disk.text,
    write: s => {
      disk.text = s;
    },
  });
  for (const id of ids) {
    const disk = { text: null };
    const c = (w.comps[id] = {
      id,
      got: [],
      sent: [],
      forgot: [],
      restarts: [],
      gates: [],
      outcomes: [],
      stopped: 0,
      disk,
    });
    c.store = keys.keyStore(backend(disk));
    c.link = {
      send(to, obj) {
        if (!session(id, to)) return false;
        const copy = JSON.parse(JSON.stringify(obj));
        c.sent.push({ to, obj: copy });
        if (!(w.lose && w.lose(id, to, copy))) w.queue.push(() => w.comps[to].receive(id, copy));
        return true;
      },
      forget(pid) {
        c.forgot.push(pid);
        return c.store.remove(pid);
      },
      restart(pid) {
        c.restarts.push(pid);
      },
    };

    // boot(true) = the app was restarted: a new store object read from disk, a new trust object.
    c.boot = restart => {
      if (restart) c.store = keys.keyStore(backend(disk));
      c.trust = createTrust({
        self: { id },
        store: c.store,
        link: c.link,
        on: {
          gate: (p, open) => c.gates.push(p + ':' + open),
          outcome: o => c.outcomes.push(o),
          stopped: () => {
            c.stopped++;
          },
        },
      });
    };
    c.receive = (from, obj) => {
      if (!c.trust.onMessage(from, obj)) c.got.push({ from, obj });
    };
    c.store.identity();
  }
  for (const x of ids)
    for (const y of ids)
      if (x !== y)
        w.comps[x].store.add({
          id: y,
          pub: crypto.randomBytes(32),
          pairingId: crypto.randomBytes(16),
          name: y,
        });
  for (const id of ids) w.comps[id].boot(false);
  w.connect = id => {
    w.online.add(id);
    for (const o of ids)
      if (o !== id && session(id, o)) {
        w.comps[id].trust.sessionStarted(o);
        w.comps[o].trust.sessionStarted(id);
      }
    w.run();
  };
  return w;
}
const list = { t: 'needs', g: 1, i: 0, n: 1, items: [] };

// ---- Forget everywhere, answered with Forget ----
{
  const w = world(['a', 'b', 'c']),
    { a, b, c } = w.comps;
  check(
    'before: lists pass through both ways',
    a.trust.send('c', list) === true && (w.run(), c.got.length === 1) && a.trust.open('b')
  );
  check(
    'forget returns true and deletes the key here at once',
    a.trust.forget('b') === true && !a.store.pairing('b') && a.forgot.includes('b')
  );
  check(
    'the other computer is listed as not confirmed until its answer arrives',
    a.trust.status().waiting.length === 1 &&
      a.trust.status().waiting[0].to === 'c' &&
      a.trust.status().waiting[0].about === 'b' &&
      a.trust.status().waiting[0].status === 'sent'
  );
  w.run();
  check(
    'the asked computer does not obey at once: the key is kept, the pairing paused',
    !!c.store.pairing('b') && c.trust.open('b') === false && c.gates.includes('b:false')
  );
  check(
    '…and it shows who asked about whom',
    JSON.stringify(c.trust.status().asks.map(x => [x.peer, x.by])) ===
      JSON.stringify([['b', [{ id: 'a', kind: 'forget' }]]])
  );
  check(
    'nothing is sent or received over a paused pairing',
    c.trust.send('b', list) === false &&
      c.trust.onMessage('b', list) === true &&
      b.trust.send('c', list) === true &&
      (w.run(), c.got.every(g => g.from !== 'b'))
  );
  check(
    'built-in property names are no device ids',
    (c.receive('a', { t: 'forget', about: '__proto__', r: 'p1' }),
    c.receive('a', { t: 'forget', about: 'constructor', r: 'p2' }),
    w.run(),
    c.trust.status().asks.length === 1) && c.trust.choose('__proto__', 'forget') === false
  );
  check(
    'the asker sees "paused there, not yet forgotten"',
    a.trust.status().waiting[0].status === 'paused'
  );
  check(
    'Forget: the key is deleted there',
    c.trust.choose('b', 'forget') === true &&
      !c.store.pairing('b') &&
      c.trust.status().asks.length === 0
  );
  w.run();
  check(
    '…the asker is told and its list clears',
    a.trust.status().waiting.length === 0 &&
      JSON.stringify(a.outcomes) === JSON.stringify([{ to: 'c', about: 'b', choice: 'forget' }])
  );
  check(
    'nothing is still owed on either side after the confirmations',
    JSON.stringify(a.store.note('trust').outbox) === '[]' &&
      JSON.stringify(c.store.note('trust').outbox) === '[]'
  );
  check(
    'the forgotten computer was told nothing',
    !a.sent.some(m => m.to === 'b' && m.obj.t !== 'needs') && !c.sent.some(m => m.to === 'b')
  );
  check(
    'choose on a pairing that is not paused does nothing',
    c.trust.choose('a', 'forget') === false && !!c.store.pairing('a')
  );
}

// ---- answered with Keep ----
{
  const w = world(['a', 'b', 'c']),
    { a, c } = w.comps;
  a.trust.forget('b');
  w.run();
  check(
    'Keep: the pairing resumes with a new session',
    c.trust.choose('b', 'keep') === true &&
      !!c.store.pairing('b') &&
      c.trust.open('b') &&
      c.restarts.includes('b') &&
      c.gates.at(-1) === 'b:true'
  );
  w.run();
  check(
    '…and the asker learns it was kept',
    a.trust.status().waiting.length === 0 && a.outcomes[0].choice === 'keep'
  );
}

// ---- a computer that is offline, a restart in between, lost messages ----
{
  const w = world(['a', 'b', 'c', 'd'], ['c']),
    { a, c, d } = w.comps;
  a.trust.forget('b');
  w.run();
  const st = a.trust.status().waiting;
  check(
    'an offline computer stays listed as not confirmed; an online one is paused',
    st.find(x => x.to === 'c').status === 'sent' &&
      st.find(x => x.to === 'd').status === 'paused' &&
      !!c.store.pairing('b')
  );
  a.boot(true);
  check('the list survives a restart of the app', a.trust.status().waiting.length === 2);
  check('…and is not readable in the file', !/forget|pending|outbox/.test(a.disk.text));
  w.connect('c');
  check(
    'when it comes online it is asked, pauses and confirms',
    c.trust.open('b') === false &&
      a.trust.status().waiting.find(x => x.to === 'c').status === 'paused'
  );

  // d's answer is lost on the way: it stays owed and goes again at the next session.
  w.lose = (from, to, m) => from === 'd' && m.t === 'chose';
  d.trust.choose('b', 'forget');
  w.run();
  check(
    'a lost answer leaves the asker waiting',
    a.trust.status().waiting.some(x => x.to === 'd')
  );
  w.lose = null;
  d.boot(true);
  w.connect('d');
  check(
    '…and is sent again after a restart and a new session',
    !a.trust.status().waiting.some(x => x.to === 'd') && d.store.note('trust').outbox.length === 0
  );

  // the same ask delivered twice (the confirmation was lost): one entry, confirmed again
  const ask = a.sent.find(m => m.to === 'c' && m.obj.t === 'forget').obj,
    acks = c.sent.filter(m => m.obj.t === 'ack').length;
  c.receive('a', ask);
  c.receive('a', ask);
  w.run();
  check(
    'a repeated ask adds nothing and is confirmed again',
    c.trust.status().asks[0].by.length === 1 &&
      c.sent.filter(m => m.obj.t === 'ack').length === acks + 2
  );
  check(
    'dismiss stops waiting for one computer',
    a.trust.dismiss(a.trust.status().waiting[0].r) === true && a.trust.status().waiting.length === 0
  );
}

// ---- asked about a computer it is not paired with; malformed asks ----
{
  const w = world(['a', 'b', 'c']),
    { a, c } = w.comps;
  c.store.remove('b');
  a.trust.forget('b');
  w.run();
  check(
    'a computer with no such pairing confirms "none" and the list clears',
    a.trust.status().waiting.length === 0 && c.trust.status().asks.length === 0
  );
  for (const bad of [
    { t: 'forget', about: 'a' },
    { t: 'forget', about: 'a', r: 'x'.repeat(65) },
    { t: 'forget', about: { id: 'a' }, r: 'r1' },
    { t: 'forget', about: 'c', r: 'r2' },
    { t: 'stop' },
    { t: 'chose', r: 'nope', choice: 'forget' },
    { t: 'ack', r: 'nope' },
    null,
    'stop',
  ])
    c.receive('a', bad);
  w.run();
  check(
    'malformed or pointless asks pause nothing and are not passed on as content',
    c.trust.status().asks.length === 0 && c.got.length === 0 && c.trust.open('a')
  );
  check('other content is passed on untouched', (c.receive('a', list), c.got.length === 1));
}

// ---- one stolen computer cannot wipe the set ----
{
  const w = world(['a', 'b', 'c']),
    { a, b, c } = w.comps;
  b.trust.forget('a');
  w.run(); // the thief, on b, asks c to forget a
  check(
    'a stolen computer asking to forget another only pauses it: the key stays until the user chooses',
    !!c.store.pairing('a') &&
      c.trust.open('a') === false &&
      c.trust.status().asks[0].by[0].id === 'b'
  );
  c.trust.choose('a', 'keep');
  w.run();
  check('Keep puts it back', c.trust.open('a') && a.trust.open('c') && !!a.store.pairing('c'));
}

// ---- the stolen computer asks first (security review, 2026-10-04) ----
{
  const w = world(['a', 's', 'b']),
    { a, s, b } = w.comps;
  s.trust.forget('a');
  w.run(); // the thief has b pause a
  check('a stolen computer got the honest one paused first', b.trust.open('a') === false);
  a.trust.forget('s');
  w.run(); // the user, on a, forgets the stolen computer everywhere
  check(
    "the honest computer's Forget is still read: the stolen one is paused too and the ask confirmed",
    b.trust.open('s') === false &&
      a.trust.status().waiting.find(x => x.to === 'b').status === 'paused'
  );
  check(
    'the user sees both lines and can keep the honest one and forget the stolen one',
    b.trust.status().asks.length === 2 &&
      b.trust.choose('a', 'keep') &&
      b.trust.choose('s', 'forget') &&
      !!b.store.pairing('a') &&
      !b.store.pairing('s')
  );
  w.run();
  check(
    '…and the honest computer is told',
    a.outcomes.some(o => o.to === 'b' && o.about === 's' && o.choice === 'forget')
  );
}
{
  const w = world(['a', 's', 'b']),
    { a, s, b } = w.comps;
  s.trust.forget('a');
  w.run();
  b.trust.choose('a', 'keep');
  w.run();
  const again = () => {
    const r = 'again-' + s.sent.length;
    s.link.send('b', { t: 'forget', about: 'a', r });
    w.run();
  };
  again();
  again();
  again();
  check(
    'after Keep, the same computer asking again does not pause it again',
    b.trust.open('a') === true && b.trust.status().asks.length === 0
  );
  check(
    '…and the page can show that it keeps asking',
    b.trust.status().kept.length === 1 &&
      b.trust.status().kept[0].by === 's' &&
      b.trust.status().kept[0].again === 3
  );
  check(
    'another computer asking about the same pairing is still read',
    (b.receive('a', { t: 'forget', about: 's', r: 'other' }), w.run(), b.trust.open('s') === false)
  );
  void a;
}

// ---- Stop while a Forget is not confirmed yet ----
{
  const w = world(['a', 's', 'c'], ['c']),
    { a, c } = w.comps;
  a.trust.forget('s');
  w.run();
  a.trust.stopEverywhere();
  w.run();
  check(
    'stopping keeps an unconfirmed Forget listed and owed',
    a.trust.status().waiting.some(x => x.kind === 'forget' && x.about === 's' && x.to === 'c') &&
      a.trust.status().waiting.some(x => x.kind === 'stop' && x.to === 'c')
  );
  w.connect('c');
  check(
    'when that computer comes online it is asked to forget the stolen one before the stop',
    c.trust.open('s') === false &&
      c.trust.open('a') === false &&
      c.trust.status().asks.length === 2 &&
      a.stopped === 1
  );
}

// ---- Stop remote everywhere ----
{
  const w = world(['a', 'b', 'c'], ['c']),
    { a, b, c } = w.comps,
    oldPub = a.store.identity().pub;
  check(
    'stop starts: nothing but the stop is sent or read from now on',
    a.trust.stopEverywhere() === true &&
      a.trust.status().stopping &&
      a.trust.send('b', list) === false &&
      a.trust.open('b') === false
  );
  check(
    'forget is refused while stopping, stop cannot start twice',
    a.trust.forget('b') === false && a.trust.stopEverywhere() === false
  );
  w.run();
  check(
    'the online computer pauses its pairing with this one and confirms; its key is not deleted there by itself',
    b.trust.open('a') === false &&
      !!b.store.pairing('a') &&
      b.trust.status().asks[0].by[0].kind === 'stop'
  );
  check(
    'on confirmation this computer deletes that pairing; the offline one stays listed',
    !a.store.pairing('b') &&
      !!a.store.pairing('c') &&
      a.trust.status().waiting.length === 1 &&
      a.trust.status().waiting[0].to === 'c'
  );
  check(
    'it never says "stopped everywhere" while one is left, and keeps its old key to reach it',
    a.stopped === 0 && a.trust.status().stopping && a.store.identity().pub.equals(oldPub)
  );
  a.receive('c', list);
  check('content arriving meanwhile is dropped', a.got.length === 0);
  a.boot(true);
  check(
    'stopping survives a restart of the app',
    a.trust.status().stopping && a.trust.status().waiting.length === 1
  );
  w.connect('c');
  check(
    'when the last computer confirms: no pairing left, a new long-term key, "stopped"',
    a.store.pairings().length === 0 &&
      a.stopped === 1 &&
      !a.trust.status().stopping &&
      !a.store.identity().pub.equals(oldPub) &&
      a.trust.status().waiting.length === 0
  );
  check(
    'the other computers hold a paused pairing and choose themselves',
    c.trust.open('a') === false &&
      c.trust.choose('a', 'forget') &&
      !c.store.pairing('a') &&
      c.store.note('trust').outbox.length === 0
  );
  check(
    'after it, remote can be used again from scratch',
    a.trust.open('b') === true && a.trust.send('b', list) === false
  );
}
{
  const w = world(['a', 'b', 'c'], ['b', 'c']),
    { a } = w.comps,
    oldPub = a.store.identity().pub;
  a.trust.stopEverywhere();
  w.run();
  check(
    'nobody reachable: both stay listed, nothing is deleted yet',
    a.trust.status().waiting.length === 2 && a.store.pairings().length === 2 && a.stopped === 0
  );
  check(
    '"finish anyway": pairings deleted, new key, done',
    a.trust.finishAnyway() === true &&
      a.store.pairings().length === 0 &&
      !a.store.identity().pub.equals(oldPub) &&
      a.stopped === 1 &&
      !a.trust.status().stopping
  );
  check('finish anyway does nothing when not stopping', a.trust.finishAnyway() === false);
}
{
  const w = world(['a']),
    { a } = w.comps,
    oldPub = a.store.identity().pub;
  check(
    'stop with nothing paired is done at once, with a new key',
    a.trust.stopEverywhere() === true &&
      a.stopped === 1 &&
      !a.trust.status().stopping &&
      !a.store.identity().pub.equals(oldPub)
  );
}

// ---- a flood of the same ask: one line, one gate, a bounded number of
// writes ----
{
  const w = world(['a', 's', 'b']),
    { s, b } = w.comps;
  let writes = 0;
  const orig = b.store.setNote;
  b.store.setNote = (k, v) => {
    writes++;
    return orig.call(b.store, k, v);
  };
  const ask = (n, tag) => {
    for (let i = 0; i < n; i++)
      s.link.send('b', { t: 'forget', about: 'a', r: 'flood-' + tag + '-' + i });
    w.run();
  };
  ask(5, 'x');
  const after5 = writes;
  ask(60, 'y');
  const by = b.trust.status().asks.find(x => x.peer === 'a')?.by;
  check(
    '60 forget asks from one computer leave one entry in the list',
    !!by && by.length === 1 && by[0].id === 's' && b.trust.status().asks.length === 1,
    by
  );
  check('…the gate fires once', b.gates.filter(g => g === 'a:false').length === 1, b.gates);
  check(
    '…and the store is written a small bounded number of times, not once per ask',
    writes <= 4 && writes === after5,
    [after5, writes]
  );
}

// ---- Keep on a stop ask is remembered ----
{
  const w = world(['a', 's']),
    { s, a } = w.comps;
  s.link.send('a', { t: 'stop', r: 'stop-1' });
  w.run();
  check(
    'a stop ask pauses the pairing',
    a.trust.open('s') === false && a.trust.status().asks[0].by[0].kind === 'stop'
  );
  a.trust.choose('s', 'keep');
  w.run();
  const before = a.sent.filter(m => m.obj.t === 'ack' && m.obj.did === 'kept').length;
  s.link.send('a', { t: 'stop', r: 'stop-2' });
  s.link.send('a', { t: 'stop', r: 'stop-3' });
  w.run();
  const kept = a.sent.filter(m => m.obj.t === 'ack' && m.obj.did === 'kept');
  check(
    'after Keep, a new stop from that computer is answered "kept" and does not pause again',
    kept.length === before + 2 &&
      kept.at(-1).obj.r === 'stop-3' &&
      a.trust.open('s') === true &&
      a.trust.status().asks.length === 0
  );
  check(
    '…and the page counts it under "again"',
    a.trust.status().kept.length === 1 &&
      a.trust.status().kept[0].by === 's' &&
      a.trust.status().kept[0].again === 2,
    a.trust.status().kept
  );
}

// ---- owed Forget asks and answers wait while a pairing is paused here (review fix, 2026-10-05)
// ----
{
  const setup = () => {
    const w = world(['a', 'b', 'c', 'd']);
    w.comps.a.trust.forget('b');
    w.comps.d.trust.forget('a');
    w.run();
    return w;
  };
  const toward = (c, to, t) => c.sent.filter(m => m.to === to && m.obj.t === t);
  {
    const w = setup(),
      { a, b, c } = w.comps;
    check(
      'setup: this computer holds two paused pairings',
      c.trust.open('b') === false && c.trust.open('a') === false
    );
    c.trust.forget('d');
    w.run();
    check(
      'a Forget ask owed to a paused pairing is not sent',
      toward(c, 'a', 'forget').length === 0 &&
        toward(c, 'b', 'forget').length === 0 &&
        c.store.note('trust').outbox.filter(o => o.msg.t === 'forget').length === 2
    );
    c.trust.choose('b', 'keep');
    w.run();
    check(
      'a Keep or Forget answer owed to a paused pairing is not sent',
      toward(c, 'a', 'chose').length === 0 &&
        c.store.note('trust').outbox.some(o => o.to === 'a' && o.msg.t === 'chose')
    );
    check(
      'after Keep the held ask goes at the next session',
      (w.connect('b'),
      toward(c, 'b', 'forget').length === 1 && toward(c, 'b', 'forget')[0].obj.about === 'd')
    );
    check(
      'a stop and an ack still go to a paused pairing',
      (b.receive('a', { t: 'x' }),
      a.receive('b', { t: 'x' }),
      c.receive('a', { t: 'forget', about: 'zz', r: 'q1' }),
      w.run(),
      toward(c, 'a', 'ack').some(m => m.obj.r === 'q1'))
    );
    c.trust.choose('a', 'keep');
    w.connect('a');
    check(
      'after Keep for that pairing the held answer and ask are sent',
      toward(c, 'a', 'chose').length === 1 && toward(c, 'a', 'forget').length === 1
    );
  }
  {
    const w = setup(),
      { c } = w.comps;
    c.trust.forget('d');
    c.trust.choose('b', 'keep');
    w.run();
    c.trust.choose('a', 'forget');
    w.run();
    check(
      'Forget drops what was held for that pairing and sends nothing to it',
      toward(c, 'a', 'forget').length === 0 &&
        toward(c, 'a', 'chose').length === 0 &&
        !c.store.note('trust').outbox.some(o => o.to === 'a') &&
        !c.store.pairing('a')
    );
  }
  {
    const w = world(['a', 'b', 'c']),
      { c } = w.comps;
    w.comps.a.trust.forget('b');
    w.run();
    c.trust.stopEverywhere();
    check(
      'a stop still goes to a paused pairing',
      toward(c, 'b', 'stop').length === 1 && toward(c, 'a', 'stop').length === 1
    );
  }
}

// ---- the outbox has its own retry timer (app-2 #2): a Forget that could not be
// sent does not wait for the next session ----
{
  const { RETRY_MS } = require('../desktop/remote-trust.js');
  const disk = { text: null },
    flip = b => Buffer.from(b.map(x => x ^ 0x5a));
  const store = keys.keyStore({
    available: () => true,
    encrypt: flip,
    decrypt: flip,
    read: () => disk.text,
    write: s => {
      disk.text = s;
    },
  });
  store.identity();
  const pairWith = id =>
    store.add({ id, pub: crypto.randomBytes(32), pairingId: crypto.randomBytes(16) });
  pairWith('pc-b');
  pairWith('pc-c');
  const set = [],
    sent = [];
  let muted = true,
    live = new Set(['pc-b']);
  const timers = {
    set: (fn, ms) => {
      const h = { fn, ms };
      set.push(h);
      return h;
    },
    clear: h => {
      const i = set.indexOf(h);
      if (i >= 0) set.splice(i, 1);
    },
  };
  const fire = () => {
    const h = set.shift();
    if (h) h.fn();
  };
  const trust = createTrust({
    self: { id: 'pc-a' },
    store,
    timers,
    live: id => live.has(id),
    link: {
      send: (to, obj) => {
        if (muted || !live.has(to)) return false;
        sent.push({ to, obj });
        return true;
      },
      forget: id => store.remove(id),
      restart() {},
    },
  });
  check('retry: nothing owed, no timer', set.length === 0);

  // asks pc-b to forget pc-c while the link is muted (rate_limited): the ask does not leave
  trust.forget('pc-c');
  check(
    'retry: a Forget that could not be sent leaves one timer',
    sent.length === 0 && set.length === 1 && set[0].ms === RETRY_MS,
    [sent.length, set.length]
  );
  fire();
  check(
    'retry: still muted: still owed, the timer is set again',
    sent.length === 0 && set.length === 1,
    [sent.length, set.length]
  );
  muted = false;
  fire();
  check(
    'retry: the timer sends the ask without a new session',
    sent.length === 1 &&
      sent[0].to === 'pc-b' &&
      sent[0].obj.t === 'forget' &&
      sent[0].obj.about === 'pc-c',
    sent
  );
  check('retry: not confirmed yet, so it stays armed', set.length === 1);
  trust.onMessage('pc-b', { t: 'ack', r: sent[0].obj.r, did: 'none' });
  fire();
  check(
    'retry: confirmed: nothing more is sent and no timer stays',
    sent.length === 1 && set.length === 0,
    [sent.length, set.length]
  );
  pairWith('pc-d');
  live = new Set();
  trust.forget('pc-d'); // pc-b has no session now
  check(
    'retry: owed to a computer without a session: no timer runs for it',
    set.length === 0 && sent.length === 1,
    [sent.length, set.length]
  );
  live.add('pc-b');
  trust.sessionStarted('pc-b');
  check(
    'retry: its next session sends it and arms the timer',
    sent.length === 2 && set.length === 1,
    [sent.length, set.length]
  );
  trust.stop();
  check('retry: stop leaves no timer', set.length === 0);
}

// ---- two computers that both press Stop everywhere (security
// It had no check) ----
for (const order of [
  ['a', 'b'],
  ['b', 'a'],
]) {
  const w = world(['a', 'b']),
    { a, b } = w.comps,
    keyA = a.store.identity().pub,
    keyB = b.store.identity().pub;
  for (const id of order) w.comps[id].trust.stopEverywhere();
  w.run();
  check(
    'both stopping (' +
      order.join(' then ') +
      "): each confirms the other's stop and takes that as the confirmation of its own; both end with no pairing and a new key, without Finish anyway",
    a.stopped === 1 &&
      b.stopped === 1 &&
      !a.trust.status().stopping &&
      !b.trust.status().stopping &&
      a.store.pairings().length === 0 &&
      b.store.pairings().length === 0 &&
      !a.store.identity().pub.equals(keyA) &&
      !b.store.identity().pub.equals(keyB) &&
      a.trust.status().waiting.length === 0 &&
      b.trust.status().waiting.length === 0,
    [a.stopped, b.stopped, a.trust.status().waiting.length, b.trust.status().waiting.length]
  );
  check('…and nothing was read as content on the way', a.got.length === 0 && b.got.length === 0);
}
{
  // the confirmation could not leave (no session at that moment): the other computer's stop is not
  // taken as a confirmation
  const w = world(['a', 'b']),
    { a, b } = w.comps;
  b.trust.stopEverywhere();
  a.trust.stopEverywhere();
  w.online.delete('b');
  w.run();
  check(
    'both stopping, the link gone when the stops arrive: no confirmation left, so nothing is counted as one; both still wait and keep the pairing',
    a.stopped === 0 &&
      b.stopped === 0 &&
      a.trust.status().stopping &&
      b.trust.status().stopping &&
      !!a.store.pairing('b') &&
      !!b.store.pairing('a') &&
      !a.sent.some(m => m.obj.t === 'ack') &&
      !b.sent.some(m => m.obj.t === 'ack'),
    [a.stopped, b.stopped, a.sent.map(m => m.obj.t), b.sent.map(m => m.obj.t)]
  );
  w.connect('b');
  check(
    '…and when they have a session again both stops are sent again and both end',
    a.stopped === 1 &&
      b.stopped === 1 &&
      a.store.pairings().length === 0 &&
      b.store.pairings().length === 0,
    [a.stopped, b.stopped]
  );
}
{
  // a third computer: the two that stop end their pairing with each other only; the third is asked
  // like any other and chooses itself
  const w = world(['a', 'b', 'c'], ['c']),
    { a, b, c } = w.comps;
  a.trust.stopEverywhere();
  b.trust.stopEverywhere();
  w.run();
  check(
    'both stopping with a third computer offline: each has ended with the other only and still waits for the third, whose pairing it keeps',
    a.stopped === 0 &&
      b.stopped === 0 &&
      !a.store.pairing('b') &&
      !b.store.pairing('a') &&
      !!a.store.pairing('c') &&
      !!b.store.pairing('c') &&
      a.trust.status().waiting.length === 1 &&
      a.trust.status().waiting[0].to === 'c' &&
      b.trust.status().waiting[0].to === 'c',
    [a.trust.status().waiting, b.trust.status().waiting]
  );
  w.connect('c');
  check(
    '…the third pauses both pairings and confirms; both then end, and the third still holds both keys until its user chooses',
    a.stopped === 1 &&
      b.stopped === 1 &&
      c.trust.open('a') === false &&
      c.trust.open('b') === false &&
      !!c.store.pairing('a') &&
      !!c.store.pairing('b') &&
      !c.trust.status().stopping &&
      c.stopped === 0,
    [a.stopped, b.stopped, c.trust.status().asks.map(x => x.peer)]
  );
}
{
  // a stop from a third computer never ends the pairing with the computer this one is waiting for
  const w = world(['a', 'b', 'c'], ['b']),
    { a, c } = w.comps;
  a.trust.stopEverywhere();
  c.trust.stopEverywhere();
  w.run();
  check(
    'both stopping, a third one unreachable: the stop of one ends only the pairing with its sender; each still owes the third its stop',
    !a.store.pairing('c') &&
      !c.store.pairing('a') &&
      !!a.store.pairing('b') &&
      !!c.store.pairing('b') &&
      a.trust.status().stopping &&
      c.trust.status().stopping &&
      a.trust.status().waiting.every(x => x.to === 'b') &&
      c.trust.status().waiting.every(x => x.to === 'b')
  );
}
{
  // one side runs an older app, which reads nothing but confirmations while it stops
  const w = world(['a', 'b']),
    { a, b } = w.comps,
    real = b.receive;
  b.receive = (from, obj) => {
    if (obj && obj.t === 'stop' && b.trust.status().stopping) return;
    real(from, obj);
  }; // as the older code did: a stop is dropped while stopping
  a.trust.stopEverywhere();
  b.trust.stopEverywhere();
  w.run();
  check(
    "both stopping, one on older code that drops the other's stop: this computer's confirmation still ends it there, and its stop ends it here",
    a.stopped === 1 &&
      b.stopped === 1 &&
      a.store.pairings().length === 0 &&
      b.store.pairings().length === 0,
    [a.stopped, b.stopped]
  );
}
{
  // what a stopping computer still does not read
  const w = world(['a', 'b', 'c']),
    { a, b } = w.comps;
  a.trust.stopEverywhere();
  a.receive('b', { t: 'stop' });
  a.receive('b', { t: 'stop', r: '__proto__' });
  a.receive('b', { t: 'forget', about: 'c', r: 'abcdef0123456789' });
  a.receive('b', list);
  check(
    'while stopping: a stop without a number, with a built-in name for one, a Forget ask and content are all dropped; no pairing ends, nothing is confirmed',
    a.got.length === 0 &&
      !!a.store.pairing('b') &&
      !!a.store.pairing('c') &&
      !a.sent.some(m => m.obj.t === 'ack') &&
      a.trust.status().asks.length === 0,
    a.sent.map(m => m.obj.t)
  );
}

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);
