// Technically Not tools · desktop-check/tests/no-agents-page.js — the old "Agents and history"
// page is out of the app's paths. Two PowerShell threads are opened (no agent CLI, no prompt).
// Checked: the three-dots menu has no such row, and Ctrl+K (the menu's search) and the command
// menu offer no such page; a route to the page (the router, the old navigation's hidden item, the
// activity line) ends on the Threads page; every "go to this agent" opens that agent's thread (a
// stuck-loop notice in the bell, a press on a Windows notification, an agent's card, a sub-agent's
// arrow, the function the other callers use), and one for an agent with no thread ends on the
// Threads page; the folder-trust question shows in the open thread and its button answers it.
// Through the whole test the layout's classes are watched: it never has `agents-mode`.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const layout = document.querySelector('.layout');
const shown = el => !!el && el.getClientRects().length > 0;
const sessionOf = paneId => agents.sessions().find(session => session.paneId === paneId);
const OLD_CLASS = 'agents-mode';
const OLD_NAME = /agents (and|&) history/i;

// Every change of the layout's classes, from here to the end: the old page's class must never be
// among them, not even for the moment between two changes (the value before each change is read
// too).
let sawOldClass = layout.classList.contains(OLD_CLASS);
const classWatch = new MutationObserver(records => {
  for (const record of records) {
    const before = ' ' + (record.oldValue || '') + ' ';
    if (before.includes(' ' + OLD_CLASS + ' ') || layout.classList.contains(OLD_CLASS))
      sawOldClass = true;
  }
});
classWatch.observe(layout, {
  attributes: true,
  attributeFilter: ['class'],
  attributeOldValue: true,
});

// The Threads page shows, and nothing of the old page does.
const onThreads = () =>
  threads.visible() &&
  layout.classList.contains('threads-mode') &&
  !layout.classList.contains(OLD_CLASS) &&
  !shown(document.getElementById('agentsPage'));
const otherPage = async view => {
  window.TnaiRoute(view);
  await until(() => !threads.visible(), 3000);
  await wait(150);
  return !threads.visible();
};

