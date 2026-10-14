// Technically Not tools · desktop-check/tests/snap-sizes.js — Windows Snap / split-screen sizes:
// reads the window minimum (main.js) and what a half snap gets, then lowers the minimum
// (snap-sizes.main.js) and sizes the real window to the default 1440×900, half and quarter snaps
// (960×1040, 960×680, 960×520), 1920-at-125% halves (768×824, 768×680), a 1366 laptop half
// (683×768), a 2560 half (1280×1400), 1280×720 and a 1920-at-150% half (640×690). On Threads
// (a thread open on its CLI screen), All threads, Devices, Live preview, Skills and Settings it
// checks: no page scroll, no control cut by its panel or outside the window, no overlapping
// buttons, the composer in view, the CLI screen filling its box; dialogs (shortcuts, command
// palette) inside the window. Then an animated snap 1440×900 → 960×1040 → 1440×900 checks the
// CLI screen refits. 4 real PowerShell threads, no agent prompt. Screenshots
// desktop-snap-<size>-<page>.png. Returns {ok, log}.
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
    await wait(60);
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
  await wait(650);
};
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
const G = window.TnaiAgents,
  layout = document.querySelector('.layout');

// The route each page opens by (the three-dots menu's rows call the same routes; 'overview' is
// the Threads page).
const PAGES = {
  overview: 'overview',
  agents: 'agents',
  devices: 'devices',
  preview: 'live-preview',
  terminal: 'terminal',
  skills: 'skills',
  settings: 'settings',
};

// The thread whose CLI screen is the terminal on the Threads page (set in the setup).
let screenThread = '';
const go = async page => {
  // The Threads page with a thread on its CLI screen; All threads as the menu opens it.
  if (page === 'overview' && screenThread) {
    window.TnaiThreads.show(screenThread);
    if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  } else if (page === 'terminal') await window.TnaiTest.openAllThreads();
  else window.TnaiRoute(PAGES[page]);
  await wait(450);
  await frame();
};
const shown = el =>
  !!el &&
  el.getClientRects().length > 0 &&
  !el.closest('[hidden]') &&
  getComputedStyle(el).visibility !== 'hidden';
const label = el =>
  (el.id
    ? '#' + el.id
    : el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/)[0]
        : '')) +
  (el.textContent?.trim()
    ? ' "' + el.textContent.trim().slice(0, 18) + '"'
    : el.title
      ? ' [' + el.title.slice(0, 18) + ']'
      : '');

// Where a control stands: 'ok', 'scroll' (outside a scrolling box: reachable by scrolling), 'cut'
// (partly cut by a non-scrolling box or the window), 'hidden' (entirely inside a closed/collapsed
// box).
function place(el) {
  const r = el.getBoundingClientRect();
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const ar = a.getBoundingClientRect();
    const outX = r.left < ar.left - 2 || r.right > ar.right + 2,
      outY = r.top < ar.top - 2 || r.bottom > ar.bottom + 2;
    if (!outX && !outY) continue;
    const canX = /auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1,
      canY = /auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1;
    if ((!outX || canX) && (!outY || canY)) return 'scroll';
    const whollyOut =
      r.right <= ar.left ||
      r.left >= ar.right ||
      r.bottom <= ar.top ||
      r.top >= ar.bottom ||
      ar.width < 4 ||
      ar.height < 4;
    return (whollyOut ? 'hidden' : 'cut') + ' by ' + label(a);
  }

  // Same 2 px allowance as the ancestor check above: a button that straddles the fold of a
  // scrolling page by a pixel passed that check (it is reachable by scrolling) and was then
  // reported here as cut by the window (Settings › Accounts at 768×824, 2026-10-01).
  if (r.left < -2 || r.top < -2 || r.right > innerWidth + 2 || r.bottom > innerHeight + 2)
    return 'cut by the window (' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ')';
  return 'ok';
}

