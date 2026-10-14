// Technically Not · remote-keys.js — pairing two computers of one account and keeping their keys.
// Two parts, both pure Node so they run in tests as
// they run in the app:
// 1. pairing(): one run of the commit-then-reveal exchange and the two typed six-digit codes. It
// sends nothing itself: start() and receive() return the message to send, the link (remote-link.js)
// carries it as a `pair` envelope. One entry into pairing mode allows exactly one run: a repeated
// or out-of-order message from the other computer ends it.
// 2. keyStore(): this computer's long-term key and its list of paired computers, encrypted by a
// backend the app gives it (Electron safeStorage; a fake in tests). No usable backend means remote
// is unavailable, never a plain-text key. Nothing in this file may log a private key, a random
// value or a code.
const crypto = require('crypto');
const noise = require('./remote-noise.js');

const PAIR_MS = 2 * 60 * 1000; // pairing mode ends after two minutes
const LOCK_MS = 10 * 60 * 1000; // three wrong entries stop pairing for ten minutes
const TRIES = 3;
const b64 = b => b.toString('base64');
const bytes32 = s => {
  if (typeof s !== 'string' || s.length > 64) return null;
  const b = Buffer.from(s, 'base64');
  return b.length === 32 ? b : null;
};

// One line of plain text from another computer or for one: control characters, line separators,
// zero-width and direction-override characters removed (a name must not be able to read as
// something else), then clipped to n characters (whole ones: an emoji is never cut in half). Also
// removed: the soft hyphen, the Arabic letter mark, the Mongolian vowel separator, interlinear
// marks, variation selectors, tag characters and half surrogates. phone/src/keys.mjs carries a copy
// that must stay equal (tools/phone-keys-test.mjs compares them).
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffc\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]|\p{Cs}/gu;
const clean = (v, n) => {
  const t = String(v ?? '')
      .replace(INVISIBLE, ' ')
      .replace(/(\p{M}{2})\p{M}+/gu, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
    chars = Array.from(t);
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : t;
};

// A device id usable as a key and safe to show: 1 to 64 plain letters, digits, "_" or "-" (the app
// makes UUIDs), and not a built-in property name ("__proto__", "constructor"). Nothing else is
// accepted from the server's list or from another computer.
const safeId = id =>
  typeof id === 'string' &&
  /^[\w-]{1,64}$/.test(id) &&
  !/[^\x00-\x7f]/.test(id) &&
  !(id in Object.prototype);
const digits = n => String(n % 1000000).padStart(6, '0');

// Same time whether the digits match or not.
const sameDigits = (typed, code) => {
  const t = String(typed ?? '').replace(/\D/g, '');
  return t.length === 6 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(code));
};

// Wrong-entry lockouts outlive one run, so they are kept here per other computer (in memory: a
// restart of the app is the user's own act).
function pairingGuard(now = Date.now) {
  const until = new Map(),
    wrong = new Map();
  const lock = id => {
    const t = now() + LOCK_MS;
    until.set(id, t);
    return t;
  };
  return {
    lockedUntil: id => {
      const t = until.get(id) || 0;
      if (t <= now()) {
        until.delete(id);
        return 0;
      }
      return t;
    },
    lock,
    // Wrong entries count per other computer across runs, so cancelling and pressing Pair again
    // does not start the count over.
    miss(id) {
      const w = wrong.get(id),
        n = (w && now() - w.at < LOCK_MS ? w.n : 0) + 1;
      if (n >= TRIES) {
        wrong.delete(id);
        return { until: lock(id) };
      }
      wrong.set(id, { n, at: now() });
      return { left: TRIES - n };
    },
    clear: id => {
      wrong.delete(id);
    },
  };
}

