// Technically Not tools · desktop-check/tests/core.js — Renderer test body (runs inside an async
// function): bridge, agent detection, project folder read, view-only open, native write, a real
// shell started as a thread (its CLI screen, a task from the prompt box), a real Claude Code
// launch as a second thread, closing threads, the desktop prompt(). Returns {ok, log}.
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
    await wait(150);
  }
  return null;
};

check(
  !!window.tnaiNative && !!window.TnaiAgents && !!window.TnaiDesktop,
  'desktop bridge, TnaiAgents, TnaiDesktop present'
);

// Agent detection: real CLIs on this PC.
const agents = await window.TnaiAgents.detect(true);
for (const a of agents.values())
  log.push(
    '     agent ' +
      a.id +
      ': ' +
      (a.installed
        ? 'installed ' +
          a.version +
          ' · loggedIn=' +
          a.loggedIn +
          (a.account ? ' · ' + a.account : '')
        : 'not installed')
  );
check(agents.get('Claude Code')?.installed, 'Claude Code detected');

// Project folder restored from the desktop process (seeded by the runner).
const row = await until(() =>
  document.querySelector('.repo-real-tree [data-real-path="README.md"]')
);
check(!!row, 'project folder restored, README.md listed');
if (row) {
  // A file click opens 09's view-only window (the File repository editor was removed in the purple
  // redesign); stubbed, no extra window.
  const FV = window.TnaiFileViewer,
    realOpen = FV.open,
    opens = [];
  FV.open = p => {
    opens.push(p);
    return true;
  };
  row.click();
  await wait(100);
  FV.open = realOpen;
  check(
    opens[0] === 'README.md',
    'README.md click opens the view-only file window (' + JSON.stringify(opens) + ')'
  );

  // Folder writes through the native bridge (what agents' file work and settings use): exact bytes
  // back from disk.
  const text = ['# Sample', 'line two', 'added by Technically Not', ''].join(
    String.fromCharCode(13, 10)
  );
  const w = await window.tnaiNative.fs.write('README.md', new TextEncoder().encode(text));
  const bytes = (await window.tnaiNative.fs.read('README.md', 0, 1000)).value;
  check(
    w?.ok && new TextDecoder().decode(bytes) === text,
    'folder write verified on disk (CRLF kept)'
  );
}

// A real PowerShell session, started as a thread.
const threadView = window.TnaiThreadView;
const island = () => window.TnaiThreads.slot('main');
const shell = await window.TnaiTest.startThread({ tool: 'Terminal', show: true });
const paneId = shell.paneId;
check(!!shell.session?.running, 'shell process started as a thread');
const shellRow = await until(() => window.TnaiThreadList.thread(paneId), 5000);
check(
  !!shellRow && shellRow.tone !== 'err',
  'it is a row of the thread list, not marked as failed (tone ' + shellRow?.tone + ')'
);
await wait(1500);
window.TnaiAgents.send(
  paneId,
  windows ? 'Write-Output ("Technically Not" + (6*7))' : 'echo "Technically Not$((6*7))"'
);
const echoed = await until(
  async () => /Technically Not42/.test((await window.tnaiNative.pty.replay(paneId))?.buffer || ''),
  10000
);
check(!!echoed, 'shell ran a real command (Technically Not42)');

// What the thread's CLI screen holds, read from the terminal itself (its rows are drawn on a
// canvas in the app).
const onScreen = text => {
  const term = threadView.term();
  if (!term || term.tnaiPaneId !== paneId || !term.element?.getClientRects().length) return false;
  const buffer = term.buffer.active;
  for (let row = 0; row < buffer.length; row++)
    if ((buffer.getLine(row)?.translateToString(true) || '').includes(text)) return true;
  return false;
};
if (threadView.mode() !== 'term') threadView.setMode('term');
check(
  !!(await until(() => onScreen('Technically Not42'), 8000)),
  'the CLI screen of its thread shows that output'
);

// Composer → the open thread: a task typed in the prompt box goes to its session.
const promptBox = document.getElementById('prompt');
promptBox.value = windows ? 'Write-Output ("DISPATCH" + (2*3))' : 'echo "DISPATCH$((2*3))"';
document.getElementById('send').click();
const dispatched = await until(
  async () => /DISPATCH6/.test((await window.tnaiNative.pty.replay(paneId))?.buffer || ''),
  10000
);
check(!!dispatched, 'composer task delivered to the open thread');
check(
  /DISPATCH/.test(window.TnaiLiveTasks.get(paneId)?.text || ''),
  'the app recorded the task for that thread (' +
    (window.TnaiLiveTasks.get(paneId)?.text || 'none') +
    ')'
);
check(
  /DISPATCH/.test((window.TnaiPromptRecall?.list() || []).slice(-1)[0] || ''),
  'the sent prompt is kept for Arrow Up recall (114)'
);

// A real Claude Code launch as a second thread: it should start and print its interface (no
// prompt is sent, so no usage).
const claude = await window.TnaiTest.startThread({ tool: 'Claude Code' }).catch(error => {
  log.push('info ' + error.message);
  return null;
});
check(!!claude, 'a second thread started with Claude Code');
if (claude) {
  const id = claude.paneId;
  check(
    !!(await until(() => window.TnaiThreadList.thread(id)?.tool === 'Claude Code', 5000)),
    'the thread list names its tool: ' + window.TnaiThreadList.thread(id)?.tool
  );
  const started = await until(async () => {
    const r = await window.tnaiNative.pty.replay(id);
    return r && r.buffer.length > 200 && r;
  }, 20000);
  check(!!started, 'Claude Code process started and produced output');
  if (started)
    log.push(
      '     claude output sample: ' +
        JSON.stringify(
          started.buffer
            .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '')
            .replace(/\s+/g, ' ')
            .slice(0, 160)
        )
    );
}

// Closing a thread ("Close thread" in its menu asks first, over the thread) stops its process.
for (const id of [paneId, claude?.paneId].filter(Boolean)) {
  window.TnaiThreads.show(id);
  await until(() => threadView.shown() === id, 6000);
  window.TnaiLiveTasks.close(id, island());
  const yes = await until(
    () => island().querySelector(':scope > .tnai-panel-confirm .tnai-ws-close-confirm'),
    4000
  );
  yes?.click();
  await until(() => !window.TnaiAgents.sessions().some(s => s.paneId === id), 6000);
}
const stopped = await until(async () => (await window.tnaiNative.pty.list()).length === 0, 8000);
check(stopped !== null, 'closing the threads stopped every process');

// window.prompt() is a real desktop dialog (the runner answers it), used by account and agent
// rename.
check(
  window.prompt('Name this workspace', '') === 'Named by test',
  'desktop prompt() dialog returns the typed value'
);

return { ok, log };
