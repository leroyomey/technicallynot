// Test of desktop/remote-keys.js: node tools/remote-keys-test.js (plain Node; also run it in
// Electron's Node like remote-noise-test.js). Pairing must give both computers the same codes and
// pairing id, refuse a key swapped on the way, and allow one run per entry into pairing mode.
// The key store must never write a key in plain text.
const crypto = require('crypto');
const noise = require('../desktop/remote-noise.js');
const keys = require('../desktop/remote-keys.js');

let passed = 0,
  failed = 0;

function check(name, ok) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}
const throws = fn => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};
const A = { id: 'dev-a', ...noise.generateKeyPair() },
  B = { id: 'dev-b', ...noise.generateKeyPair() },
  X = { id: 'dev-x', ...noise.generateKeyPair() };
const me = k => ({ id: k.id, pub: k.pub });
const pair = (opts = {}) => [
  keys.pairing({ role: 'a', self: me(A), peer: B.id, ...opts.a }),
  keys.pairing({ role: 'b', self: me(B), ...opts.b }),
];

// Carries the three messages from A to B and back; `tamper` may change a message on the way (the
// relay in the middle).
function exchange(a, b, tamper = m => m) {
  const m1 = a.start().send,
    r1 = b.receive(tamper(m1, 1), A.id);
  if (!r1.send) return r1;
  const r2 = a.receive(tamper(r1.send, 2), B.id);
  if (!r2.send) return r2;
  return b.receive(tamper(r2.send, 3), A.id);
}

// ---- an honest run ----
{
  const [a, b] = pair();
  check(
    'before start: A shows nothing, B waits',
    a.state === 'idle' && a.shows === null && b.shows === null
  );
  exchange(a, b);
  check(
    'after the exchange: A shows six digits, B asks for them and shows nothing',
    /^\d{6}$/.test(a.shows) && a.state === 'show' && b.state === 'enter' && b.shows === null
  );
  check('no result before the codes are typed', a.result() === null && b.result() === null);
  const code = a.shows;
  check(
    'B: a wrong entry is refused with two tries left',
    b.enter(code === '000000' ? '000001' : '000000').left === 2 && b.state === 'enter'
  );
  check(
    'B: the digits A shows are accepted (spaces allowed)',
    b.enter(code.slice(0, 3) + ' ' + code.slice(3)).ok === true && b.state === 'done'
  );
  check('B shows the second code only now', /^\d{6}$/.test(b.shows));
  check('A: the second code is accepted', a.enter(b.shows).ok === true && a.state === 'done');
  const ra = a.result(),
    rb = b.result();
  check(
    "both hold the same pairing id (16 bytes) and each the other's key",
    ra.pairingId.equals(rb.pairingId) &&
      ra.pairingId.length === 16 &&
      ra.pub.equals(B.pub) &&
      rb.pub.equals(A.pub) &&
      ra.peer === B.id &&
      rb.peer === A.id
  );

  // The result feeds the session handshake: both sides agree on keys.
  const prologue = id => noise.fields('1', A.id, B.id, id);
  const ha = noise.handshake({
      initiator: true,
      s: A.priv,
      rs: ra.pub,
      prologue: prologue(ra.pairingId),
    }),
    hb = noise.handshake({
      initiator: false,
      s: B.priv,
      rs: rb.pub,
      prologue: prologue(rb.pairingId),
    });
  hb.read(ha.write());
  ha.read(hb.write());
  check(
    'a session handshake under the paired keys succeeds',
    ha.split().send.equals(hb.split().recv)
  );
  const [a2, b2] = pair();
  exchange(a2, b2);
  check(
    'a second pairing gives another pairing id',
    b2.enter(a2.shows).ok && a2.enter(b2.shows).ok && !a2.result().pairingId.equals(ra.pairingId)
  );
}