// One run. role 'a' = the computer where the user pressed Pair next to the other one (peer = its
// device id); role 'b' = the computer put into "Pair a computer" (its peer is whoever commits
// first). self = { id, pub } with pub this computer's long-term public key. state: 'idle' → 'wait'
// (a message is expected) → 'enter' / 'show' (see below) → 'done' | 'ended'. A: start() → wait →
// show `code`, and enter `code2` → done. B: wait → enter `code` → done, showing `code2`. When done,
// result() gives { peer, pub, pairingId }: the caller stores it only after the first session under
// those keys worked.
function pairing({
  role,
  self,
  peer = null,
  guard = pairingGuard(),
  now = Date.now,
  random = crypto.randomBytes,
}) {
  if (role !== 'a' && role !== 'b') throw new Error('remote-keys: bad role');
  if (!self || typeof self.id !== 'string' || !Buffer.isBuffer(self.pub) || self.pub.length !== 32)
    throw new Error('remote-keys: bad own identity');
  if (role === 'a' && typeof peer !== 'string')
    throw new Error('remote-keys: no computer to pair with');
  const started = now(),
    nonce = random(32);
  let state = 'idle',
    reason = null,
    step = 0,
    commit = null,
    peerPub = null,
    h = null;
  const end = why => {
    state = 'ended';
    reason = why;
    h = null;
    return { ended: why };
  };
  const alive = () => {
    if (state === 'ended' || state === 'done') return false;
    if (now() - started > PAIR_MS) {
      end('expired');
      return false;
    }
    return true;
  };
  const commitOf = (idA, idB, pubA, na) =>
    noise.sha256(noise.fields('tnai-commit-v1', idA, idB, pubA, na));
  const derive = (idA, idB, pubA, pubB, na, nb) => {
    h = noise.sha256(noise.fields('tnai-pair-v1', idA, idB, pubA, pubB, na, nb));
  };
  const code = () => digits(h.readUInt32BE(0)),
    code2 = () => digits(h.readUInt32BE(4));

  function start() {
    if (role !== 'a' || state !== 'idle') throw new Error('remote-keys: start out of order');
    const locked = guard.lockedUntil(peer);
    if (locked) return { ...end('locked'), until: locked };
    state = 'wait';
    return { send: { t: 'commit', c: b64(commitOf(self.id, peer, self.pub, nonce)) } };
  }

  // A `pair` message from the device `from`. Returns { send } with the answer, {} when nothing is
  // to be sent, { ignored } for a message that is not part of this run (another device), or { ended
  // } when the run is over.
  function receive(msg, from) {
    if (!alive()) return { ended: reason || 'finished' };
    if (typeof from !== 'string' || from === self.id) return { ignored: true };
    if (peer !== null && from !== peer) return { ignored: true };

    // Before a valid commit arrived, B ignores anything else: another device of the account must
    // not be able to end pairing mode with one bad message.
    if (!msg || typeof msg !== 'object')
      return role === 'b' && step === 0 ? { ignored: true } : end('bad_message');
    if (role === 'b' && step === 0) {
      if (state === 'idle') state = 'wait';
      const c = msg.t === 'commit' ? bytes32(msg.c) : null;
      if (!c) return { ignored: true };
      const locked = guard.lockedUntil(from);
      if (locked) return { ...end('locked'), until: locked };
      peer = from;
      commit = c;
      step = 1;
      return { send: { t: 'reveal_b', pub: b64(self.pub), n: b64(nonce) } };
    }
    if (role === 'a' && step === 0 && state === 'wait') {
      const pub = msg.t === 'reveal_b' ? bytes32(msg.pub) : null,
        nb = msg.t === 'reveal_b' ? bytes32(msg.n) : null;
      if (!pub || !nb) return end('out_of_order');
      if (pub.equals(self.pub)) return end('own_key');
      peerPub = pub;
      derive(self.id, peer, self.pub, pub, nonce, nb);
      step = 1;
      state = 'show';
      return { send: { t: 'reveal_a', pub: b64(self.pub), n: b64(nonce) } };
    }
    if (role === 'b' && step === 1) {
      const pub = msg.t === 'reveal_a' ? bytes32(msg.pub) : null,
        na = msg.t === 'reveal_a' ? bytes32(msg.n) : null;
      if (!pub || !na) return end('out_of_order');
      if (pub.equals(self.pub)) return end('own_key');
      if (!crypto.timingSafeEqual(commitOf(peer, self.id, pub, na), commit))
        return end('commit_mismatch');
      peerPub = pub;
      derive(peer, self.id, pub, self.pub, na, nonce);
      step = 2;
      state = 'enter';
      return {};
    }

    // a repeated or unexpected step: this run is over, pairing again needs the user
    return end('out_of_order');
  }

  // The six digits the user typed at this computer's own keyboard. A enters code2 (shown by B), B
  // enters code (shown by A).
  function enter(typed) {
    if (!alive()) return { ended: reason || 'finished' };
    if (!(role === 'a' ? state === 'show' : state === 'enter'))
      throw new Error('remote-keys: enter out of order');
    if (sameDigits(typed, role === 'a' ? code2() : code())) {
      state = 'done';
      guard.clear(peer);
      return { ok: true };
    }
    const miss = guard.miss(peer);
    if (miss.until) return { ...end('locked'), until: miss.until };
    return { ok: false, left: miss.left };
  }
  return {
    start,
    receive,
    enter,
    cancel: () => {
      if (state !== 'ended') end('cancelled');
    },
    get state() {
      alive();
      return state;
    },
    get reason() {
      return reason;
    },
    get peer() {
      return peer;
    },
    // What this computer shows for the user to type into the other one: A its code from the reveal
    // on, B its second code only once the typed first code passed (a B under attack never shows
    // one).
    get shows() {
      if (!h || (!alive() && state !== 'done')) return null;
      return role === 'a' ? code() : state === 'done' ? code2() : null;
    },
    result: () =>
      state === 'done'
        ? { peer, pub: Buffer.from(peerPub), pairingId: Buffer.from(h.subarray(16, 32)) }
        : null,
  };
}

