// Technically Not · own-relay.js — "Use my own relay": the address and
// secret of a relay the user runs themselves (the public `relay/` folder), kept encrypted in the
// settings folder, and the three things the several-computers service otherwise takes from an
// account: the relay address, a connection ticket and the list of devices on the relay.
//
// The secret never leaves this file except as a keyed hash: not to the window, not to a log, and
// not to the relay (which is sent a one-time proof made from it).
//
// Pure Node apart from what is handed in, so tools/own-relay-test.js runs it without Electron.
//   backend: remote-service.js storageBackend() for its own file (encrypt, decrypt, read, write,
//            available).
//   fetch:   the platform's fetch. now(): milliseconds. crypto: node:crypto.
const SECRET_MIN = 32,
  // Different characters at least. Not more than 12: hex has 16 characters in all, and one random
  // secret of 64 hex characters in four lacks at least one of them (relay/src/index.js
  // DIFFERENT_MIN is the same number).
  SECRET_KINDS = 12,
  // From this length on a secret needs no three kinds of character. Not more than 40: `npm run
  // secret` prints 43 characters, and about one of those secrets in 7,500 holds letters only
  // (relay/src/index.js LONG_ENOUGH is the same number).
  SECRET_LONG = 40,
  BODY_MAX = 4096, // characters of a relay's answer that are read
  // How far ahead of this clock a relay's "newest time I have seen from you" may be for the app
  // to continue from it: 110 seconds. A relay takes a proof dated up to 120 seconds from its own
  // clock, so anything it truly accepted lies inside that; ten seconds are left so the next
  // proof, one millisecond later, still fits. A relay that names a later time is not believed.
  CLOCK_MS = 110 * 1000,
  SECRET_MAX = 200,
  URL_MAX = 200,
  TIMEOUT_MS = 10000,
  // a relay file that could not be read is read again this long after the failed try at the
  // earliest
  RETRY_MS = 5000;

// Refusals of a relay that pass by themselves.
const WAITS = new Set(['proof_used', 'rate_limited']);

// Refusals that need the user: the link stops and the page says which.
const STOPS = new Set(['clock_off', 'too_many_ids']);

// What stands in for the account id while an own relay is set (accountId below says why it is one
// constant). own-relay-wiring.js needs it before a relay is saved, to ask what a change to it
// would remove.
const ACCOUNT_ID = 'own-relay';

// What the relay accepts as a device id (relay/src/index.js DEVICE).
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;

// Is this host a literal address that is not on the internet? (Names are not judged: a name is
// looked up by the system.)
function privateHost(host) {
  const h = host.toLowerCase();
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);

    // An IPv4 address can be written inside an IPv6 one in several ways, and each of them reaches
    // the same home or office device as the plain number would. All of these forms are refused,
    // whatever IPv4 address is inside: a relay on the internet is never written this way.
    //   ::ffff:a.b.c.d   "mapped"
    //   ::a.b.c.d        the old "compatible" form, which the URL parser prints as ::xxxx:xxxx
    //   64:ff9b::…       through a NAT64 gateway (also the local-use range 64:ff9b:1::/48)
    //   2002:…           6to4, with the IPv4 address in the second and third group
    const holdsIpv4 =
      v6.startsWith('::ffff:') ||
      /^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(v6) ||
      v6.startsWith('64:ff9b:') ||
      v6.startsWith('2002:');
    return (
      v6 === '::' ||
      // unique local
      /^f[cd]/.test(v6) ||
      // link-local
      /^fe[89ab]/.test(v6) ||
      holdsIpv4
    );
  }
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

