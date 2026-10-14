/*
 * Technically Not tools · desktop-check/tests/stopped-resume.js — An agent that stops while
 * Technically Not stays open resumes its conversation on the next start, against a FAKE `claude`
 * from stopped-resume.main.js (stops unless the fake is the one that started; no real CLI, no
 * usage): Start, a prompt sent to the stopped agent (wake) and Enter in its panel all start it with
 * `--resume <the same id>`; "New session" still starts a fresh one; a resume the CLI refuses at
 * once is not tried again. The panel showed the old conversation, the start
 * opened a new one. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
  return !!cond;
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
const G = window.TnaiAgents,
  N = window.tnaiNative,
  CLAUDE = 'Claude Code';
let paneId;
try {
  const opened = await window.TnaiTest.open(CLAUDE, { accountId: '' });
  check(opened?.ok, 'Claude Code panel opened');
  paneId = opened?.paneId;
  const view = () => G.sessions().find(s => s.paneId === paneId);
  const info = async () => (await N.pty.list()).find(s => s.paneId === paneId && s.running);
  const screen = async () =>
    ((await N.pty.replay(paneId))?.buffer || '')
      .replace(/\x1b\][^\x07]*\x07/g, '')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ');
  const last = async () => (await screen()).split('FAKE-claude ').pop();
  const stopped = async () => {
    G.stop(paneId);
    return until(() => view() && !view().running, 8000);
  };

  // Only the fake may run here: the real Claude Code would ask its folder-trust question and keep
  // its transcripts in the user's own folder.
  if (
    !check(
      !!(await until(async () => /FAKE-claude fresh=[0-9a-f-]{36} \./.test(await screen()), 20000)),
      'the fake claude started a fresh conversation'
    )
  )
    throw new Error('the fake claude was not the one started: ' + (await screen()).slice(-200));
  const id = (await info())?.sessionId;
  check(/^[0-9a-f-]{36}$/.test(id || ''), 'it has a session id (' + id + ')');
  check(!!(await until(() => view()?.resumable, 8000)), 'its conversation is reported as saved');
  check(view()?.canResume === false, 'a running session offers no resume');

  // Stopped while the app stays open: Start resumes the same conversation.
  check(!!(await stopped()), 'stopped');
  check(
    view()?.saved === false && view()?.canResume === true,
    'stopped in this app run (no saved record), and it can resume'
  );

  // A stopped thread's CLI screen is its saved screen: the screen the CLI left, whole, with the
  // app's note beside it and not written into it (the fake's cursor ends two rows up, like an
  // input box's, and a note at the cursor would cover its last rows).
  const island = window.TnaiThreads.slot('main');
  const savedScreen = async () => {
    window.TnaiThreads.show(paneId);
    await until(() => window.TnaiThreadView.shown() === paneId, 6000);
    if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
    return until(
      () =>
        island.querySelector('.tnt-term-box .tnt-term-host')?.dataset.saved &&
        window.TnaiThreadView.term(),
      10000
    );
  };
  const panel = () => window.TnaiThreadView.term();
  const panelRows = () => {
    const t = panel();
    if (!t) return [];
    const b = t.buffer.active,
      out = [];
    for (let y = 0; y < b.length; y++) out.push(b.getLine(y)?.translateToString(true) || '');
    return out;
  };
  const noteText = () => {
    const note = island.querySelector('.tnt-term-note');
    return note && note.getClientRects().length ? note.textContent.trim() : '';
  };
  check(!!(await savedScreen()), 'the stopped thread shows its saved screen');
  check(
    !!(await until(() => /saved screen.*enter/i.test(noteText()), 5000)),
    'the note beside the screen says what it is and which key starts it again ("' +
      noteText() +
      '")'
  );

  // the saved screen is laid out again for the island's width, so a short row can end a longer one
  const lastRows = ['first-run row 2', 'first-run row 3', 'first-run row 4'];
  const keptRows = () => lastRows.filter(r => panelRows().some(x => x.trimEnd().endsWith(r)));
  await until(() => keptRows().length === 3, 5000);
  if (!check(keptRows().length === 3, 'the last rows of the CLI are as it left them'))
    log.push('     rows: ' + JSON.stringify(panelRows().filter(Boolean)));

  // The thread's Terminal view shows the same session in its own terminal: the new run must not
  // draw over the old screen there either.
  window.TnaiThreads.show(paneId);
  await wait(300);
  window.TnaiThreadView.setMode('term');
  const focusRows = () =>
    [...document.querySelectorAll('.tnt-term-host .xterm-rows > div')].map(r =>
      r.textContent.replace(/ /g, ' ').trimEnd()
    );
  check(
    !!(await until(() => focusRows().some(r => /first-run row 4/.test(r)), 10000)),
    "the thread's Terminal view shows the stopped session's screen"
  );
  await G.start(paneId);
  check(
    !!(await until(async () => (await last()).startsWith('resumed=' + id), 15000)),
    'Start resumed the same conversation (--resume ' + id + ')'
  );
  check((await info())?.sessionId === id, 'the panel keeps its session id');
  const at = await until(() => {
    const i = focusRows().findIndex(r => r.includes('resumed=' + id));
    return i >= 0 ? i + 1 : 0;
  }, 8000);
  await wait(600);
  const under = at ? focusRows().slice(at).filter(Boolean) : ['(the new run never showed)'];
  if (
    !check(
      !!at && !under.length,
      'thread Terminal view: nothing of the old screen is left under the new run\u0027s first line'
    )
  )
    log.push('     under it: ' + JSON.stringify(under.slice(0, 6)));
  window.TnaiThreadView.setMode('read');
  await wait(400);

  // A prompt sent to the stopped agent (composer → wake) resumes too and arrives.
  check(!!(await stopped()), 'stopped again');

  // Each process has its own replay buffer, so "a new process that says resumed=<id>" is: running
  // under another pid, and its screen says so.
  const resumedSince = async pid => {
    const now = await info();
    return (
      !!now && now.pid !== pid && (await screen()).includes('FAKE-claude resumed=' + id + ' .')
    );
  };
  let pid = (await N.pty.list()).find(s => s.paneId === paneId)?.pid || view()?.pid;
  check(G.wake(paneId, 'hello after wake') === true, 'wake() accepted the prompt');
  check(
    !!(await until(() => resumedSince(pid), 15000)),
    'the woken agent resumed the same conversation'
  );

  // Not checked here: the prompt's arrival. It is sent once Claude Code connects to Technically Not
  // (flushQueued), which the fake never does.
  pid = (await info())?.pid;
  check((await info())?.sessionId === id, 'still the same session id');

  // Enter in the stopped panel resumes as well.
  check(!!(await stopped()), 'stopped a third time');
  G.stoppedInput(paneId, '\r');
  check(
    !!(await until(
      async () => (await resumedSince(pid)) && (await info())?.sessionId === id,
      15000
    )),
    'Enter in the stopped panel resumed the same conversation'
  );

  // "New session" (resume: false) still starts a fresh one.
  for (let i = 0; i < 60; i++) N.pty.write(paneId, 'fill ' + i + '\r');
  check(
    !!(await until(async () => (await screen()).includes('got fill 59'), 10000)),
    'the fake printed more lines than the panel has rows'
  );

  // This stop comes with the thread's CLI screen open on the running agent: the screen becomes
  // the saved screen where it stands, with the same note, without the thread being left and
  // opened again.
  window.TnaiThreads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 6000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  const liveHost = await until(
    () => window.TnaiThreadView.term() && island.querySelector('.tnt-term-box .tnt-term-host'),
    6000
  );
  check(
    !!liveHost && !liveHost.dataset.saved && noteText() === '',
    'running, its CLI screen is the live terminal with no note ("' + noteText() + '")'
  );
  check(!!(await stopped()), 'stopped a fourth time');
  check(
    !!(await until(
      () =>
        island.querySelector('.tnt-term-box .tnt-term-host')?.dataset.saved &&
        /saved screen.*enter/i.test(noteText()),
      6000
    )),
    'stopped with its CLI screen open: the note comes where the screen stands ("' +
      noteText() +
      '")'
  );

  // A long stopped screen is kept whole: the saved screen holds the newest line and the lines
  // above it, and the note is still beside it. (How the saved screen is laid out for the
  // island's width is the test `thread-saved-screen`.)
  await savedScreen();
  await until(() => panelRows().some(r => r.includes('got fill 59')), 5000);
  check(
    panelRows().some(r => r.includes('got fill 59')) &&
      panelRows().some(r => r.includes('got fill 30')),
    'a stopped screen longer than the island keeps its newest line and the lines above it (saved mark "' +
      (island.querySelector('.tnt-term-box .tnt-term-host')?.dataset.saved || '') +
      '", note "' +
      noteText() +
      '", ' +
      panelRows().filter(Boolean).length +
      ' lines, the last: ' +
      JSON.stringify(panelRows().filter(Boolean).slice(-2)) +
      ')'
  );
  await G.start(paneId, { resume: false });
  check(
    !!(await until(async () => /^fresh=[0-9a-f-]{36}/.test(await last()), 15000)),
    'start({ resume: false }) started a fresh conversation'
  );
  const id2 = (await info())?.sessionId;
  check(!!id2 && id2 !== id, 'with a new session id');
  check(
    !!(await until(() => view()?.resumable, 8000)),
    'the new conversation is reported as saved'
  );

  // A resume the CLI refuses at once is not repeated: the next start is a new session.
  G.send(paneId, 'refuse');
  check(
    !!(await until(async () => /will refuse/.test(await last()), 8000)),
    'the fake will refuse its next resume'
  );
  check(!!(await stopped()), 'stopped a fifth time');
  await G.start(paneId);
  check(
    !!(await until(() => view() && !view().running && view().exitCode === 1, 15000)),
    'the refused resume ended with exit code 1'
  );
  check(view()?.canResume === false, 'the refused conversation is not offered again');
  await G.start(paneId);
  check(
    !!(await until(
      async () => /^fresh=[0-9a-f-]{36}/.test(await last()) && (await info())?.sessionId !== id2,
      15000
    )),
    'the next start is a new session, not the same failure'
  );
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
if (paneId) {
  G.stop(paneId);
  await wait(400);
}
return { ok, log };
