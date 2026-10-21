// Test of desktop/phone-qr.js:  node phone/test/phone-qr-test.mjs  (plain Node).
// The code the computer draws for "Add a phone" is read back by the phone's own reader (jsQR, the
// file phone/app/qr-worker.js loads) and gives exactly the text phone-pair.js made, which the
// phone's readCode then accepts. Also: the library is the vendored file unchanged, and anything
// that is not a code's text is refused.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { readCode } from '../src/pair.mjs';

const require = createRequire(import.meta.url);
const { qrRows, TEXT_MAX } = require('../../desktop/phone-qr.js');
const { phonePairing } = require('../../desktop/phone-pair.js');
const { pairingGuard } = require('../../desktop/remote-keys.js');
const noise = require('../../desktop/remote-noise.js');

let passed = 0;
let failed = 0;
const check = (name, ok, got) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
};
const at = f => new URL('../../' + f, import.meta.url);
const sha = f =>
  createHash('sha256')
    .update(readFileSync(at(f)))
    .digest('hex');

check(
  'Q1 the desktop copy of the QR library is the vendored file unchanged',
  sha('desktop/vendor/qrcode.js') === sha('tools/phone-pair-try/vendor/qrcode.js')
);

// The phone's reader, in a box as its worker has it.
const box = vm.createContext({ Uint8ClampedArray });
vm.runInContext(readFileSync(at('phone/app/vendor/jsqr.js'), 'utf8'), box);
const jsQR = box.jsQR;

// Rows of squares drawn as a picture: 6 pixels a square, 4 squares of white around it.
function picture({ size, rows }) {
  const cell = 6;
  const margin = 4 * cell;
  const side = size * cell + 2 * margin;
  const px = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (rows[y][x] === '1')
        for (let dy = 0; dy < cell; dy++)
          for (let dx = 0; dx < cell; dx++) {
            const i = ((margin + y * cell + dy) * side + margin + x * cell + dx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 0;
          }
  return { px, side };
}

const pair = noise.generateKeyPair();
const run = phonePairing({
  self: { id: 'pc-0000aaaa', priv: pair.priv, pub: pair.pub },
  name: 'Desktop',
  guard: pairingGuard(),
});
const text = run.show().qr;
const rows = qrRows(text);
check(
  'Q2 a code is made as rows of squares',
  rows &&
    rows.rows.length === rows.size &&
    rows.rows.every(r => /^[01]+$/.test(r) && r.length === rows.size),
  rows && rows.size
);
const pic = picture(rows);
const read = jsQR(pic.px, pic.side, pic.side);
check(
  "Q3 the phone's reader reads exactly the text the computer made",
  read && read.data === text,
  read && read.data
);
check(
  "Q4 and the phone takes it as this computer's pairing code",
  !!readCode(read && read.data) && readCode(read.data).id === 'pc-0000aaaa'
);
check(
  "Q5 anything that is not a code's text is refused",
  qrRows('') === null && qrRows(42) === null && qrRows('x'.repeat(TEXT_MAX + 1)) === null
);

console.log(`phone-qr: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
