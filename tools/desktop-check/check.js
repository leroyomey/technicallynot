/*
 * Technically Not tools · desktop-check/check.js — Cross-platform twin of check.ps1 (Windows,
 * macOS, Linux; CI uses it): runs Technically Not in Electron with an isolated profile and one or
 * more renderer tests, prints each log, exits 1 if any fails. Usage: node
 * tools/desktop-check/check.js [test ...] [--real-project] (default test: core). On Linux run it
 * under `xvfb-run -a` when there is no display. Off Windows, only tests listed in WINDOWS_ONLY
 * below are skipped. On this PC, Linux runs go through WSL: tools/desktop-check/wsl.sh.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.resolve(__dirname, '..', '..');

// the binary path for this OS
const electron = require(path.join(root, 'node_modules', 'electron'));
const args = process.argv.slice(2),
  realProject = args.includes('--real-project');
const tests = args.filter(a => !a.startsWith('--'));
if (!tests.length) tests.push('core');

// Every test runs on Windows, macOS and Linux: tests pick PowerShell or bash commands by OS (`const
// windows = /Windows/.test(navigator.userAgent)`, `process.platform === 'win32'` in .main.js). A
// test that truly can't run off Windows goes here with the reason; TNAI_CHECK_ALL=1 runs it anyway.
const WINDOWS_ONLY = new Set([]);

function windowsOnly(test) {
  return process.platform !== 'win32' && WINDOWS_ONLY.has(test) && !process.env.TNAI_CHECK_ALL;
}

// One desktop check at a time on this PC (2026-09-27: several agents' checks at once, each a full
// app instance, plus a load test pinned the user's PC). A lock file in the temp folder holds the
// running check's pid; others wait in line. A dead holder's lock is taken over.
// TNAI_CHECK_PARALLEL=1 skips the line (only for a single, isolated CI runner).
const LOCK = path.join(os.tmpdir(), 'tnai-desktop-check.lock');
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

// The line is first come, first served. Every waiting check puts a ticket (its start time and its
// pid) into a folder beside the lock, and only the oldest ticket of a living check may take the
// lock. Without it a check that came later could take the lock again and again while an earlier
// one waited: with six helpers testing at once two checks stood in line for 28 minutes
// (2026-10-12).
const QUEUE = path.join(os.tmpdir(), 'tnai-desktop-check.queue');

// A new ticket each time this check stands in line: a call with several tests goes to the back of
// the line after each test, so one long list does not hold every other check up (a list of
// eighteen tests would have kept the line for half an hour).
let TICKET = '';
const newTicket = () => {
  TICKET = path.join(QUEUE, Date.now() + '-' + process.pid);
};

// A check that has waited this long gives up, so a check nobody waits for any more (its caller
// timed out) does not run later and hold the others up.
const WAIT_LIMIT_MS =
  Number(process.env.TNAI_CHECK_WAIT_MS) > 0 ? Number(process.env.TNAI_CHECK_WAIT_MS) : 20 * 60e3;

function dropTicket() {
  try {
    fs.unlinkSync(TICKET);
  } catch {}
}

// True when no living check has an older ticket than this one. Tickets of dead checks are removed.
function firstInLine() {
  let names = [];
  try {
    names = fs.readdirSync(QUEUE);
  } catch {}
  const mine = path.basename(TICKET);
  for (const name of names.sort()) {
    if (name === mine) return true;
    const pid = Number(name.split('-')[1]);
    if (alive(pid)) return false;
    try {
      fs.unlinkSync(path.join(QUEUE, name));
    } catch {}
  }
  return true;
}

// How many checks may run at the same time. One, unless the user has said the PC is free: the
// number stands in a small file in the temp folder (1 to 6), so it can be raised for one working
// session and taken away again without touching this script.
//   raise:  echo 3 > %TEMP%\\tnai-desktop-check.slots      back to one: delete that file
const SLOTS_FILE = path.join(os.tmpdir(), 'tnai-desktop-check.slots');

function slotCount() {
  try {
    const count = Math.floor(Number(fs.readFileSync(SLOTS_FILE, 'utf8').trim()));
    return count >= 1 && count <= 6 ? count : 1;
  } catch {
    return 1;
  }
}
const lockFile = slot => (slot === 1 ? LOCK : LOCK + slot);

// A test that measures time must have the PC to itself, or the other checks' work shows up in its
// numbers: it takes every place.
const ALONE = /^(perf-|stress-|idle-|resize-|window-move|speed-)|-speed$/;

// The places this check holds.
const held = [];

// One place: 'taken', 'busy' (a living check or the PowerShell wrapper's folder has it) or
// 'freed' (a dead holder's lock was removed; try again).
function tryPlace(slot, names) {
  const place = lockFile(slot);
  try {
    fs.writeFileSync(
      place,
      JSON.stringify({ pid: process.pid, tests: names, at: new Date().toISOString() }),
      { flag: 'wx' }
    );
    held.push(place);
    return 'taken';
  } catch {}

  // The PowerShell wrapper that starts these checks holds the same name as a folder: wait for it
  // like a live holder (reading or unlinking it fails, and retrying at once spun a CPU core).
  let holder = null;
  try {
    if (fs.statSync(place).isDirectory()) return 'busy';
    holder = JSON.parse(fs.readFileSync(place, 'utf8'));
  } catch {}
  if (holder && holder.pid === process.pid) return 'taken';
  if (holder && alive(holder.pid)) return 'busy';
  try {
    fs.unlinkSync(place);
  } catch {}
  return 'freed';
}

// Waits in line, then takes a place for the tests named (every place for a test that must run
// alone).
async function takeLock(names = tests) {
  if (process.env.TNAI_CHECK_PARALLEL) return;
  let told = false;
  const waitingSince = Date.now();
  const alone = names.some(name => ALONE.test(name));
  newTicket();
  try {
    fs.mkdirSync(QUEUE, { recursive: true });
    fs.writeFileSync(TICKET, names.join(' '));
  } catch {}
  for (;;) {
    if (Date.now() - waitingSince > WAIT_LIMIT_MS) {
      console.log(
        'GAVE UP: waited ' +
          Math.round(WAIT_LIMIT_MS / 60e3) +
          ' minutes for other desktop checks. Nothing was run; start the check again.'
      );
      dropLock();
      dropTicket();
      process.exit(2);
    }
    if (firstInLine()) {
      const count = slotCount();
      let got = false;
      if (alone) {
        // every place, in order; the ones already taken are kept while the others end
        got = true;
        for (let slot = 1; slot <= count; slot++)
          if (tryPlace(slot, names) !== 'taken') got = false;
      } else {
        for (let slot = 1; slot <= count && !got; slot++) got = tryPlace(slot, names) === 'taken';
      }
      if (got) {
        dropTicket();
        return;
      }
    }
    if (!told) {
      console.log(
        'Waiting in line: other desktop checks are running (' +
          slotCount() +
          ' at a time on this PC right now).'
      );
      told = true;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

function dropLock() {
  for (const place of held.splice(0)) {
    try {
      if (JSON.parse(fs.readFileSync(place, 'utf8')).pid === process.pid) fs.unlinkSync(place);
    } catch {}
  }
}

// The app instance under test dies with this runner (stopped, killed, Ctrl+C), so no orphaned
// Electron keeps using the PC.
let current = null;

function killCurrent() {
  if (!current || current.exitCode !== null) return;
  try {
    if (process.platform === 'win32')
      require('child_process').spawnSync('taskkill', ['/PID', String(current.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    else current.kill('SIGKILL');
  } catch {}
}
process.on('exit', () => {
  killCurrent();
  dropLock();
  dropTicket();
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => process.exit(130));
  } catch {}
}

// Per-test time limit: 7 min (under run-all.js's 8-min cap, so this runner ends the app itself);
// TNAI_CHECK_LIMIT_MS overrides it.
const LIMIT_MS =
  Number(process.env.TNAI_CHECK_LIMIT_MS) > 0 ? Number(process.env.TNAI_CHECK_LIMIT_MS) : 7 * 60e3;

function run(test) {
  return new Promise(resolve => {
    const env = { ...process.env, TNAI_SELFTEST: test };
    if (realProject) env.TNAI_CHECK_PROJECT = 'repo';

    // Skill copies for Codex and Copilot (skill-service.js syncHomeSkills) go to a scratch folder,
    // never the user's real ~/.agents/skills.
    if (!env.TNAI_HOME_SKILLS_DIR)
      env.TNAI_HOME_SKILLS_DIR = path.join(require('os').tmpdir(), 'tnai-check-home-skills');

    // (voice-lost-audio: the engine must count as installed for its warm-up check)
    if (
      (test === 'voice-prompt' || test === 'perf-latency' || test === 'voice-lost-audio') &&
      !env.TN_VOICE_FAKE
    )
      env.TN_VOICE_FAKE = 'hello from the fake mic';

    // Linux CI: node_modules' chrome-sandbox is not setuid root, so Chromium's sandbox can't start
    // there. Only for tests, never for the shipped app.
    const extra = process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [];

    // A hung test (2026-10-01: persistence sat at launch for ~10 min with no output) must not hold
    // the PC or the line of waiting checks. run.js gets the same limit and reports where it is
    // stuck 15 s earlier; this kill is the backstop when the app no longer answers.
    env.TNAI_CHECK_LIMIT_MS = String(LIMIT_MS);
    const child = spawn(electron, [root, ...extra], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    const limit = setTimeout(() => {
      console.log(
        'FAIL ' + test + ' timed out after ' + Math.round(LIMIT_MS / 1000) + ' s: app killed'
      );
      killCurrent();
    }, LIMIT_MS);
    child.on('close', () => clearTimeout(limit));
    let all = '';
    const print = chunk => {
      const text = String(chunk);
      all += text;
      for (const line of text.split(/\r?\n/))
        if (line && !/DevTools|GPU|gpu_/.test(line)) console.log(line);
    };
    child.stdout.on('data', print);
    child.stderr.on('data', print);

    // The test is over when the app has ended. 'close' also waits for the app's output pipes,
    // and a program the app started that outlives it (a shell, a CLI) keeps those open: the
    // runner then stood for ten minutes with no window, holding the line (2026-10-12). So the
    // app's own end counts, three seconds later at most.
    let ended = false;
    const finish = (code, signal) => {
      if (ended) return;
      ended = true;
      clearTimeout(limit);
      child.stdout.destroy();
      child.stderr.destroy();

      // A test that passed but whose app then exits non-zero (a crash on shutdown) would otherwise
      // fail with no reason shown.
      if (/RESULT: PASS/.test(all) && code !== 0)
        console.log(
          'FAIL app exited with code ' +
            code +
            (signal ? ' (' + signal + ')' : '') +
            ' after RESULT: PASS'
        );
      resolve(/RESULT: PASS/.test(all) && code === 0);
    };
    child.on('close', finish);
    child.on('exit', (code, signal) => setTimeout(() => finish(code, signal), 3000));
  });
}

(async () => {
  let failed = 0;
  for (const test of tests) {
    if (!fs.existsSync(path.join(__dirname, 'tests', test + '.js'))) {
      console.log('== ' + test + ': no such test');
      failed++;
      continue;
    }
    if (windowsOnly(test)) {
      console.log('== ' + test + ': SKIP (Windows-only test on ' + process.platform + ')');
      continue;
    }

    // Each test stands in line for itself: between two tests of one call the others get their
    // turn, and a timing test takes every place while the rest run beside each other.
    dropLock();
    await takeLock([test]);
    console.log('== ' + test);
    if (!(await run(test))) failed++;
  }
  dropLock();

  // run.js can't delete its own profile while Electron still has it open, so sweep finished ones
  // (older than 15 min, so parallel runs are safe).
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (!d.startsWith('tnai-desktop-check-')) continue;
      const p = path.join(os.tmpdir(), d);
      if (Date.now() - fs.statSync(p).mtimeMs > 15 * 60e3)
        fs.rmSync(p, { recursive: true, force: true });
    }
  } catch {}
  console.log(failed ? 'DESKTOP CHECK: ' + failed + ' FAILED' : 'DESKTOP CHECK: PASS');
  process.exit(failed ? 1 : 0);
})();
