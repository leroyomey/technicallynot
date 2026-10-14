// Technically Not tools · desktop-check/tests/own-terminal-links.js — what can be pressed in the
// output of the user's own terminal (146). One PowerShell session prints lines with a file of the
// sample project (with a line number), a path that is no file, an address on this computer and
// an outside address. Checked: the file, relative and as a full path, is a link and the path
// that is no file and a file outside the project are not; a path broken over two rows by the
// edge is one link; a real mouse press on the file opens it in the Files tab's reader; the
// address on this computer opens in Live preview; the outside address is handed to the system's
// browser (the call is caught here, no browser is opened) without the full stop behind it.
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
let inputId = 0;
const input = events =>
  new Promise(resolve => {
    const id = 'i' + ++inputId;
    window.__tnaiInputDone = window.__tnaiInputDone || {};
    window.__tnaiInputDone[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
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
const links = () => window.TnaiOwnTerminalLinks;
const layout = document.querySelector('.layout');
const box = el => el.getBoundingClientRect();
const rowsOf = term => {
  const buffer = term.buffer.active;
  const rows = [];
  for (let row = 0; row < buffer.length; row++)
    rows.push(buffer.getLine(row)?.translateToString(true) || '');
  return rows;
};

// The buffer row where a line of OUTPUT starts with this word (the echo of the typed command
// starts with "Write-Host").
const outputRow = (term, word) => rowsOf(term).findIndex(row => row.startsWith(word));
const run = async (term, command, word) => {
  term.input(command + '\r', true);
  return until(() => {
    const row = outputRow(term, word);
    return row >= 0 ? row + 1 : 0;
  }, 15000).then(found => (found ? found - 1 : -1));
};
const realOpen = window.open;
const handed = [];
let ownId = '';

try {
  await until(() => threads?.visible());
  column().open('terminal');
  ownId = (await until(() => own().paneId(), 15000)) || '';
  await until(() => agents.sessions().some(one => one.paneId === ownId && one.running), 20000);
  const term = await until(() => own().term(), 10000);
  await until(() => rowsOf(term).join('').trim().length > 0, 30000);
  check(!!links() && !!term, 'setup: the terminal is up, with its links');

  // ---- one line with everything in it ----
  const first = await run(
    term,
    "Write-Host ('one' + ' src/app.js:1 nosuch/file.txt http://localhost:4321/page https://example.com/docs.')",
    'one src/app.js'
  );

  // The line is longer than the terminal is wide: what is asked of a row is that row's links, so
  // both rows are asked.
  const found =
    first >= 0 ? [...(await links().at(term, first)), ...(await links().at(term, first + 1))] : [];
  const kinds = found.map(link => link.kind + ' ' + link.text);
  const file = found.find(link => link.kind === 'file');
  const preview = found.find(link => link.kind === 'preview');
  const browser = found.find(link => link.kind === 'browser');
  check(
    !!file && file.text === 'src/app.js:1' && file.file === 'src/app.js' && file.line === 1,
    'a file of the project with a line number is a link (' + kinds.join(' | ') + ')'
  );
  check(!found.some(link => /nosuch/.test(link.text)), 'a path that is no file stays plain text');
  check(
    preview?.text === 'http://localhost:4321/page',
    'an address on this computer is a link for Live preview'
  );
  check(
    browser?.text === 'https://example.com/docs',
    'an outside address is a link, without the full stop behind it (' + browser?.text + ')'
  );

  // ---- full paths ----
  const root = window.TnaiProjects.active();
  const second = await run(
    term,
    "Write-Host ('two' + ' " + root + "\\src\\app.js C:\\Windows\\win.ini')",
    'two '
  );
  const full =
    second >= 0
      ? [...(await links().at(term, second)), ...(await links().at(term, second + 1))]
      : [];
  check(
    full.some(link => link.kind === 'file' && link.file === 'src/app.js') &&
      !full.some(link => /win\.ini/.test(link.text)),
    'a full path inside the project is a link; a file outside the project is not (' +
      full.map(link => link.kind + ' ' + link.file).join(' | ') +
      ')'
  );

  // ---- a path the edge breaks ----
  const pad = Math.max(8, term.cols - 10);
  const third = await run(
    term,
    "Write-Host ('three' + ('.' * " + (pad - 5) + ") + ' src/app.js')",
    'three.'
  );
  const broken = third >= 0 ? await links().at(term, third + 1) : [];
  const wide = broken.find(link => link.kind === 'file');
  check(
    !!wide && wide.file === 'src/app.js' && wide.range.end.y === wide.range.start.y + 1,
    'a path broken over two rows by the edge is one link (rows ' +
      wide?.range.start.y +
      ' to ' +
      wide?.range.end.y +
      ' at ' +
      term.cols +
      ' columns)'
  );

  // ---- a real press on the file ----
  const screen = document.querySelector('.tnt-ownterm-host .xterm-screen');
  const cellWidth = box(screen).width / term.cols;
  const cellHeight = box(screen).height / term.rows;
  const viewRow = file.range.start.y - 1 - term.buffer.active.viewportY;
  const point = {
    x: Math.round(box(screen).left + (file.range.start.x + 2) * cellWidth),
    y: Math.round(box(screen).top + (viewRow + 0.5) * cellHeight),
  };
  check(
    viewRow >= 0 && viewRow < term.rows,
    'setup: the line with the file is on screen (row ' + viewRow + ')'
  );
  await input([
    { type: 'mouseMove', x: point.x - 3, y: point.y, wait: 120 },
    { type: 'mouseMove', x: point.x, y: point.y, wait: 500 },
  ]);
  await shot('own-terminal-links-hover');
  await input([
    { type: 'mouseDown', x: point.x, y: point.y, wait: 40 },
    { type: 'mouseUp', x: point.x, y: point.y, wait: 200 },
  ]);
  check(
    !!(await until(
      () => column().state().tab === 'files' && column().state().file === 'src/app.js',
      5000
    )),
    'a press with the mouse opens the file in the Files tab’s reader (' +
      column().state().tab +
      ', ' +
      (column().state().file || 'no file') +
      ')'
  );
  const reader = document.querySelector('.tnt-fileview-text');
  check(
    !!reader && reader.getClientRects().length > 0 && reader.textContent.length > 0,
    'the reader shows the file’s text'
  );
  await shot('own-terminal-links-file');
  column().hideFile();
  column().open('terminal');
  check(
    !!(await until(() => own().shown() && own().term() === term, 5000)),
    'back on the Terminal tab it is the same terminal'
  );

  // ---- the address on this computer ----
  const tabsBefore = window.TnaiLivePreview.tabs().length;
  const way = preview.activate();
  check(
    way === 'preview' &&
      !!(await until(() => layout.classList.contains('preview-mode'), 5000)) &&
      window.TnaiLivePreview.tabs().some(tab => tab.url === 'http://localhost:4321/page'),
    'the address on this computer opens in Live preview (' +
      window.TnaiLivePreview.tabs().length +
      ' addresses there, ' +
      tabsBefore +
      ' before)'
  );
  threads.open();
  await until(() => threads.visible());

  // ---- the outside address ----
  // Caught here: nothing is opened on the user's PC.
  window.open = (...args) => {
    handed.push(args);
    return null;
  };
  const outside = browser.activate();
  check(
    outside === 'browser' &&
      handed.length === 1 &&
      handed[0][0] === 'https://example.com/docs' &&
      handed[0][1] === '_blank',
    'the outside address is handed to the system’s browser (' + JSON.stringify(handed[0]) + ')'
  );
  check(!layout.classList.contains('preview-mode'), 'and Live preview is not opened for it');
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
window.open = realOpen;
if (ownId) await agents.stop(ownId).catch(() => {});

// The app closes when this returns: every shell has ended by then.
for (let tries = 0; tries < 150 && agents.sessions().some(one => one.running); tries++)
  await wait(100);
await wait(1500);
return { ok, log };
