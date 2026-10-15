// Test of two page scripts run in plain Node with a stand-in window: node
// tools/page-leftovers-test.js
// 1. src/scripts/31-live-preview.js: a project switch while the old project's package.json is
//    still being read must not show the old project's scripts under the new project.
// 2. src/scripts/75-report-highlight.js: a terminal closed while a pass waits must not be read
//    afterwards, and its view must no longer be watched.
// Nothing here opens a window or starts a process.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;

function check(name, ok, detail) {
  console.log((ok ? 'ok   ' : 'FAIL ') + name + (detail ? ' (' + detail + ')' : ''));
  if (!ok) failed++;
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

// A window with just what the two scripts touch when they load.
function makeWindow(extra) {
  const listeners = {};
  const element = () => ({
    setAttribute() {},
    append() {},
    addEventListener() {},
    querySelector: () => element(),
    querySelectorAll: () => [element(), element()],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    style: {},
  });
  const document = {
    hidden: false,
    head: { append() {} },
    createElement: element,
    addEventListener() {},
    getElementById: () => null,
    querySelector: () => null,
  };
  const storage = new Map();
  const win = {
    document,
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
    },
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    console,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener() {},
    fire(type, detail) {
      (listeners[type] || []).forEach(fn => fn({ detail }));
    },
    ...extra,
  };
  win.window = win;
  return vm.createContext(win);
}

function load(win, file) {
  const code = fs.readFileSync(path.join(root, 'src', 'scripts', file), 'utf8');
  vm.runInContext(code, win, { filename: file });
}

async function livePreview() {
  // Project A has a dev script; project B has none. Reading A's package.json is held until the
  // switch to B has finished.
  const files = { 'C:\\A': { 'package.json': '{"scripts":{"dev":"vite"}}' }, 'C:\\B': {} };
  let current = 'C:\\A';
  let release;
  const held = new Promise(resolve => (release = resolve));
  const native = {
    fs: {
      root: async () => current,
      stat: async rel => {
        const text = files[current][rel];
        return text === undefined ? { ok: false } : { ok: true, value: { size: text.length } };
      },
      read: async rel => {
        const from = current;
        if (from === 'C:\\A') await held;
        return { ok: true, value: new TextEncoder().encode(files[from][rel]) };
      },
    },
    pty: { onData() {}, onExit() {}, replay: async () => null },
  };
  const win = makeWindow({ tnaiNative: native });
  load(win, '31-live-preview.js');
  const preview = win.TnaiLivePreview;

  win.fire('tnai:project-changed');
  await settle();
  current = 'C:\\B';
  win.fire('tnai:project-changed');
  await settle();
  release();
  await settle();
  check('live preview: project is B after A then B', preview.project() === 'C:\\B');
  check(
    "live preview: B shows none of A's scripts",
    preview.scripts().length === 0,
    'scripts: ' + JSON.stringify(preview.scripts().map(s => s.name))
  );
}

async function reportHighlight() {
  let observed = 0;
  let disconnected = 0;

  class Observer {
    observe() {
      observed++;
    }
    disconnect() {
      disconnected++;
    }
  }
  const win = makeWindow({});
  win.document.defaultView = { IntersectionObserver: Observer };
  load(win, '75-report-highlight.js');

  let written = null;
  let disposed = false;
  let readsAfterDispose = 0;
  const buffer = { type: 'normal', length: 0, baseY: 0, cursorY: 0, viewportY: 0, getLine() {} };
  const term = {
    element: { ownerDocument: win.document, append() {} },
    options: { theme: {} },
    rows: 24,
    buffer: {
      get active() {
        if (disposed) readsAfterDispose++;
        return buffer;
      },
      onBufferChange() {},
    },
    onWriteParsed: fn => (written = fn),
    onResize() {},
    onScroll() {},
    registerMarker: () => ({ line: 0, isDisposed: false, dispose() {} }),
    registerDecoration: () => null,
    registerLinkProvider() {},
    dispose() {
      disposed = true;
    },
  };
  win.TnaiReportHighlight.attach(term);

  // output arrives (a pass is due 150 ms later), then the terminal is closed at once
  written();
  term.dispose();
  await new Promise(resolve => setTimeout(resolve, 250));
  check('report highlight: the terminal itself was disposed', disposed);
  check(
    'report highlight: no pass reads a closed terminal',
    readsAfterDispose === 0,
    'reads after close: ' + readsAfterDispose
  );
  check(
    'report highlight: the closed view is no longer watched',
    observed === 1 && disconnected === 1,
    'observed ' + observed + ', disconnected ' + disconnected
  );
}

(async () => {
  await livePreview();
  await reportHighlight();
  console.log(failed ? failed + ' failed' : 'all passed');
  process.exitCode = failed ? 1 : 0;
})();
