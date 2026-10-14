/*
 * Technically Not tools · desktop-check/tests/ring-and-hover.js — two things a person must be
 * able to see on every page: the keyboard's focus ring, and the surface a soft button gets under
 * the pointer in Light.
 *
 * It goes through the pages (Threads with an open thread, the thread's "..." menu, each tab of
 * the side column, All threads, Settings, Skills, the three-dots menu) in Dark and in Light and,
 * for one control of each kind it finds:
 *   - gives it the keyboard's focus and checks that something shows it: a ring at least 2 screen
 *     pixels thick with at least 3 to 1 against what was behind it, read from pictures before and
 *     after, or another sign of focus (a glow, a lit edge, a lit row), which is named;
 *   - in Light, for every rule that paints --pg-panel-hover under the pointer, moves a real
 *     pointer over a control of that rule and reads the surface at rest, as it was before the
 *     token (the old value put back for a moment) and as it is now. The cut-outs go side by side
 *     onto sheets, desktop-hover-light-sheet-N.png.
 * One line is printed per kind of control. No agent process is started (ring-and-hover.main.js);
 * the window is never focused or shown: the page is told to behave as if it had the keyboard.
 */
const log = [],
  wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = label => log.push('     ' + label);
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++callId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });

// The most kinds of control looked at on one page in one look, so a long list cannot run away.
const MOST_KINDS = 45;

// A run of pixels reaches this far to each side of its middle (the same number as in main).
const REACH = 4;

// The least a focus ring should stand out from what is behind it, and text from its surface.
const RING_CONTRAST = 3;

// Faults this test found and that are reported, not fixed: each is a color, and the change this
// test came with was to change ring widths only. A line that begins like one of these is printed
// as a known fault and does not fail the test; take the entry out when the fault is fixed.
// (The Light teal swatch ring, 1.85 to 1, was one until 2026-10-14: 31 now draws it in the text
// color.)
const KNOWN_FAULTS = [];
const TEXT_CONTRAST = 4.5;

// Under the pointer a soft surface moves at least this many levels of 255 from rest (seen at a
// glance) and at most this many (still soft, no block of another tone).
const HOVER_LEAST = 8;
const HOVER_MOST = 40;
const FOCUSABLE =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]';

