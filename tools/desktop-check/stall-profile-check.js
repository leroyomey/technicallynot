// Technically Not tools · desktop-check/stall-profile-check.js — Checks that a main-process stall
// line says how much of the CPU was the main thread's own, and that with TNAI_STALL_PROFILE=1 a
// second line names the function that held the thread (desktop/stall-log.js,
// desktop/stall-profile.js). Each mode runs in a child Node process of its own (stall-log.js
// changes the process's timers). The stall is a wait (Atomics.wait, 300 ms) after an `await`, the
// kind stall-log.js cannot name by itself; it puts no load on the PC. Run: node
// tools/desktop-check/stall-profile-check.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------- the child: one stall, then the log is printed ----------
if (process.argv[2] === 'child') {
  const folder = process.argv[3];
  require('../../desktop/stall-log').start(folder);

  // holds the main thread 300 ms without using the CPU
  function blockForStallTest() {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  setTimeout(async () => {
    await Promise.resolve();
    blockForStallTest();
  }, 600);
  setTimeout(() => {
    let text = '';
    try {
      text = fs.readFileSync(path.join(folder, 'stalls.log'), 'utf8');
    } catch {}
    process.stdout.write(text);
    process.exit(0);
  }, 1800);
  setInterval(() => {}, 1000);
  return;
}

// ---------- the check ----------
let failures = 0;
const check = (condition, label) => {
  console.log((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) failures++;
};

function runChild(profileMode) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-stall-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('TNAI_')) delete env[key];
  if (profileMode) env.TNAI_STALL_PROFILE = '1';
  const result = spawnSync(process.execPath, [__filename, 'child', folder], {
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  fs.rmSync(folder, { recursive: true, force: true });
  return (result.stdout || '').split('\n').filter(Boolean);
}

const plain = runChild(false);
const stall = plain.find(line => /blocked ~\d+ ms/.test(line)) || '';
console.log('plain run: ' + (stall || '(no stall line)'));
check(Number((stall.match(/blocked ~(\d+) ms/) || [])[1]) >= 100, 'the 300 ms wait is logged');
const mainCpu = Number((stall.match(/main thread CPU (\d+) ms/) || [])[1]);
check(Number.isFinite(mainCpu), 'the line says the main thread CPU');
check(mainCpu < 100, 'a wait shows as little main thread CPU (' + mainCpu + ' ms)');
check(
  !plain.some(line => line.includes('[tnai stall profile]')),
  'no profile line without TNAI_STALL_PROFILE'
);

const profiled = runChild(true);
const named = profiled.find(line => line.includes('[tnai stall profile]')) || '';
console.log('profiled run: ' + (named.slice(0, 400) || '(no profile line)'));
check(
  profiled.some(line => /blocked ~\d+ ms/.test(line)),
  'the stall is logged with the profile on'
);
check(
  named.includes('blockForStallTest'),
  'the profile line names the function that held the thread'
);

console.log(failures ? 'RESULT: FAIL (' + failures + ')' : 'RESULT: PASS');
process.exitCode = failures ? 1 : 0;
