// Technically Not tools · desktop-check/tests/live-preview-freeze.js — Live preview (31): what a
// previewed page that is not on screen still does. A light localhost page
// (live-preview-freeze.main.js) counts its requestAnimationFrame calls, 50 ms timer ticks and WebGL
// draws and posts them every 200 ms. Read per second: (a) the tab in front, (b) the same tab behind
// another tab, (c) in front again but with the Skills page shown. Proved: a page not on screen
// stops drawing (frames and WebGL at 0) and, shown again, is the same document with its counters
// carried on (never reloaded); Side by side views run. Printed, not yet required: its timers, which
// still run while hidden (Performance: no freeze of one frame works in this
// Electron). No agents, no prompts. Returns {ok, log}.
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

// What a page did over `ms`: per second, from the page's own counters as the server last heard
// them. All zero = nothing ran.
const read = async (path, ms = 3000) => {
  const a = await main('last', path);
  await wait(ms);

  // the same document's later report: another view of this address counts for itself
  const b = a ? await main('lastOf', path, a.born) : await main('last', path);
  if (!a || !b) return { raf: 0, tick: 0, gl: 0, posts: 0, born: b?.born || '', end: b };
  const per = k => Math.round(((b[k] - a[k]) / (ms / 1000)) * 10) / 10;
  return {
    raf: per('raf'),
    tick: per('tick'),
    gl: per('gl'),
    posts: per('posts'),
    born: b.born,
    end: b,
  };
};
const say = r =>
  'rAF ' +
  r.raf +
  '/s · timer ' +
  r.tick +
  '/s · WebGL draws ' +
  r.gl +
  '/s · posts ' +
  r.posts +
  '/s';

try {
  const port = await main('serve');
  const A = 'http://localhost:' + port + '/a',
    B = 'http://localhost:' + port + '/b';
  const LP = window.TnaiLivePreview,
    LPP = window.TnaiLivePreviewPage;
  LPP.open();
  await wait(300);
  const panel = await until(() => document.querySelector('#livePreviewPage .lpp-stage .lp'));
  check(!!panel && LP.addUrl(A).ok, 'Live preview page shows ' + A);
  const idA = LP.tabs().find(t => t.url === A)?.id;
  const first = await until(async () => {
    const r = await main('last', '/a');
    return r && r.posts > 3 ? r : null;
  });
  check(!!first, 'the page runs and reports its counts');
  log.push('info window: hidden ' + document.hidden + ' · focused ' + document.hasFocus());

  // (a) in front
  const a = await read('/a');
  log.push('info (a) tab in front: ' + say(a));
  check(a.raf > 5 && a.tick > 5 && a.gl > 5, '(a) a tab in front runs (frames, timers, WebGL)');

  // (b) behind another tab
  check(LP.addUrl(B).ok && LP.tabs().find(t => t.active)?.url === B, 'a second tab is in front');
  await wait(1200);
  const b = await read('/a');
  log.push('info (b) tab behind another tab: ' + say(b));
  check(
    b.raf === 0 && b.gl === 0,
    '(b) a tab behind another tab draws nothing (frames and WebGL at 0); its timers: ' +
      b.tick +
      '/s'
  );
  const bFront = await read('/b', 1500);
  check(bFront.raf > 5 && bFront.tick > 5, 'the tab in front of it runs: ' + say(bFront));

  // shown again: same document, counters carry on
  const stopped = await main('last', '/a');
  LP.select(idA);
  await wait(1500);
  const back = await read('/a', 2000);
  log.push(
    'info shown again: ' +
      say(back) +
      ' · timer count ' +
      stopped?.tick +
      ' → ' +
      back.end?.tick +
      ' · same document ' +
      (back.born === a.born)
  );
  check(
    back.born === a.born && back.end?.tick > stopped?.tick && back.raf > 5 && back.tick > 5,
    'shown again it carries on where it was: not reloaded, its counter went on from ' +
      stopped?.tick +
      ' to ' +
      back.end?.tick
  );
  const bBehind = await read('/b', 1500);
  check(
    bBehind.raf === 0 && bBehind.gl === 0,
    'and the other tab, now behind, draws nothing: ' + say(bBehind)
  );

  // (c) the tab in front, but another page of the app shown
  window.TnaiRoute('skills');
  await wait(1200);
  check(!LPP.visible(), 'another page of the app (Skills) is shown');
  const c = await read('/a');
  log.push('info (c) tab in front, Skills page shown: ' + say(c));
  check(
    c.raf === 0 && c.gl === 0,
    '(c) with another page of the app shown the previewed page draws nothing; its timers: ' +
      c.tick +
      '/s'
  );

  // The app's own questions to a page that is not on screen (its address, for the toolbar) are
  // still answered.
  const fName = [...document.querySelectorAll('#livePreviewPage iframe.lp-frame')].find(
    f => f.getAttribute('src') === A
  )?.name;
  const where = await Promise.race([
    window.tnaiNative.preview.nav(fName, 'where'),
    wait(3000).then(() => 'NO ANSWER'),
  ]);
  check(where === A, 'a page that is not on screen still answers the app (its address): ' + where);
  const stopped2 = await main('last', '/a');
  LPP.open();
  await wait(1500);
  const back2 = await read('/a', 2000);
  log.push(
    'info Live preview page shown again: ' +
      say(back2) +
      ' · timer count ' +
      stopped2?.tick +
      ' → ' +
      back2.end?.tick
  );
  check(
    back2.born === a.born && back2.end?.tick > stopped2?.tick && back2.raf > 5,
    'back on the Live preview page it carries on: not reloaded, counter from ' +
      stopped2?.tick +
      ' to ' +
      back2.end?.tick
  );

  // Side by side: every view on screen runs (the extra views load the shown tab's address
  // themselves).
  const sbs = document.querySelector('.lpp-sbs-btn');
  if (sbs && !sbs.disabled) {
    sbs.click();
    await wait(2500);
    const frames = [...document.querySelectorAll('#livePreviewPage iframe.lp-frame')].filter(
      f => f.getAttribute('src') === A && !f.closest('[hidden]')
    );
    const s = await read('/a', 2000);
    log.push(
      'info Side by side: ' + frames.length + ' views of /a on screen · last heard ' + say(s)
    );
    check(
      frames.length >= 3 && s.posts > 0 && s.tick > 5,
      'Side by side: the views on screen run (' + frames.length + ' views)'
    );
    sbs.click();
    await wait(400);
  } else check(false, 'Side by side button not found');

  LP.tabs()
    .filter(t => t.url === A || t.url === B)
    .forEach(t => LP.close(t.id));
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + (error.stack || '').split('\n')[1]);
}
return { ok, log };
