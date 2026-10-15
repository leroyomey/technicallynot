// Technically Not tools · desktop-check/tests/own-terminal-row.js — the row of controls over the
// user's own terminal and the Ports line (147), with Fill (136). One PowerShell thread is opened
// so there is a thread to fill the place of. Checked: the row names the shell and the folder it
// started in; Clear takes the output off the screen and the shell goes on; Restart asks
// first, Cancel keeps the shell, Restart starts a new one in the same panel with the earlier
// output still above; Fill puts the same terminal in the thread's place at the width of the
// middle island, the thread is not displayed and not lost, and the same button or a press on the
// thread brings it back; Ports is closed until pressed, lists an address Live preview knows and
// opens it there. Pictures of the row, the question, the filled terminal and the ports.
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
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const column = () => window.TnaiThreadSide;
const own = () => window.TnaiOwnTerminal;
const layout = document.querySelector('.layout');
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value);
const shown = el => !!el && el.getClientRects().length > 0;
const session = paneId => agents.sessions().find(one => one.paneId === paneId) || null;
const textOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows.join('\n');
};
const row = () => document.querySelector('.tnt-ownterm-row');
const press = name =>
  row()
    .querySelector('[data-do="' + name + '"]')
    .click();
const question = () => document.querySelector('.tnt-ownterm .tnai-panel-confirm');
let ownId = '';
let other = '';

