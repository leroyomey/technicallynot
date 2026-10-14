// Technically Not · remote-api.js — the fixed list of things one paired computer may send another.
// Three things, all read-only: this computer's open
// "needs you" items (phase 1a), its agents with name, CLI and status (phase 1, "See", each with the
// key of its project, section 6e), and which project is open on it as two commit ids (section 6d,
// "same project, seen"). Nothing here forwards a local object or an IPC call: the sender builds
// every item field by field, and the receiver reads every field again as untrusted text. A message
// of any other type is ignored. Pure Node: sending, the clock and the timers are handed in (the app
// wires them to remote-link.js).
// - Sent: the full current list when a session starts and whenever it changes (items are rare, so
// no deltas to get wrong); a list too large for one envelope goes as several messages, never a
// larger one.
// - The agent list goes the same way, at most once every few seconds per computer (status changes
// are batched), and not at all while this computer has no agents. An agent's task text follows the
// same per-computer switch as the question text.
// - Which project is open goes as one small message when a session starts and when it changes, at
// most once every few seconds per computer, behind the same per-computer switch, and not at all
// while there is no project to name.
// - While this computer has open items or an agent that is not idle it sends a small heartbeat
// about once a minute, else none.
// - Received: a computer whose heartbeat is missed twice is marked "last heard"; one that went
// offline keeps no waiting item. A receiver never reports "all clear" for another computer, only an
// empty list ("nothing reported"). Control ("change n" below names a numbered change of its
// design). The rules that decide whether an operation is
// carried out are in remote-control.js; here are only the messages, each with its own shaping:
// - `to` on an agent row: a ticket, only while the receiving computer may control this one's
// agents. A hint for its buttons and never a right (the operation is checked again when it
// arrives). `c` on each agent list: a small counter the other computer echoes with every operation,
// so one that the relay held back can be refused (change 13).
// - { t: 'control', c, clis }: "you may control my agents, and these CLIs can be started here"
// (fixed words), sent only while the switch is on for that computer; { t: 'control' } alone: no
// longer.
// - Operations this computer asks of another: { t: 'prompt', n, c, ms, id, to, text }, { t: 'act',
// n, c, ms, id, to, do } and { t: 'start', n, c, ms, cli, project, text? } (shapeOp). `n` is a
// one-time number; nothing queues: without a live session nothing is sent. The replies `prompted`,
// `acted` and `started` are read only for an `n` this computer sent and only as one of a few fixed
// words; one that is not confirmed in 15 s says so. The live view (section 6h; the rules are
// remote-view.js): `view`, `viewing`, `keep`, `frame` and `unview`, each with its own shaping
// below, used by the computer that watches and the one that is watched. This file only shapes them
// and says, in `control`, whether this computer can be watched; it neither sends nor reads a frame.
// Finished tasks (section 6g), read-only like the lists: { t: 'report', id, name, cli, at, task,
// did, text, more, p? } is one finished task of one agent: the task's first words, the short
// result, and as much of the answer as one sealed message carries (`more` characters are left out).
// Behind the same per-computer switch as the task text; at most a few a minute per computer, the
// newest of each agent waiting for room; a new session gets the recent ones again. { t: 'report' }
// alone: "no longer", the other computer drops what it holds. Received: the newest of each agent, a
// bounded number, shown with the time it carries.
const crypto = require('crypto');
const MAX_PLAIN = require('./remote-noise.js').MAX_PLAIN;

// one line of plain text: no control, zero-width or direction-override characters, clipped
const line = require('./remote-keys.js').clean;

const BEAT_MS = 60 * 1000;
const STALE_MS = 2 * BEAT_MS + 10 * 1000; // two heartbeats missed
const MAX_ITEMS = 200;
const ROSTER_MS = 3 * 1000; // at most one agent list per computer in this time
const MAX_AGENTS = 100;
const PROJECT_MS = 3 * 1000; // at most one "which project" message per computer in this time

// a git commit id (SHA-1 or SHA-256) in lower-case hex, and nothing else
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

// Which project an agent works in (section 6e): the first commit's id of its project, or for a
// folder that is not a git project the letter n and 40 hex characters made from the folder's name.
// Fixed forms and nothing else: never a folder, a path or a name.
const PKEY = /^(?:[0-9a-f]{40}|[0-9a-f]{64}|n[0-9a-f]{40})$/;
const projectKey = v => (typeof v === 'string' && PKEY.test(v) ? v : '');

// anything else is read as idle: never "working" by mistake
const STATUS = new Set(['working', 'needs', 'idle']);

// as the local chip shows them; anything else is "other"
const KINDS = new Set(['permission', 'menu', 'trust', 'question', 'error', 'draft']);
const REPLY_MS = 15 * 1000; // an answer the other computer has not confirmed in this time says so

// the only reasons read from an `answered`; anything else is "refused"
const WHY = new Set(['not_allowed', 'refused', 'failed']);

// at most one "what may be controlled here" message with a list per computer in this time
const CONTROL_MS = 3 * 1000;

// the other computer drops a prompt it holds after 10 minutes and says so; no word by then is "no
// reply"
const QUEUED_MS = 10 * 60 * 1000 + REPLY_MS;
const OPS_MAX = 20; // operations sent to one computer whose result this computer still shows
const STAMP_MAX = 0x7fffffff;

// a ticket or a one-time number, and nothing else
const hex16 = v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '');

// the counter of change 13; 0 = none
const stampOf = v => (Number.isInteger(v) && v > 0 && v <= STAMP_MAX ? v : 0);

// The CLIs that may be named for a start, as fixed words (remote-control.js looks the same words up
// in its own list, CLIS).
const START_CLIS = ['claude', 'codex', 'opencode', 'cursor'];

// What an operation can end on, as this computer shows it. Anything else in a reply is not taken.
// "unconfirmed": the other computer wrote the prompt and pressed Enter once, and its CLI gives no
// sign that it started (the page: "Sent; (name) could not confirm it started").
const OP_WORDS = {
  prompt: ['sent', 'queued', 'unconfirmed', 'refused', 'failed'],
  act: ['done', 'unsent', 'refused', 'failed'],
  start: ['started', 'refused', 'failed'],
  choose: ['done', 'refused', 'failed'],
  // sync: the git hand-over
  sync: [
    'done',
    'same',
    'absent',
    'offline',
    'signin',
    'remote',
    'kept',
    'project',
    'busy',
    'large',
    'refused',
    'failed',
  ],
};
const OP_REPLY = {
  sync: 'synced',
  prompt: 'prompted',
  act: 'acted',
  start: 'started',
  choose: 'chosen',
  file: 'filed',
  promptf: 'prompted',
};
OP_WORDS.say = OP_WORDS.prompt;

// an agent's message for an agent there: a prompt's words, its own reply
// type
OP_REPLY.say = 'said';
OP_WORDS.file = ['go', 'refused', 'failed'];

// a file's offer and the prompt that names files (remote-files.js)
OP_WORDS.promptf = OP_WORDS.prompt;
const OP_OPEN = new Set(['asked', 'queued', 'no_reply']); // states a reply may still change
const time = t => (Number.isFinite(t) && t > 0 && t < 1e14 ? Math.floor(t) : 0);

// Finished tasks (section 6g).
const MINUTE = 60 * 1000;
const REPORT_TASK = 120,
  REPORT_DID = 240; // the task's first words and the short result, in characters

// the answer's first part, in characters; one sealed message is the limit that bites first
const REPORT_TEXT = 4000;
const REPORT_MORE = 9999999; // the largest "characters left out" that is read
const REPORTS_MIN = 6; // reports sent to one computer in a minute, at most

// the newest result of this many agents waits for room, and is kept for a session that starts later
// (no more than one minute carries, so they arrive in the order they finished)…
const REPORTS_HELD = 6;
const REPORT_KEEP_MS = 60 * MINUTE; // …for this long

// results kept from one computer (the newest of each agent), and taken from it in a minute
const REPORTS_MAX = 12;

// a result of a computer without a session is dropped when it arrived longer ago than this
const REPORT_OFFLINE_MS = 24 * 60 * MINUTE;

// Sender and receiver use the same shaping, so what arrives is never more than what was meant to
// leave.
function shape(it, withDetail) {
  if (!it || typeof it !== 'object') return null;
  const id = line(it.id, 80);
  if (!id) return null;
  const out = {
    id,
    kind: KINDS.has(it.kind) ? it.kind : 'other',
    agent: line(it.agent, 60),
    since: time(it.since),
    inferred: it.inferred === true,
  };

  // A guessed item's text is a line read from the terminal screen: it is never sent and never shown
  // (terminal output stays on its computer). Only what an agent CLI
  // itself reported (a permission, a trust prompt) carries text.
  if (withDetail && !out.inferred && it.detail != null && line(it.detail, 100))
    out.detail = line(it.detail, 100);
  return out;
}

