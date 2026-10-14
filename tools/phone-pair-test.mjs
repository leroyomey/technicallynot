// Runs the phone's side of pairing (phone/src/pair.mjs, Web Crypto) against the computer's side
// (desktop/phone-pair.js, Node): node tools/phone-pair-test.mjs Messages go between them as JSON
// text, as they would through the relay. Plain Node; no network, no real phone, no camera.
import { createRequire } from 'node:module';
import * as PN from '../phone/src/noise.mjs';
import { scanPairing, readCode, QR_PREFIX } from '../phone/src/pair.mjs';
const require = createRequire(import.meta.url);
const DN = require('../desktop/remote-noise.js'),
  { phonePairing } = require('../desktop/phone-pair.js'),
  { pairingGuard } = require('../desktop/remote-keys.js');

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
const clock = { t: 1000000 },
  now = () => clock.t;

const pcSelf = id => ({ id, ...DN.generateKeyPair() });
const phSelf = async id => ({ id, ...(await PN.generateKeyPair()) });

// Carries messages both ways until nothing is left. `from` ids are what the relay would stamp.
async function carry(pc, ph, pcId, phId, toPc, toPhone = []) {
  toPc = toPc.map(wire);
  toPhone = toPhone.map(wire);
  for (let guard = 0; (toPc.length || toPhone.length) && guard < 50; guard++) {
    if (toPc.length) {
      const r = pc.receive(toPc.shift(), phId);
      toPhone.push(...(r.send || []).map(wire));
    }
    if (toPhone.length) {
      const r = await ph.receive(toPhone.shift(), pcId);
      toPc.push(...(r.send || []).map(wire));
    }
  }
}

async function setup(pcId, phId, opts = {}) {
  const me = pcSelf(pcId),
    phone = await phSelf(phId),
    guard = opts.guard || pairingGuard(now);
  const pc = phonePairing({ self: me, name: 'Desktop', guard, now }),
    shown = pc.show();
  const ph = shown.qr ? scanPairing({ self: phone, name: 'Pixel 8', code: shown.qr, now }) : null;
  return { me, phone, pc, ph, shown, guard };
}

// 1. The whole run, with the phone's id lower and higher than the computer's: the phone starts the
// handshake either way.
for (const [pcId, phId] of [
  ['aa-pc', 'zz-ph'],
  ['zz-pc', 'aa-ph'],
]) {
  const who = pcId < phId ? 'computer id lower' : 'phone id lower';
  const { me, phone, pc, ph, shown } = await setup(pcId, phId);
  ok(
    who + ': the code is plain data, not a link',
    shown.qr.startsWith(QR_PREFIX) && !/[:/]/.test(shown.qr)
  );
  ok(
    who + ": the phone reads the computer's id and key from the code",
    hex(readCode(shown.qr).pub) === hex(me.pub) && readCode(shown.qr).id === pcId
  );
  const first = await ph.start();
  ok(
    who +
      ": the phone sends to the computer of the code, its proof and then the handshake's first message",
    first.to === pcId && first.send.map(m => m.t).join() === 'phone,hs1'
  );
  await carry(pc, ph, pcId, phId, first.send);
  ok(
    who + ': the phone shows six digits and the computer waits for them',
    /^\d{6}$/.test(ph.shows || '') && pc.state === 'enter' && ph.state === 'show'
  );
  ok(
    who + ': nothing is stored on either side before the digits are typed',
    pc.result() === null && ph.result() === null
  );
  const wrong = String((Number(ph.shows) + 1) % 1000000).padStart(6, '0'),
    miss = pc.enter(wrong);
  ok(
    who + ': wrong digits are refused, with tries left',
    miss.ok === false && miss.left === 2 && pc.result() === null
  );
  const half = pc.enter('12 34');
  ok(
    who + ': an entry that is not six digits costs no try',
    half.ok === false && half.invalid === true && pc.enter(wrong).left === 1
  );
  const done = pc.enter(ph.shows.slice(0, 3) + ' ' + ph.shows.slice(3));
  ok(
    who +
      ': the right digits pass (a space typed between them is fine), and the computer still stores nothing',
    done.ok === true && pc.state === 'confirming' && pc.result() === null
  );
  await carry(pc, ph, pcId, phId, [], done.send);
  const a = pc.result(),
    b = ph.result();
  ok(
    who + ': the computer is done only once the phone answered',
    pc.state === 'done' && ph.state === 'done'
  );
  ok(
    who + ": both sides hold each other's key and the same pairing id",
    !!a &&
      !!b &&
      hex(a.pub) === hex(phone.pub) &&
      hex(b.pub) === hex(me.pub) &&
      hex(a.pairingId) === hex(b.pairingId) &&
      a.pairingId.length === 16 &&
      a.peer === phId &&
      b.peer === pcId
  );
  ok(
    who + ': names arrive only at the end, over the session',
    a.name === 'Pixel 8' && b.name === 'Desktop' && ph.shows === null
  );
}

