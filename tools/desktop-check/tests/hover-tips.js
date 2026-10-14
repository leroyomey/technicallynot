/*
 * Technically Not tools · desktop-check/tests/hover-tips.js — Calm tooltips (83-hover-tips.js): a
 * tip shows only after the pointer rests, never while it sweeps across controls, hides on a click
 * (and stays quiet), on Escape and when leaving, the next tip right after one is quicker, touch
 * shows nothing, and the parked title comes back. Screenshot: desktop-hover-tip.png. Returns {ok,
 * log}. The pointer is the test's own (2026-10-05): pointer events are dispatched at the element
 * the page's hit test finds at each point, and the user's real mouse is kept away from the page for
 * the length of the test. Until then the moves went through the window's input queue, where the
 * user's own mouse over the test window, a click in another app (window blur) or a late timer on a
 * busy PC failed a different check each run. Every wait is measured: a late timer, a lost focus, a
 * resize or a real key press during a step is named and the step is tried again. Not proved here:
 * that the OS delivers a real mouse move to the page.
 */
const log = [],
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  LATE_MS = 120;
let ok = true,
  blocked = 0,
  blockedFirst = '';
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const noise = []; // what disturbed the step being run
const wait = async ms => {
  const t = performance.now();
  await sleep(ms);
  const late = performance.now() - t - ms;
  if (late > LATE_MS) noise.push('a timer ' + Math.round(late) + ' ms late');
};
const until = async (fn, ms) => {
  const t = performance.now();
  while (!fn() && performance.now() - t < ms) await wait(15);
};
const tipEl = () => document.getElementById('tnaiHoverTip');
const on = () => !!tipEl()?.classList.contains('is-on');
const center = el => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
const name = el => (el ? el.tagName + '.' + el.className : 'none');

// The test's pointer: events at the element under the point, in the order the browser sends them
// (out, over, move).
let at = null;
const pe = (type, el, x, y, more) =>
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      ...more,
    })
  );
const move = (x, y) => {
  const el = document.elementFromPoint(x, y) || document.body;
  if (el !== at) {
    if (at?.isConnected) pe('pointerout', at, x, y, { relatedTarget: el });
    pe('pointerover', el, x, y, { relatedTarget: at });
    at = el;
  }
  pe('pointermove', el, x, y);
};

// The user's real mouse over the test window would move the tip's owner: its events stop at the
// window, before the app's document listeners.
const SHIELDED = ['pointerover', 'pointerout', 'pointermove', 'pointerdown', 'wheel'];
const shield = e => {
  if (!e.isTrusted) return;
  e.stopImmediatePropagation();
  blocked++;
  blockedFirst ||= e.type + ' at ' + Math.round(e.clientX) + ',' + Math.round(e.clientY);
};
const onBlur = () => noise.push('the window lost focus'),
  onResize = () => noise.push('the window was resized');
const onHidden = () => {
  if (document.hidden) noise.push('the page was hidden');
};
const onScroll = e => {
  if (window.TnaiHoverTips?.owner && e.target.contains?.(window.TnaiHoverTips.owner))
    noise.push('a scroll under the control');
};
const onKey = e => {
  if (e.isTrusted) noise.push('a real key press');
};

