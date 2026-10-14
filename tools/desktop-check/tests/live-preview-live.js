/*
 * Technically Not tools · desktop-check/tests/live-preview-live.js — Live preview follows file
 * saves (31 "Live changes"): a "dev" server serves the project's own index.html and hot.html from
 * disk (no hot reload). Saving index.html reloads the shown page and the status spot says "Updated
 * · index.html"; a saved README.md (not a page file) changes nothing; a page that has a hot-reload
 * runtime (window.$RefreshReg$, as Vite/webpack React Refresh add) is not reloaded, only noted.
 * Each page load posts a marker to Technically Not.
 */
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
};
const bytes = text => new TextEncoder().encode(text);
const markers = [];
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

// like an agent editing the file on disk
const agentWrite = (rel, text) => main('write', rel, text);
const ys = []; // scroll positions the page reported when asked 'where'
window.addEventListener('message', event => {
  if (typeof event.data !== 'string') return;
  if (event.data.startsWith('TNAI_LIVE:')) markers.push(event.data.slice(10));
  if (event.data.startsWith('TNAI_Y:')) ys.push(Number(event.data.slice(7)));
});

// A tall page that scrolls to { to: y } and answers 'where' with its scroll position (the frame is
// another origin, so the test cannot read it).
const TALL =
  '<div style="height:3000px"></div><script>addEventListener("message", e => { if (e.data && e.data.to != null) scrollTo(0, e.data.to); if (e.data === "where") parent.postMessage("TNAI_Y:" + Math.round(scrollY), "*"); })</script>';
const page = (name, v, extra = '') =>
  '<!doctype html><title>' +
  name +
  '</title>' +
  extra +
  '<h1>' +
  name +
  ' ' +
  v +
  '</h1><script>parent.postMessage("TNAI_LIVE:' +
  name +
  ':' +
  v +
  '", "*")</script>';
const count = name => markers.filter(m => m.startsWith(name + ':')).length;

