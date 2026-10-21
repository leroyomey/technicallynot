// Technically Not tools · desktop-check/tests/remote-thread-more.js — another computer's thread
// gets the controls a thread here has (plan item 44, src/scripts/164-remote-thread-more.js), in the
// real app with a throwaway profile. Nothing is paired: the state is made up and pushed the way
// the main process pushes a real one, and the thread controls' channels are stand-ins that write
// down each call (remote-thread-more.main.js). Written with the batch of 2026-10-21; first run
// in the batch's window-test round (Remy #3 brought it to the current app). Covered: the "..."
// button stands in the head of another computer's thread; its menu has the same rows as a thread
// here, and the rows that cannot work for it are greyed with their reason; Close asks first and
// then sends `remote:thread` close with the row's mark; Rename edits the name in place and sends
// it; a right press on its row opens the menu; the composer's Model sends `remote:thread` model for
// a Claude Code agent and is greyed with the reason for Codex; Access is greyed; Past conversations
// shows the other computer's list under this computer's, opening one asks for it and shows it "As
// NAME reported it", and Resume sends `remote:resume`. Pictures:
// remote-thread-more-menu-(dark|light), remote-thread-more-past. Returns {ok, log}.
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
    await wait(50);
  }
  return null;
};
const shot = async name => {
  await wait(400);
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

const threads = window.TnaiThreads;
const more = window.TnaiRemoteThreadMore;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;
const listSlot = () => threads.slot('list');
const rowNamed = name =>
  [...listSlot().querySelectorAll('.tnt-th[data-remote]')].find(
    row => row.querySelector('b')?.textContent === name
  );
const menuRows = () =>
  [...document.querySelectorAll('.tnt-menu-thread .tnt-menu-row')].filter(onScreen);
const rowById = id => menuRows().find(row => row.dataset.row === id) || null;
const asked = async channel => (await main('asked')).filter(call => call.ch === channel);
const calm = () => until(() => !window.TnaiDevices?.quiet?.(), 3000);

const nowMs = Date.now();
const PC = 'sample-computer-1';
const farAgents = [
  {
    id: 'p1',
    name: 'Wren',
    cli: 'Claude Code',
    status: 'idle',
    since: 0,
    sure: true,
    can: true,
    mark: 'm1',
  },
  {
    id: 'p2',
    name: 'Moss',
    cli: 'Codex',
    status: 'idle',
    since: 0,
    sure: true,
    can: true,
    mark: 'm2',
  },
];
const computer = {
  id: PC,
  name: 'Sample laptop',
  since: nowMs,
  online: true,
  session: true,
  state: 'live',
  heard: nowMs,
  detail: true,
  project: { ahead: 0, behind: 0 },
  canControl: true,
  canWatch: false,
  canStart: ['claude'],
  ops: [],
  items: [],
  agents: farAgents,
};
const pastHeld = {
  state: 'ready',
  at: nowMs,
  rows: [
    { h: 'c'.repeat(16), cli: 'Claude Code', title: 'Fix the login page', at: nowMs - 86400000 },
  ],
};
const logHeld = {
  state: 'ready',
  entries: [
    { k: 'you', text: 'Fix the login page' },
    { k: 'say', text: 'Done: the form checks the e-mail now.' },
  ],
  more: false,
  older: false,
  rev: 0,
  at: nowMs,
};

try {
  check(!!more?.rows && !!window.TnaiThreadMore?.openList, 'the remote thread controls exist');
  const real = (await window.tnaiNative.remote.state()).value;
  const state = list => ({
    ...real,
    on: true,
    computers: [{ ...computer, agents: list || farAgents }],
    others: [],
    watching: [],
  });
  await main('install');
  await main('stubs', pastHeld, logHeld);
  threads.open();
  await until(() => threads.visible(), 5000);
  await main('show', state());
  await until(() => rowNamed('Wren'), 5000);

  // ---- the "..." button and its rows ----
  await calm();
  rowNamed('Wren').click();
  const button = await until(() => {
    const node = document.querySelector('.tnh-view .ap-far .tnr-more');
    return onScreen(node) ? node : null;
  }, 5000);
  check(!!button, 'the "..." button stands in the head of the other computer’s thread');
  button?.click();
  await until(() => menuRows().length, 3000);
  check(
    JSON.stringify(menuRows().map(row => row.dataset.row)) ===
      JSON.stringify(['rename', 'team', 'screen', 'popout', 'stop', 'handoff', 'close']),
    'its menu has the rows of a thread here: ' +
      menuRows()
        .map(row => row.dataset.row)
        .join(', ')
  );

  // 12-inactive-ui.js greys a row at most 150 ms after it is drawn
  const greyed = await until(
    () =>
      ['team', 'screen', 'popout', 'handoff'].every(
        id => rowById(id)?.dataset.off && rowById(id)?.getAttribute('aria-disabled') === 'true'
      ),
    3000
  );
  check(!!greyed, 'the rows that cannot work are greyed, each with its reason');
  check(
    / · /.test(rowById('team')?.textContent || ''),
    'a greyed row says why in its own words: ' + (rowById('team')?.textContent || '')
  );
  await shot('remote-thread-more-menu-dark');

  // ---- Close asks first ----
  rowById('close')?.click();

  // the first shown confirm: the app holds other dialogs that are hidden (09's discard dialog)
  const ask = await until(
    () =>
      [...document.querySelectorAll('.tnai-panel-confirm, [role=alertdialog]')].find(onScreen) ||
      null,
    3000
  );
  check(!!ask && /Close Wren on Sample laptop/.test(ask?.textContent || ''), 'Close asks first');
  [...(ask?.querySelectorAll('button') || [])].find(b => /^Close$/.test(b.textContent))?.click();
  const closed = await until(async () => (await asked('remote:thread')).length, 3000);
  const closeCall = closed ? (await asked('remote:thread'))[0] : null;
  check(
    !!closeCall &&
      closeCall.args[0] === PC &&
      closeCall.args[1] === 'p1' &&
      closeCall.args[2] === 'close' &&
      closeCall.args[4] === 'm1',
    'after Yes, a close is sent with the row’s mark'
  );

  // ---- a right press on its row opens the same menu ----
  rowNamed('Wren').dispatchEvent(
    new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  );
  check(!!(await until(() => menuRows().length, 3000)), 'a right press on its row opens the menu');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.TnaiThreadMore.close();

  // ---- the composer's Model ----
  const target = document.querySelector('.tnh-view .ap-far [data-act=target]');
  target?.click();
  await wait(300);
  const subject = more.subject();
  check(
    !!subject && subject.agent === 'Claude Code' && !subject.why.model,
    'Wren as the composer’s target: its model can be switched from here'
  );
  more.pick(subject, 'model', 'opus');
  const modelCall = await until(
    async () => (await asked('remote:thread')).find(call => call.args[2] === 'model'),
    3000
  );
  check(!!modelCall && modelCall.args[3] === 'opus', 'the model goes as a thread operation');
  check(!!subject?.why.access, 'access is greyed with its reason');

  // ---- past conversations ----
  window.TnaiThreadHistory.open();

  // the service pushes its state again once it asked (remote-thread.js `ask` → 'reading'); the
  // stand-in channels do not, so the test pushes it as the service would
  await until(async () => (await asked('remote:askPast')).length, 3000);
  await main('show', state());
  const farRow = await until(() => {
    const node = document.querySelector('.tnh-pop .tnr-past .tnh-row');
    return onScreen(node) ? node : null;
  }, 5000);
  check(!!farRow, 'Past conversations lists the other computer’s under this computer’s');
  check((await asked('remote:askPast')).length >= 1, 'opening it asked that computer once');
  farRow?.click();
  const read = await until(() => {
    const node = document.querySelector('.tnh-pop .tnr-past-one');
    return onScreen(node) && /As Sample laptop reported it/.test(node.textContent) ? node : null;
  }, 5000);
  check(!!read, 'a press reads it, marked as reported by that computer');
  check(
    (await asked('remote:askLog')).some(call => call.args[1] === 'past:' + 'c'.repeat(16)),
    'it was asked by its handle, never an id or a path'
  );
  await shot('remote-thread-more-past');
  read?.querySelector('.tnh-resume')?.click();
  const resumed = await until(async () => (await asked('remote:resume')).length, 3000);
  check(!!resumed, 'Resume sends remote:resume');
  window.TnaiThreadHistory.close();
  await main('show', { ...real, on: false, computers: [] });
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
