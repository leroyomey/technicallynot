// Technically Not tools · branch-changes-test.js — Plain Node checks for desktop/branch-changes.js,
// the facts behind the Changes section of a thread's Details tab. No window and no Electron: real
// git in temporary repositories, and a stand-in for the GitHub CLI (gh) that answers as gh does
// with a pull request, with none, signed out and not installed.
// Run: node tools/branch-changes-test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const desktop = path.join(__dirname, '..', 'desktop');
const gitService = require(path.join(desktop, 'git-service.js'));
const changesModule = require(path.join(desktop, 'branch-changes.js'));

let passed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log('ok   ' + name);
  } catch (error) {
    console.error('FAIL ' + name + '\n     ' + (error.stack || error));
    process.exitCode = 1;
  }
}

// The long form of the temp folder: git answers with it, and a short 8.3 form would not match
// (tnai-verification rule 6).
const tempRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-changes-'));

function gitIn(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function write(folder, name, text) {
  fs.writeFileSync(path.join(folder, name), text);
}

// A repository with master (one commit), and a branch with two commits, one changed file not
// committed and one new file.
function makeRepo(name) {
  const folder = path.join(tempRoot, name);
  fs.mkdirSync(folder);
  gitIn(folder, 'init', '-q', '-b', 'master');
  gitIn(folder, 'config', 'user.email', 'test@example.com');
  gitIn(folder, 'config', 'user.name', 'Test');
  gitIn(folder, 'config', 'commit.gpgsign', 'false');
  write(folder, 'a.txt', 'one\ntwo\nthree\n');
  gitIn(folder, 'add', '.');
  gitIn(folder, 'commit', '-q', '-m', 'first');
  return folder;
}

function addBranchWork(folder) {
  gitIn(folder, 'checkout', '-q', '-b', 'tnai/helper');
  write(folder, 'b.txt', 'new\nfile\n');
  gitIn(folder, 'add', '.');
  gitIn(folder, 'commit', '-q', '-m', 'second');
  write(folder, 'a.txt', 'one\nTWO\nthree\nfour\n');
  gitIn(folder, 'commit', '-q', '-am', 'third');

  // uncommitted: one more line in a.txt, and an untracked file
  write(folder, 'a.txt', 'one\nTWO\nthree\nfour\nfive\n');
  write(folder, 'c.txt', 'untracked\n');
}

// A gh stand-in that gives one fixed answer and records how it was asked.
function ghStub(answer) {
  const asked = [];
  const runGh = async (args, cwd) => {
    asked.push({ args, cwd });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { runGh, asked };
}

function reader(runGh) {
  return changesModule.createBranchChanges({
    git: gitService.internal.git,
    parseStatus: gitService.internal.parseStatus,
    numstat: gitService.internal.numstat,
    runGh,
  });
}

const PR_JSON = JSON.stringify({
  number: 42,
  title: 'Add the thing',
  url: 'https://github.com/owner/repo/pull/42',
  state: 'OPEN',
  isDraft: false,
  statusCheckRollup: [
    { __typename: 'CheckRun', name: 'Tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'Lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'Build', status: 'IN_PROGRESS', conclusion: '' },
    { __typename: 'CheckRun', name: 'Docs', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { __typename: 'StatusContext', context: 'ci/old', state: 'ERROR' },
    { __typename: 'StatusContext', context: 'ci/wait', state: 'PENDING' },
  ],
});

async function main() {
  const branchRepo = makeRepo('branch');
  addBranchWork(branchRepo);

  await check(
    'a branch: lines, files, commits ahead, uncommitted, and its pull request',
    async () => {
      const gh = ghStub({ error: null, stdout: PR_JSON, stderr: '' });
      const facts = await reader(gh.runGh).read(branchRepo);
      assert.strictEqual(facts.repo, true);
      assert.strictEqual(facts.branch, 'tnai/helper');
      assert.strictEqual(facts.base, 'master');
      assert.strictEqual(facts.onBase, false);
      assert.strictEqual(facts.since, 'master');
      assert.strictEqual(facts.ahead, 2);
      assert.strictEqual(facts.behind, 0);

      // from master to the disk: a.txt (+3 lines, -1: two→TWO, four, five), b.txt (+2)
      assert.strictEqual(facts.added, 5);
      assert.strictEqual(facts.removed, 1);
      assert.strictEqual(facts.files, 2);

      // a.txt modified and c.txt untracked
      assert.strictEqual(facts.uncommitted, 2);
      assert.strictEqual(facts.gh, 'ok');
      assert.strictEqual(facts.pr.number, 42);
      assert.strictEqual(facts.pr.url, 'https://github.com/owner/repo/pull/42');
      assert.deepStrictEqual(
        [facts.pr.checks.total, facts.pr.checks.passed, facts.pr.checks.failed],
        [6, 2, 2]
      );
      assert.strictEqual(facts.pr.checks.pending, 2);
      assert.deepStrictEqual(facts.pr.checks.failedNames, ['Lint', 'ci/old']);
      assert.strictEqual(gh.asked.length, 1);
      assert.strictEqual(gh.asked[0].cwd, path.resolve(branchRepo));
      assert.deepStrictEqual(gh.asked[0].args.slice(0, 2), ['pr', 'view']);
    }
  );

  await check('a git worktree is read in its own folder, on its own branch', async () => {
    const worktree = path.join(tempRoot, 'worktree');
    gitIn(branchRepo, 'worktree', 'add', '-q', '-b', 'tnai/other', worktree, 'master');
    write(worktree, 'd.txt', 'x\n');
    gitIn(worktree, 'add', '.');
    gitIn(worktree, 'commit', '-q', '-m', 'in the worktree');
    const facts = await reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read(
      worktree
    );
    assert.strictEqual(facts.branch, 'tnai/other');
    assert.strictEqual(facts.ahead, 1);
    assert.strictEqual(facts.added, 1);
    assert.strictEqual(facts.files, 1);
    assert.strictEqual(facts.uncommitted, 0);
  });

  await check('gh says there is no pull request: gh "none", no pull request', async () => {
    const gh = ghStub({
      error: { code: 1, message: 'Command failed' },
      stdout: '',
      stderr: 'no pull requests found for branch "tnai/helper"',
    });
    const facts = await reader(gh.runGh).read(branchRepo);
    assert.strictEqual(facts.pr, null);
    assert.strictEqual(facts.gh, 'none');
  });

  await check('gh not installed or signed out: no pull request and no error', async () => {
    const missing = await reader(
      ghStub({ error: { code: 'ENOENT', message: 'spawn gh ENOENT' }, stdout: '', stderr: '' })
        .runGh
    ).read(branchRepo);
    assert.strictEqual(missing.pr, null);
    assert.strictEqual(missing.gh, 'missing');
    assert.strictEqual(missing.ahead, 2);
    const signedOut = await reader(
      ghStub({
        error: { code: 4, message: 'failed' },
        stdout: '',
        stderr: 'To get started with GitHub CLI, please run:  gh auth login',
      }).runGh
    ).read(branchRepo);
    assert.strictEqual(signedOut.gh, 'signed-out');
    const thrown = await reader(ghStub(new Error('worker gone')).runGh).read(branchRepo);
    assert.strictEqual(thrown.pr, null);
    assert.strictEqual(thrown.gh, 'unavailable');
  });

  await check('on the default branch: uncommitted lines only, gh is not asked', async () => {
    const folder = makeRepo('on-master');
    write(folder, 'a.txt', 'one\ntwo\n');
    const gh = ghStub({ error: null, stdout: PR_JSON, stderr: '' });
    const facts = await reader(gh.runGh).read(folder);
    assert.strictEqual(facts.onBase, true);
    assert.strictEqual(facts.since, '');
    assert.strictEqual(facts.added, 0);
    assert.strictEqual(facts.removed, 1);
    assert.strictEqual(facts.uncommitted, 1);
    assert.strictEqual(facts.ahead, 0);
    assert.strictEqual(gh.asked.length, 0);
  });

  await check('origin/HEAD names the default branch (main), compared with origin', async () => {
    const folder = makeRepo('origin-main');
    gitIn(folder, 'branch', '-m', 'master', 'trunk-local');
    gitIn(folder, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    gitIn(folder, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    write(folder, 'e.txt', 'e\n');
    gitIn(folder, 'add', '.');
    gitIn(folder, 'commit', '-q', '-m', 'on trunk-local');
    const facts = await reader(ghStub({ error: null, stdout: '{}', stderr: '' }).runGh).read(
      folder
    );
    assert.strictEqual(facts.base, 'main');
    assert.strictEqual(facts.ahead, 1);
    assert.strictEqual(facts.files, 1);

    // gh answered, but with no pull request address: shown as none of its own
    assert.strictEqual(facts.pr, null);
    assert.strictEqual(facts.gh, 'unavailable');
  });

  await check('a folder that is not a repository, a missing one and a relative path', async () => {
    const plain = path.join(tempRoot, 'plain');
    fs.mkdirSync(plain);
    const read = reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read;

    // a temp folder may sit inside a repository on some machines; the check needs one outside
    const inside = (() => {
      try {
        gitIn(plain, 'rev-parse', '--show-toplevel');
        return true;
      } catch {
        return false;
      }
    })();
    if (!inside) assert.deepStrictEqual(await read(plain), { repo: false });
    assert.deepStrictEqual(await read(path.join(tempRoot, 'nothing-here')), { repo: false });
    assert.deepStrictEqual(await read('relative/folder'), { repo: false });
    assert.deepStrictEqual(await read(''), { repo: false });
  });

  await check('a repository with no commit yet: branch and uncommitted files only', async () => {
    const folder = path.join(tempRoot, 'empty');
    fs.mkdirSync(folder);
    gitIn(folder, 'init', '-q', '-b', 'master');
    write(folder, 'x.txt', 'x\n');
    const facts = await reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read(
      folder
    );
    assert.strictEqual(facts.repo, true);
    assert.strictEqual(facts.uncommitted, 1);
    assert.strictEqual(facts.files, 0);
    assert.strictEqual(facts.pr, null);
    assert.deepStrictEqual(facts.commits, []);
    assert.deepStrictEqual(facts.otherBranches, []);
    assert.strictEqual(facts.otherBranchCount, 0);
  });

  // ---------------------------------------------------------------- the git view (feature 9)
  await check('git view: the last commits, newest first, with author, time and files', async () => {
    const facts = await reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read(
      branchRepo
    );
    assert.deepStrictEqual(
      facts.commits.map(commit => commit.subject),
      ['third', 'second', 'first']
    );
    const [third, second] = facts.commits;
    assert.strictEqual(third.author, 'Test');
    assert.ok(third.at > Date.now() - 10 * 60 * 1000 && third.at <= Date.now() + 1000);
    assert.ok(/^[0-9a-f]{7,}$/.test(third.hash), 'short id: ' + third.hash);
    assert.deepStrictEqual(
      [third.files, third.added, third.removed, third.merge],
      [1, 2, 1, false]
    );
    assert.deepStrictEqual([second.files, second.added, second.removed], [1, 2, 0]);
  });

  await check('git view: other local branches without the current one', async () => {
    const facts = await reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read(
      branchRepo
    );

    // the worktree check above left the branch tnai/other in this repository
    assert.deepStrictEqual(facts.otherBranches.map(branch => branch.name).sort(), [
      'master',
      'tnai/other',
    ]);
    assert.strictEqual(facts.otherBranchCount, 2);
    assert.ok(facts.otherBranches.every(branch => branch.at > 0));
    assert.ok(facts.otherBranches[0].at >= facts.otherBranches[1].at, 'newest first');
  });

  await check(
    'git view: many branches are cut to 12 and counted; a merge; any language',
    async () => {
      const folder = makeRepo('many');
      for (let index = 0; index < 15; index++) gitIn(folder, 'branch', 'side-' + index);
      gitIn(folder, 'checkout', '-q', '-b', 'feature');
      write(folder, 'f.txt', 'f\n');
      gitIn(folder, 'add', '.');
      gitIn(folder, 'commit', '-q', '-m', 'Ünïcode ✓ message');
      gitIn(folder, 'checkout', '-q', 'master');
      gitIn(folder, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
      const facts = await reader(ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh).read(
        folder
      );
      assert.strictEqual(facts.otherBranchCount, 16);
      assert.strictEqual(facts.otherBranches.length, 12);
      assert.ok(!facts.otherBranches.some(branch => branch.name === 'master'));
      const [merge, feature] = facts.commits;
      assert.deepStrictEqual([merge.subject, merge.merge, merge.files], ['Merge feature', true, 0]);
      assert.strictEqual(feature.subject, 'Ünïcode ✓ message');
    }
  );

  await check(
    'git view is read only: only reading git commands, nothing on disk moves',
    async () => {
      const asked = [];
      const recording = (args, options) => {
        asked.push(args[0]);
        return gitService.internal.git(args, options);
      };
      const read = changesModule.createBranchChanges({
        git: recording,
        parseStatus: gitService.internal.parseStatus,
        numstat: async (args, cwd) => {
          asked.push('diff');
          return gitService.internal.numstat(args, cwd);
        },
        runGh: ghStub({ error: null, stdout: PR_JSON, stderr: '' }).runGh,
      }).read;
      const before = [
        gitIn(branchRepo, 'rev-parse', 'HEAD'),
        gitIn(branchRepo, 'branch', '--show-current'),
        gitIn(branchRepo, 'status', '--porcelain'),
        gitIn(branchRepo, 'stash', 'list'),
      ];
      await read(branchRepo);
      const after = [
        gitIn(branchRepo, 'rev-parse', 'HEAD'),
        gitIn(branchRepo, 'branch', '--show-current'),
        gitIn(branchRepo, 'status', '--porcelain'),
        gitIn(branchRepo, 'stash', 'list'),
      ];
      assert.deepStrictEqual(after, before);
      const reading = new Set([
        'rev-parse',
        'status',
        'for-each-ref',
        'rev-list',
        'merge-base',
        'log',
        'diff',
      ]);
      const writing = asked.filter(verb => !reading.has(verb));
      assert.deepStrictEqual(writing, [], 'git commands that are not reads: ' + writing.join(', '));
      assert.ok(asked.includes('log') && asked.includes('for-each-ref'));
    }
  );

  await check('parseLog and parseBranches take odd input without throwing', async () => {
    assert.deepStrictEqual(changesModule.parseLog(''), []);
    assert.deepStrictEqual(changesModule.parseLog(null), []);
    const [only] = changesModule.parseLog('\x1eabc1234\x1f\x1fAnn\x1f100\x1fNo stat line');
    assert.deepStrictEqual(
      [only.hash, only.subject, only.author, only.at, only.files, only.merge],
      ['abc1234', 'No stat line', 'Ann', 100000, 0, false]
    );
    assert.deepStrictEqual(changesModule.parseBranches('', 'main'), {
      otherBranches: [],
      otherBranchCount: 0,
    });
  });

  await check('asks together share one run; a later ask within 5 s is kept', async () => {
    const gh = ghStub({ error: null, stdout: PR_JSON, stderr: '' });
    const read = reader(gh.runGh).read;
    const [first, second] = await Promise.all([read(branchRepo), read(branchRepo)]);
    assert.strictEqual(first, second);
    await read(branchRepo);
    assert.strictEqual(gh.asked.length, 1);
  });

  await check('pull request parsing refuses an address that is not https', async () => {
    assert.strictEqual(
      changesModule.parsePullRequest(JSON.stringify({ number: 1, url: 'javascript:alert(1)' })),
      null
    );
    assert.strictEqual(changesModule.parsePullRequest('not json'), null);
    assert.deepStrictEqual(changesModule.countChecks(null), {
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      failedNames: [],
    });
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
}

main().then(
  () => process.exit(process.exitCode || 0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
