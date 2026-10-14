// Technically Not · script-guard.js — the app's window may run script files only from the app's
// own folders.
//
// Why: the window is a page opened from disk, and the page's own rule (`script-src 'self'` in
// index.html) counts EVERY file on the disk as "self". Agents write files into the project all
// day. If some part of the UI ever put text from an agent or a file into the page as HTML, that
// HTML could name a script file in the project, and it would run with the app's powers.
// No such slip is known; this is the second barrier. It is
// enforced here, in the main process, so nothing a page does can switch it off.
//
// What it does: a request for a script, a frame or a plug-in object over `file:` is let through
// only when the file is inside one of the app's code folders. Pictures, styles, fonts and media
// from disk are not touched (they cannot run code), and neither is anything over http.
const path = require('path');
const { fileURLToPath } = require('url');

// The folders, under the app's root, that hold code the window loads: the UI (`src`), the small
// pages of the snapshot tools (`desktop`) and the terminal library (`node_modules`).
const CODE_FOLDERS = ['src', 'desktop', 'node_modules'];

// Kinds of request that can run code or bring in a page that does.
const GUARDED = new Set(['script', 'subFrame', 'object']);

// Kinds that cannot run code whatever the file is: they are never judged.
const HARMLESS = new Set([
  'mainFrame',
  'stylesheet',
  'image',
  'font',
  'media',
  'ping',
  'cspReport',
]);

// Every other kind ("other", "xhr", and any kind a later Electron adds) is judged by the file's
// name. Electron does not promise that the file of a worker, a module worker or an import()
// arrives as "script"; one that arrives as "other" would otherwise pass. So a file that is code by
// its name must be inside the code folders whatever kind the request is called.
const CODE_FILE = /\.(js|mjs|cjs|wasm)$/i;

// On Windows, C:\App and c:\app are the same folder.
const sameCase = text => (process.platform === 'win32' ? text.toLowerCase() : text);

// Is `file` inside `folder`? Compared as resolved paths, so "..", doubled slashes and the like do
// not get around it.
function inside(file, folder) {
  const parent = sameCase(path.resolve(folder)) + path.sep;
  return sameCase(path.resolve(file)).startsWith(parent);
}

// May this request go ahead? `appRoot` is the folder that holds index.html (in an installed app,
// the app.asar archive).
function mayLoad(urlText, resourceType, appRoot) {
  if (HARMLESS.has(resourceType)) return true;
  let url;
  try {
    url = new URL(urlText);
  } catch {
    return false;
  }
  if (url.protocol !== 'file:') return true;

  // The window's own page is a mainFrame request and is not judged here; a frame over file: is
  // allowed only for the app's own small pages.
  let file;
  try {
    file = fileURLToPath(url);
  } catch {
    return false;
  }

  // a kind that is not known to run code, asking for a file that is not code by its name
  if (!GUARDED.has(resourceType) && !CODE_FILE.test(file)) return true;
  return CODE_FOLDERS.some(folder => inside(file, path.join(appRoot, folder)));
}

// Puts the guard on a session. One listener per session: Electron keeps only the last one given.
function guard(session, appRoot) {
  session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, callback) => {
    callback({ cancel: !mayLoad(details.url, details.resourceType, appRoot) });
  });
}

module.exports = { guard, mayLoad, CODE_FOLDERS };
