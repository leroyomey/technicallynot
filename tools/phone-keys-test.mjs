// Checks the phone's key store (phone/src/keys.mjs) and that its copied helpers equal the desktop's
// (desktop/remote-keys.js): node tools/phone-keys-test.mjs Plain Node with a Map as the store. It
// does not prove IndexedDB on a real phone (idbBackend is not run here).
import { createRequire } from 'node:module';
import { keyStore, clean, safeId } from '../phone/src/keys.mjs';
const D = createRequire(import.meta.url)('../desktop/remote-keys.js');

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
const hex = b => Buffer.from(b).toString('hex');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));

// A store that hands back what it was given, and yields first, as a real one does.
// update reads, calls fn and writes in one go, as one IndexedDB transaction does.
const memory = () => {
  const m = new Map();
  return {
    m,
    get: async k => {
      await null;
      return m.get(k);
    },
    update: async (k, fn) => {
      await new Promise(r => setTimeout(r, 1));
      const [v, r] = fn(m.get(k));
      if (v !== undefined) m.set(k, v);
      return r;
    },
  };
};

// 1. The copied helpers give the desktop's answers.
{
  const names = [
    'Desktop',
    '  two   spaces ',
    'line\nbreak\ttab',
    'zero\u200bwidth',
    'right\u202eto-left',
    'x'.repeat(80),
    '',
    null,
    undefined,
    42,
    'emoji 🙂 ok',
    '\u0000\u001f\u007f\u009f',
    'bom\ufeff',
    'sep\u2028\u2029',
  ];
  ok(
    "clean equals the desktop's",
    names.every(n => clean(n, 60) === D.clean(n, 60)) && clean('abcdef', 4) === D.clean('abcdef', 4)
  );

  // The characters the desktop's rule gained in 0.3.65, written by number so no editor can change
  // them on the way.
  const more = [0xad, 0x61c, 0x180e, 0x2800, 0x3164, 0xfe0f, 0xfff9, 0xe0041, 0xe0100, 0x1f600]
    .map(c => 'a' + String.fromCodePoint(c) + 'b')
    .concat([
      'e' + String.fromCodePoint(0x301).repeat(6),
      String.fromCodePoint(0x1f600).repeat(70),
      'half' + String.fromCharCode(0xd83d),
      'My PC',
      'pc_1-A',
      ' ',
      'a b',
    ]);
  ok(
    'and for the characters its rule gained in 0.3.65, clipping by whole characters included',
    more.every(n => clean(n, 60) === D.clean(n, 60) && clean(n, 4) === D.clean(n, 4)) &&
      more.every(n => safeId(n) === D.safeId(n)) &&
      !safeId('My PC') &&
      safeId('pc_1-A')
  );
  const ids = [
    'dev-1',
    '',
    '__proto__',
    'constructor',
    'toString',
    'x'.repeat(64),
    'x'.repeat(65),
    5,
    null,
    undefined,
    {},
    'hasOwnProperty',
  ];
  ok(
    "safeId equals the desktop's",
    ids.every(i => safeId(i) === D.safeId(i))
  );
}

// 2. The phone's own key.
{
  const b = memory(),
    s = keyStore(b),
    me = await s.identity(),
    again = await s.identity(),
    reopened = await keyStore(b).identity();
  ok(
    'the key is made once and kept',
    hex(me.pub) === hex(again.pub) && hex(me.pub) === hex(reopened.pub) && me.pub.length === 32
  );
  ok(
    'the private key cannot be exported',
    (await throws(() => crypto.subtle.exportKey('pkcs8', me.priv))) &&
      (await throws(() => crypto.subtle.exportKey('jwk', me.priv)))
  );
  ok(
    'nothing in the store holds the private key as bytes or text',
    [...b.m.values()].every(
      v => !JSON.stringify(v, (k, x) => (x instanceof Uint8Array ? hex(x) : x))?.includes('"d"')
    ) && b.m.get('identity').priv instanceof CryptoKey
  );
  const two = await Promise.all(
    [keyStore(memory()).identity()].concat(
      (() => {
        const bb = memory(),
          ss = keyStore(bb);
        return [ss.identity(), ss.identity()];
      })()
    )
  );
  ok('two first calls at once make one key, not two', hex(two[1].pub) === hex(two[2].pub));
  me.pub[0] ^= 1;
  ok(
    'a caller cannot change the stored public key',
    hex((await s.identity()).pub) === hex(again.pub)
  );
  await s.renewIdentity();
  ok('a renewed key is a different key', hex((await s.identity()).pub) !== hex(again.pub));
}

