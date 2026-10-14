/*
 * * Technically Not tools · desktop-check/tests/minimize-restore.js — Restoring a minimized window
 * is
 * * instant: a real PowerShell thread prints steadily while Technically Not's window is minimized
 * for 5
 * * s (minimize-restore.main.js). While minimized, the page counts as hidden (its repaints rest;
 * * since 2026-10-04), timers keep running at full rate and the thread's CLI screen keeps up with
 * the pty.
 * * On restore: the first frame, the longest main-thread task and any window.tnaiStalls entries
 * from
 * * the restore (no catch-up burst), and the screen shows the newest line at once. No agent CLI, no
 * * prompt.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const windows = /Windows/.test(navigator.userAgent);
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
    const id = 'mr' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 20000);
  });
const G = window.TnaiAgents;
const nav = view => (view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view));
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// The newest "MR line N" on the CLI screen that stands in `root`, read from the terminal itself.
const newestIn = root => {
  const t = window.TnaiThreadView.term();
  if (!t || !t.element?.isConnected || !root?.contains(t.element)) return -1;
  const b = t.buffer.active;
  let n = -1;
  for (let y = Math.max(0, b.length - 200); y < b.length; y++) {
    const m = /MR line (\d+)/.exec(b.getLine(y)?.translateToString(true) || '');
    if (m) n = Math.max(n, +m[1]);
  }
  return n;
};
let ptyNewest = 0;
window.tnaiNative.pty.onData(({ data }) => {
  for (const x of String(data).matchAll(/MR line (\d+)/g)) ptyNewest = Math.max(ptyNewest, +x[1]);
});

try {
  check(
    (await main('throttling')) === true,
    'main window has backgroundThrottling on while no pop-out is open'
  );
  const started = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  const id = started.paneId;
  check(!!started.session?.running, 'PowerShell thread running');

  // The terminal a user sees: the CLI screen of that thread (a PowerShell thread opens on it).
  await until(() => window.TnaiThreadView.shown() === id, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  const pane = await until(
    () =>
      window.TnaiThreadView.term()?.tnaiPaneId === id &&
      window.TnaiThreads.slot('main').querySelector('.tnt-term-box'),
    8000
  );
  check(!!pane, 'its thread shows the CLI screen');
  await until(
    async () =>
      (windows ? /PS [A-Z]:|>/ : /[$#] $/).test(
        (await window.tnaiNative.pty.replay(id))?.buffer || ''
      ),
    10000
  );
  G.send(
    id,
    windows
      ? '$i=0; while($true){ $i++; Write-Output "MR line $i"; Start-Sleep -Milliseconds 10 }'
      : 'i=0; while true; do i=$((i+1)); echo "MR line $i"; sleep 0.01; done'
  );
  check(!!(await until(() => newestIn(pane) > 20, 15000)), 'steady output running');

  // Minimized for 5 s: frames, timers and visibility while the pane keeps printing.
  let frames = 0,
    ticks = 0,
    hiddenSeen = false,
    running = true;
  const onVis = () => {
    if (document.visibilityState !== 'visible') hiddenSeen = true;
  };
  document.addEventListener('visibilitychange', onVis);
  const count = () => {
    if (!running) return;
    frames++;
    requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  const timer = setInterval(() => ticks++, 50);
  await main('minimize');
  check(await until(() => main('isMinimized'), 3000), 'window minimized');
  const f0 = frames,
    t0 = ticks;
  await wait(5000);
  const minFrames = frames - f0,
    minTicks = ticks - t0,
    lagWhileMin = ptyNewest - newestIn(pane);
  log.push(
    'while minimized 5 s: frames ' +
      minFrames +
      ', 50 ms ticks ' +
      minTicks +
      ', xterm behind pty by ' +
      lagWhileMin +
      ' lines, visibility ' +
      document.visibilityState
  );
  check(
    hiddenSeen && document.visibilityState === 'hidden',
    'page counts as hidden while minimized, so its repaints rest (0 frames wanted: ' +
      minFrames +
      ')'
  );
  check(minTicks >= 80, 'timers keep running while minimized (' + minTicks + '/100 ticks)');

  // Frames are informational: Windows gives a minimized window no surface to draw on, so Chromium
  // paints almost none; the one frame on restore is what counts.
  check(
    lagWhileMin <= 60,
    'xterm keeps up with the pty while minimized (' + lagWhileMin + ' lines behind)'
  );

  // Restore: first frame, longest task, stalls logged from the restore, and the pane already at the
  // newest line.
  const long = [],
    po = new PerformanceObserver(l =>
      l.getEntries().forEach(e => long.push(Math.round(e.duration)))
    );
  po.observe({ type: 'longtask' });
  const stalls0 = (window.tnaiStalls || []).length,
    want = ptyNewest;
  const r0 = performance.now();
  await main('restore');
  const ipc = performance.now() - r0;
  await frame();
  const first = performance.now() - r0;
  const shownAtFirst = newestIn(pane);
  check(
    document.visibilityState === 'visible',
    'page is visible again at the first frame after restoring'
  );
  await wait(1000);
  po.disconnect();
  running = false;
  clearInterval(timer);
  document.removeEventListener('visibilitychange', onVis);
  const stalls = (window.tnaiStalls || []).slice(stalls0);
  log.push(
    'restore: main call ' +
      Math.round(ipc) +
      ' ms, first frame after it ' +
      Math.round(first) +
      ' ms, long tasks ' +
      JSON.stringify(long) +
      ', stalls ' +
      JSON.stringify(stalls)
  );
  check(
    first - ipc < 100,
    'first frame within 100 ms of restoring (' + Math.round(first - ipc) + ' ms)'
  );
  check(
    Math.max(0, ...long) < 100,
    'no long task ≥ 100 ms after restoring (' + Math.max(0, ...long) + ' ms)'
  );
  check(
    shownAtFirst >= want - 30,
    'the CLI screen shows the newest output at the first frame (' +
      shownAtFirst +
      ' vs pty ' +
      want +
      ')'
  );
  G.stop(id);
  await wait(500);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
