// Test of desktop/remote-service.js: node tools/remote-service-test.js (plain Node; also run it in
// Electron's Node). Three services (the real key store, link, trust gate and list under each) talk
// through a stand-in relay in this process, on a clock the test moves by hand. It proves the wiring
// the Devices page relies on: off means nothing happens, the two typed codes pair, only blocking
// items leave and only through the trust gate, a paused pairing shows nothing, and Stop ends
// everything. Counted from outside, before the service is loaded: how often the answer rules
// (phone-answer.js) are made and asked, and each service's own way out through its trust gate (so a
// test can send what a changed app on a paired computer would send). The same for the control rules
// (remote-control.js): how often they are made and asked, every call of a stand-in action (acts),
// and what each service's list sender put on the wire (wire: the lists and "you may control", with
// the time, so a test can read a ticket and a counter as a changed app on the other computer
// could).
const answerMod = require('../desktop/phone-answer.js'),
  apiMod = require('../desktop/remote-api.js'),
  keysMod = require('../desktop/remote-keys.js'),
  controlMod = require('../desktop/remote-control.js');
const seen = {
  made: 0,
  receives: 0,
  permCalls: 0,
  sends: [],
  ctlMade: 0,
  ctlReceives: 0,
  acts: 0,
  wire: [],
  now: () => 0,
};
{
  const realAnswers = answerMod.phoneAnswers,
    realApi = apiMod.createRemoteApi,
    realControl = controlMod.createControl;
  answerMod.phoneAnswers = o => {
    seen.made++;
    const r = realAnswers(o);
    return {
      receive: (...a) => {
        seen.receives++;
        return r.receive(...a);
      },
    };
  };
  controlMod.createControl = o => {
    seen.ctlMade++;
    const r = realControl(o);
    return {
      ...r,
      receive: (...a) => {
        seen.ctlReceives++;
        return r.receive(...a);
      },
    };
  };
  apiMod.createRemoteApi = o => {
    seen.sends.push(o.send);
    return realApi({
      ...o,
      send: (to, obj) => {
        const went = o.send(to, obj);
        if (went === true)
          seen.wire.push({ to, at: seen.now(), obj: JSON.parse(JSON.stringify(obj)) });
        return went;
      },
    });
  };
}

// The live view's two halves (remote-view.js) send through the trust gate themselves: what went out
// is recorded the same way.
{
  const viewMod = require('../desktop/remote-view.js'),
    realViews = viewMod.createViews,
    realWatcher = viewMod.createWatcher;

  // What each service told its link to call (by its own device id): a test can play "a new session
  // took the place of a live one".
  const linkMod = require('../desktop/remote-link.js'),
    realLink = linkMod.createLink;
  seen.links = new Map();
  linkMod.createLink = o => {
    seen.links.set(o.self.id, o.on);
    return realLink(o);
  };
  const tap = o => ({
    ...o,
    send: (to, obj) => {
      const went = o.send(to, obj);
      if (went === true)
        seen.wire.push({ to, at: seen.now(), obj: JSON.parse(JSON.stringify(obj)) });
      return went;
    },
  });
  viewMod.createViews = o => realViews(tap(o));
  viewMod.createWatcher = o => realWatcher(tap(o));
}
const { bindingOf } = answerMod,
  { shape } = apiMod;
