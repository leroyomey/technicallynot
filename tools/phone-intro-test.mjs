// Checks introducing a phone to another computer: the computers' side (desktop/phone-intro.js) with
// the phone's side (phone/src/intro.mjs) and the phone's key store: node tools/phone-intro-test.mjs
// Plain Node, nothing is sent anywhere. Not proven here: the callers' rules (the switch and
// Introduce only at the keyboard, a fresh list to the phone when its introducer's rights change),
// which belong to code that does not exist yet.
import { createRequire } from 'node:module';
import { keyStore } from '../phone/src/keys.mjs';
import { acceptIntroduced, forgetWithIntroduced } from '../phone/src/intro.mjs';
import * as PN from '../phone/src/noise.mjs';
const require = createRequire(import.meta.url);
const DN = require('../desktop/remote-noise.js'),
  { makeIntroduction, introductions, REMOVED_MAX } = require('../desktop/phone-intro.js');

let passed = 0,
  failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
  }
};
const throws = async fn => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};
const hex = b => Buffer.from(b).toString('hex'),
  wire = m => JSON.parse(JSON.stringify(m));
const memory = () => {
  const m = new Map();
  return {
    get: async k => m.get(k),
    update: async (k, fn) => {
      const [v, r] = fn(m.get(k));
      if (v !== undefined) m.set(k, v);
      return r;
    },
  };
};
const FULL = { see: true, answer: true, prompt: true, control: true, text: true };

// Computer B ("Studio PC") with its notes, its own paired devices and what each may do here.
function computerB() {
  const notes = new Map(),
    devices = new Map(),
    rights = new Map();
  const self = { id: 'pc-b', pub: DN.generateKeyPair().pub };
  const deps = {
    self,
    note: n => (notes.has(n) ? JSON.parse(notes.get(n)) : undefined),
    setNote: (n, v) => notes.set(n, JSON.stringify(v)),
    paired: id => devices.get(id) || null,
    pairedKey: pub => [...devices.values()].find(d => d.pub.equals(pub)) || null,
    rightsOf: id => rights.get(id) || null,
    now: () => 77,
  };
  const pair = (id, kind = 'computer') => {
    const e = { id, pub: DN.generateKeyPair().pub, name: id, kind, how: 'scan' };
    devices.set(id, e);
    rights.set(id, { ...FULL });
    return e;
  };
  return { self, deps, devices, rights, pair, intro: introductions(deps) };
}
const phoneOf = async id => {
  const k = await PN.generateKeyPair();
  return { id, pub: Buffer.from(k.pub), name: 'Pixel 8', kind: 'phone', how: 'scan' };
};

// 1. Switch off (the default): nothing happens, nothing is shown.
{
  const b = computerB(),
    a = b.pair('pc-a'),
    phone = await phoneOf('ph-1');
  const m = makeIntroduction({
    phone,
    to: { id: 'pc-b', pub: b.self.pub, name: 'Studio PC', kind: 'computer' },
  });
  ok(
    'off by default: an introduction is ignored and nothing is stored',
    b.intro.allowed('pc-a') === false &&
      b.intro.receive(wire(m.toComputer), 'pc-a').ignored === true &&
      b.intro.phones().length === 0
  );
  ok(
    'the switch can only be set for a paired computer',
    (await throws(async () => b.intro.setAllowed('pc-x', true))) &&
      (await throws(async () => b.intro.setAllowed('__proto__', true)))
  );
  ok(
    'the two messages carry the same random value and no secret',
    m.toComputer.nonce === m.toPhone.nonce &&
      Object.keys(m.toComputer).sort().join() === 'id,name,nonce,pub,t' &&
      Object.keys(m.toPhone).sort().join() === 'id,name,nonce,pub,t'
  );
  void a;
}

