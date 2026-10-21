// Technically Not relay · tests. Plain Node, no Cloudflare: `node test/run.mjs`. The Durable Object
// and its sockets are stood in for by do-shim.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubNamespace, installWorkerGlobals } from './do-shim.mjs';

installWorkerGlobals();
const { default: worker, RelayHub } = await import('../src/index.js');
const { hmacHex, b64url, keysKept } = await import('../src/util.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'kR7_tQ2mXv9LpZ4wYb6NcH1sDf8GjA3eUo5i',
  OTHER = 'Zx1_Cv2Bn3Mq4Wl5Ek6Rj7Th8Yg9Uf0IdPsAo',
  HOST = 'relay.test';
let hubs, env;
const fresh = (secret = SECRET) => {
  hubs = createHubNamespace(RelayHub, () => env);
  env = { RELAY_SECRET: secret, RELAY_HUB: hubs };
};

let clock = Date.now();
let passed = 0,
  failed = 0;
const realNow = Date.now;

async function test(name, fn) {
  fresh();
  Date.now = realNow;
  clock = Date.now(); // a test that moved the time must not leave the next one in the future
  try {
    await fn();
    passed++;
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + (e?.message || e));
  }
  Date.now = realNow;
}
const ok = (v, why) => {
  if (!v) throw new Error(why);
};
const eq = (a, b, why) =>
  ok(a === b, (why || 'not equal') + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));

// Time the tests control: each proof needs a newer time than the last one of its device.
const tick = () => (clock = Math.max(clock + 1, Date.now()));
const later = ms => {
  const at = Date.now() + ms;
  Date.now = () => at;
};

async function headers(device, what = 'ticket', o = {}) {
  const { secret = SECRET, time = tick(), host = HOST } = o;
  return {
    'X-Relay-Device': device,
    'X-Relay-Time': String(time),
    'X-Relay-Proof': await hmacHex(secret, `proof:${what}:${host}:${device}:${time}`),
  };
}
const call = (method, path, h = {}) =>
  worker.fetch(new Request('https://' + HOST + path, { method, headers: h }), env);

async function ticketFor(device, opts) {
  // a ticket carries the millisecond it was made in, and a device's next one must be newer
  await new Promise(r => setTimeout(r, 2));
  const r = await call('POST', '/remote/ticket', await headers(device, 'ticket', opts));
  return { status: r.status, body: await r.json() };
}

async function open(ticket) {
  const r = await call('GET', '/remote/connect?ticket=' + encodeURIComponent(ticket), {
    Upgrade: 'websocket',
  });
  return r.status === 101 ? r.webSocket : { refused: r.status, body: await r.json() };
}

async function join2(a = 'device-aaaa', b = 'device-bbbb') {
  const wa = await open((await ticketFor(a)).body.ticket),
    wb = await open((await ticketFor(b)).body.ticket);
  return { wa, wb };
}
const env1 = (from, to, body = 'sealed', kind = 'msg') =>
  JSON.stringify({ v: 1, kind, from, to, body });

// A ticket a holder of the secret signs themselves, without asking the relay.
async function forged(device, t) {
  const p = b64url(JSON.stringify({ d: device, t }));
  return p + '.' + (await hmacHex(SECRET, 'signed-ticket:' + p));
}

// The same, complete in every part a real ticket has (a random part of 32 hex characters): the
// best ticket anyone can make who holds the secret but not the relay's own key.
// `more` changes or adds parts of what the ticket says (its time, the key it names, …).
async function selfSigned(device, r = randomHex(16), more = {}) {
  const says = { d: device, t: Date.now(), r, n: await currentKeyName(), ...more };
  const p = b64url(JSON.stringify(says));

  // the door mark is made with the secret, so a holder gets it right
  const door = (await hmacHex(SECRET, 'door:' + p)).slice(0, 16);
  return p + '.' + door + '.' + (await hmacHex(SECRET, 'signed-ticket:' + p));
}

// The name of the key the meeting point signs with right now, as every issued ticket carries it
// ('00000000' while it has made none): a holder of the secret reads it off any ticket.
async function currentKeyName() {
  const key = (await hubState())?.kv.get('k');
  return key ? (await hmacHex(key, 'key-name')).slice(0, 8) : '00000000';
}

// What a ticket says, read from its first part.
const saysOf = ticket => JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString());

// A ticket made by someone WITHOUT the secret: every part well shaped, the two marks guessed.
function strangersTicket(device = 'device-aaaa') {
  const p = b64url(JSON.stringify({ d: device, t: Date.now(), r: randomHex(16), n: randomHex(4) }));
  return p + '.' + randomHex(8) + '.' + randomHex(32);
}

// A copy of the Worker with nothing in memory, as Cloudflare starts one whenever it likes.
let instances = 2;
const freshInstance = async () => (await import('../src/index.js?instance=' + ++instances)).default;
const randomHex = bytes =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');

// A second copy of the Worker with nothing in memory, as Cloudflare starts one whenever it likes.
// It shares the meeting point (hub.js is the same module) and nothing else.
const { default: otherInstance } = await import('../src/index.js?instance=2');
const openAt = async (instance, ticket) => {
  const r = await instance.fetch(
    new Request('https://' + HOST + '/remote/connect?ticket=' + encodeURIComponent(ticket), {
      headers: { Upgrade: 'websocket' },
    }),
    env
  );
  return r.status === 101 ? r.webSocket : { refused: r.status, body: await r.json() };
};

// What the meeting point keeps: the records of devices ("d:…"), and the whole of it.
const hubState = async () => hubs.state(await hmacHex(SECRET, 'hub'));
const records = async () => [...(await hubState()).kv.keys()].filter(key => key.startsWith('d:'));

// The meeting point asked directly, as the Worker asks it.
const askHub = async path => {
  const r = await hubs.get(await hmacHex(SECRET, 'hub')).fetch(new Request('https://hub' + path));
  return { status: r.status, body: r.status === 101 ? null : await r.json() };
};

// Is this secret taken by the relay? A relay that is not set up answers 503 to everything; one
// that is set up refuses the nonsense ticket with 401 (and wakes nothing for it).
async function secretTaken(secret) {
  fresh(secret);
  const r = await call('GET', '/remote/connect?ticket=x', { Upgrade: 'websocket' });
  return r.status === 401;
}

await test('a device with the secret gets a ticket and connects; the hello names who is online', async () => {
  const t = await ticketFor('device-aaaa');
  eq(t.status, 200);
  ok(typeof t.body.ticket === 'string' && t.body.expires_in === 60, 'a ticket for a minute');
  const wa = await open(t.body.ticket);
  ok(!wa.refused, 'connected');
  eq(wa.json()[0].kind, 'hello');
  eq(wa.json()[0].online.length, 0);
  const wb = await open((await ticketFor('device-bbbb')).body.ticket);
  eq(JSON.stringify(wb.json()[0].online), '["device-aaaa"]');
  const told = wa.json().at(-1);
  ok(
    told.kind === 'presence' && told.device === 'device-bbbb' && told.online === true,
    'A is told'
  );
});

await test('no secret, no ticket: a wrong secret, a missing header and a proof for another call are refused', async () => {
  eq((await ticketFor('device-aaaa', { secret: OTHER })).status, 401, 'wrong secret');
  eq((await call('POST', '/remote/ticket')).status, 401, 'no headers');
  const forPresence = await headers('device-aaaa', 'presence');
  eq((await call('POST', '/remote/ticket', forPresence)).status, 401, 'a presence proof');
  const other = await headers('device-aaaa');
  other['X-Relay-Device'] = 'device-bbbb';
  eq((await call('POST', '/remote/ticket', other)).status, 401, 'a proof made for another device');
  eq(hubs.objects(), 0, 'none of them reached the hub');
});

await test('a proof made for another address is worth nothing here', async () => {
  const elsewhere = await headers('device-aaaa', 'ticket', { host: 'other-relay.example' });
  const r = await call('POST', '/remote/ticket', elsewhere);
  eq(r.status, 401);
  eq((await r.json()).error, 'invalid_proof');
  const upper = await headers('device-aaaa', 'ticket', { host: HOST });
  const viaUpper = await worker.fetch(
    new Request('https://RELAY.test/remote/ticket', { method: 'POST', headers: upper }),
    env
  );
  eq(viaUpper.status, 200, 'the same host in capitals is the same host');
});

await test('a proof counts once and only near the relay clock; a repeat is told the newest time', async () => {
  const h = await headers('device-aaaa');
  eq((await call('POST', '/remote/ticket', h)).status, 200, 'first use');
  const again = await call('POST', '/remote/ticket', h);
  eq(again.status, 401, 'the same proof again');
  const body = await again.json();
  eq(body.error, 'proof_used');
  eq(body.after, Number(h['X-Relay-Time']), 'the newest time it holds');
  const old = await ticketFor('device-aaaa', { time: Date.now() - 5 * 60 * 1000 });
  eq(old.status, 401, 'five minutes old');
  eq(old.body.error, 'clock_off');
  eq((await ticketFor('device-aaaa', { time: Date.now() + 5 * 60 * 1000 })).status, 401, 'ahead');
  const wrongAndOld = await ticketFor('device-aaaa', {
    secret: OTHER,
    time: Date.now() - 5 * 60 * 1000,
  });
  eq(wrongAndOld.body.error, 'invalid_proof', 'without the secret nobody learns about the clock');
});

