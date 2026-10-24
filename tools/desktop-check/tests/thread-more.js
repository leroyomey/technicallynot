// Technically Not tools · desktop-check/tests/thread-more.js — the open thread's own "..." menu
// (src/scripts/137-thread-more.js) and the top row without the Readable / Terminal switch (120).
// One PowerShell thread and one Claude Code thread with a made-up conversation are opened (no
// prompt is sent). Checked: the switch is gone and a thread opens as its conversation; the menu
// opens and closes by a press on its button, by Escape and by a press outside, the arrow keys
// move through its rows and the keyboard goes back to the button; Rename changes the name in the
// top row and in the thread list, and Escape leaves it; "CLI screen" shows the tool's terminal
// with the text size buttons and "Back to the conversation" shows the conversation again; Team
// opens the team box; Stop asks and stops the session, Start starts it again; Close thread asks
// and closes it; and nothing in the top row lies over anything else in a thread 420 px wide.
// Pictures: thread-more-menu, -menu-light, -rename, -stop, -narrow; thread-pencil-<look>-<width>
// (the pencil beside the name in Light and Dark at 1440, 1024 and 768).
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
const shot = async name => {
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
const agents = window.TnaiAgents;
const native = window.tnaiNative;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;
const more = () => window.TnaiThreadMore;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);
const shown = el => !!el && el.getClientRects().length > 0;
const sessionOf = paneId => agents.sessions().find(session => session.paneId === paneId);

// Claude Code's screen, read to answer its folder-trust question and to see its empty prompt.
async function screenOf(paneId) {
  const replay = await native.pty.replay(paneId);
  if (!replay?.buffer) return [];
  const scratch = new window.Terminal({
    cols: replay.cols || 120,
    rows: replay.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => scratch.write(replay.buffer, done));
  const rows = [];
  const buffer = scratch.buffer.active;
  for (let row = 0; row < scratch.rows; row++)
    rows.push(buffer.getLine(buffer.baseY + row)?.translateToString(true) || '');
  scratch.dispose();
  return rows;
}
const ready = paneId =>
  until(async () => {
    const rows = await screenOf(paneId);
    const text = rows.join('\n');
    if (/project you created or one you trust|trust the files in this folder/i.test(text)) {
      const chosen = rows.find(row => row.includes('❯')) || '';
      native.pty.write(paneId, /Yes/i.test(chosen) ? '\r' : '\x1b[B');
      await wait(700);
      return false;
    }
    return /\? for shortcuts|shift\+tab to cycle|manual mode on/i.test(text);
  }, 60000);

const TRANSCRIPT = [
  { type: 'user', message: { role: 'user', content: '[TN.ai] say hello' } },
  {
    type: 'assistant',
    message: {
      id: 'msg_say',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello from the made-up conversation.' }],
    },
  },
];

// Pairs of shown texts or buttons of a row that lie over each other.
const overlaps = row => {
  const parts = [...row.querySelectorAll('*')].filter(
    el =>
      el.getClientRects().length &&
      (el.matches('button') ||
        (!el.children.length && el.textContent.trim() && !el.closest('button')))
  );
  const named = el => (el.getAttribute('aria-label') || el.textContent.trim()).slice(0, 18);
  const found = [];
  for (let first = 0; first < parts.length; first++)
    for (let second = first + 1; second < parts.length; second++) {
      if (parts[first].contains(parts[second]) || parts[second].contains(parts[first])) continue;
      const one = box(parts[first]);
      const two = box(parts[second]);
      const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (across > 2 && down > 2) found.push(named(parts[first]) + ' | ' + named(parts[second]));
    }
  return found;
};

// ---------- the page colors (44-page-colors.css) ----------
// The page colors, one a place, in each look.
const PAGE_COLORS = {
  dark: {
    all: '#e29b6f',
    side: '#cecb64',
    cli: '#86cb8f',
    terminal: '#67c1be',
    past: '#bb9ce8',
    handoff: '#d590cf',
    preview: '#e4869d',
  },
  light: {
    all: '#a75420',
    side: '#716e09',
    cli: '#2a7935',
    terminal: '#13726f',
    past: '#6e3eb1',
    handoff: '#9b3192',
    preview: '#af3151',
  },
};
const numbersOf = text => (String(text).match(/[\d.]+/g) || []).map(Number);
const hexOf = text =>
  '#' +
  numbersOf(text)
    .slice(0, 3)
    .map(part => Math.round(part).toString(16).padStart(2, '0'))
    .join('');
const luminance = rgb => {
  const channel = value => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};
const contrastOf = (one, two) => {
  const lighter = Math.max(luminance(one), luminance(two));
  const darker = Math.min(luminance(one), luminance(two));
  return (lighter + 0.05) / (darker + 0.05);
};

// What lies under an element: the look's ground, then every background color from the page down
// to the element laid over it (a see-through fill over the ground).
const groundUnder = (el, tone) => {
  const html = getComputedStyle(document.documentElement);
  const ground = html.getPropertyValue(tone === 'dark' ? '--pg-bg-d' : '--pg-bg-l').trim();
  let color = numbersOf(
    ground.startsWith('#')
      ? [1, 3, 5].map(at => parseInt(ground.slice(at, at + 2), 16)).join(',')
      : ground
  ).slice(0, 3);
  const layers = [];
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) layers.unshift(node);
  for (const node of layers) {
    const [red, green, blue, alpha = 1] = numbersOf(getComputedStyle(node).backgroundColor);
    if (!alpha) continue;
    color = [red, green, blue].map((part, index) => part * alpha + color[index] * (1 - alpha));
  }
  return color;
};

