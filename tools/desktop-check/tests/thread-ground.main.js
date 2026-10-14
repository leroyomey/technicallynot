// Technically Not tools · desktop-check/tests/thread-ground.main.js — the main-process half of
// the thread-ground test: the window size and one real key (shared with terminal-pages), and the
// colors the window really shows along lines of the page, read from a capture of the window.
// The window is never focused or shown by this file.
'use strict';

module.exports = win => ({
  ...require('./thread-collapse.main.js')(win),

  // The colors along some columns and rows of the page, one value for each page pixel, packed as
  // red * 65536 + green * 256 + blue. `pageWidth` and `pageHeight` are the page's own size, so a
  // zoomed page and a scaled screen both map onto the capture.
  async lines(pageWidth, pageHeight, columns, rows) {
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const scaleX = size.width / pageWidth;
    const scaleY = size.height / pageHeight;
    const colorAt = (pageX, pageY) => {
      const x = Math.min(size.width - 1, Math.max(0, Math.floor((pageX + 0.5) * scaleX)));
      const y = Math.min(size.height - 1, Math.max(0, Math.floor((pageY + 0.5) * scaleY)));
      const at = (y * size.width + x) * 4;

      // the bitmap is blue, green, red, alpha
      return bitmap[at + 2] * 65536 + bitmap[at + 1] * 256 + bitmap[at];
    };
    const column = x => Array.from({ length: Math.floor(pageHeight) }, (_, y) => colorAt(x, y));
    const row = y => Array.from({ length: Math.floor(pageWidth) }, (_, x) => colorAt(x, y));
    return { columns: columns.map(column), rows: rows.map(row) };
  },
});
