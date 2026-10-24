// Technically Not tools · desktop-check/tests/thread-collapse.js — show and hide for the thread
// layout's two side columns (src/scripts/127-thread-collapse.js) in the real app, with a throwaway
// profile and two real PowerShell threads, on the All threads page.
// Checked here: two buttons of one kind with spoken labels; the four states (both
// open, the list hidden, the preview hidden, both hidden) at 1440 and at 1280 wide with nothing
// cut and nothing over anything else in the top row; each terminal is sent one new size at most
// per change; Ctrl+B, and not while a terminal has the keyboard; the list's state is kept per page.
// Pictures: thread-collapse-open, -no-list, -no-preview, -none (1440 wide). Returns {ok, log}.
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

// A call into this test's main-process half: the window size, a real key.
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
  page = document.getElementById('terminalView'),
  content = page.querySelector('.terminal-content');
const box = el => el.getBoundingClientRect();
const shown = el =>
  !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const n = v => Math.round(v * 10) / 10;
const near = (a, b, by = 1.5) => Math.abs(a - b) <= by;
const listButton = document.querySelector('.top .tnt-fold-list'),
  previewButton = page.querySelector('.terminal-tools .tnt-fold-preview');
const list = () => threads.slot('list'),
  preview = () => page.querySelector('.tp-preview');
const sent = ids => ids.map(id => agents.sizeHistory(id).filter(e => e.kind === 'pty').length);

// The things a person reads or presses in the page's top row, and every pair that shares space.
const rowItems = () =>
  [
    ...page.querySelectorAll(
      '.terminal-toolbar .terminal-title, .terminal-toolbar button, .terminal-toolbar [role="tab"]'
    ),
  ].filter(el => shown(el) && box(el).width > 2);
const nameOf = el =>
  (el.textContent || el.title || el.getAttribute('aria-label') || el.className || el.tagName)
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 22);

function rowFaults() {
  const items = rowItems(),
    bar = box(page.querySelector('.terminal-toolbar')),
    found = [];
  for (let a = 0; a < items.length; a++) {
    const one = box(items[a]);
    if (one.left < bar.left - 1 || one.right > bar.right + 1)
      found.push('"' + nameOf(items[a]) + '" outside the row');
    for (let b = a + 1; b < items.length; b++) {
      if (items[a].contains(items[b]) || items[b].contains(items[a])) continue;
      const two = box(items[b]);
      const wide = Math.min(one.right, two.right) - Math.max(one.left, two.left),
        high = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);

      // A workspace tab's own two small buttons share 2 px on purpose (test thread-terminal).
      if (wide > 2.5 && high > 2.5)
        found.push('"' + nameOf(items[a]) + '" over "' + nameOf(items[b]) + '" by ' + n(wide));
    }
  }
  return { count: items.length, found };
}

