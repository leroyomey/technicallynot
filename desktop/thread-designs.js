// Technically Not desktop · thread-designs.js — the main-process half of the design cards in a
// thread's conversation (src/scripts/159-thread-designs.js): a page (.html) or a picture the
// agent wrote or showed, found from the conversation's own entries, drawn small in a card.
//
// - page(paneId, file): the page registered with the `tnai show` page server (show-file.js), so it
//   is cut off from the app and the network the same way, and a still picture of it taken once in
//   a hidden window (never shown, never focused, walled like `tnai shot preview`).
// - picture(paneId, file, { since, large }): a picture's bytes as a data address, small (a
//   thumbnail) or whole (Open large).
// - preview(paneId, file): the page in Live preview, through the same request `tnai show` sends.
//
// The window only names a panel and the path its conversation wrote; the file is resolved here
// against that panel's own folder and must be inside it, its worktree or the open project.
// `since` (ms): a picture made by a command counts only when the file changed at or after the
// command started, so a picture the command merely named is not taken for one it made.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAGE = /\.html?$/i;
const PICTURE = /\.(png|jpe?g|webp|gif|svg)$/i;
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// a picture is never read whole above this; a thumbnail of a kind the system cannot shrink is sent
// as it is only up to THUMB_RAW_MAX
const PICTURE_MAX = 25 * 1024 * 1024;
const THUMB_RAW_MAX = 3 * 1024 * 1024;
const THUMB_WIDTH = 480;

// a single picture shown at the conversation's whole width (159's card) asks for this width
const WIDE_WIDTH = 960;

// the still picture of a page: the size it is drawn at, and the width it is kept at
const SHOT_WIDTH = 1280;
const SHOT_HEIGHT = 800;
const SHOT_KEEP_WIDTH = 960;
const SHOT_LOAD_MS = 8000;
const SHOT_SETTLE_MS = 500;
const SHOTS_KEPT = 24;

// a file changed this long before the command's own start time still counts (clocks of the record
// and of the file system are not the same clock)
const SINCE_SLACK_MS = 3000;

let deps = {
  // paneId -> its saved session record ({ cwd, ... }) or null
  sessionOf: () => null,
  // paneId -> its own worktree ({ cwd }) or null
  worktreeOf: () => null,
  // the open project's folder
  projectRoot: () => '',
  // paneId -> the agent's name
  nameOf: () => '',
  // sends a push to the window
  toWindow: () => {},
  // the app's own folder of pictures the user pasted or dropped into a prompt
  attachmentsDir: () => {
    try {
      return require('path').join(require('electron').app.getPath('userData'), 'attachments');
    } catch {
      return '';
    }
  },
};

function init(dependencies) {
  deps = { ...deps, ...dependencies };
}

const low = value => (process.platform === 'win32' ? value.toLowerCase() : value);

// A network or device path is refused before anything touches it: resolving \\server\share signs in
// to that server.
const remote = value => /^[\\/]{2}/.test(value);

const realOf = value => {
  try {
    return fs.realpathSync.native(value);
  } catch {
    return '';
  }
};

