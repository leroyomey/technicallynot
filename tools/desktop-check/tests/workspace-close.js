// Technically Not tools · desktop-check/tests/workspace-close.js — the workspace tabs in the top
// row of the All threads page: a click or double click only switches (✎ / F2 rename, × beside
// the field backs out), × closes a workspace: empty closes at once with a toast, idle sessions
// and working agents ask first (in-app dialog, focus on Cancel, Esc/Cancel keep it), confirming
// stops the processes and removes it with its threads, the last one leaves a fresh empty
// workspace and the page says there are no threads. Real PowerShell threads; no prompt is sent
// to any agent CLI. Continues in workspace-close.after.js after a reload.
// Returns {ok, log, reload}.
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
    await wait(100);
  }
  return null;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
const api = window.TnaiTerminalWorkspaces;
const tabOf = id =>
  document.querySelector('.terminal-workspace-tab[data-workspace-tab="' + CSS.escape(id) + '"]');
const panesIn = ws =>
  [...document.querySelectorAll('.terminal-pane[data-pane-id]')].filter(
    p => p.dataset.workspaceId === ws
  );
const renameInput = () => document.querySelector('.terminal-workspaces .tnai-rename-input');
const key = (el, k, extra = {}) =>
  el.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })
  );
const overlay = () => document.querySelector('.tnai-ws-close-overlay:not(.tnai-signin-overlay)');
const dialogOpen = () => overlay() && !overlay().hidden;
const dialogText = () =>
  overlay().querySelector('h2').textContent +
  ' | ' +
  overlay().querySelector('p').textContent +
  ' | ' +
  overlay().querySelector('.tnai-ws-close-confirm').textContent;