await test('a ticket opens one connection, and a changed or made-up ticket opens none', async () => {
  const t = (await ticketFor('device-aaaa')).body.ticket;
  ok(!(await open(t)).refused, 'first use');
  const second = await open(t);
  eq(second.refused, 401, 'second use');
  eq(second.body.error, 'ticket_used');
  const [p, sig] = (await ticketFor('device-aaaa')).body.ticket.split('.');
  eq((await open(p + '.' + sig.replace(/.$/, c => (c === '0' ? '1' : '0')))).refused, 401, 'sig');
  eq((await open('nonsense')).refused, 401, 'no ticket at all');
  const noUpgrade = await call('GET', '/remote/connect?ticket=' + encodeURIComponent(t));
  eq(noUpgrade.status, 426, 'not a WebSocket request');
});

await test('a ticket signed by a holder of the secret opens nothing and blocks nobody', async () => {
  // never issued: a correct signature is not enough
  eq((await open(await forged('device-aaaa', Date.now()))).refused, 401, 'made now');

  // dated far ahead, to become "the newest ticket" of the device for ever
  eq((await open(await forged('device-aaaa', Date.UTC(2100, 0, 1)))).refused, 401, 'for 2100');
  eq((await open(await forged('device-aaaa', Date.now() - 61000))).refused, 401, 'an old one');

  // the real device is not held back by any of it
  const real = await open((await ticketFor('device-aaaa')).body.ticket);
  ok(!real.refused, 'the real device still connects');

  // an issued ticket that a newer one replaced is dead too
  const first = (await ticketFor('device-aaaa')).body.ticket;
  const newer = (await ticketFor('device-aaaa')).body.ticket;
  eq((await open(first)).refused, 401, 'an issued ticket that a newer one replaced');
  ok(!(await open(newer)).refused, 'the newest issued ticket works');
});

await test('reading the list between ticket and connect leaves the ticket good', async () => {
  const t = (await ticketFor('device-aaaa')).body.ticket;
  const r = await call('GET', '/remote/presence', await headers('device-aaaa', 'presence'));
  eq(r.status, 200, 'the list');
  ok(!(await open(t)).refused, 'the ticket issued before it still connects');
});

await test('a ticket dated ahead of the relay clock is refused at the door', async () => {
  const real = (await ticketFor('device-aaaa')).body.ticket;

  // The issued random part under a time one hour ahead, with the door mark of a holder of the
  // secret, shown to a copy of the Worker that holds no key yet: a ticket that got past the shape
  // check there would make that copy ask the meeting point for the key.
  const copy = await freshInstance();
  const ahead = await selfSigned('device-aaaa', saysOf(real).r, { t: Date.now() + 3600000 });
  let wakes = hubs.wakes;
  eq((await openAt(copy, ahead)).refused, 401);
  eq(hubs.wakes, wakes, 'and never reaches the meeting point');

  // the same for one longer than a ticket can be (600 characters), otherwise well made
  const long = await selfSigned('device-aaaa', saysOf(real).r, { padding: 'x'.repeat(600) });
  ok(long.length > 600, 'longer than 600');
  eq((await openAt(copy, long)).refused, 401, 'too long');
  eq(hubs.wakes, wakes, 'nor does that one');

  // (a well-made one of a holder does get that far, once: the control for the two above)
  wakes = hubs.wakes;
  eq((await openAt(copy, await selfSigned('device-aaaa'))).refused, 401);
  eq(hubs.wakes, wakes + 1, 'a well-shaped ticket of a holder makes a fresh copy ask for the key');
  ok(!(await open(real)).refused, 'the real one still connects');
});

await test('a full relay forgets computers gone for 90 days when a new one arrives', async () => {
  for (let i = 0; i < 32; i++)
    eq((await ticketFor('gone-id-' + String(i).padStart(4, '0'))).status, 200, 'id ' + i);
  eq((await ticketFor('new-computer')).status, 429, 'full today');
  later(91 * 86400 * 1000);
  clock = Date.now();
  eq((await ticketFor('new-computer')).status, 200, 'after 91 days the old ones are forgotten');
  eq((await records()).join(), 'd:new-computer', 'only the new one is kept');
});

await test('a computer that is connected is never forgotten, however long ago it connected', async () => {
  ok(!(await open((await ticketFor('always-on-0001')).body.ticket)).refused, 'connected');
  for (let i = 0; i < 31; i++)
    eq((await ticketFor('gone-id-' + String(i).padStart(4, '0'))).status, 200, 'id ' + i);
  later(91 * 86400 * 1000);
  clock = Date.now();
  eq((await ticketFor('new-computer')).status, 200, 'room is made after 91 days');
  eq(
    (await records()).join(),
    'd:always-on-0001,d:new-computer',
    'the one still connected keeps its record'
  );
});

await test('a relay secret that is a row of keys or too long is refused; 64 hex characters pass', async () => {
  for (const s of ['qwertyuiopasdfghjklzxcvbnm123456', 'kR7_tQ2mXv9LpZ4wYb6N'.repeat(11)]) {
    fresh(s);
    eq(
      (await call('POST', '/remote/ticket', await headers('device-aaaa', 'ticket', { secret: s })))
        .status,
      503,
      s.slice(0, 12)
    );
  }
  const hex = '9f3c1e7a52d84b06c7e1a93f5d2b8046e3a7c15d9b02f48e6a1d7c3b95e0f284';
  fresh(hex);
  eq((await ticketFor('device-aaaa', { secret: hex })).status, 200, 'hex');
});

await test('a secret typed along the keyboard is refused, with a capital, twice over or backward; random ones never are', async () => {
  const typed = [
    // One capital gave it three kinds of character
    'Qwertyuiopasdfghjklzxcvbnm123456',
    // two rows end to end, twice over: long enough to need no kinds
    'qwertyuiopasdfghjklzxc'.repeat(2) + 'vbnm',
    // backward, and with capitals in the middle
    'MNBVCXZlkjhgfdsaPOIUYTREWQ098765',
    // the alphabet with digits and a sign
    'Abcdefghijklmnopqrstuvwxyz_12345',
    // the row of digits with Shift held, among letters that would pass
    'kR7_tQ2mXv9LpZ4w!@#$%^&*()Yb6NcH1s',
    // a run in the middle of something that otherwise looks made up
    'kR7_tQ2mXv9LpZ4wasdfghjYb6NcH1sDf8G',
  ];
  for (const secret of typed) ok(!(await secretTaken(secret)), 'taken: ' + secret);
  ok(await secretTaken(SECRET), 'the test secret itself is taken');

  // Two secrets a random run really produced, each refused by an earlier form of the rule: 64 hex
  // characters that lack one of the sixteen, and 43 characters as `npm run secret` prints them
  // with letters only (no digit, no sign).
  ok(
    await secretTaken('83121346880aab15ad6544b5fdf3f9b8b5eb2acecfec2082960938cb409030b3'),
    'hex without a 7'
  );
  ok(await secretTaken('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdzYoTA'), 'letters only, 43 long');
  ok(
    !(await secretTaken('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdz')),
    'letters only and shorter than 40 is still refused'
  );

  // what `npm run secret` prints (32 random bytes, base64url) and 64 random hex characters
  for (let i = 0; i < 300; i++) {
    const printed = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    ok(await secretTaken(printed), 'a secret as npm run secret prints it was refused: ' + printed);
    const hex = randomHex(32);
    ok(await secretTaken(hex), '64 random hex characters were refused: ' + hex);
  }
});

await test('a signed ticket whose random part is not 32 hex characters never reaches the meeting point', async () => {
  await ticketFor('device-aaaa');

  // shown to a copy with no key: one that passed the shape check would make it ask for the key
  const copy = await freshInstance();
  for (const r of ['', 'x', 'G'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 5, null]) {
    const made = await selfSigned('device-aaaa', r, { r });
    const wakes = hubs.wakes;
    eq((await openAt(copy, made)).refused, 401, 'random part ' + JSON.stringify(r));
    eq(hubs.wakes, wakes, 'no wake for ' + JSON.stringify(r));
  }

  // the same for the name of the key and for the device id
  for (const more of [{ n: 'short' }, { n: 5 }, { n: 'G'.repeat(8) }, { d: 'bad id!' }, { d: 7 }]) {
    const wakes = hubs.wakes;
    eq((await openAt(copy, await selfSigned('device-aaaa', undefined, more))).refused, 401);
    eq(hubs.wakes, wakes, 'no wake for ' + JSON.stringify(more));
  }
});

await test('a ticket is dead after a minute', async () => {
  const t = (await ticketFor('device-aaaa')).body.ticket;
  later(61 * 1000);
  const r = await open(t);
  eq(r.refused, 401);
  eq(r.body.error, 'invalid_ticket');
});

await test('a ticket made under one secret is useless after the secret changes', async () => {
  const t = (await ticketFor('device-aaaa')).body.ticket;
  env = { ...env, RELAY_SECRET: OTHER };
  eq((await open(t)).refused, 401);
});

await test('a relay with no secret, a short one or a pattern answers nothing but "not set up"', async () => {
  const bad = [
    null,
    '',
    'short',
    'x'.repeat(31),
    'a'.repeat(32),
    'password'.repeat(4),
    '0123456789'.repeat(4),
    'has space ' + SECRET,
  ];
  for (const s of bad) {
    fresh(s);
    const r = await call('POST', '/remote/ticket', await headers('device-aaaa'));
    eq(r.status, 503, 'secret ' + JSON.stringify(s));
    eq((await r.json()).error, 'relay_not_set_up');
    eq((await call('GET', '/remote/connect?ticket=x', { Upgrade: 'websocket' })).status, 503);
  }
});

