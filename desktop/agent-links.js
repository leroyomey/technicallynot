/*
 * Technically Not desktop · agent-links.js — Who waits on whom, and who works together, among
 * agents that message each other. A WAIT is a fact from the `tnai` command: agent A asked B
 * something (`tnai ask`, or a `tnai send` holding a question and no "no reply needed") and B has
 * not answered. A LINK is inferred: two agents that sent each other messages within QUIET_MS.
 * Neither shares file locks or changes the user's teams (agent-teams.js), and both end by
 * themselves: a wait when B answers, when B finishes the task it read the question in (A is told
 * once), when B's panel closes (A is told), when the CLI's own record shows A's or B's conversation
 * was cleared (Claude Code only so far), or after WAIT_MS; a link when both agents have been at
 * rest for REST_MS, when one starts a new task from the user, when a panel closes, or after
 * QUIET_MS without a message. Panel ids only; in memory only: nothing is saved. One timeout for the
 * next expiry, no polling. Main process only. Check: node tools/desktop-check/links-check.js.
 */
'use strict';

const TIMES = {
  WAIT_MS: 30 * 60e3,
  QUIET_MS: 15 * 60e3,
  REST_MS: 60e3,
  NOTICE_GAP_MS: 10 * 60e3,
  ARM_MS: 15e3,
};
const waits = new Map(); // 'from>to' -> { from, to, at, delivered, armed }
const links = new Map(); // 'a|b' (sorted) -> { a, b, at, restAt }
const said = new Map(); // 'from>to' -> when from last messaged to

// 'waiter>target' -> when the waiter was last told that target finished without answering
const noticed = new Map();
const busy = new Set(); // panels whose task is running
const began = new Map(); // paneId -> when its running task started
const clearSeen = new Map(); // paneId -> the clearedAt last handled for it

// A CLI confirms a prompt by starting its task, so a delivery is often reported a moment AFTER the
// task that reads it began: that task counts.
const justBegan = paneId => busy.has(paneId) && now() - (began.get(paneId) || 0) < TIMES.ARM_MS;
let changed = () => {},
  notify = () => {},
  timer = null,
  now = () => Date.now();

const dir = (from, to) => from + '>' + to;
const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const expects = (ask, text) =>
  ask === true || (/\?/.test(text || '') && !/no reply (is )?needed/i.test(text || ''));
const waitBetween = (a, b) => waits.has(dir(a, b)) || waits.has(dir(b, a));

// Panels in a ring of waits that passes through `start` (A waits on B, B waits on A; or longer),
// without `start` itself. [] when there is none.
function ring(start) {
  const seen = new Set(),
    walk = (p, path) => {
      for (const w of waits.values()) {
        if (w.from !== p) continue;
        if (w.to === start) return path;
        if (seen.has(w.to)) continue;
        seen.add(w.to);
        const found = walk(w.to, [...path, w.to]);
        if (found) return found;
      }
      return null;
    };
  return walk(start, []) || [];
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  let next = Infinity;
  for (const w of waits.values()) next = Math.min(next, w.at + TIMES.WAIT_MS);
  for (const l of links.values())
    next = Math.min(next, l.at + TIMES.QUIET_MS, l.restAt ? l.restAt + TIMES.REST_MS : Infinity);
  if (next === Infinity) return;
  timer = setTimeout(expire, Math.max(10, next - now()));
  timer.unref?.();
}

function expire() {
  const t = now();
  let any = false;
  for (const [k, w] of waits)
    if (t - w.at >= TIMES.WAIT_MS) {
      waits.delete(k);
      any = true;
    }
  for (const [k, l] of links)
    if (
      t - l.at >= TIMES.QUIET_MS ||
      (l.restAt && t - l.restAt >= TIMES.REST_MS && !waitBetween(l.a, l.b))
    ) {
      links.delete(k);
      any = true;
    }
  for (const [k, at] of said) if (t - at >= TIMES.QUIET_MS) said.delete(k);
  for (const [k, at] of noticed) if (t - at >= TIMES.NOTICE_GAP_MS) noticed.delete(k);
  done(any);
}

function done(any) {
  schedule();
  if (any) {
    try {
      changed();
    } catch (e) {
      console.warn('[tnai] links change failed:', e?.message || e);
    }
  }
}

// A link rests once neither agent is working; the rest clock stops when one of them works again.
function rest(l) {
  l.restAt = busy.has(l.a) || busy.has(l.b) ? 0 : l.restAt || now();
}

function tell(waiter, kind, target, reason = '') {
  try {
    notify(waiter, kind, target, reason);
  } catch (e) {
    console.warn('[tnai] links notice failed:', e?.message || e);
  }
}

