/*
 * Technically Not desktop · show-file.js — `tnai show FILE.html` (agent-mesh.js): one local HTML
 * file in Live preview without a dev server, so an agent can answer with a chart, a table or a
 * mock-up. The page is untrusted (an agent wrote it, maybe from text it was fed), so it is cut off
 * from the app and the network. A small server on 127.0.0.1 (a port the system picks, started on
 * the first show) serves exactly /s/<token>/<file name> per shown file and nothing else; the
 * address then goes down the same path as `tnai preview` (31's iframe, `tnai shot preview`). The
 * wall is the response's Content-Security-Policy: `sandbox` without allow-same-origin (an origin of
 * its own: no cookies or storage, no pop-ups, no downloads, no top navigation), no request of any
 * kind (default-src 'none': scripts and styles only inline, pictures and fonts only as data:), no
 * form posts, no WebRTC. main.js adds two things: the page never navigates its own frame
 * (guardFrames), and the server answers only requests that carry this run's key (X-TNAI-Show, added
 * in onBeforeSendHeaders), so the address is useless in a browser or to another program. Links do
 * not open: a link is the one way the page's content could leave.
 * Neighbor files (decided 2026-10-09): none are served and nothing is embedded; the page must hold
 * everything itself. A reference such as <img src="../.env"> would otherwise put another file's
 * bytes where the page's script can read them. `refs` names what will not load. The file is read
 * again on every request (a saved change shows on reload) and checked again each time: a regular
 * .html/.htm file, at most 5 MB, whose real path is inside the project folder or the calling
 * panel's own worktree. Tokens live until the app quits, at most 40.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const MAX_BYTES = 5 << 20,
  MAX_FILES = 40,
  RATE_N = 6,
  RATE_MS = 2000;
const CSP =
  "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; " +
  "media-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'; webrtc 'block'";
const HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-DNS-Prefetch-Control': 'off',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const KEY_HEADER = 'x-tnai-show';
const secret = crypto.randomBytes(24).toString('hex');
const files = new Map(); // token -> { real, roots, name, hits }
let server = null,
  port = 0,
  starting = null;

const low = p => (process.platform === 'win32' ? p.toLowerCase() : p);
const within = (file, root) => {
  const rel = path.relative(low(root), low(file));
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
};
const realOf = p => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return '';
  }
};

// A network or device path is refused before anything touches it: resolving \\server\share signs in
// to that server.
const remote = p => /^[\\/]{2}/.test(p);

// The real path of a file that may be shown, or why not. roots: the project folder and the caller's
// own worktree.
function locate(file, roots) {
  if (remote(file)) return { ok: false, error: 'a network or device path cannot be shown' };
  if (!/\.html?$/i.test(file))
    return { ok: false, error: 'only one .html or .htm file can be shown' };
  const real = realOf(file);
  if (!real) return { ok: false, error: 'no such file: ' + file };
  if (!/\.html?$/i.test(real))
    return { ok: false, error: 'only one .html or .htm file can be shown' };
  const root = roots
    .map(r => (remote(r) ? '' : realOf(r)))
    .filter(Boolean)
    .find(r => within(real, r));
  if (!root)
    return { ok: false, error: 'the file must be inside the project folder or your own worktree' };
  return { ok: true, real, root };
}

// The file's bytes, read from one open handle so the size and kind checked are those of what is
// sent.
async function read(entry) {
  const at = locate(entry.real, entry.roots);
  if (!at.ok || low(at.real) !== low(entry.real)) return null;
  let handle = null;
  try {
    handle = await fs.promises.open(entry.real, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    try {
      await handle?.close();
    } catch {}
  }
}

function answer(req, res) {
  const end = (code, text) => {
    res.writeHead(code, { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text || '');
  };
  if (req.method !== 'GET' || req.headers.host !== '127.0.0.1:' + port) return end(404);
  const m = /^\/s\/([0-9a-f]{32})\/([^/?#]+)$/.exec(req.url || ''),
    entry = m && files.get(m[1]);
  let name = '';
  try {
    name = m ? decodeURIComponent(m[2]) : '';
  } catch {}
  if (!entry || name !== entry.name) return end(404);
  const key = Buffer.from(String(req.headers[KEY_HEADER] || '')),
    want = Buffer.from(secret);
  if (key.length !== want.length || !crypto.timingSafeEqual(key, want))
    return end(404, 'This page shows only inside Technically Not.');
  const now = Date.now();
  entry.hits = entry.hits.filter(t => now - t < RATE_MS);
  if (entry.hits.length >= RATE_N) return end(429);
  entry.hits.push(now);
  read(entry).then(
    body => {
      if (!body) return end(404);
      res.writeHead(200, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    },
    () => end(404)
  );
}

function start() {
  if (server) return Promise.resolve(true);
  if (!starting)
    starting = new Promise(resolve => {
      const s = http.createServer(
        { headersTimeout: 5000, requestTimeout: 5000, keepAliveTimeout: 2000 },
        answer
      );
      s.maxConnections = 16;
      s.once('error', () => {
        starting = null;
        resolve(false);
      });
      s.listen(0, '127.0.0.1', () => {
        server = s;
        port = s.address().port;
        s.unref();
        starting = null;
        resolve(true);
      });
    });
  return starting;
}

function stop() {
  try {
    server?.close();
  } catch {}
  server = null;
  port = 0;
  files.clear();
}

// What a page asks for that will not load: other files and addresses on script, style, picture,
// frame and media tags (links in <a> are left out).
function refs(html) {
  const out = new Set(),
    tag =
      /<(?:script|img|link|iframe|video|audio|source|embed|object|track)\b[^>]{0,2000}?\b(?:src|href|data|poster)\s*=\s*["']?([^"'\s>]+)/gi;
  for (let m; (m = tag.exec(html)) && out.size < 7;)
    if (!/^(data:|blob:|#|about:)/i.test(m[1])) out.add(m[1].slice(0, 80));
  return [...out];
}

// `tnai show FILE`: { ok, url, name, rel, refs } or { ok: false, error }. file is taken from cwd;
// rel is its path inside its root, as fs:changes names it.
async function add(file, cwd, roots) {
  file = String(file || '');
  if (!file) return { ok: false, error: 'name the file: tnai show FILE.html' };
  if (remote(file)) return { ok: false, error: 'a network or device path cannot be shown' };
  const full = path.isAbsolute(file)
    ? path.resolve(file)
    : path.resolve(typeof cwd === 'string' && path.isAbsolute(cwd) ? cwd : roots[0] || '.', file);
  roots = (roots || []).filter(r => typeof r === 'string' && path.isAbsolute(r));
  const at = locate(full, roots);
  if (!at.ok) return at;
  let stat = null;
  try {
    stat = fs.statSync(at.real);
  } catch {}
  if (!stat?.isFile()) return { ok: false, error: 'not a file: ' + file };
  if (stat.size > MAX_BYTES) return { ok: false, error: 'the file is over 5 MB' };
  if (!(await start())) return { ok: false, error: 'the page server could not start' };
  let token = [...files].find(([, e]) => low(e.real) === low(at.real))?.[0];
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    if (files.size >= MAX_FILES) files.delete(files.keys().next().value);
  }
  const name = path.basename(at.real);
  files.set(token, { real: at.real, roots, name, hits: files.get(token)?.hits || [] });
  let html = '';
  try {
    html = fs.readFileSync(at.real, 'utf8');
  } catch {}
  return {
    ok: true,
    url: 'http://127.0.0.1:' + port + '/s/' + token + '/' + encodeURIComponent(name),
    name,
    rel: path.relative(at.root, at.real).split(path.sep).join('/'),
    refs: refs(html),
  };
}

// True for any address of the page server, by origin alone (a page can change the rest of its own
// address without loading anything).
function is(url) {
  if (!port) return false;
  try {
    return new URL(String(url || '')).origin === 'http://127.0.0.1:' + port;
  } catch {
    return false;
  }
}

module.exports = { add, is, stop, refs, key: () => secret, KEY_HEADER, CSP, port: () => port };
