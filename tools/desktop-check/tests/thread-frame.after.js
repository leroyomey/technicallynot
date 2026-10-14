// Technically Not tools · desktop-check/tests/thread-frame.after.js — after thread-frame.js saved
// the old switch's "off" (`tnai.thread-layout.v1` = '0', what a settings folder from before
// 2026-10-11 can still hold) and the window was reloaded: it is ignored. The app must start on the
// Threads page with its islands filled, in the new look, with nothing of the old navigation on
// screen. Picture: thread-frame-start. Returns {ok, log}.
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
const layout = document.querySelector('.layout'),
  html = document.documentElement,
  threads = window.TnaiThreads;
const shown = el => !!el && el.getClientRects().length > 0;
const modes = () => [...layout.classList].filter(c => /-mode$/.test(c)).join(' ');

try {
  check(
    localStorage.getItem('tnai.thread-layout.v1') === '0' && threads.enabled() === true,
    'the old "off" is still saved, and the thread layout is on all the same'
  );
  check(!!(await until(() => threads.visible(), 8000)), 'the Threads page is the start page');
  await wait(800);
  check(
    modes() === 'threads-mode' && html.classList.contains('tnt-open'),
    'and stays the page once everything has loaded (' + modes() + ')'
  );
  check(
    html.classList.contains('tnt-on') &&
      getComputedStyle(html).getPropertyValue('--pg-bg').trim() === '#0e0e13',
    'in the new look (ground ' + getComputedStyle(html).getPropertyValue('--pg-bg').trim() + ')'
  );
  check(
    shown(threads.slot('list')?.querySelector('.tnt-lst')) &&
      shown(threads.slot('main')?.querySelector('.tnt-view')),
    'the list and the thread island are filled'
  );
  check(shown(document.getElementById('prompt')), 'the prompt box is on screen');
  check(
    ![...document.querySelectorAll('.sidebar .side-item')].some(shown) &&
      !document.querySelector('.tnt-setting'),
    'no item of the old navigation shows, and Settings has no switch for the layout'
  );
  console.log('TNAI_SHOT:thread-frame-start');
  await wait(600);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