// This computer's long-term key and its paired computers. backend = { available(), encrypt(Buffer)
// → Buffer, decrypt(Buffer) → Buffer, read() → string | null, write(string) }. In the app: Electron
// safeStorage and one file in the settings folder; available() is false when safeStorage would fall
// back to plain text (Linux without a keyring), and remote then says why instead of working.
// Everything is kept as one encrypted blob, so neither the key nor who is paired can be read from
// the file.
function keyStore(backend) {
  let data = null;
  const usable = () => {
    try {
      return !!backend.available();
    } catch {
      return false;
    }
  };

  function load() {
    if (data) return data;
    if (!usable()) throw new Error('remote-keys: no secure key storage on this computer');
    const raw = backend.read();
    if (raw == null || raw === '') return (data = { priv: null, pairings: {}, notes: {} });
    let parsed;
    try {
      parsed = JSON.parse(
        backend.decrypt(Buffer.from(JSON.parse(raw).sealed, 'base64')).toString('utf8')
      );
    } catch {
      throw new Error('remote-keys: the key store cannot be read');
    } // never overwritten silently: the caller asks the user
    if (!parsed || typeof parsed !== 'object' || typeof parsed.pairings !== 'object')
      throw new Error('remote-keys: the key store cannot be read');
    return (data = {
      priv: parsed.priv || null,
      pairings: parsed.pairings || {},
      notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
    });
  }
  const save = () =>
    backend.write(
      JSON.stringify({
        v: 1,
        sealed: backend.encrypt(Buffer.from(JSON.stringify(data), 'utf8')).toString('base64'),
      })
    );
  return {
    available: usable,
    // Made the first time remote is turned on, then kept.
    identity() {
      const d = load();
      if (!d.priv) {
        d.priv = b64(noise.generateKeyPair().priv);
        try {
          save();
        } catch (e) {
          d.priv = null;
          throw e;
        }
      }
      const priv = Buffer.from(d.priv, 'base64');
      return { priv, pub: noise.publicFromPrivate(priv) };
    },
    pairings: () =>
      Object.entries(load().pairings).map(([id, p]) => ({
        id,
        name: p.name || '',
        pub: Buffer.from(p.pub, 'base64'),
        pairingId: Buffer.from(p.pid, 'base64'),
        since: p.since || 0,
      })),
    pairing(id) {
      const d = load(),
        p = safeId(id) && Object.hasOwn(d.pairings, id) ? d.pairings[id] : null;
      return p
        ? {
            id,
            name: p.name || '',
            pub: Buffer.from(p.pub, 'base64'),
            pairingId: Buffer.from(p.pid, 'base64'),
            since: p.since || 0,
          }
        : null;
    },
    // Called only after the first session under the new keys worked (section 4.8). The name comes
    // from that session, not from the relay.
    add({ id, pub, pairingId, name = '', since = Date.now() }) {
      if (
        !safeId(id) ||
        !Buffer.isBuffer(pub) ||
        pub.length !== 32 ||
        !Buffer.isBuffer(pairingId) ||
        pairingId.length !== 16
      )
        throw new Error('remote-keys: bad pairing');
      const ps = load().pairings,
        old = ps[id];
      ps[id] = { pub: b64(pub), pid: b64(pairingId), name: clean(name, 60), since };
      try {
        save();
      } catch (e) {
        if (old === undefined) delete ps[id];
        else ps[id] = old;
        throw e;
      } // memory changes only if the save worked
    },
    rename(id, name) {
      const d = load();
      if (safeId(id) && Object.hasOwn(d.pairings, id)) {
        const p = d.pairings[id],
          old = p.name;
        p.name = clean(name, 60);
        try {
          save();
        } catch (e) {
          p.name = old;
          throw e;
        }
      }
    },
    remove(id) {
      const d = load();
      if (safeId(id) && Object.hasOwn(d.pairings, id)) {
        const old = d.pairings[id];
        delete d.pairings[id];
        try {
          save();
        } catch (e) {
          d.pairings[id] = old;
          throw e;
        }
        return true;
      }
      return false;
    },
    // A new long-term key (after Stop remote everywhere, section 5.7): every old pairing is useless
    // from then on.
    renewIdentity() {
      const d = load(),
        old = d.priv;
      d.priv = b64(noise.generateKeyPair().priv);
      try {
        save();
      } catch (e) {
        d.priv = old;
        throw e;
      }
    },
    // Small state other remote files must keep across restarts (remote-trust.js: who has not
    // confirmed a Forget or Stop, what is paused), inside the same encrypted blob. Values are
    // copied, so a caller cannot change the store by accident.
    note(name) {
      const v = load().notes[name];
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    setNote(name, value) {
      const n = load().notes,
        had = Object.hasOwn(n, name),
        old = n[name];
      n[name] = JSON.parse(JSON.stringify(value));
      try {
        save();
      } catch (e) {
        if (had) n[name] = old;
        else delete n[name];
        throw e;
      }
    },
  };
}

module.exports = { pairing, pairingGuard, keyStore, clean, safeId, PAIR_MS, LOCK_MS, TRIES };
