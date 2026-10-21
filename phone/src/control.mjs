// Technically Not phone app · control.mjs — the phone as a controller of a paired computer's
// agents: what that computer says about its agents, and the operations the phone asks of it. It is
// the phone's copy of the controller half of desktop/remote-api.js and reads and writes the same
// messages; phone/test/control-test.mjs runs it against the desktop's real remote-api.js and
// remote-control.js as the computer.
//
// Read (every field again as untrusted text, shaped exactly as the sender shapes it):
// - `agents` (the computer's agent list, in parts): name, CLI, status, task, project key, and the
//   ticket `to` on a row this phone may control.
// - `control`: "you may control my agents" with the counter to echo and the CLIs that can be
//   started there; without a counter it means "no longer".
// - `project`: which project is open on that computer (two commit ids).
// - `report`: one finished task of one agent.
// - `needs`: only for the questions that carry their options (a choice, 6i); the rest of the list
//   is needs.mjs's.
// - the replies `prompted`, `acted`, `started`, `chosen`, `threaded`, `resumed`: only for an
//   operation this phone sent, of that kind, and only as one of that kind's fixed words.
//
// Sent (each with a one-time number `n`, the newest counter `c` and the milliseconds `ms` since it
// arrived, so a message the relay held back is refused there):
// - prompt, act (interrupt or stop), choose, start, and the thread controls of plan item 44
//   (rename, close, model, effort) and resume.
//
// The phone is a controller only (rule 7): it never sends a list of its own. Nothing here decides
// whether an operation is carried out: the computer checks every one again when it arrives
// (desktop/remote-control.js), and the phone only offers the buttons its last word allows. Nothing
// queues: without a live session nothing is sent and the caller is told. Nothing is stored.
import { clean } from './keys.mjs';
import { sha256, fields, MAX_PLAIN } from './noise.mjs';

// The same numbers as desktop/remote-api.js.
export const REPLY_MS = 15 * 1000;
export const QUEUED_MS = 10 * 60 * 1000 + REPLY_MS;
const BEAT_MS = 60 * 1000;
export const STALE_MS = 2 * BEAT_MS + 10 * 1000;
const MAX_AGENTS = 100;
const MAX_ITEMS = 200;
const OPS_MAX = 20;
const STAMP_MAX = 0x7fffffff;
const REPORT_TASK = 120;
const REPORT_DID = 240;
const REPORT_TEXT = 4000;
const REPORT_MORE = 9999999;
const REPORTS_MAX = 12;
const MINUTE = 60 * 1000;

// the CLIs a start may name, as the computer's fixed words
export const START_CLIS = ['claude', 'codex', 'opencode', 'cursor'];

// anything else is read as idle: never "working" by mistake
const STATUS = new Set(['working', 'needs', 'idle']);
const KINDS = new Set(['permission', 'menu', 'trust', 'question', 'error', 'draft']);

// What an operation can end on. Anything else in a reply is not taken.
export const OP_WORDS = {
  prompt: ['sent', 'queued', 'unconfirmed', 'refused', 'failed'],
  act: ['done', 'unsent', 'refused', 'failed'],
  start: ['started', 'refused', 'failed'],
  choose: ['done', 'refused', 'failed'],
  thread: ['done', 'busy', 'refused', 'failed'],
  resume: ['started', 'refused', 'failed'],
};
const OP_REPLY = {
  prompt: 'prompted',
  act: 'acted',
  start: 'started',
  choose: 'chosen',
  thread: 'threaded',
  resume: 'resumed',
};

// states a reply may still change
const OP_OPEN = new Set(['asked', 'queued', 'no_reply']);

// The thread controls the phone offers (plan item 44). Their values are checked again by the
// computer (desktop/remote-thread.js); here only the words.
export const THREAD_DO = ['rename', 'close', 'model', 'effort'];

const time = t => (Number.isFinite(t) && t > 0 && t < 1e14 ? Math.floor(t) : 0);
const hex16 = v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '');
const stampOf = v => (Number.isInteger(v) && v > 0 && v <= STAMP_MAX ? v : 0);
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const commit = v => (typeof v === 'string' && COMMIT.test(v) ? v : '');
const PKEY = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|n[0-9a-f]{40})$/;
const projectKey = v => (typeof v === 'string' && PKEY.test(v) ? v : '');
const bytesOf = s => new TextEncoder().encode(s).length;

// ---- the shaping, the same as the sender's ----

