/*
 * Technically Not tools · desktop-check/tests/limit-idle-lag.js — Lag after agents sit at their
 * usage limit (seen with about 12 Claude Code agents limited for hours, the window too
 * slow to type in by the time usage came back). PANES PowerShell panels run a FAKE CLI
 * (limit-idle-lag.main.js writes it; no agent CLI, no usage) that prints a Claude Code style
 * "5-hour limit reached ∙ resets" line, then redraws a small status area every second (half of them
 * with the limit phrase inside the redrawn area); 15 detects the limit, 72 plans the resume. The
 * window stays on Overview for IDLE_MS while renderer counters are read at start / middle / end
 * (DOM nodes, JS listeners, heap after GC, timers of 1 s or more created by the app since the test
 * began and still pending, long tasks, event-loop lag) plus a CPU profile of the idle limited
 * period; then every panel is resumed in the same second (72 fire, as when one account's limit
 * resets) and the burst is measured. Growth over the idle period beyond GROWTH fails. Returns {ok,
 * log}.
 */
const PANES = 6;
const IDLE_MS = 150000;
const TICK_MS = 1000;
const GROWTH = { nodes: 400, listeners: 60, heapMB: 12, timers: 20 };

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
    await wait(100);
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
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 60000);
  });

window.__tnaiDomRenderer = false;
try {
  localStorage.removeItem('tnai.test.dom-renderer');
} catch {}
const G = window.TnaiAgents,
  R = window.TnaiLimitResume,
  ACC = window.TnaiAccounts;

// Timers the app creates from now on, by call site: pending timeouts and live intervals.
const live = new Map(); // id -> site
const site = () => {
  const l =
    (new Error().stack || '')
      .split('\n')
      .slice(3)
      .find(x => /src[\\/]scripts|\.js/.test(x) && !/limit-idle-lag/.test(x)) || '?';
  return (l.match(/([\w.-]+\.js):(\d+)/) || [])[0] || l.trim().slice(0, 60);
};
const [sT, cT, sI, cI] = [
  window.setTimeout,
  window.clearTimeout,
  window.setInterval,
  window.clearInterval,
];
const mine = new Set();
window.setTimeout = function (fn, ms, ...a) {
  const s = site();
  let id;
  id = sT.call(
    window,
    function () {
      live.delete(id);
      return typeof fn === 'function' ? fn.apply(this, arguments) : undefined;
    },
    ms,
    ...a
  );
  if (+ms >= 1000) live.set(id, 'T ' + s);
  return id;
};
window.clearTimeout = id => {
  live.delete(id);
  return cT.call(window, id);
};
window.setInterval = function (fn, ms, ...a) {
  const id = sI.call(window, fn, ms, ...a);
  live.set(id, 'I ' + site());
  return id;
};
window.clearInterval = id => {
  live.delete(id);
  return cI.call(window, id);
};
const timerTop = () => {
  const m = new Map();
  for (const s of live.values()) m.set(s, (m.get(s) || 0) + 1);
  return [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => v + '× ' + k)
    .join(' | ');
};

// Long tasks and event-loop lag (a 100 ms sampler's worst delay), per window.
const longs = [];
new PerformanceObserver(l =>
  l.getEntries().forEach(e => longs.push({ at: performance.now(), ms: e.duration }))
).observe({ type: 'longtask' });
const lags = [];
let last = performance.now();
sI.call(
  window,
  () => {
    const t = performance.now();
    lags.push({ at: t, ms: t - last - 100 });
    last = t;
  },
  100
);
const windowStats = from => {
  const L = longs.filter(x => x.at >= from),
    G2 = lags.filter(x => x.at >= from).map(x => x.ms);
  return (
    'long tasks ' +
    L.length +
    ' (max ' +
    Math.round(Math.max(0, ...L.map(x => x.ms))) +
    ' ms, total ' +
    Math.round(L.reduce((s, x) => s + x.ms, 0)) +
    ' ms) · loop lag max ' +
    Math.round(Math.max(0, ...G2)) +
    ' ms'
  );
};
const snap = async label => {
  const c = await main('counters');
  c.timers = live.size;
  log.push(
    'info ' +
      label +
      ': nodes ' +
      c.nodes +
      ' · listeners ' +
      c.listeners +
      ' · heap ' +
      c.heapMB +
      ' MB · app timers pending ' +
      c.timers +
      ' · ' +
      timerTop()
  );
  return c;
};

