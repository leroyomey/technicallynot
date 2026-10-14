// Technically Not relay · index.js — a relay you run yourself, on your own Cloudflare account, so
// your computers (and phone) can reach each other through Technically Not without any account of
// ours. It only passes sealed messages between the devices that hold your secret; it cannot read
// them (the keys come from pairing two devices and never leave them).
//
// Who may connect: whoever holds RELAY_SECRET. A device proves it with a keyed hash of the call,
// this relay's host, its id and the time, never by sending the secret. A proof counts once and for
// two minutes at most. It buys one ticket, signed with a key only this relay has; the meeting
// point remembers that ticket, opens one connection for it and nothing for any other.
//
//   POST /remote/ticket    headers X-Relay-Device, X-Relay-Time, X-Relay-Proof → { ticket }
//   GET  /remote/connect?ticket=…   → WebSocket
//   GET  /remote/presence  same three headers → which devices are connected
import { RelayHub } from './hub.js';
import { b64url, fromB64url, hmacHex, json, safeEqual } from './util.js';

export { RelayHub };

const TICKET_TTL = 60; // seconds a connect ticket is valid
const PROOF_WINDOW = 120; // seconds a proof's time may differ from the relay's clock

// The rows of a keyboard, the alphabet and the digits. TYPED_RUN characters in a row from one of
// them, forward or backward and in either case, were typed by hand and not made at random: in a
// random secret of 32 letters, digits and signs such a run turns up less than once in a hundred
// thousand secrets. The app and the phone hold the same list (desktop/own-relay.js,
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

// A secret must be long and must not be a pattern: 32 to 200 printable characters, at least 12 of
// them different, no row of keys, and either three kinds of character (small letters, capitals,
// digits, signs) or 40 characters and more. Both what `npm run secret` prints and 64 random hex
// characters pass. The app's own-relay.js applies the same rule.
//
// Why 12 different and not more: hex has 16 characters in all, and one random secret of 64 hex
// characters in four lacks at least one of them. Fewer than 12 turns up about once in ten million.
const DIFFERENT_MIN = 12;

// Why 40 and not more: `npm run secret` prints 43 characters, and about one of those secrets in
// 7,500 holds letters only (no digit, no sign), so it has two kinds of character and must pass by
// its length.
const LONG_ENOUGH = 40;

//
// These rules look at the shape of the text, and shape cannot prove that a secret was made at
// random: a made-up sentence with capitals and digits passes. They only stop the laziest choices.
const KINDS = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];

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

const SECRET_OK = s =>
  typeof s === 'string' &&
  /^[\x21-\x7e]{32,200}$/.test(s) &&
  new Set(s).size >= DIFFERENT_MIN &&
  !typedRun(s) &&
  !repeatsItself(s) &&
  (s.length >= LONG_ENOUGH || KINDS.filter(k => k.test(s)).length >= 3);

class Refused extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// The secret as every part of the relay uses it. Blanks and line ends around it are taken off,
// exactly as the app and the phone take them off what is typed or pasted there: a secret that was
// saved here with a line end after it is then the same secret on both sides, instead of a relay
// that says "not set up".
function secretOf(env) {
  const secret = typeof env?.RELAY_SECRET === 'string' ? env.RELAY_SECRET.trim() : '';
  if (!SECRET_OK(secret) || !env?.RELAY_HUB) throw new Refused(503, 'relay_not_set_up');
  return secret;
}

// One meeting point per secret: a new secret starts with an empty one.
async function hubOf(env) {
  return env.RELAY_HUB.get(env.RELAY_HUB.idFromName(await hmacHex(secretOf(env), 'hub')));
}

const DEVICE = /^[A-Za-z0-9_-]{8,64}$/;

// how the id of every phone begins (phone/app makes them: "ph-" and ten hex characters)
const PHONE_ID_START = 'ph-';

