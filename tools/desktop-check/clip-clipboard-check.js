/*
 * Technically Not tools · desktop-check/clip-clipboard-check.js — A kept clip is on the clipboard
 * as its video file and its text line together (copyClip in desktop/snapshot-service.js), and a
 * page that is pasted into gets both. Windows only. Opens no visible window and does not take the
 * screen. Run: npx electron tools/desktop-check/clip-clipboard-check.js It uses the real clipboard
 * for a few seconds and puts back what was on it (text, pictures); a copied file list from before
 * is not put back.
 */
'use strict';
const { app, BrowserWindow, clipboard, ClipboardItem } = require('electron');
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const { execFileSync } = require('child_process');

app.whenReady().then(async () => {
  let failed = 0;
  const check = (ok, label) => {
    console.log((ok ? 'ok   ' : 'FAIL ') + label);
    if (!ok) failed++;
  };
  if (process.platform !== 'win32') {
    console.log('skipped: Windows only');
    return app.exit(0);
  }
  const kept = [];
  for (const item of await clipboard.read().catch(() => [])) {
    const data = {};
    for (const type of item.types) {
      try {
        data[type] = await item.getType(type);
      } catch {}
    }
    if (Object.keys(data).length) kept.push(data);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-clip-')),
    file = path.join(dir, 'abc123-clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(2048, 7));
  const text =
    '[Attached clip: 2 s of screen recording as 1 frame, ' +
    path.join(dir, 'abc123-clip-1.png') +
    '; video ' +
    file +
    ']';
  try {
    const { copyClip } = require('../../desktop/snapshot-service');
    await clipboard.writeText(text);
    const started = Date.now(),
      done = await copyClip(file, text);
    check(done === true, 'copyClip reports done (' + (Date.now() - started) + ' ms)');
    check((await clipboard.readText()) === text, 'the text line is still on the clipboard');
    const list = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-Command',
        '(Get-Clipboard -Format FileDropList).FullName',
      ],
      { encoding: 'utf8', windowsHide: true }
    ).trim();
    check(list === file, 'the video is on the clipboard as a copied file (' + list + ')');

    // What a web page sees on paste (Chromium, the engine of Chrome and Edge).
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const page = path.join(dir, 'page.html');
    fs.writeFileSync(page, '<textarea id=t></textarea>'); // a file: page, like the app's own
    await win.loadFile(page);
    const types = await win.webContents.executeJavaScript(`window.got = null; t.focus();
      t.addEventListener('paste', e => { window.got = { files: [...e.clipboardData.files].map(f => ({ name: f.name, size: f.size, type: f.type })), text: e.clipboardData.getData('text/plain') }; e.preventDefault(); });
      ['video/webm;codecs=vp9', 'video/mp4;codecs=avc1.42E01E', 'video/mp4'].map(type => type + ' ' + MediaRecorder.isTypeSupported(type)).join(' | ')`);
    win.webContents.paste();
    let got = null;
    for (let i = 0; i < 30 && !got; i++) {
      await new Promise(r => setTimeout(r, 100));
      got = await win.webContents.executeJavaScript('window.got');
    }
    check(!!got, 'a page receives the paste');
    check(
      got?.files.length === 1 &&
        got.files[0].name === 'abc123-clip.mp4' &&
        got.files[0].size === 2048,
      'the page gets the video as a file (' + JSON.stringify(got?.files) + ')'
    );
    check(
      got?.text === '',
      'a paste that holds a file carries no text, so a site gets the video alone (' +
        JSON.stringify(got?.text) +
        ')'
    );

    // The composer reads the line from the clipboard itself (27-composer-attachments.js); the async
    // clipboard needs a focused page.
    win.webContents.focus();
    const line = await win.webContents.executeJavaScript(
      '(async () => { try { return await navigator.clipboard.readText(); } catch (error) { return "error: " + error.message; } })()',
      true
    );
    if (/^error: /.test(line) && /focus/i.test(line))
      console.log(
        'note the clipboard text could not be read from a hidden page (' +
          line +
          '): not proven here'
      );
    else
      check(
        line === text,
        'the page can still read the text line from the clipboard itself (' +
          line.slice(0, 40) +
          ')'
      );
    console.log('note recorder formats this build can write: ' + types);

    // The recorder's own list of formats (desktop/snapshot-recorder.html), tried in this build's
    // engine: a clip is MP4 here, which X and other sites take (they refuse WebM).
    const recorderPage = fs.readFileSync(
      path.join(__dirname, '..', '..', 'desktop', 'snapshot-recorder.html'),
      'utf8'
    );
    const listText = (/const type = (\[[^\]]+\])\.find/.exec(recorderPage) || [])[1] || '[]';
    const chosen = await win.webContents.executeJavaScript(
      listText + '.find(type => MediaRecorder.isTypeSupported(type)) || ""'
    );
    check(
      /^video\/mp4/.test(chosen),
      'the recorder records clips as MP4 in this build (' + chosen + ')'
    );
    win.destroy();
  } catch (error) {
    check(false, 'ran without an error: ' + error.message);
  } finally {
    try {
      if (kept.length) await clipboard.write(kept.map(data => new ClipboardItem(data)));
      else await clipboard.clear();
    } catch {}
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  console.log(failed ? 'FAILED ' + failed : 'ALL OK');
  app.exit(failed ? 1 : 0);
});
