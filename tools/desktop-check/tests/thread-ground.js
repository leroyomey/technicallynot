// Technically Not tools · desktop-check/tests/thread-ground.js — one ground for the whole window
// and no hard cut on it, in the real app with a throwaway profile and two real PowerShell threads.
// Walked in Dark and in Light at four window sizes: Threads, a thread on its CLI screen, All
// threads, Usage, Skills, Settings and the open menu, with the side columns shown and hidden.
// Checked from a capture of the window, not from the style sheets: along lines across the page
// every change of color between two neighboring pixels is listed with what lies on each side, and
// none may be a line or a band of the frame itself (the top bar, the list's column, a page's top
// row). The terminal's text is measured against the color the window shows behind it.
// Pictures: ground-<look>-<size>-<page>. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = text => log.push('     ' + text);
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};

// A call into this test's main-process half: the window size, the colors along a line.
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
  terminalPage = document.getElementById('terminalView');
const box = el => el.getBoundingClientRect();
const shown = el =>
  !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const n = v => Math.round(v * 10) / 10;
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(650);
};

// ---------- colors ----------
const parts = packed => [packed >> 16, (packed >> 8) & 255, packed & 255];
const step = (a, b) => {
  const one = parts(a),
    two = parts(b);
  return Math.max(Math.abs(one[0] - two[0]), Math.abs(one[1] - two[1]), Math.abs(one[2] - two[2]));
};
const hexOf = packed => '#' + packed.toString(16).padStart(6, '0');
const light = value => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lum = rgb => 0.2126 * light(rgb[0]) + 0.7152 * light(rgb[1]) + 0.0722 * light(rgb[2]);
const contrast = (a, b) => {
  const one = lum(a),
    two = lum(b);
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
};
const fromHex = hex => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  return m ? parts(parseInt(m[1], 16)) : null;
};

// ---------- what lies at a point ----------
// Text, pictures, controls and a terminal's own screen change color by their nature: an edge
// there is content, not a cut of the frame.
const CONTENT =
  'button, input, textarea, select, a, kbd, svg, img, canvas, iframe, webview, .xterm, ' +
  '[role="tab"], [role="switch"], [role="slider"], .tnt-menu, .tnai-bell-pop';
const nameOf = el => {
  if (!el) return 'nothing';
  const id = el.id ? '#' + el.id : '';
  const cls = [...el.classList].slice(0, 2).join('.');
  return el.tagName.toLowerCase() + id + (cls ? '.' + cls : '');
};

// The parts of the frame itself: what must never show as a line or a band of another tone.
const FRAME = [
  'html',
  'body',
  '.app',
  '.top',
  '.top-left',
  '.top-right',
  '.layout',
  '.layout > .sidebar',
  '.layout > .workspace',
  '.layout > main',
  // on Threads the prompt box is the lower half of the thread's island, not a part of the frame
  '.layout:not(.threads-mode) > footer.composer',
  '#terminalView',
  '#terminalView > .terminal-toolbar',
  '#terminalView > .terminal-content',
  '.terminal-workspace-view',
  '.terminal-workspace-grid',
  '#settingsPage',
  '.settings-inner',
  '.skills-page',
].join(', ');

// Also a part of the frame: any box with square corners that spans most of the page beside the
// list. A surface has round corners; a square box that large is a page or a column of one.
const painted = style => {
  const fill = /rgba?\(([^)]+)\)/.exec(style.backgroundColor);
  const alpha = fill ? (fill[1].split(',')[3] === undefined ? 1 : +fill[1].split(',')[3]) : 0;
  return alpha > 0.004 || style.backgroundImage !== 'none';
};

// Inside a surface: an ancestor with round corners and a fill of its own (an island, a card, a
// terminal). What lies in there is the surface's own matter, not the frame.
const inSurface = el => {
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    const style = getComputedStyle(up);
    if (parseFloat(style.borderTopLeftRadius) > 0 && painted(style)) return true;
  }
  return false;
};
const isFrame = el => {
  if (!el) return false;
  if (el.matches(FRAME)) return true;
  if (el.closest(CONTENT) || inSurface(el)) return false;
  const b = box(el);
  return (
    b.width >= innerWidth * 0.55 &&
    b.height >= innerHeight * 0.55 &&
    parseFloat(getComputedStyle(el).borderTopLeftRadius) === 0
  );
};
const frameParts = () => [...document.querySelectorAll('body, body *')].filter(isFrame);