// The three headers of a proof. `what` names the call and the hash names this relay's host, so a
// proof opens no other call and is worth nothing at another address. Returns { device, time } or
// throws.
async function proven(request, env, what) {
  const secret = secretOf(env),
    // already in small letters: a URL's host is written that way when it is parsed
    host = new URL(request.url).host,
    device = request.headers.get('X-Relay-Device') || '',
    time = Number(request.headers.get('X-Relay-Time')),
    proof = request.headers.get('X-Relay-Proof') || '';
  if (!DEVICE.test(device) || !Number.isSafeInteger(time) || proof.length !== 64)
    throw new Refused(401, 'invalid_proof');
  const text = `proof:${what}:${host}:${device}:${time}`;

  // Two keys may have signed it. A computer signs with the secret itself. The phone app is a web
  // page, and a page cannot hide a key from a script that got onto it, so the phone keeps only a
  // key made from the secret FOR THIS RELAY'S HOST and for proofs: with it nobody can sign a
  // ticket, find the meeting point's name or prove anything to another relay.
  // Both are worked out before either is compared, so the time taken does not say which
  // kind of device is asking.
  const bySecret = await hmacHex(secret, text);
  const byPhoneKey = await hmacHex(await hmacHex(secret, 'phone-key:' + host), text);
  const fromComputer = safeEqual(proof, bySecret);

  // The phone key speaks for phones only: every phone's id begins "ph-". So a script that got
  // onto the phone page and has that key sign cannot ask for a ticket under a computer's id,
  // which would cancel that computer's own ticket and let the script connect in its place.
  const fromPhone = safeEqual(proof, byPhoneKey) && device.startsWith(PHONE_ID_START);
  if (!fromComputer && !fromPhone) throw new Refused(401, 'invalid_proof');

  // after the hash: only a holder of the secret learns how far its clock is off
  if (Math.abs(Date.now() - time) > PROOF_WINDOW * 1000) throw new Refused(401, 'clock_off');
  return { device, time };
}

// The meeting point refuses a proof it has seen, a device that asks too often and a new device id
// when it knows too many. `issued` (a ticket's random part) is remembered there as the one ticket
// this device may use.
async function ask(env, device, time, issued = '') {
  const hub = await hubOf(env);
  return hub.fetch(
    new Request(`https://hub/ask?d=${encodeURIComponent(device)}&p=${time}&i=${issued}`)
  );
}

