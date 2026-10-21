// Technically Not desktop · prompt-schedules.js — Scheduled prompts: a prompt the user saved starts
// a new agent thread at set times (Settings › Agents › Scheduled prompts, the window side is
// src/scripts/155-prompt-schedules.js).
//
// - Kept in <userData>/prompt-schedules.json, written atomically. Every save first copies the last
//   good file to prompt-schedules.backup.json; a file that no longer parses is moved aside as
//   prompt-schedules.broken-<time>.json and the backup is read instead; a file that exists but
// cannot be read makes saves refuse, so nothing is lost (the same rules as custom-agent-store.js).
// - Runs only while the app is open. One timer waits for the next due run (never a timer every
//   second). A due time that passed while the app was closed or the computer slept is not run by
//   itself: it becomes a "missed" mark the window shows once in the bell, with Run now.
// - A run starts a new thread through the same path as `tnai new` (agent-lifecycle.js spawn),
//   in the schedule's own project folder (the mark below tells main.js's pty:start which folder),
//   named after the schedule, at that project's normal access level, then types the prompt in.
// - Never two runs of one schedule at once: while the thread of its last run still works, a due
//   run is skipped and the last result says so.
//
// The times are local wall-clock times, so a daily 08:30 stays 08:30 across a change of summer
// time. `nextRun` and `lastDue` are pure and tested by tools/prompt-schedules-test.js.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'prompt-schedules.json';
const BACKUP = 'prompt-schedules.backup.json';

// The shortest interval "every N minutes" allows, and the longest.
const MIN_EVERY = 15;
const MAX_EVERY = 7 * 24 * 60;

// A due time the timer reaches this late (the computer slept, the app was busy) counts as missed.
const GRACE_MS = 2 * 60 * 1000;

// The timer never waits longer than this, so a change of the computer's clock is noticed.
const MAX_WAIT_MS = 6 * 60 * 60 * 1000;

// Limits on what one schedule keeps.
const NAME_MAX = 40;
const PROMPT_MAX = 20000;
const MAX_SCHEDULES = 50;

// A start mark is good for this long (the trust question in pty:start can stay open a while).
const MARK_MS = 15 * 60 * 1000;

// The kinds of "when", in the order the window offers them.
const KINDS = ['every', 'hourly', 'daily', 'weekdays', 'days', 'once'];

// The run history each schedule keeps (the Board's Week view, 157): the last 30 days, at most this
// many runs, missed ones included.
const HISTORY_DAYS = 30;
const HISTORY_MAX = 120;

// How far ahead the coming runs are listed for the window (the Week view shows up to 4 days on).
const AHEAD_MS = 8 * 24 * 60 * 60 * 1000;
const AHEAD_MAX = 60;

// The agent CLIs a scheduled run may start: the ones a new thread can start with (the New thread
// screen, 140, and `tnai new`). main.js narrows it to the CLIs in the registry.
const AGENTS = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

// ---------------------------------------------------------------- when a schedule is due

// "HH:MM" → { hour, minute }, or null for anything else.
function parseTime(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

// "YYYY-MM-DD" → { year, month, day }, or null for anything else or a day that does not exist.
function parseDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day)
    return null;
  return { year, month, day };
}

// Whether a run may fall on this local weekday (0 = Sunday).
function dayAllowed(when, weekday) {
  if (when.kind === 'weekdays') return weekday >= 1 && weekday <= 5;
  if (when.kind === 'days') return Array.isArray(when.days) && when.days.includes(weekday);
  return true;
}

