// Technically Not tools · desktop-check/tests/fit-sizes.js — Everything fits at every window size:
// on each page (Threads, Agents, Projects, Usage & accounts, Live preview, Terminal, Skills,
// Settings), at 768×680 (the window minimum),
// 1024×683, 1180×760 (the website's homepage demo lays the app out at exactly this size, then
// scales it), 1280×720, 1440×900 and 1920×1080, each once at the app's own zoom and once at ×1 (the
// website demo in a browser). It checks: no page scroll; no text, chip or control spilling past its
// card/panel (the nearest bordered or clipping box) or the window; no short label (≤ 24 characters)
// cut to an ellipsis; no text drawn over other text; the composer in view. At 768×680, 1024×683 and
// 1180×760 it also opens the New agent menu, Model and Effort pickers and
// checks each the same way (inside the window, nothing cut or spilled). Screenshots
// desktop-fit-<size>-<zoom>-<page>.png. 4 real PowerShell terminal panels run, so
// Threads shows 4 sessions; no agent prompt. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(500);
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

// Is the page drawing? A frame within 500 ms, what the page thinks of its visibility, how far the
// animation clock moved in that time, and what the window is to the system. A whole run gave 68,
// 108 and 7 failures on one day because at some sizes it was not (2026-10-07).
const pulse = async () => {
  const t0 = document.timeline.currentTime,
    p0 = performance.now();
  const raf = await Promise.race([
    new Promise(r => requestAnimationFrame(() => r(Math.round(performance.now() - p0)))),
    wait(500).then(() => -1),
  ]);
  await wait(Math.max(0, 500 - (performance.now() - p0)));
  const st = await main('state').catch(() => '?'),
    clock = Math.round(document.timeline.currentTime - t0);
  return {
    ok: raf >= 0 && document.visibilityState === 'visible' && clock >= 250,
    text:
      'frame ' +
      (raf < 0 ? 'none in 500 ms' : 'after ' + raf + ' ms') +
      ', page ' +
      document.visibilityState +
      ', animation clock +' +
      clock +
      ' ms in ' +
      Math.round(performance.now() - p0) +
      ' ms, window ' +
      st,
  };
};

// Before anything is measured: a page that stands still is woken (fit-sizes.main.js `awake`) and
// given 10 s. Woken, the audit goes on and the log says what the window was; still standing, the
// size fails with this one line instead of dozens of false ones.
async function drawing(tag, where) {
  const first = await pulse();
  if (first.ok) return first;
  const was = await main('awake').catch(() => '?');
  let now = first;
  const t0 = Date.now();
  while (!now.ok && Date.now() - t0 < 10000) now = await pulse();
  log.push(
    'info ' +
      tag +
      ' ' +
      where +
      ': the test window stood still (' +
      first.text +
      '; before the wake: ' +
      was +
      '), ' +
      (now.ok
        ? 'drawing again after ' + Math.round((Date.now() - t0) / 1000) + ' s'
        : 'still not drawing')
  );
  check(now.ok, tag + ' ' + where + ': the test window draws (' + now.text + ')');
  return now;
}

// The route each page opens by (the three-dots menu's rows call the same routes). 'overview' is the
// Threads page. Projects opens the project switcher (39 command palette) and Usage is a Settings
// tab, as they were when the old navigation listed them.
const PAGES = {
  overview: 'overview',
  agents: 'agents',
  devices: 'devices',
  projects: '',
  usage: '',
  preview: 'live-preview',
  terminal: 'terminal',
  skills: 'skills',
  settings: 'settings',
};
const go = async page => {
  if (page === 'projects') window.TnaiPalette.open();
  else if (page === 'usage') window.TnaiSettings.open('usage');
  else window.TnaiRoute(PAGES[page]);
  await wait(450);
  await frame();
};

// Projects opens the project switcher (39 command palette) over the current page: Escape closes it
// before the next page.
const closePalette = async () => {
  const box = document.querySelector('.tnai-pal-overlay:not([hidden]) input');
  if (box) {
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await wait(200);
  }
};
const shown = el =>
  !!el &&
  el.getClientRects().length > 0 &&
  !el.closest('[hidden]') &&
  getComputedStyle(el).visibility !== 'hidden' &&
  getComputedStyle(el).opacity !== '0';
const label = el =>
  (el.id
    ? '#' + el.id
    : el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/)[0]
        : '')) +
  (el.textContent?.trim()
    ? ' "' + el.textContent.trim().replace(/\s+/g, ' ').slice(0, 18) + '"'
    : '');
