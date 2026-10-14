/*
 * Technically Not tools · desktop-check/tests/report-highlight.js — Report highlight (75): a
 * terminal made by 10's createTerm tints the "Technically Not report" block (heading + each item
 * row, wrapped text included) and colors the heading and "Did:"-style labels, and leaves ordinary
 * text, a heading with no items, and the lines after the block alone; status sections
 * (done/stopped/open) get their colors (the scrollbar marks were removed on purpose, 2026-09-29).
 * Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
const host = document.createElement('div');
try {
  host.style.cssText =
    'position:fixed;left:40px;top:40px;width:760px;height:420px;z-index:99999;background:#fbfcf9;border:1px solid #ccc';
  document.body.append(host);
  const { term, fit } = await window.TnaiAgents.createTerm();
  term.open(host);
  fit.fit();
  const write = s => new Promise(r => term.write(s.replace(/\n/g, '\r\n'), r));
  await write(
    [
      'Some ordinary output',
      'Technically Not report',
      'Just a mention, no items follow',
      '',
      '\x1b[1m● \x1b[0mDone. Here is what changed.',
      '',
      '  Technically Not report',
      '  - Did: added the highlight; ' +
        'a long item that wraps onto a second terminal row because it is much wider than the box '.repeat(
          2
        ),
      '  - Changed: \x1b[34msrc/scripts/75-report-highlight.js\x1b[0m (new)',
      '  - Blockers: none',
      '',
      '> next prompt',
    ].join('\n') + '\n'
  );
  await wait(400);
  const p = window.TnaiReportHighlight.painted(term),
    buf = term.buffer.active;
  const lineOf = t => {
    for (let i = 0; i < buf.length; i++)
      if (buf.getLine(i).translateToString(true).includes(t)) return i;
    return -1;
  };
  const bgLines = new Set(p.filter(d => d.bg).map(d => d.line)),
    fg = p.filter(d => d.fg);
  const head = lineOf('  Technically Not report'),
    did = lineOf('- Did:'),
    blk = lineOf('- Blockers:');
  check(
    !bgLines.has(lineOf('Some ordinary output')) && !bgLines.has(lineOf('Just a mention')),
    'ordinary text and a heading with no items are not tinted'
  );
  check(
    bgLines.has(head) && bgLines.has(did) && bgLines.has(did + 1) && bgLines.has(blk),
    'heading, items and the wrapped row are tinted'
  );
  check(!bgLines.has(lineOf('> next prompt')), 'text after the block is not tinted');
  check(
    fg.some(d => d.line === head && d.x === 2) &&
      fg.some(d => d.line === did && d.x === 4 && d.width === 4),
    'heading and the "Did:" label are colored'
  );
  check(
    !fg.some(d => d.line === lineOf('- Changed:') && d.width > 8),
    'the file name keeps its own color'
  );
  const labelFg = line => fg.find(d => d.line === line && d.x === 4)?.fg,
    rowBg = line => p.find(d => d.line === line && d.bg)?.bg;
  const chg = lineOf('- Changed:');
  check(
    labelFg(did) &&
      labelFg(chg) &&
      labelFg(blk) &&
      new Set([labelFg(did), labelFg(chg), labelFg(blk)]).size === 3,
    'Did, Changed and Blockers labels each have their own color'
  );
  check(
    rowBg(did) === rowBg(did + 1) && rowBg(did) !== rowBg(chg),
    "a wrapped row keeps its label's tint; different labels get different tints"
  );

  // Status sections: done green, stopped yellow, open purple; sentences starting with the same
  // words stay alone.
  await write(
    [
      '',
      '\x1b[1m● \x1b[0mWe were working on taxes.',
      '',
      '  Already done:',
      '  1. Tax notes in \x1b[34mdocs/business/taxes/README.md\x1b[0m. ' +
        'They cover what the business can write off and more. '.repeat(2),
      '  2. Receipts check',
      '',
      '  Where we stopped: you were going to download the receipts.',
      '',
      '  Still open:',
      '  - Check the X Premium amount',
      '',
      '  Open the file and look. Done so far is fine.',
      '  Finished the task yesterday.',
      '',
      '  Your turn:',
      '  1. Open the dashboard and sign in',
      '  2. Paste the key',
      '',
      '  Your turn to pick a color was yesterday.',
      '',
      '  Need your help: sign in to the listing site.',
      '',
      '  Heads up: this conversation has grown long. ' +
        'Everything open is saved in the plan, so a compact now would lose nothing. '.repeat(2),
      '',
      '  Notice how the list above is colored.',
    ].join('\n') + '\n'
  );
  await wait(400);
  const p2 = window.TnaiReportHighlight.painted(term).filter(d => d.fg),
    fgAt = t => p2.find(d => d.line === lineOf(t))?.fg;
  const done = fgAt('Already done:'),
    stop = fgAt('Where we stopped'),
    open = fgAt('Still open:');
  check(
    done && stop && open && new Set([done, stop, open]).size === 3,
    'done, stopped and open sections each have their own color'
  );
  check(
    fgAt('1. Tax notes') === done &&
      fgAt('2. Receipts') === done &&
      p2.some(d => d.line === lineOf('1. Tax notes') + 1 && d.fg === done),
    'done items and their wrapped row are colored'
  );
  check(fgAt('- Check the X Premium') === open, 'open items are colored');
  check(
    !fgAt('Open the file') && !fgAt('Finished the task') && !fgAt('We were working'),
    'ordinary sentences are not colored'
  );

  // Steps the user must do: their own color, a fourth one.
  const you = fgAt('Your turn:');
  check(
    you &&
      new Set([done, stop, open, you]).size === 4 &&
      fgAt('1. Open the dashboard') === you &&
      fgAt('2. Paste the key') === you &&
      fgAt('Need your help:') === you,
    'the user\'s own steps ("Your turn:", "Need your help:") have a fourth color'
  );
  check(!fgAt('Your turn to pick'), 'a sentence starting with "Your turn" is not colored');

  // A notice the user must not miss ("Heads up:"): amber text on a tinted row, wrapped row
  // included; a sentence starting "Notice" stays plain.
  const all2 = window.TnaiReportHighlight.painted(term),
    hu = lineOf('Heads up:'),
    note = fgAt('Heads up:');
  check(
    note &&
      new Set([done, stop, open, you, note]).size === 5 &&
      [hu, hu + 1].every(
        l => all2.some(d => d.line === l && d.bg) && all2.some(d => d.line === l && d.fg === note)
      ),
    'a "Heads up:" notice has its own color and a tinted row, wrapped row included'
  );
  check(
    !fgAt('Notice how') && !all2.some(d => d.line === lineOf('Notice how') && d.bg),
    'a sentence starting with "Notice" is not colored'
  );

  // Check lists: the label word of "- Fixed:" style items is colored,
  // nothing else: no row tint, the rest of the line plain; a bullet with another label and a
  // sentence starting with the same word stay plain.
  await write(
    [
      '',
      '  - Fixed: the count is right now. ' +
        'A long line that wraps onto a second terminal row because it is wider than the box. '.repeat(
          2
        ),
      '  - Matches: the page and the doc say the same',
      '  - Missed: the tablet width',
      '  - Not verified: a real phone',
      '  - Does not apply: the Linux build',
      '  - Checked: something else',
      '  Fixed: a sentence, not a list item.',
    ].join('\n') + '\n'
  );
  await wait(400);
  const pc = window.TnaiReportHighlight.painted(term),
    at = t => pc.filter(d => d.line === lineOf(t));
  const cFix = at('- Fixed:')[0],
    cMat = at('- Matches:')[0],
    cMis = at('- Missed:')[0],
    cNot = at('- Not verified:')[0],
    cNa = at('- Does not apply:')[0];
  check(
    cFix &&
      cFix.x === 4 &&
      cFix.width === 6 &&
      !cFix.bg &&
      at('- Fixed:').length === 1 &&
      !pc.some(d => d.line === lineOf('- Fixed:') + 1),
    'a check-list label is colored as the word only: no row tint, the wrapped row plain'
  );
  check(
    cFix?.fg &&
      cFix.fg === cMat?.fg &&
      cMis?.fg &&
      cMis.fg === cNot?.fg &&
      cNa?.fg &&
      new Set([cFix.fg, cMis.fg, cNa.fg]).size === 3 &&
      cNot.width === 13,
    'Fixed and Matches share one color, Missed and Not verified another, Does not apply a third'
  );
  check(
    !at('- Checked:').length && !at('Fixed: a sentence').length,
    'a bullet with another label and a sentence starting "Fixed:" are not colored'
  );
  await shot('report-sections');

  // A section longer than the rescan tail keeps its color on rows below the rescan line once more
  // output arrives.
  await write(
    [
      '',
      '  Still open:',
      ...Array.from({ length: 100 }, (_, n) => '  - long step ' + String(n).padStart(3, '0')),
    ].join('\n') + '\n'
  );
  await wait(400);
  await write(['', 'more output after the list', 'and another line'].join('\n') + '\n');
  await wait(400);
  const p3 = window.TnaiReportHighlight.painted(term).filter(d => d.fg);
  check(
    ['long step 000', 'long step 050', 'long step 090'].every(t =>
      p3.some(d => d.line === lineOf(t) && d.fg === open)
    ),
    'a long section keeps its color after more output'
  );
  await shot('report-highlight');
  await wait(1500);
  await write(Array.from({ length: 60 }, (_, n) => 'filler line ' + n).join('\n') + '\n');
  await wait(400);
  check(!host.querySelector('.tnai-report-marks'), 'no scrollbar report marks (removed)');

  // A click on a report item pastes "Ideas 2: <item>" into this terminal's input in one go, never
  // sent (no Enter, no session send: the user may add to it first) and
  // never into the composer.
  await write(
    [
      '',
      '  Technically Not report',
      '  - Did: something',
      '  - Found: open thing a → fix: x (fix 50%)',
      '  - Remains: open thing one; open thing two',
      '  - Untested: open thing b → try: y',
      '  - Blockers: open thing c',
      '  - Decide: Decision 2 of 3: which format? | 1. CSV (recommended) | 2. JSON',
      '  - Ideas: first idea (fit 80%); second idea to try (fit 60%)',
      '',
    ].join('\n') + '\n'
  );
  await wait(300);
  const typed = [],
    sub = term.onData(d => typed.push(d)),
    composer = document.getElementById('prompt'),
    before = composer?.value;
  const providers = term._core?._linkProviderService?.linkProviders || [],
    ideasRow = lineOf('- Ideas: first idea') + 1;
  const found = await Promise.all(
    providers.map(pr => new Promise(r => pr.provideLinks(ideasRow, r)))
  );
  const second = found
    .flat()
    .filter(Boolean)
    .find(l => /second idea/.test(l.text));
  check(!!second, 'the second Ideas item is a link (' + providers.length + ' link providers)');
  for (const sec of ['Found', 'Remains', 'Untested', 'Blockers']) {
    const row = lineOf('- ' + sec + ': open thing') + 1,
      ls = await Promise.all(providers.map(pr => new Promise(r => pr.provideLinks(row, r))));
    check(
      row > 0 &&
        !ls
          .flat()
          .filter(Boolean)
          .some(l => /open thing/.test(l.text)),
      sec + ' items are not links'
    );
  }
  const agentsApi = window.TnaiAgents,
    realSend = agentsApi.send,
    sends = [];
  term.tnaiPaneId = 'report-click-pane';
  agentsApi.send = (id, text) => {
    sends.push([id, text]);
    return true;
  }; // must not be used: a send would submit it
  second?.activate(new MouseEvent('click'), second.text);
  await wait(100);
  agentsApi.send = realSend;
  const got = typed.join('').replace(/\x1b\[20[01]~/g, '');
  check(
    !sends.length && got === 'Ideas 2: second idea to try / ' && !/\r/.test(typed.join('')),
    'click puts the item in this terminal input ending " / ", not sent, no Enter: ' +
      JSON.stringify(sends) +
      ' ' +
      JSON.stringify(got)
  );

  // Every click ends with " / ", so a second click or the user's own words never run into the first
  // (before: " — " in front of a second click).
  const first = found
    .flat()
    .filter(Boolean)
    .find(l => /first idea/.test(l.text));
  typed.length = 0;
  first?.activate(new MouseEvent('click'), first.text);
  await wait(100);
  const got2 = typed.join('').replace(/\x1b\[20[01]~/g, '');
  check(
    got2 === 'Ideas 1: first idea / ',
    'a second click has nothing in front and ends " / ": ' + JSON.stringify(got2)
  );

  // A click keeps the view where the user reads; a real terminal jumps to the
  // newest line on every paste (10), stood in for here by the same listener.
  {
    const snap = term.onData(() => term.scrollToBottom()),
      b = term.buffer.active;
    if (b.baseY > 0) {
      term.scrollToLine(0);
      first?.activate(new MouseEvent('click'), first.text);
      await wait(100);
      check(
        b.viewportY === 0,
        'a click while scrolled up leaves the view there: line ' + b.viewportY
      );
      term.scrollToBottom();
      first?.activate(new MouseEvent('click'), first.text);
      await wait(100);
      check(b.viewportY === b.baseY, 'a click at the newest line stays at the newest line');
    } else check(true, 'view-stays check skipped: the test terminal has nothing to scroll');
    snap.dispose();
    typed.length = 0;
  }

  // An option of a numbered decision names its decision.
  const decRow = lineOf('- Decide: Decision 2 of 3') + 1,
    decLinks = (
      await Promise.all(providers.map(pr => new Promise(r => pr.provideLinks(decRow, r))))
    )
      .flat()
      .filter(Boolean);
  const json = decLinks.find(l => /^JSON/.test(l.text));
  typed.length = 0;
  json?.activate(new MouseEvent('click'), json.text);
  await wait(100);
  const got3 = typed.join('').replace(/\x1b\[20[01]~/g, '');
  check(
    got3 === 'Decision 2, option 2: JSON / ',
    'an option of "Decision 2 of 3" is put in as Decision 2, option 2: ' + JSON.stringify(got3)
  );

  // A Decide line written in the reply above the heading (its options could not be
  // clicked) is a decision all the same; an Ideas line out there, and a Decide line with no options
  // on it, are plain text.
  await write(
    [
      'Here is the choice.',
      '- Decide: Stray one: which store? | 1. Memory (recommended) | 2. Disk',
      '- Ideas: stray idea alone',
      '',
      'Some words.',
      '- Decide: stray with no options on it',
      '',
      'Technically Not report',
      '- Did: asked a question',
      '',
    ].join('\n') + '\n'
  );
  await wait(300);
  const linksOn = async s => {
    const row = lineOf(s) + 1;
    return row > 0
      ? (await Promise.all(providers.map(pr => new Promise(r => pr.provideLinks(row, r)))))
          .flat()
          .filter(Boolean)
      : null;
  };
  const strayLinks = await linksOn('- Decide: Stray one'),
    disk = strayLinks?.find(l => /^Disk/.test(l.text));
  typed.length = 0;
  disk?.activate(new MouseEvent('click'), disk.text);
  await wait(100);
  const got4 = typed.join('').replace(/\x1b\[20[01]~/g, '');
  check(
    strayLinks?.filter(l => !/^Stray one/.test(l.text)).length === 2 &&
      got4 === 'Decide 2: Disk / ',
    'a Decide line above the report heading has its options as links (' +
      strayLinks?.length +
      ' links with its question, click puts in ' +
      JSON.stringify(got4) +
      ')'
  );

  // Only the options of a Decide line are links, never its question: numbered,
  // unnumbered and wrapped over two rows.
  const isQ = l => /\?$/.test(l.text);
  check(
    decLinks.length === 2 && !decLinks.some(isQ) && decLinks.every(l => /^(CSV|JSON)/.test(l.text)),
    'numbered Decide line: its 2 options are links and its question is not (' +
      decLinks.length +
      ' links)'
  );
  check(
    strayLinks?.length === 2 && !strayLinks.some(isQ),
    'unnumbered Decide line: the question is not a link either (' + strayLinks?.length + ' links)'
  );
  await write(
    [
      '',
      'Technically Not report',
      '- Did: asked again',
      '- Decide: Decision 3 of 3: ' +
        'a long question that runs on and on past the right edge of this terminal box '
          .repeat(2)
          .trim() +
        '? | 1. Wide (recommended) | 2. Narrow',
      '',
    ].join('\n') + '\n'
  );
  await wait(300);
  const wrapRow = lineOf('- Decide: Decision 3 of 3') + 1,
    wrapAt = async row =>
      (await Promise.all(providers.map(pr => new Promise(r => pr.provideLinks(row, r)))))
        .flat()
        .filter(Boolean);
  const wrapAll = [
    ...(await wrapAt(wrapRow)),
    ...(await wrapAt(wrapRow + 1)),
    ...(await wrapAt(wrapRow + 2)),
  ];
  const narrow = wrapAll.find(l => /^Narrow/.test(l.text));
  typed.length = 0;
  narrow?.activate(new MouseEvent('click'), narrow.text);
  await wait(100);
  check(
    !wrapAll.some(isQ) &&
      typed.join('').replace(/\x1b\[20[01]~/g, '') === 'Decision 3, option 2: Narrow / ',
    'wrapped line: no row of the question is a link and its option still puts in the option text: ' +
      JSON.stringify(typed.join(''))
  );
  const strayIdeas = await linksOn('- Ideas: stray idea alone'),
    strayBare = await linksOn('- Decide: stray with no options');
  check(
    strayIdeas && !strayIdeas.length && strayBare && !strayBare.length,
    'outside the block an Ideas line and a Decide line without options are not links (' +
      strayIdeas?.length +
      ', ' +
      strayBare?.length +
      ')'
  );
  check(composer?.value === before, 'the composer is left untouched');
  sub.dispose();

  // An emoji in an item (one character, two UTF-16 units, two cells) must not move the links that
  // come after it on the line.
  await write(
    [
      '',
      '  Technically Not report',
      '  - Did: something else',
      '  - Ideas: launch it 🚀 now (fit 80%); after emoji idea (fit 60%)',
      '',
    ].join('\n') + '\n'
  );
  await wait(400);

  // Where the word really starts is counted in cells (this terminal draws the emoji in one cell;
  // another could use two), not in the line's text.
  const emojiRow = lineOf('- Ideas: launch it'),
    emojiCells = buf.getLine(emojiRow);
  let afterX = -1;
  for (let x = 0; emojiCells && x < term.cols && afterX < 0; x++) {
    let s = '';
    for (let k = x; k < term.cols && s.length < 5; k++) {
      const c = emojiCells.getCell(k);
      if (c?.getWidth()) s += c.getChars() || ' ';
    }
    if (s === 'after') afterX = x + 1;
  }
  const emojiLinks = (
    await Promise.all(
      (term._core?._linkProviderService?.linkProviders || []).map(
        pr => new Promise(r => pr.provideLinks(emojiRow + 1, r))
      )
    )
  )
    .flat()
    .filter(Boolean);
  const afterEmoji = emojiLinks.find(l => /after emoji idea/.test(l.text));
  check(
    !!afterEmoji && afterX > 0 && afterEmoji.range.start.x === afterX,
    'a link after an emoji starts on its own first letter (column ' +
      afterEmoji?.range.start.x +
      ', want ' +
      afterX +
      ', text ' +
      JSON.stringify(afterEmoji?.text) +
      ')'
  );
  term.resize(60, 20);
  await wait(400);
  check(
    window.TnaiReportHighlight.painted(term).some(d => d.bg && d.width === 60),
    'repainted at the new width after a resize'
  );
  term.dispose();

  // Report jump pill: hidden without a report; with three reports far apart, ↑
  // steps back one heading at a time to the view's top line, ↓ steps forward, and ↓ past the last
  // one returns to the newest output.
  host.textContent = '';
  const t2 = (await window.TnaiAgents.createTerm()).term;
  t2.open(host);
  const w2 = s => new Promise(r => t2.write(s.replace(/\n/g, '\r\n'), r));
  const filler = n => Array.from({ length: n }, (_, i) => 'output line ' + i).join('\n');
  await w2(filler(40) + '\n');
  await wait(400);
  const pill = host.querySelector('.tnai-report-nav'),
    [upB, downB] = pill ? pill.querySelectorAll('button') : [];
  check(!!pill && pill.hidden, 'report jump: hidden while the terminal has no report');
  for (const n of [1, 2, 3])
    await w2('Technically Not report\n- Did: report number ' + n + '\n\n' + filler(60) + '\n');
  await wait(500);
  const heads = [];
  {
    const b = t2.buffer.active;
    for (let i = 0; i < b.length; i++)
      if (/^Technically Not report$/.test(b.getLine(i)?.translateToString(true) || ''))
        heads.push(i);
  }
  const top = () => t2.buffer.active.viewportY;
  check(
    !pill.hidden && heads.length === 3 && !upB.disabled && downB.disabled,
    'report jump: shown at the bottom right once reports exist (↑ on, ↓ off at the newest output)'
  );
  upB.click();
  await wait(50);
  const s1 = top();
  await shot('report-jump');
  upB.click();
  await wait(50);
  const s2 = top();
  upB.click();
  await wait(50);
  const s3 = top();
  check(
    s1 === heads[2] && s2 === heads[1] && s3 === heads[0] && upB.disabled,
    'report jump: ↑ goes to each earlier report in turn, newest first (' +
      [s1, s2, s3] +
      ' vs ' +
      heads +
      ')'
  );
  downB.click();
  await wait(50);
  const d1 = top();
  downB.click();
  await wait(50);
  downB.click();
  await wait(50);
  const b2 = t2.buffer.active;
  check(
    d1 === heads[1] && b2.viewportY === b2.baseY && downB.disabled,
    'report jump: ↓ goes to the next report, and past the last back to the newest output'
  );

  // Unread report: the three reports above came with the terminal's
  // first output (a restored session's history), so none is unread. A report written later and
  // pushed out of view at once lights the pill; a click on its word goes there and it is read.
  const word = pill.querySelector('span'),
    lit = () => pill.classList.contains('tnai-report-unread'),
    unreadLines = () => window.TnaiReportHighlight.unread(t2);
  const sizeOf = () => {
    const r = pill.getBoundingClientRect();
    return Math.round(r.width) + 'x' + Math.round(r.height);
  };
  check(
    !lit() && !unreadLines().length,
    'unread report: the first output of a terminal (history) is never unread'
  );
  const plain = sizeOf();
  await wait(2200);
  await w2('Technically Not report\n- Did: report number 4, pushed away\n\n' + filler(60) + '\n');
  await wait(500);
  const line4 = (() => {
    const b = t2.buffer.active;
    for (let i = b.length - 1; i >= 0; i--)
      if (/^Technically Not report$/.test(b.getLine(i)?.translateToString(true) || '')) return i;
    return -1;
  })();
  check(
    lit() && unreadLines().length === 1 && unreadLines()[0] === line4 && !!word.title,
    'unread report: one pushed out of view before it was seen lights the pill (unread lines ' +
      unreadLines() +
      ', report at ' +
      line4 +
      ')'
  );
  check(
    sizeOf() === plain,
    'unread report: the pill keeps its size when lit (' + plain + ' → ' + sizeOf() + ')'
  );
  await shot('report-unread');
  word.click();
  await wait(80);
  check(
    top() === line4 && !lit() && !unreadLines().length && !word.title,
    'unread report: a click on the word goes to that report and it is read (top ' + top() + ')'
  );
  t2.scrollToBottom();
  await wait(50);
  await w2('Technically Not report\n- Did: report number 5, stays on screen\n');
  await wait(400);
  check(
    !lit() && unreadLines().length === 1,
    'unread report: one still on screen does not light the pill'
  );
  if (document.hasFocus()) {
    await wait(3300);
    await w2(filler(60) + '\n');
    await wait(400);
    check(
      !lit() && !unreadLines().length,
      'unread report: on screen for 3 s in the focused window counts as read, so pushing it away later lights nothing'
    );
  } else {
    await wait(3300);
    await w2(filler(60) + '\n');
    await wait(400);
    check(
      lit() && unreadLines().length === 1,
      'unread report: in a window without focus the 3 s do not count, so it is unread once pushed away (the focused case was not visited: this test window is in the background)'
    );
  }
  t2.dispose();

  // A CLI that clears the terminal and prints its transcript again in one go (Claude Code after a
  // panel resize, e.g. when a new panel opens): reports far above the end keep their colors (seen
  // 2026-09-30: only the last 80 lines were re-read, so every older report went plain).
  const { term: t3 } = await window.TnaiAgents.createTerm();
  t3.open(host);
  t3.resize(100, 20);
  const w3 = s => new Promise(r => t3.write(s.replace(/\n/g, '\r\n'), r));
  const transcript =
    Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n') +
    '\n  Technically Not report\n  - Did: one thing\n  - Next: another thing\n\n' +
    Array.from({ length: 300 }, (_, i) => 'more ' + i).join('\n') +
    '\n';
  const tinted3 = () => {
    const bg = new Set(
        window.TnaiReportHighlight.painted(t3)
          .filter(p => p.bg)
          .map(p => p.line)
      ),
      b = t3.buffer.active;
    for (let i = 0; i < b.length; i++)
      if (/Technically Not report/.test(b.getLine(i).translateToString(true)))
        return bg.has(i) && bg.has(i + 1) && bg.has(i + 2);
    return false;
  };
  await w3(transcript);
  await wait(400);
  const before3 = tinted3();
  await w3('\x1b[2J\x1b[3J\x1b[H' + transcript);
  await wait(400);
  check(
    before3 && tinted3(),
    'a report 300 lines above the end stays tinted after the CLI clears the terminal and prints everything again'
  );
  t3.dispose();

  // A full-screen CLI (the alternate screen; Claude Code as a background session, OpenCode): the
  // report is colored there too, and a row the CLI redraws with other text loses its color (the
  // fault: a report in a full-screen Claude Code panel showed no colors).
  const { term: t4 } = await window.TnaiAgents.createTerm();
  t4.open(host);
  t4.resize(100, 20);
  const w4 = s => new Promise(r => t4.write(s.replace(/\n/g, '\r\n'), r));
  const altRows = () => {
    const b = t4.buffer.active,
      bg = new Set(
        window.TnaiReportHighlight.painted(t4)
          .filter(p => p.bg)
          .map(p => p.line)
      ),
      out = {};
    for (let i = 0; i < b.length; i++) {
      const s = b.getLine(i).translateToString(true);
      if (/Technically Not report|- Did:|- Next:|plain line/.test(s))
        out[s.trim().slice(0, 12)] = bg.has(i);
    }
    return out;
  };
  await w4(
    'normal screen line\n\x1b[?1049h\x1b[H  Reply text\x1b[K\n\x1b[K\n  Technically Not report\x1b[K\n  - Did: one thing\x1b[K\n  - Next: another thing\x1b[K\n\x1b[K\n> prompt\x1b[K'
  );
  await wait(400);
  const a1 = altRows();
  check(
    t4.buffer.active.type === 'alternate' &&
      a1['Technically '] &&
      a1['- Did: one t'] &&
      a1['- Next: anot'],
    'a report on the full-screen (alternate) screen is tinted: ' + JSON.stringify(a1)
  );
  await w4(
    '\x1b[H  plain line one\x1b[K\n  plain line two\x1b[K\n  plain line three\x1b[K\n  plain line four\x1b[K\n  plain line five\x1b[K\n\x1b[K\n> prompt\x1b[K'
  );
  await wait(400);
  check(
    !window.TnaiReportHighlight.painted(t4).length,
    'rows the full-screen CLI redraws with other text lose the tint'
  );
  await w4('\x1b[?1049l');
  await wait(400);
  check(
    t4.buffer.active.type === 'normal' && !window.TnaiReportHighlight.painted(t4).length,
    'back on the normal screen nothing stays tinted'
  );
  t4.dispose();

  // The other agent CLIs' own shapes, copied from one real reply each on this PC (2026-10-05:
  // codex-cli 0.160.0, cursor-agent 2026.10.01, OpenCode 1.18.34). Codex: full-screen, "•" bullets,
  // an empty row under the heading and between the report's lines, no mouse reports. Cursor Agent:
  // normal screen, "•" bullets, its own line breaks with a 4-space indent. OpenCode: full-screen,
  // 5-space indent, mouse reports.
  const shapeOf = async (name, textRows, { alt, mouse } = {}) => {
    const { term: t } = await window.TnaiAgents.createTerm();
    t.open(host);
    t.resize(100, 24);
    await new Promise(r =>
      t.write(
        (alt ? '\x1b[?1049h' + (mouse ? '\x1b[?1000h\x1b[?1006h' : '') + '\x1b[H' : '') +
          textRows.map(s => s + '\x1b[K').join('\r\n'),
        r
      )
    );
    await wait(400);
    const b = t.buffer.active,
      at = s => {
        for (let i = 0; i < b.length; i++)
          if (b.getLine(i).translateToString(true).includes(s)) return i;
        return -1;
      };
    const pp = window.TnaiReportHighlight.painted(t),
      bg = s => pp.some(d => d.bg && d.line === at(s)),
      fgOf = s => pp.find(d => d.fg && d.line === at(s))?.fg;
    const links = async s =>
      (
        await Promise.all(
          (t._core?._linkProviderService?.linkProviders || []).map(
            pr => new Promise(r => pr.provideLinks(at(s) + 1, r))
          )
        )
      )
        .flat()
        .filter(Boolean);
    const out = { name, bg, fgOf, links: await links('Ideas: first idea'), type: b.type };
    t.dispose();
    return out;
  };
  const codex = await shapeOf(
    'Codex',
    [
      '• The sample is ready.',
      '',
      '  Done:',
      '',
      '  • Followed the format.',
      '  • Kept it short.',
      '',
      '  Your turn:',
      '',
      '  1. Send the task.',
      '  2. Add any limits.',
      '',
      '  Technically Not report',
      '',
      '  • Did: Read the formatting instructions and prepared this sample reply; no tools were used and no',
      '    files were read.',
      '',
      '  • Decide: Which format? | 1. CSV (recommended) | 2. JSON',
      '',
      '  • Ideas: first idea (fit 60%); second idea (fit 40%)',
      '',
      '  Worked for 4s • 9:17 AM',
      '',
      '› Ask Codex to do anything',
    ],
    { alt: true }
  );
  check(
    codex.type === 'alternate' &&
      ['Technically Not report', '• Did:', 'files were read.', '• Decide:', '• Ideas:'].every(
        codex.bg
      ) &&
      !codex.bg('Worked for 4s'),
    'Codex: every report line is tinted across the empty rows between them, and the row after the report is not'
  );
  check(
    new Set([codex.fgOf('• Did:'), codex.fgOf('• Decide:'), codex.fgOf('• Ideas:')]).size === 3 &&
      codex.fgOf('• Followed the format.') &&
      codex.fgOf('1. Send the task.') &&
      codex.fgOf('• Followed the format.') !== codex.fgOf('1. Send the task.'),
    'Codex: labels have their colors, and the Done and Your turn sections theirs'
  );
  check(
    codex.links.some(l => /second idea/.test(l.text)),
    'Codex: report items are links on its full screen (it asks for no mouse reports)'
  );
  const cursor = await shapeOf('Cursor Agent', [
    '  The sample is ready.',
    '',
    '  Done:',
    '  • Wrote the reply.',
    '',
    '  Technically Not report',
    '  • Did: Confirmed the formatting sample could be written in the usual reply style with a',
    '    short sentence and the closing report block',
    '  • Changed: src/a.js',
    '  • Ideas: first idea (fit 60%); second idea (fit 40%)',
    '',
    '  → Add a follow-up',
  ]);
  check(
    ['Technically Not report', '• Did:', 'short sentence and', '• Changed:', '• Ideas:'].every(
      cursor.bg
    ) &&
      !cursor.bg('Add a follow-up') &&
      cursor.fgOf('• Wrote the reply.') &&
      cursor.links.some(l => /second idea/.test(l.text)),
    'Cursor Agent: report lines, its own line breaks and the Done section are colored, and items are links'
  );
  const opencode = await shapeOf(
    'OpenCode',
    [
      '     The sample is ready.',
      '',
      '     Still open:',
      '',
      '     - Nothing outstanding.',
      '',
      '     Technically Not report',
      '',
      '     - Did: Rendered the sample reply with the exact heading order, item counts, and separators',
      '       requested, without invoking tools.',
      '     - Changed: src/a.js',
      '     - Ideas: first idea (fit 60%); second idea (fit 40%)',
      '',
      '     ▣  Build · Big Pickle · 7.1s',
    ],
    { alt: true, mouse: true }
  );
  check(
    ['Technically Not report', '- Did:', 'requested, without', '- Changed:', '- Ideas:'].every(
      opencode.bg
    ) &&
      !opencode.bg('Build · Big Pickle') &&
      opencode.fgOf('- Nothing outstanding.'),
    'OpenCode: report lines and the Still open section are colored on its full screen'
  );
  check(!opencode.links.length, 'OpenCode: no item links while it takes the mouse itself');

  // A list shown again with outcomes (hidden skill 42): in a table with
  // the columns #, Issue, Outcome, How we know the four outcome words get the existing status
  // colors, only as the whole content of an Outcome cell. Each CLI's own table, copied from one
  // real reply each (2026-10-05): Codex has no cell borders; Cursor Agent breaks "Still failing"
  // and "Not started" over two rows of the cell.
  const tableOf = async (name, textRows, opts) => {
    const { term: t } = await window.TnaiAgents.createTerm();
    t.open(host);
    t.resize(110, 24);
    await new Promise(r =>
      t.write(
        (opts?.alt ? '\x1b[?1049h\x1b[H' : '') + textRows.map(s => s + '\x1b[K').join('\r\n'),
        r
      )
    );
    await wait(400);
    const b = t.buffer.active,
      at = s => {
        for (let i = 0; i < b.length; i++)
          if (b.getLine(i).translateToString(true).includes(s)) return i;
        return -1;
      };
    const pp = window.TnaiReportHighlight.painted(t).filter(d => d.fg);

    // The colored piece whose own cells spell exactly this text (the same word elsewhere in the
    // reply, or in another column, is not it).
    const under = d => {
      const row = b.getLine(d.line),
        c = b.getNullCell();
      let s = '';
      for (let x = d.x; row && x < d.x + d.width; x++) {
        const cell = row.getCell(x, c);
        s += cell?.getChars() || (cell?.getWidth() ? ' ' : '');
      }
      return s;
    };
    const piece = s => pp.find(d => under(d) === s),
      fgOf = s => piece(s)?.fg;

    // How far right of its place in the row's text the colored piece starts: 0, or the extra cells
    // wide characters before it take.
    const shift = s => {
      const d = piece(s);
      return d ? d.x - b.getLine(d.line).translateToString(true).indexOf(s) : null;
    };
    const out = { name, fgOf, shift, count: pp.length };
    t.dispose();
    return out;
  };
  const four = (tb, words) => {
    const c = words.map(w => w.map(tb.fgOf));
    return c.every(g => g.every(x => x && x === g[0])) && new Set(c.map(g => g[0])).size === 4;
  };
  const codexT = await tableOf(
    'Codex',
    [
      '• 4 issues: 1 fixed, 1 partly, 1 still failing, 1 not started',
      '',
      '   #      Issue                                             Outcome          How we know',
      '  ━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '   1      Empty list crashes the average                    Fixed            Average handles empty lists',
      '  ─────  ────────────────────────────────────────────────  ───────────────  ──────────────────────────────────',
      '   2      Report colors missing in one terminal program,    Partly           Some terminals still lack colors',
      '          with a long description that will need to wrap',
      '  ─────  ────────────────────────────────────────────────  ───────────────  ──────────────────────────────────',
      '   3      Send button does nothing                          Still failing    Button remains unresponsive',
      '  ─────  ────────────────────────────────────────────────  ───────────────  ──────────────────────────────────',
      '   4      Phone layout                                      Not started      No changes yet',
      '',
      '  Worked for 4s • 11:08 AM',
    ],
    { alt: true }
  );
  check(
    four(codexT, [['Fixed'], ['Partly'], ['Still failing'], ['Not started']]) &&
      codexT.count === 4 &&
      codexT.shift('Fixed') === 0,
    'Codex outcome table (no cell borders): the four words have four colors and nothing else is colored (' +
      codexT.count +
      ')'
  );
  const cursorT = await tableOf('Cursor Agent', [
    '  4 issues: 1 fixed, 1 partly, 1 still failing, 1 not started',
    '',
    '  ┌─────┬──────────────────────────────────────────────────────────┬──────────┬────────────────────┐',
    '  │ #   │ Issue                                                    │ Outcome  │ How we know        │',
    '  ├─────┼──────────────────────────────────────────────────────────┼──────────┼────────────────────┤',
    '  │ 1   │ Empty list crashes the average                           │ Fixed    │ Empty input        │',
    '  │     │                                                          │          │ returns 0          │',
    '  ├─────┼──────────────────────────────────────────────────────────┼──────────┼────────────────────┤',
    '  │ 2   │ Report colors missing in one terminal program, with a    │ Partly   │ Colors work in two │',
    '  │     │ long description that will need to wrap                  │          │ programs           │',
    '  ├─────┼──────────────────────────────────────────────────────────┼──────────┼────────────────────┤',
    '  │ 3   │ Send button does nothing                                 │ Still    │ Click produces no  │',
    '  │     │                                                          │ failing  │ request            │',
    '  ├─────┼──────────────────────────────────────────────────────────┼──────────┼────────────────────┤',
    '  │ 4   │ Phone layout                                             │ Not      │ No mobile pass yet │',
    '  │     │                                                          │ started  │                    │',
    '  └─────┴──────────────────────────────────────────────────────────┴──────────┴────────────────────┘',
    '',
    '  → Add a follow-up',
  ]);
  check(
    four(cursorT, [['Fixed'], ['Partly'], ['Still', 'failing'], ['Not', 'started']]) &&
      cursorT.count === 6,
    'Cursor Agent outcome table: a word broken over two rows of its cell is colored on both (' +
      cursorT.count +
      ' colored pieces)'
  );
  const openT = await tableOf(
    'OpenCode',
    [
      '     4 issues: 1 fixed, 1 partly, 1 still failing, 1 not started',
      '',
      '     ┌─┬────────────────────────────────────────────────────────────┬─────────────┬────────────────────────┐',
      '     │#│Issue                                                       │Outcome      │How we know             │',
      '     ├─┼────────────────────────────────────────────────────────────┼─────────────┼────────────────────────┤',
      '     │1│Empty list crashes the average                              │Fixed        │Unit tests pass         │',
      '     ├─┼────────────────────────────────────────────────────────────┼─────────────┼────────────────────────┤',
      '     │2│Report colors missing in one terminal program, with a long  │Partly       │Limited terminal support│',
      '     │ │description that will need to wrap                          │             │                        │',
      '     ├─┼────────────────────────────────────────────────────────────┼─────────────┼────────────────────────┤',
      '     │3│Send button does nothing                                    │Still failing│Manual click fails      │',
      '     ├─┼────────────────────────────────────────────────────────────┼─────────────┼────────────────────────┤',
      '     │4│Phone layout                                                │Not started  │No progress yet         │',
      '     └─┴────────────────────────────────────────────────────────────┴─────────────┴────────────────────────┘',
      '',
      '     ▣  Build · Big Pickle · 38.7s',
    ],
    { alt: true }
  );
  check(
    four(openT, [['Fixed'], ['Partly'], ['Still failing'], ['Not started']]) && openT.count === 4,
    'OpenCode outcome table (full screen, one-cell first column): the four words have four colors (' +
      openT.count +
      ')'
  );

  // Claude Code's table has the same borders; here also what must stay plain: a wide character in
  // the Issue text must not shift the column, a cell with more than the word, the same words in
  // another column or in a table without these columns, and the word in a sentence.
  const claudeT = await tableOf('Claude Code', [
    '● 3 issues: 1 fixed, 1 partly, 1 not started',
    '',
    '  ┌───┬──────────────────────────────┬───────────────────┬──────────────────────┐',
    '  │ # │            Issue             │      Outcome      │     How we know      │',
    '  ├───┼──────────────────────────────┼───────────────────┼──────────────────────┤',
    '  │ 1 │ 文字 list crashes            │ Fixed             │ Partly by a new test │',
    '  ├───┼──────────────────────────────┼───────────────────┼──────────────────────┤',
    '  │ 2 │ Fixed                        │ Partly (two of 3) │ Not started          │',
    '  ├───┼──────────────────────────────┼───────────────────┼──────────────────────┤',
    '  │ 3 │ Phone layout                 │ Not started       │ nobody took it       │',
    '  └───┴──────────────────────────────┴───────────────────┴──────────────────────┘',
    '',
    '  Fixed it. The list above is Partly done.',
    '',
    '  ┌───────────────┬─────────┐',
    '  │ Issue         │ State   │',
    '  ├───────────────┼─────────┤',
    '  │ Send button   │ Fixed   │',
    '  └───────────────┴─────────┘',
  ]);
  check(
    claudeT.fgOf('Fixed') &&
      claudeT.fgOf('Not started') &&
      claudeT.fgOf('Fixed') !== claudeT.fgOf('Not started') &&
      claudeT.count === 2 &&
      claudeT.shift('Fixed') === 2,
    'Claude Code outcome table: only whole Outcome cells are colored, in the right cells behind two wide characters; a longer cell, other columns, another table and a sentence stay plain (' +
      claudeT.count +
      ' colored, shift ' +
      claudeT.shift('Fixed') +
      ')'
  );
  const stillOpen = await tableOf('section', [
    '  Still open:',
    '  │ # │ Issue        │ Outcome │ How we know │',
    '  │ 1 │ Phone layout │ Partly  │ half built  │',
    '',
  ]);
  check(
    stillOpen.fgOf('Partly') === codexT.fgOf('Partly') && stillOpen.count === 2,
    'a table right under a status heading: the heading has its color, the outcome word its own, the rest is plain (' +
      stillOpen.count +
      ')'
  );

  // The same list as numbered blocks (hidden skill 42): under each issue
  // a line "- Outcome: <word>"; the word has the color it has in a table, and only when it is all
  // the line holds after the label.
  const blocks = await tableOf('blocks', [
    '  6 issues: 1 fixed, 1 partly, 1 still failing, 1 not started',
    '',
    '  1 · Send button does nothing',
    '  - Outcome: Fixed',
    '  - How we know: test send-button passes',
    '',
    '  2 · Phone layout',
    '  - Outcome: Partly',
    '  - How we know: half built',
    '',
    '  3 · Sound',
    '  - Outcome: Still failing',
    '',
    '  4 · Search',
    '  - Outcome: Not started',
    '',
    '  5 · Words after it',
    '  - Outcome: Fixed in part, the rest waits',
    '  - Outcome of the test: Fixed',
    '',
  ]);
  check(
    four(blocks, [['Fixed'], ['Partly'], ['Still failing'], ['Not started']]) &&
      blocks.fgOf('Fixed') === codexT.fgOf('Fixed') &&
      blocks.fgOf('Not started') === codexT.fgOf('Not started') &&
      blocks.count === 4,
    'numbered blocks: the four outcome words have their table colors, a line with more text after the word stays plain (' +
      blocks.count +
      ' colored)'
  );
} catch (error) {
  check(false, 'threw: ' + (error.stack || error.message));
}
host.remove();
return { ok, log };
