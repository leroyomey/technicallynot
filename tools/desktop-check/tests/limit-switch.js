/*
 * * Technically Not tools · desktop-check/tests/limit-switch.js — "Resume now on another account"
 * on
 * * the limit card in the thread (125) against a FAKE `claude` from limit-switch.main.js (stops
 * * unless the fake is the one that started): a second Claude Code account is added, the fake
 * prints
 * * Claude Code's limit line, the card stands in that agent's thread and offers the second account,
 * * a press restarts the same panel under that account's folder and the card goes. Moved here on
 * * 2026-10-12 from the old Overview's limit box, which is gone. No real CLI, no usage. The second
 * account is not signed
 * * in; when 15 knows that, the test marks it signed in (the one simulated part) so the button is
 * * offered. Screenshot desktop-limit-switch.png. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
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
  N = window.tnaiNative,
  R = window.TnaiLimitResume,
  CLAUDE = 'Claude Code';
let paneId, account;
try {
  await until(() => A.list().length);
  account = await A.add(CLAUDE, { label: 'Second test account', signIn: false });
  check(!!account?.id, 'second Claude Code account added');
  const opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
  check(opened?.ok, 'Claude Code panel opened on the default account');
  paneId = opened?.paneId;
  const first = await until(async () =>
    (await N.pty.list()).find(s => s.paneId === paneId && s.running)
  );
  check(!!first, 'it runs');
  window.TnaiThreads.show(paneId);
  const card = () => window.TnaiThreads.slot('main')?.querySelector('.tnt-asks .tnt-limit') || null;
  const screen = async () =>
    ((await N.pty.replay(paneId))?.buffer || '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ');

  // Only the fake may run here: the real Claude Code would ask its folder-trust question and never
  // print a limit line on request.
  if (
    !check(
      !!(await until(async () => /FAKE-claude ready dir=default/.test(await screen()), 20000)),
      'the fake claude started on the default account'
    )
  )
    throw new Error('the fake claude was not the one started: ' + (await screen()).slice(-200));
  G.send(paneId, 'limit');
  if (
    !check(!!(await until(() => A.limitFor(paneId), 8000)), 'the limit line it prints is detected')
  )
    log.push('     screen: ' + (await screen()).slice(-400));
  check(
    !!(await until(() => card()?.isConnected && window.TnaiThreads.selected() === paneId, 5000)),
    'the agent is paused: the limit card stands in its thread'
  );
  let limit = A.limitFor(paneId);
  if (limit && limit.suggest === null) {
    const entry = A.list()
      .flatMap(c => c.accounts || [])
      .find(a => a.id === account.id);
    log.push(
      '     the second account is not signed in, so it is not offered (status ' +
        JSON.stringify(entry?.status) +
        '); marked signed in for the rest of the test'
    );
    if (entry) entry.status = { ...(entry.status || {}), loggedIn: true };
    window.dispatchEvent(new CustomEvent('tnai:accounts-changed'));
    limit = A.limitFor(paneId);
  }
  check(limit?.suggest === account.id, 'the second account is suggested');
  const button = await until(() => {
    const found = card()?.querySelector('[data-limit="switch"]');
    return found && !found.hidden ? found : null;
  }, 3000);
  check(
    !!button && /Resume now on .*Second test account/.test(button.textContent),
    'the card offers: ' + (button?.textContent.trim() || 'nothing')
  );
  check(
    !!(await until(() => R.pending().find(p => p.paneId === paneId && p.scheduled), 5000)),
    'the resume at reset is planned meanwhile'
  );
  console.log('TNAI_SHOT:limit-switch');
  await wait(900);

  // asked for again: the card was repainted when the plan arrived
  card()?.querySelector('[data-limit="switch"]')?.click();
  const second = await until(
    async () =>
      (await N.pty.list()).find(
        s => s.paneId === paneId && s.running && s.accountId === account.id
      ),
    30000
  );
  check(
    !!second && second.pid !== first?.pid,
    'the same panel restarted under the second account (new pid)'
  );
  check(
    !!(await until(
      async () => /^ dir=(?!default)\S+/.test((await screen()).split('FAKE-claude ready').pop()),
      8000
    )),
    "the restarted CLI runs on the second account's own folder"
  );
  check(
    !!(await until(() => !A.limitFor(paneId) && !card(), 5000)),
    'the limit and the card are gone'
  );
  check(!R.pending().some(p => p.paneId === paneId), 'the planned resume is cancelled');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
if (paneId) {
  R?.cancel(paneId);
  G.stop(paneId);
  await wait(400);
}
if (account?.id)
  check(!!(await A.remove(CLAUDE, account.id, { confirm: false })), 'test account removed');
return { ok, log };
