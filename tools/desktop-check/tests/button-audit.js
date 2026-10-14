// Technically Not tools · desktop-check/tests/button-audit.js — Walks every page (and Settings
// tabs) and measures every visible button: groups them by rendered size so off-by-a-few-pixel
// buttons stand out. Lists every button height (inventory); fails only on a button under 14 px
// high. Sets up the state that shows more buttons: a running PowerShell thread (the Threads page
// with its thread open, the thread's screen, All threads with a thread on it). No prompt is sent
// to any agent.
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

// The old 24/30 px height rule belonged to the pre-purple design. The purple redesign (approved and
// frozen 2026-09-30) sizes buttons per surface, so heights are now an inventory (info lines, diff
// them between runs); only a button too small to click fails.
const MIN_H = 14;
const seen = new Map();
const own = b =>
  (b.id ? '#' + b.id : '') +
  (typeof b.className === 'string' && b.className
    ? '.' + b.className.trim().split(/\s+/).join('.')
    : '');

// A bare <button> is named by its nearest classed ancestor, so different places don't merge into
// one entry.
const describe = b =>
  own(b) ||
  (b.parentElement?.closest('[class]')?.className || '')
    .toString()
    .trim()
    .split(/\s+/)
    .map(c => '.' + c)
    .join('') + ' > button';

// Link-style text buttons (no box) size like text, not like buttons.
// .tnai-task-more: the ⌄ after a one-line task text (11)
const LINKS = '.skills-more, .repo-project-switch, .tnai-task-more';

function measure(page) {
  for (const b of document.querySelectorAll('button, .button, [role="button"], a.button')) {
    const r = b.getBoundingClientRect(),
      cs = getComputedStyle(b);
    if (
      !r.width ||
      !r.height ||
      cs.visibility === 'hidden' ||
      b.closest('[hidden], .xterm') ||
      b.matches(LINKS)
    )
      continue;

    // Whole-row/list items that happen to be buttons (tree rows, menu items, cards, tabs) are not
    // "buttons" in the sizing sense.
    if (
      r.width > 260 ||
      b.closest('.tnai-attach-menu, [role="menu"], [role="tablist"], .terminal-provider-card') ||
      /side-item|tree|row|card|tab\b|menu-item|chip/.test(describe(b))
    )
      continue;
    const key = describe(b),
      h = Math.round(r.height),
      w = Math.round(r.width);
    const entry = seen.get(key) || {
      key,
      pages: new Set(),
      sizes: new Set(),
      text: (b.textContent || b.title || b.getAttribute('aria-label') || '').trim().slice(0, 24),
      font: cs.fontSize,
      pad: cs.padding,
      radius: cs.borderRadius,
    };
    entry.pages.add(page);
    entry.sizes.add(w + 'x' + h);
    seen.set(key, entry);
  }
}
try {
  // A running PowerShell thread, so the pages show the buttons they have with a session open.
  const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  check(!!started.session?.running, 'setup: a PowerShell thread is running');
  await wait(400);
  measure('threads');

  // Its screen (a PowerShell thread opens on it) and "Your terminal" in the side column.
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await wait(400);
  measure('thread screen');

  // The pages of the three-dots menu, each opened the way its menu row opens it.
  check(await window.TnaiTest.openAllThreads(), 'setup: the All threads page opens');
  await wait(350);
  measure('all threads');
  for (const page of ['devices', 'skills']) {
    window.TnaiRoute(page);
    await wait(350);
    measure(page);
  }
  window.TnaiLivePreviewPage?.open();
  await wait(350);
  measure('live-preview');
  window.TnaiSettings.open('general');
  await wait(350);
  measure('settings');
  for (const tab of document.querySelectorAll('.settings-tabs [data-tab]')) {
    tab.click();
    await wait(300);
    measure('settings:' + tab.dataset.tab);
  }
  window.TnaiThreads.open();
  await wait(200);
  const rows = [...seen.values()].map(e => ({
    ...e,
    hs: [...new Set([...e.sizes].map(s => +s.split('x')[1]))],
  }));
  const byHeight = {};
  for (const e of rows) for (const h of e.hs) (byHeight[h] = byHeight[h] || []).push(e.key);
  log.push(
    'heights: ' +
      Object.entries(byHeight)
        .sort((a, b) => a[0] - b[0])
        .map(([h, k]) => h + 'px×' + k.length)
        .join('  ')
  );
  for (const e of rows.sort((a, b) => a.hs[0] - b.hs[0])) {
    const good = e.hs.every(h => h >= MIN_H);
    (good ? l => log.push('info ' + l) : l => check(false, l))(
      [...e.sizes].join(',') +
        '  ' +
        e.key.slice(0, 70) +
        '  "' +
        e.text +
        '"  font ' +
        e.font +
        ' pad ' +
        e.pad +
        ' r ' +
        e.radius +
        '  [' +
        [...e.pages].join(',') +
        ']'
    );
  }
} catch (error) {
  check(false, 'threw: ' + error.message);
}
return { ok, log };
