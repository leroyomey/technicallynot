// Technically Not phone app · noise.mjs — the same cryptography as desktop/remote-noise.js, for a
// phone browser (Web Crypto, no Node): the handshake Noise_KK_25519_AESGCM_SHA256, the sealed
// transport messages after it, length-prefixed fields and the padding to fixed size steps.
// It must stay byte-for-byte equal to the desktop file:
// tools/phone-noise-test.mjs runs both against each other; change nothing here or there without
// that test passing. Differences a browser forces: every function is async, bytes are Uint8Array,
// and a private key is a CryptoKey that cannot be exported (the phone never sees its own long-term
// key as bytes). Nothing here may log, store or return a key except to its caller.
const S = globalThis.crypto.subtle;
const te = new TextEncoder();

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const NAME = new Uint8Array(32);
NAME.set(te.encode('Noise_KK_25519_AESGCM_SHA256')); // 28 bytes, zero-padded to 32: the first hash
const PKCS8 = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20,
]); // X25519 private key, raw 32 bytes follow
const EMPTY = new Uint8Array(0);
const is32 = b => b instanceof Uint8Array && b.length === 32;

export const sha256 = async (...parts) => new Uint8Array(await S.digest('SHA-256', cat(...parts)));
const hmac = async (key, ...parts) =>
  new Uint8Array(
    await S.sign(
      'HMAC',
      await S.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
      cat(...parts)
    )
  );

// A key pair: { priv: CryptoKey that cannot be exported, pub: the raw 32 bytes }.
export async function generateKeyPair() {
  const pair = await S.generateKey({ name: 'X25519' }, false, ['deriveBits']);
  return { priv: pair.privateKey, pub: new Uint8Array(await S.exportKey('raw', pair.publicKey)) };
}

// From raw bytes (tests and the published test vector only; the app makes its keys with
// generateKeyPair and keeps the CryptoKey).
export async function importKeyPair(rawPriv, rawPub) {
  if (!is32(rawPriv) || !is32(rawPub)) throw new Error('phone-noise: bad key length');
  return {
    priv: await S.importKey('pkcs8', cat(PKCS8, rawPriv), { name: 'X25519' }, false, [
      'deriveBits',
    ]),
    pub: Uint8Array.from(rawPub),
  };
}

// Key agreement. An all-zero result (a low-order public key) ends the handshake; some browsers
// refuse such a key themselves.
async function dh(priv, pub) {
  if (!is32(pub)) throw new Error('phone-noise: bad key length');
  let out;
  try {
    out = new Uint8Array(
      await S.deriveBits(
        { name: 'X25519', public: await S.importKey('raw', pub, { name: 'X25519' }, false, []) },
        priv,
        256
      )
    );
  } catch {
    throw new Error('phone-noise: key agreement refused');
  }
  if (out.every(b => b === 0)) throw new Error('phone-noise: all-zero key agreement');
  return out;
}

// AES-256-GCM, nonce = 4 zero bytes + the counter as 8 bytes big-endian. Returns ciphertext +
// 16-byte tag, as the desktop does.
const nonceOf = n => {
  const b = new Uint8Array(12);
  new DataView(b.buffer).setBigUint64(4, BigInt(n));
  return b;
};
const aes = (key, use) => S.importKey('raw', key, 'AES-GCM', false, [use]);

// Strict on purpose: a 32-byte key only (a 16-byte one
// would silently be AES-128), a whole counter from 0 to 2^32 - 1 (the protocol's limit per session;
// -1 would wrap), and bytes for the associated data.
const sealArgs = (key, n, ad) =>
  is32(key) && Number.isInteger(n) && n >= 0 && n < 2 ** 32 && ad instanceof Uint8Array;

export async function seal(key, n, ad, plaintext) {
  if (!sealArgs(key, n, ad) || !(plaintext instanceof Uint8Array))
    throw new Error('phone-noise: bad seal input');
  return new Uint8Array(
    await S.encrypt(
      { name: 'AES-GCM', iv: nonceOf(n), additionalData: ad, tagLength: 128 },
      await aes(key, 'encrypt'),
      plaintext
    )
  );
}

// Returns the plaintext, or null when it does not decrypt (wrong key, counter, associated data, or
// a changed byte).
export async function open(key, n, ad, sealed) {
  if (!sealArgs(key, n, ad) || !(sealed instanceof Uint8Array) || sealed.length < 16) return null;
  try {
    return new Uint8Array(
      await S.decrypt(
        { name: 'AES-GCM', iv: nonceOf(n), additionalData: ad, tagLength: 128 },
        await aes(key, 'decrypt'),
        sealed
      )
    );
  } catch {
    return null;
  }
}

