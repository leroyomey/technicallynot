/*
 * Technically Not desktop · web-bridge.js — Dev copy only (npm start with TNAI_WEB_BRIDGE=<port>):
 * serves the real UI on http://127.0.0.1:<port> so it can be tried in Live preview, backed by this
 * dev copy's real main process (terminals, agents, disk, git). window.tnaiNative is the real
 * preload.js, run in the page with an ipcRenderer that forwards over HTTP: invoke/send → POST,
 * sendSync → sync XHR, pushes → one event stream. The dev copy's own window stays hidden on
 * about:blank, so only one UI drives it. Localhost only, and every call needs the page's token.
 */
'use strict';
const http = require('http'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const handlers = new Map(),
  listeners = new Map(),
  clients = new Set();

// Kept in the dev settings folder, so a page left open across a restart reconnects (its event
// stream retries) instead of being refused.
let token = '';
const loadToken = () => {
  const file = path.join(require('electron').app.getPath('userData'), 'web-bridge-token');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{32}$/.test(saved)) return saved;
  } catch {}
  const fresh = crypto.randomBytes(16).toString('hex');
  try {
    fs.writeFileSync(file, fresh);
  } catch {}
  return fresh;
};
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

// Binary values (fs reads, attachments) travel as tagged base64; everything else is plain JSON.
const encode = value =>
  JSON.stringify(value === undefined ? null : value, function (key, v) {
    const raw = this[key];
    if (raw instanceof Uint8Array)
      return { __u8: Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('base64') };
    if (raw instanceof ArrayBuffer) return { __u8: Buffer.from(raw).toString('base64') };
    if (raw instanceof Error) return { message: raw.message, name: raw.name };
    return v;
  });
const decode = text =>
  JSON.parse(text, (_k, v) =>
    v && typeof v === 'object' && typeof v.__u8 === 'string'
      ? new Uint8Array(Buffer.from(v.__u8, 'base64'))
      : v
  );

// Handlers see Technically Not's own top frame (main.js `trusted`); no sender, so window-only calls
// (window:control, snapshot) do nothing.
const fakeEvent = () => ({
  sender: null,
  senderFrame: { parent: null, origin: 'file://' },
  returnValue: undefined,
  reply() {},
});

// Called before any handler is registered: records every ipcMain.handle / ipcMain.on so HTTP calls
// reach the same functions.
function hookIpc(ipcMain) {
  const handle = ipcMain.handle.bind(ipcMain),
    on = ipcMain.on.bind(ipcMain);
  ipcMain.handle = (channel, fn) => {
    handlers.set(channel, fn);
    return handle(channel, fn);
  };
  ipcMain.on = (channel, fn) => {
    if (!listeners.has(channel)) listeners.set(channel, []);
    listeners.get(channel).push(fn);
    return on(channel, fn);
  };
}

// Pushes to the hidden window also go to every connected page.
function mirror(webContents) {
  const send = webContents.send.bind(webContents);
  webContents.send = (channel, ...args) => {
    const line = 'data: ' + encode({ channel, payload: args[0] }) + '\n\n';
    for (const res of clients) res.write(line);
    return send(channel, ...args);
  };
}

const body = req =>
  new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
const reply = (res, status, text, type = 'application/json') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(text);
};

function clientScript() {
  const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
  return `(() => {
const TOKEN = ${JSON.stringify(token)}, subs = new Map();
const encode = v => JSON.stringify(v === undefined ? null : v, function (k, x) { const r = this[k]; if (r instanceof Uint8Array || r instanceof ArrayBuffer) { const b = r instanceof Uint8Array ? r : new Uint8Array(r); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return { __u8: btoa(s) }; } return x; });
const decode = t => JSON.parse(t, (k, v) => { if (v && typeof v === 'object' && typeof v.__u8 === 'string') { const s = atob(v.__u8), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; } return v; });
const post = async (url, channel, args) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tnai-token': TOKEN }, body: encode({ channel, args }) }); const out = decode(await r.text()); if (out && out.error) throw new Error(out.error); return out ? out.value : undefined; };
let queue = Promise.resolve(); // keystrokes and resizes keep their order
const ipcRenderer = {
  invoke: (channel, ...args) => post('/__tnai/invoke', channel, args),
  send: (channel, ...args) => { queue = queue.then(() => post('/__tnai/send', channel, args)).catch(err => console.error('[tnai bridge] ' + channel, err)); },
  sendSync: (channel, ...args) => { const x = new XMLHttpRequest(); x.open('POST', '/__tnai/sync', false); x.setRequestHeader('content-type', 'application/json'); x.setRequestHeader('x-tnai-token', TOKEN); x.send(encode({ channel, args })); const out = decode(x.responseText); return out ? out.value : null; },
  on: (channel, handler) => { if (!subs.has(channel)) subs.set(channel, new Set()); subs.get(channel).add(handler); },
  removeListener: (channel, handler) => { subs.get(channel)?.delete(handler); },
};
const events = new EventSource('/__tnai/events?t=' + TOKEN);
events.onmessage = e => { const m = decode(e.data); for (const h of [...(subs.get(m.channel) || [])]) h({}, m.payload); };
const electron = { ipcRenderer, contextBridge: { exposeInMainWorld: (name, api) => { window[name] = api; } } };
const process = { platform: ${JSON.stringify(process.platform)}, getSystemVersion: () => ${JSON.stringify(require('os').release())} };
(function (require, process) {
${preload}
})(() => electron, process);
})();`;
}

