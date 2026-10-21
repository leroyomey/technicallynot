// Technically Not · remote-log.js — another computer reads a running agent's conversation so far,
// so a computer that connects late still sees what the agents here said and did. "Finding N"
// below names a point of this feature's security review.
//
// Two messages and nothing else:
// - { t: 'logask', n, id, lk, cursor?, after? }: the reading computer (PC 2) asks for one agent's
//   conversation. `lk` is the log handle the agent's row carried; `cursor` asks for what came
//   before an answer it holds ("Show earlier"), `after` for what came since.
// - { t: 'log', n, i, parts, rev, more, cursor, next, older, fresh, entries }: one part of the
//   answer. { t: 'log', n, busy: true }: no room on the link now. { t: 'log' } alone: "no longer",
//   the reader drops everything it holds of that computer.
//
// Pure Node: sending, the clock, the timers, the rights and the reading of the record are handed
// in by desktop/remote-service.js. Nothing here writes to disk, and what the reader holds lives in
// memory only.
'use strict';
const crypto = require('crypto');
const { MAX_PLAIN, fields } = require('./remote-noise.js');
const { clean: line } = require('./remote-keys.js');

// How much one answer carries (security review, "Numbers approved").
const LOG_ENTRIES = 80;
const LOG_PARTS = 6;
const ENTRY_BYTES = 3000;

// How often PC 2 may ask, and PC 1 answers.
const ASK_GAP_MS = 5000;
const ASKS_MIN = 6;
const MINUTE = 60 * 1000;

// Log messages on the link for all computers together: with the live view's 40 frames this stays
// under the stream line of 70.
const LOG_MSGS_MIN = 24;

// What PC 2 holds of one computer.
const HELD_AGENTS = 6;
const HELD_ENTRIES = 400;
const HELD_BYTES = 256 * 1024;
const ASSEMBLY_MS = 15 * 1000;

// One-time numbers PC 1 remembers per computer.
const SEEN_NS = 64;
const SEEN_MS = 10 * MINUTE;
const REV_MAX = 0x7fffffff;

// The longest text of each entry kind, in characters.
const TEXT_MAX = { you: 1000, say: 2000, note: 120, title: 160 };
const WHAT_MAX = 100;
const ASK_QUESTIONS = 2;
const QUESTION_MAX = 300;
const ASK_OPTIONS = 6;
const OPTION_MAX = 80;

// The verbs the four readers write. Anything else reads "Used".
const VERBS = [
  'Read',
  'Edited',
  'Wrote',
  'Ran',
  'Searched for',
  'Looked for files',
  'Started a sub-agent',
  'Updated its checklist',
  'Opened',
  'Searched the web for',
  'Read the skill',
  'Used',
];

const hex16 = value => (typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : '');
const time = value => (Number.isFinite(value) && value > 0 && value < 1e14 ? Math.floor(value) : 0);

// A position in a record: a byte offset of a file of lines, or a creation time for OpenCode.
// Anything else reads as "none".
const position = value =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : -1;

// ---------- the secret mask (finding 22) ----------
// A second line only: the switch's sentence says prompts and commands are sent. Each shape is
// matched by its own fixed start, so ordinary words ("task-list") are not touched.
const SECRET_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{10,}/g,
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g,
  /(?<![A-Za-z0-9_])(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/g,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/g,
  /(?<![A-Za-z0-9_])xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /(?<![A-Za-z0-9_])AKIA[0-9A-Z]{16}(?![A-Za-z0-9])/g,
  /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/g,
  /(?<![A-Za-z0-9_])eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
];