// A step returns its checks as [condition, label]. A failed step that was disturbed from outside is
// run again, at most three times in all.
const step = async (title, fn) => {
  let res = [];
  for (let i = 1; i <= 3; i++) {
    noise.length = 0;
    if (document.hidden) noise.push('the page is hidden');
    res = await fn();
    if (res.every(r => r[0]) || !noise.length) break;
    log.push(
      'info ' +
        title +
        ': disturbed by ' +
        [...new Set(noise)].join(', ') +
        (i < 3 ? ', trying again' : ', three times')
    );
  }
  for (const [cond, label] of res) check(cond, label);
};
try {
  const H = window.TnaiHoverTips;
  check(!!H && H.REST_MS >= 700, 'hover tips loaded, rest delay ' + H?.REST_MS + ' ms');
  window.TnaiThreads.open();
  await sleep(600);

  // Small, visible, hit-testable controls with a title, not disabled.
  const cands = [...document.querySelectorAll('[title]')].filter(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || r.height > 60 || r.width > 300) return false;
    if (
      r.top < 0 ||
      r.left < 0 ||
      r.bottom > innerHeight ||
      r.right > innerWidth ||
      !el.title.trim()
    )
      return false;
    const [x, y] = center(el);
    return document.elementFromPoint(x, y)?.closest('[title]') === el;
  });

  // Live controls rewrite their title every second (purple top bar chips, tokens/min): keep
  // controls whose title holds still.
  for (const el of [...cands])
    if (el.closest('.tnai-sys-chip, #pgTokChip, .pg-chip')) cands.splice(cands.indexOf(el), 1);
  const snap = new Map(cands.map(el => [el, el.title]));
  await sleep(1300);
  for (const el of [...cands])
    if (el.title !== snap.get(el) || !el.isConnected) cands.splice(cands.indexOf(el), 1);
  check(
    cands.length >= 3,
    'found titled controls to hover: ' +
      cands.length +
      ' (first: ' +
      (cands[0]?.className || cands[0]?.tagName) +
      ')'
  );
  const [a, b] = cands,
    far =
      cands.find(el => {
        const [x1, y1] = center(el),
          [x2, y2] = center(a);
        return Math.hypot(x1 - x2, y1 - y2) > 150;
      }) || cands[2];
  const titleA = a.title,
    REST = H.REST_MS;

  // A spot with no titled control under it (bottom-left is the nav's « button in the purple
  // redesign).
  const quiet = (() => {
    for (let y = innerHeight - 4; y > 40; y -= 37)
      for (let x = 4; x < innerWidth; x += 53) {
        const el = document.elementFromPoint(x, y);
        if (el && !el.closest('[title]') && !a.contains(el)) return [x, y];
      }
    return [4, innerHeight - 4];
  })();

  // Off every control, and long enough that the next tip is not a quick one (700 ms after a tip the
  // wait is short).
  const calm = async () => {
    move(...quiet);
    await wait(800);
  };

  for (const t of SHIELDED) window.addEventListener(t, shield, true);
  window.addEventListener('blur', onBlur);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onHidden);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('keydown', onKey, true);

  // Rest on A: parked at once, nothing early, shown after the rest delay and not before it. Then
  // Escape hides it and keeps it quiet, and leaving puts the title back.
  await step('rest', async () => {
    const r = [];
    await calm();
    const t0 = performance.now();
    move(...center(a));
    r.push([
      !a.hasAttribute('title') && H.owner === a,
      'title parked while hovering (no native tip; owner ' + name(H.owner) + ')',
    ]);
    await wait(450);
    r.push([!on(), 'no tip after 450 ms of rest']);
    await until(on, REST + 3000);
    const ms = Math.round(performance.now() - t0);
    r.push([
      on() && ms >= REST - 20 && ms <= REST + 400,
      'tip shown after resting ' +
        ms +
        ' ms, wanted ' +
        (REST - 20) +
        ' to ' +
        (REST + 400) +
        ' (' +
        name(a) +
        ' connected=' +
        a.isConnected +
        ' owner=' +
        (H.owner === a) +
        ' hidden=' +
        document.hidden +
        ')',
    ]);
    r.push([
      tipEl()?.textContent === titleA,
      'tip text is the title: ' + JSON.stringify((tipEl()?.textContent || '').slice(0, 60)),
    ]);
    await wait(120);
    const tr = tipEl()?.getBoundingClientRect();
    r.push([
      !!tr && tr.left >= 0 && tr.top >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight,
      'tip inside the window',
    ]);
    r.push([
      (a.getAttribute('aria-describedby') || '').includes('tnaiHoverTip'),
      'control described by the tip while shown',
    ]);
    console.log('TNAI_SHOT:hover-tip');
    await wait(450);
    const before = on();
    document.activeElement?.blur?.();
    (document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    r.push([before && !on(), 'Escape hides the tip (shown before it: ' + before + ')']);
    await wait(1200);
    r.push([!on(), 'stays hidden after Escape while resting']);
    move(...quiet);
    r.push([
      a.title === titleA && H.owner !== a,
      'title restored after leaving (to ' + quiet.join(',') + ')',
    ]);
    return r;
  });

  // Warm: right after a tip, the next one is quick.
  await step('warm', async () => {
    await calm();
    move(...center(a));
    await until(on, REST + 3000);
    const warmOn = on();
    const t0 = performance.now();
    move(...center(b));
    await until(() => on() && H.owner === b, 3000);
    const ms = Math.round(performance.now() - t0);
    return [
      [
        warmOn && on() && H.owner === b && ms <= 450,
        'next tip within 450 ms right after one was shown: ' +
          ms +
          ' ms, first shown ' +
          warmOn +
          ' (' +
          [a, b].map(name).join(' → ') +
          ')',
      ],
    ];
  });

  // Sweeping across controls (moving every 120 ms for 2.4 s) never shows a tip.
  await step('sweep', async () => {
    await calm();
    let seen = false;
    const pts = [center(a), center(b), center(far)];
    for (let i = 0; i < 20; i++) {
      const [x1, y1] = pts[i % 3],
        [x2, y2] = pts[(i + 1) % 3],
        t = (i % 4) / 4;
      move(x1 + (x2 - x1) * t + (i % 2) * 6, y1 + (y2 - y1) * t);
      await wait(120);
      seen ||= on();
    }
    return [[!seen, 'no tip while the pointer keeps moving']];
  });

  // Small jitter (≤4 px) does not restart the wait: the tip comes from the first rest, not 800 ms
  // after the last small move.
  await step('jitter', async () => {
    await calm();
    const [ax, ay] = center(a),
      t0 = performance.now();
    move(ax, ay);
    await wait(400);
    move(ax + 2, ay + 1);
    await wait(250);
    move(ax + 1, ay + 2);
    await until(on, 3000);
    const ms = Math.round(performance.now() - t0);
    return [
      [
        on() && ms <= REST + 250,
        'hand jitter of 2 px does not delay the tip: shown after ' +
          ms +
          ' ms, at most ' +
          (REST + 250),
      ],
    ];
  });

  // A press hides it.
  const clickEl =
    cands.find(
      el =>
        el.tagName === 'BUTTON' &&
        !/close|remove|delete|×/i.test(el.title + el.textContent) &&
        !el.closest('.top-right')
    ) || null;
  if (clickEl)
    await step('press', async () => {
      await calm();
      const [cx, cy] = center(clickEl);
      move(cx, cy);
      await until(on, REST + 3000);
      const was = on();

      // The press itself hides; no click follows a dispatched press, so the button does nothing.
      const hit = document.elementFromPoint(cx, cy) || clickEl;
      pe('pointerdown', hit, cx, cy, { button: 0, buttons: 1 });
      const hidden = !on();
      pe('pointerup', hit, cx, cy, { button: 0 });
      return [
        [
          was && hidden,
          'a press hides the tip (shown before it: ' + was + ', ' + name(clickEl) + ')',
        ],
      ];
    });
  else log.push('skip press check: no safe button');
  move(...quiet);

  // A titled part inside a titled row (an Overview list row and its "Doing now" text): while the
  // part's tip is ours, the row's title is off too, or the browser shows it as a second, white
  // tooltip; both come back when the pointer leaves.
  await step('titled part in a titled row', async () => {
    const r = [],
      rowEl = document.createElement('div'),
      partEl = document.createElement('span');
    rowEl.title = 'row tip';
    partEl.title = 'part tip';
    partEl.textContent = 'part';
    rowEl.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999';
    rowEl.append(partEl);
    document.body.append(rowEl);
    const [px, py] = center(partEl);
    partEl.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        clientX: px,
        clientY: py,
      })
    );
    r.push([
      H.owner === partEl && !partEl.hasAttribute('title') && !rowEl.hasAttribute('title'),
      'pointer on a titled part of a titled row: neither keeps a title for the browser to show (row has title: ' +
        rowEl.hasAttribute('title') +
        ')',
    ]);
    rowEl.title = 'row tip, set again by its own script';
    await wait(50);
    r.push([!rowEl.hasAttribute('title'), 'a title the row gets meanwhile is taken off again']);
    partEl.dispatchEvent(
      new PointerEvent('pointerout', {
        bubbles: true,
        pointerType: 'mouse',
        relatedTarget: document.body,
      })
    );
    r.push([
      H.owner !== partEl &&
        partEl.title === 'part tip' &&
        rowEl.title === 'row tip, set again by its own script',
      'both titles are back once the pointer leaves: ' +
        JSON.stringify([partEl.title, rowEl.title]),
    ]);
    rowEl.remove();
    return r;
  });

  // Touch never shows a tip.
  await step('touch', async () => {
    const [bx, by] = center(b);
    b.dispatchEvent(
      new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'touch',
        clientX: bx,
        clientY: by,
      })
    );
    await wait(1300);
    return [[!on() && H.owner !== b && !!b.title, 'touch shows no tip and leaves the title alone']];
  });
  log.push(
    'info real pointer events kept away from the page during the test: ' +
      blocked +
      (blocked ? ' (first: ' + blockedFirst + ')' : '')
  );
} catch (e) {
  log.push('ERROR ' + e.message);
  ok = false;
}
for (const t of SHIELDED) window.removeEventListener(t, shield, true);
window.removeEventListener('blur', onBlur);
window.removeEventListener('resize', onResize);
document.removeEventListener('visibilitychange', onHidden);
document.removeEventListener('scroll', onScroll, true);
window.removeEventListener('keydown', onKey, true);
return { ok, log };
