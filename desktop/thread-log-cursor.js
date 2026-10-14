/*
 * Technically Not desktop · thread-log-cursor.js — Cursor Agent's reader for the thread log
 * (desktop/thread-log.js): where a chat's conversation is on disk, and its lines as entries.
 *
 * The source is Cursor Agent's own transcript of the chat (cursor-store.js knows the place):
 * ~/.cursor/projects/<folder slug>/agent-transcripts/<chat id>/<chat id>.jsonl, one JSON line per
 * message. Read in the real transcripts on this PC on 2026-10-11: a `user` line holds the prompt
 * (wrapped in tags Cursor adds), an `assistant` line holds text and `tool_use` blocks (the tool's
 * name and its input), and `turn_ended` closes a task.
 *
 * What the transcript does NOT hold, so the thread cannot show it: what an action gave back (no
 * output of a command, no error of a failed edit), an id per action, and any time. So an action is
 * shown as done with no result, a task ends with no length, and line counts are only those the
 * input itself states: the lines of the old and the new text of a replacement, the lines of a
 * written file, the + and - lines of a patch.
 *
 * `fileFor(record)` finds the transcript of a saved session record (session-store.js);
 * `entries(lines)` is tested by tools/thread-log-test.js.
 */
'use strict';
const fs = require('fs');
const cursorStore = require('./cursor-store');
const { clip, oneLine, shortPath, promptEntries } = require('./thread-log-text');

const TEXT_MAX = 24000;
const WHAT_MAX = 300;
const CURSOR = 'Cursor Agent';

// ---------- which file ----------
// The transcript of a saved session (record: agent, sessionId = the chat id, cwd), or '' when
// Cursor Agent has not written one yet.
function fileFor(record) {
  if (!record || record.agent !== CURSOR || !record.sessionId || !record.cwd) return '';
  const file = cursorStore.transcript(record.cwd, String(record.sessionId));
  try {
    return file && fs.statSync(file).isFile() ? file : '';
  } catch {
    return '';
  }
}

// ---------- one line of the transcript as entries ----------
const lineCount = text =>
  text
    ? String(text)
        .replace(/\r?\n$/, '')
        .split(/\r?\n/).length
    : 0;

// The + and - lines of a patch text, without its file headers.
function patchCounts(patch) {
  let added = 0;
  let removed = 0;
  for (const row of String(patch || '').split(/\r?\n/)) {
    if (/^(\+\+\+|---|\*\*\*)/.test(row)) continue;
    if (row[0] === '+') added++;
    else if (row[0] === '-') removed++;
  }
  return { added, removed };
}
const patchFiles = patch =>
  [...String(patch || '').matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1]);

// What a tool call is: a verb, the thing it acts on, and the line counts its input states.
function describe(name, input, cwd) {
  const data = input && typeof input === 'object' ? input : {};
  const file = shortPath(data.path || data.target_file, cwd);
  switch (name) {
    case 'Read':
    case 'ReadFile':
      return { verb: 'Read', what: file };
    case 'StrReplace':
      return {
        verb: 'Edited',
        what: file,
        added: lineCount(data.new_string),
        removed: lineCount(data.old_string),
      };
    case 'Write':
      return { verb: 'Wrote', what: file, added: lineCount(data.contents), removed: 0 };
    case 'ApplyPatch': {
      const patch = typeof input === 'string' ? input : data.patch || '';
      return {
        verb: 'Edited',
        what: oneLine(
          patchFiles(patch)
            .map(name => shortPath(name, cwd))
            .join(', '),
          WHAT_MAX
        ),
        ...patchCounts(patch),
      };
    }
    case 'Delete':
      return { verb: 'Deleted', what: file };
    case 'Shell':
      return { verb: 'Ran', what: oneLine(data.command, WHAT_MAX) };
    case 'Grep':
    case 'rg':
      return { verb: 'Searched for', what: oneLine(data.pattern, WHAT_MAX) };
    case 'Glob':
      return { verb: 'Looked for files', what: oneLine(data.glob_pattern, WHAT_MAX) };
    case 'Task':
    case 'Subagent':
      return { verb: 'Started a sub-agent', what: oneLine(data.description, WHAT_MAX) };
    case 'TodoWrite': {
      const list = Array.isArray(data.todos) ? data.todos : [];
      const done = list.filter(item => item?.status === 'completed').length;
      return {
        verb: 'Updated its checklist',
        what: list.length ? done + ' of ' + list.length + ' done' : '',
      };
    }
    case 'ReadLints':
      return { verb: 'Checked for problems', what: oneLine((data.paths || [])[0], WHAT_MAX) };
    case 'SearchConversations':
      return { verb: 'Searched past conversations for', what: oneLine(data.query, WHAT_MAX) };
    case 'CreatePlan':
      return { verb: 'Made a plan', what: oneLine(data.name, WHAT_MAX) };
    case 'GenerateImage':
      return { verb: 'Made an image', what: oneLine(data.filename || data.description, WHAT_MAX) };
    case 'WebFetch':
      return { verb: 'Opened', what: oneLine(data.url, WHAT_MAX) };
    case 'WebSearch':
      return { verb: 'Searched the web for', what: oneLine(data.search_term, WHAT_MAX) };
    case 'CallMcpTool':
      return { verb: 'Used', what: [data.server, data.toolName].filter(Boolean).join(' · ') };
    default:
      return { verb: 'Used', what: String(name || 'a tool') };
  }
}

