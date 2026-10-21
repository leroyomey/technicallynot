// Technically Not · remote-thread.js — what a paired computer may change about one of this
// computer's threads, and the list of this computer's past conversations it may see (plan item 44,
// `docs/plans/multi-computer.md` list J; brief
// `docs/notes/remote-full-control-build-2026-10-21.md`).
//
// Four parts, each pure Node (the clock, random bytes, the sending and the app's real actions are
// handed in, so tools/remote-thread-test.js runs this file without the app):
//
// 1. The thread operation's words. { t: 'thread', n, c, ms, id, to, do, v? } asks this computer to
//    rename, close, or switch the model or effort of one agent's thread. `do` is one of four fixed
//    words; `v` is checked by `threadValue` for its word and refused, never repaired. The checks of
//    who may ask (full control, the ticket, the one-time number, the count) are remote-control.js
//    `doThread`; this file says only which values and which CLIs.
// 2. The real actions behind it (createThreadActions): a rename and a close through the window's
// own rename and close, a model or effort switch through the CLI's own slash command, typed as the
// composer types it here (46 `slash`). Each says where it lands that another computer asked.
// 3. This computer's past conversations for another computer (createPastAnswerer): the newest 30 of
//    the project open here, each with a handle of 16 random hex characters made for that computer
//    and that list only (never the conversation's id or a path). The handle is what another
//    computer names to read one (remote-log.js `logask` with the id 'past') or to resume one.
// 4. The other computer's past conversations as this computer holds them (createPastReader):
//    asked by the window, held in memory only, dropped with the session.
'use strict';
const crypto = require('crypto');
const { clean } = require('./remote-keys.js');
const { MAX_PLAIN } = require('./remote-noise.js');
const { maskSecrets } = require('./remote-log.js');

// ---------- 1. the thread operation's words ----------

// What another computer may change about a thread here.
const THREAD_DO = ['rename', 'close', 'model', 'effort'];

// The effort words Claude Code's own /effort takes.
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// What each CLI can take from another computer, the way the composer does it here. Only Claude Code
// switches its model and effort by a typed command with the value in it (`/model ID`, `/effort
// LEVEL`); Codex, Cursor Agent and OpenCode open their own picker, which needs a person at that
// CLI's screen (46 `switchLive`, 'picker').
const THREAD_CAN = {
  'Claude Code': ['rename', 'close', 'model', 'effort'],
  Codex: ['rename', 'close'],
  OpenCode: ['rename', 'close'],
  'Cursor Agent': ['rename', 'close'],
};

// The words a thread operation can end on. 'busy': the agent is working, has a question open or
// has unsent text in its input, so nothing was typed (the composer here waits the same way).
const THREAD_WORDS = ['done', 'busy', 'refused', 'failed'];

// A thread's name: one clean line of 1 to 40 characters that starts with a letter or a number.
const NAME_MAX = 40;

// A model id as Claude Code names them ("claude-opus-5-5", "opus", "sonnet[1m]").
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,63}$/;

// The value of one thread operation as sent, or null when it is not one this computer takes. A
// close has no value ('').
function threadValue(what, value) {
  if (what === 'close') return value === undefined || value === '' ? '' : null;
  if (typeof value !== 'string' || !value) return null;
  if (what === 'rename') {
    const name = clean(value, NAME_MAX + 1);
    const fits = Array.from(name).length <= NAME_MAX;
    return name === value && fits && /^[\p{L}\p{N}]/u.test(name) ? name : null;
  }
  if (what === 'model') return MODEL_ID.test(value) ? value : null;
  if (what === 'effort') return EFFORTS.includes(value) ? value : null;
  return null;
}

// May that CLI take that operation from another computer at all.
const threadCan = (cli, what) =>
  typeof cli === 'string' && Object.hasOwn(THREAD_CAN, cli) && THREAD_CAN[cli].includes(what);

