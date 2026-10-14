// Technically Not · remote-git.js — the git hand-over.
// A commit another computer named
// arrives here as ONE branch of this computer's own naming, `tnai/handoff/<short id>`. The relay
// carried the commit's id and nothing else; this computer gets the commit from a git remote its own
// copy already has. Never touched: the checked-out branch, the index, the working files, any other
// branch, FETCH_HEAD, tags, git's config. Pure Node: the folder and the runner are handed in, so a
// test can run this file against throwaway repositories.
// - Every command is one from the fixed list in `go` below, run without a shell in the open project
// folder, with the settings in FIXED in front. From the other computer exactly one thing reaches
// git: the commit id, 40 or 64 lower-case hex characters, as one argument that cannot be read as an
// option, a ref name or a path. The remote's name is read from this copy's own config and held to a
// strict form; the branch's name is made here from this computer's pairing record.
// - Nothing is ever asked on this computer: no sign-in window, no question in a terminal (ENV). A
// fetch that would need one fails.
// - A fetch has a time limit and a size limit; past either the whole process tree is ended and the
// pack files it left are removed.
// - The branch is written with git's compare-and-swap (`update-ref` with the old value), never with
// a force flag, never while it is checked out anywhere, and never away from a commit that nothing
// else holds.
'use strict';
const nodeFs = require('fs');
const nodePath = require('path');
const { spawn, execFile } = require('child_process');

const HEX = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/; // a commit id, SHA-1 or SHA-256

// this copy's own remote, as it may reach the command line
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const SHORT = /^[a-z0-9]{8,12}$/;
const BRANCH = 'tnai/handoff/';
const READ_MS = 10 * 1000; // a read-only step
const FETCH_MS = 60 * 1000; // one fetch
const TOTAL_MS = 120 * 1000; // all fetches of one hand-over together
const SIZE_MAX = 200 * 1024 * 1024; // the pack files one fetch may leave while it runs
const SIZE_LOOK_MS = 2000;
const EXIT_GRACE_MS = 2000,
  // how long a command waits for its output to close after git ended, and after it was stopped
  STOP_GRACE_MS = 5000;
const SWEEP_MS = 400; // between two looks at what a stopped fetch left
const REMOTES_MAX = 3; // remotes tried in turn, `origin` first (review 18, C6)

// The words a hand-over ends on. Nothing else leaves this file: never git's own text.
const WORDS = [
  'done',
  'same',
  'absent',
  'offline',
  'signin',
  'remote',
  'kept',
  'project',
  'busy',
  'large',
  'refused',
  'failed',
];

// In front of every command. hooksPath: an empty folder of the app's own, so no hook runs,
// `reference-transaction` included (tried with git 2.55 on Windows, 2026-10-10: with the setting
// the hook did not run, without it it did). The rest: no program named by a remote's address, no
// submodule, no file-system watcher, no sign-in question, no clean-up started by these commands.
const fixed = hooksDir => [
  '-c',
  'core.hooksPath=' + hooksDir,
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'submodule.recurse=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'credential.interactive=false',
  '-c',
  'core.askPass=',
  '-c',
  'gc.auto=0',
  '-c',
  'maintenance.auto=false',
  '-c',
  'core.quotepath=off',
  '-c',
  'color.ui=false',
  // What a fetch brings is always kept as one pack file, written under a `tmp_` name while it
  // arrives: only so can the size limit below see it. Without this git unpacks a fetch of fewer
  // than 100 objects into single files, however large each one is.
  '-c',
  'fetch.unpackLimit=1',
  '-c',
  'transfer.unpackLimit=1',
];

// --refmap= : this copy's own `fetch` lines are not applied (tried the same day: a line mapping a
// head onto a local branch made that branch without it and did not with it). No tag, nothing
// pruned, FETCH_HEAD left alone, no submodule, no clean-up afterwards.
const FETCH = [
  'fetch',
  '--refmap=',
  '--no-tags',
  '--no-prune',
  '--no-write-fetch-head',
  '--no-recurse-submodules',
  '--no-auto-maintenance',
];

// What git says when a remote wants a sign-in and nobody may be asked. "unable to get password from
// user" is what git 2.55 prints with the settings above (seen in tools/remote-sync-test.js against
// a server that answers 401).
const SIGN_IN =
  /authentication failed|could not read (username|password)|unable to get (password|username) from user|terminal prompts disabled|permission denied \(publickey|host key verification failed|logon failed|access denied|returned error: 40[13]|interactiv/i;

// The environment of every command: git never asks (no terminal question, no helper window, no ssh
// question), and nothing a parent process set can point it at another repository.
function gitEnv(lazy) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    SSH_ASKPASS_REQUIRE: 'never',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_EDITOR: 'true',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
  };
  for (const k of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
    'GIT_NAMESPACE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ])
    delete env[k];

  // a copy that fetches objects on demand must not go to the network for a read-only question
  if (!lazy) env.GIT_NO_LAZY_FETCH = '1';
  return env;
}

