// Technically Not tools · desktop-check/tests/plan-lock-startup.after.js — After the unlock reload:
// the page loaded unlocked, logged no JS error, and main answers files and git again.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
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
await window.TnaiAuth.ready();
await wait(3000);
const lock = document.querySelector('.tnai-lock-overlay');
check(
  !window.TnaiAuth.state().lock.locked &&
    (!lock || lock.hidden) &&
    !document.body.classList.contains('tnai-locked'),
  'after the reload: unlocked, no lock screen'
);
const [list, git] = await Promise.all([
  window.tnaiNative.fs.list(''),
  window.tnaiNative.git.status(),
]);
check(
  list?.ok && git?.ok,
  'after the reload: main answers fs:list and git:status (' +
    JSON.stringify([list?.ok, git?.ok]) +
    ')'
);
const errors = await main('errors');
check(
  errors.length === 0,
  'no JS errors after the reload' +
    (errors.length ? ' (' + errors.length + '): ' + errors.slice(0, 8).join(' || ') : '')
);
return { ok, log };
