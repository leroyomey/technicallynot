// Technically Not tools · desktop-check/tests/live-preview-device.js — Live preview (31) device
// emulation + pop-out: a localhost page (served by live-preview-device.main.js) reports what it
// sees. Phone/Tablet presets give the frame the real viewport, the device's user agent (JS and
// request header), touch, pointer: coarse and hover: none, while Technically Not's own page stays a
// desktop; Desktop turns it off; a bezel is drawn; on the Live preview page (65) the preview pops
// out into a window sized to the device (100% where the screen allows) with the emulation kept, and
// closing the window docks it. No agents, no prompts. Returns {ok, log}.
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
    await wait(80);
  }
  return null;
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

// The newest report after `since` that matches `fn`.
const report = (since, fn, ms) =>
  until(async () => (await main('reports', since)).reverse().find(fn), ms);

try {
  const port = await main('serve');
  const url = 'http://localhost:' + port + '/';
  const LPP = window.TnaiLivePreviewPage;
  LPP.open();
  await wait(300);
  const panel = await until(() => document.querySelector('#livePreviewPage .lpp-stage .lp'));
  check(!!panel && window.TnaiLivePreview.addUrl(url).ok, 'Live preview page shows ' + url);
  const P = () => panel; // the same element on the page and in its pop-out window
  const statusText = () =>
    window.TnaiLivePreview.status(window.TnaiLivePreview.tabs().find(x => x.active)?.id)?.text ||
    '';
  const pick = (device, size) => {
    P()
      .querySelector('.lp-modes [data-device="' + device + '"]')
      .click();
    if (size) {
      const s = P().querySelector('.lp-size');
      s.value = size;
      s.dispatchEvent(new Event('change'));
    }
  };

  // Desktop first: no emulation. The host's own desktop user agent (Linux: "X11; Linux", never an
  // emulated Android's "Linux; Android").
  const windows = /Windows/.test(navigator.userAgent),
    hostUa = windows ? /Windows/ : /X11; Linux/;
  let t = Date.now();
  pick('desktop');
  let r = await report(0, x => x.path === '/');
  check(
    r && !r.coarse && !r.touch && hostUa.test(r.ua),
    'Desktop: plain desktop page (no touch, fine pointer): ' +
      JSON.stringify(r && { ua: r.ua.slice(0, 40), coarse: r.coarse, touch: r.touch })
  );

  // iPhone 15: viewport, UA (JS + header), touch, media queries.
  t = Date.now();
  pick('phone', 'i15');

  // The header too: the document from before the reload also reports once (its resize listener,
  // with the new user agent already in JS but its old request header and no touch), and that report
  // must not be taken for the reloaded page (learned 2026-10-09: it was, 5 runs in 7, once frames
  // got slower to attach).
  r = await report(t, x => /iPhone/.test(x.ua) && /iPhone/.test(x.hdr));
  check(!!r, 'Phone · iPhone 15: the page reloads as an iPhone');
  check(
    r?.w === 393 && r?.h === 852 && r?.maxW500,
    'viewport is 393×852 and (max-width: 500px) matches: ' + r?.w + '×' + r?.h
  );
  check(
    /iPhone/.test(r?.hdr || ''),
    'request User-Agent header is the iPhone one: ' + (r?.hdr || '').slice(0, 60)
  );
  check(
    r?.coarse && r?.hoverNone && r?.touch && r?.mtp > 0 && r?.mobile,
    '(pointer: coarse), (hover: none), ontouchstart, maxTouchPoints ' +
      r?.mtp +
      ', userAgentData.mobile'
  );
  const parent = await main('parentMedia');
  check(
    !parent.coarse && !parent.hoverNone && !/iPhone/.test(parent.ua),
    "Technically Not's own page is untouched (fine pointer, desktop user agent)"
  );
  const shell = P().querySelector('.lp-frame-shell:not([hidden])');
  check(
    shell?.classList.contains('lp-bezel') &&
      parseFloat(getComputedStyle(shell).borderTopLeftRadius) > 10,
    'phone drawn in a rounded bezel'
  );
  console.log('TNAI_SHOT:live-preview-device');
  await wait(500);
  check(
    /iPhone UA · touch/.test(P().querySelector('.lp-size-label').textContent),
    'label says what is emulated: ' + P().querySelector('.lp-size-label').textContent
  );

  // Pixel 8 → Android UA; iPad mini → iPad (desktop-class Safari UA) with touch at 744 wide.
  t = Date.now();
  pick('phone', 'pixel8');
  r = await report(t, x => /Android/.test(x.ua));
  check(
    r?.w === 412 && /Mobile/.test(r.ua) && /Android/.test(r.hdr) && r.coarse,
    'Pixel 8: 412 wide, Android Chrome mobile user agent, coarse pointer'
  );
  t = Date.now();
  pick('tablet', 'ipadmini');
  r = await report(t, x => /Macintosh/.test(x.ua) && x.w === 744);
  check(
    r?.touch && r?.coarse && !r?.mobile && !r?.maxW500,
    'iPad mini: 744 wide, iPad Safari user agent, touch, not a phone'
  );

  // Back to Desktop: emulation off after the reload.
  t = Date.now();
  pick('desktop');
  r = await report(t, x => hostUa.test(x.ua));
  check(r && !r.coarse && !r.touch && !r.hoverNone, 'Desktop again: emulation off');

  // Pop out as an iPhone SE: window sized to the device, emulation kept, close docks.
  pick('phone', 'se');
  await report(Date.now() - 50, x => /iPhone/.test(x.ua) && x.w === 375);
  t = Date.now();
  check(LPP.popOut() && panel.ownerDocument !== document, 'Live preview pops out');
  r = await report(t, x => /iPhone/.test(x.ua) && x.w === 375, 12000);
  check(
    !!r && /iPhone/.test(r.hdr) && r.coarse,
    'in the pop-out the page is still an iPhone SE (375 wide, iPhone UA + header, coarse pointer)'
  );

  // The window is sized in two steps (31 fitWindow measures its bars again at the new width), so
  // wait for 100% before settling for less.
  const sizeLabel = () => {
    const l = panel.querySelector('.lp-size-label')?.textContent || '';
    return /^375×667/.test(l) && l;
  };
  const label =
    (await until(() => /· 100%/.test(sizeLabel() || '') && sizeLabel(), 5000)) || sizeLabel();
  {
    const cw = panel.ownerDocument.defaultView,
      st = panel.querySelector('.lp-stage'),
      sh = panel.querySelector('.lp-frame-shell');
    log.push(
      'info pop-out layout: inner ' +
        cw.innerWidth +
        '×' +
        cw.innerHeight +
        ', stage ' +
        st?.clientWidth +
        '×' +
        st?.clientHeight +
        ', shell ' +
        sh?.offsetWidth +
        '×' +
        sh?.offsetHeight +
        ', bars ' +
        [...panel.querySelectorAll('.lpp-tabrow, .lp-bar, .lpp-dock')]
          .map(e => e.className.split(' ')[0] + ':' + Math.round(e.getBoundingClientRect().height))
          .join(' ')
    );
  }
  const win = await main('popout');
  const zoom = win?.zoom || 1,
    fits = (667 + 200) * zoom < win?.area.height;
  check(
    win && (!fits || /· 100%/.test(label || '')),
    'pop-out window ' +
      win?.content.width +
      '×' +
      win?.content.height +
      ' (screen ' +
      win?.area.width +
      '×' +
      win?.area.height +
      ', zoom ' +
      zoom +
      ') shows the device at: ' +
      label
  );
  check(
    win && win.content.height <= win.area.height && win.content.width <= win.area.width,
    'pop-out fits on the screen'
  );
  await main('close');
  check(
    !!(await until(() => !LPP.isOut() && panel.ownerDocument === document, 5000)),
    'closing the window docks the preview back'
  );

  // Server not running yet: the chosen device is still drawn (empty screen in its bezel, real
  // size), with the status note inside it.
  window.TnaiLivePreview.addScript('dev');
  await wait(200);
  const empty = () => P().querySelector('.lp-empty-screen'),
    emptyShell = () => empty()?.parentElement;
  pick('phone', 'se');
  await wait(150);
  let es = emptyShell()?.getBoundingClientRect();
  check(
    !!empty() &&
      !emptyShell().hidden &&
      emptyShell().classList.contains('lp-bezel') &&
      es.height > es.width * 1.4 &&
      /Server not running/.test(empty().textContent) &&
      /^375×667/.test(P().querySelector('.lp-size-label').textContent),
    'not running · Phone: an empty iPhone SE screen in its bezel, portrait, note inside (' +
      Math.round(es?.width) +
      '×' +
      Math.round(es?.height) +
      ', ' +
      P().querySelector('.lp-size-label').textContent +
      ')'
  );
  console.log('TNAI_SHOT:live-preview-empty-phone');
  await wait(450);
  pick('tablet');
  await wait(150);
  const et = emptyShell()?.getBoundingClientRect();
  check(
    !emptyShell().hidden &&
      emptyShell().classList.contains('lp-bezel') &&
      et.width / et.height > (es.width / es.height) * 1.1,
    'not running · Tablet: the screen changes to a wider tablet shape (' +
      Math.round(et.width) +
      '×' +
      Math.round(et.height) +
      ')'
  );
  P().querySelector('.lp-rotate').click();
  await wait(150);
  const er = emptyShell()?.getBoundingClientRect();
  check(
    er.width > er.height,
    'not running · Tablet rotated: landscape (' +
      Math.round(er.width) +
      '×' +
      Math.round(er.height) +
      ')'
  );
  P().querySelector('.lp-rotate').click();
  pick('desktop', 'fit');
  await wait(150);
  check(
    (!emptyShell() || emptyShell().hidden) && !!P().querySelector('.lp-stage>.lp-note'),
    'not running · Desktop (fit): the note fills the stage, no device frame'
  );

  // An agent routes to Live preview: `tnai preview URL phone` typed into a real PowerShell pane in
  // the project (shim → agent-mesh.js → preview:show → 31).
  const N = window.tnaiNative,
    strip = s =>
      String(s || '')
        .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
        .replace(/\s+/g, '');
  const text = async p => strip((await N.pty.replay(p))?.buffer);
  const pane = (await window.TnaiTest.open('Terminal'))?.paneId;
  check(
    !!pane && !!(await until(async () => (await text(pane)).includes(windows ? '>' : '$'), 20000)),
    'PowerShell pane for `tnai preview` opened'
  );
  const url2 = 'http://127.0.0.1:' + port + '/agent-shown';
  window.TnaiRoute('overview');
  await wait(300);
  t = Date.now();
  N.pty.write(pane, 'tnai preview ' + url2 + ' phone\r');
  const said = await until(async () => {
    const s = await text(pane);
    return (
      (s.includes('Showingtheuser') || s.includes('Showing' + url2) || s.includes('tnai:')) && s
    );
  }, 20000);
  check(
    /Phoneview\(chosenbytheagent\)/.test(said || '') && /bellnotice/.test(said || ''),
    '`tnai preview` answer: ' + (said || '').slice(-200)
  );
  check(!window.TnaiLivePreviewPage.visible(), 'on Overview the page is not switched');
  window.TnaiNextActions.openBell();
  await wait(200);
  const pop =
    [...document.querySelectorAll('[data-act=notice]')].find(b =>
      b.closest('[data-item]')?.textContent.includes('Preview ready')
    ) ||
    (() => {
      const it = [...document.querySelectorAll('[data-item]')].find(x =>
        x.textContent.includes('Preview ready')
      );
      it?.querySelector('[data-act=expand]')?.click();
      return null;
    })();
  await wait(150);
  const openBtn =
    pop ||
    [...document.querySelectorAll('[data-act=notice]')].find(b =>
      b.closest('[data-item]')?.textContent.includes('Preview ready')
    );
  check(!!openBtn && /Open/.test(openBtn.textContent), 'a bell notice "Preview ready" with Open');
  openBtn?.click();
  await wait(300);
  check(window.TnaiLivePreviewPage.visible(), 'Open on the notice shows the Live preview page');
  {
    // One notice per group: an agent that shows several addresses leaves one "Preview ready", and
    // it goes with its panel.
    const A = window.TnaiNextActions,
      count = () =>
        [...document.querySelectorAll('[data-item]')].filter(x =>
          x.textContent.includes('Group check')
        ).length;
    A.notify({ key: 'gc:1', group: 'gc', source: 'Test', title: 'Group check one' });
    A.notify({ key: 'gc:2', group: 'gc', source: 'Test', title: 'Group check two' });
    A.notify({ key: 'gc:3', source: 'Test', title: 'Group check alone' });
    A.openBell(true);
    await wait(200);
    check(
      count() === 2 &&
        [...document.querySelectorAll('[data-item]')].some(x =>
          x.textContent.includes('Group check two')
        ),
      'two notices of one group leave only the newest in the bell (' +
        count() +
        ' shown with the ungrouped one)'
    );
    A.unnotifyGroup('gc');
    A.unnotify('gc:3');
    await wait(150);
    check(count() === 0, "unnotifyGroup removes the group's notices (" + count() + ' left)');
    A.openBell(false);
    await wait(100);
  }
  N.pty.write(pane, 'tnai preview ' + url2 + ' phone\r');
  await wait(1500);
  check(
    window.TnaiLivePreviewPage.visible() && /previewtheuserhasonscreen/.test(await text(pane)),
    'with Live preview on screen, the next show goes straight there'
  );
  check(
    window.TnaiLivePreview.tabs().find(x => x.active)?.url === url2,
    "the agent's address is the selected preview"
  );
  r = await report(t, x => x.path === '/agent-shown' && /iPhone|Android/.test(x.ua), 12000);
  check(
    !!r && r.coarse && r.touch,
    'the page loads in the Phone view (device user agent + touch): ' + (r && r.w + '×' + r.h)
  );
  check(/Shown by/.test(statusText()), 'its status says which agent showed it: ' + statusText());
  console.log('TNAI_SHOT:live-preview-agent-shown');
  await wait(450);
  N.pty.write(pane, 'tnai preview https://example.com/\r');
  check(
    !!(await until(async () => (await text(pane)).includes('addressesonthiscomputeronly'), 15000)),
    'a non-local address from an agent is refused'
  );

  // `tnai preview close [URL]` closes only the tabs this agent opened; a tab the user added stays,
  // and naming it is refused.
  const own = window.TnaiLivePreview.addUrl('http://127.0.0.1:' + port + '/users-tab').id;
  N.pty.write(pane, 'tnai preview close http://127.0.0.1:' + port + '/users-tab\r');
  check(
    !!(await until(async () => (await text(pane)).includes('wasnotopenedbyyou'), 15000)) &&
      window.TnaiLivePreview.tabs().some(x => x.id === own),
    "`tnai preview close` on the user's own tab is refused and the tab stays"
  );
  N.pty.write(pane, 'tnai preview close\r');
  check(
    !!(await until(() => !window.TnaiLivePreview.tabs().some(x => x.url === url2), 15000)) &&
      window.TnaiLivePreview.tabs().some(x => x.id === own),
    "`tnai preview close` closes the agent's tab; the user's tab stays"
  );
  check(
    !!(await until(async () => (await text(pane)).includes('ClosedinTechnicallyNot'), 10000)),
    '`tnai preview close` tells the agent what it closed'
  );
  window.TnaiLivePreview.close(own);
  N.pty.write(pane, 'tnai preview ' + url2 + ' phone\r');
  check(
    !!(await until(() => window.TnaiLivePreview.tabs().some(x => x.url === url2), 15000)),
    'the agent shows its address again'
  );

  // `tnai shot preview [URL] [device]`: a PNG of the agent's tab, taken in a hidden window of its
  // own; the user's page, tab and device view stay as they were.
  window.TnaiRoute('overview');
  await wait(300);
  const lpKey = 'tnai.live-preview-device.v1',
    seen = () => ({
      page: window.TnaiLivePreviewPage.visible(),
      active: window.TnaiLivePreview.tabs().find(x => x.active)?.url,
      prefs: localStorage.getItem(lpKey),
    });
  const before = seen(),
    wins = await main('windows');
  let since = Date.now();
  N.pty.write(pane, 'tnai shot preview\r');
  let shotSaid = await until(async () => {
    const s = await text(pane);
    return (
      (s.lastIndexOf('Screenshotof') > s.lastIndexOf('tnaishotpreview') ||
        /Noscreenshot/.test(s.slice(s.lastIndexOf('tnaishotpreview')))) &&
      s.slice(s.lastIndexOf('tnaishotpreview'))
    );
  }, 25000);
  if (!shotSaid) shotSaid = 'NO ANSWER: ' + (await text(pane)).slice(-400);
  let png = await main('shot', since);
  const vp = /(\d+)×(\d+)viewport/.exec(shotSaid || ''),
    img = /Image(\d+)×(\d+)px/.exec(shotSaid || '');
  check(
    /Screenshotofhttp:\/\/127\.0\.0\.1:\d+\/agent-shown·Phone/.test(shotSaid || '') &&
      /\.png/.test(shotSaid || ''),
    '`tnai shot preview` defaults to the tab the agent opened, in the Live preview device: ' +
      (shotSaid || '').slice(0, 400)
  );
  check(
    png?.png &&
      png.bytes > 500 &&
      img &&
      png.width === +img[1] &&
      png.height === +img[2] &&
      vp &&
      png.width >= Math.min(+vp[1], 1600) &&
      png.width <= 1600 &&
      Math.abs(png.width / png.height - vp[1] / vp[2]) < 0.02,
    'a valid PNG of the viewport (at screen scale, max 1600 wide) is written: ' +
      JSON.stringify(png && { w: png.width, h: png.height, bytes: png.bytes }) +
      ' viewport ' +
      (vp && vp[0])
  );
  const phoneReport = await report(since, x => x.path === '/agent-shown' && x.w === 375, 3000);
  check(
    !!phoneReport &&
      /iPhone/.test(phoneReport.ua) &&
      /iPhone/.test(phoneReport.hdr) &&
      phoneReport.coarse,
    'the hidden window loaded the page as that device (375 wide, iPhone user agent + header, coarse pointer)'
  );
  const today = new Date(),
    day =
      today.getFullYear() +
      '-' +
      String(today.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(today.getDate()).padStart(2, '0');
  check(
    png?.day === day && /[\\/]attachments[\\/]\d{4}-\d{2}-\d{2}[\\/]shot-/.test(png.file),
    'saved under userData/attachments/<date>/: ' + png?.file
  );
  check(
    JSON.stringify(seen()) === JSON.stringify(before),
    "the user's page, selected tab and device view did not change: " + JSON.stringify(seen())
  );
  check(
    !!(await until(async () => (await main('windows')) === wins, 5000)),
    'the hidden capture window is gone'
  );
  await wait(2100);
  since = Date.now();
  const answered = s => s.split('Screenshotof').length + s.split('Noscreenshot').length;
  const n0 = answered(await text(pane));
  N.pty.write(pane, 'tnai shot preview desktop\r');
  shotSaid = await until(async () => {
    const s = await text(pane);
    return (
      answered(s) > n0 &&
      /px,/.test(s.slice(s.lastIndexOf('Screenshotof'))) &&
      s.slice(s.lastIndexOf('Screenshotof'))
    );
  }, 25000);
  if (!shotSaid) shotSaid = 'NO ANSWER: ' + (await text(pane)).slice(-300);
  png = await main('shot', since);
  const shotReport = await report(
    since - 200,
    x => x.path === '/agent-shown' && x.w === 1280,
    3000
  );
  check(
    /·Desktop·/.test(shotSaid) && png?.png && png.width >= 1280 && png.width <= 1600,
    '`tnai shot preview desktop`: a Desktop-size PNG (' +
      png?.width +
      '×' +
      png?.height +
      ") while the user's view stays Phone: " +
      shotSaid.slice(0, 200)
  );
  check(
    !!shotReport && !/iPhone|Android/.test(shotReport.ua) && !shotReport.coarse,
    'the desktop shot loaded the page as a desktop (1280 wide, no device emulation)'
  );
  check(
    JSON.stringify(seen()) === JSON.stringify(before),
    "the Live preview device view is still the user's after a desktop shot"
  );

  // Closing the agent's panel closes the preview it opened (a tab the user added stays).
  const mine = window.TnaiLivePreview.addUrl('http://127.0.0.1:' + port + '/users-own').id;
  document
    .querySelector(`[data-pane-id="${pane}"] .terminal-pane-tools button[title="Close terminal"]`)
    ?.click();
  check(
    !!(await until(() => !window.TnaiLivePreview.tabs().some(x => x.url === url2), 5000)),
    "closing the agent's panel closes the preview it opened"
  );
  check(
    window.TnaiLivePreview.tabs().some(x => x.id === mine),
    'a preview the user added stays open'
  );
  window.TnaiLivePreview.close(mine);
  window.TnaiLivePreview.close(window.TnaiLivePreview.tabs().find(x => x.url === url2)?.id);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