// 2. Switch on: the phone is added, both sides get the same pairing id, and the phone marks the
// computer as introduced.
{
  const b = computerB();
  b.pair('pc-a');
  b.intro.setAllowed('pc-a', true);
  const pk = await PN.generateKeyPair(),
    phone = {
      id: 'ph-1',
      pub: Buffer.from(pk.pub),
      name: ' Pixel\n8 ',
      kind: 'phone',
      how: 'scan',
    };
  const m = makeIntroduction({
    phone,
    to: { id: 'pc-b', pub: b.self.pub, name: 'Studio PC', kind: 'computer' },
  });
  const got = b.intro.receive(wire(m.toComputer), 'pc-a');
  ok(
    'the phone is added, its name cleaned, marked with who added it',
    !!got.added &&
      got.added.id === 'ph-1' &&
      hex(got.added.pub) === hex(phone.pub) &&
      got.added.name === 'Pixel 8' &&
      got.added.by === 'pc-a' &&
      got.added.since === 77
  );
  const store = keyStore(memory()),
    aPub = crypto.getRandomValues(new Uint8Array(32));
  await store.add({
    id: 'pc-a',
    pub: aPub,
    pairingId: crypto.getRandomValues(new Uint8Array(16)),
    name: 'Desktop',
  });
  const self = { id: 'ph-1', pub: pk.pub };
  const acc = await acceptIntroduced({ store, self, msg: wire(m.toPhone), from: 'pc-a' });
  ok(
    'the phone stores the computer as introduced by the first one',
    !!acc.added &&
      acc.added.how === 'introduced' &&
      acc.added.by === 'pc-a' &&
      hex(acc.added.pub) === hex(b.self.pub) &&
      acc.added.name === 'Studio PC'
  );
  ok(
    'both sides worked out the same pairing id',
    hex(acc.added.pairingId) === hex(got.added.pairingId) && got.added.pairingId.length === 16
  );
  ok(
    'a resend of the same introduction changes nothing, on both sides',
    b.intro.receive(wire(m.toComputer), 'pc-a').again === true &&
      b.intro.phones().length === 1 &&
      (await acceptIntroduced({ store, self, msg: wire(m.toPhone), from: 'pc-a' })).again ===
        true &&
      (await store.pairings()).length === 2
  );
  ok(
    'a second instance on the same notes sees the same phone',
    introductions(b.deps).phone('ph-1').by === 'pc-a'
  );

  // 3. What the phone may do follows its introducer, live.
  ok(
    'a fully allowed introducer still gives only see and answer',
    JSON.stringify(b.intro.rights('ph-1')) ===
      JSON.stringify({ see: true, answer: true, prompt: false, control: false, text: true })
  );
  b.rights.set('pc-a', { see: true, answer: false, prompt: false, control: false, text: false });
  ok(
    'lowering the introducer lowers the phone at once, text switch included',
    JSON.stringify(b.intro.rights('ph-1')) ===
      JSON.stringify({ see: true, answer: false, prompt: false, control: false, text: false })
  );
  b.rights.set('pc-a', null);
  ok(
    'a paused introducer means its phone may do nothing',
    b.intro.rights('ph-1') === null && b.intro.phones().length === 1
  );
  b.rights.set('pc-a', { ...FULL });
  ok(
    'and it comes back when the pause ends',
    b.intro.rights('ph-1').answer === true &&
      b.intro.rights('nope') === null &&
      b.intro.rights('__proto__') === null
  );

  // 4. Remove is remembered.
  ok(
    'remove takes the phone away',
    b.intro.remove('ph-1').removed === true &&
      b.intro.phones().length === 0 &&
      b.intro.rights('ph-1') === null &&
      b.intro.remove('ph-1').removed === false
  );
  ok(
    "the introducer's resend does not bring it back",
    b.intro.receive(wire(m.toComputer), 'pc-a').ignored === true && b.intro.phones().length === 0
  );
  const sameKeyOtherId = wire(m.toComputer);
  sameKeyOtherId.id = 'ph-77';
  ok(
    'nor does the same key under another id',
    b.intro.receive(sameKeyOtherId, 'pc-a').ignored === true
  );

  // 12. The phone forgets a computer: the ones it only knows through it go too.
  ok(
    'forgetting the first computer on the phone forgets what it introduced',
    (await forgetWithIntroduced(store, 'pc-a')).sort().join() === 'pc-a,pc-b' &&
      (await store.pairings()).length === 0
  );
}