// How well an xterm fills its box (as terminal-fit.js measures it).
function fit(host) {
  const x = host.querySelector('.xterm'),
    screen = x?.querySelector('.xterm-screen'),
    m = x?.querySelector('.xterm-char-measure-element');
  if (!screen) return null;
  const cs = getComputedStyle(x.parentElement),
    xs = getComputedStyle(x),
    pad = (st, a, b) => parseFloat(st[a]) + parseFloat(st[b]),
    inner = cs.boxSizing === 'border-box';
  const sr = screen.getBoundingClientRect(),
    br = x.parentElement.getBoundingClientRect();
  let cellW, cellH;
  if (x.querySelector('.xterm-rows > div')) {
    // DOM renderer: measured from the drawn rows
    const span = [...x.querySelectorAll('.xterm-rows span')].find(s => s.textContent.length >= 10),
      rowEl = x.querySelector('.xterm-rows > div');
    cellW = span
      ? span.getBoundingClientRect().width / span.textContent.length
      : !m
        ? 0
        : m.getBoundingClientRect().width / (m.textContent.length || 1);
    cellH = rowEl.getBoundingClientRect().height;
  } else {
    // WebGL (a canvas, no rows in the DOM): the screen is cols × rows cells of the pty size this
    // view drives
    // (the CLI screen of a thread is the screen of the thread that is shown)
    const paneId = host.classList.contains('tnt-term-host')
      ? window.TnaiThreadView.shown()
      : host.closest('[data-pane-id]')?.dataset.paneId;
    const p = G.ptySize.get(paneId);
    if (!p?.cols || !p?.rows) return null;
    cellW = sr.width / p.cols;
    cellH = sr.height / p.rows;
  }
  if (!cellW || !cellH) return null;
  const w =
      parseFloat(cs.width) -
      (inner ? pad(cs, 'paddingLeft', 'paddingRight') : 0) -
      pad(xs, 'paddingLeft', 'paddingRight'),
    h =
      parseFloat(cs.height) -
      (inner ? pad(cs, 'paddingTop', 'paddingBottom') : 0) -
      pad(xs, 'paddingTop', 'paddingBottom');
  const cols = Math.round(sr.width / cellW),
    rows = Math.round(sr.height / cellH),
    wantCols = Math.max(2, Math.floor((w - 14) / cellW)),
    wantRows = Math.max(1, Math.floor(h / cellH));
  return {
    cols,
    rows,
    wantCols,
    wantRows,
    fits:
      Math.abs(cols - wantCols) <= 1 &&
      Math.abs(rows - wantRows) <= 1 &&
      sr.right <= br.right + 2 &&
      sr.bottom <= br.bottom + 2,
  };
}
const terms = () =>
  [...document.querySelectorAll('.tnai-xterm, .tnt-term-host')].filter(
    h => shown(h) && h.offsetParent && h.getBoundingClientRect().width > 20
  );

// One page at the current size.
function audit(tag) {
  const problems = [],
    W = innerWidth,
    H = innerHeight,
    de = document.documentElement;
  if (de.scrollWidth > W + 1 || document.body.scrollWidth > W + 1)
    problems.push(
      'page scrolls sideways (' +
        Math.max(de.scrollWidth, document.body.scrollWidth) +
        ' > ' +
        W +
        ')'
    );
  if (de.scrollHeight > H + 1)
    problems.push('page scrolls down (' + de.scrollHeight + ' > ' + H + ')');
  const controls = [
    ...document.querySelectorAll(
      'button, a[href], input:not([type=hidden]), select, textarea, [role=button]'
    ),
  ].filter(
    el =>
      shown(el) &&
      !el.closest('.xterm') &&
      !el.closest('.tnai-keys-overlay, .tnai-pal-overlay') &&
      el.getBoundingClientRect().width >= 2 &&
      getComputedStyle(el).opacity !== '0'
  );
  const placed = controls.map(el => [el, place(el)]);

  // The Overview project tabs strip (08 .pgo-ptabs) clips a crowded tab on purpose (overflow
  // hidden): noted, not a problem.
  placed
    .filter(([el, p]) => p.startsWith('cut') && el.closest('.pgo-ptabs'))
    .forEach(([el]) => log.push('info ' + label(el) + ' clipped by the project tabs strip'));
  const cut = placed.filter(([el, p]) => p.startsWith('cut') && !el.closest('.pgo-ptabs'));
  for (const [el, p] of cut.slice(0, 6)) problems.push(label(el) + ' ' + p);
  if (cut.length > 6) problems.push('+' + (cut.length - 6) + ' more cut');
  const hidden = placed.filter(([, p]) => p.startsWith('hidden'));

  // Buttons on top of each other (not nested, both fully shown).
  const btns = placed
    .filter(([el, p]) => p === 'ok' && el.matches('button, [role=button], select'))
    .map(([el]) => [el, el.getBoundingClientRect()]);
  const overlaps = [];
  for (let i = 0; i < btns.length; i++)
    for (let j = i + 1; j < btns.length; j++) {
      const [a, ra] = btns[i],
        [b, rb] = btns[j];
      if (a.contains(b) || b.contains(a)) continue;

      // the bell is a badge on the account button (07 margin -14px), by design
      if (a.matches('.tnai-bell') || b.matches('.tnai-bell')) continue;
      const ow = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left),
        oh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ow > 3 && oh > 3)
        overlaps.push(
          label(a) + ' ⟂ ' + label(b) + ' (' + Math.round(ow) + '×' + Math.round(oh) + ')'
        );
    }
  problems.push(...overlaps.slice(0, 4).map(o => 'overlap ' + o));

  // Composer (where the page shows it).
  const prompt = document.getElementById('prompt'),
    send = document.getElementById('send');
  const composer = shown(prompt)
    ? [prompt, send].map(el => place(el)).filter(p => p !== 'ok')
    : ['hidden'];
  if (shown(prompt) && composer.length) problems.push('composer ' + composer.join(', '));

  // Terminals fill their boxes.
  const t = terms().map(fit).filter(Boolean),
    bad = t.filter(f => !f.fits);
  for (const f of bad.slice(0, 3))
    problems.push(
      'terminal ' + f.cols + '×' + f.rows + ' in a box for ' + f.wantCols + '×' + f.wantRows
    );
  const info =
    (shown(prompt) ? 'composer in view' : 'no composer') +
    (t.length
      ? ', ' + t.length + ' terminals ' + t.map(f => f.cols + '×' + f.rows).join(' ')
      : '') +
    (hidden.length ? ', ' + hidden.length + ' controls tucked in closed boxes' : '');

  // Smaller than the window minimum (main.js), which the app can't be sized to today: reported, not
  // failed (a layout decision for the user).
  const below = min0 && (innerWidth < min0[0] || innerHeight < min0[1]);
  (below
    ? (c, t) =>
        log.push(
          (c ? 'ok   ' : 'info ') +
            t +
            (c ? '' : ' [below the ' + min0.join('×') + ' window minimum]')
        )
    : check)(
    !problems.length,
    tag + ': ' + info + (problems.length ? ' — ' + problems.join('; ') : '')
  );
  return problems.length;
}

