// Technically Not desktop · preview-emulation.js — Live preview (31) device emulation for one
// localhost iframe at a time, never Technically Not's own page: a DevTools-protocol client on
// Technically Not's window (and each panel pop-out) auto-attaches to cross-site iframes, reads the
// iframe's name, and for a preview frame named tnai-lp-* with a Phone/Tablet preset sets the
// device's user agent (navigator.userAgent, userAgentData, request headers) and touch emulation
// (pointer: coarse, hover: none, maxTouchPoints, ontouchstart). The first request's User-Agent
// header is set by webRequest (the request leaves before the frame's target exists). Not emulated
// (Chromium allows it for top-level pages only): devicePixelRatio, screen size, mouse → touch
// events. The same client also reports from preview frames only: the element the user picks in the
// page (pick → push preview:picked, via a Runtime binding), the page's errors (exceptions,
// console.error, failed loads → preview:error) and each new document (preview:loaded); all go to
// the window that owns the frame's debugger.
'use strict';
const chrome = process.versions.chrome || '120.0.0.0',
  major = chrome.split('.')[0];
const IOS_PHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD =
  // iPadOS Safari asks for desktop sites by default
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const android = (model, mobile) =>
  'Mozilla/5.0 (Linux; Android 14; ' +
  model +
  ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
  major +
  '.0.0.0 ' +
  (mobile ? 'Mobile ' : '') +
  'Safari/537.36';
const brands = [
  { brand: 'Chromium', version: major },
  { brand: 'Google Chrome', version: major },
  { brand: 'Not-A.Brand', version: '99' },
];
const meta = (platform, platformVersion, model, mobile, withBrands) => ({
  brands: withBrands ? brands : [],
  platform,
  platformVersion,
  architecture: '',
  model,
  mobile,
});
const ios = {
  userAgent: IOS_PHONE,
  platform: 'iPhone',
  userAgentMetadata: meta('iOS', '17.5', 'iPhone', true),
  label: 'iPhone UA · touch',
};
const ipad = {
  userAgent: IPAD,
  platform: 'MacIntel',
  userAgentMetadata: meta('macOS', '10.15.7', '', false),
  label: 'iPad UA · touch',
};
const droid = (model, mobile) => ({
  userAgent: android(model, mobile),
  platform: 'Linux armv8l',
  userAgentMetadata: meta('Android', '14.0.0', model, mobile, true),
  label: 'Android UA · touch',
});

// Keyed by the preset ids in 31-live-preview.js. Surface Pro keeps Technically Not's own (Windows)
// user agent and only gets touch.
const PROFILES = {
  se: ios,
  i15: ios,
  i15pm: ios,
  pixel8: droid('Pixel 8', true),
  s24: droid('SM-S921B', true),
  sm: droid('Android', true),
  ipadmini: ipad,
  ipad10: ipad,
  ipadair: ipad,
  ipadpro13: ipad,
  tabs9: droid('SM-X710', false),
  surfacepro: { label: 'touch' },
};
const NAME = /^tnai-lp-[\w-]{1,120}$/;
const wanted = new Map(); // iframe name -> preset id
const sessions = new Map(); // CDP session id -> { dbg, name }

// iframe names with a pick the user opened and that has not reported yet (pick below)
const picks = new Set();

async function apply(dbg, sessionId, id) {
  const p = PROFILES[id] || null;
  const send = (method, params) => dbg.sendCommand(method, params, sessionId);

  // An empty user agent restores the default.
  await send(
    'Emulation.setUserAgentOverride',
    p?.userAgent
      ? { userAgent: p.userAgent, platform: p.platform, userAgentMetadata: p.userAgentMetadata }
      : { userAgent: '' }
  );
  await send(
    'Emulation.setTouchEmulationEnabled',
    p ? { enabled: true, maxTouchPoints: 5 } : { enabled: false }
  );
}

