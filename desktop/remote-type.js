// Technically Not · remote-type.js — typing from a paired computer into a terminal of this one
// that it is watching right now (plan item 41 of docs/plans/multi-computer.md; the risks are in
// docs/plans/remote-typing.md). Pure Node: the clocks, the timers, the rights, the open view, the
// write into the terminal and the sending are handed in, so tools/remote-type-test.js runs it with
// stand-ins. Three parts:
// - The two messages, shaped field by field by both computers (shapeType, shapeTyped), and what a
//   batch writes into a terminal (bytesFor).
// - The typed side (createTyping): the order of checks for one batch of keys, the ticket for a
//   plain terminal (Your terminal, a PowerShell thread), and the log line.
// - The typing side (createTyper): keys gathered into small batches, one batch on its way at a
//   time, at most 20 a minute, nothing held without saying so, nothing sent again.
//
// The rules, in the words of the user's decision of 2026-10-07 and the brief of 2026-10-21:
// - Its own right, off by default, given per computer under full control (`rights` below is that
//   right, never full control alone). Every way full control ends, typing ends.
// - Only into the panel that this same computer is watching now, through that view: the view's
//   number, the panel and its ticket must all match, and are asked again in the turn of the write.
// - A key that was pressed on an old picture is refused, never guessed ("stale"). Typed letters
//   may land while their own echo is still on its way (see `stale` below); Enter, Tab and the
//   arrows that move in a list only land on the newest picture.
// - Batches are numbered: one is applied once, in order, or not at all. A gap ends the round.
// - Nothing typed is kept: no key, letter or paste reaches a log, the list, the window's state or
//   an error. The log line counts keys and names Enter, Esc and Ctrl+C, nothing else.
'use strict';
const crypto = require('crypto');
const { MAX_PLAIN } = require('./remote-noise.js');

const MINUTE = 60 * 1000;

// The keys that can be named, and what each writes: the same bytes this app's own terminal writes
// for that key in its normal cursor mode. Shift+Tab is left out on purpose: in Claude Code it
// changes the permission mode.
const KEYS = {
  Enter: '\r',
  Esc: '\x1b',
  Tab: '\t',
  Backspace: '\x7f',
  Delete: '\x1b[3~',
  Up: '\x1b[A',
  Down: '\x1b[B',
  Right: '\x1b[C',
  Left: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
  CtrlC: '\x03',
};
const KEY_NAMES = Object.keys(KEYS);

// Keys that only edit the line being typed: they cannot send, choose or confirm anything.
const LINE_KEYS = new Set(['Backspace', 'Delete', 'Left', 'Right', 'Home', 'End']);

// Keys that stop or leave something: a batch of only these may land on an old picture (a
// streaming agent's screen never stands still long enough for a fresh one).
const STOP_KEYS = new Set(['Esc', 'CtrlC']);

// What one batch may hold.
const ITEMS_MAX = 32;
const TEXT_ITEM_MAX = 64; // characters of one piece of text
const TEXT_MAX = 256; // characters of text in one batch
const PASTE_MAX = 1500; // characters of one paste

// How often, counted on the typed side first (past it: silence) and kept below by the typing side.
const BATCHES_MIN = 20;
const PASTES_MIN = 4;

// A message is too late after this many milliseconds beyond its freshness stamp (a prompt has 60 s;
// a key is about the screen as it is now).
const TYPE_FRESH_MS = 5000;

// Changes of the screen within this long after this computer's own typed letters landed are read
// as their echo (see `stale`).
const ECHO_MS = 2000;

// One-time numbers are remembered this long.
const N_MS = 10 * MINUTE;

// The typing side: the least time between two batches, how long a reply may take, how long Enter
// waits for the picture to show the letters before it, and how long a round stays open without a
// key.
const GAP_MS = 500;
const REPLY_MS = 8000;
const CATCH_UP_MS = 3000;
const IDLE_MS = 60 * 1000;

// A log line takes the batches of one computer into one panel until this long without one.
const LINE_MS = 2 * MINUTE;

const STATES = ['done', 'stale', 'changed', 'refused', 'failed'];

const hex16 = v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '');
const stampOf = v => (Number.isInteger(v) && v > 0 && v <= 0x7fffffff ? v : 0);
const rowId = v =>
  typeof v === 'string' && v !== '' && v.length <= 80 && !/[\p{Cc}\p{Cf}]/u.test(v) ? v : '';