// The operation field by field, for the sending computer and again for the receiving one before
// its checks (remote-api.js shapeOp calls this for `thread`). Form only.
function shapeThread(m, n, c, id, to) {
  const what = typeof m.do === 'string' && THREAD_DO.includes(m.do) ? m.do : '';
  if (!what) return null;
  const value = threadValue(what, m.v);
  if (value === null) return null;
  const op = { t: 'thread', n, c, ms: m.ms, id, to, do: what };
  if (what !== 'close') op.v = value;
  return op;
}

// A resume of a past conversation: the handle of the list it came in and the project by its first
// commit's id. Nothing else: the CLI and the conversation are this computer's own record.
const HANDLE = /^[0-9a-f]{16}$/;

function shapeResume(m, n, c) {
  const h = typeof m.h === 'string' && HANDLE.test(m.h) ? m.h : '';
  const project =
    typeof m.project === 'string' && /^[0-9a-f]{40}$/.test(m.project) ? m.project : '';
  return h && project ? { t: 'resume', n, c, ms: m.ms, h, project } : null;
}

// ---------- 2. the real actions behind a thread operation ----------
// Handed in: agentNow(panelId) → as remote-actions.js agentNow; busy(panelId) → a turn runs;
// blocked(panelId) → a question is open or the user has unsent text in the input; rename(panelId,
// name, from) → Promise<true when the window applied it>; close(panelId, from) → Promise<true when
// the panel is gone>; type(panelId, text, cli) → Promise<{ ok, state }> (prompt-submit.js `submit`
// without a paste); noted(panelId, words) → the window says it where it lands; taken(panelId,
// name) → true when another agent here already has that name, letter case ignored (review 23, L5).
function createThreadActions({
  agentNow = () => null,
  busy = () => true,
  blocked = () => true,
  taken = () => true,
  rename = async () => false,
  close = async () => false,
  type = async () => ({ ok: false }),
  noted = () => {},
} = {}) {
  const ask = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return undefined;
    }
  };

  // → 'done' | 'busy' | 'refused' | 'failed'. guard() is asked again just before the write.
  async function run({ panelId, what, value, from, guard }) {
    if (typeof guard !== 'function' || !THREAD_DO.includes(what)) return 'refused';
    const agent = ask(agentNow, panelId);
    if (!agent || !threadCan(agent.cli, what)) return 'refused';
    const name = clean(from, 60) || 'another computer';
    if (what === 'rename') {
      // Review 23, L5: never a name another agent here has, or `tnai send NAME` and the user's
      // messages could reach the renamed one; not known counts as taken
      if (ask(taken, panelId, String(value || '')) !== false) return 'refused';
      if (ask(guard) !== true) return 'refused';
      let ok = false;
      try {
        ok = (await rename(panelId, value, name)) === true;
      } catch {
        ok = false;
      }
      return ok ? 'done' : 'refused';
    }
    if (what === 'close') {
      if (ask(guard) !== true) return 'refused';
      let ok = false;
      try {
        ok = (await close(panelId, name)) === true;
      } catch {
        ok = false;
      }
      return ok ? 'done' : 'failed';
    }

    // Model or effort: typed as the CLI's own command, only while nothing else is half-way in that
    // input (lesson "The new path also has to know what this computer's own senders are doing").
    if (ask(busy, panelId) !== false || ask(blocked, panelId) !== false) return 'busy';
    if (ask(guard) !== true) return 'refused';
    const command = '/' + what + ' ' + value;
    let result = null;
    try {
      result = await type(panelId, command, agent.cli);
    } catch {
      result = null;
    }
    if (!result || result.ok !== true) return 'failed';
    ask(noted, panelId, name + ' switched ' + agent.name + '’s ' + what + ' to ' + value);
    return 'done';
  }

  return { run };
}

// ---------- 3. this computer's past conversations for another computer ----------

