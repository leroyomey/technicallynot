/*
 * Technically Not desktop · agent-lifecycle.js — Every agent session's lifecycle and every task's
 * provenance, for all CLIs (not only custom agents; their sub-agents also go through
 * agent-graph.js). Identity is never the display name. An INSTANCE is one conversation of one agent
 * (unique id; its context id is the CLI's own session id; the pane it runs in can change). A TASK
 * is one job given to an instance (unique id). Its OWNER is the instance whose work it came from:
 * when a prompt quotes an agent's earlier result, that agent owns the task, whoever runs it. Names
 * are labels: several instances may share one; a new instance never inherits an old one's
 * conversation. States: ACTIVE (working on a task) → REUSABLE (task complete, pane open, keeps its
 * context) → HIDDEN (pane closed, conversation saved on disk, no process) → CLEARED (forgotten:
 * context id and task results dropped, nothing can leak into a later agent that gets the same
 * name). STOPPED = process ended, pane still open. A task that quotes an earlier result goes back
 * to the instance that wrote it: reused if its pane is open, revived (its conversation resumed in a
 * new pane) if it was closed, otherwise a fresh agent with no old context takes it. An instance
 * Technically Not revived for a task closes again (HIDDEN) after finishing it, unless the user
 * starts working with it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const sessionStore = require('./session-store'); // writeAtomic only
const stalls = require('./stall-log');

const REVIVE_DAYS = 7; // a hidden conversation older than this is cleared

// finished tasks remembered (their results are what later prompts are matched against)
const KEEP_TASKS = 80;
const RESULT_KEEP = 12000,
  TASK_KEEP = 2000;
const NOTE_MS = 60000; // how long Technically Not's routing note waits for the prompt it announced
const PROMPT_MS = 15000; // a turn start this soon after a prompt hook belongs to that prompt
const CLOSE_MS = 90000; // a revived instance closes this long after finishing its task
const REVIVE_MS = 90000; // the window has this long to reopen a conversation
const K = 6,
  MIN_COMMON = 6; // results are compared as 6-word runs; at least 6 must match
const TEXT_SHARE = 0.35,
  RESULT_SHARE = 0.5;

// id -> { id, name, agent, contextId, project, cwd, accountId, customAgentId, ownedByUser,
// subagent, paneId, state, createdAt, lastActiveAt, closedAt, revived }
const instances = new Map();
const byPane = new Map(); // paneId -> instance id

// id -> { id, instanceId, ownerId, originId, originTaskId, text, result, startedAt, endedAt,
// source, turnKey }
const tasks = new Map();
const prints = new Map(); // task id -> Set of result fingerprints

// paneId -> { at, originId, originTaskId, source } Technically Not's own routing of the next prompt
const notes = new Map();
const prompts = new Map(); // paneId -> { at, text, note } the last prompt hook (full text)
const reviving = new Map(); // request id -> resolve

// instance id -> the promise of its revive still under way: a second `tnai send` to the same closed
// agent joins it instead of opening a second panel on the same conversation
const revivesUnderWay = new Map();

// request ids of `tnai new` spawns: their pane is marked startedByAgent even when the answer comes
// late or not ready
const spawning = new Set();
const closers = new Map(); // instance id -> timer

// Starts asked by a paired computer (remote-actions.js).
// request id -> { agent, paneId }: asked of the window and not answered yet; the id is the mark
// its `pty:start` must carry
const remoteAsks = new Map();

// paneId -> when: panels started that way which this computer's user has not closed (stopped ones
// stay); saved, so the count survives a restart
const remotePanes = new Map();

// conversation id -> its CLI: every conversation that ran in such a panel. Kept apart from the
// instances and saved: an instance is cleared REVIVE_DAYS after its panel closed, the CLI keeps the
// conversation's file much longer, and the list of past conversations (thread-list.js) can resume
// it then, so the mark has to be there still (`remoteResumed`). The newest REMOTE_CONVS are kept.
const remoteConvs = new Map(),
  REMOTE_CONVS = 2000;

function markRemote(n) {
  n.remote = true;
  if (!n.contextId || remoteConvs.get(n.contextId) === n.agent) return;
  remoteConvs.set(n.contextId, n.agent);
  while (remoteConvs.size > REMOTE_CONVS) remoteConvs.delete(remoteConvs.keys().next().value);
}
const remoteConversation = (agent, contextId) =>
  !!contextId &&
  (remoteConvs.get(contextId) === agent ||
    [...instances.values()].some(
      n => n.remote === true && n.agent === agent && n.contextId === contextId
    ));

// [computer id, when] of every start taken from a paired computer in the last 24 hours; saved, so
// the limit of a day survives a restart
let remoteStarts = [];
const DAY_MS = 24 * 60 * 60 * 1000;
let send = () => {},
  canResume = () => false,
  root = () => '';

const file = () => path.join(app.getPath('userData'), 'agent-lifecycle.json');

// The marks of remotely started panels and conversations have a second home of their own, written
// with every save once one exists, so losing agent-lifecycle.json does not lose them (and with
// them the "Ask first" hold of a resume). It is written from the first mark on, so no such file
// means no conversation here was ever started from another computer.
const marksFile = () => path.join(app.getPath('userData'), 'remote-marks.json');

// A third, tiny sign that marks were ever kept here, written once and never rewritten (not JSON, so
// a tool that clears settings files does not take it with the other two). With it, or with
// `marksUsed` in agent-lifecycle.json, a missing marks file is a lost one, not "never used".
const seenFile = () => path.join(app.getPath('userData'), 'remote-marks.seen');
let seenWritten = false;

// True while that second read waits: the marks file is not written meanwhile, so marks it may still
// hold are never overwritten before they were read.
let marksPending = false;

// A marks file that is there but cannot be read for a moment (another program holds it) is read
// once more this long after the start; only a second failure is saved as lost.
const MARKS_RETRY_MS = 2000;

// When the marks file was there and could not be read (0: it was read, or never existed). For
// LOST_MS after that, a resume of a conversation the lifecycle cannot place is refused
// (remote-actions.js startOptions), so a conversation started from another computer is never
// resumed without its "Ask first" hold. Saved in the marks file, so a restart does not end it.
let marksLost = 0;
const LOST_MS = 30 * 24 * 60 * 60 * 1000;
const clip = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const norm = p => (p ? path.resolve(p).toLowerCase() : '');
const short = id => String(id || '').slice(0, 8);

// ---------- Fingerprints: which earlier result a prompt quotes ----------
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fingerprint(text, max = 6000) {
  const w =
    String(text || '')
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}'’._/-]*/gu) || [];
  const out = new Set();
  for (let i = 0; i + K <= w.length && out.size < max; i++)
    out.add(hash(w.slice(i, i + K).join(' ')));
  return out;
}

