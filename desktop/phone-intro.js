// Technically Not · phone-intro.js — introducing a phone to the user's other computers.
// Computer A is paired with a phone and with computer B.
// With B's switch "Let A add my phones" on, A's word is enough for B to take the phone, capped at
// what A itself may do on B. This file is B's side (the switch, the added phones, what they may do)
// and A's side (making the two messages). The phone's side is phone/src/intro.mjs;
// tools/phone-intro-test.mjs runs them together. Pure Node, nothing sends anything and nothing is
// wired into the app: the caller carries messages over the encrypted sessions. Rules this file
// keeps (each a finding of a security review, protocol sections 11 to 14):
//  - switch off (the default): an introduction is ignored and shows nothing;
// - what an added phone may do is worked out from A's rights at the moment of asking, never stored,
// and never more than see and answer; A paused means its phones are paused; A ended or the switch
// turned off deletes them;
// - the switch and every added phone belong to A's KEY, not only its id: when A is no longer paired
// here, or is paired again with another key, they are gone the next time anything here is asked,
// whether or not the caller said so;
// - one device, one entry: an introduction naming a device id or key this computer already holds is
// refused, and an added phone whose id or key this computer later pairs itself gives way to that
// pairing by itself;
// - Remove is remembered, in a list that cannot grow without end; at most three phones per
// introducing computer;
// - an introduction is never passed on: only a phone this computer paired by scan can be introduced
// by it. Callers' rules, not checkable here: the switch, Remove and "Introduce" are set only at
// this computer's own keyboard; the caller sends a phone a fresh list whenever its introducer's
// rights or text switch change (use phonesOf); A keeps the random value of each introduction
// (makeIntroduction returns it) and resends that same one.
const crypto = require('crypto');
const noise = require('./remote-noise.js');
const { clean, safeId } = require('./remote-keys.js');

const NOTE = 'phone-intro';
const PER_INTRODUCER = 3; // added phones per introducing computer

// remembered removals per introducing computer; full = that computer's switch goes off
const REMOVED_MAX = 20;
const b64 = b => b.toString('base64');
const bytes = (s, len) => {
  if (typeof s !== 'string' || s.length > 128) return null;
  const b = Buffer.from(s, 'base64');
  return b.length === len ? b : null;
};

// A device id from another computer: usable as a key, and plain (no spaces, line breaks, control or
// direction characters).
const plainId = id => safeId(id) && id === clean(id, 64) && !/\s/.test(id);
const key32 = b => Buffer.isBuffer(b) && b.length === 32;

// The pairing id of an introduced phone and a computer: both work it out from the same fields, so
// no extra message is needed.
const introId = (idA, idB, idP, pubB, pubP, nonce) =>
  noise.sha256(noise.fields('tnai-intro-v1', idA, idB, idP, pubB, pubP, nonce)).subarray(0, 16);

// A's side. phone = an entry this computer holds for a phone it paired BY SCAN ({ id, pub, name,
// kind: 'phone', how: 'scan' }), to = a paired computer ({ id, pub, name, kind: 'computer' }).
// nonce = the value of an earlier introduction of this phone to this computer, when resending.
// Returns the message for that computer, the one for the phone, and the value to keep for resends.
function makeIntroduction({ phone, to, nonce = null, random = crypto.randomBytes }) {
  if (!phone || !plainId(phone.id) || !key32(phone.pub) || phone.kind !== 'phone')
    throw new Error('phone-intro: bad phone');
  if (!Object.hasOwn(phone, 'how') || phone.how !== 'scan')
    throw new Error('phone-intro: only a phone paired by scan here can be introduced');
  if (!to || !plainId(to.id) || !key32(to.pub) || to.kind !== 'computer' || to.id === phone.id)
    throw new Error('phone-intro: bad computer');
  if (nonce !== null && !key32(nonce)) throw new Error('phone-intro: bad value');
  const value = nonce || random(32),
    n = b64(value);
  return {
    toComputer: {
      t: 'introduce',
      id: phone.id,
      pub: b64(phone.pub),
      name: clean(phone.name, 60),
      nonce: n,
    },
    toPhone: { t: 'introduced', id: to.id, pub: b64(to.pub), name: clean(to.name, 60), nonce: n },
    nonce: Buffer.from(value),
  };
}