// One side of a KK handshake. s = own long-term key pair ({ priv, pub }), rs = the other device's
// long-term public key (raw), prologue = what both sides must agree on. e is given only by tests.
// Order as on the desktop: the starter writes message 1 and reads message 2, the answerer the
// reverse; then split() gives `send` and `recv`.
export async function handshake({ initiator, s, rs, prologue = EMPTY, e = null }) {
  if (!s || !is32(s.pub) || !is32(rs)) throw new Error('phone-noise: bad key length');
  let h = Uint8Array.from(NAME),
    ck = Uint8Array.from(NAME),
    k = null,
    n = 0,
    re = null,
    step = 0;
  const mixHash = async data => {
    h = await sha256(h, data);
  };
  const mixKey = async ikm => {
    const t = await hmac(ck, ikm);
    ck = await hmac(t, Uint8Array.of(1));
    k = await hmac(t, ck, Uint8Array.of(2));
    n = 0;
  };
  const encryptAndHash = async plain => {
    const out = k ? await seal(k, n++, h, plain) : Uint8Array.from(plain);
    await mixHash(out);
    return out;
  };
  const decryptAndHash = async data => {
    const out = k ? await open(k, n++, h, data) : Uint8Array.from(data);
    if (!out) throw new Error('phone-noise: handshake message does not decrypt');
    await mixHash(data);
    return out;
  };
  await mixHash(prologue);

  // pre-messages: the starter's long-term key, then the answerer's
  await mixHash(initiator ? s.pub : rs);
  await mixHash(initiator ? rs : s.pub);

  // Message 1 (starter → answerer): e, es, ss. Message 2 (answerer → starter): e, ee, se.
  async function write(payload = EMPTY) {
    if (step !== (initiator ? 0 : 1)) throw new Error('phone-noise: handshake out of order');
    step = -1; // a second call while this one runs is out of order too
    e = e || (await generateKeyPair());
    await mixHash(e.pub);
    if (initiator) {
      await mixKey(await dh(e.priv, rs));
      await mixKey(await dh(s.priv, rs));
    } else {
      await mixKey(await dh(e.priv, re));
      await mixKey(await dh(e.priv, rs));
    }
    const out = cat(e.pub, await encryptAndHash(payload));
    step = initiator ? 1 : 2;
    return out;
  }

  async function read(message) {
    if (step !== (initiator ? 1 : 0)) throw new Error('phone-noise: handshake out of order');
    if (!(message instanceof Uint8Array) || message.length < 32)
      throw new Error('phone-noise: handshake message too short');

    // A message that does not open must change nothing: anyone can send junk as "hs", and it must
    // not end a handshake the real message would complete.
    // So the state is put back when reading fails.
    const before = { h, ck, k, n, re, step };
    step = -1;
    try {
      re = Uint8Array.from(message.subarray(0, 32));
      await mixHash(re);
      if (initiator) {
        await mixKey(await dh(e.priv, re));
        await mixKey(await dh(s.priv, re));
      } else {
        await mixKey(await dh(s.priv, re));
        await mixKey(await dh(s.priv, rs));
      }
      const out = await decryptAndHash(message.subarray(32));
      step = initiator ? 2 : 1;
      return out;
    } catch (err) {
      ({ h, ck, k, n, re, step } = before);
      throw err;
    }
  }

  async function split() {
    if (step !== 2) throw new Error('phone-noise: handshake not finished');
    step = 3;
    const t = await hmac(ck, EMPTY),
      k1 = await hmac(t, Uint8Array.of(1)),
      k2 = await hmac(t, k1, Uint8Array.of(2));
    k = null;
    ck = null;
    e = null;
    return { send: initiator ? k1 : k2, recv: initiator ? k2 : k1, hash: h };
  }
  return { write, read, split };
}

// Length-prefixed fields (2-byte big-endian length, then the bytes), so no two different field
// lists give the same bytes.
export function fields(...parts) {
  return cat(
    ...parts.flatMap(p => {
      if (!(p instanceof Uint8Array) && typeof p !== 'string')
        // anything else would all become the same text
        throw new Error('phone-noise: a field is bytes or text');
      const b = p instanceof Uint8Array ? p : te.encode(p);
      if (b.length > 0xffff) throw new Error('phone-noise: field too long');
      return [Uint8Array.of(b.length >> 8, b.length & 0xff), b];
    })
  );
}

// Padding to the next size step, so the relay cannot read the length of a question from the size.
export const STEPS = [256, 1024, 4096];
export const MAX_PLAIN = STEPS[STEPS.length - 1] - 2;

export function pad(plain) {
  if (plain.length > MAX_PLAIN) throw new Error('phone-noise: message too long for one envelope');
  const out = new Uint8Array(STEPS.find(size => plain.length + 2 <= size));
  out[0] = plain.length >> 8;
  out[1] = plain.length & 0xff;
  out.set(plain, 2);
  return out;
}

export function unpad(padded) {
  if (!(padded instanceof Uint8Array) || !STEPS.includes(padded.length)) return null;
  const len = (padded[0] << 8) | padded[1];
  return len + 2 <= padded.length ? padded.subarray(2, 2 + len) : null;
}
