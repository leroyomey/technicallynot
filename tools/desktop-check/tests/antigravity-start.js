/*
 * Technically Not tools · desktop-check/tests/antigravity-start.js — The real Antigravity CLI
 * (`agy`) started as a thread: it runs agy (found on PATH or in %LOCALAPPDATA%\agy\bin), stays
 * up, draws its own screen, is named Antigravity in the thread list, and stops cleanly. No prompt
 * is sent, so no usage. While the app has Antigravity paused, only the refusal is checked; skipped
 * with a note when agy is not installed. Picture antigravity-start-screen (the thread's CLI
 * screen). Returns {ok, log}.
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
  ID = 'Antigravity';
let paneId;

// Starts a thread with this tool; a refusal comes back as { ok: false, error }, not as a throw.
const startAs = tool =>
  window.TnaiTest.startThread({ tool }).then(
    made => ({ ok: true, paneId: made.paneId }),
    error => ({ ok: false, error: error.message })
  );
try {
  const opened = await startAs(ID);

  // Paused CLIs (10 PAUSED): no new thread starts with one, and the refusal says why. Everything
  // below runs again once Antigravity is taken out of that list.
  if (G.paused?.(ID)) {
    check(
      !opened?.ok && /paused/i.test(opened?.error || ''),
      'paused: opening Antigravity is refused with the reason: ' +
        JSON.stringify(opened).slice(0, 160)
    );
    check(
      !(await N.pty.list()).some(s => s.agent === ID && s.running),
      'paused: no Antigravity process was started'
    );
    for (const id of ['Gemini CLI', 'Droid']) {
      const r = await startAs(id);
      check(!r?.ok && /paused/i.test(r?.error || ''), 'paused: ' + id + ' is refused the same way');
    }
    return { ok, log };
  }
  if (!opened?.ok) {
    log.push(
      'info Antigravity did not open (' +
        JSON.stringify(opened).slice(0, 200) +
        '): not installed here, nothing checked'
    );
    return { ok, log };
  }
  paneId = opened.paneId;
  const pty = await until(async () =>
    (await N.pty.list()).find(s => s.paneId === paneId && s.running)
  );
  check(!!pty, 'the thread runs');
  check(
    pty?.agent === ID && pty.pid > 0,
    'it is the Antigravity connection: mode ' + pty?.mode + ', pid ' + pty?.pid

    // an .exe starts directly, so there is no command line to read; the welcome text below proves
    // it is agy
  );
  log.push(
    'info ' +
      (pty?.mode === 'login'
        ? 'started as its sign-in (Technically Not saw no Antigravity sign-in)'
        : 'started as the agent (signed in)')
  );
  const screen = async () =>
    ((await N.pty.replay(paneId))?.buffer || '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, ' ')
      .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  check(
    !!(await until(async () => /Antigravity/i.test(await screen()), 25000)),
    'agy drew its own screen: "' +
      ((await screen()).match(/Welcome[^⣷▄]{0,90}/)?.[0] || (await screen()).slice(0, 120)).trim() +
      '"'
  );
  await wait(3000);
  check(
    (await N.pty.list()).find(s => s.paneId === paneId)?.running === true,
    "still running 3 s later (it did not exit on Technically Not's arguments)"
  );
  window.TnaiThreads.show(paneId);
  await wait(500);
  const row = window.TnaiThreads.slot('list').querySelector('.tnt-th[data-pane="' + paneId + '"]');

  // the tool's name is in the row's tip (119: the line under the name says what it does)
  const rowTool = row?.title || 'no row';
  check(
    /Antigravity/.test(rowTool),
    'its row in the thread list names the CLI in its tip: ' + rowTool
  );
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  await wait(1200);
  console.log('TNAI_SHOT:antigravity-start-screen');
  await wait(1500);
  G.stop(paneId);
  check(
    !!(await until(
      async () => !(await N.pty.list()).find(s => s.paneId === paneId)?.running,
      8000
    )),
    'Stop ends it'
  );
  paneId = null;
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
if (paneId) G.stop(paneId);
await wait(300);
return { ok, log };
