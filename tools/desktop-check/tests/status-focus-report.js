/*
 * Technically Not tools · desktop-check/tests/status-focus-report.js — A Waiting agent stays
 * Waiting when its CLI screen is clicked: the click sends a focus report (\e[I) and Claude Code
 * answers with a redraw, which used to turn the agent Working for a moment. A real PowerShell
 * thread stands in for the CLI: the report goes through TnaiAgents.noteReport (as every
 * terminal view does before writing input) and output follows at once. Real output that is not
 * an answer to a report still turns it Working. No agent CLI, no prompt. Returns {ok, log}.
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
const agents = window.TnaiAgents,
  native = window.tnaiNative;
const buffer = async id => (await native.pty.replay(id))?.buffer || '';
try {
  await agents.detect(true);
  const id = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
  await until(async () => /PS [A-Z]:/.test(await buffer(id)), 10000);
  const status = () => agents.sessions().find(s => s.paneId === id)?.status;
  check(
    !!(await until(() => status() === 'waiting', 8000)),
    'the quiet thread reads Waiting (' + status() + ')'
  );
  check(typeof agents.noteReport === 'function', 'TnaiAgents.noteReport is exported');

  // The click: a focus report, then the program's redraw right after it.
  agents.noteReport(id, '\x1b[I');
  native.pty.write(id, '"REDRAW"\r');
  const seen = [];
  const end = Date.now() + 1200;
  while (Date.now() < end) {
    seen.push(status());
    await wait(50);
  }
  check((await buffer(id)).includes('REDRAW'), 'the redraw output arrived');
  check(
    seen.every(s => s === 'waiting'),
    'stays Waiting through the redraw that answers a focus report (' +
      [...new Set(seen)].join(',') +
      ')'
  );

  // Real work (no report before it) still shows Working.
  native.pty.write(id, '1..30 | % { "W $_"; Start-Sleep -Milliseconds 40 }\r');
  check(!!(await until(() => status() === 'working', 3000)), 'real output still turns it Working');
  agents.stop?.(id);
} catch (e) {
  check(false, 'threw: ' + (e.stack || e.message));
}
return { ok, log };
