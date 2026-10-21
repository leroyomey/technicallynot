// Technically Not phone app · link.mjs — the phone's connection to the relay and its encrypted
// sessions with paired computers. The phone's copy of desktop/remote-link.js,
// and it
// must speak the same bytes: tools/phone-link-test.mjs runs it against the desktop file.
//  - No connection while nothing is paired and no pairing is being made (hold()).
//  - Reconnects with backoff and jitter; stops for good when the relay says signed out or replaced.
// - One session per connection per paired computer: the lower device id starts the handshake; a new
// session replaces the live one only once its first encrypted message arrived and decrypted; a
// message that does not decrypt changes nothing; a skipped counter ends the session and both sides
// handshake again.
// - Pairing messages are only carried (sendPair, on.pair): pairing itself is pair.mjs, and it
// stores before this file sees it. What a browser changes, and the two rules that follow from it
// (the same mistakes were found three times):
// 1. Every crypto and store call waits. So everything that touches this file's state runs as one
// task after another on a single queue (`task`): socket messages, timers and the calls from the app
// never run in between each other's steps. A function inside a task never calls `run` again (it
// would wait on itself); a network call is waited for outside the queue.
// 2. The browser's store is NEVER asked while a message is handled. What is paired, and this
// phone's own key, are read into memory by refresh(): when the connection opens, at every hello,
// with every ping (so within half a minute), after this link's own Forget, and whenever the app
// says the store changed (refresh(), fed by keys.mjs's change signal from other open copies). A
// read that fails or hangs leaves memory as it was and is not tried again for a while. Sessions
// follow memory: refresh() ends every session whose pairing is gone or replaced. A message is
// opened first and judged after. Nothing acts on what a handshake message carries:
// only messages after a finished handshake count. The relay's own
// messages (hello, presence, err, bye) are hints about the connection, never content. Nothing in
// this file may log a key or a decrypted message.
import * as noise from './noise.mjs';
import { clean, safeId, steady } from './keys.mjs';

export const V = 1;
const HS_ASK = 0,
  HS_ONE = 1,
  HS_TWO = 2; // first byte of an `hs` body: please start / message 1 / message 2
const MAX_BACKOFF = 5 * 60 * 1000;
const HS_WAIT = 10 * 1000; // no answer to message 1 in this time: try again (with backoff)
const PING_MS = 30 * 1000,
  PONG_WAIT = 10 * 1000; // "ping" is answered by the runtime without waking the relay
const SLOW_RETRY = 30 * 60 * 1000; // remote switched off on the server: look again rarely

// no ticket, no open socket or no hello in this time: give up this try and back off
const CONNECT_WAIT = 30 * 1000;

// a browser's store can hang; one call that never answers must not stop the queue for good
const STORE_WAIT = 10 * 1000;
const STORE_REST = 60 * 1000; // after a read that failed or hung, the store is left alone this long
const ONLINE_MAX = 64; // ids the relay may name as online

// one-time handshake keys remembered per computer: a message 1 seen before is a replay
const SEEN_MAX = 512;
const RESP_BURST = 6,
  RESP_PER_S = 2; // answers to message 1s per computer: a few at once, then two a second
const CANDS_MAX = 4; // answered handshakes waiting for their first message, per computer

// "please start" replaces a session that stands at most once in this time
const ASK_GAP = 10 * 1000;
const backoffOf = tries => Math.min(MAX_BACKOFF, 1000 * 2 ** Math.max(0, tries - 1));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const te = new TextEncoder(),
  td = new TextDecoder('utf-8', { fatal: true });
