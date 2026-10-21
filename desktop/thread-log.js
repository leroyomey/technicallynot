// Technically Not desktop · thread-log.js — A session's conversation as a list of plain entries,
// for the thread layout's Readable view (src/scripts/122-thread-readable.js).
//
// One reader per tool, each in a file of its own: thread-log-claude.js, thread-log-codex.js,
// thread-log-opencode.js, thread-log-cursor.js, thread-log-copilot.js. A reader knows where that
// tool keeps a session's conversation and how it becomes entries. A tool with no reader has no
// readable thread: its thread is its terminal, and the window says so.
//
// This file is the part the readers share: reading a file of lines. This computer only: it reads
// what is already here, sends nothing anywhere and writes nothing. It runs only when the window
// asks (a thread is opened, or a push said the session changed), reads only what was added since
// the last read, and of a long conversation only its last TAIL bytes at first, so an old
// conversation of many megabytes opens as fast as a short one.
//
// The kinds of entry the window gets, each with `at` (a time in ms) when the tool recorded one:
// - you: the user's prompt (text).
// - from: a message another agent sent (who, text).
// - say: the agent's words, as markdown (text, model).
// - act: an action, as a verb and what it acts on, "Edited" and "src/app.js" (id, tool, verb,
//   what, note).
// - result: what the action with the same id gave back (id, failed, text, added, removed,
//   created).
// - ask: a question the agent asks with its own tool (id, questions).
// - worked: how long the task took (ms; 0 means finished, length not recorded).
// - note: a small fact, such as a command, an interrupt or a compact (text).
// - title: the tool's own title for the conversation (text).
// An entry may carry an id of its own (every OpenCode entry does): the window draws it once and
// updates it when it comes again.
//
// Wired in main.js as `threadLog:read`. Test: `node tools/thread-log-test.js`.
'use strict';
const fs = require('fs');

// the last part of a long conversation that is read at first
const TAIL = 2 * 1024 * 1024;

// the most that one read hands over
const STEP = 4 * 1024 * 1024;

const READERS = new Map(
  [
    require('./thread-log-claude'),
    require('./thread-log-codex'),
    require('./thread-log-opencode'),
    require('./thread-log-cursor'),
    require('./thread-log-copilot'),
  ].map(reader => [reader.agent, reader])
);

// Whether this app can read a tool's conversation as entries.
const readable = agent => READERS.has(agent);

// The file that holds a saved session's conversation (session-store.js record), or '' when the
// tool has no reader or has not written one yet.
function fileFor(record, options) {
  const reader = READERS.get(record?.agent);
  return reader?.fileFor ? reader.fileFor(record, options) : '';
}

