/*
 * Technically Not desktop · task-learning.js — learning from what threads deliver (user 2026-10-28:
 * "Create built in systems to learn from information delivered to us in threads").
 *
 * Every finished task is measured already: its time, its tokens, the size of the conversation it
 * re-read, its helpers (agent-turns.js), and, when the thread showed it, where its time went
 * (187-task-time.js, sent here as `split`). This file keeps those measures per project, finds
 * patterns that hold over many tasks, and gives them back:
 *
 * - to the agent working now, with its prompt (Claude Code's UserPromptSubmit hook,
 * agent-hooks.js), only when a lesson applies to it at that moment and once per session;
 * - to every CLI through `tnai context` (agent-context.js), as a short "Learned" section.
 *
 * Measured only, never guessed: a lesson needs enough tasks behind it (see each rule's minimum) and
 * says how many it rests on. Records stay on this PC, in the app's settings folder
 * (task-learning/<project hash>.jsonl), never sent anywhere. The pure part (`learn`, `normalize`,
 * `median`) is tested by tools/task-learning-test.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Records kept per project; the file is trimmed back to this when it grows past it by a fifth.
const KEEP = 1500;

// A finished task's tokens are read from the CLI's record a moment after its end, and the window
// sends its time split when it builds the "Worked for" block: the record waits this long for both.
let settleMs = 8000;

// Lessons look at this many days back.
const DAYS = 45;

// A conversation this large counts as heavy (tokens re-read on every step).
const HEAVY = 150000;

// The minimum tasks a rule needs on each side before it says anything.
const MIN_TASKS = 5;

// A command counts as slow when its median run is this long, over at least this many tasks.
const SLOW_MS = 45000;
const SLOW_TASKS = 3;

// The longest command text kept in a record.
const WHAT_MAX = 120;

let folder = '';
let turns = null;
let projectOf = () => '';

// main.js: tells the window a project's lessons may have changed
let changed = () => {};

// paneId -> { record, timer } waiting for its tokens and time split
const pending = new Map();

// paneId -> { tokens, at }: the conversation's size when the pane's last task ended
const lastContext = new Map();

// file -> records, read once and kept current
const cache = new Map();

// paneId -> Set of lesson keys already given to that session
const told = new Map();

// ---------- the pure part ----------

function median(values) {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return 0;
  const middle = Math.floor(list.length / 2);
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
}

// A command as the same command each time: spaces collapsed, cut to WHAT_MAX.
function normalize(what) {
  return String(what || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WHAT_MAX);
}

function shortNumber(value) {
  if (value >= 1e6) return (value / 1e6).toFixed(value >= 1e7 ? 0 : 1) + 'M';
  if (value >= 1e3) return Math.round(value / 1e3) + 'k';
  return String(Math.round(value));
}

function duration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}

// Heavy conversations against light ones: the median tokens of tasks begun above HEAVY and below
// it. Null when either side has fewer than MIN_TASKS, or the heavy side is not clearly dearer.
function contextRule(records) {
  const known = records.filter(record => Number.isFinite(record.ctxStart) && record.tokens > 0);
  const heavy = known.filter(record => record.ctxStart >= HEAVY);
  const light = known.filter(record => record.ctxStart < HEAVY);
  if (heavy.length < MIN_TASKS || light.length < MIN_TASKS) return null;
  const heavyMedian = median(heavy.map(record => record.tokens));
  const lightMedian = median(light.map(record => record.tokens));
  if (!(heavyMedian >= lightMedian * 1.5)) return null;
  return { key: 'context', heavyMedian, lightMedian, tasks: known.length };
}

// Commands that were a task's slowest step again and again: median at least SLOW_MS over at least
// SLOW_TASKS tasks, the three that cost the most time in all.
function slowRule(records) {
  const byCommand = new Map();
  for (const record of records) {
    for (const step of record.slow || []) {
      if (step.kind !== 'run' || !(step.ms > 0)) continue;
      const what = normalize(step.what);
      if (!what) continue;
      if (!byCommand.has(what)) byCommand.set(what, []);
      byCommand.get(what).push(step.ms);
    }
  }
  const slow = [...byCommand]
    .map(([what, times]) => ({
      what,
      tasks: times.length,
      median: median(times),
      longest: Math.max(...times),
      total: times.reduce((sum, ms) => sum + ms, 0),
    }))
    .filter(item => item.tasks >= SLOW_TASKS && item.median >= SLOW_MS)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
  return slow.length ? { key: 'slow', commands: slow } : null;
}

// Where measured task time went: the kind other than the agent's own thinking and writing that
// took the biggest share, when it took at least a third, over at least 2 × MIN_TASKS tasks.
const KIND_NAMES = {
  read: 'Reading and searching',
  edit: 'Editing',
  run: 'Running commands',
  helper: 'Helpers',
  you: 'Waiting for you',
  other: 'Other tools',
};

function shareRule(records) {
  const timed = records.filter(record => record.parts && record.ms > 0);
  if (timed.length < MIN_TASKS * 2) return null;
  const totals = {};
  let whole = 0;
  for (const record of timed) {
    for (const [kind, ms] of Object.entries(record.parts)) {
      totals[kind] = (totals[kind] || 0) + ms;
      whole += ms;
    }
  }
  const top = Object.entries(totals)
    .filter(([kind]) => KIND_NAMES[kind])
    .sort((a, b) => b[1] - a[1])[0];
  if (!top || !whole || top[1] / whole < 1 / 3) return null;
  return { key: 'share', kind: top[0], share: top[1] / whole, tasks: timed.length };
}

// Every lesson the records of the last DAYS days hold, as { key, ... } objects.
function learn(records, now = Date.now()) {
  const recent = (records || []).filter(record => now - (record.at || 0) < DAYS * 864e5);
  return [contextRule(recent), slowRule(recent), shareRule(recent)].filter(Boolean);
}

// One lesson in words. `context` is the conversation's size now, for the context lesson.
function words(lesson, context) {
  if (lesson.key === 'context') {
    return (
      (context
        ? 'Your conversation is at ' +
          shortNumber(context) +
          ' tokens, and every step re-reads it. '
        : '') +
      'In this project, tasks begun with a conversation over ' +
      shortNumber(HEAVY) +
      ' tokens used a median ' +
      shortNumber(lesson.heavyMedian) +
      ' tokens, against ' +
      shortNumber(lesson.lightMedian) +
      ' below it (' +
      lesson.tasks +
      ' tasks measured). Do the work in fewer steps (batch reads and edits), and suggest /compact to the user at a natural break.'
    );
  }
  if (lesson.key === 'slow') {
    return (
      "Slow commands here (measured as a task's slowest step): " +
      lesson.commands
        .map(
          item =>
            '`' +
            item.what +
            '` median ' +
            duration(item.median) +
            ' in ' +
            item.tasks +
            ' tasks (longest ' +
            duration(item.longest) +
            ')'
        )
        .join('; ') +
      '. Run such checks once when the change is done, not between steps, and never twice on an unchanged input.'
    );
  }
  if (lesson.key === 'share') {
    return (
      KIND_NAMES[lesson.kind] +
      ' took ' +
      Math.round(lesson.share * 100) +
      '% of the measured task time here (' +
      lesson.tasks +
      ' tasks).' +
      (lesson.kind === 'run'
        ? ' Prefer the cheapest check that proves a change.'
        : lesson.kind === 'read'
          ? ' Search exact names before reading, and read only the part you need.'
          : '')
    );
  }
  return '';
}

// ---------- the record file ----------

const fileOf = root =>
  folder && root
    ? path.join(
        folder,
        crypto
          .createHash('sha1')
          .update(path.resolve(root).toLowerCase())
          .digest('hex')
          .slice(0, 16) + '.jsonl'
      )
    : '';

function load(root) {
  const file = fileOf(root);
  if (!file) return [];
  if (cache.has(file)) return cache.get(file);
  let records = [];
  try {
    records = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {}
  cache.set(file, records);
  return records;
}

function save(root, record) {
  const file = fileOf(root);
  if (!file) return;
  const records = load(root);
  records.push(record);
  try {
    fs.mkdirSync(folder, { recursive: true });
    if (records.length > KEEP * 1.2) {
      records.splice(0, records.length - KEEP);
      fs.writeFileSync(file, records.map(item => JSON.stringify(item)).join('\n') + '\n');
    } else {
      fs.appendFileSync(file, JSON.stringify(record) + '\n');
    }
  } catch (error) {
    console.warn('[tnai] task learning could not save:', error?.message || error);
  }
  changed(root);
}

// The lessons the user switched off for agents ("Tell agents" in Details), per project, kept in
// <project hash>.muted.json beside the records.
const mutedCache = new Map();

function mutedOf(root) {
  const file = fileOf(root).replace(/\.jsonl$/, '.muted.json');
  if (!file) return new Set();
  if (!mutedCache.has(file)) {
    let keys = [];
    try {
      keys = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    mutedCache.set(file, new Set(Array.isArray(keys) ? keys.map(String) : []));
  }
  return mutedCache.get(file);
}

function setMuted(root, key, muted) {
  const file = fileOf(root).replace(/\.jsonl$/, '.muted.json');
  if (!file || !['context', 'slow', 'share'].includes(key)) return false;
  const keys = mutedOf(root);
  if (muted) keys.add(key);
  else keys.delete(key);
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...keys]));
  } catch (error) {
    console.warn('[tnai] task learning could not save a switch:', error?.message || error);
    return false;
  }
  changed(root);
  return true;
}

// ---------- taking a finished task in ----------

const turnOf = paneId => {
  try {
    return turns.state().find(turn => turn.paneId === paneId) || null;
  } catch {
    return null;
  }
};

const sum = tokens =>
  tokens ? tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite : 0;

function ended(paneId) {
  const turn = turnOf(paneId);
  if (!turn?.startedAt || !turn.endedAt || turn.history) return;
  const root = projectOf(paneId);
  if (!root) return;

  // the conversation's size when this task began: the size at the pane's last task end, unless
  // the conversation was cleared or compacted since
  const before = lastContext.get(paneId);
  const reset = Math.max(turn.clearedAt || 0, turn.compactedAt || 0);
  const ctxStart =
    before && before.at <= turn.startedAt && reset < before.at ? before.tokens : undefined;

  const record = {
    at: turn.endedAt,
    agent: turn.agent || '',
    model: turn.model || '',
    effort: turn.effort || '',
    ms: turn.endedAt - turn.startedAt,
    endedBy: turn.endedBy || '',
    ctxStart,
  };
  clearTimeout(pending.get(paneId)?.timer);
  const entry = { record, root, timer: null };
  entry.timer = setTimeout(() => settle(paneId, entry), settleMs);
  pending.set(paneId, entry);
}

// The tokens are final now: fill them in and keep the record.
function settle(paneId, entry) {
  if (pending.get(paneId) === entry) pending.delete(paneId);
  const turn = turnOf(paneId);
  const record = entry.record;
  if (turn && turn.endedAt === record.at) {
    record.tokens = sum(turn.tokens);
    record.cacheRead = turn.tokens?.cacheRead || 0;
    record.helpers = sum(turn.subTokens);
    record.subAgents = turn.subAgents || 0;
    if (Number.isFinite(turn.context?.tokens)) {
      record.ctxEnd = turn.context.tokens;
      lastContext.set(paneId, { tokens: turn.context.tokens, at: record.at });
    }
  }
  if (!record.tokens && !record.parts) return;
  save(entry.root, record);
}

// 187: where a task's time went, sent when its "Worked for" block is built for a task that just
// ended. `parts`: [{ kind, ms, slowest: { what, ms } }].
function split(paneId, at, parts) {
  const entry = pending.get(paneId);
  if (!entry || !Array.isArray(parts) || Math.abs((entry.record.at || 0) - (at || 0)) > 120000)
    return;
  entry.record.parts = {};
  entry.record.slow = [];
  for (const part of parts.slice(0, 10)) {
    if (!KIND_NAMES[part?.kind] && part?.kind !== 'write') continue;
    if (!(part.ms > 0)) continue;
    entry.record.parts[part.kind] = Math.round(part.ms);
    if (part.slowest?.ms > 0)
      entry.record.slow.push({
        kind: part.kind,
        what: normalize(part.slowest.what),
        ms: Math.round(part.slowest.ms),
      });
  }
}

// ---------- giving it back ----------

const HEADER =
  "Technically Not learned (measured from this project's past tasks; follow it unless your task needs otherwise):";

// With a new prompt (Claude Code's hook): the lessons that apply to this agent now, each once per
// session; the context lesson again after the conversation was made small and grew back.
function forPrompt(paneId) {
  const root = projectOf(paneId);
  if (!root) return '';
  const muted = mutedOf(root);
  const lessons = learn(load(root)).filter(lesson => !muted.has(lesson.key));
  if (!lessons.length) return '';
  const context = turnOf(paneId)?.context?.tokens || 0;
  if (!told.has(paneId)) told.set(paneId, new Set());
  const said = told.get(paneId);
  if (context < HEAVY) said.delete('context');
  const lines = [];
  for (const lesson of lessons) {
    if (said.has(lesson.key)) continue;
    if (lesson.key === 'context' && context < HEAVY) continue;
    said.add(lesson.key);
    lines.push('- ' + words(lesson, lesson.key === 'context' ? context : 0));
  }
  return lines.length ? HEADER + '\n' + lines.join('\n') : '';
}

// For a CLI without a prompt hook (Codex, OpenCode, Cursor Agent): the same lessons as forPrompt,
// on one line, for the note 11 adds at the end of the prompt (main.js `learning:note`).
function noteFor(paneId) {
  const text = forPrompt(paneId);
  if (!text) return '';
  return text
    .split('\n')
    .slice(1)
    .map(line => line.replace(/^- /, ''))
    .join(' ');
}

// For `tnai context` (every CLI): all lessons of the project, short.
function forContext(root) {
  const records = load(root);
  const muted = mutedOf(root);
  const lessons = learn(records).filter(lesson => !muted.has(lesson.key));
  if (!lessons.length) return '';
  return (
    '\nLearned from ' +
    records.length +
    ' measured tasks in this project:\n' +
    lessons.map(lesson => '  - ' + words(lesson, 0)).join('\n')
  );
}

// One lesson for the user (Details › Learned here): what it is, and what agents are told. A
// command stands between backticks; the window shows it as code.
function userWords(lesson, muted) {
  const notTold = muted ? 'agents are not told' : '';
  if (lesson.key === 'context') {
    return {
      text:
        'Big conversations cost more: tasks begun over ' +
        shortNumber(HEAVY) +
        ' tokens used a median ' +
        shortNumber(lesson.heavyMedian) +
        ', against ' +
        shortNumber(lesson.lightMedian) +
        ' below it.',
      note:
        lesson.tasks +
        ' tasks · ' +
        (notTold || 'agents told to work in fewer steps and suggest /compact'),
    };
  }
  if (lesson.key === 'slow') {
    return {
      text: lesson.commands
        .map(
          item =>
            '`' +
            item.what +
            '` was the slowest step in ' +
            item.tasks +
            ' tasks, median ' +
            duration(item.median) +
            ' (longest ' +
            duration(item.longest) +
            ').'
        )
        .join(' '),
      note: notTold || 'agents told to run it once when the change is done',
    };
  }
  return {
    text:
      KIND_NAMES[lesson.kind] +
      ' took ' +
      Math.round(lesson.share * 100) +
      '% of the measured task time here.',
    note: lesson.tasks + ' tasks with a time bar' + (notTold ? ' · ' + notTold : ''),
  };
}

// For the window (187's tips, 189's Details section): the project's lessons, the usual task of
// this pane's agent, and the record of the task that ended at `at` (null when not kept).
function view(paneId, at) {
  const root = projectOf(paneId);
  if (!root) return null;
  const records = load(root);
  const now = Date.now();
  const recent = records.filter(record => now - (record.at || 0) < DAYS * 864e5);
  const muted = mutedOf(root);
  const lessons = learn(records, now).map(lesson => ({
    ...lesson,
    ...userWords(lesson, muted.has(lesson.key)),
    muted: muted.has(lesson.key),
  }));

  // the usual task: the median of this agent's tasks here, from 10 tasks up
  const agent = turnOf(paneId)?.agent || '';
  const same = recent.filter(record => record.agent === agent && record.tokens > 0);
  const usual =
    agent && same.length >= MIN_TASKS * 2
      ? { agent, median: median(same.map(record => record.tokens)), tasks: same.length }
      : null;
  const task =
    records.find(record => Number.isFinite(at) && Math.abs((record.at || 0) - at) < 120000) || null;
  return {
    count: records.length,
    since: records.length ? records[0].at : 0,
    heavy: HEAVY,
    lessons,
    usual,
    task: task ? { tokens: task.tokens || 0, ctxStart: task.ctxStart } : null,
  };
}

// A session that ended forgets what it was told.
function forget(paneId) {
  told.delete(paneId);
  lastContext.delete(paneId);
}

module.exports = {
  // { dir: the app's settings folder, turns: agent-turns.js, project: paneId → project root,
  // settleMs: only tests pass it, to not wait 8 seconds }
  init(options) {
    folder = path.join(options.dir, 'task-learning');
    turns = options.turns;
    projectOf = options.project;
    if (Number.isFinite(options.settleMs)) settleMs = options.settleMs;
    if (typeof options.changed === 'function') changed = options.changed;
    turns.onEnd(paneId => {
      try {
        ended(paneId);
      } catch {}
    });
  },
  split(paneId, at, parts) {
    try {
      split(paneId, at, parts);
    } catch {}
  },
  forPrompt(paneId) {
    try {
      return forPrompt(paneId);
    } catch {
      return '';
    }
  },
  noteFor(paneId) {
    try {
      return noteFor(paneId);
    } catch {
      return '';
    }
  },
  forContext(root) {
    try {
      return forContext(root);
    } catch {
      return '';
    }
  },
  view(paneId, at) {
    try {
      return view(paneId, at);
    } catch {
      return null;
    }
  },
  // "Tell agents" in Details: off keeps a lesson from agents, in prompts and in `tnai context`
  setMuted(paneId, key, muted) {
    try {
      return setMuted(projectOf(paneId), String(key || ''), !!muted);
    } catch {
      return false;
    }
  },
  forget,
  pure: { learn, words, userWords, median, normalize, HEAVY },
};