// The film grain on the ground moves single pixels by up to 7 steps. A line is a step
// of at least this much that is also there 9 px to the side: grain is not, nor is a letter.
const CUT = 9;
const TWIN = 9;

// Boxes with square corners and a fill of their own that are not controls and lie in no surface:
// a band. Named with their size, so each can be judged.
function squareFills() {
  const found = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest(CONTENT)) continue;
    const b = box(el);
    if (b.width < 160 || b.height < 20 || b.bottom < 0 || b.top > innerHeight) continue;
    const style = getComputedStyle(el);
    if (!painted(style) || parseFloat(style.borderTopLeftRadius) > 0 || inSurface(el)) continue;
    found.push(nameOf(el) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
  }
  return found;
}

// A line on one side only, on a box that is not a control: a rule under a header, between two
// areas, down one side. Named with how often, so each can be judged.
function oneSided() {
  const found = new Map();
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || el.closest(CONTENT)) continue;
    const b = box(el);
    if (b.width < 60 || b.bottom < 0 || b.top > innerHeight) continue;
    const style = getComputedStyle(el);
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(
      side =>
        parseFloat(style['border' + side + 'Width']) > 0 &&
        style['border' + side + 'Style'] !== 'none' &&
        !/, 0\)$|transparent/.test(style['border' + side + 'Color'])
    );
    if (!sides.length || sides.length === 4) continue;
    const key = nameOf(el) + ' ' + sides.join('+');
    found.set(key, (found.get(key) || 0) + 1);
  }
  return [...found.entries()].map(([key, count]) => key + (count > 1 ? ' x' + count : ''));
}

// A point in the strip an element keeps for its own scroll bar, at its right or its lower edge.
const inScrollBar = (el, x, y) => {
  const b = box(el);
  return (
    x >= b.left + el.clientLeft + el.clientWidth || y >= b.top + el.clientTop + el.clientHeight
  );
};

// Every change of color along one line of the window, with what lies on each side of it.
function edgesOn(colors, pointAt, least) {
  const found = [];
  for (let i = 0; i + 1 < colors.length; i++) {
    const jump = step(colors[i], colors[i + 1]);
    if (jump < least) continue;
    const a = document.elementFromPoint(...pointAt(i)),
      b = document.elementFromPoint(...pointAt(i + 1));
    if (!a || !b) continue;
    if (a.closest(CONTENT) || b.closest(CONTENT)) continue;

    // the same element on both sides is its own text or picture
    if (a === b && !isFrame(a)) continue;

    // a scroll bar is a control: its thumb keeps its edge
    if (a === b && inScrollBar(a, ...pointAt(i + 1))) continue;

    // open: nothing but the frame within 3 px, so no surface has its own edge here
    const open = [i - 3, i, i + 1, i + 4].every(at =>
      isFrame(document.elementFromPoint(...pointAt(Math.max(0, at))))
    );
    found.push({ a, b, jump, open, at: i, from: hexOf(colors[i]), to: hexOf(colors[i + 1]) });
  }
  return found;
}

// The same step at the same place on the line 9 px to the side.
const onTwin = (twin, at) =>
  [at - 1, at, at + 1].some(
    i => i >= 0 && i + 1 < twin.length && step(twin[i], twin[i + 1]) >= CUT
  );

