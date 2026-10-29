/*
 * Technically Not desktop · usage-insights.js — Settings › Insights
 * (src/scripts/197-usage-insights.js, mockup docs/plans/design-concepts/usage-insights.html, round
 * B7): the account's token use day by day, for comparing two days, looking at one day up close, and
 * at most three ways to use fewer tokens.
 *
 * Real data only, all of it already on this PC:
 * - every per-answer (Claude Code, OpenCode) or per-turn (Codex) token record that usage-stats.js
 * reads from the agent tools' own logs (`allRecords`);
 * - the finished tasks task-learning.js keeps (userData/task-learning/*.jsonl: time, tokens,
 * model). Nothing is sent anywhere and nothing is written. "Tokens" means what Settings › Usage
 * counts: input + output + cache writes, never cache reads.
 *
 * The pure part (`build`, `tips`, `prettyModel`, `cleanTitle`) is tested by
 * tools/usage-insights-test.js; `insights` and `titles` are the two IPC answers (main.js).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { claudeHead, HEAD } = require('./thread-list');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Days shown in the calendar and offered in Compare.
const DAYS = 90;

// The threads kept per day for "The threads that used the most".
const TOP_THREADS = 8;

// Tips look at this many days back.
const TIP_DAYS = 7;

// Tip 1: a conversation this large is heavy; compacting near SOFT would have kept it smaller.
const HEAVY = 150000;
const SOFT = 100000;

// Tip 2: an answer after a pause this long that wrote at least half its conversation to the cache
// again (the saved copy had run out).
const BREAK_MS = 5 * 60 * 1000;
const REWRITE_SHARE = 0.5;
const REWRITE_MIN = 20000;

// Tip 3: a task this short on the largest model.
const SHORT_MS = 2 * 60 * 1000;

// A tip shows only when it rests on at least this many cases and its share reaches this much.
const MIN_CASES = { compact: 2, breaks: 3, model: 5 };
const MIN_SHARE = 0.02;

// ---------- small helpers ----------

const tokensOf = record => record.input + record.output + record.cacheWrite;
const contextOf = record => record.input + record.cacheRead + record.cacheWrite;

function localDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function projectName(cwd) {
  return cwd ? path.basename(cwd) || cwd : '';
}

// "claude-opus-4-1-20250805" → "Opus 4.1"; any other model id stays as the tool wrote it.
function prettyModel(id) {
  const match = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d))?(?:-\d{8})?$/i.exec(id || '');
  if (!match) return id || '';
  const family = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
  return family + ' ' + match[2] + (match[3] ? '.' + match[3] : '');
}

// The first prompt of a conversation as a short title: this app's own prefixes taken off.
function cleanTitle(text) {
  return String(text || '')
    .replace(/^\[(TN\.ai|TechnicallyNot\.ai)\]\s*/i, '')
    .replace(/^(New task|Task from [^:]{1,40}):\s*/i, '')
    .replace(/^Summary:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

// The heaviest five hours that start inside one day: { tokens, start } (start in ms, 0 when none).
function busiestFiveHours(records) {
  const list = records.slice().sort((a, b) => a.ts - b.ts);
  let best = { tokens: 0, start: 0 };
  let sum = 0;
  let from = 0;
  for (let to = 0; to < list.length; to++) {
    sum += tokensOf(list[to]);
    while (list[to].ts - list[from].ts >= 5 * HOUR_MS) {
      sum -= tokensOf(list[from]);
      from++;
    }
    if (sum > best.tokens) best = { tokens: sum, start: list[from].ts };
  }
  return best;
}

// ---------- the days ----------

// records → the last DAYS days, oldest first, each with its hours, models, projects and top
// threads.
function build(records, now = Date.now()) {
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (DAYS - 1));
  const firstMs = first.getTime();

  const byDate = new Map();
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(first);
    d.setDate(first.getDate() + i);
    const day = {
      date: localDate(d.getTime()),
      weekday: d.getDay(),
      total: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      answers: 0,
      hours: new Array(24).fill(0),
      models: {},
      projects: {},
      threads: new Map(),
      records: [],
    };
    byDate.set(day.date, day);
    days.push(day);
  }

  for (const record of records) {
    if (!(record.ts >= firstMs) || record.ts > now) continue;
    const day = byDate.get(localDate(record.ts));
    if (!day) continue;
    const tokens = tokensOf(record);
    day.total += tokens;
    day.input += record.input;
    day.output += record.output;
    day.cacheRead += record.cacheRead;
    day.cacheWrite += record.cacheWrite;
    day.answers += 1;
    day.hours[new Date(record.ts).getHours()] += tokens;
    if (record.model && record.model !== '<synthetic>') {
      const model = prettyModel(record.model);
      day.models[model] = (day.models[model] || 0) + tokens;
    }
    const project = projectName(record.cwd);
    if (project) day.projects[project] = (day.projects[project] || 0) + tokens;
    if (record.sessionId) {
      const key = record.cli + ':' + record.sessionId;
      let thread = day.threads.get(key);
      if (!thread) {
        thread = { id: record.sessionId, cli: record.cli, project, tokens: 0 };
        day.threads.set(key, thread);
      }
      thread.tokens += tokens;
    }
    day.records.push(record);
  }

  return days.map(day => {
    const peak = busiestFiveHours(day.records);
    const read = day.input + day.cacheRead + day.cacheWrite;
    return {
      date: day.date,
      weekday: day.weekday,
      total: day.total,
      output: day.output,
      answers: day.answers,
      cacheShare: read > 0 ? day.cacheRead / read : 0,
      hours: day.hours,
      models: day.models,
      projects: day.projects,
      threads: [...day.threads.values()]
        .filter(thread => thread.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, TOP_THREADS),
      peak,
    };
  });
}

