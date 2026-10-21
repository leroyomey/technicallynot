// Technically Not phone app · watch.mjs — Watch: the phone looks at one agent's screen on a paired
// computer. It is the phone's copy of the watching side of desktop/remote-view.js (createWatcher,
// checkFrame, unpack) and reads and writes the same five messages: `view` and `keep` (sent, with
// the row's ticket and the freshness pair), `viewing`, `frame` and `unview` (read). A frame is text
// rows with style runs, never terminal codes; each one is inflated with a hard limit, checked
// field by field and dropped whole on the first fault. phone/test/watch-test.mjs runs it against
// the computer's real views (createViews).
//
// The computer decides everything: whether this phone may watch (its full-control switch, under
// the sentence about watching), for how long (ten minutes a view, a daily allowance) and how often
// it sends. The phone keeps one picture in memory and nothing else.
import { clean } from './keys.mjs';

// The same numbers as desktop/remote-view.js and remote-api.js.
const MINUTE = 60 * 1000;
const COLS_MAX = 300;
const ROWS_MAX = 100;
const RUNS_MAX = 100;
const PARTS_MAX = 3;
const INFLATE_MAX = 64 * 1024;
export const VIEW_MS = 10 * MINUTE;
const REPLY_MS = 15 * 1000;
const BAD_MAX = 5;
const FLOOD_MS = 10 * 1000;
const FLOOD_MAX = 15;
const FRAME_Z = 4020;
const STAMP_MAX = 0x7fffffff;
const VIEW_STATES = ['on', 'refused', 'busy', 'spent'];
const UNVIEW_WHY = ['closed', 'hidden', 'timeout', 'spent', 'off', 'gone', 'stopped'];

const hex16 = v => (typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : '');
const stampOf = v => (Number.isInteger(v) && v > 0 && v <= STAMP_MAX ? v : 0);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

// ---- the messages, shaped as remote-api.js shapes them ----

function shapeView(m) {
  if (!m || typeof m !== 'object' || (m.t !== 'view' && m.t !== 'keep')) return null;
  const n = hex16(m.n);
  const c = stampOf(m.c);
  const id = typeof m.id === 'string' && m.id !== '' && clean(m.id, 80) === m.id ? m.id : '';
  const to = hex16(m.to);
  if (!n || !c || !Number.isSafeInteger(m.ms) || m.ms < 0 || !id || !to) return null;
  if (m.t === 'view') return { t: 'view', n, c, ms: m.ms, id, to };
  const v = hex16(m.v);
  return v ? { t: 'keep', n, c, ms: m.ms, v, id, to } : null;
}

function shapeViewing(m) {
  if (!m || typeof m !== 'object') return null;
  const n = hex16(m.n);
  if (!n) return null;
  const out = { t: 'viewing', n, state: VIEW_STATES.includes(m.state) ? m.state : 'refused' };
  if (Number.isInteger(m.left) && m.left >= 0 && m.left <= 120) out.left = m.left;
  return out;
}

function shapeFrame(m) {
  if (!m || typeof m !== 'object') return null;
  const v = hex16(m.v);
  if (
    !v ||
    !whole(m.s, 1, STAMP_MAX) ||
    !whole(m.k, 1, 3) ||
    !Number.isInteger(m.i) ||
    m.i < 0 ||
    m.i >= m.k
  )
    return null;
  if (
    typeof m.z !== 'string' ||
    !m.z ||
    m.z.length > FRAME_Z ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(m.z)
  )
    return null;
  return { t: 'frame', v, s: m.s, i: m.i, k: m.k, z: m.z };
}

function shapeUnview(m) {
  if (!m || typeof m !== 'object') return null;
  const v = hex16(m.v);
  return v ? { t: 'unview', v, why: UNVIEW_WHY.includes(m.why) ? m.why : 'closed' } : null;
}

// ---- what a picture is: the reading side's checks (remote-view.js) ----

