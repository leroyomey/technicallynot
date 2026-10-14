// Technically Not tools · desktop-check/tests/threads-only-words.js — the words a user reads, after
// "threads only". With one PowerShell thread open it
// goes through every page a row of the three-dots menu opens, the menu itself with its search
// (Ctrl+K), the Keyboard shortcuts page and every tab of Settings, and collects every text on
// screen with every `title` and `aria-label` of a shown element. It fails when one of them says
// "Agents and history", "All terminals", "+ Terminal", "terminal panel" or "pane" as a word, and
// lists each find with the page it stood on. What a terminal prints, what a conversation says and
// the names of the project's files are not the app's words and are left out.
// Pictures: threads-only-words-shortcuts, threads-only-words-settings.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const shown = node => !!node && node.getClientRects().length > 0;
const shot = async name => {
  await wait(450);
  console.log('TNAI_SHOT:threads-only-words-' + name);
  await wait(700);
};

// The words that must not be read any more, each with its name for the list.
const OLD_WORDS = [
  ['Agents and history', /agents (and|&) history/i],
  ['All terminals', /all terminals/i],
  ['+ Terminal', /[+＋]\s*terminal\b/i],
  ['terminal panel', /terminal panels?\b/i],
  ['pane', /\bpanes?\b/i],
];

// Not the app's words: what a program printed, what was said in a conversation, file names.
const NOT_OURS = '.xterm, .tnt-talk, .tat-talk, .repo-rail-tree, .tnt-fileview-text, .repo-row';

// Every text, title and aria-label a user can read on the page as it stands now.
function wordsOnScreen() {
  const found = [];
  document.querySelectorAll('body *').forEach(node => {
    if (!shown(node) || node.closest(NOT_OURS)) return;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName)) return;
    const place =
      node.tagName.toLowerCase() +
      (node.className ? '.' + String(node.className).split(' ')[0] : '');
    node.childNodes.forEach(child => {
      const text = child.nodeType === 3 ? child.textContent.trim() : '';
      if (text) found.push(['text', text, place]);
    });
    for (const name of ['title', 'aria-label', 'placeholder']) {
      const value = node.getAttribute(name);
      if (value) found.push([name, value.trim(), place]);
    }
  });
  return found;
}

// What was found, once per wording: "words" -> the pages it stood on.
const finds = new Map();
const pagesRead = [];

function read(page) {
  const all = wordsOnScreen();
  pagesRead.push(page + ' (' + all.length + ')');
  for (const [kind, text, place] of all) {
    for (const [name, pattern] of OLD_WORDS) {
      if (!pattern.test(text)) continue;
      const key = name + ' | ' + kind + ' | ' + text.slice(0, 160) + ' | ' + place;
      finds.set(key, (finds.get(key) || new Set()).add(page));
    }
  }
  return all.length;
}

const menuButton = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const openMenu = async () => {
  if (!shown(menu())) menuButton()?.click();
  return until(() => shown(menu()), 3000);
};
const rowNames = () =>
  [...menu().querySelectorAll('.tnt-menu-row')].filter(shown).map(row => row.textContent.trim());

// Rows that do something at once and are not a page: they are read in the menu, not pressed.
const NOT_A_PAGE = /stop all|sign out|quit|restart|check for updates/i;
let opened = '';

try {
  await agents.detect(true);
  opened = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(
    !!opened &&
      !!(await until(() => agents.sessions().find(s => s.paneId === opened)?.running, 20000)),
    'setup: one PowerShell thread is open'
  );
  threads.show(opened);
  await wait(600);
  check(read('Threads') > 20, 'the Threads page was read');

  // ---- the three-dots menu, and each page a row opens ----
  check(!!(await openMenu()), 'the three-dots menu opens');
  await wait(300);
  read('the three-dots menu');
  const rows = rowNames();
  log.push('note the menu rows: ' + rows.join(', '));
  window.TnaiThreadMenu?.close();
  for (const name of rows) {
    if (NOT_A_PAGE.test(name)) continue;
    await openMenu();
    const row = [...menu().querySelectorAll('.tnt-menu-row')].find(
      one => shown(one) && one.textContent.trim() === name
    );
    if (!row) continue;
    row.click();
    await wait(900);
    read('page "' + name + '"');
    window.TnaiThreadMenu?.close();
  }
  check(
    pagesRead.length >= rows.length,
    'every page of the menu was read (' + rows.length + ' rows)'
  );

  // ---- the menu's search (Ctrl+K): rows that show only when searched for ----
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })
  );
  await openMenu();
  const field = menu()?.querySelector('.tnt-menu-search input');
  check(!!field, 'Ctrl+K: the menu with its search field');
  const searched = new Set();
  for (const query of [
    'terminal',
    'agent',
    'thread',
    'key',
    'voice',
    'update',
    'history',
    'e',
    'a',
  ]) {
    if (!field) break;
    field.value = query;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(250);
    rowNames().forEach(name => searched.add(name));
    read('the menu, searched for "' + query + '"');
  }
  if (field) {
    field.value = '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  window.TnaiThreadMenu?.close();
  log.push('note rows found by search: ' + [...searched].join(', '));

  // ---- Settings, tab by tab ----
  window.TnaiSettings?.open();
  await wait(700);
  const tabs = [...document.querySelectorAll('[id^="settingsPanel-"]')].map(panel =>
    panel.id.replace('settingsPanel-', '')
  );
  check(tabs.length >= 4, 'Settings has its tabs (' + tabs.join(', ') + ')');
  for (const tab of tabs) {
    window.TnaiSettings.open(tab);
    await wait(500);
    const panel = document.getElementById('settingsPanel-' + tab);
    if (!shown(panel)) {
      log.push('note the Settings tab "' + tab + '" did not show and was not read');
      continue;
    }
    read('Settings › ' + tab);
    if (tab === 'general') await shot('settings');
  }

  // ---- the Keyboard shortcuts page ----
  window.TnaiShortcuts?.open();
  await wait(700);
  const keysRead = read('Keyboard shortcuts');
  check(keysRead > 40, 'the Keyboard shortcuts page was read (' + keysRead + ' texts)');
  await shot('shortcuts');
  window.TnaiShortcuts?.close?.();

  // ---- what was found ----
  log.push('note read: ' + pagesRead.join(' · '));
  const list = [...finds.entries()].sort();
  list.forEach(([key, pages]) => log.push('FOUND ' + key + ' | on: ' + [...pages].join(', ')));
  check(
    !list.length,
    'no text, title or aria-label says "Agents and history", "All terminals", "+ Terminal", "terminal panel" or "pane" (' +
      list.length +
      ' found)'
  );
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
window.TnaiThreadMenu?.close();
threads.open?.();
if (opened) await agents.stop(opened).catch(() => {});
return { ok, log };