// One agent row (desktop/remote-api.js shapeAgent, with its detail).
export function shapeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const id = clean(a.id, 80);
  const name = clean(a.name, 60);
  if (!id || !name) return null;
  const out = {
    id,
    name,
    cli: clean(a.cli, 40),
    status: STATUS.has(a.status) ? a.status : 'idle',
    since: time(a.since),
  };
  if (a.task != null && clean(a.task, 120)) out.task = clean(a.task, 120);
  if (projectKey(a.p)) out.p = projectKey(a.p);
  if (hex16(a.to)) out.to = a.to;
  if (hex16(a.lk)) {
    out.lk = a.lk;
    if (Number.isInteger(a.rev) && a.rev >= 0 && a.rev <= STAMP_MAX) out.rev = a.rev;
  }
  return out;
}

// Which project is open there: two commit ids or nothing.
function shapeProject(p) {
  if (!p || typeof p !== 'object') return null;
  const root = commit(p.root);
  return root ? { root, head: commit(p.head) } : null;
}

// What that computer lets this phone control: the counter and the fixed CLI words, or nothing.
function shapeControl(m) {
  if (!m || typeof m !== 'object') return null;
  const c = stampOf(m.c);
  if (!c || !Array.isArray(m.clis)) return null;
  return {
    c,
    clis: START_CLIS.filter(w => m.clis.includes(w)),
    watch: m.watch === true,
  };
}

// A finished task's answer: each line cleaned as one line, blank lines joined, cut on whole
// characters (desktop/remote-api.js reportText and cutChars).
function reportText(v) {
  if (typeof v !== 'string') return '';
  const out = [];
  for (const raw of v.slice(0, 60000).replace(/\r\n?/g, '\n').split('\n')) {
    const l = clean(raw, 60000);
    if (l || (out.length && out[out.length - 1])) out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  const chars = Array.from(out.join('\n'));
  return chars.length > REPORT_TEXT
    ? chars.slice(0, REPORT_TEXT).join('').trimEnd()
    : chars.join('');
}

export function shapeReport(r) {
  if (!r || typeof r !== 'object') return null;
  const id = clean(r.id, 80);
  const name = clean(r.name, 60);
  const at = time(r.at);
  const did = clean(r.did, REPORT_DID);
  const text = reportText(r.text);
  if (!id || !name || !at || (!did && !text)) return null;
  const out = {
    id,
    name,
    cli: clean(r.cli, 40),
    at,
    task: clean(r.task, REPORT_TASK),
    did,
    text,
    more: Number.isInteger(r.more) && r.more > 0 ? Math.min(r.more, REPORT_MORE) : 0,
  };
  if (projectKey(r.p)) out.p = projectKey(r.p);
  return out;
}

// A question that takes a choice (desktop/remote-control.js pickLabels, readPick, bindingPick): 1
// to 9 different labels of one clean line each, and the agent row it belongs to.
const pickLabels = v =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= 9 &&
  v.every(l => typeof l === 'string' && l !== '' && clean(l, 80) === l) &&
  new Set(v).size === v.length
    ? [...v]
    : null;

const b64 = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

// The binding the computer checks a choice against: every field the user was shown.
export const bindingPick = async it =>
  b64(
    (
      await sha256(
        fields(
          'tnai-key-v1',
          it.id,
          it.kind,
          it.agent,
          it.detail || '',
          String(it.since),
          String(it.row || ''),
          String((it.opts || []).length),
          ...(it.opts || [])
        )
      )
    ).subarray(0, 12)
  );

// One item of `needs`, kept only when it is a question with its options.
async function readChoice(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 80);
  if (!id) return null;
  const s = {
    id,
    kind: KINDS.has(raw.kind) ? raw.kind : 'other',
    agent: clean(raw.agent, 60),
    since: time(raw.since),
    inferred: raw.inferred === true,
  };
  if (!s.inferred && raw.detail != null && clean(raw.detail, 100))
    s.detail = clean(raw.detail, 100);
  const opts = pickLabels(raw.opts);
  const row =
    typeof raw.row === 'string' && raw.row !== '' && clean(raw.row, 80) === raw.row ? raw.row : '';
  if (s.kind !== 'menu' || s.inferred || !s.detail || !opts || !row) return null;
  const out = { ...s, opts, row };
  out.kof = await bindingPick(out);
  return out;
}

// A prompt the computer will take: its first visible character is a letter or a digit
// (desktop/remote-control.js promptText). The phone checks it first only to say so at once.
export function promptOk(v) {
  if (typeof v !== 'string') return false;
  const body = v.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
  return /^[\p{L}\p{N}]/u.test(clean(body, Infinity));
}

