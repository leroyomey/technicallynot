// Technically Not · remote-files.js — a picture or a text file that goes along with a prompt to an
// agent on another computer.
// Pure Node, no Electron, no file access: the clock, the timers,
// random bytes, the sending, the rights and the day's allowance are handed in. Both sides are here,
// so the sender refuses with the same rules the target holds.
// - What a file may be (`checkFile`): three fixed kinds. A picture is read piece by piece and only
// the pieces the sender's own encoder writes are allowed, with a long side of at most SIDE; nothing
// here decodes a picture. A text is strict UTF-8 without control characters and without characters
// no person can see.
// - The target (`createTaker`): an offer is refused before a byte flows (caps, one open file for
// one computer, the day's allowance, reserved at the offer and read as "all used" when it cannot be
// read). Pieces are taken only for the one open file of that computer, in order; a gap, a piece of
// the wrong size, GAP_MS without one, FILE_MS in all, a new session or the right ending drops the
// file. A finished file (size, SHA-256 and content equal to the offer) waits in memory, never on
// disk, until a prompt names it (`take`: same computer, pairing, panel and ticket, once) or HELD_MS
// passed.
// - The sender (`createSender`): one file at a time, an offer, then pieces at most PIECES_MIN a
// minute and only while the link has room (the gate's line for optional traffic), then the target's
// word. Nothing is resumed or tried again. Messages (remote-api.js shapeOp reads `file` and
// `promptf`; remote-control.js checks them as operations of section 6f): { t: 'file', n, c, ms, id,
// to, f, kind, bytes, parts, sha } an offer; the reply is { t: 'filed', n, ok, state: 'go' } or a
// refusal { t: 'part', f, i, d } piece i of file f: base64 of PIECE bytes (the last one: the rest)
// { t: 'got', f, i, state: 'more' | 'done' | 'failed' } from the target: after every 40th piece,
// and at the end { t: 'promptf', n, c, ms, id, to, text, files: [f, …] } the prompt; the reply is
// the prompt's own `prompted`
'use strict';
const crypto = require('crypto');

// bytes of a file in one message: 4,000 base64 characters, about 4,050 bytes with its fields
const PIECE = 3000;
const KINDS = ['png', 'jpg', 'txt'];
const PICTURE_MAX = 150 * 1024,
  TEXT_MAX = 64 * 1024; // the target's caps for one file, whatever the sender does
const PROMPT_MAX = 300 * 1024,
  PROMPT_FILES = 3; // one prompt
const DAY_MAX = 3 * 1024 * 1024,
  DAY_FILES = 30,
  DAY_MS = 24 * 60 * 60 * 1000; // from one computer in 24 hours
const FILE_MS = 5 * 60 * 1000,
  GAP_MS = 60 * 1000,
  HELD_MS = 10 * 60 * 1000;
const SIDE = 2048; // a picture's long side (an honest sender never passes 1,568)
const ACK_EVERY = 40,
  PIECES_MIN = 40,
  PIECE_GAP_MS = 1500,
  WORD_MS = 30 * 1000;
const HEX16 = /^[0-9a-f]{16}$/,
  HEX64 = /^[0-9a-f]{64}$/,
  B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const capOf = kind =>
  kind === 'txt' ? TEXT_MAX : kind === 'png' || kind === 'jpg' ? PICTURE_MAX : 0;
const partsOf = bytes => Math.ceil(bytes / PIECE);
const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');

// ---- what a file may be: '' when it is one of the three kinds as this app's own sender writes
// them, else a word that says why not ----
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_OK = new Set(['IHDR', 'PLTE', 'tRNS', 'sRGB', 'gAMA', 'pHYs', 'IDAT', 'IEND']);

function checkPng(b) {
  if (b.length < 8 + 25 + 12 || !b.subarray(0, 8).equals(PNG_SIG)) return 'not_picture';
  let o = 8,
    first = true,
    data = false;
  while (o + 12 <= b.length) {
    const len = b.readUInt32BE(o),
      type = b.toString('latin1', o + 4, o + 8),
      end = o + 12 + len;
    if (end > b.length || !PNG_OK.has(type) || (type === 'IHDR') !== first) return 'not_plain';
    if (first) {
      if (len !== 13) return 'not_plain';
      const w = b.readUInt32BE(o + 8),
        h = b.readUInt32BE(o + 12);
      if (w < 1 || h < 1 || w > SIDE || h > SIDE) return 'too_wide';
      first = false;
    }
    if (type === 'IDAT') data = true;

    // nothing after the end
    if (type === 'IEND') return len === 0 && data && end === b.length ? '' : 'not_plain';
    o = end;
  }
  return 'not_plain';
}