await test('a sealed message goes to the device it names and nowhere else, unread and unchanged', async () => {
  const { wa, wb } = await join2();
  const wc = await open((await ticketFor('device-cccc')).body.ticket);
  const before = wc.inbox.length,
    text = env1('device-aaaa', 'device-bbbb', 'AAAA-sealed-BBBB');
  await wa.put(text);
  eq(wb.inbox.at(-1), text, 'B gets the same text');
  eq(wc.inbox.length, before, 'C gets nothing');
  const kv = [...hubs.state(await hmacHex(SECRET, 'hub')).kv.values()];
  ok(!JSON.stringify(kv).includes('AAAA-sealed-BBBB'), 'nothing of it is stored');
});

await test('a device cannot send as another, to itself, to nobody, or anything that is not an envelope', async () => {
  const { wa, wb } = await join2();
  const bad = [
    env1('device-bbbb', 'device-bbbb'),
    env1('device-aaaa', 'device-aaaa'),
    env1('device-aaaa', ''),
    env1('device-aaaa', 'device-bbbb', 'x', 'kick'),
    JSON.stringify({ v: 1, kind: 'msg', from: 'device-aaaa', to: 'device-bbbb', body: 5 }),
    'not json',
  ];
  const got = wb.inbox.length;
  for (const b of bad) {
    await wa.put(b);
    eq(wa.json().at(-1).code, 'invalid', b.slice(0, 40));
  }
  eq(wb.inbox.length, got, 'B received none of them');
  await wa.put(env1('device-aaaa', 'device-zzzz'));
  eq(wa.json().at(-1).code, 'offline', 'a device that is not connected');
  await wa.put(env1('device-aaaa', 'device-bbbb', 'x'.repeat(9000)));
  eq(wa.json().at(-1).code, 'too_large');
});

await test('limits: 120 messages a minute, closed at four times that; 60 calls an hour; 8 other devices', async () => {
  const { wa, wb } = await join2();
  for (let i = 0; i < 120; i++) await wa.put(env1('device-aaaa', 'device-bbbb'));
  const delivered = wb.inbox.length;
  await wa.put(env1('device-aaaa', 'device-bbbb'));
  eq(wa.json().at(-1).code, 'rate_limited', 'message 121');
  eq(wb.inbox.length, delivered, 'and it is not delivered');
  for (let i = 0; i < 4 * 120; i++) if (wa.readyState === 1) await wa.put('x');
  eq(wa.closed?.code, 4008, 'a flood closes the socket');

  fresh();
  let last;
  for (let i = 0; i < 61; i++) last = await ticketFor('device-aaaa');
  eq(last.status, 429, 'ticket 61 in one hour');
  eq((await ticketFor('device-bbbb')).status, 200, 'another device is not held back by it');

  fresh();
  for (let i = 0; i < 8; i++)
    ok(!(await open((await ticketFor('device-000' + i)).body.ticket)).refused);
  const ninth = await open((await ticketFor('device-0009')).body.ticket);
  eq(ninth.refused, 429, 'a ninth device');
  eq(ninth.body.error, 'too_many_devices');
});

await test('the relay keeps a record of 32 device ids and no more, whoever asks', async () => {
  for (let i = 0; i < 32; i++)
    eq((await ticketFor('made-up-' + String(i).padStart(4, '0'))).status, 200, 'id ' + i);
  const over = await ticketFor('made-up-9999');
  eq(over.status, 429, 'id 33');
  eq(over.body.error, 'too_many_ids');
  eq((await ticketFor('made-up-0000')).status, 200, 'a known id is still served');
  eq((await records()).length, 32, 'records kept');
  const viaList = await call('GET', '/remote/presence', await headers('made-up-8888', 'presence'));
  eq(viaList.status, 429, 'nor through the list');
});

await test('a device that connects again replaces its old socket, and leaving is told to the others', async () => {
  const { wa, wb } = await join2();
  const wa2 = await open((await ticketFor('device-aaaa')).body.ticket);
  eq(wa.closed?.code, 4001, 'the old socket is closed as replaced');
  ok(!wa2.refused, 'the new one is open');
  await wa2.hangUp();
  const told = wb.json().at(-1);
  ok(
    told.kind === 'presence' && told.online === false && told.device === 'device-aaaa',
    'B is told'
  );
});

await test('the list needs its own proof, counts once and is counted like a ticket', async () => {
  await join2();
  eq((await call('GET', '/remote/presence')).status, 401, 'no proof');
  const withTicketProof = await headers('device-aaaa', 'ticket');
  eq((await call('GET', '/remote/presence', withTicketProof)).status, 401, 'a ticket proof');
  const h = await headers('device-aaaa', 'presence');
  const r = await call('GET', '/remote/presence', h);
  eq(r.status, 200);
  eq((await r.json()).devices.filter(d => d.online).length, 2);
  eq((await call('GET', '/remote/presence', h)).status, 401, 'the same proof again');
  let last;
  for (let i = 0; i < 60; i++)
    last = await call('GET', '/remote/presence', await headers('device-aaaa', 'presence'));
  eq(last.status, 429, 'over the hour count, together with the ticket asked before');
});

await test('a ticket signed with the secret never wakes the meeting point: tickets are signed with a key only the relay has', async () => {
  // one honest ticket first, so this Worker has the key in memory
  const real = (await ticketFor('device-aaaa')).body.ticket;
  const wakes = hubs.wakes;
  for (let i = 0; i < 300; i++) {
    const made = await open(await selfSigned(i % 2 ? 'device-aaaa' : 'made-up-' + i));
    eq(made.refused, 401, 'self-signed ticket ' + i);
    eq(made.body.error, 'invalid_ticket');
  }
  eq(hubs.wakes, wakes, '300 well-formed tickets of a holder of the secret woke nothing');
  ok(!(await open(real)).refused, 'and the honest ticket still connects');

  // the key is not the secret and not anything made from it alone
  const [payload, signature] = real.split('.');
  ok(signature !== (await hmacHex(SECRET, 'signed-ticket:' + payload)), 'not signed by the secret');
});

await test('the ticket key stays inside the relay: no answer to a device carries it', async () => {
  const issued = await call('POST', '/remote/ticket', await headers('device-aaaa'));
  const body = await issued.json();
  eq(Object.keys(body).sort().join(), 'expires_in,ticket', 'a ticket answer holds two things');
  const key = (await hubState()).kv.get('k');
  ok(/^[0-9a-f]{64}$/.test(key), 'the meeting point keeps a key of 32 random bytes');
  const list = await call('GET', '/remote/presence', await headers('device-aaaa', 'presence'));
  const said = JSON.stringify(body) + (await list.text());
  ok(!said.includes(key), 'neither the ticket nor the list holds the key');
  eq((await call('GET', '/key')).status, 404, 'no path of the relay leads to it');
  eq((await call('GET', '/remote/key')).status, 404);
  eq((await askHub('/ask?d=device-aaaa&p=' + tick())).body.k, undefined, 'a list read gets none');

  // the same key every time: a ticket issued before the object slept is still good
  const before = (await ticketFor('device-bbbb')).body.ticket;
  hubs.hibernate();
  eq((await hubState()).kv.get('k'), key, 'kept, not made again');
  ok(!(await open(before)).refused, 'a ticket from before the sleep connects');
});

await test('a ticket shown again is answered at the door: the meeting point is asked about it once', async () => {
  const used = (await ticketFor('device-aaaa')).body.ticket;
  ok(!(await open(used)).refused, 'first use');
  let wakes = hubs.wakes;
  for (let i = 0; i < 100; i++) {
    const again = await open(used);
    eq(again.refused, 401);
    eq(again.body.error, 'ticket_used');
  }
  eq(hubs.wakes, wakes, '100 repeats of a used ticket woke nothing');

  // an issued ticket that a newer one replaced: asked once, then answered here
  const replaced = (await ticketFor('device-bbbb')).body.ticket;
  await ticketFor('device-bbbb');
  wakes = hubs.wakes;
  for (let i = 0; i < 50; i++) eq((await open(replaced)).body.error, 'invalid_ticket');
  eq(hubs.wakes, wakes + 1, 'the meeting point was asked once about the replaced ticket');
});

await test('a new instance of the Worker asks for the key once; the meeting point alone still refuses a used ticket', async () => {
  const used = (await ticketFor('device-aaaa')).body.ticket;
  ok(!(await open(used)).refused, 'used on the first instance');
  let wakes = hubs.wakes;

  // the other instance has no memory: it asks for the key (one wake), then refuses by itself
  for (let i = 0; i < 50; i++)
    eq((await openAt(otherInstance, await selfSigned('device-aaaa'))).refused, 401);
  eq(hubs.wakes, wakes + 1, 'one wake for the key, none for the 50 self-signed tickets');

  // it never saw the used ticket answered, so it asks, and the meeting point's own record says no
  wakes = hubs.wakes;
  const there = await openAt(otherInstance, used);
  eq(there.refused, 401);
  eq(there.body.error, 'ticket_used', "the meeting point's own record");
  eq(hubs.wakes, wakes + 1, 'asked once');
  eq((await openAt(otherInstance, used)).body.error, 'ticket_used');
  eq(hubs.wakes, wakes + 1, 'and not again');
});

