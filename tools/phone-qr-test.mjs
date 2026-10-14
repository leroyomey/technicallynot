// Checks the phone's own code reader (phone/app/qr-worker.js with phone/app/vendor/jsqr.js), used
// where the browser has none (Safari on an iPhone): node tools/phone-qr-test.mjs Plain Node: the
// worker's own file runs in a closed box with made-up camera pictures of codes drawn by the same
// library the try's computer page draws them with. It does not prove a real camera, a real iPhone,
// or the page's picture-taking (app.mjs ownReader): a separate try runs the worker
// in Safari's engine, and only a phone proves the camera.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const qrcode = require('./phone-pair-try/vendor/qrcode.js');
const at = p => new URL('../phone/app/' + p, import.meta.url);

let passed = 0,
  failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? '  ' + detail : ''));
  }
};

// 1. The reading code is the published one, byte for byte. A changed file fails here until someone
// has looked at the change. jsQR 1.4.0, dist/jsQR.js from the npm package
const JSQR_SHA256 = 'bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859';
const lib = readFileSync(at('vendor/jsqr.js'));
ok(
  'vendor/jsqr.js is jsQR 1.4.0 unchanged',
  createHash('sha256').update(lib).digest('hex') === JSQR_SHA256
);
ok(
  'its licence is beside it',
  readFileSync(at('vendor/jsqr-LICENSE.txt'), 'utf8').includes('Apache License')
);
ok(
  'the reading code names no address and no storage',
  !/\b(fetch|XMLHttpRequest|WebSocket|indexedDB|localStorage|importScripts|eval)\b|new Function/.test(
    lib.toString('utf8')
  )
);

// 2. The worker's own file, in a box that has only what a worker has to have.
const said = [];
const box = vm.createContext({ Uint8ClampedArray, postMessage: m => said.push(m) });
box.self = box;
box.importScripts = (...files) => {
  for (const f of files) vm.runInContext(readFileSync(at(f), 'utf8'), box, { filename: f });
};
vm.runInContext(readFileSync(at('qr-worker.js'), 'utf8'), box, { filename: 'qr-worker.js' });
let seq = 0;
const read = (pic, extra) => {
  said.length = 0;
  const n = ++seq;
  box.onmessage({ data: extra || { n, data: pic.px.buffer, width: pic.size, height: pic.size } });
  return said.length === 1 && (extra || said[0].n === n) ? said[0].text : 'no answer';
};

// A made-up camera picture: the code somewhere on a grey, grainy square, at an angle, as large and
// as sharp as asked.
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function picture(
  text,
  {
    size = 720,
    fill = 0.6,
    turn = 0,
    dark = 30,
    light = 225,
    grain = 12,
    dx = 0,
    dy = 0,
    invert = false,
  } = {}
) {
  const q = qrcode(0, 'L');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount(),
    cell = (size * fill) / (n + 8),
    c = Math.cos(-turn),
    s = Math.sin(-turn),
    half = (n + 8) / 2;
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const rx = x - size / 2 - dx,
        ry = y - size / 2 - dy,
        u = (rx * c - ry * s) / cell + half,
        v = (rx * s + ry * c) / cell + half;
      let g = 128; // the room around the screen
      if (u >= 0 && v >= 0 && u < n + 8 && v < n + 8) {
        const mx = Math.floor(u) - 4,
          my = Math.floor(v) - 4;
        g = mx >= 0 && my >= 0 && mx < n && my < n && q.isDark(my, mx) ? dark : light;
        if (invert) g = 255 - g;
      }
      g += (rand() - 0.5) * 2 * grain;
      const i = (y * size + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = g;
      px[i + 3] = 255;
    }
  return { px, size, modules: n };
}

// The page takes each look at another size (app.mjs OWN_SIDES): a camera picture of 1080 made
// smaller, its grain evened out.
const shrink = (p, k) => {
  const size = Math.floor(p.size / k),
    px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let j = 0; j < k; j++)
        for (let i = 0; i < k; i++) s += p.px[((y * k + j) * p.size + x * k + i) * 4];
      const o = (y * size + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = s / (k * k);
      px[o + 3] = 255;
    }
  return { px, size };
};
const anySize = (text, how) => {
  const big = picture(text, { size: 1080, ...how });
  return [1.5, 3, 2].some(
    k => read(k === 1.5 ? picture(text, { size: 720, ...how }) : shrink(big, k)) === text
  );
};

// A pairing code is a short line of letters, digits and marks; these are longer than any the app
// makes, and one is not Latin.
const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const line = n =>
  'tnai-pair:1.' + Array.from({ length: n }, () => abc[Math.floor(rand() * 64)]).join('');
const texts = [line(60), line(120), line(220)];
{
  const p = picture(texts[1]);
  ok('a code held straight is read', read(p) === texts[1], p.modules + ' modules');
  ok(
    'every length of code is read',
    texts.every(t => read(picture(t)) === t)
  );
  ok(
    'held at an angle',
    [0.2, -0.35, 0.8, Math.PI / 2, Math.PI].every(
      turn => read(picture(texts[1], { turn })) === texts[1]
    )
  );
  ok('off to one side', read(picture(texts[1], { fill: 0.45, dx: 150, dy: -120 })) === texts[1]);
  ok('small in the picture', read(picture(texts[1], { fill: 0.3 })) === texts[1]);
  const dim = [
    [70, 170, 12],
    [70, 170, 25],
    [30, 225, 25],
    [90, 160, 10],
    [90, 160, 25],
    [50, 150, 20],
    [100, 200, 20],
  ];
  const missed = dim.flatMap(([dark, light, grain]) =>
    texts
      .filter(t => !anySize(t, { dark, light, grain }))
      .map(t => `${dark}/${light} grain ${grain} length ${t.length}`)
  );
  ok(
    'a dim, grainy picture is read at one of the sizes the page tries',
    missed.length === 0,
    missed.join(' | ')
  );
  ok(
    'a small picture from an older phone',
    read(picture(texts[0], { size: 360, fill: 0.7 })) === texts[0]
  );
  ok(
    'a picture with no code gives nothing',
    read(picture(texts[0], { fill: 0.6, dark: 128, light: 128 })) === null
  );
  ok(
    'a light-on-dark code is not read (the app never shows one)',
    read(picture(texts[0], { invert: true })) === null
  );
  ok(
    'other text is handed back as it is, for the page to refuse',
    read(picture('https://example.com/not-a-pairing-code')) ===
      'https://example.com/not-a-pairing-code'
  );
}

// 3. Whatever it is sent, it answers, and never with anything but a text or nothing.
{
  const junk = [
    { n: 1 },
    { n: 2, data: new ArrayBuffer(8), width: 100, height: 100 },
    { n: 3, data: 'x', width: 2, height: 2 },
    { n: 4, data: new ArrayBuffer(0), width: 0, height: 0 },
    { n: 5, data: new ArrayBuffer(16), width: -2, height: -2 },
  ];
  ok(
    'a broken message gets "nothing", not a crash',
    junk.every(j => read(null, j) === null)
  );
  said.length = 0;
  let threw = false;
  try {
    box.onmessage({});
  } catch {
    threw = true;
  }
  ok('and so does an empty one', !threw && said.length === 1 && said[0].text === null);
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
