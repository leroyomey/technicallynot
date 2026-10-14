// Technically Not tools · desktop-check/tests/thread-side.js — the Threads page's side column
// with its Files tab (src/scripts/131-thread-side.js) in the real app, with a throwaway profile,
// the test's small project folder and one real PowerShell panel as the open thread.
// Checked here: the button in the thread's top row and its spoken state; the file rail moved into
// the column whole (the tree, a folder that loads when opened, the search over the project, the
// mark on a file the panel writes, a click that asks for the viewer window); no line or second
// background on the island; the column at 1440, 1280, the smallest window and a low window, where
// under 1140 page pixels it takes the thread's place and Close brings the thread back; what is
// remembered. The Helpers tab is the test `thread-helpers`.
// Pictures: thread-side-<look>-<size>, -closed, -search, -narrow-back. Returns {ok, log}.
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

// A call into this test's main-process half: the window size.
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

// A covered test window draws no frames, so a frame is never waited on alone.
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

const layout = document.querySelector('.layout'),
  threads = window.TnaiThreads,
  column = window.TnaiThreadSide,
  theme = window.TnaiTheme;
const box = el => el.getBoundingClientRect();
const shown = el =>
  !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const n = v => Math.round(v * 10) / 10;
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by;
const side = () => threads.slot('side'),
  mainSlot = () => threads.slot('main'),
  list = () => threads.slot('list'),
  rail = () => document.querySelector('.repository-rail'),
  button = () => document.querySelector('.tnt-head-acts .tnt-fold-side'),
  row = p => document.querySelector('.repo-real-tree [data-real-path="' + p + '"]');
const saved = () => {
  try {
    return JSON.parse(localStorage.getItem('tnai.thread-side.v1') || '{}');
  } catch {
    return {};
  }
};

check(threads?.visible() === true && !!column, 'starts on Threads, with the side column’s script');
check(!!(await until(() => row('src'))), 'the project folder is restored: src is in the tree');
check(
  !rail().closest('.tnt-side') && !shown(rail()),
  'before the column is opened the file rail is nowhere on screen'
);

// ---------- Details with no thread open ----------
{
  const details = window.TnaiThreadDetails;
  column.open('details');
  await wait(300);
  const part = document.getElementById('tntSideDetails');
  const none = part?.querySelector('.tnt-sidedetails-none');
  check(
    !!details && shown(none) && /no thread is open/i.test(none.textContent),
    'Details with no thread open says so in one line ("' + (none?.textContent || '') + '")'
  );
  check(
    !part.querySelector('.ttd') && details.state().mounted.length === 0,
    'and nothing is mounted'
  );
  column.close();
  await wait(200);
}

// ---------- one real shell, started as a thread and opened ----------
const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
check(
  !!(await until(
    () => window.TnaiAgents.sessions().find(s => s.paneId === paneId && s.running),
    15000
  )),
  'a shell started'
);
await wait(2000);
threads.open();
threads.select(paneId);
check(!!(await until(() => shown(button()))), 'the thread’s top row has the column’s button');

// ---------- the button, and the column closed ----------
await main('size', 1440, 900);
await wait(500);
{
  const b = button(),
    acts = b.parentElement,
    bb = box(b),
    others = [...acts.children].filter(el => el !== b && shown(el)),
    more = acts.querySelector('.tnt-head-menu'),
    before = others.filter(el => el !== more);

  // The order a user reads: past conversations, handoff history, the page button, the column's
  // button, and the thread's own "..." menu last.
  const order = [...acts.children].filter(shown);
  const at = selector => order.indexOf(acts.querySelector(selector));
  check(
    acts.lastElementChild === more &&
      b.nextElementSibling === more &&
      near(bb.width, bb.height, 0.6) &&
      bb.width > 26,
    'the button is the last one before the thread’s "..." menu, square (' +
      n(bb.width) +
      ' by ' +
      n(bb.height) +
      ')'
  );
  check(
    at('.tnh-open') >= 0 &&
      at('.tnh-open') < at('.tnt-head-handoff') &&
      at('.tnt-head-handoff') < at('.tnt-head-page') &&
      at('.tnt-head-page') < at('.tnt-fold-side') &&
      at('.tnt-fold-side') < at('.tnt-head-menu'),
    'the top row reads: past conversations, handoff history, the page, the column, "..." (' +
      order.map(el => el.getAttribute('aria-label') || el.textContent.trim()).join(' | ') +
      ')'
  );
  check(
    others.every(el => near(box(el).top + box(el).height / 2, bb.top + bb.height / 2, 1)) &&
      before.every(el => box(el).right <= bb.left + 0.6) &&
      box(more).left >= bb.right - 0.6,
    'it shares the row’s center line and lies over nothing'
  );
  const icon = b.querySelector('svg'),
    ib = icon ? box(icon) : null;
  check(
    !!ib &&
      near(ib.left + ib.width / 2, bb.left + bb.width / 2, 1) &&
      near(ib.top + ib.height / 2, bb.top + bb.height / 2, 1) &&
      ib.width <= bb.width * 0.6,
    'its icon is centered and at most 60% of the button'
  );
  check(
    b.getAttribute('aria-expanded') === 'false' &&
      /files/i.test(b.getAttribute('aria-label')) &&
      b.title === b.getAttribute('aria-label'),
    'closed: it says "' + b.getAttribute('aria-label') + '"'
  );
  check(!shown(side()) && column.state().shown === false, 'closed: no side column on screen');
}
await shot('thread-side-closed');

