/*
 * Technically Not tools · desktop-check/tests/system-stats.js — The top bar's System chip
 * (81-system-stats.js + desktop/system-stats.js) on this real PC: the chip says OK or High and
 * fits the top bar without overlapping or cutting anything off at every size, its bar only from
 * 1100 page px; a press opens the popover right under it with CPU and RAM rows (and GPU where
 * nvidia-smi exists), Esc closes it and the keyboard is back on the chip; minimizing stops the GPU
 * reader and restoring brings fresh numbers. Light + Dark screenshots of the open popover at
 * 2560×1440, one at 1024×768. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return (await fn()) || null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const system = window.TnaiSystemChip;
const chip = () => document.getElementById('pgSysChip');
const pop = () => document.getElementById('pgSysPop');
const row = key => system?.list.querySelector(`.pg-chip[data-m="${key}"]`);
const shown = el =>
  !!el &&
  !el.hidden &&
  getComputedStyle(el).display !== 'none' &&
  el.getBoundingClientRect().width > 0;

try {
  check(!!system && !!chip() && !!pop(), 'the System chip and its popover are in the page');
  const vis = el =>
    el &&
    el.getBoundingClientRect().width > 0 &&
    getComputedStyle(el).display !== 'none' &&
    !/absolute|fixed/.test(getComputedStyle(el).position);
  const leftEnd = () =>
    Math.max(
      ...[...document.querySelectorAll('.top-left *')]
        .filter(vis)
        .map(k => k.getBoundingClientRect().right)
    );
  const truncated = () =>
    [...document.querySelectorAll('.top-right > .pg-chip, .top-left .crumb')]
      .filter(vis)
      .some(e => e.scrollWidth > e.clientWidth + 1);
  const fits = label => {
    // The chip must clear the title, stay in the window, overlap no other top-bar item and sit on
    // the bar's center line.
    const c = chip().getBoundingClientRect(),
      bar = document.querySelector('header.top').getBoundingClientRect();
    const others = [...document.querySelectorAll('.top-right > *')]
      .filter(e => e !== chip() && vis(e))
      .map(e => e.getBoundingClientRect());
    const hit = others.some(
      o =>
        o.left < c.right - 1 && c.left < o.right - 1 && o.top < c.bottom - 1 && c.top < o.bottom - 1
    );
    check(
      c.left >= leftEnd() + 8 &&
        c.right <= innerWidth &&
        !hit &&
        !truncated() &&
        Math.abs(c.top + c.height / 2 - (bar.top + bar.height / 2)) <= 3,
      label +
        ': chip fits after the page title, overlaps nothing, nothing cut off, centered (' +
        Math.round(c.left) +
        '–' +
        Math.round(c.right) +
        ', title ends ' +
        Math.round(leftEnd()) +
        ')'
    );
  };
  await main('setSize', 2560, 1440);
  await wait(600);
  const topH = document.querySelector('header.top').getBoundingClientRect().height;
  check(
    !!(await until(() => shown(chip()) && row('cpu') && row('ram'), 8000)),
    'readings arrive: the popover has CPU and RAM rows'
  );
  const word = chip().querySelector('.v').textContent;
  check(
    (word === 'OK') === (chip().dataset.level === 'ok') && /^(OK|High)$/.test(word),
    'the chip says ' + word + ' with level ' + chip().dataset.level
  );

  // 21's rolling count: the number is drawn by CSS
  const cpuN = row('cpu').querySelector('.v')?.style.getPropertyValue('--tn-n');
  check(
    /^\d+$/.test(String(cpuN).trim()) && /[\d.]+\/[\d.]+ GB/.test(row('ram').textContent),
    'CPU % (' + cpuN + ') and RAM used/total'
  );
  const gpuReader = await main('nvidiaRunning');
  check(
    !!row('gpu') === gpuReader,
    'GPU row exactly when the NVIDIA reader runs (' + gpuReader + ')'
  );
  log.push('info tip: ' + JSON.stringify(chip()?.title));
  check(shown(chip().querySelector('.pg-meter-bar')), '2560x1440: the chip shows its bar');
  fits('2560x1440');
  check(
    Math.abs(document.querySelector('header.top').getBoundingClientRect().height - topH) < 1,
    'top bar height unchanged'
  );

  // A press opens the popover right under the chip; Esc closes it and the keyboard is back.
  chip().focus();
  chip().click();
  await wait(300);
  const c = chip().getBoundingClientRect(),
    p = pop().getBoundingClientRect();
  check(
    shown(pop()) &&
      chip().getAttribute('aria-expanded') === 'true' &&
      p.top >= c.bottom &&
      p.top - c.bottom <= 12 &&
      p.right <= innerWidth,
    'a press opens the popover right under the chip (' + Math.round(p.top - c.bottom) + ' px below)'
  );
  window.TnaiTheme?.set('light');
  await wait(400);
  await (window.TnaiTest?.shot?.('system-stats-light') ?? wait(1500));
  window.TnaiTheme?.set('dark');
  await wait(400);
  await (window.TnaiTest?.shot?.('system-stats-dark') ?? wait(1200));
  window.TnaiTheme?.set('light');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(100);
  check(
    !shown(pop()) && document.activeElement === chip(),
    'Esc closes the popover and the keyboard is back on the chip'
  );

  // The chip stays at every size; its bar shows from 1100 page px.
  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1024, 768],
  ]) {
    await main('setSize', w, h);
    await wait(600);
    const bar = innerWidth >= 1100;
    check(
      shown(chip()) && shown(chip().querySelector('.pg-meter-bar')) === bar,
      w +
        'x' +
        h +
        ' (' +
        innerWidth +
        ' page px): chip shown, ' +
        (bar ? 'with' : 'without') +
        ' its bar'
    );
    fits(w + 'x' + h);
  }
  await (window.TnaiTest?.shot?.('system-stats-1024') ?? wait(1200));
  await main('setSize', 1920, 1080);
  await wait(400);

  // Minimized: the sampler and the GPU reader stop; restored: fresh numbers again.
  await main('minimize');
  await wait(1500);
  check(!(await main('nvidiaRunning')), 'minimized: no nvidia-smi process');
  const before = row('ram')?.title + row('cpu')?.title;
  await main('restore');
  check(
    !!(await until(() => row('ram') && row('ram').title + row('cpu')?.title !== before, 9000)),
    'restored: numbers update again'
  );
  if (gpuReader)
    check(!!(await until(() => main('nvidiaRunning'), 6000)), 'restored: GPU reader running again');
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
