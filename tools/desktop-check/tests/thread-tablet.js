// Technically Not tools · desktop-check/tests/thread-tablet.js — the thread layout in a tablet
// sized window and under touch, in the real app with a throwaway profile, the test's small
// project folder and four real PowerShell threads (one of them the open one).
// Checked here, at 1440, 1280, 1024, the smallest window and a low window, in these states: the
// open thread, the New thread start screen, the side column, the three-dots menu, the thread
// list hidden, the All threads page. In each state: the page does not scroll sideways, no
// part is wider than its box, every control lies whole inside the window, nothing lies over a
// control and no two controls lie over each other. Then with touch as the first way of pointing, at
// 1024 and the smallest window: the same, and every control of the thread layout is at least 44 by
// 44. Pictures: tablet-<look>-<size>-<state>, tablet-touch-<look>-<size>-<state>. Returns {ok,
// log}.
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

// A call into this test's main-process half: the window size, touch on and off.
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
  agents = window.TnaiAgents,
  theme = window.TnaiTheme;
const box = el => el.getBoundingClientRect();
const shown = el =>
  !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
const n = v => Math.round(v * 10) / 10;

// The parts of the thread layout, and what in them a pointer or a finger presses.
const PARTS = '.top, .tnt-slot, .sidebar > .tnt-list, footer.composer, #terminalView, .tnt-menu';
const CONTROL =
  'button, [role="button"], [role="tab"], [role="menuitem"], a[href], input:not([type="hidden"]):not([type="file"]), textarea, select, summary';

// The parts whose controls must be finger sized under touch: the thread layout's own. Left out,
// and named in the build log as open: the row of small choices under the prompt box (a line of
// text by design), the dots of the pages view (the arrows turn the page), the rest of the
// All threads page's top row and the file rail's rows.
const TOUCH_PARTS =
  '.top .tnt-fold, .top .tnt-menu-btn, .tnt-lst, .tnt-head, .tnt-sidebox-head, .tnt-menu, .tpg-nav, .tnt-fold-preview, .composebox, .tnt-start';
const TOUCH_SKIP = 'textarea, select, .attachment-list *';

const name = el => {
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  const label = el.getAttribute('aria-label') || el.title || el.textContent.trim().slice(0, 18);
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (label ? ' "' + label + '"' : '');
};

// A control counts when it is drawn, is not a part of a terminal's own screen, and is on screen
// now. Not on screen: one scrolled out of a list or a tab strip, one on a page of terminals that
// is a slide away (its middle lies outside a box that clips), one that shows only under the
// pointer (a terminal panel's tools rest at opacity 0), and the plain select that lies unseen
// under each of the prompt box's choice buttons.
const controls = () =>
  [...document.querySelectorAll(PARTS)]
    .flatMap(part => [...part.querySelectorAll(CONTROL)])
    .filter((el, i, all) => all.indexOf(el) === i)
    .filter(el => shown(el) && !el.closest('.xterm') && box(el).width > 0 && box(el).height > 0)
    .filter(el => !el.matches('.tnai-pick select'))
    .filter(el => {
      const a = box(el),
        x = a.left + a.width / 2,
        y = a.top + a.height / 2;
      for (let up = el; up; up = up.parentElement) {
        const style = getComputedStyle(up);
        if (style.opacity === '0') return false;
        if (up === el) continue;
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
          const b = box(up);
          if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
        }
      }
      return true;
    });

// The part of a control that is drawn: its box, cut by every box above it that clips (a tab that
// runs out of its strip is seen only inside the strip).
const seen = el => {
  const r = box(el);
  const out = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let up = el.parentElement; up; up = up.parentElement) {
    const style = getComputedStyle(up);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const b = box(up);
    out.left = Math.max(out.left, b.left);
    out.top = Math.max(out.top, b.top);
    out.right = Math.min(out.right, b.right);
    out.bottom = Math.min(out.bottom, b.bottom);
  }
  return out;
};