const PAST_MAX = 30;
const TITLE_MAX = 80;
const PAST_PARTS = 2;
const PAST_ASKS_MIN = 4;
const PAST_KEEP_MS = 30 * 60 * 1000;
const MINUTE = 60 * 1000;

// The CLIs a past conversation can name, as fixed words on the wire.
const PAST_CLIS = {
  'Claude Code': 'claude',
  Codex: 'codex',
  OpenCode: 'opencode',
  'Cursor Agent': 'cursor',
};
const CLI_OF_WORD = Object.fromEntries(Object.entries(PAST_CLIS).map(([k, v]) => [v, k]));

const hex16 = v => (typeof v === 'string' && HANDLE.test(v) ? v : '');
const time = v => (Number.isFinite(v) && v > 0 && v < 1e14 ? Math.floor(v) : 0);

// One row of the list as it crosses, on both sides: { h, cli, title, at }. The title is the
// conversation's first words, masked for the common secret shapes and cleaned to one line.
function shapePastRow(row) {
  if (!row || typeof row !== 'object') return null;
  const h = hex16(row.h);
  const cli = typeof row.cli === 'string' && Object.hasOwn(CLI_OF_WORD, row.cli) ? row.cli : '';
  if (!h || !cli) return null;
  return {
    h,
    cli,
    title: clean(maskSecrets(String(row.title || '')), TITLE_MAX),
    at: time(row.at),
  };
}

// The rows in at most two messages that each fit one sealed message.
function packPast(n, rows) {
  const parts = [[]];
  const fits = list =>
    Buffer.byteLength(JSON.stringify({ t: 'past', n, i: 9, parts: 9, rows: list })) <= MAX_PLAIN;
  for (const row of rows) {
    const last = parts[parts.length - 1];
    if (fits([...last, row])) last.push(row);
    else if (parts.length < PAST_PARTS) parts.push([row]);
    else break;
  }
  return parts.map((list, i) => ({ t: 'past', n, i, parts: parts.length, rows: list }));
}

