/*
 * Technically Not tools · desktop-check/tests/typing-status.js — Typing into a quiet thread's CLI
 * screen is not work (10 noteReport + onData): a real shell, started as a thread, echoes each key,
 * and that echo must not turn the thread Working while the user writes a prompt. Keys go the way
 * every input path sends them (TnaiAgents.noteReport, then pty.write, as a terminal view's
 * term.onData does). Enter submits: the
 * output after it counts again. Returns {ok, log}.
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
  return (await fn()) || null;
};
const native = window.tnaiNative,
  agents = window.TnaiAgents,
  windows = /Windows/.test(navigator.userAgent);
try {
  const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running))),
    'shell started'
  );
  const state = () => agents.sessions().find(s => s.paneId === paneId)?.status;
  check(
    !!(await until(() => state() === 'waiting', 12000)),
    'shell settles to Waiting for input: ' + state()
  );
  const key = k => {
    agents.noteReport(paneId, k);
    native.pty.write(paneId, k);
  };
  const seen = new Set();
  for (const ch of windows ? 'Write-Output ("TYPE" + (6*7))' : 'echo "TYPE$((6*7))"') {
    key(ch);
    await wait(110);
    seen.add(state());
  }
  await wait(800);
  seen.add(state());
  check(
    !seen.has('working'),
    'typing a whole command (about 3 s, echoed key by key) never shows Working: ' +
      [...seen].join(', ')
  );
  check(
    /TYPE/.test((await native.pty.replay(paneId))?.buffer || ''),
    'the keys really reached the shell (echo in the buffer)'
  );
  key('\r');
  check(
    !!(await until(
      async () => /TYPE42/.test((await native.pty.replay(paneId))?.buffer || ''),
      8000
    )),
    'Enter runs it (TYPE42)'
  );
  seen.clear();
  for (let t = 0; t < 30 && !seen.has('working'); t++) {
    seen.add(state());
    await wait(50);
  }
  log.push(
    'info after Enter: ' + [...seen].join(', ') + ' (a fast command may finish before a paint)'
  );
  await agents.stop(paneId);
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}
return { ok, log };
