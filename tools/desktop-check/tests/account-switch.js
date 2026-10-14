// Technically Not tools · desktop-check/tests/account-switch.js — Cross-feature: a live Claude Code
// pane switched to another account restarts in the same pane under that account's folder, keeping
// its Technically Not session record. No prompt is sent and the new account is not signed in, so no
// usage. Returns {ok, log}.
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
const A = window.TnaiAccounts,
  G = window.TnaiAgents,
  CLAUDE = 'Claude Code';

await until(() => A.list().length);
const account = await A.add(CLAUDE, { label: 'Second test account', signIn: false });
check(!!account?.id, 'second Claude Code account added');

const opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
if (!opened?.ok) log.push('     open error: ' + JSON.stringify(opened));
check(opened?.ok, 'Claude Code pane opened on the default account');
const paneId = opened?.paneId;
const first = await until(async () =>
  (await window.tnaiNative.pty.list()).find(s => s.paneId === paneId && s.running && s.sessionId)
);
check(
  !!first && !first.accountId,
  'running on default account with Technically Not session id ' +
    (first?.sessionId || '').slice(0, 8)
);

const t0 = Date.now();
const result = await A.switchPane(paneId, account.id);
check(result?.ok, 'switchPane ok (' + (Date.now() - t0) + ' ms) · resumed=' + result?.resumed);
check(
  result?.resumed === false,
  'reports fresh start honestly (no saved conversation without a prompt)'
);
const second = await until(async () =>
  (await window.tnaiNative.pty.list()).find(
    s => s.paneId === paneId && s.running && s.accountId === account.id
  )
);
check(!!second && second.pid !== first?.pid, 'same pane restarted under the new account (new pid)');
check(
  G.sessions().find(s => s.paneId === paneId)?.accountId === account.id,
  'TnaiAgents session shows the new account'
);
check(
  /Second test account/.test(
    document.querySelector('.tnai-live-panel [data-pane="' + paneId + '"]')?.textContent || ''
  ) ||
    !!(await until(
      () =>
        /Second test account/.test(
          document.querySelector('.tnai-live-panel [data-pane="' + paneId + '"]')?.textContent || ''
        ),
      3000
    )),
  'Overview card shows the account label'
);
console.log('TNAI_SHOT:account-switch');
await wait(500);

G.stop(paneId);
await wait(400);
check(!!(await A.remove(CLAUDE, account.id, { confirm: false })), 'test account removed');
return { ok, log };
