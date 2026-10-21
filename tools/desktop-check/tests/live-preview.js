// Technically Not tools · desktop-check/tests/live-preview.js — Live preview (31) on the Live
// preview page (65): package.json "dev" runs a tiny node server (free port) in a real PowerShell
// thread, the served URL is read from its output, the iframe loads the page (marker via
// postMessage), a second manual-URL tab opens and closes, a non-localhost URL is refused; a
// PowerShell thread in its own git worktree gets TNAI_PREVIEW_PORT (a free port, not the project
// server's; a project-folder panel gets none), serves its copy there and runs `tnai preview`: the
// tab is labeled ⎇ <worktree> beside the project's tab (1024 px screenshot), the lane server is
// stopped; Stop ends the project server and shows it. git isolated by live-preview.main.js. No
// agent prompts. Returns {ok, log}. package.json is written like an agent's edit (main-process fs):
// the app re-reads the scripts only when its watcher reports the file, and its own Save is left out
// of that.
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
window.addEventListener('message', event => {
  if (typeof event.data === 'string' && event.data.startsWith('TNAI_PREVIEW_MARKER:'))
    markers.push({ data: event.data, origin: event.origin, source: event.source });
});

try {
  // ---- A project whose "dev" script serves a page that reports back to Technically Not (free port
  // chosen by the OS).
  const server = [
    "const http = require('http');",
    'const s = http.createServer((req, res) => {',
    "  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('X-Frame-Options', 'DENY');",
    "  res.setHeader('Content-Type', 'text/html');",
    '  res.end(\'<!doctype html><title>t</title><h1>Technically Not preview marker</h1><script>function post(){parent.postMessage("TNAI_PREVIEW_MARKER:" + location.pathname + ":" + innerWidth, "*")} addEventListener("resize", post); post();</script>\');',
    '});',
    "s.listen(+process.argv[2] || 0, '127.0.0.1', () => console.log('  Local:   http://localhost:' + s.address().port + '/'));",
  ].join('\n');
  check(
    (await window.tnaiNative.fs.write('server.js', bytes(server)))?.ok,
    'server.js written to the temp project folder'
  );
  check(
    await mainCall(
      'write',
      'package.json',
      JSON.stringify(
        { name: 'preview-check', scripts: { dev: 'node server.js', build: 'echo no' } },
        null,
        2
      )
    ),
    'package.json with a dev script written'
  );

  const api = window.TnaiLivePreview;
  check(!!api, 'window.TnaiLivePreview exists (desktop)');
  check(
    api.localUrl('http://localhost:5173') &&
      api.localUrl('127.0.0.1:8080/x') &&
      api.localUrl('http://[::1]:3000/'),
    'localhost, 127.0.0.1 and [::1] are accepted'
  );
  check(
    !api.localUrl('https://example.com') &&
      !api.localUrl('http://192.168.1.2:3000') &&
      !api.localUrl('file:///C:/x.html') &&
      !api.localUrl('http://localhost.evil.com') &&
      !api.localUrl('javascript:alert(1)'),
    'non-localhost, file:, javascript: are refused'
  );

  // ---- The Live preview page: its ▶ Run menu lists the project's scripts.
  const layout = document.querySelector('.layout'),
    page = document.getElementById('livePreviewPage');
  window.TnaiLivePreviewPage.open();
  await wait(300);
  const P = () => page.querySelector('.lpp-stage .lp');
  let panel = await until(P);
  check(
    !!panel && layout.classList.contains('preview-mode'),
    'Live preview page open, preview mounted'
  );
  const first = panel;
  const enter = (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  };

  // the page shows the status as a dot; these are its words
  const statusText = () => api.status(api.tabs().find(t => t.active)?.id)?.text || '';
  const menuRows = async () => {
    if (page.querySelector('.lpp-menu')?.hidden !== false) page.querySelector('.lpp-run')?.click();
    await wait(200);
    return [...page.querySelectorAll('.lpp-menu .lpp-mrow')];
  };
  const rowNames = (
    (await until(async () => {
      const rows = await menuRows();
      return rows.length && rows;
    }, 5000)) || []
  ).map(r => r.querySelector('b')?.textContent);
  const scriptBtn = (await menuRows())
    .find(r => r.querySelector('b')?.textContent === 'dev')
    ?.querySelector('.lp-go');
  check(
    !!scriptBtn && !rowNames.includes('build'),
    'the ▶ Run menu offers the dev script from package.json (not build): ' + rowNames.join(', ')
  );

  // ---- Non-localhost URL refused for embedding.
  const field = panel.querySelector('.lp-url');
  enter(field, 'https://example.com');
  await wait(100);
  check(
    field.getAttribute('aria-invalid') === 'true' &&
      /Only addresses on this computer/.test(panel.querySelector('.lp-state').textContent) &&
      !api.tabs().length &&
      !panel.querySelector('.lp-frame'),
    'https://example.com refused, no tab, no iframe'
  );
  field.value = '';
  field.blur();

  // ---- Start the dev script via the UI.
  const t0 = Date.now();
  scriptBtn.click();
  check(!!(await until(() => api.tabs()[0]?.state === 'starting', 3000)), 'tab shows starting');
  const running = await until(() => api.tabs()[0]?.state === 'running' && api.tabs()[0], 30000);
  check(
    !!running && /^http:\/\/localhost:\d+\/$/.test(running.url),
    'URL detected from the PowerShell thread output: ' +
      running?.url +
      ' (' +
      (Date.now() - t0) +
      ' ms)'
  );
  check(
    !!(await until(() => layout.classList.contains('preview-mode'), 3000)),
    'on the Live preview page after the PowerShell thread was started'
  );
  check(
    first.isConnected && P() === first,
    'the same preview is still mounted (not rebuilt by the page switch)'
  );
  panel = P();
  await wait(50);
  const paneId = running?.paneId;
  check(
    !!paneId &&
      !!window.TnaiAgents.sessions().find(
        s => s.paneId === paneId && s.agent === 'Terminal' && s.running
      ),
    'server runs in a real PowerShell session ' + paneId
  );
  check(
    !!(await until(() => window.TnaiThreadList?.thread?.(paneId), 5000)),
    'that session is a thread: it has its row in the thread list'
  );
  check(
    /Running at http:\/\/localhost/.test(statusText()) &&
      !!panel.querySelector('.lp-state .bw-dot')?.dataset.s &&
      panel.querySelector('.lp-state').title === statusText(),
    "status on the dot's hover text: " +
      statusText() +
      ' (dot ' +
      panel.querySelector('.lp-state .bw-dot')?.dataset.s +
      ')'
  );
  const frame = await until(() => panel.querySelector('.lp-frame:not([hidden])'));
  check(
    frame?.getAttribute('src') === running?.url &&
      /allow-scripts/.test(frame?.getAttribute('sandbox')) &&
      !/allow-top-navigation/.test(frame?.getAttribute('sandbox')),
    'iframe embeds the URL, sandboxed without top navigation'
  );
  const origin = running ? new URL(running.url).origin : '';
  check(
    !!(await until(
      () =>
        markers.find(m => /^TNAI_PREVIEW_MARKER:\/(:\d+)?$/.test(m.data) && m.origin === origin),
      10000
    )) && !!(await until(() => frame.dataset.loaded)),
    'iframe loaded the served page despite X-Frame-Options: DENY (marker from ' + origin + ')'
  );
  await shot('live-preview-running');

  // ---- Second tab: manual localhost URL.
  panel.querySelector('.lp-tab-add').click();
  await wait(100);
  check(
    !panel.querySelector('.lp-tab.active') && document.activeElement === field,
    '＋ opens an empty tab with the address box focused'
  );
  enter(field, origin.replace('localhost', '127.0.0.1') + '/second');
  check(
    !!(await until(
      () => api.tabs().length === 2 && api.tabs()[1].kind === 'url' && api.tabs()[1].active
    )),
    'manual URL tab added and active: ' + api.tabs()[1]?.url
  );
  check(
    !!(await until(
      () => markers.find(m => /^TNAI_PREVIEW_MARKER:\/second(:\d+)?$/.test(m.data)),
      10000
    )),
    'second tab loaded /second'
  );
  check(
    panel.querySelectorAll('.lp-tab').length === 2 && /Manual URL/.test(statusText()),
    'two tabs; manual one labeled as not started by Technically Not'
  );
  const saved = JSON.parse(localStorage.getItem('tnai.live-preview.v1') || '{}');
  const entry = Object.values(saved)[0];
  check(
    entry?.tabs?.length === 2 &&
      entry.tabs[0].script === 'dev' &&
      entry.tabs[1].url?.endsWith('/second') &&
      !('state' in entry.tabs[0]),
    'saved per project folder (script + URL, no running state)'
  );

  // Close the manual tab.
  panel.querySelectorAll('.lp-tab')[1].querySelector('.lp-tab-close').click();
  check(
    !!(await until(
      () =>
        api.tabs().length === 1 &&
        api.tabs()[0].active &&
        panel.querySelectorAll('.lp-frame').length === 1
    )),
    'manual tab closed, its iframe removed, dev tab active again'
  );

  // ---- Device frames: Phone exists, a chosen size really sets the frame's own CSS-pixel viewport
  // (the served page reports its own window.innerWidth back via postMessage on load and on resize),
  // rotate swaps it, and the choice is remembered per device.
  check(
    !!panel.querySelector('.lp-modes [data-device="phone"]'),
    'Phone device option exists next to Desktop and Tablet'
  );
  const sizeSelect = panel.querySelector('.lp-size');
  check(
    !!sizeSelect && sizeSelect.hidden && sizeSelect.options.length === 1,
    'Desktop has no size to pick: it always fills the preview area'
  );
  const stageFrame = () =>
    // not the Overview thumbnail, which loads the same page
    panel.querySelector('.lp-frame-shell:not([hidden]) .lp-frame')?.contentWindow;
  const rootMarkerWidth = async () => {
    const list = markers.filter(
      m =>
        m.origin === origin &&
        m.source === stageFrame() &&
        /^TNAI_PREVIEW_MARKER:\/(:\d+)?$/.test(m.data)
    );
    const last = list[list.length - 1];
    return last ? Number(last.data.split(':').pop()) : null;
  };

  markers.length = 0;
  panel.querySelector('.lp-modes [data-device="phone"]').click();
  await wait(50);
  check(panel.querySelector('.lp-stage').dataset.device === 'phone', 'Phone mode selected');
  check(
    !sizeSelect.hidden && sizeSelect.options.length >= 4,
    'a size picker with several real sizes is offered for Phone'
  );
  const seOption = [...sizeSelect.options].find(o => o.value === 'se');
  check(
    !!seOption && /375.*667/.test(seOption.textContent),
    'iPhone SE 375×667 is one of the offered phone sizes'
  );
  sizeSelect.value = 'se';
  sizeSelect.dispatchEvent(new Event('change'));
  await wait(150);
  const wPortrait = await until(rootMarkerWidth, 4000);
  check(
    wPortrait === 375,
    "choosing iPhone SE really sets the frame's inner viewport width to 375: got " + wPortrait
  );
  check(
    /375.*667/.test(panel.querySelector('.lp-size-label')?.textContent || ''),
    'size and scale shown: ' + panel.querySelector('.lp-size-label')?.textContent
  );

  const rotateBtn = panel.querySelector('.lp-rotate');
  check(!!rotateBtn && !rotateBtn.hidden, 'a rotate toggle is offered for Phone');
  markers.length = 0;
  rotateBtn.click();
  await wait(150);
  const wLandscape = await until(rootMarkerWidth, 4000);
  check(wLandscape === 667, 'rotate swaps the viewport to 667 wide: got ' + wLandscape);

  const devicePrefs = JSON.parse(localStorage.getItem('tnai.live-preview-device.v1') || '{}');
  check(
    devicePrefs.device === 'phone' &&
      devicePrefs.phone?.size === 'se' &&
      devicePrefs.phone?.landscape === true,
    'the device, size and rotation are remembered: ' + JSON.stringify(devicePrefs)
  );

  rotateBtn.click();
  await wait(50); // back to portrait
  check(!!panel.querySelector('.lp-modes [data-device="tablet"]'), 'Tablet device option exists');
  panel.querySelector('.lp-modes [data-device="desktop"]').click();
  await wait(50);
  check(panel.querySelector('.lp-rotate').hidden, 'no rotate toggle for Desktop');
  check(
    sizeSelect.value === 'fit' &&
      panel.querySelector('.lp-size-label')?.textContent === '' &&
      !panel.querySelector('.lp-stage').classList.contains('lp-framed'),
    'Desktop defaults to filling the stage (size "' + sizeSelect.value + '", no device frame)'
  );

  // ---- A worktree agent's own dev server: a free port of its own and a ⎇-labeled tab next to the
  // project's (the project tab above is unchanged).
  const windows = /Windows/.test(navigator.userAgent),
    native = window.tnaiNative;
  const bufferOf = async id =>
    String((await native.pty.replay(id))?.buffer || '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');

  // A PowerShell thread; `own` gives it a git worktree of its own (the same choice the prompt
  // box's "Own worktree" hands to the start).
  async function newShell(own) {
    if (own) await window.TnaiWorktrees?.refresh?.();
    const options = own ? { tool: 'Terminal', worktree: true } : { tool: 'Terminal' };
    const id = (await window.TnaiTest.startThread(options)).paneId;
    await until(async () => />\s*$|\$\s*$/.test(await bufferOf(id)), 10000);
    return id;
  }
  const shellA = await newShell(false);
  window.TnaiAgents.send(
    shellA,
    'git init -q; git config user.email tnai-test@example.com; git config user.name Technically-Not-Test; git config commit.gpgsign false; git add -A; git commit -qm initial; ' +
      (windows ? 'Write-Output "TP=[$env:TNAI_PREVIEW_PORT]"' : 'echo "TP=[$TNAI_PREVIEW_PORT]"')
  );
  check(
    !!(await until(async () => {
      const st = (await native.git.status()).value;
      return st?.repo && !st.initial;
    }, 15000)),
    'project folder is a git repo with a first commit'
  );
  check(
    !!(await until(async () => /TP=\[\]/.test(await bufferOf(shellA)), 8000)),
    'a project-folder panel gets no TNAI_PREVIEW_PORT (unchanged)'
  );
  await window.TnaiGit?.refresh?.();
  const lanePane = await newShell(true);
  const laneSession = (await native.pty.list()).find(x => x.paneId === lanePane);
  const laneWt = (await native.git.worktrees()).value?.items?.find(
    i => laneSession && i.dir.toLowerCase() === String(laneSession.cwd).toLowerCase()
  );
  check(
    !!laneWt && /^tnai\/terminal-[0-9a-f]{6}$/.test(laneWt.branch),
    'a PowerShell panel runs in its own worktree ' + laneWt?.branch + ' at ' + laneSession?.cwd
  );
  window.TnaiAgents.send(
    lanePane,
    windows ? 'Write-Output "LP=[$env:TNAI_PREVIEW_PORT]"' : 'echo "LP=[$TNAI_PREVIEW_PORT]"'
  );
  const lanePort = Number(
    (await until(async () => /LP=\[(\d+)\]/.exec(await bufferOf(lanePane)), 8000))?.[1] || 0
  );
  const projectPort = Number(new URL(running.url).port);
  check(
    lanePort > 0 && lanePort !== projectPort,
    'the worktree panel gets TNAI_PREVIEW_PORT ' +
      lanePort +
      ", not the project server's " +
      projectPort
  );
  window.TnaiAgents.send(
    lanePane,
    windows
      ? '$srv = Start-Process node -ArgumentList \'server.js\',$env:TNAI_PREVIEW_PORT -PassThru -NoNewWindow; Start-Sleep -Milliseconds 800; tnai preview "http://localhost:$env:TNAI_PREVIEW_PORT/"'
      : 'node server.js $TNAI_PREVIEW_PORT & sleep 0.8; tnai preview "http://localhost:$TNAI_PREVIEW_PORT/"'
  );
  const laneUrl = 'http://localhost:' + lanePort + '/';
  const laneTab = await until(
    () => api.tabs().find(t => t.kind === 'url' && t.url === laneUrl),
    15000
  );
  check(
    !!laneTab && laneTab.lane === laneWt?.branch,
    'tnai preview from the worktree panel adds a tab for its copy, lane ' + laneTab?.lane
  );
  check(
    !!(await until(
      async () =>
        (await bufferOf(lanePane))
          .replace(/\s+/g, '')
          .includes('tablabeledwithyourworktree⎇terminal-'),
      10000
    )),
    'the shell is told the tab carries its worktree name'
  );
  check(
    !!api
      .tabs()
      .find(t => t.kind === 'script' && t.state === 'running' && t.url === running.url && !t.lane),
    "the project folder's dev tab is still running, unlabeled"
  );
  window.TnaiLivePreviewPage.open();
  panel = await until(() => layout.classList.contains('preview-mode') && P()?.offsetParent && P());
  const laneLabel = [...panel.querySelectorAll('.lp-tab-name')].map(n => n.textContent);
  check(
    laneLabel.length === 2 &&
      laneLabel[0].startsWith('dev · localhost:' + projectPort) &&
      laneLabel[1] === '⎇ ' + laneWt?.branch.slice(5) + ' · localhost:' + lanePort,
    'tab labels: ' + JSON.stringify(laneLabel)
  );
  const laneOrigin = new URL(laneUrl).origin;
  check(
    !!(await until(() => markers.find(m => m.origin === laneOrigin), 10000)),
    "the worktree tab loaded its own server's page (" + laneOrigin + ')'
  );
  await main('size', 1024, 720);
  await until(() => window.innerWidth <= 1024, 3000);
  await wait(600);
  log.push(
    'info shot: ' +
      window.innerWidth +
      '×' +
      window.innerHeight +
      ' ' +
      layout.className +
      ' ' +
      document.visibilityState
  );
  await shot('live-preview-worktree');
  window.TnaiAgents.send(lanePane, windows ? 'Stop-Process -Id $srv.Id' : 'kill %1');
  check(
    !!(await until(async () => (await window.TnaiTest.request(laneUrl)).status === 0, 8000)),
    'the worktree dev server was stopped'
  );
  await window.TnaiAgents.stop?.(lanePane);
  await window.TnaiAgents.stop?.(shellA);
  if (laneTab) api.close(laneTab.id);
  await main('size', 1440, 900);
  api.select(api.tabs()[0]?.id);
  await until(() => panel.querySelector('.lp-bar [data-act=run].lp-stop'), 5000);
  check(
    api.tabs().length === 1 && api.tabs()[0].active && api.tabs()[0].state === 'running',
    'worktree tab closed, the project dev tab active and running'
  );

  // ---- Stop: the pane process ends and the state says so.
  check((await window.TnaiTest.request(running.url)).ok, 'server answers before Stop');
  const t1 = Date.now();
  panel.querySelector('.lp-bar [data-act=run]').click();
  const exited = await until(() => api.tabs()[0]?.state === 'exited' && api.tabs()[0], 10000);
  check(
    !!exited && exited.stopped,
    'Stop → state exited (stopped by user, code ' +
      exited?.exitCode +
      ', ' +
      (Date.now() - t1) +
      ' ms)'
  );
  check(/Stopped/.test(statusText()), 'status shows Stopped: ' + statusText());
  check(
    !panel.querySelector('.lp-frame'),
    'iframe gone (' + panel.querySelectorAll('.lp-frame').length + ' left)'
  );
  check(
    /Start/.test(panel.querySelector('.lp-bar [data-act=run].lp-go')?.textContent || '') &&
      !!panel.querySelector('.lp-bar [data-act=run].lp-go svg'),
    'Start offered (▶ icon + Start, purple redesign)'
  );
  const dead = await until(async () => {
    try {
      await fetch(running.url, { cache: 'no-store' });
      return false;
    } catch {
      return true;
    }
  }, 8000);
  check(!!dead, 'the server no longer answers');
  check(
    !window.TnaiAgents.sessions().find(s => s.paneId === paneId)?.running,
    'the PowerShell process ended'
  );
  await shot('live-preview-stopped');
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