await test('the meeting point by itself: only the issued random part connects, once, and the record forgets it', async () => {
  const real = (await ticketFor('device-aaaa')).body.ticket;
  const { r } = JSON.parse(Buffer.from(real.split('.')[0], 'base64url').toString());
  eq((await (await hubState()).storage.get('d:device-aaaa')).i, r, 'the issued part is on record');
  const other = await askHub('/connect?d=device-aaaa&r=' + randomHex(16));
  eq(other.status, 401, 'another random part');
  eq(other.body.error, 'invalid_ticket');
  eq((await askHub('/connect?d=device-aaaa&r=')).body.error, 'invalid_ticket', 'none at all');
  eq((await askHub('/connect?d=never-seen-01&r=' + r)).body.error, 'invalid_ticket', 'another id');
  eq((await askHub('/connect?d=device-aaaa&r=' + r)).status, 101, 'the issued one');
  const after = await (await hubState()).storage.get('d:device-aaaa');
  eq(after.i, '', 'the issued part is emptied at the connect');
  eq(after.u, r, 'and kept as the used one');
  eq((await askHub('/connect?d=device-aaaa&r=' + r)).body.error, 'ticket_used', 'a second time');
});

await test('a full relay uses up no ticket: the same ticket connects when there is room', async () => {
  const sockets = [];
  for (let i = 0; i < 8; i++)
    sockets.push(await open((await ticketFor('device-000' + i)).body.ticket));
  const ninth = (await ticketFor('device-0009')).body.ticket;
  eq((await open(ninth)).refused, 429, 'no room');
  await sockets[0].hangUp();
  ok(!(await open(ninth)).refused, 'the same ticket, now that one left');

  // and a device that is already connected can always connect again at the limit
  const again = await open((await ticketFor('device-0003')).body.ticket);
  ok(!again.refused, 'a reconnect at eight devices');
  eq(sockets[3].closed?.code, 4001, 'its old socket is closed as replaced');
});

await test('a proof made with the phone key is taken; that key signs nothing else and works at no other address', async () => {
  const phoneKey = await hmacHex(SECRET, 'phone-key:' + HOST);
  const time = tick();
  const asPhone = (key, what = 'ticket', host = HOST) =>
    hmacHex(key, `proof:${what}:${host}:ph-0123456789:${time}`).then(proof => ({
      'X-Relay-Device': 'ph-0123456789',
      'X-Relay-Time': String(time),
      'X-Relay-Proof': proof,
    }));
  const elsewhere = await hmacHex(SECRET, 'phone-key:other-relay.example');
  eq((await call('POST', '/remote/ticket', await asPhone(elsewhere))).status, 401, 'another host');
  eq(
    (await call('POST', '/remote/ticket', await asPhone('f'.repeat(64)))).status,
    401,
    'a made-up key'
  );
  eq(
    (await call('POST', '/remote/ticket', await asPhone(phoneKey, 'presence'))).status,
    401,
    'a proof for the other call'
  );
  const good = await call('POST', '/remote/ticket', await asPhone(phoneKey));
  eq(good.status, 200, 'the phone key of this host');
  const ticket = (await good.json()).ticket;
  ok(!(await open(ticket)).refused, 'and its ticket connects');

  // the phone key finds no meeting point and signs no ticket
  ok((await hmacHex(phoneKey, 'hub')) !== (await hmacHex(SECRET, 'hub')), 'not the hub name');
  const p = ticket.split('.')[0];
  const own = p + '.' + (await hmacHex(phoneKey, 'signed-ticket:' + p));
  eq((await open(own)).refused, 401, 'a ticket signed with the phone key');
});

await test('a device id of the wrong shape proves nothing, and a ticket with a third part is no ticket', async () => {
  for (const id of ['short', 'x'.repeat(65), 'has space1', 'semi;colon1']) {
    const r = await call('POST', '/remote/ticket', await headers(id));
    eq(r.status, 401, 'id ' + id);
    eq((await r.json()).error, 'invalid_proof');
  }
  eq(hubs.objects(), 0, 'none of them reached the meeting point');
  const real = (await ticketFor('device-aaaa')).body.ticket;
  eq((await open(real + '.more')).refused, 401, 'a part too many');
  const [says, door, signature] = real.split('.');
  eq((await open(says + '.' + signature)).refused, 401, 'no door mark');
  eq((await open(says + '.' + door)).refused, 401, 'no signature');
  eq((await open(real + 'x'.repeat(600))).refused, 401, 'longer than a ticket can be');
  ok(!(await open(real)).refused, 'the ticket itself is still good');
});

await test('the hour and the minute start over: calls and messages are counted per hour and per minute', async () => {
  let last;
  for (let i = 0; i < 61; i++) last = await ticketFor('device-aaaa');
  eq(last.status, 429, 'call 61 in one hour');
  later(3600 * 1000 + 1000);
  clock = Date.now();
  eq((await ticketFor('device-aaaa')).status, 200, 'the next hour');

  fresh();
  Date.now = realNow;
  clock = Date.now();
  const { wa, wb } = await join2();
  for (let i = 0; i < 121; i++) await wa.put(env1('device-aaaa', 'device-bbbb'));
  eq(wa.json().at(-1).code, 'rate_limited', 'message 121 in one minute');
  later(61 * 1000);
  const text = env1('device-aaaa', 'device-bbbb', 'the-next-minute');
  await wa.put(text);
  eq(wb.inbox.at(-1), text, 'delivered in the next minute');
});

await test('what is not an envelope is refused: bytes, a version that is no whole number, a too long receiver', async () => {
  const { wa, wb } = await join2();
  const got = wb.inbox.length;
  await wa.put(new Uint8Array([1, 2, 3]));
  eq(wa.json().at(-1).code, 'invalid', 'bytes');

  // many bytes are still "not text", not "a text that is too long"
  await wa.put(new Uint8Array(9000));
  eq(wa.json().at(-1).code, 'invalid', '9,000 bytes');
  for (const v of [1.5, '1', null]) {
    await wa.put(
      JSON.stringify({ v, kind: 'msg', from: 'device-aaaa', to: 'device-bbbb', body: 'x' })
    );
    eq(wa.json().at(-1).code, 'invalid', 'version ' + JSON.stringify(v));
  }
  await wa.put(env1('device-aaaa', 'd'.repeat(65)));
  eq(wa.json().at(-1).code, 'invalid', 'a receiver of 65 characters');
  await wa.put(env1('device-aaaa', 'd'.repeat(64)));
  eq(wa.json().at(-1).code, 'offline', 'one of 64 is only not connected');
  eq(wb.inbox.length, got, 'B received none of them');
});

await test('a replaced socket says why before it closes, and its late goodbye is not told as leaving', async () => {
  const { wa, wb } = await join2();
  await open((await ticketFor('device-aaaa')).body.ticket);
  const last = wa.json().at(-1);
  ok(last.kind === 'bye' && last.reason === 'replaced', 'the reason goes ahead of the close');
  eq(wa.closed?.code, 4001);
  const told = wb.inbox.length;

  // the old socket's close arrives after the new one is in place
  await wa.hangUp();
  eq(wb.inbox.length, told, 'B is not told that A left: A is still here on its new socket');
  const list = await call('GET', '/remote/presence', await headers('device-bbbb', 'presence'));
  const ids = (await list.json()).devices.filter(d => d.online).map(d => d.id);
  eq(ids.sort().join(), 'device-aaaa,device-bbbb', 'and A is still listed as connected');
});

await test('the list holds only devices that connected at some time, not every id that asked for a ticket', async () => {
  await join2();
  await ticketFor('asked-only-01');
  const list = await call('GET', '/remote/presence', await headers('device-aaaa', 'presence'));
  const ids = (await list.json()).devices.map(d => d.id);
  eq(ids.sort().join(), 'device-aaaa,device-bbbb');
});

// A ticket asked of one given copy of the Worker.
async function ticketAt(instance, device) {
  const r = await instance.fetch(
    new Request('https://' + HOST + '/remote/ticket', {
      method: 'POST',
      headers: await headers(device),
    }),
    env
  );
  return (await r.json()).ticket;
}

await test('a stranger, with no secret, cannot wake the meeting point: the door mark is checked before the key is asked for', async () => {
  // a copy with no key yet: the moment a made-up ticket used to make it ask the meeting point
  const copy = await freshInstance();
  for (let i = 0; i < 50; i++) {
    const made = await openAt(copy, strangersTicket());
    eq(made.refused, 401, 'made-up ticket ' + i);
    eq(made.body.error, 'invalid_ticket');
  }
  eq(hubs.wakes, 0, 'the meeting point was never woken');
  eq(hubs.objects(), 0, 'and does not even exist yet: nothing was stored');

  // a real ticket with its door mark changed is no ticket either, and is refused before the key
  const real = await ticketAt(worker, 'device-aaaa');
  const [says, door, signature] = real.split('.');
  const otherDoor = door.replace(/.$/, last => (last === '0' ? '1' : '0'));
  const another = await freshInstance();
  const wakes = hubs.wakes;
  eq((await openAt(another, says + '.' + otherDoor + '.' + signature)).refused, 401, 'wrong door');
  eq(hubs.wakes, wakes, 'no wake for a wrong door mark');
  ok(!(await openAt(another, real)).refused, 'the real ticket connects there');
});

