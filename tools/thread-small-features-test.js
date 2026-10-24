// Technically Not tools · thread-small-features-test.js — the three small thread features of
// 2026-10-22: a draft per thread (src/scripts/16-progress-drafts.js), copying a whole reply
// (src/scripts/172-thread-times.js `stamp`), and find in thread (src/scripts/173-thread-find.js).
// The draft keeper runs with a small stand-in for the page; the rest is checked in the source.
// Run: node tools/thread-small-features-test.js
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

// ---------- 1. a draft per thread, run for real ----------
const store = new Map();
const localStorage = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
const listeners = {};
const on = (name, handler) => (listeners[name] = [...(listeners[name] || []), handler]);
const fire = (name, detail) => (listeners[name] || []).forEach(handler => handler({ detail }));
const sent = [];
const input = { value: '', addEventListener: on, dispatchEvent: () => {} };
const timers = [];
const context = {
  window: {
    addEventListener: on,
    dispatchEvent: event => sent.push(event.type),
  },
  document: { getElementById: () => input, addEventListener: () => {} },
  localStorage,
  CustomEvent: class {
    constructor(type, options) {
      this.type = type;
      this.detail = options?.detail;
    }
  },
  Event: class {
    constructor(type) {
      this.type = type;
    }
  },
  setTimeout: handler => timers.push(handler),
  clearTimeout: () => {},
  JSON,
};
vm.runInNewContext(source('src/scripts/16-progress-drafts.js'), context);
const drafts = context.window.TnaiDrafts;
const typeInto = text => {
  input.value = text;
  fire('input');
  timers.splice(0).forEach(handler => handler());
};

fire('tnai:thread-view', { paneId: 'a' });
typeInto('half a thought for A');
fire('tnai:thread-view', { paneId: 'b' });
check(input.value === '', 'another thread opens with an empty box');
check(drafts.of('a') === 'half a thought for A', "A's draft is kept");
check(sent.includes('tnai:draft-changed'), 'the list is told a draft started');
typeInto('for B');
fire('tnai:thread-view', { paneId: 'a' });
check(input.value === 'half a thought for A', "back on A: A's own draft is in the box");
check(drafts.of('a') === '', 'the open thread reports no draft (it is in the box)');
check(drafts.of('b') === 'for B', "B's draft is kept");
check(JSON.parse(store.get('tnai.draft.threads.v1')).b === 'for B', 'drafts survive a restart');
typeInto('');
fire('tnai:thread-view', { paneId: 'b' });
check(drafts.of('a') === '', 'an emptied box leaves no draft');
fire('tnai:terminal-pane-closed', { paneId: 'b' });
fire('tnai:thread-view', { paneId: '' });
check(!JSON.parse(store.get('tnai.draft.threads.v1')).b, 'a closed thread leaves no draft');
check(input.value === 'for B', "the closed thread's words stay in the box");

// ---------- 2. copy a whole reply ----------
const times = source('src/scripts/172-thread-times.js');
check(
  /tnt-at-copy/.test(times) && /clipboard\.writeText/.test(times),
  'a Copy button that writes the clipboard'
);
check(/execCommand\('copy'\)/.test(times), 'with the older way when the clipboard refuses');
const readable = source('src/scripts/122-thread-readable.js');
check(
  /stamp\?\.\(state, entry\.at, false, block, wordsNow\)/.test(readable),
  '122 gives a reply its Copy button'
);
check(
  /says\.get\(entry\.id\)\?\.words/.test(readable),
  'it copies the words as they are when pressed'
);

// ---------- 3. find in thread ----------
const find = source('src/scripts/173-thread-find.js');
check(/CSS\.highlights/.test(find), 'matches are lit without changing the conversation');
check(/closest\?\.\('\.xterm'\)/.test(find), 'Ctrl+F in a terminal is left to the terminal');
check(
  /MutationObserver/.test(find) && !/setInterval/.test(find),
  'found again when it changes, never polled'
);
check(
  /'Escape'/.test(find) && /shiftKey \? -1 : 1/.test(find),
  'Esc closes, Enter and Shift+Enter step'
);
const css = source('src/styles/54-thread-find.css');
check(
  /::highlight\(tnt-find-now\)/.test(css) && /var\(--pg-accent\)/.test(css),
  'the current match in the accent'
);
const list = source('src/scripts/119-thread-list.js');
check(
  /TnaiDrafts\?\.of/.test(list) && /'tnai:draft-changed'/.test(list),
  'the thread list shows a draft'
);
const index = source('index.html');
check(
  /173-thread-find\.js/.test(index) && /54-thread-find\.css/.test(index),
  'index.html loads find'
);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