// ---------------------------------------------------------------- colors
const numbersOf = color => (color.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
const apart = (one, other) =>
  Math.abs(one[0] - other[0]) + Math.abs(one[1] - other[1]) + Math.abs(one[2] - other[2]);
const levels = (one, other) =>
  Math.max(Math.abs(one[0] - other[0]), Math.abs(one[1] - other[1]), Math.abs(one[2] - other[2]));
const brightness = color => {
  const part = value => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * part(color[0]) + 0.7152 * part(color[1]) + 0.0722 * part(color[2]);
};
const contrast = (one, other) => {
  const high = Math.max(brightness(one), brightness(other)),
    low = Math.min(brightness(one), brightness(other));
  return (high + 0.05) / (low + 0.05);
};

// ---------------------------------------------------------------- what is on the page
// Seen by a person: it has a box inside the window and nothing lies over its middle.
const onScreen = el => {
  const box = el.getBoundingClientRect();
  if (box.width < 6 || box.height < 6) return false;
  if (box.left < 6 || box.top < 6) return false;
  if (box.right > window.innerWidth - 6 || box.bottom > window.innerHeight - 6) return false;
  if (getComputedStyle(el).visibility !== 'visible') return false;
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return !!hit && (hit === el || el.contains(hit));
};

// A name for the kind of control: its tag, its first classes, and the part of the page it is in.
const kindOf = el => {
  const classes = [...el.classList].filter(name => !/^(active|on|is-|has-)/.test(name));
  const home = el.parentElement?.closest('[class]');
  return (
    el.tagName.toLowerCase() +
    (el.type && el.tagName === 'INPUT' ? '[' + el.type + ']' : '') +
    (classes.length ? '.' + classes.slice(0, 2).join('.') : '') +
    (home ? ' in .' + home.classList[0] : '')
  );
};

// What changes on a control, or on one of the four boxes around it, when focus is shown without
// an outline.
const surfaceOf = el => {
  const style = getComputedStyle(el),
    mark = getComputedStyle(el, '::after');
  return [
    style.borderTopColor,
    style.boxShadow,
    style.backgroundColor,
    mark.opacity + ' ' + mark.backgroundColor,
  ];
};
const aroundOf = el => {
  const list = [];
  for (let box = el.parentElement, step = 0; box && step < 4; box = box.parentElement, step++)
    list.push(box);
  return list;
};

// ---------------------------------------------------------------- the focus ring of one control
// The four runs of pixels across the ring's band, one per side.
const ringSpots = (el, width, offset) => {
  const box = el.getBoundingClientRect();
  const out = offset + width / 2;
  const middleX = box.left + box.width / 2,
    middleY = box.top + box.height / 2;
  return [
    { x: box.left - out, y: middleY, axis: 'x' },
    { x: box.right + out - 0.01, y: middleY, axis: 'x' },
    { x: middleX, y: box.top - out, axis: 'y' },
    { x: middleX, y: box.bottom + out - 0.01, axis: 'y' },
  ];
};

// Per side: how far the ring stands out from what was behind it, and how many pixels thick it is.
// A pixel counts as ring only when it moved toward the ring's color, so a tip that opened over
// one side is not taken for the ring.
const readSides = (before, after, ringColor) =>
  after.map((run, side) => {
    let best = 1,
      thick = 0;
    run.forEach((pixel, at) => {
      const behind = before[side][at];
      if (apart(behind, ringColor) - apart(pixel, ringColor) < 20) return;
      thick++;
      best = Math.max(best, contrast(pixel, behind));
    });
    return { best, thick };
  });

const ringCounts = { outline: 0, other: 0, none: 0, known: 0 };
const knownFault = (cond, label) => {
  ringCounts.known++;
  note('KNOWN FAULT, reported and not fixed: ' + label);
};

// `shown` is the box the ring is drawn around: the control, or the mark beside it.
async function probeOutline(el, style, where, shown) {
  // read now: the style object changes when the focus leaves
  const widthText = style.outlineWidth,
    offsetText = style.outlineOffset,
    color = style.outlineColor;
  const width = parseFloat(widthText),
    offset = parseFloat(offsetText) || 0;
  const spots = ringSpots(shown || el, width, offset);
  const after = await main('runs', spots);
  el.blur();
  await wait(180);
  const before = await main('runs', spots);
  const sides = readSides(before, after, numbersOf(color));
  const sorted = sides.map(side => side.best).sort((one, other) => other - one);
  const thick = Math.max(...sides.map(side => side.thick));
  const screenPixels = Math.round(width * window.devicePixelRatio);
  ringCounts.outline++;

  // Two sides at least must show it: one side alone can be something that opened beside it.
  const fine = screenPixels >= 2 && sorted[1] >= RING_CONTRAST;
  const report = fine || !KNOWN_FAULTS.some(known => where.startsWith(known)) ? check : knownFault;
  report(
    fine,
    where +
      ': ring ' +
      widthText +
      ' = ' +
      screenPixels +
      ' screen pixels (counted ' +
      thick +
      '), ' +
      color +
      ', offset ' +
      offsetText +
      '; ' +
      sorted[1].toFixed(2) +
      ' to 1 against what was behind it; sides ' +
      sides.map(side => side.best.toFixed(1)).join(' ')
  );
}

async function probeRing(el, where) {
  const restSurface = surfaceOf(el).join('|');
  const around = aroundOf(el);
  const restAround = around.map(box => surfaceOf(box).join('|'));
  const beside = el.nextElementSibling;
  const hiddenBox = getComputedStyle(el).opacity === '0';
  el.focus({ preventScroll: true });
  await wait(200);
  if (document.activeElement !== el) {
    note(where + ': does not take the focus, left out');
    return;
  }

  // A hidden box (a radio or a check box drawn as a swatch or a switch) shows its ring on the
  // mark beside it.
  if (beside && hiddenBox && getComputedStyle(beside).outlineStyle !== 'none') {
    await probeOutline(
      el,
      getComputedStyle(beside),
      where + ' (ring on the mark beside it)',
      beside
    );
    return;
  }
  const style = getComputedStyle(el);
  if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) {
    await probeOutline(el, style, where);
    return;
  }

  // No outline: something else must show the focus.
  const now = surfaceOf(el);
  const rest = restSurface.split('|');
  const signs = [];
  if (now[1] !== rest[1]) signs.push('a glow (' + now[1].slice(0, 60) + ')');
  if (now[0] !== rest[0]) signs.push('its edge lights up');
  if (now[2] !== rest[2]) signs.push('its surface lights up');
  if (now[3] !== rest[3]) signs.push('its own mark shows');
  const lit = around.find((box, at) => surfaceOf(box).join('|') !== restAround[at]);
  if (lit) signs.push('the box around it lights up (.' + (lit.classList[0] || lit.tagName) + ')');
  el.blur();
  await wait(60);
  if (signs.length) ringCounts.other++;
  else ringCounts.none++;
  check(
    signs.length > 0,
    where +
      ': no outline; ' +
      (signs.length ? 'focus is shown by ' + signs.join(', ') : 'NOTHING shows the focus')
  );
}