await test('after the meeting point lost its storage, a copy with the old key asks again, at most once a minute', async () => {
  // this copy learns the first key
  ok(!(await open(await ticketAt(worker, 'device-aaaa'))).refused, 'before the wipe');
  const firstKey = (await hubState()).kv.get('k');

  // the storage is emptied (the Durable Object deleted or moved); another copy issues a ticket,
  // which makes the meeting point create a new key
  (await hubState()).kv.clear();
  hubs.hibernate();
  const other = await freshInstance();
  const issued = await ticketAt(other, 'device-aaaa');
  ok((await hubState()).kv.get('k') !== firstKey, 'a new key was made');

  // shown to the copy that still holds the old key: it asks once and takes the ticket
  let wakes = hubs.wakes;
  ok(!(await open(issued)).refused, 'the copy with the old key connects the new ticket');
  eq(hubs.wakes, wakes + 2, 'one wake for the key, one for the connect');

  // A holder of the secret can write any key name into a ticket of their own. That makes this
  // copy ask at most once a minute, not once per ticket.
  wakes = hubs.wakes;
  for (let i = 0; i < 50; i++)
    eq((await open(await selfSigned('device-aaaa', undefined, { n: randomHex(4) }))).refused, 401);
  eq(hubs.wakes, wakes, 'asked a moment ago: 50 made-up key names wake nothing');
  later(61 * 1000);
  for (let i = 0; i < 50; i++)
    eq((await open(await selfSigned('device-aaaa', undefined, { n: randomHex(4) }))).refused, 401);
  eq(hubs.wakes, wakes + 1, 'a minute later: one more question, and only one');
});

await test('calls under many host names leave only a few keys in memory', async () => {
  for (let i = 0; i < 300; i++) {
    const r = await worker.fetch(
      new Request('https://name-' + i + '.example/remote/ticket', {
        method: 'POST',
        headers: await headers('device-aaaa', 'ticket', { secret: OTHER }),
      }),
      env
    );
    eq(r.status, 401, 'name ' + i);
  }
  ok(keysKept() <= 16, 'keys kept ready: ' + keysKept());

  // and the relay still works after the keys it needs were pushed out
  ok(!(await open(await ticketAt(worker, 'device-aaaa'))).refused, 'a ticket and a connect');
});

await test('the phone key speaks for phones only: it gets no ticket and no list under a computer id', async () => {
  const phoneKey = await hmacHex(SECRET, 'phone-key:' + HOST);
  const underPhoneKey = async (device, what) => {
    const time = tick();
    return {
      'X-Relay-Device': device,
      'X-Relay-Time': String(time),
      'X-Relay-Proof': await hmacHex(phoneKey, `proof:${what}:${HOST}:${device}:${time}`),
    };
  };

  // a computer holds a ticket it has not used yet
  const computers = await ticketAt(worker, 'device-aaaa');
  for (const id of ['device-aaaa', 'phone-0123456', 'Ph-0123456789', 'xph-0123456789']) {
    const asked = await call('POST', '/remote/ticket', await underPhoneKey(id, 'ticket'));
    eq(asked.status, 401, 'a ticket for ' + id);
    eq((await asked.json()).error, 'invalid_proof');
    const list = await call('GET', '/remote/presence', await underPhoneKey(id, 'presence'));
    eq(list.status, 401, 'the list as ' + id);
  }
  ok(!(await open(computers)).refused, "the computer's own ticket was not cancelled by any of it");
  const phone = await call(
    'POST',
    '/remote/ticket',
    await underPhoneKey('ph-0123456789', 'ticket')
  );
  eq(phone.status, 200, 'a phone id gets its ticket');
  const list = await call(
    'GET',
    '/remote/presence',
    await underPhoneKey('ph-0123456789', 'presence')
  );
  eq(list.status, 200, 'and the list');
});

await test('a key that is not a key is taken from nowhere: not from the meeting point, not from its storage', async () => {
  // a stand-in meeting point that answers with something that is no key
  const answering = body => ({
    RELAY_SECRET: SECRET,
    RELAY_HUB: {
      idFromName: name => name,
      get: () => ({ fetch: async () => new Response(JSON.stringify(body), { status: 200 }) }),
    },
  });
  const quiet = console.error;
  console.error = () => {};
  try {
    for (const bad of ['not-a-key', 'a'.repeat(63), 'G'.repeat(64), 5, undefined]) {
      const copy = await freshInstance();
      const asked = await copy.fetch(
        new Request('https://' + HOST + '/remote/ticket', {
          method: 'POST',
          headers: await headers('device-aaaa'),
        }),
        answering({ ok: true, k: bad })
      );
      eq(asked.status, 500, 'a ticket signed with ' + JSON.stringify(bad));
      const shown = await copy.fetch(
        new Request(
          'https://' +
            HOST +
            '/remote/connect?ticket=' +
            encodeURIComponent(await selfSigned('device-aaaa')),
          { headers: { Upgrade: 'websocket' } }
        ),
        answering({ k: bad })
      );
      eq(shown.status, 500, 'a connect judged with ' + JSON.stringify(bad));
    }
  } finally {
    console.error = quiet;
  }

  // the meeting point's own storage holding something that is no key: a new one is made
  await ticketFor('device-aaaa');
  (await hubState()).kv.set('k', 'not-a-key');
  hubs.hibernate();
  const after = await ticketFor('device-bbbb');
  eq(after.status, 200, 'a ticket is still issued');
  ok(/^[0-9a-f]{64}$/.test((await hubState()).kv.get('k')), 'with a real key made in its place');
  ok(!(await open(after.body.ticket)).refused, 'and it connects');
});

await test('the memory of answered tickets stops at 4,096 and makes room once tickets are dead', async () => {
  // its own copy of the Worker, and several relays (one per secret): one relay issues 1,920
  // tickets an hour at most, and 4,097 live ones are needed inside a minute
  const copy = await freshInstance();
  const relays = [];
  for (let i = 0; i < 3; i++) {
    const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    const relay = { RELAY_SECRET: secret };
    relay.RELAY_HUB = createHubNamespace(RelayHub, () => relay);
    relays.push(relay);
  }
  const wakesOf = () => relays.reduce((sum, relay) => sum + relay.RELAY_HUB.wakes, 0);
  const at = (relay, path, init) => copy.fetch(new Request('https://' + HOST + path, init), relay);
  const show = (relay, ticket) =>
    at(relay, '/remote/connect?ticket=' + encodeURIComponent(ticket), {
      headers: { Upgrade: 'websocket' },
    });

  // one ticket, connected and hung up again: the copy remembers it as used
  async function useOne(relay, device) {
    const asked = await at(relay, '/remote/ticket', {
      method: 'POST',
      headers: await headers(device, 'ticket', { secret: relay.RELAY_SECRET }),
    });
    eq(asked.status, 200, 'a ticket for ' + device);
    const { ticket } = await asked.json();
    const opened = await show(relay, ticket);
    eq(opened.status, 101, 'connected ' + device);
    await opened.webSocket.hangUp();
    return ticket;
  }
  const used = [];
  for (let i = 0; i < 4097; i++) {
    const relay = relays[i % 3];
    const device = 'device-' + String(i % 96).padStart(4, '0');
    used.push({ relay, ticket: await useOne(relay, device) });
  }

  // the first 4,096 are answered at the door; number 4,097 found the memory full
  let wakes = wakesOf();
  eq((await show(used[0].relay, used[0].ticket)).status, 401);
  eq((await show(used[4095].relay, used[4095].ticket)).status, 401);
  eq(wakesOf(), wakes, 'remembered tickets wake nothing');
  eq((await show(used[4096].relay, used[4096].ticket)).status, 401);
  eq((await show(used[4096].relay, used[4096].ticket)).status, 401);
  eq(wakesOf(), wakes + 2, 'the one over the limit is asked of the meeting point each time');

  // a minute later all of them are dead; the next used ticket makes room and is remembered
  later(61 * 1000);
  clock = Date.now();
  const next = await useOne(relays[0], 'device-0000');
  wakes = wakesOf();
  eq((await show(relays[0], next)).status, 401);
  eq(wakesOf(), wakes, 'room was made: the new ticket is remembered');
});

await test('the edges of the secret rule: blanks around it are taken off, and one piece written over and over is refused', async () => {
  // saved with a line end or blanks around it: the same secret as without
  for (const around of [SECRET + '\n', '  ' + SECRET + ' ', SECRET + '\r\n']) {
    fresh(around);
    eq((await ticketFor('device-aaaa', { secret: SECRET })).status, 200, JSON.stringify(around));
  }

  // a blank inside is still no secret
  ok(!(await secretTaken(SECRET.slice(0, 20) + ' ' + SECRET.slice(20))), 'a blank inside');
  const repeated = [
    // these passed
    'MyDogRex2019!MyDogRex2019!MyDogRex',
    'aB3$eF6&hJ9*'.repeat(4),
    'kR7_tQ2mXv9LpZ4wYb6N'.repeat(2),
    'kR7_tQ2mXv9LpZ4wYb6NcH1'.repeat(3).slice(0, 60),
  ];
  for (const secret of repeated) ok(!(await secretTaken(secret)), 'taken: ' + secret);

  // not a repeat: the same piece twice with one character changed
  ok(await secretTaken('kR7_tQ2mXv9LpZ4wYb6N' + 'kR7_tQ2mXv9LpZ4wYb6M'), 'nearly a repeat');
});

