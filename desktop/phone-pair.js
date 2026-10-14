// Technically Not · phone-pair.js — the computer's side of pairing a phone:
// the code the computer shows for the phone to scan, the
// proof that a `pair` message comes from whoever scanned it, one handshake, and the six digits the
// phone then shows and the user types here. The phone's side is phone/src/pair.mjs;
// tools/phone-pair-test.mjs runs the two against each other. Pure Node like remote-keys.js: it
// sends nothing itself, show() and receive() return what to send, the link carries it. Nothing is
// wired into the app yet. Rules this file keeps (each is a finding of a security review, protocol
// sections 11 to 13):
// - a message with a wrong proof is dropped and counts nothing; messages from any other device
// change nothing;
// - the phone always starts the handshake, so it has fixed its one-time key before it sees this
// computer's: the digits come out of both and neither side can try keys until the digits suit it;
// - one pending pairing whose digits never change: a second handshake or a repeated step from the
// phone ends the run;
// - the phone's key is held in memory only: result() is null until the digits were typed correctly
// AND the phone answered;
//  - nothing but a fixed "ready" mark is sent to the phone before the digits pass.
// For the caller: pass ONE guard for the whole app run (the ten-minute stop must outlive a run),
// and a clock that is not set back. Nothing here may log the code's secret, a key or the digits.
const crypto = require('crypto');
const noise = require('./remote-noise.js');
const { clean, safeId, PAIR_MS } = require('./remote-keys.js');

const V = '1';

// plain data, not a web link: only the phone app's own scanner reads it
const QR_PREFIX = 'TNAIPAIR1.';
const GUARD = 'phone'; // wrong digits are counted for phone pairing as a whole on this computer

// after the right digits, how long the phone has to answer before the run ends with nothing stored
const CONFIRM_MS = 30 * 1000;
const b64 = b => b.toString('base64');
const bytes = (s, len) => {
  if (typeof s !== 'string' || s.length > 8192) return null;
  const b = Buffer.from(s, 'base64');
  return (len == null ? b.length > 0 : b.length === len) ? b : null;
};
const digitsOf = hash => String(hash.readUInt32BE(0) % 1000000).padStart(6, '0');
const hmac = (key, ...parts) =>
  crypto
    .createHmac('sha256', key)
    .update(noise.fields(...parts))
    .digest();

// The reverse of noise.fields: the list of fields, or null when the bytes are not exactly such a
// list.
function unfields(buf) {
  const out = [];
  for (let at = 0; at < buf.length;) {
    if (at + 2 > buf.length) return null;
    const len = buf.readUInt16BE(at);
    at += 2;
    if (at + len > buf.length) return null;
    out.push(buf.subarray(at, at + len));
    at += len;
  }
  return out;
}

// One run. self = { id, priv, pub }: this computer's device id and long-term key. name = this
// computer's name, sent only at the end. guard = pairingGuard() from remote-keys.js, the same one
// for every run. state: 'idle' → show() → 'wait' (the code is on screen) → 'hs' (a phone proved it
// scanned) → 'enter' (type the phone's digits) → 'confirming' (right digits; waiting for the
// phone's answer) → 'done' | 'ended'. When done, result() gives { peer, pub, pairingId, name } for
// the caller to store. The default clock only goes forward (time since the app started), so a
// system time sync cannot end or stretch a run.
const steady = () => Number(process.hrtime.bigint() / 1000000n);
const same = (a, b) =>
  !!a &&
  !!b &&
  a.t === b.t &&
  a.pub === b.pub &&
  a.mac === b.mac &&
  a.m === b.m &&
  a.n === b.n &&
  a.c === b.c;

