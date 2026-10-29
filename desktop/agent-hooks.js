// Technically Not desktop · agent-hooks.js — Live agent events straight from Claude Code, not from
// terminal text: per-session HTTP hooks (session ready, prompts, tool calls, sub-agents
// starting/stopping with their final message, tool-permission prompts held open for an answer in
// Technically Not's window) and an MCP connection whose tools/list call marks the session ready (no
// tools, except custom agents' delegation tools from agent-graph.js). Localhost only; each session
// gets its own secret URL.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const attachments = require('./attachment-service');
const turns = require('./agent-turns');
const graph = require('./agent-graph');
const previewControl = require('./preview-control');

// is a request's short text the whole request (pure: requiring it touches no key and opens nothing)
const { wholeShell } = require('./remote-api.js');
const errors = require('./agent-errors');

// 'whole', 'full' or '': how a held shell request may be answered from another computer (pure, like
// the line above)
const { answerWay } = require('./remote-control.js');

// stuck-loop check: same call, same result, over and over (push agent:loop)
const loops = require('./agent-loops');
const lifecycle = require('./agent-lifecycle');

// shell commands that would stash/reset/restore the shared folder are denied
const { guard: gitGuard } = require('./git-guard');
const context = require('./agent-context');
const peers = require('./agent-peers');

// app notices held for a working agent: handed over after its next tool call
const notices = require('./agent-notices');
const skillTriggers = require('./skill-triggers');
const skillStats = require('./skill-stats');
const stalls = require('./stall-log');

// OpenCode's permission requests and questions, from its panel's own server
const openCodeLink = require('./opencode-link');

// the user's connections (MCP servers) passed per session beside `tnai` (connections.js)
const connections = require('./connections');
const everywhereSkills = () => require('./skill-service').everywhereSkillFiles();

// tools whose file can call up the skill that owns it
const FILE_TOOLS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const HISTORY = 400; // events kept per pane so a reloaded window can rebuild the sub-agent view
const TEXT_MAX = 6000; // longest prompt / result text passed to the UI

// paneId -> { token, events: [], allowed: Set (deprecated, use globalAllowed) }
const panes = new Map();

// token -> paneId (a restarted pane gets a new token, so an old process can't post)
const tokens = new Map();

// scope.key -> true (permissions allowed for the entire Technically Not session, across all
// panes/agents)
const globalAllowed = new Map();
let server = null,
  port = 0,
  seq = 0,
  send = () => {};
let projectRoot = () => '';

// remote-say.js, handed in by main.js. sayTurn(paneId): that panel is in a turn a message from
// another computer's agent started, so no permission request in it is answered from the remembered
// list. modeSeen(paneId, mode): a hook named the CLI's permission mode.
let sayTurn = () => false,
  modeSeen = () => {};
let locks = null,
  // file-locks.js and mesh.owner (main.js): Claude Code's edits take a file lock first
  lockOwner = null;
const LOCK_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

// change-review.js (main.js): a copy of each file an edit is about to change, taken while the edit
// waits for the app (Claude Code's PreToolUse, OpenCode's gate, Codex's and Cursor Agent's
// preToolUse step), so the thread can undo that one file later. Never fails the edit.
let beforeEdit = () => Promise.resolve();

async function copyBeforeEdit(paneId, tool, input) {
  try {
    await beforeEdit(paneId, tool, input);
  } catch (e) {
    console.warn('[tnai] change review copy failed:', e?.message || e);
  }
}

// '' = go ahead, else why the edit is denied: another agent holds the file. In-panel sub-agents
// share their panel's lock.
async function lockDenied(paneId, h) {
  const f = h.tool_input?.file_path || h.tool_input?.notebook_path;
  if (!locks || !lockOwner || typeof f !== 'string' || !f) return '';
  const owner = await lockOwner(paneId);
  if (!owner) return '';

  // whole: Write and NotebookEdit rewrite the whole file on disk, exclusive for a moment even
  // inside a user's team (file-locks.js WHOLE_MS)
  // call: the edit's id, so its end (editDone) ends only this edit, not an overlapping one
  const r = locks.acquire(owner.project, f, {
    ...owner,
    edit: true,
    whole: h.tool_name === 'Write' || h.tool_name === 'NotebookEdit',
    call: h.tool_use_id || '',
  });
  if (r.ok) editStarted(paneId, h.tool_use_id, owner.project, f, !!r.taken);
  return r.ok
    ? ''
    : 'File lock (Technically Not): ' + r.text + '\n' + errors.line(r.code || 'locked', r.hint);
}

// The edits of each panel whose file lock was taken before the edit ran (app-3 #12): the lock is
// taken on PreToolUse, before the permission answer, so an edit the user then denies, or one that
// fails, would hold the file for nothing. Per panel and file: { project, file, taken, calls: Set of
// call ids still running, edited: one of them went through }.
const editCalls = new Map();
const editKey = (paneId, file) => paneId + '\n' + String(file);

function editStarted(paneId, call, project, file, taken) {
  if (!call) return;
  const key = editKey(paneId, file);
  const entry = editCalls.get(key) || { project, file, taken, calls: new Set(), edited: false };
  entry.calls.add(String(call));
  editCalls.set(key, entry);
}

// An edit call ended: ok, or failed / denied. When the last running call of that file ends and none
// of them went through, a lock that call took is given back. Returns whether it was given back.
function editEnded(paneId, call, ok) {
  for (const [key, entry] of editCalls) {
    if (!key.startsWith(paneId + '\n') || !entry.calls.delete(String(call))) continue;
    if (ok) entry.edited = true;
    if (entry.calls.size) return false;
    editCalls.delete(key);
    if (!entry.taken || entry.edited || !locks) return false;
    return locks.release(entry.project, [entry.file], paneId).released.length > 0;
  }
  return false;
}

// The panel's turn ended or it is gone: its running edits are over (file-locks.js ends its locks
// itself when the task ends).
function editsForgotten(paneId) {
  for (const key of [...editCalls.keys()]) if (key.startsWith(paneId + '\n')) editCalls.delete(key);
}

// How every agent Technically Not starts should work: Technically Not's hidden program skills, one
// .md file each in desktop/hidden-skills/ (edit there; see its README), read once at startup by
// hidden-skills.js. Not skill folders, so they hold even if skill folders are deleted and no skill
// list or CLI /skills shows them. Claude Code gets them in its system prompt below (a file,
// promptFile); other CLIs through their own instruction settings (agent-registry.js `rules`): Codex
// developer_instructions, OpenCode an instructions file, Cursor Agent an always-applied plugin
// rule. Not removable: Technically Not's features (the Technically Not report, tnai commands)
// depend on them.
const hiddenSkills = require('./hidden-skills');
const HIDDEN_VARS = { 'tnai-mesh-hint': require('./agent-mesh').hint };

// User settings that turn `when:` hidden skills on or off (Settings › Agents), in
// userData/agent-rules.json; read at each launch, so a change reaches agents started after it.
// write-skills (default on): agents may save reusable procedures as skills (60-write-skills.md).
// browser-use (default off, the user opts in; Settings › Agents › Use Claude in Chrome): Claude
// Code agents start with Claude in Chrome (--chrome) and its how-to rule (47-chrome-browser.md).
const RULE_DEFAULTS = { 'write-skills': true, 'browser-use': false };
const rulesFile = () => path.join(app.getPath('userData'), 'agent-rules.json');

function ruleFlags() {
  try {
    return { ...RULE_DEFAULTS, ...JSON.parse(fs.readFileSync(rulesFile(), 'utf8')) };
  } catch {
    return { ...RULE_DEFAULTS };
  }
}

function setRuleFlags(patch = {}) {
  const next = ruleFlags();
  for (const k of Object.keys(RULE_DEFAULTS)) if (typeof patch[k] === 'boolean') next[k] = patch[k];
  fs.writeFileSync(rulesFile(), JSON.stringify(next, null, 2));
  return next;
}
const workRules = () => hiddenSkills.lines('every-agent', HIDDEN_VARS, ruleFlags());

// Claude Code only (`for: claude-code` files): Technically Not shows its work, sub-agents included,
// from its own hooks; whether to use sub-agents is the agent's call (or the user's).
const leadPrompt = () =>
  [...hiddenSkills.lines('claude-code', HIDDEN_VARS, ruleFlags()), '', ...workRules()].join('\n');

// OpenCode only (`for: opencode` files): the part of the lead rules that is true for it (it leads
// through tnai_delegate and `tnai new`), in front of the work rules.
const openCodeRules = rules =>
  [...hiddenSkills.lines('opencode', HIDDEN_VARS, ruleFlags()), '', ...rules].join('\n') + '\n';

const clip = (text, max = TEXT_MAX) => {
  const s = typeof text === 'string' ? text : text == null ? '' : JSON.stringify(text);
  return s.length > max ? s.slice(0, max) + '…' : s;
};
let dirMade = '';
const dir = () => {
  const d = path.join(app.getPath('userData'), 'agent-hooks');
  if (dirMade !== d) {
    fs.mkdirSync(d, { recursive: true });
    dirMade = d;
  }
  return d;
};

// Files every pane shares (work rules, the rules plugin): rewritten only when their text changed,
// not on every launch (sync writes on the main process).
const written = new Map(); // file -> text written this run

