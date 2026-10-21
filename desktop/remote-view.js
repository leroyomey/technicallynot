// Technically Not · remote-view.js — the live view: one paired computer watches an agent's terminal
// panel on another ("change n" below names a numbered change of its design). Pure Node:
// sending, the clocks, the timers, the key store and the window are handed in. Three parts:
// - What a picture is. A frame is text, never terminal control codes: rows of characters with style
// runs from a closed list. The frame cleaner, the shaping of what this computer's own window read
// from its terminal (shapeScreen), packing a frame into at most three messages (pack) and reading
// one back with every check of change 8 (unpack, checkFrame).
// - The watched side (createViews): the order of checks for `view` and `keep`, the guard in the
// turn of every frame, the ten minutes, the daily allowance kept in the key store, the budget in
// messages, full frames and changed rows, the mark and the list line.
// - The watching side (createWatcher): one open view, each frame checked and dropped whole on the
// first failure, one picture kept. The messages themselves (view, viewing, keep, frame, unview) are
// shaped in remote-api.js, by both sides.
const zlib = require('zlib');
const crypto = require('crypto');
const { shapeView, shapeViewing, shapeFrame, shapeUnview, FRAME_Z } = require('./remote-api.js');
const { sameTicket } = require('./remote-control.js');

const MINUTE = 60 * 1000;
const COLS_MAX = 300,
  ROWS_MAX = 100,
  RUNS_MAX = 100; // what a picture may be at most (change 8)
const PARTS_MAX = 3; // messages one frame may span

// a frame inflates to this at most; past it the frame is dropped (change 8, test 11)
const INFLATE_MAX = 64 * 1024;
const FRAME_MS = 1000; // one frame a second at most

// a changed-rows frame becomes a full one when the last full one is older than this
const FULL_MS = 30 * 1000;

// frame messages a minute for everything this computer's views send: a third of the relay's 120
// (change 5)
const VIEW_MSGS_MIN = 40;
const VIEW_MS = 10 * MINUTE; // a view ends this long after it began or after the last `keep`

// seconds of watching in 24 hours for each computer
const ALLOW_S = 120 * 60;
const DAY_MS = 24 * 60 * MINUTE,
  ALLOW_KEEP_MS = 7 * DAY_MS,
  ALLOW_ENTRIES = 300;
const VIEWS_MIN = 4; // `view` messages a minute from one computer; silence past it
const N_MS = 10 * MINUTE; // a one-time number is remembered this long
const FIRST_MS = 3000; // this computer's window has this long to hand over the panel's screen

// after this computer's user ended a view, that computer's views are refused this long
const STOPPED_MS = 10 * MINUTE;
const REPLY_MS = 15 * 1000; // no word on a `view` in this time is "no reply"
const BAD_MAX = 5; // dropped frames that end a view
const FLOOD_MS = 10 * 1000,
  FLOOD_MAX = 15; // more frames than this in ten seconds end a view (change 10)

// ---- what a picture is ----

// The frame cleaner. Not keys.clean: that joins spaces and trims, which
// destroys a terminal's columns. Every control, invisible, zero-width, direction or separator
// character and every half surrogate becomes exactly one space, so a column stays a column. A
// character is one code point that is no combining mark with at most two marks after it; a third
// mark is left out, and a mark with nothing before it becomes a space. By category, so it does not
// go stale with a new Unicode version: controls, format characters
// (zero-width, direction, invisible operators), half surrogates, unassigned code points and every
// separator, and the few letters and symbols that draw as nothing (Hangul fillers, the blank
// braille pattern, the object replacement character). Private-use characters stay: terminal fonts
// draw symbols with them. Variation selectors are combining marks and are kept with their
// character.
const NOT_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Z}\u115f\u1160\u2800\u3164\uffa0\ufffc]/gu;

// The reading side does not ask that unassigned code points were blanked (part
// 1, finding 2): two app versions know different Unicode tables, and a character the sender knows
// and the reader does not (a new emoji) would drop the whole frame and, five frames later, end an
// honest view. An unknown character draws as a box and can do nothing. The sender still blanks
// them. the same list without "unassigned"
const NOT_TEXT_READ = new RegExp(NOT_TEXT.source.replace('\\p{Cn}', ''), 'gu');
const MARK = /^\p{M}$/u;