// Does `text` quote `source` (a real part of it, not a few shared words)?
function share(T, R) {
  if (T.size < MIN_COMMON || R.size < MIN_COMMON) return 0;
  let common = 0;
  for (const h of T) if (R.has(h)) common++;
  return common >= MIN_COMMON && (common / T.size >= TEXT_SHARE || common / R.size >= RESULT_SHARE)
    ? common
    : 0;
}
const quotes = (text, source) => share(fingerprint(text), fingerprint(source)) > 0;

// A result's own words only: runs it repeats from its task are dropped, so an agent echoing its
// prompt doesn't "own" that prompt the next time it is sent.
function resultPrints(t) {
  const R = fingerprint(t.result);
  if (t.text) for (const h of fingerprint(t.text)) R.delete(h);
  return R;
}

// ---------- Persistence: instances (live ones come back as hidden, a restarted pane re-attaches by
// its context id) and recent tasks ----------
let saveTimer = null,
  lastWrite = 0,
  marksSeen = false;

// never write sooner than this after the previous write, even under constant change
const MIN_GAP_MS = 2000;

// Debounced saves write asynchronously (the file is a few hundred KB; a sync write stalled the main
// process while agents were busy); quitting writes sync.
function write(sync) {
  saveTimer = null;
  lastWrite = Date.now();
  const t0 = performance.now();
  const keep = [...instances.values()]
    .filter(n => n.state !== 'cleared')
    .map(n => ({ ...n, paneId: '', revived: false }));
  const marks = {
    ...(remotePanes.size ? { remote: Object.fromEntries(remotePanes) } : null),
    ...(remoteConvs.size ? { remoteConvs: [...remoteConvs] } : null),
    ...(remoteStarts.length ? { remoteStarts } : null),
    ...(marksLost ? { lost: marksLost } : null),
  };
  try {
    // Once it is there, the marks file is kept up to date, also when it holds nothing.
    if (!marksPending && (Object.keys(marks).length || marksSeen)) {
      marksSeen = true;
      const marksText = JSON.stringify(marks);
      if (sync) sessionStore.writeAtomic(marksFile(), marksText);
      else sessionStore.writeAtomicLater(marksFile(), marksText);
    }
  } catch {}
  try {
    if (marksSeen && !seenWritten) {
      if (!fs.existsSync(seenFile())) fs.writeFileSync(seenFile(), new Date().toISOString());
      seenWritten = true;
    }
  } catch {}
  try {
    const text = JSON.stringify(
      {
        instances: keep,
        tasks: [...tasks.values()],
        ...(remotePanes.size ? { remote: Object.fromEntries(remotePanes) } : null),
        ...(remoteConvs.size ? { remoteConvs: [...remoteConvs] } : null),
        ...(remoteStarts.length ? { remoteStarts } : null),
        ...(marksSeen ? { marksUsed: true } : null),
      },
      null,
      1
    );
    if (sync) sessionStore.writeAtomic(file(), text);
    else sessionStore.writeAtomicLater(file(), text);
  } catch {}
  stalls.ran('lifecycle save', performance.now() - t0); // a stall line can name it
}

// Fires after 400ms of quiet; if the last write was under MIN_GAP_MS ago, waits out the remainder
// instead of writing early.
function attempt() {
  const wait = MIN_GAP_MS - (Date.now() - lastWrite);
  if (wait > 0) {
    saveTimer = setTimeout(attempt, wait);
    saveTimer.unref?.();
    return;
  }
  write(false);
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(attempt, 400);
  saveTimer.unref?.();
}

// Technically Not is quitting: a save still waiting on its timer is written now.
function flushSaves() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    write(true);
  }
}

const fileThere = p => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

// The marks file → { marks, problem }. problem: '' read, 'missing' no file, 'busy' a read error
// that may pass, 'broken' there but not marks.
function readMarks() {
  let raw;
  try {
    raw = fs.readFileSync(marksFile(), 'utf8');
  } catch (error) {
    return { marks: {}, problem: error.code === 'ENOENT' ? 'missing' : 'busy' };
  }
  try {
    const marks = JSON.parse(raw);
    if (!marks || typeof marks !== 'object' || Array.isArray(marks)) throw new Error('not marks');
    marksSeen = true;
    const lostAgo = Date.now() - marks.lost;
    if (Number.isFinite(marks.lost) && lostAgo >= 0 && lostAgo < LOST_MS) marksLost = marks.lost;
    return { marks, problem: '' };
  } catch {
    return { marks: {}, problem: 'broken' };
  }
}

