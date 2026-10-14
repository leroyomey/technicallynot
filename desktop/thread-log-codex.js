/*
 * Technically Not desktop · thread-log-codex.js — Codex's reader for the thread log
 * (desktop/thread-log.js): where a session's conversation is on disk, and its lines as entries.
 *
 * The source is Codex's own record of the session, its rollout file:
 * <home>/sessions/<year>/<month>/<day>/rollout-<time>-<session id>.jsonl, one JSON line per event.
 * Read in real rollouts on 2026-10-11 (Codex 0.4x): a finished piece of the conversation is an
 * `event_msg` line of type `item_completed`, whose `item` is a `UserMessage` (the prompt), an
 * `AgentMessage` (the agent's words), a `CommandExecution` (the command, its output and its exit
 * code) or an `McpToolCall` (a tool of a connected server, with its result). A task's end is
 * `task_complete` with its length. Older rollouts have no `item_completed` lines and record the
 * two sides as `user_message` and `agent_message` events instead: both forms are read, and a file
 * holds one or the other. `response_item` lines repeat the same content for the model, with the
 * instructions Codex adds, and are left out; so is `Reasoning`.
 *
 * `fileFor(record)` finds the rollout of a saved session record (session-store.js);
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
const CODEX = 'Codex';

// ---------- which file ----------
// A found rollout is remembered: the file of a session never moves.
const found = new Map();

// The newest folders first: a session that is open now is near the top.
const newestFirst = folder => {
  try {
    return fs.readdirSync(folder).sort().reverse();
  } catch {
    return [];
  }
};

function findRollout(home, sessionId) {
  const root = path.join(home, 'sessions');
  for (const year of newestFirst(root))
    for (const month of newestFirst(path.join(root, year)))
      for (const day of newestFirst(path.join(root, year, month))) {
        const folder = path.join(root, year, month, day);
        const hit = newestFirst(folder).find(
          name => name.startsWith('rollout-') && name.endsWith(sessionId + '.jsonl')
        );
        if (hit) return path.join(folder, hit);
      }
  return '';
}

// The rollout of a saved session (session-store.js record: agent, sessionId, accountDir), or ''
// when there is none yet.
function fileFor(record, { env = process.env, home = os.homedir() } = {}) {
  if (!record || record.agent !== CODEX || !record.sessionId) return '';
  const known = found.get(record.sessionId);
  if (known) return known;
  const homes = [record.accountDir, env.CODEX_HOME, path.join(home, '.codex')].filter(Boolean);
  for (const base of homes) {
    const file = findRollout(base, String(record.sessionId));
    if (file) {
      found.set(record.sessionId, file);
      return file;
    }
  }
  return '';
}

// ---------- one line of the rollout as entries ----------
const timeOf = line => {
  const at = Date.parse(line.timestamp || '');
  return Number.isFinite(at) ? at : 0;
};
const textOf = content =>
  (Array.isArray(content) ? content : [])
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('\n');

// A command as a person reads it: Codex's own short form, else the last word of how it was run.
function commandText(item) {
  const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd[0]?.cmd : '';
  const run = Array.isArray(item.command) ? item.command[item.command.length - 1] : item.command;
  return oneLine(parsed || run, WHAT_MAX);
}

// An action Codex finished comes with what it gave back, so it is two entries with one id.
function actionEntries(id, tool, verb, what, result, at) {
  return [
    { kind: 'act', id, tool, verb, what, at },
    { kind: 'result', id, ...result },
  ];
}

// The + and - lines of a unified diff, without its file headers.
function diffCounts(diff) {
  let added = 0;
  let removed = 0;
  for (const row of String(diff || '').split(/\r?\n/)) {
    if (/^(\+\+\+|---)/.test(row)) continue;
    if (row[0] === '+') added++;
    else if (row[0] === '-') removed++;
  }
  return { added, removed };
}
const lineCount = text =>
  text
    ? String(text)
        .replace(/\r?\n$/, '')
        .split(/\r?\n/).length
    : 0;

// A patch as an action and its result. The files come as an object keyed by path (or as a list of
// { path, ... } in a form not seen so far); the counts are the ones the diff or the content state.
function patchEntries(item, id, at, cwd) {
  const list = Array.isArray(item.changes)
    ? item.changes.map(change => [change?.path, change])
    : Object.entries(item.changes && typeof item.changes === 'object' ? item.changes : {});
  const files = list.map(([name]) => shortPath(name, item.cwd || cwd)).filter(Boolean);
  let added = 0;
  let removed = 0;
  for (const [, change] of list) {
    if (change?.type === 'add') added += lineCount(change.content);
    else if (change?.type === 'delete') removed += lineCount(change.content);
    else {
      const counts = diffCounts(change?.unified_diff);
      added += counts.added;
      removed += counts.removed;
    }
  }
  const kinds = new Set(list.map(([, change]) => change?.type));
  const verb =
    kinds.size === 1 && kinds.has('add')
      ? 'Wrote'
      : kinds.size === 1 && kinds.has('delete')
        ? 'Deleted'
        : 'Edited';
  return actionEntries(
    id,
    'patch',
    verb,
    oneLine(files.join(', '), WHAT_MAX),
    { failed: item.status === 'failed', added, removed, created: verb === 'Wrote' },
    at
  );
}

function itemEntries(item, at, cwd) {
  const id = String(item.id || '');
  if (item.type === 'UserMessage') return promptEntries(textOf(item.content), at);
  if (item.type === 'AgentMessage') {
    const text = textOf(item.content);
    return text.trim() ? [{ kind: 'say', text: clip(text, TEXT_MAX), at }] : [];
  }
  if (item.type === 'CommandExecution') {
    const rows = String(item.aggregated_output || '')
      .trim()
      .split(/\r?\n/);
    const failed =
      typeof item.exit_code === 'number' ? item.exit_code !== 0 : item.status === 'failed';
    return actionEntries(
      id,
      'exec',
      'Ran',
      commandText(item),
      { failed, text: clip(rows[rows.length - 1] || '', RESULT_MAX) },
      at
    );
  }
  if (item.type === 'McpToolCall') {
    const reply = oneLine(textOf(item.result?.content), RESULT_MAX);
    return actionEntries(
      id,
      String(item.tool || ''),
      'Used',
      [item.server, item.tool].filter(Boolean).join(' · '),
      { failed: item.status === 'failed' || !!item.error, text: reply },
      at
    );
  }

  // A patch. Read in real rollouts on 2026-10-12: `changes` is an object keyed by the file's full
  // path, each value being { type: 'add' | 'update' | 'delete', content } or, for an update,
  // { type: 'update', unified_diff, move_path }.
  if (item.type === 'FileChange' || item.type === 'PatchApply')
    return patchEntries(item, id, at, cwd);

  // Codex's own web search: the words searched for, or the page it opened
  if (item.type === 'Extension' && item.kind === 'web.search') {
    const action = item.action || {};
    const words = item.query || action.query || (action.queries || [])[0] || '';
    const opened = action.type === 'openPage' || action.type === 'findInPage';
    const count = Array.isArray(item.results) ? item.results.length : 0;
    return actionEntries(
      id,
      'web',
      opened ? 'Opened' : 'Searched the web for',
      oneLine(words || action.url, WHAT_MAX),
      { failed: false, text: count ? count + ' results' : '' },
      at
    );
  }
  if (item.type === 'ContextCompaction')
    return [{ kind: 'note', text: 'The conversation was compacted here', at }];
  return [];
}

function lineEntries(line, cwd) {
  const payload = line?.payload;
  if (!payload || line.type !== 'event_msg') return [];
  const at = timeOf(line);
  if (payload.type === 'item_completed' && payload.item) return itemEntries(payload.item, at, cwd);

  // the older form of the two sides
  if (payload.type === 'user_message') return promptEntries(payload.message, at);
  if (payload.type === 'agent_message' && String(payload.message || '').trim())
    return [{ kind: 'say', text: clip(String(payload.message), TEXT_MAX), at }];
  if (payload.type === 'task_complete' && payload.duration_ms > 0)
    return [{ kind: 'worked', ms: Math.round(payload.duration_ms), at }];
  if (payload.type === 'turn_aborted') return [{ kind: 'note', text: 'The task was stopped', at }];
  return [];
}

// The pure part: rollout lines (text) in, entries out, in order.
function entries(lines, record) {
  // the folder the session works in, to show paths from it: the record, else the rollout's first
  // line
  let cwd = record?.cwd || '';
  const out = [];
  for (const text of lines) {
    if (!text || text[0] !== '{') continue;
    let line = null;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    if (line?.type === 'session_meta' && line.payload?.cwd) cwd = line.payload.cwd;
    out.push(...lineEntries(line, cwd));
  }
  return out;
}

module.exports = { agent: CODEX, fileFor, entries };