// 2. A wrong proof is dropped and counts nothing; the real phone still pairs afterwards.
{
  const { pc, ph, phone } = await setup('pc-5', 'ph-5');
  const first = await ph.start(),
    bad = wire(first.send[0]);
  bad.mac = Buffer.alloc(32, 1).toString('base64');
  let ignored = true;
  for (let i = 0; i < 20; i++)
    ignored =
      ignored &&
      pc.receive(bad, 'ph-5').ignored === true &&
      pc.receive({ t: 'phone' }, 'other-' + i).ignored === true &&
      pc.receive('junk', 'ph-5').ignored === true;
  ok(
    'sixty wrong or malformed messages are ignored and the code still stands',
    ignored && pc.state === 'wait'
  );
  const swapped = wire(first.send[0]);
  swapped.pub = Buffer.from((await PN.generateKeyPair()).pub).toString('base64');
  ok('a swapped phone key does not fit the proof', pc.receive(swapped, 'ph-5').ignored === true);
  ok(
    'the same proof under another sender id does not fit',
    pc.receive(wire(first.send[0]), 'ph-6').ignored === true && pc.state === 'wait'
  );
  await carry(pc, ph, 'pc-5', 'ph-5', first.send);
  const typed = pc.state === 'enter' ? pc.enter(ph.shows) : {};
  await carry(pc, ph, 'pc-5', 'ph-5', [], typed.send || []);
  ok(
    'then the real phone pairs',
    typed.ok === true && !!pc.result() && hex(pc.result().pub) === hex(phone.pub)
  );
}

// 3. The photographed code: a stranger's phone sends a right proof first.
{
  const { pc, ph, shown } = await setup('pc-5', 'ph-5');
  const stranger = scanPairing({
    self: await phSelf('ph-2'),
    name: 'Pixel 8',
    code: shown.qr,
    now,
  });
  await carry(pc, stranger, 'pc-5', 'ph-2', (await stranger.start()).send);
  ok(
    'the stranger reaches the digits step',
    pc.state === 'enter' && /^\d{6}$/.test(stranger.shows || '')
  );
  const mine = await ph.start();
  let untouched = true;
  for (const m of mine.send) untouched = untouched && pc.receive(wire(m), 'ph-5').ignored === true;
  ok(
    "the user's own phone is ignored, shows no digits, and does not end the pending pairing",
    untouched && ph.shows === null && pc.state === 'enter'
  );
  ok(
    'the stranger is not stored and was sent nothing but the ready mark',
    pc.result() === null && stranger.result() === null
  );
  pc.enter('000000' === stranger.shows ? '111111' : '000000');
  pc.enter('000001' === stranger.shows ? '111112' : '000001');
  const third = pc.enter('000002' === stranger.shows ? '111113' : '000002');
  ok(
    'three wrong entries end the run with nothing stored',
    third.ended === 'locked' && pc.result() === null && pc.state === 'ended'
  );
}

