// Technically Not desktop · attachment-service.js — Composer attachments (uploaded or pasted
// images/files) saved in Technically Not's own folder, never the project:
// userData/attachments/<yyyy-mm-dd>/<id>-<name>. Agents get the absolute path; Claude Code sessions
// get this folder through --add-dir (agent-hooks.js). Files older than 30 days are pruned at start
// and, in an app that stays open, once a day at the next save, paste or snapshot (no timer).
// Snapshot clips that were never pasted in the app are deleted once the clipboard no longer names
// them (hold / used / sweep below; the list is userData/unused-clips.json).
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { app, clipboard, nativeImage, shell } = require('electron');

const MAX_BYTES = 20 * 1024 * 1024;
const KEEP_DAYS = 30,
  DAY = 86400000;
const ALLOWED =
  /\.(png|jpe?g|gif|webp|pdf|txt|md|markdown|json|csv|tsv|log|xml|ya?ml|toml|ini|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|cs|cpp|cc|c|h|hpp|php|sh|ps1|bat|sql|swift|vue|svelte)$/i;

const dir = () => path.join(app.getPath('userData'), 'attachments');

// Saves one attachment and returns its absolute path. The name is reduced to a safe file name; the
// result must stay inside dir().
function save(name, bytes) {
  const base =
    String(name || 'attachment')
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/^[.\s]+/, '')
      .slice(-80) || 'attachment';
  if (!ALLOWED.test(base)) throw new Error('This file type cannot be attached: ' + base);
  const data = Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes || []);
  if (!data.length) throw new Error('The file is empty: ' + base);
  if (data.length > MAX_BYTES) throw new Error(base + ' is larger than 20 MB.');
  const now = new Date(),
    day =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');
  const folder = path.join(dir(), day);
  const file = path.join(
    folder,
    crypto.randomBytes(4).toString('hex') + '-' + base.replace(/\s+/g, '-')
  );
  if (path.relative(dir(), file).startsWith('..') || path.isAbsolute(path.relative(dir(), file)))
    throw new Error('Invalid attachment name.');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, data);
  try {
    sweep();
  } catch {}
  return file;
}

// A picture or text file that came with a prompt from another computer (remote-files.js checked
// it). `kind` is one of three words this app chose. The folder, the
// name and the extension are made here: nothing of them comes from the other computer. The file is
// never opened, decoded or run here. Kept REMOTE_KEEP_DAYS, then pruned with the rest.
const REMOTE_EXT = { png: 'png', jpg: 'jpg', txt: 'txt' },
  REMOTE_KEEP_DAYS = 7,
  REMOTE_MAX = 150 * 1024;
const REMOTE_NAME = /^[0-9a-f]{8}-from-another-computer\.(?:png|jpg|txt)$/;

function saveRemote(kind, bytes) {
  const ext = typeof kind === 'string' && Object.hasOwn(REMOTE_EXT, kind) ? REMOTE_EXT[kind] : '';
  if (!ext || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > REMOTE_MAX)
    throw new Error('This file cannot be saved.');
  const now = new Date(),
    day =
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0');
  const folder = path.join(dir(), day),
    name = crypto.randomBytes(4).toString('hex') + '-from-another-computer.' + ext,
    file = path.join(folder, name);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(file, bytes, { flag: 'wx' }); // never over a file that is already there
  pruneDaily();
  return { path: file, name };
}

// Only a file saveRemote made, in a day folder of dir(): the path is this computer's own, and it is
// checked all the same.
const isRemote = file =>
  typeof file === 'string' &&
  path.dirname(path.dirname(file)) === dir() &&
  REMOTE_NAME.test(path.basename(file));

