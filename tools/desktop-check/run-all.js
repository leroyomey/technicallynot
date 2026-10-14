// Runs every desktop-check test once, one at a time (check.js holds the machine-wide lock), and
// writes a short summary. Usage: node tools/desktop-check/run-all.js [--only a,b] [--from NAME]
// (from the project folder) Results: %TEMP%\tnai-check-results\summary.txt (+ NAME.log for each
// failure). 8-min cap per test. real-preview starts a real Claude Code agent (costs usage): leave
// it out unless it is needed.
const { spawnSync } = require('child_process');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const dir = path.join(__dirname, 'tests');
const out = path.join(os.tmpdir(), 'tnai-check-results');
fs.mkdirSync(out, { recursive: true });
let tests = fs
  .readdirSync(dir)
  .filter(f => f.endsWith('.js') && !f.endsWith('.main.js') && !/\.after\d*\.js$/.test(f))
  .map(f => f.slice(0, -3))
  .sort(); // .after tests are the second half of their parent test
const only = process.argv.indexOf('--only');
if (only > 0) tests = process.argv[only + 1].split(',');
const from = process.argv.indexOf('--from');
if (from > 0) tests = tests.slice(Math.max(0, tests.indexOf(process.argv[from + 1])));
const summary = path.join(out, 'summary.txt');
for (const t of tests) {
  const start = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, 'check.js'), t], {
    encoding: 'utf8',
    timeout: 8 * 60 * 1000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = (r.stdout || '') + (r.stderr || '');
  const pass = /DESKTOP CHECK: PASS/.test(text) && r.status === 0;
  const secs = Math.round((Date.now() - start) / 1000);
  if (!pass) fs.writeFileSync(path.join(out, t + '.log'), text);
  const fails = text
    .split(/\r?\n/)
    .filter(l => /^FAIL|Uncaught|RESULT: FAIL|timed out/i.test(l))
    .slice(0, 5)
    .join(' | ');
  fs.appendFileSync(
    summary,
    (pass ? 'PASS ' : 'FAIL ') +
      t +
      ' (' +
      secs +
      's)' +
      (pass ? '' : (r.error ? ' ERROR ' + r.error.code : '') + ' ' + fails.slice(0, 400)) +
      '\n'
  );
  console.log((pass ? 'PASS ' : 'FAIL ') + t + ' (' + secs + 's)');
}
fs.appendFileSync(summary, 'DONE ' + new Date().toISOString() + '\n');
console.log('Summary: ' + summary);
