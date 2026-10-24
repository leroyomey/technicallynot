// Technically Not tools · since-you-left-test.js — "New since you left"
// (src/scripts/177-since-you-left.js): leaving a thread remembers its last line; coming back to it
// with the unread dot puts the line right after that, the view goes to the line when new lines came
// under it, and sending in that thread takes the line away. Runs the real file with a small
// stand-in for the page. Run: node tools/since-you-left-test.js
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

// a tiny list of nodes with siblings, enough for 177
function makeList() {
  const list = { children: [] };
  const node = (className, text = '') => {
    const item = {
      className,
      textContent: text,
      offsetTop: 0,
      attributes: {},
      classList: { contains: name => item.className.split(' ').includes(name) },
      setAttribute(name, value) {
        item.attributes[name] = value;
      },
      get isConnected() {
        return list.children.includes(item);
      },
      get nextElementSibling() {
        return list.children[list.children.indexOf(item) + 1] || null;
      },
      get previousElementSibling() {
        return list.children[list.children.indexOf(item) - 1] || null;
      },
      after(other) {
        list.children.splice(list.children.indexOf(item) + 1, 0, other);
      },
      remove() {
        const at = list.children.indexOf(item);
        if (at >= 0) list.children.splice(at, 1);
      },
    };
    return item;
  };
  Object.defineProperty(list, 'lastElementChild', {
    get: () => list.children[list.children.length - 1] || null,
  });
  list.add = (className, text) => {
    const item = node(className, text);
    const live = list.children.find(c => c.className === 'tnt-live');
    if (live) list.children.splice(list.children.indexOf(live), 0, item);
    else list.children.push(item);
    return item;
  };
  list.node = node;
  return list;
}

const listeners = {};
const on = (name, fn) => (listeners[name] = [...(listeners[name] || []), fn]);
const fire = (name, detail) => (listeners[name] || []).forEach(fn => fn({ detail }));
let unreadPanes = [];
const context = {
  window: {
    addEventListener: on,
    TnaiUnread: { panes: () => unreadPanes },
    TnaiTimes: { clock: () => '2:14 PM' },
  },
  document: { createElement: () => null },
  Date,
  Math,
};

// createElement makes a node of the list the line goes into
let current = null;
context.document.createElement = () => current.node('');
vm.runInNewContext(source('src/scripts/177-since-you-left.js'), context);
const since = context.window.TnaiSinceYouLeft;

function thread(paneId) {
  const list = makeList();
  const live = list.node('tnt-live');
  list.children.push(live);
  list.add('tnt-you', 'first prompt');
  list.add('tnt-say', 'first reply');
  return { paneId, sub: '', list, live, host: { scrollTop: 900, offsetTop: 0 } };
}

// 1. left and back with something new
const a = thread('a');
current = a.list;
since.leave(a);
check(a.sinceMark?.textContent === 'first reply', 'leaving remembers the last line read');
unreadPanes = ['a'];
fire('tnai:unread-changed');
unreadPanes = [];
fire('tnai:unread-changed');
since.arrive(a);
const line = a.list.children.find(c => c.className === 'tnt-since');
check(!!line, 'back with the dot: the line is there');
check(
  line?.previousElementSibling?.textContent === 'first reply',
  'right after the last line read'
);
check(/New since you left · 2:14 PM/.test(line?.textContent || ''), 'it says when you left');
a.list.add('tnt-say', 'a new reply');
check(
  since.hold(a) === true && a.host.scrollTop !== 900,
  'new lines under it: the view goes to the line'
);

// 2. sending in that thread takes it away
fire('tnai:prompt-sent', { paneId: 'a' });
check(
  !a.list.children.some(c => c.className === 'tnt-since'),
  'sending in the thread takes the line away'
);

// 3. back without the dot: no line
const b = thread('b');
current = b.list;
since.leave(b);
since.arrive(b);
check(!b.list.children.some(c => c.className === 'tnt-since'), 'no dot: no line');
check(since.hold(b) === false, 'and the view is left to 122');

// 4. the dot, but nothing came in under the line: it goes again
const c = thread('c');
current = c.list;
since.leave(c);
unreadPanes = ['c'];
fire('tnai:unread-changed');
since.arrive(c);
check(since.hold(c) === false, 'nothing new under it: the view is left to 122');
check(!c.list.children.some(x => x.className === 'tnt-since'), 'and the empty line is removed');

// 5. the hooks
const readable = source('src/scripts/122-thread-readable.js');
check(/TnaiSinceYouLeft\?\.leave/.test(readable), '122 tells it when a thread leaves');
check(/TnaiSinceYouLeft\?\.arrive/.test(readable), '122 tells it when a thread comes back');
check(
  /TnaiSinceYouLeft\?\.hold/.test(readable) && /!held && \(stick \|\| first\)/.test(readable),
  'a held view is not moved to the end'
);
check(/177-since-you-left\.js/.test(source('index.html')), 'index.html loads it');
check(/\.tnt-since/.test(source('src/styles/53-thread-times.css')), 'the line has its look');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