// ---- a relay in the middle that swaps in its own key ----
{
  const [a, b] = pair();

  // Toward B the relay must commit for A before it has seen B's random value; here it simply
  // replaces A's reveal.
  const end = exchange(a, b, (m, i) => (i === 3 ? { ...m, pub: X.pub.toString('base64') } : m));
  check(
    "a swapped key in A's reveal does not match the commit: B ends",
    end.ended === 'commit_mismatch' && b.state === 'ended' && b.shows === null
  );
  const [a3, b3] = pair();

  // B's key swapped toward A
  exchange(a3, b3, (m, i) => (i === 2 ? { ...m, pub: X.pub.toString('base64') } : m));
  check(
    "a swapped key in B's reveal: the codes differ, so B refuses A's digits",
    b3.state === 'enter' && b3.enter(a3.shows).ok !== true
  );
  check(
    '…and B then shows no second code, so A never pairs',
    b3.shows === null && a3.result() === null
  );
  const [a4, b4] = pair();
  exchange(a4, b4, (m, i) =>
    i === 2 ? { ...m, n: crypto.randomBytes(32).toString('base64') } : m
  );
  check('a changed random value: the codes differ', b4.enter(a4.shows).ok !== true);
}

// ---- one run per entry into pairing mode ----
{
  const [a, b] = pair();
  const m1 = a.start().send;
  b.receive(m1, A.id);
  check(
    'B: a second commit ends the run',
    b.receive(m1, A.id).ended === 'out_of_order' && b.state === 'ended'
  );
  check('B: nothing is accepted after the end', b.receive(m1, A.id).ended === 'out_of_order');
  const [a2, b2] = pair();
  const r = b2.receive(a2.start().send, A.id).send;
  a2.receive(r, B.id);
  check(
    'A: a second reveal from B ends the run (no fresh random values)',
    a2.receive(r, B.id).ended === 'out_of_order' && a2.shows === null
  );
  const [a3] = pair();
  check(
    'A: a reveal before start is refused',
    a3.receive(
      {
        t: 'reveal_b',
        pub: B.pub.toString('base64'),
        n: crypto.randomBytes(32).toString('base64'),
      },
      B.id
    ).ended === 'out_of_order'
  );
  const [, b4] = pair();
  check(
    'B: before a commit, anything else is ignored and pairing mode stays',
    b4.receive(
      {
        t: 'reveal_a',
        pub: A.pub.toString('base64'),
        n: crypto.randomBytes(32).toString('base64'),
      },
      A.id
    ).ignored === true &&
      b4.receive(null, X.id).ignored === true &&
      b4.state !== 'ended'
  );
  const [a5, b5] = pair();
  const c5 = a5.start().send;
  b5.receive(c5, A.id);
  check(
    'a message from another device is ignored and ends nothing',
    b5.receive(c5, X.id).ignored === true &&
      a5.receive(c5, X.id).ignored === true &&
      b5.state === 'wait' &&
      a5.state === 'wait'
  );
  check(
    'a message naming this computer as sender is ignored',
    a5.receive(c5, A.id).ignored === true
  );
  const [, b6] = pair();
  check(
    'a malformed commit is ignored too, and a real one still works after it',
    b6.receive({ t: 'commit', c: 'short' }, X.id).ignored === true &&
      !!b6.receive(keys.pairing({ role: 'a', self: me(A), peer: B.id }).start().send, A.id).send
  );
  const [a7, b7] = pair();
  const rb = b7.receive(a7.start().send, A.id).send;
  check(
    'a computer never pairs with its own key reflected back',
    a7.receive({ ...rb, pub: A.pub.toString('base64') }, B.id).ended === 'own_key'
  );
  check(
    'start twice is refused',
    throws(() => {
      const [a8] = pair();
      a8.start();
      a8.start();
    })
  );
  check(
    'entering digits before the exchange is refused',
    throws(() => {
      const [a9] = pair();
      a9.start();
      a9.enter('123456');
    })
  );
  check(
    'bad role or identity is refused',
    throws(() => keys.pairing({ role: 'c', self: me(A) })) &&
      throws(() => keys.pairing({ role: 'a', self: me(A) })) &&
      throws(() => keys.pairing({ role: 'b', self: { id: 'x', pub: Buffer.alloc(31) } }))
  );
}

