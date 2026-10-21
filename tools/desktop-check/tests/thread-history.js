// Technically Not tools · desktop-check/tests/thread-history.js — past conversations in the thread
// view (src/scripts/138-thread-history.js, 117-past-conversations.js) in the real app with a
// throwaway profile. No saved conversation is read: the rows and excerpts are made up by this
// test and answered by past-conversations.main.js in place of the thread list, and every start is
// recorded, not launched. Covered: with no thread open the button stands at the foot of the
// thread list and opens the list; with a thread open it also stands in the thread's top row;
// nothing is asked until it is pressed; the list is the app's menu panel, newest first, each row
// with its tool, first words and date, every text as text; Escape closes it and the keyboard is
// back on the button; a press outside closes it; a press on a row shows that conversation
// read-only in the same panel with a way back; Resume starts one panel with the conversation's id
// and opens that agent's thread; a conversation that is in a thread now opens that thread; a list
// that cannot be read says so; and the layout never gets the class `agents-mode`.
// Pictures: thread-history-list, -one, -light, -small. Returns {ok, log}.
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
    await wait(50);
  }
  return null;
};

// A covered test window draws no frames, so a frame is never waited on alone.
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  await wait(400);
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
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

const layout = document.querySelector('.layout');
const agents = window.TnaiAgents;
const past = window.TnaiPastThreads;
const history = window.TnaiThreadHistory;
const threads = window.TnaiThreads;
const rect = node => node.getBoundingClientRect();
const round = value => Math.round(value * 10) / 10;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;

// The layout must never show the old Agents and history page: every change of its classes is
// looked at for the whole test.
let sawOldPage = layout.classList.contains('agents-mode');
const watchPage = new MutationObserver(() => {
  if (layout.classList.contains('agents-mode')) sawOldPage = true;
});
watchPage.observe(layout, { attributes: true, attributeFilter: ['class'] });

// What the app says in passing is written down.
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}

const pop = () => document.querySelector('.tnt-menu.tnh-pop');
const popOpen = () => !!pop() && !pop().hidden && onScreen(pop());
const headButton = () => threads.slot('main')?.querySelector('.tnt-view .tnt-head-acts .tnh-open');
const footButton = () => threads.slot('list')?.querySelector('.tnh-foot .tnh-foot-btn');
const rowEls = () => [...(pop()?.querySelectorAll('.tnh-rows .tnh-row') || [])];
const note = () => pop()?.querySelector('.tnh-note')?.textContent || '';
const one = () => {
  const box = pop()?.querySelector('.tnh-one');
  return box && !box.hidden ? box : null;
};
const facts = () =>
  Object.fromEntries(
    [...(one()?.querySelectorAll('.tnh-kv dt') || [])].map(term => [
      term.textContent,
      term.nextElementSibling?.textContent || '',
    ])
  );
const press = (key, node) =>
  (node || document.activeElement).dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
const inWindow = box =>
  box.left >= 0 &&
  box.top >= 0 &&
  box.right <= window.innerWidth + 0.5 &&
  box.bottom <= window.innerHeight + 0.5;

const now = Date.now();
const ID = number => '11111111-2222-4333-8444-' + String(number).padStart(12, '0');
const MARKUP = '<b>bold</b> <img src=x onerror="window.__pastHit=1"> & title';
const conversation = (number, title, minutesAgo, more) => ({
  key: 'Claude Code\n' + ID(number),
  cli: 'Claude Code',
  id: ID(number),
  title,
  at: now - minutesAgo * 60000,
  started: now - (minutesAgo + 60) * 60000,
  bytes: 240000,
  name: '',
  known: true,
  remote: false,
  accountId: '',
  customAgentId: '',
  ownedByUser: true,
  ...more,
});
const rows = [
  conversation(1, 'Fix the login page', 5, { name: 'Moss' }),
  conversation(2, MARKUP, 20, { known: false, ownedByUser: false, bytes: 5300000 }),
  conversation(3, 'Started from the laptop', 60, { name: 'Kite', remote: true, bytes: 900 }),
  {
    ...conversation(4, 'Port the parser', 90, { name: 'Fern', bytes: 0 }),
    key: 'Codex\ncodex-sess-1',
    cli: 'Codex',
    id: 'codex-sess-1',
  },
];
const peeks = {
  [rows[0].key]: {
    first: 'Fix the login page',
    asked: 'Also the footer',
    answer: 'Both are fixed.',
    part: false,
  },
  [rows[1].key]: { first: MARKUP, asked: '', answer: 'Line one\n<i>line two</i>', part: true },
  [rows[2].key]: { first: 'Started from the laptop', asked: '', answer: '', part: false },
};

