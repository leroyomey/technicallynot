/*
 * Technically Not tools · desktop-check/tests/send-switch.js — Lag report check: switching pages
 * while a composer prompt goes out. 3 PowerShell panes stream output; a fake Claude Code pane
 * (agent-mesh.main.js's fake CLI, no credits) is the composer's target. Each round clicks the nav
 * through 7 pages every SWITCH_MS for WINDOW_MS; rounds: A no send, B a composer Send to the target
 * at the start, C Ctrl+Enter (new agent) at the start. Records rAF frame gaps, long tasks,
 * per-click sync time, main stalls, and TnaiRoute calls the test did not make (the send moving the
 * page).
 */
const WINDOW_MS = 2500,
  SWITCH_MS = 150;
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
    const id = 'w' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 20000);
  });
window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const G = window.TnaiAgents;

// The route the three-dots menu's rows call ('overview' is the Threads page).
const SEL = {
  overview: 'overview',
  agents: 'agents',
  terminal: 'terminal',
  preview: 'live-preview',
  skills: 'skills',
  settings: 'settings',
};
const PAGES = Object.keys(SEL);
const nav = v => window.TnaiRoute(SEL[v]);
const pct = (a, q) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))]);
};

// TnaiRoute calls not made by this test's clicks (the send moving the page).
let ours = false;
const foreign = [];
const realRoute = window.TnaiRoute;
window.TnaiRoute = v => {
  if (!ours)
    foreign.push({
      v,
      at: performance.now(),
      stack: (new Error().stack || '')
        .split('\n')
        .slice(2, 4)
        .map(s => s.trim())
        .join(' < '),
    });
  return realRoute(v);
};

async function round(label, action) {
  await main('takeStalls').catch(() => []);
  const longs = [],
    po = new PerformanceObserver(l =>
      l.getEntries().forEach(e => longs.push({ at: e.startTime, ms: e.duration }))
    );
  po.observe({ type: 'longtask' });
  const frames = [];
  let run = true;
  const loop = t => {
    frames.push(t);
    if (run) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  foreign.length = 0;
  const t0 = performance.now(),
    syncs = [];
  const act = action ? action() : null;
  let i = 0;
  while (performance.now() - t0 < WINDOW_MS) {
    const v = PAGES[i++ % PAGES.length],
      s = performance.now();
    ours = true;
    try {
      nav(v);
    } finally {
      ours = false;
    }
    syncs.push({ v, ms: Math.round(performance.now() - s) });
    await wait(SWITCH_MS);
  }
  await wait(300);
  run = false;
  po.disconnect();
  const stalls = await main('takeStalls').catch(() => []);
  const gaps = [];
  for (let k = 1; k < frames.length; k++) gaps.push(frames[k] - frames[k - 1]);
  const worstSync = syncs.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0 });
  const r = {
    label,
    frames: frames.length,
    gapP95: pct(gaps, 0.95),
    gapMax: Math.round(Math.max(0, ...gaps)),
    over50: gaps.filter(g => g > 50).length,
    longCount: longs.length,
    longMax: Math.round(Math.max(0, ...longs.map(l => l.ms))),
    longs: longs.map(l => Math.round(l.at - t0) + '@' + Math.round(l.ms)).slice(0, 12),
    worstClick: worstSync.v + ' ' + worstSync.ms + 'ms',
    clickP95: pct(
      syncs.map(s => s.ms),
      0.95
    ),
    mainStalls: stalls.length,
    foreignRoutes: foreign.map(f => Math.round(f.at - t0) + 'ms>' + f.v),
    action: act ? await Promise.race([act, wait(100).then(() => 'pending')]) : undefined,
  };
  log.push(JSON.stringify(r));
  if (foreign.length)
    log.push(
      '  foreign route from: ' +
        foreign
          .map(f => f.stack)
          .filter((s, k, a) => a.indexOf(s) === k)
          .join(' || ')
    );
  return r;
}

try {
  const ids = [];
  for (let count = 0; count < 3; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (made.ok) ids.push(made.paneId);
  }
  check(ids.length === 3, '3 PowerShell threads running');
  ids.forEach((id, i) =>
    G.send(
      id,
      '$i=0; while($true){ $i++; Write-Output "P' +
        i +
        ' line $i working on src/app.js"; Start-Sleep -Milliseconds 15 }'
    )
  );
  await G.detect(true);
  const opened = await window.TnaiTest.open('Claude Code');
  const cPane = opened.paneId;
  const cs = await until(() => G.sessions().find(s => s.paneId === cPane && s.running), 10000);
  check(!!cs, 'fake Claude Code thread running ' + JSON.stringify(opened));
  await wait(1500);
  window.TnaiLiveTasks.setTarget(cPane);
  const prompt = document.getElementById('prompt');
  const sendVia = ctrl => () => {
    prompt.value = 'echo send-switch test ' + Date.now();
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    if (ctrl) {
      prompt.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
      );
      return Promise.resolve('ctrl-enter');
    }
    document.getElementById('send').click();
    return Promise.resolve('clicked');
  };

  const A = [],
    B = [],
    C = [];
  for (let k = 0; k < 3; k++) {
    nav('overview');
    await wait(800);
    A.push(await round('A no send #' + k));
    nav('overview');
    await wait(800);
    B.push(await round('B send #' + k, sendVia(false)));
    await wait(1500);
  }
  nav('overview');
  await wait(800);
  C.push(await round('C new agent', sendVia(true)));
  await wait(3000);
  await main('profileStart');
  nav('overview');
  await wait(600);
  await round('P send + switching (profiled)', sendVia(false));
  const p = await main('profileStop');
  log.push(
    '--- renderer CPU (' + p.renderer.total + ' ms) by file:',
    ...p.renderer.files.slice(0, 8),
    '--- by function:',
    ...p.renderer.fns.slice(0, 14)
  );
  const worst = (rs, f) => Math.max(...rs.map(r => r[f]));
  log.push(
    'SUMMARY no-send gapMax ' +
      worst(A, 'gapMax') +
      ' longMax ' +
      worst(A, 'longMax') +
      ' | send gapMax ' +
      worst(B, 'gapMax') +
      ' longMax ' +
      worst(B, 'longMax') +
      ' | new-agent gapMax ' +
      worst(C, 'gapMax') +
      ' longMax ' +
      worst(C, 'longMax')
  );
  G.stop(cPane);
  ids.forEach(id => G.stop(id));
  await wait(500);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
window.TnaiRoute = realRoute;
return { ok, log };
