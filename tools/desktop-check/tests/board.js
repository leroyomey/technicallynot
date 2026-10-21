// Technically Not tools · desktop-check/tests/board.js — the Board page
// (src/scripts/157-board-page.js, 156-board-columns.js, src/styles/45-board.css) in the real app
// with a throwaway profile. Parts: the three-dots menu's Board row opens it with the thread list
// beside it; five columns that wrap to the width (none narrower than 176 px, nothing cut); a new
// idea typed in place is kept and deleted again; the Week view shows seven days from two days ago
// with today marked, each day at least 120 px; the view switch and back; every card and button is
// reached by Tab; pictures in Dark and Light. No agent CLI is started.
// Pictures: board-<look>-<view>. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
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
const layout = document.querySelector('.layout');
const page = document.getElementById('boardPage');
const shown = el => !!el && el.getClientRects().length > 0;

check(!!page && !!window.TnaiBoard, 'the Board page is built');

// The menu's Board row, right after All threads under Work.
window.TnaiThreadMenu?.open?.(document.querySelector('.top .tnt-menu-btn'));
await wait(300);
const labels = [...document.querySelectorAll('.tnt-menu .tnt-menu-row > span')].map(span =>
  span.textContent.trim()
);
window.TnaiThreadMenu?.close?.();
const at = labels.indexOf('Board');
check(at > 0 && labels[at - 1] === 'All threads', 'the menu lists Board right after All threads');

window.TnaiRoute('board');
check(
  !!(await until(() => layout.classList.contains('board-mode') && shown(page))),
  'the page shows'
);
check(shown(document.querySelector('.tnt-list')), 'the thread list stays beside it');
check(!shown(document.querySelector('footer.composer')), 'no prompt box under the Board');
check(!!(await until(() => window.TnaiBoard.visible())), 'it draws while shown');

window.TnaiBoard.view('board');
await until(() => page.dataset.view === 'board');

// A project with nothing on it shows one line and its two ways on, not five empty columns (the
// empty state of 2026-10-16, which came after this test was first written).
check(
  !!(await until(() => shown(page.querySelector('section.bd-empty')))),
  'an empty project shows "Nothing on the board yet" instead of empty columns'
);

// One idea is kept for the rest of the test, so the columns and the Week's days are drawn.
const addIdea = async words => {
  page.querySelector('.bd-add').click();
  const field = await until(() => page.querySelector('.bd-idea-input'));
  if (field) {
    field.value = words;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const made = await until(() =>
    [...page.querySelectorAll('[data-col="next"] .bd-card[data-kind="idea"]')].find(node =>
      node.textContent.includes(words)
    )
  );
  return { field, card: made };
};
const kept = await addIdea('Kept for the Week check');
check(
  !!kept.card && !shown(page.querySelector('section.bd-empty')),
  'with one idea the columns come and the empty line goes'
);
const cols = [...page.querySelectorAll('.bd-col')];
check(cols.length === 5, 'five columns');
check(
  cols.map(col => col.querySelector('.bd-col-head').firstChild.textContent.trim()).join('|') ===
    'Up next|Working|Needs you|Ready for review|Done today',
  'the columns in order'
);
const boardBox = page.querySelector('.bd-board').getBoundingClientRect();
check(
  cols.every(col => col.getBoundingClientRect().width >= 175.5),
  'no column under 176 px'
);
check(
  cols.every(col => col.getBoundingClientRect().right <= boardBox.right + 0.5),
  'no column cut at the right'
);

// A new idea, typed in place, kept, then deleted.
page.querySelector('.bd-add').click();
const input = await until(() => page.querySelector('.bd-idea-input'));
check(!!input && document.activeElement === input, 'the idea field opens and has the keyboard');
if (input) {
  input.value = 'Board test idea';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}
const card = await until(() =>
  [...page.querySelectorAll('[data-col="next"] .bd-card[data-kind="idea"]')].find(node =>
    node.textContent.includes('Board test idea')
  )
);
check(!!card, 'the idea is a card in Up next');
check(card?.getAttribute('draggable') === 'true', 'the idea can be dragged');
card?.querySelector('[data-act="delete"]')?.click();
check(
  !!(await until(
    () =>
      ![...page.querySelectorAll('.bd-card[data-kind="idea"]')].some(node =>
        node.textContent.includes('Board test idea')
      )
  )),
  'Delete removes it'
);

// Every card and button is reached by Tab (tabbable, not hidden).
const reachable = [...page.querySelectorAll('.bd-card, .bd-page button')].filter(shown);
check(
  reachable.every(node => node.tabIndex >= 0),
  'cards and buttons are in the Tab order (' + reachable.length + ')'
);

for (const look of ['dark', 'light']) {
  window.TnaiTheme?.set(look);
  await wait(300);
  window.TnaiBoard.view('board');
  await wait(400);
  await shot('board-' + look + '-board');
  window.TnaiBoard.view('week');
  await until(() => page.dataset.view === 'week');
  await wait(400);
  await shot('board-' + look + '-week');
}

// Week: seven days from two days ago, today marked, each at least 120 px.
const days = [...page.querySelectorAll('.bd-day')];
check(days.length === 7, 'seven days');
check(days[2]?.classList.contains('today'), 'today is the third day');
check(
  days.every(day => day.getBoundingClientRect().width >= 119.5),
  'no day under 120 px'
);
check(shown(page.querySelector('[data-col="next"]')), 'Up next stays above the days');
check(
  [...page.querySelectorAll('.bd-col:not([data-col="next"])')].every(col => !shown(col)),
  'the other columns step out in Week'
);

window.TnaiBoard.view('board');
await until(() => page.dataset.view === 'board');
check(shown(page.querySelector('[data-col="done"]')), 'back to the Board');

// the kept idea goes again, so the throwaway profile ends as it began
kept.card?.isConnected && kept.card.querySelector('[data-act="delete"]')?.click();
[...page.querySelectorAll('.bd-card[data-kind="idea"]')]
  .find(node => node.textContent.includes('Kept for the Week check'))
  ?.querySelector('[data-act="delete"]')
  ?.click();
window.TnaiThreads?.open?.();
check(
  !!(await until(() => !layout.classList.contains('board-mode') && !window.TnaiBoard.visible())),
  'another page lets it go and it stops drawing'
);
return { ok, log };
