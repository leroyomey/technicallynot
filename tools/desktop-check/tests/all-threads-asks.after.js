// Technically Not tools · desktop-check/tests/all-threads-asks.after.js — after the reload
// (all-threads-asks.js saved the view `list` before it): the All threads page starts with the
// threads, whatever was saved. What the page STARTED with is read (`startedAs`), then the page is
// opened as the three-dots menu opens it and looked at. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
try {
  const preview = await until(() => window.TnaiTerminalPreview);

  // the app finishes starting (it opens its own start page) before another page is asked for
  await Promise.resolve(window.TnaiSessionStart?.ready);
  await wait(1500);
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('tnai.terminal-preview.v1') || '{}');
  } catch {
    saved = {};
  }
  check(
    saved.view === 'list' && saved.v === 2,
    'the saved view the window loaded with is "list" (' + JSON.stringify(saved) + ')'
  );
  const view = document.getElementById('terminalView');
  const asked = Date.now();

  // The app may still open its own start page once: the page is asked for again until it stays.
  const shows = await until(
    async () => (await window.TnaiTest.openAllThreads(500)) && window.TnaiAllThreads?.state().on,
    30000
  );
  log.push(
    'note the threads were on the page ' + (Date.now() - asked) + ' ms after they were asked for'
  );
  check(
    !!shows,
    'the All threads page shows the threads (page ' +
      document.querySelector('.layout')?.className +
      ', ' +
      Math.round(view.getBoundingClientRect().width) +
      ' px)'
  );
  check(!view.querySelector('.tp-agents')?.isConnected, 'the list of terminals is not in the page');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
return { ok, log };
