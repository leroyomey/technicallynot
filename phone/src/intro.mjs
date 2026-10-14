// Technically Not phone app · intro.mjs — the phone's side of being introduced to another computer.
// A computer the phone paired with by scan tells
// it, over their encrypted session, about another computer of the account. The phone stores that
// computer as "introduced": known only on the first computer's word, marked so wherever it is
// shown, and given no push keys (section 7.1) until the phone has scanned its code. The computers'
// side is desktop/phone-intro.js; tools/phone-intro-test.mjs runs them together. Rules: only a
// computer paired by scan may introduce; an introduction is never passed on; a known device id or
// key is refused; at most three computers on one computer's word (counted inside the key store's
// one read-and-write, keys.mjs).
import * as noise from './noise.mjs';
import { clean, safeId } from './keys.mjs';

const bytes = (s, len) => {
  if (typeof s !== 'string' || s.length > 128) return null;
  let b;
  try {
    b = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  } catch {
    return null;
  }
  return b.length === len ? b : null;
};
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// A device id from a computer: usable as a key, and plain (no spaces, line breaks, control or
// direction characters).
const plainId = id => safeId(id) && id === clean(id, 64) && !/\s/.test(id);

// store = the phone's key store (keys.mjs). self = { id, pub } of the phone. msg = the `introduced`
// message that arrived over the encrypted session with the computer `from`. Returns { added } with
// the stored entry, { ignored: true } or { refused: why }.
export async function acceptIntroduced({ store, self, msg, from }) {
  const by = safeId(from) ? await store.pairing(from) : null;

  // an unknown computer, or one the phone itself only knows by introduction
  if (!by || by.how !== 'scan') return { ignored: true };
  if (!msg || typeof msg !== 'object' || msg.t !== 'introduced') return { ignored: true };
  const pub = bytes(msg.pub, 32),
    nonce = bytes(msg.nonce, 32),
    id = msg.id;
  if (!pub || !nonce || !plainId(id) || id === self.id || id === from || eq(pub, self.pub))
    return { ignored: true };

  // The same fields, in the same order, as introId in desktop/phone-intro.js: both sides get the
  // same pairing id.
  const pairingId = (
    await noise.sha256(noise.fields('tnai-intro-v1', from, id, self.id, pub, self.pub, nonce))
  ).subarray(0, 16);
  const have = await store.pairing(id);
  if (have && have.how === 'introduced' && have.by === from && eq(have.pub, pub)) {
    // the introducing computer resends its introductions as state
    if (eq(have.pairingId, pairingId)) return { added: have, again: true };

    // a new random value: the other side started over, so this side follows, or the two would not
    // match
    await store.remove(id);
  }
  try {
    await store.add({ id, pub, pairingId, name: clean(msg.name, 60), how: 'introduced', by: from });
  } catch (e) {
    const why = String(e && e.message);
    return /introducer gone$/.test(why)
      ? { ignored: true }
      : { refused: /full$/.test(why) ? 'full' : 'known' };
  }
  return { added: await store.pairing(id), ...(have ? { again: true, renewed: true } : {}) };
}

// When the phone forgets a computer, the computers it knows only on that computer's word go too.
export async function forgetWithIntroduced(store, id) {
  // The store does it in one step (keys.mjs remove); this only says which ids went.
  const before = await store.pairings();
  await store.remove(id);
  const left = new Set((await store.pairings()).map(p => p.id));
  return before.filter(p => !left.has(p.id)).map(p => p.id);
}
