// Technically Not tools · desktop-check/tests/empty-panels.js — terminal panels with no connection
// do not stay behind (src/scripts/130-empty-panels.js). A workspace can hold four agents
// and eight empty panels that no view of the thread layout shows. This half builds
// such a workspace with four real PowerShell panels and eight empty ones and reloads the window;
// empty-panels.after.js looks at what opens. No prompt is sent to any agent CLI.
// Returns {ok, log, reload}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const agents = window.TnaiAgents,
  panes = () => [...document.querySelectorAll('.terminal-pane[data-pane-id]')],
  savedList = () => JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]');

try {
  await until(() => window.TnaiThreads?.visible(), 8000);
  await agents.detect(true);

  // ---- a fresh settings folder keeps its one panel ----
  await wait(600);
  check(
    panes().length === 1 && window.TnaiEmptyPanels.list().length === 0,
    'a fresh settings folder keeps its one empty panel (' +
      panes().length +
      ' panels, ' +
      window.TnaiEmptyPanels.list().length +
      ' named as left over)'
  );

  // ---- four PowerShell panels, then empty ones up to the twelve ----
  for (let i = 0; i < 4; i++) await window.TnaiTest.open('Terminal');
  check(
    !!(await until(() => agents.sessions().filter(s => s.running).length >= 4, 30000)),
    'setup: four PowerShell panels running'
  );
  const max = window.TnaiPaneLimit.max;
  while (panes().length < max) window.TnaiNewTerminalPane({ quiet: true });
  await wait(400);
  const connected = agents
    .sessions()
    .filter(s => s.running)
    .map(s => ({ paneId: s.paneId, pid: s.pid }));
  const empty = panes().filter(p => !p.querySelector('.terminal-provider-select')?.value);
  check(
    panes().length === max && connected.length === 4 && empty.length === max - 4,
    'setup: the workspace holds ' +
      panes().length +
      ' panels, ' +
      connected.length +
      ' with a PowerShell and ' +
      empty.length +
      ' empty'
  );
  check(
    savedList().length === max && window.TnaiPaneLimit.count() === max,
    'setup: all ' + savedList().length + ' are in the saved list and count toward the limit'
  );
  sessionStorage.setItem('tnai.test.empty-panels', JSON.stringify({ connected }));
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log, reload: true };
