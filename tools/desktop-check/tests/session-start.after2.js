/*
 * Technically Not tools · desktop-check/tests/session-start.after2.js — Another new launch:
 * Start clean closes every thread (none in the thread list, saved list and session record
 * dropped) while the project context note and the project folder stay. Returns {ok, log}.
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
const native = window.tnaiNative,
  paneId = sessionStorage.getItem('tnai.test.pane');
const clean = await until(
  () => document.querySelector('.tnai-ws-close-overlay [data-choice="clean"]'),
  8000
);
check(!!clean, 'question shown again on the next launch');
clean?.click();
check((await window.TnaiSessionStart.ready) === 'clean', 'Start clean chosen');
await wait(500);
check(
  !document.querySelector('.terminal-pane[data-pane-id]') &&
    (window.TnaiThreadList?.rows() || []).length === 0,
  'Start clean: no thread in the thread list and no panel underneath'
);
let saved = null;
try {
  saved = JSON.parse(localStorage.getItem('tnai.terminals.v1') || 'null');
} catch {}
check(Array.isArray(saved) && saved.length === 0, 'saved pane list is empty');
check(
  !!(await until(async () => (await native.pty.replay(paneId)) === null, 5000)),
  'the pane’s saved session record and output are dropped'
);
const ctx = await native.context.state();
check(!!ctx?.project, 'project folder still connected (its context state kept)');
console.log('TNAI_SHOT:session-start-clean');
await wait(450);
return { ok, log };
