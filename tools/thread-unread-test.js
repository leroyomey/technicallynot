// Technically Not tools · thread-unread-test.js — the unread dot and the count
// (src/scripts/174-thread-unread.js): a task that ends while the user looks elsewhere is news once,
// opening the thread or coming back to the window clears it, history from before the start does
// not count, and the taskbar is told the total once per change. Runs the real file with a small
// stand-in for the page. Run: node tools/thread-unread-test.js
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

const listeners = {};
const on = (name, handler) => (listeners[name] = [...(listeners[name] || []), handler]);
const fire = (name, detail) => (listeners[name] || []).forEach(handler => handler({ detail }));
const turns = new Map();
const badges = [];
let changes = 0;
let focused = true;
const context = {
  Date,
  Math,
  Number,
  String,
  Map,
  Promise,
  window: {
    addEventListener: on,
    dispatchEvent: event => {
      if (event.type === 'tnai:unread-changed') changes++;
    },
    TnaiTurns: { get: paneId => turns.get(paneId) || null },
    tnaiNative: { attention: { badge: (picture, count) => badges.push({ picture, count }) } },
  },
  document: {
    hidden: false,
    hasFocus: () => focused,
    addEventListener: on,
    documentElement: {},
    createElement: () => ({
      getContext: () => ({ beginPath() {}, arc() {}, fill() {}, fillText() {} }),
      toDataURL: () => 'data:image/png;base64,AAAA',
    }),
  },
  getComputedStyle: () => ({ getPropertyValue: () => '#123456' }),
  CustomEvent: class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  },
};
vm.runInNewContext(source('src/scripts/174-thread-unread.js'), context);
const unread = context.window.TnaiUnread;
const now = Date.now();
const end = (paneId, at) => {
  turns.set(paneId, { startedAt: at - 5000, endedAt: at });
  fire('tnai:turn', { paneId });
};

fire('tnai:thread-view', { paneId: 'a' });
end('b', now - 60 * 60 * 1000);
check(!unread.has('b'), 'a task that ended before the window started is not news');
end('b', now + 1000);
check(unread.has('b'), 'a task that ends in another thread is news');
check(changes === 1, 'the title and list are told once');
fire('tnai:turn', { paneId: 'b' });
check(changes === 1, 'the same end again is not news twice');
end('a', now + 2000);
check(!unread.has('a'), 'a task that ends in the thread being read is not news');
focused = false;
end('a', now + 3000);
check(unread.has('a'), 'it is news while the window is in the background');
focused = true;
fire('focus');
check(!unread.has('a'), 'coming back to the window reads the open thread');
check(/Finished a task/.test(unread.tip('b')), 'the hover says what happened');
fire('tnai:thread-view', { paneId: 'b' });
check(!unread.has('b'), 'opening the thread reads it');
end('c', now + 4000);
fire('tnai:terminal-pane-closed', { paneId: 'c' });
check(!unread.has('c'), 'a closed thread leaves nothing to read');

unread.badge(2);
unread.badge(2);
check(badges.length === 1 && badges[0].count === 2, 'the taskbar is told once per change');
check(/^data:image\/png/.test(badges[0].picture), 'with a picture of the number');
unread.badge(0);
check(badges[1].count === 0 && badges[1].picture === '', 'no count: no badge');

// the hooks
const needs = source('src/scripts/71-needs-you.js');
check(
  /TnaiUnread\?\.panes/.test(needs) && /TnaiUnread\?\.badge/.test(needs),
  '71 counts them and sets the badge'
);
check(/tnai:unread-changed/.test(needs), '71 repaints the title when they change');
const list = source('src/scripts/119-thread-list.js');
check(/TnaiUnread\?\.has/.test(list) && /data-unread/.test(list), 'the list draws the dot');
const main = source('desktop/main.js');
const attention = source('desktop/attention-service.js');
check(/handle\('attention:badge'/.test(main), 'main passes the badge to the attention service');
check(/setOverlayIcon/.test(attention), 'the attention service sets the taskbar overlay');
check(/BADGE_MAX/.test(attention), 'it refuses an oversized picture');
check(/attention:badge/.test(source('desktop/preload.js')), 'the bridge has badge');
check(/174-thread-unread\.js/.test(source('index.html')), 'index.html loads it');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
