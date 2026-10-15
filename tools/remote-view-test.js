// Test of desktop/remote-view.js: node tools/remote-view-test.js (plain Node; also run it in
// Electron's Node). The live view. What a picture is, the
// watched side and the watching side, each alone, on a clock the test moves by hand. Two and three
// whole services through the stand-in relay are tools/remote-service-test.js.
const zlib = require('zlib');
const V = require('../desktop/remote-view.js');
const {
  shapeView,
  shapeViewing,
  shapeFrame,
  shapeUnview,
  FRAME_Z,
} = require('../desktop/remote-api.js');
const MAX_PLAIN = require('../desktop/remote-noise.js').MAX_PLAIN;

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}
const C = n => String.fromCharCode(n),
  hex = n => n.toString(16).padStart(16, '0');
const RLO = C(0x202e),
  ZW = C(0x200b),
  ESC = C(0x1b),
  TAB = C(9),
  NBSP = C(0xa0),
  MARK = C(0x301),
  HALF = C(0xd83d),
  HE = C(0x5d0) + C(0x5d1) + C(0x5d2);

// ---- the five messages ----
{
  const T = 'a'.repeat(16),
    N = hex(7);
  check(
    'view: a one-time number, the freshness pair, the row id and its ticket, and nothing else',
    JSON.stringify(
      shapeView({ t: 'view', n: N, c: 3, ms: 12, id: 'p1', to: T, text: 'x', v: T })
    ) === JSON.stringify({ t: 'view', n: N, c: 3, ms: 12, id: 'p1', to: T })
  );
  check(
    'keep: the same and the view it is for',
    JSON.stringify(shapeView({ t: 'keep', n: N, c: 3, ms: 0, v: hex(9), id: 'p1', to: T })) ===
      JSON.stringify({ t: 'keep', n: N, c: 3, ms: 0, v: hex(9), id: 'p1', to: T })
  );
  check(
    'a view or keep of another shape is nothing',
    [
      { t: 'view', n: 'x', c: 3, ms: 1, id: 'p1', to: T },
      { t: 'view', n: N, c: 0, ms: 1, id: 'p1', to: T },
      { t: 'view', n: N, c: 3, ms: -1, id: 'p1', to: T },
      { t: 'view', n: N, c: 3, ms: 1, id: ' p1', to: T },
      { t: 'view', n: N, c: 3, ms: 1, id: 'p1', to: 'T' },
      { t: 'keep', n: N, c: 3, ms: 1, id: 'p1', to: T },
      { t: 'prompt', n: N, c: 3, ms: 1, id: 'p1', to: T },
      null,
      'view',
    ].every(m => shapeView(m) === null)
  );
  check(
    'viewing: one of four words, an unknown one reads as refused; whole minutes left or none',
    shapeViewing({ t: 'viewing', n: N, state: 'on', left: 118 }).left === 118 &&
      shapeViewing({ n: N, state: 'yes' }).state === 'refused' &&
      !('left' in shapeViewing({ n: N, state: 'on', left: 500 })) &&
      !('left' in shapeViewing({ n: N, state: 'on', left: '9' })) &&
      shapeViewing({ state: 'on' }) === null
  );
  check(
    'unview: one of seven words, an unknown one reads as closed',
    shapeUnview({ v: N, why: 'stopped' }).why === 'stopped' &&
      shapeUnview({ v: N, why: '<b>' }).why === 'closed' &&
      shapeUnview({ why: 'off' }) === null
  );
  const z = 'QUJD'.repeat(FRAME_Z / 4);
  check(
    'frame: a view id, a frame number, part and parts, and base64 of a bounded length',
    JSON.stringify(shapeFrame({ t: 'frame', v: N, s: 2, i: 1, k: 2, z: 'QUJD', to: T, n: N })) ===
      JSON.stringify({ t: 'frame', v: N, s: 2, i: 1, k: 2, z: 'QUJD' })
  );
  check(
    'a frame part of another shape is nothing',
    [
      { v: N, s: 0, i: 0, k: 1, z: 'QQ==' },
      { v: N, s: 1, i: 1, k: 1, z: 'QQ==' },
      { v: N, s: 1, i: 0, k: 4, z: 'QQ==' },
      { v: N, s: 1.5, i: 0, k: 1, z: 'QQ==' },
      { v: N, s: 1, i: 0, k: 1, z: '' },
      { v: N, s: 1, i: 0, k: 1, z: 7 },
      { v: N, s: 1, i: 0, k: 1, z: '<img>' },
      { v: N, s: 1, i: 0, k: 1, z: z + 'QUJD' },
      { v: 'x', s: 1, i: 0, k: 1, z: 'QQ==' },
      { v: N, s: '1', i: 0, k: 1, z: 'QQ==' },
    ].every(m => shapeFrame(m) === null)
  );
  check(
    'the longest frame part fits one sealed message',
    Buffer.byteLength(
      JSON.stringify(shapeFrame({ t: 'frame', v: 'f'.repeat(16), s: 0x7fffffff, i: 2, k: 3, z }))
    ) <= MAX_PLAIN,
    Buffer.byteLength(
      JSON.stringify(shapeFrame({ t: 'frame', v: 'f'.repeat(16), s: 0x7fffffff, i: 2, k: 3, z }))
    )
  );
}

