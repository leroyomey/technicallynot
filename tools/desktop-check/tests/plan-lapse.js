/*
 * Technically Not tools · desktop-check/tests/plan-lapse.js — The plan lapses mid-session
 * (the plan check), against the fake accounts server of
 * plan-lock.main.js: signed in with Pro, a PowerShell panel open and a fake Claude Code turn
 * running (plan-lapse.main.js); the server's entitlement_version moves and a window focus fetches
 * the new pass (plan ended) → locked "no-plan" with one fix button and Keep reading; the running
 * turn keeps going and its permission prompt is answered (the hook gets the answer, no 590 s wait);
 * the turn ends; then a composer prompt and a new panel are refused and the lock comes back; files
 * and projects stay readable; the PowerShell panel gets its notice and is closed after the
 * (test-short) timer. Payment failed → "Update card"; a computer signed out by the server →
 * "device", files still readable; a plain sign-out still refuses files. No real CLI, no network.
 * Returns {ok, log}.
 */
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
    await wait(50);
  }
  return null;
};
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
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
const A = window.TnaiAuth,
  N = window.tnaiNative,
  st = () => A.state();
const lock = () => document.querySelector('.tnai-lock-overlay');
const lockShown = () => !!lock() && !lock().hidden;
const refused = r => r?.ok === false && r.error?.code === 'locked';
const notices = [];
N.auth.onNotice(n => notices.push(n?.message || ''));
let lapse = null;
N.auth.onLapse(v => {
  lapse = v;
});
const SHELL = 'lapse-shell-' + Date.now(),
  AGENT = 'lapse-agent-' + Date.now();

await main('ready');
await main('set', { plan: 'pro', key: 'good', expIn: 7 * 86400, online: true, version: 1 });
await main('enforce', true);
await A.ready();
let res = await A.signInEmail({ email: 'lapse@example.com', password: 'right-password' });
check(
  res?.status === 'signed-in' && !!(await until(() => !st().lock.locked)),
  'signed in with Pro: unlocked (' + JSON.stringify(res?.status || res?.error) + ')'
);
check((await main('version')) === 1, 'the app kept the entitlement_version from /entitlements (1)');

// Open work: a PowerShell panel and an agent in the middle of a turn.
let r = await N.pty.start({ paneId: SHELL, agent: 'Terminal', mode: 'run', cols: 80, rows: 24 });
check(r?.ok, 'a PowerShell panel is running');
check((await main('turnStart', AGENT)) === true, 'a fake Claude Code turn is running');

let lockEvents = 0;
window.addEventListener('tnai:lock', () => {
  lockEvents++;
});

// The subscription ends at Stripe: the webhook bumps entitlement_version; the next focus asks for
// it and fetches the new pass.
await main('set', { plan: 'none', status: 'canceled', version: 2 });
await main('focus');
check(
  !!(await until(() => st().lock.locked)),
  'on focus the moved version fetched the new pass: locked (no 12 h wait)'
);
check(
  st().lock.reason === 'no-plan' &&
    st().lock.lapsed &&
    /subscription ended/.test(st().lock.message),
  'reason: subscription ended (' + st().lock.reason + ': ' + st().lock.message + ')'
);
check((await main('version')) === 2, 'the app took the new version (2)');
check(
  lockShown() && /Subscribe to keep building/.test(lock().textContent),
  'the lock overlay says why'
);
check(lockEvents === 1, 'the lock fired tnai:lock once (' + lockEvents + ' events)');
check((await main('busy', AGENT)) === true, 'docking stopped no agent: the turn still runs');
const primaries = [...lock().querySelectorAll('.tnai-auth-primary')];
check(
  primaries.length === 1 && primaries[0].dataset.lock === 'subscribe',
  'one fix button: Subscribe (' + primaries.map(b => b.textContent).join() + ')'
);
check(
  !!lock().querySelector('[data-lock=read]') &&
    /files stay readable/.test(lock().querySelector('[data-lock-note]')?.textContent || ''),
  'Keep reading offered, the note says files stay readable'
);
check(
  !!(await until(() => notices.some(t => /PowerShell threads close in/.test(t)))),
  'PowerShell notice shown (' + notices.join(' | ') + ')'
);
check(
  !!(await until(() => lapse?.closeAt > Date.now() && lapse.panes.includes(SHELL))),
  'the window knows when the PowerShell panel closes'
);
check(
  !!(await until(() =>
    /PowerShell threads close at/.test(lock().querySelector('[data-lock-note]')?.textContent || '')
  )),
  'the lock note names the closing time'
);
await shot('plan-lapse-lock');