await test('nothing is kept in memory: after the object sleeps, routing still works', async () => {
  const { wa, wb } = await join2();
  hubs.hibernate();
  const text = env1('device-aaaa', 'device-bbbb', 'after-sleep');
  await wa.put(text);
  eq(wb.inbox.at(-1), text);
  const wakes = hubs.wakes;
  await wa.put('ping');
  eq(wa.inbox.at(-1), 'pong');
  eq(hubs.wakes, wakes, 'a ping is answered without waking the object');
});

await test('no timer or alarm in the relay (either keeps the object awake and billed), and no log of a header', async () => {
  const words = [
    'setTimeout',
    'setInterval',
    'setAlarm',
    'alarm(',
    'scheduler.',
    "from 'cloudflare:",
  ];
  for (const f of ['hub.js', 'index.js', 'util.js']) {
    const src = readFileSync(join(root, 'src', f), 'utf8');
    for (const word of words) ok(!src.includes(word), f + ' must not contain ' + word);
    const logs = src.match(/console\.\w+\([^)]*\)/g) || [];
    ok(
      logs.every(
        l => !/request|header|secret|ticket\b|url/i.test(l.replace("'relay call failed'", ''))
      ),
      f + ' logs too much: ' + logs
    );
  }
});

// The phone app's page in these tests, and a page that is not it.
const PHONE = 'https://phone.example.com',
  STRANGER = 'https://elsewhere.example.net';

await test('the phone app page can ask: the plain calls answer it by name, errors too', async () => {
  env.PHONE_ORIGINS = 'https://other-phone.example.org, ' + PHONE;
  const from = page => ({ Origin: page });
  for (const path of ['/', '/remote/ticket', '/remote/presence']) {
    const pre = await call('OPTIONS', path, from(PHONE));
    eq(pre.status, 204, 'the question before the call, ' + path);
    eq(pre.headers.get('Access-Control-Allow-Origin'), PHONE, 'named, never *');
    eq(pre.headers.get('Access-Control-Allow-Credentials'), null, 'no cookies');
    ok(/Origin/.test(pre.headers.get('Vary') || ''), 'a cache keeps pages apart');
    ok(
      /X-Relay-Proof/.test(pre.headers.get('Access-Control-Allow-Headers')),
      'the proof headers are allowed'
    );
  }
  eq(hubs.objects(), 0, 'the question reaches no meeting point');
  const good = await call('POST', '/remote/ticket', {
    ...(await headers('device-aaaa')),
    ...from(PHONE),
  });
  eq(good.status, 200);
  eq(good.headers.get('Access-Control-Allow-Origin'), PHONE, 'a ticket can be read by the page');
  ok(/Origin/.test(good.headers.get('Vary') || ''), 'an answer names the page it is for');
  const bad = await call('POST', '/remote/ticket', {
    ...(await headers('device-aaaa', 'ticket', { secret: OTHER })),
    ...from(PHONE),
  });
  eq(bad.status, 401);
  eq(
    bad.headers.get('Access-Control-Allow-Origin'),
    PHONE,
    'and so can a refusal, or the page sees only "network"'
  );
  eq((await bad.json()).error, 'invalid_proof');
  const list = await call('GET', '/remote/presence', {
    ...(await headers('device-aaaa', 'presence')),
    ...from(PHONE),
  });
  eq(list.headers.get('Access-Control-Allow-Origin'), PHONE, 'the list too');
  const front = await call('GET', '/', from(PHONE));
  eq(front.headers.get('Access-Control-Allow-Origin'), PHONE, 'and the front answer');
  eq(front.headers.get('Access-Control-Allow-Credentials'), null);

  // the phone page's own socket: a browser names the page, and that page is let in
  const sock = await call('OPTIONS', '/remote/connect', from(PHONE));
  eq(sock.status, 404, 'the WebSocket call takes no such question');
  eq(sock.headers.get('Access-Control-Allow-Origin'), null);
  const t = (await ticketFor('ph-phone1')).body.ticket;
  const r = await call('GET', '/remote/connect?ticket=' + encodeURIComponent(t), {
    Upgrade: 'websocket',
    ...from(PHONE),
  });
  eq(r.status, 101, 'the phone page connects');
});

await test('another page gets no allowance, and its socket is refused before anything wakes', async () => {
  env.PHONE_ORIGINS = PHONE;
  const from = { Origin: STRANGER };
  for (const path of ['/', '/remote/ticket', '/remote/presence']) {
    const pre = await call('OPTIONS', path, from);
    eq(pre.headers.get('Access-Control-Allow-Origin'), null, 'no allowance, ' + path);
    eq(pre.headers.get('Access-Control-Allow-Headers'), null, 'nor its headers, ' + path);
  }
  const good = await call('POST', '/remote/ticket', { ...(await headers('device-aaaa')), ...from });
  eq(good.headers.get('Access-Control-Allow-Origin'), null, 'its browser cannot read a ticket');
  eq((await call('GET', '/', from)).headers.get('Access-Control-Allow-Origin'), null);

  // look-alikes of the phone's address are other pages too
  for (const page of [PHONE + '.evil.test', 'null', PHONE.replace('https', 'http'), PHONE + '/']) {
    const pre = await call('OPTIONS', '/remote/ticket', { Origin: page });
    eq(pre.headers.get('Access-Control-Allow-Origin'), null, 'not the phone page: ' + page);
  }
  const t = (await ticketFor('device-aaaa')).body.ticket;
  const before = hubs.objects();
  const r = await call('GET', '/remote/connect?ticket=' + encodeURIComponent(t), {
    Upgrade: 'websocket',
    ...from,
  });
  eq(r.status, 403, 'another page opens no connection');
  eq((await r.json()).error, 'origin_not_allowed');
  eq(hubs.objects(), before, 'and wakes no meeting point');

  // the ticket was not used: the app itself (no page address) still connects with it
  ok((await open(t)).refused === undefined, 'an app sends no Origin and is let in as before');
});

await test('no phone address set, or a wildcard written in: no page is allowed', async () => {
  for (const list of [undefined, '', '*', 'null', ' * , https://', 'phone.example.com']) {
    env.PHONE_ORIGINS = list;
    const pre = await call('OPTIONS', '/remote/ticket', { Origin: PHONE });
    eq(pre.headers.get('Access-Control-Allow-Origin'), null, 'PHONE_ORIGINS ' + list);
    const front = await call('GET', '/', { Origin: PHONE });
    eq(front.headers.get('Access-Control-Allow-Origin'), null);
  }

  // "null" written in is no address: a sandboxed page that sends it is not let in
  env.PHONE_ORIGINS = 'null';
  const sandboxed = await call('OPTIONS', '/remote/ticket', { Origin: 'null' });
  eq(sandboxed.headers.get('Access-Control-Allow-Origin'), null, 'a page that says null');

  // the apps (no Origin) are answered as before
  const good = await call('POST', '/remote/ticket', await headers('device-aaaa'));
  eq(good.status, 200);
  eq(good.headers.get('Access-Control-Allow-Origin'), null);
});

await test('letter case: the setting may be written in capitals, the caller is compared as sent', async () => {
  // g26 Low 2: browsers send the address in small letters; the setting is read the same way
  env.PHONE_ORIGINS = 'https://Phone.Example.com';
  const named = await call('OPTIONS', '/remote/ticket', { Origin: 'https://phone.example.com' });
  eq(
    named.headers.get('Access-Control-Allow-Origin'),
    'https://phone.example.com',
    'capitals in the setting'
  );

  // a caller in capitals (no browser sends one) is the same address, and gets its own text back
  env.PHONE_ORIGINS = 'https://phone.example.com';
  const shout = await call('OPTIONS', '/remote/ticket', { Origin: 'HTTPS://PHONE.EXAMPLE.COM' });
  eq(
    shout.headers.get('Access-Control-Allow-Origin'),
    'HTTPS://PHONE.EXAMPLE.COM',
    'capitals in the caller'
  );

  // and a look-alike in capitals is still another page
  const evil = await call('OPTIONS', '/remote/ticket', {
    Origin: 'HTTPS://PHONE.EXAMPLE.COM.EVIL.TEST',
  });
  eq(evil.headers.get('Access-Control-Allow-Origin'), null, 'a look-alike in capitals');
});

await test('entries that could never match: https port and closing slash taken off, the rest dropped and counted', async () => {
  // g26 Info 2: a browser sends https://phone.example.com for both of these
  for (const entry of ['https://phone.example.com:443', 'https://phone.example.com/']) {
    env.PHONE_ORIGINS = entry;
    const pre = await call('OPTIONS', '/remote/ticket', { Origin: 'https://phone.example.com' });
    eq(pre.headers.get('Access-Control-Allow-Origin'), 'https://phone.example.com', entry);
  }

  // a path or a bare host is no page address: dropped, and the log counts them once, no address
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...parts) => warned.push(parts.join(' '));
  try {
    env.PHONE_ORIGINS = 'https://phone.example.com/app, phone.example.com, https://ok.example.com';
    for (let i = 0; i < 2; i++) {
      const pre = await call('OPTIONS', '/remote/ticket', { Origin: 'https://phone.example.com' });
      eq(pre.headers.get('Access-Control-Allow-Origin'), null, 'a path is no page address');
    }
    const ok2 = await call('OPTIONS', '/remote/ticket', { Origin: 'https://ok.example.com' });
    eq(
      ok2.headers.get('Access-Control-Allow-Origin'),
      'https://ok.example.com',
      'the good entry stays'
    );
  } finally {
    console.warn = realWarn;
  }
  eq(JSON.stringify(warned), '["PHONE_ORIGINS: 2 entries ignored"]', 'counted once, no address');
});

