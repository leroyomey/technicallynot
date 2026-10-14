// Technically Not tools · desktop-check/tests/own-terminal.after.js — the second half of the
// own-terminal test, after the window was reloaded with the terminal remembered. Checked: the
// remembered terminal is the same session, still running, with its earlier output, and no second
// one was started; it is still no thread; the prompt box can never aim at it (set as the target
// by code, pressed in the row of agents' marks, chosen in the picker); it fits the smallest
// window and a low one. (A closed panel and a second project: own-terminal-more.js.)
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
  const before = JSON.parse(localStorage.getItem('tnai.test.own-terminal') || '{}');
  const ownId = before.ownId || '';
  stopLater.add(ownId);
  stopLater.add(before.other);
  await until(() => threads?.visible());

  // ---- the remembered terminal after a reload ----
  check(!!ownId && own().paneId() === ownId, 'after the reload the terminal is remembered');
  const back = await until(() => session(ownId), 20000);
  check(!!back, 'its session is there again (' + (back?.running ? 'running' : 'stopped') + ')');
  await until(() => agents.sessions().length >= before.sessions, 10000);
  check(
    window.TnaiThreadList.thread(ownId) === null &&
      !window.TnaiThreadList.rows().some(row => row.paneId === ownId),
    'it is still no row of the thread list'
  );
  column().open('terminal');
  const term = await until(() => (own().shown() ? own().term() : null), 20000);
  check(!!term && own().paneId() === ownId, 'the tab shows the same session (' + ownId + ')');
  check(
    !!(await until(() => session(ownId)?.running, 20000)),
    'the session runs (started again by the tab if the reload had stopped it)'
  );
  check(
    named().length === 1 && agents.sessions().length === before.sessions,
    'no second terminal was started (' +
      named().length +
      ' named "Your terminal", ' +
      agents.sessions().length +
      ' sessions in all, ' +
      before.sessions +
      ' before)'
  );
  check(
    !!(await until(
      () => textOf(term).includes('own-terminal-ok') && textOf(term).includes('while-closed'),
      10000
    )),
    'the output of the commands run before the reload is there'
  );
  term.input("Write-Host ('after' + '-reload')\r", true);
  check(
    !!(await until(() => textOf(term).includes('after-reload'), 15000)),
    'and a command typed now runs in it'
  );

  // ---- the prompt box can never aim at it ----
  live().setTarget(before.other);
  await wait(100);
  check(live().target() === before.other, 'setup: the PowerShell thread can be the target');
  live().setTarget(ownId);
  await wait(100);
  check(
    live().target() !== ownId,
    'made the target by code, the terminal is taken off again at once (target now: ' +
      (live().target() || 'none') +
      ')'
  );
  const mark = document.querySelector('.tnai-to-av[data-to="' + ownId + '"]');
  if (mark) {
    live().setTarget(before.other);
    mark.click();
    await wait(200);
    check(
      live().target() !== ownId,
      'pressed in the row of agents’ marks, it does not become the target'
    );
  }
  log.push(
    'note the row of agents’ marks ' +
      (mark ? 'still lists' : 'does not list') +
      ' the terminal (the list is 46’s)'
  );
  const pick = [...document.querySelectorAll('select option')].find(
    option => option.value === 'pane:' + ownId
  );
  if (pick) {
    const select = pick.closest('select');
    select.value = pick.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(200);
    check(live().target() !== ownId, 'chosen in the picker, it does not become the target');
  }
  log.push(
    'note the picker under the prompt box ' +
      (pick ? 'still lists' : 'does not list') +
      ' the terminal (the list is 46’s)'
  );

  // ---- the smallest window and a low one ----
  for (const [width, height, name] of [
    [1440, 720, 'low'],
    [768, 680, 'smallest'],
  ]) {
    await main('size', width, height);
    await wait(900);
    const now = await until(() => {
      const read = fits();
      return read.pty === read.cols && read.gap >= 0 && read.gap <= read.cell + 16 ? read : null;
    }, 6000);
    const at = box(host());
    check(
      !!now &&
        own().shown() &&
        at.left >= 0 &&
        at.right <= window.innerWidth + 1 &&
        at.bottom <= window.innerHeight + 1 &&
        fits().rows >= 5,
      'at ' +
        window.innerWidth +
        ' by ' +
        window.innerHeight +
        ' the terminal is inside the window and fills its box (' +
        fits().cols +
        ' columns, ' +
        fits().rows +
        ' rows, ' +
        round(at.width) +
        ' by ' +
        round(at.height) +
        ' px)'
    );
    const tabRow = document.querySelector('.tnt-sidebox-tabs');
    const tops = new Set(
      [...tabRow.querySelectorAll('[role="tab"]')].filter(shown).map(tab => round(box(tab).top))
    );
    check(tops.size === 1, 'the tabs stand on one row there');
    await shot('own-terminal-' + name);
  }
  await main('size', 1440, 900);
  await wait(600);
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
for (const paneId of stopLater) if (paneId) await agents.stop(paneId).catch(() => {});
await main('size', 1440, 900).catch(() => {});

// The app closes when this returns: every shell has ended by then.
for (let tries = 0; tries < 150 && agents.sessions().some(one => one.running); tries++)
  await wait(100);
await wait(1500);
return { ok, log };
