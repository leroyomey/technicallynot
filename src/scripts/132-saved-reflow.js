// Technically Not · 132-saved-reflow.js — Desktop only: a stopped session's saved screen, laid
// out again for a wider terminal (the thread's Terminal view, 120).
//
// The trouble: a CLI such as Claude Code breaks its own lines for the width it runs at. Shown
// later in a terminal twice as wide, that text still ends where the old width ended and half the
// panel stays empty. A terminal can only re-wrap lines it wrapped itself, and these were broken
// by the program.
//
// What this file does: it reads the saved screen once (`read`), row by row with its colors, and
// puts back together the rows the program broke. Then it writes the screen again for any width
// (`draw`), breaking the lines at words for that width.
//
// A row is taken as broken by the program only when all of this holds, so that lists, code and
// tables stay as they were:
//   - the next row's first word would not have fitted on the row (that is why it was broken),
//   - the next row starts exactly where this row's text starts (under the text, after a bullet),
//   - the next row does not start with a bullet or a number of its own,
//   - neither row holds a drawn line or box, and both stand on the same background.
// A row that is one drawn line from edge to edge (the rules around a CLI's input) is drawn again
// from edge to edge. Everything else is written as it was.
//
// This is a reading of the screen, not the program's own redraw: when the session starts again
// the program draws for the real width. `window.TnaiSavedReflow` (`read`, `draw`). Test
// `thread-saved-screen`.
(() => {
  'use strict';

  const RESET = '\x1b[0m';

  // How many columns a program may leave free at the right edge when it breaks its lines.
  const RIGHT_MARGIN = 6;

  // Box-drawing characters: a row with one of them is a drawn line, a box or a table.
  const isDrawn = code => code >= 0x2500 && code <= 0x257f;

  // What a list row starts with: a bullet, a tree mark, a prompt mark or "1." / "1)".
  const MARKER = /^(?:[●•◦▪■□*\-–>❯›⎿└├]|\d+[.)])\s+/;

  // One color of a cell as the numbers of its escape sequence. base: 30 for text, 40 for ground.
  function colorCodes(base, isDefault, isPalette, isRgb, value) {
    if (isDefault) return [];
    if (isRgb) return [base + 8, 2, (value >> 16) & 255, (value >> 8) & 255, value & 255];
    if (isPalette) {
      if (value < 8) return [base + value];
      if (value < 16) return [base + 60 + value - 8];
      return [base + 8, 5, value];
    }
    return [];
  }

  // The escape sequence that sets a cell's look from nothing, and the same for its ground alone.
  function lookOf(cell) {
    const codes = [0];
    if (cell.isBold()) codes.push(1);
    if (cell.isDim()) codes.push(2);
    if (cell.isItalic()) codes.push(3);
    if (cell.isUnderline()) codes.push(4);
    if (cell.isInverse()) codes.push(7);
    if (cell.isStrikethrough()) codes.push(9);
    const ground = colorCodes(
      40,
      cell.isBgDefault(),
      cell.isBgPalette(),
      cell.isBgRGB(),
      cell.getBgColor()
    );
    codes.push(
      ...colorCodes(30, cell.isFgDefault(), cell.isFgPalette(), cell.isFgRGB(), cell.getFgColor()),
      ...ground
    );
    return {
      look: '\x1b[' + codes.join(';') + 'm',
      ground: ground.length ? '\x1b[' + ground.join(';') + 'm' : '',
    };
  }

  // One row of the screen: its cells up to the last one that shows something, the ground of a row
  // that is colored to its right edge (a band), and what the rules above need to know.
  function readRow(line, cols, cell, known) {
    const cells = [];
    let band = '';
    for (let x = 0; x < cols; x++) {
      line.getCell(x, cell);
      const width = cell.getWidth();
      if (!width) continue;
      const chars = cell.getChars() || ' ';

      // The same look is written many times in a row: its text is built once.
      const key =
        cell.getFgColorMode() +
        ':' +
        cell.getFgColor() +
        ':' +
        cell.getBgColorMode() +
        ':' +
        cell.getBgColor() +
        ':' +
        (cell.isBold() ? 1 : 0) +
        (cell.isDim() ? 1 : 0) +
        (cell.isItalic() ? 1 : 0) +
        (cell.isUnderline() ? 1 : 0) +
        (cell.isInverse() ? 1 : 0) +
        (cell.isStrikethrough() ? 1 : 0);
      let style = known.get(key);
      if (!style) {
        style = lookOf(cell);
        known.set(key, style);
      }
      cells.push({ chars, width, look: style.look, ground: style.ground });
      if (x + width >= cols) band = style.ground;
    }

    // Every space after the row's text goes, whatever it stands on. A band is a row colored on
    // past its text: the first of those spaces says on which ground (a row whose text runs to the
    // edge keeps the ground of its last cell, read above). When only spaces on the band's own
    // ground were dropped, a colored row that the terminal had cut in two kept the spaces of its
    // second half, and joined to the next row they stood as a wide gap in the middle of a
    // sentence.
    let end = cells.length;
    while (end > 0 && cells[end - 1].chars === ' ') end--;
    if (end < cells.length) band = cells[end].ground;
    cells.length = end;
    return finish({ cells, band });
  }

  // The facts of a row that the joining rules use.
  function finish(row) {
    const text = row.cells.map(part => part.chars).join('');
    const indent = text.length - text.trimStart().length;
    const marker = MARKER.exec(text.slice(indent));
    row.text = text;
    row.indent = indent;
    row.marked = !!marker;

    // where the text of this row starts: after its bullet when it has one
    row.body = indent + (marker ? marker[0].length : 0);
    row.drawn = [...text].some(char => isDrawn(char.codePointAt(0)));

    // A row that starts with block characters is a picture (a CLI's logo) with text beside it.
    // It is never joined to another row, and when it must be broken the rest stands under its
    // text, beside the picture (broken at the edge, "Claude Max" ran on under the logo's legs).
    const picture = /^[\u2580-\u259f][\u2580-\u259f ]*/.exec(text.slice(indent));
    if (picture) {
      row.drawn = true;
      row.picture = true;
      row.body = indent + picture[0].length;
    }
    row.width = row.cells.reduce((sum, part) => sum + part.width, 0);

    // the width of the last piece that stood on one row of the old screen
    row.tail = row.width;
    return row;
  }

  // Reads a terminal's normal screen with its history. Null when there is nothing to lay out
  // again (a full-screen program's screen, or an empty one).
  function read(term) {
    const buffer = term?.buffer?.active;
    if (!buffer || buffer.type !== 'normal') return null;
    const cols = term.cols;
    const cell = buffer.getNullCell();
    const known = new Map();
    const rows = [];
    for (let y = 0; y < buffer.length; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const row = readRow(line, cols, cell, known);

      // a row the terminal wrapped itself is the rest of the row before it
      if (line.isWrapped && rows.length) {
        const before = rows[rows.length - 1];
        while (before.width < cols) {
          before.cells.push({ chars: ' ', width: 1, look: RESET, ground: '' });
          before.width++;
        }
        before.cells.push(...row.cells);
        finish(before);
        continue;
      }
      rows.push(row);
    }
    while (rows.length && !rows[rows.length - 1].cells.length) rows.pop();
    if (!rows.length) return null;

    // The width the program broke its lines for: the longest row of text it wrote (its drawn
    // lines reach the edge and say nothing about where text was broken). A program keeps a
    // margin at the right, while one long row of something else (a path, a prompt) can reach the
    // edge, so the width is never taken as nearer to the edge than RIGHT_MARGIN.
    const wrapAt = Math.min(
      cols - RIGHT_MARGIN,
      rows.reduce((most, row) => (row.drawn ? most : Math.max(most, row.width)), 0)
    );
    return { cols, rows: markRules(join(rows, wrapAt)) };
  }

  // Puts back together the rows the program broke (the rules are at the top of this file).
  function join(rows, wrapAt) {
    const out = [];
    for (const row of rows) {
      const before = out[out.length - 1];
      const firstWord = row.text.slice(row.indent).split(' ')[0].length;
      const broken =
        before &&
        before.cells.length > 0 &&
        row.cells.length > 0 &&
        !before.drawn &&
        !row.drawn &&
        !row.marked &&
        before.band === row.band &&
        row.indent === before.body &&
        before.tail + 1 + firstWord > wrapAt;
      if (!broken) {
        // a drawn line from edge to edge is drawn from edge to edge again
        out.push(row);
        continue;
      }
      const last = before.cells[before.cells.length - 1];
      const space = { chars: ' ', width: 1, look: last.look, ground: last.ground };
      before.cells.push(space, ...row.cells.slice(row.indent));
      before.width = before.cells.reduce((sum, part) => sum + part.width, 0);
      before.tail = row.width;
    }
    return out;
  }

  // A drawn line from edge to edge (the rules round a CLI's input box) is drawn from edge to edge
  // again, whatever width it was saved at. Which rows are that: one drawn character repeated, at
  // least RULE_MIN long, and as long as the longest such row of the screen (a shorter one is a
  // line the program meant to be short, and keeps its length).
  const RULE_MIN = 10;

  function markRules(rows) {
    const lines = rows.filter(row => {
      const first = row.cells[0];
      return (
        !!first &&
        row.width >= RULE_MIN &&
        isDrawn(first.chars.codePointAt(0)) &&
        row.cells.every(part => part.chars === first.chars && part.look === first.look)
      );
    });
    const longest = lines.reduce((most, row) => Math.max(most, row.width), 0);
    for (const row of lines) row.rule = row.width === longest;
    return rows;
  }

  // One row as text for a width: broken at words, the rows after the first standing under the
  // row's own text.
  function rowText(row, cols) {
    if (row.rule) return row.cells[0].look + row.cells[0].chars.repeat(cols) + RESET;

    // A picture row (a CLI's logo with text beside it) is never broken: a second line of its text
    // would push the next row of the picture down and tear the logo apart (the user's clip: the
    // legs stood a row below the body). In a narrow terminal its text ends at the edge instead.
    if (row.picture) {
      let text = '';
      let look = '';
      let used = 0;
      for (const part of row.cells) {
        if (used + part.width > cols) break;
        if (part.look !== look) {
          look = part.look;
          text += look;
        }
        text += part.chars;
        used += part.width;
      }
      return text + RESET;
    }
    const hang = Math.min(row.body, Math.floor(cols / 2));
    const lines = [];
    let line = [];
    let used = 0;
    let lastSpace = -1;
    let hasText = false;
    const start = () => {
      line = [];
      used = 0;
      lastSpace = -1;
      hasText = false;
      if (!lines.length) return;
      for (let count = 0; count < hang; count++)
        line.push({ chars: ' ', width: 1, look: RESET + row.band, ground: row.band });
      used = hang;
    };
    start();
    for (const part of row.cells) {
      if (used + part.width > cols) {
        // back to the last space of this line when it has one after its start
        let carried = [];
        if (part.chars !== ' ' && lastSpace >= 0) {
          carried = line.splice(lastSpace + 1);
          line.pop();
        }
        lines.push(line);
        start();
        for (const moved of carried) {
          line.push(moved);
          used += moved.width;
          hasText = true;
        }
        if (part.chars === ' ') continue;
      }

      // a space is a place to break only after the line has text (never in its indent)
      if (part.chars !== ' ') hasText = true;
      else if (hasText) lastSpace = line.length;
      line.push(part);
      used += part.width;
    }
    lines.push(line);
    return lines
      .map(cells => {
        let text = '';
        let look = '';
        for (const part of cells) {
          if (part.look !== look) {
            look = part.look;
            text += look;
          }
          text += part.chars;
        }

        // a band reaches the right edge of the terminal, whatever its width
        return text + RESET + (row.band ? row.band + '\x1b[K' + RESET : '');
      })
      .join('\r\n');
  }

  // Writes what `read` gave to the terminal at its present width, in place of what it shows.
  // lastRows: only that many of its last rows (while a divider is dragged the terminal is drawn
  // many times a second, and only its end is on screen; the whole screen is written once the drag
  // is over). The promise ends when the terminal has taken it.
  function draw(term, saved, lastRows) {
    const cols = term.cols;
    const rows = lastRows > 0 ? saved.rows.slice(-lastRows) : saved.rows;
    const text = rows.map(row => rowText(row, cols)).join('\r\n');

    // One write that clears and draws: the terminal shows nothing in between. (A reset first,
    // then the text, showed an empty terminal for a frame at every change of width.)
    const CLEAR = '\x1b[0m\x1b[H\x1b[2J\x1b[3J';

    // Taken in at once where the terminal can (an internal of xterm, guarded): written the usual
    // way the text arrives a moment later, and the frame in between showed the old text broken
    // at the new edge, in the middle of words.
    try {
      // Only when nothing else waits to be written to this terminal: taken in at once in front
      // of text that is still waiting, the two would land in the wrong order.
      const core = term._core;
      const waiting = core?._writeBuffer?._writeBuffer;
      if (typeof core?.writeSync === 'function' && Array.isArray(waiting) && !waiting.length) {
        core.writeSync(CLEAR + text);
        return Promise.resolve();
      }
    } catch {}
    return new Promise(resolve => term.write(CLEAR + text, resolve));
  }

  window.TnaiSavedReflow = { read, draw };
})();