// `tnai show` pages (show-file.js) are cut off from the network by their Content-Security-Policy,
// which does not cover WebRTC (this Chromium does not know the `webrtc` directive; proven open by
// desktop test show-file, 2026-10-09). So WebRTC is taken away before the page's first script runs,
// in every document of a preview frame that has an origin of its own (the policy's `sandbox` gives
// a shown page one, and its child frames inherit it) and is a shown page or a frame made by one. A
// page with a normal origin, every dev server page, keeps WebRTC.
const NO_RTC = `(() => { try {
  if (self.origin !== 'null') return;
  const shown = location.hostname === '127.0.0.1' && /^\\/s\\/[0-9a-f]{32}\\//.test(location.pathname);
  if (!shown && !/^(about|blob|data):$/.test(location.protocol)) return;
  for (const k of Object.getOwnPropertyNames(self)) if (/^(webkit|moz)?RTC/.test(k)) { try { delete self[k]; } catch {} }
} catch {} })()`;

// the protocol client could not attach, or was detached: a shown page would keep WebRTC, so `tnai
// show` refuses (agent-mesh.js)
let unwalled = false;

// The same for a whole window of its own (`tnai shot preview`, preview-shot.js), before its page
// loads.
async function wall(contents) {
  const dbg = contents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Page.enable', {});
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: NO_RTC });
  return true;
}

let home = null; // Technically Not's main window: the first one watched

function findFrame(node, id) {
  if (!node) return null;
  if (node.frame?.id === id) return node.frame;
  for (const child of node.childFrames || []) {
    const hit = findFrame(child, id);
    if (hit) return hit;
  }
  return null;
}

// Pushes one event to the window whose debugger owns that preview session (the payload gets the
// frame's name).
function report(sessionId, channel, payload) {
  const s = sessions.get(sessionId);

  // a pop-out window has no bridge, so its frames report to the main window too
  const to = home && !home.isDestroyed() ? home : s?.contents;
  try {
    if (s && to && !to.isDestroyed()) to.send(channel, { name: s.name, ...payload });
  } catch {}
}
const clip = (v, n) => String(v ?? '').slice(0, n);
const argText = a =>
  a?.value !== undefined
    ? typeof a.value === 'string'
      ? a.value
      : JSON.stringify(a.value)
    : a?.description || a?.type || '';

// Protocol events of a preview frame's session (ignored for any session that isn't one): page
// errors, the picker's reports, a new document.
function onFrameEvent(sessionId, method, p) {
  if (!sessions.has(sessionId)) return;
  if (method === 'Runtime.exceptionThrown') {
    const d = p?.exceptionDetails || {},
      ex = d.exception;
    const first = String(ex?.description || '').split('\n')[0] || String(ex?.value ?? '');
    const text =
      first && d.text && !first.includes(d.text) ? d.text + ' ' + first : first || d.text;
    report(sessionId, 'preview:error', {
      kind: 'exception',
      text: clip(text, 500),
      url: clip(d.url, 500),
      line: Number(d.lineNumber) + 1 || 0,
    });
  } else if (method === 'Runtime.consoleAPICalled') {
    if (p?.type !== 'error') return;
    const top = p.stackTrace?.callFrames?.[0] || {};
    report(sessionId, 'preview:error', {
      kind: 'console',
      text: clip((p.args || []).map(argText).join(' '), 500),
      url: clip(top.url, 500),
      line: Number(top.lineNumber) + 1 || 0,
    });
  } else if (method === 'Log.entryAdded') {
    const e = p?.entry;
    if (e?.level !== 'error') return;
    report(sessionId, 'preview:error', {
      kind: e.source === 'network' ? 'network' : 'log',
      text: clip(e.text, 500),
      url: clip(e.url, 500),
      line: Number(e.lineNumber) + 1 || 0,
    });
  } else if (method === 'Runtime.executionContextsCleared') {
    picks.delete(sessions.get(sessionId).name); // the picker went with the old document
    report(sessionId, 'preview:loaded', {});
  } else if (method === 'Runtime.bindingCalled' && p?.name === 'tnaiPreviewPick') {
    // The binding is the page's to call at any time: only the first report after the user opened a
    // pick in that frame is passed on (a page could put its own words into the
    // composer and take the keyboard focus whenever it liked).
    if (!picks.delete(sessions.get(sessionId).name)) return;
    let d = null;
    try {
      d = JSON.parse(p.payload);
    } catch {}
    if (!d || typeof d !== 'object') return;
    const r = d.rect || {};
    report(
      sessionId,
      'preview:picked',
      d.cancelled
        ? { cancelled: true }
        : {
            cancelled: false,
            selector: clip(d.selector, 300),
            tag: clip(d.tag, 40),
            id: clip(d.id, 120),
            classes: clip(d.classes, 300),
            text: clip(d.text, 80),
            html: clip(d.html, 300),
            rect: {
              x: Math.round(+r.x) || 0,
              y: Math.round(+r.y) || 0,
              w: Math.round(+r.w) || 0,
              h: Math.round(+r.h) || 0,
            },
          }
    );
  }
}

