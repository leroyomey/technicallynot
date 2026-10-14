/*
 * Technically Not tools · desktop-check/tests/cursor-switch.js — Settings › Accounts › Cursor Agent
 * › Switch account against a FAKE cursor-agent (cursor-switch.main.js; the user's real Cursor
 * sign-in is never touched — the test stops before any click unless Technically Not resolved the
 * fake). Checks: the button shows for a signed-in single-account CLI; its dialog explains
 * logout-then-login; Cancel runs nothing; "Sign out and switch" runs `logout`, then `login`, in one
 * login pane; Technically Not re-reads the sign-in when the pane ends and says who is signed in; a
 * failed login says it did not finish (and the logout stays done, truthfully shown as signed out);
 * a sign-in abandoned by closing its pane is handled the same way. Returns {ok, log}.
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
    await wait(100);
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
const G = window.TnaiAgents,
  CURSOR = 'Cursor Agent';
const toasts = [];
const realToast = window.toast;
window.toast = m => {
  toasts.push(String(m));
  return realToast?.(m);
};
const info = () => G.info().find(a => a.id === CURSOR);
const card = () => document.querySelector('#tnaiAccountsMount [data-cli="' + CURSOR + '"]');
const dlg = () => document.querySelector('.tnai-signin-overlay');

// login panes of earlier steps (a failed one stays open, offering Enter to try again)
let seen = new Set();
const loginPane = () =>
  G.sessions().find(s => s.agent === CURSOR && s.mode === 'login' && !seen.has(s.paneId));
const toastAfter = (n, re) => until(() => toasts.slice(n).find(t => re.test(t)), 15000);

async function openSwitch() {
  await G.detect(true);
  window.TnaiRoute('settings');
  await wait(200);
  const btn = await until(() => card()?.querySelector('button[data-acct="switch"]'), 8000);
  btn?.click();
  await wait(150);
  return btn;
}

async function switchOnce(label) {
  const n = toasts.length;
  seen = new Set(G.sessions().map(s => s.paneId));
  check(!!(await openSwitch()) && !dlg().hidden, label + ': Switch account opens the dialog');
  dlg().querySelector('.tnai-ws-close-confirm').click();
  const pane = await until(loginPane, 8000);
  check(!!pane, label + ': a login pane opened');
  return { n, pane };
}

try {
  const bin = await main('bin');
  await G.detect(true);
  const safe = !!info()?.path && info().path.toLowerCase().startsWith(bin.toLowerCase());
  check(safe, 'Technically Not resolved the FAKE cursor-agent (' + info()?.path + ')');
  if (!safe) throw new Error('not the fake cursor-agent: stopping before any click');
  check(
    info().loggedIn === true && info().account === 'first@example.com',
    'fake reports signed in as first@example.com'
  );

  // Dialog + Cancel: nothing runs.
  check(!!(await openSwitch()), 'Switch account button shown on the signed-in Cursor card');
  const text = dlg().textContent;
  check(
    /Switch Cursor Agent account/.test(text) &&
      /cursor-agent logout, then cursor-agent login/.test(text) &&
      /Sign out and switch/.test(text),
    'dialog names the commands (logout, then login) and the action'
  );
  console.log('TNAI_SHOT:cursor-switch-dialog');
  await wait(450);
  dlg().querySelector('.tnai-ws-close-cancel').click();
  await wait(1500);
  check(
    dlg().hidden &&
      !loginPane() &&
      !(await main('calls')).length &&
      (await main('state')).email === 'first@example.com',
    'Cancel: dialog closed, no pane, no command run, still signed in'
  );

  // Success: logout, then login, in one pane; Technically Not re-detects and names the new account.
  let r = await switchOnce('switch');
  const ended = await until(() => !loginPane()?.running, 15000);
  check(!!ended, 'switch: login pane finished');
  const calls = await main('calls');
  check(
    JSON.stringify(calls) === '["logout","login"]',
    'switch: commands ran in order ' + JSON.stringify(calls)
  );
  const buf = (await window.tnaiNative.pty.replay(r.pane.paneId))?.buffer || '';
  check(
    /FAKE-CURSOR logged out[\s\S]*FAKE-CURSOR login mode=ok/.test(buf),
    'switch: pane shows logout output, then login output'
  );
  check(
    !!(await toastAfter(r.n, /Cursor Agent signed in as /)),
    'switch: toast says who is signed in (' + toasts.slice(r.n).join(' | ') + ')'
  );
  check(
    !!(await until(() => info()?.account === 'next@example.com', 8000)),
    'switch: detection now reads next@example.com'
  );
  await wait(300);
  check(
    /Signed in as n\*{5}t@e\*{3}\.com/.test(card()?.textContent || '') &&
      !/next@example/.test(card()?.textContent || ''),
    'switch: Accounts card shows the new account, email masked'
  );
  G.stop(r.pane.paneId);
  await wait(400);

  // Failure: login exits 1 after logout → "did not finish", shown as signed out (the truth), with a
  // Sign in button.
  await main('reset', 'next@example.com', 'fail');
  await G.detect(true);
  r = await switchOnce('fail');

  // Both runs logged and the pane ended (a pane still starting is not `running` yet either, so the
  // calls log is what says it ran).
  await until(async () => (await main('calls')).length === 2 && !loginPane()?.running, 15000);
  const failCalls = JSON.stringify(await main('calls'));
  check(failCalls === '["logout","login"]', 'fail: logout, then login ran ' + failCalls);
  check(
    !!(await toastAfter(r.n, /sign-in did not finish/)),
    'fail: toast says sign-in did not finish (' + toasts.slice(r.n).join(' | ') + ')'
  );
  check(
    !!(await until(() => info()?.loggedIn === false, 8000)),
    'fail: detection reads signed out'
  );
  await wait(300);
  check(
    !!card()?.querySelector('button[data-acct="signin"]') &&
      !card()?.querySelector('button[data-acct="switch"]'),
    'fail: card offers Sign in, not Switch account'
  );
  G.stop(r.pane.paneId);
  await wait(400);

  // Abandoned: the user closes the login pane while the sign-in waits.
  await main('reset', 'next@example.com', 'hang');
  await G.detect(true);
  r = await switchOnce('abandon');
  await until(async () => (await main('calls')).length === 2, 8000);
  check(!!loginPane()?.running, 'abandon: login pane waiting on the sign-in');
  G.stop(r.pane.paneId);
  check(
    !!(await toastAfter(r.n, /sign-in did not finish/)),
    'abandon: closing the pane → sign-in did not finish (' + toasts.slice(r.n).join(' | ') + ')'
  );
  check(
    !G.sessions().find(s => s.paneId === r.pane.paneId)?.running,
    'abandon: no login pane left running'
  );
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
window.toast = realToast;
return { ok, log };
