/*
 * Technically Not tools · desktop-check/tests/context-upkeep.after.js — after the reload: the old
 * v1 settings seeded by context-upkeep.js were migrated once. Old defaults (clear 160k, never off)
 * now follow the new defaults (600k, never on); hand-set values (compact 250k, idle 5, skip Codex)
 * are kept; v1 is gone and v2 holds only the hand-set keys. Then a stale v1 is planted again for
 * .after2.js, which must ignore it (the migration runs once).
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
  P.clear === 600000 && P.never === true,
  'old defaults moved to the new defaults: clear ' + P.clear + ', never clear ' + P.never
);
check(
  P.compact === 250000 &&
    P.idle === 5 &&
    JSON.stringify(P.skip) === '["Codex"]' &&
    P.on === true &&
    P.auto === '',
  'hand-set values kept: compact ' +
    P.compact +
    ', idle ' +
    P.idle +
    ', skip ' +
    JSON.stringify(P.skip)
);
check(localStorage.getItem('tnai.context-upkeep.v1') === null, 'old v1 store removed');
check(
  JSON.stringify(v2) === JSON.stringify({ compact: 250000, idle: 5, skip: ['Codex'] }),
  'v2 holds only the hand-set keys: ' + JSON.stringify(v2)
);
localStorage.setItem(
  'tnai.context-upkeep.v1',
  JSON.stringify({
    on: false,
    compact: 90000,
    clear: 100000,
    never: false,
    idle: 9,
    skip: [],
    auto: 'compact',
  })
);
log.push('planted a stale v1 again before the second reload');
return { ok, log, reload: ok };
