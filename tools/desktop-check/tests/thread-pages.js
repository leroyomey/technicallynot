// Technically Not tools · desktop-check/tests/thread-pages.js — the thread layout's three-dots
// menu, the pages it opens and the two looks (src/scripts/124-thread-menu.js,
// src/styles/31-thread-pages.css, the look part of 32-theme-and-shortcuts.js)
// in the real app with a throwaway profile.
// The thread layout is the app: no setting, no purple glass. Parts: the
// menu is on one measured rhythm, its search and Ctrl+K work, every row opens its page, and
// every page is walked in Dark and in Light with a picture and the contrast of the text on it;
// the accent never moves the ground or a status color; nothing switches the layout off.
// Pictures: thread-pages-<look>-<page>. No agent CLI is started. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('note ' + label);
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

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
const html = document.documentElement,
  layout = document.querySelector('.layout'),
  threads = window.TnaiThreads,
  theme = window.TnaiTheme;
const box = el => el.getBoundingClientRect();
const shown = el => !!el && el.getClientRects().length > 0;
const near = (a, b, by = 0.75) => Math.abs(a - b) <= by;
const n = v => Math.round(v * 10) / 10;
const token = name => getComputedStyle(html).getPropertyValue(name).trim();

// The different values in a list. The app runs at 95% zoom, so two numbers that are the same
// measure can differ by a tenth of a pixel: numbers within half a pixel count as one.
const uniq = list => {
  const kept = [];
  for (const value of list) {
    const same = kept.some(other =>
      typeof value === 'number' ? Math.abs(other - value) <= 0.5 : other === value
    );
    if (!same) kept.push(value);
  }
  return kept;
};

// ---------- colors as numbers ----------
// Any CSS color → [r, g, b, a], read back from a canvas so every notation works.
const ink = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
const rgba = color => {
  ink.clearRect(0, 0, 1, 1);
  ink.fillStyle = '#000';
  ink.fillStyle = color;
  ink.fillRect(0, 0, 1, 1);
  const d = ink.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2], d[3] / 255];
};
const over = (top, under) => {
  const a = top[3];
  return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1);
};
const lum = c => {
  const f = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => {
  const hi = Math.max(lum(a), lum(b)),
    lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
};

// The color behind an element: every filled ancestor laid over the ground, from the page down.
// Gradients, pictures and blur are not seen, so a surface that is only a gradient reads as clear.
const groundColor = () => rgba(token('--pg-bg'));
const behind = el => {
  const fills = [];
  for (let at = el; at && at !== html; at = at.parentElement) {
    const fill = rgba(getComputedStyle(at).backgroundColor);
    if (fill[3] > 0) fills.push(fill);
  }
  return fills.reverse().reduce((under, fill) => over(fill, under), groundColor());
};

// Every piece of text now on screen, with its contrast against what is behind it. Text of a
// control that is switched off, and text set faint on purpose by an opacity, is left out.
const visibleText = scope => {
  const found = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    const el = node.parentElement;
    if (text.length < 2 || !el || el.closest('svg, script, style, .xterm')) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .tnai-inactive, [inert]')) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || !el.getClientRects().length) continue;
    const r = box(el);
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    if (r.right < 0 || r.left > innerWidth) continue;
    let opacity = 1;
    for (let at = el; at && at !== html; at = at.parentElement)
      opacity *= Number(getComputedStyle(at).opacity);
    if (opacity < 0.95) continue;
    const back = behind(el);
    const color = over(rgba(style.color), back);
    found.push({
      text: text.slice(0, 28),
      ratio: contrast(color, back),
      where: (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase(),
    });
  }
  return found;
};

// One line per page: how many texts, the lowest ratio, and the ones under 4.5 by name.
const worst = {};
const readPage = (look, page, scope) => {
  const texts = visibleText(scope || document.body);
  const low = texts.filter(t => t.ratio < 4.5).sort((a, b) => a.ratio - b.ratio);
  const lowest = texts.reduce((least, t) => Math.min(least, t.ratio), 99);
  worst[look + ' ' + page] = { count: texts.length, low: low.length, lowest };
  const names = uniq(low.map(t => n(t.ratio) + ' "' + t.text + '" .' + t.where)).slice(0, 10);
  note(
    look +
      ' · ' +
      page +
      ': ' +
      texts.length +
      ' texts, lowest ' +
      n(lowest) +
      ', under 4.5: ' +
      low.length +
      (names.length ? '\n        ' + names.join('\n        ') : '')
  );
};

// ---------- the menu ----------
const button = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const openMenu = async () => {
  if (!shown(menu())) button().click();
  return until(() => (shown(menu()) ? menu() : null), 3000);
};
const closeMenu = () => window.TnaiThreadMenu?.close();
const rowNamed = name =>
  [...menu().querySelectorAll('.tnt-menu-row')].find(
    row => row.querySelector('span').textContent.trim() === name
  );
const pressRow = async (name, find) => {
  await openMenu();

  // A row the list does not show is reached the way a person reaches it: by typing for it.
  if (find) {
    const field = menu().querySelector('.tnt-menu-search input');
    field.value = find;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
  }
  const row = rowNamed(name);
  if (!row || !shown(row)) return false;
  row.click();
  await frame();
  return true;
};
const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (target, name, more = {}) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...more })
  );

