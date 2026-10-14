// Technically Not tools · desktop-check/tests/own-terminal.js — the one plain terminal for the
// user's own commands (136): the tab "Terminal" of the Threads page's side column. One PowerShell
// thread is opened beside it for comparison. Checked: the tab exists and opens; a PowerShell
// session starts in the project folder; a typed command shows its output in that terminal; the
// terminal has the width of its box after the column is made wider; the session is not a row of
// the thread list and not a card of All threads (the comparison thread is both); the row of the
// three-dots menu opens it from another page; closing and opening the column shows the same
// session with its earlier output. Pictures in Dark, in Light and in a narrow window. Then the
// window is reloaded and own-terminal.after.js goes on: the remembered session, the prompt box,
// two more window sizes, a closed panel and a second project.
// Returns {ok, log, reload}.
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
    const id = 'm' + ++callId;
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
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);
const shown = el => !!el && el.getClientRects().length > 0;
const folder = path =>
  String(path || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;

// The terminal that stands in the tab, and the text on it (history included).
const host = () => document.querySelector('.tnt-ownterm-host');
const termOf = paneId =>
  agents
    .views()
    .find(view => view.paneId === paneId && view.term.element?.closest('.tnt-ownterm-host'))
    ?.term || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const opened = [];
let ownId = '';

// A session is started the way a user starts one: as a thread. Answers as the old start
// call did: { ok, paneId } or { ok: false, error }.
const openThread = async (tool, options = {}) => {
  try {
    const made = await window.TnaiTest.startThread({ tool, ...options });
    return { ok: true, paneId: made.paneId };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};
try {
  await main('size', 1600, 900);
  await until(() => threads?.visible());

  // ---- a thread to compare with ----
  const made = await openThread('Terminal');
  if (made?.paneId) opened.push(made.paneId);
  const other = opened[0] || '';
  threads.open();
  await until(() => threads.visible());
  check(
    !!other && !!(await until(() => window.TnaiThreadList.thread(other))),
    'setup: one PowerShell thread is open and is a row of the thread list'
  );
  const before = agents.sessions().length;

  // ---- the tab ----
  check(!!own() && own().paneId() === '', 'before the tab is opened the project has no terminal');
  column().open('files');
  const tab = await until(() => document.getElementById('tntSideTabTerminal'));
  const names = [...document.querySelectorAll('.tnt-sidebox-tabs [role="tab"]')]
    .filter(shown)
    .map(one => one.textContent.trim());
  check(
    shown(tab) && names.join(', ') === 'Files, Details, Terminal',
    'the side column has the tabs ' + names.join(', ')
  );
  check(
    agents.sessions().length === before && !own().shown(),
    'nothing is started while the files show'
  );
  tab.click();
  check(
    column().state().tab === 'terminal' && tab.getAttribute('aria-selected') === 'true',
    'a press on Terminal chooses that tab'
  );
  check(threads.visible(), 'the Threads page stays: starting the terminal changes no page');

  // ---- the session ----
  ownId = (await until(() => own().paneId(), 15000)) || '';
  const runs = await until(() => (session(ownId)?.running ? session(ownId) : null), 20000);
  check(!!runs && runs.agent === 'Terminal', 'a PowerShell session starts (' + ownId + ')');
  const root = folder(window.TnaiTerminalWorkspaces.project());
  const where = await until(() => (session(ownId)?.cwd ? folder(session(ownId).cwd) : ''), 15000);
  check(!!root && where === root, 'it runs in the project folder (' + where + ')');
  const term = await until(() => termOf(ownId), 10000);
  check(!!term && own().shown(), 'its terminal stands in the tab');
  check(
    !!(await until(() => textOf(term).trim().length > 0, 30000)),
    'PowerShell shows its prompt there (whatever prompt this PC has set up)'
  );
  check(
    !!(await until(() => document.activeElement === term.textarea, 3000)),
    'the keyboard is in the terminal after the press on its tab'
  );

  // ---- a typed command ----
  // The words are put together by the command, so the text looked for is its output and never
  // the echo of what was typed.
  term.input("Write-Host ('own-terminal' + '-ok')\r", true);
  check(
    !!(await until(() => textOf(term).includes('own-terminal-ok'), 15000)),
    'a typed command shows its output in the terminal'
  );

  // ---- the width of its box ----
  const fits = () => {
    const screen = host().querySelector('.xterm-screen');
    const cell = box(screen).width / term.cols;
    return {
      gap: box(host()).width - box(screen).width,
      cell,
      cols: term.cols,
      pty: agents.ptySize.get(ownId)?.cols || 0,
    };
  };
  const narrowCols = term.cols;
  const narrow = fits();
  check(
    narrow.gap >= 0 && narrow.gap <= narrow.cell + 16 && narrow.pty === narrow.cols,
    'the terminal fills its box (' +
      narrow.cols +
      ' columns, ' +
      round(narrow.gap) +
      ' px left over; the session has ' +
      narrow.pty +
      ')'
  );
  await shot('own-terminal-dark');
  const sideBefore = box(threads.slot('side')).width;
  window.TnaiThreadSideSize.set(sideBefore + 220);
  await until(() => box(threads.slot('side')).width > sideBefore + 200, 3000);
  const wide = await until(() => {
    const now = fits();
    return now.cols > narrowCols && now.pty === now.cols && now.gap <= now.cell + 16 ? now : null;
  }, 6000);
  check(
    !!wide,
    'made wider, the terminal has the width of its box (' +
      narrowCols +
      ' columns before, ' +
      fits().cols +
      ' after, ' +
      round(fits().gap) +
      ' px left over; the session has ' +
      fits().pty +
      ')'
  );
  await shot('own-terminal-wide');

  // ---- not a thread ----
  const rows = window.TnaiThreadList.rows();
  check(
    !rows.some(row => row.paneId === ownId) && rows.some(row => row.paneId === other),
    'it is not a row of the thread list; the PowerShell thread is (' + rows.length + ' rows)'
  );
  check(window.TnaiThreadList.thread(ownId) === null, 'the list does not know it as a thread');
  check(threads.show(ownId) === false, '"go to this agent" does not open it as a thread');

  // ---- never a place to send a prompt to ----
  // the prompt box repaints a moment after the sessions change
  await wait(600);
  const marks = [...document.querySelectorAll('.tnai-to-av')].map(mark => mark.dataset.to);
  check(
    !marks.includes(ownId) && marks.includes(other),
    'the row of agents’ marks under the prompt box does not list it; the thread is there (' +
      marks.length +
      ' marks)'
  );
  const picks = [...document.querySelectorAll('option')].map(option => option.value);
  check(
    !picks.includes('pane:' + ownId) && picks.includes('pane:' + other),
    'the prompt box’s picker does not list it; the thread is there'
  );

  // the All threads page: the route 'terminal' is that page
  window.TnaiRoute('terminal');
  const all = () => window.TnaiAllThreads;
  const on = await until(() => all()?.state().on && all().state().order.includes(other));
  const view = document.getElementById('terminalView');
  check(
    !!on &&
      !all().state().order.includes(ownId) &&
      !view.querySelector('.tat-card[data-pane="' + ownId + '"]') &&
      !!view.querySelector('.tat-card[data-pane="' + other + '"]'),
    'it is not a card of All threads; the PowerShell thread is (' +
      all()?.state().order.length +
      ' cards)'
  );

  // ---- the row of the three-dots menu, from another page ----
  column().open('files');
  document.querySelector('.top .tnt-menu-btn').click();
  const menu = await until(() => {
    const found = document.querySelector('.tnt-menu.tnt-menu-full');
    return shown(found) ? found : null;
  }, 3000);
  const row =
    menu &&
    [...menu.querySelectorAll('.tnt-menu-row')].find(
      one => one.querySelector('span').textContent.trim() === 'Terminal'
    );
  check(shown(row), 'the three-dots menu has a row "Terminal"');
  row?.click();
  check(
    !!(await until(
      () => threads.visible() && column().state().tab === 'terminal' && own().shown(),
      5000
    )),
    'the row opens the Threads page with the side column on the terminal'
  );
  check(
    own().paneId() === ownId && termOf(ownId) === term,
    'it is the same session and the same terminal'
  );

  // ---- closing and opening the column ----
  const sessionsNow = agents.sessions().length;
  column().close();
  check(
    !!(await until(() => !own().shown() && !column().state().shown, 3000)),
    'closing the column takes the terminal off the screen'
  );
  check(!!session(ownId)?.running, 'its session keeps running while the column is closed');
  window.tnaiNative.pty.write(ownId, "Write-Host ('while' + '-closed')\r");
  await wait(1500);
  column().open('terminal');
  check(
    !!(await until(() => own().shown(), 3000)) &&
      own().paneId() === ownId &&
      termOf(ownId) === term &&
      agents.sessions().length === sessionsNow,
    'opened again it is the same session (' + own().paneId() + '), and no second one was started'
  );
  check(
    textOf(term).includes('own-terminal-ok'),
    'the output of the earlier command is still there'
  );
  check(
    !!(await until(() => textOf(term).includes('while-closed'), 5000)),
    'what the session wrote while the column was closed is there too'
  );
  const again = await until(() => {
    const now = fits();
    return now.pty === now.cols && now.gap >= 0 && now.gap <= now.cell + 16 ? now : null;
  }, 5000);
  check(!!again, 'and it fills its box again (' + fits().cols + ' columns)');

  // ---- the other look, and a narrow window ----
  window.TnaiTheme.set('light');
  await shot('own-terminal-light');
  window.TnaiTheme.set('dark');
  await main('size', 1024, 700);
  await wait(900);
  check(
    own().shown() && box(host()).right <= window.innerWidth + 1 && box(host()).width > 200,
    'in a narrow window the terminal is on screen, inside the window (' +
      round(box(host()).width) +
      ' px wide)'
  );
  await shot('own-terminal-narrow');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
await main('size', 1440, 900).catch(() => {});

// Both sessions are left running: the second half of the test finds them after the reload.
try {
  localStorage.setItem(
    'tnai.test.own-terminal',
    JSON.stringify({ ownId, other: opened[0] || '', sessions: agents.sessions().length })
  );
} catch {}
return { ok, log, reload: true };
