// Test of phone/src/link.mjs against desktop/remote-link.js:  node tools/phone-link-test.mjs
// A phone's link (Web Crypto) and a computer's real link (Node) talk through a stand-in relay in
// this process, on a clock the test moves by hand: sessions in both id orders, messages both ways,
// lost, replayed and junk messages, a wrong key, the connection coming and going, Forget. Plain
// Node; no network, no real phone, no real relay. The stand-in relay and its clock follow
// tools/remote-link-test.js; what differs is that the phone's steps wait on real crypto, so
// settling waits on its queue.
import { createRequire } from 'node:module';
import * as PN from '../phone/src/noise.mjs';
import { keyStore } from '../phone/src/keys.mjs';
import { createLink as phoneLink } from '../phone/src/link.mjs';
const require = createRequire(import.meta.url);
const crypto = require('crypto'),
  keys = require('../desktop/remote-keys.js'),
  { createLink: computerLink } = require('../desktop/remote-link.js');

let passed = 0,
  failed = 0;
const check = (name, ok, got) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
};
const memory = () => {
  const m = new Map();
  return {
    get: async k => m.get(k),
    update: async (k, fn) => {
      const [v, r] = fn(m.get(k));
      if (v !== undefined) m.set(k, v);
      return r;
    },
  };
};

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
    phones: [],
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

  // Quiet = the relay's queue is empty and every phone has worked through its own queue, twice in a
  // row.
  const breathe = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setImmediate(r));
      for (const p of w.phones) await p.link.idle();
    }
  };
  w.settle = async () => {
    for (let i = 0; i < 2000; i++) {
      await breathe();
      const next = w.queue.shift();
      if (!next) {
        await breathe();
        if (!w.queue.length) return;
        continue;
      }
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
        if (w.refuse) {
          this.readyState = 3;
          return this.onclose?.({ code: 1006, reason: '' });
        }
        this.open = true;
        this.readyState = 1;
        const others = w.socks.filter(s => s.open && s !== this);
        const named = [...new Set(others.map(s => s.device))];
        say(this, {
          kind: 'hello',
          device: this.device,
          online: w.hooks.hello ? w.hooks.hello(named) : named,
        });
        for (const o of others) say(o, { kind: 'presence', device: this.device, online: true });
      });
    }
    send(text) {
      if (!this.open) throw new Error('closed');
      if (text === 'ping') {
        if (!w.hooks.noPong) w.queue.push(() => this.open && this.onmessage?.({ data: 'pong' }));
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
  const common = (c, id) => ({
    message: (from, obj) => c.got.push({ from, obj }),
    session: () => {
      c.sessions++;
    },
    state: s => c.states.push(s.connection + (s.reason ? ':' + s.reason : '')),
    update: from => c.events.push('update:' + from),
    peer: (pid, s) => {
      c.peer[pid] = s;
    },
  });
  const ticket = c => async () => {
    w.tickets.push({ id: c.id, at: w.t });
    if (c.ticketWait) await c.ticketWait;
    if (c.ticketError) throw c.ticketError;
    return c.id + ':' + w.tickets.length;
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
      sessions: 0,
      states: [],
      peer: {},
    };
    c.link = computerLink({
      self: { id },
      store: c.store,
      url: 'ws://relay',
      name: () => name,
      WebSocket: w.WebSocket,
      now: w.now,
      timers: w.timersApi,
      random: () => 0.5,
      getTicket: ticket(c),
      on: common(c, id),
    });
    return c;
  };
  w.phone = (id, name) => {
    const c = {
      id,
      store: keyStore(memory()),
      got: [],
      events: [],
      sessions: 0,
      states: [],
      peer: {},
      pairs: [],
      unreachable: [],
    };
    c.link = phoneLink({
      self: { id },
      store: c.store,
      url: 'ws://relay',
      name: () => name,
      WebSocket: w.WebSocket,
      now: w.now,
      wall: w.now,
      timers: w.timersApi,
      random: () => 0.5,
      getTicket: ticket(c),
      on: {
        ...common(c, id),
        pair: (from, obj) => c.pairs.push({ from, obj }),
        unreachable: to => c.unreachable.push(to),
      },
    });
    w.phones.push(c);
    return c;
  };
  w.count = id => w.socks.filter(s => s.open && s.device === id).length;
  return w;
}

// What pairing leaves behind on both sides (pair.mjs and phone-pair.js store exactly this): each
// other's key and one pairing id.
async function pairUp(pc, ph, { wrongKey = false } = {}) {
  const pid = crypto.randomBytes(16),
    phKey = await ph.store.identity();
  await ph.store.add({
    id: pc.id,
    pub: Uint8Array.from(pc.store.identity().pub),
    pairingId: Uint8Array.from(pid),
    name: 'as paired',
    how: 'scan',
  });
  pc.store.add({
    id: ph.id,
    pub: wrongKey ? crypto.randomBytes(32) : Buffer.from(phKey.pub),
    pairingId: pid,
    name: 'as paired',
    since: 1,
  });
}

async function both(pcId, phId) {
  const w = world(),
    pc = w.computer(pcId, 'Desktop'),
    ph = w.phone(phId, 'Pixel 8');
  await pairUp(pc, ph);
  pc.link.start();
  await ph.link.start();
  await w.advance(3000);
  return { w, pc, ph };
}
const kinds = (w, from) =>
  w.log
    .filter(m => m.from === from)
    .map(m => m.kind)
    .join();

// 1. Nothing paired: no ticket, no socket.
{
  const w = world(),
    ph = w.phone('ph-1', 'Pixel 8');
  await ph.link.start();
  await w.advance(60000);
  check(
    'nothing paired: the phone makes no connection',
    w.tickets.length === 0 && w.socks.length === 0 && ph.link.state().connection === 'off',
    ph.link.state()
  );
}

