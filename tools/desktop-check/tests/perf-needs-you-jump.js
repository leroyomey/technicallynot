/*
 * Technically Not tools · desktop-check/tests/perf-needs-you-jump.js — How fast the "N need you"
 * chip (Ctrl+Shift+J) jumps to an agent, with many threads open. THREAD_COUNT PowerShell threads
 * on the real WebGL renderer run a fake full-screen CLI (it redraws REDRAW_LINES lines on every
 * pty resize, perf-page-switch.main.js). Each round starts on the Threads page with another
 * thread open and everything settled, then makes the jump: first the app's plain "go to this
 * agent" (TnaiLiveTasks.focusPane), then what the chip calls (TnaiNeedsYou.jump). Per round: the
 * time the call itself takes, long tasks, gaps between frames, pty resizes, stalls of the main
 * process; and a CPU profile of the jump rounds. Checks that the jump lands on that agent's thread
 * and stays under THRESHOLDS. Nothing is sent to an agent CLI. Returns {ok, log}.
 */
const THREAD_COUNT = 10;
const ROUNDS = 3;
const SETTLE_MS = 1500;
const FILL_MS = 6000;
const REDRAW_LINES = 1500;
const THRESHOLDS = { maxLongTaskMs: 150, maxFrameGapMs: 200 };

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
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 30000);
  });

// The real renderer: this test measures what a user's window does.
window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const G = window.TnaiAgents;
const threads = window.TnaiThreads;
const windows = /Windows/.test(navigator.userAgent);

// One jump, measured. `away` is the thread that is open before it.
async function round(label, away, act) {
  // Start state: the Threads page with another thread open, everything settled.
  threads.show(away);
  await wait(SETTLE_MS);
  await main('takeStalls').catch(() => []);
  await main('takeResizes');
  const longs = [],
    frames = [];
  const po = new PerformanceObserver(l =>
    l.getEntries().forEach(e => longs.push({ at: e.startTime, ms: e.duration }))
  );
  po.observe({ type: 'longtask' });
  let running = true;
  const loop = t => {
    frames.push(t);
    if (running) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await wait(50);
  const t0 = performance.now();
  act();
  const syncMs = Math.round(performance.now() - t0);
  await wait(SETTLE_MS);
  running = false;
  po.disconnect();
  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
  const r = {
    label,
    syncMs,
    longTaskCount: longs.filter(l => l.at >= t0 - 5).length,
    longTaskMaxMs: Math.round(Math.max(0, ...longs.filter(l => l.at >= t0 - 5).map(l => l.ms))),
    longTasks: longs.map(l => Math.round(l.at - t0) + '+' + Math.round(l.ms)),
    frames: frames.length,
    frameGapMax: Math.round(Math.max(0, ...gaps)),
    framesOver50ms: gaps.filter(g => g > 50).length,
    stalls: (await main('takeStalls').catch(() => [])).length,
    ptyResizes: await main('takeResizes'),
  };
  log.push(label + ': ' + JSON.stringify(r));
  return r;
}

try {
  const ids = [];
  for (let count = 0; count < THREAD_COUNT; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made.ok) ids.push(made.paneId);
  }
  check(ids.length === THREAD_COUNT, THREAD_COUNT + ' PowerShell threads running');
  const tui = await main('tuiPath');
  ids.forEach((id, i) =>
    G.send(id, (windows ? '& node "' : 'node "') + tui + '" P' + i + ' ' + REDRAW_LINES)
  );
  const up = await until(async () => /tick \d+/.test(await main('tail', ids[0])), 10000);
  check(!!up, 'the fake full-screen CLI runs in the threads');
  await wait(FILL_MS);
  const target = ids[2];
  const away = ids[0];
  threads.open();
  await until(() => threads.visible(), 5000);
  log.push('xterm views: ' + document.querySelectorAll('.xterm').length);

  // The app's plain "go to this agent", for comparison.
  const plain = [];
  for (let i = 0; i < ROUNDS; i++)
    plain.push(
      await round('go to this agent (focusPane) #' + (i + 1), away, () => {
        window.TnaiLiveTasks.setTarget(target);
        window.TnaiLiveTasks.focusPane(target);
      })
    );
  await main('profileStart');
  const jumps = [];
  for (let i = 0; i < ROUNDS; i++) {
    jumps.push(
      await round('TnaiNeedsYou.jump #' + (i + 1), away, () => window.TnaiNeedsYou.jump(target))
    );

    // The jump ends in the agent's thread.
    check(threads.visible(), 'round ' + (i + 1) + ': the Threads page is shown');
    check(
      String(threads.selected()) === String(target),
      'round ' + (i + 1) + ': the thread of the jumped-to agent is the open one'
    );
  }

  // Jumping again while its thread is already open keeps it open.
  window.TnaiNeedsYou.jump(target);
  await wait(400);
  check(String(threads.selected()) === String(target), 'second jump keeps its thread open');
  const prof = await main('profileStop');
  log.push('renderer profile fns: ' + JSON.stringify(prof.renderer.fns));
  log.push('renderer callers: ' + JSON.stringify(prof.renderer.callers));

  const sum = rs => ({
    sync: Math.max(...rs.map(r => r.syncMs)),
    max: Math.max(...rs.map(r => r.longTaskMaxMs)),
    gap: Math.max(...rs.map(r => r.frameGapMax)),
    frames: Math.min(...rs.map(r => r.frames)),
    resizes: rs.map(r => r.ptyResizes),
  });
  log.push('SUMMARY ' + JSON.stringify({ plain: sum(plain), jump: sum(jumps) }));
  const j = sum(jumps);

  // A covered window draws no frames, and then the gaps say nothing.
  check(j.frames > 10, 'the window drew frames while it was measured (' + j.frames + ' at least)');
  check(
    j.max < THRESHOLDS.maxLongTaskMs,
    'jump: longest task < ' + THRESHOLDS.maxLongTaskMs + ' ms (was ' + j.max + ')'
  );
  check(
    j.gap < THRESHOLDS.maxFrameGapMs,
    'jump: max frame gap < ' + THRESHOLDS.maxFrameGapMs + ' ms (was ' + j.gap + ')'
  );
  ids.forEach(id => G.stop(id));
  await until(() => !G.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
