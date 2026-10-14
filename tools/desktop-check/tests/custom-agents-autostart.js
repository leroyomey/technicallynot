// Technically Not tools · desktop-check/tests/custom-agents-autostart.js — A project custom agent
// (Claude Code, no prompt sent) saved with Auto-start on; the window reloads (the project opens
// again) and it must start exactly once. Continues in .after.js / .after2.js. Returns {ok, log,
// reload}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const C = window.TnaiCustomAgents;
check(!!C, 'TnaiCustomAgents present');
await Promise.resolve(window.TnaiSessionStart?.ready);
await wait(3000); // the app's own start settle (17) is over, like a user saving later
check(!!(await window.tnaiNative.fs.root()), 'a project folder is open');

// leftovers from an aborted run
for (const a of C.list().filter(x => x.name === 'Auto Starter')) await C.remove(a.id);
const agent = await C.create({
  name: 'Auto Starter',
  base: 'Claude Code',
  role: 'Starts with the project',
  scope: 'project',
});
check(agent?.scope === 'project', 'saved as a project agent');
await C.setAutoStart(agent.id, true);
check(C.get(agent.id)?.autoStart === true, 'Auto-start is on');

// past the session settle: the project is already open, so nothing starts in this window session
await wait(2500);
const running = (await window.tnaiNative.pty.list()).filter(
  s => s.customAgentId === agent.id && s.running
);
check(running.length === 0, 'not started without reopening the project (' + running.length + ')');
localStorage.setItem('tnai.test.autostartId', agent.id);
return { ok, log, reload: true };
