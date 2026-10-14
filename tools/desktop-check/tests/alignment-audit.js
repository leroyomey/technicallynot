// Technically Not tools · desktop-check/tests/alignment-audit.js — Measures what should line up, on
// every page: (1) (the left nav arrows are gone with the old navigation); (2)
// in every centered row (flex or grid, align-items center), the visible buttons, selects and inputs
// share one vertical center; (3) one-glyph icon buttons (×, «, ⧉, …) have their glyph centered in
// the box. Tolerance 1px. Sets up a running PowerShell pane so pane headers, cards and Agents page
// rows exist. No prompt is sent to any agent.
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
const TOL = 1;
const shown = el => {
  if (!el) return false;
  const r = el.getBoundingClientRect(),
    cs = getComputedStyle(el);
  return (
    r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden], .xterm')
  );
};
const name = el =>
  (el.id ? '#' + el.id : el.tagName.toLowerCase()) +
  (typeof el.className === 'string' && el.className.trim()
    ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
    : '');
const mid = r => r.top + r.height / 2;

// The ink-free text box of a one-glyph button (its line box, which is what CSS centers).
const glyph = el => {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
};
const problems = new Map(),
  // key -> label, so a problem seen on several pages is listed once
  audited = { rows: 0, glyphs: 0 };

function audit(page) {
  // (2) Rows: the controls directly in a centered row share a vertical center.
  for (const row of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(row);
    if (
      !/flex|grid/.test(cs.display) ||
      cs.alignItems !== 'center' ||
      /column/.test(cs.flexDirection) ||
      !shown(row) ||
      row.closest('.xterm, [role="menu"]')
    )
      continue;
    const controls = [...row.children].filter(
      c =>
        c.matches(
          'button, select, input:not([type=checkbox]):not([type=radio]), .button, [role="button"]'
        ) &&
        shown(c) &&
        getComputedStyle(c).position !== 'absolute'
    );
    if (controls.length < 2) continue;
    audited.rows++;
    const mids = controls.map(c => mid(c.getBoundingClientRect()));
    const spread = Math.max(...mids) - Math.min(...mids);

    // Controls that wrapped onto another line are a layout choice, not a misalignment.
    const lines = new Set(controls.map(c => Math.round(c.getBoundingClientRect().top / 20)));
    if (spread > TOL && spread < 12 && lines.size === 1) {
      const key = 'row ' + name(row);
      if (!problems.has(key))
        problems.set(
          key,
          key +
            ': control centers differ by ' +
            spread.toFixed(1) +
            'px (' +
            controls
              .map(c => name(c) + '@' + mid(c.getBoundingClientRect()).toFixed(1))
              .join(', ') +
            ') [' +
            page +
            ']'
        );
    }
  }

  // (3) One-glyph icon buttons: glyph centered in the box.
  for (const b of document.querySelectorAll('button')) {
    const text = (b.textContent || '').trim();
    if (!shown(b) || b.children.length || [...text].length !== 1) continue;
    const box = b.getBoundingClientRect();
    if (box.width > 48 || box.height > 48) continue;
    const cs = getComputedStyle(b);

    // text hidden (font-size 0): the button draws its label/icon with ::before/::after (07 #send),
    // no glyph to measure
    if (parseFloat(cs.fontSize) === 0) continue;
    if (
      cs.justifyContent === 'flex-start' ||
      cs.alignItems === 'flex-start' ||
      cs.textAlign === 'left'
    )
      continue; // a strip that pins its glyph to the top on purpose
    audited.glyphs++;
    const g = glyph(b),
      dx = g.left + g.width / 2 - (box.left + box.width / 2),
      dy = mid(g) - mid(box);
    if (Math.abs(dx) > TOL || Math.abs(dy) > TOL) {
      const key = 'glyph ' + name(b) + ' ' + text;
      if (!problems.has(key))
        problems.set(
          key,
          key +
            ': glyph off center by x ' +
            dx.toFixed(1) +
            ' y ' +
            dy.toFixed(1) +
            'px in ' +
            Math.round(box.width) +
            '×' +
            Math.round(box.height) +
            ' [' +
            page +
            ']'
        );
    }
  }
}

try {
  // Each page is opened the way its row of the three-dots menu opens it; the route 'terminal'
  // is the All threads page.
  const go = async view => {
    if (view === 'terminal') await window.TnaiTest.openAllThreads();
    else window.TnaiRoute(view);
    await wait(350);
  };

  // A running PowerShell thread, so the pages are audited with a session open.
  const agents = window.TnaiAgents;
  if (agents) {
    await agents.detect(true);
    const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
    check(!!started.session?.running, 'setup: a PowerShell thread is running');
  }

  // Self-test: a planted row 4px off and a planted glyph 4px off must both be caught, so "0
  // problems" means something.
  await go('overview');
  const plant = document.createElement('div');
  plant.style.cssText =
    'position:fixed;left:200px;top:200px;z-index:999;display:flex;align-items:center;gap:6px';
  plant.innerHTML =
    '<button class="zz-a" style="height:24px">A</button><button class="zz-b" style="height:24px;margin-top:8px">B</button><button class="zz-g" style="width:24px;height:24px;padding:0 0 8px;display:grid;place-items:center">×</button>';
  document.body.append(plant);
  audit('self-test');
  plant.remove();
  const caught = [...problems.keys()];
  check(
    caught.some(k => k.startsWith('row div')) &&
      caught.some(k => k.startsWith('glyph button.zz-g')),
    'self-test: planted row and glyph misalignments are caught'
  );
  problems.clear();
  audited.rows = audited.glyphs = 0;

  // (The left navigation's collapse arrows, check (1), are deleted with the old navigation.)
  // (2)+(3) on every page, plus an open thread and each Settings tab.
  for (const view of ['overview', 'terminal', 'devices', 'live-preview', 'settings']) {
    await go(view);
    audit(view);
  }
  const openPane = agents?.sessions().find(s => s.running)?.paneId;
  if (openPane) window.TnaiThreads.show(openPane);
  await wait(300);
  audit('threads:open thread');
  await go('settings');
  for (const tab of document.querySelectorAll('.settings-tabs [data-tab]')) {
    tab.click();
    await wait(250);
    audit('settings:' + tab.dataset.tab);
  }
  await go('overview');
  for (const label of problems.values()) check(false, label);
  check(
    true,
    'rows and icon buttons audited · ' +
      problems.size +
      ' problem(s) · ' +
      audited.rows +
      ' row checks · ' +
      audited.glyphs +
      ' glyph checks'
  );
} catch (error) {
  check(false, 'threw: ' + error.message);
}
return { ok, log };
