// Test of the kept git status in desktop/git-service.js: node tools/git-status-test.js (plain Node,
// a throwaway repository in the temp folder, the real git).
//
// The status is kept until something it is made of changes: asks that come together share one git
// run, a later ask reuses the answer, and a changed project file (main.js calls `changed`) or a
// change in the repository's own files makes the next ask run git again.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const wait = ms => new Promise(done => setTimeout(done, ms));

async function run() {
  const repo = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-git-status-'));
  const plain = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-git-plain-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'first');

  // Count the git runs the service starts: every git start goes through process-starter.js (a
  // worker thread since 2026-10-14), so the count is taken there.
  const processStarter = require('../desktop/process-starter.js');
  const realStart = processStarter.start;
  let runs = 0;
  processStarter.start = function (...args) {
    if (Array.isArray(args[1]) && args[1].includes('status')) runs++;
    return realStart.apply(this, args);
  };

  const service = require('../desktop/git-service.js');
  const sent = [];
  service.init(
    () => repo,
    (channel, payload) => sent.push({ channel, payload })
  );

  try {
    const [first, second] = await Promise.all([service.status(), service.status()]);
    check(
      'a clean repository: the status reads',
      first.ok && first.value.files.length === 0,
      first
    );
    check('two asks at once share one git run', runs === 1 && second.ok, { runs });

    const again = await service.status();
    check('a later ask reuses the kept answer', runs === 1 && again.ok, { runs });

    fs.writeFileSync(path.join(repo, 'b.txt'), 'new\n');
    service.changed();
    const afterFile = await service.status();
    check(
      'a changed project file: the next ask runs git and sees the new file',
      runs === 2 && afterFile.value.files.some(f => f.path === 'b.txt'),
      { runs, files: afterFile.value?.files }
    );

    // A change in the repository's own files (a commit) comes from the git dir watcher.
    git('add', 'b.txt');
    git('commit', '-q', '-m', 'second');
    await wait(400);
    const afterCommit = await service.status();
    check(
      "a commit (the repository's own files changed): the next ask runs git again",
      runs === 3 && afterCommit.value.files.length === 0,
      { runs, files: afterCommit.value?.files }
    );

    // A folder that is not a repository yet: `git init` only writes inside .git, which the file
    // watcher skips, so the folder watcher must end the kept "not a repository" answer (bug sweep
    // 2026-10-21 group 23).
    service.init(
      () => plain,
      (channel, payload) => sent.push({ channel, payload })
    );
    const before = await service.status();
    check('a plain folder reads as no repository', before.ok && !before.value.repo, before);
    execFileSync('git', ['init', '-q'], { cwd: plain, stdio: 'ignore' });
    await wait(800);
    const afterInit = await service.status();
    check(
      'after `git init` the next ask sees the repository',
      afterInit.ok && afterInit.value.repo === true,
      afterInit.value
    );
  } finally {
    processStarter.start = realStart;
    service.stop();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(plain, { recursive: true, force: true });
  }
  console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
}

run().catch(error => {
  console.log('FAIL the test threw: ' + (error?.stack || error));
  process.exit(1);
});