function removeRemote(file) {
  if (!isRemote(file)) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

// "Show in folder" (the control list on Devices) for one of them, by its name alone: looked for in
// the day folders, newest first.
function showRemote(name) {
  if (typeof name !== 'string' || !REMOTE_NAME.test(name)) return false;
  let days = [];
  try {
    days = fs
      .readdirSync(dir(), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
  } catch {
    return false;
  }
  for (const day of days) {
    const file = path.join(dir(), day, name);
    if (fs.existsSync(file)) {
      shell.showItemInFolder(file);
      return true;
    }
  }
  return false;
}

// Deletes every attachment older than KEEP_DAYS and each day folder left empty. A file that cannot
// be deleted now (in use) is tried again at the next run.
let pruned = 0;

async function prune() {
  pruned = Date.now();
  const cutoff = pruned - KEEP_DAYS * DAY;
  let days = [];
  try {
    days = (await fsp.readdir(dir(), { withFileTypes: true })).filter(d => d.isDirectory());
  } catch {
    return;
  }
  for (const day of days) {
    const folder = path.join(dir(), day.name);
    let names;
    try {
      names = await fsp.readdir(folder);
    } catch {
      continue;
    } // one unreadable day folder is skipped, not fatal
    for (const name of names) {
      const file = path.join(folder, name);
      try {
        if (
          (await fsp.stat(file)).mtimeMs <
          (REMOTE_NAME.test(name) ? pruned - REMOTE_KEEP_DAYS * DAY : cutoff)
        )
          await fsp.unlink(file);
      } catch {} // a file from another computer goes after 7 days
    }
    try {
      await fsp.rmdir(folder);
    } catch {} // only an empty folder goes
  }
}

// An app that is never restarted still prunes: at most once a day, at the next save, paste or
// snapshot.
const pruneDaily = () => {
  if (Date.now() - pruned > DAY) prune().catch(() => {});
};

// Clips nobody used. A snapshot clip is written to disk the moment it ends (snapshot-clip.js),
// pasted or not. Until it is pasted in the app (composer, terminal panel or any text box: `used`),
// it is on this list, and it is deleted at the next natural moment (a snapshot, a paste, a save,
// app start, app quit: `sweep`) once the clipboard no longer names it. A clip pasted in the app
// leaves the list and is kept like any attachment. Entries: [video, ...frames], absolute paths;
// only clip files inside dir() are ever accepted, so a changed list file deletes nothing else.
const CLIP = /-clip(?:-\d+)?\.(?:webm|png)$/i;
const listFile = () => path.join(app.getPath('userData'), 'unused-clips.json');
const inside = file => {
  const rel = typeof file === 'string' ? path.relative(dir(), file) : '..';
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel) && CLIP.test(file);
};
let held = null;
const going = new Set(); // clips being deleted right now
let deleting = Promise.resolve();

function load() {
  if (held) return held;
  held = new Map();
  try {
    for (const files of JSON.parse(fs.readFileSync(listFile(), 'utf8')))
      if (Array.isArray(files) && files.length && files.length <= 16 && files.every(inside))
        held.set(files[0], files);
  } catch {}
  return held;
}
let writing = Promise.resolve();

function write(sync) {
  const file = listFile(),
    tmp = file + '.tmp',
    text = () => JSON.stringify([...held.values()]);
  if (sync) {
    try {
      if (held.size) {
        fs.writeFileSync(tmp, text());
        fs.renameSync(tmp, file);
      } else fs.rmSync(file, { force: true });
    } catch {}
    return;
  }

  // One write in flight; each writes the list as it is when its turn comes, so a late write is
  // never an older list.
  writing = writing
    .then(async () => {
      if (held.size) {
        await fsp.writeFile(tmp, text());
        await fsp.rename(tmp, file);
      } else await fsp.rm(file, { force: true });
    })
    .catch(() => {});
}

async function remove(files) {
  let all = true;
  for (const file of files)
    try {
      await fsp.rm(file, { force: true });
    } catch {
      all = false;
    }
  return all;
}

// What the clipboard names now: its text, and on Windows the first copied file. Electron's
// clipboard answers with a promise (learned 2026-10-08: read without waiting, the text was "[object
// Promise]", which names no clip, so every clip was deleted at the sweep right after it was
// recorded).
async function onClipboard() {
  let text = await clipboard.readText();
  if (typeof text !== 'string') throw new Error('the clipboard text could not be read');
  if (process.platform === 'win32')
    try {
      const names = await clipboard.readBuffer?.('FileNameW');
      if (Buffer.isBuffer(names)) text += '\n' + names.toString('utf16le');
    } catch {}
  return text;
}

// A new clip: [video, ...frames]. Unused until `used` hears of it.
function hold(files) {
  if (!Array.isArray(files) || !files.length || !files.every(inside)) return;
  load().set(files[0], files);
  write();
}

// Text pasted in the app (or the names of pasted files): every held clip it names is in use from
// now on and is kept. Then the others are looked at.
function used(text) {
  text = String(text || '');
  let changed = false;
  if (text)
    for (const video of [...load().keys()])
      if (text.includes(video) || text.includes(path.basename(video))) {
        held.delete(video);
        changed = true;
      }
  if (changed) write();
  sweep();
}

// Deletes every held clip the clipboard no longer names. sync: at quit. read: the clipboard's
// content (checks pass their own). A clipboard that cannot be read deletes nothing; a clip whose
// files could not all be deleted stays on the list for the next time. The clipboard's content is
// waited for. At quit there is no time to wait: an answer that is not there yet deletes nothing,
// and the next start looks again.
function sweep(sync = false, read = onClipboard) {
  if (!sync) pruneDaily();
  if (!load().size) return;
  let text;
  try {
    text = read();
  } catch {
    return;
  }

  // a clip recorded while the clipboard is being read is not judged by what was on it before
  const asked = new Set(held.keys());
  if (sync) {
    if (typeof text === 'string') drop(text, true, asked);
    return;
  }
  deleting = Promise.all([
    deleting,
    Promise.resolve(text).then(
      now => (typeof now === 'string' ? drop(now, false, asked) : null),
      () => {}
    ),
  ]);
}

// Deletes every held clip in `asked` that `text` (the clipboard's content) does not name. Resolves
// when its deletes are done.
function drop(text, sync, asked) {
  let changed = false;
  const gone = [];
  for (const [video, files] of [...load()]) {
    if (!asked.has(video) || text.includes(video) || going.has(video)) continue;
    if (sync) {
      let all = true;
      for (const file of files)
        try {
          fs.rmSync(file, { force: true });
        } catch {
          all = false;
        }
      if (all) {
        held.delete(video);
        changed = true;
      }
      continue;
    }
    going.add(video);
    gone.push(
      remove(files).then(all => {
        going.delete(video);
        if (all && held.delete(video)) write();
      })
    );
  }
  if (changed) write(sync);
  return Promise.all(gone);
}

// A clip that could not be handed to the clipboard: its files go at once.
function discard(video) {
  const files = load().get(video);
  if (!files) return Promise.resolve(false);
  held.delete(video);
  write();
  return remove(files);
}

// A snapshot clip named in `text` by one of its files ("<8 hex>-clip.webm", "<8 hex>-clip-3.png"; a
// whole path or line is fine): where its video and frames are, newest day folder first, and its
// first frame as a file: address for a picture in the app (27 chip, 113 preview). null when it is
// not on disk.
const CLIP_ID = /([0-9a-f]{8})-clip(?:-[0-9]+)?[.](?:webm|png)/;

async function clip(text) {
  const id = CLIP_ID.exec(String(text || ''))?.[1];
  if (!id) return null;
  let days;
  try {
    days = (await fsp.readdir(dir(), { withFileTypes: true }))
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const day of days) {
    const folder = path.join(dir(), day),
      video = path.join(folder, id + '-clip.webm');
    try {
      await fsp.access(video);
    } catch {
      continue;
    }
    const n = name => Number(name.slice(id.length + 6, -4));
    const frames = (await fsp.readdir(folder))
      .filter(name => name.startsWith(id + '-clip-') && name.endsWith('.png') && n(name) > 0)
      .sort((a, b) => n(a) - n(b))
      .map(name => path.join(folder, name));
    return { id, video, frames, still: frames[0] ? pathToFileURL(frames[0]).href : '' };
  }
  return null;
}

// Plays a clip in the view-only file window (file-viewer.js), sized to the clip: at most 720 by 480
// of content, never under 320 by 200.
async function play(text) {
  const found = await clip(text);
  if (!found) return { ok: false, error: { message: 'This clip is no longer on this PC.' } };
  let size = { width: 720, height: 405 };
  try {
    const s = found.frames[0] && nativeImage.createFromPath(found.frames[0]).getSize();
    if (s?.width && s.height) {
      const k = Math.min(1, 720 / s.width, 480 / s.height);
      size = { width: Math.max(320, s.width * k), height: Math.max(200, s.height * k) };
    }
  } catch {}
  const shown = await require('./file-viewer').show(found.video, false, size);

  // A video counts as loading for as long as it plays, so a window closed meanwhile ends the load
  // with an error: the file was there a moment ago, that is no failure to tell the user.
  return !shown.ok && /ERR_(?:ABORTED|FAILED)/.test(shown.error?.message || '')
    ? { ok: true, value: true }
    : shown;
}

app.whenReady().then(() => {
  prune().catch(() => {});
  try {
    sweep();
  } catch {}
});
app.on('will-quit', () => {
  try {
    sweep(true);
  } catch {}
});

module.exports = {
  dir,
  save,
  saveRemote,
  removeRemote,
  showRemote,
  prune,
  clip,
  play,
  hold,
  used,
  sweep,
  discard,
  settled: () => deleting.then(() => writing),
};