// Reads the complete lines after byte `from` of a session's file. A first read (from < 0) of a
// long file starts TAIL bytes before its end, at the next line start, and says so with `cut`. A
// file that got shorter (a new conversation under the same name) is read again, with `reset`.
async function readFile(file, from, toEntries, { tail = TAIL, step = STEP } = {}) {
  const empty = { entries: [], next: 0, cut: false, reset: false };
  if (!file) return empty;
  let handle = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    let start = Number.isFinite(from) ? from : -1;
    let cut = false;
    let reset = false;
    if (start > size) {
      start = -1;
      reset = true;
    }
    if (start < 0) {
      start = Math.max(0, size - tail);
      cut = start > 0;
    }
    const length = Math.min(size - start, step);
    if (length <= 0) return { entries: [], next: start, cut, reset };
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    // only whole lines: the tool may be in the middle of writing the last one
    const lastBreak = buffer.lastIndexOf(10);
    if (lastBreak < 0) return { entries: [], next: start, cut, reset };

    // a read that starts in the middle of the file starts in the middle of a line: skip to the next
    const firstByte = cut ? buffer.indexOf(10) + 1 : 0;
    const text = buffer.subarray(firstByte, lastBreak).toString('utf8');
    return { entries: toEntries(text.split(/\r?\n/)), next: start + lastBreak + 1, cut, reset };
  } catch {
    return empty;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// What the window asks for: the new entries of one session since byte `from`. `record` is the
// saved session record of the panel; the file is found here, never named by the window.
async function read(record, from = -1, options) {
  const reader = READERS.get(record?.agent);
  if (!reader) return { readable: false, entries: [], next: 0, cut: false, reset: false };

  // a tool whose record is not a file of lines reads it itself (OpenCode: a database)
  if (reader.read) return { readable: true, ...(await reader.read(record, from, options)) };
  const file = reader.fileFor(record, options);

  // before the read, so nothing written between this read and the watch is missed
  follow(record, file, options);
  const part = await readFile(file, from, lines => reader.entries(lines, record, options), options);
  return { readable: true, found: !!file, ...part };
}

// ---------- a read for another computer (desktop/remote-log.js) ----------
// Never through read() above: no file is watched and no window is told, so another computer that
// opens agents cannot take this computer's own watches away. At most TAIL bytes are read. A
// helper's own record (`sub`) is never read here.
//
// Whole lines between two byte positions, each with where it starts. `before`: lines that end at
// or before it (a position that is not a line start only loses the part line). `after`: lines
// that start at or after it. Neither: the last TAIL bytes.
async function readLines(file, { before, after } = {}) {
  const none = { lines: [], next: 0, fresh: true };
  let handle = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const { size } = await handle.stat();
    let start;
    let end;
    let fresh = false;
    if (Number.isFinite(after) && after >= 0 && after <= size && size - after <= TAIL) {
      start = Math.floor(after);
      end = size;
    } else if (Number.isFinite(before) && before >= 0) {
      end = Math.min(Math.floor(before), size);
      start = Math.max(0, end - TAIL);
    } else {
      end = size;
      start = Math.max(0, size - TAIL);
      fresh = true;
    }
    const length = end - start;
    if (length <= 0) return { lines: [], next: end, fresh };
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    // A read that starts inside the file, other than at a position handed out as a line start,
    // skips to the next whole line; the last line is taken only when it is complete.
    let from = 0;
    if (start > 0 && !(Number.isFinite(after) && after === start)) {
      const previous = Buffer.alloc(1);
      await handle.read(previous, 0, 1, start - 1);
      if (previous[0] !== 10) from = buffer.indexOf(10) + 1;
      if (from <= 0 && previous[0] !== 10) return { lines: [], next: end, fresh };
    }
    const lastBreak = buffer.lastIndexOf(10);
    if (lastBreak < from) return { lines: [], next: start + from, fresh };
    const lines = [];
    let at = from;
    while (at <= lastBreak) {
      const stop = buffer.indexOf(10, at);
      const text = buffer.subarray(at, stop).toString('utf8').replace(/\r$/, '');
      lines.push({ pos: start + at, text });
      at = stop + 1;
    }
    return { lines, next: start + lastBreak + 1, fresh };
  } catch {
    return none;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// One conversation for another computer: { readable, found, entries (each with `pos`, where its
// line starts, or OpenCode's part time), more (older entries exist), next (where a later read
// goes on), fresh (this is the newest part, not a continuation) }.
// `where` (a test's home folder or database file) never carries a helper: `sub` is dropped.
async function readForPeer(record, { before, after } = {}, where = {}) {
  const reader = READERS.get(record?.agent);
  const none = { readable: false, found: false, entries: [], more: false, next: 0, fresh: true };
  if (!reader) return none;
  const { sub, ...options } = where || {};
  void sub;

  // OpenCode: its own bounded read before a time (300 parts at most)
  if (reader.readBefore)
    return { readable: true, ...(await reader.readBefore(record, before, options)) };

  // record.file: a past conversation's file as thread-list.js found it (plan item 44); otherwise
  // the reader finds it from the saved session
  const file =
    typeof record.file === 'string' && record.file ? record.file : reader.fileFor(record, options);
  if (!file) return { ...none, readable: true };
  const part = await readLines(file, { before, after });
  const entries = [];
  for (const { pos, text } of part.lines)
    for (const entry of reader.entries([text], record)) entries.push({ ...entry, pos });
  return {
    readable: true,
    found: true,
    entries,
    more: part.lines.length ? part.lines[0].pos > 0 : false,
    next: part.next,
    fresh: part.fresh,
  };
}

// ---------- telling the window that a conversation it shows has grown ----------
// The window reads a conversation when the tool reports a task's start or end. That is not
// enough: a tool can write the last lines of a task (the answer, the task's length) a moment
// after it reported the end, and then the answer stood unseen until the next prompt (found with
// a real two-second task, 2026-10-12). So a record that was read is watched, and a change is
// pushed to the window as `threadLog:changed` ({ paneId, sub }); the window reads again.
//
// Cheap and bounded: one watcher per conversation that is read (the operating system tells of a
// change; nothing is polled), at most WATCH_MAX of them, many changes in one moment are one
// push, and no timer runs while a file is still. A watch ends by itself: a push that no read
// answers within UNREAD_MS means that no window shows the conversation any more. A tool whose
// record is not a file (OpenCode: a database) is not watched; the window asks again a few times
// after a task's end instead (122).
const WATCH_MAX = 12;
const PUSH_GAP_MS = 150;
const UNREAD_MS = 8000;

// key (panel id and sub-agent) -> { file, paneId, sub, watcher, pushTimer, unreadTimer }
const watches = new Map();

// Who is told. In the app: every window. A test hands in its own (setNotify).
let notify = what => {
  let windows = [];
  try {
    windows = require('electron').BrowserWindow?.getAllWindows?.() || [];
  } catch {}
  for (const win of windows)
    if (!win.isDestroyed()) win.webContents.send('threadLog:changed', what);
};

function endWatch(key) {
  const watch = watches.get(key);
  if (!watch) return;
  watches.delete(key);
  clearTimeout(watch.pushTimer);
  clearTimeout(watch.unreadTimer);
  try {
    watch.watcher.close();
  } catch {}
}

// The file changed: one push after the writes of this moment, and a wait for the read that
// should follow it.
function fileChanged(key) {
  const watch = watches.get(key);
  if (!watch || watch.pushTimer) return;
  watch.pushTimer = setTimeout(() => {
    watch.pushTimer = 0;
    if (watches.get(key) !== watch) return;
    if (!fs.existsSync(watch.file)) {
      endWatch(key);
      return;
    }
    notify({ paneId: watch.paneId, sub: watch.sub });
    if (!watch.unreadTimer) {
      watch.unreadTimer = setTimeout(() => endWatch(key), UNREAD_MS);
      watch.unreadTimer.unref?.();
    }
  }, PUSH_GAP_MS);
  watch.pushTimer.unref?.();
}

// A read of this conversation was asked for: it is on screen, so its file is watched from now on
// (or stays watched).
function follow(record, file, options) {
  const paneId = record?.paneId ? String(record.paneId) : '';
  if (!paneId || !file) return;
  const sub = options?.sub ? String(options.sub) : '';
  const key = paneId + '\n' + sub;
  const known = watches.get(key);
  if (known && known.file === file) {
    clearTimeout(known.unreadTimer);
    known.unreadTimer = 0;

    // moved to the end: the most recently read
    watches.delete(key);
    watches.set(key, known);
    return;
  }

  // the panel holds another conversation now
  if (known) endWatch(key);

  // the conversation that was read longest ago gives its place
  if (watches.size >= WATCH_MAX) endWatch(watches.keys().next().value);
  let watcher = null;
  try {
    watcher = fs.watch(file, { persistent: false }, () => fileChanged(key));
  } catch {
    return;
  }
  watcher.on('error', () => endWatch(key));
  watches.set(key, { file, paneId, sub, watcher, pushTimer: 0, unreadTimer: 0 });
}

module.exports = {
  readable,
  fileFor,
  read,
  readFile,
  readForPeer,
  TAIL,

  // for tools/thread-log-test.js: who is told of a change, how many files are watched, and an
  // end to every watch
  setNotify(tell) {
    notify = tell;
  },
  watched: () => watches.size,
  watchedPanels: () => [...watches.values()].map(watch => watch.paneId),
  endWatches: () => [...watches.keys()].forEach(endWatch),
  UNREAD_MS,
};
