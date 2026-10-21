// Test of "Add a phone" on the computer:  node phone/test/pair-link-test.mjs  (plain Node).
// The phone's real pairing and link (phone/src/pair.mjs, link.mjs) pair with the computer's real
// link (desktop/remote-link.js, its block "pairing a phone", which runs desktop/phone-pair.js)
// through a stand-in relay in this process, on a clock the test moves by hand. What it proves: the
// code the computer shows is scanned, the digits the phone shows are typed at the computer, both
// sides store each other only then, an encrypted session follows and a message goes each way;
// wrong digits, a stranger's proof, a cancel and the two minutes all leave nothing stored. The
// relay stand-in follows tools/phone-link-test.mjs.
import { createRequire } from 'node:module';
import { keyStore } from '../src/keys.mjs';
import { createLink as phoneLink } from '../src/link.mjs';
import { scanPairing } from '../src/pair.mjs';

const require = createRequire(import.meta.url);
const keys = require('../../desktop/remote-keys.js');
const { createLink: computerLink } = require('../../desktop/remote-link.js');

let passed = 0;
let failed = 0;
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
  const w = { t: 1700000000000, timers: [], queue: [], socks: [], phones: [] };
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
  const breathe = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setImmediate(r));
      for (const p of w.phones) await p.link.idle();
      for (const p of w.phones) await p.drain();
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
  w.WebSocket = class {
    constructor(url) {
      this.device = decodeURIComponent(url.split('ticket=')[1]).split(':')[0];
      this.readyState = 0;
      this.open = false;
      w.socks.push(this);
      w.queue.push(() => {
        this.open = true;
        this.readyState = 1;
        const others = w.socks.filter(s => s.open && s !== this);
        say(this, {
          kind: 'hello',
          device: this.device,
          online: [...new Set(others.map(s => s.device))],
        });
        for (const o of others) say(o, { kind: 'presence', device: this.device, online: true });
      });
    }
    send(text) {
      if (!this.open) throw new Error('closed');
      if (text === 'ping')
        return w.queue.push(() => this.open && this.onmessage?.({ data: 'pong' }));
      const m = JSON.parse(text);
      const out = w.forward ? w.forward(m) : m;
      if (!out) return;
      const target = w.socks.find(s => s.open && s.device === m.to);
      if (!target) return say(this, { kind: 'err', code: 'offline', to: m.to });
      w.queue.push(() => target.open && target.onmessage?.({ data: JSON.stringify(out) }));
    }
    close() {
      if (!this.open) return;
      this.open = false;
      this.readyState = 3;
      for (const o of w.socks.filter(s => s.open))
        say(o, { kind: 'presence', device: this.device, online: false });
    }
  };
  const ticket = id => async () => id + ':' + w.t;
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
    const c = { id, store: keys.keyStore(backend), got: [], states: [], paired: [], sessions: 0 };
    c.link = computerLink({
      self: { id },
      store: c.store,
      url: 'ws://relay',
      name: () => name,
      WebSocket: w.WebSocket,
      now: w.now,
      timers: w.timersApi,
      random: () => 0.5,
      getTicket: ticket(id),
      on: {
        message: (from, obj) => c.got.push({ from, obj }),
        session: () => c.sessions++,
        phonePairing: s => c.states.push(s),
        paired: (pid, n) => c.paired.push({ pid, n }),
      },
    });
    return c;
  };

  // A phone with its pairing glue as phone/app/app.mjs has it: pair messages go to the run, a done
  // run is stored and the link reads the store again before the answer leaves.
  w.phone = (id, name) => {
    const c = { id, name, store: keyStore(memory()), got: [], pairs: [], run: null, sessions: 0 };
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
      getTicket: ticket(id),
      on: {
        message: (from, obj) => c.got.push({ from, obj }),
        session: () => c.sessions++,
        pair: (from, obj) => c.pairs.push({ from, obj }),
      },
    });
    c.drain = async () => {
      while (c.pairs.length) {
        const { from, obj } = c.pairs.shift();
        const r = c.run;
        if (!r || from !== r.peer) continue;
        const res = await r.receive(obj, from);
        if (r.state === 'done') await c.link.refresh();
        for (const body of res.send || []) await c.link.sendPair(from, body);
      }
    };
    c.scan = async code => {
      const key = await c.store.identity();
      c.run = scanPairing({ self: { id, ...key }, name, code, store: c.store, now: w.now });
      const first = await c.run.start();
      for (const body of first.send || []) await c.link.sendPair(c.run.peer, body);
    };
    w.phones.push(c);
    return c;
  };
  return w;
}

const PC = 'pc-0000aaaa';
const PH = 'ph-0123456789';

