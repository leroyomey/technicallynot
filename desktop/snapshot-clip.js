// Technically Not desktop · snapshot-clip.js — Short screen clips from the snapshot overlay
// (snapshot-service.js, C in the overlay): a hidden window (snapshot-recorder.html) records the
// chosen area of one display frame by frame at up to 60 frames a second (each picture the screen
// capture delivers is recorded once; 10 a second on a timer until 2026-10-06), longest side 1280
// px, for at most 30 s, while a camera-style frame (snapshot-frame.html: corner brackets, REC,
// timer, Stop) shows around the area. The frame is never in the clip: it is drawn outside the area,
// and its window is hidden from screen capture (setContentProtection; on Linux only the first
// holds). Stop: the frame's Stop button, the snapshot key (snapshot-service.js) or the time limit.
// The clip is saved in the attachments folder as <id>-clip.webm plus up to 8 PNG frames in order
// (agents read pictures, not video); start() resolves { saved, text, video, frames, ms } or {
// cancelled, error }.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
  session: sessions,
} = require('electron');
const attachments = require('./attachment-service');

// 60 frames a second since 2026-10-06, so that a clip plays smoothly (it was
// 10 a second, drawn on a timer). The recorder takes each frame the screen delivers and records
// exactly that one, so a still screen costs nothing and motion is never doubled or skipped by us.
// BITS: enough for 60 a second at 1280 px, and 30 s of it stays under MAX_VIDEO.
const MAX_MS = 30000,
  FPS = 60,
  MAX_SIDE = 1280,
  MAX_FRAMES = 8,
  BITS = 12000000;
const MAX_VIDEO = 64 * 1024 * 1024,
  MAX_FRAME = 20 * 1024 * 1024;
const MARGIN = 44; // room around the area for the frame's brackets and badge, in screen px
let job = null; // the running clip: { recorder, frame, finish, watchdog }

const from = (event, win) =>
  !!job && !!win && !win.isDestroyed() && event.sender === win.webContents;
const bytes = (data, max) =>
  (Buffer.isBuffer(data) || data instanceof Uint8Array) && data.length > 0 && data.length <= max
    ? Buffer.from(data)
    : null;

let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  ipcMain.on('clip:started', event => {
    if (from(event, job?.recorder) && job.frame && !job.frame.isDestroyed())
      job.frame.webContents.send('clip:recording');
  });
  ipcMain.on('clip:done', (event, out) => {
    if (from(event, job?.recorder)) job.finish(out);
  });
  ipcMain.on('clip:stop', event => {
    if (from(event, job?.frame)) stop();
  });

  // The frame lets the mouse through to whatever is under it, except while the pointer is on its
  // Stop button.
  ipcMain.on('clip:hover', (event, over) => {
    if (from(event, job?.frame)) job.frame.setIgnoreMouseEvents(!over, { forward: true });
  });

  // The recorder's own in-memory session: screen capture for that page only, nothing else.
  const own = sessions.fromPartition('tnai-clip');
  own.setPermissionRequestHandler((contents, permission, callback) =>
    callback(permission === 'media' && !!job && contents === job.recorder?.webContents)
  );
  own.setPermissionCheckHandler(
    (contents, permission) =>
      permission === 'media' && !!job && contents === job.recorder?.webContents
  );
}

const stamp = () => {
  const now = new Date();
  return (
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0')
  );
};

// Writes the clip and its frames next to each other in today's attachments folder; returns their
// paths.
function save(out) {
  const video = bytes(out?.webm, MAX_VIDEO),
    frames = (Array.isArray(out?.frames) ? out.frames : [])
      .slice(0, MAX_FRAMES)
      .map(f => bytes(f, MAX_FRAME));
  if (!video || !frames.length || frames.some(f => !f || nativeImage.createFromBuffer(f).isEmpty()))
    throw new Error('the recording came back empty');
  const folder = path.join(attachments.dir(), stamp()),
    id = crypto.randomBytes(4).toString('hex');
  fs.mkdirSync(folder, { recursive: true });
  const file = name => path.join(folder, id + '-clip' + name);
  const names = ['.webm', ...frames.map((_f, i) => '-' + (i + 1) + '.png')];
  try {
    [video, ...frames].forEach((data, i) => fs.writeFileSync(file(names[i]), data));
  } catch (error) {
    for (const name of names)
      try {
        fs.rmSync(file(name), { force: true });
      } catch {}
    throw error;
  } // a clip that could not be written whole leaves no part of itself behind
  return { video: file('.webm'), frames: frames.map((_f, i) => file('-' + (i + 1) + '.png')) };
}

