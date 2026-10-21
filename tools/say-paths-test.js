// Test of the app's own paths that agents messaging agents leans on: node tools/say-paths-test.js
// (plain Node; also run it in Electron's Node; about 40 s, it waits on the real delivery's own
// timings).
// The rules themselves are tools/remote-say-test.js. Here the REAL
// modules:
// 1. desktop/prompt-submit.js with desktop/attention-service.js: every prompt's write is noted as a
// person's or not, a message from another computer's agent is written with its mark and fixed line
// and reported exactly as written, and the bytes of an ordinary prompt are what they always were.
// 2. desktop/agent-hooks.js, its real hook server: the remembered "allow for the session" list is
// not asked in the chain of turns such a message started, and the mode a hook names is handed on.
// 3. desktop/agent-mesh.js, its real command socket: in such a chain only the reading commands
// work; NAME@COMPUTER leaves the computer only when no agent here has that name and a paired
// computer takes messages; `tnai agents` prints the other computer.
//   4. desktop/agent-graph.js: no delegation tool in such a chain.
// Stand-ins: the panels, the task record, the remote service's answers. No CLI or agent runs, no
// window opens.
'use strict';
const Module = require('module'),
  os = require('os'),
  path = require('path'),
  fs = require('fs'),
  net = require('net');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-say-')),
  userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
const load = Module._load,
  ROOT = path.join(__dirname, '..');
Module._load = (req, ...rest) =>
  req === 'electron'
    ? {
        app: {
          getPath: () => userData,
          getVersion: () => '0.0.0',
          isPackaged: false,
          whenReady: () => new Promise(() => {}),
          on: () => {},
          getAppPath: () => ROOT,
        },
        dialog: {},
        safeStorage: {},
      }
    : load(req, ...rest);
const submitter = require('../desktop/prompt-submit'),
  attention = require('../desktop/attention-service'),
  hooks = require('../desktop/agent-hooks'),
  mesh = require('../desktop/agent-mesh'),
  graph = require('../desktop/agent-graph');
