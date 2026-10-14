// Technically Not tools · desktop-check/tests/settings-page.js — Settings route with an Accounts
// tab (CLIs, accounts, add/rename/remove a test account without sign-in; last tab remembered), no
// separate Accounts nav item, accounts gone from Overview; then 8 PowerShell panes on Overview:
// cards don't overlap, several columns, no horizontal scroll. No prompt is sent to any agent.
// Returns {ok, log}.
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
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const A = window.TnaiAccounts,
  G = window.TnaiAgents,
  CLAUDE = 'Claude Code',
  layout = document.querySelector('.layout');
const page = document.getElementById('settingsPage'),
  mount = () => document.getElementById('tnaiAccountsMount');

// Settings route.
window.TnaiRoute('settings');
await until(() => layout.classList.contains('settings-mode') && page?.offsetParent, 3000);
check(layout.classList.contains('settings-mode') && !!page?.offsetParent, 'Settings page shown');
check(
  document.querySelector('.side-item[data-view="settings"]').classList.contains('active'),
  'Settings nav item active'
);
check(
  !!page.querySelector('#settingsPanel-accounts:not([hidden]) #tnaiAccountsMount'),
  'Accounts tab shown with the accounts UI'
);
check(
  page.querySelector('.settings-tabs [data-tab="accounts"]')?.getAttribute('aria-selected') ===
    'true',
  'Accounts tab selected'
);
check(localStorage.getItem('tnai.settings-tab.v1') === 'accounts', 'last tab remembered');
check(
  !document.querySelector('.side-item[data-ai-tool="accounts"]'),
  'no separate Accounts nav item'
);
check(
  !document.querySelector('#agentPage #tnaiAccountsMount'),
  'Overview no longer shows accounts'
);

// CLIs and accounts listed.
check(
  !!(await until(
    () => A.list().length && mount().querySelectorAll('[data-cli]').length >= A.list().length
  )),
  'every CLI listed (' + mount().querySelectorAll('[data-cli]').length + ')'
);
check(
  !!mount().querySelector('[data-cli="' + CLAUDE + '"] [data-account=""]'),
  'Claude Code default account row shown'
);

// ＋ Add account opens an inline row in that CLI's card (no dialog); typing survives a live
// re-render; Esc closes it.
const card = () => mount().querySelector('[data-cli="' + CLAUDE + '"]');
card().querySelector('[data-acct="add"]')?.click();
await until(() => {
  const i = card().querySelector('.tnai-acct-addrow input[name=label]');
  return i && document.activeElement === i;
}, 3000);
const addInput = card().querySelector('.tnai-acct-addrow input[name=label]');
check(
  !!addInput &&
    document.activeElement === addInput &&
    !document.querySelector('.tnai-signin-overlay:not([hidden])'),
  'Add account opens an inline name row in the card (focused, no dialog)'
);
if (addInput) {
  addInput.value = 'Inline name';
  A.refresh(false);
  await wait(400);
}
check(
  card().querySelector('.tnai-acct-addrow input')?.value === 'Inline name',
  'typed name kept across a re-render'
);
await shot('settings-add-inline');
card()
  .querySelector('.tnai-acct-addrow input')
  ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(100);
check(
  !card().querySelector('.tnai-acct-addrow') &&
    document.activeElement === card().querySelector('[data-acct="add"]'),
  'Esc closes the row and returns focus to ＋ Add account'
);

// Add (no sign-in), rename through the real button + prompt dialog, remove.
const account = await A.add(CLAUDE, { label: 'Settings test account', signIn: false });
check(!!account?.id, 'test account added');
const row = await until(
  () => mount().querySelector('[data-cli="' + CLAUDE + '"] [data-account="' + account.id + '"]'),
  5000
);
check(!!row && /Settings test account/.test(row.textContent), 'new account listed on Settings');
row?.querySelector('[data-acct="rename"]')?.click();
check(
  !!(await until(
    () =>
      /Named by test/.test(
        mount().querySelector('[data-account="' + account.id + '"]')?.textContent || ''
      ),
    8000
  )),
  'renamed from its Rename button'
);
await shot('settings');
check(!!(await A.remove(CLAUDE, account.id, { confirm: false })), 'test account removed');
check(
  !!(await until(() => !mount().querySelector('[data-account="' + account.id + '"]'), 5000)),
  'removed account gone from the list'
);

