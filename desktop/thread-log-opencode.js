/*
 * Technically Not desktop · thread-log-opencode.js — OpenCode's reader for the thread log
 * (desktop/thread-log.js): a session's conversation as entries, read from OpenCode's own record.
 *
 * OpenCode keeps no file of lines. Its record is a SQLite database (opencode-store.js knows the
 * place), read here read-only. Read in the real database on this PC on 2026-10-11 (OpenCode 1.19):
 * a `message` row is one side's message (`role` user or assistant; an assistant message names the
 * user message it answers in `parentID`, and has `finish` and `time.completed` once it is done),
 * and a `part` row is one piece of a message: `text` (words), `tool` (the tool's name, its input,
 * and a `state` that goes from running to completed or error, with its output, its `title` and for
 * an edit the lines added and removed), `compaction`, and pieces OpenCode keeps for itself
 * (`reasoning`, `step-start`, `step-finish`, `patch`), which are left out.
 *
 * A part changes while the agent works (text grows, a tool finishes), so this reader does not
 * read "new lines": it reads every part changed since the time of the last read, and each entry
 * carries the part's id. The window draws an entry with an id once and updates it when it comes
 * again. Of a long session only the newest MAX_PARTS parts are read at first.
 *
 * `read(record, from)` is the whole reader (the session id is in the saved session record);
 * `partEntries` is the pure part. Both are tested by tools/thread-log-test.js with a database
 * made for the test in the same tables.
 */
'use strict';
const opencodeStore = require('./opencode-store');
const { clip, oneLine, shortPath, promptEntries } = require('./thread-log-text');

const TEXT_MAX = 24000;
const RESULT_MAX = 400;
const WHAT_MAX = 300;
const MAX_PARTS = 1500;
const OPENCODE = 'OpenCode';

// ---------- the database, read-only ----------
const handles = new Map();

function open(file) {
  if (handles.has(file)) return handles.get(file);
  let db = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
  } catch {}
  if (db) handles.set(file, db);
  return db;
}
const rows = (db, sql, ...args) => {
  try {
    return db.prepare(sql).all(...args);
  } catch {
    return [];
  }
};
const json = text => {
  try {
    return JSON.parse(text) || {};
  } catch {
    return {};
  }
};

// ---------- one part as entries ----------
const VERBS = {
  read: 'Read',
  edit: 'Edited',
  write: 'Wrote',
  bash: 'Ran',
  grep: 'Searched for',
  glob: 'Looked for files',
  task: 'Started a sub-agent',
  webfetch: 'Opened',
  websearch: 'Searched the web for',
};

function whatOf(tool, input, cwd) {
  const data = input && typeof input === 'object' ? input : {};
  if (tool === 'read' || tool === 'edit' || tool === 'write') return shortPath(data.filePath, cwd);
  if (tool === 'bash') return oneLine(data.command, WHAT_MAX);
  if (tool === 'grep' || tool === 'glob') return oneLine(data.pattern, WHAT_MAX);
  if (tool === 'task') return oneLine(data.description, WHAT_MAX);
  if (tool === 'webfetch') return oneLine(data.url, WHAT_MAX);
  if (tool === 'websearch') return oneLine(data.query, WHAT_MAX);
  if (tool === 'todowrite') {
    const list = Array.isArray(data.todos) ? data.todos : [];
    const done = list.filter(item => item?.status === 'completed').length;
    return list.length ? done + ' of ' + list.length + ' done' : '';
  }
  return '';
}
const lineCount = text =>
  text
    ? String(text)
        .replace(/\r?\n$/, '')
        .split(/\r?\n/).length
    : 0;

// What a finished tool gave back.
function resultOf(id, tool, state) {
  const entry = { kind: 'result', id, failed: state.status === 'error' };
  const meta = state.metadata && typeof state.metadata === 'object' ? state.metadata : {};
  if (entry.failed) {
    entry.text = oneLine(String(state.error || 'Failed'), RESULT_MAX);
    return entry;
  }
  if (tool === 'edit' && meta.filediff && typeof meta.filediff === 'object') {
    entry.added = Number(meta.filediff.additions) || 0;
    entry.removed = Number(meta.filediff.deletions) || 0;
  } else if (tool === 'write') {
    entry.added = lineCount(state.input?.content);
    entry.removed = 0;
    entry.created = meta.exists === false;
  } else if (tool === 'bash') {
    const out = String(meta.output ?? state.output ?? '')
      .trim()
      .split(/\r?\n/);
    entry.text = clip(out[out.length - 1] || '', RESULT_MAX);
    if (typeof meta.exit === 'number' && meta.exit !== 0) entry.failed = true;
  } else if (tool === 'glob' && typeof meta.count === 'number') entry.text = meta.count + ' found';
  else if (tool === 'grep' && typeof meta.matches === 'number')
    entry.text = meta.matches + ' matches';
  return entry;
}

