/*
 * Technically Not tools · desktop-check/tests/cli-screen-long-run.js — The CLI screen of an agent
 * that has worked a long time shows its screen when it is first opened, not only pieces of its
 * spinner (ISSUES "almost empty"). The main process keeps only the last 256 KB of a session's
 * output, and a long wait fills that with spinner updates alone. One thread runs
 * the fake `claude` from cli-screen-long-run.main.js (no real CLI, no credits), whose replay is
 * stood in for by about 250 KB of spinner text. Opening its CLI screen (120) must send the pty one
 * row less and its size again, and the fake CLI's redrawn screen must then be on screen.
 * Returns {ok, log}.
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
const session = paneId => G.sessions().find(s => s.paneId === paneId);

// what the screen holds, read from the terminal itself (the rows are drawn on a canvas)
const screenText = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < term.rows; row++)
    rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
  return rows.join('\n');
};

try {
  const { bin } = await main('paths');
  const windows = /Windows/.test(navigator.userAgent);
  const view = window.TnaiThreadView;

  // A first PowerShell thread is the one on screen. The second is never shown before the test
  // opens it, so no CLI screen of it is made yet. The fake claude is typed into it (a "Claude
  // Code" thread would start the real CLI, which this test never runs).
  const first = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
  await until(() => view.shown() === first.paneId, 8000);
  const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const A = started.paneId;
  await wait(1500);
  if (!windows) N.pty.write(A, 'export PATH="' + bin + ':$PATH"\r');
  N.pty.write(A, 'claude\r');
  check(
    !!(await until(() => session(A)?.agent === 'Claude Code')),
    'the fake claude runs in the second thread as a Claude Code session'
  );
  await wait(1500);

  // Its pty at the size its CLI screen will have (the first thread's screen is in the same
  // place): opening it then changes no size, the case where nothing else makes the CLI draw.
  const box = G.ptySize.get(first.paneId);
  G.ptySize.claim(A, { visible: () => true }, box.cols, box.rows);
  await until(async () => (await main('resizes', A)).includes(box.cols + 'x' + box.rows), 5000);
  await wait(1000);
  log.push('info its real output: ' + JSON.stringify(await main('raw', A)));

  // From here the panel's replay is the spinner tail alone, as after a long wait.
  await main('cut', A);
  await main('clear');
  check(view.shown() !== A && view.term()?.tnaiPaneId !== A, 'no CLI screen of it was made before');
  window.TnaiThreads.show(A);
  await until(() => view.shown() === A, 8000);
  view.setMode('term');
  check(
    !!(await until(
      () => view.term()?.tnaiPaneId === A && view.term().element?.getClientRects().length,
      10000
    )),
    'its thread shows the CLI screen'
  );
  const drawn = await until(() => /LONG-CLI screen redrawn/.test(screenText(view.term())), 6000);
  const sent = await main('resizes', A);
  log.push('info screen: ' + JSON.stringify(screenText(view.term()).trim().slice(-400)));
  log.push('info sizes sent: ' + (sent.join(', ') || 'none'));
  const size = G.ptySize.get(A);
  check(
    !!size &&
      sent.includes(size.cols + 'x' + (size.rows - 1)) &&
      sent.at(-1) === size.cols + 'x' + size.rows,
    'opening it sent one row less and its size again (' + (sent.join(', ') || 'none') + ')'
  );
  check(!!drawn, 'the CLI drew its screen again, and it is on the CLI screen');
  check(/> input box/.test(screenText(view.term())), 'its input box is on screen');
  console.log('TNAI_SHOT:cli-screen-long-run-open');
  await wait(800);
  N.pty.write(A, 'quit\r');
  await wait(500);
  await N.pty.stop(A);
  await N.pty.stop(first.paneId);
} catch (e) {
  ok = false;
  log.push('FAIL threw: ' + (e?.stack || e));
}
return { ok, log };
