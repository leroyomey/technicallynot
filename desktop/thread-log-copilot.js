/*
 * Technically Not desktop · thread-log-copilot.js — GitHub Copilot CLI's reader for the thread log
 * (desktop/thread-log.js): where a session's conversation is on disk, and its lines as entries.
 *
 * The source is Copilot CLI's own record of the session:
 * <COPILOT_HOME or ~/.copilot>/session-state/<session id>/events.jsonl, one JSON event per line
 * ({ type, data, id, timestamp, parentId, agentId }). Technically Not starts Copilot with its own
 * `--session-id`, so the folder is known.
 *
 * Written on 2026-10-21 from the event schema Copilot CLI 1.0.101 ships with itself
 * (schemas/session-events.schema.json in its unpacked package) and the real records on this PC,
 * which hold only `session.start` and `session.shutdown`: this PC's Copilot account has no chat,
 * so no real conversation has been read yet (wired, not proven). Events the schema marks
 * `ephemeral` are never written to the file, so they are not read here.
 *
 * What is read: `user.message` (the prompt, `content` as Copilot shows it), `assistant.message`
 * (the agent's words), `tool.execution_start` (the tool and its arguments) with
 * `tool.execution_complete` (success, and the result's text or the error), `abort` (stopped),
 * `session.error` and `session.compaction_complete`. Events of Copilot's own sub-agents (with
 * `agentId` or `parentToolCallId`) are left out, as the other readers show only the main
 * conversation. The end of a task is not written (`session.idle` is ephemeral), so a task has no
 * length here.
 *
 * `fileFor(record)` finds the record of a saved session (session-store.js); `entries(lines)` is
 * tested by tools/thread-log-test.js.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clip, oneLine, shortPath, promptEntries } = require('./thread-log-text');

const TEXT_MAX = 24000;
const RESULT_MAX = 400;
const WHAT_MAX = 300;
const COPILOT = 'GitHub Copilot';

// a session id is one plain name (Technically Not makes it a uuid): never a path
const SESSION_ID = /^[\w.-]{1,128}$/;

// ---------- which file ----------
// The record of a saved session (record: agent, sessionId, accountDir = the account's
// COPILOT_HOME), or '' when Copilot has not written one yet.
function fileFor(record, { env = process.env, home = os.homedir() } = {}) {
  if (!record || record.agent !== COPILOT) return '';
  const sessionId = String(record.sessionId || '');
  if (!SESSION_ID.test(sessionId) || sessionId.startsWith('.')) return '';
  const homes = [record.accountDir, env.COPILOT_HOME, path.join(home, '.copilot')].filter(Boolean);
  for (const base of homes) {
    const file = path.join(base, 'session-state', sessionId, 'events.jsonl');
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {}
  }
  return '';
}

// ---------- one event as entries ----------
const timeOf = event => {
  const at = Date.parse(event.timestamp || '');
  return Number.isFinite(at) ? at : 0;
};
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

// The checklist Copilot keeps as markdown ("- [x] done", "- [ ] open").
function checklist(todos) {
  const rows = String(todos || '').match(/^\s*[-*] \[[ xX]\]/gm) || [];
  const done = rows.filter(row => /\[[xX]\]/.test(row)).length;
  return rows.length ? done + ' of ' + rows.length + ' done' : '';
}

// What a tool call is: a verb, the thing it acts on, and the line counts its arguments state.
// Tool names and argument names are the ones in Copilot CLI 1.0.101's own tool list.
function describe(name, args, cwd) {
  const data = args && typeof args === 'object' ? args : {};
  const file = shortPath(data.path, cwd);
  switch (name) {
    case 'bash':
    case 'powershell':
      return { verb: 'Ran', what: oneLine(data.command, WHAT_MAX) };
    case 'write_bash':
    case 'write_powershell':
      return { verb: 'Typed into a command', what: oneLine(data.input, WHAT_MAX) };
    case 'view':
    case 'view_file_chunked':
      return { verb: 'Read', what: file };
    case 'view_image':
      return { verb: 'Looked at', what: file };
    case 'ls':
      return { verb: 'Listed', what: file };
    case 'create':
      return { verb: 'Wrote', what: file, added: lineCount(data.file_text), removed: 0 };
    case 'edit':
    case 'str_replace':
      return {
        verb: 'Edited',
        what: file,
        added: lineCount(data.new_str),
        removed: lineCount(data.old_str),
      };
    case 'str_replace_editor':
      if (data.command === 'view') return { verb: 'Read', what: file };
      if (data.command === 'create')
        return { verb: 'Wrote', what: file, added: lineCount(data.file_text), removed: 0 };
      return {
        verb: 'Edited',
        what: file,
        added: lineCount(data.new_str),
        removed: lineCount(data.old_str),
      };
    case 'apply_patch': {
      const patch = typeof args === 'string' ? args : data.patch || data.input || '';
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
    case 'grep':
    case 'rg':
      return { verb: 'Searched for', what: oneLine(data.pattern || data.query, WHAT_MAX) };
    case 'glob':
      return { verb: 'Looked for files', what: oneLine(data.pattern, WHAT_MAX) };
    case 'web_fetch':
      return { verb: 'Opened', what: oneLine(data.url, WHAT_MAX) };
    case 'web_search':
      return { verb: 'Searched the web for', what: oneLine(data.query, WHAT_MAX) };
    case 'task':
      return {
        verb: 'Started a sub-agent',
        what: oneLine(data.description || data.agent_type, WHAT_MAX),
      };
    case 'update_todo':
      return { verb: 'Updated its checklist', what: checklist(data.todos) };
    case 'skill':
      return { verb: 'Used the skill', what: oneLine(data.skill, WHAT_MAX) };
    default:
      return { verb: 'Used', what: String(name || 'a tool') };
  }
}

// Tool calls Copilot makes for itself: naming its step, looking up tools, reading a command it
// already started, renaming the session.
const QUIET = new Set([
  'report_intent',
  'tool_search_tool',
  'catalog_search',
  'catalog_select',
  'rename_session',
  'rename_branch',
  'task_complete',
  'read_bash',
  'read_powershell',
  'list_bash',
  'list_powershell',
  'stop_bash',
  'stop_powershell',
]);

// An action's line counts come with its start; its result comes later, maybe in a later read.
// Kept here by the call's id until then (bounded: an action that never finishes falls out).
const PENDING_MAX = 500;
const pending = new Map();

function remember(id, counts) {
  pending.set(id, counts);
  if (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value);
}

// The last line of what a tool gave back, or its error.
function resultText(data) {
  if (data.success === false) return oneLine(data.error?.message || '', RESULT_MAX);
  const rows = String(data.result?.content || '')
    .trim()
    .split(/\r?\n/);
  return clip(rows[rows.length - 1] || '', RESULT_MAX);
}

function eventEntries(event, cwd) {
  const data = event.data && typeof event.data === 'object' ? event.data : {};

  // Copilot's own sub-agents: their steps are theirs, not the main conversation's
  if (event.agentId || data.parentToolCallId) return [];
  const at = timeOf(event);
  switch (event.type) {
    case 'user.message': {
      // instructions a skill or Copilot's own loop put in, not typed by anyone
      if (data.isAutopilotContinuation || /^skill-/.test(String(data.source || ''))) return [];
      return promptEntries(String(data.content || ''), at);
    }
    case 'assistant.message': {
      const text = String(data.content || '');
      if (!text.trim()) return [];
      const entry = { kind: 'say', text: clip(text, TEXT_MAX), at };
      if (data.model) entry.model = String(data.model);
      return [entry];
    }
    case 'tool.execution_start': {
      const name = String(data.toolName || '');
      const id = String(data.toolCallId || '');
      if (!name || !id || QUIET.has(name)) return [];
      if (name === 'ask_user') {
        const options = Array.isArray(data.arguments?.choices) ? data.arguments.choices : [];
        return [
          {
            kind: 'ask',
            id,
            questions: [
              {
                question: clip(String(data.arguments?.question || ''), 600),
                options: options.slice(0, 6).map(option => clip(String(option || ''), 120)),
              },
            ],
            at,
          },
        ];
      }

      // a tool of a connected server, named by its server
      if (data.mcpServerName) {
        remember(id, {});
        return [
          {
            kind: 'act',
            id,
            tool: name,
            verb: 'Used',
            what: [data.mcpServerName, data.mcpToolName || name].join(' · '),
            at,
          },
        ];
      }
      const { verb, what, added, removed } = describe(name, data.arguments, cwd);
      remember(
        id,
        added == null ? {} : { added, removed: removed || 0, created: verb === 'Wrote' }
      );
      return [{ kind: 'act', id, tool: name, verb, what, at }];
    }
    case 'tool.execution_complete': {
      const id = String(data.toolCallId || '');
      if (!pending.has(id)) return [];
      const counts = pending.get(id);
      pending.delete(id);
      return [
        // `at`: when it finished, for 187's time bar and a helper's end time (122)
        {
          kind: 'result',
          id,
          failed: data.success === false,
          text: resultText(data),
          ...counts,
          at,
        },
      ];
    }
    case 'abort':
      return [{ kind: 'note', text: 'The task was stopped', at }];
    case 'session.error':
      return [{ kind: 'note', text: 'The task ended with an error', at }];
    case 'session.compaction_complete':
      return data.success === false
        ? []
        : [{ kind: 'note', text: 'The conversation was compacted here', at }];
    default:
      return [];
  }
}

// The pure part: record lines (text) in, entries out, in order.
function entries(lines, record) {
  // the folder the session works in, to show paths from it: the record, else the session's start
  let cwd = record?.cwd || '';
  const out = [];
  for (const text of lines) {
    if (!text || text[0] !== '{') continue;
    let event = null;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'session.start' && event.data?.context?.cwd && !record?.cwd)
      cwd = event.data.context.cwd;
    out.push(...eventEntries(event, cwd));
  }
  return out;
}

module.exports = { agent: COPILOT, fileFor, entries };