// Starts the protocol client on one of Technically Not's windows. New cross-site iframes wait until
// their emulation is set, so the page's first script already sees the device; every one is resumed
// whatever happens.
function watch(contents) {
  const dbg = contents.debugger;
  if (!home || home.isDestroyed()) home = contents;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch {
    if (contents === home) unwalled = true;
    return false;
  }
  if (contents === home) {
    unwalled = false;
    dbg.on('detach', () => {
      unwalled = true;
    });
  }
  dbg.on('message', async (_event, method, params, msgSession) => {
    if (msgSession) {
      onFrameEvent(msgSession, method, params);
      return;
    } // events of an attached frame's own session
    if (method === 'Target.detachedFromTarget') {
      sessions.delete(params.sessionId);
      return;
    }
    if (method !== 'Target.attachedToTarget') return;
    const sessionId = params.sessionId;
    try {
      const tree = await dbg.sendCommand('Page.getFrameTree', {});
      const name = findFrame(tree.frameTree, params.targetInfo?.targetId)?.name || '';
      if (NAME.test(name)) {
        sessions.set(sessionId, { dbg, name, contents });

        // Error reporting + the picker's binding: fire-and-forget, so nothing here can hold the
        // frame back.
        for (const [method, p] of [
          ['Runtime.enable'],
          ['Log.enable'],
          ['Runtime.addBinding', { name: 'tnaiPreviewPick' }],
        ])
          dbg.sendCommand(method, p || {}, sessionId).catch(() => {});
        report(sessionId, 'preview:loaded', {});
        if (wanted.has(name)) await apply(dbg, sessionId, wanted.get(name));

        // without it the script below is kept but never run
        await dbg.sendCommand('Page.enable', {}, sessionId).catch(() => {});
        await dbg
          .sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: NO_RTC }, sessionId)
          .catch(() => {}); // before the frame runs: a shown file gets no WebRTC (NO_RTC)
      }
    } catch {}
    dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  });
  dbg
    .sendCommand('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: 'iframe' }],
    })
    .catch(() => {});
  return true;
}

// IPC preview:emulate from 31: which preset a preview iframe shows ('' or unknown = none). Applied
// now to a frame already loaded (31 reloads it so the page starts as that device) and to every
// later document in it.
async function set(name, id) {
  name = String(name || '');
  id = String(id || '');
  if (!NAME.test(name)) return { ok: false, error: 'Not a preview frame.' };
  const p = PROFILES[id] || null;
  if (p) wanted.set(name, id);
  else wanted.delete(name);
  for (const [sessionId, s] of sessions)
    if (s.name === name) await apply(s.dbg, sessionId, id).catch(() => {});
  return { ok: true, value: p ? { label: p.label, userAgent: !!p.userAgent, touch: true } : null };
}

function forget(name) {
  wanted.delete(String(name || ''));
}

// IPC preview:hot from 31: whether the page in a preview frame updates itself when its files change
// (a dev server's hot reload or live reload), so 31 reloads only pages that don't. Read inside the
// frame: Vite's client script, React Refresh (Vite, webpack, Metro), webpack's HMR runtime, Next.js
// dev, Metro, LiveReload / BrowserSync / live-server. true / false, or null when the frame isn't
// attached (unknown).
const HOT_CHECK = `(() => { try {
  const src = [...document.scripts].map(s => s.src || '').join(' ');
  if (/\\/@vite\\/client|webpack-dev-server|livereload|browser-sync|\\/_next\\/static\\/chunks\\/webpack|hot-update/.test(src)) return true;
  if (typeof window.$RefreshReg$ === 'function' || window.__BUNDLE_START_TIME__ || window.__NEXT_DATA__?.buildId === 'development') return true;
  if (Object.keys(window).some(k => /^webpackHotUpdate|^__webpack_dev_server|^__vite/.test(k))) return true;
  return /Code injected by live-server/.test(document.documentElement.innerHTML.slice(0, 200000));
} catch { return false; } })()`;