function maskSecrets(text) {
  if (typeof text !== 'string' || !text) return '';
  let out = text;
  for (const shape of SECRET_SHAPES) out = out.replace(shape, '[hidden]');

  // a bearer token keeps its word, a named value keeps its name
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[hidden]');
  out = out.replace(
    /\b(password|passwd|token|secret|api_key|apikey|api-key)(\s*[=:]\s*)(["']?)(?!\[hidden\])[^\s"'&;,]+/gi,
    '$1$2$3[hidden]'
  );
  return out;
}

// ---------- paths and addresses (finding 2) ----------
// A path outside the project names the user's own folders: only its last part leaves.
const ABSOLUTE =
  /(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|root|mnt|var|tmp|opt|etc)\/)[^\s"'<>|]*/g;

function lastPart(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return '…/' + (parts.length ? parts[parts.length - 1] : '');
}

function shortenPaths(text) {
  return text.replace(ABSOLUTE, match => lastPart(match));
}

// An address: scheme, host and path only, never a user, password, query or fragment.
function shortenUrl(text) {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.protocol + '//' + url.host + url.pathname;
  } catch {
    return '';
  }
}

// ---------- one entry, field by field (finding 2) ----------
// Cut on whole characters; `cut` says when it was shortened.
function cutText(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  return { text: chars.slice(0, max).join('').trimEnd(), cut: true };
}

// Lines kept, each cleaned as one line of plain text, blank lines joined to one (as a report's
// answer is cleaned in remote-api.js `reportText`).
function textOf(value, max) {
  if (typeof value !== 'string') return { text: '', cut: false };
  const lines = [];
  for (const raw of maskSecrets(value.slice(0, 60000)).replace(/\r\n?/g, '\n').split('\n')) {
    const cleaned = line(raw, 60000);
    if (cleaned || (lines.length && lines[lines.length - 1])) lines.push(cleaned);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  return cutText(lines.join('\n'), max);
}

// What an action acts on: one line, secrets masked, outside paths and addresses shortened.
function whatOf(verb, value) {
  if (typeof value !== 'string') return { text: '', cut: false };
  let what = line(maskSecrets(value), 2000);
  if (verb === 'Opened' || /^https?:\/\//i.test(what)) what = shortenUrl(what);
  else what = shortenPaths(what);
  return cutText(what, WHAT_MAX);
}

function questionsOf(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list.slice(0, ASK_QUESTIONS) : []) {
    if (!item || typeof item !== 'object') continue;
    const words = item.q !== undefined ? item.q : item.question;
    const q = textOf(words, QUESTION_MAX).text;
    const options = [];
    for (const option of Array.isArray(item.options) ? item.options.slice(0, ASK_OPTIONS) : []) {
      const label = cutText(
        line(maskSecrets(typeof option === 'string' ? option : ''), 400),
        OPTION_MAX
      ).text;
      if (label) options.push(label);
    }
    if (q || options.length) out.push({ q, options });
  }
  return out;
}

// The one shaping of an entry, used before it leaves PC 1 and again when it arrives on PC 2. It
// builds a new object and never spreads the input, so nothing a reader adds later can leave.
// Accepts a reader's entry ({ kind }) and a shaped one ({ k }): shaping twice changes nothing.
function shapeLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = typeof entry.k === 'string' ? entry.k : entry.kind;
  const at = time(entry.at);
  const stamp = shaped => {
    if (at && kind !== 'title') shaped.at = at;
    return shaped;
  };
  if (kind === 'you' || kind === 'say' || kind === 'note' || kind === 'title') {
    const { text, cut } = textOf(entry.text, TEXT_MAX[kind]);
    if (!text) return null;
    const shaped = { k: kind, text };
    if (cut || entry.cut === true) shaped.cut = true;
    return fitEntry(stamp(shaped));
  }
  if (kind === 'act') {
    const verb = VERBS.includes(entry.verb) ? entry.verb : 'Used';
    const { text, cut } = whatOf(verb, entry.what);
    const shaped = { k: 'act', verb, what: text };
    if (cut || entry.cut === true) shaped.cut = true;
    return stamp(shaped);
  }
  if (kind === 'ask') {
    const questions = questionsOf(entry.questions);
    if (!questions.length) return null;
    return fitEntry(stamp({ k: 'ask', questions }));
  }
  if (kind === 'worked') {
    const ms = Number.isInteger(entry.ms) && entry.ms >= 0 && entry.ms < 1e10 ? entry.ms : 0;
    return stamp({ k: 'worked', ms });
  }

  // `result`, `from`, pictures, thinking and every kind not named above never leave
  return null;
}

// One entry is at most ENTRY_BYTES of JSON, so it never needs two parts. A text of wide
// characters is cut further.
function fitEntry(shaped) {
  if (!shaped) return null;
  const size = () => Buffer.byteLength(JSON.stringify(shaped));
  if (size() <= ENTRY_BYTES) return shaped;
  if (typeof shaped.text === 'string') {
    while (size() > ENTRY_BYTES && shaped.text) {
      const chars = Array.from(shaped.text);
      shaped.text = chars
        .slice(0, Math.floor(chars.length * 0.8))
        .join('')
        .trimEnd();
      shaped.cut = true;
    }
    return shaped.text ? shaped : null;
  }
  if (Array.isArray(shaped.questions)) {
    while (size() > ENTRY_BYTES && shaped.questions.length > 1) shaped.questions.pop();
    return size() <= ENTRY_BYTES ? shaped : null;
  }
  return null;
}

// ---------- the log handle (finding 3) ----------
// 16 hex characters of an HMAC over the pairing, the computer, the panel and the agent's instance,
// name, CLI, process and conversation, under a label of its own, so it can never pass as a control
// ticket. A new conversation in the same panel is a new handle.
function createLogKeys(random = size => crypto.randomBytes(size)) {
  const secret = Buffer.from(random(32));
  if (secret.length !== 32) throw new Error('remote-log: no random key');
  return {
    handle(pairing, peerId, panelId, agent, sessionId) {
      if (!pairing || !agent || typeof agent.instance !== 'string' || !agent.instance) return '';
      if (typeof sessionId !== 'string' || !sessionId) return '';
      try {
        return crypto
          .createHmac('sha256', secret)
          .update(
            fields(
              'tnai-log-v1',
              pairing,
              peerId,
              panelId,
              agent.instance,
              String(agent.name),
              String(agent.cli),
              String(agent.pid),
              String(agent.startedAt),
              sessionId
            )
          )
          .digest('hex')
          .slice(0, 16);
      } catch {
        return '';
      }
    },
  };
}

// ---------- packing an answer (finding 5) ----------
// The fixed fields of one part at their widest, to count the room left for entries.
const HEAD_WORST = {
  t: 'log',
  n: 'f'.repeat(16),
  i: 9,
  parts: 9,
  rev: REV_MAX,
  more: true,
  cursor: Number.MAX_SAFE_INTEGER,
  next: Number.MAX_SAFE_INTEGER,
  older: true,
  fresh: true,
  entries: [],
};
const PART_ROOM = MAX_PLAIN - Buffer.byteLength(JSON.stringify(HEAD_WORST));

// entries: the shaped entries of one read, oldest first, each with `pos` (where its line starts).
// The newest go first, a line's entries all or none, until LOG_ENTRIES or LOG_PARTS is reached.
// → { parts: [[entry, …], …] oldest first, cursor: where the oldest sent line starts, more }
function packAnswer(entries) {
  const groups = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.pos === entry.pos) last.items.push(entry.shaped);
    else groups.push({ pos: entry.pos, items: [entry.shaped] });
  }
  const parts = [[]];
  let used = 0;
  let count = 0;
  let cursor = -1;
  let more = false;
  for (let g = groups.length - 1; g >= 0; g--) {
    const group = groups[g];
    const sizes = group.items.map(item => Buffer.byteLength(JSON.stringify(item)) + 1);

    // a dry run: does the whole line fit in what is left?
    let tryParts = parts.length;
    let tryUsed = used;
    let fits = count + group.items.length <= LOG_ENTRIES;
    for (const size of fits ? sizes : []) {
      if (tryUsed + size > PART_ROOM) {
        tryParts++;
        tryUsed = 0;
      }
      tryUsed += size;
      if (tryParts > LOG_PARTS) fits = false;
    }
    if (!fits) {
      more = true;
      break;
    }
    for (let i = group.items.length - 1; i >= 0; i--) {
      if (used + sizes[i] > PART_ROOM) {
        parts.push([]);
        used = 0;
      }
      parts[parts.length - 1].unshift(group.items[i]);
      used += sizes[i];
      count++;
    }
    cursor = group.pos;
  }

  // filled newest first: the last part filled holds the oldest entries
  const ordered = parts.filter(part => part.length).reverse();
  return { parts: ordered, cursor, more };
}

