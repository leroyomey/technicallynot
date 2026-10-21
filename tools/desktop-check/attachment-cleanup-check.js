/*
 * Technically Not tools · desktop-check/attachment-cleanup-check.js — Snapshot clips and
 * attachments do not pile up (desktop/attachment-service.js, save() in desktop/snapshot-clip.js):
 * files older than 30 days are pruned, also in an app that is never restarted (once a day, at the
 * next sweep); a clip that was never pasted in the app is deleted once the clipboard no longer
 * names it, at a sweep, at app start and at quit, and is kept while the clipboard names it or after
 * a paste in the app named it; the list of unused clips survives a restart and cannot be made to
 * delete anything but clip files in the attachments folder; a clip that could not be written whole
 * leaves no part behind. Run: npx electron tools/desktop-check/attachment-cleanup-check.js (about 3
 * s, no window, a throwaway settings folder; the real clipboard holds a test line for a moment and
 * gets its text back, a copied picture or file list is not put back) Not proven here: a real clip
 * from the recorder, the paste events of the app's page (desktop tests `snapshot`, `attachments`),
 * a file that cannot be deleted because it is in use.
 */
'use strict';
const { app, clipboard, nativeImage } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const desktop = path.join(__dirname, '..', '..', 'desktop');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-attclean-'));
app.setPath('userData', home);
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const DAY = 86400000,
    realNow = Date.now;
  try {
    const servicePath = path.join(desktop, 'attachment-service.js');
    let att = require(servicePath);
    const root = att.dir(),
      list = path.join(home, 'unused-clips.json');
    const put = (day, name, ageDays = 0) => {
      const folder = path.join(root, day);
      fs.mkdirSync(folder, { recursive: true });
      const file = path.join(folder, name);
      fs.writeFileSync(file, 'x');
      if (ageDays) {
        const t = new Date(realNow() - ageDays * DAY);
        fs.utimesSync(file, t, t);
      }
      return file;
    };
    const has = file => fs.existsSync(file);
    const clipFiles = (day, id) => [
      put(day, id + '-clip.webm'),
      put(day, id + '-clip-1.png'),
      put(day, id + '-clip-2.png'),
    ];
    const line = files =>
      '[Attached clip: 3 s of screen recording as 2 frames in order, ' +
      files[1] +
      ' to ' +
      path.basename(files[2]) +
      '; video ' +
      files[0] +
      ']';
    const settle = async () => {
      await att.settled();
      await wait(60);
      await att.settled();
    };
    await wait(150); // the service's own start run

    // 1. The 30 day rule.
    const old = put('2020-01-01', 'aaaa0001-shot.png', 31),
      young = put('2020-01-02', 'aaaa0002-shot.png', 29);
    await att.prune();
    check(!has(old) && has(young), 'prune deletes a file 31 days old and keeps one 29 days old');
    check(
      !has(path.dirname(old)) && has(path.dirname(young)),
      'the day folder left empty is removed, the other stays'
    );

    // 2. An app that is never restarted: no prune within a day of the last one, one at the next
    // sweep after a day.
    const stale = put('2020-01-03', 'aaaa0003-shot.png', 31);
    att.sweep(false, () => '');
    await wait(200);
    check(has(stale), 'within a day of the last prune a sweep does not prune again');
    Date.now = () => realNow() + 25 * 3600000;
    att.sweep(false, () => '');
    await wait(300);
    Date.now = realNow;
    check(
      !has(stale),
      'a day later, with no restart, the next sweep prunes (the old file is gone)'
    );

    // 3. A clip nobody pasted: kept while the clipboard names it, deleted once it does not.
    const a = clipFiles('2026-01-01', 'a1a1a1a1');
    att.hold(a);
    att.sweep(false, () => line(a));
    await settle();
    check(a.every(has), 'an unused clip stays while the clipboard holds its line');
    check(
      has(list) && fs.readFileSync(list, 'utf8').includes('a1a1a1a1-clip.webm'),
      'the unused clip is on the saved list'
    );
    att.sweep(false, () => 'something else was copied');
    await settle();
    check(
      !a.some(has),
      'once the clipboard holds something else, the next sweep deletes the video and every frame'
    );
    check(!has(list), 'the saved list is removed when it is empty');

    // 4. A clip pasted in the app is kept: by its line (text box, terminal panel) and by its file
    // name (the composer's chip).
    const b = clipFiles('2026-01-01', 'b2b2b2b2');
    att.hold(b);
    att.used(line(b));
    att.sweep(false, () => 'something else');
    await settle();
    check(
      b.every(has),
      'a clip whose line was pasted in the app is kept after the clipboard changed'
    );
    const c = clipFiles('2026-01-01', 'c3c3c3c3');
    att.hold(c);
    att.used('c3c3c3c3-clip.webm');
    att.sweep(false, () => '');
    await settle();
    check(
      c.every(has),
      'a clip whose video file was pasted in the app is kept after the clipboard changed'
    );
    const d = clipFiles('2026-01-01', 'd4d4d4d4');
    att.hold(d);
    att.used(
      '[Attached clip: another clip; video ' +
        path.join(root, '2026-01-01', 'ffffffff-clip.webm') +
        ']'
    );
    await settle();
    check(
      !d.some(has),
      'a paste that names another clip does not keep this one (it is gone: the clipboard does not name it)'
    );

    // 4b. The clipboard as Electron gives it: an answer that comes later (a promise), and the real
    // clipboard read by the service itself.
    const late = clipFiles('2026-01-01', 'b4b4b4b4');
    att.hold(late);
    att.sweep(false, async () => line(late));
    await settle();
    check(
      late.every(has),
      'an unused clip stays when the clipboard answers later (a promise) with its line'
    );
    att.sweep(true, async () => 'something else');
    await settle();
    check(late.every(has), 'at quit an answer that is not there yet deletes nothing');
    const before = await clipboard.readText().catch(() => '');
    try {
      await clipboard.writeText(line(late));
      att.sweep();
      await settle();
      check(
        late.every(has),
        'an unused clip stays while the real clipboard holds its line (read by the service itself)'
      );
    } finally {
      await clipboard.writeText(typeof before === 'string' ? before : '').catch(() => {});
    }
    att.sweep(false, async () => 'something else');
    await settle();
    check(!late.some(has), 'and is deleted when the clipboard answers later with something else');

    // 5. Quit and the next start. At quit the clipboard still names the clip, so it stays; the next
    // start finds the list and deletes it.
    const e = clipFiles('2026-01-02', 'e5e5e5e5');
    att.hold(e);
    await settle();
    att.sweep(true, () => line(e));
    check(
      e.every(has) && has(list),
      'at quit a clip the clipboard still names stays, and stays on the saved list'
    );
    delete require.cache[require.resolve(servicePath)];

    // a new start: reads the saved list, looks at the (real) clipboard, which does not name it
    att = require(servicePath);
    await wait(300);
    await settle();
    check(!e.some(has), 'the next start deletes the unused clip left by the last run');
    const f = clipFiles('2026-01-02', 'f6f6f6f6');
    att.hold(f);
    att.sweep(true, () => '');
    check(
      !f.some(has) && !has(list),
      'at quit a clip the clipboard no longer names is deleted at once'
    );

    // 6. The saved list cannot delete anything else: a path outside the folder and a file that is
    // not a clip are ignored.
    await settle();
    const outside = path.join(home, 'outside-clip.webm'),
      notClip = put('2026-01-02', 'aaaa0007-shot.png');
    fs.writeFileSync(outside, 'x');
    fs.writeFileSync(
      list,
      JSON.stringify([[outside], [notClip], [path.join(root, '..', 'outside-clip.webm')]])
    );
    delete require.cache[require.resolve(servicePath)];
    att = require(servicePath);
    att.sweep(true, () => '');
    await wait(200);
    check(
      has(outside) && has(notClip),
      'a changed list deletes nothing outside the attachments folder and no file that is not a clip'
    );
    att.hold([outside]);
    att.sweep(true, () => '');
    check(has(outside), 'hold() refuses a file outside the attachments folder');

    // 7. A clip that could not be handed to the clipboard goes at once.
    const g = clipFiles('2026-01-02', 'a7a7a7a7');
    att.hold(g);
    await att.discard(g[0]);
    check(!g.some(has), 'discard deletes a clip and its frames');

    // 8. A clip that could not be written whole leaves nothing (save() in snapshot-clip.js).
    const clip = require(path.join(desktop, 'snapshot-clip.js'));
    const png = nativeImage
      .createFromBitmap(Buffer.alloc(8 * 8 * 4, 200), { width: 8, height: 8 })
      .toPNG();
    const today = () => {
      const n = new Date();
      return path.join(
        root,
        n.getFullYear() +
          '-' +
          String(n.getMonth() + 1).padStart(2, '0') +
          '-' +
          String(n.getDate()).padStart(2, '0')
      );
    };
    const clipsToday = () => {
      try {
        return fs.readdirSync(today()).filter(n => /-clip/.test(n));
      } catch {
        return [];
      }
    };
    const kept = clip.save({ webm: Buffer.from('video'), frames: [png, png, png] });
    check(
      clipsToday().length === 4 && has(kept.video) && kept.frames.length === 3,
      'a whole clip is written as a video and its 3 frames: ' + clipsToday().length + ' files'
    );
    for (const file of [kept.video, ...kept.frames]) fs.rmSync(file, { force: true });

    // An MP4 clip (the recorder's first choice since 2026-10-15) is saved as .mp4, is a clip file
    // to the clean-up list, and is found by its name like a WebM one.
    const mp4 = clip.save({ video: Buffer.from('video'), mp4: true, frames: [png] });
    const found = await att.clip(path.basename(mp4.video));
    check(
      /-clip\.mp4$/.test(mp4.video) && has(mp4.video) && found?.video === mp4.video,
      'an MP4 clip is saved as .mp4 and found by its name: ' +
        path.basename(mp4.video) +
        ' -> ' +
        (found ? path.basename(found.video) : 'not found')
    );
    att.hold([mp4.video, ...mp4.frames]);
    await att.discard(mp4.video);
    check(![mp4.video, ...mp4.frames].some(has), 'discard deletes an MP4 clip and its frame');
    const realWrite = fs.writeFileSync;
    let threw = '';
    fs.writeFileSync = (file, ...rest) => {
      if (/-clip-2\.png$/.test(String(file))) throw new Error('test: disk full');
      return realWrite(file, ...rest);
    };
    try {
      clip.save({ webm: Buffer.from('video'), frames: [png, png, png] });
    } catch (error) {
      threw = error.message;
    }
    fs.writeFileSync = realWrite;
    check(
      threw === 'test: disk full' && clipsToday().length === 0,
      'a clip whose second frame cannot be written throws and leaves no file: ' +
        clipsToday().length +
        ' left'
    );
  } catch (error) {
    check(false, 'the check itself failed: ' + (error?.stack || error));
  }
  Date.now = realNow;
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {}
  console.log('RESULT: ' + (failed ? 'FAIL (' + failed + ')' : 'PASS'));
  app.exit(failed ? 1 : 0);
});