const opened = [];
try {
  await agents.detect(true);
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const first = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(!!(await until(() => sessionOf(first)?.running)), 'setup: a first PowerShell thread runs');
  if (first) opened.push(first);
  const second = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(
    !!(await until(() => sessionOf(second)?.running)),
    'setup: a second PowerShell thread runs'
  );
  if (second) opened.push(second);
  threads.open();
  await until(() => threads.visible(), 4000);
  check(
    !!(await until(
      () => window.TnaiThreadList?.thread?.(first) && window.TnaiThreadList?.thread?.(second),
      6000
    )),
    'setup: both are threads of the list'
  );

  // ---- the three-dots menu ----
  const menuButton = document.querySelector('.top .tnt-menu-btn');
  const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
  const labels = () =>
    [...menu().querySelectorAll('.tnt-menu-row')]
      .filter(shown)
      .map(row => row.querySelector('span')?.textContent || '');
  menuButton.click();
  await until(() => shown(menu()), 3000);
  const menuRows = labels();
  check(
    menuRows.length > 4 && !menuRows.some(label => OLD_NAME.test(label)),
    'the menu has no "Agents and history" row (' + menuRows.join(', ') + ')'
  );
  check(
    ![...menu().querySelectorAll('.tnt-menu-row')].some(row => OLD_NAME.test(row.textContent)),
    'and no hidden one a search could bring up'
  );
  check(menuRows.includes('Threads'), 'it has "Threads"');
  window.TnaiThreadMenu.close();

  // ---- Ctrl+K: the menu's search ----
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
  );
  await until(() => shown(menu()), 3000);
  const search = menu()?.querySelector('.tnt-menu-search input');
  check(
    shown(menu()) && document.activeElement === search,
    'Ctrl+K opens the menu with its search field'
  );
  const find = async text => {
    search.value = text;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(80);
    return labels();
  };
  const forAgents = await find('agents');
  check(
    forAgents.includes('Threads') && !forAgents.some(label => OLD_NAME.test(label)),
    'typing "agents" offers Threads and no Agents page (' + forAgents.join(', ') + ')'
  );
  const forHistory = await find('history');
  check(
    !forHistory.some(label => OLD_NAME.test(label)),
    'typing "history" offers no such page (' + (forHistory.join(', ') || 'nothing') + ')'
  );
  window.TnaiThreadMenu.close();

  // The command menu (the row "Command menu" of the search) lists commands, never that page.
  window.TnaiPalette?.open();
  await wait(250);
  const palette = document.querySelector('.tnai-pal-overlay');
  const paletteInput = palette?.querySelector('.tnai-pal-input');
  if (paletteInput) {
    paletteInput.value = 'agents';
    paletteInput.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(250);
  }
  check(
    !!palette && !OLD_NAME.test(palette.textContent),
    'the command menu offers no Agents page either'
  );
  window.TnaiPalette?.close();

  // ---- a route to the page ends on Threads ----
  check(await otherPage('settings'), 'setup: the Settings page shows');
  window.TnaiRoute('agents');
  check(onThreads(), "TnaiRoute('agents') ends on the Threads page at once");
  await wait(300);
  check(onThreads(), 'and it stays there');

  check(await otherPage('skills'), 'setup: the Skills page shows');
  document.querySelector('.side-item[data-view="agents"]')?.click();
  await wait(300);
  check(onThreads(), "the old navigation's hidden Agents item ends on the Threads page");

  check(!window.TnaiAgentsPage, "the old page's own script is no longer loaded");

  const activityLine = document.getElementById('activityToggle');
  if (activityLine) {
    check(await otherPage('settings'), 'setup: the Settings page shows again');
    activityLine.click();
    await wait(300);
    check(onThreads(), 'a press on the activity line ends on the Threads page');
  }

  // ---- "go to this agent" opens its thread ----
  const openThread = () => threads.selected();
  const reaches = paneId => until(() => onThreads() && openThread() === paneId, 4000);

  // A stuck-loop notice in the bell, with its "Go to it" button (85).
  threads.show(first);
  check(await otherPage('skills'), 'setup: on the Skills page, the first thread chosen');
  const now = Date.now();
  await main('loop', {
    id: 'no-agents-page-loop',
    paneId: second,
    on: true,
    since: now - 420000,
    at: now,
    repeats: 12,
    period: 1,
    tools: ['Read'],
  });
  const bell = window.TnaiNextActions;
  const notice = () => {
    bell.openBell(true);
    return [...document.querySelectorAll('.tnai-bell-pop .tnai-nitem')].find(item =>
      /may be stuck in a loop/.test(item.querySelector('.n-who b')?.textContent || '')
    );
  };
  const row = await until(notice, 4000);
  check(!!row, 'setup: a stuck-loop notice is in the bell');
  row?.click();
  await wait(150);
  const goButton = notice()?.querySelector('[data-act="notice"]');
  check(goButton?.textContent === 'Go to it', 'it has the button "Go to it"');
  goButton?.click();
  check(!!(await reaches(second)), 'the bell notice\'s "Go to it" opens that agent\'s thread');
  bell.openBell(false);
  await main('loop', { id: 'no-agents-page-loop', paneId: second, on: false });

  // A press on a Windows notification (71 `jump`, pushed by the main process).
  check(await otherPage('settings'), 'setup: the Settings page shows');
  await main('jump', first);
  check(!!(await reaches(first)), "a pressed notification opens that agent's thread");

  // The old grid of 11 builds no cards while it is off screen (speed lead 8), so there is no card
  // to press.
  check(await otherPage('skills'), 'setup: the Skills page shows');
  check(
    !document.querySelector('.tnai-card[data-pane="' + CSS.escape(second) + '"]'),
    'the hidden old grid has no card for the agent'
  );

  // A sub-agent's arrow on its lead's card (19). No sub-agent runs here, so the arrow is made up
  // with the markup 19 gives it; the handler that takes the press is the app's own.
  check(await otherPage('devices'), 'setup: the Devices page shows');
  const madeUp = document.createElement('div');
  madeUp.className = 'tnai-card-team';
  madeUp.hidden = true;
  madeUp.innerHTML = '<div data-key="no-agents-page-sub"><button class="t-go"></button></div>';
  madeUp.querySelector('.t-go').dataset.pane = first;
  document.body.append(madeUp);
  madeUp.querySelector('.t-go').click();
  check(!!(await reaches(first)), "a sub-agent's arrow opens its lead's thread");
  madeUp.remove();

  // The function the other callers use (71, 85, the prompt box's picker): `focusPane`.
  check(await otherPage('settings'), 'setup: the Settings page shows');
  window.TnaiLiveTasks.focusPane(second);
  check(!!(await reaches(second)), "focusPane opens that agent's thread");

  // An agent with no thread and no panel (it was closed): the Threads page, the open thread kept.
  check(await otherPage('skills'), 'setup: the Skills page shows');
  window.TnaiLiveTasks.focusPane('no-agents-page-gone');
  check(
    !!(await until(() => onThreads(), 3000)) && openThread() === second,
    'an agent with no thread ends on the Threads page, with the open thread kept'
  );
  check(await otherPage('settings'), 'setup: the Settings page shows');
  window.TnaiLiveTasks.focusPane('no-agents-page-gone', true);
  check(
    !!(await until(() => onThreads(), 3000)),
    'the same when its terminal was asked for: the Threads page'
  );

  // ---- the folder-trust question ----
  threads.show(first);
  await wait(300);
  const layers = id => [...document.querySelectorAll('[data-trust-ask="' + id + '"]')];
  await main('ask', {
    id: 'no-agents-page-trust',
    paneId: first,
    title: 'Trust "sample-project" for Codex?',
    body: 'The agent you started needs it.',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });
  const inThread = await until(
    () => document.querySelector('.tnt-ask[data-trust-ask="no-agents-page-trust"]'),
    4000
  );
  check(shown(inThread), 'the folder-trust question shows in the open thread');
  const inPanel = document.querySelector(
    '.terminal-pane[data-pane-id="' +
      CSS.escape(first) +
      '"] > [data-trust-ask="no-agents-page-trust"]'
  );
  check(!!inPanel, "and over the agent's own terminal panel");
  check(
    !document.querySelector('#agentsPage [data-trust-ask]'),
    "no copy of it is put into the old page's markup"
  );
  console.log('TNAI_SHOT:no-agents-page-trust');
  await wait(700);
  const trustButton = [...(inThread?.querySelectorAll('button') || [])].find(
    button => button.textContent === 'Trust folder'
  );
  check(shown(trustButton), 'it has the button "Trust folder"');
  trustButton?.click();
  check(
    !!(await until(
      () => !document.querySelector('.tnt-ask[data-trust-ask="no-agents-page-trust"]'),
      3000
    )),
    'the button answers it: the question leaves the thread'
  );

  // The main process then tells every place that it was answered (main.js `trust:done`). It does
  // not know this made-up question, so the test sends that word itself.
  await main('done', 'no-agents-page-trust');
  check(
    !!(await until(() => !layers('no-agents-page-trust').length, 3000)),
    'and once the main process says it is answered, it is gone from every place'
  );

  // The second thread never showed the first one's question.
  await main('ask', {
    id: 'no-agents-page-trust-2',
    paneId: first,
    title: 'Trust?',
    body: '',
    ok: 'Trust folder',
    cancel: "Don't allow",
  });
  await until(() => layers('no-agents-page-trust-2').length, 3000);
  threads.show(second);
  await wait(400);
  check(
    !shown(document.querySelector('.tnt-ask[data-trust-ask="no-agents-page-trust-2"]')),
    "another thread does not show this agent's question"
  );
  await main('done', 'no-agents-page-trust-2');
  check(
    !!(await until(() => !layers('no-agents-page-trust-2').length, 3000)),
    'answered elsewhere, it is taken away'
  );

  check(onThreads(), 'the test ends on the Threads page');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
await wait(100);
classWatch.disconnect();
check(!sawOldClass, 'the layout never had the class agents-mode, from start to end');
window.TnaiThreadMenu?.close();
window.TnaiNextActions?.openBell?.(false);
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log };
