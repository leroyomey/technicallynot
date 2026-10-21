// Technically Not tools · desktop-check/tests/test-monitor.js — a test window opens on a monitor
// other than the main (primary) one, where the user works (desktop/main.js testWindowPlace; user
// 2026-10-21: "do it on the second monitor"). Prints both.
const log = [];
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const where = await main('where');
log.push('info ' + JSON.stringify(where));
const ok = where.apart;
log.push((ok ? 'ok   ' : 'FAIL ') + 'the test window is not on the main (primary) monitor');
return { ok, log };
