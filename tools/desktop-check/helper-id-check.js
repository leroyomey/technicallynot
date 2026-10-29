/*
 * Technically Not tools · desktop-check/helper-id-check.js — the id `tnai_delegate` gives back
 * reaches that helper. The real agent graph (desktop/agent-graph.js), the real lifecycle
 * (desktop/agent-lifecycle.js) and the real mesh (desktop/agent-mesh.js, through the real tnai
 * shim) run in plain Node with a stand-in window and terminal list. A lead delegates one helper;
 * the id in the answer is then used with `tnai send`, `tnai read`, `tnai ask`, `tnai close` and
 * `tnai_assign`, while the helper's panel runs and after it closed (send revives it). Learned
 * 2026-10-28: the graph names a helper by its graph id and `tnai agents` by its agent id, and the
 * mesh knew only the second. No CLI or agent runs. Usage: node
 * tools/desktop-check/helper-id-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

// The real modules read and write their files under a throwaway user-data folder.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-helperid-'));
const userData = path.join(tmp, 'userData');
const project = path.join(tmp, 'project');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(project, { recursive: true });
const load = Module._load;
Module._load = (request, ...rest) =>
  request === 'electron'
    ? { app: { getPath: () => userData }, dialog: {} }
    : load(request, ...rest);
const graph = require('../../desktop/agent-graph');
const lifecycle = require('../../desktop/agent-lifecycle');
const mesh = require('../../desktop/agent-mesh');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SHIM = path.join(__dirname, '..', '..', 'desktop', 'agent-shim.js');

// The terminal list every module sees: the lead's panel, then one per helper panel opened.
const sessions = [];
const addSession = paneId =>
  sessions.push({
    paneId,
    running: true,
    pid: 1,
    agent: 'Claude Code',
    mode: 'run',
    lastOutputAt: 0,
    startedAt: Date.now(),
  });
const delivered = [];
const spawns = [];
const windowEvents = [];
const graphClosed = [];
const names = [{ paneId: 'pane-L', name: 'Lead' }];
let paneCount = 0;

// Prompt delivery stand-in (prompt-submit.js): records what was typed into which panel.
const submit = async (paneId, body) => {
  if (!sessions.some(s => s.paneId === paneId && s.running)) return { ok: false, state: 'gone' };
  delivered.push({ paneId, body });
  return { ok: true, state: 'sent' };
};
const ptys = {
  list: () => sessions,
  replay: () => null,
  write: () => {},
  stop: () => {},
};

// The window stand-in: opens a panel for each spawn request the graph sends, then starts its CLI
// there in the order main.js does (graph.attach, graph.started, lifecycle.started).
const openHelperPanel = async payload => {
  spawns.push(payload);
  const paneId = 'pane-S' + ++paneCount;
  const sessionId = payload.resumeId || 'sess-' + paneCount;
  addSession(paneId);
  await mesh.prepare(paneId, project, project);
  names.push({ paneId, name: 'Vega' });
  mesh.setNames(names);
  if (!graph.attach(payload.nodeId, paneId, 'Vega')) return;
  graph.started(paneId, sessionId);
  lifecycle.started({
    paneId,
    agent: 'Claude Code',
    name: 'Vega',
    subagentOf: payload.nodeId,
    root: project,
    cwd: project,
    sessionId,
    resumeId: payload.resumeId || '',
  });

  // its CLI is ready (agent-hooks.js): the graph hands it the task
  graph.onEvent(paneId, { kind: 'ready' });
};

(async () => {
  lifecycle.init(() => {}, { canResume: () => true, root: () => project });
  graph.init(
    (channel, payload) => {
      if (channel === 'graph:spawn') setTimeout(() => openHelperPanel(payload), 5);
      if (channel === 'graph:close') graphClosed.push(payload.paneId);
    },
    { ptys, submit }
  );
  mesh.init((channel, payload) => windowEvents.push([channel, payload]), {
    ptys,
    turns: { stopped: () => 'reply', busy: () => false },
    attention: { blocker: () => null, hasDraft: () => false },
    projects: async () => [project],
    hooks: { note() {} },
    graph,
    lifecycle,
    submit,
  });

  // The lead: a root of the graph and a panel the mesh knows.
  addSession('pane-L');
  graph.setSettings({ maxDepth: 1, maxActivePerAgent: 2, maxActiveTotal: 3, graceSeconds: 10 });
  graph.rootStarted('pane-L', 'custom-1', 'Lead');
  const add = await mesh.prepare('pane-L', project, project);
  const env = { ...process.env };
  add(env);
  mesh.setNames(names);
  const tnai = (...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env, windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );
  const text = r => r.content.map(c => c.text).join('\n');

  // 1. Delegate: the answer names the helper and an id.
  const answer = text(
    await graph.call('pane-L', 'tnai_delegate', {
      purpose: 'Settings tests',
      task: 'Write the settings page tests in tools/settings-check.js and run them once, then report what failed.',
      why: 'Runs in parallel while I refactor the page itself.',
    })
  );
  const given = (/id ([0-9a-f]{8})\)/.exec(answer) || [])[1] || '';
  check(!!given, 'tnai_delegate answers with an id: ' + answer.split('\n')[0]);
  const agentId = lifecycle.instanceOf('pane-S1').slice(0, 8);
  check(
    !!agentId && agentId !== given,
    'the helper has a second id, the one `tnai agents` lists (' + agentId + ' vs ' + given + ')'
  );

  // 2. Every command that names an agent takes the given id while the helper's panel runs.
  let r = await tnai('send', given, 'hello from the lead');
  check(
    r.code === 0 &&
      delivered.some(d => d.paneId === 'pane-S1' && /hello from the lead/.test(d.body)),
    'tnai send <given id> reaches the helper: ' + r.out.trim()
  );
  r = await tnai('read', given);
  check(r.code === 0 && !/No agent/.test(r.out), 'tnai read <given id> finds it: ' + r.out.trim());
  r = await tnai('ask', '--wait', '1', given, 'which file did you start with?');
  check(
    delivered.some(d => d.paneId === 'pane-S1' && /which file did you start with/.test(d.body)) &&
      !/No agent/.test(r.out),
    'tnai ask <given id> reaches the helper: ' + r.out.trim().split('\n')[0]
  );
  r = await tnai('close', given);
  check(
    !new RegExp('No agent "' + given).test(r.out),
    'tnai close <given id> knows which agent it is: ' + r.out.trim().split('\n')[0]
  );
  check(
    !/No sub-agent/.test(text(await graph.call('pane-L', 'tnai_assign', { id: given, task: 'x' }))),
    'tnai_assign <given id> knows it (it did before too)'
  );

  // The agent id from `tnai agents` keeps working as well.
  r = await tnai('send', agentId, 'second hello');
  check(
    r.code === 0 && delivered.some(d => d.paneId === 'pane-S1' && /second hello/.test(d.body)),
    'tnai send <agents id> still reaches it'
  );

  // 3. The helper finished and its panel closed: send by the given id revives it.
  // Its report reaches the idle lead, and the graph closes the panel after the grace period
  // (10 s, the shortest it allows), as in the app.
  graph.onEvent('pane-S1', { kind: 'stop', text: 'Done: wrote the tests.' });

  // the lead's own turn (busy since its tool calls) ends: the report is typed into it
  graph.onEvent('pane-L', { kind: 'stop', text: '' });
  for (let i = 0; i < 30 && !graphClosed.includes('pane-S1'); i++) await wait(500);
  const helperNode = graph.state().nodes.find(n => !n.root);
  check(
    graphClosed.includes('pane-S1'),
    'the finished helper is closed by the graph (' +
      helperNode?.status +
      ', closes at ' +
      helperNode?.closesAt +
      ', now ' +
      Date.now() +
      ')'
  );
  sessions.splice(
    sessions.findIndex(s => s.paneId === 'pane-S1'),
    1
  );
  lifecycle.exited('pane-S1');
  lifecycle.closed('pane-S1');
  graph.removed('pane-S1');
  names.splice(
    names.findIndex(n => n.paneId === 'pane-S1'),
    1
  );
  mesh.setNames(names);
  const before = spawns.length;
  r = await tnai('send', given, 'one more thing');
  await wait(200);
  check(
    r.code === 0 && /reviving/.test(r.out) && spawns.length > before,
    'tnai send <given id> to the closed helper revives it: ' + r.out.trim()
  );
  check(
    spawns.at(-1)?.resumeId === 'sess-1',
    'the revived panel resumes the same conversation (' + (spawns.at(-1)?.resumeId || 'none') + ')'
  );

  mesh.stop();
  lifecycle.flushSaves?.();
  graph.flushSaves?.();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
