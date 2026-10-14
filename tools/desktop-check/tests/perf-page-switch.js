/*
 * Technically Not tools · desktop-check/tests/perf-page-switch.js — Lag when an agent starts while
 * the user switches pages, on the pages a user sees (it sat on the old
 * terminal grid, which nobody can reach any more). PANE_COUNT PowerShell threads are opened as
 * threads and kept busy: each runs a fake full-screen CLI that prints all the time and redraws on
 * every resize (perf-page-switch.main.js). One of them is the open thread, on its CLI screen.
 * Each round starts a Claude Code agent the way the prompt box's New agent does (fake `claude`
 * from perf-new-task.main.js, no credits) and at once goes through SEQUENCE, the pages of the
 * three-dots menu, STEP_MS apart: Threads, All threads, Live preview, Skills, Settings, Devices.
 * A control round goes through the same pages with no agent start. Per round: long tasks (count,
 * max, when relative to each change of page), frame gaps, the synchronous cost of each change,
 * pty resizes, main-process `[tnai stall]`s, and how many terminals on screen draw with the DOM
 * renderer; a CPU profile of the agent rounds by file and function. Checks the agent rounds
 * against THRESHOLDS.
 */
const PANE_COUNT = 12;
const ROUNDS = 3;
const STEP_MS = 180;
const SETTLE_MS = 1500;
const FILL_MS = 10000;

// 'tui' (default): each panel runs a fake full-screen CLI that redraws REDRAW_LINES lines on every
// pty resize, as Claude Code does; 'flood': PowerShell prints lines forever and ignores resizes.
// $env:TNAI_PPS_MODE picks one.
const REDRAW_LINES = 1500;
let MODE = 'tui';

// 'overview' is the Threads page and 'terminal' the All threads page.
const SEQUENCE = [
  'overview',
  'terminal',
  'live-preview',
  'skills',
  'overview',
  'settings',
  'terminal',
  'devices',
  'overview',
];
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

window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const G = window.TnaiAgents;

// What the three-dots menu's rows call for each page. The hidden left navigation is not pressed.
const nav = view => (view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view));
const windows = /Windows/.test(navigator.userAgent);
const floodScript = tag => {
  // bash twin (Linux/macOS) of the PowerShell flood below.
  if (!windows)
    return (
      "colors=(31 32 33 34 35 36); i=0; pad=$(printf '#%.0s' $(seq 80)); while true; do i=$((i+1)); c=${colors[$((i%6))]}; " +
      "if [ $((i%15)) -eq 0 ]; then printf '\\033[%smr\\033[0m' $c; fi; printf '\\033[%sm%s step %s working on task %s\\033[0m\\n' $c " +
      tag +
      ' $i "$pad"; done'
    );
  const E = '$([char]27)';
  return (
    "$colors=31,32,33,34,35,36; $i=0; $pad=('#'*80); while($true){ $i++; $c=$colors[$i%6]; " +
    'if($i%15 -eq 0){ Write-Host -NoNewline "' +
    E +
    '[${c}mr' +
    E +
    '[0m" }; ' +
    'Write-Host "' +
    E +
    '[${c}m' +
    tag +
    ' step $i working on task $pad' +
    E +
    '[0m" }'
  );
};

async function round(label, start) {
  await main('takeStalls').catch(() => []);
  await main('takeResizes');
  const longs = [],
    frames = [],
    clicks = [];
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
  const t0 = performance.now();
  if (start) start();
  for (const view of SEQUENCE) {
    const a = performance.now();
    nav(view);
    clicks.push({ view, at: Math.round(a - t0), ms: Math.round(performance.now() - a) });
    await wait(STEP_MS);
  }
  await wait(SETTLE_MS);
  running = false;
  po.disconnect();
  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
  const stalls = await main('takeStalls').catch(() => []);
  const r = {
    label,
    longTaskCount: longs.length,
    longTaskMaxMs: Math.round(Math.max(0, ...longs.map(l => l.ms))),
    longTasks: longs.map(l => Math.round(l.at - t0) + '+' + Math.round(l.ms)),
    frameGapMax: Math.round(Math.max(0, ...gaps)),
    framesOver50ms: gaps.filter(g => g > 50).length,
    clicks: clicks.map(c => c.view + '@' + c.at + ':' + c.ms),
    stalls: stalls.length,
    ptyResizes: await main('takeResizes'),
  };
  log.push(label + ': ' + JSON.stringify(r));
  return r;
}

