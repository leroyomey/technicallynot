// Technically Not tools · desktop-check/tests/persistence.js — Session records + scrollback saved
// on disk for a shell started as a thread, restart(), a Claude Code thread with a Technically Not
// session id (no prompt sent), composer draft. Continues in persistence.after.js after a reload.
// Returns {ok, log, reload}.
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
  typeof agents.restart === 'function' &&
    typeof agents.open === 'function' &&
    typeof native.pty.forget === 'function',
  'TnaiAgents.restart/open and pty.forget exist'
);

// A real shell, started as a thread, whose output is saved to disk.
const paneId = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
check(
  !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running))),
  'shell started'
);
const s0 = agents.sessions().find(s => s.paneId === paneId);
check(
  'title' in s0 && 'accountId' in s0 && 'sessionId' in s0 && 'resumable' in s0,
  'sessions() has title/accountId/sessionId/resumable'
);
await wait(1500);
agents.send(paneId, windows ? 'Write-Output ("PERSIST" + (6*7))' : 'echo "PERSIST$((6*7))"');
check(
  !!(await until(async () => /PERSIST42/.test((await native.pty.replay(paneId))?.buffer || ''))),
  'shell output PERSIST42'
);

// restart(): same pane, new process.
const pid0 = (await native.pty.list()).find(s => s.paneId === paneId)?.pid;
let t0 = Date.now();
const r = await agents.restart(paneId);
check(r.ok && !r.resumed, 'restart() ok, fresh session for a shell (' + (Date.now() - t0) + ' ms)');
const pid1 = (await native.pty.list()).find(s => s.paneId === paneId)?.pid;
check(pid1 && pid1 !== pid0, 'restart() replaced the process (pid ' + pid0 + ' → ' + pid1 + ')');
check(
  !!(await until(() => agents.sessions().find(s => s.paneId === paneId && s.running), 5000)),
  'the thread still runs after restart (old exit ignored)'
);
await wait(1500);
agents.send(paneId, windows ? 'Write-Output ("AFTER" + (2*5))' : 'echo "AFTER$((2*5))"');
check(
  !!(await until(async () => /AFTER10/.test((await native.pty.replay(paneId))?.buffer || ''))),
  'restarted shell runs commands (AFTER10)'
);
await wait(2300); // scrollback tick

// Stopping keeps a saved record + scrollback on disk; replay then comes from the store.
await native.pty.stop(paneId);
const saved = await until(async () => {
  const x = await native.pty.replay(paneId);
  return x?.saved && x;
}, 3000);
check(!!saved, 'the stopped thread replays from the saved record');
check(
  /AFTER10/.test(saved?.buffer || ''),
  'saved scrollback read back from disk (' + (saved?.buffer.length || 0) + ' chars)'
);
check(
  saved?.agent === 'Terminal' && saved.running === false,
  'saved record: agent Terminal, not running'
);

// open(): a Claude Code pane gets a Technically Not session id. Nothing is typed into it, so no
// usage. Skipped where Claude Code is not installed (the CI release runner), like composer-target's
// skip.
const claudeInstalled = !!(await agents.detect(true)).get('Claude Code')?.installed;
t0 = Date.now();
let opened = null;
if (claudeInstalled) {
  try {
    opened = await window.TnaiTest.startThread({ tool: 'Claude Code' });
  } catch (error) {
    log.push('info ' + (error?.message || error));
  }
  check(!!opened?.paneId, 'Claude Code started as a new thread (' + (Date.now() - t0) + ' ms)');
} else log.push('skip the Claude Code thread check: Claude Code is not installed here');
if (opened?.paneId) {
  const info = (await native.pty.list()).find(s => s.paneId === opened.paneId);
  check(
    /^[0-9a-f-]{36}$/.test(info?.sessionId || ''),
    'Claude Code started with Technically Not session id ' + (info?.sessionId || '-')
  );
  check(
    agents.sessions().find(s => s.paneId === opened.paneId)?.sessionId === info?.sessionId,
    'sessions() reports that session id'
  );
  check(info?.resumable === false, 'not resumable before any message (no transcript)');
  await wait(3000);
  log.push(
    '     claude title: ' +
      JSON.stringify(agents.sessions().find(s => s.paneId === opened.paneId)?.title || '')
  );
  await native.pty.stop(opened.paneId);
}

// Draft: the composer's, checked after the reload.
const promptBox = document.getElementById('prompt');
promptBox.value = 'draft that must survive';
promptBox.dispatchEvent(new Event('input', { bubbles: true }));
window.TnaiThreads.open();
await wait(200);

// (The editor-draft checks went with the File repository editor, removed in the purple redesign.)
await wait(600);
check(
  localStorage.getItem('tnai.draft.composer.v1') === 'draft that must survive',
  'composer draft stored'
);
window.onbeforeunload = null;
sessionStorage.setItem('tnai.test.pane', paneId);
return { ok, log, reload: true };
