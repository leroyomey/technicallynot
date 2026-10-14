/*
 * Technically Not tools · desktop-check/tests/perf-background-switch.js — Lag when the user presses
 * to another page at the moment background work lands (a page press "clashing" with an agent
 * finishing or a notification). THREAD_COUNT PowerShell threads print a line every 40 ms in bursts
 * (live status, real WebGL renderer underneath); in each burst round
 * perf-background-switch.main.js pushes one background event every EVERY_MS (a finished turn with a
 * Technically Not report through the real lifecycle + context store, a Needs you change, a hook
 * event, a file watcher batch) while SEQUENCE, pages of the three-dots menu, is gone through
 * STEP_MS apart. A control round changes pages with no pushes. Per round: long tasks (count, max,
 * total), the synchronous cost of each press, press → next frame, the longest frame gap and
 * main-process `[tnai stall]`s. Checks the burst rounds against THRESHOLDS.
 */
const THREAD_COUNT = 10;
const SEED = 80; // finished turns already in the context store (a project worked on for a while)
const ROUNDS = 3;
const STEP_MS = 180;
const EVERY_MS = 25;
const SETTLE_MS = 1200;

// 'overview' is the Threads page and 'terminal' the All threads page.
const SEQUENCE = [
  'overview',
  'terminal',
  'skills',
  'overview',
  'settings',
  'terminal',
  'overview',
  'skills',
  'terminal',
  'overview',
];

// after the fixes: 24 ms / none over 50 ms
const THRESHOLDS = { clickToFrameMaxMs: 60, maxLongTaskMs: 60 };

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

// The route the three-dots menu's rows call.
const nav = view => (view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view));
const med = a => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? Math.round(s[Math.floor(s.length / 2)]) : 0;
};

async function round(label, ids) {
  await main('takeStalls').catch(() => []);
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
  if (ids) await main('start', ids, EVERY_MS);
  await wait(200); // the pushes are already landing when the first click comes
  const t0 = performance.now();
  for (const view of SEQUENCE) {
    const a = performance.now();
    nav(view);
    const c = { view, at: Math.round(a - t0), ms: Math.round(performance.now() - a), frame: -1 };
    requestAnimationFrame(() =>
      setTimeout(() => {
        c.frame = Math.round(performance.now() - a);
      }, 0)
    ); // the frame after the click has been drawn
    clicks.push(c);
    await wait(STEP_MS);
  }
  await wait(SETTLE_MS);
  const counts = ids ? await main('stop') : {};
  running = false;
  po.disconnect();
  const gaps = [];
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i] - frames[i - 1]);
  const stalls = await main('takeStalls').catch(() => []);
  const r = {
    label,
    pushes: counts,
    longTaskCount: longs.length,
    longTaskMaxMs: Math.round(Math.max(0, ...longs.map(l => l.ms))),
    longTaskTotalMs: Math.round(longs.reduce((s, l) => s + l.ms, 0)),
    clickSyncMaxMs: Math.max(...clicks.map(c => c.ms)),
    clickToFrameMaxMs: Math.max(...clicks.map(c => c.frame)),
    clickToFrameMedMs: med(clicks.map(c => c.frame)),
    frameGapMax: Math.round(Math.max(0, ...gaps)),
    clicks: clicks.map(c => c.view + ':' + c.ms + '/' + c.frame).join(' '),
    stalls: stalls.length,
    stallLines: stalls.slice(0, 3),
  };
  log.push(label + ': ' + JSON.stringify(r));
  return r;
}

