// Technically Not browser check · stand-in.js — runs before every test's own .head.js and before
// the app's scripts (server.py puts it there). The app is the thread layout, and the thread layout
// is built only when the desktop bridge (window.tnaiNative) is there; without it the page drew the
// deleted old frame (left nav, Overview, Agent Tree), so every browser test measured views that are
// gone (found 2026-10-28, bug sweep: the browser tests). This gives the page an empty stand-in for
// the whole bridge: every part of it exists, every call does nothing and answers "nothing" (no
// agents, no files, no threads), and every `on...` call returns a way to stop listening. So each
// test sees the thread layout a fresh desktop app shows, with the real scripts, and no old page.
// (Written by Ion for smoke on 2026-10-28 as smoke.head.js; shared by every test since.)
//
// An "empty" value is one stand-in object that reads as nothing wherever the app puts it: it is
// never awaited as a promise, iterates nothing, has length 0, turns into '' or 0, and every
// property of it or call on it gives the same empty value again.
//
// A test's own .head.js puts in the parts it needs with window.__standIn:
//   __standIn.use('native.attention', { list: async () => ... })  a part of its own
//   __standIn.answers.set('native.remote.state', null)             one call's answer
(() => {
  const noop = () => {};

  // Data from a call: one shared empty value.
  const emptyTarget = function () {};
  const empty = new Proxy(emptyTarget, {
    get(target, key) {
      if (key === 'then' || key === 'toJSON') return undefined;
      if (key === Symbol.iterator) return function* () {};
      if (key === Symbol.asyncIterator) return undefined;
      if (key === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
      if (key === 'length' || key === 'size') return 0;
      if (key === 'toString' || key === 'valueOf') return () => '';
      return empty;
    },
    apply() {
      return empty;
    },
    has() {
      return false;
    },
    ownKeys() {
      return Reflect.ownKeys(emptyTarget);
    },
  });

  // Calls whose empty value reads as "something is there": the empty value is truthy in every
  // field, so these answer what a fresh app's bridge answers instead. The Devices page took the
  // empty state for a pairing in progress and opened its "Pair with" dialog.
  // The same for the open project and the running terminals, which every page asks at start:
  // their shapes as main.js answers a fresh app (no folder, no project, no terminal).
  const answers = new Map([
    ['native.remote.state', null],
    ['native.remote.refresh', null],
    ['native.fs.root', null],
    ['native.fs.projects', { ok: true, value: { active: '', projects: [] } }],
    ['native.pty.list', []],
  ]);

  // Parts a test's own head puts in, by their full name ('native.attention').
  const overrides = new Map();

  // A part of the bridge: a call to it answers an empty value later, as the real bridge answers
  // through IPC; `on...` and `off...` subscribe and give back a way to stop.
  const parts = new Map();
  const part = name => {
    if (overrides.has(name)) return overrides.get(name);
    if (parts.has(name)) return parts.get(name);
    const node = new Proxy(function () {}, {
      // A plain value the bridge gives at once (native.windowsBuild) reads as '' or 0 too.
      get(target, key) {
        if (key === Symbol.toPrimitive) return hint => (hint === 'number' ? 0 : '');
        if (key === 'then' || typeof key === 'symbol') return undefined;
        return part(name + '.' + key);
      },
      apply() {
        const last = name.split('.').pop();
        if (/^(on|off)([A-Z]|$)/.test(last)) return noop;
        if (answers.has(name)) return Promise.resolve(answers.get(name));
        return Promise.resolve(empty);
      },
    });
    parts.set(name, node);
    return node;
  };

  window.tnaiNative = part('native');
  window.__standIn = { parts, answers, use: (name, value) => overrides.set(name, value) };
})();
