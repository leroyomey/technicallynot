/*
 * Technically Not tools · desktop-check/tests/session-start.after.js — New launch with an agent
 * thread left: the question shows (Start clean focused, nothing restored yet); Restore brings
 * the thread back with its saved output on its CLI screen and nothing auto-started. Clears the
 * launch mark again → session-start.after2.js. Returns {ok, log, reload}.
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
    await wait(100);
  }
  return null;
};
const paneId = sessionStorage.getItem('tnai.test.pane'),
  paneEl = () => document.querySelector('.terminal-pane[data-pane-id="' + paneId + '"]');
const dialog = await until(
  () =>
    document
      .querySelector('.tnai-ws-close-overlay [data-choice="clean"]')
      ?.closest('.tnai-ws-close-overlay'),
  8000
);
check(
  !!dialog && !!dialog.querySelector('[data-choice="restore"]'),
  'new launch with an agent pane: Restore / Start clean question shown'
);
check(
  /Restore agents and conversations/.test(dialog?.textContent || '') &&
    /Start clean \(no agents\)/.test(dialog?.textContent || '') &&
    /shared context/.test(dialog?.textContent || ''),
  'dialog wording'
);
check(document.activeElement?.dataset.choice === 'clean', 'Start clean is the focused default');
check(!!paneEl() && !paneEl().querySelector('.xterm'), 'pane not restored before the choice');
console.log('TNAI_SHOT:session-start-dialog');
await wait(450);
dialog?.querySelector('[data-choice="restore"]').click();
check(
  (await window.TnaiSessionStart.ready) === 'restore' &&
    !document.querySelector('.tnai-ws-close-overlay [data-choice]'),
  'Restore chosen, dialog closed'
);

// The restored shell is a thread again; its CLI screen shows the saved output.
const view = () => window.TnaiThreadView;
check(
  !!(await until(() => window.TnaiThreadList?.thread?.(paneId), 8000)),
  'Restore: the thread is back in the thread list'
);
window.TnaiThreads.show(paneId);
await until(() => view().shown() === paneId, 6000);
if (view().mode() !== 'term') view().setMode('term');
const text = () => {
  const term = view().term();
  if (!term || view().shown() !== paneId) return '';
  const rows = [];
  for (let y = 0; y < term.buffer.active.length; y++)
    rows.push(term.buffer.active.getLine(y)?.translateToString(true) || '');
  return rows.join(' ');
};
check(
  !!(await until(() => /SESSION42/.test(text()), 8000)),
  'Restore: saved output back on the thread CLI screen'
);
check(
  !(await window.tnaiNative.pty.list()).some(s => s.paneId === paneId && s.running),
  'Restore: nothing auto-started'
);
sessionStorage.removeItem('tnai.session-launched');
return { ok, log, reload: true };