// The rows of the menu, with how to tell that each one's page shows and what closes it again.
const mode = name => () => layout.classList.contains(name + '-mode');
const settingsTab = id => () =>
  layout.classList.contains('settings-mode') &&
  shown(document.getElementById('settingsPanel-' + id));
const PAGES = [
  { row: 'Usage and accounts', name: 'usage', there: settingsTab('usage'), picture: true },
  {
    row: 'Projects',
    name: 'projects',
    there: () => window.TnaiPalette?.isOpen(),
    picture: true,
    leave: () => window.TnaiPalette?.close(),
  },
  { row: 'All threads', name: 'terminals', there: mode('terminal'), picture: true },
  { row: 'Live preview', name: 'preview', there: mode('preview'), picture: true },
  { row: 'Skills', name: 'skills', there: mode('skills'), picture: true },
  { row: 'Devices and own relay', name: 'devices', there: mode('devices'), picture: true },
  { row: 'Settings', name: 'settings', there: settingsTab('general'), picture: true },

  // Three tabs of Settings: not listed, found by the menu's search.
  { row: 'Keyboard shortcuts', find: 'keys', name: 'keyboard', there: settingsTab('keyboard') },
  { row: 'Voice and snapshot', find: 'voice', name: 'voice', there: settingsTab('voice') },
  {
    row: 'Updates and what is new',
    find: 'update',
    name: 'updates',
    there: settingsTab('updates'),
    picture: true,
  },
];

// Open every row's page in the look that is on, read its text and take its picture.
const walkPages = async look => {
  for (const page of PAGES) {
    const pressed = await pressRow(page.row, page.find);
    const there = pressed && !!(await until(page.there, 5000));
    check(
      there,
      look +
        ': "' +
        page.row +
        '" opens its page' +
        (page.find ? ' (found by typing "' + page.find + '")' : '')
    );
    if (!there) continue;
    await frame();
    await wait(450);
    check(shown(button()), look + ' · ' + page.name + ': the three-dots button is in the top bar');
    readPage(look, page.name, page.scope?.());
    if (page.picture) await shot('thread-pages-' + look + '-' + page.name);
    await page.leave?.();
    await wait(150);
  }
};

// The rows the menu always has, in order. Two more come and go with the project: worktrees
// without a panel, and Stop all agents while a session runs.
const STANDING_ROWS = [
  'Threads',
  'All threads',
  'Terminal',
  'Live preview',
  'Projects',
  'Skills',
  'Usage and accounts',
  'Devices and own relay',
  'Settings',
];

// Tabs of Settings: not in the list, shown only while a search finds them.
const SEARCH_ONLY_ROWS = ['Keyboard shortcuts', 'Voice and snapshot', 'Updates and what is new'];
const CONDITIONAL_ROWS = ['Worktrees without a panel', 'Stop all agents'];

