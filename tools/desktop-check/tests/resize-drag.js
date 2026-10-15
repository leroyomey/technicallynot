// Technically Not tools · desktop-check/tests/resize-drag.js — How long the window stops drawing
// while its edge is dragged (a lag spike when a small window is made bigger). With eight PowerShell
// threads open it drags the window from small to large and back in 16 ms steps, on the Threads page
// and on All threads, once over sizes that change the zoom (main.js fitZoom) and once over sizes
// that keep it. Per drag: the longest gap between two frames, each gap over 100 ms with the zoom at
// that moment, the time in long tasks, resize events, zoom changes, how many sizes each pty was
// sent in one drag (each makes an agent CLI redraw its whole screen), and the functions that used
// the time. Real renderer (RENDERER_TESTS in run.js). Returns {ok, log}.
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
    const id = 'd' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const SMALL = [820, 700],
  LARGE = [1700, 1000],
  SAME = [1460, 920]; // SMALL → LARGE crosses both zoom steps; SAME → LARGE stays at one zoom

async function drag(label, from, to) {
  await main('size', ...from);
  await wait(900);
  let maxGap = 0,
    last = performance.now(),
    on = true,
    long = 0,
    longest = 0,
    resizes = 0,
    frames = 0;
  const gaps = [];
  const tick = now => {
    if (!on) return;
    const g = now - last;
    if (g > maxGap) maxGap = g;
    if (g > 100) gaps.push(Math.round(g) + '@' + devicePixelRatio.toFixed(2));
    last = now;
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const po = new PerformanceObserver(l =>
    l.getEntries().forEach(e => {
      long += e.duration;
      if (e.duration > longest) longest = e.duration;
    })
  );
  try {
    po.observe({ entryTypes: ['longtask'] });
  } catch {}
  const onResize = () => resizes++;
  addEventListener('resize', onResize);
  await main('takeResizes');
  await main('profileStart');
  const t0 = performance.now();
  const out = await main('drag', ...from, ...to, 60);
  await wait(700);
  const sent = await main('takeResizes');
  const back = await main('drag', ...to, ...from, 60);
  await wait(700);
  const ms = Math.round(performance.now() - t0);
  const p = await main('profileStop');
  on = false;
  po.disconnect();
  removeEventListener('resize', onResize);
  const r = { maxGap: Math.round(maxGap), long: Math.round(long), longest: Math.round(longest) };
  log.push(
    'info ' +
      label +
      ': longest frame gap ' +
      r.maxGap +
      ' ms · longest task ' +
      r.longest +
      ' ms · long tasks ' +
      r.long +
      ' ms in total · ' +
      resizes +
      ' resize events · zoom changed ' +
      (out.changes + back.changes) +
      ' times · ' +
      frames +
      ' frames in ' +
      ms +
      ' ms · script busy ' +
      p.busy +
      ' of ' +
      p.total +
      ' ms · sizes sent to a pty in the one drag out: ' +
      (sent.length
        ? Math.max(...sent) + ' at most per panel, ' + sent.reduce((a, b) => a + b, 0) + ' in all'
        : 'none'),
    '     gaps over 100 ms (ms@zoom): ' + (gaps.join(' ') || 'none'),
    '     by function, with what it calls: ' + p.fnIncl.slice(0, 10).join(' | '),
    '     by function, own time: ' + p.fnSelf.slice(0, 8).join(' | ')
  );
  return r;
}

// What one real resize step costs to lay out: the first layout read in a resize event (a capture
// listener runs before the page's own), median of 6 steps at one zoom. Then the same with one large
// part of the page taken out (display:none), which says where the layout time goes.
const name = el =>
  el.id
    ? '#' + el.id
    : el.tagName.toLowerCase() +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '');

async function layoutMs() {
  const times = [],
    h = () => {
      const s = performance.now();
      void document.body.offsetWidth;
      times.push(performance.now() - s);
    };
  addEventListener('resize', h, true);
  for (let i = 0; i < 6; i++) {
    await main('size', 1500 + (i % 2) * 60, 940);
    await wait(140);
  }
  removeEventListener('resize', h, true);
  times.sort((a, b) => a - b);
  return times.length ? Math.round(times[times.length >> 1] * 10) / 10 : -1;
}

async function layoutParts(page) {
  const all = document.querySelectorAll('body *').length,
    base = await layoutMs();
  const parts = [...document.querySelectorAll('body *')]
    .filter(el => el.getClientRects().length && !el.closest('.xterm'))
    .map(el => [el, el.querySelectorAll('*').length])
    .filter(
      ([el, n]) =>
        n >= 120 && n < 0.9 * (el.parentElement?.querySelectorAll('*').length || Infinity)
    )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const rows = [];
  for (const [el, n] of parts) {
    const was = el.style.getPropertyValue('display'),
      pri = el.style.getPropertyPriority('display');
    el.style.setProperty('display', 'none', 'important');
    await wait(60);
    const ms = await layoutMs();
    if (was) el.style.setProperty('display', was, pri);
    else el.style.removeProperty('display');
    await wait(60);
    rows.push(name(el) + ' (' + n + ' nodes): ' + ms + ' ms without it');
  }
  log.push(
    'info ' +
      page +
      ': one resize step lays out in ' +
      base +
      ' ms (' +
      all +
      ' nodes in the page)',
    ...rows.map(r => '     ' + r)
  );
}
try {
  const G = window.TnaiAgents;
  for (let i = 0; i < 8; i++) await window.TnaiTest.open('Terminal');
  await wait(3000);
  check(
    G.sessions().filter(s => s.running).length >= 8,
    'setup: 8 PowerShell panels running (' + G.sessions().filter(s => s.running).length + ')'
  );
  const res = {};
  for (const page of ['Threads', 'All threads page']) {
    // what the three-dots menu's rows call
    if (page === 'Threads') window.TnaiThreads.open();
    else check(await window.TnaiTest.openAllThreads(), 'All threads page shown');
    await wait(1000);
    res[page + ' same'] = await drag(page + ', drag at one zoom', SAME, LARGE);
    res[page + ' zoom'] = await drag(page + ', drag across the zoom steps', SMALL, LARGE);
    await layoutParts(page);
  }
  const worst = Math.max(...Object.values(res).map(r => r.maxGap));
  check(
    worst < 250,
    'no single freeze of a quarter second or more while dragging (' +
      Object.entries(res)
        .map(([k, r]) => k + ' ' + r.maxGap)
        .join(' / ') +
      ' ms)'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
await main('size', 1440, 900).catch(() => {});
return { ok, log };