// A permission request's short text ("Bash: npm test", as the "Needs you" item carries it) IS the
// whole request: a shell command of one line that shape() above leaves unchanged. Only such a
// request may ever be answered from another device:
// anything longer, of several lines or with characters that are replaced shows only
// part of what would run. agent-hooks.js marks each held request with it; it lives here so the rule
// sits beside the shaping it depends on. Length is counted in UTF-16 units as well as in
// characters: the "Needs you" item is cut by units (attention-service.js `clip`), the text sent by
// characters (`line`). A command with characters above U+FFFF passed the character count and was
// still cut by units, so it was marked whole with its tail hidden.
const wholeShell = (tool, command) =>
  typeof tool === 'string' &&
  typeof command === 'string' &&
  command !== '' &&
  !/[\r\n]/.test(command) &&
  (tool + ': ' + command).length <= 100 &&
  line(tool + ': ' + command, 100) === tool + ': ' + command;

// One agent of a computer. The task is the user's own words, so it leaves only where the question
// text may.
function shapeAgent(a, withDetail) {
  if (!a || typeof a !== 'object') return null;
  const id = line(a.id, 80),
    name = line(a.name, 60);
  if (!id || !name) return null;
  const out = {
    id,
    name,
    cli: line(a.cli, 40),
    status: STATUS.has(a.status) ? a.status : 'idle',
    since: time(a.since),
  };
  if (withDetail && a.task != null && line(a.task, 120)) out.task = line(a.task, 120);

  // Its project's key travels in the row, never as a message of its own: a list that arrived before
  // its keys would show another project's agents meanwhile. Behind the same switch as "which
  // project is open" (6d); a row without one is listed as before.
  if (withDetail && projectKey(a.p)) out.p = projectKey(a.p);

  // The ticket for an operation on this agent (6f, change 5): 16 hex characters the sending
  // computer made for the receiving one, or no field. The sender never takes it from the app's own
  // list (sendAgents below sets it); the receiver only echoes it.
  if (withDetail && hex16(a.to)) out.to = a.to;

  // "An agent of yours may message this one": one true or no field, only
  // on a row that carries a ticket. A hint for the other computer's `tnai agents`, never a right:
  // the message itself is checked again where it lands.
  if (out.to && a.m === true) out.m = true;
  return out;
}

// Which project is open on a computer (section 6d): the id of the repository's first commit, which
// is the same on every copy of one project wherever its folder is and whatever it is called, and
// the id of the commit that copy is on. Two ids of a fixed shape: no name, folder, path or branch.
// Without a first commit there is no project to name.
const commit = v => (typeof v === 'string' && COMMIT.test(v) ? v : '');

function shapeProject(p) {
  if (!p || typeof p !== 'object') return null;
  const root = commit(p.root);
  if (!root) return null;
  return { root, head: commit(p.head) };
}