function cellsOf(text, not = NOT_TEXT) {
  const cells = [];
  let marks = 0;
  for (const ch of String(text).replace(not, ' ')) {
    if (!MARK.test(ch)) {
      cells.push(ch);
      marks = 0;
    } else if (!cells.length) {
      cells.push(' ');
      marks = 0;
    } else if (marks < 2) {
      cells[cells.length - 1] += ch;
      marks++;
    }
  }
  return cells;
}
const cleanRow = text => cellsOf(text).join('');
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// The style runs of one row, checked: [start, length, foreground, background, flags] in characters
// of that row, whole numbers, sorted, not overlapping, inside the row, colors 0 to 15 or -1, flags
// 0 to 3 (1 bold, 2 inverse). → the runs, or null.
function runsOf(runs, len) {
  if (runs === undefined) return [];
  if (!Array.isArray(runs) || runs.length > RUNS_MAX) return null;
  let at = 0;
  const out = [];
  for (const r of runs) {
    if (
      !Array.isArray(r) ||
      r.length !== 5 ||
      !whole(r[0], at, len - 1) ||
      !whole(r[1], 1, len - r[0]) ||
      !whole(r[2], -1, 15) ||
      !whole(r[3], -1, 15) ||
      !whole(r[4], 0, 3)
    )
      return null;
    at = r[0] + r[1];
    out.push([r[0], r[1], r[2], r[3], r[4]]);
  }
  return out;
}

// What this computer's own window read from the panel's terminal, shaped again before anything of
// it is sealed (change 13): raw = { cols, rows, lines: [[text, runs?], …] }, one line for each row
// of the active screen. Here, on the sending side, a value that is out of range is brought in range
// (the bottom 100 rows, the first 300 columns, runs that do not hold are left out): the receiving
// side never repairs. → { cols, rows, lines: [{ t, r, sig }] } or null.
function shapeScreen(raw) {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !Array.isArray(raw.lines) ||
    !whole(raw.cols, 1, 10000) ||
    !whole(raw.rows, 1, 10000)
  )
    return null;
  const cols = Math.min(raw.cols, COLS_MAX),
    rows = Math.min(raw.rows, ROWS_MAX),
    from = Math.max(0, raw.lines.length - rows),
    lines = [];
  for (let y = 0; y < rows; y++) {
    const line = raw.lines[from + y],
      cells = cellsOf(
        Array.isArray(line) && typeof line[0] === 'string' ? line[0].slice(0, 4 * COLS_MAX) : ''
      ).slice(0, cols);

    // spaces at a row's end are not sent; a run that reached into them is cut below
    while (cells.length && cells[cells.length - 1] === ' ') cells.pop();
    const r = [];
    if (Array.isArray(line) && Array.isArray(line[1]))
      for (const x of line[1].slice(0, RUNS_MAX)) {
        if (!Array.isArray(x) || !whole(x[0], 0, cells.length - 1) || !whole(x[1], 1, 10000))
          continue;
        const run = [
          x[0],
          Math.min(x[1], cells.length - x[0]),
          whole(x[2], 0, 15) ? x[2] : -1,
          whole(x[3], 0, 15) ? x[3] : -1,
          whole(x[4], 0, 3) ? x[4] : 0,
        ];
        if (
          (r.length && run[0] < r[r.length - 1][0] + r[r.length - 1][1]) ||
          (run[2] === -1 && run[3] === -1 && run[4] === 0)
        )
          continue;
        r.push(run);
      }
    const t = cells.join('');
    lines.push({ t, r, sig: r.length ? t + '\n' + JSON.stringify(r) : t });
  }
  return { cols, rows, lines };
}

// One frame as it is deflated: f 1 = every row from `x` on, 0 = only the rows named; c, r the
// screen; x rows left out from the top.
const frameOf = (screen, ys, full, x) => ({
  f: full ? 1 : 0,
  c: screen.cols,
  r: screen.rows,
  x,
  l: ys.map(y =>
    screen.lines[y].r.length ? [y, screen.lines[y].t, screen.lines[y].r] : [y, screen.lines[y].t]
  ),
});

// → the pieces of base64 (1 to 3), or null when it does not fit three messages.
function pack(frame) {
  const z = zlib.deflateRawSync(Buffer.from(JSON.stringify(frame))).toString('base64');
  if (z.length > PARTS_MAX * FRAME_Z) return null;
  const parts = [];
  for (let i = 0; i < z.length; i += FRAME_Z) parts.push(z.slice(i, i + FRAME_Z));
  return parts;
}

// A full frame of the screen that fits: rows are left out from the top until it does (change 7). →
// { parts, x }.
function packFull(screen) {
  for (let x = 0; x < screen.rows; x++) {
    const parts = pack(frameOf(screen, screen.lines.map((_, y) => y).slice(x), true, x));
    if (parts) return { parts, x };
  }
  return null;
}

