/*
 * Technically Not tools · desktop-check/tests/cli-screen-regrow-duplicate.js — A reply or report is
 * never shown twice after a terminal panel is resized. A stand-in for
 * Claude Code's resize redraw (the shape found in a real panel's saved output: cursor home, one
 * erase per screen row, home, then the end of the conversation printed again for the new size) is
 * written into terminals made by 10's createTerm, no pty and no agent CLI: (A) as saved output with
 * size notes (replay, what the Agents page and a restored panel read), (B) live, resize by resize,
 * in pieces. Every word of the conversation is unique, so after each resize every word must be in
 * the buffer exactly once: none twice (a second copy) and none missing (history cut). (C) a shell
 * whose rows repeat and that repaints in its own way keeps all its rows. (D) newer output rewriting
 * the redrawn rows in the same write. Optional: $env:TNAI_REGROW_LOG = a saved panel log
 * (userData\scrollback\<paneId>.log) is replayed too, size note by size note and in one go; its
 * "Technically Not report" headings are counted (notes, not checks) and the rows held are written
 * to <log>.rows.txt. Returns {ok, log}.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const note = s => log.push('     ' + s);
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const agents = window.TnaiAgents,
  E = '\x1b';
const hosts = [];
const open = async () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:0;top:0;width:1300px;height:640px;z-index:-1';
  document.body.append(host);
  hosts.push(host);
  const m = await agents.createTerm();
  m.term.open(host);
  return m;
};
const write = (term, s) => new Promise(r => term.write(s, r));

// The conversation: paragraphs of unique words (w0001 …), a blank row between them, the report
// heading near the end.
let n = 0;
const para = len => Array.from({ length: len }, () => 'w' + String(++n).padStart(4, '0')).join(' ');
const paras = [
  40, 12, 55, 8, 30, 70, 5, 25, 60, 18, 45, 33, 9, 50, 22, 65, 14, 38, 27, 44, 61, 7, 36, 52, 19,
  48, 31, 58, 11, 42,
].map(para);
paras.splice(paras.length - 6, 0, 'Technically Not report');
const words = n;
const wrap = (text, cols) => {
  const rows = [];
  let row = '';
  for (const w of text.split(' ')) {
    if (row && (rows.length ? 4 : 2) + row.length + 1 + w.length > cols - 2) {
      rows.push((rows.length ? '    ' : '  ') + row);
      row = w;
    } else row = row ? row + ' ' + w : w;
  }
  rows.push((rows.length ? '    ' : '  ') + row);
  return rows;
};
const rowsAt = cols => paras.flatMap(p => [...wrap(p, cols), '']);
const chrome = cols => ['─'.repeat(cols), '❯ ', '─'.repeat(cols), '  ⏵⏵ auto mode on'];
const sizeNote = (cols, rows) => E + ']7717;' + cols + ';' + rows + '\x07';
const first = cols =>
  [...rowsAt(cols), ...chrome(cols)].map(l => l + '\r\n').join('') + E + '[2C' + E + '[3A';

// Claude Code's answer to a resize: count rows of the conversation's end, drawn from the top of the
// screen.
const redraw = (cols, rows, count) =>
  E +
  '[?25l' +
  E +
  '[2D' +
  E +
  '[3B' +
  E +
  '[H' +
  (E + '[2K' + E + '[1B').repeat(rows) +
  E +
  '[H' +
  [...rowsAt(cols), ...chrome(cols)]
    .slice(-count)
    .map(l => l + '\r\n')
    .join('') +
  E +
  '[2C' +
  E +
  '[3A' +
  E +
  '[?25h';

// Rows joined where xterm wrapped them, so a word split by a re-wrap still counts once.
const lines = term => {
  const b = term.buffer.active,
    out = [];
  for (let y = 0; y < b.length; y++) {
    const l = b.getLine(y),
      t = l.translateToString(true);
    if (l.isWrapped && out.length) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
};
const tally = term => {
  const seen = new Map();
  let heads = 0;
  for (const l of lines(term)) {
    if (l.trim() === 'Technically Not report') heads++;
    for (const w of l.match(/w\d{4}/g) || []) seen.set(w, (seen.get(w) || 0) + 1);
  }
  let twice = 0;
  for (const c of seen.values()) if (c > 1) twice++;
  return { twice, missing: words - seen.size, heads, rows: term.buffer.active.length };
};

// A shrink by one to three rows (the rows under Claude Code's input): as in the real log, the
// redraw then holds one row fewer than the screen, and xterm takes the rows under the cursor away,
// not the top ones. Before the fix the top rows were erased and not printed again until the panel
// regrew (24 words missing at 152×30); now they must be in the scrollback.
const clean = (term, label) => {
  const t = tally(term);
  check(
    t.twice === 0 && t.missing === 0 && t.heads === 1,
    label +
      ': every word once, one report heading (' +
      t.twice +
      ' words twice, ' +
      t.missing +
      ' missing, ' +
      t.heads +
      ' headings, ' +
      t.rows +
      ' buffer rows)'
  );
};
const steps = [
  [102, 15, 33],
  [152, 31, 30],
  [152, 26, 30],
  [152, 31, 30],
  [152, 30, 29],
  [152, 31, 30],
  [152, 29, 28],
  [152, 31, 30],
  [152, 28, 27],
  [152, 31, 30],
  [102, 15, 33],
  [152, 31, 30],
];

try {
  // (A) saved output with size notes, as replay() reads it.
  {
    const { term, replay } = await open();
    await replay(sizeNote(152, 31) + first(152));
    await wait(100);
    clean(term, 'A replay, first draw at 152×31');
    await replay(steps.map(([c, r, k]) => sizeNote(c, r) + redraw(c, r, k)).join(''));
    await wait(300);
    clean(term, 'A replay, after ' + steps.length + ' resizes with a redraw each');
    const b = term.buffer.active;
    check(
      b.viewportY === b.baseY,
      'A replay: the view is at the newest output (' + b.viewportY + ' of ' + b.baseY + ')'
    );
  }

  // (B) live: the view resizes, then the redraw arrives in pieces.
  {
    const { term } = await open();
    term.resize(152, 31);
    await write(term, first(152));
    await wait(100);
    clean(term, 'B live, first draw at 152×31');
    for (const [c, r, k] of steps) {
      term.resize(c, r);
      await wait(60);
      const data = redraw(c, r, k),
        cut = [0, 300, Math.floor(data.length / 2), data.length];
      for (let i = 0; i + 1 < cut.length; i++) {
        await write(term, data.slice(cut[i], cut[i + 1]));
        await wait(30);
      }
      await wait(200);
      clean(term, 'B live, after the redraw at ' + c + '×' + r);
    }
    const b = term.buffer.active;
    check(
      b.viewportY === b.baseY,
      'B live: the view is at the newest output (' + b.viewportY + ' of ' + b.baseY + ')'
    );

    // New output after it still lands below, once.
    await write(term, E + '[2D' + E + '[3B\r\n  wEND1 wEND2\r\n');
    await wait(100);
    check(
      lines(term).filter(l => l.includes('wEND1')).length === 1,
      'B live: output written afterwards is shown once'
    );
  }

  // (C) a shell: rows that repeat, and a repaint in the shell's own way (home, each row with an
  // erase to the line end). All rows stay.
  {
    const { term } = await open();
    term.resize(120, 30);
    await write(
      term,
      Array.from({ length: 200 }, () => 'waiting for the build output\r\n').join('')
    );
    const count = () =>
        lines(term).filter(l => l.startsWith('waiting for the build output')).length,
      before = count();
    for (const [c, r] of [
      [120, 14],
      [120, 30],
      [90, 20],
      [120, 30],
    ]) {
      term.resize(c, r);
      await wait(40);
      await write(
        term,
        E +
          '[H' +
          Array.from({ length: r - 1 }, () => 'waiting for the build output' + E + '[K\r\n').join(
            ''
          )
      );
      await wait(150);
    }
    check(
      before === 200 && count() >= before,
      'C shell: repeated rows are all kept through resizes and repaints (' +
        before +
        ' → ' +
        count() +
        ')'
    );
  }

  // (D) saved output where newer output rewrites redrawn rows right after the last redraw (in the
  // real log Claude Code's next frame took four rows out of the reply): the repeat is settled when
  // the redraw ends, not at the end of the write.
  {
    const { term, replay } = await open();
    await replay(
      sizeNote(152, 31) +
        first(152) +
        sizeNote(102, 15) +
        redraw(102, 15, 33) +
        sizeNote(152, 31) +
        redraw(152, 31, 30) +
        E +
        '[18A' +
        E +
        '[4M' +
        E +
        '[18B' +
        '\r\n  later output\r\n'.repeat(40)
    );
    await wait(300);
    const t = tally(term);
    check(
      t.twice === 0 && t.heads === 1,
      'D replay, redrawn rows rewritten right after: nothing twice, one report heading (' +
        t.twice +
        ' words twice, ' +
        t.heads +
        ' headings)'
    );
  }

  // (G) a redraw that starts in the middle of a row xterm re-wrapped: drawn at 152 columns, made
  // 100 wide (xterm re-wraps the old rows), then redrawn from a row in the middle of a paragraph.
  // The old row that holds the redraw's first words also holds older words: before the fix it
  // stayed whole, with the first words shown twice. Three starting rows.
  {
    const at100 = [...rowsAt(100), ...chrome(100)];
    const counts = [];
    for (let count = 31; count < at100.length && counts.length < 3; count++)
      if (at100[at100.length - count].startsWith('    w')) counts.push(count);
    for (const count of counts) {
      const { term } = await open();
      term.resize(152, 31);
      await write(term, first(152));
      await wait(60);
      term.resize(100, 31);
      await wait(60);
      await write(term, redraw(100, 31, count));
      await wait(200);
      clean(term, 'G redraw from the middle of a row (' + count + ' rows at 100×31)');
    }
    check(counts.length === 3, 'G: three starting rows in the middle of a paragraph');
  }

  // (H) Cursor Agent's answer to a change of width (read from its saved output 2026-10-15): every
  // row erased from the bottom up (CSI 2K, CSI 1A, a few more than the screen has), then its whole
  // output printed again from the top row. Live and as saved output.
  {
    const cursorRedraw = (cols, rows) =>
      (E + '[2K' + E + '[1A').repeat(rows + 2) +
      E +
      '[2K' +
      E +
      '[G' +
      [...rowsAt(cols), ...chrome(cols)].map(l => l + '\r\n').join('');
    const { term } = await open();
    term.resize(120, 30);
    await write(term, first(120));
    await wait(60);
    for (const [c, r] of [
      [90, 18],
      [120, 30],
      [70, 20],
    ]) {
      term.resize(c, r);
      await wait(60);
      await write(term, cursorRedraw(c, r));
      await wait(200);
      clean(term, 'H Cursor Agent live, after its redraw at ' + c + '×' + r);
    }
    const { term: saved, replay } = await open();
    await replay(
      sizeNote(120, 30) +
        first(120) +
        sizeNote(90, 18) +
        cursorRedraw(90, 18) +
        sizeNote(120, 30) +
        cursorRedraw(120, 30)
    );
    await wait(300);
    clean(saved, 'H Cursor Agent replay, after two redraws');
  }

  // (E) a table: Claude Code lays a table out again for the new width,
  // so its cells wrap in other places and the old copy's rows are not found word for word in the
  // new one. The old copy still goes, and the paragraph above it stays.
  {
    const cell = (text, w) => {
      const out = [];
      let row = '';
      for (const x of text.split(' ')) {
        if (row && row.length + 1 + x.length > w) {
          out.push(row);
          row = x;
        } else row = row ? row + ' ' + x : x;
      }
      out.push(row);
      return out;
    };
    const tw = Array.from({ length: 4 }, (_, r) =>
      [String(r + 1), [9, 14, 7, 11][r], [22, 31, 12, 26][r], 2].map((len, c) =>
        c
          ? Array.from({ length: len }, (_, i) => 't' + r + c + String(i).padStart(2, '0')).join(
              ' '
            )
          : len
      )
    );
    const table = cols => {
      const w = [3, Math.floor((cols - 26) * 0.3), Math.floor((cols - 26) * 0.7), 10],
        out = [];
      const rule = (l, m, r) => l + w.map(x => '─'.repeat(x + 2)).join(m) + r;
      out.push(rule('┌', '┬', '┐'));
      tw.forEach((r, i) => {
        const cells = r.map((t, c) => cell(t, w[c])),
          h = Math.max(...cells.map(x => x.length));
        for (let k = 0; k < h; k++)
          out.push(
            '│' + cells.map((x, c) => ' ' + (x[k] || '').padEnd(w[c]) + ' ').join('│') + '│'
          );
        out.push(i < tw.length - 1 ? rule('├', '┼', '┤') : rule('└', '┴', '┘'));
      });
      return out;
    };
    const body = cols => [
      ...wrap(
        'keep ' + Array.from({ length: 30 }, (_, i) => 'k' + String(i).padStart(3, '0')).join(' '),
        cols
      ),
      '',
      ...table(cols),
      '',
      ...chrome(cols),
    ];
    const draw = (cols, rows, again) =>
      (again
        ? E +
          '[?25l' +
          E +
          '[2D' +
          E +
          '[3B' +
          E +
          '[H' +
          (E + '[2K' + E + '[1B').repeat(rows) +
          E +
          '[H'
        : '') +
      body(cols)
        .map(l => l + '\r\n')
        .join('') +
      E +
      '[2C' +
      E +
      '[3A' +
      (again ? E + '[?25h' : '');
    const { term } = await open();
    term.resize(152, 31);
    await write(term, draw(152, 31));
    await wait(100);
    for (const [c, r] of [
      [100, 14],
      [152, 31],
      [100, 14],
    ]) {
      term.resize(c, r);
      await wait(60);
      await write(term, draw(c, r, true));
      await wait(250);
      const seen = new Map();
      for (const l of lines(term))
        for (const x of l.match(/[tk]\d{3,4}/g) || []) seen.set(x, (seen.get(x) || 0) + 1);
      let twice = 0,
        kept = 0,
        cells = 0;
      for (const [x, n] of seen) {
        if (n > 1) twice++;
        if (x[0] === 'k') kept++;
        else cells++;
      }
      check(
        twice === 0 &&
          kept === 30 &&
          cells ===
            tw
              .flat()
              .join(' ')
              .match(/t\d{4}/g).length,
        'E table, after the redraw at ' +
          c +
          '×' +
          r +
          ': every table word once, the paragraph above kept (' +
          twice +
          ' words twice, ' +
          kept +
          '/30 paragraph words, ' +
          cells +
          ' table words)'
      );
    }

    // (F) the same table drawn as records in a narrow view: under 120
    // columns Claude Code prints each table row as "Key: value" rows with a rule between them, so
    // one copy is records and the other a table. Neither stays twice, whichever was drawn first,
    // and the paragraph above stays.
    const heads = ['#', 'Issue', 'How we know', 'Outcome'];
    const records = cols =>
      tw.flatMap((r, i) => [
        ...r.flatMap((t, c) => wrap(heads[c] + ': ' + t, cols).map(l => l.trim())),
        ...(i < tw.length - 1 ? ['─'.repeat(40)] : []),
      ]);
    const headed = cols => {
      const w = [3, Math.floor((cols - 26) * 0.3), Math.floor((cols - 26) * 0.7), 10];
      return [
        '│' + heads.map((h, c) => ' ' + h.padEnd(w[c]) + ' ').join('│') + '│',
        ...table(cols),
      ];
    };
    const body2 = cols => [
      ...wrap(
        'keep ' + Array.from({ length: 30 }, (_, i) => 'k' + String(i).padStart(3, '0')).join(' '),
        cols
      ),
      '',
      ...(cols < 120 ? records(cols) : headed(cols)),
      '',
      ...chrome(cols),
    ];
    const draw2 = (cols, rows, again) =>
      (again
        ? E +
          '[?25l' +
          E +
          '[2D' +
          E +
          '[3B' +
          E +
          '[H' +
          (E + '[2K' + E + '[1B').repeat(rows) +
          E +
          '[H'
        : '') +
      body2(cols)
        .map(l => l + '\r\n')
        .join('') +
      E +
      '[2C' +
      E +
      '[3A' +
      (again ? E + '[?25h' : '');
    for (const start of [
      [152, 31],
      [60, 14],
    ]) {
      const { term: t2 } = await open();
      t2.resize(...start);
      await write(t2, draw2(...start));
      await wait(100);
      for (const [c, r] of start[0] > 100
        ? [
            [60, 14],
            [152, 31],
            [60, 14],
          ]
        : [
            [152, 31],
            [60, 14],
            [152, 31],
          ]) {
        t2.resize(c, r);
        await wait(60);
        await write(t2, draw2(c, r, true));
        await wait(250);
        const seen = new Map();
        for (const l of lines(t2))
          for (const x of l.match(/[tk]\d{3,4}/g) || []) seen.set(x, (seen.get(x) || 0) + 1);
        let twice = 0,
          kept = 0,
          cells = 0;
        for (const [x, n] of seen) {
          if (n > 1) twice++;
          if (x[0] === 'k') kept++;
          else cells++;
        }
        check(
          twice === 0 &&
            kept === 30 &&
            cells ===
              tw
                .flat()
                .join(' ')
                .match(/t\d{4}/g).length,
          'F table and records, from ' +
            start[0] +
            ' columns, after the redraw at ' +
            c +
            '×' +
            r +
            ' (' +
            (c < 120 ? 'records' : 'table') +
            '): every word once, the paragraph above kept (' +
            twice +
            ' words twice, ' +
            kept +
            '/30 paragraph words, ' +
            cells +
            ' table words)'
        );
      }
    }
  }

  // Optional: a real panel's saved output.
  const real = await main('log').catch(() => '');
  if (real) {
    const { term, replay } = await open();

    // Replayed size note by size note, with the rows held after each (the last 90, ▼ = top of the
    // screen) written out.
    const parts = real.split(/(?=\x1b\]7717;\d+;\d+\x07)/),
      stages = [];
    for (const part of parts) {
      const cut = part.search(/\x1b\[\?25h/) + 6,
        head = cut > 6 && part.startsWith(E + ']7717;') ? part.slice(0, cut) : part;
      await replay(head);
      await wait(150);
      const sb = term.buffer.active,
        out = [];
      for (let y = Math.max(0, sb.length - 90); y < sb.length; y++)
        out.push(
          String(y).padStart(4) +
            (y === sb.baseY ? ' ▼ ' : ' | ') +
            sb.getLine(y).translateToString(true)
        );
      stages.push(
        '===== after ' +
          JSON.stringify(part.slice(0, 16)) +
          ' redraw, ' +
          term.cols +
          '×' +
          term.rows +
          ', ' +
          sb.length +
          ' rows\n' +
          out.join('\n')
      );
      if (head !== part) {
        await replay(part.slice(cut));
        await wait(150);
      }
    }
    await wait(400);
    const all = lines(term),
      heads = all.filter(l => l.trim() === 'Technically Not report').length;
    const dids = all
        .filter(l => /^\s*- Did:/.test(l))
        .map(l => l.replace(/\s+/g, ' ').trim().slice(0, 60)),
      twice = dids.filter((d, i) => dids.indexOf(d) !== i);
    const b = term.buffer.active,
      rows = [];
    for (let y = 0; y < b.length; y++)
      rows.push(
        String(y).padStart(4) +
          (y === b.baseY ? ' ▼ ' : ' | ') +
          b.getLine(y).translateToString(true)
      );

    // And in one go, as a view opened on the session reads it.
    const whole = await open();
    await whole.replay(real);
    await wait(400);
    const wb = whole.term.buffer.active,
      wrows = [];
    for (let y = 0; y < wb.length; y++)
      wrows.push(
        String(y).padStart(4) +
          (y === wb.baseY ? ' ▼ ' : ' | ') +
          wb.getLine(y).translateToString(true)
      );
    const wheads = lines(whole.term).filter(l => l.trim() === 'Technically Not report').length;
    note('in one go: ' + wb.length + ' buffer rows, ' + wheads + ' report headings');
    note(
      'rows written to ' +
        (await main(
          'rows',
          stages.join('\n\n') +
            '\n\n===== at the end\n' +
            rows.join('\n') +
            '\n\n===== in one go\n' +
            wrows.join('\n')
        ).catch(() => '(not written)'))
    );
    note(
      'saved log (' +
        real.length +
        ' chars, ' +
        (real.match(/\x1b\]7717;/g) || []).length +
        ' size notes): ' +
        term.buffer.active.length +
        ' buffer rows, ' +
        heads +
        ' report headings, ' +
        dids.length +
        ' "- Did:" rows, ' +
        twice.length +
        ' of them repeated'
    );
  }
} catch (e) {
  check(false, 'threw: ' + (e.stack || e.message));
}
hosts.forEach(h => h.remove());
return { ok, log };