// The first due time strictly after `after` (ms), or 0 when the schedule can never run.
// `anchor` (ms) is where "every N minutes" counts from.
function nextRun(when, after, anchor = 0) {
  if (!when || !KINDS.includes(when.kind)) return 0;

  // Every N minutes: plain time steps from the anchor, the same in every time zone.
  if (when.kind === 'every') {
    const step = Number(when.minutes) * 60000;
    if (!(step >= MIN_EVERY * 60000)) return 0;
    const start = anchor || after;
    if (after < start) return start + step;
    return start + (Math.floor((after - start) / step) + 1) * step;
  }

  // Hourly: at minute M of every local hour. Built from the local clock hour by hour, so a summer
  // time change gives one run in the hour that repeats and none twice.
  if (when.kind === 'hourly') {
    const minute = Math.min(59, Math.max(0, Number(when.minute) || 0));
    const base = new Date(after);
    for (let step = 0; step <= 50; step++) {
      const candidate = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
        base.getHours() + step,
        minute,
        0,
        0
      ).getTime();
      if (candidate > after) return candidate;
    }
    return 0;
  }

  // Once: on one local date at HH:MM (a Board idea dropped on a day), and never again.
  if (when.kind === 'once') {
    const time = parseTime(when.time);
    const date = parseDate(when.date);
    if (!time || !date) return 0;
    const at = new Date(date.year, date.month - 1, date.day, time.hour, time.minute, 0, 0);
    return at.getTime() > after ? at.getTime() : 0;
  }

  // Daily, weekdays or chosen days at HH:MM, local time. A time that does not exist that day (the
  // hour summer time skips) is moved on by the clock to the hour after; a time that happens twice
  // runs only the first time, because the next candidate is always a later day.
  const time = parseTime(when.time);
  if (!time) return 0;
  if (when.kind === 'days' && !(Array.isArray(when.days) && when.days.length)) return 0;
  const base = new Date(after);
  for (let day = 0; day <= 8; day++) {
    const candidate = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + day,
      time.hour,
      time.minute,
      0,
      0
    );
    if (candidate.getTime() > after && dayAllowed(when, candidate.getDay()))
      return candidate.getTime();
  }
  return 0;
}

// The latest due time in (since, now], or 0 when none fell in that span.
function lastDue(when, since, now, anchor = 0) {
  let due = nextRun(when, since, anchor);
  if (!due || due > now) return 0;

  // Every N minutes: straight arithmetic, however long the app was closed.
  if (when.kind === 'every') {
    const step = Number(when.minutes) * 60000;
    return due + Math.floor((now - due) / step) * step;
  }

  // The others step from due time to due time; a year of hourly runs is under 9,000 steps.
  for (let guard = 0; guard < 20000; guard++) {
    const next = nextRun(when, due, anchor);
    if (!next || next > now) return due;
    due = next;
  }
  return due;
}

// One line a person reads: "Weekdays at 08:30".
function describe(when) {
  if (!when) return '';
  const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (when.kind === 'every') return 'Every ' + when.minutes + ' minutes';
  if (when.kind === 'hourly')
    return 'Every hour at :' + String(Number(when.minute) || 0).padStart(2, '0');
  if (when.kind === 'daily') return 'Every day at ' + when.time;
  if (when.kind === 'weekdays') return 'Weekdays at ' + when.time;
  if (when.kind === 'once') {
    const date = parseDate(when.date);
    const day = date
      ? DAY[new Date(date.year, date.month - 1, date.day).getDay()] + ' ' + when.date
      : when.date;
    return 'Once, ' + day + ' at ' + when.time;
  }
  const days = (when.days || []).map(day => DAY[day]).join(', ');
  return days + ' at ' + when.time;
}

// ---------------------------------------------------------------- checking what the window sends

const text = (value, max) =>
  String(value ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, max);
const oneLine = (value, max) => text(value, max).replace(/\s+/g, ' ').trim();

// The "when" part, made safe, or { error }.
function cleanWhen(raw) {
  const when = raw && typeof raw === 'object' ? raw : {};
  const kind = KINDS.includes(when.kind) ? when.kind : '';
  if (!kind) return { error: 'Choose when it runs.' };
  if (kind === 'every') {
    const minutes = Math.round(Number(when.minutes));
    if (!(minutes >= MIN_EVERY))
      return { error: 'Every N minutes needs at least ' + MIN_EVERY + ' minutes.' };
    if (minutes > MAX_EVERY) return { error: 'Every N minutes allows at most one week.' };
    return { kind, minutes };
  }
  if (kind === 'hourly') {
    const minute = Math.round(Number(when.minute) || 0);
    if (minute < 0 || minute > 59) return { error: 'The minute of the hour is 0 to 59.' };
    return { kind, minute };
  }
  const time = parseTime(when.time);
  if (!time) return { error: 'Give the time as HH:MM, for example 08:30.' };
  const clock = String(time.hour).padStart(2, '0') + ':' + String(time.minute).padStart(2, '0');
  if (kind === 'once') {
    if (!parseDate(when.date)) return { error: 'Give the day as YYYY-MM-DD.' };
    return { kind, time: clock, date: String(when.date).trim() };
  }
  if (kind !== 'days') return { kind, time: clock };
  const days = [...new Set((Array.isArray(when.days) ? when.days : []).map(Number))]
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort();
  if (!days.length) return { error: 'Choose at least one day.' };
  return { kind, time: clock, days };
}

