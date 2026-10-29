// Technically Not desktop · agent-turns.js — Each agent session's current task (turn): when it
// started and ended, and its real token usage, read from the CLI's own files. Claude Code:
// start/stop from its hooks (agent-hooks.js), tokens from its session transcript (message.usage,
// one per message id) plus its sub-agents' transcripts. Codex: task_started / token_count /
// task_complete from its rollout file. `context` = the session's CURRENT context size { tokens, at,
// window? } from the latest request (Claude Code: last main-transcript assistant usage input +
// cache_read + cache_creation; Codex: token_count last_token_usage.input_tokens +
// model_context_window); null = unknown (no usage recorded yet), never guessed. Files are watched
// (fs.watch), never polled; changes are pushed as `agent:turn`. Other CLIs have no such source, so
// they get no turn.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const opencode = require('./opencode-store');
const cursor = require('./cursor-store');
const stalls = require('./stall-log');
const { splitPrompt } = require('./thread-log-text');

// A queued prompt as the user sees it: only their own words, without what the app wrapped around
// it for the agent ("[TN.ai]", "[New task while you work on …]", skill notes). The raw text stays
// in the queue for matching; this is for display only.
function shownText(text) {
  const words = splitPrompt(text).words;
  return words || String(text || '');
}

const CHUNK = 4 * 1024 * 1024; // bytes read per step when catching up on a file
const turns = new Map(); // paneId -> turn (internal)
const panes = new Map(); // paneId -> { agent, accountDir } from pty:start
let send = () => {};

// The task text and the agent's final answer, as the CLI recorded them (Claude Code: prompt / Stop
// hooks; Codex: user_message / task_complete).
const TASK_MAX = 400,
  RESULT_MAX = 20000;

// the whole prompt of a running turn as its CLI reported it (Claude Code, OpenCode), kept for
// promptOf only
const PROMPT_MAX = 20000;
const clip = (v, n) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > n ? s.slice(0, n) + '…' : s;
};

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function publicTurn(t) {
  return {
    paneId: t.paneId,
    agent: t.agent,
    source: t.source,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    endedBy: t.endedBy || '',
    // when the CLI's own record shows its conversation was cleared just before this task (0: not)
    clearedAt: t.clearedAt || 0,
    history: t.history === true,
    tokens: t.tokens,
    subAgents: t.subs ? [...t.subs.values()].filter(s => s.done).length : 0,
    subTokens: subTokens(t),
    subLog: subLog(t),
    task: t.task || '',
    result: t.endedAt ? t.result || '' : '',
    model: t.model || '',
    effort: t.effort || '',
    effortAt: t.effortAt || 0,
    limits: t.limits || null,
    error: t.error || '',
    plan: t.plan || null,
    context: t.context || null,
    // the last finished compact in this conversation (0: none seen)
    compactedAt: t.compactedAt || 0,
    log: t.reader?.file || t.log || '',
    queued: (queues.get(t.paneId) || []).map(q => ({ text: shownText(q.text), at: q.at })),
    steps: t.endedAt ? null : stepsOf(t.paneId),
  };
}

// ---------- Steps: the agent's own checklist, while its task runs ----------
// Claude Code: TodoWrite (the whole list each call) or TaskCreate / TaskUpdate (one item each),
// from the main agent's PostToolUse hooks (sub-agents' lists are their own). Codex: update_plan
// calls in its rollout. Exact, never guessed: shown as "step N of M" with the current step's own
// words; nothing when there is no list or every step is done. Steps differ in size, so it is not a
// percentage of time.
const checklists = new Map(); // paneId -> Map(id -> { text, status })
const STEP_MAX = 100,
  STEP_TEXT_MAX = 120;

function stepsOf(paneId) {
  const items = [...(checklists.get(paneId)?.values() || [])].filter(i => i.status !== 'deleted');
  const cur =
    items.find(i => i.status === 'in_progress') || items.find(i => i.status !== 'completed');
  if (!cur) return null;
  return {
    index: items.indexOf(cur) + 1,
    total: items.length,
    done: items.filter(i => i.status === 'completed').length,
    text: clip(cur.text, STEP_TEXT_MAX),
  };
}
const setList = (paneId, list) =>
  checklists.set(
    paneId,
    new Map(
      list
        .slice(0, STEP_MAX)
        .map((x, i) => [
          'list:' + i,
          { text: String(x.text || ''), status: String(x.status || 'pending') },
        ])
    )
  );

// Claude Code's PostToolUse for a checklist tool; true when the list changed.
function claudeChecklist(paneId, h) {
  const tool = h.tool_name,
    input = h.tool_input || {};
  let res = h.tool_response;
  if (typeof res === 'string') {
    try {
      res = JSON.parse(res);
    } catch {
      res = null;
    }
  }
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    setList(
      paneId,
      input.todos.map(x => ({ text: x?.activeForm || x?.content, status: x?.status }))
    );
    return true;
  }
  if (tool !== 'TaskCreate' && tool !== 'TaskUpdate') return false;
  const items = checklists.get(paneId) || new Map();
  checklists.set(paneId, items);
  if (tool === 'TaskCreate') {
    const id = res?.task?.id;
    if (id == null || items.size >= STEP_MAX) return false;
    items.set('task:' + id, {
      text: String(input.activeForm || input.subject || res.task.subject || ''),
      status: 'pending',
    });
    return true;
  }
  const item = items.get('task:' + (input.taskId ?? ''));
  if (!item) return false;
  if (input.status) item.status = String(input.status);
  if (input.activeForm || input.subject) item.text = String(input.activeForm || input.subject);
  return true;
}

// Codex's update_plan call in its rollout: { plan: [{ step, status }] }.
function codexChecklist(paneId, line) {
  const p = parse(line)?.payload;
  if (p?.type !== 'function_call' || p.name !== 'update_plan') return false;
  let a = null;
  try {
    a = JSON.parse(p.arguments);
  } catch {}
  if (!Array.isArray(a?.plan)) return false;
  setList(
    paneId,
    a.plan.map(x => ({ text: x?.step, status: x?.status }))
  );
  return true;
}

// OpenCode's todowrite call, from its step plugin (agent-hooks.js onStep): { todos: [{ content,
// status }] }, the whole list each call. A cancelled item is left out like a deleted one. True for
// any step of an OpenCode panel (onStep then also notes the file it edits).
function openCodeStep(paneId, tool, input) {
  if (panes.get(paneId)?.agent !== 'OpenCode') return false;
  if (String(tool).toLowerCase() !== 'todowrite' || !Array.isArray(input?.todos)) return true;
  setList(
    paneId,
    input.todos.map(x => ({
      text: x?.content,
      status: x?.status === 'cancelled' ? 'deleted' : x?.status,
    }))
  );
  const t = turns.get(paneId);
  if (t && !t.endedAt) publish(t);
  return true;
}

