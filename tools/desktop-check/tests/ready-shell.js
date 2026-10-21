/*
 * Technically Not tools · desktop-check/tests/ready-shell.js — The PowerShell kept ready (Settings
 * › General, 10 `warmShell`, main `pty:warm`) starts only after the first PowerShell of the app
 * session, not while the app loads (it held the main process at start): none is kept ready 7 s
 * after the load, also with the setting on; the first PowerShell thread starts at its normal speed
 * and one is kept ready after it; the second PowerShell thread takes that one over, its prompt
 * there as it starts. Two real PowerShell threads, stopped at the end. Windows only. Uses
 * ready-shell.main.js. Returns {ok, log}.
 */
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000, step = 100) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(step);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const native = window.tnaiNative;
const agents = window.TnaiAgents;
const ANSI =
  /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g;
const started = [];
const before = window.TnaiSettings?.get?.('readyShell');

// Starts one PowerShell thread; marks are ms after the start: its process running, its first
// prompt.
const startShell = async () => {
  const seen = new Set(agents.sessions().map(s => s.paneId));
  const marks = {};
  const tails = new Map();
  let paneId = '';
  const t0 = performance.now();
  const mark = key => {
    if (marks[key] === undefined) marks[key] = performance.now() - t0;
  };
  const off = native.pty.onData(({ paneId: from, data }) => {
    if (seen.has(from) || (paneId && from !== paneId)) return;
    const text = ((tails.get(from) || '') + String(data).replace(ANSI, '')).slice(-4000);
    tails.set(from, text);
    if (/>\s*$/.test(text)) mark('prompt');
  });
  const tick = setInterval(() => {
    const s = agents.sessions().find(x => !seen.has(x.paneId) && x.agent === 'Terminal');
    if (s?.running) {
      paneId = s.paneId;
      mark('running');
    }
  }, 4);
  const result = await window.TnaiTest.startThread({ tool: 'Terminal' });
  paneId = result.paneId;
  started.push(paneId);
  await until(() => marks.prompt !== undefined, 15000, 20);
  clearInterval(tick);
  off();
  return marks;
};
const ms = value => (value === undefined ? '-' : String(Math.round(value)));

try {
  if (!window.tnaiPlatform?.win) {
    log.push('     not Windows: there is no PowerShell kept ready');
  } else {
    // The load's old wait was 4 s; 7 s after the load leaves room on a busy PC.
    await until(() => performance.now() > 7000, 10000, 200);
    check(
      (await main('ready')) === null,
      'no PowerShell kept ready ' + Math.round(performance.now() / 1000) + ' s after the load'
    );

    // The setting turned on (on by default) before any PowerShell started: still none.
    window.TnaiSettings?.set?.('readyShell', true);
    await wait(2500);
    check(
      (await main('ready')) === null,
      'turning the setting on before any PowerShell starts none'
    );

    const first = await startShell();
    log.push(
      '     first PowerShell: running ' +
        ms(first.running) +
        ' ms, prompt ' +
        ms(first.prompt) +
        ' ms'
    );
    check(first.prompt !== undefined, 'the first PowerShell thread reached its prompt');
    const kept = await until(() => main('ready'), 12000, 300);
    check(!!kept, 'one PowerShell is kept ready after the first PowerShell started');

    // It reaches its own first prompt before the next start.
    await wait(3000);
    const second = await startShell();
    log.push(
      '     second PowerShell: running ' +
        ms(second.running) +
        ' ms, prompt ' +
        ms(second.prompt) +
        ' ms'
    );
    const gap = (second.prompt ?? Infinity) - (second.running ?? 0);
    const coldGap = (first.prompt ?? Infinity) - (first.running ?? 0);
    check(
      gap <= 100,
      'the second PowerShell took the kept one: prompt there as it starts (' +
        Math.round(gap) +
        ' ms after; the first: ' +
        Math.round(coldGap) +
        ' ms)'
    );
    const next = await until(
      async () => {
        const r = await main('ready');
        return r && r.id !== kept?.id ? r : null;
      },
      12000,
      300
    );
    check(!!next, 'the kept one was taken and the next one is kept ready');
  }
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
for (const id of started) await agents.stop(id).catch(() => {});
check(
  !!(await until(
    () => !agents.sessions().some(s => started.includes(s.paneId) && s.running),
    8000
  )),
  'opened PowerShell threads stopped'
);
window.TnaiSettings?.set?.('readyShell', before !== false);
await main('drop').catch(() => {});
return { ok, log };
