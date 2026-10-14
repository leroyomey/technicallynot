/*
 * Technically Not tools · desktop-check/snapshot-fail-check.js — What a snapshot does when it goes
 * wrong, with no real capture, no real shortcut and no window over the screen (the screen source,
 * the global shortcut and the overlay's page load are replaced): a press that cannot capture shows
 * the "Snapshot failed" card with a short plain reason; an overlay page that does not load ends the
 * snapshot instead of leaving every later press "busy"; clip messages that arrive when no clip is
 * running are ignored without an error. Run: npx electron
 * tools/desktop-check/snapshot-fail-check.js (about 5 s; the card shows for a moment at the bottom
 * of the screen) Not proven here: a real capture, the clipboard, a real clip (desktop test
 * `snapshot`, clip-clipboard-check.js).
 */
'use strict';
const {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
} = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const desktop = path.join(__dirname, '..', '..', 'desktop');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-snapfail-')));
app.on('window-all-closed', () => {}); // the card closing must not end the check

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
    // Stand-ins, set before the service is loaded: the shortcut hands us its press, the screen
    // source is ours, the overlay page can refuse to load.
    let press = null,
      capture = 'none',
      overlayLoads = false;
    globalShortcut.register = (_acc, fn) => {
      press = fn;
      return true;
    };
    globalShortcut.unregister = () => {};
    desktopCapturer.getSources = async () =>
      capture === 'none'
        ? []
        : [
            {
              display_id: '',
              thumbnail: nativeImage.createFromBitmap(Buffer.alloc(64 * 40 * 4, 120), {
                width: 64,
                height: 40,
              }),
            },
          ];
    const realLoad = BrowserWindow.prototype.loadFile;
    BrowserWindow.prototype.loadFile = function (file, ...rest) {
      return !overlayLoads && /snapshot-overlay\.html$/.test(String(file))
        ? Promise.reject(new Error('test: the page did not load'))
        : realLoad.call(this, file, ...rest);
    };
    const made = [];
    app.on('browser-window-created', (_e, w) => made.push(w));
    const service = require(path.join(desktop, 'snapshot-service.js')),
      clip = require(path.join(desktop, 'snapshot-clip.js'));
    service.init(() => {});
    check(typeof press === 'function', 'the snapshot shortcut is registered with its press');

    // 1. A press when the screen cannot be captured: the card says so, with a short reason.
    press();
    await wait(900);
    const card = made.find(
      w => !w.isDestroyed() && /^data:text\/html/.test(w.webContents.getURL())
    );
    const page = card ? decodeURIComponent(card.webContents.getURL()) : '';
    check(
      /<span>Snapshot failed<\/span><small>screen capture unavailable<\/small>/.test(page) &&
        !/<img/.test(page),
      'a press that cannot capture shows the card "Snapshot failed" with the reason and no picture: ' +
        (page.match(/<span>.*<\/small>/)?.[0] || 'no card')
    );
    check(
      card && card.getBounds().width === 240 && card.getBounds().height === 68,
      'the card has its usual small size (' + JSON.stringify(card?.getBounds()) + ')'
    );
    check(service.overlay() === null, 'no snapshot is left open after the failed press');
    await wait(1200);
    check(!card || card.isDestroyed(), 'the card goes away by itself');

    // 2. The overlay's page does not load: the snapshot ends, and the next one is not refused as
    // "busy".
    capture = 'ok';
    const first = await within(service.start(), 5000);
    check(
      first !== 'TIMED OUT' &&
        first?.cancelled === true &&
        !first.busy &&
        service.overlay() === null,
      'an overlay page that does not load ends the snapshot: ' + JSON.stringify(first)
    );
    const second = await within(service.start(), 5000);
    check(
      second !== 'TIMED OUT' && !second?.busy,
      'the next snapshot after it is not "busy": ' + JSON.stringify(second)
    );
    check(!made.some(w => !w.isDestroyed() && w.isVisible()), 'no window was left on the screen');

    // 3. Clip messages with no clip running (a late "done", "started", "stop" or "hover" after the
    // clip ended): ignored, nothing thrown. wires the clip's listeners and stops before any window
    await clip.start(undefined).catch(() => {});
    check(clip.active() === false, 'no clip is running');
    let threw = '';
    for (const [channel, value] of [
      ['clip:started'],
      ['clip:done', { video: new Uint8Array(4) }],
      ['clip:stop'],
      ['clip:hover', true],
    ]) {
      try {
        ipcMain.emit(channel, { sender: {} }, value);
      } catch (error) {
        threw += channel + ': ' + error.message + '; ';
      }
    }
    check(
      !threw,
      'late clip messages with no clip running are ignored' + (threw ? ' (' + threw + ')' : '')
    );
    await wait(200);
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
  app.exit(failed ? 1 : 0);
});
