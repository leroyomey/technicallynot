/*
 * Technically Not tools · desktop-check/tests/stress-soak.after.js — After the soak's reload
 * (profiled from stress-soak.js): warm reload timeline and CPU self time by script file / function
 * during load, so heavy synchronous start-up work shows up by name.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
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
let ok = true;
try {
  for (let i = 0; i < 100 && !performance.getEntriesByName('tnai:loader-gone').length; i++)
    await wait(50);

  // work queued right after load (timers, first detection) lands in the profile too
  await wait(1500);
  const p = await main('profileStop'),
    mark = n => Math.round(performance.getEntriesByName(n)[0]?.startTime ?? -1);
  const nav = performance.getEntriesByType('navigation')[0];
  log.push(
    'reload: first paint ' +
      Math.round(performance.getEntriesByName('first-paint')[0]?.startTime ?? -1) +
      ' ms, scripts done ' +
      mark('tnai:scripts-done') +
      ' ms, load ' +
      Math.round(nav.loadEventEnd) +
      ' ms, loader gone ' +
      mark('tnai:loader-gone') +
      ' ms'
  );
  log.push('CPU self time by file (reload + 1.5 s):', ...p.files.map(s => '  ' + s));
  log.push('top functions:', ...p.fns.map(s => '  ' + s));
  ok = mark('tnai:loader-gone') > 0;
  log.push((ok ? 'ok   ' : 'FAIL ') + 'loader removed after reload');
} catch (error) {
  ok = false;
  log.push('FAIL stopped: ' + error.message);
}
return { ok, log };