// ---------- ways to use fewer tokens ----------

// Group records by conversation, each list in time order.
function bySession(records) {
  const map = new Map();
  for (const record of records) {
    if (!record.sessionId) continue;
    const key = record.cli + ':' + record.sessionId;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  for (const list of map.values()) list.sort((a, b) => a.ts - b.ts);
  return map;
}

const threadRow = (list, tokens) => ({
  id: list[0].sessionId,
  cli: list[0].cli,
  project: projectName(list[0].cwd),
  tokens,
});

// Tip 1: conversations that grew past HEAVY. The share is what they re-read beyond SOFT.
function compactTip(sessions) {
  const heavy = [];
  let reread = 0;
  let beyond = 0;
  for (const list of sessions.values()) {
    if (list[0].cli !== 'claude-code') continue;
    const largest = Math.max(...list.map(contextOf));
    if (largest < HEAVY) continue;
    let sum = 0;
    let over = 0;
    for (const record of list) {
      const size = contextOf(record);
      sum += size;
      over += Math.max(0, size - SOFT);
    }
    reread += sum;
    beyond += over;
    heavy.push({
      ...threadRow(
        list,
        list.reduce((s, r) => s + tokensOf(r), 0)
      ),
      largest,
    });
  }
  const share = reread > 0 ? beyond / reread : 0;
  if (heavy.length < MIN_CASES.compact || share < MIN_SHARE) return null;
  return {
    key: 'compact',
    cases: heavy.length,
    share,
    threads: heavy.sort((a, b) => b.largest - a.largest).slice(0, 5),
  };
}

// Tip 2: answers after a pause that wrote the conversation to the cache again.
function breaksTip(sessions, weekTokens) {
  const hits = [];
  let rewritten = 0;
  let longest = 0;
  const perThread = new Map();
  for (const [key, list] of sessions) {
    if (list[0].cli !== 'claude-code') continue;
    for (let i = 1; i < list.length; i++) {
      const record = list[i];
      const gap = record.ts - list[i - 1].ts;
      const size = contextOf(record);
      if (gap < BREAK_MS || size < REWRITE_MIN) continue;
      if (record.cacheWrite < size * REWRITE_SHARE) continue;
      hits.push(record);
      rewritten += record.cacheWrite;
      longest = Math.max(longest, gap);
      const row = perThread.get(key) || threadRow(list, 0);
      row.tokens += record.cacheWrite;
      perThread.set(key, row);
    }
  }
  const share = weekTokens > 0 ? rewritten / weekTokens : 0;
  if (hits.length < MIN_CASES.breaks || share < MIN_SHARE) return null;
  return {
    key: 'breaks',
    cases: hits.length,
    share,
    longestMs: longest,
    threads: [...perThread.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
  };
}

// Tip 3: short tasks on the largest Claude model (task-learning.js records).
function modelTip(tasks) {
  const measured = tasks.filter(task => task.tokens > 0);
  const short = measured.filter(task => /opus/i.test(task.model || '') && task.ms < SHORT_MS);
  const all = measured.reduce((sum, task) => sum + task.tokens, 0);
  const used = short.reduce((sum, task) => sum + task.tokens, 0);
  const share = all > 0 ? used / all : 0;
  if (short.length < MIN_CASES.model || share < MIN_SHARE) return null;
  const byAgent = new Map();
  for (const task of short) {
    const name = task.agent || 'An agent';
    const row = byAgent.get(name) || { title: name, tasks: 0, tokens: 0 };
    row.tasks += 1;
    row.tokens += task.tokens;
    byAgent.set(name, row);
  }
  const models = {};
  for (const task of short) models[task.model] = (models[task.model] || 0) + 1;
  const model = Object.entries(models).sort((a, b) => b[1] - a[1])[0][0];
  return {
    key: 'model',
    cases: short.length,
    share,
    model: prettyModel(model),
    threads: [...byAgent.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5),
  };
}

// The tips of the last TIP_DAYS days, the largest share first, at most three.
function tips(records, tasks, now = Date.now()) {
  const since = now - TIP_DAYS * DAY_MS;
  const week = records.filter(record => record.ts >= since && record.ts <= now);
  const weekTokens = week.reduce((sum, record) => sum + tokensOf(record), 0);
  const sessions = bySession(week);
  const recentTasks = tasks.filter(task => task.at >= since && task.at <= now);
  return [compactTip(sessions), breaksTip(sessions, weekTokens), modelTip(recentTasks)]
    .filter(Boolean)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3);
}

// ---------- reading what is on disk ----------

// Every finished task task-learning.js kept, from every project.
function readTasks(folder) {
  const tasks = [];
  let files = [];
  try {
    files = fs.readdirSync(folder).filter(name => name.endsWith('.jsonl'));
  } catch {
    return tasks;
  }
  for (const name of files) {
    let text = '';
    try {
      text = fs.readFileSync(path.join(folder, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const task = JSON.parse(line);
        if (Number.isFinite(task.at)) tasks.push(task);
      } catch {}
    }
  }
  return tasks;
}

function claudeRoot() {
  try {
    const roots = JSON.parse(process.env.TNAI_USAGE_ROOTS || '{}') || {};
    if (roots.claude) return roots.claude;
  } catch {}
  return path.join(os.homedir(), '.claude', 'projects');
}

// sessionId → title of its first prompt ('' when not found); kept for this run.
const titleCache = new Map();
const SAFE_ID = /^[A-Za-z0-9_-]{6,80}$/;

async function readHead(file) {
  let handle;
  try {
    handle = await fs.promises.open(file, 'r');
    const buffer = Buffer.alloc(HEAD);
    const { bytesRead } = await handle.read(buffer, 0, HEAD, 0);
    return { text: buffer.toString('utf8', 0, bytesRead), whole: bytesRead < HEAD };
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function titleOf(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  let title = '';
  const root = claudeRoot();
  let folders = [];
  try {
    folders = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {}
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const head = await readHead(path.join(root, folder.name, id + '.jsonl'));
    if (!head) continue;
    title = cleanTitle(claudeHead(head.text, head.whole).title);
    break;
  }
  titleCache.set(id, title);
  return title;
}

// IPC usage:titles: ids → [{ id, title }]; at most 16 ids, Claude Code conversations only.
async function titles(ids) {
  const list = (Array.isArray(ids) ? ids : []).filter(id => SAFE_ID.test(String(id))).slice(0, 16);
  const out = [];
  for (const id of list) out.push({ id, title: await titleOf(id) });
  return out;
}

// IPC usage:insights. usage: usage-stats.js; dir: the app's settings folder.
async function insights(usage, dir) {
  const now = Date.now();
  const { allRecords, sources } = await usage.collect();
  const tasks = readTasks(path.join(dir, 'task-learning'));
  const found = tips(allRecords, tasks, now);

  // the tips' threads get their titles here (a handful); the days' threads are asked for on a press
  for (const tip of found)
    for (const thread of tip.threads)
      if (thread.id && thread.cli === 'claude-code') thread.title = await titleOf(thread.id);

  return {
    generatedAt: now,
    sources,
    days: build(allRecords, now),
    tips: found,
    tasksMeasured: tasks.length,
  };
}

module.exports = {
  insights,
  titles,
  build,
  tips,
  prettyModel,
  cleanTitle,
  busiestFiveHours,
};
