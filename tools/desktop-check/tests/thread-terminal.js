// Technically Not tools · desktop-check/tests/thread-terminal.js — the "All threads" page of
// the three-dots menu (it has the route the Terminal page had) inside the thread frame, in the real
// app with a throwaway profile and five real PowerShell threads. Since the app is threads only the
// page shows the project's threads side by side (135) and the terminal panels stay underneath,
// unseen. So: the page's own agent list is not shown, the thread list is the one list, a press on a
// thread there keeps the page, chooses that thread and has its card on the page, and no terminal
// panel shows. The page's top row has "New thread" where "+ Terminal" stood, and nothing in it lies
// over anything else, at 1440 and at 1280 wide. Pictures: thread-terminal-page,
// thread-terminal-1280. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

// A call into this test's main-process half (thread-terminal.main.js): it sizes the window.
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const layout = document.querySelector('.layout'),
  threads = window.TnaiThreads,
  agents = window.TnaiAgents,
  page = document.getElementById('terminalView');
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const n = v => Math.round(v * 10) / 10;

// The things a person reads or presses in the page's top row: its title, each workspace tab and
// every button, but not the boxes that only group them.
const rowItems = () =>
  [
    ...page.querySelectorAll(
      '.terminal-toolbar .terminal-title, .terminal-toolbar .terminal-subtitle, .terminal-toolbar button, .terminal-toolbar [role="tab"]'
    ),
  ].filter(el => shown(el) && box(el).width > 2);
const nameOf = el =>
  (el.textContent || el.title || el.getAttribute('aria-label') || el.className || el.tagName)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 22);

// Every pair of items that share space, a button inside another button aside.
function overlaps() {
  const items = rowItems(),
    found = [];
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].contains(items[b]) || items[b].contains(items[a])) continue;
      const one = box(items[a]),
        two = box(items[b]);
      const wide = Math.min(one.right, two.right) - Math.max(one.left, two.left),
        high = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);

      // A workspace tab's own two small buttons (rename, close) share 2 px on purpose: their
      // press areas meet. Anything more than that is one thing lying over another.
      if (wide > 2.5 && high > 2.5)
        found.push('"' + nameOf(items[a]) + '" over "' + nameOf(items[b]) + '" by ' + n(wide));
    }
  return found;
}

