// Technically Not · remote-trust.js — ending trust between paired computers:
// - Forget this computer: its key is deleted here at once, and every other paired computer is asked
// to forget it too. Each stays listed until its encrypted confirmation arrived, whether or not the
// relay shows it online.
// - Stop remote everywhere: this computer sends and receives nothing but the stop itself, keeps its
// old key and pairings only until each computer confirmed (or the user chooses "finish anyway"),
// then makes a new long-term key. A computer that is itself stopping confirms another one's stop
// and takes that stop as the confirmation of its own.
// - A computer that is asked to forget or stop never obeys at once (one stolen computer could
// otherwise wipe the whole set): it pauses that pairing, confirms, and shows Keep / Forget. Keep
// resumes; Forget deletes the key. It sits between the link and remote-api.js: send() and
// onMessage() let nothing through for a paused pairing or while stopping. What is owed (asks not
// yet confirmed, pairings paused) is kept in the key store's encrypted blob, so a restart loses
// nothing. Pure Node: the store, the link and the clock are handed in. Its four message types
// travel only inside an encrypted session.
const crypto = require('crypto');

const CONTROL = new Set(['forget', 'stop', 'ack', 'chose']);
const MAX_ASKS = 8;

// after Keep, the same computer's ask about the same pairing is not obeyed again for a day
const KEEP_MS = 24 * 60 * 60 * 1000;

// what is owed to a computer with a live session is sent again this often until it confirmed
const RETRY_MS = 45 * 1000;
const idOf = v =>
  typeof v === 'string' && v.length > 0 && v.length <= 64 && !(v in Object.prototype) ? v : null;

