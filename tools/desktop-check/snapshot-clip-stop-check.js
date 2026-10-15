/*
 * Technically Not tools · desktop-check/snapshot-clip-stop-check.js — A clip's Stop that comes
 * early, with no real capture and no window on the screen (the screen source, the recorder page
 * and the frame page are stand-ins, and the frame is never shown): Stop while the screen source is
 * still being looked up cancels the clip before any window opens; Stop after the windows exist but
 * before the recorder page has loaded, or while it loads, ends the clip as soon as it records,
 * never after the full 30 s; Stop while recording keeps the clip as before. Run: npx electron
 * tools/desktop-check/snapshot-clip-stop-check.js (about 3 s, nothing shows). Not proven here: a
 * real screen recording (desktop test `snapshot`, whose overlay covers the screen).
 */
'use strict';
const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const desktop = path.join(__dirname, '..', '..', 'desktop');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-clipstop-'));
app.setPath('userData', scratch);

// The finished clip windows closing must not end the check.
app.on('window-all-closed', () => {});

// Stand-in recorder page: it uses the real preload bridge, records nothing and answers Stop with a
// tiny video and one real PNG frame. Like the real page, it ends by itself only at maxMs.
const recorderPage = path.join(scratch, 'recorder-stand-in.html');
fs.writeFileSync(
  recorderPage,
  `<!doctype html><meta charset="utf-8"><body><script>
  const api = window.tnaiClip;
  let recording = false, wanted = false, ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    c.getContext('2d').fillRect(0, 0, 4, 4);
    c.toBlob(async blob => {
      const png = new Uint8Array(await blob.arrayBuffer());
      api.done({ webm: new Uint8Array([26, 69, 223, 163]), frames: [png], ms: 50 });
    }, 'image/png');
  };
  api.onFinish(() => { wanted = true; if (recording) finish(); });
  api.onRecord(job => {
    recording = true;
    api.started();
    setTimeout(finish, job.maxMs);
    if (wanted) finish();
  });
</script></body>`
);
const framePage = path.join(scratch, 'frame-stand-in.html');
fs.writeFileSync(framePage, '<!doctype html><meta charset="utf-8"><body></body>');

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const within = (promise, ms) =>
    Promise.race([promise, new Promise(r => setTimeout(() => r('TIMED OUT'), ms))]);
  const errors = [];
  process.on('uncaughtException', e => errors.push(e.message));
  process.on('unhandledRejection', e => errors.push(String(e?.message || e)));
  try {
    const display = screen.getPrimaryDisplay();
    const region = { x: 0, y: 0, width: 200, height: 120 };

    // The screen source answers after a short wait, so a Stop can land while it is looked up.
    let lookups = 0;
    desktopCapturer.getSources = async () => {
      lookups++;
      await wait(200);
      return [{ id: 'screen:test', display_id: String(display.id) }];
    };

    // The real pages are swapped for the stand-ins; the recorder's loads late, so its windows
    // exist for a moment before anything in the page listens.
    let recorderDelay = 400;
    const realLoad = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = function (file) {
      const name = path.basename(String(file));
      if (name === 'snapshot-recorder.html')
        return wait(recorderDelay).then(() => realLoad.call(this, recorderPage));
      if (name === 'snapshot-frame.html') return realLoad.call(this, framePage);
      return realLoad.call(this, file);
    };

    // The frame is never put on the screen in this check.
    BrowserWindow.prototype.showInactive = function () {};
    const made = [];
    app.on('browser-window-created', (_e, w) => made.push(w));
    const clip = require(path.join(desktop, 'snapshot-clip.js'));

    // 1. Stop while the screen source is still being looked up: cancelled, no window opened.
    const first = clip.start(display, region);
    await wait(20);
    const firstStop = clip.stop();
    const firstResult = await within(first, 5000);
    check(firstStop === true, 'Stop during the source lookup is taken (stop() returned true)');
    check(
      firstResult !== 'TIMED OUT' && firstResult?.cancelled === true && !firstResult.saved,
      'Stop during the source lookup cancels the clip: ' + JSON.stringify(firstResult)
    );
    check(made.length === 0, 'no clip window opened for it (' + made.length + ')');
    check(clip.active() === false, 'no clip is left running');

    // 2. Stop after the windows exist, before the recorder page has loaded: the clip ends as soon
    // as it records, not after 30 s.
    const second = clip.start(display, region);
    while (!clip.frame() && clip.active()) await wait(5);
    const secondStop = clip.stop();
    const startedAt = Date.now();
    const secondResult = await within(second, 5000);
    check(secondStop === true, 'Stop before the recorder page loads is taken');
    check(
      secondResult !== 'TIMED OUT' && secondResult?.saved === true,
      'Stop before the recorder page loads ends and keeps the clip in ' +
        (Date.now() - startedAt) +
        ' ms: ' +
        (secondResult === 'TIMED OUT' ? 'still recording after 5 s' : JSON.stringify(secondResult))
    );
    check(clip.active() === false, 'no clip is left running');

    // 2b. The same while the recorder page is loading (it starts at once, Stop 30 ms later): the
    // page has not set up its listener yet, which lost the Stop before 2026-10-14.
    recorderDelay = 0;
    const early = clip.start(display, region);
    while (!clip.frame() && clip.active()) await wait(5);
    await wait(30);
    const earlyStop = clip.stop();
    const earlyResult = await within(early, 5000);
    check(
      earlyStop === true && earlyResult !== 'TIMED OUT' && earlyResult?.saved === true,
      'Stop while the recorder page loads ends and keeps the clip: ' +
        (earlyResult === 'TIMED OUT' ? 'still recording after 5 s' : JSON.stringify(earlyResult))
    );
    check(clip.active() === false, 'no clip is left running');

    // 3. Stop while recording, as before: kept.
    let recording = null;
    const onStarted = () => recording && recording();
    ipcMain.on('clip:started', onStarted);
    const third = clip.start(display, region);
    await within(new Promise(r => (recording = r)), 5000);
    const thirdStop = clip.stop();
    const thirdResult = await within(third, 5000);
    ipcMain.removeListener('clip:started', onStarted);
    check(
      thirdStop === true && thirdResult !== 'TIMED OUT' && thirdResult?.saved === true,
      'Stop while recording keeps the clip: ' + JSON.stringify(thirdResult)
    );
    check(clip.stop() === false, 'Stop with no clip running does nothing');
    check(lookups === 4, 'one source lookup per clip (' + lookups + ')');
    check(!made.some(w => !w.isDestroyed()), 'every clip window is closed');
    check(
      !errors.length,
      'no error reached the main process' + (errors.length ? ': ' + errors.join(' | ') : '')
    );
  } catch (error) {
    check(false, 'threw: ' + (error.stack || error.message));
  }
  console.log(failed ? 'RESULT: FAIL (' + failed + ')' : 'RESULT: PASS');
  BrowserWindow.getAllWindows().forEach(w => {
    try {
      w.destroy();
    } catch {}
  });
  try {
    fs.rmSync(scratch, { recursive: true, force: true });
  } catch {}
  app.exit(failed ? 1 : 0);
});
