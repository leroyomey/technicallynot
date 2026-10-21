// Technically Not tools · desktop-check/tests/panel-restore-limit.js — saved panels over the
// limit are kept on restore (src/scripts/04-terminal-panes.js). This half saves one workspace
// with two panels more than the limit (each with a compact summary, so 130 keeps it and no
// process starts) and reloads the window; panel-restore-limit.after.js looks at what opens.
// Returns {ok, log, reload}.
const log = [];
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const max = window.TnaiPaneLimit.max;
const total = max + 2;
const saved = [];
const context = {};
for (let i = 1; i <= total; i++) {
  const id = 'restore-test-' + i;
  saved.push({ id, name: 'Restore ' + i, agent: '', serial: i, workspaceId: 'workspace-1' });
  context[id] = { summary: 'restore test ' + i };
}
localStorage.setItem('tnai.terminals.v1', JSON.stringify(saved));
localStorage.setItem('tnai.terminal-context.v1', JSON.stringify(context));
sessionStorage.setItem('tnai.test.panel-restore-limit', JSON.stringify({ total }));
check(true, 'setup: ' + total + ' panels saved in one workspace (limit ' + max + ')');
return { ok, log, reload: true };