// ---------- opened: the rail is in the column, whole ----------
const widthBefore = box(mainSlot()).width;
button().click();
await wait(400);
check(
  shown(side()) && rail().closest('.tnt-sidefiles') && shown(rail()) && shown(row('src')),
  'a press opens the column with the file rail in it, src on screen'
);
check(
  button().getAttribute('aria-expanded') === 'true' &&
    /hide/i.test(button().getAttribute('aria-label')),
  'open: the button says "' + button().getAttribute('aria-label') + '"'
);
check(saved().open === true && column.state().kept === true, 'open is remembered');
{
  const tabs = side().querySelector('.tnt-sidebox-tabs');
  const names = [...tabs.querySelectorAll('[role="tab"]')]
    .filter(shown)
    .map(tab => tab.textContent.trim());
  check(
    shown(tabs) && names.join(', ') === 'Files, Details, Terminal',
    'a thread with no helpers has the tabs Files, Details and Terminal (' + names.join(', ') + ')'
  );
  const m = box(mainSlot()),
    s = box(side()),
    l = box(list());
  check(
    near(m.left - l.right, s.left - m.right, 0.8) &&
      near(box(layout).right - s.right, s.left - m.right, 0.8),
    'three islands on one spacing (' +
      n(m.left - l.right) +
      ', ' +
      n(s.left - m.right) +
      ', edge ' +
      n(box(layout).right - s.right) +
      ')'
  );
  check(
    box(mainSlot()).width < widthBefore && box(mainSlot()).width > 380,
    'the thread gave the room and is still ' + n(box(mainSlot()).width) + ' wide'
  );
  const r = getComputedStyle(rail()),
    note = rail().querySelector('.repository-rail-note'),
    alpha = color => {
      const parts = /rgba?\(([^)]+)\)/.exec(color)?.[1].split(/[,/ ]+/) || [];
      return parts.length > 3 ? Number(parts[3]) : color === 'transparent' ? 0 : 1;
    };

  // Nothing between the island and a row paints a ground of its own: no second tone, no edge.
  const grounds = [];
  for (let el = row('src').parentElement; el && el !== side(); el = el.parentElement) {
    const style = getComputedStyle(el);
    if (alpha(style.backgroundColor) > 0 || style.backgroundImage !== 'none')
      grounds.push(el.className || el.tagName);
  }
  check(
    parseFloat(r.borderLeftWidth) === 0 &&
      grounds.length === 0 &&
      parseFloat(getComputedStyle(row('src')).borderBottomWidth) === 0 &&
      (!note || parseFloat(getComputedStyle(note).borderTopWidth) === 0),
    'the rail draws no edge line, no ground of its own and no rule between rows' +
      (grounds.length ? ' (painted: ' + grounds.join(', ') + ')' : '')
  );
  const head = box(side().querySelector('.tnt-sidebox-head')),
    close = box(side().querySelector('.tnt-sidebox-close')),
    strong = rail().querySelector('.repository-rail-head strong');
  check(
    near(s.right - close.right, box(tabs).left - s.left, 1.5) && head.height > 40,
    'the top row’s inset is the same left and right (' +
      n(box(tabs).left - s.left) +
      ', ' +
      n(s.right - close.right) +
      ')'
  );
  check(!shown(strong), 'the rail’s own title is not said a second time');
}

