// Test of desktop/own-relay-wiring.js: node tools/own-relay-wiring-test.js (plain Node, no window).
// The wiring that joins "Use my own relay" to the several-computers service used to sit in
// main.js, where nothing could test it. Here it runs with the real desktop/own-relay.js and
// stand-ins for the account (userAuth), the service (remote), the encrypted file and the network:
// which source each value comes from with and without a relay, which account the service is told,
// in which order, when the user is asked before pairings are removed, and the shape of a ticket
// error from the account.
const { createOwnRelay, ACCOUNT_ID } = require('../desktop/own-relay.js');
const { createOwnRelayWiring } = require('../desktop/own-relay-wiring.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SECRET = 'kR7_tQ2mXv9LpZ4wYb6NcH1sDf8GjA3eUo5i',
  RELAY = 'https://relay.example.com',
  RELAY_2 = 'https://other-relay.example.com',
  ACCOUNT_DEVICE = 'account-device-0001',
  USER = { id: 'user-1', email: 'someone@example.com' };

// The encrypted file: "encryption" that is easy to see through, and a count of what was written.
function fakeBackend() {
  const b = {
    text: null,
    writes: 0,
    usable: true,
    failWrite: false,
    available: () => b.usable,
    encrypt: buf => Buffer.from('ENC[' + buf.toString('base64') + ']'),
    decrypt: buf => Buffer.from(buf.toString().slice(4, -1), 'base64'),
    read: () => b.text,
    write(t) {
      if (b.failWrite) throw new Error('disk');
      b.writes++;
      b.text = t;
    },
  };
  return b;
}

// One world: the real own-relay module, a relay that answers over a made-up fetch, an account and
// a service that write down every call in one shared list, so the order across them can be read.
function world() {
  const calls = [];
  const backend = fakeBackend();
  const idText = { value: null };

  // the user's relay: a ticket and one other device
  const fetch = async (address, options) => {
    calls.push(['fetch', options.method, address, options.headers['X-Relay-Device']]);
    const body = address.endsWith('/remote/ticket')
      ? { ticket: 'ticket-from-own-relay' }
      : { devices: [{ id: 'relay-device-0002', last_seen: 7 }] };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const ownRelay = createOwnRelay({
    backend,
    fetch,
    idStore: {
      read: () => idText.value,
      write(text) {
        idText.value = text;
      },
    },
  });

  // the Technically Not account
  const account = {
    user: null,
    // what accountCall answers: a value, or a function that may throw
    reply: () => ({ ok: true, status: 200, body: { ticket: 'ticket-from-account' } }),
  };
  const userAuth = {
    thisDevice: () => ({ id: ACCOUNT_DEVICE, name: 'Test desk' }),
    apiBase: () => 'https://accounts.example.com',
    publicState: () => ({ user: account.user }),
    async accountCall(...args) {
      calls.push(['accountCall', ...args]);
      return account.reply(...args);
    },
  };

  // the several-computers service: the account it stored pairings under, and how many
  const stored = { account: '', pairings: 0, wipes: 0 };
  const remote = {
    // with this computer's id and the relay's address as they are at that moment
    relayGoing() {
      calls.push(['relayGoing', wiring.selfId(), wiring.url()]);
    },
    relayChanged() {
      calls.push(['relayChanged', wiring.selfId(), wiring.url()]);
    },
    accountChanged(signedIn, id) {
      calls.push(['accountChanged', signedIn, id]);
      if (!signedIn || !id) return;
      if (stored.account && stored.account !== id) {
        stored.pairings = 0;
        stored.wipes++;
      }
      stored.account = id;
    },
    wouldRemove(id) {
      calls.push(['wouldRemove', id]);
      return id && stored.account && stored.account !== id ? stored.pairings : 0;
    },
    state() {
      calls.push(['state']);
      return { on: true, marker: 'state-of-the-service' };
    },
  };
  const wiring = createOwnRelayWiring({ ownRelay, userAuth, remote: () => remote });

  // the names of the service's calls since `from`, without the read-only question
  const serviceCalls = (from = 0) =>
    calls
      .slice(from)
      .filter(c => ['relayChanged', 'accountChanged', 'state'].includes(c[0]))
      .map(c => c[0]);
  const told = (from = 0) =>
    calls
      .slice(from)
      .filter(c => c[0] === 'accountChanged')
      .map(c => c.slice(1));
  return { calls, backend, ownRelay, account, stored, remote, wiring, serviceCalls, told };
}

// A rejection as a value: { threw: what was thrown } or { value }.
async function outcome(promise) {
  try {
    return { value: await promise };
  } catch (e) {
    return { threw: e };
  }
}

(async () => {
  // ---- no relay set: every one of the six values comes from the account ----
  {
    const w = world();
    check(
      'no relay: this computer is the id the account knows',
      w.wiring.selfId() === ACCOUNT_DEVICE
    );
    check(
      'no relay, signed in: the account is the user',
      same(w.wiring.who(USER), [true, 'user-1'])
    );
    check(
      'no relay, signed out: no account',
      same(w.wiring.who(null), [false, '']),
      w.wiring.who(null)
    );
    check(
      'no relay, a user without an id: signed in with no account id',
      same(w.wiring.who({}), [true, ''])
    );
    check(
      'no relay: the address is the accounts server as a socket address',
      w.wiring.url() === 'wss://accounts.example.com',
      w.wiring.url()
    );
    check('no relay: device ids are not free to take', w.wiring.freeIds() === false);
    const ticket = await w.wiring.getTicket();
    check(
      'no relay: the ticket is asked of the account, and nothing is sent to any relay',
      ticket === 'ticket-from-account' &&
        same(w.calls, [['accountCall', 'POST', '/remote/ticket']]),
      w.calls
    );
    w.calls.length = 0;
    w.account.reply = () => ({ ok: true, body: { devices: [{ id: 'd1', name: 'Laptop' }] } });
    const devices = await w.wiring.devices();
    check(
      "no relay: the device list is the account's, asked so that it also works behind the lock",
      same(devices, [{ id: 'd1', name: 'Laptop' }]) &&
        same(w.calls, [['accountCall', 'GET', '/me/devices', undefined, { allowLocked: true }]]),
      w.calls
    );
    w.account.reply = () => ({ ok: false, body: { devices: [{ id: 'd1' }] } });
    check('no relay: a refused device list is an empty list', same(await w.wiring.devices(), []));
    w.account.reply = () => ({ ok: true, body: { devices: 'none' } });
    check(
      'no relay: a device list that is no list is an empty list',
      same(await w.wiring.devices(), [])
    );
    w.account.reply = () => null;
    check(
      'no relay: no answer for the device list is an empty list',
      same(await w.wiring.devices(), [])
    );
    check(
      'no relay: get says none is set',
      w.wiring.get().set === false && w.wiring.get().url === ''
    );
  }

  // ---- a ticket error from the account keeps its old shape (the link reads status and code) ----
  {
    const w = world();
    const refusal = async reply => {
      w.account.reply = reply;
      return (await outcome(w.wiring.getTicket())).threw;
    };
    check(
      'ticket: signed out or locked (no answer) is { status: 401, code: signed_out }',
      same(await refusal(() => null), { status: 401, code: 'signed_out' })
    );
    check(
      "ticket: a refusal carries the server's status and error",
      same(await refusal(() => ({ ok: false, status: 402, body: { error: 'plan_required' } })), {
        status: 402,
        code: 'plan_required',
      })
    );
    check(
      'ticket: a refusal without an error is "refused" with its status',
      same(await refusal(() => ({ ok: false, status: 500, body: {} })), {
        status: 500,
        code: 'refused',
      })
    );
    check(
      'ticket: an answer that is ok but holds no ticket text is refused',
      same(await refusal(() => ({ ok: true, status: 200, body: { ticket: 5 } })), {
        status: 200,
        code: 'refused',
      })
    );
    check(
      'ticket: a call that throws with a code is { status: 0, that code }',
      same(
        await refusal(() => {
          throw { code: 'timeout' };
        }),
        { status: 0, code: 'timeout' }
      )
    );
    check(
      'ticket: a call that throws without a code is { status: 0, code: network }',
      same(
        await refusal(() => {
          throw new Error('offline');
        }),
        { status: 0, code: 'network' }
      )
    );
  }

  // ---- setting a relay: the link first, the account second, then every value from the relay ----
  {
    const w = world();
    const saved = w.wiring.set(RELAY, SECRET, false);
    check(
      "set, signed out, nothing paired: saved, and the answer is get() with the service's state",
      saved.ok === true &&
        saved.set === true &&
        saved.url === RELAY &&
        saved.available === true &&
        saved.state?.marker === 'state-of-the-service',
      saved
    );
    check('set: the secret is not in the answer', !JSON.stringify(saved).includes(SECRET));
    check(
      'set: the link is made again first, the account is told second, the state is read last',
      same(w.serviceCalls(), ['relayChanged', 'accountChanged', 'state']),
      w.serviceCalls()
    );
    check(
      'set, signed out: the relay stands in for the account (signed in as "own-relay")',
      same(w.told(), [[true, ACCOUNT_ID]]) && ACCOUNT_ID === 'own-relay',
      w.told()
    );

    const ownId = w.ownRelay.deviceId();
    check(
      'relay set: this computer is its own-relay id, not the id the account knows',
      w.wiring.selfId() === ownId && ownId !== ACCOUNT_DEVICE && ownId.length >= 8
    );
    check(
      'relay set: signed in or not, the account is "own-relay"',
      same(w.wiring.who(USER), [true, 'own-relay']) && same(w.wiring.who(null), [true, 'own-relay'])
    );
    check(
      'relay set: the address is the relay as a socket address',
      w.wiring.url() === 'wss://relay.example.com',
      w.wiring.url()
    );
    check('relay set: device ids are free to take', w.wiring.freeIds() === true);
    w.calls.length = 0;
    const ticket = await w.wiring.getTicket();
    check(
      'relay set: the ticket is asked of the relay under the own-relay id, the account is not asked',
      ticket === 'ticket-from-own-relay' &&
        same(w.calls, [['fetch', 'POST', RELAY + '/remote/ticket', ownId]]),
      w.calls
    );
    w.calls.length = 0;
    const devices = await w.wiring.devices();
    check(
      "relay set: the device list is the relay's, asked under the own-relay id",
      same(devices, [{ id: 'relay-device-0002', name: '', last_seen: 7 }]) &&
        same(w.calls, [['fetch', 'GET', RELAY + '/remote/presence', ownId]]),
      w.calls
    );

    // signed in while a relay is saved
    const w2 = world();
    w2.account.user = USER;
    w2.wiring.set(RELAY, SECRET, false);
    check(
      'set, signed in, nothing paired: the account told is still "own-relay"',
      same(w2.told(), [[true, 'own-relay']]),
      w2.told()
    );
  }

  // ---- removing the relay: the account that follows ----
  {
    const w = world();
    w.wiring.set(RELAY, SECRET, false);
    w.account.user = USER;
    let from = w.calls.length;
    const cleared = w.wiring.clear(false);
    check(
      'clear, signed in, nothing paired: removed, and the answer is get() with the state',
      cleared.ok === true &&
        cleared.set === false &&
        cleared.url === '' &&
        cleared.state?.marker === 'state-of-the-service',
      cleared
    );
    check(
      'clear: the link first, the account second, the state last',
      same(w.serviceCalls(from), ['relayChanged', 'accountChanged', 'state']),
      w.serviceCalls(from)
    );
    check(
      'clear, signed in: the account told is the signed-in user',
      same(w.told(from), [[true, 'user-1']]),
      w.told(from)
    );
    check("clear: this computer is the account's id again", w.wiring.selfId() === ACCOUNT_DEVICE);

    const w2 = world();
    w2.wiring.set(RELAY, SECRET, false);
    from = w2.calls.length;
    w2.wiring.clear(false);
    check(
      'clear, signed out: the service is told an account that is nobody\'s, then "signed out"',
      same(w2.told(from), [
        [true, 'nobody'],
        [false, ''],
      ]),
      w2.told(from)
    );
  }

  // ---- the question before pairings are removed ----
  {
    // an account's pairings, then "Use my own relay"
    const w = world();
    w.account.user = USER;
    w.stored.account = 'user-1';
    w.stored.pairings = 2;
    let from = w.calls.length;
    const asked = w.wiring.set(RELAY, SECRET, false);
    check(
      "confirm: saving a relay over an account's pairings answers would_remove with their number",
      same(asked, { ok: false, error: 'would_remove', count: 2 }),
      asked
    );
    check(
      'confirm: and changes nothing (no file written, no relay set, the service not told, nothing removed)',
      w.backend.writes === 0 &&
        w.wiring.get().set === false &&
        w.serviceCalls(from).length === 0 &&
        w.stored.pairings === 2 &&
        w.stored.wipes === 0,
      { writes: w.backend.writes, calls: w.serviceCalls(from), stored: w.stored }
    );
    check(
      'confirm: the question is asked about the account the change leads to',
      same(
        w.calls.slice(from).filter(c => c[0] === 'wouldRemove'),
        [['wouldRemove', 'own-relay']]
      ),
      w.calls.slice(from)
    );
    for (const loose of [undefined, 'true', 1, {}, null]) {
      const again = w.wiring.set(RELAY, SECRET, loose);
      check(
        'confirm: only a strict true counts as yes, not ' + JSON.stringify(loose),
        again.error === 'would_remove' && w.backend.writes === 0,
        again
      );
    }
    check(
      'confirm: a mistyped address is refused before the question, so nobody agrees for nothing',
      same(w.wiring.set('ftp://nowhere', SECRET, false), { ok: false, error: 'bad_url' }) &&
        same(w.wiring.set(RELAY, 'short', false), { ok: false, error: 'bad_secret' })
    );
    from = w.calls.length;
    const yes = w.wiring.set(RELAY, SECRET, true);
    check(
      "confirm: with true the relay is saved and the service removes the account's pairings",
      yes.ok === true &&
        yes.set === true &&
        w.stored.wipes === 1 &&
        w.stored.pairings === 0 &&
        same(w.told(from), [[true, 'own-relay']]) &&
        same(w.serviceCalls(from), ['relayChanged', 'accountChanged', 'state']),
      { yes, stored: w.stored, calls: w.serviceCalls(from) }
    );

    // a change of address or secret alone keeps the account: no question, nothing removed
    w.stored.pairings = 3;
    from = w.calls.length;
    const moved = w.wiring.set(RELAY_2, SECRET, false);
    check(
      'confirm: another address with a relay already set asks nothing and removes nothing',
      moved.ok === true &&
        moved.url === RELAY_2 &&
        w.stored.pairings === 3 &&
        w.stored.wipes === 1 &&
        same(w.told(from), [[true, 'own-relay']]),
      { moved, stored: w.stored }
    );

    // back to the account while signed in: the relay's pairings would go
    from = w.calls.length;
    const writes = w.backend.writes;
    const askedClear = w.wiring.clear(false);
    check(
      'confirm: removing the relay while signed in answers would_remove and keeps the relay',
      same(askedClear, { ok: false, error: 'would_remove', count: 3 }) &&
        w.wiring.get().set === true &&
        w.backend.writes === writes &&
        w.serviceCalls(from).length === 0 &&
        w.stored.pairings === 3,
      { askedClear, calls: w.serviceCalls(from) }
    );
    check(
      "confirm: that question is asked about the signed-in user's account",
      same(
        w.calls.slice(from).filter(c => c[0] === 'wouldRemove'),
        [['wouldRemove', 'user-1']]
      ),
      w.calls.slice(from)
    );
    check(
      'confirm: for removing too only a strict true counts',
      w.wiring.clear('true').error === 'would_remove' && w.wiring.clear(1).error === 'would_remove'
    );
    const clearedYes = w.wiring.clear(true);
    check(
      'confirm: with true the relay is removed and the pairings with it',
      clearedYes.ok === true &&
        clearedYes.set === false &&
        w.stored.wipes === 2 &&
        w.stored.pairings === 0,
      { clearedYes, stored: w.stored }
    );

    // Signed out, removing the relay: the pairings made through it would otherwise be removed
    // without a question at the next sign-in, so the question comes now.
    const w2 = world();
    w2.wiring.set(RELAY, SECRET, false);
    w2.stored.pairings = 4;
    from = w2.calls.length;
    const out = w2.wiring.clear(false);
    check(
      'confirm: removing the relay while signed out asks first, with the count, and changes nothing',
      out.ok === false &&
        out.error === 'would_remove' &&
        out.count === 4 &&
        w2.stored.pairings === 4 &&
        w2.stored.wipes === 0 &&
        w2.wiring.get().set === true &&
        w2.told(from).length === 0,
      { out, stored: w2.stored }
    );
    from = w2.calls.length;
    const outYes = w2.wiring.clear(true);
    check(
      'confirm: with true they are removed then, and the service ends signed out',
      outYes.ok === true &&
        w2.stored.pairings === 0 &&
        w2.stored.wipes === 1 &&
        same(w2.told(from), [
          [true, 'nobody'],
          [false, ''],
        ]),
      { outYes, stored: w2.stored, told: w2.told(from) }
    );
    w2.account.user = { id: 'user-9' };
    const wipesBefore = w2.stored.wipes;
    w2.remote.accountChanged(...w2.wiring.who(w2.account.user));
    check(
      'confirm: a sign-in afterwards finds no pairing left to remove',
      w2.stored.pairings === 0 &&
        w2.stored.wipes === wipesBefore + 1 &&
        w2.stored.account === 'user-9',
      w2.stored
    );

    // A relay that is saved but cannot be read this once (the file does not decrypt, or secure
    // storage is not ready): the computer still counts as on its own relay, so an account push in
    // that moment removes nothing.
    const held = world();
    held.wiring.set(RELAY, SECRET, false);
    held.stored.pairings = 2;
    held.account.user = { id: 'user-1' };
    const good = held.backend.read;
    const fresh = require('../desktop/own-relay.js').createOwnRelay({
      backend: {
        ...held.backend,
        exists: () => true,
        read() {
          throw new Error('busy');
        },
      },
    });
    const { createOwnRelayWiring } = require('../desktop/own-relay-wiring.js');
    const during = createOwnRelayWiring({
      ownRelay: fresh,
      userAuth: { publicState: () => ({ user: held.account.user }) },
      remote: () => held.remote,
    });
    check(
      'an unreadable relay file: the relay is not active, but it is held',
      fresh.active() === false && fresh.held() === true && fresh.get().problem === 'unreadable',
      fresh.get()
    );
    check(
      'an unreadable relay file: the account told stays the own relay, not the signed-in user',
      same(during.who(held.account.user), [true, 'own-relay']),
      during.who(held.account.user)
    );
    held.remote.accountChanged(...during.who(held.account.user));
    check(
      'an unreadable relay file: an account push removes nothing',
      held.stored.pairings === 2 && held.stored.wipes === 0,
      held.stored
    );
    const notReady = require('../desktop/own-relay.js').createOwnRelay({
      backend: { ...held.backend, available: () => false, exists: () => true, read: good },
    });
    check('storage not ready but a relay file is there: held', notReady.held() === true);
    const never = require('../desktop/own-relay.js').createOwnRelay({
      backend: { ...held.backend, available: () => false, exists: () => false, read: good },
    });
    check(
      'no secure storage and no relay file: not held, the account counts',
      never.held() === false
    );
    const noRelay = world();
    check(
      'no relay was ever saved: not held',
      noRelay.wiring.who({ id: 'user-1' })[1] === 'user-1'
    );

    // pairings made before any account was recorded are adopted, not removed
    const w3 = world();
    w3.stored.pairings = 2;
    const adopt = w3.wiring.set(RELAY, SECRET, false);
    check(
      'confirm: pairings stored under no account are kept, so nothing is asked',
      adopt.ok === true && w3.stored.pairings === 2 && w3.stored.account === 'own-relay',
      { adopt, stored: w3.stored }
    );
  }

  // ---- the link is ended before the relay changes, under the id it was made with ----
  // (saved first, the link's last words went out under the new id on a
  // socket opened under the old one, and the relay refuses those)
  {
    const w = world();
    const linkCalls = from =>
      w.calls.slice(from).filter(c => c[0] === 'relayGoing' || c[0] === 'relayChanged');
    w.wiring.set(RELAY, SECRET, false);
    const ownId = w.ownRelay.deviceId();
    check(
      'set: the link is ended while this computer still has the id and address it had before',
      same(linkCalls(0), [
        ['relayGoing', ACCOUNT_DEVICE, 'wss://accounts.example.com'],
        ['relayChanged', ownId, 'wss://relay.example.com'],
      ]),
      linkCalls(0)
    );
    let from = w.calls.length;
    w.wiring.set(RELAY_2, SECRET, false);
    check(
      'another address: the old link is ended at the old address, the new one made at the new',
      same(linkCalls(from), [
        ['relayGoing', ownId, 'wss://relay.example.com'],
        ['relayChanged', ownId, 'wss://other-relay.example.com'],
      ]),
      linkCalls(from)
    );
    from = w.calls.length;
    w.wiring.clear(true);
    check(
      'clear: the link is ended under the own-relay id, and made again under the account id',
      same(linkCalls(from), [
        ['relayGoing', ownId, 'wss://other-relay.example.com'],
        ['relayChanged', ACCOUNT_DEVICE, 'wss://accounts.example.com'],
      ]),
      linkCalls(from)
    );
    const names = w.calls.slice(from).map(c => c[0]);
    check(
      'clear: ended first, then the account is told, then the state is read',
      names.indexOf('relayGoing') < names.indexOf('relayChanged') &&
        names.indexOf('relayChanged') < names.indexOf('accountChanged') &&
        names.indexOf('accountChanged') < names.indexOf('state'),
      names
    );

    // a question, or an address that is refused, does not cost the connection
    const asking = world();
    asking.account.user = USER;
    asking.stored.account = 'user-1';
    asking.stored.pairings = 2;
    asking.wiring.set(RELAY, SECRET, false);
    asking.wiring.set('ftp://nowhere', SECRET, true);
    asking.wiring.set(RELAY, 'short', true);
    check(
      'a question before removing pairings, a bad address and a bad secret leave the link alone',
      asking.calls.every(c => c[0] !== 'relayGoing' && c[0] !== 'relayChanged'),
      asking.calls
    );
  }

  // ---- a relay that cannot be read this once: every answer stays the own relay's ----
  {
    const held = world();
    held.wiring.set(RELAY, SECRET, false);
    const ownId = held.ownRelay.deviceId();
    held.account.user = USER;
    const unreadable = createOwnRelay({
      backend: {
        ...held.backend,
        exists: () => true,
        read() {
          throw new Error('busy');
        },
      },
      idStore: { read: () => JSON.stringify({ id: ownId }), write() {} },
      fetch: async () => {
        held.calls.push(['fetch while unreadable']);
        return { ok: true, status: 200, text: async () => '{}' };
      },
    });
    const during = createOwnRelayWiring({
      ownRelay: unreadable,
      userAuth: {
        thisDevice: () => ({ id: ACCOUNT_DEVICE }),
        apiBase: () => 'https://accounts.example.com',
        publicState: () => ({ user: held.account.user }),
        async accountCall(...args) {
          held.calls.push(['accountCall', ...args]);
          return { ok: true, status: 200, body: { ticket: 'ticket-from-account', devices: [] } };
        },
      },
      remote: () => held.remote,
    });
    check(
      'unreadable: this computer keeps its own-relay id (it does not flip to the account id)',
      during.selfId() === ownId && ownId !== ACCOUNT_DEVICE,
      during.selfId()
    );
    check('unreadable: device ids stay free to take', during.freeIds() === true);
    check(
      "unreadable: the address is not the accounts server's",
      during.url() === '',
      during.url()
    );
    const from = held.calls.length;
    const ticket = await outcome(during.getTicket());
    check(
      'unreadable: a ticket is asked of nobody, and the link is told to try later (status 0)',
      same(ticket.threw, { status: 0, code: 'no_relay' }) && held.calls.length === from,
      [ticket, held.calls.slice(from)]
    );
    check(
      'unreadable: the device list is empty, and the account is not asked for its list',
      same(await during.devices(), []) && held.calls.length === from,
      held.calls.slice(from)
    );
  }

  // ---- a saved relay whose secret today's rule no longer takes ----
  // It must stay "this computer is on its own relay": answered as "no relay", a signed-in account
  // would be told to the service, which removes the relay's pairings as another account's.
  {
    const w = world();
    w.wiring.set(RELAY, SECRET, false);
    w.stored.pairings = 2;
    w.account.user = USER;
    const ownId = w.ownRelay.deviceId();

    // the file as an earlier build wrote it, with a secret that has "abcdefg" in it
    const oldFile = fakeBackend();
    oldFile.text = oldFile
      .encrypt(
        Buffer.from(JSON.stringify({ url: RELAY, secret: 'Our-Home-Relay-2026-abcdefg-Secret!!' }))
      )
      .toString('base64');
    const old = createOwnRelay({
      backend: oldFile,
      idStore: { read: () => JSON.stringify({ id: ownId }), write() {} },
    });
    const after = createOwnRelayWiring({
      ownRelay: old,
      userAuth: {
        thisDevice: () => ({ id: ACCOUNT_DEVICE }),
        apiBase: () => 'https://accounts.example.com',
        publicState: () => ({ user: w.account.user }),
        async accountCall(...args) {
          w.calls.push(['accountCall', ...args]);
          return { ok: true, status: 200, body: { ticket: 'ticket-from-account' } };
        },
      },
      remote: () => w.remote,
    });
    check(
      'old secret: the page is told why, and the address that was saved',
      after.get().problem === 'old_secret' &&
        after.get().set === false &&
        after.get().url === RELAY,
      after.get()
    );
    check(
      'old secret: the account told stays the own relay, and the id stays the own-relay id',
      same(after.who(USER), [true, 'own-relay']) && after.selfId() === ownId,
      [after.who(USER), after.selfId()]
    );
    w.remote.accountChanged(...after.who(USER));
    check(
      'old secret: an account push removes no pairing',
      w.stored.pairings === 2 && w.stored.wipes === 0,
      w.stored
    );
    const from = w.calls.length;
    const ticket = await outcome(after.getTicket());
    check(
      'old secret: no ticket is asked of the account in its place',
      same(ticket.threw, { status: 0, code: 'no_relay' }) && w.calls.length === from,
      [ticket, w.calls.slice(from)]
    );
    const again = after.set(RELAY, SECRET, false);
    check(
      'old secret: setting the secret again asks nothing, keeps the pairings and makes it a relay',
      again.ok === true && again.set === true && again.problem === '' && w.stored.pairings === 2,
      [again, w.stored]
    );
  }

  // ---- a saved relay whose ADDRESS is no longer taken: held like the old secret, never "none"
  // ----
  {
    const w = world();
    w.wiring.set(RELAY, SECRET, false);
    w.stored.pairings = 2;
    w.account.user = USER;
    const ownId = w.ownRelay.deviceId();
    const account = {
      thisDevice: () => ({ id: ACCOUNT_DEVICE }),
      apiBase: () => 'https://accounts.example.com',
      publicState: () => ({ user: w.account.user }),
      async accountCall(...args) {
        w.calls.push(['accountCall', ...args]);
        return { ok: true, status: 200, body: { ticket: 'ticket-from-account' } };
      },
    };

    // the file as it would be read: an address with a path, a plain http one, a home network's
    const savedWith = (url, secret) => {
      const file = fakeBackend();
      file.text = file.encrypt(Buffer.from(JSON.stringify({ url, secret }))).toString('base64');
      const relay = createOwnRelay({
        backend: file,
        idStore: { read: () => JSON.stringify({ id: ownId }), write() {} },
      });
      return {
        relay,
        wiring: createOwnRelayWiring({
          ownRelay: relay,
          userAuth: account,
          remote: () => w.remote,
        }),
      };
    };
    const OLD_ADDRESSES = [RELAY + '/hub', 'http://relay.example.com', 'https://192.168.1.1'];
    check(
      'old address: not active, but held, the page is told why and is shown no address',
      OLD_ADDRESSES.every(address => {
        const { relay } = savedWith(address, SECRET);
        return (
          relay.active() === false &&
          relay.held() === true &&
          same(relay.get(), {
            available: true,
            problem: 'old_address',
            idProblem: '',
            set: false,
            url: '',
          })
        );
      }),
      OLD_ADDRESSES.map(address => savedWith(address, SECRET).relay.get())
    );
    const { relay, wiring } = savedWith(RELAY + '/hub', SECRET);
    check(
      'old address: the account told stays the own relay, and the id stays the own-relay id',
      same(wiring.who(USER), [true, 'own-relay']) && wiring.selfId() === ownId,
      [wiring.who(USER), wiring.selfId()]
    );
    w.remote.accountChanged(...wiring.who(USER));
    check(
      'old address: an account push removes no pairing',
      w.stored.pairings === 2 && w.stored.wipes === 0,
      w.stored
    );
    const from = w.calls.length;
    const ticket = await outcome(wiring.getTicket());
    check(
      'old address: nothing is sent to it, and no ticket is asked of the account in its place',
      same(ticket.threw, { status: 0, code: 'no_relay' }) &&
        w.calls.length === from &&
        relay.wsUrl() === '',
      [ticket, w.calls.slice(from)]
    );
    const again = wiring.set(RELAY, SECRET, false);
    check(
      'old address: setting the relay again asks nothing, keeps the pairings and makes it a relay',
      again.ok === true && again.set === true && again.problem === '' && w.stored.pairings === 2,
      [again, w.stored]
    );
    check(
      'an address and a secret that are both no longer taken: held, named by the address',
      savedWith(RELAY + '/hub', 'Our-Home-Relay-2026-abcdefg-Secret!!').relay.get().problem ===
        'old_address'
    );
    check(
      'the old secret is still its own reason, with the address shown',
      same(savedWith(RELAY, 'Our-Home-Relay-2026-abcdefg-Secret!!').relay.get(), {
        available: true,
        problem: 'old_secret',
        idProblem: '',
        set: false,
        url: RELAY,
      })
    );
    check(
      'a file that never held a relay (no address, or a secret too short to have been one) is none',
      [
        ['', SECRET],
        [RELAY + '/hub', 'short'],
        [RELAY, 'short'],
        [42, SECRET],
      ].every(([url, secret]) => {
        const none = savedWith(url, secret).relay;
        return !none.active() && !none.held() && none.get().problem === '';
      })
    );
    check(
      'a good saved pair is a relay with no problem',
      (() => {
        const good = savedWith(RELAY, SECRET).relay;
        return good.active() && !good.held() && good.get().problem === '';
      })()
    );

    // the Devices page has a sentence for both reasons, in the row "none set" uses
    const page = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'scripts', '111-devices-page.js'),
      'utf8'
    );
    const block = (/const OLD_RELAY = \{([\s\S]*?)\};/.exec(page) || [])[1] || '';
    check(
      'page: old_address has its sentence, and old_secret kept its own',
      /old_address:\s*'The address saved for your relay is no longer accepted\. Set your relay again; your pairings stay\.'/.test(
        block
      ) &&
        /old_secret:\s*'The secret saved for your relay is no longer accepted\. Set the secret again\.'/.test(
          block
        ),
      block
    );
    check(
      'page: the row is drawn for either reason, from own.problem',
      /Object\.hasOwn\(OLD_RELAY, own\.problem\)/.test(page) &&
        /el\('span', '', OLD_RELAY\[own\.problem\]\)/.test(page)
    );
  }

  // ---- the plan lock and an own relay ----
  // The lock is off in the public app (package.json tnaiEnforcePlan false), so none of this is
  // met there. In a build where it is on, this holds:
  // reading which relay is set and removing it always work (ending a
  // connection never needs a plan), setting one is refused with the rest of the app, and an own
  // relay asks no plan for a ticket. These checks keep those three as they are.
  {
    const fs = require('fs');
    const path = require('path');
    const mainText = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.js'), 'utf8');
    const lockFreeList = (/const LOCK_FREE = new Set\(\[([\s\S]*?)\]\)/.exec(mainText) || [])[1];
    const lockFree = channel => new RegExp("'" + channel + "'").test(lockFreeList || '');
    check(
      'lock: reading the relay and removing it work behind the lock',
      lockFree('remote:ownRelay') && lockFree('remote:clearOwnRelay')
    );
    check('lock: setting a relay does not', !!lockFreeList && !lockFree('remote:setOwnRelay'));
    check(
      'lock: the public app does not enforce a plan',
      require('../package.json').tnaiEnforcePlan === false
    );
    const w = world();
    w.wiring.set(RELAY, SECRET, false);
    w.calls.length = 0;
    w.account.reply = () => null;
    const ticket = await w.wiring.getTicket();
    check(
      'lock: an own relay gives its ticket whatever the account says, and the account is not asked',
      ticket === 'ticket-from-own-relay' && w.calls.every(c => c[0] !== 'accountCall'),
      w.calls
    );
  }

  // ---- a save or removal that fails: the link is made again as it was, the account not told ----
  {
    const w = world();
    w.backend.failWrite = true;
    check(
      'failed save: not_saved; the link was ended and is made again, the account is not told',
      same(w.wiring.set(RELAY, SECRET, true), { ok: false, error: 'not_saved' }) &&
        same(
          w.calls.map(c => c[0]),
          ['relayGoing', 'relayChanged']
        ) &&
        w.calls[1][1] === ACCOUNT_DEVICE,
      w.calls
    );
    w.calls.length = 0;
    check(
      'failed removal: not_saved; the same, and the account is not told',
      same(w.wiring.clear(true), { ok: false, error: 'not_saved' }) &&
        same(
          w.calls.filter(c => c[0] !== 'wouldRemove').map(c => c[0]),
          ['relayGoing', 'relayChanged']
        ),
      w.calls
    );
    w.backend.usable = false;
    check(
      'no secure storage: unavailable, with and without the confirm flag',
      same(w.wiring.set(RELAY, SECRET, false), { ok: false, error: 'unavailable' }) &&
        same(w.wiring.set(RELAY, SECRET, true), { ok: false, error: 'unavailable' })
    );
  }

  // ---- the id file cannot be written: the save still works, and its answer says so ----
  {
    const w = world();
    const noDisk = createOwnRelay({
      backend: fakeBackend(),
      idStore: {
        read: () => null,
        write() {
          throw new Error('read-only folder');
        },
      },
    });
    const wiring = createOwnRelayWiring({
      ownRelay: noDisk,
      userAuth: {
        thisDevice: () => ({ id: ACCOUNT_DEVICE }),
        apiBase: () => 'https://accounts.example.com',
        publicState: () => ({ user: null }),
      },
      remote: () => w.remote,
    });
    const saved = wiring.set(RELAY, SECRET, false);
    check(
      'id not saved: the relay is saved and the answer for the page carries the reason',
      saved.ok === true && saved.set === true && saved.idProblem === 'id_not_saved',
      saved
    );
    const id = wiring.selfId();
    check(
      'id not saved: this run keeps one id, an own-relay id, and the address is the relay',
      id !== ACCOUNT_DEVICE &&
        wiring.selfId() === id &&
        noDisk.deviceId() === id &&
        wiring.url() === 'wss://relay.example.com' &&
        same(wiring.who(null), [true, 'own-relay']),
      [id, wiring.url(), wiring.who(null)]
    );
    check(
      'id not saved: reading the relay for the page says it too',
      same(wiring.get(), {
        available: true,
        problem: '',
        idProblem: 'id_not_saved',
        set: true,
        url: RELAY,
      })
    );
    const healthy = world();
    check(
      'id saved: the answer for the page has no reason',
      healthy.wiring.set(RELAY, SECRET, false).idProblem === '' &&
        healthy.wiring.get().idProblem === ''
    );
  }

  // ---- own-relay.js check(): the same answers as set(), nothing stored, nothing handed back ----
  {
    const w = world();
    check(
      'check: good values pass, with only { ok: true } returned and nothing written',
      same(w.ownRelay.check(RELAY, SECRET), { ok: true }) &&
        w.backend.writes === 0 &&
        w.ownRelay.active() === false
    );
    check(
      "check: a bad address and a bad secret give set()'s errors",
      same(w.ownRelay.check('http://example.com', SECRET), { ok: false, error: 'bad_url' }) &&
        same(w.ownRelay.check(RELAY, 'a'.repeat(40)), { ok: false, error: 'bad_secret' })
    );
  }

  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});