// ---------- Queued prompts: submitted while the agent is still working, so the CLI holds them
// ---------- Every prompt reaches a pane as a bracketed paste then Enter (Technically Not's
// composer, Send to, tnai send, the task graph, or the user pasting). Submitted while the pane's
// task runs → queued. It leaves the queue when the CLI takes it, when Esc / Ctrl+C pulls them back,
// or when the task ends and the CLI starts nothing. Taken = Codex: its user_message. Claude Code:
// its prompt hook fires at SUBMIT time, while the task still runs, so that hook only notes the
// prompt as waiting (turn.next); it is taken when the transcript records a queue-operation "remove"
// (absorbed between tool calls), or at the latest when the running task stops: Claude Code then
// runs everything still waiting as the next task (several merged into one), which starts there,
// since no new prompt hook comes for it. A prompt hook after the task ended starts a new task and
// takes the matching queued prompt.
const PASTE = /^\x1b\[200~([\s\S]*)\x1b\[201~$/;
const queues = new Map(); // paneId -> [{ text, at }]
const pasted = new Map(); // paneId -> text pasted, waiting for Enter
const norm = v =>
  String(v || '')
    .replace(/\s+/g, ' ')
    .trim();

function republish(paneId) {
  const t = turns.get(paneId);
  if (t) publish(t);
}

function setQueue(paneId, list) {
  if (list.length) queues.set(paneId, list);
  else queues.delete(paneId);
  republish(paneId);
}

function wrote(paneId, data) {
  const s = String(data),
    m = PASTE.exec(s);
  if (m) return void pasted.set(paneId, m[1]);
  if (s === '\x1b' || s.includes('\x03')) {
    pasted.delete(paneId);
    const t = turns.get(paneId);
    if (t) t.next = null;
    if (queues.has(paneId)) setQueue(paneId, []);
    if (t) cancelSoon(t);
    return;
  }
  if (s !== '\r' || !pasted.has(paneId)) return;
  const text = norm(pasted.get(paneId));
  pasted.delete(paneId);

  // tells its session from another OpenCode pane's in the same folder
  if (panes.get(paneId)?.agent === 'OpenCode') opencode.submitted(paneId, text);
  const t = turns.get(paneId);
  if (!text || !t || t.endedAt) return;
  setQueue(paneId, [...(queues.get(paneId) || []), { text: clip(text, TASK_MAX), at: Date.now() }]);
}

// Esc right after a prompt, before Claude Code answered: the CLI puts the prompt back in its input
// and writes nothing (no Stop hook, no "[Request interrupted…]" line), so the task would tick
// "Working" forever. Esc/Ctrl+C on a task with no reply yet ends it once the transcript still shows
// no reply a moment later; a hook from the same task after that (the key only closed a menu) opens
// it again (claudeHook).
const CANCEL_CHECK_MS = 1500;

function cancelSoon(t) {
  if (t.agent !== 'Claude Code' || t.endedAt || t.byId.size) return;
  clearTimeout(t.cancelTimer);
  t.cancelTimer = setTimeout(
    stalls.timed('turn cancel check', () => {
      if (turns.get(t.paneId) !== t || t.endedAt) return;
      readClaude(t);
      readSubs(t);
      if (t.endedAt || t.byId.size || t.subs.size) return;
      t.endedAt = Date.now();
      t.endedBy = 'interrupted';
      t.cancelled = true;
      settle(t.paneId);
      publish(t);
    }),
    CANCEL_CHECK_MS
  );
}

// The CLI's own sign that it took a prompt (Claude Code's prompt hook, Codex's rollout user
// message), for prompt-submit.js.
const submitWaiters = new Map(); // paneId -> Set of callbacks

function submitted(paneId) {
  for (const fn of [...(submitWaiters.get(paneId) || [])]) {
    try {
      fn();
    } catch {}
  }
}

function consume(paneId, prompt) {
  const list = queues.get(paneId);
  if (!list) return;
  const p = norm(prompt),
    key = q => q.text.replace(/…$/, '');
  const left = list.filter(q => !p.includes(key(q)));
  setQueue(paneId, left.length < list.length ? left : list.slice(1));
}

// A few seconds after a task ends: if the CLI started nothing, nothing is still waiting.
function settle(paneId) {
  if (!queues.has(paneId)) return;
  setTimeout(() => {
    const t = turns.get(paneId);
    if (queues.has(paneId) && (!t || t.endedAt)) setQueue(paneId, []);
  }, 5000);
}

// Pushed at once when the task starts, ends, is replaced or its queue changes; progress while it
// runs (tokens, sub-agent logs: every hook event of a busy agent) at most once per TURN_MS per
// pane, the latest state last. Each message carries the whole turn (sub-agent logs included) and
// also drives main-side listeners (main.js), so one per hook event was hundreds of large IPC
// messages a second with a few agents busy.
const TURN_MS = 120;
const sent = new Map(); // paneId -> { t, key, at, timer } the last turn pushed
const turnKey = t =>
  t.startedAt + ':' + (t.endedAt || 0) + ':' + (queues.get(t.paneId)?.length || 0);

// attention-service.js: a task ended, so prompts held for a working agent can go
const endListeners = new Set();

// change-review.js: a task started, so its files' state at the start is noted
const startListeners = new Set();

function publish(t) {
  if (turns.get(t.paneId) !== t || !t.startedAt) return;

  // a turn first seen already ended (a resumed session's last task) never started here
  if (!t.startSaid && !t.endedAt) {
    t.startSaid = true;
    for (const fn of startListeners) {
      try {
        fn(t.paneId);
      } catch {}
    }
  }
  if (t.endedAt && !t.endSaid) {
    t.endSaid = true;
    for (const fn of endListeners) {
      try {
        fn(t.paneId);
      } catch {}
    }
  }
  const last = sent.get(t.paneId),
    now = Date.now();
  if (last && last.t === t && last.key === turnKey(t) && now - last.at < TURN_MS) {
    if (!last.timer)
      last.timer = setTimeout(
        () => {
          last.timer = null;
          if (turns.get(t.paneId) === t && sent.get(t.paneId) === last) push(t);
        },
        TURN_MS - (now - last.at)
      );
    return;
  }
  push(t);
}

// Sub-agent logs (up to 300 × 600 chars each) are the bulk of a turn and change far less often than
// tokens: they ride along only when they changed since the last push of the same turn; otherwise
// `subLogSame` tells the window (42) to keep the copy it has.
const subSig = t => {
  let n = '';
  if (t.subs)
    for (const [id, s] of t.subs)
      if (s.log?.length) {
        const e = s.log[s.log.length - 1];
        n += id + ':' + s.log.length + ':' + (e?.at || 0) + ':' + (e?.text?.length || 0) + ',';
      }
  return n;
};

function push(t) {
  const prev = sent.get(t.paneId),
    sig = subSig(t),
    t0 = performance.now();
  clearTimeout(prev?.timer);
  sent.set(t.paneId, { t, key: turnKey(t), at: Date.now(), timer: null, sig });
  const out = publicTurn(t);
  if (prev && prev.t === t && prev.sig === sig) {
    delete out.subLog;
    out.subLogSame = true;
  }
  send('agent:turn', out);

  // a named section (stall-log.js): building the turn, main's listeners and the send to the window
  stalls.ran('agent:turn push', performance.now() - t0);
}

// New complete lines of a file since the last read (a partial last line waits for the next read); a
// replaced/shrunk file starts over. This form blocks the main process until the disk answers
// (stalls.log 2026-10-07: up to 797 ms with no CPU used), so it is kept for the moments whose order
// must be exact: a task ending (Stop, StopFailure, the process gone), a sub-agent's last read, the
// cancel and intervene checks. Everything else (a watched file changing, a tool call's hook) reads
// with readLater below.
function readLines(r) {
  let fd;
  try {
    fd = fs.openSync(r.file, 'r');
  } catch {
    return [];
  }
  const lines = [];
  try {
    const size = fs.fstatSync(fd).size;
    if (size < r.pos) {
      r.pos = 0;
      r.rest = null;
    }
    while (r.pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - r.pos));
      const n = fs.readSync(fd, buf, 0, buf.length, r.pos);
      if (!n) break;
      r.pos += n;
      const data = r.rest ? Buffer.concat([r.rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      const end = data.lastIndexOf(10);
      if (end < 0) {
        r.rest = data;
        continue;
      }
      r.rest = end + 1 < data.length ? data.subarray(end + 1) : null;
      for (const line of data.toString('utf8', 0, end).split('\n'))
        if (line.trim()) lines.push(line);
    }
  } catch {
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
  return lines;
}
const parse = line => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

// readLines off the main loop: the same bytes, lines and order. readAhead only reads; taken() then
// moves the place in the file and hands out the lines in one step with their use, and only if no
// read at once (readLines) took those bytes meanwhile (then null), so nothing is counted twice and
// no line reaches a task that started after a read at once.
async function readAhead(r) {
  const lines = [],
    pos0 = r.pos,
    rest0 = r.rest;
  let fh;
  try {
    fh = await fs.promises.open(r.file, 'r');
  } catch {
    return { lines, pos: pos0, rest: rest0, pos0, rest0 };
  }
  let pos = pos0,
    rest = rest0;
  try {
    const size = (await fh.stat()).size;
    if (size < pos) {
      pos = 0;
      rest = null;
    }
    while (pos < size) {
      const buf = Buffer.alloc(Math.min(CHUNK, size - pos));
      const { bytesRead: n } = await fh.read(buf, 0, buf.length, pos);
      if (!n) break;
      pos += n;
      const data = rest ? Buffer.concat([rest, buf.subarray(0, n)]) : buf.subarray(0, n);
      const end = data.lastIndexOf(10);
      if (end < 0) {
        rest = data;
        continue;
      }
      rest = end + 1 < data.length ? data.subarray(end + 1) : null;
      for (const line of data.toString('utf8', 0, end).split('\n'))
        if (line.trim()) lines.push(line);
    }
  } catch {
  } finally {
    await fh.close().catch(() => {});
  }
  return { lines, pos, rest, pos0, rest0 };
}

function taken(r, got) {
  if (r.pos !== got.pos0 || r.rest !== got.rest0) return null;
  r.pos = got.pos;
  r.rest = got.rest;
  return got.lines;
}

// One read off the main loop per file at a time; a change that comes while it runs is read right
// after it. `apply(lines)` gets the new lines when they are in, in file order, in a named section
// (stall-log.js).
function readLater(r, apply) {
  if (r.reading) {
    r.again = apply;
    return;
  }
  r.reading = true;
  readAhead(r).then(
    got => {
      const lines = taken(r, got);
      r.reading = false;
      const again = r.again || (lines ? null : apply);

      // null: a read at once took these bytes, so look once more for what came after it
      r.again = null;
      if (lines?.length) {
        const t0 = performance.now();
        try {
          apply(lines);
        } catch {}
        stalls.ran('transcript lines ' + path.extname(r.file).slice(1, 9), performance.now() - t0);
      }
      if (again) readLater(r, again);
    },
    () => {
      r.reading = false;
      r.again = null;
    }
  );
}

// Watches the file's folder (the file may not exist yet) and calls back, debounced, when that file
// changes. One fs.watch per folder, shared by every file watched in it: all of a project's Claude
// Code transcripts sit in one folder (and a lead's sub-agents in one subagents folder), so a
// watcher per session made every transcript write wake every session's watcher (N² callbacks, the
// main loop stalled). lower-cased folder -> { watcher, files: Map(lower-cased name -> Set of
// callbacks) }
const folders = new Map();

function watchFile(t, file, onChange) {
  unwatch(t);
  const dir = path.dirname(file),
    key = dir.toLowerCase(),
    name = path.basename(file).toLowerCase();
  let f = folders.get(key);
  if (!f) {
    try {
      const entry = { watcher: null, files: new Map() };
      entry.watcher = fs.watch(dir, (_type, changed) => {
        const hit = changed ? entry.files.get(String(changed).toLowerCase()) : null;
        for (const fire of hit
          ? [...hit]
          : changed
            ? []
            : [...entry.files.values()].flatMap(set => [...set]))
          fire();
      });
      entry.watcher.on('error', () => {
        // the folder went away / the handle was lost: its files stop being watched, as before
        if (folders.get(key) === entry) folders.delete(key);
        try {
          entry.watcher.close();
        } catch {}
        for (const set of entry.files.values()) for (const fire of set) fire.drop();
      });
      folders.set(key, (f = entry));
    } catch {
      return;
    }
  }

  // a named section (stall-log.js): a stall line can name it (OpenCode's record is read here; the
  // others' lines come in under 'transcript lines', readLater)
  const read = stalls.timed('transcript read ' + path.extname(file).slice(1, 9), onChange);
  const fire = () => {
    clearTimeout(t.debounce);
    t.debounce = setTimeout(read, 80);
  };
  fire.drop = () => {
    if (t.watcher?.fire === fire) t.watcher = null;
  };
  if (!f.files.has(name)) f.files.set(name, new Set());
  f.files.get(name).add(fire);
  const folder = f;
  t.watcher = {
    fire,
    close() {
      const set = folder.files.get(name);
      set?.delete(fire);
      if (set && !set.size) folder.files.delete(name);
      if (!folder.files.size && folders.get(key) === folder) {
        folders.delete(key);
        try {
          folder.watcher.close();
        } catch {}
      }
    },
  };
}

function unwatch(t) {
  clearTimeout(t?.debounce);
  try {
    t?.watcher?.close();
  } catch {}
  if (t) t.watcher = null;
  if (t?.subs) for (const s of t.subs.values()) unwatch(s);
}

// ---------- Claude Code: hooks give the turn, the transcript gives the tokens ----------
// Transcript lines repeat a message's usage once per content block, so usage is kept per message id
// (latest wins).
function sumUsage(byId) {
  const sum = zero();
  for (const u of byId.values()) {
    sum.input += u.input_tokens || 0;
    sum.output += u.output_tokens || 0;
    sum.cacheRead += u.cache_read_input_tokens || 0;
    sum.cacheWrite += u.cache_creation_input_tokens || 0;
  }
  return sum;
}

// `sub`: the lines are that sub-agent's transcript, so they also count toward its own total.
function addClaudeUsage(t, lines, sub) {
  let changed = false;
  for (const line of lines) {
    // A finished /compact (typed, sent by Technically Not, or automatic): Claude Code writes a
    // compact_boundary line with the size after it (compactMetadata.postTokens) and makes no
    // request until the next prompt, so without this the pre-compact size stays the current one.
    if (!sub && line.includes('"compact_boundary"')) {
      const j = parse(line),
        post = +j?.compactMetadata?.postTokens;
      if (j?.type !== 'system' || j.subtype !== 'compact_boundary' || j.isSidechain) continue;
      const r = t.reader || t;
      r.callIds = new Set();
      r.lastTokens = post > 0 ? post : 0;

      // when it finished: the thread's "Compacting" line ends here (158-cli-busy.js)
      t.compactedAt = Date.parse(j.timestamp) || Date.now();
      t.context =
        post > 0
          ? {
              tokens: post,
              calls: 0,
              at: Date.parse(j.timestamp) || Date.now(),
              ...(r.cacheTtlMs ? { cacheTtlMs: r.cacheTtlMs } : {}),
            }
          : null; // no size reported = unknown, never guessed
      changed = true;
      continue;
    }
    if (!line.includes('"usage"')) continue;
    const j = parse(line),
      m = j?.message,
      u = m?.usage;
    if (j?.type !== 'assistant' || !u || !m.id) continue;

    // the model that actually answered (the composer's model menu, 46)
    if (!sub && m.model && m.model !== '<synthetic>') t.model = m.model;
    if (!sub && typeof j.effort === 'string' && j.effort) {
      t.effort = j.effort;
      t.effortAt = Date.parse(j.timestamp) || Date.now();
    } // the effort it answered at (Claude Code writes it on each reply)

    // Current context size: what the latest main-conversation request sent (input + cache reads +
    // cache writes); file order, so the last line wins. `calls`: main-conversation model requests
    // in this transcript since its context last shrank by half or more (a /compact); kept on the
    // reader, which lives as long as the transcript, so it runs across tasks. Every request
    // re-sends the whole context, so this is what a long session costs.
    if (!sub && !j.isSidechain && m.model !== '<synthetic>') {
      const tokens =
          (u.input_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0),
        r = t.reader || t;
      if (!r.callIds || tokens < (r.lastTokens || 0) / 2) r.callIds = new Set();
      r.callIds.add(m.id);
      r.lastTokens = tokens;

      // How long this conversation's prompt cache lives, as the API reported it for the latest
      // cache write: 1 hour on a subscription within its limits, 5 minutes on an API key or on
      // usage credits (11's cold agent offer). A reply that wrote nothing to the cache keeps the
      // last known value.
      const cc = u.cache_creation,
        ttl =
          cc?.ephemeral_5m_input_tokens > 0
            ? 300000
            : cc?.ephemeral_1h_input_tokens > 0
              ? 3600000
              : 0;
      if (ttl) r.cacheTtlMs = ttl;
      t.context = {
        tokens,
        calls: r.callIds.size,
        at: Date.parse(j.timestamp) || Date.now(),
        ...(r.cacheTtlMs ? { cacheTtlMs: r.cacheTtlMs } : {}),
      };
    }
    t.byId.set(m.id, u);
    if (sub) sub.byId.set(m.id, u);
    changed = true;
  }
  if (!changed) return false;
  t.tokens = sumUsage(t.byId);
  if (sub) sub.tokens = sumUsage(sub.byId);
  return true;
}

// Each Claude Code sub-agent's own transcript, read as it grows (on every hook event, which its
// tool calls fire too), so its tokens show while it works. Shown count per sub-agent: tokens it
// added (input, cache writes, output), the same measure as the task meter (42).
function subTokens(t) {
  const out = {};
  if (t.subs)
    for (const [id, s] of t.subs)
      if (s.tokens)
        out[id] = (s.tokens.input || 0) + (s.tokens.cacheWrite || 0) + (s.tokens.output || 0);
  return out;
}

function claudeSub(t, h) {
  const id = String(h.agent_id || '');
  if (!id) return null;
  let s = t.subs.get(id);
  if (!s) {
    let file = h.agent_transcript_path;
    if (!file && h.transcript_path)
      file = path.join(
        String(h.transcript_path).replace(/\.jsonl$/, ''),
        'subagents',
        'agent-' + id + '.jsonl'
      );
    if (!file || !path.isAbsolute(file)) return null;
    s = {
      reader: { file, pos: 0, rest: null },
      byId: new Map(),
      tokens: null,
      done: false,
      log: [],
      since: Date.now(),
    };
    t.subs.set(id, s);
  }

  // Its transcript is also watched, so its text between tool calls shows as it is written (hooks
  // only fire on tool calls). Its subagents folder may not exist at the first hook: tried again on
  // the next one.
  if (!s.done && !s.watcher) watchSub(t, s);
  return s;
}

function watchSub(t, s) {
  watchFile(s, s.reader.file, () => subLater(t, s));
}

// A sub-agent's transcript read off the main loop (its watcher, its own tool calls' hooks). The
// lines go to the task that holds the sub-agent when they are in: the lead may have started its
// next task meanwhile and taken a background sub-agent along (startClaude).
function subLater(t, s) {
  readLater(s.reader, lines => {
    const cur = turns.get(t.paneId),
      owner = cur === t ? t : cur?.subs && [...cur.subs.values()].includes(s) ? cur : null;
    if (owner && !s.done && readSub(owner, s, lines)) publish(owner);
  });
}

// A sub-agent has no pty of its own (it runs inside the lead's), so the Agents page draws its own
// terminal-style view from its transcript (25): the task it was given (prompt), what it wrote
// (text), the tools it called (tool), their results (result: the first lines only) and failed tool
// results (error). The newest SUB_LOG_MAX entries, each clipped: the whole log is pushed over IPC
// on every turn update.
const SUB_LOG_MAX = 300,
  SUB_LOG_TEXT = 600,
  SUB_RESULT_LINES = 6,
  SUB_RESULT_TEXT = 400;
const toolDetail = input => {
  const i = input || {};
  return clip(
    String(
      i.description ||
        i.file_path ||
        i.path ||
        i.command ||
        i.pattern ||
        i.url ||
        i.query ||
        i.prompt ||
        ''
    ),
    160
  );
};
const blockText = c =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map(x => x?.text || '').join(' ') : '';
const resultText = c =>
  clip(
    String(blockText(c)).trim().split(/\r?\n/).slice(0, SUB_RESULT_LINES).join('\n'),
    SUB_RESULT_TEXT
  );

function addSubLog(s, lines) {
  let changed = false;
  for (const line of lines) {
    const j = parse(line),
      content = j?.message?.content,
      at = Date.parse(j?.timestamp) || Date.now();

    // Its first user message (text, not a tool result) is the task its lead gave it.
    if (
      j?.type === 'user' &&
      !s.prompted &&
      content &&
      !(Array.isArray(content) && content.some(b => b?.type === 'tool_result'))
    ) {
      s.prompted = true;
      const text = clip(blockText(content), SUB_LOG_TEXT);
      if (text) {
        s.log.push({ kind: 'prompt', text, at });
        changed = true;
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      let entry = null;
      if (j.type === 'assistant' && b.type === 'text' && b.text?.trim())
        entry = { kind: 'text', text: clip(b.text, SUB_LOG_TEXT) };

      // its answer to its lead, handed back through a tool call: its own words, and the
      // tool's "delivered" answer is not a result worth a row
      else if (
        j.type === 'assistant' &&
        b.type === 'tool_use' &&
        b.name === 'SubagentHandback' &&
        typeof b.input?.message === 'string' &&
        b.input.message.trim()
      ) {
        (s.handbacks ||= new Set()).add(b.id);
        entry = { kind: 'text', text: clip(b.input.message, SUB_LOG_TEXT) };
      } else if (j.type === 'assistant' && b.type === 'tool_use')
        entry = { kind: 'tool', text: [b.name, toolDetail(b.input)].filter(Boolean).join(' · ') };
      else if (j.type === 'user' && b.type === 'tool_result' && s.handbacks?.has(b.tool_use_id))
        entry = null;
      else if (j.type === 'user' && b.type === 'tool_result' && b.is_error)
        entry = { kind: 'error', text: clip(blockText(b.content), SUB_LOG_TEXT) };
      else if (j.type === 'user' && b.type === 'tool_result')
        entry = { kind: 'result', text: resultText(b.content) };
      if (entry) {
        entry.at = at;
        s.log.push(entry);
        changed = true;
      }
    }
  }
  if (s.log.length > SUB_LOG_MAX) s.log.splice(0, s.log.length - SUB_LOG_MAX);
  return changed;
}

function readSub(t, s, lines = readLines(s.reader)) {
  const usage = addClaudeUsage(t, lines, s);
  return addSubLog(s, lines) || usage;
}

function subLog(t) {
  const out = {};
  if (t.subs) for (const [id, s] of t.subs) if (s.log?.length) out[id] = s.log;
  return out;
}

function readSubs(t) {
  let changed = false;
  for (const s of t.subs.values()) if (!s.done && readSub(t, s)) changed = true;
  return changed;
}

// A waiting prompt Claude Code took into the running task (transcript queue-operation "remove",
// e.g. reason absorbed_mid_turn): it leaves the queue and no longer waits for the next task. No
// match → the oldest one (the CLI may reword a long paste).
let taskNoted = null; // main.js → agent-hooks.js taskNote
let spawnRefused = null; // main.js → agent-hooks.js note ('spawn-refused')
let compactTasks = null; // main.js → agent-hooks.js note ('bg-end', 'bg-sweep')

// How long after a compact_boundary line its task_status lines may still arrive (Claude Code
// writes them right after it, in the same burst).
const COMPACT_TASKS_MS = 2000;

// After a compact Claude Code writes one task_status attachment per background task it still holds
// (status "running", or "completed" for one whose hand-back came while it compacted) and fires no
// hook for either, so the window's sub-agents and background commands would stay listed for
// hours. A task it no longer lists has ended: on 136 real compacts every task still open before
// the compact was listed after it. "completed" ends that task at once (bg-end); the full list ends
// every other entry from before the compact (bg-sweep), once the burst is in.
function readCompactTasks(t, lines) {
  const r = t.reader;
  for (const line of lines) {
    if (line.includes('"compact_boundary"')) {
      const j = parse(line);
      if (j?.type !== 'system' || j.subtype !== 'compact_boundary' || j.isSidechain) continue;
      r.compactTasks = {
        running: new Set(),
        at: Date.parse(j.timestamp) || Date.now(),
      };
      const paneId = t.paneId;

      // the lines still unread then go through readClaude first, so the list is whole
      setTimeout(() => {
        const cur = turns.get(paneId);
        if (cur?.reader === r) readClaude(cur);
        const done = r.compactTasks;
        r.compactTasks = null;
        if (!done) return;
        try {
          compactTasks?.(paneId, {
            kind: 'bg-sweep',
            running: [...done.running],
            before: done.at,
          });
        } catch {}
      }, COMPACT_TASKS_MS).unref?.();
      continue;
    }
    if (!line.includes('"task_status"')) continue;
    const j = parse(line),
      a = j?.attachment;
    if (j?.type !== 'attachment' || a?.type !== 'task_status' || j.isSidechain || !a.taskId)
      continue;
    if (a.status === 'running') {
      r.compactTasks?.running.add(String(a.taskId));
      continue;
    }
    try {
      compactTasks?.(t.paneId, {
        kind: 'bg-end',
        taskId: String(a.taskId),
        status: String(a.status || ''),
      });
    } catch {}
  }
}

function takenMidTurn(t, text) {
  consume(t.paneId, text);
  if (!t.next?.length) return;
  const p = norm(text),
    i = t.next.findIndex(n => {
      const q = norm(n);
      return q && (p.includes(q) || q.includes(p));
    });
  t.next.splice(i < 0 ? 0 : i, 1);
}

// The text of a prompt record in Claude Code's transcript ('' for anything else: a tool result, a
// sub-agent's line, the CLI's own notes).
function promptText(j) {
  if (j?.type !== 'user' || j.isSidechain || j.isMeta) return '';
  const content = j.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some(b => b?.type === 'tool_result')) return '';
  return content
    .filter(b => b?.type === 'text')
    .map(b => b.text || '')
    .join('\n');
}

// A waiting prompt whose own record shows up in the transcript while the task still counts as
// running: Claude Code has started it. Seen with 2.1.x (2026-10-10): a prompt sent while the reply
// was being written got a "dequeue" with no text, then its record, with no "remove" and no Stop for
// the reply before it; the one Stop that follows is that prompt's. So it no longer waits: left in
// `next`, that Stop would start a task the CLI never runs ("Working" until the next prompt), and
// every later prompt would be taken for a waiting one in the same way. Only a record that matches a
// waiting prompt counts (the CLI's own notes are user records too).
function startedWaiting(t, lines) {
  for (const line of lines) {
    if (!t.next?.length) return;
    if (!line.includes('"type":"user"')) continue;
    const p = norm(promptText(parse(line)));
    if (!p) continue;
    const i = t.next.findIndex(n => {
      const q = norm(n);
      return q && (p.includes(q) || q.includes(p));
    });
    if (i < 0) continue;
    t.next.splice(i, 1);
    consume(t.paneId, p);
  }
}

// The lead's transcript read off the main loop (its watcher, a tool call's hook). The lines go to
// the task that holds this transcript when they are in: a Stop with prompts waiting starts the next
// task on the same transcript (claudeHook).
function claudeLater(t) {
  const r = t.reader;
  if (!r) return;
  readLater(r, lines => {
    const cur = turns.get(t.paneId),
      owner = cur === t ? t : cur?.reader === r ? cur : null;
    if (owner) readClaude(owner, lines);
  });
}

function readClaude(t, lines) {
  if (!t.reader) return;
  if (!lines) lines = readLines(t.reader);
  for (const line of lines)
    if (line.includes('"queue-operation"')) {
      const j = parse(line);
      if (!(
        j?.type === 'queue-operation' &&
        j.operation === 'remove' &&
        typeof j.content === 'string' &&
        j.content
      ))
        continue;
      takenMidTurn(t, j.content);

      // A background task's hand-back taken into the running reply fires no UserPromptSubmit hook:
      // pass it on, or the task stays "in background".
      if (/^\s*<task-notification>/.test(j.content))
        try {
          taskNoted?.(t.paneId, j.content);
        } catch {}
    }
  readCompactTasks(t, lines);
  startedWaiting(t, lines);

  // A refused or failed Agent launch (permission denied, auto-mode check with no verdict) never
  // gets PostToolUse or SubagentStart, and not always PostToolUseFailure; its error tool_result in
  // the lead's transcript is certain. 19 drops that call's "Starting" card.
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"is_error":true')) continue;
    const j = parse(line),
      content = j?.message?.content;
    if (j?.isSidechain || !Array.isArray(content)) continue;
    for (const b of content) {
      if (j.type === 'assistant' && b?.type === 'tool_use' && /^(Agent|Task)$/.test(b.name || ''))
        (t.agentCalls ||= new Set()).add(b.id);
      else if (
        j.type === 'user' &&
        b?.type === 'tool_result' &&
        b.is_error &&
        t.agentCalls?.delete(b.tool_use_id)
      )
        try {
          spawnRefused?.(t.paneId, b.tool_use_id);
        } catch {}
      else if (j.type === 'user' && b?.type === 'tool_result') t.agentCalls?.delete(b.tool_use_id);
    }
  }
  let changed = addClaudeUsage(t, lines);

  // Claude Code fires no Stop hook when the user interrupts (Esc); its transcript records "[Request
  // interrupted by user…]" instead. End the turn there, or it stays "working" and the next prompt
  // is merged into it as if queued.
  if (
    !t.endedAt &&
    lines.some(
      line => line.includes('[Request interrupted by user') && parse(line)?.type === 'user'
    )
  ) {
    t.endedAt = Date.now();
    t.endedBy = 'interrupted';
    settle(t.paneId);
    changed = true;
  }
  if (changed) publish(t);
}

function claudeHook(paneId, h) {
  const event = h.hook_event_name;
  if (event === 'UserPromptSubmit') {
    if (!/^\s*<task-notification>/.test(String(h.prompt || ''))) submitted(paneId);
    const old = turns.get(paneId);
    const file =
      typeof h.transcript_path === 'string' && path.isAbsolute(h.transcript_path)
        ? h.transcript_path
        : '';

    // A prompt sent while the agent is still working: the CLI queues it and fires this hook at
    // once. The running task keeps its start, task and tokens; the prompt waits (queue above). A
    // sub-agent's hand-back (<task-notification>) is the CLI's own message, not a waiting prompt.
    if (
      old &&
      old.agent === 'Claude Code' &&
      !old.endedAt &&
      (!file || !old.reader || old.reader.file === file)
    ) {
      if (!/^\s*<task-notification>/.test(String(h.prompt || '')))
        (old.next ||= []).push(String(h.prompt || ''));
      claudeLater(old);
      return publish(old);
    }
    consume(paneId, h.prompt);
    let pos = 0;
    try {
      pos = file ? fs.statSync(file).size : 0;
    } catch {}

    // The session file changed under a running panel: a /clear only when Claude Code itself
    // recorded one there after this panel's last task began (a resume or a fork keeps no such
    // line of its own).
    const oldFile = old?.agent === 'Claude Code' ? old.reader?.file : '';
    const clearedAt =
      file && oldFile && oldFile !== file ? claudeClearedIn(file, old.startedAt) : 0;
    return startClaude(paneId, old, h.prompt, file ? { file, pos, rest: null } : null, clearedAt);
  }

  // published below with the task
  if (event === 'PostToolUse' && !h.agent_id) claudeChecklist(paneId, h);
  const t = turns.get(paneId);
  if (!t || t.agent !== 'Claude Code') return;

  // cancelSoon guessed wrong: it still works. endSaid goes back too, so the end listeners (held
  // prompts) hear the real end instead of the guessed one only.
  if (t.cancelled && event !== 'Stop' && event !== 'StopFailure') {
    t.cancelled = false;
    t.endedAt = 0;
    t.endedBy = '';
    t.endSaid = false;
  }

  // …and finished: keep its answer
  if (t.cancelled && event === 'Stop') {
    t.cancelled = false;
    t.endedAt = 0;
    t.endSaid = false;
  }

  // A sub-agent's messages are in its own transcript (merged into the task by message id, so
  // nothing counts twice); a finished one is read a last time. Read at once, in order, only where
  // the task ends (everything it used must be counted on it before the next task starts) and for a
  // sub-agent's own last read. Any other event reads off the main loop, and only the sub-agent it
  // names plus the lead: every running sub-agent's transcript is watched, so re-reading all of them
  // here on each tool call blocked the main process for 150 to 430 ms with ten sub-agents
  // (stalls.log 2026-10-07, 44 stalls). One whose watch could not start is still read here.
  const sub = claudeSub(t, h),
    ending = event === 'Stop' || event === 'StopFailure';
  if (ending) readSubs(t);
  else {
    if (sub && !sub.done) {
      if (event === 'SubagentStop') readSub(t, sub);
      else subLater(t, sub);
    }
    for (const s of t.subs.values()) if (s !== sub && !s.done && !s.watcher) subLater(t, s);
  }
  if (event === 'SubagentStop' && sub) {
    sub.done = true;
    unwatch(sub);
  }
  if (ending) readClaude(t);
  else claudeLater(t);
  if (event === 'Stop' && !t.endedAt) {
    t.endedAt = Date.now();
    t.endedBy = 'stop';
    t.result = clip(h.last_assistant_message, RESULT_MAX); // the agent's final answer for the task

    // Prompts still waiting run now as the next task (merged into one); the transcript read goes on
    // where this task's stopped.
    const next = t.next || [];
    t.next = null;
    if (next.length) {
      publish(t);
      for (const p of next) consume(paneId, p);
      return startClaude(paneId, t, next.join('\n\n'), t.reader);
    }
    settle(paneId);
  }

  // StopFailure: an API error (usage/rate limit, auth failure…) ended the turn instead of Stop. No
  // answer, and the waiting prompts don't start.
  if (event === 'StopFailure' && !t.endedAt) {
    t.endedAt = Date.now();
    t.endedBy = 'error';
    settle(paneId);
  }
  publish(t);
}

// longer than Bash's 10 min max timeout, so a sub-agent in a long tool call still counts as running
const SUB_IDLE_MS = 30 * 60e3;

function subIdle(s) {
  let at = s.since || 0;
  try {
    at = fs.statSync(s.reader.file).mtimeMs;
  } catch {} // no transcript yet: since it was first seen
  return Date.now() - at > SUB_IDLE_MS;
}

// When Claude Code recorded a /clear at the start of this session file at or after `since` (ms),
// else 0. A cleared session's new file opens with the command's own line,
// "<command-name>/clear</command-name>", within its first lines (seen in this PC's transcripts,
// 2026-10-15); a resumed old session that began with a clear carries an older time.
const CLEAR_HEAD = 64 * 1024;

function claudeClearedIn(file, since) {
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(CLEAR_HEAD);
      head = buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, CLEAR_HEAD, 0));
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 0;
  }
  for (const line of head.split('\n')) {
    if (!line.includes('<command-name>/clear</command-name>')) continue;
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (entry?.type !== 'user' || entry.isSidechain || typeof content !== 'string') continue;
    if (!content.trimStart().startsWith('<command-name>/clear</command-name>')) continue;
    const at = Date.parse(entry.timestamp);
    if (at >= (since || 0)) return at;
  }
  return 0;
}

