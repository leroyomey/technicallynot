// Technically Not tools · desktop-check/tests/ring-and-hover.main.js — the main-process half of
// the ring-and-hover test. It reuses the helpers of the agent-graph test (no agent process is
// started, the page's zoom, the page behaving as if it had the keyboard) and adds two ways of
// reading a fresh picture of the window: short runs of real screen pixels, and a cut-out. The
// window is never focused or shown by this file.
'use strict';

const fs = require('fs');
const path = require('path');
const agentGraphHelper = require('./agent-graph.main.js');

// The folder the window tests save their pictures in.
const PICTURES = path.join(__dirname, '..', '..', 'browser-check', 'out');

// How many pixels a run reaches to each side of its middle.
const REACH = 4;

module.exports = win => {
  // How many picture pixels one CSS px of the page is: the zoom times the screen's own scale.
  const pixelsPerPx = picture =>
    win.webContents.getZoomFactor() * (picture.getSize().width / win.getContentSize()[0]);

  return {
    ...agentGraphHelper(win),

    // For each spot { x, y, axis } (CSS px): the colors of the pixels from REACH before it to
    // REACH after it along its axis ('x' or 'y'), all read from one picture.
    async runs(spots) {
      const picture = await win.webContents.capturePage();
      const size = picture.getSize();
      const bitmap = picture.toBitmap();
      const factor = pixelsPerPx(picture);
      const colorAt = (x, y) => {
        const column = Math.max(0, Math.min(size.width - 1, x));
        const row = Math.max(0, Math.min(size.height - 1, y));

        // four bytes a pixel, in the order blue, green, red, alpha
        const at = (row * size.width + column) * 4;
        return [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
      };
      return spots.map(spot => {
        const middleX = Math.floor(spot.x * factor);
        const middleY = Math.floor(spot.y * factor);
        const run = [];
        for (let step = -REACH; step <= REACH; step++)
          run.push(
            spot.axis === 'x' ? colorAt(middleX + step, middleY) : colorAt(middleX, middleY + step)
          );
        return run;
      });
    },

    // A cut-out of the window's picture around a box (CSS px), as a data URL the page can draw.
    async cutOut(left, top, width, height) {
      const picture = await win.webContents.capturePage();
      const size = picture.getSize();
      const factor = pixelsPerPx(picture);
      const x = Math.max(0, Math.round(left * factor));
      const y = Math.max(0, Math.round(top * factor));
      const piece = picture.crop({
        x,
        y,
        width: Math.max(1, Math.min(size.width - x, Math.round(width * factor))),
        height: Math.max(1, Math.min(size.height - y, Math.round(height * factor))),
      });
      return piece.toDataURL();
    },

    // Saves a picture the page drew (a PNG data URL) beside the other test pictures.
    savePicture(name, dataUrl) {
      fs.mkdirSync(PICTURES, { recursive: true });
      const file = path.join(PICTURES, 'desktop-' + name.replace(/[^\w-]/g, '') + '.png');
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      return file;
    },
  };
};