// 5. One device, one entry; only a paired computer with the switch on; bad shapes.
{
  const b = computerB();
  b.pair('pc-a');
  b.pair('pc-c');
  const scanned = b.pair('ph-9', 'phone');
  b.intro.setAllowed('pc-a', true);
  const to = { id: 'pc-b', pub: b.self.pub, name: 'Studio PC', kind: 'computer' },
    fresh = async id => makeIntroduction({ phone: await phoneOf(id), to }).toComputer;
  ok(
    'an id this computer paired itself is refused',
    b.intro.receive(wire(await fresh('ph-9')), 'pc-a').refused === 'known' &&
      b.intro.receive(wire(await fresh('pc-c')), 'pc-a').refused === 'known'
  );
  const stolenKey = wire(await fresh('ph-2'));
  stolenKey.pub = scanned.pub.toString('base64');
  ok(
    'a key this computer paired itself is refused under any id',
    b.intro.receive(stolenKey, 'pc-a').refused === 'known'
  );
  const own = wire(await fresh('ph-2'));
  own.pub = b.self.pub.toString('base64');
  const selfId = wire(await fresh('ph-2')),
    fromId = wire(await fresh('pc-a'));
  selfId.id = 'pc-b'; // A's side refuses to make this one itself
  ok(
    "this computer's own key or id, and the introducer's id, are ignored",
    b.intro.receive(own, 'pc-a').ignored &&
      b.intro.receive(selfId, 'pc-a').ignored &&
      b.intro.receive(fromId, 'pc-a').ignored
  );
  ok(
    'a computer whose switch is off, an unpaired sender and a phone are ignored',
    b.intro.receive(wire(await fresh('ph-2')), 'pc-c').ignored &&
      b.intro.receive(wire(await fresh('ph-2')), 'pc-zz').ignored &&
      b.intro.receive(wire(await fresh('ph-2')), 'ph-9').ignored &&
      b.intro.receive(wire(await fresh('ph-2')), '__proto__').ignored
  );
  const shapes = [
    null,
    'x',
    {},
    { t: 'introduce' },
    { t: 'introduce', id: '__proto__', pub: 'AAAA', nonce: 'AAAA' },
    { ...wire(await fresh('ph-2')), nonce: 'short' },
    { ...wire(await fresh('ph-2')), pub: 5 },
    { ...wire(await fresh('ph-2')), t: 'introduced' },
  ];
  ok(
    'malformed messages are ignored',
    shapes.every(s => b.intro.receive(s, 'pc-a').ignored === true) && b.intro.phones().length === 0
  );
  const first = wire(await fresh('ph-2'));
  b.intro.receive(first, 'pc-a');
  b.intro.setAllowed('pc-c', true);
  ok(
    'a second computer introducing the same phone is refused: it depends on the first alone',
    b.intro.receive(first, 'pc-c').refused === 'known' && b.intro.phone('ph-2').by === 'pc-a'
  );
  const otherKey = wire(await fresh('ph-2'));
  ok(
    'the same id with another key is refused, not replaced',
    b.intro.receive(otherKey, 'pc-a').refused === 'known' &&
      b.intro.phone('ph-2').pub.toString('base64') === first.pub
  );

  // 6. Three per introducing computer.
  b.intro.receive(wire(await fresh('ph-3')), 'pc-a');
  b.intro.receive(wire(await fresh('ph-4')), 'pc-a');
  ok(
    'a fourth phone from one computer is refused',
    b.intro.phonesOf('pc-a').length === 3 &&
      b.intro.receive(wire(await fresh('ph-5')), 'pc-a').refused === 'full' &&
      b.intro.receive(wire(await fresh('ph-5')), 'pc-c').added.by === 'pc-c'
  );

  // 7. A scan here replaces an introduced entry; the switch going off deletes that computer's
  // phones only.
  ok(
    'a confirmed scan makes the introduced entry give way',
    b.intro.scanned('ph-3', Buffer.alloc(32, 9)) === 1 &&
      b.intro.phone('ph-3') === null &&
      b.intro.scanned('ph-zz', Buffer.from(first.pub, 'base64')) === 1 &&
      b.intro.phone('ph-2') === null
  );
  const gone = b.intro.setAllowed('pc-a', false);
  ok(
    "turning the switch off deletes that computer's phones and leaves the other's",
    gone.length === 1 &&
      gone[0].id === 'ph-4' &&
      b.intro.phonesOf('pc-a').length === 0 &&
      b.intro.phones().length === 1 &&
      b.intro.allowed('pc-a') === false
  );
  ok(
    'and with it off the same introduction is ignored again',
    b.intro.receive(wire(await fresh('ph-4')), 'pc-a').ignored === true
  );
  ok(
    'a forgotten introducer takes its phones with it and its switch is off again',
    b.intro.introducerEnded('pc-c').length === 1 &&
      b.intro.phones().length === 0 &&
      b.intro.allowed('pc-c') === false
  );
  b.devices.delete('pc-c');
  ok(
    'a phone whose introducer is no longer paired may do nothing',
    b.intro.rights('ph-5') === null
  );
}

