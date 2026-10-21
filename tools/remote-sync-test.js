// Test of the git hand-over: node tools/remote-sync-test.js (plain Node; also run it in Electron's
// Node).
// Part 1 desktop/remote-git.js against REAL git in
// throwaway repositories in the system's temp folder (a stand-in for git would prove nothing about
// what git does): the branch made and moved, everything else byte for byte as before, what is
// refused, no question asked, the time limit ending the process tree, the size limit. Part 2
// desktop/remote-control.js: the `sync` operation's own rules, with stand-ins on a clock moved by
// hand. Part 3 desktop/remote-api.js: the message's shape. Part 4 desktop/remote-service.js: two
// services through a stand-in relay. The right cannot be given through the window's channel (its
// sentence waits for the user's yes), "Bring (name)'s work here", and the link's one budget.
// Nothing here touches the project folder or the user's git settings: git runs with an empty global
// config and no system config.
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  net = require('net'),
  crypto = require('crypto');
const { execFileSync } = require('child_process');

// The temp folder by its full name: where Windows gives a short one (RUNNER~1), git answers with
// the long one and the compare of the two fails.
const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-remote-sync-'));
fs.writeFileSync(path.join(base, 'empty-gitconfig'), '');

// Set before anything of the app is loaded: desktop/remote-git.js hands git this process's
// environment plus its own values.
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: path.join(base, 'empty-gitconfig'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
});

// Counted from outside, before the service is loaded (as tools/remote-service-test.js does): each
// service's own way out through its trust gate, so a test can send what a changed app on a paired
// computer would send, and what went over the wire.
const apiMod = require('../desktop/remote-api.js');
const seen = { sends: [], wire: [] };
{
  const realApi = apiMod.createRemoteApi;
  apiMod.createRemoteApi = o => {
    const tap = (to, obj) => {
      const went = o.send(to, obj);
      if (went === true) seen.wire.push({ to, obj: JSON.parse(JSON.stringify(obj)) });
      return went;
    };
    seen.sends.push(tap);
    return realApi({ ...o, send: tap });
  };
}
const controlMod = require('../desktop/remote-control.js');
{
  const realControl = controlMod.createControl;
  controlMod.createControl = o =>
    realControl({
      ...o,
      send: (to, obj) => {
        const went = o.send(to, obj);
        if (went === true) seen.wire.push({ to, obj: JSON.parse(JSON.stringify(obj)) });
        return went;
      },
    });
}
const {
  createHandoff,
  runGit,
  gitEnv,
  fixed,
  shortId,
  branchName,
  WORDS,
  FETCH_MS,
  TOTAL_MS,
  SIZE_MAX,
  REMOTES_MAX,
} = require('../desktop/remote-git.js');
const { createControl, shapeReply, PER_MINUTE } = controlMod,
  { shapeOp, shapeControl } = apiMod;