const seenKinds = new Set();

async function ringSweep(stop, look) {
  let count = 0;
  for (const el of document.querySelectorAll(FOCUSABLE)) {
    if (count >= MOST_KINDS) break;
    if (el.disabled || el.tabIndex < 0 || !el.isConnected || !onScreen(el)) continue;

    // A chosen radio button may wear a ring of its own at rest; one that is not chosen shows what
    // the focus adds.
    if (el.type === 'radio' && el.checked) continue;
    const kind = kindOf(el);
    if (seenKinds.has(look + kind)) continue;
    seenKinds.add(look + kind);
    count++;
    await probeRing(el, look + ' · ' + stop + ' · ' + kind);
  }
  return count;
}

// ---------------------------------------------------------------- the surface under the pointer
// Every rule of the sheets that paints the hover token under the pointer, as { rule, base }: the
// rule's selector and the same selector without the pointer, to find a control with.
const hoverRules = () => {
  const found = [];
  const walk = rules => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) walk(rule.cssRules);
      if (!rule.selectorText || !rule.style) continue;
      if (!rule.style.cssText.includes('--pg-panel-hover')) continue;
      for (const part of rule.selectorText.split(/,(?![^(]*\))/)) {
        if (!part.includes(':hover')) continue;
        found.push({ rule: part.trim(), base: part.replace(/:hover/g, '').trim() });
      }
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules);
  return found;
};

const sheetRows = [];
const awayFromAll = () => [{ type: 'mouseMove', x: 3, y: window.innerHeight - 3 }];

