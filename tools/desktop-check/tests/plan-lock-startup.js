/*
 * Technically Not tools · desktop-check/tests/plan-lock-startup.js — The app STARTS locked (plan
 * lock on, signed out; plan-lock-startup.main.js): every page script's startup calls meet main's
 * IPC guard (main.js LOCK_FREE) and the page must log no JS error; the lock screen is shown and
 * nothing outside it (except the window buttons) can be clicked. Unlocking asks for one reload;
 * after it (.after.js) the page loads unlocked with no JS error and main answers files again. No
 * network, no terminal, no agent. Returns {ok, log}.
 */
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

// every page's startup work (projects, files, git, skills, agents, updates) has answered by now
await wait(4000);
const st = window.TnaiAuth.state(),
  lock = document.querySelector('.tnai-lock-overlay');
check(
  st.lock?.locked && st.lock.reason === 'signed-out',
  'started locked, signed out (' + JSON.stringify(st.lock) + ')'
);
check(
  !!lock && !lock.hidden && document.body.classList.contains('tnai-locked'),
  'the lock screen is shown'
);
const reachable = [
  ...document.querySelectorAll('button, a[href], input, textarea, select, [contenteditable=true]'),
].filter(el => {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && (el === hit || el.contains(hit));
});
const outside = reachable.filter(
  el => !el.closest('.tnai-lock-overlay, .tnai-auth-overlay, .win-ctrls')
);
check(
  outside.length === 0,
  'only the lock and the window buttons can be clicked (' +
    (outside
      .map(el =>
        (el.textContent || el.getAttribute('aria-label') || el.className).trim().slice(0, 30)
      )
      .slice(0, 6)
      .join(' | ') || 'none outside') +
    ')'
);
const closeBtn = document.querySelector('.win-ctrl.close');
check(
  !!closeBtn && reachable.includes(closeBtn),
  'the window Close button can be clicked while locked'
);
const r = await window.tnaiNative.fs.list('');
check(r?.ok === false && r.error?.code === 'locked', 'main refuses fs:list at startup');
const errors = await main('errors');
check(
  errors.length === 0,
  'no JS errors while starting locked' +
    (errors.length ? ' (' + errors.length + '): ' + errors.slice(0, 8).join(' || ') : '')
);
console.log('TNAI_SHOT:plan-lock-startup-locked');
await wait(600);

// Unlock (the lock turned off, as a sign-in with a plan would): a window that started locked asks
// to reload, so its refused startup reads load for real.
window.__tnaiNoUnlockReload = true;
await main('unlock');
await window.TnaiAuth.ready();
check(
  !window.TnaiAuth.state().lock.locked && window.__tnaiUnlockReload === true,
  'unlocked: the window that started locked reloads'
);
return { ok, log, reload: true };
