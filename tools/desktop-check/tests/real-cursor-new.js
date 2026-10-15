/*
 * Technically Not tools · desktop-check/tests/real-cursor-new.js — `tnai new cursor TASK` with a
 * REAL Cursor Agent (one one-word prompt on its default model, a few cents of the user's usage):
 * the task must start by itself, not sit in Cursor's input waiting for Enter (the fault: the
 * message reached the terminal, but Cursor Agent never sent it). A PowerShell
 * panel runs the command, Technically Not's folder-trust question is answered, and the log says
 * what prompt-submit.js did (Enters pressed, what stopped its retries) and what Cursor's screen
 * shows. Use after changing desktop/prompt-submit.js, `spawnThenDeliver` in desktop/agent-mesh.js,
 * 47 `whenReady`, or when a Cursor Agent update changes how it takes a pasted prompt. Hard cap ~3
 * min.
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
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const trust = async () => {
  for (const ask of (await N.trust?.pending?.()) || []) await N.trust.answer(ask.id, true);
};
const started = [];
try {
  // The sender is a PowerShell thread, started the way "New thread" starts one.
  const S = (await window.TnaiTest.startThread({ tool: 'Terminal' })).paneId;
  started.push(S);
  check(
    !!(await until(async () => />/.test(await screen(S)), 20000)),
    'PowerShell sender panel ready'
  );
  const t0 = Date.now();
  N.pty.write(
    S,
    'tnai new cursor --name "Cursor send test" "Check of sending, read-only, change no files and use no tools. Reply with exactly one word: pong"\r'
  );

  // The real case: an agent runs `tnai new` while the user is on another page, so the new panel is
  // never on screen (its pty stays 80×24).
  window.TnaiThreads.open();
  const C = await until(async () => {
    await trust();
    return G.sessions().find(s => s.agent === 'Cursor Agent' && s.running)?.paneId;
  }, 40000);
  if (C) started.push(C);
  check(!!C, 'tnai new opened a Cursor Agent panel (' + (Date.now() - t0) + ' ms)');
  if (C) {
    const typedIn = await until(async () => {
      await trust();
      return /exactly one word: pong/.test((await screen(C)).replace(/\s+/g, ' '));
    }, 50000);
    check(!!typedIn, "the task reached Cursor's screen (" + (Date.now() - t0) + ' ms)');

    // The user looks at the new agent now: its thread opens on its CLI screen, which replays the
    // output so far and answers Cursor's color questions a second time. Those answers are written
    // into the panel between our Enters (`replies` in the line below); they must not stop the
    // retries.
    window.TnaiThreads.show(C);
    await until(() => window.TnaiThreadView.shown() === C, 6000);
    if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');

    // Started = Cursor's own record shows the task, or its screen shows it working / answering (the
    // echo of the task itself holds "pong" once).
    const began = await until(async () => {
      const t = window.TnaiTurns?.get(C);
      if (t?.task && /pong/.test(t.task)) return 'its record';
      const s = (await screen(C)).replace(/\s+/g, ' ');
      return /ctrl\+c to stop|Add a follow-up/i.test(s) || s.split(/pong/i).length > 2
        ? 'its screen'
        : null;
    }, 45000);
    const did = await main('did', C).catch(e => ({ error: e.message }));
    check(
      !!began,
      'the task started by itself, seen in ' +
        (began || 'nothing') +
        ' after ' +
        (Date.now() - t0) +
        ' ms; prompt-submit: ' +
        JSON.stringify(did)
    );
    if (!began) log.push('       Cursor screen: ' + (await tail(C)).slice(-900));
    log.push('       sender screen: ' + (await tail(S)).slice(-300));
    if (began) await until(() => window.TnaiTurns?.get(C)?.endedAt, 40000);
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