// One part (its id, its data, the message it belongs to) as entries. Every entry has an id.
function partEntries(part, message, cwd) {
  const id = String(part.id);
  const at = Number(part.time_created) || 0;
  const data = part.data;
  if (data.type === 'compaction')
    return [{ kind: 'note', id, text: 'The conversation was compacted here', at }];
  if (data.type === 'text' && data.text && !data.synthetic) {
    if (message.role === 'user')
      return promptEntries(data.text, at).map(entry => ({ ...entry, id }));
    return [{ kind: 'say', id, text: clip(data.text, TEXT_MAX), at, model: message.modelID || '' }];
  }
  if (data.type !== 'tool' || !data.state) return [];
  const tool = String(data.tool || '');
  const state = data.state;
  const act = {
    kind: 'act',
    id,
    tool,
    verb: VERBS[tool] || (tool === 'todowrite' ? 'Updated its checklist' : 'Used'),
    what: whatOf(tool, state.input, cwd) || (VERBS[tool] || tool === 'todowrite' ? '' : tool),
    at,
  };
  if (state.status !== 'completed' && state.status !== 'error') return [act];
  return [act, resultOf(id, tool, state)];
}

// ---------- the reader ----------
// `from`: the newest change time already read (ms), or -1 for a first read. Parts changed at that
// very millisecond come again; the window knows them by their id.
async function read(
  record,
  from = -1,
  { file = opencodeStore.dbFile(), maxParts = MAX_PARTS } = {}
) {
  const none = { entries: [], next: 0, cut: false, reset: false, found: false };
  const sessionId = record?.agent === OPENCODE ? String(record.sessionId || '') : '';
  const db = sessionId ? open(file) : null;
  if (!db) return none;
  const session = rows(db, 'SELECT title, directory FROM session WHERE id = ?', sessionId)[0];
  if (!session) return none;
  const first = !(from >= 0);
  const changed = rows(
    db,
    'SELECT id, message_id, time_created, time_updated, data FROM part WHERE session_id = ? AND time_updated >= ? ORDER BY time_created DESC, id DESC LIMIT ?',
    sessionId,
    first ? 0 : from,
    maxParts + 1
  );
  const cut = first && changed.length > maxParts;
  const parts = changed.slice(0, maxParts).reverse();

  // the messages of this session: whose side a part is on, and when a task began and ended
  const messages = new Map(
    rows(db, 'SELECT id, time_created, data FROM message WHERE session_id = ?', sessionId).map(
      row => [row.id, { ...json(row.data), id: row.id, created: Number(row.time_created) || 0 }]
    )
  );
  const cwd = session.directory || record.cwd || '';
  const out = [];
  let next = first ? 0 : from;

  // The last message of a task is done: how long the task took, from the prompt to its end. It is
  // said right after that message's last part, so a first read of several tasks stays in order.
  const worked = message => {
    const prompt = messages.get(message.parentID);
    const start = prompt?.time?.created || prompt?.created || message.time.created;
    return {
      kind: 'worked',
      id: message.id + ':done',
      ms: Math.max(0, Math.round(message.time.completed - start)),
      at: message.time.completed,
    };
  };
  const closes = message =>
    message?.role === 'assistant' &&
    !!message.time?.completed &&
    !!message.finish &&
    message.finish !== 'tool-calls';
  let last = null;
  for (const row of parts) {
    next = Math.max(next, Number(row.time_updated) || 0);
    const message = messages.get(row.message_id);
    if (!message) continue;
    if (last && last.id !== message.id && closes(last)) out.push(worked(last));
    out.push(...partEntries({ ...row, data: json(row.data) }, message, cwd));
    last = message;
  }
  if (closes(last)) out.push(worked(last));

  // OpenCode's own title for the session; until it has one it writes "New session - <time>", which
  // says nothing and is left out
  const title = String(session.title || '');
  if (first && title && !/^New session - \d{4}-/.test(title))
    out.unshift({ kind: 'title', text: clip(title, 160) });
  return { entries: out, next, cut, reset: false, found: true };
}

module.exports = { agent: OPENCODE, read, partEntries };