const SKIP =
  '.xterm, .tnai-keys-overlay, .tnai-pal-overlay, .pgo-od, .pg-sr, script, style, noscript, template, [aria-hidden="true"], .sr-only, .visually-hidden, #startupLoader';

// The box an element must stay inside: the nearest ancestor that clips, or draws a full border (a
// card, chip or panel).
const bordered = s =>
  ['Top', 'Right', 'Bottom', 'Left'].every(
    k =>
      parseFloat(s['border' + k + 'Width']) >= 0.5 &&
      s['border' + k + 'Style'] !== 'none' &&
      !/rgba\([^)]*,\s*0\)|transparent/.test(s['border' + k + 'Color'])
  );

function spill(el) {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible';
    if (!clips && !bordered(s)) continue;

    // inside a line that ends in "…" on purpose (its own text is checked below)
    if (clips && s.textOverflow === 'ellipsis' && a !== el) return null;
    const ar = a.getBoundingClientRect();
    if (ar.width < 4 || ar.height < 4) return null; // a closed/collapsed box
    const outX = r.left < ar.left - 2 || r.right > ar.right + 2,
      outY = r.top < ar.top - 2 || r.bottom > ar.bottom + 2;
    if (!outX && !outY) {
      if (clips) return null;
      continue;
    } // inside: keep checking outer boxes until one clips
    const canX = /auto|scroll/.test(s.overflowX) && a.scrollWidth > a.clientWidth + 1,
      canY = /auto|scroll/.test(s.overflowY) && a.scrollHeight > a.clientHeight + 1;
    if ((!outX || canX) && (!outY || canY)) return null; // reachable by scrolling
    if (
      clips &&
      (r.right <= ar.left || r.left >= ar.right || r.bottom <= ar.top || r.top >= ar.bottom)
    )
      return null; // wholly outside a clipping box: tucked away
    return (
      (clips ? 'cut by ' : 'spills out of ') +
      label(a) +
      ' by ' +
      Math.round(
        Math.max(ar.left - r.left, r.right - ar.right, ar.top - r.top, r.bottom - ar.bottom)
      ) +
      'px'
    );
  }
  if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1)
    return 'cut by the window';
  return null;
}
const hasText = el => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());

