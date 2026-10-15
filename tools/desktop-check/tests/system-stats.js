/*
 * Technically Not tools · desktop-check/tests/system-stats.js — The top bar PC stats chip
 * (81-system-stats.js + desktop/system-stats.js) on this real PC: CPU and memory (and GPU where
 * nvidia-smi exists) appear, fit the top bar without overlapping or cutting anything off;
 * sparklines from 1600 px wide, numbers only at 1440×900, hidden at 1024×768 (purple breakpoints);
 * minimizing stops the GPU reader and restoring brings fresh numbers. Light + Dark screenshots at
 * 2560×1440, one at 1600×900. Returns {ok, log}.
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
const chip = () => document.querySelector('.top-right .tnai-sys-chip');
const shown = el =>
  !!el &&
  !el.hidden &&
  getComputedStyle(el).display !== 'none' &&
  el.getBoundingClientRect().width > 0;

try {
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
    [...document.querySelectorAll('.top-right > .status, .top-left .crumb')]
      .filter(vis)
      .some(e => e.scrollWidth > e.clientWidth + 1);
  const fits = label => {
    // Purple top bar: the ⌘ K button is hidden (Ctrl+K still works); the chip must clear the title,
    // stay in the window, overlap no other top-bar item and sit on the bar's center line.
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
    !!(await until(() => shown(chip()) && /CPU/.test(chip().textContent), 8000)),
    'chip shows CPU: ' + JSON.stringify(chip()?.textContent)
  );
  const text = chip()?.textContent || '';

  // 21's rolling count: the number is drawn by CSS
  const cpuN = chip().querySelector('.pg-chip[data-m="cpu"] .v')?.style.getPropertyValue('--tn-n');
  check(
    /^\d+$/.test(String(cpuN).trim()) && /RAM\s*[\d.]+\/[\d.]+ GB/.test(text),
    'CPU % (' + cpuN + ') and RAM used/total'
  );
  const gpuReader = await main('nvidiaRunning');
  check(
    !!chip().querySelector('.pg-chip[data-m="gpu"]') === gpuReader,
    'GPU shown exactly when the NVIDIA reader runs (' + gpuReader + ')'
  );
  log.push('info tooltip: ' + JSON.stringify(chip()?.title));
  check([...chip().querySelectorAll('.pg-chip svg')].every(shown), '2560x1440: sparklines shown');
  fits('2560x1440');
  check(
    Math.abs(document.querySelector('header.top').getBoundingClientRect().height - topH) < 1,
    'top bar height unchanged'
  );
  window.TnaiTheme?.set('light');
  await wait(400);
  await (window.TnaiTest?.shot?.('system-stats-light') ?? wait(1500));
  window.TnaiTheme?.set('dark');
  await wait(400);
  await (window.TnaiTest?.shot?.('system-stats-dark') ?? wait(1200));
  window.TnaiTheme?.set('light');

  // Purple breakpoints (07 / 81): sparklines from 1600 px, numbers only from 1340, hidden below.
  for (const [w, h, sparks] of [
    [1920, 1080, true],
    [1600, 900, true],
    [1440, 900, false],
  ]) {
    await main('setSize', w, h);
    await wait(600);
    check(
      shown(chip()) && [...chip().querySelectorAll('.pg-chip svg')].some(shown) === sparks,
      w + 'x' + h + ': ' + (sparks ? 'sparklines' : 'numbers only')
    );
    fits(w + 'x' + h);
  }
  await (window.TnaiTest?.shot?.('system-stats-1440') ?? wait(1200));
  await main('setSize', 1024, 768);
  await wait(600);
  check(!shown(chip()), '1024x768: chip hidden (no room)');
  await main('setSize', 1920, 1080);
  await wait(400);

  // Minimized: the sampler and the GPU reader stop; restored: fresh numbers again.
  await main('minimize');
  await wait(1500);
  check(!(await main('nvidiaRunning')), 'minimized: no nvidia-smi process');
  const before = chip().title;
  await main('restore');
  check(
    !!(await until(() => shown(chip()) && chip().title !== before, 9000)),
    'restored: numbers update again'
  );
  if (gpuReader)
    check(!!(await until(() => main('nvidiaRunning'), 6000)), 'restored: GPU reader running again');
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