// 3. Paired computers: one device, one entry.
{
  const b = memory(),
    s = keyStore(b),
    pubA = rnd(32),
    pidA = rnd(16);
  await s.add({ id: 'pc-a', pub: pubA, pairingId: pidA, name: '  Desk\u202etop\n', since: 5 });
  const a = await s.pairing('pc-a');
  ok(
    'a stored computer comes back whole, its name cleaned',
    !!a &&
      hex(a.pub) === hex(pubA) &&
      hex(a.pairingId) === hex(pidA) &&
      a.name === 'Desk top' &&
      a.since === 5 &&
      a.how === 'scan' &&
      a.by === null
  );
  ok(
    'the same device id is refused, whatever the key',
    await throws(() => s.add({ id: 'pc-a', pub: rnd(32), pairingId: rnd(16) }))
  );
  ok(
    'the same key under another id is refused',
    await throws(() => s.add({ id: 'pc-x', pub: pubA, pairingId: rnd(16) }))
  );
  ok(
    'and the first entry is unchanged',
    hex((await s.pairing('pc-a')).pub) === hex(pubA) && (await s.pairings()).length === 1
  );
  ok(
    'bad input is refused',
    (await throws(() => s.add({ id: '__proto__', pub: rnd(32), pairingId: rnd(16) }))) &&
      (await throws(() => s.add({ id: 'p', pub: rnd(31), pairingId: rnd(16) }))) &&
      (await throws(() => s.add({ id: 'p', pub: rnd(32), pairingId: rnd(15) }))) &&
      (await throws(() =>
        s.add({ id: 'p', pub: Buffer.alloc(32).toString('base64'), pairingId: rnd(16) })
      )) &&
      (await throws(() => s.add({ id: 'p', pub: rnd(32), pairingId: rnd(16), how: 'other' })))
  );
  ok(
    'an introduced computer needs who introduced it, a scanned one must not have one',
    (await throws(() =>
      s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), how: 'introduced' })
    )) && (await throws(() => s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), by: 'pc-a' })))
  );
  await s.add({
    id: 'pc-b',
    pub: rnd(32),
    pairingId: rnd(16),
    name: 'Studio PC',
    how: 'introduced',
    by: 'pc-a',
  });
  ok(
    'an introduced computer is marked so',
    (await s.pairing('pc-b')).how === 'introduced' && (await s.pairing('pc-b')).by === 'pc-a'
  );
  await Promise.all([
    s.add({ id: 'pc-c', pub: rnd(32), pairingId: rnd(16) }),
    s.add({ id: 'pc-d', pub: rnd(32), pairingId: rnd(16) }),
    s.rename('pc-a', 'Main\u200b PC'),
  ]);
  const all = await s.pairings();
  ok(
    'changes made at once all land',
    all.length === 4 && all.find(p => p.id === 'pc-a').name === 'Main PC'
  );
  const got = await s.pairing('pc-a');
  got.pub[0] ^= 1;
  ok('a caller cannot change a stored entry', hex((await s.pairing('pc-a')).pub) === hex(pubA));
  ok(
    'remove says whether it removed',
    (await s.remove('pc-c')) === true &&
      (await s.remove('pc-c')) === false &&
      (await s.pairing('pc-c')) === null &&
      (await s.pairings()).length === 3
  );
  ok(
    'an unknown or unsafe id gives nothing',
    (await s.pairing('nope')) === null &&
      (await s.pairing('__proto__')) === null &&
      (await s.pairing(undefined)) === null
  );
  ok(
    'a reopened store has the same list',
    (await keyStore(b).pairings()).map(p => p.id).join() === 'pc-a,pc-b,pc-d'
  );
}

