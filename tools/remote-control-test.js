// Test of desktop/remote-control.js: node tools/remote-control-test.js (plain Node; also run it in
// Electron's Node). The control operations one paired computer may ask of another.
// Each check names the test of the design's list
// "Tests that must exist" it covers ("T7" is test 7). Stand-ins for everything the app hands in:
// the rights, the agents, the four deliveries (every call is counted), the sending, a clock and
// timers moved by hand. What is proven here is the checking core only; the tests that need the
// app's own delivery, a real CLI or the page are the wiring's.
const fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');
const rc = require('../desktop/remote-control.js');
const {
  createControl,
  promptText,
  fitsOne,
  roomLeft,
  fullText,
  fullShell,
  answerWay,
  withFull,
  readFull,
  bindingOf2,
  bindingFor,
  shapeReply,
  appStarted,
  firmKey,
  sameTicket,
} = rc;
const { fields, MAX_PLAIN } = require('../desktop/remote-noise.js');
const { shape } = require('../desktop/remote-api.js');
const { bindingOf } = require('../desktop/phone-answer.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const wire = m => JSON.parse(JSON.stringify(m)); // as a message arrives: JSON, nothing else

// odd characters are built from numbers, never written as escapes or as themselves
const ch = String.fromCharCode;
const ESC = ch(0x1b),
  ZW = ch(0x200b),
  RLO = ch(0x202e),
  FILLER = ch(0x3164),
  BOM = ch(0xfeff),
  NBSP = ch(0xa0),
  HINDI = ch(0x0915),
  FACE = ch(0xd83d, 0xde00);
const KEY = 'a'.repeat(40),
  OTHER = 'b'.repeat(40),
  NAMEKEY = 'n' + 'c'.repeat(40);
const P1 = 'terminal-1759999999999-ab12',
  P2 = 'terminal-1759999999999-cd34',
  P3 = 'terminal-1759999999999-ef56',
  P4 = 'terminal-1759999999999-gh78';
const SHELL = 'terminal-1759999999999-ps01',
  HAND = 'terminal-1759999999999-hd01',
  LOGIN = 'terminal-1759999999999-lg01';
const agent = (over = {}) => ({
  name: 'Moss',
  cli: 'Claude Code',
  mode: 'run',
  running: true,
  hand: false,
  instance: 'conv-1',
  pid: 4242,
  startedAt: 1699999990000,
  ...over,
});

// One computer B with two paired computers, A and C, both with the control switch on.
function world(random = crypto.randomBytes) {
  const w = {
    t: 1700000000000,
    timers: [],
    sent: [],
    logs: [],
    nn: 0,
    rights: { A: 'pair-1', C: 'pair-2' },
    live: { A: true, C: true },
    names: { A: 'Desk', C: 'Laptop' },
    agents: {
      [P1]: agent(),
      [P2]: agent({ name: 'Kite', instance: 'conv-2', pid: 4343 }),
      [P3]: agent({ name: 'Fern', cli: 'Codex', instance: 'conv-3', pid: 4444 }),
      [P4]: agent({ name: 'Reed', instance: 'conv-4', pid: 4545 }),
      [SHELL]: agent({ name: 'Terminal', cli: 'Terminal', instance: '', pid: 5001 }),
      [HAND]: agent({ name: 'Typed', hand: true, instance: 'conv-h', pid: 5002 }),
      [LOGIN]: agent({ name: 'Sign in', mode: 'login', instance: '', pid: 5003 }),
    },
    clis: ['Claude Code', 'Codex'],
    open: KEY,
    remote: 0,
    calls: { prompt: [], interrupt: [], stop: [], start: [], cancel: [] },
    say: { prompt: 'sent', interrupt: 'done', stop: 'done', start: 'started', cancel: undefined },
  };
  const timers = {
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
  const answer =
    k =>
    (...a) => {
      w.calls[k].push(a);
      const s = w.say[k];
      return typeof s === 'function' ? s(...a) : s;
    };
  w.control = createControl({
    rights: id => w.rights[id] ?? '',
    live: id => w.live[id] === true,
    peerName: id => w.names[id],
    agentNow: id => (Object.hasOwn(w.agents, id) ? w.agents[id] : null),
    clis: () => w.clis,
    openKey: () => w.open,
    remoteStarted: () => w.remote,
    send: (id, obj) => {
      w.sent.push({ peer: id, ...wire(obj) });
      return true;
    },
    log: e => {
      w.logs.push(e);
    },
    cancel: answer('cancel'),
    prompt: answer('prompt'),
    interrupt: answer('interrupt'),
    stop: answer('stop'),
    start: answer('start'),
    now: () => w.t,
    random,
    timers,
  });
  w.n = () => (++w.nn).toString(16).padStart(16, '0');
  const head = from => ({ n: w.n(), c: w.control.stamp(from), ms: 0 });
  w.prompt = (over = {}, from = 'A') => {
    const id = 'id' in over ? over.id : P1;
    return {
      t: 'prompt',
      ...head(from),
      id,
      to: w.control.ticketFor(from, id),
      text: 'Run the tests',
      ...over,
    };
  };
  w.act = (what, over = {}, from = 'A') => {
    const id = 'id' in over ? over.id : P1;
    return { t: 'act', ...head(from), id, to: w.control.ticketFor(from, id), do: what, ...over };
  };
  w.start = (over = {}, from = 'A') => ({
    t: 'start',
    ...head(from),
    cli: 'claude',
    project: KEY,
    ...over,
  });
  w.go = async (m, from = 'A') => {
    const a = w.sent.length,
      r = await w.control.receive(from, wire(m));
    return { r, back: w.sent.slice(a) };
  };
  w.advance = ms => {
    const end = w.t + ms;
    for (;;) {
      const due = w.timers.filter(h => h.at <= end).sort((x, y) => x.at - y.at)[0];
      if (!due) break;
      timers.clear(due);
      w.t = Math.max(w.t, due.at);
      due.fn();
    }
    w.t = end;
  };
  w.did = () =>
    w.calls.prompt.length + w.calls.interrupt.length + w.calls.stop.length + w.calls.start.length;
  return w;
}
const refusedAs = (x, type) =>
  !!x.r &&
  x.r.refused === true &&
  x.back.length === 1 &&
  x.back[0].t === type &&
  x.back[0].ok === false &&
  (type === 'started' ? x.back[0].why : x.back[0].state) === 'refused';
const tick = () => new Promise(r => setImmediate(r));

// A check that waits on a delivery that never answers would end the run early and quietly, with
// exit code 0: that is a failure.
let finished = false;
process.on('exit', () => {
  if (!finished) {
    console.log('ERROR the run ended before its last check (' + passed + ' passed until then)');
    process.exitCode = 1;
  }
});

(async () => {
  // ---- T1: a remote prompt starts with a word ----
  {
    const firsts = ['!', '/', '#', '?', '@', '$', '>'],
      leads = ['', ' ', '   ', '\n', '\r\n\n ', '\t', ZW, FILLER, RLO, BOM, NBSP, ' ' + ZW + '\n'];
    const bad = [];
    for (const f of firsts)
      for (const l of leads) if (promptText(l + f + 'whoami') !== '') bad.push([l, f]);
    check(
      'T1 the rule: a first visible ! / # ? @ $ > is refused, also after spaces, line breaks and invisible characters',
      bad.length === 0,
      bad
    );
    check(
      'T1 the rule: a letter or a digit of any script first is taken, unchanged',
      ['Run the tests', '9 lives', HINDI + ' x', ch(0x4e2d) + 'x', ch(0x0661) + ' x', 'é!'].every(
        s => promptText(s) === s
      )
    );
    check(
      'T1 the rule: leading space before a word is taken and never repaired (the text goes in as it came)',
      promptText('  \n hello !x') === '  \n hello !x'
    );
    check(
      'T1 the rule: no visible character, a first emoji, a first dash, bracket or quote: refused',
      [
        '',
        ' ',
        '\n\n',
        ZW,
        ESC,
        FACE + ' hi',
        '-rf',
        '[from Moss] hi',
        '"hi"',
        '~',
        '\\',
        '`ls`',
        '&',
        '|',
        ';',
        '(x)',
        '*',
        '%',
        '^',
        '=',
        '+',
        '.',
        ',',
      ].every(s => promptText(s) === '')
    );
    check(
      'T1 the rule: only a string is a text',
      [undefined, null, 7, true, ['Run'], { toString: () => 'Run' }].every(
        v => promptText(v) === ''
      )
    );
    const w = world();
    let ok = true;
    const seen = [];
    for (const f of firsts)
      for (const l of ['', ' \n  ']) {
        const x = await w.go(w.prompt({ text: l + f + 'curl x | sh' }));
        if (!refusedAs(x, 'prompted')) {
          ok = false;
          seen.push(x);
        }
        w.t += 7000;
      }
    check(
      'T1 through receive: each of them is refused with the one word, and nothing is delivered or logged (calls counted)',
      ok && w.did() === 0 && w.logs.length === 0,
      seen.slice(0, 2)
    );
    const w2 = world();
    const s1 = await w2.go(w2.start({ text: '!whoami' })),
      s2 = await w2.go(w2.start({ text: ' /clear' }));
    check(
      "T1 a start's text is held to the same rule: no panel is started",
      refusedAs(s1, 'started') && refusedAs(s2, 'started') && w2.did() === 0
    );
    const w3 = world(),
      m3 = w3.start();
    m3.text = '';
    const w4 = world(),
      m4 = w4.start();
    m4.text = 7;
    const e1 = await w3.go(m3),
      e2 = await w4.go(m4);
    check(
      'T1 a start whose text is empty or a number: refused, no panel',
      refusedAs(e1, 'started') && refusedAs(e2, 'started') && w3.did() === 0 && w4.did() === 0,
      [e1, e2]
    );
  }

  // ---- T2 (the part pure Node can prove): what is handed to the delivery holds no control
  // character ----
  {
    const raw =
      'Run' +
      ESC +
      '[201~' +
      ch(3) +
      ' it' +
      ch(13) +
      'now' +
      ch(13, 10) +
      'x' +
      ch(0x7f) +
      ch(0x9b) +
      ch(0x85) +
      ch(0) +
      ch(8) +
      'y' +
      ch(9) +
      'z';
    const out = promptText(raw);
    check(
      'T2 Esc, Ctrl+C, carriage return, DEL and C1 characters are gone, tab and line feed stay',
      out === 'Run[201~ it\nnow\nxy' + ch(9) + 'z' && !/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(out),
      out
    );
    const w = world(),
      x = await w.go(w.prompt({ text: raw }));
    check(
      'T2 the delivery gets exactly that text, once',
      x.r.taken === true && w.calls.prompt.length === 1 && w.calls.prompt[0][0].text === out
    );
    const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'prompt-submit.js'), 'utf8');
    check(
      'T2 the cleaning is still the one prompt-submit.js gives a paste (both replaces as written there)',
      // compared with every space and line end taken out, so the layout of the chain does not count
      src
        .replace(/\s+/g, '')
        .includes(".replace(/\\r\\n?/g,'\\n').replace(/[\\x00-\\x08\\x0b-\\x1f\\x7f-\\x9f]/g,'')")
    );
  }

  // ---- T3: the limit is bytes; refused or taken exactly at the limit, never shortened, never
  // split ----
  {
    const frame = text => ({
      t: 'prompt',
      n: '0123456789abcdef',
      id: P1,
      to: '0123456789abcdef',
      text,
    }); // the review's own message (probe 1)
    check(
      "T3 the review's numbers: its empty prompt message is 106 bytes, one message carries 4,094",
      Buffer.byteLength(JSON.stringify(frame(''))) === 106 &&
        MAX_PLAIN === 4094 &&
        roomLeft(frame('')) === 3988
    );
    check(
      'T3 3,988 letters fit, 3,989 do not',
      fitsOne(frame('a'.repeat(3988))) && !fitsOne(frame('a'.repeat(3989)))
    );
    check(
      'T3 1,329 Hindi letters fit, 1,330 do not',
      fitsOne(frame(HINDI.repeat(1329))) && !fitsOne(frame(HINDI.repeat(1330)))
    );
    check(
      'T3 50 line breaks cost 100 bytes: 3,888 letters with them fit, 3,889 do not',
      fitsOne(frame('a'.repeat(3888) + '\n'.repeat(50))) &&
        !fitsOne(frame('a'.repeat(3889) + '\n'.repeat(50)))
    );
    check(
      'T3 something that is no message does not fit',
      !fitsOne(undefined) && !fitsOne(() => 1) && !fitsOne({ n: 1n })
    );
    const w = world(),
      base = w.prompt({ text: '' }),
      room = roomLeft(base);
    const at = await w.go({ ...base, text: 'a'.repeat(room) });
    check(
      'T3 through receive: a message of exactly 4,094 bytes is taken and its text goes in whole, as one delivery',
      at.r.taken === true &&
        w.calls.prompt.length === 1 &&
        w.calls.prompt[0][0].text === 'a'.repeat(room) &&
        Buffer.byteLength(JSON.stringify({ ...base, text: 'a'.repeat(room) })) === 4094,
      at
    );
    const over = await w.go({ ...w.prompt({ text: '' }), text: 'a'.repeat(room + 1) });
    check(
      'T3 through receive: one byte more is refused, not shortened and not split',
      refusedAs(over, 'prompted') && w.calls.prompt.length === 1,
      over
    );
    const hi = w.prompt({ text: '' }),
      hiRoom = Math.floor(roomLeft(hi) / 3);
    const hOk = await w.go({ ...hi, text: 'a' + HINDI.repeat(hiRoom - 1) }),
      hNo = await w.go({ ...w.prompt({ text: '' }), text: 'a' + HINDI.repeat(hiRoom + 1) });
    check(
      'T3 through receive: counted in bytes, not characters (Hindi letters)',
      hOk.r.taken === true && refusedAs(hNo, 'prompted') && w.calls.prompt.length === 2
    );
    const empty = await w.go(w.prompt({ text: '' })),
      none = w.prompt();
    delete none.text;
    check(
      'T3 an empty text and a message without one are refused',
      refusedAs(empty, 'prompted') &&
        refusedAs(await w.go(none), 'prompted') &&
        w.calls.prompt.length === 2
    );
    const ws = world(),
      sBase = ws.start({ text: '' }),
      sRoom = roomLeft(sBase);
    const sNo = await ws.go({ ...sBase, text: 'a'.repeat(sRoom + 1) }),
      sOk = await ws.go({ ...ws.start({ text: '' }), text: 'a'.repeat(sRoom) });
    check(
      "T3 a start's text is held to the same byte limit",
      refusedAs(sNo, 'started') &&
        sOk.r.taken === true &&
        ws.calls.start.length === 1 &&
        ws.calls.start[0][0].text.length === sRoom
    );
  }

  // ---- T7: only a panel the app itself started as an agent ----
  {
    check(
      'T7 the rule: an app-started agent passes; a Terminal, a typed CLI, a sign-in run, a stopped process and half a record do not',
      appStarted(agent()) &&
        [
          agent({ cli: 'Terminal' }),
          agent({ hand: true }),
          agent({ hand: undefined }),
          agent({ mode: 'login' }),
          agent({ running: false }),
          agent({ pid: 0 }),
          agent({ startedAt: 0 }),
          agent({ cli: '' }),
          null,
          undefined,
          'x',
          {},
        ].every(a => !appStarted(a))
    );
    const w = world();
    check(
      'T7 a PowerShell panel, a PowerShell panel with a typed CLI and a sign-in run get no ticket for their row',
      [SHELL, HAND, LOGIN].every(id => w.control.ticketFor('A', id) === '') &&
        /^[0-9a-f]{16}$/.test(w.control.ticketFor('A', P1))
    );

    // An old ticket: what each panel had while an app-started agent ran in it.
    const old = {};
    for (const id of [SHELL, HAND, LOGIN]) {
      const now = w.agents[id];
      w.agents[id] = agent({ pid: now.pid, instance: 'conv-old' });
      old[id] = w.control.ticketFor('A', id);
      w.agents[id] = now;
    }
    check(
      'T7 (the old tickets are real ones)',
      Object.values(old).every(v => /^[0-9a-f]{16}$/.test(v))
    );
    let ok = true;
    const odd = [];
    for (const id of [SHELL, HAND, LOGIN])
      for (const to of ['f'.repeat(16), old[id], w.control.ticketFor('A', P1)]) {
        for (const m of [
          w.prompt({ id, to }),
          w.act('interrupt', { id, to }),
          w.act('stop', { id, to }),
        ]) {
          const x = await w.go(m);
          if (!refusedAs(x, m.t === 'prompt' ? 'prompted' : 'acted')) {
            ok = false;
            odd.push([id, to, x]);
          }
          w.t += 16000;
        }
      }
    check(
      "T7 prompt, interrupt and stop for them with a forged, an old or another agent's ticket are refused; stop and write are never called (27 messages, calls counted)",
      ok && w.did() === 0 && w.calls.stop.length === 0 && w.logs.length === 0,
      odd.slice(0, 2)
    );
    w.t += 61000;
    const real = [
      await w.go(w.prompt()),
      await w.go(w.act('interrupt')),
      await w.go(w.act('stop')),
    ];
    check(
      'T7 the same three for an app-started agent with its ticket are taken, each delivered once',
      real.every(x => x.r.taken === true) &&
        w.calls.prompt.length === 1 &&
        w.calls.interrupt.length === 1 &&
        w.calls.stop.length === 1 &&
        w.calls.stop[0][0] === P1
    );
    w.t += 61000;
    const noTo = w.prompt();
    delete noTo.to;
    const bad = [
      await w.go(w.prompt({ to: '' })),
      await w.go(noTo),
      await w.go(w.prompt({ to: ['x'] })),
      await w.go(w.prompt({ to: w.control.ticketFor('A', P1).toUpperCase() })),
      await w.go(w.prompt({ to: w.control.ticketFor('A', P2) })),
      await w.go(w.prompt({ to: w.control.ticketFor('C', P1) })),
    ];
    check(
      "T7 no ticket, one of another shape, another agent's and another computer's ticket for it: refused",
      bad.every(x => refusedAs(x, 'prompted')) && w.calls.prompt.length === 1
    );
    w.t += 61000;
    const ids = [
      await w.go(w.prompt({ id: P1 + ' ', to: w.control.ticketFor('A', P1) })),
      await w.go(w.prompt({ id: P1 + ZW, to: w.control.ticketFor('A', P1) })),
      await w.go(w.prompt({ id: '', to: 'f'.repeat(16) })),
      await w.go(w.prompt({ id: '__proto__', to: 'f'.repeat(16) })),
      await w.go(w.prompt({ id: 'x'.repeat(81), to: 'f'.repeat(16) })),
      await w.go(w.prompt({ id: { toString: () => P1 }, to: w.control.ticketFor('A', P1) })),
      await w.go(w.prompt({ id: 'no-such-panel', to: 'f'.repeat(16) })),
    ];
    check(
      'T7 a row id that cleaning would change, an empty, unknown or odd one: refused, the agent is not even asked for by another id',
      ids.every(x => refusedAs(x, 'prompted')) && w.calls.prompt.length === 1
    );
  }

  // ---- T8: a typed CLI, or any agent, that ends between the list and the message ----
  {
    const w = world(),
      to = w.control.ticketFor('A', P1);
    w.agents[P1] = null; // the panel has no process any more
    const a = [
      await w.go(w.prompt({ to })),
      await w.go(w.act('stop', { to })),
      await w.go(w.act('interrupt', { to })),
    ];

    // a shell sits in that panel now
    w.agents[P1] = agent({ name: 'Terminal', cli: 'Terminal', instance: 'conv-1', pid: 7001 });
    const b = [await w.go(w.prompt({ to })), await w.go(w.act('stop', { to }))];
    w.agents[P1] = agent({ running: false }); // the same agent, stopped
    const c = [await w.go(w.prompt({ to })), await w.go(w.act('stop', { to }))];
    check(
      'T8 the agent ended, a shell took its panel, or it stopped, after its row was sent: refused, nothing written to the shell (calls counted)',
      [...a, ...b, ...c].every(
        x => x.r.refused === true && x.back.length === 1 && x.back[0].ok === false
      ) && w.did() === 0
    );
    const w2 = world();
    w2.agents[HAND] = agent({ instance: 'conv-h', pid: 5002 });
    const had = w2.control.ticketFor('A', HAND);

    // the typed CLI ended: the same pid is the PowerShell
    w2.agents[HAND] = agent({ name: 'Terminal', cli: 'Terminal', instance: 'conv-h', pid: 5002 });
    check(
      'T8 the same process id is not enough: the PowerShell a CLI ran in gets nothing',
      refusedAs(await w2.go(w2.prompt({ id: HAND, to: had })), 'prompted') && w2.did() === 0
    );
    let asked = 0;
    const w3 = world(),
      keep = w3.agents[P1];
    Object.defineProperty(w3.agents, P1, {
      get() {
        asked++;
        return keep;
      },
    });
    const m3 = w3.prompt({ to: 'f'.repeat(16) }),
      before = asked;
    await w3.go(m3);
    check(
      'T8 the agent is asked for at the moment of the message, not taken from an earlier answer',
      asked > before
    );
  }

  // ---- T9: the ticket ----
  {
    const w = world(),
      base = w.control.ticketFor('A', P1),
      again = () => w.control.ticketFor('A', P1),
      set = over => {
        w.agents[P1] = agent(over);
        return again();
      };
    check(
      'T9 16 hex characters, and the same while nothing changed',
      /^[0-9a-f]{16}$/.test(base) && again() === base
    );
    check('T9 it changes on a rename', set({ name: 'Moss 2' }) !== base);
    check('T9 it changes on a new conversation in the panel', set({ instance: 'conv-9' }) !== base);
    check(
      'T9 it changes on a restart of the same conversation (another process)',
      set({ pid: 4999 }) !== base && set({ startedAt: 1699999999999 }) !== base
    );
    check('T9 it changes on a switch of connection', set({ cli: 'Codex' }) !== base);
    check(
      'T9 a row without a conversation id gets none',
      set({ instance: '' }) === '' &&
        set({ instance: undefined }) === '' &&
        set({ instance: 7 }) === ''
    );
    check(
      'T9 back as it was, it is the same again (it is a function of what the panel runs)',
      set({}) === base
    );
    w.rights.A = 'pair-9';
    check('T9 it changes on a new pairing', again() !== base && /^[0-9a-f]{16}$/.test(again()));
    w.rights.A = 'pair-1';
    check(
      'T9 another computer gets another ticket for the same agent',
      w.control.ticketFor('C', P1) !== base && w.control.ticketFor('C', P1) !== ''
    );
    check(
      "T9 this computer's own restart ends it: a new start makes a new key",
      world().control.ticketFor('A', P1) !== base
    );
    const fixed = () => Buffer.alloc(32, 7);
    check(
      'T9 (the key is all that differs: two starts handed the same bytes agree)',
      world(fixed).control.ticketFor('A', P1) === world(fixed).control.ticketFor('A', P1)
    );
    const a = agent(),
      parts = [
        'tnai-agent-v1',
        'pair-1',
        'A',
        P1,
        a.instance,
        a.name,
        a.cli,
        String(a.pid),
        String(a.startedAt),
      ];
    const guesses = [
      crypto
        .createHash('sha256')
        .update(fields(...parts))
        .digest('hex')
        .slice(0, 16),
      crypto
        .createHmac('sha256', Buffer.alloc(32))
        .update(fields(...parts))
        .digest('hex')
        .slice(0, 16),
      crypto
        .createHmac('sha256', 'pair-1')
        .update(fields(...parts))
        .digest('hex')
        .slice(0, 16),
      crypto
        .createHash('sha256')
        .update(fields('tnai-agent-v1', 'pair-1', P1, a.instance, a.name, a.cli))
        .digest('hex')
        .slice(0, 16),
    ];
    check(
      'T9 the other computer cannot work one out from its row: a plain hash of every field, or a keyed one under a known key, is not it',
      guesses.every(g => g !== base)
    );
    check(
      'T9 the key is not handed out: nothing the file or a control gives away holds it',
      Object.values(rc).every(v => !Buffer.isBuffer(v) && !(v instanceof Uint8Array)) &&
        Object.values(w.control).every(v => typeof v === 'function')
    );
    check(
      'T9 the switch off, an unknown computer or panel: no ticket',
      (() => {
        const x = world();
        x.rights.A = '';
        return (
          x.control.ticketFor('A', P1) === '' &&
          x.control.ticketFor('Z', P1) === '' &&
          x.control.ticketFor('C', 'nope') === '' &&
          x.control.ticketFor(null, P1) === '' &&
          x.control.ticketFor('C', null) === ''
        );
      })()
    );
    check(
      'T9 the compare takes two tickets of the right form only',
      sameTicket(base, base) &&
        !sameTicket(base, base.slice(0, 15) + (base[15] === '0' ? '1' : '0')) &&
        !sameTicket(base, '') &&
        !sameTicket('', '') &&
        !sameTicket(base, base + 'a') &&
        !sameTicket(undefined, base) &&
        !sameTicket([base], base)
    );
    for (const [what, change] of [
      ['rename', { name: 'Other' }],
      ['new conversation', { instance: 'conv-x' }],
      ['restart', { pid: 4888, startedAt: 1700000000001 }],
      ['another connection', { cli: 'Codex' }],
    ]) {
      const x = world(),
        to = x.control.ticketFor('A', P1);
      x.agents[P1] = agent(change);
      const r = [await x.go(x.prompt({ to })), await x.go(x.act('stop', { to }))];
      check(
        'T9 through receive: after a ' +
          what +
          ' the old ticket is refused for a prompt and a stop',
        refusedAs(r[0], 'prompted') && refusedAs(r[1], 'acted') && x.did() === 0
      );
    }
    const x = world(),
      to = x.control.ticketFor('A', P1);
    x.rights.A = 'pair-2b';
    check(
      'T9 through receive: after a new pairing the old ticket is refused',
      refusedAs(await x.go(x.prompt({ to })), 'prompted') && x.did() === 0
    );
  }

  // ---- T10: the switch is off ----
  {
    for (const off of ['', undefined, true, { id: 'pair-1' }, 0]) {
      const w = world(),
        to = w.control.ticketFor('A', P1);
      w.rights.A = off;
      const r = [
        await w.go(w.prompt({ to })),
        await w.go(w.act('interrupt', { to })),
        await w.go(w.act('stop', { to })),
        await w.go(w.start()),
        await w.go(w.start({ text: 'Fix it' })),
      ];
      check(
        'T10 switch off (rights give ' +
          JSON.stringify(off) +
          '): a prompt, an interrupt, a stop and a start get no reply, nothing is done, no log line',
        r.every(x => x.r.silent === 'off' && x.back.length === 0) &&
          w.did() === 0 &&
          w.logs.length === 0 &&
          w.sent.length === 0,
        r.map(x => x.r)
      );
    }
    const w = world();
    w.control = createControl({ now: () => w.t }); // nothing handed in at all
    const r = [
      w.control.receive('A', { t: 'prompt', n: '0'.repeat(16) }),
      w.control.receive('A', { t: 'start', n: '0'.repeat(16) }),
    ];
    check(
      'T10 a control that was handed nothing does nothing (every missing answer reads as the refusing one)',
      r.every(x => x.silent === 'off') && w.control.ticketFor('A', P1) === ''
    );
    const th = world();
    th.control = createControl({
      rights: () => {
        throw new Error('store broke');
      },
      send: () => {
        th.sent.push(1);
      },
      now: () => th.t,
    });
    check(
      'T10 rights that cannot be read are "off", and nothing is thrown out of receive',
      th.control.receive('A', { t: 'act', n: '0'.repeat(16), do: 'stop' }).silent === 'off' &&
        th.sent.length === 0
    );
  }

  // ---- T11 (the core's part): the switch goes off with prompts already held ----
  {
    const w = world();
    w.say.prompt = 'queued';
    const a = await w.go(w.prompt()),
      b = await w.go(w.prompt({ id: P2 })),
      c = await w.go(w.prompt({ id: P3 })),
      other = await w.go(w.prompt({ id: P4 }, 'C'), 'C');
    check(
      'T11 (three prompts of A and one of C are held, each told "queued")',
      [a, b, c, other].every(
        x =>
          x.r.state === 'queued' &&
          x.back.length === 1 &&
          x.back[0].ok === true &&
          x.back[0].state === 'queued'
      ) && w.control.held().length === 4
    );
    w.rights.A = '';
    const sentBefore = w.sent.length,
      n = w.control.dropAll('A');
    check(
      "T11 dropAll removes each of that computer's at once and through cancel",
      n === 3 &&
        w.calls.cancel.length === 3 &&
        w.calls.cancel.map(x => x[0]).join() ===
          w.calls.prompt
            .slice(0, 3)
            .map(x => x[0].key)
            .join() &&
        w.control.held().length === 1 &&
        w.control.held()[0].peerId === 'C'
    );
    check(
      'T11 the other computer is told "failed" once for each',
      w.sent.length === sentBefore + 3 &&
        w.sent
          .slice(sentBefore)
          .every(
            m => m.peer === 'A' && m.t === 'prompted' && m.ok === false && m.state === 'failed'
          ) &&
        w.sent
          .slice(sentBefore)
          .map(m => m.n)
          .join() === [a, b, c].map(x => x.back[0].n).join()
    );
    check(
      'T11 nothing of them is ever written: every guard says no from now on, also with the switch back on',
      (() => {
        const g = w.calls.prompt.slice(0, 3).map(x => x[0].guard());
        w.rights.A = 'pair-1';
        return [...g, ...w.calls.prompt.slice(0, 3).map(x => x[0].guard())].every(v => v === false);
      })()
    );
    const quiet = w.sent.length;
    w.calls.prompt[0][0].done('sent');
    w.calls.prompt[1][0].done('failed');
    check(
      'T11 a late word from the delivery for a removed prompt changes nothing and is not sent on',
      w.sent.length === quiet
    );
    check(
      "T11 the other computer's held prompt is untouched and may still be written",
      w.calls.prompt[3][0].guard() === true && w.control.dropAll('A') === 0
    );
    check(
      'T11 one "dropped" line per removed prompt beside its taken line',
      w.logs.filter(e => e.op === 'dropped' && e.peerId === 'A').length === 3 &&
        w.logs.filter(e => e.op === 'prompt').length === 4
    );
  }

  // ---- T12 (the core's part): the guard, asked again at the write ----
  {
    const cases = [
      [
        'the panel was restarted',
        w => {
          w.agents[P1] = agent({ pid: 4999, startedAt: 1700000000500 });
        },
      ],
      [
        'its connection was changed',
        w => {
          w.agents[P1] = agent({ cli: 'Codex' });
        },
      ],
      [
        'a new conversation was started in it',
        w => {
          w.agents[P1] = agent({ instance: 'conv-2b' });
        },
      ],
      [
        'it was renamed',
        w => {
          w.agents[P1] = agent({ name: 'Elm' });
        },
      ],
      [
        'a shell took the panel',
        w => {
          w.agents[P1] = agent({ cli: 'Terminal' });
        },
      ],
      [
        'its process ended',
        w => {
          w.agents[P1] = null;
        },
      ],
      [
        'the agent stopped',
        w => {
          w.agents[P1] = agent({ running: false });
        },
      ],
      [
        'the switch went off',
        w => {
          w.rights.A = '';
        },
      ],
      [
        'the pairing changed',
        w => {
          w.rights.A = 'pair-1b';
        },
      ],
      [
        'the session ended',
        w => {
          w.live.A = false;
        },
      ],
      [
        '10 minutes passed',
        w => {
          w.t += rc.HELD_MS;
        },
      ],
    ];
    for (const [what, change] of cases) {
      const w = world();
      w.say.prompt = 'queued';
      const x = await w.go(w.prompt()),
        d = w.calls.prompt[0][0],
        first = d.guard();
      change(w);
      const sentBefore = w.sent.length,
        second = d.guard(),
        third = d.guard();
      check(
        'T12 a held prompt when ' +
          what +
          ': the guard says no, it is dropped, "failed" goes out once, one log line',
        x.r.state === 'queued' &&
          first === true &&
          second === false &&
          third === false &&
          w.sent.length === sentBefore + 1 &&
          w.sent.at(-1).state === 'failed' &&
          w.sent.at(-1).n === x.back[0].n &&
          w.logs.filter(e => e.op === 'dropped').length === 1 &&
          w.control.held().length === 0 &&
          w.calls.cancel.length === 0,
        { first, second, sent: w.sent.slice(sentBefore) }
      );
    }
    const w = world();
    w.say.prompt = 'queued';
    const x = await w.go(w.prompt()),
      d = w.calls.prompt[0][0];
    check(
      "T12 the delivery is handed the cleaned text, the computer's name as the source, a guard and nothing else of the message",
      Object.keys(d).sort().join() === 'done,from,guard,key,panelId,peerId,tail,text' &&
        d.tail ===
          '' /* tail: this computer's own words for files that came with a prompt (remote-attachments.md); empty for a plain prompt */ &&
        d.from === 'Desk' &&
        d.panelId === P1 &&
        d.peerId === 'A' &&
        d.text === 'Run the tests' &&
        !JSON.stringify(d).includes(x.back[0].n)
    );
    const before = w.sent.length;
    const ok = d.guard();
    d.done('sent');
    check(
      'T12 while nothing changed the guard says yes; when the delivery then reports it written, "sent" follows for the same n and it is no longer held',
      ok === true &&
        w.sent.length === before + 1 &&
        w.sent.at(-1).ok === true &&
        w.sent.at(-1).state === 'sent' &&
        w.sent.at(-1).n === x.back[0].n &&
        w.control.held().length === 0 &&
        d.guard() === false
    );
    d.done('sent');
    d.done('failed');
    check('T12 a second word for the same prompt is not sent', w.sent.length === before + 1);
    const w2 = world();
    let inside = null;
    w2.say.prompt = a => {
      inside = a.guard();
      return 'sent';
    };
    await w2.go(w2.prompt());
    check(
      'T12 a prompt written at once: the guard holds in the turn of the call, and not after it ended',
      inside === true && w2.calls.prompt[0][0].guard() === false && w2.control.held().length === 0
    );
  }

  // ---- T13: how many are held, and for how long ----
  {
    const w = world();
    w.say.prompt = 'queued';
    const first = [await w.go(w.prompt()), await w.go(w.prompt()), await w.go(w.prompt())],
      fourth = await w.go(w.prompt());
    check(
      'T13 the fourth held prompt for one panel is refused',
      first.every(x => x.r.state === 'queued') &&
        refusedAs(fourth, 'prompted') &&
        w.calls.prompt.length === 3 &&
        w.control.held().length === 3
    );
    check(
      "T13 another computer's prompt for that panel is refused too: three is the panel's bound",
      refusedAs(await w.go(w.prompt({}, 'C'), 'C'), 'prompted') && w.calls.prompt.length === 3
    );
    w.t += 61000;
    for (const id of [P2, P2, P2, P3, P3, P3, P4]) await w.go(w.prompt({ id }));
    w.t += 61000;
    const eleventh = await w.go(w.prompt({ id: P4 }));
    check(
      'T13 the eleventh held prompt of one computer is refused',
      w.control.held().filter(h => h.peerId === 'A').length === 10 &&
        refusedAs(eleventh, 'prompted') &&
        w.calls.prompt.length === 10
    );
    const fromC = await w.go(w.prompt({ id: P4 }, 'C'), 'C');
    check(
      "T13 that bound is per computer: another computer's prompt for a panel with room is taken",
      fromC.r.state === 'queued' && w.calls.prompt.length === 11
    );
    const sentBefore = w.sent.length;
    w.advance(rc.HELD_MS - 122000 - 1);
    check(
      'T13 just under 10 minutes after the first: all still held',
      w.control.held().length === 11 && w.sent.length === sentBefore
    );
    w.advance(1);
    check(
      'T13 at 10 minutes the first three are dropped: removed through cancel, "failed" sent, one log line each',
      w.control.held().length === 8 &&
        w.calls.cancel.length === 3 &&
        w.sent.length === sentBefore + 3 &&
        w.sent
          .slice(sentBefore)
          .every(m => m.t === 'prompted' && m.ok === false && m.state === 'failed') &&
        w.logs.filter(e => e.op === 'dropped').length === 3
    );
    w.advance(rc.HELD_MS);
    check(
      'T13 and every other one at its own 10 minutes; no timer is left and no guard says yes',
      w.control.held().length === 0 &&
        w.calls.cancel.length === 11 &&
        w.timers.length === 0 &&
        w.calls.prompt.every(c => c[0].guard() === false)
    );
    const again = await w.go(w.prompt());
    check(
      'T13 with room again a prompt is taken',
      again.r.state === 'queued' && w.control.held().length === 1
    );
    w.control.stop();
    check(
      'T13 stop leaves no timer, drops what is held without a message, and takes nothing more',
      w.timers.length === 0 &&
        w.control.held().length === 0 &&
        w.calls.prompt.at(-1)[0].guard() === false &&
        w.control.receive('A', wire(w.prompt())).ignored === true
    );
    const w2 = world();
    w2.say.prompt = 'sent';
    for (let i = 0; i < 9; i++) await w2.go(w2.prompt());
    check(
      'T13 a prompt that was written is not held: nine in a row for one panel are all taken, and no timer stays',
      w2.calls.prompt.length === 9 && w2.control.held().length === 0 && w2.timers.length === 0
    );
  }

  // ---- T14: at most once, the rates, and silence past them ----
  {
    const w = world(),
      m = w.prompt();
    const one = await w.go(m),
      two = await w.go(m);
    check(
      'T14 the same n twice in one session: one delivery, the second is refused',
      one.r.taken === true &&
        refusedAs(two, 'prompted') &&
        w.calls.prompt.length === 1 &&
        w.logs.length === 1
    );

    // a new session: a new list, a new stamp, the same message again
    const later = await w.go({ ...m, c: w.control.stamp('A') });
    const asAct = await w.go({ ...w.act('stop'), n: m.n }),
      asStart = await w.go({ ...w.start(), n: m.n });
    check(
      'T14 the same n after a new session, or on a message of another type: still one delivery',
      refusedAs(later, 'prompted') &&
        refusedAs(asAct, 'acted') &&
        refusedAs(asStart, 'started') &&
        w.did() === 1
    );
    const fromC = await w.go({ ...w.prompt({}, 'C'), n: m.n }, 'C');
    check(
      'T14 the memory is per computer: another computer may use that number',
      fromC.r.taken === true && w.calls.prompt.length === 2
    );
    w.t += rc.N_MS - 1;
    const held = await w.go({ ...w.prompt(), n: m.n });
    check(
      'T14 a taken n is remembered for 10 minutes',
      refusedAs(held, 'prompted') && w.calls.prompt.length === 2
    );

    const p = world();
    const got = [];
    for (let i = 0; i < 10; i++) got.push(await p.go(p.prompt()));
    const past = [
      await p.go(p.prompt()),
      await p.go(p.prompt({ text: '!x' })),
      await p.go({ t: 'prompt' }),
    ];
    check(
      'T14 ten prompts in a minute are taken; the eleventh, good or bad, gets no reply and nothing is done',
      got.every(x => x.r.taken === true) &&
        past.every(x => x.r.silent === 'limit' && x.back.length === 0) &&
        p.calls.prompt.length === 10 &&
        p.sent.length === 10 &&
        p.logs.length === 10
    );
    const actStill = await p.go(p.act('interrupt')),
      cStill = await p.go(p.prompt({}, 'C'), 'C');
    check(
      'T14 each kind and each computer has its own count: an interrupt of A and a prompt of C are still taken',
      actStill.r.taken === true && cStill.r.taken === true
    );
    p.t += 60000;
    check('T14 a minute later prompts are taken again', (await p.go(p.prompt())).r.taken === true);

    const a = world();
    const acts = [
      await a.go(a.act('interrupt')),
      await a.go(a.act('stop')),
      await a.go(a.act('interrupt', { id: P2 })),
      await a.go(a.act('stop', { id: P2 })),
    ];
    const fifth = await a.go(a.act('stop', { id: P3 }));
    check(
      'T14 four interrupts or stops in a minute, counted together; the fifth gets no reply and no stop',
      acts.every(x => x.r.taken === true) &&
        fifth.r.silent === 'limit' &&
        fifth.back.length === 0 &&
        a.calls.stop.length === 2 &&
        a.calls.interrupt.length === 2
    );

    const s = world();
    const starts = [await s.go(s.start()), await s.go(s.start()), await s.go(s.start())],
      fourth = await s.go(s.start());
    check(
      'T14 three starts in a minute; the fourth gets no reply and no panel',
      starts.every(x => x.r.taken === true) &&
        fourth.r.silent === 'limit' &&
        fourth.back.length === 0 &&
        s.calls.start.length === 3
    );
    s.t += 61000;
    const more = [
      await s.go(s.start({ cli: 'nope' })),
      await s.go(s.start({ cli: 'nope' })),
      await s.go(s.start({ cli: 'nope' })),
    ];
    s.t += 61000;
    const seventh = await s.go(s.start());
    check(
      'T14 six starts in 10 minutes, refused ones counted; the seventh gets no reply although its own minute is empty',
      more.every(x => refusedAs(x, 'started')) &&
        seventh.r.silent === 'limit' &&
        seventh.back.length === 0 &&
        s.calls.start.length === 3
    );
    s.t += 10 * 60000;
    check(
      'T14 after the 10 minutes a start is taken again',
      (await s.go(s.start())).r.taken === true && s.calls.start.length === 4
    );

    // A message of the wrong shape counts.
    const b = world();
    const junk = [
      { t: 'prompt' },
      { t: 'prompt', n: 7 },
      { t: 'prompt', n: 'xyz' },
      { t: 'prompt', n: '0123456789ABCDEF' },
      { t: 'prompt', n: '0'.repeat(17) },
      { t: 'prompt', n: ['0'.repeat(16)] },
      { t: 'prompt', n: null, id: P1 },
      { t: 'prompt', text: 'x' },
      { t: 'prompt', n: '' },
      { t: 'prompt', n: {} },
    ];
    const jr = [];
    for (const m2 of junk) jr.push(await b.go(m2));
    const good = await b.go(b.prompt());
    check(
      'T14 a message without a usable n gets no reply (there is nobody to tell), and it counts: after ten of them a good prompt is past the limit',
      jr.every(x => x.r.silent === 'shape' && x.back.length === 0) &&
        good.r.silent === 'limit' &&
        b.did() === 0 &&
        b.sent.length === 0
    );
    check(
      'T14 and the flood of one computer does not silence another',
      (await b.go(b.prompt({}, 'C'), 'C')).r.taken === true
    );
    const o = world();
    const odd = [
      null,
      undefined,
      7,
      'prompt',
      [],
      { t: 'answer' },
      { t: 'needs' },
      { t: 'constructor' },
      { t: '__proto__' },
      { t: ['prompt'] },
      {},
    ].map(m2 => o.control.receive('A', m2));
    const peerOdd = [
      o.control.receive('', o.prompt()),
      o.control.receive(null, o.prompt()),
      o.control.receive({ toString: () => 'A' }, o.prompt()),
    ];
    check(
      "T14 what is not one of the three types, or comes with no computer id, is not this file's: nothing done, nothing sent, nothing thrown",
      [...odd, ...peerOdd].every(r => r.ignored === true) && o.did() === 0 && o.sent.length === 0
    );
    const proto = world();
    proto.rights = Object.assign(Object.create(null), { ['__proto__']: 'pair-x' });
    const pr = proto.control.receive('__proto__', {
      t: 'prompt',
      n: '0'.repeat(16),
      c: proto.control.stamp('__proto__'),
      ms: 0,
      id: P1,
      to: 'f'.repeat(16),
      text: 'Run',
    });
    check(
      'T14 a computer id that is a built-in property name is only a key of a Map: refused like any other, nothing thrown',
      pr.refused === true && proto.did() === 0
    );
    const sync = world();
    sync.control.receive('A', wire(sync.prompt()));
    check(
      'T14 nothing waits between the checks and the delivery: it was called before receive returned',
      sync.calls.prompt.length === 1
    );
  }

  // ---- T15: what a start is refused for ----
  {
    const tryStart = async (setup, over) => {
      const w = world();
      setup(w);
      const m = w.start(over);
      for (const k of Object.keys(over || {})) if (over[k] === undefined) delete m[k];
      const x = await w.go(m);
      return refusedAs(x, 'started') && w.did() === 0 && w.logs.length === 0;
    };
    check(
      'T15 (the control: with the project open, its key known and the CLI ready, a start is taken)',
      await (async () => {
        const w = world(),
          x = await w.go(w.start());
        return (
          x.r.taken === true &&
          x.back.length === 1 &&
          x.back[0].t === 'started' &&
          x.back[0].ok === true &&
          w.calls.start.length === 1
        );
      })()
    );
    check(
      'T15 no folder open on this computer: refused, no panel',
      await tryStart(w => {
        w.open = '';
      })
    );
    check(
      'T15 its key not known yet: refused',
      (await tryStart(w => {
        w.open = undefined;
      })) &&
        (await tryStart(w => {
          w.open = null;
        }))
    );
    check(
      'T15 an empty key never equals an empty key',
      (await tryStart(
        w => {
          w.open = '';
        },
        { project: '' }
      )) &&
        (await tryStart(
          w => {
            w.open = undefined;
          },
          { project: undefined }
        ))
    );
    check(
      'T15 a name-form key, on both sides and equal: refused (a folder without git cannot be started in)',
      (await tryStart(
        w => {
          w.open = NAMEKEY;
        },
        { project: NAMEKEY }
      )) &&
        (await tryStart(() => {}, { project: NAMEKEY })) &&
        (await tryStart(w => {
          w.open = NAMEKEY;
        }))
    );
    check(
      'T15 another key: refused',
      (await tryStart(() => {}, { project: OTHER })) &&
        (await tryStart(w => {
          w.open = OTHER;
        }))
    );
    check(
      'T15 a key of another form (upper case, a path, a number, a list): refused',
      (await tryStart(() => {}, { project: KEY.toUpperCase() })) &&
        (await tryStart(() => {}, { project: 'C:\\Users\\x' })) &&
        (await tryStart(() => {}, { project: 7 })) &&
        (await tryStart(() => {}, { project: [KEY] })) &&
        (await tryStart(() => {}, { project: KEY + ' ' }))
    );
    check(
      'T15 a CLI that is not installed or signed in here: refused',
      (await tryStart(() => {}, { cli: 'opencode' })) &&
        (await tryStart(w => {
          w.clis = [];
        })) &&
        (await tryStart(w => {
          w.clis = null;
        })) &&
        (await tryStart(w => {
          w.clis = 'Claude Code';
        }))
    );
    const words = [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
      'valueOf',
      'Claude Code',
      'CLAUDE',
      'claude ',
      'claudecode',
      'terminal',
      'powershell',
      '',
      7,
      ['claude'],
      { toString: () => 'claude' },
      null,
      undefined,
    ];
    let allRefused = true;
    for (const cli of words)
      if (
        !(await tryStart(
          w => {
            // even if the list of ready CLIs held what a plain lookup of such a word gives
            w.clis = [
              'Claude Code',
              'Codex',
              'OpenCode',
              'Cursor Agent',
              'constructor',
              'toString',
              Object,
              Object.prototype.toString,
              Object.prototype.hasOwnProperty,
              Object.prototype.valueOf,
              Object.prototype,
            ];
          },
          { cli }
        ))
      )
        allRefused = false;
    check(
      'T15 "constructor" and every word that is not one of the four: refused, no panel',
      allRefused
    );
    check(
      'T15 a key that cannot be read (openKey throws) is "not known"',
      await tryStart(w => {
        Object.defineProperty(w, 'open', {
          get() {
            throw new Error('git broke');
          },
        });
      })
    );
    const w = world();
    w.clis = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent'];
    const each = [];
    for (const [word, name] of [
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
      ['opencode', 'OpenCode'],
    ]) {
      await w.go(
        w.start({
          cli: word,
          model: 'opus',
          effort: 'max',
          name: 'Evil',
          cwd: 'C:\\',
          args: ['--dangerously'],
          access: 'full',
        })
      );
      each.push(w.calls.start.at(-1)[0].cli === name);
    }
    const arg = w.calls.start[0][0];
    check(
      "T15 the delivery gets the CLI's name from the fixed list, and nothing else of the message: no model, effort, name, folder or argument",
      each.every(Boolean) &&
        Object.keys(arg).sort().join() === 'cli,from,guard,peerId,text' &&
        arg.text === '' &&
        arg.from === 'Desk' &&
        !/opus|max|Evil|dangerously|full/.test(JSON.stringify(w.calls.start))
    );
    check(
      'T15 firmKey is the first-commit form only',
      firmKey(KEY) === KEY &&
        firmKey('f'.repeat(64)) === 'f'.repeat(64) &&
        [NAMEKEY, '', KEY.slice(1), KEY + 'a', KEY.toUpperCase(), null, undefined, 7, [KEY]].every(
          v => firmKey(v) === ''
        )
    );
  }

  // ---- T16 (the core's part) and T20: the start's guard, asked again after the wait ----
  {
    const w = world();
    let opened = null;
    w.say.start = a =>
      new Promise(res => {
        opened = { a, res };
      });
    const pending = w.control.receive('A', wire(w.start({ text: 'Fix the login bug' })));
    await tick();
    const g = opened.a.guard;
    check(
      "T16 the opened panel's own key is compared again: the same key passes; another, a name-form, an empty or a missing one does not",
      g(KEY) === true &&
        [OTHER, NAMEKEY, '', undefined, null, KEY.toUpperCase(), [KEY]].every(k => g(k) === false)
    );
    w.rights.A = ''; // the switch is turned off while the panel is still opening
    let textDelivered = 0;
    if (g(KEY)) textDelivered++; // the delivery asks before `text` goes in
    opened.res(textDelivered ? 'started' : 'failed');
    const r = await pending;
    check(
      'T20 the switch turned off during the wait of a start: the guard says no, no text is delivered, "failed" goes out',
      textDelivered === 0 &&
        r.taken === true &&
        r.state === 'failed' &&
        w.sent.length === 1 &&
        w.sent[0].t === 'started' &&
        w.sent[0].ok === false &&
        w.sent[0].why === 'failed'
    );
    for (const [what, change] of [
      [
        'the pairing changed',
        x => {
          x.rights.A = 'pair-1c';
        },
      ],
      [
        'the session ended',
        x => {
          x.live.A = false;
        },
      ],
      [
        '10 minutes passed',
        x => {
          x.t += rc.HELD_MS;
        },
      ],
      [
        'the control was stopped',
        x => {
          x.control.stop();
        },
      ],
    ]) {
      const x = world();
      let gd = null;
      x.say.start = a => {
        gd = a.guard;
        return new Promise(() => {});
      };
      x.control.receive('A', wire(x.start({ text: 'Fix it' })));
      const was = gd(KEY);
      change(x);
      check("T20 the start's guard also says no when " + what, was === true && gd(KEY) === false);
    }
    const y = world();
    let gy = null;
    y.say.start = a => {
      gy = a.guard;
      return 'started';
    };
    await y.go(y.start({ text: 'Fix it' }));

    // another project was opened on this computer after the panel started in the right one
    y.open = OTHER;
    check(
      "T16 the guard goes by the panel's own key, so the wiring must hand it that, not the open project's",
      gy(KEY) === true && gy(y.open) === false
    );
  }

  // ---- T17: how many panels may be started from other computers ----
  {
    const w = world();
    w.remote = 3;
    const no = await w.go(w.start());
    check(
      "T17 the fourth remotely started panel while three are open (stopped ones are in the app's count): refused, no panel",
      refusedAs(no, 'started') && w.calls.start.length === 0
    );
    w.remote = 2;
    const yes = await w.go(w.start());
    check('T17 with two open a third is taken', yes.r.taken === true && w.calls.start.length === 1);
    for (const bad of [undefined, null, -1, 1.5, '0', NaN, Infinity]) {
      const x = world();
      x.remote = bad;
      check(
        'T17 a count that cannot be read (' + String(bad) + ') is "no room"',
        refusedAs(await x.go(x.start()), 'started') && x.calls.start.length === 0
      );
    }

    // Panels that are still opening are not in the app's count yet.
    const f = world();
    const open = [];
    f.say.start = () => new Promise(res => open.push(res));
    const p = [
      f.control.receive('A', wire(f.start())),
      f.control.receive('C', wire(f.start({}, 'C'))),
      f.control.receive('A', wire(f.start())),
    ];
    const fourth = await f.go(f.start({}, 'C'), 'C');
    check(
      'T17 three starts whose panels are still opening: a fourth is refused although the app counts none yet, whichever computer asks',
      f.calls.start.length === 3 && refusedAs(fourth, 'started')
    );
    open.forEach(res => res('started'));
    await Promise.all(p);
    f.remote = 3;
    f.t += 61000;
    check(
      "T17 once they opened the app's own count holds the bound",
      refusedAs(await f.go(f.start()), 'started') && f.calls.start.length === 3
    );
    f.remote = 2;
    f.say.start = 'started';
    check(
      'T17 and after the user closed one, a start is taken again',
      (await f.go(f.start())).r.taken === true && f.calls.start.length === 4
    );
    const u = world();
    u.say.start = () => {
      throw new Error('spawn failed');
    };
    await u.go(u.start());
    await u.go(u.start());
    await u.go(u.start());
    u.t += 61000;
    u.say.start = 'started';
    check(
      'T17 a start whose delivery failed does not stay counted as opening',
      (await u.go(u.start())).r.taken === true
    );

    // 20 a day, for starts that were taken.
    const d = world();
    let taken = 0;
    for (let i = 0; i < rc.START_DAY; i++) {
      if ((await d.go(d.start())).r.taken === true) taken++;
      d.t += 2 * 60000;
    }
    const next = await d.go(d.start());
    check(
      'T17 twenty starts in a day are taken, the twenty-first is refused',
      taken === 20 && d.calls.start.length === 20 && refusedAs(next, 'started')
    );
    d.t += 24 * 60 * 60000;
    check(
      'T17 a day later a start is taken again',
      (await d.go(d.start())).r.taken === true && d.calls.start.length === 21
    );
  }

  // ---- T21, T22 (the core's part): interrupt and stop ----
  {
    const w = world();
    const bad = [];
    for (const what of [
      'kill',
      'Stop',
      'INTERRUPT',
      'interrupt ',
      '',
      ['stop'],
      { toString: () => 'stop' },
      null,
      undefined,
      'close',
      'restart',
    ]) {
      bad.push(await w.go(w.act(what)));
      w.t += 16000;
    }
    check(
      'T21 `do` is one of two literals: anything else is refused and nothing is called',
      bad.every(x => refusedAs(x, 'acted')) && w.did() === 0
    );
    w.t += 61000;
    const i = await w.go(w.act('interrupt')),
      args = w.calls.interrupt[0];
    check(
      'T21 an interrupt is handed the panel id and a guard, nothing else',
      i.r.state === 'done' &&
        args.length === 2 &&
        args[0] === P1 &&
        typeof args[1] === 'function' &&
        args[1]() === true &&
        i.back[0].t === 'acted' &&
        i.back[0].ok === true &&
        i.back[0].state === 'done'
    );
    w.agents[P1] = agent({ hand: true });
    check('T21 its guard asks the app-started rule again before the write', args[1]() === false);
    w.agents[P1] = agent();
    w.say.interrupt = 'unsent';
    const un = await w.go(w.act('interrupt'));
    check(
      'T21 the state of change 12: interrupted with the task\'s prompt back in its input crosses as "unsent"',
      un.back[0].ok === true && un.back[0].state === 'unsent'
    );
    w.say.interrupt = 'refused';
    const ref = await w.go(w.act('interrupt'));
    check(
      'T21 the delivery\'s own no (idle, on a question, unsent text, inside two minutes) crosses as "refused"',
      ref.back[0].ok === false && ref.back[0].state === 'refused' && ref.r.taken === true
    );
    w.t += 61000;
    w.say.stop = 'done';
    const s1 = await w.go(w.act('stop'));
    w.say.stop = 'failed';
    const s2 = await w.go(w.act('stop'));
    check(
      'T22 a stop is taken and answered "done"; a second one whose delivery found nothing to stop is "failed"',
      s1.back[0].ok === true &&
        s1.back[0].state === 'done' &&
        s2.back[0].ok === false &&
        s2.back[0].state === 'failed' &&
        w.calls.stop.length === 2 &&
        w.calls.stop.every(c => c[0] === P1 && c.length === 2)
    );
    w.say.stop = 'unsent';
    const s3 = await w.go(w.act('stop'));
    check(
      'T22 a word that is not a stop\'s is "failed"',
      s3.back[0].ok === false && s3.back[0].state === 'failed'
    );
  }

  // ---- T23, T24, T26: a longer command to answer, its hint and its binding ----
  {
    const item = (over = {}) =>
      shape(
        {
          id: 'permission:terminal-1:7',
          kind: 'permission',
          agent: 'Moss',
          detail: 'Bash: npm test && node tools/check-syntax.js',
          since: 1700000000000,
          inferred: false,
          ...over,
        },
        true
      );
    const multi =
      'npm test\n  node tools/check-syntax.js\n\nfor f in a b; do\n    echo "$f"  # two  spaces\ndone';
    const sent = withFull(item(), 'Bash', multi);
    check(
      'T23 a command of several lines: lines, leading spaces and inner spaces are kept exactly, and the item gets `full` and `can2`',
      fullText(multi) &&
        answerWay('Bash', multi) === 'full' &&
        sent.full === multi &&
        sent.can2 === true
    );
    const TAB = ch(9),
      CR = ch(13),
      badOnes = {
        'a tab': 'echo a' + TAB + 'b',
        'a carriage return': 'echo a' + CR + 'echo b',
        'CR LF line ends': 'echo a' + CR + '\necho b',
        'U+2028': 'echo a' + ch(0x2028) + 'echo b',
        'U+2029': 'echo a' + ch(0x2029) + 'b',
        'U+0085': 'echo a' + ch(0x85) + 'b',
        'Esc': 'echo ' + ESC + '[2K',
        'a zero-width character': 'echo a' + ZW + 'b',
        'a direction character': 'echo ' + RLO + 'gnp.exe',
        'a filler character': 'echo ' + FILLER,
        'a no-break space': 'echo' + NBSP + 'a',
        'white space at a line end': 'echo a \necho b',
        'white space at the end': 'echo a\necho b ',
        'a line break at the end': 'echo a\necho b\n',
        'a line of spaces only': 'echo a\n   \necho b',
        'half a surrogate pair': 'echo ' + ch(0xd83d),
        'three combining marks in a row': 'echo a' + ch(0x301, 0x301, 0x301),
        'DEL': 'echo a' + ch(0x7f),
        'a null': 'echo a' + ch(0) + 'b',
        '1,201 characters': 'a'.repeat(1201),
        'nothing': '',
      };
    const wrong = Object.entries(badOnes)
      .filter(
        ([, c]) =>
          fullText(c) ||
          fullShell('Bash', c) ||
          answerWay('Bash', c) === 'full' ||
          withFull(item(), 'Bash', c).can2 ||
          withFull(item(), 'Bash', c).full !== undefined
      )
      .map(([k]) => k);
    check(
      'T23 a tab, a carriage return, U+2028, U+2029, U+0085, an invisible or direction character, white space at a line end, 1,201 characters: no `full`, no `can2`',
      wrong.length === 0,
      wrong
    );
    check(
      'T23 1,200 characters is the most; counted in UTF-16 units too (600 characters above U+FFFF fit, 601 do not)',
      fullText('a'.repeat(1200)) &&
        !fullText('a'.repeat(1201)) &&
        fullText(FACE.repeat(600)) &&
        !fullText(FACE.repeat(600) + 'a') &&
        !fullText(FACE.repeat(601))
    );
    check(
      'T23 only a string is a command, and the tool is one clean word',
      [undefined, null, 7, ['ls\nls'], { toString: () => 'ls\nls' }].every(
        v => !fullText(v) && !fullShell('Bash', v)
      ) &&
        !fullShell('', multi) &&
        !fullShell(undefined, multi) &&
        !fullShell('Ba' + ZW + 'sh', multi) &&
        !fullShell('Bash\n', multi) &&
        fullShell('PowerShell', multi)
    );
    const bigItem = item({ agent: HINDI.repeat(60), detail: 'Bash: ' + HINDI.repeat(93) + '…' }),
      big = HINDI.repeat(600) + '\n' + HINDI.repeat(599),
      small = HINDI.repeat(300) + '\n' + HINDI.repeat(300);
    const tooBig = withFull(bigItem, 'Bash', big),
      fitting = withFull(bigItem, 'Bash', small);
    check(
      'T23 an item too big for one part with its `full`: it goes without `full` and `can2`, as it was; a smaller one keeps them and fits',
      fullText(big) &&
        tooBig === bigItem &&
        tooBig.full === undefined &&
        tooBig.can2 === undefined &&
        fitting.can2 === true &&
        fitsOne({ t: 'needs', g: 123456, i: 0, n: 1, items: [fitting] }) &&
        !fitsOne({ t: 'needs', g: 1, i: 0, n: 1, items: [{ ...bigItem, full: big, can2: true }] })
    );
    const read = readFull(item(), wire(sent)),
      tampered = [
        { ...sent, full: sent.full + ' ' },
        { ...sent, full: 'echo a' + TAB + 'b' },
        { ...sent, can2: 'true' },
        { ...sent, can2: undefined },
        { ...sent, can: true },
        { ...sent, full: ['x'] },
        { ...sent, full: 'a'.repeat(1201) },
      ];
    check(
      'T23 the receiving computer reads `full` by the same rule again: unchanged it is kept, anything else gives no `can2`',
      read.full === multi &&
        read.can2 === true &&
        tampered.every(raw => {
          const r = readFull(item(), wire(raw));
          return r.can2 === undefined && r.full === undefined;
        }) &&
        readFull(item({ kind: 'trust' }), wire(sent)).can2 === undefined &&
        readFull(item({ inferred: true }), wire(sent)).can2 === undefined
    );
    check(
      'T23 a bound yes for a command that is not `full`: there is no v2 binding to match (bindingFor falls back to v1, which a `full` answer never carries)',
      Object.values(badOnes).every(c => {
        const s = withFull(item(), 'Bash', c);
        return bindingFor(s) === bindingOf(s) && bindingFor(s) !== bindingOf2({ ...s, full: c });
      })
    );

    const whole = { ...item({ detail: 'Bash: npm test' }), can: true };
    check(
      'T24 an item answerable only through `full` never carries `can`; a `whole` item never gets `full` or `can2`',
      sent.can === undefined &&
        withFull(whole, 'Bash', multi) === whole &&
        answerWay('Bash', 'npm test') === 'whole' &&
        answerWay('Bash', multi) === 'full' &&
        answerWay('Bash', 'echo a' + TAB) === ''
    );
    check(
      'T24 the binding a `full` item needs is v2; a v1 binding for it is another value, so it is refused',
      bindingFor(sent) === bindingOf2(sent) && bindingOf(sent) !== bindingFor(sent)
    );
    check(
      'T24 the binding a `whole` item needs is v1; a v2 binding for it is another value, so it is refused',
      bindingFor(whole) === bindingOf(whole) &&
        bindingOf2(whole) !== bindingFor(whole) &&
        bindingOf2({ ...whole, full: 'npm test' }) !== bindingFor(whole)
    );
    check(
      "T24 v2 is v1's fields and `full` under its own label: the same form, and one changed character anywhere changes it",
      /^[A-Za-z0-9+/]{16}$/.test(bindingOf2(sent)) &&
        bindingOf2(sent).length === bindingOf(sent).length &&
        [
          { full: multi + 'x' },
          { full: multi.replace('npm', 'npn') },
          { id: sent.id + '1' },
          { kind: 'trust' },
          { agent: 'Mos' },
          { detail: sent.detail + '.' },
          { since: sent.since + 1 },
          { inferred: true },
        ].every(c => bindingOf2({ ...sent, ...c }) !== bindingOf2(sent)) &&
        bindingOf2(sent) ===
          crypto
            .createHash('sha256')
            .update(
              fields(
                'tnai-answer-v2',
                sent.id,
                sent.kind,
                sent.agent,
                sent.detail,
                String(sent.since),
                '0',
                multi
              )
            )
            .digest()
            .subarray(0, 12)
            .toString('base64')
    );
    const kinds = ['trust', 'menu', 'question', 'error', 'draft', 'other'].map(kind =>
        item({ kind })
      ),
      others = [...kinds, item({ inferred: true }), item({ detail: '' }), null, undefined, 'x'];
    check(
      "T26 (the kinds; that the tool is a shell tool is the caller's check) trust, menu, question, error, draft, an inferred item and one without text never get `full` or `can2`",
      others.every(s => {
        const r = withFull(s, 'Bash', multi);
        return (
          r === s && (!r || typeof r !== 'object' || (r.can2 === undefined && r.full === undefined))
        );
      })
    );
  }

  // ---- T27, T31 (the core's part): replies are fixed words ----
  {
    const SECRET = 'C:\\Users\\secret\\project',
      nasty = [
        {
          ok: false,
          state: 'held',
          reason: 'draft',
          error: 'The user is speaking a prompt in ' + SECRET,
        },
        'The user is speaking a prompt',
        'not-submitted',
        'not-confirmed',
        'held',
        'gone',
        true,
        1,
        null,
        undefined,
        ['sent'],
        { toString: () => 'sent' },
        'SENT',
        'sent ',
        '<b>sent</b>',
        () => {
          throw new Error('No running process in ' + SECRET);
        },
        () => Promise.reject(new Error(SECRET)),
        () => Promise.resolve({ state: 'sent', error: SECRET }),
        () => new String('sent'),
      ];
    const w = world();
    const states = [];
    for (const v of nasty) {
      for (const k of ['prompt', 'interrupt', 'stop', 'start']) w.say[k] = v;
      for (const m of [w.prompt(), w.act('interrupt'), w.act('stop'), w.start()]) {
        const x = await w.go(m);
        states.push(
          x.back.length === 1 &&
            x.back[0].ok === false &&
            (x.back[0].state || x.back[0].why) === 'failed' &&
            x.r.state === 'failed'
        );
      }
      w.t += 10 * 60000 + 1;
    }
    check(
      'T27 whatever a delivery gives back that is not one of its words (an object, an error sentence, a throw, a rejection): the reply is "failed"',
      states.length === nasty.length * 4 && states.every(Boolean),
      states.filter(s => !s).length
    );
    const all = JSON.stringify(w.sent);
    check(
      "T27 nothing of a delivery's own result or error text crossed",
      !/secret|speaking|held|draft|submitted|confirmed|gone|running|<b>/i.test(all)
    );
    {
      // The count of a day's starts can be the app's own (it survives the app's restart):
      // startsToday and startTaken.
      const taken = [];
      const withStore = says => {
        const u = world();
        u.control = createControl({
          rights: id => u.rights[id] ?? '',
          live: () => true,
          peerName: id => u.names[id],
          agentNow: () => null,
          clis: () => u.clis,
          openKey: () => u.open,
          remoteStarted: () => 0,
          send: (id, obj) => {
            u.sent.push({ peer: id, ...wire(obj) });
            return true;
          },
          log: () => {},
          start: (...a) => {
            u.calls.start.push(a);
            return 'started';
          },
          now: () => u.t,
          startsToday: says,
          startTaken: (id, at) => taken.push([id, at]),
        });
        return u;
      };
      const go = async u => {
        const a = u.sent.length,
          r = await u.control.receive(
            'A',
            wire({
              t: 'start',
              n: u.n(),
              c: u.control.stamp('A'),
              ms: 0,
              cli: 'claude',
              project: KEY,
            })
          );
        return { r, back: u.sent.slice(a) };
      };
      const full = withStore(() => 20),
        x20 = await go(full);
      const room = withStore(id => (id === 'A' ? 19 : 0)),
        x19 = await go(room);
      const broken = withStore(() => {
          throw new Error('no file');
        }),
        xb = await go(broken),
        odd = withStore(() => '3'),
        xo = await go(odd);
      check(
        "T17 the day's count kept by the app: 20 already given (before a restart): refused, no start; 19: taken, and the app is told one more",
        refusedAs(x20, 'started') &&
          full.calls.start.length === 0 &&
          x19.r.state === 'started' &&
          room.calls.start.length === 1 &&
          taken.length === 1 &&
          taken[0][0] === 'A' &&
          taken[0][1] === room.t,
        [x20.r, x19.r, taken]
      );
      check(
        'T17 a count that cannot be read, or is no whole number: refused',
        refusedAs(xb, 'started') &&
          refusedAs(xo, 'started') &&
          broken.calls.start.length === 0 &&
          odd.calls.start.length === 0
      );
    }
    {
      // The fifth word (lead's decision 2026-10-09): a prompt that was written, with one Enter,
      // into a CLI that gives no sign.
      const u = world();
      u.say.prompt = 'unconfirmed';
      const x = await u.go(u.prompt());
      check(
        'T27 "unconfirmed" is a word of a prompt: it crosses as itself, as a yes, never as "failed" or "sent"',
        x.r.state === 'unconfirmed' &&
          x.back.length === 1 &&
          x.back[0].ok === true &&
          x.back[0].state === 'unconfirmed' &&
          u.control.held().length === 0,
        x.back
      );
      u.t += 10 * 60000 + 1;
      u.say.prompt = 'queued';
      const q = await u.go(u.prompt({ id: P2 }));
      u.calls.prompt.at(-1)[0].done('unconfirmed');
      check(
        'T27 a held prompt can end on "unconfirmed": told once, and no longer held',
        q.back[0].state === 'queued' &&
          u.sent.at(-1).state === 'unconfirmed' &&
          u.sent.at(-1).ok === true &&
          u.sent.at(-1).n === q.back[0].n &&
          u.control.held().length === 0,
        u.sent.at(-1)
      );
      const odd = [];
      for (const k of ['interrupt', 'stop', 'start']) {
        u.t += 10 * 60000 + 1;
        u.say[k] = 'unconfirmed';
        const y = await u.go(k === 'start' ? u.start() : u.act(k));
        odd.push((y.back[0].state || y.back[0].why) === 'failed' && y.back[0].ok === false);
      }
      const n5 = '0123456789abcdef';
      check(
        'T27 it is no word of an interrupt, a stop or a start: there it reads as "failed", and in their replies as "refused"',
        odd.length === 3 &&
          odd.every(Boolean) &&
          shapeReply({ t: 'prompted', n: n5, ok: true, state: 'unconfirmed' }).state ===
            'unconfirmed' &&
          shapeReply({ t: 'prompted', n: n5, ok: false, state: 'unconfirmed' }).state ===
            'refused' &&
          shapeReply({ t: 'acted', n: n5, ok: true, state: 'unconfirmed' }).state === 'refused' &&
          shapeReply({ t: 'started', n: n5, ok: false, why: 'unconfirmed' }).why === 'refused',
        odd
      );
    }
    const keysOk = w.sent.every(m => {
      const { peer, ...o } = m;
      const s = shapeReply(o);
      return (
        peer &&
        s &&
        JSON.stringify(s) === JSON.stringify(o) &&
        Object.keys(o).every(k => ['t', 'n', 'ok', 'state', 'why'].includes(k)) &&
        /^[0-9a-f]{16}$/.test(o.n) &&
        typeof o.ok === 'boolean' &&
        [
          'sent',
          'queued',
          'unconfirmed',
          'done',
          'unsent',
          'refused',
          'failed',
          undefined,
        ].includes(o.state) &&
        [undefined, 'refused', 'failed'].includes(o.why)
      );
    });
    check(
      'T27 every reply sent in that run has only t, n, ok and one fixed word',
      keysOk && w.sent.length === nasty.length * 4
    );
    const good = world(),
      seenWords = new Set();
    for (const [k, words] of [
      ['prompt', ['sent', 'queued', 'refused', 'failed', 'unconfirmed']],
      ['interrupt', ['done', 'unsent', 'refused', 'failed']],
      ['stop', ['done', 'refused', 'failed']],
      ['start', ['started', 'refused', 'failed']],
    ])
      for (const word of words) {
        good.say[k] = word;
        const m =
          k === 'prompt'
            ? good.prompt({ id: [P1, P2, P3, P4, P1][words.indexOf(word)] })
            : k === 'start'
              ? good.start()
              : good.act(k);
        const x = await good.go(m);
        seenWords.add(
          k +
            ':' +
            word +
            '→' +
            (x.back[0].ok ? 'ok' : 'no') +
            ':' +
            (x.back[0].state ?? x.back[0].why ?? 'started')
        );
        good.t += 10 * 60000 + 1;
      }
    check(
      'T27, T31 each delivery\'s own words cross as themselves ("refused" is how a locked plan or the delivery\'s own no reads)',
      [...seenWords].join(' ') ===
        'prompt:sent→ok:sent prompt:queued→ok:queued prompt:refused→no:refused prompt:failed→no:failed prompt:unconfirmed→ok:unconfirmed interrupt:done→ok:done interrupt:unsent→ok:unsent interrupt:refused→no:refused interrupt:failed→no:failed stop:done→ok:done stop:refused→no:refused stop:failed→no:failed start:started→ok:started start:refused→no:refused start:failed→no:failed',
      [...seenWords]
    );

    // The reading side: what the computer that sent the operation makes of a reply.
    const n = '0123456789abcdef';
    check(
      'T27 a reply is read field by field: extra fields are dropped',
      JSON.stringify(
        shapeReply({
          t: 'prompted',
          n,
          ok: true,
          state: 'sent',
          reason: 'draft',
          error: SECRET,
          text: 'x',
        })
      ) === JSON.stringify({ t: 'prompted', n, ok: true, state: 'sent' }) &&
        JSON.stringify(shapeReply({ t: 'started', n, ok: true, why: SECRET, panel: P1 })) ===
          JSON.stringify({ t: 'started', n, ok: true })
    );
    check(
      'T27 an odd reply reads as the harmless word: an unknown state, a yes with a refusal word, a yes that is not `true`',
      [
        { t: 'prompted', n, ok: true, state: SECRET },
        { t: 'prompted', n, ok: true, state: 'refused' },
        { t: 'prompted', n, ok: 'yes', state: 'sent' },
        { t: 'prompted', n, ok: 1, state: 'queued' },
        { t: 'acted', n, ok: true, state: 'sent' },
        { t: 'prompted', n, ok: true, state: 'done' },
        { t: 'prompted', n, ok: true },
        { t: 'acted', n, state: ['done'] },
      ].every(o => {
        const s = shapeReply(o);
        return s.ok === false && s.state === 'refused';
      }) &&
        shapeReply({ t: 'prompted', n, ok: true, state: 'failed' }).state === 'failed' &&
        shapeReply({ t: 'started', n, ok: false, why: SECRET }).why === 'refused' &&
        shapeReply({ t: 'started', n, ok: 'true' }).ok === false
    );
    check(
      'T27 what is no reply is nothing: another type, no usable n, not an object',
      [
        null,
        undefined,
        'prompted',
        7,
        [],
        {},
        { t: 'prompted' },
        { t: 'prompted', n: 'xyz', ok: true, state: 'sent' },
        { t: 'prompted', n: n.toUpperCase(), ok: true, state: 'sent' },
        { t: 'answered', n, ok: true },
        { t: 'constructor', n, ok: true },
        { t: '__proto__', n },
        { t: ['prompted'], n },
      ].every(o => shapeReply(o) === null)
    );
    const th = world();
    th.control = createControl({
      rights: () => 'pair-1',
      agentNow: () => agent(),
      send: () => {
        throw new Error('no session');
      },
      log: () => {
        throw new Error('disk full');
      },
      live: () => true,
      prompt: a => {
        th.calls.prompt.push(a);
        return 'sent';
      },
      now: () => th.t,
    });
    const m = {
        t: 'prompt',
        n,
        c: th.control.stamp('A'),
        ms: 0,
        id: P1,
        to: th.control.ticketFor('A', P1),
        text: 'Run',
      },
      r = await th.control.receive('A', m);
    check(
      "T27 a send or a log that throws is not the sender's to hear and stops nothing: the taken prompt is still delivered once",
      r.taken === true && r.state === 'sent' && th.calls.prompt.length === 1
    );
  }

  // ---- T28 (the core's part): one log entry per taken operation ----
  {
    const w = world();
    const long =
      'Refactor the login page' + ch(10) + 'and ' + RLO + 'then' + ZW + ' ' + 'x'.repeat(300);
    await w.go(w.prompt({ text: long }));
    await w.go(w.act('interrupt', { id: P2 }));
    await w.go(w.act('stop', { id: P3 }));
    await w.go(w.start({ cli: 'codex', text: 'Write the tests' }));
    await w.go(w.start());
    const [p, i, s, st, st2] = w.logs,
      chars = Array.from(promptText(long)).length;
    check(
      'T28 one entry each, in order, with the computer, the agent and the operation',
      w.logs.length === 5 &&
        w.logs.map(e => e.op).join() === 'prompt,interrupt,stop,start,start' &&
        w.logs.every(e => e.peerId === 'A' && e.from === 'Desk') &&
        p.agent === 'Moss' &&
        i.agent === 'Kite' &&
        s.agent === 'Fern' &&
        st.agent === 'Codex' &&
        st2.agent === 'Claude Code'
    );
    check(
      "T28 a prompt's entry has its first 100 characters as one clean line, its length, and how many more there are",
      Array.from(p.head).length <= 100 &&
        p.head.startsWith('Refactor the login page and then x') &&
        !/[\n\r\u200b\u202e]/.test(p.head) &&
        p.length === chars &&
        p.more === chars - 100 &&
        st.head === 'Write the tests' &&
        st.length === 15 &&
        st.more === 0 &&
        i.head === '' &&
        i.length === 0 &&
        st2.length === 0
    );
    check(
      'T28 every entry has the same fields',
      w.logs.every(e => Object.keys(e).sort().join() === 'agent,from,head,length,more,op,peerId')
    );
    const before = w.logs.length;
    w.t += 61000;
    await w.go(w.prompt({ text: '!x' }));
    await w.go(w.prompt({ to: 'f'.repeat(16) }));
    await w.go(w.act('nope'));
    await w.go(w.start({ project: OTHER }));
    await w.go({ t: 'prompt' });
    check('T28 a message that was refused or dropped leaves no entry', w.logs.length === before);
    const order = [];
    const o = world();
    o.control = createControl({
      rights: () => 'pair-1',
      live: () => true,
      agentNow: () => agent(),
      log: () => order.push('log'),
      stop: () => {
        order.push('stop');
        return 'done';
      },
      send: () => order.push('send'),
      now: () => o.t,
    });
    await o.control.receive('A', {
      t: 'act',
      n: '0'.repeat(16),
      c: o.control.stamp('A'),
      ms: 0,
      id: P1,
      to: o.control.ticketFor('A', P1),
      do: 'stop',
    });
    check(
      'T28 the entry is written when the operation is taken, before its delivery, whatever that returns',
      order.join() === 'log,stop,send'
    );
    const names = world();
    names.names.A = 'Desk' + RLO + ch(10) + 'top' + 'x'.repeat(100);
    await names.go(names.prompt());
    check(
      "T28 the computer's name is cleaned to one line of at most 60 characters before it is logged or handed on",
      !/[\n\u202e]/.test(names.logs[0].from) &&
        Array.from(names.logs[0].from).length <= 60 &&
        names.calls.prompt[0][0].from === names.logs[0].from
    );
  }

  // ---- T30: a message that was held back ----
  {
    const w = world(),
      m1 = w.prompt();
    w.t += 60000;
    check(
      'T30 a message this computer gets 60 s after the other one made it is still taken',
      (await w.go(m1)).r.taken === true
    );
    const m2 = w.prompt();
    w.t += 60001;
    check(
      'T30 one that arrives more than 60 s after it was made is refused, nothing delivered',
      refusedAs(await w.go(m2), 'prompted') && w.calls.prompt.length === 1
    );
    const c = w.control.stamp('A');
    w.t += 3600000; // the list is an hour old; the other computer says so
    check(
      'T30 an old list is fine when the other computer says how old: the hour it had the list is not a delay',
      (await w.go({ ...w.prompt(), c, ms: 3600000 })).r.taken === true
    );
    const c2 = w.control.stamp('A');
    w.t += 3600000 + 60001;
    check(
      'T30 but held back for more than 60 s beyond that, it is refused',
      refusedAs(await w.go({ ...w.prompt(), c: c2, ms: 3600000 }), 'prompted')
    );
    w.t += 61000;
    const a = w.act('stop'),
      s = w.start();
    w.t += 60001;
    check(
      'T30 the same for a stop and a start',
      refusedAs(await w.go(a), 'acted') &&
        refusedAs(await w.go(s), 'started') &&
        w.calls.stop.length === 0 &&
        w.calls.start.length === 0
    );
    w.t += 61000;
    const no = [];
    for (const over of [
      { c: undefined },
      { ms: undefined },
      { c: 999999 },
      { c: 0 },
      { c: -1 },
      { c: '1' },
      { c: 1.5 },
      { ms: -1 },
      { ms: 0.5 },
      { ms: '0' },
      { ms: null },
      { c: null },
    ]) {
      const m = w.prompt();
      Object.assign(m, over);
      no.push(await w.go(m));
      w.t += 7000;
    }
    check(
      'T30 no number, a number this computer never stamped, or milliseconds that are no whole number from 0: refused',
      no.every(x => refusedAs(x, 'prompted')) && w.calls.prompt.length === 2,
      no.filter(x => !x.r.refused).length
    );
    const three = world();
    three.control.stamp('C');
    three.control.stamp('C');
    const only = three.prompt(),
      r3 = await three.go({ ...only, c: 2 });
    check(
      'T30 stamps are per computer: A was stamped once, so echoing the second number only C was given is refused',
      only.c === 1 && refusedAs(r3, 'prompted') && three.calls.prompt.length === 0
    );
    const old = world(),
      first = old.prompt();
    for (let k = 0; k < 40; k++) old.control.stamp('A');
    check(
      'T30 only the newest stamps are remembered: one that 40 newer lists followed is refused',
      refusedAs(await old.go(first), 'prompted') && (await old.go(old.prompt())).r.taken === true
    );
    check(
      'T30 a stamp is a small whole number that counts up per computer, and none is made for no computer',
      (() => {
        const x = world();
        return (
          x.control.stamp('A') === 1 &&
          x.control.stamp('A') === 2 &&
          x.control.stamp('C') === 1 &&
          x.control.stamp('') === 0 &&
          x.control.stamp(null) === 0
        );
      })()
    );
  }
})()
  .catch(e => {
    failed++;
    console.log('ERROR ' + (e.stack || e));
  })
  .finally(() => {
    console.log(
      `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
    );
    finished = true;
    process.exit(failed ? 1 : 0);
  });