function audit(tag, root = null) {
  const problems = [],
    W = innerWidth,
    H = innerHeight,
    de = document.documentElement;
  if (root) {
    const r = root.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)
      problems.push(
        'outside the window (' + [r.left, r.top, r.right, r.bottom].map(Math.round) + ')'
      );
    if (root.scrollWidth > root.clientWidth + 1)
      problems.push('scrolls sideways (' + root.scrollWidth + ' > ' + root.clientWidth + ')');
    const hid = [0.1, 0.5, 0.9]
      .flatMap(fx =>
        [0.1, 0.5, 0.9].map(fy =>
          document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy)
        )
      )
      .filter(e => e && !root.contains(e));
    if (hid.length) problems.push('partly drawn under ' + label(hid[0]));
  } else if (de.scrollWidth > W + 1 || document.body.scrollWidth > W + 1)
    problems.push(
      'page scrolls sideways (' +
        Math.max(de.scrollWidth, document.body.scrollWidth) +
        ' > ' +
        W +
        ')'
    );
  if (!root && de.scrollHeight > H + 1)
    problems.push('page scrolls down (' + de.scrollHeight + ' > ' + H + ')');
  const els = [...(root || document.body).querySelectorAll('*')].filter(
    el =>
      (hasText(el) ||
        el.matches('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')) &&
      !el.closest(SKIP) &&
      !el.closest('svg') &&
      shown(el)
  );
  const spilled = [],
    truncated = [],
    seen = new Set();
  for (const el of els) {
    const p = spill(el);
    if (p && !seen.has(p) && !el.closest('.pgo-ptabs')) {
      /* the Overview project tabs strip clips a crowded tab on purpose (as in snap-sizes) */ seen.add(
        p
      );
      spilled.push(label(el) + ' ' + p);
    }
    const s = getComputedStyle(el),
      text = el.textContent.trim().replace(/\s+/g, ' ');
    if (
      hasText(el) &&
      el.clientWidth >= 4 &&
      s.overflowX !== 'visible' &&
      el.scrollWidth > el.clientWidth + 1 &&
      text.length <= 24 &&
      !el.closest('.pgo-ptabs, input, textarea, select')
    )
      truncated.push(label(el) + ' (' + el.clientWidth + '/' + el.scrollWidth + ')');
  }

  // Text on top of other text (two labels drawn over each other, neither inside the other): each
  // element's own text, cut to what its clipping boxes show, if it is not faded out.
  const seenRect = el => {
    let o = 1;
    for (let a = el; a && a !== document.body; a = a.parentElement)
      o *= parseFloat(getComputedStyle(a).opacity);
    if (o < 0.2) return null;
    let box = null;
    for (const n of el.childNodes)
      if (n.nodeType === 3 && n.textContent.trim()) {
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const r = rg.getBoundingClientRect();
        box = box
          ? {
              left: Math.min(box.left, r.left),
              top: Math.min(box.top, r.top),
              right: Math.max(box.right, r.right),
              bottom: Math.max(box.bottom, r.bottom),
            }
          : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
    if (!box) return null;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible' && cs.clipPath === 'none')
        continue;
      const ar = a.getBoundingClientRect();
      box = {
        left: Math.max(box.left, ar.left),
        top: Math.max(box.top, ar.top),
        right: Math.min(box.right, ar.right),
        bottom: Math.min(box.bottom, ar.bottom),
      };
    }
    return box.right - box.left > 2 && box.bottom - box.top > 2 ? box : null;
  };
  const texts = els
    .filter(el => hasText(el) && !el.closest('.pgo-tape, .pgo-ptabs, #toast'))
    .map(el => [el, seenRect(el)])
    .filter(([, r]) => r);

  // One of the two is behind a surface drawn over it (the pinned composer over a scrolled tree row,
  // a popover): not an overlap anyone sees.
  const covered = (a, b, x, y) => {
    const stack = document.elementsFromPoint(x, y),
      at = el => stack.findIndex(s => s === el || el.contains(s));
    const ia = at(a),
      ib = at(b);
    if (ia < 0 || ib < 0) return true;
    const [lo, hi] = ia < ib ? [b, ib] : [a, ia];
    return stack.slice(0, hi).some(
      s =>
        !s.contains(lo) &&
        (() => {
          const cs = getComputedStyle(s),
            m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor),
            al = m ? (m[1].split(',')[3] ?? 1) : 0;
          return +al >= 0.5 || cs.backdropFilter !== 'none' || cs.backgroundImage !== 'none';
        })()
    );
  };
  const over = [];
  for (let i = 0; i < texts.length && over.length < 3; i++)
    for (let j = i + 1; j < texts.length; j++) {
      const [a, ra] = texts[i],
        [b, rb] = texts[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ow = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left),
        oh = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (
        ow > 4 &&
        oh > 4 &&
        !covered(
          a,
          b,
          (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2,
          (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2
        )
      ) {
        over.push(
          'text ' +
            label(a) +
            ' over ' +
            label(b) +
            ' (' +
            Math.round(ow) +
            '×' +
            Math.round(oh) +
            ')'
        );
        break;
      }
    }
  problems.push(...over);
  problems.push(...spilled.slice(0, 8));
  if (spilled.length > 8) problems.push('+' + (spilled.length - 8) + ' more spilled');
  problems.push(...truncated.slice(0, 5).map(t => 'truncated ' + t));
  if (truncated.length > 5) problems.push('+' + (truncated.length - 5) + ' more truncated');
  const prompt = document.getElementById('prompt');
  if (!root && shown(prompt)) {
    const r = (prompt.closest('.composer') || prompt).getBoundingClientRect();
    if (r.bottom > H + 1)
      problems.push('composer cut at the bottom (' + Math.round(r.bottom) + ' > ' + H + ')');
  }
  check(!problems.length, tag + (problems.length ? ' — ' + problems.join('; ') : ''));
  return problems.length;
}

// Popups at the small sizes (dialogs and pickers looked squished in the website
// demo): open each, audit it like a page, close it. A hover tip (83, role=tooltip) is not a popup:
// it comes up on its own half a second after the focus returns to the last opener, lets clicks
// through (so every point of it reads as "drawn under" what is beneath) and was taken for the
// effort menu, which a terminal panel without an effort setting never opens (2026-10-06, "effort
// picker (291×30) partly drawn under aside.sidebar").
const floating = () =>
  [...document.body.querySelectorAll('*')].filter(el => {
    if (el.matches('[role=tooltip]')) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && !el.matches('[role=menu], [role=dialog], [role=listbox]'))
      return false;
    const r = el.getBoundingClientRect();
    return r.width * r.height > 3000 && shown(el);
  });
