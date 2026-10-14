/*
 * Technically Not tools · desktop-check/tests/stress-preview.main.js — Main-process side of
 * stress-preview.js: copies the website folder (read only, TNAI_PREVIEW_SITE or ../Project TN.ai
 * Landing Page) into the temp project, writes heavy test pages and a live-reload dev server
 * (package.json "dev"), rapid file edits, counts of preview-emulation IPC calls, window resizes,
 * pop-out windows, app CPU/memory and a CPU profile.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const inspector = require('inspector');
const { app, BrowserWindow } = require('electron');
const files = require('../../../desktop/fs-service');
const emulation = require('../../../desktop/preview-emulation');

const post = (session, method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params || {}, (err, res) => (err ? reject(err) : resolve(res)))
  );

// Static server for site/ at "/" and heavy/ at "/__heavy/"; every HTML page gets a probe that posts
// its load time to the parent and reloads on a file change (Server-Sent Events, like a dev server's
// live reload). /__img/N.svg is a generated image.
const SERVER = String.raw`const http = require('http'), fs = require('fs'), path = require('path');
const site = path.join(__dirname, 'site'), heavy = path.join(__dirname, 'heavy'), clients = new Set();
const PROBE = '<script>(function(){function post(k){try{parent.postMessage("TNAI_SP:"+k+":"+location.pathname+":"+innerWidth,"*")}catch(e){}}addEventListener("load",function(){post("load")});var es=new EventSource("/__sse");es.onmessage=function(){es.close();location.reload()};})()</script>';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
let timer = null, reloads = 0;
const changed = () => { clearTimeout(timer); timer = setTimeout(() => { reloads++; for (const c of clients) c.write('data: reload\n\n'); }, 30); };
for (const dir of [site, heavy]) try { fs.watch(dir, { recursive: true }, changed); } catch {}
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__sse') { res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }); res.write(': hi\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return; }
  if (url === '/__reloads') { res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); res.end(String(reloads)); return; }
  const img = /^\/__img\/(\d+)\.svg$/.exec(url);
  if (img) { const n = +img[1]; res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="hsl(' + (n * 37 % 360) + ',45%,70%)"/><text x="8" y="38" font-size="18">' + n + '</text></svg>'); return; }
  let file = url.startsWith('/__heavy/') ? path.join(heavy, url.slice(9)) : path.join(site, url);
  if (url.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    const type = types[path.extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' });
    res.end(type === 'text/html' ? String(data).replace(/<\/body>|$/i, m => PROBE + m) : data);
  });
}).listen(0, '127.0.0.1', function () { console.log('  Local:   http://localhost:' + this.address().port + '/'); });
`;

const HEAVY = {
  // ~40k elements, ~2 MB of HTML.
  'dom.html': () =>
    '<!doctype html><title>dom</title><body><table>' +
    Array.from(
      { length: 5000 },
      (_, i) =>
        '<tr><td>' +
        i +
        '</td><td><b>row ' +
        i +
        '</b></td><td><a href="#r' +
        i +
        '">link</a></td><td><span class="c">' +
        'lorem ipsum '.repeat(3) +
        '</span></td></tr>'
    ).join('') +
    '</table></body>',
  // 300 generated images + the site's own PNGs 40 times with cache-busting queries.
  'images.html': () =>
    '<!doctype html><title>images</title><style>img{width:96px;height:64px;margin:2px}</style><body>' +
    Array.from({ length: 300 }, (_, i) => '<img src="/__img/' + i + '.svg">').join('') +
    Array.from({ length: 40 }, (_, i) => '<img src="/assets/og-image.png?n=' + i + '">').join('') +
    '</body>',
  // 800 elements animating transform + color forever.
  'anim.html': () =>
    '<!doctype html><title>anim</title><style>@keyframes s{0%{transform:rotate(0) scale(1);background:#9c6}50%{transform:rotate(180deg) scale(1.3);background:#69c}100%{transform:rotate(360deg) scale(1);background:#9c6}}i{display:inline-block;width:18px;height:18px;margin:3px;animation:s 1.2s linear infinite}</style><body>' +
    '<i></i>'.repeat(800) +
    '</body>',
  // Busy main thread: 25 ms of work every 50 ms, and 2000 nodes rewritten every frame, plus the CSS
  // animation.
  'js.html': () =>
    '<!doctype html><title>js</title><style>@keyframes s{to{transform:rotate(360deg)}}i{display:inline-block;width:12px;height:12px;background:#9c6;animation:s 1s linear infinite}</style><body><div id="d"></div>' +
    '<i></i>'.repeat(300) +
    '<script>const d=document.getElementById("d");for(let i=0;i<2000;i++)d.appendChild(document.createElement("span"));setInterval(()=>{const t=performance.now();let x=0;while(performance.now()-t<25)x+=Math.sqrt(x+1)},50);(function f(){for(const s of d.children)s.textContent=(Math.random()*1e3|0)+" ";requestAnimationFrame(f)})()</script></body>',
};

function summarize(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n])),
    file = new Map(),
    fn = new Map();
  let total = 0;
  profile.samples.forEach((id, i) => {
    const ms = (profile.timeDeltas[i + 1] ?? 0) / 1000,
      cf = byId.get(id).callFrame;
    total += ms;
    const f = (cf.url || '').split(/[\\/]/).pop() || '(' + (cf.functionName || 'native') + ')',
      k = (cf.functionName || '(anon)') + ' ' + f + ':' + (cf.lineNumber + 1);
    file.set(f, (file.get(f) || 0) + ms);
    fn.set(k, (fn.get(k) || 0) + ms);
  });
  const top = (m, n) =>
    [...m]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => v.toFixed(0).padStart(6) + ' ms  ' + k);
  return { total: Math.round(total), files: top(file, 10), fns: top(fn, 12) };
}

module.exports = win => {
  const calls = { set: 0, forget: 0 };
  const set = emulation.set,
    forget = emulation.forget;
  emulation.set = (...a) => {
    calls.set++;
    return set(...a);
  }; // desktop/main.js calls these through the module object
  emulation.forget = (...a) => {
    calls.forget++;
    return forget(...a);
  };
  const dbg = win.webContents.debugger,
    mainSession = new inspector.Session();
  const popouts = () => BrowserWindow.getAllWindows().filter(w => w !== win && !w.isDestroyed());
  let cpu0 = null,
    t0 = 0,
    bounds0 = null;
  return {
    setup() {
      const root = files.root(),
        src =
          process.env.TNAI_PREVIEW_SITE ||
          path.resolve(__dirname, '..', '..', '..', '..', 'Project TN.ai Landing Page');
      const copied = fs.existsSync(src);

      // package.json first: the app reads its scripts when it appears, and written after a copy
      // of thousands of files its change was lost in that burst (the Run menu never listed "dev").
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'preview-stress', scripts: { dev: 'node devserver.js' } }, null, 2)
      );

      // A real site, but a bounded one: the folder had grown to 13,341 files (drafts, tools,
      // media), copied in one blocking call. Pages, styles, scripts and small pictures of the
      // site itself are enough for a preview under load: 600 files at most, none over 2 MB.
      let taken = 0;
      const SKIPPED = /[\\/](\.git|node_modules|\.wrangler|tools|dist|out|_[^\\/]*)$/;
      if (copied)
        fs.cpSync(src, path.join(root, 'site'), {
          recursive: true,
          filter: source => {
            if (SKIPPED.test(source)) return false;
            const stat = fs.statSync(source);
            if (stat.isDirectory()) return true;
            if (stat.size > 2 * 1024 * 1024 || taken >= 600) return false;
            taken++;
            return true;
          },
        });
      else {
        fs.mkdirSync(path.join(root, 'site', 'assets'), { recursive: true });
        fs.writeFileSync(
          path.join(root, 'site', 'index.html'),
          '<!doctype html><title>site</title><body><h1>Site</h1></body>'
        );
      }
      fs.mkdirSync(path.join(root, 'heavy'), { recursive: true });
      for (const [name, make] of Object.entries(HEAVY))
        fs.writeFileSync(path.join(root, 'heavy', name), make());
      fs.writeFileSync(path.join(root, 'devserver.js'), SERVER);
      const count = dir =>
        fs
          .readdirSync(dir, { withFileTypes: true })
          .reduce((n, d) => n + (d.isDirectory() ? count(path.join(dir, d.name)) : 1), 0);
      return {
        site: copied ? src : '(not found: generated stand-in)',
        files: count(path.join(root, 'site')),
      };
    },
    // n writes to site/index.html, `every` ms apart (the dev server's watcher sees each one).
    async edits(n, every) {
      const file = path.join(files.root(), 'site', 'index.html'),
        base = fs.readFileSync(file, 'utf8').replace(/<!-- edit \d+ -->$/, '');
      for (let i = 1; i <= n; i++) {
        fs.writeFileSync(file, base + '<!-- edit ' + i + ' -->');
        if (i < n) await new Promise(r => setTimeout(r, every));
      }
      return Date.now();
    },
    calls: () => ({ ...calls, sessions: emulation.sessions?.() ?? -1 }),
    popouts: () => popouts().length,
    closePopout() {
      popouts()[0]?.close();
      return true;
    },
    async resizeSteps(steps, dx, dy, every) {
      bounds0 = bounds0 || win.getBounds();
      if (win.isMaximized()) win.unmaximize();
      const b = win.getBounds();
      for (let i = 1; i <= steps; i++) {
        win.setBounds({
          ...b,
          width: b.width - Math.round((dx * i) / steps),
          height: b.height - Math.round((dy * i) / steps),
        });
        await new Promise(r => setTimeout(r, every));
      }
      for (let i = steps - 1; i >= 0; i--) {
        win.setBounds({
          ...b,
          width: b.width - Math.round((dx * i) / steps),
          height: b.height - Math.round((dy * i) / steps),
        });
        await new Promise(r => setTimeout(r, every));
      }
      return true;
    },
    usageStart() {
      cpu0 = process.cpuUsage();
      t0 = Date.now();
      app.getAppMetrics();
      return true;
    },
    usageStop() {
      const d = process.cpuUsage(cpu0),
        ms = Date.now() - t0,
        rendererPid = win.webContents.getOSProcessId();
      const procs = app.getAppMetrics().map(m => ({
        type:
          m.pid === rendererPid
            ? 'Technically Not renderer'
            : m.type === 'GPU'
              ? 'graphics'
              : m.type,
        cpu: m.cpu.percentCPUUsage,
        mb: m.memory.workingSetSize / 1024,
      }));
      const by = {};
      for (const p of procs) {
        const k = by[p.type] || (by[p.type] = { n: 0, cpu: 0, mb: 0 });
        k.n++;
        k.cpu += p.cpu;
        k.mb += p.mb;
      }
      for (const k of Object.values(by)) {
        k.cpu = +k.cpu.toFixed(1);
        k.mb = Math.round(k.mb);
      }
      return {
        mainCpuPct: +(((d.user + d.system) / 1000 / ms) * 100).toFixed(1),
        mainHeapMb: Math.round(process.memoryUsage().heapUsed / 1048576),
        processes: procs.length,
        by,
      };
    },
    async profileStart() {
      if (!dbg.isAttached()) dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 250 });
      await dbg.sendCommand('Profiler.start');
      mainSession.connect();
      await post(mainSession, 'Profiler.enable');
      await post(mainSession, 'Profiler.setSamplingInterval', { interval: 250 });
      await post(mainSession, 'Profiler.start');
      return true;
    },
    async profileStop() {
      const { profile: mainProfile } = await post(mainSession, 'Profiler.stop');
      mainSession.disconnect();
      return {
        renderer: summarize((await dbg.sendCommand('Profiler.stop')).profile),
        main: summarize(mainProfile),
      };
    },
  };
};
