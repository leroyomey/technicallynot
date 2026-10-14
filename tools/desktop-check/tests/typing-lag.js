/*
 * Technically Not tools · desktop-check/tests/typing-lag.js — Typing in the prompt box while
 * agents work, on the pages a user sees (its sessions came from the old
 * terminal grid). Twelve real PowerShell threads, opened as threads, print fast colored output,
 * and typing-lag.main.js pushes hook events, turns and file changes. Real key presses go into
 * #prompt on the Threads page and on the All threads page; each page reports long tasks, how late
 * the input events ran, and a CPU profile by file and function. No prompt is sent. Harsher run:
 * $env:TNAI_TYPING_STRESS='1' gives a flood of hook events, turns and file changes about four
 * times as dense (typing-lag.main.js config).
 */
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
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 20000);
  });
let inputId = 0;
const input = events =>
  new Promise(resolve => {
    const id = ++inputId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = resolve;
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const G = window.TnaiAgents;
const go = async view => {
  // what the three-dots menu's rows call ('overview' is the Threads page, 'terminal' All threads)
  if (view === 'overview') window.TnaiThreads.open();
  else window.TnaiRoute(view);
  await wait(400);
};
const prompt = document.getElementById('prompt');

// Twelve busy threads, whatever the companion's own count says.
const THREADS = 12;

try {
  const cfg = await main('config'),
    N = Math.max(cfg.panes, THREADS);
  log.push('config: ' + JSON.stringify(cfg) + ', threads: ' + N);

  // the route 'terminal' shows a user the All threads page
  await go('overview');
  const ids = [];
  for (let count = 0; count < N; count++) {
    const made = await window.TnaiTest.open('Terminal');
    if (
      made?.paneId &&
      (await until(() => G.sessions().find(s => s.paneId === made.paneId)?.running))
    )
      ids.push(made.paneId);
  }
  check(ids.length === N, N + ' PowerShell threads running');
  window.TnaiThreads.show(ids[0]);
  await wait(1500);
  const E = '$([char]27)';
  const loop = `$i=0; while($i -lt 100000){ $i++; Write-Host "${E}[32m● Working${E}[0m ${E}[2mEdited src/app.js and README.md · step $i · ${E}[36m$(Get-Random)${E}[0m"; if($i % 20 -eq 0){ Start-Sleep -Milliseconds 15 } }`;
  ids.forEach(id => G.send(id, loop));
  await wait(1500);

  const results = {};
  for (const view of ['overview', 'terminal']) {
    await go(view);
    prompt.focus();
    await wait(100);
    if (document.activeElement !== prompt) {
      log.push(
        view +
          ': composer not focusable here (' +
          (prompt.offsetParent ? 'shown' : 'hidden') +
          ', focus on ' +
          (document.activeElement?.className || document.activeElement?.tagName) +
          ')'
      );
      continue;
    }
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const long = [],
      lates = [];
    const po = new PerformanceObserver(l => l.getEntries().forEach(e => long.push(e.duration)));
    po.observe({ type: 'longtask' });
    const onInput = e => lates.push(performance.now() - e.timeStamp);
    prompt.addEventListener('keydown', onInput);
    await main('burst', ids, 7000);
    if (view === 'overview') await main('profileStart');
    const keys = [];
    const text = 'please refactor the login flow and add tests for it ';
    for (let r = 0; r < 2; r++)
      for (const ch of text) {
        const code = ch === ' ' ? 'Space' : ch.toUpperCase();
        keys.push(
          { type: 'keyDown', keyCode: code, wait: 5 },
          { type: 'char', keyCode: ch, wait: 5 },
          { type: 'keyUp', keyCode: code, wait: 50 }
        );
      }
    const t0 = performance.now();
    await input(keys);
    const elapsed = performance.now() - t0;
    if (view === 'overview') {
      const p = await main('profileStop');
      for (const k of ['renderer', 'main'])
        log.push(
          '--- ' + k + ' CPU (overview, ' + p[k].total + ' ms sampled) by file:',
          ...p[k].files,
          '--- by function:',
          ...p[k].fns,
          '--- hottest callers:',
          ...p[k].callers
        );
    }
    await wait(300);
    po.disconnect();
    prompt.removeEventListener('keydown', onInput);
    lates.sort((a, b) => a - b);
    const pct = q =>
      Math.round(lates[Math.min(lates.length - 1, Math.floor(lates.length * q))] || 0);
    results[view] = {
      typed: prompt.value.length,
      keys: lates.length,
      p50: pct(0.5),
      p95: pct(0.95),
      max: Math.round(lates[lates.length - 1] || 0),
      longTasks: long.length,
      longMs: Math.round(long.reduce((a, b) => a + b, 0)),
      worst: Math.round(Math.max(0, ...long)),
      secs: (elapsed / 1000).toFixed(1),
    };
    log.push(view + ': ' + JSON.stringify(results[view]));
    check(prompt.value.length === text.length * 2, view + ': every key reached the composer');
    prompt.value = '';
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(800);
  }
  ids.forEach(id => G.stop(id));

  // Let the shells finish closing: exiting the app mid-teardown crashed it (0xC0000409) after
  // RESULT: PASS, in two runs of four.
  await until(() => !G.sessions().some(session => session.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