// The address as the user may type it → "https://host[:port]" or null. Only a secure address, or
// plain http to this computer itself (a relay being tried locally). No sign-in part, no path, no
// query: the app adds the paths, and nothing else may ride along.
function cleanUrl(text) {
  if (typeof text !== 'string') return null;
  let raw = text.trim();
  if (!raw || raw.length > URL_MAX || /\s/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  // "localhost" is whatever that name resolves to on this computer, so plain http is taken only
  // for the two numbers that are this computer.
  const local = u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'wss:') u.protocol = 'https:';
  if (u.protocol === 'ws:') u.protocol = 'http:';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;

  // A relay is on the internet (Cloudflare). An address that is a number on a home or office
  // network, a link-local one or "no address" is some other device: the app would send it a proof.
  if (!local && privateHost(u.hostname)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.protocol + '//' + u.host;
}

// The rows of a keyboard, the alphabet and the digits. TYPED_RUN characters in a row from one of
// them, forward or backward and in either case, were typed by hand and not made at random: in a
// random secret of 32 letters, digits and signs such a run turns up less than once in a hundred
// thousand secrets. The relay and the phone hold the same list (relay/src/index.js,
// phone/src/own-relay.mjs); the tests compare the three.
const TYPED_ROWS = [
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'abcdefghijklmnopqrstuvwxyz',
  '01234567890',
  '!@#$%^&*()',
];
const TYPED_RUN = 7;

// Does the secret hold a run that was typed along a row?
function typedRun(secret) {
  const low = secret.toLowerCase();
  for (const row of TYPED_ROWS) {
    const backward = [...row].reverse().join('');
    for (const line of [row, backward]) {
      for (let start = 0; start + TYPED_RUN <= line.length; start++) {
        if (low.includes(line.slice(start, start + TYPED_RUN))) return true;
      }
    }
  }
  return false;
}

// What is taken as a secret. These rules look at the shape of the text, and shape cannot prove
// that a secret was made at random: a made-up sentence with capitals and digits passes. They only
// stop the laziest choices. The advice stays `npm run secret` in the relay folder.
const cleanSecret = text => {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (s.length < SECRET_MIN || s.length > SECRET_MAX || !/^[\x21-\x7e]+$/.test(s)) return null;

  // Not a pattern: a wrong server that was sent a proof can try guesses against it, so a secret
  // like one letter 32 times is refused (the relay refuses the same).
  if (new Set(s).size < SECRET_KINDS) return null;

  // Not a row of keys, with or without a capital, once or twice over.
  if (typedRun(s)) return null;

  // Not one piece written again and again.
  if (repeatsItself(s)) return null;

  // Three kinds of character, or SECRET_LONG and more: what `npm run secret` prints and 64 hex
  // characters pass (relay/src/index.js SECRET_OK is the same rule).
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(k => k.test(s)).length;
  return s.length >= SECRET_LONG || kinds >= 3 ? s : null;
};

// Is the secret one piece written again and again ("MyDogRex2019!" two and a half times)? Then
// it is only as hard to guess as the piece. A random secret is never this.
function repeatsItself(secret) {
  for (let piece = 1; piece <= secret.length / 2; piece++) {
    let same = true;
    for (let at = piece; at < secret.length && same; at++) {
      same = secret[at] === secret[at - piece];
    }
    if (same) return true;
  }
  return false;
}

// Was this text once taken as a secret, whatever today's rules about patterns say? The length and
// the kind of characters were always asked for; the pattern rules came later and were tightened.
const onceASecret = text =>
  typeof text === 'string' &&
  text.trim().length >= SECRET_MIN &&
  text.trim().length <= SECRET_MAX &&
  /^[\x21-\x7e]+$/.test(text.trim());

// The file that keeps this computer's device id on own relays, as the idStore createOwnRelay
// takes. It is here and not in main.js so a test can run it against a real folder.
function idFileStore({ file, fs = require('fs') }) {
  return {
    // No file is "none yet". A file that is there and cannot be read throws, so it is left alone
    // instead of a new id being written over the one the pairings rest on.
    read() {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
      }
    },

    // Written beside the file and moved over it, so a full disk leaves the old file whole. A
    // failure throws; the caller keeps it as the reason the Devices page shows.
    write(text) {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
    },
  };
}

// Was this text ever saved as an address? Whatever set() stored was a text with something in it;
// which rule it passed then is not asked again.
const onceAnAddress = text => typeof text === 'string' && text.trim().length > 0;

