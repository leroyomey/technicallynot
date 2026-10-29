/*
 * Technically Not desktop · agent-graph.js — Custom agents are the user's: Technically Not never
 * stops, restarts, replaces or re-tasks them. This is the one place that lets such an agent (or one
 * the user started for a task) delegate, through a task graph with limits. Model: identity ≠
 * instance ≠ task. An IDENTITY is a sub-agent persona under one parent (name, role, history of its
 * tasks; kept across restarts). An INSTANCE is one run of it in a pane (unique id, its own Claude
 * Code conversation). A TASK is one job given to an instance. Instance states: ACTIVE (working),
 * IDLE (done, pane open), HIDDEN (pane closed, conversation saved → can be revived), SUSPENDED
 * (stopped before it finished, e.g. the user or its parent stopped it; never reused automatically),
 * ARCHIVED (old; history only). tnai_delegate decides: REUSE an idle instance on related work (same
 * conversation), REVIVE a hidden one on related work (its conversation resumed in a new pane),
 * CLONE a related identity whose instance is busy (new instance, fresh conversation), RECYCLE an
 * idle identity for unrelated work (fresh conversation, old context never carried over), or CREATE
 * a new identity. Instances the user kept are the user's and are never picked automatically.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const sessionStore = require('./session-store'); // writeAtomic only
const lifecycle = require('./agent-lifecycle');
const errors = require('./agent-errors');

// User-adjustable limits (Settings › Agents), saved in userData/agent-graph.json with the
// identities and hidden instances.
const DEFAULTS = { maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 60 };

// 0 for the two counts = no limit (Settings › Agents › Delegation); a full
// terminal workspace still refuses a new panel.
const BOUNDS = {
  maxDepth: [1, 3],
  maxActivePerAgent: [0, 6],
  maxActiveTotal: [0, 11],
  graceSeconds: [10, 600],
};
const REPORT_MAX = 6000,
  WAIT_MAX = 600,
  SPAWN_TIMEOUT = 20000,
  READY_TIMEOUT = 90000,
  START_WAIT = 45000;

// Which CLI a sub-agent runs: Claude Code (ready + report from its hooks), or Codex / OpenCode
// (ready from its MCP connection or once its screen settles, report from the task end in its own
// record, agent-turns.js: Codex rollout, OpenCode database, Cursor Agent transcript). Cursor Agent
// leads through its per-pane plugin, whose mcp.json carries Technically Not's server
// (agent-hooks.js cursorPlugin), never the user's ~/.cursor/mcp.json. tnai_delegate `worktree`: the
// lead's folder (default), a new worktree, or the project folder
const WORKTREE = ['inherit', 'own', 'none'];
const CLIS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent'],
  LEADS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent'],
  QUIET_MS = 2500;
const RELATED = 0.3,
  DUPLICATE = 0.55; // task-text overlap: related work / the same task
const REVIVE_DAYS = 7,
  ARCHIVE_DAYS = 14,
  KEEP_IDENTITIES = 40,
  HISTORY = 12;
const SAMPLES = 20,
  MIN_SAMPLES = 3; // team estimate: median of the last 20 finished sub-agent tasks, none before 3

// id -> { id, parentKey, name, role, history: [{ purpose, status, at, report, tokens, turnAt,
// planPct, planWindow, plan }], createdAt, lastUsedAt, archived, instances }
const identities = new Map();

// instance id -> { id, identityId, instance, paneId, parentId, parentKey, customAgentId, name,
// purpose, task, status, state, persistent, depth, sessionId, createdAt, doneAt, report, reported,
// closesAt }
const nodes = new Map();
const byPane = new Map(); // paneId -> instance id
const busy = new Set(); // paneIds mid-turn (between a prompt and its Stop hook)
const waiters = new Set(); // { parentId, ids, resolve } from tnai_wait

// instance id -> { resolve(paneId|null), timer } until its CLI started (or never will)
const spawning = new Map();
const timers = new Map(); // instance id -> close timer
const drawn = new Map(); // paneId -> last screen output, while a non-Claude sub-agent starts
let send = () => {},
  ptys = null,
  submit = null,
  settings = { ...DEFAULTS };

// main.js: is that panel in a turn that a message from another computer's agent started
// (remote-say.js)
let sayTurn = () => false;

const file = () => path.join(app.getPath('userData'), 'agent-graph.json');
const clip = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
};
const ACTIVE = new Set(['starting', 'working']);
const stateOf = n =>
  n.archived
    ? 'ARCHIVED'
    : ACTIVE.has(n.status)
      ? 'ACTIVE'
      : n.status === 'done' && n.paneId
        ? 'IDLE'
        : n.status === 'stopped' || n.status === 'failed'
          ? 'SUSPENDED'
          : 'HIDDEN';
const nodeOf = paneId => nodes.get(byPane.get(paneId));
const children = id => [...nodes.values()].filter(n => n.parentId === id);

// this parent's instances, across restarts
const family = key => [...nodes.values()].filter(n => n.parentKey === key && !n.root);
const alive = n => !!n.paneId && !['stopped', 'failed', 'hidden'].includes(n.status);
const revivable = n =>
  n.status === 'hidden' &&
  !n.paneId &&
  !!n.sessionId &&
  !n.archived &&
  Date.now() - (n.doneAt || 0) < REVIVE_DAYS * 864e5;
const cliOf = x => x?.agent || 'Claude Code';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const label = n => n.name + (n.instance > 1 ? ' #' + n.instance : '');
const view = n => ({
  id: n.id,
  identityId: n.identityId || '',
  instance: n.instance || 1,
  paneId: n.paneId || '',
  parentId: n.parentId || '',
  parentPaneId: nodes.get(n.parentId)?.paneId || '',
  name: n.name,
  agent: cliOf(n),
  purpose: n.purpose,
  task: n.task,
  status: n.status,
  state: stateOf(n),
  reusable: revivable(n),
  persistent: n.persistent,
  depth: n.depth,
  createdAt: n.createdAt,
  doneAt: n.doneAt || 0,
  report: n.report || '',
  closesAt: n.closesAt || 0,
  root: !!n.root,
  lane: n.lane || '',
  worktree: n.worktree || '',
  inWait: [...waiters].some(w => w.parentId === n.id),
}); // blocked in tnai_wait on its sub-agents (the window's "Waiting on agents", 10)

function state() {
  return {
    settings,
    estimate: estimates(),
    nodes: [...nodes.values()].map(view),
    identities: [...identities.values()].map(i => ({
      id: i.id,
      name: i.name,
      parentKey: i.parentKey,
      role: i.role,
      history: i.history.map(h => ({ purpose: h.purpose, status: h.status, at: h.at })),
      lastUsedAt: i.lastUsedAt,
      archived: !!i.archived,
    })),
  };
}

function publish() {
  send('graph:state', state());
  save();
}

// ---------- Team estimate: what a sub-agent task has really used (tokens from agent-turns.js,
// never guessed) ---------- A sub-agent's first task turn after it was given the job: its tokens
// (input + cache writes + output, the task meter's measure, plus its own Claude Code sub-agents) go
// on that job's history entry. Later turns (the user following up in its panel) don't change it.
function spend(t) {
  const n = t?.paneId && nodeOf(t.paneId);
  if (!n || n.root || !t.endedAt || !t.startedAt || !t.tokens) return;
  const h = identities.get(n.identityId)?.history.findLast(x => x.instanceId === n.id);
  if (!h || t.startedAt < h.at - 5000 || (h.turnAt && h.turnAt !== t.startedAt)) return;
  const used =
    (t.tokens.input || 0) +
    (t.tokens.cacheWrite || 0) +
    (t.tokens.output || 0) +
    Object.values(t.subTokens || {}).reduce((a, b) => a + (b || 0), 0);

  // Codex: the task's share of its own plan window (agent-turns planShare), kept only when no other
  // Codex panel on that account worked meanwhile.
  const share = t.plan && !t.plan.shared && t.plan.window ? t.plan : null;
  if (used > 0 && (h.tokens !== used || (share && h.planPct !== share.used))) {
    h.tokens = used;
    h.turnAt = t.startedAt;
    if (share)
      Object.assign(h, { planPct: share.used, planWindow: share.window, plan: share.plan });
    save();
  }
}

// Median tokens per sub-agent task over the last SAMPLES finished ones: per CLI when that CLI has
// MIN_SAMPLES, else across all CLIs; null before that.
function estimate(agent) {
  const all = [...identities.values()].flatMap(i =>
    i.history
      .filter(h => h.tokens > 0)
      .map(h => ({
        at: h.at,
        tokens: h.tokens,
        agent: cliOf(i),
        planPct: h.planPct,
        planWindow: h.planWindow,
        plan: h.plan,
      }))
  );
  const median = v => v.sort((a, b) => a - b)[v.length >> 1];
  const pick = (list, cli) => {
    list = list.sort((a, b) => b.at - a.at).slice(0, SAMPLES);
    if (list.length < MIN_SAMPLES) return null;
    const e = { perTask: median(list.map(x => x.tokens)), samples: list.length, agent: cli };

    // Codex only: share of its own plan window per task, from the tasks measured in the same window
    // as the latest one (3 or more).
    const w = cli === 'Codex' && list.find(x => x.planWindow)?.planWindow,
      shares = w ? list.filter(x => x.planWindow === w && Number.isFinite(x.planPct)) : [];
    if (shares.length >= MIN_SAMPLES)
      Object.assign(e, {
        planPct: median(shares.map(x => x.planPct)),
        planSamples: shares.length,
        planWindow: w,
        plan: shares[0].plan || '',
      });
    return e;
  };
  return (
    (agent &&
      pick(
        all.filter(x => x.agent === agent),
        agent
      )) ||
    pick(all, '')
  );
}
const estimates = () => ({
  all: estimate(''),
  byCli: Object.fromEntries(CLIS.map(c => [c, estimate(c)]).filter(([c, e]) => e?.agent === c)),
});
const kTok = n =>
  n >= 1e6
    ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
    : Math.max(1, Math.round(n / 1e3)) + 'k';
const windowName = m =>
  m === 300
    ? '5-hour'
    : m === 10080
      ? 'weekly'
      : m % 1440 === 0
        ? m / 1440 + '-day'
        : m % 60 === 0
          ? m / 60 + '-hour'
          : m + '-minute';
const pct = n => (n < 1 ? '<1%' : Math.round(n * 10) / 10 + '%');
const estText = e =>
  '~' +
  kTok(e.perTask) +
  ' tokens per sub-agent task (median of the last ' +
  e.samples +
  (e.agent ? ' ' + e.agent : '') +
  ' tasks here)' +
  (e.planPct !== undefined
    ? ', about ' +
      pct(e.planPct) +
      ' of the user’s Codex ' +
      windowName(e.planWindow) +
      ' plan window each'
    : '');

// For the lead, after a delegation: what its working team is estimated to spend, from the user's AI
// plan.
function teamLine(parent) {
  const working = children(parent.id).filter(k => ACTIVE.has(k.status));
  const per = working.map(k => estimate(cliOf(k))).filter(Boolean);
  if (!working.length || per.length < working.length) return '';
  const codex = per.filter(e => e.planPct !== undefined);
  const share = codex.length
    ? ' Codex ones ≈ ' +
      pct(codex.reduce((a, e) => a + e.planPct, 0)) +
      ' of the ' +
      windowName(codex[0].planWindow) +
      ' plan window.'
    : '';
  return (
    ' Estimated usage: ' +
    working.length +
    ' working sub-agent' +
    (working.length > 1 ? 's' : '') +
    ' ≈ ~' +
    kTok(per.reduce((a, e) => a + e.perTask, 0)) +
    ' tokens from the user’s AI plan (' +
    estText(per[0]) +
    ').' +
    share +
    ' Only add more when the parallel gain is worth it.'
  );
}

// Similar tasks: shared words (3+ letters) over all words.
const words = s =>
  new Set(
    String(s)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_.-]{2,}/g) || []
  );

function overlap(a, b) {
  const A = words(a),
    B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}

// How related a new task is to an identity: its role and every task it has done.
const relevance = (identity, text) =>
  identity
    ? Math.max(
        overlap(text, identity.role),
        ...identity.history.map(h => overlap(text, h.purpose + ' ' + (h.task || '')))
      )
    : 0;

// ---------- Persistence: identities + instances that can come back (hidden, suspended). Live panes
// are re-registered as they start. ----------
let saveTimer = null;

// Debounced saves write asynchronously (off the main thread); quitting (flushSaves) writes sync.
function write(sync) {
  saveTimer = null;
  archive(); // old identities are archived and the oldest dropped on every save, not only at load
  const keep = [...nodes.values()].filter(n => !n.root && !n.paneId);
  try {
    const text = JSON.stringify(
      {
        settings,
        identities: [...identities.values()],
        instances: keep.map(n => ({ ...n, reported: true })),
      },
      null,
      1
    );
    if (sync) sessionStore.writeAtomic(file(), text);
    else sessionStore.writeAtomicLater(file(), text);
  } catch {}
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => write(false), 300);
  saveTimer.unref?.();
}

// Technically Not is quitting: a save still waiting on its timer is written now.
function flushSaves() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    write(true);
  }
}

function load() {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  settings = { ...DEFAULTS, ...(data.settings || (data.maxDepth ? data : {})) };
  for (const i of data.identities || []) identities.set(i.id, { history: [], ...i });
  for (const n of data.instances || [])
    if (identities.has(n.identityId))
      nodes.set(n.id, {
        ...n,
        paneId: '',
        parentId: null,
        status: ACTIVE.has(n.status) ? 'stopped' : n.status,
      });
  archive();
}

// Old identities and instances are archived (history kept, never revived); beyond KEEP_IDENTITIES
// the oldest archived ones are dropped.
function archive() {
  const old = Date.now() - ARCHIVE_DAYS * 864e5;
  for (const i of identities.values())
    if (
      !i.archived &&
      i.lastUsedAt < old &&
      ![...nodes.values()].some(n => n.identityId === i.id && alive(n))
    )
      i.archived = true;
  const idle = [...identities.values()]
    .filter(i => !i.archived && ![...nodes.values()].some(n => n.identityId === i.id && alive(n)))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  for (const i of idle.slice(
    0,
    Math.max(0, [...identities.values()].filter(x => !x.archived).length - KEEP_IDENTITIES)
  ))
    i.archived = true; // beyond KEEP_IDENTITIES, the longest-idle ones too
  for (const n of nodes.values())
    if (!n.paneId && identities.get(n.identityId)?.archived) n.archived = true;
  const dropped = [...identities.values()]
    .filter(i => i.archived)
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    .slice(0, Math.max(0, identities.size - KEEP_IDENTITIES));
  for (const i of dropped) {
    identities.delete(i.id);
    for (const n of [...nodes.values()]) if (n.identityId === i.id && !n.paneId) nodes.delete(n.id);
  }
}

// ---------- Roots: a custom agent's session, or an agent the user started for a task ----------
// parentKey ties sub-agent identities to their owner across restarts: the custom agent's id, else
// the pane. agent: the lead's CLI (Claude Code or Codex, both reach the tools over agent-hooks' MCP
// server).
function rootStarted(paneId, customAgentId, name, agent = 'Claude Code') {
  const key = customAgentId ? 'agent:' + customAgentId : 'pane:' + paneId;
  const old = nodeOf(paneId);
  if (old?.root) {
    old.status = 'working';
    old.name = name || old.name;
    old.parentKey = key;
    old.agent = agent;
    return publish();
  }
  const n = {
    id: crypto.randomUUID(),
    root: true,
    paneId,
    parentId: null,
    parentKey: key,
    customAgentId,
    agent,
    name: name || 'Agent',
    purpose: 'Your agent',
    task: '',
    status: 'working',
    persistent: true,
    depth: 0,
    createdAt: Date.now(),
  };
  nodes.set(n.id, n);
  byPane.set(paneId, n.id);

  // its earlier sub-agents (hidden, suspended) belong to it again
  for (const k of family(key)) if (!k.parentId) k.parentId = n.id;
  publish();
}

// ---------- Tools offered to an agent in the graph (Claude Code, over agent-hooks' MCP server)
function tools(paneId) {
  const n = nodeOf(paneId);
  if (!n || n.depth >= settings.maxDepth) return [];
  const est = estimate('');
  const str = d => ({ type: 'string', description: d });
  return [
    {
      name: 'tnai_delegate',
      description:
        "Hand ONE clearly separated part of the user's task to a sub-agent in its own Technically Not terminal panel, only when it genuinely benefits from running in parallel. First ask yourself: does this need another agent, or can you do it yourself faster? Technically Not then picks the agent: an idle or earlier sub-agent that already worked on related things (it keeps that context), a fresh copy when that one is busy, or a new one; unrelated work never inherits old context. Technically Not refuses duplicates of work already in progress and enforces the user's limits (depth " +
        settings.maxDepth +
        ', ' +
        (settings.maxActivePerAgent || 'no limit on') +
        ' working per agent, ' +
        (settings.maxActiveTotal || 'no limit') +
        ' in total). The sub-agent reports back to you automatically.' +
        (est
          ? ' Cost: each one spends from the user’s own AI plan at the same time as you; ' +
            estText(est) +
            '.'
          : '') +
        ' Folder: by default it works where you work (your git worktree when you have one, else the project folder); worktree "own" gives it a new worktree on its own branch (parallel edits that are merged separately), "none" the plain project folder.',
      inputSchema: {
        type: 'object',
        properties: {
          name: str(
            'Only when the user named this sub-agent (e.g. "a sub-agent called bug reporter"): exactly that name. Technically Not shows it as is; the same name again goes to that sub-agent. Default: Technically Not picks a name.'
          ),
          purpose: str('Short name of its job, e.g. "Write the settings page tests".'),
          task: str(
            'The full, self-contained task with all the context it needs and what to report back.'
          ),
          why: str(
            'Why delegating beats doing it yourself (what runs in parallel, why it is separate).'
          ),
          agent: {
            type: 'string',
            enum: CLIS,
            description:
              'Which agent CLI runs it (default Claude Code). Codex, OpenCode and Cursor Agent run on their own sign-in on this PC; pick the one the user asks for.',
          },
          worktree: {
            type: 'string',
            enum: WORKTREE,
            description:
              'Which folder it works in. inherit (default): the same folder as you, so it shares your worktree and branch when you have one. own: a new git worktree on its own tnai/ branch (only for code work running alongside other code edits, when its edits must stay apart from yours; never for docs, notes, research or reviews; needs a git project with a commit). none: the plain project folder.',
          },
          model: str(
            'Only when the user asked for a model: the model it runs on, as the user named it (e.g. "Opus 5.5", "sonnet", "gpt-5.5"). Default: that CLI’s own default. A name the CLI does not have is refused with its list.'
          ),
          effort: str(
            'Only when the user asked for an effort: low, medium, high, xhigh or max (the levels differ per CLI and model; Cursor Agent has none). Default: that CLI’s own default.'
          ),
        },
        required: ['purpose', 'task', 'why'],
      },
    },
    {
      name: 'tnai_subagents',
      description:
        'List your sub-agents (current and earlier): id, name, purpose, state, whether the user kept them, and reports.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'tnai_wait',
      description:
        'Wait until one of your working sub-agents finishes (or the timeout passes) and return the finished reports. Do your own part of the work first.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Sub-agent ids to wait for (default: all working ones).',
          },
          timeout_seconds: { type: 'number', description: 'Up to ' + WAIT_MAX + '.' },
        },
      },
    },
    {
      name: 'tnai_assign',
      description:
        "Give a follow-up task to a specific idle sub-agent of yours (by id). It keeps its earlier context. Use tnai_delegate instead when you don't need that specific one.",
      inputSchema: {
        type: 'object',
        properties: {
          id: str('Sub-agent id (from tnai_subagents).'),
          task: str('The follow-up task.'),
        },
        required: ['id', 'task'],
      },
    },
  ];
}

async function call(paneId, name, args = {}, signal = null) {
  // The chain of turns a message from an agent on another computer started (remote-say.js): no
  // delegation tool works in it. Asked first, before anything is looked up; a
  // rule that cannot be asked counts as such a chain.
  let far = true;
  try {
    far = sayTurn(paneId) !== false;
  } catch {
    far = true;
  }
  if (far)
    return fail(
      'This task came from an agent on another computer, so sub-agents are not available in it. Answer in your final message: it goes back by itself.',
      'refused',
      'answer in your final message'
    );
  const parent = nodeOf(paneId);
  if (!parent)
    return fail(
      'This session is not a custom agent, so it has no Technically Not sub-agents. Do the work yourself.',
      'refused',
      'do the work yourself'
    );
  busy.add(paneId);
  armClose(parent.id);
  if (name === 'tnai_delegate') return delegate(parent, args);
  if (name === 'tnai_subagents') return ok(list(parent));
  if (name === 'tnai_wait') return wait(parent, args, signal);
  if (name === 'tnai_assign') return assign(parent, args);
  return fail(
    'Unknown tool ' + name,
    'invalid',
    'tnai_delegate, tnai_assign, tnai_subagents or tnai_wait'
  );
}
const ok = text => ({ content: [{ type: 'text', text }] });

// A refused call: the sentence, then the code line (agent-errors.js) with the step that fixes it.
const fail = (text, code, hint) => errors.toolFail(text, code, hint);

function list(parent) {
  const kids = family(parent.parentKey).filter(k => !k.archived);
  if (!kids.length) return 'No sub-agents.';
  return kids
    .map(
      k =>
        `- ${label(k)} (id ${k.id.slice(0, 8)}): ${k.purpose} · ${stateOf(k)}${k.persistent ? ' · kept by the user' : ''}${k.report && k.parentId === parent.id ? '\n  Report: ' + clip(k.report, 1500) : ''}`
    )
    .join('\n');
}

// Instances are addressed by id; a name only when it is unambiguous (names can repeat across
// instances).
function findChild(parent, key) {
  key = String(key || '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  const kids = family(parent.parentKey);
  const named = kids.filter(k => alive(k) && label(k).toLowerCase() === key);
  if (named.length === 1) return named[0];

  // a short word is a name, never an id prefix (same rule as the mesh's find)
  if (key.length < 6) return null;
  const byId = kids.filter(
    k => k.id.startsWith(key) || (k.paneId && lifecycle.instanceOf(k.paneId).startsWith(key))
  ); // or its id in `tnai agents`
  return byId.length === 1 ? byId[0] : null;
}

// A sub-agent by the id tnai_delegate, tnai_subagents and tnai_wait give (its graph id, or 6+ of
// its first characters): its panel and conversation, or null. The mesh turns it into the id
// `tnai agents` lists, so `tnai send | ask | read | close` reach the helper by either id
// (agent-mesh.js helperIds; learned 2026-10-28: leads were given an id those commands refused).
function nodeById(key) {
  key = String(key || '')
    .trim()
    .toLowerCase();
  if (key.length < 6) return null;
  const hits = [...nodes.values()].filter(n => !n.root && n.id.startsWith(key));
  if (hits.length !== 1) return null;
  return { paneId: hits[0].paneId || '', sessionId: hits[0].sessionId || '' };
}

// The checks every delegation passes. Anything refused tells the agent why and what to do instead.
function refuse(parent, purpose, task, why, agent = 'Claude Code') {
  if (purpose.length < 3 || task.length < 20)
    return {
      code: 'invalid',
      hint: 'tnai_delegate with a purpose and a task the sub-agent can do without asking',
      text: 'Refused: give the sub-agent a clear purpose and a self-contained task.',
    };
  if (why.length < 15)
    return {
      code: 'invalid',
      hint: 'tnai_delegate with why (a sentence), or do it yourself',
      text: "Refused: explain why delegating beats doing it yourself. If it doesn't, keep working on it yourself.",
    };
  if (parent.depth + 1 > settings.maxDepth)
    return {
      code: 'full',
      hint: 'do this part yourself',
      text:
        "Refused: the user's delegation depth limit (" +
        settings.maxDepth +
        ') is reached. Do this part yourself.',
    };
  const text = purpose + ' ' + task;
  const same = [...nodes.values()].find(
    n =>
      n.id !== parent.id &&
      ACTIVE.has(n.status) &&
      cliOf(n) === agent &&
      overlap(text, n.purpose + ' ' + n.task) >= DUPLICATE
  );
  if (same)
    return {
      code: 'busy',
      hint: 'tnai_wait for its report',
      text:
        'Refused: ' +
        label(same) +
        ' is already working on the same task ("' +
        clip(same.purpose, 80) +
        '"). Don\'t duplicate it; wait for its report.',
    };
  return null;
}

function limit(parent) {
  const active = [...nodes.values()].filter(n => !n.root && ACTIVE.has(n.status));
  if (
    settings.maxActivePerAgent > 0 &&
    active.filter(n => n.parentId === parent.id).length >= settings.maxActivePerAgent
  )
    return {
      code: 'full',
      hint: 'tnai_wait for one, or do it yourself',
      text:
        'Refused: you already have ' +
        settings.maxActivePerAgent +
        " working sub-agents (the user's limit). Wait for one (tnai_wait) or do it yourself.",
    };
  if (settings.maxActiveTotal > 0 && active.length >= settings.maxActiveTotal)
    return {
      code: 'full',
      hint: 'do it yourself, or tnai_wait',
      text:
        'Refused: ' +
        settings.maxActiveTotal +
        " sub-agents are already working in Technically Not (the user's limit). Do it yourself or wait.",
    };
  return null;
}

// `tnai new` (agent-mesh.js) is held to the same limits: a
// new agent is a root with its own full allowance, so a sub-agent could step around the depth limit
// with it and one prompt could open agent after agent on the user's usage. Never from a sub-agent's
// panel, and no more agents started this way open at once than sub-agents may work in total (0 = no
// limit). open: how many agents started with `tnai new` have an open panel or are starting
// (agent-lifecycle.js startedOpen).
function refuseNew(paneId, open) {
  const n = nodeOf(paneId);
  if (n && !n.root)
    return 'Refused: a sub-agent does not start new agents. Do the work yourself, or say in your report what else is needed.';
  if (settings.maxActiveTotal > 0 && open >= settings.maxActiveTotal)
    return (
      'Refused: ' +
      open +
      " agents started with `tnai new` are already open (the user's limit is " +
      settings.maxActiveTotal +
      ', the same as for sub-agents working in total). ' +
      'Reuse one with `tnai send NAME`, or close one that is done with `tnai close NAME`.'
    );
  return '';
}

// Reuse, revive, clone, recycle or create. Kept (user-owned) and suspended instances are never
// picked automatically. Only instances and identities of the same CLI are candidates (a Codex job
// never lands in a Claude Code conversation). An instance keeps the folder it started in, so only
// instances asked for with the same `worktree` choice are reused or revived.
function decide(parent, text, agent, worktree = 'inherit') {
  const mine = family(parent.parentKey).filter(
    k =>
      !k.persistent && !k.archived && cliOf(k) === agent && (k.worktree || 'inherit') === worktree
  );

  // The task quotes a sub-agent's report: the work came from that sub-agent, so it takes it (reused
  // when idle, revived when hidden).
  const source = mine
    .filter(k => k.report && lifecycle.quotes(text, k.report))
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))[0];
  if (source?.paneId && source.status === 'done') return { action: 'reuse', instance: source };
  if (
    source &&
    revivable(source) &&
    ![...nodes.values()].some(n => n.identityId === source.identityId && alive(n))
  )
    return { action: 'revive', instance: source };
  const score = k => relevance(identities.get(k.identityId), text);
  const best = list =>
    list
      .map(k => [k, score(k)])
      .filter(([, s]) => s >= RELATED)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
  const idle = best(mine.filter(k => k.paneId && k.status === 'done'));
  if (idle) return { action: 'reuse', instance: idle };
  const hidden = best(mine.filter(revivable));
  if (hidden && ![...nodes.values()].some(n => n.identityId === hidden.identityId && alive(n)))
    return { action: 'revive', instance: hidden };
  const related = [...identities.values()]
    .filter(i => i.parentKey === parent.parentKey && !i.archived && cliOf(i) === agent)
    .map(i => [i, relevance(i, text)])
    .filter(([, s]) => s >= RELATED)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (related) return { action: 'clone', identity: related };
  const free = [...identities.values()]
    .filter(
      i =>
        i.parentKey === parent.parentKey &&
        !i.archived &&
        cliOf(i) === agent &&
        ![...nodes.values()].some(n => n.identityId === i.id && (alive(n) || n.persistent))
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
  if (free) return { action: 'recycle', identity: free };
  return { action: 'create' };
}

async function delegate(
  parent,
  {
    purpose = '',
    task = '',
    why = '',
    agent = '',
    worktree = '',
    model = '',
    effort = '',
    name = '',
  }
) {
  purpose = clip(purpose, 120);
  task = String(task || '').trim();
  why = String(why || '').trim();
  name = clip(
    String(name || '')
      .replace(/\s+/g, ' ')
      .trim(),
    40
  ); // the user's own name for it: shown exactly, never replaced by a picked one
  agent = CLIS.find(
    c =>
      c.toLowerCase() ===
      String(agent || 'Claude Code')
        .trim()
        .toLowerCase()
  );
  if (!agent)
    return fail(
      'Refused: agent must be one of ' + CLIS.join(', ') + '.',
      'invalid',
      'agent: ' + CLIS.join(' | ')
    );
  worktree = String(worktree || 'inherit')
    .trim()
    .toLowerCase();
  if (!WORKTREE.includes(worktree))
    return fail(
      'Refused: worktree must be one of ' + WORKTREE.join(', ') + '.',
      'invalid',
      'worktree: ' + WORKTREE.join(' | ')
    );
  const refused = refuse(parent, purpose, task, why, agent);
  if (refused) return fail(refused.text, refused.code, refused.hint);

  // model / effort: only names from that CLI's own list (model-pick.js). A picked model needs a
  // fresh conversation, so an idle or earlier sub-agent is not reused or revived for it: its
  // identity gets a fresh copy instead (clone).
  const pick =
    model || effort
      ? await require('./model-pick').resolve(
          agent,
          String(model || '').slice(0, 120),
          String(effort || '').slice(0, 40)
        )
      : { model: '', effort: '', label: '' };
  if (pick.error)
    return fail(
      'Refused: ' + pick.error,
      'invalid',
      'call it again with a model and effort from that list, or without them'
    );

  // The wait for the model list let a second delegate of the same task in: ask again.
  if (model || effort) {
    const refusedNow = refuse(parent, purpose, task, why, agent);

    if (refusedNow) return fail(refusedNow.text, refusedNow.code, refusedNow.hint);
  }

  let plan = decide(parent, purpose + ' ' + task, agent, worktree);
  if (pick.label && (plan.action === 'reuse' || plan.action === 'revive'))
    plan = { action: 'clone', identity: identities.get(plan.instance.identityId) };

  // A name the user chose: the plan's sub-agent only when it already has that name; else this
  // parent's earlier one of that name (a fresh copy, same name), else a new one. A differently
  // named sub-agent never takes the task under its own name.
  if (name) {
    const same = x => String(x || '').toLowerCase() === name.toLowerCase();
    const planned = plan.identity || identities.get(plan.instance?.identityId);
    if (!planned || !same(planned.name)) {
      const named = [...identities.values()].find(
        i => i.parentKey === parent.parentKey && !i.archived && same(i.name)
      );
      plan = named ? { action: 'clone', identity: named } : { action: 'create' };
    }
  }
  if (plan.action === 'reuse') {
    const k = plan.instance;
    const capped = limit(parent);
    if (capped) return fail(capped.text, capped.code, capped.hint);
    give(k, parent, purpose, task, why);
    deliver(
      k.paneId,
      '[TN.ai] New task from ' + parent.name + ' (related to your earlier work): ' + task
    );
    publish();
    return ok(
      `Gave it to your idle sub-agent ${label(k)} (id ${k.id.slice(0, 8)}), which already worked on related things ("${clip(identities.get(k.identityId)?.history.at(-2)?.purpose || '', 80)}"). It reports back to you automatically.` +
        teamLine(parent)
    );
  }
  const limited = limit(parent);
  if (limited) return fail(limited.text, limited.code, limited.hint);
  let identity = plan.identity || identities.get(plan.instance?.identityId);
  if (!identity) {
    identity = {
      id: crypto.randomUUID(),
      parentKey: parent.parentKey,
      agent,
      name,
      role: purpose,
      history: [],
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      archived: false,
      instances: 0,
    };
    identities.set(identity.id, identity);
  }
  let n;
  if (plan.action === 'revive') {
    n = plan.instance;
    n.status = 'starting';
    n.paneId = '';
    n.parentId = parent.id;
  } else {
    identity.instances = (identity.instances || 0) + 1;
    n = {
      id: crypto.randomUUID(),
      identityId: identity.id,
      instance: identity.instances,
      paneId: '',
      parentId: parent.id,
      parentKey: parent.parentKey,
      customAgentId: '',
      agent,
      name: identity.name || 'Sub-agent',
      status: 'starting',
      persistent: false,
      depth: parent.depth + 1,
      sessionId: '',
      createdAt: Date.now(),
    };
    nodes.set(n.id, n);
  }
  give(n, parent, purpose, task, why);
  n.plan = plan.action;
  n.status = 'starting';
  n.worktree = worktree;

  // main.js resolves the folder at pty:start (attach) and reports the branch back (setLane)
  n.lane = '';
  publish();

  // The window opens the pane (in the parent's terminal workspace) and starts its CLI with
  // `subagentOf` (main.js → attach); a revived one resumes its conversation. Answered when its CLI
  // started (started), or not (notStarted / exited); the timer covers only the pane opening (attach
  // resets it, main.js may be waiting on the user's folder-trust answer).
  const paneId = await openPanel(n, parent, {
    agent,
    purpose,
    name: identity.name || '',
    resumeId: plan.action === 'revive' ? n.sessionId : '',
    model: pick.model,
    effort: pick.effort,
  });
  if (!paneId)
    return fail(
      n.report || 'Not started.',
      'unreachable',
      'do this part yourself (tnai_subagents shows why it did not start)'
    );

  // Still starting after START_WAIT (e.g. the user hasn't answered the folder-trust dialog yet):
  // tnai_wait gets its report, or why it never started.
  if (n.pendingStart)
    return ok(
      `${label(n)} (${agent}, id ${n.id.slice(0, 8)}) is still starting for "${purpose}" (Technically Not may be asking the user to allow ${agent} in this folder). Keep working on your own part; tnai_wait returns its report, or why it did not start.`
    );
  const how = {
    revive: 'Revived your earlier sub-agent',
    clone: 'Started a fresh copy of your sub-agent',
    recycle:
      'Reused your sub-agent identity (fresh context, nothing carried over from its old job):',
    create: 'Started a new sub-agent',
  }[plan.action];
  return ok(
    `${how} ${label(n)} (${agent}${pick.label ? ' on ' + pick.label : ''}, id ${n.id.slice(0, 8)}) in its own panel for "${purpose}". It gets the task once it is ready and reports back to you automatically. Keep working on your own part; call tnai_wait when you need its result.` +
      teamLine(parent)
  );
}

// Asks the window for the instance's panel and waits until its CLI started there: the panel id, or
// '' with the instance marked failed (delegate, resend).
async function openPanel(n, parent, request) {
  const paneId = await new Promise(resolve => {
    const s = { resolve };
    spawning.set(n.id, s);
    send('graph:spawn', { nodeId: n.id, parentPaneId: parent.paneId, ...request });
    s.timer = setTimeout(() => launched(n, null), SPAWN_TIMEOUT);
  });
  if (paneId) return paneId;

  // No answer from the window (spawnFailed / notStarted give the real reason when there is one):
  // say only what is known.
  if (ACTIVE.has(n.status)) {
    n.status = 'failed';
    n.report =
      'Not started: Technically Not could not open a panel for it (the window did not answer within ' +
      SPAWN_TIMEOUT / 1000 +
      ' s). Do this part yourself.';
  }
  n.doneAt = Date.now();
  n.reported = true;
  publish();
  return '';
}

// `tnai send` from a parent to its own finished sub-agent (agent-mesh.js) is more work from the
// parent, not the user typing in the sub-agent's panel: the sub-agent's next prompt counts as its
// parent's, so the result goes back to the parent like a delegated task's. `on` false takes the
// mark back (the message was not delivered). True when the panel is that parent's sub-agent.
function sentByParent(parentPaneId, paneId, on = true) {
  const parent = nodeOf(parentPaneId),
    k = nodeOf(paneId);
  if (!parent || !k || k.root || k.parentId !== parent.id) return false;
  k.fromParent = !!on;
  return true;
}

// `tnai send` from a parent to its own sub-agent whose panel was closed (agent-mesh.js): it comes
// back as that parent's sub-agent, with the message as its task, so its result returns to the
// parent. Reopened as any other agent's conversation it would belong to nobody and report to
// nobody. null when the name is not a closed sub-agent of this parent (the caller revives it the
// general way); else a promise of { ok, error }.
function resend(parentPaneId, name, text) {
  const parent = nodeOf(parentPaneId),
    key = String(name || '')
      .trim()
      .toLowerCase();
  if (!parent || !key) return null;
  const k = family(parent.parentKey)
    .filter(
      x =>
        revivable(x) &&
        !x.persistent &&
        !x.archived &&
        (label(x).toLowerCase() === key || String(x.name || '').toLowerCase() === key)
    )
    .sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0))[0];
  if (!k || [...nodes.values()].some(n => n.identityId === k.identityId && alive(n))) return null;
  const capped = limit(parent);
  if (capped) return Promise.resolve(errors.fail(capped.code, capped.text, capped.hint));
  give(k, parent, k.purpose, String(text || '').trim(), 'follow-up');
  Object.assign(k, { plan: 'revive', status: 'starting', paneId: '', lane: '' });
  publish();
  return openPanel(k, parent, {
    agent: cliOf(k),
    purpose: k.purpose,
    name: identities.get(k.identityId)?.name || '',
    resumeId: k.sessionId,
    model: '',
    effort: '',
  }).then(paneId => (paneId ? { ok: true } : { ok: false, error: k.report || 'Not started.' }));
}

// A task given to an instance: recorded on it and in its identity's history.
function give(n, parent, purpose, task, why) {
  cancelClose(n);
  Object.assign(n, {
    purpose,
    task,
    why: clip(why, 400),
    status: n.paneId ? 'working' : 'starting',
    report: '',
    reported: false,
    doneAt: 0,
    parentId: parent.id,
    fromParent: false,
  });
  const i = identities.get(n.identityId);
  if (i) {
    i.lastUsedAt = Date.now();
    i.archived = false;
    i.history.push({
      purpose,
      task: clip(task, 300),
      status: 'working',
      at: Date.now(),
      instanceId: n.id,
    });
    i.history.splice(0, Math.max(0, i.history.length - HISTORY));
  }
}

async function assign(parent, { id, task = '' }) {
  const k = findChild(parent, id);
  if (!k)
    return fail(
      'No single sub-agent matches "' + id + '"; use its id. Your sub-agents:\n' + list(parent),
      'not_found',
      'tnai_assign with an id from the list above'
    );
  if (!alive(k))
    return fail(
      label(k) +
        ' is ' +
        stateOf(k) +
        '. Use tnai_delegate; Technically Not revives it when the work is related.',
      'refused',
      'tnai_delegate'
    );
  if (ACTIVE.has(k.status))
    return fail(
      label(k) +
        ' is still working. Wait for it (tnai_wait), or tnai_delegate for a separate copy.',
      'busy',
      'tnai_wait'
    );
  if (String(task).trim().length < 10)
    return fail(
      'Give it a clear follow-up task.',
      'invalid',
      'tnai_assign with a task of a sentence or more'
    );
  give(k, parent, k.purpose, String(task).trim(), 'follow-up');
  deliver(k.paneId, '[TN.ai] Follow-up from ' + parent.name + ': ' + k.task);
  publish();
  return ok(label(k) + ' has the follow-up. It reports back to you when done.');
}

function wait(parent, { ids, timeout_seconds }, signal = null) {
  const working = () => children(parent.id).filter(k => ACTIVE.has(k.status));
  const wanted =
    Array.isArray(ids) && ids.length
      ? ids
          .map(i => findChild(parent, i))
          .filter(Boolean)
          .map(k => k.id)
      : working().map(k => k.id);
  const finished = () =>
    children(parent.id).filter(k => wanted.includes(k.id) && !ACTIVE.has(k.status) && !k.reported);
  const collect = () => {
    const done = finished();
    done.forEach(k => {
      k.reported = true;
    });

    // The parent has these reports now: their panels close after the grace period.
    if (done.length) armClose(parent.id);
    return done;
  };
  const still = () => 'Still working: ' + (working().map(label).join(', ') || 'none') + '.';
  const answer = done =>
    ok(
      done.length
        ? done.map(reportText).join('\n\n') + '\n\n' + still()
        : 'No sub-agent finished yet. ' + still() + ' Call tnai_wait again to keep waiting.'
    );
  if (!wanted.length) return ok('None of your sub-agents is working.');
  if (finished().length) return answer(collect());
  const seconds = Math.max(5, Math.min(WAIT_MAX, Number(timeout_seconds) || WAIT_MAX));
  return new Promise(resolve => {
    const w = {
      parentId: parent.id,
      ids: wanted,
      resolve: () => {
        clearTimeout(w.timer);
        waiters.delete(w);
        resolve(answer(collect()));
        publish();
      },
    };
    w.timer = setTimeout(w.resolve, seconds * 1000);

    // The agent's MCP client gave up on this call (agent-hooks.js): the wait ends without taking
    // any report, so a sub-agent that finishes later reaches it as a message (flush) instead of an
    // answer nobody reads.
    const cancel = () => {
      clearTimeout(w.timer);
      if (waiters.delete(w)) {
        resolve(fail('Cancelled.', 'busy', 'tnai_wait again'));
        publish();
        flush(parent.paneId);
      }
    };
    waiters.add(w);
    publish(); // the parent's inWait goes out to the window now (pushed, not polled)
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}
const reportText = k =>
  `Sub-agent ${label(k)} (id ${k.id.slice(0, 8)}) ${k.status === 'done' ? 'finished' : k.status} "${k.purpose}":\n${clip(k.report || '(no report)', REPORT_MAX)}`;

// ---------- Instance lifecycle ----------
// The window has opened the instance's pane and is starting Claude Code in it (pty:start with
// subagentOf).
function attach(nodeId, paneId, name) {
  const n = nodes.get(nodeId);
  if (!n || n.paneId || n.status !== 'starting') return null;
  const identity = identities.get(n.identityId);
  n.paneId = paneId;
  byPane.set(paneId, n.id);
  if (identity && !identity.name && name) identity.name = name;
  n.name = identity?.name || name || n.name;

  // The pane is open; main.js may now wait on the user (folder trust). After START_WAIT
  // tnai_delegate answers "still starting".
  const s = spawning.get(nodeId);
  if (s) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      n.pendingStart = true;
      launched(n, paneId);
    }, START_WAIT);
  }

  // screen output counts from the start (readyByScreen)
  if (cliOf(n) !== 'Claude Code') drawn.set(paneId, 0);
  publish();
  const parent = nodes.get(n.parentId);

  // Earlier jobs of this identity are listed by name only (never their content) so a new instance
  // knows its role without old context leaking in.
  const past =
    identity?.history
      .slice(0, -1)
      .map(h => h.purpose)
      .filter(Boolean)
      .slice(-5) || [];
  const intro = [
    `You are "${label(n)}", a sub-agent that ${parent?.name || 'an agent'} started in Technically Not. Current job: ${n.purpose}.`,
    past.length && n.plan !== 'revive'
      ? 'Earlier jobs of this role (for orientation only; their details are not part of this job): ' +
        past.join('; ') +
        '.'
      : '',
    'Work only on the current job. When you are done, end with a short report for ' +
      (parent?.name || 'your parent') +
      ': what you did, files changed, what you verified and what you did not. Technically Not hands your final message to it automatically.',
    n.depth >= settings.maxDepth
      ? 'Do not start other agents or sub-agents; do the work yourself.'
      : 'Start a sub-agent (tnai_delegate) only for a clearly separate part of a large job that can run in parallel; do small jobs yourself.',
    'You may be given further tasks later. Treat each "[TN.ai] New task" as its own job; carry over only what is relevant to it.',
  ]
    .filter(Boolean)
    .join('\n');

  // main.js picks its folder: the lead's worktree, its own, or the project folder
  const where = { worktree: n.worktree || 'inherit', parentPaneId: parent?.paneId || '' };
  if (cliOf(n) === 'Claude Code')
    return { appendPrompt: intro, lead: parent?.name || '', ...where };

  // Other CLIs get no system-prompt addition and no MCP ready signal: the intro goes in front of
  // the first task, sent once the screen settles.
  n.intro = n.plan === 'revive' ? '' : intro;
  return { appendPrompt: '', lead: parent?.name || '', ...where };
}

// main.js started a graph pane: the worktree branch it runs in ('' = the project folder), for the
// tree's lane.
function setLane(paneId, branch) {
  const n = nodeOf(paneId);
  if (!n || (n.lane || '') === (branch || '')) return;
  n.lane = branch || '';
  save();
  publish();
}

// A non-Claude CLI is ready once it has drawn its screen and then stayed quiet for QUIET_MS
// (output(), fed by pty:data). Before anything is drawn it looks every 500 ms; once something is,
// it sleeps until the moment that quiet would be over, so the task goes the moment the rule is met
// instead of up to 500 ms later. The rule itself is unchanged.
async function readyByScreen(n, paneId) {
  if (!drawn.has(paneId)) drawn.set(paneId, 0);
  const until = Date.now() + READY_TIMEOUT;
  while (Date.now() < until && n.paneId === paneId && n.status === 'starting') {
    const drawnAt = drawn.get(paneId);
    const untilQuiet = drawnAt ? drawnAt + QUIET_MS + 1 - Date.now() : 500;
    await sleep(Math.min(500, Math.max(1, untilQuiet)));
    const last = drawn.get(paneId);
    if (last && Date.now() - last > QUIET_MS) break;
  }
  drawn.delete(paneId);
  if (n.paneId === paneId && n.status === 'starting')
    onEvent(paneId, { kind: 'ready', source: 'screen' });
}

function output(batch) {
  for (const d of batch || []) if (drawn.has(d.paneId)) drawn.set(d.paneId, Date.now());
}

// agent-turns.js: a non-Claude agent's task started or ended (Codex rollout), the same events
// Claude Code's hooks give: a sub-agent's report, or a lead going busy / idle (reports wait for its
// idle).
const turnEnds = new Map(); // paneId -> startedAt of the last turn already reported

function onTurn(t) {
  spend(t);
  const n = t?.paneId && nodeOf(t.paneId);
  if (!n || cliOf(n) === 'Claude Code' || t.cleared || !t.startedAt) return;

  // OpenCode only: a task that ended on an error and works again by itself (its own retry,
  // agent-turns.js) is the same job, not a follow-up the user typed: it counts as working again and
  // its real end is reported too.
  if (!t.endedAt && cliOf(n) === 'OpenCode' && turnEnds.get(t.paneId) === t.startedAt) {
    turnEnds.delete(t.paneId);
    busy.add(t.paneId);
    armClose(n.id);
    if (!n.root && n.status === 'done') {
      cancelClose(n);
      Object.assign(n, { status: 'working', report: '', reported: false, doneAt: 0 });
      publish();
    }
    return;
  }
  if (!t.endedAt) return onEvent(t.paneId, { kind: 'prompt' });
  if (turnEnds.get(t.paneId) === t.startedAt) return;
  turnEnds.set(t.paneId, t.startedAt);
  onEvent(t.paneId, { kind: 'stop', text: t.result || openCodeFailure(n, t) });
}

// OpenCode only: a task that ended without an answer because of an error or an interrupt says so in
// its report (the reason is OpenCode's own error message, agent-turns.js), instead of an empty one
// its lead cannot tell from "nothing to say".
function openCodeFailure(n, t) {
  if (cliOf(n) !== 'OpenCode' || (t.endedBy !== 'error' && t.endedBy !== 'interrupted')) return '';
  return t.endedBy === 'interrupted'
    ? 'OpenCode was interrupted before it finished this job and reported nothing. Ask it to go on, or do this part yourself.'
    : 'OpenCode stopped on an error before it finished this job and reported nothing' +
        (t.error ? ': ' + clip(t.error, 300) : '.') +
        (t.error && !/[.!?]$/.test(t.error) ? '.' : '') +
        ' Delegate it again, or do this part yourself.';
}

// pty:start returned: the conversation id this instance runs under (what a later revive resumes).
// main.js started its CLI: the waiting tnai_delegate answers, and the ready wait begins (not
// earlier: the user may have been asked about folder trust first).
function started(paneId, sessionId) {
  const n = nodeOf(paneId);
  if (!n || n.root) return;
  if (sessionId) {
    n.sessionId = sessionId;
    save();
  }
  if (n.status !== 'starting') return;
  delete n.pendingStart;
  launched(n, paneId);
  setTimeout(() => {
    if (n.status === 'starting' && n.paneId === paneId) {
      n.status = 'failed';
      n.report = cliOf(n) + ' did not become ready in its panel.';
      settle(n);
    }
  }, READY_TIMEOUT);
  if (cliOf(n) !== 'Claude Code') readyByScreen(n, paneId);
}

// main.js refused or failed its start after attach (e.g. the user didn't allow the CLI in the
// folder). The pane stays (it shows the error) but is no longer this sub-agent's.
function notStarted(paneId, message) {
  const n = nodeOf(paneId);
  if (!n || n.root || !ACTIVE.has(n.status)) return;
  n.status = 'failed';
  n.report =
    'Not started: ' +
    String(message || 'its CLI did not start.').replace(/\.?$/, '.') +
    ' Do this part yourself.';
  n.paneId = '';
  byPane.delete(paneId);
  drawn.delete(paneId);
  if (spawning.has(n.id)) {
    n.doneAt = Date.now();
    n.reported = true;
    launched(n, null);
    publish();
  } else {
    delete n.pendingStart;
    settle(n);
  }
}

// The window could not open or start the instance's panel (43 spawn): its real reason (not signed
// in, workspace full, not installed, the CLI's start error) goes to the waiting tnai_delegate.
function spawnFailed(nodeId, reason) {
  const n = nodes.get(String(nodeId || ''));
  if (!n || !spawning.has(n.id)) return;
  const why =
    String(reason || '')
      .trim()
      .replace(/\.+$/, '') || 'its panel could not be opened';
  if (n.paneId) return notStarted(n.paneId, why);
  if (ACTIVE.has(n.status)) {
    n.status = 'failed';
    n.report = 'Not started: ' + why + '. Do this part yourself.';
  }
  n.doneAt = Date.now();
  n.reported = true;
  launched(n, null);
  publish();
}

function launched(n, paneId) {
  const s = spawning.get(n.id);
  if (!s) return;
  clearTimeout(s.timer);
  spawning.delete(n.id);
  s.resolve(paneId);
}

// From agent-hooks: every Claude Code hook event and MCP ready signal, for any pane.
function onEvent(paneId, e) {
  if (e.kind === 'prompt') busy.add(paneId);
  const n = nodeOf(paneId);
  if (e.kind === 'prompt' && n) armClose(n.id); // a new turn: its finished sub-agents stay
  if (e.kind === 'ready' && n?.status === 'starting' && !n.root) {
    n.status = 'working';
    const intro = n.intro ? n.intro + '\n\n' : '';
    n.intro = '';
    deliver(
      paneId,
      intro +
        (n.plan === 'revive' ? '[TN.ai] Revived for a related task from ' : '[TN.ai] Task from ') +
        (nodes.get(n.parentId)?.name || 'your parent') +
        ': ' +
        n.task,
      n
    );
    publish();
  }
  if (e.kind === 'prompt' && n && !n.root && n.status === 'done') {
    cancelClose(n);
    n.status = 'working';

    // The user typed a follow-up in its pane: that result is the user's. A message its parent sent
    // it (sentByParent) is the parent's work: its result is reported like a task's.
    n.byUser = !n.fromParent;
    if (n.fromParent)
      Object.assign(n, { fromParent: false, report: '', reported: false, doneAt: 0 });
    publish();
  }
  if (e.kind !== 'stop') return;
  busy.delete(paneId);
  if (n && !n.root && n.status === 'working') {
    n.report = clip(e.text, REPORT_MAX);
    n.status = 'done';
    settle(n);
  }
  flush(paneId);
  if (n) armClose(n.id);
}

// An instance finished (or failed): its report goes to its parent. It closes after the grace period
// once its parent's own task is over (armClose), unless the user keeps it.
function settle(n) {
  n.doneAt = Date.now();
  const h = identities.get(n.identityId)?.history.findLast(x => x.instanceId === n.id);
  if (h) {
    h.status = n.status;
    h.report = clip(n.report, 300);
  }
  const byUser = n.byUser;
  n.byUser = false;
  if (!byUser) {
    const waiting = [...waiters].find(w => w.parentId === n.parentId && w.ids.includes(n.id));
    if (waiting) waiting.resolve();
    else flush(nodes.get(n.parentId)?.paneId); // not waiting: typed into the parent once it is idle
  } else n.reported = true;
  armClose(n.parentId);
  publish();
}

// A finished sub-agent closes after the grace period once its report is kept, also while the
// parent keeps working: a lead that cycles many sub-agents would otherwise collect every finished
// panel until its whole task ends. The report is kept on the node (`report`) and still reaches the
// parent at its next idle moment (flush leaves out only working ones, and a hidden node keeps its
// report), so the panel is not needed for it (user 2026-10-28: "Make sure your agents know to close
// if they're done and no longer needed so they don't idle for no reason"; before, one whose report
// had not reached a busy parent stayed open until the parent's whole turn ended). A parent at rest
// or whose pane is gone closes them too. A closed sub-agent stays revivable for related work.
function armClose(parentId) {
  const parent = nodes.get(parentId);
  const rest =
    !parent?.paneId ||
    (!busy.has(parent.paneId) && !children(parentId).some(k => ACTIVE.has(k.status)));
  let changed = false;
  for (const k of children(parentId)) {
    const due = rest || !!k.reported || !!k.report;
    if (k.persistent || !k.paneId || k.status !== 'done' || due === !!k.closesAt) continue;
    if (due) scheduleClose(k);
    else cancelClose(k);
    changed = true;
  }
  if (changed) publish();
}

// Reports the parent hasn't received yet go in as one message, only while it is idle (a busy parent
// gets them after its Stop).
function flush(parentPaneId) {
  const parent = parentPaneId && nodeOf(parentPaneId);
  if (!parent || busy.has(parentPaneId)) return;
  const due = children(parent.id).filter(k => !ACTIVE.has(k.status) && !k.reported && k.report);
  if (!due.length) return;
  due.forEach(k => {
    k.reported = true;
  });

  // Not delivered: the reports count as unsent again, so the parent's next flush (its next Stop,
  // another sub-agent's end, or a revive) sends them.
  const lost = () => {
    due.forEach(k => {
      k.reported = false;
    });
    busy.delete(parentPaneId);
    armClose(parent.id);
  };

  deliver(parentPaneId, '[TN.ai] ' + due.map(reportText).join('\n\n'), null, lost);
  busy.add(parentPaneId);
  armClose(parent.id);
}

function scheduleClose(n) {
  cancelClose(n);
  n.closesAt = Date.now() + settings.graceSeconds * 1000;
  const t = setTimeout(() => hide(n), settings.graceSeconds * 1000);
  t.unref?.();
  timers.set(n.id, t);
}

function cancelClose(n) {
  clearTimeout(timers.get(n.id));
  timers.delete(n.id);
  n.closesAt = 0;
}

// Hidden: the process stops and the pane closes, but the identity, history and conversation stay
// for a later revive.
function hide(n) {
  cancelClose(n);
  if (n.persistent || ACTIVE.has(n.status) || !n.paneId) return publish();
  const paneId = n.paneId;
  n.status = 'hidden';
  n.paneId = '';
  byPane.delete(paneId);
  ptys?.stop(paneId);
  send('graph:close', { nodeId: n.id, paneId });
  dropOrphanRoot(n);
  publish();
}

// A pane's process ended. A root's sub-agents that the user didn't keep end with it (hidden, or
// suspended mid-task); kept ones stay.
function exited(paneId) {
  const n = nodeOf(paneId);
  if (!n) return;
  busy.delete(paneId);
  if (!n.root) {
    if (spawning.has(n.id)) {
      n.status = 'stopped';
      n.report = 'Not started: its panel was closed before its CLI started. Do this part yourself.';
      n.doneAt = Date.now();
      n.reported = true;
      launched(n, null);
    } else if (ACTIVE.has(n.status)) {
      n.status = 'stopped';
      n.report =
        n.report ||
        (n.pendingStart
          ? 'Not started: its panel was closed before its CLI started. Do this part yourself.'
          : 'Its process ended before it reported.');
      settle(n);
    }
    cancelClose(n);
    dropOrphanRoot(n);
  } else {
    n.status = 'stopped';

    // Sub-agents whose pane is still opening never start (main.js refuses a pty:start whose attach
    // fails).
    for (const k of children(n.id))
      if (!k.persistent && !k.paneId && ACTIVE.has(k.status)) {
        k.status = 'stopped';
        k.report = k.report || 'Its parent ended before it started.';
        k.doneAt = Date.now();
      }

    // a tnai_delegate still waiting: its parent is gone
    for (const k of children(n.id)) launched(k, null);
    for (const k of children(n.id))
      if (!k.persistent && alive(k)) {
        if (ACTIVE.has(k.status)) {
          k.status = 'stopped';
          k.doneAt = Date.now();
        }
        const p = k.paneId;
        k.paneId = '';
        byPane.delete(p);
        if (k.status !== 'stopped') k.status = 'hidden';
        ptys?.stop(p);
        send('graph:close', { nodeId: k.id, paneId: p });
      }
  }
  publish();
}

// The pane itself was closed by the user: the instance is hidden (or suspended if it was mid-task);
// a root with nothing alive under it is forgotten.
function removed(paneId) {
  const n = nodeOf(paneId);
  if (!n) return;
  exited(paneId);
  byPane.delete(paneId);
  n.paneId = '';
  if (n.root) {
    if (!children(n.id).some(alive)) nodes.delete(n.id);
  } else {
    if (n.status === 'done') n.status = 'hidden';
    dropOrphanRoot(n);
  }
  publish();
}

// A root whose pane is gone was kept only for a sub-agent still alive under it: once the last one
// stops or hides, the root goes too.
function dropOrphanRoot(k) {
  const r = nodes.get(k.parentId);
  if (r?.root && !r.paneId && !children(r.id).some(alive)) nodes.delete(r.id);
}

// The user keeps (or releases) an instance. Kept: it stays open for follow-ups until the user
// closes it, and Technically Not never repurposes it.
function keep(nodeId, on = true) {
  const n = nodes.get(nodeId);
  if (!n || n.root) return state();
  n.persistent = !!on;
  if (on) cancelClose(n);
  else armClose(n.parentId);
  publish();
  return state();
}

// Task and report text comes from an LLM: prompt-submit.js drops control characters, so an ESC[201~
// inside it can't end the paste early and type the rest as keys; Enter goes only to the same
// process that got the paste. n: a sub-agent's first task; if its CLI never took it, the sub-agent
// fails and its parent is told instead of waiting forever. lost: called when the text never reached
// the panel (its process was gone, or the send threw); not when it sits unsent in its input.
function deliver(paneId, body, n, lost) {
  if (!submit || !paneId) return;

  // Never typed into the user's unsent text or while they dictate (attention-service.js
  // holdIfDraft): it waits, is never dropped, and goes straight to an empty input as before (asap).
  submit(paneId, body, { holdIfDraft: { from: 'Technically Not', asap: true, keep: true } })
    .then(r => {
      if (lost && !r?.ok && r?.state !== 'not-submitted') {
        lost();
      }

      if (!n || r?.ok || n.paneId !== paneId || n.status !== 'working') return;
      n.status = 'failed';
      n.report =
        cliOf(n) + ' did not take its task (' + (r?.error || r?.state || 'no answer') + ').';
      settle(n);
    })
    .catch(() => lost?.());
}

function setSettings(patch = {}) {
  for (const [k, [lo, hi]] of Object.entries(BOUNDS))
    if (patch[k] !== undefined && Number.isFinite(+patch[k]))
      settings[k] = Math.max(lo, Math.min(hi, Math.round(+patch[k])));
  publish();
  return state();
}

module.exports = {
  init(sender, deps) {
    send = sender;
    ptys = deps.ptys;
    submit = deps.submit;
    if (typeof deps.sayTurn === 'function') sayTurn = deps.sayTurn;
    load();
  },
  state,
  estimate,
  tools,
  call,
  sentByParent,
  resend,
  nodeById,
  onEvent,
  onTurn,
  output,
  rootStarted,
  attach,
  started,
  setLane,
  notStarted,
  spawnFailed,
  exited,
  removed,
  keep,
  setSettings,
  flushSaves,
  isNode: paneId => byPane.has(paneId),
  refuseNew,
  forgetPane: paneId => {
    turnEnds.delete(paneId);
  },
  LEADS, // CLIs that can lead (reach the tools over MCP and report their task ends)
  DEFAULTS,
};
