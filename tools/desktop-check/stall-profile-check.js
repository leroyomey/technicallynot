// Technically Not tools · desktop-check/stall-profile-check.js — Checks that a main-process stall
// line says how much of the CPU was the main thread's own, and that a second line names the
// function that held the thread: with TNAI_STALL_PROFILE=1 from the first stall, not set (every
// installed build) from the stall after the one that turned the profile on, with "0" never
// (desktop/stall-log.js, desktop/stall-profile.js). Each mode runs in a child Node process of its
// own (stall-log.js changes the process's timers). The stall is a wait (Atomics.wait, 300 ms) after
// an `await`, the kind stall-log.js cannot name by itself; it puts no load on the PC. Run: node
// tools/desktop-check/stall-profile-check.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// ---------- the child: one or two stalls, then the log is printed ----------
if (process.argv[2] === 'child') {
  const folder = process.argv[3];
  const stallCount = Number(process.argv[4] || 1);
  require('../../desktop/stall-log').start(folder);

  // holds the main thread 300 ms without using the CPU
  function blockForStallTest() {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  }
  for (let index = 0; index < stallCount; index++) {
    setTimeout(
      async () => {
        await Promise.resolve();
        blockForStallTest();
      },
      600 + index * 900
    );
  }
  setTimeout(
    () => {
      let text = '';
      try {
        text = fs.readFileSync(path.join(folder, 'stalls.log'), 'utf8');
      } catch {}

      // whether a profile was saved: only a stall read while the profile ran saves one
      const saved = fs.existsSync(path.join(folder, 'stall-profiles'));
      process.stdout.write(text + 'profile saved: ' + saved + '\n');
      process.exit(0);
    },
    1200 + stallCount * 900
  );
  setInterval(() => {}, 1000);
  return;
}

// ---------- the check ----------
let failures = 0;
const check = (condition, label) => {
  console.log((condition ? 'ok   ' : 'FAIL ') + label);
  if (!condition) failures++;
};

// profileMode: '1', '0' or '' (not set: the profile turns on after a stall)
function runChild(profileMode, stallCount = 1) {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-stall-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('TNAI_')) delete env[key];
  if (profileMode) env.TNAI_STALL_PROFILE = profileMode;
  const result = spawnSync(process.execPath, [__filename, 'child', folder, String(stallCount)], {
    env,
    encoding: 'utf8',
    timeout: 20000,
  });
  fs.rmSync(folder, { recursive: true, force: true });
  return (result.stdout || '').split('\n').filter(Boolean);
}
const stallLines = lines => lines.filter(line => /blocked ~\d+ ms/.test(line));
const profileLines = lines => lines.filter(line => line.includes('[tnai stall profile]'));

const plain = runChild('');
const stall = stallLines(plain)[0] || '';
console.log('plain run: ' + (stall || '(no stall line)'));
check(Number((stall.match(/blocked ~(\d+) ms/) || [])[1]) >= 100, 'the 300 ms wait is logged');
const mainCpu = Number((stall.match(/main thread CPU (\d+) ms/) || [])[1]);
check(Number.isFinite(mainCpu), 'the line says the main thread CPU');
check(mainCpu < 100, 'a wait shows as little main thread CPU (' + mainCpu + ' ms)');
check(!profileLines(plain).length, 'no profile line for the first stall when not set');
check(plain.includes('profile saved: false'), 'no profile runs or is saved before a stall');

// not set: the first stall turns the profile on, the second is named by it
const after = runChild('', 2);
const afterNamed = profileLines(after);
console.log('after a stall: ' + (afterNamed[0] || '(no profile line)').slice(0, 300));
check(stallLines(after).length === 2, 'both stalls are logged when not set');
check(afterNamed.length === 1, 'only the second stall has a profile line');
check(
  (afterNamed[0] || '').includes('blockForStallTest'),
  'the second stall names the function that held the thread'
);
check(after.includes('profile saved: true'), 'the profile of the second stall is saved');

// "0": never
const off = runChild('0', 2);
check(stallLines(off).length === 2, 'both stalls are logged with TNAI_STALL_PROFILE=0');
check(!profileLines(off).length, 'no profile line with TNAI_STALL_PROFILE=0');
check(off.includes('profile saved: false'), 'no profile saved with TNAI_STALL_PROFILE=0');

const profiled = runChild('1');
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
