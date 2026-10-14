/*
 * Technically Not tools · desktop-check/tests/pane-start-race.js — A panel's start can't double up
 * or outlive the panel: two starts at once in one panel give one process; a panel closed while
 * starting leaves no process and no saved record; a panel closed before it mounts answers
 * TnaiAgents.openIn; a pty resize (its size note) doesn't turn a quiet panel Working. PowerShell
 * only, no agent, no prompt. Returns {ok, log}.
 */
const log = [];
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const pty = window.tnaiNative.pty,
  agents = window.TnaiAgents;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(100);
  }
  return null;
};
const running = async id => (await pty.list()).filter(s => s.paneId === id && s.running).length;

// 1. Two starts at once in one panel (Enter twice, Enter + Build panel Start): never two processes
// (refused while the first prepares, else replaced).
const a = 'race-double-' + Date.now();
const opts = { paneId: a, agent: 'Terminal', mode: 'run', cols: 80, rows: 24 };
const [r1, r2] = await Promise.all([pty.start(opts), pty.start(opts)]);
log.push(
  'info double start: ' +
    [r1, r2].map(r => (r.ok ? 'ok' : r.error?.message)).join(' / ') +
    ' (a start that finished first is replaced by the second)'
);
await sleep(500);
check((await running(a)) === 1, 'double start: one process runs for the panel');
await pty.forget(a);

// 2. Closed while starting: forget sent right behind the start.
const b = 'race-cancel-' + Date.now();
const started = pty.start({ ...opts, paneId: b });
pty.forget(b);
const rb = await started;
log.push(
  'info cancel path: ' +
    (rb.ok
      ? 'started, then stopped by forget'
      : 'refused: ' + rb.error?.message + (rb.error?.code ? ' (' + rb.error.code + ')' : ''))
);
await sleep(1500);
check((await running(b)) === 0, 'closed while starting: no process left running');
const saved = await pty.replay(b);
check(!saved, 'closed while starting: no saved session record came back');

// 3. A panel closed before it mounts: TnaiAgents.openIn answers instead of waiting forever.
const rec = window.TnaiNewTerminalPane?.({ quiet: true });
if (!rec) check(false, 'openIn: could not add a panel');
else {
  await sleep(150); // 05 adds the connection picker to a new panel
  const answer = agents.openIn(rec.id, 'Terminal');
  rec.pane.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.onclick?.();
  const res = await Promise.race([answer, sleep(5000).then(() => 'timeout')]);
  check(
    res !== 'timeout' && res && res.ok === false,
    'openIn: a panel closed before it started answers ok:false (' +
      (res === 'timeout' ? 'timed out' : res?.error) +
      ')'
  );
  await sleep(1000);
  check((await running(rec.id)) === 0, 'openIn: nothing runs for the closed panel');
}

// 4. A resize's size note is not output: a quiet PowerShell panel stays "Waiting for input".
const rec2 = window.TnaiNewTerminalPane?.({ quiet: true });
if (!rec2) check(false, 'resize: could not add a panel');
else {
  await sleep(150);
  const res = await agents.openIn(rec2.id, 'Terminal');
  check(res?.ok, 'resize: PowerShell panel started');

  // The header status is painted on a 1 s tick, so it can still say Working a moment after
  // sessions() turned waiting: wait for both.
  const quiet = await until(
    () =>
      agents.sessions().find(s => s.paneId === rec2.id)?.status === 'waiting' &&
      rec2.pane.dataset.status === 'waiting',
    20000
  );
  check(!!quiet, 'resize: panel went quiet (waiting)');
  const size = agents.ptySize.get(rec2.id) || { cols: 80, rows: 24 };
  pty.resize(rec2.id, size.cols + 7, size.rows + 2);
  await sleep(400);
  const s = agents.sessions().find(x => x.paneId === rec2.id);
  check(
    s?.status === 'waiting' && rec2.pane.dataset.status !== 'working',
    'resize: panel still waiting after a pty resize (' + s?.status + ')'
  );
  rec2.pane.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.onclick?.();
}
return { ok, log };