// End a process and everything it started (git's https helper, ssh): on Windows `taskkill /T`,
// elsewhere the process group.
function killTree(child) {
  if (!child || !child.pid) return;
  const self = () => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* gone */
    }
  };

  // Windows: taskkill finds the tree through the parent, so the parent is not ended first (its
  // children would be left behind); only when taskkill itself cannot be run or fails is the process
  // ended alone.
  if (process.platform === 'win32') {
    try {
      execFile(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        error => {
          if (error) self();
        }
      );
    } catch {
      self();
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    /* it ended by itself */
  }
  self();
}

// run(args, { cwd, hooksDir, timeout, lazy, look }) → Promise<{ code, stdout, stderr, timedOut,
// stopped }>. Never rejects, never a shell. look() is asked every two seconds while the command
// runs; true ends it (the size limit of a fetch).
function runGit(
  args,
  { cwd, hooksDir, timeout = READ_MS, lazy = false, look = null, lookMs = SIZE_LOOK_MS } = {}
) {
  return new Promise(resolve => {
    let child = null,
      out = '',
      err = '',
      timedOut = false,
      stopped = false,
      ended = false,
      timer = null,
      poll = null;
    const waits = [];
    const end = code => {
      if (ended) return;
      ended = true;
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
      for (const w of waits) clearTimeout(w);
      resolve({ code, stdout: out, stderr: err, timedOut, stopped });
    };
    try {
      child = spawn('git', [...fixed(hooksDir), ...args], {
        cwd,
        env: gitEnv(lazy),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch {
      return end(-1);
    }
    child.stdout.on('data', d => {
      if (out.length < 262144) out += d;
    });
    child.stderr.on('data', d => {
      if (err.length < 16384) err += d;
    });
    child.on('error', () => end(-1));
    child.on('close', code => end(typeof code === 'number' ? code : -1));

    // A program git started can outlive it and keep its output open (a helper that put itself in
    // the background, or one the tree's end did not reach): then "closed" never comes. This command
    // still ends: a moment after git itself has ended, and in any case a few seconds after it was
    // stopped. Nothing may wait for ever on what another computer asked for.
    const giveUp = (ms, code) => {
      waits.push(
        setTimeout(() => {
          try {
            child.stdout.destroy();
            child.stderr.destroy();
          } catch {
            /* closed */
          }
          end(code);
        }, ms)
      );
    };
    child.on('exit', code => giveUp(EXIT_GRACE_MS, typeof code === 'number' ? code : -1));
    const stop = () => {
      killTree(child);
      giveUp(STOP_GRACE_MS, -1);
    };
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout);
    if (typeof look === 'function')
      poll = setInterval(() => {
        let over = false;
        try {
          over = look() === true;
        } catch {
          /* not known: the time limit still holds */
        }
        if (over && !stopped) {
          stopped = true;
          stop();
        }
      }, lookMs);
  });
}

// The short id in a branch's name: that computer's device id as this computer's pairing record
// holds it, lower case, letters and digits only, the first 8. When two paired computers would get
// the same 8, both get 12. '' = no name can be made.
const plain = id =>
  String(id == null ? '' : id)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function shortId(id, all = []) {
  const p = plain(id);
  if (p.length < 8) return '';
  const others = (Array.isArray(all) ? all : []).filter(o => o !== id).map(plain);
  if (!others.some(o => o.slice(0, 8) === p.slice(0, 8))) return p.slice(0, 8);
  return p.length >= 12 && !others.some(o => o.slice(0, 12) === p.slice(0, 12))
    ? p.slice(0, 12)
    : '';
}
const branchName = short => (SHORT.test(short) ? BRANCH + short : '');

// root() → the open project folder ('' = none). hooksDir: an empty folder in the app's own data
// folder (made here when missing). limits: the fetch's own bounds, for a test that cannot wait a
// minute or fetch 200 MB; the app passes none.
function createHandoff({
  root,
  hooksDir,
  run = runGit,
  fs = nodeFs,
  path = nodePath,
  now = Date.now,
  limits = {},
}) {
  const fetchMs = limits.fetchMs > 0 ? limits.fetchMs : FETCH_MS,
    totalMs = limits.totalMs > 0 ? limits.totalMs : TOTAL_MS,
    sizeMax = limits.sizeMax > 0 ? limits.sizeMax : SIZE_MAX,
    lookMs = limits.lookMs > 0 ? limits.lookMs : SIZE_LOOK_MS;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let busy = false;
  const fold = p =>
    process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
  const same = (a, b) => !!a && !!b && fold(path.resolve(a)) === fold(path.resolve(b));

  // The hooks folder exists and is empty, or nothing runs.
  const hooksReady = () => {
    try {
      fs.mkdirSync(hooksDir, { recursive: true });
      return fs.readdirSync(hooksDir).length === 0;
    } catch {
      return false;
    }
  };
  const lines = text =>
    String(text || '')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

  // This copy's remotes that may be fetched from: a plain name, and `fetch` lines that all map into
  // its own remote-tracking refs (no mirror, nothing onto a local branch). `origin` first, three at
  // most.
  async function remotes(git) {
    const r = await git(['remote']);
    if (r.code !== 0) return [];
    const names = lines(r.stdout).filter(n => REMOTE_NAME.test(n));
    const ordered = [
        ...names.filter(n => n === 'origin'),
        ...names.filter(n => n !== 'origin'),
      ].slice(0, REMOTES_MAX),
      ok = [];
    for (const n of ordered) {
      const mirror = await git(['config', '--get', 'remote.' + n + '.mirror']);
      if (mirror.code === 0 && !['', 'false'].includes(mirror.stdout.trim().toLowerCase()))
        continue;
      const f = await git(['config', '--get-all', 'remote.' + n + '.fetch']);
      if (f.code !== 0 && f.code !== 1) continue;
      const into = 'refs/remotes/' + n + '/';
      if (
        lines(f.stdout).every(l => {
          const i = l.indexOf(':');
          return i > 0 && l.slice(i + 1).startsWith(into);
        })
      )
        ok.push(n);
    }
    return ok;
  }

  // The pack files a fetch is writing: what is in git's pack folder now and was not there before it
  // started.
  const packDir = (cwd, common) => path.resolve(cwd, common, 'objects', 'pack');
  const tmpFiles = dir => {
    try {
      return fs.readdirSync(dir).filter(n => /^tmp_/.test(n));
    } catch {
      return [];
    }
  };

  // A stopped fetch: the pack files it left go, but never another git's unfinished
  // pack. A file that appeared while this fetch ran is removed only once its size
  // has stood still between two looks, now that this fetch's processes are ended; one that still
  // grows belongs to another git of this computer and is left alone, and so is one that cannot be
  // removed (still held). At most four looks, 400 ms apart: this fetch's own processes can write
  // for an instant more.
  async function sweep(dir, fresh) {
    if (!dir) return;
    const read = () =>
      new Map(
        fresh().map(n => {
          try {
            return [n, fs.statSync(path.join(dir, n)).size];
          } catch {
            return [n, -1];
          }
        })
      );
    let was = read();
    for (let i = 0; i < 4 && was.size; i++) {
      await sleep(SWEEP_MS);
      const now = read();
      let again = false;
      for (const [n, size] of now) {
        if (size < 0) continue;
        if (was.get(n) !== size) {
          again = true;
          continue;
        } // growing, or new in this instant: looked at once more, never removed while it moves
        try {
          fs.unlinkSync(path.join(dir, n));
          now.delete(n);
        } catch {
          again = true;
        }
      }
      if (!again) return;
      was = now;
    }
  }
  const sizeOf = (dir, names) =>
    names.reduce((n, f) => {
      try {
        return n + fs.statSync(path.join(dir, f)).size;
      } catch {
        return n;
      }
    }, 0);

  async function go({ commit, short, guard }) {
    const cwd = (() => {
      try {
        return root() || '';
      } catch {
        return '';
      }
    })();
    if (!cwd || !HEX.test(commit) || !SHORT.test(short) || !hooksReady()) return 'failed';
    const ref = 'refs/heads/' + BRANCH + short;
    const git = (args, o = {}) => run(args, { cwd, hooksDir, timeout: READ_MS, ...o });
    const may = () => {
      try {
        return guard() === true;
      } catch {
        return false;
      }
    };

    // 1. The folder is its own repository. (That it is the project the other computer named is the
    // caller's check and its guard.)
    const top = await git(['rev-parse', '--show-toplevel']);
    if (top.code !== 0 || !same(lines(top.stdout)[0], cwd)) return 'project';

    // 2. The checked-out branch already holds that commit.
    if ((await git(['merge-base', '--is-ancestor', commit, 'HEAD'])).code === 0) return 'same';

    // 3. The hand-over branch as it is now.
    const was = await git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
    const old = was.code === 0 && HEX.test(lines(was.stdout)[0] || '') ? lines(was.stdout)[0] : '';
    if (was.code !== 0 && was.code !== 1) return 'failed';
    if (old === commit) return 'done';

    // 4. The commit. When it is not here yet it is fetched: by its id first, so only that commit
    // and what it needs arrive; when a remote will not hand out a commit by id, its
    // heads. Each of this copy's usable remotes in turn.
    const here = async () => (await git(['cat-file', '-e', commit + '^{commit}'])).code === 0;
    if (!(await here())) {
      const list = await remotes(git);
      if (!list.length) return 'remote';
      const cd = await git(['rev-parse', '--git-common-dir']);
      const dir = cd.code === 0 && lines(cd.stdout)[0] ? packDir(cwd, lines(cd.stdout)[0]) : '';
      const until = now() + totalMs;
      let answered = false,
        signIn = false,
        large = false,
        got = false;
      for (const remote of list) {
        for (const what of [commit, '+refs/heads/*:refs/remotes/' + remote + '/*']) {
          const left = until - now();
          if (left < 1000) break;
          if (!may()) return 'refused';
          const before = new Set(dir ? tmpFiles(dir) : []),
            fresh = () => (dir ? tmpFiles(dir).filter(n => !before.has(n)) : []);
          const r = await run([...FETCH, remote, what], {
            cwd,
            hooksDir,
            lazy: true,
            timeout: Math.min(fetchMs, left),
            lookMs,
            look: () => sizeOf(dir, fresh()) > sizeMax,
          });
          if (r.timedOut || r.stopped) await sweep(dir, fresh);
          if (r.stopped) large = true;

          // this remote was reached and listed its branches
          if (r.code === 0 && what !== commit) answered = true;
          if (r.code !== 0 && SIGN_IN.test(r.stderr)) signIn = true;
          if (await here()) {
            got = true;
            break;
          }
          if (r.stopped || r.timedOut) break; // the next remote, not this one's heads
        }
        if (got) break;
      }
      if (!got) return large ? 'large' : answered ? 'absent' : signIn ? 'signin' : 'offline';
    }

    // 5. An existing hand-over branch is moved only when it is checked out nowhere and its old
    // commit is not lost by the move.
    const checkedOut = async () => {
      const w = await git(['worktree', 'list', '--porcelain']);
      return w.code !== 0 || lines(w.stdout).includes('branch ' + ref);
    };
    if (old) {
      if (await checkedOut()) return 'kept';
      if ((await git(['merge-base', '--is-ancestor', old, commit])).code !== 0) {
        const held = await git([
          'for-each-ref',
          '--count=2',
          '--contains',
          old,
          '--format=%(refname)',
        ]);
        if (held.code !== 0 || !lines(held.stdout).some(n => n !== ref)) return 'kept';
      }
    }

    // 6. Asked again, then the write: git changes the branch only if it still is what step 3 read.
    if (!may()) return 'refused';
    const zero = '0'.repeat(commit.length);
    const put = await git(['update-ref', '-m', 'tnai handoff', ref, commit, old || zero]);
    if (put.code !== 0) return 'failed';

    // 7. A second look: checked out in that moment, a moved branch goes back. A new
    // one stays: it is where it was made.
    if (old && (await checkedOut())) {
      await git(['update-ref', '-m', 'tnai handoff taken back', ref, old, commit]);
      return 'kept';
    }
    const now2 = await git(['rev-parse', '--verify', '--quiet', ref + '^{commit}']);
    return now2.code === 0 && lines(now2.stdout)[0] === commit ? 'done' : 'failed';
  }

  return {
    // → one of WORDS. One hand-over at a time on this computer, whoever asked. guard() → true while
    // it may still be done; asked before every fetch and before the write.
    async handoff({ commit, short, guard = () => true }) {
      if (busy) return 'busy';
      busy = true;
      try {
        const w = await go({ commit: String(commit || ''), short: String(short || ''), guard });
        return WORDS.includes(w) ? w : 'failed';
      } catch {
        return 'failed';
      } finally {
        busy = false;
      }
    },
    // The short ids that have a hand-over branch in the open project now (one read-only command),
    // for the cards' line.
    async branches() {
      try {
        const cwd = root() || '';
        if (!cwd || !hooksReady()) return [];
        const r = await run(['for-each-ref', '--format=%(refname)', 'refs/heads/' + BRANCH], {
          cwd,
          hooksDir,
          timeout: READ_MS,
        });
        return r.code === 0
          ? lines(r.stdout)
              .map(n => n.slice(('refs/heads/' + BRANCH).length))
              .filter(s => SHORT.test(s))
          : [];
      } catch {
        return [];
      }
    },
    busy: () => busy,
  };
}

module.exports = {
  createHandoff,
  runGit,
  gitEnv,
  fixed,
  shortId,
  branchName,
  HEX,
  REMOTE_NAME,
  WORDS,
  BRANCH,
  FETCH_MS,
  TOTAL_MS,
  SIZE_MAX,
  REMOTES_MAX,
};
