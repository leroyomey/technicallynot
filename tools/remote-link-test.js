// Test of desktop/remote-link.js: node tools/remote-link-test.js (plain Node; also run it in
// Electron's Node). Two or three links talk through a stand-in relay in this process, on a clock
// the test moves by hand, so backoff, lost and replayed messages and a relay in the middle are all
// tried in under a second. The real relay is tried by its own tests (two
// processes through `wrangler dev`).
const crypto = require('crypto');
const noise = require('../desktop/remote-noise.js');
const keys = require('../desktop/remote-keys.js');
const { createLink } = require('../desktop/remote-link.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// ---- a clock and timers the test moves by hand ----
function world() {
  const w = {
    t: 1700000000000,
    timers: [],
    queue: [],
    socks: [],
    log: [],
    tickets: [],
    hooks: {},
    refuse: null,
  };
  w.now = () => w.t;
  w.timersApi = {
    set: (fn, ms) => {
      const h = { at: w.t + ms, fn };
      w.timers.push(h);
      return h;
    },
    clear: h => {
      const i = w.timers.indexOf(h);
      if (i >= 0) w.timers.splice(i, 1);
    },
  };
  w.settle = async () => {
    for (let i = 0; i < 200; i++) {
      for (let j = 0; j < 10; j++) await Promise.resolve();
      const next = w.queue.shift();
      if (!next) return;
      next();
    }
    throw new Error('never settles');
  };
  w.advance = async ms => {
    const end = w.t + ms;
    await w.settle();
    for (;;) {
      const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      w.timersApi.clear(due);
      w.t = Math.max(w.t, due.at);
      due.fn();
      await w.settle();
    }
    w.t = end;
  };

  // The relay: hello, presence, routing by device, "offline"; hooks let a test drop, change or add
  // envelopes.
  const say = (sock, obj) =>
    w.queue.push(() => sock.open && sock.onmessage?.({ data: JSON.stringify({ v: 1, ...obj }) }));
  w.inject = (to, text) => {
    const s = w.socks.find(x => x.open && x.device === to);
    if (s) w.queue.push(() => s.open && s.onmessage?.({ data: text }));
  };
  w.close = (device, code) => {
    for (const s of w.socks.filter(x => x.open && x.device === device)) s.end(code);
  };
  w.WebSocket = class {
    constructor(url) {
      this.device = decodeURIComponent(url.split('ticket=')[1]).split(':')[0];
      this.readyState = 0;
      this.open = false;
      w.socks.push(this);
      w.queue.push(() => {
        if (w.hooks.mute) return; // a socket that never opens and never says hello
        if (w.refuse) {
          this.readyState = 3;
          return this.onclose?.({ code: 1006, reason: '' });
        }
        this.open = true;
        this.readyState = 1;
        const others = w.socks.filter(s => s.open && s !== this);
        const online = [...new Set(others.map(s => s.device))];
        say(this, {
          kind: 'hello',
          device: this.device,
          // hooks.hello: a relay that says something else is online than what is
          online: w.hooks.hello ? w.hooks.hello(online) : online,
        });
        for (const o of others) say(o, { kind: 'presence', device: this.device, online: true });
      });
    }
    send(text) {
      if (!this.open) throw new Error('closed');
      if (text === 'ping') {
        const pong = () => this.open && this.onmessage?.({ data: 'pong' });
        if (w.hooks.latePong)
          w.hooks.latePong.push(pong); /* the test hands each answer over later */
        else if (!w.hooks.noPong) w.queue.push(pong);
        return;
      }
      const m = JSON.parse(text);
      w.log.push(m);
      const out = w.hooks.forward ? w.hooks.forward(m) : m;
      if (!out) return;
      const target = w.socks.find(s => s.open && s.device === m.to);
      if (!target) return say(this, { kind: 'err', code: 'offline', to: m.to });
      w.queue.push(() => target.open && target.onmessage?.({ data: JSON.stringify(out) }));
    }
    end(code) {
      if (!this.open) return;
      this.open = false;
      this.readyState = 3;
      for (const o of w.socks.filter(s => s.open))
        say(o, { kind: 'presence', device: this.device, online: false });
      w.queue.push(() => this.onclose?.({ code, reason: '' }));
    }
    close() {
      if (this.open) {
        this.open = false;
        this.readyState = 3;
        for (const o of w.socks.filter(s => s.open))
          say(o, { kind: 'presence', device: this.device, online: false });
      }
    }
  };
  w.computer = (id, name) => {
    const disk = { text: null };
    const backend = {
      available: () => true,
      encrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
      decrypt: b => Buffer.from(b.map(x => x ^ 0x5a)),
      read: () => disk.text,
      write: s => {
        disk.text = s;
      },
    };
    const c = {
      id,
      store: keys.keyStore(backend),
      got: [],
      events: [],
      pairing: null,
      paired: [],
      sessions: 0,
      states: [],
    };
    c.link = createLink({
      self: { id },
      store: c.store,
      url: 'ws://relay',
      name: () => name,
      WebSocket: w.WebSocket,
      now: w.now,
      timers: w.timersApi,
      random: () => 0.5,
      getTicket: async () => {
        w.tickets.push({ id, at: w.t });
        if (c.ticketHang) return new Promise(() => {});
        if (c.ticketLater)
          return new Promise(resolve => {
            c.ticketNow = () => resolve(id + ':late');
          });

        /* a ticket that arrives when the test says so */ if (c.ticketError) throw c.ticketError;
        return id + ':' + w.tickets.length;
      },
      on: {
        message: (from, obj) => c.got.push({ from, obj }),
        pairing: p => {
          c.pairing = p;
        },
        paired: (pid, n) => c.paired.push({ id: pid, name: n }),
        session: () => {
          c.sessions++;
        },
        state: s => c.states.push(s.connection + (s.reason ? ':' + s.reason : '')),
        update: from => c.events.push('update:' + from),
      },
    });
    return c;
  };
  w.count = id => w.socks.filter(s => s.open && s.device === id).length;
  return w;
}

async function pairUp(w, a, b) {
  b.link.pairAny();
  a.link.pair(b.id);
  await w.settle();
  const r1 = b.link.enterCode(a.pairing.shows);
  await w.settle();
  const r2 = a.link.enterCode(b.pairing.shows);
  await w.advance(3000);
  return [r1, r2];
}

(async () => {
  // ---- nothing paired: no connection at all ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop');
    await a.link.start();
    await w.advance(60000);
    check(
      'nothing paired and no pairing: no ticket asked, no socket opened',
      w.tickets.length === 0 && w.socks.length === 0 && a.link.state().connection === 'off'
    );
  }

  // ---- pairing through the relay, both ways round (the starter of the handshake is the lower id,
  // whoever pressed Pair) ----
  for (const [ia, ib] of [
    ['dev-1', 'dev-2'],
    ['dev-2', 'dev-1'],
  ]) {
    const w = world(),
      a = w.computer(ia, 'Desktop'),
      b = w.computer(ib, 'Laptop'),
      tag = `(${ia} pairs ${ib}) `;
    b.link.pairAny();
    await w.settle();
    check(
      tag + 'pairing mode opens the connection',
      w.count(ib) === 1 && b.pairing.state === 'idle' && b.pairing.shows === null
    );
    a.link.pair(ib);
    await w.settle();
    check(
      tag + 'A shows six digits, B asks for them',
      /^\d{6}$/.test(a.pairing.shows) &&
        a.pairing.state === 'show' &&
        b.pairing.state === 'enter' &&
        b.pairing.shows === null
    );
    check(
      tag + 'nothing is stored before the codes are typed',
      a.store.pairings().length === 0 && b.store.pairings().length === 0
    );
    b.link.enterCode(a.pairing.shows);
    await w.advance(1500);
    check(
      tag + 'B shows its second code; still nothing stored on either side',
      /^\d{6}$/.test(b.pairing.shows) &&
        a.store.pairings().length === 0 &&
        b.store.pairings().length === 0
    );
    a.link.enterCode(b.pairing.shows);
    await w.advance(3000);
    const pa = a.store.pairing(ib),
      pb = b.store.pairing(ia);
    check(
      tag + 'both stored the pairing after the first session, with the name from inside it',
      !!pa &&
        !!pb &&
        pa.pairingId.equals(pb.pairingId) &&
        pa.name === 'Laptop' &&
        pb.name === 'Desktop' &&
        a.paired.length === 1 &&
        b.paired.length === 1,
      [a.paired, b.paired]
    );
    check(
      tag + 'pairing mode is over on both',
      a.pairing.state === 'idle' && b.pairing.state === 'idle'
    );

    // a sealed list each way
    const list = {
      t: 'needs',
      items: [
        { id: 'x1', kind: 'permission', agent: 'Moss', detail: 'Bash: npm run secret-thing' },
      ],
    };
    check(
      tag + 'send works over the live session',
      a.link.send(ib, list) === true && b.link.send(ia, { t: 'needs', items: [] }) === true
    );
    await w.settle();
    check(
      tag + 'the list arrives on the other computer',
      JSON.stringify(b.got.at(-1)) === JSON.stringify({ from: ia, obj: list }) &&
        a.got.at(-1).obj.items.length === 0
    );
    const wire = JSON.stringify(w.log);
    check(
      tag + 'the relay saw no name, no detail and no key',
      !/Desktop|Laptop|secret-thing|Moss|needs/.test(wire) &&
        !wire.includes(a.store.identity().priv.toString('base64'))
    );
    const sizes = new Set(
      w.log.filter(m => m.kind === 'msg').map(m => Buffer.from(m.body, 'base64').length)
    );
    check(
      tag + 'every sealed message is one of the size steps',
      [...sizes].every(n => [272, 1040, 4112].includes(n)),
      [...sizes]
    );
    check(
      tag + 'a list too long for one envelope is refused, not sent larger',
      (() => {
        try {
          a.link.send(ib, { t: 'x', pad: 'y'.repeat(5000) });
          return false;
        } catch {
          return true;
        }
      })()
    );

    // garbage, a replay and a lost message
    const before = b.got.length,
      last = w.log.filter(m => m.kind === 'msg' && m.to === ib).at(-1);
    w.inject(
      ib,
      JSON.stringify({ ...last, n: last.n + 1, body: crypto.randomBytes(272).toString('base64') })
    );
    w.inject(ib, JSON.stringify(last)); // the same envelope again
    w.inject(ib, JSON.stringify({ ...last, n: 'x' }));
    w.inject(ib, 'not json');
    w.inject(
      ib,
      JSON.stringify({
        v: 1,
        to: ib,
        from: ia,
        kind: 'hs',
        body: crypto.randomBytes(81).toString('base64'),
      })
    );
    await w.settle();
    check(
      tag + 'garbage and a replayed envelope deliver nothing and break nothing',
      b.got.length === before && b.link.state().sessions.includes(ia)
    );
    a.link.send(ib, { t: 'one' });
    await w.settle();
    check(tag + 'the session still works after them', b.got.at(-1).obj.t === 'one');
    const sessionsB = b.sessions,
      sessionsA = a.sessions;
    w.hooks.forward = m =>
      m.kind === 'msg' && m.to === ib && !w.hooks.dropped ? ((w.hooks.dropped = true), null) : m;
    a.link.send(ib, { t: 'lost' });
    a.link.send(ib, { t: 'after the gap' });
    await w.settle();
    check(
      tag + 'a skipped counter delivers nothing and ends the session on the receiver',
      !b.got.some(g => g.obj.t === 'after the gap') && !b.got.some(g => g.obj.t === 'lost')
    );
    await w.advance(20000);
    check(
      tag + 'both handshake again and are told to send their full list',
      b.link.state().sessions.includes(ia) &&
        a.link.state().sessions.includes(ib) &&
        b.sessions > sessionsB &&
        a.sessions > sessionsA,
      [a.sessions, b.sessions]
    );
    a.link.send(ib, { t: 'fresh' });
    await w.settle();
    check(tag + 'the new session carries messages', b.got.at(-1).obj.t === 'fresh');
    w.hooks.forward = null;

    // a dropped connection: back with backoff and jitter, a new session per connection
    const tix = w.tickets.filter(t => t.id === ia).length,
      t0 = w.t;
    w.close(ia, 1006);
    await w.settle();
    check(
      tag + 'a dropped connection: the other side is told and its session ends',
      !b.link.state().sessions.includes(ia) &&
        a.link.state().connection === 'waiting' &&
        b.link.send(ia, { t: 'x' }) === false
    );
    await w.advance(30000);
    check(
      tag + 'it reconnects by itself and the session is back',
      a.link.state().connection === 'online' &&
        a.link.state().sessions.includes(ib) &&
        w.tickets.filter(t => t.id === ia).length === tix + 1
    );
    check(
      tag + 'the first retry waits 0.5 to 1 second',
      (() => {
        const at = w.tickets.filter(t => t.id === ia).at(-1).at - t0;
        return at >= 500 && at <= 1000;
      })()
    );

    // what the relay or the other computer may not do (security review, 2026-10-04)
    const hostile = [
      { v: 1, kind: 'presence', device: '__proto__', online: true },
      { v: 1, kind: 'presence', device: 'constructor', online: false },
      { v: 1, kind: 'err', code: 'offline', to: '__proto__' },
      { v: 1, to: ia, from: '__proto__', kind: 'hs', body: 'AQ==' },
      { v: 1, to: ia, from: 'constructor', kind: 'msg', n: 0, body: 'AA==' },
    ];
    for (const h of hostile) w.inject(ia, JSON.stringify(h));
    const timersBefore = w.timers.length;
    for (let k = 0; k < 20; k++)
      w.inject(ia, JSON.stringify({ v: 1, kind: 'hello', device: ia, online: [ib] }));
    await w.settle();
    check(
      tag +
        'built-in property names as device ids and repeated hellos: nothing throws, no timer is added',
      a.link.state().connection === 'online' && w.timers.length === timersBefore,
      [w.timers.length, timersBefore]
    );
    {
      // The relay may be anybody's (an own relay): what it says is online
      // is kept only for ids of the right shape, and only so many.
      const before = a.link.state().online.length;
      for (let k = 0; k < 80; k++)
        w.inject(
          ia,
          JSON.stringify({ v: 1, kind: 'presence', device: 'flood-' + k, online: true })
        );
      for (const bad of ['', 'x'.repeat(5000), 'has space', 42, null, { id: 1 }])
        w.inject(ia, JSON.stringify({ v: 1, kind: 'presence', device: bad, online: true }));
      await w.settle();
      const now = a.link.state().online;
      check(
        tag + 'a relay cannot grow the online list without end or put odd ids in it',
        now.length <= 64 &&
          now.length >= before &&
          now.every(id => /^[A-Za-z0-9_-]{1,64}$/.test(id)),
        [before, now.length]
      );
      for (let k = 0; k < 80; k++)
        w.inject(
          ia,
          JSON.stringify({ v: 1, kind: 'presence', device: 'flood-' + k, online: false })
        );
      await w.settle();
    }
    const named = a.store.pairing(ib).name;
    b.link.send(ia, { t: 'hi', name: 'Somebody else' });
    await w.settle();
    check(
      tag + 'a later "hi" cannot rename the computer',
      a.store.pairing(ib).name === named && named === 'Laptop'
    );
    const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
    for (let k = 0; k < 11; k++)
      w.inject(
        hi,
        JSON.stringify({
          v: 1,
          to: hi,
          from: lo,
          kind: 'hs',
          body: Buffer.concat([Buffer.from([1]), crypto.randomBytes(48)]).toString('base64'),
        })
      );
    await w.settle();
    w.close(lo, 1006);
    await w.advance(30000);
    check(
      tag + 'garbage handshake messages do not stop the real one from being answered',
      a.link.state().sessions.includes(ib) && b.link.state().sessions.includes(ia)
    );

    // forget
    check(
      tag + 'forget deletes the key and, with nothing paired, closes the connection',
      a.link.forget(ib) === true &&
        a.store.pairings().length === 0 &&
        w.count(ia) === 0 &&
        a.link.state().connection === 'off'
    );
    await w.advance(60000);
    check(
      tag + 'a forgotten computer gets no session, and nothing reconnects',
      !b.link.state().sessions.includes(ia) &&
        w.count(ia) === 0 &&
        b.link.send(ia, { t: 'x' }) === false
    );
  }

  // ---- pairing mode left and entered again before the connection is up; a name with hidden
  // characters ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desk' + String.fromCharCode(0x202e, 0x200b, 7) + 'top'),
      b = w.computer('dev-2', 'Laptop');
    a.link.pair('dev-2');
    a.link.cancelPairing();
    a.link.pairAny();
    let threw = false;
    try {
      await w.settle();
    } catch {
      threw = true;
    }
    check(
      'Pair, cancel, then "Pair a computer" before the connection is up: nothing throws, and it waits as B',
      !threw && a.pairing.role === 'b' && a.pairing.state !== 'ended',
      a.pairing
    );
    b.link.pair('dev-1');
    await w.settle();
    a.link.enterCode(b.pairing.shows);
    await w.settle();
    b.link.enterCode(a.pairing.shows);
    await w.advance(3000);
    const stored = b.store.pairing('dev-1')?.name || '';
    check(
      'a name arrives without control, zero-width or direction characters',
      stored.length > 0 && /^Desk ?top$/.test(stored),
      stored
    );
  }

  // ---- backoff never loops tightly; some refusals stop for good ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    w.refuse = true;
    w.close('dev-1', 1006);
    const from = w.tickets.filter(t => t.id === 'dev-1').length,
      t0 = w.t;
    await w.advance(60 * 60 * 1000);
    const tries = w.tickets
        .filter(t => t.id === 'dev-1')
        .slice(from)
        .map(t => t.at - t0),
      gaps = tries.map((t, i) => t - (tries[i - 1] || 0));
    check(
      'an unreachable relay: waits grow to a cap of five minutes (jitter 0.75 here)',
      gaps[0] === 750 &&
        gaps[1] === 1500 &&
        gaps[2] === 3000 &&
        Math.max(...gaps) === 225000 &&
        tries.length < 30,
      gaps.slice(0, 12)
    );
    w.refuse = false;
    await w.advance(6 * 60 * 1000);
    check(
      '…and it comes back when the relay does',
      a.link.state().connection === 'online' && a.link.state().sessions.includes('dev-2')
    );
    const n = w.tickets.length;
    w.close('dev-1', 4003);
    await w.advance(60 * 60 * 1000);
    check(
      'signed out by the relay (4003): stopped, no retry',
      a.link.state().connection === 'stopped' &&
        a.link.state().reason === 'signed_out' &&
        w.tickets.length === n
    );
    await a.link.resume();
    await w.advance(3000);
    check(
      'resume connects again',
      a.link.state().connection === 'online' && a.link.state().sessions.includes('dev-2')
    );
    w.close('dev-1', 4001);
    await w.advance(60 * 60 * 1000);
    check(
      'replaced by a newer socket (4001): stopped, so two copies do not push each other out forever',
      a.link.state().connection === 'stopped' && a.link.state().reason === 'replaced'
    );
    b.ticketError = { status: 403, code: 'plan_required' };
    w.close('dev-2', 1006);
    const nb = w.tickets.length;
    await w.advance(60 * 60 * 1000);
    check(
      'no plan (403 on the ticket): stopped after one try',
      b.link.state().connection === 'stopped' &&
        b.link.state().reason === 'plan_required' &&
        w.tickets.length === nb + 1
    );
    b.ticketError = { status: 503, code: 'remote_disabled' };
    await b.link.resume();
    const n5 = w.tickets.length;
    await w.advance(2 * 60 * 60 * 1000);
    check(
      'remote switched off (503): looked at again only every 15 to 30 minutes',
      b.link.state().connection === 'waiting' && [4, 5, 6, 7, 8].includes(w.tickets.length - n5),
      w.tickets.length - n5
    );
  }

  // ---- after sleep or a network change: the link looks at once, and never in a tight loop
  // (item 18) ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    const asked = () => w.tickets.filter(t => t.id === 'dev-1'),
      since = n =>
        asked()
          .slice(n)
          .map(t => t.at);

    // the relay cannot be reached for twenty minutes (the computer slept, the network was gone):
    // the wait has grown to its cap
    w.refuse = true;
    w.close('dev-1', 1006);
    await w.advance(20 * 60 * 1000);
    check(
      '(setup) unreachable for twenty minutes: waiting, the next look minutes away',
      a.link.state().connection === 'waiting'
    );
    w.refuse = false;
    let n = asked().length;
    const t0 = w.t;
    const did = a.link.wake();
    await w.advance(3500);
    check(
      'wake: the link looks within three seconds instead of at the end of its wait, and is back',
      did === true &&
        a.link.state().connection === 'online' &&
        asked().length === n + 1 &&
        since(n)[0] - t0 >= 1000 &&
        since(n)[0] - t0 <= 3000,
      [did, a.link.state().connection, since(n).map(t => t - t0)]
    );
    await w.advance(5000);
    check('…with its session', a.link.state().sessions.includes('dev-2'));

    // a wake every second for a minute while nothing can be reached: tries go on, and never close
    // together
    await w.advance(60000);
    w.refuse = true;
    w.close('dev-1', 1006);
    await w.advance(10 * 60 * 1000);
    n = asked().length;
    const many = [];
    for (let i = 0; i < 60; i++) {
      many.push(a.link.wake());
      await w.advance(1000);
    }
    const times = since(n),
      gaps = times.map((t, i) => t - (times[i - 1] || times[0] - 9999)).slice(1);
    check(
      'wake: called every second for a minute with the relay unreachable: at most one look is started in ten seconds, tries go on, and no two are closer than a second',
      many.filter(Boolean).length >= 5 &&
        many.filter(Boolean).length <= 7 &&
        times.length >= 5 &&
        times.length <= 24 &&
        gaps.every(g => g >= 1000),
      [many.filter(Boolean).length, times.length, Math.min(...gaps)]
    );
    const burst = [];
    await w.advance(11000);
    for (let i = 0; i < 50; i++) burst.push(a.link.wake());
    check(
      'wake: fifty calls in one moment start one look',
      burst.filter(Boolean).length === 1 && burst[0] === true
    );

    // an open socket is tested at once: a dead one is noticed in ten seconds, not at the next
    // ordinary ping
    w.refuse = false;
    await w.advance(6 * 60 * 1000);
    check('(setup) back online', a.link.state().connection === 'online');
    await w.advance(11000);
    n = asked().length;
    const alive = a.link.wake();
    await w.advance(11000);
    check(
      'wake with a live socket: it is asked and answers; nothing is closed, no new connection',
      alive === true && a.link.state().connection === 'online' && asked().length === n
    );
    w.hooks.noPong = true;
    await w.advance(1000);
    const dead = a.link.wake();
    await w.advance(12000);
    check(
      'wake with a dead socket (no answer in ten seconds): hung up and connecting again, well before the next ordinary ping',
      dead === true && asked().length > n,
      [dead, asked().length - n]
    );
    w.hooks.noPong = false;
    await w.advance(60000);

    // waits the server asked for, and a link that is stopped, are left alone
    b.ticketError = { status: 503, code: 'remote_disabled' };
    w.close('dev-2', 1006);
    await w.advance(5000);
    const nb = w.tickets.filter(t => t.id === 'dev-2').length,
      held = b.link.wake();
    await w.advance(60000);
    check(
      'wake while the server says remote is switched off: nothing, the slow wait stays',
      held === false &&
        b.link.state().connection === 'waiting' &&
        w.tickets.filter(t => t.id === 'dev-2').length === nb,
      [held, w.tickets.filter(t => t.id === 'dev-2').length - nb]
    );
    w.close('dev-1', 4003);
    await w.advance(1000);
    n = asked().length;
    check(
      'wake on a link the relay signed out: nothing',
      a.link.wake() === false &&
        (await w.advance(60000), a.link.state().connection === 'stopped' && asked().length === n)
    );
    a.link.stop();
    check(
      'wake on a stopped link: nothing',
      a.link.wake() === false && a.link.state().connection === 'off'
    );
  }

  // ---- the computer is about to sleep: sleep() closes from this side and waits ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    const asked = () => w.tickets.filter(t => t.id === 'dev-1'),
      since = n =>
        asked()
          .slice(n)
          .map(t => t.at);
    check(
      '(setup) online with a session',
      a.link.state().connection === 'online' && a.link.state().sessions.includes('dev-2')
    );

    // on an online link: closed from this side, the other computer sees it at once, and nothing is
    // asked for 30 seconds
    let n = asked().length,
      t0 = w.t;
    const did = a.link.sleep();
    await w.advance(50);
    check(
      'sleep on an online link: the socket is closed from this side, the paired computer shows this one offline at once, and the link waits with the reason "asleep"',
      did === true &&
        w.count('dev-1') === 0 &&
        a.link.state().connection === 'waiting' &&
        a.states.at(-1) === 'waiting:asleep' &&
        !b.link.state().online.includes('dev-1') &&
        !b.link.state().sessions.includes('dev-1'),
      [did, a.states.at(-1), b.link.state()]
    );
    await w.advance(29900);
    check('sleep: no ticket is asked for 30 seconds', asked().length === n);
    await w.advance(5000);
    check(
      'sleep with no wake: exactly one look after 30 seconds, and the link is back with its session',
      asked().length === n + 1 &&
        since(n)[0] - t0 === 30000 &&
        a.link.state().connection === 'online' &&
        a.link.state().sessions.includes('dev-2'),
      [since(n).map(t => t - t0), a.link.state()]
    );

    // closing for a sleep is no failed try: when the look after the nap is refused, the backoff
    // starts at its first step
    await w.advance(40000);
    w.refuse = true;
    n = asked().length;
    t0 = w.t;
    a.link.sleep();
    await w.advance(33000);
    const gaps = since(n).map((t, i, all) => t - (i ? all[i - 1] : t0));
    check(
      'sleep with no wake and the relay unreachable: one look after 30 seconds, then the ordinary backoff from its first step (0.75 s, 1.5 s)',
      gaps[0] === 30000 && gaps[1] === 750 && gaps[2] === 1500,
      gaps
    );

    // the wake that follows a sleep is never the one too many, even ten seconds after another wake
    w.refuse = false;
    await w.advance(6 * 60 * 1000);
    check('(setup) back online', a.link.state().connection === 'online');
    await w.advance(11000);
    const first = a.link.wake();
    await w.advance(2000); // a wake on the live socket: asked and answered
    n = asked().length;
    t0 = w.t;
    const slept = a.link.sleep();
    await w.advance(1000);
    const woke = a.link.wake();
    await w.advance(3500);
    check(
      'sleep, then a wake three seconds after another wake: the wake acts, one look two seconds later, back online',
      first === true &&
        slept === true &&
        woke === true &&
        asked().length === n + 1 &&
        since(n)[0] - t0 === 3000 &&
        a.link.state().connection === 'online',
      [first, slept, woke, since(n).map(t => t - t0)]
    );

    // fifty calls close once and leave one wait
    await w.advance(40000);
    n = asked().length;
    t0 = w.t;
    const many = [];
    for (let i = 0; i < 50; i++) many.push(a.link.sleep());
    await w.advance(31000);
    check(
      'fifty sleeps in one moment: one close, one look 30 seconds later',
      many.filter(Boolean).length === 1 &&
        many[0] === true &&
        asked().length === n + 1 &&
        since(n)[0] - t0 === 30000,
      [many.filter(Boolean).length, since(n).map(t => t - t0)]
    );

    // while a connection try is under way: its ticket, arriving later, is not used
    await w.advance(40000);
    a.ticketLater = true;
    w.close('dev-1', 1006);
    await w.advance(2000);
    check(
      '(setup) connecting, its ticket not there yet',
      a.link.state().connection === 'connecting' && typeof a.ticketNow === 'function'
    );
    const socks0 = w.socks.length,
      mid = a.link.sleep();
    a.ticketLater = false;
    a.ticketNow();
    await w.advance(1000);
    check(
      'sleep while connecting: the try is given up, and the ticket that arrives afterwards makes no socket',
      mid === true &&
        w.socks.length === socks0 &&
        a.link.state().connection === 'waiting' &&
        a.states.at(-1) === 'waiting:asleep',
      [mid, w.socks.length - socks0, a.states.at(-1)]
    );
    await w.advance(31000);
    check('…and the link is back after its 30 seconds', a.link.state().connection === 'online');

    // a link that has nothing to close is left as it is
    w.refuse = true;
    w.close('dev-1', 1006);
    await w.advance(100);
    n = asked().length;
    t0 = w.t;
    const waiting = a.link.sleep();
    await w.advance(20000);
    check(
      'sleep on a link that is already waiting: nothing, its own wait is not replaced by the 30 seconds',
      waiting === false &&
        asked().length > n &&
        since(n)[0] - t0 < 20000 &&
        a.states.at(-1) !== 'waiting:asleep',
      [waiting, since(n).map(t => t - t0), a.states.at(-1)]
    );
    w.refuse = false;
    await w.advance(6 * 60 * 1000);
    b.ticketError = { status: 503, code: 'remote_disabled' };
    w.close('dev-2', 1006);
    await w.advance(5000);
    const nb = w.tickets.filter(t => t.id === 'dev-2').length,
      held = b.link.sleep();
    await w.advance(60000);
    check(
      'sleep while the server says remote is switched off: nothing, the slow wait stays',
      held === false &&
        b.link.state().connection === 'waiting' &&
        b.states.at(-1) === 'waiting:remote_disabled' &&
        w.tickets.filter(t => t.id === 'dev-2').length === nb,
      [held, b.states.at(-1)]
    );
    w.close('dev-1', 4003);
    await w.advance(1000);
    check(
      'sleep on a link the relay signed out: nothing',
      a.link.sleep() === false && a.link.state().connection === 'stopped'
    );
    a.link.stop();
    check(
      'sleep on a stopped link: nothing',
      a.link.sleep() === false && a.link.state().connection === 'off'
    );
    const c = w.computer('dev-3', 'Unpaired'),
      n3 = w.tickets.length;
    check(
      'sleep on a link nothing wants (nothing paired): nothing, no ticket, no socket',
      c.link.sleep() === false &&
        (await w.advance(60000),
        c.link.state().connection === 'off' && w.tickets.length === n3 && w.count('dev-3') === 0)
    );
  }
  {
    // during a pairing run: the run ends as at any close; with nothing else wanted the link is off
    // and asks nothing more
    const w = world(),
      x = w.computer('dev-5', 'Waiting to pair');
    x.link.pairAny();
    await w.advance(2000);
    check(
      '(setup) in pairing mode: connected for it',
      x.link.state().connection === 'online' && x.pairing.role === 'b'
    );
    const n = w.tickets.length,
      did = x.link.sleep();
    await w.advance(50);
    check(
      'sleep during a pairing run with nothing paired: closed, the run is over, the link is off',
      did === true &&
        w.count('dev-5') === 0 &&
        x.link.state().connection === 'off' &&
        x.pairing.state === 'ended',
      [did, x.link.state().connection, x.pairing]
    );
    await w.advance(5 * 60 * 1000);
    check(
      '…and it asks for nothing afterwards: no ticket, no timer left',
      w.tickets.length === n && w.timers.length === 0,
      [w.tickets.length - n, w.timers.length]
    );
  }
  {
    // one wait for an answer at a time (the change in ping()): a wake's ping, then the ordinary
    // ping before the answer came
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    const asked = () => w.tickets.filter(t => t.id === 'dev-1');

    // a fresh connection, so the moment of its hello is known: the ordinary pings follow 30, 60, …
    // seconds after it
    a.link.sleep();
    await w.advance(31000);
    const hello = asked().at(-1).at;
    check(
      '(setup) back online, at a known moment',
      a.link.state().connection === 'online' && w.t - hello < 2000
    );
    await w.advance(hello + 27000 - w.t);
    w.hooks.latePong = [];
    const did = a.link.wake();

    // the wake's ping at 27 s; the ordinary one at 30 s, both unanswered so far
    await w.advance(4000);
    const n = asked().length,
      pings = w.hooks.latePong.length;
    w.queue.push(w.hooks.latePong.shift());
    await w.advance(500); // the first answer, four seconds late but inside the ten
    w.hooks.latePong.forEach(p => w.queue.push(p));
    w.hooks.latePong = null;
    await w.advance(15000);
    check(
      "a wake's ping, then the ordinary ping before its answer, the answer late but inside ten seconds: the socket stays, nothing is asked again",
      did === true &&
        pings === 2 &&
        a.link.state().connection === 'online' &&
        asked().length === n &&
        w.count('dev-1') === 1,
      [did, pings, a.link.state().connection, asked().length - n]
    );

    // and a wake's ping that is never answered ends the socket ten seconds after the wake, not ten
    // seconds after the ordinary ping
    a.link.sleep();
    await w.advance(31000);
    const hello2 = asked().at(-1).at;
    await w.advance(hello2 + 27000 - w.t);
    w.hooks.noPong = true;
    const n2 = asked().length,
      t0 = w.t;
    const dead = a.link.wake();
    await w.advance(12500);
    check(
      "a wake's ping that is never answered: hung up ten seconds after the wake (the ordinary ping in between does not make that later), and connecting again",
      dead === true &&
        asked().length === n2 + 1 &&
        asked().at(-1).at - t0 >= 10000 &&
        asked().at(-1).at - t0 <= 11000,
      [
        dead,
        asked()
          .slice(n2)
          .map(t => t.at - t0),
      ]
    );
    w.hooks.noPong = false;
  }
  {
    // On a network that comes and goes, a wake cuts the wait short
    // each time but makes the steps short again only once a minute
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    const asked = () => w.tickets.filter(t => t.id === 'dev-1'),
      looks = (from, to) =>
        asked()
          .filter(t => t.at > from && t.at <= to)
          .map(t => t.at - from);
    w.refuse = true;
    w.close('dev-1', 1006);
    await w.advance(20 * 60 * 1000); // unreachable: the wait has grown to its cap
    const T = w.t,
      one = a.link.wake();
    await w.advance(12000);
    const firstRun = looks(T, T + 12000);
    check(
      '2.3: the first wake after a long wait looks two seconds later and goes on from a short step (3 s, 6 s)',
      one === true && firstRun.join() === '2000,5000,11000',
      firstRun
    );
    const two = a.link.wake();
    await w.advance(24000);
    const secondRun = looks(T + 12000, T + 36000);
    check(
      '2.3: a second wake twelve seconds later still looks two seconds later, but the steps stay as long as they had become: one look in the next 24 seconds, not four',
      two === true && secondRun.join() === '2000',
      secondRun
    );
    await w.advance(40000);
    const U = w.t,
      three = a.link.wake();
    await w.advance(6000);
    check(
      '2.3: a wake more than a minute after the one that made the steps short does so again (2 s, then 3 s)',
      three === true && looks(U, U + 6000).join() === '2000,5000',
      looks(U, U + 6000)
    );
    a.link.stop();
  }

  // ---- a dead connection is noticed by the missing pong ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    w.hooks.noPong = true;
    const n = w.tickets.filter(t => t.id === 'dev-1').length;
    await w.advance(45000);
    check(
      'no pong within ten seconds: the link hangs up and reconnects',
      w.tickets.filter(t => t.id === 'dev-1').length > n
    );
    w.hooks.noPong = false;
    await w.advance(10000);
    check('…and the session is back', a.link.state().sessions.includes('dev-2'));
  }

  // ---- a relay in the middle, and a device with a stolen session ----
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop'),
      evil = noise.generateKeyPair();
    w.hooks.forward = m => {
      if (m.kind !== 'pair') return m;
      const p = JSON.parse(Buffer.from(m.body, 'base64').toString());
      if (p.t !== 'reveal_b') return m;
      return {
        ...m,
        body: Buffer.from(JSON.stringify({ ...p, pub: evil.pub.toString('base64') })).toString(
          'base64'
        ),
      };
    };
    b.link.pairAny();
    a.link.pair('dev-2');
    await w.settle();
    const r = b.link.enterCode(a.pairing.shows);
    await w.advance(5000);
    check(
      "a key swapped by the relay: B refuses A's digits and shows no second code",
      r.ok !== true && b.pairing.shows === null
    );
    check(
      '…and neither side stores a pairing or opens a session',
      a.store.pairings().length === 0 &&
        b.store.pairings().length === 0 &&
        a.link.state().sessions.length === 0
    );
    await w.advance(3 * 60 * 1000);
    check(
      'pairing mode times out and, with nothing paired, the connection closes',
      a.pairing.state === 'idle' && w.count('dev-1') === 0 && w.count('dev-2') === 0,
      [a.pairing, w.count('dev-1')]
    );
  }
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop'),
      x = w.computer('dev-0', 'Thief');
    await pairUp(w, a, b);

    // The thief holds a session token of the account (so the relay lets it in) but no pairing key.
    const pairsBefore = w.log.filter(m => m.kind === 'pair' && m.from === 'dev-1').length;
    x.link.pair('dev-1');
    await w.advance(1000);
    check(
      'not in pairing mode: a pair message is ignored and nothing is shown',
      a.pairing.state === 'idle' &&
        w.log.some(m => m.kind === 'pair' && m.from === 'dev-0') &&
        w.log.filter(m => m.kind === 'pair' && m.from === 'dev-1').length === pairsBefore
    );
    const fake = noise.handshake({
      initiator: true,
      s: x.store.identity().priv,
      rs: a.store.identity().pub,
      prologue: noise.fields('1', 'dev-0', 'dev-1', Buffer.alloc(16)),
    });
    w.inject(
      'dev-1',
      JSON.stringify({
        v: 1,
        to: 'dev-1',
        from: 'dev-0',
        kind: 'hs',
        body: Buffer.concat([Buffer.from([1]), fake.write()]).toString('base64'),
      })
    );
    w.inject(
      'dev-1',
      JSON.stringify({
        v: 1,
        to: 'dev-1',
        from: 'dev-0',
        kind: 'msg',
        n: 0,
        body: crypto.randomBytes(272).toString('base64'),
      })
    );
    const hsBefore = w.log.filter(m => m.kind === 'hs' && m.from === 'dev-1').length;
    await w.settle();
    check(
      'a handshake or message from an unpaired device gets no answer',
      w.log.filter(m => m.kind === 'hs' && m.from === 'dev-1').length === hsBefore &&
        a.got.every(g => g.from !== 'dev-0') &&
        !a.link.state().sessions.includes('dev-0')
    );

    // The thief replays the real starter's message 1 to the answerer: no live session is replaced
    // by it.
    const m1 = w.log.find(
      m =>
        m.kind === 'hs' &&
        m.from === 'dev-1' &&
        m.to === 'dev-2' &&
        Buffer.from(m.body, 'base64')[0] === 1
    );
    await w.advance(10 * 60 * 1000);
    w.inject('dev-2', JSON.stringify(m1));
    await w.settle();
    a.link.send('dev-2', { t: 'still here' });
    await w.settle();
    check(
      'a replayed handshake message does not replace the live session',
      b.got.at(-1).obj.t === 'still here' && b.link.state().sessions.includes('dev-1')
    );
    w.inject(
      'dev-1',
      JSON.stringify({ v: 2, to: 'dev-1', from: 'dev-2', kind: 'msg', n: 0, body: 'AA==' })
    );
    await w.settle();
    check(
      'a higher protocol version from a paired computer only raises "update" for it',
      a.events.includes('update:dev-2') && a.link.state().sessions.includes('dev-2')
    );

    // A wrong second code three times stops pairing with that computer.
    const c = w.computer('dev-3', 'Tablet PC');
    a.link.pair('dev-3');
    await w.settle();
    check(
      'Pair pressed for a computer that is not connected: ended at once as offline',
      a.pairing.state === 'ended' &&
        a.pairing.reason === 'offline' &&
        a.link.enterCode('123456').ok !== true,
      a.pairing
    );
    c.link.pairAny();
    await w.settle();
    a.link.pair('dev-3');
    await w.settle();
    c.link.enterCode(a.pairing.shows);
    await w.settle();
    const wrong = c.pairing.shows === '111111' ? '222222' : '111111';
    a.link.enterCode(wrong);
    a.link.enterCode(wrong);
    const third = a.link.enterCode(wrong);
    await w.advance(1000);
    check(
      'three wrong second codes: pairing with that computer stops for ten minutes, nothing stored',
      third.ended === 'locked' && !a.store.pairing('dev-3')
    );
    a.link.pair('dev-3');
    await w.settle();
    check(
      '…and pressing Pair again is refused meanwhile',
      a.pairing.state === 'ended' && a.pairing.reason === 'locked'
    );
  }

  // ---- three findings of the phone's security reviews (2026-10-05) ----
  // A junk answer to a waiting handshake changes nothing: the real answer right behind it still
  // makes the session.
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    let answered = 0;
    w.hooks.forward = m => {
      if (
        m.kind === 'hs' &&
        m.from === 'dev-2' &&
        Buffer.from(m.body, 'base64')[0] === 2 &&
        !answered++
      )
        w.inject(
          'dev-1',
          JSON.stringify({
            v: 1,
            to: 'dev-1',
            from: 'dev-2',
            kind: 'hs',
            body: Buffer.concat([Buffer.from([2]), Buffer.alloc(80, 7)]).toString('base64'),
          })
        );
      return m;
    };
    w.close('dev-2', 1006);
    for (let i = 0; i < 600 && !answered; i++) await w.advance(100);
    await w.advance(300);
    check(
      'junk ahead of the real handshake answer: the session still starts at once',
      answered > 0 &&
        a.link.state().sessions.includes('dev-2') &&
        b.link.state().sessions.includes('dev-1'),
      { answered, a: a.link.state().sessions }
    );
  }

  // A computer that leaves and returns again and again is not kept waiting longer each time: a
  // session that worked resets the wait.
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    for (let i = 0; i < 10; i++) {
      w.close('dev-2', 1006);
      await w.advance(100000);
    }
    w.close('dev-2', 1006);
    await w.settle();
    for (let i = 0; i < 3000 && w.count('dev-2') === 0; i++) await w.advance(100);
    await w.advance(2500);
    check(
      'the eleventh return gets its session within seconds',
      w.count('dev-2') === 1 && a.link.state().sessions.includes('dev-2'),
      a.link.state()
    );
  }

  // A connection try that gets no answer is given up after 30 seconds and tried again: a silent
  // socket, then a ticket call that hangs.
  for (const kind of ['socket', 'ticket']) {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    if (kind === 'socket') w.hooks.mute = true;
    else a.ticketHang = true;
    w.close('dev-1', 1006);
    await w.advance(5000);
    const stuck = a.link.state().connection,
      tries = w.tickets.filter(t => t.id === 'dev-1').length;
    await w.advance(40000);
    const asked = w.tickets.filter(t => t.id === 'dev-1').length,
      gaveUp = asked > tries; // it tried again, so the silent try was given up
    w.hooks.mute = false;
    a.ticketHang = false;
    await w.advance(10 * 60000);
    check(
      'a ' + kind + ' that never answers: connecting, given up within 30 s, then online again',
      stuck === 'connecting' &&
        gaveUp &&
        a.link.state().connection === 'online' &&
        a.link.state().sessions.includes('dev-2'),
      { stuck, gaveUp, now: a.link.state() }
    );
  }

  // A relay that makes a computer leave and return every second for ten minutes cannot force a
  // handshake (and a full resend) every second: the wait is reset only
  // by a session that lived a minute.
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop'),
      b = w.computer('dev-2', 'Laptop');
    await pairUp(w, a, b);
    const mark = w.log.length,
      sessionsA = a.sessions;
    const say = obj =>
      w.inject('dev-1', JSON.stringify({ v: 1, kind: 'presence', device: 'dev-2', ...obj }));
    for (let i = 0; i < 600; i++) {
      say({ online: false });
      await w.advance(500);
      say({ online: true });
      await w.advance(500);
    }
    const starts = w.log
      .slice(mark)
      .filter(
        m => m.kind === 'hs' && m.from === 'dev-1' && Buffer.from(m.body, 'base64')[0] === 1
      ).length;
    check(
      'a relay that flaps one computer every second does not get a handshake per second (backoff grows)',
      starts > 0 && starts <= 15,
      starts
    );
    check(
      '…and the flapping did not make the session count run away either',
      a.sessions - sessionsA <= 15 && w.count('dev-2') === 1,
      a.sessions - sessionsA
    );
  }

  // ---- the first thing a relay says, its hello, is not trusted with the online list either ----
  // (the presence messages were tested, the hello's own list was not)
  {
    const w = world(),
      a = w.computer('dev-1', 'Desktop');
    const odd = ['', 'has space', 'x'.repeat(65), '../etc', 42, null, { id: 'dev-9' }, ['dev-8']];
    w.hooks.hello = () => [...odd, 'dev-2', 'dev_3-ok'];
    a.link.pairAny();
    await w.settle();
    const listed = a.link.state().online;
    check(
      'hello: only ids of the right shape are taken from the list a relay sends',
      a.link.state().connection === 'online' && listed.slice().sort().join() === 'dev-2,dev_3-ok',
      listed
    );

    // and no more than 64 of them, however many the relay names
    const w2 = world(),
      b = w2.computer('dev-1', 'Desktop');
    w2.hooks.hello = () => Array.from({ length: 500 }, (unused, index) => 'flood-' + index);
    b.link.pairAny();
    await w2.settle();
    check(
      'hello: at most 64 ids are taken',
      b.link.state().online.length === 64,
      b.link.state().online.length
    );
  }

  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('FAIL threw: ' + (e.stack || e.message));
  process.exit(1);
});
