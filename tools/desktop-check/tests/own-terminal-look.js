// Technically Not tools · desktop-check/tests/own-terminal-look.js — the user's own terminal (136)
// with the renderer the app really uses (the GPU one; `run.js` RENDERER_TESTS), which the other
// window tests do not have. The terminal is drawn with no background of its own, so the side
// column's see-through island shows behind its text: that is asked of the GPU renderer here and
// looked at in a picture in Dark and in Light. Checked: the terminal draws on a canvas, a typed
// command shows its output, and the terminal paints no fill of its own.
// Returns {ok, log}.
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
const shot = async name => {
  await wait(400);
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const own = () => window.TnaiOwnTerminal;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
let ownId = '';

try {
  await until(() => threads?.visible());
  window.TnaiThreadSide.open('terminal');
  ownId = (await until(() => own().paneId(), 15000)) || '';
  check(
    !!(await until(
      () => agents.sessions().some(one => one.paneId === ownId && one.running),
      20000
    )),
    'the terminal starts from the tab'
  );
  const term = await until(
    () =>
      agents
        .views()
        .find(view => view.paneId === ownId && view.term.element?.closest('.tnt-ownterm-host'))
        ?.term,
    10000
  );
  const host = document.querySelector('.tnt-ownterm-host');
  check(
    !!(await until(() => host.querySelector('.xterm-screen canvas'), 8000)),
    "it draws on a canvas (the app's own renderer, not the tests')"
  );
  await until(() => textOf(term).trim().length > 0, 30000);
  term.input("Write-Host ('own-terminal' + '-ok')\r", true);
  check(
    !!(await until(() => textOf(term).includes('own-terminal-ok'), 15000)),
    'a typed command shows its output'
  );
  const fills = ['.xterm', '.xterm-viewport', '.xterm-scrollable-element', '.xterm-screen']
    .map(selector => host.querySelector(selector))
    .filter(Boolean)
    .map(part => getComputedStyle(part).backgroundColor);
  check(
    fills.every(fill => /rgba\(\d+, \d+, \d+, 0\)|transparent/.test(fill)),
    'the terminal paints no fill of its own (' + fills.join(' | ') + ')'
  );
  check(
    term.options.allowTransparency === true && /00$/.test(term.options.theme.background),
    'its background color has no strength (' + term.options.theme.background + ')'
  );
  await shot('own-terminal-look-dark');
  window.TnaiTheme.set('light');
  await shot('own-terminal-look-light');
  window.TnaiTheme.set('dark');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
if (ownId) await agents.stop(ownId).catch(() => {});

// The app closes when this returns: every shell has ended by then.
for (let tries = 0; tries < 150 && agents.sessions().some(one => one.running); tries++)
  await wait(100);
await wait(1500);
return { ok, log };
