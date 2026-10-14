// Technically Not · remote-link.js — this computer's connection to the relay and its encrypted
// sessions with paired computers. Pure Node: the
// ticket call, the WebSocket class, the clock and the timers are handed in, so it runs in tests as
// it runs in the app.
// - No connection at all while nothing is paired and no pairing is in progress (section 2.5),
// unless the caller passes `hear` (the app does since 2026-10-06, so another computer of the
// account can ask this one to pair).
// - Reconnects with backoff and jitter, never in a tight loop; stops for good when the relay says
// signed out or replaced.
// - One session per connection per paired computer: the lower device id starts the handshake; a new
// session replaces the live one only once its first encrypted message arrived and decrypted; a
// message that does not decrypt changes nothing; a skipped counter ends the session and both sides
// handshake again (section 5.3).
// - Pairing messages are carried for remote-keys.js; a pairing is stored only after the first
// session under its keys worked. The relay's own messages (hello, presence, err, bye) are hints
// about the connection, never content. Nothing in this file may log a key, a code or a decrypted
// message.
const noise = require('./remote-noise.js');
const keys = require('./remote-keys.js');

const V = 1;
const HS_ASK = 0,
  HS_ONE = 1,
  HS_TWO = 2; // first byte of an `hs` body: please start / message 1 / message 2
const MAX_BACKOFF = 5 * 60 * 1000;
const HS_WAIT = 10 * 1000; // no answer to message 1 in this time: try again (with backoff)
const PING_MS = 30 * 1000,
  PONG_WAIT = 10 * 1000; // "ping" is answered by the runtime without waking the relay

// a confirmed session that lived this long resets the starter's wait
const GOOD_SESSION = 60 * 1000;

// a connection try with no ticket or no hello in this time is given up and tried again
const OPEN_WAIT = 30 * 1000;
const SLOW_RETRY = 30 * 60 * 1000; // remote switched off on the server: look again rarely

// after a wake (sleep ended, the network came back) the link looks at once, at most this often
const WAKE_MS = 10 * 1000;

// a wake makes the backoff's steps short again at most this often (a network that comes and goes)
const EASE_MS = 60 * 1000;

// closed because the computer is going to sleep: if no wake is ever told, the link looks again
// after this
const NAP_MS = 30 * 1000;
const backoffOf = tries => Math.min(MAX_BACKOFF, 1000 * 2 ** Math.max(0, tries - 1));

