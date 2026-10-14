#!/usr/bin/env node

/*
 * Technically Not tools · ghost-lines.js — Finds faint 1px lines in a screenshot that the eye
 * barely sees ("ghost lines"). A line is a column (or row) of pixels that
 * is lighter or darker than BOTH neighbors over a long run; a box edge differs from one side only
 * and is not reported. Usage: node tools/ghost-lines.js <png ...> [--min 1.2] [--run 80]. Prints "v
 * x=677 y=197..254 (-3.1)" per vertical line and "h y=… x=…..…" per horizontal one; the number is
 * the brightness difference (0–255, negative = darker). Reads 8-bit RGB/RGBA PNGs (what the desktop
 * tests save). No dependencies.
 */
const fs = require('fs'),
  zlib = require('zlib');
const args = process.argv.slice(2),
  opt = (k, d) => {
    const i = args.indexOf('--' + k);
    return i < 0 ? d : +args.splice(i, 2)[1];
  };
const MIN = opt('min', 1.2),
  RUN = opt('run', 80);

function decode(file) {
  const b = fs.readFileSync(file);
  let p = 8,
    w = 0,
    h = 0,
    type = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p),
      kind = b.toString('latin1', p + 4, p + 8),
      data = b.subarray(p + 8, p + 8 + len);
    p += len + 12;
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12])
        throw new Error('unsupported PNG: ' + file);
    } else if (kind === 'IDAT') idat.push(data);
  }
  const bpp = type === 6 ? 4 : 3,
    raw = zlib.inflateSync(Buffer.concat(idat)),
    stride = w * bpp,
    lum = new Float32Array(w * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)],
      row = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0,
        u = prev[i],
        c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = u;
      else if (f === 3) add = (a + u) >> 1;
      else if (f === 4) {
        const q = a + u - c,
          pa = Math.abs(q - a),
          pb = Math.abs(q - u),
          pc = Math.abs(q - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? u : c;
      }
      row[i] = (row[i] + add) & 255;
    }
    for (let x = 0; x < w; x++)
      lum[y * w + x] = 0.299 * row[x * bpp] + 0.587 * row[x * bpp + 1] + 0.114 * row[x * bpp + 2];
    prev = row;
  }
  return { w, h, lum };
}

// Lines along the second axis: at(a, b) reads the pixel at line position a, distance b along the
// line.
function lines(nA, nB, at) {
  const out = [],
    STEP = 2; // how far a neighbor is: 2 px, so a 2 px wide line is still seen
  for (let a = STEP + 1; a < nA - STEP - 1; a++) {
    let start = -1,
      sum = 0,
      sign = 0;
    const close = b => {
      if (start >= 0 && b - start >= RUN)
        out.push({ a, from: start, to: b - 1, diff: sum / (b - start) });
      start = -1;
      sum = 0;
      sign = 0;
    };
    for (let b = 0; b < nB; b++) {
      // smooth along the line over 9 px so grain does not break a run
      let me = 0,
        lo = 0,
        hi = 0,
        n = 0;
      for (let k = -4; k <= 4; k++) {
        const bb = b + k;
        if (bb < 0 || bb >= nB) continue;
        me += at(a, bb);
        lo += at(a - STEP, bb);
        hi += at(a + STEP, bb);
        n++;
      }
      me /= n;
      lo /= n;
      hi /= n;
      const d1 = me - lo,
        d2 = me - hi,
        s = d1 > 0 && d2 > 0 ? 1 : d1 < 0 && d2 < 0 ? -1 : 0,
        // a plain box edge lies between its neighbors (s = 0); an edge with a darker or lighter rim
        // is a line
        strong = Math.min(Math.abs(d1), Math.abs(d2)) >= MIN;
      if (s && strong && (sign === 0 || sign === s)) {
        if (start < 0) start = b;
        sign = s;
        sum += (d1 + d2) / 2;
      } else close(b);
    }
    close(nB);
  }
  return out;
}

let total = 0;
for (const file of args) {
  const { w, h, lum } = decode(file);
  const v = lines(w, h, (x, y) => lum[y * w + x]),
    hz = lines(h, w, (y, x) => lum[y * w + x]);
  console.log(
    file.replace(/^.*[\\/]/, '') +
      ' (' +
      w +
      '×' +
      h +
      '): ' +
      v.length +
      ' vertical, ' +
      hz.length +
      ' horizontal'
  );
  for (const l of v)
    console.log('  v x=' + l.a + ' y=' + l.from + '..' + l.to + ' (' + l.diff.toFixed(1) + ')');
  for (const l of hz)
    console.log('  h y=' + l.a + ' x=' + l.from + '..' + l.to + ' (' + l.diff.toFixed(1) + ')');
  total += v.length + hz.length;
}
console.log(total + ' line(s) in ' + args.length + ' file(s)');
