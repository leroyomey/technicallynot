// Technically Not tools · desktop-check/tests/ghost-lines.js — Ghost lines:
// on every main page and Settings section, lists what can draw a faint line nobody
// meant: a tall thin element, an edge of a box that has a backdrop blur or a mask but no fill of
// its own, a visible border on a wrapper. Prints what it finds per page; fails on the kinds fixed
// so far. No prompt is sent to any agent. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
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
const clear = c =>
  !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c) || /\/\s*0\)$/.test(c);
const name = e =>
  e.tagName.toLowerCase() +
  (e.id ? '#' + e.id : '') +
  (typeof e.className === 'string' && e.className.trim()
    ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.')
    : '');

// Everything inside `root` that is on screen and may draw a line: returns short descriptions.
const scan = root => {
  const out = [];
  for (const e of root.querySelectorAll('*')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    const b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1 || b.bottom < 0 || b.top > innerHeight) continue;
    for (const pseudo of ['', '::before', '::after']) {
      const cs = getComputedStyle(e, pseudo || null);
      if (pseudo && (cs.content === 'none' || cs.content === 'normal')) continue;
      if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) continue;
      const w = pseudo ? parseFloat(cs.width) : b.width,
        h = pseudo ? parseFloat(cs.height) : b.height,
        why = [];
      const fill = !clear(cs.backgroundColor) || cs.backgroundImage !== 'none';
      const sides = ['Top', 'Right', 'Bottom', 'Left'].filter(
        s =>
          parseFloat(cs['border' + s + 'Width']) > 0 &&
          cs['border' + s + 'Style'] !== 'none' &&
          !clear(cs['border' + s + 'Color'])
      );
      if (fill && ((w <= 2 && h >= 24) || (h <= 2 && w >= 24)))
        why.push('thin fill ' + Math.round(w * 10) / 10 + '×' + Math.round(h * 10) / 10);
      if (!pseudo && sides.length && sides.length < 4 && Math.max(w, h) >= 120)
        why.push('border ' + sides.join('+') + ' ' + cs['border' + sides[0] + 'Color']);
      const edge = ['Top', 'Right', 'Bottom', 'Left'].some(
        k =>
          parseFloat(cs['border' + k + 'Width']) > 0 &&
          cs['border' + k + 'Style'] !== 'none' &&
          clear(cs['border' + k + 'Color'])
      );
      if (
        !pseudo &&
        edge &&
        /gradient/.test(cs.backgroundImage) &&
        !/padding-box|content-box/.test(cs.backgroundClip) &&
        cs.backgroundOrigin.split(', ')[0] === 'padding-box' &&
        Math.max(w, h) >= 120
      )
        why.push('GHOST gradient fill paints under a transparent border');
      if (cs.backdropFilter && cs.backdropFilter !== 'none' && !fill)
        why.push('backdrop blur without fill');
      if (
        cs.boxShadow !== 'none' &&
        !/inset/.test(cs.boxShadow) &&
        !fill &&
        !sides.length &&
        !/rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(cs.boxShadow)
      )
        why.push('SHADOW ON AN INVISIBLE BOX ' + cs.boxShadow.slice(0, 60));
      if (cs.boxShadow !== 'none' && /inset/.test(cs.boxShadow) && Math.max(w, h) >= 120)
        why.push('inset shadow ' + cs.boxShadow.slice(0, 60));
      if (
        cs.outlineStyle !== 'none' &&
        parseFloat(cs.outlineWidth) > 0 &&
        !clear(cs.outlineColor) &&
        e !== document.activeElement
      )
        why.push('outline');
      if (why.length)
        out.push(
          name(e) +
            pseudo +
            ' [' +
            Math.round(b.left) +
            ',' +
            Math.round(b.top) +
            ' ' +
            Math.round(b.width) +
            '×' +
            Math.round(b.height) +
            '] ' +
            why.join('; ')
        );
    }
  }
  return out;
};
const hair = root => {
  const seen = new Set(),
    out = [];
  for (const e of root.querySelectorAll('*')) {
    if (!e.offsetParent) continue;
    const cs = getComputedStyle(e),
      px = cs.boxShadow.match(/-?[\d.]+px/g);
    if (
      !px ||
      /inset|,.*px.*,.*px .*,/.test(cs.boxShadow.replace(/\([^)]*\)/g, '')) ||
      parseFloat(px[2]) > 3 ||
      parseFloat(px[3]) > 0 ||
      /rgba\(0, 0, 0, 0\)/.test(cs.boxShadow)
    )
      continue;
    const b = e.getBoundingClientRect(),
      k = name(e);
    if (b.width < 60 || seen.has(k)) continue;
    seen.add(k);
    out.push(
      k +
        ' [' +
        Math.round(b.left) +
        ',' +
        Math.round(b.top) +
        ' ' +
        Math.round(b.width) +
        '×' +
        Math.round(b.height) +
        '] bg ' +
        cs.backgroundColor +
        ' shadow ' +
        cs.boxShadow
    );
  }
  return out;
};
const report = (label, root) => {
  const found = scan(root),
    ghosts = found.filter(f => /GHOST/.test(f));
  check(
    !ghosts.length,
    label + ': no ghost line (' + found.length + ' line-like things looked at)'
  );
  ghosts.slice(0, 12).forEach(f => log.push('       ' + f));
  hair(root).forEach(f => log.push('       note, hairline shadow: ' + f));
  return found;
};

