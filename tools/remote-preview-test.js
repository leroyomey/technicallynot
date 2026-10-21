// Test of desktop/remote-preview.js: node tools/remote-preview-test.js (plain Node; also run it in
// Electron's Node). Another computer's Live preview as a picture: the address rule, the JPEG
// check, the shrinking, and both ends joined in memory over a stand-in link (shown, none, busy,
// the gap between shots, the limit, the right going off, a picture changed on the way, no answer).
// The shot is a stand-in; nothing opens a window.
'use strict';
const crypto = require('crypto');
const {
  createPreviewAnswerer,
  createPreviewAsker,
  pageAddress,
  isJpeg,
  fitPicture,
  PICTURE_MAX,
  ASKS_MIN,
  SHOT_GAP_MS,
  ANSWER_MS,
} = require('../desktop/remote-preview.js');
const { MAX_PLAIN } = require('../desktop/remote-noise.js');

let passed = 0;
let failed = 0;
const check = (name, ok) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
};
const settleAll = async () => {
  for (let step = 0; step < 20; step++) await new Promise(resolve => setImmediate(resolve));
};

// A stand-in JPEG: the right first and last bytes around random ones.
const jpeg = size =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    crypto.randomBytes(size - 5),
    Buffer.from([0xff, 0xd9]),
  ]);

function world(options = {}) {
  let clock = 100000;
  let right = true;
  let shot =
    options.shot !== undefined
      ? options.shot
      : { url: 'http://localhost:5173/app?token=x#top', bytes: jpeg(20000), w: 1280, h: 800 };
  const wire = [];
  const urls = [];
  const timers = [];
  let tooBig = false;
  const answerer = createPreviewAnswerer({
    now: () => clock,
    may: () => right,
    take: async () => (typeof shot === 'function' ? shot() : shot),
    send: (peerId, obj) => {
      if (Buffer.byteLength(JSON.stringify(obj)) > MAX_PLAIN) tooBig = true;
      if (obj.url !== undefined) urls.push(obj.url);
      wire.push(JSON.parse(JSON.stringify(obj)));
      return true;
    },
    room: () => (options.room === undefined ? 70 : options.room),
  });
  const asker = createPreviewAsker({
    now: () => clock,
    timers: {
      set: (fn, ms) => {
        const handle = { fn, at: clock + ms };
        timers.push(handle);
        return handle;
      },
      clear: handle => {
        handle.fn = null;
      },
    },
    send: (peerId, obj) => {
      answerer.receive('watcher', JSON.parse(JSON.stringify(obj)));
      return true;
    },
  });
  const deliver = async () => {
    await settleAll();
    while (wire.length) {
      const obj = wire.shift();
      asker.receive('target', options.mangle ? options.mangle(obj) : obj);
    }
  };
  return {
    answerer,
    asker,
    deliver,
    tick: ms => {
      clock += ms;
      for (const handle of timers) if (handle.fn && handle.at <= clock) handle.fn();
    },
    setRight: value => (right = value),
    setShot: value => (shot = value),
    tooBig: () => tooBig,
    urls,
  };
}

