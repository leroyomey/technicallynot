/*
 * Technically Not desktop · thread-log-claude.js — Claude Code's reader for the thread log
 * (desktop/thread-log.js): where a session's conversation is on disk, and its lines as entries.
 *
 * The source is Claude Code's own record of the conversation, its transcript:
 * <home>/projects/<the working folder with every non-alphanumeric as '-'>/<session id>.jsonl, one
 * JSON line per message. Nothing here is guessed: every entry is one line of that file, turned
 * into what a person reads (your prompt, the agent's words, an action with its file or command,
 * what the action gave back, how long the task took). Lines the CLI writes for itself (thinking,
 * attachments, snapshots, a sub-agent's own inner steps) are left out, except the attachment that
 * carries a prompt sent while the agent worked. Text is clipped here.
 *
 * `fileFor(record)` finds the transcript of a saved session record (session-store.js);
 * `entries(lines)` is pure and is tested by tools/thread-log-test.js.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clip, oneLine, shortPath, promptEntries } = require('./thread-log-text');

const TEXT_MAX = 24000;
const RESULT_MAX = 400;
const WHAT_MAX = 300;

// A whole command, and everything it printed: shown only when the user asks for it.
const MORE_MAX = 4000;
const CLAUDE = 'Claude Code';

const slug = folder => String(folder || '').replace(/[^a-zA-Z0-9]/g, '-');
const timeOf = line => {
  const at = Date.parse(line.timestamp || '');
  return Number.isFinite(at) ? at : 0;
};

// ---------- which file ----------
// The transcript of a saved session (session-store.js record: agent, sessionId, cwd, accountDir),
// or '' when there is none yet: Claude Code writes the file with its first message.
function fileFor(record, { env = process.env, home = os.homedir(), sub = '' } = {}) {
  if (!record || record.agent !== CLAUDE || !record.sessionId || !record.cwd) return '';
  const homes = [record.accountDir, env.CLAUDE_CONFIG_DIR, path.join(home, '.claude')].filter(
    Boolean
  );
  for (const base of homes) {
    const folder = path.join(base, 'projects', slug(record.cwd));
    const file = sub
      ? subFile(path.join(folder, record.sessionId, 'subagents'), String(sub))
      : path.join(folder, record.sessionId + '.jsonl');
    try {
      if (file && fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return '';
}

// A sub-agent the lead started with its Agent tool keeps a record of its own beside the lead's:
// <session id>/subagents/agent-<its id>.jsonl, with agent-<its id>.meta.json naming the lead's
// tool call that started it. `sub` is that id, or the id of the tool call: the lead's own record
// knows only the call, so the meta files are looked through for it.
function subFile(folder, sub) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(sub)) return '';
  const direct = path.join(folder, 'agent-' + sub + '.jsonl');
  if (fs.existsSync(direct)) return direct;
  let names = [];
  try {
    names = fs.readdirSync(folder).filter(name => name.endsWith('.meta.json'));
  } catch {
    return '';
  }
  for (const name of names.slice(0, 400)) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'));
      if (meta?.toolUseId === sub)
        return path.join(folder, name.replace(/\.meta\.json$/, '.jsonl'));
    } catch {}
  }
  return '';
}

// ---------- one line of the transcript as entries ----------
// What an action is, in two parts: a verb a person reads and the thing it acts on.
function describeTool(name, input, cwd) {
  const data = input && typeof input === 'object' ? input : {};
  const file = shortPath(data.file_path || data.path || data.notebook_path, cwd);
  switch (name) {
    case 'Read':
      return { verb: 'Read', what: file };
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { verb: 'Edited', what: file };
    case 'Write':
      return { verb: 'Wrote', what: file };
    case 'Bash':
    case 'PowerShell':
      return {
        verb: 'Ran',
        what: oneLine(data.command, WHAT_MAX),
        note: oneLine(data.description, 120),

        // the whole command, for the view that shows it behind a press
        full: clip(String(data.command || '').trim(), MORE_MAX),
      };
    case 'Grep':
      return { verb: 'Searched for', what: oneLine(data.pattern, WHAT_MAX) };
    case 'Glob':
      return { verb: 'Looked for files', what: oneLine(data.pattern, WHAT_MAX) };
    case 'Agent':
    case 'Task':
      return {
        verb: 'Started a sub-agent',
        what: oneLine(data.description || data.subagent_type, WHAT_MAX),
      };
    case 'TodoWrite': {
      const list = Array.isArray(data.todos) ? data.todos : [];
      const done = list.filter(item => item?.status === 'completed').length;
      return {
        verb: 'Updated its checklist',
        what: list.length ? done + ' of ' + list.length + ' done' : '',
      };
    }
    case 'WebFetch':
      return { verb: 'Opened', what: oneLine(data.url, WHAT_MAX) };
    case 'WebSearch':
      return { verb: 'Searched the web for', what: oneLine(data.query, WHAT_MAX) };
    case 'Skill':
      return { verb: 'Read the skill', what: oneLine(data.skill, 120) };
    default:
      return {
        verb: 'Used',
        what: String(name || 'a tool')
          .replace(/^mcp__/, '')
          .replace(/__/g, ' · '),
      };
  }
}

// A question the agent puts to the user with its own tool: the words and the choices.
function questionsOf(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list.slice(0, 4).map(item => ({
    question: clip(String(item?.question || ''), 600),
    options: (Array.isArray(item?.options) ? item.options : [])
      .slice(0, 6)
      .map(option => clip(String(option?.label || option || ''), 120)),
  }));
}

// Lines added and removed, counted from the patch the CLI recorded with an edit.
function countPatch(patch) {
  let added = 0;
  let removed = 0;
  for (const hunk of Array.isArray(patch) ? patch : [])
    for (const row of Array.isArray(hunk?.lines) ? hunk.lines : []) {
      if (row[0] === '+') added++;
      else if (row[0] === '-') removed++;
    }
  return { added, removed };
}

const blockText = content =>
  typeof content === 'string'
    ? content
    : (Array.isArray(content) ? content : [])
        .filter(block => block?.type === 'text')
        .map(block => block.text || '')
        .join('\n');

// What an action gave back, as one result entry for the action with the same id.
function resultOf(block, line) {
  const out =
    line.toolUseResult && typeof line.toolUseResult === 'object' ? line.toolUseResult : {};
  const entry = {
    kind: 'result',
    id: String(block.tool_use_id || ''),
    failed: block.is_error === true,
  };
  if (Array.isArray(out.structuredPatch)) {
    const { added, removed } = countPatch(out.structuredPatch);
    entry.added = added;
    entry.removed = removed;

    // a new file has no patch: every line of it is new
    if (out.type === 'create' && typeof out.content === 'string') {
      entry.created = true;
      entry.added = out.content ? out.content.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
    }
  }
  if (typeof out.stdout === 'string' || typeof out.stderr === 'string') {
    const rows = String(out.stdout || out.stderr || '')
      .trim()
      .split(/\r?\n/);
    entry.text = clip(rows[rows.length - 1] || '', RESULT_MAX);

    // everything it printed, when that is more than the one line above
    const whole = [out.stdout, out.stderr]
      .filter(part => typeof part === 'string' && part.trim())
      .join('\n')
      .trim();
    if (whole && whole !== entry.text) entry.more = clip(whole, MORE_MAX);
    if (out.interrupted) entry.text = 'Interrupted';
  }
  if (out.status === 'async_launched' || out.isAsync) entry.text = 'Runs in the background';
  if (entry.failed && !entry.text) entry.text = oneLine(blockText(block.content), RESULT_MAX);
  return entry;
}

// A prompt as the user wrote it. The app's own marks and the CLI's own notes are not the user's
// words: they are taken off, turned into a small note, or left out.
function userEntries(text, at) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  if (/^\s*<local-command-(caveat|stdout|stderr)>/.test(raw)) return [];
  const command = /<command-name>\s*(\/?[^<\s]+)\s*<\/command-name>/.exec(raw);
  if (command) {
    const args = /<command-args>([^<]*)<\/command-args>/.exec(raw);
    return [{ kind: 'note', text: ('You ran ' + command[1] + ' ' + (args?.[1] || '')).trim(), at }];
  }
  if (/^\s*<task-notification>/.test(raw))
    return [{ kind: 'note', text: 'A background task finished', at }];
  return promptEntries(raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, ''), at);
}

// `inSub`: the lines are a sub-agent's own record. There every line is marked as the sub-agent's
// (isSidechain), and the first prompt is what its lead asked of it, not the user's words.
function lineEntries(line, inSub) {
  if (!line || typeof line !== 'object' || line.isMeta) return [];
  if (!!line.isSidechain !== !!inSub) return [];
  const at = timeOf(line);
  const content = line.message?.content;

  // the title Claude Code gives the conversation, without the mark the app puts on a prompt
  if (line.type === 'ai-title' && line.aiTitle) {
    const title = String(line.aiTitle).replace(/^\s*\[(?:TN\.ai|TechnicallyNot\.ai)\]\s*/, '');
    return title ? [{ kind: 'title', text: clip(title, 160) }] : [];
  }
  if (line.type === 'system' && line.subtype === 'turn_duration' && line.durationMs > 0)
    return [{ kind: 'worked', ms: Math.round(line.durationMs), at }];
  if (line.type === 'system' && line.subtype === 'compact_boundary')
    return [{ kind: 'note', text: 'The conversation was compacted here', at }];

  // A prompt sent while the agent was working reaches it inside the running turn: Claude Code
  // records it as a "queued_command" attachment, never as a user line, so without this the
  // prompt is missing from the thread although the agent answered it.
  if (line.type === 'attachment') {
    const queued = line.attachment;
    const isPrompt =
      queued?.type === 'queued_command' &&
      typeof queued.prompt === 'string' &&
      (queued.commandMode || 'prompt') === 'prompt';
    return isPrompt ? userEntries(queued.prompt, at) : [];
  }
  if (line.type === 'user') {
    if (line.isCompactSummary) return [];
    if (typeof content === 'string') return userEntries(content, at);
    if (!Array.isArray(content)) return [];
    const results = content
      .filter(block => block?.type === 'tool_result')
      .map(block => resultOf(block, line));
    return results.length ? results : userEntries(blockText(content), at);
  }
  if (line.type !== 'assistant' || !Array.isArray(content)) return [];
  const out = [];
  for (const block of content) {
    if (block?.type === 'text' && block.text?.trim())
      out.push({
        kind: 'say',
        text: clip(block.text, TEXT_MAX),
        at,
        model: line.message.model || '',
      });
    else if (block?.type === 'tool_use' && block.name === 'AskUserQuestion')
      out.push({
        kind: 'ask',

        // Claude Code shows such a question as a numbered menu. One question with one choice to
        // make can be answered by that number; several questions, or several choices, cannot.
        press:
          Array.isArray(block.input?.questions) &&
          block.input.questions.length === 1 &&
          block.input.questions[0]?.multiSelect !== true,
        id: String(block.id || ''),
        questions: questionsOf(block.input),
        at,
      });

    // A sub-agent of Claude Code gives its answer to its lead through a tool call
    // (SubagentHandback, its `message`), not as text: those are its own words, shown as words.
    else if (
      block?.type === 'tool_use' &&
      block.name === 'SubagentHandback' &&
      typeof block.input?.message === 'string' &&
      block.input.message.trim()
    )
      out.push({
        kind: 'say',
        text: clip(block.input.message, TEXT_MAX),
        at,
        model: line.message.model || '',
      });
    else if (block?.type === 'tool_use')
      out.push({
        kind: 'act',
        id: String(block.id || ''),
        tool: String(block.name || ''),
        ...describeTool(block.name, block.input, line.cwd),
        at,
      });
  }
  return out;
}

// The pure part: transcript lines (text) in, entries out, in order.
function entries(lines, record, { sub = '' } = {}) {
  const out = [];
  for (const text of lines) {
    if (!text || text[0] !== '{') continue;
    let line = null;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    for (const entry of lineEntries(line, !!sub))
      out.push(sub && entry.kind === 'you' ? { ...entry, kind: 'from', who: 'its lead' } : entry);
  }
  return out;
}

module.exports = { agent: CLAUDE, fileFor, entries };
