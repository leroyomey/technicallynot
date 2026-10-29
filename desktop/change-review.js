// Technically Not desktop · change-review.js — Keep or undo each file an agent's task changed, from
// the "Worked for" block that ends the task in the thread (src/scripts/192-change-review.js).
//
// What is recorded, per task (one task = one turn of one panel, agent-turns.js start and end):
// - A copy of a file just before the agent's first edit of it in that task. It is taken where the
//   edit waits for the app anyway: Claude Code's PreToolUse hook, OpenCode's gate, and the
//   preToolUse step Codex and Cursor Agent post (agent-hooks.js). Only the first edit of a file in
//   a task is copied; later edits in the same task change nothing here.
// - When the task starts, the folder's git HEAD and its changed files (`git status`). When it
//   ends, the same again: a file that was unchanged at the start and is changed at the end has its
//   "before" in git (HEAD at the start). That covers edits no hook saw (a shell command, a CLI
//   without hooks), but only for files that were clean before the task.
// - When the task ends, what the agent left: each file's size, change time and hash. Undo refuses
//   when the file is no longer exactly that, so edits made after the task (by the user or another
//   agent) are never lost.
//
// Undo writes only that one file, from the record's own path (never a path the window sends), and
// only after the checks above. A file the task created is removed. Records are kept 14 days, in
// Technically Not's own folder (userData/change-review), never in the project.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// How long a task's records are kept, and the most the copies may take on disk together.
const KEEP_MS = 14 * 24 * 3600e3;
const STORE_MAX = 300 * 1024 * 1024;

// A file larger than this gets no copy (Undo says why), and a diff over this is not drawn.
const FILE_MAX = 4 * 1024 * 1024;
const DIFF_MAX = 1024 * 1024;

// An edit waits at most this long for its file's copy. A copy that comes later is thrown away,
// since the edit may already have run (Undo says so).
const COPY_WAIT_MS = 1500;

// The most files one task records, and the most tasks kept.
const TASK_FILES_MAX = 300;
const TASKS_MAX = 2000;

// Windows and macOS disks ignore case by default, so two spellings are one file there.
const CASE_BLIND = process.platform === 'win32' || process.platform === 'darwin';
const fold = text => (CASE_BLIND ? String(text).toLowerCase() : String(text));
const keyOf = file => fold(path.resolve(String(file || '')));

// Tool names that change a file, written without case, spaces or underscores, across the CLIs:
// Claude Code (Edit, MultiEdit, Write, NotebookEdit), OpenCode (edit, write, patch, apply_patch),
// Codex (apply_patch) and the names Cursor Agent and others use for the same.
const EDIT_TOOLS = new Set([
  'edit',
  'multiedit',
  'write',
  'notebookedit',
  'strreplace',
  'searchreplace',
  'editfile',
  'writefile',
  'createfile',
  'create',
  'delete',
  'deletefile',
  'applypatch',
  'patch',
]);
const PATH_FIELDS = ['file_path', 'filePath', 'notebook_path', 'path', 'target_file', 'targetFile'];
const PATCH_LINE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): *(.+?)\s*$/gm;

// The files an edit tool call is about to change, made absolute from the panel's folder.
function targetsOf(tool, input, cwd) {
  const name = String(tool || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!EDIT_TOOLS.has(name) || !input || typeof input !== 'object') return [];
  const found = [];
  for (const field of PATH_FIELDS)
    if (typeof input[field] === 'string' && input[field]) found.push(input[field]);

  // A patch names its files inside its text, in whichever field the CLI puts it.
  const texts = Object.values(input).flatMap(value => (Array.isArray(value) ? value : [value]));
  for (const text of texts) {
    if (typeof text !== 'string' || !text.includes('*** ')) continue;
    for (const match of text.matchAll(PATCH_LINE)) found.push(match[1]);
  }
  const base = String(cwd || '');
  const absolute = found.map(file =>
    path.isAbsolute(file) || !base ? path.resolve(file) : path.resolve(base, file)
  );
  return [...new Map(absolute.map(file => [keyOf(file), file])).values()].slice(0, 50);
}

const hashOf = buffer => crypto.createHash('sha256').update(buffer).digest('hex');

// A file as it is now: { absent } or { size, mtime, buffer? }, read only when `read` and not too
// big.
async function look(file, read) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { absent: true };
    throw error;
  }
  if (!stat.isFile()) return { notFile: true };
  const facts = { size: stat.size, mtime: stat.mtimeMs };
  if (read && stat.size <= FILE_MAX) facts.buffer = await fs.promises.readFile(file);
  return facts;
}

