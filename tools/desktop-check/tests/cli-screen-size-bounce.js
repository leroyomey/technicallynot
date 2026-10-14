/*
 * Technically Not tools · desktop-check/tests/cli-screen-size-bounce.js — A terminal resized to a
 * smaller size and back before the pty hears of it (inside 10's 40 ms resize debounce) makes an
 * agent CLI draw its screen again (empty rows under the CLI's input box;
 * xterm had dropped the rows under the cursor and added empty ones, the program was never told).
 * One real PowerShell thread, first as a shell, then running the fake `claude` from
 * agent-mesh.main.js (no real CLI, no credits). The sizes sent to its pty are recorded on the main
 * side: after such a bounce a shell gets none (its rows would only repeat), an agent CLI gets one
 * row less and its size again. The terminal is the CLI screen of the session's thread (120),
 * which is where a user sees one now. Returns {ok, log}.
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
    await wait(80);
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
const N = window.tnaiNative,
  G = window.TnaiAgents;
const windows = /Windows/.test(navigator.userAgent);
const strip = s =>
  String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '');
const text = async paneId => strip((await N.pty.replay(paneId))?.buffer);
const session = paneId => G.sessions().find(s => s.paneId === paneId);
const quiet = (paneId, ms = 1000) =>
  until(() => Date.now() - (session(paneId)?.lastOutputAt || 0) > ms, 8000);

try {
  const { bin } = await main('paths');
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  check(!!started.session?.running, 'PowerShell thread started');
  const A = started.paneId;

  // Its thread, on its CLI screen. The screen is chosen outright (what the row "CLI screen" of the
  // thread's menu does): once the fake claude runs below, the thread is a Claude Code thread and
  // would otherwise turn to its conversation.
  const view = window.TnaiThreadView;
  window.TnaiThreads.show(A);
  await until(() => view.shown() === A, 8000);
  view.setMode('term');
  const grid = window.TnaiThreads.slot('main').querySelector('.tnt-term');
  check(
    !!(await until(
      () => view.term()?.tnaiPaneId === A && view.term().element?.getClientRects().length,
      10000
    )),
    'its thread shows the CLI screen'
  );
  await until(async () => (await text(A)).includes(windows ? '>' : '$'), 20000);
  await quiet(A, 1200);
  if (!windows) {
    N.pty.write(A, 'export PATH="${TNAI_SHIM%/*}:' + bin + ':$PATH"\r');
    await wait(300);
    await quiet(A, 800);
  }
  await wait(600); // the panel's first size has reached the pty

  // Smaller and back in one task: both refits run at once (the text-size event refits every view in
  // place), so the pty's 40 ms debounce sees only the size it already has.
  const refit = () => window.dispatchEvent(new CustomEvent('tnai:terminal-font', { detail: {} }));
  const bounce = async () => {
    const before = G.ptySize.get(A);
    await main('clear');
    grid.style.height = Math.round(grid.getBoundingClientRect().height * 0.6) + 'px';
    grid.style.flex = 'none';
    void grid.offsetHeight;
    refit();
    const small = G.ptySize.get(A);
    grid.style.height = '';
    grid.style.flex = '';
    void grid.offsetHeight;
    refit();
    const after = G.ptySize.get(A);

    // Two seconds, not the half second a panel needed: in the CLI screen the request to draw anew
    // was sent 1.03 s after the bounce (measured 2026-10-13: the bounce at +26.98 s, one row less
    // at +28.01 s, the size again at +28.10 s). What was sent after half a second is logged too.
    await wait(500);
    const early = await main('resizes', A);
    await wait(1500);
    return { before, small, after, early, sent: await main('resizes', A) };
  };

  const shell = await bounce();
  log.push('info shell: ' + JSON.stringify(shell));
  check(
    !!shell.before &&
      shell.small?.rows < shell.before.rows &&
      shell.after?.rows === shell.before.rows &&
      shell.after.cols === shell.before.cols,
    'shell: the panel went to fewer rows and back (' +
      shell.before?.rows +
      ' → ' +
      shell.small?.rows +
      ' → ' +
      shell.after?.rows +
      ')'
  );
  check(
    shell.sent.length === 0,
    'shell: nothing is sent to its pty (' + (shell.sent.join(', ') || 'none') + ')'
  );

  N.pty.write(A, 'claude\r');
  check(
    !!(await until(() => session(A)?.agent === 'Claude Code')),
    'the fake claude runs in the panel as a Claude Code session'
  );
  await until(async () => (await text(A)).includes('FAKE-claude start'));
  await quiet(A, 800);
  const cli = await bounce(),
    s = cli.before;
  log.push('info agent CLI: ' + JSON.stringify(cli));
  check(
    !!s && cli.small?.rows < s.rows && cli.after?.rows === s.rows && cli.after.cols === s.cols,
    'agent CLI: the panel went to fewer rows and back (' +
      s?.rows +
      ' → ' +
      cli.small?.rows +
      ' → ' +
      cli.after?.rows +
      ')'
  );
  check(
    !!s && cli.sent.join(', ') === s.cols + 'x' + (s.rows - 1) + ', ' + s.cols + 'x' + s.rows,
    'agent CLI: its pty gets one row less and its size again, so it draws its screen anew (' +
      (cli.sent.join(', ') || 'none') +
      ')'
  );
  N.pty.write(A, 'quit\r');
} catch (e) {
  ok = false;
  log.push('FAIL threw: ' + (e?.stack || e));
}
return { ok, log };
