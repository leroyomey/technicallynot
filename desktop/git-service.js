// Technically Not desktop · git-service.js — Git for the connected project folder: status (repo
// facts, branch, changed files) for the agent worktree actions (35), and the shared runner
// worktree-service.js and agent-context.js use. Runs `git` with execFile (no shell), cwd = the
// project folder, never prompts; pushes `git:changed` when .git/HEAD, index or refs change (also
// Technically Not worktrees' HEAD/index).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

let getRoot = () => null,
  send = () => {};
let watcher = null,
  watchedDir = null,
  timer = null;
const READ_MS = 10000,
  WRITE_MS = 30000,
  MAX_BUFFER = 8 * 1024 * 1024;

const fail = (message, code) => Object.assign(new Error(message), { code });

function root() {
  const r = getRoot();
  if (!r) throw fail('No project folder is connected.', 'NoFolder');
  return r;
}

// Runs git in the project folder. Read-only commands never take optional locks, so our own status
// never rewrites .git/index (no watcher loop).
function git(args, { timeout = READ_MS, cwd = root(), okCodes = [0], env: extra = {} } = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
      GIT_EDITOR: 'true',
      GIT_PAGER: 'cat',
      LC_ALL: 'C',
      ...extra,
    };
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=false', '-c', 'core.fsmonitor=false', ...args],
      { cwd, env, timeout, maxBuffer: MAX_BUFFER, windowsHide: true },
      (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT')
          return reject(
            fail('Git is not installed on this PC (git was not found on PATH).', 'NoGit')
          );
        if (error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
          return reject(
            fail(
              args[0] === 'status'
                ? 'Too many untracked files to list (git status output is over 8 MB). Add the generated folders to .gitignore.'
                : 'git ' + args[0] + ' output is too large to show.',
              'TooLarge'
            )
          );
        if (error && error.killed)
          return reject(fail('git ' + args[0] + ' took too long and was stopped.', 'Timeout'));
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        if (!okCodes.includes(code))
          return reject(
            fail(
              String(
                stderr || (String(stdout).length <= 2000 ? stdout : '') || error?.message || ''
              )
                .trim()
                .slice(0, 2000) || 'git ' + args[0] + ' failed.',
              'GitError'
            )
          ); // a big stdout is output, never error text
        resolve({ stdout: String(stdout), stderr: String(stderr), code });
      }
    );
  });
}

// Case-folded for path comparison where the disk ignores case (Windows, the default macOS disk);
// exact on Linux.
const fold = p =>
  process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;

// Repository facts for the connected folder: { available, repo, nested?, top?, gitDir? }.
async function probe() {
  const base = root();
  try {
    const { stdout } = await git(['rev-parse', '--show-toplevel', '--absolute-git-dir'], {
      okCodes: [0, 128],
    });
    const [top, gitDir] = stdout.split(/\r?\n/);
    if (!top) return { available: true, repo: false };
    const same = fold(path.resolve(top)) === fold(path.resolve(base));
    return {
      available: true,
      repo: same,
      nested: !same,
      top: path.resolve(top),
      gitDir: path.resolve(gitDir),
    };
  } catch (error) {
    if (error.code === 'NoGit') return { available: false, repo: false };
    throw error;
  }
}

// Watches the repository's git dir (HEAD, index, refs) and pushes `git:changed`; working-tree
// changes come from watch-service (fs:changes).
function watchGitDir(dir) {
  if (dir === watchedDir) return;
  if (watcher)
    try {
      watcher.close();
    } catch {}
  watcher = null;
  watchedDir = dir;
  if (!dir) return;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_type, name) => {
      const rel = String(name || '')
        .split(path.sep)
        .join('/');
      if (!/^(HEAD|index|packed-refs|refs\/.+|worktrees\/[^/]+\/(HEAD|index))$/.test(rel)) return;
      forgetStatus();
      clearTimeout(timer);
      timer = setTimeout(() => send('git:changed', { at: Date.now() }), 60);
    });
    watcher.on('error', () => {
      try {
        watcher.close();
      } catch {}
      watcher = null;
      watchedDir = null;
    });
  } catch {
    watcher = null;
    watchedDir = null;
  }
}