// The run history read back: only known fields; the states are done, failed, skipped, missed.
const RUN_STATES = ['done', 'failed', 'skipped', 'missed'];

function cleanRuns(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(run => run && typeof run === 'object' && RUN_STATES.includes(run.state))
    .map(run => ({
      at: Number(run.at) || 0,
      state: run.state,
      text: oneLine(run.text, 300),
      paneId: text(run.paneId, 120),
      thread: oneLine(run.thread, NAME_MAX + 10),
    }))
    .filter(run => run.at > 0)
    .slice(-HISTORY_MAX);
}

// Adds one run to a schedule's history and drops what is older than 30 days or over the cap.
function addRun(item, run, at) {
  const since = at - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  item.runs = [...(item.runs || []), run].filter(one => one.at >= since).slice(-HISTORY_MAX);
}

// The coming due times from `after` on, for at most AHEAD_MS and AHEAD_MAX of them.
function upcoming(item, after) {
  const out = [];
  if (!item.enabled) return out;
  let due = nextRun(item.when, Math.max(after, item.seenUntil), item.anchor);
  while (due && due <= after + AHEAD_MS && out.length < AHEAD_MAX) {
    out.push(due);
    due = nextRun(item.when, due, item.anchor);
  }
  return out;
}

// A saved schedule read back from the file: only known fields of the right type.
function fromFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !/^[\w-]{1,80}$/.test(raw.id)) return null;
  const when = cleanWhen(raw.when);
  if (when.error) return null;
  const last = raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun : null;
  return {
    id: raw.id,
    name: oneLine(raw.name, NAME_MAX) || 'Scheduled prompt',
    folder: text(raw.folder, 1024),
    agent: AGENTS.includes(raw.agent) ? raw.agent : 'Claude Code',
    model: oneLine(raw.model, 120),
    prompt: text(raw.prompt, PROMPT_MAX),
    when,
    enabled: raw.enabled === true,
    createdAt: Number(raw.createdAt) || 0,
    anchor: Number(raw.anchor) || 0,
    seenUntil: Number(raw.seenUntil) || 0,
    missedAt: Number(raw.missedAt) || 0,
    runs: cleanRuns(raw.runs),
    lastRun: last
      ? {
          at: Number(last.at) || 0,
          ok: last.ok === true,
          text: oneLine(last.text, 300),
          paneId: text(last.paneId, 120),
          thread: oneLine(last.thread, NAME_MAX + 10),
        }
      : null,
  };
}

// ---------------------------------------------------------------- the saved file

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function parseList(body) {
  const data = JSON.parse(body);
  const list = Array.isArray(data) ? data : data?.schedules;
  if (!Array.isArray(list)) throw new Error('not a list of schedules');
  return list.map(fromFile).filter(Boolean);
}

// { list, ok, error? }: ok false means the file is there but could not be read, so saves refuse.
function readFile(dir) {
  const file = path.join(dir, FILE);
  const readBackup = () => {
    try {
      return parseList(fs.readFileSync(path.join(dir, BACKUP), 'utf8'));
    } catch {
      return null;
    }
  };
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { list: [], ok: true };
    return {
      list: readBackup() || [],
      ok: false,
      error: 'Could not read your scheduled prompts (' + (error.code || error.message) + ').',
    };
  }
  try {
    return { list: parseList(body), ok: true };
  } catch {
    // Broken: kept aside for the user, and the last good copy is read instead.
    try {
      fs.renameSync(file, path.join(dir, 'prompt-schedules.broken-' + stamp() + '.json'));
    } catch {
      return {
        list: readBackup() || [],
        ok: false,
        error: 'Your scheduled prompts file is broken.',
      };
    }
    return { list: readBackup() || [], ok: true, recovered: true };
  }
}

function writeFile(dir, list) {
  const file = path.join(dir, FILE);

  // The last good file becomes the backup before it is replaced.
  try {
    parseList(fs.readFileSync(file, 'utf8'));
    fs.copyFileSync(file, path.join(dir, BACKUP));
  } catch {
    // no good file yet: nothing to back up
  }
  writeAtomic(file, JSON.stringify({ version: 1, schedules: list }, null, 2));
}

// ---------------------------------------------------------------- the scheduler