async function hot(name) {
  name = String(name || '');
  for (const [sessionId, s] of sessions) {
    if (s.name !== name) continue;
    try {
      const r = await s.dbg.sendCommand(
        'Runtime.evaluate',
        { expression: HOT_CHECK, returnByValue: true },
        sessionId
      );
      return r?.result?.value === true;
    } catch {}
  }
  return null;
}

// IPC preview:nav from 31 (the Live preview page's browser toolbar): back / forward inside one
// preview frame's own history, or 'where' = the address it shows now (after the user clicked a link
// in it). Run inside that frame only; null when the frame isn't attached. 'keep' / 'restore' (user
// report 2026-10-01: "every time I scroll down it scrolls right back up"): 31 reloads a page
// without hot reload whenever a page file is saved in the project, which with several agents
// working is every few seconds, and each reload threw the page back to its top. 'keep' runs before
// a reload and notes every scrolled element (the page itself and inner scroll areas, by its place
// in the document) in the frame's own sessionStorage; 'restore' runs once the page has loaded again
// and puts them back (same address, within 15 s), then forgets. The user stays in control (user
// report 2026-10-01: "it instantly goes back up ... I should be in full control"): 'restore' used
// to put the place back again 0.3 s and 1 s after the load, which pulled the view back when the
// user had scrolled on in that second. Now it stops the moment the place is reached or the user
// touches the page (wheel, touch, press, key), tries for 2 s at most while the page is still too
// short, and jumps without the page's own smooth scrolling. A 'keep' that lands before the last
// place was put back (saves seconds apart) carries that place on instead of noting the top of a
// page that is still loading.
const KEEP = `(() => { try { let list = []; [...document.querySelectorAll('*')].forEach((e, i) => { if ((e.scrollTop || e.scrollLeft) && list.length < 20) list.push([i, e.scrollLeft, e.scrollTop]); });
  const old = window.__tnaiScrollBack || JSON.parse(sessionStorage.getItem('__tnaiScroll') || 'null');
  if (old && old.href === location.href && Date.now() - old.at < 15000 && (window.__tnaiScrollBack || !list.length)) list = old.list;
  sessionStorage.setItem('__tnaiScroll', JSON.stringify({ href: location.href, at: Date.now(), list })); } catch {} return location.href; })()`;
const RESTORE = `(() => { try { const s = JSON.parse(sessionStorage.getItem('__tnaiScroll') || 'null'); sessionStorage.removeItem('__tnaiScroll');
  if (s && s.href === location.href && Date.now() - s.at < 15000 && s.list.length) {
    const USER = ['wheel', 'touchstart', 'pointerdown', 'keydown']; let tries = 0;
    const stop = () => { clearInterval(timer); window.__tnaiScrollBack = null; USER.forEach(t => removeEventListener(t, stop, true)); };
    const put = () => { const all = [...document.querySelectorAll('*')]; let there = true;
      s.list.forEach(([i, x, y]) => { const e = all[i]; if (!e) return; e.scrollTo({ left: x, top: y, behavior: 'instant' }); if (Math.abs(e.scrollTop - y) > 2 || Math.abs(e.scrollLeft - x) > 2) there = false; });
      if (there || ++tries >= 20) stop(); };
    window.__tnaiScrollBack = s; USER.forEach(t => addEventListener(t, stop, { capture: true, passive: true }));
    const timer = setInterval(put, 100); put(); } } catch {} return location.href; })()`;
const SCROLL_KEY = "'__tnaiScroll'";
const NAV = {
  back: 'history.back(), location.href',
  forward: 'history.forward(), location.href',
  where: 'location.href',
  keep: KEEP,
  restore: RESTORE,
};

async function nav(name, action) {
  name = String(name || '');
  const written = NAV[String(action || '')];
  if (!NAME.test(name) || !written) return null;

  // The scroll place is kept under this frame's own name. One page can stand in two frames at
  // once (the Live preview page and the preview column of All threads); they share the page's
  // sessionStorage, and under one key the second frame wrote over, or removed, what the first had
  // kept, so a reloaded preview went back to its top.
  const expression = written.split(SCROLL_KEY).join(JSON.stringify('__tnaiScroll:' + name));
  for (const [sessionId, s] of sessions) {
    if (s.name !== name) continue;
    try {
      const r = await s.dbg.sendCommand(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        sessionId
      );
      return typeof r?.result?.value === 'string' ? r.result.value : null;
    } catch {}
  }
  return null;
}