// A folder loads when it is opened.
check(!row('src/app.js'), 'src is not loaded before it is opened');
row('src').click();
check(
  !!(await until(() => shown(row('src/app.js')))),
  'a press on the folder loads it: src/app.js is listed'
);
{
  const inner = box(rail()),
    rows = [...rail().querySelectorAll('.repo-real-tree .repo-row')].filter(shown);
  check(
    rows.length >= 3 &&
      rows.every(r => box(r).left >= inner.left - 0.5 && box(r).right <= inner.right + 0.5) &&
      rail().scrollWidth <= rail().clientWidth + 1,
    rows.length + ' rows whole inside the column, nothing scrolls sideways'
  );
  check(
    rows.every(r =>
      [...r.querySelectorAll('.repo-file-kind, .repo-file-path')].every(el => !shown(el))
    ) && row('src/app.js').title === 'src/app.js',
    'a row is its name; the path is its tip'
  );
}

// A press on a file shows its text inside the column, in place of the tree, and opens no window.
// The window itself is the test `file-viewer`; here its call is caught, so none opens.
{
  const viewer = window.TnaiFileViewer,
    real = viewer.open,
    asked = [];
  viewer.open = (...args) => {
    asked.push(args[0]);
    return Promise.resolve(true);
  };
  const view = () => document.querySelector('.tnt-sidefiles .tnt-fileview'),
    text = () => view()?.querySelector('.tnt-fileview-text'),
    back = () => view()?.querySelector('.tnt-fileview-back'),
    inWindow = () => view()?.querySelector('.tnt-fileview-window');
  const expected = new TextDecoder().decode(
    (await window.tnaiNative.fs.read('src/app.js', 0, 4096, '')).value
  );
  const treeScroll = rail().scrollTop;
  row('src/app.js').click();
  await until(() => shown(view()) && text().textContent.length > 0, 4000);
  check(
    shown(view()) && !shown(rail()) && column.state().file === 'src/app.js',
    'a press on a file shows it in the column and the tree steps aside (state "' +
      column.state().file +
      '")'
  );
  check(asked.length === 0, 'no viewer window is asked for (' + asked.length + ' calls)');
  check(
    expected.length > 0 && text().textContent === expected,
    'the column shows the file’s own text (' +
      text().textContent.length +
      ' of ' +
      expected.length +
      ' characters)'
  );
  check(
    view().querySelector('.tnt-fileview-name').textContent === 'app.js',
    'its name stands above it ("' + view().querySelector('.tnt-fileview-name').textContent + '")'
  );
  {
    const sideBox = box(side()),
      viewBox = box(view()),
      backBox = box(back()),
      windowBox = box(inWindow());
    check(
      viewBox.left >= sideBox.left - 0.5 &&
        viewBox.right <= sideBox.right + 0.5 &&
        viewBox.bottom <= sideBox.bottom + 0.5,
      'the file lies inside the column: ' +
        n(viewBox.left) +
        ' to ' +
        n(viewBox.right) +
        ' in ' +
        n(sideBox.left) +
        ' to ' +
        n(sideBox.right)
    );
    check(
      near(backBox.width, 30) &&
        near(backBox.height, 30) &&
        near(windowBox.width, 30) &&
        near(windowBox.height, 30) &&
        near(backBox.top, windowBox.top),
      'Back and Open in its own window are one size on one line: ' +
        n(backBox.width) +
        ' x ' +
        n(backBox.height) +
        ' and ' +
        n(windowBox.width) +
        ' x ' +
        n(windowBox.height)
    );
    check(
      near(backBox.left - viewBox.left, viewBox.right - windowBox.right, 1) &&
        backBox.left - viewBox.left >= 12,
      'the row keeps the same room at both ends: ' +
        n(backBox.left - viewBox.left) +
        ' and ' +
        n(viewBox.right - windowBox.right)
    );
    check(
      !!back().getAttribute('aria-label') && !!inWindow().getAttribute('aria-label'),
      'both buttons have a spoken label'
    );
  }
  await shot('thread-side-file');
  inWindow().click();
  await wait(200);
  check(
    asked[0] === 'src/app.js',
    'the window button asks for the viewer window (' + asked.join(', ') + ')'
  );
  back().click();
  await wait(200);
  check(
    !shown(view()) &&
      shown(rail()) &&
      column.state().file === '' &&
      shown(row('src/app.js')) &&
      near(rail().scrollTop, treeScroll, 1),
    'Back brings the tree back as it was (file "' +
      column.state().file +
      '", scroll ' +
      n(rail().scrollTop) +
      ' of ' +
      n(treeScroll) +
      ')'
  );
  viewer.open = real;
}