try {
  await until(() => threads?.visible());
  other = (await window.TnaiTest.open('Terminal'))?.paneId || '';
  threads.open();
  await until(() => threads.visible() && window.TnaiThreadList.thread(other));
  threads.select(other);
  column().open('terminal');
  ownId = (await until(() => own().paneId(), 15000)) || '';
  await until(() => session(ownId)?.running, 20000);
  const term = await until(() => own().term(), 10000);
  await until(() => textOf(term).trim().length > 0, 30000);

  // ---- the row ----
  const shell = row()?.querySelector('.tnt-ownterm-shell');
  const folder = row()?.querySelector('.tnt-ownterm-folder');
  const buttons = [...(row()?.querySelectorAll('button') || [])];
  check(
    shown(row()) && shell.textContent === window.tnaiShell() && buttons.length === 3,
    'the row names the shell (' + shell?.textContent + ') and has three buttons'
  );
  check(
    !!(await until(() => /sample-project$/.test(folder.textContent), 15000)) &&
      // "is in" once the shell has said where it stands (PowerShell does), "started in" before
      /^This shell (is|started) in /.test(folder.title),
    'and the folder the shell is in (' + folder.textContent + '; tip: ' + folder.title + ')'
  );
  check(
    buttons.every(
      button =>
        !!button.getAttribute('aria-label') &&
        button.title === button.getAttribute('aria-label') &&
        round(box(button).width) === 30 &&
        round(box(button).height) === 30 &&
        !!button.querySelector('svg')
    ),
    'each button is a named 30 px icon button (' +
      buttons.map(button => button.getAttribute('aria-label')).join(' | ') +
      ')'
  );
  const hostBox = () => box(document.querySelector('.tnt-ownterm-host'));
  check(
    box(row()).bottom <= hostBox().top + 1 && box(row()).right <= box(threads.slot('side')).right,
    'the row stands over the terminal, inside the column'
  );
  await shot('own-terminal-row');

  // ---- Clear ----
  term.input("Write-Host ('before' + '-clear')\r", true);
  await until(() => textOf(term).includes('before-clear'), 15000);
  press('clear');
  await wait(300);
  check(!textOf(term).includes('before-clear'), 'Clear takes the output off the screen');
  term.input("Write-Host ('after' + '-clear')\r", true);
  check(
    !!(await until(() => textOf(term).includes('after-clear'), 15000)) && session(ownId).running,
    'and the shell goes on: the next command runs'
  );

  // ---- Restart ----
  const startedAt = session(ownId).startedAt;
  press('restart');
  const asked = await until(() => question(), 3000);
  check(
    !!asked && /restart the shell/i.test(asked.textContent),
    'Restart asks first ("' + (asked?.querySelector('h3')?.textContent || '') + '")'
  );
  await shot('own-terminal-row-ask');
  [...asked.querySelectorAll('button')].find(button => /cancel/i.test(button.textContent)).click();
  await wait(400);
  check(
    !question() && session(ownId).running && session(ownId).startedAt === startedAt,
    'Cancel keeps the shell as it is'
  );
  press('restart');
  const again = await until(() => question(), 3000);
  [...again.querySelectorAll('button')].find(button => /restart/i.test(button.textContent)).click();
  check(
    !!(await until(() => session(ownId)?.running && session(ownId).startedAt !== startedAt, 30000)),
    'Restart starts a new shell in the same panel (' + ownId + ')'
  );
  check(
    own().paneId() === ownId && own().term() === term && textOf(term).includes('after-clear'),
    'the same terminal shows it, the earlier output still above'
  );
  await wait(2500);
  term.input("Write-Host ('new' + '-shell')\r", true);
  check(
    !!(await until(() => textOf(term).includes('new-shell'), 20000)),
    'and a command runs in the new shell'
  );

  // ---- Fill ----
  const main = threads.slot('main');
  const thread = main.querySelector('.tnt-view');
  const colsBefore = term.cols;
  check(shown(thread), 'setup: the open thread is shown');
  press('fill');
  const wide = await until(
    () =>
      own().filled() &&
      main.contains(document.querySelector('.tnt-ownterm-host')) &&
      term.cols > colsBefore &&
      agents.ptySize.get(ownId)?.cols === term.cols,
    6000
  );
  check(
    !!wide && own().term() === term,
    'Fill puts the same terminal in the thread’s place (' +
      colsBefore +
      ' columns before, ' +
      term.cols +
      ' now; the session has ' +
      agents.ptySize.get(ownId)?.cols +
      ')'
  );
  check(
    !shown(thread) && thread.isConnected && threads.selected() === other,
    'the thread is not displayed, and it is still the open thread'
  );
  const mainBox = box(main);
  check(
    hostBox().left >= mainBox.left &&
      hostBox().right <= mainBox.right &&
      hostBox().width > mainBox.width - 60 &&
      shown(row()) &&
      main.contains(row()),
    'the terminal has the width of the middle island, its row with it (' +
      round(hostBox().width) +
      ' of ' +
      round(mainBox.width) +
      ' px)'
  );
  check(
    row().querySelector('[data-do="fill"]').getAttribute('aria-pressed') === 'true' &&
      /back/i.test(row().querySelector('[data-do="fill"]').getAttribute('aria-label')),
    'the button now says "' +
      row().querySelector('[data-do="fill"]').getAttribute('aria-label') +
      '"'
  );
  const away = document.querySelector('#tntSideTerminal .tnt-ownterm-away');
  check(shown(away), 'the tab says where the terminal went ("' + (away?.textContent || '') + '")');
  check(textOf(term).includes('new-shell'), 'its text came with it');
  await shot('own-terminal-fill');
  window.TnaiTheme.set('light');
  await shot('own-terminal-fill-light');
  window.TnaiTheme.set('dark');
  press('fill');
  check(
    !!(await until(
      () =>
        !own().filled() &&
        shown(thread) &&
        document.getElementById('tntSideTerminal').contains(row()) &&
        term.cols === colsBefore,
      6000
    )),
    'the same button brings it back: the thread shows, the terminal is in its tab at ' +
      term.cols +
      ' columns'
  );
  press('fill');
  await until(() => own().filled(), 3000);
  threads.select('');
  threads.select(other);
  check(
    !!(await until(() => !own().filled() && shown(thread), 4000)),
    'a thread chosen while the terminal fills its place gets the place back'
  );

  // ---- Ports ----
  const head = document.querySelector('.tnt-ownterm-ports-head');
  const list = document.querySelector('.tnt-ownterm-ports-list');
  check(
    shown(head) && head.getAttribute('aria-expanded') === 'false' && !shown(list),
    'Ports is one closed line (' + head.textContent.trim() + ')'
  );
  head.click();
  await wait(200);
  check(
    shown(list) && /knows no address/i.test(list.textContent),
    'opened with nothing known, it says so'
  );
  window.TnaiLivePreview.addUrl('http://localhost:4321');
  const port = await until(() => list.querySelector('.tnt-ownterm-port'), 4000);
  check(
    !!port &&
      /localhost:4321/.test(port.textContent) &&
      /not started by Technically Not/.test(port.textContent) &&
      head.querySelector('em').textContent === '1',
    'an address Live preview knows is listed with what the app knows of it (' +
      (port?.textContent || '') +
      ')'
  );
  await shot('own-terminal-ports');
  port.querySelector('button').click();
  check(
    !!(await until(() => layout.classList.contains('preview-mode'), 5000)),
    'its button opens Live preview'
  );
  threads.open();
  await until(() => threads.visible());
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
for (const paneId of [ownId, other]) if (paneId) await agents.stop(paneId).catch(() => {});

// The app closes when this returns: every shell has ended by then.
for (let tries = 0; tries < 150 && agents.sessions().some(one => one.running); tries++)
  await wait(100);
await wait(1500);
return { ok, log };