// IPC preview:pick from 31: on = the user points at an element in that preview frame (an outline
// follows the pointer, a click reports it once through the tnaiPreviewPick binding →
// preview:picked, Esc reports { cancelled }); off = remove the picker. Injected twice = still one.
const PICK_ON = `(() => { try {
  if (window.__tnaiPick) return true;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #a78bfa;box-sizing:border-box;display:none;left:0;top:0';
  document.documentElement.appendChild(box);
  const report = d => { try { window.tnaiPreviewPick(JSON.stringify(d)); } catch {} };
  const at = e => { const el = e.target; return el && el.nodeType === 1 && el !== box ? el : null; };
  const path = el => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      const tag = n.tagName.toLowerCase();
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      if (tag === 'html' || tag === 'body') { parts.unshift(tag); break; }
      let part = tag + [...n.classList].slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
      const same = n.parentElement ? [...n.parentElement.children].filter(c => c.tagName === n.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const move = e => { const el = at(e); if (!el) return; const r = el.getBoundingClientRect(); Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }); };
  const swallow = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  const click = e => {
    swallow(e); const el = at(e); if (!el) return;
    const r = el.getBoundingClientRect();
    report({ selector: path(el), tag: el.tagName.toLowerCase(), id: el.id || '', classes: typeof el.className === 'string' ? el.className : '', text: (el.innerText || '').trim().slice(0, 80), html: el.outerHTML.slice(0, 300), rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
    stop();
  };
  const key = e => { if (e.key === 'Escape') { swallow(e); report({ cancelled: true }); stop(); } };
  const h = { mousemove: move, click, mousedown: swallow, mouseup: swallow, pointerdown: swallow, keydown: key };
  const stop = () => { for (const [t, f] of Object.entries(h)) removeEventListener(t, f, true); box.remove(); delete window.__tnaiPick; };
  for (const [t, f] of Object.entries(h)) addEventListener(t, f, true);
  window.__tnaiPick = { stop };
  return true;
} catch { return false; } })()`;
const PICK_OFF = 'window.__tnaiPick && window.__tnaiPick.stop(), true';

async function pick(name, on) {
  name = String(name || '');
  if (!NAME.test(name)) return { ok: false };
  let ok = false;
  if (on) picks.add(name);
  else picks.delete(name); // open before the picker is in the page, so a fast click is not lost
  for (const [sessionId, s] of sessions) {
    if (s.name !== name) continue;
    try {
      const r = await s.dbg.sendCommand(
        'Runtime.evaluate',
        { expression: on ? PICK_ON : PICK_OFF, returnByValue: true },
        sessionId
      );
      if (r?.result?.value === true) ok = true;
    } catch {}
  }
  if (on && !ok) picks.delete(name);
  return { ok };
}

// The navigation request of a preview frame goes out before its target attaches: give it the
// device's User-Agent here.
function headers(details) {
  if (details.resourceType !== 'subFrame' || !wanted.size) return null;
  let name = '';
  try {
    name = details.frame?.name || '';
  } catch {}
  const ua = PROFILES[wanted.get(name)]?.userAgent;
  if (!ua) return null;
  const requestHeaders = { ...details.requestHeaders };
  for (const key of Object.keys(requestHeaders))
    if (key.toLowerCase() === 'user-agent') delete requestHeaders[key];
  requestHeaders['User-Agent'] = ua;
  return requestHeaders;
}

// `tnai shot preview` (preview-shot.js): the same preset on a whole hidden window of its own, set
// before its page loads.
async function emulate(contents, id) {
  const dbg = contents.debugger;
  if (!PROFILES[id]) return false;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await apply(dbg, undefined, id);
  return true;
}

module.exports = {
  watch,
  set,
  forget,
  hot,
  nav,
  pick,
  headers,
  emulate,
  wall,
  unwalled: () => unwalled,
  presets: () => Object.keys(PROFILES),
  sessions: () => sessions.size,
};
