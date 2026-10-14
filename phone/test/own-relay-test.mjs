// Test of phone/src/own-relay.mjs:  node phone/test/own-relay-test.mjs  (plain Node, no browser).
// The phone's side of "Use my own relay" against the real relay code of
// the public `relay/` folder, which runs here on its test stand-in for Cloudflare. It mirrors
// tools/own-relay-test.js, the same test for the computer's side: what is accepted as an address
// and a secret (and that the phone and the computer agree on every one), that the secret is kept
// only as a key that cannot be read back and never sent, that a ticket from the relay opens a
// connection once, and what a wrong secret, a dead relay, a redirect, a huge or endless answer, a
// website's page, a clock that is off and a full relay do.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createOwnRelay, cleanUrl, cleanSecret } from '../src/own-relay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = createRequire(import.meta.url)('../../desktop/own-relay.js');
const relayFile = f => pathToFileURL(path.join(here, '..', '..', 'relay', f)).href;

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// The phone's store, as keys.mjs idbBackend() behaves for what this file uses. Values are kept as
// given (a CryptoKey included), and `writes` counts the changes.
function memoryBackend({ failWrites = false } = {}) {
  const map = new Map();
  return {
    map,
    writes: 0,
    get: async key => map.get(key),
    async update(key, fn) {
      if (failWrites) throw new Error('the store refused');
      const [value, result] = fn(map.get(key));
      if (value !== undefined) {
        map.set(key, value);
        this.writes++;
      }
      return result;
    },
  };
}

const shim = await import(relayFile('test/do-shim.mjs'));
shim.installWorkerGlobals();
const { default: worker, RelayHub } = await import(relayFile('src/index.js'));

const SECRET = 'kR7_tQ2mXv9LpZ4wYb6NcH1sDf8GjA3eUo5i',
  OTHER = 'Zx1_Cv2Bn3Mq4Wl5Ek6Rj7Th8Yg9Uf0IdPsAo',
  A = 'ph-11111111',
  B = 'ph-22222222';
let env;
const hubs = shim.createHubNamespace(RelayHub, () => env);
env = { RELAY_SECRET: SECRET, RELAY_HUB: hubs };

// The phone's fetch, answered by the relay's own code. `seen` keeps what went over the wire.
const seen = [];
let mode = 'relay';
const fetch = async (url, init = {}) => {
  seen.push({ url, init });
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'redirect') {
    if (init.redirect === 'error') throw new TypeError('redirect refused');
    return new Response('{}', { status: 200 });
  }
  if (mode === 'huge')
    return new Response('{"error":"' + 'x'.repeat(200000) + '"}', { status: 401 });
  if (mode === 'huge-ok') return new Response('{"ticket":"' + 'x'.repeat(200000) + '"}');
  if (mode === 'page') return new Response('<html>Not Found</html>', { status: 404 });
  if (mode === 'endless')
    return new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode('x'.repeat(1000)));
        },
      }),
      { status: 200 }
    );
  if (mode === 'after-far' || mode === 'after-text')
    return new Response(
      JSON.stringify({
        error: 'proof_used',
        after: mode === 'after-far' ? Date.now() + 86400000 : String(Date.now() + 5000),
      }),
      { status: 401 }
    );
  if (mode === 'after-always')
    return new Response(JSON.stringify({ error: 'proof_used', after: Date.now() + 1000 }), {
      status: 401,
    });

  // a relay that names a newest time `aheadMs` after the phone's own clock
  if (mode === 'after-ahead')
    return new Response(JSON.stringify({ error: 'proof_used', after: t + aheadMs }), {
      status: 401,
    });
  if (mode === 'clock' || mode === 'full')
    return new Response(
      JSON.stringify({ error: mode === 'clock' ? 'clock_off' : 'too_many_ids' }),
      {
        status: mode === 'clock' ? 401 : 429,
      }
    );
  if (mode === 'text')
    return new Response(JSON.stringify({ error: 'Go to http://evil.example NOW' }), {
      status: 401,
    });
  return worker.fetch(new Request(url, { method: init.method, headers: init.headers }), env);
};
let t = Date.now();
let aheadMs = 0;
const make = (backend = memoryBackend()) => ({
  backend,
  own: createOwnRelay({ backend, fetch, now: () => t }),
});
const open = ticket =>
  worker.fetch(
    new Request('https://relay.test/remote/connect?ticket=' + encodeURIComponent(ticket), {
      headers: { Upgrade: 'websocket' },
    }),
    env
  );

