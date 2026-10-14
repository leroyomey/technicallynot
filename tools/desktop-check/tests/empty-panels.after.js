// Technically Not tools · desktop-check/tests/empty-panels.after.js — after empty-panels.js saved
// a workspace of four PowerShell panels and eight empty ones and reloaded the window: it opens
// with the four. Then: a new empty panel stays while it is new; an old one goes when its
// workspace is shown, unless it has something to resume; a workspace left with no panels shows
// its empty state. One wait of 16 seconds is the time a new panel is left alone.
// Returns {ok, log}.
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
  spaces = window.TnaiTerminalWorkspaces,
  limit = window.TnaiPaneLimit,
  panes = ws =>
    [...document.querySelectorAll('.terminal-pane[data-pane-id]')].filter(
      p => !ws || p.dataset.workspaceId === ws
    ),
  ids = ws => panes(ws).map(p => p.dataset.paneId),
  savedIds = () => JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]').map(p => p.id),
  tabText = ws =>
    document.querySelector('[data-workspace-tab="' + CSS.escape(ws) + '"] small')?.textContent ||
    '',
  same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

try {
  const { connected = [] } = JSON.parse(sessionStorage.getItem('tnai.test.empty-panels') || '{}');
  const first = spaces.activeId();
  const wanted = connected.map(c => c.paneId);

  // ---- the saved workspace of twelve opens with its four ----
  await until(() => panes().length === 4, 10000);
  check(
    same(ids(), wanted),
    'the workspace saved with 4 PowerShell panels and 8 empty ones opens with ' +
      panes().length +
      ' panels, the four that had a connection'
  );
  check(
    panes().every(p => p.querySelector('.terminal-provider-select')?.value === 'Terminal'),
    'each of them still has its connection chosen'
  );
  await until(() => agents.sessions().filter(s => s.running).length >= 4, 10000);
  const pids = agents
    .sessions()
    .filter(s => s.running)
    .map(s => s.paneId + ' ' + s.pid);
  check(
    same(
      pids,
      connected.map(c => c.paneId + ' ' + c.pid)
    ),
    'their four processes are the same as before the reload, none was started again'
  );
  check(
    same(savedIds(), wanted),
    'the saved list lost the empty ones (' + savedIds().length + ' entries)'
  );
  check(
    limit.count(first) === 4 && /4 selected/.test(tabText(first)),
    'the limit counts ' + limit.count(first) + ' and the tab says "' + tabText(first) + '"'
  );

  // ---- a new empty panel stays while it is new ----
  const plain = window.TnaiNewTerminalPane();
  const withSummary = window.TnaiNewTerminalPane();
  const withSavedTool = window.TnaiNewTerminalPane();
  await wait(300);
  check(
    panes(first).length === 7 && window.TnaiEmptyPanels.list().length === 0,
    'three new empty panels stand in the workspace and none is named as left over'
  );
  check(
    (await window.TnaiEmptyPanels.sweep()) === 0 && panes(first).length === 7,
    'a sweep right after leaves all three'
  );

  // Two of them get something to resume: a compact summary (05 keeps it), and a saved connection
  // that the box cannot show (a tool that is not offered now).
  // 05 writes its whole store from memory at every change, so the summary is put into the saved
  // store again right before each look at it.
  const giveSummary = () => {
    const context = JSON.parse(localStorage.getItem('tnai.terminal-context.v1') || '{}');
    context[withSummary.id] = { summary: 'Fixed the cart total.', turns: [] };
    localStorage.setItem('tnai.terminal-context.v1', JSON.stringify(context));
  };
  withSavedTool.agent = 'A tool that is gone';

  // A second workspace with one empty panel of its own, made the way the app makes the next one
  // when a workspace is full.
  spaces.overflow({ activate: true });
  const second = await until(() => (spaces.activeId() !== first ? spaces.activeId() : null));
  const lone = window.TnaiNewTerminalPane({ workspaceId: second });
  await wait(300);
  check(
    !!second && panes(second).length === 1 && limit.count(second) === 1,
    'a second workspace holds one empty panel'
  );
  spaces.activate(first);
  await wait(300);
  check(
    panes(first).length === 7,
    'showing the first workspace again a moment later removes nothing (' +
      panes(first).length +
      ' panels)'
  );

  // The time a new panel is left alone (15 s), once.
  await wait(16000);
  giveSummary();
  check(
    same(window.TnaiEmptyPanels.list(), [plain.id, lone.id]),
    'after 16 s the two panels with nothing to resume are named as left over, the two with something are not'
  );

  // ---- a workspace is shown: its left-over panels go ----
  spaces.activate(second);
  await until(() => panes(second).length === 0, 5000);
  const emptyState = document.querySelector(
    '.terminal-workspace-view:not([hidden]) .terminal-workspace-empty'
  );
  check(
    panes(second).length === 0 && !!emptyState && limit.count(second) === 0,
    'the second workspace is shown with no panels and its empty state ("' +
      (emptyState?.querySelector('b')?.textContent || '') +
      '"), and counts ' +
      limit.count(second)
  );
  check(
    /0 selected/.test(tabText(second)) && spaces.list().some(w => w.id === second),
    'it is still a workspace, and its tab says "' + tabText(second) + '"'
  );
  check(
    panes(first).length === 7,
    'the workspace that was not shown kept its panels meanwhile (' + panes(first).length + ')'
  );

  giveSummary();
  spaces.activate(first);
  await until(() => panes(first).length === 6, 5000);
  await wait(400);
  check(
    same(ids(first), [...wanted, withSummary.id, withSavedTool.id]),
    'shown again, the first workspace lost the one panel with nothing to resume and kept the one with a summary and the one with a saved connection (' +
      panes(first).length +
      ' panels)'
  );
  check(
    same(savedIds(), ids()) && limit.count(first) === 6,
    'the saved list and the limit agree with the page (' +
      savedIds().length +
      ' saved, ' +
      limit.count(first) +
      ' counted)'
  );
  check(
    agents.sessions().filter(s => s.running).length === 4,
    'the four PowerShell panels are still running'
  );
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}

// Let the shells finish closing: exiting the app mid-teardown crashed it after RESULT: PASS.
agents.sessions().forEach(s => agents.stop(s.paneId));
await until(() => !agents.sessions().some(s => s.running), 10000);
await wait(300);
return { ok, log };
