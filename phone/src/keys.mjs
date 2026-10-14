// Technically Not phone app · keys.mjs — the phone's long-term key and its list of paired
// computers. The phone's counterpart of keyStore() in desktop/remote-keys.js, with what a browser
// changes:
// - the private key is a CryptoKey that cannot be exported, kept as such in the browser's store
// (IndexedDB); this file never has it as bytes, so there is nothing here to encrypt and nothing a
// copy of the store could give away but who is paired;
// - the phone app can be open twice (two tabs, the installed app and a tab), so every change is one
// read-and-write the store does as a whole (backend.update): two changes at once must not lose one,
// and two first starts must not make two keys;
// - one device, one entry: a device id or a public key that is already stored is refused, never
// replaced, with two exceptions that are both a confirmed scan (see add). `clean` and `safeId` are
// copies of the desktop's and must stay equal to them: tools/phone-keys-test.mjs compares them.
import * as noise from './noise.mjs';

// One line of plain text from another device or for one: control characters, line separators,
// zero-width and direction-override characters removed (a name must not be able to read as
// something else), then clipped.
const INVISIBLE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\u2800\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffc\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]|\p{Cs}/gu;
export const clean = (v, n) => {
  const t = String(v ?? '')
      .replace(INVISIBLE, ' ')
      .replace(/(\p{M}{2})\p{M}+/gu, '$1')
      .replace(/\s+/g, ' ')
      .trim(),
    chars = Array.from(t);
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : t;
};

// A device id usable as a key: a short string that is not a built-in property name ("__proto__",
// "constructor").
export const safeId = id =>
  typeof id === 'string' &&
  /^[\w-]{1,64}$/.test(id) &&
  !/[^\x00-\x7f]/.test(id) &&
  !(id in Object.prototype);

const is = (b, len) => b instanceof Uint8Array && b.length === len;
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// The clock for waits and time limits. It cannot be turned back (the time of day can), and it does
// not stand still while the phone sleeps (performance.now() does on some phones): whichever of the
// two moved further counts.
const p0 = performance.now(),
  d0 = Date.now();
let steadyLast = 0;
export const steady = () =>
  (steadyLast = Math.max(steadyLast, performance.now() - p0, Date.now() - d0));

export const PER_INTRODUCER = 3; // computers the phone takes on one computer's word

// paired by scanning that computer's code, or known only on another computer's word (section 5,
// rule 4)
const HOW = ['scan', 'introduced'];
const whole = p =>
  !!p &&
  safeId(p.id) &&
  is(p.pub, 32) &&
  is(p.pid, 16) &&
  HOW.includes(p.how) &&
  (p.how === 'introduced' ? safeId(p.by) : p.by === null);
const hasKey = me => !!me && !!me.priv && is(me.pub, 32);

