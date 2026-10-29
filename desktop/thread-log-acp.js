/*
 * Technically Not desktop · thread-log-acp.js — the reader for every tool that runs through the
 * ACP connector (acp-connector.js), for the thread log (desktop/thread-log.js).
 *
 * The source is the connector's own record, written by acp-bridge.js while the session runs:
 * <settings folder>/acp-sessions/<session id>.jsonl, one JSON line each, with `at` (ms):
 *   meta { agent, acpSession, version, how }   the session opened ('new' or 'reopened')
 *   user { text }                              a prompt as it was sent
 *   say { id, text }                           the agent's words so far; a later line with the
 *                                              same id holds more of the same words
 *   tool { id, title, kind, status, path }     a tool call, again on each change of its status
 *   plan { items }, permission { id, title }, answer { id, option }
 *   end { stopReason, ms }, error { text, ms }, note { text }, exit { text }
 * Every line is something the agent itself said over ACP (or, for a prompt, what was sent to it).
 * An ACP agent sends no thinking and, by the protocol, no line counts, so none are shown.
 * `entries(lines)` is tested by tools/thread-log-test.js.
 */
'use strict';
const fs = require('fs');
const acp = require('./acp-connector');
const registry = require('./agent-registry');
const { clip, oneLine, shortPath, promptEntries } = require('./thread-log-text');

const TEXT_MAX = 24000;
const WHAT_MAX = 300;

// The tools that run through the connector (agent-registry.js entries with `acp`).
const AGENTS = registry.acpIds();

// ---------- which file ----------
function fileFor(record) {
  if (!record || !AGENTS.includes(record.agent) || !record.sessionId) return '';
  const file = acp.recordFile(record.sessionId);
  try {
    return file && fs.statSync(file).isFile() ? file : '';
  } catch {
    return '';
  }
}

// ---------- one line as entries ----------

// What a person reads for an ACP tool kind (the protocol's list).
const VERBS = {
  read: 'Read',
  edit: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
  search: 'Searched for',
  execute: 'Ran',
  fetch: 'Opened',
  think: 'Thought about',
};

function toolEntries(line, cwd, at) {
  const id = 'acp-tool-' + String(line.id || '');
  const what = line.path ? shortPath(line.path, cwd) : oneLine(line.title || '', WHAT_MAX);
  const entries = [
    {
      kind: 'act',
      id,
      tool: String(line.kind || 'other'),
      verb: VERBS[line.kind] || 'Used',
      what: clip(what, WHAT_MAX),
      note: line.path ? oneLine(line.title || '', WHAT_MAX) : '',
      at,
    },
  ];
  if (line.status === 'completed' || line.status === 'failed')
    entries.push({
      kind: 'result',
      id,
      failed: line.status === 'failed',
      text: line.status === 'failed' ? 'Failed' : '',
    });
  return entries;
}

// The end of a task: its length, and why when it did not simply finish.
function endEntries(line, at) {
  const entries = [{ kind: 'worked', ms: Number(line.ms) || 0, at }];
  if (line.stopReason === 'cancelled')
    entries.unshift({ kind: 'note', text: 'You stopped it', at });
  else if (line.stopReason && line.stopReason !== 'end_turn')
    entries.unshift({
      kind: 'note',
      text: 'Ended: ' + String(line.stopReason).replace(/_/g, ' '),
      at,
    });
  return entries;
}

function lineEntries(line, cwd) {
  const at = Number(line.at) || 0;
  switch (line.type) {
    case 'user':
      return promptEntries(String(line.text || ''), at);
    case 'say':
      return String(line.text || '').trim()
        ? [{ kind: 'say', id: 'acp-say-' + line.id, text: clip(String(line.text), TEXT_MAX), at }]
        : [];
    case 'tool':
      return line.id ? toolEntries(line, cwd, at) : [];
    case 'end':
      return endEntries(line, at);
    case 'error':
      return [
        { kind: 'note', text: 'Error: ' + oneLine(line.text || '', WHAT_MAX), at },
        { kind: 'worked', ms: Number(line.ms) || 0, at },
      ];
    case 'note':
      return [{ kind: 'note', text: oneLine(line.text || '', WHAT_MAX), at }];
    case 'exit':
      return [{ kind: 'note', text: 'The tool ' + oneLine(line.text || 'ended', WHAT_MAX), at }];
    default:
      return [];
  }
}

// Lines of the record (text) in, entries out, in order.
function entries(lines, record) {
  const cwd = record?.cwd || '';
  const out = [];
  for (const text of lines) {
    let line = null;
    try {
      line = text.trim() ? JSON.parse(text) : null;
    } catch {}
    if (line && typeof line === 'object') out.push(...lineEntries(line, cwd));
  }
  return out;
}

module.exports = { agent: AGENTS[0] || 'Mistral Vibe', agents: AGENTS, fileFor, entries };
