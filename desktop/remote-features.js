// Technically Not · remote-features.js — three read-only things one paired computer may ask of
// another for this week's thread features (plan item 45, docs/plans/multi-computer.md list J):
//
// - 'changes': the branch facts of one of its agents' folders, for that thread's Changes section
//   (what desktop/branch-changes.js answers here for 153, without the folder's path or any link).
// - 'skills': the skills that agent's CLI reads there, for the "$" list above the prompt box (160).
//   Its "/" commands are never asked: a prompt for another computer must start with a word
//   (remote-control.js change 1), so a command could not be sent anyway.
// - 'clis': which agent CLIs are installed and signed in there, and their plan usage gauges
//   (Settings › Accounts' numbers), without any account name or e-mail.
//
// Two messages and nothing else:
// - { t: 'fask', n, k, id? }: the asking computer wants kind `k` (of the agent row `id` for
//   'changes' and 'skills').
// - { t: 'feat', n, k, w, v? }: the answer to the ask `n`. w is one fixed word: 'ok' (v holds the
//   shaped value), 'busy' (another read runs here now: ask again later) or 'none' (nothing to show,
//   or not allowed). An ask past the limit, or from a computer that may not see details, gets no
//   answer at all.
//
// Rules (the lessons of docs/plans/remote-protocol.md and the skill's lessons.md):
// - Nothing here is a control operation and nothing changes on the answering computer. It answers
//   only while `may(peerId)` holds (the computer's "show details" switch, its pairing open, its
//   session live), asked again just before the answer leaves.
// - The answering computer sets the rate: every ask is counted before anything is read (6 a
//   minute per computer), one read runs at a time for all computers, and an answer is kept for a
//   short time and served again from memory.
// - Every value is shaped field by field on the sender and again on the receiver (`shape` below):
//   fixed words, whole numbers in a range, short clean lines. A list too long for one sealed
//   message is cut and says how many were left out.
// - The asking side reads an answer only for an ask it made, from the computer it asked, and holds
//   what it got in memory only, bounded.
//
// Pure Node: sending, the clock, the timers, the rights and the reads are handed in by
// desktop/remote-service.js. Test: `node tools/remote-features-test.js`.
'use strict';
const crypto = require('crypto');
const { MAX_PLAIN } = require('./remote-noise.js');
const { clean: line } = require('./remote-keys.js');

const KINDS = ['changes', 'skills', 'clis'];
const WORDS = ['ok', 'busy', 'none'];

// The CLIs whose names may cross, as the app names them (cli-commands.js and agent-graph.js).
const CLIS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent', 'GitHub Copilot'];

// How a CLI is told to use a skill (cli-commands.js `skillSign`): "$name" for Codex, "/name" else.
const signOf = cli => (cli === 'Codex' ? '$' : '/');

// How often the asking computer may ask, and how long an answer is kept on each side.
const MINUTE = 60 * 1000;
const ASKS_MIN = 6;
const ASK_GAP_MS = 5000;
const KEEP_MS = { changes: 10 * 1000, skills: 60 * 1000, clis: 60 * 1000 };
const READ_MS = 20 * 1000;
const REPLY_MS = 25 * 1000;

// One-time numbers the answering computer remembers per computer, and what the asker holds.
const SEEN_NS = 64;
const SEEN_MS = 10 * MINUTE;
const HELD_MAX = 60;

// The longest skills list that crosses, before it is cut to fit one sealed message.
const SKILLS_MAX = 150;

// ---------------------------------------------------------------- shaping (both sides)

const hex16 = value => (typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : '');

// A row id names one panel: a clean single line that cleaning leaves unchanged.
const rowId = value =>
  typeof value === 'string' && value !== '' && line(value, 80) === value ? value : '';

const count = (value, max = 1e7) =>
  Number.isInteger(value) && value >= 0 && value <= max ? value : 0;

const text = (value, max) => (typeof value === 'string' ? line(value, max) : '');

const oneOf = (value, list, fallback = '') => (list.includes(value) ? value : fallback);

const time = value => (Number.isFinite(value) && value > 0 && value < 1e14 ? Math.floor(value) : 0);