function rowCheck(width) {
  const bar = page.querySelector('.terminal-toolbar'),
    items = rowItems(),
    hits = overlaps(),
    b = box(bar);
  const out = items.filter(el => box(el).left < b.left - 1 || box(el).right > b.right + 1);
  check(
    !hits.length,
    'at ' +
      width +
      ' wide nothing in the top row lies over anything else (' +
      items.length +
      ' items' +
      (hits.length ? ': ' + hits.join('; ') : '') +
      ')'
  );
  check(
    !out.length,
    'at ' +
      width +
      ' wide every item is inside the row (' +
      (out.map(nameOf).join(', ') || 'all inside') +
      ')'
  );
}

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  await until(() => threads?.visible(), 8000);
  await agents.detect(true);
  for (let i = 0; i < 5; i++) {
    await openThread('Terminal');
    await wait(300);
  }
  check(
    !!(await until(() => agents.sessions().filter(s => s.running).length >= 5, 30000)),
    'setup: five PowerShell threads running'
  );
  const ids = agents.sessions().map(s => s.paneId);

  // the route 'terminal' is the All threads page
  window.TnaiRoute('terminal');
  check(
    !!(await until(() => layout.classList.contains('terminal-mode') && shown(page), 5000)),
    'the menu\'s page "All threads" opens'
  );
  await main('size', 1440, 900);
  await wait(700);
  const all = () => window.TnaiAllThreads;
  check(
    !!(await until(() => all()?.state().on && all().state().order.length >= 5, 6000)) &&
      page.querySelector('.terminal-title')?.textContent === 'All threads',
    'the page shows the threads (' +
      all()?.state().order.length +
      ') and is named ' +
      page.querySelector('.terminal-title')?.textContent
  );

  // ---- the page's own list is gone, the thread list is the one list ----
  const own = page.querySelector('.tp-agents'),
    list = threads.slot('list');
  check(page.classList.contains('tp-on'), 'the page keeps its column for the preview');
  check(!shown(own), "the page's own agent list is not shown");
  check(
    shown(list) && list.querySelectorAll('.tnt-th').length >= 2,
    'the thread list beside the page lists the agents (' +
      list.querySelectorAll('.tnt-th').length +
      ' rows)'
  );
  const content = page.querySelector('.terminal-content'),
    preview = page.querySelector('.tp-preview');
  check(
    shown(content) && box(content).left - box(list).right < 40,
    'the threads start right beside the thread list, with no empty column between (' +
      n(box(content).left - box(list).right) +
      ' px)'
  );
  check(
    shown(preview) && box(preview).left > box(content).right,
    'the Live preview keeps its place to the right of the threads'
  );

  // ---- a press on a thread keeps this page, chooses the thread and has its card on the page;
  // the terminal panels stay underneath, unseen ----
  const cardOf = id => page.querySelector('.tat-card[data-pane="' + id + '"]');
  const onPage = id => {
    const card = cardOf(id);
    const row = page.querySelector('.tat-clip') || page.querySelector('.tat');
    return (
      shown(card) && box(card).left >= box(row).left - 1 && box(card).right <= box(row).right + 1
    );
  };
  const inOrder = all().state().order;
  const last = inOrder[inOrder.length - 1];
  const firstOne = inOrder[0];
  check(
    all().state().per < inOrder.length && !all().state().shown.includes(last),
    'setup: more threads than the page holds side by side (' +
      inOrder.length +
      ' threads, ' +
      all().state().per +
      ' on the page), the last one off the page'
  );
  for (const id of [last, firstOne]) {
    list.querySelector('.tnt-th[data-pane="' + id + '"]')?.click();
    const there = await until(
      () =>
        window.TnaiTerminalPreview.picked() === id && layout.classList.contains('terminal-mode'),
      3000
    );
    check(
      !!there && !threads.visible(),
      'a press on a thread in the list chooses it, and the page stays (' + id.slice(-4) + ')'
    );
    check(
      !!(await until(() => all().state().shown.includes(id) && onPage(id), 3000)),
      'and that thread is on the page, whole (' + id.slice(-4) + ')'
    );
    const pane = page.querySelector('.terminal-pane[data-pane-id="' + id + '"]');
    check(!!pane && !shown(pane), 'its terminal panel stays unseen (' + id.slice(-4) + ')');
  }
  check(threads.selected() === firstOne, 'and the thread list marks that thread as the open one');

  // ---- "go to this agent" (a notice, Needs you, a loop) opens that agent's thread ----
  window.TnaiLiveTasks.focusPane(ids[1]);
  check(
    !!(await until(() => threads.visible() && threads.selected() === ids[1], 3000)),
    'TnaiLiveTasks.focusPane, the app\'s "go to it", opens that agent\'s thread on Threads'
  );
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode'), 3000);
  check(
    threads.show(ids[0]) === true && threads.visible() && threads.selected() === ids[0],
    'TnaiThreads.show does the same and answers true'
  );
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode'), 3000);
  await wait(400);

  // ---- the top row adds a thread, not a terminal panel ----
  check(
    !document.getElementById('addTerminalPane') && shown(page.querySelector('.tat-new')),
    'the top row has "New thread" where "+ Terminal" stood (' +
      (page.querySelector('.tat-new')?.textContent.trim() || 'no button') +
      ')'
  );

  // ---- the top row ----
  check(
    !shown(page.querySelector('.terminal-subtitle')),
    'the old subtitle is not shown in the frame'
  );
  rowCheck(1440);
  console.log('TNAI_SHOT:thread-terminal-page');
  await wait(600);
  await main('size', 1280, 800);
  await wait(700);
  rowCheck(1280);
  console.log('TNAI_SHOT:thread-terminal-1280');
  await wait(600);
  await main('size', 1440, 900);
  await wait(400);

  // ---- back to Threads ----
  threads.open();
  check(!!(await until(() => threads.visible(), 3000)), 'Threads comes back');
  agents.sessions().forEach(s => agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