// The mark on a file an agent is touching.
window.TnaiAgents.send(paneId, "Set-Content -Path src/app.js -Value 'changed by the panel'");
check(
  !!(await until(() => shown(row('src/app.js')?.querySelector('.repo-agent-tag')), 9000)),
  'the file the panel wrote carries its mark in the column ("' +
    (row('src/app.js')?.querySelector('.repo-agent-tag')?.textContent || '') +
    '")'
);
{
  const tag = row('src/app.js')?.querySelector('.repo-agent-tag');
  check(
    !!tag && box(tag).right <= box(row('src/app.js')).right + 0.5,
    'the mark lies inside its row'
  );
}
await shot('thread-side-dark-1440');

// The search covers the whole project.
{
  const search = rail().querySelector('#repoRailSearch');
  check(shown(search) && !search.disabled, 'the search field is on screen and can be typed in');
  search.value = 'readme';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const hit = await until(() => rail().querySelector('.repo-search-hit'), 6000);
  check(
    !!hit && /README\.md/i.test(hit.textContent) && shown(hit),
    'a search finds a file outside the open folder (' + (hit?.textContent || 'nothing') + ')'
  );
  check(
    !shown(row('src')) && rail().querySelectorAll('.repo-search-hit').length === 1,
    'while the results show, the tree steps aside: the file is listed once'
  );
  await shot('thread-side-search');
  search.value = '';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  check(
    !!(await until(() => !rail().querySelector('.repo-search-hit') && shown(row('src')), 4000)),
    'clearing the search brings the tree back'
  );
}

// ---------- every window size, in both looks ----------
const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: 'low', width: 1280, height: 680 },
  { name: 'smallest', width: 768, height: 680 },
];

async function visit(look, size) {
  await main('size', size.width, size.height);
  await wait(700);
  const name = look + ' at ' + size.name + ' (page ' + innerWidth + ' by ' + innerHeight + '): ';
  const s = box(side()),
    l = box(list()),
    narrow = innerWidth <= 1140;
  check(
    shown(side()) && shown(rail()) && shown(row('src')),
    name + 'the column and its tree are on screen'
  );
  check(
    s.right <= innerWidth + 0.5 &&
      s.bottom <= innerHeight + 0.5 &&
      s.top >= 0 &&
      document.documentElement.scrollWidth <= innerWidth + 1,
    name + 'the column is whole inside the window, the page does not scroll sideways'
  );
  if (narrow) {
    check(
      !shown(mainSlot()) && !shown(document.querySelector('.layout > footer.composer')),
      name + 'the column has the thread’s place'
    );
    check(
      near(s.left - l.right, box(layout).right - s.right, 0.8) && s.width > 300,
      name + 'it fills that place (' + n(s.width) + ' wide)'
    );
  } else {
    const m = box(mainSlot());
    check(
      shown(mainSlot()) &&
        near(s.left - m.right, box(layout).right - s.right, 0.8) &&
        m.width > 380,
      name + 'the thread stays beside it, ' + n(m.width) + ' wide, the column ' + n(s.width)
    );
  }
  const head = side().querySelector('.tnt-sidebox-head'),
    close = side().querySelector('.tnt-sidebox-close');
  check(
    shown(close) && box(close).right <= s.right && box(head).bottom <= box(rail()).top + 0.6,
    name + 'Close is on screen and the top row lies over nothing'
  );
  await shot('thread-side-' + look + '-' + size.name);
}

for (const size of SIZES) await visit('dark', size);

// The way back in the narrow window: Close brings the thread and the prompt box.
side().querySelector('.tnt-sidebox-close').click();
await wait(400);
check(
  !shown(side()) &&
    shown(mainSlot()) &&
    shown(document.querySelector('.layout > footer.composer')) &&
    saved().open === false,
  'smallest window: Close brings the thread and the prompt box back, and that is remembered'
);
check(
  shown(button()) &&
    box(button()).right <= box(mainSlot()).right &&
    button().getAttribute('aria-expanded') === 'false',
  'smallest window: the button is whole in the top row and says closed'
);
await shot('thread-side-narrow-back');
button().click();
await wait(400);
check(shown(side()) && !shown(mainSlot()), 'smallest window: the button opens the column again');