// deps: {
//   dir: the folder the file lives in (userData),
//   send(channel, payload): to the window,
//   projects(): the user's project folders (paths) that still exist,
//   openProject(): the open project's folder,
//   agents(): the CLI names in the registry,
//   resolveModel(agent, model): { model, label } or { error } (model-pick.js),
//   spawn(agent, pick, name, extra): agent-lifecycle.js spawn, resolves { paneId } or { error },
//   submit(paneId, text, opts): prompt-submit.js submit,
//   note(paneId, info): agent-lifecycle.js note,
//   busy(paneId): true while that thread's agent works,
//   now(): the time (tests set it),
//   setTimer / clearTimer: setTimeout / clearTimeout (tests set them) }
function createSchedules(deps) {
  const now = deps.now || (() => Date.now());
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || (handle => clearTimeout(handle));
  let list = [];
  let readable = true;
  let loadError = '';
  let timer = null;

  // Schedules whose run is starting now (never two at once).
  const starting = new Set();

  // Start marks: mark → { folder, agent, at }; pty:start takes each one once.
  const marks = new Map();

  function load() {
    const read = readFile(deps.dir);
    list = read.list;
    readable = read.ok;
    loadError = read.error || '';
  }

  function save() {
    if (!readable) return false;
    try {
      writeFile(deps.dir, list);
      return true;
    } catch (error) {
      loadError = 'Could not save your scheduled prompts (' + (error.code || error.message) + ').';
      return false;
    }
  }

  const find = id => list.find(item => item.id === id) || null;
  const allowedAgents = () => {
    const known = typeof deps.agents === 'function' ? deps.agents() : AGENTS;
    return AGENTS.filter(agent => known.includes(agent));
  };

  // What the window shows: every schedule with its next due time, plus what it may choose from.
  async function view() {
    const at = now();
    return {
      ok: readable,
      error: loadError,
      agents: allowedAgents(),
      projects: await safeProjects(),
      openProject: (await Promise.resolve(deps.openProject?.()).catch(() => '')) || '',
      minEvery: MIN_EVERY,
      schedules: list.map(item => ({
        ...item,
        running: starting.has(item.id),
        summary: describe(item.when),
        nextAt: item.enabled ? nextRun(item.when, Math.max(at, item.seenUntil), item.anchor) : 0,
        upcoming: upcoming(item, at),
      })),
    };
  }

  async function safeProjects() {
    try {
      const paths = await deps.projects();
      return Array.isArray(paths) ? paths.filter(p => typeof p === 'string') : [];
    } catch {
      return [];
    }
  }

  const sameFolder = (a, b) =>
    path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();

  async function changed() {
    try {
      deps.send?.('schedules:state', await view());
    } catch {
      // the window is gone
    }
  }

  // ---- the timer: one, for the soonest due run

  function arm() {
    if (timer) clearTimer(timer);
    timer = null;
    const at = now();
    let soonest = 0;
    for (const item of list) {
      if (!item.enabled) continue;
      const due = nextRun(item.when, Math.max(item.seenUntil, 0), item.anchor);
      if (due && (!soonest || due < soonest)) soonest = due;
    }
    if (!soonest) return;
    const wait = Math.min(MAX_WAIT_MS, Math.max(0, soonest - at));
    timer = setTimer(() => {
      timer = null;
      tick();
    }, wait);
    timer?.unref?.();
  }

  // Looks at every switched-on schedule: a due time just reached runs, one reached too late (app
  // closed, computer asleep) becomes the missed mark. Returns the ids it started (tests).
  function tick() {
    const at = now();
    const started = [];
    let dirty = false;
    for (const item of list) {
      if (!item.enabled) continue;
      const due = lastDue(item.when, item.seenUntil, at, item.anchor);
      if (!due) continue;
      const previous = item.seenUntil;
      item.seenUntil = at;
      dirty = true;
      if (at - due <= GRACE_MS) {
        started.push(item.id);
        run(item.id, { due }).catch(() => {});
      } else {
        // Every time missed in the span goes into the history (the last 40); the newest is the
        // bell's mark.
        const missed = [];
        let time = nextRun(item.when, previous, item.anchor);
        while (time && time <= due) {
          missed.push(time);
          if (missed.length > 40) missed.shift();
          time = nextRun(item.when, time, item.anchor);
        }
        const words = 'Missed: the app was closed or the computer slept.';
        for (const when of missed)
          addRun(item, { at: when, state: 'missed', text: words, paneId: '', thread: '' }, at);
        item.missedAt = due;
      }
    }
    if (dirty) {
      save();
      changed();
    }
    arm();
    return started;
  }

  // ---- a run

  async function run(id, { manual = false } = {}) {
    const item = find(id);
    if (!item) return { ok: false, error: 'That scheduled prompt no longer exists.' };
    const at = now();
    const finish = (ok, words, extra = {}) => {
      item.lastRun = { at, ok, text: words, paneId: '', thread: '', ...extra };
      const state = ok ? 'done' : /^Skipped/.test(words) ? 'skipped' : 'failed';
      const run = {
        at,
        state,
        text: words,
        paneId: item.lastRun.paneId,
        thread: item.lastRun.thread,
      };
      addRun(item, run, at);
      save();
      changed();
      return { ok, error: ok ? undefined : words, ...extra };
    };
    if (manual && item.missedAt) item.missedAt = 0;

    // Never two at once: one still starting, or the last run's thread still working.
    if (starting.has(id)) return finish(false, 'Skipped: the previous run was still starting.');
    const last = item.lastRun;
    if (last?.paneId && deps.busy?.(last.paneId))
      return finish(
        false,
        'Skipped: ' + (last.thread || 'its last thread') + ' was still working.',
        {
          paneId: last.paneId,
          thread: last.thread,
        }
      );

    starting.add(id);
    changed();
    try {
      const result = await launch(item);
      if (!result.ok) return finish(false, result.error, { paneId: result.paneId || '' });
      return finish(true, 'Started ' + item.name + (manual ? ' (Run now).' : '.'), {
        paneId: result.paneId,
        thread: item.name,
      });
    } finally {
      starting.delete(id);
    }
  }

  // Starts one new thread with a prompt: the start every run uses, and a Board idea dragged into
  // Working (157). { agent, model?, folder, name ('' = the app picks one), prompt } → { ok, paneId
  // } or { ok: false, error, paneId? }.
  async function launch(job) {
    // The folder must still be one of the user's projects.
    const projects = await safeProjects();
    if (!projects.some(folder => sameFolder(folder, job.folder)))
      return {
        ok: false,
        error: 'Not started: that project folder is no longer in your projects.',
      };
    if (!allowedAgents().includes(job.agent))
      return { ok: false, error: 'Not started: ' + job.agent + ' cannot start a thread here.' };
    let pick = null;
    if (job.model) {
      const resolved = await deps.resolveModel(job.agent, job.model);
      if (resolved?.error) return { ok: false, error: 'Not started: ' + resolved.error };
      pick = { model: resolved.model || job.model, effort: '' };
    }
    const mark = crypto.randomUUID();
    marks.set(mark, { folder: job.folder, agent: job.agent, at: now() });
    try {
      const started = await deps.spawn(job.agent, pick, job.name || '', {
        schedule: mark,
        folder: job.folder,
      });
      if (!started?.paneId)
        return {
          ok: false,
          error: 'Not started: ' + (started?.error || 'the thread did not come up.'),
          paneId: started?.openedPaneId || '',
        };
      deps.note?.(started.paneId, { source: 'user' });
      const sent = await deps.submit(started.paneId, job.prompt, { agent: job.agent });
      if (!sent?.ok)
        return {
          ok: false,
          error: 'Started, but the prompt was not sent: ' + (sent?.error || 'no answer'),
          paneId: started.paneId,
        };
      return { ok: true, paneId: started.paneId };
    } catch (error) {
      return { ok: false, error: 'Not started: ' + (error?.message || error) };
    } finally {
      marks.delete(mark);
    }
  }

  // A Board idea dragged into Working: a new thread on its words, in that project.
  async function startPrompt(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const prompt = text(input.prompt, PROMPT_MAX).trim();
    if (!prompt) return { ok: false, error: 'Nothing to start: the idea is empty.' };
    return launch({
      agent: String(input.agent || ''),
      model: '',
      folder: String(input.folder || ''),
      name: '',
      prompt,
    });
  }

  // A Board idea dropped on a day: a one-time schedule, switched on (the user chose the day).
  async function createOnce(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const saved = await saveOne({
      name: input.name,
      folder: input.folder,
      agent: input.agent,
      model: '',
      prompt: input.prompt,
      when: { kind: 'once', date: input.date, time: input.time || '09:00' },
    });
    if (!saved.ok) return saved;
    const on = setEnabled(saved.id, true);
    return on.ok ? saved : on;
  }

  // ---- what the window asks

  async function saveOne(raw) {
    if (!readable) return { ok: false, error: loadError || 'Saving is off until the file reads.' };
    const input = raw && typeof raw === 'object' ? raw : {};
    const old = input.id ? find(String(input.id)) : null;
    if (input.id && !old) return { ok: false, error: 'That scheduled prompt no longer exists.' };
    if (!old && list.length >= MAX_SCHEDULES)
      return { ok: false, error: 'At most ' + MAX_SCHEDULES + ' scheduled prompts.' };
    const name = oneLine(input.name, NAME_MAX);
    if (!name) return { ok: false, error: 'Give it a name.' };
    const prompt = text(input.prompt, PROMPT_MAX + 1).trim();
    if (!prompt) return { ok: false, error: 'Write the prompt it sends.' };
    if (prompt.length > PROMPT_MAX)
      return {
        ok: false,
        error: 'The prompt is too long (at most ' + PROMPT_MAX + ' characters).',
      };
    if (!allowedAgents().includes(input.agent))
      return { ok: false, error: 'Choose an agent CLI that can start a thread.' };
    const projects = await safeProjects();
    const folder = projects.find(p => sameFolder(p, input.folder));
    if (!folder) return { ok: false, error: 'Choose one of your project folders.' };
    const model = oneLine(input.model, 120);
    if (model) {
      const resolved = await deps.resolveModel(input.agent, model);
      if (resolved?.error) return { ok: false, error: resolved.error };
    }
    const when = cleanWhen(input.when);
    if (when.error) return { ok: false, error: when.error };
    const at = now();
    const fields = { name, folder, agent: input.agent, model, prompt, when };
    if (old) {
      const timing = JSON.stringify(old.when) !== JSON.stringify(when);
      Object.assign(old, fields);

      // A new "when" counts from now: nothing before it is missed.
      if (timing) {
        old.anchor = at;
        old.seenUntil = at;
        old.missedAt = 0;
      }
    } else
      list.push({
        id: crypto.randomUUID(),
        ...fields,
        enabled: false,
        createdAt: at,
        anchor: at,
        seenUntil: at,
        missedAt: 0,
        lastRun: null,
        runs: [],
      });
    if (!save()) return { ok: false, error: loadError };
    arm();
    changed();
    return { ok: true, id: old ? old.id : list[list.length - 1].id };
  }

  function setEnabled(id, on) {
    const item = find(String(id));
    if (!item) return { ok: false, error: 'That scheduled prompt no longer exists.' };
    item.enabled = on === true;

    // Switched on: counts from now, so the times while it was off are not missed.
    if (item.enabled) {
      const at = now();
      item.seenUntil = at;
      if (item.when.kind === 'every') item.anchor = at;
    }
    item.missedAt = 0;
    if (!save()) return { ok: false, error: loadError };
    arm();
    changed();
    return { ok: true };
  }

  function remove(id) {
    const before = list.length;
    list = list.filter(item => item.id !== String(id));
    if (list.length === before)
      return { ok: false, error: 'That scheduled prompt no longer exists.' };
    if (!save()) return { ok: false, error: loadError };
    arm();
    changed();
    return { ok: true };
  }

  function dismissMissed(id) {
    const item = find(String(id));
    if (!item || !item.missedAt) return { ok: true };
    item.missedAt = 0;
    save();
    changed();
    return { ok: true };
  }

  // pty:start (main.js): the folder a scheduled run's thread starts in, taken once, only for the
  // CLI it was made for and only while it is fresh. '' for any other start.
  function takeFolder(mark, agent) {
    const entry = typeof mark === 'string' ? marks.get(mark) : null;
    if (!entry) return '';
    marks.delete(mark);
    if (entry.agent !== agent || now() - entry.at > MARK_MS) return '';
    return entry.folder;
  }

  return {
    start() {
      load();
      tick();
    },
    // The computer woke up, or the clock may have changed: look again at once.
    check: () => tick(),
    view,
    save: saveOne,
    setEnabled,
    remove,
    runNow: id => run(String(id), { manual: true }),
    startPrompt,
    createOnce,
    dismissMissed,
    takeFolder,
    // tests
    tick,
    list: () => list,
  };
}

module.exports = {
  createSchedules,
  nextRun,
  lastDue,
  describe,
  cleanWhen,
  upcoming,
  readFile,
  writeFile,
  MIN_EVERY,
  GRACE_MS,
  AGENTS,
};
