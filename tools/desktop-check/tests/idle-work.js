// Technically Not tools · desktop-check/tests/idle-work.js — How much script work the window does
// for pages that are not on screen. Six real PowerShell threads print a line every 200 ms while
// idle-work.main.js pushes an ordinary amount of agent activity (tool events on real files, turns,
// file writes). The window is profiled for 6 s in four states: the Threads page shown, the All
// threads page shown, the Settings page shown, and minimized. Each state prints the busy time, the
// frames drawn, whether the page sees itself as hidden, and the time spent inside the scripts that
// paint the thread list and the file rail (inclusive: every sample with that file anywhere in its
// stack). Moved 2026-10-12 from the old Overview: its segment thumbs and token bars went with that
// page, and the Agents count of the old navigation became the count of rows in the thread list.
// This test minimizes, restores and focuses its window and opens a pop-out: it takes the keyboard,
// so it is run only when the user is not at the PC. No agent CLI, no prompt. Returns {ok, log}.
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
    await wait(50);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'iw' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 20000);
  });
const G = window.TnaiAgents;
const go = async view => {
  // 'threads' is the start page; every other page opens the way the three-dots menu opens it.
  // The route 'terminal' is the All threads page.
  if (view === 'threads') window.TnaiThreads.open();
  else if (view === 'terminal') await window.TnaiTest.openAllThreads();
  else window.TnaiRoute(view);
  await wait(600);
};
const WATCH = [
  '11-agents-live.js',
  '119-thread-list.js',
  '13-agent-file-activity.js',
  '12-inactive-ui.js',
  '10-live-terminals.js',
];
const MS = 6000,
  N = 6;

// One state: profile for MS, count frames and timer ticks, and read what the page thinks of itself.
const measure = async name => {
  let frames = 0,
    ticks = 0,
    on = true;
  const count = () => {
    if (!on) return;
    frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  const timer = setInterval(() => ticks++, 50);
  await main('profileStart');
  await wait(MS);
  const p = await main('profileStop');
  on = false;
  clearInterval(timer);
  const r = {
    name,
    busy: p.busy,
    total: p.total,
    frames,
    ticks,
    hidden: document.hidden,
    incl: Object.fromEntries(WATCH.map(f => [f, Math.round(p.incl[f] || 0)])),
  };
  const top = Object.entries(p.incl)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([f, ms]) => f + ' ' + Math.round(ms))
    .join(', ');
  log.push(
    'info ' +
      name +
      ': busy ' +
      r.busy +
      ' ms of ' +
      r.total +
      ' · frames ' +
      frames +
      ' · 50 ms ticks ' +
      ticks +
      ' · document.hidden ' +
      r.hidden +
      ' · ' +
      WATCH.map(f => f.split('-')[0] + ' ' + r.incl[f] + ' ms').join(' · ')
  );
  log.push('info ' + name + ' top files (inclusive ms): ' + top);
  log.push(
    'info ' +
      name +
      ' top self ms: ' +
      Object.entries(p.self)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([f, ms]) => f + ' ' + Math.round(ms))
        .join(', ')
  );
  if (name === 'Threads shown')
    log.push(
      'info ' + name + ' by function, own ms: ' + p.fnSelf.join(' | '),
      'info ' + name + ' by function, with what it calls: ' + p.fnIncl.join(' | ')
    );
  return r;
};

try {
  const ids = [];
  for (let count = 0; count < N; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made.ok) ids.push(made.paneId);
  }
  check(ids.length === N, N + ' PowerShell threads running');
  await wait(1500);
  ids.forEach(id =>
    G.send(
      id,
      '$i=0; while($true){ $i++; Write-Output "IW line $i src/gen-1.js"; Start-Sleep -Milliseconds 200 }'
    )
  );
  await main('start', ids);
  await wait(2500);
  log.push(
    'info window: backgroundThrottling ' +
      (await main('throttling')) +
      ' · focused ' +
      document.hasFocus()
  );

  await go('threads');
  const threads = await measure('Threads shown');

  console.log('TNAI_SHOT:idle-work-threads');
  await wait(600);

  // The real cost while agents work: no profiler and no frame counter (both add work of their own),
  // the app's own CPU per process kind over 8 s, as shipped and with every animation and transition
  // paused (a style this test adds and removes; the gap is what motion costs).
  const pause = document.createElement('style');
  document.head.append(pause);
  const usage = async (name, paused) => {
    pause.textContent = paused
      ? '*,*::before,*::after{animation-play-state:paused!important;transition:none!important}'
      : '';
    await wait(1500);
    const anim = document.getAnimations().filter(a => a.playState === 'running').length;
    await main('cpu');
    await wait(8000);
    const c = await main('cpu');
    log.push(
      'info cost ' +
        (name + (paused ? ' · motion paused' : ' · as shipped')).padEnd(34) +
        ' graphics ' +
        (c.graphics ?? 0) +
        '% · window ' +
        (c.window ?? 0) +
        '% · main ' +
        (c.main ?? 0) +
        '% · ' +
        anim +
        ' animations running'
    );
    pause.textContent = '';
  };
  await usage('Threads', false);
  await usage('Threads', true);
  await go('terminal');
  await usage('All threads', false);
  await usage('All threads', true);
  pause.remove();
  await go('terminal');
  const terminal = await measure('All threads shown');
  await go('settings');
  const settings = await measure('Settings shown');
  await go('terminal');
  await main('minimize');
  check(!!(await until(() => main('isMinimized'), 3000)), 'window minimized');
  await wait(3000); // the resize that comes with minimizing has settled
  const minimized = await measure('minimized (Terminal page)');
  const r0 = performance.now();
  await main('restore');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  log.push(
    'info restore: first frame after ' +
      Math.round(performance.now() - r0) +
      ' ms · document.hidden ' +
      document.hidden
  );
  await wait(800);

  // The thread list is on every page: after the restore it has a row for every panel that runs.
  const rows = document.querySelectorAll('.tnt-th:not(.tnt-sub)').length;
  check(
    rows === G.sessions().length,
    'the thread list is current after the restore (' +
      rows +
      ' rows, ' +
      G.sessions().length +
      ' sessions)'
  );
  check(threads.frames > 30, 'Threads shown draws frames (' + threads.frames + ')');
  check(
    minimized.ticks >= 100,
    'timers keep running while minimized (' + minimized.ticks + '/120)'
  );
  check(
    minimized.hidden === true && minimized.frames <= 2,
    'a minimized window counts as hidden to its page and draws nothing (frames ' +
      minimized.frames +
      ')'
  );
  check(settings.hidden === false, 'a window on screen counts as visible');

  // A pop-out is filled by the main page: with one open, the minimized main window must still count
  // as visible.
  const pop = window.TnaiComposerPopout;
  check(
    !!pop?.popOut && pop.popOut() && !!(await until(() => pop.isOut() && pop.window(), 5000)),
    'composer popped out'
  );
  await wait(500);
  check((await main('throttling')) === false, 'with a pop-out open backgroundThrottling is off');
  await main('minimize');
  await until(() => main('isMinimized'), 3000);
  await wait(1500);
  check(
    document.hidden === false,
    'main window minimized with a pop-out open: its page still counts as visible'
  );
  await main('restore');
  await wait(500);
  pop.window()?.close();
  await until(() => !pop.isOut(), 4000);
  await wait(500);
  check((await main('throttling')) === true, 'pop-out closed: backgroundThrottling is on again');

  await main('stop');
  ids.forEach(id => G.stop(id));
  await wait(500);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
  try {
    await main('stop');
  } catch {}
}
return { ok, log };