const toB64 = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = text => {
  try {
    const s = atob(text),
      out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
};
const cat = (a, b) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

// self = { id }: this phone's device id. store = keyStore() from keys.mjs. getTicket() →
// Promise<string>, rejecting with { status, code } when the server refuses. url = "wss://api…" (no
// path), or a function that gives it. name() = this phone's name. now = a clock that never jumps
// (waits and backoff); wall = the time of day (only for "last heard"). on = { state({ connection,
// reason }), peer(id, { online, session, heard }), session(id), message(id, obj), pair(from, obj),
// unreachable(id), update(id) }.
export function createLink({
  self,
  store,
  getTicket,
  url,
  name = () => '',
  on = {},
  WebSocket = globalThis.WebSocket,
  now = steady,
  wall = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
  random = Math.random,
}) {
  let ws = null,
    conn = 'off',
    reason = null,
    attempt = 0,
    retryTimer = null,
    pingTimer = null,
    pongTimer = null,
    stopped = false;
  let mutedUntil = 0,
    bye = null,
    greeted = false,
    opening = 0,
    held = false,
    connTimer = null,
    stops = 0;
  let paired = new Map(),
    myKey = null,
    loaded = false,
    storeRestUntil = 0,
    storeFails = 0; // rule 2: what the store said last
  const online = new Set(),
    peers = new Map();

  // The one queue. `run` gives the caller the result; `task` is for events nobody waits on (their
  // errors end with them).
  let chain = Promise.resolve();
  const run = fn => {
    const r = chain.then(fn);
    chain = r.then(
      () => {},
      () => {}
    );
    return r;
  };
  const task = fn => {
    run(fn).catch(() => {
      /* nothing a socket or a timer brings may stop the link */
    });
  };
  const later = (fn, ms) => timers.set(() => task(fn), ms);

  // Every store call has a time limit. The limit's timer is not a task: it must fire while the
  // queue waits on the store.
  const within = p =>
    new Promise((res, rej) => {
      const h = timers.set(
        () => rej(new Error('phone-link: the store did not answer')),
        STORE_WAIT
      );
      Promise.resolve(p).then(
        v => {
          timers.clear(h);
          res(v);
        },
        e => {
          timers.clear(h);
          rej(e);
        }
      );
    });
  const emit = (ev, ...args) => {
    try {
      on[ev]?.(...args);
    } catch {
      /* a listener's error is not the link's */
    }
  };
  const peer = id => {
    let p = peers.get(id);
    if (!p)
      peers.set(
        id,
        (p = {
          live: null,
          cands: [],
          hs: null,
          hsTimer: null,
          hiTimer: null,
          hsTries: 0,
          hsNext: 0,
          hsLast: 0,
          askTries: 0,
          askTimer: null,
          askAt: -ASK_GAP,
          tok: RESP_BURST,
          tokAt: 0,
          heard: 0,
          seen: new Set(),
        })
      );
    return p;
  };
  const pairingOf = id => paired.get(id) || null; // memory, never the store (rule 2)
  const set = (c, why = null) => {
    if (conn === c && reason === why) return;
    conn = c;
    reason = why;
    emit('state', { connection: c, reason: why });
  };
  const tellPeer = id => {
    const p = peers.get(id);
    emit('peer', id, { online: online.has(id), session: !!p?.live, heard: p?.heard || 0 });
  };
  const wanted = () => !stopped && (held || paired.size > 0);
  const endConnTimer = () => {
    if (connTimer) {
      timers.clear(connTimer);
      connTimer = null;
    }
  };
  const myName = () => String(name() || '').slice(0, 80);

  function dropSession(p) {
    p.live = p.hs = null;
    p.cands = [];
    for (const k of ['hsTimer', 'hiTimer'])
      if (p[k]) {
        timers.clear(p[k]);
        p[k] = null;
      }
  }

  function dropPeer(id) {
    const p = peers.get(id);
    if (!p) return;
    dropSession(p);
    if (p.askTimer) timers.clear(p.askTimer);
    peers.delete(id);
    tellPeer(id);
  }

  // Rule 2. Reads what is paired and this phone's key into memory, then brings every session in
  // line with it: a pairing that is gone ends its sessions, one that was replaced (paired again by
  // another open copy) ends them and a new session is made. False when the store could not be read:
  // memory and sessions stay as they were, and the store is left alone for a while (`force` = the
  // app knows something changed, or this link changed it: read now whatever happened before).
  async function refresh(force) {
    if (!force && now() < storeRestUntil) return false;
    let list, key;
    try {
      list = await within(store.pairings());
      key = list.length ? await within(store.identity()) : null;
    } catch {
      storeRestUntil = now() + STORE_REST;

      // One failed read changes nothing. A second in a row means this link no longer knows what is
      // paired: a computer forgotten in another open copy must not keep its session for as long as
      // the store stays unreadable. So it fails closed: every session ends, memory is
      // emptied, and the connection goes until the store can be read again (open() tries each
      // minute).
      if (++storeFails >= 2 && (loaded || paired.size)) {
        for (const id of [...peers.keys()]) dropPeer(id);
        paired = new Map();
        myKey = null;
        loaded = false;
      }
      return false;
    }
    storeRestUntil = 0;
    storeFails = 0;
    loaded = true;
    myKey = key;
    paired = new Map(list.filter(p => safeId(p.id)).map(p => [p.id, p]));
    const again = [];
    for (const [id, p] of [...peers]) {
      const cur = paired.get(id);
      if (!cur) {
        dropPeer(id);
        continue;
      }
      const stands = s => eq(cur.pub, s.pairing.pub) && eq(cur.pairingId, s.pairing.pairingId);
      p.cands = p.cands.filter(stands);
      if (p.hs && !stands(p.hs)) {
        p.hs = null;
        if (p.hsTimer) {
          timers.clear(p.hsTimer);
          p.hsTimer = null;
        }
        again.push(id);
      }
      if (p.live && !stands(p.live)) {
        p.live = null;
        if (p.hiTimer) {
          timers.clear(p.hiTimer);
          p.hiTimer = null;
        }
        tellPeer(id);
        again.push(id);
      }
    }
    for (const id of new Set(again)) await renew(id);
    return true;
  }

  // ---- the connection ----
  async function open() {
    if (ws || conn === 'connecting' || stopped) return;

    // the first look, and a fresh one when a pairing is about to be made
    if (!loaded || held) await refresh(false);
    if (ws || conn === 'connecting' || stopped) return;

    // The store could not be read, so what is paired is not known: look again in a minute instead
    // of staying off for good.
    if (!loaded && !held) return retry(STORE_REST, 'store');
    if (!wanted()) {
      if (conn === 'waiting') set('off');
      return;
    }
    if (retryTimer) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
    set('connecting');
    const mine = ++opening; // a later open() takes over: only the newest may make the socket

    // A ticket call that never answers, a socket that never opens or a relay that never says hello:
    // this try ends and backs off.
    endConnTimer();
    connTimer = later(() => {
      connTimer = null;
      if (conn !== 'connecting') return;
      opening++;
      return ws ? hangUp(1006) : backoff('timeout');
    }, CONNECT_WAIT);

    // The ticket is a network call: it is waited for outside the queue, so Stop and the rest are
    // not held up by it.
    Promise.resolve()
      .then(getTicket)
      .then(
        ticket => task(() => opened(mine, ticket)),
        e =>
          task(() => {
            if (mine === opening && conn === 'connecting' && !ws) refused(e);
          })
      );
  }

  function opened(mine, ticket) {
    if (mine !== opening || conn !== 'connecting' || ws) return;
    if (!wanted()) {
      endConnTimer();
      return set('off');
    }

    // the address is asked now, not at start: an own relay can be set or changed while the app is
    // open
    const base = typeof url === 'function' ? url() : url;
    const sock = (ws = new WebSocket(
      base + '/remote/connect?ticket=' + encodeURIComponent(ticket)
    ));
    bye = null;
    greeted = false;

    // Nothing the relay sends may throw out of here: it is not trusted. A message waits its turn;
    // by then the socket may be gone.
    sock.onmessage = e => {
      if (ws === sock) task(() => (ws === sock ? incoming(String(e.data)) : undefined));
    };
    sock.onclose = e => {
      task(() => {
        if (ws === sock) closed(e.code, e.reason);
      });
    };
    sock.onerror = () => {
      /* a close follows */
    };
  }

  function retry(ms, why) {
    set('waiting', why);
    if (retryTimer) timers.clear(retryTimer);
    retryTimer = later(() => {
      retryTimer = null;
      return open();
    }, ms);
  }

  // Jitter: half to all of the step, so many devices coming back at once do not arrive together.
  const backoff = why => {
    attempt++;
    retry(backoffOf(attempt) * (0.5 + random() / 2), why);
  };

  function refused(e) {
    endConnTimer();
    const status = e?.status,
      code = e?.code || 'network';
    if (status === 401 || status === 403 || status === 400 || status === 426)
      return set('stopped', code); // signed out, no plan, old app: only resume() tries again
    if (status === 503) return retry(SLOW_RETRY * (0.5 + random() / 2), code);
    if (status === 429) {
      attempt = Math.max(attempt, 7);
      return backoff(code);
    }
    backoff(code);
  }

  function closed(code, text) {
    ws = null;
    endConnTimer();
    for (const t of [pingTimer, pongTimer]) if (t) timers.clear(t);
    pingTimer = pongTimer = null;
    const were = [...online];
    online.clear();
    for (const [id, p] of peers) {
      dropSession(p);
      if (were.includes(id) || p.heard) tellPeer(id);
    }
    const why = bye || text || null;
    if (stopped) return set('off');
    if (code === 4003 || code === 4001)
      return set('stopped', code === 4003 ? 'signed_out' : 'replaced');

    // The own relay threw this phone out (4009) or ended the shared phone key (4010,
    // relay/src/hub.js): the next ticket would only be refused for the same reason.
    if (code === 4009) return set('stopped', 'device_revoked');
    if (code === 4010) return set('stopped', 'phone_key_retired');
    if (!wanted()) return set('off');
    if (code === 4002) return retry(SLOW_RETRY * (0.5 + random() / 2), 'remote_disabled');
    if (code === 4008) attempt = Math.max(attempt, 6);
    backoff(why || 'disconnected');
  }

  // Ends the socket from this side and does not wait for the close to come back (a dead connection
  // may never answer).
  function hangUp(code) {
    const sock = ws;
    if (!sock) return;
    closed(code, '');
    try {
      sock.close();
    } catch {
      /* already gone */
    }
  }

  function ping() {
    pingTimer = later(async () => {
      if (!ws) return;
      try {
        ws.send('ping');
      } catch {
        return hangUp(1006);
      }
      pongTimer = later(() => {
        pongTimer = null;
        return hangUp(1006);
      }, PONG_WAIT);
      ping();

      // rule 2: what another open copy changed is seen within one ping, signal or no signal
      await refresh(false);
      if (!loaded && !held && ws) {
        hangUp(1000);
        return retry(STORE_REST, 'store');
      } // failed closed: back when the store answers
      settle();
    }, PING_MS);
  }
  const post = (to, kind, body, n) => {
    if (!ws || ws.readyState !== 1 || now() < mutedUntil) return false;
    try {
      ws.send(
        JSON.stringify({
          v: V,
          to,
          from: self.id,
          kind,
          ...(n === undefined ? {} : { n }),
          body: toB64(body),
        })
      );
      return true;
    } catch {
      return false;
    }
  };

  function settle() {
    if (wanted()) return;
    if (retryTimer) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
    if (ws) hangUp(1000);
    else if (conn !== 'stopped') set('off');
  }

  async function incoming(text) {
    // Only a pong that answers this link's own ping says the connection is good; one sent unasked
    // must not reset the wait before the next connection try.
    if (text === 'pong') {
      if (pongTimer) {
        timers.clear(pongTimer);
        pongTimer = null;
        attempt = 0;
      }
      return;
    }
    let m = null;
    try {
      m = JSON.parse(text);
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'hello') {
      if (greeted) return;
      greeted = true; // one per socket: a repeated hello must not start more ping timers
      for (const t of [pingTimer, pongTimer]) if (t) timers.clear(t);
      pingTimer = pongTimer = null;
      endConnTimer();
      set('online');
      online.clear();
      ping();
      const sock = ws;
      await refresh(false); // one read for the whole hello, however many devices it names
      if (ws !== sock) return;

      // nothing is paired any more (forgotten in another open copy while this one was away)
      if (!wanted()) return settle();

      // Paired computers first and always, then others up to the list's size: a long list of
      // made-up ids in front cannot hide a real computer. A relay's list is looked through to a
      // fixed length only.
      const named = (Array.isArray(m.online) ? m.online : []).slice(0, 4096).filter(safeId);
      for (const id of named) if (paired.has(id)) online.add(id);
      for (const id of named) if (online.size < ONLINE_MAX) online.add(id);
      for (const id of [...online]) await cameOnline(id);
      return;
    }
    if (m.kind === 'presence' && safeId(m.device)) {
      if (m.online) {
        // The list cannot be filled with made-up ids: past its size only a paired computer is still
        // taken.
        if (online.size >= ONLINE_MAX && !online.has(m.device) && !paired.has(m.device)) return;
        online.add(m.device);
        await cameOnline(m.device);
      } else {
        online.delete(m.device);
        const p = peers.get(m.device);
        if (p) {
          dropSession(p);
          tellPeer(m.device);
        }
      }
      return;
    }
    if (m.kind === 'err') {
      if (m.code === 'rate_limited')
        mutedUntil = now() + Math.min(120, Math.max(1, Number(m.retry) || 60)) * 1000;
      if (m.code === 'offline' && typeof m.to === 'string') {
        online.delete(m.to);
        const p = peers.get(m.to);
        if (p) {
          dropSession(p);
          tellPeer(m.to);
        }

        // a pairing run aimed at a computer that is not connected ends on this, instead of waiting
        // two minutes
        emit('unreachable', m.to);
      }
      return;
    }
    if (m.kind === 'bye') {
      bye = typeof m.reason === 'string' ? m.reason.slice(0, 40) : null;
      return;
    }
    if (
      m.to !== self.id ||
      typeof m.from !== 'string' ||
      !m.from ||
      m.from === self.id ||
      typeof m.body !== 'string'
    )
      return;

    // A higher version than this app knows: say so beside that computer, and do nothing else.
    if (m.v !== V) {
      if (Number.isInteger(m.v) && m.v > V && paired.has(m.from)) emit('update', m.from);
      return;
    }
    const body = fromB64(m.body);
    if (!body) return;
    if (m.kind === 'pair') {
      let obj = null;
      try {
        obj = JSON.parse(td.decode(body));
      } catch {
        return;
      }
      return emit('pair', m.from, obj);
    }
    if (m.kind === 'hs') return onHs(m.from, body);
    if (m.kind === 'msg') return onMsg(m.from, m.n, body);
  }

  // ---- sessions ----
  const prologue = (starter, answerer, pairing) =>
    noise.fields(String(V), starter, answerer, pairing.pairingId);

  async function cameOnline(id) {
    if (!paired.has(id)) return;
    tellPeer(id);

    // the lower device id starts, so two handshakes sent at once cannot cross
    if (self.id < id) await startHs(id);
  }

  async function startHs(id) {
    const pairing = pairingOf(id);
    if (!pairing || !myKey) return;
    const p = peer(id);
    if (!online.has(id) || p.hs || p.hsTimer) return;

    // a quiet five minutes: start from one second again
    if (now() - p.hsLast > MAX_BACKOFF) p.hsTries = 0;
    if (now() < p.hsNext) {
      p.hsTimer = later(() => {
        p.hsTimer = null;
        return startHs(id);
      }, p.hsNext - now());
      return;
    }
    p.hsTries++;
    p.hsLast = now();
    p.hsNext = now() + backoffOf(p.hsTries);

    // The timer runs whatever happens below (not sent, the socket not ready, the browser's crypto
    // failing): it is tried again.
    p.hsTimer = later(() => {
      p.hsTimer = null;
      p.hs = null;
      return startHs(id);
    }, HS_WAIT);
    let hs, m1;
    try {
      hs = await noise.handshake({
        initiator: true,
        s: myKey,
        rs: pairing.pub,
        prologue: prologue(self.id, id, pairing),
      });
      m1 = await hs.write();
    } catch {
      return;
    }
    if (post(id, 'hs', cat(Uint8Array.of(HS_ONE), m1))) p.hs = { hs, pairing, at: now() };
  }

  // The higher device id cannot start; it asks. Unauthenticated, so the answer is only ever a
  // handshake under the paired keys. Asked again, with backoff, while no session came of it (the
  // relay may have dropped the request).
  function askHs(id) {
    if (!paired.has(id)) return;
    const p = peer(id);
    if (p.askTimer) return;
    post(id, 'hs', Uint8Array.of(HS_ASK));
    p.askTimer = later(
      () => {
        p.askTimer = null;
        if (!p.live && !p.cands.length && online.has(id) && paired.has(id)) askHs(id);
      },
      HS_WAIT + backoffOf(++p.askTries)
    );
  }
  const renew = id => (self.id < id ? startHs(id) : askHs(id));

  async function onHs(from, body) {
    const pairing = pairingOf(from);
    if (!pairing || !myKey || !body.length) return;
    const p = peer(from),
      type = body[0],
      data = body.subarray(1);
    if (type === HS_ASK) {
      // the live session, if any, stays until the new one answers; the backoff in startHs bounds
      // how often
      if (!(self.id < from)) return;

      // The first request against a session that stands is taken at once: an honest computer that
      // lost its session must not wait. Further ones within ASK_GAP are not: forged requests would
      // otherwise get a new handshake, and both full lists, every second.
      if (p.live && p.live.hi) {
        if (now() - p.askAt < ASK_GAP) return;
        p.askAt = now();
        p.hsNext = Math.min(p.hsNext, now());
      }

      // an answer may still be on its way: a request must not discard a fresh attempt
      if (p.hs && now() - p.hs.at < 2000) return;
      p.hs = null;
      if (p.hsTimer) {
        timers.clear(p.hsTimer);
        p.hsTimer = null;
      }
      return startHs(from);
    }
    if (type === HS_ONE) {
      if (!(from < self.id)) return;

      // A message 1 seen before is a replay: the paired computer makes a new one-time key for every
      // try. Not answered, moves nothing.
      const once = data.length >= 32 ? toB64(data.subarray(0, 32)) : '';
      if (!once || p.seen.has(once)) return;
      try {
        const hs = await noise.handshake({
          initiator: false,
          s: myKey,
          rs: pairing.pub,
          prologue: prologue(from, self.id, pairing),
        });

        // garbage stops here: nothing below happens for a message 1 that was not made with the
        // paired key
        await hs.read(data);

        // Remembered from the moment it proved genuine, answered or not: sent again, it is a
        // replay.
        p.seen.add(once);
        if (p.seen.size > SEEN_MAX) p.seen.delete(p.seen.values().next().value);

        // Answering has an allowance (a few at once, then two a second) and a few places for
        // answered handshakes that wait for their first message. A waiting one is never pushed out
        // by a newer: it leaves only by age. So old messages the memory above no
        // longer holds can neither make the phone work without end nor take the real one's place.
        const t = now();
        p.tok = Math.min(RESP_BURST, p.tok + (Math.max(0, t - p.tokAt) * RESP_PER_S) / 1000);
        p.tokAt = t;
        p.cands = p.cands.filter(c => t - c.at < 2 * HS_WAIT);

        // not answered: its sender tries again
        if (p.tok < 1 || p.cands.length >= CANDS_MAX) return;
        p.tok -= 1;
        const m2 = await hs.write(),
          k = await hs.split();
        if (post(from, 'hs', cat(Uint8Array.of(HS_TWO), m2)))
          p.cands.push({ send: k.send, recv: k.recv, sendN: 0, recvN: 0, pairing, at: t });
      } catch {
        /* not from the paired computer: nothing changes */
      }
      return;
    }
    if (type === HS_TWO && p.hs) {
      const { hs, pairing: used } = p.hs;

      // An answer that does not open changes nothing (noise.mjs puts the handshake back): the real
      // answer can still come, and the wait timer started with message 1 still runs. Stricter than
      // the desktop file, which starts over.
      let k;
      try {
        await hs.read(data);
        k = await hs.split();
      } catch {
        return;
      }
      if (p.hsTimer) {
        timers.clear(p.hsTimer);
        p.hsTimer = null;
      }
      p.hs = null;
      const mine = (p.live = { send: k.send, recv: k.recv, sendN: 0, recvN: 0, pairing: used });
      await sealTo(from, { t: 'hi', name: myName() });

      // The answerer keeps this session only if that first message reached it; if its answer does
      // not come, start over.
      if (p.hiTimer) timers.clear(p.hiTimer);
      p.hiTimer = later(() => {
        p.hiTimer = null;
        if (p.live === mine && !mine.hi) {
          dropSession(p);
          tellPeer(from);
          return renew(from);
        }
      }, HS_WAIT);
      tellPeer(from);
    }
  }

  async function sealTo(id, obj) {
    const p = peers.get(id),
      s = p?.live;
    if (!s) return false;
    if (s.sendN >= 2 ** 32) {
      dropSession(p);
      await renew(id);
      return false;
    }

    // throws when it does not fit one envelope: the caller splits
    const padded = noise.pad(te.encode(JSON.stringify(obj)));
    const body = await noise.seal(
      s.send,
      s.sendN,
      noise.fields(String(V), self.id, id, s.pairing.pairingId),
      padded
    );
    if (!post(id, 'msg', body, s.sendN)) return false;
    s.sendN++;
    return true;
  }

  async function onMsg(from, n, body) {
    if (!Number.isInteger(n) || n < 0 || !paired.has(from)) return;
    const ad = s => noise.fields(String(V), from, self.id, s.pairing.pairingId);
    const p = peers.get(from);

    // A sealed message from a paired computer this phone has no session with: the two are out of
    // step, so make one (startHs and askHs keep their own waits, so messages made up by the relay
    // cannot hurry them).
    if (!p || (!p.live && !p.cands.length)) return renew(from);

    // A new session waits as a candidate until its first encrypted message proves the other side
    // holds the keys.
    if (n === 0)
      for (const c of [...p.cands].reverse()) {
        const plain = await noise.open(c.recv, 0, ad(c), body);
        if (!plain) continue;
        if (p.hiTimer) {
          timers.clear(p.hiTimer);
          p.hiTimer = null;
        }
        p.live = c;
        p.cands = [];
        c.recvN = 1;
        p.askTries = 0;
        await deliver(from, p, plain);
        await sealTo(from, { t: 'hi', name: myName() });
        tellPeer(from);
        emit('session', from);
        return;
      }
    const s = p.live;
    if (!s) return;
    const plain = await noise.open(s.recv, n, ad(s), body);
    if (!plain) return; // does not decrypt: dropped, nothing changes
    if (n < s.recvN) return; // an old message sent again
    if (n > s.recvN) {
      dropSession(p);
      tellPeer(from);
      return renew(from);
    } // one was lost on the way: this session ends
    s.recvN++;
    await deliver(from, p, plain);
  }

  async function deliver(from, p, padded) {
    let obj = null;
    try {
      obj = JSON.parse(td.decode(noise.unpad(padded)));
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    p.heard = wall();
    if (obj.t !== 'hi') return emit('message', from, obj);

    // The name is taken once, from a session's first message; a later `hi` changes nothing.
    const s = p.live;
    if (!s || s.hi) return;
    s.hi = true;
    if (p.hiTimer) {
      timers.clear(p.hiTimer);
      p.hiTimer = null;
    }
    const peerName = clean(typeof obj.name === 'string' ? obj.name : '', 60),
      known = pairingOf(from);

    // The one store call a message can cause, and only a message that opened under the paired keys:
    // the computer's own new name.
    if (known && known.name !== peerName && now() >= storeRestUntil) {
      known.name = peerName;
      await within(store.rename(from, peerName)).catch(() => {
        storeRestUntil = now() + STORE_REST;
      });
    }
    if (self.id < from) {
      // A session that stands is not a failed try: the wait before the next handshake goes back to
      // its first step, so a computer that leaves and returns a few times is not kept waiting
      // minutes. One second between tries stays.
      p.hsTries = 0;
      p.hsNext = Math.min(p.hsNext, p.hsLast + backoffOf(1));
      tellPeer(from);
      emit('session', from); // the starter's session counts from the answer to its first message
    }
  }

  return {
    start: () => run(open),
    // After a stop for good (signed out, replaced, no plan), or when the app wants to try now
    // instead of waiting. A Stop called after this resume but before the queue reached it wins: the
    // resume then does nothing.
    resume() {
      const at = stops;
      return run(() => {
        if (at !== stops) return;
        stopped = false;
        attempt = 0;
        if (conn === 'stopped' || conn === 'waiting') {
          if (retryTimer) {
            timers.clear(retryTimer);
            retryTimer = null;
          }
          conn = 'off';
          reason = null;
        }
        return open();
      });
    },
    // The socket is closed at once, outside the queue: Stop must work even while a task waits on a
    // store that hangs. What it set outside the queue is set again inside it, because a task queued
    // before may have changed it meanwhile.
    stop() {
      stops++;
      stopped = true;
      held = false;
      opening++;
      try {
        ws?.close();
      } catch {
        /* already gone */
      }
      return run(() => {
        stopped = true;
        held = false;
        endConnTimer();
        if (retryTimer) {
          timers.clear(retryTimer);
          retryTimer = null;
        }
        if (ws) return hangUp(1000);
        set('off');
      });
    },
    // While a computer is being paired there is nothing in the store yet: hold(true) keeps the
    // connection up, hold(false) lets it go.
    hold(yes) {
      const at = stops;
      return run(async () => {
        if (yes && at !== stops) return;
        held = !!yes;
        if (held) return conn === 'stopped' ? undefined : open();
        await refresh(true);
        settle();
      });
    },
    // One pairing message (pair.mjs makes and reads them). True when it left this phone.
    sendPair: (to, obj) => run(() => post(to, 'pair', te.encode(JSON.stringify(obj)))),
    // Sends one object to a paired computer over its live session. False when there is none
    // (offline, or the handshake is not done): nothing queues silently, the caller sends again on
    // the next `session` event. Rejects when the object does not fit one envelope.
    send: (id, obj) => run(() => sealTo(id, obj)),
    // The store changed (keys.mjs's change signal, or the app just paired or forgot something):
    // read it again now and bring the sessions in line. Resolves false when the store could not be
    // read. When it finds something paired and the link is off, the connection is made (another
    // open copy paired the first computer).
    refresh: () =>
      run(async () => {
        const ok = await refresh(true);
        if (wanted()) await open();
        else settle();
        return ok;
      }),
    // Forget a computer on this phone: its entry is deleted, so its next handshake fails whether or
    // not the server helps. The computers known only on its word go with it (keys.mjs remove). The
    // store first: if it refuses, nothing here has changed. Then every session whose computer is no
    // longer stored ends. This is the phone's one Forget.
    forget: id =>
      run(async () => {
        const had = await within(store.remove(id));
        if (!(await refresh(true)))
          for (const pid of [
            id,
            ...[...paired.values()]
              .filter(p => p.how === 'introduced' && p.by === id)
              .map(p => p.id),
          ]) {
            paired.delete(pid);
            dropPeer(pid);
          } // the store took the Forget but cannot be read back: memory follows by hand
        settle();
        return had;
      }),
    // Right after a computer was paired while the connection was already up: starts its first
    // session, which nothing else would do before a reconnect. (The caller refreshes BEFORE it lets
    // the computer know the pairing is done, see app.mjs onPair: a handshake from a computer the
    // link does not know yet is dropped, and the computer then waits ten seconds.) Does nothing
    // when a session or a handshake is already there (the computer may have been quicker).
    ensure: id =>
      run(async () => {
        await refresh(true);
        const p = peers.get(id);
        if (p && (p.live || p.cands.length || p.hs)) return;
        if (paired.has(id)) await renew(id);
      }),
    // Ends the session with that computer and starts a new one, so both send their full lists
    // again.
    restart: id =>
      run(async () => {
        await refresh(true);
        const p = peers.get(id);
        if (p) {
          dropSession(p);
          tellPeer(id);
        }
        if (paired.has(id)) await renew(id);
      }),
    state: () => ({
      connection: conn,
      reason,
      online: [...online],
      sessions: [...peers].filter(([, p]) => p.live).map(([id]) => id),
    }),
    // Resolves when everything asked of the link so far has been worked through (tests wait on it;
    // the app has no need to).
    idle: () => chain,
  };
}