function startClaude(paneId, old, task, reader, clearedAt = 0) {
  unwatch(old);
  const t = {
    paneId,
    agent: 'Claude Code',
    source: 'claude-transcript',
    startedAt: Date.now(),
    endedAt: 0,
    clearedAt,
    tokens: null,
    byId: new Map(),
    subs: new Map(),
    task: clip(task, TASK_MAX),
    prompt: String(task ?? '').slice(
      0,
      PROMPT_MAX
    ) /* whole, for promptOf: never pushed to the window */,
    result: '',
    reader,
  };
  turns.set(paneId, t);
  if (reader) watchFile(t, reader.file, () => claudeLater(t));

  // Background sub-agents still running when the lead starts a new task in the same session (e.g.
  // another sub-agent's hand-back, a queued prompt) move to the new task with their log, so the
  // Agents page keeps showing them; a long tool call fires no hook to re-add them. One whose
  // transcript has been silent for SUB_IDLE_MS is left behind: a sub-agent a usage limit or crash
  // killed never gets SubagentStop, and would otherwise ride along (watcher, log over IPC) into
  // every later task. If it was only quiet, its next hook adds it back (claudeSub, log re-read).
  if (
    old?.agent === 'Claude Code' &&
    old.subs &&
    (!reader || !old.reader || old.reader.file === reader.file)
  ) {
    for (const [id, s] of old.subs)
      if (!s.done && !subIdle(s)) {
        t.subs.set(id, s);
        watchSub(t, s);
      }
  }
  return publish(t);
}