// The cut of decision B: an entry older than the pairing is not sent. An entry without a time
// takes the time of the entry before it; before the first timed entry it counts as older.
// entries: oldest first. → { kept, older }
function applyCut(entries, cutAt) {
  if (!(cutAt > 0)) return { kept: entries, older: false };
  let lastAt = 0;
  const marked = entries.map(entry => {
    if (entry.shaped.at) lastAt = entry.shaped.at;
    return { entry, at: lastAt };
  });
  const kept = marked.filter(item => item.at >= cutAt).map(item => item.entry);
  return { kept, older: kept.length < entries.length };
}

// ---------- PC 1: answering (findings 3, 5, 6, 8, 9, 14, 15, 17, 18, 21) ----------
// may(peerId) → conversations may go to that computer now (switch, its version, session, trust).
// isPhone(peerId) → that pairing is a phone (refused until the phone has its own review).
// check(peerId, panelId, lk) → null, or { record } when lk is that agent's handle now and the agent
// works in the project that computer has open. Asked at the ask, before the read and before each
// part. read(record, { cursor, after }) → Promise<{ entries (reader entries with pos), more,
// next, fresh }>. cutFrom(peerId) → the pairing's time. onRead(peerId, panelId): the read was
// answered (once per agent per session). send(peerId, obj) → true when it left (class stream).
// room() → stream messages the link may still send this minute.
function createLogAnswerer({
  now = Date.now,
  may = () => false,
  isPhone = () => false,
  check = () => null,
  read = async () => ({ entries: [] }),
  cutFrom = () => Infinity,
  onRead = () => {},
  send = () => false,
  room = () => 0,
  rev = () => 0,
}) {
  // peer id → times of its asks in the last minute; one-time numbers seen; the queued job
  const asks = new Map();
  const seenNs = new Map();
  const jobs = new Map();

  // peer id → a number that grows whenever what was asked of it must stop
  const epochs = new Map();
  const readOnce = new Set();
  const logSent = [];
  let busy = false;
  let stopped = false;
  let reads = 0;

  const ask = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  };
  const epochOf = peerId => epochs.get(peerId) || 0;
  const recentLogs = () => {
    const t = now();
    while (logSent.length && t - logSent[0] >= MINUTE) logSent.shift();
    return logSent.length;
  };
  const sendLog = (peerId, obj) => {
    let ok = false;
    try {
      ok = send(peerId, obj) === true;
    } catch {
      ok = false;
    }
    if (ok) logSent.push(now());
    return ok;
  };
  const allowed = peerId => ask(may, peerId) === true && ask(isPhone, peerId) !== true;

  // Counted when it arrives, before anything is looked up. Never throws.
  function receive(peerId, obj) {
    if (stopped || !obj || typeof obj !== 'object' || obj.t !== 'logask') return false;
    const t = now();
    const times = (asks.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= ASKS_MIN) {
      asks.set(peerId, times);
      return false;
    }
    times.push(t);
    asks.set(peerId, times);
    const n = hex16(obj.n);
    const lk = hex16(obj.lk);
    const id = line(obj.id, 80);
    if (!n || !lk || !id) return false;

    // the same number twice is answered once
    const seen = (seenNs.get(peerId) || []).filter(item => t - item.at < SEEN_MS);
    if (seen.some(item => item.n === n)) return false;
    seen.push({ n, at: t });
    while (seen.length > SEEN_NS) seen.shift();
    seenNs.set(peerId, seen);
    if (!allowed(peerId)) return false;

    // The handle is checked at the ask too, and the conversation it names is noted: one that
    // changes before the read is not read.
    const atAsk = ask(check, peerId, id, lk);
    if (!atAsk || !atAsk.record) return false;

    // `sub` is never read: a helper's own record is not sent (finding 21)
    const job = {
      peerId,
      n,
      id,
      lk,
      cursor: position(obj.cursor),
      after: position(obj.after),
      epoch: epochOf(peerId),
      session: atAsk.record.sessionId,
    };

    // the newest ask of a computer takes the place of one still waiting
    jobs.delete(peerId);
    jobs.set(peerId, job);
    pump();
    return true;
  }

  function pump() {
    if (busy || stopped || !jobs.size) return;
    const [peerId, job] = jobs.entries().next().value;
    jobs.delete(peerId);
    busy = true;
    Promise.resolve()
      .then(() => run(job))
      .catch(() => {})
      .then(() => {
        busy = false;
        pump();
      });
  }

  const stillGood = (job, record) => {
    if (stopped || epochOf(job.peerId) !== job.epoch || !allowed(job.peerId)) return null;
    const now2 = ask(check, job.peerId, job.id, job.lk);
    if (!now2 || !now2.record) return null;
    if (record && now2.record.sessionId !== record.sessionId) return null;
    return now2;
  };

  async function run(job) {
    // a job whose turn came late is checked again before the read (lesson: the asker never sets
    // how often this computer works)
    const first = stillGood(job, { sessionId: job.session });
    if (!first) return;
    reads++;
    let got = null;
    try {
      got = await read(first.record, {
        cursor: job.cursor >= 0 ? job.cursor : undefined,
        after: job.cursor < 0 && job.after >= 0 ? job.after : undefined,
      });
    } catch {
      got = null;
    }
    if (!got || !stillGood(job, first.record)) return;
    const shaped = [];
    for (const entry of Array.isArray(got.entries) ? got.entries : []) {
      const one = shapeLogEntry(entry);
      if (one) shaped.push({ pos: position(entry.pos), shaped: one });
    }
    let cutAt = Infinity;
    try {
      const t = cutFrom(job.peerId);
      cutAt = Number.isFinite(t) ? t : Infinity;
    } catch {
      cutAt = Infinity;
    }
    if (cutAt === Infinity) return;
    const { kept, older } = applyCut(shaped, cutAt);
    const packed = packAnswer(kept);

    // Older entries exist when the answer stopped before them, or the read itself did not reach
    // the start; never past the cut, which nothing reaches.
    const more = packed.more || (!older && got.more === true);
    const parts = packed.parts.length ? packed.parts : [[]];

    // An answer starts only when it can finish: the stream line and the log count both have room
    // for all of its parts. Otherwise one small "busy".
    const roomNow = Number(ask(room)) || 0;
    if (recentLogs() + parts.length > LOG_MSGS_MIN || roomNow < parts.length) {
      if (recentLogs() < LOG_MSGS_MIN && roomNow >= 1)
        sendLog(job.peerId, { t: 'log', n: job.n, busy: true });
      return;
    }
    const revNow = Number.isInteger(ask(rev, job.id)) ? ask(rev, job.id) : 0;
    for (let i = 0; i < parts.length; i++) {
      // the switch, the session or the agent changed: nothing more leaves
      if (!stillGood(job, first.record)) return;
      const message = { t: 'log', n: job.n, i, parts: parts.length, rev: revNow };
      if (i === 0) {
        if (more) message.more = true;
        if (packed.cursor >= 0) message.cursor = packed.cursor;
        if (position(got.next) >= 0) message.next = position(got.next);
        if (older) message.older = true;
        if (got.fresh === true || (job.after < 0 && job.cursor < 0)) message.fresh = true;
      }
      message.entries = parts[i];
      if (!sendLog(job.peerId, message)) return;
    }
    const key = job.peerId + '\n' + job.id;
    if (!readOnce.has(key)) {
      readOnce.add(key);
      ask(onRead, job.peerId, job.id);
    }
  }

  // A session started or ended, the pairing was paused or forgotten, the switch went off: what
  // waits is dropped and what is under way sends nothing more.
  function endFor(peerId) {
    jobs.delete(peerId);
    epochs.set(peerId, epochOf(peerId) + 1);
    for (const key of [...readOnce]) if (key.startsWith(peerId + '\n')) readOnce.delete(key);
  }

  return {
    receive,
    endFor,
    // "No longer": that computer drops what it holds of this one (the switch went off).
    noLonger(peerId) {
      endFor(peerId);
      try {
        return send(peerId, { t: 'log' }) === true;
      } catch {
        return false;
      }
    },
    stop() {
      stopped = true;
      jobs.clear();
      for (const peerId of epochs.keys()) epochs.set(peerId, epochOf(peerId) + 1);
    },
    // for the tests: how many reads of a record were started
    reads: () => reads,
  };
}