// Controls, format characters, half surrogates, separators and the few characters that draw as
// nothing become one space each, so a column stays a column. Unassigned code points are not asked
// for here: a newer emoji must not drop an honest frame.
const NOT_TEXT_READ = /[\p{Cc}\p{Cf}\p{Cs}\p{Z}ᅟᅠ⠀ㅤﾠ￼]/gu;
const MARK = /^\p{M}$/u;

function cellsOf(text) {
  const cells = [];
  let marks = 0;
  for (const ch of String(text).replace(NOT_TEXT_READ, ' ')) {
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

// The style runs of one row: [start, length, foreground, background, flags], sorted, inside the
// row. → the runs, or null.
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

export function checkFrame(o) {
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
    const cells = cellsOf(row[1]);
    if (cells.join('') !== row[1] || cells.length > o.c) return null;
    const runs = runsOf(row[2], cells.length);
    if (!runs) return null;
    last = row[0];
    rows.push([row[0], row[1], runs]);
  }
  return { f: o.f, c: o.c, r: o.r, x: o.x, rows };
}

// base64 → raw deflate → at most INFLATE_MAX bytes of JSON → a checked frame, or null.
export async function unpack(z) {
  if (typeof z !== 'string' || z.length > PARTS_MAX * FRAME_Z) return null;
  try {
    const bin = atob(z);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > INFLATE_MAX) {
        reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.length;
    }
    return checkFrame(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)));
  } catch {
    return null;
  }
}

const randomN = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
};

