/*
 * Technically Not tools · desktop-check/tests/api-keys.js — API-key accounts:
 * a fake key added through Settings › Accounts is stored encrypted (never
 * in plain text), only its last 4 characters come back to the page, a Claude Code panel on that
 * account sends it to a local stand-in server (api-keys.main.js) without the question "use this API
 * key?", the key is never on the command line or in panel records, a bad key is refused, Codex's
 * account gets its provider file, and Remove deletes it all.
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
const A = window.TnaiAccounts,
  N = window.tnaiNative.accounts,
  CLAUDE = 'Claude Code';
const KEY = 'sk-ant-api03-TNAITEST' + Math.random().toString(36).slice(2, 12).toUpperCase() + 'Zz9';
const cliEntry = async id =>
  (await N.list({ withStatus: true, force: true })).value.find(d => d.agentId === id);

check(!!(await until(() => A.list().length)), 'accounts list loaded');
const claudeCap = A.list().find(d => d.agentId === CLAUDE)?.apiKey;
check(
  claudeCap?.provider === 'Anthropic' && !claudeCap.unavailable,
  'Claude Code offers an API key, and this computer can keep one: ' + JSON.stringify(claudeCap)
);
check(!!A.list().find(d => d.agentId === 'Codex')?.apiKey, 'Codex offers an API key');
check(
  !A.list().find(d => d.agentId === 'Cursor Agent')?.apiKey,
  'Cursor Agent does not (not verified yet)'
);

// Through the UI: Settings › Accounts › ＋ Add API key, a wrong key first.
window.TnaiRoute('settings');
await wait(150);
document.querySelector('.settings-tabs [aria-controls="settingsPanel-accounts"]')?.click();
const addBtn = await until(
  () => document.querySelector('#tnaiAccountsMount [data-cli="Claude Code"] [data-acct=addkey]'),
  8000
);
check(!!addBtn, '＋ Add API key button on the Claude Code card');
addBtn?.click();
const field = await until(() => document.getElementById('tnaiAcctKey'), 3000);
check(
  field?.type === 'password' && document.activeElement === field,
  'key field is a focused password field'
);
field.value = 'sk-proj-notanthropic0123456789';
field.closest('form').requestSubmit();
const err = await until(
  () => document.querySelector('#tnaiAccountsMount .tnai-acct-keyerror:not([hidden])')?.textContent,
  5000
);
check(
  /start with sk-ant-/.test(err || ''),
  'a key of the wrong provider is refused: ' + JSON.stringify(err)
);
console.log('TNAI_SHOT:api-key-form');
await wait(500);
document.getElementById('tnaiAcctKey').value = KEY;
document.getElementById('tnaiAcctKey').closest('form').requestSubmit();
const row = await until(
  async () => (await cliEntry(CLAUDE)).accounts.find(a => a.kind === 'api-key'),
  8000
);
check(!!row && row.label === 'API key', 'API-key account added');
check(
  row?.status?.loggedIn === true &&
    row.status.apiKey?.last4 === KEY.slice(-4) &&
    row.status.plan === 'API key',
  'it reads as ready, showing only the last 4 characters'
);
check(
  !JSON.stringify(row || {}).includes(KEY.slice(0, 20)),
  'the list sent to the page holds no more of the key'
);
check(!document.getElementById('tnaiAcctKey'), 'the key row closes after saving');
await until(
  () =>
    document.querySelector('#tnaiAccountsMount [data-account="' + row?.id + '"] [data-acct=rekey]'),
  5000
);
check(
  /ending [^ ]*$/.test(
    document.querySelector(
      '#tnaiAccountsMount [data-account="' + row?.id + '"] .tnai-acct-name small'
    )?.textContent || ''
  ),
  'row says the key is pay per use, ending in its last 4'
);
console.log('TNAI_SHOT:api-key-row');
await wait(500);

// Layout: the card with the API-key row fits its column (nothing clipped at the right edge), and
// the key row keeps its name visible.
const card = document.querySelector('#tnaiAccountsMount [data-cli="Claude Code"]'),
  keyRowEl = card?.querySelector('[data-account="' + row?.id + '"]');
const wide = [...(card?.querySelectorAll('*') || [])]
  .filter(el => el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1)
  .map(el => el.className || el.tagName)
  .slice(0, 6);
check(
  card && card.scrollWidth <= card.clientWidth + 1 && !wide.length,
  'Claude Code card fits its column: ' +
    JSON.stringify({ scroll: card?.scrollWidth, client: card?.clientWidth, wide })
);
check(
  (keyRowEl?.querySelector('.tnai-acct-name')?.getBoundingClientRect().width || 0) > 80,
  'API-key row name is visible: ' +
    Math.round(keyRowEl?.querySelector('.tnai-acct-name')?.getBoundingClientRect().width || 0) +
    'px'
);

// Dark theme: the key row and its add link (screenshot), then back to Light.
window.TnaiSettings.open('appearance');
await wait(200);
document.querySelector('#tnaiAppearanceMount input[value="dark"]')?.click();
await wait(300);
window.TnaiSettings.open('accounts');
await wait(300);
document.querySelector('#tnaiAccountsMount [data-cli="Claude Code"] [data-acct=addkey]')?.click();
await wait(300);
console.log('TNAI_SHOT:api-key-dark');
await wait(500);
document.querySelector('#tnaiAccountsMount [data-acct=key-cancel]')?.click();
window.TnaiSettings.open('appearance');
await wait(200);
document.querySelector('#tnaiAppearanceMount input[value="light"]')?.click();
await wait(300);
window.TnaiSettings.open('accounts');
await wait(300);

const disk = await main('disk', row.dir, KEY);
check(
  disk.binExists && !disk.plainKeyStored,
  'api-keys.bin exists and no file holds the key in plain text'
);
check(
  disk.claudeApprovedLast20 && !disk.claudeHasWholeKey && disk.onboarded,
  'the account’s .claude.json approves the key (last 20 only) and skips first-run screens'
);

// A real Claude Code panel on that account: the key reaches the stand-in server as x-api-key.
await main('startServer');
await main('trustProject', row.dir);
const opened = await window.TnaiTest.open(CLAUDE, { accountId: row.id, mode: 'run' });
check(opened?.ok, 'Claude Code panel started on the API-key account');
const session = await until(
  () => window.TnaiAgents.sessions().find(s => s.paneId === opened?.paneId && s.running),
  15000
);
check(
  !!session && !String(session.commandLine || '').includes(KEY.slice(-12)),
  'the key is not on the command line'
);

// A CLI's screen is read where a user sees it, the CLI screen of its thread, from the terminal
// itself ('' while that thread's screen is not the one shown).
const showScreen = async paneId => {
  window.TnaiThreads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await until(() => window.TnaiThreadView.term()?.tnaiPaneId === paneId, 6000);
};
const screenOf = paneId => {
  const term = window.TnaiThreadView.term();
  if (!term || term.tnaiPaneId !== paneId) return '';
  const buffer = term.buffer.active;
  let text = '';
  for (let row = 0; row < buffer.length; row++)
    text += (buffer.getLine(row)?.translateToString(true) || '') + ' ';
  return text;
};
await showScreen(opened?.paneId);
await wait(6000);
const screen = () => screenOf(opened?.paneId);
check(
  screen().trim().length > 0,
  'the CLI screen of its thread shows Claude Code (' + screen().trim().length + ' characters)'
);
check(!/Do you want to use this API key/i.test(screen()), 'no "use this API key?" question');
window.TnaiAgents.send(opened.paneId, 'hi');
const hit = await until(
  async () => (await main('requests')).find(r => r.method === 'POST' && r.key),
  30000
);
check(
  hit?.key === KEY.slice(-6),
  'Claude Code sent the account’s key to the API: ' + JSON.stringify(hit)
);
window.TnaiAgents.stop(opened.paneId);
await wait(800);
check((await main('recordsHold', KEY)).length === 0, 'no file in the app’s data holds the key');

// Replace it; then a Codex key account gets its provider file; then Remove deletes key and folder.
const KEY2 = KEY.slice(0, -3) + 'Yy8';
const replaced = await N.setKey(CLAUDE, row.id, KEY2);
check(
  replaced.ok &&
    replaced.value.last4 === KEY2.slice(-4) &&
    (await cliEntry(CLAUDE)).accounts.find(a => a.id === row.id)?.status?.apiKey?.last4 ===
      KEY2.slice(-4),
  'Replace key updates the saved key'
);
const bad = await N.addKey(CLAUDE, '', 'sk-ant-has space ' + KEY);
check(!bad.ok, 'a key with spaces is refused');
const cx = await N.addKey('Codex', '', 'sk-proj-TNAITEST' + 'x'.repeat(30));
check(
  cx.ok &&
    /env_key = "TNAI_OPENAI_API_KEY"/.test(
      (await main('disk', cx.value.dir, 'unused-key-value')).codexConfig
    ),
  'Codex API-key account gets a provider reading TNAI_OPENAI_API_KEY'
);
if (cx.ok) {
  // A real Codex panel on that account, its provider pointed at the stand-in: the key arrives as
  // the bearer token, with no sign-in screen.
  await main('codexToStandIn', cx.value.dir);
  const cxOpen = await window.TnaiTest.open('Codex', { accountId: cx.value.id, mode: 'run' });
  check(cxOpen?.ok, 'Codex panel started on the API-key account');
  await showScreen(cxOpen?.paneId);
  const cxScreen = () => screenOf(cxOpen?.paneId);
  await until(() => /Ask Codex|Trust this folder|Trust and continue/i.test(cxScreen()), 30000);
  check(
    !/Sign in with ChatGPT|Provide your own API key/i.test(cxScreen()),
    'no Codex sign-in screen'
  );
  if (/Trust and continue|Trust this folder/i.test(cxScreen())) {
    window.tnaiNative.pty.write(cxOpen.paneId, '\r');
    await until(() => /Ask Codex/i.test(cxScreen()), 15000);
  }

  // A profile whose step hook was never trusted: Codex (0.162) asks about it on a screen of its
  // own. The prompt must wait there, not be typed into that screen, and go out once it is answered.
  const asks = () => /Trust all and continue/i.test(cxScreen());
  const asksAtStart = !!(await until(asks, 6000));
  log.push('info Codex opens with its choice about a new hook: ' + asksAtStart);
  if (asksAtStart) {
    const items = () => window.tnaiNative.attention.list();
    const item = await until(
      async () => (await items()).items.find(i => i.paneId === cxOpen.paneId),
      6000
    );
    const matcher = await main('question', cxOpen.paneId);
    check(
      /choose 2 to trust it/.test(item?.detail || ''),
      'the app shows it as a question for the user and says which number answers it: "' +
        (item?.detail || '') +
        '"' +
        (item ? '' : ' · the matcher read ' + JSON.stringify(matcher).slice(0, 700))
    );
    window.TnaiAgents.send(cxOpen.paneId, 'hi');
    await wait(3000);
    const held = (await items()).held.filter(h => h.paneId === cxOpen.paneId);
    check(
      asks() && held.length === 1 && !(await main('requests')).find(r => r.bearer),
      'a prompt sent meanwhile is held: the choice still stands, ' +
        held.length +
        ' held, nothing sent to the model'
    );

    // The user's answer: 2, trust the hook and go on.
    window.tnaiNative.pty.write(cxOpen.paneId, '2');
    await wait(1200);
    if (asks()) window.tnaiNative.pty.write(cxOpen.paneId, '\r');
    check(!!(await until(() => !asks(), 8000)), 'the choice is answered with 2 and goes away');
  } else {
    window.TnaiAgents.send(cxOpen.paneId, 'hi');
  }
  const cxHit = await until(async () => (await main('requests')).find(r => r.bearer), 40000);
  check(
    cxHit?.bearer === ('sk-proj-TNAITEST' + 'x'.repeat(30)).slice(-6),
    'Codex sent the account’s key as its bearer token: ' + JSON.stringify(cxHit)
  );
  if (!cxHit) log.push('     codex screen: ' + cxScreen().replace(/\s+/g, ' ').slice(-400));
  window.TnaiAgents.stop(cxOpen.paneId);
  await wait(1500);
  await A.remove('Codex', cx.value.id, { confirm: false });
}
const removed = await A.remove(CLAUDE, row.id, { confirm: false });
check(removed?.removed === true, 'Remove deletes the account folder');
check(
  !(await main('disk', row.dir, KEY2)).binExists,
  'and the key (api-keys.bin gone with the last key)'
);
return { ok, log };
