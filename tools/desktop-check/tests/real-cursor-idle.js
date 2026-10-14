/*
 * Technically Not tools · desktop-check/tests/real-cursor-idle.js — a REAL Cursor Agent that has
 * finished its task must read as idle ("Waiting for input"), not "Needs you" (two short prompts on
 * its default model, a few cents of the user's usage). Its reply ends with a sentence that reads
 * like a question a CLI asks ("Do you want to proceed …"); with Cursor's idle input drawn under it,
 * that is not an open question, and an agent shown as "Needs you" can't be closed by `tnai close`
 * ("is working right now"). Then a real shell command: if Cursor stops to ask for
 * it, that one must still show as "Needs you". Use after changing `detectQuestion` / `IDLE` in
 * desktop/attention-service.js or when a Cursor Agent update changes its idle screen or its
 * permission question. Hard cap ~3 min.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const G = window.TnaiAgents,
  N = window.tnaiNative;

async function screen(paneId) {
  const r = await N.pty.replay(paneId);
  if (!r?.buffer) return '';
  const vt = new window.Terminal({
    cols: r.cols || 120,
    rows: r.rows || 30,
    scrollback: 0,
    allowProposedApi: true,
  });
  await new Promise(done => vt.write(r.buffer, done));
  const b = vt.buffer.active,
    rows = [];
  for (let y = 0; y < vt.rows; y++)
    rows.push(b.getLine(b.baseY + y)?.translateToString(true) || '');
  vt.dispose();
  return rows.join('\n');
}
const tail = async paneId =>
  (await screen(paneId))
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .slice(-14)
    .join(' / ');
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(250);
  }
  return null;
};
const trust = async () => {
  for (const ask of (await N.trust?.pending?.()) || []) await N.trust.answer(ask.id, true);
};
const itemsOf = async paneId =>
  ((await N.attention.list())?.items || []).filter(i => i.paneId === paneId);
const statusOf = paneId => G.sessions().find(s => s.paneId === paneId)?.status;
const started = [];
try {
  window.TnaiRoute('terminal');
  await wait(400);
  const S = (await G.open('Terminal'))?.paneId;
  started.push(S);
  check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );
  N.pty.write(
    S,
    'tnai new cursor --name "Cursor idle test" "Check of idle state, read-only, change no files and use no tools. Reply with exactly this sentence and nothing else: Do you want to proceed with the count?"\r'
  );
  const C = await until(async () => {
    await trust();
    return G.sessions().find(s => s.agent === 'Cursor Agent' && s.running)?.paneId;
  }, 40000);
  if (C) started.push(C);
  check(!!C, 'tnai new opened a Cursor Agent panel');
  if (C) {
    const ended = await until(async () => {
      await trust();
      return window.TnaiTurns?.get(C)?.endedAt;
    }, 90000);
    check(!!ended, 'Cursor answered and its task ended');
    await wait(2500); // past the quiet time after which the final screen is read for a question
    const items = await itemsOf(C);
    check(
      !items.length,
      'idle after a reply that reads like a question: no "Needs you" item' +
        (items.length ? ' (found ' + JSON.stringify(items.map(i => [i.kind, i.detail])) + ')' : '')
    );
    check(
      statusOf(C) === 'waiting',
      'its status is "waiting" (so `tnai close` may close it): ' + statusOf(C)
    );
    log.push('       idle screen: ' + (await tail(C)).slice(-500));

    // A real question: Cursor stops on a shell command unless its access level runs everything.
    const r = await N.pty.submit(
      C,
      'Run this exact shell command and tell me its output: echo tnai-idle-check'
    );
    log.push('       second prompt: ' + JSON.stringify(r));
    const asked = await until(
      async () =>
        (await itemsOf(C)).find(i => i.kind === 'menu') ||
        (window.TnaiTurns?.get(C)?.endedAt > ended ? 'ended' : null),
      60000
    );
    if (asked === 'ended' || !asked)
      log.push(
        'note Cursor ran the command without asking (or did not answer in time): the real-question half was not exercised'
      );
    else
      check(
        statusOf(C) === 'needs-you',
        'a real Cursor question still shows as "Needs you": ' + asked.detail
      );
    log.push('       screen then: ' + (await tail(C)).slice(-700));
  }
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
for (const p of started)
  try {
    G.stop(p);
  } catch {}
await wait(3000);
return { ok, log };