// 2. A session in both id orders, names from inside the session, messages both ways, padded.
for (const [pcId, phId] of [
  ['aa-pc', 'zz-ph'],
  ['zz-pc', 'aa-ph'],
]) {
  const who = phId < pcId ? 'phone starts' : 'computer starts',
    { w, pc, ph } = await both(pcId, phId);
  check(
    who + ': both sides have a session',
    ph.link.state().sessions.join() === pcId && pc.link.state().sessions.join() === phId,
    [ph.link.state(), pc.link.state()]
  );
  check(who + ': each side was told once', ph.sessions === 1 && pc.sessions === 1, [
    ph.sessions,
    pc.sessions,
  ]);
  const firstHs = w.log.find(m => m.kind === 'hs' && Buffer.from(m.body, 'base64')[0] === 1);
  check(
    who + ': the lower device id sent message 1',
    firstHs.from === (phId < pcId ? phId : pcId),
    firstHs.from
  );
  check(
    who + ": the phone took the computer's name from the session",
    (await ph.store.pairing(pcId)).name === 'Desktop',
    (await ph.store.pairing(pcId)).name
  );
  check(
    who + ": the computer took the phone's name from the session",
    pc.store.pairing(phId).name === 'Pixel 8',
    pc.store.pairing(phId).name
  );
  check(
    who + ': the phone shows the computer as online with a session',
    ph.peer[pcId]?.online === true && ph.peer[pcId]?.session === true && ph.peer[pcId]?.heard > 0,
    ph.peer[pcId]
  );
  check(
    who + ': the phone sends',
    (await ph.link.send(pcId, { t: 'answer', id: 'q1', text: 'yes, go on' })) === true
  );
  check(
    who + ': the computer sends',
    pc.link.send(phId, { t: 'needs', items: [{ id: 'q1', agent: 'Worker' }] }) === true
  );
  await w.settle();
  check(
    who + ": the computer got the phone's object",
    JSON.stringify(pc.got) ===
      JSON.stringify([{ from: phId, obj: { t: 'answer', id: 'q1', text: 'yes, go on' } }]),
    pc.got
  );
  check(
    who + ": the phone got the computer's object",
    JSON.stringify(ph.got) ===
      JSON.stringify([{ from: pcId, obj: { t: 'needs', items: [{ id: 'q1', agent: 'Worker' }] } }]),
    ph.got
  );
  const sizes = [
    ...new Set(w.log.filter(m => m.kind === 'msg').map(m => Buffer.from(m.body, 'base64').length)),
  ];
  check(
    who + ': every sealed message is one padded size (256 + 16)',
    sizes.join() === '272',
    sizes
  );
  check(
    who + ': nothing readable crosses the relay',
    !w.log.some(m =>
      /yes, go on|Worker|Pixel|Desktop/.test(Buffer.from(m.body, 'base64').toString('latin1'))
    )
  );
  const big = { t: 'x', text: 'a'.repeat(5000) };
  check(
    who + ': an object too long for one envelope is refused, not cut',
    await ph.link.send(pcId, big).then(
      () => false,
      () => true
    )
  );
  check(
    who + ': and the session goes on after that',
    (await ph.link.send(pcId, { t: 'after' })) === true &&
      (await w.settle(), pc.got.at(-1).obj.t === 'after')
  );
}

// 3. Two sends at once keep their order; an old message sent again changes nothing.
{
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  const sent = await Promise.all([1, 2, 3, 4, 5].map(i => ph.link.send('pc-1', { t: 'n', i })));
  await w.settle();
  check(
    'five sends at once all leave, in order',
    sent.every(Boolean) && pc.got.map(g => g.obj.i).join() === '1,2,3,4,5',
    pc.got
  );
  pc.link.send('ph-1', { t: 'one' });
  await w.settle();
  const old = w.log.filter(m => m.kind === 'msg' && m.from === 'pc-1').at(-1);
  w.inject('ph-1', JSON.stringify(old));
  w.inject('ph-1', JSON.stringify(old));
  await w.settle();
  check(
    'a replayed message is not delivered again',
    ph.got.filter(g => g.obj.t === 'one').length === 1,
    ph.got
  );
  pc.link.send('ph-1', { t: 'two' });
  await w.settle();
  check(
    'and the session still works after the replay',
    ph.got.at(-1).obj.t === 'two' && ph.link.state().sessions.length === 1
  );

  // Junk as a message, as a handshake, as an envelope: nothing changes.
  for (const junk of [
    {
      v: 1,
      to: 'ph-1',
      from: 'pc-1',
      kind: 'msg',
      n: 2,
      body: crypto.randomBytes(272).toString('base64'),
    },
    { v: 1, to: 'ph-1', from: 'pc-1', kind: 'msg', n: -1, body: 'AAAA' },
    {
      v: 1,
      to: 'ph-1',
      from: 'pc-1',
      kind: 'hs',
      body: Buffer.concat([Buffer.from([2]), crypto.randomBytes(48)]).toString('base64'),
    },
    { v: 1, to: 'ph-1', from: 'pc-1', kind: 'msg', n: 2, body: '***' },
    { v: 1, to: 'ph-1', from: '__proto__', kind: 'hs', body: 'AQ==' },
    { v: 1, to: 'ph-1', from: 'ph-1', kind: 'msg', n: 0, body: 'AA==' },
    { v: 1, to: 'someone-else', from: 'pc-1', kind: 'msg', n: 2, body: 'AA==' },
    null,
    7,
    'x',
  ])
    w.inject('ph-1', typeof junk === 'string' ? junk : JSON.stringify(junk));
  await w.settle();
  pc.link.send('ph-1', { t: 'three' });
  await w.settle();
  check(
    'junk of every kind changes nothing',
    ph.got.at(-1).obj.t === 'three' && ph.link.state().sessions.length === 1 && ph.got.length === 3,
    ph.got
  );
  w.inject(
    'ph-1',
    JSON.stringify({ v: 2, to: 'ph-1', from: 'pc-1', kind: 'msg', n: 9, body: 'AA==' })
  );
  w.inject(
    'ph-1',
    JSON.stringify({ v: 2, to: 'ph-1', from: 'stranger', kind: 'msg', n: 9, body: 'AA==' })
  );
  await w.settle();
  check(
    'a newer version from a paired computer is reported, from a stranger it is not',
    ph.events.join() === 'update:pc-1',
    ph.events
  );
}

// 4. A message lost on the way ends the session, and a new one is made; in both id orders.
for (const [pcId, phId] of [
  ['aa-pc', 'zz-ph'],
  ['zz-pc', 'aa-ph'],
]) {
  const who = phId < pcId ? 'phone starts' : 'computer starts',
    { w, pc, ph } = await both(pcId, phId);
  w.hooks.forward = m =>
    m.kind === 'msg' && m.from === pcId && !w.hooks.done ? ((w.hooks.done = true), null) : m;
  pc.link.send(phId, { t: 'lost' });
  pc.link.send(phId, { t: 'after the gap' });
  await w.advance(20000);
  check(
    who + ': the message after a lost one is not delivered',
    !ph.got.some(g => g.obj.t === 'after the gap'),
    ph.got
  );
  check(
    who + ': a new session stands afterwards',
    ph.link.state().sessions.length === 1 &&
      pc.link.state().sessions.length === 1 &&
      ph.sessions === 2,
    [ph.sessions, ph.link.state()]
  );
  pc.link.send(phId, { t: 'again' });
  await ph.link.send(pcId, { t: 'again too' });
  await w.settle();
  check(
    who + ': and it carries messages both ways',
    ph.got.at(-1).obj.t === 'again' && pc.got.at(-1).obj.t === 'again too',
    [ph.got, pc.got]
  );
}

