// Technically Not tools · desktop-check/tests/own-terminal-more.js — the user's own terminal (136)
// when its panel goes away and when the project changes. Checked: with its panel closed from
// elsewhere the tab starts a new terminal, the only one; a second project folder gets a terminal
// of its own, in its own folder; back in the first project the tab shows the first project's
// terminal again while the second's keeps running.
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
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'a' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const shot = async name => {
  await wait(400);
  console.log('TNAI_SHOT:' + name);
  await wait(700);
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const column = () => window.TnaiThreadSide;
const own = () => window.TnaiOwnTerminal;
const live = () => window.TnaiLiveTasks;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);
const shown = el => !!el && el.getClientRects().length > 0;
const folder = path =>
  String(path || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const host = () => document.querySelector('.tnt-ownterm-host');
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const named = () => agents.sessions().filter(one => one.name === 'Your terminal');
const fits = () => {
  const term = own().term();
  const screen = host().querySelector('.xterm-screen');
  const cell = box(screen).width / term.cols;
  return {
    gap: box(host()).width - box(screen).width,
    under: box(host()).bottom - box(screen).bottom,
    cell,
    cols: term.cols,
    rows: term.rows,
    pty: agents.ptySize.get(own().paneId())?.cols || 0,
  };
};
const stopLater = new Set();

try {
  await until(() => threads?.visible());
  column().open('terminal');
  const ownId = (await until(() => own().paneId(), 15000)) || '';
  stopLater.add(ownId);
  check(
    !!(await until(() => session(ownId)?.running && own().term(), 20000)),
    'setup: the terminal is up (' + ownId + ')'
  );

  // ---- its panel closed from elsewhere ----
  const panel = document.querySelector('.terminal-pane[data-pane-id="' + ownId + '"]');
  panel.querySelector('.terminal-pane-tools button[title="Close terminal"]').click();
  const fresh = await until(() => {
    const now = own().paneId();
    return now && now !== ownId && session(now)?.running ? now : '';
  }, 30000);
  stopLater.add(fresh);
  check(
    !!fresh && !session(ownId),
    'its panel closed from elsewhere: the tab starts a new terminal (' + fresh + ')'
  );
  check(
    !!(await until(() => own().shown() && own().term()?.tnaiPaneId === fresh, 10000)) &&
      named().length === 1,
    'the tab shows the new one, and it is the only one'
  );

  // ---- a second project gets its own ----
  const first = window.TnaiProjects.active();
  const second = await main('make', 'proj-own-b');
  await main('pickNext', second);
  window.TnaiProjects.add();
  await until(() => folder(window.TnaiProjects.active()) === folder(second), 10000);
  column().open('terminal');
  const forSecond = await until(() => {
    const now = own().paneId();
    return now && now !== fresh && session(now)?.running ? now : '';
  }, 30000);
  stopLater.add(forSecond);
  check(!!forSecond, 'a second project gets a terminal of its own (' + forSecond + ')');
  const where = await until(
    () => (session(forSecond)?.cwd ? folder(session(forSecond).cwd) : ''),
    15000
  );
  check(where === folder(second), 'it runs in that project’s folder (' + where + ')');
  check(
    !!(await until(() => own().term()?.tnaiPaneId === forSecond, 10000)),
    'the tab shows that terminal'
  );
  await window.TnaiProjects.switchTo(first);
  await until(() => folder(window.TnaiProjects.active()) === folder(first), 10000);
  column().open('terminal');
  check(
    !!(await until(() => own().paneId() === fresh && own().term()?.tnaiPaneId === fresh, 15000)),
    'back in the first project the tab shows the first project’s terminal again'
  );
  check(!!session(forSecond)?.running, 'the second project’s terminal keeps running meanwhile');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
for (const paneId of stopLater) if (paneId) await agents.stop(paneId).catch(() => {});

// The app closes when this returns: every shell has ended by then.
await until(() => !agents.sessions().some(one => one.running), 15000);
await wait(1500);
return { ok, log };
