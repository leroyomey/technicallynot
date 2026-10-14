/*
 * Technically Not desktop · agent-loops.js — Notices when a Claude Code agent (or one of its
 * in-panel sub-agents) is stuck repeating itself, from the hook events it already sends
 * (agent-hooks.js calls `hook` for every one; no polling, no terminal reading). A loop is the same
 * tool call with the SAME input AND the SAME result, again and again: a call with a new input or a
 * new result is progress, so long real work (a browser session taking many screenshots of a
 * changing page, scrolling a long list) never counts. Exact, not inferred: it compares hashes of
 * what Claude Code reported. Only tells the window (push `agent:loop`, list `agentLoops:list`); it
 * never stops, interrupts or types into an agent. Other CLIs send no per-tool hooks, so they are
 * not watched. Logic check: node tools/desktop-check/loop-check.js
 */
'use strict';
const crypto = require('crypto');

// The tail of a turn's calls must repeat one cycle of 1–4 calls: a single call 8 times in a row, or
// a cycle of 2–4 calls 6 times over, every repeat with identical input and identical result, and
// the repeats must span at least 2 minutes. Chosen so a quick retry burst, a page re-read after an
// edit, or a poll that ends never shows; an agent really going round in circles meets it within
// minutes.
const SAME_CALL = 8,
  SAME_CYCLE = 6,
  MAX_CYCLE = 4,
  MIN_SPAN_MS = 2 * 60 * 1000;
const KEEP = SAME_CALL * MAX_CYCLE + 4; // calls remembered per agent (only the tail matters)

// Waiting and bookkeeping calls: repeating these is how an agent waits for a background task or
// keeps its list, not a loop. They are left out entirely (they neither count nor break a cycle). A
// sub-agent that outgrows a small job: one notice when it has worked this long,
// or changed this many different files, counted from its own tool calls (exact). Its lead's work is
// never counted: a lead's task has no expected size. Same push, with kind 'overrun'.
const OVER_MS = 20 * 60 * 1000,
  OVER_FILES = 10,
  EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const IGNORED =
  /^(TaskOutput|BashOutput|Monitor|TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet|TaskStop|KillShell|AskUserQuestion|Agent|Task|ToolSearch|mcp__tnai.*)$/;

let send = () => {},
  now = Date.now; // now: a clock the logic check can move

// paneId + '\n' + agentId -> { paneId, agentId, calls: [{ tool, sig, res, id, at }], loop: null |
// public loop }
const agents = new Map();
let episode = 0;

const hash = v =>
  crypto
    .createHash('sha1')
    .update(typeof v === 'string' ? v : JSON.stringify(v ?? null) || '')
    .digest('hex')
    .slice(0, 16);
const keyOf = (paneId, agentId) => paneId + '\n' + (agentId || '');
const same = (a, b) => a.sig === b.sig && a.res === b.res;

// The shortest cycle the finished tail repeats, as { period, repeats, first } (repeats: full cycles
// in the periodic tail), or null.
function cycle(done) {
  for (let p = 1; p <= MAX_CYCLE && p * 2 <= done.length; p++) {
    let n = p; // length of the tail where each call equals the one p before it
    while (n < done.length && same(done[done.length - 1 - n], done[done.length - 1 - n + p])) n++;
    const repeats = Math.floor(n / p);

    // really a single repeated call
    if (p > 1 && done.slice(-p).every(c => same(c, done[done.length - 1]))) continue;
    if (repeats >= (p === 1 ? SAME_CALL : SAME_CYCLE))
      return { period: p, repeats, first: done[done.length - repeats * p] };
  }
  return null;
}

function check(a) {
  const done = a.calls.filter(c => c.res !== null);
  const c = cycle(done),
    last = done[done.length - 1];
  if (a.loop) {
    if (!c || !last || c.period !== a.loop.period) clear(a, 'moved-on', ['loop']);
    return;
  } // one notice per loop; it ends when a call breaks the cycle
  if (!c || last.at - c.first.at < MIN_SPAN_MS) return;
  const steps = done.slice(-c.period);
  a.loop = {
    id: 'loop-' + ++episode,
    paneId: a.paneId,
    agentId: a.agentId,
    since: c.first.at,
    at: last.at,
    period: c.period,
    repeats: c.repeats,
    tools: steps.map(s => s.tool),
    browser: steps.every(s => /^mcp__claude-in-chrome__/.test(s.tool)),
    failed: steps.every(s => s.res === 'failed'),
  };
  send('agent:loop', { ...a.loop, on: true });
}

