// Technically Not · phone-push.js — the computer's side of a push notice to a paired phone:
// the computer seals the notice itself with the keys the
// phone's browser made for its subscription (RFC 8291, aes128gcm), so the server that forwards it
// and the push service can neither read nor make one. The phone's side is phone/src/push.mjs;
// tools/phone-push-test.mjs runs the two against each other. Pure Node (built-in crypto), no
// Electron and no dependency. It sends nothing: sealNotice() returns the bytes and the caller hands
// them to the server with the phone's device id. Rules this file keeps: a notice says who needs the
// user and never what is asked (section 7.4); every notice carries a check made with the notice key
// this phone gave this one computer; bad input throws instead of sealing something
// half right. The agent's name is cleaned of everything that shows as nothing and cut to 24
// characters, so it cannot push the rest of the phone's line off a lock screen; the phone puts its
// own name for this computer in front of it. Ids follow the key stores' rule (remote-keys.js
// safeId), so whatever id a pairing can have, a notice can carry. Nothing in this file may log,
// store or return a subscription key, a notice key or a sealing key.
const crypto = require('crypto');

const LABEL = 'tnai-notice-v1';
const RECORD = 4096; // the record size written in the header; one notice is always one record

// every notice is filled up to this many bytes before sealing, so its size says nothing about the
// names in it
const PLAIN = 512;

// short, so the phone's line "<computer>: <agent> needs you" stays whole on a lock screen
const AGENT_MAX = 24;

// Length-prefixed fields, the same bytes as remote-noise.js fields() (the test compares them); kept
// here so this file needs nothing else.
function fields(...parts) {
  return Buffer.concat(
    parts.flatMap(p => {
      const b = Buffer.from(p, 'utf8');
      if (b.length > 0xffff) throw new Error('phone-push: field too long');
      return [Buffer.from([b.length >> 8, b.length & 0xff]), b];
    })
  );
}

// A computer's id follows the key stores' rule (remote-keys.js safeId and phone/src/keys.mjs
// safeId; the test compares all four copies): letters, digits, _ and - since 0.3.65. An item's id
// is the app's own and may hold any text: that is harmless, because the check's input is
// length-prefixed by fields() and the notice is written by JSON.stringify. It must only be short
// and hold no broken half of a character, because two such ids become the same bytes under the
// check.
const safeId = id =>
  typeof id === 'string' &&
  /^[\w-]{1,64}$/.test(id) &&
  !/[^\x00-\x7f]/.test(id) &&
  !(id in Object.prototype);
const wholeText = id =>
  Array.from(id).every(ch => {
    const c = ch.codePointAt(0);
    return c < 0xd800 || c > 0xdfff;
  });
const usableId = id => safeId(id) && wholeText(id);
const usableItem = id =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 64 &&
  !(id in Object.prototype) &&
  wholeText(id);

// A name fit to show on a lock screen: control characters, characters that turn the reading
// direction, characters that show as nothing or as a blank (soft hyphen, fillers, the blank braille
// cell, variation selectors, tag characters and the like) and broken halves of a character become a
// space; a run of more than two combining marks is cut to two (a pile of them is a way to draw over
// the line); runs of spaces become one; at most 24 characters. phone/src/push.mjs has the same
// function and refuses a notice whose name it would clean differently, so change both together (the
// test compares them on a list of samples).
const hidden = c =>
  c < 0x20 ||
  (c >= 0x7f && c <= 0x9f) ||
  c === 0xad ||
  c === 0x34f ||
  c === 0x61c ||
  c === 0x115f ||
  c === 0x1160 ||
  c === 0x17b4 ||
  c === 0x17b5 ||
  (c >= 0x180b && c <= 0x180f) ||
  (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x2028 && c <= 0x202e) ||
  (c >= 0x2060 && c <= 0x2069) ||
  c === 0x2800 ||
  c === 0x3164 ||
  (c >= 0xd800 && c <= 0xdfff) ||
  (c >= 0xfe00 && c <= 0xfe0f) ||
  c === 0xfeff ||
  c === 0xffa0 ||
  (c >= 0xfff9 && c <= 0xfffb) ||
  (c >= 0x1d173 && c <= 0x1d17a) ||
  (c >= 0xe0000 && c <= 0xe0fff);

