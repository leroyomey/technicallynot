// Technically Not phone app · own-relay.mjs — "Use my own relay" on the phone:
// the address and secret of a relay the user runs themselves (the
// public `relay/` folder), and the two things the phone's link needs from it: the relay's wss
// address and a connection ticket. It is the browser copy of desktop/own-relay.js and must accept
// and refuse the same addresses and secrets; phone/test/own-relay-test.mjs runs it against the
// relay's real code. Its proof has the same text as the computer's, signed with another key (next
// paragraph), which the relay accepts beside the secret's own.
//
// Where the secret is kept: nowhere. The moment it is saved, a key is made from it for this one
// relay's host and for proofs only, as a Web Crypto key that CANNOT be exported, and only that key
// is stored (IndexedDB can hold such a key). No script on the page can read the secret or that key
// back, only ask for a proof to be signed, and a proof is all that key can make: not a ticket, not
// the meeting point's name, nothing for a relay at another address. What this does not protect
// against: someone who can use this phone's browser profile or run code on this page can still
// have proofs for this relay signed, for any device id, while the page is open; and a key in
// browser storage is not hidden from the phone's owner the way an operating system's key store is.
//
// Why the page may connect to any https or wss address (phone/app/index.html, connect-src): the
// relay's address is typed in by the user after the page was built, and a page's content policy is
// fixed when the page is sent; it cannot be narrowed to one address afterwards. What stands
// between a hostile script and that open door is that no script from elsewhere runs on the page
// (script-src 'self', no inline script).
//
//   backend: { get(key), update(key, fn) } like keys.mjs idbBackend() (values kept as given).
//   fetch, now, subtle: the platform's, passed in so a test can use its own.
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
  // How far ahead of this clock a relay's "newest time I have seen from you" may be for the phone
  // to continue from it: 110 seconds. A relay takes a proof dated up to 120 seconds from its own
  // clock, so anything it truly accepted lies inside that; ten seconds are left so the next
  // proof, one millisecond later, still fits. A relay that names a later time is not believed.
  CLOCK_MS = 110 * 1000,
  SECRET_MAX = 200,
  URL_MAX = 200,
  TIMEOUT_MS = 10000;

// Refusals of a relay that pass by themselves.
const WAITS = new Set(['proof_used', 'rate_limited']);

// Refusals that need the user: the link stops and the page says which.
const STOPS = new Set(['clock_off', 'too_many_ids']);

// What the relay accepts as a device id (relay/src/index.js DEVICE).
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;

// Is this host a literal address that is not on the internet? (Names are not judged: a name is
// looked up by the phone.)
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
// plain http to the device itself. No sign-in part, no path, no query: the app adds the paths and
// nothing else may ride along.
export function cleanUrl(text) {
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

  // "localhost" is whatever that name resolves to, so plain http is taken only for the two numbers
  // that are the device itself.
  const local = u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol === 'wss:') u.protocol = 'https:';
  if (u.protocol === 'ws:') u.protocol = 'http:';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;

  // A relay is on the internet (Cloudflare). A number on a home or office network, a link-local
  // one or "no address" is some other device: the phone would send it a proof.
  if (!local && privateHost(u.hostname)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (u.pathname !== '/' && u.pathname !== '') return null;
  return u.protocol + '//' + u.host;
}

// The rows of a keyboard, the alphabet and the digits. TYPED_RUN characters in a row from one of
// them, forward or backward and in either case, were typed by hand and not made at random: in a
// random secret of 32 letters, digits and signs such a run turns up less than once in a hundred
// thousand secrets. The relay and the computer hold the same list (relay/src/index.js,
// desktop/own-relay.js); the tests compare the three.
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
export function cleanSecret(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (s.length < SECRET_MIN || s.length > SECRET_MAX || !/^[\x21-\x7e]+$/.test(s)) return null;

  // Not a pattern: a wrong server that was sent a proof can try guesses against it.
  if (new Set(s).size < SECRET_KINDS) return null;

  // Not a row of keys, with or without a capital, once or twice over.
  if (typedRun(s)) return null;

  // Not one piece written again and again.
  if (repeatsItself(s)) return null;

  // Three kinds of character, or SECRET_LONG and more (relay/src/index.js SECRET_OK is the same
  // rule).
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter(k => k.test(s)).length;
  return s.length >= SECRET_LONG || kinds >= 3 ? s : null;
}

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

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

// Is this stored value a key of the kind set() stores, and nothing else? Something that only
// looks like one (a plain object with the same two fields) would count as "relay set" and then
// fail at every call, so the card would say the relay cannot be reached for ever. So: a real key
// of the platform, for HMAC, that cannot be exported and may sign.
function isSigningKey(key) {
  if (!key || typeof key !== 'object') return false;
  if (typeof CryptoKey === 'function' && !(key instanceof CryptoKey)) return false;
  return (
    key.type === 'secret' &&
    key.algorithm?.name === 'HMAC' &&
    key.extractable === false &&
    Array.isArray(key.usages) &&
    key.usages.includes('sign')
  );
}