// Start, APP0, quantization and Huffman tables, one frame header (baseline or progressive), restart
// interval, scans, end. No other APPn (EXIF, ICC, XMP), no comment, nothing after the end.
function checkJpeg(b) {
  if (b.length < 20 || b[0] !== 0xff || b[1] !== 0xd8) return 'not_picture';
  let o = 2,
    frames = 0,
    scans = 0;
  for (;;) {
    if (o + 2 > b.length || b[o] !== 0xff) return 'not_plain';
    const m = b[o + 1];
    if (m === 0xd9) return frames === 1 && scans >= 1 && o + 2 === b.length ? '' : 'not_plain';
    if (o + 4 > b.length) return 'not_plain';
    const len = b.readUInt16BE(o + 2),
      end = o + 2 + len;
    if (len < 2 || end > b.length) return 'not_plain';
    if (m === 0xc0 || m === 0xc2) {
      if (++frames > 1 || len < 8) return 'not_plain';
      const h = b.readUInt16BE(o + 5),
        w = b.readUInt16BE(o + 7);
      if (w < 1 || h < 1 || w > SIDE || h > SIDE) return 'too_wide';
    } else if (m === 0xda) {
      if (frames !== 1) return 'not_plain';
      scans++;
      o = end;

      // The scan's own bytes run to the next marker; FF 00 and the restart marks are part of them.
      while (o + 1 < b.length) {
        if (b[o] !== 0xff) {
          o++;
          continue;
        }
        const x = b[o + 1];
        if (x === 0x00 || (x >= 0xd0 && x <= 0xd7)) {
          o += 2;
          continue;
        }
        if (x === 0xff) {
          o++;
          continue;
        }
        break;
      }
      continue;
    } else if (m !== 0xe0 && m !== 0xdb && m !== 0xc4 && m !== 0xdd) return 'not_plain';
    o = end;
  }
}

// Strict UTF-8; a byte-order mark only at the very start; no control character but tab and the line
// ends; and nothing a person cannot see: no tag character, no direction override or isolate, no
// other format character except the two zero-width joiners.
function checkText(b) {
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(b);
  } catch {
    return 'not_text';
  }
  const body = s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
  if (!body.trim()) return 'empty';
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(body)) return 'not_text';
  if (/[\u{E0000}-\u{E007F}]/u.test(body) || /(?![\u200c\u200d])\p{Cf}/u.test(body))
    return 'hidden';
  return '';
}

function checkFile(kind, buf) {
  if (!KINDS.includes(kind) || !Buffer.isBuffer(buf) || !buf.length) return 'kind';
  if (buf.length > capOf(kind)) return 'too_big';
  return kind === 'png' ? checkPng(buf) : kind === 'jpg' ? checkJpeg(buf) : checkText(buf);
}

// What the kinds are called where a person reads them.
const wordOf = kind => (kind === 'txt' ? 'text file' : 'picture');
const sizeOf = bytes => (bytes >= 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' bytes');

// ---- the three messages that are not operations, field by field (form only) ----
const hex16 = v => (typeof v === 'string' && HEX16.test(v) ? v : '');

// An offer's own fields, read from a message remote-api.js shapeOp let through. → { f, kind, bytes,
// parts, sha } or null.
function offerOf(m) {
  if (!m || typeof m !== 'object') return null;
  const f = hex16(m.f),
    kind = typeof m.kind === 'string' && KINDS.includes(m.kind) ? m.kind : '';
  if (
    !f ||
    !kind ||
    !Number.isInteger(m.bytes) ||
    m.bytes < 1 ||
    m.bytes > capOf(kind) ||
    m.parts !== partsOf(m.bytes) ||
    typeof m.sha !== 'string' ||
    !HEX64.test(m.sha)
  )
    return null;
  return { f, kind, bytes: m.bytes, parts: m.parts, sha: m.sha };
}

function shapePart(m) {
  if (!m || typeof m !== 'object') return null;
  const f = hex16(m.f);
  if (
    !f ||
    !Number.isInteger(m.i) ||
    m.i < 0 ||
    m.i >= partsOf(PICTURE_MAX) ||
    typeof m.d !== 'string' ||
    !m.d ||
    m.d.length > 4000 ||
    m.d.length % 4 !== 0 ||
    !B64.test(m.d)
  )
    return null;
  return { t: 'part', f, i: m.i, d: m.d };
}