// One state of the window: the lines read, the edges found, and which of them are the frame's.
async function readGround(label) {
  const width = innerWidth,
    height = innerHeight;
  const list = threads.slot('list');
  const listRight = shown(list) ? box(list).right : 0;
  const columns = [4, Math.round(listRight + 6), Math.round(width * 0.55), width - 5];
  const top = box(document.querySelector('.top'));
  const rows = [Math.round(top.bottom + 5), Math.round(height * 0.5), height - 5];
  const read = await main(
    'lines',
    width,
    height,
    [...columns, ...columns.map(x => Math.min(width - 1, x + TWIN))],
    [...rows, ...rows.map(y => Math.max(0, y - TWIN))]
  );
  const all = [];
  columns.forEach((x, i) =>
    all.push(
      ...edgesOn(read.columns[i], y => [x, y], 4).map(e => ({
        ...e,
        line: 'x' + x,
        twin: onTwin(read.columns[columns.length + i], e.at),
      }))
    )
  );
  rows.forEach((y, i) =>
    all.push(
      ...edgesOn(read.rows[i], x => [x, y], 4).map(e => ({
        ...e,
        line: 'y' + y,
        twin: onTwin(read.rows[rows.length + i], e.at),
      }))
    )
  );

  // A cut of the frame: a step with the frame on both sides of it, no surface near, and the same
  // step beside it.
  const cuts = all.filter(e => e.jump >= CUT && e.open && e.twin);
  const say = e =>
    e.line +
    ' at ' +
    e.at +
    ': ' +
    nameOf(e.a) +
    ' | ' +
    nameOf(e.b) +
    ' ' +
    e.from +
    ' to ' +
    e.to;
  check(
    !cuts.length,
    label +
      ': no line or band of the frame itself' +
      (cuts.length ? ' (' + cuts.length + ': ' + cuts.slice(0, 6).map(say).join('; ') + ')' : '')
  );

  // The edges of surfaces, strongest first: named so a hard one can be found.
  const byPair = new Map();
  for (const e of all.filter(e => !cuts.includes(e))) {
    const key = nameOf(e.a) + ' | ' + nameOf(e.b);
    const had = byPair.get(key);
    if (!had || e.jump > had.jump) byPair.set(key, { ...e, count: (had?.count || 0) + 1 });
    else had.count++;
  }
  const strong = [...byPair.entries()].sort((one, two) => two[1].jump - one[1].jump).slice(0, 8);
  note(
    label +
      ' · the ground at the four lines: ' +
      [hexOf(read.columns[0][height - 3]), hexOf(read.columns[3][height - 3])].join(' and ') +
      ' · strongest edges of surfaces: ' +
      (strong
        .map(([key, e]) => key + ' ' + e.jump + ' (' + e.from + ' to ' + e.to + ')')
        .join('; ') || 'none')
  );
}

// Boxes that span much of the window and paint something of their own: a fill, a line on one
// side, a blur. On one ground these are surfaces with a round edge, never a part of the frame.
function paintedFrame(label) {
  const found = [];
  for (const el of frameParts()) {
    if (!shown(el)) continue;
    const style = getComputedStyle(el);
    const fill = /rgba?\(([^)]+)\)/.exec(style.backgroundColor);
    const alpha = fill ? (fill[1].split(',')[3] === undefined ? 1 : +fill[1].split(',')[3]) : 0;
    const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(
      side =>
        parseFloat(style['border' + side + 'Width']) > 0 &&
        !/, 0\)$|transparent/.test(style['border' + side + 'Color']) &&
        style['border' + side + 'Style'] !== 'none'
    );
    const says = [];
    if (alpha > 0.004) says.push('fill ' + style.backgroundColor);
    if (style.backgroundImage !== 'none') says.push('picture');
    if (sides.length) says.push('line ' + sides.join('+'));
    if (style.boxShadow !== 'none') says.push('shadow');
    if (says.length) found.push(nameOf(el) + ' (' + says.join(', ') + ')');
  }
  check(
    !found.length,
    label +
      ': no part of the frame paints a fill or a line' +
      (found.length ? ': ' + found.join('; ') : '')
  );
}

// ---------- the pages ----------
const menuButton = () => document.querySelector('.top .tnt-menu-btn');
const menu = () => document.querySelector('.tnt-menu.tnt-menu-full');
const openMenu = async () => {
  if (!shown(menu())) menuButton().click();
  return until(() => (shown(menu()) ? menu() : null), 3000);
};
const pressRow = async name => {
  await openMenu();
  const row = [...menu().querySelectorAll('.tnt-menu-row')].find(
    one => one.querySelector('span').textContent.trim() === name
  );
  row?.click();
  await wait(500);
};
const settingsTab = id => () =>
  layout.classList.contains('settings-mode') &&
  shown(document.getElementById('settingsPanel-' + id));