// Adds the marks and the day's starts of each record (agent-lifecycle.json, the marks file) to
// those already held; the same start may be in both.
function takeMarks(records) {
  for (const from of records) {
    if (from.remote && typeof from.remote === 'object' && !Array.isArray(from.remote))
      for (const id of Object.keys(from.remote).slice(0, 50))
        remotePanes.set(id, Number(from.remote[id]) || 0);
    if (Array.isArray(from.remoteConvs))
      for (const e of from.remoteConvs.slice(-REMOTE_CONVS))
        if (Array.isArray(e) && typeof e[0] === 'string' && e[0] && typeof e[1] === 'string')
          remoteConvs.set(e[0], e[1]);
  }
  const starts = [remoteStarts];
  for (const from of records) if (Array.isArray(from.remoteStarts)) starts.push(from.remoteStarts);
  const startKeys = new Set();
  remoteStarts = starts
    .flat()
    .filter(e => {
      const key = JSON.stringify(e);
      if (startKeys.has(key)) return false;
      startKeys.add(key);
      return true;
    })
    .filter(
      e =>
        Array.isArray(e) &&
        typeof e[0] === 'string' &&
        Number.isFinite(e[1]) &&
        Date.now() - e[1] < DAY_MS &&
        e[1] <= Date.now()
    )
    .slice(-200);
}

// The second read of a marks file that could not be read at the start. Read now: its marks are
// added and the hold ends (unless the file itself holds a loss). Still not: the loss is saved.
function rereadMarks() {
  marksPending = false;
  const read = readMarks();
  if (!read.problem) {
    const savedLoss = read.marks.lost;
    const lostAgo = Date.now() - savedLoss;
    if (!(Number.isFinite(savedLoss) && lostAgo >= 0 && lostAgo < LOST_MS)) marksLost = 0;
    takeMarks([read.marks]);
  }
  save();
}

function load() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  for (const n of data.instances || [])
    if (n?.id)
      instances.set(n.id, {
        ...n,
        paneId: '',
        state: 'hidden',
        closedAt: n.closedAt || Date.now(),
      });
  for (const t of data.tasks || [])
    if (t?.id && instances.has(t.instanceId)) {
      tasks.set(t.id, t);
      if (t.result) prints.set(t.id, resultPrints(t));
    }

  // The marks' own file: its marks are added to those of agent-lifecycle.json. One that is there
  // and cannot be read leaves the marks unknown (marksLost), and so does one that is missing while
  // agent-lifecycle.json or the tiny remote-marks.seen says marks were kept here (both files lost).
  // A read error that may pass (another program holding the file) is held in memory only and read
  // once more a little later; a parse failure or a second failure is saved as lost.
  const read = readMarks();
  if (read.problem === 'missing' && (data.marksUsed === true || fileThere(seenFile())))
    read.problem = 'lost';
  if (read.problem && read.problem !== 'missing') {
    marksSeen = true;
    marksLost = Date.now();
  }
  takeMarks([data, read.marks]);

  // marked before the list above existed
  for (const n of instances.values()) if (n.remote === true) markRemote(n);

  if (read.problem === 'busy') {
    marksPending = true;
    const retry = setTimeout(rereadMarks, MARKS_RETRY_MS);
    retry.unref?.();
  }

  // a loss is written into the marks file at once, so it outlives this run
  else if (marksLost) save();
  sweep();
}

// A named section (stall-log.js): it runs at every turn start and end, over every remembered
// instance.
function publish() {
  const t0 = performance.now();
  send('lifecycle:state', state());
  stalls.ran('lifecycle publish (' + instances.size + ' instances)', performance.now() - t0);
  save();
}

// Cleared: the conversation id and every task result go, so nothing of it reaches a later agent (a
// new agent may get the same name).
function clear(n) {
  cancelClose(n);
  for (const t of [...tasks.values()])
    if (t.instanceId === n.id) {
      tasks.delete(t.id);
      prints.delete(t.id);
    }
  if (n.paneId) byPane.delete(n.paneId);
  instances.delete(n.id);
}

function sweep() {
  const old = Date.now() - REVIVE_DAYS * 864e5;
  for (const n of [...instances.values()])
    if (n.state === 'hidden' && (!n.contextId || (n.closedAt || 0) < old)) clear(n);
  const done = [...tasks.values()].sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  for (const t of done.slice(KEEP_TASKS)) {
    tasks.delete(t.id);
    prints.delete(t.id);
  }
}

// ---------- Instances ----------
// pty:start returned. A resumed conversation is the same instance (matched by its context id);
// anything else is a fresh one.
function started(o) {
  if (!o?.paneId || !o.agent || o.agent === 'Terminal' || o.mode === 'login') return;
  const prev = instances.get(byPane.get(o.paneId));
  let n = o.resumeId
    ? [...instances.values()].find(i => i.agent === o.agent && i.contextId === o.resumeId)
    : null;

  // the pane now runs a different conversation: the old one is hidden (resumable), not reused
  // silently
  if (prev && prev !== n) detach(prev);
  if (n && n.paneId && n.paneId !== o.paneId) detach(n);
  if (!n) {
    n = { id: crypto.randomUUID(), createdAt: Date.now(), revived: false };
    instances.set(n.id, n);
  }
  Object.assign(n, {
    paneId: o.paneId,
    agent: o.agent,
    name: o.name || n.name || '',
    contextId: o.sessionId || o.resumeId || n.contextId || '',
    project: o.root || '',
    cwd: o.cwd || '',
    accountId: o.accountId || '',
    customAgentId: o.customAgentId || '',
    ownedByUser: !!o.ownedByUser,
    subagent: !!o.subagentOf,
    state: 'reusable',
    closedAt: 0,
    lastActiveAt: Date.now(),
    successorId: '', // running again: no longer retired
  });
  byPane.set(o.paneId, n.id);

  // A conversation that runs in a panel started from another computer keeps that for as long as it
  // can be revived (saved with the instance): the panel's mark ends when this computer's user
  // closes the panel, the conversation's does not (`remoteResumed`).
  if (remotePanes.has(o.paneId)) markRemote(n);
  publish();
}