// self = { id }. store = keyStore(). link = { send(id, obj), forget(id), restart(id) }
// (remote-link.js). on = { changed(), gate(peerId, open), outcome({ to, about, choice }), stopped()
// }. timers = { set, clear } and live(peerId) → is there a session with it now: handed in by the
// app for the retry below (none without them).
function createTrust({
  self,
  store,
  link,
  on = {},
  now = Date.now,
  newId = () => crypto.randomBytes(9).toString('base64url'),
  timers = null,
  live = () => false,
}) {
  const emit = (ev, ...args) => {
    try {
      on[ev]?.(...args);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const n = store.note('trust') || {};

  // pending: asks this computer made and is waiting on. outbox: messages owed until the other side
  // confirmed them (sent again at every session start). paused: pairings another computer asked to
  // end, waiting for the user's Keep or Forget.
  // kept: { peer, by, until, again } — asks refused because the user chose Keep
  const st = {
    stopping: !!n.stopping,
    pending: Array.isArray(n.pending) ? n.pending : [],
    outbox: Array.isArray(n.outbox) ? n.outbox : [],
    paused: n.paused && typeof n.paused === 'object' ? n.paused : {},
    kept: Array.isArray(n.kept) ? n.kept : [],
  };
  const save = () => {
    store.setNote('trust', st);
    emit('changed');
  };
  const raw = (to, msg) => {
    try {
      return link.send(to, msg) === true;
    } catch {
      return false;
    }
  };

  // A Forget ask or a Keep/Forget answer owed to a pairing that is paused here waits: a computer
  // the user may be about to forget is told nothing new. It goes at the session that follows Keep,
  // and is dropped with the pairing on Forget. A stop and confirmations still go.
  const held = (to, msg) => !!st.paused[to] && (msg.t === 'forget' || msg.t === 'chose');
  const flush = to => {
    for (const o of st.outbox) if (o.to === to && !held(to, o.msg)) raw(to, o.msg);
  };

  // Every send can fail (the link is muted for up to two minutes after `rate_limited`, or the relay
  // drops one message), so a Forget or Stop that was not confirmed is sent again by its own timer,
  // not only at the next session start, which can be days away (app-2 #2). The
  // timer exists only while something is owed to a computer with a live session; a repeated ask is
  // answered with the same confirmation and changes nothing there.
  let retry = null;
  const reach = to => {
    try {
      return live(to) === true;
    } catch {
      return false;
    }
  };
  const arm = () => {
    if (!timers || retry || !st.outbox.some(o => !held(o.to, o.msg) && reach(o.to))) return;
    retry = timers.set(() => {
      retry = null;
      for (const to of new Set(st.outbox.map(o => o.to))) if (reach(to)) flush(to);
      arm();
    }, RETRY_MS);
  };
  const owe = (to, msg) => {
    st.outbox.push({ to, msg });
    if (!held(to, msg)) raw(to, msg);
    arm();
  };
  const dropAllFor = id => {
    st.pending = st.pending.filter(p => p.to !== id);
    st.outbox = st.outbox.filter(o => o.to !== id);
  };

  function pause(peer, ask) {
    const fresh = !st.paused[peer],
      e = st.paused[peer] || (st.paused[peer] = { asks: [], at: now() });

    // One line per computer that asks, however often it asks: a repeated ask changes nothing, so it
    // cannot fill the store or the activity log.
    const known = e.asks.some(a => a.r === ask.r || (a.by === ask.by && a.kind === ask.kind));
    if (!known && e.asks.length < MAX_ASKS) e.asks.push(ask);
    if (fresh || !known) save();
    if (fresh) emit('gate', peer, false);
  }

  // The user's answer for a paused pairing. Whoever asked for a Forget is told what was chosen.
  function choose(peer, choice) {
    const e = idOf(peer) && Object.hasOwn(st.paused, peer) ? st.paused[peer] : null;
    if (!e || (choice !== 'keep' && choice !== 'forget')) return false;
    delete st.paused[peer];
    st.kept = st.kept.filter(k => k.until > now() && k.peer !== peer);
    if (choice === 'keep')
      // a stop ask too (by = that computer itself)
      for (const a of e.asks) st.kept.push({ peer, by: a.by, until: now() + KEEP_MS, again: 0 });
    if (choice === 'forget') {
      dropAllFor(peer);
      link.forget(peer);
    }
    for (const a of e.asks)
      if (a.kind === 'forget' && a.by !== peer && store.pairing(a.by))
        owe(a.by, { t: 'chose', r: a.r, choice });
    save();
    if (choice === 'keep') {
      emit('gate', peer, true);
      link.restart(peer);
    } // a new session, so both send their full lists again
    return true;
  }

  function finishStop(force) {
    if (!st.stopping) return false;
    if (force) for (const p of store.pairings()) link.forget(p.id);
    else if (st.pending.some(p => p.kind === 'stop')) return false;
    store.renewIdentity();
    st.stopping = false;
    st.pending = [];
    st.outbox = [];
    st.paused = {};
    st.kept = [];
    save();
    emit('stopped');
    return true;
  }

  function onAck(from, r, did) {
    st.outbox = st.outbox.filter(o => !(o.to === from && o.msg.r === r));
    const p = st.pending.find(x => x.r === r && x.to === from);
    if (p && p.kind === 'stop') {
      dropAllFor(from);
      delete st.paused[from];
      link.forget(from);
      save();
      finishStop(false);
      return;
    }
    if (p) {
      if (did === 'paused') p.status = 'paused';
      else {
        st.pending = st.pending.filter(x => x !== p);
        if (did === 'kept') emit('outcome', { to: from, about: p.about, choice: 'keep' });
      } // 'none': it had no such pairing; 'kept': its user already chose Keep
    }
    save();
  }

  return {
    // remote-api.js sends through this: nothing leaves for a paused pairing or while this computer
    // is stopping.
    send: (peer, obj) => (st.stopping || st.paused[peer] ? false : raw(peer, obj)),
    open: peer => !st.stopping && !st.paused[peer],
    // A decrypted message from a paired computer. True = handled or dropped here; false = it is for
    // remote-api.js.
    onMessage(from, obj) {
      if (!obj || typeof obj !== 'object') return true;
      const r = idOf(obj.r);
      if (st.stopping) {
        // Only the stop's own confirmation is read, and one more thing is answered: the other
        // computer's own stop. It is stopping too, so neither would ever confirm the other and both
        // would wait on "Stopping" until Finish anyway (app-2 #4). Its stop is
        // confirmed, and when that confirmation went out it also counts as its confirmation of this
        // computer's stop: both users chose to end this pairing. It ends the pairing with its
        // sender only, never one with a third computer.
        if (obj.t === 'ack' && r) onAck(from, r, obj.did);
        else if (obj.t === 'stop' && r && raw(from, { t: 'ack', r, did: 'paused' })) {
          const mine = st.pending.find(p => p.kind === 'stop' && p.to === from);
          if (mine) onAck(from, mine.r, 'paused');
        }
        return true;
      }
      const paused = !!st.paused[from];
      if (!CONTROL.has(obj.t)) return paused;
      if (!r) return true;
      if (obj.t === 'ack') {
        onAck(from, r, obj.did);
        return true;
      }
      if (obj.t === 'stop') {
        // The user already answered Keep to this computer's stop: it is not paused again and again.
        const keptStop = st.kept.find(k => k.peer === from && k.by === from && k.until > now());
        if (keptStop) {
          keptStop.again++;
          raw(from, { t: 'ack', r, did: 'kept' });
          return true;
        }
        pause(from, { by: from, r, kind: 'stop' });
        raw(from, { t: 'ack', r, did: 'paused' });
        return true;
      }
      if (obj.t === 'forget') {
        const about = idOf(obj.about);
        if (!about || about === self.id || about === from || !store.pairing(about)) {
          raw(from, { t: 'ack', r, did: 'none' });
          return true;
        }

        // The user already answered Keep to this computer's ask about that pairing: it is not
        // paused again and again.
        const kept = st.kept.find(k => k.peer === about && k.by === from && k.until > now());
        if (kept) {
          kept.again++;
          raw(from, { t: 'ack', r, did: 'kept' });
          return true;
        } // counted in memory: a repeated ask writes nothing

        // An ask is read even from a computer that is itself paused here: the honest one may be the
        // paused one, and the user sees both lines.
        pause(about, { by: from, r, kind: 'forget' });
        raw(from, { t: 'ack', r, did: 'paused' });
        return true;
      }

      // chose: the computer we asked has answered Keep or Forget
      const p = st.pending.find(x => x.r === r && x.to === from);
      if (p) {
        st.pending = st.pending.filter(x => x !== p);
        save();
        emit('outcome', {
          to: from,
          about: p.about,
          choice: obj.choice === 'keep' ? 'keep' : 'forget',
        });
      }
      raw(from, { t: 'ack', r });
      return true;
    },
    // A session with that computer just started: everything still owed to it goes again.
    sessionStarted(peer) {
      flush(peer);
      arm();
    },
    // The service is switched off: no timer stays.
    stop() {
      if (retry) {
        timers.clear(retry);
        retry = null;
      }
    },
    // Forget a computer here and ask every other paired computer to forget it too.
    forget(peer) {
      if (st.stopping || !idOf(peer) || peer === self.id) return false;
      const had = !!store.pairing(peer);
      if (st.paused[peer]) choose(peer, 'forget');
      else {
        dropAllFor(peer);
        link.forget(peer);
      }
      st.pending = st.pending.filter(p => p.about !== peer);
      st.outbox = st.outbox.filter(o => !(o.msg.t === 'forget' && o.msg.about === peer));
      for (const p of store.pairings()) {
        const r = newId();
        st.pending.push({ r, kind: 'forget', about: peer, to: p.id, status: 'sent', since: now() });
        owe(p.id, { t: 'forget', about: peer, r });
      }
      save();
      return had;
    },
    choose,
    // Stop remote everywhere: from now on only the stop and its confirmations travel.
    stopEverywhere() {
      if (st.stopping) return false;

      // Forgets not yet confirmed stay owed and listed: stopping must not quietly drop the Forget
      // of a stolen computer.
      st.stopping = true;
      st.pending = st.pending.filter(p => p.kind === 'forget');
      st.outbox = st.outbox.filter(o => o.msg.t === 'forget');
      const peers = store.pairings().map(p => p.id);
      for (const id of peers) {
        const r = newId();
        st.pending.push({ r, kind: 'stop', about: null, to: id, status: 'sent', since: now() });
        st.outbox.push({ to: id, msg: { t: 'stop', r } });
      }
      save();
      for (const id of peers) {
        emit('gate', id, false);
        flush(id);
      }
      arm();
      finishStop(false); // nothing paired: done at once
      return true;
    },
    // "Finish anyway": the computers that never confirmed keep a pairing that no longer works
    // (their key for this one is now wrong).
    finishAnyway: () => finishStop(true),
    // Stop waiting for one computer's confirmation of a Forget (it stays listed until then).
    dismiss(r) {
      const before = st.pending.length;
      st.pending = st.pending.filter(p => !(p.r === r && p.kind === 'forget'));
      st.outbox = st.outbox.filter(o => o.msg.r !== r);
      if (st.pending.length !== before) save();
      return st.pending.length !== before;
    },
    // For the Devices page. waiting: asks not yet settled ('sent' = not confirmed, 'paused' =
    // paused there, not yet forgotten). asks: pairings paused here, each waiting for Keep or
    // Forget, with who asked.
    status: () => ({
      stopping: st.stopping,
      waiting: st.pending.map(p => ({
        r: p.r,
        kind: p.kind,
        about: p.about,
        to: p.to,
        status: p.status,
        since: p.since,
      })),
      asks: Object.entries(st.paused).map(([peer, e]) => ({
        peer,
        at: e.at,
        by: e.asks.map(a => ({ id: a.by, kind: a.kind })),
      })),
      // Asks refused because the user chose Keep, with how often that computer asked again (shown
      // as "keeps asking").
      kept: st.kept
        .filter(k => k.until > now())
        .map(k => ({ peer: k.peer, by: k.by, again: k.again, until: k.until })),
    }),
  };
}

module.exports = { createTrust, RETRY_MS };