// 5. While the phone waits for the answer to its message 1, junk "answers" must not end the wait
// (stricter than the desktop).
{
  const w = world(),
    pc = w.computer('zz-pc', 'Desktop'),
    ph = w.phone('aa-ph', 'Pixel 8');
  await pairUp(pc, ph);
  let held = null;
  w.hooks.forward = m => {
    if (m.kind === 'hs' && m.from === 'zz-pc' && !held) {
      held = m;
      return null;
    }
    return m;
  };
  pc.link.start();
  await ph.link.start();
  await w.settle();
  check('the phone sent message 1 and waits', !!held && ph.link.state().sessions.length === 0);
  w.inject(
    'aa-ph',
    JSON.stringify({
      v: 1,
      to: 'aa-ph',
      from: 'zz-pc',
      kind: 'hs',
      body: Buffer.concat([Buffer.from([2]), crypto.randomBytes(48)]).toString('base64'),
    })
  );
  w.inject(
    'aa-ph',
    JSON.stringify({
      v: 1,
      to: 'aa-ph',
      from: 'zz-pc',
      kind: 'hs',
      body: Buffer.from([2]).toString('base64'),
    })
  );
  await w.settle();
  w.inject('aa-ph', JSON.stringify(held));
  await w.settle();
  check(
    'junk answers did not end the wait: the real answer still makes the session',
    ph.link.state().sessions.join() === 'zz-pc' && pc.link.state().sessions.join() === 'aa-ph',
    [ph.link.state(), pc.link.state()]
  );
  check(
    'with one message 1 only',
    w.log.filter(m => m.kind === 'hs' && m.from === 'aa-ph').length === 1,
    kinds(w, 'aa-ph')
  );
}

// 6. The computer holds another key for this phone (a relay that swapped it, or a stranger using
// the phone's id): no session, ever.
for (const [pcId, phId] of [
  ['aa-pc', 'zz-ph'],
  ['zz-pc', 'aa-ph'],
]) {
  const w = world(),
    pc = w.computer(pcId, 'Desktop'),
    ph = w.phone(phId, 'Pixel 8');
  await pairUp(pc, ph, { wrongKey: true });
  pc.link.start();
  await ph.link.start();
  await w.advance(120000);
  check(
    (phId < pcId ? 'phone starts' : 'computer starts') + ': a wrong key never gives a session',
    ph.link.state().sessions.length === 0 &&
      pc.link.state().sessions.length === 0 &&
      ph.sessions === 0 &&
      ph.got.length === 0
  );
  check('... and sending says no', (await ph.link.send(pcId, { t: 'x' })) === false);
  const n = w.log.filter(m => m.kind === 'hs' && m.from === phId).length;
  check('... and the phone does not hammer: a handful of tries in two minutes', n <= 8, n);
}

// 7. The computer goes away and comes back.
{
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  pc.link.stop();
  await w.settle();
  check(
    'computer gone: the phone says offline, no session',
    ph.peer['pc-1'].online === false &&
      ph.peer['pc-1'].session === false &&
      ph.peer['pc-1'].heard > 0 &&
      ph.link.state().sessions.length === 0,
    ph.peer['pc-1']
  );
  check(
    'computer gone: sending says no, nothing queues',
    (await ph.link.send('pc-1', { t: 'x' })) === false
  );
  check('computer gone: the phone stays connected', ph.link.state().connection === 'online');
  pc.link.resume();
  await w.advance(5000);
  check(
    'computer back: a new session',
    ph.link.state().sessions.join() === 'pc-1' && ph.sessions === 2,
    [ph.link.state(), ph.sessions]
  );
  await ph.link.send('pc-1', { t: 'back' });
  await w.settle();
  check('computer back: messages arrive', pc.got.at(-1)?.obj.t === 'back', pc.got);
}

// 8. The phone's own connection: lost, refused, signed out, replaced, no pong, the server switched
// off.
{
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  w.close('ph-1', 1006);
  await w.settle();
  check(
    'connection lost: waiting, no session',
    ph.link.state().connection === 'waiting' && ph.link.state().sessions.length === 0,
    ph.link.state()
  );
  w.refuse = true;
  await w.advance(1500);
  await w.advance(3000);
  const tries = w.tickets.filter(t => t.id === 'ph-1').length;
  check('refused connections back off (not a tight loop)', tries >= 2 && tries <= 4, tries);
  w.refuse = false;
  await w.advance(30000);
  check(
    'it comes back by itself, with a session',
    ph.link.state().connection === 'online' && ph.link.state().sessions.join() === 'pc-1',
    ph.link.state()
  );
  w.hooks.noPong = true;
  const before = w.tickets.filter(t => t.id === 'ph-1').length;
  await w.advance(45000);
  check(
    'no pong: the phone hangs up and connects again',
    w.tickets.filter(t => t.id === 'ph-1').length > before,
    ph.states.slice(-4)
  );
  w.hooks.noPong = false;
  await w.advance(60000);
  check(
    '... and is online again',
    ph.link.state().connection === 'online' && ph.link.state().sessions.join() === 'pc-1',
    ph.link.state()
  );
  w.close('ph-1', 4003);
  await w.advance(600000);
  check(
    'signed out: stopped for good, no more tickets',
    ph.link.state().connection === 'stopped' &&
      ph.link.state().reason === 'signed_out' &&
      w.count('ph-1') === 0,
    ph.link.state()
  );
  const t2 = w.tickets.length;
  await w.advance(3600000);
  check(
    '... really no more',
    w.tickets.filter(t => t.id === 'ph-1').length ===
      w.tickets.slice(0, t2).filter(t => t.id === 'ph-1').length
  );
  await ph.link.resume();
  await w.advance(5000);
  check(
    'resume connects again',
    ph.link.state().connection === 'online' && ph.link.state().sessions.join() === 'pc-1',
    ph.link.state()
  );

  // the own relay throws the phone out (4009) or ends the shared phone key (4010): stopped at once
  // with that reason, no ticket asked only to be told the same (g18b Info 1)
  for (const [closeCode, reason] of [
    [4009, 'device_revoked'],
    [4010, 'phone_key_retired'],
  ]) {
    const asked = w.tickets.filter(t => t.id === 'ph-1').length;
    w.close('ph-1', closeCode);
    await w.advance(600000);
    check(
      'closed ' + closeCode + ': stopped as ' + reason + ', no more tickets',
      ph.link.state().connection === 'stopped' &&
        ph.link.state().reason === reason &&
        w.tickets.filter(t => t.id === 'ph-1').length === asked,
      [ph.link.state(), asked, w.tickets.filter(t => t.id === 'ph-1').length]
    );
    await ph.link.resume();
    await w.advance(5000);
  }
  w.close('ph-1', 4001);
  await w.settle();
  check(
    'replaced by another sign-in: stopped',
    ph.link.state().connection === 'stopped' && ph.link.state().reason === 'replaced',
    ph.link.state()
  );
  await ph.link.resume();
  await w.advance(5000);
  w.close('ph-1', 4002);
  await w.settle();
  const t3 = w.tickets.length;
  await w.advance(10 * 60000);
  check(
    'remote switched off on the server: no try for ten minutes',
    w.tickets.length === t3 && ph.link.state().reason === 'remote_disabled',
    ph.link.state()
  );
  void pc;
}
for (const [status, want] of [
  [401, 'stopped'],
  [403, 'stopped'],
  [426, 'stopped'],
  [503, 'waiting'],
  [429, 'waiting'],
  [undefined, 'waiting'],
]) {
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  ph.ticketError = { status, code: 'why' };
  await ph.link.start();
  await w.settle();
  check(
    'ticket refused with ' + status + ': ' + want,
    ph.link.state().connection === want && w.socks.length === 0,
    ph.link.state()
  );
  if (status === 429) {
    const n = w.tickets.length;
    await w.advance(30000);
    check('429: the next try is far off', w.tickets.length === n, w.tickets.length);
  }
}