// The reading side (change 8), after the message itself was read: inflate with a hard limit, parse,
// then every value. A frame that fails anywhere is dropped whole: → null. → { f, c, r, x, rows:
// [[y, text, runs]] }.
function checkFrame(o) {
  if (
    !o ||
    typeof o !== 'object' ||
    Array.isArray(o) ||
    (o.f !== 0 && o.f !== 1) ||
    !whole(o.c, 1, COLS_MAX) ||
    !whole(o.r, 1, ROWS_MAX) ||
    !whole(o.x, 0, o.r - 1) ||
    !Array.isArray(o.l) ||
    o.l.length > o.r
  )
    return null;

  // a full frame is every row from the cut on
  if (o.f === 1 && o.l.length !== o.r - o.x) return null;
  let last = o.x - 1;
  const rows = [];
  for (const row of o.l) {
    if (
      !Array.isArray(row) ||
      (row.length !== 2 && row.length !== 3) ||
      !whole(row[0], last + 1, o.r - 1) ||
      typeof row[1] !== 'string' ||
      row[1].length > 4 * COLS_MAX
    )
      return null;
    const cells = cellsOf(row[1], NOT_TEXT_READ);

    // the cleaner leaves it unchanged, and it fits its columns
    if (cells.join('') !== row[1] || cells.length > o.c) return null;
    const runs = runsOf(row[2], cells.length);
    if (!runs) return null;
    last = row[0];
    rows.push([row[0], row[1], runs]);
  }
  return { f: o.f, c: o.c, r: o.r, x: o.x, rows };
}

function unpack(z) {
  if (typeof z !== 'string' || z.length > PARTS_MAX * FRAME_Z) return null;
  try {
    return checkFrame(
      JSON.parse(
        zlib
          .inflateRawSync(Buffer.from(z, 'base64'), { maxOutputLength: INFLATE_MAX })
          .toString('utf8')
      )
    );
  } catch {
    return null;
  }
}