function writeShared(file, text) {
  if (written.get(file) === text && fs.existsSync(file)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  written.set(file, text);
}

// Background commands (bg-start above): where Claude Code writes each one's output, so the window
// can show its latest line (bgTail). The path is worked out here from the session's own transcript
// path, never taken from the window.
const bgFiles = new Map(); // task id -> output file

function bgNote(taskId, h) {
  const t = String(h.transcript_path || '');
  if (!/\.jsonl$/.test(t) || !/^[\w-]{1,80}$/.test(taskId)) return;
  bgFiles.set(
    taskId,
    path.join(
      require('os').tmpdir(),
      'claude',
      path.basename(path.dirname(t)),
      path.basename(t, '.jsonl'),
      'tasks',
      taskId + '.output'
    )
  );
  if (bgFiles.size > 200) bgFiles.delete(bgFiles.keys().next().value);
}

// { line, exit, bytes }: the newest output line of a background command, its exit code once it
// ended (null while running), and how much it wrote.
function bgTail(taskId) {
  const file = bgFiles.get(String(taskId || ''));
  if (!file) return null;
  try {
    const fd = fs.openSync(file, 'r'),
      size = fs.fstatSync(fd).size,
      len = Math.min(size, 4096),
      buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf
      .toString('utf8')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
    const done = /^\[exited with code (-?\d+)\]$/.exec(lines[lines.length - 1] || '');
    if (done) lines.pop();
    return {
      line: (lines.pop() || '').slice(0, 300),
      exit: done ? Number(done[1]) : null,
      bytes: size,
    };
  } catch {
    return { line: '', exit: null, bytes: 0 };
  }
}

function emit(paneId, event) {
  const pane = panes.get(paneId);
  if (!pane) return;
  const e = { paneId, seq: ++seq, at: Date.now(), ...event };
  pane.events.push(e);
  if (pane.events.length > HISTORY) pane.events.splice(0, pane.events.length - HISTORY);
  send('agent:event', e);
  graph.onEvent(paneId, e); // custom agents' task graph: sub-agent ready / done, parent idle
}

// A short "what it's doing" line for a tool call: the file, command, pattern, or URL it names.
function toolDetail(input = {}) {
  const v =
    input.file_path ||
    input.notebook_path ||
    input.path ||
    input.command ||
    input.pattern ||
    input.url ||
    input.query ||
    input.description ||
    input.skill ||
    '';
  return clip(String(v).split(/\r?\n/)[0], 160);
}

// Agent tool result: its text, and the sub-agent id it names ("agentId: …"), which ties the call to
// SubagentStart/Stop.
function agentResult(response) {
  const parts = Array.isArray(response)
    ? response
    : Array.isArray(response?.content)
      ? response.content
      : [response];
  const text =
    parts
      .map(p => (typeof p === 'string' ? p : p?.text || ''))
      .join('\n')
      .trim() || (typeof response === 'string' ? response : '');
  const id = response?.agentId || response?.agent_id || /agentId:\s*([\w-]+)/.exec(text)?.[1] || '';

  // A background sub-agent (Claude Code's default now, or run_in_background) returns at once with
  // only a launch notice ({ isAsync: true, status: 'async_launched' }); its real output comes later
  // with SubagentStop.
  const async =
    !!response?.isAsync ||
    /async/i.test(response?.status || '') ||
    /^Async agent launched/.test(text);
  return {
    text: async ? '' : clip(text.replace(/\n?agentId:[\s\S]*$/, '').trim()),
    agentId: id,
    status: response?.status || '',
    async,
  };
}

// A finished sub-agent's final words when SubagentStop doesn't carry them: the last assistant text
// (or hand-back message) in its transcript, read once on the stop event. '' when there is no
// transcript to read. Only the file's last 64 KB, read async so a long sub-agent transcript never
// blocks the hook handler.
const TAIL = 64 * 1024;

async function subagentFinalText(h) {
  let file = h.agent_transcript_path;
  if (!file && h.transcript_path && h.agent_id)
    file = path.join(
      h.transcript_path.replace(/\.jsonl$/, ''),
      'subagents',
      'agent-' + h.agent_id + '.jsonl'
    );
  try {
    const fh = await fs.promises.open(file, 'r');
    let data = '';
    try {
      const size = (await fh.stat()).size,
        start = Math.max(0, size - TAIL),
        buf = Buffer.alloc(size - start);
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      data = buf.toString('utf8', 0, bytesRead);
      if (start > 0) data = data.slice(data.indexOf('\n') + 1); // drop the cut-off first line
    } finally {
      await fh.close().catch(() => {});
    }
    const lines = data.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      let m;
      try {
        m = JSON.parse(lines[i])?.message;
      } catch {
        continue;
      }
      if (m?.role !== 'assistant' || !Array.isArray(m.content)) continue;
      const text = m.content
        .map(c => (c.type === 'text' ? c.text : c.type === 'tool_use' && c.input?.message) || '')
        .filter(Boolean)
        .join('\n')
        .trim();
      if (text) return text;
    }
  } catch {}
  return '';
}

// Claude Code's multiple-choice picker (AskUserQuestion): each question with its numbered options,
// as the terminal shows them.
function askedQuestions(input) {
  return (Array.isArray(input.questions) ? input.questions : []).slice(0, 4).map(q => ({
    question: clip(q?.question || q?.header || '', 300),
    options: (Array.isArray(q?.options) ? q.options : [])
      .slice(0, 6)
      .map(o => clip(typeof o === 'string' ? o : o?.label || '', 80))
      .filter(Boolean),
  }));
}

// A turn that ended by asking the user something in plain text: the last paragraph ends with "?",
// or a question is followed only by a numbered/bulleted list of choices ("1. … 2. …"). Inferred
// from the agent's words; '' when it didn't ask.
function endingQuestion(text) {
  const lines = String(text || '')
    .trim()
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  if (!lines.length) return '';
  let end = lines.length;

  // trailing choices
  while (end > 1 && /^(\d+[.)]|[-*•]|\(?[a-z]\))\s+/i.test(lines[end - 1])) end--;
  const q = lines[end - 1];
  if (!/\?\**\s*$/.test(q)) return '';
  return clip(q.replace(/\*\*/g, ''), 200);
}
const SPAWN_TOOLS = new Set(['Agent', 'Task']);

function onHook(paneId, h) {
  const sub = h.agent_id ? { agentId: h.agent_id, agentType: h.agent_type || '' } : {};
  switch (h.hook_event_name) {
    case 'UserPromptSubmit': {
      // A background sub-agent's hand-back arrives as a "<task-notification>" turn, not a new task
      // from the user.
      const note = /^\s*<task-notification>([\s\S]*?)<\/task-notification>/.exec(h.prompt || '');
      if (!note) return emit(paneId, { kind: 'prompt', text: clip(h.prompt) });
      const tag = name =>
        (new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>').exec(note[1])?.[1] || '').trim();
      return emit(paneId, {
        kind: 'sub-note',
        agentId: tag('task-id'),
        toolUseId: tag('tool-use-id'),
        status: tag('status'),
        text: clip(tag('result') || tag('summary')),
      });
    }
    case 'PreToolUse': {
      const input = h.tool_input || {};
      if (h.tool_name === 'AskUserQuestion')
        return emit(paneId, { kind: 'ask', ...sub, questions: askedQuestions(input) });
      if (SPAWN_TOOLS.has(h.tool_name))
        return emit(paneId, {
          kind: 'spawn',
          ...sub,
          toolUseId: h.tool_use_id || '',
          type: input.subagent_type || 'general-purpose',
          name: input.name || '',
          description: clip(input.description || '', 200),
          prompt: clip(input.prompt || ''),
          background: !!input.run_in_background,
        });

      // label: the agent's own plain words for a command
      return emit(paneId, {
        kind: 'tool',
        ...sub,
        tool: h.tool_name || '',
        detail: toolDetail(input),
        label: clip(input.description || '', 160),
      });
    }
    case 'PostToolUse':
      if (h.tool_name === 'AskUserQuestion') return emit(paneId, { kind: 'ask-done', ...sub });
      if (SPAWN_TOOLS.has(h.tool_name))
        return emit(paneId, {
          kind: 'spawn-result',
          ...sub,
          toolUseId: h.tool_use_id || '',
          result: agentResult(h.tool_response),
        });
      {
        // A background task it started (Bash/PowerShell run_in_background, Monitor, Workflow): it
        // keeps running after the turn ends, until its "<task-notification>" hand-back (sub-note,
        // same task id) or a TaskStop. The window's "Working in background" (10).
        const r = h.tool_response || {},
          input = h.tool_input || {};
        const taskId =
          r.backgroundTaskId ||
          (/^(Monitor|Workflow)$/.test(h.tool_name || '') && (r.taskId || r.task_id)) ||
          '';
        if (taskId) bgNote(String(taskId), h);
        if (taskId)
          return emit(paneId, {
            kind: 'bg-start',
            ...sub,
            taskId: String(taskId),
            toolUseId: h.tool_use_id || '',
            tool: h.tool_name || '',
            detail: toolDetail(input),
            label: clip(input.description || '', 160),
          });
        if (/^(TaskStop|KillShell)$/.test(h.tool_name || '') && (input.task_id || input.shell_id))
          return emit(paneId, { kind: 'bg-end', taskId: String(input.task_id || input.shell_id) });
      }
      return;

    // A launch the permission / auto-mode check refused (or that failed before running): PreToolUse
    // already showed its card.
    case 'PostToolUseFailure':
      if (SPAWN_TOOLS.has(h.tool_name))
        return emit(paneId, { kind: 'spawn-refused', ...sub, toolUseId: h.tool_use_id || '' });
      return;
    case 'SubagentStart':
      return emit(paneId, {
        kind: 'sub-start',
        agentId: h.agent_id || '',
        agentType: h.agent_type || '',
      });
    case 'SubagentStop': {
      const stop = text =>
        emit(paneId, {
          kind: 'sub-stop',
          agentId: h.agent_id || '',
          agentType: h.agent_type || '',
          text: clip(text),
        });
      if (h.last_assistant_message) return stop(h.last_assistant_message);
      return void subagentFinalText(h).then(stop, () => stop(''));
    }
    case 'Stop':
      return emit(paneId, {
        kind: 'stop',
        text: clip(h.last_assistant_message || '', 600),
        question: endingQuestion(h.last_assistant_message),
      });

    // A compact begins. trigger: 'manual' (/compact) or 'auto' (the context was full). It ends
    // when the conversation's record gets its compact line (thread-log readers, 158).
    case 'PreCompact':
      return emit(paneId, { kind: 'compact-start', trigger: String(h.trigger || '') });

    // Claude Code 2.1.284 fires StopFailure instead of Stop when an API error (usage/rate limit,
    // auth failure…) ended the turn: stopped, no answer.
    case 'StopFailure':
      return emit(paneId, {
        kind: 'stop',
        text: clip(h.last_assistant_message || '', 600),
        error: clip(String(h.error || h.error_details || 'API error'), 200),
        question: null,
      });
  }
}

// Live steps of a CLI without Claude Code's hooks, posted by its own event source to /step/<token>
// (OpenCode: stepPlugin below; checked with one real prompt, opencode 1.18.34). Only the tool call
// becomes an event: the task's start and end still come from the CLI's own record (agent-turns.js;
// OpenCode's plugin also says when to read it, openCodeEvent), and the ended turn clears the card's
// Now line (19, 53). Tool names are mapped to Claude Code's so the same words and file activity
// apply; an unknown tool keeps its own name.
// Shell: Cursor Agent's name
const STEP_TOOLS = {
  bash: 'Bash',
  read: 'Read',
  edit: 'Edit',
  write: 'Write',
  grep: 'Grep',
  glob: 'Glob',
  webfetch: 'WebFetch',
  websearch: 'WebSearch',
  todowrite: 'TodoWrite',
  task: 'Task',
  skill: 'Skill',
  Shell: 'Bash',
};

function onStep(paneId, m) {
  // Codex's own hook payload (codexStep below; main agent only) and Cursor Agent's (cursorStep;
  // "preToolUse"). Since cursor-agent 2026.10.17 the hook also fires inside its sub-agents, and
  // such a call carries parent_tool_call_id: the lead's Task call that started that sub-agent
  // (read in cursor-agent 2026.10.22's own code). That id tags the step as the helper's, as
  // Claude Code's agent_id does, so the window never shows it as the lead's own Now line.
  let cursorHelper = '';
  if (/^preToolUse$/i.test(m?.hook_event_name || '') && !m.agent_id) {
    if (typeof m.parent_tool_call_id === 'string')
      cursorHelper = m.parent_tool_call_id.slice(0, 80);
    m = { event: 'tool', tool: m.tool_name, input: m.tool_input };
  }

  // OpenCode's task and tool-end events (below)
  if (m && typeof m.event === 'string' && m.event !== 'tool') return openCodeEvent(paneId, m);
  if (m?.event !== 'tool' || !m.tool || typeof m.tool !== 'string') return;
  const input = m.input && typeof m.input === 'object' ? m.input : {};

  // OpenCode's own sub-agents (its task tool starts a child session; one real run, opencode
  // 1.18.35, 2026-10-06) are told with the events Claude Code's hooks give for a sub-agent, so the
  // window needs no OpenCode branch: the task call is a 'spawn' (description, prompt and type from
  // its arguments), and a call inside a child session carries that session's id as agentId and its
  // agent name as agentType.
  const oc = turns.isOpenCode(paneId) ? openCodeState(paneId) : null,
    low = m.tool.toLowerCase(),
    call = typeof m.call === 'string' ? m.call.slice(0, 80) : '';
  const kidId = oc && m.child && typeof m.session === 'string' ? m.session.slice(0, 80) : '';
  let sub = {};
  if (kidId) sub = { agentId: kidId, agentType: oc.children.get(kidId)?.agent || '' };
  else if (cursorHelper) sub = { agentId: cursorHelper, agentType: '' };
  if (oc && low === 'task')
    emit(paneId, {
      kind: 'spawn',
      ...sub,
      toolUseId: call,
      type: clip(input.subagent_type || 'general', 60),
      name: '',
      description: clip(input.description || '', 200),
      prompt: clip(input.prompt || ''),
      background: false,
    });
  else
    emit(paneId, {
      kind: 'tool',
      ...sub,
      tool: STEP_TOOLS[m.tool] || clip(m.tool, 60),
      detail: toolDetail({
        ...input,
        file_path: input.file_path || input.filePath,
        skill: input.skill || input.name,
      }),
      label: clip(input.description || '', 160),
    });

  // OpenCode only (agent-turns.js knows the panel's CLI): its to-do list is the task's checklist,
  // and a file it edits counts as this task's (agent-context.js), as with Claude Code's hooks; its
  // patch tool names its files inside the patch text. The call also goes to the loop check and, for
  // a shell command, to the file locks' run timing, as Claude Code's PreToolUse does; its end comes
  // as 'tool-end' (openCodeEvent).
  try {
    if (!oc) return;
    if (!kidId) turns.step(paneId, m.tool, input); // a child session's to-do list is its own
    const f = input.filePath || input.file_path,
      o = oc;
    const files = OPENCODE_PATCH.has(low)
      ? patchFiles(paneId, input.patchText)
      : OPENCODE_EDITS.has(low) && typeof f === 'string' && f
        ? [f]
        : [];
    for (const file of files)
      context.hook(paneId, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: file },
      });
    const h = {
      tool_name: STEP_TOOLS[m.tool] || clip(m.tool, 60),
      tool_input: files.length ? { ...input, file_path: files[0] } : input,
      tool_use_id: call,
      ...(kidId ? { agent_id: kidId, agent_type: sub.agentType } : {}),
    };
    if (call) {
      o.calls.set(call, h);
      if (o.calls.size > 50) o.calls.delete(o.calls.keys().next().value);
    }
    loops.hook(paneId, { hook_event_name: 'PreToolUse', ...h });
    if (low === 'bash' && call && locks && lockOwner)
      lockOwner(paneId)
        .then(owner => {
          if (owner && o.calls.has(call)) locks.shellStart(paneId, call, owner, input.timeout);
        })
        .catch(() => {});
  } catch {}
}
const OPENCODE_EDITS = new Set(['edit', 'write', 'multiedit']),
  OPENCODE_PATCH = new Set(['apply_patch', 'patch']);