// ---- what counts as an address and a secret ----
check(
  'a bare host gets https',
  cleanUrl('my-relay.example.workers.dev') === 'https://my-relay.example.workers.dev'
);
check('wss is read as https', cleanUrl('wss://r.example.com/') === 'https://r.example.com');
check('a port is kept', cleanUrl('https://r.example.com:8443') === 'https://r.example.com:8443');
const badAddresses = [
  'http://localhost:8787',
  'https://192.168.1.1',
  'https://10.0.0.5:8443',
  'https://169.254.169.254',
  'https://172.16.0.9',
  'https://100.64.0.1',
  'https://0.0.0.0',
  'https://[fe80::1]',
  'https://[fd00::1]',
  'https://[::ffff:10.0.0.1]',
  'https://[::]',
  // an IPv4 address inside an IPv6 one, in the forms that still passed
  'https://[::a00:1]',
  'https://[::10.0.0.1]',
  'https://[::192.168.1.1]:8443',
  'https://[64:ff9b::a00:1]',
  'https://[64:ff9b::192.168.1.1]',
  'https://[64:ff9b:1::a00:1]',
  'https://[2002:a00:1::1]',
  'https://[2002:c0a8:101::1]',
  'ws://r.example.com',
  'ws://192.168.1.1:8787',
  'http://r.example.com',
  'https://user:pw@r.example.com',
  'https://r.example.com/path',
  'https://r.example.com/?x=1',
  'https://r.example.com/#x',
  'ftp://r.example.com',
  'file:///c:/x',
  'javascript:alert(1)',
  'https://',
  'two words.example.com',
  '',
  'x'.repeat(300),
  null,
  42,
];
for (const bad of badAddresses)
  check(
    'refused as an address: ' + String(bad).slice(0, 40),
    cleanUrl(bad) === null,
    cleanUrl(bad)
  );
check('a public number is taken', cleanUrl('https://203.0.113.9') === 'https://203.0.113.9');
check('http to the device itself over IPv6', cleanUrl('http://[::1]:8787') === 'http://[::1]:8787');
check(
  'http only to the device itself',
  cleanUrl('http://127.0.0.1:8787') === 'http://127.0.0.1:8787'
);
check('a secret of 32 or more printable characters', cleanSecret('  ' + SECRET + '\n') === SECRET);
check(
  '64 hex characters are a secret',
  cleanSecret('9f3c1e7a52d84b06c7e1a93f5d2b8046e3a7c15d9b02f48e6a1d7c3b95e0f284') !== null
);
check(
  '64 hex characters that lack one of the sixteen are a secret too',
  cleanSecret('83121346880aab15ad6544b5fdf3f9b8b5eb2acecfec2082960938cb409030b3') !== null
);

