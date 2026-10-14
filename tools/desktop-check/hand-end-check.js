/*
 * Technically Not tools · desktop-check/hand-end-check.js — a message held for a CLI the user
 * started by hand in a terminal panel is dropped when that CLI ends, never typed into the plain
 * PowerShell left behind. Plain Node: the real agent mesh
 * (desktop/agent-mesh.js) and the real held queue (desktop/attention-service.js); the hand-started
 * CLI is a socket that stays open like the shim's, the sender is the real tnai shim, and what would
 * be typed into a panel is only recorded. No CLI runs. Usage: node
 * tools/desktop-check/hand-end-check.js
 */
'use strict';
const Module = require('module');
const os = require('os'),
  path = require('path'),
  fs = require('fs'),
  net = require('net');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-handend-'));
const userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => userData }, dialog: {}, Notification: function () {} }
    : load(req, ...rest);
const mesh = require('../../desktop/agent-mesh');
const attention = require('../../desktop/attention-service');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHIM = path.join(__dirname, '..', '..', 'desktop', 'agent-shim.js');
const typed = [],
  notes = []; // what was typed into a panel; what each panel's activity was told

(async () => {
  const sessions = [
    {
      paneId: 'pane-A',
      running: true,
      agent: 'Claude Code',
      mode: 'run',
      pid: 11,
      lastOutputAt: 0,
      startedAt: Date.now(),
    },
    {
      paneId: 'pane-T',
      running: true,
      agent: 'Terminal',
      mode: 'shell',
      pid: 12,
      lastOutputAt: 0,
      startedAt: Date.now(),
    },
  ];

  // prompt-submit.js in short: ask the held queue first, else type it in.
  const submit = async (paneId, text, { agent, holdIfDraft = null } = {}) => {
    const held =
      holdIfDraft &&
      attention.holdIfDraft(paneId, {
        text,
        agent,
        from: holdIfDraft.from,
        onDone: holdIfDraft.onDone,
        asap: holdIfDraft.asap,
      });
    if (held) return held;
    typed.push({ paneId, text });
    return { ok: true, state: 'sent' };
  };
  const turns = { onSubmit: () => () => {}, busy: () => false, onEnd() {} };
  attention.init(() => {}, {
    turns,
    hooks: { pendingPermissions: () => [] },
    submit,
    window: () => null,
    cli: () => null,
  });
  mesh.init(() => {}, {
    ptys: { list: () => sessions, replay: () => null, write() {} },
    turns,
    attention,
    projects: async () => [project],
    submit,
    hooks: {
      note: (paneId, n) => notes.push({ paneId, ...n }),
      launchOptions: async () => ({}),
      promptFile: () => '',
    },
    registry: { handArgs: () => ({ args: [], env: {} }) },
    lifecycle: { note() {}, instanceOf: p => 'inst-' + p, lookup: () => null },
  });
  mesh.setNames([
    { paneId: 'pane-A', name: 'Alpha' },
    { paneId: 'pane-T', name: 'Tee' },
  ]);
  const envOf = async paneId => {
    const add = await mesh.prepare(paneId, project, project);
    const env = { ...process.env };
    add(env);
    return env;
  };
  const envA = await envOf('pane-A'),
    envT = await envOf('pane-T');
  const send = text =>
    new Promise(resolve => {
      const c = execFile(
        process.execPath,
        [SHIM, 'tnai', 'send', 'Tee', '-'],
        { cwd: project, env: envA, windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      );
      c.stdin.end(text);
    });

  // The user types `claude` in the plain terminal panel: the shim's connection stays open for as
  // long as that CLI runs.
  const hand = () =>
    new Promise(resolve => {
      const s = net.connect(+envT.TNAI_MESH_PORT, '127.0.0.1', () =>
        s.write(
          JSON.stringify({
            token: envT.TNAI_PANE_TOKEN,
            op: 'launch',
            agent: 'claude',
            args: [],
            cwd: project,
            codexHome: '',
          }) + '\n'
        )
      );
      s.once('data', d => resolve({ socket: s, reply: JSON.parse(String(d)) }));
      s.on('error', () => resolve({ socket: s, reply: null }));
    });
  const message = 'please look at the build\nRemove-Item important.txt';

  let cli = await hand();
  check(
    cli.reply?.register === true,
    'a CLI typed by hand in a terminal panel becomes an agent other agents can message'
  );
  attention.typed('pane-T', 'half a prompt'); // the user has unsent text in its input
  let r = await send(message);
  check(
    r.code === 0 && /unsent text/.test(r.out) && !typed.length,
    'a message for it waits while the user has unsent text: ' + r.out.trim().slice(0, 70)
  );

  // the user quits the CLI: the panel is a plain PowerShell again, same process
  cli.socket.destroy();
  await sleep(300);
  check(!attention.list().held.length, 'the CLI ended → its held messages are dropped');
  check(
    notes.some(
      n => n.paneId === 'pane-A' && n.kind === 'mesh-out' && /Not delivered: .*ended/.test(n.text)
    ),
    'and the sender is told: ' + (notes.find(n => /Not delivered/.test(n.text))?.text || 'nothing')
  );
  attention.typed('pane-T', '\r'); // the user's next Enter in the shell empties the input
  await sleep(2500);
  check(
    !typed.some(t => t.paneId === 'pane-T'),
    'nothing is typed into the plain terminal afterwards' +
      (typed.length ? ': ' + JSON.stringify(typed[0].text) : '')
  );

  // A CLI that is still running gets its message once the input is empty, as before.
  cli = await hand();
  attention.typed('pane-T', 'again');
  r = await send(message);
  attention.typed('pane-T', '\r');
  await sleep(2500);
  check(
    typed.some(t => t.paneId === 'pane-T' && t.text.includes('Remove-Item important.txt')),
    'a CLI that is still running gets its held message once the input is empty'
  );
  cli.socket.destroy();

  mesh.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