// The files an OpenCode patch names ("*** Add File: a.js", Update, Delete, "*** Move to:"; opencode
// 1.18.35's apply_patch, read from its own text, not yet seen from a real call), made absolute from
// the panel's folder.
function patchFiles(paneId, text) {
  const base = turns.cwd(paneId) || projectRoot();
  return [
    ...String(text || '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): *(.+?)\s*$/gm),
  ]
    .slice(0, 50)
    .map(x => (path.isAbsolute(x[1]) || !base ? x[1] : path.resolve(base, x[1])));
}

// What an OpenCode panel's plugin told the app (kept per start of its CLI): its own server address,
// open tool calls, and, recorded only for now, the permission requests and questions that wait and
// its child sessions (OpenCode's own sub-agents).
function openCodeState(paneId) {
  const p = panes.get(paneId);
  return p
    ? p.openCode ||
        (p.openCode = {
          server: '',
          calls: new Map(),
          permissions: new Map(),
          questions: new Map(),
          children: new Map(),
        })
    : null;
}
const keep = (map, id, value, max = 50) => {
  map.set(id, value);
  if (map.size > max) map.delete(map.keys().next().value);
};

function openCodeEvent(paneId, m) {
  if (!turns.isOpenCode(paneId)) return;
  const o = openCodeState(paneId);
  if (!o) return;
  const p = m.properties && typeof m.properties === 'object' ? m.properties : {},
    id = v => (typeof v === 'string' ? v.slice(0, 80) : '');

  // no window listens yet: wave 2 draws these
  const tell = (kind, more) => send('agent:opencode', { paneId, kind, at: Date.now(), ...more });
  switch (m.event) {
    case 'server':
      o.server = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/?$/.test(m.url || '')
        ? m.url
        : '';
      return;

    // A tool call ended: its result's mark (never its text) for the loop check, and a shell
    // command's end for the file locks. A refused call (gateDenied) was never reported as a step,
    // so its failed end finds nothing here.
    case 'tool-end': {
      const call = id(m.call),
        h = o.calls.get(call);
      if (!h) return;
      o.calls.delete(call);
      loops.hook(paneId, {
        hook_event_name: m.failed ? 'PostToolUseFailure' : 'PostToolUse',
        ...h,
        tool_response: clip(String(m.result || ''), 80),
      });
      if (h.tool_name === 'Bash' && locks) locks.shellEnd(paneId, call);

      // a failed edit gives back the file lock its gate call took (editEnded)
      editEnded(paneId, call, !m.failed);

      // a child's tokens so far, on its turn's sub-agent count
      if (h.agent_id) turns.openCodeChild(paneId, h.agent_id, false);

      // The task call returned: its child session is named by the call's own result
      // (metadata.sessionId), which settles which card it was, as Claude Code's Agent result does.
      // A call that failed without ever starting a child is a refused launch.
      if (h.tool_name === 'Task') {
        const from = h.agent_id ? { agentId: h.agent_id, agentType: h.agent_type || '' } : {},
          kid = o.children.get(id(m.sub));
        if (m.failed && !kid) emit(paneId, { kind: 'spawn-refused', ...from, toolUseId: call });
        else
          emit(paneId, {
            kind: 'spawn-result',
            ...from,
            toolUseId: call,
            result: {
              text: clip(kid ? turns.openCodeChild(paneId, kid.id, true)?.text || '' : ''),
              agentId: kid ? kid.id : '',
              status: m.failed ? 'error' : 'completed',
              async: false,
            },
          });
      }
      return;
    }

    // A child session (parentID set; `agent` is its agent's name, e.g. "general"): OpenCode's own
    // sub-agent has started.
    case 'session.created': {
      const c = {
        id: id(m.session),
        parent: id(m.parent),
        agent: clip(m.agent || 'general', 60),
        title: clip(m.title || '', 200),
        at: Date.now(),
        done: false,
      };
      if (c.id) {
        keep(o.children, c.id, c);
        emit(paneId, { kind: 'sub-start', agentId: c.id, agentType: c.agent });
      }
      return;
    }
    case 'permission.asked': {
      const q = {
        id: id(p.id),
        session: id(m.session),
        child: !!m.child,
        permission: clip(p.permission || '', 80),
        patterns: (Array.isArray(p.patterns) ? p.patterns : []).slice(0, 10).map(x => clip(x, 300)),
        at: Date.now(),
      };
      if (q.id) {
        keep(o.permissions, q.id, q);
        tell('permission', q);
      }
      return;
    }
    case 'permission.replied': {
      const q = id(p.requestID || p.permissionID || p.id);
      if (o.permissions.delete(q))
        tell('permission', { id: q, done: true, reply: clip(p.reply || p.response || '', 20) });
      return;
    }
    case 'question.asked': {
      const q = {
        id: id(p.id),
        session: id(m.session),
        child: !!m.child,
        questions: (Array.isArray(p.questions) ? p.questions : []).slice(0, 4).map(x => ({
          question: clip(x?.question || x?.header || '', 300),
          options: (Array.isArray(x?.options) ? x.options : [])
            .slice(0, 6)
            .map(y => clip(typeof y === 'string' ? y : y?.label || '', 80)),
        })),
        at: Date.now(),
      };
      if (q.id) {
        keep(o.questions, q.id, q);
        tell('question', q);
      }
      return;
    }
    case 'question.replied':
    case 'question.rejected': {
      const q = id(p.requestID || p.questionID || p.id);
      if (o.questions.delete(q)) tell('question', { id: q, done: true });
      return;
    }
    case 'todo.updated':
      if (!m.child && Array.isArray(p.todos)) turns.step(paneId, 'todowrite', { todos: p.todos });
      return;

    // Busy / idle / error of the panel's own session: agent-turns.js reads the record at once and
    // ends a failed task. Idle is the turn's end for the loop check and the shell timing, as Claude
    // Code's Stop is.
    case 'session.status':
    case 'session.idle':
    case 'session.error':
      // A child session going idle is its sub-agent's end: its last text and tokens come from
      // OpenCode's record (the plugin sends no text).
      if (m.child) {
        const kid = o.children.get(id(m.session));
        if (!kid || kid.done || !(m.event === 'session.idle' || p.status?.type === 'idle')) return;
        kid.done = true;
        loops.hook(paneId, { hook_event_name: 'SubagentStop', agent_id: kid.id });
        emit(paneId, {
          kind: 'sub-stop',
          agentId: kid.id,
          agentType: kid.agent,
          text: clip(turns.openCodeChild(paneId, kid.id, true)?.text || ''),
        });
        return;
      }
      if (turns.openCodeEvent(paneId, m) !== 'idle') return;
      o.calls.clear();
      o.permissions.clear();
      o.questions.clear();
      loops.hook(paneId, { hook_event_name: 'Stop' });
      if (locks) locks.shellStop(paneId);
      editsForgotten(paneId);
      return;
  }
}

// OpenCode's plugin asks before a tool that changes files (/gate/<token>, the one call it waits on:
// 2 s, then the tool runs): the same decisions Claude Code's PreToolUse gets, the git guard for a
// shell command and the file lock for an edit. '' = go ahead. A child session's tools (OpenCode's
// own sub-agents) ask too and share their panel's lock.
async function gateDenied(paneId, m) {
  if (!turns.isOpenCode(paneId)) return '';
  const tool = String(m?.tool || '').toLowerCase(),
    input = m?.input && typeof m.input === 'object' ? m.input : {};
  if (tool === 'bash') return gitGuard(input.command) || '';
  const files = OPENCODE_PATCH.has(tool)
    ? patchFiles(paneId, input.patchText)
    : OPENCODE_EDITS.has(tool)
      ? [input.filePath || input.file_path]
      : [];
  for (const f of files) {
    const deny =
      typeof f === 'string' && f
        ? await lockDenied(paneId, {
            tool_name: tool === 'write' ? 'Write' : 'Edit',
            tool_input: { file_path: f },
            tool_use_id: typeof m.call === 'string' ? m.call.slice(0, 80) : '',
          })
        : '';
    if (deny) return deny;
  }

  // the edit goes ahead: its files are copied first (change-review.js)
  await copyBeforeEdit(paneId, tool, input);
  return '';
}

// OpenCode's event source: one plugin file in Technically Not's own folder, named in the session
// config (agent-registry.js, `plugin` in OPENCODE_CONFIG_CONTENT), so nothing is written to the
// project or ~/.config/opencode. It posts to the panel's step URL (TNAI_STEP_URL, set per panel)
// without waiting for the answer: each tool call and its end, each session's busy / idle / error,
// its to-do list, permission requests and questions, child sessions, and once its own server
// address. A call inside a child session (OpenCode's own sub-agent) is marked `child` and names its
// session. Before a tool that changes files it asks the app at /gate/<token> and waits at most 2 s;
// a refusal is thrown, which fails that one tool with our reason as its error, and the model reads
// it and goes on (one real prompt, opencode 1.18.35, 2026-10-06: "File lock (Technically Not): …"
// came back word for word, the file was not written, the next tools ran). tool.execute.after only
// runs for a tool that worked, so a failed one is taken from its part's error state.
const STEP_PLUGIN = `// Written by Technically Not on every OpenCode launch: reports each tool call and task change to the app (live status), and asks it before a tool that changes files. Safe to delete; it is written again.
const url = process.env.TNAI_STEP_URL || '';
const gate = url.replace('/step/', '/gate/');
const kids = new Set();
let last = ''; // one report per call: the same call id twice in a row is sent once
const json = { 'content-type': 'application/json' };
const post = body => { if (url) fetch(url, { method: 'POST', headers: json, body: JSON.stringify(body) }).catch(() => {}); };
const GATED = new Set(['edit', 'write', 'multiedit', 'apply_patch', 'patch', 'bash']);
const EVENTS = new Set(['session.status', 'session.idle', 'session.error', 'permission.asked', 'permission.replied', 'question.asked', 'question.replied', 'question.rejected', 'todo.updated']);
// A short mark of a tool's result: the app only compares marks, the text never leaves OpenCode.
const mark = v => { let s = ''; try { s = typeof v === 'string' ? v : JSON.stringify(v) || ''; } catch {} let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + s.length; };
// Before a tool that changes files: the app may refuse it (another agent holds the file; a git command that would take others' work away).
// The one call that waits: 2 s at most, and anything but a clear refusal lets the tool run.
const ask = async body => {
  if (!url) return '';
  try { const r = await fetch(gate, { method: 'POST', headers: json, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) }); const j = await r.json(); return j && typeof j.deny === 'string' ? j.deny : ''; } catch { return ''; }
};
export const TnaiSteps = async ctx => {
  post({ event: 'server', url: String((ctx && ctx.serverUrl) || '') });
  return {
    event: async ({ event }) => {
      const type = event && event.type, p = (event && event.properties) || {};
      if (type === 'session.created') { const info = p.info; if (info && info.parentID) { kids.add(info.id); post({ event: type, session: info.id, parent: info.parentID, agent: String(info.agent || ''), title: String(info.title || '').slice(0, 200) }); } return; }
      if (type === 'message.part.updated') { const part = p.part; if (part && part.type === 'tool' && part.state && part.state.status === 'error') post({ event: 'tool-end', tool: part.tool, call: part.callID || '', failed: true, session: part.sessionID || '', child: kids.has(part.sessionID) }); return; }
      if (!EVENTS.has(type)) return;
      let props = p; try { if (JSON.stringify(p).length > 20000) props = { sessionID: p.sessionID, id: p.id }; } catch { props = {}; }
      post({ event: type, session: p.sessionID || '', child: kids.has(p.sessionID), properties: props });
    },
    'tool.execute.before': async (input, output) => {
      if (!input) return;
      const child = kids.has(input.sessionID), args = (output && output.args) || {};
      if (GATED.has(input.tool)) { const deny = await ask({ tool: input.tool, input: args, call: input.callID || '', child }); if (deny) throw new Error(deny); }
      if (input.callID && input.callID === last) return;
      last = input.callID || '';
      post({ event: 'tool', tool: input.tool, input: args, call: input.callID || '', session: input.sessionID || '', child });
    },
    'tool.execute.after': async (input, output) => {
      if (!input) return;
      const meta = input.tool === 'task' && output && output.metadata; // the child session its task call ran in
      post({ event: 'tool-end', tool: input.tool, call: input.callID || '', result: mark(output && output.output), session: input.sessionID || '', child: kids.has(input.sessionID), sub: (meta && meta.sessionId) || undefined });
    },
  };
};
`;

function stepPlugin() {
  const file = path.join(dir(), 'opencode-steps.js');
  writeShared(file, STEP_PLUGIN);
  return file;
}

// Codex's event source (codex 0.160, real prompts 2026-10-04): one PreToolUse command hook in
// Technically Not's own profile file (agent-registry.js codexProfile) whose command is this fixed
// script. It posts the hook's JSON (stdin) to the panel's step URL from the environment
// (TNAI_STEP_URL), so the hook text is the same in every session and the user reviews it once:
// Codex skips a hook until it is trusted with its `/hooks` (no
// `--dangerously-bypass-hook-trust`, which would also run hooks the user never reviewed).
// Unreviewed = no steps. Since Codex 0.162 a new hook is also asked about when Codex starts (a
// choice: review, trust all, go on without); attention-service.js shows that choice as a question
// for the user and holds a prompt until it is answered. curl ships with Windows 10+, macOS and most
// Linux; without it the script fails quietly and Codex goes on.
function codexStep() {
  const win = process.platform === 'win32',
    file = path.join(dir(), win ? 'codex-step.cmd' : 'codex-step');
  writeShared(
    file,
    win
      ? [
          '@echo off',
          'rem Written by Technically Not: reports a Codex tool call to the app (live steps).',
          'if "%TNAI_STEP_URL%"=="" exit /b 0',
          'curl -s -m 2 -H content-type:application/json --data-binary @- "%TNAI_STEP_URL%" >nul 2>&1',
          'exit /b 0',
          '',
        ].join('\r\n')
      : '#!/bin/sh\n# Written by Technically Not: reports a Codex tool call to the app (live steps).\n[ -n "$TNAI_STEP_URL" ] || exit 0\ncurl -s -m 2 -H content-type:application/json --data-binary @- "$TNAI_STEP_URL" >/dev/null 2>&1\nexit 0\n'
  );
  if (!win)
    try {
      fs.chmodSync(file, 0o755);
    } catch {}
  return file;
}

// Tool-permission prompts answered in Technically Not's window. Claude Code's PermissionRequest
// hook is held open until the user picks Allow once / Allow for session / Deny, or "Answer in
// terminal"; that, a timeout, the pane exiting, or no window returns no decision, so Claude Code
// falls back to its own in-terminal dialog. "Allow for session" is remembered in globalAllowed
// (memory only) for the entire Technically Not session and cleared when Technically Not exits. This
// allows permissions granted once to apply to ALL agents/panes, not just the one that requested it.
// Per-pane caching (pane.allowed) is deprecated but kept for backwards compat. Scope (sessionScope)
// is narrow: a shell command covers only commands with the same program + subcommand. A chained or
// piped one (`cd x && git status | findstr y`) is remembered as each of its commands, and is
// auto-allowed later only when EVERY command in it was allowed; command substitution, backticks,
// redirects and multi-line scripts are never remembered. A web fetch covers its host; other tools,
// the tool.
const ASK_MS = 590e3; // just under the hook's 600 s timeout
const permissions = new Map(); // id -> { paneId, tool, detail, at, finish(decision) }
const HOOK_OUT = behavior =>
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision:
        behavior === 'allow'
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: 'The user denied this in Technically Not.' },
    },
  });
