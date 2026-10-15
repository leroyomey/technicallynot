// Technically Not tools · desktop-check/tests/snapshot-shelf.main.js — main-process side of
// snapshot-shelf.js: puts made-up pictures and clips into the app's own Snapshots box
// (desktop/snapshot-shelf.js, the same module the app loaded), reads the clipboard's text, and
// sizes the window.
'use strict';
const fs = require('fs');
const path = require('path');
const { clipboard, nativeImage } = require('electron');
const shelf = require('../../../desktop/snapshot-shelf');
const attachments = require('../../../desktop/attachment-service');

// A picture of two soft bands, so a tile shows something that can be seen in a screenshot.
function picture(width, height, top, bottom) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const color = y < height / 2 ? top : bottom;
      const at = (y * width + x) * 4;
      pixels[at] = color[2];
      pixels[at + 1] = color[1];
      pixels[at + 2] = color[0];
      pixels[at + 3] = 255;
    }
  return nativeImage.createFromBitmap(pixels, { width, height });
}

module.exports = win => ({
  seed: () => {
    shelf.addPicture(picture(320, 200, [90, 110, 160], [230, 230, 240]).toPNG(), 320, 200);
    shelf.addPicture(picture(200, 300, [160, 90, 120], [240, 220, 200]).toPNG(), 200, 300);
    shelf.addPicture(picture(480, 160, [80, 150, 120], [30, 30, 40]).toPNG(), 480, 160);
    const day = path.join(attachments.dir(), '2026-10-14');
    fs.mkdirSync(day, { recursive: true });
    for (const id of ['5eed0001', '5eed0002']) {
      const video = path.join(day, id + '-clip.webm');
      const frame = path.join(day, id + '-clip-1.png');
      fs.writeFileSync(video, 'not a real video');
      fs.writeFileSync(frame, picture(320, 180, [120, 100, 170], [40, 40, 60]).toPNG());
      attachments.hold([video, frame]);
      shelf.addClip(video, [frame], '[Attached clip: ' + video + ']');
    }
    return shelf.list();
  },
  clipboardText: () => clipboard.readText(),
  // A maximized window keeps its size, so it is put back to normal first.
  size: async (width, height) => {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(width, height);
    await new Promise(resolve => setTimeout(resolve, 450));
    return win.getContentSize();
  },
});