function detach(n) {
  cancelClose(n);
  if (n.paneId && byPane.get(n.paneId) === n.id) byPane.delete(n.paneId);
  n.paneId = '';
  n.revived = false;
  n.closedAt = Date.now();
  n.state = n.contextId && canResume(n.agent) ? 'hidden' : 'cleared';
  if (n.state === 'cleared') clear(n);
}

// Codex reports its session id after it starts.
function session(paneId, sessionId) {
  const n = instances.get(byPane.get(paneId));
  if (n && sessionId && n.contextId !== sessionId) {
    n.contextId = sessionId;
    if (n.remote === true || remotePanes.has(paneId)) markRemote(n);

    /* the id it has now is marked too */
    save();
  }
}

function exited(paneId) {
  const n = instances.get(byPane.get(paneId));
  if (!n) return;
  cancelClose(n);
  n.state = 'stopped';
  n.lastActiveAt = Date.now();
  publish();
}

// The pane itself is gone (its ×, a closed workspace, or Technically Not closing a revived
// instance).
function closed(paneId) {
  notes.delete(paneId);
  prompts.delete(paneId);
  if (remotePanes.delete(paneId)) save();

  /* no longer one of the panels another computer started */
  const n = instances.get(byPane.get(paneId));
  if (!n) return;
  detach(n);
  publish();
} // pane ids are never reused

// A renamed agent keeps its last few old names (`formerNames`), so a closed agent is still
// found by the name it had before (lookup). Returns the renames: [{ instanceId, from, to }].
const FORMER_NAMES_MAX = 5;

function setNames(list) {
  const renames = [];
  for (const item of Array.isArray(list) ? list : []) {
    const n = instances.get(byPane.get(item?.paneId));
    const name = clip(item?.name, 80);
    if (n && name && n.name !== name) {
      if (n.name) {
        const kept = (n.formerNames || []).filter(
          old =>
            old.toLowerCase() !== n.name.toLowerCase() && old.toLowerCase() !== name.toLowerCase()
        );
        n.formerNames = [n.name, ...kept].slice(0, FORMER_NAMES_MAX);
        renames.push({ instanceId: n.id, from: n.name, to: name });
      }
      n.name = name;
    }
  }
  if (renames.length) save();
  return renames;
}

// ---------- Tasks ----------
// Technically Not routed the next prompt of a pane itself (composer, `tnai send`, revive): it
// already made the provenance decision.
function note(paneId, info = {}) {
  if (paneId)
    notes.set(paneId, {
      at: Date.now(),
      originId: info.originId || '',
      originTaskId: info.originTaskId || '',
      source: info.source || 'tnai',
    });
  return true;
}
const fresh = (x, ms) => (x && Date.now() - x.at < ms ? x : null);

// the user wrote it (in the panel, or in the composer routed here); `tnai send` is 'mesh'
const byUser = source => source === 'user' || source === 'composer';

// Claude Code's UserPromptSubmit hook (sync, before the agent sees the prompt). Returns extra
// context for the agent when the prompt quotes another agent's result that Technically Not did not
// route: the agent is told where the task came from and how to hand it back instead of starting a
// new agent for it.
function prompted(paneId, prompt) {
  const n = noted(paneId);
  const p = { at: Date.now(), text: clip(prompt, TASK_KEEP), note: n };
  prompts.set(paneId, p);
  if (n) return ''; // Technically Not chose this agent on purpose
  const me = byPane.get(paneId);
  const o = origin(prompt, { exclude: me });
  if (!o || o.state === 'gone') return '';
  p.origin = o;
  const how = {
    idle: o.name + ' is idle in its panel and still has that context.',
    busy: o.name + ' is working on something else right now; a message waits until it can read it.',
    stopped:
      o.name + '’s process has ended; Technically Not restarts it with the same conversation.',
    hidden:
      o.name +
      '’s panel was closed; Technically Not revives its saved conversation in a new panel (this takes a little while).',
  }[o.state];
  return (
    'Technically Not task provenance: this prompt contains the result of ' +
    o.name +
    ' (' +
    o.agent +
    ', agent id ' +
    o.short +
    '), from its task "' +
    o.task +
    '". ' +
    how +
    ' If the prompt continues that work, hand it to ' +
    o.name +
    ' instead of doing it here or starting a new agent or sub-agent for it: run `tnai send ' +
    o.short +
    ' "<the task, self-contained>"`, then tell the user you handed it over. If it is unrelated to that work, or the user clearly wants you to do it, do it yourself.'
  );
}

function noted(paneId) {
  const n = fresh(notes.get(paneId), NOTE_MS);
  notes.delete(paneId);
  return n;
}