// 8. The removed list cannot grow without end: when it is full the switch goes off.
{
  const b = computerB();
  b.pair('pc-a');
  b.intro.setAllowed('pc-a', true);
  const to = { id: 'pc-b', pub: b.self.pub, name: 'Studio PC', kind: 'computer' };
  let off = null,
    count = 0;
  for (let i = 0; i < REMOVED_MAX && !off; i++) {
    b.intro.receive(
      wire(makeIntroduction({ phone: await phoneOf('ph-' + i), to }).toComputer),
      'pc-a'
    );
    off = b.intro.remove('ph-' + i).switchedOff;
    count++;
  }
  ok(
    "after twenty removals the introducing computer's switch goes off",
    off === 'pc-a' &&
      count === REMOVED_MAX &&
      b.intro.allowed('pc-a') === false &&
      b.intro.receive(
        wire(makeIntroduction({ phone: await phoneOf('ph-new'), to }).toComputer),
        'pc-a'
      ).ignored === true
  );
}

// 9. A's side: only a phone it paired by scan, never one it knows by introduction.
{
  const to = { id: 'pc-b', pub: DN.generateKeyPair().pub, name: 'Studio PC', kind: 'computer' },
    phone = await phoneOf('ph-1');
  ok(
    'an introduced phone is never passed on',
    (await throws(async () => makeIntroduction({ phone: { ...phone, how: 'introduced' }, to }))) &&
      (await throws(async () => makeIntroduction({ phone: { ...phone, how: undefined }, to })))
  );
  ok(
    'bad input is refused',
    (await throws(async () =>
      makeIntroduction({ phone: { ...phone, pub: Buffer.alloc(31) }, to })
    )) &&
      (await throws(async () => makeIntroduction({ phone, to: { ...to, id: 'ph-1' } }))) &&
      (await throws(async () => makeIntroduction({ phone: { ...phone, id: '__proto__' }, to })))
  );
  ok(
    'each introduction has its own random value',
    makeIntroduction({ phone, to }).toComputer.nonce !==
      makeIntroduction({ phone, to }).toComputer.nonce
  );
}

// 10. What the phone refuses.
{
  const pk = await PN.generateKeyPair(),
    self = { id: 'ph-1', pub: pk.pub },
    store = keyStore(memory());
  const rnd = n => crypto.getRandomValues(new Uint8Array(n)),
    b64 = b => Buffer.from(b).toString('base64');
  await store.add({ id: 'pc-a', pub: rnd(32), pairingId: rnd(16), name: 'Desktop' });
  const msg = (id, pub = rnd(32)) => ({
    t: 'introduced',
    id,
    pub: b64(pub),
    name: 'Studio PC',
    nonce: b64(rnd(32)),
  });
  ok(
    'an unknown computer cannot introduce',
    (await acceptIntroduced({ store, self, msg: msg('pc-b'), from: 'pc-x' })).ignored === true
  );
  await acceptIntroduced({ store, self, msg: msg('pc-b'), from: 'pc-a' });
  ok(
    'a computer the phone only knows by introduction cannot introduce another',
    (await acceptIntroduced({ store, self, msg: msg('pc-c'), from: 'pc-b' })).ignored === true
  );
  ok(
    "the phone's own id or key, the introducer's id and malformed messages are ignored",
    (await acceptIntroduced({ store, self, msg: msg('ph-1'), from: 'pc-a' })).ignored &&
      (await acceptIntroduced({ store, self, msg: msg('pc-c', pk.pub), from: 'pc-a' })).ignored &&
      (await acceptIntroduced({ store, self, msg: msg('pc-a'), from: 'pc-a' })).ignored &&
      (await acceptIntroduced({ store, self, msg: { ...msg('pc-c'), nonce: '!' }, from: 'pc-a' }))
        .ignored &&
      (await acceptIntroduced({ store, self, msg: null, from: 'pc-a' })).ignored
  );
  ok(
    'a known id with another key is refused, not replaced',
    (await acceptIntroduced({ store, self, msg: msg('pc-b'), from: 'pc-a' })).refused === 'known'
  );
  await acceptIntroduced({ store, self, msg: msg('pc-c'), from: 'pc-a' });
  await acceptIntroduced({ store, self, msg: msg('pc-d'), from: 'pc-a' });
  ok(
    "at most three computers on one computer's word",
    (await acceptIntroduced({ store, self, msg: msg('pc-e'), from: 'pc-a' })).refused === 'full' &&
      (await store.pairings()).length === 4
  );
  const realB = rnd(32);
  await store.add({
    id: 'pc-b',
    pub: realB,
    pairingId: rnd(16),
    name: 'Studio PC',
    kind: 'computer',
  });
  ok(
    'scanning that computer later replaces the introduced entry on the phone',
    (await store.pairing('pc-b')).how === 'scan' &&
      hex((await store.pairing('pc-b')).pub) === hex(realB)
  );
}

