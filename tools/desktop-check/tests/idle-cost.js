/*
 * Technically Not tools · desktop-check/tests/idle-cost.js — What the app costs while nothing
 * happens (the installed app's graphics process averaged about half a core over
 * 11.5 hours). A measurement, not a pass/fail gate: on Overview and on the Terminal page, with no
 * agent working, it reads the app's own CPU use (percent of one core, per process kind) over
 * SECONDS seconds, four ways: as shipped; with every animation and transition paused; with the
 * glass blur off; with both. The difference tells which of the two keeps the graphics process busy.
 * It changes nothing in the app (the two switches are a style element this test adds and removes).
 * Limits: the test profile has one idle shell and no working agents, so status motion that only
 * runs for working agents is not in it; a test window behind other windows may be drawn less often
 * by Chromium, so the log says whether the window was shown and in front. No load is put on the PC:
 * it only waits and reads counters. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
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
const SECONDS = 12;
const style = document.createElement('style');
const CASES = {
  'as shipped': '',
  'motion paused':
    '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}',
  'blur off':
    '*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  'motion paused and blur off':
    '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
};
const running = () => document.getAnimations().filter(a => a.playState === 'running').length;
const blurred = () => {
  let n = 0;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (el.offsetParent !== null && cs.backdropFilter && cs.backdropFilter !== 'none') n++;
  }
  return n;
};
try {
  document.head.append(style);
  const st = await main('state');
  log.push(
    '     window: visible ' +
      st.visible +
      ', in front ' +
      st.focused +
      ', minimized ' +
      st.minimized +
      ', document hidden ' +
      document.hidden +
      ', ' +
      innerWidth +
      '×' +
      innerHeight
  );
  const results = {};
  for (const [page, sel] of Object.entries({
    overview: 'overview',
    terminal: 'terminal',
  })) {
    // the route the three-dots menu's rows call ('overview' is the Threads page)
    window.TnaiRoute(sel);
    await wait(2500);
    for (const [name, css] of Object.entries(CASES)) {
      style.textContent = css;
      await wait(1500);
      const anim = running(),
        blur = blurred();
      await main('cpu');
      await wait(SECONDS * 1000);
      const c = await main('cpu');
      results[page + ' · ' + name] = c;
      log.push(
        '     ' +
          (page + ' · ' + name).padEnd(40) +
          ' graphics ' +
          String(c.graphics ?? 0).padStart(5) +
          '%   window ' +
          String(c.window ?? 0).padStart(5) +
          '%   main ' +
          String(c.main ?? 0).padStart(5) +
          '%   (' +
          anim +
          ' animations running, ' +
          blur +
          ' blurred boxes on screen)'
      );
    }
    style.textContent = '';
  }
  check(
    Object.keys(results).length === 8 &&
      Object.values(results).every(
        c => typeof c.graphics === 'number' || typeof c.window === 'number'
      ),
    'idle cost measured on Overview and Terminal, four ways each, ' + SECONDS + ' s each'
  );
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
style.remove();
return { ok, log };
