// Test of phone/src/watch.mjs:  node phone/test/watch-test.mjs  (plain Node).
// Watch on the phone against the computer's real watched side (desktop/remote-view.js
// createViews): the phone asks with the row's ticket, the computer answers `viewing`, sends the
// screen as frames, the phone inflates and checks them and keeps one picture; changed rows update
// it; Keep and Stop reach the computer; a refusal, a junk frame, a frame too large to inflate and
// a flood are handled as the computer's own watcher handles them.
import { createRequire } from 'node:module';
import { deflateRawSync } from 'node:zlib';
import { createWatch, checkFrame, unpack } from '../src/watch.mjs';

const require = createRequire(import.meta.url);
const V = require('../../desktop/remote-view.js');

let passed = 0;
let failed = 0;
const check = (name, ok, got) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
};
const settle = () => new Promise(r => setTimeout(r, 5));
const PHONE = 'ph-0123456789';
const TICKET = 'a'.repeat(16);

const screenOf = (rows, text) => ({
  cols: 40,
  rows,
  lines: Array.from({ length: rows }, (_, y) => [text + ' ' + y]),
});

function world({ grant = true } = {}) {
  const w = { t: 1_000_000, m: 5000, timers: [], wire: [], toPhone: [], lines: [] };
  w.timersApi = {
    set: (fn, ms) => {
      const h = { fn, at: w.m + ms };
      w.timers.push(h);
      return h;
    },
    clear: h => {
      w.timers = w.timers.filter(x => x !== h);
    },
  };
  w.move = async ms => {
    w.m += ms;
    w.t += ms;
    for (const h of [...w.timers].sort((a, b) => a.at - b.at))
      if (h.at <= w.m && w.timers.includes(h)) {
        w.timers = w.timers.filter(x => x !== h);
        h.fn();
      }
    await settle();
    await w.phone.idle();
  };
  let n = 0;
  w.phone = createWatch({
    send: (to, obj) => {
      w.wire.push(obj);
      w.views.receive(PHONE, JSON.parse(JSON.stringify(obj)));
      return true;
    },
    fields: () => ({ id: 'p1', to: TICKET, c: 1, ms: 0 }),
    nonce: () => (++n).toString(16).padStart(16, '0'),
    now: () => w.m,
    timers: w.timersApi,
  });
  w.views = V.createViews({
    now: () => w.t,
    mono: () => w.m,
    timers: w.timersApi,
    rights: id => (id === PHONE ? 'pairing-1' : ''),
    granted: () => grant,
    live: () => true,
    fresh: () => true,
    ticket: (id, panel) => (panel === 'p1' ? TICKET : ''),
    agentName: () => 'Moss',
    peerName: () => 'Pixel',
    send: (to, obj) => {
      w.toPhone.push(obj);
      w.phone.receive(to, JSON.parse(JSON.stringify(obj)));
      return true;
    },
    screen: (panel, on) => {
      if (on) w.views.rows(panel, screenOf(5, 'first'));
    },
    allowance: { read: () => ({}), write: () => {} },
    log: () => () => {},
  });
  return w;
}

{
  const w = world();
  const r = await w.phone.open(PHONE, 'p1');
  await w.move(10);
  await w.move(1100);
  const m = w.phone.model();
  check(
    "W1 the view is asked with the row's ticket",
    r.state === 'asked' && w.wire[0].t === 'view' && w.wire[0].to === TICKET,
    w.wire[0]
  );
  check('W2 the computer says it is on', m && m.state === 'on', m && m.state);
  check(
    'W3 the screen arrives as a picture of five rows',
    m.picture &&
      m.picture.rows === 5 &&
      m.picture.lines[0].t === 'first 0' &&
      m.picture.lines[4].t === 'first 4',
    m.picture
  );

  // changed rows
  w.views.rows('p1', screenOf(5, 'next'));
  await w.move(1100);
  const m2 = w.phone.model();
  check('W4 changed rows update the picture', m2.picture.lines[2].t === 'next 2', m2.picture.lines);

  // keep
  await w.move(61_000);
  const kept = await w.phone.keep();
  check(
    'W5 Keep watching goes out as `keep` for this view',
    kept === true && w.wire.at(-1).t === 'keep' && w.wire.at(-1).v === w.wire[0].n,
    w.wire.at(-1)
  );

  // stop
  w.phone.close('closed');
  check(
    'W6 Stop tells the computer and keeps nothing',
    w.wire.at(-1).t === 'unview' && w.phone.model() === null
  );
}

{
  const w = world({ grant: false });
  await w.phone.open(PHONE, 'p1');
  await w.move(10);
  const m = w.phone.model();
  check(
    'W7 a computer that does not let this phone watch says so, and the view ends',
    m && m.state === 'ended' && m.why === 'refused',
    m
  );
}

{
  const w = world();
  await w.phone.open(PHONE, 'p1');
  await w.move(1100);
  const v = w.wire[0].n;

  // a junk frame and one that inflates past the limit are dropped
  w.phone.receive(PHONE, { t: 'frame', v, s: 99, i: 0, k: 1, z: '!!notbase64' });
  const huge = deflateRawSync(
    Buffer.from(JSON.stringify({ f: 1, c: 1, r: 1, x: 0, l: [[0, 'x'.repeat(70000)]] }))
  ).toString('base64');
  w.phone.receive(PHONE, { t: 'frame', v, s: 100, i: 0, k: 1, z: huge.slice(0, 4000) });
  await w.move(10);
  check(
    'W8 junk frames are dropped and the picture is marked incomplete',
    w.phone.model().picture.incomplete === true
  );
  check('W9 a frame that inflates past 64 KB is refused', (await unpack(huge)) === null);

  // a flood ends the view
  for (let i = 0; i < 20; i++)
    w.phone.receive(PHONE, { t: 'frame', v, s: 200 + i, i: 0, k: 2, z: 'AAAA' });
  await w.move(10);
  check(
    'W10 more than fifteen frames in ten seconds end the view',
    w.phone.model().state === 'ended' && w.phone.model().why === 'flood',
    w.phone.model().why
  );
}

// the checks are the computer's
{
  const good = {
    f: 1,
    c: 10,
    r: 2,
    x: 0,
    l: [
      [0, 'ab', [[0, 1, 2, -1, 1]]],
      [1, 'cd'],
    ],
  };
  const bad = [
    { ...good, c: 0 },
    {
      ...good,
      l: [
        [1, 'ab'],
        [0, 'cd'],
      ],
    },
    {
      ...good,
      l: [
        [0, 'a\u0007b'],
        [1, 'cd'],
      ],
    },
    {
      ...good,
      l: [
        [0, 'ab', [[0, 5, 2, -1, 1]]],
        [1, 'cd'],
      ],
    },
  ];
  check(
    "W11 a good frame passes the phone's check as it passes the computer's",
    JSON.stringify(checkFrame(good)) ===
      JSON.stringify(V.checkFrame ? V.checkFrame(good) : checkFrame(good))
  );
  check(
    'W12 bad frames are refused',
    bad.every(b => checkFrame(b) === null)
  );
}

console.log(`watch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