async function probeHover(el, entry, stop) {
  const box = el.getBoundingClientRect();
  const spot = [
    { x: box.left + Math.min(4, box.width / 4), y: box.top + box.height / 2, axis: 'x' },
  ];
  const pixel = async () => (await main('runs', spot))[0][REACH];
  const cut = () =>
    main(
      'cutOut',
      box.left - 12,
      box.top - 8,
      Math.min(box.width + 24, 330),
      Math.min(box.height + 16, 84)
    );
  const rest = await pixel();
  await realInput([
    { type: 'mouseMove', x: box.left + box.width / 2 - 2, y: box.top + box.height / 2 },
    { type: 'mouseMove', x: box.left + box.width / 2, y: box.top + box.height / 2 },
  ]);
  await wait(350);
  if (!el.matches(':hover')) {
    await realInput(awayFromAll());
    return false;
  }
  const now = await pixel();
  const textColor = numbersOf(getComputedStyle(el).color);
  const cutNow = await cut();

  // The value the rule had before the token, put back for a moment: the "before" picture.
  document.documentElement.style.setProperty('--pg-panel-hover', 'var(--pg-panel-2)');
  await wait(350);
  const was = await pixel();
  const cutWas = await cut();
  document.documentElement.style.removeProperty('--pg-panel-hover');
  await realInput(awayFromAll());
  await wait(120);

  // The same with and without the token: another rule paints this control under the pointer (a
  // filled button, a row with a surface of its own), so it is not one of this rule's.
  if (levels(was, now) === 0) return false;

  const step = levels(now, rest);
  const text = contrast(textColor, now);
  sheetRows.push({ label: entry.rule, stop, was: cutWas, now: cutNow });
  check(
    step >= HOVER_LEAST && step <= HOVER_MOST && text >= TEXT_CONTRAST,
    'Light hover · ' +
      stop +
      ' · ' +
      entry.rule +
      ': rest ' +
      rest.join(',') +
      ', under the pointer before ' +
      was.join(',') +
      ' (' +
      levels(was, rest) +
      ' levels), now ' +
      now.join(',') +
      ' (' +
      step +
      ' levels); its text ' +
      text.toFixed(2) +
      ' to 1'
  );
  return true;
}

const CHOSEN =
  '[aria-selected="true"], [aria-pressed="true"], [aria-expanded="true"], [aria-current], .active, .in-use, [data-on]';
const hoverDone = new Set();

async function hoverSweep(stop, rules) {
  for (const entry of rules) {
    if (hoverDone.has(entry.rule)) continue;
    let el = null;
    try {
      // one that is not pressed or chosen: such a state has a surface of its own
      el = [...document.querySelectorAll(entry.base)].find(
        found => !found.disabled && !found.matches(CHOSEN) && onScreen(found)
      );
    } catch (error) {
      el = null;
    }
    if (el && (await probeHover(el, entry, stop))) hoverDone.add(entry.rule);
  }
}

// The cut-outs side by side on sheets of twelve rows: before, now, and the rule's name.
async function saveSheets() {
  const PER_SHEET = 12,
    ROW = 96;
  const picture = source =>
    new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = source;
    });
  const names = [];
  for (let first = 0; first < sheetRows.length; first += PER_SHEET) {
    const rows = sheetRows.slice(first, first + PER_SHEET);
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 34 + rows.length * ROW;
    const pen = canvas.getContext('2d');
    pen.fillStyle = '#e9e7e1';
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.fillStyle = '#26232d';
    pen.font = '13px sans-serif';
    pen.fillText('before', 12, 20);
    pen.fillText('now', 352, 20);
    pen.fillText('the rule, and the page it was found on', 692, 20);
    for (let at = 0; at < rows.length; at++) {
      const top = 34 + at * ROW;
      const was = await picture(rows[at].was),
        now = await picture(rows[at].now);
      if (was) pen.drawImage(was, 12, top);
      if (now) pen.drawImage(now, 352, top);
      pen.fillText(rows[at].label.slice(0, 92), 692, top + 30);
      pen.fillText(rows[at].stop, 692, top + 50);
    }
    const name = 'hover-light-sheet-' + (first / PER_SHEET + 1);
    await main('savePicture', name, canvas.toDataURL('image/png'));
    names.push('desktop-' + name + '.png');
  }
  return names;
}

