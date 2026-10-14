// Technically Not tools · desktop-check/tests/preview-ask.js — Live preview (31) extras on the Live
// preview page: the page's own errors show in a strip along the stage's bottom edge and "Ask agent
// to fix" puts them in the composer; "Click to ask" names the element clicked in the page in the
// composer (real mouse click into the preview frame); a new document clears the strip; picking an
// agent in the composer brings the page that agent showed to the front. Returns {ok, log}.
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

try {
  // ---- A project whose "dev" script serves one page: a full-size button, one console.error and
  // one thrown error.
  const server = [
    "const http = require('http');",
    'const s = http.createServer((req, res) => {',
    "  res.setHeader('Content-Type', 'text/html');",
    '  res.end(\'<!doctype html><title>t</title><button id="buy" class="cta" style="position:fixed;inset:0;width:100%;height:100%" onclick="console.error(String.fromCharCode(111,119,110))">Buy now</button><script>console.error("boom 42"); setTimeout(() => { throw new Error("kaput 7") }, 50); addEventListener("message", e => { if (e.data === "tnai-click") document.getElementById("buy").click(); if (e.data === "tnai-fake") { try { window.tnaiPreviewPick(JSON.stringify({ selector: "#evil", text: "page words" })) } catch (x) {} } });</script>\');',
    '});',
    "s.listen(0, '127.0.0.1', () => console.log('  Local:   http://localhost:' + s.address().port + '/'));",
  ].join('\n');
  check(
    (await window.tnaiNative.fs.write('server.js', bytes(server)))?.ok,
    'server.js written to the temp project folder'
  );
  check(
    await mainCall(
      'write',
      'package.json',
      JSON.stringify({ name: 'preview-ask', scripts: { dev: 'node server.js' } }, null, 2)
    ),
    'package.json with a dev script written'
  );

  const api = window.TnaiLivePreview,
    page = document.getElementById('livePreviewPage'),
    prompt = document.getElementById('prompt');
  window.TnaiLivePreviewPage.open();
  await wait(300);
  const panel = await until(() => page.querySelector('.lpp-stage .lp'));
  const menuRows = async () => {
    if (page.querySelector('.lpp-menu')?.hidden !== false) page.querySelector('.lpp-run')?.click();
    await wait(200);
    return [...page.querySelectorAll('.lpp-menu .lpp-mrow')];
  };
  const rows =
    (await until(async () => {
      const r = await menuRows();
      return r.length && r;
    }, 5000)) || [];
  rows
    .find(r => r.querySelector('b')?.textContent === 'dev')
    ?.querySelector('.lp-go')
    ?.click();
  const running = await until(() => api.tabs()[0]?.state === 'running' && api.tabs()[0], 30000);
  check(!!running, 'dev server running at ' + running?.url);
  const frame = await until(() => {
    const f = panel.querySelector('.lp-frame');
    return f?.dataset.loaded && f;
  }, 10000);
  check(!!frame, 'the page is loaded in the preview frame');

  // ---- The page's errors: a strip on the stage, expandable, and into the composer.
  const pick = panel.querySelector('.lp-bar [data-act=pick]');
  check(
    !!pick && !pick.disabled && pick.getAttribute('aria-pressed') === 'false',
    'Click to ask button in the address row, enabled, off'
  );
  const strip = await until(() => {
    const s = panel.querySelector('.lp-stage>.lp-errs');
    return s && !s.hidden && /2 page errors/.test(s.textContent) && s;
  }, 8000);
  check(
    !!strip,
    'strip shows 2 page errors: ' +
      (panel.querySelector('.lp-errs')?.textContent || '(none)').slice(0, 120)
  );
  const sr = strip?.getBoundingClientRect(),
    st = panel.querySelector('.lp-stage').getBoundingClientRect();
  check(
    !!sr &&
      sr.left >= st.left &&
      sr.right <= st.right + 1 &&
      sr.bottom <= st.bottom + 1 &&
      sr.height < 40,
    'strip is one line inside the stage (' +
      Math.round(sr?.width) +
      '×' +
      Math.round(sr?.height) +
      ')'
  );
  await shot('preview-ask-errors');
  panel.querySelector('.lp-errs-head').click();
  await wait(150);
  const items = [...panel.querySelectorAll('.lp-errs-list li')].map(li => li.textContent);
  check(
    items.length === 2 && items.some(t => /boom 42/.test(t)) && items.some(t => /kaput 7/.test(t)),
    'the list names both errors: ' + items.join(' | ')
  );
  prompt.value = '';
  panel.querySelector('.lp-errs-ask').click();
  await wait(150);
  check(
    /reports these errors/.test(prompt.value) &&
      /boom 42/.test(prompt.value) &&
      /kaput 7/.test(prompt.value) &&
      prompt.value.includes(running.url),
    '"Ask agent to fix" puts the errors and the address in the composer'
  );
  panel.querySelector('.lp-errs-x').click();
  await wait(150);
  check(
    !panel.querySelector('.lp-errs') || panel.querySelector('.lp-errs').hidden,
    '× clears the strip'
  );

  // ---- A page that reports a pick nobody asked for: nothing reaches the
  // composer and the keyboard focus stays where it is.
  prompt.value = '';
  prompt.blur();
  const focusBefore = document.activeElement;
  frame.contentWindow.postMessage('tnai-fake', '*');
  await wait(800);
  check(
    prompt.value === '' &&
      document.activeElement === focusBefore &&
      pick.getAttribute('aria-pressed') === 'false',
    'a pick the page reports by itself changes nothing: composer "' +
      prompt.value.slice(0, 60) +
      '", focus ' +
      (document.activeElement === focusBefore ? 'unmoved' : 'moved')
  );

  // ---- Click to ask: a real click in the page names the element, and the page's own click handler
  // does not run.
  prompt.value = '';
  pick.click();
  check(
    !!(await until(
      () =>
        pick.getAttribute('aria-pressed') === 'true' &&
        /Click an element/.test(panel.querySelector('.lp-state').textContent),
      3000
    )),
    'picking on: button pressed, the status spot says what to do'
  );
  await wait(300);

  // the page clicks its own button: the test runner's mouse input does not reach a cross-site frame
  frame.contentWindow.postMessage('tnai-click', '*');
  check(
    !!(await until(() => /#buy/.test(prompt.value), 5000)),
    'the clicked element is named in the composer: ' +
      prompt.value.replace(/\n/g, ' / ').slice(0, 160)
  );
  check(
    /Buy now/.test(prompt.value) &&
      prompt.value.includes(running.url) &&
      /Change: $/.test(prompt.value),
    'with its text, the address and room to type the change'
  );
  check(
    !!(await until(() => pick.getAttribute('aria-pressed') === 'false', 2000)),
    'picking is off again after one click'
  );
  check(
    !/3 page errors/.test(panel.querySelector('.lp-errs:not([hidden])')?.textContent || ''),
    'the click handler of the page itself did not run'
  );
  {
    const had = prompt.value;
    frame.contentWindow.postMessage('tnai-fake', '*');
    await wait(800);
    check(
      prompt.value === had && !/#evil|page words/.test(prompt.value),
      'after the one pick the page can add nothing more by itself'
    );
  }
  await shot('preview-ask-picked');

  // ---- A new document clears the errors of the old one, then the page reports its own again.
  panel.querySelector('.lp-bar [data-act=reload]').click();
  check(
    !!(await until(
      () => /2 page errors/.test(panel.querySelector('.lp-errs:not([hidden])')?.textContent || ''),
      8000
    )),
    'after Reload the strip counts 2 again (not 4)'
  );

  // ---- The preview follows the agent picked in the composer: its own tab comes to the front.
  const mine = api.tabs()[0].id;
  window.dispatchEvent(
    new CustomEvent('tnai:target-changed', { detail: { paneId: 'no-such-panel' } })
  );
  await wait(150);
  check(
    api.tabs().find(t => t.active)?.id === mine,
    'an agent that showed no page leaves the open tab alone'
  );

  // ---- "Ask agent to fix" goes to the panel tied to this page: a panel that shows an address the
  // user's own tab already has (`tnai preview` on an open tab) becomes the composer's target on the
  // click, whichever agent was picked before.
  const N = window.tnaiNative,
    flat = s =>
      String(s || '')
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
        .replace(/\s+/g, '');
  const shown = (await window.TnaiTest.open('Terminal'))?.paneId,
    other = (await window.TnaiTest.open('Terminal'))?.paneId;
  check(
    !!shown &&
      !!other &&
      !!(await until(async () => flat((await N.pty.replay(shown))?.buffer).includes('>'), 20000)),
    'two PowerShell panels opened'
  );
  N.pty.write(shown, 'tnai preview ' + running.url + '\r');
  check(
    !!(await until(
      async () => /Showing|tnai:/.test(flat((await N.pty.replay(shown))?.buffer)),
      20000
    )),
    'one of them ran `tnai preview` on the address of the open tab'
  );
  window.TnaiLivePreviewPage.open();
  await wait(300);
  window.TnaiLiveTasks.setTarget(other);
  await wait(200);
  const errsBtn = await until(
    () => page.querySelector('.lp-errs:not([hidden]) .lp-errs-ask'),
    8000
  );
  prompt.value = '';
  errsBtn?.click();
  await wait(200);
  check(
    window.TnaiLiveTasks.target() === shown && /reports these errors/.test(prompt.value),
    '"Ask agent to fix" picks the panel that showed this page, not the one picked before (target ' +
      (window.TnaiLiveTasks.target() === shown
        ? 'shown'
        : window.TnaiLiveTasks.target() === other
          ? 'other'
          : 'none') +
      ')'
  );
  prompt.value = '';
  panel.querySelector('.lp-bar [data-act=run]').click();
  await until(() => api.tabs()[0]?.state === 'exited', 10000);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