const within = (file, root) => {
  const rel = path.relative(low(root), low(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};

// A folder too wide to stand for a project (a drive, the user's home folder) is never a root, so a
// session started there cannot show any file of the computer.
function wideFolder(folder) {
  const resolved = path.resolve(folder);
  if (path.parse(resolved).root === resolved) return true;
  return low(resolved) === low(path.resolve(os.homedir()));
}

// The folders a panel's files may come from: its session's folder, its worktree, the open project.
function rootsOf(paneId) {
  const session = deps.sessionOf(paneId);
  const list = [session?.cwd, deps.worktreeOf(paneId)?.cwd, deps.projectRoot()];
  return list.filter(
    folder =>
      typeof folder === 'string' &&
      path.isAbsolute(folder) &&
      !remote(folder) &&
      !wideFolder(folder)
  );
}

// The real path of a file the conversation named, or why it cannot be used. A relative name is
// taken from the session's own folder, the way the readers shortened it (thread-log-text.js).
function locate(paneId, file, kind) {
  const name = String(file || '').trim();
  if (!name || remote(name)) return { ok: false, error: 'no file' };
  if (!kind.test(name)) return { ok: false, error: 'not this kind of file' };
  const roots = rootsOf(paneId);
  if (!roots.length) return { ok: false, error: 'the thread has no folder' };

  // a picture the user attached to a prompt lives in the app's own attachments folder: shown as
  // a tile under the prompt (122), so pictures (and only pictures) may come from there too
  const attached = kind === PICTURE ? deps.attachmentsDir() : '';
  if (attached && path.isAbsolute(attached)) roots.push(attached);
  const full = path.isAbsolute(name) ? path.resolve(name) : path.resolve(roots[0], name);
  const real = realOf(full);
  if (!real || !kind.test(real)) return { ok: false, error: 'not found' };
  const root = roots.map(realOf).find(folder => folder && within(real, folder));
  if (!root) return { ok: false, error: 'outside the thread’s folders' };
  let stat = null;
  try {
    stat = fs.statSync(real);
  } catch {}
  if (!stat?.isFile()) return { ok: false, error: 'not found' };
  return { ok: true, real, root, roots, stat, name: path.basename(real) };
}

const changedSince = (stat, since) =>
  !Number(since) || stat.mtimeMs >= Number(since) - SINCE_SLACK_MS;

// ---------- the still picture of a page ----------
const shots = new Map();
let queue = Promise.resolve();

// One hidden window at a time, so a conversation with many pages never starts many renderers.
function shoot(url) {
  const run = queue.then(() => takeShot(url));
  queue = run.catch(() => null);
  return run;
}

async function takeShot(url) {
  const { BrowserWindow } = require('electron');
  const emulation = require('./preview-emulation');
  const window = new BrowserWindow({
    show: false,
    width: SHOT_WIDTH,
    height: SHOT_HEIGHT,
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
    const contents = window.webContents;
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));

    // a shown page never leaves its address
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-redirect', event => event.preventDefault());

    // WebRTC is taken away before the page's first script runs, as for `tnai shot preview`
    await contents.loadURL('about:blank').catch(() => {});
    await Promise.race([
      emulation.wall(contents),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('the page could not be walled off')), 3000)
      ),
    ]);
    const loaded = new Promise(resolve => {
      contents.once('did-finish-load', () => resolve(true));
      contents.once('did-fail-load', () => resolve(false));
      setTimeout(() => resolve(false), SHOT_LOAD_MS);
    });
    contents.loadURL(url).catch(() => {});
    await loaded;
    await new Promise(resolve => setTimeout(resolve, SHOT_SETTLE_MS));
    let image = await contents.capturePage(undefined, { stayHidden: true });
    if (!image || image.isEmpty()) throw new Error('the page could not be captured');
    if (image.getSize().width > SHOT_KEEP_WIDTH)
      image = image.resize({ width: SHOT_KEEP_WIDTH, quality: 'good' });
    const size = image.getSize();
    return {
      image: 'data:image/jpeg;base64,' + image.toJPEG(82).toString('base64'),
      width: size.width,
      height: size.height,
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

// `page(paneId, file)` → { ok, name, rel, url, refs, image, width, height } or { ok: false, error
// }. The still picture is kept per file and its change time, so a page drawn again costs nothing.
async function page(paneId, file, options = {}) {
  const at = locate(paneId, file, PAGE);
  if (!at.ok) return at;
  if (require('./preview-emulation').unwalled())
    return { ok: false, error: 'the page could not be walled off right now' };
  const made = await require('./show-file').add(at.real, at.root, at.roots);
  if (!made.ok) return made;
  const key = low(at.real) + '|' + at.stat.mtimeMs + '|' + at.stat.size;

  // shot: false asks only whether the page is there, without its picture
  let shot = options.shot === false ? {} : shots.get(key);
  if (!shot) {
    try {
      shot = await shoot(made.url);
    } catch (error) {
      shot = { image: '', error: error?.message || String(error) };
    }
    shots.set(key, shot);
    while (shots.size > SHOTS_KEPT) shots.delete(shots.keys().next().value);
  }
  return {
    ok: true,
    name: made.name,
    rel: made.rel,
    url: made.url,
    refs: made.refs,
    image: shot.image || '',
    width: shot.width || 0,
    height: shot.height || 0,
  };
}

// ---------- a picture ----------
// `picture(paneId, file, { since, large, wide, check })` → { ok, name, image, width, height }. A
// small one of a kind the system can shrink (PNG, JPEG) is shrunk to THUMB_WIDTH, or WIDE_WIDTH
// with `wide`; others are sent as they are.
async function picture(paneId, file, options = {}) {
  const at = locate(paneId, file, PICTURE);
  if (!at.ok) return at;
  if (!changedSince(at.stat, options.since))
    return { ok: false, error: 'not changed by this command' };
  if (at.stat.size > PICTURE_MAX) return { ok: false, error: 'the picture is over 25 MB' };

  // check: only whether the picture is there to show, without its bytes
  if (options.check) return { ok: true, name: at.name, image: '', width: 0, height: 0 };
  const kind = path.extname(at.real).slice(1).toLowerCase();
  const mime = MIME[kind] || 'application/octet-stream';
  if (!options.large && (kind === 'png' || kind === 'jpg' || kind === 'jpeg')) {
    const { nativeImage } = require('electron');
    let image = nativeImage.createFromPath(at.real);
    if (!image.isEmpty()) {
      const width = options.wide ? WIDE_WIDTH : THUMB_WIDTH;
      if (image.getSize().width > width) image = image.resize({ width, quality: 'good' });
      const size = image.getSize();
      return {
        ok: true,
        name: at.name,
        image: image.toDataURL(),
        width: size.width,
        height: size.height,
      };
    }
  }
  if (!options.large && at.stat.size > THUMB_RAW_MAX)
    return { ok: true, name: at.name, image: '', width: 0, height: 0 };
  const bytes = await fs.promises.readFile(at.real);
  return {
    ok: true,
    name: at.name,
    image: 'data:' + mime + ';base64,' + bytes.toString('base64'),
    width: 0,
    height: 0,
  };
}

// ---------- Live preview ----------
// The page goes down the same path as `tnai show` (agent-mesh.js preview → 31's showRequest): one
// tab per agent, kept out of the saved tabs, walled. The answer of the window is not waited for.
async function preview(paneId, file) {
  const made = await page(paneId, file, { shot: false });
  if (!made.ok) return made;
  const project = deps.projectRoot();
  deps.toWindow('preview:show', {
    id: 'design-' + Date.now().toString(36),
    url: made.url,
    device: '',
    project,
    by: String(deps.nameOf(paneId) || 'an agent').slice(0, 80),
    paneId: String(paneId),
    file: made.rel,
  });
  return { ok: true, url: made.url };
}

module.exports = { init, page, picture, preview, locate, rootsOf, PAGE, PICTURE };