function cleanName(value, max = AGENT_MAX) {
  let out = '';
  for (const ch of String(value ?? '')) out += hidden(ch.codePointAt(0)) ? ' ' : ch;
  return Array.from(
    out
      .replace(/(\p{M}{2})\p{M}+/gu, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  )
    .slice(0, max)
    .join('')
    .trim();
}

// The check the phone verifies: only the computer holding this notice key can make it, and it fits
// one computer id, one item and one time. The doc's list is those three; the agent's name is
// covered as well. It need not be (only the phone can open a sealed notice, so nobody on the way
// can change the name, and a changed name could at worst show another cleaned name), but covering
// it costs nothing and means every shown word either comes from the phone's own list or is covered
// by the check.
function noticeCheck(noticeKey, computerId, itemId, time, agent) {
  return crypto
    .createHmac('sha256', noticeKey)
    .update(fields(LABEL, computerId, itemId, String(time), agent))
    .digest();
}

const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// subscription = { p256dh, auth }: the two keys of the phone's push subscription as raw Buffers (65
// and 16 bytes), received over the encrypted session. noticeKey = the 32 bytes the phone made for
// this computer. time = when the item began to wait, in ms. Returns the request body (Buffer) for
// the push service: salt, record size, the one-time public key, the sealed record.
function sealNotice({ subscription, noticeKey, computerId, itemId, agent, time } = {}) {
  const p256dh = subscription && subscription.p256dh,
    auth = subscription && subscription.auth;
  if (!Buffer.isBuffer(p256dh) || p256dh.length !== 65 || p256dh[0] !== 4)
    throw new Error('phone-push: bad subscription key');
  if (!Buffer.isBuffer(auth) || auth.length !== 16)
    throw new Error('phone-push: bad subscription secret');
  if (!Buffer.isBuffer(noticeKey) || noticeKey.length !== 32)
    throw new Error('phone-push: bad notice key');
  if (!usableId(computerId) || !usableItem(itemId)) throw new Error('phone-push: bad id');
  if (!Number.isSafeInteger(time) || time <= 0) throw new Error('phone-push: bad time');
  if (agent != null && typeof agent !== 'string') throw new Error('phone-push: bad agent name');

  // The whole notice. Nothing else may ever be added here: no question text, no computer name (the
  // phone has its own list).
  const name = cleanName(agent);
  const json = Buffer.from(
    JSON.stringify({
      c: computerId,
      i: itemId,
      a: name,
      t: time,
      check: noticeCheck(noticeKey, computerId, itemId, time, name).toString('base64'),
    }),
    'utf8'
  );
  if (json.length + 1 > PLAIN) throw new Error('phone-push: notice too long');
  const plain = Buffer.alloc(PLAIN);
  json.copy(plain);
  plain[json.length] = 2; // 2 = the last record; the zeros after it are padding

  // RFC 8291: a key pair for this one notice, agreed with the subscription's key; a point that is
  // not on the curve throws here.
  const one = crypto.createECDH('prime256v1'),
    asPublic = one.generateKeys();
  let secret;
  try {
    secret = one.computeSecret(p256dh);
  } catch {
    throw new Error('phone-push: bad subscription key');
  }
  const salt = crypto.randomBytes(16);
  const ikm = hkdf(
    auth,
    secret,
    Buffer.concat([Buffer.from('WebPush: info\0'), p256dh, asPublic]),
    32
  );
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(RECORD);
  return Buffer.concat([salt, size, Buffer.from([asPublic.length]), asPublic, sealed]);
}

module.exports = { sealNotice, cleanName, safeId, usableId, fields, PLAIN, RECORD, AGENT_MAX };
