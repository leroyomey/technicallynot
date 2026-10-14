// Technically Not tools · desktop-check/tests/workspace-close.after.js — After workspace-close.js
// reloads the window: closed workspaces stay closed, on the All threads page where their tabs
// stand; and with no thread at startup a new thread starts and shows there. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const { list, gone } = JSON.parse(sessionStorage.getItem('tnai.test.wc') || '{}');

// the All threads page: the route 'terminal' is that page
window.TnaiRoute('terminal');
await wait(500);
const now = window.TnaiTerminalWorkspaces.list();
check(
  JSON.stringify(now.map(w => w.id)) === JSON.stringify(list.map(w => w.id)),
  'same workspaces after reload: ' + now.map(w => w.name).join(', ')
);
check(
  !now.some(w => gone.includes(w.id)) &&
    gone.every(id => !document.querySelector('[data-workspace-tab="' + CSS.escape(id) + '"]')),
  'closed workspaces stay closed'
);
check(
  !document.querySelector('.terminal-pane[data-pane-id]') ||
    [...document.querySelectorAll('.terminal-pane')].every(
      p => !gone.includes(p.dataset.workspaceId)
    ),
  'no panels restored into closed workspaces'
);

// Regression: with no panels at startup, a panel underneath made the way 47 reopen() (tnai new /
// revive) and 43 spawn() make one used to stay outside its workspace (07's map of panels to
// workspaces was never created, so adoption threw). A thread's session runs in such a panel.
const grid = () =>
  document.querySelector('.terminal-workspace-view:not([hidden]) .terminal-workspace-grid');
for (const [label, opts] of [
  ['reopen (tnai new)', { name: 'Flint', quiet: true, reuseEmpty: true }],
  [
    'spawn (sub-agent)',
    { workspaceId: window.TnaiTerminalWorkspaces.activeId(), name: 'Sub', quiet: true },
  ],
]) {
  const rec = window.TnaiNewTerminalPane(opts);
  await wait(200);
  check(
    !!rec && rec.pane.parentElement === grid(),
    label + ': the new panel underneath is inside the open workspace'
  );
  check(!grid()?.querySelector('.terminal-workspace-empty'), label + ': empty state gone');
  rec?.pane.querySelector('button[title="Close terminal"]')?.click();
  if (rec?.pane.isConnected) rec.pane.remove();
  await wait(100);
}

// What a user does from here: a new thread starts, and stands on All threads.
let threadId = '';
try {
  threadId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
} catch (error) {
  log.push('info ' + (error?.message || error));
}
const card = () =>
  document.querySelector('#terminalView .tat-card[data-pane="' + CSS.escape(threadId) + '"]');
let cardShown = false;
for (let tries = 0; tries < 50 && !cardShown; tries++) {
  cardShown = !!threadId && !!card() && card().getClientRects().length > 0;
  if (!cardShown) await wait(100);
}
check(
  cardShown && !!window.TnaiThreadList.thread(threadId),
  'a new thread starts after the reload: its row is in the thread list and its card on All threads'
);
if (threadId) await window.TnaiAgents.stop(threadId);
await wait(400);
return { ok, log };