// A PowerShell thread started in the workspace whose tab is the open one. Answers its id, or
// '' when it did not start.
const startShell = async () => {
  try {
    return (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  } catch (error) {
    log.push('info ' + (error?.message || error));
    return '';
  }
};
const shown = el => !!el && el.getClientRects().length > 0;
const session = id => window.TnaiAgents.sessions().find(s => s.paneId === id);

try {
  await window.TnaiAgents.detect(true);

  // the All threads page (its route is 'terminal'): the workspace tabs stand in its top row
  window.TnaiRoute('terminal');
  await wait(400);
  const ws1 = api.activeId();
  check(
    !!window.TnaiAllThreads?.state().on && shown(tabOf(ws1)),
    'All threads is shown and the workspace tab stands in its top row'
  );

  // ---- Clicking never renames; ✎ and F2 do ----
  let tab = tabOf(ws1);
  check(
    !tab.title && !/Double-click/.test(tab.outerHTML),
    'workspace tab has no "Double-click to rename" title'
  );
  tab.click();
  tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await wait(50);
  check(!renameInput(), 'click + double click on the tab do not open rename');
  tab.querySelector('[data-ws-rename]').click();
  check(!!renameInput(), '✎ opens the rename field');
  key(renameInput(), 'Escape');
  await wait(50);
  tab = tabOf(ws1);
  tab.focus();
  key(tab, 'F2');
  check(!!renameInput(), 'F2 on the focused tab opens the rename field');
  key(renameInput(), 'Escape');
  await wait(50);

  // ---- Backing out of a rename with the × beside the field (the user asked for a way to cancel)
  // ----
  {
    const nameBefore = api.list().find(w => w.id === ws1)?.name;
    tabOf(ws1).querySelector('[data-ws-rename]').click();
    const field = renameInput();
    const cancel = field?.parentElement.querySelector('.tnai-rename-cancel');
    const fieldBox = field?.getBoundingClientRect();
    const cancelBox = cancel?.getBoundingClientRect();
    check(
      !!cancel &&
        cancel.getClientRects().length > 0 &&
        !!cancel.getAttribute('aria-label') &&
        cancelBox.left >= fieldBox.right - 0.5 &&
        cancelBox.width >= 22 &&
        cancelBox.height >= 22,
      'a × with a label stands right of the rename field (' +
        Math.round(cancelBox?.width || 0) +
        ' x ' +
        Math.round(cancelBox?.height || 0) +
        ')'
    );
    if (field && cancel) {
      field.value = 'Not this name';
      cancel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      cancel.click();
      await wait(80);
    }
    check(
      !renameInput() &&
        !document.querySelector('.tnai-rename-cancel') &&
        api.list().find(w => w.id === ws1)?.name === nameBefore &&
        !tabOf(ws1).hidden,
      'a press on it closes the field and keeps the old name ("' + nameBefore + '")'
    );
  }

  // ---- A second workspace: switching back and forth by click, double click never renames ----
  document.querySelector('.terminal-workspace-add:not(.terminal-pane-add)').click();
  await wait(200);
  const wsEmpty = api.activeId();
  tabOf(ws1).click();
  await wait(50);
  tabOf(wsEmpty).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  tabOf(wsEmpty).click();
  await wait(50);
  check(api.activeId() === wsEmpty && !renameInput(), 'clicking between tabs only switches');

  // ---- Empty workspace: closes without asking, active moves to a neighbour ----
  const toastsBefore = document.body.textContent;
  tabOf(wsEmpty).querySelector('[data-ws-close]').click();
  await wait(200);
  check(
    !dialogOpen() && !api.list().some(w => w.id === wsEmpty),
    'empty workspace closed without a dialog'
  );
  check(api.activeId() === ws1 && !tabOf(wsEmpty), 'active switched to the neighbour');
  check(
    /closed/.test(document.body.textContent) && document.body.textContent !== toastsBefore,
    'a toast confirms the close'
  );

  // ---- Workspace with two idle PowerShell sessions ----
  document.querySelector('.terminal-workspace-add:not(.terminal-pane-add)').click();
  await wait(200);
  const wsLive = api.activeId(),
    liveName = api.list().find(w => w.id === wsLive).name;
  const ids = [await startShell(), await startShell()];
  check(
    ids.every(id => !!id && panesIn(wsLive).some(panel => panel.dataset.paneId === id)),
    'two PowerShell threads running in ' + liveName
  );
  check(
    !!(await until(() => ids.every(id => session(id)?.status === 'waiting'), 12000)),
    'both sessions idle (waiting)'
  );
  tabOf(wsLive).querySelector('[data-ws-close]').click();
  await wait(100);
  check(
    dialogOpen() &&
      dialogText() ===
        'Close “' + liveName + '” with 2 agents? | Their sessions will end. | Close workspace',
    'idle wording: ' + dialogText()
  );
  check(
    document.activeElement === overlay().querySelector('.tnai-ws-close-cancel'),
    'focus starts on Cancel'
  );
  key(document.activeElement, 'Tab');
  const trapped1 = document.activeElement?.classList.contains('tnai-ws-close-confirm');
  key(document.activeElement, 'Tab');
  const trapped2 = document.activeElement?.classList.contains('tnai-ws-close-cancel');
  check(trapped1 && trapped2, 'Tab stays inside the dialog');
  check(
    !overlay().querySelector('.tnai-ws-close-confirm').hasAttribute('data-danger'),
    'idle confirm is not styled as danger'
  );
  key(document.activeElement, 'Escape');
  await wait(100);
  check(
    !dialogOpen() && api.list().some(w => w.id === wsLive) && ids.every(id => session(id)?.running),
    'Esc keeps the workspace and its sessions'
  );
  tabOf(wsLive).querySelector('[data-ws-close]').click();
  await wait(100);
  overlay().querySelector('.tnai-ws-close-cancel').click();
  await wait(100);
  check(
    !dialogOpen() && api.list().some(w => w.id === wsLive) && panesIn(wsLive).length === 2,
    'Cancel keeps the workspace'
  );

  // ---- Both agents working: output flowing in both (a PowerShell loop, not an agent prompt) ----
  ids.forEach(id =>
    window.TnaiAgents.send(id, '1..60 | % { "tick $_"; Start-Sleep -Milliseconds 250 }')
  );
  check(
    !!(await until(() => ids.every(id => session(id)?.status === 'working'), 8000)),
    'both sessions working'
  );
  tabOf(wsLive).querySelector('[data-ws-close]').click();
  await wait(100);
  check(
    dialogOpen() &&
      dialogText() ===
        'Close “' +
          liveName +
          '”? | 2 agents are still working in this workspace. Closing it stops them mid-task. | Stop agents and close',
    'working wording: ' + dialogText()
  );
  check(
    overlay().querySelector('.tnai-ws-close-confirm').hasAttribute('data-danger'),
    'stop button styled as danger'
  );
  await shot('ws-close');
  overlay().querySelector('.tnai-ws-close-confirm').click();
  check(
    !!(await until(() => !api.list().some(w => w.id === wsLive), 3000)),
    'confirm removes the workspace'
  );
  check(
    !document.querySelector(
      '.terminal-pane[data-pane-id="' +
        CSS.escape(ids[0]) +
        '"],.terminal-pane[data-pane-id="' +
        CSS.escape(ids[1]) +
        '"]'
    ),
    'its panels underneath are gone'
  );
  check(
    !!(await until(() => ids.every(id => !window.TnaiThreadList.thread(id)), 3000)),
    'and its threads are gone from the thread list'
  );
  check(
    !!(await until(() => ids.every(id => !session(id)), 3000)),
    'TnaiAgents no longer lists the sessions'
  );
  check(
    !!(await until(
      async () =>
        !(await window.tnaiNative.pty.list()).some(s => ids.includes(s.paneId) && s.running),
      5000
    )),
    'native processes stopped'
  );
  check(
    !JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]').some(p => ids.includes(p.id)) &&
      !(localStorage.getItem('tnai.terminal-workspaces.v1') || '').includes(wsLive),
    'threads and workspace removed from storage'
  );
  check(api.activeId() === ws1, 'active is Workspace 1 again');

  // ---- Singular wording: one idle shell ----
  const p1 = await startShell();
  check(
    !!p1 && panesIn(ws1).some(panel => panel.dataset.paneId === p1),
    'PowerShell running in ' + api.list()[0].name
  );
  check(!!(await until(() => session(p1)?.status === 'waiting', 12000)), 'idle');
  tabOf(ws1).querySelector('[data-ws-close]').click();
  await wait(100);
  check(
    dialogText() ===
      'Close “' + api.list()[0].name + '” with 1 agent? | Its session will end. | Close workspace',
    'singular wording: ' + dialogText()
  );
  overlay().querySelector('.tnai-ws-close-cancel').click();
  await wait(50);

  // ---- Last workspace: force close leaves one fresh empty workspace ----
  const res = await api.close(ws1, { force: true });
  const left = api.list();
  check(
    res.ok && left.length === 1 && left[0].id !== ws1 && !panesIn(left[0].id).length,
    'closing the last workspace leaves one empty workspace (' + left[0]?.name + ')'
  );
  check(
    !!(await until(
      async () => !(await window.tnaiNative.pty.list()).some(s => s.paneId === p1 && s.running),
      5000
    )),
    'its shell stopped'
  );
  check(
    !!(await until(() => shown(document.querySelector('#terminalView .tat-none')), 3000)),
    'the page says there are no threads: "' +
      (document.querySelector('#terminalView .tat-none')?.textContent || '') +
      '"'
  );
  sessionStorage.setItem(
    'tnai.test.wc',
    JSON.stringify({ list: left, gone: [ws1, wsEmpty, wsLive] })
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
window.onbeforeunload = null;
return { ok, log, reload: true };
