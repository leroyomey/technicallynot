/*
 * Technically Not · process-start-check.js — proves that the CLI checks in agent-registry.js
 * (`run()`) start their processes without holding the main thread: the CLI update check's
 * `--version` runs (as desktop/cli-updates.js check() does, without the registry fetch) are timed
 * three times, and the longest unbroken block of the event loop must stay under LIMIT_MS. Also
 * checks that the fallback without worker threads gives the same versions.
 * Plain Node, reads only, no window: `node tools/desktop-check/process-start-check.js`.
 */
'use strict';
const path = require('path');
const workerThreads = require('worker_threads');

const REGISTRY = path.join(__dirname, '..', '..', 'desktop', 'agent-registry.js');

// Before the worker thread (2026-10-14) one check held the main thread 28 to 1,447 ms on a busy
// PC; after it 1 to 4 ms.
const LIMIT_MS = 50;

let failed = 0;

function report(ok, text) {
  if (!ok) failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + text);
}

// Runs fn while a setImmediate loop records the longest gap between its turns.
async function longestBlock(fn) {
  let longest = 0;
  let last = performance.now();
  let watching = true;
  (function tick() {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (watching) setImmediate(tick);
  })();
  const result = await fn();
  watching = false;
  return { longest, result };
}

async function main() {
  const agents = require(REGISTRY);
  const ids = agents
    .releases()
    .filter(release => release.npm && release.update)
    .map(release => release.id);
  const checkAll = () => Promise.all(ids.map(id => agents.version(id)));

  // the first run finds every CLI on PATH and starts the worker
  const first = await checkAll();
  console.log('CLIs: ' + ids.map((id, index) => id + ' ' + (first[index] || '-')).join(' · '));

  for (let round = 1; round <= 3; round++) {
    const { longest, result } = await longestBlock(checkAll);
    report(
      longest < LIMIT_MS,
      'round ' +
        round +
        ': longest main-thread block ' +
        longest.toFixed(1) +
        ' ms (limit ' +
        LIMIT_MS +
        ')'
    );
    report(JSON.stringify(result) === JSON.stringify(first), 'round ' + round + ': same versions');
  }

  // the fallback: a fresh copy of the registry that cannot start a worker
  delete require.cache[require.resolve(REGISTRY)];
  const RealWorker = workerThreads.Worker;
  workerThreads.Worker = function () {
    throw new Error('worker threads switched off for this check');
  };
  const fallbackAgents = require(REGISTRY);

  // the registry asks for a worker on its first run, so the switch stays off until the runs end
  const fallback = await Promise.all(ids.map(id => fallbackAgents.version(id)));
  workerThreads.Worker = RealWorker;
  report(
    JSON.stringify(fallback) === JSON.stringify(first),
    'fallback without worker: same versions'
  );

  await checkGit();
  await checkWatch();

  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: PASS');
  process.exit(failed ? 1 : 0);
}

// git-service.js `git()` starts git the same way (stall log 2026-10-14: `ipc git:status` and the
// commit scan behind `ipc context:state` held the main process 100 to 740 ms). Six read-only git
// runs in this repo at once, three rounds; and a failing command must still answer with its git
// error.
async function checkGit() {
  const repo = path.join(__dirname, '..', '..');
  const gitService = require(path.join(repo, 'desktop', 'git-service.js'));
  gitService.init(
    () => repo,
    () => {}
  );
  const git = gitService.internal.git;
  const runAll = () =>
    Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['log', '-n', '5', '--format=%h %s']),
      git(['rev-parse', '--git-dir']),
      git(['config', '--get', 'core.bare'], { okCodes: [0, 1] }),
      git(['log', '-n', '1', '--format=%ct']),
    ]).then(results => results.map(result => result.stdout));

  const first = await runAll();
  for (let round = 1; round <= 3; round++) {
    const { longest, result } = await longestBlock(runAll);
    report(
      longest < LIMIT_MS,
      'git round ' + round + ': longest main-thread block ' + longest.toFixed(1) + ' ms'
    );
    report(
      JSON.stringify(result) === JSON.stringify(first),
      'git round ' + round + ': same output'
    );
  }

  const failure = await git(['rev-parse', 'no-such-ref-here']).then(
    () => null,
    error => error
  );
  report(
    failure?.code === 'GitError' && /no-such-ref-here/.test(failure.message),
    'git failure keeps its error: ' + (failure ? failure.code : 'no error')
  );
}

// process-starter.js `watch()` starts voice-hold.js's PowerShell key watcher the same way (stall
// log 2026-10-14: `ipc voice:hold`, a spawn on the main thread at every voice press). Its output
// comes back, its end is reported once, and kill() stops a process that would run for 30 s.
async function checkWatch() {
  const starter = require(path.join(__dirname, '..', '..', 'desktop', 'process-starter.js'));
  const runWatch = (command, killAfterMs) =>
    new Promise(resolve => {
      let output = '';
      let ends = 0;
      const started = performance.now();
      const watcher = starter.watch(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { windowsHide: true },
        {
          onData: data => {
            output += data;
          },
          onExit: () => {
            ends++;
            setTimeout(() => resolve({ output, ends, ms: performance.now() - started }), 200);
          },
        }
      );
      if (killAfterMs) setTimeout(() => watcher.kill(), killAfterMs);
    });

  const { longest, result } = await longestBlock(() => runWatch('"up"'));
  report(longest < LIMIT_MS, 'watch: longest main-thread block ' + longest.toFixed(1) + ' ms');
  report(
    /up/.test(result.output) && result.ends === 1,
    'watch: output came back and the end was reported once (' +
      JSON.stringify(result.output.trim()) +
      ')'
  );
  const killed = await runWatch('Start-Sleep 30; "up"', 1500);
  report(
    killed.ms < 10000 && !/up/.test(killed.output) && killed.ends === 1,
    'watch: kill() stopped a 30 s process after ' + Math.round(killed.ms) + ' ms'
  );
}

main().catch(error => {
  console.log('FAIL ' + error.message);
  process.exit(1);
});
