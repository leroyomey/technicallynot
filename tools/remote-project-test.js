// Test of desktop/remote-project.js: node tools/remote-project-test.js (plain Node; also run it in
// Electron's Node). "Same project, seen". Part 1 uses
// real git in two throwaway repositories in the temp folder (a stand-in for git would prove nothing
// about what git answers): which project a folder is, and how far two copies are apart. Part 2 is
// the rate a paired computer cannot raise: a comparison that needs git runs once per computer every
// few seconds, one at a time, the newest ids win, on a clock the test moves by hand.
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const { execFile } = require('child_process');
const {
  createProjectReader,
  createRelater,
  createProjectKeys,
  RELATE_MS,
  KEY_AGAIN_MS,
} = require('../desktop/remote-project.js');
const { projectKey } = require('../desktop/remote-api.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// The temp folder by its full name: where Windows gives a short one (RUNNER~1), git answers with
// the long one and the compare of the two fails.
const base = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-remote-project-'));
const ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

// The same shape as git-service.js `git`: execFile, no shell, resolves { stdout, stderr, code } for
// the codes it was told are fine.
const runner =
  (cwd, calls) =>
  (args, { okCodes = [0] } = {}) =>
    new Promise((resolve, reject) => {
      if (calls) calls.push(args);
      execFile(
        'git',
        ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
        { cwd, env: ENV, windowsHide: true, timeout: 20000 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
          if (!okCodes.includes(code))
            return reject(new Error(String(stderr || error?.message || 'git failed').trim()));
          resolve({ stdout: String(stdout), stderr: String(stderr), code });
        }
      );
    });
const probeOf = (dir, git) => async () => {
  const r = await git(['rev-parse', '--show-toplevel', '--absolute-git-dir'], {
    okCodes: [0, 128],
  });
  const [top, gitDir] = r.stdout.split(/\r?\n/);
  return top
    ? {
        available: true,
        repo: path.resolve(top).toLowerCase() === path.resolve(dir).toLowerCase(),
        top: path.resolve(top),
        gitDir: path.resolve(gitDir),
      }
    : { available: true, repo: false };
};
const commit = async (git, dir, name) => {
  fs.writeFileSync(path.join(dir, name), name + '\n');
  await git(['add', '--', name]);
  await git(['commit', '-q', '-m', name]);
};

(async () => {
  // ---- part 1: real git ----
  const A = path.join(base, 'a'),
    B = path.join(base, 'copy with another name'),
    C = path.join(base, 'c'),
    D = path.join(base, 'd');
  for (const d of [A, C, D]) fs.mkdirSync(d);
  const callsA = [],
    gitA = runner(A, callsA),
    gitC = runner(C),
    gitD = runner(D);
  const watched = [];
  let probesA = 0;
  const probeA = probeOf(A, runner(A)),
    readerA = createProjectReader({
      git: gitA,
      probe: () => {
        probesA++;
        return probeA();
      },
      watch: d => watched.push(d),
    });

  check('a folder that is not a git repository is no project', (await readerA.read()) === null);
  await gitA(['init', '-q']);
  check('a repository without a commit is no project', (await readerA.read()) === null);
  await commit(gitA, A, 'one.txt');
  await commit(gitA, A, 'two.txt');
  const a2 = await readerA.read();
  const rootA = (await gitA(['rev-list', '--max-parents=0', 'HEAD'])).stdout.trim(),
    headA2 = (await gitA(['rev-parse', 'HEAD'])).stdout.trim();
  check(
    'a project is its first commit and the commit it is on',
    a2 && a2.root === rootA && a2.head === headA2 && Object.keys(a2).sort().join() === 'head,root',
    a2
  );
  check(
    "the repository's own folder is handed to the watcher, so a new commit is pushed",
    watched.length > 0 && /\.git$/.test(watched.at(-1))
  );

  // B is a copy of A in a folder with another name, somewhere else: the same project.
  await runner(base)(['clone', '-q', A, B]);
  const gitB = runner(B),
    readerB = createProjectReader({ git: gitB, probe: probeOf(B, gitB) });
  const b2 = await readerB.read();
  check(
    'a copy in a folder with another name is the same project',
    b2 && b2.root === a2.root && b2.head === a2.head,
    b2
  );
  check('same commit', (await readerA.relate(a2, b2)).rel === 'same');

  await commit(gitA, A, 'three.txt');
  await commit(gitA, A, 'four.txt');
  await commit(gitA, A, 'five.txt');
  const before = callsA.length,
    probesBefore = probesA,
    a5 = await readerA.read();
  check(
    'the first commit is asked for once per folder, the current commit every time',
    a5.root === a2.root &&
      a5.head !== a2.head &&
      callsA.slice(before).every(c => c[0] !== 'rev-list'),
    callsA.slice(before).map(c => c[0])
  );
  check(
    'a read while the same folder stays open is one git command: the folder is not probed again',
    probesA === probesBefore && callsA.length === before + 1,
    { probes: probesA - probesBefore, calls: callsA.length - before }
  );
  readerA.reset();
  const afterReset = await readerA.read();
  check(
    'after another folder was opened everything is asked afresh',
    probesA === probesBefore + 1 &&
      JSON.stringify(afterReset) === JSON.stringify(a5) &&
      callsA.slice(before + 1).some(c => c[0] === 'rev-list')
  );

  // The folder changes while git is answering: an answer about the old folder is not kept or
  // returned.
  {
    let let_go;
    const slow = createProjectReader({
      git: gitA,
      probe: () =>
        new Promise(res => {
          let_go = () => probeA().then(res);
        }),
    });
    const pending = slow.read();
    slow.reset();
    let_go();
    check('an answer that arrives after the folder changed is dropped', (await pending) === null);
  }
  const behind = await readerA.relate(a5, b2);
  check(
    'the copy lacks three commits: seen from A it is 3 behind',
    behind.rel === 'behind' && behind.n === 3,
    behind
  );
  const missing = await readerB.relate(b2, a5);
  check(
    'seen from the copy, A has commits it does not have (not counted: they are not there)',
    missing.rel === 'missing' && !('n' in missing),
    missing
  );

  await commit(gitB, B, 'other.txt');
  const b3 = await readerB.read();
  check(
    'both moved on: A cannot count what it does not have',
    (await readerA.relate(a5, b3)).rel === 'missing'
  );
  await gitA(['fetch', '-q', B, 'HEAD']); // now A holds the copy's commit too, without being on it
  const apart = await readerA.relate(a5, b3);
  check(
    "with the copy's commit present: 3 behind and 1 ahead",
    apart.rel === 'apart' && apart.behind === 3 && apart.ahead === 1,
    apart
  );
  await gitB(['fetch', '-q', A, 'HEAD']);
  await gitB(['merge', '-q', '--no-edit', 'FETCH_HEAD']);
  const b4 = await readerB.read();
  await gitA(['fetch', '-q', B, 'HEAD']);
  const ahead = await readerA.relate(a5, b4);
  check(
    'the copy merged A and has more: ahead, counted',
    ahead.rel === 'ahead' && ahead.n === 2,
    ahead
  );

  // Another project.
  await gitC(['init', '-q']);
  await commit(gitC, C, 'one.txt');
  const c1 = await createProjectReader({ git: gitC, probe: probeOf(C, gitC) }).read();
  check(
    'another repository is another project, even with the same first file',
    c1 && c1.root !== a2.root && (await readerA.relate(a5, c1)) === null,
    c1
  );

  // A folder inside a repository is not that repository.
  const inner = path.join(A, 'inner');
  fs.mkdirSync(inner);
  const gitIn = runner(inner);
  check(
    'a folder inside a repository is no project of its own',
    (await createProjectReader({ git: gitIn, probe: probeOf(inner, gitIn) }).read()) === null
  );

  // What another computer sends is untrusted: nothing but two commit ids reaches git.
  const spy = [],
    gitSpy = (args, o) => {
      spy.push(args);
      return gitA(args, o);
    },
    r = createProjectReader({ git: gitSpy, probe: probeOf(A, gitA) });
  const bad = [
    { root: a5.root, head: '--output=' + path.join(base, 'made-by-git') + 'a'.repeat(5) },
    { root: a5.root, head: 'HEAD; echo x' },
    { root: a5.root, head: a5.head.toUpperCase() },
    { root: a5.root, head: a5.head + '^' },
    { root: '-' + a5.root.slice(1), head: a5.head },
    { root: a5.root },
    null,
    'text',
    { root: a5.root, head: ['x'] },
  ];
  const answers = [];
  for (const t of bad) answers.push(await r.relate(a5, t));
  check(
    'ids that are not commit ids never reach git',
    spy.length === 0 && !fs.existsSync(path.join(base, 'made-by-git')),
    spy
  );
  check(
    'they are read as "another project" or "cannot be compared", never as a count',
    answers.every(x => x === null || x.rel === 'unknown'),
    answers
  );
  const unknownCommit = await r.relate(a5, { root: a5.root, head: 'f'.repeat(40) });
  check(
    'a well-formed id of a commit that is not here: one read-only command, answer "missing"',
    unknownCommit.rel === 'missing' &&
      spy.length === 1 &&
      spy[0][0] === 'rev-list' &&
      spy[0].includes('--count'),
    spy
  );
  const broken = createProjectReader({
    git: async () => {
      throw new Error('git is gone');
    },
    probe: async () => {
      throw new Error('no folder');
    },
  });
  check(
    'no folder or no git: no project, and a comparison that cannot run says so',
    (await broken.read()) === null && (await broken.relate(a5, b2)).rel === 'unknown'
  );

  // The folder stopped being a repository between the read and the comparison: git answers "not a
  // git repository" with the same exit code as for a commit it does not have, and that is not "the
  // other computer has more".
  const gone = createProjectReader({ git: gitD, probe: async () => ({ repo: false }) });
  check(
    'a folder that is no repository any more is "cannot be compared", not "it has commits this computer lacks"',
    (await gone.relate(a5, b2)).rel === 'unknown'
  );

  // ---- which project a folder is, as one key (section 6e): real git again ----
  {
    const calls = [],
      run = (args, { cwd, okCodes = [0] } = {}) => {
        calls.push(cwd);
        return runner(cwd)(args, { okCodes });
      };
    let t = 1000;
    const keys = createProjectKeys({ git: run, now: () => t });
    const kA = await keys.keyOf(A),
      n = calls.length;
    check('key: a git project is its first commit', kA === rootA, kA);
    check(
      'key: asked once per folder, then kept',
      (await keys.keyOf(A)) === rootA &&
        (await keys.keyOf(A + path.sep)) === rootA &&
        calls.length === n &&
        keys.peek(A) === rootA,
      calls.length - n
    );
    const P1 = path.join(base, 'one', 'Shop Site'),
      P2 = path.join(base, 'two', 'shop site'),
      P3 = path.join(base, 'two', 'other'),
      P4 = path.join(base, 'two', 'fourth'),
      inner = path.join(A, 'inner');
    for (const d of [P1, P2, P3, P4, inner]) fs.mkdirSync(d, { recursive: true });
    const k1 = await keys.keyOf(P1),
      k2 = await keys.keyOf(P2),
      k3 = await keys.keyOf(P3);
    check(
      'key: a folder without git is named by a hash of its own name, wherever it is',
      /^n[0-9a-f]{40}$/.test(k1) && k1 === k2 && k3 !== k1,
      [k1, k2, k3]
    );
    check(
      'key: a folder inside a repository is not that project',
      /^n[0-9a-f]{40}$/.test(await keys.keyOf(inner))
    );
    check(
      'key: every key has a form an agent row carries',
      [kA, k1, k3].every(k => projectKey(k) === k)
    );
    check(
      'key: no folder, a relative path or a non-string has no key and runs nothing',
      (await keys.keyOf('')) === '' &&
        (await keys.keyOf('relative/path')) === '' &&
        (await keys.keyOf(null)) === '' &&
        keys.peek('') === '' &&
        keys.peek(path.join(base, 'never asked')) === ''
    );
    const gitP3 = runner(P3);
    await gitP3(['init', '-q']);
    await commit(gitP3, P3, 'first.txt');
    const m = calls.length;
    check(
      'key: a name key is kept for a while',
      (await keys.keyOf(P3)) === k3 && calls.length === m
    );
    t += KEY_AGAIN_MS + 1;
    const k3b = await keys.keyOf(P3);
    check(
      'key: asked again later, a folder that became a git project is its first commit',
      k3b === (await gitP3(['rev-list', '--max-parents=0', 'HEAD'])).stdout.trim() &&
        keys.peek(P3) === k3b,
      k3b
    );
    const k4 = await keys.keyOf(P4),
      gitP4 = runner(P4);
    await gitP4(['init', '-q']);
    await commit(gitP4, P4, 'first.txt');
    check(
      'key: told its git files changed, a name key is asked again at once, a first commit never',
      keys.changed(P4) === true &&
        keys.changed(A) === false &&
        keys.changed(path.join(base, 'never asked')) === false &&
        /^[0-9a-f]{40,64}$/.test(await keys.keyOf(P4)) &&
        keys.peek(P4) !== k4
    );
    const P5 = path.join(base, 'two', 'fifth');
    fs.mkdirSync(P5);
    const before = calls.length,
      both = await Promise.all([keys.keyOf(P5), keys.keyOf(P5), keys.keyOf(P5)]);
    check(
      'key: asked for three times at once, git answers once',
      both[0] === both[1] && both[1] === both[2] && calls.length - before === 1,
      calls.length - before
    );
    const gone = createProjectKeys({
      git: async () => {
        throw new Error('git is not installed');
      },
    });
    check('key: without git a folder still has its name key', (await gone.keyOf(P1)) === k1);
  }

  // ---- part 2: the rate ----
  {
    const w = { t: 1700000000000, timers: [] };
    const timers = {
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
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    const advance = async ms => {
      const end = w.t + ms;
      await settle();
      for (;;) {
        const due = w.timers.filter(h => h.at <= end).sort((x, y) => x.at - y.at)[0];
        if (!due) break;
        timers.clear(due);
        w.t = Math.max(w.t, due.at);
        due.fn();
        await settle();
      }
      w.t = end;
    };
    const R = 'a'.repeat(40),
      M = 'b'.repeat(40),
      id = n => n.toString(16).padStart(40, '0');
    const runs = [],
      told = [];
    let open = null,
      active = 0,
      most = 0;
    const relate = (mine, theirs) => {
      runs.push(theirs.head);
      active++;
      most = Math.max(most, active);
      return new Promise(res => {
        const done = v => {
          active--;
          res(v);
        };
        if (open) open.push(done);
        else done({ rel: 'behind', n: runs.length });
      });
    };
    const rel = createRelater({ relate, on: p => told.push(p), now: () => w.t, timers });

    check('rate: nothing known about a computer that sent nothing', rel.get('p1') === null);
    rel.set('p1', { root: R, head: M }, { root: 'c'.repeat(40), head: M });
    check('rate: another project: no answer, no git', rel.get('p1') === null && runs.length === 0);
    rel.set('p1', { root: R, head: M }, { root: R, head: M });
    check(
      'rate: the same commit is answered from the ids alone, no git',
      rel.get('p1').rel === 'same' && runs.length === 0
    );
    rel.set('p1', { root: R, head: M }, { root: R, head: '' });
    check(
      'rate: no commit id from the other side: "unknown", no git',
      rel.get('p1').rel === 'unknown' && runs.length === 0
    );
    rel.set('p1', { root: R, head: M }, { root: R, head: id(1) });
    check(
      'rate: while git has not answered the page gets "unknown", never an old count',
      rel.get('p1').rel === 'unknown'
    );
    await settle();
    check(
      'rate: a different commit is compared by git, once, and the page is told',
      runs.length === 1 && rel.get('p1').rel === 'behind' && told.join() === 'p1',
      { runs, told }
    );
    rel.set('p1', { root: R, head: M }, { root: R, head: id(1) });
    await settle();
    check('rate: the same two ids again: the answer is kept, git does not run', runs.length === 1);

    // A paired computer that changes its commit id with every message.
    for (let n = 2; n < 500; n++) rel.set('p1', { root: R, head: M }, { root: R, head: id(n) });
    await settle();
    check(
      'rate: 498 new ids at once run git 0 more times inside the wait',
      runs.length === 1 && rel.get('p1').rel === 'unknown',
      runs.length
    );
    await advance(RELATE_MS + 10);
    check(
      'rate: after the wait git runs once, for the newest ids only',
      runs.length === 2 && runs[1] === id(499) && rel.get('p1').rel === 'behind',
      runs
    );
    const t0 = runs.length;
    for (let s = 0; s < 60; s++) {
      for (let n = 0; n < 50; n++)
        rel.set('p1', { root: R, head: M }, { root: R, head: id(1000 + s * 50 + n) });
      await advance(1000);
    }
    check(
      'rate: a minute of 50 new ids a second: git ran at most once every ' +
        RELATE_MS / 1000 +
        ' s',
      runs.length - t0 <= Math.ceil(60000 / RELATE_MS) + 1 && runs.length - t0 >= 15,
      runs.length - t0
    );
    await advance(RELATE_MS + 10);

    // One at a time for all computers, and a late answer for old ids is not shown.
    open = [];
    most = 0;
    active = 0;
    rel.set('p1', { root: R, head: M }, { root: R, head: id(9001) });
    rel.set('p2', { root: R, head: M }, { root: R, head: id(9002) });
    rel.set('p3', { root: R, head: M }, { root: R, head: id(9003) });
    await settle();
    check(
      'rate: three computers at once: one git comparison runs, the others wait in line',
      active === 1 && open.length === 1
    );

    // new ids while its comparison still runs
    rel.set('p1', { root: R, head: M }, { root: R, head: id(9101) });
    open.shift()({ rel: 'behind', n: 77 });
    await settle();
    check(
      'rate: an answer for ids that changed meanwhile is dropped',
      rel.get('p1').rel === 'unknown'
    );
    while (open.length) {
      open.shift()({ rel: 'ahead', n: 5 });
      await settle();
    }
    check(
      'rate: never two comparisons at the same time',
      most === 1 && rel.get('p2').rel === 'ahead' && rel.get('p3').rel === 'ahead',
      most
    );
    open = null;
    await advance(RELATE_MS + 10);
    check('rate: the changed ids are compared after the wait', rel.get('p1').rel === 'behind');

    // A comparison that fails, and leaving.
    const bad2 = createRelater({
      relate: async () => {
        throw new Error('git broke');
      },
      now: () => w.t,
      timers,
    });
    bad2.set('p1', { root: R, head: M }, { root: R, head: id(1) });
    await settle();
    check(
      'rate: a comparison that throws is "unknown", and nothing is thrown out',
      bad2.get('p1').rel === 'unknown'
    );
    const odd = createRelater({
      relate: async () => ({ rel: 7, n: '<b>' }),
      now: () => w.t,
      timers,
    });
    odd.set('p1', { root: R, head: M }, { root: R, head: id(1) });
    await settle();
    check('rate: an answer without a known word is "unknown"', odd.get('p1').rel === 'unknown');
    rel.set('p2', { root: R, head: M }, null);
    check('rate: a computer that no longer names a project has no answer', rel.get('p2') === null);
    rel.set('p3', { root: R, head: M }, { root: R, head: id(9501) });
    rel.set('p3', { root: R, head: M }, { root: R, head: id(9502) });
    rel.forget('p3');
    rel.stop();
    bad2.stop();
    odd.stop();
    const after = runs.length;
    rel.set('p1', { root: R, head: M }, { root: R, head: id(9999) });
    await advance(10 * RELATE_MS);
    check(
      'rate: stop leaves no timer and runs nothing more',
      w.timers.length === 0 && runs.length === after && rel.get('p1') === null,
      w.timers.length
    );
  }
})()
  .catch(e => {
    failed++;
    console.log('ERROR ' + (e.stack || e));
  })
  .finally(() => {
    try {
      fs.rmSync(base, { recursive: true, force: true });
    } catch {
      /* the temp folder is cleaned by the system */
    }
    console.log(
      `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
    );
    process.exit(failed ? 1 : 0);
  });
