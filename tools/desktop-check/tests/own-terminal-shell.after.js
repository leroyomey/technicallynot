// Technically Not tools · desktop-check/tests/own-terminal-shell.after.js — the second half of
// own-terminal-shell, after the window was reloaded with Command Prompt chosen. Checked: the
// choice is remembered for the project; the terminal comes back in the same panel and its new
// shell is Command Prompt again; choosing PowerShell brings PowerShell back, and the choice is
// then forgotten (PowerShell needs no entry). Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const own = () => window.TnaiOwnTerminal;
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const row = () => document.querySelector('.tnt-ownterm-row');
const question = () => document.querySelector('.tnt-ownterm .tnai-panel-confirm');

try {
  const before = localStorage.getItem('tnai.test.own-terminal-shell') || '';
  localStorage.removeItem('tnai.test.own-terminal-shell');
  await until(() => threads?.visible(), 20000);
  await until(() => own()?.shells().length, 15000);
  check(own().shell() === 'cmd', 'after a reload the project still has Command Prompt chosen');
  window.TnaiThreadSide.open('terminal');
  const ownId = (await until(() => own().paneId(), 20000)) || '';
  check(ownId === before, 'the terminal is in the same panel (' + ownId + ')');
  await until(() => session(ownId)?.running, 30000);
  const term = await until(() => own().term(), 10000);
  await wait(2500);
  term.input('echo again-%OS%-shell\r', true);
  check(
    !!(await until(() => textOf(term).includes('again-Windows_NT-shell'), 20000)),
    'the shell that runs after the reload is Command Prompt'
  );
  const name = row().querySelector('.tnt-ownterm-shell');
  const pick = row().querySelector('.tnt-ownterm-shellbox select');
  check(
    name.textContent === 'Command Prompt' && pick.value === 'cmd',
    'the row and its list say so (' + name.textContent + ')'
  );

  // ---- back to PowerShell ----
  const startedAt = session(ownId).startedAt;
  pick.value = 'powershell';
  pick.dispatchEvent(new Event('change', { bubbles: true }));
  const asked = await until(() => question(), 3000);
  [...(asked?.querySelectorAll('button') || [])]
    .find(button => /switch/i.test(button.textContent))
    ?.click();
  await until(() => session(ownId)?.running && session(ownId).startedAt !== startedAt, 30000);
  await wait(2500);
  term.input("Write-Host ('power' + '-shell-' + $PSVersionTable.PSVersion.Major)\r", true);
  check(
    !!(await until(() => /power-shell-\d/.test(textOf(term)), 20000)),
    'choosing PowerShell brings PowerShell back'
  );
  check(
    name.textContent === 'PowerShell' &&
      !/cmd/.test(localStorage.getItem('tnai.own-terminal.shell.v1') || ''),
    'the row names it, and no choice is kept for the usual shell'
  );
  await agents.stop(ownId).catch(() => {});
  await wait(2500);
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
return { ok, log };
