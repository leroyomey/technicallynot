/*
 * Technically Not · desktop/workflow-runs.js — what a Claude Code workflow is doing, for its card
 * in the thread (src/scripts/171-workflow-card.js).
 *
 * A workflow writes its run into the session's folder:
 * <session id>/subagents/workflows/<run id>/journal.jsonl, one line per event ("started" with the
 * helper's agentId, label and phase; "result" with the same agentId), and each helper's own
 * conversation beside it as agent-<agentId>.jsonl. Read from a real run on 2026-10-21.
 *
 * `read(record, runId)` → { ok, helpers: [{ id, label, phase, state, startedAt, endedAt }] }
 * `watch(record, runId, onChange)` → stop(): a file watcher on the run's folder, so the card
 * changes when the journal does (pushed, not polled). At most WATCH_MAX at once.
 * Wired in main.js as `workflow:read` and `workflow:watch` / `workflow:unwatch`.
 * Test: `node tools/workflow-card-test.js`.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const RUN_ID = /^wf_[\w-]{1,80}$/;
const JOURNAL_MAX = 2 * 1024 * 1024;
const HELPERS_MAX = 200;
const WATCH_MAX = 8;
const SETTLE_MS = 250;

// The run's folder, found from the session's own record file, never from the window.
function runFolder(record, runId) {
  if (!RUN_ID.test(String(runId || ''))) return '';
  let file = '';
  try {
    file = require('./thread-log').fileFor(record) || '';
  } catch {}
  if (!file) return '';
  return path.join(file.replace(/\.jsonl$/, ''), 'subagents', 'workflows', String(runId));
}

// A helper's record grows to megabytes, so only its first and last EDGE bytes are read, off the
// main loop: the first timestamp there is its start, the last one its end.
const EDGE = 16 * 1024;

function timesIn(text) {
  const times = [];
  for (const found of String(text).matchAll(/"timestamp":"([^"]+)"/g)) {
    const at = Date.parse(found[1]);
    if (Number.isFinite(at)) times.push(at);
  }
  return times;
}

async function helperTimes(folder, id) {
  const file = path.join(folder, 'agent-' + id + '.jsonl');
  let handle = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const size = (await handle.stat()).size;
    const head = Buffer.alloc(Math.min(EDGE, size));
    await handle.read(head, 0, head.length, 0);
    const tailStart = Math.max(0, size - EDGE);
    const tail = Buffer.alloc(size - tailStart);
    await handle.read(tail, 0, tail.length, tailStart);
    const first = timesIn(head.toString('utf8'))[0];
    const last = timesIn(tail.toString('utf8')).pop();
    return first ? { first, last: last || first } : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// The pure part: journal lines in, one helper per started agent, in the order they started.
function helpersOf(lines) {
  const byId = new Map();
  for (const text of lines) {
    if (!text || text[0] !== '{') continue;
    let event = null;
    try {
      event = JSON.parse(text);
    } catch {
      continue;
    }
    const id = String(event?.agentId || '');
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
    if (event.type === 'started' && !byId.has(id) && byId.size < HELPERS_MAX)
      byId.set(id, {
        id,
        label: String(event.label || '').slice(0, 160),
        phase: String(event.phase || '').slice(0, 80),
        state: 'working',
      });
    else if (event.type === 'result' && byId.has(id)) byId.get(id).state = 'done';
  }
  return [...byId.values()];
}

// Read off the main loop: the journal (small) whole, each helper's record only at its two edges.
async function read(record, runId) {
  const folder = runFolder(record, runId);
  if (!folder) return { ok: false, error: 'no such run' };
  let text = '';
  try {
    const journal = path.join(folder, 'journal.jsonl');
    const size = (await fs.promises.stat(journal)).size;
    if (size > JOURNAL_MAX) return { ok: false, error: 'journal too large' };
    text = await fs.promises.readFile(journal, 'utf8');
  } catch {
    return { ok: true, helpers: [] };
  }
  const helpers = await Promise.all(
    helpersOf(text.split('\n')).map(async helper => {
      const times = await helperTimes(folder, helper.id);
      return {
        ...helper,
        startedAt: times?.first || 0,
        endedAt: helper.state === 'done' ? times?.last || 0 : 0,
      };
    })
  );
  return { ok: true, helpers };
}

const watchers = new Map();

// → stop(), or null when nothing is watched: a run folder that is not there (never made here:
// it is Claude Code's own record), or WATCH_MAX runs watched already. Only a change of the
// journal counts; the helpers' own records change on every line they write.
function watch(record, runId, onChange) {
  const folder = runFolder(record, runId);
  if (!folder) return null;
  if (watchers.has(folder)) return watchers.get(folder);
  if (watchers.size >= WATCH_MAX) return null;
  let timer = null;
  let watcher = null;
  try {
    if (!fs.statSync(folder).isDirectory()) return null;
    watcher = fs.watch(folder, (_event, name) => {
      if (name && String(name) !== 'journal.jsonl') return;
      clearTimeout(timer);
      timer = setTimeout(() => onChange(), SETTLE_MS);
    });
  } catch {
    return null;
  }
  const stop = () => {
    clearTimeout(timer);
    try {
      watcher.close();
    } catch {}
    watchers.delete(folder);
  };
  watchers.set(folder, stop);
  return stop;
}

module.exports = { read, watch, helpersOf, runFolder };
