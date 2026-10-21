// Test of desktop/own-relay.js: node tools/own-relay-test.js (plain Node). The app's side of "Use
// my own relay" against the real relay code of the public `relay/`
// folder, which runs here on its test stand-in for Cloudflare: what is accepted as an address and
// a secret, that the secret is stored encrypted and never handed out, that a ticket from the relay
// opens a connection, and what a wrong secret, a dead relay and a redirect do.
const path = require('path');
const { pathToFileURL } = require('url');
const { createOwnRelay, cleanUrl, cleanSecret } = require('../desktop/own-relay.js');

let passed = 0,
  failed = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const relayFile = f => pathToFileURL(path.join(__dirname, '..', 'relay', f)).href;

// A stand-in for the encrypted file: "encryption" that is easy to see through in a test, and a
// count of what was written.
function fakeBackend({ available = true } = {}) {
  const b = {
    text: null,
    writes: 0,
    available: () => available,
    encrypt: buf => Buffer.from('ENC[' + buf.toString('base64') + ']'),
    decrypt: buf => Buffer.from(buf.toString().slice(4, -1), 'base64'),
    read: () => b.text,
    write(t) {
      b.writes++;
      b.text = t;
    },
  };
  return b;
}

(async () => {
  const shim = await import(relayFile('test/do-shim.mjs'));
  shim.installWorkerGlobals();
  const { default: worker, RelayHub } = await import(relayFile('src/index.js'));

  const SECRET = 'kR7_tQ2mXv9LpZ4wYb6NcH1sDf8GjA3eUo5i',
    OTHER = 'Zx1_Cv2Bn3Mq4Wl5Ek6Rj7Th8Yg9Uf0IdPsAo',
    A = '11111111-1111-4111-8111-111111111111',
    B = '22222222-2222-4222-8222-222222222222';
  let env;
  const hubs = shim.createHubNamespace(RelayHub, () => env);
  env = { RELAY_SECRET: SECRET, RELAY_HUB: hubs };

  // The app's fetch, answered by the relay's own code. `seen` keeps what went over the wire.
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
          pull(c) {
            c.enqueue(new TextEncoder().encode('x'.repeat(1000)));
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

    // a relay that names a newest time `aheadMs` after the app's own clock
    if (mode === 'after-ahead')
      return new Response(JSON.stringify({ error: 'proof_used', after: t + aheadMs }), {
        status: 401,
      });
    if (mode === 'clock' || mode === 'full')
      return new Response(
        JSON.stringify({ error: mode === 'clock' ? 'clock_off' : 'too_many_ids' }),
        { status: mode === 'clock' ? 401 : 429 }
      );
    if (mode === 'text')
      return new Response(JSON.stringify({ error: 'Go to http://evil.example NOW' }), {
        status: 401,
      });

    // a relay deployed before per-device keys: its front answer has no `keys`, a key is refused
    if (mode === 'old-relay')
      return new URL(url).pathname === '/'
        ? new Response(JSON.stringify({ relay: 'technically-not', v: 1 }))
        : new Response(JSON.stringify({ error: 'invalid_proof' }), { status: 401 });
    if (mode === 'long-ticket') return new Response(JSON.stringify({ ticket: 'x'.repeat(601) }));
    if (mode === 'long-list') {
      // 100 well-shaped ids with odd ones in between: a text, an id too short, one with a space
      const devices = [];
      for (let i = 0; i < 100; i++) devices.push({ id: 'listed-' + String(i).padStart(4, '0') });
      devices.splice(3, 0, 'not an object', { id: 'short' }, { id: 'has space 01' }, null);
      return new Response(JSON.stringify({ devices }));
    }
    return worker.fetch(new Request(url, { method: init.method, headers: init.headers }), env);
  };
  let t = Date.now();
  let aheadMs = 0;
  const make = (backend = fakeBackend()) => ({
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
  for (const bad of [
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
    // a relay on another host over a plain socket
    'ws://r.example.com',
    'ws://192.168.1.1:8787',
  ])
    check('refused, not on the internet: ' + bad, cleanUrl(bad) === null, cleanUrl(bad));
  check('a public number is taken', cleanUrl('https://203.0.113.9') === 'https://203.0.113.9');
  check(
    'a public IPv6 number is taken',
    cleanUrl('https://[2606:4700::1111]') === 'https://[2606:4700::1111]',
    cleanUrl('https://[2606:4700::1111]')
  );
  check('http to this computer over IPv6', cleanUrl('http://[::1]:8787') === 'http://[::1]:8787');
  check(
    'a plain socket to this computer is read as http to it',
    cleanUrl('ws://127.0.0.1:8787') === 'http://127.0.0.1:8787'
  );

  // The relay with a given secret: does it count as set up? It must say yes and no to exactly
  // what the app says yes and no to, or one side takes a secret the other refuses.
  const relayTakes = async secret => {
    const answer = await worker.fetch(
      new Request('https://relay.test/remote/connect?ticket=x', {
        headers: { Upgrade: 'websocket' },
      }),
      { RELAY_SECRET: secret, RELAY_HUB: hubs }
    );
    return answer.status !== 503;
  };
  const typedSecrets = [
    'qwertyuiopasdfghjklzxcvbnm123456',
    'abcdefghijklmnopqrstuvwxyzabcdef',
    // One capital gave it three kinds of character
    'Qwertyuiopasdfghjklzxcvbnm123456',
    // two rows end to end, twice over: long enough to need no kinds
    'qwertyuiopasdfghjklzxc'.repeat(2) + 'vbnm',
    // backward, with capitals
    'MNBVCXZlkjhgfdsaPOIUYTREWQ098765',
    'Abcdefghijklmnopqrstuvwxyz_12345',
    // the digits with Shift held
    'kR7_tQ2mXv9LpZ4w!@#$%^&*()Yb6NcH1s',
    // a run in the middle of something that otherwise looks made up
    'kR7_tQ2mXv9LpZ4wasdfghjYb6NcH1sDf8G',
  ];
  for (const weak of typedSecrets) {
    check('refused as a secret, typed along a row: ' + weak.slice(0, 14), !cleanSecret(weak));
    check('and the relay refuses it too: ' + weak.slice(0, 14), !(await relayTakes(weak)));
  }
  check(
    'six in a row is not yet a typed run (a random secret may hold that)',
    cleanSecret('kR7_tQ2mXv9LpZ4wasdfghYb6NcH1sDf8Gj') !== null
  );

  // What `npm run secret` prints (32 random bytes as base64url) and 64 random hex characters are
  // always taken, by the app and by the relay. (A fixed example would prove one secret only: the
  // rule "16 different characters" once refused one random hex secret in four.)
  let refusedRandom = '';
  for (let i = 0; i < 300; i++) {
    for (const random of [
      require('crypto').randomBytes(32).toString('base64url'),
      require('crypto').randomBytes(32).toString('hex'),
    ]) {
      if (cleanSecret(random) !== random || !(await relayTakes(random))) refusedRandom = random;
    }
  }
  check('600 random secrets are all taken by the app and the relay', !refusedRandom, refusedRandom);
  check(
    '64 hex characters are a secret',
    cleanSecret('9f3c1e7a52d84b06c7e1a93f5d2b8046e3a7c15d9b02f48e6a1d7c3b95e0f284') !== null
  );

  // one `npm run secret` really printed: letters only, so two kinds of character, 43 long
  check(
    'a printed secret with letters only is a secret',
    cleanSecret('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdzYoTA') !== null &&
      (await relayTakes('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdzYoTA'))
  );
  check(
    'letters only and shorter than 40 is still refused, by the app and the relay',
    cleanSecret('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdz') === null &&
      !(await relayTakes('aCPseZqSNxZAGbdwirLakuVrKxsxrnxpzhzRbdz'))
  );
  check(
    '64 hex characters that lack one of the sixteen are a secret too',
    cleanSecret('83121346880aab15ad6544b5fdf3f9b8b5eb2acecfec2082960938cb409030b3') !== null
  );
  check(
    'http only to this computer',
    cleanUrl('http://127.0.0.1:8787') === 'http://127.0.0.1:8787'
  );
  for (const bad of [
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
  ])
    check(
      'refused as an address: ' + String(bad).slice(0, 40),
      cleanUrl(bad) === null,
      cleanUrl(bad)
    );
  check(
    'a secret of 32 or more printable characters',
    cleanSecret('  ' + SECRET + '\n') === SECRET
  );
  for (const bad of [
    'short',
    'x'.repeat(31),
    'has space ' + SECRET,
    'x'.repeat(201),
    'tab\t' + 'x'.repeat(40),
    'a'.repeat(32),
    'password'.repeat(4),
    '0123456789'.repeat(4),
    '',
    null,
  ])
    check('refused as a secret: ' + String(bad).slice(0, 20), cleanSecret(bad) === null);

  // ---- saving: encrypted, and the secret is never handed out ----
  {
    const { own, backend } = make();
    check(
      'nothing set at first',
      own.get().set === false && own.active() === false && own.wsUrl() === ''
    );
    check(
      'a bad address is not saved',
      own.set('http://r.example.com', SECRET).error === 'bad_url' && backend.writes === 0
    );
    check(
      'a bad secret is not saved',
      own.set('r.example.com', 'short').error === 'bad_secret' && backend.writes === 0
    );
    check('saved', own.set('relay.test', SECRET).ok === true && own.active());
    check(
      'the file holds no plain secret and no plain address',
      !backend.text.includes(SECRET) && !backend.text.includes('relay.test'),
      backend.text.slice(0, 40)
    );
    const got = own.get();
    check(
      'the window gets the address and "set", never the secret',
      got.set === true && got.url === 'https://relay.test' && !JSON.stringify(got).includes(SECRET),
      got
    );

    // not a part of it either: no six characters in a row of the secret are in the answer
    const pieces = [];
    for (let start = 0; start + 6 <= SECRET.length; start++)
      pieces.push(SECRET.slice(start, start + 6));
    check(
      'nor any part of the secret',
      pieces.every(piece => !JSON.stringify(got).includes(piece)),
      got
    );
    check(
      'the answer names exactly five things, and the id reason is one of three fixed words',
      Object.keys(got).sort().join() === 'available,idProblem,problem,set,url' &&
        ['', 'id_not_saved', 'id_not_read'].includes(got.idProblem),
      Object.keys(got)
    );

    // What is stored is checked again when it is read: a file that holds an address or a secret
    // the app would not take today (written by an older build, or by something else) is no relay.
    const stale = (url, secret) => {
      const file = fakeBackend();
      file.text = file.encrypt(Buffer.from(JSON.stringify({ url, secret }))).toString('base64');
      return createOwnRelay({ backend: file, fetch });
    };
    check('a stored good pair is read', stale('https://relay.test', SECRET).active());
    check(
      'a stored address that is not allowed is no relay',
      !stale('https://192.168.1.1', SECRET).active() &&
        !stale('http://relay.test', SECRET).active() &&
        !stale('https://relay.test/path', SECRET).active()
    );
    check(
      'a stored secret that is not allowed is no relay',
      !stale('https://relay.test', 'Qwertyuiopasdfghjklzxcvbnm123456').active() &&
        !stale('https://relay.test', 'short').active()
    );

    // A relay saved with a secret an earlier build took and today's pattern rules refuse (a
    // typed one with "abcdefg" or "1234567" in it) is not "no relay": it is held, with its own
    // problem, until the secret is set again.
    {
      const OLD = 'Our-Home-Relay-2026-abcdefg-Secret!!';
      check('such a secret is refused today', cleanSecret(OLD) === null);
      const old = stale('https://relay.test', OLD);
      const got = old.get();
      check(
        'a saved relay with an old secret: not active, but held, and the page is told why',
        old.active() === false &&
          old.held() === true &&
          got.set === false &&
          got.problem === 'old_secret' &&
          got.url === 'https://relay.test',
        got
      );
      check('the old secret is not handed out', !JSON.stringify(got).includes('abcdefg'));
      seen.length = 0;
      const noTicket = await old.ticket(A).catch(e => e);
      check(
        'no proof is made with the old secret: no call at all',
        noTicket.code === 'no_relay' && noTicket.status === 0 && seen.length === 0,
        [noTicket, seen.length]
      );
      check(
        'setting the secret again makes it a relay, with no problem left',
        old.set('relay.test', SECRET).ok === true &&
          old.active() &&
          old.get().problem === '' &&
          old.held() === false
      );
      const removed = stale('https://relay.test', OLD);
      removed.held();
      removed.clear();
      check(
        'removing it instead: not held any more',
        removed.held() === false && removed.get().problem === '' && removed.get().url === ''
      );

      // only a text that was once a secret counts
      const never = stale('https://relay.test', 'short');
      const notText = stale('https://relay.test', 12345);
      check(
        'what never was a secret is no relay at all',
        [never, notText].every(o => !o.held() && o.get().problem === '' && !o.active())
      );

      // An address that is no longer allowed, saved with what was a secret, is held too, with a
      // reason of its own; the address is not handed to the page and nothing is sent to it.
      const elsewhere = stale('https://192.168.1.1', OLD);
      const moved = stale('https://relay.test/path', SECRET);
      check(
        'a saved relay with an old address: not active, but held, and the page is told why',
        [elsewhere, moved].every(
          o =>
            !o.active() &&
            o.held() &&
            o.get().problem === 'old_address' &&
            o.get().url === '' &&
            o.wsUrl() === ''
        ),
        [elsewhere.get(), moved.get()]
      );
      check(
        'setting it again makes it a relay, with no problem left',
        moved.set('relay.test', SECRET).ok === true && moved.active() && moved.get().problem === ''
      );
    }

    // The edges of the secret rule, the same on the relay.
    for (const repeated of [
      'MyDogRex2019!MyDogRex2019!MyDogRex',
      'aB3$eF6&hJ9*'.repeat(4),
      'kR7_tQ2mXv9LpZ4wYb6N'.repeat(2),
    ]) {
      check(
        'refused, one piece written over and over: ' + repeated.slice(0, 14),
        !cleanSecret(repeated)
      );
      check('and by the relay: ' + repeated.slice(0, 14), !(await relayTakes(repeated)));
    }
    check(
      'nearly a repeat (one character differs) is a secret, for the app and the relay',
      cleanSecret('kR7_tQ2mXv9LpZ4wYb6NkR7_tQ2mXv9LpZ4wYb6M') !== null &&
        (await relayTakes('kR7_tQ2mXv9LpZ4wYb6NkR7_tQ2mXv9LpZ4wYb6M'))
    );
    for (const around of [SECRET + ' ', SECRET + '\n', '\t' + SECRET + '\r\n'])
      check(
        'blanks around a secret are taken off by the app and by the relay alike',
        cleanSecret(around) === SECRET && (await relayTakes(around))
      );
    check(
      'a blank inside is refused by both',
      cleanSecret('kR7_tQ2mXv9LpZ4w Yb6NcH1sDf8GjA3eUo5i') === null &&
        !(await relayTakes('kR7_tQ2mXv9LpZ4w Yb6NcH1sDf8GjA3eUo5i'))
    );
    check('the link address is wss', own.wsUrl() === 'wss://relay.test');
    const id = own.accountId();
    check('the stand-in account id says nothing of the secret or the address', id === 'own-relay');
    const again = createOwnRelay({ backend, fetch, now: () => t });
    check(
      'read back after a restart',
      again.active() && again.accountId() === id && again.wsUrl() === 'wss://relay.test'
    );

    // pairings rest on the six digits, not on the relay: a typo must not cost them all
    own.set('relay.test', OTHER);
    check('another secret keeps the same account, so pairings stay', own.accountId() === id);
    own.set('other.test', SECRET);
    check('another relay keeps the same account, so pairings stay', own.accountId() === id);
    check(
      'cleared',
      own.clear().ok === true &&
        !own.active() &&
        own.get().url === '' &&
        createOwnRelay({ backend, fetch }).active() === false
    );
  }
  {
    // Nothing was ever saved: the app's start asks whether a relay is set, and the system's secure
    // storage must not be asked at all (on macOS it reads the keychain, and a keychain item of
    // another build blocks the start with a prompt).
    const backend = fakeBackend();
    let asked = 0;
    backend.exists = () => backend.text !== null;
    backend.available = () => {
      asked++;
      return true;
    };
    const fresh = createOwnRelay({ backend, fetch });
    check(
      'nothing saved: the start does not ask the secure storage',
      fresh.active() === false && !fresh.held() && asked === 0,
      { asked }
    );
    check(
      'and saving a relay then asks it as before',
      fresh.set('relay.test', SECRET).ok === true && asked > 0 && fresh.active() === true,
      { asked }
    );
  }
  {
    const { own, backend } = make(fakeBackend({ available: false }));
    check(
      'no secure storage: nothing is saved in plain text',
      own.set('relay.test', SECRET).error === 'unavailable' &&
        backend.writes === 0 &&
        own.get().available === false
    );
    const broken = fakeBackend();
    broken.text = 'not what was written';
    check(
      'an unreadable file counts as none set',
      createOwnRelay({ backend: broken, fetch }).active() === false
    );
  }

  // ---- a file that cannot be read this once is asked again ----
  {
    const backend = fakeBackend();
    const first = createOwnRelay({ backend, fetch });
    first.set('relay.test', SECRET);
    const text = backend.text;
    let broken = true;
    const flaky = {
      ...backend,
      read: () =>
        broken
          ? (() => {
              throw new Error('busy');
            })()
          : text,
    };

    // its own clock, and a count of how often the file is read
    let at = 1000000;
    let reads = 0;
    const counted = {
      ...flaky,
      read() {
        reads++;
        return flaky.read();
      },
    };
    const own2 = createOwnRelay({ backend: counted, fetch, now: () => at });
    check(
      'unreadable now: none active, and the window is told why',
      !own2.active() && own2.get().problem === 'unreadable',
      own2.get()
    );

    // asked a thousand times in the same seconds (each push of state asks several times): the
    // file is read once, not a thousand times
    reads = 0;
    at += 10;
    for (let i = 0; i < 1000; i++) {
      own2.active();
      own2.held();
      own2.get();
    }
    check('an unreadable file is not read again at every question', reads === 0, reads);
    check('it still counts as held meanwhile', own2.held() === true);
    broken = false;
    at += 4980;
    check(
      'nor just under five seconds later, though it could be read by now',
      !own2.active() && reads === 0,
      reads
    );
    at += 20;
    check(
      'five seconds after the failed read it is read again: the relay is there',
      own2.active() &&
        own2.get().problem === '' &&
        own2.wsUrl() === 'wss://relay.test' &&
        reads === 1,
      [own2.get(), reads]
    );

    // not "none for the whole run": every five seconds it is tried, for as long as it takes
    broken = true;
    const stubborn = createOwnRelay({ backend: counted, fetch, now: () => at });
    reads = 0;
    for (let second = 0; second < 60; second++) {
      at += 1000;
      stubborn.active();
    }
    check('a file that stays unreadable is tried every five seconds', reads === 12, reads);
    broken = false;
    at += 5000;
    check('and is there as soon as it reads', stubborn.active());

    // a clock that is set back does not leave it unread for the length of the jump
    broken = true;
    const jumpy = createOwnRelay({ backend: counted, fetch, now: () => at });
    jumpy.active();
    broken = false;
    at -= 3600000;
    check('a clock set back an hour counts as time passed', jumpy.active());

    // saving or removing ends the wait and the "unreadable": what was written is what is set
    broken = true;
    const writable = createOwnRelay({ backend: counted, fetch, now: () => at });
    check('unreadable, so held', !writable.active() && writable.held());
    writable.clear();
    check(
      'removed while unreadable: not held any more, no problem named',
      !writable.held() && writable.get().problem === '' && !writable.active(),
      writable.get()
    );
    const rewritten = createOwnRelay({ backend: counted, fetch, now: () => at });
    rewritten.active();
    check(
      'saved while unreadable: set at once, without waiting five seconds',
      rewritten.set('relay.test', SECRET).ok && rewritten.active() && rewritten.get().problem === ''
    );
    broken = false;
    let ready = false;
    const late = { ...backend, available: () => ready, read: () => text };
    const own3 = createOwnRelay({ backend: late, fetch });
    check(
      'storage not ready yet: none active',
      !own3.active() && own3.get().problem === 'unavailable'
    );
    ready = true;
    check('storage ready: the relay is there', own3.active());
  }

  // ---- this computer's id on own relays ----
  {
    const disk = { text: null, writes: 0 };
    const idStore = {
      read: () => disk.text,
      write: s => {
        disk.writes++;
        disk.text = s;
      },
    };
    const o = createOwnRelay({ backend: fakeBackend(), fetch, idStore });
    const id = o.deviceId();
    check(
      'an id of its own is made once and has the shape a relay takes',
      /^[A-Za-z0-9_-]{8,64}$/.test(id) && disk.writes === 1,
      id
    );
    check('the same id every time', o.deviceId() === id && disk.writes === 1);
    o.set('relay.test', SECRET);
    o.set('other.test', OTHER);
    o.clear();
    check('the same id whatever the relay or secret, and after removing it', o.deviceId() === id);
    check(
      'the same id after a restart',
      createOwnRelay({ backend: fakeBackend(), fetch, idStore }).deviceId() === id
    );
    disk.text = '{"id":"bad id!"}';
    const again = createOwnRelay({ backend: fakeBackend(), fetch, idStore }).deviceId();
    check(
      'a stored id of the wrong shape is replaced',
      again !== 'bad id!' && /^[A-Za-z0-9_-]{8,64}$/.test(again)
    );
    const noStore = createOwnRelay({ backend: fakeBackend(), fetch });
    check(
      'no place to keep it: this run still has one',
      /^[A-Za-z0-9_-]{8,64}$/.test(noStore.deviceId())
    );
  }

  // ---- the id file cannot be written or read: a reason for the page, the run goes on ----
  {
    const shape = /^[A-Za-z0-9_-]{8,64}$/;
    const disk = { text: null, writes: 0, tries: 0, reads: 0, fail: true };
    const idStore = {
      read() {
        disk.reads++;
        return disk.text;
      },
      write(s) {
        disk.tries++;
        if (disk.fail) throw new Error('disk full');
        disk.writes++;
        disk.text = s;
      },
    };
    let clock = 1000000;
    const o = createOwnRelay({ backend: fakeBackend(), fetch, idStore, now: () => clock });
    check(
      'no relay set: the id file is not touched and there is no reason',
      o.get().idProblem === '' && disk.reads === 0 && disk.tries === 0,
      [o.get(), disk]
    );
    o.set('relay.test', SECRET);
    const first = o.get();
    const id = o.deviceId();
    check(
      'a write that throws: the reason is id_not_saved and nothing else in the answer changes',
      JSON.stringify(first) ===
        JSON.stringify({
          available: true,
          problem: '',
          idProblem: 'id_not_saved',
          set: true,
          url: 'https://relay.test',
        }),
      first
    );
    check(
      'a write that throws: this run has one id, the same every time',
      shape.test(id) && o.deviceId() === id && o.active() && disk.tries === 1,
      [id, disk]
    );
    o.get();
    o.get();
    check('not saved: it is not written again at once', disk.tries === 1, disk);
    clock += 5000;
    check(
      'not saved: tried again a few seconds later, the reason stays while it fails',
      o.get().idProblem === 'id_not_saved' && disk.tries === 2 && o.deviceId() === id,
      disk
    );
    disk.fail = false;
    clock += 5000;
    const healed = o.get();
    check(
      'the folder can be written again: the same id is saved and the reason is gone',
      healed.idProblem === '' && disk.writes === 1 && JSON.parse(disk.text).id === id,
      [healed, disk]
    );
    clock += 60000;
    o.get();
    check('saved: it is not written again', disk.tries === 3, disk);
    check(
      'saved after all: the next start has the same id and no reason',
      (() => {
        const next = createOwnRelay({ backend: fakeBackend(), fetch, idStore });
        next.set('relay.test', SECRET);
        return next.deviceId() === id && next.get().idProblem === '';
      })()
    );

    // a file that is there and cannot be read: left alone, never written over
    const locked = { tries: 0 };
    const lockedStore = {
      read() {
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
      write() {
        locked.tries++;
      },
    };
    const u = createOwnRelay({
      backend: fakeBackend(),
      fetch,
      idStore: lockedStore,
      now: () => clock,
    });
    u.set('relay.test', SECRET);
    const uid = u.deviceId();
    clock += 60000;
    check(
      'a read that throws: the reason is id_not_read, the run has one id, the file is not written',
      u.get().idProblem === 'id_not_read' &&
        shape.test(uid) &&
        u.deviceId() === uid &&
        locked.tries === 0,
      [u.get(), locked]
    );

    // a relay that is held (its file does not decrypt) counts as "on an own relay" too
    const heldBackend = fakeBackend();
    heldBackend.text = 'not what was written';
    heldBackend.decrypt = () => {
      throw new Error('cannot decrypt');
    };
    const h = createOwnRelay({
      backend: heldBackend,
      fetch,
      idStore: {
        read: () => null,
        write() {
          throw new Error('read-only');
        },
      },
    });
    check(
      'a held relay with an unwritable id file says both',
      h.get().problem === 'unreadable' && h.get().idProblem === 'id_not_saved',
      h.get()
    );
  }

  // ---- the id file itself (idFileStore), in a real folder ----
  {
    const fs = require('fs');
    const os = require('os');
    const { idFileStore } = require('../desktop/own-relay.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-own-relay-id-'));
    try {
      const file = path.join(dir, 'device.json');
      const store = idFileStore({ file });
      check('id file: none yet reads as null', store.read() === null);
      store.write('{"id":"first-id-0001"}\n');
      check(
        'id file: written, read back, and no half-written file is left beside it',
        store.read() === '{"id":"first-id-0001"}\n' && fs.readdirSync(dir).join() === 'device.json',
        fs.readdirSync(dir)
      );

      // something that is there and is no readable file: here a folder of that name
      const folder = path.join(dir, 'a-folder');
      fs.mkdirSync(folder);
      let readThrew = false;
      try {
        idFileStore({ file: folder }).read();
      } catch {
        readThrew = true;
      }
      check('id file: there but not readable throws, it is not "none yet"', readThrew);

      // a folder that does not exist cannot be written to
      let writeThrew = false;
      try {
        idFileStore({ file: path.join(dir, 'missing', 'device.json') }).write('x');
      } catch {
        writeThrew = true;
      }
      check('id file: a write that cannot happen throws', writeThrew);

      // the disk fills up in the middle of the write: the old file is still whole
      const fullDisk = {
        ...fs,
        writeFileSync(target, text) {
          fs.writeFileSync(target, String(text).slice(0, 5));
          throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
        },
      };
      let fullThrew = false;
      try {
        idFileStore({ file, fs: fullDisk }).write('{"id":"second-id-0002"}\n');
      } catch {
        fullThrew = true;
      }
      check(
        'id file: a full disk throws and leaves the saved id as it was',
        fullThrew && store.read() === '{"id":"first-id-0001"}\n'
      );
      check(
        'id file: and no half-written file is left beside it',
        !fs.existsSync(file + '.tmp'),
        fs.readdirSync(dir)
      );

      // through the module: a full disk at the first start gives the reason
      const o = createOwnRelay({
        backend: fakeBackend(),
        fetch,
        idStore: idFileStore({ file: path.join(dir, 'new.json'), fs: fullDisk }),
      });
      o.set('relay.test', SECRET);
      check(
        'id file: a full disk reaches the page as id_not_saved',
        o.get().idProblem === 'id_not_saved'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    check('id file: the test folder is gone', !fs.existsSync(dir));
  }

  // ---- the Devices page has a sentence for each reason ----
  {
    const fs = require('fs');
    const page = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'scripts', '111-devices-page.js'),
      'utf8'
    );

    // every refusal that stops the link (STOPS in desktop/own-relay.js) has its sentence
    const stopsBlock = (/const STOPPED = \{([\s\S]*?)\};/.exec(page) || [])[1] || '';
    const stops = (/const STOPS = new Set\(\[([^\]]*)\]\)/.exec(
      fs.readFileSync(path.join(__dirname, '..', 'desktop', 'own-relay.js'), 'utf8')
    ) || [])[1];
    const stopCodes = (stops || '').match(/[a-z_]+/g) || [];
    check(
      'page: every refusal that stops the link has a sentence (device_revoked included)',
      stopCodes.includes('device_revoked') &&
        stopCodes.every(code => new RegExp('\\b' + code + ':\\s*\\n?\\s*[\'"]').test(stopsBlock)),
      stopCodes
    );
    const block = (/const ID_ERR = \{([\s\S]*?)\};/.exec(page) || [])[1] || '';
    const sentence = key => (new RegExp(key + ':\\s*"([^"]+)"').exec(block) || [])[1] || '';
    const notSaved = sentence('id_not_saved'),
      notRead = sentence('id_not_read');
    check(
      'page: id_not_saved says it holds only until the app closes, and what to do',
      /could not be saved/.test(notSaved) &&
        /until the app closes/.test(notSaved) &&
        /free disk space or make the app's settings folder writable/.test(notSaved),
      notSaved
    );
    check(
      'page: id_not_read says it will not survive a restart, and what to do',
      /could not be read/.test(notRead) &&
        /will not survive a restart/.test(notRead) &&
        /settings folder readable, then restart/.test(notRead),
      notRead
    );
    check(
      "page: the sentence is drawn on this computer's card from own.idProblem, in the muted line",
      /Object\.hasOwn\(ID_ERR, own\.idProblem\)/.test(page) &&
        /el\('p', 'dv-muted', ID_ERR\[own\.idProblem\]\)/.test(page)
    );
    check(
      'page: a save or removal keeps the reason it was handed',
      /own = \{[^}]*idProblem: r\.idProblem[^}]*\}/.test(page)
    );
    check(
      'page: main.js keeps the id in the file store of own-relay.js',
      /idStore: require\('\.\/own-relay'\)\.idFileStore\(/.test(
        fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8')
      )
    );
  }

  // ---- against the relay ----
  {
    const { own } = make();
    own.set('relay.test', SECRET);
    seen.length = 0;
    const ticket = await own.ticket(A);
    const sent = seen[0];
    check(
      'the ticket call goes to the relay address',
      sent.url === 'https://relay.test/remote/ticket' && sent.init.method === 'POST'
    );
    check('the secret is not in what is sent', !JSON.stringify(sent).includes(SECRET));
    check('a redirect is never followed', sent.init.redirect === 'error');
    const ws = await open(ticket);
    check('the ticket opens a connection on the relay', ws.status === 101);
    check('and only once', (await open(ticket)).status === 401);

    // the same millisecond: the next proof is still newer
    t += 0;
    const second = await own.ticket(A).catch(e => e);
    check('two tickets in the same millisecond both work', typeof second === 'string', second);
    t += 5;
    await open(await own.ticket(B));
    const list = await own.devices(A);
    check(
      'the relay lists the connected devices',
      list.length === 2 && list.every(d => d.name === '' && Number.isFinite(d.last_seen)),
      list
    );

    // Remove: B is connected, so the relay keeps it; an id never seen is "removed" (nothing there)
    check(
      'forget: a connected device is refused as online',
      same(await own.forget(A, B), { ok: false, error: 'online' })
    );
    seen.length = 0;
    check(
      'forget: a device that is not connected is removed',
      (await own.forget(A, 'gone-device-01')).ok === true
    );
    check(
      'forget: the call names the device and carries no secret',
      seen[0]?.url === 'https://relay.test/remote/forget?d=gone-device-01' &&
        !JSON.stringify(seen[0]).includes(SECRET)
    );
    check(
      'forget: a bad id is not sent',
      same(await own.forget(A, 'bad id'), { ok: false, error: 'invalid_device' })
    );
    check(
      'a device id the relay would refuse is not sent',
      (await own.ticket('bad id').catch(e => e)).code === 'device_required'
    );

    const wrong = make().own;
    wrong.set('relay.test', OTHER);
    const refused = await wrong.ticket(A).catch(e => e);
    check(
      'a wrong secret is refused by the relay',
      refused.status === 401 && refused.code === 'invalid_proof',
      refused
    );
    check('and lists nothing', (await wrong.devices(A)).length === 0);

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
    check(
      'an answer that never ends is given up at the limit',
      endless.code === 'network',
      endless
    );
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
      o.set('relay.test', SECRET);
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
      o.set('relay.test', SECRET);
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
    // takes, so the proof that follows still fits its window.
    {
      const timeSent = () => Number(seen.at(-1).init.headers['X-Relay-Time']);
      mode = 'after-ahead';
      aheadMs = 111 * 1000;
      const doubting = make().own;
      doubting.set('relay.test', SECRET);
      seen.length = 0;
      await doubting.ticket(A).catch(e => e);
      check(
        'a newest time 111 seconds ahead is not taken: no second try, and the next proof is dated now',
        seen.length === 1,
        seen.length
      );
      mode = 'down';
      await doubting.ticket(A).catch(e => e);
      check('the proof after it is dated by this clock', timeSent() <= t + 2, timeSent() - t);

      mode = 'after-ahead';
      aheadMs = 109 * 1000;
      const moved = make().own;
      moved.set('relay.test', SECRET);
      seen.length = 0;
      await moved.ticket(A).catch(e => e);
      check(
        'one 109 seconds ahead is taken: a second try at once, dated just after it',
        seen.length === 2 && timeSent() === t + aheadMs + 1,
        [seen.length, timeSent() - t]
      );

      // The user corrects the address. The time the wrong relay moved the app to must not go
      // along: the right relay would find the first proofs outside its window and answer that
      // this computer's clock is wrong.
      mode = 'down';
      await moved.ticket(A).catch(e => e);
      check('before the change the proofs are still dated ahead', timeSent() > t + 100000);
      moved.set('other-relay.test', SECRET);
      await moved.ticket(A).catch(e => e);
      check(
        'after another relay is saved the proofs are dated by this clock again',
        timeSent() <= t + 2,
        timeSent() - t
      );
      mode = 'after-ahead';
      await moved.ticket(A).catch(e => e);
      mode = 'relay';
      moved.set('relay.test', SECRET);
      const atTheRealOne = await moved.ticket(A).catch(e => e);
      check(
        'and the real relay takes the first proof after the change (no "clock_off")',
        typeof atTheRealOne === 'string',
        atTheRealOne
      );
      mode = 'after-ahead';
      await moved.ticket(A).catch(e => e);
      moved.clear();
      moved.set('relay.test', SECRET);
      mode = 'down';
      await moved.ticket(A).catch(e => e);
      check('removing the relay resets the proof time too', timeSent() <= t + 2, timeSent() - t);
    }
    mode = 'text';
    const text = await own.ticket(A).catch(e => e);
    check('a relay cannot put its own text into an error', text.code === 'refused', text);

    // rules the earlier rounds left without a test
    mode = 'long-ticket';
    const longTicket = await own.ticket(A).catch(e => e);
    check(
      'a ticket longer than a ticket can be is refused, not handed to the link',
      longTicket.status === 502 && longTicket.code === 'refused',
      longTicket
    );
    mode = 'long-list';
    const longList = await own.devices(A);
    check(
      'a device list is cut at 64 and holds well-shaped ids only',
      longList.length === 64 &&
        longList.every(d => /^listed-\d{4}$/.test(d.id) && d.name === '' && d.last_seen === 0),
      [longList.length, longList.slice(0, 5)]
    );
    check(
      'every call has a time limit of ten seconds',
      seen.at(-1).init.signal instanceof AbortSignal && seen.at(-1).init.signal.aborted === false
    );
    mode = 'relay';

    // a proof the relay has already seen (a clock that was ahead and was set back): the link
    // waits, and the next try continues from the relay's time
    {
      const ahead = make().own;
      ahead.set('relay.test', SECRET);
      const C = '33333333-3333-4333-8333-333333333333';
      t += 60000;
      await ahead.ticket(C);
      const back = createOwnRelay({ backend: fakeBackend(), fetch, now: () => t - 30000 });
      back.set('relay.test', SECRET);
      seen.length = 0;
      const first = await back.ticket(C).catch(e => e);
      check(
        'a proof older than the relay knows: the app continues from the relay time and tries once more at once',
        typeof first === 'string' && seen.length === 2,
        [first, seen.length]
      );
    }

    // a proof made for one address is refused at another relay with the same secret
    {
      const typo = make().own;
      typo.set('other-relay.test', SECRET);
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
    check(
      'no relay set: no call is made',
      (await none.ticket(A).catch(e => e)).code === 'no_relay'
    );
    env = { ...env, RELAY_SECRET: '' };
    const unset = await own.ticket(A).catch(e => e);
    check(
      'a relay with no secret says it is not set up',
      unset.status === 503 && unset.code === 'relay_not_set_up',
      unset
    );
  }

  // ---- per-device keys (docs/plans/own-relay.md, "Per-device keys"), against the real relay ----
  {
    const crypto = require('crypto');
    env = { RELAY_SECRET: SECRET, RELAY_HUB: shim.createHubNamespace(RelayHub, () => env) };
    mode = 'relay';
    t = Date.now();
    const memoryIds = (id = '') => {
      const s = {
        text: id ? JSON.stringify({ id }) : null,
        read: () => s.text,
        write: x => (s.text = x),
      };
      return s;
    };
    const stored = b => JSON.parse(b.decrypt(Buffer.from(b.text, 'base64')).toString('utf8'));
    const C = '33333333-3333-4333-8333-333333333333',
      D = '44444444-4444-4444-8444-444444444444';

    // Save: this computer's key is kept, never the secret
    const keyBackend = fakeBackend();
    const keyed = createOwnRelay({ backend: keyBackend, fetch, idStore: memoryIds(C) });
    keyed.set('https://relay.test', SECRET);
    const entry = stored(keyBackend);
    const expectedKey = crypto
      .createHmac('sha256', SECRET)
      .update('device-key:' + C)
      .digest('hex');
    check(
      'per-device: Save keeps this computer key for its id, and not the secret',
      entry.key === expectedKey &&
        entry.id === C &&
        cleanSecret(entry.secret) === null &&
        !keyBackend.decrypt(Buffer.from(keyBackend.text, 'base64')).toString().includes(SECRET),
      Object.keys(entry)
    );
    const ticketC = await keyed.ticket(C).catch(e => e);
    check(
      'per-device: the key buys a ticket from the real relay',
      typeof ticketC === 'string',
      ticketC
    );
    check(
      'per-device: it signs for no other id (nothing is sent)',
      (await keyed.ticket(D).catch(e => e)).code === 'device_required'
    );

    // what a stolen key can do at the relay: its own id, no other
    const signed = async (id, key, what = 'ticket') => {
      const time = Date.now() + Math.floor(Math.random() * 1000);
      const proof = crypto
        .createHmac('sha256', key)
        .update(`proof:${what}:relay.test:${id}:${time}`)
        .digest('hex');
      return worker.fetch(
        new Request('https://relay.test/remote/ticket', {
          method: 'POST',
          headers: { 'X-Relay-Device': id, 'X-Relay-Time': String(time), 'X-Relay-Proof': proof },
        }),
        env
      );
    };
    check(
      "per-device: a stolen key is refused for another computer's id and for a phone id",
      (await signed(D, entry.key)).status === 401 &&
        (await signed('ph-0123456789', entry.key)).status === 401
    );

    // a relay saved by an earlier build (the secret) is moved over at its next read
    const oldBackend = fakeBackend();
    createOwnRelay({ backend: oldBackend, fetch }).set('https://relay.test', SECRET);
    check(
      'per-device: (stand-in) an earlier save holds the secret',
      'secret' in stored(oldBackend)
    );
    const moved = createOwnRelay({ backend: oldBackend, fetch, idStore: memoryIds(D) });
    check('per-device: the old save is read as a relay', moved.active() === true);
    const after = stored(oldBackend);
    check(
      'per-device: and saved again as the key of this computer, without the secret',
      after.id === D && /^[0-9a-f]{64}$/.test(after.key) && cleanSecret(after.secret) === null,
      Object.keys(after)
    );
    t = Date.now() + 5;
    check(
      'per-device: the moved relay still buys tickets',
      typeof (await moved.ticket(D).catch(e => e)) === 'string'
    );

    // this computer's id cannot be read: the secret is kept, so the next start still works
    const lockedIds = {
      read: () => {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      },
      write: () => {},
    };
    const lockedBackend = fakeBackend();
    createOwnRelay({ backend: lockedBackend, fetch, idStore: lockedIds }).set(
      'https://relay.test',
      SECRET
    );
    check(
      'per-device: with the id unreadable, Save keeps the secret (a key for this run only would not sign later)',
      'secret' in stored(lockedBackend) && !('key' in stored(lockedBackend))
    );

    // a key saved for another id (the id file was replaced) is held, not used
    const otherIdBackend = fakeBackend();
    createOwnRelay({ backend: otherIdBackend, fetch, idStore: memoryIds(C) }).set(
      'https://relay.test',
      SECRET
    );
    const replaced = createOwnRelay({ backend: otherIdBackend, fetch, idStore: memoryIds(D) });
    const seenBefore = seen.length;
    check(
      'per-device: a key for another id is held as a secret no longer taken, and nothing is sent',
      replaced.get().problem === 'old_secret' &&
        replaced.active() === false &&
        replaced.held() === true &&
        (await replaced.ticket(D).catch(e => e)).code === 'no_relay' &&
        seen.length === seenBefore,
      replaced.get()
    );

    // revoked on the relay (by the secret's owner): the link stops and says why
    const revokeTime = Date.now() + 10;
    const revoked = await worker.fetch(
      new Request('https://relay.test/remote/revoke?d=' + C, {
        method: 'POST',
        headers: {
          'X-Relay-Device': 'relay-owner',
          'X-Relay-Time': String(revokeTime),
          'X-Relay-Proof': crypto
            .createHmac('sha256', SECRET)
            .update(`proof:revoke:${C}:relay.test:relay-owner:${revokeTime}`)
            .digest('hex'),
        },
      }),
      env
    );
    t = Date.now() + 20;
    const refused = await keyed.ticket(C).catch(e => e);
    check(
      'per-device: a revoked computer is refused, and the link stops on it (403 device_revoked)',
      revoked.status === 200 && refused.status === 403 && refused.code === 'device_revoked',
      [revoked.status, refused]
    );

    // An older build (0.3.73, the last before per-device keys) reads the file this build saves.
    // It knows only `secret`: it must hold the relay as "secret no longer taken", never read
    // "no relay" (a signed-in account would then remove every pairing).
    const { execFileSync } = require('child_process');
    const os = require('os');
    let older = null;
    try {
      const code = execFileSync('git', ['show', 'v0.3.73:desktop/own-relay.js'], {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const file = path.join(os.tmpdir(), 'tnai-own-relay-0.3.73-' + process.pid + '.js');
      require('fs').writeFileSync(file, code);
      older = require(file);
      require('fs').unlinkSync(file);
    } catch {
      console.log('skipped: the 0.3.73 version is not in this copy of git');
    }
    if (older) {
      const oldRead = older.createOwnRelay({ backend: keyBackend, fetch });
      check(
        'per-device: 0.3.73 reads a saved key as a relay held for its secret, not as no relay',
        oldRead.get().problem === 'old_secret' && oldRead.held() === true,
        oldRead.get()
      );
      check(
        'per-device: and the mark it reads is no secret today either',
        cleanSecret(stored(keyBackend).secret) === null &&
          older.cleanSecret(stored(keyBackend).secret) === null
      );
    }

    // A key refused by a relay deployed before keys: "deploy it again", not "check the secret"
    const tooOldBackend = fakeBackend();
    const tooOld = createOwnRelay({ backend: tooOldBackend, fetch, idStore: memoryIds(C) });
    tooOld.set('https://relay.test', SECRET);
    mode = 'old-relay';
    const oldAnswer = await tooOld.ticket(C).catch(e => e);
    mode = 'relay';
    check(
      'per-device: a relay without keys says relay_too_old, and the link stops (403)',
      oldAnswer.status === 403 && oldAnswer.code === 'relay_too_old',
      oldAnswer
    );

    // a relay that knows keys and refuses this one (another secret) still says invalid_proof
    env = { RELAY_SECRET: OTHER, RELAY_HUB: shim.createHubNamespace(RelayHub, () => env) };
    t = Date.now() + 30;
    const wrongAnswer = await tooOld.ticket(C).catch(e => e);
    check(
      'per-device: a relay with keys that refuses the key still says invalid_proof',
      wrongAnswer.status === 401 && wrongAnswer.code === 'invalid_proof',
      wrongAnswer
    );
  }

  console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
})();
