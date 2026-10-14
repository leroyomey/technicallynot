/*
 * * Technically Not tools · desktop-check/tests/stress-soak.js — Cold start + long-run memory
 * * soak. Startup: process launch → first paint → scripts done → loader gone (56 performance
 * * marks), long tasks during load. Soak (TNAI_SOAK_LOOPS, default 40): start as many PowerShell
 * * threads as the project holds, show Threads and All threads, close them all, switch between
 * * two projects, open and close a file in the side column, the command palette, the shortcuts
 * dialog and every page.
 * * After each loop a forced-GC sample (heap, DOM nodes, listeners, main memory) and at the end
 * * the app's child processes: growth per loop past the warm-up must stay small and no shell may
 * * outlive its thread. Then reloads under a CPU profile and reports script cost by file in
 * * stress-soak.after.js. No agent prompts.
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
  });
const N = window.tnaiNative,
  A = window.TnaiAgents,
  same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const rail = path => document.querySelector('.repo-real-tree [data-real-path="' + path + '"]');
const menu = () => document.querySelector('.repo-project-menu');
const items = () => [...document.querySelectorAll('.repo-project-menu .repo-project-item')];
const key = (k, o = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })
  );
const fmt = s =>
  'heap ' +
  s.heapMB +
  ' MB · nodes ' +
  s.nodes +
  ' · docs ' +
  s.docs +
  ' · listeners ' +
  s.jsListeners +
  ' (window ' +
  s.winListeners.total +
  ', document ' +
  s.docListeners.total +
  ') · main heap ' +
  s.mainHeapMB +
  ' MB rss ' +
  s.mainRssMB +
  ' MB';

// Intervals started during the soak that are still running at its end (a leaked interval keeps its
// closure alive).
const liveIntervals = new Map(),
  origSet = window.setInterval,
  origClear = window.clearInterval;
window.setInterval = function (fn, ms, ...rest) {
  const id = origSet.call(window, fn, ms, ...rest);
  liveIntervals.set(id, new Error().stack.split('\n')[2]?.trim() || '?');
  return id;
};
window.clearInterval = function (id) {
  liveIntervals.delete(id);
  return origClear.call(window, id);
};

try {
  // ---- Startup
  await until(() => performance.getEntriesByName('tnai:loader-gone').length, 5000);
  const m = await main('marks'),
    t0 = performance.timeOrigin,
    mark = n => performance.getEntriesByName(n)[0]?.startTime;
  const nav = performance.getEntriesByType('navigation')[0],
    paint =
      performance.getEntriesByName('first-contentful-paint')[0]?.startTime ??
      performance.getEntriesByName('first-paint')[0]?.startTime;
  const rel = ms => (ms == null ? '?' : Math.round(ms) + ' ms');
  log.push(
    'startup (from process launch): page navigation starts ' +
      rel(t0 - m.processStart) +
      ', first paint ' +
      rel(t0 + paint - m.processStart) +
      ', DOMContentLoaded ' +
      rel(t0 + nav.domContentLoadedEventEnd - m.processStart) +
      ', scripts done ' +
      rel(t0 + mark('tnai:scripts-done') - m.processStart) +
      ', loader gone (interactive) ' +
      rel(t0 + mark('tnai:loader-gone') - m.processStart) +
      ', window shown ' +
      rel((m.shown || m.readyToShow) - m.processStart)
  );
  log.push(
    'startup (page timeline): first paint ' +
      rel(paint) +
      ', scripts done ' +
      rel(mark('tnai:scripts-done')) +
      ', load ' +
      rel(nav.loadEventEnd) +
      ', loader gone ' +
      rel(mark('tnai:loader-gone'))
  );
  check(mark('tnai:loader-gone') > 0, 'startup loader removed');

  await until(() => rail('README.md'));
  await A.detect(true);
  const P0 = await N.fs.root(),
    P1 = await main('make', 'soak-b');
  await main('pickNext', P1);
  window.TnaiRoute('files');
  await wait(300);
  document.querySelector('.repository-rail-head .repo-project-switch').click();
  await wait(100);
  menu().querySelector('.repo-project-add').click();
  check(
    !!(await until(async () => same(await N.fs.root(), P1) && rail('lib'))),
    'second project added'
  );
  const switchTo = async dir => {
    if (menu().hidden) document.querySelector('.repository-rail-head .repo-project-switch').click();
    await wait(60);
    items()
      .find(i => same(i.dataset.projectPath, dir))
      ?.querySelector('.repo-project-open')
      .click();
    return !!(await until(async () => same(await N.fs.root(), dir) && rail('README.md')));
  };
  const L = window.TnaiPaneLimit.max,
    loops = await main('loops'),
    phases = await main('phases'),
    closeGap = await main('closeGap');
  const samples = [],
    children = [],
    problems = [];
  let before = await main('sample'),
    c0 = await main('children');
  log.push(
    'before soak: ' +
      fmt(before) +
      ' · child processes ' +
      c0.total +
      ' ' +
      JSON.stringify(c0.byName)
  );

  const t = performance.now();
  for (let i = 0; i < loops; i++) {
    // 1. Start as many PowerShell threads as the project holds, then close every one.
    if (phases.includes('panes')) {
      await main('progress', 'loop ' + (i + 1) + ' start threads');
      window.TnaiThreads.open();
      await wait(150);
      const opens = [];

      // Exactly the limit: one more overflows into a new workspace underneath (07), which stays
      // after its panels close, so L + 2 added a workspace every loop and its ~34 nodes read as a
      // leak. The starts overlap, as they did when twelve were pressed at once; each is begun a
      // moment after the one before, so that no two take the same empty panel underneath.
      for (let k = 0; k < L && !window.TnaiPaneLimit.full(); k++) {
        opens.push(
          window.TnaiTest.startThread({ tool: 'Terminal' }).then(
            made => ({ ok: true, paneId: made.paneId }),
            error => ({ ok: false, error: error?.message || String(error) })
          )
        );
        await wait(60);
      }
      const res = await Promise.all(opens);
      if (res.some(r => !r?.ok))
        problems.push(
          'loop ' +
            i +
            ': ' +
            res.filter(r => !r?.ok).length +
            ' threads did not start (' +
            res.find(r => !r?.ok)?.error +
            ')'
        );
      const own = new Set(res.filter(r => r?.ok).map(r => r.paneId)).size;
      if (own < res.filter(r => r?.ok).length)
        problems.push('loop ' + i + ': two starts shared one session (' + own + ' sessions)');
      await until(() => A.sessions().filter(s => s.running === true).length >= opens.length, 20000);

      // the pages a user has while they run: Threads, and All threads (the route 'terminal')
      window.TnaiThreads.open();
      await wait(200);
      window.TnaiRoute('terminal');
      await wait(200);
      window.TnaiThreads.open();
      await wait(100);
      await main('progress', 'loop ' + (i + 1) + ' close ' + opens.length + ' threads');

      // closed the way the app closes a thread: the Close button of its panel underneath
      for (const b of document.querySelectorAll(
        '.terminal-pane .terminal-pane-tools button[title="Close terminal"]'
      )) {
        b.click();
        if (closeGap) await wait(closeGap);
      }
      await until(
        () => !document.querySelector('.terminal-pane') && !A.sessions().some(s => s.running),
        10000
      );
    }

    // 2. Switch projects, open and close a file.
    if (phases.includes('projects')) {
      await main('progress', 'loop ' + (i + 1) + ' projects + tabs');
      window.TnaiRoute('files');
      await wait(100);
      if (!(await switchTo(i % 2 ? P0 : P1)))
        problems.push('loop ' + i + ': project switch failed');

      // A file opens in the side column of the Threads page and closes again. This step used to
      // press rows of the old file rail: with the editor and its tabs gone, each press opened a
      // "(view only)" window of its own and none was closed, one more per loop on the user's
      // taskbar (seen 2026-10-13). No step of a test may open a window it does not close.
      window.TnaiThreads?.open?.();
      await wait(60);
      if (window.TnaiFileViewer?.text) window.TnaiThreadSide?.showFile?.('README.md');
      await wait(150);
      window.TnaiThreadSide?.hideFile?.();
      window.TnaiThreadSide?.close?.();
      await wait(40);
    }

    // 3. Command palette, shortcuts dialog, every page.
    if (phases.includes('ui')) {
      await main('progress', 'loop ' + (i + 1) + ' palette + pages');
      window.TnaiPalette.open();
      await wait(80);
      const pin = document.querySelector('.tnai-pal-input, .tnai-pal input');
      if (pin) {
        pin.value = 'READ';
        pin.dispatchEvent(new Event('input'));
        await wait(120);
      }
      window.TnaiPalette.close();
      await wait(40);
      window.TnaiShortcuts.open();
      await wait(80);
      window.TnaiShortcuts.close();
      await wait(40);
      for (const page of ['settings', 'skills', 'workspace', 'overview']) {
        window.TnaiRoute(page);
        await wait(120);
      }
    }
    const s = await main('sample');
    s.loop = i + 1;
    samples.push(s);
    if (i === 0 || (i + 1) % 10 === 0 || i === loops - 1) {
      const c = await main('children');
      children.push(c);
      const line =
        'loop ' +
        (i + 1) +
        ': ' +
        fmt(s) +
        ' · child processes ' +
        c.total +
        ' ' +
        JSON.stringify(c.byName);
      log.push(line);
      await main('progress', line);
    }
  }
  log.push(loops + ' loops in ' + Math.round((performance.now() - t) / 1000) + ' s');
  problems.slice(0, 5).forEach(p => log.push('note ' + p));
  check(
    !problems.length,
    'every loop started all threads and switched projects (' + problems.length + ' problems)'
  );

  // Growth per loop from loop 5 (warm-up done: caches, lazily built pages) to the last.
  const w = samples[Math.min(4, samples.length >> 1)],
    last = samples[samples.length - 1],
    n = Math.max(1, last.loop - w.loop);
  const per = k => (last[k] - w[k]) / n;
  log.push(
    'growth per loop after warm-up: heap ' +
      (per('heapMB') * 1024).toFixed(1) +
      ' KB, nodes ' +
      per('nodes').toFixed(1) +
      ', listeners ' +
      per('jsListeners').toFixed(1) +
      ', window listeners ' +
      ((last.winListeners.total - w.winListeners.total) / n).toFixed(2) +
      ', document listeners ' +
      ((last.docListeners.total - w.docListeners.total) / n).toFixed(2) +
      ', main heap ' +
      (per('mainHeapMB') * 1024).toFixed(1) +
      ' KB'
  );
  const grew = (a, b) =>
    Object.keys(b.byType)
      .filter(k => (b.byType[k] || 0) > (a.byType[k] || 0))
      .map(k => k + ' ' + (a.byType[k] || 0) + '→' + b.byType[k]);
  const wg = grew(w.winListeners, last.winListeners),
    dg = grew(w.docListeners, last.docListeners);
  if (wg.length || dg.length)
    log.push(
      'listener types that grew: window ' +
        (wg.join(', ') || '-') +
        ' · document ' +
        (dg.join(', ') || '-')
    );
  check(per('nodes') < 20, 'DOM nodes do not grow per loop (' + per('nodes').toFixed(1) + ')');
  check(
    per('jsListeners') < 5,
    'JS listeners do not grow per loop (' + per('jsListeners').toFixed(1) + ')'
  );
  check(
    per('heapMB') * 1024 < 150,
    'renderer heap growth per loop under 150 KB (' + (per('heapMB') * 1024).toFixed(1) + ' KB)'
  );
  const kept = [...liveIntervals.values()];
  const byOrigin = {};
  kept.forEach(k => {
    byOrigin[k] = (byOrigin[k] || 0) + 1;
  });
  log.push(
    'intervals started during the soak still running: ' +
      kept.length +
      (kept.length
        ? ' · ' +
          Object.entries(byOrigin)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => v + '× ' + k)
            .join(' | ')
        : '')
  );
  check(kept.length < 5, 'no interval leak (' + kept.length + ' still running)');
  const shells = x =>
    (x.byName?.['powershell.exe'] || 0) +
    (x.byName?.['pwsh.exe'] || 0) +
    (x.byName?.['conhost.exe'] || 0) +
    (x.byName?.['OpenConsole.exe'] || 0);
  let cEnd;
  const tEnd = performance.now();
  for (let k = 0; k < 10; k++) {
    await wait(2000);
    cEnd = await main('children');
    if (shells(cEnd) <= shells(c0)) break;
  } // closing is asynchronous (job end, then the pty)
  log.push('waited ' + Math.round((performance.now() - tEnd) / 1000) + ' s for shells to end');
  log.push(
    'child processes after soak: ' +
      cEnd.total +
      ' ' +
      JSON.stringify(cEnd.parents) +
      ' (name<parent)'
  );
  check(
    shells(cEnd) <= shells(c0),
    'no shell outlived its pane (' + shells(c0) + ' before, ' + shells(cEnd) + ' after)'
  );
  window.setInterval = origSet;
  window.clearInterval = origClear;
  if (!(await switchTo(P0))) log.push('note: could not switch back to the first project');
  await main('profileStart');
  return { ok, log, reload: true };
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
return { ok, log };
