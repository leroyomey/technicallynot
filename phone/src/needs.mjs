// Technically Not phone app · needs.mjs — what the phone knows of each paired computer's open
// "needs you" items, and the phone's answers to them. The receiving half is the phone's copy of
// desktop/remote-api.js and reads the same messages:
// `needs` (the computer's full list, in parts) and `beat`. tools/phone-needs-test.mjs runs it
// against the desktop file as the sender.
// - Every field of every item is read again as untrusted text and shaped exactly as the sender
// shapes it.
// - A computer whose heartbeat is missed twice is "last heard"; one whose session ended keeps no
// waiting item.
//  - The phone never says "all clear" for a computer, only that nothing is reported.
// Answering is a DRAFT: `answer` to the computer,
// `answered` back. It is not yet reviewed as a control operation and no app code takes it; only the
// stand-in computer of tools/phone-pair-try does.
// - Only a permission prompt, only yes or no. Never a line of text (that is sending a prompt),
// never a folder-trust question, never a menu, an error, a
// draft, or an item the computer only inferred.
//  - Only an item whose text the phone was sent: nobody approves what they cannot read.
// - An answer is bound to the one prompt the user saw (`of`, a hash of the item as it was listed):
// computers reuse an item id for the next prompt of the same agent, and a yes for one prompt must
// never count for another.
//  - Nothing queues: when it cannot leave now, the caller is told, and the item stays open.
// Nothing here stores anything: the list is the computer's, and it is sent again with every
// session.
import { clean, steady } from './keys.mjs';
import { sha256, fields } from './noise.mjs';

export const BEAT_MS = 60 * 1000,
  STALE_MS = 2 * BEAT_MS + 10 * 1000,
  MAX_ITEMS = 200;

// no word from the computer on an answer in this time: say so, and let the user look again
export const REPLY_MS = 15 * 1000;
const KINDS = new Set(['permission', 'menu', 'trust', 'question', 'error', 'draft']);

// How each kind may be answered from a phone. One entry: a yes or no to a permission prompt.
// Everything else is answered at the computer.
export const WAYS = { permission: 'choice' };
const time = t => (Number.isFinite(t) && t > 0 && t < 1e14 ? Math.floor(t) : 0);

// The same shaping as the sender's (desktop/remote-api.js `shape`): what is kept is never more than
// what was meant to leave.
export function shape(it) {
  if (!it || typeof it !== 'object') return null;
  const id = clean(it.id, 80);
  if (!id) return null;
  const out = {
    id,
    kind: KINDS.has(it.kind) ? it.kind : 'other',
    agent: clean(it.agent, 60),
    since: time(it.since),
    inferred: it.inferred === true,
  };

  // A guessed item's text is a line read from the terminal screen: the computer never sends it
  // (desktop/remote-api.js shape), and if one arrived anyway it is not
  // kept.
  if (!out.inferred && it.detail != null && clean(it.detail, 100))
    out.detail = clean(it.detail, 100);
  return out;
}

// What ties an answer to one prompt: every field the user was shown. The same bytes as `bindingOf`
// in desktop/phone-answer.js.
const b64 = bytes => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
export const bindingOf = async it =>
  b64(
    (
      await sha256(
        fields(
          'tnai-answer-v1',
          it.id,
          it.kind,
          it.agent,
          it.detail || '',
          String(it.since),
          it.inferred ? '1' : '0'
        )
      )
    ).subarray(0, 12)
  );

// The v2 binding for a longer command: the same fields and
// `full`, under its own label. The same bytes as `bindingOf2` in desktop/remote-control.js. The
// phone's list does not read `full` or `can2` yet, so it offers no answer for such an item; this is
// here so the two copies of the binding cannot drift before it does.
export const bindingOf2 = async it =>
  b64(
    (
      await sha256(
        fields(
          'tnai-answer-v2',
          it.id,
          it.kind,
          it.agent,
          it.detail || '',
          String(it.since),
          it.inferred ? '1' : '0',
          it.full || ''
        )
      )
    ).subarray(0, 12)
  );
const wayOf = it => (!it.inferred && it.detail ? WAYS[it.kind] || null : null);

