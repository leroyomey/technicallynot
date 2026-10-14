/*
 * Technically Not desktop · preview-shot.js — `tnai shot preview` (agent-mesh.js): a PNG of a
 * localhost page at a Live preview device size, so an agent can look at the UI it built. The page
 * loads in its own hidden window (never shown, never focused; captured with stayHidden), so the
 * user's window, page, tabs and device view are untouched; Phone/Tablet presets get the same user
 * agent + touch as the Live preview frame (preview-emulation.js). Images go to the composer
 * attachments area, userData/attachments/<yyyy-mm-dd>/shot-*.png (attachment-service.js; Claude
 * Code already gets that folder), max 1600 px wide; shots are kept one day and at most 40 files.
 * One shot at a time.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow } = require('electron');
const emulation = require('./preview-emulation');

const MAX_W = 1600,
  KEEP_MS = 86400000,
  KEEP_FILES = 40,
  LOAD_MS = 12000,
  SETTLE_MS = 800,
  CAPTURE_MS = 8000;
const root = () => path.join(app.getPath('userData'), 'attachments');
const today = () => {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
};
const dir = () => path.join(root(), today());
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i;
let busy = false;

// Shots (shot-*.png in any day folder) older than a day go, and only the newest KEEP_FILES stay;
// other attachments are never touched.
function prune() {
  const files = [];
  let days = [];
  try {
    days = fs
      .readdirSync(root(), { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name));
  } catch {
    return;
  }
  for (const day of days) {
    let names = [];
    try {
      names = fs.readdirSync(path.join(root(), day.name));
    } catch {
      continue;
    }
    for (const n of names)
      if (/^shot-.*\.png$/.test(n)) {
        const file = path.join(root(), day.name, n);
        try {
          files.push({ file, at: fs.statSync(file).mtimeMs });
        } catch {}
      }
  }
  files.sort((a, b) => b.at - a.at);
  files.forEach((f, i) => {
    if (i >= KEEP_FILES - 1 || Date.now() - f.at > KEEP_MS)
      try {
        fs.unlinkSync(f.file);
      } catch {}
  });
}

// { url, width, height, preset } -> { file, width, height, loading } (loading: the page had not
// finished loading when it was captured).
async function take({ url, width, height, preset }) {
  if (!LOCAL.test(String(url || '')))
    throw new Error('only addresses on this computer can be captured');
  width = Math.round(Math.min(Math.max(Number(width) || 1280, 200), 2560));
  height = Math.round(Math.min(Math.max(Number(height) || 800, 200), 2560));
  if (busy) throw new Error('another screenshot is being taken; try again in a few seconds');
  busy = true;
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    focusable: false,
    skipTaskbar: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  try {
    const contents = win.webContents,
      fixed = require('./show-file').is(url); // a `tnai show` page never leaves its address
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, target) => {
      if (fixed || !LOCAL.test(target)) event.preventDefault();
    }); // a redirect off this computer is not followed
    contents.on('will-redirect', (event, target) => {
      if (fixed || !LOCAL.test(target)) event.preventDefault();
    }); // nor a server redirect (will-navigate misses those)

    // The device protocol only answers once the window has a page: start on about:blank, set the
    // device, then load the address (it keeps the device).
    if (preset || fixed)
      await Promise.race([
        contents.loadURL('about:blank').catch(() => {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);
    if (fixed)
      await Promise.race([
        emulation.wall(contents),
        new Promise((_r, no) =>
          setTimeout(() => no(new Error('the page could not be walled off')), 3000)
        ),
      ]); // no WebRTC for a shown file, or no picture
    if (preset)
      await Promise.race([
        emulation.emulate(contents, preset).catch(() => {}),
        new Promise(r => setTimeout(r, 3000)),
      ]);
    let failed = '';
    const loaded = new Promise(resolve => {
      contents.once('did-finish-load', () => resolve(true));
      contents.on('did-fail-load', (_e, code, text, _u, main) => {
        if (main && code !== -3) {
          failed = text || String(code);
          resolve(true);
        }
      });
      setTimeout(() => resolve(false), LOAD_MS);
    });
    contents.loadURL(url).catch(() => {});
    const done = await loaded;
    if (failed) throw new Error('the page did not load (' + failed + ')');

    // Web fonts and a first render after the load event.
    await Promise.race([
      contents
        .executeJavaScript('document.fonts ? document.fonts.ready.then(() => 1) : 1', true)
        .catch(() => 0),
      new Promise(r => setTimeout(r, 3000)),
    ]);
    await new Promise(r => setTimeout(r, SETTLE_MS));
    let image = await Promise.race([
      contents.capturePage(undefined, { stayHidden: true }),
      new Promise(r => setTimeout(() => r(null), CAPTURE_MS)),
    ]);
    if (!image) throw new Error('capturing the page timed out');
    if (image.isEmpty()) throw new Error('the page could not be captured');
    if (image.getSize().width > MAX_W) image = image.resize({ width: MAX_W, quality: 'good' });
    fs.mkdirSync(dir(), { recursive: true });
    prune();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(
      dir(),
      'shot-' + stamp + '-' + crypto.randomBytes(3).toString('hex') + '.png'
    );
    fs.writeFileSync(file, image.toPNG());
    const size = image.getSize();
    return { file, width: size.width, height: size.height, loading: !done };
  } finally {
    if (!win.isDestroyed()) win.destroy();
    busy = false;
  }
}

module.exports = { take, dir, prune };