// B's side. deps:
//   self: { id, pub }                 this computer
//   note(name), setNote(name, value)  kept across restarts (the key store's notes)
// paired(id) → entry or null any device this computer paired itself, by device id: { id, pub, kind:
// 'computer' | 'phone' } pairedKey(pub) → entry or null the same, by public key rightsOf(id) → {
// see, answer, prompt, control, text } or null what that paired computer may do here NOW; null =
// paused or gone
function introductions({ self, note, setNote, paired, pairedKey, rightsOf, now = Date.now }) {
  if (!self || !safeId(self.id) || !key32(self.pub))
    throw new Error('phone-intro: bad own identity');
  const out = p => ({
    id: p.id,
    pub: Buffer.from(p.pub, 'base64'),
    pairingId: Buffer.from(p.pid, 'base64'),
    name: p.name,
    by: p.by,
    since: p.since,
  });

  // Deletes every phone a computer added and forgets its removals; used when its switch goes off or
  // it is gone.
  const drop = (d, a) => {
    const gone = d.added.filter(p => p.by === a);
    d.added = d.added.filter(p => p.by !== a);
    d.removed = d.removed.filter(r => r.by !== a);
    d.allow = d.allow.filter(x => x.id !== a);
    return gone.map(out);
  };
  const computer = a => {
    const e = safeId(a) ? paired(a) : null;
    return e && e.kind === 'computer' && key32(e.pub) ? e : null;
  };

  // Reads the state and brings it in line with what is paired NOW, so nothing here depends on the
  // caller reporting every change: an introducer that is gone or has another key loses its switch
  // and its phones; an added phone whose id or key this computer has paired itself since is
  // deleted.
  const load = () => {
    const raw = note(NOTE);
    const d = {
      allow:
        raw && Array.isArray(raw.allow)
          ? raw.allow.filter(x => x && safeId(x.id) && typeof x.pub === 'string')
          : [],
      added:
        raw && Array.isArray(raw.added)
          ? raw.added.filter(
              p => p && safeId(p.id) && safeId(p.by) && bytes(p.pub, 32) && bytes(p.pid, 16)
            )
          : [],
      removed:
        raw && Array.isArray(raw.removed)
          ? raw.removed.filter(r => r && safeId(r.by) && typeof r.pub === 'string')
          : [],
    };
    const before = JSON.stringify(d);
    for (const x of [...d.allow]) {
      const e = computer(x.id);
      if (!e || b64(e.pub) !== x.pub) drop(d, x.id);
    }
    d.added = d.added.filter(
      p =>
        d.allow.some(x => x.id === p.by) &&
        !paired(p.id) &&
        !pairedKey(Buffer.from(p.pub, 'base64'))
    );
    d.removed = d.removed.filter(r => d.allow.some(x => x.id === r.by));
    if (JSON.stringify(d) !== before) setNote(NOTE, d);
    return d;
  };
  const save = d => setNote(NOTE, d);

  return {
    allowed: a => load().allow.some(x => x.id === a),
    // The switch "Let <a> add my phones", for a paired computer only. Off deletes the phones that
    // computer added (returned).
    setAllowed(a, on) {
      const e = computer(a);
      if (!e) throw new Error('phone-intro: not a paired computer');
      const d = load();
      if (on) {
        if (!d.allow.some(x => x.id === a)) {
          d.allow.push({ id: a, pub: b64(e.pub) });
          save(d);
        }
        return [];
      }
      const gone = drop(d, a);
      save(d);
      return gone;
    },
    // An `introduce` message that arrived over the encrypted session with the paired computer
    // `from`. { ignored } = nothing happens and nothing is shown; { refused: why } = shown on the
    // Devices page; { added } = stored.
    receive(msg, from) {
      const d = load(),
        a = safeId(from) ? rightsOf(from) : null;

      // off, paused, or allowed nothing itself
      if (!d.allow.some(x => x.id === from) || !a || a.see !== true) return { ignored: true };
      if (!msg || typeof msg !== 'object' || msg.t !== 'introduce') return { ignored: true };
      const pub = bytes(msg.pub, 32),
        nonce = bytes(msg.nonce, 32),
        id = msg.id;
      if (!pub || !nonce || !plainId(id) || id === self.id || id === from || pub.equals(self.pub))
        return { ignored: true };
      const p64 = b64(pub),
        pid = b64(introId(from, self.id, id, self.pub, pub, nonce));
      const mine = d.added.find(p => p.id === id && p.pub === p64 && p.by === from);
      if (mine) {
        // the introducer resends its introductions as state; a new random value means the phone
        // side started over
        if (mine.pid !== pid) {
          mine.pid = pid;
          save(d);
          return { added: out(mine), again: true, renewed: true };
        }
        return { added: out(mine), again: true };
      }

      // the user removed this phone before
      if (d.removed.some(r => r.pub === p64)) return { ignored: true };
      if (paired(id) || pairedKey(pub) || d.added.some(p => p.id === id || p.pub === p64))
        return { refused: 'known' };
      if (d.added.filter(p => p.by === from).length >= PER_INTRODUCER) return { refused: 'full' };
      const entry = { id, pub: p64, pid, name: clean(msg.name, 60), by: from, since: now() };
      d.added.push(entry);
      save(d);
      return { added: out(entry) };
    },
    phones: () => load().added.map(out),
    phonesOf: a =>
      load()
        .added.filter(p => p.by === a)
        .map(out),
    phone(id) {
      const p = safeId(id) ? load().added.find(x => x.id === id) : null;
      return p ? out(p) : null;
    },
    // What an added phone may do right now: what its introducer may do here right now, and at most
    // see and answer. null = nothing at all (unknown phone, or its introducer is paused, forgotten
    // or no longer allowed).
    rights(id) {
      const d = load(),
        p = safeId(id) ? d.added.find(x => x.id === id) : null;
      if (!p) return null;
      const a = rightsOf(p.by);
      if (!a || a.see !== true) return null;
      return {
        see: true,
        answer: a.answer === true,
        prompt: false,
        control: false,
        text: a.text === true,
      };
    },
    // Remove on the Devices page. Remembered, so the introducer's next resend does not bring the
    // phone back.
    remove(id) {
      const d = load(),
        p = safeId(id) ? d.added.find(x => x.id === id) : null;
      if (!p) return { removed: false };
      d.added = d.added.filter(x => x !== p);
      d.removed.push({ by: p.by, pub: p.pub });

      // A full list means this computer keeps sending phones the user removes: its switch goes off,
      // which also clears the list.
      const full = d.removed.filter(r => r.by === p.by).length >= REMOVED_MAX;
      if (full) drop(d, p.by);
      save(d);
      return { removed: true, switchedOff: full ? p.by : null };
    },
    // The introducing computer was forgotten here or is no longer a device of the account: its
    // phones go, its switch is off again. (load() does the same by itself once that computer is no
    // longer paired; this is for the caller that wants the list now.)
    introducerEnded(a) {
      const d = load(),
        gone = drop(d, a);
      save(d);
      return gone;
    },
    // A phone was paired here by scan and digits: any introduced entry with the same id or key
    // gives way to it. (load() does the same by itself once that phone is in the paired list.)
    scanned(id, pub) {
      const d = load(),
        p64 = b64(pub),
        before = d.added.length;
      d.added = d.added.filter(p => p.id !== id && p.pub !== p64);
      if (d.added.length !== before) save(d);
      return before - d.added.length;
    },
  };
}

module.exports = { makeIntroduction, introductions, introId, PER_INTRODUCER, REMOVED_MAX };