// ---- wrong entries, the ten-minute stop, the two-minute limit ----
{
  let t = 1000000;
  const now = () => t,
    guardA = keys.pairingGuard(now),
    guardB = keys.pairingGuard(now);
  const opts = { a: { now, guard: guardA }, b: { now, guard: guardB } };
  const [a, b] = pair(opts);
  exchange(a, b);
  const wrong = a.shows === '111111' ? '222222' : '111111';
  b.enter(wrong);
  b.enter('12345'); // too short counts as wrong
  const third = b.enter(wrong);
  check(
    'B: three wrong entries end the run and stop pairing for ten minutes',
    third.ended === 'locked' &&
      third.until === t + keys.LOCK_MS &&
      b.state === 'ended' &&
      b.shows === null
  );
  const [a2, b2] = pair(opts);
  check(
    'B: a new run with that computer is refused while stopped',
    b2.receive(a2.start().send, A.id).ended === 'locked'
  );
  t += keys.LOCK_MS + 1;
  const [a3, b3] = pair(opts);
  exchange(a3, b3);
  check('B: after ten minutes pairing works again', b3.enter(a3.shows).ok === true);
  const w2 = b3.shows === '111111' ? '222222' : '111111';
  a3.enter(w2);
  a3.enter(w2);
  check(
    'A: three wrong second codes stop pairing on A too',
    a3.enter(w2).ended === 'locked' && a3.result() === null
  );
  const [a4] = pair(opts);
  check('A: start is refused while stopped', a4.start().ended === 'locked');
  t += keys.LOCK_MS + 1;
  const [a5, b5] = pair(opts);
  exchange(a5, b5);
  t += keys.PAIR_MS + 1;
  check(
    'pairing mode ends after two minutes: nothing shown, digits refused',
    a5.state === 'ended' &&
      a5.reason === 'expired' &&
      a5.shows === null &&
      b5.enter('000000').ended === 'expired'
  );
  const [a6, b6] = pair(opts);
  exchange(a6, b6);
  a6.cancel();
  check(
    'cancel ends the run',
    a6.state === 'ended' && a6.shows === null && a6.enter('000000').ended === 'cancelled'
  );
}

// ---- the key store ----
{
  // A stand-in for safeStorage: reversible, but the stored text holds nothing readable.
  const disk = { text: null, ok: true };
  const backend = {
    available: () => disk.ok,
    encrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
    decrypt: b => {
      const o = Buffer.from(b.map(x => x ^ 0x5a));
      if (o[0] !== 0x7b) throw new Error('bad');
      return o;
    },
    read: () => disk.text,
    write: s => {
      disk.text = s;
    },
  };
  const store = keys.keyStore(backend),
    id1 = store.identity();
  check(
    'identity: made once, 32-byte keys, public matches private',
    id1.priv.length === 32 && noise.publicFromPrivate(id1.priv).equals(id1.pub)
  );
  check(
    'identity: the same after a restart',
    keys.keyStore(backend).identity().priv.equals(id1.priv)
  );
  check(
    'the file never holds the private key in readable form',
    !disk.text.includes(id1.priv.toString('base64')) &&
      !disk.text.includes(id1.priv.toString('hex'))
  );
  const pid = crypto.randomBytes(16);
  store.add({ id: B.id, pub: B.pub, pairingId: pid, name: 'Laptop' });
  const again = keys.keyStore(backend),
    p = again.pairing(B.id);
  check(
    'a pairing is kept across a restart',
    p &&
      p.pub.equals(B.pub) &&
      p.pairingId.equals(pid) &&
      p.name === 'Laptop' &&
      again.pairings().length === 1
  );
  check(
    'the file names neither the paired computer nor its key',
    !disk.text.includes(B.id) &&
      !disk.text.includes('Laptop') &&
      !disk.text.includes(B.pub.toString('base64'))
  );
  check(
    'a bad pairing is refused',
    throws(() => store.add({ id: 'x', pub: Buffer.alloc(31), pairingId: pid })) &&
      throws(() => store.add({ id: 'x', pub: B.pub, pairingId: Buffer.alloc(8) }))
  );
  again.rename(B.id, 'Work laptop');
  check(
    'rename and remove',
    keys.keyStore(backend).pairing(B.id).name === 'Work laptop' &&
      again.remove(B.id) === true &&
      again.remove(B.id) === false &&
      keys.keyStore(backend).pairings().length === 0
  );
  check(
    'the identity survives forgetting a computer',
    keys.keyStore(backend).identity().priv.equals(id1.priv)
  );
  const kept = disk.text;
  disk.text = JSON.stringify({ v: 1, sealed: Buffer.from('garbage').toString('base64') });
  check(
    'an unreadable store is reported, never replaced by a new key',
    throws(() => keys.keyStore(backend).identity()) &&
      disk.text !== kept &&
      !disk.text.includes('priv')
  );
  disk.text = kept;
  disk.ok = false;
  const none = keys.keyStore(backend);
  check(
    'no secure storage: unavailable, and no key is made or written',
    none.available() === false && throws(() => none.identity()) && disk.text === kept
  );
}

