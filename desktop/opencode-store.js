/*
 * Technically Not desktop · opencode-store.js — OpenCode's own record of its sessions: one SQLite
 * file (opencode 1.18: `opencode db path`), read-only through node:sqlite. Tables used: session(id,
 * directory, parent_id, time_created), message(id, session_id, time_created, data JSON: role,
 * parentID, time.completed, finish, error, tokens, cost), part(message_id, data JSON: type, text).
 * pty-service.js finds a pane's session here; agent-turns.js reads its turns; usage-stats.js reads
 * every answer's tokens (usage).
 */
'use strict';
const os = require('os');
const path = require('path');

// OpenCode keeps its data under XDG_DATA_HOME (default ~/.local/share, also on Windows).
const dataDir = () =>
  path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode');
const dbFile = () => path.join(dataDir(), 'opencode.db');
let db = null;

function open() {
  if (db) return db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbFile(), { readOnly: true });
  } catch {
    db = null;
  }
  return db;
}

function all(sql, ...args) {
  try {
    return (
      open()
        ?.prepare(sql)
        .all(...args) || []
    );
  } catch {
    db = null;
    return [];
  }
} // a failed read reopens next time
const json = s => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
const slash = p =>
  String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();

// The top-level session OpenCode started in this folder since the pane started (not one another
// pane already has). OpenCode sets no id at launch, so the folder + time is the match, checked
// against the prompts each pane was sent (submitted(), from agent-turns.js): a session whose first
// prompt another pane sent is never taken (an idle OpenCode panel in the same folder took a
// sub-agent's session, so the lead never got its report), one this pane sent comes first. A prompt
// typed by hand is unknown to both, so two OpenCode panes in the same folder could still swap then
// (inferred, CURRENT_STATE).
const sent = new Map(); // paneId -> the last prompts pasted into it (normalized)
const key = v =>
  String(v || '')
    .replace(/\s+/g, ' ')
    .trim();
const same = (a, b) =>
  !!a && !!b && (a.startsWith(b.slice(0, 120)) || b.startsWith(a.slice(0, 120)));

function submitted(paneId, text) {
  const t = key(text);
  if (!t) return;
  const list = sent.get(paneId) || [];
  list.push(t);
  sent.set(paneId, list.slice(-10));
}

function forget(paneId) {
  sent.delete(paneId);
}

function firstPrompt(sessionId) {
  const [m] = all(
    "SELECT id FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created, id LIMIT 1",
    sessionId
  );
  return m
    ? key(
        all('SELECT data FROM part WHERE message_id = ? ORDER BY id', m.id)
          .map(p => json(p.data))
          .filter(p => p.type === 'text' && !p.synthetic)
          .map(p => p.text)
          .join('\n')
      )
    : '';
}

function findSession(startedAt, cwd, taken = new Set(), paneId = '') {
  const want = slash(cwd);
  const rows = all(
    "SELECT id, directory FROM session WHERE (parent_id IS NULL OR parent_id = '') AND time_created >= ? ORDER BY time_created ASC",
    (startedAt || 0) - 2000
  ).filter(r => slash(r.directory) === want && !taken.has(r.id));
  if (!paneId || !rows.length) return rows[0]?.id || '';
  const owner = r => {
    const p = firstPrompt(r.id);
    for (const [id, list] of sent) if (list.some(t => same(t, p))) return id;
    return '';
  };
  const tagged = rows.map(r => ({ id: r.id, by: owner(r) }));
  return (tagged.find(r => r.by === paneId) || tagged.find(r => !r.by))?.id || '';
}