// 3b. A confirmed scan replaces an entry that was only introduced; nothing replaces a scanned one.
{
  const s = keyStore(memory()),
    real = rnd(32),
    fake = rnd(32);
  await s.add({ id: 'pc-a', pub: rnd(32), pairingId: rnd(16) });
  await s.add({
    id: 'pc-b',
    pub: fake,
    pairingId: rnd(16),
    name: 'Studio PC',
    how: 'introduced',
    by: 'pc-a',
  });
  ok(
    'a second introduction of the same id or key is refused',
    (await throws(() =>
      s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-a' })
    )) &&
      (await throws(() =>
        s.add({ id: 'pc-z', pub: fake, pairingId: rnd(16), how: 'introduced', by: 'pc-a' })
      ))
  );
  await s.add({ id: 'pc-b', pub: real, pairingId: rnd(16), name: 'Studio PC' });
  const b = await s.pairing('pc-b');
  ok(
    'a scan replaces the introduced entry with the scanned key',
    hex(b.pub) === hex(real) &&
      b.how === 'scan' &&
      b.by === null &&
      (await s.pairings()).length === 2
  );
  ok(
    'a scanned entry is replaced by nothing',
    (await throws(() => s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16) }))) &&
      (await throws(() =>
        s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-a' })
      )) &&
      hex((await s.pairing('pc-b')).pub) === hex(real)
  );
  await s.add({ id: 'pc-c', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-a' });
  ok(
    "a scan whose key is a scanned entry's is refused even when its id is only introduced",
    (await throws(() => s.add({ id: 'pc-c', pub: real, pairingId: rnd(16) }))) &&
      (await s.pairing('pc-c')).how === 'introduced'
  );
}

// 4. Notes.
{
  const s = keyStore(memory()),
    v = { paused: ['pc-a'], n: 1 };
  await s.setNote('trust', v);
  v.paused.push('x');
  const read = await s.note('trust');
  read.n = 9;
  ok(
    'notes are copied in and out',
    JSON.stringify(await s.note('trust')) === '{"paused":["pc-a"],"n":1}'
  );
  ok(
    'a missing note is undefined and an unsafe name is refused',
    (await s.note('none')) === undefined &&
      (await s.note('__proto__')) === undefined &&
      (await throws(() => s.setNote('__proto__', 1)))
  );
}

// 5. From the security review of the code (findings 5 and 8): two open copies of the app, and loose
// input.
{
  const b = memory(),
    tab1 = keyStore(b),
    tab2 = keyStore(b);
  const [k1, k2] = await Promise.all([tab1.identity(), tab2.identity()]);
  ok(
    'two copies of the app starting at once end up with one key',
    hex(k1.pub) === hex(k2.pub) && hex(k1.pub) === hex(b.m.get('identity').pub)
  );
  await Promise.all([
    tab1.add({ id: 'pc-a', pub: rnd(32), pairingId: rnd(16) }),
    tab2.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16) }),
  ]);
  ok('and two additions at once from them both land', (await tab1.pairings()).length === 2);
  const same = rnd(32),
    both = await Promise.allSettled([
      tab1.add({ id: 'pc-c', pub: same, pairingId: rnd(16) }),
      tab2.add({ id: 'pc-d', pub: same, pairingId: rnd(16) }),
    ]);
  ok(
    'the same key added twice at once is stored once',
    both.filter(r => r.status === 'fulfilled').length === 1 && (await tab1.pairings()).length === 3
  );
  ok(
    'a time that is not a number and a scan that names an introducer are refused',
    (await throws(() => tab1.add({ id: 'pc-e', pub: rnd(32), pairingId: rnd(16), since: {} }))) &&
      (await throws(() => tab1.add({ id: 'pc-e', pub: rnd(32), pairingId: rnd(16), by: {} }))) &&
      (await throws(() =>
        tab1.add({ id: 'pc-e', pub: rnd(32), pairingId: rnd(16), by: '__proto__' })
      )) &&
      (await throws(() =>
        tab1.add({
          id: 'pc-e',
          pub: rnd(32),
          pairingId: rnd(16),
          how: 'introduced',
          by: 'x'.repeat(65),
        })
      ))
  );

  // Scanning the very same computer again repairs a pairing whose last message was lost; another
  // key under that id is still refused.
  const pid2 = rnd(16);
  await tab1.add({ id: 'pc-c', pub: same, pairingId: pid2, name: 'Again' });
  ok(
    'scanning the same computer again replaces its entry',
    hex((await tab1.pairing('pc-c')).pairingId) === hex(pid2) &&
      (await tab1.pairings()).length === 3 &&
      (await throws(() => tab1.add({ id: 'pc-c', pub: rnd(32), pairingId: rnd(16) })))
  );
  b.m.get('pairings').push({ id: 'broken' }, null, 'text');
  ok(
    'an entry that is not whole is left out and breaks nothing',
    (await tab1.pairings()).length === 3 && (await tab1.pairing('broken')) === null
  );
  await tab1.add({ id: 'pc-f', pub: rnd(32), pairingId: rnd(16) });
  ok('and adding still works beside it', (await tab1.pairings()).length === 4);
  await tab1.setNote('trust', { a: 1 });
  await tab1.setNote('trust', undefined);
  ok('setting a note to undefined removes it', (await tab1.note('trust')) === undefined);
  await tab1.renewIdentity();
  ok(
    'a renewed key starts with no pairings, so pairing again is not blocked',
    hex((await tab1.identity()).pub) !== hex(k1.pub) && (await tab1.pairings()).length === 0
  );
  const stuck = keyStore({ get: async () => undefined, update: () => new Promise(() => {}) });
  stuck.add({ id: 'pc-a', pub: rnd(32), pairingId: rnd(16) });
  ok(
    'a change the store never finishes does not block reading',
    (await Promise.race([
      stuck.pairings(),
      new Promise(r => setTimeout(() => r('blocked'), 50)),
    ])) !== 'blocked'
  );
}