try {
  // The All threads page is what the route 'terminal' shows a user.
  window.TnaiThreads.open();
  await wait(400);
  const ids = [];
  for (let count = 0; count < PANE_COUNT; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (
      made?.paneId &&
      (await until(() => G.sessions().find(s => s.paneId === made.paneId)?.running))
    )
      ids.push(made.paneId);
  }
  check(ids.length === PANE_COUNT, PANE_COUNT + ' PowerShell threads running');

  // one of them is the open thread, on its CLI screen: the terminal a user has on screen
  window.TnaiThreads.show(ids[0]);
  await wait(600);
  const shownGrid = () =>
    [...document.querySelectorAll('#terminalView .terminal-pane[data-pane-id]')].filter(
      panel => panel.getClientRects().length
    ).length;
  let gridSeen = 0;
  const tui = await main('tuiPath');
  MODE = await main('mode');
  log.push('mode: ' + MODE);
  ids.forEach((id, i) =>
    G.send(
      id,
      MODE === 'flood'
        ? floodScript('P' + i)
        : (windows ? '& node "' : 'node "') + tui + '" P' + i + ' ' + REDRAW_LINES
    )
  );
  const taskIds = [];
  if (MODE === 'tui') {
    const up = await until(async () => /tick \d+/.test(await main('tail', ids[0])), 10000);
    check(
      !!up,
      'fake TUI running in the panels' +
        (up ? '' : ': ' + JSON.stringify(await main('tail', ids[0])))
    );
  }
  await wait(FILL_MS); // long sessions: scrollback filled, so a refit reflows real history
  await G.detect(true);
  const card = document.querySelector('.terminal-provider-card[data-provider="Claude Code"]');
  const agent = card && card.disabled ? 'Terminal' : 'Claude Code';
  if (agent !== 'Claude Code')
    log.push('note: fake Claude Code not detected, rounds start a PowerShell panel instead');

  // One warm-up pass so first-visit page builds (Settings, Skills, Devices) don't count against
  // any round. On the way it is seen that no page of the menu shows the old terminal grid.
  for (const view of SEQUENCE) {
    nav(view);
    await wait(STEP_MS);
    gridSeen = Math.max(gridSeen, shownGrid());
  }
  check(
    gridSeen === 0,
    'no page of the menu shows a panel of the old terminal grid (' + gridSeen + ')'
  );
  check(
    !!window.TnaiAllThreads?.state &&
      (nav('terminal'), await until(() => window.TnaiAllThreads.state().on, 3000)) &&
      window.TnaiAllThreads.state().order.length >= PANE_COUNT,
    'the All threads page holds the ' + PANE_COUNT + ' busy threads'
  );
  nav('overview');
  await wait(SETTLE_MS);
  log.push('xterm views: ' + document.querySelectorAll('.xterm').length);

  const control = await round('control (switch only)');
  await main('profileStart');
  const rounds = [];
  let domOnScreen = 0;
  for (let i = 0; i < ROUNDS; i++) {
    // The prompt box's New agent (19 openHere): a new thread in the active workspace, then the
    // CLI in it.
    rounds.push(
      await round('agent start + switch #' + (i + 1), () => {
        const record = window.TnaiNewTerminalPane({ name: 'Perf ' + (i + 1), quiet: true });
        taskIds.push(record.id);
        setTimeout(
          () => G.openIn(record.id, agent, {}).catch(e => log.push('openIn error ' + e.message)),
          0
        );
      })
    );
    check(
      !!(await until(() => G.sessions().find(s => s.paneId === taskIds[i] && s.running), 8000)),
      'round ' + (i + 1) + ': new ' + agent + ' thread running'
    );

    // The WebGL renderer leaves .xterm-rows empty; a terminal on screen with rows in it draws with
    // the DOM renderer (per-glyph measuring). The terminal on screen is the open thread's CLI
    // screen, on the Threads page.
    nav('overview');
    window.TnaiThreads.show(ids[0]);
    await wait(300);
    const domShown = [...document.querySelectorAll('.xterm')].filter(
      x => x.clientWidth > 0 && x.querySelector('.xterm-rows')?.childElementCount
    );
    log.push(
      'round ' + (i + 1) + ': terminals on screen drawn by the DOM renderer: ' + domShown.length
    );
    domOnScreen = Math.max(domOnScreen, domShown.length);
    await wait(300);
  }
  const prof = await main('profileStop');
  log.push('panel 1 tail: ' + JSON.stringify((await main('tail', ids[0])).slice(-160)));
  log.push('renderer profile files: ' + JSON.stringify(prof.renderer.files));
  log.push('renderer profile fns: ' + JSON.stringify(prof.renderer.fns));
  log.push('renderer callers: ' + JSON.stringify(prof.renderer.callers));
  log.push('main profile fns: ' + JSON.stringify(prof.main.fns.slice(0, 10)));

  const worst = Math.max(...rounds.map(r => r.longTaskMaxMs)),
    count = rounds.reduce((a, r) => a + r.longTaskCount, 0);
  const gap = Math.max(...rounds.map(r => r.frameGapMax));
  log.push(
    'SUMMARY ' +
      JSON.stringify({
        control: {
          max: control.longTaskMaxMs,
          count: control.longTaskCount,
          gap: control.frameGapMax,
        },
        agentRounds: { max: worst, count, gap },
      })
  );
  check(
    worst < THRESHOLDS.maxLongTaskMs,
    'agent rounds: longest task < ' + THRESHOLDS.maxLongTaskMs + ' ms (was ' + worst + ')'
  );
  check(
    domOnScreen === 0,
    'every terminal on screen draws with WebGL (DOM-rendered at most ' + domOnScreen + ')'
  );
  check(
    gap < THRESHOLDS.maxFrameGapMs,
    'agent rounds: max frame gap < ' + THRESHOLDS.maxFrameGapMs + ' ms (was ' + gap + ')'
  );
  [...ids, ...taskIds].forEach(id => G.stop(id));

  // Let the shells finish closing: exiting the app mid-teardown crashed it (0xC0000409) after
  // RESULT: PASS.
  await until(() => !G.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
