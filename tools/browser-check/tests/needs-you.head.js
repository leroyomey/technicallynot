// Stub window.tnaiNative.attention for 71-needs-you.js only: every other script still sees the
// browser build (no tnaiNative).
(() => {
  const subs = [],
    stub = {
      attention: {
        calls: [],
        list: async () => ({ items: [], held: [] }),
        on: cb => subs.push(cb),
        onDelivered: cb => {
          stub.attention.delivered = cb;
        },
        onJump: cb => {
          stub.attention.jumped = cb;
        },
        cancelHeld: async id => {
          stub.attention.calls.push(['cancel', id]);
          return 'raw held text';
        },
        sendHeldNow: async id => {
          stub.attention.calls.push(['send', id]);
          return { ok: true, state: 'sent' };
        },
        notify: async o => {
          stub.attention.calls.push(['notify', o.title]);
          return true;
        },
        push: s => subs.forEach(cb => cb(s)),
      },
      pty: { write: async () => true },
    };
  window.__attention = stub.attention;
  Object.defineProperty(window, 'tnaiNative', {
    configurable: true,
    get() {
      return /71-needs-you\.js$/.test(document.currentScript?.src || '') ? stub : undefined;
    },
  });
})();