// ---- real data (only with --real-project) ----
// The project is then a copy of this repo, and the main half points the app's own reader at this
// repo's real saved conversations. Read-only: Resume is never pressed, and no text of a
// conversation goes into the log, only counts and lengths.
async function realPart() {
  await main('installReal');
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const foot = await until(() => footButton(), 5000);
  foot.click();
  await until(() => past.state().state !== 'reading' && popOpen(), 30000);
  const known = past.state();
  const list = known.threads;
  check(known.state === 'ready', 'real data: the list was read (' + known.state + ')');
  check(
    list.length > 0 && rowEls().length === list.length,
    'real data: past conversations of this project are listed: ' +
      list.length +
      (known.more ? ' (the newest; there are more)' : '')
  );
  check(
    list.every((thread, at) => at === 0 || list[at - 1].at >= thread.at),
    'real data: newest first'
  );
  const lines = rowEls().map(row => row.querySelector('small').textContent);
  const titles = rowEls().map(row => row.querySelector('b').textContent);
  const withWords = list.filter(thread => thread.title).length;
  check(
    list.every((thread, at) => lines[at].includes(thread.cli)) &&
      rowEls().every(row => !!row.querySelector('.tnh-mark').firstChild),
    'real data: every row names its tool (' +
      [...new Set(list.map(thread => thread.cli))].join(', ') +
      ')'
  );
  check(
    withWords > 0 && titles.every(title => title.length > 0 && title.length <= 200),
    'real data: rows show first words: ' +
      withWords +
      ' of ' +
      list.length +
      ' have their own, lengths ' +
      Math.min(...titles.map(title => title.length)) +
      ' to ' +
      Math.max(...titles.map(title => title.length))
  );
  check(
    list.every((thread, at) => !(thread.at > 0) || /\d/.test(lines[at].split(' · ').pop())),
    'real data: every row with a known time shows its date'
  );
  check(
    !rowEls().some(row => row.querySelector('b *, small *')),
    'real data: every text is text, no element is made from a conversation'
  );
  const pickAt = list.findIndex(thread => thread.cli === 'Claude Code' && thread.title);
  check(pickAt >= 0, 'real data: there is a Claude Code conversation to open');
  if (pickAt >= 0) {
    rowEls()[pickAt].click();
    await until(() => one() && past.state().excerpt && past.state().excerpt !== 'reading', 30000);
    const read = past.state().excerpt || {};
    const lengths = ['first', 'asked', 'answer'].map(part => String(read[part] || '').length);
    check(
      !!one() && typeof read === 'object' && lengths.some(length => length > 0),
      'real data: one opens with its short parts read (lengths first / last asked / last answer: ' +
        lengths.join(' / ') +
        ')'
    );
    check(
      !pop().querySelector('input, textarea, select, [contenteditable]') &&
        !one().querySelector('.tnh-excerpt *:not(p)'),
      'real data: it is read-only, and its text is plain text'
    );
    check(
      onScreen(one().querySelector('.tnh-resume')) && Object.keys(facts()).includes('Conversation'),
      'real data: Resume is offered (not pressed), with ' +
        Object.keys(facts()).length +
        ' facts about the conversation'
    );
  }
  press('Escape', pop());
  const got = await main('got');
  check(
    !popOpen() && got.starts.length === 0 && got.lists === 1,
    'real data: closed again; the list was read once, ' +
      got.peeks.length +
      ' conversation looked at, nothing started'
  );
  check(!sawOldPage, 'real data: the layout never had the class agents-mode');
}
const projectFolder = String((window.TnaiProjects?.list?.() || [])[0]?.path || '');
const onRealProject = /tnai-copy[\\/]*$/.test(projectFolder);

