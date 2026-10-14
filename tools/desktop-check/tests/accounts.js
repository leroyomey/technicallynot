// Technically Not tools · desktop-check/tests/accounts.js — Multiple accounts per CLI: add a Claude
// Code account folder (with the shared conversations junction), sign-in status per account, the
// plan tag read from a fake credential file (accounts.main.js; no real CLI credentials involved),
// active account persisted on disk, usage-limit detection, removal that leaves the default home
// intact. No login flow runs and no prompt is sent. Returns {ok, log}.
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
const A = window.TnaiAccounts,
  N = window.tnaiNative.accounts,
  CLAUDE = 'Claude Code';

check(!!A && !!N, 'TnaiAccounts and tnaiNative.accounts present');
check(!!(await until(() => A.list().length)), 'accounts list loaded');
check(
  A.list().find(d => d.agentId === CLAUDE)?.supported === true &&
    A.list().find(d => d.agentId === 'Codex')?.supported === true,
  'Claude Code and Codex support several accounts'
);
check(
  A.list().find(d => d.agentId === 'Cursor Agent')?.supported === false,
  'Cursor Agent listed as single-account'
);
check(
  A.list().find(d => d.agentId === 'Cursor Agent')?.signIn?.switchCommand ===
    'cursor-agent logout, then cursor-agent login',
  'Cursor Agent offers Switch account (logout, then login)'
);
check(
  !/ not found</.test(document.getElementById('tnaiAccountsMount')?.innerHTML || ''),
  'no "<cli> not found" subtitle next to Not installed'
);

// Add an account without running its sign-in.
const account = await A.add(CLAUDE, { label: 'Test account', signIn: false });
check(
  !!account?.id && /agent-accounts[\\/]claude-code[\\/]acct-/.test(account.dir),
  'account folder created under Technically Not user data'
);
check(!account.note, 'no sharing problem reported' + (account?.note ? ': ' + account.note : ''));
const dir = await N.dirFor(CLAUDE, account.id);
check(dir === account.dir, 'dirFor resolves the account folder');
check((await N.dirFor(CLAUDE, '')) === '', 'dirFor of the default account is the CLI home (empty)');

const listed = (await N.list({ withStatus: true, force: true })).value
  .find(d => d.agentId === CLAUDE)
  .accounts.find(a => a.id === account.id);
check(
  listed?.shared?.[0]?.name === 'projects' && listed.shared[0].linked,
  'projects folder is a junction to the default Claude home'
);
check(listed?.status?.loggedIn === false, 'new account reports not signed in (its own folder)');
check(listed?.status?.plan === '', 'new account with no credential file reports no plan');
log.push(
  '     default account status: ' +
    JSON.stringify(
      (await N.list({ withStatus: true })).value.find(d => d.agentId === CLAUDE).accounts[0].status
    )
);

// Plan tag: a fake (never real) credential file dropped into the account's own folder is read and
// title-cased, with no CLI sign-in.
await main('writeClaudeCreds', account.dir, 'max');
const withPlan = (await N.list({ withStatus: true, force: true })).value
  .find(d => d.agentId === CLAUDE)
  .accounts.find(a => a.id === account.id);
check(
  withPlan?.status?.plan === 'Max',
  'fake Claude .credentials.json subscriptionType "max" reads as plan "Max": ' +
    JSON.stringify(withPlan?.status?.plan)
);

const codexAccount = await A.add('Codex', { label: 'Test account', signIn: false });
await main('writeCodexAuth', codexAccount.dir, 'go');
const codexListed = (await N.list({ withStatus: true, force: true })).value
  .find(d => d.agentId === 'Codex')
  .accounts.find(a => a.id === codexAccount.id);
check(
  codexListed?.status?.plan === 'Go',
  'fake Codex auth.json JWT claim "go" reads as plan "Go": ' +
    JSON.stringify(codexListed?.status?.plan)
);
await A.remove('Codex', codexAccount.id, { confirm: false });

