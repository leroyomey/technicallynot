// Technically Not tools · desktop-check/tests/thread-saved-screen.js — a stopped session's saved
// screen on a thread's CLI screen (120 showSaved, 132). A real PowerShell thread runs beside a
// side column made as wide as it goes and prints what a CLI prints: a paragraph it broke itself
// for that narrow width, under a bullet, and two list rows. It is stopped and the side column
// put away. Its thread then shows the saved
// screen laid out again for the full width of the island: the paragraph is one line again, the
// list rows stay two rows, and the line "Saved screen · press Enter to redraw" stands under it.
// Enter starts it again: a running view, and the line goes. The Tokens/min chip is checked on the
// way: no band behind its line. Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const view = () => window.TnaiThreadView;
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value * 10) / 10;

try {
  await agents.detect(true);

  // ---- a session that last ran at a narrow width: a thread beside a wide side column ----
  const id = (await window.TnaiTest.startThread({ tool: 'Terminal', show: true })).paneId;
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === id && s.running))),
    'setup: a PowerShell session runs as a thread'
  );
  await until(() => view().shown() === id, 6000);
  if (view().mode() !== 'term') view().setMode('term');
  await until(() => view().term()?.element?.getClientRects().length, 8000);
  await wait(600);
  const colsAtFull = view().term().cols;

  // the side column as wide as it goes: the thread keeps only its smallest width
  window.TnaiThreadSide.open('files');
  await until(() => window.TnaiThreadSide.state().shown, 4000);
  window.TnaiThreadSideSize.set(5000);
  const ran = await until(() => {
    const size = agents.ptySize.get(id);
    return size?.cols > 0 && size.cols < colsAtFull - 20 && view().term()?.cols === size.cols
      ? size
      : null;
  }, 8000);
  check(
    !!ran,
    'setup: beside the wide side column the session runs narrow (' +
      ran?.cols +
      ' columns, ' +
      colsAtFull +
      ' before)'
  );
  await wait(500);

  // A paragraph of forty words, broken the way a CLI breaks it: at words, for this width, the
  // rows after the first standing under the text.
  const words = [];
  for (let count = 1; count <= 40; count++) words.push('w' + String(count).padStart(2, '0'));
  const broken = [];
  let row = '● ';
  for (const word of words) {
    if (row.length + word.length + 1 > ran.cols - 2 && row.trim() !== '●') {
      broken.push(row.trimEnd());
      row = '  ';
    }
    row += word + ' ';
  }
  broken.push(row.trimEnd());
  const printed = [...broken, '', '- first', '- second'];
  window.tnaiNative.pty.write(
    id,
    'cls; ' + printed.map(line => "Write-Host '" + line + "'").join('; ') + '\r'
  );
  await wait(1500);
  check(broken.length >= 2, 'setup: the paragraph was printed on ' + broken.length + ' rows');
  const ranAt = agents.ptySize.get(id)?.cols || ran?.cols;
  await agents.stop(id);
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === id && !s.running))),
    'setup: the session is stopped'
  );

  // ---- its thread, with the side column put away: the island at its full width ----
  window.TnaiThreadSideSize.set(0);
  window.TnaiThreadSide.close();
  await wait(400);
  threads.show(id);
  await until(() => view().shown() === id, 6000);
  if (view().mode() !== 'term') view().setMode('term');
  const island = threads.slot('main');
  const host = () => island.querySelector('.tnt-term-box .tnt-term-host');
  const note = island.querySelector('.tnt-term-note');
  const placed = await until(() => host()?.dataset.saved && view().term(), 10000);
  check(!!placed, 'the stopped session is shown as a saved screen');
  await wait(600);
  const term = view().term();
  const room = box(island.querySelector('.tnt-term-box'));
  const column = box(host());
  check(
    term?.cols > ranAt && Math.abs(column.width - room.width) <= 1,
    'the terminal fills the island (' + term?.cols + ' columns; the session ran at ' + ranAt + ')'
  );
  const rows = [];
  for (let y = 0; y < term.buffer.active.length; y++)
    rows.push(term.buffer.active.getLine(y)?.translateToString(true) || '');
  const paragraph = rows.find(line => line.startsWith('● w01')) || '';
  check(
    paragraph === '● ' + words.join(' '),
    'the paragraph the program broke on ' +
      broken.length +
      ' rows is one line again, across the island (' +
      paragraph.length +
      ' characters)'
  );
  check(rows.includes('- first') && rows.includes('- second'), 'the two list rows stay two rows');
  check(
    !note.hidden &&
      note.getClientRects().length > 0 &&
      /press Enter to redraw/.test(note.textContent),
    'the line under it says what it is: "' + note.textContent + '"'
  );
  check(
    box(note).bottom <= box(island).bottom + 0.5 && box(note).top >= column.bottom - 0.5,
    'that line is under the terminal, inside the island'
  );
  console.log('TNAI_SHOT:thread-saved-screen-wide');
  await wait(600);

  // ---- the Tokens/min chip: no band behind its line ----
  const chip = document.getElementById('pgTokChip');
  if (chip && !chip.hidden) {
    chip.dispatchEvent(new MouseEvent('mouseenter'));
    await wait(900);
    check(!chip.querySelector('svg rect'), 'the Tokens/min chip draws no band behind its line');
  } else log.push('note the Tokens/min chip is not shown in this window: band not checked');

  // ---- Enter starts it again: a fitted, running view ----
  agents.stoppedInput(id, '\r', term);
  check(
    !!(await until(() => agents.sessions().find(s => s.paneId === id && s.running), 15000)),
    'Enter starts the session again'
  );
  check(
    !!(await until(() => !host().dataset.saved && note.hidden, 6000)),
    'running: no longer a saved screen, the line is gone'
  );
  await wait(700);
  const wide = box(host());
  check(
    Math.abs(wide.width - box(island.querySelector('.tnt-term-box')).width) <= 1 &&
      view().term().cols > ranAt &&
      !!agents.ptySize.get(id),
    'running: the terminal fills the island (' + view().term().cols + ' columns)'
  );
  console.log('TNAI_SHOT:thread-saved-screen-running');
  await wait(600);
  await agents.stop(id);
  await until(() => !agents.sessions().some(s => s.running), 10000);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