// The menu's rhythm, read from the page.
const measureMenu = look => {
  const m = menu(),
    edge = box(m);
  const rows = [...m.querySelectorAll('.tnt-menu-row')].filter(shown),
    labels = [...m.querySelectorAll('.tnt-menu-label')].filter(shown),
    searchBox = m.querySelector('.tnt-menu-search');
  const labelNames = labels.map(label => label.textContent.trim()).join(', '),
    rowNames = rows
      .map(row => row.querySelector('span').textContent.trim())
      .filter(name => !CONDITIONAL_ROWS.includes(name));
  const rowHeights = uniq([...rows, searchBox].map(el => n(box(el).height))),
    labelHeights = uniq(labels.map(el => n(box(el).height)));
  check(
    rowHeights.length === 1 && near(rowHeights[0], 30),
    look +
      ': every row and the search field are one height (' +
      rowHeights.join(', ') +
      ', expected 30)'
  );
  check(
    labelHeights.length === 1 && near(labelHeights[0], 28),
    look + ': every group label is one height (' + labelHeights.join(', ') + ', expected 28)'
  );
  check(
    labels.map(label => label.textContent.trim()).join() === 'Work,This app',
    look + ': two group labels, Work and This app, and no Appearance (' + labelNames + ')'
  );
  check(
    rowNames.join() === STANDING_ROWS.join(),
    look +
      ': the rows are the nine named ones in their order, Alerts is not among them (' +
      rowNames.join(', ') +
      ')'
  );
  check(
    SEARCH_ONLY_ROWS.every(name => !!rowNamed(name) && !shown(rowNamed(name))),
    look + ': the three tabs of Settings are not listed until a search finds them'
  );
  check(
    !m.querySelector(
      '.tnt-menu-seg, .tnt-menu-dots, .tnt-menu-look, [data-look], [data-accent-set]'
    ),
    look + ': the menu has no look switch and no accent swatches'
  );

  // Labels: the text stands in the middle of its row.
  const labelOff = labels.map(label => {
    const range = document.createRange();
    range.selectNodeContents(label);
    const text = range.getBoundingClientRect(),
      r = box(label);
    return n(text.top - r.top - (r.bottom - text.bottom));
  });
  check(
    labelOff.every(off => Math.abs(off) <= 2),
    look +
      ': a label has the same room above and below its text (difference ' +
      labelOff.join(', ') +
      ')'
  );

  // One column for the icons (the search field's too) and one for the text.
  const iconLefts = uniq(
    [...rows, searchBox].map(el => n(box(el.querySelector('svg')).left - edge.left))
  );
  const textLefts = uniq([
    ...rows.map(row => n(box(row.querySelector('span')).left - edge.left)),
    n(box(searchBox.querySelector('input')).left - edge.left),
  ]);
  const labelLefts = uniq(
    labels.map(label => {
      const range = document.createRange();
      range.selectNodeContents(label);
      return n(range.getBoundingClientRect().left - edge.left);
    })
  );
  check(
    iconLefts.length === 1,
    look +
      ': icons stand in one column, the search icon too (' +
      iconLefts.join(', ') +
      ' from the edge)'
  );
  check(
    textLefts.length === 1,
    look + ': row text and the search text start on one line (' + textLefts.join(', ') + ')'
  );
  check(
    labelLefts.length === 1 && near(labelLefts[0], iconLefts[0], 1),
    look + ": group labels start in the icons' column (" + labelLefts.join(', ') + ')'
  );
  const iconToText = uniq(
    rows.map(row => n(box(row.querySelector('span')).left - box(row.querySelector('svg')).right))
  );
  check(
    iconToText.length === 1,
    look + ': one gap from icon to text (' + iconToText.join(', ') + ')'
  );

  // The same room on all four sides, and boxes from edge to edge.
  const kids = [...m.children].filter(shown),
    top = box(kids[0]).top - edge.top,
    bottom = edge.bottom - box(kids[kids.length - 1]).bottom,
    left = box(rows[0]).left - edge.left,
    right = edge.right - box(rows[0]).right;
  check(
    near(top, bottom) && near(left, right) && near(top, left),
    look +
      ': the same room on all four sides: top ' +
      n(top) +
      ', bottom ' +
      n(bottom) +
      ', left ' +
      n(left) +
      ', right ' +
      n(right)
  );
  const widths = uniq([...rows, searchBox].map(el => n(box(el).width)));
  check(
    widths.length === 1,
    look + ': rows and the search field are one width (' + widths.join(', ') + ')'
  );

  // Gaps: none between rows of a group, one small step under the search field.
  const all = [searchBox, ...m.querySelectorAll('.tnt-menu-label, .tnt-menu-row')].filter(shown);
  const gaps = all.slice(1).map((el, i) => n(box(el).top - box(all[i]).bottom));
  const steps = uniq(gaps.filter(gap => Math.abs(gap) > 0.5));
  check(
    gaps.filter(gap => Math.abs(gap) > 0.5).length === 1 && steps.length === 1 && near(steps[0], 4),
    look +
      ': no gap between rows, and one step of 4 under the search field (gaps ' +
      gaps.join(' ') +
      ')'
  );

  // One material with the islands: the menu's fill is the look's "over" color.
  const fill = rgba(getComputedStyle(m).backgroundColor),
    want = rgba(token('--tnt-over'));
  check(
    fill.every((v, i) => Math.abs(v - want[i]) < 0.02 * (i === 3 ? 1 : 255)),
    look + ": the menu is the islands' own material (" + getComputedStyle(m).backgroundColor + ')'
  );
  check(
    edge.left >= 0 &&
      edge.right <= innerWidth &&
      edge.bottom <= innerHeight &&
      edge.top >= box(button()).bottom,
    look +
      ': the menu is inside the window and under its button (menu ' +
      [edge.left, edge.top, edge.right, edge.bottom].map(n).join(' ') +
      ', button bottom ' +
      n(box(button()).bottom) +
      ', window ' +
      innerWidth +
      ' x ' +
      innerHeight +
      ')'
  );
  note(
    look +
      ' menu, measured: rows ' +
      rowHeights.join(',') +
      ', labels ' +
      labelHeights.join(',') +
      ', icons at ' +
      iconLefts.join(',') +
      ', text at ' +
      textLefts.join(',') +
      ', icon to text ' +
      iconToText.join(',') +
      ', sides ' +
      n(left) +
      ' and ' +
      n(right) +
      ', top ' +
      n(top) +
      ', bottom ' +
      n(bottom) +
      ', width ' +
      n(edge.width) +
      ', height ' +
      n(edge.height)
  );
};

