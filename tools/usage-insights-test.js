/*
 * Technically Not · tools/usage-insights-test.js — checks desktop/usage-insights.js (Settings ›
 * Insights) in plain Node, with no window and none of this PC's real logs:
 * - the pure part: days, hours, models, projects, top threads, cache share, busiest five hours,
 * the three tips and their limits, model names and titles;
 * - the whole IPC answer over a made-up Claude Code folder and task-learning folder in a temp
 * directory (TNAI_USAGE_ROOTS), including a conversation's title read from its first prompt.
 * Run: node tools/usage-insights-test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

const insights = require('../desktop/usage-insights');

const HOUR = 3600e3;
const MIN = 60e3;

// A fixed "now": 2026-10-28 18:00 local time.
const now = new Date(2026, 9, 28, 18, 0, 0).getTime();
const at = (daysBack, hour, minute = 0) => {
  const d = new Date(2026, 9, 28 - daysBack, hour, minute, 0);
  return d.getTime();
};
const record = (ts, extra = {}) => ({
  ts,
  cli: 'claude-code',
  model: 'claude-opus-5-5',
  sessionId: 'sessionA1',
  cwd: 'C:\\work\\Project TN.ai',
  input: 100,
  output: 200,
  cacheRead: 700,
  cacheWrite: 0,
  ...extra,
});

check('model names read as people say them', () => {
  assert.strictEqual(insights.prettyModel('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(insights.prettyModel('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.strictEqual(insights.prettyModel('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.strictEqual(insights.prettyModel('gpt-5.5'), 'gpt-5.5');
});

check('titles lose this app\u2019s prefixes', () => {
  assert.strictEqual(
    insights.cleanTitle('[TN.ai] Task from Lead: Summary: Build the page'),
    'Build the page'
  );
  assert.strictEqual(insights.cleanTitle('  fix   the bug '), 'fix the bug');
});

check('90 days, oldest first, today last, counted like Settings › Usage', () => {
  const days = insights.build(
    [
      record(at(0, 14)),
      record(at(0, 15), {
        model: 'claude-sonnet-5-5',
        sessionId: 'sessionB2',
        cwd: 'C:\\x\\Pinball',
      }),
      record(at(1, 9)),
      record(at(120, 9)),
    ],
    now
  );
  assert.strictEqual(days.length, 90);
  const today = days[89];
  assert.strictEqual(today.date, '2026-10-28');
  assert.strictEqual(today.weekday, new Date(2026, 9, 28).getDay());

  // input + output + cache writes, never cache reads
  assert.strictEqual(today.total, 600);
  assert.strictEqual(today.hours[14], 300);
  assert.strictEqual(today.hours[15], 300);
  assert.deepStrictEqual(today.models, { 'Opus 5.5': 300, 'Sonnet 5.5': 300 });
  assert.deepStrictEqual(today.projects, { 'Project TN.ai': 300, Pinball: 300 });
  assert.strictEqual(today.threads.length, 2);
  assert.ok(
    Math.abs(today.cacheShare - 0.875) < 1e-9,
    'cache share = read / (input + read + write)'
  );
  assert.strictEqual(days[88].total, 300);
  assert.strictEqual(
    days.reduce((sum, day) => sum + day.total, 0),
    900,
    'a record older than 90 days is left out'
  );
});

check('the busiest five hours', () => {
  const peak = insights.busiestFiveHours([
    record(at(0, 1), { output: 1000 }),
    record(at(0, 9), { output: 500 }),
    record(at(0, 12), { output: 500 }),
    record(at(0, 15), { output: 500 }),
  ]);
  assert.strictEqual(peak.start, at(0, 9));

  // two answers of 100 in + 500 out inside five hours beat the lone 1,100 at 1 am
  assert.strictEqual(peak.tokens, 2 * 600);
});

check('no tips on a quiet week', () => {
  assert.deepStrictEqual(insights.tips([record(at(1, 10))], [], now), []);
});

check('tip: compact long conversations earlier', () => {
  const list = [];
  for (const id of ['sessionLong1', 'sessionLong2'])
    for (let i = 0; i < 6; i++)
      list.push(
        record(at(2, 10, i), { sessionId: id, input: 1000, cacheRead: 40000 * i, output: 500 })
      );
  const found = insights.tips(list, [], now);
  const tip = found.find(item => item.key === 'compact');
  assert.ok(tip, 'two conversations past 150k give the tip');
  assert.strictEqual(tip.cases, 2);
  assert.ok(tip.share > 0.02 && tip.share < 1);
  assert.strictEqual(tip.threads.length, 2);

  const one = list.filter(item => item.sessionId === 'sessionLong1');
  assert.ok(!insights.tips(one, [], now).some(item => item.key === 'compact'), 'one is not enough');
});

check('tip: breaks cost a full re-read', () => {
  const list = [];
  let ts = at(3, 9);
  for (let i = 0; i < 4; i++) {
    list.push(record(ts, { sessionId: 'sessionBreak', cacheRead: 40000, cacheWrite: 1000 }));
    ts += 20 * MIN;
    list.push(record(ts, { sessionId: 'sessionBreak', cacheRead: 1000, cacheWrite: 40000 }));
    ts += MIN;
  }
  const tip = insights.tips(list, [], now).find(item => item.key === 'breaks');
  assert.ok(tip, 'four rewrites after a pause give the tip');
  assert.strictEqual(tip.cases, 4);
  assert.ok(tip.share > 0.5, 'the rewrites are most of that week');

  // the same answers a minute apart are no break
  const close = list.map((item, i) => ({ ...item, ts: at(3, 9) + i * MIN }));
  assert.ok(!insights.tips(close, [], now).some(item => item.key === 'breaks'));
});

check('tip: a smaller model for small jobs', () => {
  const tasks = [];
  for (let i = 0; i < 6; i++)
    tasks.push({
      at: at(1, 10, i),
      agent: 'Lead',
      model: 'claude-opus-5-5',
      ms: 40000,
      tokens: 9000,
    });
  tasks.push({ at: at(1, 12), agent: 'Nova', model: 'claude-opus-5-5', ms: 900000, tokens: 50000 });
  tasks.push({ at: at(20, 12), agent: 'Old', model: 'claude-opus-5-5', ms: 1000, tokens: 50000 });
  const tip = insights.tips([], tasks, now).find(item => item.key === 'model');
  assert.ok(tip);
  assert.strictEqual(tip.cases, 6, 'only short tasks of the last 7 days');
  assert.strictEqual(tip.model, 'Opus 5.5');
  assert.deepStrictEqual(tip.threads, [{ title: 'Lead', tasks: 6, tokens: 54000 }]);
  assert.ok(Math.abs(tip.share - 54000 / 104000) < 1e-9);
});

check('at most three tips, the largest share first', () => {
  const list = [];
  let ts = at(3, 9);
  for (let i = 0; i < 4; i++) {
    list.push(record(ts, { sessionId: 'sessionBreak', cacheRead: 40000, cacheWrite: 1000 }));
    ts += 20 * MIN;
    list.push(record(ts, { sessionId: 'sessionBreak', cacheRead: 1000, cacheWrite: 40000 }));
    ts += MIN;
  }
  for (const id of ['sessionLong1', 'sessionLong2'])
    for (let i = 0; i < 6; i++)
      list.push(record(at(2, 10, i), { sessionId: id, cacheRead: 40000 * i }));
  const tasks = Array.from({ length: 6 }, (_, i) => ({
    at: at(1, 10, i),
    model: 'claude-opus-5-5',
    ms: 1000,
    tokens: 10,
  }));
  const found = insights.tips(list, tasks, now);
  assert.strictEqual(found.length, 3);
  for (let i = 1; i < found.length; i++) assert.ok(found[i - 1].share >= found[i].share);
});

// ---------- the whole answer over made-up folders ----------

async function wholeAnswer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-insights-'));
  const claude = path.join(root, 'claude');
  const project = path.join(claude, 'C--work-demo');
  fs.mkdirSync(project, { recursive: true });
  const id = 'abc12345-0000-4000-8000-000000000001';
  const stamp = new Date().toISOString();
  const lines = [
    {
      type: 'user',
      sessionId: id,
      timestamp: stamp,
      message: { role: 'user', content: '[TN.ai] Task from Lead: Summary: Make the demo page' },
    },
    {
      type: 'assistant',
      sessionId: id,
      cwd: 'C:\\work\\demo',
      timestamp: stamp,
      requestId: 'r1',
      message: {
        id: 'm1',
        model: 'claude-opus-5-5',
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
      },
    },
  ];
  fs.writeFileSync(
    path.join(project, id + '.jsonl'),
    lines.map(line => JSON.stringify(line)).join('\n') + '\n'
  );
  const userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(userData, 'task-learning'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'task-learning', 'x.jsonl'),
    JSON.stringify({ at: Date.now(), model: 'claude-opus-5-5', ms: 1000, tokens: 5 }) +
      '\nnot json\n'
  );

  process.env.TNAI_USAGE_ROOTS = JSON.stringify({ claude, codex: path.join(root, 'none') });
  const usage = require('../desktop/usage-stats');
  const answer = await insights.insights(usage, userData);
  assert.strictEqual(answer.days.length, 90);
  assert.strictEqual(answer.days[89].total, 70);
  assert.deepStrictEqual(
    answer.days[89].threads.map(thread => thread.id),
    [id]
  );
  assert.strictEqual(answer.tasksMeasured, 1, 'a broken line is skipped');
  assert.ok(answer.sources.some(source => source.cli === 'claude-code' && source.found));
  assert.ok(
    !answer.sources.some(source => source.cli === 'opencode'),
    'test roots read no OpenCode'
  );

  const named = await insights.titles([id, '../etc/passwd', 'x']);
  assert.deepStrictEqual(named, [{ id, title: 'Make the demo page' }], 'unsafe ids are dropped');
  fs.rmSync(root, { recursive: true, force: true });
  passed++;
  console.log('ok  the whole IPC answer over made-up folders');
}

wholeAnswer()
  .then(() => console.log(`\n${passed} checks passed`))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