// region: the area in capture pixels of `display` ({ x, y, width, height }, as snapshot-service's
// area()).
async function start(display, region, accent = 'purple') {
  if (job) return { cancelled: true, busy: true };
  wire();
  const sf = display.scaleFactor || 1;
  job = { recorder: null, frame: null, finish: () => {}, watchdog: null };
  const mine = job;
  let source;
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const index = screen.getAllDisplays().findIndex(d => d.id === display.id);
    source =
      sources.find(s => String(s.display_id) === String(display.id)) ||
      (sources.length === 1 ? sources[0] : sources[index]);
  } catch {}
  if (job !== mine) return { cancelled: true };
  if (!source) {
    job = null;
    return { cancelled: true, error: 'screen capture unavailable' };
  }

  // The area on screen, and the frame window around it (kept on that display).
  const area = {
    x: display.bounds.x + region.x / sf,
    y: display.bounds.y + region.y / sf,
    width: region.width / sf,
    height: region.height / sf,
  };
  const b = display.bounds,
    left = Math.max(b.x, Math.floor(area.x - MARGIN)),
    top = Math.max(b.y, Math.floor(area.y - MARGIN));
  const right = Math.min(b.x + b.width, Math.ceil(area.x + area.width + MARGIN)),
    bottom = Math.min(b.y + b.height, Math.ceil(area.y + area.height + MARGIN));
  const frame = new BrowserWindow({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    title: 'Technically Not clip frame',
    webPreferences: {
      preload: path.join(__dirname, 'snapshot-clip-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  frame.setContentProtection(true); // left out of screen capture, so also out of the clip
  frame.setAlwaysOnTop(true, 'screen-saver');
  frame.setIgnoreMouseEvents(true, { forward: true });
  const recorder = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    skipTaskbar: true,
    focusable: false,
    title: 'Technically Not clip recorder',
    webPreferences: {
      preload: path.join(__dirname, 'snapshot-clip-preload.js'),
      partition: 'tnai-clip',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  for (const win of [frame, recorder]) {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
  }
  Object.assign(job, { recorder, frame });

  const scale = Math.min(1, MAX_SIDE / Math.max(region.width, region.height));
  const done = new Promise(resolve => {
    job.finish = out => {
      if (job !== mine) return;
      job = null;
      clearTimeout(mine.watchdog);
      for (const win of [frame, recorder]) if (!win.isDestroyed()) win.destroy();
      let result = {
        cancelled: true,
        error: out?.error ? String(out.error).slice(0, 200) : undefined,
      };
      if (out && !out.error) {
        try {
          const files = save(out),
            ms = Math.max(0, Math.min(MAX_MS + 2000, Number(out.ms) || 0)),
            seconds = Math.max(1, Math.round(ms / 1000));
          const frames =
            files.frames.length === 1
              ? files.frames[0]
              : files.frames[0] + ' to ' + path.basename(files.frames[files.frames.length - 1]);
          const st =
            out.stats && typeof out.stats === 'object'
              ? {
                  captured: Number(out.stats.captured) || 0,
                  longestMs: Number(out.stats.longestMs) || 0,
                  late: Number(out.stats.late) || 0,
                  codec: String(out.stats.codec || '').slice(0, 40),
                  exact: out.exact === true,
                }
              : // what the recorder counted: frames taken from the screen and the longest wait

                // between two (desktop test clip-smooth)
                null;
          result = {
            saved: true,
            ms,
            stats: st,
            ...files,
            text:
              '[Attached clip: ' +
              seconds +
              ' s of screen recording as ' +
              files.frames.length +
              (files.frames.length === 1 ? ' frame, ' : ' frames in order, ') +
              frames +
              '; video ' +
              files.video +
              ']',
          };
        } catch (error) {
          result = { cancelled: true, error: error.message };
        }
      }
      resolve(result);
    };
  });

  // Last resort: a recorder that never answers ends the clip instead of leaving the frame on
  // screen.
  job.watchdog = setTimeout(
    () => mine.finish({ error: 'the recorder did not answer' }),
    MAX_MS + 10000
  );
  for (const win of [frame, recorder])
    win.on('closed', () => mine.finish({ error: 'the clip window closed' }));
  recorder.webContents.on('render-process-gone', () =>
    mine.finish({ error: 'the recorder stopped' })
  );

  frame.webContents.once('did-finish-load', () => {
    if (frame.isDestroyed()) return;
    frame.webContents.send('clip:frame', {
      left: area.x - left,
      top: area.y - top,
      width: area.width,
      height: area.height,
      maxMs: MAX_MS,
    });
    frame.showInactive();
  });
  recorder.webContents.once('did-finish-load', () => {
    if (recorder.isDestroyed()) return;
    recorder.webContents.send('clip:record', {
      sourceId: source.id,
      region,
      fps: FPS,
      bits: BITS,
      maxMs: MAX_MS,
      maxFrames: MAX_FRAMES,
      screen: {
        width: Math.round(display.size.width * sf),
        height: Math.round(display.size.height * sf),
      },
      width: Math.max(2, Math.round((region.width * scale) / 2) * 2),
      height: Math.max(2, Math.round((region.height * scale) / 2) * 2),
    });
  });
  frame.loadFile(path.join(__dirname, 'snapshot-frame.html'), { query: { accent } });
  recorder.loadFile(path.join(__dirname, 'snapshot-recorder.html'));
  return done;
}

// Ends the running clip and keeps it; the recorder answers with the video and frames.
function stop() {
  if (!job?.recorder || job.recorder.isDestroyed()) return false;
  job.recorder.webContents.send('clip:finish');
  return true;
}

module.exports = {
  start,
  stop,
  save,
  active: () => !!job,
  frame: () => job?.frame || null,
  MAX_MS,
  FPS,
};