// Reads the icon of each [place, words, control] and checks its color and its contrast.
const readPageColors = (tone, found) => {
  for (const [place, words, control] of found) {
    const glyph = control?.querySelector(':scope > svg');
    if (!glyph || !shown(glyph)) {
      check(false, tone + ': ' + words + ' is not on screen');
      continue;
    }
    const drawn = getComputedStyle(glyph).color;
    const ratio = contrastOf(numbersOf(drawn), groundUnder(control, tone));
    check(
      hexOf(drawn) === PAGE_COLORS[tone][place] && ratio >= 3,
      tone +
        ': ' +
        words +
        ' is drawn in ' +
        hexOf(drawn) +
        ' (' +
        place +
        '), contrast ' +
        ratio.toFixed(2) +
        ' to 1'
    );
  }
};

const opened = [];
try {
  await agents.detect(true);
  await main('size', 1440, 900);
  threads.open();
  await until(() => threads.visible(), 5000);
  const shell = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  check(!!(await until(() => sessionOf(shell)?.running)), 'setup: a PowerShell thread runs');
  if (shell) opened.push(shell);
  const claude = (await window.TnaiTest.open('Claude Code'))?.paneId || '';
  const runs = await until(() => sessionOf(claude)?.running, 30000);
  const withTalk = !!runs && !!(await ready(claude));
  if (claude) opened.push(claude);
  if (withTalk)
    check(
      !!(await main('writeTranscript', claude, TRANSCRIPT)),
      'setup: a Claude Code thread has a made-up conversation'
    );
  else
    check(false, 'setup: Claude Code did not start on this PC, so the conversation is not checked');

  threads.open();
  await until(() => threads.visible(), 4000);
  const island = threads.slot('main');
  const head = () => island.querySelector('.tnt-head');
  const button = () => island.querySelector('.tnt-head-menu');
  const menu = () => document.querySelector('.tnt-menu-thread');
  const menuOpen = () => shown(menu());
  const rowIds = () =>
    more()
      .rows()
      .map(row => row.id);
  const press = id =>
    menu()
      .querySelector('.tnt-menu-row[data-row="' + id + '"]')
      .click();

  // the CLI screen's text size: rows of the menu while it shows (137; A- and A+ of the top row
  // until 2026-10-24)
  const fontRows = () =>
    more()
      .rows()
      .filter(row => /^font-/.test(row.id));
  const talk = () => island.querySelector('.tnt-talk');
  const key = name =>
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })
    );

  // ---- the top row of a thread with a conversation ----
  const first = withTalk ? claude : shell;
  threads.select(first);
  await until(() => view().shown() === first, 6000);
  if (withTalk) {
    const said = await until(() => /Hello from the made-up/.test(talk()?.textContent || ''), 12000);
    check(
      !!said && view().mode() === 'read' && shown(talk()) && !shown(view().term()?.element),
      'the thread opens as its conversation'
    );
    check(fontRows().length === 0, 'the menu has no text size rows beside a conversation');
  }
  check(
    !island.querySelector('.tnt-seg') && !island.querySelector('.tnt-head [data-mode]'),
    'the Readable / Terminal switch is gone from the top row'
  );
  const acts = island.querySelector('.tnt-head-acts');
  check(
    shown(button()) && acts.lastElementChild === button(),
    'the "..." button is the last one of the top row'
  );

  // Few buttons (user 2026-10-24, tab 5 of app-polish.html): Preview and Split with their names,
  // Stop or Start, "..." (and "N helpers" while there are helpers); the rest are menu rows.
  const topParts = [...acts.children].filter(shown);
  const movedAway =
    '.tnt-head-handoff, .tnt-head-blur, .tnh-open, .tnt-head-popout, .tnt-head-work, [data-tnai-font]';
  check(
    topParts.length <= 5 &&
      /Preview/.test(island.querySelector('.tnt-head-page')?.textContent || '') &&
      /Split/.test(island.querySelector('.tnt-fold-side')?.textContent || '') &&
      !acts.querySelector(movedAway),
    'the top row has Preview and Split with their names, Stop and "..." (' +
      topParts.map(part => part.textContent.trim() || part.getAttribute('aria-label')).join(', ') +
      ')'
  );

  // ---- opening and closing ----
  check(!menuOpen(), 'the menu is closed at first');
  button().click();
  await wait(250);
  const rowsNow = [...(menu()?.querySelectorAll('.tnt-menu-row') || [])];
  check(
    menuOpen() && button().getAttribute('aria-expanded') === 'true',
    'a press on the button opens the menu'
  );
  const labels = rowsNow.map(row => row.textContent.trim());
  check(
    labels.includes('Rename') &&
      labels.includes('Stop') &&
      !labels.includes('Start') &&
      labels.includes('Close thread') &&
      (!withTalk || labels.includes('CLI screen')),
    'its rows: ' + labels.join(', ')
  );
  check(
    rowIds().join() === rowsNow.map(row => row.dataset.row).join(),
    'TnaiThreadMore.rows() names the same rows (' + rowIds().join(', ') + ')'
  );
  const menuBox = box(menu());
  const buttonBox = box(button());
  check(
    menuBox.top >= buttonBox.bottom &&
      Math.abs(menuBox.right - buttonBox.right) <= 2 &&
      menuBox.right <= window.innerWidth &&
      menuBox.bottom <= window.innerHeight,
    'the menu stands under its button, inside the window (' +
      round(menuBox.width) +
      ' x ' +
      round(menuBox.height) +
      ' px)'
  );
  check(document.activeElement === rowsNow[0], 'the keyboard is on the first row');
  key('ArrowDown');
  check(document.activeElement === rowsNow[1], 'Arrow down moves to the second row');
  key('ArrowUp');
  key('ArrowUp');
  check(
    document.activeElement === rowsNow[rowsNow.length - 1],
    'Arrow up from the first row goes to the last'
  );
  await shot('thread-more-menu');
  key('Escape');
  await wait(150);
  check(
    !menuOpen() &&
      document.activeElement === button() &&
      button().getAttribute('aria-expanded') === 'false',
    'Escape closes the menu and the keyboard is back on the button'
  );
  button().click();
  await wait(150);
  button().click();
  await wait(150);
  check(!menuOpen(), 'a second press on the button closes it');
  button().click();
  await wait(150);
  const outside = document.querySelector('footer.composer') || document.body;
  outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  await wait(150);
  check(!menuOpen(), 'a press outside closes it');
  more().open();
  await wait(150);
  const byFunction = menuOpen();
  more().close();
  check(byFunction && !menuOpen(), 'TnaiThreadMore.open() and close() do the same');

  // the same menu in Light, for a picture; the look is put back at once
  const look = window.TnaiTheme?.get?.() === 'light' ? 'light' : 'dark';
  window.TnaiTheme?.set('light');
  more().open();
  await shot('thread-more-menu-light');
  more().close();
  window.TnaiTheme?.set(look);
  await wait(200);

  // ---- the page colors (44-page-colors.css) ----
  // Each icon that leads to a place is drawn in that place's color, in Dark and in Light, with a
  // contrast of at least 3 to 1 on what lies under it. An icon that leads nowhere of its own
  // stays neutral, and a disabled one stays muted.
  for (const tone of ['dark', 'light']) {
    window.TnaiTheme?.set(tone);
    threads.open();
    threads.select(first);
    await until(() => view().shown() === first, 6000);
    await wait(300);
    const found = [];
    found.push(['all', "the top row's Preview", island.querySelector('.tnt-head-page')]);
    found.push(['side', "the top row's Split", island.querySelector('.tnt-fold-side')]);
    found.push(['past', "the list's Past conversations", document.querySelector('.tnh-foot-btn')]);
    readPageColors(tone, found);
    const neutral = island.querySelector('.tnt-head-menu svg');
    check(
      !!neutral &&
        !Object.values(PAGE_COLORS[tone]).includes(hexOf(getComputedStyle(neutral).color)),
      tone + ': the "..." icon, which leads to no place, stays neutral'
    );

    // a disabled control keeps the muted look of every disabled icon
    const pageButton = island.querySelector('.tnt-head-page');
    pageButton.disabled = true;
    const mutedColor = hexOf(getComputedStyle(pageButton.querySelector('svg')).color);
    pageButton.disabled = false;
    check(
      mutedColor !== PAGE_COLORS[tone].all,
      tone + ': a disabled All threads button is not drawn in its color (' + mutedColor + ')'
    );

    // the thread's "..." menu: Past conversations and Handoff history (top-row icons until
    // 2026-10-24)
    more().open();
    await wait(250);
    const menuRow = id => menu()?.querySelector('.tnt-menu-row[data-row="' + id + '"]');
    readPageColors(tone, [
      ['past', 'the "..." menu\'s Past conversations', menuRow('past')],
      ['handoff', 'the "..." menu\'s Handoff history', menuRow('handoffs')],
    ]);
    more().close();
    await wait(150);

    // the thread's "..." menu: CLI screen
    if (withTalk) {
      more().open();
      await wait(250);
      const screenRow = menu()?.querySelector('.tnt-menu-row[data-row="screen"]');
      readPageColors(tone, [['cli', 'the "..." menu\'s CLI screen', screenRow]]);
      more().close();
      await wait(150);
    }

    // the three-dots menu: All threads, Terminal, Live preview
    const fullMenu = () => document.querySelector('.tnt-menu.tnt-menu-full');
    document.querySelector('.top .tnt-menu-btn')?.click();
    await until(() => shown(fullMenu()), 3000);
    const placeRow = place =>
      fullMenu()?.querySelector('.tnt-menu-row[data-place="' + place + '"]');
    readPageColors(tone, [
      ['all', "the three-dots menu's All threads", placeRow('all')],
      ['terminal', "the three-dots menu's Terminal", placeRow('terminal')],
      ['preview', "the three-dots menu's Live preview", placeRow('preview')],
    ]);
    await shot('page-colors-menu-' + tone);
    window.TnaiThreadMenu?.close();
    await wait(200);

    // All threads: a card's Handoff history and side column buttons, the Live preview button
    await window.TnaiTest.openAllThreads();
    await wait(600);
    const card = [...document.querySelectorAll('.tat-card')].find(one => shown(one));
    readPageColors(tone, [
      ['handoff', "a card's Handoff history", card?.querySelector('.tat-act-handoff')],
      ['side', "a card's side column", card?.querySelector('.tat-act-side')],
      [
        'preview',
        'the Live preview button of All threads',
        document.querySelector('.tnt-fold-preview'),
      ],
    ]);
    await shot('page-colors-all-' + tone);
  }
  window.TnaiTheme?.set(look);
  threads.open();
  threads.select(first);
  await until(() => view().shown() === first, 6000);
  await wait(200);

  // ---- Rename ----
  const title = () => head().querySelector('h1');
  const field = () => head().querySelector('.tnai-rename-input');
  const listRow = paneId =>
    threads.slot('list').querySelector('[data-pane="' + CSS.escape(paneId) + '"]');
  const before = title().textContent;
  button().click();
  await wait(150);
  press('rename');
  await wait(200);
  check(
    !menuOpen() && shown(field()) && !shown(title()) && document.activeElement === field(),
    'Rename puts a field where the name stood, with the keyboard in it'
  );
  check(field().value === before, 'the field holds the name (' + before + ')');
  const lineBefore = box(head()).height;
  field().value = 'Not this name';
  await shot('thread-more-rename');
  check(
    Math.abs(box(head()).height - lineBefore) < 1,
    'the top row keeps its height while the name is edited'
  );
  field().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  await wait(300);
  check(
    !field() && shown(title()) && title().textContent === before,
    'Escape leaves the name as it was (' + title().textContent + ')'
  );
  const renamed = 'Thread ' + String(Date.now()).slice(-6);
  button().click();
  await wait(150);
  press('rename');
  await wait(200);
  field().value = renamed;
  field().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  const inHead = await until(() => !field() && title().textContent === renamed, 5000);
  check(!!inHead, 'Enter saves: the top row reads ' + title().textContent);
  const inList = await until(() => (listRow(first)?.textContent || '').includes(renamed), 5000);
  check(!!inList, 'and the thread list shows the new name');
  check(
    sessionOf(first)?.name === renamed,
    'and the session has it (' + sessionOf(first)?.name + ')'
  );

  // ---- The pencil beside the name ----
  const pencil = () => head().querySelector('.tnt-head-rename');
  check(shown(pencil()), 'a pencil stands beside the name');
  const headHeight = box(head()).height;

  // The pencil against its neighbors: right after the name, on its center line, the icon in the
  // middle of its box, and whole inside the top row. Measured in each look and at the tablet sizes
  // (issue sweep item 18: it was first looked at only in Dark at the test window's size).
  const measurePencil = label => {
    const nameBox = box(title()),
      pencilBox = box(pencil()),
      rowBox = box(head());
    const pencilGap = pencilBox.left - nameBox.right;
    check(
      pencilGap >= 2 && pencilGap <= 10,
      label +
        ': the pencil sits right after the name (' +
        pencilGap.toFixed(1) +
        ' px), not apart from it'
    );
    check(
      Math.abs(pencilBox.top + pencilBox.height / 2 - (nameBox.top + nameBox.height / 2)) <= 1.5,
      label + ': the pencil shares the name’s center line'
    );
    const pencilIcon = box(pencil().querySelector('svg'));
    check(
      Math.abs(pencilIcon.left + pencilIcon.width / 2 - (pencilBox.left + pencilBox.width / 2)) <=
        1 &&
        Math.abs(pencilIcon.top + pencilIcon.height / 2 - (pencilBox.top + pencilBox.height / 2)) <=
          1,
      label + ': the pencil icon is centered in its box'
    );
    check(
      pencilBox.top >= rowBox.top - 0.5 &&
        pencilBox.bottom <= rowBox.bottom + 0.5 &&
        pencilBox.right <= rowBox.right,
      label + ': the pencil lies whole inside the top row'
    );
    log.push(
      '     ' +
        label +
        ': pencil ' +
        round(pencilBox.width) +
        'x' +
        round(pencilBox.height) +
        ', icon color ' +
        getComputedStyle(pencil()).color +
        ', name color ' +
        getComputedStyle(title()).color
    );
  };
  measurePencil('Dark 1440');
  const pencilLook = window.TnaiTheme?.get?.() === 'light' ? 'light' : 'dark';
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 680],
  ]) {
    if (width !== 1440) await main('size', width, height);
    for (const look of ['light', 'dark']) {
      if (width === 1440 && look === 'dark') continue;
      window.TnaiTheme?.set(look);
      await wait(300);
      measurePencil((look === 'light' ? 'Light ' : 'Dark ') + window.innerWidth);
      await shot('thread-pencil-' + look + '-' + width);
    }
  }
  window.TnaiTheme?.set(pencilLook);
  await main('size', 1440, 900);
  await wait(300);
  pencil().click();
  await wait(200);
  check(
    shown(field()) && !shown(title()) && !shown(pencil()) && document.activeElement === field(),
    'the pencil puts a field where the name stood and steps aside'
  );
  check(
    Math.abs(box(head()).height - headHeight) < 1,
    'the top row keeps its height with the pencil and the field'
  );
  await shot('thread-pencil-field');
  const byPencil = 'Pencil ' + String(Date.now()).slice(-5);
  field().value = byPencil;
  field().dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  check(
    !!(await until(() => !field() && title().textContent === byPencil, 5000)) &&
      !!(await until(() => (listRow(first)?.textContent || '').includes(byPencil), 5000)),
    'the pencil’s name is saved: top row and thread list read ' + title().textContent
  );
  check(shown(pencil()), 'and the pencil is back beside the new name');

  // ---- CLI screen and back ----
  if (withTalk) {
    button().click();
    await wait(150);
    press('screen');
    const onScreen = await until(
      () => view().mode() === 'term' && shown(view().term()?.element),
      8000
    );
    check(!!onScreen && !shown(talk()), 'CLI screen shows the tool’s own terminal');
    check(
      fontRows().length === 2,
      'the menu has Smaller and Larger text while the CLI screen is shown'
    );
    await wait(400);
    button().click();
    await wait(150);
    const back = menu().querySelector('.tnt-menu-row[data-row="conversation"]');
    check(
      !!back &&
        back.textContent.trim() === 'Back to the conversation' &&
        !menu().querySelector('[data-row="screen"]'),
      'the row now reads "Back to the conversation"'
    );
    press('conversation');
    const onTalk = await until(() => view().mode() === 'read' && shown(talk()), 6000);
    check(
      !!onTalk && fontRows().length === 0 && !shown(island.querySelector('.tnt-term')),
      'and it shows the conversation again, without the text size rows'
    );

    // ---- Team ----
    if (rowIds().includes('team')) {
      button().click();
      await wait(150);
      press('team');
      const dialog = await until(
        () => document.querySelector('[aria-labelledby="tnaiTeamTitle"]'),
        4000
      );
      check(
        !!dialog && dialog.querySelector('h2').textContent === 'Team for ' + byPencil,
        'Team opens the team box for this thread (' + dialog?.querySelector('h2').textContent + ')'
      );
      dialog?.querySelector('[data-choice="cancel"]').click();
      await wait(150);
      check(
        !document.querySelector('[aria-labelledby="tnaiTeamTitle"]'),
        'and Cancel closes the team box'
      );
    } else check(false, 'the Claude Code thread has no Team row (' + rowIds().join(', ') + ')');

    // ---- 420 px wide ----
    // the side column is opened the way its own button opens it (131), so it stays open
    window.TnaiThreadSide.open('files');
    await wait(600);
    const usual = box(threads.slot('side')).width;
    const widthOf = () => box(island).width;
    window.TnaiThreadSideSize.set(usual + (widthOf() - 420));
    await wait(500);

    // the side column may stop before that: the window gives the rest
    if (widthOf() > 424) {
      await main('size', round(1440 - (widthOf() - 420)), 900);
      await wait(400);
    }
    const narrow = round(widthOf());
    check(narrow >= 400 && narrow <= 424, 'the thread is 420 px wide (' + narrow + ' px)');
    const measure = label => {
      check(
        Math.abs(widthOf() - narrow) <= 1,
        label + ': the thread still is ' + round(widthOf()) + ' px wide'
      );
      const over = overlaps(head());
      check(!over.length, label + ': nothing in the top row overlaps (' + over.join('; ') + ')');
      const outsideRow = [...head().querySelectorAll('.tnt-head-acts > *, h1')].filter(
        part =>
          shown(part) &&
          (box(part).right > box(head()).right + 1 || box(part).left < box(head()).left - 1)
      );
      check(!outsideRow.length, label + ': the name and every button are inside the top row');
      check(
        box(title()).width >= 60 || title().scrollWidth <= title().clientWidth,
        label + ': the name is whole or has 60 px (' + round(box(title()).width) + ' px)'
      );
    };
    measure('420 px, conversation');
    view().setMode('term');
    await until(() => view().mode() === 'term' && fontRows().length === 2, 6000);
    await wait(400);
    measure('420 px, CLI screen');
    button().click();
    await wait(250);
    const narrowMenu = box(menu());
    check(
      menuOpen() && narrowMenu.left >= 0 && narrowMenu.right <= window.innerWidth,
      '420 px: the menu is inside the window'
    );
    await shot('thread-more-narrow');
    more().close();
    view().setMode('read');
    window.TnaiThreadSideSize.set(usual);
    await main('size', 1440, 900);
    window.TnaiThreadSide.close();
    await wait(400);
  }

  // Start is drawn green (--pg-work) and Stop red (--pg-err), on the menu's row and on the top
  // row's on/off button, in Dark and in Light, at least 3 to 1 on what lies under it (user
  // 2026-10-14: "Stop is red, green is for go"). The menu is opened to read its row.
  const readStatusColors = (rowId, token) => {
    button().click();
    const controls = [
      ['the menu row ' + rowId, menu().querySelector('.tnt-menu-row[data-row="' + rowId + '"]')],
      ['the top-row on/off button', island.querySelector('.tnt-head-power')],
    ];
    for (const tone of ['dark', 'light']) {
      window.TnaiTheme?.set(tone);
      const wanted = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      for (const [words, control] of controls) {
        const glyph = control?.querySelector(':scope > svg');
        if (!glyph || !shown(glyph)) {
          check(false, tone + ': ' + words + ' is not on screen');
          continue;
        }
        const drawn = getComputedStyle(glyph).color;
        const ratio = contrastOf(numbersOf(drawn), groundUnder(control, tone));
        check(
          hexOf(drawn) === wanted.toLowerCase() && ratio >= 3,
          tone +
            ': ' +
            words +
            ' is ' +
            hexOf(drawn) +
            ' (' +
            token +
            ' ' +
            wanted +
            '), ' +
            ratio.toFixed(2) +
            ':1'
        );
      }
    }
    button().click();
  };

  // ---- a thread with no conversation: Stop, Start, Close ----
  threads.select(shell);
  await until(() => view().shown() === shell, 6000);
  await wait(500);
  check(
    view().mode() === 'term' && shown(island.querySelector('.tnt-term')),
    'a PowerShell thread still opens on its screen'
  );
  check(
    !rowIds().includes('screen') &&
      !rowIds().includes('conversation') &&
      !rowIds().includes('team'),
    'its menu has no CLI screen row and no Team row (' + rowIds().join(', ') + ')'
  );
  const confirmBox = () => document.querySelector('.tnai-panel-confirm-box');
  button().click();
  await wait(150);
  press('stop');
  const asked = await until(() => confirmBox(), 3000);
  check(
    !!asked && sessionOf(shell)?.running === true,
    'Stop asks first (' + asked?.querySelector('h3')?.textContent + ')'
  );
  await shot('thread-more-stop');
  asked?.querySelector('.tnai-ws-close-cancel').click();
  await wait(300);
  check(!confirmBox() && sessionOf(shell)?.running === true, 'Cancel leaves it running');
  button().click();
  await wait(150);
  press('stop');
  (await until(() => confirmBox(), 3000))?.querySelector('.tnai-ws-close-confirm').click();
  check(
    !!(await until(() => sessionOf(shell) && !sessionOf(shell).running, 8000)),
    'Stop, confirmed, stops the session'
  );
  await wait(300);
  check(
    rowIds().includes('start') && !rowIds().includes('stop'),
    'the menu of a stopped thread has Start, not Stop (' + rowIds().join(', ') + ')'
  );
  readStatusColors('start', '--pg-work');
  button().click();
  await wait(150);
  press('start');
  check(
    !!(await until(() => sessionOf(shell)?.running === true, 15000)),
    'Start starts the session again'
  );
  await wait(500);
  check(
    rowIds().includes('stop') && !rowIds().includes('start'),
    'and the menu has Stop again (' + rowIds().join(', ') + ')'
  );
  readStatusColors('stop', '--pg-err');
  button().click();
  await wait(150);
  press('close');
  const closing = await until(() => confirmBox(), 3000);
  check(
    !!closing && !!sessionOf(shell),
    'Close thread asks first while it runs (' + closing?.querySelector('h3')?.textContent + ')'
  );
  closing?.querySelector('.tnai-ws-close-confirm').click();
  check(
    !!(await until(() => !sessionOf(shell), 8000)),
    'Close thread, confirmed, closes the thread'
  );
  check(!!(await until(() => !listRow(shell), 4000)), 'and it is gone from the thread list');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
window.TnaiThreadMore?.close();
for (const paneId of opened) await agents.stop(paneId).catch(() => {});
await main('cleanup').catch(() => {});
await main('size', 1440, 900).catch(() => {});
return { ok, log };