const PAGES = [
  {
    name: 'threads',
    go: async () => {
      threads.open();
      await until(() => threads.visible(), 3000);
    },
  },

  // the thread's side column (131), open beside the thread; in a small window in its place
  {
    name: 'threads-side',
    some: true,
    go: async () => {
      threads.open();
      await until(() => threads.visible(), 3000);
      window.TnaiThreadSide.open();
      await until(() => window.TnaiThreadSide.state().shown, 3000);
    },
    leave: () => window.TnaiThreadSide.close(),
  },
  {
    name: 'all-threads',
    preview: true,
    go: async () => {
      window.TnaiRoute('terminal');
      await until(() => window.TnaiAllThreads?.state().on, 3000);
    },
  },
  {
    // a PowerShell thread has no conversation: it opens on its CLI screen
    name: 'thread-cli',
    cli: true,
    go: async () => {
      const shell = agents.sessions().find(session => session.running);
      threads.show(shell.paneId);
      await until(
        () => window.TnaiThreadView?.shown() === shell.paneId && !!window.TnaiThreadView.term(),
        5000
      );
    },
  },
  {
    name: 'usage',
    go: async () => {
      await pressRow('Usage and accounts');
      await until(settingsTab('usage'), 4000);
    },
  },
  {
    name: 'skills',
    go: async () => {
      await pressRow('Skills');
      await until(() => layout.classList.contains('skills-mode'), 4000);
    },
  },

  // the menu's other pages, at the widest and the smallest window only
  {
    name: 'preview',
    some: true,
    go: async () => {
      await pressRow('Live preview');
      await until(() => layout.classList.contains('preview-mode'), 4000);
    },
  },
  {
    name: 'devices',
    some: true,
    go: async () => {
      await pressRow('Devices and own relay');
      await until(() => layout.classList.contains('devices-mode'), 4000);
    },
  },
  {
    name: 'settings',
    go: async () => {
      await pressRow('Settings');
      await until(settingsTab('general'), 4000);
    },
  },
];
const SIZES = [
  [1440, 900, '1440'],
  [1280, 800, '1280'],
  [768, 680, 'small'],
  [1280, 680, 'low'],
];

// The top row of All threads lies whole under the top bar: nothing of it is cut at its top.
function topRow(label) {
  const top = box(document.querySelector('.top'));
  const bar = terminalPage.querySelector('.terminal-toolbar');
  const items = [
    ...bar.querySelectorAll('.terminal-title, button, [role="tab"], .terminal-workspace-tabs'),
  ].filter(el => shown(el) && box(el).width > 2);
  const high = Math.min(...items.map(el => box(el).top));
  const low = Math.max(...items.map(el => box(el).bottom));
  const first = [...terminalPage.querySelectorAll('.tat-card')].find(shown);
  if (!first)
    return check(false, label + ': a thread is on the page to measure the top row against');

  // An item with the top bar, or something in it, lying over its top edge.
  const covered = items.filter(el => {
    const b = box(el);
    const at = document.elementFromPoint(b.left + b.width / 2, b.top + 1.5);
    return !!at && !!at.closest('.top');
  });
  check(
    high >= top.bottom - 0.5 &&
      high >= box(bar).top - 0.5 &&
      low <= box(first).top + 0.5 &&
      !covered.length,
    label +
      ': the top row of All threads lies whole between the top bar and the threads (top bar ends ' +
      n(top.bottom) +
      ', the row ' +
      n(box(bar).top) +
      ' to ' +
      n(box(bar).bottom) +
      ', its ' +
      items.length +
      ' items ' +
      n(high) +
      ' to ' +
      n(low) +
      ', threads from ' +
      n(box(first).top) +
      (covered.length ? ', covered: ' + covered.map(nameOf).join(', ') : '') +
      ')'
  );
}

// A terminal's text against the color the window shows behind it.
async function terminalContrast(label) {
  const host = [...document.querySelectorAll('.tnt-term-host')].find(
    el => shown(el) && !el.closest('.ap-term-parked, [inert]')
  );
  if (!host) return check(false, label + ': a CLI screen is on screen to measure');
  const b = box(host);
  const x = Math.round(b.right - 24),
    y = Math.round(b.bottom - 14);
  const read = await main('lines', innerWidth, innerHeight, [x], [y]);
  const behind = parts(read.columns[0][y]);
  const theme = window.TnaiTheme.xterm();

  // the thread's own top row, over the screen
  const head = host.closest('.tnt-view')?.querySelector('.tnt-head') || host;
  const headBox = box(head);
  const headColor = parts(
    (await main('lines', innerWidth, innerHeight, [Math.round(headBox.right - 60)], [])).columns[0][
      Math.round(headBox.top + 4)
    ]
  );
  const names = Object.keys(theme).filter(
    key => !/background|cursorAccent|selection|^black$/i.test(key)
  );
  const ratios = names.map(key => [key, contrast(fromHex(theme[key]) || behind, behind)]);
  const low = ratios.filter(([, ratio]) => ratio < 4.5);
  const sameAsTheme = step(
    read.columns[0][y],
    parseInt(String(theme.background).replace('#', '').slice(0, 6), 16)
  );
  check(
    contrast(fromHex(theme.foreground), behind) >= 4.5 && !low.length,
    label +
      ': the CLI screen’s text on what the window shows behind it (' +
      hexOf(read.columns[0][y]) +
      '): plain text ' +
      n(contrast(fromHex(theme.foreground), behind)) +
      ' to 1, the weakest color ' +
      ratios.sort((one, two) => one[1] - two[1])[0][0] +
      ' ' +
      n(ratios[0][1]) +
      (low.length ? ', under 4.5: ' + low.map(([key, r]) => key + ' ' + n(r)).join(', ') : '')
  );
  check(
    sameAsTheme <= 2 &&
      step(read.columns[0][y], headColor[0] * 65536 + headColor[1] * 256 + headColor[2]) <= 2,
    label +
      ': the CLI screen, the room around it and the thread’s top row are one color (screen ' +
      hexOf(read.columns[0][y]) +
      ', the theme ' +
      theme.background +
      ', head row #' +
      headColor.map(v => v.toString(16).padStart(2, '0')).join('') +
      ')'
  );
}