// send(peerId, obj) → Promise<boolean> (link.mjs send). on.changed(peerId) fires when what is known
// of that computer changed. now = a clock that cannot be turned back (the "last heard" rule); wall
// = the time of day, only to show when it was last heard.
export function createNeeds({
  send,
  on = {},
  now = steady,
  wall = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
}) {
  // peer id → { state: 'live' | 'last_heard' | 'offline', at (clock), heard (time of day), items,
  // parts, answers: Map(of → 'sending' | 'sent' | 'done' | 'refused:why') }
  const views = new Map();
  let staleTimer = null,
    stopped = false;
  const emit = id => {
    try {
      on.changed?.(id);
    } catch {
      /* a listener's error is not ours */
    }
  };
  const copy = (id, v) => ({
    peer: id,
    state: v.state,
    heard: v.heard,
    items: v.items.map(x => ({ ...x, way: wayOf(x), answer: v.answers.get(x.of) || null })),
  });

  // Messages are worked through one after another: putting a list together waits on the browser
  // (the hashes), and a later message must not overtake it.
  let chain = Promise.resolve();
  const inTurn = fn =>
    (chain = chain.then(fn).catch(() => {
      /* nothing a computer sends may stop this */
    }));

  function watch() {
    if (staleTimer) {
      timers.clear(staleTimer);
      staleTimer = null;
    }
    let next = Infinity;
    for (const v of views.values())
      if (v.state === 'live' && v.items.length) next = Math.min(next, v.at + STALE_MS);
    if (next === Infinity || stopped) return;
    staleTimer = timers.set(
      () => {
        staleTimer = null;
        for (const [id, v] of views)
          if (v.state === 'live' && v.items.length && now() - v.at >= STALE_MS) {
            v.state = 'last_heard';
            emit(id);
          }
        watch();
      },
      Math.max(1000, next - now())
    );
  }
  const heardNow = v => {
    v.at = now();
    v.heard = wall();
  };

  async function handle(from, obj) {
    const v = views.get(from);
    if (!v || !obj || typeof obj !== 'object') return; // only from a computer with a live session
    if (obj.t === 'beat') {
      heardNow(v);
      if (v.state !== 'live') {
        v.state = 'live';
        emit(from);
      }
      return watch();
    }
    if (obj.t === 'answered') {
      // the computer's word on an answer this phone sent; about anything else it changes nothing
      const of = typeof obj.of === 'string' ? obj.of.slice(0, 24) : '';
      if (v.answers.get(of) !== 'sent') return;
      v.answers.set(of, obj.ok === true ? 'done' : 'refused:' + (clean(obj.why, 20) || 'refused'));
      return emit(from);
    }
    if (obj.t !== 'needs') return; // not on the list: ignored
    const { g, i, n } = obj;
    if (
      !Number.isInteger(g) ||
      !Number.isInteger(i) ||
      !Number.isInteger(n) ||
      n < 1 ||
      n > 64 ||
      i < 0 ||
      i >= n ||
      !Array.isArray(obj.items)
    )
      return;
    if (!v.parts || v.parts.g !== g) {
      if (i !== 0) return;
      v.parts = { g, n, got: [] };
    } // a list starts at its first part
    if (v.parts.n !== n || i !== v.parts.got.length) {
      v.parts = null;
      return;
    }
    v.parts.got.push(obj.items);
    if (v.parts.got.length < n) return;
    const list = [],
      seen = new Set(),
      raw = v.parts.got.flat();
    v.parts = null;
    for (const r of raw) {
      const s = shape(r);
      if (s && !seen.has(s.id) && list.length < MAX_ITEMS) {
        seen.add(s.id);
        list.push(s);
      }
    }
    for (const s of list) s.of = await bindingOf(s);

    // the session ended while the list was put together
    if (views.get(from) !== v || v.state === 'offline') return;
    const ofs = new Set(list.map(s => s.of));
    v.items = list;
    heardNow(v);
    v.state = 'live';

    // a prompt that left the list takes its answer state with it
    for (const of of [...v.answers.keys()]) if (!ofs.has(of)) v.answers.delete(of);
    emit(from);
    watch();
  }

  return {
    // A session with that computer just started (the link's `session` event): its list will follow.
    sessionStarted: peerId =>
      inTurn(() => {
        const v = views.get(peerId);
        if (!v) {
          const fresh = {
            state: 'live',
            at: 0,
            heard: 0,
            items: [],
            parts: null,
            answers: new Map(),
          };
          heardNow(fresh);
          views.set(peerId, fresh);
        } else {
          v.parts = null;
          v.state = 'live';
          heardNow(v);
        }
        emit(peerId);
      }),
    // The session ended or the computer went offline: nothing of it keeps "waiting"; what is left
    // is when it was last heard.
    sessionEnded: peerId =>
      inTurn(() => {
        const v = views.get(peerId);
        if (!v) return;
        const had = v.items.length || v.state !== 'offline';
        v.items = [];
        v.parts = null;
        v.state = 'offline';
        v.answers.clear();
        if (had) emit(peerId);
        watch();
      }),
    onMessage: (from, obj) => inTurn(() => handle(from, obj)),
    // One answer, yes or no, to the one prompt the user was shown: its id AND its `of`. Resolves to
    // 'sent', or to why it did not leave: 'not_live' (the computer is not live right now), 'gone'
    // (that prompt is no longer the one open), 'kind' (answered at the computer), 'bad' (not yes or
    // no), 'again' (already answered), 'not_sent' (no session at this moment).
    async answer(peerId, itemId, of, say) {
      const v = views.get(peerId);
      if (!v || v.state !== 'live') return 'not_live';
      const it = v.items.find(x => x.id === itemId && x.of === of);
      if (!it) return 'gone';
      if (!wayOf(it)) return 'kind';
      if (say !== 'yes' && say !== 'no') return 'bad';
      const was = v.answers.get(of);
      if (was === 'sending' || was === 'sent' || was === 'done') return 'again';
      v.answers.set(of, 'sending');
      emit(peerId);
      let ok = false;
      try {
        ok = (await send(peerId, { t: 'answer', id: it.id, of, say })) === true;
      } catch {
        /* did not leave */
      }
      if (views.get(peerId) !== v || v.answers.get(of) !== 'sending')
        return ok ? 'sent' : 'not_sent'; // the list or the session changed meanwhile
      if (!ok) {
        v.answers.delete(of);
        emit(peerId);
        return 'not_sent';
      }
      v.answers.set(of, 'sent');
      emit(peerId);

      // A computer that never says anything about it must not leave the buttons off for good.
      timers.set(() => {
        if (views.get(peerId) === v && v.answers.get(of) === 'sent') {
          v.answers.set(of, 'refused:no_reply');
          emit(peerId);
        }
      }, REPLY_MS);
      return 'sent';
    },
    forget: peerId =>
      inTurn(() => {
        views.delete(peerId);
        watch();
        emit(peerId);
      }),
    view: peerId => {
      const v = views.get(peerId);
      return v ? copy(peerId, v) : null;
    },
    all: () => [...views].map(([id, v]) => copy(id, v)),
    // Resolves when every message handed over so far has been worked through (tests wait on it).
    idle: () => chain,
    stop() {
      stopped = true;
      if (staleTimer) timers.clear(staleTimer);
      staleTimer = null;
    },
  };
}