const ids = [];
try {
  window.TnaiThreads.open();
  const fake = await main('fake');
  for (let i = 0; i < PANES; i++) {
    const r = await window.TnaiTest.open('Terminal');
    if (!r?.ok) throw new Error('panel ' + i + ' did not open');
    ids.push(r.paneId);
  }
  await wait(2500);
  ids.forEach((id, i) => G.send(id, "node '" + fake + "' " + TICK_MS + (i % 2 ? ' box' : '')));
  const limited = await until(() => ids.every(id => ACC.limitFor(id)), 20000);
  check(!!limited, 'every panel detected at its usage limit (15)');
  check(
    !!(await until(() => ids.every(id => R.pending().some(p => p.paneId === id)), 10000)),
    'a resume is planned for every panel (72)'
  );
  await wait(3000);

  await main('heapDiff');
  const t0 = performance.now(),
    a = await snap('start (limited)');
  await wait(IDLE_MS / 2 - 15000);
  await main('profileStart');
  await wait(15000);
  const prof = await main('profileStop');
  const b = await snap('middle');
  await wait(IDLE_MS / 2);
  const c = await snap('end (limited ' + Math.round(IDLE_MS / 1000) + ' s)');
  log.push('info idle limited period: ' + windowStats(t0));
  log.push(
    'info heap growth by constructor over the idle period: ' + (await main('heapDiff')).join(' | ')
  );
  log.push('info idle CPU profile (15 s): ' + JSON.stringify(prof).slice(0, 1500));
  const grow = k => Math.round((c[k] - a[k]) * 10) / 10;
  for (const k of ['nodes', 'listeners', 'heapMB', 'timers'])
    check(
      grow(k) <= GROWTH[k],
      'idle growth ' + k + ' ' + grow(k) + ' (≤ ' + GROWTH[k] + '; middle ' + b[k] + ')'
    );
  check(
    ids.every(id => ACC.limitFor(id)),
    'still one limit per panel (no re-detection churn)'
  );

  // The reset: every panel of one account resumes in the same second.
  const t1 = performance.now();

  // worst case: all in the same second (fire() staggers them STAGGER ms apart)
  ids.forEach(id => R.fireNow(id));
  await wait(12000);
  await snap('after the simultaneous resume');
  log.push('info resume burst (12 s): ' + windowStats(t1));
  const got = await Promise.all(
    ids.map(async id =>
      /file-2\d\d\.js/.test((await window.tnaiNative.pty.replay(id))?.buffer || '')
    )
  );
  check(
    got.every(Boolean),
    'every fake CLI got the resume and printed its burst: ' +
      got.filter(Boolean).length +
      '/' +
      ids.length
  );
  await wait(20000);
  const e = await snap('20 s later');
  check(
    e.nodes - a.nodes <= GROWTH.nodes * 2 && e.listeners - a.listeners <= GROWTH.listeners * 2,
    'after the resume: nodes ' +
      (e.nodes - a.nodes) +
      ', listeners ' +
      (e.listeners - a.listeners) +
      ' over the start'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
for (const id of ids) {
  try {
    R?.cancel(id);
    G.stop(id);
  } catch {}
}
await wait(800);
await main('cleanup').catch(() => {});
window.setTimeout = sT;
window.clearTimeout = cT;
window.setInterval = sI;
window.clearInterval = cI;
return { ok, log };