// Agents tab: two columns of groups, sub-options fold away with their switch, segmented choices and
// mini-switch chips; light and dark shots.
window.TnaiSettings.open('agents');
const ap = document.getElementById('settingsPanel-agents');
await until(
  () =>
    ap.querySelector('#agentsColA .tnai-next-set') &&
    ap.querySelector('#agentsColB .tnai-upkeep-set') &&
    (!window.tnaiNative?.graph ||
      ap.querySelector('.sa-pane[data-sa-pane="deleg"] #tnaiDelegationMount')),
  3000
);
check(
  !!ap.querySelector('#agentsColA .tnai-next-set') &&
    !!ap.querySelector('#agentsColB .tnai-upkeep-set') &&
    ap.querySelector('#agentsColA')?.firstElementChild?.classList.contains('tnai-next-set'),
  'Agents: After an agent finishes leads column A, Agent context in column B'
);
check(
  !window.tnaiNative?.graph ||
    ap.querySelector('.sa-pane[data-sa-pane="deleg"] #tnaiDelegationMount'),
  'Agents: Delegation limits have their own section (purple redesign)'
);
document.querySelector('#saTab-finish')?.click();

// sections are tabs now: show After an agent finishes
await until(() => ap.querySelector('.tnai-next-set #notificationSounds')?.offsetParent, 3000);
{
  // Notification sounds lives here (moved off the composer); same storage key, read by
  // TnaiNotify.play (03).
  const snd = ap.querySelector('.tnai-next-set #notificationSounds'),
    was = window.TnaiNotify?.enabled();
  check(
    !!snd && !document.querySelector('.composer #notificationSounds') && snd.checked === was,
    'Agents: Notification sounds checkbox is under After an agent finishes, not in the composer'
  );
  snd?.click();
  check(
    window.TnaiNotify?.enabled() === !was &&
      localStorage.getItem('tnai.notificationSounds.v1') === (!was ? 'on' : 'off'),
    'Agents: Notification sounds click saves the choice'
  );
  snd?.click();
  check(window.TnaiNotify?.enabled() === was, 'Agents: Notification sounds click restores it');
}
const NA = window.TnaiNextActions,
  before = NA?.prefs();
NA?.set({ cards: true, auto: false });
check(
  !!ap.querySelector('.tnai-next-size')?.offsetParent &&
    !ap.querySelector('.tnai-next-auto')?.offsetParent,
  'Agents: sub-options shown only under switches that are on'
);
await shot('settings-agents');
NA?.set({ auto: true, steps: 'all' });
await wait(100);
check(
  ap.querySelector('[data-k=steps][value=all]')?.checked &&
    !!ap.querySelector('.tnai-next-auto')?.offsetParent,
  'Agents: automatic mode opens its options; Send is a segmented choice'
);
ap.querySelector('[data-k=steps][value=first]').click();
await wait(50);
check(NA?.prefs().steps === 'first', 'Agents: clicking a segment saves it');
const theme = window.TnaiTheme.get();
window.TnaiTheme.set('dark');
await wait(300);
await shot('settings-agents-dark');
window.TnaiTheme.set(theme);
if (before) NA.set(before);
await wait(100);

// Layout of every Settings section and Agents sub-tab (padding, symmetry, no
// overlap): controls stay inside their row's padding and share one right edge, number inputs share
// both edges, a caption sits clear above its card, nothing draws a box around the Agents card.
let mainId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++mainId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const box = e => e.getBoundingClientRect(),
  seen = e => !!e.offsetParent && box(e).width > 0,
  spread = list =>
    list.length ? Math.round((Math.max(...list) - Math.min(...list)) * 10) / 10 : 0;