function shapeGot(m) {
  if (!m || typeof m !== 'object') return null;
  const f = hex16(m.f);
  if (!f || !Number.isInteger(m.i) || m.i < 0 || m.i > partsOf(PICTURE_MAX)) return null;
  return {
    t: 'got',
    f,
    i: m.i,
    state: m.state === 'more' || m.state === 'done' ? m.state : 'failed',
  }; // an unknown word reads as the one that ends it
}

// The ids a `promptf` names: one to three different ones, or null.
const idsOf = v =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= PROMPT_FILES &&
  v.every(hex16) &&
  new Set(v).size === v.length
    ? [...v]
    : null;

// ---- the target ----
// send(peerId, obj) → the link's gate. allowance { read() → { peerId: [[when, bytes], …] },
// write(map) } (the key store's blob, beside the watching minutes; a throw or a wrong shape reads
// as "all used"). on.changed() → something the window may show changed.
function createTaker({
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
  send = () => false,
  allowance = null,
} = {}) {
  // peer id → { open: the one file on its way or null, done: Map f → a finished file that waits for
  // its prompt }
  const peers = new Map();
  let stopped = false;
  const peer = id => {
    let p = peers.get(id);
    if (!p) peers.set(id, (p = { open: null, done: new Map() }));
    return p;
  };
  const say = (peerId, f, i, state) => {
    try {
      send(peerId, { t: 'got', f, i, state });
    } catch {
      /* no session: nothing queues */
    }
  };
  const unwait = x => {
    if (x && x.timer) {
      timers.clear(x.timer);
      x.timer = null;
    }
  };

  // The day's allowance: what was reserved in the last 24 hours. An entry dated in the future
  // counts. Not readable: all used.
  function used(peerId, t) {
    let map;
    try {
      map = allowance.read();
    } catch {
      return null;
    }
    if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
    const list = Object.hasOwn(map, peerId) ? map[peerId] : [];
    if (
      !Array.isArray(list) ||
      !list.every(
        e => Array.isArray(e) && Number.isFinite(e[0]) && Number.isInteger(e[1]) && e[1] > 0
      )
    )
      return null;
    const kept = list.filter(e => t - e[0] < DAY_MS);
    return { map, kept, bytes: kept.reduce((n, e) => n + e[1], 0), files: kept.length };
  }
  const heldBytes = p => [...p.done.values()].reduce((n, x) => n + x.data.length, 0);

  function fail(peerId, p, tell) {
    const o = p.open;
    if (!o) return;
    unwait(o);
    p.open = null;
    o.chunks = null;
    if (tell) say(peerId, o.f, o.next, 'failed');
  }
  const wait = (peerId, p, o) => {
    unwait(o);
    const left = Math.min(GAP_MS, o.at + FILE_MS - now());
    o.timer = timers.set(
      () => {
        o.timer = null;
        if (p.open === o) fail(peerId, p, true);
      },
      Math.max(0, left)
    );
  };

  return {
    // An offer that passed the operation's own checks (remote-control.js: the right, the count, the
    // one-time number, freshness, the ticket). guard() → true while all of that still holds. → 'go'
    // or 'refused'. Nothing is kept for a refused one.
    offer({ peerId, pairing, panelId, ticket, msg, guard }) {
      const o = offerOf(msg),
        t = now();
      if (
        stopped ||
        !o ||
        typeof peerId !== 'string' ||
        !peerId ||
        !pairing ||
        !panelId ||
        !ticket ||
        typeof guard !== 'function' ||
        !allowance
      )
        return 'refused';
      const p = peer(peerId);
      if (
        p.open ||
        p.done.has(o.f) ||
        p.done.size >= PROMPT_FILES ||
        heldBytes(p) + o.bytes > PROMPT_MAX
      )
        return 'refused';
      const day = used(peerId, t);
      if (!day || day.files + 1 > DAY_FILES || day.bytes + o.bytes > DAY_MAX) return 'refused';

      // Reserved before a byte flows, and written: an allowance that cannot be written gives
      // nothing.
      try {
        allowance.write({ ...day.map, [peerId]: [...day.kept, [t, o.bytes]] });
      } catch {
        return 'refused';
      }
      const x = (p.open = {
        ...o,
        pairing,
        panelId,
        ticket,
        guard,
        at: t,
        next: 0,
        size: 0,
        chunks: [],
        timer: null,
      });
      wait(peerId, p, x);
      return 'go';
    },
    // A piece. Only for the one open file of that computer, only the next one, only of the size the
    // offer makes it.
    part(peerId, raw) {
      const p = peers.get(peerId),
        o = p && p.open,
        m = o ? shapePart(raw) : null;

      // no open file, or not its piece: dropped before any work
      if (stopped || !o || !m || m.f !== o.f) return;
      let ok = false;
      try {
        ok = o.guard() === true;
      } catch {
        /* the right cannot be asked: it ended */
      }
      if (!ok) return fail(peerId, p, false);
      const buf = m.i === o.next && now() - o.at < FILE_MS ? Buffer.from(m.d, 'base64') : null,
        want = o.next === o.parts - 1 ? o.bytes - PIECE * (o.parts - 1) : PIECE;
      if (!buf || buf.length !== want) return fail(peerId, p, true);
      o.chunks.push(buf);
      o.size += buf.length;
      o.next++;
      if (o.next < o.parts) {
        wait(peerId, p, o);
        if (o.next % ACK_EVERY === 0) say(peerId, o.f, o.next, 'more');
        return;
      }

      // The last piece: the whole file against the offer, then its content.
      const data = Buffer.concat(o.chunks);
      unwait(o);
      p.open = null;
      o.chunks = null;
      if (data.length !== o.bytes || sha(data) !== o.sha || checkFile(o.kind, data) !== '')
        return say(peerId, o.f, o.next, 'failed');
      const d = {
        f: o.f,
        kind: o.kind,
        data,
        pairing: o.pairing,
        panelId: o.panelId,
        ticket: o.ticket,
        at: now(),
        timer: null,
      };
      d.timer = timers.set(() => {
        d.timer = null;
        if (p.done.get(d.f) === d) p.done.delete(d.f);
      }, HELD_MS);
      p.done.set(d.f, d);
      say(peerId, o.f, o.next, 'done');
    },
    // A prompt names its files. All of them or none: finished, of that computer, pairing, panel and
    // ticket. They leave this object: each is used once. → [{ kind, data }] in the order named, or
    // null.
    take({ peerId, pairing, panelId, ticket, ids }) {
      const p = peers.get(peerId),
        list = idsOf(ids);
      if (stopped || !p || !list) return null;
      const found = list.map(f => p.done.get(f));
      if (
        !found.every(
          d =>
            d &&
            d.pairing === pairing &&
            d.panelId === panelId &&
            d.ticket === ticket &&
            now() - d.at < HELD_MS
        )
      )
        return null;
      if (found.reduce((n, d) => n + d.data.length, 0) > PROMPT_MAX) return null;
      for (const d of found) {
        unwait(d);
        p.done.delete(d.f);
      }
      return found.map(d => ({ kind: d.kind, data: d.data }));
    },
    // That computer's right ended, its session ended or was replaced, the pairing or the account
    // changed: nothing of it stays.
    dropAll(peerId) {
      const p = peers.get(peerId);
      if (!p) return;
      fail(peerId, p, false);
      for (const d of p.done.values()) unwait(d);
      peers.delete(peerId);
    },
    holding: () => [...peers].map(([id, p]) => ({ peer: id, open: !!p.open, done: p.done.size })),
    stop() {
      stopped = true;
      for (const id of [...peers.keys()]) this.dropAll(id);
    },
  };
}