// 4. One pending pairing: the phone cannot start over for other digits, and the dialog closing ends
// it.
{
  const { pc, ph } = await setup('pc-5', 'ph-5');
  const first = await ph.start();
  await carry(pc, ph, 'pc-5', 'ph-5', first.send);
  ok(
    'the same messages delivered a second time are ignored and the run goes on',
    pc.receive(wire(first.send[0]), 'ph-5').ignored === true &&
      pc.receive(wire(first.send[1]), 'ph-5').ignored === true &&
      pc.state === 'enter'
  );
  const other = wire(first.send[1]);
  other.m = Buffer.alloc(48, 7).toString('base64');
  ok(
    'a different second handshake message from the phone ends the run',
    pc.receive(other, 'ph-5').ended === 'out_of_order' &&
      pc.result() === null &&
      pc.enter(ph.shows).ended === 'out_of_order'
  );

  // The phone's two first messages arrive in the other order: the handshake message waits for its
  // proof.
  const sw = await setup('pc-5', 'ph-5'),
    fs = await sw.ph.start();
  await carry(sw.pc, sw.ph, 'pc-5', 'ph-5', [fs.send[1], fs.send[0]]);
  ok(
    'the two first messages in the other order still pair',
    sw.pc.state === 'enter' && /^\d{6}$/.test(sw.ph.shows || '')
  );
  ok(
    'typing before there is anything to type, and a double press of the right digits, do not throw',
    (await setup('pc-5', 'ph-5')).pc.enter('123456').notNow === true &&
      sw.pc.enter(sw.ph.shows).ok === true &&
      sw.pc.enter(sw.ph.shows).notNow === true &&
      sw.pc.state === 'confirming'
  );
  ok(
    "junk while the computer waits for the phone's answer changes nothing",
    sw.pc.receive({ t: 'm', n: 1, c: Buffer.alloc(272, 9).toString('base64') }, 'ph-5').ignored ===
      true &&
      sw.pc.receive({ t: 'hs1', m: 'AAAA' }, 'ph-5').ignored === true &&
      sw.pc.state === 'confirming'
  );
  const again = await setup('pc-5', 'ph-5'),
    f2 = await again.ph.start();
  await carry(again.pc, again.ph, 'pc-5', 'ph-5', f2.send);
  ok(
    'a message from another device does not end it',
    again.pc.receive({ t: 'hs1', m: 'AAAA' }, 'ph-7').ignored === true && again.pc.state === 'enter'
  );
  again.pc.cancel();
  ok(
    'a closed dialog ends it with nothing stored',
    again.pc.state === 'ended' &&
      again.pc.result() === null &&
      again.pc.enter(again.ph.shows).ended === 'cancelled'
  );
  ok('the phone that never hears "confirmed" stores nothing', again.ph.result() === null);
}

// 5. Clocks: two minutes to scan, two minutes to type.
{
  const a = await setup('pc-5', 'ph-5'),
    first = await a.ph.start();
  clock.t += 2 * 60 * 1000 + 1;
  ok(
    'a code older than two minutes is dead',
    a.pc.receive(wire(first.send[0]), 'ph-5').ended === 'expired'
  );
  const b = await setup('pc-5', 'ph-5');
  clock.t += 110 * 1000;
  await carry(b.pc, b.ph, 'pc-5', 'ph-5', (await b.ph.start()).send);
  clock.t += 110 * 1000;
  ok('the digits have their own two minutes from the scan', b.pc.state === 'enter');
  const digits = b.ph.shows;
  clock.t += 11 * 1000;
  ok(
    'and are dead after them: the computer refuses them and the phone stops showing them',
    b.pc.enter(digits).ended === 'expired' && b.pc.result() === null && b.ph.shows === null
  );
  clock.t += 30 * 1000;
  ok(
    "and the phone's run ends half a minute later",
    b.ph.state === 'ended' && b.ph.result() === null
  );
}

