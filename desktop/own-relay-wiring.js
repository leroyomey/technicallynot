// Technically Not · own-relay-wiring.js — how "Use my own relay" (own-relay.js)
// is joined to the several-computers service: which of the two sources
// (the user's own relay, or the Technically Not account) gives the service its device id, account,
// address, ticket and device list, and what setting or removing a relay does.
//
// It was part of main.js, where no test could reach it. It is pure: everything is handed in, so
// tools/own-relay-wiring-test.js runs it in plain Node with stand-ins for the account and the
// service. main.js only calls it.
//   ownRelay: createOwnRelay() of own-relay.js.
//   userAuth: the account (user-auth.js): thisDevice(), apiBase(), accountCall(), publicState().
//   remote:   a function that returns the several-computers service. A function, because the
//             service is made after this wiring (it is given url, getTicket and devices from here).
const { ACCOUNT_ID } = require('./own-relay');

// The account named when a relay is removed while nobody is signed in: no real account has this
// id (theirs are long random ids from the server), so a later sign-in is "another account" again
// and finds nothing left to remove.
const NOBODY = 'nobody';

function createOwnRelayWiring({ ownRelay, userAuth, remote }) {
  // Is this computer on a relay of the user's own? Also while that relay is saved but cannot be
  // read this once (own-relay.js held()): every answer below must stay the own relay's then. If
  // one of them fell back to the account for that moment, this computer's id would change under a
  // link that is up, and its envelopes would be refused until the file reads again.
  const onOwnRelay = () => ownRelay.active() || ownRelay.held();

  // This computer's id for the several-computers service: its own-relay id while an own relay is
  // set, else the id the account knows it by.
  const selfId = () => (onOwnRelay() ? ownRelay.deviceId() : userAuth.thisDevice().id);

  // [signed in, account id] for the service's accountChanged: the relay stands in for the account
  // while one is set, so the service works signed out of Technically Not.
  const who = user => (onOwnRelay() ? [true, ACCOUNT_ID] : [!!user, user?.id || '']);

  // The address the link connects to. Empty while the relay cannot be read: nothing is connected
  // to then, because no ticket is given either.
  const url = () => (onOwnRelay() ? ownRelay.wsUrl() : userAuth.apiBase().replace(/^http/, 'ws'));

  // A connection ticket; rejects with { status, code }, which the link reads to decide whether to
  // wait, stop or try again. While the relay cannot be read the own relay answers "no relay" with
  // status 0, which the link tries again later; the account is never asked in its place.
  async function getTicket() {
    if (onOwnRelay()) return ownRelay.ticket(selfId());
    let r;
    try {
      r = await userAuth.accountCall('POST', '/remote/ticket');
    } catch (e) {
      throw { status: 0, code: e?.code || 'network' };
    }

    // signed out: tried again when the account changes
    if (!r) throw { status: 401, code: 'signed_out' };
    if (!r.ok || typeof r.body?.ticket !== 'string')
      throw { status: r.status, code: r.body?.error || 'refused' };
    return r.body.ticket;
  }

  // The devices that can be paired with: the ones on the user's relay, or the account's.
  const devices = async () => {
    if (onOwnRelay()) return ownRelay.devices(selfId());
    const r = await userAuth.accountCall('GET', '/me/devices');
    return r?.ok && Array.isArray(r.body?.devices) ? r.body.devices : [];
  };

  // On an own relay anyone with the secret chooses their own id, so the service is told ids are
  // free to take (remote-link.js freeIds).
  const freeIds = () => onOwnRelay();

  // Save or remove the relay with the link out of the way. The link is ended BEFORE the change,
  // while this computer's id and the address are still the ones the link was made with; saved
  // first, the link's last words would go out under the new id on a socket opened under the old
  // one, and the relay refuses those. When the change is not saved the
  // link is made again as it was, and the account is told nothing.
  function swap(change) {
    const service = remote();
    service.relayGoing();
    const result = change();
    if (!result.ok) service.relayChanged();
    return result;
  }

  // After the relay was saved or removed.
  function changed() {
    const service = remote();

    // The link first, the account second: a link made again must end up in the state the account
    // gives it (signed out = stopped), not the other way round.
    service.relayChanged();
    const user = userAuth.publicState()?.user;

    // The relay was removed and nobody is signed in: the pairings made through it are removed now
    // (the user was asked, see clear()), by naming an account that is nobody's. Left in place they
    // would be removed without a question at the next sign-in.
    if (!ownRelay.active() && !ownRelay.held() && !user) service.accountChanged(true, NOBODY);
    service.accountChanged(...who(user));
    return { ...ownRelay.get(), state: service.state() };
  }

  // The answer that asks the user first, or null when the change removes no pairing. A change of
  // the account behind the link removes every pairing, right and the log (accountChanged in
  // remote-service.js); a change of address or secret alone keeps the account and removes
  // nothing.
  function askFirst(signedIn, account) {
    const count = signedIn && account ? remote().wouldRemove(account) : 0;
    return count > 0 ? { ok: false, error: 'would_remove', count } : null;
  }

  const get = () => ownRelay.get();

  // Save a relay. Without `confirm` nothing is changed when pairings would be removed: the answer
  // is { ok: false, error: 'would_remove', count } and the page asks, then calls again.
  function set(urlText, secretText, confirm) {
    // What was typed is checked before the question, so nobody agrees to lose pairings for an
    // address that is then refused; and before the link is ended, so a typo does not cost the
    // connection.
    const typed = ownRelay.check(urlText, secretText);
    if (!typed.ok) return typed;
    if (confirm !== true) {
      const ask = askFirst(true, ACCOUNT_ID);
      if (ask) return ask;
    }
    const r = swap(() => ownRelay.set(urlText, secretText));
    return r.ok ? { ok: true, ...changed() } : r;
  }

  // Remove the relay. The account that follows is the signed-in Technically Not account, or
  // nobody's: either way the pairings made through the relay go, so the user is asked first.
  function clear(confirm) {
    if (confirm !== true) {
      const user = userAuth.publicState()?.user;
      const ask = askFirst(true, user?.id || NOBODY);
      if (ask) return ask;
    }
    const r = swap(() => ownRelay.clear());
    return r.ok ? { ok: true, ...changed() } : r;
  }

  // Remove an unpaired computer from the user's own relay (Remove on its card). A paired one is
  // refused: Forget is its way out, which also tells that computer. The list is read again after,
  // so the page shows what the relay now holds.
  async function forgetDevice(id) {
    if (!ownRelay.active()) return { ok: false, error: 'no_relay' };
    const service = remote();
    if ((service.state().computers || []).some(c => c.id === id))
      return { ok: false, error: 'paired' };
    const r = await ownRelay.forget(selfId(), id);
    if (!r.ok) return r;
    return { ok: true, state: await service.refresh() };
  }

  return { selfId, who, url, getTicket, devices, freeIds, get, set, clear, forgetDevice };
}

module.exports = { createOwnRelayWiring };