// ---- the watched side ----
// rights(peerId) → the pairing id the full-control switch is on for now, '' otherwise (paused,
// stopping, off). granted(peerId) → that switch was turned on under the sentence about watching
// (change 19). live(peerId) → a session with it. fresh(peerId, msg) → the message is not one the
// relay held back (6f change 13, remote-control.js). ticket(peerId, panelId) → the ticket that
// panel's agent has for that computer now, '' when it is no agent the app started, has no
// conversation yet. agentName(panelId), peerName(peerId) → the names as this
// computer shows them. send(peerId, obj) → true when it went out. screen(panelId, on) → ask this
// computer's window to hand over that panel's screen (rows come back through `rows` below) or to
// stop. allowance: { read() → { deviceId: [[startMs, seconds], …] }, write(map) } in the key store;
// write throws when it cannot be kept. log(entry) → the list line for a view, written when it
// starts; → a function (seconds, why) that completes it, or a throw. room() → how many more
// messages this computer's link can take in this minute, everything it sends counted (the relay
// takes 120 a minute from one connection and silences the whole link past that): a frame goes only
// when all its parts fit in it. mono() → milliseconds on a clock that only goes forward (lengths);
// now() → the wall clock (the allowance's day).
function createViews({
  rights = () => '',
  granted = () => false,
  live = () => false,
  fresh = () => false,
  ticket = () => '',
  agentName = () => '',
  peerName = () => '',
  send = () => false,
  screen = () => {},
  allowance = {
    read: () => ({}),
    write: () => {
      throw new Error('no store');
    },
  },
  log = () => {
    throw new Error('no list');
  },
  room = () => Infinity,
  on = {},
  now = Date.now,
  mono = () => performance.now(),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
} = {}) {
  // peer id → { view, keep: times of its messages; ns: Map n → when; blocked: mono time until which
  // its views are refused }
  const peers = new Map();
  let view = null,
    stopped = false; // one view at a time on this computer

  // One budget and one floor for every frame this computer sends, whatever view it belongs to:
  // a computer that asks again every few seconds would otherwise
  // get a fresh 40 each time and push the link to the relay's limit.
  const frames = [];
  let frameAt = -Infinity;
  const ask = (fn, ...a) => {
    try {
      return fn(...a);
    } catch {
      return undefined;
    }
  };
  const peer = id => {
    let p = peers.get(id);
    if (!p) peers.set(id, (p = { view: [], keep: [], ns: new Map(), blocked: -Infinity }));
    return p;
  };
  const changed = () => {
    try {
      on.changed?.();
    } catch {
      /* a listener's error is not ours */
    }
  };
  const off = h => {
    if (h) timers.clear(h);
    return null;
  };
  const say = (peerId, obj) => {
    try {
      return !!obj && send(peerId, obj) === true;
    } catch {
      return false;
    }
  };

  function counted(list, t, max) {
    while (list.length && t - list[0] >= MINUTE) list.shift();
    if (list.length >= max) return false;
    list.push(t);
    return true;
  }

  // The allowance (change 12): seconds over the last 24 hours by this computer's clock; an entry
  // dated in the future counts.
  const entriesOf = (map, id) =>
    map && typeof map === 'object' && Object.hasOwn(map, id) && Array.isArray(map[id])
      ? map[id].filter(
          e => Array.isArray(e) && Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[1] > 0
        )
      : [];

  // A store that cannot be read counts as all used: a limit that
  // fails open is no limit.
  function usedBy(peerId) {
    let map;
    try {
      map = allowance.read();
    } catch {
      return Infinity;
    }
    const t = now();
    let s = 0;
    for (const e of entriesOf(map, peerId)) if (t - e[0] < DAY_MS) s += e[1];
    return s;
  }

  // Until when that computer's views are refused after this computer's user ended one: beside the
  // allowance, so it holds across a restart. A store that cannot
  // be read refuses.
  // unreadable: the allowance check below answers "spent"
  const refusedUntil = peerId => {
    try {
      const v = (allowance.read() || {})['stopped:' + peerId];
      return Number.isFinite(v) ? v : 0;
    } catch {
      return 0;
    }
  };
  const minutesLeft = peerId => Math.max(0, Math.floor((ALLOW_S - usedBy(peerId)) / 60));

  // One more minute for that view, written before it is served. Throws when it cannot be written.
  function takeMinute(v) {
    const map = { ...(allowance.read() || {}) },
      t = now(), // a read that throws writes nothing: the caller refuses or ends the view
      list = entriesOf(map, v.peerId)
        .filter(e => t - e[0] < ALLOW_KEEP_MS)
        .slice(-ALLOW_ENTRIES)
        .map(e => [e[0], e[1]]);
    const mine = list.find(e => e[0] === v.since);
    if (mine) mine[1] += 60;
    else list.push([v.since, 60]);
    map[v.peerId] = list;
    allowance.write(map);
  }

  // Is what was true when the view began still true (change 4)? → '' while it is, else the word the
  // other computer is told.
  function broken(v) {
    if (
      stopped ||
      ask(live, v.peerId) !== true ||
      ask(rights, v.peerId) !== v.pairing ||
      ask(granted, v.peerId) !== true
    )
      return 'off';
    const tk = ask(ticket, v.peerId, v.panelId);
    return typeof tk === 'string' && sameTicket(tk, v.ticket) ? '' : 'gone';
  }

  // The view ends: nothing more is read or sent for it, the other computer is told once where it
  // can still hear it, and the list line gets its length.
  function end(v, why, tell) {
    if (view !== v) return;
    view = null;
    v.first = off(v.first);
    v.endTimer = off(v.endTimer);
    v.minute = off(v.minute);
    v.wait = off(v.wait);
    ask(screen, v.panelId, false);
    if (tell) say(v.peerId, shapeUnview({ t: 'unview', v: v.v, why }));
    if (v.done) ask(v.done, Math.max(0, Math.round((mono() - v.began) / 1000)), why);
    changed();
  }
  const refuse = (peerId, n, state) => {
    say(
      peerId,
      shapeViewing({ t: 'viewing', n, state, ...(state === 'spent' ? { left: 0 } : {}) })
    );
    return { refused: state };
  };
  const arm = v => {
    v.endTimer = off(v.endTimer);
    v.endTimer = timers.set(
      () => {
        v.endTimer = null;
        end(v, 'timeout', true);
      },
      Math.max(0, v.until - mono())
    );
  };

  function nextMinute(v) {
    v.minute = timers.set(() => {
      v.minute = null;
      if (view !== v) return;
      const why = broken(v);
      if (why) return end(v, why, true);
      if (minutesLeft(v.peerId) < 1) return end(v, 'spent', true);
      try {
        takeMinute(v);
      } catch {
        return end(v, 'spent', true);
      } // a minute that cannot be written is not served
      nextMinute(v);
    }, MINUTE);
  }

  // The first screen arrived: the list line, the first minute, then the word and the first full
  // frame, in that order (changes 12, 15).
  function begin(v, shaped) {
    v.first = off(v.first);
    const why = broken(v);
    if (why) {
      view = null;
      ask(screen, v.panelId, false);
      return refuse(v.peerId, v.v, 'refused');
    }
    try {
      v.done = log({ peerId: v.peerId, from: v.from, agent: v.agent });
      if (typeof v.done !== 'function') throw new Error('no line');
    } catch {
      view = null;
      v.done = null;
      ask(screen, v.panelId, false);
      return refuse(v.peerId, v.v, 'refused');
    }
    v.since = now();
    v.began = mono();
    try {
      takeMinute(v);
    } catch {
      view = null;
      ask(screen, v.panelId, false);
      ask(v.done, 0, 'refused');
      return refuse(v.peerId, v.v, 'refused');
    }
    v.state = 'on';
    v.until = v.began + VIEW_MS;
    arm(v);
    nextMinute(v);
    if (
      !say(
        v.peerId,
        shapeViewing({ t: 'viewing', n: v.v, state: 'on', left: minutesLeft(v.peerId) })
      )
    )
      return end(v, 'gone', false);
    v.pending = shaped;
    v.full = true;
    changed();
    pump(v);
  }

  // A frame, when there is something to say and room to say it: the guard first, then the
  // one-second floor, then the budget.
  function pump(v) {
    if (view !== v || v.state !== 'on' || !v.pending || v.wait) return;
    const why = broken(v);
    if (why) return end(v, why, true);
    const m = mono(),
      later = ms => {
        v.wait = timers.set(
          () => {
            v.wait = null;
            pump(v);
          },
          Math.max(1, ms)
        );
      };
    if (m - frameAt < FRAME_MS) return later(frameAt + FRAME_MS - m);
    const s = v.pending,
      resized = !v.last || v.last.cols !== s.cols || v.last.rows !== s.rows;
    let full = v.full || resized || m - v.fullAt >= FULL_MS,
      parts = null,
      x = 0;
    if (!full) {
      const ys = [];
      for (let y = 0; y < s.rows; y++) if (s.lines[y].sig !== v.last.lines[y].sig) ys.push(y);
      if (!ys.length) {
        v.pending = null;
        return;
      } // a still screen sends nothing
      parts = pack(frameOf(s, ys, false, 0));

      // too many rows changed for three messages: a full one, cut from the top
      if (!parts) full = true;
    } else if (!resized && !v.full && s.lines.every((l, y) => l.sig === v.last.lines[y].sig)) {
      v.pending = null;
      return;
    } // never a full frame on a still screen
    if (full) {
      const p = packFull(s);
      if (!p) {
        v.pending = null;
        return;
      }
      parts = p.parts;
      x = p.x;
    }
    while (frames.length && m - frames[0] >= MINUTE) frames.shift();
    if (frames.length + parts.length > VIEW_MSGS_MIN)
      // the newest screen waits for room; an older one is not sent after it
      return later(frames[frames.length + parts.length - VIEW_MSGS_MIN - 1] + MINUTE - m);
    const free = ask(room);

    // the link is busy with other messages: they come first, the picture waits
    if (!(free >= parts.length)) return later(2 * FRAME_MS);
    v.pending = null;
    v.s++;
    frameAt = m;

    // Typing (remote-type.js): when each picture left, so a key pressed on an older one is known.
    v.times.push([v.s, m]);
    if (v.times.length > 40) v.times.shift();
    let ok = true;
    parts.forEach((z, i) => {
      if (ok) {
        ok = say(v.peerId, shapeFrame({ t: 'frame', v: v.v, s: v.s, i, k: parts.length, z }));
        if (ok) frames.push(m);
      }
    });
    if (!ok) {
      v.full = true;
      return;
    } // a send that did not go out: the next frame is a full one
    if (full) v.fullAt = m;
    v.full = x > 0;
    v.last = s; // rows left out from the top were not sent: the next frame is full again
  }

  function receive(peerId, msg) {
    const kind =
      msg && typeof msg === 'object' && (msg.t === 'view' || msg.t === 'keep' || msg.t === 'unview')
        ? msg.t
        : '';
    if (!kind || typeof peerId !== 'string' || !peerId || stopped) return { ignored: true };
    if (kind === 'unview') {
      const u = shapeUnview(msg);
      if (u && view && view.peerId === peerId && view.v === u.v)
        end(view, u.why === 'hidden' ? 'hidden' : 'closed', false);
      return { ended: true };
    }
    const t = now(),
      p = peer(peerId);
    if (!counted(p[kind], t, kind === 'view' ? VIEWS_MIN : 1)) return { silent: 'limit' };
    const pairing = ask(rights, peerId);
    if (typeof pairing !== 'string' || !pairing) return { silent: 'off' };
    const m = shapeView(msg);
    if (!m) return { silent: 'shape' };
    for (const [k, at] of p.ns) if (t - at >= N_MS) p.ns.delete(k);
    const seen = p.ns.has(m.n),
      isFresh = !seen && ask(fresh, peerId, msg) === true;
    p.ns.set(m.n, t); // a number is looked at once
    if (kind === 'keep') {
      const v = view;
      if (
        !isFresh ||
        !v ||
        v.peerId !== peerId ||
        v.state !== 'on' ||
        v.v !== m.v ||
        v.panelId !== m.id ||
        !sameTicket(m.to, v.ticket) ||
        broken(v)
      )
        return { silent: 'keep' };
      v.until = mono() + VIEW_MS;
      arm(v);
      return { kept: true };
    }
    if (
      !isFresh ||
      ask(granted, peerId) !== true ||
      mono() < p.blocked ||
      refusedUntil(peerId) > now()
    )
      return refuse(peerId, m.n, 'refused');
    const tk = ask(ticket, peerId, m.id);
    if (typeof tk !== 'string' || !sameTicket(m.to, tk)) return refuse(peerId, m.n, 'refused');
    if (view && view.peerId !== peerId) return refuse(peerId, m.n, 'busy');
    if (minutesLeft(peerId) < 1) return refuse(peerId, m.n, 'spent');

    // the same computer asks again: its running view is replaced (change 2)
    if (view) end(view, 'closed', false);
    const v = (view = {
      peerId,
      pairing,
      v: m.n,
      panelId: m.id,
      ticket: tk,
      from: String(ask(peerName, peerId) || 'Computer'),
      agent: String(ask(agentName, m.id) || ''),
      state: 'starting',
      since: 0,
      began: 0,
      until: 0,
      fullAt: -Infinity,
      s: 0,
      // typing (remote-type.js): [[picture number, when it left]], and when the screen last
      // began to differ from the last picture
      times: [],
      dirtyAt: 0,
      last: null,
      pending: null,
      full: true,
      first: null,
      endTimer: null,
      minute: null,
      wait: null,
      done: null,
    });
    v.first = timers.set(() => {
      v.first = null;
      if (view === v && v.state === 'starting') {
        view = null;
        ask(screen, v.panelId, false);
        refuse(peerId, v.v, 'refused');
      }
    }, FIRST_MS);
    ask(screen, m.id, true);
    return { starting: true };
  }

  return {
    receive,
    // This computer's window hands over the screen of a panel it was asked for: raw as shapeScreen
    // reads it, or null when no terminal is mounted for that panel.
    rows(panelId, raw) {
      const v = view;
      if (!v || v.panelId !== panelId || stopped) return;
      const shaped = raw == null ? null : shapeScreen(raw);
      if (v.state === 'starting') {
        if (shaped) begin(v, shaped);
        else if (raw == null) {
          v.first = off(v.first);
          view = null;
          ask(screen, v.panelId, false);
          refuse(v.peerId, v.v, 'refused');
        }
        return;
      }
      if (!shaped) {
        if (raw == null) end(v, 'gone', true);
        return;
      }

      // Typing (remote-type.js): when a changed screen began to wait for its picture.
      if (!v.pending) v.dirtyAt = mono();
      v.pending = shaped;
      pump(v);
    },
    // Something the guard asks about may have changed (a panel's process, its name):
    // a running view is looked at now.
    recheck() {
      const v = view;
      if (v && v.state === 'on') {
        const why = broken(v);
        if (why) end(v, why, true);
      }
    },
    // That computer's right ended, by any path (the switch, a pause, Forget), or its session did:
    // its view ends in this call.
    endFor(peerId, why = 'off') {
      const v = view;
      if (!v || v.peerId !== peerId) return false;
      if (v.state === 'starting') {
        v.first = off(v.first);
        view = null;
        ask(screen, v.panelId, false);
        return true;
      }
      end(v, why, true);
      return true;
    },
    // This computer's user pressed the mark on the watched panel: the view ends and that computer's
    // views are refused for ten minutes.
    stop(peerId) {
      const v = view;
      if (!v || v.peerId !== peerId || v.state !== 'on') return false;
      peer(peerId).blocked = mono() + STOPPED_MS;
      try {
        allowance.write({ ...(allowance.read() || {}), ['stopped:' + peerId]: now() + STOPPED_MS });
      } catch {
        /* the refusal still holds while the app runs */
      }
      end(v, 'stopped', true);
      return true;
    },
    // This computer's window was loaded again and no longer reads the watched panel: it is asked
    // again.
    reask() {
      if (view && view.state === 'on') ask(screen, view.panelId, true);
    },
    // Who is watching what, for the mark on the panel, the bell and the card.
    watching: () =>
      view && view.state === 'on'
        ? [
            {
              peer: view.peerId,
              name: view.from,
              agent: view.agent,
              panelId: view.panelId,
              since: view.since,
            },
          ]
        : [],
    left: peerId => minutesLeft(peerId),
    // Typing (remote-type.js): that computer's running view as the typing checks read it, or
    // null. dirty: a screen that differs from the last picture waits to be sent.
    typingState(peerId) {
      const v = view;
      if (!v || v.peerId !== peerId || v.state !== 'on' || stopped || broken(v)) return null;
      const dirty =
        !!v.pending &&
        (!v.last ||
          v.pending.cols !== v.last.cols ||
          v.pending.rows !== v.last.rows ||
          v.pending.lines.some((l, y) => l.sig !== v.last.lines[y].sig));
      return {
        v: v.v,
        panelId: v.panelId,
        ticket: v.ticket,
        s: v.s,
        dirty,
        dirtyAt: v.dirtyAt,
        times: v.times.map(x => [x[0], x[1]]),
      };
    },
    // The app is closing: no timer stays and nothing more is sent. The list line of a running view
    // stays without a length.
    quit() {
      stopped = true;
      const v = view;
      view = null;
      if (v) {
        for (const k of ['first', 'endTimer', 'minute', 'wait']) v[k] = off(v[k]);
        ask(screen, v.panelId, false);
      }
    },
  };
}

