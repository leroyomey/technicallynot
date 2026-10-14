/*
 * Technically Not tools · desktop-check/tests/attachments.main.js — Main-process side of
 * attachments.js: stand-in snapshot clips in the test profile's attachments folder, put on the
 * app's own list of unused clips (desktop/attachment-service.js), and how many of a clip's files
 * are left afterwards; a real clip (a video the test page recorded, two frames) for the chip, the
 * still and the player; the open view-only windows and whether one plays.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { BrowserWindow, nativeImage } = require('electron');
module.exports = () => {
  const att = require('../../../desktop/attachment-service.js'); // the app's own instance
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const viewerWindows = () =>
    BrowserWindow.getAllWindows().filter(
      w => !w.isDestroyed() && /\(view only\)$/.test(w.getTitle())
    );

  // the file's own page (under the window's bar)
  const page = w => w.contentView?.children?.[0]?.webContents || w.webContents;
  return {
    // A clip (video and one frame) that nobody pasted yet. → its two paths.
    hold(id) {
      const folder = path.join(att.dir(), '2026-01-01');
      fs.mkdirSync(folder, { recursive: true });
      const files = ['-clip.webm', '-clip-1.png'].map(end => path.join(folder, id + end));
      for (const file of files) fs.writeFileSync(file, 'x');
      att.hold(files);
      return files;
    },
    // How many of the files exist. sweep: first look at the unused clips with a clipboard that
    // holds something else.
    async left(files, sweep) {
      if (sweep) att.sweep(false, () => 'something else was copied');
      await att.settled();
      await sleep(80);
      await att.settled();
      return files.filter(file => fs.existsSync(file)).length;
    },
    // A real clip in today's folder: the video (base64 of a WebM) and two 320 by 180 frames of one
    // color each. → { video, frames }.
    clip(id, videoBase64) {
      const now = new Date(),
        day =
          now.getFullYear() +
          '-' +
          String(now.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(now.getDate()).padStart(2, '0');
      const folder = path.join(att.dir(), day);
      fs.mkdirSync(folder, { recursive: true });
      const video = path.join(folder, id + '-clip.webm');
      fs.writeFileSync(video, Buffer.from(videoBase64, 'base64'));
      const frames = [
        [60, 140, 220],
        [220, 120, 60],
      ].map((bgr, i) => {
        const px = Buffer.alloc(320 * 180 * 4);
        for (let p = 0; p < px.length; p += 4) {
          px[p] = bgr[0];
          px[p + 1] = bgr[1];
          px[p + 2] = bgr[2];
          px[p + 3] = 255;
        }
        const file = path.join(folder, id + '-clip-' + (i + 1) + '.png');
        fs.writeFileSync(
          file,
          nativeImage.createFromBitmap(px, { width: 320, height: 180 }).toPNG()
        );
        return file;
      });
      return { video, frames };
    },
    // The open view-only file windows: what each shows and its size.
    viewers: () =>
      viewerWindows().map(w => {
        const [width, height] = w.getSize();
        return { url: page(w).getURL(), width, height, title: w.getTitle() };
      }),
    // Whether the first one's picture changes over half a second (a playing video).
    async moving() {
      const w = viewerWindows()[0];
      if (!w) return { changed: false, why: 'no window' };
      await sleep(600);
      const a = (await page(w).capturePage()).toBitmap();
      await sleep(500);
      const b = (await page(w).capturePage()).toBitmap();
      return { changed: a.length > 0 && !a.equals(b), bytes: a.length };
    },
    closeViewers() {
      for (const w of viewerWindows()) w.destroy();
      return true;
    },
  };
};
