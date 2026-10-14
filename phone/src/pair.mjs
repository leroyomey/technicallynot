// Technically Not phone app · pair.mjs — the phone's side of pairing with a computer:
// read the scanned code, prove to the computer that this
// phone scanned it, one handshake, then show the six digits the user types into the computer. The
// computer's side is desktop/phone-pair.js; tools/phone-pair-test.mjs runs the two against each
// other. It sends nothing itself: start() and receive() return what to send to the computer as
// `pair` messages. Rules this file keeps: the computer's key comes from the scanned code only,
// never from a message; the phone always starts the handshake (it fixes its one-time key before it
// sees the computer's, so neither side can pick the digits); messages from any other device and
// messages that do not open change nothing; the computer is stored (result()) only after it said
// the digits were typed correctly; the phone's own name is sent only then. Every step waits on the
// browser's crypto, and cancel() or the clock can end the run during such a wait, so the state is
// looked at again after each wait. Nothing here may log the code, a key or the digits.
import * as noise from './noise.mjs';
import { clean, safeId, steady } from './keys.mjs';

const S = globalThis.crypto.subtle;
const te = new TextEncoder(),
  td = new TextDecoder();
const V = '1';
export const QR_PREFIX = 'TNAIPAIR1.';
export const PAIR_MS = 2 * 60 * 1000; // the digits are shown for two minutes from the scan

// the computer's "confirmed" is still taken this long after that: its clock started a little later
export const GRACE_MS = 30 * 1000;

const b64 = b => btoa(String.fromCharCode(...b));
const bytes = (s, len) => {
  if (typeof s !== 'string' || s.length > 8192) return null;
  let b;
  try {
    b = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  } catch {
    return null;
  }
  return (len == null ? b.length > 0 : b.length === len) ? b : null;
};
const digitsOf = hash =>
  String(new DataView(hash.buffer, hash.byteOffset, 4).getUint32(0) % 1000000).padStart(6, '0');
const hmac = async (key, ...parts) =>
  new Uint8Array(
    await S.sign(
      'HMAC',
      await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
      noise.fields(...parts)
    )
  );

// The reverse of noise.fields: the list of fields, or null when the bytes are not exactly such a
// list.
export function unfields(buf) {
  const out = [];
  for (let at = 0; at < buf.length;) {
    if (at + 2 > buf.length) return null;
    const len = (buf[at] << 8) | buf[at + 1];
    at += 2;
    if (at + len > buf.length) return null;
    out.push(buf.subarray(at, at + len));
    at += len;
  }
  return out;
}