// 9. Stop while the ticket is on its way: no socket is made. Stop and Forget.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  let give;
  ph.ticketWait = new Promise(r => {
    give = r;
  });
  await ph.link.start();
  await ph.link.stop();
  give();
  await w.advance(5000);
  check(
    'stopped while the ticket was on its way: no socket',
    w.socks.length === 0 && ph.link.state().connection === 'off',
    ph.link.state()
  );
  ph.ticketWait = null;
  pc.link.start();
  await ph.link.resume();
  await w.advance(3000);
  check('resume after stop: a session', ph.link.state().sessions.join() === 'pc-1');
  await ph.link.stop();
  await w.settle();
  check(
    'stop: the socket is closed, state off, the computer sees the phone go',
    w.count('ph-1') === 0 &&
      ph.link.state().connection === 'off' &&
      pc.link.state().sessions.length === 0,
    [ph.link.state(), pc.link.state()]
  );
  await w.advance(600000);
  check('stop: it stays off', w.count('ph-1') === 0);
  await ph.link.resume();
  await w.advance(3000);
  check(
    'forget returns true and the computer is gone from the store',
    (await ph.link.forget('pc-1')) === true && (await ph.store.pairings()).length === 0
  );
  await w.settle();
  check(
    'forget of the last computer closes the connection',
    w.count('ph-1') === 0 && ph.link.state().connection === 'off',
    ph.link.state()
  );
  check('forget of an unknown computer is false', (await ph.link.forget('nobody')) === false);
  const hsBefore = w.log.filter(m => m.from === 'ph-1').length;
  await ph.link.hold(true);
  await w.advance(30000);
  check(
    'after forget the phone answers no handshake from that computer',
    ph.link.state().sessions.length === 0 &&
      w.log.filter(m => m.from === 'ph-1').length === hsBefore,
    kinds(w, 'ph-1')
  );
}

// 10. Pairing messages are carried, and only carried. hold() keeps the connection up with nothing
// paired.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    other = w.phone('ph-2', 'Other'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, other);
  await other.link.start(); // someone to talk to
  await ph.link.hold(true);
  await w.advance(2000);
  check(
    'hold: connected with nothing paired',
    ph.link.state().connection === 'online' && w.count('ph-1') === 1,
    ph.link.state()
  );
  check(
    'a pairing message leaves',
    (await ph.link.sendPair('ph-2', { t: 'phone', pub: 'abc' })) === true
  );
  await w.settle();
  check(
    '... and arrives as the same object, with the sender the relay stamped',
    JSON.stringify(other.pairs) ===
      JSON.stringify([{ from: 'ph-1', obj: { t: 'phone', pub: 'abc' } }]),
    other.pairs
  );
  check(
    'a pairing message to a device that is not connected is reported',
    (await ph.link.sendPair('pc-9', { t: 'phone' }),
    await w.settle(),
    ph.unreachable.join() === 'pc-9'),
    ph.unreachable
  );
  check(
    'nothing was stored and no session made by a pairing message',
    (await ph.store.pairings()).length === 0 &&
      ph.link.state().sessions.length === 0 &&
      other.link.state().sessions.length === 0
  );
  await ph.link.hold(false);
  await w.settle();
  check(
    'hold released with nothing paired: the connection is closed',
    w.count('ph-1') === 0 && ph.link.state().connection === 'off',
    ph.link.state()
  );
}

// 11. A second hello on one socket starts no second ping timer; rate_limited mutes sending for the
// time given.
{
  const { w, ph } = await both('pc-1', 'ph-1');
  const pings = () => w.timers.length;
  const n = pings();
  w.inject('ph-1', JSON.stringify({ v: 1, kind: 'hello', device: 'ph-1', online: ['pc-1'] }));
  await w.settle();
  check('a repeated hello adds no timer', pings() === n, [n, pings()]);
  w.inject('ph-1', JSON.stringify({ v: 1, kind: 'err', code: 'rate_limited', retry: 30 }));
  await w.settle();
  check('rate limited: sending says no', (await ph.link.send('pc-1', { t: 'x' })) === false);
  await w.advance(31000);
  check('... and yes again after the wait', (await ph.link.send('pc-1', { t: 'x' })) === true);
}

// ---- Review 6 (2026-10-05) ----
// R1. A pairing removed or renewed in the store by something else (another open copy of the app)
// ends the session at the next message.
for (let [how, told] of [
  ['remove', true],
  ['renewIdentity', true],
  ['remove', false],
  ['renewIdentity', false],
]) {
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  if (how === 'remove') await ph.store.remove('pc-1');
  else await ph.store.renewIdentity();
  if (told) await ph.link.refresh();
  else await w.advance(31000); // the change signal, or else the next ping
  how = how + (told ? ' (signal)' : ' (no signal, half a minute)');
  pc.link.send('ph-1', { t: 'secret' });
  await w.settle();
  check(
    'review 6: after ' + how + ' in the store a message is not delivered',
    ph.got.length === 0,
    ph.got
  );
  check(
    'review 6: after ' + how + ' sending says no and the session is gone',
    (await ph.link.send('pc-1', { t: 'x' })) === false && ph.link.state().sessions.length === 0,
    ph.link.state()
  );
}

