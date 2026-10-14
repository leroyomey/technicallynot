/*
 * Technically Not tools · desktop-check/tests/agent-soak.js — Hours of agent use, compressed and
 * light (what stress-soak doesn't do): CYCLES (TNAI_SOAK_CYCLES, default 24) of: open PANELS
 * PowerShell panels, print ~40 KB of Claude-Code-like output in each (a small node printer that
 * exits), play one simulated Claude Code task per panel over the real hook server (prompt, 6 tool
 * calls, a sub-agent with its own transcript, Stop; agent-soak.main.js), visit Overview / Agents /
 * Terminal, close the panels. Samples after cycle 2 (warm-up) and at the end, after a forced GC in
 * both processes: renderer heap, DOM nodes, listeners, app timers still pending, main heap, live
 * handles, per-pane stores and child processes. Growth past the warm-up beyond LIMIT fails. No
 * agent CLI, no prompt to a model, no load: one printer per panel at a time, ~5 s per cycle (24
 * cycles ≈ 2 min). Returns {ok, log}. Found 2026-09-29: one MessagePort handle and ~6 MB main RSS
 * per panel ever opened (node-pty's conout worker thread with useConptyDll is never terminated).
 */
const PANELS = 3;
const ANSI_CODES = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -\\/]*[@-~]', 'g');
const LIMIT = {
  heapMB: 6,
  nodes: 300,
  listeners: 60,
  timers: 15,
  mainHeapMB: 8,
  mainRssMB: 80,
  handles: 6,
  hookEvents: 400,
  turns: 0,
  hookFiles: 0,
  children: 0,
};

const log = [],
  T0 = window.setTimeout,
  // the test's own waits stay out of the timer count
  wait = ms => new Promise(r => T0.call(window, r, ms));
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
  });
const G = window.TnaiAgents,
  route = v => (v === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(v));

// Timers the app creates from now on and still pending (timeouts of 1 s or more, every interval),
// by call site.
const live = new Map();
const site = () => {
  const l =
    (new Error().stack || '')
      .split('\n')
      .slice(3)
      .find(x => /\.js/.test(x) && !/agent-soak/.test(x)) || '?';
  return (l.match(/([\w.-]+\.js):(\d+)/) || [])[0] || l.trim().slice(0, 60);
};
const [sT, cT, sI, cI] = [
  window.setTimeout,
  window.clearTimeout,
  window.setInterval,
  window.clearInterval,
];
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
    .slice(0, 5)
    .map(([k, v]) => v + '× ' + k)
    .join(' | ');
};
const sample = async label => {
  const s = await main('sample');
  s.timers = live.size;
  log.push(
    'info ' +
      label +
      ': renderer heap ' +
      s.heapMB +
      ' MB · nodes ' +
      s.nodes +
      ' · listeners ' +
      s.listeners +
      ' · timers ' +
      s.timers +
      ' · main heap ' +
      s.mainHeapMB +
      ' MB rss ' +
      s.mainRssMB +
      ' MB · handles ' +
      s.handles +
      ' ' +
      JSON.stringify(s.handlesBy) +
      ' · hook events ' +
      s.hookEvents +
      ' · turns ' +
      s.turns +
      ' · lifecycle ' +
      s.instances +
      ' instances / ' +
      s.tasks +
      ' tasks · hook files ' +
      s.hookFiles +
      ' · children ' +
      s.children +
      ' ' +
      JSON.stringify(s.childrenBy)
  );
  return s;
};

const open = new Set();
let a = null;
try {
  const cycles = await main('cycles'),
    printer = await main('printer'),
    t0 = performance.now();
  route('overview');
  await wait(500);
  for (let i = 0; i < cycles; i++) {
    const ids = [];
    const cycleStart = performance.now();
    const parts = [];
    const part = name => parts.push(name + ' ' + Math.round(performance.now() - cycleStart));
    for (let k = 0; k < PANELS; k++) {
      const r = await window.TnaiTest.open('Terminal');
      if (!r?.ok) throw new Error('cycle ' + i + ': panel did not open (' + r?.error + ')');
      ids.push(r.paneId);
      open.add(r.paneId);
    }
    await until(
      () => ids.every(id => G.sessions().some(s => s.paneId === id && s.running === true)),
      20000
    );
    part('started');

    // Each shell's first prompt, read from its record: a thread starts faster than the old page's
    // new panel did, and a command sent before the prompt is lost.
    const promptShown = record => {
      const text = String(record?.buffer || '').replace(ANSI_CODES, '');
      return />\s*$|[$#]\s*$/.test(text);
    };
    await until(
      async () =>
        (await Promise.all(ids.map(id => window.tnaiNative.pty.replay(id)))).every(promptShown),
      15000
    );
    await wait(300);
    part('prompts');
    ids.forEach(id => G.send(id, "node '" + printer + "' 300"));
    await Promise.all(ids.map(id => main('turn', id, i)));
    if (i === 0) {
      const p = await main('peek', ids);
      check(
        p.turns >= PANELS && p.ended >= PANELS && p.hookEvents > 0,
        'the simulated tasks reached the app: ' + JSON.stringify(p)
      );
    }
    await until(
      async () =>
        (await Promise.all(ids.map(id => window.tnaiNative.pty.replay(id)))).every(r =>
          /Done/.test(r?.buffer || '')
        ),
      10000
    );
    part('printed');
    route('overview');
    await wait(250);
    route('agents');
    await wait(250);
    route('terminal');
    await wait(150);
    for (const id of ids) {
      document
        .querySelector(
          '.terminal-pane[data-pane-id="' +
            CSS.escape(id) +
            '"] .terminal-pane-tools button[title="Close terminal"]'
        )
        ?.click();
      open.delete(id);
    }
    await until(
      () =>
        !ids.some(id =>
          document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]')
        ) && !G.sessions().some(s => ids.includes(s.paneId) && s.running),
      10000
    );
    part('closed');
    if (i < 2)
      log.push('info cycle ' + (i + 1) + ', ms at the end of each part: ' + parts.join(', '));
    if (i % 6 === 5) await main('progress', 'cycle ' + (i + 1) + '/' + cycles);
    if (i === 1) {
      await wait(1500);
      a = await sample('after warm-up (2 cycles)');
    }
  }
  route('overview');
  await wait(3000); // let exits, saves and fades settle
  const b = await sample(
    'end (' +
      cycles +
      ' cycles, ' +
      cycles * PANELS +
      ' panels, ' +
      Math.round((performance.now() - t0) / 1000) +
      ' s)'
  );
  log.push('info timers still pending at the end: ' + (timerTop() || 'none'));
  const per = cycles - 2;
  for (const k of Object.keys(LIMIT)) {
    const g = Math.round((b[k] - a[k]) * 10) / 10;
    check(
      g <= LIMIT[k],
      k +
        ' growth over ' +
        per +
        ' cycles: ' +
        g +
        ' (≤ ' +
        LIMIT[k] +
        (per > 0 ? '; ' + Math.round((g / per) * 100) / 100 + ' per cycle' : '') +
        ')'
    );
  }
  check(
    b.children <= a.children,
    'no child process outlives its panel (' + a.children + ' → ' + b.children + ')'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
for (const id of open) {
  try {
    G.stop(id);
  } catch {}
}
await main('cleanup').catch(() => {});
window.setTimeout = sT;
window.clearTimeout = cT;
window.setInterval = sI;
window.clearInterval = cI;
return { ok, log };