// 5b. The two clocks do not start together, and the last messages can be lost (security review of
// the code, finding 3).
{
  // The phone's clock starts at the scan, the computer's a few seconds later when the message
  // arrives; digits typed at the last moment.
  const a = await setup('pc-5', 'ph-5'),
    first = await a.ph.start();
  clock.t += 5 * 1000;
  await carry(a.pc, a.ph, 'pc-5', 'ph-5', first.send);
  const digits = a.ph.shows;
  clock.t += 116 * 1000;
  const typed = a.pc.enter(digits);
  await carry(a.pc, a.ph, 'pc-5', 'ph-5', [], typed.send || []);
  ok(
    "digits typed in the computer's last seconds still pair both sides",
    typed.ok === true && !!a.pc.result() && !!a.ph.result()
  );

  // "confirmed" is lost on the way: the computer must not be left holding a phone that holds
  // nothing.
  const b = await setup('pc-5', 'ph-5');
  await carry(b.pc, b.ph, 'pc-5', 'ph-5', (await b.ph.start()).send);
  const lost = b.pc.enter(b.ph.shows);
  ok(
    "with the right digits the computer waits for the phone's answer",
    lost.ok === true && b.pc.state === 'confirming' && b.pc.result() === null
  );
  clock.t += 31 * 1000;
  ok(
    'no answer in half a minute ends the run with nothing stored on either side',
    b.pc.state === 'ended' &&
      b.pc.reason === 'no_answer' &&
      b.pc.result() === null &&
      b.ph.result() === null
  );

  // The run is ended while the phone is still opening "confirmed": it must not come out as paired.
  const c = await setup('pc-5', 'ph-5');
  await carry(c.pc, c.ph, 'pc-5', 'ph-5', (await c.ph.start()).send);
  const sent = c.pc.enter(c.ph.shows),
    pending = c.ph.receive(wire(sent.send[0]), 'pc-5');
  c.ph.cancel();
  const after = await pending;
  ok(
    "cancel during the phone's last step leaves it unpaired and sends no name",
    after.ended === 'cancelled' && c.ph.result() === null && c.ph.state === 'ended' && !after.send
  );
  const d = await setup('pc-5', 'ph-5'),
    starting = d.ph.start();
  d.ph.cancel();
  ok(
    "cancel during the phone's first step sends nothing",
    (await starting).ended === 'cancelled' && d.ph.state === 'ended'
  );
}

// 5c. A right proof with a key that cannot be used (all zero), and a clock set back (finding 4 and
// 7).
{
  const { pc, shown, guard } = await setup('pc-5', 'ph-5'),
    code = readCode(shown.qr),
    zero = Buffer.alloc(32);
  const mac = require('node:crypto')
    .createHmac('sha256', Buffer.from(code.secret))
    .update(DN.fields('tnai-phone-pair-v1', 'pc-5', 'ph-2', Buffer.from(code.pub), zero))
    .digest();
  let threw = false,
    r1 = null,
    r2 = null;
  try {
    r1 = pc.receive(
      { t: 'phone', pub: zero.toString('base64'), mac: mac.toString('base64') },
      'ph-2'
    );
    r2 = pc.receive({ t: 'hs1', m: Buffer.alloc(48).toString('base64') }, 'ph-2');
  } catch {
    threw = true;
  }
  ok(
    'a right proof with an unusable key ends the run instead of throwing',
    !threw && !!r1 && r2 && r2.ended === 'handshake' && pc.result() === null && pc.state === 'ended'
  );
  const again = phonePairing({ self: pcSelf('pc-5'), guard, now });
  again.show();
  clock.t += 100 * 1000;
  void again.state;
  clock.t -= 60 * 1000;
  ok('a clock set back does not end the run', again.state === 'wait');
  clock.t += 60 * 1000 + 21 * 1000;
  ok(
    'and wins no extra time: the code still dies two minutes after it was shown',
    again.state === 'ended' && again.reason === 'expired'
  );
  ok(
    'the default clock only goes forward',
    (() => {
      const p = phonePairing({ self: pcSelf('pc-5'), guard: pairingGuard() });
      return !!p.show().qr && p.state === 'wait';
    })()
  );

  // A code that holds a key no handshake can use: the phone's run ends, it does not hang in its
  // first step.
  const badCode =
    QR_PREFIX + DN.fields('1', 'pc-7', Buffer.alloc(32), Buffer.alloc(32, 1)).toString('base64url');
  const bad = scanPairing({ self: await phSelf('ph-5'), code: badCode, now }),
    badStart = await bad.start();
  ok(
    "a code with an unusable key ends the phone's run",
    badStart.ended === 'handshake' && bad.state === 'ended'
  );
}

