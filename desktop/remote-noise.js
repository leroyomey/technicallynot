// Technically Not · remote-noise.js — the cryptography two paired computers talk with:
// the published handshake pattern
// Noise_KK_25519_AESGCM_SHA256 on Node's built-in crypto (AES-GCM, not ChaCha20-Poly1305:
// Electron's Node has no ChaCha20-Poly1305 cipher, found 2026-10-04, and a phone browser's
// WebCrypto has none either), the sealed transport messages after it, and the padding to fixed size
// steps. Pure Node, no Electron and no dependency, so it runs in tests as it runs in the app.
// Proven against the published test vector (tools/remote-noise-test.js); change nothing here
// without that test passing. Nothing in this file may log, store or return a private key or a
// session key except to its caller.
const crypto = require('crypto');

const NAME = Buffer.alloc(32);

// 28 bytes: shorter than a hash, so zero-padded to 32 it is the first hash
NAME.write('Noise_KK_25519_AESGCM_SHA256');

// X25519 private key, raw 32 bytes follow
const PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');

// X25519 public key, raw 32 bytes follow
const SPKI = Buffer.from('302a300506032b656e032100', 'hex');
const EMPTY = Buffer.alloc(0);

const sha256 = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};
const hmac = (key, ...parts) => {
  const h = crypto.createHmac('sha256', key);
  for (const p of parts) h.update(p);
  return h.digest();
};
const privateKey = raw =>
  crypto.createPrivateKey({ key: Buffer.concat([PKCS8, raw]), format: 'der', type: 'pkcs8' });
const publicKey = raw =>
  crypto.createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' });
const is32 = b => Buffer.isBuffer(b) && b.length === 32;

// A new X25519 key pair as raw 32-byte buffers.
function generateKeyPair() {
  const pair = crypto.generateKeyPairSync('x25519');
  return {
    priv: pair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32),
    pub: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  };
}
const publicFromPrivate = priv =>
  crypto.createPublicKey(privateKey(priv)).export({ format: 'der', type: 'spki' }).subarray(-32);

// Key agreement. An all-zero result (a low-order public key) ends the handshake (protocol section
// 5.1).
function dh(priv, pub) {
  if (!is32(priv) || !is32(pub)) throw new Error('remote-noise: bad key length');
  const out = crypto.diffieHellman({ privateKey: privateKey(priv), publicKey: publicKey(pub) });
  if (out.every(b => b === 0)) throw new Error('remote-noise: all-zero key agreement');
  return out;
}

// AES-256-GCM, nonce = 4 zero bytes + the counter as 8 bytes big-endian (the Noise rule for
// AESGCM). Returns ciphertext + 16-byte tag.
function nonceOf(n) {
  const b = Buffer.alloc(12);
  b.writeBigUInt64BE(BigInt(n), 4);
  return b;
}

function seal(key, n, ad, plaintext) {
  const c = crypto.createCipheriv('aes-256-gcm', key, nonceOf(n), { authTagLength: 16 });
  c.setAAD(ad);
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

// Returns the plaintext, or null when it does not decrypt (wrong key, counter, associated data, or
// a changed byte).
function open(key, n, ad, sealed) {
  if (!Buffer.isBuffer(sealed) || sealed.length < 16) return null;
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonceOf(n), { authTagLength: 16 });
    d.setAAD(ad);
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]);
  } catch {
    return null;
  }
}

