// Technically Not · tools/change-review-test.js — Plain Node test of desktop/change-review.js (keep
// or undo each file a task changed) against a throwaway git repository in the system temp folder.
// Run: node tools/change-review-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { createChangeReview, targetsOf, parsePorcelain } = require('../desktop/change-review');

let failures = 0;

function check(name, condition, detail) {
  if (condition) console.log('ok   ' + name);
  else {
    failures++;
    console.log('FAIL ' + name + (detail !== undefined ? ' · ' + JSON.stringify(detail) : ''));
  }
}

// The same shape as git-service.js's runner: { stdout } or a rejection for an unexpected code.
function git(args, { cwd, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.autocrlf=false', ...args], { cwd }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
      if (!okCodes.includes(code)) reject(new Error(stderr || 'git failed'));
      else resolve({ stdout: String(stdout), stderr: String(stderr), code });
    });
  });
}

const write = (file, text) => fs.writeFileSync(file, text);
const read = file => fs.readFileSync(file, 'utf8');

async function main() {
  // ---------------------------------------------------------------- the edit targets per CLI
  const cwd = path.resolve('/work/project');
  check(
    'Claude Code Edit names its file',
    targetsOf('Edit', { file_path: 'src/a.js' }, cwd)[0] === path.resolve(cwd, 'src/a.js')
  );
  check(
    'OpenCode write uses filePath',
    targetsOf('write', { filePath: '/x/b.js' }, cwd).length === 1
  );
  check('a Read is no edit', targetsOf('Read', { file_path: 'a.js' }, cwd).length === 0);
  const patch =
    '*** Begin Patch\n*** Update File: one.txt\n@@\n*** Add File: two.txt\n+x\n*** End Patch';
  check(
    'Codex apply_patch names every file in its patch',
    targetsOf('apply_patch', { command: ['apply_patch', patch] }, cwd).length === 2
  );
  check(
    'Cursor Agent StrReplace with a path',
    targetsOf('StrReplace', { path: 'c.js' }, cwd)[0] === path.resolve(cwd, 'c.js')
  );
  const porcelain = parsePorcelain(' M a.txt\0?? new/\0R  to.txt\0from.txt\0');
  check(
    'git status parts: files, untracked folders, both rename paths',
    porcelain.paths.has('a.txt') &&
      porcelain.paths.has('to.txt') &&
      porcelain.paths.has('from.txt') &&
      porcelain.folders[0] === 'new/'
  );

  // ---------------------------------------------------------------- a real task in a real repo
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-review-'));
  const repo = path.join(root, 'repo');
  const store = path.join(root, 'store');
  fs.mkdirSync(repo);
  await git(['init', '-q'], { cwd: repo });
  await git(['config', 'user.email', 'test@example.com'], { cwd: repo });
  await git(['config', 'user.name', 'Test'], { cwd: repo });
  write(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  write(path.join(repo, 'b.txt'), 'bee\n');
  write(path.join(repo, 'c.txt'), 'see\n');
  write(path.join(repo, 'd.txt'), 'dee\n');
  write(path.join(repo, 'pic.bin'), Buffer.from([1, 0, 2, 0]));
  write(path.join(repo, 'same.txt'), 'same\n');
  await git(['add', '.'], { cwd: repo });
  await git(['commit', '-q', '-m', 'start'], { cwd: repo });

  // the user's own edit before the task: c.txt is not clean when the task starts
  write(path.join(repo, 'c.txt'), 'see, edited by the user\n');

  let holder = '';
  const review = createChangeReview({
    dir: store,
    git,
    folderOf: paneId => (paneId === 'p1' ? repo : ''),
    holderOf: () => holder,
  });
  await review.ready;
  await review.taskStarted('p1');

  // Claude Code edits a.txt and writes new.txt; Codex patches d.txt; Cursor Agent edits the picture
  await review.beforeEdit('p1', 'Edit', { file_path: path.join(repo, 'a.txt') });
  write(path.join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\n');
  await review.beforeEdit('p1', 'Edit', { file_path: path.join(repo, 'a.txt') });
  write(path.join(repo, 'a.txt'), 'one\nTWO\nthree\nfour\nfive\n');
  await review.beforeEdit('p1', 'Write', { file_path: path.join(repo, 'new.txt') });
  write(path.join(repo, 'new.txt'), 'brand new\n');
  await review.beforeEdit('p1', 'apply_patch', {
    command: ['apply_patch', '*** Begin Patch\n*** Update File: d.txt\n*** End Patch'],
  });
  write(path.join(repo, 'd.txt'), 'dee changed\n');
  await review.beforeEdit('p1', 'StrReplace', { path: 'pic.bin' });
  write(path.join(repo, 'pic.bin'), Buffer.from([1, 0, 3, 0, 4]));

  // an edit that was asked for and then denied: the file never changes
  await review.beforeEdit('p1', 'Edit', { file_path: path.join(repo, 'same.txt') });

  // a shell command changes b.txt (no hook) and c.txt (no hook, dirty before)
  write(path.join(repo, 'b.txt'), 'bee from a shell command\n');
  write(path.join(repo, 'c.txt'), 'see, then the agent\n');
  await review.taskEnded('p1');
  const endedAt = Date.now();

  const names = ['a.txt', 'new.txt', 'd.txt', 'b.txt', 'c.txt', 'same.txt', 'pic.bin'];
  let rows = await review.state({ paneId: 'p1', at: endedAt, ms: 60000, files: names });
  const row = name => rows.find(one => one.name === name);
  check('a.txt (hook copy) can be undone', row('a.txt').canUndo, row('a.txt'));
  check('new.txt is marked as created', row('new.txt').canUndo && row('new.txt').created);
  check('d.txt (Codex patch, relative path) can be undone', row('d.txt').canUndo, row('d.txt'));
  check(
    'b.txt (shell edit, clean before) can be undone from git',
    row('b.txt').canUndo && row('b.txt').source === 'git',
    row('b.txt')
  );
  check(
    'c.txt (dirty before, no hook) cannot, and says why',
    !row('c.txt').canUndo && /No copy/.test(row('c.txt').why),
    row('c.txt')
  );
  check('same.txt (denied edit, unchanged) has no record', !row('same.txt').id);

  // the diff view's texts
  const shown = await review.diff(row('a.txt').id);
  check(
    'diff of a.txt: before the first edit, now the last',
    shown.ok && shown.before === 'one\ntwo\nthree\n' && shown.after.endsWith('five\n'),
    shown
  );
  const fromGit = await review.diff(row('b.txt').id);
  check('diff of b.txt from git', fromGit.ok && fromGit.before === 'bee\n', fromGit);
  const binary = await review.diff(row('pic.bin').id);
  check('a binary file has no line diff, and says so', !binary.ok && /binary/i.test(binary.why));

  // the user edits d.txt after the task: Undo must not lose that
  write(path.join(repo, 'd.txt'), 'dee changed, then the user typed more\n');
  rows = await review.state({ paneId: 'p1', at: endedAt, ms: 60000, files: names });
  check(
    'd.txt edited after the task cannot be undone',
    !row('d.txt').canUndo && /Changed since/.test(row('d.txt').why),
    row('d.txt')
  );
  const refused = await review.undo(row('d.txt').id);
  check(
    'undo of d.txt is refused and the user edit stays',
    !refused.ok && read(path.join(repo, 'd.txt')).includes('the user typed more')
  );

  // another agent holds a file
  holder = 'Juno';
  const held = await review.undo(row('a.txt').id);
  check('a held file is refused with the holder named', !held.ok && /Juno/.test(held.why), held);
  holder = '';

  // the undos themselves
  const undoneA = await review.undo(row('a.txt').id);
  check(
    'undo a.txt puts back the text before the first edit',
    undoneA.ok && read(path.join(repo, 'a.txt')) === 'one\ntwo\nthree\n',
    undoneA
  );
  const undoneNew = await review.undo(row('new.txt').id);
  check('undo new.txt removes it', undoneNew.ok && !fs.existsSync(path.join(repo, 'new.txt')));
  const undoneB = await review.undo(row('b.txt').id);
  check(
    'undo b.txt restores it from git',
    undoneB.ok && read(path.join(repo, 'b.txt')) === 'bee\n',
    undoneB
  );
  const undonePic = await review.undo(row('pic.bin').id);
  check(
    'undo of a binary file restores its bytes',
    undonePic.ok && fs.readFileSync(path.join(repo, 'pic.bin')).equals(Buffer.from([1, 0, 2, 0]))
  );
  check(
    'other files were not touched',
    read(path.join(repo, 'c.txt')) === 'see, then the agent\n' &&
      read(path.join(repo, 'd.txt')).includes('the user typed more')
  );
  const twice = await review.undo(row('a.txt').id);
  check('a second undo is refused', !twice.ok && /Already undone/.test(twice.why));

  // Keep, also for a file with no copy, and both marks survive a restart
  const kept = await review.keep(row('c.txt').review);
  check('keep works without a copy', kept.ok);
  const again = createChangeReview({ dir: store, git, folderOf: () => repo });
  await again.ready;
  const later = await again.state({ paneId: 'p1', at: endedAt, ms: 60000, files: names });
  const laterRow = name => later.find(one => one.name === name);
  check('after a restart: c.txt kept', laterRow('c.txt').decision === 'kept');
  check('after a restart: a.txt undone', laterRow('a.txt').decision === 'undone');

  // a task the app closed in the middle of cannot undo
  const cut = createChangeReview({ dir: path.join(root, 'store2'), git, folderOf: () => repo });
  await cut.ready;
  await cut.taskStarted('p2');
  await cut.beforeEdit('p2', 'Edit', { file_path: path.join(repo, 'b.txt') });
  write(path.join(repo, 'b.txt'), 'bee edited in a running task\n');
  const running = await cut.state({ paneId: 'p2', folder: repo, files: ['b.txt'] });
  check(
    'a running task cannot undo yet',
    !running[0].canUndo && /still running/.test(running[0].why),
    running[0]
  );

  await throughTheHookServer(root, repo);

  // a git process can still hold the folder on Windows: the temp folder is left then
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch {}
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
}

// ---------------------------------------------------------------- the real hook server
// desktop/agent-hooks.js with a stand-in Electron (as tools/say-paths-test.js): each CLI's way in
// takes the copy before the edit is answered, so the copy is of the file before the edit.
async function throughTheHookServer(root, repo) {
  const Module = require('module');
  const userData = path.join(root, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  const load = Module._load;
  Module._load = (request, ...rest) =>
    request === 'electron'
      ? {
          app: {
            getPath: () => userData,
            getVersion: () => '0.0.0',
            isPackaged: false,
            whenReady: () => new Promise(() => {}),
            on: () => {},
            getAppPath: () => path.join(__dirname, '..'),
          },
          dialog: {},
          safeStorage: {},
        }
      : load(request, ...rest);
  const hooks = require('../desktop/agent-hooks');
  const turns = require('../desktop/agent-turns');
  Module._load = load;

  const review = createChangeReview({ dir: path.join(root, 'store3'), git, folderOf: () => repo });
  await review.ready;
  let copied = 0;
  hooks.init(() => {}, {
    beforeEdit: async (paneId, tool, input) => {
      await review.beforeEdit(paneId, tool, input);
      copied++;
    },
  });
  const post = (url, body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then(response => response.text());

  // Claude Code: its PreToolUse hook for an Edit
  write(path.join(repo, 'h1.txt'), 'hook one before\n');
  await hooks.launchOptions('pane-claude', 'Claude Code');
  await review.taskStarted('pane-claude');
  await post(hooks.endpoint('pane-claude').hook, {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_use_id: 'call-1',
    tool_input: { file_path: path.join(repo, 'h1.txt') },
  });
  check('Claude Code: the copy is made before the hook is answered', copied === 1, copied);
  write(path.join(repo, 'h1.txt'), 'hook one after\n');
  await review.taskEnded('pane-claude');

  // Codex: its preToolUse step for apply_patch, with a path relative to the folder
  write(path.join(repo, 'h2.txt'), 'hook two before\n');
  await hooks.launchOptions('pane-codex', 'Codex');
  await review.taskStarted('pane-codex');
  await post(hooks.endpoint('pane-codex').step, {
    hook_event_name: 'PreToolUse',
    tool_name: 'apply_patch',
    tool_input: { command: ['apply_patch', '*** Begin Patch\n*** Update File: h2.txt\n'] },
  });
  check('Codex: the copy is made before the step is answered', copied === 2, copied);
  write(path.join(repo, 'h2.txt'), 'hook two after\n');
  await review.taskEnded('pane-codex');

  // OpenCode: its gate before an edit
  write(path.join(repo, 'h3.txt'), 'hook three before\n');
  await hooks.launchOptions('pane-opencode', 'OpenCode');
  turns.started('pane-opencode', 'OpenCode', '', '', repo);
  await review.taskStarted('pane-opencode');
  const gate = hooks.endpoint('pane-opencode').step.replace('/step/', '/gate/');
  const answer = await post(gate, {
    event: 'tool',
    tool: 'edit',
    call: 'c1',
    input: { filePath: path.join(repo, 'h3.txt') },
  });
  check('OpenCode: the gate lets the edit go and copies first', copied === 3, [copied, answer]);
  write(path.join(repo, 'h3.txt'), 'hook three after\n');
  await review.taskEnded('pane-opencode');

  for (const [pane, file, before] of [
    ['pane-claude', 'h1.txt', 'hook one before\n'],
    ['pane-codex', 'h2.txt', 'hook two before\n'],
    ['pane-opencode', 'h3.txt', 'hook three before\n'],
  ]) {
    const [row] = await review.state({ paneId: pane, files: [file] });
    const shown = row.id ? await review.diff(row.id) : {};
    check(pane + ': ' + file + ' has its text from before the edit', shown.before === before, row);
  }
  hooks.stop?.();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