// ---- the sender ----
// send(peerId, obj) → the link's gate; room() → how many more optional messages the link takes this
// minute (pieces only go while > 0). offer(peerId, agentId, fill, onWord) → { state: 'asked' | …, n
// }: the operation `file` through remote-api.js; onWord(word) once. on.changed(progress | null): {
// peer, agent, file, files, piece, pieces } while files travel.
function createSender({
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
  random = crypto.randomBytes,
  send = () => false,
  room = () => 0,
  offer = () => ({ state: 'not_sent' }),
  on = {},
} = {}) {
  // one at a time for this computer: { peerId, agentId, files, at: index, f, i, sentAt: [], timer,
  // wordTimer, resolve, ids }
  let job = null;
  const tell = () => {
    try {
      on.changed?.(
        job
          ? {
              peer: job.peerId,
              agent: job.agentId,
              file: job.at + 1,
              files: job.files.length,
              piece: job.i,
              pieces: job.files[job.at] ? partsOf(job.files[job.at].data.length) : 0,
            }
          : null
      );
    } catch {
      /* a listener's error is not ours */
    }
  };

  function finish(result) {
    const j = job;
    if (!j) return;
    job = null;
    if (j.timer) timers.clear(j.timer);
    if (j.wordTimer) timers.clear(j.wordTimer);
    tell();
    j.resolve(result);
  }
  const waitWord = () => {
    if (job.wordTimer) timers.clear(job.wordTimer);
    const j = job;
    j.wordTimer = timers.set(() => {
      j.wordTimer = null;
      if (job === j) finish({ ok: false, why: 'no_reply' });
    }, WORD_MS);
  };

  function pump() {
    const j = job;
    if (!j) return;
    j.timer = null;
    const file = j.files[j.at],
      parts = partsOf(file.data.length),
      t = now();
    j.sentAt = j.sentAt.filter(x => t - x < 60000);
    let free = 0;
    try {
      free = room();
    } catch {
      /* no room known: wait */
    }
    if (j.sentAt.length < PIECES_MIN && free > 0) {
      let ok = false;
      try {
        ok =
          send(j.peerId, {
            t: 'part',
            f: j.f,
            i: j.i,
            d: file.data.subarray(j.i * PIECE, (j.i + 1) * PIECE).toString('base64'),
          }) === true;
      } catch {
        /* no session */
      }

      // no session: nothing queues, nothing is resumed
      if (!ok) return finish({ ok: false, why: 'not_sent' });
      j.sentAt.push(t);
      j.i++;
      tell();
      if (j.i >= parts) return waitWord(); // the target's `done` for this file comes next
    }
    j.timer = timers.set(pump, PIECE_GAP_MS);
  }

  function next() {
    const j = job;
    if (!j) return;
    if (j.at >= j.files.length) return finish({ ok: true, ids: j.ids });
    const file = j.files[j.at];
    let f = '';
    try {
      f = Buffer.from(random(8)).toString('hex');
    } catch {
      /* no id, nothing sent */
    }
    if (!hex16(f)) return finish({ ok: false, why: 'not_sent' });
    j.f = f;
    j.i = 0;
    tell();
    let r = null;
    try {
      r = offer(
        j.peerId,
        j.agentId,
        {
          f,
          kind: file.kind,
          bytes: file.data.length,
          parts: partsOf(file.data.length),
          sha: sha(file.data),
        },
        word => {
          if (job !== j || j.f !== f || j.i !== 0 || j.going) return;
          if (j.wordTimer) {
            timers.clear(j.wordTimer);
            j.wordTimer = null;
          }
          if (word !== 'go')
            return finish({ ok: false, why: word === 'no_reply' ? 'no_reply' : 'refused' });
          j.going = true;
          pump();
        }
      );
    } catch {
      /* not offered */
    }
    if (!r || r.state !== 'asked') return finish({ ok: false, why: 'not_sent' });
    j.going = false;
    waitWord();
  }
  return {
    // files: [{ kind, data: Buffer }], already checked with checkFile. → a promise of { ok: true,
    // ids } (every file is finished on the target and waits there for the prompt that names these
    // ids) or { ok: false, why: 'busy' | 'not_sent' | 'refused' | 'no_reply' | 'failed' | 'stopped'
    // }.
    sendFiles(peerId, agentId, files) {
      if (job) return Promise.resolve({ ok: false, why: 'busy' });
      return new Promise(resolve => {
        job = {
          peerId,
          agentId,
          files,
          at: 0,
          f: '',
          i: 0,
          sentAt: [],
          timer: null,
          wordTimer: null,
          going: false,
          resolve,
          ids: [],
        };
        next();
      });
    },
    // The target's word on pieces. Read only for the file on its way to that computer.
    receive(from, raw) {
      const j = job,
        m = j && from === j.peerId ? shapeGot(raw) : null;
      if (!m || m.f !== j.f || !j.going) return;
      if (m.state === 'failed') return finish({ ok: false, why: 'failed' });

      // 'more': it is being taken
      if (m.state !== 'done' || j.i < partsOf(j.files[j.at].data.length)) return;
      if (j.wordTimer) {
        timers.clear(j.wordTimer);
        j.wordTimer = null;
      }
      j.ids.push(j.f);
      j.at++;
      j.going = false;
      next();
    },
    // The user stopped it, the session ended, or the app closes. The target clears its side by its
    // own clock.
    stop(peerId) {
      if (job && (!peerId || job.peerId === peerId)) finish({ ok: false, why: 'stopped' });
    },
    sending: () => !!job,
  };
}

module.exports = {
  createTaker,
  createSender,
  checkFile,
  checkPng,
  checkJpeg,
  checkText,
  offerOf,
  shapePart,
  shapeGot,
  idsOf,
  wordOf,
  sizeOf,
  capOf,
  partsOf,
  PIECE,
  KINDS,
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
  ACK_EVERY,
  PIECES_MIN,
};