Module._load = load;
const { TAIL } = require('../desktop/remote-say.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ch = String.fromCharCode,
  ESC = ch(0x1b),
  DOTS = ch(0x2026),
  PASTE = ESC + '[200~',
  UNPASTE = ESC + '[201~';
let finished = false;
process.on('exit', () => {
  if (!finished) {
    console.log('ERROR the run ended before its last check (' + passed + ' passed until then)');
    process.exitCode = 1;
  }
});

(async () => {
  // ---- 1. the delivery ----
  const writes = [],
    panes = new Map(),
    waiters = new Map(),
    endFns = [],
    notes = [];
  const pane = (id, agent) =>
    panes.set(id, { agent, pid: 100 + panes.size, startedAt: 1, enters: 0, busy: false });
  const take = id => {
    const p = panes.get(id);
    p.enters = 0;
    p.busy = true;
    for (const fn of [...(waiters.get(id) || [])]) fn();
  };
  const finish = id => {
    panes.get(id).busy = false;
    endFns.forEach(fn => fn(id));
  };
  const ptys = {
    list: () =>
      [...panes].map(([paneId, p]) => ({
        paneId,
        agent: p.agent,
        pid: p.pid,
        startedAt: p.startedAt,
        running: true,
        mode: 'run',
        lastOutputAt: p.out || 0,
      })),
    write(paneId, data) {
      writes.push([paneId, data]);
      submitter.wrote(paneId, data);
      const p = panes.get(paneId);
      if (p)
        setTimeout(() => {
          p.out = Date.now();
        }, 5);
      if (data === '\r' && p && ++p.enters === 1) take(paneId);
    },
    replay: () => null,
  };
  const turns = {
    onSubmit(paneId, fn) {
      if (!waiters.has(paneId)) waiters.set(paneId, new Set());
      waiters.get(paneId).add(fn);
      return () => waiters.get(paneId).delete(fn);
    },
    canConfirm: () => true,
    busy: paneId => !!panes.get(paneId)?.busy,
    onEnd(fn) {
      endFns.push(fn);
    },
    stopped: () => 'reply',
  };
  attention.init(() => {}, {
    turns,
    hooks: { pendingPermissions: () => [] },
    submit: (...a) => submitter.submit(...a),
    window: () => null,
    cli: id => panes.get(id)?.agent || null,
  });
  submitter.init({
    ptys,
    turns,
    hooks: { pendingPermissions: () => [] },
    attention,
    noted: (paneId, who) => {
      notes.push([paneId, who]);
    },
  });
  const of = id => writes.filter(([p]) => p === id).map(([, d]) => d),
    notesOf = id => notes.filter(([p]) => p === id).map(([, w]) => w);
  {
    pane('d1', 'Claude Code');
    pane('d2', 'Claude Code');
    const r1 = await submitter.submit('d1', 'Fix the tests', { person: true });
    finish('d1');
    const r2 = await submitter.submit('d2', 'Fix the tests');
    finish('d2');
    check(
      "delivery: a prompt this computer's user sent from the window is noted as a person's, once, at its write",
      r1.ok === true && notesOf('d1').join() === 'person',
      [r1, notesOf('d1')]
    );
    check(
      "delivery: any other prompt this path writes (an agent's message, an app notice) is noted as not a person's",
      r2.ok === true && notesOf('d2').join() === 'agent',
      [r2, notesOf('d2')]
    );
    check(
      'delivery: the bytes are the same either way: one bracketed paste of the words, then Enter',
      JSON.stringify(of('d1')) === JSON.stringify(of('d2')) &&
        of('d1')[0] === PASTE + 'Fix the tests' + UNPASTE &&
        of('d1')[1] === '\r',
      of('d1')
    );
    let threw = false;
    submitter.init({
      ptys,
      turns,
      hooks: { pendingPermissions: () => [] },
      attention,
      noted: () => {
        throw new Error('boom');
      },
    });
    pane('d3', 'Claude Code');
    let r3 = null;
    try {
      r3 = await submitter.submit('d3', 'Still goes in');
    } catch {
      threw = true;
    }
    finish('d3');
    check(
      'delivery: a listener that throws does not stop a prompt',
      !threw && r3 && r3.ok === true && of('d3')[0] === PASTE + 'Still goes in' + UNPASTE
    );
    submitter.init({ ptys, turns, hooks: { pendingPermissions: () => [] }, attention });
    pane('d4', 'Claude Code');
    const r4 = await submitter.submit('d4', 'No listener');
    finish('d4');
    check(
      'delivery: with no listener handed in (several computers never used) a prompt goes in as always',
      r4.ok === true && of('d4').length === 2
    );
    submitter.init({
      ptys,
      turns,
      hooks: { pendingPermissions: () => [] },
      attention,
      noted: (paneId, who) => {
        notes.push([paneId, who]);
      },
    });

    // held for the user while their agent works: still theirs when it goes out
    pane('d5', 'Claude Code');
    panes.get('d5').busy = true;
    const held = await submitter.submit('d5', 'Next task', {
      person: true,
      holdIfBlocked: true,
      holdIfBusy: true,
    });
    const before = notesOf('d5').length;
    finish('d5');
    await sleep(2500);
    if (panes.get('d5').busy) finish('d5');
    check(
      "delivery: a prompt held for this computer's user while their agent works is noted as a person's when it goes out later",
      held.state === 'held' &&
        before === 0 &&
        notesOf('d5').join() === 'person' &&
        of('d5')[0] === PASTE + 'Next task' + UNPASTE,
      [held, notesOf('d5'), of('d5')]
    );
  }
  {
    // from another computer: a person's prompt, and an agent's message
    const mark = '[from Wren · Claude Code on Desk (' + DOTS + 'a1b2)] ',
      words = 'What is on your branch?',
      wrote = [];
    const remote = (o = {}) => ({
      from: 'Wren on Desk',
      key: 'k' + Math.random(),
      mark,
      tail: TAIL,
      say: true,
      onWrite: out => wrote.push(out),
      guard: () => true,
      onDone: () => {},
      ...o,
    });
    pane('r1', 'Claude Code');
    const r1 = await submitter.submit('r1', words, { remote: remote() });
    finish('r1');
    check(
      'message: written as one paste of the mark, the words as sent and the fixed line, then Enter',
      r1.ok === true &&
        of('r1')[0] === PASTE + mark + words + TAIL + UNPASTE &&
        of('r1')[1] === '\r',
      of('r1')
    );
    check(
      "message: the rules are told exactly what was written, once, and that an agent's text went in",
      wrote.length === 1 && wrote[0] === mark + words + TAIL && notesOf('r1').join() === 'agent',
      [wrote, notesOf('r1')]
    );
    pane('r2', 'Claude Code');
    const n0 = wrote.length;
    const r2 = await submitter.submit('r2', 'Fix it', {
      remote: {
        from: 'Desk',
        key: 'p1',
        mark: '[Sent from Desk] ',
        guard: () => true,
        onDone: () => {},
        onWrite: out => wrote.push(out),
      },
    });
    finish('r2');
    check(
      "message: a prompt a PERSON sent from a paired computer is noted as a person's, and nothing is reported as a message",
      r2.ok === true &&
        notesOf('r2').join() === 'person' &&
        wrote.length === n0 &&
        of('r2')[0] === PASTE + '[Sent from Desk] Fix it' + UNPASTE,
      [notesOf('r2'), of('r2')]
    );
    pane('r3', 'Claude Code');
    const r3 = await submitter.submit('r3', '!whoami', { remote: remote() });
    check(
      'message: words that start with a sign are refused at the write too: nothing written, nothing noted, nothing reported',
      r3.ok === false && of('r3').length === 0 && notesOf('r3').length === 0 && wrote.length === n0
    );
    pane('r4', 'Claude Code');
    const r4 = await submitter.submit('r4', words, { remote: remote({ guard: () => false }) });
    check(
      'message: a guard that says no: nothing written, nothing noted, nothing reported',
      r4.ok === false && of('r4').length === 0 && notesOf('r4').length === 0 && wrote.length === n0
    );
    pane('r5', 'Claude Code');
    panes.get('r5').busy = true;
    const done = [];
    const r5 = await submitter.submit('r5', words, {
      remote: remote({ onDone: w => done.push(w) }),
    });
    const heldNotes = notesOf('r5').length,
      heldWrote = wrote.length;
    finish('r5');
    await sleep(3000);
    if (panes.get('r5').busy) finish('r5');
    await sleep(300);
    check(
      'message: held while the agent works: nothing is noted or reported until it is really written, and then exactly once',
      r5.state === 'queued' &&
        heldNotes === 0 &&
        heldWrote === n0 &&
        wrote.length === n0 + 1 &&
        wrote.at(-1) === mark + words + TAIL &&
        notesOf('r5').join() === 'agent' &&
        of('r5')[0] === PASTE + mark + words + TAIL + UNPASTE,
      [r5, notesOf('r5'), wrote.length - n0, of('r5'), done]
    );
    pane('r6', 'Terminal');
    const r6 = await submitter.submit('r6', words, { remote: remote() });
    check('message: never into a Terminal panel', r6.ok === false && of('r6').length === 0);
  }

  // ---- 2. the hooks' server: the remembered list ----
  {
    const chainOf = new Set(),
      modes = [];
    let broken = false;
    hooks.init(() => {}, {
      sayTurn: id => {
        if (broken) throw new Error('boom');
        return chainOf.has(id);
      },
      modeSeen: (id, mode) => {
        modes.push([id, mode]);
      },
    });
    await hooks.launchOptions('pane-h', 'Claude Code');
    const url = hooks.endpoint('pane-h').hook;
    const ask = (command, more = {}) => {
      const c = new AbortController();
      return {
        c,
        p: fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: c.signal,
          body: JSON.stringify({
            hook_event_name: 'PermissionRequest',
            tool_name: 'Bash',
            tool_input: { command },
            permission_mode: 'manual',
            ...more,
          }),
        }).then(
          r => r.text(),
          () => 'gone'
        ),
      };
    };
    const pendingNow = async () => {
      await sleep(150);
      return hooks.pendingPermissions().filter(p => p.paneId === 'pane-h');
    };
    const allow = t => /"behavior":"allow"/.test(t),
      deny = t => /"behavior":"deny"/.test(t);
    const a = ask('npm test'),
      p1 = await pendingNow();
    check('permissions: a first request is shown', p1.length === 1, p1.length);
    hooks.answerPermission(p1[0].id, 'session');
    const t1 = await a.p;
    check('permissions: "allow for the session" allows it', allow(t1), t1);
    const b = ask('npm test'),
      p2 = await pendingNow(),
      t2 = await b.p;
    check(
      'permissions: the same command again, in an ordinary turn: allowed from the remembered list, nothing shown (as before)',
      p2.length === 0 && allow(t2),
      [p2.length, t2]
    );
    chainOf.add('pane-h');
    const c = ask('npm test'),
      p3 = await pendingNow();
    check(
      "permissions: in the chain of turns a message from another computer's agent started, the remembered list is not asked: the request is shown",
      p3.length === 1,
      p3.length
    );
    hooks.answerPermission(p3[0].id, 'deny');
    const t3 = await c.p;
    check("permissions: and the user's no is the answer", deny(t3), t3);
    const d = ask('npm test'),
      p4 = await pendingNow();
    hooks.answerPermission(p4[0] && p4[0].id, 'once');
    const t4 = await d.p;
    check(
      'permissions: shown every time in such a chain, also right after the last one',
      p4.length === 1 && allow(t4)
    );
    chainOf.delete('pane-h');
    broken = true;
    const e = ask('npm test'),
      p5 = await pendingNow();
    hooks.answerPermission(p5[0] && p5[0].id, 'deny');
    await e.p;
    check(
      'permissions: a rule that cannot be asked counts as such a chain: shown',
      p5.length === 1,
      p5.length
    );
    broken = false;
    const f = ask('npm test'),
      p6 = await pendingNow(),
      t6 = await f.p;
    check(
      'permissions: back in an ordinary turn the remembered list answers again',
      p6.length === 0 && allow(t6)
    );
    check(
      'mode: the permission mode a hook names is handed to the rules with its panel',
      modes.length >= 6 && modes.every(m => m[0] === 'pane-h' && m[1] === 'manual'),
      modes.slice(0, 2)
    );
    const m0 = modes.length;
    const g = ask('npm test', { agent_id: 'sub-1', permission_mode: 'bypassPermissions' });
    await sleep(150);
    for (const p of hooks.pendingPermissions()) hooks.answerPermission(p.id, 'deny');
    await g.p;
    check(
      "mode: a sub-agent's hook does not speak for the panel",
      modes.length === m0,
      modes.slice(m0)
    );
    hooks.stop();
  }

  // ---- 3. the mesh's commands ----
  const names = new Map([
      ['pane-A', 'Alpha'],
      ['pane-B', 'Be@ta'],
    ]),
    chain = new Set(),
    said = [],
    closed = {},
    submitted = [];
  let takers = [];
  const sessions = ['pane-A', 'pane-B'].map(paneId => ({
    paneId,
    running: true,
    agent: 'Claude Code',
    mode: 'run',
    lastOutputAt: 0,
    startedAt: Date.now(),
  }));
  mesh.init(() => {}, {
    ptys: { list: () => sessions, replay: () => null, write: () => {} },
    turns: { stopped: () => 'reply', busy: () => false },
    attention: { blocker: () => null, hasDraft: () => false },
    projects: async () => [project],
    hooks: { note() {}, launchOptions: async () => ({}) },
    lifecycle: {
      note() {},
      instanceOf: p => 'inst-' + p,
      lookup: name => closed[name] || null,
      info: () => ({ subagent: false }),
      startedOpen: () => 0,
      closedIn: () => [],
      successorOf: () => null,
    },
    submit: async (paneId, body) => {
      submitted.push([paneId, body]);
      return { ok: true, state: 'sent' };
    },
    sayTurn: paneId => chain.has(paneId),
    sayList: () => takers,
    remoteSay: o => {
      said.push(o);
      return o.kind === 'ask'
        ? { ok: true, text: 'Answer from Finch on Laptop:\nmain' }
        : { ok: true, to: 'Finch on Laptop' };
    },
  });
  mesh.setNames([...names].map(([paneId, name]) => ({ paneId, name })));
  const envOf = async paneId => {
    const add = await mesh.prepare(paneId, project, project);
    const env = { ...process.env };
    add(env);
    return env;
  };
  const env = { A: await envOf('pane-A'), B: await envOf('pane-B') };
  const raw = (who, message) =>
    new Promise(resolve => {
      const s = net.connect(Number(env[who].TNAI_MESH_PORT), '127.0.0.1');
      let buf = '';
      const t = setTimeout(() => {
        s.destroy();
        resolve({ ok: false, error: 'no answer' });
      }, 15000);
      s.setEncoding('utf8');
      s.on('connect', () =>
        s.write(
          JSON.stringify({ token: env[who].TNAI_PANE_TOKEN, cwd: project, ...message }) + '\n'
        )
      );
      s.on('data', c => {
        buf += c;
        const end = buf.indexOf('\n');
        if (end < 0) return;
        clearTimeout(t);
        let r;
        try {
          r = JSON.parse(buf.slice(0, end));
        } catch {
          r = { ok: false, error: 'unreadable' };
        }
        s.end();
        resolve(r);
      });
      s.on('error', () => {
        clearTimeout(t);
        resolve({ ok: false, error: 'socket' });
      });
    });
  const SHIM = path.join(ROOT, 'desktop', 'agent-shim.js');
  const tnai = (who, ...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env: env[who], windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );
  const GATE = /This task came from an agent on another computer/;
  {
    // NAME@COMPUTER, and what `tnai agents` prints
    let r = await tnai('A', 'agents');
    check(
      'agents: with no paired computer that takes messages, nothing about another computer is printed',
      r.code === 0 && /Agents in /.test(r.out) && !/another of the user's computers/.test(r.out),
      r.out
    );
    r = await tnai('A', 'send', 'finch@laptop', 'hello', 'there');
    check(
      'send NAME@COMPUTER with no computer that takes messages: the answer it always gave, and nothing leaves',
      r.code !== 0 && /No agent "finch@laptop" in this project/.test(r.out) && said.length === 0,
      r.out
    );
    takers = [
      {
        pc: 'dev-9f3c',
        computer: 'Laptop',
        addr: 'laptop',
        alt: 'pc-9f3c',
        rows: [
          {
            id: 'p1',
            name: 'Finch',
            addr: 'finch@laptop',
            cli: 'Claude Code',
            status: 'working',
            ask: true,
          },
          {
            id: 'p2',
            name: 'Moss',
            addr: 'moss@laptop',
            cli: 'OpenCode',
            status: 'idle',
            ask: false,
          },
        ],
      },
    ];
    r = await tnai('A', 'agents');
    check(
      "agents: a paired computer that takes messages is printed after this computer's agents, each agent as it is addressed, with no task",
      r.code === 0 &&
        /On Laptop, another of the user's computers, in this project \(2\)/.test(r.out) &&
        /finch@laptop {2}· {2}Claude Code {2}· {2}working {2}· {2}can be asked/.test(r.out) &&
        /moss@laptop {2}· {2}OpenCode {2}· {2}idle {2}· {2}cannot be messaged from here/.test(
          r.out
        ) &&
        r.out.indexOf('Alpha') < r.out.indexOf('On Laptop'),
      r.out
    );
    r = await tnai('A', 'send', 'finch@laptop', 'hello', 'there');
    check(
      "send NAME@COMPUTER: handed to the app's path for another computer with who asks, and its answer is printed",
      r.code === 0 &&
        /Sent to Finch on Laptop\./.test(r.out) &&
        said.length === 1 &&
        said[0].to === 'finch@laptop' &&
        said[0].kind === 'send' &&
        said[0].text === 'hello there' &&
        said[0].by.name === 'Alpha' &&
        said[0].by.cli === 'Claude Code' &&
        said[0].paneId === 'pane-A',
      [r.out, said[0] && { ...said[0], socket: undefined }]
    );
    r = await tnai('A', 'ask', 'finch@laptop', 'which', 'branch?');
    check(
      'ask NAME@COMPUTER: the same path, as an ask, and the answer is printed',
      r.code === 0 &&
        /Answer from Finch on Laptop:\s+main/.test(r.out) &&
        said.length === 2 &&
        said[1].kind === 'ask' &&
        said[1].text === 'which branch?',
      r.out
    );
    r = await tnai('A', 'send', 'Be@ta', 'hi');
    check(
      'a running agent of this computer whose own name holds an @ is still messaged here, as before',
      r.code === 0 &&
        said.length === 2 &&
        submitted.some(([p, b]) => p === 'pane-B' && /\[from Claude Code · Alpha\] hi/.test(b)),
      [r.out, submitted]
    );
    closed['old@name'] = {
      name: 'old@name',
      agent: 'Claude Code',
      state: 'cleared',
      instanceId: 'inst-old',
    };
    r = await tnai('A', 'send', 'old@name', 'hi');
    check(
      'a closed agent of this computer whose name holds an @ gets the answer it always got, and nothing leaves (review 20, 1.6)',
      r.code !== 0 &&
        /No agent "old@name" in this project that can still be reached/.test(r.out) &&
        said.length === 2,
      r.out
    );
    r = await tnai('A', 'send', 'Nobody', 'hi');
    check(
      'a bare name never leaves the computer',
      r.code !== 0 && /No agent "Nobody" in this project/.test(r.out) && said.length === 2,
      r.out
    );
  }
  {
    // in the chain: an allow list
    chain.add('pane-A');
    const refusedOps = [
      { op: 'send', to: 'Be@ta', text: 'hi' },
      { op: 'send', to: 'finch@laptop', text: 'hi' },
      { op: 'ask', to: 'Be@ta', text: 'q' },
      { op: 'ask', to: 'finch@laptop', text: 'q' },
      { op: 'new', agent: 'claude', text: 'do it' },
      { op: 'intervene', to: 'Be@ta', text: 'stop' },
      { op: 'close', to: 'Be@ta' },
      { op: 'close', self: true },
      { op: 'rename', name: 'Zed' },
      { op: 'graph', action: 'delegate', args: { task: 'x' } },
      { op: 'graph', action: 'assign', args: {} },
      { op: 'skill', args: ['list'] },
      { op: 'server', args: [] },
      { op: 'test', args: [] },
      { op: 'tasks', args: ['add', 'something'] },
      { op: 'tasks', args: ['take', '1'] },
      { op: 'context', args: ['note', 'x'] },
      { op: 'preview' },
      { op: 'show', file: 'a.txt' },
      { op: 'shot' },
      { op: 'lock', files: ['a.txt'] },
      { op: 'unlock', files: ['a.txt'] },
      { op: 'team', names: ['Be@ta'] },
      { op: 'clear-closed' },
      { op: 'something-new' },
    ];
    const bad = [];
    for (const m of refusedOps) {
      const r = await raw('A', m);
      if (!(r.ok === false && GATE.test(r.error || '')))
        bad.push([m.op, m.action || (m.args || [])[0] || '', r]);
    }
    check(
      'chain: every command that acts is refused with the one sentence (' +
        refusedOps.length +
        ' tried, delegation and a message to another computer among them)',
      bad.length === 0,
      bad.slice(0, 3)
    );
    check(
      'chain: nothing was delivered or handed on by any of them',
      said.length === 2 && submitted.filter(([p]) => p === 'pane-B').length === 1
    );
    const okOps = [{ op: 'agents' }, { op: 'locks' }, { op: 'tasks' }, { op: 'tasks', args: [] }];
    const no = [];
    for (const m of okOps) {
      const r = await raw('A', m);
      if (GATE.test(r.error || '')) no.push([m.op, r]);
    }
    check(
      'chain: the reading commands are not refused by it (agents, locks, plain tasks)',
      no.length === 0,
      no
    );
    const ctx = await raw('A', { op: 'context' }),
      rd = await raw('A', { op: 'read', to: 'Be@ta' });
    check(
      'chain: plain context and read are let through to their own code',
      !GATE.test(ctx.error || '') && !GATE.test(rd.error || ''),
      [ctx.error, rd.error]
    );
    const l = await raw('A', { op: 'launch', agent: 'claude', args: [] });
    check(
      "chain: a CLI started from that agent's shell is answered before anything else: it runs unregistered, as from any agent's shell (review 20, 1.5)",
      l.ok === true && l.register === false,
      l
    );

    // Review 21, Low 7: the panel above runs Claude Code, which `launch` refuses by itself. A plain
    // Terminal panel is one `launch` would register; in the chain it must not.
    sessions[0].agent = 'Terminal';
    const lt = await raw('A', { op: 'launch', agent: 'claude', args: [] });
    sessions[0].agent = 'Claude Code';
    check(
      'chain: a CLI started in a plain Terminal panel that is in the chain also runs unregistered (review 21, Low 7)',
      lt.ok === true && lt.register === false,
      lt
    );
    const other = await raw('B', { op: 'send', to: 'Alpha', text: 'hi' });
    check(
      "chain: it is that panel's only: another agent of this computer sends as always",
      other.ok === true,
      other
    );
    const viaShim = await tnai('A', 'send', 'Be@ta', 'hi');
    check(
      'chain: through the real command the agent reads the sentence',
      viaShim.code !== 0 && GATE.test(viaShim.out),
      viaShim.out
    );
    chain.delete('pane-A');
    const after = await raw('A', { op: 'send', to: 'Be@ta', text: 'back' });
    check('chain: once it is over the commands work again', after.ok === true, after);
  }

  // ---- 4. the delegation tools ----
  {
    let inChain = false,
      broken = false;
    graph.init(() => {}, {
      ptys: { list: () => [] },
      submit: async () => ({ ok: true }),
      sayTurn: () => {
        if (broken) throw new Error('boom');
        return inChain;
      },
    });
    const text = r => (r && r.content && r.content[0] && r.content[0].text) || '';
    const plain = await graph.call('pane-A', 'tnai_delegate', { task: 'x' });
    check(
      'delegation: in an ordinary turn the tool answers what it always answered',
      plain.isError === true && /not a custom agent/.test(text(plain)),
      text(plain)
    );
    inChain = true;
    const tools = ['tnai_delegate', 'tnai_assign', 'tnai_wait', 'tnai_subagents'],
      res = [];
    for (const t of tools) res.push(await graph.call('pane-A', t, { task: 'x', id: 'y' }));
    check(
      'delegation: in such a chain every tool is refused, before anything is looked up',
      res.every(r => r.isError === true && /came from an agent on another computer/.test(text(r))),
      res.map(text)
    );
    inChain = false;
    broken = true;
    const b = await graph.call('pane-A', 'tnai_delegate', { task: 'x' });
    check(
      'delegation: a rule that cannot be asked counts as such a chain',
      b.isError === true && /another computer/.test(text(b)),
      text(b)
    );
  }

  mesh.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* temp */
  }
  finished = true;
  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});