// The look's own text steps against the island and against a card on the ground.
const measureTokens = look => {
  const island = rgba(token('--tnt-island')),
    card = over(rgba(token('--pg-panel')), groundColor()),
    menuFill = over(rgba(token('--tnt-over')), groundColor());
  const steps = ['--pg-text', '--pg-text-2', '--pg-text-3', '--pg-text-4'].map(name =>
    rgba(token(name))
  );
  const line = back => steps.map(step => n(contrast(step, back))).join(' / ');
  note(
    look +
      ' text contrast, main / second / third / fourth: on an island ' +
      line(island) +
      '; on a card ' +
      line(card) +
      '; on the menu ' +
      line(menuFill)
  );
  const body = [island, card, menuFill].flatMap(back =>
    steps.slice(0, 3).map(step => contrast(step, back))
  );
  check(
    body.every(ratio => ratio >= 4.5),
    look +
      ': main, second and third text are 4.5 to 1 or more on an island, a card and the menu (lowest ' +
      n(Math.min(...body)) +
      ')'
  );
  const send = document.querySelector('.composebox .send');
  if (send) {
    const onSend = rgba(token('--tnt-on-send'));
    const ends = (
      getComputedStyle(send).backgroundImage.match(/rgba?\([^)]*\)/g) || [
        getComputedStyle(send).backgroundColor,
      ]
    ).map(rgba);
    note(look + ' Send: ink on its fill ' + ends.map(end => n(contrast(onSend, end))).join(' to '));
  }
};