// send(peerId, obj) → boolean or Promise<boolean>. fields(peerId, agentId) → { id, to, c, ms } of
// an agent this phone may watch now, or null (control.mjs viewFields). on.changed(model) fires when
// what is shown changes.
export function createWatch({
  send = () => false,
  fields = () => null,
  nonce = randomN,
  on = {},
  now = () => performance.now(),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
} = {}) {
  // { peer, agent, v, state: 'asked' | 'on' | 'ended', why, until, left, pic, parts, lastS, bad,
  // seen, timer, kept }
  let w = null;

  // frames are inflated one after another, in the order they came
  let queue = Promise.resolve();

  const say = async (peerId, obj) => {
    try {
      return !!obj && (await send(peerId, obj)) === true;
    } catch {
      return false;
    }
  };
  const model = () =>
    w
      ? {
          peer: w.peer,
          agent: w.agent,
          state: w.state,
          why: w.why,
          until: w.until,
          left: w.left,
          picture: w.pic
            ? {
                cols: w.pic.cols,
                rows: w.pic.rows,
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

  async function onFrame(obj) {
    if (!w || w.state !== 'on' || typeof obj.v !== 'string' || obj.v !== w.v) return;
    const f = shapeFrame(obj);
    if (!f) return dropped();
    if (f.i === 0) {
      const t = now();
      w.seen = w.seen.filter(x => t - x < FLOOD_MS);
      w.seen.push(t);
      if (w.seen.length > FLOOD_MAX) return finish('flood', 'closed');
      w.parts = { s: f.s, k: f.k, got: [f.z] };
    } else if (!w.parts || w.parts.s !== f.s || w.parts.k !== f.k || f.i !== w.parts.got.length)
      return dropped();
    else w.parts.got.push(f.z);
    if (w.parts.got.length < f.k) return;
    const z = w.parts.got.join('');
    w.parts = null;
    const mine = w;
    const frame = await unpack(z);

    // the view may have ended or changed while the frame was inflated
    if (w !== mine || w.state !== 'on') return;
    if (!frame || f.s <= w.lastS) return dropped();
    const next = w.lastS === 0 || f.s === w.lastS + 1;
    if (frame.f === 1)
      w.pic = {
        cols: frame.c,
        rows: frame.r,
        at: now(),
        incomplete: false,
        lines: Array.from({ length: frame.r }, () => ({ t: '', r: [] })),
      };
    else if (!w.pic || w.pic.cols !== frame.c || w.pic.rows !== frame.r) return dropped();
    else {
      w.pic.at = now();
      if (!next) w.pic.incomplete = true;
    }
    for (const [y, t, r] of frame.rows) w.pic.lines[y] = { t, r };
    w.lastS = f.s;
    emit();
  }

  return {
    // Watch an agent of that computer. → { state: 'asked' | 'not_sent' }.
    async open(peerId, agentId) {
      if (w && w.state !== 'ended') finish('closed', 'closed');
      unwait();
      w = null;
      let f = null;
      try {
        f = fields(peerId, agentId);
      } catch {
        f = null;
      }
      const n = hex16(nonce());
      const msg = f && n ? shapeView({ t: 'view', n, c: f.c, ms: f.ms, id: f.id, to: f.to }) : null;
      if (!msg) {
        emit();
        return { state: 'not_sent' };
      }

      // kept before it leaves: the answer may come before the send has finished
      const mine = {
        peer: peerId,
        agent: msg.id,
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
      w = mine;
      if (!(await say(peerId, msg))) {
        if (w === mine) w = null;
        emit();
        return { state: 'not_sent' };
      }
      if (w === mine && w.state === 'asked')
        w.timer = timers.set(() => {
          if (w) w.timer = null;
          if (w === mine && w.state === 'asked') finish('no_reply', 'closed');
        }, REPLY_MS);
      emit();
      return { state: 'asked' };
    },

    // `viewing`, `frame` or `unview` from that computer; anything else is not read here.
    receive(from, obj) {
      if (!w || from !== w.peer || !obj || typeof obj !== 'object') return false;
      if (obj.t === 'frame') {
        queue = queue.then(() => onFrame(obj)).catch(() => {});
        return true;
      }
      if (obj.t === 'viewing') {
        const r = shapeViewing(obj);
        if (!r || r.n !== w.v || w.state !== 'asked') return true;
        unwait();
        if (r.state !== 'on') {
          finish(r.state, false);
          return true;
        }
        w.state = 'on';
        w.until = now() + VIEW_MS;
        w.left = r.left === undefined ? null : r.left;
        expect();
        emit();
        return true;
      }
      if (obj.t === 'unview') {
        const u = shapeUnview(obj);
        if (u && u.v === w.v && w.state !== 'ended')
          finish(u.why === 'closed' || u.why === 'hidden' ? 'gone' : u.why, false);
        return true;
      }
      return false;
    },

    // "Keep watching": at most one a minute. → true when it went out.
    async keep() {
      if (!w || w.state !== 'on' || now() - w.kept < MINUTE) return false;
      let f = null;
      try {
        f = fields(w.peer, w.agent);
      } catch {
        f = null;
      }
      const n = hex16(nonce());
      const msg =
        f && n ? shapeView({ t: 'keep', n, c: f.c, ms: f.ms, v: w.v, id: f.id, to: f.to }) : null;
      const mine = w;
      if (!msg || !(await say(w.peer, msg)) || w !== mine) return false;
      w.kept = now();
      w.until = now() + VIEW_MS;
      expect();
      emit();
      return true;
    },

    // The phone ends it: 'closed' (nothing is kept) or 'hidden' (the page is out of view; the last
    // picture stays with its time).
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
    sessionEnded(peerId) {
      if (w && w.peer === peerId) finish('offline', false);
    },

    // That computer no longer says this phone may watch.
    rightEnded(peerId) {
      if (!w || w.peer !== peerId) return;
      if (w.state !== 'ended') return finish('off', false);
      if (w.pic) {
        w.pic = null;
        emit();
      }
    },
    drop(peerId) {
      if (w && (peerId === undefined || w.peer === peerId)) {
        unwait();
        w = null;
        emit();
      }
    },
    model,

    // waits until every frame that arrived has been read (for tests)
    idle: () => queue,
  };
}