function start(port, win) {
  token = loadToken();
  mirror(win.webContents);

  // Only this bridge's own page: the Host must be this port on localhost (stops DNS rebinding), and
  // a browser's Origin / Fetch site, when sent, must be that same page (another localhost page
  // can't read files or load the token-carrying bridge script). Opening the page itself (a
  // navigation, e.g. into Live preview's frame) is allowed from anywhere: it carries no token.
  const hosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
  const ownPage = req =>
    hosts.has(String(req.headers.host || '').toLowerCase()) &&
    (!req.headers.origin || [...hosts].some(h => req.headers.origin === 'http://' + h)) &&
    (!req.headers['sec-fetch-site'] ||
      ['same-origin', 'none'].includes(req.headers['sec-fetch-site']) ||
      (req.headers['sec-fetch-mode'] === 'navigate' && req.method === 'GET'));
  const server = http.createServer(async (req, res) => {
    try {
      if (!ownPage(req)) return reply(res, 403, '{}');
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/__tnai/')) {
        if (url.pathname === '/__tnai/bridge.js')
          return reply(res, 200, clientScript(), 'text/javascript');
        if (url.pathname === '/__tnai/events') {
          if (url.searchParams.get('t') !== token) return reply(res, 403, '{}');
          res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-store',
            connection: 'keep-alive',
          });
          res.write(': ok\n\n');
          clients.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 15000);
          req.on('close', () => {
            clearInterval(ping);
            clients.delete(res);
          });
          return;
        }
        if (req.method !== 'POST' || req.headers['x-tnai-token'] !== token)
          return reply(res, 403, '{}');
        const { channel, args = [] } = decode(await body(req));
        if (url.pathname === '/__tnai/invoke') {
          const fn = handlers.get(channel);
          if (!fn) return reply(res, 200, encode({ error: 'No handler for ' + channel }));
          try {
            return reply(res, 200, encode({ value: await fn(fakeEvent(), ...args) }));
          } catch (err) {
            return reply(res, 200, encode({ error: err?.message || String(err) }));
          }
        }
        if (url.pathname === '/__tnai/send') {
          for (const fn of listeners.get(channel) || []) await fn(fakeEvent(), ...args);
          return reply(res, 200, '{}');
        }
        if (url.pathname === '/__tnai/sync') {
          // answered when a handler sets returnValue, which may come later (tnai:prompt's dialog)
          const fns = listeners.get(channel) || [];
          if (!fns.length) return reply(res, 200, encode({ value: null }));

          // Never hang the page's blocked sync call: null after 10 minutes (the dialog's late
          // answer is dropped) or if the page goes away.
          let timer;
          const event = fakeEvent(),
            set = new Promise(resolve => {
              Object.defineProperty(event, 'returnValue', { set: resolve, configurable: true });
              timer = setTimeout(() => resolve(null), 10 * 60 * 1000);
              res.on('close', () => resolve(null));
            });
          for (const fn of fns) fn(event, ...args);
          const value = await set;
          clearTimeout(timer);
          if (res.writableEnded || res.destroyed) return;
          return reply(res, 200, encode({ value: value ?? null }));
        }
        return reply(res, 404, '{}');
      }

      // Static files from the project root; index.html gets the bridge before any app script.
      const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
        return reply(res, 404, 'Not found', 'text/plain');
      if (rel === '/index.html')
        return reply(
          res,
          200,
          fs
            .readFileSync(file, 'utf8')
            .replace('<head>', '<head><script src="/__tnai/bridge.js"></script>'),
          'text/html'
        );
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      if (!res.headersSent) reply(res, 500, encode({ error: err.message }));
      else res.end();
    }
  });
  server.listen(port, '127.0.0.1', () =>
    console.log('[tnai web bridge] http://127.0.0.1:' + port + '/')
  );
}

module.exports = { hookIpc, start };