// A message from one agent to another was accepted (typed in, or queued: delivered false until
// `delivered`). Returns { ring: [paneIds] } when this message closes a ring of waits, so the
// sender's command can say so at once.
function sent(from, to, o = {}) {
  if (!from || !to || from === to) return { ring: [] };
  const t = now(),
    back = said.get(dir(to, from));
  said.set(dir(from, to), t);
  waits.delete(dir(to, from)); // an answer: the other one no longer waits on the sender
  if (back && t - back < TIMES.QUIET_MS) {
    const k = pair(from, to),
      l = links.get(k) || { a: from < to ? from : to, b: from < to ? to : from, restAt: 0 };
    l.at = t;
    rest(l);
    links.set(k, l);
  }
  let closes = [];
  if (expects(o.ask, o.text)) {
    waits.set(dir(from, to), {
      from,
      to,
      at: t,
      delivered: o.delivered !== false,
      armed: o.delivered !== false && justBegan(to),
    });
    closes = ring(from);
  }
  done(true);
  return { ring: closes };
}

// A queued message reached its agent (or was dropped: ok false ends the wait).
function delivered(from, to, ok = true) {
  const w = waits.get(dir(from, to));
  if (!w) return;
  if (ok) {
    w.delivered = true;
    if (justBegan(to)) w.armed = true;
    return;
  }
  waits.delete(dir(from, to));
  done(true);
}

// agent-turns.js `agent:turn` (sent many times per task): only a start or an end not seen yet does
// anything, and a clear not seen yet (`clearedAt`) is handled before the task it came with starts.
function turn(p) {
  if (!p?.paneId || !p.startedAt) return;
  if (p.clearedAt && clearSeen.get(p.paneId) !== p.clearedAt) {
    clearSeen.set(p.paneId, p.clearedAt);
    cleared(p.paneId);
  }
  if (!p.endedAt && !busy.has(p.paneId)) return started(p.paneId, p.task || '');
  if (p.endedAt && busy.has(p.paneId))
    return ended(p.paneId, p.endedBy === 'stop' ? '' : p.endedBy || '');
}

