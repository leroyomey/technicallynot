/*
 * * Technically Not tools · desktop-check/tests/composer-keep-typing.js — The fault: a
 * * prompt the user was typing or dictating was wiped while an agent started. A composer send
 * clears
 * * the box at once, then waits (a new agent starting, attachments saving); text the user types or
 * * dictates in that wait must survive the send finishing. A fake Claude Code thread
 * * (agent-mesh.main.js's fake CLI, no credits) stands in for the new agent: TnaiTeam.startLead is
 * * slowed to 1.5 s and returns that thread's session, so Ctrl+Enter (new agent) goes through the
 * real deliver()
 * * path.
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
    await wait(50);
  }
  return null;
};
const G = window.TnaiAgents,
  team = window.TnaiTeam,
  realStart = team?.startLead;
try {
  const cs = await window.TnaiTest.startThread({ tool: 'Claude Code', waitMs: 10000 }).catch(
    () => null
  );
  const cPane = cs?.paneId;
  check(!!cs, 'fake Claude Code thread running');
  check(!!realStart, 'TnaiTeam.startLead exists');
  await wait(1500);
  let started = 0;
  team.startLead = async () => {
    started++;
    await wait(1500);
    return G.sessions().find(s => s.paneId === cPane);
  };
  window.TnaiThreads.open();
  await wait(600);
  const prompt = document.getElementById('prompt');
  prompt.value = 'first task ' + Date.now();
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  prompt.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })
  );
  await until(() => started, 3000);
  check(started === 1 && prompt.value === '', 'send cleared the box and a new agent is starting');
  const typed = 'second prompt the user is typing';
  prompt.value = typed;

  // typed or dictated (70 inserts the same way) mid-send
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(2500); // startLead resolves, the send finishes
  check(
    prompt.value === typed,
    'text typed during the send survives it (got ' + JSON.stringify(prompt.value) + ')'
  );
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  G.stop(cPane);
  await wait(500);
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
if (realStart) team.startLead = realStart;
return { ok, log };
