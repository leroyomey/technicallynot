/*
 * Technically Not tools · desktop-check/snapshot-shelf-check.js — The Snapshots box
 * (desktop/snapshot-shelf.js): it keeps the last five pictures and the last five clips, newest
 * first, with a small picture of each; a sixth pushes the oldest out; a clip in the box survives
 * the clean-up sweep that deletes unused clips (attachment-service.js `keep`), and one pushed out
 * is judged by the usual rule again; Copy puts the picture or the clip's line back on the
 * clipboard; Delete and Clear all remove pictures from memory and clips from the disk; at quit the
 * box's clips go like any unused clip. Run: npx electron
 * tools/desktop-check/snapshot-shelf-check.js (about 2 s, no window, a throwaway settings folder;
 * the real clipboard holds a test picture and a test line for a moment and gets its text back, a
 * copied picture is not put back). Not proven here: a real capture through the snapshot key
 * (desktop test `snapshot`), the page's box (desktop test `snapshot-shelf`).
 */
'use strict';
const { app, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const desktop = path.join(__dirname, '..', '..', 'desktop');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-shelf-'));
app.setPath('userData', home);
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  const before = await clipboard.readText().catch(() => '');
  try {
    const attachments = require(path.join(desktop, 'attachment-service.js'));
    const shelf = require(path.join(desktop, 'snapshot-shelf.js'));

    // What the box told its listener last, and what Copy handed to the clip copier.
    let told = null;
    let copied = null;
    shelf.init({
      onChange: list => {
        told = list;
      },
      copyClip: async (file, text) => {
        copied = { file, text };
        return true;
      },
    });

    // A small PNG of a given width, so each picture can be told apart by its size.
    const png = width =>
      nativeImage
        .createFromBitmap(Buffer.alloc(width * 10 * 4, 200), { width, height: 10 })
        .toPNG();
    for (let index = 1; index <= 6; index++) shelf.addPicture(png(10 * index), 10 * index, 10);
    const pictures = shelf.list().pictures;
    check(
      pictures.map(item => item.width).join(',') === '60,50,40,30,20',
      'six pictures: the last five are kept, newest first (' +
        pictures.map(item => item.width).join(',') +
        ')'
    );
    check(
      pictures.every(item => /^data:image\/png;base64,/.test(item.thumb)),
      'each picture has a small picture of itself'
    );
    check(told?.pictures?.length === 5, 'the listener heard the new list');

    // Six clips, made the way snapshot-clip.js names them, each held as unused (record does that).
    const day = path.join(attachments.dir(), '2026-10-14');
    fs.mkdirSync(day, { recursive: true });
    const clips = [];
    for (let index = 1; index <= 6; index++) {
      const id = String(index).repeat(8);
      const files = [id + '-clip.webm', id + '-clip-1.png'].map(name => path.join(day, name));
      for (const file of files) fs.writeFileSync(file, 'x');
      attachments.hold(files);
      shelf.addClip(files[0], [files[1]], '[Attached clip: ' + files[0] + ']');
      clips.push(files);
    }
    check(
      shelf.list().clips.length === 5 && shelf.list().clips[0].name === '66666666-clip.webm',
      'six clips: the last five are kept, newest first'
    );

    // A sweep with a clipboard that names no clip: the pushed-out clip goes, the five stay.
    attachments.sweep(false, () => 'nothing here');
    await attachments.settled();
    check(!fs.existsSync(clips[0][0]), 'the clip pushed out of the box is deleted at the sweep');
    check(
      clips.slice(1).every(files => files.every(file => fs.existsSync(file))),
      'the five clips in the box survive the sweep'
    );

    // Copy a picture and a clip again.
    const first = shelf.list().pictures[0];
    const pictureCopy = await shelf.copy('picture', first.id);

    // Electron's async clipboard: the PNG item, as the snapshot test reads it.
    let onClipboard = { width: 0, height: 0 };
    for (const item of await clipboard.read().catch(() => [])) {
      const type = item.types.find(name => /^image\/png$/i.test(name));
      if (!type) continue;
      const bytes = Buffer.from(await (await item.getType(type)).arrayBuffer());
      onClipboard = nativeImage.createFromBuffer(bytes).getSize();
    }
    check(
      pictureCopy.ok && onClipboard.width === 60 && onClipboard.height === 10,
      'Copy puts the picture back on the clipboard (' +
        onClipboard.width +
        ' x ' +
        onClipboard.height +
        ')'
    );
    const newestClip = shelf.list().clips[0];
    const clipCopy = await shelf.copy('clip', newestClip.id);
    const text = await clipboard.readText();
    check(
      clipCopy.ok && text.includes(clips[5][0]) && copied?.file === clips[5][0],
      'Copy puts the clip line on the clipboard and hands its video to the copier'
    );
    const missing = await shelf.copy('picture', 'not-there');
    check(missing.ok === false, 'Copy of something no longer in the box says so');

    // Delete one of each.
    await shelf.remove('picture', first.id);
    check(
      shelf.list().pictures.length === 4 && !shelf.list().pictures.some(p => p.id === first.id),
      'Delete takes a picture out of the box'
    );
    await shelf.remove('clip', newestClip.id);
    check(
      shelf.list().clips.length === 4 && clips[5].every(file => !fs.existsSync(file)),
      'Delete takes a clip out of the box and its files off the disk'
    );

    // Clear all: an empty box and no clip files left of the ones it held.
    await shelf.clear();
    check(
      shelf.list().pictures.length === 0 && shelf.list().clips.length === 0,
      'Clear all empties the box'
    );
    check(
      clips.slice(1, 5).every(files => files.every(file => !fs.existsSync(file))),
      'Clear all deletes the clip files it held'
    );
    check(
      told?.pictures?.length === 0 && told?.clips?.length === 0,
      'the listener heard the clear'
    );

    // At quit the box is gone, so a clip still in it goes like any unused clip.
    const lastId = 'abcdef12';
    const last = [lastId + '-clip.webm', lastId + '-clip-1.png'].map(name => path.join(day, name));
    for (const file of last) fs.writeFileSync(file, 'x');
    attachments.hold(last);
    shelf.addClip(last[0], [last[1]], 'line');
    attachments.sweep(true, () => 'nothing here');
    check(
      last.every(file => !fs.existsSync(file)),
      'at quit a clip in the box is deleted when nothing names it'
    );
  } catch (error) {
    check(false, 'the check ran to its end (' + error.stack + ')');
  }
  await clipboard.writeText(typeof before === 'string' ? before : '').catch(() => {});
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {}
  console.log(failed ? 'RESULT: FAIL' : 'RESULT: PASS');
  app.exit(failed ? 1 : 0);
});
