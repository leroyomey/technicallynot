/*
 * Technically Not tools · desktop-check/tests/worktree-switch.js — A project switch (main.js
 * rootChanged) stops the old project's agent-worktree watchers (worktree-service.js) and starts the
 * new project's: a file written in project A's worktree sends fs:changes (lane-tagged) while A is
 * open, none after switching to B, and again after switching back. No process is started in the
 * worktree, no agent prompt. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
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
const N = window.tnaiNative,
  same = (x, y) => String(x || '').toLowerCase() === String(y || '').toLowerCase();
const seen = [];
N.fs.onChanges(batch => {
  for (const c of batch || []) seen.push(JSON.stringify(c));
});
const arrived = name => seen.some(s => s.includes(name));
try {
  const { a, b } = await main('setup');
  const tree = await main('worktree', 'wt-switch-pane');
  check(
    !!tree?.cwd && !tree.cwd.toLowerCase().startsWith(a.toLowerCase()),
    'worktree made outside the project folder: ' + (tree?.cwd || 'none')
  );
  await wait(500);
  await main('write', tree.cwd, 'while-a-open.txt', 'x');
  check(
    !!(await until(() => arrived('while-a-open.txt'))),
    'project A open: its worktree sends fs:changes'
  );

  await main('pickNext', b);
  await N.fs.pick();
  check(!!(await until(async () => same(await N.fs.root(), b))), 'switched to project B');
  await wait(800);
  seen.length = 0;
  await main('write', tree.cwd, 'after-switch.txt', 'x');
  await wait(2000);
  check(
    !arrived('after-switch.txt'),
    "project B open: no fs:changes from project A's worktree (" +
      seen.filter(s => s.includes('after-switch')).length +
      ')'
  );

  await N.fs.switchTo(a);
  check(!!(await until(async () => same(await N.fs.root(), a))), 'switched back to project A');
  await wait(800);
  await main('write', tree.cwd, 'back-in-a.txt', 'x');
  check(
    !!(await until(() => arrived('back-in-a.txt'))),
    'back in project A: its worktree is watched again'
  );
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