const publicPermission = ({ finish, agent, ask, ...p }) => p;

// Answered elsewhere (its terminal, a Build panel, the Agents page mirror) while Claude Code kept
// the hook request open: the agent moving on proves it — the asked tool ran (PostToolUse, same
// agent and input), that agent's tool batch resolved (PostToolBatch: also a terminal "No" with
// feedback, or an allowed tool that failed, which fire no PostToolUse), or its turn ended (Stop /
// SubagentStop) or a new prompt came. Same done event as a click.
function settleAnswered(paneId, h) {
  const event = h.hook_event_name,
    agent = h.agent_id || '';
  for (const p of [...permissions.values()]) {
    if (p.paneId !== paneId || p.agent !== agent) continue;
    if (
      (event === 'PostToolUse' &&
        p.ask === (h.tool_name || '') + '\n' + JSON.stringify(h.tool_input || {})) ||
      (event === 'UserPromptSubmit' && !/^\s*<task-notification>/.test(h.prompt || '')) ||
      event === 'Stop' ||
      event === 'StopFailure' ||
      event === 'SubagentStop' ||
      event === 'PostToolBatch'
    )
      p.finish('terminal');
  }
}

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// A held request is marked `whole` when its short text is the whole request (remote-api.js
// `wholeShell`): only a shell tool's one-line command can be. Only such a request may ever be
// answered from another device.
const SHELLS =
  /^(sh|bash|zsh|dash|cmd|cmd\.exe|powershell|powershell\.exe|pwsh|pwsh\.exe|iex|invoke-expression|eval|exec|sudo|xargs|start-process)$/i;