// may(peerId) → conversations may go to that computer now (the same right as reading a running
// agent's conversation: remote-service.js logsOn). isPhone(peerId) → a phone (refused until the
// phone has its own review). sameProject(peerId) → that computer has the project open that is open
// here. list() → Promise<{ threads }> (thread-list.js `list`, newest first). send(peerId, obj) →
// true when it left. random(n) → n random bytes. onList(peerId, count): a list went out.
function createPastAnswerer({
  now = Date.now,
  random = size => crypto.randomBytes(size),
  may = () => false,
  isPhone = () => false,
  sameProject = () => false,
  list = async () => ({ threads: [] }),
  send = () => false,
  onList = () => {},
} = {}) {
  // peer id → ask times this minute; one-time numbers seen; the handles of its last list
  const asks = new Map();
  const seen = new Map();
  const tables = new Map();
  const jobs = new Map();
  let busy = false;
  let stopped = false;

  const ask = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  };
  const allowed = peerId =>
    ask(may, peerId) === true && ask(isPhone, peerId) !== true && ask(sameProject, peerId) === true;

  // Counted when it arrives, before anything is read. Never throws. → true when a list was queued.
  function receive(peerId, obj) {
    if (stopped || !obj || typeof obj !== 'object' || obj.t !== 'pastask') return false;
    if (typeof peerId !== 'string' || !peerId) return false;
    const t = now();
    const times = (asks.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= PAST_ASKS_MIN) {
      asks.set(peerId, times);
      return false;
    }
    times.push(t);
    asks.set(peerId, times);
    const n = hex16(obj.n);
    if (!n) return false;
    const mine = (seen.get(peerId) || []).filter(item => t - item.at < 10 * MINUTE);
    if (mine.some(item => item.n === n)) return false;
    mine.push({ n, at: t });
    while (mine.length > 32) mine.shift();
    seen.set(peerId, mine);
    if (!allowed(peerId)) return false;

    // the newest ask of a computer takes the place of one still waiting; one list at a time
    jobs.delete(peerId);
    jobs.set(peerId, { peerId, n });
    pump();
    return true;
  }

  function pump() {
    if (busy || stopped || !jobs.size) return;
    const [peerId, job] = jobs.entries().next().value;
    jobs.delete(peerId);
    busy = true;
    Promise.resolve()
      .then(() => answer(job))
      .catch(() => {})
      .then(() => {
        busy = false;
        pump();
      });
  }

  const newHandle = () => {
    try {
      const bytes = Buffer.from(random(8));
      return bytes.length === 8 ? bytes.toString('hex') : '';
    } catch {
      return '';
    }
  };

  async function answer(job) {
    // asked again after the wait: a list whose turn came late is checked before it is read
    if (stopped || !allowed(job.peerId)) return;
    let got = null;
    try {
      got = await list();
    } catch {
      got = null;
    }
    if (stopped || !allowed(job.peerId)) return;
    const threads = Array.isArray(got?.threads) ? got.threads : [];
    const table = new Map();
    const rows = [];
    for (const thread of threads) {
      if (rows.length >= PAST_MAX) break;
      if (!thread || typeof thread.key !== 'string' || !Object.hasOwn(PAST_CLIS, thread.cli))
        continue;
      const h = newHandle();
      if (!h || table.has(h)) continue;
      const row = shapePastRow({
        h,
        cli: PAST_CLIS[thread.cli],
        title: thread.title,
        at: thread.at,
      });
      if (!row) continue;
      table.set(h, {
        key: thread.key,
        cli: thread.cli,
        id: String(thread.id || ''),
        title: row.title,
        made: now(),
      });
      rows.push(row);
    }

    // one-time: the handles of the list before this one stop working now
    tables.set(job.peerId, table);
    let sent = 0;
    for (const part of packPast(job.n, rows)) {
      let ok = false;
      try {
        ok = send(job.peerId, part) === true;
      } catch {
        ok = false;
      }
      if (!ok) break;
      sent += part.rows.length;
    }
    ask(onList, job.peerId, sent);
  }

  return {
    receive,
    // The conversation a handle names for that computer now, or null: its list is the newest one,
    // younger than 30 minutes, and the computer may still read conversations of this project.
    find(peerId, h) {
      const table = tables.get(peerId);
      const row = table && hex16(h) ? table.get(h) : null;
      if (!row || now() - row.made >= PAST_KEEP_MS || !allowed(peerId)) return null;
      return { key: row.key, cli: row.cli, id: row.id, title: row.title };
    },
    // That computer's session ended, its switch went off, or it was forgotten: its handles go.
    endFor(peerId) {
      tables.delete(peerId);
      jobs.delete(peerId);
    },
    stop() {
      stopped = true;
      tables.clear();
      jobs.clear();
    },
  };
}

// ---------- 4. the other computer's past conversations, as this computer holds them ----------
const PAST_GAP_MS = 10 * 1000;
const PAST_WAIT_MS = 15 * 1000;