// ---------------------------------------------------------------- the sheets themselves
// Every focus rule's ring width as written: the token, or another width on purpose.
const ringWidthsWritten = () => {
  const token = [],
    other = [];
  const walk = rules => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) walk(rule.cssRules);
      if (!rule.selectorText || !rule.style || !/:focus/.test(rule.selectorText)) continue;
      const written = /outline(?:-width)?:\s*([^;]+)/.exec(rule.style.cssText);
      if (!written || /^(none|0)\b/.test(written[1].trim())) continue;
      if (written[1].includes('--pg-ring')) token.push(rule.selectorText);
      else other.push(rule.selectorText.slice(0, 70) + ' { ' + written[1].trim() + ' }');
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules);
  return { token, other };
};

// At another zoom: every ring on the page still reads back as 2 screen pixels or more.
async function ringsAtZoom(factor) {
  await main('setZoom', factor);
  await wait(300);
  const kinds = new Set(),
    thin = [];
  let rings = 0;
  for (const el of document.querySelectorAll(FOCUSABLE)) {
    if (el.disabled || el.tabIndex < 0 || !onScreen(el)) continue;
    const kind = kindOf(el);
    if (kinds.has(kind)) continue;
    kinds.add(kind);
    el.focus({ preventScroll: true });
    const style = getComputedStyle(el);
    if (document.activeElement === el && style.outlineStyle !== 'none') {
      rings++;
      const screenPixels = Math.round(parseFloat(style.outlineWidth) * window.devicePixelRatio);
      if (screenPixels < 2) thin.push(kind + ' ' + style.outlineWidth);
    }
    el.blur();
  }
  check(
    rings > 0 && !thin.length,
    'zoom ' +
      factor +
      ' (screen pixels per px ' +
      window.devicePixelRatio.toFixed(3) +
      '): ' +
      rings +
      ' kinds of ring on the Threads page, each 2 screen pixels or more' +
      (thin.length ? '; THINNER: ' + thin.join(' | ') : '')
  );
}

// ---------------------------------------------------------------- the pages
const threads = window.TnaiThreads,
  agents = window.TnaiAgents;
const setLook = async look => {
  window.TnaiTheme.set(look);
  await wait(400);
};

