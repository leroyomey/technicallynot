/*
 * * Technically Not tools · terminal-capture-compare.js — Compares a terminal screen capture
 * * (110-terminal-capture.js, saved in %APPDATA%\TechnicallyNot.ai\captures\<date>_<panel>) with a
 * * replay of the pty output saved beside it, and prints the rows that differ. The replay runs in
 * the
 * * app's own terminal (10's createTerm, with its repeat removal) and in a plain xterm, through the
 * * desktop check `cli-screen-capture` with TNAI_CAPTURE set (one desktop check at a time, as
 * always);
 * * it writes replay-app.txt and replay-plain.txt into the capture folder. Rows "missing from the
 * * screen" are in the replay but not on the screen the user saw: that is the bug. Usage:
 * * node tools/terminal-capture-compare.js "<capture folder>" [--rows N] [--diff-only] --rows N
 * * compare the last N rows of each (default 400) --diff-only reuse the replay files already in the
 * * folder (no app run) Writes compare.txt into the folder. Exit code 0 when nothing differs, 1
 * when
 * * rows differ, 2 on a usage or replay error.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rowsOf = text => {
  const rows = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(r => r.replace(/\s+$/, ''));
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  return rows;
};

// Row diff of the last `limit` rows of each side (longest common subsequence). Returns { a, b,
// from: [aStart, bStart], hunks, differ }: each hunk is { kind: 'screen' | 'replay', at, text }
// with `at` the row number in that side's whole text.
function diffRows(screenText, replayText, limit = 400) {
  const A = rowsOf(screenText),
    B = rowsOf(replayText);
  const a0 = Math.max(0, A.length - limit),
    b0 = Math.max(0, B.length - limit),
    a = A.slice(a0),
    b = B.slice(b0);
  const n = a.length,
    m = b.length,
    w = m + 1,
    L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i * w + j] =
        a[i] === b[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const ops = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', ai: i, bj: j });
      i++;
      j++;
    } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) {
      ops.push({ kind: 'screen', ai: i });
      i++;
    } else {
      ops.push({ kind: 'replay', bj: j });
      j++;
    }
  }
  while (i < n) ops.push({ kind: 'screen', ai: i++ });
  while (j < m) ops.push({ kind: 'replay', bj: j++ });
  return { a, b, from: [a0, b0], ops, differ: ops.filter(o => o.kind !== 'same').length };
}

// Printable lines: each run of differing rows with one row of context around it.
function report(
  d,
  labels = { screen: 'only on the screen', replay: 'missing from the screen, in the replay' }
) {
  const out = [],
    { ops, a, b, from } = d,
    row = o => (o.kind === 'replay' ? b[o.bj] : a[o.ai]);
  const num = o =>
    o.kind === 'replay' ? 'replay row ' + (from[1] + o.bj) : 'screen row ' + (from[0] + o.ai);
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].kind === 'same') continue;
    const start = k;
    while (k < ops.length && ops[k].kind !== 'same') k++;
    out.push('');
    if (start > 0)
      out.push(
        '    ' + num(ops[start - 1]).padEnd(18) + '  ' + JSON.stringify(row(ops[start - 1]))
      );
    for (let x = start; x < k; x++)
      out.push(
        (ops[x].kind === 'replay' ? '  + ' : '  - ') +
          num(ops[x]).padEnd(18) +
          '  ' +
          JSON.stringify(row(ops[x])) +
          '   (' +
          labels[ops[x].kind] +
          ')'
      );
    if (k < ops.length)
      out.push('    ' + num(ops[k]).padEnd(18) + '  ' + JSON.stringify(row(ops[k])));
  }
  return out;
}

function compareFolder(folder, limit) {
  const read = f => {
    try {
      return fs.readFileSync(path.join(folder, f), 'utf8');
    } catch {
      return null;
    }
  };
  const screen = read('screen.txt'),
    meta = JSON.parse(read('capture.json') || '{}'),
    lines = [];
  lines.push(
    'Capture: ' + folder,
    'Captured ' +
      (meta.capturedLocal || meta.capturedAt || '?') +
      ' · ' +
      (meta.cli || '?') +
      (meta.cliVersion ? ' ' + meta.cliVersion : '') +
      ' · view: ' +
      (meta.views?.[0]?.where || '?') +
      ' ' +
      (meta.views?.[0]?.cols || '?') +
      '×' +
      (meta.views?.[0]?.rows || '?') +
      ' · pty ' +
      (meta.pty?.cols || '?') +
      '×' +
      (meta.pty?.rows || '?')
  );
  let differ = 0;
  for (const [file, label] of [
    ['replay-app.txt', "the app's terminal (with its repeat removal)"],
    ['replay-plain.txt', 'a plain xterm'],
  ]) {
    const replay = read(file);
    if (replay === null) {
      lines.push('', file + ': not there (run without --diff-only first)');
      continue;
    }
    const d = diffRows(screen, replay, limit);
    lines.push(
      '',
      '== Screen against a replay in ' +
        label +
        ' (' +
        file +
        '): last ' +
        d.a.length +
        ' screen rows, last ' +
        d.b.length +
        ' replay rows, ' +
        d.differ +
        ' rows differ',
      ...report(d)
    );
    if (file === 'replay-app.txt') differ = d.differ;
  }
  return { lines, differ };
}

if (require.main === module) {
  const args = process.argv.slice(2),
    folder = args.find(a => !a.startsWith('--') && !/^\d+$/.test(a));
  const at = args.indexOf('--rows'),
    limit = at >= 0 ? Math.max(20, Number(args[at + 1]) || 400) : 400;
  if (
    !folder ||
    !fs.existsSync(path.join(folder, 'capture.json')) ||
    !fs.existsSync(path.join(folder, 'pty-tail.log'))
  ) {
    console.error(
      'Usage: node tools/terminal-capture-compare.js "<capture folder>" [--rows N] [--diff-only]\nThe folder is the one the capture named (it holds capture.json, screen.txt and pty-tail.log).'
    );
    process.exit(2);
  }
  const abs = path.resolve(folder);
  if (!args.includes('--diff-only')) {
    console.log(
      'Replaying the saved output in the app (desktop check cli-screen-capture; it waits for any other desktop check to finish)…'
    );
    const run = spawnSync(
      process.execPath,
      [path.join(__dirname, 'desktop-check', 'check.js'), 'cli-screen-capture'],
      { stdio: 'inherit', env: { ...process.env, TNAI_CAPTURE: abs } }
    );
    if (run.status !== 0 || !fs.existsSync(path.join(abs, 'replay-app.txt'))) {
      console.error('The replay did not finish (exit ' + run.status + ').');
      process.exit(2);
    }
  }
  const { lines, differ } = compareFolder(abs, limit);
  fs.writeFileSync(path.join(abs, 'compare.txt'), lines.join('\n') + '\n');
  console.log(lines.join('\n') + '\n\nWritten to ' + path.join(abs, 'compare.txt'));
  process.exit(differ ? 1 : 0);
}

module.exports = { diffRows, report, compareFolder, rowsOf };
