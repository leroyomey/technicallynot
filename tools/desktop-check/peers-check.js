/*
 * Technically Not tools · desktop-check/peers-check.js — Live team awareness
 * (desktop/agent-peers.js) in plain Node with the real agent-lifecycle.js, agent-context.js and
 * file-locks.js and a fake mesh roster: a new prompt gets the live team with crossings marked (only
 * when it changed), the crossed agent is queued one notice for its next tool call, a newly started
 * crossing task is found by the mid-task scan once, a lead's own sub-agent never counts, unrelated
 * work gets nothing, and `tnai context`'s board lists the team for any CLI. No CLI runs. Usage:
 * node tools/desktop-check/peers-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-peers-'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => tmp }, shell: { openPath: async () => '' } }
    : load(req, ...rest);
const lifecycle = require('../../desktop/agent-lifecycle');
const context = require('../../desktop/agent-context');
const locks = require('../../desktop/file-locks');
const peers = require('../../desktop/agent-peers');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const root = path.join(tmp, 'proj');
fs.mkdirSync(root, { recursive: true });
lifecycle.init(() => {}, { canResume: () => true, root: () => root });
context.init(() => {}, { root: () => root, ptys: { replay: () => ({ buffer: '' }) } });
locks.init(() => {}, { notify: async () => {}, family: () => false });

// The roster `tnai agents` would show (agent-mesh.js rows): name, id, provider, pane, status,
// quietMin, task.
const roster = new Map();
const row = (pane, name, provider, task, extra = {}) =>
  roster.set(pane, {
    name,
    id: 'id-' + pane,
    provider,
    pane,
    status: 'working',
    quietMin: null,
    task,
    ...extra,
  });
peers.init({
  roster: async (project, paneId) =>
    [...roster.values()].map(r => ({ ...r, you: r.pane === paneId })),
  locks,
  lifecycle,
  context,
  family: (a, b) => [a, b].sort().join() === ['A', 'S'].sort().join(),
});

const start = (paneId, name, agent = 'Claude Code') =>
  lifecycle.started({ paneId, agent, name, root, cwd: root, sessionId: 'sess-' + paneId });
const prompt = (paneId, text) => {
  context.hook(paneId, { hook_event_name: 'UserPromptSubmit', prompt: text });
  return peers.forPrompt(paneId, text);
};

(async () => {
  start('A', 'Nova');
  start('B', 'Kai');
  start('C', 'Lee', 'Codex');
  start('S', 'Sub');
  row('A', 'Nova', 'Claude Code', 'Add validation to the login form');
  row('C', 'Lee', 'Codex', 'Write the pricing page copy');
  row('S', 'Sub', 'Claude Code', 'Add validation to the login form error messages');
  context.hook('A', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Add validation to the login form in src/login-form.js',
  });
  locks.acquire(root, path.join(root, 'src/login-form.js'), {
    paneId: 'A',
    name: 'Nova',
    provider: 'Claude Code',
  });

  // B starts work that crosses A's (same file + shared words).
  row('B', 'Kai', 'Claude Code', 'Fix login form validation');
  const t1 = await prompt('B', 'Fix the login form validation message in src/login-form.js');
  check(
    /live team/.test(t1) && /Nova/.test(t1) && /Lee/.test(t1),
    'new prompt lists the other live agents'
  );
  check(
    /Nova[^\n]*CROSSES YOUR TASK \(same file src\/login-form\.js/.test(t1),
    'crossing with the same file is marked'
  );
  check(
    /Nova[^\n]*editing: src\/login-form\.js/.test(t1),
    'the files an agent holds show as editing'
  );
  check(!/Lee[^\n]*CROSSES/.test(t1), 'unrelated work is not marked');

  const a1 = await peers.forTool('A');
  check(
    /crossing/.test(a1) && /Kai[^\n]*just started/.test(a1),
    'the crossed agent gets one notice at its next tool call'
  );
  check(!/Kai/.test(await peers.forTool('A')), 'the notice is not repeated');
  check(!(await peers.forTool('C')), 'an unrelated agent gets nothing');

  const same = await peers.forPrompt('C', 'Write the pricing page copy');
  const again = await peers.forPrompt('C', 'Write the pricing page copy');
  check(/live team/.test(same) && again === '', 'an unchanged team is not sent again');

  // A lead and its own sub-agent never cross.
  check(
    !/Sub[^\n]*CROSSES/.test(await prompt('A', 'Add validation to the login form error messages')),
    'a lead is not told its own sub-agent crosses'
  );

  // Mid-task scan: a task started later (any CLI, no prompt hook) that crosses C's own.
  peers._test.reset();
  context.hook('C', {
    hook_event_name: 'UserPromptSubmit',
    prompt: 'Write the pricing page copy for plans and billing',
  });
  row('D', 'Ivy', 'OpenCode', 'Update pricing page plans billing table');
  start('D', 'Ivy', 'OpenCode');
  const c1 = await peers.forTool('C');
  check(/Ivy[^\n]*CROSSES/.test(c1), 'the mid-task scan finds a newly started crossing task');

  // Every CLI: `tnai context` board.
  const b = await peers.board('C', root);
  check(
    /Live team/.test(b) && /Ivy/.test(b) && /Nova/.test(b) && !/Lee \(/.test(b),
    'tnai context board lists the others, not the caller'
  );

  // Quiet agents drop out.
  row('E', 'Old', 'Codex', 'Something long done', { status: 'waiting', quietMin: 300 });
  check(!/Old/.test(await peers.board('C', root)), 'agents quiet for long are left out');

  check(
    peers._test.crossing('rename the button', 'write docs for billing', root) === '',
    'crossing needs real overlap'
  );
  console.log(ok ? 'PASS peers-check' : 'FAIL peers-check');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
