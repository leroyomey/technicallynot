// Technically Not phone app · conversation.mjs — the phone reads a paired computer's agent's
// conversation so far: the phone's copy of the reading half of desktop/remote-log.js ("late join").
// It speaks the same two messages and shapes every entry with the same rules:
// - { t: 'logask', n, id, lk, cursor?, after? }: the phone asks for one agent's conversation. `lk`
//   is the log handle the agent's row carried (control.mjs keeps it); `cursor` asks for what came
//   before ("Show earlier"), `after` for what came since.
// - { t: 'log', n, i, parts, rev, more, cursor, next, older, fresh, entries }: one part of the
//   answer. { t: 'log', n, busy: true }: no room on the link now. { t: 'log' } alone: "no longer".
// phone/test/conversation-test.mjs runs it against the desktop's real answerer.
//
// The computer decides whether a conversation may be read at all (it puts `lk` on a row only then)
// and what leaves (results, pictures and thinking never do). The phone shapes every entry again as
// untrusted text, holds a bounded amount in memory only, and stores nothing.
import { clean as line } from './keys.mjs';

// The same numbers as desktop/remote-log.js.
const LOG_ENTRIES = 80;
const LOG_PARTS = 6;
const ENTRY_BYTES = 3000;
export const ASK_GAP_MS = 5000;
const ASKS_MIN = 6;
const MINUTE = 60 * 1000;
const HELD_AGENTS = 6;
const HELD_ENTRIES = 400;
const HELD_BYTES = 256 * 1024;
const ASSEMBLY_MS = 15 * 1000;
const REV_MAX = 0x7fffffff;
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
const position = value =>
  Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? Math.floor(value) : -1;
const bytesOf = value => new TextEncoder().encode(JSON.stringify(value)).length;

// ---------- the secret mask, the same shapes as the computer's ----------
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
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, '$1[hidden]');
  out = out.replace(
    /\b(password|passwd|token|secret|api_key|apikey|api-key)(\s*[=:]\s*)(["']?)(?!\[hidden\])[^\s"'&;,]+/gi,
    '$1$2$3[hidden]'
  );
  return out;
}

// A path outside the project: only its last part is shown.
const ABSOLUTE =
  /(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\/(?:Users|home|root|mnt|var|tmp|opt|etc)\/)[^\s"'<>|]*/g;

function lastPart(path) {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return '…/' + (parts.length ? parts[parts.length - 1] : '');
}

const shortenPaths = text => text.replace(ABSOLUTE, match => lastPart(match));

// An address: scheme, host and path only.
function shortenUrl(text) {
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.protocol + '//' + url.host + url.pathname;
  } catch {
    return '';
  }
}

function cutText(text, max) {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  return { text: chars.slice(0, max).join('').trimEnd(), cut: true };
}

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

function fitEntry(shaped) {
  if (!shaped) return null;
  if (bytesOf(shaped) <= ENTRY_BYTES) return shaped;
  if (typeof shaped.text === 'string') {
    while (bytesOf(shaped) > ENTRY_BYTES && shaped.text) {
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
    while (bytesOf(shaped) > ENTRY_BYTES && shaped.questions.length > 1) shaped.questions.pop();
    return bytesOf(shaped) <= ENTRY_BYTES ? shaped : null;
  }
  return null;
}

// One entry, shaped as the computer shapes it: `you` (the user's prompt), `say` (the agent's
// words), `note`, `title`, `act` (a verb and what it acted on), `ask` (questions with options),
// `worked` (how long a turn took). Every other kind is dropped.
export function shapeLogEntry(entry) {
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
  return null;
}

const randomN = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};

// row(peerId, agentId) → { id, lk } of a row that carries a log handle now, or null (control.mjs).
// send(peerId, obj) → boolean or Promise<boolean>. on.changed(peerId, agentId).
export function createConversation({
  now = () => performance.now(),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) },
  nonce = randomN,
  row = () => null,
  send = () => false,
  on = {},
}) {
  // peer id → Map agent id → { lk, entries, bytes, more, cursor, next, older, rev, at, state }
  const held = new Map();

  // n → { peerId, agentId, lk, which, got: [], parts, head, timer }
  const pending = new Map();
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
  async function ask(peerId, agentId, which = 'first') {
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
    const gap = ASK_GAP_MS - (t - (lastAsk.get(key) ?? -Infinity));
    if (gap > 0) return { state: 'too_often', wait: gap };
    const times = (asked.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= ASKS_MIN) return { state: 'too_often', wait: MINUTE - (t - times[0]) };
    const n = hex16(nonce());
    if (!n || pending.has(n)) return { state: 'not_sent' };
    const message = { t: 'logask', n, id: target.id, lk: target.lk };
    if (which === 'earlier') message.cursor = log.cursor;
    else if (which === 'new' && same && log.next >= 0) message.after = log.next;

    // Waiting before it leaves: the answer may come before the send has finished.
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
    pending.set(n, job);
    times.push(t);
    asked.set(peerId, times);
    lastAsk.set(key, t);
    let ok = false;
    try {
      ok = (await send(peerId, message)) === true;
    } catch {
      ok = false;
    }
    if (!ok) {
      forgetPending(n);
      return { state: 'not_sent' };
    }
    if (pending.get(n) === job)
      job.timer = timers.set(() => {
        job.timer = null;
        if (pending.get(n) !== job) return;
        pending.delete(n);
        setState(peerId, agentId, 'no_reply');
      }, ASSEMBLY_MS);
    if (pending.get(n) === job && (!log || log.lk !== target.lk))
      setState(peerId, agentId, 'reading');
    return { state: 'asked' };
  }

  // A part of an answer, or "busy", or "no longer". Only for a number this phone asked and still
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
    let bytes = list.reduce((sum, entry) => sum + bytesOf(entry), 0);
    while (bytes > HELD_BYTES && list.length) {
      bytes -= bytesOf(list.shift());
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
    while (mine.size > HELD_AGENTS) {
      const oldest = mine.keys().next().value;
      mine.delete(oldest);
      tell(peerId, oldest);
    }
    tell(peerId, job.agentId);
  }

  // Everything of that computer goes: its session ended, it was forgotten, it said "no longer".
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
    get(peerId, agentId) {
      const log = held.get(peerId)?.get(agentId);
      if (!log) return null;
      return {
        state: log.state,
        lk: log.lk,
        entries: log.entries.map(entry => JSON.parse(JSON.stringify(entry))),
        more: log.more === true,
        full: log.full === true,
        older: log.older === true,
        rev: log.rev || 0,
        at: log.at,
      };
    },
    dropAll() {
      for (const peerId of [...held.keys()]) drop(peerId);
      for (const n of [...pending.keys()]) forgetPending(n);
    },
  };
}