// R2. Forget of a computer takes the computers it introduced, their sessions too, in one call.
{
  const w = world(),
    a = w.computer('pc-a', 'Desktop'),
    b = w.computer('pc-b', 'Studio'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(a, ph);
  const pid = crypto.randomBytes(16),
    key = await ph.store.identity();
  await ph.store.add({
    id: 'pc-b',
    pub: Uint8Array.from(b.store.identity().pub),
    pairingId: Uint8Array.from(pid),
    name: 'Studio',
    how: 'introduced',
    by: 'pc-a',
  });
  b.store.add({ id: 'ph-1', pub: Buffer.from(key.pub), pairingId: pid, name: '', since: 1 });
  a.link.start();
  b.link.start();
  await ph.link.start();
  await w.advance(5000);
  check(
    'review 6: sessions with the scanned and the introduced computer',
    ph.link.state().sessions.sort().join() === 'pc-a,pc-b',
    ph.link.state()
  );
  check(
    'review 6: forget of the introducer',
    (await ph.link.forget('pc-a')) === true && (await ph.store.pairings()).length === 0
  );
  await w.settle();
  check(
    'review 6: ... ends both sessions and, nothing being left, the connection',
    ph.link.state().sessions.length === 0 &&
      ph.link.state().connection === 'off' &&
      w.count('ph-1') === 0,
    ph.link.state()
  );
  const broken = {
    ...ph.store,
    remove: async () => {
      throw new Error('store broke');
    },
  };
  const w2 = world(),
    a2 = w2.computer('pc-a', 'Desktop'),
    ph2 = w2.phone('ph-2', 'Pixel 8');
  await pairUp(a2, ph2);
  ph2.store.remove = broken.remove;
  a2.link.start();
  await ph2.link.start();
  await w2.advance(3000);
  check(
    'review 6: a Forget the store refuses rejects and changes nothing here',
    (await ph2.link.forget('pc-a').then(
      () => false,
      () => true
    )) && ph2.link.state().sessions.join() === 'pc-a',
    ph2.link.state()
  );
}

// R3. A computer that leaves and returns again and again is not kept waiting longer each time (the
// phone starts; the desktop file still has the growing wait when it is the one that starts, which
// is noted for its owner).
{
  const { w, pc, ph } = await both('zz-pc', 'aa-ph'),
    waits = [];
  for (let i = 0; i < 10; i++) {
    pc.link.stop();
    await w.settle();
    pc.link.resume();
    await w.settle();
    let t = 0;
    while (ph.link.state().sessions.length === 0 && t < 400000) {
      await w.advance(500);
      t += 500;
    }
    waits.push(t / 1000);
    await w.advance(20000);
  }
  check(
    'review 6: ten leave-and-returns, a session within 3 s every time',
    Math.max(...waits) <= 3,
    waits
  );
}

// R8. An old message 1 sent again is not answered and pushes nothing away (the computer starts
// here, the phone answers).
{
  const { w, pc, ph } = await both('aa-pc', 'zz-ph');
  const old = w.log.find(
    m => m.kind === 'hs' && m.from === 'aa-pc' && Buffer.from(m.body, 'base64')[0] === 1
  );
  const answersBefore = w.log.filter(m => m.kind === 'hs' && m.from === 'zz-ph').length;
  for (let i = 0; i < 10; i++) {
    w.inject('zz-ph', JSON.stringify(old));
    await w.advance(40000);
  }
  check(
    'review 6: ten replays of an old message 1 are not answered',
    w.log.filter(m => m.kind === 'hs' && m.from === 'zz-ph').length === answersBefore,
    w.log.filter(m => m.kind === 'hs' && m.from === 'zz-ph').length - answersBefore
  );
  check(
    'review 6: the live session is untouched by them',
    ph.link.state().sessions.join() === 'aa-pc' &&
      (await ph.link.send('aa-pc', { t: 'still' })) === true
  );
  await w.advance(6 * 60000); // the computer's own wait from its first handshake is over
  pc.link.stop();
  await w.settle();
  pc.link.resume();
  await w.settle();
  let t = 0;
  while (ph.link.state().sessions.length === 0 && t < 600000) {
    await w.advance(500);
    t += 500;
  }
  check('review 6: and the honest computer gets its next session at once', t <= 3000, t);
}

// R6. A ticket call that never answers, and a socket that opens but never says hello: the try ends
// and another is made.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  ph.ticketWait = new Promise(() => {});
  await ph.link.start();
  await w.advance(30200);
  check(
    'review 6: a ticket that never comes ends the try',
    ph.link.state().connection === 'waiting' && ph.link.state().reason === 'timeout',
    ph.link.state()
  );
  ph.ticketWait = null;
  pc.link.start();
  await w.advance(10000);
  check(
    'review 6: ... and the next try connects',
    ph.link.state().connection === 'online' && ph.link.state().sessions.join() === 'pc-1',
    ph.link.state()
  );
  const w2 = world(),
    pc2 = w2.computer('pc-1', 'Desktop'),
    ph2 = w2.phone('ph-1', 'Pixel 8');
  await pairUp(pc2, ph2);
  const Real = w2.WebSocket;
  let silent = true;
  ph2.link = (await import('../phone/src/link.mjs')).createLink({
    self: { id: 'ph-1' },
    store: ph2.store,
    url: 'ws://relay',
    WebSocket: class extends Real {
      set onmessage(f) {
        this._f = f;
      }
      get onmessage() {
        return silent ? null : this._f;
      }
    },
    now: w2.now,
    wall: w2.now,
    timers: w2.timersApi,
    random: () => 0.5,
    getTicket: async () => {
      w2.tickets.push({ id: 'ph-1' });
      return 'ph-1:' + w2.tickets.length;
    },
  });
  await ph2.link.start();
  await w2.advance(29000);
  check(
    'review 6: a socket that never says hello is still "connecting" before the limit',
    ph2.link.state().connection === 'connecting' && w2.count('ph-1') === 1,
    ph2.link.state()
  );
  await w2.advance(1200);
  check(
    'review 6: ... is hung up at the limit',
    w2.count('ph-1') === 0 && ph2.link.state().connection === 'waiting',
    ph2.link.state()
  );
  silent = false;
  await w2.advance(10000);
  check(
    'review 6: ... and the next try connects',
    ph2.link.state().connection === 'online',
    ph2.link.state()
  );
}

// R7. A store call that never answers: Stop still closes the socket at once, and the queue moves on
// after the limit.
{
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  const real = ph.store.pairings;
  ph.store.pairings = () => new Promise(() => {});
  ph.link.refresh().catch(() => {});

  // the queue now waits on the store
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  const stopping = ph.link.stop();
  check(
    'review 6: with the store hung, Stop closes the socket without waiting',
    w.count('ph-1') === 0
  );
  for (let i = 0; i < 20 && w.timers.length; i++) {
    const due = w.timers.sort((x, y) => x.at - y.at)[0];
    w.timersApi.clear(due);
    w.t = due.at;
    due.fn();
    for (let j = 0; j < 20; j++) await new Promise(r => setImmediate(r));
    if (ph.link.state().connection === 'off') break;
  }
  await stopping;
  check(
    "review 6: ... and after the store's time limit the queue went on: state off",
    ph.link.state().connection === 'off',
    ph.link.state()
  );
  ph.store.pairings = real;
}

// R10. Presence for made-up ids: the list stops growing, a paired computer is still taken.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  await ph.link.start();
  await w.advance(2000);
  for (let i = 0; i < 300; i++)
    w.inject('ph-1', JSON.stringify({ v: 1, kind: 'presence', device: 'fake-' + i, online: true }));
  w.inject(
    'ph-1',
    JSON.stringify({ v: 1, kind: 'presence', device: 'x'.repeat(5000), online: true })
  );
  await w.settle();
  check(
    'review 6: made-up presence cannot grow the list past its size',
    ph.link.state().online.length === 64,
    ph.link.state().online.length
  );
  pc.link.start();
  await w.advance(5000);
  check(
    'review 6: a paired computer still gets its session with the list full',
    ph.link.state().sessions.join() === 'pc-1',
    ph.link.state().sessions
  );
}