try {
  nav('overview');
  await wait(400);

  // The route 'terminal' is the All threads page, and that is what is measured.
  const ids = [];
  for (let count = 0; count < THREAD_COUNT; count++) {
    const opened = await window.TnaiTest.open('Terminal');
    if (
      opened?.paneId &&
      (await until(() => G.sessions().find(s => s.paneId === opened.paneId && s.running)))
    )
      ids.push(opened.paneId);
  }
  check(ids.length === THREAD_COUNT, THREAD_COUNT + ' PowerShell threads running');

  // Bursts of output then a pause: live status flips working <-> idle on every panel, as agents do.
  ids.forEach((id, i) =>
    G.send(
      id,
      '$i=0; while($true){ 1..25 | % { $i++; Write-Host "P' +
        i +
        ' step $i working on the task"; Start-Sleep -Milliseconds 40 }; Start-Sleep -Milliseconds ' +
        (900 + i * 120) +
        ' }'
    )
  );
  await wait(1500);
  for (const view of SEQUENCE) {
    nav(view);
    await wait(STEP_MS);
  } // warm-up: first visits (Settings, Skills, All threads) build their pages once
  await wait(SETTLE_MS);

  await main('seed', ids, SEED);
  await wait(1500);
  const control = await round('control (switch only)');
  await main('profileStart');

  // Which part of a thread's row in the thread list changed during the rounds, and how often:
  // the list is on every page, so each change is work done beside the page press.
  const rowChanges = {},
    rowMo = new MutationObserver(list =>
      list.forEach(m => {
        const at = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        const k = (at?.className?.split?.(' ')[0] || 'row itself') + ' ' + m.type;
        rowChanges[k] = (rowChanges[k] || 0) + 1;
      })
    );

  // Which class or attribute of the page frame and of the All threads view changed, and how
  // often: 135 answers each of those changes at once.
  const frameChanges = {};
  const frameMo = new MutationObserver(list =>
    list.forEach(m => {
      const was = new Set(String(m.oldValue || '').split(/\s+/));
      const now = new Set(String(m.target.getAttribute(m.attributeName) || '').split(/\s+/));
      const moved = [...now]
        .filter(name => !was.has(name))
        .concat([...was].filter(name => !now.has(name)));
      const k =
        (m.target.id || m.target.className.split(' ')[0]) +
        ' ' +
        m.attributeName +
        ' [' +
        (moved.join(',') || 'same value') +
        ']';
      frameChanges[k] = (frameChanges[k] || 0) + 1;
    })
  );
  for (const node of [document.querySelector('.layout'), document.getElementById('terminalView')])
    frameMo.observe(node, { attributes: true, attributeOldValue: true });
  const threadList = document.querySelector('.tnt-threads');
  if (threadList)
    rowMo.observe(threadList, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
  const rounds = [];
  for (let i = 0; i < ROUNDS; i++)
    rounds.push(await round('background burst + switch #' + (i + 1), ids));
  const prof = await main('profileStop');
  rowMo.disconnect();
  frameMo.disconnect();
  log.push(
    'page frame changes in the rounds (node, attribute [what moved]: count): ' +
      (Object.entries(frameChanges)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 14)
        .map(([k, v]) => k + ': ' + v)
        .join(' · ') || 'none')
  );
  log.push(
    'thread list changes in the rounds (part, kind: count): ' +
      (Object.entries(rowChanges)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => k + ': ' + v)
        .join(' · ') || 'none')
  );
  log.push('renderer profile files: ' + JSON.stringify(prof.files));
  log.push('renderer profile fns: ' + JSON.stringify(prof.fns));
  log.push('renderer callers: ' + JSON.stringify(prof.callers));
  const worst = k => Math.max(...rounds.map(r => r[k]));
  log.push(
    'SUMMARY ' +
      JSON.stringify({
        control: {
          clickToFrameMax: control.clickToFrameMaxMs,
          clickToFrameMed: control.clickToFrameMedMs,
          longMax: control.longTaskMaxMs,
          longTotal: control.longTaskTotalMs,
          gap: control.frameGapMax,
        },
        burst: {
          clickToFrameMax: worst('clickToFrameMaxMs'),
          clickToFrameMed: med(rounds.map(r => r.clickToFrameMedMs)),
          longMax: worst('longTaskMaxMs'),
          longTotal: rounds.reduce((s, r) => s + r.longTaskTotalMs, 0),
          gap: worst('frameGapMax'),
          stalls: rounds.reduce((s, r) => s + r.stalls, 0),
        },
      })
  );
  check(
    !!document.querySelector('header.top .tnai-bell'),
    'finished turns reached the bell (pushes were delivered)'
  );

  // deferred, never lost: every thread's latest finished turn is kept as its result (44)
  await wait(300);
  const withResult = ids.filter(id => !!window.TnaiResults.get(id)).length;
  check(
    withResult === THREAD_COUNT,
    'every thread has its latest result after the burst (' + withResult + '/' + THREAD_COUNT + ')'
  );

  // -1 means no frame was drawn at all (the test window was covered or the screen was off): nothing
  // was measured, so that is not a pass.
  check(
    worst('clickToFrameMaxMs') >= 0,
    'the window drew frames during the rounds (covered or screen off measures nothing; run it again with the window visible)'
  );
  check(
    worst('clickToFrameMaxMs') < THRESHOLDS.clickToFrameMaxMs,
    'burst rounds: click → next frame < ' +
      THRESHOLDS.clickToFrameMaxMs +
      ' ms (was ' +
      worst('clickToFrameMaxMs') +
      ')'
  );
  check(
    worst('longTaskMaxMs') < THRESHOLDS.maxLongTaskMs,
    'burst rounds: longest task < ' +
      THRESHOLDS.maxLongTaskMs +
      ' ms (was ' +
      worst('longTaskMaxMs') +
      ')'
  );
  ids.forEach(id => G.stop(id));

  // Let the shells finish closing: exiting the app mid-teardown crashed it (0xC0000409) after
  // RESULT: PASS.
  await until(() => !G.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
