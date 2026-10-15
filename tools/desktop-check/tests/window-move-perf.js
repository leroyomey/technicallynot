// Technically Not tools · desktop-check/tests/window-move-perf.js — How long the window stays
// unresponsive when it is maximized, restored, minimized and moved (lag when the app is moved
// between monitors). With four PowerShell threads open it runs the same sequence on All threads,
// on Threads with a thread on its CLI screen and on Skills, and reports, per page: the longest gap
// between two frames, the time spent in long tasks, and how many resize events the page handled.
// One monitor only: a change of screen scale between monitors is not reproduced here. Returns {ok,
// log}.
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
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

async function measure(label, Z) {
  let maxGap = 0,
    last = performance.now(),
    on = true,
    long = 0,
    resizes = 0,
    frames = 0;
  const tick = now => {
    if (!on) return;
    const g = now - last;
    if (g > maxGap) maxGap = g;
    last = now;
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const po = new PerformanceObserver(l =>
    l.getEntries().forEach(e => {
      long += e.duration;
    })
  );
  try {
    po.observe({ entryTypes: ['longtask'] });
  } catch {}
  const onResize = () => resizes++;
  addEventListener('resize', onResize);
  const t0 = performance.now();
  for (let i = 0; i < 3; i++) {
    await main('maximize');
    await wait(500);
    await main('unmaximize');
    await wait(500);
    await main('setBounds', 80 + i * 60, 60, Z ? 1280 : 1560, Z ? 800 : 940);
    await wait(350);
    await main('setBounds', 40, 40, 1700, 1000);
    await wait(350);
  }

  // Minimized frames do not paint: the gap is reset around it so only the work after restore
  // counts.
  await main('minimize');
  await wait(400);
  last = performance.now();
  await main('restore');
  await wait(600);
  await main('maximize');
  await wait(600);
  await main('unmaximize');
  await wait(600);
  on = false;
  po.disconnect();
  removeEventListener('resize', onResize);
  const r = {
    maxGap: Math.round(maxGap),
    long: Math.round(long),
    resizes,
    frames,
    ms: Math.round(performance.now() - t0),
  };
  log.push(
    'info ' +
      label +
      ': longest frame gap ' +
      r.maxGap +
      ' ms · long tasks ' +
      r.long +
      ' ms in total · ' +
      r.resizes +
      ' resize events · ' +
      r.frames +
      ' frames in ' +
      r.ms +
      ' ms'
  );
  return r;
}

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  const G = window.TnaiAgents;
  const T = { fit: 0, fits: 0, resize: 0, resizes: 0, dpr: 0 };
  const F = window.FitAddon.FitAddon.prototype,
    of = F.fit;
  F.fit = function () {
    const s = performance.now();
    try {
      return of.apply(this, arguments);
    } finally {
      T.fit += performance.now() - s;
      T.fits++;
    }
  };
  const P = window.Terminal.prototype,
    or = P.resize;
  P.resize = function () {
    const s = performance.now();
    try {
      return or.apply(this, arguments);
    } finally {
      T.resize += performance.now() - s;
      T.resizes++;
    }
  };
  let lastDpr = devicePixelRatio;
  setInterval(() => {
    if (devicePixelRatio !== lastDpr) {
      lastDpr = devicePixelRatio;
      T.dpr++;
    }
  }, 16);
  const started = [];
  for (let i = 0; i < 4; i++) started.push((await openThread('Terminal')).paneId);
  await wait(2500);

  // the All threads page, with the four threads side by side
  check(await window.TnaiTest.openAllThreads(), 'the All threads page is open');
  await wait(1000);
  const same = await measure('All threads, 4 threads, sizes that keep the same zoom', false);
  const term = await measure('All threads, 4 threads, sizes that change the zoom', true);

  // the Threads page with a thread open on its CLI screen: a terminal that has to follow
  window.TnaiThreads.show(started[0]);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await wait(1000);
  check(
    !!window.TnaiThreadView.term()?.element?.getClientRects().length,
    'a thread is open on its CLI screen'
  );
  log.push(
    'info fit() ' +
      T.fits +
      ' calls, ' +
      Math.round(T.fit) +
      ' ms · term.resize ' +
      T.resizes +
      ' calls, ' +
      Math.round(T.resize) +
      ' ms · zoom changed ' +
      T.dpr +
      ' times'
  );
  const over = await measure('Threads, a thread on its CLI screen', true);
  window.TnaiRoute('skills');
  await wait(1000);
  const skills = await measure('Skills', true);
  check(
    term.maxGap < 250 && over.maxGap < 250 && skills.maxGap < 250,
    'no single freeze of a quarter second or more (' +
      [term.maxGap, over.maxGap, skills.maxGap].join(' / ') +
      ' ms)'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