function dialog(tag, box) {
  if (!shown(box)) {
    check(false, tag + ': did not open');
    return;
  }
  const r = box.getBoundingClientRect(),
    problems = [];
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
    problems.push(
      'outside the window (' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ')'
    );
  if (box.scrollWidth > box.clientWidth + 1) problems.push('scrolls sideways');
  const cut = [...box.querySelectorAll('button, input, select')]
    .filter(shown)
    .map(el => [el, place(el)])
    .filter(([, p]) => p.startsWith('cut'));
  problems.push(...cut.slice(0, 3).map(([el, p]) => label(el) + ' ' + p));
  check(
    !problems.length,
    tag +
      ': ' +
      Math.round(r.width) +
      '×' +
      Math.round(r.height) +
      (problems.length ? ' — ' + problems.join('; ') : '')
  );
}

async function dialogs(tag) {
  await go('overview');
  window.TnaiShortcuts?.open();
  await wait(200);
  dialog(tag + ' shortcuts dialog', document.querySelector('.tnai-keys'));
  window.TnaiShortcuts?.close();
  await wait(100);

  // Ctrl+K is the three-dots menu's search now; the palette opens by its own call.
  window.TnaiPalette.open();
  await wait(250);
  dialog(
    tag + ' command palette',
    document.querySelector('.tnai-pal-overlay:not([hidden]) .tnai-pal')
  );
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  );
  await wait(150);
}