// One side of a KK handshake. s = own long-term private key, rs = the other computer's long-term
// public key (both known from pairing), prologue = what both sides must agree on (version, device
// ids, pairing id). e is given only by the test vector. write() and read() must be called in the
// pattern's order: the starter writes message 1 and reads message 2, the answerer the reverse.
// After both, split() gives the two transport keys: `send` for what this side sends, `recv` for
// what it receives.
function handshake({ initiator, s, rs, prologue = EMPTY, e = null }) {
  if (!is32(s) || !is32(rs)) throw new Error('remote-noise: bad key length');
  const sPub = publicFromPrivate(s);
  let h = Buffer.from(NAME),
    ck = Buffer.from(NAME),
    k = null,
    n = 0,
    re = null,
    step = 0;
  const mixHash = data => {
    h = sha256(h, data);
  };
  const mixKey = ikm => {
    const t = hmac(ck, ikm);
    ck = hmac(t, Buffer.from([1]));
    k = hmac(t, ck, Buffer.from([2]));
    n = 0;
  };
  const encryptAndHash = plain => {
    const out = k ? seal(k, n++, h, plain) : Buffer.from(plain);
    mixHash(out);
    return out;
  };
  const decryptAndHash = data => {
    const out = k ? open(k, n++, h, data) : Buffer.from(data);
    if (!out) throw new Error('remote-noise: handshake message does not decrypt');
    mixHash(data);
    return out;
  };
  mixHash(prologue);
  mixHash(initiator ? sPub : rs); // pre-messages: the starter's long-term key, then the answerer's
  mixHash(initiator ? rs : sPub);

  // Message 1 (starter → answerer): e, es, ss. Message 2 (answerer → starter): e, ee, se.
  function write(payload = EMPTY) {
    if (step !== (initiator ? 0 : 1)) throw new Error('remote-noise: handshake out of order');
    const ePriv = e || generateKeyPair().priv;
    e = ePriv;
    const ePub = publicFromPrivate(ePriv);
    mixHash(ePub);
    if (initiator) {
      mixKey(dh(ePriv, rs));
      mixKey(dh(s, rs));
    } else {
      mixKey(dh(ePriv, re));
      mixKey(dh(ePriv, rs));
    }
    step++;
    return Buffer.concat([ePub, encryptAndHash(payload)]);
  }

  function read(message) {
    if (step !== (initiator ? 1 : 0)) throw new Error('remote-noise: handshake out of order');
    if (!Buffer.isBuffer(message) || message.length < 32)
      throw new Error('remote-noise: handshake message too short');

    // A message that does not open (junk, or one made for another attempt) leaves the handshake as
    // it was, so the real one can still be read.
    const was = { h, ck, k, n, re };
    try {
      re = Buffer.from(message.subarray(0, 32));
      mixHash(re);
      if (initiator) {
        mixKey(dh(e, re));
        mixKey(dh(s, re));
      } else {
        mixKey(dh(s, re));
        mixKey(dh(s, rs));
      }
      const out = decryptAndHash(message.subarray(32));
      step++;
      return out;
    } catch (err) {
      ({ h, ck, k, n, re } = was);
      throw err;
    }
  }

  function split() {
    if (step !== 2) throw new Error('remote-noise: handshake not finished');
    const t = hmac(ck, EMPTY),
      k1 = hmac(t, Buffer.from([1])),
      k2 = hmac(t, k1, Buffer.from([2]));
    step = 3;
    k = null;
    ck = null;
    e = null;
    return { send: initiator ? k1 : k2, recv: initiator ? k2 : k1, hash: h };
  }
  return { write, read, split };
}

// Length-prefixed fields (2-byte big-endian length, then the bytes), so no two different field
// lists give the same bytes.
function fields(...parts) {
  return Buffer.concat(
    parts.flatMap(p => {
      const b = Buffer.isBuffer(p) ? p : Buffer.from(String(p), 'utf8');
      if (b.length > 0xffff) throw new Error('remote-noise: field too long');
      const len = Buffer.alloc(2);
      len.writeUInt16BE(b.length);
      return [len, b];
    })
  );
}

// Padding to the next size step, so the relay cannot read the length of a question from the size
// (protocol section 3). Padded form: 2-byte big-endian length, the bytes, zeros up to the step.
// Longer content is split by the caller, never sent larger.
const STEPS = [256, 1024, 4096];
const MAX_PLAIN = STEPS[STEPS.length - 1] - 2;

function pad(plain) {
  if (plain.length > MAX_PLAIN) throw new Error('remote-noise: message too long for one envelope');
  const out = Buffer.alloc(STEPS.find(size => plain.length + 2 <= size));
  out.writeUInt16BE(plain.length);
  plain.copy(out, 2);
  return out;
}

function unpad(padded) {
  if (!Buffer.isBuffer(padded) || !STEPS.includes(padded.length)) return null;
  const len = padded.readUInt16BE(0);
  return len + 2 <= padded.length ? padded.subarray(2, 2 + len) : null;
}

module.exports = {
  generateKeyPair,
  publicFromPrivate,
  handshake,
  seal,
  open,
  fields,
  pad,
  unpad,
  sha256,
  MAX_PLAIN,
  STEPS,
};