const layoutOk = (panel, label) => {
  const rows = [...panel.querySelectorAll('.set-row')].filter(seen),
    bad = [],
    rights = [];
  for (const row of rows) {
    const ctl = [...row.children].find(c => !c.classList.contains('set-text'));
    if (!ctl) continue;
    const cs = getComputedStyle(row),
      inner = box(row).right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
    if (
      box(ctl).right > inner + 0.5 ||
      ctl.scrollWidth > ctl.clientWidth + 1 ||
      parseFloat(cs.paddingTop) !== parseFloat(cs.paddingBottom)
    )
      bad.push(row.querySelector('b')?.textContent);
    rights.push(box(ctl).right);
  }
  check(
    !bad.length,
    label +
      ': every control inside its row, equal top and bottom padding' +
      (bad.length ? ' (not: ' + bad.join(', ') + ')' : '')
  );
  check(
    spread(rights) <= 1,
    label +
      ': controls share one right edge (spread ' +
      spread(rights) +
      'px over ' +
      rights.length +
      ' rows)'
  );
  const nums = [...panel.querySelectorAll('input.set-num')].filter(seen).map(box);
  check(
    spread(nums.map(b => b.left)) <= 1 && spread(nums.map(b => b.right)) <= 1,
    label + ': number inputs share both edges (' + nums.length + ')'
  );
  const caps = [...panel.querySelectorAll('.sa-cap, .set-group-head')].filter(seen),
    next = c => c.nextElementSibling || c.parentElement.nextElementSibling;
  check(
    caps.every(c => !next(c) || !seen(next(c)) || box(next(c)).top - box(c).bottom >= 6),
    label + ': group labels sit clear above their cards'
  );
  check(page.scrollWidth <= page.clientWidth + 1, label + ': no sideways scroll');
};
for (const tab of window.TnaiSettings.tabs()) {
  if (tab === 'accounts' || tab === 'usage') continue; // their own tests: accounts, usage-stats
  window.TnaiSettings.open(tab);
  await wait(250);
  const panel = document.getElementById('settingsPanel-' + tab);
  if (tab !== 'agents') {
    layoutOk(panel, 'Layout ' + tab);
    continue;
  }
  for (const sec of ['work', 'finish', 'deleg', 'context']) {
    document.getElementById('saTab-' + sec).click();
    await until(() => !panel.querySelector(`[data-sa-pane="${sec}"]`).hidden, 2000);
    await wait(350);
    layoutOk(panel, 'Layout agents › ' + sec);
  }
  check(
    [...panel.querySelectorAll('.set-card')].every(
      c => getComputedStyle(c, '::before').content === 'none'
    ),
    'Agents: no cursor spotlight box around a card wrapper (it framed the caption on hover and while selecting text)'
  );
  const U = window.TnaiContextUpkeep,
    was = U?.prefs();
  if (U) {
    U.set({ on: true, never: false, compact: 2000000, clear: 2000000, handoff: 2000000 });
    await wait(150);
    const big = [...panel.querySelectorAll('.tnai-upkeep-set input.set-num')].filter(seen);
    check(
      big.every(i => i.scrollWidth <= i.clientWidth + 1),
      'Agents › context: the largest value (2000000) fits its number input'
    );
    await shot('settings-context-long');
    U.set({ never: true });
    await wait(100);
    check(
      panel.querySelector('[data-k=clear]').disabled,
      'Agents › context: Never clear grays out Clear at'
    );
    layoutOk(panel, 'Layout agents › context, Never clear on');
    const hSub = Math.round(
      spread(
        [...panel.querySelectorAll('.tnai-upkeep-set .set-sub > .set-row')]
          .filter(seen)
          .filter(r => !r.querySelector('small') || box(r.querySelector('small')).height < 20)
          .map(r => box(r).height)
      )
    );
    check(
      hSub <= 1,
      'Agents › context: rows with one help line and rows with none are the same height (spread ' +
        hSub +
        'px)'
    );
    U.set({ on: false });
    await wait(150);
    layoutOk(panel, 'Layout agents › context, suggestions off');
    U.set(was);
  }
  await main('size', 768, 680);
  await wait(500); // the window minimum: the section list becomes a row of tabs
  const bar = page.querySelector('.settings-tabs');
  check(
    bar.scrollWidth <= bar.clientWidth + 1,
    'At 768×680 every Settings section tab fits the row (' +
      bar.scrollWidth +
      '/' +
      bar.clientWidth +
      ')'
  );
  layoutOk(panel, 'Layout agents › context at 768×680');
  page.scrollTop = 0;
  await shot('settings-context-768');
  await main('size', 1440, 900);
  await wait(500);
}

// TnaiSettings.open lands on a tab from anywhere.
window.TnaiThreads.open();
await wait(150);
check(
  window.TnaiSettings?.open('accounts') === 'accounts' &&
    layout.classList.contains('settings-mode'),
  'TnaiSettings.open shows the Accounts tab'
);
G.sessions().forEach(s => G.stop(s.paneId));

// Let the shells finish closing: exiting the app mid-teardown crashed it (0xC0000409) after RESULT:
// PASS.
await until(() => !G.sessions().some(s => s.running), 10000);
await wait(300);
return { ok, log };