// one `npm run secret` really printed: letters only, so two kinds of character, 43 long
check(
  'a printed secret with letters only is a secret',
  cleanSecret('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdzYoTA') !== null
);
check(
  'letters only and shorter than 40 is still refused',
  cleanSecret('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdz') === null
);
check(
  'a public IPv6 number is taken',
  cleanUrl('https://[2606:4700::1111]') === 'https://[2606:4700::1111]'
);
const badSecrets = [
  'short',
  'x'.repeat(31),
  'has space ' + SECRET,
  'x'.repeat(201),
  'tab\t' + 'x'.repeat(40),
  'a'.repeat(32),
  'password'.repeat(4),
  // all four kinds of character, but only eight different ones: a pattern
  'Ab1!Cd2@'.repeat(5),
  '0123456789'.repeat(4),
  'qwertyuiopasdfghjklzxcvbnm123456',
  'abcdefghijklmnopqrstuvwxyzabcdef',
  // typed along a row: with one capital, twice over, backward, the
  // alphabet, the digits with Shift held, and a run inside something that looks made up
  'Qwertyuiopasdfghjklzxcvbnm123456',
  'qwertyuiopasdfghjklzxc'.repeat(2) + 'vbnm',
  'MNBVCXZlkjhgfdsaPOIUYTREWQ098765',
  'Abcdefghijklmnopqrstuvwxyz_12345',
  'kR7_tQ2mXv9LpZ4w!@#$%^&*()Yb6NcH1s',
  'kR7_tQ2mXv9LpZ4wasdfghjYb6NcH1sDf8G',
  // one piece written over and over
  'MyDogRex2019!MyDogRex2019!MyDogRex',
  'aB3$eF6&hJ9*'.repeat(4),
  'kR7_tQ2mXv9LpZ4wYb6N'.repeat(2),
  // a blank inside
  'kR7_tQ2mXv9LpZ4w Yb6NcH1sDf8GjA3eUo5i',
  '',
  null,
];
for (const bad of badSecrets)
  check('refused as a secret: ' + String(bad).slice(0, 20), cleanSecret(bad) === null);
check(
  'six in a row is not yet a typed run (a random secret may hold that)',
  cleanSecret('kR7_tQ2mXv9LpZ4wasdfghYb6NcH1sDf8Gj') !== null
);

// What `npm run secret` prints (32 random bytes as base64url) and 64 random hex characters are
// always taken, and the computer says the same of each.
{
  let refused = '';
  let apart = '';
  for (let i = 0; i < 300; i++) {
    const bytes = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
    for (const random of [bytes.toString('base64url'), bytes.toString('hex')]) {
      if (cleanSecret(random) !== random) refused = random;
      if (cleanSecret(random) !== desktop.cleanSecret(random)) apart = random;
    }
  }
  check('600 random secrets are all taken', !refused, refused);
  check('and phone and computer agree on every one', !apart, apart);
}

// The phone and the computer must say yes and no to exactly the same things.
for (const text of [
  ...badAddresses,
  'my-relay.example.workers.dev',
  'wss://r.example.com/',
  'https://r.example.com:8443',
  'https://203.0.113.9',
  'http://[::1]:8787',
  'http://127.0.0.1:8787',
  'https://[2606:4700::1111]',
  'https://127.0.0.1',
  'https://[::1]',
  'ws://127.0.0.1:8787',
])
  check(
    'phone and computer agree on the address: ' + String(text).slice(0, 30),
    cleanUrl(text) === desktop.cleanUrl(text)
  );
for (const text of [
  ...badSecrets,
  SECRET,
  OTHER,
  SECRET + '  ',
  '0123456789abcdef'.repeat(4),
  'kR7_tQ2mXv9LpZ4wasdfghYb6NcH1sDf8Gj',
  // nearly a repeat, and blanks around a secret: taken by both
  'kR7_tQ2mXv9LpZ4wYb6NkR7_tQ2mXv9LpZ4wYb6M',
  SECRET + '\n',
  '\t' + SECRET + '\r\n',
])
  check(
    'phone and computer agree on the secret: ' + String(text).slice(0, 20),
    cleanSecret(text) === desktop.cleanSecret(text)
  );