try {
  const server = [
    "const http = require('http'), fs = require('fs');",
    'const s = http.createServer((req, res) => {',
    "  const f = req.url.startsWith('/hot') ? 'hot.html' : 'index.html';",
    "  res.setHeader('Content-Type', 'text/html'); res.setHeader('Cache-Control', 'no-store');",
    '  res.end(fs.readFileSync(f));',
    '});',
    "s.listen(0, '127.0.0.1', () => console.log('  Local:   http://localhost:' + s.address().port + '/'));",
  ].join('\n');
  const fs = window.tnaiNative.fs;
  check((await fs.write('server.js', bytes(server)))?.ok, 'server.js written');
  check(
    (await fs.write('index.html', bytes(page('index', 1, TALL))))?.ok &&
      (
        await fs.write(
          'hot.html',
          bytes(page('hot', 1, '<script>window.$RefreshReg$ = function () {}</script>'))
        )
      )?.ok,
    'index.html and hot.html written'
  );

  // Written like an agent's edit: the app only re-reads the scripts when the watcher reports
  // package.json, and its own Save is left out of that.
  check(
    await agentWrite(
      'package.json',
      JSON.stringify({ name: 'live-check', scripts: { dev: 'node server.js' } })
    ),
    'package.json with a dev script written'
  );

  const lp = document.getElementById('livePreviewPage');
  window.TnaiLivePreviewPage.open();
  await wait(300);

  // ▶ Run menu on the browser toolbar (65; the "Your app" script list was removed in the purple
  // redesign).
  (await until(() => lp.querySelector('.lpp-run')))?.click();
  await wait(200);
  const runBtn = await until(() =>
    [...lp.querySelectorAll('.lpp-menu .lpp-mrow')]
      .find(r => r.querySelector('b')?.textContent === 'dev')
      ?.querySelector('.lp-go')
  );
  check(!!runBtn, 'dev script listed with Start in the ▶ Run menu');
  runBtn?.click();
  const running = await until(
    () => window.TnaiLivePreview.tabs().find(t => t.script === 'dev' && t.state === 'running'),
    20000
  );
  check(!!running, 'server running at ' + running?.url);
  check(await until(() => count('index'), 10000), 'index page loaded');
  await wait(800);
  const stateText = () => lp.querySelector('.lpp-stage .lp-state span')?.textContent || '';

  // 1. A saved page file: the page reloads by itself (no hot reload here) and the status spot says
  // what changed.
  const before = count('index');
  const frame = () =>
    [...lp.querySelectorAll('iframe')].find(f =>
      String(f.dataset.src || '').startsWith(running.url.replace(/\/$/, ''))
    );
  const scrollY = async () => {
    ys.length = 0;
    frame()?.contentWindow?.postMessage('where', '*');
    return (await until(() => (ys.length ? { y: ys[ys.length - 1] } : null), 3000))?.y;
  };
  frame()?.contentWindow?.postMessage({ to: 400 }, '*');
  await wait(400);
  const y1 = await scrollY();
  check(y1 === 400, 'page scrolled down before the save (at ' + y1 + ' px)');
  await agentWrite('index.html', page('index', 2, TALL));
  check(
    await until(() => markers.includes('index:2'), 5000),
    'saving index.html reloads the preview (loads ' + before + ' → ' + count('index') + ')'
  );
  await wait(1500);
  const y2 = await scrollY();
  check(
    y2 === 400,
    'the reloaded page is where the user had scrolled (at ' + y2 + ' px, was ' + y1 + ')'
  );
  check(
    await until(() => /^Updated · index\.html/.test(stateText()), 3000),
    'status spot says "' +
      stateText() +
      '" (no agent named: the only other panel is the dev server shell)'
  );

  // 1b. The user scrolls on right after a reload: the page stays where they went (the restore used
  // to put the old place back again 0.3 s and 1 s after the load, which pulled the view back up).
  await agentWrite('index.html', page('index', 3, TALL));
  check(
    await until(() => markers.includes('index:3'), 5000),
    'saving index.html again reloads the preview'
  );
  await wait(250);
  frame()?.contentWindow?.postMessage({ to: 2000 }, '*');
  await wait(1500);
  const y3 = await scrollY();
  check(
    y3 === 2000,
    'a scroll right after the reload is not pulled back (at ' + y3 + ' px, scrolled to 2000)'
  );
  await shot('live-preview-live-updated');
  check(
    await until(() => !/^Updated/.test(stateText()), 9000),
    'the note goes after a few seconds: "' + stateText() + '"'
  );

  // 2. A saved file that is not a page file: nothing happens.
  const n2 = count('index');
  await agentWrite('README.md', '# notes ' + Date.now());
  await wait(2000);
  check(
    count('index') === n2 && !/^Updated/.test(stateText()),
    'saving README.md neither reloads nor notes'
  );

  // 3. A page with a hot-reload runtime is left to update itself: noted, not reloaded.
  const hotUrl = running.url.replace(/\/$/, '') + '/hot.html';
  const added = window.TnaiLivePreview.addUrl(hotUrl);
  check(added?.ok, 'hot page added as a tab');
  window.TnaiLivePreview.select(added.id);
  check(await until(() => count('hot'), 10000), 'hot page loaded');
  await wait(1000);
  const h = count('hot');
  await agentWrite(
    'hot.html',
    page('hot', 2, '<script>window.$RefreshReg$ = function () {}</script>')
  );
  check(
    await until(() => /^Updated · .*hot\.html/.test(stateText()), 4000),
    'hot page change noted: "' + stateText() + '"'
  );
  await wait(1500);
  check(
    count('hot') === h && !markers.includes('hot:2'),
    'hot page not reloaded by Technically Not'
  );

  await window.TnaiLivePreview.stop(running.id).catch(() => {});
} catch (err) {
  check(false, 'threw: ' + (err?.stack || err));
}

return { ok, log };