// What Technically Not and other agents type into a panel, after an optional "[TN.ai] ": agent and
// app messages ("[from …]"), the CLI's own hand-backs, agent-graph.js tasks, follow-ups and reports
// for sub-agents, the app's renderer notices (context upkeep 54: its compact and hand-off requests
// and the successor's "[TN.ai handoff: …]"; session skills 101; the automatic next step of 51,
// "[TN.ai auto-continue …]"; the usage-limit resume of 72) and slash commands.
const NOT_USER =
  /^(\[from\b|\[TN\.ai (handoff|auto-continue)\b|<task-notification>|<agent-message\b|\[Subagent hand-back\]|Sub-agent\b|(Task|New task|Follow-up|Revived for a related task) from |You are "[^"\n]*", a sub-agent that |Your context is at |You asked for \/|Technically Not hands your work |Your usage limit has reset\.|The user (attached|took) |\/)/i;

function started(paneId, task) {
  busy.add(paneId);
  began.set(paneId, now());
  let any = false;

  // The task this agent reads a delivered question in: when it ends without an answer, the one
  // waiting is told.
  for (const w of waits.values()) if (w.to === paneId && w.delivered) w.armed = true;

  // A new task from the user (a composer prompt, or one typed straight into the terminal) ends this
  // agent's links, unless a wait is open on one. An empty task is not known to be the user's, and
  // nothing in NOT_USER is.
  const words = String(task || '')
    .replace(/^\s*\[(TN\.ai|TechnicallyNot\.ai)\]\s*/, '')
    .trim();
  const own = !!words && !NOT_USER.test(words);
  for (const [k, l] of links) {
    if (l.a !== paneId && l.b !== paneId) continue;
    if (own && !waitBetween(l.a, l.b)) {
      links.delete(k);
      any = true;
    } else l.restAt = 0;
  }
  done(any);
}

function ended(paneId, reason = '') {
  // reason: agent-turns.js endedBy when the task did not finish normally ('interrupted', 'aborted',
  // 'error', 'exit')
  busy.delete(paneId);
  let any = false;
  const t = now();
  for (const [k, w] of waits) {
    if (w.to !== paneId || !w.armed) continue;
    waits.delete(k);
    any = true;
    const n = dir(w.from, paneId),
      last = noticed.get(n);
    if (!last || t - last >= TIMES.NOTICE_GAP_MS) {
      noticed.set(n, t);
      tell(w.from, 'ended', paneId, reason);
    } // at most one per pair per NOTICE_GAP_MS: two agents cannot wake each other in a loop
  }
  for (const l of links.values()) if (l.a === paneId || l.b === paneId) rest(l);
  done(any);
}

// The panel's conversation was cleared (agent-turns.js `clearedAt`, read from the CLI's own
// record): the agent no longer knows what it asked or what it was asked. Its own questions stop
// waiting (nobody to tell), a question to it that was already typed in ends and its asker is told
// once, and its links end. A question Technically Not still holds for it stays: it arrives in the
// new conversation.
function cleared(paneId) {
  let any = false;
  for (const [k, w] of waits) {
    if (w.from === paneId) {
      waits.delete(k);
      any = true;
    } else if (w.to === paneId && w.delivered) {
      waits.delete(k);
      any = true;
      noticed.set(dir(w.from, paneId), now());
      tell(w.from, 'ended', paneId, 'cleared');
    }
  }
  for (const [k, l] of links)
    if (l.a === paneId || l.b === paneId) {
      links.delete(k);
      any = true;
    }
  done(any);
}

// The panel closed or its process ended: nothing waits on it any more, and whoever did is told.
function gone(paneId) {
  let any = busy.delete(paneId);
  began.delete(paneId);
  clearSeen.delete(paneId);
  for (const [k, w] of waits) {
    if (w.from !== paneId && w.to !== paneId) continue;
    waits.delete(k);
    any = true;
    if (w.to === paneId) tell(w.from, 'gone', paneId);
  }
  for (const [k, l] of links)
    if (l.a === paneId || l.b === paneId) {
      links.delete(k);
      any = true;
    }
  for (const m of [said, noticed])
    for (const k of [...m.keys()])
      if (k.startsWith(paneId + '>') || k.endsWith('>' + paneId)) m.delete(k);
  done(any);
}

// An agent handed its whole job to another (`tnai close --self --successor`): its waits and links
// go to the successor, as its messages do, and nobody is told that an answer is lost when the old
// panel closes a moment later. Whatever would pair the successor with itself is dropped.
function moved(from, to) {
  if (!from || !to || from === to) return;
  const swap = p => (p === from ? to : p);
  let any = false;
  for (const [k, w] of [...waits]) {
    if (w.from !== from && w.to !== from) continue;
    waits.delete(k);
    any = true;
    const f = swap(w.from),
      t = swap(w.to);
    if (f !== t && !waits.has(dir(f, t)))
      // the successor reads the question in a task of its own
      waits.set(dir(f, t), { ...w, from: f, to: t, armed: false });
  }
  for (const [k, l] of [...links]) {
    if (l.a !== from && l.b !== from) continue;
    links.delete(k);
    any = true;
    const a = swap(l.a),
      b = swap(l.b);
    if (a !== b && !links.has(pair(a, b))) {
      const n = { ...l, a: a < b ? a : b, b: a < b ? b : a };
      rest(n);
      links.set(pair(a, b), n);
    }
  }
  for (const [k, at] of [...said]) {
    const [f, t] = k.split('>');
    if (f !== from && t !== from) continue;
    said.delete(k);
    if (swap(f) !== swap(t))
      said.set(dir(swap(f), swap(t)), Math.max(at, said.get(dir(swap(f), swap(t))) || 0));
  }
  done(any);
}

// One panel as the UI and `tnai agents` show it: who it waits on, who it works with (inferred), and
// whether its waits form a ring.
function of(paneId) {
  const waitsOn = [],
    withThem = [];
  for (const w of waits.values()) if (w.from === paneId) waitsOn.push(w.to);
  for (const l of links.values())
    if (l.a === paneId || l.b === paneId) withThem.push(l.a === paneId ? l.b : l.a);
  return {
    waitsOn,
    with: withThem.filter(p => !waitsOn.includes(p)),
    ring: waitsOn.length > 0 && ring(paneId).length > 0,
  };
}

module.exports = {
  // changed(): something the UI shows changed. notify(waiterPane, 'ended' | 'gone', targetPane,
  // reason): tell the waiting agent once (reason: '' for a normal finish, else how the task ended).
  init(o = {}) {
    if (typeof o.changed === 'function') changed = o.changed;
    if (typeof o.notify === 'function') notify = o.notify;
  },
  sent,
  delivered,
  turn,
  gone,
  forget: gone,
  moved,
  of,
  // Whether `waiter` has an unanswered question to `target` (file-locks.js: a waiting holder is
  // told its file blocks the one it waits on).
  waiting: (waiter, target) => waits.has(dir(waiter, target)),
  state() {
    return {
      waits: [...waits.values()].map(w => ({ from: w.from, to: w.to, at: w.at })),
      links: [...links.values()].map(l => ({ a: l.a, b: l.b })),
    };
  },
  _test: {
    TIMES,
    clock(fn) {
      now = fn || (() => Date.now());
    },
    expire,
    reset() {
      clearTimeout(timer);
      timer = null;
      for (const m of [waits, links, said, noticed]) m.clear();
      busy.clear();
      began.clear();
      clearSeen.clear();
      now = () => Date.now();
    },
  },
};