// Active account is saved on disk (list rereads the file every call).
await A.setActive(CLAUDE, account.id);
check(A.activeFor(CLAUDE) === account.id, 'activeFor returns the chosen account');
check(
  (await N.list()).value.find(d => d.agentId === CLAUDE).active === account.id,
  'active account persisted in accounts.json'
);
window.TnaiRoute('settings');
await wait(150);
await until(
  () =>
    document
      .getElementById('tnaiAccountsMount')
      ?.querySelector('[data-account="' + account.id + '"]'),
  3000
);
check(
  !!document.querySelector('#tnaiAccountsMount [data-account="' + account.id + '"].active'),
  'accounts UI lists the new account as the one for new sessions'
);
console.log('TNAI_SHOT:accounts');
await wait(500);

// Limit wording of each CLI, from its source or a quoted real report (URLs in 15-agent-accounts.js
// / the release queue line).
for (const [text, want] of [
  // Gemini CLI dialog (useQuotaAndFallback.ts)
  ['│ Usage limit reached for gemini-2.5-pro.                    │', true],
  // Gemini CLI TerminalQuotaError (googleQuotaErrors.ts)
  ['✕ [API Error: You have exhausted your daily quota on this model.]', true],
  ['Error: You’ve hit your usage limit', true], // Cursor Agent (forum.cursor.com/t/128577)
  ["Error: You've hit your usage limit", true],
  [
    '5 hour usage limit reached. It will reset in 5 hours 23 minutes. To continue using this model now, enable usage from your available balance',
    true,
  ], // OpenCode Go (session/retry.ts)
  [
    'The daily quota on this model is shared, so I will check the usage limits before we hit them.',
    false,
  ], // normal agent prose
  ['Rate limit reached, retrying in 4s (attempt 2)', false],
  // a markdown doc diff an agent shows
  ['616  | 5 | ~~Usage limit reached~~ | Switch account / continue on another', false],
  ['| **5-hour limit reached** | the agent pauses |', false],
])
  check(
    A.isLimitText(text) === want,
    (want ? 'limit: ' : 'not a limit: ') + JSON.stringify(text.slice(0, 70))
  );

// Usage-limit detection on a thread's output (a PowerShell thread prints the phrase; the command
// line itself is split so only the output matches).
const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
const paneId = started.paneId;
check(!!started.session?.running, 'shell started as a thread');
await wait(1500);

// the panel shell: PowerShell on Windows, bash elsewhere
const windows = /Windows/.test(navigator.userAgent);
window.TnaiAgents.send(
  paneId,
  windows
    ? "Write-Output ('e.g. \"usage limit' + ' reached\", \"5-hour limit' + ' reached · resets\"')"
    : "echo 'e.g. \"usage limit'' reached\", \"5-hour limit'' reached · resets\"'"
);
await wait(1500);
check(!A.limitFor(paneId), 'quoted limit phrases (an agent printing docs or code) are not a limit');
let fired = null;
window.addEventListener(
  'tnai:account-limit',
  e => {
    fired = e.detail;
  },
  { once: true }
);
window.TnaiAgents.send(
  paneId,
  windows
    ? "Write-Output ('Claude usage limit' + ' reached ∙ resets 3pm')"
    : "echo 'Claude usage limit'' reached ∙ resets 3pm'"
);
const limit = await until(() => A.limitFor(paneId), 8000);
check(
  !!limit && /usage limit reached/i.test(limit.text),
  'usage limit detected from pane output: ' + JSON.stringify(limit?.text)
);
check(!!fired && fired.paneId === paneId, 'tnai:account-limit event dispatched');
check(limit?.agent === 'Terminal', 'limit attributed to the pane’s own agent (Terminal here)');
window.TnaiAgents.stop(paneId);
await wait(400);
window.TnaiThreads.open();
await wait(200);

// Remove: Technically Not's folder goes, the default home's shared folder stays.
const removed = await A.remove(CLAUDE, account.id, { confirm: false });
check(removed?.removed === true, 'account folder removed');
check(removed?.sharedIntact === true, 'default ~/.claude/projects left intact');
check(
  (await N.dirFor(CLAUDE, account.id)) === '' && A.activeFor(CLAUDE) === '',
  'account gone and new sessions fall back to the default account'
);
return { ok, log };
