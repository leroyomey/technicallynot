// Test of desktop/remote-files.js and its hooks: node tools/remote-files-test.js (plain Node; also
// run it in Electron's Node). A picture or a text file with a prompt to another computer
// and its rules. Stand-ins for the clock, the timers, the sending and the day's allowance; the
// files are made here, byte by byte. Covered: what a file may be (the strict walks, the text rule),
// the target's caps and its taking of pieces, the sender's pacing, both ends joined in memory, the
// two operations in the real remote-control.js, their shapes in the real remote-api.js, the saving
// under the target's own names in the real attachment-service.js (Electron stubbed, a temp folder),
// the tail handed to the delivery, and that the wiring sends pieces as a stream and the target's
// words as replies. A check that begins "review 18" is one the review asked for by name. Nothing
// here opens a window or starts a CLI.
const os = require('os'),
  path = require('path'),
  fs = require('fs'),
  crypto = require('crypto'),
  Module = require('module');
const rf = require('../desktop/remote-files.js');
const {
  createTaker,
  createSender,
  checkFile,
  offerOf,
  shapePart,
  shapeGot,
  idsOf,
  partsOf,
  PIECE,
  PICTURE_MAX,
  TEXT_MAX,
  PROMPT_MAX,
  PROMPT_FILES,
  DAY_MAX,
  DAY_FILES,
  FILE_MS,
  GAP_MS,
  HELD_MS,
  SIDE,
} = rf;
const { createControl } = require('../desktop/remote-control.js');
const { shapeOp } = require('../desktop/remote-api.js');
const { MAX_PLAIN } = require('../desktop/remote-noise.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// odd characters are built from numbers, never written as themselves
const ch = String.fromCodePoint;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const KB = 1024;

// ---- files made by hand ----
const u32 = n => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

// the last four bytes stand for the checksum: the walk never reads the checksum
const chunk = (type, data = Buffer.alloc(0)) =>
  Buffer.concat([u32(data.length), Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = (w, h) => chunk('IHDR', Buffer.concat([u32(w), u32(h), Buffer.from([8, 2, 0, 0, 0])]));

// A PNG of exactly `size` bytes (the data chunk is filled up), with whatever chunks are put before
// the data and after the end.
function png({
  w = 800,
  h = 600,
  size = 0,
  before = [],
  after = Buffer.alloc(0),
  end = true,
  data = true,
} = {}) {
  const head = Buffer.concat([PNG_SIG, ihdr(w, h), ...before]),
    tail = Buffer.concat([end ? chunk('IEND') : Buffer.alloc(0), after]);
  const room = Math.max(0, size - head.length - tail.length - 12);
  return Buffer.concat([head, data ? chunk('IDAT', Buffer.alloc(room, 7)) : Buffer.alloc(0), tail]);
}
const seg = (marker, data) => {
  const b = Buffer.alloc(4 + data.length);
  b[0] = 0xff;
  b[1] = marker;
  b.writeUInt16BE(data.length + 2, 2);
  data.copy(b, 4);
  return b;
};
const sof = (marker, w, h) => {
  const d = Buffer.alloc(15);
  d[0] = 8;
  d.writeUInt16BE(h, 1);
  d.writeUInt16BE(w, 3);
  d[5] = 3;
  return seg(marker, d);
};

// A JPEG of exactly `size` bytes: start, APP0, a table of each kind, one frame header, a scan whose
// bytes hold FF 00 and a restart mark, end.
function jpg({
  w = 1568,
  h = 900,
  size = 0,
  frame = 0xc0,
  extra = [],
  frames = 1,
  after = Buffer.alloc(0),
  end = true,
} = {}) {
  const head = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    ...extra,
    seg(0xdb, Buffer.alloc(65, 1)),
    ...Array.from({ length: frames }, () => sof(frame, w, h)),
    seg(0xc4, Buffer.alloc(30, 2)),
    seg(0xdd, Buffer.from([0, 8])),
    seg(0xda, Buffer.alloc(10, 3)),
  ]);
  const scan0 = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
    tail = Buffer.concat([end ? Buffer.from([0xff, 0xd9]) : Buffer.alloc(0), after]);
  return Buffer.concat([
    head,
    scan0,
    Buffer.alloc(Math.max(0, size - head.length - scan0.length - tail.length), 0x11),
    tail,
  ]);
}
const text = (size, fill = 'Line of text for the agent.\n') =>
  Buffer.from(fill.repeat(Math.ceil(size / fill.length)).slice(0, size), 'utf8');

// ---- a clock and timers moved by hand ----
function clock() {
  const c = { t: 1700000000000, list: [] };
  c.now = () => c.t;
  c.timers = {
    set: (fn, ms) => {
      const h = { at: c.t + ms, fn };
      c.list.push(h);
      return h;
    },
    clear: h => {
      const i = c.list.indexOf(h);
      if (i >= 0) c.list.splice(i, 1);
    },
  };
  c.go = ms => {
    const end = c.t + ms;
    for (;;) {
      const due = c.list.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      c.t = Math.max(c.t, due.at);
      c.list.splice(c.list.indexOf(due), 1);
      due.fn();
    }
    c.t = end;
  };
  return c;
}
let idN = 0;
const fid = () => (++idN).toString(16).padStart(16, '0');
const piecesOf = (f, data) =>
  Array.from({ length: partsOf(data.length) }, (_, i) => ({
    t: 'part',
    f,
    i,
    d: data.subarray(i * PIECE, (i + 1) * PIECE).toString('base64'),
  }));
const wire = m => JSON.parse(JSON.stringify(m)); // as a message arrives

// One target computer with one paired computer A (and C for "another computer").
function target() {
  const c = clock(),
    w = { c, sent: [], map: {}, readFails: false, writeFails: false, right: true };
  w.taker = createTaker({
    now: c.now,
    timers: c.timers,
    send: (to, obj) => {
      w.sent.push([to, obj]);
      return true;
    },
    allowance: {
      read: () => {
        if (w.readFails) throw new Error('cannot read');
        return wire(w.map);
      },
      write: m => {
        if (w.writeFails) throw new Error('cannot write');
        w.map = wire(m);
      },
    },
  });
  w.offer = (kind, data, o = {}) => {
    const f = o.f || fid();
    return [
      f,
      w.taker.offer({
        peerId: o.peer || 'A',
        pairing: o.pairing || 'pair-1',
        panelId: o.panel || 'p1',
        ticket: o.ticket || 'a'.repeat(16),
        guard: () => w.right,
        msg: wire({
          f,
          kind,
          bytes: data.length,
          parts: partsOf(data.length),
          sha: sha(data),
          ...o.msg,
        }),
      }),
    ];
  };
  w.feed = (f, data, peer = 'A') => {
    for (const p of piecesOf(f, data)) w.taker.part(peer, wire(p));
  };
  w.give = (kind, data, o = {}) => {
    const [f, word] = w.offer(kind, data, o);
    if (word === 'go') w.feed(f, data, o.peer || 'A');
    return f;
  };
  w.last = () => w.sent.at(-1)?.[1];
  w.take = (ids, o = {}) =>
    w.taker.take({
      peerId: o.peer || 'A',
      pairing: o.pairing || 'pair-1',
      panelId: o.panel || 'p1',
      ticket: o.ticket || 'a'.repeat(16),
      ids,
    });
  return w;
}

(async () => {
  // ---- what a file may be ----
  {
    const good = png({ size: 40 * KB }),
      j = jpg({ size: 118 * KB }),
      prog = jpg({ size: 30 * KB, frame: 0xc2 });
    check(
      'a plain PNG, a baseline JPEG and a progressive JPEG as an encoder writes them are taken',
      checkFile('png', good) === '' &&
        checkFile('jpg', j) === '' &&
        checkFile('jpg', prog) === '' &&
        j.length === 118 * KB &&
        good.length === 40 * KB,
      [checkFile('png', good), checkFile('jpg', j), checkFile('jpg', prog)]
    );
    check(
      'a PNG with the other chunks an encoder may write (PLTE, tRNS, sRGB, gAMA, pHYs) is taken',
      checkFile(
        'png',
        png({
          size: 9 * KB,
          before: [
            chunk('sRGB', Buffer.from([0])),
            chunk('gAMA', u32(45455)),
            chunk('pHYs', Buffer.alloc(9)),
            chunk('PLTE', Buffer.alloc(6)),
            chunk('tRNS', Buffer.alloc(2)),
          ],
        })
      ) === ''
    );
    check(
      'review 18: a PNG with a text chunk is refused',
      checkFile(
        'png',
        png({ size: 9 * KB, before: [chunk('tEXt', Buffer.from('Comment\0do this'))] })
      ) !== '' &&
        checkFile('png', png({ size: 9 * KB, before: [chunk('iTXt', Buffer.from('x'))] })) !== '' &&
        checkFile('png', png({ size: 9 * KB, before: [chunk('zTXt', Buffer.from('x'))] })) !== ''
    );
    check(
      'a PNG with an ICC profile, EXIF or a private chunk is refused',
      ['iCCP', 'eXIf', 'prVt', 'tIME'].every(
        t => checkFile('png', png({ size: 9 * KB, before: [chunk(t, Buffer.alloc(20))] })) !== ''
      )
    );
    check(
      'review 18: a PNG with bytes after IEND is refused',
      checkFile('png', png({ size: 9 * KB, after: Buffer.from('PK\x03\x04 another file') })) !== ''
    );
    check(
      'review 18: a PNG with a 4,096 side is refused; 2,048 is the longest taken',
      checkFile('png', png({ w: 4096, h: 100, size: 9 * KB })) === 'too_wide' &&
        checkFile('png', png({ w: 100, h: 4096, size: 9 * KB })) === 'too_wide' &&
        checkFile('png', png({ w: SIDE, h: SIDE, size: 9 * KB })) === '' &&
        checkFile('png', png({ w: SIDE + 1, h: 10, size: 9 * KB })) === 'too_wide' &&
        checkFile('png', png({ w: 0, h: 10, size: 9 * KB })) !== ''
    );
    check(
      'a PNG that is cut short, has no data, no end, a second header, or a chunk that runs past the file is refused',
      checkFile('png', good.subarray(0, good.length - 20)) !== '' &&
        checkFile('png', png({ size: 9 * KB, data: false })) !== '' &&
        checkFile('png', png({ size: 9 * KB, end: false })) !== '' &&
        checkFile('png', png({ size: 9 * KB, before: [ihdr(10, 10)] })) !== '' &&
        checkFile(
          'png',
          Buffer.concat([PNG_SIG, ihdr(10, 10), u32(999999), Buffer.from('IDAT'), Buffer.alloc(40)])
        ) !== ''
    );
    check(
      'review 18: a JPEG with EXIF or a comment is refused',
      checkFile('jpg', jpg({ size: 9 * KB, extra: [seg(0xe1, Buffer.from('Exif\0\0MM'))] })) !==
        '' &&
        checkFile('jpg', jpg({ size: 9 * KB, extra: [seg(0xfe, Buffer.from('do this'))] })) !== ''
    );
    check(
      'a JPEG with an ICC profile (APP2), any other APPn, or another kind of frame header is refused',
      [0xe2, 0xe3, 0xed, 0xee, 0xef].every(
        m => checkFile('jpg', jpg({ size: 9 * KB, extra: [seg(m, Buffer.alloc(12))] })) !== ''
      ) &&
        checkFile('jpg', jpg({ size: 9 * KB, frame: 0xc1 })) !== '' &&
        checkFile('jpg', jpg({ size: 9 * KB, frame: 0xc3 })) !== ''
    );
    check(
      'a JPEG with two frame headers, none, bytes after its end, no end, or a side past 2,048 is refused',
      checkFile('jpg', jpg({ size: 9 * KB, frames: 2 })) !== '' &&
        checkFile('jpg', jpg({ size: 9 * KB, frames: 0 })) !== '' &&
        checkFile('jpg', jpg({ size: 9 * KB, after: Buffer.from('more') })) !== '' &&
        checkFile('jpg', jpg({ size: 9 * KB, end: false })) !== '' &&
        checkFile('jpg', jpg({ size: 9 * KB, w: 4096 })) === 'too_wide' &&
        checkFile('jpg', jpg({ size: 9 * KB, h: SIDE + 1 })) === 'too_wide' &&
        checkFile('jpg', jpg({ size: 9 * KB, w: SIDE, h: SIDE })) === ''
    );
    check(
      'type is by content: a PNG header on a text, a text called a picture, a picture called a text, a kind that is not one of the three',
      checkFile('png', Buffer.concat([PNG_SIG, text(4000)])) !== '' &&
        checkFile('png', text(4000)) !== '' &&
        checkFile('jpg', good) !== '' &&
        checkFile('png', j) !== '' &&
        checkFile('txt', good) !== '' &&
        checkFile('txt', j) !== '' &&
        checkFile('pdf', text(100)) === 'kind' &&
        checkFile('gif', good) === 'kind' &&
        checkFile('txt', Buffer.alloc(0)) === 'kind' &&
        checkFile('txt', 'not a buffer') === 'kind'
    );
    check(
      'the caps for one file: a picture of 150 KB is taken and one byte more is not; a text of 64 KB and one byte more',
      checkFile('jpg', jpg({ size: PICTURE_MAX })) === '' &&
        checkFile('jpg', jpg({ size: PICTURE_MAX + 1 })) === 'too_big' &&
        checkFile('png', png({ size: PICTURE_MAX + 1 })) === 'too_big' &&
        checkFile('txt', text(TEXT_MAX)) === '' &&
        checkFile('txt', text(TEXT_MAX + 1)) === 'too_big'
    );
    const t = s => checkFile('txt', Buffer.from(s, 'utf8'));
    check(
      'a plain text is taken: letters of any script, tabs, both kinds of line end, a byte-order mark at the very start, the two zero-width joiners',
      t('Hello\r\n\tworld\n') === '' &&
        t(ch(0xfeff) + 'Hello') === '' &&
        t('a' + ch(0x200d) + 'b' + ch(0x200c) + 'c') === '' &&
        t(ch(0x915) + ch(0x4e2d) + ' ok') === '' &&
        t(ch(0x1f600) + ' ok') === ''
    );
    check(
      'review 18: a text with a tag character is refused',
      t('Fix it.' + ch(0xe0049) + ch(0xe0067)) === 'hidden' &&
        t('x' + ch(0xe0001)) === 'hidden' &&
        t('x' + ch(0xe007f)) === 'hidden' &&
        t('x' + ch(0xe0000)) === 'hidden'
    );
    check(
      'review 18: a text with a direction override or isolate is refused',
      [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].every(
        n => t('abc' + ch(n) + 'def') === 'hidden'
      )
    );
    check(
      'review 18: a text with a byte-order mark in the middle is refused',
      t('abc' + ch(0xfeff) + 'def') === 'hidden' && t(ch(0xfeff) + ch(0xfeff) + 'abc') === 'hidden'
    );
    check(
      'a text with any other character nobody can see (zero-width space, soft hyphen, word joiner, a direction mark) is refused',
      [0x200b, 0xad, 0x2060, 0x200e, 0x200f, 0x061c].every(
        n => t('abc' + ch(n) + 'def') === 'hidden'
      )
    );
    check(
      'a text with a NUL, an escape, a form feed or another control character, invalid UTF-8, or nothing but spaces is refused',
      t('a\0b') !== '' &&
        t('a' + ch(0x1b) + '[31m') !== '' &&
        t('a' + ch(0x0c) + 'b') !== '' &&
        t('a' + ch(0x85) + 'b') !== '' &&
        checkFile('txt', Buffer.from([0x61, 0xff, 0xfe, 0x62])) !== '' &&
        checkFile('txt', Buffer.from([0xc3])) !== '' &&
        t('  \n\t ') !== ''
    );
  }

  // ---- the shapes of the messages that are not operations ----
  {
    const data = jpg({ size: 10 * KB }),
      f = fid(),
      ok = { f, kind: 'jpg', bytes: data.length, parts: partsOf(data.length), sha: sha(data) };
    check(
      'an offer is read field by field: its own id, a kind word, the size, the pieces that size makes, a SHA-256',
      JSON.stringify(offerOf({ ...ok, name: 'C:\\x\\secret.png', path: '..\\..\\x', when: 5 })) ===
        JSON.stringify(ok)
    );
    check(
      "an offer with a size past its kind's cap, a wrong number of pieces, an unknown kind, a bad id or hash is nothing",
      [
        { bytes: PICTURE_MAX + 1, parts: partsOf(PICTURE_MAX + 1) },
        { kind: 'txt', bytes: TEXT_MAX + 1, parts: partsOf(TEXT_MAX + 1) },
        { parts: ok.parts + 1 },
        { parts: 1 },
        { bytes: 0, parts: 0 },
        { bytes: 1.5 },
        { kind: 'pdf' },
        { kind: 'exe' },
        { f: 'short' },
        { f: 'G'.repeat(16) },
        { sha: 'x' },
        { sha: ok.sha.toUpperCase() },
      ].every(o => offerOf({ ...ok, ...o }) === null) && offerOf(null) === null
    );
    const p = { t: 'part', f, i: 0, d: Buffer.alloc(PIECE, 1).toString('base64') };
    check(
      'a piece: the file id, its number and base64 of at most 3,000 bytes; anything else is nothing',
      JSON.stringify(shapePart({ ...p, x: 1 })) === JSON.stringify(p) &&
        p.d.length === 4000 &&
        [
          { d: p.d + 'AAAA' },
          { d: '' },
          { d: 'not base64!!' },
          { d: 'abc' },
          { i: -1 },
          { i: 1.5 },
          { i: partsOf(PICTURE_MAX) },
          { f: '' },
          { d: 5 },
        ].every(o => shapePart({ ...p, ...o }) === null)
    );
    check(
      'with its fields a piece fits one sealed message',
      Buffer.byteLength(JSON.stringify({ t: 'part', f, i: partsOf(PICTURE_MAX) - 1, d: p.d })) <=
        MAX_PLAIN
    );
    check(
      "the target's word on pieces: more, done, and anything else reads as failed",
      shapeGot({ f, i: 3, state: 'more' }).state === 'more' &&
        shapeGot({ f, i: 3, state: 'done' }).state === 'done' &&
        shapeGot({ f, i: 3, state: 'whatever' }).state === 'failed' &&
        shapeGot({ f, i: 3 }).state === 'failed' &&
        shapeGot({ f: 'x', i: 3, state: 'done' }) === null &&
        shapeGot({ f, i: -1, state: 'done' }) === null
    );
    check(
      'the ids a prompt names: one to three different ones',
      JSON.stringify(idsOf([f])) === JSON.stringify([f]) &&
        idsOf([f, f]) === null &&
        idsOf([]) === null &&
        idsOf([fid(), fid(), fid(), fid()]) === null &&
        idsOf('x') === null &&
        idsOf([f, 'bad']) === null &&
        idsOf([fid(), fid(), fid()]).length === 3
    );
  }

  // ---- the two operations as remote-api.js lets them through ----
  {
    const base = { n: 'a'.repeat(16), c: 3, ms: 10, id: 'terminal-1-ab', to: 'b'.repeat(16) },
      f = fid();
    const offer = {
      t: 'file',
      ...base,
      f,
      kind: 'jpg',
      bytes: 5000,
      parts: 2,
      sha: 'c'.repeat(64),
    };
    check(
      'shapeOp: an offer keeps its named fields and nothing else (no name, path or date can ride along)',
      JSON.stringify(shapeOp({ ...offer, name: 'x.png', path: 'C:\\x', date: 1 })) ===
        JSON.stringify(offer)
    );
    check(
      'shapeOp: an offer of the wrong form is nothing',
      [
        { f: 'x' },
        { kind: 'jpeg' },
        { kind: 'JPG' },
        { bytes: 0 },
        { bytes: '5' },
        { parts: 0 },
        { sha: 'c'.repeat(63) },
        { to: '' },
        { id: '' },
        { n: '' },
      ].every(o => shapeOp({ ...offer, ...o }) === null)
    );
    const pf = { t: 'promptf', ...base, text: 'Look at this', files: [f] };
    check(
      'shapeOp: a prompt that names files keeps its text and one to three ids',
      JSON.stringify(shapeOp({ ...pf, extra: 1 })) === JSON.stringify(pf) &&
        shapeOp({ ...pf, files: [] }) === null &&
        shapeOp({ ...pf, files: [f, f, f, f] }) === null &&
        shapeOp({ ...pf, files: 'x' }) === null &&
        shapeOp({ ...pf, files: ['x'] }) === null &&
        shapeOp({ ...pf, text: '' }) === null
    );
    check(
      'shapeOp: a plain prompt is unchanged by all this and carries no files',
      JSON.stringify(shapeOp({ t: 'prompt', ...base, text: 'Hi', files: [f] })) ===
        JSON.stringify({ t: 'prompt', ...base, text: 'Hi' })
    );
  }

  // ---- the target: offers ----
  {
    let w = target();
    const pic = jpg({ size: 60 * KB });
    let [f, word] = w.offer('jpg', pic);
    check(
      'an offer inside every cap gets "go", and the day is reserved before a byte flows',
      word === 'go' && w.sent.length === 0 && w.map.A.length === 1 && w.map.A[0][1] === pic.length,
      [word, w.map]
    );
    check(
      'one open file for one computer: a second offer meanwhile is refused; another computer has its own',
      w.offer('txt', text(100))[1] === 'refused' &&
        w.offer('txt', text(100), { peer: 'C', pairing: 'pair-2' })[1] === 'go'
    );
    w = target();
    check(
      'review 18: a picture of 151 KB and a text of 65 KB are refused before a byte flows, and nothing of the day is used',
      w.offer('jpg', jpg({ size: 151 * KB }))[1] === 'refused' &&
        w.offer('png', png({ size: PICTURE_MAX + 1 }))[1] === 'refused' &&
        w.offer('txt', text(65 * KB))[1] === 'refused' &&
        !w.map.A &&
        w.sent.length === 0,
      w.map
    );
    check(
      'an offer whose words do not fit its bytes, or with a missing guard, pairing, panel or ticket, is refused',
      w.offer('jpg', pic, { msg: { parts: 1 } })[1] === 'refused' &&
        w.offer('jpg', pic, { msg: { kind: 'exe' } })[1] === 'refused' &&
        w.taker.offer({
          peerId: 'A',
          pairing: 'pair-1',
          panelId: 'p1',
          ticket: 'a'.repeat(16),
          msg: { f: fid(), kind: 'txt', bytes: 5, parts: 1, sha: 'a'.repeat(64) },
        }) === 'refused' &&
        w.taker.offer({
          peerId: 'A',
          pairing: '',
          panelId: 'p1',
          ticket: 'a'.repeat(16),
          guard: () => true,
          msg: { f: fid(), kind: 'txt', bytes: 5, parts: 1, sha: 'a'.repeat(64) },
        }) === 'refused' &&
        !w.map.A
    );

    // Three finished files wait: a fourth is refused.
    for (let i = 0; i < 3; i++) w.give('txt', text(200 + i));
    check(
      'three files finished and waiting for their prompt',
      w.taker.holding()[0].done === 3 && w.sent.filter(x => x[1].state === 'done').length === 3
    );
    check(
      'review 18: a fourth file is refused before a byte flows',
      w.offer('txt', text(50))[1] === 'refused' && w.map.A.length === 3
    );
    w = target();
    w.give('jpg', jpg({ size: PICTURE_MAX }));
    w.give('png', png({ size: PICTURE_MAX }));
    check(
      'review 18: with 300 KB waiting, one more byte in one prompt is refused before a byte flows',
      w.taker.holding()[0].done === 2 && w.offer('txt', text(1))[1] === 'refused'
    );
    w = target();
    w.give('jpg', jpg({ size: PICTURE_MAX }));
    w.give('jpg', jpg({ size: 100 * KB }));
    check(
      'up to 300 KB may wait: 150 + 100 + 50 is taken, 150 + 100 + 51 is not',
      w.offer('jpg', jpg({ size: 50 * KB + 1 }))[1] === 'refused' &&
        w.offer('jpg', jpg({ size: 50 * KB }))[1] === 'go'
    );

    // The day: 30 files and 3 MB from one computer in 24 hours.
    w = target();
    for (let i = 0; i < DAY_FILES; i++) {
      const f2 = w.give('txt', text(300));
      w.take([f2]);
    }
    check(
      'thirty files in a day are taken',
      w.map.A.length === DAY_FILES && w.sent.filter(x => x[1].state === 'done').length === DAY_FILES
    );
    check(
      'review 18: the 31st file of a day is refused before a byte flows; another computer is not counted with it',
      w.offer('txt', text(10))[1] === 'refused' &&
        w.offer('txt', text(10), { peer: 'C', pairing: 'pair-2' })[1] === 'go'
    );
    w.c.go(24 * 3600 * 1000 + 1000);
    check('a day later the count is free again', w.offer('txt', text(10))[1] === 'go');
    w = target();
    w.map = {
      A: Array.from({ length: 20 }, (_, i) => [
        w.c.t - 1000 * i,
        Math.floor((DAY_MAX - 1000) / 20),
      ]),
    };
    const usedNow = w.map.A.reduce((n, e) => n + e[1], 0);
    check(
      "the day's 3 MB: an offer that fits what is left is taken, one byte more is not",
      w.offer('txt', text(DAY_MAX - usedNow + 1))[1] === 'refused' &&
        w.offer('txt', text(DAY_MAX - usedNow))[1] === 'go',
      [usedNow, DAY_MAX]
    );
    w = target();
    w.map = { A: [[w.c.t + 3600 * 1000, DAY_MAX]] };
    check('an entry dated in the future counts', w.offer('txt', text(10))[1] === 'refused');
    w = target();
    w.readFails = true;
    check(
      'an allowance that cannot be read reads as all used',
      w.offer('txt', text(10))[1] === 'refused'
    );
    w = target();
    w.writeFails = true;
    check(
      'an allowance that cannot be written gives nothing',
      w.offer('txt', text(10))[1] === 'refused' && w.taker.holding().every(x => !x.open)
    );
    w = target();
    w.map = { A: 'not a list' };
    check(
      'an allowance of the wrong shape reads as all used',
      w.offer('txt', text(10))[1] === 'refused' &&
        (() => {
          const x = target();
          x.map = [];
          return x.offer('txt', text(10))[1] === 'refused';
        })() &&
        (() => {
          const x = target();
          x.map = { A: [[1, 'x']] };
          return x.offer('txt', text(10))[1] === 'refused';
        })()
    );
    w = target();
    w.give('txt', text(500));
    const kept = wire(w.map);
    const w2 = target();
    w2.map = kept;
    w2.c.t = w.c.t + 60000;
    check(
      'the allowance is what the store holds: a restart of the app starts no new day',
      w2.map.A.length === 1 &&
        (() => {
          for (let i = 0; i < DAY_FILES - 1; i++) {
            const f2 = w2.give('txt', text(10));
            w2.take([f2]);
          }
          return w2.offer('txt', text(10))[1] === 'refused';
        })()
    );
  }

  // ---- the target: pieces ----
  {
    const pic = jpg({ size: 118 * KB });
    let w = target(),
      [f] = w.offer('jpg', pic);
    w.feed(f, pic);
    const words = w.sent.map(x => x[1]);
    check(
      'a whole file in order: "more" after every 40th piece, "done" at the end, and it waits in memory',
      partsOf(pic.length) === 41 &&
        words.length === 2 &&
        words[0].state === 'more' &&
        words[0].i === 40 &&
        words[1].state === 'done' &&
        words[1].f === f &&
        w.taker.holding()[0].done === 1 &&
        !w.taker.holding()[0].open,
      words
    );
    const got = w.take([f]);
    check(
      'the prompt takes it out: the same bytes, its kind, once',
      got.length === 1 &&
        got[0].kind === 'jpg' &&
        sha(got[0].data) === sha(pic) &&
        w.take([f]) === null &&
        w.taker.holding()[0].done === 0
    );
    const lost = (name, mutate) => {
      const x = target(),
        [f2] = x.offer('jpg', pic),
        ps = piecesOf(f2, pic);
      mutate(x, f2, ps);
      const ws = x.sent.map(y => y[1].state);
      check(
        name,
        ws.at(-1) === 'failed' &&
          !ws.includes('done') &&
          x.taker.holding()[0].done === 0 &&
          !x.taker.holding()[0].open &&
          x.take([f2]) === null,
        ws
      );
      return x;
    };
    lost(
      'a piece lost: the next one is out of order, the file ends as failed and nothing is kept',
      (x, f2, ps) => {
        ps.forEach((p, i) => {
          if (i !== 5) x.taker.part('A', p);
        });
      }
    );
    lost('a piece late (two swapped): failed, nothing kept', (x, f2, ps) => {
      [ps[0], ps[2], ps[1], ...ps.slice(3)].forEach(p => x.taker.part('A', p));
    });
    lost('a piece sent twice: failed, nothing kept', (x, f2, ps) => {
      [ps[0], ps[1], ps[1], ...ps.slice(2)].forEach(p => x.taker.part('A', p));
    });
    lost('a piece of the wrong size in the middle: failed', (x, f2, ps) => {
      ps[3] = { ...ps[3], d: Buffer.alloc(PIECE - 3, 1).toString('base64') };
      ps.forEach(p => x.taker.part('A', p));
    });
    lost('a last piece that is too long for the offer: failed', (x, f2, ps) => {
      ps[ps.length - 1] = { ...ps.at(-1), d: Buffer.alloc(PIECE, 1).toString('base64') };
      ps.forEach(p => x.taker.part('A', p));
    });
    lost("bytes that do not make the offer's SHA-256: failed", (x, f2, ps) => {
      const b = Buffer.from(ps[2].d, 'base64');
      b[10] ^= 1;
      ps[2] = { ...ps[2], d: b.toString('base64') };
      ps.forEach(p => x.taker.part('A', p));
    });
    {
      const x = target(),
        bad = jpg({ size: 20 * KB, extra: [seg(0xe1, Buffer.from('Exif\0\0'))] }),
        [f2, word] = x.offer('jpg', bad);
      x.feed(f2, bad);
      check(
        'a file whose content is not what its kind allows is refused at its last piece, though its size and hash are right',
        word === 'go' &&
          x.last().state === 'failed' &&
          x.taker.holding()[0].done === 0 &&
          x.take([f2]) === null,
        x.last()
      );
    }
    {
      const x = target(),
        hidden = Buffer.from('Fix the page.' + ch(0xe0041), 'utf8'),
        [f2] = x.offer('txt', hidden);
      x.feed(f2, hidden);
      check(
        'review 18: a text with a tag character is refused on the target too',
        x.last().state === 'failed' && x.take([f2]) === null
      );
    }
    {
      const x = target(),
        [f2] = x.offer('jpg', pic),
        ps = piecesOf(f2, pic);
      x.taker.part('A', ps[0]);
      x.taker.part('A', { ...ps[1], f: fid() });
      x.taker.part('C', ps[1]);
      x.taker.part('A', { t: 'part', f: f2, i: 1, d: 'not base64!' });
      x.taker.part('A', null);
      check(
        'a piece of another file, from another computer, or of no shape is dropped before any work: nothing said, the open file goes on',
        x.sent.length === 0 && x.taker.holding().find(h => h.peer === 'A').open === true
      );
      ps.slice(1).forEach(p => x.taker.part('A', p));
      check('…and the file still finishes', x.last().state === 'done');
    }
    {
      const x = target();
      x.taker.part('A', piecesOf(fid(), pic)[0]);
      check(
        'a piece without an offer is dropped unanswered',
        x.sent.length === 0 && x.taker.holding().length === 0
      );
    }
    {
      const x = target(),
        [f2] = x.offer('jpg', pic),
        ps = piecesOf(f2, pic);
      ps.slice(0, 10).forEach(p => x.taker.part('A', p));
      x.c.go(GAP_MS - 1000);
      const before = x.sent.length;
      x.c.go(2000);
      check(
        '61 seconds without a piece end the file, and the sender is told once',
        before === 0 &&
          x.sent.length === 1 &&
          x.last().state === 'failed' &&
          !x.taker.holding()[0].open
      );
      x.taker.part('A', ps[10]);
      check('…a piece that comes after that is dropped', x.sent.length === 1);
    }
    {
      const x = target(),
        slow = jpg({ size: PICTURE_MAX }),
        [f2] = x.offer('jpg', slow),
        ps = piecesOf(f2, slow);
      let i = 0;
      while (i < ps.length - 1 && x.c.t - 1700000000000 < FILE_MS - 20000) {
        x.taker.part('A', ps[i++]);
        x.c.go(30000);
      }
      x.c.go(30000);
      ps.slice(i).forEach(p => x.taker.part('A', p));
      check(
        'review 18: a file that takes more than 5 minutes from its offer ends, however steadily its pieces come',
        !x.sent.some(y => y[1].state === 'done') &&
          x.sent.some(y => y[1].state === 'failed') &&
          x.take([f2]) === null,
        x.sent.map(y => y[1].state)
      );
    }
    {
      const x = target(),
        [f2] = x.offer('jpg', pic),
        ps = piecesOf(f2, pic);
      ps.slice(0, 5).forEach(p => x.taker.part('A', p));
      x.right = false;
      x.taker.part('A', ps[5]);
      check(
        'the right ended in the middle (the guard says no): the file is dropped and nothing is said',
        x.sent.length === 0 && !x.taker.holding()[0].open
      );
      x.right = true;
      ps.slice(6).forEach(p => x.taker.part('A', p));
      check('…and stays dropped', x.sent.length === 0 && x.take([f2]) === null);
    }
    {
      const x = target(),
        f2 = x.give('txt', text(900)),
        [f3] = x.offer('jpg', pic);
      piecesOf(f3, pic)
        .slice(0, 9)
        .forEach(p => x.taker.part('A', p));
      x.taker.dropAll('A');
      check(
        'review 18: a new session in the middle of a file (dropAll): the open file and the finished one are both gone, nothing is said',
        x.take([f2]) === null &&
          x.taker.holding().length === 0 &&
          x.sent.filter(y => y[1].state === 'failed').length === 0
      );
      piecesOf(f3, pic)
        .slice(9)
        .forEach(p => x.taker.part('A', p));
      check('…and the rest of its pieces are dropped', !x.sent.some(y => y[1].f === f3));
    }
    {
      const x = target(),
        f2 = x.give('txt', text(900));
      x.c.go(HELD_MS - 1000);
      const still = x.taker.holding()[0].done;
      x.c.go(2000);
      check(
        'a finished file waits 10 minutes for its prompt, then is dropped',
        still === 1 && x.taker.holding()[0].done === 0 && x.take([f2]) === null
      );
    }
  }

  // ---- the target: a prompt takes its files ----
  {
    const w = target(),
      a = text(700),
      b = jpg({ size: 30 * KB }),
      fa = w.give('txt', a),
      fb = w.give('jpg', b);
    check(
      "files of another computer, another pairing, another panel or another ticket are not this prompt's",
      w.take([fa], { peer: 'C' }) === null &&
        w.take([fa], { pairing: 'pair-9' }) === null &&
        w.take([fa], { panel: 'p2' }) === null &&
        w.take([fa], { ticket: 'b'.repeat(16) }) === null &&
        w.taker.holding()[0].done === 2
    );
    check(
      'all of them or none: one unknown id, a repeated id, no id, four ids',
      w.take([fa, fid()]) === null &&
        w.take([fa, fa]) === null &&
        w.take([]) === null &&
        w.take([fa, fb, fid(), fid()]) === null &&
        w.taker.holding()[0].done === 2
    );
    const got = w.take([fb, fa]);
    check(
      'in the order the prompt names them, each with its kind and bytes; then they are gone',
      got.length === 2 &&
        got[0].kind === 'jpg' &&
        sha(got[0].data) === sha(b) &&
        got[1].kind === 'txt' &&
        sha(got[1].data) === sha(a) &&
        w.take([fa]) === null &&
        w.take([fb]) === null
    );
    const [fc] = w.offer('txt', text(50));
    check('a file that is still on its way cannot be named', w.take([fc]) === null);
    w.taker.stop();
    check(
      'the app is closing: nothing is held and nothing more is taken',
      w.taker.holding().length === 0 && w.offer('txt', text(10))[1] === 'refused'
    );
  }

  // ---- the sender ----
  {
    const mk = (over = {}) => {
      const c = clock(),
        s = { c, sent: [], offers: [], prog: [], room: 10, up: true, offerState: 'asked', seed: 0 };
      s.sender = createSender({
        now: c.now,
        timers: c.timers,
        random: n => Buffer.alloc(n, ++s.seed),
        send: (to, obj) => {
          if (!s.up) return false;
          s.sent.push([to, obj, c.t]);
          return true;
        },
        room: () => s.room,
        offer: (peer, agent, fill, onWord) => {
          s.offers.push({ peer, agent, fill, onWord });
          return { state: s.offerState, n: 'n' };
        },
        on: { changed: p => s.prog.push(p) },
        ...over,
      });
      return s;
    };
    const pic = jpg({ size: 118 * KB }),
      note = text(4000);
    let s = mk(),
      result = null;
    s.sender
      .sendFiles('B', 'p1', [
        { kind: 'jpg', data: pic },
        { kind: 'txt', data: note },
      ])
      .then(r => {
        result = r;
      });
    const o1 = s.offers[0];
    check(
      'the offer names the file by an id of its own, its kind, size, pieces and SHA-256, and nothing of its name',
      s.offers.length === 1 &&
        o1.peer === 'B' &&
        o1.agent === 'p1' &&
        /^[0-9a-f]{16}$/.test(o1.fill.f) &&
        JSON.stringify(Object.keys(o1.fill).sort()) ===
          JSON.stringify(['bytes', 'f', 'kind', 'parts', 'sha']) &&
        o1.fill.bytes === pic.length &&
        o1.fill.parts === 41 &&
        o1.fill.sha === sha(pic),
      o1.fill
    );
    s.c.go(20000);
    check('no piece leaves before the other computer said "go"', s.sent.length === 0);
    check(
      'one job at a time: a second one is told "busy" and changes nothing',
      (await s.sender.sendFiles('B', 'p1', [{ kind: 'txt', data: note }])).why === 'busy' &&
        s.offers.length === 1
    );
    o1.onWord('go');
    const t0 = s.c.t;
    check(
      'after "go" the first piece leaves at once',
      s.sent.length === 1 &&
        s.sent[0][1].t === 'part' &&
        s.sent[0][1].f === o1.fill.f &&
        s.sent[0][1].i === 0 &&
        Buffer.from(s.sent[0][1].d, 'base64').equals(pic.subarray(0, PIECE))
    );
    s.c.go(15000);
    const afterTen = s.sent.length;
    s.room = 0;
    s.c.go(30000);
    const held = s.sent.length;
    s.room = 5;
    s.c.go(1500);
    check(
      'pieces leave one every 1.5 seconds, wait while the link has no room, and go on when it has',
      afterTen === 11 && held === 11 && s.sent.length === 12,
      [afterTen, held, s.sent.length]
    );

    // not further: 30 seconds after the last piece the wait for "done" ends
    for (let i = 0; i < 100 && s.sent.length < 41; i++) s.c.go(1500);
    const times = s.sent.map(x => x[2]),
      worst = Math.max(...times.map(t => times.filter(u => u >= t && u < t + 60000).length));
    check(
      'never more than 40 pieces in any minute, and every piece of the file in order, each once',
      worst <= 40 &&
        s.sent.length === 41 &&
        s.sent.every((x, i) => x[1].i === i) &&
        sha(Buffer.concat(s.sent.map(x => Buffer.from(x[1].d, 'base64')))) === sha(pic),
      [worst, s.sent.length]
    );
    check(
      'the second file is not offered before the first is done there',
      s.offers.length === 1 && result === null
    );
    s.sender.receive('C', { t: 'got', f: o1.fill.f, i: 41, state: 'done' });
    s.sender.receive('B', { t: 'got', f: fid(), i: 41, state: 'done' });
    s.sender.receive('B', { t: 'got', f: o1.fill.f, i: 40, state: 'more' });
    check(
      'a word from another computer, for another file, or "more" moves nothing',
      s.offers.length === 1
    );
    s.sender.receive('B', { t: 'got', f: o1.fill.f, i: 41, state: 'done' });
    check(
      '"done" for the file on its way: the next file is offered',
      s.offers.length === 2 && s.offers[1].fill.kind === 'txt' && s.offers[1].fill.f !== o1.fill.f
    );
    s.offers[1].onWord('go');
    s.c.go(5000);
    s.sender.receive('B', { t: 'got', f: s.offers[1].fill.f, i: 2, state: 'done' });
    await null;
    await null;
    check(
      'every file finished: the ids come back in order, for the prompt to name',
      result &&
        result.ok === true &&
        JSON.stringify(result.ids) === JSON.stringify([o1.fill.f, s.offers[1].fill.f]) &&
        s.sender.sending() === false &&
        s.prog.at(-1) === null &&
        s.prog.some(p => p && p.file === 2 && p.files === 2),
      result
    );
    const ends = async (name, why, run) => {
      const x = mk();
      let r = null;
      x.sender
        .sendFiles('B', 'p1', [
          { kind: 'jpg', data: pic },
          { kind: 'txt', data: note },
        ])
        .then(v => {
          r = v;
        });
      await run(x);
      await null;
      await null;
      check(
        name,
        r &&
          r.ok === false &&
          r.why === why &&
          x.sender.sending() === false &&
          x.offers.length === 1,
        r
      );
      return x;
    };
    await ends(
      'an offer that is refused ends it: nothing is sent, the second file is never offered',
      'refused',
      x => {
        x.offers[0].onWord('refused');
        x.c.go(60000);
      }
    );
    await ends(
      'an offer that gets no reply (an older app on the other side) ends it',
      'no_reply',
      x => {
        x.offers[0].onWord('no_reply');
      }
    );
    await ends('…also when no word comes at all', 'no_reply', x => {
      x.c.go(31000);
    });
    await ends(
      'the target says "failed" in the middle: ended once, no more pieces',
      'failed',
      async x => {
        x.offers[0].onWord('go');
        x.c.go(6000);
        x.sender.receive('B', { t: 'got', f: x.offers[0].fill.f, i: 3, state: 'failed' });
        const n = x.sent.length;
        x.c.go(60000);
        check('…no piece after it', x.sent.length === n);
      }
    );
    await ends(
      'the session is lost in the middle (the link sends nothing): ended, nothing queued or resumed',
      'not_sent',
      x => {
        x.offers[0].onWord('go');
        x.c.go(3000);
        x.up = false;
        x.c.go(3000);
        x.up = true;
        const n = x.sent.length;
        x.c.go(60000);
        check('…and nothing is sent when the link is back', x.sent.length === n);
      }
    );
    await ends('every piece sent and no "done" within 30 seconds: ended', 'no_reply', x => {
      x.offers[0].onWord('go');
      x.c.go(200000);
    });
    await ends('stopped by the user, or by a session that ended: ended', 'stopped', x => {
      x.offers[0].onWord('go');
      x.c.go(3000);
      x.sender.stop('B');
    });
    {
      const x = mk();
      let r = null;
      x.sender.sendFiles('B', 'p1', [{ kind: 'txt', data: note }]).then(v => {
        r = v;
      });
      x.sender.stop('C');
      await null;
      check(
        'a session that ended with another computer stops nothing',
        r === null && x.sender.sending() === true
      );
      x.sender.stop();
    }
    {
      const x = mk();
      x.offerState = 'not_sent';
      const r = await x.sender.sendFiles('B', 'p1', [{ kind: 'txt', data: note }]);
      check(
        'an offer that could not leave (no session, no right there): ended at once',
        r.ok === false && r.why === 'not_sent' && x.sent.length === 0
      );
    }
    {
      const x = mk();
      x.sender.sendFiles('B', 'p1', [{ kind: 'txt', data: note }]);
      x.offers[0].onWord('go');
      const n = x.sent.length;
      x.offers[0].onWord('go');
      x.offers[0].onWord('refused');
      check('a word on an offer is taken once', x.sent.length === n && x.sender.sending() === true);
      x.sender.stop();
    }
  }

  // ---- both ends joined in memory ----
  {
    const c = clock(),
      toB = [],
      toA = [],
      map = {};
    let room = 10,
      result = null;
    const taker = createTaker({
      now: c.now,
      timers: c.timers,
      send: (to, obj) => {
        toA.push(obj);
        return true;
      },
      allowance: {
        read: () => wire(map),
        write: m => {
          Object.assign(map, wire(m));
        },
      },
    });
    const sender = createSender({
      now: c.now,
      timers: c.timers,
      send: (to, obj) => {
        toB.push(obj);
        return true;
      },
      room: () => room,
      offer: (peer, agent, fill, onWord) => {
        const word = taker.offer({
          peerId: 'A',
          pairing: 'pair-1',
          panelId: agent,
          ticket: 'a'.repeat(16),
          guard: () => true,
          msg: wire(fill),
        });
        c.timers.set(() => onWord(word), 50);
        return { state: 'asked', n: 'n' };
      },
    });
    const pump = ms => {
      for (let t = 0; t < ms; t += 250) {
        c.go(250);
        while (toB.length) taker.part('A', wire(toB.shift()));
        while (toA.length) sender.receive('B', wire(toA.shift()));
      }
    };
    const pic = jpg({ size: 118 * KB }),
      note = Buffer.from('# Notes\r\nRun the tests.\n', 'utf8');
    sender
      .sendFiles('B', 'p1', [
        { kind: 'jpg', data: pic },
        { kind: 'txt', data: note },
      ])
      .then(r => {
        result = r;
      });
    const t0 = c.t;
    pump(90000);
    await null;
    await null;
    const got =
      result && result.ok
        ? taker.take({
            peerId: 'A',
            pairing: 'pair-1',
            panelId: 'p1',
            ticket: 'a'.repeat(16),
            ids: result.ids,
          })
        : null;
    check(
      'a picture of 118 KB and a text cross, piece by piece, and arrive with the same bytes',
      !!got &&
        got.length === 2 &&
        got[0].kind === 'jpg' &&
        sha(got[0].data) === sha(pic) &&
        got[1].kind === 'txt' &&
        got[1].data.equals(note),
      result
    );
    check(
      'the 118 KB picture is 41 pieces and takes about a minute',
      partsOf(pic.length) === 41 && c.t - t0 <= 90000
    );
  }

  // ---- the two operations in the real remote-control.js ----
  {
    const P1 = 'terminal-1759999999999-ab12',
      P2 = 'terminal-1759999999999-cd34';
    const mk = () => {
      const c = clock(),
        w = {
          c,
          sent: [],
          logs: [],
          prompts: [],
          saved: [],
          undone: [],
          rights: { A: 'pair-1' },
          live: { A: true },
          say: 'sent',
          saveFails: false,
          nn: 0,
          map: {},
          agents: {
            [P1]: {
              name: 'Moss',
              cli: 'Claude Code',
              mode: 'run',
              running: true,
              hand: false,
              instance: 'conv-1',
              pid: 4242,
              startedAt: 1699999990000,
            },
            [P2]: {
              name: 'Kite',
              cli: 'Claude Code',
              mode: 'run',
              running: true,
              hand: false,
              instance: 'conv-2',
              pid: 4343,
              startedAt: 1699999990000,
            },
          },
        };
      w.taker = createTaker({
        now: c.now,
        timers: c.timers,
        send: (to, obj) => {
          w.sent.push([to, obj]);
          return true;
        },
        allowance: {
          read: () => wire(w.map),
          write: m => {
            w.map = wire(m);
          },
        },
      });
      w.control = createControl({
        now: c.now,
        timers: c.timers,
        rights: id => w.rights[id] || '',
        live: id => w.live[id] === true,
        peerName: () => 'Desk',
        agentNow: id => w.agents[id] || null,
        send: (to, obj) => {
          w.sent.push([to, obj]);
          return true;
        },
        log: e => w.logs.push(e),
        prompt: o => {
          w.prompts.push(o);
          return w.say;
        },
        files: {
          offer: o => w.taker.offer(o),
          take: o => w.taker.take(o),
          save: list => {
            if (w.saveFails) return null;
            const names = list.map((f, i) => ({
              name: 'made-here-' + (w.saved.length + i) + '.' + f.kind,
              kind: f.kind,
              bytes: f.data.length,
            }));
            w.saved.push(...list);
            return {
              tail: names.map(n => ' [Attached file: C:\\att\\' + n.name + ']').join(''),
              files: names,
              undo: () => {
                w.undone.push(names.map(n => n.name));
              },
            };
          },
        },
      });
      w.op = (t, more) => ({
        t,
        n: (++w.nn).toString(16).padStart(16, '0'),
        c: w.control.stamp('A'),
        ms: 0,
        id: P1,
        to: w.control.ticketFor('A', P1),
        ...more,
      });
      w.offer = (kind, data, more = {}) => {
        const f = fid(),
          m = w.op('file', {
            f,
            kind,
            bytes: data.length,
            parts: partsOf(data.length),
            sha: sha(data),
            ...more,
          });
        return [f, w.control.receive('A', shapeOp(wire(m)) || { t: m.t, n: m.n }), m];
      };
      w.give = (kind, data) => {
        const [f, r] = w.offer(kind, data);
        for (const p of piecesOf(f, data)) w.taker.part('A', wire(p));
        return [f, r];
      };
      w.reply = () => w.sent.filter(x => x[1].t === 'filed' || x[1].t === 'prompted').at(-1)?.[1];
      return w;
    };
    let w = mk();
    const pic = jpg({ size: 40 * KB }),
      note = text(900);
    let [f1, r1, m1] = w.offer('jpg', pic);
    check(
      'an offer with the right ticket is taken: "filed" go, and a line in this computer\'s list that says what is coming and how big',
      r1.taken === true &&
        r1.state === 'go' &&
        JSON.stringify(w.reply()) ===
          JSON.stringify({ t: 'filed', n: m1.n, ok: true, state: 'go' }) &&
        w.logs.length === 1 &&
        w.logs[0].op === 'file' &&
        w.logs[0].agent === 'Moss' &&
        w.logs[0].from === 'Desk' &&
        /^a picture, 40 KB$/.test(w.logs[0].head),
      [r1, w.reply(), w.logs]
    );
    check(
      'the same offer again (its one-time number was taken) is refused',
      w.control.receive('A', shapeOp(wire(m1))).refused === true && w.reply().state === 'refused'
    );
    w = mk();
    check(
      'an offer with a wrong ticket, for a panel that runs nothing, or of the wrong form is refused and nothing is reserved or logged',
      w.offer('jpg', pic, { to: 'f'.repeat(16) })[1].refused === true &&
        w.offer('jpg', pic, { id: 'terminal-none' })[1].refused === true &&
        w.offer('jpg', pic, { kind: 'exe' })[1].refused === true &&
        (w.c.go(61000),
        w.offer('jpg', pic, { bytes: PICTURE_MAX + 1, parts: partsOf(PICTURE_MAX + 1) })[1]
          .refused ===
          true) /* a minute on: three offers a minute are counted before anything is looked at */ &&
        !w.map.A &&
        w.logs.length === 0 &&
        w.reply().state === 'refused'
    );
    w = mk();
    w.rights = {};
    check(
      'the switch off: silence, nothing looked at',
      w.control.receive('A', { t: 'file', n: 'a'.repeat(16) }).silent === 'off' &&
        w.sent.length === 0 &&
        w.logs.length === 0
    );
    w = mk();
    {
      const rs = [0, 1, 2, 3].map(() => {
        const r = w.give('txt', text(100))[1];
        return r;
      });
      check(
        'three offers a minute from one computer; the fourth gets silence, not a refusal',
        rs.slice(0, 3).every(r => r.taken === true) &&
          rs[3].silent === 'limit' &&
          w.sent.filter(x => x[1].t === 'filed').length === 3,
        rs
      );
    }

    // A prompt that names its files.
    w = mk();
    const [fa] = w.give('jpg', pic),
      [fb] = w.give('txt', note);
    const pm = w.op('promptf', { text: 'Look at these', files: [fa, fb] }),
      pr = await w.control.receive('A', shapeOp(wire(pm)));
    const d = w.prompts[0],
      entry = w.logs.find(e => e.op === 'prompt');
    check(
      "a prompt that names two finished files is taken: they are saved (their kinds and bytes, nothing else), the delivery gets this computer's own tail beside the words",
      pr.taken === true &&
        pr.state === 'sent' &&
        w.saved.length === 2 &&
        w.saved[0].kind === 'jpg' &&
        sha(w.saved[0].data) === sha(pic) &&
        w.saved[1].kind === 'txt' &&
        JSON.stringify(Object.keys(w.saved[0]).sort()) === JSON.stringify(['data', 'kind']) &&
        d.text === 'Look at these' &&
        d.tail ===
          ' [Attached file: C:\\att\\made-here-0.jpg] [Attached file: C:\\att\\made-here-1.txt]' &&
        w.reply().t === 'prompted' &&
        w.reply().state === 'sent',
      [pr, d && d.tail]
    );
    check(
      "the list's line for that prompt names each file by the name made here, with its kind and size",
      entry &&
        JSON.stringify(entry.files) ===
          JSON.stringify([
            { name: 'made-here-0.jpg', kind: 'jpg', bytes: pic.length },
            { name: 'made-here-1.txt', kind: 'txt', bytes: note.length },
          ]) &&
        entry.head === 'Look at these' &&
        w.undone.length === 0,
      entry
    );
    check(
      'a plain prompt still has no files in its line and an empty tail',
      await (async () => {
        const m = w.op('prompt', { text: 'Plain one' });
        await w.control.receive('A', shapeOp(wire(m)));
        const e = w.logs.at(-1);
        return e.op === 'prompt' && e.files === undefined && w.prompts.at(-1).tail === '';
      })()
    );
    check(
      'the files were used once: a second prompt that names them is refused and nothing more is saved',
      await (async () => {
        const m = w.op('promptf', { text: 'Again', files: [fa] });
        const r = await w.control.receive('A', shapeOp(wire(m)));
        return r.refused === true && w.saved.length === 2;
      })()
    );

    // The word-first rule, the wrong panel, a file that is not finished.
    w = mk();
    const [fc] = w.give('txt', note);
    const tryP = async more => {
      const m = w.op('promptf', { text: 'Read this', files: [fc], ...more });
      return w.control.receive('A', shapeOp(wire(m)) || { t: m.t, n: m.n });
    };
    check(
      'a prompt with files that starts with "!" or "/" is refused as ever, and its file stays unwritten',
      (await tryP({ text: '!rm -rf x' })).refused === true &&
        (await tryP({ text: '/clear' })).refused === true &&
        w.saved.length === 0 &&
        w.prompts.length === 0
    );
    check(
      'a prompt for another panel than the file was offered for is refused; nothing written',
      (await tryP({ id: P2, to: w.control.ticketFor('A', P2) })).refused === true &&
        w.saved.length === 0
    );
    check(
      'a prompt that names an unknown file beside a finished one is refused; nothing written',
      (await tryP({ files: [fc, fid()] })).refused === true && w.saved.length === 0
    );
    check(
      '…and the finished file is still there for the right prompt',
      (await tryP({})).taken === true && w.saved.length === 1
    );

    // What does not go in takes its files with it.
    w = mk();
    w.say = 'failed';
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      const r = await w.control.receive('A', shapeOp(wire(m)));
      check(
        'a prompt whose delivery fails: its saved files are removed again (undo), and the other computer reads "failed"',
        r.state === 'failed' &&
          w.saved.length === 1 &&
          w.undone.length === 1 &&
          w.reply().state === 'failed',
        [r, w.undone]
      );
    }
    w = mk();
    w.say = 'refused';
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      const r = await w.control.receive('A', shapeOp(wire(m)));
      check('…and one the delivery refuses', r.state === 'refused' && w.undone.length === 1);
    }
    w = mk();
    w.saveFails = true;
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      const r = await w.control.receive('A', shapeOp(wire(m)));
      check(
        'files that cannot be written: the prompt does not go in without them ("failed"), and it is still in the list',
        r.state === 'failed' &&
          w.prompts.length === 0 &&
          w.logs.some(e => e.op === 'prompt') &&
          w.reply().state === 'failed',
        r
      );
    }
    w = mk();
    w.say = 'queued';
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      const r = await w.control.receive('A', shapeOp(wire(m)));
      const kept = w.undone.length;
      w.control.dropAll('A');
      check(
        'a prompt that is held keeps its files; removed from the held list (the right ended), they go',
        r.state === 'queued' && kept === 0 && w.undone.length === 1,
        [r, kept, w.undone]
      );
    }
    w = mk();
    w.say = 'queued';
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      await w.control.receive('A', shapeOp(wire(m)));
      w.prompts[0].done('sent');
      check(
        'a held prompt that is then written keeps its files',
        w.undone.length === 0 && w.reply().state === 'sent'
      );
    }
    w = mk();
    w.say = 'queued';
    {
      const [fx] = w.give('txt', note);
      const m = w.op('promptf', { text: 'Read this', files: [fx] });
      await w.control.receive('A', shapeOp(wire(m)));
      w.control.stop();
      check('the app closes with a prompt still held: its files go', w.undone.length === 1);
    }
    w = mk();
    {
      const [fx] = w.give('txt', note);
      let n = 0;
      for (let i = 0; i < 10; i++) {
        const m = w.op('prompt', { text: 'Plain ' + i });
        const r = await w.control.receive('A', shapeOp(wire(m)));
        if (r.taken) n++;
      }
      const m = w.op('promptf', { text: 'Read this', files: [fx] }),
        r = w.control.receive('A', shapeOp(wire(m)));
      check(
        "a prompt with files shares the prompts' ten a minute: the eleventh gets silence and its file stays unwritten",
        n === 10 && r.silent === 'limit' && w.saved.length === 0,
        [n, r]
      );
    }
    w = mk();
    {
      const [fx, r0] = w.offer('jpg', pic),
        ps = piecesOf(fx, pic);
      ps.slice(0, 4).forEach(p => w.taker.part('A', wire(p)));
      w.agents[P1] = { ...w.agents[P1], pid: 9999 };
      w.taker.part('A', wire(ps[4]));
      check(
        'the agent the file was offered for is gone (another process in its panel): the next piece ends the file, unanswered',
        r0.taken === true && !w.taker.holding()[0].open && !w.sent.some(x => x[1].t === 'got')
      );
    }
    w = mk();
    {
      const [fx] = w.offer('jpg', pic),
        ps = piecesOf(fx, pic);
      ps.slice(0, 4).forEach(p => w.taker.part('A', wire(p)));
      w.rights = {};
      w.taker.part('A', wire(ps[4]));
      check(
        'the switch went off in the middle: the same',
        !w.taker.holding()[0].open && !w.sent.some(x => x[1].t === 'got')
      );
    }
    w = mk();
    {
      const [fx] = w.offer('jpg', pic),
        ps = piecesOf(fx, pic);
      ps.slice(0, 4).forEach(p => w.taker.part('A', wire(p)));
      w.live = {};
      w.taker.part('A', wire(ps[4]));
      check('the session ended in the middle: the same', !w.taker.holding()[0].open);
    }
  }

  // ---- names made on the target: the real attachment-service.js, Electron stubbed, a temp folder
  // ----
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-remote-files-')),
      shown = [],
      realLoad = Module._load;
    Module._load = function (req, ...rest) {
      return req === 'electron'
        ? {
            app: { getPath: () => tmp, on: () => {}, whenReady: () => new Promise(() => {}) },
            clipboard: { readText: async () => '', readBuffer: async () => Buffer.alloc(0) },
            nativeImage: {},
            shell: { showItemInFolder: f => shown.push(f) },
          }
        : realLoad.call(this, req, ...rest);
    };
    let att;
    try {
      att = require('../desktop/attachment-service.js');
    } finally {
      Module._load = realLoad;
    }
    const dir = att.dir(),
      pic = jpg({ size: 20 * KB }),
      NAME = /^[0-9a-f]{8}-from-another-computer\.(png|jpg|txt)$/;
    const a = att.saveRemote('jpg', pic),
      b = att.saveRemote('txt', text(300)),
      c2 = att.saveRemote('png', png({ size: 5 * KB }));
    check(
      'a file is saved in the attachments folder, in a day folder, under a name made here: eight random hex characters, fixed words, the extension of its kind',
      [a, b, c2].every(
        x =>
          NAME.test(x.name) &&
          path.basename(x.path) === x.name &&
          path.dirname(path.dirname(x.path)) === dir &&
          /^\d{4}-\d\d-\d\d$/.test(path.basename(path.dirname(x.path))) &&
          fs.existsSync(x.path)
      ) &&
        a.name.endsWith('.jpg') &&
        b.name.endsWith('.txt') &&
        c2.name.endsWith('.png') &&
        new Set([a.name, b.name, c2.name]).size === 3 &&
        fs.readFileSync(a.path).equals(pic),
      [a, b, c2]
    );
    const bad = kind => {
      try {
        att.saveRemote(kind, pic);
        return false;
      } catch {
        return true;
      }
    };
    check(
      'a kind that is not one of the three words writes nothing: no extension, path or name can come in through it',
      [
        'exe',
        '../x',
        'jpg/../../x',
        'JPG',
        '',
        null,
        'constructor',
        '__proto__',
        'png\\..\\x',
      ].every(bad) &&
        (() => {
          try {
            att.saveRemote('jpg', 'text');
            return false;
          } catch {
            return true;
          }
        })() &&
        (() => {
          try {
            att.saveRemote('jpg', Buffer.alloc(0));
            return false;
          } catch {
            return true;
          }
        })() &&
        (() => {
          try {
            att.saveRemote('jpg', Buffer.alloc(150 * KB + 1));
            return false;
          } catch {
            return true;
          }
        })() &&
        fs.readdirSync(path.dirname(a.path)).length === 3 &&
        fs.readdirSync(dir).length === 1 &&
        fs.readdirSync(tmp).length === 1
    );
    const own = path.join(path.dirname(a.path), 'abcd1234-notes.txt');
    fs.writeFileSync(own, "the user's own attachment");
    check(
      'removing takes only a file of that form in a day folder of the attachments folder',
      att.removeRemote(own) === false &&
        fs.existsSync(own) &&
        att.removeRemote(path.join(tmp, 'x', a.name)) === false &&
        att.removeRemote(path.join(dir, a.name)) === false &&
        att.removeRemote(a.path + '\\..\\abcd1234-notes.txt') === false &&
        att.removeRemote(null) === false &&
        att.removeRemote(b.path) === true &&
        !fs.existsSync(b.path) &&
        fs.existsSync(a.path)
    );
    check(
      '"Show in folder" goes by that name alone: a path, another file\'s name or a name that is gone shows nothing',
      att.showRemote(a.name) === true &&
        shown.length === 1 &&
        shown[0] === a.path &&
        att.showRemote(a.path) === false &&
        att.showRemote('..\\' + a.name) === false &&
        att.showRemote('abcd1234-notes.txt') === false &&
        att.showRemote(b.name) === false &&
        att.showRemote('') === false &&
        shown.length === 1,
      shown
    );

    // Seven days for a file from another computer, thirty for the user's own.
    const days = n => new Date(Date.now() - n * 86400000);
    fs.utimesSync(a.path, days(8), days(8));
    fs.utimesSync(c2.path, days(6), days(6));
    fs.utimesSync(own, days(8), days(8));
    await att.prune();
    check(
      "pruning: a file from another computer goes after 7 days, a newer one stays, and the user's own of the same age stays",
      !fs.existsSync(a.path) && fs.existsSync(c2.path) && fs.existsSync(own)
    );
    fs.utimesSync(own, days(31), days(31));
    await att.prune();
    check("…the user's own still goes after 30", !fs.existsSync(own));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* temp */
    }
  }

  // ---- the tail reaches the delivery beside the words (the real remote-actions.js) ----
  {
    const { createRemoteActions } = require('../desktop/remote-actions.js'),
      calls = [];
    const actions = createRemoteActions({
      ptys: { list: () => [] },
      mesh: {},
      lifecycle: {},
      turns: {},
      attention: {},
      submit: async (...a) => {
        calls.push(a);
        return { ok: true, state: 'sent' };
      },
      locked: () => null,
      abort: async () => null,
      panelKey: async () => '',
    });
    await actions.prompt({
      key: 'k1',
      panelId: 'p1',
      text: 'Look at this',
      from: 'Desk (…a-1)',
      guard: () => true,
      done: () => {},
      tail: ' [Attached image: C:\\att\\x.jpg]',
    });
    await actions.prompt({
      key: 'k2',
      panelId: 'p1',
      text: 'Plain',
      from: 'Desk (…a-1)',
      guard: () => true,
      done: () => {},
      tail: '',
    });
    check(
      "the words go in as sent, the tail beside them (never glued on here), as the sender's mark does",
      calls[0][1] === 'Look at this' &&
        calls[0][2].remote.tail === ' [Attached image: C:\\att\\x.jpg]' &&
        typeof calls[0][2].remote.mark === 'string' &&
        calls[0][2].paste === true &&
        calls[1][1] === 'Plain' &&
        !('tail' in calls[1][2].remote),
      calls.map(c => [c[1], c[2].remote.tail])
    );
    const submitSrc = fs.readFileSync(
      path.join(__dirname, '..', 'desktop', 'prompt-submit.js'),
      'utf8'
    );
    check(
      'prompt-submit.js checks the word-first rule on the words alone and adds the tail only where it writes; a held prompt keeps it apart',
      /WORD_FIRST\.test\(body\)/.test(submitSrc) &&
        /out = lead \+ body \+ tail/.test(submitSrc) &&
        /holdRemote\([^;]*?\bmark: lead,\s*tail,/.test(submitSrc)
    );
  }

  // ---- the gate: pieces leave as a stream, the target's words as replies, the two operations only
  // after the link admits them ----
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'remote-service.js'), 'utf8');
    check(
      "wiring: the target's side sends through the gate as a reply",
      // `[^;]*?` keeps the search inside the one call (its statement), however it is laid out
      /createTaker\(\{[^;]*?\bsend: \(to, obj\) => gateSend\(to, obj, 'reply'\)/.test(src)
    );
    check(
      "wiring: the sender's pieces go through the gate as a stream, and only while the link is below the line optional traffic stops at",
      /createSender\(\{[^;]*?\bsend: \(to, obj\) => gateSend\(to, obj, 'stream'\)[^;]*?\broom: \(\) => STREAM_MAX - lastMinute\(\)/.test(
        src
      )
    );
    check(
      'wiring: an offer and a prompt with files are operations (taken only after admit), and "filed" counts as a reply',
      /const OPS = new Set\(\[[^\]]*'file'[^\]]*'promptf'[^\]]*\]\)/.test(src) &&
        /const REPLIES = new Set\(\[[^\]]*'filed'[^\]]*\]\)/.test(src) &&
        /if \(\s*controlOn\(from\)[^;]*?\badmit\(from,[^;]*?\bcontrol\.receive\(from, shapeOp\(obj\)/.test(
          src
        )
    );
    check(
      'wiring: a piece is looked at only for a computer whose full-control switch is on; a session that ends or is replaced drops files on both sides',
      /obj\.t === 'part'\)\s*\{\s*try\s*\{\s*if \(taker && controlOn\(from\)\) taker\.part\(from, obj\)/.test(
        src
      ) &&
        /session: id => \{\s*if \(taker\) taker\.dropAll\(id\);\s*if \(sender\) sender\.stop\(id\);/.test(
          src
        ) &&
        /if \(!s\.session\) \{\s*if \(taker\) taker\.dropAll\(id\);\s*if \(sender\) sender\.stop\(id\);/.test(
          src
        )
    );

    // Window run 1 (2026-10-10): Chromium's canvas writes a JPEG with a color profile (an APP2
    // segment), which the strict walk rightly refuses, so every picture was refused on the sender.
    // The sender now makes its own JPEG plain before the check (plainJpeg in
    // src/scripts/27-composer-attachments.js, the page's code, run here as it is); the walk on both
    // computers is unchanged.
    {
      const page = fs.readFileSync(
          path.join(__dirname, '..', 'src', 'scripts', '27-composer-attachments.js'),
          'utf8'
        ),
        from = page.indexOf('function plainJpeg(b) {'),
        to = page.indexOf('} // end plainJpeg');
      const plainJpeg =
        from >= 0 && to > from
          ? new Function(page.slice(from, to + 1) + '\nreturn plainJpeg;')()
          : null;
      check(
        'the page has the function that makes its own JPEG plain, and uses it on what the canvas wrote before anything is handed over',
        typeof plainJpeg === 'function' &&
          /plain = plainJpeg\(new Uint8Array\(raw\)\);\s*item\.far = \{\s*kind: 'jpg',\s*bytes: plain \? plain\.buffer : raw,?\s*\}/.test(
            page
          )
      );
      if (plainJpeg) {
        const icc = seg(
            0xe2,
            Buffer.concat([Buffer.from('ICC_PROFILE\0\x01\x01', 'latin1'), Buffer.alloc(400, 9)])
          ),
          asCanvas = jpg({ size: 30 * KB, extra: [icc] }),
          same = jpg({ size: 30 * KB - icc.length });
        const made = Buffer.from(plainJpeg(asCanvas));
        check(
          'window run 1: a JPEG as the canvas writes it (an APP2 color profile after APP0) is refused by the strict walk as it is, and taken once the sender made it plain',
          checkFile('jpg', asCanvas) === 'not_plain' &&
            checkFile('jpg', made) === '' &&
            made.length === asCanvas.length - icc.length,
          [checkFile('jpg', asCanvas), checkFile('jpg', made)]
        );
        check(
          '…only the profile is gone: every other byte is the same, in the same order (nothing is decoded or re-encoded)',
          made.equals(same)
        );
        const busy = jpg({
          size: 20 * KB,
          extra: [
            seg(0xe1, Buffer.from('Exif\0\0MM')),
            seg(0xe2, Buffer.alloc(50, 1)),
            seg(0xed, Buffer.alloc(20, 2)),
            seg(0xfe, Buffer.from('a comment')),
            seg(0xee, Buffer.from('Adobe')),
          ],
          after: Buffer.from('bytes after the end'),
        });
        const madeBusy = Buffer.from(plainJpeg(busy));
        check(
          'every other APPn, a comment and anything after the end are dropped too; what is left is what the review allows',
          checkFile('jpg', busy) !== '' &&
            checkFile('jpg', madeBusy) === '' &&
            !madeBusy.includes(Buffer.from('Exif')) &&
            !madeBusy.includes(Buffer.from('a comment')) &&
            !madeBusy.includes(Buffer.from('Adobe')) &&
            !madeBusy.includes(Buffer.from('bytes after'))
        );
        const clean = jpg({ size: 12 * KB }),
          prog = jpg({ size: 12 * KB, frame: 0xc2 });
        check(
          'a JPEG that is already plain comes back byte for byte, baseline or progressive, and doing it twice changes nothing',
          Buffer.from(plainJpeg(clean)).equals(clean) &&
            Buffer.from(plainJpeg(prog)).equals(prog) &&
            Buffer.from(plainJpeg(made)).equals(made)
        );
        check(
          'it drops, it never repairs: another kind of frame header, a file cut short, a PNG or a text come back as nothing (and are then refused as they are)',
          plainJpeg(jpg({ size: 9 * KB, frame: 0xc1 })) === null &&
            plainJpeg(jpg({ size: 9 * KB, extra: [seg(0xc8, Buffer.alloc(4))] })) === null &&
            plainJpeg(asCanvas.subarray(0, 5000)) === null &&
            plainJpeg(jpg({ size: 9 * KB, end: false })) === null &&
            plainJpeg(png({ size: 9 * KB })) === null &&
            plainJpeg(text(500)) === null &&
            plainJpeg(Buffer.alloc(0)) === null &&
            plainJpeg(null) === null
        );
        check(
          'what it makes is still held to every other rule: a side past 2,048 or two frame headers stay refused',
          checkFile('jpg', Buffer.from(plainJpeg(jpg({ size: 9 * KB, w: 4096, extra: [icc] })))) ===
            'too_wide' &&
            checkFile(
              'jpg',
              Buffer.from(plainJpeg(jpg({ size: 9 * KB, frames: 2, extra: [icc] })))
            ) !== ''
        );
        check(
          "the target's walk is as strict as before: a JPEG with a color profile that reaches it is refused there",
          checkFile('jpg', asCanvas) !== '' &&
            (() => {
              const x = target(),
                [f2, word] = x.offer('jpg', asCanvas);
              x.feed(f2, asCanvas);
              return word === 'go' && x.last().state === 'failed' && x.take([f2]) === null;
            })()
        );
      }
    }

    check(
      "review 20, 2.3: another account signing in clears the day's allowance of files with the watching minutes (the same account-change block, the same store)",
      /store\.setNote\('views', \{\}\);\s*store\.setNote\('files', \{\}\);/.test(src) &&
        src.indexOf("store.setNote('files', {})") > src.indexOf('accountChanged(signedIn') &&
        /allowance: \{\s*read: \(\) => store\.note\('files'\) \|\| \{\},\s*write: map => store\.setNote\('files', map\),?\s*\}/.test(
          src
        )
    );
    {
      // No character that cannot be seen is written as itself in this piece's code: a tool that
      // rewrites a line can lose it silently.
      const odd = c => {
        const n = c.codePointAt(0);
        return (
          (n < 32 && n !== 9 && n !== 10 && n !== 13) ||
          n === 127 ||
          (n >= 0x80 && n <= 0x9f) ||
          n === 0xad ||
          (n >= 0x200b && n <= 0x200f) ||
          (n >= 0x202a && n <= 0x202e) ||
          (n >= 0x2060 && n <= 0x2069) ||
          n === 0xfeff ||
          (n >= 0xe0000 && n <= 0xe007f)
        );
      };
      const found = [
        'desktop/remote-files.js',
        'src/scripts/27-composer-attachments.js',
        'desktop/thread-list.js',
        'src/scripts/117-past-conversations.js',
        'tools/remote-files-test.js',
        'tools/thread-list-test.js',
      ].flatMap(rel =>
        fs
          .readFileSync(path.join(__dirname, '..', rel), 'utf8')
          .split('\n')
          .flatMap((l, i) =>
            [...l].filter(odd).map(c => rel + ':' + (i + 1) + ' U+' + c.codePointAt(0).toString(16))
          )
      );
      check(
        'review 20, 2.2: the two zero-width joiners the text rule lets through, and every other invisible character these files name, are written as escapes, never as the characters',
        found.length === 0,
        found.slice(0, 6)
      );
      const rule = fs.readFileSync(
          path.join(__dirname, '..', 'desktop', 'remote-files.js'),
          'utf8'
        ),
        page = fs.readFileSync(
          path.join(__dirname, '..', 'src', 'scripts', '27-composer-attachments.js'),
          'utf8'
        ),
        want = '(?![' + '\\' + 'u200c' + '\\' + 'u200d])' + '\\' + 'p{Cf}';
      check(
        'review 20, 2.2: …and the rule reads the same in the main process and in the page',
        rule.includes(want) &&
          page.includes(want) &&
          checkFile('txt', Buffer.from('a' + ch(0x200d) + 'b' + ch(0x200c) + 'c', 'utf8')) === '' &&
          checkFile('txt', Buffer.from('a' + ch(0x200b) + 'b', 'utf8')) === 'hidden'
      );
    }
    check(
      'what this adds to a minute, by the numbers in the file: 40 pieces from the sender; from the target a word every 40 pieces and one per file',
      rf.PIECES_MIN === 40 &&
        rf.ACK_EVERY === 40 &&
        PIECE === 3000 &&
        PROMPT_FILES === 3 &&
        PROMPT_MAX === 300 * KB &&
        DAY_MAX === 3 * KB * KB &&
        DAY_FILES === 30 &&
        FILE_MS === 5 * 60000 &&
        PICTURE_MAX === 150 * KB &&
        TEXT_MAX === 64 * KB &&
        SIDE === 2048
    );
  }

  console.log(
    `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
  );
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.log('ERROR ' + (e.stack || e));
  process.exit(1);
});