// send(peerId, obj) → true when it left. nonce() → 16 hex. on.changed(peerId): what is held of that
// computer changed.
function createPastReader({
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) },
  nonce = () => crypto.randomBytes(8).toString('hex'),
  send = () => false,
  on = {},
} = {}) {
  // peer id → { state, rows, at }; n → { peerId, got: [], parts, timer }
  const held = new Map();
  const pending = new Map();
  const lastAsk = new Map();

  const tell = peerId => {
    try {
      on.changed?.(peerId);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const setState = (peerId, state) => {
    const was = held.get(peerId);
    held.set(peerId, { state, rows: was ? was.rows : [], at: now() });
    tell(peerId);
  };
  const forget = n => {
    const job = pending.get(n);
    if (!job) return;
    if (job.timer) timers.clear(job.timer);
    pending.delete(n);
  };

  // → { state: 'asked' | 'too_often' | 'not_sent', wait? }
  function ask(peerId) {
    if (typeof peerId !== 'string' || !peerId) return { state: 'not_sent' };
    const t = now();
    const gap = PAST_GAP_MS - (t - (lastAsk.get(peerId) || -Infinity));
    if (gap > 0) return { state: 'too_often', wait: gap };
    let n = '';
    try {
      n = hex16(nonce());
    } catch {
      n = '';
    }
    if (!n || pending.has(n)) return { state: 'not_sent' };
    let ok = false;
    try {
      ok = send(peerId, { t: 'pastask', n }) === true;
    } catch {
      ok = false;
    }
    if (!ok) return { state: 'not_sent' };
    lastAsk.set(peerId, t);
    for (const [other, job] of pending) if (job.peerId === peerId) forget(other);
    const job = { peerId, got: [], parts: 0, timer: null };
    job.timer = timers.set(() => {
      job.timer = null;
      if (pending.get(n) !== job) return;
      pending.delete(n);
      setState(peerId, 'no_reply');
    }, PAST_WAIT_MS);
    pending.set(n, job);
    setState(peerId, 'reading');
    return { state: 'asked' };
  }

  // A part of a list, only for a number this computer asked and still waits on, from that
  // computer, in order. Never throws.
  function receive(peerId, obj) {
    try {
      if (!obj || typeof obj !== 'object' || obj.t !== 'past') return false;
      const n = hex16(obj.n);
      const job = n ? pending.get(n) : null;
      if (!job || job.peerId !== peerId) return false;
      const parts = obj.parts;
      const fine =
        Number.isInteger(parts) &&
        parts >= 1 &&
        parts <= PAST_PARTS &&
        obj.i === job.got.length &&
        (job.parts === 0 || job.parts === parts) &&
        Array.isArray(obj.rows) &&
        obj.rows.length <= PAST_MAX;
      if (!fine) {
        forget(n);
        setState(peerId, 'no_reply');
        return true;
      }
      job.parts = parts;
      for (const raw of obj.rows) {
        const row = shapePastRow(raw);
        if (row && job.got.length < PAST_MAX && !job.got.some(one => one.h === row.h))
          job.got.push(row);
      }
      job.got.length = Math.min(job.got.length, PAST_MAX);
      job.seen = (job.seen || 0) + 1;
      if (job.seen < parts) return true;
      forget(n);
      held.set(peerId, { state: 'ready', rows: job.got, at: now() });
      tell(peerId);
      return true;
    } catch {
      return false;
    }
  }

  function drop(peerId) {
    for (const [n, job] of [...pending]) if (job.peerId === peerId) forget(n);
    lastAsk.delete(peerId);
    if (held.delete(peerId)) tell(peerId);
  }

  return {
    ask,
    receive,
    drop,
    // What is held of that computer: { state, rows: [{ h, cli: 'Claude Code' …, title, at }], at }
    get(peerId) {
      const one = held.get(peerId);
      if (!one) return null;
      return {
        state: one.state,
        at: one.at,
        rows: one.rows.map(row => ({ ...row, cli: CLI_OF_WORD[row.cli] || '' })),
      };
    },
    // Is that a handle of the list held for that computer now.
    has: (peerId, h) => !!hex16(h) && !!held.get(peerId)?.rows.some(row => row.h === h),
    dropAll() {
      for (const peerId of [...held.keys()]) drop(peerId);
      for (const n of [...pending.keys()]) forget(n);
    },
  };
}

module.exports = {
  THREAD_DO,
  THREAD_CAN,
  THREAD_WORDS,
  EFFORTS,
  NAME_MAX,
  threadValue,
  threadCan,
  shapeThread,
  shapeResume,
  createThreadActions,
  shapePastRow,
  packPast,
  createPastAnswerer,
  createPastReader,
  PAST_CLIS,
  PAST_MAX,
  PAST_ASKS_MIN,
  PAST_KEEP_MS,
  PAST_GAP_MS,
};