// ---- the watching side ----
// send(peerId, obj) → true when it went out. fields(peerId, agentId) → { id, to, c, ms } for an
// agent of that computer this one may control now (the row id, its ticket, the freshness pair), or
// null. on.changed(model) fires when what the dialog shows changes: the model is the one place a
// picture is handed out (change 11), or null when there is no view.
function createWatcher({
  send = () => false,
  fields = () => null,
  nonce = () => crypto.randomBytes(8).toString('hex'),
  on = {},
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
} = {}) {
  // { peer, agent, name, v, state: 'asked' | 'on' | 'ended', why, until, left, pic, parts, lastS,
  // bad, seen, timer, kept }
  let w = null;
  const say = (peerId, obj) => {
    try {
      return !!obj && send(peerId, obj) === true;
    } catch {
      return false;
    }
  };
  const model = () =>
    w
      ? {
          peer: w.peer,
          agent: w.agent,
          name: w.name,
          state: w.state,
          why: w.why,
          until: w.until,
          left: w.left,
          picture: w.pic
            ? {
                cols: w.pic.cols,
                rows: w.pic.rows,
                cut: w.pic.cut,
                at: w.pic.at,
                incomplete: w.pic.incomplete,
                lines: w.pic.lines.map(l => ({ t: l.t, r: l.r.map(r => [...r]) })),
              }
            : null,
        }
      : null;
  const emit = () => {
    try {
      on.changed?.(model());
    } catch {
      /* a listener's error is not ours */
    }
  };
  const unwait = () => {
    if (w && w.timer) {
      timers.clear(w.timer);
      w.timer = null;
    }
  };

  // The view is over on this side. `tell`: the other computer is told, for an ending this computer
  // made. On "off" the picture goes at once; on the other words it stays, with its time, until the
  // dialog closes.
  function finish(why, tell) {
    if (!w || w.state === 'ended') return;
    unwait();
    if (tell) say(w.peer, shapeUnview({ t: 'unview', v: w.v, why: tell }));
    w.state = 'ended';
    w.why = why;
    w.parts = null;
    if (why === 'off') w.pic = null;
    emit();
  }

  // The watched computer ends a view ten minutes after its start or the last keep and says so. If
  // that word does not come (its pairing with this computer was paused there, it crashed), this
  // side ends the view itself a moment later.
  const expect = () => {
    unwait();
    w.timer = timers.set(() => {
      if (w) w.timer = null;
      finish('timeout', 'closed');
    }, VIEW_MS + REPLY_MS);
  };
  const dropped = () => {
    w.parts = null;
    if (w.pic) w.pic.incomplete = true;
    if (++w.bad >= BAD_MAX) finish('bad', 'closed');
    else emit();
  };

  function onFrame(obj) {
    // Before base64 and inflate, and before anything else is looked at: the view is open and the
    // frame names it (change 10).
    if (w.state !== 'on' || typeof obj.v !== 'string' || obj.v !== w.v) return;
    const f = shapeFrame(obj);
    if (!f) return dropped();
    if (f.i === 0) {
      const t = now();
      w.seen = w.seen.filter(x => t - x < FLOOD_MS);
      w.seen.push(t);
      if (w.seen.length > FLOOD_MAX) return finish('flood', 'closed');
      w.parts = { s: f.s, k: f.k, got: [f.z] };
    } else if (!w.parts || w.parts.s !== f.s || w.parts.k !== f.k || f.i !== w.parts.got.length)
      return dropped(); // a part is missing, or parts of two frames are mixed
    else w.parts.got.push(f.z);
    if (w.parts.got.length < f.k) return;
    const z = w.parts.got.join('');
    w.parts = null;
    const frame = unpack(z);
    if (!frame || f.s <= w.lastS) return dropped(); // a number that does not rise is an old frame
    const next = w.lastS === 0 || f.s === w.lastS + 1;
    if (frame.f === 1)
      w.pic = {
        cols: frame.c,
        rows: frame.r,
        cut: frame.x,
        at: now(),
        incomplete: false,
        lines: Array.from({ length: frame.r }, () => ({ t: '', r: [] })),
      };
    else if (!w.pic || w.pic.cols !== frame.c || w.pic.rows !== frame.r)
      return dropped(); // changed rows of a screen this computer has no picture of
    else {
      w.pic.at = now();
      if (!next) w.pic.incomplete = true;
    } // a number was skipped: rows may be missing until the next full frame
    for (const [y, t, r] of frame.rows) w.pic.lines[y] = { t, r };
    w.lastS = f.s;
    emit();
  }

  return {
    // The user pressed Watch on an agent of that computer. → { state: 'asked' | 'not_sent' }.
    open(peerId, agentId, name) {
      if (w && w.state !== 'ended') finish('closed', 'closed');
      unwait();
      w = null;
      const f = (() => {
        try {
          return fields(peerId, agentId);
        } catch {
          return null;
        }
      })();
      let n = '';
      try {
        n = String(nonce());
      } catch {
        /* no number, nothing sent */
      }
      const msg = f ? shapeView({ t: 'view', n, c: f.c, ms: f.ms, id: f.id, to: f.to }) : null;
      if (!msg || !say(peerId, msg)) {
        emit();
        return { state: 'not_sent' };
      }
      w = {
        peer: peerId,
        agent: msg.id,
        name: String(name || ''),
        v: msg.n,
        state: 'asked',
        why: '',
        until: 0,
        left: null,
        pic: null,
        parts: null,
        lastS: 0,
        bad: 0,
        seen: [],
        timer: null,
        kept: -Infinity,
      };
      w.timer = timers.set(() => {
        if (w) w.timer = null;
        if (w && w.state === 'asked') finish('no_reply', 'closed');
      }, REPLY_MS);
      emit();
      return { state: 'asked' };
    },
    // A message from another computer that is one of the three this side reads. Anything for
    // another computer or another view is dropped here, unread.
    receive(from, obj) {
      if (!w || from !== w.peer || !obj || typeof obj !== 'object') return;
      if (obj.t === 'frame') return onFrame(obj);
      if (obj.t === 'viewing') {
        const r = shapeViewing(obj);
        if (!r || r.n !== w.v || w.state !== 'asked') return;
        unwait();
        if (r.state !== 'on') return finish(r.state, false);
        w.state = 'on';
        w.until = now() + VIEW_MS;
        w.left = r.left === undefined ? null : r.left;
        expect();
        emit();
      } else if (obj.t === 'unview') {
        const u = shapeUnview(obj);
        if (u && u.v === w.v && w.state !== 'ended')
          finish(u.why === 'closed' || u.why === 'hidden' ? 'gone' : u.why, false);
      }
    },
    // "Keep watching": at most one a minute; the countdown moves when it went out. → true when it
    // did.
    keep() {
      if (!w || w.state !== 'on' || now() - w.kept < MINUTE) return false;
      let f = null,
        n = '';
      try {
        f = fields(w.peer, w.agent);
        n = String(nonce());
      } catch {
        /* nothing sent */
      }
      const msg = f
        ? shapeView({ t: 'keep', n, c: f.c, ms: f.ms, v: w.v, id: f.id, to: f.to })
        : null;
      if (!msg || !say(w.peer, msg)) return false;
      w.kept = now();
      w.until = now() + VIEW_MS;
      expect();
      emit();
      return true;
    },
    // This computer ends it. 'closed': the dialog was closed, nothing is kept. 'hidden': the window
    // or the page is no longer in view; the last picture stays with its time for when the user is
    // back.
    close(why) {
      if (!w) return;
      if (why === 'hidden') {
        if (w.state !== 'ended') finish('hidden', 'hidden');
        return;
      }
      if (w.state !== 'ended') say(w.peer, shapeUnview({ t: 'unview', v: w.v, why: 'closed' }));
      unwait();
      w = null;
      emit();
    },
    // The session with that computer ended: the view ends with it, the picture stays with its time
    // (change 2).
    sessionEnded(peerId) {
      if (w && w.peer === peerId) finish('offline', false);
    },
    // That computer, connected, no longer says this one may watch (its switch went off there, or a
    // new session began): a running view ends with "off", and an ended one loses the picture it
    // kept. The word on how it ended stays.
    rightEnded(peerId) {
      if (!w || w.peer !== peerId) return;
      if (w.state !== 'ended') return finish('off', false);
      if (w.pic) {
        w.pic = null;
        emit();
      }
    },
    // That computer's pairing was paused or forgotten, or connecting went off here: nothing of the
    // view stays (change 11).
    drop(peerId) {
      if (w && (peerId === undefined || w.peer === peerId)) {
        unwait();
        w = null;
        emit();
      }
    },
    model,
    // Typing (remote-type.js): the open view as the typing side reads it: which view, and the
    // number and time of the newest picture drawn. Never the picture itself.
    seen: () =>
      w
        ? {
            peer: w.peer,
            agent: w.agent,
            v: w.v,
            state: w.state,
            s: w.lastS,
            at: w.pic ? w.pic.at : 0,
          }
        : null,
    quit() {
      unwait();
      w = null;
    },
  };
}

module.exports = {
  createViews,
  createWatcher,
  cellsOf,
  cleanRow,
  shapeScreen,
  frameOf,
  pack,
  packFull,
  unpack,
  checkFrame,
  COLS_MAX,
  ROWS_MAX,
  RUNS_MAX,
  PARTS_MAX,
  INFLATE_MAX,
  FRAME_MS,
  FULL_MS,
  VIEW_MSGS_MIN,
  VIEW_MS,
  ALLOW_S,
  VIEWS_MIN,
  FIRST_MS,
  STOPPED_MS,
  REPLY_MS,
  BAD_MAX,
  FLOOD_MAX,
  FLOOD_MS,
  N_MS,
};
