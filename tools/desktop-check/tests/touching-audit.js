// Technically Not tools · desktop-check/tests/touching-audit.js — Nothing touches a line
// (the fault it was written for: boxes touched the divider line at the top of a page). On every
// page, every box (a card or panel: 120×60 px or larger, corners of 8 px or more, with an outline
// or a fill) is measured against everything in its own layer (the page, or one floating surface)
// beside it that draws an edge: another box, or an element with a visible border on the facing side
// (a toolbar's bottom line, a divider). A box whose edge is less than 2 px from such an edge, with
// no room between, is listed with both names and the distance. A box is also measured against the
// inside of its container: on each side, the nearest ancestor that draws that edge (a box, or a
// border on that side) must leave 2 px or more of room, except on a side that scrolls. Not
// measured: lines drawn with a shadow or a pseudo-element, anything inside a terminal, things
// smaller than a box (tabs, buttons, inputs: attached on purpose). ALLOW lists pairs that are
// attached by design, each with its reason. Sets up one running PowerShell thread. No prompt is
// sent to any agent. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
const NEAR = 2,
  MIN_W = 120,
  MIN_H = 60,
  MIN_R = 8,
  SHARED = 40; // px

// Pairs attached on purpose: [box selector, neighbor selector, why]. Keep it short; a new entry
// needs the reason a reader can check.
const ALLOW = [];
const name = el =>
  (el.id ? '#' + el.id : el.tagName.toLowerCase()) +
  (typeof el.className === 'string' && el.className.trim()
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '');
const inked = color => {
  const m = /rgba?\(([^)]+)\)/.exec(color || '');
  if (!m) return false;
  const p = m[1]
    .split(/[,\s/]+/)
    .filter(Boolean)
    .map(Number);
  return p.length < 4 || p[3] > 0.03;
};
const edge = (cs, side) =>
  parseFloat(cs['border' + side + 'Width']) >= 0.5 &&
  cs['border' + side + 'Style'] !== 'none' &&
  inked(cs['border' + side + 'Color']);
const problems = new Map(),
  audited = { boxes: 0, pairs: 0, inside: 0 };

// Something floating over the page (a palette, a menu, a dialog: its nearest position:fixed
// ancestor) is only measured against its own layer, never against the page under it.
const layers = new WeakMap();
const layerOf = el => {
  if (!el || el === document.body) return null;
  if (layers.has(el)) return layers.get(el);
  const v = getComputedStyle(el).position === 'fixed' ? el : layerOf(el.parentElement);
  layers.set(el, v);
  return v;
};