// The session's latest turn: its user message, then the assistant steps that answer it (parentID).
// It has ended when a step completed with a finish other than tool-calls (more steps follow those);
// the answer is that step's last text part. It has also ended when its last step completed with an
// `error` and no finish (opencode 1.18.35, one real interrupted run 2026-10-06: { error: { name:
// 'MessageAbortedError', data: { message: 'Aborted' } }, time.completed }, no parts): Esc is
// 'interrupted', any other error 'error', both without an answer. A task that failed before
// OpenCode wrote any assistant message (a model it does not have: only the user message is written)
// cannot be told from one still starting, so it is not ended here; only OpenCode's own
// session.error / session.idle events show it. A /compact is not a task (opencode 1.18.35, one real
// compacted session read 2026-10-06): it writes a user message whose only part is { type:
// 'compaction', auto } and an answer with mode and agent 'compaction' and summary: true, whose text
// is the summary. Both are skipped, so the task before it stays the latest one. The context size
// after it is the finished summary answer's tokens.total (a real run 2026-10-06: 567, the number
// OpenCode's own footer then showed); while the summary is still being written it is unknown
// (null), never guessed. compactedAt: when the compaction finished, or began while it runs (0 =
// none since the task).
function lastTurn(sessionId) {
  const users = all(
    "SELECT id, time_created AS at FROM message WHERE session_id = ? AND json_extract(data, '$.role') = 'user' ORDER BY time_created DESC, id DESC LIMIT 6",
    sessionId
  );
  const compaction = id =>
    all(
      "SELECT 1 AS x FROM part WHERE message_id = ? AND json_extract(data, '$.type') = 'compaction' LIMIT 1",
      id
    ).length > 0;
  let compactedAt = 0,
    user = null,
    compactId = '';
  for (const u of users) {
    if (!compaction(u.id)) {
      user = u;
      break;
    }
    if (!compactedAt) {
      compactedAt = u.at;
      compactId = u.id;
    }
  }
  if (!user) return null;
  const sum = compactId
    ? all(
        "SELECT data FROM message WHERE session_id = ? AND json_extract(data, '$.parentID') = ? ORDER BY time_created DESC, id DESC LIMIT 1",
        sessionId,
        compactId
      )
        .map(r => json(r.data))
        .find(d => d.summary === true && d.finish && d.time?.completed && d.tokens?.total > 0)
    : null;
  if (sum) compactedAt = sum.time.completed;
  const text = id =>
    all('SELECT data FROM part WHERE message_id = ? ORDER BY id', id)
      .map(p => json(p.data))
      .filter(p => p.type === 'text' && !p.synthetic && p.text);
  const steps = all(
    "SELECT id, data FROM message WHERE session_id = ? AND json_extract(data, '$.parentID') = ? ORDER BY time_created, id",
    sessionId,
    user.id
  ).map(r => ({ id: r.id, ...json(r.data) }));
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const s of steps) {
    const t = s.tokens || {};
    tokens.input += t.input || 0;
    tokens.output += (t.output || 0) + (t.reasoning || 0);
    tokens.cacheRead += t.cache?.read || 0;
    tokens.cacheWrite += t.cache?.write || 0;
  }
  const last = steps.at(-1);
  const done =
    last && last.time?.completed && last.finish && last.finish !== 'tool-calls' ? last : null;
  const failed =
    !done &&
    last &&
    !last.finish &&
    last.error &&
    typeof last.error === 'object' &&
    last.time?.completed
      ? last
      : null;
  const t = last?.tokens;
  return {
    id: user.id,
    startedAt: user.at,
    task: text(user.id)
      .map(p => p.text)
      .join('\n'),
    endedAt: done ? done.time.completed : failed ? failed.time.completed : 0,
    endedBy: done
      ? 'stop'
      : failed
        ? failed.error.name === 'MessageAbortedError'
          ? 'interrupted'
          : 'error'
        : '',
    result: done ? text(done.id).at(-1)?.text || '' : '',
    error: failed
      ? String(failed.error.data?.message || failed.error.name || '').slice(0, 200)
      : '',
    answers: steps.length,
    tokens: steps.length ? tokens : null,
    model: last?.modelID ? (last.providerID ? last.providerID + '/' : '') + last.modelID : '',
    effort: typeof last?.variant === 'string' ? last.variant : '',
    // the level the answer really ran at (its `variant`; none = the model's default)
    effortAt: last?.variant ? last.time?.created || 0 : 0,
    context: sum
      ? { tokens: sum.tokens.total, at: sum.time.completed }
      : t && !compactedAt
        ? {
            tokens: (t.input || 0) + (t.cache?.read || 0) + (t.cache?.write || 0),
            at: last.time?.created || Date.now(),
          }
        : null,
    compactedAt,
  };
}

// usage-stats.js: every assistant message changed since `since` (time_updated, so one still being
// written is read again when it grows), sub-sessions included: its tokens, cost, model, time and
// the session's folder. Numbers only, never message text. `file`: another database than the user's
// own (tests), opened for this one read. Returns null when the database cannot be read (not there,
// or an OpenCode whose tables differ).
const USAGE_SQL = `SELECT m.id AS id, m.session_id AS sessionId, m.time_created AS ts, m.time_updated AS updated, s.directory AS cwd,
  json_extract(m.data, '$.providerID') AS provider, json_extract(m.data, '$.modelID') AS model, json_extract(m.data, '$.cost') AS cost,
  json_extract(m.data, '$.tokens.input') AS input, json_extract(m.data, '$.tokens.output') AS output, json_extract(m.data, '$.tokens.reasoning') AS reasoning,
  json_extract(m.data, '$.tokens.cache.read') AS cacheRead, json_extract(m.data, '$.tokens.cache.write') AS cacheWrite
  FROM message m JOIN session s ON s.id = m.session_id WHERE m.time_updated >= ? AND json_extract(m.data, '$.role') = 'assistant'`;

function usage(since = 0, file = '') {
  let own = null;
  try {
    const d =
      file && path.resolve(file) !== path.resolve(dbFile())
        ? (own = new (require('node:sqlite').DatabaseSync)(file, { readOnly: true }))
        : open();
    return d ? d.prepare(USAGE_SQL).all(since || 0) : null;
  } catch {
    if (!own) db = null;
    return null;
  } finally {
    try {
      own?.close();
    } catch {}
  }
}

module.exports = { dataDir, dbFile, findSession, lastTurn, usage, submitted, forget };
