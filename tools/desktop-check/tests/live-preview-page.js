// Technically Not tools · desktop-check/tests/live-preview-page.js — Live preview page (65, left
// nav): opens from the nav, lists package.json's dev script, Start runs a tiny node server in a
// real Terminal pane and comes back to the page, the preview loads (marker via postMessage),
// leaving and returning keeps the same iframe (no reload), Pop out moves the preview into its own
// window that stays live on another page and docks on close / Bring back, Stop ends the server, a
// non-localhost address is refused. Screenshots: page running + at 1024×768. Returns {ok, log}.
// package.json is written like an agent's edit (main-process fs): the app re-reads the scripts only
// when its watcher reports the file, and its own Save is left out of that.
const mainCall = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'pk' + Date.now();
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
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

// which frame sent each marker: the Overview's Live preview thumbnail (94) loads the same page too
const sources = [];
window.addEventListener('message', event => {
  if (typeof event.data === 'string' && event.data.startsWith('TNAI_PREVIEW_MARKER:')) {
    markers.push(event.data);
    sources.push(event.source);
  }
});

try {
  const server = [
    "const http = require('http');",
    "const s = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html');",
    '  res.end(\'<!doctype html><title>t</title><h1 style="font:24px sans-serif;margin:40px">Preview page marker</h1><script>parent.postMessage("TNAI_PREVIEW_MARKER:" + Date.now(), "*")</script>\'); });',
    "s.listen(0, '127.0.0.1', () => console.log('  Local:   http://localhost:' + s.address().port + '/'));",
  ].join('\n');
  check((await window.tnaiNative.fs.write('server.js', bytes(server)))?.ok, 'server.js written');
  check(
    await mainCall(
      'write',
      'package.json',
      JSON.stringify(
        { name: 'page-check', scripts: { dev: 'node server.js', build: 'echo no' } },
        null,
        2
      )
    ),
    'package.json written'
  );

  const layout = document.querySelector('.layout'),
    page = document.getElementById('livePreviewPage');
  const nav = document.querySelector('.side-item[data-view="live-preview"]');
  check(!!nav && !!page && !!window.TnaiLivePreviewPage, 'nav item, page and API exist');
  nav.click();
  await wait(200);
  check(
    layout.classList.contains('preview-mode') && getComputedStyle(page).display !== 'none',
    'nav opens the page'
  );
  check(
    nav.classList.contains('active') &&
      !document.querySelector('.side-item.active:not([data-view="live-preview"])'),
    'only the Live preview nav item is active'
  );
  const pr = page.getBoundingClientRect();
  check(
    pr.width > 600 && pr.height > 400,
    'page fills the room: ' + Math.round(pr.width) + '×' + Math.round(pr.height)
  );

  // Purple redesign: the "Your app" side list became the ▶ Run menu on the browser toolbar (65);
  // the stage keeps its browser tab strip.
  check(!!page.querySelector('.lpp-stage .lp'), 'preview stage mounted');
  const empty = await until(() => page.querySelector('.lpp-stage .lp-blank'), 3000);
  check(
    !!empty && /Nothing to preview yet/.test(empty.textContent) && /Run/.test(empty.textContent),
    'empty stage says what to do first'
  );
  const menuRows = async () => {
    if (page.querySelector('.lpp-menu')?.hidden !== false) page.querySelector('.lpp-run')?.click();
    await wait(200);
    return [...page.querySelectorAll('.lpp-menu .lpp-mrow')];
  };
  const devRow = async () =>
    (await menuRows()).find(r => r.querySelector('b')?.textContent === 'dev');
  const runBtn = (await devRow())?.querySelector('.lp-go');
  check(
    !!runBtn && /Start/.test(runBtn.textContent),
    'dev script listed with Start in the ▶ Run menu'
  );
  check(
    !(await menuRows()).some(r => r.querySelector('b')?.textContent === 'build'),
    'build script not offered'
  );
  await shot('live-preview-page-empty');

  runBtn.click();
  const back = await until(
    () =>
      layout.classList.contains('preview-mode') &&
      window.TnaiLivePreview.tabs().some(
        t => t.script === 'dev' && (t.state === 'starting' || t.state === 'running')
      ),
    8000
  );
  check(!!back, 'Run comes back to the page with the server starting');
  const running = await until(
    () => window.TnaiLivePreview.tabs().find(t => t.script === 'dev' && t.state === 'running'),
    20000
  );
  check(!!running, 'server running at ' + running?.url);
  check(await until(() => markers.length, 10000), 'preview page loaded in the stage');
  await wait(300);
  const rowsNow = await menuRows();
  check(
    rowsNow.length === 1 && !!rowsNow[0].querySelector('.lp-stop'),
    'the ▶ Run menu: the running dev script with Stop, not listed twice'
  );
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  document.body.click();
  await wait(100);
  check(!page.querySelector('.lpp-stage .lp-blank'), 'empty state gone once something is shown');
  await shot('live-preview-page');

  // Leave and come back: the same iframe, no reload.
  const frame = page.querySelector('.lpp-stage iframe'),
    fromStage = () => sources.filter(w => w === frame.contentWindow).length,
    loads = fromStage();
  window.TnaiRoute('overview');
  await wait(150);
  check(
    !layout.classList.contains('preview-mode') && getComputedStyle(page).display === 'none',
    'another page hides it'
  );
  const t0 = performance.now();
  nav.click();
  const shownMs = performance.now() - t0;
  check(
    page.querySelector('.lpp-stage iframe') === frame,
    'coming back keeps the same iframe (open took ' + shownMs.toFixed(1) + ' ms)'
  );
  await wait(400);
  check(
    fromStage() === loads,
    'no reload on return (stage frame loads ' + loads + ' → ' + fromStage() + ')'
  );

  // Pop out: the preview moves into its own window, keeps working on another page, and comes back
  // when the window closes.
  const popBtn = page.querySelector('.lpp-stage .lpp-pop');
  check(!!popBtn && /Pop out/.test(popBtn.textContent), 'Pop out button in the preview bar');
  popBtn.click();
  const pwin = await until(() => window.TnaiLivePreviewPage.window(), 5000);
  check(!!pwin && pwin.name === 'tnai-panel-live-preview', 'pop-out window opened');
  const popMarkers = [];
  pwin?.addEventListener('message', event => {
    if (typeof event.data === 'string' && event.data.startsWith('TNAI_PREVIEW_MARKER:'))
      popMarkers.push(event.data);
  });
  check(
    !!pwin?.document.querySelector('.lp iframe') && !page.querySelector('.lpp-stage .lp'),
    'preview lives in the window, not the page'
  );
  check(
    !!page.querySelector('.lpp-stage .bw-away') &&
      /Bring back/.test(page.querySelector('.lpp-stage .bw-away').textContent),
    'page stage shows Show window / Bring back'
  );
  check(
    await until(() => popMarkers.length, 10000),
    'preview page loads in the window (marker from the frame)'
  );
  const onTop = pwin?.document.querySelector('.lpp-ontop');
  check(!!onTop && !onTop.hidden, 'On top shown in the window');
  window.TnaiRoute('overview');
  await wait(300);
  check(
    !pwin.closed && !!pwin.document.querySelector('.lp iframe'),
    'window keeps the preview while another page is open'
  );
  await shot('live-preview-page-popout');
  pwin.close();
  check(
    await until(
      () =>
        !window.TnaiLivePreviewPage.isOut() &&
        page.querySelector('.lpp-stage .lp') &&
        !page.querySelector('.lpp-stage .bw-away'),
      5000
    ),
    'closing the window brings the preview back'
  );
  nav.click();
  await wait(300);
  check(
    /Pop out/.test(page.querySelector('.lpp-stage .lpp-pop')?.textContent || ''),
    'button says Pop out again'
  );
  page.querySelector('.lpp-stage .lpp-pop').click();
  const pwin2 = await until(() => window.TnaiLivePreviewPage.window(), 5000);

  // In the popped-out window "On top" is a box like "Bring back" beside it: one height, one line,
  // nothing cut, the same room at both of its ends.
  if (pwin2) {
    await wait(400);
    const onTop = pwin2.document.querySelector('.lpp-ontop');
    const bring = pwin2.document.querySelector('.lpp-pop');
    const tick = onTop?.querySelector('input');
    const words = pwin2.document.createRange();
    if (onTop?.firstChild) words.selectNodeContents(onTop.firstChild);
    const a = bring?.getBoundingClientRect();
    const b = onTop?.getBoundingClientRect();
    const tickBox = tick?.getBoundingClientRect();
    const wordBox = words.getBoundingClientRect();
    const round = value => Math.round(value * 10) / 10;
    check(
      !!a &&
        !!b &&
        b.width > 0 &&
        Math.abs(a.height - b.height) <= 0.5 &&
        Math.abs(a.top - b.top) <= 0.5 &&
        b.left - a.right >= 3.5 &&
        b.right <= pwin2.innerWidth,
      'popped out, "On top" is a box of the height of "Bring back", on its line, inside the window: ' +
        (a && b
          ? round(a.height) +
            ' and ' +
            round(b.height) +
            ' high, tops ' +
            round(a.top) +
            ' and ' +
            round(b.top) +
            ', ' +
            round(b.left - a.right) +
            ' px apart, right edge ' +
            round(b.right) +
            ' of ' +
            pwin2.innerWidth
          : 'not found')
    );
    check(
      !!b &&
        !!tickBox &&
        tick.matches('.tnai-switch[role="switch"]') &&
        tickBox.width > tickBox.height &&
        Math.abs(wordBox.left - b.left - (b.right - tickBox.right)) <= 1.5 &&
        Math.abs(tickBox.top + tickBox.height / 2 - (b.top + b.height / 2)) <= 1,
      'its words and its switch (the one Settings uses) sit in the middle of it, with the same room at both ends: ' +
        (b && tickBox
          ? round(wordBox.left - b.left) + ' and ' + round(b.right - tickBox.right)
          : 'not found')
    );
  }
  page.querySelector('.lpp-stage .bw-away .primary')?.click();
  await wait(300);
  check(
    !!pwin2 && pwin2.closed && !!page.querySelector('.lpp-stage .lp iframe'),
    'Bring back docks it and closes the window'
  );

  // Address form refuses non-localhost.
  const input = page.querySelector('.lpp-stage .lp-url');
  input.focus();
  input.value = 'https://example.com';
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await wait(50);
  check(
    input.getAttribute('aria-invalid') === 'true' && /localhost/.test(input.title),
    'non-localhost address refused in the address bar: ' + input.title
  );
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

  window.resizeTo?.(1024, 768);
  await wait(400);
  await shot('live-preview-page-1024');

  (await devRow())?.querySelector('.lp-stop')?.click();
  check(
    await until(
      () => window.TnaiLivePreview.tabs().find(t => t.script === 'dev' && t.state === 'exited'),
      10000
    ),
    'Stop ends the server'
  );
  await wait(200);
  check(!!(await devRow())?.querySelector('.lp-go'), 'dev script offers Start again');
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