// The Skills list, scrolled: its cards fade at its upper end instead of being cut in a line, and
// at rest the first card is whole (no fade there).
async function skillsScrolled(look, size) {
  const library = document.querySelector('.skills-library');
  const fade = () => getComputedStyle(library).getPropertyValue('--tnt-fade-top').trim();
  const label = look + ' ' + size + ' skills: ';
  if (!library || library.scrollHeight <= library.clientHeight + 30)
    return note(label + 'the list does not scroll at this size, its upper fade was not tried');
  const atRest = fade();
  library.scrollTop = 80;
  await wait(250);
  const scrolled = fade();
  check(
    parseFloat(atRest) === 0 && parseFloat(scrolled) === 12,
    label +
      'the list fades at its upper end only while scrolled (at rest ' +
      atRest +
      ', scrolled 80 px ' +
      scrolled +
      ')'
  );
  await shot('ground-' + look + '-' + size + '-skills-scrolled');
  library.scrollTop = 0;
}

async function visit(look, size, page, folded) {
  const label = look + ' ' + size + ' ' + page.name + (folded ? ' folded' : '');
  await page.go();
  window.TnaiThreadCollapse.setList(!folded);
  if (page.preview) window.TnaiTerminalPreview.setPreview(!folded);
  window.TnaiThreadMenu?.close();
  await wait(900);

  // a column that was shown or hidden fades (127): read the window once the fade is over
  await until(() => !document.documentElement.matches('.vt-fold, .vt-page'), 5000);
  await wait(150);
  paintedFrame(label);
  await readGround(label);
  if ((size === '1440' || size === 'small') && !folded && look === 'dark')
    note(
      label +
        ' · lines on one side: ' +
        (oneSided().join('; ') || 'none') +
        ' · square boxes with a fill: ' +
        (squareFills().join('; ') || 'none')
    );
  if (page.preview) topRow(label);
  if (page.cli) await terminalContrast(label);
  await shot('ground-' + look + '-' + size + '-' + page.name + (folded ? '-folded' : ''));
  if (page.name === 'skills' && (size === 'low' || size === 'small'))
    await skillsScrolled(look, size);
  await page.leave?.();
  if (folded) {
    window.TnaiThreadCollapse.setList(true);
    if (page.preview) window.TnaiTerminalPreview.setPreview(true);
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
  for (const look of ['dark', 'light']) {
    window.TnaiTheme.set(look);
    for (const [width, height, size] of SIZES) {
      await main('size', width, height);
      await wait(700);
      for (const page of PAGES) {
        if (page.some && size !== '1440' && size !== 'small') continue;
        await visit(look, size, page, false);
        const foldHere = page.name === 'threads' || page.name === 'all-threads';
        if (foldHere && (size === '1440' || size === 'small')) await visit(look, size, page, true);
      }

      // the open menu, over Threads
      await PAGES[0].go();
      await openMenu();
      await wait(400);
      await shot('ground-' + look + '-' + size + '-menu');
      window.TnaiThreadMenu?.close();
    }
  }
  window.TnaiTheme.set('dark');
  await main('size', 1440, 900);
  threads.open();
  agents.sessions().forEach(s => agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