let min0 = null;
try {
  // ---- Setup: 4 real PowerShell threads, the first on its CLI screen, a file open.
  await G.detect(true);
  for (let count = 0; count < 4; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made.ok && !screenThread) screenThread = made.paneId;
  }
  check(G.sessions().filter(s => s.running).length >= 4, 'setup: 4 PowerShell threads running');
  await go('overview');
  check(
    !!(await until(() => terms().length === 1 && fit(terms()[0]), 8000)),
    'setup: the Threads page shows one terminal, the CLI screen of the open thread'
  );
  window.TnaiProjectFiles?.open('README.md');
  await wait(600);

  // ---- 1. The window minimum vs a half snap.
  min0 = await main('minimum');
  const clamped = await main('size', 960, 1040);
  log.push(
    'info window minimum ' +
      min0.join('×') +
      '; asking for a 960×1040 half snap gives ' +
      clamped.content.join('×') +
      ' (zoom ' +
      clamped.zoom +
      ')'
  );

  // ---- 2. Each snap size, with the minimum lowered so the window can take it.
  await main('setMinimum', 560, 400);
  const SIZES = [
    [1440, 900],
    [960, 1040],
    [960, 680],
    [960, 520],
    [768, 824],
    [768, 680],
    [683, 768],
    [1280, 1400],
    [1280, 720],
    [640, 690],
  ];
  const only = await main('only');
  for (const [w, h] of only === 'animated' ? [] : SIZES) {
    const got = await main('size', w, h),
      tag = w + 'x' + h;
    log.push(
      '--- ' +
        tag +
        ': content ' +
        got.content.join('×') +
        ', zoom ' +
        got.zoom +
        ', CSS ' +
        innerWidth +
        '×' +
        innerHeight
    );
    for (const page of Object.keys(PAGES)) {
      await go(page);
      if (page === 'terminal' || page === 'overview') await wait(350);
      audit(tag + ' ' + page);
      await shot('snap-' + tag + '-' + page);
    }
    await dialogs(tag);
  }

  // ---- 3. Animated snap: 1440×900 → 960×1040 → 1440×900, with a thread's CLI screen shown and
  // once while it is hidden.
  await main('setMinimum', 560, 400);
  await main('size', 1440, 900);
  await go('overview');
  await wait(400);
  const before = terms().map(fit).filter(Boolean);
  const sizes = list => list.map(f => f.cols + '×' + f.rows).join(' ');

  // Several rounds, since a missed last resize is a race: each round snaps to the half and back
  // while the CLI screen is shown. The terminal fits its box within 1.5 s of the box's last
  // change (with the app's WebGL renderer: snap-sizes is a RENDERER_TESTS entry in run.js). Also
  // when each terminal's box last changed size and when xterm's cols/rows last changed, to tell a
  // slow layout from a slow refit.
  let boxAt = 0,
    gridAt = 0;
  const ro = new ResizeObserver(() => {
    boxAt = performance.now();
  });
  terms().forEach(h => ro.observe(h));
  const gridSeen = new Map();
  const settle = async t0 => {
    const done = await until(() => {
      terms().forEach(h => {
        const k =
          h.querySelector('.xterm-screen')?.style.width +
          h.querySelector('.xterm-screen')?.style.height;
        if (gridSeen.get(h) !== k) {
          gridSeen.set(h, k);
          gridAt = performance.now();
        }
      });
      const f = terms().map(fit).filter(Boolean);
      return f.length === 1 && f.every(x => x.fits) && f;
    }, 6000);
    return {
      ms:
        Math.round(performance.now() - t0) +
        ' ms (boxes settled at ' +
        Math.round(boxAt - t0) +
        ', terminals resized at ' +
        Math.round(gridAt - t0) +
        ')',
      f: done || terms().map(fit).filter(Boolean),
      done: !!done,
      n: gridAt - boxAt,
    };
  };
  for (let round = 1; round <= 4; round++) {
    let t0 = performance.now();
    await main('animate', 1440, 900, 960, 1040, 14, 0);
    const half = await settle(t0);
    check(
      half.done && half.n < 1500,
      'animated snap ' +
        round +
        ' to 960×1040: the CLI screen refits in ' +
        half.ms +
        ' (' +
        sizes(before) +
        ' → ' +
        sizes(half.f) +
        ')'
    );
    if (round === 1) {
      audit('animated 960x1040 terminal');
      await shot('snap-animated-half-terminal');
    }
    t0 = performance.now();
    await main('animate', 960, 1040, 1440, 900, 14, 0);
    const full = await settle(t0);
    check(
      full.done && full.n < 1500,
      'animated snap ' +
        round +
        ' back to 1440×900: the CLI screen refits in ' +
        full.ms +
        ' (' +
        sizes(full.f) +
        ')'
    );
  }
  await main('animate', 1440, 900, 960, 1040);
  await go('skills');
  await main('animate', 960, 1040, 1440, 900);
  audit('animated back 1440x900 skills');
  await go('overview');
  await wait(400);
  const back = await until(() => {
    const f = terms().map(fit).filter(Boolean);
    return f.length === 1 && f.every(x => x.fits) && f;
  }, 6000).then(found => found || terms().map(fit).filter(Boolean));
  check(
    back.length === 1 &&
      back.every(f => f.fits) &&
      back.every((f, i) => !before[i] || (f.cols === before[i].cols && f.rows === before[i].rows)),
    'snapped back while hidden: the CLI screen refits to the old size (' +
      back.map(f => f.cols + '×' + f.rows).join(' ') +
      ')'
  );
  audit('animated back 1440x900 threads');
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
if (min0) await main('setMinimum', ...min0).catch(() => {});
return { ok, log };
