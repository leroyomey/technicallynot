// Technically Not desktop · file-viewer.js — View-only files (too large or not editable in 09)
// opened outside the editor: in their own window, or with the PC's default app. The window has no
// OS title bar: a small bar page on top (file name + Technically Not's
// window buttons, like the main window's, 66) and the file below it in its own view with the
// viewer's locked-down settings.
'use strict';
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow, WebContentsView, session, net, shell, protocol } = require('electron');

// Standard + stream so Chromium's PDF viewer and video seeking work on it. Must run before app
// ready (this module is required at startup).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'tnai-view',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true },
  },
]);

// Shown by Chromium itself. Everything else is shown as plain text (never rendered: an .html file
// is displayed as source).
const MEDIA = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'avif',
  'svg',
  'pdf',
  'mp4',
  'webm',
  'ogg',
  'ogv',
  'mp3',
  'wav',
  'm4a',
  'flac',
]);

// above this a text window would stall; use the default app instead
const TEXT_MAX = 64 * 1024 * 1024;

// Opening these with the default app would run them, so they are only shown in Explorer.
const RUNNABLE = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'msi',
  'msp',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'scr',
  'pif',
  'lnk',
  'url',
  'reg',
  'hta',
  'cpl',
  'jar',
  'msc',
  'appx',
  'msix',
  'appref-ms',
  'application',
  'inf',
  'scf',
  'sys',
  'dll',
  // Windows runs these by file association too, even though they aren't native executables.
  'py',
  'pyw',
  'pyc',
  'pyz',
  'chm',
  'wsc',
  'sct',
  'settingcontent-ms',
  'library-ms',
  'search-ms',
  'website',
  'xll',
  'gadget',
  'diagcab',
  'msh',
  'msh1',
  'msh2',
  'msh1xml',
  'msh2xml',
  'ps1xml',
  'ps2',
  'ps2xml',
  'psc1',
  'psc2',
  'jnlp',
  'iso',
  'img',
  'vhd',
  'vhdx',
  'rdp',
  'appinstaller',
  'msu',
]);

// mac/Linux: their own launchable types (shown in Finder or the file manager instead).
if (process.platform !== 'win32')
  for (const e of [
    'app',
    'command',
    'tool',
    'sh',
    'bash',
    'zsh',
    'pkg',
    'mpkg',
    'dmg',
    'workflow',
    'terminal',
    'desktop',
    'appimage',
    'run',
    'deb',
    'rpm',
    'bin',
    'so',
    'dylib',
  ])
    RUNNABLE.add(e);
const ext = file =>
  path
    .extname(path.basename(file).replace(/[. ]+$/, ''))
    .slice(1)
    .toLowerCase(); // Windows drops trailing dots/spaces: 'x.exe. ' is x.exe

// The viewer window's own top row. Its buttons report by setting the page title
// (TNAI_CTL:<action>), which main catches; no preload. The bar page fills the whole window and the
// file's view lies over everything below BAR_H, so the row is BAR_H tall, never the page's height
// (2026-10-07: at 100% the name and the buttons were centered in the window, under the file, and
// the window could not be closed).
const BAR_H = 32,
  frameless = process.platform !== 'darwin';
