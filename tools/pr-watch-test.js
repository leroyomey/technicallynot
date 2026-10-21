// Technically Not tools · pr-watch-test.js — Plain Node checks for watching and merging a
// thread's pull request (desktop/pr-watch.js), "Open in VS Code / Cursor / File Explorer"
// (desktop/open-in-editor.js) and the menu's rules for them (src/scripts/154-thread-actions.js).
// gh is never run: a stand-in answers, and nothing is merged.
//
// Run: node tools/pr-watch-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const watchKit = require(path.join(root, 'desktop', 'pr-watch.js'));
const editorKit = require(path.join(root, 'desktop', 'open-in-editor.js'));
const actions = require(path.join(root, 'src', 'scripts', '154-thread-actions.js'));

let failed = 0;

function check(ok, label) {
  if (!ok) failed++;
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
}

// One look as gh prints it.
function lookText({ state = 'OPEN', draft = false, checks = [], comments = 0, head = 'abc1234' }) {
  return JSON.stringify({
    number: 42,
    title: 'Dark mode toggle',
    url: 'https://github.com/owner/repo/pull/42',
    state,
    isDraft: draft,
    statusCheckRollup: checks,
    comments: Array.from({ length: comments }, () => ({ body: 'hi' })),
    reviews: [{ body: '' }],
    headRefOid: head,
  });
}
const run = (name, conclusion) => ({
  __typename: 'CheckRun',
  name,
  status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
  conclusion: conclusion || '',
});

