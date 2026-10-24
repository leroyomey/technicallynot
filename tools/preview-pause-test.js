// Technically Not tools · preview-pause-test.js — a Live preview frame out of sight stops after a
// short wait and comes back when shown (src/scripts/180-preview-pause.js, user 2026-10-23). Runs
// the real file with stand-ins for the intersection observer, the clock and the frames.
// Run: node tools/preview-pause-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

// A frame: its src attribute and dataset, as the browser keeps them.
function frame(src) {
  const node = {
    isConnected: true,
    dataset: { src },
    attrs: { src },
    getAttribute: name => node.attrs[name] ?? null,
    loads: 0,
  };
  Object.defineProperty(node, 'src', {
    get: () => node.attrs.src,
    set: value => {
      node.attrs.src = value;
      node.loads++;
    },
  });
  return node;
}

// The clock: timers run only when the test moves time on.
let now = 0;
let timers = [];
const setTimeout = (fn, ms) => {
  const timer = { at: now + ms, fn };
  timers.push(timer);
  return timer;
};
const clearTimeout = timer => {
  timers = timers.filter(other => other !== timer);
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const wait = async ms => {
  now += ms;
  const due = timers.filter(timer => timer.at <= now);
  timers = timers.filter(timer => timer.at > now);
  due.forEach(timer => timer.fn());
  await settle();
};

let seen = null;
const observed = [];

class IntersectionObserver {
  constructor(callback) {
    seen = callback;
  }
  observe(target) {
    observed.push(target);
  }
}
const sight = (target, visible) =>
  seen([{ target, isIntersecting: visible, intersectionRect: { width: visible ? 300 : 0 } }]);

const frames = [];
let onVisibility = null;
const document = {
  hidden: false,
  querySelectorAll: () => frames,
  addEventListener: (type, fn) => {
    if (type === 'visibilitychange') onVisibility = fn;
  },
};
const kept = [];
const native = {
  preview: { nav: (name, what) => (kept.push(name + ':' + what), Promise.resolve('')) },
};
const context = {
  window: { tnaiNative: native },
  document,
  setTimeout,
  clearTimeout,
  IntersectionObserver,
  WeakMap,
  WeakSet,
  Map,
};
vm.runInNewContext(source('src/scripts/180-preview-pause.js'), context);
const pause = context.window.TnaiPreviewPause;

(async () => {
  // 1. a frame 31 makes is watched
  const page = frame('http://localhost:5173/');
  page.name = 'tnai-lp-test-1';
  pause.watch(page);
  check(observed.includes(page), 'a new frame is watched');
  sight(page, true);
  check(page.src === 'http://localhost:5173/' && !pause.paused(page), 'on screen it runs');

  // 2. out of sight: still running for a moment, stopped after the wait
  sight(page, false);
  await wait(1000);
  check(!pause.paused(page), 'a quick look elsewhere does not stop it');
  sight(page, true);
  await wait(5000);
  check(!pause.paused(page) && page.loads === 0, 'back within the wait: nothing reloads');
  sight(page, false);
  await wait(3000);
  check(pause.paused(page) && page.src === 'about:blank', 'out of sight for the wait: stopped');
  check(page.dataset.pausedSrc === 'http://localhost:5173/', 'its address is kept');
  check(kept.includes('tnai-lp-test-1:keep'), 'its scroll is noted before it stops');

  // 3. shown again: its address comes back at once
  sight(page, true);
  check(
    page.src === 'http://localhost:5173/' && !pause.paused(page),
    'shown again: it loads again'
  );

  // 4. the tab moved to another address while stopped: that one wins
  sight(page, false);
  await wait(3000);
  page.dataset.src = 'http://localhost:5173/about';
  sight(page, true);
  check(page.src === 'http://localhost:5173/about', 'the newest address of the tab comes back');

  // 5. a minimized window stops every frame, and brings back the ones on screen
  frames.push(page);
  document.hidden = true;
  onVisibility();
  await wait(3000);
  check(pause.paused(page), 'a minimized window stops its previews');
  document.hidden = false;
  onVisibility();
  check(
    !pause.paused(page) && page.src === 'http://localhost:5173/about',
    'back: the shown one runs again'
  );

  // 6. a frame with no page and a frame gone from the page are left alone
  const empty = frame('');
  pause.watch(empty);
  sight(empty, false);
  await wait(3000);
  check(!pause.paused(empty), 'an empty frame is not touched');
  const gone = frame('http://localhost:3000/');
  pause.watch(gone);
  sight(gone, false);
  gone.isConnected = false;
  await wait(3000);
  check(!pause.paused(gone), 'a closed tab is not touched');

  // 7. wiring
  const live = source('src/scripts/31-live-preview.js');
  check(
    (live.match(/TnaiPreviewPause\?\.watch\?\.\(f\)/g) || []).length === 2,
    '31 hands over both kinds of frame it makes'
  );
  check(/180-preview-pause\.js/.test(source('index.html')), 'index.html loads it');

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
