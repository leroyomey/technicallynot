// Technically Not tools · desktop-check/tests/thread-blur.main.js — main-process side of
// thread-blur.js: the helpers of thread-helpers.main.js (a made-up Claude Code transcript, the
// window's size), plus one of its own: a picture of the window, searched for a hard line.
//
// A blur done right changes softly everywhere. A ghost line (a blur cut off at an edge, a
// scrollbar, a box that fades to a different tone) shows as a long straight run of pixels where
// the color jumps between one pixel and its neighbor. So, inside each area the test names, every
// pixel is compared with the pixel to its right and the one below it, and the longest straight
// run of jumps is reported, with where it is.
'use strict';
const helpers = require('./thread-helpers.main.js');

// a jump in brightness of more than this (of 255) between two neighbors counts
const JUMP = 6;

module.exports = win => {
  const base = helpers(win);
  return {
    ...base,

    // a close picture of one part of the window (page pixels), four times as large, saved beside
    // the test's other pictures
    async closeUp(name, left, top, width, height) {
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 150));
      const zoom = win.webContents.getZoomFactor();
      const image = await win.webContents.capturePage({
        x: Math.round(left * zoom),
        y: Math.round(top * zoom),
        width: Math.round(width * zoom),
        height: Math.round(height * zoom),
      });
      const size = image.getSize();
      const big = image.resize({ width: size.width * 4, height: size.height * 4, quality: 'good' });
      const out = require('path').resolve(__dirname, '..', '..', 'browser-check', 'out');
      require('fs').writeFileSync(
        require('path').join(out, 'desktop-' + name + '.png'),
        big.toPNG()
      );
      return true;
    },

    // A soft ghost (a blurred scrollbar) has no hard jump, so it is found by comparison: the
    // biggest difference in brightness, row by row, between a column at `at` and one at
    // `beside` (page pixels), from `top` to `bottom`.
    async columns(at, beside, top, bottom) {
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 150));
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      const bitmap = image.toBitmap();
      const [contentWidth] = win.getContentSize();
      const scale = (size.width / contentWidth) * win.webContents.getZoomFactor();
      const light = (x, y) => {
        const where = (y * size.width + x) * 4;
        return 0.0722 * bitmap[where] + 0.7152 * bitmap[where + 1] + 0.2126 * bitmap[where + 2];
      };
      const first = Math.round(at * scale);
      const second = Math.round(beside * scale);
      let most = 0;
      for (let y = Math.round(top * scale); y < Math.round(bottom * scale); y++)
        most = Math.max(most, Math.abs(light(first, y) - light(second, y)));
      return Math.round(most * 10) / 10;
    },

    // `areas`: [{ name, left, top, right, bottom, skip: [{left, top, right, bottom}] }] in page
    // pixels. Answers per area: the longest run of jumps across a line lying sideways and one
    // standing up, in page pixels, with where the longest one is, and the biggest jump seen.
    async lines(areas) {
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 150));
      const image = await win.webContents.capturePage();
      const size = image.getSize();
      const bitmap = image.toBitmap();
      const zoom = win.webContents.getZoomFactor();
      const [contentWidth] = win.getContentSize();

      // page pixels to picture pixels
      const scale = (size.width / contentWidth) * zoom;
      const light = (x, y) => {
        const at = (y * size.width + x) * 4;
        return 0.0722 * bitmap[at] + 0.7152 * bitmap[at + 1] + 0.2126 * bitmap[at + 2];
      };
      const toPicture = box => ({
        left: Math.max(0, Math.round(box.left * scale)),
        top: Math.max(0, Math.round(box.top * scale)),
        right: Math.min(size.width - 1, Math.round(box.right * scale)),
        bottom: Math.min(size.height - 1, Math.round(box.bottom * scale)),
      });

      return areas.map(area => {
        const box = toPicture(area);
        const skips = (area.skip || []).map(toPicture);
        const skipped = (x, y) =>
          skips.some(one => x >= one.left && x <= one.right && y >= one.top && y <= one.bottom);
        let biggest = 0;
        let lying = { run: 0, x: 0, y: 0 };
        let standing = { run: 0, x: 0, y: 0 };

        // a line lying sideways: jumps to the pixel below, side by side along a row
        for (let y = box.top; y < box.bottom; y++) {
          let run = 0;
          for (let x = box.left; x <= box.right; x++) {
            const jump =
              skipped(x, y) || skipped(x, y + 1) ? 0 : Math.abs(light(x, y) - light(x, y + 1));
            biggest = Math.max(biggest, jump);
            run = jump > JUMP ? run + 1 : 0;
            if (run > lying.run) lying = { run, x, y };
          }
        }

        // a line standing up: jumps to the pixel on the right, one above the other in a column
        for (let x = box.left; x < box.right; x++) {
          let run = 0;
          for (let y = box.top; y <= box.bottom; y++) {
            const jump =
              skipped(x, y) || skipped(x + 1, y) ? 0 : Math.abs(light(x, y) - light(x + 1, y));
            biggest = Math.max(biggest, jump);
            run = jump > JUMP ? run + 1 : 0;
            if (run > standing.run) standing = { run, x, y };
          }
        }
        const page = value => Math.round(value / scale);
        return {
          name: area.name,
          biggest: Math.round(biggest),
          lying: { run: page(lying.run), x: page(lying.x), y: page(lying.y) },
          standing: { run: page(standing.run), x: page(standing.x), y: page(standing.y) },
        };
      });
    },
  };
};