const randomN = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};

// send(peerId, obj) → boolean or Promise<boolean> (link.mjs send). on.changed(peerId) fires when
// what is known of that computer changed. now = a clock that cannot be turned back.
export function createControl({
  send,
  on = {},
  now = () => performance.now(),
  wall = Date.now,
  nonce = randomN,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
}) {
  // peer id → { live, heard, heardWall, agents, aparts, ctl, fresh, project, reports, rin,
  // choices, cparts, ops }
  const views = new Map();
  let stopped = false;

  const emit = id => {
    try {
      on.changed?.(id);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const fresh = () => ({
    live: true,
    heard: now(),
    heardWall: wall(),
    agents: [],
    aparts: null,
    ctl: null,
    fresh: null,
    project: null,
    reports: new Map(),
    rin: [],
    choices: [],
    cparts: null,
    ops: new Map(),
  });
  const heardNow = v => {
    v.heard = now();
    v.heardWall = wall();
  };
  const unwait = e => {
    if (e.timer) {
      timers.clear(e.timer);
      e.timer = null;
    }
  };

  // Parts of one list: { g, n, got }, started by its first part, in order, else dropped.
  function addPart(parts, obj, key) {
    const { g, i, n } = obj;
    if (!Number.isInteger(g) || !Number.isInteger(i) || !Number.isInteger(n)) return { parts };
    if (n < 1 || n > 64 || i < 0 || i >= n || !Array.isArray(obj[key])) return { parts };
    let p = parts;
    if (!p || p.g !== g) {
      if (i !== 0) return { parts: p };
      p = { g, n, got: [] };
    }
    if (p.n !== n || i !== p.got.length) return { parts: null };
    p.got.push(obj[key]);
    return p.got.length < n ? { parts: p } : { parts: null, all: p.got.flat() };
  }

  // ---- what arrives ----

  async function onMessage(from, obj) {
    const v = views.get(from);
    if (!v || !v.live || !obj || typeof obj !== 'object') return;
    if (obj.t === 'beat') {
      heardNow(v);
      return emit(from);
    }
    if (typeof obj.t === 'string' && Object.values(OP_REPLY).includes(obj.t))
      return reply(from, v, obj);
    if (obj.t === 'control') {
      const k = shapeControl(obj);
      v.ctl = k ? { clis: k.clis, watch: k.watch } : null;
      v.fresh = k ? { c: k.c, at: now() } : null;
      heardNow(v);
      return emit(from);
    }
    if (obj.t === 'project') {
      v.project = shapeProject(obj);
      heardNow(v);
      return emit(from);
    }
    if (obj.t === 'report') return report(from, v, obj);
    if (obj.t === 'agents') {
      const r = addPart(v.aparts, obj, 'agents');
      v.aparts = r.parts;
      if (!r.all) return;
      const all = [];
      const ids = new Set();
      for (const raw of r.all) {
        const s = shapeAgent(raw);
        if (s && !ids.has(s.id) && all.length < MAX_AGENTS) {
          ids.add(s.id);
          all.push(s);
        }
      }
      if (stampOf(obj.c)) v.fresh = { c: obj.c, at: now() };
      v.agents = all;
      heardNow(v);
      return emit(from);
    }
    if (obj.t === 'needs') {
      const r = addPart(v.cparts, obj, 'items');
      v.cparts = r.parts;
      if (!r.all) return;
      const list = [];
      const seen = new Set();
      for (const raw of r.all.slice(0, MAX_ITEMS)) {
        const s = await readChoice(raw);
        if (s && !seen.has(s.id)) {
          seen.add(s.id);
          list.push(s);
        }
      }

      // the session may have ended while the bindings were made
      if (views.get(from) !== v || !v.live) return;
      v.choices = list;
      heardNow(v);
      return emit(from);
    }
  }

  function report(from, v, obj) {
    // "no longer": everything held from that computer goes
    if (obj.id === undefined) {
      v.reports.clear();
      heardNow(v);
      return emit(from);
    }
    v.rin = v.rin.filter(t => now() - t < MINUTE);
    if (v.rin.length >= REPORTS_MAX) return;
    v.rin.push(now());
    const r = shapeReport(obj);
    if (!r) return;
    v.reports.delete(r.id);
    v.reports.set(r.id, { ...r, got: wall() });
    while (v.reports.size > REPORTS_MAX) v.reports.delete(v.reports.keys().next().value);
    heardNow(v);
    emit(from);
  }

  // A reply: only for an operation this phone sent, of that kind, with no last word yet, and only
  // as one of that kind's fixed words (desktop/remote-control.js shapeReply makes them).
  function reply(from, v, obj) {
    const e = hex16(obj.n) ? v.ops.get(obj.n) : null;
    if (!e || OP_REPLY[e.kind] !== obj.t || !OP_OPEN.has(e.state)) return;
    let word = '';

    // a start says why it failed in `why`; every other reply, a resume too, in `state`
    if (obj.t === 'started') {
      word = obj.ok === true ? 'started' : obj.why === 'failed' ? 'failed' : 'refused';
    } else if (obj.t === 'threaded' && obj.ok !== true && obj.state === 'busy') {
      word = 'busy';
    } else if (obj.ok === true) {
      word = typeof obj.state === 'string' ? obj.state : '';
    } else {
      word = obj.state === 'failed' ? 'failed' : 'refused';
    }
    if (!OP_WORDS[e.kind].includes(word) || word === e.state) return;
    if (word === 'unsent' && e.do !== 'interrupt') return;
    unwait(e);
    e.state = word;

    // "queued": the computer holds it and says once more how it ended; if that never comes, say so
    if (word === 'queued' && !stopped)
      e.timer = timers.set(() => {
        e.timer = null;
        if (e.state === 'queued') {
          e.state = 'no_reply';
          emit(from);
        }
      }, QUEUED_MS);
    emit(from);
  }

  // ---- what leaves ----

  // One operation: only while that computer's session is live and it lets this phone control.
  // The same operation is not sent twice while it waits for its first word. → { state, n }:
  // 'asked' (it left; the word follows in the view's ops), 'not_sent' or 'too_long'.
  async function operate(peerId, kind, fill, show) {
    const v = views.get(peerId);
    if (!v || !v.live || !v.ctl || !v.fresh || stopped) return { state: 'not_sent', n: '' };
    const sig = JSON.stringify([
      kind,
      fill.id,
      fill.do,
      fill.cli,
      fill.text,
      fill.of,
      fill.pick,
      fill.v,
      fill.h,
    ]);
    for (const e of v.ops.values())
      if (e.sig === sig && e.state === 'asked') return { state: e.state, n: e.n };
    const n = hex16(nonce());
    if (!n || v.ops.has(n)) return { state: 'not_sent', n: '' };
    const msg = { ...fill, n, c: v.fresh.c, ms: Math.max(0, Math.floor(now() - v.fresh.at)) };
    if (bytesOf(JSON.stringify(msg)) > MAX_PLAIN) return { state: 'too_long', n: '' };

    // Kept before it leaves: a reply may arrive before the send has finished.
    const e = { n, kind, ...show, sig, state: 'asked', at: wall(), timer: null };
    v.ops.set(n, e);
    while (v.ops.size > OPS_MAX) {
      const old = v.ops.values().next().value;
      unwait(old);
      v.ops.delete(old.n);
    }
    let ok = false;
    try {
      ok = (await send(peerId, msg)) === true;
    } catch {
      /* no session: nothing queues */
    }
    if (!ok && e.state === 'asked') e.state = 'not_sent';
    if (e.state === 'asked')
      e.timer = timers.set(() => {
        e.timer = null;
        if (e.state === 'asked') {
          e.state = 'no_reply';
          emit(peerId);
        }
      }, REPLY_MS);
    emit(peerId);
    return { state: ok ? 'asked' : 'not_sent', n };
  }

  // the row of an agent this phone may control now (it carries a ticket)
  const rowOf = (peerId, agentId) => {
    const v = views.get(peerId);
    const a = v && v.ctl ? v.agents.find(x => x.id === agentId) : null;
    return a && a.to ? a : null;
  };
  const notSent = { state: 'not_sent', n: '' };

  function copy(v) {
    const stale = v.live && now() - v.heard > STALE_MS;
    return {
      state: !v.live ? 'offline' : stale ? 'stale' : 'live',
      heard: v.heardWall,
      agents: v.agents.map(a => ({ ...a })),
      project: v.project ? { ...v.project } : null,
      control: v.ctl ? { clis: [...v.ctl.clis], watch: v.ctl.watch } : null,
      reports: [...v.reports.values()].map(r => ({ ...r })),
      choices: v.choices.map(c => ({ ...c, opts: [...c.opts] })),
      ops: [...v.ops.values()].reverse().map(e => ({
        n: e.n,
        kind: e.kind,
        ...(e.id ? { id: e.id } : {}),
        ...(e.cli ? { cli: e.cli } : {}),
        ...(e.do ? { do: e.do } : {}),
        ...(e.pick ? { pick: e.pick } : {}),
        state: e.state,
        at: e.at,
      })),
    };
  }

  return {
    onMessage,

    // A session with that computer began: it sends its lists again.
    sessionStarted(id) {
      const old = views.get(id);
      if (old) for (const e of old.ops.values()) unwait(e);
      views.set(id, fresh());
      emit(id);
    },

    // The session ended: what it said stays as "last heard", but nothing can be asked of it.
    sessionEnded(id) {
      const v = views.get(id);
      if (!v) return;
      v.live = false;
      v.ctl = null;
      v.fresh = null;
      v.aparts = null;
      v.cparts = null;
      v.choices = [];
      for (const e of v.ops.values()) {
        unwait(e);
        if (e.state === 'asked' || e.state === 'queued') e.state = 'no_reply';
      }
      emit(id);
    },

    // The computer was forgotten on this phone.
    forget(id) {
      const v = views.get(id);
      if (v) for (const e of v.ops.values()) unwait(e);
      views.delete(id);
      emit(id);
    },

    view: id => (views.has(id) ? copy(views.get(id)) : null),
    ids: () => [...views.keys()],

    // A prompt for an agent there (also a follow-up to a finished one).
    prompt(peerId, agentId, text) {
      const a = rowOf(peerId, agentId);
      return a && typeof text === 'string' && text
        ? operate(peerId, 'prompt', { t: 'prompt', id: a.id, to: a.to, text }, { id: a.id })
        : notSent;
    },

    // Interrupt or Stop: one of two literal words.
    act(peerId, agentId, what) {
      const a = rowOf(peerId, agentId);
      return a && (what === 'interrupt' || what === 'stop')
        ? operate(peerId, 'act', { t: 'act', id: a.id, to: a.to, do: what }, { id: a.id, do: what })
        : notSent;
    },

    // Option N of a question as the phone was shown it (its binding `kof`).
    choose(peerId, itemId, pick, kof) {
      const v = views.get(peerId);
      const it = v && v.ctl ? v.choices.find(x => x.id === itemId) : null;
      const ok =
        it && it.kof === kof && Number.isInteger(pick) && pick >= 1 && pick <= it.opts.length;
      const a = ok ? rowOf(peerId, it.row) : null;
      return a
        ? operate(
            peerId,
            'choose',
            { t: 'choose', id: a.id, to: a.to, of: it.kof, pick },
            { id: a.id, pick }
          )
        : notSent;
    },

    // Start an agent there: a CLI it says can be started, in the project open there (its first
    // commit's id), with an optional first prompt.
    start(peerId, cli, text) {
      const v = views.get(peerId);
      const project = v && v.project ? v.project.root : '';
      const first = typeof text === 'string' && text ? text : undefined;
      if (!v || !v.ctl || !project || !v.ctl.clis.includes(cli)) return notSent;
      const fill = first ? { t: 'start', cli, project, text: first } : { t: 'start', cli, project };
      return operate(peerId, 'start', fill, { cli });
    },

    // Rename, close, model or effort of an agent there (plan item 44).
    thread(peerId, agentId, what, value) {
      const a = rowOf(peerId, agentId);
      if (!a || !THREAD_DO.includes(what)) return notSent;
      const fill = { t: 'thread', id: a.id, to: a.to, do: what };
      if (what !== 'close') fill.v = value;
      return operate(peerId, 'thread', fill, { id: a.id, do: what });
    },

    // Resume a past conversation there, named by the handle its list carried (plan item 44).
    resume(peerId, h) {
      const v = views.get(peerId);
      const project = v && v.project ? v.project.root : '';
      return v && v.ctl && typeof h === 'string' && h && project
        ? operate(peerId, 'resume', { t: 'resume', h, project }, {})
        : notSent;
    },

    // What a `view` or `keep` of watch.mjs needs: the row id, its ticket and the freshness pair,
    // for an agent of a computer that says this phone may watch. → { id, to, c, ms } or null.
    viewFields(peerId, agentId) {
      const v = views.get(peerId);
      const a = rowOf(peerId, agentId);
      if (!a || !v.live || !v.fresh || !v.ctl.watch) return null;
      return { id: a.id, to: a.to, c: v.fresh.c, ms: Math.max(0, Math.floor(now() - v.fresh.at)) };
    },

    stop() {
      stopped = true;
      for (const v of views.values()) for (const e of v.ops.values()) unwait(e);
    },
  };
}
