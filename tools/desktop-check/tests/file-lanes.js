// Technically Not tools · desktop-check/tests/file-lanes.js — fs-service lane roots (the rail's
// Main | ⎇ toggle was removed with the File repository page) on the temp project: hidden with no
// worktrees; a PowerShell thread started in its own worktree makes it appear; picking the worktree
// shows its files in the same tree; opening, editing and Save write into the worktree, not the
// project folder; the tab remembers the worktree and reopens against it after switching back to
// Main; search covers the shown worktree; fs calls with a folder that isn't a known worktree are
// refused; removing the worktree drops it from the toggle, hands the tree back to Main, and its tab
// says the file is gone (no crash). No prompt is sent to any agent. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(60);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const native = window.tnaiNative,
  files = window.TnaiProjectFiles;
const windows = /Windows/.test(navigator.userAgent),
  sep = windows ? '\\' : '/';
const started = [];
const toggle = () => document.querySelector('.repo-lane-switch');
const laneBtn = id => toggle()?.querySelector('[data-lane="' + id + '"]');
const row = path => document.querySelector('.repo-real-tree [data-real-path="' + path + '"]');
const text = () =>
  document.querySelector('.repo-editor:not([hidden]) .repo-editor-text:not([readonly])');
const tabs = () => [...document.querySelectorAll('.file-tabs .file-tab')];
const decode = r => (r?.ok ? new TextDecoder().decode(r.value) : null);

// A PowerShell thread; `own` starts it in a worktree of its own (the start's own option, the one
// the prompt box's "Own worktree" box sets for a new agent, 35).
async function newShell(own) {
  const made = await window.TnaiTest.startThread({ tool: 'Terminal', worktree: !!own });
  started.push(made.paneId);
  await wait(2000);
  return made.paneId;
}

try {
  await until(() => row('README.md'));
  const userData = await main('userData');
  const bad = [
    await native.fs.read('README.md', 0, 64, userData),
    await native.fs.list('', userData + sep + 'worktrees'),
    await native.fs.write('x.txt', new Uint8Array([1]), windows ? 'C:\\Windows' : '/tmp'),
  ];
  check(
    bad.every(r => !r.ok && r.error.name === 'SecurityError'),
    'a folder that is not a known worktree is refused (read, list, write): ' +
      bad.map(r => r.error?.name).join(',')
  );

  const shellA = await newShell(false),
    sh = (id, cmd) => window.TnaiAgents.send(id, cmd);
  sh(
    shellA,
    'git init -q; git config user.email tnai-test@example.com; git config user.name Technically-Not-Test; git config commit.gpgsign false; git add -A; git commit -qm initial'
  );
  check(
    !!(await until(async () => {
      const s = (await native.git.status()).value;
      return s?.repo && !s.initial && !s.files.length;
    })),
    'repo with a first commit'
  );
  await window.TnaiGit?.refresh?.();

  // the "Own worktree" option is offered once the repo has a commit (30-git-panel was removed)
  await wait(1500);
  const shellB = await newShell(true);
  const wt = await until(async () => (await native.git.worktrees()).value?.items[0]),
    id = wt?.dir.split(/[\\/]/).pop(),
    short = wt?.branch.slice(5),
    key = p => '\u2387' + id + '/' + p;
  check(!!wt, 'worktree made: ' + wt?.branch);
  sh(shellB, windows ? 'Set-Content lane-only.txt from-lane' : 'echo from-lane > lane-only.txt');
  check((await native.fs.list('', wt.dir)).ok, 'fs lists a known worktree');

  // The rail's Main | ⎇ toggle, editor and tabs went with the File repository page (purple
  // redesign); the fs lane roots stay (09 TnaiFileViewer.open(path, lane), agents).
  check(
    !!(await until(
      async () =>
        (await native.fs.list('', wt.dir)).value?.some?.(e => /lane-only\.txt/.test(e.name || e)) ||
        (await native.fs.stat('lane-only.txt', wt.dir)).ok
    )),
    'fs sees the worktree’s own file'
  );
  const w = await native.fs.write(
    'README.md',
    new TextEncoder().encode(
      ['# Sample', 'line two', 'edited in lane', ''].join(String.fromCharCode(10))
    ),
    wt.dir
  );
  check(
    w?.ok && /edited in lane/.test((await main('read', wt.dir + sep + 'README.md')) || ''),
    'a write with the worktree as root lands in the worktree'
  );
  check(
    !/edited in lane/.test(decode(await native.fs.read('README.md', 0, 4096)) || 'x'),
    'the project folder README is untouched'
  );
  window.TnaiAgents.stop(shellB);
  await until(
    async () => !(await native.pty.list()).some(s => s.paneId === shellB && s.running),
    8000
  );
  const rm = await native.git.worktreeRemove(wt.branch, { discard: true, deleteBranch: true });
  check(rm.ok && rm.value.removed, 'worktree removed');
  const after = await native.fs.read('README.md', 0, 64, wt.dir);
  check(!after.ok && after.error.name === 'SecurityError', 'a removed worktree is refused');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
for (const id of started) window.TnaiAgents.stop(id);
await until(async () => !(await native.pty.list()).some(s => s.running), 5000);
await wait(300);
return { ok, log };