function audit(page) {
  const vw = innerWidth,
    vh = innerHeight,
    items = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.xterm, [hidden], svg, iframe, webview')) continue;
    const r = el.getBoundingClientRect();
    if (
      r.width < SHARED ||
      r.height < 1 ||
      r.bottom <= 0 ||
      r.top >= vh ||
      r.right <= 0 ||
      r.left >= vw
    )
      continue;
    const cs = getComputedStyle(el);

    // checkVisibility also sees an ancestor at opacity 0 (a closed command palette keeps its box in
    // the page)
    if (
      cs.visibility === 'hidden' ||
      cs.display === 'none' ||
      !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      continue;
    const sides = {
      Top: edge(cs, 'Top'),
      Bottom: edge(cs, 'Bottom'),
      Left: edge(cs, 'Left'),
      Right: edge(cs, 'Right'),
    };
    const outlined = sides.Top && sides.Bottom && sides.Left && sides.Right,
      filled = inked(cs.backgroundColor);
    const box =
      r.width >= MIN_W &&
      r.height >= MIN_H &&
      parseFloat(cs.borderTopLeftRadius) >= MIN_R &&
      (outlined || filled);
    if (box || sides.Top || sides.Bottom || sides.Left || sides.Right)
      items.push({
        el,
        r,
        box,
        sides,
        layer: layerOf(el),
        bw: {
          Top: parseFloat(cs.borderTopWidth) || 0,
          Bottom: parseFloat(cs.borderBottomWidth) || 0,
          Left: parseFloat(cs.borderLeftWidth) || 0,
          Right: parseFloat(cs.borderRightWidth) || 0,
        },
      });
  }
  const byEl = new Map(items.map(i => [i.el, i]));
  const boxes = items.filter(i => i.box);
  audited.boxes += boxes.length;

  // A box inside its container: on each side, the nearest ancestor that draws that edge (a box, or
  // a border on that side) must leave room inside it. A side that scrolls is not measured (a list's
  // first and last rows reach the edge of their scroller on purpose).
  for (const b of boxes) {
    const open = new Set(['Top', 'Bottom', 'Left', 'Right']),
      scrolls = { x: false, y: false };
    for (let a = b.el.parentElement; a && a !== document.body && open.size; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (/auto|scroll/.test(acs.overflowY)) scrolls.y = true;
      if (/auto|scroll/.test(acs.overflowX)) scrolls.x = true;
      const it = byEl.get(a);
      if (!it || it.layer !== b.layer) continue;
      for (const side of [...open]) {
        if (!it.box && !it.sides[side]) continue;
        open.delete(side);
        if (side === 'Top' || side === 'Bottom' ? scrolls.y : scrolls.x) continue;
        const gap =
          side === 'Top'
            ? b.r.top - (it.r.top + it.bw.Top)
            : side === 'Bottom'
              ? it.r.bottom - it.bw.Bottom - b.r.bottom
              : side === 'Left'
                ? b.r.left - (it.r.left + it.bw.Left)
                : it.r.right - it.bw.Right - b.r.right;
        audited.inside++;
        if (gap <= -NEAR || gap >= NEAR || ALLOW.some(([x, y]) => b.el.matches(x) && a.matches(y)))
          continue;
        const key = name(b.el) + ' inside-' + side.toLowerCase() + ' ' + name(a);
        if (!problems.has(key))
          problems.set(
            key,
            name(b.el) +
              ' sits flush against the inside of ' +
              name(a) +
              ' on its ' +
              side.toLowerCase() +
              ': ' +
              gap.toFixed(1) +
              ' px of room [' +
              page +
              ']'
          );
      }
    }
  }
  for (const b of boxes)
    for (const e of items) {
      if (e === b || e.layer !== b.layer || e.el.contains(b.el) || b.el.contains(e.el)) continue;
      const overX = Math.min(b.r.right, e.r.right) - Math.max(b.r.left, e.r.left),
        overY = Math.min(b.r.bottom, e.r.bottom) - Math.max(b.r.top, e.r.top);

      // [which side of the box, the distance to the neighbor's facing edge, they share enough of
      // the other axis, the neighbor draws that edge]
      const facing = [
        ['top', b.r.top - e.r.bottom, overX, e.box || e.sides.Bottom],
        ['bottom', e.r.top - b.r.bottom, overX, e.box || e.sides.Top],
        ['left', b.r.left - e.r.right, overY, e.box || e.sides.Right],
        ['right', e.r.left - b.r.right, overY, e.box || e.sides.Left],
      ];
      for (const [side, gap, shared, draws] of facing) {
        if (!draws || shared < SHARED) continue;
        audited.pairs++;
        if (gap <= -NEAR || gap >= NEAR) continue;
        if (ALLOW.some(([x, y]) => b.el.matches(x) && e.el.matches(y))) continue;
        const key = name(b.el) + ' ' + side + ' ' + name(e.el);
        if (!problems.has(key))
          problems.set(
            key,
            name(b.el) +
              ' touches ' +
              name(e.el) +
              (e.box ? ' (a box)' : ' (its line)') +
              ' on its ' +
              side +
              ': ' +
              gap.toFixed(1) +
              ' px of room [' +
              page +
              ']'
          );
      }
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
  // The pages of the thread layout: Threads, and what the three-dots menu opens (124). Each is
  // opened the way its menu row opens it.
  const PAGES = {
    threads: () => window.TnaiThreads.open(),
    usage: () => window.TnaiSettings.open('usage'),
    // the All threads page, as the menu's row opens it
    'all-threads': () => window.TnaiTest.openAllThreads(),
    'live-preview': () => window.TnaiLivePreviewPage.open(),
    skills: () => window.TnaiRoute('skills'),
    devices: () => window.TnaiRoute('devices'),
    settings: () => window.TnaiSettings.open('general'),
  };
  const go = async view => {
    await PAGES[view]();
    await wait(400);
  };
  const agents = window.TnaiAgents;
  if (agents) {
    await agents.detect(true);
    const a = await openThread('Terminal');
    check(
      !!a?.ok && !!(await until(() => agents.sessions().find(s => s.running))),
      'setup: one PowerShell thread running'
    );
  }

  // Self-test: a box planted right under a line and one planted against another box must be caught;
  // the same with 10 px of room must not.
  await go('threads');
  const plant = document.createElement('div');
  plant.style.cssText = 'position:fixed;left:40px;top:40px;z-index:999;width:520px';
  const card =
    'box-sizing:border-box;height:80px;border:1px solid rgb(120,120,120);border-radius:12px';
  plant.innerHTML =
    '<div class="zz-line" style="height:20px;border-bottom:1px solid rgb(120,120,120)"></div><div class="zz-under" style="' +
    card +
    '"></div><div class="zz-next" style="' +
    card +
    '"></div>' +
    '<div class="zz-line2" style="height:20px;margin-top:10px;border-bottom:1px solid rgb(120,120,120)"></div><div class="zz-clear" style="' +
    card +
    ';margin-top:10px"></div><div class="zz-clear2" style="' +
    card +
    ';margin-top:10px"></div>' +
    '<div class="zz-tight" style="' +
    card +
    ';height:auto;margin-top:10px"><div class="zz-flush" style="' +
    card +
    '"></div></div><div class="zz-roomy" style="' +
    card +
    ';height:auto;margin-top:10px;padding:10px"><div class="zz-inset" style="' +
    card +
    '"></div></div>';
  document.body.append(plant);
  audit('self-test');
  plant.remove();
  const caught = [...problems.keys()];
  check(
    caught.some(k => k.startsWith('div.zz-under top div.zz-line')) &&
      caught.some(k => k.startsWith('div.zz-next top div.zz-under')) &&
      !caught.some(k => /zz-clear/.test(k.split(' ')[0])),
    'self-test: a box under a line and a box against a box are caught, the same with 10 px of room are not (' +
      caught.filter(k => /zz-/.test(k)).length +
      ' caught)'
  );
  check(
    caught.some(k => k.startsWith('div.zz-flush inside-top div.zz-tight')) &&
      caught.some(k => k.startsWith('div.zz-flush inside-left div.zz-tight')) &&
      !caught.some(k => k.startsWith('div.zz-inset inside-')),
    'self-test: a box flush against the inside of its container is caught, one with 10 px of padding is not'
  );
  problems.clear();
  audited.boxes = audited.pairs = audited.inside = 0;

  // Every page of the thread layout.
  const views = [];
  for (const label of Object.keys(PAGES)) {
    await go(label);
    await wait(100);
    audit(label);
    views.push(label);
  }

  // Devices in its connected state (its cards and side column exist only then); turned off again so
  // the profile is left as found.
  if (views.includes('devices') && window.tnaiNative?.remote) {
    await go('devices');
    await window.tnaiNative.remote.setOn(true);
    await wait(500);
    audit('devices:on');
    await window.tnaiNative.remote.setOn(false);
    await wait(300);
  }
  if (views.includes('settings')) {
    await go('settings');
    for (const tab of document.querySelectorAll('.settings-tabs [data-tab]')) {
      tab.click();
      await wait(250);
      audit('settings:' + tab.dataset.tab);
    }
  }
  await go('threads');
  for (const label of problems.values()) check(false, label);
  check(
    views.length >= 7 && audited.boxes > 10,
    'pages audited: ' +
      views.join(', ') +
      ' · ' +
      audited.boxes +
      ' boxes · ' +
      audited.pairs +
      ' facing edges and ' +
      audited.inside +
      ' container sides measured · ' +
      problems.size +
      ' touching'
  );
} catch (error) {
  check(false, 'threw: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