// A finished task of one agent (section 6g). The answer keeps its line breaks: each line is cleaned
// as one line of plain text like every other field, blank lines are joined to one, and it is cut on
// whole characters, never inside one. Reading a text that was read before changes nothing, so what
// arrives is what left.
function reportText(v) {
  if (typeof v !== 'string') return '';
  const out = [];
  for (const raw of v.slice(0, 60000).replace(/\r\n?/g, '\n').split('\n')) {
    const l = line(raw, 60000);
    if (l || (out.length && out[out.length - 1])) out.push(l);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n');
}
const cutChars = (s, n) => {
  const c = Array.from(s);
  return c.length > n ? c.slice(0, n).join('').trimEnd() : s;
};

function reportOf(r, text, more) {
  if (!r || typeof r !== 'object') return null;
  const id = line(r.id, 80),
    name = line(r.name, 60),
    at = time(r.at),
    did = line(r.did, REPORT_DID);

  // which agent, when, and something it said: without one of them there is nothing to show
  if (!id || !name || !at || (!did && !text)) return null;
  const out = {
    id,
    name,
    cli: line(r.cli, 40),
    at,
    task: line(r.task, REPORT_TASK),
    did,
    text,
    more: Number.isInteger(more) && more > 0 ? Math.min(more, REPORT_MORE) : 0,
  };

  // Its project's key travels with it for the reason a row's does (6e): shown before its key
  // arrived, it would show for the wrong project.
  if (projectKey(r.p)) out.p = projectKey(r.p);

  // The answer to a message an agent of the receiving computer sent:
  // that message's one-time number, put on only by the computer that was asked and only for the
  // computer that asked. cut: its turn was stopped after ten minutes.
  if (hex16(r.re)) {
    out.re = r.re;
    if (r.cut === true) out.cut = true;
  }
  return out;
}
const shapeReport = r => reportOf(r, cutChars(reportText(r && r.text), REPORT_TEXT), r && r.more);

// What leaves: the report with as much of the answer as one sealed message carries, never a second
// message. The room is counted with the widest `more` there can be, so the message fits whatever
// the cut turns out to be; `more` then says how many characters of the answer are not in it (0:
// this is all of it). The other fields at their longest leave about 1,700 bytes for the answer.
function fitReport(raw) {
  const all = Array.from(reportText(raw && typeof raw === 'object' ? raw.text : '')),
    base = reportOf(raw, all.join(''), REPORT_MORE);
  if (!base) return null;
  let room = MAX_PLAIN - Buffer.byteLength(JSON.stringify({ t: 'report', ...base, text: '' })),
    n = 0;
  while (n < all.length && n < REPORT_TEXT) {
    const b = Buffer.byteLength(JSON.stringify(all[n])) - 2;
    if (b > room) break;
    room -= b;
    n++;
  }
  const text = all.slice(0, n).join('').trimEnd();
  return base.did || text
    ? { t: 'report', ...base, text, more: all.length - Array.from(text).length }
    : null;
}

// What a computer lets this one control (6f, change 17): the counter to echo and the CLIs that can
// be started there, as fixed words in a fixed order. Anything else, and a message without a
// counter, reads as "no control".
function shapeControl(m) {
  if (!m || typeof m !== 'object') return null;
  const c = stampOf(m.c);
  if (!c || !Array.isArray(m.clis)) return null;
  return {
    c,
    clis: START_CLIS.filter(w => m.clis.includes(w)),
    watch: m.watch === true,
    sync: m.sync === true,
    say:
      m.say ===
      true /* it takes a message from this computer's agents (remote-agent-messages.md) */,
    // sync: it takes a git hand-over from this computer. watch: it takes a
    // `view` from this computer (6h); anything but a real true is no
  };
}

// The live view's five messages (6h), field by field. Form only: whether a view is given is decided
// in remote-view.js. an unknown word reads as the harmless one, "refused"
const VIEW_STATES = ['on', 'refused', 'busy', 'spent'];

// an unknown word reads as "closed"
const UNVIEW_WHY = ['closed', 'hidden', 'timeout', 'spent', 'off', 'gone', 'stopped'];

// base64 characters of a frame in one message: with the other fields it stays under one sealed
// message
const FRAME_Z = 4020;

// `view` (start showing me this agent's panel) and `keep` (ten minutes more): a one-time number,
// the freshness pair of 6f change 13, the row id and its ticket; `keep` also names the view.
function shapeView(m) {
  if (!m || typeof m !== 'object' || (m.t !== 'view' && m.t !== 'keep')) return null;
  const n = hex16(m.n),
    c = stampOf(m.c),
    id = typeof m.id === 'string' && m.id !== '' && line(m.id, 80) === m.id ? m.id : '',
    to = hex16(m.to);
  if (!n || !c || !Number.isSafeInteger(m.ms) || m.ms < 0 || !id || !to) return null;
  if (m.t === 'view') return { t: 'view', n, c, ms: m.ms, id, to };
  const v = hex16(m.v);
  return v ? { t: 'keep', n, c, ms: m.ms, v, id, to } : null;
}

function shapeViewing(m) {
  if (!m || typeof m !== 'object') return null;
  const n = hex16(m.n);
  if (!n) return null;
  const out = { t: 'viewing', n, state: VIEW_STATES.includes(m.state) ? m.state : 'refused' };

  // whole minutes of today's allowance
  if (Number.isInteger(m.left) && m.left >= 0 && m.left <= 120) out.left = m.left;
  return out;
}

// One part of one frame: the view, the frame's number, part and parts, and a piece of base64.
// Nothing in it is a ticket or a text.
function shapeFrame(m) {
  if (!m || typeof m !== 'object') return null;
  const v = hex16(m.v);
  if (
    !v ||
    !Number.isInteger(m.s) ||
    m.s < 1 ||
    m.s > STAMP_MAX ||
    !Number.isInteger(m.k) ||
    m.k < 1 ||
    m.k > 3 ||
    !Number.isInteger(m.i) ||
    m.i < 0 ||
    m.i >= m.k
  )
    return null;
  if (
    typeof m.z !== 'string' ||
    !m.z ||
    m.z.length > FRAME_Z ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(m.z)
  )
    return null;
  return { t: 'frame', v, s: m.s, i: m.i, k: m.k, z: m.z };
}

function shapeUnview(m) {
  if (!m || typeof m !== 'object') return null;
  const v = hex16(m.v);
  return v ? { t: 'unview', v, why: UNVIEW_WHY.includes(m.why) ? m.why : 'closed' } : null;
}

// An operation for another computer's agent (6f), field by field. The sending computer builds every
// operation through this, and the receiving one reads it through this again before its checks
// (remote-control.js) see it, so a field that is not named here never reaches them. It checks form
// only: whether the operation is carried out is decided there. A start names its project by the
// first commit's id, never by the name form (change 6). Text is not cleaned or cut here: the
// receiver refuses, never repairs (change 1, 7).
function shapeOp(m) {
  if (!m || typeof m !== 'object') return null;
  const n = hex16(m.n),
    c = stampOf(m.c);
  if (!n || !c || !Number.isSafeInteger(m.ms) || m.ms < 0) return null;

  // The git hand-over: the project by its first commit's id and one commit
  // id, both hex of a fixed length.
  if (m.t === 'sync') {
    const project = commit(m.project),
      id = commit(m.commit);
    return project && id ? { t: 'sync', n, c, ms: m.ms, project, commit: id } : null;
  }
  if (m.t === 'start') {
    const cli = typeof m.cli === 'string' && START_CLIS.includes(m.cli) ? m.cli : '',
      project = commit(m.project);
    if (!cli || !project || (m.text !== undefined && (typeof m.text !== 'string' || !m.text)))
      return null;
    return m.text === undefined
      ? { t: 'start', n, c, ms: m.ms, cli, project }
      : { t: 'start', n, c, ms: m.ms, cli, project, text: m.text };
  }
  const id = typeof m.id === 'string' && m.id !== '' && line(m.id, 80) === m.id ? m.id : '',
    to = hex16(m.to);
  if (!id || !to) return null;
  if (m.t === 'prompt')
    return typeof m.text === 'string' && m.text
      ? { t: 'prompt', n, c, ms: m.ms, id, to, text: m.text }
      : null;

  // A message from an agent of the sending computer for an agent of the receiving one.
  // A type of its own, never a field on
  // `prompt`: an app that does not know it drops it. kind: two literals. by: who asks, two labels
  // and nothing else; the receiver holds them to plain characters before it shows them.
  if (m.t === 'say') {
    const kind = m.kind === 'ask' ? 'ask' : m.kind === 'send' ? 'send' : '',
      by =
        m.by && typeof m.by === 'object'
          ? { name: line(m.by.name, 32), cli: line(m.by.cli, 40) }
          : null;
    return kind && by && by.name && typeof m.text === 'string' && m.text
      ? { t: 'say', n, c, ms: m.ms, id, to, kind, by, text: m.text }
      : null;
  }

  // A file with a prompt (the rules are remote-files.js). `file`:
  // the offer of one file, by its own id, kind word, size, number of pieces and SHA-256; no name,
  // path or date. `promptf`: a prompt that names one to three finished files.
  if (m.t === 'file')
    return hex16(m.f) &&
      typeof m.kind === 'string' &&
      /^[a-z]{3}$/.test(m.kind) &&
      Number.isInteger(m.bytes) &&
      m.bytes > 0 &&
      Number.isInteger(m.parts) &&
      m.parts > 0 &&
      typeof m.sha === 'string' &&
      /^[0-9a-f]{64}$/.test(m.sha)
      ? {
          t: 'file',
          n,
          c,
          ms: m.ms,
          id,
          to,
          f: m.f,
          kind: m.kind,
          bytes: m.bytes,
          parts: m.parts,
          sha: m.sha,
        }
      : null;
  if (m.t === 'promptf')
    return typeof m.text === 'string' &&
      m.text &&
      Array.isArray(m.files) &&
      m.files.length >= 1 &&
      m.files.length <= 3 &&
      m.files.every(hex16)
      ? { t: 'promptf', n, c, ms: m.ms, id, to, text: m.text, files: [...m.files] }
      : null;
  if (m.t === 'act')
    return m.do === 'interrupt' || m.do === 'stop'
      ? { t: 'act', n, c, ms: m.ms, id, to, do: m.do }
      : null; // two literals (change 16)

  // A choice (6i): the binding of the question that was shown (16 base64 characters) and one whole
  // number from 1 to 9. Nothing else: no key, no text, no list.
  if (m.t === 'choose')
    return typeof m.of === 'string' &&
      /^[A-Za-z0-9+/]{16}$/.test(m.of) &&
      Number.isInteger(m.pick) &&
      m.pick >= 1 &&
      m.pick <= 9
      ? { t: 'choose', n, c, ms: m.ms, id, to, of: m.of, pick: m.pick }
      : null;
  return null;
}

// send(peerId, obj) → true when it went out over a live session (remote-link's send). items() → the
// local needs-you items ({ id, paneId, kind, detail, since, inferred }). agentName(paneId) → the
// agent's name from the roster. showDetail(peerId) → the per-device switch "send the question text"
// (on for a newly paired device). on.remote(peerId, view) fires when what is known about another
// computer changes: view = { state: 'live' | 'last_heard' | 'offline', heard, items, agents,
// project }. agents() → this computer's agents now ({ id, name, cli, status, since, task }), read
// at once (the app keeps the list ready). project() → the project open on this computer now ({
// root, head }), or null; read at once like the agent list. A yes or no to a permission prompt
// (section 6c). canAnswer(peerId) → the ids of this computer's items that computer may answer now
// (none by default): such an item is sent with `can: true`, a hint for the other computer's buttons
// and never a right. bind(item) → the binding of an item as received (`bindingOf` of
// phone-answer.js, handed in because that file requires this one); without it nothing received is
// answerable. answer() below sends `answer`; an `answered` is read only for an answer this computer
// sent. Control (section 6f), all three "nothing" by default. ticket(peerId, panelId) → the ticket
// for that agent's row as sent to that computer, or '' (`ticketFor` of remote-control.js).
// stamp(peerId) → a counter to put on a message for that computer, 0 for none (its `stamp`).
// starts(peerId) → null while that computer may not control this one's agents, else the CLI words
// that can be started here now. reply(obj) → a reply read field by field or null (`shapeReply` of
// remote-control.js, handed in because that file requires this one); without it this computer sends
// no operation. nonce() → 16 hex characters for an operation's one-time number. watchable(peerId) →
// true while this computer takes a `view` from that one (6h): said as one word in `control`.
// Finished tasks (section 6g): reported(r) below is handed { id, name, cli, at, task, did, text, p
// } when an agent of this computer finished a task; a view's `reports` are the other computer's,
// oldest first, each with `got` (when it arrived here) and a `key`. tellFrom(peerId) → the time
// from which that computer may be told of finished tasks: when it was paired, when its text switch
// last went on, when its paused pairing was kept, whichever is latest (the app keeps it; 0 = no
// limit). A task that ended before it is never sent to that computer, however recent.
// Longer commands (change 8), both null by default: full(shaped, item) →
// the item with `full` and `can2` for sending (`withFull` of remote-control.js), read(shaped, raw)
// → the same for an item as it arrived (`readFull`); `bind` then gives the v2 binding for such an
// item (`bindingFor`). Without them an item that is not `whole` is never marked answerable and a
// received `can2` is not read.
function createRemoteApi({
  send,
  items,
  agents = () => [],
  project = () => null,
  agentName = () => '',
  showDetail = () => true,
  canAnswer = () => [],
  bind = null,
  full = null,
  read = null,
  // A choice (6i), both null by default: pick(peerId, shaped, item) → the item with its option
  // labels and its agent row for a computer that may choose (`withPick` of remote-control.js behind
  // the app's right), readPick(shaped, raw) → the same for an item as it arrived, with the binding
  // to send back (`readPick`). Without them no item carries options and none that arrives is read.
  pick = null,
  readPick = null,
  // Agents message agents, both "no" by default: sayable(peerId) → this
  // computer takes a message from that computer's agents (said as one word in `control`);
  // sayRow(peerId, panelId) → that agent may take one now (the row's `m`). on.answer(peerId, n,
  // report) fires once for a report that answers a message this computer sent.
  sayable = () => false,
  sayRow = () => false,
  ticket = () => '',
  stamp = () => 0,
  starts = () => null,
  watchable = () => false,
  syncable = () => false,
  reply = null,
  tellFrom = () => 0,
  nonce = () => crypto.randomBytes(8).toString('hex'),
  on = {},
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
}) {
  // peer id → { sent: JSON of the last list sent, open: it had items, gen; sentA, busy, genA, wait,
  // again: the same for the agent list; sentP, waitP, againP: for the project; sentC, waitC,
  // againC: for "what may be controlled" }
  const out = new Map();

  // peer id → { state, heard, items, agents, project, parts: { g, n, got: [] } | null, aparts,
  // asked: Map item id → { of, say, state, timer }, ctl: { clis } while that computer lets this one
  // control | null, fresh: { c, at } its newest counter and when it arrived | null, ops: Map n → {
  // n, kind, id | cli, do, sig, state, at, timer } the operations this computer sent it, oldest
  // first }
  const views = new Map();

  // Finished tasks (6g). recent: agent id → the newest result of each of this computer's agents as
  // it leaves, for a session that starts within the hour after the task ended (its own end time,
  // not the moment it was handed over). told: peer id → when reports were
  // sent to it in the last minute, kept across sessions so a computer that restarts its session
  // often gets no more of them.
  const recent = new Map(),
    told = new Map();
  let reportN = 0;

  // An item this computer answered carries where that stands: answer = 'sent' | 'answered' |
  // 'not_sent' | 'no_reply' | one of WHY. An operation this computer sent carries where it stands:
  // state = 'asked' (it left, no word yet) | 'not_sent' | 'no_reply' | one of OP_WORDS.
  const aged = v => {
    if (v.state === 'offline')
      for (const [id, r] of v.reports) if (now() - r.got >= REPORT_OFFLINE_MS) v.reports.delete(id);
  };
  const copy = v => (
    aged(v),
    {
      state: v.state,
      heard: v.heard,
      items: v.items.map(x => {
        const e = v.asked.get(x.id);
        return e && e.of === x.of ? { ...x, answer: e.state, said: e.say } : { ...x };
      }),
      agents: v.agents.map(x => ({ ...x })),
      project: v.project ? { ...v.project } : null,
      control: v.ctl
        ? {
            clis: [...v.ctl.clis],
            watch: v.ctl.watch === true,
            sync: v.ctl.sync === true,
            say: v.ctl.say === true,
          }
        : null,
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
      reports: [...v.reports.values()].map(({ sig, busy, ...x }) => x),
    }
  );
  const unask = v => {
    for (const e of v.asked.values()) if (e.timer) timers.clear(e.timer);
    v.asked.clear();
  };
  const unwait = e => {
    if (e.timer) {
      timers.clear(e.timer);
      e.timer = null;
    }
  };

  // The one who waits for an operation's word is told once (operate's onWord).
  const heard = e => {
    const fn = e.onWord;
    if (!fn) return;
    e.onWord = null;
    try {
      fn(e.state);
    } catch {
      /* a listener's error is not ours */
    }
  };

  // something of it is shown as happening now
  const waits = v => v.items.length > 0 || v.agents.some(a => a.status !== 'idle');
  let beatTimer = null,
    staleTimer = null,
    stopped = false;
  const emit = id => {
    const v = views.get(id);
    try {
      on.remote?.(
        id,
        v
          ? copy(v)
          : {
              state: 'offline',
              heard: 0,
              items: [],
              agents: [],
              project: null,
              control: null,
              ops: [],
              reports: [],
            }
      );
    } catch {
      /* a listener's error is not ours */
    }
  };

  // ---- sending ----
  function listFor(peerId) {
    const withDetail = !!showDetail(peerId),
      list = [];
    let may = [];
    try {
      may = withDetail ? canAnswer(peerId) || [] : [];
    } catch {
      /* nothing answerable */
    }
    for (const it of items() || []) {
      let s = shape(
        {
          id: it.id,
          kind: it.kind,
          agent: agentName(it.paneId),
          detail: it.detail,
          since: it.since,
          inferred: it.inferred,
        },
        withDetail
      );

      // `can` for a request whose short text is all of it; `can2` with the whole command for a
      // longer one, never both (change 8).
      if (
        s &&
        s.detail &&
        s.kind === 'permission' &&
        !s.inferred &&
        s.id === it.id &&
        may.includes(it.id)
      ) {
        if (it.whole === true || (!full && it.full === undefined)) s.can = true;
        else if (full) {
          try {
            s = full(s, it) || s;
          } catch {
            /* goes as it was: not answerable */
          }
        }
      }
      if (s && pick && withDetail) {
        try {
          s = pick(peerId, s, it) || s;
        } catch {
          /* goes as it was: no options */
        }
      }
      if (s) list.push(s);
      if (list.length >= MAX_ITEMS) break;
    }
    return list;
  }

  function sendList(peerId, force) {
    const o = out.get(peerId);
    if (!o) return;
    const list = listFor(peerId),
      text = JSON.stringify(list);
    if (!force && text === o.sent) return;

    // Greedy split into parts that each fit one envelope.
    const g = ++o.gen,
      parts = [[]];
    const fits = p =>
      Buffer.byteLength(JSON.stringify({ t: 'needs', g, i: 99, n: 99, items: p })) <= MAX_PLAIN;
    for (const it of list) {
      const cur = parts[parts.length - 1];
      if (cur.length && !fits([...cur, it])) parts.push([it]);
      else cur.push(it);
    }
    let ok = true;
    parts.forEach((p, i) => {
      try {
        ok = send(peerId, { t: 'needs', g, i, n: parts.length, items: p }) === true && ok;
      } catch {
        ok = false;
      }
    });
    o.sent = ok ? text : null; // not sent (no session right now): the next session start sends it
    o.open = list.length > 0;
    beat();
  }

  // The agent list. sentA: undefined = none sent in this session (an empty list is then not worth a
  // message), null = must go again.
  function sendAgents(peerId) {
    const o = out.get(peerId);
    if (!o) return;

    // a "what may be controlled" message that did not go out is tried again here
    if (o.sentC === null) sendControl(peerId);
    if (o.wait) {
      o.again = true;
      return;
    }
    const withDetail = !!showDetail(peerId),
      list = [];

    // The ticket is asked for each row as it is sent (never kept, never from the app's own list),
    // and only for a computer that may control now, which it can only where the text may go.
    let may = false;
    try {
      may = withDetail && Array.isArray(starts(peerId));
    } catch {
      /* no control */
    }
    const ticketOf = id => {
      try {
        return may && typeof id === 'string' ? hex16(ticket(peerId, id)) : '';
      } catch {
        return '';
      }
    };
    const sayOf = id => {
      try {
        return may && typeof id === 'string' && sayRow(peerId, id) === true;
      } catch {
        return false;
      }
    }; // asked for each row as it is sent, like the ticket
    for (const a of agents() || []) {
      const s = shapeAgent(
        a && typeof a === 'object' ? { ...a, to: ticketOf(a.id), m: sayOf(a.id) } : a,
        withDetail
      );
      if (s) list.push(s);
      if (list.length >= MAX_AGENTS) break;
    }
    const text = JSON.stringify(list);
    o.busy = list.some(a => a.status !== 'idle');
    if (text === o.sentA || (o.sentA === undefined && !list.length)) return beat();
    const g = ++o.genA,
      parts = [[]];
    const fits = p =>
      Buffer.byteLength(
        JSON.stringify({ t: 'agents', g, c: STAMP_MAX, i: 99, n: 99, agents: p })
      ) <= MAX_PLAIN;
    for (const a of list) {
      const cur = parts[parts.length - 1];
      if (cur.length && !fits([...cur, a])) parts.push([a]);
      else cur.push(a);
    }

    // The counter of change 13, one per list that really goes (every part carries it); none for a
    // computer that may not control.
    let c = 0;
    try {
      c = may ? stampOf(stamp(peerId)) : 0;
    } catch {
      /* no counter */
    }
    let ok = true;
    parts.forEach((p, i) => {
      try {
        ok =
          send(
            peerId,
            c
              ? { t: 'agents', g, c, i, n: parts.length, agents: p }
              : { t: 'agents', g, i, n: parts.length, agents: p }
          ) === true && ok;
      } catch {
        ok = false;
      }
    });
    o.sentA = ok ? text : null;
    if (ok && !stopped)
      o.wait = timers.set(() => {
        o.wait = null;
        if (o.again && out.get(peerId) === o) {
          o.again = false;
          sendAgents(peerId);
        }
      }, ROSTER_MS);
    beat();
  }

  // Which project is open here. sentP as sentA: undefined = none sent in this session ("no project"
  // is then not worth a message), null = must go again. A project that closed, or a text switch
  // turned off, goes as a message without ids: the other computer forgets it.
  function sendProject(peerId) {
    const o = out.get(peerId);
    if (!o) return;
    if (o.waitP) {
      o.againP = true;
      return;
    }
    let p = null;
    try {
      p = showDetail(peerId) ? shapeProject(project()) : null;
    } catch {
      /* nothing to name */
    }
    const text = JSON.stringify(p);
    if (text === o.sentP || (o.sentP === undefined && !p)) return;
    let ok = false;
    try {
      ok =
        send(peerId, p ? { t: 'project', root: p.root, head: p.head } : { t: 'project' }) === true;
    } catch {
      /* no session: the next one sends it */
    }
    o.sentP = ok ? text : null;

    // The wait follows a message with ids only: "no project" at a session's start must not hold
    // back the ids read a moment later.
    if (ok && p && !stopped)
      o.waitP = timers.set(() => {
        o.waitP = null;
        if (o.againP && out.get(peerId) === o) {
          o.againP = false;
          sendProject(peerId);
        }
      }, PROJECT_MS);
  }

  // What that computer may control here (6f, change 17). sentC as sentP: undefined = none sent in
  // this session ("no control" is then not worth a message), null = must go again. "No longer"
  // never waits; a list of CLIs goes at most once every few seconds.
  function sendControl(peerId) {
    const o = out.get(peerId);
    if (!o) return;
    let k = null;
    try {
      const l = showDetail(peerId) ? starts(peerId) : null;
      k = Array.isArray(l) ? START_CLIS.filter(w => l.includes(w)) : null;
    } catch {
      /* no control */
    }
    if (!k && o.waitC) {
      timers.clear(o.waitC);
      o.waitC = null;
      o.againC = false;
    }
    if (o.waitC) {
      o.againC = true;
      return;
    }
    let watch = false;
    try {
      watch = !!k && watchable(peerId) === true;
    } catch {
      /* cannot be watched */
    }
    let sync = false;
    try {
      sync = !!k && syncable(peerId) === true;
    } catch {
      /* takes no hand-over */
    }
    let say = false;
    try {
      say = !!k && sayable(peerId) === true;
    } catch {
      /* takes no message from its agents */
    }
    const text = JSON.stringify(k ? [k, watch, sync, say] : null);
    if (text === o.sentC || (o.sentC === undefined && !k)) return;
    let c = 0;
    if (k) {
      try {
        c = stampOf(stamp(peerId));
      } catch {
        /* no counter */
      }
      if (!c) return;
    } // without a counter no operation could be taken: say nothing
    let ok = false;
    try {
      ok =
        send(
          peerId,
          k
            ? {
                t: 'control',
                c,
                clis: k,
                ...(watch ? { watch: true } : null),
                ...(sync ? { sync: true } : null),
                ...(say ? { say: true } : null),
              }
            : { t: 'control' }
        ) === true;
    } catch {
      /* no session: the next one sends it */
    }
    o.sentC = ok ? text : null;
    if (ok && k && !stopped)
      o.waitC = timers.set(() => {
        o.waitC = null;
        if (o.againC && out.get(peerId) === o) {
          o.againC = false;
          sendControl(peerId);
        }
      }, CONTROL_MS);
  }
  const drop = peerId => {
    const o = out.get(peerId);
    for (const k of ['wait', 'waitP', 'waitC', 'waitR']) if (o && o[k]) timers.clear(o[k]);
    out.delete(peerId);
  };

  // Finished tasks (6g). A report waits in `rq` (the newest of each agent, a bounded number) only
  // while this minute has no room left.
  const mayTell = peerId => {
    try {
      return !!showDetail(peerId);
    } catch {
      return false;
    }
  };

  // A result is for that computer only when its task ended at or after the time from which it may
  // be told, and less than an hour ago. Asked when it is queued and again when it is sent. A time
  // that cannot be read is "never".
  const due = (peerId, m) => {
    let from = Infinity;
    try {
      const t = tellFrom(peerId);
      from = Number.isFinite(t) && t > 0 ? t : t === 0 ? 0 : Infinity;
    } catch {
      /* never */
    }
    return m.at >= from && now() - m.at < REPORT_KEEP_MS;
  };
  const queue = (o, m) => {
    o.rq.delete(m.id);
    o.rq.set(m.id, m);
    while (o.rq.size > REPORTS_HELD) o.rq.delete(o.rq.keys().next().value);
  };

  function sendReports(peerId) {
    const o = out.get(peerId);
    if (!o) return;
    if (o.waitR) {
      timers.clear(o.waitR);
      o.waitR = null;
    }
    if (!mayTell(peerId)) {
      o.rq.clear();
      return;
    }
    const times = (told.get(peerId) || []).filter(t => now() - t < MINUTE);
    while (o.rq.size && times.length < REPORTS_MIN) {
      const [id, m] = o.rq.entries().next().value;
      o.rq.delete(id);
      if (!due(peerId, m)) continue;
      let ok = false;
      try {
        ok = send(peerId, m) === true;
      } catch {
        /* no session: a later one gets what is still recent */
      }
      if (ok) {
        times.push(now());
        o.saidR = true;
      }
    }
    if (times.length) told.set(peerId, times);
    else told.delete(peerId);
    if (o.rq.size && !stopped)
      o.waitR = timers.set(
        () => {
          o.waitR = null;
          if (out.get(peerId) === o) sendReports(peerId);
        },
        Math.max(1000, times[0] + MINUTE - now())
      );
  }

  // A session started, or the text switch was changed for that computer. On: it gets the recent
  // results (again; it keeps the newest of each agent, and the same one twice changes nothing
  // there). Off: what waited is dropped and it is told "no longer" once. saidR: undefined = nothing
  // said in this session yet (it may still hold results of an older one, so "no longer" is owed),
  // true = a report went to it, false = "no longer" was said and nothing since.
  function syncReports(peerId) {
    const o = out.get(peerId);
    if (!o) return;
    if (!mayTell(peerId)) return noLonger(peerId);
    for (const [id, m] of recent) {
      if (now() - m.at >= REPORT_KEEP_MS) recent.delete(id);
      else if (due(peerId, m)) queue(o, m);
    }
    sendReports(peerId);
  }

  // "No longer": what waited for that computer is dropped, and it is told once to drop what it
  // holds.
  function noLonger(peerId) {
    const o = out.get(peerId);
    if (!o) return;
    o.rq.clear();
    if (o.waitR) {
      timers.clear(o.waitR);
      o.waitR = null;
    }
    if (o.saidR === false) return;
    let ok = false;
    try {
      ok = send(peerId, { t: 'report' }) === true;
    } catch {
      /* no session: the next one says it */
    }
    if (ok) o.saidR = false;
  }

  // An operation for an agent of that computer. Nothing queues: without a live session, its word
  // that it takes operations from this computer, and a counter to echo, nothing is sent. One press
  // while the same operation waits for its first word. → { state: 'asked' | 'not_sent' |
  // 'too_long', n } ('asked': it left this computer; the word on it follows in the view's `ops`).
  // onWord (a file's offer only): called once with the word that ended the wait ('go', 'refused',
  // 'failed' or 'no_reply').
  function operate(peerId, kind, fill, show, onWord) {
    const v = views.get(peerId);
    if (!v || v.state !== 'live' || !out.has(peerId) || !v.ctl || !v.fresh || !reply || stopped)
      return { state: 'not_sent', n: '' };
    const sig = JSON.stringify([
      kind,
      fill.id,
      fill.do,
      fill.cli,
      fill.text,
      fill.of,
      fill.pick,
      fill.f,
      fill.files,
    ]);
    for (const e of v.ops.values())
      if (e.sig === sig && e.state === 'asked') return { state: e.state, n: e.n };
    let n = '';
    try {
      n = hex16(nonce());
    } catch {
      /* no number, nothing sent */
    }
    const msg =
      n && !v.ops.has(n)
        ? shapeOp({ ...fill, n, c: v.fresh.c, ms: Math.max(0, Math.floor(now() - v.fresh.at)) })
        : null;
    if (!msg) return { state: 'not_sent', n: '' };

    // the limit is bytes, and nothing is ever cut or split (change 7)
    if (Buffer.byteLength(JSON.stringify(msg)) > MAX_PLAIN) return { state: 'too_long', n: '' };
    let ok = false;
    try {
      ok = send(peerId, msg) === true;
    } catch {
      /* no session: nothing queues */
    }
    const e = {
      n,
      kind,
      ...show,
      sig,
      state: ok ? 'asked' : 'not_sent',
      at: now(),
      timer: null,
      onWord: ok && typeof onWord === 'function' ? onWord : null,
    };
    if (ok)
      e.timer = timers.set(() => {
        e.timer = null;
        if (e.state === 'asked') {
          e.state = 'no_reply';
          heard(e);
          emit(peerId);
        }
      }, REPLY_MS);
    v.ops.set(n, e);
    while (v.ops.size > OPS_MAX) {
      const old = v.ops.values().next().value;
      unwait(old);
      v.ops.delete(old.n);
    }
    emit(peerId);
    return { state: e.state, n };
  }

  function beat() {
    const any = [...out.values()].some(o => o.open || o.busy);
    if (!any || stopped) {
      if (beatTimer) {
        timers.clear(beatTimer);
        beatTimer = null;
      }
      return;
    }
    if (beatTimer) return;
    beatTimer = timers.set(() => {
      beatTimer = null;
      for (const [id, o] of out)
        if (o.open || o.busy) {
          try {
            send(id, { t: 'beat' });
          } catch {
            /* no session: nothing queues */
          }
        }
      beat();
    }, BEAT_MS);
  }

  // ---- receiving ----
  function watch() {
    if (staleTimer) {
      timers.clear(staleTimer);
      staleTimer = null;
    }
    let next = Infinity;
    for (const v of views.values())
      if (v.state === 'live' && waits(v)) next = Math.min(next, v.heard + STALE_MS);
    if (next === Infinity || stopped) return;
    staleTimer = timers.set(
      () => {
        staleTimer = null;
        for (const [id, v] of views)
          if (v.state === 'live' && waits(v) && now() - v.heard >= STALE_MS) {
            v.state = 'last_heard';
            emit(id);
          }
        watch();
      },
      Math.max(1000, next - now())
    );
  }

  function onMessage(from, obj) {
    const v = views.get(from);
    if (!v || !obj || typeof obj !== 'object') return; // only from a computer with a live session
    if (obj.t === 'beat') {
      v.heard = now();
      if (v.state !== 'live') {
        v.state = 'live';
        emit(from);
      }
      return watch();
    }
    if (obj.t === 'answered') {
      // Read only for an answer this computer sent and has no word on yet (same id and binding),
      // and only as one of a few known words: nothing the other computer writes here reaches the
      // page, and an `answered` nobody asked for changes nothing.
      const e =
        typeof obj.id === 'string' && typeof obj.of === 'string' ? v.asked.get(obj.id) : null;
      if (!e || e.of !== obj.of || (e.state !== 'sent' && e.state !== 'no_reply')) return;
      if (e.timer) {
        timers.clear(e.timer);
        e.timer = null;
      }
      e.state = obj.ok === true ? 'answered' : WHY.has(obj.why) ? obj.why : 'refused';
      return emit(from);
    }
    if (
      obj.t === 'prompted' ||
      obj.t === 'acted' ||
      obj.t === 'started' ||
      obj.t === 'chosen' ||
      obj.t === 'filed' ||
      obj.t === 'synced' ||
      obj.t === 'said'
    ) {
      // Read only for an operation this computer sent (its `n`), of that kind, that has no last
      // word yet, and only as one of that kind's fixed words: nothing the other computer writes
      // here reaches the page, and a reply nobody asked for changes nothing.
      let r = null;
      try {
        r = reply ? reply(obj) : null;
      } catch {
        /* not a reply */
      }
      const e = r && typeof r.n === 'string' ? v.ops.get(r.n) : null;
      if (!e || OP_REPLY[e.kind] !== r.t || !OP_OPEN.has(e.state)) return;
      const word = r.t === 'started' ? (r.ok === true ? 'started' : r.why) : r.state;
      if (
        !OP_WORDS[e.kind].includes(word) ||
        word === e.state ||
        (word === 'unsent' && e.do !== 'interrupt')
      )
        return;
      unwait(e);
      e.state = word;
      heard(e);

      // "queued": the other computer holds it and says once more how it ended; if that word never
      // comes, this says so.
      if (word === 'queued' && !stopped)
        e.timer = timers.set(() => {
          e.timer = null;
          if (e.state === 'queued') {
            e.state = 'no_reply';
            emit(from);
          }
        }, QUEUED_MS);
      return emit(from);
    }
    if (obj.t === 'control') {
      // The counter and the fixed CLI words, or nothing ("no longer"): whatever else the message
      // holds is not looked at.
      const k = shapeControl(obj),
        same =
          JSON.stringify(k ? [k.clis, k.watch, k.sync, k.say] : null) ===
          JSON.stringify(v.ctl ? [v.ctl.clis, v.ctl.watch, v.ctl.sync, v.ctl.say === true] : null);
      v.ctl = k ? { clis: k.clis, watch: k.watch, sync: k.sync, say: k.say } : null;
      v.fresh = k ? { c: k.c, at: now() } : null;
      v.heard = now();
      if (!same || v.state !== 'live') {
        v.state = 'live';
        emit(from);
      }
      return watch();
    }
    if (obj.t === 'project') {
      // Two commit ids or nothing, read again as untrusted: whatever else the message holds is not
      // looked at.
      const p = shapeProject(obj),
        same = JSON.stringify(p) === JSON.stringify(v.project);
      v.project = p;
      v.heard = now();
      if (!same || v.state !== 'live') {
        v.state = 'live';
        emit(from);
      }
      return watch();
    }
    if (obj.t === 'report') {
      // "No longer" (a message without an id): everything held from that computer goes.
      if (obj.id === undefined) {
        const had = v.reports.size > 0;
        v.reports.clear();
        v.heard = now();
        if (had || v.state !== 'live') {
          v.state = 'live';
          emit(from);
        }
        return watch();
      }

      // What that computer sends never sets how often this one redraws: a bounded number is taken
      // in a minute, whatever their shape.
      v.rin = v.rin.filter(t => now() - t < MINUTE);
      if (v.rin.length >= REPORTS_MAX) return;
      v.rin.push(now());

      // One finished task, read again field by field as untrusted text: whatever else the message
      // holds is not looked at.
      const r = shapeReport(obj);
      if (!r) return;
      const sig = JSON.stringify(r),
        // the same result again (a new session sends the recent ones again) changes nothing
        same = v.reports.get(r.id)?.sig === sig;
      if (!same) {
        // The newest of each agent, newest last by this computer's own clock; the time in the
        // message is shown, never used for order.
        v.reports.delete(r.id);
        v.reports.set(r.id, { ...r, got: now(), key: now() + '-' + ++reportN, sig });
        while (v.reports.size > REPORTS_MAX) v.reports.delete(v.reports.keys().next().value);
      }
      v.heard = now();

      // It answers a message one of this computer's agents sent (`re`): only for a number this
      // computer sent to that computer, as a `say`, for that very row, that the other computer
      // took, and once. What is done with it (an agent's command, or the card only) is the
      // service's to decide; a `re` nobody sent changes nothing.
      if (r.re) {
        const e = v.ops.get(r.re);
        if (
          e &&
          e.kind === 'say' &&
          e.id === r.id &&
          e.answered !== true &&
          (e.state === 'sent' || e.state === 'queued' || e.state === 'unconfirmed')
        ) {
          e.answered = true;
          try {
            on.answer?.(from, r.re, {
              name: r.name,
              text: r.text,
              more: r.more,
              cut: r.cut === true,
            });
          } catch {
            /* a listener's error is not ours */
          }
        }
      }
      if (!same || v.state !== 'live') {
        v.state = 'live';
        emit(from);
      }
      return watch();
    }
    if (obj.t !== 'needs' && obj.t !== 'agents') return; // not on the list: ignored
    const { g, i, n } = obj;
    if (
      !Number.isInteger(g) ||
      !Number.isInteger(i) ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > 64 ||
      i < 0 ||
      i >= n
    )
      return;
    if (obj.t === 'agents') {
      if (!Array.isArray(obj.agents)) return;
      if (!v.aparts || v.aparts.g !== g) {
        if (i !== 0) return;
        v.aparts = { g, n, got: [] };
      }
      if (v.aparts.n !== n || i !== v.aparts.got.length) {
        v.aparts = null;
        return;
      }
      v.aparts.got.push(obj.agents);
      if (v.aparts.got.length < n) return;
      const all = [],
        ids = new Set();
      for (const raw of v.aparts.got.flat()) {
        const s = shapeAgent(raw, true);
        if (s && !ids.has(s.id) && all.length < MAX_AGENTS) {
          ids.add(s.id);
          all.push(s);
        }
      }

      // the newest counter and when it arrived: echoed with every operation (change 13)
      if (stampOf(obj.c)) v.fresh = { c: obj.c, at: now() };

      // A kept result is its row's only while the row is that agent and has not begun and ended
      // another task since. `off`: no longer shown on a row (the bell's
      // entry may still name it). A task that opened after the result ended is told by the two
      // times that computer itself gave: a list built a moment before the task ended still names
      // the same task.
      for (const r of v.reports.values()) {
        const row = all.find(a => a.id === r.id);
        if (!row || row.name !== r.name || row.cli !== r.cli) r.off = true;
        else if (row.since > r.at) r.busy = true;
        else if (r.busy && !(row.since > 0)) r.off = true;
      }
      v.aparts = null;
      v.agents = all;
      v.heard = now();
      v.state = 'live';
      emit(from);
      return watch();
    }
    if (!Array.isArray(obj.items)) return;
    if (!v.parts || v.parts.g !== g) {
      if (i !== 0) return;
      v.parts = { g, n, got: [] };
    } // a list starts at its first part
    if (v.parts.n !== n || i !== v.parts.got.length) {
      v.parts = null;
      return;
    }
    v.parts.got.push(obj.items);
    if (v.parts.got.length < n) return;
    const list = [],
      seen = new Set();
    for (const raw of v.parts.got.flat()) {
      let s = shape(raw, true);
      if (!s || seen.has(s.id) || list.length >= MAX_ITEMS) continue;

      // `can` shows the buttons and nothing more (the other computer checks every answer again).
      // `of` binds an answer to this item exactly as it arrived. `can2`: the same for a longer
      // command, read with its `full` by the rule the sender used; an item that says both is
      // neither.
      if (
        bind &&
        raw.can === true &&
        raw.can2 !== true &&
        s.kind === 'permission' &&
        !s.inferred &&
        s.detail
      ) {
        s.can = true;
        s.of = bind(s);
      } else if (bind && read && raw.can2 === true && raw.can !== true) {
        let r = s;
        try {
          r = read(s, raw) || s;
        } catch {
          r = s;
        }
        if (r.can2 === true && typeof r.full === 'string') {
          s = { ...r, of: bind(r) };
        }
      }
      if (readPick && (raw.opts !== undefined || raw.row !== undefined)) {
        try {
          s = readPick(s, raw) || s;
        } catch {
          /* as it was: no options */
        }
      } // the options of a question that takes a choice (6i)
      seen.add(s.id);
      list.push(s);
    }

    // What was answered stays on its item until the other computer's list no longer has that item
    // as it was.
    for (const [id, e] of v.asked)
      if (!list.some(s => s.id === id && s.of === e.of)) {
        if (e.timer) timers.clear(e.timer);
        v.asked.delete(id);
      }
    v.parts = null;
    v.items = list;
    v.heard = now();
    v.state = 'live';
    emit(from);
    watch();
  }

  return {
    // The local list changed (an item was added, cleared or reworded): tell every computer with a
    // session.
    changed() {
      for (const id of out.keys()) sendList(id, false);
    },
    // An agent started, ended, was renamed or changed status: every computer with a session gets
    // the new list, batched.
    agentsChanged() {
      for (const id of out.keys()) sendAgents(id);
    },
    // Another project folder was opened here, or this one is on another commit: every computer with
    // a session is told, batched.
    projectChanged() {
      for (const id of out.keys()) sendProject(id);
    },
    // A session with that computer just started (remote-link's `session` event): it gets the full
    // list.
    sessionStarted(peerId) {
      if (!out.has(peerId))
        out.set(peerId, {
          sent: null,
          open: false,
          gen: 0,
          sentA: undefined,
          busy: false,
          genA: 0,
          wait: null,
          again: false,
          sentP: undefined,
          waitP: null,
          againP: false,
          sentC: undefined,
          waitC: null,
          againC: false,
          rq: new Map(),
          waitR: null,
          saidR: undefined,
        });
      else {
        const o = out.get(peerId);
        if (o.sentA !== undefined) o.sentA = null;
        if (o.sentP !== undefined) o.sentP = null;
        if (o.sentC !== undefined) o.sentC = null;
      } // a new session after an old one: the list goes again, empty or not
      if (!views.has(peerId))
        views.set(peerId, {
          state: 'live',
          heard: now(),
          items: [],
          agents: [],
          project: null,
          parts: null,
          aparts: null,
          asked: new Map(),
          ctl: null,
          fresh: null,
          ops: new Map(),
          reports: new Map(),
          rin: [],
        });
      else {
        // Whether that computer takes operations from this one is said again in every session, so
        // what an older one said is not kept.
        const v = views.get(peerId),
          had = !!v.ctl;
        v.parts = null;
        v.aparts = null;
        v.ctl = null;
        v.fresh = null;
        if (v.state === 'offline') {
          v.state = 'live';
          v.heard = now();
          emit(peerId);
        } else if (had) emit(peerId);
      } // a session is a live contact: it does not wait for a list or beat that may be lost
      sendList(peerId, true);
      sendControl(peerId);
      sendAgents(peerId);
      sendProject(peerId); // "you may control" before the rows that carry tickets
      syncReports(peerId); // the recent results, or "no longer" when the text may not go
    },
    // The session ended or the computer went offline (remote-link's `peer` event without a
    // session): nothing of it keeps "waiting"; what is left is when it was last heard, and the
    // results of tasks that finished (6g: each a past fact with its time).
    sessionEnded(peerId) {
      drop(peerId);
      beat();
      const v = views.get(peerId);
      if (!v) return;

      // An operation that left and has no word yet may or may not have been carried out: it says
      // "no reply", never "failed". One the other computer said it holds keeps waiting for that
      // computer's last word, which a later session can still bring.
      let open = false;
      for (const e of v.ops.values())
        if (e.state === 'asked') {
          unwait(e);
          e.state = 'no_reply';
          open = true;
        }
      const had =
        v.items.length || v.agents.length || v.project || v.ctl || open || v.state !== 'offline';
      v.items = [];
      v.agents = [];
      v.project = null;
      v.parts = null;
      v.aparts = null;
      v.ctl = null;
      v.fresh = null;
      v.state = 'offline';
      unask(v);
      if (had) emit(peerId);
      watch();
    },
    // The "may answer" switch was changed for that computer, or what it may answer changed: its
    // list goes again if that changes it.
    answerChanged(peerId) {
      sendList(peerId, false);
    },
    // The user pressed Allow once or Deny on an item of that computer. Nothing queues: without a
    // live session, a `can` item with that id and binding (`of`, as the page showed it) and a plain
    // yes or no, nothing is sent. One press per item while it waits or was taken. → 'sent' |
    // 'not_sent', or the item's state when it was already answered.
    answer(peerId, itemId, say, of) {
      const v = views.get(peerId),
        it = v && v.state === 'live' && out.has(peerId) ? v.items.find(x => x.id === itemId) : null;
      if (
        !it ||
        (it.can !== true && it.can2 !== true) ||
        typeof of !== 'string' ||
        it.of !== of ||
        (say !== 'yes' && say !== 'no') ||
        stopped
      )
        return 'not_sent';
      const was = v.asked.get(it.id);
      if (
        was &&
        was.of === of &&
        (was.state === 'sent' || was.state === 'answered' || was.state === 'failed')
      )
        return was.state;
      if (was && was.timer) timers.clear(was.timer);
      let ok = false;
      try {
        ok = send(peerId, { t: 'answer', id: it.id, of, say }) === true;
      } catch {
        /* no session: nothing queues */
      }
      const e = { of, say, state: ok ? 'sent' : 'not_sent', timer: null };
      if (ok)
        e.timer = timers.set(() => {
          e.timer = null;
          if (e.state === 'sent') {
            e.state = 'no_reply';
            emit(peerId);
          }
        }, REPLY_MS);
      v.asked.set(it.id, e);
      emit(peerId);
      return e.state;
    },
    // What that computer may control here changed (its switch), or for every computer (the CLIs
    // that can be started, the plan): it is told, and its agent list goes again when the tickets in
    // it changed.
    controlChanged(peerId) {
      for (const id of peerId === undefined ? [...out.keys()] : [peerId]) {
        sendControl(id);
        sendAgents(id);
      }
    },
    // The user sent a prompt to an agent of that computer (6f, operation 1). Only for a row that
    // carries a ticket, from a computer that says it takes operations from this one. → { state, n }
    // as operate() above.
    prompt(peerId, agentId, text) {
      const v = views.get(peerId),
        a = v && v.ctl ? v.agents.find(x => x.id === agentId) : null;
      return a && a.to && typeof text === 'string' && text
        ? operate(peerId, 'prompt', { t: 'prompt', id: a.id, to: a.to, text }, { id: a.id })
        : { state: 'not_sent', n: '' };
    },
    // Interrupt or Stop on an agent of that computer (operations 2 and 3): one of two literal
    // words. "Choose option N" for a question of that computer's agent (6i). Only for an item that
    // arrived with its options and its agent row (`opts`, `row`, read by `readPick`), with the
    // binding the page showed (`kof`), a number within the options, and while that row can be
    // controlled (it has a ticket). Nothing is a key: the other computer answers the question
    // itself. → { state, n }.
    choose(peerId, itemId, pick, kof) {
      const v = views.get(peerId),
        it = v && v.ctl && v.state === 'live' ? v.items.find(x => x.id === itemId) : null;
      const a =
        it &&
        Array.isArray(it.opts) &&
        typeof it.kof === 'string' &&
        it.kof === kof &&
        Number.isInteger(pick) &&
        pick >= 1 &&
        pick <= it.opts.length
          ? v.agents.find(x => x.id === it.row)
          : null;
      return a && a.to
        ? operate(
            peerId,
            'choose',
            { t: 'choose', id: a.id, to: a.to, of: it.kof, pick },
            { id: a.id, pick }
          )
        : { state: 'not_sent', n: '' };
    },
    // A file for a prompt to that agent: the offer of one file,
    // then the prompt that names the finished ones. Both carry the row's ticket as a prompt does.
    // fill: { f, kind, bytes, parts, sha } as remote-files.js made it.
    offer(peerId, agentId, fill, onWord) {
      const v = views.get(peerId),
        a = v && v.ctl ? v.agents.find(x => x.id === agentId) : null;
      return a && a.to && fill && typeof fill === 'object'
        ? operate(
            peerId,
            'file',
            {
              t: 'file',
              id: a.id,
              to: a.to,
              f: fill.f,
              kind: fill.kind,
              bytes: fill.bytes,
              parts: fill.parts,
              sha: fill.sha,
            },
            { id: a.id },
            onWord
          )
        : { state: 'not_sent', n: '' };
    },
    promptf(peerId, agentId, text, files) {
      const v = views.get(peerId),
        a = v && v.ctl ? v.agents.find(x => x.id === agentId) : null;
      return a && a.to && typeof text === 'string' && text && Array.isArray(files)
        ? operate(
            peerId,
            'promptf',
            { t: 'promptf', id: a.id, to: a.to, text, files },
            { id: a.id }
          )
        : { state: 'not_sent', n: '' };
    },
    act(peerId, agentId, what) {
      const v = views.get(peerId),
        a = v && v.ctl ? v.agents.find(x => x.id === agentId) : null;
      return a && a.to && (what === 'interrupt' || what === 'stop')
        ? operate(peerId, 'act', { t: 'act', id: a.id, to: a.to, do: what }, { id: a.id, do: what })
        : { state: 'not_sent', n: '' };
    },
    // Start an agent on that computer (operation 4): a CLI it says can be started there, in the
    // project named by its first commit's id, with an optional first prompt. No folder, path, name,
    // model or effort can be named.
    sync(peerId, project, id) {
      // the git hand-over: "fetch this commit of the project we both have open into your branch for
      // me"
      const v = views.get(peerId);
      return v && v.ctl && v.ctl.sync === true && commit(project) && commit(id)
        ? operate(peerId, 'sync', { t: 'sync', project, commit: id }, {})
        : { state: 'not_sent', n: '' };
    },
    start(peerId, cli, project, text) {
      const v = views.get(peerId),
        first = typeof text === 'string' && text ? text : undefined;
      return v &&
        v.ctl &&
        typeof cli === 'string' &&
        v.ctl.clis.includes(cli) &&
        (text == null || text === '' || first)
        ? operate(peerId, 'start', { t: 'start', cli, project, text: first }, { cli })
        : { state: 'not_sent', n: '' };
    },
    // An agent of this computer finished a task (6g): { id, name, cli, at, task, did, text, p }.
    // Every computer with a session that may see the text gets it, at the rate above, and it is
    // kept for a session that starts within the hour. → false: nothing to tell. tag: { peer, re,
    // cut } when this task answers a message an agent of that one computer sent (remote-say.js
    // tagFor): only that computer's copy carries `re`, and the copy kept for later sessions never
    // does.
    reported(raw, tag) {
      const m = stopped ? null : fitReport(raw);

      // a task that ended an hour ago is not kept either
      if (!m || now() - m.at >= REPORT_KEEP_MS) return false;
      const mine =
        tag && typeof tag.peer === 'string' && hex16(tag.re)
          ? fitReport({ ...raw, re: tag.re, cut: tag.cut === true })
          : null;
      recent.delete(m.id);
      recent.set(m.id, m);
      while (recent.size > REPORTS_HELD) recent.delete(recent.keys().next().value);
      for (const [id, o] of out)
        if (mayTell(id) && due(id, m)) {
          queue(o, mine && tag.peer === id ? mine : m);
          sendReports(id);
        }
      return true;
    },
    // A message from one of this computer's agents for an agent of that computer.
    // Only for a row that computer marked as taking one (`m`), on a
    // computer that says it takes them. onWord: called once with the other computer's first word on
    // it (or 'no_reply'). → { state, n } as operate() above.
    say(peerId, agentId, kind, by, text, onWord) {
      const v = views.get(peerId),
        a =
          v && v.ctl && v.ctl.say === true && v.state === 'live'
            ? v.agents.find(x => x.id === agentId)
            : null;
      return a &&
        a.to &&
        a.m === true &&
        (kind === 'ask' || kind === 'send') &&
        typeof text === 'string' &&
        text
        ? operate(
            peerId,
            'say',
            {
              t: 'say',
              id: a.id,
              to: a.to,
              kind,
              by: { name: String((by && by.name) || ''), cli: String((by && by.cli) || '') },
              text,
            },
            { id: a.id },
            onWord
          )
        : { state: 'not_sent', n: '' };
    },
    // This computer stops telling (connecting goes off, it signs out, it forgets that computer):
    // every computer with a session, or that one, is told "no longer" while it can still hear it,
    // so what it holds of this one has an end.
    takeBack(peerId) {
      for (const id of peerId === undefined ? [...out.keys()] : [peerId]) noLonger(id);
    },
    // Nothing of that computer's finished tasks stays (its pairing was paused).
    forgetReports(peerId) {
      const v = views.get(peerId);
      if (!v) return;
      v.rin = [];
      if (v.reports.size) {
        v.reports.clear();
        emit(peerId);
      }
    },
    // What a `view` or a `keep` for an agent of that computer carries (6h): its row id, its ticket
    // and the freshness pair, only while that computer says it can be watched from here and the row
    // has a ticket. → null: nothing can be sent.
    viewFields(peerId, agentId) {
      const v = views.get(peerId),
        a =
          v &&
          v.state === 'live' &&
          out.has(peerId) &&
          v.ctl &&
          v.ctl.watch === true &&
          v.fresh &&
          !stopped
            ? v.agents.find(x => x.id === agentId)
            : null;
      return a && a.to
        ? { id: a.id, to: a.to, c: v.fresh.c, ms: Math.max(0, Math.floor(now() - v.fresh.at)) }
        : null;
    },
    // Does any computer have a session to send to? The app builds its agent list only then.
    listening: () => out.size > 0,
    // The switch "send the question text" was changed for that computer: its list is sent again.
    // Which project is open follows the switch at once, not after the wait between two project
    // messages.
    detailChanged(peerId) {
      sendList(peerId, true);
      const o = out.get(peerId);
      if (o && o.sentA !== undefined) {
        o.sentA = null;
        sendAgents(peerId);
      }
      if (o && o.waitP) {
        timers.clear(o.waitP);
        o.waitP = null;
        o.againP = false;
      }
      sendProject(peerId);
      sendControl(peerId); // without the text switch there is no control: said at once

      // nor finished tasks: what that computer holds of them is taken back at once
      syncReports(peerId);
    },
    onMessage,
    forget(peerId) {
      drop(peerId);
      told.delete(peerId);
      const v = views.get(peerId);
      if (v) {
        unask(v);
        for (const e of v.ops.values()) unwait(e);
      }
      views.delete(peerId);
      beat();
      watch();
    },
    view: peerId => {
      const v = views.get(peerId);
      return v ? copy(v) : null;
    },
    stop() {
      stopped = true;
      for (const t of [
        beatTimer,
        staleTimer,
        ...[...out.values()].flatMap(o => [o.wait, o.waitP, o.waitC, o.waitR]),
      ])
        if (t) timers.clear(t);
      beatTimer = staleTimer = null;
      recent.clear();
      for (const o of out.values()) {
        o.wait = o.waitP = o.waitC = o.waitR = null;
        o.rq.clear();
      }
      for (const v of views.values()) {
        unask(v);
        for (const e of v.ops.values()) unwait(e);
      }
    },
  };
}

module.exports = {
  createRemoteApi,
  shape,
  shapeAgent,
  shapeProject,
  shapeControl,
  shapeOp,
  shapeReport,
  fitReport,
  shapeView,
  shapeViewing,
  shapeFrame,
  shapeUnview,
  FRAME_Z,
  VIEW_STATES,
  UNVIEW_WHY,
  projectKey,
  wholeShell,
  REPORTS_MIN,
  REPORTS_HELD,
  REPORTS_MAX,
  REPORT_KEEP_MS,
  REPORT_OFFLINE_MS,
  REPORT_TEXT,
  START_CLIS,
  BEAT_MS,
  STALE_MS,
  MAX_ITEMS,
  ROSTER_MS,
  MAX_AGENTS,
  REPLY_MS,
  PROJECT_MS,
  CONTROL_MS,
  QUEUED_MS,
  OPS_MAX,
};