// self = { id }: this computer's device id. store = keyStore() from remote-keys.js. getTicket() →
// Promise<string>, rejecting with { status, code } when the server refuses. url = "wss://api…" (no
// path). name() = this computer's name as the user set it. mayRename(id) → false while that
// computer's new name must not be taken (its pairing is paused, or its own ask is open). on = {
// state({ connection, reason }), peer(id, { online, session, heard }), session(id), message(id,
// obj), paired(id, name), pairing({ role, state, shows, reason, peer }), update(id) }.
function createLink({
  self,
  store,
  getTicket,
  url,
  name = () => '',
  mayRename = () => true,
  // true on a relay where anyone holding its secret can pick any device id (the user's own relay):
  // "not shown again for five minutes" then counts for every id, not per id
  freeIds = () => false,
  on = {},
  WebSocket = globalThis.WebSocket,
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
  random = Math.random,
  guard = keys.pairingGuard(now),
  hear = false,
}) {
  let ws = null,
    conn = 'off',
    reason = null,
    attempt = 0,
    retryTimer = null,
    pingTimer = null,
    pongTimer = null,
    openTimer = null,
    stopped = false;

  // when a wake last made the backoff's steps short again: at most once a minute (EASE_MS)
  let easedAt = -Infinity;
  let held = false,
    // held: the wait that runs was asked for by the server (remote switched off there, too many
    // tries), so a wake does not cut it short
    wokeAt = -Infinity;
  let mutedUntil = 0,
    run = null,
    runRole = null,
    runTimer = null,
    startPending = false,
    bye = null,
    runNote = null,
    greeted = false,
    opening = 0;

  // A computer of this account pressed Pair for this one while it was not in pairing mode: its
  // first message is kept for the user to answer (acceptAsked / declineAsked), one at a time, for
  // as long as that computer's own attempt can still be alive. Nothing is sent back and no pairing
  // mode starts until the user accepts at this computer (before it, such
  // a message was dropped). A computer that was told "Not now", or whose request ran out
  // unanswered, is not shown again for QUIET_MS: one device of the account cannot keep the one
  // slot, or keep a dialog and a notice coming back (security review of this change, 2026-10-06,
  // findings 1 and 2).
  let wish = null,
    wishTimer = null;
  const QUIET_MS = 5 * 60000,
    quiet = new Map(); // device id -> not shown again before this time
  let quietAll = 0; // with free ids: no request from anybody is shown before this time
  const hush = id => {
    if (freeIds()) quietAll = now() + QUIET_MS;
    quiet.delete(id);
    quiet.set(id, now() + QUIET_MS);
    if (quiet.size > 32) quiet.delete(quiet.keys().next().value);
  };
  const clearWish = () => {
    if (wishTimer) {
      timers.clear(wishTimer);
      wishTimer = null;
    }
    if (wish) {
      wish = null;
      emit('asked', null);
    }
  };

  function pairAsked(from, body) {
    if (!keys.safeId(from) || body.length > 512) return;
    let msg = null;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch {
      return;
    }

    // Only the message that starts a pairing asks, and only a well-formed one (32 bytes), so Pair
    // never starts a run on a message it would refuse.
    if (
      !msg ||
      msg.t !== 'commit' ||
      typeof msg.c !== 'string' ||
      msg.c.length > 64 ||
      Buffer.from(msg.c, 'base64').length !== 32
    )
      return;
    if (guard.lockedUntil(from)) return; // locked after wrong codes: it cannot ask either
    if ((quiet.get(from) || 0) > now()) return;

    // Where ids are free, a new id is no new computer: one unanswered request quiets them all.
    if (freeIds() && quietAll > now()) return;

    // One request at a time. The same computer asking again (Pair pressed again there) replaces its
    // message, never its time: the slot frees two minutes after the first one whatever it sends.
    if (wish) {
      if (wish.from === from) wish.msg = msg;
      return;
    }
    wish = { from, msg, at: now() };
    wishTimer = timers.set(() => {
      wishTimer = null;
      if (wish) hush(wish.from);
      clearWish();
    }, keys.PAIR_MS);
    emit('asked', from);
  }

  // devices the relay says are connected: at most this many are kept
  const ONLINE_MAX = 64;
  const online = new Set(),
    peers = new Map();
  const me = () => store.identity(); // read each time: Stop remote everywhere makes a new key
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
          cand: null,
          hs: null,
          hsTimer: null,
          hiTimer: null,
          hsTries: 0,
          hsNext: 0,
          hsLast: 0,
          respTries: 0,
          respNext: 0,
          respLast: 0,
          askTries: 0,
          askTimer: null,
          prov: null,
          provTimer: null,
          heard: 0,
        })
      );
    return p;
  };
  const pairingOf = id => peers.get(id)?.prov || store.pairing(id);
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
  const runAlive = () => !!run && run.state !== 'ended';

  // hear (the app passes it): this computer stays connected while remote is on even with nothing
  // paired, so another computer of the account can ask it to pair. The
  // socket hibernates on the relay like every other.
  const wanted = () =>
    !stopped &&
    (hear || runAlive() || store.pairings().length > 0 || [...peers.values()].some(p => p.prov));

  // ---- the connection ----
  async function open() {
    if (ws || conn === 'connecting' || !wanted()) return;
    if (retryTimer) {
      timers.clear(retryTimer);
      retryTimer = null;
    }
    set('connecting');

    // a later open() (pairing cancelled and started again meanwhile) takes over: only the newest
    // may make the socket
    const mine = ++opening;
    clearOpen();
    openTimer = timers.set(() => {
      openTimer = null;
      if (mine !== opening || conn !== 'connecting') return;
      if (ws) hangUp(1006);
      else {
        opening++;
        backoff('timeout');
      } // opening++: a ticket that still arrives later is not used
    }, OPEN_WAIT);
    let ticket;
    try {
      ticket = await getTicket();
    } catch (e) {
      return mine === opening ? refused(e) : undefined;
    }
    if (mine !== opening || conn !== 'connecting' || ws) return;
    if (!wanted()) return set('off');
    const sock = (ws = new WebSocket(url + '/remote/connect?ticket=' + encodeURIComponent(ticket)));
    bye = null;
    greeted = false;

    // Nothing the relay sends may throw out of here: it is not trusted.
    sock.onmessage = e => {
      if (ws === sock) {
        try {
          incoming(String(e.data));
        } catch {
          /* dropped */
        }
      }
    };
    sock.onclose = e => {
      if (ws === sock) closed(e.code, e.reason);
    };
    sock.onerror = () => {
      /* a close follows */
    };
  }
  const clearOpen = () => {
    if (openTimer) {
      timers.clear(openTimer);
      openTimer = null;
    }
  };

  function retry(ms, why, asked = false) {
    held = asked;
    set('waiting', why);
    if (retryTimer) timers.clear(retryTimer);
    retryTimer = timers.set(() => {
      retryTimer = null;
      open();
    }, ms);
  }

  // Jitter: half to all of the step, so many computers coming back at once do not arrive together.
  const backoff = why => {
    attempt++;
    retry(backoffOf(attempt) * (0.5 + random() / 2), why);
  };

  function refused(e) {
    clearOpen();
    const status = e?.status,
      code = e?.code || 'network';
    if (status === 401 || status === 403 || status === 400 || status === 426)
      return set('stopped', code); // signed out, no plan, old app: only resume() tries again
    if (status === 503) return retry(SLOW_RETRY * (0.5 + random() / 2), code, true);
    if (status === 429) {
      attempt = Math.max(attempt, 7);
      backoff(code);
      held = true;
      return;
    }
    backoff(code);
  }

  function closed(code, text) {
    ws = null;
    clearOpen();
    for (const t of [pingTimer, pongTimer]) if (t) timers.clear(t);
    pingTimer = pongTimer = null;
    const were = [...online];
    online.clear();
    for (const [id, p] of peers) {
      dropSession(p);
      if (were.includes(id) || p.heard) tellPeer(id);
    }
    if (run && run.state !== 'ended' && run.state !== 'done') {
      run.cancel();
      pairingChanged();
    } // its messages may be lost: the user presses Pair again
    startPending = false;
    const why = bye || text || null;
    if (stopped) return set('off');
    if (code === 4003 || code === 4001)
      return set('stopped', code === 4003 ? 'signed_out' : 'replaced');
    if (!wanted()) return set('off');
    if (code === 4002) return retry(SLOW_RETRY * (0.5 + random() / 2), 'remote_disabled', true);
    if (code === 4008) attempt = Math.max(attempt, 6);
    backoff(why || 'disconnected');
    if (code === 4008) held = true;
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
    pingTimer = timers.set(() => {
      if (!ws) return;
      try {
        ws.send('ping');
      } catch {
        return hangUp(1006);
      }
      if (!pongTimer)
        pongTimer = timers.set(() => {
          pongTimer = null;
          hangUp(1006);

          // one wait at a time: an answer already awaited (wake) keeps its own, earlier end
        }, PONG_WAIT);
      ping();
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
          body: body.toString('base64'),
        })
      );
      return true;
    } catch {
      return false;
    }
  };
  const settle = () => {
    if (!wanted()) {
      if (retryTimer) {
        timers.clear(retryTimer);
        retryTimer = null;
      }
      if (ws) hangUp(1000);
      else if (conn !== 'stopped') set('off');
    }
  };

  function incoming(text) {
    if (text === 'pong') {
      if (pongTimer) {
        timers.clear(pongTimer);
        pongTimer = null;
      }
      attempt = 0;
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
      clearOpen();
      for (const t of [pingTimer, pongTimer]) if (t) timers.clear(t);
      pingTimer = pongTimer = null;
      set('online');
      online.clear();

      // The relay is not trusted with this list (it may be the user's own, or an address someone
      // gave them): ids of the right shape only, and a bounded number.
      for (const id of Array.isArray(m.online) ? m.online : [])
        if (keys.safeId(id) && online.size < ONLINE_MAX) online.add(id);
      ping();
      for (const id of online) cameOnline(id);
      if (startPending) {
        startPending = false;
        sendStart();
      }
      return;
    }
    if (m.kind === 'presence' && keys.safeId(m.device)) {
      if (m.online) {
        if (!online.has(m.device) && online.size >= ONLINE_MAX) return;
        online.add(m.device);
        cameOnline(m.device);
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

        // Pair pressed for a computer that is not connected (it must be put into pairing mode
        // first): say so instead of waiting two minutes.
        if (runAlive() && run.state !== 'done' && run.peer === m.to) {
          run.cancel();
          runNote = 'offline';
          pairingChanged();
        }
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

    // A higher version than this app knows: say so beside that computer on the Devices page, and do
    // nothing else (section 3).
    if (m.v !== V) {
      if (Number.isInteger(m.v) && m.v > V && store.pairing(m.from)) emit('update', m.from);
      return;
    }
    const body = Buffer.from(m.body, 'base64');
    if (m.kind === 'pair') return onPair(m.from, body);
    if (m.kind === 'hs') return onHs(m.from, body);
    if (m.kind === 'msg') return onMsg(m.from, m.n, body);
  }

  // ---- sessions ----
  const prologue = (starter, answerer, pairing) =>
    noise.fields(String(V), starter, answerer, pairing.pairingId);

  function dropSession(p) {
    p.live = p.cand = p.hs = null;
    for (const k of ['hsTimer', 'hiTimer'])
      if (p[k]) {
        timers.clear(p[k]);
        p[k] = null;
      }
  }

  function cameOnline(id) {
    if (!pairingOf(id)) return;
    tellPeer(id);

    // the lower device id starts, so two handshakes sent at once cannot cross
    if (self.id < id) startHs(id);
  }

  function startHs(id) {
    const p = peer(id),
      pairing = pairingOf(id);
    if (!pairing || !online.has(id) || p.hs || p.hsTimer) return;

    // a quiet five minutes: start from one second again
    if (now() - p.hsLast > MAX_BACKOFF) p.hsTries = 0;

    // The last session was confirmed and lived a minute or more: an honest return, no wait. One
    // that ended sooner keeps the backoff, so nobody can force a handshake and a full resend every
    // second by making a computer seem to leave and return.
    if (p.confirmedAt && now() - p.confirmedAt >= GOOD_SESSION) {
      p.hsTries = 0;
      p.hsNext = 0;
    }
    p.confirmedAt = 0;
    if (now() < p.hsNext) {
      p.hsTimer = timers.set(() => {
        p.hsTimer = null;
        startHs(id);
      }, p.hsNext - now());
      return;
    }
    p.hsTries++;
    p.hsLast = now();
    p.hsNext = now() + backoffOf(p.hsTries);
    let hs, m1;
    try {
      hs = noise.handshake({
        initiator: true,
        s: me().priv,
        rs: pairing.pub,
        prologue: prologue(self.id, id, pairing),
      });
      m1 = hs.write();
    } catch {
      return;
    }

    // Not sent (muted after rate_limited, or the socket is not ready): the timer still runs, so it
    // is tried again.
    if (post(id, 'hs', Buffer.concat([Buffer.from([HS_ONE]), m1])))
      p.hs = { hs, pairing, at: now() };
    p.hsTimer = timers.set(() => {
      p.hsTimer = null;
      p.hs = null;
      startHs(id);
    }, HS_WAIT);
  }

  // The higher device id cannot start; it asks. Unauthenticated, so the answer is only ever a
  // handshake under the paired keys. Asked again, with backoff, while no session came of it (the
  // relay may have dropped the request).
  function askHs(id) {
    const p = peer(id);
    if (p.askTimer) return;
    post(id, 'hs', Buffer.from([HS_ASK]));
    p.askTimer = timers.set(
      () => {
        p.askTimer = null;
        if (!p.live && !p.cand && online.has(id) && pairingOf(id)) askHs(id);
      },
      HS_WAIT + backoffOf(++p.askTries)
    );
  }
  const renew = id => {
    if (self.id < id) startHs(id);
    else askHs(id);
  };

  function onHs(from, body) {
    const pairing = pairingOf(from);
    if (!pairing || !body.length) return;
    const p = peer(from),
      type = body[0],
      data = body.subarray(1);
    if (type === HS_ASK) {
      // the live session, if any, stays until the new one answers; the backoff in startHs bounds
      // how often
      if (!(self.id < from)) return;

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
      if (now() - p.respLast > MAX_BACKOFF) p.respTries = 0;

      // a replayed message 1 cannot make this computer answer again and again
      if (now() < p.respNext) return;
      try {
        const hs = noise.handshake({
          initiator: false,
          s: me().priv,
          rs: pairing.pub,
          prologue: prologue(from, self.id, pairing),
        });

        // garbage stops here and does not count: only a message 1 made with the paired key moves
        // the backoff
        hs.read(data);
        p.respTries++;
        p.respLast = now();
        p.respNext = now() + backoffOf(p.respTries);
        const m2 = hs.write(),
          k = hs.split();
        if (post(from, 'hs', Buffer.concat([Buffer.from([HS_TWO]), m2])))
          p.cand = { send: k.send, recv: k.recv, sendN: 0, recvN: 0, pairing };
      } catch {
        /* not from the paired computer: nothing changes */
      }
      return;
    }
    if (type === HS_TWO && p.hs) {
      const { hs, pairing: used } = p.hs;

      // An answer that does not read (junk from the relay or a stolen session) changes nothing: the
      // attempt keeps waiting for the real one, and its own timer starts the next attempt if none
      // comes.
      let k;
      try {
        hs.read(data);
        k = hs.split();
      } catch {
        return;
      }
      if (p.hsTimer) {
        timers.clear(p.hsTimer);
        p.hsTimer = null;
      }
      p.hs = null;
      p.live = { send: k.send, recv: k.recv, sendN: 0, recvN: 0, pairing: used };
      sealTo(from, { t: 'hi', name: String(name() || '').slice(0, 80) });

      // The answerer keeps this session only if that first message reached it; if its answer does
      // not come, start over.
      const mine = p.live;
      if (p.hiTimer) timers.clear(p.hiTimer);
      p.hiTimer = timers.set(() => {
        p.hiTimer = null;
        if (p.live === mine && !mine.hi) {
          dropSession(p);
          tellPeer(from);
          renew(from);
        }
      }, HS_WAIT);
      tellPeer(from);
    }
  }

  function sealTo(id, obj) {
    const p = peers.get(id),
      s = p?.live;
    if (!s) return false;
    if (s.sendN >= 2 ** 32) {
      dropSession(p);
      renew(id);
      return false;
    }

    // throws when it does not fit one envelope: the caller splits
    const padded = noise.pad(Buffer.from(JSON.stringify(obj), 'utf8'));
    const body = noise.seal(
      s.send,
      s.sendN,
      noise.fields(String(V), self.id, id, s.pairing.pairingId),
      padded
    );
    if (!post(id, 'msg', body, s.sendN)) return false;
    s.sendN++;
    return true;
  }

  function onMsg(from, n, body) {
    const p = peers.get(from);
    if (!p || !Number.isInteger(n) || n < 0) return;
    const ad = s => noise.fields(String(V), from, self.id, s.pairing.pairingId);

    // A new session waits as a candidate until its first encrypted message proves the other side
    // holds the keys.
    if (p.cand && n === 0) {
      const plain = noise.open(p.cand.recv, 0, ad(p.cand), body);
      if (plain) {
        p.live = p.cand;
        p.cand = null;
        p.live.recvN = 1;
        p.respTries = 0;
        p.askTries = 0;
        deliver(from, p, plain);
        sealTo(from, { t: 'hi', name: String(name() || '').slice(0, 80) });
        tellPeer(from);
        emit('session', from);
        return;
      }
    }
    const s = p.live;
    if (!s) return;
    const plain = noise.open(s.recv, n, ad(s), body);
    if (!plain) return; // does not decrypt: dropped, nothing changes
    if (n < s.recvN) return; // an old message sent again
    if (n > s.recvN) {
      dropSession(p);
      tellPeer(from);
      return renew(from);
    } // one was lost on the way: this session ends
    s.recvN++;
    deliver(from, p, plain);
  }

  function deliver(from, p, padded) {
    let obj = null;
    try {
      obj = JSON.parse(noise.unpad(padded).toString('utf8'));
    } catch {
      return;
    }
    if (!obj || typeof obj !== 'object') return;
    p.heard = now();
    if (obj.t !== 'hi') return emit('message', from, obj);

    // The name is taken once, from a session's first message; a later `hi` changes nothing.
    if (!p.live || p.live.hi) return;
    p.live.hi = true;
    p.confirmedAt = now(); // startHs resets its wait only when this session then lived a while
    if (p.hiTimer) {
      timers.clear(p.hiTimer);
      p.hiTimer = null;
    }
    const peerName = keys.clean(typeof obj.name === 'string' ? obj.name : '', 60);
    if (p.prov && p.live?.pairing === p.prov) {
      // The first session under the new keys worked: only now is the pairing kept, with the name
      // taken from inside the session.
      store.add({
        id: from,
        pub: p.prov.pub,
        pairingId: p.prov.pairingId,
        name: peerName,
        since: now(),
      });
      p.live.pairing = store.pairing(from);
      p.prov = null;
      if (p.provTimer) {
        timers.clear(p.provTimer);
        p.provTimer = null;
      }
      if (run && run.peer === from) endRun();
      emit('paired', from, peerName);
    } else if (
      store.pairing(from) &&
      store.pairing(from).name !== peerName &&
      mayRename(from) === true
    )
      store.rename(from, peerName); // not while it is paused or asking (remote-service.js)
    if (self.id < from) {
      tellPeer(from);
      emit('session', from);
    } // the starter's session counts from the answer to its first message
  }

  // ---- pairing ----
  const pairingChanged = () =>
    emit(
      'pairing',
      run
        ? {
            role: runRole,
            state: run.state,
            shows: run.shows,
            reason: (run.state === 'ended' && runNote) || run.reason,
            peer: run.peer,
          }
        : { role: null, state: 'idle', shows: null, reason: null, peer: null }
    );

  function endRun() {
    if (runTimer) {
      timers.clear(runTimer);
      runTimer = null;
    }
    run = null;
    runRole = null;
    startPending = false;
    pairingChanged();
    settle();
  }

  function begin(role, peerId) {
    if (run) {
      run.cancel();
      if (runTimer) timers.clear(runTimer);
    }
    clearWish(); // pairing started here: a request still shown is over
    runNote = null;
    startPending = false;
    run = keys.pairing({ role, self: { id: self.id, pub: me().pub }, peer: peerId, guard, now });
    runRole = role;
    runTimer = timers.set(() => {
      runTimer = null;
      if (run) {
        pairingChanged();
        if (run.state === 'ended') endRun();
      }
    }, keys.PAIR_MS + 1000);
    if (role === 'a') {
      if (conn === 'online') sendStart();
      else startPending = true;
    }
    pairingChanged();

    // signed out or no plan: the caller shows the reason from state()
    if (conn === 'stopped') return;
    open();
  }

  function sendStart() {
    if (!run || runRole !== 'a' || run.state !== 'idle') return;
    const r = run.start();
    if (r.send) post(run.peer, 'pair', Buffer.from(JSON.stringify(r.send)));
    pairingChanged();
  }

  function onPair(from, body) {
    // not in pairing mode: nothing is answered; a start message is shown to the user as a request
    if (!runAlive()) return pairAsked(from, body);
    if (run.state === 'done') return;
    let msg = null;
    try {
      msg = JSON.parse(body.toString('utf8'));
    } catch {
      /* refused by the run */
    }
    const r = run.receive(msg, from);
    if (r.ignored) return;
    if (r.send) post(from, 'pair', Buffer.from(JSON.stringify(r.send)));
    pairingChanged();
  }

  // The six digits typed at this computer's own keyboard. Never called for a remote operation
  // (section 4.1).
  function enterCode(typed) {
    if (!run) return { ended: 'no_pairing' };
    let r;
    try {
      r = run.enter(typed);
    } catch {
      return { ok: false, error: 'not_ready' };
    }
    if (r.ok) {
      const res = run.result(),
        p = peer(res.peer);

      // an older pairing with that computer is replaced once the new one is confirmed
      dropSession(p);
      p.prov = { id: res.peer, pub: res.pub, pairingId: res.pairingId, name: '' };
      p.hsTries = p.respTries = 0;
      p.hsNext = p.respNext = 0;
      p.askTries = 0;
      if (p.askTimer) {
        timers.clear(p.askTimer);
        p.askTimer = null;
      }
      if (p.provTimer) timers.clear(p.provTimer);
      p.provTimer = timers.set(() => {
        p.provTimer = null;
        if (p.prov) {
          p.prov = null;
          dropSession(p);
          if (run && run.peer === res.peer) endRun();
          else settle();
        }
      }, keys.PAIR_MS);

      // B is done first and waits: A starts the session (or asks for it) once its own check passed,
      // so no attempt goes to a side that is not ready.
      if (runRole === 'a') renew(res.peer);
    }
    pairingChanged();
    return r;
  }

  return {
    start: open,
    // After a stop for good (signed out, replaced, no plan), or when the app wants to try now
    // instead of waiting.
    resume() {
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
    },
    // The computer woke from sleep, or its network came back (desktop/main.js: the system's resume;
    // the window's "online" event). The link looks now instead of at the end of a wait that was set
    // before the sleep (up to five minutes), and a socket that still looks open is tested at once:
    // after a sleep it is often dead without a close, and the next ordinary ping can be 30 seconds
    // away. Never a tight loop: one such look in WAKE_MS whatever calls it; the first try is one to
    // three seconds away, with jitter; a try that fails goes back to the ordinary backoff (from a
    // short step, not from zero). It does nothing while the link is stopped for good, not wanted,
    // already connecting, or waiting because the server asked it to (remote switched off there, too
    // many tries). → true when it did something.
    wake() {
      if (stopped || conn === 'stopped' || conn === 'connecting' || !wanted()) return false;
      const t = now();
      if (t - wokeAt < WAKE_MS) return false;
      if (ws && conn === 'online') {
        wokeAt = t;
        if (pongTimer) return true; // an answer is already awaited
        try {
          ws.send('ping');
        } catch {
          hangUp(1006);
          return true;
        }
        pongTimer = timers.set(() => {
          pongTimer = null;
          hangUp(1006);
        }, PONG_WAIT);
        return true;
      }

      // The steps become short again at most once a minute: on a
      // network that comes and goes, every "it is back" would otherwise start the backoff from a
      // short step, and this computer would ask for tickets several times between two wakes for as
      // long as that lasts. The look itself is still cut short, once in WAKE_MS.
      if (conn === 'waiting' && retryTimer && !held) {
        wokeAt = t;
        if (t - easedAt >= EASE_MS) {
          easedAt = t;
          attempt = Math.min(attempt, 2);
        }
        retry(1000 + random() * 2000, reason);
        return true;
      }
      return false;
    },
    // The computer is about to sleep (desktop/main.js: the system's suspend). The socket is closed
    // from this side now, so the relay tells the paired computers at once that this one is gone, at
    // the moment it goes and not when a ping stays unanswered. It is the ordinary close: nothing is
    // sent to them and nothing new crosses the relay. A connection try that is under way is given
    // up (its ticket is not used). The link then waits: wake() cuts that wait short, and without
    // one (the sleep never came, or no wake was told) it looks again after NAP_MS and goes on with
    // the ordinary backoff. It does nothing while there is no socket and no try under way (a wait
    // that already runs stays as it is), and nothing while the link is stopped or not wanted. →
    // true when it closed.
    sleep() {
      if (stopped || conn === 'stopped' || !wanted() || (!ws && conn !== 'connecting'))
        return false;
      const tries = attempt;
      opening++;
      clearOpen();
      if (ws) {
        hangUp(1000);
        if (conn !== 'waiting') return true;
      } // the close ended a pairing that was all the link was wanted for: it is off, no wait
      attempt = tries;

      // closing for a sleep is no failed try, and the wake that follows is never the one too many
      wokeAt = -Infinity;
      retry(NAP_MS, 'asleep');
      return true;
    },
    stop() {
      stopped = true;
      clearWish();
      clearOpen();
      if (retryTimer) {
        timers.clear(retryTimer);
        retryTimer = null;
      }
      if (run) {
        run.cancel();
        endRun();
      }
      if (ws) hangUp(1000);
      else set('off');
    },
    pair: peerId => begin('a', peerId),
    pairAny: () => begin('b', null),
    cancelPairing() {
      if (run) {
        run.cancel();
        endRun();
      }
    },
    // The request shown to the user (pairAsked): accepted, this computer enters pairing mode for
    // that one computer and answers its kept first message; the six digits are still typed on both.
    // Declined or run out, it is dropped and nothing was ever sent.
    asked: () => (wish ? wish.from : null),
    acceptAsked() {
      const w = wish;
      if (!w || now() - w.at >= keys.PAIR_MS) {
        clearWish();
        return false;
      }

      // not connected right now: the request stays, nothing is started that could not answer
      if (conn !== 'online') return false;
      begin('b', w.from);
      if (!runAlive()) return false;
      const r = run.receive(w.msg, w.from);
      if (r.send) post(w.from, 'pair', Buffer.from(JSON.stringify(r.send)));
      pairingChanged();
      return !!r.send;
    },
    declineAsked() {
      if (wish) hush(wish.from);
      clearWish();
    },
    enterCode,
    // Sends one object to a paired computer over its live session. False when there is none
    // (offline, or the handshake is not done): nothing queues silently, the caller sends its full
    // list again on the next `session` event.
    send: (id, obj) => sealTo(id, obj),
    // Forget a computer on this one: its key is deleted, so its next handshake fails whether or not
    // the server helps (section 5.6).
    forget(id) {
      const p = peers.get(id);
      if (p) {
        dropSession(p);
        p.prov = null;
        if (p.provTimer) timers.clear(p.provTimer);
        if (p.askTimer) timers.clear(p.askTimer);
        if (p.hsTimer) timers.clear(p.hsTimer);
        peers.delete(id);
      }
      const had = store.remove(id);
      settle();
      return had;
    },
    // Ends the session with that computer and starts a new one, so both send their full lists again
    // (after Keep, remote-trust.js).
    restart(id) {
      const p = peers.get(id);
      if (p) {
        dropSession(p);
        tellPeer(id);
      }
      if (pairingOf(id)) renew(id);
    },
    state: () => ({
      connection: conn,
      reason,
      online: [...online],
      sessions: [...peers].filter(([, p]) => p.live).map(([id]) => id),
    }),
  };
}

module.exports = { createLink, V };