// ---------- the turn counter `rev` (finding 14) ----------
// Per agent instance (so per handle): starts at 0 for a new one, grows at a turn's start and end
// only.
function createRevs() {
  const revs = new Map();
  return {
    bump(panelId, identity) {
      const known = revs.get(panelId);
      const rev = known && known.identity === identity ? Math.min(known.rev + 1, REV_MAX) : 1;
      revs.set(panelId, { identity, rev });
      return rev;
    },
    of(panelId, identity) {
      const known = revs.get(panelId);
      return known && known.identity === identity ? known.rev : 0;
    },
    drop(panelId) {
      revs.delete(panelId);
    },
  };
}

// ---------- PC 2: asking and holding (findings 8, 13, 20) ----------
// row(peerId, agentId) → { id, lk } of a row this computer may ask about now (live session, the
// project open here), or null. send(peerId, obj) → true when it left. on.changed(peerId, agentId):
// what is held of that agent changed (never carries the words).
function createLogReader({
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) },
  nonce = () => crypto.randomBytes(8).toString('hex'),
  row = () => null,
  send = () => false,
  on = {},
}) {
  // peer id → Map agent id → { lk, entries, bytes, more, cursor, next, older, rev, at, state }
  const held = new Map();

  // n → { peerId, agentId, lk, which, got: [], parts, timer }
  const pending = new Map();

  // peer id → ask times this minute; "peer\nagent" → the last ask
  const asked = new Map();
  const lastAsk = new Map();

  const tell = (peerId, agentId) => {
    try {
      on.changed?.(peerId, agentId);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const holdOf = peerId => {
    if (!held.has(peerId)) held.set(peerId, new Map());
    return held.get(peerId);
  };
  const forgetPending = n => {
    const job = pending.get(n);
    if (!job) return;
    if (job.timer) timers.clear(job.timer);
    pending.delete(n);
  };
  const setState = (peerId, agentId, state) => {
    const mine = holdOf(peerId);
    const log = mine.get(agentId) || null;
    if (log) {
      log.state = state;
      log.at = now();
    } else mine.set(agentId, { lk: '', entries: [], bytes: 0, state, at: now() });
    tell(peerId, agentId);
  };

  // which: 'first' (the newest), 'earlier' (Show earlier) or 'new' (what came since). → { state,
  // wait? }: 'asked', 'too_often' (with the milliseconds to wait), 'not_sent', 'full', 'none'.
  function ask(peerId, agentId, which = 'first') {
    let target = null;
    try {
      target = row(peerId, agentId);
    } catch {
      target = null;
    }
    if (!target || !hex16(target.lk)) return { state: 'not_sent' };
    const log = held.get(peerId)?.get(agentId) || null;
    const same = log && log.lk === target.lk;
    if (which === 'earlier') {
      if (!same || !log.more || !(log.cursor >= 0)) return { state: 'none' };
      if (log.entries.length >= HELD_ENTRIES) return { state: 'full' };
    }
    const t = now();
    const key = peerId + '\n' + agentId;
    const gap = ASK_GAP_MS - (t - (lastAsk.get(key) || -Infinity));
    if (gap > 0) return { state: 'too_often', wait: gap };
    const times = (asked.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= ASKS_MIN) return { state: 'too_often', wait: MINUTE - (t - times[0]) };
    let n = '';
    try {
      n = hex16(nonce());
    } catch {
      n = '';
    }
    if (!n || pending.has(n)) return { state: 'not_sent' };
    const message = { t: 'logask', n, id: target.id, lk: target.lk };
    if (which === 'earlier') message.cursor = log.cursor;
    else if (which === 'new' && same && log.next >= 0) message.after = log.next;
    let ok = false;
    try {
      ok = send(peerId, message) === true;
    } catch {
      ok = false;
    }
    if (!ok) return { state: 'not_sent' };
    times.push(t);
    asked.set(peerId, times);
    lastAsk.set(key, t);

    // one assembling answer per agent: an older one still on its way is dropped
    for (const [other, job] of pending)
      if (job.peerId === peerId && job.agentId === agentId) forgetPending(other);
    const job = {
      peerId,
      agentId,
      lk: target.lk,
      which:
        message.cursor !== undefined ? 'earlier' : message.after !== undefined ? 'new' : 'first',
      got: [],
      parts: 0,
      head: null,
      timer: null,
    };
    job.timer = timers.set(() => {
      job.timer = null;
      if (pending.get(n) !== job) return;
      pending.delete(n);
      setState(peerId, agentId, 'no_reply');
    }, ASSEMBLY_MS);
    pending.set(n, job);
    if (!log || log.lk !== target.lk) setState(peerId, agentId, 'reading');
    return { state: 'asked' };
  }

  // A part of an answer, or "busy", or "no longer". Only for a number this computer asked and still
  // waits on, from that computer. Never throws.
  function receive(peerId, obj) {
    try {
      if (!obj || typeof obj !== 'object' || obj.t !== 'log') return false;
      const n = hex16(obj.n);
      if (!n) {
        if (obj.n === undefined && obj.busy === undefined && obj.entries === undefined) {
          drop(peerId);
          return true;
        }
        return false;
      }
      const job = pending.get(n);
      if (!job || job.peerId !== peerId) return false;
      if (obj.busy === true) {
        forgetPending(n);
        setState(peerId, job.agentId, 'busy');
        return true;
      }
      const parts = obj.parts;
      const i = obj.i;
      const fine =
        Number.isInteger(parts) &&
        parts >= 1 &&
        parts <= LOG_PARTS &&
        Number.isInteger(i) &&
        i === job.got.length &&
        (job.parts === 0 || job.parts === parts) &&
        Array.isArray(obj.entries);
      if (!fine) {
        forgetPending(n);
        setState(peerId, job.agentId, 'no_reply');
        return false;
      }
      if (i === 0)
        job.head = {
          rev: Number.isInteger(obj.rev) && obj.rev >= 0 && obj.rev <= REV_MAX ? obj.rev : 0,
          more: obj.more === true,
          cursor: position(obj.cursor),
          next: position(obj.next),
          older: obj.older === true,
          fresh: obj.fresh === true,
        };
      job.parts = parts;
      job.got.push(obj.entries.slice(0, LOG_ENTRIES));
      if (job.got.length < parts) return true;
      forgetPending(n);
      const entries = [];
      for (const raw of job.got.flat()) {
        if (entries.length >= LOG_ENTRIES) break;
        const one = shapeLogEntry(raw);
        if (one) entries.push(one);
      }
      keep(peerId, job, entries);
      return true;
    } catch {
      return false;
    }
  }

  function keep(peerId, job, entries) {
    const mine = holdOf(peerId);
    const before = mine.get(job.agentId);
    const was = before && before.lk === job.lk && before.entries.length ? before : null;
    const head = job.head || {};
    let list;
    let cursor = head.cursor;
    let more = head.more;
    let older = head.older;
    let next = head.next;
    if (job.which === 'earlier' && was) {
      list = entries.concat(was.entries);
      next = was.next;
    } else if (job.which === 'new' && was && !head.fresh) {
      list = was.entries.concat(entries);
      cursor = was.cursor;
      more = was.more;
      older = was.older;
    } else list = entries;

    // bounded: the newest HELD_ENTRIES and HELD_BYTES of one agent
    let cutOld = false;
    while (list.length > HELD_ENTRIES) {
      list.shift();
      cutOld = true;
    }
    let bytes = list.reduce((sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)), 0);
    while (bytes > HELD_BYTES && list.length) {
      bytes -= Buffer.byteLength(JSON.stringify(list.shift()));
      cutOld = true;
    }
    mine.delete(job.agentId);
    mine.set(job.agentId, {
      lk: job.lk,
      entries: list,
      bytes,
      more: more === true || cutOld,
      full: list.length >= HELD_ENTRIES,
      cursor,
      next,
      older: older === true,
      rev: head.rev || 0,
      at: now(),
      state: 'held',
    });

    // at most HELD_AGENTS of one computer: the one held longest goes first
    while (mine.size > HELD_AGENTS) {
      const oldest = mine.keys().next().value;
      mine.delete(oldest);
      tell(peerId, oldest);
    }
    tell(peerId, job.agentId);
  }

  // Everything of that computer goes: its session ended, it was paused or forgotten, it said "no
  // longer", connecting went off.
  function drop(peerId) {
    for (const [n, job] of [...pending]) if (job.peerId === peerId) forgetPending(n);
    const mine = held.get(peerId);
    held.delete(peerId);
    for (const key of [...lastAsk.keys()]) if (key.startsWith(peerId + '\n')) lastAsk.delete(key);
    if (mine) for (const agentId of mine.keys()) tell(peerId, agentId);
  }

  return {
    ask,
    receive,
    drop,
    // One agent's log as held, or null: drops it when the row no longer carries the same handle.
    dropAgent(peerId, agentId) {
      const mine = held.get(peerId);
      if (mine && mine.delete(agentId)) tell(peerId, agentId);
    },
    get(peerId, agentId) {
      const log = held.get(peerId)?.get(agentId);
      if (!log) return null;
      return {
        state: log.state,
        entries: log.entries.map(entry => JSON.parse(JSON.stringify(entry))),
        more: log.more === true,
        full: log.full === true,
        older: log.older === true,
        rev: log.rev || 0,
        at: log.at,
      };
    },
    // what the state push may carry: the handle it was read for, its turn counter, when it came,
    // and where it stands; never a word of it
    mark(peerId, agentId) {
      const log = held.get(peerId)?.get(agentId);
      return log ? { lk: log.lk, rev: log.rev || 0, at: log.at, state: log.state } : null;
    },
    held: peerId => [...(held.get(peerId)?.keys() || [])],
    dropAll() {
      for (const peerId of [...held.keys()]) drop(peerId);
      for (const n of [...pending.keys()]) forgetPending(n);
    },
  };
}

module.exports = {
  shapeLogEntry,
  maskSecrets,
  shortenUrl,
  shortenPaths,
  packAnswer,
  applyCut,
  createLogKeys,
  createLogAnswerer,
  createLogReader,
  createRevs,
  VERBS,
  LOG_ENTRIES,
  LOG_PARTS,
  ENTRY_BYTES,
  ASK_GAP_MS,
  ASKS_MIN,
  LOG_MSGS_MIN,
  HELD_AGENTS,
  HELD_ENTRIES,
  HELD_BYTES,
  ASSEMBLY_MS,
  SEEN_NS,
  REV_MAX,
};
