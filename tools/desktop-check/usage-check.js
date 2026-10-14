/*
 * Technically Not tools · desktop-check/usage-check.js — desktop/usage-stats.js in plain Node
 * against fake Claude Code + Codex log fixtures: dedupe of a streamed (repeated) message, an old
 * file (mtime > 95 days) that must be skipped, and a missing root reporting found:false. Then runs
 * once against the real home dirs and times it (counts only, no transcript contents). No Electron.
 * Usage: node tools/desktop-check/usage-check.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let ok = true;
const check = (cond, label, extra) => {
  console.log(
    (cond ? 'ok   ' : 'FAIL ') + label + (extra !== undefined ? '  (' + extra + ')' : '')
  );
  if (!cond) ok = false;
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-usage-'));
const claudeRoot = path.join(tmp, 'claude');
const codexRoot = path.join(tmp, 'codex');
const projDir = path.join(claudeRoot, 'myproj');
fs.mkdirSync(projDir, { recursive: true });
fs.mkdirSync(codexRoot, { recursive: true });

const now = Date.now();
const iso = ms => new Date(ms).toISOString();
const line = obj => JSON.stringify(obj) + '\n';

// ---- Claude Code fixture: sessions s1 and s2 ----
const claudeLines = []

  // m1/r1 streamed: a partial write, then the final (larger) usage for the same id+requestId — only
  // the final one must count.
  .concat(
    line({
      type: 'assistant',
      timestamp: iso(now - 30000),
      sessionId: 's1',
      cwd: 'C:\\Users\\test\\ProjectAlpha',
      requestId: 'r1',
      message: {
        id: 'm1',
        model: 'claude-opus-5',
        usage: {
          input_tokens: 900,
          output_tokens: 150,
          cache_read_input_tokens: 400,
          cache_creation_input_tokens: 80,
        },
      },
    })
  )
  .concat(
    line({
      type: 'assistant',
      timestamp: iso(now - 29000),
      sessionId: 's1',
      cwd: 'C:\\Users\\test\\ProjectAlpha',
      requestId: 'r1',
      message: {
        id: 'm1',
        model: 'claude-opus-5',
        usage: {
          input_tokens: 1200,
          output_tokens: 300,
          cache_read_input_tokens: 600,
          cache_creation_input_tokens: 150,
        },
      },
    })
  )

  // m2/r2: context (input+cacheRead+cacheWrite) = 160000.
  .concat(
    line({
      type: 'assistant',
      timestamp: iso(now - 20000),
      sessionId: 's1',
      cwd: 'C:\\Users\\test\\ProjectAlpha',
      requestId: 'r2',
      message: {
        id: 'm2',
        model: 'claude-opus-5',
        usage: {
          input_tokens: 160000,
          output_tokens: 500,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    })
  )

  // m3/r3: context = 75000.
  .concat(
    line({
      type: 'assistant',
      timestamp: iso(now - 10000),
      sessionId: 's1',
      cwd: 'C:\\Users\\test\\ProjectAlpha',
      requestId: 'r3',
      message: {
        id: 'm3',
        model: 'claude-opus-5',
        usage: {
          input_tokens: 70000,
          output_tokens: 100,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 0,
        },
      },
    })
  )

  // m4/r4: a second, unrelated session — never crosses the threshold.
  .concat(
    line({
      type: 'assistant',
      timestamp: iso(now - 5000),
      sessionId: 's2',
      cwd: 'C:\\Users\\test\\ProjectBeta',
      requestId: 'r4',
      message: {
        id: 'm4',
        model: 'claude-sonnet-5',
        usage: {
          input_tokens: 2000,
          output_tokens: 400,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
        },
      },
    })
  );
fs.writeFileSync(path.join(projDir, 'sessionA.jsonl'), claudeLines.join(''));

// An old file (mtime 100 days ago): must be counted in sources[].files but excluded from every
// aggregate.
const oldFile = path.join(projDir, 'sessionOld.jsonl');
fs.writeFileSync(
  oldFile,
  line({
    type: 'assistant',
    timestamp: iso(now - 100 * 86400000),
    sessionId: 'sOld',
    cwd: 'C:\\Users\\test\\ProjectOld',
    requestId: 'rOld',
    message: {
      id: 'mOld',
      model: 'claude-opus-5',
      usage: {
        input_tokens: 999999,
        output_tokens: 999999,
        cache_read_input_tokens: 999999,
        cache_creation_input_tokens: 999999,
      },
    },
  })
);
const old = now - 100 * 86400000;
fs.utimesSync(oldFile, old / 1000, old / 1000);

// ---- Codex fixture: one session, one turn ----
const codexLines = []
  .concat(
    line({
      type: 'session_meta',
      timestamp: iso(now - 15000),
      payload: { session_id: 'cx1', cwd: 'C:\\Users\\test\\ProjectGamma' },
    })
  )
  .concat(
    line({ type: 'turn_context', timestamp: iso(now - 14000), payload: { model: 'codex-mini' } })
  )
  .concat(
    line({ type: 'event_msg', timestamp: iso(now - 13000), payload: { type: 'task_started' } })
  )
  .concat(
    line({
      type: 'event_msg',
      timestamp: iso(now - 12000),
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 5000,
            cached_input_tokens: 1000,
            cache_write_input_tokens: 200,
            output_tokens: 800,
          },
        },
      },
    })
  )
  .concat(
    line({
      type: 'event_msg',
      timestamp: iso(now - 11000),
      payload: { type: 'task_complete', last_agent_message: 'done' },
    })
  );
fs.writeFileSync(path.join(codexRoot, 'rollout-test-abc123.jsonl'), codexLines.join(''));

process.env.TNAI_USAGE_ROOTS = JSON.stringify({ claude: claudeRoot, codex: codexRoot });
const usage = require('../../desktop/usage-stats');

(async () => {
  const r = await usage.stats();

  // sources
  const claudeSrc = r.sources.find(s => s.cli === 'claude-code'),
    codexSrc = r.sources.find(s => s.cli === 'codex');
  check(
    claudeSrc && claudeSrc.found === true && claudeSrc.files === 2,
    'claude source found, both files counted (incl. the old one)',
    JSON.stringify(claudeSrc)
  );
  check(
    codexSrc && codexSrc.found === true && codexSrc.files === 1,
    'codex source found, 1 file counted',
    JSON.stringify(codexSrc)
  );

  // models: dedupe proven by opus turns === 3 (not 4) and its exact token sum
  const opus = r.models.find(m => m.model === 'claude-opus-5'),
    sonnet = r.models.find(m => m.model === 'claude-sonnet-5'),
    mini = r.models.find(m => m.model === 'codex-mini');
  check(
    !!opus && opus.turns === 3 && opus.tokens === 232250,
    'claude-opus-5: 3 turns, 232250 tokens (streamed duplicate deduped)',
    JSON.stringify(opus)
  );
  check(
    !!sonnet && sonnet.turns === 1 && sonnet.tokens === 2450,
    'claude-sonnet-5: 1 turn, 2450 tokens',
    JSON.stringify(sonnet)
  );
  check(
    !!mini && mini.turns === 1 && mini.tokens === 5000,
    'codex-mini: 1 turn, 5000 tokens',
    JSON.stringify(mini)
  );
  check(r.models[0] === opus, 'models sorted desc by tokens (opus first)');
  check(
    !r.models.some(m => m.model === '<synthetic>'),
    'old file (999999 tokens) never surfaces — it is excluded by the 95-day skip'
  );

  // sessions (last 30 days): s1 (3 turns), s2 (1 turn), cx1 (1 turn)
  check(r.sessions.count === 3, 'sessions.count === 3', r.sessions.count);
  check(close(r.sessions.avgTurns, 5 / 3), 'sessions.avgTurns === 5/3', r.sessions.avgTurns);
  check(
    r.sessions.longest.turns === 3 && r.sessions.longest.peakContext === 160000,
    'longest session: 3 turns, peakContext 160000',
    JSON.stringify(r.sessions.longest)
  );

  // cache (last 30 days)
  check(
    r.cache.read === 6700 && r.cache.write === 400,
    'cache.read 6700, cache.write 400',
    JSON.stringify(r.cache)
  );
  check(
    close(r.cache.hitRate, 6700 / 244300),
    'cache.hitRate === read/(read+write+input)',
    r.cache.hitRate
  );

  // projects (last 30 days, top 8, folder basenames)
  const alpha = r.projects.find(p => p.name === 'ProjectAlpha'),
    gamma = r.projects.find(p => p.name === 'ProjectGamma'),
    beta = r.projects.find(p => p.name === 'ProjectBeta');
  check(!!alpha && alpha.tokens === 232250, 'projects: ProjectAlpha 232250', JSON.stringify(alpha));
  check(!!gamma && gamma.tokens === 5000, 'projects: ProjectGamma 5000', JSON.stringify(gamma));
  check(!!beta && beta.tokens === 2450, 'projects: ProjectBeta 2450', JSON.stringify(beta));

  // hours: sum across all 24 buckets equals total tokens (exact bucket depends on the wall-clock
  // hour, so sum is the stable assertion)
  const hoursSum = r.hours.reduce((a, b) => a + b, 0);
  check(
    r.hours.length === 24 && hoursSum === 232250 + 2450 + 5000,
    'hours: 24 buckets, summing to the total tokens',
    hoursSum
  );

  // days: 90 entries, oldest first, today (last entry) holds every fixture record
  check(r.days.length === 90, 'days: 90 entries', r.days.length);
  const today = r.days[r.days.length - 1];
  const todayDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
  check(
    today.date === todayDate,
    'last day entry is today (local)',
    today.date + ' vs ' + todayDate
  );
  check(
    today.input === 237200 &&
      today.output === 2100 &&
      today.cacheWrite === 400 &&
      today.cacheRead === 6700 &&
      today.turns === 5 &&
      today.sessions === 3,
    'today bucket totals exact',
    JSON.stringify(today)
  );
  check(
    r.days[0].turns === 0 && r.days[0].sessions === 0,
    'oldest day entry is zero-filled',
    JSON.stringify(r.days[0])
  );

  // missing codex root → found:false
  process.env.TNAI_USAGE_ROOTS = JSON.stringify({
    claude: claudeRoot,
    codex: path.join(tmp, 'does-not-exist'),
  });
  const r2 = await usage.stats();
  const codexSrc2 = r2.sources.find(s => s.cli === 'codex');
  check(
    codexSrc2.found === false && codexSrc2.files === 0,
    'missing codex root reports found:false, files:0',
    JSON.stringify(codexSrc2)
  );

  // OpenCode: one record per answer from its database (tables as in opencode 1.18.35), only when
  // the roots name one.
  check(
    !r.sources.some(s => s.cli === 'opencode') && !r.models.some(m => m.cli === 'opencode'),
    'test roots without an OpenCode database read none'
  );
  const ocFile = path.join(tmp, 'opencode.db'),
    { DatabaseSync } = require('node:sqlite'),
    odb = new DatabaseSync(ocFile);
  odb.exec(
    'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_created INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);'
  );
  odb
    .prepare('INSERT INTO session VALUES (?, ?, NULL, ?)')
    .run('ses_o1', 'C:/work/ocproj', now - 9000);
  const answer = (id, at, tokens, more = {}) =>
    odb.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
      id,
      'ses_o1',
      at,
      at + 50,
      JSON.stringify({
        role: 'assistant',
        parentID: 'msg_u',
        modelID: 'big-pickle',
        providerID: 'opencode',
        cost: 0.25,
        tokens,
        time: { created: at, completed: at + 50 },
        ...more,
      })
    );
  odb
    .prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
    .run(
      'msg_u',
      'ses_o1',
      now - 8000,
      now - 8000,
      JSON.stringify({ role: 'user', time: { created: now - 8000 } })
    );
  answer(
    'msg_a1',
    now - 7000,
    { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 40 } },
    { finish: 'tool-calls' }
  );
  answer(
    'msg_a2',
    now - 6000,
    { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    { error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }
  );
  odb.close();
  process.env.TNAI_USAGE_ROOTS = JSON.stringify({
    claude: claudeRoot,
    codex: codexRoot,
    opencode: ocFile,
  });
  const r3 = await usage.stats(),
    ocModel = r3.models.find(m => m.cli === 'opencode'),
    ocSrc = r3.sources.find(s => s.cli === 'opencode');
  check(
    !!ocSrc && ocSrc.found === true && ocSrc.files === 1,
    'opencode source found',
    JSON.stringify(ocSrc)
  );
  check(
    !!ocModel &&
      ocModel.model === 'opencode/big-pickle' &&
      ocModel.turns === 1 &&
      ocModel.tokens === 1290,
    'opencode/big-pickle: 1 answer, 1290 tokens (input + output + reasoning + cache written); the interrupted answer without tokens is no record',
    JSON.stringify(ocModel)
  );
  check(
    r3.sessions.count === r.sessions.count + 1 &&
      r3.allProjects.some(p => p.name === 'ocproj' && p.tokens === 1290),
    'its session and project folder are counted'
  );

  // the same answer written again with its final numbers, and a new one: read from where the last
  // reading stopped
  const w = new DatabaseSync(ocFile);
  w.prepare('UPDATE message SET time_updated = ?, data = ? WHERE id = ?').run(
    now - 5000,
    JSON.stringify({
      role: 'assistant',
      modelID: 'big-pickle',
      providerID: 'opencode',
      cost: 0.5,
      tokens: { input: 1000, output: 400, reasoning: 50, cache: { read: 300, write: 40 } },
      finish: 'tool-calls',
    }),
    'msg_a1'
  );
  w.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
    'msg_a3',
    'ses_o1',
    now - 4000,
    now - 4000,
    JSON.stringify({
      role: 'assistant',
      modelID: 'big-pickle',
      providerID: 'opencode',
      cost: 0.1,
      tokens: { input: 10, output: 5 },
      finish: 'stop',
    })
  );
  w.close();
  const ocModel2 = (await usage.stats()).models.find(m => m.cli === 'opencode');
  check(
    !!ocModel2 && ocModel2.turns === 2 && ocModel2.tokens === 1490 + 15,
    'a rewritten answer replaces its record and a new one is added: 2 answers, 1505 tokens',
    JSON.stringify(ocModel2)
  );
  const sent = await usage.records();
  check(
    sent.length > 0 && !sent.some(x => x.cli === 'opencode'),
    'records() stays Claude Code and Codex only, without OpenCode'
  );

  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- real home dirs: timing + counts only, never transcript contents ----
  delete process.env.TNAI_USAGE_ROOTS;
  const t0 = Date.now();
  const real = await usage.stats();
  const ms = Date.now() - t0;
  console.log(
    `real data: claude ${real.sources[0].files} file(s) found=${real.sources[0].found}, codex ${real.sources[1].files} file(s) found=${real.sources[1].found}, opencode found=${!!real.sources[2]?.found} ${real.models.filter(m => m.cli === 'opencode').reduce((n, m) => n + m.turns, 0)} answer(s), ${real.models.length} model(s), ${real.sessions.count} session(s) (30d) — ${ms}ms`
  );
  check(ms < 60000, 'real-data run completes in under 60s', ms + 'ms');

  console.log(ok ? 'OK: all usage-stats checks passed' : 'FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.log('FAIL threw:', e.stack || e);
  process.exit(1);
});