theme.set('light');
await wait(500);
check(theme.resolved() === 'light', 'the look is Light');
for (const size of [SIZES[3], SIZES[0]]) await visit('light', size);
{
  // Every text of the column against the island it stands on, in Light.
  const ground = getComputedStyle(side()).backgroundColor,
    rgb = color => (/rgba?\(([^)]+)\)/.exec(color)?.[1].split(/[,/ ]+/) || []).map(Number),
    lum = ([r, g, b]) => {
      const f = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    },
    ratio = (a, b) => {
      const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
  const texts = [
    ...side().querySelectorAll(
      '.tnt-sidebox-tabs button, .repo-row-name, .repository-rail-head small, .repository-rail-note'
    ),
  ].filter(shown);
  const low = texts
    .map(el => ({ el, r: ratio(getComputedStyle(el).color, ground) }))
    .filter(t => t.r < 4.5);
  check(
    texts.length > 3 && !low.length,
    'Light: ' +
      texts.length +
      ' texts of the column read at 4.5 to 1 or more on ' +
      ground +
      (low.length ? ' (low: ' + low.map(t => t.el.className + ' ' + n(t.r)).join(', ') + ')' : '')
  );
}
theme.set('dark');
await wait(300);

// ---------- another thread, another page: the column stays ----------
window.TnaiRoute('skills');
await wait(400);
check(!layout.classList.contains('tnt-has-side') || !shown(side()), 'on another page no column');
threads.open();
await wait(400);
check(
  shown(side()) && shown(rail()) && column.state().tab === 'files',
  'back on Threads the column is open as it was left'
);

// ---------- Details: 139's part, for the open thread ----------
{
  const details = window.TnaiThreadDetails;
  const part = document.getElementById('tntSideDetails');
  const mounted = () => details.state().mounted.map(view => view.paneId);
  threads.select(paneId);
  document.getElementById('tntSideTabDetails').click();
  check(
    !!(await until(() => shown(part.querySelector('.ttd')))) &&
      column.state().tab === 'details' &&
      mounted().join() === paneId,
    'a press on Details shows the open thread’s details (mounted for ' + mounted().join() + ')'
  );
  check(
    !shown(part.querySelector('.tnt-sidedetails-none')) && !shown(rail()),
    'the "no thread" line and the files are not shown with it'
  );
  const partBox = box(part),
    sideBox = box(side());
  check(
    partBox.width > 200 && partBox.right <= sideBox.right + 1 && partBox.height > 200,
    'the part fills the column under the tabs (' +
      n(partBox.width) +
      ' by ' +
      n(partBox.height) +
      ')'
  );
  await shot('thread-side-details');
  document.getElementById('tntSideTabFiles').click();
  await wait(200);
  check(
    mounted().length === 0 && !part.querySelector('.ttd') && shown(rail()),
    'another tab chosen: the details are unmounted'
  );
  column.open('details');
  await until(() => mounted().length === 1);
  column.close();
  await wait(200);
  check(mounted().length === 0, 'the column closed: the details are unmounted');
  column.open('details');
  check(!!(await until(() => mounted().join() === paneId)), 'opened again: mounted again');

  // ---------- all four tabs at the column's narrowest ----------
  // This thread has no helpers, so the Helpers tab is shown by hand for the measuring only.
  window.TnaiThreadSideSize.set(320);
  await wait(500);
  const helpers = document.getElementById('tntSideTabHelpers');
  helpers.hidden = false;
  await wait(200);
  const tabRow = side().querySelector('.tnt-sidebox-tabs');
  const all = [...tabRow.querySelectorAll('[role="tab"]')].filter(shown);
  const close = box(side().querySelector('.tnt-sidebox-close'));
  const tops = new Set(all.map(tab => Math.round(box(tab).top)));
  check(
    all.length === 4 &&
      tops.size === 1 &&
      all.every(tab => tab.scrollWidth <= tab.clientWidth) &&
      box(tabRow).right <= close.left + 0.6 &&
      box(tabRow).left >= box(side()).left,
    'at ' +
      n(box(side()).width) +
      ' px the four tabs stand on one row, their words whole, beside the close button (' +
      all.map(tab => tab.textContent.trim() + ' ' + n(box(tab).width)).join(', ') +
      '; ' +
      n(close.left - box(tabRow).right) +
      ' px to the close button)'
  );
  await shot('thread-side-tabs-320');
  helpers.hidden = true;
  window.TnaiThreadSideSize.set(380);
  column.open('files');
  await wait(300);
}

column.close();
await wait(200);
check(!shown(side()) && saved().open === false, 'closed at the end, and remembered closed');

return { ok, log };