// ---- what a picture is ----
{
  // test 13: the frame cleaner
  const row = HE + RLO + 'ab' + ZW + TAB + 'c' + ESC + '[31m' + HALF + NBSP + 'd';
  const cells = V.cellsOf(row);
  check(
    'test 13: every control, invisible, zero-width, direction or separator character and a half surrogate becomes exactly one space; the order stays',
    cells.join('') === HE + ' ab  c [31m  d' && cells.length === row.length,
    cells
  );
  check(
    'test 13: a character keeps at most two combining marks; 300 marks in a row are one character',
    V.cellsOf('e' + MARK.repeat(5) + 'x').length === 2 &&
      V.cellsOf('e' + MARK.repeat(5))[0] === 'e' + MARK + MARK &&
      V.cellsOf(MARK.repeat(300)).length === 1 &&
      V.cellsOf(MARK.repeat(300))[0] === ' ' + MARK + MARK
  );
  check(
    'cleaning a cleaned row changes nothing, and spaces are not joined (a column stays a column)',
    V.cleanRow(V.cleanRow(row)) === V.cleanRow(row) && V.cleanRow('a    b  ') === 'a    b  '
  );

  // the watched side shapes what its own window read
  const raw = {
    cols: 400,
    rows: 3,
    lines: [
      [
        'top' + TAB + 'x   ',
        [
          [0, 3, 1, -1, 1],
          [2, 5, 2, -1, 0],
          [4, 1, 200, 16, 9],
          [5, 900, -1, 4, 2],
        ],
      ],
      ['x'.repeat(500)],
      [''],
    ],
  };
  const s = V.shapeScreen(raw);
  check(
    'a screen is shaped again in the main process: at most 300 columns, each row cleaned, the spaces at its end left off',
    s.cols === 300 &&
      s.rows === 3 &&
      s.lines[0].t === 'top x' &&
      s.lines[1].t.length === 300 &&
      s.lines[2].t === ''
  );
  check(
    'its style runs are brought in range: one that overlaps is left out, a color beyond the sixteen is the default, a run past the text is cut',
    JSON.stringify(s.lines[0].r) === JSON.stringify([[0, 3, 1, -1, 1]]),
    s.lines[0].r
  );
  check(
    'a run of only default values is not sent; a run that still styles something stays',
    JSON.stringify(
      V.shapeScreen({
        cols: 10,
        rows: 1,
        lines: [
          [
            'abcdef',
            [
              [0, 2, 300, -1, 0],
              [2, 2, -1, 3, 0],
              [4, 9, -1, -1, 2],
            ],
          ],
        ],
      }).lines[0].r
    ) ===
      JSON.stringify([
        [2, 2, -1, 3, 0],
        [4, 2, -1, -1, 2],
      ])
  );
  const tall = V.shapeScreen({
    cols: 5,
    rows: 150,
    lines: Array.from({ length: 150 }, (_, i) => ['r' + i]),
  });
  check(
    'a screen of more than 100 rows: the bottom 100',
    tall.rows === 100 && tall.lines[0].t === 'r50' && tall.lines[99].t === 'r149'
  );
  check(
    'what is no screen is nothing',
    [
      null,
      {},
      { cols: 0, rows: 1, lines: [] },
      { cols: 5, rows: 1 },
      { cols: '5', rows: 1, lines: [] },
    ].every(x => V.shapeScreen(x) === null)
  );

  // pack and read back
  const full = V.packFull(s),
    back = V.unpack(full.parts.join(''));
  check(
    'a full frame packs into one message and reads back row for row',
    full.parts.length === 1 &&
      full.x === 0 &&
      back.f === 1 &&
      back.c === 300 &&
      back.r === 3 &&
      back.rows.length === 3 &&
      back.rows[0][1] === 'top x' &&
      JSON.stringify(back.rows[0][2]) === JSON.stringify([[0, 3, 1, -1, 1]])
  );

  // test 17: a screen too large for three messages
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648,
    noise = n =>
      Array.from({ length: n }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
  const big = V.shapeScreen({
    cols: 200,
    rows: 60,
    lines: Array.from({ length: 60 }, (_, i) => [
      i === 59 ? 'the input row at the bottom' : noise(200),
    ]),
  });
  const cut = V.packFull(big),
    got = V.unpack(cut.parts.join(''));
  check(
    'test 17: a screen larger than three messages loses rows from the top, says how many, and the bottom row arrives',
    cut.parts.length === 3 &&
      cut.x > 0 &&
      got.x === cut.x &&
      got.rows.length === 60 - cut.x &&
      got.rows.at(-1)[1] === 'the input row at the bottom' &&
      got.rows[0][0] === cut.x,
    [cut.parts.length, cut.x]
  );
  check(
    'each part fits one sealed message',
    cut.parts.every(
      (z, i) =>
        Buffer.byteLength(
          JSON.stringify(shapeFrame({ t: 'frame', v: hex(1), s: 1, i, k: 3, z }))
        ) <= MAX_PLAIN
    )
  );

  // test 11: a frame that inflates to megabytes
  const bomb = zlib
    .deflateRawSync(
      Buffer.from(JSON.stringify({ f: 1, c: 1, r: 1, x: 0, l: [[0, 'a'.repeat(8 * 1024 * 1024)]] }))
    )
    .toString('base64');
  const realInflate = zlib.inflateRawSync;
  let stoppedWith = '',
    madeBytes = -1,
    asked = null;
  zlib.inflateRawSync = (buf, opts) => {
    asked = opts;
    try {
      const r = realInflate(buf, opts);
      madeBytes = r.length;
      return r;
    } catch (e) {
      stoppedWith = String(e.code || e);
      throw e;
    }
  };
  const t0 = Date.now(),
    dropped = V.unpack(bomb);
  zlib.inflateRawSync = realInflate;
  check(
    'test 11: a frame of ' +
      bomb.length +
      ' base64 characters that would inflate to 8 MB is dropped by the inflate itself at the 64 KB limit: the megabytes are never made',
    bomb.length <= 3 * FRAME_Z &&
      dropped === null &&
      asked?.maxOutputLength === V.INFLATE_MAX &&
      stoppedWith === 'ERR_BUFFER_TOO_LARGE' &&
      madeBytes === -1 &&
      Date.now() - t0 < 500,
    [bomb.length, stoppedWith, madeBytes, Date.now() - t0]
  );

  // test 12: every wrong frame is dropped whole
  const okFrame = {
    f: 0,
    c: 10,
    r: 4,
    x: 0,
    l: [
      [
        1,
        'abc',
        [
          [0, 1, 1, -1, 0],
          [1, 2, -1, 4, 3],
        ],
      ],
      [3, 'd'],
    ],
  };
  const z = o =>
      zlib
        .deflateRawSync(Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)))
        .toString('base64'),
    bad = change => {
      const o = JSON.parse(JSON.stringify(okFrame));
      change(o);
      return V.unpack(z(o));
    };
  check('a frame of changed rows that holds reads back', V.unpack(z(okFrame)).rows.length === 2);
  const WRONG = {
    'a row number out of range': o => {
      o.l[1][0] = 4;
    },
    'a row number below zero': o => {
      o.l[0][0] = -1;
    },
    'a row twice': o => {
      o.l[1][0] = 1;
    },
    'row numbers falling': o => {
      o.l.reverse();
    },
    'a row longer than its columns': o => {
      o.l[0][1] = 'x'.repeat(11);
    },
    'a row number that is text': o => {
      o.l[0][0] = '1';
    },
    'a row that is not text': o => {
      o.l[0][1] = 7;
    },
    'a row with a control character': o => {
      o.l[0][1] = 'a' + ESC + 'c';
    },
    'a row with a direction override': o => {
      o.l[0][1] = 'a' + RLO + 'c';
    },
    'a row with three marks on one character': o => {
      o.l[0][1] = 'a' + MARK.repeat(3);
    },
    'a run outside the row': o => {
      o.l[0][2] = [[2, 2, 1, -1, 0]];
    },
    'runs overlapping': o => {
      o.l[0][2] = [
        [0, 2, 1, -1, 0],
        [1, 1, 2, -1, 0],
      ];
    },
    'runs not sorted': o => {
      o.l[0][2] = [
        [1, 1, 1, -1, 0],
        [0, 1, 2, -1, 0],
      ];
    },
    'a color of 16': o => {
      o.l[0][2][0][2] = 16;
    },
    'a background of -2': o => {
      o.l[0][2][0][3] = -2;
    },
    'a flag of 4': o => {
      o.l[0][2][0][4] = 4;
    },
    'a string where a number belongs': o => {
      o.l[0][2][0][1] = '1';
    },
    'a run of four values': o => {
      o.l[0][2][0].pop();
    },
    'a run of no length': o => {
      o.l[0][2][0][1] = 0;
    },
    '101 runs': o => {
      o.l[0][2] = Array.from({ length: 101 }, () => [0, 1, 1, -1, 0]);
    },
    'no columns': o => {
      o.c = 0;
    },
    '301 columns': o => {
      o.c = 301;
    },
    '101 rows': o => {
      o.r = 101;
    },
    'a cut past the last row': o => {
      o.x = 4;
    },
    'more rows than the screen has': o => {
      o.r = 1;
    },
    'a kind that is neither full nor changed': o => {
      o.f = 2;
    },
    'rows that are no list': o => {
      o.l = 'abc';
    },
    'a row of four values': o => {
      o.l[0].push(1);
    },
    'a full frame with a row missing': o => {
      o.f = 1;
    },
  };
  const passedWrong = Object.entries(WRONG)
    .filter(([, change]) => bad(change) !== null)
    .map(([name]) => name);
  check(
    'test 12: ' + Object.keys(WRONG).length + ' wrong frames, each dropped whole and none repaired',
    passedWrong.length === 0,
    passedWrong
  );
  check(
    'test 12: what is no deflate, no JSON or no object is dropped too',
    V.unpack('!!!') === null &&
      V.unpack(z('not json')) === null &&
      V.unpack(z('[1,2]')) === null &&
      V.unpack(z('null')) === null &&
      V.unpack(7) === null
  );
}