// A computer paired while the connection is already up (hold): restart(id) starts its first session
// without a reconnect.
{
  const w = world(),
    pc = w.computer('zz-pc', 'Desktop'),
    other = w.computer('pc-other', 'Other'),
    ph = w.phone('aa-ph', 'Pixel 8');
  pc.store.add({
    id: 'pc-other',
    pub: other.store.identity().pub,
    pairingId: crypto.randomBytes(16),
    name: '',
    since: 1,
  }); // so the computer is connected already
  pc.link.start();
  await ph.link.hold(true);
  await w.advance(2000);
  const tickets = w.tickets.filter(t => t.id === 'aa-ph').length;
  await pairUp(pc, ph);
  await ph.link.ensure('zz-pc');
  await ph.link.hold(false);
  await w.advance(3000);
  await ph.link.ensure('zz-pc'); // a second call with the session there changes nothing
  check(
    'review 6: paired while connected, ensure(id) gives the session on the same connection, once',
    ph.link.state().sessions.join() === 'zz-pc' &&
      w.tickets.filter(t => t.id === 'aa-ph').length === tickets,
    [ph.link.state(), tickets]
  );
}

// ---- Review 7 (2026-10-05) ----
// S1. A resume and then a Stop before the queue reached the resume: Stop wins. A hold queued before
// a Stop does not outlive it.
{
  const { w, ph } = await both('pc-1', 'ph-1');
  await ph.link.stop();
  await w.settle();
  const r = ph.link.resume(),
    s = ph.link.stop();
  await r;
  await s;
  await w.advance(20000);
  check(
    'review 7: resume then Stop in one turn stays stopped',
    ph.link.state().connection === 'off' && w.count('ph-1') === 0,
    ph.link.state()
  );
  const real = ph.store.pairings;
  let let_go;
  ph.store.pairings = () =>
    new Promise(res => {
      let_go = () => res(real());
    });
  const r1 = ph.link.refresh();

  // now waiting on the store, inside the queue
  for (let i = 0; i < 10; i++) await new Promise(res => setImmediate(res));
  const r2 = ph.link.resume(),
    s2 = ph.link.stop();
  ph.store.pairings = real;
  let_go && let_go();
  await r1;
  await r2;
  await s2;
  await w.advance(20000);
  check(
    'review 7: the same with the store slow in between',
    ph.link.state().connection === 'off' && w.count('ph-1') === 0,
    ph.link.state()
  );
  const w2 = world(),
    lone = w2.phone('ph-9', 'Pixel 8');
  const h = lone.link.hold(true),
    s3 = lone.link.stop();
  await h;
  await s3;
  await lone.link.resume();
  await w2.advance(20000);
  check(
    'review 7: a hold queued before a Stop is gone with it (nothing paired: no connection after resume)',
    lone.link.state().connection === 'off' && w2.socks.length === 0,
    lone.link.state()
  );
}

// S2. One store read that fails while a message comes in: nothing is lost for good, the two get a
// session again by themselves.
for (const [pcId, phId] of [
  ['aa-pc', 'zz-ph'],
  ['zz-pc', 'aa-ph'],
]) {
  const who = phId < pcId ? 'phone starts' : 'computer starts',
    { w, pc, ph } = await both(pcId, phId);
  const real = ph.store.pairings;
  let reads = 0;
  ph.store.pairings = () => {
    reads++;
    return Promise.reject(new Error('store hiccup'));
  };
  check(
    'review 8: ' + who + ': a refresh the store refuses says so',
    (await ph.link.refresh()) === false
  );
  pc.link.send(phId, { t: 'during the hiccup' });
  await w.settle();
  check(
    'review 7: ' + who + ': a failed read does not end the session',
    ph.link.state().sessions.length === 1,
    ph.link.state()
  );
  check(
    'review 8: ' +
      who +
      ': and the message sent meanwhile arrives (N1: it used to be lost silently)',
    ph.got.at(-1)?.obj.t === 'during the hiccup',
    ph.got.map(g => g.obj.t)
  );
  const before = reads;
  for (let i = 0; i < 50; i++) pc.link.send(phId, { t: 'n', i });
  await w.advance(50000);
  check(
    'review 8: ' +
      who +
      ': fifty messages and a ping cause no store read while the store rests (N7, N2)',
    reads === before && ph.got.filter(g => g.obj.t === 'n').length === 50,
    [reads - before, ph.got.length]
  );
  ph.store.pairings = real;
  await w.advance(70000);
  pc.link.send(phId, { t: 'next' });
  await w.advance(30000);
  pc.link.send(phId, { t: 'later' });
  await w.settle();
  check(
    'review 7: ' + who + ': and a session stands again, with later messages arriving',
    ph.link.state().sessions.length === 1 &&
      pc.link.state().sessions.length === 1 &&
      ph.got.at(-1)?.obj.t === 'later',
    [ph.got.map(g => g.obj.t), ph.link.state().sessions]
  );
}

// S2b. The phone has no session but the computer still sends into its own (the state the reviewer
// reached): the phone asks for a new one.
{
  const { w, pc, ph } = await both('aa-pc', 'zz-ph');
  const pid = await ph.store.pairing('aa-pc'),
    fresh = crypto.randomBytes(16);
  await ph.store.add({
    id: 'aa-pc',
    pub: pid.pub,
    pairingId: Uint8Array.from(fresh),
    name: 'Desktop',
    how: 'scan',
  }); // paired again by another open copy
  pc.store.add({
    id: 'zz-ph',
    pub: pc.store.pairing('zz-ph').pub,
    pairingId: fresh,
    name: 'Pixel 8',
    since: 2,
  });
  await ph.link.refresh(); // the change signal from the other copy
  pc.link.send('zz-ph', { t: 'into the old session' });
  await w.advance(30000);
  await ph.link.send('aa-pc', { t: 'under the new pairing' });
  await w.settle();
  check(
    'review 7: a message under a pairing that was replaced is not delivered, and a session under the new one is made',
    !ph.got.some(g => g.obj.t === 'into the old session') &&
      ph.link.state().sessions.length === 1 &&
      pc.got.at(-1)?.obj.t === 'under the new pairing',
    [ph.got.map(g => g.obj.t), pc.got.map(g => g.obj.t)]
  );
}