window.TnaiRoute('settings');
await until(() => document.getElementById('settingsPage')?.offsetParent);
const page = document.getElementById('settingsPage');
for (const tab of window.TnaiSettings.tabs()) {
  window.TnaiSettings.open(tab);
  await wait(400);
  const panel = document.getElementById('settingsPanel-' + tab);
  if (tab !== 'agents') {
    report('Settings › ' + tab, page);
    await shot('ghost-settings-' + tab);
    continue;
  }
  for (const sec of ['work', 'finish', 'custom', 'deleg', 'context']) {
    const t = document.getElementById('saTab-' + sec);
    if (!t) continue;
    t.click();
    await wait(450);
    report('Settings › agents › ' + sec, page);
    await shot('ghost-agents-' + sec);
  }
}

// The pages of the thread layout, each opened the way the three-dots menu opens it (the old
// navigation's Overview, Agents and Terminal pages are gone since 2026-10-12).
const PAGES = [
  { name: 'threads', go: () => window.TnaiThreads?.open?.() },
  { name: 'all-threads', go: () => window.TnaiTest.openAllThreads() },
  { name: 'live-preview', go: () => window.TnaiLivePreviewPage?.open?.() },
  { name: 'skills', go: () => window.TnaiRoute('skills') },
];
for (const entry of PAGES) {
  await entry.go();
  await wait(900);
  report('Page ' + entry.name, document.querySelector('.layout'));
  await shot('ghost-page-' + entry.name);
}

// The Live preview page's Pop out icon sits in the middle of its button (it was 1 px low): the
// drawn icon's center against the button's center, both ways, within half a pixel.
await window.TnaiLivePreviewPage?.open?.();
await wait(600);
const popButton = document.querySelector('.lpp-tabrow .lpp-pop');
const popIcon = popButton?.querySelector('svg');
if (popButton && popIcon) {
  const outer = popButton.getBoundingClientRect(),
    inner = popIcon.getBoundingClientRect();
  const dx = inner.left + inner.width / 2 - (outer.left + outer.width / 2),
    dy = inner.top + inner.height / 2 - (outer.top + outer.height / 2);
  check(
    Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5,
    'Pop out icon centered in its button (off by ' +
      Math.round(dx * 10) / 10 +
      ' px across, ' +
      Math.round(dy * 10) / 10 +
      ' px down)'
  );

  // "On top" belongs to the popped-out window only: hidden while the preview is docked.
  const onTop = document.querySelector('.lpp-tabrow .lpp-ontop');
  check(!onTop || !onTop.offsetParent, '"On top" hidden while the preview is docked');
} else log.push('note Pop out button not shown (no native panels), not measured');

// The lowest rows of Settings › Agents › Context (scrolled to the end) and the Live preview page,
// in Dark and in Light: a faint line can show in one look only.
// The box on the Settings page that scrolls the most (the open section's list).
const scroller = root =>
  [root, ...root.querySelectorAll('*')]
    .filter(
      e =>
        e.offsetParent &&
        e.scrollHeight > e.clientHeight + 4 &&
        /auto|scroll/.test(getComputedStyle(e).overflowY)
    )
    .sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
for (const look of ['dark', 'light']) {
  window.TnaiTheme?.set(look);
  window.TnaiRoute('settings');
  window.TnaiSettings.open('agents');
  await wait(400);
  document.getElementById('saTab-context')?.click();
  await wait(450);
  const list = scroller(page);
  if (list) list.scrollTop = list.scrollHeight;
  else log.push('note Settings › agents › context does not scroll: its end is already in view');
  await wait(300);
  report('Settings › agents › context, end, ' + look, page);
  await shot('ghost-agents-context-end-' + look);
  await window.TnaiLivePreviewPage?.open?.();
  await wait(700);
  report('Page live-preview, ' + look, document.querySelector('.layout'));
  await shot('ghost-page-live-preview-' + look);
}
window.TnaiTheme?.set('dark');
return { ok, log };
