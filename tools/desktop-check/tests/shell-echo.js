// Technically Not tools · desktop-check/tests/shell-echo.js — Portable smoke test (Windows, macOS,
// Linux; CI runs it under xvfb on Linux): the app loads with its bridge, a thread starts the
// default shell (PowerShell on Windows, $SHELL elsewhere) and has its row in the thread list, a
// typed command echoes back through node-pty, and Stop ends it. Returns {ok, log}.
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
  agents = window.TnaiAgents;
const windows = /Windows/.test(navigator.userAgent);
check(!!native && !!agents, 'desktop bridge and TnaiAgents loaded (' + navigator.platform + ')');

// The shell is started the way a user starts one: as a thread, on the Threads page.
let paneId = '';
try {
  paneId = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
} catch (error) {
  log.push('info ' + (error?.message || error));
}
check(
  !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running))),
  'default shell started as a thread'
);
check(
  !!(await until(() => window.TnaiThreadList?.thread?.(paneId), 5000)),
  'the shell has its row in the thread list'
);
await wait(1500);

// $((…)) works in bash and zsh; PowerShell gets its own syntax. The marker only appears once the
// shell has evaluated it (not in the typed echo).
agents.send(paneId, windows ? 'Write-Output ("SMOKE" + (6*7))' : 'echo "SMOKE$((6*7))"');
check(
  !!(await until(async () => /SMOKE42/.test((await native.pty.replay(paneId))?.buffer || ''))),
  'shell echoed SMOKE42'
);
await agents.stop(paneId);
check(
  !!(await until(() => !agents.sessions().find(s => s.paneId === paneId && s.running), 8000)),
  'Stop ended the shell'
);
return { ok, log };