// S4. More recorded message 1s than the memory holds, sent again: the real computer is still
// answered within seconds.
{
  const DN = require('../desktop/remote-noise.js');
  const { w, pc, ph } = await both('aa-pc', 'zz-ph');
  const pairing = await ph.store.pairing('aa-pc'),
    phKey = await ph.store.identity();
  const genuine = () => {
    const hs = DN.handshake({
      initiator: true,
      s: pc.store.identity().priv,
      rs: Buffer.from(phKey.pub),
      prologue: DN.fields('1', 'aa-pc', 'zz-ph', Buffer.from(pairing.pairingId)),
    });
    return JSON.stringify({
      v: 1,
      to: 'zz-ph',
      from: 'aa-pc',
      kind: 'hs',
      body: Buffer.concat([Buffer.from([1]), hs.write()]).toString('base64'),
    });
  };
  const recorded = Array.from({ length: 40 }, genuine);
  for (const m of recorded) {
    w.inject('zz-ph', m);
    await w.advance(2100);
  } // each was once real; the phone has seen them all, the first eight fell out of its memory
  for (let i = 0; i < 8; i++) {
    w.inject('zz-ph', recorded[i]);
    await w.advance(2100);
  }
  await w.advance(6 * 60000);
  pc.link.stop();
  await w.settle();
  pc.link.resume();
  await w.settle();
  let t = 0;
  while (ph.link.state().sessions.length === 0 && t < 600000) {
    await w.advance(500);
    t += 500;
  }
  check(
    'review 7: forty old message 1s and eight replays later, the honest computer has its session within 5 s',
    t <= 5000,
    t
  );
}

// S6. Made-up "please start" requests in the computer's name: a session that stands is not replaced
// every second.
{
  const { w, ph } = await both('zz-pc', 'aa-ph');
  const before = w.log.filter(m => m.kind === 'hs' && m.from === 'aa-ph').length,
    sessions = ph.sessions;
  for (let i = 0; i < 60; i++) {
    w.inject(
      'aa-ph',
      JSON.stringify({ v: 1, to: 'aa-ph', from: 'zz-pc', kind: 'hs', body: 'AA==' })
    );
    await w.advance(1000);
  }
  const made = w.log.filter(m => m.kind === 'hs' && m.from === 'aa-ph').length - before;
  check(
    'review 7: sixty forged requests in a minute start at most seven handshakes',
    made <= 7 && ph.sessions - sessions <= 7 && ph.link.state().sessions.length === 1,
    [made, ph.sessions - sessions]
  );
}

// S7. A pong nobody asked for does not make the phone reconnect as fast as it can.
{
  const { w, ph } = await both('pc-1', 'ph-1');
  const before = w.tickets.filter(t => t.id === 'ph-1').length;
  for (let t = 0; t < 60000; t += 250) {
    if (ph.link.state().connection === 'online') {
      w.inject('ph-1', 'pong');
      w.close('ph-1', 1006);
    }
    await w.advance(250);
  }
  const calls = w.tickets.filter(t => t.id === 'ph-1').length - before;
  check(
    'review 7: hello, unasked pong, close, again and again: ticket calls stay few',
    calls <= 10,
    calls
  );
}

// S12. A hello that names 64 made-up devices before the real computer (the phone starts): the
// session is still made.
{
  const w = world(),
    pc = w.computer('zz-pc', 'Desktop'),
    ph = w.phone('aa-ph', 'Pixel 8');
  await pairUp(pc, ph);
  w.hooks.hello = list => [
    ...Array.from({ length: 64 }, (_, i) => 'fake-' + i),
    'x'.repeat(5000),
    7,
    null,
    ...list,
  ];
  pc.link.start();
  await w.advance(2000);
  await ph.link.start();
  await w.advance(5000);
  check(
    'review 7: a real computer named after 64 made-up ones still gets its session',
    ph.link.state().sessions.join() === 'zz-pc' && ph.link.state().online.length <= 64,
    [ph.link.state().sessions, ph.link.state().online.length]
  );
}

// ---- Review 8 (2026-10-05) ----
// N2. A store that hangs, a hello naming 64 devices and thirty presences: Stop and what follows
// still finish in bounded time.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  pc.link.start();
  await ph.link.start();
  await w.advance(3000);
  w.close('ph-1', 1006);
  await w.settle();
  let hung = 0;
  const hang = what => () => {
    hung++;
    if (process.env.DEBUG_HANG) console.log('hung read:', what, 'at', w.t % 1000000);
    return new Promise(() => {});
  };
  ph.store.pairings = hang('pairings');
  ph.store.pairing = hang('pairing');
  ph.store.identity = hang('identity');
  w.hooks.hello = list => [...Array.from({ length: 64 }, (_, i) => 'fake-' + i), ...list];

  // From here the phone's queue may wait on the store, so the clock is moved without waiting for
  // the queue to empty.
  const spin = async ms => {
    const end = w.t + ms;
    for (;;) {
      await Promise.race([ph.link.idle(), new Promise(r => setTimeout(r, 25))]);

      /* real time for real crypto, but never a wait on a queue that is stuck on the store */ const q =
        w.queue.shift();
      if (q) {
        q();
        continue;
      }
      const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      w.timersApi.clear(due);
      w.t = Math.max(w.t, due.at);
      due.fn();
    }
    w.t = end;
  };
  await spin(3000); // reconnected: the hello's one read hangs
  for (let i = 0; i < 30; i++)
    w.inject(
      'ph-1',
      JSON.stringify({ v: 1, kind: 'presence', device: 'other-' + i, online: true })
    );
  const t0 = w.t;
  const stopping = ph.link.stop();
  let done = false;
  stopping.then(() => {
    done = true;
  });
  for (let i = 0; i < 400 && !done; i++) await spin(250);
  check(
    'review 8: with the store hung, Stop finishes within one store time limit, not one per named device',
    done && w.t - t0 <= 11000,
    w.t - t0
  );
  check(
    'review 8: ... and the session it had is still there for the next connection: what was paired stayed in memory',
    ph.link.state().connection === 'off'
  );
  delete w.hooks.hello;
}

// N3. The phone starts (lower id); the computer loses its session three seconds after the handshake
// and asks: at once, not after ASK_GAP.
{
  const { w, pc, ph } = await both('zz-pc', 'aa-ph');
  await w.advance(3000);
  pc.link.restart('aa-ph'); // the computer ends its side and asks for a new one
  let t = 0;
  while (pc.link.state().sessions.length === 0 && t < 30000) {
    await w.advance(250);
    t += 250;
  }
  check(
    'review 8: an honest computer that lost its session has it back within 2 s',
    t <= 2000 && ph.link.state().sessions.length === 1,
    t
  );
  await ph.link.send('zz-pc', { t: 'after' });
  await w.settle();
  check(
    'review 8: ... and what the phone sends then arrives',
    pc.got.at(-1)?.obj.t === 'after',
    pc.got.map(g => g.obj.t)
  );
}

