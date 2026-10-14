// Technically Not desktop · fs-service.js — Project folder access for the desktop app: native
// picker, then list/read/write/search limited to the chosen folder (or one of its Technically Not
// worktrees).
'use strict';
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { app, dialog, shell } = require('electron');

// the developer self-test switch, never on in a release build
const { selfTest } = require('./build-info');

// Several project folders can be open (listed in the switcher); only the ACTIVE one is reachable
// from the renderer. A folder joins the list only through the native picker, so the renderer can
// never point Technically Not at a folder the user did not choose. Saved as { root, projects:
// [path…] }; the old { root } file becomes a one-project list.
const statePath = () => path.join(app.getPath('userData'), 'project-folder.json');
let root = null; // the active project: the only folder the renderer may touch
let projects = []; // absolute paths of the open projects, in the order they were added
const same = (a, b) =>
  process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const isDir = async dir => {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

async function loadRoot() {
  try {
    const saved = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    projects = (Array.isArray(saved.projects) ? saved.projects : []).filter(
      p => typeof p === 'string' && p
    );
    if (typeof saved.root === 'string' && saved.root && !projects.some(p => same(p, saved.root)))
      projects.unshift(saved.root);
    if (saved.root && (await isDir(saved.root))) root = projects.find(p => same(p, saved.root));
  } catch {}
  return root;
}

async function save() {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify({ root, projects }));
}

async function listProjects() {
  return {
    active: root || '',
    projects: await Promise.all(
      projects.map(async p => ({
        path: p,
        name: path.basename(p) || p,
        active: !!root && same(p, root),
        missing: !(await isDir(p)),
      }))
    ),
  };
}

// Makes a listed project active. Unknown paths are refused: only the picker adds folders.
async function switchTo(target) {
  const found = projects.find(p => same(p, String(target || '')));
  if (!found)
    throw Object.assign(new Error('That folder is not in the project list.'), {
      code: 'SecurityError',
    });
  if (!(await isDir(found)))
    throw Object.assign(
      new Error('The folder “' + path.basename(found) + '” no longer exists on disk.'),
      { code: 'ENOENT' }
    );
  root = found;
  await save();
  return listProjects();
}

// Takes a project off the list (its files on disk are never touched). Removing the active one
// leaves no project active.
async function removeProject(target) {
  const found = projects.find(p => same(p, String(target || '')));
  if (!found) return listProjects();
  projects = projects.filter(p => p !== found);
  if (root === found) root = null;
  await save();
  return listProjects();
}

// Every renderer path is relative to the root; anything that escapes it is refused, by its text and
// by where it really is on disk (a symlink or junction inside the project, e.g. from a cloned repo
// or made by an agent, must not reach files outside it).
const outside = () =>
  Object.assign(new Error('Path is outside the project folder.'), { code: 'SecurityError' });
const within = (full, base) => {
  const f = full.toLowerCase(),
    b = base.toLowerCase();
  return f === b || f.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
};

function real(full) {
  // the nearest existing ancestor's real path + the not-yet-existing rest (a file about to be
  // written)
  let at = full,
    rest = '';
  for (;;) {
    try {
      return path.join(fsSync.realpathSync.native(at), rest);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const up = path.dirname(at);
    if (up === at) return full;
    rest = path.join(path.basename(at), rest);
    at = up;
  }
}

// `lane` (optional): the full path of one of the connected repository's Technically Not worktrees
// (worktree-service known(): its own record, still on disk, of this repo), so the file rail can
// show that worktree (09). Any other folder is refused, never opened.
function laneRoot(lane) {
  const dir = typeof lane === 'string' && path.isAbsolute(lane) ? path.resolve(lane) : '';
  if (!dir || !require('./worktree-service').known(dir))
    throw Object.assign(new Error('That folder is not one of this project’s worktrees.'), {
      code: 'SecurityError',
    });
  return dir;
}

function inside(rel, lane) {
  if (!root)
    throw Object.assign(new Error('No project folder is connected.'), { code: 'NotAllowedError' });
  const base = lane ? laneRoot(lane) : root,
    full = path.resolve(base, rel || '.');

  // separator-aware: a project at a drive root (D:\) works
  if (full !== base && !within(full, base)) throw outside();
  if (full !== base && !within(real(full), real(base))) throw outside();
  return full;
}
const errorInfo = error => ({
  name:
    error.code === 'ENOENT'
      ? 'NotFoundError'
      : error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY'
        ? 'NoModificationAllowedError'
        : error.code === 'ENOSPC'
          ? 'QuotaExceededError'
          : error.code || 'Error',
  message: error.message,
});

// Name search over the whole folder: breadth-first (shallow files first), skips heavy generated
// folders and symlinks, capped in time and hits.
const SKIP = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'bower_components',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '__pycache__',
  '.venv',
  'venv',
  '.gradle',
  '.idea',
  '.vs',
]);