// One state of the two columns: what shows, that nothing is cut, and what it cost the terminals.
async function visit(width, listOpen, previewOpen, ids, shot) {
  const before = sent(ids);
  if ((listButton.getAttribute('aria-expanded') === 'true') !== listOpen) listButton.click();
  if ((previewButton.getAttribute('aria-expanded') === 'true') !== previewOpen)
    previewButton.click();
  await wait(1800);
  const name =
    'at ' +
    width +
    ', the list ' +
    (listOpen ? 'shown' : 'hidden') +
    ' and the preview ' +
    (previewOpen ? 'shown' : 'hidden') +
    ': ';
  const cb = box(content),
    row = rowFaults(),
    // the page shows the threads (135): the ones on the page now; a thread one step away is not
    // on screen and not counted
    onPage = window.TnaiAllThreads?.state?.().shown || [],
    panes = onPage
      .map(paneId => page.querySelector('.tat-card[data-pane="' + paneId + '"]'))
      .filter(shown);
  check(
    shown(list()) === listOpen && shown(preview()) === previewOpen,
    name + 'that is what is on screen'
  );
  const leftEdge = listOpen ? box(list()).right : 0,
    rightEdge = previewOpen ? box(preview()).left : innerWidth;
  check(
    cb.left >= leftEdge - 0.5 && cb.right <= rightEdge + 0.5 && cb.width > 280,
    name +
      'the threads have the room between them (' +
      n(cb.left) +
      ' to ' +
      n(cb.right) +
      ' of ' +
      innerWidth +
      ', free from ' +
      n(leftEdge) +
      ' to ' +
      n(rightEdge) +
      ')'
  );
  check(
    panes.length > 0 &&
      panes.every(p => box(p).left >= cb.left - 1 && box(p).right <= cb.right + 1) &&
      document.documentElement.scrollWidth <= innerWidth + 1,
    name + panes.length + ' threads whole inside their box, the page does not scroll sideways'
  );
  check(
    !row.found.length,
    name +
      'nothing in the top row is cut or over anything else (' +
      row.count +
      ' items' +
      (row.found.length ? ': ' + row.found.join('; ') : '') +
      ')'
  );
  const cost = sent(ids).map((count, i) => count - before[i]);
  check(
    cost.every(c => c <= 1),
    name + 'each terminal was sent one new size at most (' + cost.join(', ') + ')'
  );
  if (shot) {
    console.log('TNAI_SHOT:' + shot);
    await wait(600);
  }
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
  for (let i = 0; i < 2; i++) await openThread('Terminal');
  check(
    !!(await until(() => agents.sessions().filter(s => s.running).length >= 2, 20000)),
    'setup: two PowerShell threads running'
  );
  const ids = agents.sessions().map(s => s.paneId);

  // the All threads page: the route 'terminal' is that page
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode') && shown(page), 5000);
  await main('size', 1440, 900);
  await wait(900);

  // ---- the top bar's chips stand evenly at every window size ----
  // The app scales its page to the window, so a gap that is one number in the style sheet can
  // land on different counts of screen pixels. What the eye sees is measured: the screen pixels
  // between two chips, with a usage chip like the one a signed-in agent adds.
  {
    // The System chip (81) stands first; Claude's chip (80) right after it.
    const systemChip = document.getElementById('pgSysChip');
    let made = null;
    if (systemChip && !document.querySelector('.top-right > .pg-chip[data-m="plan"]')) {
      made = document.createElement('span');
      made.className = 'pg-chip';
      made.dataset.m = 'plan';
      made.innerHTML = '<span class="k">Claude</span><span class="v">5% <small>5h</small></span>';
      systemChip.after(made);
    }
    for (const [width, height] of [
      [1440, 900],
      [1600, 900],
      [1920, 1000],
      [1360, 800],
    ]) {
      await main('size', width, height);
      await wait(700);
      const scale = window.devicePixelRatio;
      const chips = [...document.querySelectorAll('.top .top-right .pg-chip')]
        .filter(shown)
        .sort((first, second) => box(first).left - box(second).left);
      const gaps = chips
        .slice(1)
        .map(
          (chip, index) =>
            Math.round(box(chip).left * scale) - Math.round(box(chips[index]).right * scale)
        );
      const cssGaps = chips
        .slice(1)
        .map((chip, index) => n(box(chip).left - box(chips[index]).right));
      check(
        chips.length >= 3 && gaps.every(gap => gap === gaps[0]),
        width +
          ' x ' +
          height +
          ' (scale ' +
          n(scale * 100) / 100 +
          '): the screen pixels between two chips are one number: ' +
          gaps.join(', ') +
          ' (in the page: ' +
          cssGaps.join(', ') +
          ')'
      );
    }
    made?.remove();
    await main('size', 1440, 900);
    await wait(700);
  }

  // ---- two buttons of one kind ----
  const a = box(listButton),
    b = box(previewButton),
    ia = box(listButton.querySelector('svg')),
    ib = box(previewButton.querySelector('svg'));
  const word = previewButton.querySelector('.tnt-fold-word');
  check(
    shown(word) && word.textContent === 'Preview' && b.width > a.width,
    'in a wide window the preview button says what it is: "' +
      (word?.textContent || '') +
      '", ' +
      n(b.width) +
      ' px wide'
  );
  check(
    shown(listButton) && shown(previewButton) && near(a.height, b.height, 0.5),
    'the list button (top bar) and the preview button (the page top row) are one height: ' +
      n(a.width) +
      ' x ' +
      n(a.height) +
      ' and ' +
      n(b.width) +
      ' x ' +
      n(b.height)
  );
  check(
    near(ia.width, ib.width, 0.5) &&
      near(ia.left + ia.width / 2, a.left + a.width / 2, 1) &&
      near(ia.top + ia.height / 2, a.top + a.height / 2, 1) &&
      near(ib.top + ib.height / 2, b.top + b.height / 2, 1) &&
      ia.width <= a.width * 0.6 + 0.5,
    'their icons are one size (' + n(ia.width) + '), centered in height, at most 60% of the button'
  );
  {
    // The preview button: icon, then its word, with the same room at both ends.
    const wordBox = box(word);
    check(
      near(ib.left - b.left, b.right - wordBox.right, 1) && wordBox.left - ib.right >= 5,
      'the preview button keeps the same room at both ends (' +
        n(ib.left - b.left) +
        ' and ' +
        n(b.right - wordBox.right) +
        ') and ' +
        n(wordBox.left - ib.right) +
        ' px between icon and word'
    );
  }
  check(
    listButton.getAttribute('aria-expanded') === 'true' &&
      previewButton.getAttribute('aria-expanded') === 'true' &&
      /Hide the thread list/.test(listButton.getAttribute('aria-label')) &&
      previewButton.getAttribute('aria-label') === 'Hide the preview',
    'both are open and say so in a spoken label ("' +
      listButton.getAttribute('aria-label') +
      '", "' +
      previewButton.getAttribute('aria-label') +
      '")'
  );
  const top = box(document.querySelector('.top'));
  const neighbors = [...listButton.parentElement.children].filter(
    el => el !== listButton && shown(el)
  );
  check(
    a.top >= top.top &&
      a.bottom <= top.bottom &&
      neighbors.every(el => box(el).right <= a.left + 0.5 || box(el).left >= a.right - 0.5),
    'the list button lies inside the top bar and over nothing beside it'
  );

  // Touching is not enough room: the button's hover fill is its whole box, so a box that lies
  // against the logo looks drawn over it.
  const logo = box(document.querySelector('.top .brand'));
  check(
    a.left - logo.right >= 7.5,
    'the list button keeps 8 px from the logo: ' + n(a.left - logo.right) + ' px'
  );

  // ---- the four states, at both widths ----
  await visit(1440, true, true, ids, 'thread-collapse-open');
  await visit(1440, false, true, ids, 'thread-collapse-no-list');
  check(
    /Show the thread list/.test(listButton.getAttribute('aria-label')) &&
      listButton.getAttribute('aria-expanded') === 'false',
    'hidden, the list button says "' + listButton.getAttribute('aria-label') + '"'
  );
  await visit(1440, true, false, ids, 'thread-collapse-no-preview');
  check(
    previewButton.getAttribute('aria-label') === 'Show the preview',
    'hidden, the preview button says "' + previewButton.getAttribute('aria-label') + '"'
  );
  await visit(1440, false, false, ids, 'thread-collapse-none');

  // Both columns hidden: the terminals stand as far from the window's left edge as from its right.
  const edges = sel => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    return el ? n(box(el).left) + ' to ' + n(box(el).right) : 'none';
  };
  const roomLeft = n(box(content).left),
    roomRight = n(innerWidth - box(content).right);
  check(
    near(roomLeft, roomRight, 1),
    'with both hidden the terminals have the same room on both sides (left ' +
      roomLeft +
      ', right ' +
      roomRight +
      '; layout ' +
      edges('.layout') +
      ', workspace ' +
      edges('.workspace') +
      ', page ' +
      edges(page) +
      ', top row ' +
      edges('#terminalView .terminal-toolbar') +
      ', padding ' +
      getComputedStyle(page).paddingLeft +
      ' ' +
      getComputedStyle(page).paddingRight +
      ', window ' +
      innerWidth +
      '; narrow parts of the layout: ' +
      ([...layout.children]
        .filter(el => el.getClientRects().length && box(el).width <= 10)
        .map(el => el.tagName + '.' + el.className + ' ' + edges(el))
        .join(', ') || 'none') +
      '; columns ' +
      getComputedStyle(layout).gridTemplateColumns +
      ')'
  );
  await main('size', 1280, 800);
  await wait(900);
  await visit(1280, false, false, ids, 'thread-collapse-1280-none');
  await visit(1280, true, false, ids, '');
  await visit(1280, false, true, ids, '');
  await visit(1280, true, true, ids, 'thread-collapse-1280-open');

  // ---- Ctrl+B ----
  document.activeElement?.blur?.();
  let pageSaw = 0;
  const count = e => {
    if (e.key.toLowerCase() === 'b' && e.ctrlKey) pageSaw++;
  };
  window.addEventListener('keydown', count, true);
  await main('key', 'B', ['control']);
  const realKey = pageSaw > 0;
  const press = target =>
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true })
    );
  if (!realKey) press(document.body);
  await wait(400);
  check(
    !shown(list()) && layout.classList.contains('tnt-list-closed'),
    'Ctrl+B hides the thread list (' +
      (realKey
        ? 'a real key press'
        : 'a key event sent by script: the real press did not reach the test window') +
      ')'
  );

  // With the keyboard in a terminal the key belongs to the program there. The terminal a user
  // has is a thread's CLI screen, on the Threads page, where the list is shown: it must stay.
  threads.show(ids[0]);
  await until(() => window.TnaiThreadView.shown() === ids[0], 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  const input = await until(
    () => window.TnaiThreadView.term()?.element?.querySelector('textarea'),
    8000
  );
  const listWas = !!(await until(() => shown(list()), 3000));
  if (input) press(input);
  await wait(300);
  check(
    !!input && listWas && shown(list()),
    'with the keyboard in a CLI screen Ctrl+B is the terminal program own key: the list stayed as it was (input ' +
      !!input +
      ', list before ' +
      listWas +
      ', after ' +
      shown(list()) +
      ')'
  );
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode') && shown(page), 5000);
  await wait(400);
  check(!shown(list()), 'and back on All threads the list is still hidden');
  press(document.body);
  await wait(400);
  check(shown(list()), 'Ctrl+B again shows it');
  window.removeEventListener('keydown', count, true);

  // ---- the list's state is kept per page ----
  listButton.click();
  await wait(300);
  window.TnaiRoute('skills');
  await until(() => !layout.classList.contains('terminal-mode'), 3000);
  await wait(500);
  check(
    shown(list()) && listButton.getAttribute('aria-expanded') === 'true',
    'hidden on All threads, the list is still shown on the Skills page'
  );
  threads.open();
  await until(() => threads.visible(), 3000);
  await wait(300);
  const mainSlot = threads.slot('main');
  const openLeft = n(box(mainSlot).left);
  listButton.click();
  await wait(400);
  check(
    !shown(list()) && near(box(mainSlot).left, 12, 1.5),
    'on Threads the hidden list leaves the thread 12 px from the window edge, like the other sides (it stood at ' +
      openLeft +
      ', now ' +
      n(box(mainSlot).left) +
      ')'
  );
  listButton.click();
  await wait(300);
  check(
    shown(list()) && near(box(mainSlot).left, openLeft),
    'and shown again the thread is where it was'
  );
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode'), 3000);
  await wait(500);
  check(!shown(list()), 'back on All threads the list is hidden, as it was left there');
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('tnai.thread-collapse.v1') || '{}');
  } catch {}
  check(
    saved.closed?.['terminal-mode'] === true && Object.keys(saved.closed).length === 1,
    'saved for the next start: ' + JSON.stringify(saved)
  );
  listButton.click();
  await main('size', 1440, 900);
  await wait(400);

  threads.open();
  agents.sessions().forEach(s => agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