const { createRemoteService, registerIpc } = require('../desktop/remote-service.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- git for the test's own setup (never the code under test) ----
const TENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' };
const G = [
  '-c',
  'commit.gpgsign=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'init.defaultBranch=main',
  '-c',
  'protocol.file.allow=always',
];
const g = (cwd, ...args) =>
  execFileSync('git', [...G, ...args], {
    cwd,
    env: TENV,
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const ok = (cwd, ...args) => {
  try {
    g(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};
const dir = name => {
  const d = path.join(base, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const commit = (cwd, name, text) => {
  fs.writeFileSync(path.join(cwd, name), text === undefined ? name + '\n' : text);
  g(cwd, 'add', '--', name);
  g(cwd, 'commit', '-q', '-m', name);
  return g(cwd, 'rev-parse', 'HEAD');
};
const bare = name => {
  const d = dir(name);
  g(d, 'init', '-q', '--bare');
  return d;
};
const clone = (from, name) => {
  g(base, 'clone', '-q', from, name);
  return path.join(base, name);
};
const refOf = (cwd, ref) => {
  try {
    return g(cwd, 'rev-parse', '--verify', '--quiet', ref);
  } catch {
    return '';
  }
};
const has = (cwd, id) => ok(cwd, 'cat-file', '-e', id);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
const readOr = file => {
  try {
    return sha(fs.readFileSync(file));
  } catch {
    return null;
  }
};

// Everything a hand-over must leave as it was: the checked-out branch, the index, the working files
// (changed and untracked ones), every branch but the hand-over's own, FETCH_HEAD, the tags and
// git's config.
const SHORT = 'aaaa1111',
  REF = 'refs/heads/tnai/handoff/' + SHORT;

function snap(cwd, short = SHORT) {
  const gitDir = path.join(cwd, '.git');
  return JSON.stringify({
    head: g(cwd, 'rev-parse', 'HEAD'),
    on: g(cwd, 'symbolic-ref', 'HEAD'),
    status: g(cwd, 'status', '--porcelain=v1'),
    heads: g(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads')
      .split(/\r?\n/)
      .filter(l => !l.startsWith('refs/heads/tnai/handoff/' + short + ' '))
      .join('|'),
    tags: g(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/tags'),
    index: readOr(path.join(gitDir, 'index')),
    fetchHead: readOr(path.join(gitDir, 'FETCH_HEAD')),
    config: readOr(path.join(gitDir, 'config')),
    files: fs
      .readdirSync(cwd)
      .filter(n => n !== '.git')
      .sort()
      .map(n => {
        const p = path.join(cwd, n);
        return n + ':' + (fs.statSync(p).isFile() ? sha(fs.readFileSync(p)) : 'dir');
      })
      .join('|'),
  });
}
const remotesOf = cwd =>
  g(cwd, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes');
const HOOKS = dir('no-hooks');

// A hand-over for a folder, with every git command it runs written down. more.run: a stand-in for
// one of them.
function handoffFor(cwd, more = {}) {
  const calls = [];
  const h = createHandoff({
    root: () => cwd,
    hooksDir: more.hooksDir || HOOKS,
    limits: more.limits || {},
    run: (args, o) => {
      calls.push(args);
      return more.run ? more.run(args, o, () => runGit(args, o)) : runGit(args, o);
    },
  });
  return {
    h,
    calls,
    fetches: () => calls.filter(a => a[0] === 'fetch'),
    go: (commitId, short = SHORT, guard) =>
      h.handoff({ commit: commitId, short, ...(guard ? { guard } : {}) }),
  };
}

(async () => {
  console.log(g(base, '--version'));

  // ================= part 1: real git =================
  const REMOTE = bare('remote.git');
  const A = dir('a');
  g(A, 'init', '-q');
  g(A, 'remote', 'add', 'origin', REMOTE);
  commit(A, 'one.txt');
  g(A, 'push', '-q', 'origin', 'main');
  const B = clone(REMOTE, 'b');
  const a2 = commit(A, 'two.txt');
  g(A, 'push', '-q', 'origin', 'main');

  // a tag on the remote: a fetch here must not bring it (--no-tags)
  g(A, 'tag', 'from-a');
  g(A, 'push', '-q', 'origin', 'from-a');

  // This computer's copy is in the middle of work: a changed file, a staged one, an untracked one,
  // a branch and a tag of its own.
  commit(B, 'mine.txt');
  g(B, 'branch', 'feature');
  g(B, 'tag', 'v1');
  fs.writeFileSync(path.join(B, 'one.txt'), 'edited here, not committed\n');
  fs.writeFileSync(path.join(B, 'staged.txt'), 'staged\n');
  g(B, 'add', '--', 'staged.txt');
  fs.writeFileSync(path.join(B, 'untracked.txt'), 'untracked\n');
  fs.writeFileSync(path.join(B, '.git', 'FETCH_HEAD'), 'kept by the user\n');

  // -- the name --
  check(
    'name: the first 8 letters and digits of the id, lower case',
    shortId('AAAA-1111-2222-3333', ['AAAA-1111-2222-3333', 'bbbb-2222-0000']) === 'aaaa1111' &&
      branchName('aaaa1111') === 'tnai/handoff/aaaa1111'
  );
  check(
    'name: two paired computers with the same first 8 get 12, both of them (review 18, C5)',
    shortId('aaaa1111-2222-x', ['aaaa1111-2222-x', 'aaaa1111-3333-y']) === 'aaaa11112222' &&
      shortId('aaaa1111-3333-y', ['aaaa1111-2222-x', 'aaaa1111-3333-y']) === 'aaaa11113333'
  );
  check(
    'name: too short, or still the same at 12: no name, and no branch name for anything that is not one',
    shortId('a-1', []) === '' &&
      shortId('aaaa11112222-x', ['aaaa11112222-x', 'aaaa11112222-y']) === '' &&
      shortId(null, []) === '' &&
      branchName('../x') === '' &&
      branchName('AAAA1111') === '' &&
      branchName('') === ''
  );

  // -- the environment and the settings of every command --
  {
    process.env.GIT_DIR = 'X:/elsewhere';
    process.env.GIT_ASKPASS = 'C:/some/helper.exe';
    const read = gitEnv(false),
      fetch = gitEnv(true),
      f = fixed('H');
    delete process.env.GIT_DIR;
    delete process.env.GIT_ASKPASS;
    check(
      "no question is ever asked: no terminal prompt, no helper window, no askpass program (a parent's own is emptied), no ssh question",
      read.GIT_TERMINAL_PROMPT === '0' &&
        read.GCM_INTERACTIVE === 'Never' &&
        read.GIT_ASKPASS === '' &&
        read.SSH_ASKPASS === '' &&
        read.SSH_ASKPASS_REQUIRE === 'never' &&
        fetch.GCM_INTERACTIVE === 'Never' &&
        fetch.GIT_ASKPASS === '',
      read.GIT_ASKPASS
    );
    check(
      'a parent process cannot point git at another repository',
      !('GIT_DIR' in read) && !('GIT_DIR' in fetch)
    );
    check(
      'review 18, C7: a read-only step never fetches on demand; only the fetch may go to the network',
      read.GIT_NO_LAZY_FETCH === '1' && !('GIT_NO_LAZY_FETCH' in fetch)
    );
    const set = k => f[f.indexOf(k) - 1] === '-c' && f.includes(k);
    check(
      'the settings in front of every command: hooks folder, no ext protocol, no submodule, no sign-in question, no clean-up, a fetch kept as one pack',
      set('core.hooksPath=H') &&
        set('protocol.ext.allow=never') &&
        set('submodule.recurse=false') &&
        set('credential.interactive=false') &&
        set('core.askPass=') &&
        set('gc.auto=0') &&
        set('maintenance.auto=false') &&
        set('fetch.unpackLimit=1'),
      f
    );
    check(
      'the limits the app runs with',
      FETCH_MS === 60000 &&
        TOTAL_MS === 120000 &&
        SIZE_MAX === 200 * 1024 * 1024 &&
        REMOTES_MAX === 3
    );
  }

  // -- the branch is made, and nothing else changes --
  const before = snap(B),
    tracking = remotesOf(B);
  {
    const t = handoffFor(B),
      word = await t.go(a2);
    check(
      'made: a commit this copy lacked is fetched and one branch points at it',
      word === 'done' && refOf(B, REF) === a2,
      [word, refOf(B, REF)]
    );
    check(
      "made: the checked-out branch, the index, the working files, every other branch, the tags, FETCH_HEAD and git's config are byte for byte as before",
      snap(B) === before,
      [before, snap(B)]
    );
    check(
      'made: it was fetched by its id (review 18, C3), with the flags of C1, and that writes no remote-tracking ref either',
      t.fetches().length === 1 &&
        JSON.stringify(t.fetches()[0]) ===
          JSON.stringify([
            'fetch',
            '--refmap=',
            '--no-tags',
            '--no-prune',
            '--no-write-fetch-head',
            '--no-recurse-submodules',
            '--no-auto-maintenance',
            'origin',
            a2,
          ]) &&
        remotesOf(B) === tracking,
      t.fetches()
    );
    check(
      'made: every command is one of the fixed list',
      t.calls.every(a =>
        [
          'rev-parse',
          'merge-base',
          'cat-file',
          'remote',
          'config',
          'fetch',
          'worktree',
          'for-each-ref',
          'update-ref',
        ].includes(a[0])
      ),
      t.calls.map(a => a[0])
    );
  }
  {
    const t = handoffFor(B),
      word = await t.go(a2);
    check(
      'already there: done, and nothing is fetched or written',
      word === 'done' &&
        t.fetches().length === 0 &&
        !t.calls.some(a => a[0] === 'update-ref') &&
        snap(B) === before,
      [word, t.calls.map(a => a[0])]
    );
  }
  const a3 = commit(A, 'three.txt');
  g(A, 'push', '-q', 'origin', 'main');
  {
    const t = handoffFor(B),
      word = await t.go(a3);
    check(
      'moved: a later commit of that computer moves the same branch forward, by compare-and-swap with the old id',
      word === 'done' &&
        refOf(B, REF) === a3 &&
        snap(B) === before &&
        t.calls.some(a => a[0] === 'update-ref' && a.at(-2) === a3 && a.at(-1) === a2),
      [word, t.calls.filter(a => a[0] === 'update-ref')]
    );
  }
  {
    const mine = g(B, 'rev-parse', 'HEAD'),
      t = handoffFor(B),
      word = await t.go(mine);
    check(
      'same: a commit the checked-out branch already holds changes nothing',
      word === 'same' && t.fetches().length === 0 && refOf(B, REF) === a3 && snap(B) === before,
      word
    );
  }
  {
    const lone = g(B, 'commit-tree', '-m', 'lone', g(B, 'rev-parse', 'HEAD^{tree}')),
      t = handoffFor(B),
      word = await t.go(lone, 'cccc3333');
    check(
      'a commit that is already in this copy is not fetched: no network at all',
      word === 'done' &&
        t.fetches().length === 0 &&
        !t.calls.some(a => a[0] === 'remote') &&
        refOf(B, 'refs/heads/tnai/handoff/cccc3333') === lone,
      [word, t.calls.map(a => a[0])]
    );
    g(B, 'update-ref', '-d', 'refs/heads/tnai/handoff/cccc3333');
  }

  // -- what never reaches git --
  {
    const bad = [
      '--upload-pack=calc.exe',
      '-x',
      'HEAD',
      'main',
      'refs/heads/main',
      a3.toUpperCase(),
      a3.slice(1),
      a3 + '0',
      a3 + '\n',
      ' ' + a3,
      a3 + ' --force',
      '',
      null,
      undefined,
      42,
      'origin/main',
      '../x',
    ];
    let words = [],
      ran = 0;
    for (const c of bad) {
      const t = handoffFor(B);
      words.push(await t.h.handoff({ commit: c, short: SHORT }));
      ran += t.calls.length;
    }
    check(
      'a commit id that is not 40 or 64 lower-case hex characters, or looks like an option, a name or a path: nothing runs at all',
      words.every(w => w === 'failed') && ran === 0 && snap(B) === before && refOf(B, REF) === a3,
      [words, ran]
    );
    words = [];
    ran = 0;
    for (const s of [
      'AAAA1111',
      'aaaa111',
      'aaaa1111aaaa1',
      '../../main',
      'a b c d e f g h',
      '',
      null,
      '-aaaa111',
    ]) {
      const t = handoffFor(B);
      words.push(await t.h.handoff({ commit: a3, short: s }));
      ran += t.calls.length;
    }
    check(
      'a short id that is not 8 to 12 lower-case letters and digits: nothing runs at all',
      words.every(w => w === 'failed') && ran === 0,
      [words, ran]
    );
    const tr = remotesOf(B),
      t = handoffFor(B),
      word = await t.h.handoff({
        commit: commit(A, 'four.txt'),
        short: SHORT,
        remote: 'https://evil.example/x.git',
        refspec: '+refs/heads/*:refs/heads/*',
        cwd: 'C:/',
        branch: 'main',
      });
    check(
      "the remote is pinned by this computer alone: whatever else a caller hands over, the only remote asked is this copy's own, with the fixed refspecs",
      word === 'absent' &&
        t.fetches().length === 2 &&
        t.fetches().every(a => a.at(-2) === 'origin') &&
        t.fetches()[1].at(-1) === '+refs/heads/*:refs/remotes/origin/*' &&
        refOf(B, REF) === a3,
      [word, t.fetches()]
    );
    check(
      "the fetch of a remote's branches wrote that remote's own remote-tracking refs and nothing else",
      remotesOf(B) !== tr &&
        g(B, 'rev-parse', 'refs/remotes/origin/main') === a3 &&
        snap(B) === before
    );
  }
  const a4 = g(A, 'rev-parse', 'HEAD'); // committed on that computer, not pushed

  // -- not pushed --
  {
    const tr = remotesOf(B),
      t = handoffFor(B),
      word = await t.go(a4);
    check(
      'not pushed yet: said in a word, after the remote was asked for it by id and then for its branches; the branch stays where it was and nothing else changes',
      word === 'absent' &&
        t.fetches().length === 2 &&
        refOf(B, REF) === a3 &&
        !has(B, a4) &&
        snap(B) === before &&
        remotesOf(B) === tr,
      [word, t.fetches().length]
    );
  }
  g(A, 'push', '-q', 'origin', 'main');

  // -- a remote that does not hand out a commit by its id: the heads --
  {
    const t = handoffFor(B, {
      run: (args, o, real) =>
        args[0] === 'fetch' && args.at(-1) === a4
          ? Promise.resolve({
              code: 128,
              stdout: '',
              stderr: 'fatal: remote error: upload-pack: not our ref',
              timedOut: false,
              stopped: false,
            })
          : real(),
    });
    g(B, 'config', '--add', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/also');
    const word = await t.go(a4);
    check(
      'a remote that refuses a fetch by id: its branches are fetched instead, and the commit arrives',
      word === 'done' &&
        refOf(B, REF) === a4 &&
        t.fetches().length === 2 &&
        snap(B, SHORT).replace(/"config":"[0-9a-f]+"/, '') ===
          before.replace(/"config":"[0-9a-f]+"/, ''),
      [word, t.fetches().length]
    );
    check(
      "review 18, C1: this copy's own extra fetch line is not applied (--refmap=)",
      refOf(B, 'refs/remotes/origin/also') === ''
    );
    g(B, 'config', '--unset-all', 'remote.origin.fetch', 'also$');
  }

  // -- an existing branch is not moved while it is in use, or away from work that is nowhere else
  // --
  const a5 = commit(A, 'five.txt');
  g(A, 'push', '-q', 'origin', 'main');
  {
    const WT = path.join(base, 'wt');
    g(B, 'worktree', 'add', '-q', WT, 'tnai/handoff/' + SHORT);
    const t = handoffFor(B),
      word = await t.go(a5);
    check(
      'kept: the hand-over branch is checked out in a worktree: it is not moved',
      word === 'kept' && refOf(B, REF) === a4 && !t.calls.some(a => a[0] === 'update-ref'),
      word
    );
    g(B, 'worktree', 'remove', '--force', WT);
  }
  {
    const C = clone(REMOTE, 'c');
    g(C, 'update-ref', REF, a4);
    g(C, 'checkout', '-q', 'tnai/handoff/' + SHORT);
    const was = g(C, 'rev-parse', 'HEAD'),
      t = handoffFor(C),
      word = await t.go(a5);
    check(
      'kept: the hand-over branch is the checked-out branch of the folder: never moved',
      word === 'kept' &&
        g(C, 'rev-parse', 'HEAD') === was &&
        refOf(C, REF) === a4 &&
        !t.calls.some(a => a[0] === 'update-ref'),
      word
    );
  }
  {
    const lone = g(B, 'commit-tree', '-m', 'only here', g(B, 'rev-parse', 'HEAD^{tree}')),
      R2 = 'refs/heads/tnai/handoff/dddd4444';
    g(B, 'update-ref', R2, lone);
    let t = handoffFor(B),
      word = await t.go(a5, 'dddd4444');
    check(
      'kept: the branch holds a commit that nothing else holds and that the new one does not continue: it stays',
      word === 'kept' && refOf(B, R2) === lone && !t.calls.some(a => a[0] === 'update-ref'),
      word
    );
    g(B, 'branch', 'holds-it', lone);
    t = handoffFor(B);
    word = await t.go(a5, 'dddd4444');
    check(
      'moved: once another branch holds that commit, nothing is lost and the hand-over branch moves',
      word === 'done' && refOf(B, R2) === a5 && refOf(B, 'refs/heads/holds-it') === lone,
      word
    );
    g(B, 'branch', '-D', 'holds-it');
    g(B, 'update-ref', '-d', R2);
  }
  {
    const WT = path.join(base, 'wt2');
    let did = false;
    const t = handoffFor(B, {
      run: async (args, o, real) => {
        const r = await real();
        if (!did && args[0] === 'update-ref' && args.includes(a5)) {
          did = true;
          g(B, 'worktree', 'add', '-q', '--force', WT, 'tnai/handoff/' + SHORT);
        }
        return r;
      },
    });
    const word = await t.go(a5);
    check(
      'review 18, C4: checked out in the moment between the look and the write: the branch goes back to where it was',
      word === 'kept' &&
        did &&
        refOf(B, REF) === a4 &&
        t.calls.filter(a => a[0] === 'update-ref').length === 2 &&
        t.calls.filter(a => a[0] === 'update-ref')[1].at(-2) === a4,
      [word, refOf(B, REF) === a4]
    );
    g(B, 'worktree', 'remove', '--force', WT);
  }

  // -- the guard --
  const a6 = commit(A, 'six.txt');
  g(A, 'push', '-q', 'origin', 'main');
  {
    let t = handoffFor(B),
      word = await t.go(a6, SHORT, () => false);
    check(
      'the guard says no before the fetch: nothing is fetched',
      word === 'refused' && t.fetches().length === 0 && refOf(B, REF) === a4 && !has(B, a6),
      word
    );
    let asked = 0;
    t = handoffFor(B);
    word = await t.go(a6, SHORT, () => ++asked < 2);
    check(
      'the guard says no before the write: fetched, and the branch is not changed',
      word === 'refused' &&
        asked === 2 &&
        t.fetches().length === 1 &&
        has(B, a6) &&
        refOf(B, REF) === a4 &&
        !t.calls.some(a => a[0] === 'update-ref'),
      [word, asked]
    );
    t = handoffFor(B);
    word = await t.go(a6, SHORT, () => {
      throw new Error('no');
    });
    check('a guard that throws is a no', word === 'refused' && refOf(B, REF) === a4, word);
    t = handoffFor(B);
    word = await t.go(a6);
    check(
      '(the branch moves to it afterwards)',
      word === 'done' && refOf(B, REF) === a6 && snap(B) === before,
      word
    );
  }

  // -- one at a time, the folder, the hooks folder --
  {
    let let1;
    const wait = new Promise(r => {
      let1 = r;
    });
    const t = handoffFor(B, {
        run: async (args, o, real) => {
          await wait;
          return real();
        },
      }),
      first = t.go(a3),
      callsOfFirst = t.calls.length,
      second = await Promise.race([t.go(a3), sleep(1500).then(() => 'it ran')]);
    const ranMore = t.calls.length - callsOfFirst;
    let1();
    const one = await first;
    check(
      'one hand-over at a time on a computer: a second one meanwhile is "busy" and runs nothing',
      second === 'busy' && ranMore === 0 && WORDS.includes(one) && t.h.busy() === false,
      [second, ranMore, one]
    );
  }
  {
    const sub = dir(path.join('b', 'sub')),
      t = handoffFor(sub),
      word = await t.go(a3);
    check(
      'a folder inside a repository is not the project: nothing is fetched or written',
      word === 'project' && t.fetches().length === 0,
      word
    );
    fs.rmSync(sub, { recursive: true, force: true });
    const plainDir = dir('plain'),
      t2 = handoffFor(plainDir);
    check(
      'a folder that is no repository, and no folder at all',
      (await t2.go(a3)) === 'project' &&
        (await createHandoff({ root: () => '', hooksDir: HOOKS }).handoff({
          commit: a3,
          short: SHORT,
        })) === 'failed'
    );
  }
  {
    const full = dir('hooks-not-empty');
    fs.writeFileSync(path.join(full, 'reference-transaction'), '#!/bin/sh\nexit 1\n');
    const t = handoffFor(B, { hooksDir: full }),
      word = await t.go(a3);
    check(
      'a hooks folder that is not empty: nothing runs',
      word === 'failed' && t.calls.length === 0,
      [word, t.calls.length]
    );
    const fresh = path.join(base, 'made', 'when', 'missing'),
      t2 = handoffFor(B, { hooksDir: fresh });
    check(
      'a hooks folder that is missing is made, empty',
      (await t2.go(a6)) === 'done' && fs.readdirSync(fresh).length === 0
    );
  }
  {
    const t = handoffFor(B);
    g(B, 'update-ref', 'refs/heads/tnai/handoff/eeee5555', a3);
    g(B, 'update-ref', 'refs/heads/tnai/handoff/NotOurs', a3);
    const list = await t.h.branches();
    check(
      "the cards' line: the short ids that have a hand-over branch, read with one command",
      JSON.stringify(list.sort()) === JSON.stringify([SHORT, 'eeee5555']) &&
        t.calls.length === 1 &&
        t.calls[0][0] === 'for-each-ref',
      list
    );
    g(B, 'update-ref', '-d', 'refs/heads/tnai/handoff/eeee5555');
    g(B, 'update-ref', '-d', 'refs/heads/tnai/handoff/NotOurs');
  }

  // -- hooks never run --
  {
    const D = clone(REMOTE, 'd'),
      log = path.join(base, 'hook.log').replace(/\\/g, '/'),
      script = '#!/bin/sh\necho ran >> "' + log + '"\n';
    fs.mkdirSync(path.join(D, '.git', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(D, '.git', 'hooks', 'reference-transaction'), script, {
      mode: 0o755,
    });
    g(D, 'update-ref', 'refs/heads/control', g(D, 'rev-parse', 'HEAD'));

    // hooks run on this computer at all: only then does the absence below mean anything
    const works = fs.existsSync(log);
    try {
      fs.unlinkSync(log);
    } catch {
      /* none */
    }
    const a7 = commit(A, 'seven.txt');
    g(A, 'push', '-q', 'origin', 'main');
    const w1 = await handoffFor(D).go(a7),
      ran1 = fs.existsSync(log);
    fs.mkdirSync(path.join(D, '.githooks'));
    fs.writeFileSync(path.join(D, '.githooks', 'reference-transaction'), script, { mode: 0o755 });
    fs.writeFileSync(path.join(D, '.githooks', 'post-merge'), script, { mode: 0o755 });
    g(D, 'config', 'core.hooksPath', '.githooks');
    const a8 = commit(A, 'eight.txt');
    g(A, 'push', '-q', 'origin', 'main');
    const w2 = await handoffFor(D).go(a8),
      ran2 = fs.existsSync(log);
    if (works)
      check(
        "hooks: a hook in .git/hooks and one under a hooks folder inside the project do not run for a fetch or for the branch's write (a plain git command of the test did run it)",
        w1 === 'done' && w2 === 'done' && !ran1 && !ran2,
        [w1, w2, ran1, ran2]
      );
    else {
      check(
        'hooks: (this computer runs no git hooks at all, so only the result is checked)',
        w1 === 'done' && w2 === 'done'
      );
      console.log('NOTE hooks do not run on this computer: "no hook ran" could not be proven here');
    }
  }

  // -- which remote: this copy's own, held to a form, never one that maps onto local branches --
  {
    const E = dir('e');
    g(E, 'init', '-q');
    commit(E, 'own.txt');
    const t = handoffFor(E),
      word = await t.go(a3);
    check(
      'no remote: said in a word, nothing fetched',
      word === 'remote' && t.fetches().length === 0,
      word
    );
    g(E, 'remote', 'add', 'this-name-is-longer-than-forty-characters-in-all', REMOTE);
    const t2 = handoffFor(E);
    check(
      'a remote whose name breaks the rule is not used',
      (await t2.go(a3)) === 'remote' && t2.fetches().length === 0
    );
    g(E, 'remote', 'add', 'origin', REMOTE);
    g(E, 'config', 'remote.origin.mirror', 'true');
    const t3 = handoffFor(E);
    check(
      'review 18, C1: a mirror remote is not used',
      (await t3.go(a3)) === 'remote' && t3.fetches().length === 0
    );
    g(E, 'config', '--unset', 'remote.origin.mirror');
    g(E, 'config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*');
    const eBefore = snap(E),
      t4 = handoffFor(E),
      w4 = await t4.go(a3);
    check(
      'review 18, C1: a remote with a fetch line that maps onto local branches is not used: every local branch and FETCH_HEAD as before',
      w4 === 'remote' &&
        t4.fetches().length === 0 &&
        snap(E) === eBefore &&
        refOf(E, 'refs/heads/main') !== a3,
      w4
    );
    g(E, 'config', '--unset-all', 'remote.origin.fetch', 'refs/heads/\\*$');
    const t5 = handoffFor(E);
    check(
      '(with only its usual fetch line the same remote is used, also for a project that began elsewhere)',
      (await t5.go(a3)) === 'done' && refOf(E, REF) === a3 && g(E, 'rev-parse', 'HEAD') !== a3
    );
  }
  {
    const FORK = bare('fork.git'),
      ZETA = bare('zeta.git'),
      F = clone(REMOTE, 'f');
    g(A, 'remote', 'add', 'fork', FORK);
    g(A, 'remote', 'add', 'zeta', ZETA);
    g(A, 'push', '-q', 'fork', 'main');
    g(A, 'push', '-q', 'zeta', 'main');
    const f1 = commit(A, 'fork-only.txt');
    g(A, 'push', '-q', 'fork', 'main');

    // git lists them by name: fork, fourth, origin, third, zeta
    for (const n of ['zeta', 'fork', 'third', 'fourth'])
      g(F, 'remote', 'add', n, n === 'fork' ? FORK : n === 'zeta' ? ZETA : REMOTE);
    let t = handoffFor(F),
      word = await t.go(f1),
      asked = [...new Set(t.fetches().map(a => a.at(-2)))];
    check(
      "review 18, C6: a commit pushed to a second remote only is found: this copy's remotes in turn, origin first",
      word === 'done' && refOf(F, REF) === f1 && asked.join() === 'origin,fork',
      [word, asked]
    );
    const z1 = commit(A, 'zeta-only.txt');
    g(A, 'push', '-q', 'zeta', 'main');
    t = handoffFor(F);
    word = await t.go(z1);
    asked = [...new Set(t.fetches().map(a => a.at(-2)))];
    check(
      'review 18, C6: three remotes at most: a commit that only the fifth remote has is "not pushed", and the fourth and fifth are never asked',
      word === 'absent' && asked.join() === 'origin,fork,fourth' && refOf(F, REF) === f1,
      [word, asked]
    );
    g(A, 'push', '-q', 'origin', 'main');
  }
  {
    const H = clone(REMOTE, 'h');
    g(A, 'push', '-q', 'origin', 'main:refs/heads/gone');
    g(H, 'fetch', '-q', 'origin');
    g(A, 'push', '-q', 'origin', ':refs/heads/gone');
    g(H, 'config', 'fetch.prune', 'true');
    g(H, 'config', 'remote.origin.prune', 'true');
    const unpushed = commit(A, 'not-pushed.txt'),
      t = handoffFor(H),
      word = await t.go(unpushed);
    check(
      'review 18, C1: with pruning switched on in this copy, a fetch of the branches prunes nothing',
      word === 'absent' && t.fetches().length === 2 && refOf(H, 'refs/remotes/origin/gone') !== '',
      [word, refOf(H, 'refs/remotes/origin/gone')]
    );
    g(A, 'push', '-q', 'origin', 'main');
  }

  // -- a large branch on the remote: only the named commit's objects arrive; and the size limit --
  {
    const BIG = bare('big.git'),
      S = dir('s');
    g(S, 'init', '-q');
    g(S, 'remote', 'add', 'origin', BIG);
    const small = commit(S, 'small.txt');
    g(S, 'push', '-q', 'origin', 'main');
    g(S, 'checkout', '-q', '-b', 'big');
    fs.writeFileSync(path.join(S, 'big.bin'), crypto.randomBytes(48 * 1024 * 1024));
    g(S, 'add', '--', 'big.bin');
    g(S, 'commit', '-q', '-m', 'big');
    const bigCommit = g(S, 'rev-parse', 'HEAD'),
      bigBlob = g(S, 'rev-parse', 'HEAD:big.bin');
    g(S, 'push', '-q', 'origin', 'big');
    const T = dir('t');
    g(T, 'init', '-q');
    commit(T, 'own.txt');
    g(T, 'remote', 'add', 'origin', BIG);
    const packs = () => fs.readdirSync(path.join(T, '.git', 'objects', 'pack'));
    let t = handoffFor(T),
      word = await t.go(small);
    check(
      'review 18, C3: a very large branch on the remote: only the named commit and what it needs arrive',
      word === 'done' &&
        refOf(T, REF) === small &&
        !has(T, bigBlob) &&
        !has(T, bigCommit) &&
        t.fetches().length === 1,
      [word, has(T, bigBlob)]
    );

    // Another git of this computer fetches at the same moment: its unfinished pack keeps growing
    // while ours is stopped.
    const other = path.join(T, '.git', 'objects', 'pack', 'tmp_pack_another-git');
    let lost = false,
      writer = null;
    const tBefore = snap(T, 'ffff6666');
    t = handoffFor(T, {
      limits: { sizeMax: 1024 * 1024, lookMs: 15 },
      run: (args, o, real) => {
        if (args[0] === 'fetch' && !writer) {
          fs.writeFileSync(other, 'x');
          writer = setInterval(() => {
            if (!fs.existsSync(other)) {
              lost = true;
              clearInterval(writer);
              return;
            }
            fs.appendFileSync(other, Buffer.alloc(4096));
          }, 40);
        }
        return real();
      },
    });
    const t0 = Date.now();
    word = await t.go(bigCommit, 'ffff6666');
    clearInterval(writer);
    const otherStayed = !lost && fs.existsSync(other);
    check(
      'the size limit: a fetch that grows past it is stopped, said in a word, and the branch is not made',
      word === 'large' &&
        refOf(T, 'refs/heads/tnai/handoff/ffff6666') === '' &&
        !has(T, bigCommit) &&
        snap(T, 'ffff6666') === tBefore,
      [word, Date.now() - t0]
    );
    await sleep(300);
    check(
      'the size limit: the unfinished pack files that fetch left are removed',
      packs().filter(n => /^tmp_/.test(n) && n !== 'tmp_pack_another-git').length === 0,
      packs()
    );
    check(
      'security review 20, 3.2: an unfinished pack that another git of this computer is still writing is left alone',
      otherStayed,
      [lost, packs()]
    );
    try {
      fs.unlinkSync(other);
    } catch {
      /* gone */
    }
    check(
      'the size limit: it tried by id once and did not go on to the branches after being stopped',
      t.fetches().length === 1,
      t.fetches().length
    );
  }

  // -- a remote that needs a sign-in: it fails in a word, and nothing is asked --
  {
    const got = [],
      server = http.createServer((req, res) => {
        got.push({ url: req.url, auth: req.headers.authorization || '' });
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="test"' });
        res.end('sign in');
      });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const N = dir('n');
    g(N, 'init', '-q');
    commit(N, 'own.txt');
    g(N, 'remote', 'add', 'origin', 'http://127.0.0.1:' + server.address().port + '/private.git');
    const t = handoffFor(N),
      t0 = Date.now(),
      word = await t.go(a3),
      took = Date.now() - t0;
    check(
      'a remote that needs a sign-in, with none saved: "signin", at once (no question waits for anyone), and no name or password was ever sent',
      word === 'signin' &&
        took < 30000 &&
        got.length >= 1 &&
        got.every(x => x.auth === '') &&
        refOf(N, REF) === '',
      [word, took, got.length]
    );
    await new Promise(r => server.close(r));
  }

  // -- a remote that never answers: the time limit ends the whole process tree --
  {
    const socks = [];
    const server = net.createServer(s => {
      socks.push(s);
      s.on('error', () => {}); /* never answers */
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const Q = dir('q');
    g(Q, 'init', '-q');
    commit(Q, 'own.txt');
    g(Q, 'remote', 'add', 'origin', 'http://127.0.0.1:' + server.address().port + '/never.git');
    const t = handoffFor(Q, { limits: { fetchMs: 2500, totalMs: 6000 } }),
      t0 = Date.now(),
      word = await t.go(a3),
      took = Date.now() - t0;
    check(
      'a remote that never answers: the fetch ends at its time limit and says "offline"; it does not go on to that remote\'s branches',
      word === 'offline' &&
        took >= 2400 &&
        took < 15000 &&
        t.fetches().length === 1 &&
        refOf(Q, REF) === '',
      [word, took, t.fetches().length]
    );
    let open = -1;
    for (let i = 0; i < 50; i++) {
      open = socks.filter(s => !s.destroyed).length;
      if (socks.length && open === 0) break;
      await sleep(100);
    }
    check(
      'the time limit ends the whole process tree: the helper program git started has let go of its connection',
      socks.length >= 1 && open === 0,
      [socks.length, open]
    );
    for (const s of socks) s.destroy();
    await new Promise(r => server.close(r));
  }

  // The same with a helper program that outlives its parent: git starts this copy's own ssh
  // command, which never answers and does not notice that git is gone. Ending git alone would leave
  // it running; ending the tree does not.
  {
    const W = dir('w'),
      script = path.join(base, 'hang.js'),
      pidFile = path.join(base, 'hang.pid'),
      fwd = p => p.replace(/\\/g, '/');
    fs.writeFileSync(
      script,
      'require("fs").writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 1000);\n'
    );
    g(W, 'init', '-q');
    commit(W, 'own.txt');
    g(W, 'remote', 'add', 'origin', 'ssh://127.0.0.1/never.git');
    g(
      W,
      'config',
      'core.sshCommand',
      '"' + fwd(process.execPath) + '" "' + fwd(script) + '" "' + fwd(pidFile) + '"'
    );
    const alive = pid => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const t = handoffFor(W, { limits: { fetchMs: 3000, totalMs: 6000 } }),
      word = await t.go(a3);
    let pid = 0;
    try {
      pid = Number(fs.readFileSync(pidFile, 'utf8'));
    } catch {
      /* the helper never started */
    }
    let gone = false;
    for (let i = 0; i < 50 && pid; i++) {
      if (!alive(pid)) {
        gone = true;
        break;
      }
      await sleep(100);
    }
    check(
      'the time limit ends the whole process tree: a helper program that git started, and that would run on without it, is gone',
      word === 'offline' && pid > 0 && gone,
      [word, pid, gone]
    );
    if (pid && alive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }

  // A helper that puts a program in the background and ends: that program keeps git's output open
  // after git itself has ended, so "closed" never comes. The command must still end, or this
  // computer would answer "busy" to every hand-over until it restarts.
  {
    const O = dir('o'),
      script = path.join(base, 'orphan.js'),
      pids = path.join(base, 'orphan.pids'),
      fwd = p => p.replace(/\\/g, '/');
    fs.writeFileSync(
      script,
      'const c = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: ["ignore", "inherit", "inherit"] });\nrequire("fs").appendFileSync(process.argv[2], c.pid + "\\n"); c.unref(); process.exit(1);\n'
    );
    g(O, 'init', '-q');
    commit(O, 'own.txt');
    g(O, 'remote', 'add', 'origin', 'ssh://127.0.0.1/never.git');
    g(
      O,
      'config',
      'core.sshCommand',
      '"' + fwd(process.execPath) + '" "' + fwd(script) + '" "' + fwd(pids) + '"'
    );
    const t = handoffFor(O, { limits: { fetchMs: 3000, totalMs: 6000 } }),
      t0 = Date.now(),
      word = await Promise.race([t.go(a3), sleep(40000).then(() => 'it never ended')]),
      took = Date.now() - t0;
    let list = [];
    try {
      list = fs.readFileSync(pids, 'utf8').split('\n').map(Number).filter(Boolean);
    } catch {
      /* the helper never ran */
    }
    check(
      "a program that is outside git's process tree and keeps its output open does not hold a hand-over for ever: it ends a moment after its time limit",
      word === 'offline' && list.length >= 1 && took < 15000 && t.h.busy() === false,
      [word, took, list.length]
    );
    for (const pid of list) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
  }

  // ================= part 2: the operation's rules (remote-control.js) =================
  {
    const KEY = 'b'.repeat(40),
      COMMIT = 'c'.repeat(40),
      DAY = 24 * 60 * 60 * 1000;
    const world = () => {
      const w = {
        t: 1700000000000,
        sent: [],
        logs: [],
        syncs: [],
        rights: 'pairing-1',
        live: true,
        key: KEY,
        word: 'done',
        i: 0,
      };
      w.control = createControl({
        now: () => w.t,
        timers: { set: () => ({}), clear: () => {} },
        rights: () => w.rights,
        live: () => w.live,
        peerName: () => 'Laptop',
        openKey: () => w.key,
        send: (to, obj) => {
          w.sent.push(obj);
          return true;
        },
        log: e => w.logs.push(e),
        sync: o => {
          w.syncs.push(o);
          return typeof w.word === 'function' ? w.word(o) : w.word;
        },
      });
      w.msg = (more = {}) => ({
        t: 'sync',
        n: (++w.i).toString(16).padStart(16, '0'),
        c: w.control.stamp('peer-a'),
        ms: 0,
        project: KEY,
        commit: COMMIT,
        ...more,
      });
      w.last = () => w.sent.at(-1);
      return w;
    };
    {
      const w = world(),
        r = await w.control.receive('peer-a', w.msg());
      check(
        'sync: taken, the delivery gets the commit id and a guard, the reply is one word',
        r.taken === true &&
          r.state === 'done' &&
          w.syncs.length === 1 &&
          w.syncs[0].commit === COMMIT &&
          w.syncs[0].peerId === 'peer-a' &&
          typeof w.syncs[0].guard === 'function' &&
          JSON.stringify(Object.keys(w.syncs[0]).sort()) ===
            JSON.stringify(['commit', 'from', 'guard', 'peerId']) &&
          JSON.stringify(w.last()) ===
            JSON.stringify({ t: 'synced', n: '0000000000000001', ok: true, state: 'done' }),
        [r, w.last()]
      );
      check(
        "sync: two lines in this computer's list: asked (with the first ten characters of the id) before anything runs, and how it ended",
        w.logs.length === 2 &&
          w.logs[0].op === 'sync' &&
          w.logs[0].head === COMMIT.slice(0, 10) &&
          w.logs[0].from === 'Laptop' &&
          w.logs[1].op === 'sync_end' &&
          w.logs[1].head === 'done',
        w.logs
      );
      const guard = w.syncs[0].guard;
      const g1 = guard();
      w.key = 'd'.repeat(40);
      const g2 = guard();
      w.key = KEY;
      w.live = false;
      const g3 = guard();
      w.live = true;
      w.rights = 'pairing-2';
      const g4 = guard();
      w.rights = 'pairing-1';
      w.t += 11 * 60000;
      const g5 = guard();
      check(
        'sync: the guard is yes only while the open project, the session and the pairing are the ones it was taken under, and not for ever',
        g1 === true && g2 === false && g3 === false && g4 === false && g5 === false,
        [g1, g2, g3, g4, g5]
      );
    }
    {
      const w = world(),
        words = [];
      for (const word of [
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
        'fatal: could not read Username',
        undefined,
        { state: 'done' },
      ]) {
        w.word = word;
        w.t += DAY + 1000;
        await w.control.receive('peer-a', w.msg());
        words.push([w.last().ok, w.last().state]);
      }
      check(
        'sync: each fixed word crosses as itself, and anything else (git\'s own text, no word) as "failed"',
        JSON.stringify(words) ===
          JSON.stringify([
            [true, 'same'],
            [false, 'absent'],
            [false, 'offline'],
            [false, 'signin'],
            [false, 'remote'],
            [false, 'kept'],
            [false, 'project'],
            [false, 'busy'],
            [false, 'large'],
            [false, 'refused'],
            [false, 'failed'],
            [false, 'failed'],
            [false, 'failed'],
            [false, 'failed'],
          ]),
        words
      );
      check(
        'sync: a reply holds nothing but its type, the number, yes or no and the word',
        w.sent.every(
          m => JSON.stringify(Object.keys(m)) === JSON.stringify(['t', 'n', 'ok', 'state'])
        )
      );
      w.word = () => {
        throw new Error('boom');
      };
      w.t += DAY + 1000;
      await w.control.receive('peer-a', w.msg());
      check('sync: a delivery that throws is "failed"', w.last().state === 'failed');
    }
    {
      const w = world(),
        bad = [
          '--upload-pack=x',
          'HEAD',
          'main',
          COMMIT.toUpperCase(),
          COMMIT.slice(1),
          COMMIT + 'c',
          '',
          null,
          7,
          ['c'.repeat(40)],
          COMMIT + '\n',
        ];
      const out = [];
      for (const c of bad) {
        w.t += 40000;
        out.push(w.control.receive('peer-a', w.msg({ commit: c })));
      }
      check(
        'sync: a commit id that is not hex of the right length, or looks like an option: refused, the delivery never called, nothing written down',
        out.every(r => r.refused === true) &&
          w.syncs.length === 0 &&
          w.logs.length === 0 &&
          w.sent.every(m => m.t === 'synced' && m.ok === false && m.state === 'refused'),
        out
      );
      w.t += 40000;
      const p1 = w.control.receive('peer-a', w.msg({ project: 'd'.repeat(40) }));
      w.t += 40000;
      const p2 = w.control.receive('peer-a', w.msg({ project: 'n' + 'a'.repeat(40) }));
      w.t += 40000;
      w.key = '';
      const p3 = w.control.receive('peer-a', w.msg({ project: '' }));
      w.key = KEY;
      check(
        'sync: only for the project that is open here, named by its first commit (never the name form, never "none equals none")',
        p1.refused && p2.refused && p3.refused && w.syncs.length === 0
      );
    }
    {
      const w = world(),
        m = w.msg();
      await w.control.receive('peer-a', m);
      w.t += 40000;
      const again = w.control.receive('peer-a', { ...m, c: w.control.stamp('peer-a') });
      check(
        'sync: the same one-time number twice: refused',
        again.refused === true && w.syncs.length === 1
      );
      w.t += 40000;
      const held = w.msg();
      w.t += 61000;
      const late = w.control.receive('peer-a', held);
      check(
        'sync: a message the relay held back for more than a minute: refused',
        late.refused === true && w.syncs.length === 1
      );
      w.t += 40000;
      const noStamp = w.control.receive('peer-a', { ...w.msg(), c: 999999 });
      check(
        'sync: a message that echoes no number this computer gave: refused',
        noStamp.refused === true && w.syncs.length === 1
      );
    }
    {
      const w = world();
      check('the limit is 2 a minute', PER_MINUTE.sync === 2);
      const a = await w.control.receive('peer-a', w.msg()),
        b = await w.control.receive('peer-a', w.msg()),
        sentBefore = w.sent.length,
        c = w.control.receive('peer-a', w.msg());
      check(
        'sync: a third in a minute: silence, nothing done',
        a.taken &&
          b.taken &&
          c.silent === 'limit' &&
          w.sent.length === sentBefore &&
          w.syncs.length === 2,
        c
      );
      for (let i = 0; i < 4; i++) {
        w.t += 61000;
        await w.control.receive('peer-a', w.msg());
      }
      w.t += 61000;
      const seventh = w.control.receive('peer-a', w.msg());
      check(
        'review 18, C3: six in 24 hours for one computer; the seventh is refused and nothing runs',
        w.syncs.length === 6 && seventh.refused === true,
        [w.syncs.length, seventh]
      );
      const other = await w.control.receive('peer-b', { ...w.msg(), c: w.control.stamp('peer-b') });
      check("sync: the count is each computer's own", other.taken === true && w.syncs.length === 7);
      w.t += DAY;
      const next = await w.control.receive('peer-a', w.msg());
      check('sync: a day later it is taken again', next.taken === true && w.syncs.length === 8);
    }
    {
      const w = world();
      let done;
      w.word = () =>
        new Promise(r => {
          done = r;
        });
      const first = w.control.receive('peer-a', w.msg()),
        finish1 = done,
        second = await Promise.race([
          w.control.receive('peer-b', { ...w.msg(), c: w.control.stamp('peer-b') }),
          sleep(1000).then(() => ({ state: 'it ran' })),
        ]);
      done = finish1;
      check(
        'sync: one at a time on this computer, whoever asks: a second meanwhile hears "busy" and the delivery is not called for it',
        second.state === 'busy' &&
          w.syncs.length === 1 &&
          w.last().state === 'busy' &&
          w.logs.at(-1).op === 'sync_end' &&
          w.logs.at(-1).head === 'busy',
        second
      );
      done('done');
      const r1 = await first;
      w.t += 40000;
      w.word = 'done';
      const third = await w.control.receive('peer-b', { ...w.msg(), c: w.control.stamp('peer-b') });
      check(
        'sync: and the next one after it ended is taken',
        r1.state === 'done' && third.state === 'done' && w.syncs.length === 2
      );
    }
    {
      const w = world();
      w.rights = '';
      const off = w.control.receive('peer-a', w.msg());
      check(
        'sync: with the switch off: silence (no reply at all), nothing done',
        off.silent === 'off' && w.sent.length === 0 && w.syncs.length === 0 && w.logs.length === 0,
        off
      );
      w.rights = 'pairing-1';
      w.t += 61000;
      const noN = w.control.receive('peer-a', { ...w.msg(), n: 'not-a-number' });
      check(
        'sync: without a one-time number: silence',
        noN.silent === 'shape' && w.sent.length === 0
      );
    }
    check(
      'the reply\'s shape: the eight reason words are kept for `synced` only, and only as a "no"; for any other reply they read as "refused"',
      shapeReply({ t: 'synced', n: '0'.repeat(16), ok: false, state: 'absent' }).state ===
        'absent' &&
        shapeReply({ t: 'synced', n: '0'.repeat(16), ok: true, state: 'absent' }).state ===
          'refused' &&
        shapeReply({ t: 'synced', n: '0'.repeat(16), ok: true, state: 'absent' }).ok === false &&
        shapeReply({ t: 'acted', n: '0'.repeat(16), ok: false, state: 'absent' }).state ===
          'refused' &&
        shapeReply({ t: 'synced', n: '0'.repeat(16), ok: false, state: 'C:\\Users\\me\\secret' })
          .state === 'refused' &&
        shapeReply({ t: 'synced', n: '0'.repeat(16), ok: true, state: 'done', extra: 'x' })
          .extra === undefined
    );
  }

  // ================= part 3: the message's shape (remote-api.js) =================
  {
    const KEY = 'b'.repeat(40),
      COMMIT = 'c'.repeat(64),
      ok3 = { t: 'sync', n: 'a'.repeat(16), c: 5, ms: 12, project: KEY, commit: COMMIT };
    check(
      'shape: a sync is its type, the number, the freshness pair, the project and the commit; nothing else passes',
      JSON.stringify(
        shapeOp({ ...ok3, remote: 'evil', branch: 'main', text: 'x', to: 'f'.repeat(16), id: 'p1' })
      ) === JSON.stringify(ok3),
      shapeOp(ok3)
    );
    check(
      'shape: a commit or a project that is not hex of 40 or 64 is no message',
      [
        { commit: '--x' },
        { commit: 'HEAD' },
        { commit: COMMIT.toUpperCase() },
        { commit: COMMIT.slice(2) },
        { project: 'n' + 'a'.repeat(40) },
        { project: '' },
        { commit: undefined },
        { n: 'short' },
        { c: 0 },
        { ms: -1 },
      ].every(x => shapeOp({ ...ok3, ...x }) === null)
    );
    check(
      'shape: "takes a hand-over" in `control` is true only for a real true, and absent reads as no',
      shapeControl({ c: 3, clis: [], sync: true }).sync === true &&
        shapeControl({ c: 3, clis: [] }).sync === false &&
        shapeControl({ c: 3, clis: [], sync: 'true' }).sync === false &&
        shapeControl({ c: 3, clis: [], sync: 1 }).sync === false
    );
  }

  // ================= part 4: two services through a stand-in relay (remote-service.js)
  // =================
  {
    const w = { t: 1700000000000, timers: [], queue: [], socks: [], tickets: [], account: [] };
    w.now = () => w.t;
    w.timersApi = {
      set: (fn, ms) => {
        const h = { at: w.t + ms, fn };
        w.timers.push(h);
        return h;
      },
      clear: h => {
        const i = w.timers.indexOf(h);
        if (i >= 0) w.timers.splice(i, 1);
      },
    };
    w.settle = async () => {
      for (let i = 0; i < 400; i++) {
        for (let j = 0; j < 10; j++) await Promise.resolve();
        const next = w.queue.shift();
        if (!next) return;
        next();
      }
      throw new Error('never settles');
    };
    w.advance = async ms => {
      const end = w.t + ms;
      await w.settle();
      for (;;) {
        const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        w.timersApi.clear(due);
        w.t = Math.max(w.t, due.at);
        due.fn();
        await w.settle();
      }
      w.t = end;
    };
    const say = (sock, obj) =>
      w.queue.push(() => sock.open && sock.onmessage?.({ data: JSON.stringify({ v: 1, ...obj }) }));
    w.WebSocket = class {
      constructor(url) {
        this.device = decodeURIComponent(url.split('ticket=')[1]).split(':')[0];
        this.readyState = 0;
        this.open = false;
        w.socks.push(this);
        w.queue.push(() => {
          this.open = true;
          this.readyState = 1;
          const rest = w.socks.filter(s => s.open && s !== this);
          say(this, {
            kind: 'hello',
            device: this.device,
            online: [...new Set(rest.map(s => s.device))],
          });
          for (const o of rest) say(o, { kind: 'presence', device: this.device, online: true });
        });
      }
      send(text) {
        if (!this.open) throw new Error('closed');
        if (text === 'ping') {
          w.queue.push(() => this.open && this.onmessage?.({ data: 'pong' }));
          return;
        }
        const m = JSON.parse(text),
          target = w.socks.find(s => s.open && s.device === m.to);
        if (!target) return say(this, { kind: 'err', code: 'offline', to: m.to });
        w.queue.push(() => target.open && target.onmessage?.({ data: text }));
      }
      close() {
        if (this.open) {
          this.open = false;
          this.readyState = 3;
          for (const o of w.socks.filter(s => s.open))
            say(o, { kind: 'presence', device: this.device, online: false });
        }
      }
    };
    const computer = (id, name) => {
      const c = {
        id,
        disk: { text: null },
        project: null,
        key: '',
        rel: { rel: 'ahead', n: 1 },
        hand: { calls: [], word: 'done', list: [] },
      };
      const flip = b => Buffer.from(b.map(x => x ^ 0x5a));
      c.backend = {
        available: () => true,
        encrypt: flip,
        decrypt: flip,
        read: () => c.disk.text,
        write: s => {
          c.disk.text = s;
        },
      };
      c.svc = createRemoteService({
        self: { id },
        deviceName: () => name,
        backend: c.backend,
        url: 'ws://relay',
        WebSocket: w.WebSocket,
        now: w.now,
        timers: w.timersApi,
        random: () => 0.5,
        mono: w.now,
        getTicket: async () => {
          w.tickets.push(id);
          return id + ':' + w.tickets.length;
        },
        items: () => [],
        agents: () => [],
        devices: async () => w.account,
        project: () => c.project,
        projectKey: () => c.key,
        relate: async () => c.rel,
        handover: {
          handoff: o => {
            c.hand.calls.push(o);
            return Promise.resolve(
              typeof c.hand.word === 'function' ? c.hand.word(o) : c.hand.word
            );
          },
          branches: async () => c.hand.list,
        },
        on: { changed: () => {}, up: () => {} },
      });
      c.pc = other => c.svc.state().computers.find(x => x.id === other) || null;
      return c;
    };
    const IDA = 'aaaa1111-desk',
      IDB = 'bbbb2222-lap',
      KEY = 'b'.repeat(40),
      HEADA = '1'.repeat(40),
      HEADB = '2'.repeat(40);
    const A = computer(IDA, 'Desktop'),
      B = computer(IDB, 'Laptop');
    w.account = [
      { id: IDA, name: 'Desktop', last_seen: 1700000000 },
      { id: IDB, name: 'Laptop', last_seen: 1700000000 },
    ];
    A.svc.setOn(true);
    await w.advance(1000);
    B.svc.setOn(true);
    await w.advance(60000);
    B.svc.pairAny();
    await w.advance(50);
    A.svc.pair(IDB);
    await w.advance(50);
    B.svc.enterCode(A.svc.state().pairing?.shows);
    await w.advance(50);
    A.svc.enterCode(B.svc.state().pairing?.shows);
    await w.advance(500);
    check(
      '(two computers are paired and connected)',
      !!A.pc(IDB) && !!B.pc(IDA) && A.pc(IDB).session === true && B.pc(IDA).session === true,
      [A.pc(IDB)?.session, B.pc(IDA)?.session]
    );
    for (const c of [A, B]) {
      c.key = KEY;
    }
    A.project = { root: KEY, head: HEADA };
    B.project = { root: KEY, head: HEADB };
    A.svc.projectChanged();
    B.svc.projectChanged();
    await w.advance(8000);
    const sendA = seen.sends[0],
      toA = t => seen.wire.filter(m => m.to === IDA && m.obj.t === t),
      toB = t => seen.wire.filter(m => m.to === IDB && m.obj.t === t);
    const handlers = {};
    registerIpc(
      {
        handle: (ch, fn) => {
          handlers[ch] = fn;
        },
      },
      B.svc
    );
    const shortA = shortId(IDA, [IDA, IDB]),
      shortB = shortId(IDB, [IDA, IDB]);
    let n = 0;
    const num = () => (++n).toString(16).padStart(16, 'e');
    const stampFromB = () => toA('control').at(-1)?.obj.c;

    // -- the right cannot be given yet: its sentence waits for the user's yes --
    const tries = [
      await handlers['remote:setControl']({}, IDA, true, 'sync'),
      await handlers['remote:setControl']({}, IDA, false),
      await handlers['remote:setControl']({}, IDA, true, { sync: true }),
      await handlers['remote:setControl']({}, IDA, false),
      await handlers['remote:setControl']({}, IDA, true, 'choose'),
    ];
    await w.advance(6000);
    check(
      "the right is not grantable: whatever the window's channel is handed, full control goes on and the hand-over right stays off",
      tries.every(r => r.ok === true) && B.pc(IDA).control === true && B.pc(IDA).syncable === false,
      [tries.map(r => r.ok), B.pc(IDA).control, B.pc(IDA).syncable]
    );
    check(
      'not grantable: the other computer is not told "takes a hand-over", shows no button and sends nothing',
      toA('control').length >= 1 &&
        toA('control').every(m => !('sync' in m.obj)) &&
        A.pc(IDB).canControl === true &&
        A.pc(IDB).canSync === false &&
        A.svc.handOver(IDB).sent === 'not_sent' &&
        toB('sync').length === 0,
      [toA('control').map(m => m.obj), A.pc(IDB).canSync]
    );
    {
      const src = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'),
        svc = src('desktop/remote-service.js'),
        // the channel's handler, comments taken out, on however many lines it is written
        line = (/handle\('remote:setControl'([\s\S]*?)handle\('/.exec(svc) || ['', ''])[1]
          .replace(/\/\/.*$/gm, '')
          .replace(/\s+/g, ' '),
        // every ask of the page that names the hand-over, as one statement (up to its `;`)
        asks = (
          src('src/scripts/111-devices-page.js').match(/act\(\s*'setControl'[^;]*;/g) || []
        ).filter(a => a.includes('sync'));

      // Updated 2026-10-21 (review 23 pass): the typing word 'choose say sync type' (item 41)
      // carries the hand-over too, and a phone's question asks without it (review 23, H2).
      check(
        "grantable by its words only (read from the code): the window's channel sets the hand-over mark for exactly 'choose say sync' or 'choose say sync type', and the page asks with them only for a computer, never for a phone",
        (line.match(/sync:/g) || []).length === 1 &&
          line.includes("sync: more === 'choose say sync' || more === 'choose say sync type',") &&
          asks.length >= 1 &&
          asks.every(a =>
            /true,\s*isPhone\(pc\)\s*\?\s*'choose say'\s*:\s*'choose say sync type'\s*\)/.test(a)
          ),
        [line.trim().slice(0, 160), asks]
      );

      // what is tried for an operation: the `try` block right after the `OPS.has(obj.t)` test, up
      // to its `catch`, on however many lines it is written
      const taking = (/OPS\.has\(obj\.t\)\)\s*\{\s*try\s*\{([\s\S]*?)\}\s*catch\b/.exec(svc) || [
        '',
        '',
      ])[1];
      check(
        "the link's one budget (read from the code): `sync` is one of the operations, each is taken only after `admit`, and `synced` is counted as a reply",
        /const OPS = new Set\(\[[^\]]*'sync'[^\]]*\]\)/.test(svc) &&
          /REPLIES = new Set\(\[[^\]]*'synced'[^\]]*\]\)/.test(svc) &&
          taking.indexOf('admit(from') >= 0 &&
          taking.indexOf('admit(from') < taking.indexOf('control.receive('),
        taking.trim().slice(0, 200)
      );
    }
    {
      const before = B.svc.controlLog().length;
      sendA(IDB, { t: 'sync', n: num(), c: stampFromB(), ms: 0, project: KEY, commit: HEADA });
      await w.advance(2000);
      const reply = toA('synced').at(-1)?.obj,
        lines = B.svc
          .controlLog()
          .slice(0, B.svc.controlLog().length - before)
          .map(e => e.op + ':' + e.head);
      check(
        'not grantable: a `sync` a changed app sends anyway is refused, nothing is fetched, and this computer writes down that it was asked and that it was not done',
        B.hand.calls.length === 0 &&
          !!reply &&
          reply.ok === false &&
          reply.state === 'refused' &&
          lines.includes('sync:' + HEADA.slice(0, 10)) &&
          lines.includes('sync_end:refused'),
        [reply, lines]
      );
    }

    // -- with the mark set as the app will set it after the user's yes: the whole path --
    B.svc.setControl(IDA, false);
    B.svc.setControl(IDA, true, { sync: true });
    await w.advance(6000);
    check(
      'once the mark is set (the step that waits): this computer says it takes a hand-over, and the other one may ask',
      B.pc(IDA).syncable === true &&
        toA('control').at(-1).obj.sync === true &&
        A.pc(IDB).canSync === true,
      [B.pc(IDA).syncable, toA('control').at(-1).obj]
    );
    {
      const r = A.svc.handOver(IDB);
      await w.advance(2000);
      const m = toB('sync').at(-1)?.obj,
        call = B.hand.calls.at(-1),
        op = A.pc(IDB).ops.find(o => o.kind === 'sync');
      check(
        'hand over: one message with the project and the commit this copy is on, nothing else',
        r.sent === 'asked' &&
          !!m &&
          JSON.stringify(Object.keys(m).sort()) ===
            JSON.stringify(['c', 'commit', 'ms', 'n', 'project', 't']) &&
          m.commit === HEADA &&
          m.project === KEY,
        m
      );
      check(
        'hand over: the target fetches that commit into the branch it names itself from its pairing record; the asking computer hears one word',
        B.hand.calls.length === 1 &&
          call.commit === HEADA &&
          call.short === shortA &&
          shortA === 'aaaa1111' &&
          JSON.stringify(Object.keys(call).sort()) ===
            JSON.stringify(['commit', 'guard', 'short']) &&
          op &&
          op.state === 'done',
        [call && call.short, op]
      );
      const g1 = call.guard();
      B.key = 'd'.repeat(40);
      const g3 = call.guard();
      B.key = KEY;
      B.svc.setControl(IDA, false);
      const g4 = call.guard();
      check(
        "hand over: the guard handed to git's runner says no for another project open, and the right gone",
        g1 === true && g3 === false && g4 === false,
        [g1, g3, g4]
      );
    }
    B.svc.setControl(IDA, true);
    await w.advance(6000);
    check(
      'turned off and on again without the mark: the right is gone again (it does not outlive the press that gave it)',
      B.pc(IDA).control === true &&
        B.pc(IDA).syncable === false &&
        !('sync' in toA('control').at(-1).obj) &&
        A.pc(IDB).canSync === false
    );

    // -- the link's one budget: a sync counts as an operation of that computer --
    {
      await w.advance(61000);
      const bogus = () => ({
        t: 'prompt',
        n: num(),
        c: stampFromB(),
        ms: 0,
        id: 'p1',
        to: '0123456789abcdef',
        text: 'Hello',
      });
      const p0 = toA('prompted').length;
      sendA(IDB, bogus());
      await w.advance(1000);
      const answered = toA('prompted').length === p0 + 1;
      await w.advance(61000);
      for (let i = 0; i < 30; i++)
        sendA(IDB, { t: 'sync', n: num(), c: stampFromB(), ms: 0, project: KEY, commit: HEADA });
      await w.advance(1000);
      const p1 = toA('prompted').length;
      sendA(IDB, bogus());
      await w.advance(1000);
      check(
        "the link budget: thirty `sync` messages in a minute use up that computer's operations for the minute (each asked `admit` first), so its next operation gets no reply; in a fresh minute it does",
        answered && toA('prompted').length === p1,
        [answered, toA('prompted').length - p1]
      );
      await w.advance(61000);
      sendA(IDB, bogus());
      await w.advance(1000);
      check('(a minute later that computer is answered again)', toA('prompted').length === p1 + 1);
    }

    // -- "Bring (name)'s work here": this computer's own press --
    await w.advance(61000);
    {
      const wire0 = seen.wire.length;
      check(
        "bring: offered where the other computer's commit is known and it has this project",
        A.pc(IDB).bringable === true && !!A.pc(IDB).project,
        A.pc(IDB)
      );
      let finish;
      A.hand.word = () =>
        new Promise(r => {
          finish = r;
        });
      const r1 = A.svc.bring(IDB),
        r2 = A.svc.bring(IDB);
      await w.advance(50);
      const call = A.hand.calls.at(-1);
      check(
        'bring: this computer fetches the commit the other one says it is on, into the branch named after that computer; a second press meanwhile does nothing',
        r1.sent === 'going' &&
          r2.sent === 'not_sent' &&
          A.hand.calls.length === 1 &&
          call.commit === HEADB &&
          call.short === shortB &&
          shortB === 'bbbb2222' &&
          A.pc(IDB).brought.state === 'going',
        [r1.sent, r2.sent, call && call.short]
      );
      const g1 = call.guard();
      A.project = { root: 'd'.repeat(40), head: HEADA };
      const g3 = call.guard();
      A.project = { root: KEY, head: HEADA };
      check(
        'bring: its guard says no when another project was opened meanwhile',
        g1 === true && g3 === false,
        [g1, g3]
      );
      A.hand.list = [shortB];
      finish('done');
      await w.advance(200);
      check(
        'bring: how it ended is one word on the card, and the card names the branch while it exists',
        A.pc(IDB).brought.state === 'done' && A.pc(IDB).handed === 'tnai/handoff/bbbb2222',
        [A.pc(IDB).brought, A.pc(IDB).handed]
      );
      check(
        'bring: no message was sent for it, and no right was needed (full control of this computer is off for that one)',
        seen.wire.slice(wire0).every(m => m.obj.t !== 'sync' && m.obj.t !== 'synced') &&
          A.pc(IDB).control === false
      );
      A.hand.list = [];
      A.svc.gitChanged();
      await w.advance(200);
      check(
        "bring: the branch was deleted here: the line goes when git's files change",
        A.pc(IDB).handed === ''
      );
      const lines = () => A.svc.state().log.filter(e => e.kind === 'brought');
      check(
        "security review 20, 3.3: a bring that ended with the commit in its branch is one line in this computer's activity log: the computer, the commit's first ten characters, the branch",
        lines().length === 1 &&
          lines()[0].peer === IDB &&
          lines()[0].name === 'Laptop' &&
          lines()[0].commit === HEADB.slice(0, 10) &&
          lines()[0].branch === 'tnai/handoff/bbbb2222',
        lines()
      );
      A.hand.word = 'absent';
      A.svc.bring(IDB);
      await w.advance(200);
      check(
        'bring: "not pushed yet" is that word, and a try that made no branch writes no line',
        A.pc(IDB).brought.state === 'absent' && lines().length === 1
      );
      A.hand.word = () => {
        throw new Error('boom');
      };
      A.svc.bring(IDB);
      await w.advance(200);
      check('bring: a runner that throws is "failed"', A.pc(IDB).brought.state === 'failed');
      const calls = A.hand.calls.length;
      B.project = { root: 'e'.repeat(40), head: HEADB };
      B.svc.projectChanged();
      await w.advance(8000);
      const other = A.svc.bring(IDB);
      check(
        'bring: not for a computer that has another project open',
        A.pc(IDB).bringable === false && other.sent === 'not_sent' && A.hand.calls.length === calls,
        A.pc(IDB).bringable
      );
      const hA = {};
      registerIpc(
        {
          handle: (ch, fn) => {
            hA[ch] = fn;
          },
        },
        A.svc
      );
      const bad = await hA['remote:bring']({}, '__proto__'),
        bad2 = await hA['remote:handOver']({}, '__proto__'),
        good = await hA['remote:bring']({}, IDB);
      check(
        "bring: the window's calls take a paired computer's id and nothing else",
        bad.ok === false && bad2.ok === false && good.ok === true && good.value.sent === 'not_sent',
        [bad.ok, bad2.ok, good.ok]
      );
    }
    for (const c of [A, B]) c.svc.quit();
    await w.advance(120000);
    check('quit leaves no timer', w.timers.length === 0, w.timers.length);
  }
})()
  .catch(e => {
    failed++;
    console.log('ERROR ' + (e.stack || e));
  })
  .finally(async () => {
    // The folder holds a 48 MB file three times over: it must go. A program that was ended a moment
    // ago can still hold a file. In Electron's Node `fs.rmSync` stops at the folder with EPERM
    // (seen 2026-10-10; git's object files are read-only), so the system's own command is the
    // second try.
    let why = '';
    const system = () => {
      try {
        if (process.platform === 'win32')
          execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', base], {
            windowsHide: true,
            stdio: 'ignore',
          });
        else execFileSync('rm', ['-rf', base], { stdio: 'ignore' });
      } catch (e) {
        why += ' / ' + String(e.message || e).slice(0, 80);
      }
    };
    for (let i = 0; i < 20 && fs.existsSync(base); i++) {
      try {
        fs.rmSync(base, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (e) {
        why = String(e.code || '') + ' ' + String(e.path || e.message || '');
      }
      if (fs.existsSync(base)) system();
      if (fs.existsSync(base)) await sleep(500);
    }
    if (fs.existsSync(base))
      console.log('NOTE the test folder could not be removed: ' + base + ' (' + why + ')');
    console.log(
      `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
    );
    process.exit(failed ? 1 : 0);
  });