export function createOwnRelay({
  backend,
  fetch = globalThis.fetch.bind(globalThis),
  now = Date.now,
  subtle = globalThis.crypto.subtle,
}) {
  let saved; // undefined = not read yet; null = none; else { url, key }
  let lastTime = 0;

  // The store is asked once; a failed read is asked again at the next call, not remembered as
  // "none set".
  async function load() {
    if (saved !== undefined) return saved;
    let value;
    try {
      value = await backend.get('ownRelay');
    } catch {
      return null;
    }
    const url = cleanUrl(value?.url);
    saved = url && isSigningKey(value?.key) ? { url, key: value.key } : null;
    return saved;
  }

  // Each proof needs a newer time than the last one of this device (the relay refuses a repeat).
  async function proof(what, deviceId) {
    const r = await load();
    lastTime = Math.max(now(), lastTime + 1);
    const text =
      'proof:' + what + ':' + new URL(r.url).host.toLowerCase() + ':' + deviceId + ':' + lastTime;
    const mac = await subtle.sign('HMAC', r.key, new TextEncoder().encode(text));
    return {
      'X-Relay-Device': deviceId,
      'X-Relay-Time': String(lastTime),
      'X-Relay-Proof': hex(mac),
    };
  }

  // At most BODY_MAX characters of an answer are read; a longer one is an error (a hostile or
  // broken relay must not fill the phone's memory).
  async function limited(res) {
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = await res.text();
      if (text.length > BODY_MAX) throw new Error('too large');
      return text;
    }
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > BODY_MAX) {
        reader.cancel().catch(() => {});
        throw new Error('too large');
      }
    }
    return text + decoder.decode();
  }

  // Ten seconds, with whatever the browser has: older ones lack AbortSignal.timeout.
  function timeoutSignal() {
    if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(TIMEOUT_MS);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), TIMEOUT_MS);
    return controller.signal;
  }

  // One call to the relay. A redirect is an error: the proof must reach no other host.
  async function call(method, path, what, deviceId, again = false) {
    const r = await load();
    if (!r) throw { status: 0, code: 'no_relay' };
    if (!DEVICE.test(String(deviceId || ''))) throw { status: 0, code: 'device_required' };
    let res, body, headers;

    // A key that will not sign is no relay set, not a relay that cannot be reached: the page then
    // offers to set one, instead of saying "try again" for ever.
    try {
      headers = await proof(what, deviceId);
    } catch {
      throw { status: 0, code: 'no_relay' };
    }
    try {
      res = await fetch(r.url + path, {
        method,
        headers,
        redirect: 'error',
        signal: timeoutSignal(),
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

  async function presence(deviceId) {
    const body = await call('GET', '/remote/presence', 'presence', deviceId);
    return (Array.isArray(body?.devices) ? body.devices : [])
      .filter(d => d && DEVICE.test(String(d.id || '')))
      .slice(0, 64)
      .map(d => ({ id: d.id, last_seen: Number.isFinite(d.last_seen) ? d.last_seen : 0 }));
  }

  return {
    // For the page: the address and that a secret is set. Never the secret (there is no text of
    // it).
    async get() {
      const r = await load();
      return { set: !!r, url: r ? r.url : '' };
    },
    async active() {
      return !!(await load());
    },

    // → { ok: true } or { ok: false, error: 'bad_url' | 'bad_secret' | 'not_saved' }
    async set(urlText, secretText) {
      const url = cleanUrl(urlText),
        secret = cleanSecret(secretText);
      if (!url) return { ok: false, error: 'bad_url' };
      if (!secret) return { ok: false, error: 'bad_secret' };
      try {
        // What is stored is not a key of the secret itself but one made from it for this relay's
        // host and for proofs only (the relay works out the same one: relay/src/index.js, proven).
        // A script that got onto this page can have that key sign, but all it signs is a proof to
        // this one relay: no ticket, not the meeting point's name, nothing for another relay.
        // Neither key can be exported, and the secret's text is gone
        // once this function ends.
        const encoder = new TextEncoder();
        const hmac = { name: 'HMAC', hash: 'SHA-256' };
        const ofSecret = await subtle.importKey('raw', encoder.encode(secret), hmac, false, [
          'sign',
        ]);
        const host = new URL(url).host.toLowerCase();
        const phoneKeyText = hex(
          await subtle.sign('HMAC', ofSecret, encoder.encode('phone-key:' + host))
        );
        const key = await subtle.importKey('raw', encoder.encode(phoneKeyText), hmac, false, [
          'sign',
        ]);
        await backend.update('ownRelay', () => [{ url, key }, undefined]);
        saved = { url, key };

        // Proof times start again with this clock: the last relay may have moved them ahead, and
        // another relay would then say this phone's clock is wrong.
        lastTime = 0;
      } catch {
        return { ok: false, error: 'not_saved' };
      }
      return { ok: true };
    },
    async clear() {
      try {
        await backend.update('ownRelay', () => [null, undefined]);
        saved = null;
      } catch {
        return { ok: false, error: 'not_saved' };
      }
      return { ok: true };
    },

    // "wss://host" for the link ("ws://" only for a relay on the device itself). Only meaningful
    // after get() or set() has run once.
    wsUrl: () => (saved ? saved.url.replace(/^http/, 'ws') : ''),

    // → the ticket text; rejects with { status, code } like the account's getTicket.
    async ticket(deviceId) {
      const body = await call('POST', '/remote/ticket', 'ticket', deviceId);
      if (typeof body?.ticket !== 'string' || !body.ticket || body.ticket.length > 600)
        throw { status: 502, code: 'refused' };
      return body.ticket;
    },

    // → [{ id, last_seen }]: the relay knows ids only. An error gives an empty list.
    async devices(deviceId) {
      try {
        return await presence(deviceId);
      } catch {
        return [];
      }
    },

    // The same call, for a page that wants to say why it failed: rejects with { status, code }.
    check: presence,
  };
}