// ---------- Codex: everything from its rollout file ----------
// Async (a long history has many day folders), newest day first, so a new session is found in
// today's folder at once.
async function codexFile(home, id) {
  const root = path.join(home, 'sessions');
  const list = async d => {
    try {
      return (await fs.promises.readdir(d)).sort().reverse();
    } catch {
      return [];
    }
  };
  for (const y of await list(root))
    for (const m of await list(path.join(root, y)))
      for (const d of await list(path.join(root, y, m))) {
        const hit = (await list(path.join(root, y, m, d))).find(
          n => n.startsWith('rollout-') && n.endsWith(id + '.jsonl')
        );
        if (hit) return path.join(root, y, m, d, hit);
      }
  return '';
}

// Codex's own plan window (rate_limits.primary: used_percent of a window_minutes window,
// plan_type), read on this pane's token_count events. A finished task's share = the rise in
// used_percent from its first to its last reading in the same window. Its first request comes
// before its first reading, so that one is left out (a slight undercount). `shared`: another Codex
// panel on the same account worked at the same time, so the rise isn't this task's alone. Codex use
// outside Technically Not (another terminal, the cloud) can't be seen at all.
function planReading(c, rl) {
  const p = rl?.primary;
  if (!p || !Number.isFinite(+p.used_percent)) return;
  const r = {
    used: +p.used_percent,
    window: +p.window_minutes || 0,
    resetsAt: +p.resets_at || 0,
    plan: String(rl.plan_type || ''),
  };
  if (c.turn && !c.turn.endedAt) {
    c.turn.planFirst = c.turn.planFirst || r;
    c.turn.planLast = r;
  }
}

