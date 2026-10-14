/*
 * Technically Not tools · desktop-check/tests/context-upkeep.after2.js — second reload: the
 * migration ran once. The v2 store from the first migration is unchanged and a stale v1 planted
 * afterwards is ignored (prefs are the same as after the first reload).
 */
const log = [];
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const P = window.TnaiContextUpkeep?.prefs?.() || {};
const v2 = JSON.parse(localStorage.getItem('tnai.context-upkeep.v2') || 'null');
check(
  JSON.stringify(v2) === JSON.stringify({ compact: 250000, idle: 5, skip: ['Codex'] }),
  'second load: v2 unchanged ' + JSON.stringify(v2)
);
check(
  P.on === true &&
    P.compact === 250000 &&
    P.clear === 600000 &&
    P.never === true &&
    P.idle === 5 &&
    P.auto === '' &&
    JSON.stringify(P.skip) === '["Codex"]',
  'second load: prefs unchanged, stale v1 ignored ' + JSON.stringify(P)
);
localStorage.removeItem('tnai.context-upkeep.v1');
return { ok, log };