// N4. Forty recorded message 1s replayed twice a second, without end, while the honest computer
// reconnects.
{
  const DN = require('../desktop/remote-noise.js');
  const { w, pc, ph } = await both('aa-pc', 'zz-ph');
  const pairing = await ph.store.pairing('aa-pc'),
    phKey = await ph.store.identity();
  const genuine = () => {
    const hs = DN.handshake({
      initiator: true,
      s: pc.store.identity().priv,
      rs: Buffer.from(phKey.pub),
      prologue: DN.fields('1', 'aa-pc', 'zz-ph', Buffer.from(pairing.pairingId)),
    });
    return JSON.stringify({
      v: 1,
      to: 'zz-ph',
      from: 'aa-pc',
      kind: 'hs',
      body: Buffer.concat([Buffer.from([1]), hs.write()]).toString('base64'),
    });
  };
  const recorded = Array.from({ length: 40 }, genuine);
  for (const m of recorded) {
    w.inject('zz-ph', m);
    await w.advance(600);
  }
  const answers = () => w.log.filter(m => m.kind === 'hs' && m.from === 'zz-ph').length,
    before = answers();
  for (let i = 0; i < 80; i++) {
    w.inject('zz-ph', recorded[i % 40]);
    await w.advance(500);
  }
  check(
    'review 8: forty recorded message 1s sent again for forty seconds are not answered once',
    answers() === before,
    answers() - before
  );
  await w.advance(6 * 60000);
  pc.link.stop();
  await w.settle();
  pc.link.resume();
  let t = 0,
    k = 0;
  while (ph.link.state().sessions.length === 0 && t < 300000) {
    w.inject('zz-ph', recorded[k++ % 40]);
    await w.advance(500);
    t += 500;
  }
  check(
    'review 8: and with the replays still coming the honest computer has its session within 5 s',
    t <= 5000,
    t
  );
}

// ---- Review 9 (2026-10-05) ----
// A5. The first store read fails: the link looks again by itself. And a pairing that appears
// through refresh() connects it.
{
  const w = world(),
    pc = w.computer('pc-1', 'Desktop'),
    ph = w.phone('ph-1', 'Pixel 8');
  await pairUp(pc, ph);
  const real = ph.store.pairings;
  let fail = true;
  ph.store.pairings = () => (fail ? Promise.reject(new Error('store down')) : real());
  pc.link.start();
  await ph.link.start();
  await w.advance(5000);
  check(
    'review 9: a first store read that fails leaves the link waiting, not off for good',
    ph.link.state().connection === 'waiting' &&
      ph.link.state().reason === 'store' &&
      w.count('ph-1') === 0,
    ph.link.state()
  );
  fail = false;
  await w.advance(70000);
  check(
    'review 9: ... and when the store answers it connects by itself, with a session',
    ph.link.state().connection === 'online' && ph.link.state().sessions.join() === 'pc-1',
    ph.link.state()
  );
  const w2 = world(),
    pc2 = w2.computer('pc-1', 'Desktop'),
    ph2 = w2.phone('ph-1', 'Pixel 8');
  pc2.store.add({
    id: 'keep-up',
    pub: crypto.randomBytes(32),
    pairingId: crypto.randomBytes(16),
    name: '',
    since: 1,
  });
  pc2.link.start();
  await ph2.link.start();
  await w2.advance(3000);
  check('review 9: (setup) nothing paired, the link is off', ph2.link.state().connection === 'off');
  await pairUp(pc2, ph2);
  await ph2.link.refresh();
  await w2.advance(5000); // another open copy paired the first computer; the change signal arrives
  check(
    'review 9: a pairing that appears through refresh() connects the link without a resume',
    ph2.link.state().connection === 'online' && ph2.link.state().sessions.join() === 'pc-1',
    ph2.link.state()
  );
}

// A6. A computer forgotten in another copy while this copy's store cannot be read: its session ends
// after the second failed read.
{
  const { w, pc, ph } = await both('pc-1', 'ph-1');
  const real = ph.store.pairings;
  await ph.store.remove('pc-1');
  ph.store.pairings = () => Promise.reject(new Error('store down'));
  await w.advance(31000);
  check(
    'review 9: one failed read changes nothing yet',
    ph.link.state().sessions.join() === 'pc-1'
  );
  await w.advance(95000);
  pc.link.send('ph-1', { t: 'secret' });
  await w.settle();
  check(
    'review 9: after a second failed read in a row every session is ended and nothing more is delivered or sent',
    ph.link.state().sessions.length === 0 &&
      ph.got.length === 0 &&
      (await ph.link.send('pc-1', { t: 'x' })) === false &&
      w.count('ph-1') === 0,
    [ph.link.state(), ph.got.length]
  );
  ph.store.pairings = real;
  await w.advance(130000);
  check(
    'review 9: when the store answers again the Forget is seen: no connection, no session',
    ph.link.state().connection === 'off' && ph.link.state().sessions.length === 0,
    ph.link.state()
  );
  const b = await both('pc-1', 'ph-1'),
    real2 = b.ph.store.pairings;
  b.ph.store.pairings = () => Promise.reject(new Error('store down'));
  await b.w.advance(130000);
  b.ph.store.pairings = real2;
  await b.w.advance(130000);
  check(
    'review 9: a store that only failed for a while costs the session for that while, and it comes back',
    b.ph.link.state().sessions.join() === 'pc-1' && b.ph.link.state().connection === 'online',
    b.ph.link.state()
  );
}

// A12. Recorded message 1s the phone never saw, placed after the real one, do not take its place.
{
  const DN = require('../desktop/remote-noise.js');
  const w = world(),
    pc = w.computer('aa-pc', 'Desktop'),
    ph = w.phone('zz-ph', 'Pixel 8');
  await pairUp(pc, ph);
  const pairing = await ph.store.pairing('aa-pc'),
    phKey = await ph.store.identity();
  const genuine = () => {
    const hs = DN.handshake({
      initiator: true,
      s: pc.store.identity().priv,
      rs: Buffer.from(phKey.pub),
      prologue: DN.fields('1', 'aa-pc', 'zz-ph', Buffer.from(pairing.pairingId)),
    });
    return JSON.stringify({
      v: 1,
      to: 'zz-ph',
      from: 'aa-pc',
      kind: 'hs',
      body: Buffer.concat([Buffer.from([1]), hs.write()]).toString('base64'),
    });
  };
  const unseen = Array.from({ length: 8 }, genuine);
  let held = null;
  w.hooks.forward = m => {
    if (m.kind === 'hs' && m.from === 'zz-ph') {
      if (!held) {
        held = m;
        for (const u of unseen) w.inject('zz-ph', u);
      }
      return null;
    }
    return m;

    // the relay holds the phone's answer back, sends eight recordings, and keeps the answers to
    // those
  };
  pc.link.start();
  await ph.link.start();
  await w.settle();
  w.hooks.forward = null;
  w.inject('aa-pc', JSON.stringify(held));
  await w.advance(3000);
  check(
    'review 9: eight unseen recordings sent after the real message 1 do not push out its candidate: the session is made',
    ph.link.state().sessions.join() === 'aa-pc' && pc.link.state().sessions.join() === 'zz-ph',
    [ph.link.state().sessions, pc.link.state().sessions]
  );
}

// A16. Resuming when the last computer was forgotten elsewhere meanwhile: the socket goes at the
// hello, not half a minute later.
{
  const { w, ph } = await both('pc-1', 'ph-1');
  await ph.link.stop();
  await w.settle();
  await ph.store.remove('pc-1');
  await ph.link.resume();
  await w.advance(3000);
  check(
    'review 9: nothing paired any more: no socket is kept after the hello',
    w.count('ph-1') === 0 && ph.link.state().connection === 'off',
    ph.link.state()
  );
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
