/*
 * Technically Not tools · desktop-check/tests/thread-start-speed.js — Measuring test, no
 * thresholds: how long a new thread takes from the call that starts it to something on screen.
 * For PowerShell (three starts: the first is the cold one) and a real Claude Code launch (no
 * prompt is sent, so no usage): start → the start call answered (Technically Not's own
 * preparation: rules, hooks, mesh, worktree) → its row in the thread list → first output byte →
 * the program ready for input (PowerShell: its "PS " prompt; Claude Code: its input box). Prints
 * the numbers; fails only when a thread never starts.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 30000, step = 15) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(step);
  }
  return null;
};
const native = window.tnaiNative,
  agents = window.TnaiAgents;
const firstData = new Map(),
  lastData = new Map(); // paneId -> time of its first / newest output
native.pty.onData(batch => {
  const now = performance.now();
  for (const item of Array.isArray(batch) ? batch : [batch]) {
    const id = item?.paneId ?? item?.[0];
    if (!id) continue;
    if (!firstData.has(id)) firstData.set(id, now);
    lastData.set(id, now);
  }
});
const strip = s =>
  String(s || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07]*(\x07|\x1b\\)/g, '');

const detected = await agents.detect(true);
window.TnaiThreads.open();
await wait(500);
const rowOf = paneId =>
  document.querySelector('.tnt-th[data-pane="' + CSS.escape(paneId) + '"]:not(.tnt-sub)');

async function measure(agent, ready, label) {
  const t0 = performance.now();
  const opened = await window.TnaiTest.open(agent);
  const answered = performance.now();
  const paneId = opened?.paneId || '';
  const running = await until(
    () => agents.sessions().find(s => s.paneId === paneId && s.running) && performance.now(),
    30000
  );
  const listed = await until(() => rowOf(paneId) && performance.now(), 30000);
  const first = await until(() => firstData.get(paneId), 30000);

  // Ready = the program stopped drawing: its newest output once nothing more came for 1.2 s (a
  // prompt text differs per shell and CLI version).
  const done = await until(
    () =>
      lastData.get(paneId) &&
      performance.now() - lastData.get(paneId) > 1200 &&
      lastData.get(paneId),
    30000,
    40
  );
  const seen = ready(strip((await native.pty.replay(paneId))?.buffer));
  const r = v => (v ? Math.round(v - t0) : null);
  check(
    !!paneId && !!running && !!first,
    label +
      ': start answered after ' +
      r(answered) +
      ' ms, running after ' +
      r(running) +
      ' ms, its row in the thread list after ' +
      r(listed) +
      ' ms, first output after ' +
      r(first) +
      ' ms, finished drawing after ' +
      r(done) +
      ' ms' +
      (seen ? '' : ' (its prompt text was not recognised)')
  );
  return paneId;
}

const ps = [];
for (let i = 1; i <= 3; i++)
  ps.push(
    await measure('Terminal', text => /PS [A-Z]:\\[^\n]*>\s*$/.test(text), 'PowerShell start ' + i)
  );
if (detected.get('Claude Code')?.installed)
  await measure(
    'Claude Code',
    text => /\? for shortcuts|bypass permissions|│\s*>|❯/.test(text),
    'Claude Code (real, no prompt sent)'
  );
else log.push('skip Claude Code: not installed');

// A new lead started the way the prompt box starts one (19 startLead): its panel is handed to the
// caller (onOpened) as soon as it exists, well before the tool is ready, so the prompt box can open
// its thread at once instead of after the start (no prompt is sent).
if (detected.get('Claude Code')?.installed && window.TnaiTeam?.startLead) {
  const began = performance.now();
  let openedAfter = 0;
  let openedPane = '';
  const lead = await window.TnaiTeam.startLead({
    here: true,
    agent: 'Claude Code',
    onOpened: paneId => {
      openedAfter = performance.now() - began;
      openedPane = paneId;
    },
  });
  const readyAfter = performance.now() - began;
  log.push(
    'time a new lead: its panel handed over after ' +
      Math.round(openedAfter) +
      ' ms, ready for its prompt after ' +
      Math.round(readyAfter) +
      ' ms'
  );
  check(
    !!lead?.paneId &&
      openedPane === lead.paneId &&
      openedAfter > 0 &&
      openedAfter < readyAfter - 300,
    "a new lead's panel is handed over before the tool is ready, so its thread can open at once (" +
      (lead?.error || Math.round(openedAfter) + ' ms against ' + Math.round(readyAfter) + ' ms') +
      ')'
  );
}
for (const s of agents.sessions().filter(s => s.running))
  await agents.stop(s.paneId).catch(() => {});

// Let the programs finish closing: leaving the app in the middle of that crashed it (0xC0000409)
// after RESULT: PASS.
await until(() => !agents.sessions().some(s => s.running), 10000, 50);
await wait(300);
return { ok, log };