await test('unknown paths answer 404 and the front door says only that it is a relay', async () => {
  eq((await call('GET', '/remote/nothing')).status, 404);
  eq((await call('POST', '/remote/connect')).status, 404);
  const r = await call('GET', '/');
  eq(JSON.stringify(await r.json()), '{"relay":"technically-not","v":1,"keys":1,"phone_keys":1}');

  // the phone page may read it (phone/src/own-relay.mjs relayTooOld; the test above)
  env.PHONE_ORIGINS = 'https://phone.example.com';
  const page = await call('GET', '/', { Origin: 'https://phone.example.com' });
  eq(page.headers.get('Access-Control-Allow-Origin'), 'https://phone.example.com');
});

// The ids the relay lists, read as device-aaaa.
async function listed() {
  const r = await call('GET', '/remote/presence', await headers('device-aaaa', 'presence'));
  return ((await r.json()).devices || []).map(d => d.id);
}
const forgetCall = async (device, gone, o) =>
  call('POST', '/remote/forget?d=' + gone, await headers(device, 'forget:' + gone, o));

await test('a device that is not connected can be removed from the list', async () => {
  const { wa, wb } = await join2();
  wb.close();
  await new Promise(r => setTimeout(r, 5));
  ok((await listed()).includes('device-bbbb'), 'listed before');
  const r = await forgetCall('device-aaaa', 'device-bbbb');
  eq(r.status, 200, 'removed');
  eq((await r.json()).removed, true);
  ok(!(await listed()).includes('device-bbbb'), 'and gone from the list');
  ok((await listed()).includes('device-aaaa'), 'the asking device stays');
  wa.close();
});

await test('a connected device is not removed', async () => {
  const { wa, wb } = await join2();
  const r = await forgetCall('device-aaaa', 'device-bbbb');
  eq(r.status, 409);
  eq((await r.json()).error, 'online');
  ok((await listed()).includes('device-bbbb'), 'still listed');
  wa.close();
  wb.close();
});

await test('a device can remove its own record, as check.mjs does at its end', async () => {
  const w = await open((await ticketFor('check-aaaaaa')).body.ticket);
  w.close();
  await new Promise(r => setTimeout(r, 5));
  eq((await forgetCall('check-aaaaaa', 'check-aaaaaa')).status, 200);
  ok(!(await listed()).includes('check-aaaaaa'), 'gone');
});

await test('a remove needs a proof of the secret that names that device', async () => {
  const { wa, wb } = await join2();
  wb.close();
  await new Promise(r => setTimeout(r, 5));
  eq(
    (await forgetCall('device-aaaa', 'device-bbbb', { secret: OTHER })).status,
    401,
    'wrong secret'
  );

  // a proof made for another device to remove is no proof for this one
  const h = await headers('device-aaaa', 'forget:device-cccc');
  eq((await call('POST', '/remote/forget?d=device-bbbb', h)).status, 401, 'another device named');
  eq(
    (await call('POST', '/remote/forget?d=device-bbbb', await headers('device-aaaa', 'presence')))
      .status,
    401,
    'a list proof'
  );
  eq((await call('POST', '/remote/forget?d=x')).status, 400, 'a bad id');
  eq((await call('GET', '/remote/forget?d=device-bbbb')).status, 404, 'GET is no route');
  ok((await listed()).includes('device-bbbb'), 'nothing was removed');

  // a proof counts once
  const once = await headers('device-aaaa', 'forget:device-bbbb');
  eq((await call('POST', '/remote/forget?d=device-bbbb', once)).status, 200);
  eq(
    (await call('POST', '/remote/forget?d=device-bbbb', once)).status,
    401,
    'the same proof again'
  );
  wa.close();
});

await test('the phone key cannot remove a device', async () => {
  const { wa, wb } = await join2();
  wb.close();
  await new Promise(r => setTimeout(r, 5));
  const phoneKey = await hmacHex(SECRET, 'phone-key:' + HOST);
  const r = await forgetCall('ph-0123456789', 'device-bbbb', { secret: phoneKey });
  eq(r.status, 403);

  // nor a phone's own key (phoneOwnKey below)
  const ownKey = await hmacHex(SECRET, 'phone-key:' + HOST + ':ph-0123456789');
  eq((await forgetCall('ph-0123456789', 'device-bbbb', { secret: ownKey })).status, 403, 'own');
  ok((await listed()).includes('device-bbbb'), 'still listed');
  wa.close();
});

// ---- per-device keys and revoke (docs/plans/own-relay.md, "Per-device keys") ----

const deviceKey = device => hmacHex(SECRET, 'device-key:' + device);

await test('a device key proves its own id: a ticket, and a connection', async () => {
  const key = await deviceKey('device-aaaa');
  const t = await ticketFor('device-aaaa', { secret: key });
  eq(t.status, 200, 'ticket under the device key');
  const ws = await open(t.body.ticket);
  ok(!ws.refused, 'connected');
  ws.close();
});

await test("a device key cannot speak for another computer's id or a phone's", async () => {
  const key = await deviceKey('device-aaaa');
  eq((await ticketFor('device-bbbb', { secret: key })).status, 401, 'another id');
  eq((await ticketFor('ph-0123456789', { secret: key })).status, 401, 'a phone id');

  // and a computer's kind of key made for a phone id is not taken either: a phone's own key also
  // names the relay's host (phoneOwnKey below)
  const phoneIdKey = await deviceKey('ph-0123456789');
  eq((await ticketFor('ph-0123456789', { secret: phoneIdKey })).status, 401, 'a phone id key');
  eq(await hubState(), undefined, 'the meeting point was not even woken');
});

// The key a phone of this build keeps for its own id (phone/src/own-relay.mjs set).
const phoneOwnKey = (device, host = HOST) => hmacHex(SECRET, 'phone-key:' + host + ':' + device);
const sharedPhoneKey = () => hmacHex(SECRET, 'phone-key:' + HOST);

await test("a phone's own key proves its own phone id only, at this relay only", async () => {
  const key = await phoneOwnKey('ph-aaaaaaaaaa');
  const t = await ticketFor('ph-aaaaaaaaaa', { secret: key });
  eq(t.status, 200, 'a ticket for its own id');
  const ws = await open(t.body.ticket);
  ok(!ws.refused, 'connected');
  const list = await call(
    'GET',
    '/remote/presence',
    await headers('ph-aaaaaaaaaa', 'presence', { secret: key })
  );
  eq(list.status, 200, 'the list');
  eq((await ticketFor('ph-bbbbbbbbbb', { secret: key })).status, 401, 'another phone id');
  eq((await ticketFor('device-aaaa', { secret: key })).status, 401, "a computer's id");
  const elsewhere = await phoneOwnKey('ph-cccccccccc', 'other-relay.example');
  eq(
    (await ticketFor('ph-cccccccccc', { secret: elsewhere })).status,
    401,
    "the key made for another relay's host"
  );
  ws.close();
});

await test('the shared phone key works until a phone moves to its own key, then never again', async () => {
  const shared = await sharedPhoneKey();
  const { wa } = await join2();
  const old = await open((await ticketFor('ph-aaaaaaaaaa', { secret: shared })).body.ticket);
  ok(!old.refused, 'an older phone page is connected under the shared key');

  // a phone of this build asks once with its own key: it has moved
  const moved = await ticketFor('ph-bbbbbbbbbb', { secret: await phoneOwnKey('ph-bbbbbbbbbb') });
  eq(moved.status, 200, 'the moved phone gets its ticket');
  eq(old.closed?.code, 4010, 'the socket that came in under the shared key is closed');
  const again = await ticketFor('ph-aaaaaaaaaa', { secret: shared });
  eq(again.status, 401, 'the shared key is refused from then on');
  eq(again.body.error, 'invalid_proof', 'in words an older phone page already shows');
  eq(again.body.why, 'phone_key_retired', 'and why, for this build');
  eq((await ticketFor('ph-cccccccccc', { secret: shared })).status, 401, 'also for a new phone id');
  eq(wa.closed, null, 'a computer stays connected');
  eq((await ticketFor('device-aaaa')).status, 200, 'and still gets tickets');
  wa.close();
});

// The review's probe (g18b Medium 1): a ticket lives a minute, so one asked for under the shared
// key just before it ends must not open a socket after it.
await test('a ticket asked under the shared key before the move still connects after it: no', async () => {
  const shared = await sharedPhoneKey();
  const { wa } = await join2();
  const held = await ticketFor('ph-aaaaaaaaaa', { secret: shared });
  eq(held.status, 200, 'a ticket under the shared key, not used yet');
  const seen = wa.inbox.length;
  const moved = await ticketFor('ph-bbbbbbbbbb', { secret: await phoneOwnKey('ph-bbbbbbbbbb') });
  eq(moved.status, 200, 'another phone moves to its own key');
  const late = await open(held.body.ticket);
  eq(late.refused, 401, 'the held ticket opens nothing after the move');
  eq(late.body?.why, 'phone_key_retired', 'with the reason this build shows');
  eq((await open(held.body.ticket)).refused, 401, 'and stays dead');
  ok(
    !wa.inbox.slice(seen).some(m => /"presence"/.test(m) && /ph-aaaaaaaaaa/.test(m)),
    'nobody is told the phone is online'
  );
  wa.close();
});