// agent-turns.js: a task started or ended in a pane (Claude Code hooks, Codex rollout).
function onTurn(t) {
  if (!t?.paneId || t.cleared || !t.startedAt) return;
  let n = instances.get(byPane.get(t.paneId));
  if (!n) {
    n = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      agent: t.agent || '',
      name: '',
      contextId: '',
      project: root() || '',
      paneId: t.paneId,
      state: 'reusable',
      revived: false,
    };
    instances.set(n.id, n);
    byPane.set(t.paneId, n.id);
  }
  const key = t.paneId + ':' + t.startedAt;
  let task = [...tasks.values()].find(x => x.turnKey === key);
  const created = !task;
  if (!task) {
    const p = fresh(prompts.get(t.paneId), PROMPT_MS);
    prompts.delete(t.paneId);

    // CLIs without a prompt hook: Technically Not's note is read here
    const routed = p ? p.note : noted(t.paneId);
    const text = p?.text || clip(t.task, TASK_KEEP);
    const o = routed?.originId
      ? { instanceId: routed.originId, taskId: routed.originTaskId }
      : p?.origin || origin(text, { exclude: n.id });
    task = {
      id: crypto.randomUUID(),
      turnKey: key,
      instanceId: n.id,
      originId: o?.instanceId || '',
      originTaskId: o?.taskId || '',
      ownerId: o?.instanceId || n.id,
      text,
      result: '',
      startedAt: t.startedAt,
      endedAt: 0,
      source: routed ? routed.source : 'user',
    };
    tasks.set(task.id, task);
    cancelClose(n);

    // the user works with it now (typed in the panel or the composer): it is theirs to close
    if (byUser(task.source)) n.revived = false;
  }
  n.lastActiveAt = Date.now();

  // A running task's progress updates (tokens, sub-agent logs) change nothing here: the whole state
  // goes out only when it does.
  if (!t.endedAt) {
    // A task ended by a guess (Esc right after the prompt) that a later hook shows still working:
    // it is open again, so its real end is recorded below instead of skipped.
    if (task.endedAt) {
      task.endedAt = 0;
      task.result = '';
      prints.delete(task.id);
      cancelClose(n);
    } else if (!created && n.state === 'active') return;
    n.state = 'active';
    return publish();
  }
  if (task.endedAt) return;
  task.endedAt = t.endedAt;
  task.result = clip(t.result, RESULT_KEEP);
  if (task.result) prints.set(task.id, resultPrints(task));
  if (n.state === 'active') n.state = 'reusable';
  if (n.revived && !byUser(task.source)) scheduleClose(n);
  const t0 = performance.now();
  sweep();
  stalls.ran('turn end: lifecycle sweep', performance.now() - t0);
  publish();
}

// ---------- Provenance ----------
// The instance (and task) whose finished result `text` quotes, best match first. opts.project
// limits it to one project (default: the active one).
function origin(text, opts = {}) {
  const T = fingerprint(text);
  if (T.size < MIN_COMMON) return null;
  const project = norm(opts.project ?? root());
  let best = null;
  for (const [id, R] of prints) {
    const t = tasks.get(id),
      n = t && instances.get(t.instanceId);
    if (
      !n ||
      n.id === opts.exclude ||
      n.state === 'cleared' ||
      (project && norm(n.project) !== project)
    )
      continue;
    const common = share(T, R);
    if (
      common &&
      (!best || common > best.common || (common === best.common && t.endedAt > best.t.endedAt))
    )
      best = { common, t, n };
  }
  return best ? describe(best.n, best.t) : null;
}

// once (state() only): what one pass over every instance shares, { root, known: Map }: the project
// folder is resolved once, and a worktree is looked up once per folder, after the checks that read
// nothing. Each lookup reads and parses worktrees.json on the main process (worktree-service.js
// known), so instances of another project or past their days no longer ask. The answers are the
// same. worktree-service.js now keeps the parsed file, so a publish reads it at most once (measured
// 2026-10-05, 50 closed worktree agents: 8.5 ms → 2.4 ms; what is left is one "does the folder
// still exist" per worktree). The window still gets the whole list: its one reader (47) replaces
// its copy with it.
function availability(n, once) {
  if (n.paneId)
    return n.state === 'active'
      ? 'busy'
      : n.state === 'stopped'
        ? n.contextId && canResume(n.agent)
          ? 'stopped'
          : 'gone'
        : 'idle';
  if (once)
    return n.state === 'hidden' &&
      n.contextId &&
      canResume(n.agent) &&
      norm(n.project) === once.root &&
      Date.now() - (n.closedAt || 0) < REVIVE_DAYS * 864e5 &&
      reopenable(n, once.known)
      ? 'hidden'
      : 'gone';
  return n.state === 'hidden' &&
    n.contextId &&
    canResume(n.agent) &&
    reopenable(n) &&
    norm(n.project) === norm(root()) &&
    Date.now() - (n.closedAt || 0) < REVIVE_DAYS * 864e5
    ? 'hidden'
    : 'gone';
}

// Its conversation's folder can be opened again: the project folder or a folder inside it, or a
// Technically Not worktree of the project that still exists (worktree-service paneCwd puts the
// resumed pane back into it, as its owner or sharing it). A deleted worktree can't be.
function reopenable(n, known) {
  if (!n.cwd || !n.project) return true;
  const cwd = norm(n.cwd),
    project = norm(n.project);
  if (cwd === project || cwd.startsWith(project + path.sep)) return true;
  const k = cwd + '\n' + project;
  if (known?.has(k)) return known.get(k);
  let is = false;
  try {
    is = require('./worktree-service').known(n.cwd, n.project);
  } catch {}
  known?.set(k, is);
  return is;
}
const describe = (n, t) => ({
  instanceId: n.id,
  short: short(n.id),
  name: n.name || n.agent,
  agent: n.agent,
  paneId: n.paneId || '',
  state: availability(n),
  taskId: t?.id || '',
  task: clip(t?.text, 160),
  successor: (n.successorId && instances.get(n.successorId)?.name) || '',
});

// RETIRED: an agent that handed its work to another (`tnai close --self
// --successor`, 54's Retire & hand off) keeps its conversation, but `tnai send` to it goes to its
// successor instead of reviving it (a long conversation reopened for one message wastes usage).
function retire(paneId, toPaneId) {
  const n = instances.get(byPane.get(paneId)),
    to = instances.get(byPane.get(toPaneId));
  if (!n || !to || n === to) return false;
  n.successorId = to.id;
  save();
  return true;
}