// ---- saving: only a key that cannot be read back, and the secret is never handed out ----
{
  const { own, backend } = make();
  check('nothing set at first', (await own.get()).set === false && !(await own.active()));
  check('no address before something is set', own.wsUrl() === '');
  check(
    'a bad address is not saved',
    (await own.set('http://r.example.com', SECRET)).error === 'bad_url' && backend.writes === 0
  );
  check(
    'a bad secret is not saved',
    (await own.set('relay.test', 'short')).error === 'bad_secret' && backend.writes === 0
  );
  check('saved', (await own.set('relay.test', SECRET)).ok === true && (await own.active()));
  const stored = backend.map.get('ownRelay');
  check(
    'what is stored holds no text of the secret',
    !JSON.stringify(stored).includes(SECRET) && !String(stored.key).includes(SECRET)
  );
  check(
    'the stored key is a signing key that cannot be exported',
    stored.key.extractable === false && stored.key.usages.join() === 'sign'
  );
  let exported = 'exported';
  try {
    await crypto.subtle.exportKey('raw', stored.key);
  } catch {
    exported = 'refused';
  }
  check('and the browser refuses to export it', exported === 'refused');

  // The stored key is not a key of the secret itself but one made from it for this relay's host
  // and for proofs: what a script on the page could have it sign opens
  // nothing but a proof to this one relay.
  const nodeCrypto = await import('node:crypto');
  const hmacOf = (key, text) => nodeCrypto.createHmac('sha256', key).update(text).digest('hex');
  const signWithStored = async text =>
    Buffer.from(
      await crypto.subtle.sign('HMAC', stored.key, new TextEncoder().encode(text))
    ).toString('hex');
  check(
    'the stored key is the one made for this host: HMAC(secret, "phone-key:" + host)',
    (await signWithStored('anything')) ===
      hmacOf(hmacOf(SECRET, 'phone-key:relay.test'), 'anything')
  );
  check(
    'it does not sign as the secret does: not the name of the meeting point',
    (await signWithStored('hub')) !== hmacOf(SECRET, 'hub')
  );
  check(
    'nor a proof a computer would send, so nothing it signs is good at another relay',
    (await signWithStored('proof:ticket:other-relay.test:ph-11111111:1')) !==
      hmacOf(SECRET, 'proof:ticket:other-relay.test:ph-11111111:1') &&
      (await signWithStored('proof:ticket:other-relay.test:ph-11111111:1')) !==
        hmacOf(
          hmacOf(SECRET, 'phone-key:other-relay.test'),
          'proof:ticket:other-relay.test:ph-11111111:1'
        )
  );
  const got = await own.get();
  check(
    'the page gets the address and "set", never the secret',
    got.set === true && got.url === 'https://relay.test' && !JSON.stringify(got).includes(SECRET),
    got
  );
  check('the link address is wss', own.wsUrl() === 'wss://relay.test');
  const again = createOwnRelay({ backend, fetch, now: () => t });
  check(
    'read back after a restart',
    (await again.active()) && (await again.get()).url === 'https://relay.test'
  );
  check(
    'cleared',
    (await own.clear()).ok === true &&
      !(await own.active()) &&
      (await own.get()).url === '' &&
      !(await createOwnRelay({ backend, fetch }).active())
  );
}
{
  const { own } = make(memoryBackend({ failWrites: true }));
  check(
    'a store that refuses: not saved, and nothing set',
    (await own.set('relay.test', SECRET)).error === 'not_saved' && !(await own.active())
  );
  const backend = memoryBackend();
  backend.map.set('ownRelay', { url: 'https://relay.test', key: 'the secret as plain text' });
  check(
    'a stored value that is not a signing key counts as none set',
    !(await createOwnRelay({ backend, fetch }).active())
  );

  // A real key of the kind set() stores, taken from a store that was really saved to.
  const savedTo = memoryBackend();
  await createOwnRelay({ backend: savedTo, fetch }).set('relay.test', SECRET);
  const realKey = savedTo.map.get('ownRelay').key;
  const stored = async value => {
    const store = memoryBackend();
    store.map.set('ownRelay', value);
    return createOwnRelay({ backend: store, fetch }).active();
  };
  check('a stored good pair is read', await stored({ url: 'https://relay.test', key: realKey }));

  // the stored address is checked again when it is read (with a key that is good, so only the
  // address can be what refuses it)
  for (const url of ['http://evil.example', 'https://192.168.1.1', 'https://relay.test/path', 5])
    check(
      'a stored address that is not allowed is no relay: ' + url,
      !(await stored({ url, key: realKey }))
    );

  // Something that only looks like a key: it counted as "relay set" and
  // then failed at every call.
  const hmac = { name: 'HMAC', hash: 'SHA-256' };
  const bytes = new TextEncoder().encode('x'.repeat(64));
  const lookalikes = {
    "a plain object with a key's two fields": { type: 'secret', algorithm: { name: 'HMAC' } },
    'a plain object with every field of a key': {
      type: 'secret',
      algorithm: { name: 'HMAC' },
      extractable: false,
      usages: ['sign'],
    },
    'a key that can be exported': await crypto.subtle.importKey('raw', bytes, hmac, true, ['sign']),
    'a key that may only check, not sign': await crypto.subtle.importKey(
      'raw',
      bytes,
      hmac,
      false,
      ['verify']
    ),
    // an AES key is 32 bytes long
    'a key for something else': await crypto.subtle.importKey(
      'raw',
      bytes.slice(0, 32),
      'AES-GCM',
      false,
      ['encrypt']
    ),
  };
  for (const [what, key] of Object.entries(lookalikes))
    check('not a relay key: ' + what, !(await stored({ url: 'https://relay.test', key })));

  // On a platform that does not name its key type (no global CryptoKey) the fields alone decide,
  // so each of them still has to be right there: the algorithm too.
  {
    const platformKey = globalThis.CryptoKey;
    globalThis.CryptoKey = undefined;
    const fields = { type: 'secret', extractable: false, usages: ['sign'] };
    const otherAlgorithm = await stored({
      url: 'https://relay.test',
      key: { ...fields, algorithm: { name: 'AES-GCM' } },
    });
    const noAlgorithm = await stored({ url: 'https://relay.test', key: fields });
    globalThis.CryptoKey = platformKey;
    check(
      'without a named key type: a key for another algorithm, or for none, is not a relay key',
      otherAlgorithm === false && noAlgorithm === false && globalThis.CryptoKey === platformKey,
      [otherAlgorithm, noAlgorithm]
    );
  }

  // a key that will not sign after all: "no relay", and nothing is sent
  const wontSign = createOwnRelay({
    backend: savedTo,
    fetch,
    subtle: {
      async sign() {
        throw new Error('the key store refused');
      },
    },
  });
  seen.length = 0;
  const unsigned = await wontSign.ticket(A).catch(e => e);
  check(
    'a key that will not sign is "no relay", not a relay that cannot be reached',
    unsigned.status === 0 && unsigned.code === 'no_relay' && seen.length === 0,
    [unsigned, seen.length]
  );

  // a read that fails once is asked again, not remembered as "none set"
  const real = memoryBackend();
  await createOwnRelay({ backend: real, fetch }).set('relay.test', SECRET);
  let broken = true;
  const flaky = {
    ...real,
    get: async key => {
      if (broken) throw new Error('busy');
      return real.get(key);
    },
  };
  const later = createOwnRelay({ backend: flaky, fetch });
  check('a failed read is none for now', !(await later.active()));
  broken = false;
  check('and the relay is there at the next call', await later.active());
}

