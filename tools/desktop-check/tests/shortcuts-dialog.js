// Technically Not tools · desktop-check/tests/shortcuts-dialog.js — the "Keyboard shortcuts" sheet
// (src/scripts/32-theme-and-shortcuts.js, window.TnaiShortcuts), in the real app with a throwaway
// profile. It reads how the sheet is laid out: inside the window, every explanation of a column
// starting on one line, rows that do not run into each other, air between the groups, and no line
// that still names the old layout. Pictures: shortcuts-dialog-dark, shortcuts-dialog-light.
// Returns {ok, log}.
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
const box = el => el.getBoundingClientRect();
const n = v => Math.round(v * 10) / 10;
const shot = async name => {
  await wait(250);
  await (window.TnaiTest?.shot?.(name) ?? wait(450));
};

try {
  await until(() => window.TnaiThreads?.visible(), 8000);
  check(!!window.TnaiShortcuts?.open, 'the sheet has its opener');
  window.TnaiShortcuts.open();
  const sheet = await until(() => {
    const found = document.querySelector('.tnai-keys');
    return found && found.getClientRects().length ? found : null;
  }, 3000);
  check(!!sheet, 'the sheet opens');
  if (!sheet) throw new Error('no sheet: nothing more can be read');
  await wait(300);

  const edge = box(sheet);
  check(
    edge.left >= 0 &&
      edge.top >= 0 &&
      edge.right <= innerWidth &&
      edge.bottom <= innerHeight &&
      sheet.scrollWidth <= sheet.clientWidth + 1,
    'it lies inside the window and does not scroll sideways: ' +
      n(edge.width) +
      ' x ' +
      n(edge.height) +
      ' in ' +
      innerWidth +
      ' x ' +
      innerHeight
  );

  // The same room on all four sides of what the sheet holds.
  const style = getComputedStyle(sheet);
  const pads = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map(side =>
    parseFloat(style[side])
  );
  check(
    pads.every(pad => pad === pads[0]) && pads[0] >= 28,
    'the sheet keeps the same room on all four sides: ' + pads.join(', ')
  );

  const groups = [...sheet.querySelectorAll('.tnai-keys-grid > section')];
  const rows = [...sheet.querySelectorAll('.tnai-keys-row')];
  check(
    groups.length >= 4 && rows.length >= 12,
    groups.length + ' groups and ' + rows.length + ' rows are listed'
  );

  // In each column every explanation starts on one line, whatever the number of keys before it.
  const starts = new Map();
  for (const row of rows) {
    const column = Math.round(box(row).left);
    const start = Math.round(box(row.lastElementChild).left * 10) / 10;
    if (!starts.has(column)) starts.set(column, new Set());
    starts.get(column).add(start);
  }
  check(
    starts.size === 2 && [...starts.values()].every(set => set.size === 1),
    'two columns, and in each every explanation starts on one line: ' +
      [...starts.entries()].map(([column, set]) => column + ' → ' + [...set].join('/')).join(' · ')
  );

  // The keys of a row never reach its explanation, and a row never runs into the next one.
  const tight = rows.filter(row => {
    const keys = [...row.firstElementChild.children];
    const lastKey = keys[keys.length - 1];
    return lastKey && box(row.lastElementChild).left - box(lastKey).right < 8;
  });
  check(
    tight.length === 0,
    'the last key of a row stands at least 8 px before its explanation (' +
      tight.length +
      ' rows too tight' +
      (tight[0] ? ': "' + tight[0].textContent.trim().slice(0, 40) + '"' : '') +
      ')'
  );
  const lows = groups.map(group => {
    const inGroup = [...group.querySelectorAll('.tnai-keys-row')];
    return inGroup
      .slice(1)
      .map((row, index) => box(row).top - box(inGroup[index]).bottom)
      .filter(gap => gap < -0.5).length;
  });
  check(
    lows.every(count => count === 0),
    'no row lies over the row before it'
  );
  const rowRooms = rows.map(row => parseFloat(getComputedStyle(row).paddingTop));
  check(
    rowRooms.every(room => room === rowRooms[0]) && rowRooms[0] >= 6,
    'every row has the same room above and below its text: ' + rowRooms[0] + ' px'
  );

  // Air between two groups of one column: more than between two rows.
  const air = [];
  for (let index = 1; index < groups.length; index++) {
    const above = groups
      .slice(0, index)
      .filter(group => Math.abs(box(group).left - box(groups[index]).left) < 2);
    const before = above[above.length - 1];
    if (before) air.push(n(box(groups[index]).top - box(before).bottom));
  }
  check(
    air.length > 0 && air.every(gap => gap >= 20),
    'two groups of a column stand at least 20 px apart: ' + air.join(', ')
  );

  // Nothing in it names a part the app no longer has.
  const text = sheet.textContent;
  check(
    !/left navigation|Overview|Agents page: previous|Command palette: pages/.test(text),
    'no line names the old navigation, the old Overview or the removed list of agents'
  );
  check(
    /Hide or show the thread list/.test(text) && /Find a page or a setting/.test(text),
    'the keys for the thread list and for the menu’s search say what they do now'
  );

  await shot('shortcuts-dialog-dark');
  window.TnaiTheme?.set('light');
  await wait(700);
  await shot('shortcuts-dialog-light');
  window.TnaiTheme?.set('dark');
  await wait(400);

  window.TnaiShortcuts.close();
  check(sheet.closest('.tnai-keys-overlay').hidden, 'it closes again');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