// The newest agent in a chain of hand-offs (a successor may have retired too), or null when this
// one never handed over or its successors are all forgotten.
function successorOf(instanceId) {
  const seen = new Set([instanceId]);
  let n = instances.get(instanceId),
    last = null;
  while (n?.successorId && !seen.has(n.successorId) && instances.has(n.successorId)) {
    n = instances.get(n.successorId);
    seen.add(n.id);
    last = n;
  }
  return last && describe(last, lastTask(last));
}

// An instance by id (or id prefix), else by name: for `tnai send` to a closed agent. A closed agent
// keeps its name until it is cleared, so a name can repeat: it goes to the one that can still be
// reached, then the one whose pane is open, then the most recently used; the others are reached by
// id (deleting an agent and making a new one of the same name must not
// block messages to that name).
function lookup(key, project) {
  key = String(key || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const pool = [...instances.values()].filter(
    n => n.state !== 'cleared' && (!project || norm(n.project) === norm(project))
  );
  const byId = key.length >= 6 && pool.filter(n => n.id.startsWith(key));
  if (byId?.length === 1) return describe(byId[0], lastTask(byId[0]));
  const rank = n => (availability(n) !== 'gone' ? 2 : 0) + (n.paneId ? 1 : 0),
    used = n => n.lastActiveAt || n.closedAt || n.createdAt || 0;
  const named = pool
    .filter(n => (n.name || '').toLowerCase() === key)
    .sort((a, b) => rank(b) - rank(a) || used(b) - used(a));
  if (named.length) return describe(named[0], lastTask(named[0]));

  // No agent carries the name now: an agent the user renamed away from it
  const renamed = pool
    .filter(n => (n.formerNames || []).some(old => old.toLowerCase() === key))
    .sort((a, b) => rank(b) - rank(a) || used(b) - used(a));
  return renamed.length ? describe(renamed[0], lastTask(renamed[0])) : null;
}
const lastTask = n =>
  [...tasks.values()]
    .filter(t => t.instanceId === n.id)
    .sort((a, b) => b.startedAt - a.startedAt)[0];

// ---------- Revive: the window reopens a conversation (a new pane with the CLI's resume, or a
// restart in its own pane) ----------
function revive(instanceId) {
  // Already being revived: wait for that one and get the same panel back.
  const underWay = revivesUnderWay.get(instanceId);
  if (underWay) return underWay;
  const n = instances.get(instanceId);
  const state = n && availability(n);
  if (!n || (state !== 'hidden' && state !== 'stopped'))
    return Promise.resolve({ error: 'That agent can no longer be revived.' });
  const requestId = crypto.randomUUID(),
    // a closed pane Technically Not reopens is Technically Not's to close again; a restart in the
    // user's open pane is not
    reopened = !n.paneId;
  const promise = new Promise(resolve => {
    const timer = setTimeout(() => {
      reviving.delete(requestId);
      resolve({ error: (n.name || n.agent) + ' did not become ready in time.' });
    }, REVIVE_MS);
    reviving.set(requestId, result => {
      clearTimeout(timer);
      reviving.delete(requestId);
      const m = result?.paneId && instances.get(byPane.get(result.paneId));
      if (m && reopened) m.revived = true;
      resolve(result || { error: 'No answer' });
    });
    send('lifecycle:revive', {
      requestId,
      instanceId: n.id,
      paneId: n.paneId,
      name: n.name,
      agent: n.agent,
      contextId: n.contextId,
      accountId: n.accountId,
      customAgentId: n.customAgentId,
      ownedByUser: n.ownedByUser,
    });
  });
  revivesUnderWay.set(instanceId, promise);

  // Answered or timed out: the next revive of this agent starts fresh.
  promise.then(() => revivesUnderWay.delete(instanceId));
  return promise;
}

// `tnai new` (agent-mesh.js): a fresh conversation in a new pane, owned by the user like the
// composer's New agent, so a lead CLI gets the delegation tools (agent-graph.js).
function spawn(agent, pick = null, name = '', extra = {}) {
  // pick: { model, effort } already checked by model-pick.js; name: the user's own name for it
  // (--name). extra.schedule: a scheduled prompt's run (prompt-schedules.js): its start mark, which
  // pty:start (main.js) turns into the schedule's project folder, and that folder, which the window
  // reads the project's access level for. Such a thread is the user's own, not started by an agent.
  const scheduled = extra && typeof extra.schedule === 'string' ? extra : null;
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      reviving.delete(requestId);
      resolve({ error: agent + ' did not become ready in time.' });
    }, REVIVE_MS);
    reviving.set(requestId, result => {
      clearTimeout(timer);
      reviving.delete(requestId);
      resolve(result || { error: 'No answer' });
    });
    if (!scheduled) {
      spawning.add(requestId);
      setTimeout(() => spawning.delete(requestId), 10 * 60000).unref?.();
    }
    send('lifecycle:revive', {
      requestId,
      instanceId: '',
      paneId: '',
      name,
      chosen: !!name,
      agent,
      contextId: '',
      accountId: '',
      customAgentId: '',
      ownedByUser: true,
      model: pick?.model || '',
      effort: pick?.effort || '',
      ...(scheduled
        ? { schedule: scheduled.schedule, folder: String(scheduled.folder || '') }
        : null),
    });
  });
}

