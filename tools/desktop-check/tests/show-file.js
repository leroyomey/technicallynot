// Technically Not tools · desktop-check/tests/show-file.js — `tnai show FILE.html`
// (desktop/show-file.js) in the real app: a real PowerShell panel types the command, the file shows
// in the existing Live preview frame, and the shown page tries every way out it has (the bridge,
// node, storage, fetch / XHR / WebSocket / picture / script / style / beacon / link hints / frames
// / worker / WebRTC / form / pop-up / top navigation / navigating itself) against a listener that
// counts connections. First the same page is shown unwalled from the listener itself (the control),
// which must reach it, so a zero later means something. Also: the page server refuses everyone but
// the app, files outside the project are refused, a saved change shows, the tab is not saved, `tnai
// server list` does not name it, and `tnai shot preview` gives a picture. The browser is never
// opened (shell.openExternal is replaced). Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const info = label => log.push('info ' + label);
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'sf' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

try {
  const ports = await main('listen'),
    L = 'http://127.0.0.1:' + ports.tcp;
  const api = window.TnaiLivePreview,
    LPP = window.TnaiLivePreviewPage,
    N = window.tnaiNative;
  LPP.open();
  await wait(300);
  const panel = await until(() => document.querySelector('#livePreviewPage .lpp-stage .lp'));
  check(!!panel, 'the Live preview page is open');

  // ---- Control: the same page, served by the listener with no wall, in an ordinary preview tab.
  // It must reach the listener.
  const control = api.addUrl(L + '/control');
  const reached = await until(async () => {
    const h = await main('hits');
    return h.tcp.includes('/fetch') && h.tcp.includes('/img') && h;
  }, 15000);
  await wait(5500); // the slow ones: WebRTC, the timed refresh
  const c = await main('hits');
  check(
    !!reached,
    'control (no wall): the page reaches the listener, so the checks below can see a hole: ' +
      [...new Set(c.tcp)].join(' ')
  );
  info(
    'control: UDP packets from WebRTC ' +
      c.udp +
      ', pop-up handed to the browser ' +
      c.opened.length +
      ', preconnect events ' +
      c.preconnects.length
  );
  if (control.ok) api.close(control.id);
  await wait(400);
  await main('reset');

  // ---- The real thing: a file in the project, shown by `tnai show` typed into a real PowerShell
  // panel.
  const FILE = 'charts/report 1.html';
  await main('writePage', FILE, 'v1');
  await main('write', 'charts/neighbor.txt', 'SECRET-NEIGHBOR');
  const strip = s =>
    String(s || '')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
      .replace(/\s+/g, '');
  const text = async p => strip((await N.pty.replay(p))?.buffer);
  const pane = (await window.TnaiTest.open('Terminal'))?.paneId;
  LPP.open();
  await wait(300);
  check(
    !!pane && !!(await until(async () => (await text(pane)).includes('>'), 20000)),
    'PowerShell panel opened'
  );
  const tabsBefore = api.tabs().length;
  N.pty.write(pane, 'tnai show "' + FILE + '"\r');
  const said =
    (await until(async () => {
      const s = await text(pane);
      return (/Showingreport1\.html/.test(s) || /tnai:/.test(s)) && s;
    }, 25000)) || (await text(pane));
  const url =
    (/http:\/\/127\.0\.0\.1:\d+\/s\/[0-9a-f]{32}\/report%201\.html/.exec(said) || [])[0] || '';
  check(
    /Showingreport1\.html/.test(said) && !!url,
    '`tnai show` answers with the file and its address: ' + said.slice(-330)
  );
  check(/cutoff/.test(said) && /nonetwork/.test(said), 'the answer says the page is cut off');
  const tab = await until(() => api.tabs().find(t => t.url === url), 5000);
  check(!!tab && api.tabs().length === tabsBefore + 1, 'one new tab holds the shown file');
  const frame = await until(() => {
    const f = [...panel.querySelectorAll('.lp-frame')].find(x =>
      String(x.dataset.src).startsWith(url.split('/s/')[0])
    );
    return f?.dataset.loaded && f;
  }, 10000);
  check(!!frame, 'the page loaded in the existing Live preview frame');
  const done = await until(async () => {
    const p = await main('probe');
    return p?.r?.done && p;
  }, 30000);
  const r = done?.r || {};
  check(
    !!done,
    'the shown page ran its own script to the end' +
      (done ? '' : ': ' + JSON.stringify(await main('probe')))
  );

  // past the page's timed refresh
  await wait(Math.max(0, 5500 - (Date.now() - Number(frame?.dataset.loaded || Date.now()))));

  // ---- The wall, as the page itself found it.
  check(
    r.ran === 'yes' && r.data === '1',
    'inline script runs and a data: picture shows (what a chart needs)'
  );
  check(r.origin === 'null', 'the page has an origin of its own: ' + r.origin);
  check(
    r.bridge === 'undefined' && /^throws/.test(r.parentBridge) && /^throws/.test(r.topBridge),
    'no bridge: window.tnaiNative ' +
      r.bridge +
      ', parent ' +
      r.parentBridge +
      ', top ' +
      r.topBridge
  );
  check(
    r.require === 'undefined' && r.process === 'undefined',
    'no node: require ' + r.require + ', process ' + r.process
  );
  check(
    /^throws/.test(r.cookie) && /^throws/.test(r.localStorage) && /^throws/.test(r.sessionStorage),
    'no cookies or storage: ' + [r.cookie, r.localStorage, r.sessionStorage].join(' / ')
  );
  const net = [
    'fetch',
    'xhr',
    'ws',
    'img',
    'scriptSrc',
    'css',
    'neighbor',
    'file',
    'blankFrame',
    'worker',
  ];
  check(
    net.every(k => r[k] && !/LOADED/.test(r[k])),
    'every request is refused: ' + net.map(k => k + ' ' + r[k]).join(', ')
  );
  check(r.open === 'null' || /^throws/.test(r.open), 'window.open gives nothing: ' + r.open);
  check(/^throws/.test(r.topNav), 'navigating the app window is refused: ' + r.topNav);
  check(
    /^throws ReferenceError/.test(r.rtcEarly) &&
      /^rejects ReferenceError/.test(r.rtc) &&
      r.rtcNames === '0',
    'WebRTC is not there at all: first script ' +
      r.rtcEarly +
      ', later ' +
      r.rtc +
      ', names left ' +
      r.rtcNames +
      '; a child frame was ' +
      r.child
  );
  info(
    'sendBeacon says ' +
      r.beacon +
      ' (it always does; the listener below is the proof); history: replaceState ' +
      r.replaceState +
      ', pushState ' +
      r.pushState +
      '; form ' +
      r.form +
      '; frame ' +
      r.frame
  );
  let h = await main('hits');
  check(
    h.tcp.length === 0,
    'the listener got no connection from the shown page (requests, hints, frames, form, WebRTC over TCP, timed refresh): ' +
      (h.tcp.join(' ') || 'none')
  );
  check(h.udp === 0, 'the listener got no UDP packet (WebRTC): ' + h.udp);
  check(
    h.opened.length === 0,
    'nothing was handed to the browser: ' + (h.opened.join(' ') || 'none')
  );
  info('preconnect events for the listener: ' + h.preconnects.length);

  // ---- The page navigating its own frame: every kind is stopped, the document stays, the listener
  // hears nothing.
  const moves = {
    'to a local address': 'location.href = "' + L + '/nav"',
    'reload': 'location.reload()',
    'a clicked link': 'document.getElementById("link").click()',
  };
  for (const [name, code] of Object.entries(moves)) {
    const a = await main('act', code);
    check(
      a.alive === 2 && String(a.url).startsWith(url.split('/s/')[0]),
      'the page cannot navigate itself, ' + name + ': ' + JSON.stringify(a)
    );
  }
  h = await main('hits');
  check(
    h.tcp.length === 0 && h.opened.length === 0,
    'after those: still no connection and nothing handed to the browser: ' +
      (h.tcp.concat(h.opened).join(' ') || 'none')
  );

  // ---- The page server from outside the app.
  const o = await main('outside', url);
  check(
    o.noKey.status === 404 && !/Chart/.test(o.noKey.body),
    "without the app's key (a browser, another program) the address gives 404: " +
      o.noKey.status +
      ' "' +
      o.noKey.body +
      '"'
  );
  check(
    o.withKey.status === 200 &&
      /sandbox allow-scripts allow-forms;/.test(o.withKey.csp) &&
      /default-src 'none'/.test(o.withKey.csp) &&
      !/allow-same-origin|allow-popups|allow-top/.test(o.withKey.csp),
    'with the key: 200 and the wall in the header: ' + o.withKey.csp.slice(0, 90)
  );
  check(
    [o.wrongHost, o.wrongToken, o.neighbor, o.root, o.query].every(
      x => x.status === 404 && !/SECRET/.test(x.body)
    ),
    'another Host, another token, the neighbor file, the root and a query all give 404: ' +
      [o.wrongHost, o.wrongToken, o.neighbor, o.root, o.query].map(x => x.status).join(',')
  );
  check(
    /429/.test(o.burst) && /200/.test(o.burst),
    'a burst of loads is cut short (429): ' + o.burst
  );
  await wait(2300);

  // ---- A saved change shows (the app's own reload is allowed); a neighbor file does not reload
  // it.
  await main('write', 'charts/other.css', 'body{}');
  await wait(1600);
  const still = await main('probe');
  check(
    still?.alive === 2 && still.title === 'show v1',
    'a saved neighbor file does not reload the shown page'
  );
  await main('writePage', FILE, 'v2');
  const v2 = await until(async () => {
    const p = await main('probe');
    return p?.title === 'show v2' && p;
  }, 12000);
  check(!!v2, 'the saved file shows after the app reloads it: ' + (await main('probe'))?.title);
  await until(async () => (await main('probe'))?.r?.done, 30000);
  await wait(1200);

  // ---- Not saved, not a dev server.
  const saved = Object.keys(localStorage)
    .map(k => localStorage.getItem(k))
    .filter(v => v && v.includes('/s/' + url.split('/s/')[1].slice(0, 32)));
  check(saved.length === 0, 'the tab is not in the saved tab list');
  N.pty.write(pane, 'tnai server list\r');
  const listed =
    (await until(async () => {
      const s = await text(pane),
        at = s.lastIndexOf('tnaiserverlist');
      return at >= 0 && />$/.test(s) && s.slice(at).length > 20 && s.slice(at);
    }, 15000)) || '';
  check(
    !!listed && !listed.includes('/s/'),
    '`tnai server list` does not name the page server: ' + listed.slice(0, 160)
  );

  // ---- `tnai shot preview`: a picture of it; the hidden window's copy of the page reaches nothing
  // either.
  const since = Date.now();
  N.pty.write(pane, 'tnai shot preview\r');
  const shotSaid =
    (await until(async () => {
      const s = await text(pane),
        at = s.lastIndexOf('tnaishotpreview');
      return /Screenshotof|Noscreenshot|tnai:/.test(s.slice(at + 15)) && s.slice(at);
    }, 30000)) || '';
  const png = await main('shot', since);
  check(
    /Screenshotofhttp:\/\/127\.0\.0\.1:\d+\/s\//.test(shotSaid) && png?.bytes > 500,
    '`tnai shot preview` gives a picture of the shown file: ' +
      JSON.stringify(png) +
      ' ' +
      shotSaid.slice(0, 140)
  );
  await wait(1500);
  h = await main('hits');
  check(
    h.tcp.length === 0 && h.udp === 0 && h.opened.length === 0,
    'after the reload and the picture: still no connection, no packet, nothing handed to the browser: ' +
      (h.tcp.concat(h.opened).join(' ') || 'none')
  );

  // ---- What `tnai show` refuses.
  const no = await main('refuse');
  const refused = [
    'outside',
    'sibling',
    'junction',
    'notHtml',
    'missing',
    'folder',
    'big',
    'unc',
    'device',
  ];
  check(
    refused.every(k => no[k] && !/^SHOWN/.test(no[k])),
    'refused: ' +
      refused.map(k => k + ' = ' + no[k]).join(' | ') +
      (no.junctionMade ? ' (junction not made: ' + no.junctionMade + ')' : '')
  );
  N.pty.write(pane, 'tnai preview "' + FILE + '"\r');
  check(
    !!(await until(async () => /addressesonthiscomputeronly/.test(await text(pane)), 15000)) &&
      api.tabs().filter(t => t.kind === 'url').length === 1,
    '`tnai preview` still takes only an address, as before: the file is refused and no tab is added'
  );

  // ---- The one thing the page can do to its frame is empty it; nothing is reached that way.
  // (An address the app's own page policy does not allow in a frame is refused there, before the
  // frame guard and before any request; the frame is left empty.)
  const empties = {
    'an address on the web': 'location.href = "http://tnai-test.invalid/?d=leak"',
    'about:blank': 'location.href = "about:blank"',
    'a data: page':
      'location.href = "data:text/html,<script>location=\\"' + L + '/datanav\\"<\\/script>"',
    'a blob: page':
      'location.href = URL.createObjectURL(new Blob(["<script>location=\\"' +
      L +
      '/blobnav\\"<\\/script>"], { type: "text/html" }))',
  };
  const said2 = [];
  for (const [name, code] of Object.entries(empties)) {
    const el = [...panel.querySelectorAll('.lp-frame')].find(x =>
      String(x.dataset.src).startsWith(url.split('/s/')[0])
    );
    if (el) el.src = url; // the app's own page loads it again
    const back = await until(async () => (await main('probe'))?.alive === 1, 8000);
    const a = await main('act', code);
    await wait(600);
    said2.push(name + (back ? '' : ' (PAGE NOT BACK FIRST)') + ' -> ' + (a.gone || 'still there'));
    if (!back) ok = false;
  }
  h = await main('hits');
  check(
    h.tcp.length === 0 && h.udp === 0 && h.opened.length === 0,
    'a page that sends its own frame to ' +
      said2.join('; ') +
      ': reaches nothing: ' +
      (h.tcp.concat(h.opened).join(' ') || 'none')
  );

  // ---- Closing: the agent's own tab goes.
  N.pty.write(pane, 'tnai preview close\r');
  check(
    !!(await until(() => !api.tabs().some(t => t.url === url), 15000)),
    "`tnai preview close` closes the shown file's tab"
  );
  await main('stop');
} catch (error) {
  check(false, 'test threw: ' + (error?.stack || error));
}
return { ok, log };
