/*
 * Technically Not tools · desktop-check/usage-cache-check.js — desktop/usage-stats.js keeps its
 * per-file reading on disk and reads only what was added to a transcript. Plain Node, no Electron.
 * Against a temp folder of small fake Claude Code + Codex transcripts, every way of getting the
 * records must give exactly what the old way (readline over the whole file, kept here as the
 * reference) gives: a full scan, a second run from the cache after a "restart" (the module loaded
 * fresh), lines added (a streamed message re-written across the join, a Codex turn that ends in the
 * added part, a last line with no newline yet), a file cut shorter, a file replaced by a longer
 * one, a deleted file, and a cache that is damaged, of another format or missing. Then one timing
 * on the real transcripts, READ-ONLY, with the cache in a temp file (never the app's settings
 * folder): file count, record count and ms only, never content. Run: node
 * tools/desktop-check/usage-cache-check.js [--before=2026-10-04T00:00:00Z] [--no-real]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-usage-cache-'));
const claudeRoot = path.join(tmp, 'claude'),
  codexRoot = path.join(tmp, 'codex'),
  proj = path.join(claudeRoot, 'proj'),
  cacheFile = path.join(tmp, 'settings', 'usage-cache.jsonl');
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(codexRoot, { recursive: true });
const now = Date.now(),
  iso = ms => new Date(ms).toISOString(),
  line = obj => JSON.stringify(obj) + '\n';

// ---- the old reading (usage-stats.js before 2026-10-05), the reference every case is compared
// with ----
async function oldClaude(file) {
  const byKey = new Map();
  for await (const l of readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })) {
    if (!l || !l.includes('"usage"')) continue;
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      continue;
    }
    if (j?.type !== 'assistant') continue;
    const m = j.message,
      u = m?.usage;
    if (!u || !m.id) continue;
    byKey.set(`${m.id}:${j.requestId || ''}`, {
      ts: Date.parse(j.timestamp) || Date.now(),
      model: m.model || '',
      cli: 'claude-code',
      sessionId: j.sessionId || '',
      cwd: j.cwd || '',
      input: u.input_tokens || 0,
      output: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
    });
  }
  return [...byKey.values()];
}
const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const codexTokens = u => ({
  input: Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)),
  output: u.output_tokens || 0,
  cacheRead: u.cached_input_tokens || 0,
  cacheWrite: u.cache_write_input_tokens || 0,
});

async function oldCodex(file) {
  const records = [];
  let model = '',
    sessionId = '',
    cwd = '',
    total = zero(),
    base = zero(),
    turnStart = 0,
    inTurn = false;
  for await (const l of readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })) {
    if (!l) continue;
    let j;
    try {
      j = JSON.parse(l);
    } catch {
      continue;
    }
    const ts = Date.parse(j.timestamp) || 0;
    if (j.type === 'session_meta') {
      sessionId = j.payload?.session_id || sessionId;
      cwd = j.payload?.cwd || cwd;
      continue;
    }
    if (j.type === 'turn_context') {
      if (j.payload?.model) model = j.payload.model;
      continue;
    }
    if (j.type !== 'event_msg' || !j.payload) continue;
    const p = j.payload;
    if (p.type === 'task_started') {
      base = total;
      turnStart = ts;
      inTurn = true;
      continue;
    }
    if (p.type === 'token_count' && p.info?.total_token_usage) {
      total = codexTokens(p.info.total_token_usage);
      continue;
    }
    if ((p.type === 'task_complete' || p.type === 'turn_aborted') && inTurn) {
      records.push({
        ts: ts || turnStart || Date.now(),
        model,
        cli: 'codex',
        sessionId,
        cwd,
        input: Math.max(0, total.input - base.input),
        output: Math.max(0, total.output - base.output),
        cacheRead: Math.max(0, total.cacheRead - base.cacheRead),
        cacheWrite: Math.max(0, total.cacheWrite - base.cacheWrite),
      });
      inTurn = false;
    }
  }
  return records;
}
const sorted = records =>
  records
    .map(r => JSON.stringify(r))
    .sort()
    .join('\n');

async function reference() {
  const out = [];
  for (const f of fs.readdirSync(proj)) out.push(...(await oldClaude(path.join(proj, f))));
  for (const f of fs.readdirSync(codexRoot)) out.push(...(await oldCodex(path.join(codexRoot, f))));
  return out;
}
const totals = records =>
  records.reduce((t, r) => t + r.input + r.output + r.cacheRead + r.cacheWrite, 0);

// ---- the module, loaded fresh = the app started again (its memory is empty, only the cache file
// is left) ----
const modPath = require.resolve('../../desktop/usage-stats');
let usage;
const restart = () => {
  delete require.cache[modPath];
  usage = require(modPath);
};

async function run(label, want) {
  const got = await usage.records(),
    ref = await reference(),
    scan = usage.lastScan();
  await usage.cacheSaved();
  check(
    sorted(got) === sorted(ref),
    label +
      ': the same records as reading every file whole the old way (' +
      got.length +
      ' records, ' +
      totals(got) +
      ' tokens)'
  );
  check(
    Object.keys(want).every(k => scan[k] === want[k]),
    label + ': files read ' + JSON.stringify(scan) + ', expected ' + JSON.stringify(want)
  );
}

// A later mtime than any before, so a changed file never looks unchanged on a coarse file clock.
let clock = now / 1000;
const touch = file => {
  clock += 5;
  fs.utimesSync(file, clock, clock);
};

// ---- fixtures ----
const msg = (id, req, at, usage, extra = {}) => ({
  type: 'assistant',
  timestamp: iso(now - at),
  sessionId: 's1',
  cwd: 'C:\\Users\\test\\Alpha',
  requestId: req,
  message: {
    id,
    model: 'claude-opus-5',
    usage: {
      input_tokens: usage[0],
      output_tokens: usage[1],
      cache_read_input_tokens: usage[2],
      cache_creation_input_tokens: usage[3],
    },
    ...extra,
  },
});
const fileA = path.join(proj, 'a.jsonl'),
  fileB = path.join(proj, 'b.jsonl'),
  fileC = path.join(codexRoot, 'rollout-one.jsonl'),
  fileD = path.join(codexRoot, 'rollout-two.jsonl');
fs.writeFileSync(
  fileA,
  line({
    type: 'user',
    timestamp: iso(now - 90000),
    message: { content: 'the word "usage" in a line that is not an assistant line' },
  }) +
    line(msg('m1', 'r1', 80000, [900, 150, 400, 80])) +
    // streamed: the same message again, larger
    line(msg('m1', 'r1', 79000, [1200, 300, 600, 150])) +
    '\n' +
    JSON.stringify(msg('m2', 'r2', 70000, [5000, 500, 0, 0])) +
    '\r\n' + // a CRLF line
    // readline broke this line in two, so the old reading never counted it
    line(msg('m3', 'r3', 60000, [70, 10, 5, 0], { note: 'a\u2028b' })) +
    line(msg('m4', 'r4', 50000, [2000, 400, 100, 50]))
);
fs.writeFileSync(
  fileB,
  line({
    ...msg('n1', 'q1', 40000, [10, 20, 30, 40]),
    sessionId: 's2',
    cwd: 'C:\\Users\\test\\Beta',
  })
);
const ev = (at, payload) => ({ type: 'event_msg', timestamp: iso(now - at), payload });
fs.writeFileSync(
  fileC,
  line({
    type: 'session_meta',
    timestamp: iso(now - 45000),
    payload: { session_id: 'cx1', cwd: 'C:\\Users\\test\\Gamma' },
  }) +
    line({ type: 'turn_context', timestamp: iso(now - 44000), payload: { model: 'codex-mini' } }) +
    line(ev(43000, { type: 'task_started' })) +
    line(
      ev(42000, {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 1000,
            cache_write_input_tokens: 200,
            output_tokens: 800,
          },
        },
      })
    ) +
    line(ev(41000, { type: 'task_complete' })) +
    line(ev(40000, { type: 'task_started' })) + // a turn still open when the file is first read
    line(
      ev(39000, {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 9000,
            cached_input_tokens: 3000,
            cache_write_input_tokens: 200,
            output_tokens: 1500,
          },
        },
      })
    )
);
fs.writeFileSync(
  fileD,
  line({
    type: 'session_meta',
    timestamp: iso(now - 30000),
    payload: { session_id: 'cx2', cwd: 'C:\\Users\\test\\Delta' },
  }) +
    line(ev(29000, { type: 'task_started' })) +
    line(
      ev(28000, {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 50 } },
      })
    ) +
    line(ev(27000, { type: 'turn_aborted' }))
);
for (const f of [fileA, fileB, fileC, fileD]) touch(f);

process.env.TNAI_USAGE_ROOTS = JSON.stringify({ claude: claudeRoot, codex: codexRoot });
process.env.TNAI_USAGE_CACHE = cacheFile;

(async () => {
  restart();
  await run('full scan, no cache yet', { full: 4, appended: 0, cached: 0, fromDisk: 0 });
  check(
    fs.existsSync(cacheFile) && !fs.existsSync(cacheFile + '.tmp'),
    'the cache file is written and no temp file is left'
  );
  check(
    !fs.readFileSync(cacheFile, 'utf8').includes('the word'),
    'the cache file holds no message text'
  );

  restart();
  await run('second run after a restart', { full: 0, appended: 0, cached: 4, fromDisk: 4 });

  // Lines added: m4 streamed again across the join, a new message, and a last line with no newline
  // yet; the open Codex turn ends.
  const m6 = JSON.stringify(msg('m6', 'r6', 8000, [333, 33, 3, 0]));
  fs.appendFileSync(
    fileA,
    line(msg('m4', 'r4', 10000, [2500, 900, 100, 50])) +
      line(msg('m5', 'r5', 9000, [40, 4, 0, 0])) +
      m6.slice(0, 60)
  );
  touch(fileA);
  fs.appendFileSync(
    fileC,
    line(
      ev(20000, {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 12000,
            cached_input_tokens: 4000,
            cache_write_input_tokens: 300,
            output_tokens: 2100,
          },
        },
      })
    ) + line(ev(19000, { type: 'task_complete' }))
  );
  touch(fileC);
  restart();
  await run('lines added, after a restart', { full: 0, appended: 2, cached: 2, fromDisk: 4 });
  fs.appendFileSync(fileA, m6.slice(60) + '\n');
  touch(fileA);
  await run('the unfinished last line gets its end (no restart)', {
    full: 0,
    appended: 1,
    cached: 3,
    fromDisk: 0,
  });
  check(
    (await usage.records()).some(r => r.input === 333),
    'the line that was unfinished is counted once it ends with a newline'
  );

  // Cut shorter, and replaced by a longer file with another start: both read whole.
  fs.writeFileSync(fileA, line(msg('m1', 'r1', 80000, [1200, 300, 600, 150])));
  touch(fileA);
  fs.writeFileSync(
    fileD,
    line({
      type: 'session_meta',
      timestamp: iso(now - 30000),
      payload: { session_id: 'cx9', cwd: 'C:\\Users\\test\\Other' },
    }) +
      line(ev(29000, { type: 'task_started' })) +
      line(
        ev(28000, {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 700, output_tokens: 70 } },
        })
      ) +
      line(ev(27000, { type: 'task_complete' })) +
      line(ev(26000, { type: 'task_started' })) +
      line(
        ev(25000, {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 900, output_tokens: 90 } },
        })
      ) +
      line(ev(24000, { type: 'task_complete' }))
  );
  touch(fileD);
  restart();
  await run('a file cut shorter and a file replaced', {
    full: 2,
    appended: 0,
    cached: 2,
    fromDisk: 4,
  });

  // A deleted transcript leaves the cache.
  fs.rmSync(fileB);
  restart();
  await run('a transcript deleted', { full: 0, appended: 0, cached: 3, fromDisk: 4 });
  check(
    !fs.readFileSync(cacheFile, 'utf8').includes('b.jsonl'),
    'the deleted transcript is gone from the cache file'
  );

  // A damaged cache never gives wrong numbers: one changed digit, a cut-off file, garbage, another
  // format, no file.
  const good = fs.readFileSync(cacheFile, 'utf8'),
    rows = good.split('\n');
  const at = rows.findIndex(r => r.includes('rollout-one'));
  fs.writeFileSync(
    cacheFile,
    rows
      .map((r, i) => (i === at ? r.replace(/"r":\[(\d)/, (m, d) => '"r":[' + ((+d + 1) % 10)) : r))
      .join('\n')
  );
  restart();
  await run('one cache line with a changed digit', {
    full: 1,
    appended: 0,
    cached: 2,
    fromDisk: 2,
  });
  fs.writeFileSync(cacheFile, good.slice(0, good.length - 40));
  restart();
  await run('a cache file cut off at the end', { full: 1, appended: 0, cached: 2, fromDisk: 2 });
  fs.writeFileSync(cacheFile, '\u0000\u0001 not a cache {{{');
  restart();
  await run('a cache file of garbage', { full: 3, appended: 0, cached: 0, fromDisk: 0 });
  fs.writeFileSync(
    cacheFile,
    fs.readFileSync(cacheFile, 'utf8').replace('"tnaiUsageCache":1', '"tnaiUsageCache":0')
  );
  restart();
  await run('a cache of another format', { full: 3, appended: 0, cached: 0, fromDisk: 0 });
  fs.rmSync(cacheFile);
  restart();
  await run('no cache file', { full: 3, appended: 0, cached: 0, fromDisk: 0 });

  // ---- the real transcripts, read-only: counts and ms, never content. The cache goes to the temp
  // folder. ----
  if (!process.argv.includes('--no-real')) {
    delete process.env.TNAI_USAGE_ROOTS;
    process.env.TNAI_USAGE_CACHE = path.join(tmp, 'real-cache.jsonl');
    const before =
      Date.parse((process.argv.find(a => a.startsWith('--before=')) || '').slice(9)) ||
      Date.now() - 86400000;
    const timed = async () => {
      restart();
      const t = Date.now(),
        r = await usage.records(),
        ms = Date.now() - t,
        scan = usage.lastScan();
      await usage.cacheSaved();
      return { ms, n: r.length, scan };
    };
    const first = await timed(),
      second = await timed();
    const files = first.scan.full + first.scan.appended + first.scan.cached;
    console.log(
      'info real transcripts, first run (no cache): ' +
        files +
        ' file(s) read, ' +
        first.n +
        ' record(s), ' +
        first.ms +
        ' ms'
    );
    console.log(
      'info real transcripts, second run (cache from disk): ' +
        JSON.stringify(second.scan) +
        ', ' +
        second.n +
        ' record(s), ' +
        second.ms +
        ' ms'
    );

    // Files nobody wrote to since `before`: their sums can be compared between two runs of this
    // script, or with the old reading.
    const stable = { files: 0, records: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const text = fs.readFileSync(process.env.TNAI_USAGE_CACHE, 'utf8');
    for (const row of text.split('\n').slice(1)) {
      if (!row) continue;
      const j = JSON.parse(row.slice(17));
      if (j.m >= before) continue;
      stable.files++;
      stable.records += j.r.length / 8;
      for (let i = 0; i < j.r.length; i += 8) {
        stable.input += j.r[i + 4];
        stable.output += j.r[i + 5];
        stable.cacheRead += j.r[i + 6];
        stable.cacheWrite += j.r[i + 7];
      }
    }
    console.log(
      'info real transcripts not changed since ' +
        iso(before) +
        ': ' +
        JSON.stringify(stable) +
        ', cache file ' +
        (text.length / 1048576).toFixed(1) +
        ' MB'
    );
    check(
      second.scan.full === 0 || second.scan.full < files / 20,
      'the second run reads almost no file whole (' + second.scan.full + ' of ' + files + ')'
    );
    check(
      second.ms < first.ms,
      'the second run is faster than the first (' + second.ms + ' ms against ' + first.ms + ' ms)'
    );
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.log('FAIL threw: ' + (e.stack || e));
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  process.exit(1);
});
