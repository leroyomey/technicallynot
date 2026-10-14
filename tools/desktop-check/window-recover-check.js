/*
 * Technically Not tools · desktop-check/window-recover-check.js — desktop/window-recover.js in one
 * hidden window with a blank page: the page process is ended on purpose, the page must load again
 * by itself; ended a second time within the minute, it must stay as it is (no loop); a clean exit
 * is left alone. About 3 s, opens nothing on screen. Run: npx electron
 * tools/desktop-check/window-recover-check.js Not proven here: the real app window coming back with
 * its terminal panels (the wiring is one line in desktop/main.js createWindow).
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const recover = require('../../desktop/window-recover');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-recover-')));
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  const page = 'data:text/html,<title>recover</title><p id="p">here</p>';
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  let loads = 0;
  const lines = [];
  const loaded = () => new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  const gone = () =>
    new Promise(resolve =>
      win.webContents.once('render-process-gone', (_e, d) => resolve(d.reason))
    );
  recover.watch(
    win,
    () => {
      loads++;
      win.loadURL(page);
    },
    line => lines.push(line)
  );
  let ready = loaded();
  win.loadURL(page);
  await ready;

  // 1. The page process ends: loaded again, and the page answers.
  ready = loaded();
  let ended = gone();
  win.webContents.forcefullyCrashRenderer();
  const reason = await Promise.race([ended, wait(8000).then(() => 'no event')]);
  check(
    reason !== 'no event' && reason !== 'clean-exit',
    'ending the page process is reported (' + reason + ')'
  );
  const back = await Promise.race([ready.then(() => true), wait(8000).then(() => false)]);
  check(back && loads === 1, 'the page was loaded again, once (' + loads + ')');
  const text = back
    ? await win.webContents
        .executeJavaScript('document.getElementById("p").textContent')
        .catch(() => '')
    : '';
  check(text === 'here', 'the page answers after coming back');
  check(
    lines.length === 1 && /loading the page again/.test(lines[0]),
    'one log line says so: ' + (lines[0] || '')
  );

  // 2. It ends again within the minute: left alone.
  ended = gone();
  win.webContents.forcefullyCrashRenderer();
  await Promise.race([ended, wait(8000)]);
  await wait(500);
  check(loads === 1, 'a second end within a minute is not loaded again (' + loads + ')');
  check(
    lines.length === 2 && /not loaded again/.test(lines[1]),
    'the log says why: ' + (lines[1] || '')
  );

  // 3. A clean exit and a closed window do nothing.
  const fake = {
    isDestroyed: () => false,
    webContents: {
      on: (_n, fn) => {
        fake.fire = fn;
      },
    },
  };
  let fakeLoads = 0;
  recover.watch(
    fake,
    () => fakeLoads++,
    () => {}
  );
  fake.fire({}, { reason: 'clean-exit' });
  check(fakeLoads === 0, 'a clean exit is left alone');
  fake.isDestroyed = () => true;
  fake.fire({}, { reason: 'crashed' });
  check(fakeLoads === 0, 'a closed window is left alone');
  fake.isDestroyed = () => false;
  fake.fire({}, { reason: 'oom' });
  check(fakeLoads === 1, 'out of memory loads the page again');

  console.log(
    failed ? 'window-recover-check: ' + failed + ' FAILED' : 'window-recover-check: PASS'
  );
  win.destroy();
  try {
    fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
  } catch {}
  app.exit(failed ? 1 : 0);
});
