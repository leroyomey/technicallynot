// Technically Not tools · desktop-check/tests/cli-screen-wrapped-delete.js — Claude Code's input
// wraps to a second row: a real mouse selection across row 1 and row 2 is deleted by one real
// Backspace, and a selection on row 1 while the caret is on row 2 by one real Delete (10
// deleteWrappedSelection). Real Claude Code in a temp folder; text is only typed, never sent (no
// usage). Also a PowerShell session (no box rules): a drag from a wrapped input up into earlier
// output clears only the input. Both are worked in the CLI screen of their thread.
// Returns {ok, log}.
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

// How long a delete took (key sent → the input shows the result), polled every 20 ms: logged next
// to the checks below.
const timed = async (fn, ms) => {
  const t0 = performance.now(),
    end = t0 + ms;
  while (performance.now() < end) {
    if (await fn()) return Math.round(performance.now() - t0);
    await wait(20);
  }
  return 0;
};
const key = keyCode =>
  realInput([
    { type: 'keyDown', keyCode },
    { type: 'keyUp', keyCode },
  ]);
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
let pane, psPane;
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

  // Visible rows of the thread's CLI screen (text + position) and its cell size.
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
  const cellW = () =>
    screen().getBoundingClientRect().width / Math.max(...rows().map(d => d.textContent.length), 1);

  // A point at 0.2 of cell `col`: xterm snaps a selection edge to the nearest cell boundary (its
  // centre is the tie, and the real mouse event lands on a whole pixel), so this starts or ends the
  // selection exactly before `col`.
  const at = (rowEl, col) => {
    const r = rowEl.getBoundingClientRect(),
      s = screen().getBoundingClientRect();
    return { x: s.left + (col + 0.2) * (s.width / window.__cols), y: r.top + r.height / 2 };
  };
  const drag = async (a, b) =>
    realInput([
      { type: 'mouseMove', x: a.x, y: a.y },
      { type: 'mouseDown', x: a.x, y: a.y },
      { type: 'mouseMove', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, down: true },
      { type: 'mouseMove', x: b.x, y: b.y, down: true },
      { type: 'mouseUp', x: b.x, y: b.y, wait: 120 },
    ]);
  const type = async () => {
    N.pty.write(pane, '\x7f'.repeat(400) + '\x1b[3~'.repeat(400));
    await until(() => !inputText(), 4000);
    await wait(200); // End + Backspaces: clear any earlier input
    N.pty.write(pane, TEXT);
    return until(() => squash(inputText()) === squash(TEXT) && input().length >= 2, 8000);
  };

  // The panel's column count: the longest rule line is the full width.
  window.__cols = Math.max(...rows().map(d => d.textContent.replace(/\s+$/, '').length));
  log.push('info cols ' + window.__cols + ' cellW ' + cellW().toFixed(2));

  // 1. Drag from row 2 (col 20) up to row 1 (col 60), Backspace.
  check(!!(await type()), 'typed text wraps to ' + (input()?.length || 0) + ' rows');
  if (!input()) {
    rows().forEach(
      (d, i) =>
        d.textContent.trim() &&
        log.push('info row ' + i + ' ' + JSON.stringify(d.textContent.slice(0, 60)))
    );
    throw new Error('no input rows');
  }
  let [r1, r2] = input();
  const row1 = r1.textContent.replace(/^❯ /, '').replace(/\s+$/, ''),
    from = 60 - 2,
    to = row1.length + 1 + (20 - 2);
  await drag(at(r2, 20), at(r1, 60));
  await wait(150);
  await key('Backspace');
  const want1 = TEXT.slice(0, from) + TEXT.slice(to);
  const ms1 = await timed(() => squash(inputText()) === squash(want1), 6000);
  check(
    !!ms1,
    'Backspace deletes a selection across row 1 and row 2 in ' +
      ms1 +
      ' ms → ' +
      JSON.stringify(inputText().slice(40, 90)) +
      (squash(inputText()) === squash(want1) ? '' : ' want ' + JSON.stringify(want1.slice(40, 90)))
  );

  // 2. Caret at the end (row 2); select "gamma delta" on row 1; Delete.
  check(!!(await type()), 'retyped → ' + JSON.stringify(inputText().slice(0, 80)));
  [r1] = input();
  const g = TEXT.indexOf('gamma'),
    e = TEXT.indexOf('epsilon');
  await drag(at(r1, 2 + g), at(r1, 2 + e));
  await wait(150);
  await key('Delete');
  const want2 = TEXT.slice(0, g) + TEXT.slice(e);
  const ms2 = await timed(() => squash(inputText()) === squash(want2), 6000);
  check(
    !!ms2,
    'Delete removes a selection on row 1 while the caret is on row 2 in ' +
      ms2 +
      ' ms → ' +
      JSON.stringify(inputText().slice(0, 40))
  );
  check(squash(inputText()).length === squash(want2).length, 'nothing else was deleted');

  // 3. Two paragraphs with a blank line between (backslash-Enter), caret at the end; drag from the
  // end up past the first row onto the rule above the input; Backspace clears it all.
  N.pty.write(pane, '\x7f'.repeat(400) + '\x1b[3~'.repeat(400));
  await until(() => !inputText(), 4000);
  await wait(200);
  for (const part of [TEXT.slice(0, 120), '\\\r', '\\\r', TEXT.slice(120)]) {
    N.pty.write(pane, part);
    await wait(part.length > 2 ? 400 : 300);
  }
  const box = () => {
    const r = rows(),
      i = r.findIndex(d => /^❯ /.test(d.textContent));
    if (i < 1) return null;
    let j = i + 1;
    while (j < r.length && !/^[─━═]{10}/.test(r[j].textContent)) j++;
    return { ruleAbove: r[i - 1], rows: r.slice(i, j) };
  };
  const b3 = await until(() => {
    const b = box();
    return b &&
      b.rows.length >= 3 &&
      b.rows.some(d => !d.textContent.trim()) &&
      /omega|twenty/.test(b.rows.map(d => d.textContent).join(' '))
      ? b
      : null;
  }, 8000);
  check(!!b3, 'two paragraphs typed → ' + (b3?.rows.length || 0) + ' rows');
  if (!b3)
    rows().forEach(
      (d, i) =>
        d.textContent.trim() &&
        log.push('info row ' + i + ' ' + JSON.stringify(d.textContent.slice(0, 50)))
    );
  if (b3) {
    const last = b3.rows[b3.rows.length - 1];
    await drag(at(last, last.textContent.replace(/\s+$/, '').length + 1), at(b3.ruleAbove, 5));
    await wait(150);
    await key('Backspace');

    // The text goes in one step, not in pieces: every length the input
    // showed on the way to empty is noted (looked at every 10 ms). Runs of 64 keys showed 5 or
    // more; one write shows the end, or one leftover before it.
    const left = () =>
        squash((box()?.rows || []).map(d => d.textContent.replace(/^❯ /, '')).join('')).length,
      full = squash(TEXT).length,
      seen = [];
    const ms3 = await timed(async () => {
      for (let i = 0; i < 2; i++) {
        const n = left();
        if (n !== full && n !== seen[seen.length - 1]) seen.push(n);
        if (!n) return true;
        if (!i) await wait(10);
      }
      return false;
    }, 15000);
    check(
      !!ms3,
      'Backspace clears both paragraphs in ' +
        ms3 +
        ' ms → ' +
        JSON.stringify(
          (box()?.rows || [])
            .map(d => d.textContent.trim())
            .join('|')
            .slice(0, 80)
        )
    );
    check(
      seen.length <= 2,
      'the ' +
        full +
        ' letters go in one step, not in pieces: lengths shown after the key ' +
        JSON.stringify(seen)
    );
  }

  // 4. PowerShell (no box rules): the blank row above the prompt ends the input block, so a drag
  // from the end of a wrapped input up into earlier output clears only the input; the output stays
  // and nothing runs.
  psPane = (await window.TnaiTest.open('Terminal'))?.paneId;
  check(await openCliScreen(psPane), 'the PowerShell thread shows its screen');
  const psRows = () => [...cliBox().querySelectorAll('.xterm-rows > div')];
  const rowText = d => d.textContent.replace(/ /g, ' ');
  const psPlain = async () => strip((await N.pty.replay(psPane))?.buffer || '');
  check(
    !!(await until(() => psRows().some(d => />\s*$/.test(rowText(d))), 20000)),
    'PowerShell panel started'
  );
  await wait(1200);
  N.pty.write(
    psPane,
    'echo "cols=$($Host.UI.RawUI.WindowSize.Width)"; echo keep-this-line; echo ""\r'
  );
  const psCols = Number(
    (await until(async () => (await psPlain()).match(/cols=(\d+)/)?.[1], 8000)) || 0
  );
  await until(() => psRows().some(d => rowText(d) === 'keep-this-line'), 8000);
  await wait(800);
  N.pty.write(psPane, TEXT);

  // The prompt can span rows (this PC's profile draws a two-row prompt), so the block is every row
  // from the first one after the blank row.
  const psBox = () => {
    const r = psRows(),
      k = r.findIndex(d => rowText(d) === 'keep-this-line');
    if (k < 0) return null;
    let i = k + 1;
    while (i < r.length && !rowText(r[i]).trim()) i++;
    if (i >= r.length) return null;
    let j = i;
    while (j + 1 < r.length && rowText(r[j + 1]).trim()) j++;
    return { keep: r[k], blank: i > k + 1, rows: r.slice(i, j + 1) };
  };
  const b4 = await until(() => {
    const b = psBox();
    return b && b.rows.length >= 2 && /twenty\s*$/.test(b.rows.map(rowText).join('')) ? b : null;
  }, 8000); // joined: a narrow panel wraps inside "twenty"
  check(
    !!b4 && b4.blank && psCols > 0,
    'PowerShell: output, a blank row, then the input wrapped to ' +
      (b4?.rows.length || 0) +
      ' rows (cols ' +
      psCols +
      ')'
  );
  if (!b4)
    psRows().forEach(
      (d, i) =>
        rowText(d).trim() &&
        log.push('info ps row ' + i + ' ' + JSON.stringify(rowText(d).slice(0, 70)))
    );
  if (b4) {
    const sc = cliBox().querySelector('.xterm-screen').getBoundingClientRect();
    const psAt = (rowEl, col) => {
      const r = rowEl.getBoundingClientRect();
      return { x: sc.left + (col + 0.2) * (sc.width / psCols), y: r.top + r.height / 2 };
    };
    const last = b4.rows[b4.rows.length - 1];
    await drag(psAt(last, rowText(last).replace(/\s+$/, '').length + 1), psAt(b4.keep, 3));
    await wait(150);
    await key('Backspace');
    check(
      !!(await until(() => {
        const b = psBox();
        return b && b.rows.length && !/Alpha|omega|twenty/.test(b.rows.map(rowText).join(' '));
      }, 15000)),
      'PowerShell: Backspace clears the whole wrapped input → ' +
        JSON.stringify((psBox()?.rows || []).map(rowText).join('|').slice(-240))
    );
    check(
      !!psBox()?.keep && !/not recognized|CommandNotFound/.test(await psPlain()),
      'PowerShell: the output above stays and nothing ran'
    );

    // 5. One row, caret at its start (Home): the arrows plus Backspaces are more than 64 keys, sent
    // in runs.
    const S = TEXT.slice(0, psCols - 8).trim();

    // Esc and typing right away, while case 4's delete may still be stepping: none of its keys may
    // land on the new text.
    N.pty.write(psPane, '\x1b');
    await wait(300);
    N.pty.write(psPane, S);
    const r5 = await until(() => psRows().find(d => rowText(d).trim() === S), 8000);
    check(!!r5, 'PowerShell: one full row typed (' + S.length + ' letters)');
    if (r5) {
      await key('Home');
      await wait(400);
      await drag(psAt(r5, 0), psAt(r5, S.length + 1));
      await wait(150);
      await key('Backspace');
      const ms5 = await timed(() => !psRows().some(d => /Alpha/.test(rowText(d))), 10000);
      check(
        !!ms5,
        'PowerShell: Backspace deletes a whole selected row with the caret at its start (' +
          S.length * 2 +
          ' keys) in ' +
          ms5 +
          ' ms → ' +
          JSON.stringify(
            psRows()
              .map(rowText)
              .filter(t => t.trim())
              .slice(-2)
              .join('|')
          )
      );
    }
  }
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
  if (psPane) {
    N.pty.write(psPane, '');
    await wait(200);
    G.stop(psPane);
    await wait(300);
  }
}
return { ok, log };
