/*
 * Technically Not tools · desktop-check/tests/saved-lazy.js — Saved, not-running sessions get a
 * terminal only when shown or started (15 offline agents were each built as a full terminal at
 * app start). This part makes three stopped sessions (the FAKE `claude` of
 * stopped-resume.main.js and two shells, each started as a thread, with a marker on its screen)
 * and reloads the window; saved-lazy.after.js checks the restore. Returns {ok, log, reload}.
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
const screen = async id =>
  ((await N.pty.replay(id))?.buffer || '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, ' ')
    .replace(/\s+/g, ' ');
const ids = [];

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  const claude = await openThread(CLAUDE, { accountId: '' });
  check(claude?.ok, 'Claude Code thread started');
  ids.push(claude?.paneId);
  if (
    !check(
      !!(await until(
        async () => /FAKE-claude fresh=[0-9a-f-]{36} \./.test(await screen(claude.paneId)),
        20000
      )),
      'the fake claude started'
    )
  )
    throw new Error(
      'the fake claude was not the one started: ' + (await screen(claude.paneId)).slice(-200)
    );
  check(
    !!(await until(() => G.sessions().find(s => s.paneId === claude.paneId)?.resumable, 8000)),
    'its conversation is reported as saved'
  );
  const sessionId = (await N.pty.list()).find(s => s.paneId === claude.paneId)?.sessionId;
  for (const n of [1, 2]) {
    const shell = await openThread('Terminal');
    check(shell?.ok, 'shell thread ' + n + ' started');
    ids.push(shell?.paneId);
    await wait(1500);
    N.pty.write(shell.paneId, 'echo lazy-mark-' + n + '\r');
    check(
      !!(await until(
        async () => (await screen(shell.paneId)).split('lazy-mark-' + n).length > 2,
        10000
      )),
      'shell ' + n + ' printed its marker'
    );
  }
  for (const id of ids) G.stop(id);
  check(
    !!(await until(
      () =>
        ids.every(id => {
          const s = G.sessions().find(x => x.paneId === id);
          return s && !s.running;
        }),
      10000
    )),
    'all three stopped'
  );
  await wait(800); // their records and screens are saved
  window.TnaiThreads.open();
  await wait(400);
  sessionStorage.setItem('tnai.test.saved-lazy', JSON.stringify({ ids, sessionId }));
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log, reload: true };