const esc = text =>
  String(text ?? '').replace(
    /[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
const MAX = '<rect x=".5" y=".5" width="9" height="9"/>',
  RESTORE = '<rect x=".5" y="2.5" width="7" height="7"/><path d="M2.5 2.5v-2h7v7h-2"/>';
const barPage = title => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>
html,body{margin:0;overflow:hidden}body{height:${BAR_H}px;display:flex;align-items:center;box-sizing:border-box;padding-left:14px;border-bottom:1px solid #eceee8;background:#fff;-webkit-app-region:drag;user-select:none;font:11px Arial;color:#6d7069}
span{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}div{display:flex;gap:2px;margin-right:4px;-webkit-app-region:no-drag}
button{display:grid;place-items:center;width:40px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:#6d7069;cursor:default}button:hover{background:#f1f2ed;color:#20211f}button:active{background:#e9eae4}
button.close:hover{background:#bd6b5f;color:#fff}button.close:active{background:#9a4a3e;color:#fff}button:focus-visible{outline:2px solid #a7bd81;outline-offset:-2px}svg{width:10px;height:10px;fill:none;stroke:currentColor;stroke-width:1}</style>
<span title="${esc(title)}">${esc(title)}</span><div><button data-act="minimize" aria-label="Minimize" title="Minimize"><svg viewBox="0 0 10 10"><path d="M0 5.5h10"/></svg></button><button data-act="maximize" id="max" aria-label="Maximize" title="Maximize"><svg viewBox="0 0 10 10">${MAX}</svg></button><button class="close" data-act="close" aria-label="Close" title="Close"><svg viewBox="0 0 10 10"><path d="M.5.5l9 9M9.5.5l-9 9"/></svg></button></div>
<script>let n=0;document.querySelectorAll('button').forEach(b=>b.onclick=()=>{document.title='TNAI_CTL:'+b.dataset.act+':'+(++n)});
document.querySelector('div').ondblclick=e=>e.stopPropagation();
window.tnaiMax=on=>{const m=document.getElementById('max');m.firstChild.innerHTML=on?'${RESTORE.replace(/'/g, "\'")}':'${MAX}';m.title=on?'Restore':'Maximize';m.setAttribute('aria-label',m.title)};</script>`;

let resolve = () => {
  throw new Error('No project folder is connected.');
};
const served = new Map(); // tnai-view://<token>/ → { full, text }
let viewSession = null;

function viewer() {
  if (viewSession) return viewSession;

  // in memory, separate from Technically Not's own session
  viewSession = session.fromPartition('tnai-file-viewer');
  viewSession.protocol.handle('tnai-view', async request => {
    const entry = served.get(new URL(request.url).hostname);
    if (!entry) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(entry.full).href, { headers: request.headers });
    if (!entry.text) return response;
    return new Response(response.body, {
      status: response.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  });
  viewSession.on('will-download', event => event.preventDefault());
  viewSession.setPermissionRequestHandler((_wc, _permission, done) => done(false));
  return viewSession;
}

const popout = (rel, asText, lane) => show(resolve(rel, lane), asText);

// full: an absolute path the caller has checked (a project file from popout, a snapshot clip from
// attachment-service.js). size: { width, height } of the content for a small window.
async function show(full, asText, size) {
  const stat = await fs.stat(full);
  if (!stat.isFile()) throw new Error('Not a file.');
  const media = MEDIA.has(ext(full));
  if (!media && !asText)
    throw Object.assign(
      new Error('Technically Not cannot show this kind of file. Open it on this PC instead.'),
      { code: 'NotSupported' }
    );
  if (!media && stat.size > TEXT_MAX)
    throw Object.assign(
      new Error('This file is too large to show in a window. Open it on this PC instead.'),
      { code: 'TooLarge' }
    );
  const token = Math.random().toString(36).slice(2, 12);
  served.set(token, { full, text: !media });
  const title = path.basename(full) + ' — Technically Not (view only)';
  const locked = {
    session: viewer(),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    plugins: ext(full) === 'pdf',
  };
  const win = new BrowserWindow({
    width: Math.round(size?.width || 1100),
    height: Math.round(size?.height ? size.height + (frameless ? BAR_H : 0) : 780),
    title,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    ...(frameless
      ? {
          titleBarStyle: 'hidden',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        }
      : { webPreferences: locked }),
  });
  let content = win.webContents;
  if (frameless) {
    const view = new WebContentsView({ webPreferences: locked });
    win.contentView.addChildView(view);
    const place = () => {
      const [w, h] = win.getContentSize();
      view.setBounds({ x: 0, y: BAR_H, width: w, height: Math.max(0, h - BAR_H) });
    };
    win.on('resize', place);
    place();
    content = view.webContents;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('page-title-updated', (event, text) => {
      const act = /^TNAI_CTL:(\w+)/.exec(text)?.[1];
      if (!act) return;
      event.preventDefault();
      if (act === 'minimize') win.minimize();
      else if (act === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (act === 'close') win.close();
    });
    const paintMax = () => {
      if (!win.isDestroyed())
        win.webContents.executeJavaScript('tnaiMax(' + win.isMaximized() + ')').catch(() => {});
    };
    win.on('maximize', paintMax);
    win.on('unmaximize', paintMax);
    win.on('closed', () => {
      try {
        view.webContents.close();
      } catch {}
    });
    win
      .loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(barPage(title)))
      .catch(() => {});
  }
  content.setWindowOpenHandler(() => ({ action: 'deny' }));
  content.on('will-navigate', event => event.preventDefault());
  win.on('closed', () => served.delete(token));
  await content.loadURL('tnai-view://' + token + '/' + encodeURIComponent(path.basename(full)));
  return true;
}

async function openOnPc(rel, lane) {
  const full = resolve(rel, lane);
  if (!(await fs.stat(full)).isFile()) throw new Error('Not a file.');
  if (RUNNABLE.has(ext(full))) {
    shell.showItemInFolder(full);
    return 'shown';
  }
  const error = await shell.openPath(full);
  if (error) throw new Error(error);
  return 'opened';
}

const wrap =
  fn =>
  async (...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (error) {
      return { ok: false, error: { name: error.code || 'Error', message: error.message } };
    }
  };
module.exports = {
  init: resolver => {
    resolve = resolver;
  },
  popout: wrap(popout),
  show: wrap(show),
  openOnPc: wrap(openOnPc),
  isMedia: file => MEDIA.has(ext(file)),
};