// A save that fails changes nothing in memory (and so nothing differs from the disk on the next
// read).
{
  const disk = { text: null, fail: false };
  const backend = {
    available: () => true,
    encrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
    decrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
    read: () => disk.text,
    write: s => {
      if (disk.fail) throw new Error('disk full');
      disk.text = s;
    },
  };
  const store = keys.keyStore(backend),
    id1 = store.identity(),
    pid = crypto.randomBytes(16);
  store.add({ id: B.id, pub: B.pub, pairingId: pid, name: 'Laptop' });
  store.setNote('n', { a: 1 });
  disk.fail = true;
  check(
    'a failed save: add, rename, remove, renew and setNote all throw',
    throws(() => store.add({ id: 'other', pub: B.pub, pairingId: pid })) &&
      throws(() => store.rename(B.id, 'X')) &&
      throws(() => store.remove(B.id)) &&
      throws(() => store.renewIdentity()) &&
      throws(() => store.setNote('n', { a: 2 })) &&
      throws(() => store.setNote('m', 1))
  );
  check(
    'a failed save: memory still equals the old state',
    store.pairings().length === 1 &&
      store.pairing(B.id).name === 'Laptop' &&
      store.pairing('other') === null &&
      store.identity().priv.equals(id1.priv) &&
      store.note('n').a === 1 &&
      store.note('m') === undefined
  );
  disk.fail = false;
  check(
    'and a restart reads the same',
    keys.keyStore(backend).pairings().length === 1 &&
      keys.keyStore(backend).pairing(B.id).name === 'Laptop' &&
      keys.keyStore(backend).identity().priv.equals(id1.priv)
  );
}

// Cleaning: more invisible characters go, and clipping never
// cuts a character in half.
{
  const hidden = 'a\u00adb\u061cc\u180ed\ufff9e\ufe0ff\u{e0041}g\u{e0100}h';
  check(
    'soft hyphen, letter mark, vowel separator, interlinear mark, variation selectors and tag characters are removed',
    keys.clean(hidden, 60) === 'a b c d e f g h'
  );
  check(
    'a half surrogate is removed',
    keys.clean('x\ud83dy', 60) === 'x y' && keys.clean('\udc00z', 60) === 'z'
  );
  const clipped = keys.clean('ab\u{1f600}cd', 4);
  check(
    'clipping keeps whole characters',
    clipped === 'ab\u{1f600}\u2026' && !/[\ud800-\udbff](?![\udc00-\udfff])/.test(clipped)
  );
  check(
    'plain names are unchanged',
    keys.clean('  Laptop \u00b7 Windows ', 60) === 'Laptop \u00b7 Windows' &&
      keys.clean('abcdef', 4) === 'abc\u2026' &&
      keys.clean('abcd', 4) === 'abcd'
  );
}

// Device ids and hidden characters (review fixes, 2026-10-05).
{
  check(
    'safeId accepts letters, digits, "_" and "-" and a UUID',
    keys.safeId('abc_DEF-123') &&
      keys.safeId(crypto.randomUUID()) &&
      keys.safeId('a') &&
      keys.safeId('a'.repeat(64))
  );
  check(
    'safeId refuses direction characters, non-ASCII letters, spaces, empty, 65 characters and "__proto__"',
    !keys.safeId('ab‮cd') &&
      !keys.safeId('café') &&
      !keys.safeId('аbc') &&
      !keys.safeId('a b') &&
      !keys.safeId('') &&
      !keys.safeId('a'.repeat(65)) &&
      !keys.safeId('__proto__') &&
      !keys.safeId('constructor') &&
      !keys.safeId(5) &&
      !keys.safeId(null)
  );
  const blanks = ['ㅤ', 'ﾠ', 'ᅟ', 'ᅠ', '⠀', '឴', '឵', '￼'];
  check(
    'blank-looking characters become a space',
    blanks.every(c => keys.clean('a' + c + 'b', 60) === 'a b'),
    blanks.map(c => keys.clean('a' + c + 'b', 60))
  );
  check('a name made only of blank-looking characters is empty', keys.clean('ㅤ⠀ﾠ', 60) === '');
  check(
    'more than two combining marks keep only two',
    keys.clean('a' + '́'.repeat(20), 60) === 'á́' &&
      keys.clean('á', 60) === 'á' &&
      keys.clean('á̂', 60) === 'á̂'
  );
}

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);
