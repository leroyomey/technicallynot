// Technically Not tools · desktop-check/tests/top-bar-centered.js — every part of the top bar has
// the same room over it (to the window's edge) as under it (to the islands), within 3 px. It stood
// 10 px from the top and 22 from the islands once.
// Returns {ok, log}.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
await wait(1200);
const log = [];
const bar = document.querySelector('.top');
const island = window.TnaiThreads.slot('list');
const top = island.getBoundingClientRect().top;
let worst = 0;
for (const part of bar.querySelectorAll(
  '.brand, .project, .pg-chip, .tnt-menu-btn, #pgBell, button'
)) {
  if (!part.getClientRects().length) continue;
  const at = part.getBoundingClientRect();
  const over = Math.round(at.top);
  const under = Math.round(top - at.bottom);
  worst = Math.max(worst, Math.abs(over - under));
  log.push(
    (part.id || part.className).toString().slice(0, 28) + ': ' + over + ' over, ' + under + ' under'
  );
}
log.push(
  'bar ' +
    Math.round(bar.getBoundingClientRect().height) +
    ' px, islands start at ' +
    Math.round(top)
);
console.log('TNAI_SHOT:top-bar-centered-look');
await wait(600);
return { ok: worst <= 3, log };