// Tool calls Cursor makes for itself: looking up its own tools, naming its step, waiting.
const QUIET = new Set([
  'GetDynamicTools',
  'GetMcpTools',
  'UpdateCurrentStep',
  'AwaitShell',
  'Await',
  'SwitchMode',
  'SetActiveBranch',
  'unused',
]);

// Cursor runs many of its tools through one call, CallDynamicTool, which names the tool and holds
// its input as `arguments`. Seen in real transcripts on 2026-10-12: the namespace "cursor" holds
// Cursor's own tools under their usual names (TodoWrite, WebSearch, Task, ...); the others are
// connected tools (the browser, the app, a server's tools) and are shown by the tool's name.
function unwrapDynamic(block) {
  if (block.name !== 'CallDynamicTool' || !block.input || typeof block.input !== 'object')
    return block;
  return {
    ...block,
    name: block.input.toolName,
    input: block.input.arguments,
    namespace: block.input.namespace,
  };
}

// The transcript gives an action no id, so one is counted here. It only has to tie an action to
// its own "done" entry.
let counter = 0;

function questionsOf(input) {
  const list = Array.isArray(input?.questions) ? input.questions : [];
  return list.slice(0, 4).map(item => ({
    question: clip(String(item?.prompt || item?.question || ''), 600),
    options: (Array.isArray(item?.options) ? item.options : [])
      .slice(0, 6)
      .map(option => clip(String(option?.label || option || ''), 120)),
  }));
}

function lineEntries(line, cwd) {
  if (!line || typeof line !== 'object') return [];
  if (line.type === 'turn_ended')
    return line.status === 'success' || !line.status
      ? [{ kind: 'worked', ms: 0 }]
      : [
          {
            kind: 'note',
            text:
              line.status === 'aborted' ? 'The task was stopped' : 'The task ended with an error',
          },
        ];
  if (line.role === 'user') return promptEntries(cursorStore.userText(line), 0);
  if (line.role !== 'assistant' || !Array.isArray(line.message?.content)) return [];
  const out = [];
  for (const original of line.message.content) {
    const block = original?.type === 'tool_use' ? unwrapDynamic(original) : original;
    if (block?.type === 'text' && block.text?.trim())
      out.push({ kind: 'say', text: clip(block.text, TEXT_MAX) });
    if (block?.type !== 'tool_use' || !block.name || QUIET.has(block.name)) continue;
    const id = 'cursor-' + ++counter;
    if (block.name === 'AskQuestion') {
      out.push({ kind: 'ask', id, questions: questionsOf(block.input) });
      continue;
    }
    const { verb, what, added, removed } = describe(block.name, block.input, cwd);
    out.push({ kind: 'act', id, tool: String(block.name || ''), verb, what });

    // the transcript holds no result: the action is closed with what its input states, and no text
    const result = { kind: 'result', id, failed: false };
    if (added != null) {
      result.added = added;
      result.removed = removed || 0;
    }
    out.push(result);
  }
  return out;
}

function entries(lines, record) {
  const out = [];
  for (const text of lines) {
    if (!text || text[0] !== '{') continue;
    let line = null;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    out.push(...lineEntries(line, record?.cwd));
  }
  return out;
}

module.exports = { agent: CURSOR, fileFor, entries };
