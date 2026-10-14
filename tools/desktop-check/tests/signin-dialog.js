// Technically Not tools · desktop-check/tests/signin-dialog.js — Provider sign-in dialog per CLI
// (Claude Code / Codex / Cursor Agent / OpenCode: provider named, browser sign-in, real login flags
// only) and grouping of signed-in emails across CLIs from stubbed data. The dialog is opened and
// cancelled: no login flow runs, no browser opens, no prompt is sent. Returns {ok, log}.
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
  G = window.TnaiAgents;
const overlay = () => document.querySelector('.tnai-signin-overlay'),
  modal = () => overlay()?.querySelector('.tnai-signin-modal');

check(
  !!(await until(() => A.list().length && A.list().every(d => 'signIn' in d))),
  'accounts list carries each CLI’s sign-in info'
);
const sessionsBefore = G.sessions().length;
window.TnaiSettings?.open('accounts');
await wait(200);

// sign-in states (read-only status commands) fill in the same-email chips
await until(() => A.identities().byEmail.length, 25000);

// Claude Code, adding an account: Anthropic's page in the browser, email hint, three sign-in types.
A.openSignIn('Claude Code', { adding: true });
await wait(100);
let m = modal();
check(!!m && !overlay().hidden, 'dialog opens for Claude Code');
check(
  /Add a Claude Code account/.test(m?.querySelector('h2')?.textContent || ''),
  'title says it adds a Claude Code account'
);
check(
  /Anthropic’s own sign-in page in your web browser/.test(m?.textContent || '') &&
    /not inside Technically Not/.test(m?.textContent || ''),
  'says Anthropic’s own page opens in the browser, not inside Technically Not'
);
check(
  /choose Google/.test(m?.textContent || ''),
  'Gmail users are told to choose Google on the provider page'
);
check(m?.querySelector('code')?.textContent === 'claude auth login', 'shows the real command');
check(
  !!m?.querySelector('input[name=label]') && !!m?.querySelector('input[name=email]'),
  'name and email fields shown'
);
check(
  [...(m?.querySelectorAll('input[name=method]') || [])].map(i => i.value).join() ===
    'claudeai,console,sso',
  'Claude sign-in types: subscription, Console, SSO'
);
check(
  /Open Anthropic sign-in/.test(m?.querySelector('.tnai-ws-close-confirm')?.textContent || ''),
  'confirm button names the provider'
);
const chip = m?.querySelector('[data-signin-email]');
if (chip) {
  chip.click();
  check(
    m.querySelector('input[name=email]').value === chip.dataset.signinEmail,
    'same-email chip fills the email hint'
  );
} else log.push('     (no signed-in email on this PC, same-email chip not shown)');
m.querySelector('input[name=email]').value = 'not an email';
m.requestSubmit();
await wait(100);
check(
  !overlay().hidden && !m.querySelector('.tnai-signin-error').hidden,
  'an invalid email is refused in the dialog'
);
console.log('TNAI_SHOT:signin-dialog-open');
await wait(600);
overlay().querySelector('.tnai-ws-close-cancel').click();
await wait(50);
check(overlay().hidden, 'Cancel closes the dialog');

// Codex: OpenAI, no email flag, browser or device code.
A.openSignIn('Codex', { accountId: '' });
await wait(100);
m = modal();
check(
  /Sign in to Codex/.test(m?.textContent || '') &&
    /OpenAI’s own sign-in page/.test(m?.textContent || ''),
  'Codex dialog names OpenAI’s page'
);
check(
  !m?.querySelector('input[name=email]') && !m?.querySelector('input[name=label]'),
  'Codex: no email or name field (no email flag; signing in an existing account)'
);
check(
  [...m.querySelectorAll('input[name=method]')].map(i => i.value).join() === 'browser,device',
  'Codex sign-in types: browser, device code'
);
overlay().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(50);
check(overlay().hidden, 'Escape closes the dialog');

// Cursor Agent and OpenCode.
A.openSignIn('Cursor Agent', { accountId: '' });
await wait(100);
m = modal();
check(
  /Cursor’s own sign-in page/.test(m?.textContent || '') && !m.querySelector('fieldset'),
  'Cursor dialog names Cursor’s page, no method choice'
);
overlay().click();
await wait(50);
check(overlay().hidden, 'clicking outside closes the dialog');
A.openSignIn('Cursor Agent', { switching: true });
await wait(100);
m = modal();
check(
  /Switch Cursor Agent account/.test(m?.querySelector('h2')?.textContent || '') &&
    /cursor-agent logout, then cursor-agent login/.test(m.textContent) &&
    m.querySelector('.tnai-ws-close-confirm')?.textContent === 'Sign out and switch',
  'Cursor Switch account dialog names logout then login (cancelled, nothing runs)'
);
overlay().querySelector('.tnai-ws-close-cancel').click();
await wait(50);
A.openSignIn('OpenCode', { accountId: '' });
await wait(100);
m = modal();
check(
  /Pick the AI provider there/.test(m?.textContent || '') &&
    m.querySelector('code')?.textContent === 'opencode auth login',
  'OpenCode dialog explains the in-terminal provider pick'
);
overlay().querySelector('.tnai-ws-close-cancel').click();
await wait(50);
check(G.sessions().length === sessionsBefore, 'no sign-in pane was started');