// The size a finger can press: the control's box, or the layer laid over and around it.
const pressSize = el => {
  // The menu's search line fills its field inside the field's 1 px edge: the field is pressed.
  const b = box(el.closest('.tnt-menu-search') || el),
    after = getComputedStyle(el, '::after');
  if (after.content === 'none' || after.position !== 'absolute') return b;
  return {
    width: Math.max(b.width, parseFloat(after.width) || 0),
    height: Math.max(b.height, parseFloat(after.height) || 0),
  };
};

// Every fault of one state, as short lines.
const faults = (touch = false) => {
  const out = [];
  const page = document.scrollingElement;
  if (page.scrollWidth > window.innerWidth + 1)
    out.push('the page scrolls sideways (' + page.scrollWidth + ' in ' + window.innerWidth + ')');

  // A part wider than its box: something in it is cut or scrolls sideways.
  for (const part of document.querySelectorAll(PARTS)) {
    if (!shown(part)) continue;
    for (const el of [part, ...part.querySelectorAll('*')]) {
      if (el.closest('.xterm') || el.scrollWidth <= el.clientWidth + 1 || !shown(el)) continue;
      const style = getComputedStyle(el);
      if (style.overflowX === 'visible' || style.textOverflow === 'ellipsis') continue;

      // Not a cut: a text box, the tab strip (it scrolls), the row of terminal pages and the row
      // of threads on All threads (the others are a step away), a terminal panel's head (its tools
      // rest 6 px aside until the pointer comes), and text kept for screen readers in a box one
      // pixel wide.
      if (
        el.clientWidth <= 1 ||
        el.matches(
          'input, textarea, select, .terminal-workspace-tabs, .terminal-workspace-grid, .terminal-pane-head, .tat-clip, .tnt-talk *'
        )
      )
        continue;
      out.push(
        'wider than its box: ' + name(el) + ' (' + el.scrollWidth + ' in ' + el.clientWidth + ')'
      );
    }
  }

  const list = controls();
  for (const el of list) {
    const b = box(el);
    if (
      b.left < -0.5 ||
      b.top < -0.5 ||
      b.right > window.innerWidth + 0.5 ||
      b.bottom > window.innerHeight + 0.5
    ) {
      out.push('outside the window: ' + name(el) + ' (' + n(b.left) + ' to ' + n(b.right) + ')');
      continue;
    }
    const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const mine =
      top &&
      (top === el || el.contains(top) || top.contains(el) || top.closest('label')?.contains(el));

    // The open menu lies over the page on purpose.
    const underMenu = top && top.closest('.tnt-menu') && !el.closest('.tnt-menu');
    if (!mine && !underMenu)
      out.push('covered: ' + name(el) + ' by ' + (top ? name(top) : 'nothing'));

    // What takes the finger: the control's box, or a clear layer laid around a small mark (an
    // accent dot keeps its 20 px and is pressed through a 44 px square).
    const press = pressSize(el);
    if (
      touch &&
      el.closest(TOUCH_PARTS) &&
      !el.matches(TOUCH_SKIP) &&
      (press.width < 43.5 || press.height < 43.5)
    )
      out.push('under 44: ' + name(el) + ' (' + n(press.width) + ' by ' + n(press.height) + ')');
  }
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i],
        c = list[j];
      if (a.contains(c) || c.contains(a)) continue;

      // The open menu lies over the page on purpose.
      if (!!a.closest('.tnt-menu') !== !!c.closest('.tnt-menu')) continue;

      // Rename and Close of a workspace tab share 2 px at every window size: an older part of
      // the All threads page's top row, listed as open in the build log, not a tablet fault.
      if (a.closest('.terminal-workspace-tab') && a.parentElement === c.parentElement) continue;

      const p = seen(a),
        q = seen(c);
      const w = Math.min(p.right, q.right) - Math.max(p.left, q.left),
        h = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (w > 1 && h > 1)
        out.push(
          'over each other: ' + name(a) + ' and ' + name(c) + ' (' + n(w) + ' by ' + n(h) + ')'
        );
    }
  return out;
};