// A start asked by a paired computer (remote-actions.js `start`):
// a fresh conversation in a new panel like `spawn`, with three differences. The request says so
// (`remote`), and the window then opens no new workspace for it and sends its id back as the mark
// in `pty:start` (47, 10), where `remoteTake` lets it start one panel, once, which main.js forces
// to "Ask first". Nothing but the CLI's name is in it: this computer's own default model, effort
// and account apply. And the panel is the user's own (started from their other computer), not
// "started by an agent": it is counted by `remoteOpen`, apart from `tnai new`. Resolves with the
// window's answer plus `panel`: the panel that started under the mark ('' if none did), also when
// the answer is an error or never came, so whatever opened can be stopped. Once answered the mark
// is gone and a late start with it takes nothing. kept: what the asker wants back when the mark is
// taken (remote-actions.js: who asked, and their guard, asked again before the process starts).
// resumeId (item 44, a paired computer's Resume of a past conversation here): the conversation the
// new panel continues. The mark is then taken only by a start that resumes exactly that one.
function spawnRemote(agent, kept = {}, resumeId = '') {
  const requestId = crypto.randomUUID(),
    ask = {
      agent: String(agent),
      paneId: '',
      kept: kept && typeof kept === 'object' ? kept : {},
      contextId: typeof resumeId === 'string' ? resumeId : '',
    };
  remoteAsks.set(requestId, ask);
  return new Promise(resolve => {
    const finish = result => {
      clearTimeout(timer);
      reviving.delete(requestId);
      remoteAsks.delete(requestId);
      resolve({
        ...(result && typeof result === 'object' ? result : { error: 'No answer' }),
        panel: ask.paneId,
      });
    };
    const timer = setTimeout(
      () => finish({ error: ask.agent + ' did not become ready in time.' }),
      REVIVE_MS
    );
    reviving.set(requestId, finish);
    send('lifecycle:revive', {
      requestId,
      instanceId: '',
      paneId: '',
      name: '',
      chosen: false,
      agent: ask.agent,
      contextId: ask.contextId,
      accountId: '',
      customAgentId: '',
      ownedByUser: true,
      model: '',
      effort: '',
      remote: true,
    });
  });
}

// `pty:start` arrived with a mark: once, for the request it belongs to, the CLI that request named
// and a panel id, it gives back what the asker left with the request (an object); in every other
// case false.
function remoteTake(mark, paneId, agent, resumeId = '') {
  const ask = typeof mark === 'string' ? remoteAsks.get(mark) : null;
  if (!ask || ask.paneId || ask.agent !== agent || typeof paneId !== 'string' || !paneId)
    return false;

  // a fresh start takes no conversation, a Resume only the one it asked for (item 44)
  if ((ask.contextId || '') !== (typeof resumeId === 'string' ? resumeId : '')) return false;
  ask.paneId = paneId;
  remotePanes.set(paneId, Date.now());
  save();
  return ask.kept;
}

// `pty:start` wants to resume a conversation in a panel that is not one of those panels
// (remote-actions.js startOptions asks). True when that conversation ran in one (its old panel was
// closed and it is revived in a new one, by this computer's user or by an agent's message): the new
// panel then is such a panel too, counted and held like the first, until this computer's user
// closes it.
function remoteResumed(paneId, agent, contextId) {
  if (typeof paneId !== 'string' || !paneId || typeof contextId !== 'string' || !contextId)
    return false;
  if (!remoteConversation(agent, contextId)) return false;
  remotePanes.set(paneId, Date.now());
  save();
  return true;
}

// The starts a paired computer was given in the last 24 hours (remote-control.js allows 20 a day
// per computer): noted when one is taken, counted when the next arrives, and saved with the rest,
// so a restart of the app does not start the day again.
function remoteStartNoted(peerId, at = Date.now()) {
  remoteStarts = remoteStarts.filter(e => at - e[1] < DAY_MS).slice(-199);
  remoteStarts.push([String(peerId), at]);
  save();
}
const remoteStartsToday = (peerId, now = Date.now()) =>
  remoteStarts.filter(e => e[0] === String(peerId) && now - e[1] < DAY_MS && e[1] <= now).length;

function revived(requestId, result) {
  // A `tnai new` pane is not the user's (tnai agents / close), also when it opened but was not
  // ready in time (openedPaneId) or answered after spawn gave up.
  const pane = spawning.delete(requestId) && (result?.paneId || result?.openedPaneId),
    n = pane && instances.get(byPane.get(pane));
  if (n && !n.startedByAgent) {
    n.startedByAgent = true;
    save();
  }
  reviving.get(requestId)?.(result);
  return true;
}

// A revived instance that finished the task it came back for closes again (HIDDEN, still revivable)
// unless the user starts working with it.
function scheduleClose(n) {
  cancelClose(n);
  const t = setTimeout(() => {
    closers.delete(n.id);
    if (n.revived && n.paneId && n.state === 'reusable')
      send('lifecycle:close', { paneId: n.paneId, name: n.name });
  }, CLOSE_MS);
  t.unref?.();
  closers.set(n.id, t);
  n.closesAt = Date.now() + CLOSE_MS;
}

function cancelClose(n) {
  clearTimeout(closers.get(n.id));
  closers.delete(n.id);
  n.closesAt = 0;
}

// The user typed in the pane (not Technically Not delivering a routed task): it stays open.
function typed(paneId) {
  const n = instances.get(byPane.get(paneId)),
    r = fresh(notes.get(paneId), 3000);
  if (n?.revived && (!r || byUser(r.source))) {
    n.revived = false;
    cancelClose(n);
  }
}

function state() {
  const once = { root: norm(root()), known: new Map() };
  return {
    instances: [...instances.values()].map(n => ({
      id: n.id,
      name: n.name,
      agent: n.agent,
      paneId: n.paneId,
      state: n.state,
      availability: availability(n, once),
      contextId: n.contextId ? short(n.contextId) : '',
      revived: !!n.revived,
      closesAt: n.closesAt || 0,
      project: n.project,
    })),
    tasks: [...tasks.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 40)
      .map(t => ({
        id: t.id,
        instanceId: t.instanceId,
        ownerId: t.ownerId,
        originId: t.originId,
        originTaskId: t.originTaskId,
        source: t.source,
        text: clip(t.text, 200),
        startedAt: t.startedAt,
        endedAt: t.endedAt,
      })),
  };
}