// Email grouping across CLIs, from stubbed data (no real accounts touched).
const stub = [
  {
    agentId: 'Claude Code',
    supported: true,
    accounts: [
      {
        id: '',
        isDefault: true,
        status: { loggedIn: true, email: 'You@Gmail.com', method: 'claude.ai · Max' },
      },
      {
        id: 'acct-1',
        label: 'Work',
        status: { loggedIn: true, email: 'me@work.example', method: 'console' },
      },
      { id: 'acct-2', label: 'Spare', status: { loggedIn: false, email: '', method: '' } },
    ],
  },
  {
    agentId: 'Codex',
    supported: true,
    accounts: [
      { id: '', isDefault: true, status: { loggedIn: true, email: '', method: 'ChatGPT' } },
    ],
  },
  { agentId: 'Cursor Agent', supported: false, accounts: [{ id: '', isDefault: true }] },
  { agentId: 'OpenCode', supported: false, accounts: [{ id: '', isDefault: true }] },
];
const infos = [
  { id: 'Cursor Agent', loggedIn: true, account: 'you@gmail.com', method: '' },
  { id: 'OpenCode', loggedIn: false, account: '', method: '' },
];
const ids = A.identities(stub, infos);
log.push('     identities: ' + JSON.stringify(ids));
const gmail = ids.byEmail.find(g => g.email === 'you@gmail.com');
check(
  gmail?.uses.map(u => u.agentId).join() === 'Claude Code,Cursor Agent',
  'same Gmail on Claude Code and Cursor Agent grouped as one identity (case-insensitive)'
);
check(ids.byEmail[0]?.email === 'you@gmail.com', 'shared identity listed first');

// Emails are masked outside Settings (full there), including emails used as account names.
const mask = window.tnaiMaskEmails,
  cases = [
    ['lindsay@gmail.com', 'l*****y@gmail.com'],
    ['a@gmail.com', '*****@gmail.com'],
    ['jo@outlook.com', '*****@outlook.com'],
    ['bob@icloud.com', '*****@icloud.com'],
    ['sam.jones+tnai@gmail.com', 's*****s@gmail.com'],
    ['averyveryverylongname@yahoo.com', 'a*****e@yahoo.com'],
    ['me@work.example', '*****@w***.example'],
    ['bob@x.io', '*****@***.io'],
    ['Work · Pat@Company.co.uk', 'Work · *****@C***.co.uk'],
  ];
const wrong = cases
  .filter(([i, o]) => mask(i) !== o)
  .map(([i, o]) => i + ' → ' + mask(i) + ' (want ' + o + ')');
check(
  !wrong.length,
  'emails masked by size and domain: ' + (wrong.join('; ') || cases.map(c => c[1]).join(', '))
);
check(
  window.tnaiMaskName('Lee  Olsen') === 'L***** O*****' &&
    window.tnaiMaskHandle('lindsay') === 'l*****y' &&
    window.tnaiMaskHandle('bob') === '*****',
  'display names and usernames masked: L***** O*****, l*****y, *****'
);
check(
  typeof A.label === 'function' && A.label.length === 2,
  'account labels are always masked (no full flag, Settings included)'
);
check(
  !/[A-Za-z0-9._%+-]*[A-Za-z0-9]@[A-Za-z0-9-]+\.[A-Za-z]{2,}/.test(
    (document.getElementById('tnaiAccountsMount')?.textContent || '').replace(
      /[A-Za-z0-9]?\*{5}[^@\s]*@/g,
      ''
    )
  ),
  'Settings › Accounts shows no full email'
);
check(
  ids.byEmail.find(g => g.email === 'me@work.example')?.uses[0]?.account === 'Work',
  'added account keeps its Technically Not name'
);
check(
  ids.other.length === 1 && ids.other[0].agentId === 'Codex' && ids.other[0].method === 'ChatGPT',
  'Codex (no email reported) listed apart with its sign-in method'
);
check(
  !JSON.stringify(ids).includes('Spare') && !JSON.stringify(ids).includes('OpenCode'),
  'signed-out accounts left out'
);
return { ok, log };
