// Technically Not tools · desktop-check/tests/thread-glass.main.js — the main-process half of the
// thread-glass test: the window size and the colors the window really shows along lines of the
// page (both shared with thread-ground), and a small part of the window saved enlarged, so a
// picture 40 px wide (a thread row's computer) can be looked at.
// The window is never focused or shown by this file.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = win => ({
  ...require('./thread-ground.main.js')(win),

  // A part of the page, given in page pixels, saved eight times enlarged beside the test's other
  // pictures as desktop-<name>.png.
  async crop(name, pageWidth, left, top, width, height) {
    const image = await win.webContents.capturePage();
    const scale = image.getSize().width / pageWidth;
    const part = image.crop({
      x: Math.max(0, Math.round(left * scale)),
      y: Math.max(0, Math.round(top * scale)),
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    });
    const size = part.getSize();
    const large = part.resize({ width: size.width * 8, height: size.height * 8, quality: 'good' });
    const file = path.join(
      __dirname,
      '..',
      '..',
      'browser-check',
      'out',
      'desktop-' + String(name).replace(/[^\w-]/g, '') + '.png'
    );
    fs.writeFileSync(file, large.toPNG());
    return file;
  },
});