try {
  check(
    !!past?.show && !!history?.open && !!window.tnaiNative.threads?.list,
    'the past conversations, their place in the thread view and the bridge exist'
  );
  if (onRealProject) {
    await realPart();
    watchPage.disconnect();
    return { ok, log };
  }
  await main('install', rows, peeks, false);
  await main('size', 1440, 900);
  threads.open();
  check(!!(await until(() => threads.visible(), 5000)), 'the Threads page is showing');

  // ---- no thread open: the button at the foot of the thread list ----
  const foot = await until(() => footButton(), 5000);
  check(
    !agents.sessions().length && !onScreen(headButton()),
    'setup: no thread is open, so no top row and no button in it'
  );
  {
    const list = threads.slot('list');
    const island = rect(list);
    const at = foot ? rect(foot) : null;
    const rowsEnd = rect(list.querySelector('.tnt-threads')).bottom;
    check(
      !!foot &&
        onScreen(foot) &&
        foot.textContent === 'Past conversations' &&
        list.lastElementChild === foot.parentElement &&
        at.left >= island.left &&
        at.right <= island.right &&
        at.bottom <= island.bottom &&
        at.top >= rowsEnd,
      'a "Past conversations" button is the last thing of the thread list, inside its island and under its rows: button ' +
        (at ? round(at.top) + ' to ' + round(at.bottom) : 'none') +
        ', island ends ' +
        round(island.bottom)
    );
    check(
      !!at && Math.abs(at.left - island.left - (island.right - at.right)) <= 1,
      'it keeps the same room on its left and right: ' +
        round(at.left - island.left) +
        ' and ' +
        round(island.right - at.right)
    );
  }
  await wait(1500);
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
  await wait(300);
  check(
    (await main('got')).lists === 0,
    'nothing is read before the button is pressed: not at the start, not after a while, not when the window comes back'
  );
  foot.click();
  await until(() => rowEls().length === rows.length);
  check(
    popOpen() && (await main('got')).lists === 1 && foot.getAttribute('aria-expanded') === 'true',
    'with no thread open, one press on it asks once and opens the list'
  );
  {
    await frame();
    await wait(250);
    const box = rect(pop());
    check(
      box.bottom <= rect(foot).top + 1 && inWindow(box),
      'the list opens over the button, inside the window: ' +
        round(box.top) +
        ' to ' +
        round(box.bottom) +
        ', button at ' +
        round(rect(foot).top)
    );
  }
  press('Escape');
  check(
    !popOpen() && !past.shown() && document.activeElement === foot,
    'Escape closes it and the keyboard is back on the button'
  );

  // ---- a thread is open: the button in the thread's top row ----
  const before = new Set(agents.sessions().map(session => session.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  const home =
    opened?.paneId ||
    (await until(() => agents.sessions().find(session => !before.has(session.paneId))))?.paneId;
  await until(() => agents.sessions().find(session => session.paneId === home && session.running));
  threads.show(home);
  const head = await until(() => (onScreen(headButton()) ? headButton() : null), 6000);
  {
    const acts = head?.parentElement;
    const at = head ? rect(head) : null;
    const others = acts ? [...acts.querySelectorAll('.tnt-icon-btn')].filter(onScreen) : [];
    const sizes = new Set(
      others.map(button => round(rect(button).width) + 'x' + round(rect(button).height))
    );
    check(
      !!head &&
        acts.classList.contains('tnt-head-acts') &&
        head.classList.contains('tnt-icon-btn') &&
        head.getAttribute('aria-label') === 'Past conversations' &&
        !!head.querySelector('svg'),
      'with a thread open, an icon button "Past conversations" stands in the top row of the thread'
    );
    check(
      !!at && sizes.size === 1 && round(at.width) === 30 && round(at.height) === 30,
      'it is the same button as the others of that row: ' + [...sizes].join(', ')
    );
    check(
      onScreen(footButton()),
      'the button at the foot of the list is still there with a thread open'
    );
  }
  const starts0 = (await main('got')).starts.length;

  // ---- the list ----
  const restFill = getComputedStyle(head).backgroundColor;
  head.click();
  await until(() => rowEls().length === rows.length);
  check(
    popOpen() && (await main('got')).lists === 2 && head.getAttribute('aria-expanded') === 'true',
    'a press on it asks once more and opens the list'
  );
  await frame();
  await wait(250);
  {
    const box = rect(pop());
    const style = getComputedStyle(pop());
    check(
      pop().classList.contains('tnt-menu') &&
        style.position === 'fixed' &&
        /blur/.test(style.backdropFilter || style.webkitBackdropFilter || ''),
      "it is the app's menu panel: the same material over the page"
    );
    check(
      box.top >= rect(head).bottom && inWindow(box) && box.right <= rect(head).right + 9,
      'it opens under the button, inside the window: top ' +
        round(box.top) +
        ', button ends ' +
        round(rect(head).bottom)
    );
  }
  check(
    getComputedStyle(head).backgroundColor !== restFill,
    'the button looks pressed while the list is open'
  );
  check(
    !rowEls()[0].dataset.pane &&
      rowEls()[0].draggable !== true &&
      !rowEls()[0].closest('.tnt-threads'),
    'a past conversation is not a thread row: it has no panel, is not dragged and is not in the thread list'
  );
  check(/^4 in this project/.test(note()), 'it says how many there are: "' + note() + '"');
  check(
    rowEls()
      .map(row => row.querySelector('b').textContent)
      .join('|') === rows.map(row => row.title).join('|'),
    'one row per conversation, in the order given (newest first)'
  );
  {
    const first = rowEls()[0];
    const line = first.querySelector('small').textContent;
    check(
      first.querySelector('b').textContent === 'Fix the login page' &&
        /^Claude Code · Moss · /.test(line) &&
        /\d/.test(line.split(' · ').pop()) &&
        !!first.querySelector('.tnh-mark').firstChild &&
        /^Codex · Fern · /.test(rowEls()[3].querySelector('small').textContent),
      'each row has its tool, its first words and its date: "' + first.textContent + '"'
    );
    const heights = new Set(rowEls().map(row => round(rect(row).height)));
    const box = rect(pop());
    check(
      heights.size === 1 &&
        rowEls().every(row => rect(row).left >= box.left && rect(row).right <= box.right),
      'the rows have one height and stand inside the panel: ' + [...heights].join(', ')
    );
  }
  check(
    !rowEls().some(row => row.querySelector('b b, b img, small b')) &&
      !window.__pastHit &&
      rowEls()[1].querySelector('b').textContent === MARKUP,
    'a title that looks like markup is shown as those characters: no element is made, nothing runs'
  );
  check(
    document.activeElement === rowEls()[0],
    'the keyboard is on the first row when the list is there'
  );
  press('ArrowDown');
  check(document.activeElement === rowEls()[1], 'the Down key moves to the next row');
  press('ArrowUp');
  await shot('thread-history-list');

  // ---- closing ----
  press('Escape');
  check(
    !popOpen() && !past.shown() && document.activeElement === head,
    'Escape closes the list and the keyboard is back on the button of the top row'
  );
  head.click();
  await until(() => popOpen() && rowEls().length === rows.length);
  document
    .querySelector('.tnt-view .tnt-head h1')
    .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  await wait(120);
  check(!popOpen() && !past.shown(), 'a press outside closes it');
  check(
    document.activeElement === head,
    'and the keyboard is back on the button when the press took it nowhere'
  );
  head.click();
  await until(() => popOpen() && rowEls().length === rows.length);
  head.click();
  check(!popOpen(), 'a second press on the button closes it');

  // ---- one conversation, read-only ----
  head.click();
  await until(() => popOpen() && rowEls().length === rows.length);
  rowEls()[0].click();
  await until(() => one() && /Both are fixed/.test(one().textContent));
  check(
    !!one() && pop().querySelector('.tnh-list').hidden,
    'a press on a row shows that conversation in the same panel, in place of the list'
  );
  check(
    (await main('got')).peeks.join() === rows[0].key,
    'its short parts are read then, once, and only for that conversation'
  );
  check(
    one().querySelector('.tnh-one-title').textContent === 'Fix the login page' &&
      /Claude Code · agent Moss/.test(one().querySelector('.tnh-one-sub').textContent) &&
      facts().Tool === 'Claude Code' &&
      facts().Agent === 'Moss' &&
      facts().Conversation === ID(1) &&
      facts()['Saved size'] === '234 KB' &&
      !('On resume' in facts()),
    'it shows what is known: ' + JSON.stringify(facts())
  );
  check(
    /First asked\s*Fix the login page/.test(one().querySelector('.tnh-excerpt').textContent) &&
      /Last asked\s*Also the footer/.test(one().querySelector('.tnh-excerpt').textContent) &&
      /Last answer\s*Both are fixed\./.test(one().querySelector('.tnh-excerpt').textContent),
    'and the first thing asked, the last thing asked and the last answer'
  );
  check(
    !pop().querySelector('input, textarea, select, [contenteditable]'),
    'it is read-only: nothing in it takes typing'
  );
  {
    const resume = one().querySelector('.tnh-resume');
    const back = one().querySelector('.tnh-back');
    check(
      onScreen(resume) && resume.textContent === 'Resume' && !resume.disabled && onScreen(back),
      'Resume is offered, and a way back to the list'
    );
    check(inWindow(rect(pop())), 'the panel is still inside the window');
    await shot('thread-history-one');
    const readBefore = (await main('got')).lists;
    back.click();
    await until(() => !one());
    check((await main('got')).lists === readBefore, 'the way back reads nothing again');
    check(
      !one() && rowEls().length === rows.length && document.activeElement === rowEls()[0],
      'the way back shows the list again, the keyboard on the row that was read'
    );
  }
  rowEls()[1].click();
  await until(() => one() && /line two/.test(one().textContent));
  check(
    !one().querySelector('.tnh-excerpt i, .tnh-excerpt img, .tnh-one-title b') &&
      !window.__pastHit &&
      one().querySelector('.tnh-one-title').textContent === MARKUP,
    'text of a conversation that looks like markup is shown as those characters'
  );
  one().querySelector('.tnh-back').click();
  await until(() => !one());
  rowEls()[2].click();
  await until(() => one() && facts()['On resume']);
  check(
    /^Ask first/.test(facts()['On resume'] || '') &&
      /"Ask first"/.test(one().querySelector('.tnh-one-note').textContent),
    'a conversation of an agent started from another computer says it resumes at "Ask first"'
  );
  window.TnaiTheme?.set?.('light');
  await wait(500);
  await shot('thread-history-light');
  window.TnaiTheme?.set?.('dark');
  await wait(300);
  one().querySelector('.tnh-back').click();
  await until(() => !one());

  // ---- Resume ----
  rowEls()[0].click();
  await until(() => one() && /Both are fixed/.test(one().textContent));
  const known = new Set(agents.sessions().map(session => session.paneId));
  one().querySelector('.tnh-resume').click();
  await until(async () => (await main('got')).starts.length === starts0 + 1, 15000);
  const got = await main('got');
  const start = got.starts.at(-1);
  check(
    got.starts.length === starts0 + 1 &&
      start?.resumeId === ID(1) &&
      start?.agent === 'Claude Code' &&
      (start.access === undefined || start.access === '' || start.access === 'default'),
    'Resume starts exactly one panel that resumes that conversation, with no access level of its own: ' +
      JSON.stringify(start && { resumeId: start.resumeId, agent: start.agent })
  );
  const resumed = await until(
    () => agents.sessions().find(session => !known.has(session.paneId) && session.sessionId),
    10000
  );
  check(
    !!(await until(
      () => !popOpen() && threads.visible() && threads.selected() === resumed?.paneId,
      8000
    )),
    "then the list is gone and the resumed agent's thread is the open one"
  );
  check(
    !!(await until(() => window.TnaiThreadView?.shown?.() === resumed?.paneId, 6000)),
    'the thread view shows that agent'
  );

  // ---- a conversation that is in a thread now ----
  const headNow = await until(() => (onScreen(headButton()) ? headButton() : null), 6000);
  headNow.click();
  await until(() => popOpen() && rowEls().length === rows.length);
  check(
    /^In a thread now · /.test(rowEls()[0].querySelector('small').textContent),
    'a conversation that is in a thread now says so: "' +
      rowEls()[0].querySelector('small').textContent +
      '"'
  );
  threads.show(home);
  await until(() => threads.selected() === home);
  rowEls()[0].click();
  check(
    !!(await until(() => !popOpen() && threads.selected() === resumed?.paneId, 6000)) &&
      (await main('got')).starts.length === starts0 + 1,
    'a press on it opens that thread and starts nothing'
  );

  // ---- a list that cannot be read; the smallest window ----
  await main('failing', true);
  past.show();
  await until(() => popOpen() && /could not be read/.test(note()));
  check(
    popOpen() && !rowEls().length && /could not be read/.test(note()),
    'a list that cannot be read says so, through the function too: "' + note() + '"'
  );
  history.close();
  check(!popOpen() && !past.shown(), 'and the function closes it');
  await main('failing', false);

  // ---- more than the list holds; another project ----
  await main('setRows', []);
  past.show();
  await until(() => popOpen() && /None in this project yet/.test(note()));
  check(
    !rowEls().length && /None in this project yet/.test(note()),
    'a project with no saved conversation says so: "' + note() + '"'
  );
  history.close();
  await main('setRows', rows);
  await main('setMore', true);
  past.show();
  await until(() => popOpen() && rowEls().length === rows.length);
  check(
    /^4 newest in this project/.test(note()),
    'a cut list says it is the newest: "' + note() + '"'
  );
  await main('setMore', false);
  rowEls()[1].click();
  await until(() => one());
  const listsBefore = (await main('got')).lists;
  window.dispatchEvent(new CustomEvent('tnai:project-changed'));
  await wait(300);
  check(
    !popOpen() && !past.shown() && !past.state().threads.length && !past.selected(),
    'another project was opened: the list closes and is emptied, nothing stays selected'
  );
  check(
    (await main('got')).lists === listsBefore,
    'and nothing is read for the new project until the button is pressed there'
  );

  // ---- a press on a thread, from another page and on this one (from the old agents-history) ----
  {
    const rowOf = id =>
      threads
        .slot('list')
        .querySelector('.tnt-th[data-pane="' + CSS.escape(id) + '"]:not(.tnt-sub)');
    const marked = () =>
      [...threads.slot('list').querySelectorAll('.tnt-th[aria-selected="true"]')].map(
        row => row.dataset.pane
      );
    window.TnaiRoute('skills');
    await until(() => !threads.visible(), 4000);
    check(onScreen(footButton()), 'on another page the button is still at the foot of the list');
    rowOf(home).click();
    check(
      !!(await until(() => threads.visible() && threads.selected() === home, 6000)),
      'on another page (Skills) a press on a thread opens that thread on the Threads page'
    );
    rowOf(resumed.paneId).click();
    check(
      !!(await until(() => threads.selected() === resumed.paneId, 4000)) && threads.visible(),
      'on the Threads page a press opens the thread there'
    );
    check(
      !!(await until(() => marked().join() === resumed.paneId, 3000)),
      'the open thread is the one marked in the list: ' + JSON.stringify(marked())
    );
  }
  const small = await main('size', 768, 680);
  await frame();
  (onScreen(headButton()) ? headButton() : footButton()).click();
  await until(() => popOpen() && rowEls().length === rows.length);
  await frame();
  await wait(250);
  check(
    inWindow(rect(pop())),
    'at the smallest window (' +
      small.join(' by ') +
      ') the list is inside the window: ' +
      round(rect(pop()).left) +
      ' to ' +
      round(rect(pop()).right)
  );
  await shot('thread-history-small');
  press('Escape', pop());
  await main('size', 1440, 900);
  check(
    !said.some(text => /not resumed|could not|failed/i.test(text)),
    'nothing was reported as failed along the way: ' + JSON.stringify(said)
  );

  // ---- a resume whose start fails leaves no panel behind ----
  const panelIds = () =>
    [...document.querySelectorAll('.terminal-pane[data-pane-id]')].map(pane => pane.dataset.paneId);
  const panelsBefore = panelIds().join();
  const failStarts0 = (await main('got')).starts.length;
  await main('startsFail', true);
  await past.resume(rows[1].key);
  await main('startsFail', false);
  check(
    (await main('got')).starts.length === failStarts0 + 1 &&
      said.some(text => /^Not resumed: made-up start failure/.test(text)),
    'a resume whose start fails says so: ' + JSON.stringify(said.at(-1))
  );
  check(
    !!(await until(() => panelIds().join() === panelsBefore, 4000)),
    'and the panel opened for it is closed again: before ' +
      panelsBefore +
      ', after ' +
      panelIds().join()
  );

  // ---- a revive whose start fails (composer or `tnai send` to a closed agent) leaves no panel
  // ----
  const reviveStarts0 = (await main('got')).starts.length;
  await main('startsFail', true);
  const revived = await main('revive', {
    instanceId: 'test-closed-agent',
    name: 'Closedtest',
    agent: rows[3].cli,
    contextId: rows[3].id,
  });
  await main('startsFail', false);
  check(
    (await main('got')).starts.length === reviveStarts0 + 1 &&
      /made-up start failure/.test(revived?.error || ''),
    'a revive whose start fails answers with the error: ' + JSON.stringify(revived)
  );
  check(
    !!(await until(() => panelIds().join() === panelsBefore, 4000)),
    'and the panel the revive opened is closed again: before ' +
      panelsBefore +
      ', after ' +
      panelIds().join()
  );

  // ---- the Access pill of a panel held at "Ask first" (another computer started it) ----
  const accessSel = document.querySelector('.composer .tnai-pick[data-pick="access"] select');
  const accessKey = 'tnai.access.v1';
  const accessSaved = localStorage.getItem(accessKey);
  await until(() => accessSel && !accessSel.disabled);
  accessSel.value = 'edits';
  accessSel.dispatchEvent(new Event('change'));
  await main('holdIds', [rows[2].id]);
  const heldKnown = new Set(agents.sessions().map(session => session.paneId));
  await past.resume(rows[2].key);
  const heldPanel = await until(
    () =>
      agents
        .sessions()
        .find(session => !heldKnown.has(session.paneId) && session.sessionId === rows[2].id),
    10000
  );
  window.TnaiLiveTasks.setTarget(heldPanel?.paneId);
  await wait(200);
  check(
    !!heldPanel &&
      accessSel.value === 'ask' &&
      window.TnaiLaunchPrefs.paneAccess(heldPanel.paneId) === 'ask' &&
      /another computer/.test(accessSel.title),
    'on a panel held at "Ask first" the Access pill shows Ask first, not the project\'s level: ' +
      JSON.stringify({ value: accessSel?.value, title: accessSel?.title })
  );
  window.TnaiLiveTasks.setTarget(null);
  await wait(200);
  check(
    accessSel.value === 'edits',
    "with no agent picked it shows the project's level again: " + accessSel.value
  );
  await main('holdIds', []);
  if (accessSaved === null) localStorage.removeItem(accessKey);
  else localStorage.setItem(accessKey, accessSaved);
  check(!sawOldPage, 'the layout never had the class agents-mode');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
watchPage.disconnect();
return { ok, log };