// build output only at the project's top level (src/build/x.js is source)
const SKIP_TOP = new Set(['dist', 'build', 'out', 'target', 'coverage']);
const SEARCH_MS = 1500,
  SEARCH_HITS = 5000;
const READ_MAX = 64 * 1024 * 1024; // bytes per fs:read call

function score(name, rel, q) {
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (q.includes('/') && rel.includes(q)) return 40;
  if (q.length < 3) return 0;
  let at = -1,
    first = -1; // fuzzy: every query letter in order in the name; tighter spans rank higher
  for (const ch of q) {
    at = name.indexOf(ch, at + 1);
    if (at < 0) return 0;
    if (first < 0) first = at;
  }
  return 20 - Math.min(15, at - first - q.length + 1);
}

// opts.dirs: folders match by name too (composer @mentions, 50); they come back as { path, name,
// dir: true }.
async function search(query, limit, opts) {
  const dirs = !!opts?.dirs,
    base = inside('.', opts?.lane),
    q = String(query || '')
      .trim()
      .toLowerCase()
      .replace(/\\/g, '/');
  const max = Math.min(500, Math.max(1, Number(limit) || 200)),
    started = Date.now(),
    hits = [],
    queue = [''];
  let timedOut = false,
    scanned = 0;
  if (!q) return { results: [], total: 0, truncated: false, timedOut, scanned, ms: 0 };
  while (queue.length && hits.length < SEARCH_HITS) {
    if (Date.now() - started > SEARCH_MS) {
      timedOut = true;
      break;
    }
    const rel = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(rel ? path.join(base, rel) : base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || (!rel && SKIP_TOP.has(e.name))) continue;
        queue.push(r);
        const s = dirs ? score(e.name.toLowerCase(), r.toLowerCase(), q) : 0;
        if (s > 0) hits.push({ path: r, name: e.name, s, dir: true });
        continue;
      } // Dirent of a symlink is neither, so links are never followed
      if (!e.isFile()) continue;
      scanned++;
      const s = score(e.name.toLowerCase(), r.toLowerCase(), q);
      if (s > 0) hits.push({ path: r, name: e.name, s });
    }
  }
  hits.sort((a, b) => b.s - a.s || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return {
    results: hits
      .slice(0, max)
      .map(h =>
        h.dir ? { path: h.path, name: h.name, dir: true } : { path: h.path, name: h.name }
      ),
    total: hits.length,
    truncated: hits.length > max || timedOut || !!queue.length,
    timedOut,
    scanned,
    ms: Date.now() - started,
  };
}
let lastRevealed = ''; // reveal(): the folder a desktop test asked to show
let newBase = null; // create(): where new projects are made when a test moved it (newProjectBase)

// A project name becomes one folder name: no path parts, nothing Windows refuses, no leading dot,
// 60 characters at most.
function newProjectName(raw) {
  const name = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const bad = message => Object.assign(new Error(message), { code: 'EINVAL' });
  if (!name) throw bad('Give the project a name.');
  if (name.length > 60) throw bad('Use a shorter name: 60 characters at most.');
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name))
    throw bad('A project name cannot hold any of  < > : " / \\ | ? *');
  if (name.startsWith('.')) throw bad('A project name cannot start with a dot.');
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(name))
    throw bad('Windows keeps the name “' + name + '” for itself. Pick another.');
  return name;
}
const wrap =
  fn =>
  async (...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: errorInfo(error) };
    }
  };