function planShare(c) {
  const t = c.turn,
    a = t.planFirst,
    b = t.planLast;
  if (!a || !b || a.resetsAt !== b.resetsAt || a.window !== b.window) return null;
  const dir = panes.get(c.paneId)?.accountDir || '';
  const overlaps = x =>
    !!x && x !== t && x.startedAt < t.endedAt && (!x.endedAt || x.endedAt > t.startedAt);
  const shared = [...panes.entries()].some(
    ([id, p]) =>
      id !== c.paneId &&
      p.agent === 'Codex' &&
      (p.accountDir || '') === dir &&
      overlaps(p.codex?.turn)
  );
  return {
    used: Math.max(0, Math.round((b.used - a.used) * 10) / 10),
    window: b.window,
    plan: b.plan,
    left: Math.max(0, Math.round((100 - b.used) * 10) / 10),
    shared,
  };
}
const codexTokens = u => ({
  input: Math.max(0, (u.input_tokens || 0) - (u.cached_input_tokens || 0)),
  output: u.output_tokens || 0,
  cacheRead: u.cached_input_tokens || 0,
  cacheWrite: u.cache_write_input_tokens || 0,
});

function readCodex(c, lines = readLines(c.reader)) {
  let changed = false;
  for (const line of lines) {
    if (line.includes('"turn_context"')) {
      const p = parse(line)?.payload,
        m = p?.model,
        // effort only when this Codex version writes it
        e = p?.effort || p?.collaboration_mode?.settings?.reasoning_effort;
      if (m && m !== c.model) {
        c.model = m;
        changed = true;
      }
      if (typeof e === 'string' && e && e !== c.effort) {
        c.effort = e;
        c.effortAt = Date.now();
        changed = true;
      }
      continue;
    }
    if (line.includes('"update_plan"') && line.includes('"response_item"')) {
      if (codexChecklist(c.paneId, line)) changed = true;
      continue;
    }
    if (!line.includes('"event_msg"')) continue;
    const j = parse(line),
      p = j?.payload,
      at = Date.parse(j?.timestamp) || Date.now();
    if (!p) continue;
    if (p.type === 'token_count' && p.rate_limits) {
      c.limits = p.rate_limits;
      planReading(c, p.rate_limits);
      changed = true;
    } // Codex's own plan usage windows (used_percent, resets)

    // A queued prompt while still working: the running task goes on. But a task_started with
    // another turn_id is a new task: Codex runs one task at a time (no rollout read on 2026-10-14
    // had one inside another), so the running one ended without its end event and would otherwise
    // stay "working" for good.
    const sameTask = !p.turn_id || !c.turn?.turnId || p.turn_id === c.turn.turnId;
    if (p.type === 'task_started' && c.live && c.turn && !c.turn.endedAt && sameTask) continue;
    if (p.type === 'task_started') {
      c.turn = {
        turnId: p.turn_id || '',
        paneId: c.paneId,
        agent: 'Codex',
        source: 'codex-rollout',
        startedAt: at,
        endedAt: 0,
        tokens: null,
        task: '',
        result: '',
        log: c.reader.file,
      };
      c.base = c.total;
      changed = true;
    }

    // The submitted prompt: a user_message event, or (Codex 0.155+, which writes none) an
    // item_completed UserMessage item.
    const said =
      p.type === 'user_message'
        ? p.message
        : p.type === 'item_completed' && p.item?.type === 'UserMessage'
          ? (p.item.content || []).map(x => x?.text || '').join('')
          : null;
    if (said != null && c.live) {
      consume(c.paneId, said);
      submitted(c.paneId);
    }
    if (said != null && c.turn && !c.turn.endedAt && !c.turn.task) {
      c.turn.task = clip(said, TASK_MAX);
      changed = true;
    } else if (p.type === 'token_count' && p.info?.total_token_usage) {
      c.total = codexTokens(p.info.total_token_usage);

      // Current context size: the latest request's input (cached input included), with Codex's own
      // model window when it reports one.
      const last = p.info.last_token_usage;
      if (last)
        c.context = {
          tokens: last.input_tokens || 0,
          window: p.info.model_context_window || 0,
          at,
        };
      if (c.turn && !c.turn.endedAt) {
        const b = c.base || zero();
        c.turn.tokens = Object.fromEntries(
          Object.keys(c.total).map(k => [k, Math.max(0, c.total[k] - b[k])])
        );
        changed = true;
      }
    } else if (
      (p.type === 'task_complete' || p.type === 'turn_aborted') &&
      c.turn &&
      !c.turn.endedAt
    ) {
      c.turn.endedAt = at;
      c.turn.endedBy = p.type === 'turn_aborted' ? 'aborted' : 'stop';
      c.turn.result = clip(p.last_agent_message, RESULT_MAX);
      c.turn.plan = planShare(c);
      changed = true;
      settle(c.paneId);
    }
  }
  if (!changed || !c.turn) return;
  c.turn.model = c.model || '';
  c.turn.effort = c.effort || '';
  c.turn.effortAt = c.effortAt || 0;
  c.turn.limits = c.limits || null;
  c.turn.context = c.context || null;
  turns.set(c.paneId, c.turn);
  publish(c.turn);
}