async function visit(stop, rules) {
  document.activeElement?.blur?.();
  await setLook('dark');
  const dark = await ringSweep(stop, 'Dark');
  await setLook('light');
  const light = await ringSweep(stop, 'Light');
  await hoverSweep(stop, rules);
  await setLook('dark');
  note(stop + ': ' + dark + ' new kinds of control in Dark, ' + light + ' in Light');
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
  await main('install');
  await agents.detect(true);
  threads.open();
  await wait(200);

  // two threads, so All threads has more than one to show
  await openThread('Terminal');
  const paneId = (await openThread('Terminal'))?.paneId || '';
  threads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  check(!!paneId && threads.visible() === true, 'a thread is open on the Threads page');
  await main('pageFocus', true);

  // A real key press, once: the focus that follows is a keyboard focus, the only kind that draws
  // a ring. Nothing in this test presses a mouse button, so it stays one.
  await realInput([
    { type: 'keyDown', keyCode: 'Tab' },
    { type: 'keyUp', keyCode: 'Tab' },
  ]);

  // Dark does not change: there the hover token is the very value it replaced.
  await setLook('dark');
  {
    const probe = document.createElement('i'),
      old = document.createElement('i');
    probe.style.background = 'var(--pg-panel-hover)';
    old.style.background = 'var(--pg-panel-2)';
    document.body.append(probe, old);
    const now = getComputedStyle(probe).backgroundColor,
      was = getComputedStyle(old).backgroundColor;
    probe.remove();
    old.remove();
    check(
      now === was && now !== 'rgba(0, 0, 0, 0)',
      'Dark: the hover token is the value it replaced (' + now + ' = ' + was + ')'
    );
  }

  const rules = hoverRules();
  check(rules.length > 0, rules.length + ' rules paint the hover token under the pointer');
  {
    const written = ringWidthsWritten();
    const left2px = written.other.filter(entry => /\b2px\b/.test(entry));
    check(
      written.token.length > 0 && !left2px.length,
      written.token.length +
        ' focus rules of the sheets take their ring width from --pg-ring; another width on purpose: ' +
        (written.other.join(' | ') || 'none')
    );
  }

  const toThreads = async () => {
    window.TnaiRoute('overview');
    threads.open();
    threads.show(paneId);
    await wait(350);
  };
  await visit('Threads', rules);

  window.TnaiThreadMore.open();
  await wait(300);
  await visit('the thread "..." menu', rules);
  window.TnaiThreadMore.close();

  window.TnaiThreadSide.open('files');
  await wait(350);
  const tabCount = document.querySelectorAll('.tnt-sidebox-tabs button').length;
  for (let at = 0; at < tabCount; at++) {
    const tab = document.querySelectorAll('.tnt-sidebox-tabs button')[at];
    tab.click();
    await wait(350);
    await visit('side column, ' + (tab.textContent.trim() || 'tab ' + (at + 1)), rules);
  }

  // a file opened from the Files tab, in the side column
  window.TnaiThreadSide.open('files');
  await wait(300);
  const fileRow = [...document.querySelectorAll('.repo-rail-tree .repo-row')].find(
    row => /.w+$/.test(row.textContent.trim()) && onScreen(row)
  );
  if (fileRow) {
    fileRow.click();
    await wait(600);
    await visit('side column, an open file', rules);
  }
  window.TnaiThreadSide.close();

  // past conversations, from the foot of the thread list
  const pastButton = document.querySelector('.tnh-foot .tnh-foot-btn');
  if (pastButton) {
    pastButton.click();
    await wait(400);
    await visit('past conversations', rules);
    if (pastButton.getAttribute('aria-expanded') === 'true') pastButton.click();
    await wait(200);
  }

  // the All threads page: the route 'terminal' is that page
  window.TnaiRoute('terminal');
  await wait(500);
  await visit('All threads', rules);

  window.TnaiSettings.open('general');
  await wait(500);
  const settingsTabs = document.querySelectorAll('.settings-tabs button').length;
  for (let at = 0; at < settingsTabs; at++) {
    const tab = document.querySelectorAll('.settings-tabs button')[at];
    tab.click();
    await wait(450);
    await visit('Settings, ' + (tab.textContent.trim() || 'tab ' + (at + 1)), rules);
  }

  window.TnaiRoute('live-preview');
  await wait(600);
  await visit('Live preview', rules);

  window.TnaiRoute('devices');
  await wait(600);
  await visit('Devices', rules);

  window.TnaiRoute('skills');
  await wait(500);
  await visit('Skills', rules);

  await toThreads();
  if (!window.TnaiThreadMenu.isOpen()) document.querySelector('.top .tnt-menu-btn')?.click();
  await wait(350);
  check(window.TnaiThreadMenu.isOpen(), 'the three-dots menu is open');
  await visit('the three-dots menu', rules);
  window.TnaiThreadMenu.close();
  await wait(200);

  // The other zooms the app runs at, and a zoom of 1.
  const usualZoom = await main('zoom');
  await ringsAtZoom(0.85);
  await ringsAtZoom(1);
  await main('setZoom', usualZoom);

  const sheets = await saveSheets();
  const unmet = rules.filter(entry => !hoverDone.has(entry.rule)).map(entry => entry.rule);
  note(
    'rings: ' +
      ringCounts.outline +
      ' kinds with an outline, ' +
      ringCounts.other +
      ' shown another way, ' +
      ringCounts.none +
      ' with nothing; known faults: ' +
      ringCounts.known
  );
  note(
    'hover: ' +
      hoverDone.size +
      ' of ' +
      rules.length +
      ' rules met on these pages; pictures: ' +
      sheets.join(', ')
  );
  note('hover rules not on these pages: ' + (unmet.join(' | ') || 'none'));
  await main('pageFocus', false);
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
return { ok, log };