// ---- a clock and timers the test moves by hand ----
function world() {
  const w = { t: 1700000000000, m: 5000, timers: [] };
  w.timersApi = {
    set: (fn, ms) => {
      const h = { at: w.m + ms, fn };
      w.timers.push(h);
      return h;
    },
    clear: h => {
      const i = w.timers.indexOf(h);
      if (i >= 0) w.timers.splice(i, 1);
    },
  };
  w.advance = ms => {
    const end = w.m + ms;
    for (;;) {
      const due = w.timers.filter(h => h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      w.timersApi.clear(due);
      w.t += due.at - w.m;
      w.m = due.at;
      due.fn();
    }
    w.t += end - w.m;
    w.m = end;
  };
  return w;
}
const screenOf = (rows, text) => ({
  cols: 40,
  rows,
  lines: Array.from({ length: rows }, (_, y) => [
    typeof text === 'function' ? text(y) : text + ' ' + y,
  ]),
});

// ---- the watched side ----
function watched(more = {}) {
  const w = world(),
    b = {
      w,
      wire: [],
      asked: [],
      store: {},
      lines: [],
      right: { A: 'pair-1' },
      grant: { A: true },
      live: { A: true },
      tickets: { p1: 'a'.repeat(16), p2: 'b'.repeat(16) },
      freshOk: true,
      canWrite: true,
      canLog: true,
      term: { p1: true },
      changes: 0,
      n: 100,
    };
  b.views = V.createViews({
    now: () => w.t,
    mono: () => w.m,
    timers: w.timersApi,
    rights: id => b.right[id] || '',
    granted: id => b.grant[id] === true,
    live: id => b.live[id] === true,
    fresh: () => b.freshOk,
    ticket: (id, panel) => b.tickets[panel] || '',
    agentName: panel => ({ p1: 'Moss', p2: 'Wren' })[panel] || '',
    peerName: id => 'Desk ' + id,
    send: (to, obj) => {
      if (b.cut) return false;
      b.wire.push({ to, obj: JSON.parse(JSON.stringify(obj)) });
      return true;
    },
    screen: (panel, on) => {
      b.asked.push(panel + (on ? ' on' : ' off'));
      if (on && b.term[panel] && b.auto !== false) b.views.rows(panel, screenOf(5, 'first'));
      else if (on && !b.term[panel] && b.none) b.views.rows(panel, null);
    },
    allowance: {
      read: () => {
        if (b.readFails) throw new Error('disk');
        return b.store;
      },
      write: map => {
        if (!b.canWrite) throw new Error('disk');
        b.writes = (b.writes || 0) + 1;
        b.store = JSON.parse(JSON.stringify(map));
      },
    },
    log: e => {
      if (!b.canLog) throw new Error('disk');
      const line = { ...e, secs: null, why: '' };
      b.lines.push(line);
      return (secs, why) => {
        line.secs = secs;
        line.why = why;
      };
    },
    on: {
      changed: () => {
        b.changes++;
      },
    },
    ...more,
  });
  b.view = (from = 'A', panel = 'p1', extra = {}) => {
    const n = hex(++b.n);
    b.last = n;
    b.views.receive(from, {
      t: 'view',
      n,
      c: 1,
      ms: 0,
      id: panel,
      to: b.tickets[panel] || 'f'.repeat(16),
      ...extra,
    });
    return n;
  };
  b.of = (t, to = 'A') => b.wire.filter(m => m.to === to && m.obj.t === t).map(m => m.obj);
  b.word = n =>
    b
      .of('viewing')
      .filter(m => m.n === n)
      .at(-1)?.state || '';
  b.used = (id = 'A') => (b.store[id] || []).reduce((s, e) => s + e[1], 0);
  return b;
}
{
  // a view, start to end
  const b = watched(),
    n = b.view();
  check(
    'a view is taken: the window is asked for the panel, the list line and the first minute are written, then "on" with the minutes left, then a full frame',
    b.asked[0] === 'p1 on' &&
      b.lines.length === 1 &&
      b.lines[0].agent === 'Moss' &&
      b.lines[0].from === 'Desk A' &&
      b.used() === 60 &&
      JSON.stringify(b.of('viewing')[0]) ===
        JSON.stringify({ t: 'viewing', n, state: 'on', left: 119 }) &&
      b.of('frame').length === 1 &&
      b.wire.findIndex(m => m.obj.t === 'viewing') < b.wire.findIndex(m => m.obj.t === 'frame'),
    b.wire.map(m => m.obj.t)
  );
  const f1 = V.unpack(b.of('frame')[0].z);
  check(
    'the first frame is full and carries the view id and the number 1, and no ticket or one-time number',
    f1.f === 1 &&
      f1.rows.length === 5 &&
      f1.rows[4][1] === 'first 4' &&
      b.of('frame')[0].v === n &&
      b.of('frame')[0].s === 1 &&
      Object.keys(b.of('frame')[0]).join() === 't,v,s,i,k,z'
  );
  check(
    'who watches what is known for the mark, the bell and the card',
    JSON.stringify(b.views.watching()) ===
      JSON.stringify([{ peer: 'A', name: 'Desk A', agent: 'Moss', panelId: 'p1', since: b.w.t }]) &&
      b.changes === 1
  );

  // test 9: a still screen
  const sent = b.wire.length;
  b.w.advance(60000);
  b.views.rows('p1', screenOf(5, 'first'));
  b.w.advance(60000);
  check(
    'test 9: a still screen for two minutes, and the same screen handed over again: no message of any kind from the view',
    b.wire.length === sent,
    b.wire.slice(sent).map(m => m.obj.t)
  );

  // changed rows only, one frame a second
  b.views.rows(
    'p1',
    screenOf(5, y => (y === 4 ? 'woke' : 'first ' + y))
  );
  check(
    'the first change after two still minutes goes as a full frame (the last full one is older than 30 seconds)',
    b.of('frame').length === 2 && V.unpack(b.of('frame')[1].z).f === 1 && b.of('frame')[1].s === 2
  );
  b.w.advance(2000);
  b.views.rows(
    'p1',
    screenOf(5, y => (y === 2 ? 'changed' : y === 4 ? 'woke' : 'first ' + y))
  );
  const d = V.unpack(b.of('frame').at(-1).z);
  check(
    'one row changes: a frame with that row only',
    b.of('frame').length === 3 &&
      d.f === 0 &&
      d.rows.length === 1 &&
      d.rows[0][0] === 2 &&
      d.rows[0][1] === 'changed' &&
      b.of('frame')[2].s === 3
  );
  b.views.rows(
    'p1',
    screenOf(5, y => 'a ' + y)
  );
  b.views.rows(
    'p1',
    screenOf(5, y => 'b ' + y)
  );
  b.views.rows(
    'p1',
    screenOf(5, y => 'c ' + y)
  );
  check(
    'three changes inside one second: nothing yet (one frame a second at most)',
    b.of('frame').length === 3
  );
  b.w.advance(1000);
  check(
    'then one frame, of the newest screen, not three',
    b.of('frame').length === 4 && V.unpack(b.of('frame')[3].z).rows[0][1] === 'c 0'
  );

  // a full one after a resize, and when thirty seconds passed
  b.w.advance(2000);
  b.views.rows(
    'p1',
    screenOf(6, y => 'c ' + y)
  );
  check(
    'a resize: a full frame',
    V.unpack(b.of('frame').at(-1).z).f === 1 && V.unpack(b.of('frame').at(-1).z).r === 6
  );
  b.w.advance(31000);
  b.views.rows(
    'p1',
    screenOf(6, y => (y === 0 ? 'late' : 'c ' + y))
  );
  check(
    'a change more than 30 seconds after the last full frame goes as a full one',
    V.unpack(b.of('frame').at(-1).z).f === 1 && V.unpack(b.of('frame').at(-1).z).rows.length === 6
  );
  b.w.advance(2000);
  b.views.rows(
    'p1',
    screenOf(6, y => (y === 0 ? 'soon' : 'c ' + y))
  );
  check(
    'the next change soon after is changed rows again',
    V.unpack(b.of('frame').at(-1).z).f === 0
  );

  // a send that did not go out
  b.w.advance(2000);
  b.cut = true;
  b.views.rows(
    'p1',
    screenOf(6, y => (y === 1 ? 'lost' : y === 0 ? 'soon' : 'c ' + y))
  );
  b.cut = false;
  const before = b.of('frame').length;
  b.w.advance(2000);
  b.views.rows(
    'p1',
    screenOf(6, y => (y === 1 ? 'lost' : y === 0 ? 'soon' : 'c ' + y))
  );
  check(
    'a frame that did not go out: the next one is full, though the screen is the same as the lost one',
    b.of('frame').length === before + 1 &&
      V.unpack(b.of('frame').at(-1).z).f === 1 &&
      V.unpack(b.of('frame').at(-1).z).rows[1][1] === 'lost'
  );

  // the other computer closes it
  b.views.receive('A', { t: 'unview', v: n, why: 'closed' });
  check(
    'unview from the watching computer: the view ends, the window is told to stop, the line gets its length, nothing is said back',
    b.views.watching().length === 0 &&
      b.asked.at(-1) === 'p1 off' &&
      b.lines[0].secs > 0 &&
      b.lines[0].why === 'closed' &&
      b.of('unview').length === 0
  );
  const after = b.wire.length;
  b.views.rows('p1', screenOf(6, 'after'));
  b.w.advance(120000);
  check(
    'no frame after it ended, and no timer left',
    b.wire.length === after && b.w.timers.length === 0,
    b.w.timers.length
  );
}
{
  // test 3 and the order of checks
  const b = watched();
  b.right = {};
  b.view();
  b.views.receive('A', {
    t: 'keep',
    n: hex(1),
    c: 1,
    ms: 0,
    v: hex(2),
    id: 'p1',
    to: 'a'.repeat(16),
  });
  check(
    'no right (the rules are asked only while full control is on; the wiring drops it before): silence, nothing asked of the window, nothing written',
    b.wire.length === 0 && b.asked.length === 0 && b.lines.length === 0 && b.used() === 0
  );
  b.right = { A: 'pair-1' };
  b.grant = {};
  const g = b.view();
  check(
    'test 2: a grant from before the sentence: refused',
    b.word(g) === 'refused' && b.asked.length === 0
  );
  b.grant = { A: true };
  b.w.advance(61000);
  const stale = b.view('A', 'p1', { to: 'c'.repeat(16) });
  const noAgent = b.view('A', 'p3');
  b.freshOk = false;
  const held = b.view();
  b.freshOk = true;
  check(
    'test 3: a stale ticket, a panel with no ticket (a PowerShell panel, a CLI typed by hand, a CLI that is not ready), a message the relay held back: refused, no frame',
    [stale, noAgent, held].every(n => b.word(n) === 'refused') &&
      b.of('frame').length === 0 &&
      b.asked.length === 0
  );
  check(
    'test 6: the fifth view inside a minute gets silence, whatever it asks for',
    (() => {
      b.view('A', 'p3');
      const n = b.view();
      return b.word(n) === '' && b.asked.length === 0;
    })()
  );
  b.w.advance(61000);
  const n1 = b.view();
  b.views.receive('A', { t: 'view', n: n1, c: 1, ms: 0, id: 'p1', to: b.tickets.p1 });
  check(
    'test 3: a one-time number used again: refused, and the running view is not touched',
    b
      .of('viewing')
      .filter(m => m.n === n1)
      .map(m => m.state)
      .join() === 'on,refused' && b.views.watching().length === 1
  );

  // one view at a time on this computer
  b.right.B = 'pair-2';
  b.grant.B = true;
  b.live.B = true;
  const nb = hex(900);
  b.views.receive('B', { t: 'view', n: nb, c: 1, ms: 0, id: 'p2', to: b.tickets.p2 });
  check(
    'another computer asks while a view runs: busy',
    b.wire
      .filter(m => m.to === 'B')
      .map(m => m.obj.state)
      .join() === 'busy' && b.views.watching()[0].peer === 'A'
  );
  b.term.p2 = true;
  const n2 = b.view('A', 'p2');
  check(
    'the same computer asks again: its running view is replaced, without a word about the old one',
    b.word(n2) === 'on' &&
      b.views.watching()[0].panelId === 'p2' &&
      b.lines.length === 2 &&
      b.lines[0].why === 'closed' &&
      b.of('unview').length === 0 &&
      b.asked.join() === 'p1 on,p1 off,p2 on'
  );
  b.views.receive('A', { t: 'unview', v: n1, why: 'closed' });
  check(
    'unview for a view that is not the running one changes nothing',
    b.views.watching().length === 1
  );
  b.views.receive('B', { t: 'unview', v: n2, why: 'closed' });
  check('unview from another computer changes nothing', b.views.watching().length === 1);
}
{
  // the window: no terminal, no answer, the list and the store
  const none = watched();
  none.term = {};
  none.none = true;
  const a = none.view();
  check(
    'no mounted terminal for that panel: refused, nothing written',
    none.word(a) === 'refused' &&
      none.lines.length === 0 &&
      none.used() === 0 &&
      none.views.watching().length === 0
  );
  const slow = watched();
  slow.auto = false;
  const s = slow.view();
  check(
    'the window does not answer: nothing yet',
    slow.word(s) === '' && slow.asked.join() === 'p1 on'
  );
  slow.w.advance(3000);
  check(
    'after three seconds: refused, and the window is told to stop',
    slow.word(s) === 'refused' && slow.asked.join() === 'p1 on,p1 off' && slow.w.timers.length === 0
  );
  slow.views.rows('p1', screenOf(5, 'late'));
  check('a screen that comes after that is not sent', slow.of('frame').length === 0);
  const noList = watched();
  noList.canLog = false;
  const l = noList.view();
  check(
    'the list line cannot be written: refused, no minute taken, no frame',
    noList.word(l) === 'refused' &&
      noList.used() === 0 &&
      noList.of('frame').length === 0 &&
      noList.asked.join() === 'p1 on,p1 off'
  );
  const noStore = watched();
  noStore.canWrite = false;
  const st = noStore.view();
  check(
    'the first minute cannot be written: refused, no frame, and the line says so',
    noStore.word(st) === 'refused' &&
      noStore.of('frame').length === 0 &&
      noStore.lines[0].why === 'refused' &&
      noStore.views.watching().length === 0
  );
  const gone = watched();
  gone.auto = false;
  const gn = gone.view();
  gone.right = {};
  gone.views.rows('p1', screenOf(5, 'x'));
  check(
    'the right went while the window was asked: refused, nothing written',
    gone.word(gn) === 'refused' && gone.lines.length === 0 && gone.of('frame').length === 0
  );
}
{
  // tests 4 and 5: the guard in the turn of every frame
  const ends = (label, change, word, also = () => true) => {
    const b = watched(),
      n = b.view();
    b.w.advance(5000);
    change(b);
    b.views.rows('p1', screenOf(5, 'secret after the change'));
    const frames = b.of('frame'),
      un = b.of('unview');
    check(
      label,
      frames.length === 1 &&
        un.length === (word ? 1 : 0) &&
        (!word || (un[0].why === word && un[0].v === n)) &&
        b.views.watching().length === 0 &&
        b.lines[0].secs === 5 &&
        b.w.timers.length === 0 &&
        also(b),
      [frames.length, un, b.lines[0]]
    );
  };
  ends(
    'test 4: the switch goes off: the next frame is not sent, the other computer is told "off", the mark is gone',
    b => {
      b.right = {};
    },
    'off'
  );
  ends(
    'test 4: the switch is on for another pairing id now (forgotten and paired again): "off"',
    b => {
      b.right = { A: 'pair-9' };
    },
    'off'
  );
  ends(
    'test 2: the grant is no longer one made under the sentence: "off"',
    b => {
      b.grant = {};
    },
    'off'
  );
  ends(
    'test 4: the session ended: no frame, and nothing can be said',
    b => {
      b.live = {};
      b.cut = true;
    },
    ''
  );
  ends(
    'test 5: the agent was renamed or restarted (its ticket changed): "gone", and no frame of the new one',
    b => {
      b.tickets.p1 = 'd'.repeat(16);
    },
    'gone'
  );
  ends(
    'test 5: the panel holds no agent any more (no ticket): "gone"',
    b => {
      delete b.tickets.p1;
    },
    'gone'
  );
  const b = watched(),
    n = b.view();
  b.w.advance(1000);
  check(
    'the right ends by any path: the view ends in that call, with "off"',
    b.views.endFor('A', 'off') === true &&
      b.of('unview')[0].why === 'off' &&
      b.of('unview')[0].v === n &&
      b.views.watching().length === 0 &&
      b.asked.at(-1) === 'p1 off'
  );
  check('…and only for that computer', b.views.endFor('B') === false);
  const c = watched();
  c.view();
  c.tickets.p1 = 'e'.repeat(16);
  c.views.recheck();
  check(
    'a panel changed: the running view is looked at at once, not at the next frame',
    c.of('unview')[0]?.why === 'gone' && c.views.watching().length === 0
  );
  const q = watched();
  q.view();
  q.w.advance(30000);
  q.views.quit();
  check(
    'test 18: this computer is stopped in the middle of a view: the list line exists, without a length; no timer stays',
    q.lines.length === 1 &&
      q.lines[0].secs === null &&
      q.w.timers.length === 0 &&
      q.views.watching().length === 0
  );
}
{
  // test 8: ten minutes, keep, 120 minutes
  const b = watched(),
    n = b.view();
  b.w.advance(V.VIEW_MS - 1000);
  check('nine minutes 59 seconds without a keep: still on', b.views.watching().length === 1);
  b.w.advance(1000);
  check(
    'test 8: no keep: the view ends at ten minutes with "timeout"',
    b.of('unview').at(-1)?.why === 'timeout' &&
      b.views.watching().length === 0 &&
      b.lines[0].secs === 600 &&
      b.used() === 600 &&
      b.w.timers.length === 0,
    [b.of('unview'), b.used()]
  );
  const k = watched(),
    kn = k.view();
  let ended = 0,
    i = 0;
  const keep = extra =>
    k.views.receive('A', {
      t: 'keep',
      n: hex(5000 + ++i),
      c: 1,
      ms: 0,
      v: kn,
      id: 'p1',
      to: k.tickets.p1,
      ...extra,
    });
  k.w.advance(9 * 60000);
  keep({ to: 'c'.repeat(16) });
  keep({ v: hex(1) });
  keep();
  k.w.advance(2 * 60000);
  check(
    'a keep with another ticket or another view id does nothing, and a second and third inside the same minute are not read: it ended at ten minutes',
    k.views.watching().length === 0 && k.of('unview').at(-1).why === 'timeout'
  );
  const m = watched(),
    mn = m.view();
  i = 0;
  for (let step = 0; step < 14 && m.views.watching().length; step++) {
    m.w.advance(9 * 60000);
    m.views.receive('A', {
      t: 'keep',
      n: hex(7000 + step),
      c: 1,
      ms: 0,
      v: mn,
      id: 'p1',
      to: m.tickets.p1,
    });
    ended = step;
  }
  check(
    'test 8: a keep every nine minutes: it ends at 120 minutes with "spent", and no reply was ever given to a keep',
    m.of('unview').at(-1)?.why === 'spent' &&
      m.lines[0].secs === 7200 &&
      m.used() === 7200 &&
      m.of('viewing').length === 1,
    [m.of('unview'), m.lines[0].secs, m.used(), ended]
  );
  const again = m.view();
  check(
    'the allowance is used up: "spent", with no minutes left, and nothing asked of the window',
    m.word(again) === 'spent' &&
      m.of('viewing').at(-1).left === 0 &&
      m.asked.filter(x => x === 'p1 on').length === 1
  );
  m.w.advance(24 * 3600000 - 7200000 + 61000);
  const next = m.view();
  check(
    '24 hours after its first minutes the allowance has room again',
    m.word(next) === 'on' && m.of('viewing').at(-1).left >= 0
  );
}
{
  // tests 6 and 7: what the allowance counts and what does not reset it
  const b = watched();
  let rounds = 0;
  for (let i = 0; i < 100; i++) {
    const n = b.view();
    if (b.word(n) === 'on') rounds++;
    b.views.receive('A', { t: 'unview', v: n, why: 'closed' });
    b.w.advance(16000);
  }
  check(
    'test 6: a hundred views opened and closed at once: the allowance fell by a hundred minutes',
    rounds === 100 && b.used() === 6000 && b.views.left('A') === 20,
    [rounds, b.used(), b.views.left('A')]
  );

  // a restart: a new set of rules over the same store
  const r = watched();
  r.view();
  r.w.advance(5 * 60000 + 1000);
  const store = JSON.parse(JSON.stringify(r.store));
  r.views.quit();
  const r2 = watched();
  r2.store = store;
  r2.w.t = r.w.t + 30000;
  check(
    'test 7: this computer restarts in the middle of a view: the minutes it served are still counted',
    r2.views.left('A') === 114 && r2.word(r2.view()) === 'on' && r2.of('viewing')[0].left === 113,
    [r2.views.left('A'), r2.of('viewing')[0]]
  );

  // forget and pair again: another pairing id, the same device id
  r2.views.endFor('A');
  r2.right = { A: 'pair-2' };
  check(
    'test 7: forgotten and paired again (a new pairing id): not reset',
    r2.views.left('A') === 113
  );

  // the clock goes forward a day and back
  const c = watched();
  c.view();
  c.w.advance(30 * 60000 + 500);
  c.views.endFor('A');
  const usedBefore = c.views.left('A');
  c.w.t += 25 * 3600000;
  const there = c.views.left('A');
  const far = c.view();
  c.views.receive('A', { t: 'unview', v: far, why: 'closed' });
  c.w.t -= 25 * 3600000;
  check(
    'test 7: the clock goes forward a day and back: what was used before is counted again, and a minute served on the day ahead counts though it is dated in the future',
    usedBefore === 110 && there === 120 && c.views.left('A') === 109,
    [usedBefore, there, c.views.left('A')]
  );
  const junk = watched();
  junk.store = { A: 'lots', __proto__: null, B: [[1, 'x'], null, [junk.w.t, 120]] };
  check(
    'a store of another shape reads as nothing used, and never throws',
    junk.views.left('A') === 120 &&
      junk.views.left('B') === 118 &&
      junk.views.left('constructor') === 120
  );
}
{
  // test 18: this computer's user ends it
  const b = watched(),
    n = b.view();
  b.w.advance(4000);
  check(
    'a press on the mark: the view ends with "stopped"',
    b.views.stop('A') === true &&
      b.of('unview')[0].why === 'stopped' &&
      b.of('unview')[0].v === n &&
      b.lines[0].why === 'stopped' &&
      b.views.watching().length === 0
  );
  const again = b.view();
  b.w.advance(9 * 60000);
  const still = b.view();
  check(
    'test 18: a new view from that computer inside ten minutes is refused',
    b.word(again) === 'refused' &&
      b.word(still) === 'refused' &&
      b.asked.filter(x => x === 'p1 on').length === 1
  );
  b.w.advance(61000);
  check('after ten minutes it is taken again', b.word(b.view()) === 'on');
  check('a press with no view of that computer running does nothing', b.views.stop('B') === false);
}
{
  // the budget in messages (change 5): a large, busy screen
  const b = watched();
  b.view();
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648,
    noise = n =>
      Array.from({ length: n }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
  const perMinute = [];
  let mark = b.of('frame').length;
  for (let minute = 0; minute < 3; minute++) {
    for (let tick = 0; tick < 600; tick++) {
      b.views.rows('p1', {
        cols: 200,
        rows: 60,
        lines: Array.from({ length: 60 }, () => [noise(200)]),
      });
      b.w.advance(100);
    }
    perMinute.push(b.of('frame').length - mark);
    mark = b.of('frame').length;
  }
  const parts = b.of('frame').filter(f => f.k === 3).length,
    sizes = b.of('frame').map(f => Buffer.byteLength(JSON.stringify(f)));
  check(
    'a 200 by 60 screen of noise that changes every 100 ms for three minutes: at most ' +
      V.VIEW_MSGS_MIN +
      ' frame messages in any minute (' +
      perMinute.join(', ') +
      '), each inside one sealed message',
    perMinute.every(n => n <= V.VIEW_MSGS_MIN && n >= V.VIEW_MSGS_MIN - 3) &&
      parts > 0 &&
      Math.max(...sizes) <= MAX_PLAIN,
    [perMinute, Math.max(...sizes)]
  );
  const times = b.wire.filter(m => m.obj.t === 'frame' && m.obj.i === 0).length;
  check(
    'whole frames only: every frame went with all its parts',
    b.of('frame').filter(f => f.i === 0).length === times &&
      b
        .of('frame')
        .every((f, i, all) => f.i === 0 || (all[i - 1].s === f.s && all[i - 1].i === f.i - 1))
  );
}
{
  // the link's own room: other messages come first
  let free = 0;
  const b = watched({ room: () => free });
  const n = b.view();
  check(
    'the link has no room this minute (the lists and replies used it): the view is on, and its first picture waits',
    b.word(n) === 'on' && b.of('frame').length === 0
  );
  b.w.advance(10000);
  check(
    'ten seconds later, still no room: still no frame, and the view is not ended for it',
    b.of('frame').length === 0 && b.views.watching().length === 1
  );
  free = 1;
  b.w.advance(2000);
  check('room for one message: the one-part frame goes', b.of('frame').length === 1);
  let seed = 9;
  const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    noise = k =>
      Array.from({ length: k }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
  free = 2;
  b.w.advance(2000);
  b.views.rows('p1', {
    cols: 200,
    rows: 60,
    lines: Array.from({ length: 60 }, () => [noise(200)]),
  });
  b.w.advance(6000);
  check(
    'room for two messages and a frame of three parts: none of its parts goes (never half a frame)',
    b.of('frame').length === 1
  );
  free = 3;
  b.w.advance(2000);
  check(
    'room for three: all three go',
    b.of('frame').length === 4 &&
      b
        .of('frame')
        .slice(1)
        .map(f => f.i)
        .join() === '0,1,2'
  );
}
{
  let seed = 21;
  const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    noise = k =>
      Array.from({ length: k }, () => String.fromCharCode(33 + Math.floor(rnd() * 90))).join('');
  const busy = b => {
    b.views.rows('p1', {
      cols: 200,
      rows: 60,
      lines: Array.from({ length: 60 }, () => [noise(200)]),
    });
    b.w.advance(1000);
  };
  const b = watched();
  b.view();
  for (let i = 0; i < 14; i++) busy(b);
  const first = b.of('frame').length;
  for (let again = 0; again < 3; again++) {
    b.view();
    for (let i = 0; i < 12; i++) busy(b);
  } // the same computer asks again, three times, inside the same minute
  check(
    'review 15, 1: a computer that asks again every few seconds gets no fresh budget: ' +
      V.VIEW_MSGS_MIN +
      ' frame messages in the minute for all its views together (' +
      first +
      ' after the first view, ' +
      b.of('frame').length +
      ' after three more)',
    first >= V.VIEW_MSGS_MIN - 3 &&
      b.of('frame').length <= V.VIEW_MSGS_MIN &&
      b.of('viewing').filter(m => m.state === 'on').length === 4,
    [first, b.of('frame').length]
  );
  const f = watched();
  f.view();
  f.w.advance(5000);
  f.views.rows('p1', screenOf(5, 'x'));
  const n1 = f.of('frame').length;
  f.view();
  f.views.rows('p1', screenOf(5, 'y'));
  check(
    'review 15, 1: the one-second floor holds across views too: a new view inside the same second sends its first picture a second later',
    f.of('frame').length === n1 && (f.w.advance(1000), f.of('frame').length === n1 + 1),
    [n1, f.of('frame').length]
  );

  // finding 8: the cleaner by category
  const cp = n => String.fromCodePoint(n),
    GAPS = [
      0x206a, 0x206f, 0x1d173, 0x1bca0, 0x13430, 0x600, 0x605, 0xfff0, 0xfffe, 0x0378, 0xe0001,
    ];
  check(
    'review 15, 8: format characters, unassigned code points and non-characters that the old list let through each become one space',
    GAPS.every(n => V.cleanRow('a' + cp(n) + 'b') === 'a b'),
    GAPS.filter(n => V.cleanRow('a' + cp(n) + 'b') !== 'a b').map(n => n.toString(16))
  );
  check(
    "a private-use character (a terminal font's symbol), a wide character and an emoji stay as they are",
    V.cleanRow(cp(0xe0b0) + cp(0x6f22) + cp(0x1f600)) === cp(0xe0b0) + cp(0x6f22) + cp(0x1f600) &&
      V.cellsOf(cp(0xe0b0) + cp(0x6f22) + cp(0x1f600)).length === 3
  );

  // The reading side does not ask that unassigned code
  // points were blanked (two app versions know different Unicode tables); everything else the
  // cleaner would change still drops the frame.
  {
    const frame = t => V.checkFrame({ f: 1, c: 10, r: 1, x: 0, l: [[0, t]] });
    check(
      'review 16, 1.2: a row with a character this computer does not know is read, not dropped',
      frame('a' + cp(0x0378) + 'b')?.rows[0][1] === 'a' + cp(0x0378) + 'b' && !!frame('ab'),
      frame('a' + cp(0x0378) + 'b')
    );
    check(
      'review 16, 1.2: a row with a format character, a control or a half surrogate is still dropped by the reader',
      [0x200b, 0x202e, 0x07, 0x2028].every(n => frame('a' + cp(n) + 'b') === null) &&
        frame('a' + String.fromCharCode(0xd800) + 'b') === null
    );
    check(
      'review 16, 1.2: the sender still blanks it',
      V.cleanRow('a' + cp(0x0378) + 'b') === 'a b'
    );
  }

  // finding 7: the window counts a character with its variation selector as one, and so does this
  // side
  const heart = cp(0x2764) + cp(0xfe0f),
    shaped = V.shapeScreen({
      cols: 10,
      rows: 1,
      lines: [['a' + heart + 'bc', [[2, 1, 1, -1, 0]]]],
    });
  check(
    'review 15, 7: an emoji written with its variation selector is one character on both sides: the run the window made for the letter after it still covers that letter',
    V.cellsOf('a' + heart + 'bc').length === 4 &&
      V.cellsOf(shaped.lines[0].t)[shaped.lines[0].r[0][0]] === 'b',
    V.cellsOf(shaped.lines[0].t)
  );

  // finding 10: the ten-minute refusal across a restart
  const s1 = watched();
  s1.view();
  s1.w.advance(2000);
  s1.views.stop('A');
  const s2 = watched();
  s2.store = JSON.parse(JSON.stringify(s1.store));
  s2.w.t = s1.w.t + 1000;
  check(
    "review 15, 10: this computer restarts after its user ended a view: that computer's next view is still refused",
    s2.word(s2.view()) === 'refused' && s2.asked.length === 0
  );
  s2.w.advance(10 * 60000 + 1000);
  check('…and taken again once the ten minutes are over', s2.word(s2.view()) === 'on');

  // finding 11: an allowance that cannot be read
  const r = watched();
  r.store = { A: [[r.w.t, 7200]] };
  r.readFails = true;
  const rn = r.view();
  check(
    'review 15, 11: the allowance cannot be read: "spent", nothing asked of the window, and nothing written over what is there',
    r.word(rn) === 'spent' && r.asked.length === 0 && !r.writes && r.views.left('A') === 0,
    [r.word(rn), r.writes]
  );
  const r2 = watched();
  r2.view();
  r2.w.advance(30000);
  r2.readFails = true;
  r2.w.advance(31000);
  check(
    'review 15, 11: it stops being readable during a view: the next minute is not served, and nothing is written',
    r2.views.watching().length === 0 && r2.of('unview')[0]?.why === 'spent' && r2.writes === 1,
    [r2.of('unview'), r2.writes]
  );

  // finding 5: this computer's window was loaded again
  const w5 = watched();
  w5.views.reask();
  const none5 = w5.asked.length;
  w5.view();
  w5.views.reask();
  check(
    'review 15, 5: the window that read the watched panel was loaded again: it is asked for that panel once more; with no view, for nothing',
    none5 === 0 && w5.asked.join() === 'p1 on,p1 on'
  );
}

// ---- the watching side ----
function watcher() {
  const w = world(),
    a = { w, wire: [], models: [], fieldsOk: true, n: 0 };
  a.watch = V.createWatcher({
    now: () => w.t,
    timers: w.timersApi,
    nonce: () => hex(++a.n),
    send: (to, obj) => {
      if (a.cut) return false;
      a.wire.push({ to, obj: JSON.parse(JSON.stringify(obj)) });
      return true;
    },
    fields: (peer, agent) => (a.fieldsOk ? { id: agent, to: 'a'.repeat(16), c: 4, ms: 20 } : null),
    on: { changed: m => a.models.push(m) },
  });
  a.m = () => a.watch.model();
  a.frame = (s, frame, v = hex(a.n), from = 'B') => {
    const parts = V.pack(frame);
    parts.forEach((z, i) => a.watch.receive(from, { t: 'frame', v, s, i, k: parts.length, z }));
  };
  a.full = text => ({
    f: 1,
    c: 20,
    r: 3,
    x: 0,
    l: [
      [0, text + ' 0'],
      [1, text + ' 1'],
      [2, text + ' 2'],
    ],
  });
  a.open = () => {
    a.watch.open('B', 'p1', 'Moss');
    a.watch.receive('B', { t: 'viewing', n: hex(a.n), state: 'on', left: 90 });
  };
  return a;
}
{
  const a = watcher();
  check(
    'Watch: a view message leaves with a new one-time number, the row id, its ticket and the freshness pair',
    a.watch.open('B', 'p1', 'Moss').state === 'asked' &&
      JSON.stringify(a.wire[0]) ===
        JSON.stringify({
          to: 'B',
          obj: { t: 'view', n: hex(1), c: 4, ms: 20, id: 'p1', to: 'a'.repeat(16) },
        }) &&
      a.m().state === 'asked' &&
      a.m().picture === null
  );
  a.watch.receive('B', { t: 'viewing', n: hex(99), state: 'on' });
  a.watch.receive('C', { t: 'viewing', n: hex(1), state: 'on' });
  check(
    'a "viewing" for another number, or from another computer, is not read',
    a.m().state === 'asked'
  );
  a.frame(1, a.full('early'));
  check(
    'test 15: a frame before "on" is dropped',
    a.m().picture === null && a.m().state === 'asked'
  );
  a.watch.receive('B', { t: 'viewing', n: hex(1), state: 'on', left: 90 });
  check(
    '"on": the countdown starts at that moment, ten minutes',
    a.m().state === 'on' && a.m().until === a.w.t + V.VIEW_MS && a.m().left === 90
  );
  a.frame(1, a.full('hello'));
  check(
    'a full frame becomes the picture, with its time',
    a
      .m()
      .picture.lines.map(l => l.t)
      .join('|') === 'hello 0|hello 1|hello 2' &&
      a.m().picture.at === a.w.t &&
      a.m().picture.incomplete === false &&
      a.m().picture.cols === 20
  );
  a.frame(2, { f: 0, c: 20, r: 3, x: 0, l: [[1, 'changed', [[0, 3, 2, -1, 1]]]] });
  check(
    'changed rows are put into it',
    a
      .m()
      .picture.lines.map(l => l.t)
      .join('|') === 'hello 0|changed|hello 2' &&
      JSON.stringify(a.m().picture.lines[1].r) === JSON.stringify([[0, 3, 2, -1, 1]])
  );

  // test 15
  const pic = JSON.stringify(a.m().picture),
    bad0 = a.models.length;
  a.frame(3, a.full('other view'), hex(77));
  a.frame(3, a.full('other computer'), hex(1), 'C');
  for (let i = 0; i < 20; i++)
    a.watch.receive('B', { t: 'frame', v: hex(77), s: 3, i: 0, k: 1, z: '!!!not base64!!!' });
  check(
    'test 15: a frame for another view id, from another computer, and twenty parts of no open view: dropped before anything is read, the picture and the view untouched',
    JSON.stringify(a.m().picture) === pic && a.m().state === 'on' && a.models.length === bad0
  );

  // test 16
  a.frame(4, { f: 0, c: 20, r: 3, x: 0, l: [[0, 'skipped']] });
  check(
    'test 16: a frame number that skips one: the rows are shown and the picture is marked "may be incomplete"',
    a.m().picture.incomplete === true && a.m().picture.lines[0].t === 'skipped'
  );
  a.frame(5, { f: 0, c: 20, r: 3, x: 0, l: [[2, 'still']] });
  check(
    'test 16: …until a full frame',
    a.m().picture.incomplete === true &&
      (a.frame(6, a.full('whole')), a.m().picture.incomplete === false)
  );
  a.frame(6, a.full('again'));
  a.frame(2, a.full('old'));
  check(
    'a frame number that does not rise is an old frame: dropped',
    a.m().picture.lines[0].t === 'whole 0'
  );
  {
    const e = watcher();
    e.open();
    e.frame(1, e.full('size'));
    e.frame(2, { f: 0, c: 20, r: 4, x: 0, l: [[3, 'a fourth row']] });
    e.frame(3, { f: 0, c: 21, r: 3, x: 0, l: [[0, 'wider']] });
    check(
      'review 15, 14e: changed rows for a picture of another size are dropped, and the picture is marked',
      e.m().picture.lines.length === 3 &&
        e.m().picture.lines[0].t === 'size 0' &&
        e.m().picture.incomplete === true
    );
  }

  // a missing part, parts of two frames mixed (test 12)
  let seed2 = 11;
  const rnd2 = () => (seed2 = (seed2 * 1103515245 + 12345) % 2147483648) / 2147483648;
  const three = V.pack({
    f: 1,
    c: 200,
    r: 60,
    x: 0,
    l: Array.from({ length: 60 }, (_, y) => [
      y,
      Array.from({ length: 110 }, () => String.fromCharCode(33 + Math.floor(rnd2() * 90))).join(''),
    ]),
  });
  const a2 = watcher();
  a2.open();
  check('(a frame of ' + three.length + ' parts)', three.length >= 2);
  a2.watch.receive('B', {
    t: 'frame',
    v: hex(1),
    s: 1,
    i: three.length - 1,
    k: three.length,
    z: three.at(-1),
  }); // its first part never came
  check('test 12: a part missing: the frame is dropped whole', a2.m().picture === null);
  a2.watch.receive('B', { t: 'frame', v: hex(1), s: 2, i: 0, k: three.length, z: three[0] });
  a2.watch.receive('B', { t: 'frame', v: hex(1), s: 3, i: 1, k: three.length, z: three[1] });
  check(
    'test 12: parts of two frames mixed: dropped whole',
    a2.m().picture === null && a2.m().state === 'on'
  );
  three.forEach((z, i) =>
    a2.watch.receive('B', { t: 'frame', v: hex(1), s: 4, i, k: three.length, z })
  );
  check(
    'all parts of one frame in order: the picture',
    a2.m().picture?.rows === 60 && a2.m().picture.lines.length === 60
  );

  // test 11: five dropped frames end the view
  const a3 = watcher();
  a3.open();
  a3.frame(1, a3.full('kept'));
  const bomb = zlib
      .deflateRawSync(
        Buffer.from(
          JSON.stringify({ f: 1, c: 1, r: 1, x: 0, l: [[0, 'a'.repeat(4 * 1024 * 1024)]] })
        )
      )
      .toString('base64'),
    pieces = [
      bomb.slice(0, FRAME_Z),
      bomb.slice(FRAME_Z, 2 * FRAME_Z),
      bomb.slice(2 * FRAME_Z),
    ].filter(Boolean);
  const heap = process.memoryUsage().heapUsed;
  for (let round = 0; round < 4; round++)
    pieces.forEach((z, i) =>
      a3.watch.receive('B', { t: 'frame', v: hex(1), s: 2 + round, i, k: pieces.length, z })
    );
  check(
    'test 11: four frames that would inflate to 4 MB each: each dropped at the limit, the view still on, the picture marked',
    a3.m().state === 'on' &&
      a3.m().picture.incomplete === true &&
      a3.m().picture.lines[0].t === 'kept 0' &&
      process.memoryUsage().heapUsed - heap < 8 * 1024 * 1024,
    Math.round((process.memoryUsage().heapUsed - heap) / 1024)
  );
  pieces.forEach((z, i) =>
    a3.watch.receive('B', { t: 'frame', v: hex(1), s: 9, i, k: pieces.length, z })
  );
  check(
    'test 11: the fifth ends the view, and the other computer is told',
    a3.m().state === 'ended' &&
      a3.m().why === 'bad' &&
      a3.wire.at(-1).obj.t === 'unview' &&
      a3.wire.at(-1).obj.v === hex(1)
  );
  a3.frame(10, a3.full('after'));
  check(
    'test 15: a frame for a view that ended is dropped',
    a3.m().picture.lines[0].t === 'kept 0'
  );

  // flooding (change 10)
  const a4 = watcher();
  a4.open();
  for (let i = 1; i <= 15; i++) a4.frame(i, a4.full('f' + i));
  check(
    'fifteen frames in ten seconds: still on',
    a4.m().state === 'on' && a4.m().picture.lines[0].t === 'f15 0'
  );
  a4.frame(16, a4.full('f16'));
  check(
    'the sixteenth ends the view ("flood"), and the other computer is told',
    a4.m().state === 'ended' && a4.m().why === 'flood' && a4.wire.at(-1).obj.t === 'unview'
  );
  const a5 = watcher();
  a5.open();
  for (let i = 1; i <= 40; i++) {
    a5.frame(i, a5.full('s' + i));
    a5.w.advance(1000);
  }
  check(
    'one frame a second for forty seconds is no flood',
    a5.m().state === 'on' && a5.m().picture.lines[0].t === 's40 0'
  );
}
{
  // the endings (tests 19 and the words), keep, no reply
  const a = watcher();
  a.watch.open('B', 'p1', 'Moss');
  a.w.advance(14999);
  check('fourteen seconds without a word: still asked', a.m().state === 'asked');
  a.w.advance(1);
  check(
    'fifteen seconds: "no reply", and a late "on" is not taken',
    a.m().state === 'ended' &&
      a.m().why === 'no_reply' &&
      (a.watch.receive('B', { t: 'viewing', n: hex(1), state: 'on' }), a.m().state === 'ended') &&
      a.w.timers.length === 0
  );
  for (const word of ['refused', 'busy', 'spent']) {
    const x = watcher();
    x.watch.open('B', 'p1', 'Moss');
    x.watch.receive('B', { t: 'viewing', n: hex(1), state: word });
    check(
      '"' + word + '" ends it with that word, and nothing is said back',
      x.m().state === 'ended' &&
        x.m().why === word &&
        x.wire.length === 1 &&
        x.w.timers.length === 0
    );
  }
  const u = watcher();
  u.watch.open('B', 'p1', 'Moss');
  u.watch.receive('B', { t: 'viewing', n: hex(1), state: 'weird' });
  check('a word this computer does not know reads as refused', u.m().why === 'refused');
  const ended = word => {
    const x = watcher();
    x.open();
    x.frame(1, x.full('last'));
    x.w.advance(5000);
    x.watch.receive('B', { t: 'unview', v: hex(1), why: word });
    return x;
  };
  for (const word of ['timeout', 'spent', 'gone', 'stopped']) {
    const x = ended(word);
    check(
      'test 19: the other computer ends it with "' +
        word +
        '": the last picture stays, with its time',
      x.m().state === 'ended' &&
        x.m().why === word &&
        x.m().picture.lines[0].t === 'last 0' &&
        x.m().picture.at === x.w.t - 5000 &&
        x.wire.length === 1
    );
  }
  check(
    'test 19: after "off" the picture is gone at once',
    ended('off').m().picture === null && ended('off').m().why === 'off'
  );
  {
    const x = ended('timeout');
    x.watch.rightEnded('C');
    const kept = x.m().picture !== null;
    x.watch.rightEnded('B');
    check(
      "review 15, 4: the right ends after the view did: the kept picture goes, the word stays; another computer's right ending changes nothing",
      kept && x.m().state === 'ended' && x.m().why === 'timeout' && x.m().picture === null
    );
    const y = watcher();
    y.open();
    y.frame(1, y.full('x'));
    y.watch.rightEnded('B');
    check(
      'review 15, 4: the right ends while the view runs: it ends with "off" and the picture goes at once',
      y.m().state === 'ended' && y.m().why === 'off' && y.m().picture === null
    );
  }
  const other = watcher();
  other.open();
  other.watch.receive('B', { t: 'unview', v: hex(50), why: 'off' });
  other.watch.receive('C', { t: 'unview', v: hex(1), why: 'off' });
  check(
    'an unview for another view id, or from another computer, ends nothing',
    other.m().state === 'on'
  );
  const p = watcher();
  p.open();
  p.frame(1, p.full('x'));
  p.watch.drop('C');
  check('a pause or Forget of another computer leaves the view', p.m().state === 'on');
  p.watch.drop('B');
  check(
    'test 19: a pause, a Forget, connecting off: nothing of the view stays, and the dialog is told',
    p.m() === null && p.models.at(-1) === null && p.w.timers.length === 0
  );
  const s = watcher();
  s.open();
  s.frame(1, s.full('x'));
  s.watch.sessionEnded('C');
  s.watch.sessionEnded('B');
  check(
    'the session with that computer ended: the view ends with it, the picture stays with its time, nothing can be said',
    s.m().state === 'ended' &&
      s.m().why === 'offline' &&
      s.m().picture !== null &&
      s.wire.length === 1
  );
  const h = watcher();
  h.open();
  h.frame(1, h.full('x'));
  h.watch.close('hidden');
  check(
    'this window is hidden: the other computer is told "hidden", the last picture stays',
    h.m().state === 'ended' &&
      h.m().why === 'hidden' &&
      h.m().picture !== null &&
      JSON.stringify(h.wire.at(-1).obj) ===
        JSON.stringify({ t: 'unview', v: hex(1), why: 'hidden' })
  );
  h.watch.close('closed');
  check(
    'Close after it ended: nothing more is sent, and nothing is kept',
    h.m() === null && h.wire.length === 2
  );
  const c = watcher();
  c.open();
  c.frame(1, c.full('x'));
  c.watch.close('closed');
  check(
    'Close: the other computer is told "closed" and the picture is dropped',
    c.m() === null &&
      JSON.stringify(c.wire.at(-1).obj) ===
        JSON.stringify({ t: 'unview', v: hex(1), why: 'closed' })
  );

  // the watched computer falls silent past the end it promised
  const q = watcher();
  q.open();
  q.frame(1, q.full('x'));
  q.w.advance(V.VIEW_MS + V.REPLY_MS - 1);
  check(
    'ten minutes and fourteen seconds without a word from the watched computer: still shown as on',
    q.m().state === 'on'
  );
  q.w.advance(1);
  check(
    'a second later this side ends it itself ("timeout"): nothing is shown as live that is not, and the picture stays with its time',
    q.m().state === 'ended' &&
      q.m().why === 'timeout' &&
      q.m().picture !== null &&
      q.wire.at(-1).obj.t === 'unview' &&
      q.w.timers.length === 0
  );

  // keep
  const k = watcher();
  k.open();
  k.w.advance(8 * 60000);
  check(
    'Keep watching: a keep with a new number and the view id; the countdown is ten minutes again',
    k.watch.keep() === true &&
      JSON.stringify(k.wire.at(-1).obj) ===
        JSON.stringify({
          t: 'keep',
          n: hex(2),
          c: 4,
          ms: 20,
          v: hex(1),
          id: 'p1',
          to: 'a'.repeat(16),
        }) &&
      k.m().until === k.w.t + V.VIEW_MS
  );
  check(
    'a second press inside a minute sends nothing',
    k.watch.keep() === false && k.wire.length === 2
  );
  k.w.advance(60000);
  k.fieldsOk = false;
  check(
    'no ticket for that agent any more: nothing is sent, the countdown does not move',
    k.watch.keep() === false && k.wire.length === 2
  );
  const n = watcher();
  n.fieldsOk = false;
  check(
    'Watch for an agent this computer has no ticket for sends nothing',
    n.watch.open('B', 'p1', 'Moss').state === 'not_sent' && n.wire.length === 0 && n.m() === null
  );
  const two = watcher();
  two.open();
  two.watch.open('B', 'p2', 'Wren');
  check(
    'Watch on another agent while one view is open: the first is closed with a word, then the new one asked',
    two.wire.map(m => m.obj.t).join() === 'view,unview,view' &&
      two.m().agent === 'p2' &&
      two.m().state === 'asked'
  );
  two.watch.quit();
  check('quit leaves no timer', two.w.timers.length === 0);
}

console.log(
  `${passed} passed, ${failed} failed (${process.versions.electron ? 'Electron ' + process.versions.electron : 'Node ' + process.versions.node})`
);
process.exit(failed ? 1 : 0);
