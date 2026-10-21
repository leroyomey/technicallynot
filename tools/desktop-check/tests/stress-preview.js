/*
 * * Technically Not tools · desktop-check/tests/stress-preview.js — Live preview (31) under load on
 * * the Live preview page (65), with real pages: a copy of the website folder plus heavy pages
 * * (40k-node DOM, 340 images, 800 CSS animations, a busy-JS page) served by a live-reload "dev"
 * * script that runs in a real PowerShell thread (stress-preview.main.js). Measures: URL detected →
 * page
 * * shown; 20 file saves in 5 s → reloads; Desktop/Tablet/Phone switches (exactly one reload each);
 * * window resizes (no reloads, no emulation calls, layout writes per resize); pop-out/dock cycles
 * * (reload time, no leaked frames or emulation entries); 5 preview tabs (load, switch without
 * * reload, close frees frames); input delay in the composer while a busy page runs, alone and with
 * 4
 * * streaming PowerShell panels; renderer/main CPU by file, app CPU and memory. No agent prompts.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const info = (label, v) =>
  log.push(
    'info ' +
      new Date().toISOString().slice(11, 19) +
      ' ' +
      label +
      ': ' +
      (typeof v === 'string' ? v : JSON.stringify(v))
  );
const until = async (fn, ms = 10000, step = 10) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(step);
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
let inputId = 0;
const input = events =>
  new Promise(resolve => {
    const id = ++inputId;
    (window.__tnaiInputDone ||= {})[id] = resolve;
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const frame2 = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const ms = t => Math.round(performance.now() - t);
const pct = (list, q) => {
  const s = [...list].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * q))] || 0);
};

// Page probes: every served HTML page posts "TNAI_SP:load:<path>:<innerWidth>" to its parent on
// load.
const loads = [];
const onMsg = e => {
  const m = typeof e.data === 'string' && /^TNAI_SP:(\w+):([^:]*):(\d+)$/.exec(e.data);
  if (m) loads.push({ path: m[2], w: +m[3], at: performance.now() });
};
window.addEventListener('message', onMsg);
const loadsOf = (path, since) => loads.filter(l => l.path === path && l.at >= since);
const nextLoad = (path, since, ms = 15000, w) =>
  until(() => loads.find(l => l.path === path && l.at >= since && (w == null || l.w === w)), ms);

// Long tasks on Technically Not's own page.
const long = [];
new PerformanceObserver(l =>
  l.getEntries().forEach(e => long.push({ at: e.startTime, d: e.duration }))
).observe({ type: 'longtask' });
const longSince = t => {
  const l = long.filter(x => x.at >= t);
  return {
    n: l.length,
    worst: Math.round(Math.max(0, ...l.map(x => x.d))),
    total: Math.round(l.reduce((a, x) => a + x.d, 0)),
  };
};

// Real key presses into the composer: how late each keydown ran.
async function typing(label, text) {
  const prompt = document.getElementById('prompt');
  prompt.focus();
  await wait(100);
  if (document.activeElement !== prompt) {
    info(label, 'composer not focusable');
    return null;
  }
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  const lates = [],
    onKey = e => lates.push(performance.now() - e.timeStamp);
  prompt.addEventListener('keydown', onKey);
  const keys = [];
  for (const ch of text) {
    const code = ch === ' ' ? 'Space' : ch.toUpperCase();
    keys.push(
      { type: 'keyDown', keyCode: code, wait: 5 },
      { type: 'char', keyCode: ch, wait: 5 },
      { type: 'keyUp', keyCode: code, wait: 45 }
    );
  }
  const t = performance.now();
  await input(keys);
  await wait(200);
  prompt.removeEventListener('keydown', onKey);
  const typed = prompt.value.length;
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  const r = {
    typed,
    keys: lates.length,
    p50: pct(lates, 0.5),
    p95: pct(lates, 0.95),
    max: Math.round(Math.max(0, ...lates)),
    long: longSince(t),
  };
  info(label + ' input delay', r);
  check(typed === text.length, label + ': every key reached the composer');
  return r;
}

const api = window.TnaiLivePreview,
  LPP = window.TnaiLivePreviewPage,
  G = window.TnaiAgents;
let serverTab = null,
  paneIds = [];
try {
  const setup = await main('setup');
  info('project', setup);
  const page = document.getElementById('livePreviewPage');
  LPP.open();
  await wait(400);
  const lp = await until(() => page.querySelector('.lpp-stage .lp'));
  check(!!lp, 'Live preview page open, preview mounted');
  const stage = () => lp.querySelector('.lp-stage'),
    strip = lp.querySelector('.lp-tabs');
  const devBtn = await until(async () => {
    if (page.querySelector('.lpp-menu')?.hidden !== false) page.querySelector('.lpp-run')?.click();
    await wait(200);
    return [...page.querySelectorAll('.lpp-menu .lpp-mrow')]
      .find(r => r.querySelector('b')?.textContent === 'dev')
      ?.querySelector('.lp-go');
  }, 60000);
  check(!!devBtn, 'dev script offered in the ▶ Run menu');

  // Without it nothing below can run: say so once instead of failing on a missing button.
  if (!devBtn)
    throw new Error(
      'the ▶ Run menu did not offer the dev script within 60 s of the project copy (' +
        setup.files +
        ' files)'
    );

  // ---- 1. Start → URL detected → page shown.
  let tRun = 0,
    tSrc = 0;
  const off = api.onChange(() => {
    if (!tRun && api.tabs()[0]?.state === 'running') tRun = performance.now();
  });
  const srcWatch = new MutationObserver(() => {
    if (!tSrc && lp.querySelector('.lp-frame[src]')) tSrc = performance.now();
  });
  srcWatch.observe(lp, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  const tClick = performance.now();
  devBtn.click();
  const running = await until(() => api.tabs()[0]?.state === 'running' && api.tabs()[0], 30000);
  check(!!running, 'URL detected: ' + running?.url);
  serverTab = running;
  const first = await nextLoad('/', tClick, 30000);
  check(!!first, 'website copy loaded in the preview');
  off();
  srcWatch.disconnect();
  const origin = new URL(running.url).origin;
  const startNums = {
    clickToUrl: Math.round(tRun - tClick),
    urlToSrc: Math.round(tSrc - tRun),
    srcToLoad: first ? Math.round(first.at - tSrc) : null,
  };
  info('start', startNums);

  // ---- 2. 20 saves in 5 s (the dev server reloads the page per change, debounced 30 ms).
  await wait(800);
  const reloads = async () =>
    +((await window.TnaiTest.request(origin + '/__reloads')).text || 'NaN');
  const reloadsBefore = await reloads();
  const tEdit = performance.now();
  const lastEditWall = await main('edits', 20, 250);
  const tLastEdit = performance.now() - (Date.now() - lastEditWall);
  await until(
    () => {
      const l = loadsOf('/', tEdit);
      return (
        l.length &&
        performance.now() - l[l.length - 1].at > 1500 &&
        performance.now() - tLastEdit > 1500
      );
    },
    20000,
    50
  );
  const editLoads = loadsOf('/', tEdit),
    reloadsSent = (await reloads()) - reloadsBefore;
  const editNums = {
    saves: 20,
    serverReloads: reloadsSent,
    pageLoads: editLoads.length,
    lastSaveToLoad: editLoads.length
      ? Math.round(editLoads[editLoads.length - 1].at - tLastEdit)
      : null,
    long: longSince(tEdit),
  };
  info('rapid edits', editNums);
  check(
    editLoads.length >= 1 && editLoads.length <= reloadsSent + 1,
    "the preview adds no reloads of its own to the dev server's (" +
      editLoads.length +
      ' loads for ' +
      reloadsSent +
      ' reload events)'
  );

  // ---- 3. Device presets: each switch reloads the page exactly once (new user agent), with the
  // device's viewport.
  const mode = d => lp.querySelector('.lp-modes [data-device="' + d + '"]');
  const widths = { tablet: 820, phone: 393 };
  const sw = [],
    perSwitch = [];
  for (let r = 0; r < 3; r++)
    for (const d of ['tablet', 'phone', 'desktop']) {
      const c0 = await main('calls'),
        t = performance.now();
      mode(d).click();
      const hit = await nextLoad('/', t, 10000, widths[d]);
      await wait(700);
      sw.push(hit ? Math.round(hit.at - t) : 99999);
      perSwitch.push(loadsOf('/', t).length);
      const c1 = await main('calls');
      if (r === 0)
        info('switch → ' + d, {
          ms: hit ? Math.round(hit.at - t) : null,
          loads: loadsOf('/', t).length,
          emulateCalls: c1.set - c0.set,
          w: hit?.w,
        });
    }
  info('device switches (9)', {
    p50: pct(sw, 0.5),
    max: Math.max(...sw),
    loadsPerSwitch: perSwitch.join(','),
  });
  check(
    perSwitch.every(n => n === 1),
    'each device switch reloads the page exactly once'
  );

  // Size change within Phone (same iPhone user agent).
  mode('phone').click();
  await nextLoad('/', performance.now() - 10, 10000, 393);
  await wait(500);
  {
    const sel = lp.querySelector('.lp-size'),
      c0 = await main('calls'),
      t = performance.now();
    sel.value = 'se';
    sel.dispatchEvent(new Event('change'));
    const hit = await nextLoad('/', t, 8000, 375);
    await wait(700);
    info('phone size i15 → se', {
      ms: hit ? Math.round(hit.at - t) : null,
      loads: loadsOf('/', t).length,
      emulateCalls: (await main('calls')).set - c0.set,
    });
  }

  // ---- 4. Window resizes in Phone mode (the frame is scaled to fit): layout only, no reloads, no
  // emulation calls.
  let stripRenders = 0,
    layoutWrites = 0;
  const mo = new MutationObserver(list =>
    list.forEach(m => {
      if (m.type === 'childList' && m.target === strip) stripRenders++;
      else if (m.type === 'attributes') layoutWrites++;
    })
  );
  mo.observe(lp, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  {
    const c0 = await main('calls'),
      t = performance.now();
    await main('resizeSteps', 30, 360, 200, 16);
    await wait(400);
    info('window resize (60 steps)', {
      loads: loadsOf('/', t).length,
      emulateCalls: (await main('calls')).set - c0.set,
      stripRenders,
      layoutWrites,
      long: longSince(t),
    });
    check(
      !loadsOf('/', t).length && (await main('calls')).set === c0.set,
      'resizing never reloads the page or calls the emulation'
    );
  }
  mo.disconnect();

  // ---- 5. Pop out and dock ×3 (the iframe reloads in the other document; nothing may be left
  // behind).
  {
    const f0 = () => lp.querySelector('.lp-frame-shell:not([hidden]) .lp-frame');
    const c0 = await main('calls'),
      times = [];
    for (let i = 0; i < 3; i++) {
      let before = f0()?.dataset.loaded,
        t = performance.now();
      LPP.popOut();
      await until(async () => (await main('popouts')) === 1, 5000, 50);
      await until(
        () =>
          lp.ownerDocument !== document && f0()?.dataset.loaded && f0().dataset.loaded !== before,
        10000
      );
      times.push(['pop', ms(t)]);
      before = f0()?.dataset.loaded;
      t = performance.now();
      if (i === 2) await main('closePopout');
      else LPP.dock();
      await until(
        async () => (await main('popouts')) === 0 && lp.ownerDocument === document,
        5000,
        50
      );
      await until(() => f0()?.dataset.loaded && f0().dataset.loaded !== before, 10000);
      times.push([i === 2 ? 'close' : 'dock', ms(t)]);
      await wait(300);
    }
    const c1 = await main('calls');
    info('pop-out/dock ×3 (ms to page loaded)', {
      times: times.map(x => x.join(' ')).join(', '),
      emulateCalls: c1.set - c0.set,
      forgets: c1.forget - c0.forget,
      emulationSessions: c0.sessions + ' → ' + c1.sessions,
      frames: document.querySelectorAll('.lp-frame').length,
    });
    check(
      document.querySelectorAll('.lp-frame').length === 1 && lp.ownerDocument === document,
      'docked again with exactly one preview iframe'
    );
    check(
      c1.sessions <= c0.sessions,
      'no emulation sessions left behind by closed pop-out windows (' +
        c0.sessions +
        ' → ' +
        c1.sessions +
        ')'
    );
  }
  mode('desktop').click();
  await wait(1500);

  // ---- 6. Five preview tabs: each loads, switching keeps each page (no reload), closing frees the
  // frames.
  const heavy = ['dom', 'images', 'anim', 'js'];
  const tabIds = [],
    loadMs = {};
  const u0 = await main('usageStart');
  await wait(1500);
  const idle = await main('usageStop');
  info('app usage, 1 tab (website)', idle);
  for (const h of heavy) {
    const t = performance.now(),
      r = api.addUrl(origin + '/__heavy/' + h + '.html');
    tabIds.push(r.id);
    const hit = await nextLoad('/__heavy/' + h + '.html', t, 20000);
    loadMs[h] = hit ? Math.round(hit.at - t) : null;
    check(!!hit, h + ' page loaded');
  }
  info('heavy page load ms', loadMs);
  check(document.querySelectorAll('.lp-frame').length === 5, '5 tabs → 5 iframes');
  {
    const ids = [serverTab.id ? api.tabs()[0].id : '', ...tabIds].filter(Boolean),
      t = performance.now(),
      times = [];
    for (let i = 0; i < 15; i++) {
      const t1 = performance.now();
      api.select(ids[i % ids.length]);
      await frame2();
      times.push(ms(t1));
      await wait(100);
    }
    info('tab switches ×15', {
      p50: pct(times, 0.5),
      max: Math.max(...times),
      reloads: loads.filter(l => l.at >= t).length,
      long: longSince(t),
    });
    check(!loads.filter(l => l.at >= t).length, 'switching tabs never reloads a page');
  }
  api.select(tabIds[3]);
  await wait(500); // the busy-JS page in front
  await main('usageStart');
  await wait(3000);
  info('app usage, 5 tabs (busy JS shown)', await main('usageStop'));
  const alone = await typing('busy page shown, 5 tabs', 'the preview runs a busy page ');

  // ---- 7. The busy page on the Live preview page + 4 PowerShell threads streaming behind it.
  for (let i = 0; i < 4; i++) {
    try {
      paneIds.push((await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId);
    } catch (error) {
      info('a PowerShell thread did not start', error?.message || String(error));
    }
  }
  check(paneIds.length === 4, '4 PowerShell threads running');
  LPP.open();
  await wait(1500);
  check(
    LPP.visible() && !!lp.querySelector('.lp-frame-shell:not([hidden])'),
    'back on the Live preview page with the busy page shown'
  );
  const E = '$([char]27)';
  const loop = `$i=0; while($i -lt 100000){ $i++; Write-Host "${E}[32m● Working${E}[0m ${E}[2mEdited src/app.js · step $i · ${E}[36m$(Get-Random)${E}[0m"; if($i % 20 -eq 0){ Start-Sleep -Milliseconds 15 } }`;
  paneIds.forEach(id => G.send(id, loop));
  await wait(1500);
  await main('usageStart');
  await main('profileStart');
  const busy = await typing(
    'busy page + 4 streaming panels',
    'refactor the login flow and add tests '
  );
  const prof = await main('profileStop');
  const usage = await main('usageStop');
  info('app usage, busy page + 4 streaming panels', usage);
  for (const k of ['renderer', 'main'])
    log.push(
      '--- ' + k + ' CPU (' + prof[k].total + ' ms sampled) by file:',
      ...prof[k].files,
      '--- by function:',
      ...prof[k].fns
    );
  info('renderer heap MB', Math.round(performance.memory.usedJSHeapSize / 1048576));
  check(
    !busy || busy.p95 < 150,
    'composer input delay p95 < 150 ms with the busy page + 4 streaming panels (' + busy?.p95 + ')'
  );

  // ---- Close the heavy tabs: frames and emulation entries are released.
  {
    const c0 = await main('calls'),
      p0 = (await main('usageStop')).processes;
    for (const id of tabIds)
      (lp.querySelector('.lp-tab[data-id="' + id + '"] .lp-tab-close')?.click(), await wait(100));
    await wait(1500);
    const c1 = await main('calls'),
      p1 = (await main('usageStop')).processes;
    info('closed 4 tabs', {
      frames: document.querySelectorAll('.lp-frame').length,
      forgets: c1.forget - c0.forget,
      processesBefore: p0,
      processesAfter: p1,
    });
    check(
      document.querySelectorAll('.lp-frame').length === 1 && c1.forget - c0.forget === 4,
      'closing tabs removes their iframes and forgets their emulation'
    );
  }
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}

// ---- Cleanup: stop the streaming threads and the dev server; its port stops answering.
try {
  paneIds.forEach(id => G.stop(id));
  if (serverTab) {
    await api.stop(api.tabs().find(t => t.kind === 'script')?.id);
    const dead = await until(
      async () => {
        try {
          await fetch(serverTab.url, { cache: 'no-store' });
          return false;
        } catch {
          return true;
        }
      },
      10000,
      200
    );
    check(!!dead, 'dev server stopped');
  }
  await wait(500);
} catch (error) {
  check(false, 'cleanup: ' + error.message);
}
window.removeEventListener('message', onMsg);
return { ok, log };