const audit = (label, touch = false) => {
  const found = faults(touch);
  check(
    found.length === 0,
    label +
      ' (page ' +
      window.innerWidth +
      ' by ' +
      window.innerHeight +
      '): ' +
      (found.length ? found.length + ' faults: ' + found.slice(0, 24).join(' | ') : 'no fault')
  );
};

const menuButton = () => document.querySelector('.top .tnt-menu-btn'),
  menu = () => document.querySelector('.tnt-menu'),
  listButton = () => document.querySelector('.top .tnt-fold-list'),
  sideButton = () => document.querySelector('.tnt-head-acts .tnt-fold-side'),
  term = () => document.getElementById('terminalView');

// The rename pencils against their neighbors (issue sweep item 18): the open thread's pencil
// (120) and each card's pencil on All threads (135) sit right after the name, on its center
// line, with the icon in the middle of the box. The room after the name is measured only
// without touch, where the pencil keeps its small box.
const pencils = (tag, touch) => {
  const pairs = [...document.querySelectorAll('.tnt-head-rename, .tat-rename')]
    .filter(shown)
    .map(pencil => ({
      pencil,
      title: pencil.parentElement.querySelector(
        pencil.classList.contains('tat-rename') ? 'b' : 'h1'
      ),
    }))
    .filter(pair => shown(pair.title));
  const out = [];
  for (const { pencil, title } of pairs) {
    const p = box(pencil),
      t = box(title),
      icon = box(pencil.querySelector('svg'));
    const gap = p.left - t.right;
    if (!touch && (gap < 1 || gap > 10)) out.push('room after the name ' + n(gap));
    if (Math.abs(p.top + p.height / 2 - (t.top + t.height / 2)) > 1.5)
      out.push('off the name’s center line by ' + n(p.top + p.height / 2 - (t.top + t.height / 2)));
    if (
      Math.abs(icon.left + icon.width / 2 - (p.left + p.width / 2)) > 1 ||
      Math.abs(icon.top + icon.height / 2 - (p.top + p.height / 2)) > 1
    )
      out.push('icon off the middle of its box');
  }
  check(
    pairs.length > 0 && out.length === 0,
    tag +
      ': ' +
      pairs.length +
      ' rename pencil(s) beside their names' +
      (out.length ? ' (' + out.join(', ') + ')' : '')
  );
};

// The states of one size. Each leaves the app as it found it: on Threads, the thread open, the
// list shown, the side column closed.
const walk = async (tag, touch, pictures) => {
  const state = async label => {
    await frame();
    audit(tag + ' ' + label, touch);
    if (label === 'thread' || label === 'all-threads') pencils(tag + ' ' + label, touch);
    if (pictures)
      await shot('tablet-' + tag.replace(/\s+/g, '-') + '-' + label.replace(/\s+/g, '-'));
  };

  await state('thread');

  // the New thread start screen (140): its tools, This folder / Own worktree and Cancel
  threads.slot('list').querySelector('.tnt-new')?.click();
  await wait(450);

  // the prompt box repaints its worktree label on a new size or New thread: unhidden again
  // (see below), so the Where row is measured too
  const label = document.getElementById('wtCompose')?.closest('label');
  if (label) label.hidden = false;
  window.TnaiThreadStart?.paint?.();
  await wait(150);
  check(
    window.TnaiThreadStart?.shown?.() === true && shown(document.querySelector('.tnt-start-where')),
    tag + ': New thread shows the start screen, with its Where row'
  );
  await state('start');
  window.TnaiLiveTasks?.newAgent?.(false);
  await wait(300);

  sideButton()?.click();
  await wait(450);
  check(shown(threads.slot('side')), tag + ': the side column opens');
  await state('side');
  column.close ? column.close() : sideButton()?.click();
  if (shown(threads.slot('side'))) document.querySelector('.tnt-sidebox-close')?.click();
  await wait(450);
  check(
    !shown(threads.slot('side')) && shown(threads.slot('main')),
    tag + ': and the thread is back'
  );

  menuButton().click();
  await until(() => shown(menu()), 2000);
  await wait(250);
  {
    const m = box(menu());
    check(
      shown(menu()) &&
        m.left >= 0 &&
        m.right <= window.innerWidth &&
        m.bottom <= window.innerHeight,
      tag +
        ': the menu lies inside the window (' +
        n(m.left) +
        ' to ' +
        n(m.right) +
        ', down to ' +
        n(m.bottom) +
        ')'
    );
  }
  await state('menu');
  menuButton().click();
  await wait(300);
  if (shown(menu()))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);

  listButton().click();
  await wait(450);
  check(layout.classList.contains('tnt-list-closed'), tag + ': the list hides');
  await state('no list');
  listButton().click();
  await wait(450);

  // the All threads page: the route 'terminal' is that page
  window.TnaiRoute('terminal');
  await until(() => layout.classList.contains('terminal-mode') && shown(term()), 5000);
  await wait(700);
  await state('all-threads');
  threads.open();
  await until(() => threads.visible(), 4000);
  await wait(400);
};

