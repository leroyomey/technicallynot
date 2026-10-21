// Technically Not · remote-preview.js — another computer's Live preview, seen from this one as a
// picture of the page with its address (plan item 43, docs/plans/multi-computer.md list J). The
// target takes the picture with the app's own preview shot path (preview-shot.js, the one behind
// `tnai shot preview`), in a hidden window of its own, so nothing changes on its screen. The
// picture is refreshed only when the watcher asks again. A press on the picture does nothing on
// the target yet.
//
// Messages, each a new type of its own:
// - watcher → target { t: 'pvask', n }
// - target → watcher { t: 'pv', n, state } alone (refused, busy, none: no Live preview page,
//   failed), or { t: 'pv', n, i: 0, parts, url, w, h, size, hash } and { t: 'pv', n, i, data }.
//
// The rules on the target: the service hands an ask over only for a computer whose one "full
// control" switch is on here (rule 13), and `may` is asked again before the shot and before each
// part. 4 asks a minute per computer, one shot at a time for all computers and at least 5 s
// between two shots; the newest ask of a computer takes the place of its waiting one. The picture
// is a JPEG of at most 40 KB (`fitPicture` shrinks it); the address is cut to a page on this
// computer without its query, fragment or sign-in (`pageAddress`). An answer starts only when all
// of its parts fit the link's room now.
//
// The watcher checks the parts against the hash and the JPEG's first and last bytes and hands the
// window base64 text for an <img>; the picture is never decoded in a main process.
//
// Pure Node: the clock, the timers, the right, the shot and the sending are handed in by
// desktop/remote-service.js.
'use strict';
const crypto = require('crypto');
const { pieces, hashOf, PIECE_BYTES } = require('./remote-browse.js');

const PICTURE_MAX = 40 * 1024;
const PARTS_MAX = Math.ceil(PICTURE_MAX / PIECE_BYTES) + 1;
const ASKS_MIN = 4;
const SHOT_GAP_MS = 5000;
const ANSWER_MS = 45 * 1000;
const MINUTE = 60 * 1000;
const SEEN_NS = 32;
const SEEN_MS = 10 * MINUTE;
const URL_MAX = 200;

// Widths and qualities tried in turn until the picture fits.
const WIDTHS = [960, 800, 640, 480, 360];
const QUALITIES = [70, 55, 40];

const hex16 = value => (typeof value === 'string' && /^[0-9a-f]{16}$/.test(value) ? value : '');
const hex64 = value => (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : '');
const size = value => (Number.isInteger(value) && value > 0 && value <= 10000 ? value : 0);

// The address as it may cross: http or https on this computer only, the path kept, the query,
// fragment and any sign-in dropped, at most 200 characters. '' for anything else.
function pageAddress(raw) {
  if (typeof raw !== 'string' || raw.length > 4000) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return '';
  const text = url.protocol + '//' + url.host + url.pathname;
  if (text.length > URL_MAX) return text.slice(0, URL_MAX - 1) + '…';
  for (let at = 0; at < text.length; at++) if (text.charCodeAt(at) < 32) return '';
  return text;
}

