/*
 * Technically Not tools · desktop-check/mesh-commands-check.js — `tnai ask | intervene | server |
 * test | tasks | delegate | wait | subagents | assign` end to end in plain Node: the real tnai shim
 * (desktop/agent-shim.js) talks to the real agent mesh (desktop/agent-mesh.js) with two stand-in
 * agents A and B in one project (fake terminal list, fake prompt delivery). Covers: ask answered
 * straight back (not typed into the asker's input), `tnai send NAME -` from a pipe (on Windows also
 * through tnai.cmd), dev server claim/refuse/release/list, test runs queued one at a time with
 * pass/fail summaries and exit codes, the shared task board. No CLI or agent runs. Usage: node
 * tools/desktop-check/mesh-commands-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-meshcmd-'));
const userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => userData }, dialog: {} } : load(req, ...rest);
const mesh = require('../../desktop/agent-mesh');
const notices = require('../../desktop/agent-notices');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const SHIM = path.join(__dirname, '..', '..', 'desktop', 'agent-shim.js');
const delivered = []; // { paneId, body }
let onDeliver = () => {};

const graphCalls = [];

// `tnai new`: the panel that is a sub-agent, how many such agents are open, how many were started
const newCase = { sub: '', open: 0, spawned: 0 };

// `tnai send` to the sender's own sub-agent: what the stand-in graph was told (sentByParent), and
// a closed agent the stand-in lifecycle knows (hit), which the graph takes back as a sub-agent
// (own) or leaves to the general revive.
const ownCase = { marks: [], hit: null, own: false, resent: [], revived: [] };

// panes whose task had written nothing when the interrupt key came (agent-turns stopped() says
// 'restored')
const silent = new Set();
const writes = [],
  blockers = new Map(),
  // keys written to a pane; panes on a question; panes holding the user's unsent text
  drafts = new Set();
const ended = new Set();

// a message held behind the target's unsent text: its onDone, and the notices its sender got
const heldCase = { hold: false, onDone: null, notices: [] };
const midTask = { on: false };

// panes whose task has ended (agent-turns busy() false); what a key written to a pane sets off (the
// OpenCode cases)
let onWrite = () => {};

// paneId -> the time from which agent-turns stopped() says 'reply' ('' before it: Claude Code has
// not written its stop line yet; speed audit item 5)
const stopAt = new Map();
(async () => {
  const sessions = ['pane-A', 'pane-B'].map(paneId => ({
    paneId,
    running: true,
    agent: 'Claude Code',
    mode: 'run',
    lastOutputAt: 0,
    startedAt: Date.now(),
  }));
  mesh.init(() => {}, {
    ptys: {
      list: () => sessions,
      replay: () => null,
      write: (paneId, data) => {
        writes.push({ paneId, data, at: Date.now() });
        onWrite(paneId, data);
      },
    },
    turns: {
      stopped: paneId => {
        if (stopAt.has(paneId)) return Date.now() >= stopAt.get(paneId) ? 'reply' : '';
        return silent.has(paneId) ? 'restored' : 'reply';
      },
      busy: paneId => !ended.has(paneId),
    },
    attention: {
      blocker: paneId => blockers.get(paneId) || null,
      hasDraft: paneId => drafts.has(paneId),
    },
    projects: async () => [project],
    hooks: { note() {} },
    // Stand-in agent graph: records the calls `tnai delegate | wait | subagents | assign` make (the
    // tnai_* MCP tools' calls).
    graph: {
      refuseNew: (paneId, open) =>
        open >= 2 ? 'Refused: ' + open + ' agents started with `tnai new` are already open' : '',
      call: async (paneId, tool, args) => {
        graphCalls.push({ paneId, tool, args });
        return tool === 'tnai_assign'
          ? { content: [{ type: 'text', text: 'No sub-agent "zz".' }], isError: true }
          : { content: [{ type: 'text', text: 'graph ok ' + tool }] };
      },
      sentByParent: (from, to, on = true) => {
        ownCase.marks.push(from + '>' + to + ':' + on);
        return to === 'pane-B';
      },
      resend: (from, name, text) => {
        if (!ownCase.own) return null;
        ownCase.resent.push(from + '>' + name + ':' + text);
        return Promise.resolve({ ok: true });
      },
    },
    lifecycle: {
      note() {},
      instanceOf: p => 'inst-' + p,
      lookup: () => ownCase.hit,
      revive: async instanceId => {
        ownCase.revived.push(instanceId);
        return { error: 'stand-in' };
      },
      info: p => ({ subagent: newCase.sub === p }),
      startedOpen: () => newCase.open,
      spawn: async () => {
        newCase.spawned++;
        return { error: 'stand-in' };
      },
    },
    // a held message that is dropped is told to its sender (heldCase below)
    // the mid-task route (agent-notices.js): on only for the block that checks it, so the older
    // checks keep their typed-in delivery to agents the stand-in calls busy
    get notices() {
      return midTask.on ? notices : null;
    },
    notify: async (paneId, text) => {
      heldCase.notices.push({ paneId, text });
    },
    submit: async (paneId, body, options = {}) => {
      if (heldCase.hold && options.holdIfDraft) {
        heldCase.onDone = options.holdIfDraft.onDone;
        return { ok: true, state: 'held', heldId: 'h1', reason: 'draft' };
      }
      delivered.push({ paneId, body, at: Date.now() });
      setTimeout(() => onDeliver(paneId, body), 50);
      return { ok: true, state: 'sent' };
    },
  });
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-B', name: 'Beta' },
  ]);
  const envOf = async paneId => {
    const add = await mesh.prepare(paneId, project, project);
    const env = { ...process.env };
    add(env);
    return env;
  };
  const env = { A: await envOf('pane-A'), B: await envOf('pane-B') };
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

  // ask: B answers with tnai send Alpha once the question reaches it.
  onDeliver = (paneId, body) => {
    if (paneId === 'pane-B' && /tnai ask/.test(body))
      tnai('B', 'send', 'Alpha', 'the answer is 42');
  };
  let r = await tnai('A', 'ask', 'Beta', '--wait', '20', 'what is the answer?');
  check(
    r.code === 0 && /Answer from Claude Code · Beta:\nthe answer is 42/.test(r.out),
    'ask: answer comes straight back: ' + r.out.trim()
  );
  check(
    delivered.some(
      d => d.paneId === 'pane-B' && /what is the answer\?[\s\S]*tnai send Alpha ANSWER/.test(d.body)
    ),
    'ask: question delivered with how to answer'
  );
  check(
    !delivered.some(d => d.paneId === 'pane-A'),
    "ask: answer not typed into the asker's input"
  );

  // Two asks from one agent at once: the refused one ends only its own wait.
  onDeliver = (paneId, body) => {
    if (paneId === 'pane-B' && /tnai ask/.test(body))
      setTimeout(() => tnai('B', 'send', 'Alpha', 'still 42'), 1500);
  };
  const first = tnai('A', 'ask', 'Beta', '--wait', '20', 'and now?');
  await new Promise(resolve => setTimeout(resolve, 600));
  r = await tnai('A', 'ask', 'Nobody', 'are you there?');
  check(r.code === 1 && /No agent/.test(r.out), 'ask: a second ask to an unknown name is refused');
  r = await first;
  check(
    /Answer from Claude Code · Beta:\nstill 42/.test(r.out),
    'ask: the first ask still gets its answer: ' + r.out.trim().slice(0, 60)
  );
  delivered.length = 1; // the checks below count from the first ask's delivery
  onDeliver = () => {};
  r = await tnai('A', 'send', 'Beta', 'plain message');
  check(
    r.code === 0 && delivered.filter(d => d.paneId === 'pane-B').length === 2,
    'send after ask: normal delivery'
  );
  r = await tnai('B', 'send', 'Alpha', 'unasked note');
  check(
    delivered.some(d => d.paneId === 'pane-A' && /unasked note/.test(d.body)),
    'a send with no ask waiting still goes into the input'
  );

  // send from a pipe (`tnai send NAME -`): <, > and double quotes arrive as typed. On Windows also
  // through the real tnai.cmd from PowerShell, where the same text as an argument goes through
  // cmd.exe, which takes < and > as redirection.
  const tricky = 'check <files> and "this" (a > b) & 100%';
  const tnaiIn = (who, input, ...argv) =>
    new Promise(resolve => {
      const c = execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env: env[who], windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      );
      c.stdin.end(input);
    });
  let mark = delivered.length;
  r = await tnaiIn('A', tricky + '\r\n', 'send', 'Beta', '-');
  check(
    r.code === 0 &&
      delivered
        .slice(mark)
        .some(d => d.paneId === 'pane-B' && d.body === '[from Claude Code · Alpha] ' + tricky),
    'send NAME -: the piped message arrives as typed: ' + (delivered.at(-1)?.body || r.out.trim())
  );
  mark = delivered.length;
  r = await tnaiIn('A', '', 'send', 'Beta', '-');
  check(
    r.code === 1 && /Nothing to send/.test(r.out) && delivered.length === mark,
    'send NAME - with nothing piped in is refused: ' + r.out.trim()
  );
  if (process.platform === 'win32') {
    const shims = path.join(userData, 'agent-shims'),
      pathKey = Object.keys(env.A).find(k => k.toUpperCase() === 'PATH') || 'PATH';
    const psEnv = { ...env.A, [pathKey]: shims + path.delimiter + env.A[pathKey] };
    const ps = script =>
      new Promise(resolve =>
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from("$ProgressPreference = 'SilentlyContinue'; " + script, 'utf16le').toString(
              'base64'
            ),
          ],
          { cwd: project, env: psEnv, windowsHide: true, timeout: 60000 },
          (error, stdout, stderr) =>
            resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
        )
      );
    mark = delivered.length;
    r = await ps("'" + tricky + "' | tnai send Beta -");
    check(
      r.code === 0 &&
        delivered
          .slice(mark)
          .some(d => d.paneId === 'pane-B' && d.body === '[from Claude Code · Alpha] ' + tricky),
      'PowerShell → tnai.cmd: piped message arrives as typed: ' +
        (delivered.length > mark ? delivered.at(-1).body : r.out.trim())
    );
    mark = delivered.length;
    r = await ps("tnai send Beta '" + tricky + "'");
    console.log(
      'info the same text as an argument through tnai.cmd (cmd.exe parses it): exit ' +
        r.code +
        ', delivered ' +
        (delivered.length > mark ? JSON.stringify(delivered.at(-1).body) : 'nothing') +
        (r.out.trim() ? ', said: ' + r.out.trim().split('\n')[0] : '')
    );

    // Double quotes in a message typed as an argument arrive as typed: from Windows PowerShell,
    // PowerShell 7 (both hand a .cmd 'say "hi"' as "say "hi""), cmd.exe and Git Bash.
    const lastBody = () => (delivered.length > mark ? delivered.at(-1).body : '');
    const arrives = (label, expected) =>
      check(
        r.code === 0 && lastBody() === '[from Claude Code · Alpha] ' + expected,
        label + ': ' + JSON.stringify(lastBody() || r.out.trim())
      );
    const quoteCases = [
      ['\'say "hi"\'', 'say "hi"'],
      ['\'say "hi there" now\'', 'say "hi there" now'],
      ['\'nospace"x"\'', 'nospace"x"'],
      ["'plain words'", 'plain words'],
      ['two words', 'two words'],
    ];
    const pwsh = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'PowerShell',
      '7',
      'pwsh.exe'
    );
    const shells = [['powershell.exe', 'Windows PowerShell']];
    if (fs.existsSync(pwsh)) shells.push([pwsh, 'PowerShell 7']);
    for (const [exe, shellName] of shells) {
      for (const [typed, expected] of quoteCases) {
        mark = delivered.length;
        r = await new Promise(resolve =>
          execFile(
            exe,
            [
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from('tnai send Beta ' + typed, 'utf16le').toString('base64'),
            ],
            { cwd: project, env: psEnv, windowsHide: true, timeout: 60000 },
            (error, stdout, stderr) =>
              resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
          )
        );
        arrives(shellName + ' → tnai.cmd: tnai send Beta ' + typed, expected);
      }
    }

    // cmd.exe: the user's own quotes around the whole message are taken off, quotes inside kept
    const cmdCases = [
      ['"say "hi""', 'say "hi"'],
      ['"hello world"', 'hello world'],
      ['say "hi"', 'say "hi"'],
      ['"hello" and "bye"', '"hello" and "bye"'],
    ];
    for (const [typed, expected] of cmdCases) {
      mark = delivered.length;
      r = await new Promise(resolve =>
        execFile(
          'cmd.exe',
          ['/d', '/c', 'tnai send Beta ' + typed],
          {
            cwd: project,
            env: psEnv,
            windowsHide: true,
            timeout: 60000,
            windowsVerbatimArguments: true,
          },
          (error, stdout, stderr) =>
            resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
        )
      );
      arrives('cmd.exe → tnai.cmd: tnai send Beta ' + typed, expected);
    }

    // Git Bash runs the sh stand-in `tnai`, not tnai.cmd; quotes and the pipe arrive as typed
    const gitBash = path.join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Git',
      'bin',
      'bash.exe'
    );
    if (fs.existsSync(gitBash)) {
      const bash = script =>
        new Promise(resolve =>
          execFile(
            gitBash,
            ['-c', script],
            { cwd: project, env: psEnv, windowsHide: true, timeout: 60000 },
            (error, stdout, stderr) =>
              resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
          )
        );
      mark = delivered.length;
      r = await bash('tnai send Beta \'say "hi there" now\'');
      arrives('Git Bash: tnai send Beta \'say "hi there" now\'', 'say "hi there" now');
      mark = delivered.length;
      r = await bash("printf '%s' '" + tricky + "' | tnai send Beta -");
      arrives('Git Bash: piped message arrives as typed', tricky);
    } else console.log('info Git Bash not found, its cases skipped');
  }
  r = await tnai('A', 'ask', 'Nobody', 'hello?');
  check(r.code === 1 && /No agent "Nobody"/.test(r.out), 'ask: unknown agent refused');

  // ask with nothing to ask: no question prints the usage; a blank one is refused before anything
  // is delivered; a long one names the limit a question really has.
  mark = delivered.length;
  r = await tnai('A', 'ask', 'Beta');
  check(
    r.code === 2 &&
      /tnai ask/.test(r.out) &&
      !/Unknown request/.test(r.out) &&
      delivered.length === mark,
    'ask with no question: the usage text, not "Unknown request" (exit ' + r.code + ')'
  );
  r = await tnai('A', 'ask', 'Beta', '   ');
  check(
    r.code === 1 && /Nothing to send/.test(r.out) && delivered.length === mark,
    'ask with a blank question is refused, nothing delivered: ' + r.out.trim()
  );
  r = await tnai('A', 'ask', 'Beta', 'x'.repeat(3950));
  const limit = +(/at most (\d+) characters for a question/.exec(r.out) || [])[1];
  check(
    r.code === 1 && limit > 3000 && limit < 4000 && delivered.length === mark,
    'ask with a question longer than its real limit is refused with that limit: ' + r.out.trim()
  );
  r = await tnai('A', 'ask', 'Beta', '--wait', '1', 'x'.repeat(limit || 1));
  check(
    delivered.length === mark + 1 && !/too long/i.test(r.out),
    'ask with a question exactly at the limit is delivered'
  );
  mark = graphCalls.length;
  r = await tnai('A', 'delegate', '--name', 'Helper');
  check(
    r.code === 2 &&
      /tnai delegate/.test(r.out) &&
      !/Unknown request/.test(r.out) &&
      graphCalls.length === mark,
    'delegate with no task: the usage text, nothing started (exit ' + r.code + ')'
  );

  // intervene: stops a working agent with its interrupt key, then hands it the message; a second
  // one within the gap is refused; an agent that is idle, on a question for the user, or holding
  // the user's unsent text is not interrupted and gets a normal message.
  let before = delivered.length;

  // Claude Code stopped before its first words puts the prompt back: Enter starts the task again,
  // then the message is typed in as urgent
  silent.add('pane-B');
  r = await tnai('A', 'intervene', 'Beta', 'too', 'early');
  check(
    r.code === 0 &&
      /^Beta had only just started its task/.test(r.out) &&
      writes.map(w => w.data).join('|') === '\x1b|\r' &&
      /^\[from Claude Code · Alpha · urgent\] too early\n\(Urgent information/.test(
        delivered[before]?.body || ''
      ),
    'intervene before the first words of a reply: the put-back task is started again (Enter), the message typed in as urgent: ' +
      r.out.trim().slice(0, 90)
  );
  silent.clear();
  writes.length = 0;
  mesh._test.forgetIntervened();
  before = delivered.length;
  r = await tnai('A', 'intervene', 'Beta', 'stop:', 'that', 'file', 'is', 'mine');
  let got = delivered.slice(before);
  check(
    r.code === 0 &&
      /^Interrupted Beta \(Claude Code\) and gave it your message/.test(r.out) &&
      writes.length === 1 &&
      writes[0].paneId === 'pane-B' &&
      writes[0].data === '\x1b',
    'intervene: Esc written to the working agent, then the message: ' + r.out.trim()
  );
  check(
    got.length === 1 &&
      got[0].paneId === 'pane-B' &&
      /^\[from Claude Code · Alpha · interrupted you on purpose\] stop: that file is mine\n\(Another agent stopped your task[\s\S]*not an order/.test(
        got[0].body
      ),
    'intervene: the message says who interrupted and that the agent decides'
  );
  r = await tnai('A', 'intervene', 'Beta', 'again');
  check(
    r.code === 1 &&
      /interrupted by an agent less than 2 min ago/.test(r.out) &&
      writes.length === 1 &&
      delivered.length === before + 1,
    'intervene: a second interrupt within 2 min is refused, nothing written: ' + r.out.trim()
  );
  r = await tnai('A', 'intervene', 'Alpha', 'me');
  check(r.code === 1 && /That is you/.test(r.out), 'intervene: not yourself');

  // Another agent that shares the caller's name is that other agent, not "you" (here it answers
  // with Beta's 2-minute gap, which proves who it reached).
  mesh.setNames([
    { paneId: 'pane-A', name: 'Twin' },
    { paneId: 'pane-B', name: 'Twin' },
  ]);
  r = await tnai('A', 'intervene', 'Twin', 'same name');
  check(
    !/That is you/.test(r.out) && /interrupted by an agent less than 2 min ago/.test(r.out),
    "intervene on another agent with the caller's own name reaches that agent: " +
      r.out.trim().slice(0, 110)
  );
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-B', name: 'Beta' },
  ]);
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha', idle: true },
    { paneId: 'pane-B', name: 'Beta' },
  ]);
  before = delivered.length;
  r = await tnai('B', 'intervene', 'Alpha', 'are you there');
  check(
    r.code === 0 &&
      /^Not interrupted: Alpha is not working on a task\. Sent as a normal message instead/.test(
        r.out
      ) &&
      writes.length === 1 &&
      /^\[from Claude Code · Beta\] are you there$/.test(delivered[before]?.body || ''),
    'intervene on an idle agent: no interrupt key, a normal message: ' + r.out.trim()
  );
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-B', name: 'Beta' },
  ]);
  blockers.set('pane-A', { kind: 'permission', detail: 'Bash: rm' });
  r = await tnai('B', 'intervene', 'Alpha', 'urgent');
  check(
    r.code === 0 &&
      /^Not interrupted: Alpha is waiting on a permission prompt for the user/.test(r.out) &&
      writes.length === 1,
    'intervene on an agent at a permission prompt: no interrupt key: ' + r.out.trim().slice(0, 110)
  );
  blockers.clear();
  drafts.add('pane-A');
  r = await tnai('B', 'intervene', 'Alpha', 'urgent');
  check(
    r.code === 0 &&
      /^Not interrupted: Alpha has unsent text of the user in its input/.test(r.out) &&
      writes.length === 1,
    'intervene while the user is typing in it: no interrupt key'
  );
  drafts.clear();
  r = await tnai('B', 'intervene', 'Alpha', 'now it works');
  check(
    r.code === 0 &&
      /^Interrupted Alpha/.test(r.out) &&
      writes.length === 2 &&
      writes[1].paneId === 'pane-A',
    'intervene: a different target is not rate-limited by the first'
  );

  // Speed audit item 5: Claude Code writes its stop line 710 ms after the Esc (260 ms after the
  // 450 ms settle). The message goes within 50 ms of that line, not on the next 250 ms check.
  writes.length = 0;
  mesh._test.forgetIntervened();
  before = delivered.length;
  let escAt = 0;
  onWrite = (paneId, data) => {
    if (paneId === 'pane-B' && data === '\x1b' && !escAt) {
      escAt = Date.now();
      stopAt.set('pane-B', escAt + 710);
    }
  };
  r = await tnai('A', 'intervene', 'Beta', 'late stop line');
  onWrite = () => {};
  stopAt.clear();
  const lateGap = (delivered[before]?.at || 0) - escAt;
  check(
    r.code === 0 && /^Interrupted Beta/.test(r.out) && lateGap >= 710 && lateGap < 820,
    'intervene: the message goes as soon as the stop line is seen (' + lateGap + ' ms after Esc)'
  );

  // OpenCode stops only on a second Esc soon after the first (desktop test real-opencode): two
  // presses about 300 ms apart, and the second is left out when the first ended the task or a
  // question came up in between. Claude Code above still gets exactly one.
  sessions[1].agent = 'OpenCode';
  const esc = () => writes.filter(w => w.paneId === 'pane-B' && w.data === '\x1b');
  writes.length = 0;
  mesh._test.forgetIntervened();
  before = delivered.length;
  r = await tnai('A', 'intervene', 'Beta', 'stop', 'now');
  const gapMs = esc().length === 2 ? esc()[1].at - esc()[0].at : -1;
  check(
    r.code === 0 &&
      /^Interrupted Beta \(OpenCode\)/.test(r.out) &&
      writes.length === 2 &&
      gapMs >= 250 &&
      gapMs < 1000 &&
      delivered.length === before + 1,
    'intervene on a working OpenCode: Esc twice, ' +
      gapMs +
      ' ms apart, then the message: ' +
      r.out.trim().slice(0, 80)
  );
  writes.length = 0;
  mesh._test.forgetIntervened();
  onWrite = paneId => ended.add(paneId);
  r = await tnai('A', 'intervene', 'Beta', 'stop', 'now');
  check(
    r.code === 0 && writes.length === 1,
    'OpenCode whose task ended on the first Esc: no second Esc (' + writes.length + ' written)'
  );
  ended.clear();
  writes.length = 0;
  mesh._test.forgetIntervened();
  onWrite = paneId => blockers.set(paneId, { kind: 'menu', detail: 'a question' });
  r = await tnai('A', 'intervene', 'Beta', 'stop', 'now');
  check(
    r.code === 0 && writes.length === 1,
    'OpenCode with a question on screen after the first Esc: no second Esc (' +
      writes.length +
      ' written)'
  );

  // With the link to its own server on (a stand-in server behind the real
  // desktop/opencode-link.js): its abort call, no key at all.
  {
    const link = require('../../desktop/opencode-link'),
      oc = await require('./opencode-stand-in').standIn('pw').listen();
    link.tune({ first: 20, retryMin: 40, retryMax: 200 }, ['9.9.9']);
    link.attach('pane-B', oc.port, 'pw');
    for (let i = 0; i < 100 && !link.state('pane-B')?.connected; i++)
      await new Promise(res => setTimeout(res, 30));
    oc.send('session.created', { sessionID: 'ses_b', info: { id: 'ses_b' } });
    oc.send('session.status', { sessionID: 'ses_b', status: { type: 'busy' } });
    for (let i = 0; i < 100 && link.state('pane-B').sessionId !== 'ses_b'; i++)
      await new Promise(res => setTimeout(res, 30));
    blockers.clear();
    onWrite = () => {};
    writes.length = 0;
    mesh._test.forgetIntervened();
    before = delivered.length;
    r = await tnai('A', 'intervene', 'Beta', 'stop', 'now');
    check(
      r.code === 0 &&
        /^Interrupted Beta \(OpenCode\)/.test(r.out) &&
        esc().length === 0 &&
        oc.calls.length === 1 &&
        oc.calls[0].url === '/session/ses_b/abort' &&
        delivered.length === before + 1,
      'OpenCode with its server link on: stopped by its abort call, no Esc written, then the message (' +
        oc.calls.map(c => c.url).join(',') +
        ', ' +
        esc().length +
        ' Esc)'
    );
    writes.length = 0;
    mesh._test.forgetIntervened();
    oc.failPosts = true;
    r = await tnai('A', 'intervene', 'Beta', 'stop', 'now');
    check(
      r.code === 0 && esc().length === 2,
      'OpenCode whose abort call was refused: the two Esc presses as before (' +
        esc().length +
        ' written)'
    );
    link.close('pane-B');
    await oc.close();
  }
  blockers.clear();
  onWrite = () => {};
  sessions[1].agent = 'Claude Code';
  writes.length = 0;
  mesh._test.forgetIntervened();

  // server
  const srv = http.createServer((q, s) => s.end('ok'));
  await new Promise(res => srv.listen(0, '127.0.0.1', res));
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  r = await tnai('A', 'server');
  check(/No dev servers recorded/.test(r.out), 'server list: empty');
  r = await tnai('A', 'server', 'claim', url);
  check(r.code === 0 && /You own the dev server at/.test(r.out), 'server claim');
  r = await tnai('B', 'server', 'claim', url);
  check(
    r.code === 1 && /Alpha owns the dev server .* reuse it/.test(r.out),
    'server claim by another agent refused while it runs'
  );
  r = await tnai('B', 'server', 'list');
  check(
    /Dev servers in this project \(1\):\n.*127\.0\.0\.1.*Alpha.*running/.test(r.out),
    'server list shows owner and running: ' + r.out.trim()
  );
  r = await tnai('A', 'server', 'release');
  check(r.code === 0 && /Released/.test(r.out), 'server release');
  r = await tnai('B', 'server', 'claim', url);
  check(r.code === 0, 'server claim after release');
  srv.close();

  // test: two runs at once take turns; pass and fail summaries carry the exit code.
  const slow = 'node -e "setTimeout(()=>{},1500)"';
  const t0 = Date.now(),
    [p1, p2] = await Promise.all([
      tnai('A', 'test', slow),
      new Promise(res => setTimeout(() => tnai('B', 'test', slow).then(res), 300)),
    ]);
  check(
    p1.code === 0 && /^Tests passed · node -e/.test(p1.out),
    'test: pass summary: ' + p1.out.trim()
  );
  check(
    p2.code === 0 && /waited \d+ s for Alpha/.test(p2.out) && Date.now() - t0 >= 2900,
    'test: second run waited for the first: ' + p2.out.trim()
  );
  r = await tnai(
    'A',
    'test',
    "node -e \"console.log('line one');console.error('boom failed');process.exit(3)\""
  );
  check(
    r.code === 3 && /Tests FAILED \(exit 3\)[\s\S]*boom failed/.test(r.out),
    'test: failure summary with last lines and exit code'
  );
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } })
  );
  r = await tnai('A', 'test');
  check(
    r.code === 0 && /Tests passed · npm test/.test(r.out),
    'test: finds npm test from package.json'
  );
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
  );
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  r = await tnai('A', 'test');
  check(
    r.code === 2 && /no test setup found/.test(r.out),
    'test: npm default script is not a test setup'
  );

  // tasks
  r = await tnai('A', 'tasks');
  check(/No open tasks/.test(r.out), 'tasks: empty board');
  r = await tnai('A', 'tasks', 'add', 'Write', 'the', 'login', 'page');
  check(/Added #1/.test(r.out), 'tasks add');
  r = await tnai('A', 'tasks', 'take', '1');
  check(r.code === 0 && /You have #1/.test(r.out), 'tasks take');
  r = await tnai('B', 'tasks', 'take', '#1');
  check(
    r.code === 1 && /taken by Alpha/.test(r.out),
    'tasks take refused while another live agent has it'
  );
  r = await tnai('B', 'tasks', 'list');
  check(/#1 {2}\[Alpha\] Write the login page/.test(r.out), 'tasks list shows the owner');
  r = await tnai('A', 'tasks', 'done', '1');
  check(
    /Done #1/.test(r.out) && /No open tasks/.test((await tnai('B', 'tasks')).out),
    'tasks done leaves the board'
  );

  // delegate / wait / subagents / assign from the shell: the same graph calls as the MCP tools.
  r = await tnai(
    'A',
    'delegate',
    '--agent',
    'Codex',
    '--name',
    'bug reporter',
    'Collect the open bugs',
    'into a list'
  );
  let g = graphCalls.at(-1);
  check(
    r.code === 0 &&
      /graph ok tnai_delegate/.test(r.out) &&
      g?.paneId === 'pane-A' &&
      g.tool === 'tnai_delegate' &&
      g.args.task === 'Collect the open bugs into a list' &&
      g.args.agent === 'Codex' &&
      g.args.name === 'bug reporter' &&
      !!g.args.purpose &&
      !!g.args.why,
    'tnai delegate calls tnai_delegate with the task and flags: ' + JSON.stringify(g?.args)
  );
  r = await tnai('A', 'wait', '40640592', '30');
  g = graphCalls.at(-1);
  check(
    r.code === 0 &&
      g?.tool === 'tnai_wait' &&
      JSON.stringify(g.args) === JSON.stringify({ ids: ['40640592'], timeout_seconds: 30 }),
    'tnai wait: an all-digit id stays an id, 1-3 digits are seconds: ' + JSON.stringify(g?.args)
  );
  r = await tnai('A', 'subagents');
  check(
    r.code === 0 && graphCalls.at(-1)?.tool === 'tnai_subagents',
    'tnai subagents lists through tnai_subagents'
  );
  r = await tnai('A', 'assign', 'zz', 'fix it');
  check(
    r.code === 1 &&
      /No sub-agent "zz"/.test(r.out) &&
      JSON.stringify(graphCalls.at(-1)?.args) === JSON.stringify({ id: 'zz', task: 'fix it' }),
    'tnai assign: a graph refusal prints and exits 1'
  );

  // new: held to the sub-agent limits. No CLI starts here:
  // the stand-in lifecycle only counts.
  r = await tnai('A', 'new', 'claude', 'look at the build');
  check(
    r.code === 0 && /a new Claude Code agent/.test(r.out) && newCase.spawned === 1,
    'tnai new from a lead under the limit starts one: ' + r.out.trim().slice(0, 60)
  );
  newCase.sub = 'pane-B';
  r = await tnai('B', 'new', 'claude', 'look at the build');
  check(
    r.code === 1 && /sub-agent does not start new agents/.test(r.out) && newCase.spawned === 1,
    "tnai new from a sub-agent's panel is refused, nothing starts: " + r.out.trim().slice(0, 70)
  );
  newCase.open = 2;
  r = await tnai('A', 'new', 'claude', 'look at the build');
  check(
    r.code === 1 &&
      /2 agents started with `tnai new` are already open/.test(r.out) &&
      newCase.spawned === 1,
    'tnai new at the limit is refused, nothing starts: ' + r.out.trim().slice(0, 70)
  );

  // `tnai send` to the sender's own sub-agent is more work from its parent: the task graph is told
  // before the message is typed in (its result then returns to the sender), a `tnai ask` question
  // is not (its answer already comes straight back), and a closed sub-agent comes back through
  // the graph instead of as a panel that reports to nobody.
  onDeliver = () => {};
  ownCase.marks.length = 0;
  const typedBefore = delivered.length;
  r = await tnai('A', 'send', 'Beta', 'please shorten the three posts');
  check(
    r.code === 0 &&
      ownCase.marks.join() === 'pane-A>pane-B:true' &&
      delivered.length === typedBefore + 1,
    'send: the task graph hears of a message before it is typed in: ' + ownCase.marks.join()
  );
  ownCase.marks.length = 0;
  onDeliver = (paneId, body) => {
    if (paneId === 'pane-B' && /tnai ask/.test(body)) tnai('B', 'send', 'Alpha', 'yes');
  };
  await tnai('A', 'ask', 'Beta', '--wait', '20', 'are the posts done?');
  check(
    !ownCase.marks.some(m => m.startsWith('pane-A>')),
    'ask: a question is not marked as work whose result returns as a report'
  );
  onDeliver = () => {};
  ownCase.hit = { instanceId: 'inst-gamma', name: 'Gamma', agent: 'Claude Code', state: 'hidden' };
  ownCase.own = true;
  r = await tnai('A', 'send', 'Gamma', 'add a fourth post');
  check(
    r.code === 0 &&
      /It was closed/.test(r.out) &&
      ownCase.resent.join() === 'pane-A>Gamma:add a fourth post' &&
      !ownCase.revived.length,
    'send: a closed sub-agent of the sender comes back through the task graph: ' +
      ownCase.resent.join()
  );
  ownCase.own = false;
  r = await tnai('A', 'send', 'Gamma', 'and a fifth');
  await new Promise(resolve => setTimeout(resolve, 100));
  check(
    r.code === 0 && ownCase.resent.length === 1 && ownCase.revived.join() === 'inst-gamma',
    'send: any other closed agent is revived the general way'
  );
  ownCase.hit = null;

  // A message held behind the target's unsent text and dropped after the 10 minutes: the sender
  // hears in one line that it was not delivered and why (learned 2026-10-14: it was told "queued"
  // and never more).
  // Beta has finished its task here: a working Claude Code agent reads messages mid-task instead
  // (the block after this one).
  ended.add('pane-B');
  heldCase.hold = true;
  r = await tnai('A', 'send', 'Beta', 'the held one');
  heldCase.hold = false;
  check(r.code === 0 && typeof heldCase.onDone === 'function', 'send: held behind unsent text');
  heldCase.onDone({
    ok: false,
    state: 'expired',
    error: 'The unsent text in its input was not sent or cleared within 10 min.',
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  check(
    heldCase.notices.length === 1 &&
      heldCase.notices[0].paneId === 'pane-A' &&
      /message to Beta was not delivered: The unsent text .* within 10 min\./.test(
        heldCase.notices[0].text
      ),
    'send: a dropped held message is told to its sender: ' + (heldCase.notices[0]?.text || 'none')
  );
  heldCase.onDone({ ok: true, state: 'sent' });
  check(heldCase.notices.length === 1, 'send: a held message delivered later tells nobody');

  // A WORKING Claude Code agent reads another agent's message after its next tool call, not
  // interrupted and not left in its queue until the task ends.
  ended.delete('pane-B');
  midTask.on = true;
  let typed = delivered.length;
  r = await tnai('A', 'send', 'Beta', 'no need for the pencil block any more');
  check(
    r.code === 0 &&
      /after its next step/.test(r.out) &&
      delivered.length === typed &&
      notices._test.size('pane-B') === 1,
    'send to a working Claude Code agent: held for its next step, nothing typed: ' + r.out.trim()
  );
  const taken = notices.take('pane-B');
  check(
    /^Message from another agent/.test(taken) &&
      taken.includes('[from Claude Code · Alpha] no need for the pencil block any more') &&
      notices._test.size('pane-B') === 0,
    'send mid-task: its next tool call gets it as an agent message: ' + taken.split('\n').at(-1)
  );

  // --later: the sender said it can wait, so it goes the old way (typed in, the CLI queues it).
  typed = delivered.length;
  r = await tnai('A', 'send', '--later', 'Beta', 'whenever you are done');
  check(
    r.code === 0 &&
      delivered.length === typed + 1 &&
      delivered.at(-1).body === '[from Claude Code · Alpha] whenever you are done' &&
      notices._test.size('pane-B') === 0,
    'send --later: typed in as before, not held for the next step'
  );

  // No tool call before the task ends: the message is typed in then, never lost.
  typed = delivered.length;
  await tnai('A', 'send', 'Beta', 'one more thing');
  ended.add('pane-B');
  notices.flush('pane-B');
  await new Promise(resolve => setTimeout(resolve, 50));
  check(
    delivered.length === typed + 1 && /one more thing/.test(delivered.at(-1).body),
    'send mid-task: still held when the task ends, it is typed in'
  );

  // close by name: an agent whose own name has a comma closes as one name; a word that is no
  // agent's whole name is still split at commas (`tnai close A,B`)
  midTask.on = false;
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-B', name: 'Fix, Test', idle: true },
  ]);
  r = await tnai('A', 'close', '--user', 'Fix, Test');
  check(
    r.code === 0 && /Fix, Test \(idle/.test(r.out) && !/No agent/.test(r.out),
    'close: a name with a comma closes by name: ' + r.out.trim().slice(0, 90)
  );
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-B', name: 'Beta', idle: true },
  ]);
  r = await tnai('A', 'close', '--user', 'Zed,Beta');
  check(
    r.code === 0 && /Beta \(idle/.test(r.out) && /No agent "Zed"/.test(r.out),
    'close: comma-separated names are still split: ' + r.out.trim().slice(0, 90)
  );

  mesh.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