function clear(a, why, kinds = ['loop', 'over']) {
  for (const k of kinds) {
    if (!a[k]) continue;
    send('agent:loop', { id: a[k].id, paneId: a.paneId, agentId: a.agentId, on: false, why });
    a[k] = null;
  }
}

// One notice per sub-agent run, at the first call past either limit; it ends with the sub-agent or
// its lead's turn.
function checkOver(a) {
  if (a.over || a.overSaid || !a.agentId) return;
  const ms = now() - a.first,
    long = ms >= OVER_MS,
    wide = a.files.size >= OVER_FILES;
  if (!long && !wide) return;
  a.overSaid = true;
  a.over = {
    id: 'over-' + ++episode,
    kind: 'overrun',
    paneId: a.paneId,
    agentId: a.agentId,
    since: a.first,
    at: now(),
    files: a.files.size,
    long,
    wide,
  };
  send('agent:loop', { ...a.over, on: true });
}

// Every Claude Code hook payload of a pane (agent-hooks.js). A call without its PostToolUse (Claude
// Code reports a failed or denied call only as PostToolUseFailure, which Technically Not doesn't
// subscribe to) counts as failed once the next call starts.
function hook(paneId, h) {
  const event = h?.hook_event_name,
    agentId = h?.agent_id || '';
  if (event === 'UserPromptSubmit' || event === 'Stop' || event === 'StopFailure') {
    if (!(event === 'UserPromptSubmit' && /^\s*<task-notification>/.test(h.prompt || '')))
      reset(paneId);
    return;
  }
  if (event === 'SubagentStop') {
    const a = agents.get(keyOf(paneId, agentId));
    if (a) {
      clear(a, 'ended');
      agents.delete(keyOf(paneId, agentId));
    }
    return;
  }
  if (
    !/^(PreToolUse|PostToolUse|PostToolUseFailure)$/.test(event || '') ||
    IGNORED.test(h.tool_name || '')
  )
    return;
  const k = keyOf(paneId, agentId);
  let a = agents.get(k);
  if (!a)
    agents.set(
      k,
      (a = { paneId, agentId, calls: [], loop: null, over: null, first: now(), files: new Set() })
    );
  const sig = hash((h.tool_name || '') + '\0' + JSON.stringify(h.tool_input ?? {})),
    id = h.tool_use_id || '';
  if (event === 'PreToolUse') {
    const file =
      EDITS.test(h.tool_name || '') && (h.tool_input?.file_path || h.tool_input?.notebook_path);
    if (file) a.files.add(String(file));
    checkOver(a);
    for (const c of a.calls) if (c.res === null) c.res = 'failed';
    a.calls.push({ tool: h.tool_name || '', sig, res: null, id, at: now() });
    if (a.calls.length > KEEP) a.calls.splice(0, a.calls.length - KEEP);
    return check(a);
  }
  const c = [...a.calls].reverse().find(x => x.res === null && (id ? x.id === id : x.sig === sig));
  if (!c) return;
  c.res = event === 'PostToolUseFailure' ? 'failed' : hash(h.tool_response);
  check(a);
}

// A new task, the end of a turn, or the panel closing: every loop of that pane ends and its history
// starts fresh.
function reset(paneId) {
  for (const [k, a] of agents)
    if (a.paneId === paneId) {
      clear(a, 'turn');
      agents.delete(k);
    }
}

module.exports = {
  init(sender, opts = {}) {
    if (typeof sender === 'function') send = sender;
    if (typeof opts.now === 'function') now = opts.now;
  }, // a test may move only the clock: init(null, { now })
  hook,
  forget: reset,
  list: () =>
    [...agents.values()]
      .flatMap(a => [a.loop, a.over])
      .filter(Boolean)
      .map(l => ({ ...l, on: true })),
  LIMITS: { SAME_CALL, SAME_CYCLE, MAX_CYCLE, MIN_SPAN_MS, OVER_MS, OVER_FILES },
};
