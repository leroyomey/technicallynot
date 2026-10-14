/*
 * Technically Not tools · desktop-check/tests/remote-two.js — the window's side of the two-app
 * check (tools/desktop-check/remote-check.js): it only keeps the app open while that script drives
 * it through remote-two.main.js (the real `remote:*` calls are made from this window). Run by
 * itself (check.js, run-all.js) it does nothing and passes at once, saying where the real check is.
 * Returns {ok, log}.
 */
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + Math.random().toString(36).slice(2);
    (window.__tnaiMainDone ||= {})[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
if (!(await main('driven')))
  return {
    ok: true,
    log: [
      'ok   nothing to do here: the two-app check is `node tools/desktop-check/remote-check.js`',
    ],
  };

// answered when remote-check.js is done with this app (it usually quits the app first)
await main('untilEnd');
return { ok: true, log: ['ok   driven by remote-check.js'] };
