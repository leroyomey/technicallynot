/*
 * Technically Not tools · desktop-check/orchestration-lows-check.js — two Lows of the agent
 * orchestration audit (docs/notes/audit-2026-10-07/app-3-agent-orchestration.md) in
 * desktop/agent-hooks.js, plain Node, no CLI and no model call, with stand-in file locks:
 * #12, an edit's file lock is taken before the permission answer, so a failed or denied edit gives
 * back the lock its own call took (Claude Code: PostToolUseFailure, now subscribed for the edit
 * tools; OpenCode: its gate call and failed tool-end), while a successful edit keeps it;
 * #9, "Allow for session" on a command whose first argument is a flag covers exactly that command,
 * not the whole program. Usage: node tools/desktop-check/orchestration-lows-check.js. Exit code 1
 * when a check fails.
 */
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-orch-lows-'));
fs.mkdirSync(path.join(tmp, 'user'));
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? {
        app: {
          getPath: () => path.join(tmp, 'user'),
          whenReady: () => new Promise(() => {}),
          on: () => {},
        },
        shell: { openPath: async () => '' },
        dialog: {},
      }
    : load(req, ...rest);
delete process.env.SHELL;
const hooks = require('../../desktop/agent-hooks');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Stand-in file locks: what the hooks asked for, and who holds what.
const held = new Map(); // file -> paneId
const calls = [];
const fakeLocks = {
  acquire: (proj, file, owner) => {
    calls.push('acquire ' + file);
    const had = held.has(file);
    held.set(file, owner.paneId);
    return { ok: true, taken: !had };
  },
  release: (proj, files, paneId) => {
    const released = files.filter(f => held.get(f) === paneId);
    for (const f of released) held.delete(f);
    calls.push('release ' + files.join(','));
    return { released };
  },
  editDone: (proj, file) => calls.push('editDone ' + file),
  shellStart() {},
  shellEnd() {},
  shellStop() {},
  diskChanges() {},
};
hooks.init(() => {}, {
  locks: fakeLocks,
  owner: async paneId => ({ project, paneId, name: 'Nova', provider: 'Claude Code' }),
  root: () => project,
});

// POST a JSON body; resolves { status, body }, or { status: 0 } when no answer comes in `ms`.
const post = (url, body, ms = 3000) =>
  new Promise(resolve => {
    const timer = setTimeout(() => resolve({ status: 0, body: '' }), ms);
    const r = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      res => {
        let text = '';
        res.on('data', d => (text += d));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode, body: text });
        });
      }
    );
    r.on('error', () => resolve({ status: -1, body: '' }));
    r.end(JSON.stringify(body));
  });

(async () => {
  const pane = 'terminal-claude-1';
  await hooks.launchOptions(pane, 'Claude Code');
  const hookUrl = hooks.endpoint(pane)?.hook || '';
  check(/\/hook\/[0-9a-f]{32}$/.test(hookUrl), 'the Claude Code panel has a hook address');

  // the settings Claude Code reads subscribe PostToolUseFailure for the edit tools
  const settingsDir = path.join(tmp, 'user', 'agent-hooks');
  const settingsFile = fs.readdirSync(settingsDir).find(f => f.endsWith('.settings.json'));
  const settings = JSON.parse(fs.readFileSync(path.join(settingsDir, settingsFile), 'utf8'));
  const failMatcher = settings.hooks.PostToolUseFailure?.[0]?.matcher || '';
  check(
    /\bEdit\b/.test(failMatcher) && /\bWrite\b/.test(failMatcher),
    'PostToolUseFailure is subscribed for the edit tools: ' + failMatcher
  );

  // #12: a failed edit gives back the lock its own call took
  const edit = (event, id, file) => ({
    hook_event_name: event,
    tool_name: 'Edit',
    tool_use_id: id,
    tool_input: { file_path: path.join(project, file) },
  });
  await post(hookUrl, edit('PreToolUse', 'e1', 'a.js'));
  check(held.get(path.join(project, 'a.js')) === pane, 'an edit takes its file lock first');
  await post(hookUrl, edit('PostToolUseFailure', 'e1', 'a.js'));
  check(!held.has(path.join(project, 'a.js')), 'a failed edit gives the lock it took back');

  // a successful edit keeps it
  await post(hookUrl, edit('PreToolUse', 'e2', 'b.js'));
  await post(hookUrl, edit('PostToolUse', 'e2', 'b.js'));
  check(
    held.get(path.join(project, 'b.js')) === pane &&
      calls.includes('editDone ' + path.join(project, 'b.js')),
    'a successful edit keeps its lock'
  );

  // a failed edit of a file the panel already held (and edited) keeps it too
  await post(hookUrl, edit('PreToolUse', 'e3', 'b.js'));
  await post(hookUrl, edit('PostToolUseFailure', 'e3', 'b.js'));
  check(
    held.get(path.join(project, 'b.js')) === pane,
    'a failed edit of a file held before keeps the lock'
  );

  // #9: "Allow for session" on `rm -f tmp.txt` covers that command only (the key used to be
  // `rm`, which `rm -rf build` matches too)
  const shell = command => ({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command },
  });
  const firstAsk = post(hookUrl, shell('rm -f tmp.txt'), 5000);
  await wait(200);
  const card = hooks.pendingPermissions().find(p => p.paneId === pane);
  check(
    card && card.sessionScope === 'rm -f tmp.txt',
    'the session scope of a command that starts with a flag is that command: ' +
      JSON.stringify(card && card.sessionScope)
  );
  hooks.answerPermission(card.id, 'session');
  await firstAsk;
  const wider = await post(hookUrl, shell('rm -rf build'), 800);
  check(
    wider.status === 0 && hooks.pendingPermissions().some(p => p.paneId === pane),
    '…so `rm -rf build` still asks'
  );
  for (const p of hooks.pendingPermissions()) hooks.answerPermission(p.id, 'deny');
  const same = await post(hookUrl, shell('rm -f tmp.txt'), 2000);
  check(same.status === 200 && /allow/.test(same.body), '…and the same command again is allowed');

  // OpenCode (parity): its gate takes the lock with the call id; a failed tool-end gives it back
  const oc = 'terminal-opencode-1';
  require('../../desktop/agent-turns').started(oc, 'OpenCode', '', '', project);
  await hooks.launchOptions(oc, 'OpenCode');
  const ep = hooks.endpoint(oc) || {};
  const gate = (ep.step || '').replace('/step/', '/gate/');
  const file = path.join(project, 'c.js');
  await post(gate, { tool: 'edit', input: { filePath: file }, call: 'c1' });
  check(held.get(file) === oc, 'OpenCode: an edit takes its file lock at the gate');
  await post(ep.step, { event: 'tool', tool: 'edit', input: { filePath: file }, call: 'c1' });
  await post(ep.step, { event: 'tool-end', tool: 'edit', call: 'c1', failed: true });
  await wait(50);
  check(!held.has(file), 'OpenCode: a failed edit gives the lock it took back');

  console.log(
    ok ? '\nAll orchestration Low checks passed.' : '\nSome orchestration Low checks FAILED.'
  );
  hooks.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
  process.exit(ok ? 0 : 1);
})();