// `git status --porcelain=v2 -z` → branch, upstream, ahead/behind, and files grouped staged /
// unstaged / untracked / conflicted.
function parseStatus(out) {
  const result = {
    branch: '',
    detached: false,
    initial: false,
    upstream: '',
    ahead: 0,
    behind: 0,
    files: [],
  };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith('# ')) {
      const [key, ...rest] = entry.slice(2).split(' '),
        value = rest.join(' ');
      if (key === 'branch.head') {
        result.detached = value === '(detached)';
        result.branch = result.detached ? '' : value;
      } else if (key === 'branch.oid') result.initial = value === '(initial)';
      else if (key === 'branch.upstream') result.upstream = value;
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          result.ahead = +m[1];
          result.behind = +m[2];
        }
      }
      continue;
    }
    const type = entry[0];
    if (type === '?') {
      result.files.push({ path: entry.slice(2), x: '?', y: '?' });
      continue;
    }
    if (type === '!') continue;
    const skip = type === '1' ? 8 : type === '2' ? 9 : type === 'u' ? 10 : -1;
    if (skip < 0) continue;
    const fields = entry.split(' '),
      xy = fields[1],
      file = { path: fields.slice(skip).join(' '), x: xy[0], y: xy[1] };
    if (type === '2') file.from = parts[++i];
    if (type === 'u') file.conflict = true;
    result.files.push(file);
  }
  return result;
}

// Line counts per file from `git diff --numstat -z <args>`: { path: [added, removed] } (binary
// files: [null, null]) plus totals.
async function numstat(args, cwd) {
  const out = (
    await git(
      ['diff', '--no-ext-diff', '--no-textconv', '-M', '--numstat', '-z', ...args],
      cwd ? { cwd, okCodes: [0, 128] } : { okCodes: [0, 128] }
    )
  ).stdout.split('\0');
  const files = {};
  let added = 0,
    removed = 0;
  for (let i = 0; i < out.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(out[i]);
    if (!m) continue;
    let file = m[3];
    if (!file) {
      i++;
      file = out[++i] || '';
    } // a rename: count, count, empty path, then from and to
    const a = m[1] === '-' ? null : +m[1],
      d = m[2] === '-' ? null : +m[2];
    files[file] = [a, d];
    added += a || 0;
    removed += d || 0;
  }
  return { files, added, removed };
}

async function status() {
  const facts = await probe();
  watchGitDir(facts.repo ? facts.gitDir : null);
  if (!facts.repo) return { ...facts, root: root() };
  const { stdout } = await git([
    'status',
    '--porcelain=v2',
    '--branch',
    '-z',
    '--untracked-files=all',
  ]);
  const result = { ...facts, root: root(), ...parseStatus(stdout) };
  return result;
}

// The last status, kept until something it is made of changes: the repository's own files (the
// git dir watcher above) or a file of the project (main.js tells, `changed`). Each ask used to
// start git again, and starting a program on Windows took up to 1.4 s of the main process (stall
// log). Asks that arrive together share one run; a run that failed is not kept.
let lastStatus = null; // { root, answer: Promise }

function forgetStatus() {
  lastStatus = null;
}

function keptStatus() {
  const here = root();
  if (lastStatus && lastStatus.root === here) return lastStatus.answer;
  const kept = { root: here, answer: status() };
  lastStatus = kept;
  kept.answer.catch(() => {
    if (lastStatus === kept) lastStatus = null;
  });
  return kept.answer;
}

async function requireRepo() {
  const facts = await probe();
  if (!facts.available)
    throw fail('Git is not installed on this PC (git was not found on PATH).', 'NoGit');
  if (!facts.repo) throw fail('The project folder is not a Git repository.', 'NoRepo');
  return facts;
}
const wrap =
  fn =>
  async (...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: { code: error.code || 'Error', message: error.message } };
    }
  };

module.exports = {
  init(rootGetter, sender) {
    getRoot = rootGetter;
    send = sender;
  },
  stop() {
    watchGitDir(null);
    clearTimeout(timer);
    forgetStatus();
  },
  status: wrap(keptStatus),

  // A file of the project changed (main.js, from watch-service): the next status asks git again.
  changed: forgetStatus,
  // For worktree-service.js and agent-context.js: the same runner, folder and rules.
  // `watch` (the git dir watcher behind git:changed) is for remote-project.js, which needs a new
  // commit pushed while no page asked for status.
  internal: {
    git,
    root,
    fail,
    wrap,
    probe,
    requireRepo,
    parseStatus,
    numstat,
    WRITE_MS,
    watch: watchGitDir,
  },
};