// The branch facts, as 153 draws them. The folder's path, the pull request's address and every
// other field are left out.
function shapeChanges(c) {
  if (!c || typeof c !== 'object') return null;
  if (c.repo !== true) return { repo: false };
  const out = {
    repo: true,
    branch: text(c.branch, 120),
    detached: c.detached === true,
    base: text(c.base, 120),
    onBase: c.onBase === true,
    since: text(c.since, 120),
    uncommitted: count(c.uncommitted),
    unpushed: count(c.unpushed),
    ahead: count(c.ahead),
    behind: count(c.behind),
    added: count(c.added),
    removed: count(c.removed),
    files: count(c.files),
    gh: oneOf(c.gh, ['ok', 'none', 'missing', 'signed-out', 'unavailable']),
    pr: null,
  };
  const pr = c.pr;
  if (pr && typeof pr === 'object') {
    const checks = pr.checks && typeof pr.checks === 'object' ? pr.checks : {};
    out.pr = {
      number: count(pr.number),
      title: text(pr.title, 200),
      state: oneOf(String(pr.state || '').toUpperCase(), ['OPEN', 'CLOSED', 'MERGED']),
      draft: pr.draft === true,
      checks: {
        total: count(checks.total, 10000),
        passed: count(checks.passed, 10000),
        failed: count(checks.failed, 10000),
        pending: count(checks.pending, 10000),
      },
    };
  }
  return out;
}

// One skill: its name, the words that use it (the CLI's sign and the name, nothing else), a line
// about it, and whether the project or the user wrote it.
function shapeSkill(s, sign) {
  if (!s || typeof s !== 'object') return null;
  const name = text(s.name, 64);
  if (!name || /\s/.test(name)) return null;
  return {
    name,
    insert: sign + name,
    about: text(s.about, 140),
    from: oneOf(s.from, ['project', 'user'], 'user'),
  };
}

// The skills of one CLI, cut to fit one sealed message; `more` says how many did not fit.
function shapeSkills(a) {
  if (!a || typeof a !== 'object') return null;
  const cli = oneOf(a.cli, CLIS);
  if (!cli) return null;
  const sign = signOf(cli);
  const all = (Array.isArray(a.skills) ? a.skills : [])
    .map(s => shapeSkill(s, sign))
    .filter(Boolean);
  const skills = all.slice(0, SKILLS_MAX);
  let more = count(a.more, 100000) + (all.length - skills.length);
  const out = { cli, sign, skills, more };

  // Room for the answer's own fields (t, n, k, w) around the value.
  while (skills.length && Buffer.byteLength(JSON.stringify(out)) > MAX_PLAIN - 200) {
    skills.pop();
    more++;
  }
  out.more = more;
  return out;
}

// One usage gauge: the window's length, which model it counts (Claude's weekly ones), how full it
// is and when it starts over.
function shapeGauge(g) {
  if (!g || typeof g !== 'object') return null;
  const minutes = count(g.minutes, 100000);
  if (!minutes) return null;
  const used = Number.isFinite(g.used) ? Math.max(0, Math.min(100, Math.round(g.used))) : 0;
  return {
    minutes,
    model: oneOf(g.model, ['Opus', 'Sonnet']),
    used,
    resetsAt: time(g.resetsAt),
  };
}

// The CLIs: one row per known CLI at most, signed in as true, false or not known (null).
// The answering side shapes the list it read; the asking side shapes the { clis } that came.
function shapeClis(value) {
  const list = Array.isArray(value)
    ? value
    : value && Array.isArray(value.clis)
      ? value.clis
      : null;
  if (!list) return null;
  const seen = new Set();
  const rows = [];
  for (const c of list.slice(0, 10)) {
    if (!c || typeof c !== 'object') continue;
    const cli = oneOf(c.cli, CLIS);
    if (!cli || seen.has(cli)) continue;
    seen.add(cli);
    rows.push({
      cli,
      installed: c.installed === true,
      signedIn: c.signedIn === true ? true : c.signedIn === false ? false : null,
      plan: text(c.plan, 40),
      gauges: (Array.isArray(c.gauges) ? c.gauges : []).slice(0, 4).map(shapeGauge).filter(Boolean),
    });
  }
  return { clis: rows };
}

const SHAPES = { changes: shapeChanges, skills: shapeSkills, clis: shapeClis };

// The answering computer's CLIs from what it already knows: the window's last check of them
// (agent-registry.js detectAll: { id, installed, loggedIn }) and the plan limits
// (plan-limits.js forAccounts: { accounts: [{ agentId, status, plan, windows }], codexFile }).
// Claude Code's gauges are its first account that has a reading.
function clisFrom(detected, limits) {
  const found = Array.isArray(detected) ? detected : [];
  const accounts = Array.isArray(limits?.accounts) ? limits.accounts : [];
  const claude =
    accounts.find(a => a && a.agentId === 'Claude Code' && a.status === 'ok') ||
    accounts.find(a => a && a.agentId === 'Claude Code') ||
    null;
  const codex = limits?.codexFile || null;
  const reading = { 'Claude Code': claude, Codex: codex };
  const rows = [];
  for (const cli of CLIS) {
    const d = found.find(x => x && x.id === cli);
    if (!d) continue;
    const r = reading[cli];
    const ok = r && r.status === 'ok';
    let signedIn = d.loggedIn === true ? true : d.loggedIn === false ? false : null;

    // Claude Code's own file says it is signed out even where its status command was not read
    if (cli === 'Claude Code' && r && r.status === 'signedout') signedIn = false;
    rows.push({
      cli,
      installed: d.installed === true,
      signedIn,
      plan: ok ? r.plan || '' : '',
      gauges: ok && Array.isArray(r.windows) ? r.windows : [],
    });
  }
  return rows;
}

