// Technically Not browser check · needs-you.head.js — runs after the shared empty desktop bridge
// (tools/browser-check/stand-in.js) and before the app's scripts. It puts in the one part of the
// bridge 71-needs-you.js needs answers from, `attention`, recording what the page asks of it; every
// other part stays the empty stand-in, so the page is the thread layout. (Before 2026-10-28 this
// file hid the bridge from every script but 71, so the page drew the deleted old frame.)
(() => {
  const subs = [];
  const attention = {
    calls: [],
    list: async () => ({ items: [], held: [] }),
    on: callback => {
      subs.push(callback);
      return () => {};
    },
    onDelivered: callback => {
      attention.delivered = callback;
      return () => {};
    },
    onJump: callback => {
      attention.jumped = callback;
      return () => {};
    },
    cancelHeld: async id => {
      attention.calls.push(['cancel', id]);
      return 'raw held text';
    },
    sendHeldNow: async id => {
      attention.calls.push(['send', id]);
      return { ok: true, state: 'sent' };
    },
    notify: async options => {
      attention.calls.push(['notify', options.title]);
      return true;
    },
    push: state => subs.forEach(callback => callback(state)),
  };
  window.__attention = attention;
  window.__standIn.use('native.attention', attention);
})();