(async () => {
  // ---------- the address ----------
  check(
    'address: query, fragment dropped',
    pageAddress('http://localhost:5173/app?token=x#top') === 'http://localhost:5173/app'
  );
  check('address: 127.0.0.1', pageAddress('https://127.0.0.1:8443/') === 'https://127.0.0.1:8443/');
  check('address: [::1]', pageAddress('http://[::1]:3000/x') === 'http://[::1]:3000/x');
  check(
    'address: sign-in dropped',
    pageAddress('http://user:pw@localhost:3000/') === 'http://localhost:3000/'
  );
  for (const bad of [
    'http://example.com/',
    'file:///C:/x',
    'javascript:alert(1)',
    'ftp://localhost/',
    '',
    5,
    null,
  ])
    check('address refused: ' + JSON.stringify(bad), pageAddress(bad) === '');
  check('address: cut at 200', pageAddress('http://localhost:1/' + 'a'.repeat(400)).length === 200);

  // ---------- the picture ----------
  check('jpeg: a whole one', isJpeg(jpeg(100)));
  check('jpeg: a PNG is not', !isJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])));
  check('jpeg: a cut one is not', !isJpeg(jpeg(100).subarray(0, 90)));
  const tried = [];
  const fit = await fitPicture(async (width, quality) => {
    tried.push(width + '/' + quality);
    return jpeg(width * quality);
  });
  check(
    'fit: the first that fits wins (960 wide, quality 40)',
    fit && fit.bytes.length <= PICTURE_MAX && fit.width === 960 && tried.length === 3
  );
  check('fit: large ones are tried first', tried[0] === '960/70');
  check(
    'fit: nothing fits → null',
    (await fitPicture(async () => jpeg(PICTURE_MAX + 10))) === null
  );
  check(
    'fit: a throwing encoder → null',
    (await fitPicture(async () => {
      throw new Error('x');
    })) === null
  );

  // ---------- both ends ----------
  {
    const w = world();
    check('asked', w.asker.ask('target').state === 'asked');
    await w.deliver();
    const got = w.asker.get('target');
    check('shown', got.state === 'shown' && got.url === 'http://localhost:5173/app');
    check(
      'the target itself sends the address without its query',
      w.urls.length === 1 && w.urls[0] === 'http://localhost:5173/app'
    );
    check('shown: the size', got.w === 1280 && got.h === 800);
    check('shown: the picture as base64 of a JPEG', isJpeg(Buffer.from(got.data, 'base64')));
    check('every message fits one sealed message', !w.tooBig());

    // refreshed on request, after the gap
    w.asker.ask('target');
    await w.deliver();
    check(
      'too soon: busy, the old picture stays',
      w.asker.get('target').state === 'busy' && w.asker.get('target').data === got.data
    );
    w.tick(SHOT_GAP_MS);
    w.setShot({ url: 'http://localhost:5173/other', bytes: jpeg(9000), w: 390, h: 844 });
    w.asker.ask('target');
    await w.deliver();
    check(
      'refreshed: the new picture and address',
      w.asker.get('target').url === 'http://localhost:5173/other' &&
        w.asker.get('target').data !== got.data
    );
  }
  {
    const w = world({ shot: null });
    w.asker.ask('target');
    await w.deliver();
    check('no Live preview page: none', w.asker.get('target').state === 'none');
  }
  {
    const w = world({ shot: { url: 'http://example.com/', bytes: jpeg(100), w: 1, h: 1 } });
    w.asker.ask('target');
    await w.deliver();
    check('a page not on that computer is not sent', w.asker.get('target').state === 'failed');
  }
  {
    const w = world({
      shot: { url: 'http://localhost:1/', bytes: jpeg(PICTURE_MAX + 1), w: 1, h: 1 },
    });
    w.asker.ask('target');
    await w.deliver();
    check('a picture over 40 KB is not sent', w.asker.get('target').state === 'failed');
  }
  {
    const w = world({ room: 3 });
    w.asker.ask('target');
    await w.deliver();
    check('no room for all parts: busy', w.asker.get('target').state === 'busy');
  }
  {
    const w = world({
      mangle: obj => (obj.i === 2 ? { ...obj, data: Buffer.from('x').toString('base64') } : obj),
    });
    w.asker.ask('target');
    await w.deliver();
    check(
      'a part changed on the way: failed',
      w.asker.get('target').state === 'failed' && !w.asker.get('target').data
    );
  }
  {
    const w = world();
    w.setRight(false);
    w.asker.ask('target');
    await w.deliver();
    check('right off: no answer yet', w.asker.get('target').state === 'asked');
    w.tick(ANSWER_MS);
    check('right off: reads no answer in time', w.asker.get('target').state === 'no_answer');
  }
  {
    // the switch goes off while the shot is taken
    const w = world();
    w.setShot(() => {
      w.setRight(false);
      return { url: 'http://localhost:1/', bytes: jpeg(5000), w: 1, h: 1 };
    });
    w.asker.ask('target');
    await w.deliver();
    check('right off mid-shot: nothing sent', w.asker.get('target').state === 'asked');
  }
  {
    const w = world();
    let answered = 0;
    for (let at = 0; at < ASKS_MIN + 4; at++) {
      w.tick(SHOT_GAP_MS);
      w.asker.ask('target');
      await w.deliver();
      if (w.asker.get('target').state !== 'asked') answered++;
    }
    check('limit: at most ' + ASKS_MIN + ' asks a minute answered', answered === ASKS_MIN);
  }
  {
    const w = world();
    check(
      'an answer nobody asked for is dropped',
      w.asker.receive('target', { t: 'pv', n: 'a'.repeat(16), state: 'none' }) === false
    );
    let threw = false;
    try {
      for (const bad of [null, 'x', {}, { t: 'pvask' }, { t: 'pvask', n: 7 }])
        w.answerer.receive('watcher', bad);
    } catch {
      threw = true;
    }
    check('shapes: nothing throws', !threw);
    w.asker.ask('target');
    w.asker.drop('target');
    check('drop leaves nothing', w.asker.get('target') === null);
  }

  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('ERROR ' + (error.stack || error));
  process.exit(1);
});