function sessionScope(tool, input) {
  // -> { keys, label } ('' label = the whole tool), or null when it can't be remembered safely
  if (SHELL_TOOLS.has(tool)) {
    const command = String(input.command || '').trim();

    // also PowerShell (…) / @(…) / $(…) sub-expressions and {…} script blocks
    if (!command || /[`<>\r\n(){}]/.test(command)) return null;
    const prefixes = [];
    for (const part of command
      .split(/[;&|]+/)
      .map(p => p.trim())
      .filter(Boolean)) {
      const [program, sub, script] = part.split(/\s+/);

      // `… | sh`, `iex …`, `. x`: runs text it wasn't shown, never remembered
      if (SHELLS.test(program) || program === '.' || /^source$/i.test(program)) return null;
      const word = w => w && /^[\w:.-]+$/.test(w) && !w.startsWith('-');

      // `npm run build` covers only that script, not every `npm run …` (npm/pnpm/yarn/bun run and
      // run-script)
      //
      // A first argument that is a flag (`git -C app status`, `rm -f tmp.txt`) would leave only the
      // program as the key, covering `git push --force` or `rm -rf` for every agent (app-3 #9):
      // such a part is remembered as exactly that command.
      const prefix =
        sub && sub.startsWith('-')
          ? part.split(/\s+/).join(' ')
          : program +
            (word(sub)
              ? ' ' + sub + (/^run(-script)?$/i.test(sub) && word(script) ? ' ' + script : '')
              : '');
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    }
    return prefixes.length
      ? { keys: prefixes.map(p => tool + ':' + p.toLowerCase()), label: prefixes.join(' + ') }
      : null;
  }
  if (tool === 'WebFetch') {
    try {
      const host = new URL(String(input.url || '')).host;
      return host ? { keys: [tool + ':' + host], label: host } : null;
    } catch {
      return null;
    }
  }
  return tool ? { keys: [tool], label: '' } : null;
}

function askPermission(paneId, h, res) {
  const pane = panes.get(paneId),
    tool = h.tool_name || '';
  const reply = body => res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  const input = h.tool_input || {},
    scope = sessionScope(tool, input);

  // Check both pane-local cache (legacy) and session-wide cache (new) for prior "allow for session"
  // decisions Not in a turn that a message from an agent on another computer started: every request
  // in it is shown (a rule that cannot be asked counts as such a turn).
  let far = true;
  try {
    far = sayTurn(paneId) !== false;
  } catch {
    far = true;
  }
  if (!far && scope && scope.keys.every(k => pane?.allowed?.has(k) || globalAllowed.has(k)))
    return reply(HOOK_OUT('allow'));
  const id = crypto.randomBytes(8).toString('hex');

  // Every shell tool shows its command in full (PowerShell used to show the first line only, like a
  // file tool).
  const detail = SHELL_TOOLS.has(tool)
    ? clip(String(input.command || ''), 1200)
    : toolDetail(input);
  const timer = setTimeout(() => finish('terminal'), ASK_MS);
  const finish = decision => {
    if (!permissions.delete(id)) return false;
    clearTimeout(timer);

    // Store "allow for session" in the global cache so all agents/panes respect it for the rest of
    // this Technically Not session
    if (decision === 'session' && scope) for (const k of scope.keys) globalAllowed.set(k, true);

    // A denied edit gives back the file lock its call took (when the request names the call; else
    // its PostToolUseFailure does).
    // The edit never runs, so it no longer counts as the holder's edit in progress either.
    if (decision === 'deny' && LOCK_TOOLS.has(tool) && h.tool_use_id) {
      editEnded(paneId, h.tool_use_id, false);
      if (locks) locks.editGone(paneId, h.tool_use_id);
    }
    if (decision !== 'gone' && !res.writableEnded)
      reply(
        decision === 'once' || decision === 'session'
          ? HOOK_OUT('allow')
          : decision === 'deny'
            ? HOOK_OUT('deny')
            : '{}'
      );
    send('agent:permission', { id, paneId, done: true, decision });
    return true;
  };

  // full: a shell command that is not `whole` and that another computer can be shown in full,
  // exactly (remote-control.js `fullText`): the raw command, never the card's clipped text. Only
  // such a request can be answered there with all of its lines in view (6f, change 8).
  permissions.set(id, {
    id,
    paneId,
    tool,
    detail,
    whole: SHELL_TOOLS.has(tool) && wholeShell(tool, input.command),
    ...(SHELL_TOOLS.has(tool) && answerWay(tool, input.command) === 'full'
      ? { full: input.command }
      : {}),
    description: clip(input.description || '', 200),
    sessionScope: scope ? scope.label : null,
    at: Date.now(),
    finish,
    agent: h.agent_id || '',
    ask: tool + '\n' + JSON.stringify(input),
  });
  res.on('close', () => {
    if (!res.writableEnded) finish('gone');
  }); // Claude Code stopped waiting (answered in the terminal, interrupted)
  send('agent:permission', publicPermission(permissions.get(id)));
}

// OpenCode's permission requests, from the link to the panel's own server (opencode-link.js): the
// same entry, 'agent:permission' event, card and "Needs you" item as a Claude Code request. Allow
// once = once, Allow for session = always (OpenCode keeps it for its session; offered only when the
// request names what "always" would cover), Deny = reject, Answer in terminal = nothing is sent and
// its own dialog stays. Answered once only: the entry is taken out before the answer goes; an
// answer given in its terminal (permission-replied) or a link that ends only clears ours. An answer
// OpenCode did not take while the request still waits brings the card back. No link, no entry: the
// screen-text guess as before.
function openCodeScope(always) {
  // what "always" would cover, as the card's sessionScope: '' = the whole tool, null = not offered
  const list = (Array.isArray(always) ? always : []).map(String).filter(Boolean);
  return !list.length ? null : list.includes('*') ? '' : clip(list.join(', '), 80);
}

function openCodeDetail(e) {
  const m = e.metadata || {},
    file =
      typeof m.filepath === 'string'
        ? m.filepath
        : typeof m.filePath === 'string'
          ? m.filePath
          : '';
  const diff =
    typeof m.diff === 'string'
      ? m.diff
          .split(/\r?\n/)
          .filter(line => /^[-+@ ]/.test(line) && !/^(---|\+\+\+) /.test(line))
          .join('\n')
      : '';
  const command = typeof m.command === 'string' ? m.command : '';
  return clip(
    command || [file || (e.patterns || []).join('\n'), diff].filter(Boolean).join('\n'),
    1200
  );
}

function askOpenCode(e) {
  const { paneId, id } = e;
  if (!id || permissions.has(id)) return;
  const entry = {
    id,
    paneId,
    tool: clip(e.permission || 'a tool', 80),
    detail: openCodeDetail(e),
    whole: e.permission === 'bash' && wholeShell('bash', e.metadata?.command),
    ...(e.permission === 'bash' && answerWay('bash', e.metadata?.command) === 'full'
      ? { full: e.metadata.command }
      : {}),
    description: e.child ? 'Asked by a sub-agent of this OpenCode session' : '',
    sessionScope: openCodeScope(e.always),
    at: e.at || Date.now(),
    agent: 'opencode-link',
    ask: '',
  };
  entry.finish = decision => {
    if (permissions.get(id) !== entry) return false;
    permissions.delete(id);
    const answer =
      decision === 'once'
        ? 'once'
        : decision === 'session'
          ? 'always'
          : decision === 'deny'
            ? 'reject'
            : '';
    if (answer)
      openCodeLink.reply(paneId, id, answer).then(
        r => {
          if (!r.ok && openCodeLink.state(paneId)?.permissions.some(p => p.id === id))
            askOpenCode(e);
        },
        () => {}
      );
    send('agent:permission', { id, paneId, done: true, decision });
    return true;
  };
  permissions.set(id, entry);
  send('agent:permission', publicPermission(entry));
}

// A permission question of a tool run through the ACP connector (acp-bridge.js POSTs it to the
// panel's /acp/ address and waits): the same entry, card and "Needs you" as a Claude Code request.
// Allow once and Deny are the agent's own allow_once and reject choices; Allow for session is its
// allow_always, offered only when the agent has one (the agent keeps it, not this app). Answer in
// terminal, a timeout or no window: {} goes back, and the bridge's own numbered question in the
// terminal stays. The bridge giving up (answered in its terminal, task stopped) closes the request.
function askAcp(paneId, msg, res) {
  const id = crypto.randomBytes(8).toString('hex');
  const tool = clip(String(msg.tool || msg.title || 'a tool'), 80);
  const input = msg.input && typeof msg.input === 'object' ? msg.input : {};
  const shell = tool === 'Bash' && typeof input.command === 'string';
  const timer = setTimeout(() => entry.finish('terminal'), ASK_MS);
  const entry = {
    id,
    paneId,
    tool,
    detail: shell
      ? clip(input.command, 1200)
      : clip(toolDetail(input) || String(msg.title || ''), 1200),
    whole: shell && wholeShell('Bash', input.command),
    ...(shell && answerWay('Bash', input.command) === 'full' ? { full: input.command } : {}),
    description: clip(String(msg.title || ''), 200),
    sessionScope: msg.always === true ? '' : null,
    at: Date.now(),
    agent: 'acp-bridge',
    ask: '',
  };
  entry.finish = decision => {
    if (permissions.get(id) !== entry) return false;
    permissions.delete(id);
    clearTimeout(timer);
    if (!res.writableEnded)
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify(['once', 'session', 'deny'].includes(decision) ? { decision } : {}));
    send('agent:permission', { id, paneId, done: true, decision });
    return true;
  };
  res.on('close', () => {
    if (!res.writableEnded) entry.finish('gone');
  });
  permissions.set(id, entry);
  send('agent:permission', publicPermission(entry));
}

// question id -> paneId: OpenCode questions shown as Claude Code's picker is (live event 'ask';
// answered in its terminal)
const openCodeAsks = new Map();
openCodeLink.on(e => {
  if (e.type === 'permission') return askOpenCode(e);
  if (e.type === 'permission-replied') {
    const p = permissions.get(e.id);
    if (p?.agent === 'opencode-link') p.finish('terminal');
    return;
  }
  if (e.type === 'question') {
    openCodeAsks.set(e.id, e.paneId);
    return emit(e.paneId, { kind: 'ask', questions: askedQuestions({ questions: e.questions }) });
  }
  if (e.type === 'question-done') {
    if (openCodeAsks.delete(e.id)) emit(e.paneId, { kind: 'ask-done' });
    return;
  }
  if (e.type === 'off') {
    // the link ended (panel closed, link lost): its requests can no longer be answered from here
    for (const p of [...permissions.values()])
      if (p.paneId === e.paneId && p.agent === 'opencode-link') p.finish('terminal');
    for (const [id, paneId] of [...openCodeAsks])
      if (paneId === e.paneId) {
        openCodeAsks.delete(id);
        emit(paneId, { kind: 'ask-done' });
      }
  }
});

// A pane's session ended: open prompts fall back, and "allow for session" rules are dropped.
function endSession(paneId) {
  for (const p of [...permissions.values()]) if (p.paneId === paneId) p.finish('terminal');
  const pane = panes.get(paneId);
  if (pane) pane.allowed = null;
}

// Minimal MCP over streamable HTTP (JSON responses only): initialize, tools/list, tools/call.
function onMcp(paneId, msg, signal) {
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize')
    return reply({
      protocolVersion: msg.params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'tnai', version: '1.0.0' },
    });
  if (msg.method === 'ping') return reply({});

  // Claude Code lists tools once it has started (after any folder-trust question), so this is also
  // the session's ready signal. Custom agents (and their sub-agents, within the depth limit) get
  // Technically Not's delegation tools (agent-graph.js); every other session gets none.
  // Every session also gets `tnai_preview` (preview-control.js): it works only while the user has
  // switched it on for that thread, which each call asks the window.
  if (msg.method === 'tools/list') {
    emit(paneId, { kind: 'ready', source: 'mcp' });
    return reply({ tools: [...graph.tools(paneId), ...previewControl.tools()] });
  }
  if (msg.method === 'tools/call' && previewControl.owns(msg.params?.name))
    return previewControl
      .call(paneId, msg.params.name, msg.params?.arguments || {})
      .then(reply, error =>
        reply(
          errors.toolFail('Technically Not error: ' + error.message, 'internal', 'call it again')
        )
      );
  if (msg.method === 'tools/call')
    return graph
      .call(paneId, msg.params?.name, msg.params?.arguments || {}, signal)
      .then(reply, error =>
        reply(
          errors.toolFail(
            'Technically Not error: ' + error.message,
            'internal',
            'call the tool again; if it fails again, tell the user'
          )
        )
      );
  if (msg.id === undefined) return null; // a notification: nothing to answer
  return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } };
}

function handle(req, res) {
  const [, kind, token] = /^\/(hook|mcp|step|gate|acp)\/([0-9a-f]{32})$/.exec(req.url || '') || [];
  const paneId = token && tokens.get(token);
  if (!paneId) {
    res.writeHead(404).end();
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  } // no server-sent event stream
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 4e6) req.destroy();
  });

  // In named sections (stall-log.js): a stall line can name the hook event or MCP call whose
  // handling blocked; the waits are not counted.
  req.on(
    'end',
    stalls.sections('hook server', async span => {
      let msg;
      try {
        msg = JSON.parse((body || '{}').replace(/^﻿/, ''));
      } catch {
        res.writeHead(400).end();
        return;
      } // Cursor Agent's hook payload starts with a byte order mark on Windows
      span.name =
        kind === 'hook'
          ? 'hook ' +
            String(msg.hook_event_name || '') +
            (msg.tool_name ? ' ' + String(msg.tool_name).slice(0, 40) : '')
          : kind === 'mcp'
            ? 'mcp ' + String(msg.method || 'batch').slice(0, 40)
            : 'hook server step';
      if (kind === 'step') {
        // Codex's and Cursor Agent's preToolUse wait for this answer (curl, 2 s at most): an edit's
        // files are copied before it, so the thread can undo them (change-review.js). Any other
        // step is answered at once.
        if (/^preToolUse$/i.test(msg?.hook_event_name || '') && !msg.agent_id)
          await span.rest(copyBeforeEdit(paneId, msg.tool_name, msg.tool_input));
        res.writeHead(204).end();
        try {
          onStep(paneId, msg);
        } catch {}
        return;
      } // answered first: the CLI never waits on us

      // A permission question from the ACP connector's bridge (acp-bridge.js), held open until the
      // user answers in the thread: { decision } or {} (then it is answered in the terminal).
      if (kind === 'acp') {
        askAcp(paneId, msg, res);
        return;
      }

      // The one step call a CLI waits on (OpenCode's plugin, 2 s at most, before a tool that
      // changes files): { deny: reason } or {}. A failure here lets the tool run.
      if (kind === 'gate') {
        let deny = '';
        try {
          deny = await span.rest(gateDenied(paneId, msg));
        } catch (e) {
          console.warn('[tnai] step gate failed:', e?.message || e);
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify(deny ? { deny } : {}));
        return;
      }
      if (kind === 'hook' && typeof msg.permission_mode === 'string' && !msg.agent_id) {
        try {
          modeSeen(paneId, msg.permission_mode);
        } catch {
          /* the rules' error is not the hook's */
        }
      } // the mode Claude Code names in its hooks, when it names one (remote-say.js target)
      if (kind === 'hook' && msg.hook_event_name === 'PermissionRequest') {
        askPermission(paneId, msg, res);
        return;
      }

      // A shell command that would stash, reset, check out, restore or clean files in the shared
      // project folder is denied (git-guard.js): it would take other
      // agents' and the user's uncommitted work away. Sub-agents' calls come through here too.
      if (
        kind === 'hook' &&
        msg.hook_event_name === 'PreToolUse' &&
        SHELL_TOOLS.has(msg.tool_name)
      ) {
        const deny = gitGuard(msg.tool_input?.command);
        if (deny) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: deny,
              },
            })
          );
          return;
        }
      }

      // An edit of a file another agent holds (file-locks.js) is denied with the reason; the tool
      // never runs, so nothing else records it.
      if (
        kind === 'hook' &&
        msg.hook_event_name === 'PreToolUse' &&
        LOCK_TOOLS.has(msg.tool_name)
      ) {
        let deny = '';
        try {
          deny = await span.rest(lockDenied(paneId, msg));
        } catch (e) {
          console.warn('[tnai] file lock failed:', e?.message || e);
        }
        if (deny) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: deny,
              },
            })
          );
          return;
        }

        // the edit goes ahead: its file is copied first (change-review.js)
        await span.rest(copyBeforeEdit(paneId, msg.tool_name, msg.tool_input));
      }

      // Shell commands skip the edit hook: their run time lets file-locks.js match a held file
      // changing on disk to the agent whose command was running.
      if (kind === 'hook' && locks && lockOwner)
        try {
          const ev = msg.hook_event_name,
            input = msg.tool_input || {};
          if (ev === 'PreToolUse' && SHELL_TOOLS.has(msg.tool_name) && !input.run_in_background) {
            const o = await span.rest(lockOwner(paneId));
            if (o) locks.shellStart(paneId, msg.tool_use_id, o, input.timeout);
          } else if (ev === 'PostToolUse' && SHELL_TOOLS.has(msg.tool_name))
            locks.shellEnd(paneId, msg.tool_use_id);
          else if (
            (ev === 'PostToolUse' || ev === 'PostToolUseFailure') &&
            LOCK_TOOLS.has(msg.tool_name)
          ) {
            // the edit is on disk: the watcher's report of it is the holder's own change. A failed
            // or denied edit gives back the lock its own call took.
            const f = input.file_path || input.notebook_path;
            const gaveBack = editEnded(paneId, msg.tool_use_id, ev === 'PostToolUse');
            const o =
              !gaveBack && typeof f === 'string' && f ? await span.rest(lockOwner(paneId)) : null;
            if (o) locks.editDone(o.project, f, paneId, msg.tool_use_id || '');
          } else if (ev === 'Stop' || ev === 'StopFailure') {
            locks.shellStop(paneId);
            editsForgotten(paneId);
          }
        } catch (e) {
          console.warn('[tnai] shell lock tracking failed:', e?.message || e);
        }

      // The finish check: a turn that was told to read a skill (two or
      // more keywords in its prompt, or it edited a file the skill owns) and never did is held
      // once, with the reason; Claude Code then goes on instead of stopping. `stop_hook_active`
      // marks a stop that already follows such a hold, so an agent is never held twice in a row.
      // The turn is not over, so nothing else is told about this Stop.
      // The learning check below holds once per task by itself, so it also runs on the stop that
      // follows the skill hold (`stop_hook_active`) and can never loop.
      if (kind === 'hook' && msg.hook_event_name === 'Stop' && !msg.agent_id) {
        let skipped = [];
        try {
          if (!msg.stop_hook_active) skipped = skillStats.hold(paneId);
        } catch {}
        if (skipped.length) {
          const many = skipped.length > 1;
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              decision: 'block',
              reason:
                'Before you finish: Technically Not told you to read ' +
                (many ? 'these skills' : 'this skill') +
                ' for this task and you have not: ' +
                skipped.join(', ') +
                '. Read ' +
                (many ? 'them' : 'it') +
                ' now (Skill tool, or the SKILL.md), check what you did against ' +
                (many ? 'their' : 'its') +
                ' steps and "done when" list, fix anything that does not match, then finish. If ' +
                (many ? 'one' : 'it') +
                ' truly does not apply to this task, say so in one line and finish.',
            })
          );
          return;
        }

        // The learning check (skill-stats.js `learnCheck`): a task that was corrected, fixed a bug
        // or added new code and changed no skill is held once to decide which skill learns from
        // it, so the user never has to ask (user 2026-10-28). Off with Settings › Agents › Write
        // skills.
        let why = '';
        try {
          why = skillStats.learnCheck(
            paneId,
            msg.last_assistant_message,
            ruleFlags()['write-skills'] !== false
          );
        } catch {}
        if (why) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              decision: 'block',
              reason:
                'Before you finish: ' +
                why +
                ', and no skill changed. Ask which skill or rule should have prevented it or will be needed again: the skill that owns the files you changed (its `paths:` and the file map), the skill you followed, or a new one for a new repeatable procedure. Weigh it briefly (the case for, the case against: a one-off, already covered, makes the skill longer). If the case for wins, add the lesson as one short rule with "learned <date>: <cause>" and update its "Last checked"; then say "Skill improved: <skill>, <what>, because <why>" in your reply. If not, say in one line why no skill needs it. Then finish.',
            })
          );
          return;
        }
      }
      if (kind === 'hook') {
        // A prompt that quotes another agent's result: the agent is told where it came from and how
        // to hand it back (agent-lifecycle.js). Project skills, and library skills on for every
        // session, whose name words or keywords the prompt mentions (skill-triggers.js). Finished
        // work of other agents that relates to this task (agent-context.js): with a new prompt, or
        // mid-task after a tool call when some was queued for it. The live team (agent-peers.js):
        // other agents working here now with crossings, with a new prompt; a crossing notice
        // mid-task.
        const event = msg.hook_event_name,
          note = event === 'UserPromptSubmit' && /^\s*<task-notification>/.test(msg.prompt || '');
        let extra = [];

        // App notices held while it works (agent-notices.js): with the main agent's next tool call;
        // any still held when its task ends are typed in.
        if (event === 'PostToolUse' && !msg.agent_id) extra.push(notices.take(paneId));
        else if (event === 'Stop' && !msg.agent_id) notices.flush(paneId);

        // Skills: suggested ones and reads are counted, and the next prompt's verdict on them
        // (skill-stats.js); a skill already read this session is not suggested again, and after a
        // Read/Edit/Write of a file a skill's `paths:` own, that skill is offered once per session.
        if (event === 'UserPromptSubmit' && !note) {
          try {
            extra.push(lifecycle.prompted(paneId, msg.prompt || ''));
          } catch {}
          try {
            context.hook(paneId, msg);
            extra.push(context.forPrompt(paneId, msg.prompt || ''));
          } catch (e) {
            console.warn('[tnai] hook context failed:', e?.message || e);
          }
          try {
            extra.push(require('./agent-mesh').renamedNote(paneId));
          } catch {}

          // a prompt that compares: the numbers of the answer as a chart (comparison-hint.js)
          try {
            extra.push(require('./comparison-hint').forPrompt(msg.prompt || ''));
          } catch {}

          // what this project's past tasks taught, when it applies now (task-learning.js)
          extra.push(require('./task-learning').forPrompt(paneId));

          // who else works here now, and whose task crosses this one (agent-peers.js)
          extra.push(await span.rest(peers.forPrompt(paneId, msg.prompt || '')));
          try {
            skillStats.prompted(paneId, msg.prompt || '');
            const m = skillTriggers.forPromptWith(
              msg.prompt || '',
              projectRoot(),
              everywhereSkills(),
              skillStats.readIn(paneId)
            );
            extra.push(m.text);
            skillStats.offered(paneId, m.names);
            skillStats.require(paneId, m.strong);
          } catch {}
        } else
          try {
            if (event === 'PostToolUse' && !msg.agent_id)
              extra.push(context.forTool(paneId), await span.rest(peers.forTool(paneId)));
            else if (!note) context.hook(paneId, msg);
          } catch (e) {
            console.warn('[tnai] hook context failed:', e?.message || e);
          }
        if (event === 'PostToolUse')
          try {
            skillStats.tool(paneId, msg);
            const f =
              FILE_TOOLS.has(msg.tool_name) &&
              (msg.tool_input?.file_path || msg.tool_input?.notebook_path);

            // listed once for both lookups (each listing checks every library skill on disk)
            const every = f ? everywhereSkills() : null;
            if (f) {
              const m = skillTriggers.forFile(f, projectRoot(), every, skillStats.known(paneId));
              extra.push(m.text);
              skillStats.offered(paneId, m.names);
            }

            // The main agent edited a file a skill owns: that skill is required for this task (a
            // sub-agent's edits are its own; reading a file requires nothing).
            if (f && LOCK_TOOLS.has(msg.tool_name) && !msg.agent_id) {
              skillStats.require(
                paneId,
                skillTriggers.forFile(f, projectRoot(), every, skillStats.readIn(paneId)).names
              );

              // what kind of file it changed, for the learning check at the task's end
              skillStats.edited(paneId, f, msg.tool_name);
            }
          } catch {}
        extra = extra.filter(Boolean).join('\n\n');
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          extra
            ? JSON.stringify({
                hookSpecificOutput: { hookEventName: event, additionalContext: extra },
              })
            : '{}'
        );
        try {
          settleAnswered(paneId, msg);
          onHook(paneId, msg);
        } catch {}
        try {
          loops.hook(paneId, msg);
        } catch {}
        try {
          turns.claudeHook(paneId, msg);
        } catch (e) {
          console.warn('[tnai] claudeHook failed:', e?.message || e);
        }
        return;
      }

      // tools/call can take minutes (tnai_wait), so answers may be promises. A client that gave up
      // (closed the request) cancels its wait, so the reports it would have returned are not marked
      // delivered into a dead connection; they reach the agent as a message instead (agent-graph.js
      // flush).
      const gone = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) gone.abort();
      });
      Promise.all(
        Array.isArray(msg)
          ? msg.map(m => onMcp(paneId, m, gone.signal))
          : [onMcp(paneId, msg, gone.signal)]
      ).then(
        all => {
          if (gone.signal.aborted) return;
          const out = Array.isArray(msg) ? all.filter(Boolean) : all[0];
          if (!out || (Array.isArray(out) && !out.length)) {
            res.writeHead(202).end();
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        },
        () => res.writeHead(500).end()
      );
    })
  );
}

function listen() {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer(handle);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolve();
    });
  });
}

// The work rules as a one-rule plugin folder for CLIs that take --plugin-dir but no instruction
// flag (Cursor Agent): rules/*.mdc with alwaysApply = a global rule in every request (checked in
// cursor-agent 2026.09.18: plugin rules with alwaysApply load as type "global"). cursor-agent
// 2026.10.01 loads a --plugin-dir plugin's MCP server and skills but no longer hands its rules to
// the model (marker rule, real prompt, 2026-10-04), so the same text also goes in through the
// plugin's sessionStart hook: hooks/hooks.json prints a ready-made { additional_context } file
// (`type`/`cat`, no runtime needed; ASCII-only JSON so no shell re-encodes it). Checked with the
// full rules (40 KB): the model follows them, and a resumed chat keeps them. Live steps
// (cursor-agent 2026.10.01, real prompts in a scratch folder, 2026-10-05): with `stepUrl` (the
// panel's /step/<token>) the plugin also carries a preToolUse hook whose command is a script in the
// plugin's own folder that posts the hook's JSON (stdin) to that URL. Seen: it fires for Shell,
// Read and Write with { tool_name, tool_input }; a hook that prints nothing, and one whose script
// is missing, let the tool run. A hook that exits with code 2 denies the tool, and Cursor wraps the
// command in PowerShell syntax on Windows but hands it to the shell named in SHELL when there is
// one (bash then fails with a syntax error, code 2, and every tool was refused): with SHELL set on
// Windows there is no tool hook, so no steps and nothing blocked. `cmd /d /c "<file>"` reads the
// same in PowerShell and cmd. Not seen on macOS or Linux.
function cursorStep(root, stepUrl) {
  const win = process.platform === 'win32';
  if (
    !/^http:\/\/127\.0\.0\.1:\d+\/step\/[0-9a-f]{32}$/.test(stepUrl || '') ||
    (win && process.env.SHELL)
  )
    return '';
  const file = path.join(root, 'hooks', win ? 'step.cmd' : 'step');
  writeShared(
    file,
    win
      ? [
          '@echo off',
          'rem Written by Technically Not: reports a Cursor Agent tool call to the app (live steps).',
          'curl -s -m 2 -H content-type:application/json --data-binary @- "' +
            stepUrl +
            '" >nul 2>&1',
          'exit /b 0',
          '',
        ].join('\r\n')
      : '#!/bin/sh\n# Written by Technically Not: reports a Cursor Agent tool call to the app (live steps).\ncurl -s -m 2 -H content-type:application/json --data-binary @- "' +
          stepUrl +
          '" >/dev/null 2>&1\nexit 0\n'
  );
  if (!win)
    try {
      fs.chmodSync(file, 0o755);
    } catch {}
  return win ? 'cmd /d /c "' + file + '"' : '"' + file + '"';
}

function rulesPluginFiles(root, rules, stepUrl = '') {
  const text = rules.join('\n') + '\n',
    step = cursorStep(root, stepUrl);
  writeShared(
    path.join(root, '.cursor-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: 'tnai',
        version: '1.0.0',
        description:
          'How to work inside Technically Not (added by Technically Not to every session).',
      },
      null,
      2
    )
  );
  writeShared(
    path.join(root, 'rules', 'tnai-work-rules.mdc'),
    '---\ndescription: How to work in every Technically Not session\nalwaysApply: true\n---\n\n' +
      text
  );
  const context = path.join(root, 'hooks', 'context.json');
  writeShared(
    context,
    JSON.stringify({ additional_context: text }).replace(
      /[\u0080-￿]/g,
      c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
    )
  );
  writeShared(
    path.join(root, 'hooks', 'hooks.json'),
    JSON.stringify(
      {
        version: 1,
        hooks: {
          sessionStart: [
            { command: (process.platform === 'win32' ? 'type' : 'cat') + ' "' + context + '"' },
          ],
          ...(step ? { preToolUse: [{ command: step }] } : {}),
        },
      },
      null,
      2
    )
  );
}

function rulesPlugin(rules = workRules()) {
  const root = path.join(dir(), 'rules-plugin');
  rulesPluginFiles(root, rules);
  return root;
}

// Cursor Agent's own plugin per pane: the same rule plus Technically Not's MCP server in the
// plugin's mcp.json ({ mcpServers: { tnai: { url } } }), so a Cursor lead gets tnai_delegate & co.
// without touching ~/.cursor or the project (checked in cursor-agent 2026.09.28: a --plugin-dir
// plugin's mcp.json is connected at session start, initialize + tools/list, before any prompt).
// Removed with the pane (forget, sweepStale). Every Cursor panel has its own plugin since live
// steps (2026-10-05): the step hook holds that panel's address. Only a lead's holds mcp.json.
function cursorPlugin(paneId, rules, mcpConfig) {
  let url = '';
  if (mcpConfig)
    try {
      url = JSON.parse(fs.readFileSync(mcpConfig, 'utf8')).mcpServers.tnai.url;
    } catch {}
  const token = panes.get(paneId)?.token;
  if (!url && !token) return rulesPlugin(rules);
  const root = path.join(dir(), String(paneId).replace(/[^\w-]/g, '_') + '.cursor-plugin'),
    mcp = path.join(root, 'mcp.json');
  rulesPluginFiles(root, rules, token ? `http://127.0.0.1:${port}/step/${token}` : '');

  // the user's connections for this thread (connections.js) beside `tnai`
  const servers = {
    ...connections.jsonFor(paneId, 'Cursor Agent'),
    ...(url ? { tnai: { url } } : {}),
  };
  if (Object.keys(servers).length)
    writeShared(mcp, JSON.stringify({ mcpServers: servers }, null, 2));
  else {
    written.delete(mcp);
    try {
      fs.rmSync(mcp, { force: true });
    } catch {}
  } // a panel that led before and does not now: no tools from the old start
  return root;
}

// A new per-pane token (the pane's hook and MCP URLs) and its MCP config file: { mcpServers: {
// tnai: { type: 'http', url } } }. `extra`: the user's connections for this thread
// (connections.js `jsonFor`), for Claude Code and GitHub Copilot (each in its own form), beside
// `tnai`; Codex and OpenCode read only the url here and get theirs in agent-registry.js.
async function mcpFile(paneId, extra = {}) {
  await listen();
  const old = panes.get(paneId);
  if (old) tokens.delete(old.token);
  const token = crypto.randomBytes(16).toString('hex');
  tokens.set(token, paneId);
  panes.set(paneId, { token, events: old?.events || [] });
  const file = path.join(dir(), String(paneId).replace(/[^\w-]/g, '_') + '.mcp.json');

  // timeout: Claude Code aborts an HTTP MCP request after 60 s unless the server entry (or
  // MCP_TOOL_TIMEOUT) says otherwise ("The operation timed out.", checked in Claude Code 2.1.283),
  // which cut tnai_wait (up to 600 s) short; 660 s as for Codex (agent-registry.js). Codex and
  // OpenCode read only the url; each gets the same 660 s in its own config (agent-registry.js).
  await fs.promises.writeFile(
    file,
    JSON.stringify(
      {
        mcpServers: {
          ...extra,
          tnai: { type: 'http', url: `http://127.0.0.1:${port}/mcp/${token}`, timeout: 660000 },
        },
      },
      null,
      2
    )
  );
  return file;
}

// Launch additions: for Claude Code its own hook settings and MCP config files plus the lead-agent
// rules; for other CLIs the work rules (and a file copy for CLIs that read instruction files).
// Claude Code's own theme defaults to dark: on the light app theme it drew near-white text on
// white. "auto" picks light or dark from the terminal (COLORFGBG, set from the app theme by
// pty-service.js). Only when the user's Claude config (the account's CLAUDE_CONFIG_DIR, or
// ~/.claude.json) has no theme of its own: an explicit choice is theirs to keep.
async function userTheme(accountDir) {
  const file = accountDir
    ? path.join(accountDir, '.claude.json')
    : path.join(require('os').homedir(), '.claude.json');
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')).theme || '';
  } catch {
    return '';
  }
}

async function launchOptions(paneId, agentId, accountDir = '', { lead = false } = {}) {
  if (agentId === 'Terminal') return {};
  if (agentId !== 'Claude Code') {
    const rules = workRules(),
      rulesPath = path.join(dir(), 'work-rules.md');
    writeShared(rulesPath, rules.join('\n') + '\n');

    // OpenCode reads its own file beside the shared one (the folder agent-registry.js looks in for
    // its step plugin): its lead rules, then the same work rules.
    const ownRules = agentId === 'OpenCode' ? path.join(dir(), 'work-rules-opencode.md') : '';
    if (ownRules) writeShared(ownRules, openCodeRules(rules));

    // Codex and OpenCode also connect to Technically Not's MCP server (agent-registry.js turns the
    // file into Codex's `-c mcp_servers.tnai.url=…` / OpenCode's config `mcp.tnai`): Technically
    // Not's delegation tools when it leads, its ready signal as a sub-agent. GitHub Copilot takes
    // the file itself (`--additional-mcp-config @<file>`, agent-registry.js); an account whose
    // Copilot policy blocks third-party MCP starts without it. Cursor Agent gets it through its
    // per-pane plugin (cursorPlugin), only as a lead: its --approve-mcps also approves the user's
    // own ~/.cursor MCP servers for that session, and a Cursor sub-agent needs none (ready from its
    // screen, task end from its transcript). Copilot's file also holds the user's connections for
    // this thread (connections.js), the same policy applies to them.
    // A tool run through the ACP connector gets the file too: its token is the bridge's step and
    // permission address (acp-connector.js), and `tnai` is offered when the tool takes HTTP MCP.
    const mcpConfig =
      (['Codex', 'OpenCode', 'GitHub Copilot'].includes(agentId) ||
        require('./agent-registry').isAcp(agentId) ||
        (agentId === 'Cursor Agent' && lead)) &&
      paneId
        ? await mcpFile(
            paneId,
            agentId === 'GitHub Copilot' ? connections.jsonFor(paneId, 'GitHub Copilot') : {}
          )
        : '';

    // Any Cursor panel gets a token for its step address (cursorStep); only a lead is handed the
    // MCP file made with it.
    if (agentId === 'Cursor Agent' && paneId && !mcpConfig) await mcpFile(paneId);
    const plugin =
      agentId === 'Cursor Agent' && paneId
        ? cursorPlugin(paneId, rules, mcpConfig)
        : rulesPlugin(rules);

    // beside the rules file, where agent-registry.js looks for it
    if (agentId === 'OpenCode' && mcpConfig) stepPlugin();
    if (agentId === 'Codex' && mcpConfig) codexStep(); // the same

    // Codex only (`for: codex` files): the part of the lead rules that is true for it, in front of
    // the work rules in its profile's developer_instructions.
    const told =
      agentId === 'Codex'
        ? [...hiddenSkills.lines('codex', HIDDEN_VARS, ruleFlags()), ...rules]
        : rules;
    return {
      workRules: told.join(' '),
      rulesFile: ownRules || rulesPath,
      rulesPlugin: plugin,
      ...(mcpConfig ? { mcpConfig } : {}),

      // the user's connections for this thread (connections.js), read by agent-registry.js
      ...(agentId === 'Codex' && paneId ? { connectionArgs: connections.codexFor(paneId) } : {}),
      ...(agentId === 'OpenCode' && paneId
        ? { connectionMcp: connections.openCodeFor(paneId) }
        : {}),
    };
  }
  if (!paneId) return {};
  const mcpConfig = await mcpFile(paneId, connections.jsonFor(paneId, 'Claude Code')),
    token = panes.get(paneId).token;
  const hook = { type: 'http', url: `http://127.0.0.1:${port}/hook/${token}`, timeout: 5 };
  const on = matcher => [{ ...(matcher ? { matcher } : {}), hooks: [hook] }];

  // No SessionStart hook: Claude Code skips HTTP hooks for SessionStart. Its MCP connection
  // (tools/list) marks the session ready instead. PermissionRequest waits for the user's answer in
  // Technically Not (askPermission), so it gets a long timeout.
  const theme = (await userTheme(accountDir)) ? {} : { theme: 'auto' };

  // PostToolUseFailure only for Agent/Task and the edit tools: a refused or failed launch never
  // runs, so its "Starting" card must go (19 'spawn-refused'); a refused or failed edit gives back
  // the file lock its call took (editEnded). Technically Not's read-only / bookkeeping `tnai`
  // commands (agents, read, context, locks, team, skill list…) are always allowed, so an auto-mode
  // safety check that doesn't answer never blocks agent coordination. Commands that act on other
  // agents or every future session (send, new, close, skill save/remove) ask as usual:
  // a prompt-injected agent can't drive them unseen. Merged with the user's
  // own permission rules.
  const SAFE_TNAI = [
    'agents',
    'read',
    'context',
    'locks',
    'lock',
    'unlock',
    'team',
    'skill list',
    'skill match',
    'skill overlaps',
    'preview',
    'show',
    'shot',
  ];
  const permissions = {
    allow: ['Bash', 'PowerShell'].flatMap(t =>
      SAFE_TNAI.flatMap(c => [`${t}(tnai ${c})`, `${t}(tnai ${c} *)`])
    ),
  };
  const settings = {
    ...theme,
    permissions,
    hooks: {
      UserPromptSubmit: on(),
      PreToolUse: on('*'),
      PostToolUse: on('*'),
      PostToolUseFailure: on('Agent|Task|Edit|MultiEdit|Write|NotebookEdit'),
      PostToolBatch: on(),
      SubagentStart: on(),
      SubagentStop: on(),
      Stop: on(),
      StopFailure: on(),

      // A compact begins (typed, sent by Technically Not, or automatic): the thread shows it runs
      // until the record's compact line arrives (158).
      PreCompact: on(),
      PermissionRequest: [{ matcher: '*', hooks: [{ ...hook, timeout: 600 }] }],
    },
  };
  const settingsFile = path.join(dir(), String(paneId).replace(/[^\w-]/g, '_') + '.settings.json');
  await fs.promises.writeFile(settingsFile, JSON.stringify(settings, null, 2));

  // Composer attachments live in Technically Not's own folder; --add-dir lets Claude Code read them
  // without a permission prompt.
  return {
    settingsFile,
    mcpConfig,
    appendPrompt: leadPrompt(),
    addDirs: [attachments.dir()],
    chrome: ruleFlags()['browser-use'] === true,
  };
}

// The text Claude Code appends to its system prompt, as a per-pane file for
// --append-system-prompt-file: the rules keep growing, and as one command-line argument through a
// .cmd (cmd.exe caret-escapes it, 8191-char line limit) they broke hand-typed `claude` ("The
// command line is too long").
function promptFile(paneId, text) {
  const file = path.join(dir(), String(paneId || 'hand').replace(/[^\w-]/g, '_') + '.prompt.md');
  fs.writeFileSync(file, text);
  return file;
}

function forget(paneId) {
  endSession(paneId);
  skillStats.forget(paneId);
  peers.forget(paneId);
  loops.forget(paneId);
  notices.forget(paneId);
  const pane = panes.get(paneId);
  if (!pane) return;
  tokens.delete(pane.token);
  panes.delete(paneId);
  const safe = String(paneId).replace(/[^\w-]/g, '_');
  for (const f of [safe + '.settings.json', safe + '.mcp.json', safe + '.prompt.md']) {
    try {
      fs.unlinkSync(path.join(dir(), f));
    } catch {}
  }
  try {
    fs.rmSync(path.join(dir(), safe + '.cursor-plugin'), { recursive: true, force: true });
  } catch {}
  for (const f of [...written.keys()]) if (f.includes(safe + '.cursor-plugin')) written.delete(f);
}

// Per-pane files forget() never reached (panes open at quit, restored panes, crashes): at startup,
// drop those no live pane owns and untouched for STALE_DAYS. Every launch rewrites its pane's
// files, so a pane still running or about to be restored is never that old.
const STALE_DAYS = 3;

async function sweepStale() {
  try {
    const d = dir(),
      live = new Set([...panes.keys()].map(id => String(id).replace(/[^\w-]/g, '_')));
    for (const name of await fs.promises.readdir(d)) {
      const m = /^(.+)\.(settings\.json|mcp\.json|prompt\.md|cursor-plugin)$/.exec(name);
      if (!m || live.has(m[1])) continue;
      const f = path.join(d, name);
      try {
        if (Date.now() - (await fs.promises.stat(f)).mtimeMs > STALE_DAYS * 864e5)
          await fs.promises.rm(f, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

module.exports = {
  bgTail,
  init(sender, opts = {}) {
    send = sender;
    loops.init(sender);
    if (typeof opts.sayTurn === 'function') sayTurn = opts.sayTurn;
    if (typeof opts.modeSeen === 'function') modeSeen = opts.modeSeen;
    if (typeof opts.root === 'function') projectRoot = opts.root;
    if (typeof opts.beforeEdit === 'function') beforeEdit = opts.beforeEdit;
    if (opts.locks && typeof opts.owner === 'function') {
      locks = opts.locks;
      lockOwner = opts.owner;
      require('./watch-service').onChanges(batch => {
        try {
          locks.diskChanges(projectRoot(), batch);
        } catch {}
      });
    }
    require('./watch-service').onChanges(batch => {
      try {
        skillTriggers.changed(batch);
      } catch {}
    });

    /* a changed skill file: the file hook's kept skill list is scanned again */
    setTimeout(sweepStale, 30e3).unref?.();
  },
  launchOptions,
  ruleFlags,
  setRuleFlags,
  promptFile,
  forget,
  endSession,
  // Permission prompts (askPermission): the window's answer ('once' | 'session' | 'deny' |
  // 'terminal'), and the open ones for a reloaded window.
  answerPermission: (id, decision) => {
    const p = permissions.get(id);
    if (decision === 'session' && p?.sessionScope == null) decision = 'terminal';
    return !!p?.finish(['once', 'session', 'deny'].includes(decision) ? decision : 'terminal');
  },
  pendingPermissions: () => [...permissions.values()].map(publicPermission),
  // An event from outside Claude Code's hooks (agent-mesh.js: messages relayed between agents), for
  // any pane.
  note(paneId, event) {
    if (!panes.has(paneId)) panes.set(paneId, { token: null, events: [] });
    emit(paneId, { ...event, text: clip(event.text, 2000) });
  },
  history: () => [...panes.values()].flatMap(p => p.events),
  // A background task's hand-back that Claude Code took into a running reply (agent-turns.js reads
  // it from the transcript; no hook fires): it ended.
  taskNote(paneId, text) {
    const id = /<task-id>([\s\S]*?)<\/task-id>/.exec(String(text || ''))?.[1]?.trim();

    // no-op for a task the window doesn't hold (e.g. a sub-agent's hand-back)
    if (id && panes.has(paneId)) emit(paneId, { kind: 'bg-end', taskId: id });
  },
  // Developer self-test only: the URL a pane's hooks post to, so tests can play recorded Claude
  // Code events without a prompt. What an OpenCode panel's plugin reported (openCodeState): its
  // server address, and the waiting permission requests, questions and child sessions (recorded
  // only; nothing answers or draws them yet).
  openCode: paneId => {
    const o = panes.get(paneId)?.openCode;
    return o
      ? {
          server: o.server,
          permissions: [...o.permissions.values()],
          questions: [...o.questions.values()],
          children: [...o.children.values()],
        }
      : null;
  },
  endpoint: paneId => {
    const p = panes.get(paneId);
    return p
      ? {
          hook: `http://127.0.0.1:${port}/hook/${p.token}`,
          mcp: `http://127.0.0.1:${port}/mcp/${p.token}`,
          step: `http://127.0.0.1:${port}/step/${p.token}`,
        }
      : null;
  },
  stop() {
    if (server) server.close();
    server = null;
  },
};
