/*
 * Technically Not tools · desktop-check/tests/pane-cleanup.js — Nothing a pane started outlives it
 * or Technically Not (pane-cleanup.main.js does the work): a real PowerShell pane's hidden
 * background ping must end when the pane is closed, when Technically Not quits, when the ping was
 * started through a cmd.exe that already exited (orphan), and when the shell exits by itself; a
 * process running process-guard.js that is hard-killed takes its shell and ping with it; the next
 * start reaps a recorded root only when pid and creation time match. No agent, no prompt. Returns
 * {ok, log}.
 */
const log = [];
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const main = (cmd, ...args) =>
  new Promise(resolve => {
    const id = Math.random().toString(36).slice(2);
    (window.__tnaiMainDone ||= {})[id] = resolve;
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
for (const reason of ['close', 'orphan', 'exit', 'crash', 'quit']) {
  const r = await main('run', reason);
  if (!r?.ok) {
    check(false, reason + ': ' + (r?.error || 'no answer'));
    continue;
  }
  const v = r.value;
  if (v.error) {
    check(false, reason + ': ' + v.error);
    continue;
  }
  check(
    v.kids.length > 0,
    reason + ': the pane started a background process (' + v.kids.join(', ') + ')'
  );
  check(!v.shellAlive, reason + ': the pane shell ended');
  check(
    v.kids.length > 0 && !v.kidsAlive.length,
    reason +
      ': its background process ended too' +
      (v.kidsAlive.length ? ' (still alive: ' + v.kidsAlive.join(', ') + ')' : '')
  );
  if (reason === 'crash')
    check(!v.helperAlive, 'crash: the guard helper ended with the killed process');
}
const r = await main('run', 'reap');
const v = r?.value || {};
if (v.skip) {
  log.push('skip reap: ' + v.skip);
  return { ok, log };
}
check(
  r?.ok && v.reaped > 0 && !v.matchedAlive,
  'reap: a recorded root with matching pid + creation time is ended on the next start'
);
check(r?.ok && v.otherAlive, 'reap: a recorded pid whose creation time differs is left alone');
check(r?.ok && v.recordCleared, 'reap: the record list starts empty for the new run');
return { ok, log };
