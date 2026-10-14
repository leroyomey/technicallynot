// Technically Not tools · desktop-check/tests/thread-limit.js — "Usage limit reached" in the
// thread it stops (src/scripts/125-thread-limit.js; the words on the thread's row are 119's), in
// the real app with a throwaway profile. Two PowerShell panels, no agent CLI and no usage: one
// prints the line an agent CLI prints at its limit, so the app's own detection (15) reports it.
// The card stands in the open thread's row between the conversation and the prompt box only
// while that thread is the paused one; the list row says the limit in words; Resume at reset
// plans it; Resume clears it. Picture: thread-limit-card. Returns {ok, log}.
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
    await wait(50);
  }
  return null;
};
const threads = window.TnaiThreads,
  agents = window.TnaiAgents,
  accounts = window.TnaiAccounts,
  resume = window.TnaiLimitResume;
const shown = el => !!el && el.getClientRects().length > 0;
const box = el => el.getBoundingClientRect();
const n = v => Math.round(v * 10) / 10;

try {
  await until(() => threads?.visible(), 8000);
  check(
    !!window.TnaiThreadLimit && !!resume?.resumeNow,
    'the limit card and the resume plan are loaded'
  );
  await agents.detect(true);
  const first = await window.TnaiTest.open('Terminal'),
    second = await window.TnaiTest.open('Terminal');
  check(
    !!first?.ok &&
      !!second?.ok &&
      !!(await until(() => agents.sessions().filter(s => s.running).length >= 2, 20000)),
    'setup: two PowerShell panels running'
  );
  await wait(1500);

  // Starting a panel may leave the app on the Terminal page: the thread is looked at on Threads.
  threads.open();
  await until(() => threads.visible(), 3000);
  const main = threads.slot('main'),
    list = threads.slot('list');
  const card = () => main.querySelector('.tnt-asks > .tnt-limit');
  const rowOf = id => list.querySelector('.tnt-th[data-pane="' + id + '"]');

  threads.select(first.paneId);
  await wait(400);
  check(!card(), 'no limit: no card');

  // The line an agent CLI prints at its limit, put together in the shell so that the typed command
  // itself does not hold it.
  agents.send(
    first.paneId,
    "$a='5-hour limit'; $b=' reached'; Write-Output ($a + $b + ' ∙ resets 11:58pm')"
  );
  check(
    !!(await until(() => accounts.limitFor(first.paneId), 6000)),
    "the app's own detection reports the limit on the first panel"
  );
  check(!!(await until(() => shown(card()), 3000)), 'the card stands in the open thread');
  const asks = main.querySelector('.tnt-asks'),
    promptBox = document.querySelector('footer.composer');
  check(
    card().parentElement === asks && box(card()).bottom <= box(promptBox).top + 1,
    'in the row between the conversation and the prompt box (card ends ' +
      n(box(card()).bottom) +
      ', prompt box starts ' +
      n(box(promptBox).top) +
      ')'
  );
  const words = card().textContent.replace(/\s+/g, ' ');
  check(
    /Usage limit reached/.test(words) && /Resume at reset/.test(words) && /Resume/.test(words),
    'it says what happened and what can be done: ' + words.slice(0, 150)
  );
  check(
    !shown(card().querySelector('[data-limit="switch"]')),
    'no "Resume now on another account" when no other account is free'
  );
  const rowWords = (rowOf(first.paneId)?.textContent || '').replace(/\s+/g, ' ');
  check(
    !!(await until(() => /limit/i.test(rowOf(first.paneId)?.textContent || ''), 3000)),
    'the thread list row says the limit in words: ' +
      (rowOf(first.paneId)?.textContent || rowWords).replace(/\s+/g, ' ').slice(0, 90)
  );
  console.log('TNAI_SHOT:thread-limit-card');
  await wait(600);

  // The card belongs to the paused thread only.
  threads.select(second.paneId);
  check(!!(await until(() => !card(), 3000)), 'another thread open: no card there');
  threads.select(first.paneId);
  check(!!(await until(() => shown(card()), 3000)), 'back on the paused thread: the card is there');

  // Resume at reset plans it; Resume clears the limit and the card goes.
  card().querySelector('[data-limit="reset"]').click();
  check(
    !!(await until(
      () => resume.pending().find(entry => entry.paneId === first.paneId)?.scheduled,
      3000
    )) && card().querySelector('[data-limit="reset"]').getAttribute('aria-pressed') === 'true',
    '"Resume at reset" plans it, and the button shows it is on'
  );
  card().querySelector('[data-limit="now"]').click();
  check(!!(await until(() => !accounts.limitFor(first.paneId), 8000)), '"Resume" clears the limit');
  check(!!(await until(() => !card(), 3000)), 'and the card is gone');

  agents.sessions().forEach(s => agents.stop(s.paneId));
  await until(() => !agents.sessions().some(s => s.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