try {
  await until(() => layout.className.includes('-mode'), 5000);
  await wait(600);

  // ---- A: the thread layout is the app: there is no setting, and no purple glass to go back to
  // ----
  check(!!threads && threads.enabled() === true, 'the thread layout is on, with no setting');

  // ---- B: on, Dark ----
  threads.open();
  check(!!(await until(() => threads.visible(), 5000)), 'the setting turns the layout on');
  await frame();
  await wait(400);
  check(
    html.classList.contains('tnt-on') &&
      theme.threadLook() === true &&
      html.dataset.theme === 'dark',
    'on: the look class is set and the look is Dark'
  );
  check(
    token('--pg-bg') === '#0e0e13' && token('--pg-text') === '#ededf2',
    'Dark: a clean neutral ground and text (ground ' +
      token('--pg-bg') +
      ', text ' +
      token('--pg-text') +
      ')'
  );

  // Neutral: the three color channels of a #rrggbb ground lie within a few steps of each other
  // (purple glass had far more blue than green).
  const channels = (theme.xterm().background.match(/[0-9a-f]{2}/gi) || []).map(hex =>
    parseInt(hex, 16)
  );
  check(
    channels.length === 3 && Math.max(...channels) - Math.min(...channels) <= 12,
    "Dark: the terminal's ground is neutral too (" + theme.xterm().background + ')'
  );
  measureTokens('Dark');

  check(!!(await openMenu()), 'a press on the three-dots button opens the menu');
  await frame();
  await wait(250);
  measureMenu('Dark');
  await shot('thread-pages-dark-menu');

  // ---- C: search, Enter, Escape, Ctrl+K ----
  {
    const m = menu(),
      input = m.querySelector('.tnt-menu-search input');
    const names = () =>
      [...m.querySelectorAll('.tnt-menu-row')]
        .filter(shown)
        .map(row => row.querySelector('span').textContent.trim());
    type(input, 'usage');
    check(
      names().join() === 'Usage and accounts',
      'typing "usage" leaves that one row (' + names().join(', ') + ')'
    );
    check(
      [...m.querySelectorAll('.tnt-menu-label')]
        .filter(shown)
        .map(label => label.textContent.trim())
        .join() === 'This app',
      'a group with no match leaves with its label; only "This app" stays, where Usage is'
    );
    type(input, 'phone');
    check(
      names().join() === 'Live preview,Devices and own relay',
      'a word that is not in a name finds rows too: "phone" (' + names().join(', ') + ')'
    );
    type(input, 'zzzz');
    check(
      names().length === 0 && shown(m.querySelector('.tnt-menu-none')),
      'no match says "Nothing by that name."'
    );
    type(input, 'agent tree');
    check(
      !names().includes('Overview'),
      'the old Overview has no row, also not by search (' + (names().join(', ') || 'none') + ')'
    );
    type(input, '');
    check(
      names()
        .filter(name => !CONDITIONAL_ROWS.includes(name))
        .join() === STANDING_ROWS.join(),
      'an empty field shows the nine standing rows again (' + names().length + ')'
    );
    key(input, 'Escape');
    check(
      !shown(m) && document.activeElement === button(),
      'Escape closes the menu and the button has the focus again'
    );

    key(document.body, 'k', { ctrlKey: true });
    check(
      !!(await until(() => shown(menu()), 2000)) &&
        document.activeElement === input &&
        !window.TnaiPalette?.isOpen(),
      'Ctrl+K opens the menu with the cursor in its search field, and not the command menu'
    );
    type(input, 'skills');
    key(input, 'Enter');
    check(
      !!(await until(mode('skills'), 4000)) && !shown(menu()),
      'Enter opens the first match: Skills'
    );
    key(document.body, 'k', { ctrlKey: true });
    await until(() => shown(menu()), 2000);
    key(document.body, 'k', { ctrlKey: true });
    check(!shown(menu()), 'Ctrl+K again closes it');
  }

  // ---- D: every page, Dark ----
  await walkPages('dark');
  threads.open();
  await until(() => threads.visible(), 4000);
  await wait(300);
  readPage('dark', 'threads');
  await shot('thread-pages-dark-threads');

  // ---- E: Light, chosen the way Settings does it (the menu has no look switch) ----
  theme.set('light');
  await frame();
  await wait(500);
  await openMenu();
  await frame();
  await wait(250);
  check(
    theme.resolved() === 'light' && !html.hasAttribute('data-theme'),
    'Light switches the look'
  );
  check(
    token('--pg-bg') === '#e9e7e1' && token('--pg-text') === '#26232d',
    'Light: an off-white ground, not white, and a soft near-black text (ground ' +
      token('--pg-bg') +
      ', text ' +
      token('--pg-text') +
      ')'
  );
  check(
    theme.xterm().background === '#f7f6f4',
    'Light: the terminal is on the off-white island (' + theme.xterm().background + ')'
  );
  measureTokens('Light');
  measureMenu('Light');
  await shot('thread-pages-light-menu');
  closeMenu();
  await walkPages('light');
  threads.open();
  await until(() => threads.visible(), 4000);
  await wait(300);
  readPage('light', 'threads');
  await shot('thread-pages-light-threads');

  // ---- F: the accent, in both looks: the ground and the status colors never follow it ----
  for (const look of ['light', 'dark']) {
    theme.set(look);
    await frame();
    await wait(300);
    const before = {
      ground: token('--pg-bg'),
      work: token('--pg-work'),
      wait: token('--pg-wait'),
      ready: token('--pg-ready'),
      err: token('--pg-err'),
      accent: token('--pg-accent-rgb'),
    };

    // The accents are chosen in Settings › General › Color; the picker's own radio is pressed.
    window.TnaiSettings.open('general');
    await until(settingsTab('general'), 4000);
    await wait(300);
    for (const name of ['rose', 'teal', 'neutral']) {
      const radio = document.querySelector('.tnai-accent-options input[value="' + name + '"]');
      radio?.click();
      await frame();
      await wait(200);
      const now = {
        ground: token('--pg-bg'),
        work: token('--pg-work'),
        wait: token('--pg-wait'),
        ready: token('--pg-ready'),
        err: token('--pg-err'),
        accent: token('--pg-accent-rgb'),
      };
      check(
        theme.accent() === name && now.accent !== before.accent,
        look + ': the ' + name + ' accent in the picker changes the accent (' + now.accent + ')'
      );
      check(
        now.ground === before.ground &&
          now.work === before.work &&
          now.wait === before.wait &&
          now.ready === before.ready &&
          now.err === before.err,
        look + ' · ' + name + ': the ground and the four status colors did not move'
      );
      check(!!radio?.checked, look + ' · ' + name + ': its radio is marked');
    }
    if (look === 'dark') {
      await openMenu();
      await shot('thread-pages-dark-teal-menu');
      closeMenu();
    }
    theme.setAccent('purple');
    await wait(200);
  }

  // ---- G: Settings › General has the Look row and four accents ----
  window.TnaiSettings.open('general');
  await until(settingsTab('general'), 4000);
  await wait(300);
  {
    const row = document.querySelector('#tnaiAppearanceMount .tnt-look-row');
    const accents = [...document.querySelectorAll('.tnai-accent-options label')]
      .filter(shown)
      .map(label => label.title);
    check(shown(row), 'Settings › General › Color has a Look row');
    check(
      accents.join() === 'Purple,Teal,Rose,Neutral',
      'and offers four accents, without Blue and Sunset (' + accents.join(', ') + ')'
    );
    row?.querySelector('[data-look="light"]').click();
    await frame();
    await wait(300);
    check(theme.resolved() === 'light', 'the Look row switches to Light');
    row?.querySelector('[data-look="dark"]').click();
    await wait(300);
    check(theme.resolved() === 'dark', 'and back to Dark');
  }

  // ---- H: nothing switches the layout off ----
  check(
    typeof threads.setEnabled === 'undefined' && html.classList.contains('tnt-on'),
    'the layout cannot be switched off: the menu and the looks stay'
  );
  theme.set('dark');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