// ---- 1. a whole pairing ----
{
  const w = world();
  const pc = w.computer(PC, 'Desktop');
  const ph = w.phone(PH, 'Android phone');
  const shown = pc.link.phonePair();
  check(
    'P1 Add a phone gives a code to show',
    typeof shown.qr === 'string' && shown.qr.startsWith('TNAIPAIR1.'),
    shown
  );
  await w.settle();
  ph.link.hold(true);
  await ph.link.resume();
  await w.settle();
  await ph.scan(shown.qr);
  await w.advance(100);
  check('P2 the phone shows six digits', /^\d{6}$/.test(ph.run.shows || ''), ph.run.state);
  check(
    'P3 the computer waits for the digits',
    pc.link.phoneState().state === 'enter',
    pc.link.phoneState()
  );
  check('P4 nothing is stored on the computer yet', pc.store.pairing(PH) === null);
  const r = pc.link.phoneEnter(ph.run.shows);
  check('P5 the right digits are taken', r.ok === true, r);
  await w.advance(100);
  check(
    'P6 the phone stored the computer',
    ph.run.state === 'done' && (await ph.store.pairings()).some(p => p.id === PC)
  );
  const held = pc.store.pairing(PH);
  check(
    'P7 the computer stored the phone with its name',
    held && held.name === 'Android phone',
    held
  );
  check(
    'P8 the computer says it is paired',
    pc.paired.some(p => p.pid === PH) && pc.link.phoneState().state === 'idle'
  );
  await w.advance(15000);
  const sentPc = pc.link.send(PH, { t: 'hello-phone' });
  await w.advance(100);
  const sentPh = await ph.link.send(PC, { t: 'hello-computer' });
  await w.advance(100);
  check(
    'P9 an encrypted session stands: a message reaches the phone',
    sentPc === true && ph.got.some(g => g.obj.t === 'hello-phone'),
    ph.got
  );
  check(
    'P10 and one reaches the computer',
    sentPh === true && pc.got.some(g => g.obj.t === 'hello-computer'),
    pc.got
  );
}

// ---- 2. wrong digits ----
{
  const w = world();
  const pc = w.computer(PC, 'Desktop');
  const ph = w.phone(PH, 'Android phone');
  const shown = pc.link.phonePair();
  await w.settle();
  ph.link.hold(true);
  await ph.link.resume();
  await w.settle();
  await ph.scan(shown.qr);
  await w.advance(100);
  const wrong = String((Number(ph.run.shows) + 1) % 1000000).padStart(6, '0');
  const r1 = pc.link.phoneEnter(wrong);
  const r2 = pc.link.phoneEnter(wrong);
  const r3 = pc.link.phoneEnter(wrong);
  check(
    'W1 two wrong tries say how many are left',
    r1.ok === false && r1.left === 2 && r2.left === 1,
    [r1, r2]
  );
  check(
    'W2 the third ends the run with a ten-minute stop',
    !!r3.until && pc.link.phoneState().state === 'idle',
    r3
  );
  check('W3 nothing is stored', pc.store.pairing(PH) === null);
  const again = pc.link.phonePair();
  check(
    'W4 Add a phone stays stopped for ten minutes',
    again.ended === 'locked' && !again.qr,
    again
  );
}

// ---- 3. a stranger's proof, a cancel, the two minutes ----
{
  const w = world();
  const pc = w.computer(PC, 'Desktop');
  const ph = w.phone(PH, 'Android phone');
  const other = w.phone('ph-9999999999', 'Stranger');
  const shown = pc.link.phonePair();
  await w.settle();
  for (const p of [ph, other]) {
    p.link.hold(true);
    await p.link.resume();
  }
  await w.settle();
  await other.link.sendPair(PC, {
    t: 'phone',
    pub: Buffer.alloc(32, 7).toString('base64'),
    mac: Buffer.alloc(32, 1).toString('base64'),
  });
  await w.advance(100);
  check(
    'S1 a proof without the code changes nothing',
    pc.link.phoneState().state === 'wait',
    pc.link.phoneState()
  );
  pc.link.phoneCancel();
  check('S2 Cancel ends the run', pc.link.phoneState().state === 'idle');
  await ph.scan(shown.qr);
  await w.advance(100);
  check(
    'S3 the code of a cancelled run pairs nothing',
    !ph.run.shows && pc.store.pairing(PH) === null,
    ph.run.state
  );
  const late = pc.link.phonePair();
  await w.advance(2 * 60 * 1000 + 6000);
  check(
    'S4 after two minutes the run has ended by itself',
    pc.link.phoneState().state === 'idle' && pc.states.at(-1).reason === 'expired',
    pc.states.at(-1)
  );
  check('S5 (setup) the late run had a code', !!late.qr);
}

console.log(`pair-link: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