// The running turn is not stopped, and its permission prompt can still be answered.
check((await main('busy', AGENT)) === true, 'the running turn keeps going');
await main('ask');
const perm = await until(async () =>
  ((await N.permissions.pending()) || []).find(p => p.paneId === AGENT)
);
lock().querySelector('[data-lock=read]')?.click();
await wait(80);
check(
  !lockShown() && !document.body.classList.contains('tnai-locked'),
  'Keep reading sets the lock aside'
);
const ans = perm ? await N.permissions.answer(perm.id, 'once') : null;
const reply = await main('askReply');
check(
  !!perm && ans !== false && !refused(ans) && /allow/i.test(reply),
  'permission prompt answered while locked, the hook got it (' + String(reply).slice(0, 80) + ')'
);
check((await main('turnStop', AGENT)) === false, 'the turn ended by itself');

// Files and projects stay readable; everything that starts work is refused.
const [list, read, projects, git] = await Promise.all([
  N.fs.list(''),
  N.fs.read('README.md'),
  N.fs.projects(),
  N.git.status(),
]);
check(
  list?.ok && read?.ok && projects?.ok,
  'files and projects stay readable (' + JSON.stringify([list?.ok, read?.ok, projects?.ok]) + ')'
);
check(refused(git), 'other capabilities stay refused (git:status)');
r = await N.pty.submit(AGENT, 'next task', {});
check(refused(r), 'a composer prompt is refused after the turn');
check(!!(await until(() => lockShown())), 'a refused prompt brings the lock back');
lock().querySelector('[data-lock=read]')?.click();
await wait(80);
r = await N.pty.start({
  paneId: 'lapse-new-' + Date.now(),
  agent: 'Terminal',
  mode: 'run',
  cols: 80,
  rows: 24,
});
check(
  refused(r) && !!(await until(() => lockShown())),
  'a new panel is refused, the lock comes back'
);

// The PowerShell panel closes after its notice (4 s in this test, 10 min for real).
check(
  !!(await until(
    async () => !((await N.pty.list()) || []).some(p => p.paneId === SHELL && p.pid),
    12000
  )),
  'the PowerShell panel was closed after the notice'
);
check(!!(await until(() => lapse && !lapse.closeAt)), 'lapse state cleared once closed');

// Payment failed → Update card; renewed → unlocked.
await main('set', { status: 'unpaid' });
await A.check();
check(
  st().lock.reason === 'payment' &&
    lock().querySelector('.tnai-auth-primary')?.dataset.lock === 'account' &&
    /Update card/.test(lock().textContent),
  'payment failed: “Update card” (' + st().lock.reason + ')'
);
await shot('plan-lapse-payment');
await main('set', { plan: 'pro', status: '' });
await A.check();
check(!st().lock.locked && !lockShown(), 'paid again: unlocked');

// The server signs this computer out (another computer took its place): 'device', files still
// readable, Sign in fixes it.
await main('dropTokens');
await A.check();
{
  check(
    st().lock.reason === 'device' &&
      st().lock.lapsed &&
      lock().querySelector('.tnai-auth-primary')?.dataset.lock === 'signin',
    'signed out by the server: “device” with Sign in (' + st().lock.reason + ')'
  );
  check((await N.fs.list(''))?.ok, 'device: files stay readable');
  await A.signOut();
  check(
    st().lock.reason === 'signed-out' && refused(await N.fs.list('')),
    'a plain sign-out still refuses files'
  );
}
await main('enforce', false);

// The run stayed quiet: every sign-in above made the app ask for the keyboard, and none of it
// reached Windows (quiet-window.js, set up in plan-lock.main.js).
const quiet = await main('quiet');
check(
  quiet.asked.focus > 0 && !quiet.active && !quiet.focusable && !quiet.onMain,
  'quiet run: the app asked for the keyboard and no window took it or lay on the main monitor (' +
    JSON.stringify(quiet) +
    ')'
);
await main('close');
return { ok, log };