// True for the bytes of a whole JPEG: its first three bytes and its last two. Nothing is decoded.
function isJpeg(bytes) {
  return (
    Buffer.isBuffer(bytes) &&
    bytes.length >= 8 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

// encode(width, quality) → a JPEG Buffer of the page at that width (or null). The first that fits
// PICTURE_MAX wins. → { bytes, width } or null.
async function fitPicture(encode, max = PICTURE_MAX) {
  for (const width of WIDTHS)
    for (const quality of QUALITIES) {
      let bytes = null;
      try {
        bytes = await encode(width, quality);
      } catch {
        bytes = null;
      }
      if (isJpeg(bytes) && bytes.length <= max) return { bytes, width };
    }
  return null;
}

// ---------- the target ----------
// may(peerId) → true while that computer's full-control switch is on here. take() → { url,
// bytes: a JPEG, w, h } of the Live preview page shown now, or null when none shows. send(peerId,
// obj) → true when it left. room() → messages the link may still send this minute. onShot(peerId,
// url): for this computer's activity list.
function createPreviewAnswerer({
  now = Date.now,
  may = () => false,
  take = async () => null,
  send = () => false,
  room = () => 0,
  onShot = () => {},
}) {
  const asks = new Map();
  const seen = new Map();
  const jobs = new Map();
  const epochs = new Map();
  let busy = false;
  let stopped = false;
  let lastShot = -Infinity;

  const ask = (fn, ...args) => {
    try {
      return fn(...args);
    } catch {
      return null;
    }
  };
  const allowed = peerId => ask(may, peerId) === true;
  const epochOf = peerId => epochs.get(peerId) || 0;
  const sendOne = (peerId, obj) => {
    try {
      return send(peerId, obj) === true;
    } catch {
      return false;
    }
  };
  const tell = (peerId, n, state) =>
    (Number(ask(room)) || 0) >= 1 && sendOne(peerId, { t: 'pv', n, state });
  const stillGood = job => !stopped && epochOf(job.peerId) === job.epoch && allowed(job.peerId);

  // Counted when it arrives, before anything else. Never throws. → true when taken.
  function receive(peerId, obj) {
    if (stopped || !obj || typeof obj !== 'object' || obj.t !== 'pvask') return false;
    if (typeof peerId !== 'string' || !peerId) return false;
    const t = now();
    const times = (asks.get(peerId) || []).filter(at => t - at < MINUTE);
    if (times.length >= ASKS_MIN) {
      asks.set(peerId, times);
      return false;
    }
    times.push(t);
    asks.set(peerId, times);
    const n = hex16(obj.n);
    if (!n) return false;
    const list = (seen.get(peerId) || []).filter(item => t - item.at < SEEN_MS);
    if (list.some(item => item.n === n)) return false;
    list.push({ n, at: t });
    while (list.length > SEEN_NS) list.shift();
    seen.set(peerId, list);
    if (!allowed(peerId)) return false;
    jobs.delete(peerId);
    jobs.set(peerId, { peerId, n, epoch: epochOf(peerId) });
    pump();
    return true;
  }

  function pump() {
    if (busy || stopped || !jobs.size) return;
    const [peerId, job] = jobs.entries().next().value;
    jobs.delete(peerId);
    busy = true;
    Promise.resolve()
      .then(() => run(job))
      .catch(() => {
        if (stillGood(job)) tell(job.peerId, job.n, 'failed');
      })
      .then(() => {
        busy = false;
        pump();
      });
  }

  async function run(job) {
    if (!stillGood(job)) return;
    if (now() - lastShot < SHOT_GAP_MS) return void tell(job.peerId, job.n, 'busy');
    lastShot = now();
    let shot = null;
    try {
      shot = await take();
    } catch {
      shot = undefined;
    }
    if (!stillGood(job)) return;
    if (shot === null) return void tell(job.peerId, job.n, 'none');
    const url = pageAddress(shot && shot.url);
    const bytes = shot && shot.bytes;
    if (!url || !isJpeg(bytes) || bytes.length > PICTURE_MAX)
      return void tell(job.peerId, job.n, 'failed');
    const list = pieces(bytes);
    const messages = [
      {
        t: 'pv',
        n: job.n,
        i: 0,
        parts: list.length + 1,
        url,
        w: size(shot.w),
        h: size(shot.h),
        size: bytes.length,
        hash: hashOf(bytes),
      },
      ...list.map((data, at) => ({ t: 'pv', n: job.n, i: at + 1, data })),
    ];
    if ((Number(ask(room)) || 0) < messages.length) return void tell(job.peerId, job.n, 'busy');
    for (const message of messages) {
      if (!stillGood(job) || !sendOne(job.peerId, message)) return;
    }
    ask(onShot, job.peerId, url);
  }

  function endFor(peerId) {
    epochs.set(peerId, epochOf(peerId) + 1);
    jobs.delete(peerId);
  }

  function stop() {
    stopped = true;
    jobs.clear();
  }

  return { receive, endFor, stop };
}

// ---------- the watcher ----------
// send(peerId, obj) → true when it left. on.changed(peerId). What is held lives in memory only.
function createPreviewAsker({
  now = Date.now,
  send = () => false,
  random = count => crypto.randomBytes(count),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: handle => clearTimeout(handle) },
  on = {},
}) {
  // peer id → { n, state, at, url, w, h, data, parts, timer }
  const held = new Map();
  const changed = peerId => {
    try {
      on.changed?.(peerId);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const clearWait = entry => {
    if (entry && entry.timer) timers.clear(entry.timer);
    if (entry) entry.timer = null;
  };

  // → { state: 'asked' | 'not_sent' }. The picture held so far stays until the new one arrives.
  function ask(peerId) {
    const n = random(8).toString('hex');
    let ok = false;
    try {
      ok = send(peerId, { t: 'pvask', n }) === true;
    } catch {
      ok = false;
    }
    if (!ok) return { state: 'not_sent' };
    const old = held.get(peerId);
    clearWait(old);
    const entry = {
      n,
      state: 'asked',
      at: now(),
      url: old ? old.url : '',
      w: old ? old.w : 0,
      h: old ? old.h : 0,
      data: old ? old.data : '',
      shotAt: old ? old.shotAt : 0,
      parts: null,
      timer: null,
    };
    held.set(peerId, entry);
    entry.timer = timers.set(() => {
      if (held.get(peerId) !== entry || entry.state !== 'asked') return;
      entry.state = 'no_answer';
      entry.parts = null;
      changed(peerId);
    }, ANSWER_MS);
    changed(peerId);
    return { state: 'asked' };
  }

  const end = (peerId, entry, state) => {
    clearWait(entry);
    entry.state = state;
    entry.parts = null;
    changed(peerId);
    return true;
  };

  // A message of the target: read only for the number this computer asked with.
  function receive(peerId, obj) {
    if (!obj || typeof obj !== 'object' || obj.t !== 'pv') return false;
    const entry = held.get(peerId);
    const n = hex16(obj.n);
    if (!entry || !n || entry.n !== n || entry.state !== 'asked') return false;
    if (typeof obj.state === 'string')
      return end(
        peerId,
        entry,
        ['refused', 'busy', 'none'].includes(obj.state) ? obj.state : 'failed'
      );
    if (obj.i === 0) {
      const parts = Number.isInteger(obj.parts) ? obj.parts : 0;
      const url = pageAddress(obj.url);
      if (parts < 2 || parts > PARTS_MAX || !url || !hex64(obj.hash))
        return end(peerId, entry, 'failed');
      entry.parts = {
        total: parts,
        got: [],
        head: { url, w: size(obj.w), h: size(obj.h), hash: obj.hash, size: obj.size },
      };
      return true;
    }
    if (!entry.parts || obj.i !== entry.parts.got.length + 1) return end(peerId, entry, 'failed');
    if (typeof obj.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(obj.data))
      return end(peerId, entry, 'failed');
    entry.parts.got.push(obj.data);
    if (entry.parts.got.length < entry.parts.total - 1) return true;
    const bytes = Buffer.concat(entry.parts.got.map(data => Buffer.from(data, 'base64')));
    const head = entry.parts.head;
    if (bytes.length > PICTURE_MAX || bytes.length !== head.size || hashOf(bytes) !== head.hash)
      return end(peerId, entry, 'failed');
    if (!isJpeg(bytes)) return end(peerId, entry, 'failed');
    entry.url = head.url;
    entry.w = head.w;
    entry.h = head.h;
    entry.data = bytes.toString('base64');
    entry.shotAt = now();
    return end(peerId, entry, 'shown');
  }

  // For the window: { state, url, w, h, data (base64 of a JPEG, '' none), shotAt } or null.
  function get(peerId) {
    const entry = held.get(peerId);
    if (!entry) return null;
    const { state, url, w, h, data, shotAt } = entry;
    return { state, url, w, h, data, shotAt };
  }

  function drop(peerId) {
    const ids = peerId ? [peerId] : [...held.keys()];
    for (const id of ids) {
      clearWait(held.get(id));
      if (held.delete(id)) changed(id);
    }
  }

  return { ask, receive, get, drop };
}

module.exports = {
  createPreviewAnswerer,
  createPreviewAsker,
  pageAddress,
  isJpeg,
  fitPicture,
  PICTURE_MAX,
  PARTS_MAX,
  ASKS_MIN,
  SHOT_GAP_MS,
  ANSWER_MS,
};
