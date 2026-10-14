// Technically Not tools · desktop-check/tests/cli-screen-click-caret.js — a plain click in Claude
// Code's wrapped input moves the caret there (10 clickMovesCaret): a real click on row 1 then
// typing puts the letter at the click, a click on row 2 likewise, a click in earlier output moves
// nothing. Real Claude Code in a temp folder; text is only typed, never sent (no usage). The
// clicks are made in the CLI screen of its thread. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true,
  inputSeq = 0;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(150);
  }
  return null;
};
const realInput = events =>
  new Promise(resolve => {
    const id = 'i' + ++inputSeq;
    (window.__tnaiInputDone ||= {})[id] = () => {
      delete window.__tnaiInputDone[id];
      resolve();
    };
    setTimeout(() => {
      if (window.__tnaiInputDone[id]) {
        log.push('info input ' + id + ' timed out');
        resolve();
      }
    }, 10000);
    console.log('TNAI_INPUT:' + JSON.stringify({ id, events }));
  });
const G = window.TnaiAgents,
  N = window.tnaiNative;
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const TEXT =
  'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
const squash = s => s.replace(/\s+/g, '');

// The terminal a user sees now is the CLI screen of the session's thread (120): the thread is
// opened, set to its screen (the row "CLI screen" of its "..." menu does the same), and the test
// waits until that terminal shows this session.
const cliBox = () => window.TnaiThreads.slot('main').querySelector('.tnt-term-box');
const openCliScreen = async paneId => {
  window.TnaiThreads.show(paneId);
  await until(() => window.TnaiThreadView.shown() === paneId, 8000);
  if (window.TnaiThreadView.mode() !== 'term') window.TnaiThreadView.setMode('term');
  const there = await until(
    () =>
      window.TnaiThreadView.mode() === 'term' &&
      window.TnaiThreadView.term()?.tnaiPaneId === paneId &&
      cliBox().querySelector('.xterm-screen')?.getClientRects().length,
    10000
  );
  await wait(900);
  return !!there;
};
let pane;
try {
  const cc = await window.TnaiTest.open('Claude Code', { mode: 'run' });
  pane =
    cc?.paneId ||
    G.sessions()
      .filter(s => s.agent === 'Claude Code')
      .pop()?.paneId;
  const plain = async () => strip((await N.pty.replay(pane))?.buffer || '');
  check(
    !!(await until(async () => /for shortcuts|Try "|trust/i.test(await plain()), 25000)),
    'Claude Code started'
  );
  await wait(1500);
  if (/trust/.test(await plain())) {
    N.pty.write(pane, '\x1b[B');
    await wait(800);
    N.pty.write(pane, '\r');
    await wait(4000);
  }
  check(await openCliScreen(pane), 'its thread shows the CLI screen');
  const screen = () => cliBox().querySelector('.xterm-screen');
  const rows = () =>
    [...cliBox().querySelectorAll('.xterm-rows > div')].map(d => ({
      el: d,
      textContent: d.textContent.replace(/ /g, ' '),
      getBoundingClientRect: () => d.getBoundingClientRect(),
    }));
  const input = () => {
    const r = rows(),
      i = r.findIndex(d => /^❯ /.test(d.textContent));
    if (i < 0) return null;
    const out = [r[i]];
    for (let j = i + 1; j < r.length && /^  \S/.test(r[j].textContent); j++) out.push(r[j]);
    return out;
  };
  const inputText = () =>
    (input() || [])
      .map((d, i) => (i ? d.textContent.trim() : d.textContent.replace(/^❯ /, '').trim()))
      .join(' ');

  // A point just left of the boundary before cell `col` (a click snaps to the nearest boundary).
  const at = (rowEl, col) => {
    const r = rowEl.getBoundingClientRect(),
      s = screen().getBoundingClientRect();
    return { x: s.left + (col - 0.2) * (s.width / window.__cols), y: r.top + r.height / 2 };
  };
  const click = p =>
    realInput([
      { type: 'mouseMove', x: p.x, y: p.y },
      { type: 'mouseDown', x: p.x, y: p.y },
      { type: 'mouseUp', x: p.x, y: p.y, wait: 120 },
    ]);
  window.__cols = Math.max(...rows().map(d => d.textContent.replace(/\s+$/, '').length));
  N.pty.write(pane, '\x7f'.repeat(400) + '\x1b[3~'.repeat(400));
  await until(() => !inputText(), 4000);
  await wait(200);
  N.pty.write(pane, TEXT);
  check(
    !!(await until(() => squash(inputText()) === squash(TEXT) && input().length >= 2, 8000)),
    'typed text wraps to ' + (input()?.length || 0) + ' rows'
  );
  if (!input()) throw new Error('no input rows');

  // 1. Click before "gamma" on row 1, type X.
  let [r1, r2] = input();
  await click(at(r1, 2 + TEXT.indexOf('gamma')));
  await wait(1500); // let the arrows step
  const want1 = TEXT.replace('gamma', 'Xgamma');
  N.pty.write(pane, 'X');
  check(
    !!(await until(() => squash(inputText()) === squash(want1), 5000)),
    'row 1 click puts the caret before "gamma" → ' + JSON.stringify(inputText().slice(0, 40))
  );

  // 2. Click before the first word of row 2, type Y.
  [r1, r2] = input();
  const w2 = r2.textContent.trim().split(/\s+/)[0],
    lead = r2.textContent.length - r2.textContent.trimStart().length;
  await click(at(r2, lead));
  await wait(1500);
  N.pty.write(pane, 'Y');
  const i2 = want1.indexOf(' ' + w2 + ' ', want1.length / 3) + 1,
    want2 = want1.slice(0, i2) + 'Y' + want1.slice(i2);
  check(
    !!(await until(() => squash(inputText()) === squash(want2), 5000)),
    'row 2 click puts the caret before "' +
      w2 +
      '" → ' +
      JSON.stringify(inputText().slice(i2 - 20, i2 + 20))
  );

  // 3. A click above the input box (earlier output / welcome) moves nothing: Z lands after Y.
  const above = rows().findIndex(d => /^❯ /.test(d.textContent)) - 3;
  if (above >= 0) {
    await click(at(rows()[above], 4));
    await wait(800);
    N.pty.write(pane, 'Z');
    const want3 = want2.slice(0, i2 + 1) + 'Z' + want2.slice(i2 + 1);
    check(
      !!(await until(() => squash(inputText()) === squash(want3), 5000)),
      'a click above the input box leaves the caret → ' +
        JSON.stringify(inputText().slice(i2 - 10, i2 + 20))
    );
  }

  // 4. Select one letter (the X before "gamma") with a real drag and type over it: the letter is
  // replaced (10 replaceSelection).
  const before = inputText();
  [r1] = input();
  const cx = 2 + TEXT.indexOf('gamma'),
    cell = (rowEl, c) => {
      const r = rowEl.getBoundingClientRect(),
        s = screen().getBoundingClientRect();
      return { x: s.left + c * (s.width / window.__cols), y: r.top + r.height / 2 };
    };
  const a = cell(r1, cx + 0.2),
    b = cell(r1, cx + 0.95);
  await realInput([
    { type: 'mouseMove', x: a.x, y: a.y },
    { type: 'mouseDown', x: a.x, y: a.y, wait: 60 },
    { type: 'mouseMove', x: (a.x + b.x) / 2, y: a.y, down: true, wait: 40 },
    { type: 'mouseMove', x: b.x, y: b.y, down: true, wait: 60 },
    { type: 'mouseUp', x: b.x, y: b.y, wait: 200 },
  ]);
  await realInput([
    { type: 'keyDown', keyCode: 'q' },
    { type: 'char', keyCode: 'q' },
    { type: 'keyUp', keyCode: 'q', wait: 200 },
  ]);
  const want4 = before.replace('Xgamma', 'qgamma');
  check(
    !!(await until(() => squash(inputText()) === squash(want4), 6000)),
    'typing over one selected letter replaces it → ' + JSON.stringify(inputText().slice(0, 40))
  );

  // 5. A click after the last letter puts the caret back at the end: the next letter lands there.
  const last = input().at(-1);
  await click(at(last, last.textContent.replace(/\s+$/, '').length + 3));
  await wait(2500);
  N.pty.write(pane, 'W');
  check(
    !!(await until(() => squash(inputText()) === squash(want4) + 'W', 6000)),
    'a click past the end of the text, then typing, continues at the end → ' +
      JSON.stringify(inputText().slice(-30))
  );
} catch (e) {
  check(false, 'threw ' + (e.stack || e));
} finally {
  if (pane) {
    N.pty.write(pane, '\x15');
    await wait(200);
    N.pty.write(pane, '\x03');
    await wait(300);
    N.pty.write(pane, '\x03');
    await wait(300);
    G.stop(pane);
    await wait(500);
  }
}
return { ok, log };