const POPUPS = {
  'model picker': ['overview', 'footer.composer .tnai-pick[data-pick=model] .tnai-pick-btn'],
  'effort picker': ['overview', 'footer.composer .tnai-pick[data-pick=effort] .tnai-pick-btn'],
  'agents page model picker': [
    'agents',
    '#agentsPage ~ * .tnai-pick[data-pick=model] .tnai-pick-btn, footer.composer .tnai-pick[data-pick=model] .tnai-pick-btn',
  ],
};

async function popups(tag) {
  for (const [name, [page, sel]] of Object.entries(POPUPS)) {
    await go(page);
    const opener = [...document.querySelectorAll(sel)].find(shown);
    if (!opener) {
      log.push('info ' + tag + ' ' + name + ': no opener shown');
      continue;
    }

    // The opener itself: whole, inside the prompt box it belongs to.
    {
      const o = opener.getBoundingClientRect(),
        c = opener.closest('.composer')?.getBoundingClientRect();
      if (c)
        check(
          o.left >= c.left - 1 &&
            o.right <= c.right + 1 &&
            o.top >= c.top - 1 &&
            o.bottom <= c.bottom + 1,
          tag +
            ' ' +
            name +
            ': its button is inside the prompt box (' +
            [o.left, o.right].map(Math.round).join(' to ') +
            ' in ' +
            [c.left, c.right].map(Math.round).join(' to ') +
            ', ' +
            Math.round(o.width) +
            '×' +
            Math.round(o.height) +
            ')'
        );
    }
    if (opener.disabled) {
      log.push(
        'info ' + tag + ' ' + name + ': its button is off for the chosen agent, nothing to open'
      );
      continue;
    }
    const before = new Set(floating());
    opener.click();
    await wait(350);
    await frame();
    const box = floating()
      .filter(el => !before.has(el) && !el.contains(opener))
      .sort(
        (a, b) =>
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height
      )[0];
    if (!box) {
      log.push('info ' + tag + ' ' + name + ': opened nothing floating (a toggle)');
      opener.click();
      await wait(150);
      continue;
    }
    audit(
      tag +
        ' ' +
        name +
        ' (' +
        Math.round(box.getBoundingClientRect().width) +
        '×' +
        Math.round(box.getBoundingClientRect().height) +
        ')',
      box
    );
    await shot('fit-' + tag + '-pop-' + name.replace(/\W+/g, '-'));
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    await wait(150);
    if (shown(box)) {
      opener.click();
      await wait(150);
    }
    if (shown(box)) {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      document.body.click();
      await wait(150);
    }
  }
}

let min0 = null;
try {
  const G = window.TnaiAgents;
  await G.detect(true);

  // four PowerShell threads, started the way a user starts one (no control of the old page)
  for (let count = G.sessions().filter(x => x.running).length; count < 4; count++)
    await window.TnaiTest.startThread({ tool: 'Terminal' });
  check(G.sessions().filter(x => x.running).length >= 4, 'setup: 4 PowerShell threads running');
  log.push('info the test window before the first size: ' + (await main('awake')));
  min0 = await main('minimum');
  await main('setMinimum', 560, 400);

  // $env:TNAI_FIT_ONLY='1024x683-z1,768x680-app' for quick reruns
  const only = (await main('only')).split(',').filter(Boolean);
  const SIZES = [
    [768, 680],
    [1024, 683],
    [1180, 760],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ];
  for (const zoom of [null, 1])
    for (const [w, h] of SIZES) {
      const tag = w + 'x' + h + '-' + (zoom ? 'z1' : 'app');
      if (only.length && !only.includes(tag)) continue;
      const got = await main('size', w, h, zoom);
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
      const sizeT0 = performance.now(),
        live = await drawing(tag, 'start');
      log.push('info ' + tag + ' drawing at the start: ' + live.text);
      if (!live.ok) continue; // nothing measured on a page that stands still would mean anything
      const nav = 'menu';
      if ((await drawing(tag, nav)).ok) {
        for (const page of Object.keys(PAGES)) {
          await go(page);
          audit(tag + ' ' + nav + ' ' + page);

          if (nav === 'menu') await shot('fit-' + tag + '-' + page);
          await closePalette();
        }
      }
      if (['768x680-z1', '1024x683-app', '1024x683-z1', '1180x760-z1'].includes(tag)) {
        await popups(tag);
      }
      log.push('info ' + tag + ' took ' + Math.round((performance.now() - sizeT0) / 1000) + ' s');
    }
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
if (min0) await main('setMinimum', ...min0).catch(() => {});
return { ok, log };