// 16 random bytes as hex: what makes one ticket this ticket. Nobody can guess it, so a holder of
// the secret cannot sign a copy of a ticket another device was just issued.
const randomPart = () =>
  [...crypto.getRandomValues(new Uint8Array(16))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

// ---- the key tickets are signed with ----
//
// Tickets are NOT signed with the secret: every device holds the secret, so any of them could
// sign a ticket of its own, and each such ticket, though refused, would wake the meeting point
// (waking it is what costs). They are signed with a key only this relay has. The meeting point
// makes it once, keeps it in its storage and hands it to this Worker, never to a device. A ticket
// nobody issued therefore ends here, at the door, and the meeting point stays asleep.
//
// The Worker keeps the key in memory for as long as this instance of it lives (Cloudflare starts
// and ends instances as it likes; nothing is scheduled here). A new instance asks the meeting
// point for it once.
const ticketKeys = new Map(); // meeting point's name → its key
const keyAskedAt = new Map(); // meeting point's name → when this instance last asked for the key

// A key this instance holds is asked for again at most this often (milliseconds).
const KEY_ASK_EVERY = 60 * 1000;

// A key's short name. Every ticket carries the name of the key that signed it, so an instance can
// tell "signed with a key I do not hold" from "not signed by this relay at all". The name says
// nothing about the key to anyone who does not have it.
const keyName = async key => (await hmacHex(key, 'key-name')).slice(0, 8);

const goodKey = k => typeof k === 'string' && /^[0-9a-f]{64}$/.test(k);

// The key for a ticket that names `wantedName`. From memory when this instance holds that key.
// Else the meeting point is asked: always when no key is held yet, and at most once a minute when
// another one is held. That second case is the meeting point's storage having been emptied (its
// Durable Object deleted or moved): it made a new key, and without asking again this instance
// would refuse every ticket the others issue for as long as it lives. The limit is there because
// a holder of the secret can write any name into a ticket of their own.
async function ticketKeyFor(env, wantedName) {
  const hubName = await hmacHex(secretOf(env), 'hub');
  const held = ticketKeys.get(hubName);
  if (held && (await keyName(held)) === wantedName) return held;
  const sinceAsked = Math.abs(Date.now() - (keyAskedAt.get(hubName) || 0));
  if (held && sinceAsked < KEY_ASK_EVERY) return held;
  keyAskedAt.set(hubName, Date.now());
  const answer = await (await hubOf(env)).fetch(new Request('https://hub/key'));
  const { k } = await answer.json();
  if (!goodKey(k)) throw new Error('no ticket key');
  ticketKeys.set(hubName, k);
  return k;
}

// ---- the door mark ----
//
// The first time an instance sees a ticket it has no key to judge it with, and has to ask the
// meeting point, which wakes it. So that a stranger cannot cause even that one wake-up with a
// made-up ticket, every ticket also carries a short mark made with the secret, and the mark is
// checked first, with no key at all. It is NOT what makes a ticket good (every device can make
// it); it only keeps people without the secret away from the meeting point.
const DOOR_LENGTH = 16;
const doorMark = async (secret, payload) =>
  (await hmacHex(secret, 'door:' + payload)).slice(0, DOOR_LENGTH);

// ---- tickets this instance has already seen answered ----
//
// A ticket opens one connection. The meeting point is what makes sure of that, but asking it
// again and again with the same ticket would wake it every time. So this Worker remembers, until
// the ticket is dead anyway, what the meeting point said about it, and says the same without
// asking. An honest device never shows a ticket twice, so nobody is held back by this.
const SPENT_MAX = 4096; // tickets remembered at once; issued ones only, so a few dozen in practice
const spent = new Map(); // a ticket's random part → { code: the refusal to repeat, until: ms }

function rememberSpent(randomPartOfTicket, code, until) {
  if (spent.size >= SPENT_MAX) {
    const now = Date.now();
    for (const [key, entry] of spent) {
      if (entry.until < now) spent.delete(key);
    }
  }

  // still full: every entry is a live ticket. The meeting point refuses a repeat by itself; only
  // the saved wake-up is lost.
  if (spent.size >= SPENT_MAX) return;
  spent.set(randomPartOfTicket, { code, until });
}

// A ticket is three parts with dots between: what it says (the device, the time it was made, its
// random part and the name of the key that signed it), the door mark, and the signature.
async function makeTicket(env, key, deviceId, t, r) {
  const payload = b64url(JSON.stringify({ d: deviceId, t, r, n: await keyName(key) }));
  const door = await doorMark(secretOf(env), payload);
  return payload + '.' + door + '.' + (await hmacHex(key, 'signed-ticket:' + payload));
}

// The shape and the age of a ticket, before any key is needed: { payload, door, signature, t } or
// null. A ticket's own time decides its life: made by this relay's clock, so never ahead of it,
// and dead TICKET_TTL seconds later.
function parseTicket(ticket) {
  if (typeof ticket !== 'string' || !ticket || ticket.length > 600) return null;
  const [payload, door, signature, more] = ticket.split('.');

  // (an empty door mark needs no line of its own: it cannot equal the real one, checked next)
  if (!payload || !signature || more !== undefined) return null;
  try {
    const t = JSON.parse(fromB64url(payload));
    const age = Date.now() - t.t;
    const wellShaped =
      DEVICE.test(t.d) &&
      Number.isSafeInteger(t.t) &&
      /^[0-9a-f]{32}$/.test(t.r) &&
      /^[0-9a-f]{8}$/.test(t.n) &&
      age >= 0 &&
      age <= TICKET_TTL * 1000;
    return wellShaped ? { payload, door, signature, t } : null;
  } catch {
    return null;
  }
}

// A ticket this relay signed, or null. (Even a rightly signed ticket is good only when the
// meeting point issued exactly this one last for the device and has not used it: hub.js.)
async function readTicket(env, ticket) {
  const parsed = parseTicket(ticket);
  if (!parsed) return null;

  // the door mark first: without the secret nobody gets as far as the key, which may have to be
  // asked for
  if (!safeEqual(parsed.door, await doorMark(secretOf(env), parsed.payload))) return null;
  const key = await ticketKeyFor(env, parsed.t.n);
  const signed = await hmacHex(key, 'signed-ticket:' + parsed.payload);
  return safeEqual(parsed.signature, signed) ? parsed.t : null;
}

async function ticket(request, env) {
  const { device, time } = await proven(request, env, 'ticket');
  const r = randomPart();
  const asked = await ask(env, device, time, r);
  if (asked.status !== 200) return asked;

  // the meeting point's yes carries the key to sign with; it goes into memory, not to the device
  const { k } = await asked.json();
  if (!goodKey(k)) throw new Error('no ticket key');
  ticketKeys.set(await hmacHex(secretOf(env), 'hub'), k);
  return json(200, {
    ticket: await makeTicket(env, k, device, Date.now(), r),
    expires_in: TICKET_TTL,
  });
}

async function connect(request, env) {
  secretOf(env); // a relay that is not set up says so before anything else
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket')
    throw new Refused(426, 'upgrade_required');
  const t = await readTicket(env, new URL(request.url).searchParams.get('ticket'));
  if (!t) throw new Refused(401, 'invalid_ticket');

  // answered before by the meeting point: the same answer, and it is left asleep
  const before = spent.get(t.r);
  if (before) throw new Refused(401, before.code);
  const answer = await (
    await hubOf(env)
  ).fetch(new Request(`https://hub/connect?d=${encodeURIComponent(t.d)}&r=${t.r}`, request));
  const dead = t.t + TICKET_TTL * 1000;

  // Connected: the ticket is used. Refused as not the issued one, or as used: it stays that. (A
  // relay that is full answers 429 and uses nothing, so the same ticket may be shown again.)
  if (answer.status === 101) rememberSpent(t.r, 'ticket_used', dead);
  if (answer.status === 401) {
    // a copy is read, so the answer handed on still has its text
    const said = await answer.clone().json();
    rememberSpent(t.r, said.error === 'ticket_used' ? 'ticket_used' : 'invalid_ticket', dead);
  }
  return answer;
}

async function presence(request, env) {
  const { device, time } = await proven(request, env, 'presence');

  // counted and single use like a ticket's proof
  const asked = await ask(env, device, time);
  if (asked.status !== 200) return asked;
  return (await hubOf(env)).fetch(new Request('https://hub/presence'));
}

const ROUTES = {
  'POST /remote/ticket': ticket,
  'GET /remote/connect': connect,
  'GET /remote/presence': presence,
};

// The phone app is a web page on another address, and a browser lets a page read an answer from
// elsewhere only when that answer says so. The two plain calls say so to any page: no cookie or
// sign-in of the browser is involved, and what decides is the proof, which a page without the
// secret cannot make (it gets "invalid_proof" like anyone). The WebSocket call is not under this
// rule and is left alone.
const OPEN_TO_PAGES = new Set(['/remote/ticket', '/remote/presence']);
const PAGE_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Relay-Device, X-Relay-Time, X-Relay-Proof',
  'Access-Control-Max-Age': '600',
};

// The same answer with the line that lets a page read it. A new Response: the one that came back
// from the meeting point cannot be changed.
function readable(res) {
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(res.body, { status: res.status, headers });
}

async function answer(request, env, url) {
  try {
    if (request.method === 'GET' && url.pathname === '/')
      return json(200, { relay: 'technically-not', v: 1 });
    const route = ROUTES[request.method + ' ' + url.pathname];
    if (!route) throw new Refused(404, 'not_found');
    return await route(request, env);
  } catch (e) {
    if (e instanceof Refused) return json(e.status, { error: e.code });

    // the name only: a log line must never hold a header or an address
    console.error('relay call failed', e?.name || 'Error');
    return json(500, { error: 'server_error' });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!OPEN_TO_PAGES.has(url.pathname)) return answer(request, env, url);

    // a browser's question before the real call: which headers and methods are allowed
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: PAGE_HEADERS });
    return readable(await answer(request, env, url));
  },
};