// 11. From the security review of this code (protocol section 14).
{
  const to = b => ({ id: 'pc-b', pub: b.self.pub, name: 'Studio PC', kind: 'computer' });

  // Finding 1: the introducer is unpaired and nobody tells this file; a computer with that id is
  // paired again with another key.
  const b = computerB();
  b.pair('pc-a');
  b.intro.setAllowed('pc-a', true);
  b.intro.receive(
    wire(makeIntroduction({ phone: await phoneOf('ph-1'), to: to(b) }).toComputer),
    'pc-a'
  );
  b.devices.delete('pc-a');
  ok(
    'an introducer that is no longer paired loses its phones and its switch without being told',
    b.intro.rights('ph-1') === null &&
      b.intro.phones().length === 0 &&
      b.intro.allowed('pc-a') === false
  );
  const b2 = computerB();
  b2.pair('pc-a');
  b2.intro.setAllowed('pc-a', true);
  b2.intro.receive(
    wire(makeIntroduction({ phone: await phoneOf('ph-1'), to: to(b2) }).toComputer),
    'pc-a'
  );

  // the same id, a new key: another computer, or the old one after Stop remote everywhere
  b2.pair('pc-a');
  ok(
    'pairing that id again with another key starts with the switch off and no phones',
    b2.intro.allowed('pc-a') === false &&
      b2.intro.phone('ph-1') === null &&
      b2.intro.rights('ph-1') === null
  );

  // Finding 2: a stolen introducer plants its own key under the id of a computer not paired here
  // yet.
  const c = computerB();
  c.pair('pc-a');
  c.intro.setAllowed('pc-a', true);
  const planted = wire(makeIntroduction({ phone: await phoneOf('pc-new'), to: to(c) }).toComputer);
  ok(
    'the planted entry is taken as a phone at first',
    !!c.intro.receive(planted, 'pc-a').added && c.intro.rights('pc-new') !== null
  );
  c.pair('pc-new');
  ok(
    'pairing that id here makes the planted entry give way, with no call from outside',
    c.intro.phone('pc-new') === null &&
      c.intro.rights('pc-new') === null &&
      c.intro.receive(planted, 'pc-a').refused === 'known' &&
      c.intro.phones().length === 0
  );

  // Finding 4: the same introduction sent again with a new random value: both sides follow, and
  // still agree.
  const d = computerB();
  d.pair('pc-a');
  d.intro.setAllowed('pc-a', true);
  const pk = await PN.generateKeyPair(),
    phone = { id: 'ph-1', pub: Buffer.from(pk.pub), name: 'Pixel 8', kind: 'phone', how: 'scan' },
    self = { id: 'ph-1', pub: pk.pub };
  const store = keyStore(memory());
  await store.add({
    id: 'pc-a',
    pub: crypto.getRandomValues(new Uint8Array(32)),
    pairingId: crypto.getRandomValues(new Uint8Array(16)),
  });
  const m1 = makeIntroduction({ phone, to: to(d) }),
    same = makeIntroduction({ phone, to: to(d), nonce: m1.nonce }),
    m2 = makeIntroduction({ phone, to: to(d) });
  ok(
    'a resend made with the kept value is the same two messages',
    JSON.stringify(same.toComputer) === JSON.stringify(m1.toComputer) &&
      JSON.stringify(same.toPhone) === JSON.stringify(m1.toPhone)
  );
  const c1 = d.intro.receive(wire(m1.toComputer), 'pc-a'),
    p1 = await acceptIntroduced({ store, self, msg: wire(m1.toPhone), from: 'pc-a' });
  const c2 = d.intro.receive(wire(m2.toComputer), 'pc-a'),
    p2 = await acceptIntroduced({ store, self, msg: wire(m2.toPhone), from: 'pc-a' });
  ok(
    'a new value renews the pairing id on both sides, and they still match',
    hex(c1.added.pairingId) === hex(p1.added.pairingId) &&
      c2.renewed === true &&
      p2.renewed === true &&
      hex(c2.added.pairingId) === hex(p2.added.pairingId) &&
      hex(c1.added.pairingId) !== hex(c2.added.pairingId) &&
      d.intro.phones().length === 1 &&
      (await store.pairings()).length === 2
  );

  // Finding 3: introductions arriving together cannot slip past the phone's limit of three.
  const many = keyStore(memory());
  await many.add({
    id: 'pc-a',
    pub: crypto.getRandomValues(new Uint8Array(32)),
    pairingId: crypto.getRandomValues(new Uint8Array(16)),
  });
  const b64 = x => Buffer.from(x).toString('base64'),
    rnd = n => crypto.getRandomValues(new Uint8Array(n));
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      acceptIntroduced({
        store: many,
        self,
        msg: {
          t: 'introduced',
          id: 'pc-' + (i + 2),
          pub: b64(rnd(32)),
          name: 'x',
          nonce: b64(rnd(32)),
        },
        from: 'pc-a',
      })
    )
  );
  ok(
    'eight introductions at once leave three stored',
    (await many.pairings()).filter(p => p.how === 'introduced').length === 3 &&
      results.filter(r => r.refused === 'full').length === 5
  );

  // Findings 8 and 9: loose values and loose kinds.
  const e = computerB();
  e.pair('pc-a');
  e.pair('ph-9', 'phone');
  e.intro.setAllowed('pc-a', true);
  e.intro.receive(
    wire(makeIntroduction({ phone: await phoneOf('ph-1'), to: to(e) }).toComputer),
    'pc-a'
  );
  e.rights.set('pc-a', { see: true, answer: 'false', prompt: true, control: true, text: 'false' });
  ok(
    'rights given as text are not taken as yes',
    JSON.stringify(e.intro.rights('ph-1')) ===
      JSON.stringify({ see: true, answer: false, prompt: false, control: false, text: false })
  );
  e.rights.set('pc-a', { see: 'true', answer: true, text: true });
  ok('and "see" as text means nothing at all', e.intro.rights('ph-1') === null);
  e.rights.set('pc-a', { see: false, answer: true, prompt: true, control: true, text: true });
  ok(
    'an introducer that may not even see here cannot add a phone',
    e.intro.receive(
      wire(makeIntroduction({ phone: await phoneOf('ph-2'), to: to(e) }).toComputer),
      'pc-a'
    ).ignored === true
  );
  e.rights.set('pc-a', { ...FULL });
  ok(
    'the switch cannot be set for a phone',
    await throws(async () => e.intro.setAllowed('ph-9', true))
  );
  const nl = wire(makeIntroduction({ phone: await phoneOf('ph-3'), to: to(e) }).toComputer);
  nl.id = 'ph' + String.fromCharCode(10) + '3';
  const sp = { ...nl, id: 'ph 3' },
    rtl = { ...nl, id: 'ph' + String.fromCharCode(0x202e) + '3' };
  ok(
    'an id with a line break, a space or a direction character is ignored',
    e.intro.receive(nl, 'pc-a').ignored &&
      e.intro.receive(sp, 'pc-a').ignored &&
      e.intro.receive(rtl, 'pc-a').ignored
  );
  const ph = await phoneOf('ph-4');
  ok(
    'only a phone can be introduced, only to a computer, and "paired by scan" cannot be inherited',
    (await throws(async () =>
      makeIntroduction({ phone: { ...ph, kind: 'computer' }, to: to(e) })
    )) &&
      (await throws(async () =>
        makeIntroduction({ phone: ph, to: { ...to(e), kind: 'phone' } })
      )) &&
      (await throws(async () =>
        makeIntroduction({
          phone: Object.assign(Object.create({ how: 'scan' }), {
            id: ph.id,
            pub: ph.pub,
            name: ph.name,
            kind: 'phone',
          }),
          to: to(e),
        })
      ))
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
