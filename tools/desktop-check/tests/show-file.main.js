/*
 * Technically Not tools · desktop-check/tests/show-file.main.js — Main-process side of
 * show-file.js: a listener on 127.0.0.1 that counts every connection (TCP) and packet (UDP) a page
 * manages to send, the attack page itself (written as a project file, and served by the listener
 * without any wall as the control), reads from inside the shown frame, requests to the page server
 * from outside the app, and `shell.openExternal` replaced so no test opens the browser.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const dgram = require('dgram');
const { app, shell, session } = require('electron');
const showFile = require('../../../desktop/show-file');

// Every way out a page has, tried once; results in window.__r (strings), `done` last. __L__ = the
// listener's TCP port, __U__ = its UDP port.
const PAGE = `<!doctype html><meta charset="utf-8"><title>show __V__</title>
<meta http-equiv="refresh" content="4;url=http://127.0.0.1:__L__/meta">
<h1>Chart __V__</h1><a id="link" href="http://127.0.0.1:__L__/link">a link</a><div style="height:3000px">tall</div>
<img id="px" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==">
<script>
(async () => {
  const L = 'http://127.0.0.1:__L__', r = {};
  const t = (k, f) => { try { r[k] = String(f()); } catch (e) { r[k] = 'throws ' + e.name; } };
  const a = async (k, f) => { try { r[k] = String(await Promise.race([f(), new Promise(z => setTimeout(() => z('timeout'), 2500))])); } catch (e) { r[k] = 'rejects ' + (e && e.name); } };
  const el = (tag, set) => new Promise(res => { const e = document.createElement(tag); e.onload = () => res('LOADED'); e.onerror = () => res('blocked'); set(e); document.head.append(e); });
  window.__r = r; window.__alive = 1;
  const rtc = () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:__U__' }, { urls: 'turn:127.0.0.1:__L__?transport=tcp', username: 'a', credential: 'b' }] }); pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)); return 'started'; };
  t('rtcEarly', rtc); t('rtcNames', () => Object.getOwnPropertyNames(self).filter(k => /RTC/.test(k)).length);
  t('child', () => { const f = document.createElement('iframe'); f.srcdoc = '<script>(' + rtc + ')(); fetch("' + L + '/childfetch", { mode: "no-cors" })<' + '/script>'; document.body.append(f); return 'added'; });
  t('ran', () => 'yes'); t('origin', () => self.origin); t('data', () => document.getElementById('px').naturalWidth);
  t('bridge', () => typeof window.tnaiNative); t('parentBridge', () => typeof parent.tnaiNative); t('topBridge', () => typeof top.tnaiNative);
  t('require', () => typeof require); t('process', () => typeof process);
  t('cookie', () => { document.cookie = 'a=1'; return 'value:' + document.cookie; }); t('localStorage', () => { localStorage.setItem('a', '1'); return 'stored'; }); t('sessionStorage', () => 'length ' + sessionStorage.length);
  t('open', () => window.open(L + '/open')); t('topNav', () => { top.location = L + '/top'; return 'set'; });
  t('replaceState', () => { history.replaceState(null, '', '?a=1'); return location.search; });
  t('pushState', () => { history.pushState(null, '', '/other'); return location.pathname; });
  await a('fetch', () => fetch(L + '/fetch', { mode: 'no-cors' }).then(() => 'LOADED'));
  await a('xhr', () => new Promise(res => { const x = new XMLHttpRequest(); x.open('GET', L + '/xhr'); x.onload = () => res('LOADED'); x.onerror = () => res('blocked'); x.send(); }));
  await a('ws', () => new Promise(res => { const w = new WebSocket('ws://127.0.0.1:__L__/ws'); w.onopen = () => res('LOADED'); w.onerror = () => res('blocked'); }));
  await a('img', () => el('img', e => { e.src = L + '/img'; }));
  await a('scriptSrc', () => el('script', e => { e.src = L + '/js'; }));
  await a('css', () => el('link', e => { e.rel = 'stylesheet'; e.href = L + '/css'; }));
  t('beacon', () => navigator.sendBeacon(L + '/beacon', 'x'));
  await a('neighbor', () => fetch('neighbor.txt').then(x => x.text()).then(s => 'LOADED ' + s.slice(0, 20)));
  await a('file', () => fetch('file:///C:/Windows/win.ini').then(() => 'LOADED'));
  for (const rel of ['preconnect', 'dns-prefetch', 'prefetch', 'preload']) { const e = document.createElement('link'); e.rel = rel; e.href = L + '/hint-' + rel; if (rel === 'preload') e.as = 'fetch'; document.head.append(e); }
  await a('frame', () => new Promise(res => { const f = document.createElement('iframe'); f.src = L + '/frame'; document.body.append(f); setTimeout(() => res('added'), 600); }));
  await a('blankFrame', async () => { const f = document.createElement('iframe'); document.body.append(f); await f.contentWindow.fetch(L + '/blankframe', { mode: 'no-cors' }); return 'LOADED'; });
  await a('worker', () => new Promise(res => { const w = new Worker(URL.createObjectURL(new Blob(['fetch("' + L + '/worker",{mode:"no-cors"}).then(()=>postMessage("LOADED"),()=>postMessage("blocked"))']))); w.onmessage = e => res(e.data); w.onerror = () => res('blocked'); }));
  await a('rtc', async () => { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:127.0.0.1:__U__' }, { urls: 'turn:127.0.0.1:__L__?transport=tcp', username: 'a', credential: 'b' }] }); pc.createDataChannel('x'); let n = 0; pc.onicecandidate = e => { if (e.candidate) n++; }; await pc.setLocalDescription(await pc.createOffer()); await new Promise(z => setTimeout(z, 1800)); return 'candidates ' + n; });
  t('form', () => { const f = document.createElement('form'); f.action = L + '/form'; f.method = 'post'; document.body.append(f); f.submit(); return 'submitted'; });
  r.done = 'yes';
})();
</script>`;

module.exports = (win, profile) => {
  const project = path.join(profile, 'sample-project');
  const hits = [],
    opened = [],
    preconnects = [];
  let udp = 0,
    tcpPort = 0,
    udpPort = 0;
  shell.openExternal = async target => {
    opened.push(String(target));
  };
  const page = v => PAGE.replace(/__L__/g, tcpPort).replace(/__U__/g, udpPort).replace(/__V__/g, v);

  // Raw TCP: a connection counts even when no request follows (preconnect, TURN). GET /control
  // answers with the attack page, unwalled.
  const tcp = net.createServer(socket => {
    const hit = { path: '(connection only)' };
    hits.push(hit);
    socket.on('error', () => {});
    socket.once('data', data => {
      const first = String(data).split('\r\n')[0],
        m = /^[A-Z]+ (\S+)/.exec(first);
      hit.path = m ? m[1] : '(not http)';
      const body = hit.path === '/control' ? page('control') : 'ok';
      socket.end(
        'HTTP/1.1 200 OK\r\nContent-Type: ' +
          (hit.path === '/control' ? 'text/html' : 'text/plain') +
          '\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\nContent-Length: ' +
          Buffer.byteLength(body) +
          '\r\n\r\n' +
          body
      );
    });
  });
  const sock = dgram.createSocket('udp4');
  sock.on('message', () => {
    udp++;
  });
  sock.on('error', () => {});

  // requests for a name that is not this computer (.invalid never resolves, so nothing leaves the
  // PC even if one is made)
  const web = [];
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://tnai-test.invalid/*'] },
    (details, callback) => {
      web.push(details.url);
      callback({ cancel: true });
    }
  );
  session.defaultSession.on('preconnect', (_e, url) => {
    if (String(url).includes(':' + tcpPort)) preconnects.push(String(url));
  });
  const frame = () =>
    win.webContents.mainFrame.framesInSubtree.find(f => {
      try {
        return showFile.is(f.url);
      } catch {
        return false;
      }
    });
  const get = (url, headers) =>
    new Promise(resolve => {
      const u = new URL(url);
      const req = http.request(
        { host: '127.0.0.1', port: u.port, path: u.pathname + u.search, headers },
        res => {
          let body = '';
          res.on('data', d => {
            body += d;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              csp: String(res.headers['content-security-policy'] || ''),
              body: body.slice(0, 200),
            })
          );
        }
      );
      req.on('error', e => resolve({ status: 0, body: e.message }));
      req.end();
    });
  return {
    async listen() {
      await new Promise(r => tcp.listen(0, '127.0.0.1', r));
      await new Promise(r => sock.bind(0, '127.0.0.1', r));
      tcpPort = tcp.address().port;
      udpPort = sock.address().port;
      return { tcp: tcpPort, udp: udpPort };
    },
    hits: () => ({
      tcp: hits.map(h => h.path).concat(web),
      udp,
      opened: [...opened],
      preconnects: [...preconnects],
    }),
    reset() {
      web.length = 0;
      hits.length = 0;
      opened.length = 0;
      preconnects.length = 0;
      udp = 0;
      return true;
    },
    write(rel, text) {
      const file = path.join(project, String(rel));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, String(text));
      return true;
    },
    writePage(rel, version) {
      return this.write(rel, page(version));
    },
    // What the shown page's own script found, read inside its frame (the page has no way to tell
    // anyone itself).
    async probe() {
      const f = frame();
      if (!f) return null;
      try {
        return await f.executeJavaScript(
          '({ r: window.__r || null, alive: window.__alive || 0, title: document.title, href: location.href })'
        );
      } catch (e) {
        return { error: e.message };
      }
    },
    // Runs `code` as the page's own script (a navigation it starts itself), then says whether the
    // same document is still there.
    async act(code) {
      const f = frame();
      if (!f) return { gone: 'no frame' };
      try {
        await f.executeJavaScript('window.__alive = 2; setTimeout(() => { ' + code + ' }, 0); 1');
      } catch (e) {
        return { gone: e.message };
      }
      await new Promise(r => setTimeout(r, 700));
      const now = frame();
      if (!now)
        return {
          gone: 'frame left the page server',
          url: win.webContents.mainFrame.framesInSubtree.map(x => x.url).join(' | '),
        };
      try {
        return { alive: await now.executeJavaScript('window.__alive || 0'), url: now.url };
      } catch (e) {
        return { gone: e.message };
      }
    },
    // The page server asked from outside the app, as a browser or another program would.
    async outside(url) {
      const u = new URL(url),
        host = '127.0.0.1:' + u.port,
        key = { [showFile.KEY_HEADER]: showFile.key() };
      const out = {};
      out.noKey = await get(url, { host });
      out.withKey = await get(url, { host, ...key });
      out.wrongHost = await get(url, { host: 'evil.example:' + u.port, ...key });
      out.wrongToken = await get(url.replace(/\/s\/[0-9a-f]{4}/, '/s/0000'), { host, ...key });
      out.neighbor = await get(url.replace(/[^/]+$/, 'neighbor.txt'), { host, ...key });
      out.root = await get('http://127.0.0.1:' + u.port + '/', { host, ...key });
      out.query = await get(url + '?x=1', { host, ...key });
      const burst = await Promise.all(Array.from({ length: 12 }, () => get(url, { host, ...key })));
      out.burst = burst.map(b => b.status).join(',');
      return out;
    },
    // Files `tnai show` must refuse, asked of show-file.js with the roots a project-folder panel
    // has.
    async refuse() {
      const out = {},
        roots = [project, undefined];
      const outsideDir = path.join(profile, 'outside'),
        sibling = project + '-other';
      for (const d of [outsideDir, sibling]) {
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, 'x.html'), '<p>outside</p>');
      }
      fs.writeFileSync(path.join(project, 'big.html'), Buffer.alloc((5 << 20) + 1, 32));
      try {
        fs.symlinkSync(outsideDir, path.join(project, 'link'), 'junction');
      } catch (e) {
        out.junctionMade = e.message;
      }
      const ask = async file => {
        const r = await showFile.add(file, project, roots);
        return r.ok ? 'SHOWN ' + r.url : r.error;
      };
      out.outside = await ask(path.join('..', 'outside', 'x.html'));
      out.sibling = await ask(path.join(sibling, 'x.html'));
      out.junction = await ask(path.join('link', 'x.html'));
      out.notHtml = await ask('README.md');
      out.missing = await ask('nope.html');
      out.folder = await ask('src');
      out.big = await ask('big.html');
      out.unc = await ask('\\\\127.0.0.1\\share\\x.html');
      out.device = await ask('\\\\?\\C:\\x.html');
      return out;
    },
    // The newest `tnai shot preview` picture: its size on disk.
    shot(since) {
      const root = path.join(app.getPath('userData'), 'attachments');
      let best = null;
      for (const day of fs.existsSync(root) ? fs.readdirSync(root) : []) {
        let names = [];
        try {
          names = fs.readdirSync(path.join(root, day));
        } catch {}
        for (const n of names)
          if (/^shot-.*\.png$/.test(n)) {
            const s = fs.statSync(path.join(root, day, n));
            if (s.mtimeMs >= since && (!best || s.mtimeMs > best.at))
              best = { at: s.mtimeMs, bytes: s.size };
          }
      }
      return best;
    },
    stop() {
      try {
        tcp.close();
        sock.close();
      } catch {}
      return true;
    },
  };
};