const {
  createRemoteService,
  storageBackend,
  registerIpc,
} = require('../desktop/remote-service.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// ---- a clock, timers and a relay the test moves by hand (the relay as in
// tools/remote-link-test.js) ----
function world() {
  const w = {
    t: 1700000000000,
    timers: [],
    queue: [],
    socks: [],
    sent: [],
    sentAt: [],
    tickets: [],
    account: [],
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
    for (let i = 0; i < 400; i++) {
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
  const say = (sock, obj) =>
    w.queue.push(() => sock.open && sock.onmessage?.({ data: JSON.stringify({ v: 1, ...obj }) }));
  const gone = sock => {
    for (const o of w.socks.filter(s => s.open))
      say(o, { kind: 'presence', device: sock.device, online: false });
  };
  w.WebSocket = class {
    constructor(url) {
      this.device = decodeURIComponent(url.split('ticket=')[1]).split(':')[0];
      this.readyState = 0;
      this.open = false;
      w.socks.push(this);
      w.queue.push(() => {
        this.open = true;
        this.readyState = 1;
        const rest = w.socks.filter(s => s.open && s !== this);
        say(this, {
          kind: 'hello',
          device: this.device,
          online: [...new Set(rest.map(s => s.device))],
        });
        for (const o of rest) say(o, { kind: 'presence', device: this.device, online: true });
      });
    }
    send(text) {
      if (!this.open) throw new Error('closed');
      if (text === 'ping') {
        w.queue.push(() => this.open && this.onmessage?.({ data: 'pong' }));
        return;
      }
      const m = JSON.parse(text);
      w.sent.push(text);

      // who sent when: the relay's limit is counted per connection and minute
      w.sentAt.push([this.device, w.t]);
      const target = w.socks.find(s => s.open && s.device === m.to);
      if (!target) return say(this, { kind: 'err', code: 'offline', to: m.to });

      // w.held: a relay that holds messages back and hands them over later, in order
      (w.held || w.queue).push(() => target.open && target.onmessage?.({ data: text }));
    }
    close() {
      if (this.open) {
        this.open = false;
        this.readyState = 3;
        gone(this);
      }
    }
  };
  w.count = id => w.socks.filter(s => s.open && s.device === id).length;
  w.computer = (id, name, usable = true) => {
    const c = {
      id,
      disk: { text: null },
      items: [],
      agents: [],
      changes: 0,
      last: null,
      ups: 0,
      names: {},
      holds: [],
      battery: false,
      working: false,
      chose: [],
      onChoose: () => 'done',
      answer: () => false,
      project: null,
      key: '',
      projectReads: 0,
      relates: 0,
      relate: async () => ({ rel: 'behind', n: 2 }),
      // Stand-ins for the app's control actions: each counts its calls and answers what the test
      // set. panels: what agentNow says a panel runs.
      panels: {},
      locked: false,
      clis: ['Claude Code', 'Codex'],
      started: 0,
      term: {},
      asked: [],
      shown: [],
      did: { submit: [], interrupt: [], stop: [], start: [], cancel: [], guards: [] },
      submit: () => 'sent',
      onInterrupt: () => 'done',
      onStop: () => 'done',
      onStart: () => 'started',
    };
    const flip = b => Buffer.from(b.map(x => x ^ 0x5a));
    c.backend = {
      available: () => usable,
      encrypt: flip,
      decrypt: flip,
      read: () => c.disk.text,
      write: s => {
        if (c.noWrite) throw new Error('disk full');
        c.disk.text = s;
      },
    };
    c.make = () =>
      createRemoteService({
        self: { id },
        deviceName: () => name,
        backend: c.backend,
        url: 'ws://relay',
        WebSocket: w.WebSocket,
        now: w.now,
        timers: w.timersApi,
        random: () => 0.5,
        getTicket: async () => {
          w.tickets.push(id);
          return id + ':' + w.tickets.length;
        },
        items: () => c.items,
        agents: () => c.agents,
        agentName: paneId => c.names[paneId] || 'Agent ' + paneId,
        devices: async () => w.account,
        freeIds: () => c.free === true,
        answerPermission: (...a) => {
          seen.permCalls++;
          return c.answer(...a);
        },
        project: () => {
          c.projectReads++;
          return c.project;
        },
        projectKey: () => c.key,
        relate: (mine, theirs) => {
          c.relates++;
          return c.relate(mine, theirs);
        },
        agentNow: panelId => c.panels[panelId] || null,
        planLocked: () => c.locked,
        clis: () => c.clis,
        remoteStarted: () => c.started,
        cancelHeld: key => {
          c.did.cancel.push(key);
          return 1;
        },
        submitRemote: o => {
          seen.acts++;
          c.did.submit.push(o);
          c.did.guards.push(o.guard());
          return c.submit(o);
        },
        interrupt: (panelId, guard) => {
          seen.acts++;
          c.did.interrupt.push({ panelId, guard });
          return c.onInterrupt(panelId);
        },
        stopAgent: (panelId, guard) => {
          seen.acts++;
          c.did.stop.push({ panelId, guard });
          return c.onStop(panelId);
        },
        startAgent: o => {
          seen.acts++;
          c.did.start.push(o);
          return c.onStart(o);
        },
        // The live view: the window's part is a stand-in. c.term[panelId] is the screen its
        // terminal shows; asked for it, the stand-in hands it over a moment later, as the real
        // window does. c.shown: every model the open dialog was handed.
        mono: w.now,
        watchScreen: (panelId, on) => {
          c.asked.push(panelId + (on ? ' on' : ' off'));
          if (on) w.queue.push(() => c.svc.screen(panelId, c.term[panelId] || null));
        },
        on: {
          changed: s => {
            c.changes++;
            c.last = s;
          },
          up: () => {
            c.ups++;
          },
          view: m => {
            c.shown.push(m);
          },
        },
        power: {
          // keep-awake: c.holds is every start (true) and end (false) of the system's "do not
          // sleep" request
          hold: on => {
            c.holds.push(on);
          },
          battery: () => c.battery,

          // c.workingIn: the one panel whose turn has not ended (as desktop/main.js answers: a
          // panel with an open question waits, it does not work)
          working: waiting =>
            typeof c.workingIn === 'number'
              ? !(waiting instanceof Set && waiting.has(c.workingIn))
              : c.working === true,
        },
        // Agents message agents: c.sayOk(panelId) → may that panel take
        // one; every delivery is kept in c.said.
        sayTarget: panelId => typeof c.sayOk === 'function' && c.sayOk(panelId) === true,
        sayHere: o => {
          seen.acts++;
          (c.said ||= []).push({ ...o, guardThen: o.guard() });
          return typeof c.onSay === 'function' ? c.onSay(o) : 'sent';
        },

        // a choice (6i): what the app would answer OpenCode with
        chooseAnswer: o => {
          seen.acts++;
          c.chose.push({
            panelId: o.panelId,
            ask: o.ask,
            label: o.label,
            pick: o.pick,
            guard: o.guard(),
          });
          return c.onChoose(o);
        },
      });

    // As the Devices page does: a press hands back the `mark` of the agent row it has drawn (here:
    // the row in the state at that moment). A check that passes a mark of its own (or '') plays a
    // page that drew an older list.
    const made = c.make;
    c.make = () => {
      const svc = made(),
        markOf = (id, agentId) =>
          svc
            .state()
            .computers.find(x => x.id === id)
            ?.agents.find(r => r.id === agentId)?.mark || '';
      const prompt = svc.prompt.bind(svc),
        act = svc.act.bind(svc);
      svc.prompt = (id, agentId, text, mark) =>
        prompt(id, agentId, text, mark === undefined ? markOf(id, agentId) : mark);
      svc.act = (id, agentId, what, mark) =>
        act(id, agentId, what, mark === undefined ? markOf(id, agentId) : mark);
      return svc;
    };
    c.svc = c.make();
    c.pc = other => c.svc.state().computers.find(x => x.id === other) || null;
    return c;
  };
  w.pair = async (A, B) => {
    B.svc.pairAny();
    await w.advance(50);
    A.svc.pair(B.id);
    await w.advance(50);
    const code = A.svc.state().pairing?.shows;
    const first = B.svc.enterCode(code);
    await w.advance(50);
    const code2 = B.svc.state().pairing?.shows;
    const second = A.svc.enterCode(code2);
    await w.advance(500);
    return { code, code2, first, second };
  };
  return w;
}
const item = (paneId, kind, detail) => ({
  id: kind + ':' + paneId,
  paneId,
  kind,
  detail,
  since: 1700000000000,
  inferred: kind === 'menu',
});

(async () => {
  // ---- off: nothing happens ----
  {
    const w = world(),
      a = w.computer('a-1', 'Desktop · Windows');
    a.svc.start();
    await w.advance(120000);
    const s = a.svc.state();
    check('off by default', s.on === false && s.available === true && s.connection === 'off', s);
    check(
      'off: no ticket, no socket, no timer, no file',
      w.tickets.length === 0 &&
        w.socks.length === 0 &&
        w.timers.length === 0 &&
        a.disk.text === null,
      { tickets: w.tickets.length, socks: w.socks.length, timers: w.timers.length }
    );
    let threw = '';
    try {
      a.svc.pairAny();
    } catch (e) {
      threw = e.message;
    }
    check('off: pairing is refused', threw === 'remote: off', threw);
    a.project = { root: 'a'.repeat(40), head: 'b'.repeat(40) };
    a.svc.itemsChanged();
    a.svc.projectChanged();
    a.svc.accountChanged(true);
    a.svc.quit();
    check('off: the app hooks do nothing', w.socks.length === 0 && w.timers.length === 0);
    check(
      'off: which project is open is not even read',
      a.projectReads === 0 && a.relates === 0 && a.svc.listening() === false
    );
    await a.svc.refresh();
    check('off: other computers are not asked for', a.svc.state().others.length === 0);
    check(
      'off: the answer rules are not even made, and the two new calls do nothing',
      seen.made === 0 &&
        a.svc.setAnswer('b-2', true).on === false &&
        a.svc.listening() === false &&
        a.disk.text === null,
      seen.made
    );
    check(
      'off: the control rules are not even made, and the full-control switch does nothing',
      seen.ctlMade === 0 &&
        a.svc.setControl('b-2', true).on === false &&
        a.svc.state().controlLog.length === 0 &&
        a.svc.state().controlled.length === 0 &&
        a.svc.controlLog().length === 0 &&
        (a.svc.controlChanged(), a.disk.text === null),
      seen.ctlMade
    );
    const refused = ['prompt', 'act', 'startOn'].map(k => {
      try {
        a.svc[k]('b-2', 'p1', 'stop');
        return '';
      } catch (e) {
        return e.message;
      }
    });
    check(
      'off: a prompt, an interrupt, a stop and a start for another computer are refused',
      refused.every(m => m === 'remote: off') && w.socks.length === 0 && w.timers.length === 0,
      refused
    );
    let threw2 = '';
    try {
      a.svc.answer('b-2', 'permission:x', 'yes', 'AAAA');
    } catch (e) {
      threw2 = e.message;
    }
    check(
      'off: answering is refused',
      threw2 === 'remote: off' && w.socks.length === 0 && w.timers.length === 0,
      threw2
    );
  }

  // ---- no secure storage: unavailable, and says why ----
  {
    const w = world(),
      a = w.computer('a-1', 'Desktop', false);
    a.svc.start();
    const s = a.svc.state();
    check(
      'no storage: unavailable',
      s.available === false && s.problem === 'no_storage' && s.on === false,
      s
    );
    let threw = '';
    try {
      a.svc.setOn(true);
    } catch (e) {
      threw = e.message;
    }
    check(
      'no storage: cannot be turned on',
      threw === 'remote: no_storage' && a.disk.text === null,
      threw
    );
  }

  // ---- a key store that cannot be read is reported, never replaced ----
  {
    const w = world(),
      a = w.computer('a-1', 'Desktop');
    a.disk.text = '{"v":1,"sealed":"AAAA"}';
    a.svc.start();
    const s = a.svc.state();
    check(
      'unreadable store: reported',
      s.problem === 'unreadable' && s.on === false && a.disk.text === '{"v":1,"sealed":"AAAA"}',
      s
    );
  }

  // ---- on with nothing paired: a key, still no connection ----
  const w = world(),
    a = w.computer('a-1', 'Desktop · Windows'),
    b = w.computer('b-2', 'Laptop · Windows'),
    c = w.computer('c-3', 'Work PC · Windows');
  w.account = [
    { id: 'a-1', name: 'Desktop · Windows', last_seen: 1700000000 },
    { id: 'b-2', name: 'Lap‮top', last_seen: 1700000000 },
    { id: '__proto__', name: 'x' },
    { id: 'c-3', name: null, last_seen: 1 },
  ];
  for (const x of [a, b, c]) x.svc.setOn(true);
  await w.advance(60000);
  check(
    'on, nothing paired: key made, and one connection each so another computer can ask to pair',
    a.disk.text !== null && w.tickets.length === 3 && w.count('a-1') === 1,
    { tickets: w.tickets.length }
  );
  check('on: the key file holds no readable name or id', !/Desktop|a-1/.test(a.disk.text));
  const listed = (await a.svc.refresh()).others;
  check(
    'other computers of the account are listed, cleaned, without this one',
    listed.length === 2 &&
      listed[0].id === 'b-2' &&
      listed[0].name === 'Lap top' &&
      listed[1].name === 'Computer',
    listed
  );

  // ---- pairing with the two typed codes ----
  b.svc.pairAny();
  await w.advance(50);
  check(
    'B waits in pairing mode, connected',
    b.svc.state().pairing?.role === 'b' && w.count('b-2') === 1,
    b.svc.state().pairing
  );
  a.svc.pair('b-2');
  await w.advance(50);
  const pa = a.svc.state().pairing,
    pb = b.svc.state().pairing;
  check(
    'A shows six digits, B asks for them',
    /^\d{6}$/.test(pa?.shows || '') &&
      pa.name === 'Lap top' &&
      pb?.state === 'enter' &&
      pb.shows === null,
    { pa, pb }
  );
  const wrong = b.svc.enterCode(pa.shows === '000000' ? '111111' : '000000');
  check('a wrong code is refused with tries left', wrong.ok === false && wrong.left === 2, wrong);
  check(
    "B accepts A's digits and shows its own",
    b.svc.enterCode(pa.shows).ok === true && /^\d{6}$/.test(b.svc.state().pairing?.shows || '')
  );
  check(
    'nothing is paired before A typed the second code',
    a.svc.state().computers.length === 0 && b.svc.state().computers.length === 0
  );
  check("A accepts B's digits", a.svc.enterCode(b.svc.state().pairing.shows).ok === true);
  await w.advance(500);
  check(
    'both list the other, by the name sent inside the session',
    a.pc('b-2')?.name === 'Laptop · Windows' &&
      b.pc('a-1')?.name === 'Desktop · Windows' &&
      a.pc('b-2').session &&
      b.pc('a-1').session,
    { a: a.pc('b-2'), b: b.pc('a-1') }
  );
  check(
    'pairing is over and says so',
    a.svc.state().pairing === null &&
      a.svc.state().ended?.reason === 'paired' &&
      a.svc.state().others.every(o => o.id !== 'b-2'),
    a.svc.state().ended
  );
  check(
    'the pairing is in the activity log',
    a.svc.state().log.some(e => e.kind === 'paired' && e.name === 'Laptop · Windows')
  );
  check('the window was told', a.changes > 0 && a.last?.computers.length === 1);

  // ---- the list: only blocking items, the unsent text never ----
  const mark = w.sent.length;
  a.items = [
    item(4, 'permission', 'Bash: npm install'),
    item(5, 'unsent', 'my secret draft'),
    item(6, 'menu', 'Proceed?'),
  ];
  a.svc.itemsChanged();
  await w.advance(50);
  const got = b.pc('a-1').items;
  check(
    'B sees the two blocking items with the agent and the text',
    got.length === 2 &&
      got[0].agent === 'Agent 4' &&
      got[0].detail === 'Bash: npm install' &&
      got[1].inferred === true &&
      b.pc('a-1').state === 'live',
    got
  );
  check(
    'the unsent text is not offered',
    !got.some(i => i.kind === 'unsent' || /secret/.test(i.detail || ''))
  );
  check(
    'what the relay carried is sealed',
    w.sent.slice(mark).length > 0 &&
      w.sent.slice(mark).every(t => !/npm install|Agent 4|secret/.test(t))
  );
  check(
    'A logged that Laptop saw it, once per item',
    a.svc.state().log.filter(e => e.kind === 'saw').length === 2,
    a.svc.state().log.filter(e => e.kind === 'saw')
  );
  a.svc.itemsChanged();
  await w.advance(50);
  check(
    'an unchanged list is not logged again',
    a.svc.state().log.filter(e => e.kind === 'saw').length === 2
  );
  a.svc.setDetail('b-2', false);
  await w.advance(50);
  check(
    'switch off: Laptop gets the item without its text',
    b.pc('a-1').items.length === 2 &&
      b.pc('a-1').items.every(i => i.detail === undefined) &&
      a.pc('b-2').detail === false,
    b.pc('a-1').items
  );
  a.svc.setDetail('b-2', true);
  await w.advance(50);
  a.items = [];
  a.svc.itemsChanged();
  await w.advance(50);
  check('cleared on A clears on B', b.pc('a-1').items.length === 0);

  // Phase 1, "See": A's agents on B's card.
  a.agents = [
    {
      id: 'p4',
      name: 'Moss',
      cli: 'Claude Code',
      status: 'working',
      since: 1700000000000,
      task: 'Fix the login page',
    },
    { id: 'p5', name: 'Wren', cli: 'Codex', status: 'idle', since: 0, task: '' },
  ];
  a.svc.agentsChanged();
  await w.advance(50);
  check(
    'the agents of A show on B with name, CLI, status and task',
    b.pc('a-1').agents.length === 2 &&
      b.pc('a-1').agents[0].name === 'Moss' &&
      b.pc('a-1').agents[0].status === 'working' &&
      b.pc('a-1').agents[0].task === 'Fix the login page' &&
      b.pc('a-1').agents[1].cli === 'Codex',
    b.pc('a-1').agents
  );
  check('B has no agents, so A shows none for it', a.pc('b-2').agents.length === 0);

  // Another computer's agents follow the project open here: B lists A's
  // agents of B's open project and counts the rest.
  {
    const KX = 'a'.repeat(40),
      KY = 'n' + 'b'.repeat(40),
      two = a.agents,
      ids = () =>
        b
          .pc('a-1')
          .agents.map(x => x.id)
          .join();
    check(
      'agents that name no project are listed as before, none counted',
      ids() === 'p4,p5' && b.pc('a-1').elsewhere === 0,
      b.pc('a-1')
    );
    a.agents = [
      { ...two[0], p: KX },
      { ...two[1], p: KY },
      { id: 'p6', name: 'Kite', cli: 'Codex', status: 'idle', since: 0 },
    ];
    a.svc.agentsChanged();
    await w.advance(5000);
    check(
      "no project open on B: A's agents in a project are counted, the one that names none is listed",
      ids() === 'p6' && b.pc('a-1').elsewhere === 2,
      b.pc('a-1')
    );
    const pushes = b.changes;
    b.key = KX;
    b.svc.projectChanged();
    await w.advance(10);
    check(
      "B opens project X: A's agent in X is listed and the one in Y counted, and the window is told",
      ids() === 'p4,p6' &&
        b.pc('a-1').elsewhere === 1 &&
        b.changes > pushes &&
        b.last.computers.find(x => x.id === 'a-1').elsewhere === 1,
      b.pc('a-1')
    );

    // The Agents page lists only rows known to be of the project
    // open here: `sure`.
    check(
      'a row of the open project says so (`sure`); a row that names no project is listed and does not',
      b.pc('a-1').agents.find(x => x.id === 'p4').sure === true &&
        b.pc('a-1').agents.find(x => x.id === 'p6').sure === false,
      b.pc('a-1').agents
    );
    check(
      'the window is never given a key',
      !JSON.stringify(b.svc.state()).includes(KX) &&
        !JSON.stringify(b.last).includes(KY) &&
        b.pc('a-1').agents.every(x => !('p' in x))
    );
    b.key = KY;
    b.svc.projectChanged();
    check(
      'B switches to project Y: the list follows',
      ids() === 'p5,p6' && b.pc('a-1').elsewhere === 1,
      b.pc('a-1')
    );
    check(
      'review 16, 2.6: a key made from a folder\'s name (no git) lists the row but never says "this project"',
      b.pc('a-1').agents.find(x => x.id === 'p5')?.sure === false &&
        b.pc('a-1').agents.find(x => x.id === 'p6')?.sure === false,
      b.pc('a-1').agents
    );
    b.key = 'C:\\Users\\me\\Project Y';
    b.svc.projectChanged();
    check(
      'a key of any other form here is no key',
      ids() === 'p6' && b.pc('a-1').elsewhere === 2,
      b.pc('a-1')
    );
    b.key = KY;
    a.svc.setDetail('b-2', false);
    await w.advance(5000);
    check(
      'switch off on A: no key leaves it, so its agents are listed as before',
      ids() === 'p4,p5,p6' && b.pc('a-1').elsewhere === 0,
      b.pc('a-1')
    );
    a.svc.setDetail('b-2', true);
    await w.advance(5000);
    check(
      'switch on again: the keys are back',
      ids() === 'p5,p6' && b.pc('a-1').elsewhere === 1,
      b.pc('a-1')
    );
    b.key = '';
    b.svc.projectChanged();
    a.agents = two;
    a.svc.agentsChanged();
    await w.advance(5000);
  }
  a.svc.setDetail('b-2', false);
  await w.advance(5000);
  check(
    'switch off: Laptop gets the agents without their task',
    b.pc('a-1').agents.length === 2 && b.pc('a-1').agents.every(x => x.task === undefined),
    b.pc('a-1').agents
  );
  a.svc.setDetail('b-2', true);
  await w.advance(5000);
  a.agents = [];
  a.svc.agentsChanged();
  await w.advance(5000);
  check('agents closed on A are gone on B', b.pc('a-1').agents.length === 0);

  // Piece P2, "same project, seen": each tells the other which project is
  // open, as two commit ids; the card says whether it is the project open here and how far apart
  // the two copies are, counted by this computer's own git (`relate`).
  {
    const R = 'a'.repeat(40),
      H1 = 'b'.repeat(40),
      H2 = 'c'.repeat(40),
      OTHER = 'd'.repeat(40),
      from = w.sent.length;
    check(
      'P2: nothing told: the card says nothing about a project',
      b.pc('a-1').project === null && a.pc('b-2').project === null
    );
    a.project = { root: R, head: H1, top: 'C:\\Users\\me\\secret-folder' };
    a.svc.projectChanged();
    await w.advance(50);
    check(
      'P2: A names a project, B has none open: B says nothing',
      b.pc('a-1').project === null && a.pc('b-2').project === null
    );
    b.project = { root: R, head: H1 };
    b.svc.projectChanged();
    await w.advance(50);
    check(
      'P2: the same project on the same commit: both cards say so, and git is not asked',
      a.pc('b-2').project?.rel === 'same' &&
        b.pc('a-1').project?.rel === 'same' &&
        a.relates === 0 &&
        b.relates === 0,
      [a.pc('b-2').project, b.pc('a-1').project]
    );
    a.project = { root: R, head: H2 };
    a.svc.projectChanged();
    check(
      'P2: before git answered, the old "same" is gone and no count is shown',
      a.pc('b-2').project?.rel === 'unknown'
    );
    await w.advance(5000);
    check(
      'P2: A moved on: each computer asks its own git once',
      a.pc('b-2').project?.rel === 'behind' &&
        a.pc('b-2').project.n === 2 &&
        b.pc('a-1').project?.rel === 'behind' &&
        a.relates === 1 &&
        b.relates === 1,
      { a: a.relates, b: b.relates }
    );
    check(
      'P2: what the relay carried is sealed, and no folder left',
      w.sent
        .slice(from)
        .every(
          t => !t.includes(R) && !t.includes(H1) && !t.includes(H2) && !/secret-folder/.test(t)
        )
    );
    check(
      'P2: the page gets a word and a count, never the ids',
      !/[0-9a-f]{40}/.test(JSON.stringify(a.svc.state().computers)) &&
        Object.keys(a.pc('b-2').project).sort().join() === 'n,rel',
      a.pc('b-2').project
    );
    a.svc.projectChanged();
    b.svc.projectChanged();
    await w.advance(5000);
    check('P2: nothing changed: git is not asked again', a.relates === 1 && b.relates === 1);
    a.svc.setDetail('b-2', false);
    await w.advance(50);
    check(
      "P2: switch off for Laptop: Laptop no longer learns which project is open on A; A still sees Laptop's",
      b.pc('a-1').project === null && a.pc('b-2').project?.rel === 'behind',
      [b.pc('a-1').project, a.pc('b-2').project]
    );
    a.svc.setDetail('b-2', true);
    await w.advance(5000);
    check(
      'P2: switch on again: Laptop is told again',
      b.pc('a-1').project?.rel === 'behind',
      b.pc('a-1').project
    );
    b.project = { root: OTHER, head: H1 };
    b.svc.projectChanged();
    await w.advance(5000);
    check(
      'P2: Laptop opened another project: neither card says "has this project"',
      a.pc('b-2').project === null && b.pc('a-1').project === null
    );
    b.project = { root: R, head: H1 };
    b.svc.projectChanged();
    await w.advance(5000);
    a.relate = async () => {
      throw new Error('git broke');
    };
    a.project = { root: R, head: 'e'.repeat(40) };
    a.svc.projectChanged();
    await w.advance(5000);
    check(
      'P2: a comparison that fails says only "has this project"',
      a.pc('b-2').project?.rel === 'unknown',
      a.pc('b-2').project
    );
    a.relate = async () => ({ rel: 'behind', n: 2 });
    a.project = null;
    b.project = null;
    a.svc.projectChanged();
    b.svc.projectChanged();
    await w.advance(5000);
    check(
      'P2: no project open any more: gone on both cards',
      a.pc('b-2').project === null && b.pc('a-1').project === null
    );
  }

  // ---- restart: what the user chose and who is paired come back from the encrypted file ----
  a.svc.setName('Big​ desk');
  a.svc.quit();
  await w.advance(50);
  check(
    'quit closes the connection',
    w.count('a-1') === 0 && b.pc('a-1').session === false && b.pc('a-1').state === 'offline',
    b.pc('a-1')
  );
  a.svc = a.make();
  a.svc.start();
  await w.advance(30000);
  check(
    'after a restart it is on, paired and connected again',
    a.svc.state().on && a.pc('b-2')?.session === true && b.pc('a-1')?.session === true,
    a.pc('b-2')
  );
  check(
    'the new name reached the other computer, cleaned',
    b.pc('a-1').name === 'Big desk' && a.svc.state().self.name === 'Big desk',
    b.pc('a-1').name
  );

  // ---- three computers: another one asks to forget, the pairing pauses and shows Keep or Forget
  // ----
  await w.pair(a, c);
  await w.pair(b, c);
  check(
    'three computers are paired with each other',
    a.svc.state().computers.length === 2 &&
      b.svc.state().computers.length === 2 &&
      c.svc.state().computers.length === 2,
    [a, b, c].map(x => x.svc.state().computers.length)
  );
  a.items = [item(4, 'permission', 'Bash: rm -rf build')];
  a.svc.itemsChanged();
  await w.advance(50);
  check(
    "B and C both see A's item",
    b.pc('a-1').items.length === 1 && c.pc('a-1').items.length === 1
  );
  c.svc.forget('a-1');
  await w.advance(200);
  check(
    'C forgot A at once',
    c.pc('a-1') === null &&
      c.svc.state().waiting.some(x => x.kind === 'forget' && x.to === 'b-2' && x.aboutName)
  );
  const paused = b.pc('a-1');
  check(
    'on B the pairing with A is paused: who asked is named, nothing of A is shown',
    paused.state === 'paused' &&
      paused.items.length === 0 &&
      paused.asks.length === 1 &&
      paused.asks[0].id === 'c-3' &&
      paused.asks[0].kind === 'forget',
    paused
  );
  check(
    'B logged the ask',
    b.svc.state().log.some(e => e.kind === 'asked' && e.peer === 'a-1')
  );
  const before = w.sent.length;
  a.svc.itemsChanged();
  a.items.push(item(7, 'trust', 'Trust this folder?'));
  a.svc.itemsChanged();
  await w.advance(50);
  check(
    'while paused, a new item from A is not shown on B',
    b.pc('a-1').items.length === 0 && w.sent.length > before
  );
  b.svc.choose('a-1', 'keep');
  await w.advance(3000);
  check(
    "Keep resumes: A's items are back on B",
    b.pc('a-1').state === 'live' && b.pc('a-1').items.length === 2 && b.pc('a-1').asks.length === 0,
    b.pc('a-1')
  );
  check(
    'C is told B kept it',
    c.svc.state().log.some(e => e.kind === 'they_kept'),
    c.svc.state().log.map(e => e.kind)
  );

  // ---- forget from the Devices page ----
  b.svc.forget('c-3');
  await w.advance(200);
  check(
    'Forget removes the computer and its switch',
    b.pc('c-3') === null && b.svc.state().log[0].kind === 'forgot'
  );

  // ---- remote off on one computer: its connection closes, its pairings stay ----
  b.svc.setOn(false);
  await w.advance(50);
  check(
    'off: the socket is closed and the others see it offline',
    w.count('b-2') === 0 &&
      a.pc('b-2').session === false &&
      a.pc('b-2').items.length === 0 &&
      b.svc.state().connection === 'off'
  );
  check(
    'off: the pairing is kept for when it is turned on again',
    b.svc.state().computers.some(x => x.id === 'a-1') && b.svc.state().on === false
  );
  const asked = w.tickets.filter(t => t === 'b-2').length;
  await w.advance(10 * 60000);
  check(
    'off: B asks for no ticket afterwards',
    w.tickets.filter(t => t === 'b-2').length === asked && w.count('b-2') === 0
  );
  b.svc.setOn(true);
  await w.advance(3000);
  check(
    'on again: the session with A is back',
    a.pc('b-2').session === true && b.pc('a-1').items.length === 2,
    a.pc('b-2')
  );

  // ---- Stop on all my computers ----
  a.svc.stopEverywhere();
  await w.advance(200);
  check(
    'the other computer pauses and asks Keep or Forget',
    b.pc('a-1').state === 'paused' &&
      b.pc('a-1').asks[0].kind === 'stop' &&
      b.pc('a-1').items.length === 0,
    b.pc('a-1')
  );
  await w.advance(500);
  const owed = a.svc.state();
  check(
    'A keeps waiting for the computer that cannot confirm, and names it',
    owed.stopping === true &&
      owed.on === true &&
      owed.waiting.length === 1 &&
      owed.waiting[0].to === 'c-3' &&
      owed.waiting[0].toName === 'Work PC · Windows' &&
      owed.computers.length === 1,
    owed.waiting
  );
  a.svc.finishAnyway();
  await w.advance(50);
  const stopped = a.svc.state();
  check(
    'A is off, with no pairing and no connection, after Finish anyway',
    stopped.on === false &&
      stopped.computers.length === 0 &&
      stopped.stopping === false &&
      w.count('a-1') === 0 &&
      stopped.log.some(e => e.kind === 'stopped'),
    { on: stopped.on, n: stopped.computers.length, stopping: stopped.stopping }
  );
  b.svc.choose('a-1', 'forget');
  await w.advance(200);
  check(
    'Forget on B removes A; B stays connected to hear a request to pair',
    b.pc('a-1') === null && w.count('b-2') === 1
  );

  // ---- the window's way in ----
  {
    const handlers = {};
    registerIpc(
      {
        handle: (ch, fn) => {
          handlers[ch] = fn;
        },
      },
      b.svc
    );
    const st = await handlers['remote:state']({});
    check(
      'remote:state answers with plain data',
      st.ok === true && st.value.self.id === 'b-2' && JSON.stringify(st.value).length > 0
    );
    const bad = await handlers['remote:pair']({}, '__proto__');
    check('a bad id is refused, not thrown', bad.ok === false && bad.error.code === 'bad id', bad);
    const badCode = await handlers['remote:enterCode']({}, { toString: () => '123456' });
    check(
      'a code that is not text does nothing',
      badCode.ok === true && badCode.value.ok === false,
      badCode
    );
    const none = await handlers['remote:choose']({}, 'a-1', 'obey');
    check('an unknown choice changes nothing', none.ok === true);

    // Every channel the window can call, by name (2026-10-10: a count alone, 33, was passed by
    // three builds in one night without anyone seeing which channels had come). A new channel is
    // added here on purpose, with the piece it belongs to; one that is not named fails.
    const KNOWN = [
      'state',
      'refresh',
      'setOn',
      'setName',
      'pair',
      'pairAny',
      'cancelPairing',
      'acceptPairing',
      'declinePairing',
      'enterCode',
      'forget',
      'choose',
      'stopEverywhere',
      'finishAnyway',
      'dismiss',
      'clearEnded',
      'setDetail',
      'setAnswer',
      'answer',
      'setControl',
      'prompt',
      'act',
      'start',
      'room',
      'controlLog', // full control (6f)
      'view',
      'keepView',
      'unview',
      'viewNow',
      'stopView',
      'screenRows', // the live view (6h)
      'setAwake',
      'woke', // keep-awake and the wake after sleep

      // "Connect again" for a link another window replaced
      'connectAgain',
      'pick', // choose option N (6i)
      'reportText', // a finished answer's text, read when it is shown (review 14, Low 7)
      'promptFiles',
      'stopFiles',
      'showFile', // attachments with a prompt
      'bring',
      'handOver', // the git hand-over
    ]
      .map(k => 'remote:' + k)
      .sort();
    check(
      'no channel takes a code or a pairing from outside the window, and every channel is one that is named here',
      Object.keys(handlers).every(k => k.startsWith('remote:')) &&
        Object.keys(handlers).sort().join() === KNOWN.join(),
      [Object.keys(handlers).filter(k => !KNOWN.includes(k)), KNOWN.filter(k => !(k in handlers))]
    );
    const badSay = await handlers['remote:answer'](
      {},
      'a-1',
      { toString: () => 'permission:x' },
      'session',
      ['x']
    );
    check(
      'remote:answer takes only text and a plain yes or no: anything else sends nothing',
      badSay.ok === true && badSay.value.sent === 'not_sent',
      badSay
    );
    const badOn = await handlers['remote:setAnswer']({}, 'a-1', 'true');
    check(
      'remote:setAnswer turns on only for a real true',
      badOn.ok === true && !badOn.value.computers.some(x => x.answer)
    );
    const badCtl = await handlers['remote:setControl']({}, 'a-1', 'true'),
      badCtlId = await handlers['remote:setControl']({}, 'constructor', true);
    check(
      'remote:setControl turns on only for a real true, and takes no odd id',
      badCtl.ok === true &&
        !badCtl.value.computers.some(x => x.control) &&
        badCtlId.ok === false &&
        badCtlId.error.code === 'bad id',
      [badCtl.ok, badCtlId]
    );
    const odd = [
      await handlers['remote:prompt']({}, 'a-1', { toString: () => 'p1' }, ['Fix it']),
      await handlers['remote:act']({}, 'a-1', 'p1', 'kill'),
      await handlers['remote:act']({}, 'a-1', 'p1', ['stop']),
      await handlers['remote:start']({}, 'a-1', { toString: () => 'claude' }, 7),
      await handlers['remote:prompt']({}, '__proto__', 'p1', 'Fix it'),
    ];
    check(
      'remote:prompt, remote:act and remote:start take only text, one of two words and a real id: anything else sends nothing',
      odd
        .slice(0, 4)
        .every(
          r => r.ok === true && ['not_sent', 'no_word', 'no_project'].includes(r.value.sent)
        ) &&
        odd[4].ok === false &&
        odd[4].error.code === 'bad id',
      odd.map(r => r.value?.sent || r.error)
    );
    const room = await handlers['remote:room']({}, 'p1', 'Fix it'),
      noRoom = await handlers['remote:room']({}, 'p1', 'x'.repeat(4100)),
      all = await handlers['remote:controlLog']({});
    check(
      'remote:room says how many bytes are left in one message; remote:controlLog gives the list',
      room.ok === true &&
        room.value > 3800 &&
        room.value < 4094 &&
        noRoom.value < 0 &&
        Array.isArray(all.value),
      [room, noRoom]
    );
  }

  // ---- the safeStorage backend ----
  {
    const files = {},
      fs = {
        readFileSync: f => {
          if (!(f in files)) {
            const e = new Error('no');
            e.code = 'ENOENT';
            throw e;
          }
          return files[f];
        },
        writeFileSync: (f, t) => {
          files[f] = t;
        },
        renameSync: (x, y) => {
          files[y] = files[x];
          delete files[x];
        },
      };
    const safe = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptString: s => Buffer.from('enc:' + s),
      decryptString: b => b.toString().slice(4),
    };
    const win = storageBackend({ safeStorage: safe, file: 'k.bin', fs, platform: 'win32' }),
      linux = storageBackend({ safeStorage: safe, file: 'k.bin', fs, platform: 'linux' });
    check(
      'safeStorage: available on Windows, not with the plain-text fallback on Linux',
      win.available() === true && linux.available() === false
    );
    check('safeStorage: a missing file reads as nothing', win.read() === null);
    const bytes = Buffer.from([0, 255, 10, 200, 1]);
    check(
      'safeStorage: bytes survive encrypt and decrypt',
      win.decrypt(win.encrypt(bytes)).equals(bytes)
    );
    win.write('abc');
    check(
      'safeStorage: written through a temp file',
      files['k.bin'] === 'abc' && !('k.bin.tmp' in files) && win.read() === 'abc'
    );
    check(
      'safeStorage: unavailable when Electron says so',
      storageBackend({
        safeStorage: {
          isEncryptionAvailable: () => {
            throw new Error('x');
          },
        },
        file: 'k',
        fs,
        platform: 'win32',
      }).available() === false
    );

    // macOS: asking reads the keychain, which can block the start with a prompt; it is not asked.
    let askedMac = 0;
    const mac = storageBackend({
      safeStorage: {
        isEncryptionAvailable: () => {
          askedMac++;
          return true;
        },
      },
      file: 'k',
      fs,
      platform: 'darwin',
    });
    check(
      'safeStorage on macOS: available without asking the keychain',
      mac.available() === true && askedMac === 0,
      { askedMac }
    );
  }

  // ---- No rename while paused, sign-out closes the link, a flood of asks does
  // not fill the log ----
  {
    const w2 = world(),
      A = w2.computer('a-1', 'Desktop · Windows'),
      B = w2.computer('b-2', 'Laptop · Windows'),
      C = w2.computer('c-3', 'Work PC · Windows');
    for (const x of [A, B, C]) x.svc.setOn(true);
    await w2.advance(60000);
    await w2.pair(A, B);
    await w2.pair(A, C);
    await w2.pair(B, C);
    check(
      'review 4: three computers are paired',
      [A, B, C].every(x => x.svc.state().computers.length === 2),
      [A, B, C].map(x => x.svc.state().computers.length)
    );

    // (a) C asks B to forget A: B's pairing with A is paused. A comes back under a new name: B
    // keeps the old one until Keep.
    C.svc.forget('a-1');
    await w2.advance(200);
    check('review 4: B paused its pairing with A', B.pc('a-1')?.state === 'paused');

    // (c) 60 repeated asks from C leave one "asked" line in B's activity log and the earlier
    // "paired" lines still there
    const askedBefore = B.svc.state().log.filter(e => e.kind === 'asked').length;
    for (let i = 0; i < 60; i++) C.svc.forget('a-1');
    await w2.advance(500);
    const blog = B.svc.state().log;
    const asked = blog.filter(e => e.kind === 'asked').length;
    check(
      'review 4: 60 repeated asks add at most one new "asked" line (one in all)',
      B.pc('a-1').state === 'paused' && asked - askedBefore <= 1 && asked === 1,
      blog.map(e => e.kind)
    );
    check(
      'review 4: …and the earlier "paired" lines are still in the log',
      blog.filter(e => e.kind === 'paired').length === 2,
      blog.map(e => e.kind)
    );
    check('review 4: …and B shows one ask', B.pc('a-1').asks.length === 1, B.pc('a-1').asks);
    A.svc.setName('New desk');
    A.svc.quit();
    await w2.advance(50);
    A.svc = A.make();
    A.svc.start();
    await w2.advance(30000);
    check(
      'review 4: A is back in a session with B',
      B.pc('a-1')?.session === true && A.pc('b-2')?.session === true,
      B.pc('a-1')
    );
    check(
      'review 4: a paused pairing is not renamed by the other computer',
      B.pc('a-1').name === 'Desktop · Windows' && B.pc('a-1').state === 'paused',
      B.pc('a-1')?.name
    );
    B.svc.choose('a-1', 'keep');
    await w2.advance(30000);
    check(
      'review 4: after Keep the next session takes the new name',
      B.pc('a-1').state === 'live' && B.pc('a-1').name === 'New desk',
      B.pc('a-1')
    );

    // (b) signing out closes the connection at once and nothing more reaches the other computer;
    // signing in brings it back
    A.items = [item(4, 'permission', 'Bash: first')];
    A.svc.itemsChanged();
    await w2.advance(50);
    check(
      "review 4: before sign-out B sees A's item",
      B.pc('a-1').items.length === 1,
      B.pc('a-1').items
    );
    A.svc.accountChanged(false);
    check(
      'review 4: sign-out closes the socket at once',
      w2.count('a-1') === 0 && A.svc.state().connection === 'off',
      { sockets: w2.count('a-1'), connection: A.svc.state().connection }
    );
    const ticketsBefore = w2.tickets.filter(t => t === 'a-1').length,
      sentBefore = w2.sent.length;
    A.items.push(item(5, 'permission', 'Bash: second'));
    A.svc.itemsChanged();
    await w2.advance(10 * 60000);
    check(
      'review 4: signed out: no new item reaches B, no ticket is asked for, nothing is sent',
      B.pc('a-1').items.length === 0 &&
        w2.sent.length === sentBefore &&
        w2.tickets.filter(t => t === 'a-1').length === ticketsBefore &&
        w2.count('a-1') === 0,
      { items: B.pc('a-1').items.length, sent: w2.sent.length - sentBefore }
    );
    A.svc.accountChanged(true);
    await w2.advance(30000);
    check(
      'review 4: signing in again brings the session back with both items',
      w2.count('a-1') === 1 && A.pc('b-2').session === true && B.pc('a-1').items.length === 2,
      { sockets: w2.count('a-1'), items: B.pc('a-1').items.length }
    );
  }

  // ---- a different account signing in gets nothing of the last one (review fix, 2026-10-05) ----
  {
    const w3 = world(),
      A = w3.computer('a-1', 'Desktop · Windows'),
      B = w3.computer('b-2', 'Laptop · Windows');
    const idKey = c =>
      require('../desktop/remote-keys.js').keyStore(c.backend).identity().pub.toString('base64');
    for (const x of [A, B]) x.svc.setOn(true);
    await w3.advance(60000);
    await w3.pair(A, B);
    A.svc.setName('My desk');
    check(
      'account: before any sign-in the pairing, the log and the name are there',
      A.svc.state().computers.length === 1 &&
        A.svc.state().log.length > 0 &&
        A.svc.state().self.name === 'My desk' &&
        A.svc.state().on === true
    );
    const key1 = idKey(A),
      logLen = A.svc.state().log.length;
    check(
      'would remove: with no account recorded yet, no account would remove anything',
      A.svc.wouldRemove('acct-1') === 0 && A.svc.wouldRemove('own-relay') === 0,
      [A.svc.wouldRemove('acct-1'), A.svc.wouldRemove('own-relay')]
    );
    A.svc.accountChanged(true, 'acct-1');
    await w3.advance(30000);
    {
      // the question "Use my own relay" asks before the account behind the link changes
      const counts = [
        A.svc.wouldRemove('acct-1'),
        A.svc.wouldRemove('own-relay'),
        A.svc.wouldRemove('acct-2'),
        A.svc.wouldRemove(''),
        A.svc.wouldRemove(),
      ];
      check(
        'would remove: the recorded account removes nothing, another one the one pairing, no account nothing',
        JSON.stringify(counts) === '[0,1,1,0,0]',
        counts
      );
      check(
        'would remove: asking changes nothing (pairing, switch, name, log and key as before)',
        A.svc.state().computers.length === 1 &&
          A.svc.state().on === true &&
          A.svc.state().self.name === 'My desk' &&
          A.svc.state().log.length >= logLen &&
          idKey(A) === key1
      );
    }
    check(
      'account: a first sign-in records the id and removes nothing',
      A.svc.state().computers.length === 1 &&
        A.svc.state().on === true &&
        A.svc.state().log.length >= logLen &&
        A.svc.state().self.name === 'My desk' &&
        idKey(A) === key1
    );
    A.svc.accountChanged(true, 'acct-1');
    await w3.advance(30000);
    check(
      'account: the same account signing in again changes nothing',
      A.svc.state().computers.length === 1 &&
        A.svc.state().on === true &&
        A.svc.state().log.length >= logLen &&
        A.svc.state().self.name === 'My desk' &&
        idKey(A) === key1
    );
    A.svc.accountChanged(true, 'acct-2');
    await w3.advance(30000);
    const after = A.svc.state();
    check(
      'account: a different account removes the pairings, the log and the name, and turns remote off',
      after.computers.length === 0 &&
        after.log.length === 0 &&
        after.self.name !== 'My desk' &&
        after.on === false,
      {
        computers: after.computers.length,
        log: after.log.length,
        name: after.self.name,
        on: after.on,
      }
    );
    check(
      'account: …and the identity key is a new one, with no connection left',
      idKey(A) !== key1 && w3.count('a-1') === 0
    );
    A.svc.accountChanged(true, 'acct-2');
    check(
      'account: the new account signing in again keeps the clean state',
      A.svc.state().computers.length === 0 && A.svc.state().on === false
    );
    check(
      'would remove: with nothing paired a change of account removes nothing, so nothing is asked',
      A.svc.wouldRemove('acct-1') === 0 && A.svc.wouldRemove('own-relay') === 0
    );
  }

  // The user's own relay: whoever holds its secret picks any device id, so a new id is no new
  // computer and a known id is no known computer.
  {
    const w = world(),
      A = w.computer('pc-a', 'Desk'),
      B = w.computer('pc-b', 'Laptop'),
      C = w.computer('pc-c', 'Third');
    w.account = [
      { id: 'pc-a', name: 'Desk', last_seen: 1 },
      { id: 'pc-b', name: 'Laptop', last_seen: 1 },
      { id: 'pc-c', name: 'Third', last_seen: 1 },
    ];
    B.free = true;
    for (const c of [A, B, C]) c.svc.setOn(true);
    await w.advance(200);
    for (const c of [A, B, C]) await c.svc.refresh();
    A.svc.pair(B.id);
    await w.advance(100);
    check(
      'own relay: a request is shown as "A computer on your relay", never a saved name or the id',
      B.svc.state().asked?.peer === 'pc-a' &&
        B.svc.state().asked?.name === 'A computer on your relay',
      B.svc.state().asked
    );
    B.svc.declinePairing();
    await w.advance(100);
    A.svc.cancelPairing();
    C.svc.pair(B.id);
    await w.advance(100);
    check(
      'own relay: after Not now, a request under ANOTHER id is not shown for five minutes either',
      !B.svc.state().asked,
      B.svc.state().asked
    );
    C.svc.cancelPairing();
    await w.advance(5 * 60000 + 1000);
    C.svc.pair(B.id);
    await w.advance(100);
    check(
      'own relay: after the quiet time a request shows again',
      B.svc.state().asked?.peer === 'pc-c',
      B.svc.state().asked
    );
  }

  // A request to pair: Pair pressed for a computer that is not in
  // pairing mode shows there as a request; nothing is answered until the user accepts at that
  // computer, and the six digits are still typed on both.
  {
    const w = world(),
      A = w.computer('pc-a', 'Desk'),
      B = w.computer('pc-b', 'Laptop'),
      C = w.computer('pc-c', 'Third');
    w.account = [
      { id: 'pc-a', name: 'Desk', last_seen: 1 },
      { id: 'pc-b', name: 'Laptop', last_seen: 1 },
      { id: 'pc-c', name: 'Third', last_seen: 1 },
    ];
    for (const c of [A, B, C]) {
      c.svc.setOn(true);
    }
    await w.advance(200);
    for (const c of [A, B, C]) await c.svc.refresh();
    A.svc.pair(B.id);
    await w.advance(100);
    check(
      'request: the asked computer shows who asks and is not in pairing mode',
      B.svc.state().asked?.peer === 'pc-a' &&
        B.svc.state().asked?.name === 'Desk' &&
        !B.svc.state().pairing,
      B.svc.state().asked
    );
    check(
      'request: the asking computer has no digits yet (nothing was answered)',
      !A.svc.state().pairing?.shows,
      A.svc.state().pairing
    );
    C.svc.pair(B.id);
    await w.advance(100);
    check(
      'request: a second computer asking does not replace the first',
      B.svc.state().asked?.peer === 'pc-a'
    );
    C.svc.cancelPairing();
    B.svc.declinePairing();
    await w.advance(100);
    check(
      'request: Not now drops it and answers nothing',
      !B.svc.state().asked && !B.svc.state().pairing && !A.svc.state().pairing?.shows
    );
    A.svc.cancelPairing();
    A.svc.pair(B.id);
    await w.advance(100);
    check(
      'request: after Not now the same computer is not shown again for five minutes',
      !B.svc.state().asked,
      B.svc.state().asked
    );
    C.svc.pair(B.id);
    await w.advance(100);
    check('request: another computer can ask meanwhile', B.svc.state().asked?.peer === 'pc-c');
    B.svc.setOn(false);
    await w.advance(100);
    check('request: switched off, nothing of it stays', !B.svc.state().asked);
    B.svc.setOn(true);
    C.svc.cancelPairing();
    A.svc.cancelPairing();
    await w.advance(5 * 60000 + 1000);
    A.svc.pair(B.id);
    await w.advance(100);
    check(
      'request: asking again after the quiet time shows again',
      B.svc.state().asked?.peer === 'pc-a',
      B.svc.state().asked
    );
    A.svc.cancelPairing();
    A.svc.pair(B.id);
    await w.advance(60000);
    A.svc.cancelPairing();
    A.svc.pair(B.id);
    await w.advance(61000);
    check(
      'request: asking again and again does not keep it open past two minutes',
      !B.svc.state().asked,
      B.svc.state().asked
    );
    await w.advance(5 * 60000 + 1000);
    A.svc.cancelPairing();
    A.svc.pair(B.id);
    await w.advance(100);
    check('request: shown again for the accept', B.svc.state().asked?.peer === 'pc-a');
    B.svc.acceptPairing();
    await w.advance(100);
    const code = A.svc.state().pairing?.shows;
    check(
      'request: accepted, the asking computer shows six digits and this one asks for them',
      /^\d{6}$/.test(code || '') &&
        B.svc.state().pairing?.state === 'enter' &&
        B.svc.state().pairing?.peer === 'pc-a' &&
        !B.svc.state().asked,
      [code, B.svc.state().pairing]
    );
    B.svc.enterCode(code);
    await w.advance(50);
    const code2 = B.svc.state().pairing?.shows;
    A.svc.enterCode(code2);
    await w.advance(500);
    check('request: the two typed codes pair the computers', !!A.pc('pc-b') && !!B.pc('pc-a'), [
      A.svc.state().computers.length,
      B.svc.state().computers.length,
    ]);
    const X = w.computer('pc-x', 'Late'),
      Y = w.computer('pc-y', 'Slow');
    X.svc.setOn(true);
    Y.svc.setOn(true);
    await w.advance(200);
    X.svc.pair(Y.id);
    await w.advance(100);
    check('request: shown', Y.svc.state().asked?.peer === 'pc-x');
    await w.advance(125000);
    check('request: gone by itself after two minutes', !Y.svc.state().asked, Y.svc.state().asked);
  }

  // Keep-awake (item 18), as built in step 7: off by default; held
  // only while the setting is on, connecting is on, a computer is paired and not paused, an agent
  // of this computer is working or waits on a question, and this computer is not on battery; given
  // back the moment one of them ends.
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop');
    A.svc = A.make();
    B.svc = B.make();
    A.svc.setOn(true);
    B.svc.setOn(true);
    await w.advance(50);
    const aw = () => A.svc.state().awake,
      last = () => A.holds.at(-1);
    check(
      'keep-awake: off by default: nothing is held with connecting on and nothing asked of the system',
      aw().on === false && aw().held === false && aw().why === 'setting' && A.holds.length === 0,
      [aw(), A.holds]
    );
    await w.pair(A, B);
    await w.advance(500);
    A.working = true;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: a paired computer and a working agent change nothing while the setting is off',
      aw().on === false && aw().why === 'setting' && A.holds.length === 0 && B.holds.length === 0
    );
    A.working = false;
    A.svc.powerChanged();
    const on1 = A.svc.setAwake(true).awake;
    check(
      'keep-awake: turned on, paired, no agent working: nothing is held, and the state says why',
      on1.on === true && on1.held === false && on1.why === 'idle' && A.holds.length === 0,
      [on1, A.holds]
    );
    A.working = true;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: an agent starts working: the system is asked not to sleep, once',
      aw().held === true && aw().why === '' && A.holds.join() === 'true' && B.holds.length === 0,
      [aw(), A.holds]
    );
    A.svc.setAwake(true);
    A.svc.powerChanged();
    A.svc.powerChanged();
    await w.advance(50);
    check(
      'keep-awake: turned on again, and told again that nothing changed: asked once, not again',
      A.holds.join() === 'true' && aw().on === true
    );
    A.working = false;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: the agent is done: given back in the same call',
      aw().held === false && aw().why === 'idle' && A.holds.join() === 'true,false',
      [aw(), A.holds]
    );
    A.items = [
      {
        id: 'permission:k1',
        paneId: 4,
        kind: 'permission',
        detail: 'Bash: npm test',
        whole: true,
        since: w.now(),
        inferred: false,
      },
    ];

    // the app tells the service on every event that changes an agent (desktop/main.js)
    A.svc.itemsChanged();
    A.svc.powerChanged();
    await w.advance(50);
    check(
      'keep-awake: an agent that waits on a permission question holds it too',
      aw().held === true && A.holds.join() === 'true,false,true',
      [aw(), A.holds]
    );
    A.items = [];
    A.svc.itemsChanged();
    A.svc.powerChanged();
    await w.advance(50);
    check(
      'keep-awake: the question is answered: given back',
      aw().held === false && aw().why === 'idle' && A.holds.join() === 'true,false,true,false',
      [aw(), A.holds]
    );
    A.working = true;
    A.svc.powerChanged();
    await w.advance(10);
    A.battery = true;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: on battery: given back, and the state says why',
      aw().held === false &&
        aw().why === 'battery' &&
        aw().on === true &&
        last() === false &&
        A.holds.length === 6,
      [aw(), A.holds]
    );
    A.battery = false;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: plugged in again: held again',
      aw().held === true && last() === true && A.holds.length === 7
    );
    A.svc.setOn(false);
    await w.advance(50);
    check(
      'keep-awake: connecting switched off: given back; the setting itself stays on',
      aw().held === false &&
        aw().why === 'off' &&
        aw().on === true &&
        last() === false &&
        A.holds.length === 8,
      [aw(), A.holds]
    );
    A.svc.setOn(true);
    await w.advance(3000);
    check(
      'keep-awake: connecting on again: held again',
      aw().held === true && last() === true && A.holds.length === 9
    );
    A.svc.forget('b-2');
    await w.advance(500);
    check(
      'keep-awake: the last paired computer is forgotten: given back',
      aw().held === false && aw().why === 'unpaired' && last() === false && A.holds.length === 10,
      [aw(), A.holds]
    );
    await w.advance(61000);
    await w.pair(A, B);
    await w.advance(500);
    check(
      'keep-awake: paired again: held again',
      aw().held === true && last() === true && A.holds.length === 11,
      [aw(), A.holds]
    );
    A.svc.quit();
    const kept = keysMod.keyStore(A.backend).note('prefs').awake;
    check(
      'keep-awake: the app quits: given back; the choice is kept for the next start',
      last() === false && A.holds.length === 12 && kept === true,
      [A.holds, kept]
    );
    A.svc = A.make();
    A.svc.start();
    await w.advance(3000);
    check(
      'keep-awake: the next start with the setting on and an agent working: held again without a press',
      aw().on === true && aw().held === true && last() === true && A.holds.length === 13,
      [aw(), A.holds]
    );
    const off = A.svc.setAwake(false).awake;
    check(
      'keep-awake: turned off: given back at once and kept off',
      off.on === false &&
        off.held === false &&
        last() === false &&
        A.holds.length === 14 &&
        keysMod.keyStore(A.backend).note('prefs').awake === false
    );
    check(
      'wake: with connecting on the service hands a wake to its link (true: the open socket is tested); off, it does nothing',
      A.svc.woke() === true && (A.svc.setOn(false), A.svc.woke() === false)
    );
  }

  // Keep-awake and a question that waits: a
  // question holds this computer awake for two hours from the moment it was asked, not for as long
  // as it waits; the hold ends by itself, with nobody calling anything.
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      H = 60 * 60 * 1000;
    A.svc = A.make();
    B.svc = B.make();
    A.svc.setOn(true);
    B.svc.setOn(true);
    await w.advance(50);
    await w.pair(A, B);
    await w.advance(500);
    A.svc.setAwake(true);
    const aw = () => A.svc.state().awake,
      last = () => A.holds.at(-1),
      q = (id, since, paneId = 4) => ({
        id: 'permission:' + id,
        paneId,
        kind: 'permission',
        detail: 'Bash: npm test',
        whole: true,
        since,
        inferred: false,
      });
    const ask = list => {
      A.items = list;
      A.svc.itemsChanged();
      A.svc.powerChanged();
    };
    ask([q('k1', w.now())]);
    await w.advance(50);
    check(
      'keep-awake, two hours: a question just asked holds it',
      aw().held === true && last() === true && A.holds.length === 1,
      [aw(), A.holds]
    );
    A.workingIn = 4;
    A.svc.powerChanged();
    await w.advance(2 * H - 60000);
    check(
      'keep-awake, two hours: still held a minute before the two hours are over',
      aw().held === true && A.holds.length === 1,
      [aw(), A.holds]
    );
    const pushes = A.changes;
    await w.advance(120000);
    check(
      "keep-awake, two hours: after two hours it is given back by itself, though the panel's turn has not ended; the state says why and the window is told",
      aw().held === false &&
        aw().why === 'waited' &&
        last() === false &&
        A.holds.length === 2 &&
        A.changes > pushes,
      [aw(), A.holds]
    );
    A.svc.powerChanged();
    A.svc.itemsChanged();
    await w.advance(24 * H);
    check(
      'keep-awake, two hours: it stays given back for as long as that question waits',
      aw().held === false && A.holds.length === 2,
      [aw(), A.holds]
    );
    A.workingIn = 5;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake, two hours: another agent that really works holds it again',
      aw().held === true && aw().why === '' && A.holds.length === 3
    );
    await w.advance(5 * H);
    check(
      'keep-awake, two hours: a working agent is not ended by the clock',
      aw().held === true && A.holds.length === 3
    );
    A.workingIn = 4;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake, two hours: that agent is done and only the old question is left: given back',
      aw().held === false && aw().why === 'waited' && A.holds.length === 4
    );
    ask([q('k1', w.now() - 30 * H), q('k2', w.now() - H, 6)]);
    await w.advance(50);
    check(
      'keep-awake, two hours: a second question asked an hour ago holds it for the hour it has left',
      aw().held === true && A.holds.length === 5
    );
    await w.advance(H + 5000);
    check(
      'keep-awake, two hours: and no longer',
      aw().held === false && aw().why === 'waited' && A.holds.length === 6,
      [aw(), A.holds]
    );
    ask([{ ...q('k3', undefined) }, { ...q('k4', 'soon') }]);
    await w.advance(50);
    check(
      'keep-awake, two hours: a question without a readable time holds nothing',
      aw().held === false && A.holds.length === 6
    );
    delete A.workingIn;
    ask([]);
    await w.advance(50);
    check(
      'keep-awake, two hours: answered: the state says idle again',
      aw().held === false && aw().why === 'idle'
    );
    ask([q('k5', w.now())]);
    await w.advance(50);
    const timersThen = w.timers.length;
    A.svc.quit();
    check(
      'keep-awake, two hours: the app quits while a question holds it: given back, and its timer is gone',
      last() === false && w.timers.length < timersThen,
      [A.holds, timersThen, w.timers.length]
    );
  }

  // "Connect again": a link the relay
  // ended as replaced by another window of this computer is not started again by an account push;
  // the user's own press does it.
  {
    const w = world(),
      A = w.computer('a-1', 'Desk');
    A.svc = A.make();
    A.svc.setOn(true);
    A.svc.accountChanged(true, 'acct-1');
    await w.advance(500);
    const asked = () => w.tickets.filter(t => t === 'a-1').length;
    check(
      'connect again: a computer with connecting on is connected',
      w.count('a-1') === 1 && A.svc.state().connection === 'online',
      A.svc.state().connection
    );
    {
      const before = asked();
      A.svc.connectAgain();
      await w.advance(30000);
      check(
        'connect again: on a link that is connected the press does nothing',
        asked() === before && w.count('a-1') === 1
      );
    }
    {
      const s = w.socks.find(x => x.open && x.device === 'a-1');
      s.open = false;
      s.readyState = 3;
      s.onclose?.({ code: 4001, reason: '' });
      await w.advance(50);
    }
    check(
      'connect again: the relay says another window took the connection: stopped, and the state says why',
      A.svc.state().connection === 'stopped' && A.svc.state().reason === 'replaced',
      A.svc.state()
    );
    {
      const before = asked();
      A.svc.accountChanged(true, 'acct-1');
      A.svc.accountChanged(true, 'acct-1');
      await w.advance(60 * 60 * 1000);
      check(
        'connect again: an account push does not start a replaced link again, however many come',
        asked() === before &&
          w.count('a-1') === 0 &&
          A.svc.state().connection === 'stopped' &&
          A.svc.state().reason === 'replaced',
        [asked() - before, A.svc.state().connection]
      );
    }
    A.svc.connectAgain();
    await w.advance(30000);
    check(
      "connect again: the user's press connects it again",
      w.count('a-1') === 1 && A.svc.state().connection === 'online',
      A.svc.state()
    );
    {
      const s = w.socks.find(x => x.open && x.device === 'a-1');
      s.open = false;
      s.readyState = 3;
      s.onclose?.({ code: 4001, reason: '' });
      await w.advance(50);
      A.svc.accountChanged(false);
      const before = asked();
      let threw = false;
      try {
        A.svc.connectAgain();
      } catch {
        threw = true;
      }
      await w.advance(30000);
      check(
        'connect again: signed out, the press connects nothing',
        asked() === before && w.count('a-1') === 0,
        [asked() - before, threw]
      );
      A.svc.accountChanged(true, 'acct-1');
      await w.advance(30000);
      check('connect again: signing in again does connect, as before', w.count('a-1') === 1);
    }
    {
      // "Use my own relay" (main.js): the relay changed, so the link is ended and made again
      const before = asked();
      A.svc.relayChanged();
      await w.advance(500);
      check(
        'relay changed: a link that is up is made again with a new ticket and is online',
        asked() === before + 1 && w.count('a-1') === 1 && A.svc.state().connection === 'online',
        [asked() - before, w.count('a-1'), A.svc.state().connection]
      );
    }
    {
      // The relay is about to change (own-relay-wiring.js calls this BEFORE it saves the change):
      // the link is ended there and then, while this computer's id is still the one the link was
      // made with, and nothing is connected until relayChanged() says the change is done.
      const before = asked();
      A.svc.relayGoing();
      check(
        'relay going: the link is ended at once, before anything is saved',
        w.count('a-1') === 0 && A.svc.state().connection === 'off',
        [w.count('a-1'), A.svc.state().connection]
      );
      await w.advance(30000);
      check(
        'relay going: nothing connects by itself meanwhile',
        asked() === before && w.count('a-1') === 0,
        [asked() - before, w.count('a-1')]
      );
      A.svc.relayChanged();
      await w.advance(500);
      check(
        'relay going, then changed: one new link with one new ticket, online',
        asked() === before + 1 && w.count('a-1') === 1 && A.svc.state().connection === 'online',
        [asked() - before, w.count('a-1'), A.svc.state().connection]
      );
    }
    A.svc.setOn(false);
    {
      const before = asked();
      A.svc.relayGoing();
      A.svc.relayChanged();
      await w.advance(500);
      check(
        'relay going and changed with connecting off: nothing is started',
        asked() === before && w.count('a-1') === 0
      );
    }
    {
      const before = asked();
      A.svc.relayChanged();
      await w.advance(500);
      check(
        'relay changed: with connecting off nothing is started',
        asked() === before && w.count('a-1') === 0
      );
    }
    let off = false;
    try {
      A.svc.connectAgain();
    } catch {
      off = true;
    }
    check(
      'connect again: with connecting off the press is refused',
      off === true && w.count('a-1') === 0
    );
  }

  // The app's own start never asks secure storage on a computer where remote was never used
  // (0.3.65: that question blocked the Mac app).
  {
    const w = world(),
      A = w.computer('pc-a', 'Desk');
    let asked = 0;
    const ask =
      f =>
      (...a) => {
        asked++;
        return f(...a);
      };
    A.backend = {
      ...A.backend,
      exists: () => A.disk.text !== null,
      available: ask(A.backend.available),
      encrypt: ask(A.backend.encrypt),
      decrypt: ask(A.backend.decrypt),
    };
    A.svc = A.make();
    A.svc.start();
    A.svc.accountChanged(true, 'acct-1');
    A.svc.itemsChanged?.();
    check(
      'start, sign-in and an attention change ask secure storage nothing when remote was never used',
      asked === 0,
      asked
    );
    {
      const woke = A.svc.woke();
      A.svc.powerChanged();
      check(
        'keep-awake and wake: with remote never used, the system waking and the power source changing ask secure storage nothing, hold nothing and wake nothing',
        asked === 0 && woke === false && A.holds.length === 0,
        [asked, woke, A.holds]
      );
    }
    {
      const pushes = A.changes;
      A.svc.windowLoaded();
      A.svc.windowNavigates({ isMainFrame: true, isSameDocument: false });
      A.svc.lockChanged({ locked: true });
      await w.advance(10);
      check(
        'review 16, 2.4: the window loading, loading again and the plan locking ask secure storage nothing and push nothing when remote was never used',
        asked === 0 && A.changes === pushes,
        [asked, A.changes - pushes]
      );
    }
    check(
      'the Devices page still reads the state and can turn it on',
      A.svc.state().available !== false && asked > 0,
      asked
    );
    A.svc.setOn(true);
    await w.advance(50);
    check('turned on: saved', A.disk.text !== null);
    asked = 0;
    A.svc = A.make();
    A.svc.start();
    check('a computer where remote is on asks secure storage at start as before', asked > 0, asked);
  }

  // Everything above ran with the "may answer" switch off, as it is by default: the app behaved as
  // before.
  check(
    "switch off everywhere so far: no answer was ever looked at and the app's answer call was never made",
    seen.receives === 0 && seen.permCalls === 0,
    seen
  );

  // …and with the full-control switch off, as it is by default: no ticket, counter or "you may
  // control" ever left, and nothing was looked at or done.
  check(
    'full control off everywhere so far: no control message was looked at, no action called, nothing of it on the wire',
    seen.ctlReceives === 0 &&
      seen.acts === 0 &&
      !seen.wire.some(
        m => m.obj.t === 'control' || 'c' in m.obj || (m.obj.agents || []).some(r => 'to' in r)
      ),
    [seen.ctlReceives, seen.acts]
  );

  // ---- a yes or no to a permission prompt from a paired computer (the
  // numbers are the tests of section 13) ----
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Desk');
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    }; // c.raw(to, obj): what a changed app on c could send

    // The app's own answer call, as agent-hooks.js makes it: a held request takes one answer and is
    // gone; "session" would be remembered.
    for (const c of [A, B, C]) {
      c.open = new Set();
      c.calls = [];
      c.remembered = [];
      c.keep = false;
      c.answer = (id, decision) => {
        c.calls.push(id + ' ' + decision);
        if (decision === 'session') c.remembered.push(id);
        if (!c.open.has(id)) return false;
        if (c.keep) return true;
        c.open.delete(id);
        c.items = c.items.filter(it => it.id !== 'permission:' + id);
        c.svc.itemsChanged();
        return true;
      };
      boot(c, () => c.svc.setOn(true));
    }
    const perm = (req, paneId, detail, whole = true) => ({
      id: 'permission:' + req,
      paneId,
      kind: 'permission',
      tool: detail.split(':')[0],
      detail,
      whole,
      since: 1700000000000,
      inferred: false,
    });
    const ask = async (c, req, paneId, detail, whole) => {
      c.open.add(req);
      c.items.push(perm(req, paneId, detail, whole));
      c.svc.itemsChanged();
      await w.advance(50);
    };

    // B's item as computer c shows it
    const on = (c, peer, req) => c.pc(peer)?.items.find(i => i.id === 'permission:' + req) || null;
    const ofLocal = (c, it) =>
      bindingOf(
        shape(
          {
            id: it.id,
            kind: it.kind,
            agent: c.names[it.paneId] || 'Agent ' + it.paneId,
            detail: it.detail,
            since: it.since,
            inferred: it.inferred,
          },
          true
        )
      ); // the binding B itself computes
    const sentBy = id => w.sent.filter(t => JSON.parse(t).from === id).length;
    const answeredLog = c => c.svc.state().log.filter(e => e.kind === 'answered');
    const stored = c => keysMod.keyStore(c.backend).note('prefs').answer || {};
    await w.advance(60000);
    check(
      "answer: on with nothing paired, nobody listens for this computer's agents",
      B.svc.listening() === false && B.ups === 1,
      B.ups
    );
    await w.pair(A, B);
    await w.pair(C, B);
    check(
      'answer: a session makes it listen and asks the app for its agent list again',
      B.svc.listening() === true && B.ups >= 3,
      B.ups
    );

    // 4. The switch is off by default: no hint, no buttons' worth of right, and an answer is
    // dropped unread and unanswered.
    await ask(B, 'r1', 4, 'Bash: npm test');
    const first = on(A, 'b-2', 'r1');
    check(
      '4: off by default, and the item carries no "can"',
      B.pc('a-1').answer === false &&
        first &&
        first.can === undefined &&
        first.of === undefined &&
        first.detail === 'Bash: npm test',
      first
    );
    check(
      '4: without "can" this computer sends nothing',
      A.svc.answer('b-2', first.id, 'yes', ofLocal(B, B.items[0])).sent === 'not_sent'
    );
    let mark = sentBy('b-2');
    check(
      '4: (setup) a raw answer leaves the other computer',
      A.raw('b-2', { t: 'answer', id: first.id, of: ofLocal(B, B.items[0]), say: 'yes' }) === true
    );
    await w.advance(50);
    check(
      '4: switch off: the answer is not looked at, no reply is sent, nothing is delivered, nothing is logged',
      seen.receives === 0 &&
        sentBy('b-2') === mark &&
        B.calls.length === 0 &&
        answeredLog(B).length === 0 &&
        B.svc.state().answers.length === 0,
      [seen.receives, sentBy('b-2') - mark, B.calls]
    );

    // 2 and 16. Switched on for A only: a short one-line shell command gets "can"; yes delivers
    // once, no delivers deny; one log line and one notice each.
    B.svc.setAnswer('a-1', true);
    await w.advance(50);
    const shown = on(A, 'b-2', 'r1');
    check(
      '2: switched on for A: A\'s item has "can" and its binding, C\'s has neither',
      B.pc('a-1').answer === true &&
        B.pc('c-3').answer === false &&
        shown.can === true &&
        shown.of === ofLocal(B, B.items[0]) &&
        on(C, 'b-2', 'r1').can === undefined,
      shown
    );
    check(
      '2: the switch is in the activity log',
      B.svc.state().log[0].kind === 'answer_on' && B.svc.state().log[0].peer === 'a-1'
    );
    check(
      '2: C, not allowed, sends nothing; and its raw answer is dropped unread',
      C.svc.answer('b-2', shown.id, 'yes', shown.of).sent === 'not_sent' &&
        C.raw('b-2', { t: 'answer', id: shown.id, of: shown.of, say: 'yes' }) === true &&
        (await w.advance(50), seen.receives === 0 && B.calls.length === 0)
    );
    check(
      '2: a press with another binding than the one shown sends nothing',
      A.svc.answer('b-2', shown.id, 'yes', 'AAAAAAAAAAAAAAAA').sent === 'not_sent' &&
        A.svc.answer('b-2', shown.id, 'maybe', shown.of).sent === 'not_sent'
    );
    const pressed = A.svc.answer('b-2', shown.id, 'yes', shown.of);
    check(
      '2: Allow once is sent and the item says so at once',
      pressed.sent === 'sent' &&
        on(A, 'b-2', 'r1').answer === 'sent' &&
        on(A, 'b-2', 'r1').said === 'yes',
      pressed.sent
    );
    check(
      '2: a second press while it waits sends nothing more',
      A.svc.answer('b-2', shown.id, 'no', shown.of).sent === 'sent'
    );
    await w.advance(50);
    check(
      '2: yes is delivered as "once" to that request, once',
      B.calls.length === 1 && B.calls[0] === 'r1 once' && seen.receives === 1,
      B.calls
    );
    check('2: nothing is remembered for the session', B.remembered.length === 0);
    check(
      "2: the item left A's list when B's list no longer had it",
      on(A, 'b-2', 'r1') === null && on(C, 'b-2', 'r1') === null
    );
    const note = B.svc.state().answers[0],
      line = answeredLog(B)[0];
    check(
      '16: one notice with the computer, the agent, the text and the answer',
      B.svc.state().answers.length === 1 &&
        note.peer === 'a-1' &&
        note.agent === 'Agent 4' &&
        note.text === 'Bash: npm test' &&
        note.say === 'yes' &&
        typeof note.key === 'string',
      note
    );
    check(
      '16: two paired computers share the name "Desk": the notice adds the id\'s last characters',
      note.name === 'Desk (…a-1)',
      note.name
    );
    check(
      '16: one line in the activity log with the same',
      answeredLog(B).length === 1 &&
        line.peer === 'a-1' &&
        line.agent === 'Agent 4' &&
        line.text === 'Bash: npm test' &&
        line.say === 'yes',
      line
    );
    await ask(B, 'r2', 5, 'PowerShell: Get-ChildItem src');
    check(
      '2: Deny on a PowerShell command is delivered as "deny"',
      A.svc.answer('b-2', on(A, 'b-2', 'r2').id, 'no', on(A, 'b-2', 'r2').of).sent === 'sent' &&
        (await w.advance(50),
        B.calls[1] === 'r2 deny' &&
          B.calls.length === 2 &&
          B.remembered.length === 0 &&
          answeredLog(B).length === 2 &&
          answeredLog(B)[0].say === 'no'),
      B.calls
    );

    // 3. Anything but a plain yes or no.
    await ask(B, 'r3', 4, 'Bash: git status');
    const r3 = on(A, 'b-2', 'r3');
    for (const say of [
      'session',
      'always',
      'once',
      'Yes',
      ['yes'],
      undefined,
      { toString: () => 'yes' },
    ])
      A.raw('b-2', { t: 'answer', id: r3.id, of: r3.of, say });
    await w.advance(50);
    check(
      '3: session, always, once, Yes, an array: refused, nothing delivered, and the prompt is still open for a real answer',
      B.calls.length === 2 && answeredLog(B).length === 2 && B.open.has('r3'),
      B.calls
    );

    // 1. What is not a whole one-line shell command (the marker itself:
    // tools/remote-whole-test.js): no "can", and a correctly bound yes is refused.
    await w.advance(61000);
    const notWhole = [
      ['w1', 'Bash: echo ' + 'a'.repeat(88) + '…'],
      ['w2', 'Bash: echo building rm -rf ./src'],
      ['w3', 'Bash: echo a b'],
      ['w4', 'Write: notes.txt'],
      ['w5', 'Edit: src/app.js'],
      ['w6', 'mcp__files__delete'],
      ['w7', 'Task: tidy the repo'],
    ];
    for (const [req, detail] of notWhole) {
      B.open.add(req);
      B.items.push(perm(req, 6, detail, false));
    }
    B.svc.itemsChanged();
    await w.advance(50);
    check(
      '1: a long, a multi-line, an odd-character command, Write, Edit, an MCP call and a Task carry no "can"',
      notWhole.every(([req]) => on(A, 'b-2', req) && on(A, 'b-2', req).can === undefined) &&
        on(A, 'b-2', 'r3').can === true,
      notWhole.map(([req]) => on(A, 'b-2', req)?.can)
    );
    mark = sentBy('b-2');
    for (const [req] of notWhole) {
      const it = B.items.find(x => x.id === 'permission:' + req);
      A.raw('b-2', { t: 'answer', id: it.id, of: ofLocal(B, it), say: 'yes' });
    }
    check(
      '1: and this computer sends nothing for them',
      notWhole.every(
        ([req]) =>
          A.svc.answer(
            'b-2',
            'permission:' + req,
            'yes',
            ofLocal(
              B,
              B.items.find(x => x.id === 'permission:' + req)
            )
          ).sent === 'not_sent'
      )
    );
    await w.advance(50);
    check(
      '1: a correctly bound yes for each is refused (a reply each), nothing delivered',
      B.calls.length === 2 &&
        sentBy('b-2') - mark === notWhole.length &&
        answeredLog(B).length === 2,
      [B.calls.length, sentBy('b-2') - mark]
    );

    // 11. Kinds that are never answered, with the right binding.
    const others = [
      {
        id: 'trust:7',
        paneId: 7,
        kind: 'trust',
        detail: 'Trust this folder?',
        since: 1,
        inferred: false,
        whole: true,
      },
      {
        id: 'menu:8',
        paneId: 8,
        kind: 'menu',
        detail: 'Proceed?',
        since: 1,
        inferred: true,
        whole: true,
      },
      {
        id: 'permission:g1',
        paneId: 8,
        kind: 'permission',
        detail: 'Bash: ls',
        since: 1,
        inferred: true,
        whole: true,
      },
      {
        id: 'unsent:9',
        paneId: 9,
        kind: 'unsent',
        detail: 'draft',
        since: 1,
        inferred: false,
        whole: true,
      },
      {
        id: 'question:9',
        paneId: 9,
        kind: 'question',
        detail: 'Which?',
        since: 1,
        inferred: false,
        whole: true,
      },
    ];
    B.open.add('g1');
    B.items.push(...others);
    B.svc.itemsChanged();
    await w.advance(50);
    check(
      '11: a trust prompt, a menu and an inferred permission carry no "can"; a draft and a question are not sent at all',
      ['trust:7', 'menu:8', 'permission:g1'].every(id => {
        const it = A.pc('b-2').items.find(i => i.id === id);
        return it && it.can === undefined;
      }) && !A.pc('b-2').items.some(i => i.id === 'unsent:9' || i.id === 'question:9')
    );
    for (const it of others)
      A.raw('b-2', { t: 'answer', id: it.id, of: ofLocal(B, it), say: 'yes' });
    await w.advance(50);
    check(
      '11: with the right binding each is refused, nothing delivered',
      B.calls.length === 2 && answeredLog(B).length === 2,
      B.calls
    );
    B.items = B.items.filter(it => it.id === 'permission:r3');
    B.svc.itemsChanged();
    await w.advance(61000);

    // 14. Two ids that are one after cleaning: neither is answerable.
    const twin1 = perm('x' + String.fromCharCode(0x200b) + 'y', 4, 'Bash: ls'),
      twin2 = perm('x y', 4, 'Bash: ls');
    B.open.add('x y');
    B.items.push(twin1, twin2);
    B.svc.itemsChanged();
    await w.advance(50);
    check(
      '14: two ids that collide after cleaning: no "can" on what arrives',
      A.pc('b-2').items.filter(i => i.id === 'permission:x y').length === 1 &&
        A.pc('b-2').items.find(i => i.id === 'permission:x y').can === undefined,
      A.pc('b-2').items
    );
    A.raw('b-2', { t: 'answer', id: 'permission:x y', of: ofLocal(B, twin2), say: 'yes' });
    await w.advance(50);
    check('14: and a bound yes for it delivers nothing', B.calls.length === 2, B.calls);
    B.items = B.items.filter(it => it.id === 'permission:r3');
    B.svc.itemsChanged();
    await w.advance(50);

    // 13. The text or the agent's name changed between the list A has and its answer.
    const before13 = on(A, 'b-2', 'r3');
    B.items[0].detail = 'Bash: rm -rf /'; // changed on B, the new list has not reached A
    check(
      '13: (setup) A answers what it was shown',
      A.svc.answer('b-2', before13.id, 'yes', before13.of).sent === 'sent'
    );
    await w.advance(50);
    check(
      '13: the text changed: refused, nothing delivered, and A says it was not taken',
      B.calls.length === 2 && on(A, 'b-2', 'r3').answer === 'refused',
      [B.calls, on(A, 'b-2', 'r3')]
    );
    B.items[0].detail = 'Bash: git status';
    B.names[4] = 'Renamed';
    check(
      '13: (setup) a refused answer may be pressed again',
      A.svc.answer('b-2', before13.id, 'yes', before13.of).sent === 'sent'
    );
    await w.advance(50);
    check(
      '13: the agent was renamed: refused, nothing delivered',
      B.calls.length === 2 && on(A, 'b-2', 'r3').answer === 'refused',
      B.calls
    );
    delete B.names[4];

    // 9 and 12. Answered on B first (its card, the terminal, a closed panel): the request is no
    // longer held when A's answer arrives.
    B.open.delete('r3'); // gone from the app's map; B's list has not been sent again yet
    check(
      '9: (setup) pressed',
      A.svc.answer('b-2', before13.id, 'yes', before13.of).sent === 'sent'
    );
    await w.advance(50);
    check(
      '9, 12: a request that is no longer held: the app\'s call says false, A is told "failed", nothing was answered',
      B.calls.length === 3 && B.calls[2] === 'r3 once' && on(A, 'b-2', 'r3').answer === 'failed',
      [B.calls, on(A, 'b-2', 'r3')]
    );
    check(
      '9: and it cannot be pressed again',
      A.svc.answer('b-2', before13.id, 'no', before13.of).sent === 'failed' &&
        (await w.advance(50), B.calls.length === 3)
    );
    check(
      '16: a taken answer is written down whatever the delivery said',
      answeredLog(B).length === 3 && B.svc.state().answers.length === 3
    );
    B.items = [];
    B.svc.itemsChanged();
    await w.advance(61000);

    // 8 (and 10 at this level). The same answer twice, and from two computers at once: one
    // delivery, one notice.
    B.svc.setAnswer('c-3', true);

    // the request stays listed after its answer, as OpenCode's does until its server took the reply
    B.keep = true;
    await ask(B, 'r4', 4, 'Bash: npm run build');
    const a4 = on(A, 'b-2', 'r4'),
      c4 = on(C, 'b-2', 'r4');
    check(
      '8: (setup) both computers may answer it, with the same binding',
      a4.can === true && c4.can === true && a4.of === c4.of
    );
    A.svc.answer('b-2', a4.id, 'yes', a4.of);
    C.svc.answer('b-2', c4.id, 'no', c4.of);
    A.raw('b-2', { t: 'answer', id: a4.id, of: a4.of, say: 'yes' });
    await w.advance(50);
    check(
      '8: three answers for one prompt from two computers: one delivery',
      B.calls.length === 4 && B.calls[3] === 'r4 once',
      B.calls
    );
    check(
      '8: one notice and one log line',
      answeredLog(B).length === 4 &&
        B.svc.state().answers.length === 4 &&
        B.svc.state().answers[0].peer === 'a-1'
    );
    check(
      '8: the first is told it was answered, the second that it was not taken',
      on(A, 'b-2', 'r4').answer === 'answered' && on(C, 'b-2', 'r4').answer === 'refused',
      [on(A, 'b-2', 'r4'), on(C, 'b-2', 'r4')]
    );
    await w.advance(20000);
    C.raw('b-2', { t: 'answer', id: c4.id, of: c4.of, say: 'yes' });
    await w.advance(50);
    check(
      '8, 10: still open under the same id later: still taken, not delivered again',
      B.calls.length === 4
    );
    check(
      '8: an answer the other computer confirmed stays "answered" (no "no confirmation" after 15 s)',
      on(A, 'b-2', 'r4').answer === 'answered'
    );

    // Review 11, finding 3: "taken" outlives connecting off and on.
    B.svc.setOn(false);
    await w.advance(50);
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    check(
      '8: (setup) off and on again: the session, the right and the open prompt are back',
      on(A, 'b-2', 'r4')?.can === true && B.pc('a-1').answer === true,
      on(A, 'b-2', 'r4')
    );
    A.raw('b-2', { t: 'answer', id: a4.id, of: a4.of, say: 'yes' });
    await w.advance(50);
    check(
      '8: connecting off and on does not forget what was taken: no second delivery, notice or log line',
      B.calls.length === 4 && answeredLog(B).length === 4,
      [B.calls.length, answeredLog(B).length]
    );
    B.keep = false;
    B.open.clear();
    B.items = [];
    B.svc.itemsChanged();
    B.svc.setAnswer('c-3', false);
    await w.advance(61000);

    // 15. An "answered" nobody asked for, from a changed app on B.
    await ask(B, 'r5', 4, 'Bash: npm ci');
    const r5 = on(A, 'b-2', 'r5'),
      calm = JSON.stringify(A.pc('b-2'));
    B.raw('a-1', { t: 'answered', id: r5.id, of: r5.of, ok: true });
    B.raw('a-1', { t: 'answered', id: r5.id, of: r5.of, ok: false, why: 'x'.repeat(5000) });
    B.raw('a-1', { t: 'answered', id: { a: 1 }, of: ['x'], ok: true });
    await w.advance(50);
    check(
      '15: an "answered" for an item this computer never answered changes nothing',
      JSON.stringify(A.pc('b-2')) === calm,
      A.pc('b-2').items
    );

    // 4. Over the limit: no reply at all.
    mark = sentBy('b-2');
    for (let i = 0; i < 30; i++)
      A.raw('b-2', { t: 'answer', id: 'permission:nope' + i, of: 'AAAAAAAAAAAAAAAA', say: 'yes' });
    await w.advance(50);
    check(
      '4: thirty answers in a minute: twenty are refused with a reply, the rest get none',
      sentBy('b-2') - mark === 20 && B.calls.length === 4,
      sentBy('b-2') - mark
    );
    await w.advance(61000);

    // 5. The text switch and the right.
    B.svc.setDetail('a-1', false);
    await w.advance(50);
    check(
      '5: turning the text off clears the right',
      B.pc('a-1').answer === false &&
        !('a-1' in stored(B)) &&
        on(A, 'b-2', 'r5').can === undefined &&
        on(A, 'b-2', 'r5').detail === undefined,
      stored(B)
    );
    check(
      '5: and the activity log says the right went (review 11, finding 5)',
      B.svc.state().log[0].kind === 'answer_off' && B.svc.state().log[0].peer === 'a-1',
      B.svc.state().log[0]
    );
    check(
      '5: it cannot be turned on while the text is off',
      B.svc.setAnswer('a-1', true).computers.find(x => x.id === 'a-1').answer === false
    );
    B.svc.setDetail('a-1', true);
    await w.advance(50);
    check(
      '5: turning the text back on does not bring the right back',
      B.pc('a-1').answer === false && on(A, 'b-2', 'r5').can === undefined
    );
    B.svc.setAnswer('a-1', true);
    await w.advance(50);
    {
      // the right still stored while the text is off (a store written by other means): the same
      // silence as off
      B.svc.quit();
      const ks = keysMod.keyStore(B.backend),
        p = ks.note('prefs');
      p.detail['a-1'] = false;
      ks.setNote('prefs', p);
      B.svc = B.make();
      boot(B, () => B.svc.start());
      await w.advance(30000);
      const got = seen.receives;
      mark = sentBy('b-2');
      A.raw('b-2', { t: 'answer', id: 'permission:r5', of: ofLocal(B, B.items[0]), say: 'yes' });
      await w.advance(50);
      check(
        '5: text off with the right still stored: off, no "can", the answer is not looked at, nothing delivered',
        'a-1' in stored(B) &&
          B.pc('a-1').answer === false &&
          on(A, 'b-2', 'r5').can === undefined &&
          seen.receives === got &&
          sentBy('b-2') === mark &&
          B.calls.length === 4,
        [stored(B), seen.receives - got]
      );
      B.svc.setDetail('a-1', true);
      B.svc.setAnswer('a-1', false);
      B.svc.setAnswer('a-1', true);
      await w.advance(50);
      check('5: (setup) on again', B.pc('a-1').answer === true && on(A, 'b-2', 'r5').can === true);
    }

    // Longer commands (6f, change 8): the whole command
    // travels as `full` with `can2` to a computer that may answer, and only to it; it is answered
    // with the v2 binding; a v1 binding for it and a v2 binding for a `whole` item are refused.
    await w.advance(61000);
    {
      const { bindingOf2 } = require('../desktop/remote-control.js');
      const baseOf = it =>
        shape(
          {
            id: it.id,
            kind: it.kind,
            agent: B.names[it.paneId] || 'Agent ' + it.paneId,
            detail: it.detail,
            since: it.since,
            inferred: it.inferred,
          },
          true
        );
      const multi = 'npm run build &&\n  npm test -- --watch=false\necho done',
        short = 'Bash: npm run build && npm test -- --watch=false echo done';
      const long1 = { ...perm('f1', 4, short, false), full: multi },
        calls0 = B.calls.length;
      B.open.add('f1');
      B.items.push(long1);
      B.svc.itemsChanged();
      await w.advance(50);
      const f1 = on(A, 'b-2', 'f1'),
        v2 = bindingOf2({ ...baseOf(long1), full: multi }),
        v1 = ofLocal(B, long1),
        toC = on(C, 'b-2', 'f1');
      check(
        'full 23: a command of several lines reaches the computer that may answer with every line, `can2` and the v2 binding, and without `can`',
        !!f1 &&
          f1.can2 === true &&
          f1.can === undefined &&
          f1.full === multi &&
          f1.of === v2 &&
          v2 !== v1 &&
          f1.detail === short,
        f1
      );
      check(
        "full 23: a computer whose answer switch is off gets the short line only: the command's text does not leave for it",
        !!toC &&
          toC.can2 === undefined &&
          toC.full === undefined &&
          toC.of === undefined &&
          seen.wire.some(m => m.to === 'a-1' && JSON.stringify(m.obj).includes('"full"')) &&
          !seen.wire.some(m => m.to === 'c-3' && JSON.stringify(m.obj).includes('"full"'))
      );
      check(
        'full 23: C sends nothing for it, and A sends nothing with the v1 binding',
        C.svc.answer('b-2', long1.id, 'yes', v2).sent === 'not_sent' &&
          A.svc.answer('b-2', long1.id, 'yes', v1).sent === 'not_sent'
      );
      mark = sentBy('b-2');
      A.raw('b-2', { t: 'answer', id: long1.id, of: v1, say: 'yes' });
      await w.advance(50);
      check(
        'full 24: a v1 binding for an item answerable only through `full` is refused: a reply, nothing delivered, the request still open',
        B.calls.length === calls0 && B.open.has('f1') && sentBy('b-2') - mark === 1,
        [B.calls.length - calls0, sentBy('b-2') - mark]
      );
      const r5 = B.items[0];
      mark = sentBy('b-2');
      A.raw('b-2', { t: 'answer', id: r5.id, of: bindingOf2(baseOf(r5)), say: 'yes' });
      A.raw('b-2', {
        t: 'answer',
        id: r5.id,
        of: bindingOf2({ ...baseOf(r5), full: r5.detail.replace(/^[^:]+: /, '') }),
        say: 'yes',
      });
      await w.advance(50);
      check(
        'full 24: a v2 binding for a `whole` item is refused, with or without a `full` made up for it',
        B.calls.length === calls0 &&
          B.open.has('r5') &&
          sentBy('b-2') - mark === 2 &&
          on(A, 'b-2', 'r5').can === true &&
          on(A, 'b-2', 'r5').can2 === undefined,
        [B.calls.length - calls0, sentBy('b-2') - mark]
      );

      // what is not `full`: the item goes as it was, and a v2 answer bound to its command is
      // refused
      B.names[9] = String.fromCharCode(0x915).repeat(60);
      const TAB = String.fromCharCode(9),
        CR = String.fromCharCode(13),
        LS = String.fromCharCode(0x2028),
        RLO = String.fromCharCode(0x202e),
        big = String.fromCharCode(0x915).repeat(1200);
      const notFull = [
        ['g1', 4, 'echo a' + TAB + 'b'],
        ['g2', 4, 'echo a' + CR + '\nb'],
        ['g3', 4, 'echo a' + LS + 'b'],
        ['g4', 4, 'echo a' + RLO + 'b'],
        ['g5', 4, 'echo a \nb'],
        ['g6', 4, 'echo a\nb\n'],
        ['g7', 4, 'x'.repeat(1201)],
        ['g8', 9, big],
      ];
      for (const [req, pane, cmd] of notFull) {
        B.open.add(req);
        B.items.push({
          ...perm(
            req,
            pane,
            pane === 9 ? 'Bash: ' + String.fromCharCode(0x915).repeat(94) : 'Bash: echo a b',
            false
          ),
          full: cmd,
        });
      }
      const both = { ...perm('g9', 4, 'Bash: ls', true), full: 'ls\nrm -rf x' };
      B.open.add('g9');
      B.items.push(both);
      B.svc.itemsChanged();
      await w.advance(50);
      check(
        'full 23: a tab, a carriage return, U+2028, a direction character, white space at a line end, a line break at the end, 1,201 characters, and an item too big for one message with its command: no `can2`, no `full`, and the list still arrives whole',
        notFull.every(([req]) => {
          const it = on(A, 'b-2', req);
          return (
            !!it &&
            it.can2 === undefined &&
            it.full === undefined &&
            it.can === undefined &&
            it.of === undefined
          );
        }) &&
          on(A, 'b-2', 'f1').can2 === true &&
          on(A, 'b-2', 'r5').can === true,
        notFull.map(([req]) => on(A, 'b-2', req))
      );
      check(
        'full 24: an item marked `whole` that also carries a command of several lines is `can` with the v1 binding and never `full`',
        on(A, 'b-2', 'g9').can === true &&
          on(A, 'b-2', 'g9').can2 === undefined &&
          on(A, 'b-2', 'g9').full === undefined &&
          on(A, 'b-2', 'g9').of === ofLocal(B, both)
      );
      mark = sentBy('b-2');
      for (const [req, , cmd] of notFull) {
        const it = B.items.find(x => x.id === 'permission:' + req);
        A.raw('b-2', {
          t: 'answer',
          id: it.id,
          of: bindingOf2({ ...baseOf(it), full: cmd }),
          say: 'yes',
        });
      }
      await w.advance(50);
      check(
        'full 23: a yes bound to each of those commands is refused (a reply each), nothing delivered',
        B.calls.length === calls0 &&
          sentBy('b-2') - mark === notFull.length &&
          notFull.every(([req]) => B.open.has(req)),
        [B.calls.length - calls0, sentBy('b-2') - mark]
      );
      mark = sentBy('b-2');
      for (const [req] of notFull) {
        const it = B.items.find(x => x.id === 'permission:' + req);
        A.raw('b-2', { t: 'answer', id: it.id, of: ofLocal(B, it), say: 'yes' });
      }
      await w.advance(50);
      check(
        'full 23: and so is a yes bound to each of their short lines (v1): such a request is not answerable in any form',
        B.calls.length === calls0 &&
          sentBy('b-2') - mark === notFull.length &&
          notFull.every(([req]) => B.open.has(req)),
        [B.calls.length - calls0, sentBy('b-2') - mark]
      );

      // the switch takes the command's text back
      B.svc.setAnswer('a-1', false);
      await w.advance(50);
      check(
        "full: the answer switch goes off: the item loses `can2` and the command's full text on the other computer",
        on(A, 'b-2', 'f1').can2 === undefined &&
          on(A, 'b-2', 'f1').full === undefined &&
          on(A, 'b-2', 'f1').detail === short &&
          A.svc.answer('b-2', long1.id, 'yes', v2).sent === 'not_sent'
      );
      B.svc.setAnswer('a-1', true);
      await w.advance(50);
      const again = on(A, 'b-2', 'f1'),
        pressed = A.svc.answer('b-2', long1.id, 'yes', again.of);
      await w.advance(50);
      check(
        'full 23: Allow once on the full command is delivered to that request, once, and logged with its short line',
        pressed.sent === 'sent' &&
          B.calls.length === calls0 + 1 &&
          B.calls.at(-1) === 'f1 once' &&
          on(A, 'b-2', 'f1') === null &&
          answeredLog(B)[0].text === short &&
          answeredLog(B)[0].say === 'yes' &&
          B.remembered.length === 0,
        [pressed.sent, B.calls.slice(calls0), answeredLog(B)[0]]
      );
      {
        // This computer's own record of an answer to a longer
        // command says how much more the command had than its short line.
        const cmd =
            'node tools/build.js ' + Array.from({ length: 60 }, (_, i) => '--step=' + i).join(' '),
          head = ('Bash: ' + cmd.slice(0, 93)).trimEnd();
        await w.advance(61000); // the answers above used up this minute's count
        const long2 = { ...perm('f2', 4, 'Bash: ' + cmd.slice(0, 93) + '…', false), full: cmd };
        B.open.add('f2');
        B.items.push(long2);
        B.svc.itemsChanged();
        await w.advance(50);
        const f2 = on(A, 'b-2', 'f2'),
          sent2 = f2 ? A.svc.answer('b-2', long2.id, 'no', f2.of).sent : 'no item';
        await w.advance(50);
        const rec = answeredLog(B)[0],
          m = /^(.*) … and ([\d,]+) more characters$/.exec(rec.text);
        check(
          'review 19, 1.1: the record of an answer to a command longer than its short line gives the line and how many characters more there were',
          sent2 === 'sent' &&
            rec.say === 'no' &&
            !!m &&
            m[1] === head &&
            Number(m[2].replace(/,/g, '')) === ('Bash: ' + cmd).length - head.length &&
            B.svc.state().answers[0].text === rec.text,
          [sent2, rec.text]
        );
        B.open.delete('f2');
        B.items = B.items.filter(it => it.id !== long2.id);
      }
      for (const req of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9']) B.open.delete(req);
      B.items = B.items.filter(it => !/^permission:g\d$/.test(it.id));
      delete B.names[9];
      B.svc.itemsChanged();
      await w.advance(61000);
      B.calls.length = calls0; // later checks count the answers delivered before these
      check(
        '(the list is as it was before these checks)',
        B.items[0].id === 'permission:r5' &&
          on(A, 'b-2', 'r5').can === true &&
          !A.pc('b-2').items.some(i => /^permission:[fg]\d$/.test(i.id))
      );
    }

    // 6 and 7. Every way a pairing stops or ends: the answer never reaches the rules, and the same
    // computer paired again starts with the switch off.
    const valid = () => ({
      t: 'answer',
      id: 'permission:r5',
      of: ofLocal(B, B.items[0]),
      say: 'yes',
    });

    // left = the answer must really have left A (so it is B that stops it, not A's own link)
    const unread = async (label, left) => {
      const got = seen.receives,
        n = B.calls.length;
      let went = false;
      try {
        went = A.raw('b-2', valid()) === true;
      } catch {
        /* no link */
      }
      await w.advance(200);
      check(
        '6: ' + label + ': the answer never reaches the rules, nothing delivered',
        seen.receives === got && B.calls.length === n && (went || !left),
        [seen.receives - got, B.calls.length - n, went]
      );
    };
    const again = async label => {
      await w.pair(A, B);
      await w.advance(500);
      check(
        '7: ' + label + ', paired again: the switch is off and nothing is answerable',
        !!B.pc('a-1') &&
          B.pc('a-1').answer === false &&
          B.pc('a-1').detail === true &&
          on(A, 'b-2', 'r5') &&
          on(A, 'b-2', 'r5').can === undefined,
        B.pc('a-1')
      );
      B.svc.setAnswer('a-1', true);
      await w.advance(50);
      check('7: (setup) on again for the new pairing', B.pc('a-1').answer === true);
    };

    // a paused pairing cannot be given the right (A asks B to forget C; B keeps it)
    {
      // the right is bound to the pairing: a stored id of another pairing (as an older pairing with
      // the same computer leaves it) is off
      B.svc.quit();
      const ks = keysMod.keyStore(B.backend),
        p = ks.note('prefs');
      p.answer['a-1'] = Buffer.alloc(16, 7).toString('base64');
      ks.setNote('prefs', p);
      B.svc = B.make();
      boot(B, () => B.svc.start());
      await w.advance(30000);
      const got = seen.receives;
      A.raw('b-2', { t: 'answer', id: 'permission:r5', of: ofLocal(B, B.items[0]), say: 'yes' });
      await w.advance(50);
      check(
        '7: a right stored for another pairing id of the same computer is off: no "can", the answer is not looked at',
        'a-1' in stored(B) &&
          B.pc('a-1').answer === false &&
          on(A, 'b-2', 'r5').can === undefined &&
          seen.receives === got &&
          B.calls.length === 4,
        [stored(B), B.pc('a-1').answer]
      );
      B.svc.setAnswer('a-1', true);
      await w.advance(50);
      check(
        "7: (setup) on again, now with this pairing's id",
        B.pc('a-1').answer === true && stored(B)['a-1'] !== Buffer.alloc(16, 7).toString('base64')
      );
    }
    B.svc.setAnswer('c-3', true);
    await w.advance(50);
    A.svc.forget('c-3');
    await w.advance(200);
    check(
      '6: a pause takes the right away, with a log line (review 11, finding 4)',
      B.pc('c-3').state === 'paused' &&
        !('c-3' in stored(B)) &&
        B.svc.state().log.some(e => e.kind === 'answer_off' && e.peer === 'c-3'),
      stored(B)
    );
    check(
      '6: a paused pairing cannot be given the right',
      B.svc.setAnswer('c-3', true).computers.find(x => x.id === 'c-3').answer === false &&
        !('c-3' in stored(B)),
      B.pc('c-3')
    );
    B.svc.choose('c-3', 'keep');
    await w.advance(3000);
    check(
      '6: Keep does not give it back: the user turns it on again',
      B.pc('c-3').state === 'live' &&
        B.pc('c-3').answer === false &&
        on(C, 'b-2', 'r5').can === undefined,
      B.pc('c-3')
    );

    // paused, then the user's Forget on the Keep or Forget question
    C.svc.forget('a-1');
    await w.advance(200);
    check(
      '6: (setup) B paused its pairing with A',
      B.pc('a-1').state === 'paused' && B.pc('a-1').items.length === 0
    );
    await unread('pairing paused', true);
    B.svc.choose('a-1', 'forget');
    await w.advance(200);
    check(
      '7: (setup) forgotten by the Keep or Forget choice; the pause had already removed the right',
      B.pc('a-1') === null && !('a-1' in stored(B)),
      stored(B)
    );
    await unread('pairing forgotten');
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Forget chosen on the question');

    // Forget from the Devices page
    B.svc.forget('a-1');
    await w.advance(200);
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Forget');

    // Stop everywhere, confirmed by the others
    B.svc.stopEverywhere();
    await unread('this computer stopping', true);
    await w.advance(500);
    check(
      '7: (setup) every computer confirmed the stop: B is off, and stopping removed the right',
      B.svc.state().on === false && !('a-1' in stored(B)),
      [B.svc.state().on, stored(B)]
    );
    await unread('remote off');
    A.svc.choose('b-2', 'forget');
    C.svc.choose('b-2', 'forget');
    await w.advance(200);
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    await again('a confirmed stop');

    // Stop everywhere with the other computer off: Finish anyway
    A.svc.setOn(false);
    await w.advance(50);
    B.svc.stopEverywhere();
    await w.advance(200);
    B.svc.finishAnyway();
    await w.advance(50);
    check(
      '7: (setup) finished anyway: B is off, and stopping removed the right',
      B.svc.state().on === false && !('a-1' in stored(B))
    );
    boot(A, () => A.svc.setOn(true));
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Finish anyway');

    // signed out
    B.svc.accountChanged(false);
    await unread('signed out');
    B.svc.accountChanged(true, 'acct-1');
    await w.advance(30000);
    check(
      '6: signed in again: the pairing and the right are as they were',
      B.pc('a-1')?.session === true && B.pc('a-1').answer === true,
      B.pc('a-1')
    );

    // another account on this Windows profile gets nothing of it
    B.svc.accountChanged(true, 'acct-2');
    await w.advance(200);
    let threw = '';
    try {
      boot(B, () => B.svc.setOn(true));
      B.svc.setAnswer('a-1', true);
      B.svc.state();
    } catch (e) {
      threw = String(e.message || e);
    }
    check(
      '2 (finding 2): the account-change reset clears the rights and leaves the switch usable',
      threw === '' && Object.keys(stored(B)).length === 0 && B.svc.state().computers.length === 0,
      [threw, stored(B)]
    );
    for (const c of [A, B, C]) c.svc.quit();
    await w.advance(120000);
    check('answer: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }

  // ---- full control: a prompt, an interrupt, a stop, a start from a paired computer
  // ---- Two stand-in computers and a third of the same name, through the
  // stand-in relay; the app's actions are stand-ins that count their calls. A number at the start
  // of a check is the numbered test of the design it belongs to; "switch" marks the
  // rules of the one full-control switch (change 17). What the rules themselves decide is proven in
  // tools/remote-control-test.js.
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Desk');
    seen.now = w.now;
    const wire0 = seen.wire.length;
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    }; // c.raw(to, obj): what a changed app on c could send
    for (const c of [A, B, C]) boot(c, () => c.svc.setOn(true));
    const KX = 'a'.repeat(40),
      KY = 'b'.repeat(40),
      KN = 'n' + 'c'.repeat(40);
    const panel = (name, more) => ({
      name,
      cli: 'Claude Code',
      mode: 'run',
      running: true,
      hand: false,
      instance: 'conv-' + name,
      pid: 4321,
      startedAt: 1700000000001,
      ...more,
    });

    // p1: an agent the app started. p2: a CLI typed by hand into a PowerShell panel. p3: a
    // Terminal. p4: a sign-in run. p5: no conversation id yet.
    B.panels = {
      p1: panel('Moss'),
      p2: panel('Typed', { hand: true }),
      p3: panel('Shell', { cli: 'Terminal' }),
      p4: panel('Sign-in', { mode: 'login' }),
      p5: panel('Fresh', { instance: '' }),
    };
    const rows = () =>
      Object.entries(B.panels).map(([id, p]) => ({
        id,
        name: p.name,
        cli: p.cli,
        status: 'idle',
        since: 1,
        p: p.key || KX,
      }));
    const relist = async () => {
      B.agents = rows();
      B.svc.agentsChanged();
      await w.advance(5000);
    };
    for (const c of [A, B, C]) c.key = KX;
    B.calls = [];
    B.answer = (id, decision) => {
      B.calls.push(id + ' ' + decision);
      return true;
    };

    // What B's list sender put on the wire for A since this block began: what a changed app on A
    // would have in hand.
    const toA = t => seen.wire.slice(wire0).filter(m => m.to === 'a-1' && m.obj.t === t);
    const rowSent = id => (toA('agents').at(-1)?.obj.agents || []).find(r => r.id === id);
    const ticket = id => rowSent(id)?.to || '';
    const fresh = () => {
      const m = seen.wire
        .slice(wire0)
        .filter(x => x.to === 'a-1' && x.obj.c)
        .at(-1);
      return m ? { c: m.obj.c, ms: w.t - m.at } : { c: 1, ms: 0 };
    };
    let nn = 0;
    const num = () => (++nn).toString(16).padStart(16, '0');
    const sentBy = id => w.sent.filter(t => JSON.parse(t).from === id).length;
    const stored = c => keysMod.keyStore(c.backend).note('prefs').control || {};
    const opOf = n => A.pc('b-2')?.ops.find(e => e.n === n) || null;
    const lines = () => B.svc.state().controlLog,
      did = () =>
        B.did.submit.length + B.did.interrupt.length + B.did.stop.length + B.did.start.length;
    const perm = (req, paneId, detail) => ({
      id: 'permission:' + req,
      paneId,
      kind: 'permission',
      tool: detail.split(':')[0],
      detail,
      whole: true,
      since: 1700000000000,
      inferred: false,
    });
    const ofLocal = it =>
      bindingOf(
        shape(
          {
            id: it.id,
            kind: it.kind,
            agent: 'Agent ' + it.paneId,
            detail: it.detail,
            since: it.since,
            inferred: it.inferred,
          },
          true
        )
      );

    // the last ticket B sent A for p1: what a changed app on A keeps using after the switch went
    // off
    let known = '';
    const note = () => {
      known = ticket('p1') || known;
      return known;
    };
    const TICKET = /^[0-9a-f]{16}$/;
    await w.advance(60000);
    await w.pair(A, B);
    await w.pair(C, B);
    await relist();
    B.items = [perm('r9', 4, 'Bash: npm test')];
    B.svc.itemsChanged();
    await w.advance(50);

    // The five messages a changed app on A could send (the fifth is the answer, which full control
    // includes). With the switch off for A none of them may be looked at. left = they must really
    // have left A (so it is B that stops them, not A's own link).
    const five = () => {
      const f = fresh(),
        to = known || 'f'.repeat(16);
      return [
        { t: 'prompt', ...f, n: num(), id: 'p1', to, text: 'Fix it' },
        { t: 'act', ...f, n: num(), id: 'p1', to, do: 'interrupt' },
        { t: 'act', ...f, n: num(), id: 'p1', to, do: 'stop' },
        { t: 'start', ...f, n: num(), cli: 'claude', project: KX, text: 'Go' },
        { t: 'answer', id: 'permission:r9', of: ofLocal(B.items[0]), say: 'yes' },
      ];
    };
    const tally = () => [
      seen.ctlReceives,
      seen.receives,
      seen.acts,
      B.calls.length,
      B.svc.controlLog().length,
      sentBy('b-2'),
    ];
    const silent = async (label, left) => {
      const was = tally();
      let went = 0;
      for (const m of five()) {
        try {
          if (A.raw('b-2', m) === true) went++;
        } catch {
          /* no link */
        }
      }
      await w.advance(200);
      check(
        '10: ' +
          label +
          ': a prompt, an interrupt, a stop, a start and an answer are not looked at: no reply, nothing done, no line',
        JSON.stringify(tally()) === JSON.stringify(was) && (went === 5 || !left),
        [was, tally(), went]
      );
    };

    // switch. Off by default.
    check(
      'switch: off by default: no right, no ticket, no counter, no "you may control", and the other computer shows nothing to press',
      B.pc('a-1').control === false &&
        B.pc('a-1').commands === false &&
        Object.keys(stored(B)).length === 0 &&
        toA('control').length === 0 &&
        toA('agents').length > 0 &&
        toA('agents').every(m => !('c' in m.obj) && m.obj.agents.every(r => !('to' in r))) &&
        A.pc('b-2').canControl === false &&
        A.pc('b-2').canStart.length === 0 &&
        A.pc('b-2').agents.length === 5 &&
        A.pc('b-2').agents.every(r => r.can === false),
      [B.pc('a-1'), A.pc('b-2')]
    );
    check(
      'switch: off: this computer sends nothing for a prompt, an interrupt, a stop or a start',
      A.svc.prompt('b-2', 'p1', 'Fix it').sent === 'not_sent' &&
        A.svc.act('b-2', 'p1', 'stop').sent === 'not_sent' &&
        A.svc.startOn('b-2', 'claude', '').sent === 'not_sent' &&
        A.pc('b-2').ops.length === 0
    );
    await silent('the switch off by default', true);
    {
      const h = {};
      registerIpc(
        {
          handle: (ch, fn) => {
            h[ch] = fn;
          },
        },
        B.svc
      );
      const tries = [
        await h['remote:setControl']({}, 'a-1', 'true'),
        await h['remote:setControl']({}, 'a-1', 1),
        await h['remote:setControl']({}, 'a-1', { on: true }),
      ];
      check(
        'switch: the channel of the window turns it on only for a real true',
        tries.every(
          r => r.ok === true && r.value.computers.find(x => x.id === 'a-1').control === false
        ) && Object.keys(stored(B)).length === 0,
        tries.map(r => r.ok)
      );
    }
    check(
      'switch: not for a computer that is not paired',
      B.svc.setControl('zz-9', true).computers.every(x => x.control === false) &&
        Object.keys(stored(B)).length === 0
    );
    B.svc.setDetail('a-1', false);
    check(
      'switch: not while the first switch (the text) is off',
      B.svc.setControl('a-1', true).computers.find(x => x.id === 'a-1').control === false &&
        Object.keys(stored(B)).length === 0
    );
    B.svc.setDetail('a-1', true);
    B.svc.setControl('a-1', true);
    await w.advance(5000);
    const pid = keysMod.keyStore(B.backend).pairing('a-1').pairingId.toString('base64');
    check(
      'switch: on for A only, stored as the id of that pairing, and in the activity log',
      B.pc('a-1').control === true &&
        B.pc('c-3').control === false &&
        stored(B)['a-1'] === pid &&
        Object.keys(stored(B)).length === 1 &&
        B.svc.state().log.some(e => e.kind === 'control_on' && e.peer === 'a-1'),
      stored(B)
    );
    check(
      'switch: it brings the answer right (nothing is written for it), and the card can say once "can run commands on this computer"',
      B.pc('a-1').answer === true &&
        B.pc('a-1').commands === true &&
        !('a-1' in (keysMod.keyStore(B.backend).note('prefs').answer || {})) &&
        A.pc('b-2').items.find(i => i.id === 'permission:r9')?.can === true &&
        B.pc('c-3').commands === false &&
        C.pc('b-2').items[0].can === undefined,
      B.pc('a-1')
    );
    check(
      'switch: A is told it may control, which CLIs can be started, and which agents; C is told nothing',
      A.pc('b-2').canControl === true &&
        A.pc('b-2').canStart.join() === 'claude,codex' &&
        A.pc('b-2').agents.find(r => r.id === 'p1').can === true &&
        C.pc('b-2').canControl === false &&
        C.pc('b-2').agents.every(r => r.can === false) &&
        !seen.wire
          .slice(wire0)
          .some(
            m =>
              m.to === 'c-3' &&
              (m.obj.t === 'control' || 'c' in m.obj || (m.obj.agents || []).some(r => 'to' in r))
          ),
      A.pc('b-2')
    );
    check(
      '7: an agent the app started carries a ticket; a CLI typed by hand, a Terminal, a sign-in run and a panel without a conversation carry none and cannot be pressed',
      TICKET.test(ticket('p1')) &&
        ['p2', 'p3', 'p4', 'p5'].every(
          id =>
            rowSent(id) &&
            !('to' in rowSent(id)) &&
            A.pc('b-2').agents.find(r => r.id === id).can === false
        ),
      toA('agents').at(-1)
    );
    check(
      'the window is never given a ticket',
      !JSON.stringify(A.svc.state()).includes(ticket('p1')) &&
        !JSON.stringify(A.last).includes(ticket('p1')) &&
        A.pc('b-2').agents.every(r => !('to' in r))
    );
    note();
    {
      const it = A.pc('b-2').items.find(i => i.id === 'permission:r9');
      A.svc.answer('b-2', it.id, 'yes', it.of);
      await w.advance(50);
    }
    check(
      'switch: with full control alone a permission question is answered from A',
      B.calls.length === 1 && B.calls[0] === 'r9 once',
      B.calls
    );
    B.svc.setAnswer('c-3', true);
    await w.advance(50);
    check(
      'switch: the "may answer" switch still works alone: the answer right, no control',
      B.pc('c-3').answer === true &&
        B.pc('c-3').control === false &&
        B.pc('c-3').commands === false &&
        C.pc('b-2').canControl === false &&
        C.pc('b-2').items[0].can === true,
      B.pc('c-3')
    );
    {
      const was = seen.ctlReceives,
        n = sentBy('b-2');
      C.raw('b-2', { t: 'prompt', ...fresh(), n: num(), id: 'p1', to: known, text: 'Fix it' });
      await w.advance(50);
      check(
        'switch: a computer with only "may answer", using a ticket that is not its own: its prompt is not looked at',
        seen.ctlReceives === was && sentBy('b-2') === n && did() === 0
      );
    }
    B.svc.setAnswer('c-3', false);
    A.key = KN;
    A.svc.projectChanged();
    check(
      'a start is offered only for a git project open here: not for a plain folder',
      A.pc('b-2').canStart.length === 0 && A.svc.startOn('b-2', 'claude', '').sent === 'no_project'
    );
    A.key = KX;
    A.svc.projectChanged();

    // Review 13, finding 8: a press is carried out only for the very agent the page had drawn (the
    // row's `mark`).
    {
      const row = A.pc('b-2').agents.find(r => r.id === 'p1'),
        n = B.did.submit.length + B.did.stop.length,
        sent0 = sentBy('a-1');
      const want = require('crypto')
        .createHash('sha256')
        .update(require('../desktop/remote-noise.js').fields('tnai-row-v1', ticket('p1')))
        .digest('hex')
        .slice(0, 12);
      check(
        "review 13, 8: every agent row the window gets carries a mark: 12 hex characters made from the row's ticket, never the ticket; a row that cannot be controlled has none",
        /^[0-9a-f]{12}$/.test(row.mark) &&
          row.mark === want &&
          row.mark !== ticket('p1').slice(0, 12) &&
          A.pc('b-2')
            .agents.filter(r => !r.can)
            .every(r => r.mark === '') &&
          C.pc('b-2').agents.every(r => r.mark === ''),
        row
      );
      const tries = [
        A.svc.prompt('b-2', 'p1', 'Fix it', ''),
        A.svc.prompt('b-2', 'p1', 'Fix it', '0'.repeat(12)),
        A.svc.prompt('b-2', 'p1', 'Fix it', null),
        A.svc.prompt('b-2', 'p1', 'Fix it', ticket('p1')),
        A.svc.act('b-2', 'p1', 'stop', ''),
        A.svc.act('b-2', 'p1', 'interrupt', 'f'.repeat(12)),
      ];
      await w.advance(50);
      check(
        'review 13, 8: a prompt or a stop with no mark, another mark, or the ticket itself in its place: nothing is sent, and the page is told "changed"',
        tries.every(r => r.sent === 'changed' && r.n === '') &&
          sentBy('a-1') === sent0 &&
          B.did.submit.length + B.did.stop.length === n &&
          A.pc('b-2').ops.length === 0,
        tries.map(r => r.sent)
      );
      check(
        'review 13, 8: a row that cannot be controlled says "not_sent" as before, and a prompt that is no word says so first',
        A.svc.prompt('b-2', 'p2', 'Fix it', row.mark).sent === 'not_sent' &&
          A.svc.act('b-2', 'p9', 'stop', row.mark).sent === 'not_sent' &&
          A.svc.prompt('b-2', 'p1', '/clear', '').sent === 'no_word'
      );

      // The agent under the row was restarted: the page still shows the older list (and holds the
      // older mark) when its user presses.
      const stale = row.mark;
      B.panels.p1 = { ...B.panels.p1, pid: 7777, startedAt: 1700000007777 };
      await relist();
      const now = A.pc('b-2').agents.find(r => r.id === 'p1');
      check(
        'review 13, 8: the agent under that row was restarted on B: its mark is another one, and a press made with the older mark sends nothing',
        now.mark !== stale &&
          /^[0-9a-f]{12}$/.test(now.mark) &&
          A.svc.prompt('b-2', 'p1', 'Fix it', stale).sent === 'changed' &&
          A.svc.act('b-2', 'p1', 'stop', stale).sent === 'changed' &&
          B.did.submit.length + B.did.stop.length === n,
        [stale, now.mark]
      );
      B.panels.p1 = panel('Moss');
      await relist();
      note();
    }

    // An honest prompt, end to end.
    const first = A.svc.prompt('b-2', 'p1', 'Fix the login page');
    check(
      'prompt: it left this computer, which shows it as asked',
      first.sent === 'asked' && TICKET.test(first.n) && opOf(first.n).state === 'asked',
      first.sent
    );
    await w.advance(50);
    const got = B.did.submit[0];
    check(
      "16: the action is handed the panel, the text, this computer's own name for the sender, a key, a guard and a way to say how it ended, and nothing else",
      B.did.submit.length === 1 &&
        Object.keys(got).sort().join() === 'done,from,guard,key,panelId,tail,text' &&
        got.tail ===
          '' /* tail: this computer's own words for files that came with a prompt; empty for a plain prompt */ &&
        got.panelId === 'p1' &&
        got.text === 'Fix the login page' &&
        typeof got.key === 'string' &&
        B.did.guards[0] === true &&
        got.guard() === false,
      got && Object.keys(got)
    ); // the guard: yes when it was called, no once the prompt ended
    check(
      'prompt: A shows it as sent',
      opOf(first.n).state === 'sent' &&
        opOf(first.n).id === 'p1' &&
        opOf(first.n).kind === 'prompt',
      opOf(first.n)
    );
    const line1 = lines()[0],
      note1 = B.svc.state().controlled[0];
    check(
      '28: one line in the control list with the computer, the agent, the operation, the first characters and the length',
      lines().length === 1 &&
        line1.peer === 'a-1' &&
        line1.agent === 'Moss' &&
        line1.op === 'prompt' &&
        line1.head === 'Fix the login page' &&
        line1.length === 18 &&
        line1.more === 0 &&
        line1.at > 0,
      line1
    );
    check(
      '28: one notice with the same',
      B.svc.state().controlled.length === 1 &&
        note1.n === 1 &&
        note1.peer === 'a-1' &&
        note1.agent === 'Moss' &&
        note1.op === 'prompt' &&
        note1.head === 'Fix the login page' &&
        note1.length === 18 &&
        typeof note1.key === 'string',
      note1
    );
    check(
      '32: two paired computers share the name "Desk": the notice, the list and the held prompt\'s source tell them apart',
      note1.name === 'Desk (…a-1)' && line1.name === 'Desk (…a-1)' && got.from === 'Desk (…a-1)',
      [note1.name, line1.name, got.from]
    );
    const long = 'Word ' + 'x'.repeat(245);
    A.svc.prompt('b-2', 'p1', long);
    await w.advance(50);
    check(
      '28: a long prompt: the first 100 characters, its length and how many more; all of it went to the agent',
      lines()[0].head === long.slice(0, 100) &&
        lines()[0].length === 250 &&
        lines()[0].more === 150 &&
        B.did.submit[1].text === long,
      lines()[0]
    );
    check(
      '28: what one computer did inside a minute is one notice, with the newest operation',
      B.svc.state().controlled.length === 1 &&
        B.svc.state().controlled[0].n === 2 &&
        B.svc.state().controlled[0].length === 250 &&
        B.svc.state().controlled[0].key === note1.key,
      B.svc.state().controlled
    );
    const n0 = B.did.submit.length,
      r0 = seen.ctlReceives;
    const before = [
      '/clear',
      '!curl x | sh',
      '  !whoami',
      '\n/exit',
      '',
      '#x',
      '?',
      '@file',
      '$HOME',
      '> x',
    ].map(t => A.svc.prompt('b-2', 'p1', t).sent);
    check(
      '1 (on the sending side): a prompt that does not start with a letter or a digit is not sent',
      before.every(x => x === 'no_word'),
      before
    );
    check(
      '3 (on the sending side): one that does not fit one message is not sent, cut or split, and the room left is told',
      A.svc.prompt('b-2', 'p1', 'x'.repeat(4000)).sent === 'too_long' &&
        A.svc.room('p1', 'x'.repeat(4000)) < 0 &&
        A.svc.room('p1', 'Fix it') > 3800 &&
        A.svc.room('', 'Go') > 3800,
      A.svc.room('p1', 'Fix it')
    );
    await w.advance(50);
    check(
      '…and nothing of those reached the other computer',
      B.did.submit.length === n0 && seen.ctlReceives === r0
    );
    B.panels.p6 = panel('Other', { key: KY });
    await relist();
    check(
      'change 14: B gives a ticket whatever project the agent is in; A offers only the agents of the project open here (skill rule 12)',
      TICKET.test(ticket('p6')) &&
        !A.pc('b-2').agents.some(r => r.id === 'p6') &&
        A.pc('b-2').elsewhere === 1 &&
        A.svc.prompt('b-2', 'p6', 'Hello').sent === 'not_sent' &&
        A.svc.act('b-2', 'p6', 'stop').sent === 'not_sent',
      A.pc('b-2').agents.map(r => r.id)
    );
    delete B.panels.p6;
    await relist();

    // Interrupt and stop.
    const i1 = A.svc.act('b-2', 'p1', 'interrupt');
    await w.advance(50);
    check(
      'interrupt: the action gets the panel and a guard, once; A is told "done"; a line with the agent',
      B.did.interrupt.length === 1 &&
        B.did.interrupt[0].panelId === 'p1' &&
        B.did.interrupt[0].guard() === true &&
        opOf(i1.n).state === 'done' &&
        opOf(i1.n).do === 'interrupt' &&
        lines()[0].op === 'interrupt' &&
        lines()[0].agent === 'Moss' &&
        lines()[0].length === 0,
      lines()[0]
    );
    B.onInterrupt = () => 'unsent';
    const i2 = A.svc.act('b-2', 'p1', 'interrupt');
    await w.advance(50);
    B.onInterrupt = () => 'done';
    check(
      'interrupt: "the task\'s prompt is back in its input" crosses as its own word (change 12)',
      opOf(i2.n).state === 'unsent',
      opOf(i2.n)
    );
    const s1 = A.svc.act('b-2', 'p1', 'stop');
    await w.advance(50);
    check(
      'stop: the action gets the panel and a guard, once; A is told "done"; a line',
      B.did.stop.length === 1 &&
        B.did.stop[0].panelId === 'p1' &&
        B.did.stop[0].guard() === true &&
        opOf(s1.n).state === 'done' &&
        lines()[0].op === 'stop' &&
        B.did.submit.length === n0 &&
        B.did.interrupt.length === 2,
      lines()[0]
    );

    // 27. Only fixed words cross.
    const odd = [];
    for (const how of [
      () => 'draft: The user is speaking a prompt',
      () => {
        throw new Error('C:\\Users\\me\\secret failed');
      },
      () => ({ ok: true, state: 'sent', reason: 'secret' }),
      () => Promise.reject(new Error('secret')),
    ]) {
      B.submit = how;
      const r = A.svc.prompt('b-2', 'p1', 'Try ' + odd.length);
      await w.advance(50);
      odd.push(opOf(r.n).state);
    }
    check(
      '27: whatever the action returns or throws, only a fixed word crosses: a sentence, an error, an object and a rejection read as "failed"',
      odd.length === 4 &&
        odd.every(x => x === 'failed') &&
        !/speaking|secret|draft/.test(JSON.stringify(A.svc.state())),
      odd
    );
    B.submit = () => 'unconfirmed';
    const unc = A.svc.prompt('b-2', 'p1', 'No sign');
    await w.advance(50);
    B.submit = () => 'sent';
    check(
      '27: the delivery word "unconfirmed" (Enter pressed once, no sign from the CLI) crosses as itself: never "failed", which would invite a second send, and never "sent"',
      opOf(unc.n).state === 'unconfirmed',
      opOf(unc.n)
    );
    {
      let later = null;
      B.submit = o => {
        later = o;
        return 'queued';
      };
      const r = A.svc.prompt('b-2', 'p1', 'Held, then no sign');
      await w.advance(50);
      B.submit = () => 'sent';
      const mid = opOf(r.n).state;
      later.done('unconfirmed');
      await w.advance(50);
      check(
        '27: a held prompt that ends on "unconfirmed" says so on A',
        mid === 'queued' && opOf(r.n).state === 'unconfirmed',
        [mid, opOf(r.n)]
      );
    }
    {
      const n = B.did.submit.length,
        l = keysMod.keyStore(B.backend).note('ops').length;
      B.noWrite = true;
      const r = A.svc.prompt('b-2', 'p1', 'Not written down');
      await w.advance(50);
      B.noWrite = false;
      check(
        '28: an operation whose line cannot be written is not carried out, and A is told it failed',
        B.did.submit.length === n &&
          keysMod.keyStore(B.backend).note('ops').length === l &&
          opOf(r.n).state === 'failed',
        [B.did.submit.length - n, opOf(r.n)]
      );
    }
    const calm = JSON.stringify(A.pc('b-2'));
    for (const m of [
      { t: 'prompted', n: num(), ok: true, state: 'sent' },
      { t: 'started', n: first.n, ok: true },
      { t: 'acted', n: first.n, ok: true, state: 'done' },
      { t: 'prompted', n: first.n, ok: false, state: 'failed' },
      { t: 'prompted', n: { a: 1 }, ok: true, state: ['sent'] },
      { t: 'started', n: num(), ok: false, why: 'x'.repeat(3000) },
    ])
      B.raw('a-1', m);
    await w.advance(50);
    check(
      '27: a reply nobody asked for, of another kind, or after the last word changes nothing on A',
      JSON.stringify(A.pc('b-2')) === calm,
      A.pc('b-2').ops
    );
    await w.advance(61000);

    // 7. Forged, borrowed and old tickets.
    const old = note(),
      before7 = did();
    let mark = sentBy('b-2'),
      r1 = seen.ctlReceives;
    const forged = [
      { t: 'prompt', id: 'p2', to: 'f'.repeat(16), text: 'Fix it' },
      { t: 'prompt', id: 'p2', to: old, text: 'Fix it' },
      { t: 'prompt', id: 'p3', to: old, text: 'dir' },
      { t: 'act', id: 'p2', to: old, do: 'stop' },
      { t: 'act', id: 'p3', to: old, do: 'stop' },
      { t: 'act', id: 'p4', to: old, do: 'interrupt' },
    ];
    for (const m of forged) A.raw('b-2', { ...m, ...fresh(), n: num() });
    await w.advance(50);
    check(
      '7: a prompt, an interrupt and a stop for a typed CLI, a Terminal and a sign-in run, with a forged or a borrowed ticket: each refused, no action called',
      did() === before7 &&
        seen.ctlReceives - r1 === forged.length &&
        sentBy('b-2') - mark === forged.length,
      [did() - before7, seen.ctlReceives - r1, sentBy('b-2') - mark]
    );

    // restarted in the same panel; the list with its new ticket has not left yet
    B.panels.p1 = { ...B.panels.p1, pid: 5555, startedAt: 1700000009999 };
    mark = sentBy('b-2');
    A.raw('b-2', { t: 'prompt', ...fresh(), n: num(), id: 'p1', to: old, text: 'Fix it' });
    A.raw('b-2', { t: 'act', ...fresh(), n: num(), id: 'p1', to: old, do: 'stop' });
    await w.advance(50);
    check(
      '7: the ticket of the process that ran in that panel before: refused, nothing written, nothing stopped',
      did() === before7 && sentBy('b-2') - mark === 2,
      [did() - before7, sentBy('b-2') - mark]
    );

    // 9. What ends a ticket.
    const tickets = new Set([old]);
    const next = async () => {
      await relist();
      const t = ticket('p1'),
        isNew = TICKET.test(t) && !tickets.has(t);
      tickets.add(t);
      return isNew;
    };
    const nine = [await next()];
    B.panels.p1 = { ...B.panels.p1, name: 'Moss 2' };
    nine.push(await next());
    B.panels.p1 = { ...B.panels.p1, instance: 'conv-new' };
    nine.push(await next());
    B.panels.p1 = { ...B.panels.p1, cli: 'Codex' };
    nine.push(await next());
    B.svc.quit();
    await w.advance(50);
    B.svc = B.make();
    boot(B, () => B.svc.start());
    await w.advance(30000);
    nine.push(await next());
    check(
      "9: a restart of the same conversation, a rename, a new conversation, another connection and this computer's own restart each end the ticket",
      nine.every(Boolean) && tickets.size === 6 && B.pc('a-1').control === true,
      [nine, tickets.size]
    );
    const plain = require('crypto')
      .createHash('sha256')
      .update(
        require('../desktop/remote-noise.js').fields(
          'tnai-agent-v1',
          pid,
          'p1',
          B.panels.p1.instance,
          B.panels.p1.name,
          B.panels.p1.cli
        )
      )
      .digest('hex')
      .slice(0, 16);
    check(
      '9: the ticket is not the plain hash of what A knows about the row; a panel without a conversation still has none',
      ticket('p1') !== plain && !('to' in rowSent('p5'))
    );
    B.panels.p1 = panel('Moss');
    await relist();
    note();
    await w.advance(61000);

    // 14. One number, one delivery; the limits; a message of the wrong shape counts.
    const same = { t: 'prompt', n: num(), id: 'p1', text: 'Only once' },
      n14 = B.did.submit.length;
    mark = sentBy('b-2');
    A.raw('b-2', { ...same, ...fresh(), to: known });
    A.raw('b-2', { ...same, ...fresh(), to: known });
    await w.advance(50);
    check(
      '14: the same number twice in one session: one delivery, the second refused',
      B.did.submit.length === n14 + 1 && sentBy('b-2') - mark === 2,
      [B.did.submit.length - n14, sentBy('b-2') - mark]
    );
    A.svc.setOn(false);
    await w.advance(50);
    boot(A, () => A.svc.setOn(true));
    await w.advance(3000);
    A.raw('b-2', { ...same, ...fresh(), to: note() });
    await w.advance(50);
    B.svc.setOn(false);
    await w.advance(50);
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    A.raw('b-2', { ...same, ...fresh(), to: note() });
    await w.advance(50);
    check(
      '14: the same number after a new session, and after this computer connected off and on: still one delivery',
      B.did.submit.length === n14 + 1 && B.pc('a-1').control === true && ticket('p1') === known,
      [B.did.submit.length - n14, ticket('p1'), known]
    );
    await w.advance(61000);
    mark = sentBy('b-2');
    const replies = async () => {
      await w.advance(50);
      const n = sentBy('b-2') - mark;
      mark = sentBy('b-2');
      return n;
    };
    const d14 = did();
    for (let i = 0; i < 13; i++)
      A.raw('b-2', {
        t: 'prompt',
        ...fresh(),
        n: num(),
        id: 'p1',
        to: 'f'.repeat(16),
        text: 'Fix it',
      });
    const overP = await replies();
    for (let i = 0; i < 7; i++)
      A.raw('b-2', { t: 'act', ...fresh(), n: num(), id: 'p1', to: 'f'.repeat(16), do: 'stop' });
    const overA = await replies();
    for (let i = 0; i < 5; i++)
      A.raw('b-2', { t: 'start', ...fresh(), n: num(), cli: 'claude', project: KY });
    const overS = await replies();
    check(
      '14: past each limit there is no reply: 10 prompts, 4 interrupts or stops and 3 starts a minute',
      overP === 10 && overA === 4 && overS === 3 && did() === d14,
      [overP, overA, overS]
    );
    await w.advance(61000);
    mark = sentBy('b-2');
    for (let i = 0; i < 10; i++)
      A.raw(
        'b-2',
        i % 2 ? { t: 'prompt' } : { t: 'prompt', n: 'x', id: { a: 1 }, text: ['x'], to: 7 }
      );
    A.raw('b-2', { t: 'prompt', ...fresh(), n: num(), id: 'p1', to: known, text: 'One too many' });
    check(
      '14: ten messages of the wrong shape count: the valid one after them gets no reply and is not delivered',
      (await replies()) === 0 && did() === d14,
      did() - d14
    );

    // 15. A start that must be refused. (A start's own limit is 6 in 10 minutes, so these wait for
    // the ones above to age out.)
    await w.advance(10 * 60000 + 1000);
    const start = more => ({
        t: 'start',
        ...fresh(),
        n: num(),
        cli: 'claude',
        project: KX,
        ...more,
      }),
      refusals = [];
    const tryStart = async (setup, msg) => {
      setup();
      const m = sentBy('b-2'),
        n = B.did.start.length;
      A.raw('b-2', msg());
      await w.advance(50);
      refusals.push(sentBy('b-2') - m === 1 && B.did.start.length === n);
    };
    await tryStart(
      () => {
        B.key = '';
      },
      () => start({})
    ); // no folder open there, or its key not known yet
    await tryStart(
      () => {
        B.key = KN;
      },
      () => start({ project: KN })
    ); // a folder without git: only the name form of a key
    await tryStart(
      () => {
        B.key = KY;
      },
      () => start({})
    ); // another project is open there
    await w.advance(61000);
    await tryStart(
      () => {
        B.key = KX;
        B.clis = ['Codex'];
      },
      () => start({})
    ); // that CLI is not installed or signed in there
    await tryStart(
      () => {
        B.clis = ['Claude Code', 'Codex'];
      },
      () => start({ cli: 'constructor' })
    );
    check(
      '15: no folder open or its key not known, a name-form key, another project, a CLI that is not ready, "constructor": each refused, no panel',
      refusals.length === 5 && refusals.every(Boolean) && B.did.start.length === 0,
      refusals
    );
    check(
      '15 (on the sending side): a CLI that computer did not list, and a first prompt that is no word, are not sent',
      A.svc.startOn('b-2', 'opencode', '').sent === 'not_sent' &&
        A.svc.startOn('b-2', 'constructor', '').sent === 'not_sent' &&
        A.svc.startOn('b-2', 'claude', '/clear').sent === 'no_word'
    );
    const st = A.svc.startOn('b-2', 'codex', 'Write the tests');
    await w.advance(50);
    check(
      "16: a start hands the action one of four CLI names, the first prompt, the sender's name and a guard: no model, effort, name or folder",
      B.did.start.length === 1 &&
        Object.keys(B.did.start[0]).sort().join() === 'cli,from,guard,text' &&
        B.did.start[0].cli === 'Codex' &&
        B.did.start[0].text === 'Write the tests' &&
        B.did.start[0].guard(KX) === true &&
        opOf(st.n).state === 'started' &&
        opOf(st.n).cli === 'codex' &&
        lines()[0].op === 'start' &&
        lines()[0].agent === 'Codex' &&
        lines()[0].head === 'Write the tests',
      B.did.start[0] && Object.keys(B.did.start[0])
    );

    // 17. How many panels started from other computers are still open is asked of the app at each
    // start.
    await w.advance(10 * 60000 + 1000);
    B.started = 3;
    const full = A.svc.startOn('b-2', 'claude', '');
    await w.advance(50);
    B.started = 2;
    const fits = A.svc.startOn('b-2', 'claude', '');
    await w.advance(50);
    check(
      '17: three panels started from other computers are still open: the fourth is refused; with two open it is taken',
      opOf(full.n).state === 'refused' &&
        opOf(fits.n).state === 'started' &&
        B.did.start.length === 2 &&
        B.did.start[1].text === '',
      [opOf(full.n), opOf(fits.n)]
    );

    // 20. The switch goes off while a start waits for its panel.
    let waiting = null;
    B.onStart = o =>
      new Promise(res => {
        waiting = { o, res };
      });
    const slow = A.svc.startOn('b-2', 'codex', 'Go on');
    await w.advance(50);
    check(
      '20: (setup) the start waits for its panel; its guard holds for this project only',
      !!waiting &&
        waiting.o.guard(KX) === true &&
        waiting.o.guard(KY) === false &&
        waiting.o.guard('') === false &&
        opOf(slow.n).state === 'asked'
    );
    B.locked = true;
    const lockedStart = waiting.o.guard(KX);
    B.locked = false;
    check(
      '20, 31: the plan locks during the wait: the guard says no; unlocked it holds again',
      lockedStart === false && waiting.o.guard(KX) === true
    );
    B.svc.setControl('a-1', false);
    check(
      '20: the switch went off during the wait: the guard says no, so no first prompt goes in',
      waiting.o.guard(KX) === false
    );
    waiting.res('failed');
    await w.advance(50);
    B.onStart = () => 'started';
    check('20: and A is told it failed', opOf(slow.n).state === 'failed', opOf(slow.n));
    B.svc.setControl('a-1', true);
    await relist();
    note();

    // 30. A relay that holds a message back and hands it over later.
    await w.advance(61000);
    const n30 = B.did.submit.length;
    w.held = [];
    const lateP = A.svc.prompt('b-2', 'p1', 'Held by the relay');
    await w.advance(61000);
    {
      const q = w.held;
      w.held = null;
      w.queue.push(...q);
    }
    await w.advance(50);
    check(
      '30: a prompt the relay handed over 61 s after it was made: refused, nothing written; A said "no reply" meanwhile and "refused" then',
      B.did.submit.length === n30 && opOf(lateP.n).state === 'refused',
      opOf(lateP.n)
    );
    w.held = [];
    const slowP = A.svc.prompt('b-2', 'p1', 'A slow relay');
    await w.advance(50000);
    {
      const q = w.held;
      w.held = null;
      w.queue.push(...q);
    }
    await w.advance(50);
    check(
      '30: one that took 50 s is still taken',
      B.did.submit.length === n30 + 1 && opOf(slowP.n).state === 'sent',
      opOf(slowP.n)
    );

    // 31. The plan lock on B.
    await w.advance(61000);
    B.locked = true;
    B.svc.controlChanged();
    await w.advance(5000);
    check(
      '31: plan locked on B: A is told there is nothing to control (the switch itself stays on), and sends nothing',
      A.pc('b-2').canControl === false &&
        A.pc('b-2').agents.every(r => r.can === false) &&
        B.pc('a-1').control === true &&
        ticket('p1') === '' &&
        A.svc.prompt('b-2', 'p1', 'Fix it').sent === 'not_sent',
      A.pc('b-2')
    );
    mark = sentBy('b-2');
    const d31 = did(),
      l31 = B.svc.controlLog().length,
      r31 = seen.ctlReceives;
    A.raw('b-2', { t: 'prompt', ...fresh(), n: num(), id: 'p1', to: known, text: 'Fix it' });
    A.raw('b-2', { t: 'act', ...fresh(), n: num(), id: 'p1', to: known, do: 'interrupt' });
    A.raw('b-2', { t: 'act', ...fresh(), n: num(), id: 'p1', to: known, do: 'stop' });
    A.raw('b-2', { t: 'start', ...fresh(), n: num(), cli: 'claude', project: KX });
    await w.advance(50);
    check(
      '31: plan locked: a prompt, an interrupt, a stop and a start with a ticket that was good are each refused before anything is taken: no action, no line',
      sentBy('b-2') - mark === 4 &&
        seen.ctlReceives - r31 === 4 &&
        did() === d31 &&
        B.svc.controlLog().length === l31,
      [sentBy('b-2') - mark, did() - d31, B.svc.controlLog().length - l31]
    );
    B.locked = false;
    B.svc.controlChanged();
    await w.advance(5000);
    check(
      '31: unlocked: the agents can be pressed again, with the ticket they had',
      A.pc('b-2').canControl === true &&
        A.pc('b-2').agents.find(r => r.id === 'p1').can === true &&
        ticket('p1') === known,
      [ticket('p1'), known]
    );

    // 28. Many operations: the activity log keeps its pairing lines, the control list is bounded,
    // the window gets the newest lines.
    for (let round = 0; round < 50; round++) {
      await w.advance(61000);
      for (let i = 0; i < 10; i++) A.svc.prompt('b-2', 'p1', 'Round ' + round + ' prompt ' + i);
      await w.advance(50);
    }
    check(
      '28: 500 prompts later the pairing lines are still in the activity log, which holds no operation',
      B.svc.state().log.filter(e => e.kind === 'paired').length === 2 &&
        !B.svc.state().log.some(e => e.op || e.head),
      B.svc.state().log.map(e => e.kind)
    );
    check(
      '28: the control list keeps its newest 500 lines; the window gets 50 with every state, the count, and all of them when it asks',
      B.svc.controlLog().length === 500 &&
        B.svc.controlLog()[0].head === 'Round 49 prompt 9' &&
        B.svc.state().controlLog.length === 50 &&
        B.svc.state().controlTotal === 500 &&
        B.svc.state().controlled[0].n === 10 &&
        B.svc.state().controlled.length <= 8,
      [B.svc.controlLog().length, B.svc.state().controlled.length]
    );
    check(
      '28: the list survives a restart, in the encrypted store',
      keysMod.keyStore(B.backend).note('ops').length === 500 && !/Round 49/.test(B.disk.text)
    );

    // 10 and 11. Every way the switch goes off: at once nothing held stays, and from then on
    // nothing is looked at.
    let hold = null,
      heldOp = null;
    const holdOne = async () => {
      await w.advance(61000);
      B.submit = o => {
        hold = o;
        return 'queued';
      };
      heldOp = A.svc.prompt('b-2', 'p1', 'Held ' + num());
      await w.advance(50);
      B.submit = () => 'sent';
      return !!hold && opOf(heldOp.n)?.state === 'queued' && hold.guard() === true;
    };
    const gone = (label, logged = true) =>
      check(
        '11: ' +
          label +
          ': the prompt held for that computer is removed at once and can never be written',
        B.did.cancel.includes(hold.key) &&
          hold.guard() === false &&
          (!logged || B.svc.controlLog()[0]?.op === 'dropped'),
        [B.did.cancel.at(-1), hold.key, B.svc.controlLog()[0]]
      );
    const again = async label => {
      await w.pair(A, B);
      await w.advance(500);
      check(
        'switch: ' +
          label +
          ', paired again: full control and the answer right are off and nothing can be pressed',
        !!B.pc('a-1') &&
          B.pc('a-1').control === false &&
          B.pc('a-1').answer === false &&
          B.pc('a-1').detail === true &&
          !('a-1' in stored(B)) &&
          A.pc('b-2').canControl === false,
        B.pc('a-1')
      );
      await silent(label + ', paired again', true);
      B.svc.setControl('a-1', true);
      await relist();
      const t = ticket('p1');
      check(
        "9: on again for the new pairing: its ticket is not the old pairing's",
        B.pc('a-1').control === true && TICKET.test(t) && !tickets.has(t),
        t
      );
      tickets.add(t);
      note();
    };

    // by hand
    check('11: (setup) a prompt is held on B, and A shows it as queued', await holdOne());
    B.svc.setControl('a-1', false);
    gone('switched off by hand');
    check(
      'switch: off by hand: off, not stored, in the activity log, and the answer right it brought is gone with it',
      B.pc('a-1').control === false &&
        B.pc('a-1').answer === false &&
        B.pc('a-1').commands === false &&
        !('a-1' in stored(B)) &&
        B.svc.state().log[0].kind === 'control_off',
      B.pc('a-1')
    );
    await w.advance(50);
    check(
      '11: A is told the held prompt failed, and that there is nothing to control or answer any more',
      opOf(heldOp.n).state === 'failed' &&
        A.pc('b-2').canControl === false &&
        A.pc('b-2').agents.every(r => r.can === false) &&
        A.pc('b-2').items.find(i => i.id === 'permission:r9').can === undefined,
      [opOf(heldOp.n), A.pc('b-2').canControl]
    );
    await silent('switched off by hand', true);
    B.svc.setControl('a-1', true);
    B.svc.setAnswer('a-1', true);
    B.svc.setControl('a-1', false);
    check(
      'switch: "may answer" turned on by itself stays when full control goes off',
      B.pc('a-1').answer === true &&
        B.pc('a-1').control === false &&
        B.pc('a-1').commands === false,
      B.pc('a-1')
    );
    B.svc.setAnswer('a-1', false);
    B.svc.setControl('a-1', true);
    await relist();
    note();

    // with the first switch
    check('11: (setup) held', await holdOne());
    B.svc.setDetail('a-1', false);
    gone('the first switch turned off');
    check(
      'switch: turning the text off takes full control with it, with a line in the activity log',
      B.pc('a-1').control === false &&
        !('a-1' in stored(B)) &&
        B.svc.state().log[0].kind === 'control_off' &&
        B.svc.state().log[0].peer === 'a-1',
      B.svc.state().log[0]
    );
    check(
      'switch: it cannot be turned on while the text is off, and turning the text on again does not bring it back',
      B.svc.setControl('a-1', true).computers.find(x => x.id === 'a-1').control === false &&
        B.svc.setDetail('a-1', true).computers.find(x => x.id === 'a-1').control === false
    );
    await w.advance(5000);
    await silent('the first switch turned off, then on again', true);
    B.svc.setControl('a-1', true);
    await relist();
    note();

    // what is stored is read with a type check, and counts only for this pairing
    for (const [label, bad] of [
      [
        'a right stored for another pairing id of the same computer',
        Buffer.alloc(16, 7).toString('base64'),
      ],
      ['a stored right that is not text', true],
    ]) {
      B.svc.quit();
      const ks = keysMod.keyStore(B.backend),
        p = ks.note('prefs');
      p.control['a-1'] = bad;
      ks.setNote('prefs', p);
      B.svc = B.make();
      boot(B, () => B.svc.start());
      await w.advance(30000);
      await relist();
      check(
        'switch: ' + label + ' is off: no ticket, nothing to press',
        B.pc('a-1').control === false &&
          B.pc('a-1').commands === false &&
          ticket('p1') === '' &&
          A.pc('b-2').canControl === false,
        B.pc('a-1')
      );
      await silent(label, true);
      B.svc.setControl('a-1', true);
      await relist();
      note();
      check(
        "switch: (setup) on again, now with this pairing's id",
        B.pc('a-1').control === true && stored(B)['a-1'] === pid,
        stored(B)
      );
    }
    {
      B.svc.quit();
      const ks = keysMod.keyStore(B.backend),
        p = ks.note('prefs');
      p.control = ['a-1'];
      ks.setNote('prefs', p);
      B.svc = B.make();
      boot(B, () => B.svc.start());
      await w.advance(30000);
      check(
        'switch: stored rights of another type are read as none, and the switch still works',
        B.pc('a-1').control === false &&
          B.svc.setControl('a-1', true).computers.find(x => x.id === 'a-1').control === true &&
          stored(B)['a-1'] === pid,
        stored(B)
      );
      await relist();
      note();
    }

    // a pause, and Keep (A asks B to forget C; B keeps it)
    B.svc.setControl('c-3', true);
    await w.advance(50);
    A.svc.forget('c-3');
    await w.advance(200);
    check(
      'switch: a pause takes full control away, with a line in the activity log',
      B.pc('c-3').state === 'paused' &&
        B.pc('c-3').control === false &&
        !('c-3' in stored(B)) &&
        B.svc.state().log.some(e => e.kind === 'control_off' && e.peer === 'c-3'),
      B.pc('c-3')
    );
    check(
      'switch: a paused pairing cannot be given it',
      B.svc.setControl('c-3', true).computers.find(x => x.id === 'c-3').control === false &&
        !('c-3' in stored(B))
    );
    B.svc.choose('c-3', 'keep');
    await w.advance(3000);
    check(
      'switch: Keep does not give it back: the user turns it on again',
      B.pc('c-3').state === 'live' &&
        B.pc('c-3').control === false &&
        C.pc('b-2').canControl === false,
      B.pc('c-3')
    );

    // paused, then the user's Forget on the Keep or Forget question
    check('11: (setup) held', await holdOne());
    C.svc.forget('a-1');
    await w.advance(200);
    check(
      '10: (setup) B paused its pairing with A',
      B.pc('a-1').state === 'paused' && B.pc('a-1').control === false
    );
    gone('pairing paused');
    await silent('pairing paused', true);
    B.svc.choose('a-1', 'forget');
    await w.advance(200);
    await silent('forgotten on the Keep or Forget question');
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Forget chosen on the question');

    // Forget on the Devices page
    check('11: (setup) held', await holdOne());
    B.svc.forget('a-1');
    gone('Forget on the Devices page');
    await w.advance(200);
    await silent('Forget on the Devices page');
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Forget');

    // Stop everywhere, confirmed by the others
    check('11: (setup) held', await holdOne());
    B.svc.stopEverywhere();
    gone('Stop on all my computers');
    await silent('this computer stopping', true);
    await w.advance(500);
    check(
      'switch: every computer confirmed the stop: B is off and the right is gone',
      B.svc.state().on === false && !('a-1' in stored(B)),
      [B.svc.state().on, stored(B)]
    );
    await silent('remote off after the stop');
    A.svc.choose('b-2', 'forget');
    C.svc.choose('b-2', 'forget');
    await w.advance(200);
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    await again('a confirmed stop');

    // Stop everywhere with the other computer off: Finish anyway
    A.svc.setOn(false);
    await w.advance(50);
    B.svc.stopEverywhere();
    await w.advance(200);
    B.svc.finishAnyway();
    await w.advance(50);
    check(
      'switch: finished anyway: B is off and the right is gone',
      B.svc.state().on === false && !('a-1' in stored(B))
    );
    boot(A, () => A.svc.setOn(true));
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    A.svc.forget('b-2');
    await w.advance(200);
    await again('Finish anyway');

    // remote off, and on again
    check('11: (setup) held', await holdOne());
    check(
      'review 13, 6: B is paired with one computer only now, and its name still carries the last characters of its id (as the source of the held prompt and in the list)',
      B.svc.state().computers.length === 1 &&
        hold.from === 'Desk (…a-1)' &&
        B.svc.controlLog()[0].name === 'Desk (…a-1)',
      [hold.from, B.svc.state().computers.length]
    );
    B.svc.setOn(false);
    gone('remote turned off');
    await w.advance(50);
    await silent('remote off');
    boot(B, () => B.svc.setOn(true));
    await w.advance(3000);
    await relist();
    check(
      'switch: remote off and on again: the right is as the user left it, and the prompt that was held stays gone',
      B.pc('a-1').control === true && hold.guard() === false && A.pc('b-2').canControl === true,
      B.pc('a-1')
    );
    note();

    // the plan locks while a prompt is held
    check('11: (setup) held', await holdOne());
    B.locked = true;
    const lockedGuard = hold.guard();
    await w.advance(50);
    check(
      '31: the plan locks while a prompt is held: its guard says no at the write, it is dropped and A is told',
      lockedGuard === false &&
        B.svc.controlLog()[0].op === 'dropped' &&
        opOf(heldOp.n).state === 'failed',
      [lockedGuard, opOf(heldOp.n)]
    );
    B.locked = false;
    B.svc.controlChanged();
    await w.advance(5000);

    // signed out
    check('11: (setup) held', await holdOne());
    B.svc.accountChanged(false);
    gone('signed out');
    await silent('signed out');
    B.svc.accountChanged(true, 'acct-1');
    await w.advance(30000);
    await relist();
    check(
      'switch: signed in again: the pairing and the right are as they were',
      B.pc('a-1')?.session === true && B.pc('a-1').control === true,
      B.pc('a-1')
    );
    note();

    // another account on this Windows profile gets nothing of it
    check('11: (setup) held', await holdOne());
    B.svc.accountChanged(true, 'acct-2');
    gone('another account signed in', false);
    await w.advance(200);
    let threw = '';
    try {
      boot(B, () => B.svc.setOn(true));
      B.svc.setControl('a-1', true);
      B.svc.state();
    } catch (e) {
      threw = String(e.message || e);
    }
    check(
      'switch: the account-change reset clears the rights, the control list and its notices, and leaves the switch usable',
      threw === '' &&
        Object.keys(stored(B)).length === 0 &&
        B.svc.state().computers.length === 0 &&
        B.svc.controlLog().length === 0 &&
        B.svc.state().controlled.length === 0 &&
        (keysMod.keyStore(B.backend).note('ops') || []).length === 0,
      [threw, stored(B), B.svc.controlLog().length]
    );
    await silent('another account signed in');
    for (const c of [A, B, C]) c.svc.quit();
    await w.advance(120000);
    check('control: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }

  // ---- finished tasks crossing over:
  // B's agents finish, A is the computer that looks ----
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Third'),
      D = w.computer('d-4', 'Fourth');
    seen.now = w.now;
    const wire0 = seen.wire.length;
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    }; // c.raw(to, obj): what a changed app on c could send
    const KX = 'a'.repeat(40),
      KY = 'b'.repeat(40);
    const long = Array.from(
      { length: 300 },
      (_, i) => 'Line ' + i + ' of the whole answer, with a secret-looking-word in it'
    ).join('\n');
    const rep = (id, name, more) => ({
      id,
      name,
      cli: 'Claude Code',
      at: w.t,
      task: 'Run the tests',
      did: name + ' ran the tests; two failed',
      text: 'All done by ' + name + '.',
      ...more,
    });
    check(
      'off: a finished task is handed to nobody and nothing is made for it',
      B.svc.reported(rep('p1', 'Moss')) === false &&
        w.socks.length === 0 &&
        w.timers.length === 0 &&
        B.disk.text === null
    );
    for (const c of [A, B, C, D]) boot(c, () => c.svc.setOn(true));
    check(
      'on with nobody paired: a finished task makes no connection and writes nothing',
      B.svc.reported(rep('p0', 'Nobody')) === true &&
        seen.wire.slice(wire0).filter(m => m.obj.t === 'report').length === 0
    );
    await w.advance(60000);
    await w.pair(A, B);
    await w.pair(C, B);
    await w.pair(A, C);
    await w.pair(D, B);
    await w.pair(D, A);
    const told = to => seen.wire.slice(wire0).filter(m => m.to === to && m.obj.t === 'report'),
      pcB = () => A.pc('b-2'),
      row = id => pcB().agents.find(x => x.id === id) || null;
    const words = to => told(to).filter(m => m.obj.id !== undefined),
      bare = to => told(to).filter(m => m.obj.id === undefined);
    const sentBy = id => w.sent.filter(t => JSON.parse(t).from === id).length;
    const tally = () =>
      [
        seen.ctlReceives,
        seen.receives,
        seen.acts,
        seen.permCalls,
        A.svc.state().log.length,
        A.svc.controlLog().length,
      ].join();
    await w.advance(120000);
    check(
      'review 14, 1: a task that finished before the pairing existed is never sent to the new computer',
      told('a-1').length === 0 &&
        told('c-3').length === 0 &&
        pcB().finished === null &&
        pcB().session === true,
      told('a-1').map(m => m.obj.did)
    );
    B.agents = [
      {
        id: 'p1',
        name: 'Moss',
        cli: 'Claude Code',
        status: 'idle',
        since: 0,
        task: 'Run the tests',
        p: KX,
      },
      { id: 'p2', name: 'Wren', cli: 'Claude Code', status: 'idle', since: 0, p: KY },
      { id: 'p3', name: 'Kite', cli: 'Claude Code', status: 'idle', since: 0 },
    ];
    for (const c of [A, B, C, D]) c.key = KX;
    A.svc.projectChanged();
    B.svc.agentsChanged();
    await w.advance(5000);
    B.svc.setDetail('c-3', false);
    await w.advance(50);
    const mark = w.sent.length,
      was = tally(),
      sentA = sentBy('a-1');
    B.svc.reported(
      rep('p1', 'Moss', {
        text: long,
        p: KX,
        cwd: 'C:\\Users\\me\\secret-folder',
        log: 'terminal output',
      })
    );
    await w.advance(50);
    const last = row('p1')?.last,
      read = A.svc.reportText('b-2', 'p1');

    // Since the gap fix of 2026-10-10 the answer's text is no longer in
    // the pushed state: the row says only that there is one (`has`), and the page reads it when it
    // shows it (`reportText`), by the state's own rule.
    check(
      'an agent on B finished: its row on A carries the task, the short result, that there is an answer and how much was left out; the text itself is read on demand',
      !!last &&
        last.task === 'Run the tests' &&
        last.did === 'Moss ran the tests; two failed' &&
        last.has === true &&
        !('text' in last) &&
        last.at > 0 &&
        last.got === w.t - 50 &&
        !!read &&
        long.startsWith(read.text) &&
        read.text.length > 2000 &&
        read.more === long.length - read.text.length &&
        last.more === read.more &&
        read.at === last.at &&
        read.got === last.got,
      [last, read && { ...read, text: read.text.length }]
    );
    check(
      'review 14, Low 7: no part of the answer is in the state the window is pushed',
      !JSON.stringify(A.svc.state()).includes(long.slice(0, 40)) &&
        !JSON.stringify(A.last).includes(long.slice(0, 40))
    );
    check(
      'the text is read only for a row and a result the state lists: an unknown agent, an unknown computer and a bad id read nothing',
      A.svc.reportText('b-2', 'p-none') === null &&
        A.svc.reportText('zz-9', 'p1') === null &&
        A.svc.reportText('b-2', '') === null &&
        C.svc.reportText('b-2', 'p1') === null,
      [A.svc.reportText('b-2', 'p-none'), C.svc.reportText('b-2', 'p1')]
    );
    check(
      'and the computer says which agent finished last, for the bell',
      pcB().finished?.agent === 'Moss' &&
        pcB().finished.task === 'Run the tests' &&
        pcB().finished.did === 'Moss ran the tests; two failed' &&
        typeof pcB().finished.key === 'string' &&
        !('text' in pcB().finished),
      pcB().finished
    );
    check(
      'it went as one sealed message: the relay carried none of its words',
      told('a-1').length === 1 &&
        w.sent.slice(mark).every(t => !/two failed|secret-looking|Run the tests|Moss/.test(t)) &&
        Buffer.byteLength(JSON.stringify(told('a-1')[0].obj)) <= 4094
    );
    check(
      'nothing but the named fields left B, and no folder',
      Object.keys(told('a-1')[0].obj).join() === 't,id,name,cli,at,task,did,text,more,p' &&
        !JSON.stringify(told('a-1')).includes('secret-folder')
    );
    check(
      'the window is given no project key with it',
      !JSON.stringify(A.svc.state()).includes(KX) && !('p' in last)
    );
    check(
      'a row that finished nothing has no result',
      !row('p2') && !!row('p3') && !('last' in row('p3'))
    );
    check(
      'receiving it made A do nothing: no answer, no operation, no log line, no message back',
      tally() === was && sentBy('a-1') === sentA,
      [tally(), was]
    );
    check(
      'the computer whose text switch is off on B was told "no longer" once and nothing else',
      told('c-3').length === 1 && bare('c-3').length === 1 && C.pc('b-2').finished === null,
      told('c-3').map(m => m.obj.id)
    );

    // follows the open project (skill rule 12)
    B.svc.reported(rep('p2', 'Wren', { p: KY }));
    await w.advance(50);
    check(
      "a result from an agent in another project is not on the card, and the bell's entry stays the one of this project",
      !row('p2') &&
        pcB().elsewhere === 1 &&
        pcB().finished.agent === 'Moss' &&
        !JSON.stringify(A.svc.state()).includes('Wren ran'),
      pcB().finished
    );
    A.key = KY;
    A.svc.projectChanged();
    await w.advance(10);
    check(
      "that project opened here: its agent's row has the result, and the entry follows",
      row('p2')?.last?.did === 'Wren ran the tests; two failed' &&
        !row('p1') &&
        pcB().finished.agent === 'Wren',
      pcB().finished
    );
    B.svc.reported(rep('p3', 'Kite'));
    await w.advance(50);
    check(
      'a result without a key is shown whatever is open, as a row without one is',
      row('p3')?.last?.did === 'Kite ran the tests; two failed' && pcB().finished.agent === 'Kite'
    );
    A.key = '';
    A.svc.projectChanged();
    await w.advance(10);
    check(
      'no project open here: only the result without a key shows',
      pcB().finished.agent === 'Kite' &&
        pcB()
          .agents.map(x => x.id)
          .join() === 'p3' &&
        !!row('p3').last
    );
    A.key = KX;
    A.svc.projectChanged();
    await w.advance(10);
    check(
      'back in the first project: the newest of what may be shown is the one without a key',
      pcB().finished.agent === 'Kite' && row('p1').last.did === 'Moss ran the tests; two failed'
    );

    // a result belongs to the very agent the row shows, and to the task it was the answer of
    //
    const list = async change => {
      B.agents = B.agents.map(x => ({ ...x, ...(change[x.id] || {}) }));
      B.svc.agentsChanged();
      await w.advance(5000);
    };
    await list({ p1: { name: 'Sage' } });
    check(
      "another agent in the same panel id does not get the earlier agent's result",
      !!row('p1') && row('p1').name === 'Sage' && !('last' in row('p1'))
    );
    await list({ p1: { status: 'working', since: w.t } });
    B.svc.reported(rep('p1', 'Sage', { p: KX }));
    await w.advance(50);
    check(
      'its own result shows when it finishes',
      row('p1').last.did === 'Sage ran the tests; two failed'
    );
    await list({ p1: { status: 'idle', since: 0 } });
    check(
      '8: the list that still named that task as open, and then the idle one, leave its result on the row',
      row('p1').last?.did === 'Sage ran the tests; two failed',
      row('p1')
    );
    await list({ p3: { status: 'working', since: w.t } });
    check(
      '8: the agent began another task: the state still carries the last result (the page shows the task meanwhile)',
      row('p3').last?.did === 'Kite ran the tests; two failed' && row('p3').since > 0
    );
    await list({ p3: { status: 'idle', since: 0 } });
    check(
      '8: that task ended without an answer: the row no longer shows the result of the task before it',
      !('last' in row('p3')) && row('p1').last?.did === 'Sage ran the tests; two failed',
      row('p3')
    );
    check(
      "8: the bell's line still names what finished, with its time",
      A.svc.state().computers.find(x => x.id === 'b-2').finished !== null
    );
    {
      const gone = B.agents.filter(x => x.id !== 'p1'),
        back = B.agents;
      B.agents = gone;
      B.svc.agentsChanged();
      await w.advance(5000);
      B.agents = back;
      B.svc.agentsChanged();
      await w.advance(5000);
      check(
        "8: the row left the list and an agent of the same panel id, name and CLI came: it does not show its predecessor's result",
        !!row('p1') && row('p1').name === 'Sage' && !('last' in row('p1')),
        row('p1')
      );
    }
    B.svc.reported(rep('p1', 'Sage', { p: KX }));
    await w.advance(50);

    // a changed app on B
    const p1 = JSON.stringify(row('p1').last);
    for (const bad of [
      { t: 'report', id: 'p1' },
      { t: 'report', id: 'p1', name: 'Sage', cli: 'Claude Code', at: 'now', did: 'x' },
      { t: 'report', id: 'p1', name: 'Sage', cli: 'Claude Code', at: w.t },
    ])
      B.raw('a-1', bad);
    await w.advance(50);
    check('a report of the wrong shape changes nothing', JSON.stringify(row('p1').last) === p1);
    B.raw('a-1', {
      t: 'report',
      id: 'p3',
      name: 'Kite',
      cli: 'Claude Code',
      at: w.t,
      did: '<img src=x onerror=alert(1)>',
      text: 'a\u202eb\u0000c',
      more: 'lots',
      to: 'f'.repeat(16),
      can: true,
      mark: 'x',
      off: true,
      busy: true,
      p: 'C:\\Users\\me',
    });
    await w.advance(50);
    check(
      'what it sends is cleaned and stays text; fields that are not named never reach the window',
      row('p3').last.did === '<img src=x onerror=alert(1)>' &&
        row('p3').last.has === true &&
        A.svc.reportText('b-2', 'p3')?.text === 'a b c' &&
        row('p3').last.more === 0 &&
        Object.keys(row('p3').last).join() === 'at,task,did,has,more,got' &&
        row('p3').can === false &&
        row('p3').mark === '',
      [row('p3').last, A.svc.reportText('b-2', 'p3')]
    );

    // a fresh minute: the ones above counted too, the wrong shapes included
    await w.advance(120000);
    const pushes = A.changes;
    for (let i = 0; i < 60; i++)
      B.raw('a-1', {
        t: 'report',
        id: 'flood' + i,
        name: 'F' + i,
        cli: 'Codex',
        at: w.t,
        did: 'x',
      });
    await w.advance(50);
    const kept = apiMod.REPORTS_MAX;
    check(
      'sixty at once from a changed app: A takes ' +
        kept +
        ' in that minute, and its window is pushed no more often than that',
      pcB().finished.agent === 'F' + (kept - 1) && A.changes - pushes <= kept && A.changes > pushes,
      [pcB().finished.agent, A.changes - pushes]
    );
    check(
      'still nothing done on A, nothing sent back',
      tally() === was && sentBy('a-1') === sentA,
      tally()
    );

    // the text switch on B, for A
    await w.advance(120000);
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Sage did one more' }));
    await w.advance(50);
    check('(a newer result is the entry again)', pcB().finished.did === 'Sage did one more');
    const n1 = told('a-1').length;
    B.svc.setDetail('a-1', false);
    await w.advance(50);
    check(
      'the text switch goes off on B: A is told, and drops every result it held from B',
      told('a-1').length === n1 + 1 &&
        told('a-1').at(-1).obj.id === undefined &&
        pcB().finished === null &&
        pcB().agents.every(x => !('last' in x)),
      pcB().finished
    );
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Finished with the switch off' }));
    await w.advance(120000);
    check(
      'with the switch off nothing of a finished task leaves B',
      told('a-1').length === n1 + 1 && pcB().finished === null
    );
    B.svc.setDetail('a-1', true);
    await w.advance(50);
    await w.advance(120000);
    check(
      'review 14, 1: switched on again inside the hour: the task that finished while it was off is NOT sent, nor one from before',
      told('a-1').length === n1 + 1 &&
        pcB().finished === null &&
        !JSON.stringify(told('a-1').slice(n1)).includes('switch off'),
      told('a-1')
        .slice(n1)
        .map(m => m.obj.did)
    );
    B.svc.setDetail('a-1', true);
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Finished after it went on' }));
    await w.advance(50);
    check(
      'a task that finishes after it went on is sent (and pressing "on" while it is on changes nothing)',
      pcB().finished?.did === 'Finished after it went on' &&
        row('p1').last.did === 'Finished after it went on',
      pcB().finished
    );

    // Reports wait for room, the switch goes off, the minute passes
    await w.advance(120000);
    const n2 = told('a-1').length;
    for (let i = 0; i < 9; i++) B.svc.reported(rep('r' + i, 'Runner ' + i, { p: KX }));
    await w.advance(50);
    const went = told('a-1').length - n2;
    B.svc.setDetail('a-1', false);
    await w.advance(180000);
    check(
      'review 14, test 3: reports wait for room, the switch goes off, the minute passes: only "no longer" goes',
      went === apiMod.REPORTS_MIN &&
        told('a-1').length === n2 + went + 1 &&
        told('a-1').at(-1).obj.id === undefined &&
        pcB().finished === null,
      [went, told('a-1').length - n2]
    );
    B.svc.setDetail('a-1', true);
    await w.advance(120000);

    // Connecting goes off on B while A listens
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Before B switched off' }));
    await w.advance(50);
    const n3 = told('a-1').length,
      had3 = pcB().finished?.did;
    B.svc.setOn(false);
    await w.advance(200);
    check(
      'review 14, 4: connecting switched off on B: a live A is told "no longer" first, and keeps nothing of B',
      had3 === 'Before B switched off' &&
        told('a-1').length === n3 + 1 &&
        told('a-1').at(-1).obj.id === undefined &&
        pcB().session === false &&
        pcB().finished === null,
      [had3, pcB().finished]
    );
    boot(B, () => B.svc.setOn(true));
    await w.advance(30000);
    B.svc.agentsChanged();
    await w.advance(5000);
    check(
      'on again on B: a new session, and nothing from before comes back',
      pcB().session === true && pcB().finished === null
    );

    // offline, back, and a switch that went off meanwhile
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Before B closed' }));
    await w.advance(50);
    B.svc.quit();
    await w.advance(200);
    check(
      'B went offline (its app closed): nothing of it is live, the finished task stays with its time',
      pcB().session === false &&
        pcB().state === 'offline' &&
        pcB().agents.length === 0 &&
        pcB().finished?.did === 'Before B closed',
      pcB()
    );
    boot(B, () => {
      B.svc = B.make();
      B.svc.start();
    });
    B.svc.setDetail('a-1', false);
    await w.advance(30000);
    check(
      'B is back with its text switch off for A: the session begins with "no longer", and A drops what it still held',
      pcB().session === true &&
        pcB().finished === null &&
        told('a-1').at(-1).obj.id === undefined &&
        Object.keys(told('a-1').at(-1).obj).join() === 't',
      pcB().finished
    );
    B.svc.setDetail('a-1', true);
    B.agents = [{ id: 'p1', name: 'Sage', cli: 'Claude Code', status: 'idle', since: 0, p: KX }];
    B.svc.agentsChanged();
    await w.advance(5000);
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'After the restart' }));
    await w.advance(50);
    check(
      '(and a new result shows again)',
      pcB().finished?.did === 'After the restart' && row('p1')?.last?.did === 'After the restart',
      pcB().finished
    );

    // remote off on A
    A.svc.setOn(false);
    await w.advance(200);
    check(
      "connecting switched off on A: nothing of B's results is kept or shown",
      A.svc.state().computers.every(x => x.finished === null && x.agents.length === 0) &&
        !JSON.stringify(A.svc.state()).includes('After the restart')
    );
    boot(A, () => A.svc.setOn(true));
    await w.advance(30000);
    check(
      "on again on A: the new session brings B's recent result (B was allowed to tell A all along)",
      pcB()?.finished?.did === 'After the restart',
      pcB()?.finished
    );

    // a pairing paused on the computer that tells: nothing from before or during the pause is told
    // after Keep
    await w.advance(120000);
    D.svc.forget('a-1');
    await w.advance(200);
    check(
      '(B was asked to forget A: the pairing is paused on B)',
      B.pc('a-1')?.state === 'paused',
      B.pc('a-1')?.state
    );
    const n4 = words('a-1').length;
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'Finished during the pause on B' }));
    await w.advance(50);
    B.svc.choose('a-1', 'keep');
    await w.advance(3000);
    await w.advance(120000);
    check(
      'review 14, 1: paused on B, a task finishes, Keep: neither that task nor the one from before the pause is sent',
      B.pc('a-1')?.state === 'live' &&
        words('a-1').length === n4 &&
        !JSON.stringify(A.svc.state()).includes('during the pause'),
      words('a-1')
        .slice(n4)
        .map(m => m.obj.did)
    );
    B.svc.reported(rep('p1', 'Sage', { p: KX, did: 'After Keep on B' }));
    await w.advance(50);
    check(
      'a task that finishes after Keep is sent',
      pcB().finished?.did === 'After Keep on B',
      pcB().finished
    );

    // a pairing paused on the computer that looks: it keeps nothing; after Keep the sender's recent
    // result is shown again
    C.svc.forget('b-2');
    await w.advance(200);
    check(
      "B's pairing is paused on A: none of its results is shown or kept",
      pcB().state === 'paused' && pcB().finished === null && pcB().agents.length === 0,
      pcB()
    );
    A.svc.choose('b-2', 'keep');
    await w.advance(3000);
    await w.advance(61000);
    check(
      "after Keep on A, B's recent result shows again: B was never asked to stop telling A, and A chose to keep it",
      pcB().state === 'live' && pcB().finished?.did === 'After Keep on B',
      pcB().finished
    );

    // Forget made on B, then on A
    const n5 = told('a-1').length;
    B.svc.forget('a-1');
    await w.advance(200);
    check(
      'review 14, 4: B forgets A: A is told "no longer" before the pairing goes, and keeps nothing of B',
      told('a-1').length === n5 + 1 &&
        told('a-1').at(-1).obj.id === undefined &&
        B.pc('a-1') === null &&
        (A.pc('b-2') === null || A.pc('b-2').finished === null),
      A.pc('b-2')?.finished
    );
    if (A.pc('b-2')) A.svc.forget('b-2');
    await w.advance(200);
    check(
      'Forget removes the computer and its results',
      A.pc('b-2') === null && !JSON.stringify(A.svc.state()).includes('After Keep')
    );
    for (const c of [A, B, C, D]) c.svc.quit();
    await w.advance(120000);
    check('reports: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }

  // ---- which finished turn is handed over at all (remote-service.js createTurnReporter, what
  // main.js calls at `agent:turn`) ----
  {
    const { createTurnReporter, REPORT_FRESH_MS } = require('../desktop/remote-service.js');
    let t = 1700000000000,
      on = true,
      keyFails = false;
    const got = [],
      asked = [];
    const panes = {
        p1: { name: 'Moss', cli: 'Codex', project: 'C:\\proj' },
        p2: { name: 'Wren', cli: 'Cursor Agent', project: '' },
      },
      born = { p1: t - 10 * 60000, p2: t - 10 * 60000, p9: t - 10 * 60000 };
    const tell = createTurnReporter({
      now: () => t,
      active: () => on,
      pane: async id => {
        asked.push(id);
        return panes[id] || null;
      },
      processStart: id => born[id] || 0,
      short: (task, result) => ({ task, did: 'Did: ' + result }),
      keyOf: async () => {
        if (keyFails) throw new Error('no git');
        return 'c'.repeat(40);
      },
      reported: r => {
        got.push(r);
        return true;
      },
    });
    const turn = more => ({
      paneId: 'p1',
      startedAt: t - 30000,
      endedAt: t - 1000,
      task: 'Run the tests',
      result: 'All pass.',
      ...more,
    });
    check(
      'a task that just ended is handed over with its row id, name, CLI, end time, task, short result, answer and project key',
      (await tell(turn())) === true &&
        JSON.stringify(got[0]) ===
          JSON.stringify({
            id: 'p1',
            name: 'Moss',
            cli: 'Codex',
            at: t - 1000,
            task: 'Run the tests',
            did: 'Did: All pass.',
            text: 'All pass.',
            p: 'c'.repeat(40),
          }),
      got[0]
    );
    check(
      'the same task published again is handed over once',
      (await tell(turn())) === false && got.length === 1
    );
    check(
      'review 14, 2: a turn that ended longer ago than ' +
        REPORT_FRESH_MS / 60000 +
        ' minutes (a resumed session shows its last task) is not handed over, and nothing is even looked up for it',
      (await tell(turn({ startedAt: t - 86400000, endedAt: t - REPORT_FRESH_MS - 1 }))) === false &&
        (await tell(turn({ startedAt: 5, endedAt: t - 7 * 86400000 }))) === false &&
        got.length === 1 &&
        asked.length === 1,
      [got.length, asked.length]
    );
    check(
      "review 14, 2: nor one that ended before this panel's process started (resumed a minute after it ended)",
      ((born.p1 = t - 10000), await tell(turn({ startedAt: t - 90000, endedAt: t - 60000 }))) ===
        false && got.length === 1
    );
    born.p1 = t - 10 * 60000;
    check(
      'review 14, 2: a Cursor Agent turn read from the chat\'s history is never handed over, though its end time is "now"',
      (await tell(turn({ paneId: 'p2', startedAt: t, endedAt: t, history: true }))) === false &&
        got.length === 1
    );
    check(
      "the same chat's next task, ended live, is",
      (await tell(turn({ paneId: 'p2', startedAt: t - 2000, endedAt: t - 10, history: false }))) ===
        true &&
        got.length === 2 &&
        got[1].name === 'Wren' &&
        got[1].p === ''
    );
    check(
      'an end time in the future, no end time, no answer, an unknown process start, a panel that is not in the agent list: nothing',
      (await tell(turn({ startedAt: 11, endedAt: t + 60000 }))) === false &&
        (await tell(turn({ startedAt: 12, endedAt: 0 }))) === false &&
        (await tell(turn({ startedAt: 13, result: '' }))) === false &&
        (await tell(turn({ paneId: 'p8', startedAt: 14 }))) === false &&
        (await tell(turn({ paneId: 'p9', startedAt: 15 }))) === false &&
        (await tell(null)) === false &&
        got.length === 2
    );
    on = false;
    check(
      'connecting off: nothing is built or handed over',
      (await tell(turn({ startedAt: 16 }))) === false &&
        got.length === 2 &&
        !asked.includes('p1-off')
    );
    on = true;
    keyFails = true;
    check(
      'a project key that cannot be made: handed over without one',
      (await tell(turn({ startedAt: 17 }))) === true && got[2].p === ''
    );
    keyFails = false;
    t += 1000;
    check(
      "the sender's mark of a prompt from another computer is not part of the task that is told; words that only look like it stay",
      (await tell(
        turn({ startedAt: 18, endedAt: t - 5, task: '[Sent from Desk (…1a2b)] Say hi' })
      )) === true &&
        got[3].task === 'Say hi' &&
        (await tell(
          turn({
            startedAt: 19,
            endedAt: t - 4,
            task: 'Why does it say [Sent from Desk (…1a2b)] here',
          })
        )) === true &&
        got[4].task === 'Why does it say [Sent from Desk (…1a2b)] here',
      got.slice(3).map(g => g.task)
    );
  }

  // ---- agent-turns.js marks the task a resumed Cursor Agent chat shows: its end time there is the
  // moment it was read (finding 2) ----
  {
    const fs = require('fs'),
      os = require('os'),
      path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-r14-')),
      file = path.join(dir, 'chat.jsonl');
    const cursorStore = require('../desktop/cursor-store.js'),
      realTranscript = cursorStore.transcript;
    const line = o => JSON.stringify(o) + '\n',
      said = (role, text) => line({ role, message: { content: [{ type: 'text', text }] } });
    fs.writeFileSync(
      file,
      said('user', 'An old task') +
        said('assistant', 'The old answer') +
        line({ type: 'turn_ended', status: 'completed' })
    );
    cursorStore.transcript = () => file;
    const turnsMod = require('../desktop/agent-turns.js'),
      got = [];
    try {
      turnsMod.init((channel, payload) => {
        if (channel === 'agent:turn' && payload.paneId === 'r14-cursor') got.push(payload);
      });
      turnsMod.started('r14-cursor', 'Cursor Agent', '', 'chat', dir);
      const old = got.filter(x => x.endedAt).at(-1);
      check(
        'review 14, 2: the last task of a resumed Cursor Agent chat is published as read from history',
        !!old && old.result === 'The old answer' && old.history === true,
        old && { result: old.result, history: old.history }
      );
      fs.appendFileSync(
        file,
        said('user', 'A new task') +
          said('assistant', 'The new answer') +
          line({ type: 'turn_ended', status: 'completed' })
      );

      // reads at once what the watcher would bring a moment later
      turnsMod.fromPty('pty:exit', { paneId: 'r14-cursor' });
      const fresh = got.filter(x => x.endedAt && x.result === 'The new answer').at(-1);
      check(
        'a task that ends while the chat is followed is not marked',
        !!fresh && fresh.history === false,
        got.map(x => [x.result, x.history, x.endedAt > 0])
      );
    } finally {
      cursorStore.transcript = realTranscript;
      try {
        turnsMod.forget('r14-cursor');
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ---- the live view:
  // A watches an agent's terminal panel on B; C is a third paired computer. The rules
  // themselves are tools/remote-view-test.js; this is the wiring. ----
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Third');
    seen.now = w.now;
    const wire0 = seen.wire.length;
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    }; // c.raw(to, obj): what a changed app on c could send
    for (const c of [A, B, C]) boot(c, () => c.svc.setOn(true));
    const KX = 'a'.repeat(40);
    const panel = (name, more) => ({
      name,
      cli: 'Claude Code',
      mode: 'run',
      running: true,
      hand: false,
      instance: 'conv-' + name,
      pid: 4321,
      startedAt: 1700000000001,
      ...more,
    });
    B.panels = {
      p1: panel('Moss'),
      p2: panel('Typed', { hand: true }),
      p3: panel('Shell', { cli: 'Terminal' }),
      p4: panel('Wren'),
    };
    const relist = async () => {
      B.agents = Object.entries(B.panels).map(([id, p]) => ({
        id,
        name: p.name,
        cli: p.cli,
        status: 'idle',
        since: 0,
        p: KX,
      }));
      B.svc.agentsChanged();
      await w.advance(5000);
    };
    for (const c of [A, B, C]) c.key = KX;
    const screen = (text, rows = 4) => ({
      cols: 60,
      rows,
      lines: Array.from({ length: rows }, (_, y) => [
        text + ' row ' + y,
        y === 0 ? [[0, 4, 2, -1, 1]] : [],
      ]),
    });
    const toPeer = (to, t) =>
        seen.wire
          .slice(wire0)
          .filter(m => m.to === to && m.obj.t === t)
          .map(m => m.obj),
      rowSent = (to, id) => (toPeer(to, 'agents').at(-1)?.agents || []).find(r => r.id === id);
    const fresh = to => {
      const m = seen.wire
        .slice(wire0)
        .filter(x => x.to === to && x.obj.c)
        .at(-1);
      return m ? { c: m.obj.c, ms: w.t - m.at } : { c: 1, ms: 0 };
    };
    let nn = 0;
    const num = () => (0xabc000 + ++nn).toString(16).padStart(16, '0');
    const markOf = (c, id) => c.pc('b-2')?.agents.find(r => r.id === id)?.mark || '',
      model = c => c.shown.at(-1) || null,
      text = c => (model(c)?.picture?.lines || []).map(l => l.t).join('|');
    const viewsNote = () => keysMod.keyStore(B.backend).note('views') || {},
      usedBy = id => (viewsNote()[id] || []).reduce((s, e) => s + e[1], 0);
    const watchLines = () => B.svc.controlLog().filter(e => e.op === 'watch');
    await w.advance(60000);
    await w.pair(A, B);
    await w.pair(C, B);
    await relist();
    B.term.p1 = screen('secret-screen-text');

    // test 1: with full control off
    const before = [
      toPeer('a-1', 'viewing').length,
      toPeer('a-1', 'unview').length,
      toPeer('a-1', 'frame').length,
      B.svc.controlLog().length,
      B.asked.length,
      JSON.stringify(viewsNote()),
    ].join();
    for (const m of [
      { t: 'view', n: num(), ...fresh('a-1'), id: 'p1', to: 'f'.repeat(16) },
      { t: 'view', n: num(), ...fresh('a-1'), id: 'p1', to: 'f'.repeat(16) },
      { t: 'view', n: num(), ...fresh('a-1'), id: 'p1', to: 'f'.repeat(16) },
      { t: 'view', n: num(), ...fresh('a-1'), id: 'p1', to: 'f'.repeat(16) },
      { t: 'keep', n: num(), ...fresh('a-1'), v: num(), id: 'p1', to: 'f'.repeat(16) },
      { t: 'unview', v: num(), why: 'closed' },
    ])
      A.raw('b-2', m);

    // four views went unread: were they counted, the first real view below, inside the same minute,
    // would be the fifth and get silence
    await w.advance(5000);
    check(
      'view test 1: with full control off, view, keep and unview get no reply, nothing is asked of the window, logged or counted',
      [
        toPeer('a-1', 'viewing').length,
        toPeer('a-1', 'unview').length,
        toPeer('a-1', 'frame').length,
        B.svc.controlLog().length,
        B.asked.length,
        JSON.stringify(viewsNote()),
      ].join() === before && B.svc.state().watching.length === 0
    );
    check(
      'with full control off this computer cannot watch: no Watch for the page, and a press sends nothing',
      A.pc('b-2').canWatch === false &&
        A.svc.view('b-2', 'p1', 'x'.repeat(12)).sent === 'not_sent' &&
        model(A) === null
    );

    // the switch, turned on under the sentence
    B.svc.setControl('a-1', true);
    B.svc.setControl('c-3', true);
    await relist();
    check(
      'full control turned on: the grant is marked as given under the sentence, and the other computer is told it may watch with one word',
      B.pc('a-1').watchable === true &&
        toPeer('a-1', 'control').at(-1).watch === true &&
        A.pc('b-2').canWatch === true &&
        A.pc('b-2').canControl === true,
      toPeer('a-1', 'control').at(-1)
    );
    check(
      'the mark of the row a press must hand back is the one of a prompt',
      A.svc.view('b-2', 'p1', '0'.repeat(12)).sent === 'changed' &&
        A.svc.view('b-2', 'p1', '').sent === 'changed' &&
        A.svc.view('b-2', 'p2', markOf(A, 'p2')).sent === 'not_sent' &&
        toPeer('b-2', 'view').length === 0
    );

    // a view
    const mark0 = w.sent.length,
      pushes = A.changes;
    check(
      'Watch: asked',
      A.svc.view('b-2', 'p1', markOf(A, 'p1')).sent === 'asked' && model(A).state === 'asked'
    );
    await w.advance(50);
    const m1 = model(A);
    check(
      'the watched computer asks its window for that panel, writes the list line and the first minute, and says "on"',
      B.asked.join() === 'p1 on' &&
        watchLines().length === 1 &&
        watchLines()[0].agent === 'Moss' &&
        watchLines()[0].secs === null &&
        /^Desk \(…a-1\)$/.test(watchLines()[0].name) &&
        usedBy('a-1') === 60 &&
        m1.state === 'on' &&
        m1.left === 119 &&
        m1.until > w.t + 9 * 60000 &&
        m1.until <= w.t + 10 * 60000,
      [B.asked, watchLines()[0], m1.state, m1.left]
    );
    check(
      'the picture arrives: the rows as text, with their style runs',
      text(A) ===
        'secret-screen-text row 0|secret-screen-text row 1|secret-screen-text row 2|secret-screen-text row 3' &&
        JSON.stringify(m1.picture.lines[0].r) === JSON.stringify([[0, 4, 2, -1, 1]]) &&
        m1.picture.cols === 60 &&
        m1.name === 'Moss'
    );
    check(
      'test 19: the picture is in no state the window is pushed, on either computer',
      !JSON.stringify(A.svc.state()).includes('secret-screen') &&
        !JSON.stringify(A.last).includes('secret-screen') &&
        !JSON.stringify(B.svc.state()).includes('secret-screen') &&
        !JSON.stringify(A.svc.state()).includes('picture')
    );
    check(
      'the relay carried none of its words',
      w.sent.slice(mark0).every(t => !/secret-screen|Moss/.test(t))
    );
    check(
      'test 18: on the watched computer the state says who watches which panel, with the id',
      JSON.stringify(B.svc.state().watching.map(x => [x.peer, x.agent, x.panelId, x.name])) ===
        JSON.stringify([['a-1', 'Moss', 'p1', 'Desk (…a-1)']])
    );
    check(
      'test 18: the list line is in the store while the view runs, without a length: a crash leaves it so',
      (keysMod.keyStore(B.backend).note('ops') || []).some(
        e => e.op === 'watch' && e.secs === null && e.agent === 'Moss'
      )
    );

    // test 9
    const frames = toPeer('a-1', 'frame').length,
      sentB = w.sentAt.filter(x => x[0] === 'b-2').length;
    await w.advance(60000);
    B.svc.screen('p1', screen('secret-screen-text'));
    await w.advance(1000);
    check(
      'test 9: a still screen for 60 seconds: no frame, and no other message because of the view',
      toPeer('a-1', 'frame').length === frames &&
        w.sentAt.filter(x => x[0] === 'b-2').length === sentB
    );
    B.svc.screen('p1', screen('second'));
    await w.advance(50);
    check(
      'the screen changes: the picture follows',
      text(A).startsWith('second row 0|') && toPeer('a-1', 'frame').length === frames + 1
    );

    // one view at a time on the watched computer
    check(
      'another computer asks while the view runs: it reads "busy"',
      C.svc.view('b-2', 'p4', C.pc('b-2').agents.find(r => r.id === 'p4').mark).sent === 'asked' &&
        (await w.advance(50), model(C).state === 'ended' && model(C).why === 'busy') &&
        model(A).state === 'on'
    );

    // test 15: frames that are not this view's
    const picWas = text(A),
      shownWas = A.shown.length;
    C.raw('a-1', { t: 'frame', v: toPeer('b-2', 'view').at(-1).n, s: 9, i: 0, k: 1, z: 'QUJD' });
    B.raw('a-1', { t: 'frame', v: 'f'.repeat(16), s: 9, i: 0, k: 1, z: 'QUJD' });
    B.raw('c-3', { t: 'frame', v: toPeer('b-2', 'view').at(-1).n, s: 9, i: 0, k: 1, z: 'QUJD' });
    await w.advance(50);
    check(
      "test 15: a frame from another paired computer, one for another view id, and this view's frame sent to a computer that has no view: all dropped unread",
      text(A) === picWas &&
        A.shown.length === shownWas &&
        model(A).state === 'on' &&
        model(C).state === 'ended'
    );

    // keep
    await w.advance(8 * 60000);
    check(
      'Keep watching moves the end on both computers',
      A.svc.keepView() === true &&
        (await w.advance(50), model(A).until === w.t - 50 + 10 * 60000) &&
        toPeer('b-2', 'keep').length === 1
    );
    await w.advance(9 * 60000);
    check(
      'eighteen minutes in, after one keep: still on (ten minutes alone would have ended it), and nineteen minutes of the allowance are written: each one before it is served',
      model(A).state === 'on' && B.svc.state().watching.length === 1 && usedBy('a-1') === 19 * 60,
      usedBy('a-1')
    );

    // test 4: the switch goes off
    B.svc.screen('p1', screen('third'));
    await w.advance(50);
    const f4 = toPeer('a-1', 'frame').length;
    B.svc.setControl('a-1', false);
    B.svc.screen('p1', screen('after the switch went off'));
    await w.advance(2000);
    check(
      'view test 4: the switch goes off: the view ends in that call, the other computer reads "off" and drops the picture at once, no frame follows',
      toPeer('a-1', 'unview').at(-1).why === 'off' &&
        toPeer('a-1', 'frame').length === f4 &&
        model(A).state === 'ended' &&
        model(A).why === 'off' &&
        model(A).picture === null &&
        B.svc.state().watching.length === 0 &&
        B.asked.at(-1) === 'p1 off',
      [model(A), B.asked]
    );
    check(
      'the list line got its length and why',
      watchLines()[0].secs >= 18 * 60 &&
        watchLines()[0].secs < 19 * 60 &&
        watchLines()[0].why === 'off',
      watchLines()[0]
    );
    check(
      'without the switch the other computer is told it can no longer watch',
      A.pc('b-2').canWatch === false && toPeer('a-1', 'control').at(-1).watch === undefined
    );
    A.svc.unview('closed');
    check('Close: nothing of the view stays', model(A) === null && A.svc.viewNow() === null);

    // test 2: a grant from before the sentence
    B.svc.setControl('a-1', true);
    await relist();
    {
      const st = keysMod.keyStore(B.backend),
        p = st.note('prefs');
      delete p.watch['a-1'];
      st.setNote('prefs', p);
    }
    B.svc.quit();
    await w.advance(200);
    boot(B, () => {
      B.svc = B.make();
      B.svc.start();
    });
    await w.advance(30000);
    await relist();
    check(
      'view test 2: a full-control switch from before the sentence: on, but not for watching, and the other computer shows no Watch',
      B.pc('a-1').control === true &&
        B.pc('a-1').watchable === false &&
        A.pc('b-2').canControl === true &&
        A.pc('b-2').canWatch === false &&
        A.svc.view('b-2', 'p1', markOf(A, 'p1')).sent === 'not_sent'
    );
    const n2 = num(),
      asked2 = B.asked.length;
    A.raw('b-2', { t: 'view', n: n2, ...fresh('a-1'), id: 'p1', to: rowSent('a-1', 'p1').to });
    await w.advance(50);
    check(
      'view test 2: a view sent anyway is refused, and a prompt still works',
      toPeer('a-1', 'viewing')
        .filter(m => m.n === n2)
        .map(m => m.state)
        .join() === 'refused' &&
        B.asked.length === asked2 &&
        A.svc.prompt('b-2', 'p1', 'Still works').sent === 'asked'
    );
    B.svc.setControl('a-1', false);
    B.svc.setControl('a-1', true);
    await relist();
    check(
      'turned off and on again (the question with the sentence): it can be watched',
      B.pc('a-1').watchable === true && A.pc('b-2').canWatch === true
    );

    // test 3: what gets no view
    await w.advance(61000);
    const refused = [];
    for (const [id, to] of [
      ['p1', 'c'.repeat(16)],
      ['p2', rowSent('a-1', 'p1').to],
      ['p3', rowSent('a-1', 'p1').to],
    ]) {
      const n = num();
      A.raw('b-2', { t: 'view', n, ...fresh('a-1'), id, to });
      await w.advance(50);
      refused.push(
        toPeer('a-1', 'viewing')
          .filter(m => m.n === n)
          .map(m => m.state)
          .join()
      );
    }
    check(
      'view test 3: a stale ticket, a CLI typed by hand and a Terminal panel: refused, the window never asked, no frame',
      refused.join() === 'refused,refused,refused' &&
        B.asked.length === asked2 &&
        !('to' in rowSent('a-1', 'p2')) &&
        !('to' in rowSent('a-1', 'p3')),
      refused
    );
    const held = num();
    A.raw('b-2', { t: 'view', n: held, ...fresh('a-1'), id: 'p1', to: rowSent('a-1', 'p1').to });
    await w.advance(50);
    check(
      '(a view with the newest counter and a true ticket is taken: the changed app holds a real ticket)',
      toPeer('a-1', 'viewing')
        .filter(m => m.n === held)
        .map(m => m.state)
        .join() === 'on'
    );
    A.raw('b-2', { t: 'unview', v: held, why: 'closed' });
    await w.advance(50);
    check(
      'unview from the watching computer ends it there',
      B.svc.state().watching.length === 0 && watchLines()[0].why === 'closed'
    );

    // test 5: the agent changes during a view
    await w.advance(61000);
    const open = async (c = A, id = 'p1') => {
      c.svc.view('b-2', id, markOf(c, id));
      await w.advance(50);
      return model(c);
    };
    check(
      '(a view is open again)',
      (await open()).state === 'on' && text(A).startsWith('secret-screen-text')
    );
    B.panels.p1 = panel('Moss', { pid: 9999, startedAt: 1700000009999 });
    B.svc.controlChanged();
    B.svc.screen('p1', screen('the restarted agent'));
    await w.advance(50);
    check(
      'view test 5: the agent in that panel was restarted: "gone", and no frame of the new one',
      model(A).state === 'ended' &&
        model(A).why === 'gone' &&
        !text(A).includes('restarted') &&
        text(A).startsWith('secret-screen-text') &&
        B.svc.state().watching.length === 0,
      [model(A).why, text(A)]
    );
    await relist();
    check('(open on the new one)', (await open()).state === 'on');
    B.locked = true;
    B.svc.controlChanged();
    await w.advance(50);
    check(
      'view test 4: the plan locks on the watched computer: the view ends at once',
      model(A).state === 'ended' && B.svc.state().watching.length === 0,
      model(A)
    );
    B.locked = false;
    B.svc.controlChanged();
    await relist();

    // test 18: the watched computer's user ends it
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    check(
      'view test 18: a press on the mark: the view ends with "stopped"',
      B.svc.stopView('a-1') === true &&
        (await w.advance(50),
        model(A).state === 'ended' && model(A).why === 'stopped' && model(A).picture !== null) &&
        B.svc.state().watching.length === 0
    );
    check(
      'view test 18: a new view from that computer inside ten minutes is refused',
      (await open()).why === 'refused'
    );
    await w.advance(10 * 60000);

    // this computer's own endings
    check('(open)', (await open()).state === 'on');
    A.svc.unview('hidden');
    await w.advance(50);
    check(
      'this window goes out of view: the watched computer ends the view ("hidden"), the last picture stays here with its time',
      B.svc.state().watching.length === 0 &&
        watchLines()[0].why === 'hidden' &&
        model(A).state === 'ended' &&
        model(A).why === 'hidden' &&
        model(A).picture !== null
    );

    // the session ends without a word: the watched computer's connection drops
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    for (const s of w.socks.filter(x => x.open && x.device === 'b-2')) s.close();
    await w.advance(200);
    check(
      'view test 4: the watched computer\'s connection drops: the watching side ends the view with the session ("offline"), the last picture stays with its time',
      model(A).state === 'ended' &&
        model(A).why === 'offline' &&
        model(A).picture !== null &&
        A.pc('b-2').session === false,
      [model(A).state, model(A).why]
    );
    await w.advance(60000);
    await relist();
    check(
      '(the watched computer is connected again, and no view runs there: a view lives inside one session)',
      A.pc('b-2').session === true && B.svc.state().watching.length === 0,
      [A.pc('b-2').session, B.svc.state().watching.length]
    );

    // the watched computer closes
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    const linesBefore = watchLines().length,
      usedBefore = usedBy('a-1');
    B.svc.quit();
    await w.advance(200);
    check(
      'view test 4: the watched computer closes: the view ends ("gone"), the picture stays with its time, nothing is shown as live',
      model(A).state === 'ended' &&
        model(A).why === 'gone' &&
        model(A).picture !== null &&
        A.pc('b-2').session === false,
      [model(A).state, model(A).why]
    );
    boot(B, () => {
      B.svc = B.make();
      B.svc.start();
    });
    await w.advance(30000);
    await relist();
    check(
      'view test 7: back after a restart: the minutes served before it are still counted, and the list still holds its lines',
      B.svc.controlLog().filter(e => e.op === 'watch').length === linesBefore &&
        usedBy('a-1') === usedBefore &&
        usedBefore >= 20 * 60 &&
        B.svc.controlLog().find(e => e.op === 'watch').why === 'gone' &&
        B.svc.state().watching.length === 0,
      [usedBefore, usedBy('a-1')]
    );

    // Forget on the watching side, and pair again: the allowance is keyed by the device
    const used7 = usedBy('a-1');
    check('(open)', (await open()).state === 'on');
    A.svc.forget('b-2');
    await w.advance(500);
    check(
      'view test 19: Forget on the watching computer: nothing of the view stays there',
      model(A) === null
    );
    if (B.pc('a-1')) B.svc.forget('a-1');
    await w.advance(500);
    check(
      'view test 4: the watched computer no longer has the pairing: no view runs',
      B.svc.state().watching.length === 0
    );
    await w.pair(A, B);
    await w.advance(500);
    B.svc.setControl('a-1', true);
    await relist();
    check(
      'view test 7: forgotten and paired again: the allowance is not reset',
      usedBy('a-1') >= used7 + 60 &&
        (await open()).state === 'on' &&
        model(A).left < 120 - used7 / 60,
      [used7, usedBy('a-1'), model(A).left]
    );
    A.svc.unview('closed');
    await w.advance(50);

    // test 10: the relay's limit, with a large busy screen and the agent list changing too
    await w.advance(61000);
    check('(open on a 200 by 60 screen)', (await open()).state === 'on');
    let seed = 5;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648,
      noise = n =>
        Array.from({ length: n }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
    const from10 = w.t,
      shown10 = A.shown.length;
    let flips = 0;
    for (let tick = 0; tick < 1200; tick++) {
      B.svc.screen('p1', {
        cols: 200,
        rows: 60,
        lines: Array.from({ length: 60 }, () => [noise(200)]),
      });
      if (tick % 5 === 0) {
        B.agents = B.agents.map(a => ({
          ...a,
          status: ++flips % 2 ? 'working' : 'idle',
          since: flips % 2 ? w.t : 0,
        }));
        B.svc.agentsChanged();
      }
      if (tick === 300 || tick === 800) A.svc.prompt('b-2', 'p4', 'A prompt while watching');
      if (tick % 500 === 0 && tick) A.svc.keepView();

      // The watching computer asks again every 15 seconds (each new
      // view sends a full picture at once) and makes this one answer as often as its limits allow
      // (a prompt and an act with a wrong ticket are answered "refused").
      if (tick % 150 === 0 && tick) {
        A.svc.unview('closed');
        A.svc.view('b-2', 'p1', markOf(A, 'p1'));
      }
      if (tick % 20 === 0)
        A.raw('b-2', {
          t: 'prompt',
          n: num(),
          ...fresh('a-1'),
          id: 'p1',
          to: 'c'.repeat(16),
          text: 'Answer me',
        });
      if (tick % 100 === 0)
        A.raw('b-2', {
          t: 'act',
          n: num(),
          ...fresh('a-1'),
          id: 'p1',
          to: 'c'.repeat(16),
          do: 'stop',
        });
      await w.advance(100);
    }
    const mine = w.sentAt.filter(x => x[0] === 'b-2' && x[1] >= from10).map(x => x[1]);
    let worst = 0;
    for (let i = 0; i < mine.length; i++) {
      let j = i;
      while (j < mine.length && mine[j] - mine[i] < 60000) j++;
      worst = Math.max(worst, j - i);
    }
    const frames10 = toPeer('a-1', 'frame').filter((f, i, all) => true).length;
    check(
      'view test 10: a 200 by 60 screen changing every 100 ms for two minutes, the agent list changing twice a second, prompts in between: the watched computer never sends more than ' +
        worst +
        ' messages in any minute (the relay allows 120)',
      worst > 30 && worst <= 105 && mine.length > 60,
      [worst, mine.length]
    );

    // The link rule: once the link is busy with other messages, the
    // frames wait for them. Counted from the second minute on, when the replies and lists of the
    // minute before are in the count the rule reads.
    const late = mine.filter(t => t >= from10 + 60000);
    let worstLate = 0;
    for (let i = 0; i < late.length; i++) {
      let j = i;
      while (j < late.length && late[j] - late[i] < 60000) j++;
      worstLate = Math.max(worstLate, j - i);
    }
    check(
      'review 15, 1: with the link already busy the frames leave it room: ' +
        worstLate +
        ' messages in the busiest later minute',
      worstLate > 30 && worstLate <= 80,
      worstLate
    ); // 70 as built, 100 without the link rule
    check(
      'view test 10: views were asked again and taken, the pictures were the cut bottom of the large screen, and the other messages went out too',
      A.shown
        .slice(shown10)
        .some(m => m && m.picture && m.picture.rows === 60 && m.picture.cut > 0) &&
        A.shown.slice(shown10).filter(m => m && m.state === 'on' && !m.picture).length >= 2 &&
        A.pc('b-2').ops.filter(o => o.kind === 'prompt').length >= 2 &&
        A.pc('b-2').agents.length === 4,
      [model(A)?.state, A.shown.slice(shown10).filter(m => m && m.picture).length]
    );
    check(
      '(frames were sent, and a line says how many messages the busiest minute held: ' +
        worst +
        ')',
      frames10 > 40
    );
    A.svc.unview('closed');
    await w.advance(50);

    // ---- The wiring ----
    B.term.p1 = screen('review-15-screen');
    B.agents = B.agents.map(a => ({ ...a, status: 'idle', since: 0 }));
    await relist();
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    seen.links.get('b-2').session('a-1');
    await w.advance(50); // B's link reports a new session with A in place of the live one
    check(
      'review 15, 3: a new session takes the place of a live one: the watched computer\'s view of the old session ends ("gone")',
      B.svc.state().watching.length === 0 &&
        toPeer('a-1', 'unview').at(-1).why === 'gone' &&
        watchLines()[0].why === 'gone',
      [B.svc.state().watching.length, watchLines()[0].why]
    );
    A.svc.unview('closed');
    await relist();
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    seen.links.get('a-1').session('b-2');
    await w.advance(50);
    check(
      "review 15, 3: the same on the watching computer: nothing of the old session's view is shown as live",
      model(A) === null || model(A).state === 'ended',
      model(A)
    );
    seen.links.get('b-2').session('a-1');
    await w.advance(50);
    A.svc.unview('closed');
    await relist();

    // finding 4: the last picture does not outlive the right
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    await w.advance(10 * 60000 + 500);
    check(
      '(it ended by itself after ten minutes; its last picture stays, with its time)',
      model(A)?.state === 'ended' && model(A).why === 'timeout' && model(A).picture !== null,
      model(A) && [model(A).state, model(A).why]
    );
    B.svc.setControl('a-1', false);
    await w.advance(5000);
    check(
      'review 15, 4: full control goes off on the watched computer AFTER the view ended: the kept picture goes too, the word on how it ended stays',
      model(A)?.state === 'ended' && model(A).why === 'timeout' && model(A).picture === null,
      model(A) && [model(A).why, model(A).picture === null]
    );
    A.svc.unview('closed');
    B.svc.setControl('a-1', true);
    await relist();
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    A.svc.accountChanged(false);
    check(
      'review 15, 4: signed out on the watching computer: no picture stays behind the lock',
      model(A) === null && A.svc.viewNow() === null
    );
    A.svc.accountChanged(true);
    await w.advance(60000);
    await relist();

    // finding 5: the watched computer's window was loaded again
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    {
      const n = B.asked.filter(x => x === 'p1 on').length;
      B.svc.viewReask();
      check(
        "review 15, 5: the watched computer's window was loaded again: it is asked for the watched panel once more",
        B.asked.filter(x => x === 'p1 on').length === n + 1
      );
    }

    // finding 14 (c): connecting goes off on the watching computer while a picture is shown
    A.svc.setOn(false);
    check(
      'review 15, 14c: connecting switched off on the watching computer: the picture is dropped',
      model(A) === null
    );
    boot(A, () => A.svc.setOn(true));
    await w.advance(60000);
    await relist();

    // finding 14 (b): the pairing is paused on the watching computer while a picture is shown
    await w.pair(A, C);
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    C.svc.forget('b-2');
    await w.advance(500);
    check(
      'review 15, 14b: the pairing is paused on the watching computer: the picture is dropped',
      A.pc('b-2')?.state === 'paused' && model(A) === null,
      [A.pc('b-2')?.state, model(A)]
    );
    A.svc.choose('b-2', 'keep');
    await w.advance(3000);
    await relist();

    // The two endings that lived in main.js are rules of the
    // service now, and run here
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    {
      const kept = [
        A.svc.windowNavigates({ isMainFrame: false, isSameDocument: false }),
        A.svc.windowNavigates({ isMainFrame: true, isSameDocument: true }),
        A.svc.windowNavigates(undefined, true, true),
        A.svc.windowNavigates(undefined, false, false),
        A.svc.lockChanged({ locked: false }),
        A.svc.lockChanged(null),
      ];
      check(
        'review 16, 1.1: a frame inside the page, a move inside the page and a lock that is not on end nothing',
        kept.every(x => x === false) && model(A)?.state === 'on',
        [kept, model(A)?.state]
      );
      const pushes = A.changes;
      A.svc.windowLoaded();
      await w.advance(10);
      check(
        'review 16, 2.4: the window finished loading with connecting on: the state is pushed to it unasked',
        A.changes > pushes && model(A)?.state === 'on',
        A.changes - pushes
      );
      const did = A.svc.windowNavigates({ isMainFrame: true, isSameDocument: false });
      await w.advance(500);
      check(
        "review 16, 1.1: this window loads another document (the event's own fields): this computer's view ends, on both",
        did === true && model(A) === null && (B.svc.state().watching || []).length === 0,
        [did, model(A), B.svc.state().watching]
      );
    }
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    {
      const did = A.svc.windowNavigates({}, false, true);
      await w.advance(500);
      check(
        'review 16, 1.1: the same with the old positional arguments only',
        did === true && model(A) === null && (B.svc.state().watching || []).length === 0,
        [did, model(A)]
      );
    }
    await w.advance(61000);
    check('(open)', (await open()).state === 'on');
    {
      const did = A.svc.lockChanged({ locked: true });
      await w.advance(500);
      check(
        "review 16, 1.1: the plan lock comes on: this computer's view ends, on both",
        did === true && model(A) === null && (B.svc.state().watching || []).length === 0,
        [did, model(A)]
      );
    }

    // in main.js, which only runs inside the app: that the three are wired is read from its text
    // (the rules themselves ran above)
    {
      const mainJs = require('fs').readFileSync(
          require('path').join(__dirname, '..', 'desktop', 'main.js'),
          'utf8'
        ),
        free = mainJs.slice(
          mainJs.indexOf('const LOCK_FREE = new Set(['),
          mainJs.indexOf('const LAPSE_READ')
        );
      check(
        "review 15, 5 (read from main.js): ending a view is on the list of calls a locked plan lets through; the plan locking and this window loading again end this computer's own view; the window is asked again for a watched panel after it loaded",
        free.includes("'remote:unview'") &&
          /remote\.lockChanged\(payload\?\.lock\)/.test(mainJs) &&
          // `[^;]*?`: the call is the first statement of that listener, however it is laid out
          /did-start-navigation', \(details, _url, inPlace, mainFrame\)[^;]*?\bremote\.windowNavigates\(details, inPlace, mainFrame\)/.test(
            mainJs
          ) &&
          /did-finish-load[^;]*?\bremote\.windowLoaded\(\)/.test(mainJs)
      );
    }

    // the window's calls
    {
      const handlers = {};
      registerIpc(
        {
          handle: (name, fn) => {
            handlers[name] = fn;
          },
        },
        B.svc
      );
      const big = await handlers['remote:screenRows']({}, 'p1', {
          cols: 5,
          rows: 5,
          lines: Array.from({ length: 2000 }, () => ['x']),
        }),
        odd = await handlers['remote:screenRows']({}, 'p1', 'rows'),
        stop = await handlers['remote:stopView']({}, '__proto__'),
        v = await handlers['remote:view']({}, 'a-1', {}, 7);
      check(
        "the window's calls for the live view take only bounded values: a screen of 2,000 lines and one that is no object are nothing, a bad id is refused",
        big.ok === true &&
          odd.ok === true &&
          stop.ok === false &&
          v.ok === true &&
          v.value.sent === 'not_sent'
      );
    }
    {
      const before = usedBy('a-1');
      B.svc.accountChanged(true, 'account-one');
      B.svc.accountChanged(true, 'account-two');
      check(
        "review 15, 14d: another account signs in on the watched computer: the last account's watching allowance is gone with its pairings",
        before > 0 && Object.keys(viewsNote()).length === 0 && B.svc.state().computers.length === 0,
        [before, viewsNote()]
      );
    }
    for (const c of [A, B, C]) c.svc.quit();
    await w.advance(120000);
    check('live view: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }

  // ---- choose option N and
  // the link's one budget (6h). A chooses, B has the agent, C is paired with B and holds
  // no right. OpenCode only; the app's answer to OpenCode is a stand-in (c.chose). ----
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Third');
    seen.now = w.now;
    const wire0 = seen.wire.length;
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    };
    for (const c of [A, B, C]) boot(c, () => c.svc.setOn(true));
    const KX = 'c'.repeat(40);
    for (const c of [A, B, C]) c.key = KX;
    const panel = (name, cli) => ({
      name,
      cli,
      mode: 'run',
      running: true,
      hand: false,
      instance: 'conv-' + name,
      pid: 4321,
      startedAt: 1700000000001,
    });
    B.panels = { p1: panel('Moss', 'OpenCode'), p2: panel('Wren', 'Claude Code') };
    const relist = async () => {
      B.agents = Object.entries(B.panels).map(([id, p]) => ({
        id,
        name: p.name,
        cli: p.cli,
        status: 'idle',
        since: 0,
        p: KX,
      }));
      B.svc.agentsChanged();
      await w.advance(5000);
    };
    B.names = { p1: 'Moss', p2: 'Wren' };
    const toPeer = (to, t) =>
      seen.wire
        .slice(wire0)
        .filter(m => m.to === to && m.obj.t === t)
        .map(m => m.obj);
    const fresh = to => {
      const m = seen.wire
        .slice(wire0)
        .filter(x => x.to === to && x.obj.c)
        .at(-1);
      return m ? { c: m.obj.c, ms: w.t - m.at } : { c: 1, ms: 0 };
    };
    let nn = 0;
    const num = () => (0xcc0000 + ++nn).toString(16).padStart(16, '0');
    const ask = (id, pane, opts, more) => ({
      id: 'question:' + id,
      paneId: pane,
      kind: 'menu',
      detail: 'Which database?',
      since: 1700000000000,
      inferred: false,
      ask: id,
      opts,
      ...more,
    });
    const item = (c, id) => c.pc('b-2')?.items.find(i => i.id === 'question:' + id) || null,
      opOf = n => A.pc('b-2')?.ops.find(e => e.n === n) || null;
    const ticket = id =>
      (toPeer('a-1', 'agents').at(-1)?.agents || []).find(r => r.id === id)?.to || '';

    // every message that computer put on the relay: a reply of the control rules is one more
    const sentBy = id => w.sent.filter(t => JSON.parse(t).from === id).length;
    await w.advance(60000);
    await w.pair(A, B);
    await w.pair(C, B);
    await relist();
    B.items = [ask('q1', 'p1', ['Postgres', 'SQLite', 'Something else'])];
    B.svc.itemsChanged();
    await w.advance(50);
    check(
      'choose: without the right the item goes as before: no options, no row, nothing to press',
      !!item(A, 'q1') &&
        item(A, 'q1').opts === undefined &&
        item(A, 'q1').row === undefined &&
        item(A, 'q1').kof === undefined &&
        item(A, 'q1').detail === 'Which database?' &&
        A.svc.pick('b-2', 'question:q1', 2, 'AAAAAAAAAAAAAAAA').sent === 'not_sent',
      item(A, 'q1')
    );

    // full control given the old way (no third argument): prompts yes, choosing no
    B.svc.setControl('a-1', true);
    await w.advance(5000);
    check(
      'choose: full control turned on without the sentence about picking an option does not include it; the card is told so',
      B.pc('a-1').control === true &&
        B.pc('a-1').pickable === false &&
        item(A, 'q1').opts === undefined &&
        !JSON.stringify(toPeer('a-1', 'needs').at(-1)).includes('Postgres'),
      [B.pc('a-1').pickable, item(A, 'q1')]
    );
    {
      const n = num(),
        calls = B.chose.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'choose',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        of: 'AAAAAAAAAAAAAAAA',
        pick: 2,
      });
      await w.advance(50);
      check(
        'choose: a choice sent anyway by a computer without the right is answered with one word, and the app is not asked',
        B.chose.length === calls &&
          sentBy('b-2') - mark === 1 &&
          B.svc.controlLog()[0]?.op === 'choose_no',
        [B.chose.length - calls, sentBy('b-2') - mark, B.svc.controlLog()[0]]
      );
    }
    {
      const { bindingPick } = require('../desktop/remote-control.js'),
        right = bindingPick({
          id: 'question:q1',
          kind: 'menu',
          agent: 'Moss',
          detail: 'Which database?',
          since: 1700000000000,
          row: 'p1',
          opts: ['Postgres', 'SQLite', 'Something else'],
        }),
        calls = B.chose.length;
      await w.advance(61000);
      A.raw('b-2', {
        t: 'choose',
        n: num(),
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        of: right,
        pick: 2,
      });
      await w.advance(50);
      check(
        'choose: even with the right binding (a computer that worked the labels out) a choice without the right is not carried out',
        B.chose.length === calls,
        B.chose.length - calls
      );
    }
    B.svc.setControl('a-1', false);
    B.svc.setControl('a-1', true, { choose: true });
    await w.advance(5000);
    const q1 = item(A, 'q1');
    check(
      'choose: turned on under the sentence: the question reaches that computer with its option labels, its agent row and a binding; the third computer gets none of it',
      B.pc('a-1').pickable === true &&
        !!q1 &&
        Array.isArray(q1.opts) &&
        q1.opts.join('|') === 'Postgres|SQLite|Something else' &&
        q1.row === 'p1' &&
        /^[A-Za-z0-9+/]{16}$/.test(q1.kof || '') &&
        item(C, 'q1').opts === undefined &&
        !JSON.stringify(toPeer('c-3', 'needs')).includes('Postgres'),
      [q1, item(C, 'q1')]
    );
    check(
      "choose: the binding is not an answer's binding of the same item",
      q1.kof !==
        bindingOf(
          shape(
            {
              id: q1.id,
              kind: q1.kind,
              agent: q1.agent,
              detail: q1.detail,
              since: q1.since,
              inferred: false,
            },
            true
          )
        ) &&
        q1.can === undefined &&
        q1.of === undefined
    );
    check(
      'choose: a number above the options, zero, another binding, an unknown item: nothing is sent',
      [
        A.svc.pick('b-2', q1.id, 4, q1.kof).sent,
        A.svc.pick('b-2', q1.id, 0, q1.kof).sent,
        A.svc.pick('b-2', q1.id, 2, 'AAAAAAAAAAAAAAAA').sent,
        A.svc.pick('b-2', 'question:zz', 2, q1.kof).sent,
        C.svc.pick('b-2', q1.id, 2, q1.kof).sent,
      ].join() === 'not_sent,not_sent,not_sent,not_sent,not_sent' && B.chose.length === 0
    );
    const sentKeys = () =>
      seen.wire
        .slice(wire0)
        .filter(m => m.to === 'b-2' && m.obj.t === 'choose')
        .map(m => Object.keys(m.obj).sort().join());
    const p1 = A.svc.pick('b-2', q1.id, 2, q1.kof);
    await w.advance(50);
    check(
      'choose: option 2 is sent as one message with the binding and the number and nothing else: no key, no text',
      p1.sent === 'asked' &&
        sentKeys().at(-1) === 'c,id,ms,n,of,pick,t,to' &&
        seen.wire
          .slice(wire0)
          .filter(m => m.to === 'b-2' && m.obj.t === 'choose')
          .at(-1).obj.pick === 2,
      sentKeys().at(-1)
    );
    check(
      "choose: B hands the app that panel, that question id and that option's label, with a guard that holds, once",
      B.chose.length === 1 &&
        JSON.stringify(B.chose[0]) ===
          JSON.stringify({ panelId: 'p1', ask: 'q1', label: 'SQLite', pick: 2, guard: true }),
      B.chose
    );
    check(
      'choose: A reads "done" on that agent\'s row, and B\'s list names the option in words',
      opOf(p1.n)?.state === 'done' &&
        opOf(p1.n).kind === 'choose' &&
        B.svc.controlLog()[0].op === 'choose' &&
        B.svc.controlLog()[0].head === '2: SQLite' &&
        B.svc.controlLog()[0].agent === 'Moss',
      [opOf(p1.n), B.svc.controlLog()[0]]
    );

    // what B refuses although the right is held: each leaves the app unasked
    const tryRaw = async more => {
      const n = num(),
        calls = B.chose.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'choose',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        of: q1.kof,
        pick: 1,
        ...more,
      });
      await w.advance(50);
      return {
        asked: B.chose.length - calls,
        reply:
          sentBy('b-2') - mark === 0
            ? 'silence'
            : sentBy('b-2') - mark === 1
              ? 'one word'
              : 'several',
      };
    };
    await w.advance(61000);
    const noLines = () => B.svc.controlLog().filter(e => e.op === 'choose_no').length,
      no0 = noLines();
    const refused = {
      'another binding': await tryRaw({ of: 'BBBBBBBBBBBBBBBB' }),
      'a number above the options': await tryRaw({ pick: 4 }),
      'a wrong ticket': await tryRaw({ to: '0'.repeat(16) }),
      'held six seconds by the relay': await tryRaw({ ms: fresh('a-1').ms - 6000 }),
      'a Claude Code agent': await tryRaw({ id: 'p2', to: ticket('p2') }),
    };
    check(
      'choose: another binding, a number above the options, a wrong ticket, a message held six seconds, and a Claude Code agent: each refused, the app never asked',
      Object.values(refused).every(r => r.asked === 0 && r.reply === 'one word'),
      refused
    );
    check(
      'choose: the two that reached the question (another binding, a number above the options) each have their line as a try that was not taken; the three that never did share one line for that minute',
      noLines() - no0 === 3,
      B.svc
        .controlLog()
        .slice(0, 5)
        .map(e => e.op + ' ' + e.head)
    );
    await w.advance(61000);
    const no1 = noLines();
    const shapes = {
      'pick 0': await tryRaw({ pick: 0 }),
      'pick 10': await tryRaw({ pick: 10 }),
      'a letter': await tryRaw({ pick: 'y' }),
      'a list': await tryRaw({ pick: [1] }),
      'a short binding': await tryRaw({ of: 'AAAA' }),
    };
    check(
      'choose: 0, 10, a letter, a list and a short binding are not a choice: refused, the app never asked',
      Object.values(shapes).every(r => r.asked === 0 && r.reply === 'one word'),
      shapes
    );
    check(
      'choose: five tries that are no choice at all leave one line for that minute, not five',
      noLines() - no1 === 1,
      B.svc
        .controlLog()
        .map(e => e.op)
        .slice(0, 8)
    );
    {
      const mark = sentBy('b-2'),
        calls = B.chose.length;
      for (let i = 0; i < 4; i++)
        A.raw('b-2', {
          t: 'choose',
          n: num(),
          ...fresh('a-1'),
          id: 'p1',
          to: ticket('p1'),
          of: 'CCCCCCCCCCCCCCCC',
          pick: 1,
        });
      await w.advance(50);
      check(
        'choose: six a minute from one computer are looked at; the seventh and later get silence',
        sentBy('b-2') - mark === 1 && B.chose.length === calls,
        sentBy('b-2') - mark
      );
    }

    // the question changed on B after A was shown it: the binding A holds is no longer that
    // question's
    await w.advance(61000);
    B.items = [ask('q1', 'p1', ['Postgres', 'MySQL', 'Something else'])];
    {
      const n = num(),
        calls = B.chose.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'choose',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        of: q1.kof,
        pick: 2,
      });
      await w.advance(50);
      check(
        'choose: the options changed on B before the choice arrived: refused with one word, nothing answered (the binding covers every label)',
        B.chose.length === calls && sentBy('b-2') - mark === 1
      );
      check(
        "choose: and B's list does not say an option was chosen: the line is that of a try that was not taken",
        B.svc.controlLog()[0].op === 'choose_no' &&
          B.svc.controlLog()[0].head === '' &&
          !B.svc.controlLog().some(e => e.op === 'choose' && e.head === '2'),
        B.svc.controlLog().slice(0, 3)
      );
    }
    {
      B.items = [ask('q1', 'p1', ['Postgres', 'SQLite', 'Something else'])];
      B.svc.itemsChanged();
      await w.advance(61000);
      B.onChoose = () => 'failed';
      const again = item(A, 'q1'),
        pf = A.svc.pick('b-2', again.id, 1, again.kof);
      await w.advance(50);
      check(
        'choose: the app could not answer OpenCode (the question was answered there first): A reads "failed" and B\'s list does not say it was chosen',
        pf.sent === 'asked' &&
          opOf(pf.n)?.state === 'failed' &&
          B.svc.controlLog()[0].op === 'choose_no',
        [opOf(pf.n), B.svc.controlLog()[0]]
      );
      B.onChoose = () => 'done';
    }

    // what the items may carry, read on arrival by the same rule
    const rawItem = async more => {
      const g = 90000 + ++nn;
      B.raw('a-1', {
        t: 'needs',
        g,
        i: 0,
        n: 1,
        items: [
          {
            id: 'question:r1',
            kind: 'menu',
            agent: 'Moss',
            detail: 'Which?',
            since: 5,
            inferred: false,
            row: 'p1',
            ...more,
          },
        ],
      });
      await w.advance(50);
      const it = item(A, 'r1');
      return !!it && it.opts === undefined && it.kof === undefined;
    };
    const TAB = String.fromCharCode(9),
      bad = [
        { opts: ['a', 'a'] },
        { opts: Array.from({ length: 10 }, (_, i) => 'o' + i) },
        { opts: [] },
        { opts: ['a' + TAB + 'b', 'c'] },
        { opts: ['a\nb', 'c'] },
        { opts: 'ab' },
        { opts: ['a', 7] },
        { opts: ['a', 'b'], row: '' },
        { opts: ['a', 'b'], inferred: true },
        { opts: ['a', 'b'], kind: 'permission' },
        { opts: ['a', 'b'], detail: '' },
      ];
    const kept = [];
    for (const more of bad) kept.push(await rawItem(more));
    check(
      'choose: two equal labels, ten labels, none, a tab, two lines, a text, a number among them, no row, a guessed item, another kind, no text: no options are read',
      kept.every(Boolean),
      kept
    );
    B.svc.itemsChanged();
    await w.advance(50);

    // the right ends
    B.svc.setControl('a-1', false);
    await w.advance(5000);
    check(
      "choose: full control goes off: the options leave that computer's item, and a choice is not looked at",
      item(A, 'q1')?.opts === undefined &&
        A.svc.pick('b-2', 'question:q1', 2, q1.kof).sent === 'not_sent' &&
        (await tryRaw({})).reply === 'silence' &&
        B.chose.length === 2
    );

    {
      // Fix 20 (the integration read): the stored mark for picking an option ends wherever the
      // switch's own mark ends, as the one for watching does.
      const saved = () =>
          require('../desktop/remote-keys.js').keyStore(B.backend).note('prefs') || {},
        has = k => Object.hasOwn(saved()[k] || {}, 'a-1');
      check(
        'fix 20: full control turned off: no mark for picking an option (or for watching) stays in what is saved',
        !has('control') && !has('choose') && !has('watch'),
        saved()
      );
      B.svc.setControl('a-1', true, { choose: true });
      const given = has('control') && has('choose') && has('watch');
      B.svc.setDetail('a-1', false);
      check(
        'fix 20: the text switch going off takes full control and both marks with it',
        given && !has('control') && !has('choose') && !has('watch'),
        [given, saved()]
      );
      B.svc.setDetail('a-1', true);
      await w.advance(5000);
    }

    // ---- the link's one budget: optional streams below 70, taking an operation below 100, a stop
    // or an answer below 112, nothing at 116 ----
    B.svc.setControl('a-1', true, { choose: true });
    B.svc.setAnswer('a-1', true);
    await w.advance(61000);
    B.items = [
      ask('q2', 'p1', ['Yes', 'No']),
      {
        id: 'permission:w1',
        paneId: 'p1',
        kind: 'permission',
        tool: 'Bash',
        detail: 'Bash: npm test',
        whole: true,
        since: 1700000000000,
        inferred: false,
      },
    ];
    B.svc.itemsChanged();
    await w.advance(5000);
    const sentIn = ms => w.sentAt.filter(([id, at]) => id === 'b-2' && w.t - at < ms).length;

    // B is made to send by lists of its own (each agent list is one message): the count rises
    // without any operation of A
    const fill = async upTo => {
      let guard = 0;
      while (sentIn(60000) < upTo && guard++ < 400) {
        B.panels.p9 = panel('Fill' + guard, 'OpenCode');
        B.agents = Object.entries(B.panels).map(([id, p]) => ({
          id,
          name: p.name,
          cli: p.cli,
          status: 'idle',
          since: 0,
          p: KX,
        }));
        B.svc.agentsChanged();
        B.svc.setDetail('c-3', guard % 2 === 0);
        await w.advance(400);
      }
      return sentIn(60000);
    };
    const before0 = sentIn(60000);
    check('budget: (setup) a quiet link', before0 < 40, before0);
    const at70 = await fill(72);
    {
      const q2 = item(A, 'q2'),
        n = num(),
        calls = B.chose.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'choose',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        of: q2 ? q2.kof : 'AAAAAAAAAAAAAAAA',
        pick: 1,
      });
      await w.advance(50);
      check(
        'budget: with 70 or more messages in the last minute a choice gets silence: not answered, not refused, the app not asked',
        at70 >= 70 && !!q2 && B.chose.length === calls && sentBy('b-2') === mark,
        [at70, B.chose.length - calls, sentBy('b-2') - mark]
      );
    }
    {
      const n = num(),
        d = B.did.submit.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'prompt',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        text: 'Still below one hundred',
      });
      await w.advance(50);
      check(
        'budget: a prompt is still taken and answered at that count',
        B.did.submit.length === d + 1 && sentBy('b-2') - mark >= 1,
        [at70, B.did.submit.length - d, sentBy('b-2') - mark]
      );
    }
    const at100 = await fill(101);
    {
      const n = num(),
        d = B.did.submit.length,
        mark = sentBy('b-2');
      A.raw('b-2', {
        t: 'prompt',
        n,
        ...fresh('a-1'),
        id: 'p1',
        to: ticket('p1'),
        text: 'Past one hundred',
      });
      await w.advance(50);
      check(
        'budget: with 100 or more a prompt is not taken and nothing is said: the sender reads no reply',
        at100 >= 100 && B.did.submit.length === d && sentBy('b-2') === mark,
        [at100, B.did.submit.length - d, sentBy('b-2') - mark]
      );
    }
    {
      const n = num(),
        d = B.did.stop.length,
        mark = sentBy('b-2');
      A.raw('b-2', { t: 'act', n, ...fresh('a-1'), id: 'p1', to: ticket('p1'), do: 'stop' });
      await w.advance(50);
      check(
        'budget: a stop is served first: still taken and answered at that count',
        B.did.stop.length === d + 1 && sentBy('b-2') - mark >= 1,
        [sentIn(60000), B.did.stop.length - d, sentBy('b-2') - mark]
      );
    }
    const at116 = await fill(140);
    check(
      "budget: this computer never sends more than 116 messages in any minute, whatever it is asked to send, so never the relay's 120",
      at116 <= 116 && at116 >= 110,
      at116
    );
    {
      const n = num(),
        d = B.did.stop.length,
        mark = sentBy('b-2');
      A.raw('b-2', { t: 'act', n, ...fresh('a-1'), id: 'p1', to: ticket('p1'), do: 'stop' });
      await w.advance(50);
      check(
        'budget: at 112 or more even a stop is not taken (its reply could not leave)',
        sentIn(60000) >= 112 && B.did.stop.length === d && sentBy('b-2') === mark,
        [sentIn(60000), B.did.stop.length - d, sentBy('b-2') - mark]
      );
    }
    delete B.panels.p9;
    await w.advance(61000);
    await relist();
    check(
      'budget: a minute later the lists that could not leave have been sent again and the link is as before',
      sentIn(60000) < 40 &&
        (A.pc('b-2')?.agents || [])
          .map(a => a.id)
          .sort()
          .join() === 'p1,p2',
      [sentIn(60000), (A.pc('b-2')?.agents || []).map(a => a.id)]
    );

    // ---- "does a paired computer hold full control here"
    // without reading anything while connecting is off ----
    {
      const N = w.computer('n-9', 'Never used');
      let reads = 0;
      for (const k of ['available', 'read']) {
        const real = N.backend[k];
        N.backend[k] = (...a) => {
          reads++;
          return real(...a);
        };
      }
      check(
        'review 19, 3.2: with connecting never used the question is answered "no" and the key store is not asked',
        N.svc.controlGiven() === false && reads === 0,
        reads
      );
      check(
        'review 19, 3.2: yes on the computer that gave full control, no on the ones that gave none',
        B.svc.controlGiven() === true &&
          A.svc.controlGiven() === false &&
          C.svc.controlGiven() === false,
        [B.svc.controlGiven(), A.svc.controlGiven(), C.svc.controlGiven()]
      );
    }

    // ---- 6.1: a yes or no counts toward one computer's 30 operations a minute; a stop keeps four
    // places past it ----
    {
      await w.advance(61000);
      B.panels.p9 = panel('Tick', 'OpenCode');
      await relist(); // a fresh counter for A to echo
      const w1 = A.pc('b-2')?.items.find(i => i.id === 'permission:w1'),
        yes = () =>
          A.raw('b-2', { t: 'answer', id: 'permission:w1', of: w1 ? w1.of : '', say: 'yes' });

      // thirty operations of A are taken into the count; none of them has the shape to be answered
      for (let i = 0; i < 30; i++) A.raw('b-2', { t: 'prompt', n: 'not-a-number-' + i });
      await w.advance(50);
      {
        const calls = seen.permCalls,
          mark = sentBy('b-2');
        yes();
        await w.advance(50);
        check(
          'review 19, 6.1: after thirty operations of one computer in a minute its yes or no is not taken as well: not answered, the app not asked',
          !!w1 && w1.can === true && seen.permCalls === calls && sentBy('b-2') === mark,
          [seen.permCalls - calls, sentBy('b-2') - mark]
        );
      }
      {
        const d = B.did.stop.length,
          mark = sentBy('b-2');
        A.raw('b-2', {
          t: 'act',
          n: num(),
          ...fresh('a-1'),
          id: 'p1',
          to: ticket('p1'),
          do: 'stop',
        });
        await w.advance(50);
        check(
          'review 19, 6.1: its Stop is still taken then (four places are kept for a stop or an interrupt), and answered',
          B.did.stop.length === d + 1 && sentBy('b-2') - mark >= 1,
          [B.did.stop.length - d, sentBy('b-2') - mark]
        );
      }
      await w.advance(61000);
      {
        const calls = seen.permCalls;
        yes();
        await w.advance(50);
        check(
          'review 19, 6.1: a minute later the same yes is taken',
          seen.permCalls === calls + 1,
          seen.permCalls - calls
        );
      }
      delete B.panels.p9;
      await w.advance(61000);
      await relist();
    }

    // ---- 6.2: a list refused at the hard line goes when that minute has passed, also when nothing
    // changes again ----
    {
      // B changes its "needs you" list again and again until one list for A does not leave (116 in
      // the minute); `lost` is the question only that list held
      const overfill = async tag => {
        for (let i = 1; i <= 300; i++) {
          const id = tag + i;
          B.items = [
            ...B.items.filter(x => !x.id.startsWith('question:' + tag)),
            ask(id, 'p2', ['Now', 'Later']),
          ];
          B.svc.itemsChanged();
          await w.advance(20);
          if (!item(A, id)) return id;
        }
        return '';
      };

      // "needs you" lists that left for A (a heartbeat is another kind)
      const lists = () => toPeer('a-1', 'needs').length;
      const lost = await overfill('late'),
        full = sentIn(60000),
        mark = lists();
      await w.advance(30000);
      check(
        'review 19, 6.2: (setup) a "needs you" list was refused in a full minute, and nothing changes afterwards',
        !!lost && full >= 110 && !item(A, lost) && lists() === mark,
        [lost, full, lists() - mark]
      );
      await w.advance(35000);
      check(
        'review 19, 6.2: when that minute has passed the list goes by itself: the other computer hears of the question',
        !!lost && !!item(A, lost) && lists() === mark + 1,
        [lost, !!item(A, lost), lists() - mark]
      );
      await w.advance(125000);
      check(
        'review 19, 6.2: sent once, not again every minute',
        lists() === mark + 1,
        lists() - mark
      );
    }

    // ---- 7.1: the text of a finished answer is read only by the state's own rule (reportText)
    // ----
    {
      const KZ = 'd'.repeat(40),
        read = () => A.svc.reportText('b-2', 'p1');
      B.svc.reported({
        id: 'p1',
        name: 'Moss',
        cli: 'OpenCode',
        at: w.t,
        task: 'Pick a database',
        did: 'Moss picked one',
        text: 'The whole answer.',
        p: KX,
      });
      await w.advance(50);
      check(
        'review 19, 7.1: (setup) the row says there is an answer and its text is read',
        A.pc('b-2')?.agents.find(a => a.id === 'p1')?.last?.has === true &&
          read()?.text === 'The whole answer.',
        read()
      );
      A.key = KZ;
      A.svc.projectChanged();
      await w.advance(50);
      check(
        'review 19, 7.1: another project is open here: the row is not listed and nothing is read',
        read() === null && !JSON.stringify(A.svc.state()).includes('The whole answer.')
      );
      A.key = KX;
      A.svc.projectChanged();
      await w.advance(50);
      check(
        'review 19, 7.1: (back in the project it is read again)',
        read()?.text === 'The whole answer.'
      );
      B.svc.setDetail('a-1', false);
      await w.advance(50);
      check(
        'review 19, 7.1: the other computer took its text switch back: nothing is read',
        read() === null
      );
      B.svc.setDetail('a-1', true);
      await w.advance(50);
      B.svc.reported({
        id: 'p1',
        name: 'Moss',
        cli: 'OpenCode',
        at: w.t,
        task: 'Pick again',
        did: 'Moss picked again',
        text: 'The second answer.',
        p: KX,
      });
      await w.advance(50);
      check(
        'review 19, 7.1: (setup) a result that finished after the switch went on again is read',
        read()?.text === 'The second answer.',
        read()
      );
      const lost2 = await (async () => {
        for (let i = 1; i <= 300; i++) {
          const id = 'last' + i;
          B.items = [
            ...B.items.filter(x => !x.id.startsWith('question:last')),
            ask(id, 'p2', ['Now', 'Later']),
          ];
          B.svc.itemsChanged();
          await w.advance(20);
          if (!item(A, id)) return id;
        }
        return '';
      })();
      check(
        'review 19, 6.2: (setup) a list waits for its minute again when the computers quit',
        !!lost2,
        lost2
      );
      for (const s of w.socks.filter(x => x.open && x.device === 'b-2')) s.close();
      await w.advance(50); // B's connection is gone: no session, the finished task is still named
      check(
        'review 19, 7.1: without a session nothing is read, though the finished task is still named for the bell',
        read() === null &&
          A.pc('b-2')?.session === false &&
          A.pc('b-2')?.finished?.task === 'Pick again',
        [read(), A.pc('b-2')?.finished]
      );
      A.svc.setOn(false);
      await w.advance(50);
      let off = '';
      try {
        off = JSON.stringify(read());
      } catch (e) {
        off = String(e.message);
      }
      check(
        'review 19, 7.1: with connecting off the call answers nothing (it throws "remote: off", which the window reads as not ok)',
        off === 'remote: off',
        off
      );
    }
    for (const c of [A, B, C]) c.svc.quit();
    check(
      'review 19, 6.2: the wait for a refused list ends with the link: no timer is left the moment the computers quit',
      w.timers.length === 0,
      w.timers.length
    );
    await w.advance(120000);
    check('choose and the budget: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }

  // ---- keep-awake and sleep: what the first block does not hold (a paused pairing, the close
  // before sleep, when a change is pushed) ----
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop');
    A.svc = A.make();
    B.svc = B.make();
    A.svc.setOn(true);
    B.svc.setOn(true);
    await w.advance(50);
    await w.pair(A, B);
    await w.advance(500);
    const aw = () => A.svc.state().awake;
    A.svc.setAwake(true);
    A.working = true;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: held with an agent working and a computer paired, whether or not that computer is connected',
      aw().held === true && A.holds.join() === 'true',
      [aw(), A.holds]
    );
    const c0 = A.changes;
    A.svc.powerChanged();
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: told again that an agent changed, with nothing changed: nothing is pushed and nothing is asked of the system',
      A.changes === c0 && A.holds.join() === 'true',
      [A.changes - c0, A.holds]
    );
    A.working = false;
    A.svc.powerChanged();
    await w.advance(10);
    check(
      'keep-awake: the reason changed (the agent is done): given back, and the card is told at once',
      aw().held === false &&
        aw().why === 'idle' &&
        A.changes > c0 &&
        A.holds.join() === 'true,false',
      [aw(), A.changes - c0]
    );
    A.working = true;
    A.svc.powerChanged();
    await w.advance(10);
    B.svc.setOn(false);
    await w.advance(500);
    check(
      'keep-awake: the other computer went offline: still held (a live session is not needed)',
      A.pc('b-2').session === false && aw().held === true && A.holds.at(-1) === true,
      [A.pc('b-2').session, aw()]
    );
    B.svc.setOn(true);
    await w.advance(3000);
    B.svc.stopEverywhere();
    await w.advance(500);
    check(
      'keep-awake: the only pairing is paused (the other computer asked to stop): given back, and the state says "paused"',
      A.pc('b-2').state === 'paused' &&
        aw().held === false &&
        aw().why === 'paused' &&
        A.holds.at(-1) === false,
      [A.pc('b-2').state, aw()]
    );
    A.svc.choose('b-2', 'keep');
    await w.advance(500);
    check(
      'keep-awake: the pairing is kept: held again',
      aw().held === true && A.holds.at(-1) === true,
      aw()
    );

    // the close before sleep, and the wake
    const C = w.computer('c-3', 'Tablet');
    C.svc = C.make();
    C.svc.setOn(true);
    await w.advance(50);
    await w.pair(A, C);
    await w.advance(3000);
    check(
      'sleep: before it, the two computers see each other',
      A.svc.state().connection === 'online' &&
        C.pc('a-1').online === true &&
        C.pc('a-1').session === true,
      [A.svc.state().connection, C.pc('a-1')]
    );
    const slept = A.svc.asleep();
    await w.advance(100);
    check(
      'sleep: the system is about to sleep: the link closes from this side, the other computer shows this one offline at once, and this one waits',
      slept === true &&
        C.pc('a-1').online === false &&
        C.pc('a-1').session === false &&
        A.svc.state().connection === 'waiting',
      [slept, C.pc('a-1').online, A.svc.state().connection]
    );
    check(
      "sleep: keep-awake is not touched by it (the system's own sleep is the user's)",
      aw().held === true
    );
    const woke = A.svc.woke();
    await w.advance(4000);
    check(
      'wake: the system resumed: the link looks at once and the two see each other again within seconds',
      woke === true && A.svc.state().connection === 'online' && C.pc('a-1').online === true,
      [woke, A.svc.state().connection, C.pc('a-1').online]
    );
    await w.advance(30000);
    check(
      'wake: and the session is back',
      C.pc('a-1').session === true && A.pc('c-3').session === true
    );
    A.svc.setOn(false);
    await w.advance(50);
    check(
      "sleep: with connecting off the system's sleep and wake do nothing",
      A.svc.asleep() === false && A.svc.woke() === false && A.svc.state().connection === 'off'
    );
    for (const c of [A, B, C]) c.svc.quit();
    await w.advance(120000);
    check(
      'keep-awake and sleep: quit gives the hold back and leaves no timer',
      A.holds.at(-1) === false && w.timers.length === 0,
      [A.holds.at(-1), w.timers.length]
    );
  }

  // ---- agents message agents on a paired computer ----
  // Two real services. Stand-ins: the write (sayHere, counted
  // like every action) and "may that panel take one" (sayTarget). The mark is set through the
  // service itself: the window's channel cannot give it while the piece is switched off (checked
  // below).
  {
    const w = world(),
      A = w.computer('a-1', 'Desk'),
      B = w.computer('b-2', 'Laptop'),
      C = w.computer('c-3', 'Tablet');
    const KX = 'a'.repeat(40),
      wire0 = seen.wire.length;
    const boot = (c, how) => {
      const n = seen.sends.length;
      how();
      c.raw = seen.sends[n];
    };
    for (const c of [A, B, C]) {
      boot(c, () => c.svc.setOn(true));
      c.key = KX;
    }
    const panel = name => ({
      name,
      cli: 'Claude Code',
      mode: 'run',
      running: true,
      hand: false,
      instance: 'conv-' + name,
      pid: 4321,
      startedAt: 1700000000001,
    });
    B.panels = { p1: panel('Finch'), p2: panel('Moss') };
    B.sayOk = id => id === 'p1';
    B.said = [];
    A.said = [];
    const relist = async () => {
      B.agents = Object.entries(B.panels).map(([id, p]) => ({
        id,
        name: p.name,
        cli: p.cli,
        status: 'idle',
        since: 1,
        p: KX,
      }));
      B.svc.agentsChanged();
      await w.advance(5000);
    };
    await w.advance(60000);
    await w.pair(A, B);
    await w.pair(C, B);
    await relist();
    const toA = t => seen.wire.slice(wire0).filter(m => m.to === 'a-1' && m.obj.t === t),
      rowSent = id => (toA('agents').at(-1)?.obj.agents || []).find(r => r.id === id);
    const freshFor = to => {
      const m = seen.wire
        .slice(wire0)
        .filter(x => x.to === to && x.obj.c)
        .at(-1);
      return m ? { c: m.obj.c, ms: w.t - m.at } : { c: 1, ms: 0 };
    };
    const marks = c => keysMod.keyStore(c.backend).note('prefs').say || {};
    const by = { name: 'Wren', cli: 'Claude Code' },
      words = [],
      answers = [];
    const cb = { word: x => words.push(x), answer: a => answers.push(a) };
    const rep = (text, more) => ({
      id: 'p1',
      name: 'Finch',
      cli: 'Claude Code',
      at: w.t,
      task: 'A question from Desk',
      did: 'Answered it',
      text,
      p: KX,
      ...more,
    });

    // full control without the sentence: the right is not in it
    B.svc.setControl('a-1', true);
    await relist();
    check(
      'say: full control turned on without the sentence does not include it: no mark, no word in `control`, no row says it takes a message, and its card says so',
      B.pc('a-1').control === true &&
        B.pc('a-1').talkable === false &&
        Object.keys(marks(B)).length === 0 &&
        toA('control').every(m => !('say' in m.obj)) &&
        toA('agents').every(m => m.obj.agents.every(r => !('m' in r))) &&
        A.pc('b-2').canSay === false,
      [B.pc('a-1').talkable, marks(B)]
    );
    check(
      'say: with no computer that takes messages, this computer lists none and sends none',
      A.svc.sayTargets().length === 0 &&
        A.svc.say('b-2', 'p1', 'ask', by, 'Which branch?', cb).sent === 'not_sent' &&
        B.said.length === 0
    );
    {
      const sentBy = id => w.sent.filter(t => JSON.parse(t).from === id).length,
        tally = () => [seen.ctlReceives, seen.acts, B.svc.controlLog().length, sentBy('b-2')];
      const was = tally(),
        f = freshFor('a-1'),
        went = A.raw('b-2', {
          t: 'say',
          n: '1'.repeat(16),
          ...f,
          id: 'p1',
          to: rowSent('p1').to,
          kind: 'ask',
          by,
          text: 'Which branch?',
        });
      await w.advance(200);
      check(
        'say: a `say` that really left for a computer without the mark is dropped unread there: not looked at, no reply, nothing done, no line',
        went === true && JSON.stringify(tally()) === JSON.stringify(was) && B.said.length === 0,
        [was, tally(), went]
      );
    }
    {
      const h = {};
      registerIpc(
        {
          handle: (ch, fn) => {
            h[ch] = fn;
          },
        },
        B.svc
      );
      B.svc.setControl('a-1', false);
      const r = await h['remote:setControl']({}, 'a-1', true, 'choose say');
      check(
        "say: SWITCHED OFF: the window's channel turns full control on and cannot give this right, whatever it passes",
        r.ok === true &&
          r.value.computers.find(x => x.id === 'a-1').control === true &&
          r.value.computers.find(x => x.id === 'a-1').talkable === false &&
          Object.keys(marks(B)).length === 0,
        marks(B)
      );
      B.svc.setControl('a-1', false);

      // The git hand-over's right (user: its sentence approved as written, 2026-10-10): given only
      // by the word of the question that showed it.
      const syncs = () => keysMod.keyStore(B.backend).note('prefs').sync || {},
        pcA = r => r.value.computers.find(x => x.id === 'a-1');
      const r1 = await h['remote:setControl']({}, 'a-1', true, 'choose say');
      const without =
        pcA(r1).control === true && pcA(r1).syncable === false && Object.keys(syncs()).length === 0;
      B.svc.setControl('a-1', false);
      const r2 = await h['remote:setControl']({}, 'a-1', true, 'choose say sync');
      const withIt =
        pcA(r2).control === true &&
        pcA(r2).syncable === true &&
        typeof syncs()['a-1'] === 'string' &&
        Object.keys(syncs()).length === 1 &&
        pcA(r2).talkable === false;
      B.svc.setControl('a-1', false);
      const gone = Object.keys(syncs()).length === 0;
      const r3 = await h['remote:setControl']({}, 'a-1', true, 'sync');
      const odd = pcA(r3).syncable === false && Object.keys(syncs()).length === 0;
      check(
        'sync: the hand-over right is given only by the word of the question that showed its sentence, never without it or by another word, it does not give agent messages, and it goes with full control',
        without && withIt && gone && odd,
        [without, withIt, gone, odd, syncs()]
      );
      B.svc.setControl('a-1', false);
    }

    // the mark, given by the service itself as the question with the sentence would give it
    B.svc.setControl('a-1', true, { say: true, choose: true });
    await relist();
    const pid = keysMod.keyStore(B.backend).pairing('a-1').pairingId.toString('base64');
    check(
      'say: the mark is stored as the id of the pairing it was given for, for that computer only',
      marks(B)['a-1'] === pid &&
        Object.keys(marks(B)).length === 1 &&
        B.pc('a-1').talkable === true &&
        B.pc('c-3').talkable === false
    );
    check(
      'say: that computer is told in one word, and only the row that may take a message says so; another computer is told nothing',
      toA('control').at(-1).obj.say === true &&
        rowSent('p1').m === true &&
        !('m' in rowSent('p2')) &&
        A.pc('b-2').canSay === true &&
        C.pc('b-2').canSay === false &&
        !seen.wire
          .slice(wire0)
          .some(
            m => m.to === 'c-3' && (m.obj.say === true || (m.obj.agents || []).some(r => 'm' in r))
          ),
      [toA('control').at(-1).obj, rowSent('p1'), rowSent('p2')]
    );
    const targets = A.svc.sayTargets();
    check(
      'say: the asking computer lists that computer with its agents of the open project, each with whether it can be asked, and nothing of a task or a ticket',
      targets.length === 1 &&
        targets[0].id === 'b-2' &&
        targets[0].name === 'Laptop' &&
        targets[0].rows.map(r => r.id + ':' + r.m).join() === 'p1:true,p2:false' &&
        Object.keys(targets[0].rows[0]).sort().join() === 'cli,id,m,name,status',
      targets
    );
    check(
      "say: only rows known to be the open project's are listed",
      ((A.key = 'b'.repeat(40)), A.svc.sayTargets()[0]?.rows.length || 0) === 0 &&
        ((A.key = KX), A.svc.sayTargets()[0].rows.length) === 2
    );

    // an ask: taken on B, the delivery gets everything, A hears "sent"
    const s1 = A.svc.say('b-2', 'p1', 'ask', by, 'Which branch are you on?', cb);
    await w.advance(200);
    const o = B.said[0] || {};
    check(
      "say: an ask leaves, is taken, and the delivery gets the panel, the words, the kind, who asks, the number and this computer's own name for the other one, with its guard saying yes",
      s1.sent === 'asked' &&
        /^[0-9a-f]{16}$/.test(s1.n) &&
        B.said.length === 1 &&
        o.panelId === 'p1' &&
        o.text === 'Which branch are you on?' &&
        o.kind === 'ask' &&
        o.by.name === 'Wren' &&
        o.n === s1.n &&
        o.peerId === 'a-1' &&
        o.computer === 'Desk' &&
        o.from === 'Wren on Desk (…a-1)' &&
        o.guardThen === true,
      { s1, o: { ...o, guard: undefined, done: undefined } }
    );
    check(
      "say: the name handed over for the mark is this computer's plain name for the other one (the mark adds the id's last characters itself)",
      require('../desktop/remote-say.js').createSay({}).markOf(o.by, o.computer, o.peerId) ===
        '[from Wren · Claude Code on Desk (…00a1)] ',
      require('../desktop/remote-say.js').createSay({}).markOf(o.by, o.computer, o.peerId)
    );
    check(
      'say: the asking computer hears "sent": its command\'s first word, and the state of what it sent',
      words.join() === 'sent' &&
        A.pc('b-2').ops.find(e => e.n === s1.n)?.state === 'sent' &&
        A.pc('b-2').ops.find(e => e.n === s1.n)?.kind === 'say',
      [words, A.pc('b-2').ops]
    );
    check(
      'say: it is in the asked computer\'s list as "(agent) on (computer)" asking that agent, with the first words',
      B.svc
        .controlLog()
        .some(
          e =>
            e.op === 'say' &&
            e.name === 'Wren on Desk (…a-1)' &&
            e.agent === 'Finch' &&
            e.head === 'Which branch are you on?'
        ),
      B.svc.controlLog()[0]
    );
    check(
      'say: an agent that may not take one, an unknown agent and an unknown computer: nothing is sent',
      A.svc.say('b-2', 'p2', 'ask', by, 'Hi there', cb).sent === 'not_sent' &&
        A.svc.say('b-2', 'p9', 'ask', by, 'Hi there', cb).sent === 'not_sent' &&
        A.svc.say('c-3', 'p1', 'ask', by, 'Hi there', cb).sent === 'not_sent' &&
        B.said.length === 1
    );

    // the answer's two ways back
    const r0 = seen.wire.length;
    B.svc.reported(rep('It is on main.'), { peer: 'a-1', re: s1.n, cut: false });
    await w.advance(200);
    const sentReports = () =>
      seen.wire.slice(r0).filter(m => m.obj.t === 'report' && m.obj.id === 'p1');
    check(
      "answer: the asked computer puts the message's number only on the copy for the computer that asked",
      sentReports()
        .filter(m => m.to === 'a-1')
        .every(m => m.obj.re === s1.n) &&
        sentReports().filter(m => m.to === 'a-1').length === 1 &&
        sentReports()
          .filter(m => m.to !== 'a-1')
          .every(m => !('re' in m.obj)),
      sentReports().map(m => [m.to, m.obj.re])
    );
    check(
      "answer: the asking computer's own mark for that computer is off: the waiting command is told only that the answer is on the card, and gets no text",
      answers.length === 1 && answers[0].card === true && !('text' in answers[0]),
      answers
    );
    check(
      'answer: and it is on the card, as every finished task is',
      A.pc('b-2').agents.find(r => r.id === 'p1')?.last?.has === true &&
        A.svc.reportText('b-2', 'p1')?.text === 'It is on main.'
    );
    B.svc.reported(rep('Said again.', { at: w.t + 1 }), { peer: 'a-1', re: s1.n, cut: false });
    await w.advance(200);
    check(
      'answer: a second report with the same number changes nothing: once',
      answers.length === 1
    );

    // now with the asking side's mark: A's own full control for B, with the right named
    A.svc.setControl('b-2', true, { say: true });
    await w.advance(5000);
    await w.advance(61000);
    const s2 = A.svc.say('b-2', 'p1', 'ask', by, 'And which commit?', cb);
    await w.advance(200);
    B.svc.reported(rep('abc1234, two ahead of main.', { at: w.t }), {
      peer: 'a-1',
      re: s2.n,
      cut: false,
    });
    await w.advance(200);
    check(
      "answer: with the asking computer's own mark on, the answer's text is handed to the waiting command",
      s2.sent === 'asked' &&
        answers.length === 2 &&
        answers[1].text === 'abc1234, two ahead of main.' &&
        answers[1].more === 0 &&
        answers[1].cut === false &&
        !('card' in answers[1]),
      answers[1]
    );
    await w.advance(61000);
    const s3 = A.svc.say('b-2', 'p1', 'ask', by, 'A long one please', cb);
    await w.advance(200);
    B.svc.reported(rep('', { did: 'Stopped after ten minutes by its own computer.', at: w.t }), {
      peer: 'a-1',
      re: s3.n,
      cut: true,
    });
    await w.advance(200);
    check(
      'answer: a turn the asked computer stopped after ten minutes is told as stopped',
      answers.length === 3 && answers[2].cut === true && answers[2].text === '',
      answers[2]
    );
    B.svc.reported(rep('Nobody asked for this.', { at: w.t + 5 }), {
      peer: 'a-1',
      re: 'f'.repeat(16),
      cut: false,
    });
    await w.advance(200);
    check("answer: a number this computer never sent is nobody's answer", answers.length === 3);
    await w.advance(61000);
    const s4 = A.svc.say('b-2', 'p1', 'send', by, 'For your information', cb);
    await w.advance(200);
    B.svc.reported(rep('Noted.', { at: w.t }), { peer: 'a-1', re: s4.n, cut: false });
    await w.advance(200);
    check(
      'answer: a `send` waits for no answer: what comes back is on the card only',
      s4.sent === 'asked' && B.said.at(-1).kind === 'send' && answers.length === 3
    );
    await w.advance(61000);
    const s5 = A.svc.say('b-2', 'p1', 'ask', by, 'One I stop waiting for', cb);
    await w.advance(200);
    A.svc.sayDone(s5.n);
    B.svc.reported(rep('Too late.', { at: w.t }), { peer: 'a-1', re: s5.n, cut: false });
    await w.advance(200);
    check(
      'answer: an ask that stopped waiting gets nothing: a late answer stays on the card',
      answers.length === 3 && A.svc.reportText('b-2', 'p1')?.text === 'Too late.'
    );

    // refusals the asking agent hears, and the right ending
    await w.advance(61000);
    B.sayOk = () => false;
    words.length = 0;
    const n0 = B.said.length;
    const s6 = A.svc.say('b-2', 'p1', 'ask', by, 'Are you still there?', cb);
    await w.advance(200);
    check(
      'say: the panel stopped being a target since its row was sent: the asked computer refuses, nothing is delivered, and the command hears "refused"',
      s6.sent === 'asked' && B.said.length === n0 && words.join() === 'refused',
      words
    );
    B.sayOk = id => id === 'p1';
    await relist();
    B.svc.setControl('a-1', false);
    await w.advance(200);
    check(
      'say: full control off: the mark is gone with it, the other computer is told, and nothing is listed there',
      Object.keys(marks(B)).length === 0 &&
        B.pc('a-1').talkable === false &&
        A.svc.sayTargets().length === 0 &&
        A.pc('b-2').canSay === false,
      marks(B)
    );
    B.svc.setControl('a-1', true);
    await relist();
    check(
      'say: turned on again without the sentence, the right does not come back',
      B.pc('a-1').control === true &&
        B.pc('a-1').talkable === false &&
        Object.keys(marks(B)).length === 0 &&
        A.svc.sayTargets().length === 0
    );
    B.svc.setControl('a-1', false);
    B.svc.setControl('a-1', true, { say: true });
    await relist();
    B.svc.setDetail('a-1', false);
    await w.advance(200);
    check(
      'say: the first switch off takes full control and the mark with it',
      B.pc('a-1').control === false && Object.keys(marks(B)).length === 0,
      marks(B)
    );
    B.svc.setDetail('a-1', true);
    B.svc.setControl('a-1', true, { say: true });
    await relist();
    B.svc.forget('a-1');
    await w.advance(500);
    check('say: forgetting the computer removes the mark', Object.keys(marks(B)).length === 0);
    for (const c of [A, B, C]) c.svc.quit();
    await w.advance(120000);
    check('say: quit leaves no timer', w.timers.length === 0, w.timers.length);
  }
  console.log(
    `${passed} passed, ${failed} failed (Node ${process.versions.node}${process.versions.electron ? ', Electron ' + process.versions.electron : ''})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});