async function attachCodex(paneId, sessionId) {
  const p = panes.get(paneId);
  if (
    !p ||
    p.agent !== 'Codex' ||
    !sessionId ||
    p.codex?.sessionId === sessionId ||
    p.finding === sessionId
  )
    return;
  p.finding = sessionId;
  try {
    const file = await codexFile(
      p.accountDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
      sessionId
    );

    // the pane restarted or another session attached meanwhile
    if (!file || panes.get(paneId) !== p || p.finding !== sessionId) return;

    // The whole rollout is read once (a resumed session shows its last task), then followed as it
    // grows.
    const c = {
      paneId,
      sessionId,
      reader: { file, pos: 0, rest: null },
      turn: null,
      total: null,
      base: null,
    };

    // the first read of a whole rollout (can be many MB), off the main loop
    const history = taken(c.reader, await readAhead(c.reader)) || [];
    if (panes.get(paneId) !== p || p.finding !== sessionId) return;
    unwatch(p.codex);
    p.codex = c;
    readCodex(c, history);

    // c.watcher: not after the process ended (unwatch)
    watchFile(c, file, () =>
      readLater(c.reader, lines => {
        if (c.watcher) readCodex(c, lines);
      })
    );
    readCodex(c); // anything written while the history was read

    // history read; from here on a task_started during a running task is a queued prompt
    c.live = true;
  } finally {
    if (p.finding === sessionId) p.finding = null;
  }
}

// ---------- OpenCode: its SQLite record (opencode-store.js), re-read when its write-ahead log
// changes ----------
function readOpenCode(o) {
  const last = opencode.lastTurn(o.sessionId);
  if (!last) return;
  const key =
    last.id +
    ':' +
    last.endedAt +
    ':' +
    (last.tokens ? last.tokens.input + last.tokens.output : 0) +
    ':' +
    (last.answers || 0) +
    ':' +
    // compactedAt: a /compact after this task, its context size is then unknown
    (last.compactedAt || 0);

  // it went busy again after a task that ended on an error (openCodeEvent)
  const again = !!o.retryAt && Date.now() - o.retryAt >= 300;
  if (key === o.key && !again) return;
  const fresh = last.id !== o.userId;
  o.key = key;
  o.userId = last.id;
  if (again || fresh) o.retryAt = 0;
  if (fresh && o.live) {
    consume(o.paneId, last.task);
    submitted(o.paneId);
  }
  const t =
    fresh || !o.turn
      ? {
          paneId: o.paneId,
          agent: 'OpenCode',
          source: 'opencode-db',
          startedAt: last.startedAt,
          endedAt: 0,
          tokens: null,
          task: clip(last.task, TASK_MAX),
          prompt: String(last.task ?? '').slice(0, PROMPT_MAX),
          result: '',
          log: opencode.dbFile(),
        }
      : o.turn;

  // the model's context size from OpenCode's own list, when it was read
  const win = last.context ? require('./agent-registry').contextWindow('OpenCode', last.model) : 0;
  Object.assign(t, {
    tokens: last.tokens,
    model: last.model,
    context: win ? { ...last.context, window: win } : last.context,
    ...(last.effort ? { effort: last.effort, effortAt: last.effortAt || Date.now() } : {}),
  });

  // A task that ended on an error works again when OpenCode tries once more by itself: it went busy
  // again on the same prompt, or wrote a new answer step.
  if (
    !fresh &&
    t.endedAt &&
    t.endedBy === 'error' &&
    !last.endedAt &&
    (again || (last.answers || 0) > (t.answers || 0))
  ) {
    t.endedAt = 0;
    t.endedBy = '';
    t.error = '';
    t.endSaid = false;
  }
  if (last.endedAt && !t.endedAt) {
    t.endedAt = last.endedAt;
    t.endedBy = last.endedBy;
    t.result = clip(last.result, RESULT_MAX);
    t.error = last.error || '';
    t.answers = last.answers || 0;
    settle(o.paneId);
  }
  o.answers = last.answers || 0;
  o.turn = t;
  turns.set(o.paneId, t);
  publish(t);
}