// A buffer that holds a zero byte in its first 8 KB is shown as a binary file, not as text.
const isBinary = buffer => buffer.subarray(0, 8192).includes(0);

// `git status --porcelain=v1 -z`: the changed paths (relative to the repository's top), and the
// untracked folders git names as a whole ("dir/").
function parsePorcelain(out) {
  const paths = new Set();
  const folders = [];
  const parts = String(out || '').split('\0');
  for (let index = 0; index < parts.length; index++) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (file.endsWith('/')) folders.push(file);
    else paths.add(file);

    // a rename or copy names the old path next
    if (code[0] === 'R' || code[0] === 'C') paths.add(parts[++index] || '');
  }
  paths.delete('');
  return { paths, folders };
}

function createChangeReview({ dir, git, folderOf, holderOf = () => '', now = Date.now }) {
  const indexFile = path.join(dir, 'index.json');
  const blobDir = path.join(dir, 'blobs');

  // tasks: [{ id, paneId, folder, startedAt, endedAt, cut, repo: { top, head, dirty, folders },
  // files: { [key]: record } }]; reviews: { [review key]: { decision, at } }
  let data = { tasks: [], reviews: {} };

  // paneId → its running task
  const open = new Map();
  let saving = null;
  let saveAgain = false;
  let sequence = 0;

  // ------------------------------------------------------------ the record on disk
  const ready = (async () => {
    try {
      const text = await fs.promises.readFile(indexFile, 'utf8');
      const loaded = JSON.parse(text);
      if (loaded && Array.isArray(loaded.tasks)) data = { tasks: loaded.tasks, reviews: {} };
      if (loaded?.reviews && typeof loaded.reviews === 'object') data.reviews = loaded.reviews;
    } catch {}

    // A task the app closed before it ended cannot tell its own edits from later ones.
    for (const task of data.tasks)
      if (!task.endedAt) {
        task.endedAt = task.startedAt;
        task.cut = true;
      }
    await prune();
  })();

  function save() {
    if (saving) {
      saveAgain = true;
      return saving;
    }
    saving = (async () => {
      try {
        await fs.promises.mkdir(dir, { recursive: true });
        const temporary = indexFile + '.tmp';
        await fs.promises.writeFile(temporary, JSON.stringify(data));
        await fs.promises.rename(temporary, indexFile);
      } catch (error) {
        console.warn('[tnai] change review: saving failed:', error?.message || error);
      }
    })().finally(() => {
      saving = null;
      if (saveAgain) {
        saveAgain = false;
        save();
      }
    });
    return saving;
  }

  // Old tasks, old review marks and copies nothing points at any more are removed; when the copies
  // together grow over STORE_MAX, the oldest tasks go first.
  async function prune() {
    const oldest = now() - KEEP_MS;
    data.tasks = data.tasks.filter(task => (task.endedAt || now()) >= oldest).slice(-TASKS_MAX);
    for (const [key, mark] of Object.entries(data.reviews))
      if (!mark || mark.at < oldest) delete data.reviews[key];
    const sizeOf = new Map();
    for (const task of data.tasks)
      for (const record of Object.values(task.files || {}))
        if (record.before?.blob) sizeOf.set(record.before.blob, record.before.size || 0);
    let total = [...sizeOf.values()].reduce((sum, size) => sum + size, 0);
    while (total > STORE_MAX && data.tasks.length > 1) {
      const gone = data.tasks.shift();
      for (const record of Object.values(gone.files || {}))
        if (record.before?.blob && sizeOf.delete(record.before.blob))
          total -= record.before.size || 0;
    }
    const used = new Set();
    for (const task of data.tasks)
      for (const record of Object.values(task.files || {}))
        if (record.before?.blob) used.add(record.before.blob);
    let names = [];
    try {
      names = await fs.promises.readdir(blobDir);
    } catch {}
    for (const name of names)
      if (!used.has(name)) await fs.promises.rm(path.join(blobDir, name), { force: true });
  }

  async function keepCopy(buffer) {
    const blob = hashOf(buffer);
    const file = path.join(blobDir, blob);
    try {
      await fs.promises.access(file);
      return blob;
    } catch {}
    await fs.promises.mkdir(blobDir, { recursive: true });
    const temporary = file + '.' + process.pid + '.tmp';
    await fs.promises.writeFile(temporary, buffer);
    await fs.promises.rename(temporary, file);
    return blob;
  }

  const readCopy = blob => fs.promises.readFile(path.join(blobDir, blob));

  // ------------------------------------------------------------ git facts
  // { top, head, dirty: [paths], folders: [paths] } of the folder, or null when it is no
  // repository.
  async function repoFacts(folder) {
    try {
      const top = (await git(['rev-parse', '--show-toplevel'], { cwd: folder })).stdout.trim();
      if (!top) return null;
      const headOut = await git(['rev-parse', '--verify', '-q', 'HEAD'], {
        cwd: top,
        okCodes: [0, 1],
      });
      const status = await git(['status', '--porcelain=v1', '-z', '--untracked-files=normal'], {
        cwd: top,
      });
      const { paths, folders } = parsePorcelain(status.stdout);
      return { top: path.resolve(top), head: headOut.stdout.trim(), dirty: [...paths], folders };
    } catch {
      return null;
    }
  }

  // The paths among `list` that HEAD `head` has, as a Set.
  async function inTree(top, head, list) {
    if (!head || !list.length) return new Set();
    const out = await git(['ls-tree', '-r', '-z', '--name-only', head, '--', ...list], {
      cwd: top,
    });
    return new Set(out.stdout.split('\0').filter(Boolean));
  }

  // ------------------------------------------------------------ the task's life
  function startTask(paneId, startedAt) {
    const folder = String(folderOf(paneId) || '');
    const task = {
      id: startedAt.toString(36) + '-' + (++sequence).toString(36),
      paneId: String(paneId),
      folder: folder ? path.resolve(folder) : '',
      startedAt,
      endedAt: 0,
      repo: null,
      files: {},
    };
    task.repoAsked = folder ? repoFacts(folder) : Promise.resolve(null);
    task.repoAsked.then(facts => {
      task.repo = facts;
    });
    open.set(String(paneId), task);
    return task;
  }

  async function taskStarted(paneId) {
    await ready;
    const running = open.get(String(paneId));
    if (running) await taskEnded(paneId);

    // resolves once the start's git facts are in (an edit before that has its own copy)
    await startTask(paneId, now()).repoAsked;
  }

  // Before an edit tool runs: a copy of each file it names that this task has not copied yet.
  // Resolves when the copies are made, or after COPY_WAIT_MS at most.
  function beforeEdit(paneId, tool, input) {
    const targets = targetsOf(tool, input, folderOf(paneId));
    if (!targets.length) return Promise.resolve();
    const work = (async () => {
      await ready;
      const task = open.get(String(paneId)) || startTask(paneId, now());
      await Promise.all(
        targets.map(file => {
          const key = keyOf(file);
          if (task.files[key] || Object.keys(task.files).length >= TASK_FILES_MAX) return null;
          const record = { file, source: 'hook', firstAt: now(), before: { pending: true } };
          task.files[key] = record;
          record.copying = copyBefore(record);
          return record.copying;
        })
      );
    })();
    const late = new Promise(resolve => setTimeout(resolve, COPY_WAIT_MS));
    return Promise.race([work, late]).then(() => {
      // a copy still on its way when the edit goes ahead may be of the edited file
      const task = open.get(String(paneId));
      for (const file of targets) {
        const record = task?.files[keyOf(file)];
        if (record?.before?.pending) record.before = { late: true };
      }
    });
  }

  async function copyBefore(record) {
    try {
      const facts = await look(record.file, true);
      if (!record.before.pending) return;
      if (facts.absent) record.before = { absent: true };
      else if (facts.notFile) record.before = { notFile: true };
      else if (!facts.buffer) record.before = { tooBig: true, size: facts.size };
      else record.before = { blob: await keepCopy(facts.buffer), size: facts.size };
    } catch (error) {
      if (record.before.pending) record.before = { failed: String(error?.code || 'error') };
    } finally {
      delete record.copying;
    }
  }

  // The task ended: the files git shows changed since its start are added, and what the agent
  // left is noted for every file. A file left exactly as it was before is dropped.
  async function taskEnded(paneId) {
    await ready;
    const task = open.get(String(paneId));
    if (!task) return;
    open.delete(String(paneId));
    task.endedAt = now();
    await Promise.all(Object.values(task.files).map(record => record.copying));
    await task.repoAsked;
    delete task.repoAsked;
    try {
      await addFromGit(task);
    } catch {}
    for (const [key, record] of Object.entries(task.files)) {
      let facts;
      try {
        facts = await look(record.file, true);
      } catch {
        facts = null;
      }
      if (!facts || facts.notFile) {
        record.after = null;
        continue;
      }
      record.after = facts.absent
        ? { absent: true }
        : {
            size: facts.size,
            mtime: facts.mtime,
            hash: facts.buffer ? hashOf(facts.buffer) : '',
          };
      const same =
        (record.before.absent && facts.absent) ||
        (record.before.blob && record.after.hash === record.before.blob);
      if (same) delete task.files[key];
    }
    if (task.repo) task.repo = { top: task.repo.top, head: task.repo.head };
    if (Object.keys(task.files).length) data.tasks.push(task);
    await save();
  }

  // Files clean at the task's start and changed at its end, that no hook copied.
  async function addFromGit(task) {
    const start = task.repo;
    if (!start) return;
    const end = await repoFacts(start.top);
    if (!end) return;
    const dirty = new Set(start.dirty.map(fold));
    const underFolder = file => start.folders.some(folder => fold(file).startsWith(fold(folder)));
    const fresh = end.dirty.filter(file => !dirty.has(fold(file)) && !underFolder(file));
    const room = TASK_FILES_MAX - Object.keys(task.files).length;
    const list = fresh
      .filter(file => !task.files[keyOf(path.join(start.top, file))])
      .slice(0, Math.max(0, room));
    const tracked = await inTree(start.top, start.head, list);
    for (const file of list) {
      const absolute = path.join(start.top, file);
      task.files[keyOf(absolute)] = {
        file: absolute,
        source: 'git',
        firstAt: 0,
        before: tracked.has(file) ? { git: start.head, path: file } : { absent: true },
      };
    }
  }

  // ------------------------------------------------------------ the window's questions
  // The task a "Worked for" block stands for: in that folder, holding that file, and the one whose
  // end is nearest the block's time (`at`, the CLI's own record; without one, the newest).
  function findRecord(folder, name, at, ms) {
    const file = path.resolve(folder || '', String(name || ''));
    const key = keyOf(file);
    const folderKey = folder ? keyOf(folder) : '';
    let best = null;
    let bestGap = Infinity;
    const all = [...data.tasks, ...open.values()];
    for (const task of all) {
      const record = task.files[key];
      if (!record) continue;
      if (folderKey && task.folder && keyOf(task.folder) !== folderKey) continue;
      if (at && task.startedAt > at + 20000) continue;
      const end = task.endedAt || now();
      const gap = at ? Math.abs(end - at) : now() - end;
      if (at && end < at - (ms || 0) - 20000) continue;
      if (gap < bestGap) {
        best = { task, record, key };
        bestGap = gap;
      }
    }
    return best;
  }

  const recordId = (task, key) => task.id + '\n' + key;

  function byId(id) {
    const [taskId, key] = String(id || '').split('\n');
    const task =
      data.tasks.find(one => one.id === taskId) ||
      [...open.values()].find(one => one.id === taskId);
    const record = task?.files[key];
    return record ? { task, record, key } : null;
  }

  // Why this file cannot be undone ('' = it can, as far as the cheap checks see). The full check of
  // its content runs on Undo itself.
  async function undoBlock(found, cheapOnly) {
    if (!found) return 'No copy from before this task.';
    const { task, record } = found;
    const before = record.before || {};
    if (!task.endedAt) return 'The task is still running.';
    if (task.cut)
      return 'The app closed before this task ended, so its edits cannot be told apart from later ones.';
    if (before.tooBig) return 'Too large to keep a copy of (over 4 MB).';
    if (before.late) return 'Its copy was not ready before the edit ran.';
    if (before.notFile || before.failed || before.pending) return 'No copy from before this task.';
    if (!record.after) return 'What the task left could not be read.';
    if (record.after.size != null && !record.after.hash)
      return 'Too large to check for later edits (over 4 MB).';
    const decision = data.reviews[recordId(task, found.key)]?.decision;
    if (decision === 'undone') return 'Already undone.';
    if (before.blob) {
      try {
        await fs.promises.access(path.join(blobDir, before.blob));
      } catch {
        return 'Its copy is gone (copies are kept 14 days).';
      }
    }
    let facts;
    try {
      facts = await look(record.file, !cheapOnly);
    } catch {
      return 'It cannot be read now.';
    }
    const after = record.after;
    const changed = after.absent
      ? !facts.absent
      : facts.absent ||
        facts.notFile ||
        facts.size !== after.size ||
        (cheapOnly ? facts.mtime !== after.mtime : hashOf(facts.buffer || '') !== after.hash);
    if (changed)
      return 'Changed since the task ended (by you or another agent). Undo would lose those edits.';
    const holder = holderOf(record.file, task.paneId);
    if (holder) return holder + ' is editing it now.';
    return '';
  }

  // For one "Worked for" block: each shown file's record id, review mark and whether Undo can run.
  // query: { paneId, folder, at, ms, files: [names as shown] }
  async function state(query) {
    await ready;
    const folder = String(folderOf(query?.paneId) || query?.folder || '');
    const at = Number(query?.at) || 0;
    const ms = Number(query?.ms) || 0;
    const names = Array.isArray(query?.files) ? query.files.slice(0, TASK_FILES_MAX) : [];
    const out = [];
    for (const name of names) {
      const found = findRecord(folder, name, at, ms);
      const id = found ? recordId(found.task, found.key) : '';
      const reviewKey = id || 'n\n' + keyOf(path.resolve(folder, String(name))) + '\n' + at;
      const why = await undoBlock(found, true);
      out.push({
        name: String(name),
        id,
        review: reviewKey,
        decision: data.reviews[reviewKey]?.decision || '',
        canUndo: !why,
        why,
        created: !!found?.record.before?.absent,
        source: found?.record.source || '',
      });
    }
    return out;
  }

  // The file's text before the task and now, for the diff view.
  async function diff(id) {
    await ready;
    const found = byId(id);
    if (!found) return { ok: false, why: 'No copy from before this task.' };
    const { task, record } = found;
    const before = record.before || {};
    let beforeText = '';
    if (before.blob) {
      let buffer;
      try {
        buffer = await readCopy(before.blob);
      } catch {
        return { ok: false, why: 'Its copy is gone (copies are kept 14 days).' };
      }
      if (isBinary(buffer)) return { ok: false, why: 'A binary file: no line diff.' };
      if (buffer.length > DIFF_MAX) return { ok: false, why: 'Too large to show as a diff.' };
      beforeText = buffer.toString('utf8');
    } else if (before.git) {
      try {
        const shown = await git(['show', before.git + ':' + before.path], {
          cwd: task.repo?.top || path.dirname(record.file),
        });
        beforeText = shown.stdout;
      } catch {
        return { ok: false, why: 'Git no longer has the version from before this task.' };
      }
      if (beforeText.includes('\0')) return { ok: false, why: 'A binary file: no line diff.' };
      if (beforeText.length > DIFF_MAX) return { ok: false, why: 'Too large to show as a diff.' };
    } else if (!before.absent) {
      return { ok: false, why: (await undoBlock(found, true)) || 'No copy from before this task.' };
    }
    let afterText = '';
    let facts;
    try {
      facts = await look(record.file, true);
    } catch {
      return { ok: false, why: 'It cannot be read now.' };
    }
    if (!facts.absent) {
      if (!facts.buffer || facts.buffer.length > DIFF_MAX)
        return { ok: false, why: 'Too large to show as a diff.' };
      if (isBinary(facts.buffer)) return { ok: false, why: 'A binary file: no line diff.' };
      afterText = facts.buffer.toString('utf8');
    }
    return {
      ok: true,
      before: beforeText,
      after: afterText,
      created: !!before.absent,
      removed: !!facts.absent,
    };
  }

  // Keep: the file is marked as looked at and kept. Works for every shown file, with a copy or not.
  async function keep(reviewKey) {
    await ready;
    const key = String(reviewKey || '').slice(0, 2000);
    if (!key) return { ok: false, why: 'Nothing to keep.' };
    data.reviews[key] = { decision: 'kept', at: now() };
    await save();
    return { ok: true };
  }

  // Undo: the one file is put back as it was before the task, after every check.
  async function undo(id) {
    await ready;
    const found = byId(id);
    const why = await undoBlock(found, false);
    if (why) return { ok: false, why };
    const { task, record } = found;
    const before = record.before;
    try {
      if (before.absent) {
        await fs.promises.rm(record.file, { force: true });
      } else if (before.blob) {
        const buffer = await readCopy(before.blob);
        if (hashOf(buffer) !== before.blob) return { ok: false, why: 'Its copy is damaged.' };
        await fs.promises.mkdir(path.dirname(record.file), { recursive: true });
        const temporary = record.file + '.tnai-undo.tmp';
        await fs.promises.writeFile(temporary, buffer);
        await fs.promises.rename(temporary, record.file);
      } else if (before.git) {
        // git writes the file as a checkout would (line endings and filters included), and
        // only that one path, in the work tree only (the staged state is left alone)
        await git(['restore', '--source=' + before.git, '--worktree', '--', before.path], {
          cwd: task.repo.top,
          timeout: 30000,
        });
      }
    } catch (error) {
      return { ok: false, why: 'It could not be written: ' + (error?.message || error) };
    }
    data.reviews[recordId(task, found.key)] = { decision: 'undone', at: now() };
    await save();
    return { ok: true };
  }

  return { ready, taskStarted, taskEnded, beforeEdit, state, diff, keep, undo };
}

module.exports = { createChangeReview, targetsOf, parsePorcelain, FILE_MAX };
