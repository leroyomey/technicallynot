// Technically Not phone app · push.mjs — the phone's side of a push notice:
// decide what a received notice may show, make the
// notice key each scanned computer gets, and plan who gets the new keys after the subscription was
// made again. The computer's side is desktop/phone-push.js; tools/phone-push-test.mjs runs the two
// against each other. Web Crypto only, so it runs in the service worker and in Node. It shows,
// stores and sends nothing itself. Rules this file keeps: a notice shows a name line only when its
// check fits a computer this phone paired with by scan, whose notice key no other
// entry of the list has; the line starts with the phone's own name for that computer ("Desktop:
// Moss needs you"), never a name from the notice, and the agent's name after it is short and
// cleaned of everything that shows as nothing, so it cannot push the true computer off a lock
// screen; a notice is shown once and one older than a day not at all (section 7.5); whatever fails
// shows the bare line with no detail, because a push must always show something. Nothing here may
// log, store or return a notice key or a subscription key except to its caller.
const S = globalThis.crypto.subtle;
const te = new TextEncoder();

const LABEL = 'tnai-notice-v1';
const BARE_TITLE = 'Open Technically Not';
const EARLIER_MS = 10 * 60 * 1000; // older than this is shown as "earlier"

// a time further ahead than two clocks differ is not believed (a computer clock is often minutes
// off)
const AHEAD_MS = 10 * 60 * 1000;

// older than this is not shown with a name, and need not be remembered as shown
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 2048; // a real notice is far shorter; longer text is not even parsed

// the computer cuts the agent's name to this; a longer one is not from our app
const AGENT_MAX = 24;
const NAME_MAX = 60; // the phone's own name for a computer

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// Length-prefixed fields, the same bytes as noise.mjs fields() (the test compares them); kept here
// so the service worker loads one file.
function fields(...parts) {
  return cat(
    ...parts.flatMap(p => {
      if (typeof p !== 'string') throw new Error('phone-push: a field is text');
      const b = te.encode(p);
      if (b.length > 0xffff) throw new Error('phone-push: field too long');
      return [Uint8Array.of(b.length >> 8, b.length & 0xff), b];
    })
  );
}

// The same two rules as desktop/phone-push.js (change both together; the test compares them): what
// an id may be, and how a name is made fit to show. A computer's id follows keys.mjs safeId
// (letters, digits, _ and - since 0.3.65), so no computer the key store holds is refused here for
// its id. An item's id is the app's own and may hold any text: harmless, because the check's input
// is length-prefixed by fields(). It must only be short and hold no broken half of a character: two
// such ids are the same bytes under the check.
export const safeId = id =>
  typeof id === 'string' &&
  /^[\w-]{1,64}$/.test(id) &&
  !/[^\x00-\x7f]/.test(id) &&
  !(id in Object.prototype);
const wholeText = id =>
  Array.from(id).every(ch => {
    const c = ch.codePointAt(0);
    return c < 0xd800 || c > 0xdfff;
  });
export const usableId = id => safeId(id) && wholeText(id);
const usableItem = id =>
  typeof id === 'string' &&
  id.length > 0 &&
  id.length <= 64 &&
  !(id in Object.prototype) &&
  wholeText(id);

// Becomes a space: control characters, direction turners, and what shows as nothing or as a blank
// (soft hyphen, fillers, the blank braille cell, variation selectors, tag characters). More than
// two combining marks in a row are cut to two.
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

export function cleanName(value, max = AGENT_MAX) {
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

const is32 = b => b instanceof Uint8Array && b.length === 32;
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const KEYS = 'a,c,check,i,t'; // the only fields a notice has; one more or one less is not a notice
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// What `seen` holds for a shown notice: the time first, so pruneSeen needs nothing but the key,
// then the computer id with its length in front (ids may hold any character, a space too), then the
// item id. The same item id with a new time is a new notice.
const seenKey = p => p.t + ' ' + p.c.length + ':' + p.c + p.i;

// Removes what need not be remembered any more: a notice older than a day shows bare whether it is
// in the list or not. The caller runs this now and then (before saving the list) so it stays small.
// A key this file did not make is removed as well.
export function pruneSeen(seen, now = Date.now()) {
  if (
    !seen ||
    typeof seen.delete !== 'function' ||
    typeof seen[Symbol.iterator] !== 'function' ||
    !Number.isSafeInteger(now)
  )
    return seen;
  for (const key of [...seen]) {
    const m = typeof key === 'string' && /^(\d{1,16}) /.exec(key);
    if (!m || now - Number(m[1]) > DAY_MS) seen.delete(key);
  }
  return seen;
}

// The notice key for one computer: 32 random bytes, made when the phone gives that computer its
// push keys, never shared with another.
export const newNoticeKey = () => globalThis.crypto.getRandomValues(new Uint8Array(32));

// Returns what to show for a genuine, new notice, or null. Throws on nothing the caller needs to
// know about: checkNotice catches.
async function genuine(payload, computers, seen, now) {
  if (
    !Number.isSafeInteger(now) ||
    !Array.isArray(computers) ||
    !seen ||
    typeof seen.has !== 'function' ||
    typeof seen.add !== 'function'
  )
    return null;
  const p =
    typeof payload === 'string'
      ? payload.length <= MAX_TEXT
        ? JSON.parse(payload)
        : null
      : payload;
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).sort().join(',') !== KEYS)
    return null;
  if (!usableId(p.c) || !usableItem(p.i) || !Number.isSafeInteger(p.t) || p.t <= 0) return null;

  // a real computer sends the name already cleaned and cut
  if (typeof p.a !== 'string' || cleanName(p.a) !== p.a) return null;

  // base64 of exactly 32 bytes
  if (typeof p.check !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(p.check)) return null;

  // a day-old notice is a replay or of no use: bare
  if (p.t > now + AHEAD_MS || now - p.t > DAY_MS) return null;

  // The computer the notice names must be one of the phone's own, paired by scan (the list's own
  // word for it, not the caller's care), with a notice key; an id listed twice is trusted for
  // neither. A notice key that two entries share proves nothing about which of them made the check,
  // so it counts for none of them.
  const known = computers.filter(c => c && c.id === p.c);
  if (known.length !== 1 || known[0].how !== 'scan' || !is32(known[0].noticeKey)) return null;
  if (
    computers.filter(c => c && is32(c.noticeKey) && sameBytes(c.noticeKey, known[0].noticeKey))
      .length !== 1
  )
    return null;

  // The check covers the computer id, the item id, the time and the agent's name (the doc's list is
  // the first three; the name is covered too so that every word shown is either from the phone's
  // own list or under the check). verify() compares in constant time.
  const key = await S.importKey(
    'raw',
    known[0].noticeKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  if (!(await S.verify('HMAC', key, unb64(p.check), fields(LABEL, p.c, p.i, String(p.t), p.a))))
    return null;

  // Shown once. Only a notice that passed the check is remembered, so nobody else can use up an
  // item's one showing; looked up here, after the last wait, so two copies arriving together cannot
  // both pass.
  const item = seenKey(p);
  if (seen.has(item)) return null;
  seen.add(item);

  // The phone's own name for the computer comes first: whatever the agent's name says, it stands
  // after the true computer.
  return {
    title:
      (cleanName(known[0].name, NAME_MAX) || 'Your computer') +
      ': ' +
      (p.a || 'An agent') +
      ' needs you',
    computerId: p.c,
    itemId: p.i,
    earlier: now - p.t > EARLIER_MS,
  };
}