function phonePairing({ self, name = '', guard, now = steady, random = crypto.randomBytes }) {
  if (
    !self ||
    !safeId(self.id) ||
    !Buffer.isBuffer(self.priv) ||
    self.priv.length !== 32 ||
    !Buffer.isBuffer(self.pub) ||
    self.pub.length !== 32
  )
    throw new Error('phone-pair: bad own identity');
  if (!guard || typeof guard.miss !== 'function' || typeof guard.lockedUntil !== 'function')
    throw new Error('phone-pair: a shared guard is needed');
  let state = 'idle',
    reason = null,
    secret = null,
    since = 0,
    lastNow = 0;
  let peer = null,
    peerPub = null,
    pid = null,
    hs = null,
    keys = null,
    code = null,
    sendN = 0,
    peerName = '';

  // A link may deliver a message twice (after a reconnect) or the phone's two first messages in the
  // other order. Neither may break a run: an exact repeat of a message already taken is ignored,
  // and a first handshake message that comes before its proof waits.
  const taken = [],
    early = new Map();
  const end = why => {
    state = 'ended';
    reason = why;
    secret = null;
    hs = null;
    keys = null;
    code = null;
    early.clear();
    return { ended: why };
  };

  // Each step has its own clock from `since`: two minutes to scan, two minutes from the scan to the
  // digits, 30 s for the phone's answer.
  const alive = () => {
    if (state === 'idle' || state === 'ended' || state === 'done') return false;

    // a caller's clock that steps back counts as standing still, never as time regained
    const t = Math.max(now(), lastNow);
    lastNow = t;
    if (t - since > (state === 'confirming' ? CONFIRM_MS : PAIR_MS)) {
      end(state === 'confirming' ? 'no_answer' : 'expired');
      return false;
    }
    return true;
  };
  const ad = (from, to) => noise.fields(V, from, to, pid);
  const sealMsg = plain => ({
    t: 'm',
    n: sendN,
    c: b64(noise.seal(keys.send, sendN++, ad(self.id, peer), noise.pad(plain))),
  });
  const openMsg = (msg, n) => {
    const c = msg.t === 'm' && msg.n === n ? bytes(msg.c) : null,
      p = c && noise.open(keys.recv, n, ad(peer, self.id), c);
    return p ? noise.unpad(p) : null;
  };

  // Puts the computer into phone pairing mode. Returns { qr } (the text of the code to draw), or {
  // ended: 'locked', until }.
  function show() {
    if (state !== 'idle') throw new Error('phone-pair: show out of order');
    const locked = guard.lockedUntil(GUARD);
    if (locked) return { ...end('locked'), until: locked };
    secret = random(32);
    since = lastNow = now();
    state = 'wait';
    return { qr: QR_PREFIX + noise.fields(V, self.id, self.pub, secret).toString('base64url') };
  }

  // A `pair` message from the device `from` (the id the relay stamped). Returns { send: [messages]
  // }, { ignored: true } for a message that is not part of this run, or { ended } when the run is
  // over.
  function receive(msg, from) {
    if (!alive()) return { ended: reason || (state === 'done' ? 'finished' : 'not_started') };
    if (!safeId(from) || from === self.id || !msg || typeof msg !== 'object')
      return { ignored: true };
    if (state === 'wait') {
      if (msg.t === 'hs1' && typeof msg.m === 'string' && msg.m.length <= 8192) {
        if (early.size < 4 || early.has(from)) early.set(from, { t: 'hs1', m: msg.m });
        return { ignored: true };
      }
      const pub = msg.t === 'phone' ? bytes(msg.pub, 32) : null,
        mac = msg.t === 'phone' ? bytes(msg.mac, 32) : null;
      if (!pub || !mac || pub.equals(self.pub)) return { ignored: true };

      // A wrong proof is dropped and changes nothing: anyone on the account can send one, so no
      // limit may move on it.
      if (
        !crypto.timingSafeEqual(
          hmac(secret, 'tnai-phone-pair-v1', self.id, from, self.pub, pub),
          mac
        )
      )
        return { ignored: true };
      peer = from;
      peerPub = pub;
      pid = hmac(secret, 'tnai-phone-pair-id-v1', self.id, from, self.pub, pub).subarray(0, 16);
      secret = null;
      since = now();
      state = 'hs'; // the code is dead from here on
      try {
        hs = noise.handshake({
          initiator: false,
          s: self.priv,
          rs: peerPub,
          prologue: noise.fields('tnai-phone-pair-v1', self.id, peer, pid),
        });
      } catch {
        return end('handshake');
      }
      taken.push({ t: 'phone', pub: msg.pub, mac: msg.mac });
      const held = early.get(peer);
      early.clear();

      // the phone starts the handshake; its first message may already be here
      return held ? receive(held, peer) : { send: [] };
    }

    // another device must not be able to end or disturb the pending pairing
    if (from !== peer) return { ignored: true };
    if (taken.some(m => same(m, msg))) return { ignored: true }; // delivered twice
    if (state === 'hs') {
      try {
        if (!keys) {
          const m = msg.t === 'hs1' ? bytes(msg.m) : null;
          if (!m) return end('out_of_order');

          // a bad key (all zero, low order) or a message that does not open throws: the run ends
          hs.read(m);
          const send = [{ t: 'hs2', m: b64(hs.write()) }];
          keys = hs.split();
          hs = null;
          code = digitsOf(keys.hash);
          taken.push({ t: 'hs1', m: msg.m });
          send.push(sealMsg(Buffer.from('ready')));
          return { send };
        }
        const p = openMsg(msg, 0);
        if (!p || p.toString() !== 'ready') return end('out_of_order');
        taken.push({ t: 'm', n: msg.n, c: msg.c });
        state = 'enter';
        return { send: [] };
      } catch {
        return end('handshake');
      }
    }
    if (state === 'confirming') {
      // the one thing still expected: the phone's name, which is also its answer
      const p = openMsg(msg, 1),
        f = p && unfields(p);
      if (!f || f.length !== 2 || f[0].toString() !== 'name') return { ignored: true };
      peerName = clean(f[1].toString('utf8'), 60);
      keys = null;
      state = 'done';
      return { send: [] };
    }

    // 'enter': anything more from the phone before the digits were typed ends the run
    return end('out_of_order');
  }

  // The six digits the user typed at this computer's own keyboard, read from the phone's screen.
  function enter(typed) {
    if (!alive()) return { ended: reason || 'not_started' };

    // nothing to type yet, or the right digits were already typed (a double press)
    if (state !== 'enter') return { ok: false, notNow: true };
    const t = String(typed ?? '').replace(/\D/g, '');
    if (t.length !== 6) return { ok: false, invalid: true }; // not an entry yet: costs no try
    if (crypto.timingSafeEqual(Buffer.from(t), Buffer.from(code))) {
      state = 'confirming';
      since = now();
      code = null;
      guard.clear(GUARD);
      return { ok: true, send: [sealMsg(noise.fields('confirmed', clean(name, 60)))] };
    }
    const miss = guard.miss(GUARD);
    if (miss.until) return { ...end('locked'), until: miss.until };
    return { ok: false, left: miss.left };
  }

  return {
    show,
    receive,
    enter,
    cancel: () => {
      if (state !== 'ended' && state !== 'done') end('cancelled');
    }, // the dialog closed
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
    result: () =>
      state === 'done'
        ? { peer, pub: Buffer.from(peerPub), pairingId: Buffer.from(pid), name: peerName }
        : null,
  };
}

module.exports = { phonePairing, unfields, QR_PREFIX, CONFIRM_MS };