// backend = { get(key) → value or undefined, update(key, fn) }, both asynchronous. update reads the
// value, calls fn(value) at once and without waiting, and writes what it returns: fn gives
// [newValue, result]; newValue undefined = write nothing; a throw = no change, and update rejects
// with it. Values are kept as given (a CryptoKey included). In the app: idbBackend() below.
export function keyStore(backend) {
  // an entry that is not whole is left out, it must not break the rest
  const list = v => (Array.isArray(v) ? v.filter(whole) : []);
  const out = p => ({
    id: p.id,
    name: p.name,
    pub: Uint8Array.from(p.pub),
    pairingId: Uint8Array.from(p.pid),
    since: p.since,
    how: p.how,
    by: p.by,
  });

  return {
    // Made the first time the phone pairs, then kept. { priv: CryptoKey that cannot be exported,
    // pub: raw 32 bytes }.
    async identity() {
      let me = await backend.get('identity');
      if (!hasKey(me)) {
        // made before the store is asked: a store cannot wait in the middle of a change
        const fresh = await noise.generateKeyPair();
        me = await backend.update('identity', cur =>
          hasKey(cur) ? [undefined, cur] : [fresh, fresh]
        ); // another tab was first: its key wins
      }
      return { priv: me.priv, pub: Uint8Array.from(me.pub) };
    },
    pairings: async () => list(await backend.get('pairings')).map(out),
    pairing: async id => {
      const p = safeId(id) ? list(await backend.get('pairings')).find(x => x.id === id) : null;
      return p ? out(p) : null;
    },
    // Called only after the first session under the new keys worked and, for a scan, after the
    // computer said the six digits were typed correctly and before the phone's own answer goes out
    // (section 3.7; pair.mjs does it when given the store). The name comes from that session, not
    // from the relay. `by` = the introducing computer's id, for an introduced computer only.
    async add({ id, pub, pairingId, name = '', since = Date.now(), how = 'scan', by = null }) {
      const entry = {
        id,
        pub: is(pub, 32) ? Uint8Array.from(pub) : null,
        pid: is(pairingId, 16) ? Uint8Array.from(pairingId) : null,
        name: clean(name, 60),
        since,
        how,
        by,
      };
      if (!whole(entry) || !Number.isFinite(since)) throw new Error('phone-keys: bad pairing');
      return backend.update('pairings', cur => {
        const all = list(cur),
          known = all.filter(p => p.id === id || same(p.pub, entry.pub));

        // A confirmed scan is stronger than another computer's word: it replaces an entry that was
        // only introduced (so a stolen computer cannot block the real one by introducing its id
        // first). And scanning the very same computer again (same id, same key) replaces its entry:
        // that is how a pairing whose last message was lost is repaired. Anything else is refused.
        const overIntroduced = how === 'scan' && known.every(p => p.how === 'introduced');
        const sameComputer =
          how === 'scan' &&
          known.length === 1 &&
          known[0].id === id &&
          same(known[0].pub, entry.pub);
        if (known.length && !overIntroduced && !sameComputer)
          throw new Error('phone-keys: this device is already paired; forget it first');

        // Counted here, inside the one read-and-write, so several introductions arriving together
        // cannot all slip under the limit.
        if (
          how === 'introduced' &&
          all.filter(p => p.how === 'introduced' && p.by === by && !known.includes(p)).length >=
            PER_INTRODUCER
        )
          throw new Error('phone-keys: full');

        // Looked at here too, not only by the caller before its waits: the introducer may have been
        // forgotten meanwhile.
        if (how === 'introduced' && !all.some(p => p.id === by && p.how === 'scan'))
          throw new Error('phone-keys: introducer gone');

        // Resolves with the entries this one replaced, so a caller that must take its add back can
        // put them back (pair.mjs).
        return [all.filter(p => !known.includes(p)).concat(entry), known.map(out)];
      });
    },
    rename: async (id, name) =>
      backend.update('pairings', cur => {
        const all = list(cur),
          p = safeId(id) && all.find(x => x.id === id);
        if (!p) return [undefined, false];
        p.name = clean(name, 60);
        return [all, true];
      }),
    // Takes back an add that must not stand (pair.mjs: the run ended while the phone was storing),
    // in one read-and-write: only when the entry with that pairing id is still the one stored is it
    // removed and what it replaced put back. So a Forget that came in between stays a
    // Forget, and there is no moment with the old entry gone and the new one kept.
    takeBack: async (id, pairingId, replaced = []) =>
      backend.update('pairings', cur => {
        const all = list(cur),
          i = all.findIndex(p => p.id === id && is(pairingId, 16) && same(p.pid, pairingId));
        if (i < 0) return [undefined, false];
        all.splice(i, 1);
        for (const r of Array.isArray(replaced) ? replaced : []) {
          const e = {
            id: r.id,
            pub: is(r.pub, 32) ? Uint8Array.from(r.pub) : null,
            pid: is(r.pairingId, 16) ? Uint8Array.from(r.pairingId) : null,
            name: clean(r.name, 60),
            since: r.since,
            how: r.how,
            by: r.by,
          };

          // Only a scanned entry goes back. One that was merely introduced does not: its introducer
          // may have changed meanwhile and the limit per introducer would have to be counted again;
          // the introducing computer sends it again by itself.
          if (e.how === 'scan' && whole(e) && !all.some(p => p.id === e.id || same(p.pub, e.pub)))
            all.push(e);
        }
        return [all, true];
      }),
    // Forgetting a computer takes the computers known only on its word with it, in the same
    // read-and-write: there is no way to forget the one and keep the others.
    // True when the computer itself was stored.
    remove: async id =>
      backend.update('pairings', cur => {
        const all = list(cur),
          left = all.filter(p => p.id !== id && !(p.how === 'introduced' && p.by === id));
        return left.length === all.length ? [undefined, false] : [left, all.some(p => p.id === id)];
      }),
    // A new long-term key (after Stop remote everywhere, or after the phone app's code was taken
    // over). Every old pairing is useless with it, so the list is emptied first: an old entry must
    // not block pairing again. The list is emptied again after the key is written: another open
    // copy of the app may have added a pairing in between, and that one was made under the old key.
    async renewIdentity() {
      const fresh = await noise.generateKeyPair();
      await backend.update('pairings', () => [[], undefined]);
      await backend.update('identity', () => [fresh, undefined]);
      await backend.update('pairings', () => [[], undefined]);
    },
    // Small state other phone files keep across restarts. Values are copied, so a caller cannot
    // change the store by accident.
    note: async name => {
      const all = await backend.get('notes'),
        v = all && Object.hasOwn(all, name) ? all[name] : undefined;
      return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    },
    // Sets a note only if there is none yet and gives back the one that stands: two copies of the
    // app opened at the same first start end up with one device id, not two.
    async noteOnce(name, value) {
      if (!safeId(name)) throw new Error('phone-keys: bad note name');
      const copy = JSON.parse(JSON.stringify(value));
      return backend.update('notes', cur => {
        const all = { ...(cur || {}) };
        if (Object.hasOwn(all, name)) return [undefined, JSON.parse(JSON.stringify(all[name]))];
        all[name] = copy;
        return [all, copy];
      });
    },
    // undefined removes the note.
    async setNote(name, value) {
      if (!safeId(name)) throw new Error('phone-keys: bad note name');
      const copy = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      return backend.update('notes', cur => {
        const all = { ...(cur || {}) };
        if (copy === undefined) delete all[name];
        else all[name] = copy;
        return [all, undefined];
      });
    },
  };
}

