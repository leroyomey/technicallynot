// Technically Not tools · desktop-check/tests/panel-restore-limit.after.js — after
// panel-restore-limit.js saved one workspace with more panels than the limit and reloaded: every
// panel comes back, the limit's worth in their own workspace and the rest in a further one that
// is filed under the open project, and the saved list still names all of them.
// Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const { total } = JSON.parse(sessionStorage.getItem('tnai.test.panel-restore-limit') || '{}');
const max = window.TnaiPaneLimit.max;
await wait(1500);
const restored = [...document.querySelectorAll('.terminal-pane[data-pane-id^="restore-test-"]')];
check(restored.length === total, restored.length + ' of ' + total + ' saved panels restored');
const inFirst = restored.filter(p => p.dataset.workspaceId === 'workspace-1').length;
const extraIds = [...new Set(restored.map(p => p.dataset.workspaceId))].filter(
  id => id !== 'workspace-1'
);
check(
  inFirst === max && extraIds.length === 1,
  inFirst + ' stay in workspace-1, the rest in ' + extraIds.join(', ')
);
const listed = window.TnaiTerminalWorkspaces?.list?.() || [];
check(
  extraIds.length === 1 && listed.some(w => w.id === extraIds[0]),
  "the further workspace is one of the open project's (" + listed.map(w => w.id).join(', ') + ')'
);
const savedIds = JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]')
  .map(item => item.id)
  .filter(id => id.startsWith('restore-test-'));
check(savedIds.length === total, 'the saved list still names all ' + savedIds.length);
check(window.TnaiThreads?.visible() === true, 'the app still opens on Threads');

// A closed workspace's grid is let go by 21's size observer (it lives as long as the page).
if (extraIds.length === 1) {
  const grid = document.querySelector(
    '.terminal-workspace-view[data-workspace-id="' + extraIds[0] + '"] .terminal-workspace-grid'
  );
  const unobserved = [];
  const original = ResizeObserver.prototype.unobserve;
  ResizeObserver.prototype.unobserve = function (target) {
    unobserved.push(target);
    return original.call(this, target);
  };
  window.TnaiTerminalWorkspaces.remove(extraIds[0]);
  await wait(100);
  ResizeObserver.prototype.unobserve = original;
  check(!!grid && unobserved.includes(grid), "a closed workspace's grid is no longer observed");
}
return { ok, log };