module.exports = {
  root: () => root,
  resolve: inside, // relative path → confined absolute path (file-viewer.js)
  loadRoot,
  pick: wrap(async win => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Add project folder',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const picked = path.resolve(result.filePaths[0]);

    // picking a listed folder again just makes it active
    root = projects.find(p => same(p, picked)) || picked;
    if (!projects.includes(root)) projects.push(root);
    await save();
    return root;
  }),
  // A new project from just a name:
  // the folder is made inside one fixed place, Documents\Technically Not, only when no folder
  // of that name is there yet, and becomes the active project. The renderer sends a name, never a
  // path, so this still cannot point the app at a folder the user did not choose. Left empty: no
  // git, no files of ours.
  create: wrap(async raw => {
    const name = newProjectName(raw),
      base = newBase || path.join(app.getPath('documents'), 'Technically Not'),
      dir = path.join(base, name);
    if (!same(path.dirname(dir), base))
      throw Object.assign(new Error('That name cannot be used for a folder.'), {
        code: 'SecurityError',
      });
    await fs.mkdir(base, { recursive: true });
    try {
      await fs.mkdir(dir);
    } catch (error) {
      throw error?.code === 'EEXIST'
        ? Object.assign(
            new Error(
              '“' +
                name +
                '” already exists in ' +
                base +
                '. Pick another name, or open that folder with “Add project folder…”.'
            ),
            { code: 'EEXIST' }
          )
        : error;
    }
    root = dir;
    projects.push(dir);
    await save();
    return root;
  }),
  // "Show folder": opens a project's folder in
  // the PC's file manager. Only a folder on the project list, like switchTo, so the window cannot
  // make the app open any other path. In a desktop test nothing is opened on the user's screen: the
  // path that would open is kept for the test to read (lastRevealed).
  reveal: wrap(async target => {
    const found = projects.find(p => same(p, String(target || '')));
    if (!found)
      throw Object.assign(new Error('That folder is not in the project list.'), {
        code: 'SecurityError',
      });
    if (!(await isDir(found)))
      throw Object.assign(
        new Error('The folder “' + path.basename(found) + '” no longer exists on disk.'),
        { code: 'ENOENT' }
      );
    if (selfTest) {
      lastRevealed = found;
      return found;
    }
    const error = await shell.openPath(found);
    if (error) throw new Error(error);
    return found;
  }),
  lastRevealed: () => lastRevealed, // desktop tests only

  // Desktop tests only: honored only with TNAI_SELFTEST, callable only in the main process (not on
  // the bridge). Keeps test folders out of the user's Documents.
  newProjectBase: dir => {
    if (selfTest) newBase = dir ? path.resolve(dir) : null;
  },
  // Disconnect: takes the active project off the list.
  forget: wrap(async () => {
    if (root) await removeProject(root);
    return true;
  }),
  projects: wrap(listProjects),
  switchTo: wrap(switchTo),
  remove: wrap(removeProject),
  // lane (list/stat/read/write/search opts.lane): a worktree folder instead of the project folder
  // (laneRoot above).
  list: wrap(async (rel, lane) =>
    (await fs.readdir(inside(rel, lane), { withFileTypes: true }))
      .filter(e => e.isDirectory() || e.isFile())
      .map(e => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }))
  ),
  stat: wrap(async (rel, lane) => {
    const st = await fs.stat(inside(rel, lane));
    return { size: st.size, lastModified: Math.floor(st.mtimeMs) };
  }),
  read: wrap(async (rel, start, end, lane) => {
    const handle = await fs.open(inside(rel, lane), 'r');
    try {
      // Whole integers only, at most 64 MB per read: a huge range would allocate it all in the main
      // process, which runs every terminal.
      start = Math.max(0, Math.floor(Number(start) || 0));
      const length = Math.min(READ_MAX, Math.max(0, Math.floor(Number(end) || 0) - start)),
        buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
    } finally {
      await handle.close();
    }
  }),
  search: wrap(search),
  // Saved as a temp file next to it, then renamed over it: a crash, full disk or OneDrive lock
  // mid-save never leaves the user's file empty or half-written. A rename briefly refused by a sync
  // client or scanner (EPERM/EBUSY) is retried.
  write: wrap(async (rel, bytes, lane) => {
    // A symlinked file is saved at the file it points to (inside() checked that it is in the
    // project); renaming over the link itself would replace the link with a plain file.
    const full = real(inside(rel, lane)),
      temp = full + '.tnai-' + process.pid + '-' + Date.now() + '.tmp';
    await fs.writeFile(temp, Buffer.from(bytes));
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(temp, full);
        return true;
      } catch (error) {
        if (
          attempt < 4 &&
          (error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EACCES')
        ) {
          await new Promise(r => setTimeout(r, 60 * (attempt + 1)));
          continue;
        }
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    }
  }),
};