// The scanned text → { id, pub, secret } of the computer, or null when it is not a pairing code of
// this version.
export function readCode(text) {
  if (typeof text !== 'string' || !text.startsWith(QR_PREFIX) || text.length > 400) return null;
  const raw = bytes(text.slice(QR_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/')),
    f = raw && unfields(raw);
  if (!f || f.length !== 4 || td.decode(f[0]) !== V || f[2].length !== 32 || f[3].length !== 32)
    return null;
  const id = td.decode(f[1]);
  return safeId(id) ? { id, pub: Uint8Array.from(f[2]), secret: Uint8Array.from(f[3]) } : null;
}

// One run. self = { id, priv, pub }: this phone's device id and long-term key (keys.mjs
// identity()). name = this phone's name. state: 'idle' → start() → 'hs' → 'show' (the digits are on
// screen) → 'done' | 'ended'. When done, result() gives { peer, pub, pairingId, name } of the
// computer for the caller to store. store = the phone's key store (keys.mjs). With it, a run that
// could not be stored is refused before it starts, and the computer is stored BEFORE the phone's
// answer goes out: the computer keeps the phone only when it gets that answer, so the two cannot
// end up with the computer holding a phone that stored nothing. (The other way round, the answer
// lost on the way, is repaired by scanning that same computer again.) Without a store the caller
// must do both itself.
export function scanPairing({ self, name = '', code, store = null, now = steady }) {
  if (
    !self ||
    !safeId(self.id) ||
    !self.priv ||
    !(self.pub instanceof Uint8Array) ||
    self.pub.length !== 32
  )
    throw new Error('phone-pair: bad own identity');
  const pc = readCode(code);
  if (!pc) throw new Error('phone-pair: not a pairing code');
  if (pc.id === self.id || pc.pub.every((x, i) => x === self.pub[i]))
    throw new Error("phone-pair: this is the phone's own code");
  let state = 'idle',
    reason = null,
    startedAt = 0,
    pid = null,
    hs = null,
    keys = null,
    digits = null,
    sendN = 0,
    peerName = '';
  let queue = Promise.resolve(); // messages are handled one at a time, in the order they came
  const inTurn = fn => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const end = why => {
    state = 'ended';
    reason = why;
    hs = null;
    keys = null;
    digits = null;
    return { ended: why };
  };
  const alive = () => {
    if (state === 'idle' || state === 'ended' || state === 'done') return false;
    if (state === 'starting') return true;
    if (now() - startedAt > PAIR_MS + GRACE_MS) {
      end('expired');
      return false;
    }
    return true;
  };

  // After every wait: was the run ended meanwhile (cancel(), the clock)? Then nothing more happens
  // in this call.
  const over = () => (state === 'ended' ? { ended: reason } : null);
  const ad = (from, to) => noise.fields(V, from, to, pid);
  const sealWith = async (k, plain) => ({
    t: 'm',
    n: sendN,
    c: b64(await noise.seal(k.send, sendN++, ad(self.id, pc.id), noise.pad(plain))),
  });
  const openWith = async (k, msg, n) => {
    const c = msg.t === 'm' && msg.n === n ? bytes(msg.c) : null,
      p = c && (await noise.open(k.recv, n, ad(pc.id, self.id), c));
    return p ? noise.unpad(p) : null;
  };

  // Returns { to, send: [messages] }: the proof that this phone scanned the code, and the
  // handshake's first message.
  const start = () =>
    inTurn(async () => {
      if (over()) return over(); // cancelled before it began
      if (state !== 'idle') throw new Error('phone-pair: start out of order');
      state = 'starting';
      const secret = pc.secret;
      pc.secret = null;
      let mac, id16, h, m1;
      try {
        if (store) {
          // would the store take this computer at the end? If not, say so now, before the user
          // types anything.
          const known = (await store.pairings()).filter(
            p => p.id === pc.id || p.pub.every((x, i) => x === pc.pub[i])
          );
          const sameAgain =
            known.length === 1 &&
            known[0].id === pc.id &&
            known[0].pub.every((x, i) => x === pc.pub[i]);
          if (known.some(p => p.how !== 'introduced') && !sameAgain) {
            if (over()) return over();
            return end('already_paired');
          }
        }
        mac = await hmac(secret, 'tnai-phone-pair-v1', pc.id, self.id, pc.pub, self.pub);
        id16 = (
          await hmac(secret, 'tnai-phone-pair-id-v1', pc.id, self.id, pc.pub, self.pub)
        ).subarray(0, 16);
        h = await noise.handshake({
          initiator: true,
          s: self,
          rs: pc.pub,
          prologue: noise.fields('tnai-phone-pair-v1', pc.id, self.id, id16),
        });
        m1 = await h.write(); // a code holding a key that cannot be used fails here
      } catch {
        return over() || end('handshake');
      }
      if (over()) return over();
      pid = id16;
      hs = h;
      startedAt = now();
      state = 'hs';
      return {
        to: pc.id,
        send: [
          { t: 'phone', pub: b64(self.pub), mac: b64(mac) },
          { t: 'hs1', m: b64(m1) },
        ],
      };
    });

  // A `pair` message from the device `from`. Returns { send: [messages] }, { ignored: true } or {
  // ended }.
  const receive = (msg, from) =>
    inTurn(async () => {
      if (!alive()) return { ended: reason || (state === 'done' ? 'finished' : 'not_started') };
      if (from !== pc.id || !msg || typeof msg !== 'object') return { ignored: true };
      if (state === 'hs' && !keys) {
        const m = msg.t === 'hs2' ? bytes(msg.m) : null,
          h = hs;
        if (!m) return { ignored: true };
        try {
          await h.read(m);
        } catch {
          return over() || { ignored: true };
        } // a message that does not open changes nothing (noise.mjs puts the state back)
        const k = await h.split();
        if (over()) return over();
        const ready = await sealWith(k, te.encode('ready'));
        if (over()) return over();
        keys = k;
        hs = null;
        return { send: [ready] };
      }
      if (state === 'hs') {
        const p = await openWith(keys, msg, 0);
        if (over()) return over();
        if (!p || td.decode(p) !== 'ready') return { ignored: true };
        digits = digitsOf(keys.hash);
        state = 'show';
        return { send: [] };
      }
      if (state !== 'show') return { ignored: true };

      // 'show': the only message that counts is the computer saying the digits were typed
      // correctly, with its name.
      const k = keys,
        p = await openWith(k, msg, 1),
        f = p && unfields(p);
      if (over()) return over();
      if (!f || f.length !== 2 || td.decode(f[0]) !== 'confirmed') return { ignored: true };
      const theirName = clean(td.decode(f[1]), 60);
      const mine = await sealWith(k, noise.fields('name', clean(name, 60)));
      if (over()) return over();
      if (store) {
        // stored first, answered second
        let replaced;
        try {
          replaced = await store.add({ id: pc.id, pub: pc.pub, pairingId: pid, name: theirName });
        } catch {
          return over() || end('not_stored');
        }
        if (over()) {
          // ended while storing: take it back and send nothing. What it replaced (this same
          // computer, scanned before) goes back in. One step in the store (keys.mjs
          // takeBack): only if this run's entry is still the one stored.
          await store.takeBack(pc.id, pid, replaced || []).catch(() => {});
          return over();
        }
      }
      peerName = theirName;
      state = 'done';
      digits = null;
      keys = null;
      return { send: [mine] };
    });

  return {
    start,
    receive,
    cancel: () => {
      if (state !== 'ended' && state !== 'done') end('cancelled');
    },
    get state() {
      alive();
      return state;
    },
    get reason() {
      return reason;
    },
    get peer() {
      return pc.id;
    },
    // The six digits to type into the computer, for two minutes from the scan.
    get shows() {
      return alive() && state === 'show' && now() - startedAt <= PAIR_MS ? digits : null;
    },
    result: () =>
      state === 'done'
        ? {
            peer: pc.id,
            pub: Uint8Array.from(pc.pub),
            pairingId: Uint8Array.from(pid),
            name: peerName,
          }
        : null,
  };
}