// Review 6 (2026-10-05). Forget is whole; an introduction needs its introducer in the same
// read-and-write; add says what it replaced.
{
  const s = keyStore(memory()),
    pubA = rnd(32),
    pidA = rnd(16);
  await s.add({ id: 'pc-a', pub: pubA, pairingId: pidA, name: 'Desktop' });
  await s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-a' });
  await s.add({ id: 'pc-c', pub: rnd(32), pairingId: rnd(16) });
  await s.add({ id: 'pc-d', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-c' });
  ok(
    'review 6: an introduction by a computer that is not stored is refused',
    await throws(() =>
      s.add({ id: 'pc-x', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-gone' })
    )
  );
  ok(
    'review 6: an introduction by a computer that is itself only introduced is refused',
    await throws(() =>
      s.add({ id: 'pc-x', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-b' })
    )
  );
  const replaced = await s.add({
    id: 'pc-a',
    pub: pubA,
    pairingId: rnd(16),
    name: 'Desktop again',
  });
  ok(
    'review 6: add resolves with the entry it replaced',
    replaced.length === 1 &&
      replaced[0].id === 'pc-a' &&
      hex(replaced[0].pairingId) === hex(pidA) &&
      replaced[0].name === 'Desktop',
    JSON.stringify(replaced.map(p => p.id))
  );
  ok(
    'review 6: a new entry replaced nothing',
    (await s.add({ id: 'pc-e', pub: rnd(32), pairingId: rnd(16) })).length === 0
  );
  ok(
    'review 6: forgetting a computer takes the ones it introduced, and only those',
    (await s.remove('pc-a')) === true &&
      (await s.pairings())
        .map(p => p.id)
        .sort()
        .join() === 'pc-c,pc-d,pc-e',
    (await s.pairings()).map(p => p.id).join()
  );

  // The race the reviewer ran: an introduction on its way in while its introducer is forgotten.
  // Whichever order the store sees, no orphan stays.
  const [added] = await Promise.all([
    s.add({ id: 'pc-f', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-c' }).then(
      () => true,
      () => false
    ),
    s.remove('pc-c'),
  ]);
  ok(
    'review 6: an introduction racing the Forget of its introducer leaves no orphan',
    (await s.pairings()).map(p => p.id).join() === 'pc-e',
    added + ' ' + (await s.pairings()).map(p => p.id).join()
  );
  const { steady } = await import('../phone/src/keys.mjs'),
    t1 = steady(),
    realNow = Date.now;
  Date.now = () => realNow() + 90000;
  const t2 = steady();
  Date.now = () => realNow() - 3600000;
  const t3 = steady();
  Date.now = realNow;
  ok(
    'review 6: the wait clock follows the time of day forward (a sleeping phone) and is never turned back',
    t2 - t1 >= 89990 && t3 >= t2,
    [t1, t2, t3].join()
  );
}

// Review 7 (2026-10-05). Taking an add back is one step and only undoes its own entry; a note made
// once.
{
  const s = keyStore(memory()),
    pubA = rnd(32),
    pidOld = rnd(16),
    pidNew = rnd(16);
  await s.add({ id: 'pc-a', pub: pubA, pairingId: pidOld, name: 'Desktop', since: 5 });
  const replaced = await s.add({ id: 'pc-a', pub: pubA, pairingId: pidNew, name: 'Desktop' });
  ok(
    'review 7: take-back puts the replaced pairing back',
    (await s.takeBack('pc-a', pidNew, replaced)) === true &&
      hex((await s.pairing('pc-a')).pairingId) === hex(pidOld) &&
      (await s.pairing('pc-a')).since === 5
  );
  ok(
    'review 7: a second take-back finds nothing of its own and changes nothing',
    (await s.takeBack('pc-a', pidNew, replaced)) === false &&
      hex((await s.pairing('pc-a')).pairingId) === hex(pidOld)
  );
  const again = await s.add({ id: 'pc-a', pub: pubA, pairingId: pidNew, name: 'Desktop' });
  await s.remove('pc-a'); // the user forgets the computer between the write and the take-back
  ok(
    'review 7: after a Forget in between, take-back brings nothing back',
    (await s.takeBack('pc-a', pidNew, again)) === false && (await s.pairings()).length === 0
  );
  await s.add({ id: 'pc-a', pub: pubA, pairingId: pidOld });
  await s.add({ id: 'pc-b', pub: rnd(32), pairingId: rnd(16), how: 'introduced', by: 'pc-a' });
  const overIntro = await s.add({ id: 'pc-b', pub: rnd(32), pairingId: pidNew });
  ok(
    'review 8: a scan over an introduced entry, taken back, puts no introduced entry back (its introducer sends it again)',
    (await s.takeBack('pc-b', pidNew, overIntro)) === true &&
      (await s.pairing('pc-b')) === null &&
      (await s.pairings()).length === 1
  );
  const first = await s.add({ id: 'pc-c', pub: rnd(32), pairingId: pidNew });
  ok(
    'review 7: a first scan taken back leaves nothing of it',
    (await s.takeBack('pc-c', pidNew, first)) === true && (await s.pairing('pc-c')) === null
  );
  const [x, y] = await Promise.all([
    s.noteOnce('device', 'ph-one'),
    s.noteOnce('device', 'ph-two'),
  ]);
  ok(
    'review 7: a note made once is the same for two copies starting together',
    x === y && (await s.note('device')) === x && (await s.noteOnce('device', 'ph-three')) === x,
    x + ' ' + y
  );
}

console.log(failed ? failed + ' FAILED, ' + passed + ' passed' : 'all ' + passed + ' passed');
process.exit(failed ? 1 : 0);