// The browser's own store. Each call opens the store, does its one transaction and closes it again;
// a change is read and written inside one transaction, so two open copies of the app cannot
// overwrite each other. Not run by any test (Node has no IndexedDB): the phone check's "the key can
// be kept in the phone's store and still works" line stores and reuses a CryptoKey the same way.
export function idbBackend(name = 'tnai-phone') {
  const open = () =>
    new Promise((res, rej) => {
      const r = indexedDB.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('phone-keys: the store is busy'));
    });
  const withDb = async fn => {
    const db = await open();
    try {
      return await fn(db);
    } finally {
      db.close();
    }
  };
  const failed = t => t.error || new Error('phone-keys: the store refused the change');

  // Tells every open copy of the app (this one too) that what is paired, or the key, changed:
  // link.mjs then reads it again. It carries no data, only which part changed. A browser without it
  // is covered by the link's own look every half minute.
  let chan = null;
  try {
    chan = new BroadcastChannel(name + '-changed');
  } catch {
    /* no signal in this browser */
  }
  const tell = key => {
    if (chan && (key === 'pairings' || key === 'identity')) {
      try {
        chan.postMessage(key);
      } catch {
        /* closed */
      }
    }
  };
  return {
    get: key =>
      withDb(
        db =>
          new Promise((res, rej) => {
            const t = db.transaction('kv'),
              q = t.objectStore('kv').get(key);
            t.oncomplete = () => res(q.result);
            t.onabort = t.onerror = () => rej(failed(t));
          })
      ),
    update: (key, fn) =>
      withDb(
        db =>
          new Promise((res, rej) => {
            const t = db.transaction('kv', 'readwrite'),
              s = t.objectStore('kv'),
              q = s.get(key);
            let result,
              thrown = null,
              wrote = false;
            q.onsuccess = () => {
              try {
                const [value, r] = fn(q.result);
                result = r;
                if (value !== undefined) {
                  s.put(value, key);
                  wrote = true;
                }
              } catch (e) {
                thrown = e;
                t.abort();
              }
            };
            t.oncomplete = () => {
              if (wrote) tell(key);
              res(result);
            };
            t.onabort = t.onerror = () => rej(thrown || failed(t));
          })
      ),
  };
}

// Calls fn() whenever any open copy of the app changed what is paired or the key (idbBackend's
// signal). Returns a function that stops listening. Does nothing in a browser without
// BroadcastChannel.
export function onStoreChange(fn, name = 'tnai-phone') {
  let chan = null;
  try {
    chan = new BroadcastChannel(name + '-changed');
  } catch {
    return () => {};
  }
  chan.onmessage = () => {
    try {
      fn();
    } catch {
      /* the listener's error is its own */
    }
  };
  return () => {
    try {
      chan.close();
    } catch {
      /* already closed */
    }
  };
}
