/*
 * Technically Not tools · desktop-check/tests/session-start.js — Start-of-launch choice
 * (61-session-start.js): a first launch with no agents asks nothing; a real shell is started as
 * a thread, the shell is stopped, and the "launched" mark is cleared so the reload counts as a new
 * launch. Continues in session-start.after.js (Restore) and session-start.after2.js (Start clean).
 * Returns {ok, log, reload}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const windows = /Windows/.test(navigator.userAgent);
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
const native = window.tnaiNative,
  agents = window.TnaiAgents;
check(
  (await window.TnaiSessionStart?.ready) === 'none' &&
    !document.querySelector('.tnai-ws-close-overlay [data-choice]'),
  'no agent panes last time: no question, nothing to choose'
);

const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
check(
  !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running))),
  'shell started as a thread'
);
await wait(1500);
agents.send(paneId, windows ? 'Write-Output ("SESSION" + (6*7))' : 'echo "SESSION$((6*7))"');
check(
  !!(await until(async () => /SESSION42/.test((await native.pty.replay(paneId))?.buffer || ''))),
  'shell output SESSION42'
);

// (Project notes went with the Project context page in the purple redesign: native.context has no
// addNote.)
await native.pty.stop(paneId);
check(
  !!(await until(
    async () => !(await native.pty.list()).some(s => s.paneId === paneId && s.running)
  )),
  'shell stopped (as on quit)'
);
await wait(600); // pane list and session record written
sessionStorage.setItem('tnai.test.pane', paneId);
sessionStorage.removeItem('tnai.session-launched'); // the reload now counts as a new launch
return { ok, log, reload: true };