const SIZES = [
  [1440, 900, '1440'],
  [1280, 800, '1280'],
  [1024, 768, '1024'],
  [768, 680, 'smallest'],
  [1280, 680, 'low'],
];

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

// The window takes the size, or the size is one failure that says what the window was, instead
// of a fault for every state measured on a page that kept its old size.
const sized = async (width, height, tag) => {
  const got = await main('size', width, height);
  await wait(500);

  // within 40 px: the smallest size lies near the window's own minimum
  if (got && Math.abs(got[0] - width) <= 40 && Math.abs(got[1] - height) <= 40) return true;
  check(
    false,
    tag +
      ': the window did not take ' +
      width +
      ' by ' +
      height +
      ' (' +
      (await main('state')) +
      ')'
  );
  return false;
};

// The start screen's Where row shows only in a git project and the test project is none: the
// prompt box's worktree label is unhidden for this test so the row is measured, then put back.
const worktreeLabel = document.getElementById('wtCompose')?.closest('label');
const worktreeWasHidden = !!worktreeLabel?.hidden;
if (worktreeLabel) worktreeLabel.hidden = false;
try {
  check(threads?.visible() === true && !!column, 'starts on Threads');
  await main('awake');
  await agents.detect(true);
  for (let i = 0; i < 4; i++) await openThread('Terminal');
  check(
    !!(await until(() => agents.sessions().filter(s => s.running).length >= 4, 30000)),
    'setup: four PowerShell threads running'
  );
  const paneId = agents.sessions()[0].paneId;
  await wait(1500);
  threads.open();
  threads.select(paneId);
  check(!!(await until(() => shown(sideButton()))), 'a thread is open');

  for (const look of ['dark', 'light']) {
    theme.set(look);
    await wait(400);
    for (const [width, height, label] of SIZES) {
      if (!(await sized(width, height, look + ' ' + label))) continue;

      // Dark carries the measurements at every size; Light is looked at in the pictures and
      // measured at the two tablet sizes.
      if (look === 'dark' || label === '1024' || label === 'smallest')
        await walk(look + ' ' + label, false, true);
    }
  }

  // ---------- touch ----------
  await main('touch', true);
  await wait(400);
  check(
    matchMedia('(pointer: coarse)').matches,
    'with touch on the page reads a coarse pointer (hover: ' +
      matchMedia('(hover: hover)').matches +
      ')'
  );
  for (const look of ['dark', 'light']) {
    theme.set(look);
    await wait(400);
    for (const [width, height, label] of SIZES.filter(
      s => s[2] === '1024' || s[2] === 'smallest'
    )) {
      if (!(await sized(width, height, 'touch ' + look + ' ' + label))) continue;
      await walk('touch ' + look + ' ' + label, true, true);
    }
  }
  await main('touch', false);
} catch (error) {
  check(false, 'the test ran to its end: ' + (error && error.stack ? error.stack : error));
}
window.TnaiLiveTasks?.newAgent?.(false);
if (worktreeLabel) worktreeLabel.hidden = worktreeWasHidden;
theme?.set('dark');
return { ok, log };