// idStore: { read() → text, or null when there is no file; write(text) } for this computer's
// device id on own relays. Both throw when the file cannot be read or written.
function createOwnRelay({
  backend,
  idStore = null,
  fetch = globalThis.fetch,
  now = Date.now,
  crypto = require('crypto'),
}) {
  let saved; // undefined = not read yet; null = none; else { url, secret }

  // why the last read gave nothing: '', 'unavailable', 'unreadable', 'old_secret' or
  // 'old_address'
  let problem = '';

  // the address of a saved relay whose secret is no longer taken (problem 'old_secret'), for the
  // page to show; the secret itself is not kept
  let oldUrl = '';
  let lastTime = 0;
  let ownId = '';
  let failedAt = 0; // when the relay file last could not be read (this clock's milliseconds)

  // why this computer's id is not on disk: '', 'id_not_saved' (the file could not be written) or
  // 'id_not_read' (a file is there and could not be read, so it was left alone)
  let idProblem = '';
  let idTriedAt = 0; // when the id file was last written to without success

  function load() {
    if (saved !== undefined) return saved;

    // A file that could not be read is not read again at once. This is asked many times for each
    // push of state, and every try reads the file and asks the system's secure storage to decrypt
    // it, in the main process (on macOS that question can raise a keychain prompt). So the answer
    // "unreadable" stands for a few seconds; nothing is scheduled, the next question after that
    // reads again. A clock that was set back counts as time passed.
    if (problem === 'unreadable' && Math.abs(now() - failedAt) < RETRY_MS) return null;

    // Storage that is not ready, or a file that cannot be read this once, is asked again: "none
    // set" must not be decided for the whole run on one failed read, or an account push would see
    // "another account".
    problem = '';
    try {
      // No relay was ever saved: nothing to read, so the system's secure storage is not asked at
      // all. On macOS that question reads the keychain, and a keychain item made by another build
      // raises a prompt that blocks the app's start before its window (0.3.65 to 0.3.71 on the
      // Mac release machine).
      if (typeof backend.exists === 'function' && !backend.exists()) {
        saved = null;
        return saved;
      }
      if (!backend.available()) {
        problem = 'unavailable';
        return null;
      }
      const text = backend.read();
      saved = null;
      if (!text) return saved;
      const v = JSON.parse(backend.decrypt(Buffer.from(text, 'base64')).toString('utf8'));
      const url = cleanUrl(v?.url),
        secret = cleanSecret(v?.secret);
      if (url && secret) saved = { url, secret };

      // A relay was saved here with an address or a secret an earlier build took and today's
      // rules refuse. That is not "no relay": said as "none", the card would offer to set one with
      // no word of why, and a signed-in account would be handed this relay's pairings to remove.
      // It is kept as a relay that is held (held() below) and cannot be used until the user sets
      // it again; the page says which of the two it is. An address that is no longer taken is not
      // kept or shown: nothing is sent to it and the page has no use for it.
      const wasSaved = onceAnAddress(v?.url) && onceASecret(v?.secret);
      if (!saved && wasSaved) {
        problem = url ? 'old_secret' : 'old_address';
        oldUrl = url || '';
      }
    } catch {
      saved = undefined;
      problem = 'unreadable';
      failedAt = now();
      return null;
    }
    return saved;
  }

  function store(value) {
    backend.write(
      value ? backend.encrypt(Buffer.from(JSON.stringify(value), 'utf8')).toString('base64') : ''
    );
    saved = value;

    // what was just written is what is set: an earlier failed read says nothing about it any more
    // (left in place, a relay removed while its file was unreadable would count as "held" for the
    // rest of the run)
    problem = '';
    oldUrl = '';

    // Proof times start again with this clock. The last relay may have moved them ahead (its
    // answer to a proof it had seen), and carried over to another relay they would be dated
    // outside that relay's window: it would say this computer's clock is wrong.
    lastTime = 0;
  }

  // What the user typed, checked in the order set() always answered in. The cleaned values stay
  // inside this file.
  function checked(urlText, secretText) {
    if (!backend.available()) return { ok: false, error: 'unavailable' };
    const url = cleanUrl(urlText);
    const secret = cleanSecret(secretText);
    if (!url) return { ok: false, error: 'bad_url' };
    if (!secret) return { ok: false, error: 'bad_secret' };
    return { ok: true, url, secret };
  }

  const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

  // Each proof needs a newer time than the last one of this device (the relay refuses a repeat).
  function proof(what, deviceId) {
    const r = load();
    lastTime = Math.max(now(), lastTime + 1);
    return {
      'X-Relay-Device': deviceId,
      'X-Relay-Time': String(lastTime),
      // the relay's host is part of it: a proof sent to a mistyped address is worth nothing at
      // the real one
      'X-Relay-Proof': hmac(
        r.secret,
        'proof:' + what + ':' + new URL(r.url).host.toLowerCase() + ':' + deviceId + ':' + lastTime
      ),
    };
  }

  // At most BODY_MAX characters of an answer are read; a longer one is an error (a hostile or
  // broken relay must not fill this process's memory).
  async function limited(res) {
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = await res.text();
      if (text.length > BODY_MAX) throw new Error('too large');
      return text;
    }
    const dec = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      if (text.length > BODY_MAX) {
        reader.cancel().catch(() => {});
        throw new Error('too large');
      }
    }
    return text + dec.decode();
  }

  // One call to the relay. A redirect is an error: the proof must reach no other host.
  async function call(method, path, what, deviceId, again = false) {
    const r = load();
    if (!r) throw { status: 0, code: 'no_relay' };
    if (!DEVICE.test(String(deviceId || ''))) throw { status: 0, code: 'device_required' };
    let res, body;
    try {
      res = await fetch(r.url + path, {
        method,
        headers: proof(what, deviceId),
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw { status: 0, code: 'network' };
    }
    try {
      body = JSON.parse(await limited(res));
    } catch {
      // Something answered, but not as a relay does (a website's page, nothing, too much): for a
      // refusal the address is wrong, and trying again will not help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429)
        throw { status: 403, code: 'refused' };
      throw { status: 0, code: 'network' };
    }
    if (res.ok) return body;

    // A relay's word is not trusted with text: a short code of letters, or "refused".
    const code =
      typeof body?.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : 'refused';

    // The relay has seen a newer time from this device (a clock that was ahead and was corrected,
    // or a second window): continue from it, when it is near this clock.
    if (
      code === 'proof_used' &&
      Number.isSafeInteger(body.after) &&
      body.after <= now() + CLOCK_MS
    ) {
      lastTime = Math.max(lastTime, body.after);

      // and try once more at once: the next proof is newer than what the relay holds
      if (!again) return call(method, path, what, deviceId, true);
    }

    // Some pass by themselves, so the link waits and tries again (429); some need the user, so it
    // stops and the page says why (403); a 401 is the relay refusing the secret.
    throw { status: WAITS.has(code) ? 429 : STOPS.has(code) ? 403 : res.status, code };
  }

  // A relay was saved here but cannot be read right now (the file does not decrypt this once, or
  // secure storage is not ready). The app must then keep treating this computer as being on its
  // own relay: answering "no relay" would hand the pairings made through it to whichever account
  // is signed in, and the service removes pairings of "another account".
  // The same holds for a saved relay whose secret or address is no longer taken ('old_secret',
  // 'old_address').
  function held() {
    load();
    if (problem === 'unreadable' || problem === 'old_secret' || problem === 'old_address')
      return true;
    return problem === 'unavailable' && typeof backend.exists === 'function' && !!backend.exists();
  }

  // Put this run's id on disk. A failure is kept as a reason for the page: said to nobody, the
  // next start would make another id and every pairing would stop with no word of why.
  function keepId(id) {
    try {
      idStore?.write(JSON.stringify({ id }) + '\n');
      idProblem = '';
    } catch {
      idProblem = 'id_not_saved';
      idTriedAt = now();
    }
  }

  // This computer's device id on a relay of the user's own: made once, kept in the settings
  // folder, and NOT the id the Technically Not account knows this computer by, so an address
  // someone else runs cannot tell which account's computer this is. It
  // stays the same when the relay or its secret changes, because pairings are stored under it.
  function deviceId() {
    if (ownId) return ownId;
    let text = null;
    try {
      text = idStore?.read();
    } catch {
      // A file is there and cannot be read this once. This run gets an id of its own, and the
      // file is left as it is: written over, the id the pairings rest on would be gone for good.
      idProblem = 'id_not_read';
      return (ownId = crypto.randomUUID());
    }
    let id = '';
    try {
      id = JSON.parse(text || '{}').id;
    } catch {
      /* made again below */
    }
    if (typeof id !== 'string' || !DEVICE.test(id)) {
      id = crypto.randomUUID();
      keepId(id);
    }
    return (ownId = id);
  }

  return {
    // For the window: the address and that a secret is set. Never the secret.
    get() {
      const r = load();

      // The id matters only while this computer is on a relay of its own; before that nothing is
      // made or written. An id that could not be saved is tried again here, a few seconds apart
      // at most, so the reason goes away by itself once the folder can be written.
      if (r || held()) {
        deviceId();
        if (idProblem === 'id_not_saved' && Math.abs(now() - idTriedAt) >= RETRY_MS) keepId(ownId);
      }
      return {
        available: !!backend.available(),
        problem,
        // '', 'id_not_saved' or 'id_not_read': this computer's id is good for this run only
        idProblem,
        set: !!r,
        // with problem 'old_secret': the address that was saved, so the page can name it
        url: r ? r.url : oldUrl,
      };
    },
    active: () => !!load(),
    held,
    deviceId,

    // Would set() take these two? The same answer, with nothing stored and nothing handed back: the
    // wiring asks it before it asks the user whether pairings may be removed, so nobody confirms
    // a change that is then refused for a mistyped address.
    // → { ok: true } or { ok: false, error: 'unavailable' | 'bad_url' | 'bad_secret' }
    check(urlText, secretText) {
      const r = checked(urlText, secretText);
      return r.ok ? { ok: true } : r;
    },

    // → { ok: true } or { ok: false, error: 'unavailable' | 'bad_url' | 'bad_secret' | 'not_saved'
    // }
    set(urlText, secretText) {
      const r = checked(urlText, secretText);
      if (!r.ok) return r;
      try {
        store({ url: r.url, secret: r.secret });
      } catch {
        return { ok: false, error: 'not_saved' };
      }
      return { ok: true };
    },
    clear() {
      try {
        store(null);
      } catch {
        return { ok: false, error: 'not_saved' };
      }
      return { ok: true };
    },

    // "wss://host" for the link ("ws://" only for a relay on this computer).
    wsUrl() {
      const r = load();
      return r ? r.url.replace(/^http/, 'ws') : '';
    },

    // What stands in for the account id while an own relay is set. The same for every relay and
    // secret: pairings rest on the keys two computers made with the six digits, not on the relay
    // that carries their sealed messages, so changing the relay or its secret keeps them (a typo
    // must not cost every pairing). Going between a signed-in account and
    // an own relay is still a change of account.
    accountId: () => (load() ? ACCOUNT_ID : ''),

    // → the ticket text; rejects with { status, code } like the account's getTicket.
    async ticket(deviceId) {
      const body = await call('POST', '/remote/ticket', 'ticket', deviceId);
      if (typeof body?.ticket !== 'string' || !body.ticket || body.ticket.length > 600)
        throw { status: 502, code: 'refused' };
      return body.ticket;
    },

    // Remove another device's record from the relay (an old computer or a test device the user no
    // longer wants listed). The device is named in the proof, so the proof removes no other one.
    // → { ok: true } or { ok: false, error: 'online' | 'invalid_device' | 'network' | … }
    async forget(deviceId, goneId) {
      if (!DEVICE.test(String(goneId || ''))) return { ok: false, error: 'invalid_device' };
      try {
        await call(
          'POST',
          '/remote/forget?d=' + encodeURIComponent(goneId),
          'forget:' + goneId,
          deviceId
        );
      } catch (e) {
        return { ok: false, error: typeof e?.code === 'string' ? e.code : 'network' };
      }
      return { ok: true };
    },

    // → [{ id, name: '', last_seen }]: the relay knows ids only; names arrive from the computers
    // themselves once paired. An error gives an empty list, as with the account's list.
    async devices(deviceId) {
      let body;
      try {
        body = await call('GET', '/remote/presence', 'presence', deviceId);
      } catch {
        return [];
      }
      return (Array.isArray(body?.devices) ? body.devices : [])
        .filter(d => d && DEVICE.test(String(d.id || '')))
        .slice(0, 64)
        .map(d => ({
          id: d.id,
          name: '',
          last_seen: Number.isFinite(d.last_seen) ? d.last_seen : 0,
        }));
    },
  };
}

module.exports = { createOwnRelay, idFileStore, cleanUrl, cleanSecret, ACCOUNT_ID };