// ---------------------------------------------------------------- the answering computer

// may(peerId) → may that computer see details now. row(peerId, panelId) → { cli, who } for an agent
// row this computer lists to it in the project open here, else null. read: { changes(panelId),
// skills(panelId, cli), clis() } → a value or a promise of one. send(to, obj). onRead(peerId, kind)
// → optional, after each answer that carried a value.
function createFeatureAnswerer({ now, timers, may, row, read, send, onRead = () => {} }) {
  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  // peerId → { asks: [times], seen: Map(n → time) }
  const peers = new Map();

  // `${kind}\n${id}` → { at, value }: answers kept for a short time, for every computer
  const kept = new Map();
  let reading = false;
  let stopped = false;

  const peerOf = id => {
    let p = peers.get(id);
    if (!p) {
      p = { asks: [], seen: new Map() };
      peers.set(id, p);
    }
    return p;
  };

  const reply = (to, n, k, w, v) => {
    if (stopped || !safe(() => may(to) === true, false)) return;
    const obj = v === undefined ? { t: 'feat', n, k, w } : { t: 'feat', n, k, w, v };
    safe(() => send(to, obj));
  };

  // A read with its own time limit: a read that never ends frees the one place after READ_MS.
  function timed(promise) {
    return new Promise(resolve => {
      let done = false;
      const handle = timers.set(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, READ_MS);
      Promise.resolve(promise).then(
        value => {
          if (done) return;
          done = true;
          timers.clear(handle);
          resolve(value);
        },
        () => {
          if (done) return;
          done = true;
          timers.clear(handle);
          resolve(null);
        }
      );
    });
  }

  function receive(from, obj) {
    if (stopped || !obj || obj.t !== 'fask') return false;
    if (!safe(() => may(from) === true, false)) return false;

    // Counted first, before anything of the message is looked at.
    const t = now();
    const p = peerOf(from);
    p.asks = p.asks.filter(at => t - at < MINUTE);
    if (p.asks.length >= ASKS_MIN) return false;
    p.asks.push(t);

    const n = hex16(obj.n);
    const k = oneOf(obj.k, KINDS);
    if (!n || !k) return false;
    for (const [seenN, at] of p.seen) if (t - at > SEEN_MS) p.seen.delete(seenN);
    if (p.seen.has(n)) return false;
    p.seen.set(n, t);
    while (p.seen.size > SEEN_NS) p.seen.delete(p.seen.keys().next().value);

    // Which agent: one this computer lists to that computer, in the project open here.
    const id = k === 'clis' ? '' : rowId(obj.id);
    let agent = null;
    if (k !== 'clis') {
      agent = id ? safe(() => row(from, id), null) : null;
      if (!agent) {
        reply(from, n, k, 'none');
        return true;
      }
    }

    // Review 23, L2: kept per agent, not per panel, so another agent in the same panel id never
    // gets the old one's answer (`who` is that agent's identity from row()).
    const who = agent ? String(agent.who || '') : '';
    const key = k + '\n' + id + '\n' + who;
    const hit = kept.get(key);
    if (hit && t - hit.at < KEEP_MS[k]) {
      reply(from, n, k, hit.value ? 'ok' : 'none', hit.value || undefined);
      if (hit.value) safe(() => onRead(from, k));
      return true;
    }
    if (reading) {
      reply(from, n, k, 'busy');
      return true;
    }
    reading = true;
    const job =
      k === 'changes'
        ? safe(() => read.changes(id), null)
        : k === 'skills'
          ? safe(() => read.skills(id, agent.cli), null)
          : safe(() => read.clis(), null);
    timed(job).then(raw => {
      reading = false;

      // Review 23, L2: a read can take up to READ_MS; the project here or the agent in that panel
      // may have changed meanwhile, so the row is asked again before the answer leaves.
      if (k !== 'clis') {
        const again = safe(() => row(from, id), null);
        if (!again || String(again.who || '') !== who) {
          reply(from, n, k, 'none');
          return;
        }
      }
      const value = safe(() => SHAPES[k](raw), null);
      kept.set(key, { at: now(), value });
      while (kept.size > HELD_MAX) kept.delete(kept.keys().next().value);
      reply(from, n, k, value ? 'ok' : 'none', value || undefined);
      if (value) safe(() => onRead(from, k));
    });
    return true;
  }

  return {
    receive,
    // that computer's session ended or its switch went off: nothing of it is remembered but its
    // count, which still holds for the minute
    endFor(id) {
      const p = peers.get(id);
      if (p) p.seen.clear();
    },
    stop() {
      stopped = true;
      peers.clear();
      kept.clear();
    },
  };
}