// payload = the notice as the browser decrypted it (JSON text, or the parsed object). computers =
// the phone's list as [{ id, name, noticeKey, how }]; only an entry with how 'scan' can have a name
// line (a computer known only by introduction gets no push keys, so a notice in its name shows
// bare). seen = a Set (or anything with has and add) of the notices already shown; this adds to it,
// the caller keeps it between pushes and keeps it small with pruneSeen. now = the phone's time in
// ms. Always returns something to show: { show: { title, computerId, itemId, earlier } } or the
// bare { show: { title, bare: true } }.
export async function checkNotice(payload, computers, seen, now = Date.now()) {
  try {
    const show = await genuine(payload, computers, seen, now);
    if (show) return { show };
  } catch {
    /* anything wrong shows the bare line */
  }
  return { show: { title: BARE_TITLE, bare: true } };
}

// After the subscription was made again (section 7.1, when a computer was forgotten): which of the
// remaining scanned computers get the new keys now, over their open sessions, and which were
// offline and must be marked "needs new keys" and shown so until the phone has given them.
// computers = [{ id, name, noticeKey, how }]; onlineIds = the ids with a finished session
// right now; forgottenIds = the ids being forgotten (lists or Sets). A forgotten computer is in
// neither list even while it is still in `computers`, and so is one known only by introduction:
// neither may ever get push keys. A scanned computer whose id cannot go into a notice is marked
// rather than left out, so the user is told that it will not notify.
export function planResubscribe(computers, onlineIds, forgottenIds) {
  const online = new Set(onlineIds ?? []),
    gone = new Set(forgottenIds ?? []),
    giveNow = [],
    needsNewKeys = [];
  for (const c of Array.isArray(computers) ? computers : []) {
    if (
      !c ||
      c.how !== 'scan' ||
      gone.has(c.id) ||
      giveNow.includes(c.id) ||
      needsNewKeys.includes(c.id)
    )
      continue;
    (usableId(c.id) && online.has(c.id) ? giveNow : needsNewKeys).push(c.id);
  }
  return { giveNow, needsNewKeys };
}

// For the test only: what a browser does with a received push (RFC 8291), so the computer's sealing
// is proven to open by the receiver's rules. The app never calls it: the browser decrypts a push
// itself and the page never holds the subscription's private key. Returns the notice's bytes, or
// null when the body is not such a message or does not open with these keys.
async function hkdf(salt, ikm, info, len) {
  return new Uint8Array(
    await S.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
      len * 8
    )
  );
}

export async function unsealForTest(body, uaPrivateKey, uaPublic, auth) {
  if (
    !(body instanceof Uint8Array) ||
    !(uaPublic instanceof Uint8Array) ||
    uaPublic.length !== 65 ||
    !(auth instanceof Uint8Array) ||
    auth.length !== 16
  )
    return null;
  if (
    body.length < 16 + 4 + 1 + 65 + 17 ||
    new DataView(body.buffer, body.byteOffset).getUint32(16) !== 4096 ||
    body[20] !== 65
  )
    return null;
  const salt = body.subarray(0, 16),
    asPublic = body.subarray(21, 86),
    sealed = body.subarray(86);
  try {
    const asKey = await S.importKey(
      'raw',
      asPublic,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      []
    );
    const secret = new Uint8Array(
      await S.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256)
    );
    const ikm = await hkdf(auth, secret, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
    const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
    const plain = new Uint8Array(
      await S.decrypt(
        { name: 'AES-GCM', iv: nonce, tagLength: 128 },
        await S.importKey('raw', cek, 'AES-GCM', false, ['decrypt']),
        sealed
      )
    );
    let end = plain.length;
    while (end > 0 && plain[end - 1] === 0) end--; // padding, then the mark of the last record (2)
    return end > 0 && plain[end - 1] === 2 ? plain.subarray(0, end - 1) : null;
  } catch {
    return null;
  }
}