await test('a device key cannot take the place of a connected computer', async () => {
  const { wa, wb } = await join2();
  const stolen = await deviceKey('device-aaaa');
  eq((await ticketFor('device-bbbb', { secret: stolen })).status, 401);
  eq(wb.closed, null, 'B stays connected');
  wa.close();
  wb.close();
});

const revokeCall = async (gone, o = {}) => {
  const what = (o.undo ? 'unrevoke:' : 'revoke:') + gone;
  const h = o.headers || (await headers(o.as || 'relay-owner', what, o));
  const r = await call('POST', '/remote/revoke?d=' + gone + (o.undo ? '&undo=1' : ''), h);
  return { status: r.status, body: await r.json(), headers: h };
};

await test('revoke: only the secret itself may throw a device out', async () => {
  const key = await deviceKey('device-aaaa');
  eq(
    (await revokeCall('device-bbbb', { as: 'device-aaaa', secret: key })).status,
    403,
    'device key'
  );
  const phoneKey = await hmacHex(SECRET, 'phone-key:' + HOST);
  eq(
    (await revokeCall('device-bbbb', { as: 'ph-0123456789', secret: phoneKey })).status,
    403,
    'phone key'
  );
  eq(
    (
      await revokeCall('device-bbbb', {
        as: 'ph-0123456789',
        secret: await phoneOwnKey('ph-0123456789'),
      })
    ).status,
    403,
    "a phone's own key"
  );
  eq((await revokeCall('device-bbbb', { secret: OTHER })).status, 401, 'a wrong secret');
  eq((await ticketFor('device-bbbb')).status, 200, 'B is still let in');
});

await test('revoke: the device is closed (4009), told offline to the others, and refused from then on', async () => {
  const { wa, wb } = await join2();
  const r = await revokeCall('device-bbbb');
  eq(r.status, 200);
  eq(wb.closed?.code, 4009, 'its socket is closed as revoked');
  ok(
    wa.inbox.some(m => /"presence"/.test(m) && /device-bbbb/.test(m) && /"online":false/.test(m)),
    'A is told B is offline'
  );
  ok(!(await records()).includes('d:device-bbbb'), 'its record is gone');
  const key = await deviceKey('device-bbbb');
  const again = await ticketFor('device-bbbb', { secret: key });
  eq(again.status, 403, 'a ticket under its own key');
  eq(again.body.error, 'device_revoked');
  eq((await ticketFor('device-bbbb')).status, 403, 'even under the secret');
  ok(!(await records()).includes('d:device-bbbb'), 'and nothing is recorded for it');
  wa.close();
});

await test('revoke: a copied call does nothing; undo lets it in again', async () => {
  const first = await revokeCall('device-bbbb');
  eq(first.status, 200);
  const copied = await call('POST', '/remote/revoke?d=device-bbbb', first.headers);
  eq(copied.status, 401, 'the same proof again');
  eq((await revokeCall('device-bbbb', { undo: true })).status, 200, 'undo');
  eq((await ticketFor('device-bbbb')).status, 200, 'let in again');
});

await test("revoke: the close that answers revoke's own does not bring the record back", async () => {
  const { wa, wb } = await join2();
  eq((await revokeCall('device-bbbb')).status, 200);
  await wb.answerClose();
  ok(!(await records()).includes('d:device-bbbb'), 'no record after its close');
  ok(!(await listed()).includes('device-bbbb'), 'and not listed as offline');
  wa.close();
});

await test('revoke: a phone id throws out that phone alone; other phones and computers stay', async () => {
  const keyA = await phoneOwnKey('ph-aaaaaaaaaa'),
    keyB = await phoneOwnKey('ph-bbbbbbbbbb');
  const { wa } = await join2();
  const lost = await open((await ticketFor('ph-aaaaaaaaaa', { secret: keyA })).body.ticket);
  const kept = await open((await ticketFor('ph-bbbbbbbbbb', { secret: keyB })).body.ticket);
  ok(!lost.refused && !kept.refused, 'two phones are connected');
  const r = await revokeCall('ph-aaaaaaaaaa');
  eq(r.status, 200);
  eq(r.body.phone_key_ended, true, 'the answer says the shared phone key ended');
  eq(lost.closed?.code, 4009, 'the lost phone is closed');
  eq(kept.closed, null, 'the other phone stays connected');
  ok(!(await records()).includes('d:ph-aaaaaaaaaa'), "the lost phone's record is gone");
  ok((await records()).includes('d:ph-bbbbbbbbbb'), "the other phone's record is kept");
  const back = await ticketFor('ph-aaaaaaaaaa', { secret: keyA });
  eq(back.status, 403, 'the lost phone is refused');
  eq(back.body.error, 'device_revoked');
  eq((await ticketFor('ph-bbbbbbbbbb', { secret: keyB })).status, 200, 'the other one is not');
  eq(wa.closed, null, 'a computer stays connected');
  eq((await ticketFor('device-aaaa')).status, 200, 'and still gets tickets');
  eq((await revokeCall('ph-aaaaaaaaaa', { undo: true })).status, 200, 'undo');
  eq((await ticketFor('ph-aaaaaaaaaa', { secret: keyA })).status, 200, 'let in again');
  wa.close();
  kept.close();
});

await test('revoke: a phone on the shared key ends that key, so the lost phone cannot come back under a new id', async () => {
  const shared = await sharedPhoneKey();
  const lost = await open((await ticketFor('ph-aaaaaaaaaa', { secret: shared })).body.ticket);
  const other = await open((await ticketFor('ph-bbbbbbbbbb', { secret: shared })).body.ticket);
  ok(!lost.refused && !other.refused, 'two older phone pages are connected');
  eq((await revokeCall('ph-aaaaaaaaaa')).status, 200);
  eq(lost.closed?.code, 4009, 'the lost phone is closed as revoked');
  eq(other.closed?.code, 4010, 'the other one, on the same key, is closed too');
  const newId = await ticketFor('ph-cccccccccc', { secret: shared });
  eq(newId.status, 401, 'a new phone id under the shared key is refused');
  eq(newId.body.why, 'phone_key_retired');
  eq(
    (await ticketFor('ph-bbbbbbbbbb', { secret: await phoneOwnKey('ph-bbbbbbbbbb') })).status,
    200,
    'the other phone comes back once it keeps its own key'
  );
  await new Promise(r => setTimeout(r, 1));
  eq((await revokeCall('ph-aaaaaaaaaa', { undo: true })).status, 200, 'undo');
  eq(
    (await ticketFor('ph-aaaaaaaaaa', { secret: shared })).status,
    401,
    'undo does not bring the shared key back'
  );
});

// The review's second probe (g18b Medium 1), for the other way the shared key ends.
await test('revoke: a ticket asked under the shared key before a phone revoke still connects after it: no', async () => {
  const shared = await sharedPhoneKey();
  const held = await ticketFor('ph-cccccccccc', { secret: shared });
  eq(held.status, 200, 'a ticket under the shared key, not used yet');
  eq((await revokeCall('ph-aaaaaaaaaa')).status, 200, 'a phone is thrown out');
  const late = await open(held.body.ticket);
  eq(late.refused, 401, 'the held ticket opens nothing after the revoke');
  eq(late.body?.why, 'phone_key_retired');
  eq((await open(held.body.ticket)).refused, 401, 'and stays dead');
});

await test('revoke: after a phone revoke, a new secret lets every phone pair again (a new secret is a new meeting point)', async () => {
  eq((await revokeCall('ph-aaaaaaaaaa')).status, 200, 'the lost phone thrown out');
  env = { ...env, RELAY_SECRET: OTHER };
  const underNew = (device, o = {}) => ({
    secret: hmacHex(OTHER, 'phone-key:' + HOST + (o.shared ? '' : ':' + device)),
  });
  const sharedNew = await underNew('ph-bbbbbbbbbb', { shared: true }).secret;
  eq(
    (await ticketFor('ph-bbbbbbbbbb', { secret: sharedNew })).status,
    200,
    'an older phone page with the new secret typed in (nothing has moved in the new meeting point)'
  );
  const own = await ticketFor('ph-aaaaaaaaaa', { secret: await underNew('ph-aaaaaaaaaa').secret });
  eq(own.status, 200, 'the same phone id, its own key under the new secret');
  ok(!(await open(own.body.ticket)).refused, 'and it connects');
  const oldKey = await phoneOwnKey('ph-cccccccccc');
  eq((await ticketFor('ph-cccccccccc', { secret: oldKey })).status, 401, 'a key of the old secret');
});

await test('revoke: an id of the wrong shape is refused before anything else', async () => {
  const r = await call(
    'POST',
    '/remote/revoke?d=bad%20id',
    await headers('relay-owner', 'revoke:bad id')
  );
  eq(r.status, 400);
  eq((await r.json()).error, 'invalid_device');
  eq(await hubState(), undefined, 'the meeting point was not woken');
});

await test('revoke: at most 256 ids are kept refused', async () => {
  for (let i = 0; i < 256; i++) {
    await new Promise(r => setTimeout(r, 1));
    eq((await revokeCall('gone-' + String(i).padStart(4, '0'))).status, 200, 'revoke ' + i);
  }
  await new Promise(r => setTimeout(r, 1));
  const full = await revokeCall('gone-9999');
  eq(full.status, 429);
  eq(full.body.error, 'too_many_revoked');
});

console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed ? 1 : 0);
