// Technically Not tools · desktop-check/tests/custom-agents-autostart.after2.js — Reloaded again
// while the agent still runs: the restored pane is found, no second copy starts. Cleans up.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const id = localStorage.getItem('tnai.test.autostartId'),
  C = window.TnaiCustomAgents;
const copies = async () =>
  (await window.tnaiNative.pty.list()).filter(s => s.customAgentId === id && s.running);
await wait(6000); // past the session settle and any auto-start
const n = (await copies()).length;
check(n === 1, 'reload while running: still exactly one copy (' + n + ')');
for (const s of await copies()) await window.TnaiAgents.stop(s.paneId);
await wait(1500);
try {
  await C.remove(id);
  check(!C.get(id), 'test agent removed');
} catch (e) {
  check(false, 'remove: ' + e.message);
}
localStorage.removeItem('tnai.test.autostartId');
return { ok, log };