// 5d. With the phone's key store: refused before it starts when it could not be stored; stored
// before the answer goes out.
{
  const mem = () => {
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
  const { keyStore } = await import('../phone/src/keys.mjs');
  const run = async (store, pcSelfObj) => {
    const guard = pairingGuard(now),
      pc = phonePairing({ self: pcSelfObj, name: 'Desktop', guard, now }),
      phone = await phSelf('ph-5');
    const ph = scanPairing({ self: phone, name: 'Pixel 8', code: pc.show().qr, store, now });
    return { pc, ph, first: await ph.start() };
  };
  const store = keyStore(mem()),
    me = pcSelf('pc-5');
  const a = await run(store, me);
  await carry(a.pc, a.ph, 'pc-5', 'ph-5', a.first.send);
  const typed = a.pc.enter(a.ph.shows),
    answer = await a.ph.receive(wire(typed.send[0]), 'pc-5');
  ok(
    "the computer is in the phone's store before the phone's answer has gone anywhere",
    !!answer.send && (await store.pairing('pc-5')).name === 'Desktop' && a.pc.result() === null
  );
  const sameAgain = await run(store, me);
  ok(
    'scanning the same computer again is allowed (it repairs a lost answer)',
    !!sameAgain.first.send
  );
  const otherKey = await run(store, pcSelf('pc-5'));
  ok(
    'a computer with that id but another key is refused before anything is sent',
    otherKey.first.ended === 'already_paired' &&
      !otherKey.first.send &&
      otherKey.ph.state === 'ended'
  );

  // The store refuses at the last moment (here: it breaks): the phone sends no answer, so the
  // computer stores nothing either.
  const broken = keyStore({
      get: async () => undefined,
      update: async () => {
        throw new Error('store broke');
      },
    }),
    b = await run(broken, pcSelf('pc-6'));
  await carry(b.pc, b.ph, 'pc-6', 'ph-5', b.first.send);
  const t2 = b.pc.enter(b.ph.shows),
    ans2 = await b.ph.receive(wire(t2.send[0]), 'pc-6');
  clock.t += 31 * 1000;
  ok(
    'when the phone cannot store, it sends no answer and neither side keeps the other',
    ans2.ended === 'not_stored' &&
      !ans2.send &&
      b.ph.result() === null &&
      b.pc.state === 'ended' &&
      b.pc.result() === null
  );
  ok(
    'a run needs the shared guard',
    await throws(async () => phonePairing({ self: pcSelf('pc-5'), now }))
  );
}

// 6. Three wrong entries stop phone pairing on this computer for ten minutes, across runs.
{
  const guard = pairingGuard(now),
    a = await setup('pc-5', 'ph-5', { guard });
  await carry(a.pc, a.ph, 'pc-5', 'ph-5', (await a.ph.start()).send);
  const not = d => (d === a.ph.shows ? '999999' : d);
  a.pc.enter(not('123456'));
  a.pc.enter(not('123457'));
  const third = a.pc.enter(not('123458'));
  const next = phonePairing({ self: pcSelf('pc-5'), guard, now }).show();
  ok(
    'the stop outlives the run',
    third.ended === 'locked' && next.ended === 'locked' && next.until > clock.t
  );
  clock.t += 10 * 60 * 1000 + 1;
  ok('and ends after ten minutes', !!phonePairing({ self: pcSelf('pc-5'), guard, now }).show().qr);
}

// 7. What the phone refuses.
{
  const { pc, ph, shown, phone } = await setup('pc-5', 'ph-5');
  ok(
    'the phone refuses text that is not a pairing code',
    readCode('https://example.com') === null &&
      readCode(QR_PREFIX + 'AAAA') === null &&
      readCode(shown.qr.slice(0, -4)) === null &&
      readCode(shown.qr.replace('TNAIPAIR1', 'TNAIPAIR2')) === null &&
      readCode(5) === null
  );
  ok(
    'and a code that is its own',
    await throws(async () => scanPairing({ self: { ...phone, id: 'pc-5' }, code: shown.qr, now }))
  );
  const first = await ph.start();
  ok('start works once', await throws(() => ph.start()));
  ok(
    'messages from another device and junk from the computer change nothing',
    (await ph.receive({ t: 'hs1', m: 'AAAA' }, 'pc-6')).ignored === true &&
      (await ph.receive({ t: 'hs1', m: Buffer.alloc(48, 3).toString('base64') }, 'pc-5'))
        .ignored === true &&
      (await ph.receive({ t: 'hs2', m: Buffer.alloc(48, 3).toString('base64') }, 'pc-5'))
        .ignored === true &&
      (await ph.receive(null, 'pc-5')).ignored === true
  );
  await carry(pc, ph, 'pc-5', 'ph-5', first.send);
  ok(
    'and the real exchange still completes after the junk',
    /^\d{6}$/.test(ph.shows || '') && pc.state === 'enter'
  );
  ok(
    'a false "confirmed" from the relay is ignored',
    (await ph.receive({ t: 'm', n: 1, c: Buffer.alloc(272, 5).toString('base64') }, 'pc-5'))
      .ignored === true &&
      ph.result() === null &&
      ph.state === 'show'
  );

  // A computer with another key that saw the same code cannot finish with the phone: the phone only
  // trusts the key in the code.
  const other = await setup('pc-5', 'ph-5'),
    ph2 = scanPairing({ self: phone, code: shown.qr, now });
  const f2 = await ph2.start();
  let reached = false;
  for (const m of f2.send) {
    const r = other.pc.receive(wire(m), 'ph-5');
    for (const s of r.send || []) {
      const back = await ph2.receive(wire(s), 'pc-5');
      reached = reached || !!(back.send && back.send.length);
    }
  }
  ok('a computer with another key gets nowhere with this phone', !reached && ph2.shows === null);
}

// Review 6, 5 (2026-10-05). A rescan of a computer that is already paired, ended while the phone is
// storing: the old pairing stays.
{
  const mem = () => {
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
  const { keyStore } = await import('../phone/src/keys.mjs');
  const real = keyStore(mem()),
    me = pcSelf('pc-7'),
    phone = await phSelf('ph-7');
  const go = async store => {
    const pc = phonePairing({ self: me, name: 'Desktop', guard: pairingGuard(now), now }),
      ph = scanPairing({ self: phone, name: 'Pixel 8', code: pc.show().qr, store, now });
    await carry(pc, ph, 'pc-7', 'ph-7', (await ph.start()).send);
    return { pc, ph, answer: await ph.receive(wire(pc.enter(ph.shows).send[0]), 'pc-7') };
  };
  const first = await go(real),
    old = await real.pairing('pc-7');
  ok('review 6: first pairing stored', !!first.answer.send && !!old);
  let run2 = null;
  const cancelling = {
    ...real,
    add: async e => {
      const r = await real.add(e);
      run2.cancel();
      return r;
    },
  }; // the user cancels (or the clock ends it) exactly while the store writes
  const pc2 = phonePairing({ self: me, name: 'Desktop', guard: pairingGuard(now), now });
  run2 = scanPairing({ self: phone, name: 'Pixel 8', code: pc2.show().qr, store: cancelling, now });
  await carry(pc2, run2, 'pc-7', 'ph-7', (await run2.start()).send);
  const ans = await run2.receive(wire(pc2.enter(run2.shows).send[0]), 'pc-7'),
    after = await real.pairing('pc-7');
  ok(
    'review 6: a rescan ended during the store write sends nothing',
    ans.ended === 'cancelled' && !ans.send,
    JSON.stringify(ans)
  );
  ok(
    'review 6: and the old pairing is still there, unchanged',
    !!after && hex(after.pairingId) === hex(old.pairingId) && hex(after.pub) === hex(old.pub),
    String(!!after)
  );

  // A first scan ended during the write leaves nothing, as before.
  const fresh = keyStore(mem());
  let run3 = null;
  const c3 = {
    ...fresh,
    add: async e => {
      const r = await fresh.add(e);
      run3.cancel();
      return r;
    },
  };
  const pc3 = phonePairing({ self: me, name: 'Desktop', guard: pairingGuard(now), now });
  run3 = scanPairing({ self: phone, name: 'Pixel 8', code: pc3.show().qr, store: c3, now });
  await carry(pc3, run3, 'pc-7', 'ph-7', (await run3.start()).send);
  await run3.receive(wire(pc3.enter(run3.shows).send[0]), 'pc-7');
  ok(
    'review 6: a first scan ended during the write leaves nothing stored',
    (await fresh.pairings()).length === 0
  );
}

// Review 7, 5 (2026-10-05). The take-back after a run that ended during the store write, with a
// Forget in between and with a store that fails.
{
  const mem = () => {
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
  const { keyStore } = await import('../phone/src/keys.mjs');
  const me = pcSelf('pc-8'),
    phone = await phSelf('ph-8');
  const go = async (store, during) => {
    let ph = null;
    const wrapped = {
      ...store,
      add: async e => {
        const r = await store.add(e);
        await during(ph);
        return r;
      },
    };
    const pc = phonePairing({ self: me, name: 'Desktop', guard: pairingGuard(now), now });
    ph = scanPairing({
      self: phone,
      name: 'Pixel 8',
      code: pc.show().qr,
      store: during ? wrapped : store,
      now,
    });
    await carry(pc, ph, 'pc-8', 'ph-8', (await ph.start()).send);
    return ph.receive(wire(pc.enter(ph.shows).send[0]), 'pc-8');
  };
  const a = keyStore(mem());
  await go(a, null);
  ok('review 7: (setup) the computer is paired', !!(await a.pairing('pc-8')));
  const ans = await go(a, async ph => {
    await a.remove('pc-8');
    ph.cancel();
  }); // forgotten, then the run ends, both during the write
  ok(
    'review 7: a Forget between the write and the take-back stays a Forget',
    ans.ended === 'cancelled' && (await a.pairings()).length === 0,
    JSON.stringify(ans)
  );
  const b = keyStore(mem());
  await go(b, null);
  const old = await b.pairing('pc-8');
  const ans2 = await go(
    {
      ...b,
      takeBack: async () => {
        throw new Error('store broke');
      },
    },
    async ph => ph.cancel()
  );
  const left = await b.pairing('pc-8');
  ok(
    'review 7: a take-back the store refuses sends nothing; the entry left is the unconfirmed one, which the computer never stored',
    ans2.ended === 'cancelled' && !ans2.send && !!left && hex(left.pairingId) !== hex(old.pairingId)
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