// ---------------------------------------------------------------- the asking computer

// may(peerId) → may this computer ask that one now (a live session, the pairing open). send(to,
// obj) → true when it left. on.changed() after every answer or time-out.
function createFeatureReader({ now, timers, may, send, random = crypto.randomBytes, on = {} }) {
  // `${peer}\n${kind}\n${id}` → { state, at, value, n, askedAt, timer }
  const held = new Map();
  const changed = () => {
    try {
      on.changed?.();
    } catch {
      /* a listener's error is not ours */
    }
  };
  const keyOf = (peer, kind, id) => peer + '\n' + kind + '\n' + id;

  // → { state }: 'asked', 'wait' (asked a moment ago, or an answer is on its way) or 'not_sent'.
  function ask(peer, kind, id) {
    const k = oneOf(kind, KINDS);
    const rid = k === 'clis' ? '' : rowId(id);
    if (!k || (k !== 'clis' && !rid)) return { state: 'not_sent' };
    let mayAsk = false;
    try {
      mayAsk = may(peer) === true;
    } catch {
      mayAsk = false;
    }
    if (!mayAsk) return { state: 'not_sent' };
    const key = keyOf(peer, k, rid);
    const h = held.get(key);
    const t = now();
    if (h && (h.n || t - h.askedAt < ASK_GAP_MS)) return { state: 'wait' };
    const n = random(8).toString('hex');
    let sent = false;
    try {
      sent = send(peer, rid ? { t: 'fask', n, k, id: rid } : { t: 'fask', n, k }) !== false;
    } catch {
      sent = false;
    }
    if (!sent) return { state: 'not_sent' };
    const entry = h || { state: 'asking', at: 0, value: null };
    entry.n = n;
    entry.askedAt = t;
    if (!entry.value) entry.state = 'asking';

    // every wait has its own timer: no answer in time says so
    entry.timer = timers.set(() => {
      if (entry.n !== n) return;
      entry.n = '';
      if (!entry.value) entry.state = 'no_reply';
      changed();
    }, REPLY_MS);
    held.set(key, entry);
    while (held.size > HELD_MAX) {
      const first = held.keys().next().value;
      timers.clear(held.get(first).timer);
      held.delete(first);
    }
    return { state: 'asked' };
  }

  function receive(from, obj) {
    if (!obj || obj.t !== 'feat') return false;
    const n = hex16(obj.n);
    const k = oneOf(obj.k, KINDS);
    if (!n || !k) return false;
    for (const [key, entry] of held) {
      if (entry.n !== n) continue;

      // only the computer that was asked, for the kind that was asked
      if (!key.startsWith(from + '\n' + k + '\n')) return false;
      timers.clear(entry.timer);
      entry.n = '';
      const w = oneOf(obj.w, WORDS, 'none');
      if (w === 'ok') {
        const value = SHAPES[k](obj.v);
        if (value) {
          entry.value = value;
          entry.at = now();
          entry.state = 'ok';
        } else entry.state = entry.value ? 'ok' : 'none';
      } else if (!entry.value) entry.state = w;
      changed();
      return true;
    }
    return false;
  }

  return {
    ask,
    receive,
    // → { state, at, value } or null. state: 'asking', 'ok', 'busy', 'none', 'no_reply'.
    get(peer, kind, id) {
      const k = oneOf(kind, KINDS);
      if (!k) return null;
      const h = held.get(keyOf(peer, k, k === 'clis' ? '' : rowId(id)));
      return h ? { state: h.state, at: h.at, value: h.value } : null;
    },
    // that computer's session ended or it may no longer be read: everything of it goes
    drop(peer) {
      for (const [key, entry] of held)
        if (key.startsWith(peer + '\n')) {
          timers.clear(entry.timer);
          held.delete(key);
        }
      changed();
    },
    stop() {
      for (const entry of held.values()) timers.clear(entry.timer);
      held.clear();
    },
  };
}

module.exports = {
  createFeatureAnswerer,
  createFeatureReader,
  shapeChanges,
  shapeSkills,
  shapeClis,
  clisFrom,
  KINDS,
  ASKS_MIN,
  KEEP_MS,
  READ_MS,
  REPLY_MS,
};
