/*
 * Technically Not desktop · watch-service.js — Watches the project folder and pushes file changes
 * to the UI in ~30 ms batches (drives live agent file activity). Dependency / cache folders (any
 * depth) and build-output folders (project top level only, so src/build/x.js still counts) are
 * skipped (IGNORED). A batch of more than BATCH_MAX paths (an install, a build) is sent compacted:
 * root-level files stay as they are, deeper paths collapse into one entry per parent folder (or per
 * top-level folder if that is still too many), each { path: <folder>, type: 'rename', at, dir:
 * true, count: <paths inside> }; the array also carries many: true and count: <total paths>. Lanes
 * (agents' own git worktrees, worktree-service.js) are watched with watchLane(): same IGNORED
 * rules, batching and compaction, sent on the same fs:changes channel, but each change in a lane
 * batch carries lane: { id, dir, branch } (on every entry: IPC drops properties set on the array
 * itself, so a lane batch is never folded-flagged either). Its paths are relative to the lane's
 * folder, never the project folder: a consumer that only handles project-folder files skips batches
 * with a lane.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Either separator: worktree-service.js tests raw fs.watch names (backslashes) with it too.
// Build-output names count only at the top level.
const IGNORED =
  /(^|[\\/])(\.git|node_modules|\.next|\.nuxt|\.cache|\.parcel-cache|\.turbo|\.vite|__pycache__|\.venv)([\\/]|$)|^(dist|dist-[^\\/]*|build|release|out|coverage)([\\/]|$)/;
const BATCH_MS = 30;
const BATCH_MAX = 200;
let watcher = null,
  send = () => {},
  retry = null,
  retries = 0,
  watchedRoot = null;
const listeners = new Set(); // main-process subscribers (agent-context.js existence cache)

// rel path -> time until which changes are Technically Not's own Save, not an agent's
const selfWrites = new Map();

// Too many paths for one message: fold them into folders (rule in the header).
function compact(changes) {
  const fold = depth => {
    const out = new Map();
    for (const c of changes) {
      const parts = c.path.split('/');
      if (parts.length === 1) {
        out.set(c.path, c);
        continue;
      }
      const dir = depth ? parts.slice(0, depth).join('/') : parts.slice(0, -1).join('/');
      const d = out.get(dir) || { path: dir, type: 'rename', at: c.at, dir: true, count: 0 };
      d.count++;
      d.at = Math.max(d.at, c.at);
      out.set(dir, d);
    }
    return [...out.values()];
  };
  let list = fold(0);
  if (list.length > BATCH_MAX) list = fold(1);
  list = list.slice(0, BATCH_MAX);
  return Object.assign(list, { many: true, count: changes.length });
}

// Collects raw watcher names into ~30 ms batches (rel path -> latest change), then hands the batch
// to deliver().
function batcher(deliver, skip = () => false) {
  const pending = new Map(); // rel path -> { path, type, at }
  let timer = null;
  const flush = () => {
    timer = null;
    const changes = [...pending.values()].filter(c => !skip(c.path));
    pending.clear();
    if (changes.length) deliver(changes.length > BATCH_MAX ? compact(changes) : changes);
  };
  return {
    // name: fs.watch's file name (relative to the watched folder); false when IGNORED.
    add(type, name) {
      if (!name) return false;
      const rel = String(name).split(path.sep).join('/');

      // Technically Not's own save-in-progress temp files (fs-service write)
      if (IGNORED.test(rel) || /\.tnai-\d+-\d+\.tmp$/.test(rel)) return false;
      const prev = pending.get(rel);
      pending.set(rel, {
        path: rel,
        type: prev?.type === 'rename' ? 'rename' : type,
        at: Date.now(),
      });
      if (!timer) timer = setTimeout(flush, BATCH_MS);
      return true;
    },
    clear() {
      clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

const project = batcher(
  batch => {
    const t = performance.now();
    for (const fn of listeners)
      try {
        fn(batch);
      } catch {}
    require('./stall-log').ran(
      'file watcher batch (' + batch.length + ' changes)',
      performance.now() - t
    ); // a stall line can name it
    send('fs:changes', batch);
  },
  rel => {
    const now = Date.now();
    for (const [p, until] of selfWrites) if (until < now) selfWrites.delete(p);
    return selfWrites.has(rel);
  }
);

// Stopping (or re-pointing at another project) drops unsent changes: their paths belong to the old
// folder.
function stop() {
  if (watcher)
    try {
      watcher.close();
    } catch {}
  watcher = null;
  project.clear();
  clearTimeout(retry);
  retry = null;
  watchedRoot = null;
  selfWrites.clear();
}

// A watcher error (folder briefly locked, handle lost) must not end live updates for good: restart
// with a short, growing backoff.
function restartLater(root) {
  if (watcher)
    try {
      watcher.close();
    } catch {}
  watcher = null;
  clearTimeout(retry);
  const delay = Math.min(30000, 500 * 2 ** Math.min(retries++, 6));
  retry = setTimeout(() => {
    retry = null;
    if (watchedRoot === root) watchOnce(root);
  }, delay);
}

function start(root) {
  stop();
  if (!root) return;
  watchedRoot = root;
  retries = 0;
  watchOnce(root);
}

function watchOnce(root) {
  try {
    // Recursive watching is native on Windows (ReadDirectoryChangesW), so events arrive within
    // milliseconds.
    watcher = fs.watch(root, { recursive: true }, (type, name) => {
      project.add(type, name);
    });
    watcher.on('error', () => restartLater(root));
    if (retries)
      setTimeout(() => {
        if (watcher && watchedRoot === root) retries = 0;
      }, 10000); // stable again: next error starts the backoff over
  } catch {
    watcher = null;
    restartLater(root);
  }
}

// A lane folder (rule in the header). onChange() runs for every change that isn't IGNORED
// (worktree-service's git:changed). Returns the fs.FSWatcher; closing it drops unsent changes.
// Throws like fs.watch; errors are the caller's (worktree-service re-watches on its next list or
// pane start).
function watchLane(dir, lane, onChange = () => {}) {
  const tag = {
    id: String(lane.id || ''),
    dir: String(lane.dir || dir),
    branch: String(lane.branch || ''),
  };
  const lanes = batcher(batch => {
    for (const c of batch) c.lane = tag;
    send('fs:changes', batch);
  });
  const w = fs.watch(dir, { recursive: true }, (type, name) => {
    if (lanes.add(type, name)) onChange();
  });
  const close = w.close.bind(w);
  w.close = () => {
    lanes.clear();
    close();
  };
  return w;
}

module.exports = {
  init(sender) {
    send = sender;
  },
  start,
  stop,
  ignore(rel, ms = 1500) {
    selfWrites.set(String(rel).split(/[\\/]/).join('/'), Date.now() + ms);
  },
  onChanges(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  watchLane,
  IGNORED,
};