// Text that can be typed: no control, format (zero-width, direction), surrogate half or line and
// paragraph separator characters. Refused whole, never repaired.
const NOT_TYPED = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u;
const chars = s => Array.from(s).length;

// A paste may also hold line ends ("\n" only, after "\r\n" and "\r" became "\n" on the typing
// side).
const pasteOk = s =>
  typeof s === 'string' &&
  s !== '' &&
  chars(s) <= PASTE_MAX &&
  !NOT_TYPED.test(s.replace(/\n/g, ''));

const sameTicket = (a, b) =>
  !!hex16(a) && !!hex16(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fitsOne = m => Buffer.byteLength(JSON.stringify(m)) <= MAX_PLAIN;

// ---- the two messages ----

// One item of a batch: a key by name, or { x: text }. → the item, or null.
function shapeItem(it) {
  if (typeof it === 'string') return KEY_NAMES.includes(it) ? it : null;
  if (!it || typeof it !== 'object' || typeof it.x !== 'string') return null;
  const x = it.x;
  if (x === '' || chars(x) > TEXT_ITEM_MAX || NOT_TYPED.test(x)) return null;
  return { x };
}

// { t: 'type', n, c, ms, v, id, to, r, s, f, k | p } from the typing computer. v: the view it
// watches; id, to: the row and its ticket; r: the round, s: the batch's number in it (1, 2, …);
// f: the number of the newest picture it drew; k: the keys, or p: one paste. → the message read
// field by field, or null.
function shapeType(m) {
  if (!m || typeof m !== 'object' || m.t !== 'type') return null;
  const n = hex16(m.n),
    c = stampOf(m.c),
    v = hex16(m.v),
    r = hex16(m.r),
    id = rowId(m.id),
    to = hex16(m.to);
  if (!n || !c || !v || !r || !id || !to) return null;
  if (!Number.isSafeInteger(m.ms) || m.ms < 0) return null;
  if (!Number.isInteger(m.s) || m.s < 1 || m.s > 0x7fffffff) return null;
  if (!Number.isInteger(m.f) || m.f < 1 || m.f > 0x7fffffff) return null;
  const out = { t: 'type', n, c, ms: m.ms, v, id, to, r, s: m.s, f: m.f };
  if (m.p !== undefined) {
    if (m.k !== undefined || !pasteOk(m.p)) return null;
    out.p = m.p;
  } else {
    if (!Array.isArray(m.k) || m.k.length < 1 || m.k.length > ITEMS_MAX) return null;
    const k = m.k.map(shapeItem);
    if (k.some(it => !it)) return null;
    const text = k.reduce((sum, it) => sum + (typeof it === 'string' ? 0 : chars(it.x)), 0);
    if (text > TEXT_MAX) return null;
    out.k = k;
  }
  return fitsOne(out) ? out : null;
}

// { t: 'typed', n, state } from the typed computer: one word, no reason crosses. An unknown word
// reads as the refusing one.
function shapeTyped(m) {
  if (!m || typeof m !== 'object' || m.t !== 'typed') return null;
  const n = hex16(m.n);
  return n ? { t: 'typed', n, state: STATES.includes(m.state) ? m.state : 'refused' } : null;
}

// Which kind of batch: 'line' (text and line keys only), 'stop' (Esc and Ctrl+C only), or 'commit'
// (anything that can send, choose or confirm; a paste counts as one).
function kindOf(m) {
  if (m.p !== undefined) return 'commit';
  if (m.k.every(it => typeof it === 'string' && STOP_KEYS.has(it))) return 'stop';
  return m.k.every(it => typeof it !== 'string' || LINE_KEYS.has(it)) ? 'line' : 'commit';
}

// What a batch writes into the terminal of a panel that runs `cli`. A paste goes to an agent CLI as
// one bracketed paste (so its lines are one input, not several Enters); into a plain terminal
// (`cli` 'Terminal') a paste with a line end is refused, since each line would run as a command
// the moment it lands. → the bytes, or '' when it is refused.
function bytesFor(m, cli) {
  if (m.p !== undefined) {
    if (cli === 'Terminal') return m.p.includes('\n') ? '' : m.p;
    return '\x1b[200~' + m.p.replace(/\n/g, '\r') + '\x1b[201~';
  }
  return m.k.map(it => (typeof it === 'string' ? KEYS[it] : it.x)).join('');
}

// What the log line says of a batch: counts and the names of the keys that do something, never a
// letter.
function countOf(m) {
  if (m.p !== undefined)
    return { keys: 0, letters: 0, enter: 0, esc: 0, ctrlc: 0, pastes: 1, pasted: chars(m.p) };
  const c = { keys: 0, letters: 0, enter: 0, esc: 0, ctrlc: 0, pastes: 0, pasted: 0 };
  for (const it of m.k) {
    if (typeof it !== 'string') c.letters += chars(it.x);
    else {
      c.keys++;
      if (it === 'Enter') c.enter++;
      if (it === 'Esc') c.esc++;
      if (it === 'CtrlC') c.ctrlc++;
    }
  }
  return c;
}

// The log line's words for the counts so far.
function summary(c) {
  const parts = [];
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  if (c.letters) parts.push(plural(c.letters, 'character', 'characters'));
  const other = c.keys - c.enter - c.esc - c.ctrlc;
  if (other) parts.push(plural(other, 'key', 'keys'));
  if (c.enter) parts.push(plural(c.enter, 'Enter', 'Enters'));
  if (c.esc) parts.push(plural(c.esc, 'Esc', 'Escs'));
  if (c.ctrlc) parts.push(plural(c.ctrlc, 'Ctrl+C', 'Ctrl+Cs'));
  if (c.pastes) parts.push(plural(c.pastes, 'paste', 'pastes') + ' of ' + c.pasted + ' characters');
  return parts.join(', ');
}

// ---- the typed side ----
// Handed in (each called inside try/catch; a throw reads as the refusing answer):
// rights(peerId) → the pairing id that computer's typing right was given for, '' when it has none
// now (off, paused, stopping, full control off). fresh(peerId, msg, ms) → the message is not one
// the relay held back longer than ms (remote-control.js `fresh`). view(peerId) → that computer's
// open view on this one now, or null: { v, panelId, ticket, s: the newest picture's number,
// dirty: a changed screen waits to be sent, dirtyAt, times: [[s, when sent], …] } (remote-view.js
// `typingState`). ticket(peerId, panelId) → that panel's ticket for that computer now.
// agentNow(panelId) → what the panel runs now ({ cli, name, … } as remote-control.js reads it).
// deliver({ peerId, panelId, data, guard }) → 'done' | 'changed' | 'refused' | 'failed'
// (remote-actions.js `type`): guard() in the turn of the write. send(peerId, obj) → true when it
// left. log({ peerId, from, agent, panelId }) → a function (summary) that rewrites the line, or a
// throw when no line can be written (then nothing is typed). peerName(peerId) → the name as this
// computer shows it. typed({ panelId, peerId, name }) → the window shows the mark. mono() → a clock
// that only goes forward. random(n) → n random bytes. questionOpen(panelId) → false only when no
// question (permission, menu, trust) is open in that panel now (review 23, L6).
function createTyping({
  questionOpen = () => true,
  rights = () => '',
  fresh = () => false,
  view = () => null,
  ticket = () => '',
  agentNow = () => null,
  deliver = () => 'failed',
  send = () => false,
  log = () => {
    throw new Error('no list');
  },
  peerName = () => '',
  typed = () => {},
  mono = () => performance.now(),
  random = crypto.randomBytes,
} = {}) {
  // The key of the tickets for plain terminals: made once per start, never leaves this closure.
  const secret = Buffer.from(random(32));
  if (secret.length !== 32) throw new Error('remote-type: no random key');

  // peer id → { batches, pastes: times; ns: Map n → when; round: { v, r, s, chainAt, lastAt },
  // line: { panelId, at, counts, write } }
  const peers = new Map();
  let stopped = false;
  const ask = (fn, ...a) => {
    try {
      return fn(...a);
    } catch {
      return undefined;
    }
  };
  const peer = id => {
    let p = peers.get(id);
    if (!p)
      peers.set(id, (p = { batches: [], pastes: [], ns: new Map(), round: null, line: null }));
    return p;
  };
  const counted = (list, t, max) => {
    while (list.length && t - list[0] >= MINUTE) list.shift();
    if (list.length >= max) return false;
    list.push(t);
    return true;
  };
  const reply = (peerId, n, state) => {
    try {
      send(peerId, shapeTyped({ t: 'typed', n, state }));
    } catch {
      /* no session: the other computer reads "no reply" */
    }
    return { replied: state };
  };

  // A plain terminal panel the app runs: Your terminal or a PowerShell thread, not a sign-in run.
  const terminalNow = panelId => {
    const a = ask(agentNow, panelId);
    return a &&
      typeof a === 'object' &&
      a.running === true &&
      a.cli === 'Terminal' &&
      a.mode === 'run' &&
      Number.isInteger(a.pid) &&
      a.pid > 0 &&
      Number.isFinite(a.startedAt)
      ? a
      : null;
  };

  // A ticket for a plain terminal, for a computer that holds the typing right: over the pairing,
  // the computer, the panel and the process it runs now. A restart of the shell ends it.
  const terminalTicket = (peerId, panelId) => {
    const pairing = typeof peerId === 'string' && peerId ? ask(rights, peerId) : '',
      id = rowId(panelId),
      a = pairing && id ? terminalNow(id) : null;
    if (!a) return '';
    return crypto
      .createHmac('sha256', secret)
      .update(['tnai-type-v1', pairing, peerId, id, 'Terminal', a.pid, a.startedAt].join('\n'))
      .digest('hex')
      .slice(0, 16);
  };

  // Is the picture the typing computer saw the screen as it is now? A batch of only Esc and
  // Ctrl+C lands on any picture of the view. Otherwise the newest picture must be the one it drew,
  // with no changed screen waiting to be sent, except for one case: letters typed one batch after
  // another change the screen themselves, so while a chain of 'line' batches runs (each within
  // ECHO_MS of the last), every change that began after the chain's first batch landed is read as
  // their echo. The chain starts only on a fresh picture, and a batch that can send or choose
  // always needs a fresh one. asking: a question is open in that panel (or not known), and then the
  // echo is never assumed: a CLI that picks a menu item with one key would take a letter meant for
  // the prompt (review 23, L6).
  function stale(m, kind, vs, round, t, asking) {
    if (kind === 'stop') return false;
    if (m.f === vs.s && !vs.dirty) return false;
    if (asking) return true;
    if (kind !== 'line' || !round || round.chainAt === null || t - round.lastAt > ECHO_MS)
      return true;
    const since = round.chainAt;
    const later = (Array.isArray(vs.times) ? vs.times : []).filter(x => x[0] > m.f);
    if (later.length !== vs.s - m.f) return true; // a picture's time is not known: not guessed
    if (later.some(x => !(x[1] >= since))) return true;
    return vs.dirty ? !(vs.dirtyAt >= since) : false;
  }

  // The list line: one per computer and panel while batches keep coming, rewritten with the
  // counts; a new one after LINE_MS without a batch. → false when no line can be written.
  function noteBatch(peerId, p, panelId, from, agent, m, t) {
    let line = p.line;
    if (!line || line.panelId !== panelId || t - line.at > LINE_MS) {
      const write = ask(log, { peerId, from, agent, panelId });
      if (typeof write !== 'function') return false;
      line = p.line = {
        panelId,
        at: t,
        write,
        counts: { keys: 0, letters: 0, enter: 0, esc: 0, ctrlc: 0, pastes: 0, pasted: 0 },
      };
    }
    const c = countOf(m);
    for (const k of Object.keys(c)) line.counts[k] += c[k];
    line.at = t;
    ask(line.write, summary(line.counts));
    return true;
  }

  // One batch of keys from a paired computer. The wiring calls this only for a computer whose
  // typing right is on and only when the link has room for the reply.
  function receive(peerId, msg) {
    if (stopped || typeof peerId !== 'string' || !peerId || !msg || msg.t !== 'type')
      return { ignored: true };
    const t = mono(),
      p = peer(peerId);

    // counted first, before anything is looked at; past the limit nothing is sent back
    if (!counted(p.batches, t, BATCHES_MIN)) return { silent: 'limit' };
    const pairing = ask(rights, peerId);
    if (typeof pairing !== 'string' || !pairing) return { silent: 'off' };
    const m = shapeType(msg);
    if (!m) return { silent: 'shape' };
    if (m.p !== undefined && !counted(p.pastes, t, PASTES_MIN)) return { silent: 'limit' };
    for (const [k, at] of p.ns) if (t - at >= N_MS) p.ns.delete(k);
    if (p.ns.has(m.n)) return { silent: 'seen' };
    p.ns.set(m.n, t);
    if (ask(fresh, peerId, msg, TYPE_FRESH_MS) !== true) return reply(peerId, m.n, 'refused');

    // the view this computer has open for that computer, on that panel, with that ticket
    const vs = ask(view, peerId);
    if (!vs || typeof vs !== 'object' || vs.v !== m.v || vs.panelId !== m.id)
      return reply(peerId, m.n, 'changed');
    const tk = ask(ticket, peerId, m.id);
    if (!sameTicket(m.to, tk) || !sameTicket(tk, vs.ticket)) return reply(peerId, m.n, 'changed');
    if (!Number.isInteger(vs.s) || m.f > vs.s) return reply(peerId, m.n, 'refused');

    // the round: a new one starts at 1; inside one, every batch is the one after the last
    let round = p.round && p.round.v === m.v && p.round.r === m.r ? p.round : null;
    if (!round) {
      if (m.s !== 1) return reply(peerId, m.n, 'refused');
      round = p.round = { v: m.v, r: m.r, s: 0, broken: false, chainAt: null, lastAt: -Infinity };
    }
    if (round.broken || m.s !== round.s + 1) {
      round.broken = true;
      return reply(peerId, m.n, 'refused');
    }
    const a = ask(agentNow, m.id),
      cli = a && typeof a.cli === 'string' ? a.cli : '',
      data = cli ? bytesFor(m, cli) : '';
    if (!data) return reply(peerId, m.n, 'refused');
    const kind = kindOf(m);
    const asking = ask(questionOpen, m.id) !== false;
    if (stale(m, kind, vs, round, t, asking)) return reply(peerId, m.n, 'stale');

    // taken: the number is in order and the line is written before anything is typed
    round.s = m.s;
    const from = String(ask(peerName, peerId) || 'Computer'),
      agent = a && typeof a.name === 'string' ? a.name : '';
    if (!noteBatch(peerId, p, m.id, from, agent, m, t)) return reply(peerId, m.n, 'refused');
    if (kind === 'line') {
      if (round.chainAt === null || t - round.lastAt > ECHO_MS) round.chainAt = t;
    } else if (kind === 'commit') round.chainAt = null;
    round.lastAt = t;

    // asked again in the turn of the write
    const guard = () => {
      if (stopped || ask(rights, peerId) !== pairing) return false;
      const now = ask(view, peerId);
      return (
        !!now && now.v === m.v && now.panelId === m.id && sameTicket(ask(ticket, peerId, m.id), tk)
      );
    };
    let word;
    try {
      word = deliver({ peerId, panelId: m.id, data, guard });
    } catch {
      word = 'failed';
    }

    // 'changed': a prompt was half-way in that input (remote-actions.js `type`, review 23, L7)
    if (word !== 'done') word = word === 'refused' || word === 'changed' ? word : 'failed';
    if (word === 'done') ask(typed, { panelId: m.id, peerId, name: from });
    else round.broken = true;
    return reply(peerId, m.n, word);
  }

  return {
    receive,
    ticketFor: terminalTicket,
    // That computer's right ended, by any path, or its view did: its round is over, so a batch
    // that was on its way is refused.
    endFor(peerId) {
      const p = peers.get(peerId);
      if (p) {
        p.round = null;
        p.line = null;
      }
    },
    quit() {
      stopped = true;
      peers.clear();
    },
  };
}

// ---- the typing side ----
// Handed in: send(peerId, obj) → true when it left. fields(peerId, agentId) → { id, to, c, ms } for
// a row this computer may watch now (remote-api.js viewFields), or null. seen() → this computer's
// open view of another computer's panel: { peer, agent, v, s: the newest picture drawn, at: when it
// arrived (mono), state } or null (remote-view.js createWatcher `seen`). allowed(peerId) → that
// computer says this one may type there. nonce() → 16 hex characters. on.changed(status) → what
// the typing box says changed. mono(), timers.
function createTyper({
  send = () => false,
  fields = () => null,
  seen = () => null,
  allowed = () => false,
  nonce = () => crypto.randomBytes(8).toString('hex'),
  on = {},
  mono = () => performance.now(),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
} = {}) {
  // The one round: { peer, agent, v, r, s, gathered: [items] | null, paste: text | null, flight:
  // { n, s, kind, timer } | null, sent: times, appliedAt, frameAtApply, wake, idle }
  let round = null,
    said = '',
    saidAt = 0,
    stopped = false;
  const ask = (fn, ...a) => {
    try {
      return fn(...a);
    } catch {
      return undefined;
    }
  };
  const off = h => {
    if (h) timers.clear(h);
    return null;
  };
  const changed = () => {
    try {
      on.changed?.(status());
    } catch {
      /* a listener's error is not ours */
    }
  };
  const waiting = () =>
    !round ? 0 : (round.gathered ? round.gathered.length : 0) + (round.paste !== null ? 1 : 0);

  function status() {
    return {
      peer: round ? round.peer : '',
      agent: round ? round.agent : '',
      on: !!round,
      sending: !!(round && round.flight),
      waiting: waiting(),
      said,
      at: saidAt,
    };
  }

  // The round ends: what was gathered and not sent is said, never kept for later.
  function finish(word) {
    const r = round;
    if (!r) return;
    const left = waiting();
    round = null;
    if (r.flight) r.flight.timer = off(r.flight.timer);
    r.wake = off(r.wake);
    r.idle = off(r.idle);
    said = left && word === 'ended' ? 'ended_unsent' : word;
    saidAt = mono();
    changed();
  }

  // The open view of that agent, once it has drawn a picture: a key with no picture to aim at is
  // not sent (learned 2026-10-21: a view's first picture can be a second late, since the views
  // send one picture a second between them).
  const viewOf = (peer, agent) => {
    const w = ask(seen);
    return w &&
      w.peer === peer &&
      w.agent === agent &&
      w.state === 'on' &&
      Number.isInteger(w.s) &&
      w.s >= 1
      ? w
      : null;
  };

  // Send what was gathered, when nothing is on its way, the gap passed and the minute has room.
  // Enter and the other keys that send or choose wait (up to CATCH_UP_MS) until a picture newer
  // than the last batch arrived, so they are pressed on the screen as it is; letters before them go
  // at once.
  function pump() {
    const r = round;
    if (!r || r.flight || stopped) return;
    if (!r.gathered && r.paste === null) return;
    r.wake = off(r.wake);
    const w = viewOf(r.peer, r.agent);
    if (!w || ask(allowed, r.peer) !== true) return finish('ended');
    const t = mono(),
      later = ms => {
        r.wake = timers.set(
          () => {
            r.wake = null;
            pump();
          },
          Math.max(1, ms)
        );
      };
    while (r.sent.length && t - r.sent[0] >= MINUTE) r.sent.shift();
    if (r.sent.length >= BATCHES_MIN) return later(r.sent[0] + MINUTE - t);
    const last = r.sent.length ? r.sent[r.sent.length - 1] : -Infinity;
    if (t - last < GAP_MS) return later(last + GAP_MS - t);
    let msg;
    if (r.paste !== null) {
      if (r.appliedAt > -Infinity && !(w.at > r.appliedAt) && t - r.appliedAt < CATCH_UP_MS)
        return later(r.appliedAt + CATCH_UP_MS - t);
      msg = { p: r.paste };
      r.paste = null;
    } else {
      const items = r.gathered;
      const first = items.findIndex(it => typeof it === 'string' && !LINE_KEYS.has(it));
      const behind =
        r.appliedAt > -Infinity && !(w.at > r.appliedAt) && t - r.appliedAt < CATCH_UP_MS;
      const onlyStop = items.every(it => typeof it === 'string' && STOP_KEYS.has(it));
      let take = items;
      if (first >= 0 && behind && !onlyStop) {
        if (first === 0) return later(r.appliedAt + CATCH_UP_MS - t);
        take = items.slice(0, first);
      }
      msg = { k: take };
      r.gathered = take.length === items.length ? null : items.slice(take.length);
    }
    const f = ask(fields, r.peer, r.agent);
    if (!f) return finish('ended');
    const n = nonce();
    const full = shapeType({
      t: 'type',
      n,
      c: f.c,
      ms: f.ms,
      v: r.v,
      id: f.id,
      to: f.to,
      r: r.r,
      s: r.s + 1,
      f: w.s,
      ...msg,
    });
    if (!full) return finish('refused');
    let ok = false;
    try {
      ok = send(r.peer, full) === true;
    } catch {
      ok = false;
    }
    if (!ok) return finish('failed');
    r.s++;
    r.sent.push(t);
    r.flight = {
      n,
      timer: timers.set(() => {
        if (round === r && r.flight && r.flight.n === n) {
          r.flight = null;
          finish('no_reply');
        }
      }, REPLY_MS),
    };
    changed();
  }

  // A round belongs to one view of one agent; a new view or another agent starts a new one.
  function roundFor(peer, agent) {
    const w = viewOf(peer, agent);
    if (!w || ask(allowed, peer) !== true || !ask(fields, peer, agent)) return null;
    if (round && (round.peer !== peer || round.agent !== agent || round.v !== w.v)) finish('ended');
    if (!round)
      round = {
        peer,
        agent,
        v: w.v,
        r: nonce(),
        s: 0,
        gathered: null,
        paste: null,
        flight: null,
        sent: [],
        appliedAt: -Infinity,
        wake: null,
        idle: null,
      };
    round.idle = off(round.idle);
    const r = round;
    r.idle = timers.set(() => {
      r.idle = null;
      if (round === r && !r.flight) finish('ended');
    }, IDLE_MS);
    return round;
  }

  return {
    // Keys pressed in the typing box: [item] as shapeItem reads them. → 'sending' | 'gathered' |
    // 'not_typing' (no view, no right) | 'too_much' (more than one batch can hold is waiting: those
    // keys are not taken, and the box says so).
    press(peer, agent, items) {
      if (stopped || !Array.isArray(items) || !items.length) return 'not_typing';
      const shaped = items.map(shapeItem);
      if (shaped.some(it => !it)) return 'too_much';
      const r = roundFor(peer, agent);
      if (!r) return 'not_typing';

      // letters typed one after another join into one piece of text while it has room
      const next = (r.gathered || []).slice();
      for (const it of shaped) {
        const last = next[next.length - 1];
        if (
          typeof it !== 'string' &&
          last &&
          typeof last !== 'string' &&
          chars(last.x) + chars(it.x) <= TEXT_ITEM_MAX
        )
          next[next.length - 1] = { x: last.x + it.x };
        else next.push(it);
      }
      const text = next.reduce((sum, it) => sum + (typeof it === 'string' ? 0 : chars(it.x)), 0);
      if (next.length > ITEMS_MAX || text > TEXT_MAX) {
        said = 'too_much';
        saidAt = mono();
        changed();
        return 'too_much';
      }
      r.gathered = next;
      pump();
      changed();
      return round && round.flight ? 'sending' : 'gathered';
    },
    // A paste: text with "\r\n" and "\r" read as "\n". → as press, or 'too_long'.
    paste(peer, agent, text) {
      if (stopped || typeof text !== 'string') return 'not_typing';
      const t = text.replace(/\r\n?/g, '\n');
      if (!pasteOk(t)) return 'too_long';
      const r = roundFor(peer, agent);
      if (!r) return 'not_typing';
      if (r.paste !== null) return 'too_much';
      r.paste = t;
      pump();
      changed();
      return round && round.flight ? 'sending' : 'gathered';
    },
    // The other computer's word on the batch on its way; anything but 'done' ends the round and
    // what was gathered after it is not sent (it was typed against a screen that is not there).
    reply(peerId, obj) {
      const m = shapeTyped(obj),
        r = round;
      if (!m || !r || r.peer !== peerId || !r.flight || r.flight.n !== m.n) return false;
      r.flight.timer = off(r.flight.timer);
      r.flight = null;
      if (m.state !== 'done') {
        finish(m.state);
        return true;
      }
      r.appliedAt = mono();
      said = 'done';
      saidAt = r.appliedAt;
      pump();
      changed();
      return true;
    },
    // A new picture arrived: a held Enter may go now.
    frame() {
      if (round && !round.flight) pump();
    },
    // The box was left, the view ended, the right went: the round ends.
    end(why = 'ended') {
      finish(why === 'off' ? 'off' : 'ended');
    },
    status,
    quit() {
      stopped = true;
      finish('ended');
    },
  };
}

module.exports = {
  KEYS,
  KEY_NAMES,
  LINE_KEYS,
  STOP_KEYS,
  ITEMS_MAX,
  TEXT_ITEM_MAX,
  TEXT_MAX,
  PASTE_MAX,
  BATCHES_MIN,
  PASTES_MIN,
  TYPE_FRESH_MS,
  ECHO_MS,
  GAP_MS,
  REPLY_MS,
  CATCH_UP_MS,
  IDLE_MS,
  LINE_MS,
  shapeItem,
  shapeType,
  shapeTyped,
  kindOf,
  bytesFor,
  countOf,
  summary,
  createTyping,
  createTyper,
};