// OpenCode's own task events, from its step plugin (agent-hooks.js openCodeEvent; exact, where the
// record above is read on a watch): busy, retry and idle of the panel's session read the record at
// once, so a task's start and end no longer wait for the watch or a screen redraw (both stay as the
// fallback). An error followed by idle ends a task the record still shows as running: the case
// OpenCode writes no answer row for (a model it does not have), or one whose answer row was left
// unfinished. Returns 'busy' or 'idle' when the panel's own session changed to it, else ''. A panel
// with no session yet takes the event's: OpenCode names it before pty-service.js finds it by folder
// and time.
function openCodeEvent(paneId, m) {
  const p = panes.get(paneId);
  if (
    p?.agent !== 'OpenCode' ||
    m.child ||
    typeof m.session !== 'string' ||
    !/^ses_[\w-]{1,80}$/.test(m.session)
  )
    return '';
  if (!p.opencode) attachOpenCode(paneId, m.session);
  const o = p.opencode;
  if (!o || o.sessionId !== m.session) return '';
  const type =
    m.event === 'session.idle'
      ? 'idle'
      : m.event === 'session.error'
        ? 'error'
        : String(m.properties?.status?.type || '');
  if (type === 'error') {
    const e = m.properties?.error;
    o.err = {
      name: String(e?.name || ''),
      text: clip(String(e?.data?.message || e?.name || 'error').split(/\r?\n/)[0], 200),
      at: Date.now(),
    };
    return '';
  }
  if (type === 'busy' || type === 'retry') {
    const was = o.status || 'idle';
    o.status = type;
    if (was === 'idle') {
      o.err = null;
      if (o.turn?.endedAt && o.turn.endedBy === 'error') o.retryAt = Date.now();
    }
    readOpenCode(o);
    nudgeOpenCode(o);
    return was === 'idle' ? 'busy' : '';
  }
  if (type !== 'idle') return '';
  const was = o.status;
  o.status = 'idle';
  o.retryAt = 0;
  readOpenCode(o);
  failedOpenCode(o);

  // the record may be a moment behind the event
  if (o.err || (o.turn && !o.turn.endedAt)) nudgeOpenCode(o);
  return was === 'idle' ? '' : 'idle'; // OpenCode says idle twice (session.status, session.idle)
}

// One of OpenCode's own sub-agents (a child session of the panel's, agent-hooks.js): its last
// answer and tokens from the record, and its tokens counted on the running task like a Claude Code
// sub-agent's (subTokens; `done` = it finished). No step log is read for it.
function openCodeChild(paneId, id, done) {
  const o = panes.get(paneId)?.opencode;
  if (!o || typeof id !== 'string' || !/^ses_[\w-]{1,80}$/.test(id) || id === o.sessionId)
    return null;
  const last = opencode.lastTurn(id);
  if (!last) return null;
  const t = o.turn;
  if (t && !t.endedAt && turns.get(paneId) === t) {
    if (!t.subs) t.subs = new Map();
    const s = t.subs.get(id) || { done: false, tokens: null, log: [] };
    s.tokens = last.tokens || s.tokens;
    if (done) s.done = true;
    t.subs.set(id, s);
    publish(t);
  }
  return { text: last.result || '', tokens: last.tokens };
}

function failedOpenCode(o) {
  const t = o.turn;
  if (
    o.status !== 'idle' ||
    !o.err ||
    !t ||
    t.endedAt ||
    turns.get(o.paneId) !== t ||
    o.err.at < t.startedAt - 500
  )
    return;
  t.endedAt = Date.now();
  t.endedBy = o.err.name === 'MessageAbortedError' ? 'interrupted' : 'error';
  t.error = t.endedBy === 'error' ? o.err.text : '';
  t.answers = o.answers || 0;
  o.err = null;
  settle(o.paneId);
  publish(t);
}

function attachOpenCode(paneId, sessionId) {
  const p = panes.get(paneId);
  if (!p || p.agent !== 'OpenCode' || !sessionId || p.opencode?.sessionId === sessionId) return;
  unwatch(p.opencode);
  const o = { paneId, sessionId, turn: null, key: '', userId: '' };
  p.opencode = o;
  readOpenCode(o); // a resumed session shows its last task
  o.live = true;

  // every write lands in the WAL first
  watchFile(o, path.join(opencode.dataDir(), 'opencode.db-wal'), () => readOpenCode(o));
}

// The WAL watch alone misses writes: OpenCode reuses its WAL file (same size after a checkpoint)
// without flushing it, and Windows then sends no change event for a commit until something later
// grows or flushes the file (live 2026-09-26: an agent's task end registered 7 min late, on another
// OpenCode's write). OpenCode redraws its screen when a task starts or ends, so its panel's output
// also re-reads the record (400 ms after the output settles).
function nudgeOpenCode(o) {
  clearTimeout(o.nudge);
  o.nudge = setTimeout(() => {
    o.nudge = null;
    if (o.watcher && panes.get(o.paneId)?.opencode === o) {
      readOpenCode(o);
      failedOpenCode(o);
    }
  }, 400);
  o.nudge.unref?.();
}

// ---------- Cursor Agent: its chat transcript (cursor-store.js): a user line starts a task,
// turn_ended ends it, the last assistant text is the answer ----------
function readCursor(c, lines = readLines(c.reader)) {
  let changed = false;
  for (const line of lines) {
    const j = parse(line);
    if (!j) continue;
    if (j.role === 'user') {
      const said = cursor.userText(j);
      if (c.turn && !c.turn.endedAt && c.live) {
        consume(c.paneId, said);
        submitted(c.paneId);
        continue;
      } // sent while it works: part of the running task
      c.turn = {
        paneId: c.paneId,
        agent: 'Cursor Agent',
        source: 'cursor-transcript',
        startedAt: Date.now(),
        endedAt: 0,
        tokens: null,
        task: clip(said, TASK_MAX),
        result: '',
        log: c.reader.file,
      };
      c.answer = '';
      changed = true;
      if (c.live) {
        consume(c.paneId, said);
        submitted(c.paneId);
      }
    } else if (j.role === 'assistant') {
      const text = cursor.assistantText(j);
      if (text) c.answer = text;
    } else if (j.type === 'turn_ended' && c.turn && !c.turn.endedAt) {
      c.turn.endedAt = Date.now();
      c.turn.endedBy = j.status === 'aborted' ? 'aborted' : j.status === 'error' ? 'error' : 'stop';
      c.turn.result = clip(c.answer, RESULT_MAX);
      changed = true;
      settle(c.paneId);

      // read from the chat as it was when it was found (a resumed chat's last task): this end time
      // is the moment of the read, so nothing may treat it as a task that just finished
      // (remote-service.js createTurnReporter)
      if (!c.live) c.turn.history = true;
    }
  }

  // Cursor (2026.10.01) takes its turn_ended line out again when the next prompt comes and writes
  // that prompt's user line in its place, so a reader that stands after turn_ended starts in the
  // middle of the user line and the whole follow-up task is never seen (measured 2026-10-05). The
  // next read therefore starts at that turn_ended line again: unchanged, it is read once more and
  // ignored (the task has ended).
  const lastLine = lines[lines.length - 1];
  if (lastLine && !c.reader.rest && parse(lastLine)?.type === 'turn_ended')
    c.reader.pos = Math.max(0, c.reader.pos - Buffer.byteLength(lastLine) - 1);
  if (!changed || !c.turn) return;
  turns.set(c.paneId, c.turn);
  publish(c.turn);
}

async function attachCursor(paneId, chatId) {
  const p = panes.get(paneId);
  if (
    !p ||
    p.agent !== 'Cursor Agent' ||
    !chatId ||
    p.cursor?.chatId === chatId ||
    p.finding === chatId
  )
    return;
  const file = cursor.transcript(p.cwd, chatId);
  if (!file) return;
  p.finding = chatId;
  try {
    const c = { paneId, chatId, reader: { file, pos: 0, rest: null }, turn: null, answer: '' };

    // The chat so far (its first task may already have started when the chat was found), off the
    // main loop: a long chat is many MB, and a read at once waited on the disk with the whole app
    // held (stalls.log 2026-10-07, perf review app-4 #2).
    const history = taken(c.reader, await readAhead(c.reader)) || [];

    // the pane restarted, its process ended, or another chat attached meanwhile
    if (panes.get(paneId) !== p || p.finding !== chatId) return;
    unwatch(p.cursor);
    p.cursor = c;
    readCursor(c, history);
    c.live = true;
    const follow = () =>
      readLater(c.reader, lines => {
        if (c.watcher) readCursor(c, lines);
      });
    watchFile(c, file, follow);

    // anything written while the history was read
    follow();
  } finally {
    if (p.finding === chatId) p.finding = null;
  }
}

// ---------- Tools run through the ACP connector (acp-connector.js) ----------
// The bridge's own record of the session (one JSON line each): a `user` line is a task sent to the
// agent (the bridge holds a prompt typed while one runs and sends it after, so every user line
// starts a task), `say` lines hold its words, `end` (with the agent's own stop reason) and `error`
// end it. Exact, from the agent over ACP, not read off the screen.
function readAcp(c, lines = readLines(c.reader)) {
  let changed = false;
  for (const line of lines) {
    const j = parse(line);
    if (!j) continue;
    if (j.type === 'user') {
      c.turn = {
        paneId: c.paneId,
        agent: c.agent,
        source: 'acp-record',
        startedAt: j.at || Date.now(),
        endedAt: 0,
        tokens: null,
        task: clip(String(j.text || ''), TASK_MAX),
        result: '',
        log: c.reader.file,
      };
      c.answer = '';
      changed = true;
      if (c.live) {
        consume(c.paneId, String(j.text || ''));
        submitted(c.paneId);
      }
    } else if (j.type === 'say' && typeof j.text === 'string') c.answer = j.text;
    else if (
      (j.type === 'end' || j.type === 'error' || j.type === 'exit') &&
      c.turn &&
      !c.turn.endedAt
    ) {
      c.turn.endedAt = j.at || Date.now();
      c.turn.endedBy =
        j.type === 'end' ? (j.stopReason === 'cancelled' ? 'aborted' : 'stop') : 'error';
      if (j.type !== 'end') c.turn.error = clip(String(j.text || ''), 300);
      c.turn.result = clip(c.answer, RESULT_MAX);
      changed = true;
      settle(c.paneId);
      if (!c.live) c.turn.history = true;
    }
  }
  if (!changed || !c.turn) return;
  turns.set(c.paneId, c.turn);
  publish(c.turn);
}

