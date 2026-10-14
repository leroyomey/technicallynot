/*
 * Technically Not tools · desktop-check/tests/permission-reload.js — A tool-permission prompt (45 +
 * agent-hooks.js askPermission) survives a window reload: one asked before the reload and one asked
 * while it runs are both shown again on the reloaded page and answered from its card (continues in
 * permission-reload.after.js). No CLI, no credits.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(40);
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
const card = () => document.querySelector('.tnai-perm');
try {
  const url = await main('register', 'perm-reload-pane');
  check(/\/hook\/[0-9a-f]{32}$/.test(url || ''), 'hooks registered for a pane without a CLI');
  await main('ask', 'before', url, 'Bash', { command: 'rm -rf before-reload' });
  check(
    await until(() => card() && !card().hidden && /before-reload/.test(card().textContent)),
    'card shown before the reload'
  );
  await main('askOnReload', 'during', url, 'Bash', { command: 'rm -rf during-reload' });
  return { ok, log, reload: true };
} catch (error) {
  check(false, 'error: ' + (error.stack || error.message));
}
return { ok, log };