// ---- against the relay ----
{
  const { own } = make();
  await own.set('relay.test', SECRET);
  seen.length = 0;
  const ticket = await own.ticket(A);
  const sent = seen[0];
  check(
    'the ticket call goes to the relay address',
    sent.url === 'https://relay.test/remote/ticket' && sent.init.method === 'POST'
  );
  check(
    'only the three proof headers are sent',
    Object.keys(sent.init.headers).sort().join() === 'X-Relay-Device,X-Relay-Proof,X-Relay-Time',
    Object.keys(sent.init.headers)
  );
  check('the secret is not in what is sent', !JSON.stringify(sent).includes(SECRET));
  check('a redirect is never followed', sent.init.redirect === 'error');
  check('a call has a time limit', !!sent.init.signal);
  const ws = await open(ticket);
  check('the ticket opens a connection on the relay', ws.status === 101);
  check('and only once', (await open(ticket)).status === 401);

  // the clock does not move: the next proof is still newer
  seen.length = 0;
  const second = await own.ticket(A).catch(e => e);
  const third = await own.ticket(A).catch(e => e);
  check(
    'tickets with the clock standing still both work',
    typeof second === 'string' && typeof third === 'string',
    [second, third]
  );
  check(
    'every proof is newer than the one before',
    Number(seen[1].init.headers['X-Relay-Time']) > Number(seen[0].init.headers['X-Relay-Time'])
  );
  await open(await own.ticket(B));
  const list = await own.devices(A);
  check(
    'the relay lists the connected devices',
    list.length === 2 && list.every(d => Number.isFinite(d.last_seen)),
    list
  );
  check('the presence call is a GET', seen.at(-1).init.method === 'GET');

  check(
    'a device id the relay would refuse is not sent',
    (await own.ticket('bad id').catch(e => e)).code === 'device_required'
  );

  const wrong = make().own;
  await wrong.set('relay.test', OTHER);
  const refused = await wrong.ticket(A).catch(e => e);
  check(
    'a wrong secret is refused by the relay',
    refused.status === 401 && refused.code === 'invalid_proof',
    refused
  );
  check('and lists nothing', (await wrong.devices(A)).length === 0);
  check(
    'and the page can be told why',
    (await wrong.check(A).catch(e => e)).code === 'invalid_proof'
  );

  mode = 'down';
  const down = await own.ticket(A).catch(e => e);
  check(
    'a relay that does not answer is a network error',
    down.status === 0 && down.code === 'network',
    down
  );
  check('and an empty list', (await own.devices(A)).length === 0);
  mode = 'redirect';
  const redir = await own.ticket(A).catch(e => e);
  check('a relay that redirects is refused', redir.code === 'network', redir);
  mode = 'huge';
  const huge = await own.ticket(A).catch(e => e);
  check(
    'a refusal that is too long is not read to its end, and reads as "no relay there"',
    huge.status === 403 && huge.code === 'refused',
    huge
  );
  mode = 'huge-ok';
  const hugeOk = await own.ticket(A).catch(e => e);
  check('nor is a too long answer that says yes', hugeOk.code === 'network', hugeOk);
  mode = 'endless';
  const endless = await own.ticket(A).catch(e => e);
  check('an answer that never ends is given up at the limit', endless.code === 'network', endless);
  mode = 'page';
  const page = await own.ticket(A).catch(e => e);
  check(
    'a website\'s page at a wrong address stops the link as "no relay there"',
    page.status === 403 && page.code === 'refused',
    page
  );
  mode = 'clock';
  const clockOff = await own.ticket(A).catch(e => e);
  check(
    'a clock that is off stops the link with its own reason',
    clockOff.status === 403 && clockOff.code === 'clock_off',
    clockOff
  );
  mode = 'full';
  const full = await own.ticket(A).catch(e => e);
  check(
    'a full relay stops the link with its own reason',
    full.status === 403 && full.code === 'too_many_ids',
    full
  );
  {
    // a relay that says "seen" every time: one more try, then the link waits (never a loop)
    mode = 'after-always';
    const o = make().own;
    await o.set('relay.test', SECRET);
    seen.length = 0;
    const r = await o.ticket(A).catch(e => e);
    check(
      'a relay that always says "seen" gets one more try and no more',
      r.status === 429 && r.code === 'proof_used' && seen.length === 2,
      [r, seen.length]
    );
  }
  for (const m of ['after-far', 'after-text']) {
    mode = m;
    const o = make().own;
    await o.set('relay.test', SECRET);
    seen.length = 0;
    const r = await o.ticket(A).catch(e => e);
    check(
      m +
        ': a newest time that is far ahead or not a number is not taken, and nothing is tried twice',
      r.status === 429 && r.code === 'proof_used' && seen.length === 1,
      [r, seen.length]
    );
  }

  // How far ahead a relay's newest time is believed: 110 seconds, ten under the 120 a relay
  // takes; and the time a relay moved the phone to does not outlive a change of relay.
  {
    const timeSent = () => Number(seen.at(-1).init.headers['X-Relay-Time']);
    mode = 'after-ahead';
    aheadMs = 111 * 1000;
    const doubting = make().own;
    await doubting.set('relay.test', SECRET);
    seen.length = 0;
    await doubting.ticket(A).catch(e => e);
    check('a newest time 111 seconds ahead is not taken: no second try', seen.length === 1);
    aheadMs = 109 * 1000;
    const moved = make().own;
    await moved.set('relay.test', SECRET);
    seen.length = 0;
    await moved.ticket(A).catch(e => e);
    check(
      'one 109 seconds ahead is taken: a second try at once, dated just after it',
      seen.length === 2 && timeSent() === t + aheadMs + 1,
      [seen.length, timeSent() - t]
    );
    mode = 'down';
    await moved.ticket(A).catch(e => e);
    check('before the change the proofs are still dated ahead', timeSent() > t + 100000);
    await moved.set('other-relay.test', SECRET);
    await moved.ticket(A).catch(e => e);
    check(
      'after another relay is saved the proofs are dated by this clock again',
      timeSent() <= t + 2,
      timeSent() - t
    );
    mode = 'after-ahead';
    await moved.ticket(A).catch(e => e);
    await moved.clear();
    await moved.set('relay.test', SECRET);
    mode = 'down';
    await moved.ticket(A).catch(e => e);
    check('removing the relay resets the proof time too', timeSent() <= t + 2, timeSent() - t);
  }
  mode = 'text';
  const text = await own.ticket(A).catch(e => e);
  check('a relay cannot put its own text into an error', text.code === 'refused', text);
  mode = 'relay';

  // a proof the relay has already seen (a clock that was ahead and was set back): the phone
  // continues from the relay's time and tries once more at once
  {
    const ahead = make().own;
    await ahead.set('relay.test', SECRET);
    const C = 'ph-33333333';
    t += 60000;
    await ahead.ticket(C);
    const back = createOwnRelay({ backend: memoryBackend(), fetch, now: () => t - 30000 });
    await back.set('relay.test', SECRET);
    seen.length = 0;
    const first = await back.ticket(C).catch(e => e);
    check(
      'a proof older than the relay knows: continue from the relay time and try once more at once',
      typeof first === 'string' && seen.length === 2,
      [first, seen.length]
    );
  }

  // a proof made for one address is refused at another relay with the same secret
  {
    const typo = make().own;
    await typo.set('other-relay.test', SECRET);
    const atOther = await typo.ticket(A).catch(e => e);
    check(
      'the proof names its relay: the same secret at another address',
      typeof atOther === 'string'
    );
    const stolen = seen.at(-1).init.headers;
    const replay = await worker.fetch(
      new Request('https://relay.test/remote/ticket', { method: 'POST', headers: stolen }),
      env
    );
    check(
      'a proof sent to a wrong address is worth nothing at the real one',
      replay.status === 401,
      replay.status
    );
  }

  const none = make().own;
  check('no relay set: no call is made', (await none.ticket(A).catch(e => e)).code === 'no_relay');
  env = { ...env, RELAY_SECRET: '' };
  const unset = await own.ticket(A).catch(e => e);
  check(
    'a relay with no secret says it is not set up',
    unset.status === 503 && unset.code === 'relay_not_set_up',
    unset
  );
}

console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed ? 1 : 0);