async function attachAcp(paneId, sessionId) {
  const p = panes.get(paneId);
  if (!p || !sessionId || !require('./agent-registry').isAcp(p.agent)) return;
  if (p.acp?.sessionId === sessionId || p.finding === sessionId) return;
  const file = require('./acp-connector').recordFile(sessionId);
  if (!file) return;
  p.finding = sessionId;
  try {
    const c = {
      paneId,
      sessionId,
      agent: p.agent,
      reader: { file, pos: 0, rest: null },
      turn: null,
      answer: '',
    };

    // a new session's record is written with its first line: the watch waits for it, on the
    // records folder, which is the app's own (made here when it is the first ACP session)
    await fs.promises.mkdir(path.dirname(file), { recursive: true }).catch(() => {});
    const history = taken(c.reader, await readAhead(c.reader).catch(() => null)) || [];
    if (panes.get(paneId) !== p || p.finding !== sessionId) return;
    unwatch(p.acp);
    p.acp = c;
    readAcp(c, history);
    c.live = true;
    const follow = () =>
      readLater(c.reader, lines => {
        if (c.watcher) readAcp(c, lines);
      });
    watchFile(c, file, follow);
    follow();
  } finally {
    if (p.finding === sessionId) p.finding = null;
  }
}

module.exports = {
  init(sender, opts = {}) {
    send = sender;
    if (typeof opts.taskNoted === 'function') taskNoted = opts.taskNoted;
    if (typeof opts.spawnRefused === 'function') spawnRefused = opts.spawnRefused;
    if (typeof opts.compactTasks === 'function') compactTasks = opts.compactTasks;
  },
  claudeHook(paneId, h) {
    try {
      claudeHook(paneId, h);
    } catch {}
  },
  isOpenCode: paneId => panes.get(paneId)?.agent === 'OpenCode',
  cwd: paneId => panes.get(paneId)?.cwd || '',
  openCodeEvent(paneId, m) {
    try {
      return openCodeEvent(paneId, m);
    } catch {
      return '';
    }
  },
  openCodeChild(paneId, id, done) {
    try {
      return openCodeChild(paneId, id, done);
    } catch {
      return null;
    }
  }, // its plugin's busy / idle / error events (agent-hooks.js)
  step(paneId, tool, input) {
    try {
      return openCodeStep(paneId, tool, input);
    } catch {
      return false;
    }
  }, // a live step of a CLI without Claude Code's hooks

  // Every write into a pane (main.js wraps ptys.write), to see prompts submitted while the agent
  // works.
  wrote(paneId, data) {
    try {
      wrote(paneId, data);
    } catch {}
  },
  // agent-mesh.js `tnai intervene`, a moment after its interrupt key: 'reply' = Claude Code paused
  // a task that had begun its reply (its transcript says "[Request interrupted by user"),
  // 'restored' = it had written nothing, so the prompt went back into its input and the task is
  // gone (cancelSoon), '' = not known yet.
  stopped(paneId) {
    const t = turns.get(paneId);
    if (!t) return '';
    if (!t.endedAt)
      try {
        stalls.timed('intervene transcript read', readClaude)(t);
      } catch {}
    return t.endedAt && t.endedBy === 'interrupted' ? (t.cancelled ? 'restored' : 'reply') : '';
  },
  // prompt-submit.js: wait for the CLI to take a prompt; whether this pane can tell at all; whether
  // its task still runs.
  onSubmit(paneId, fn) {
    if (!submitWaiters.has(paneId)) submitWaiters.set(paneId, new Set());
    submitWaiters.get(paneId).add(fn);
    return () => {
      const s = submitWaiters.get(paneId);
      s?.delete(fn);
      if (s && !s.size) submitWaiters.delete(paneId);
    };
  },
  canConfirm(paneId, agent) {
    return (
      agent === 'Claude Code' ||
      (agent === 'Codex' && !!panes.get(paneId)?.codex?.live) ||
      (agent === 'OpenCode' && !!panes.get(paneId)?.opencode?.live) ||
      (agent === 'Cursor Agent' && !!panes.get(paneId)?.cursor?.live)
    );
  },
  busy(paneId) {
    const t = turns.get(paneId);
    return !!(t && t.startedAt && !t.endedAt);
  },
  // That panel's turn with the whole prompt its CLI reported for it (remote-say.js: who started a
  // turn, and whether a turn is the one a message from another computer started). prompt is null
  // for a CLI whose prompt is not kept whole (Codex, Cursor Agent).
  promptOf(paneId) {
    const t = turns.get(paneId);
    return t
      ? {
          startedAt: t.startedAt || 0,
          endedAt: t.endedAt || 0,
          prompt: typeof t.prompt === 'string' ? t.prompt : null,
        }
      : null;
  },
  // Called with the paneId once per task, when it ends (finished, interrupted, or its process
  // ended).
  onEnd(fn) {
    endListeners.add(fn);
    return () => endListeners.delete(fn);
  },
  // Called with the paneId once per task, when it starts (change-review.js).
  onStart(fn) {
    startListeners.add(fn);
    return () => startListeners.delete(fn);
  },
  // pty:start: a new process for the pane starts with no turn; a resumed Codex session is attached
  // at once.
  started(paneId, agent, accountDir, sessionId, cwd) {
    this.forget(paneId);
    panes.set(paneId, { agent, accountDir: accountDir || '', cwd: cwd || '' });
    if (agent === 'Codex' && sessionId) attachCodex(paneId, sessionId).catch(() => {});
    if (agent === 'OpenCode' && sessionId) attachOpenCode(paneId, sessionId);

    // a resumed chat (`--resume`) shows its last task
    if (agent === 'Cursor Agent' && sessionId) attachCursor(paneId, sessionId).catch(() => {});

    // a tool run through the ACP connector: its record is named by the id given at start, so it
    // is watched from its first line (a reopened one shows its last task)
    if (sessionId && require('./agent-registry').isAcp(agent))
      attachAcp(paneId, sessionId).catch(() => {});
  },
  // Events from pty-service: Codex's session id found; a process ended mid-task ends the task.
  fromPty(channel, payload) {
    try {
      if (channel === 'pty:data') {
        for (const d of payload || []) {
          const o = panes.get(d?.paneId)?.opencode;
          if (o?.live) nudgeOpenCode(o);
        }
        return;
      }
      if (channel === 'pty:session') {
        attachCodex(payload.paneId, payload.sessionId).catch(() => {});
        attachOpenCode(payload.paneId, payload.sessionId);
        attachCursor(payload.paneId, payload.sessionId).catch(() => {});
        attachAcp(payload.paneId, payload.sessionId).catch(() => {});
      }
      if (channel === 'pty:exit') {
        // The process is gone: its transcript / rollout watchers close (the turn itself stays
        // shown), and a rollout still being looked up is dropped.
        const p = panes.get(payload.paneId);
        if (p) p.finding = null;
        const last = turns.get(payload.paneId),
          t0 = performance.now();
        if (p?.codex?.watcher) readCodex(p.codex);
        else if (p?.opencode?.watcher) readOpenCode(p.opencode);
        else if (p?.cursor?.watcher) readCursor(p.cursor);
        else if (p?.acp?.watcher) readAcp(p.acp);

        // a change still waiting on the debounce
        else if (last?.agent === 'Claude Code' && last.watcher) readClaude(last);
        unwatch(last);
        unwatch(p?.codex);
        unwatch(p?.opencode);
        unwatch(p?.cursor);
        unwatch(p?.acp);
        const t = turns.get(payload.paneId);
        if (t && !t.endedAt) {
          t.endedAt = Date.now();
          t.endedBy = 'exit';
        }
        queues.delete(payload.paneId);
        pasted.delete(payload.paneId);
        if (t) publish(t);
        stalls.ran('turn end on exit', performance.now() - t0);
      } // a named section (stall-log.js): the last read at once
    } catch {}
  },
  forget(paneId) {
    const t = turns.get(paneId),
      p = panes.get(paneId);
    unwatch(t);
    unwatch(p?.codex);
    unwatch(p?.opencode);
    unwatch(p?.cursor);
    unwatch(p?.acp);
    queues.delete(paneId);
    pasted.delete(paneId);
    checklists.delete(paneId);
    clearTimeout(sent.get(paneId)?.timer);
    sent.delete(paneId);
    opencode.forget(paneId);
    const had = turns.delete(paneId);
    panes.delete(paneId);
    if (had) send('agent:turn', { paneId, cleared: true });
  },
  state: () => [...turns.values()].filter(t => t.startedAt).map(publicTurn),
  // plain-Node checks only (tools/desktop-check/links-check.js)
  _test: { claudeClearedIn },
};
