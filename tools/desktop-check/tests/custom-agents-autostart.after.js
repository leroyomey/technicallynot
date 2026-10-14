// Technically Not tools · desktop-check/tests/custom-agents-autostart.after.js — After the reload:
// the Auto-start project agent starts once, and a project-changed event does not start a second
// copy.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(150);
  }
  return null;
};
const id = localStorage.getItem('tnai.test.autostartId');
const copies = async () =>
  (await window.tnaiNative.pty.list()).filter(s => s.customAgentId === id && s.running);
check(!!id && !!window.TnaiCustomAgents?.get(id), 'project agent still saved after the reload');
check(
  !!(await until(async () => (await copies()).length >= 1)),
  'started by itself when the project opened'
);
await wait(3000);
check((await copies()).length === 1, 'exactly one copy running (' + (await copies()).length + ')');
window.dispatchEvent(
  new CustomEvent('tnai:project-changed', { detail: { root: await window.tnaiNative.fs.root() } })
);
await wait(3000);
check(
  (await copies()).length === 1,
  'project event again: still one copy (' + (await copies()).length + ')'
);
console.log('TNAI_SHOT:autostart-running');
return { ok, log, reload: true };