module.exports = {
  // deps: { canResume(agent), root() }
  init(sender, deps = {}) {
    send = sender;
    canResume = deps.canResume || canResume;
    root = deps.root || root;
    load();
    setInterval(() => {
      sweep();
      save();
    }, 36e5).unref?.();
  },
  started,
  session,
  exited,
  closed,
  setNames,
  note,
  prompted,
  onTurn,
  origin,
  lookup,
  revive,
  spawn,
  revived,
  typed,
  state,
  quotes,
  flushSaves,
  retire,
  successorOf,
  instanceOf: paneId => byPane.get(paneId) || '',
  // the agent id of the instance that runs a conversation ('' when none): a closed sub-agent
  // named by its graph id is found through its conversation (agent-mesh.js helperIds)
  instanceOfContext: contextId => {
    if (!contextId) return '';
    const n = [...instances.values()].find(i => i.contextId === contextId && i.state !== 'cleared');
    return n ? n.id : '';
  },
  // Starts asked by a paired computer: the request, its mark, whether a panel started under one,
  // and how many such panels this computer's user has not closed yet (stopped ones count; kept
  // across restarts in agent-lifecycle.json).
  spawnRemote,
  remoteTake,
  remoteStarted: paneId => remotePanes.has(paneId),
  remoteResumed,
  remoteOpen: () => remotePanes.size,
  // When the marks could not be read, else 0 (marksLost above).
  remoteMarksLost: () => (marksLost && Date.now() - marksLost < LOST_MS ? marksLost : 0),
  // True when this computer still knows whether that conversation was started from another
  // computer: it is marked, or it is an instance the lifecycle holds (whose own mark was read from
  // agent-lifecycle.json).
  remoteKnown: (agent, contextId) =>
    !!contextId &&
    (remoteConversation(agent, contextId) ||
      [...instances.values()].some(n => n.agent === agent && n.contextId === contextId)),
  remoteStartNoted,
  remoteStartsToday,
  // Started by another agent with `tnai new` (not by the user); kept across restarts in
  // agent-lifecycle.json.
  startedByAgent: paneId => !!instances.get(byPane.get(paneId))?.startedByAgent,
  // True while the agent in that panel works on a task (prompt-schedules.js: no second run of a
  // schedule while its last thread still works).
  busy: paneId => instances.get(byPane.get(paneId))?.state === 'active',
  // How many of them have an open panel with a running CLI, plus the ones still starting (the limit
  // on `tnai new`, agent-graph.js refuseNew).
  startedOpen: () =>
    spawning.size +
    [...instances.values()].filter(n => n.startedByAgent && n.paneId && n.state !== 'stopped')
      .length,
  // The folder a conversation ran in (worktree-service: a resumed worktree conversation goes back
  // to its worktree).
  cwdOf: (agent, contextId) =>
    (contextId &&
      [...instances.values()].find(n => n.agent === agent && n.contextId === contextId)?.cwd) ||
    '',
  // For agent-context.js: the instance in a pane, and the instances with an open pane in a project.
  exists: id => instances.has(id),
  info: paneId => {
    const n = instances.get(byPane.get(paneId));
    return n
      ? {
          id: n.id,
          name: n.name,
          agent: n.agent,
          project: n.project,
          paneId: n.paneId,
          subagent: !!n.subagent,
        }
      : null;
  },
  live: project =>
    [...instances.values()]
      .filter(n => n.paneId && n.state !== 'stopped' && norm(n.project) === norm(project))
      .map(n => ({ id: n.id, name: n.name, agent: n.agent, paneId: n.paneId })),
  // Closed agents of a project that `tnai send` can still revive (for `tnai agents`).
  closedIn: project =>
    [...instances.values()]
      .filter(n => !n.paneId && availability(n) === 'hidden' && norm(n.project) === norm(project))
      .map(n => ({ ...describe(n, lastTask(n)), id: short(n.id) })),
  // The list of past conversations (thread-list.js, asked when the user opens it): what is recorded
  // here about each conversation of a project. task/result: the last task's words as kept here,
  // clipped. revivable: closed and still resumable by the rules of `tnai send`.
  conversations: project =>
    [...instances.values()]
      .filter(n => n.contextId && n.state !== 'cleared' && norm(n.project) === norm(project))
      .map(n => {
        const t = lastTask(n);
        return {
          id: n.contextId,
          agent: n.agent,
          name: n.name || '',
          paneId: n.paneId || '',
          cwd: n.cwd || '',
          accountId: n.accountId || '',
          customAgentId: n.customAgentId || '',
          ownedByUser: !!n.ownedByUser,
          subagent: !!n.subagent,
          remote: remoteConversation(n.agent, n.contextId),
          at: n.lastActiveAt || n.closedAt || n.createdAt || 0,
          revivable: !n.paneId && availability(n) === 'hidden',
          task: clip(t?.text, 400),
          result: clip(t?.result, 900),
        };
      }),
  // A conversation that ran in a panel started from another computer (it is resumed at "Ask first"
  // only: remote-actions.js startOptions).
  remoteConversation,
  // `tnai clear-closed`: the user asked to clear closed agents of a project from the list (closed
  // at least `olderThanMs` ago). Cleared like an expired one: no longer revivable by Technically
  // Not, and its task provenance goes. Open panels and live agents are never touched. Returns how
  // many were cleared.
  clearClosed(project, olderThanMs = 0) {
    const before = Date.now() - Math.max(0, olderThanMs);
    const gone = [...instances.values()].filter(
      n =>
        !n.paneId &&
        availability(n) === 'hidden' &&
        norm(n.project) === norm(project) &&
        (n.closedAt || 0) <= before
    );
    for (const n of gone) clear(n);
    if (gone.length) publish();
    return gone.length;
  },
};