async function main() {
  // ---------------------------------------------------------------- reading and comparing
  const pending = watchKit.parseLook(lookText({ checks: [run('lint'), run('test')] }));
  const failedLint = watchKit.parseLook(
    lookText({ checks: [run('lint', 'FAILURE'), run('test', 'SUCCESS')] })
  );
  const passed = watchKit.parseLook(
    lookText({ checks: [run('lint', 'SUCCESS'), run('test', 'SUCCESS')], comments: 1 })
  );
  check(
    pending.comments === 0 && pending.head === 'abc1234',
    'a look counts comments and keeps the head commit'
  );
  check(watchKit.compare(pending, pending).line === '', 'no change, no line');
  check(
    watchKit.compare(pending, failedLint).line === '#42: a check failed · lint',
    'a failed check is one line: ' + watchKit.compare(pending, failedLint).line
  );
  check(
    watchKit.compare(failedLint, passed).line === '#42: checks passed · 1 new comment',
    'checks passed and a new comment: ' + watchKit.compare(failedLint, passed).line
  );
  const merged = watchKit.compare(
    passed,
    watchKit.parseLook(lookText({ state: 'MERGED', comments: 1 }))
  );
  check(merged.done && /merged/.test(merged.line), 'merged ends the watch');
  check(
    watchKit.mergeable(passed) && !watchKit.mergeable(pending) && !watchKit.mergeable(failedLint),
    'mergeable only with every check passed'
  );
  check(
    !watchKit.mergeable(
      watchKit.parseLook(lookText({ draft: true, checks: [run('a', 'SUCCESS')] }))
    ),
    'a draft is never mergeable'
  );
  check(
    !watchKit.mergeable(watchKit.parseLook(lookText({}))),
    'no checks at all is not "checks passed"'
  );
  check(
    /gh pr checks 42/.test(watchKit.messageFor('#42: a check failed · lint', failedLint)),
    'the agent is told how to see the failing check'
  );

  // ---------------------------------------------------------------- the watcher
  const calls = [];
  let answer = lookText({ checks: [run('lint')] });
  const told = [];
  let changes = 0;
  const timers = [];
  const watcher = watchKit.createPrWatch({
    cwdOf: paneId => (paneId === 'pane-1' ? root : ''),
    deliver: (paneId, event) => told.push({ paneId, ...event }),
    changed: () => changes++,
    runGh: async (args, cwd) => {
      calls.push(args.join(' '));
      if (args[0] === 'repo')
        return { stdout: JSON.stringify({ mergeCommitAllowed: false, squashMergeAllowed: true }) };
      if (args[1] === 'merge') return { stdout: '' };
      return { stdout: answer };
    },
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: timer => {
      if (timer) timer.cleared = true;
    },
  });
  const started = await watcher.watch('pane-1', 0);
  check(
    started.ok && started.number === 42 && started.everyMin === 3,
    "watch starts on the branch's pull request, every 3 minutes"
  );
  check(
    timers.length === 1 && timers[0].ms === 180000,
    'one timer at 3 minutes (the labeled poll)'
  );
  check(watcher.list().length === 1 && changes === 1, 'the window is told what is watched');
  check(!(await watcher.watch('pane-2', 0)).ok, 'a thread with no folder is refused');
  answer = lookText({ checks: [run('lint', 'FAILURE')] });
  await watcher._tick('pane-1');
  check(
    told.length === 1 && told[0].line === '#42: a check failed · lint',
    'a tick hands one change to the window'
  );
  await watcher._tick('pane-1');
  check(told.length === 1, 'the same state again tells nothing');

  answer = lookText({ checks: [run('lint', 'FAILURE')] });
  const refused = await watcher.merge('pane-1', 42);
  check(
    !refused.ok && !calls.some(call => call.startsWith('pr merge')),
    'merge is refused while a check failed, gh merge never runs'
  );
  answer = lookText({ checks: [run('lint', 'SUCCESS')], head: 'def5678' });
  const done = await watcher.merge('pane-1', 42);
  const mergeCall = calls.find(call => call.startsWith('pr merge')) || '';
  check(done.ok, 'merge runs when the fresh look allows it');
  check(
    mergeCall === 'pr merge 42 --squash --match-head-commit def5678',
    'it merges the checked commit with the allowed method: ' + mergeCall
  );
  check(!/delete-branch/.test(mergeCall), 'the branch is never deleted');
  check(watcher.list().length === 0 && timers[0].cleared, 'a merge ends the watch and its timer');

  await watcher.watch('pane-1', 42);
  watcher.forget('pane-1');
  check(watcher.list().length === 0 && timers[1].cleared, 'a closed thread stops its watch');
  const said = await watcher.command('pane-1', '', 0);
  check(
    said.ok && /No pull request is watched/.test(said.text),
    'tnai pr says when nothing is watched'
  );

  // ---------------------------------------------------------------- the menu's rules (154)
  const facts = pr => ({ repo: true, branch: 'tnai/kestrel', base: 'main', pr });
  const ok = {
    number: 42,
    state: 'OPEN',
    draft: false,
    checks: { total: 2, failed: 0, pending: 0 },
  };
  check(
    actions.canWatch(facts(ok)) && !actions.canWatch(facts({ ...ok, state: 'MERGED' })),
    'Watch shows for an open pull request only'
  );
  check(actions.canMerge(facts(ok)), 'Merge shows when open, not a draft, checks passed');
  check(!actions.canMerge(facts({ ...ok, draft: true })), 'no Merge for a draft');
  check(
    !actions.canMerge(facts({ ...ok, checks: { total: 2, failed: 0, pending: 1 } })),
    'no Merge while a check runs'
  );
  check(
    !actions.canMerge(facts({ ...ok, checks: { total: 0, failed: 0, pending: 0 } })),
    'no Merge with no checks'
  );
  check(
    actions.watchMessage({ number: 42, message: 'x' }) === '[from GitHub · pull request #42] x',
    'the agent gets one [from ...] message (one quiet line in the conversation)'
  );

  // ---------------------------------------------------------------- open in editor
  const folder = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-editor-'));
  const bin = path.join(folder, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'code'), '');
  const started2 = [];
  const kit = editorKit.createOpenInEditor({
    env: { PATH: bin },
    platform: 'linux',
    openPath: async () => '',
    start: (file, args) => {
      started2.push([file, ...args]);
      return { on() {}, unref() {} };
    },
  });
  const listed = kit.list().map(one => one.label);
  check(
    listed.join() === 'VS Code,Files',
    'only editors found are listed, the file manager last: ' + listed.join()
  );
  await kit.open('vscode', folder);
  check(
    started2.length === 1 && started2[0][0] === path.join(bin, 'code') && started2[0][1] === folder,
    'VS Code opens the thread folder'
  );
  let refusedEditor = false;
  try {
    await kit.open('cursor', folder);
  } catch {
    refusedEditor = true;
  }
  check(refusedEditor, 'an editor not found is refused');
  let refusedFolder = false;
  try {
    await kit.open('files', path.join(folder, 'missing'));
  } catch {
    refusedFolder = true;
  }
  check(refusedFolder, 'a folder that does not exist is refused');
  check(editorKit.filesLabel('win32') === 'File Explorer', 'Windows names it File Explorer');
  fs.rmSync(folder, { recursive: true, force: true });

  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
