// Technically Not tools · main-leftovers-test.js — Plain Node checks for bug sweep group 8 (main-
// process leftovers), no window and no Electron:
//   1. quit-guard.js: on macOS a quit with running sessions asks first, and a cancelled quit skips
//      every other before-quit step; on Windows it never asks.
//   2. agent-context.js: the file-name search stays fast on a long unbroken token and still finds
//      ordinary file names.
//   3. worktree-service.js: a create() that fails after `git worktree add` leaves no worktree,
//      folder or branch behind, and list() drops records of worktrees git no longer has.
// Run: node tools/main-leftovers-test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const { execFileSync } = require('child_process');

// TNAI_TEST_DESKTOP: another copy of desktop/ (an older version, to see these checks fail on it)
const desktop = process.env.TNAI_TEST_DESKTOP || path.join(__dirname, '..', 'desktop');
let failures = 0;

// temporary folders this test made, removed at the end
const scratchDirs = [];

async function check(name, run) {
  try {
    await run();
    console.log('ok   ' + name);
  } catch (error) {
    failures += 1;
    console.log(
      'FAIL ' + name + '\n     ' + (error.stack || error).split('\n').slice(0, 3).join('\n     ')
    );
  }
}

// ---- 1. the macOS quit question ----

function quitRun(platform, running, answer) {
  const quitGuard = require(path.join(desktop, 'quit-guard.js'));
  const app = new EventEmitter();
  const asked = [];
  const stopped = [];
  app.on(
    'before-quit',
    quitGuard.create({
      platform,
      running: () => running,
      ask: count => {
        asked.push(count);
        return answer;
      },
    })
  );

  // the same wrapper main.js registers every other step through
  const onQuit = step =>
    app.on('before-quit', event => {
      if (!quitGuard.cancelled(event)) step(event);
    });
  onQuit(() => stopped.push('mesh'));
  onQuit(() => stopped.push('sessions'));
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  app.emit('before-quit', event);
  return { asked, stopped, prevented: event.prevented };
}

// ---- 2. the file-name search ----

function loadAgentContext() {
  // agent-context.js needs electron only through git-service; a stub app is enough to load it
  return withElectronStub(() => require(path.join(desktop, 'agent-context.js')));
}

function withElectronStub(load) {
  const original = Module._load;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-main-leftovers-'));
  scratchDirs.push(scratch);
  Module._load = function (request, ...rest) {
    if (request === 'electron')
      return {
        app: { getPath: () => scratch, on() {}, once() {}, isPackaged: false },
        ipcMain: { handle() {}, on() {} },
      };
    return original.call(this, request, ...rest);
  };
  try {
    return load(scratch);
  } finally {
    Module._load = original;
  }
}

// ---- 3. worktrees ----

function gitIn(dir, args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function main() {
  await check('macOS quit with running sessions asks, and Cancel stops nothing', () => {
    const run = quitRun('darwin', 2, false);
    assert.deepStrictEqual(run.asked, [2]);
    assert.strictEqual(run.prevented, true);
    assert.deepStrictEqual(run.stopped, []);
  });
  await check('macOS quit, "Stop and quit": every step runs', () => {
    const run = quitRun('darwin', 1, true);
    assert.strictEqual(run.prevented, false);
    assert.deepStrictEqual(run.stopped, ['mesh', 'sessions']);
  });
  await check('macOS quit with no running session never asks', () => {
    const run = quitRun('darwin', 0, false);
    assert.deepStrictEqual(run.asked, []);
    assert.deepStrictEqual(run.stopped, ['mesh', 'sessions']);
  });
  await check('Windows never asks in before-quit (the window close warns)', () => {
    const run = quitRun('win32', 3, false);
    assert.deepStrictEqual(run.asked, []);
    assert.deepStrictEqual(run.stopped, ['mesh', 'sessions']);
  });

  const context = loadAgentContext();
  const mentioned = context.mentionedFiles;
  await check('file names are still found', () => {
    assert.deepStrictEqual(mentioned('see desktop/main.js and (src/styles/a.css).', 'C:/x'), [
      'desktop/main.js',
      'src/styles/a.css',
    ]);
  });
  await check('a long unbroken token stays fast (was quadratic: about 90 ms at 8,000)', () => {
    const start = process.hrtime.bigint();
    for (const token of ['a'.repeat(40000), 'a.'.repeat(20000), 'a/'.repeat(20000)])
      mentioned('x ' + token + ' y desktop/main.js', '');
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log('     three 40,000-character tokens: ' + ms.toFixed(1) + ' ms');
    assert.ok(ms < 50, 'took ' + ms.toFixed(1) + ' ms');
  });

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-wt-repo-'));
  gitIn(repo, ['init', '-q', '-b', 'master']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  gitIn(repo, ['add', '-A']);
  gitIn(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'first']);

  await withElectronStub(async userData => {
    const gitService = require(path.join(desktop, 'git-service.js'));
    const worktrees = require(path.join(desktop, 'worktree-service.js'));
    worktrees.init(() => {});
    gitService.init(
      () => repo,
      () => {}
    );

    await check('a create() that fails after git worktree add leaves nothing behind', async () => {
      // the records file's folder is a file, so writing the record fails after the add
      const base = path.join(userData, 'worktrees');
      const recordsBlocker = path.join(base, 'worktrees.json');
      fs.mkdirSync(recordsBlocker, { recursive: true });
      let thrown = null;
      try {
        await worktrees.paneCwd({ paneId: 'pane-1', agent: 'Tester', worktree: true });
      } catch (error) {
        thrown = error;
      }
      fs.rmSync(recordsBlocker, { recursive: true, force: true });
      assert.ok(thrown, 'create() should have failed');
      assert.strictEqual(gitIn(repo, ['branch', '--list', 'tnai/*']).trim(), '');
      assert.strictEqual(gitIn(repo, ['worktree', 'list']).trim().split('\n').length, 1);
      assert.match(String(thrown.code || thrown.message), /EISDIR|EPERM|EEXIST|ENOTEMPTY/);
    });

    await check('list() drops the record of a worktree removed outside the app', async () => {
      const made = await worktrees.paneCwd({ paneId: 'pane-2', agent: 'Tester', worktree: true });
      const recordsFile = path.join(userData, 'worktrees', 'worktrees.json');
      const recorded = () => JSON.parse(fs.readFileSync(recordsFile, 'utf8')).map(r => r.branch);
      assert.deepStrictEqual(recorded(), [made.branch]);
      gitIn(repo, ['worktree', 'remove', '--force', made.cwd]);
      await worktrees.list();
      assert.deepStrictEqual(recorded(), []);
    });
    worktrees.stop();
  });
  for (const dir of [repo, ...scratchDirs]) fs.rmSync(dir, { recursive: true, force: true });

  if (failures) {
    console.log(failures + ' failed');
    process.exit(1);
  }
  console.log('all passed');
}

main();
