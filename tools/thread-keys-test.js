// Technically Not tools · thread-keys-test.js — the keyboard set (src/scripts/175-thread-keys.js):
// Ctrl+Alt+Up/Down opens the previous / next thread in the list's order, Ctrl+P opens the Files tab
// and its search, Ctrl+J opens Your terminal and goes back to the prompt box from it, and inside
// another terminal the keys stay the terminal's. Runs the real file with a small stand-in for the
// page. Run: node tools/thread-keys-test.js
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

// a stand-in element that knows whether it sits inside a terminal
function element(id, inTerm, inOwn) {
  return {
    id,
    focused: false,
    focus() {
      this.focused = true;
    },
    select() {},
    closest: selector => (selector === '.xterm' && inTerm ? {} : null),
    inOwn,
  };
}

let selected = 'a';
const shown = [];
const sideOpened = [];
let ownOpened = 0;
const rows = ['a', 'b', 'c'].map(id => ({ dataset: { pane: id }, getClientRects: () => [1] }));
const search = element('repoRailSearch', false);
const prompt = element('prompt', false);
const ownBox = element('own', true, true);

// every listener the file adds, by event type, in the order it adds them
const handlers = { keydown: [], keyup: [] };
let dialogs = [];

const window = {
  tnaiPlatform: { mod: event => !!event.ctrlKey },
  TnaiThreads: {
    selected: () => selected,
    show: id => {
      shown.push(id);
      selected = id;
      return true;
    },
    open() {},
  },
  TnaiThreadSide: { open: tab => sideOpened.push(tab) },
  TnaiOwnTerminal: {
    open: () => ownOpened++,
    term: () => ({ element: { contains: target => !!target && target.inOwn === true } }),
  },
};
const context = {
  window,
  document: {
    activeElement: null,
    addEventListener: (type, fn) => {
      (handlers[type] = handlers[type] || []).push(fn);
    },
    querySelectorAll: selector => (selector.includes('dialog') ? dialogs : rows),
    getElementById: id => (id === 'repoRailSearch' ? search : id === 'prompt' ? prompt : null),
  },
  requestAnimationFrame: fn => fn(),
};
vm.runInNewContext(source('src/scripts/175-thread-keys.js'), context);

function press(key, opts = {}, target = element('body', false)) {
  const event = {
    key,
    ctrlKey: true,
    altKey: !!opts.alt,
    shiftKey: !!opts.shift,
    repeat: false,
    target,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
  };
  handlers.keydown.forEach(fn => fn(event));
  return event;
}

// 1. previous / next thread
press('ArrowDown', { alt: true });
check(selected === 'b', 'Ctrl+Alt+Down opens the next thread');
press('ArrowDown', { alt: true });
press('ArrowDown', { alt: true });
check(selected === 'a', 'it wraps from the last to the first');
press('ArrowUp', { alt: true });
check(selected === 'c', 'Ctrl+Alt+Up opens the previous one, wrapping');
const inCli = press('ArrowDown', { alt: true }, element('cli', true));
check(!inCli.prevented && selected === 'c', 'inside a CLI screen the key stays the terminal’s');

// 2. Ctrl+P: the Files tab and its search
const p = press('p');
check(p.prevented && sideOpened.includes('files'), 'Ctrl+P opens the Files tab');
check(search.focused, 'and its search has the keyboard');
check(
  !press('p', {}, element('cli', true)).prevented,
  'Ctrl+P inside a terminal stays the terminal’s'
);

// 3. Ctrl+J: Your terminal, and back
const j = press('j');
check(j.prevented && ownOpened === 1, 'Ctrl+J opens Your terminal');
const back = press('j', {}, ownBox);
check(
  back.prevented && prompt.focused && ownOpened === 1,
  'Ctrl+J in Your terminal goes back to the prompt box'
);
check(
  !press('j', {}, element('cli', true)).prevented,
  'Ctrl+J in a CLI screen stays the program’s'
);
check(!press('j', { shift: true }).prevented, 'Ctrl+Shift+J is left to Needs you');

// 3b. Ctrl+Alt+Shift+Down: the next thread with a dot or a question, skipping the rest
selected = 'a';
window.TnaiUnread = { has: id => id === 'c' };
window.TnaiNeedsYou = { has: () => false };
press('ArrowDown', { alt: true, shift: true });
check(selected === 'c', 'the next thread with something for you, skipping b');
window.TnaiUnread = { has: () => false };
const none = press('ArrowDown', { alt: true, shift: true });
check(none.prevented && selected === 'c', 'with nothing waiting, the open thread stays');

// 3c. The thread list: Up / Down open the thread they reach, and the keyboard stays in the list.
// 119 moves the keyboard and takes the key; `listKey` does that part, then sends the key on.
const doc = context.document;
const opened = [];
const listRows = [];
const listBox = {
  contains: node => listRows.includes(node),
  querySelectorAll: () => listRows,
};
const away = element('own terminal', true, true);

function listRow(key) {
  const row = {
    dataset: { key, pane: key },
    isConnected: true,
    closest: selector => (selector === '.tnt-th' ? row : null),
    focus() {
      doc.activeElement = row;
    },
    click() {
      opened.push(key);

      // opening a thread can hand the keyboard elsewhere (Your terminal giving its place back)
      doc.activeElement = away;
    },
  };
  listRows.push(row);
  return row;
}
const [rowA, rowB, rowC] = ['a', 'b', 'c'].map(listRow);
window.TnaiThreads.slot = name => (name === 'list' ? listBox : null);

function listKey(key, from, to, opts = {}) {
  if (to) doc.activeElement = to;
  const event = {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: !!opts.repeat,
    target: from,
    defaultPrevented: !!to,
    preventDefault() {},
    stopPropagation() {},
  };
  handlers.keydown.forEach(fn => fn(event));
  return event;
}
const letGo = key => handlers.keyup.forEach(fn => fn({ key }));

listKey('ArrowDown', rowA, rowB);
check(opened.join() === 'b', 'Down in the list opens the next thread');
check(doc.activeElement === rowB, 'and the keyboard stays on its row');
listKey('ArrowUp', rowB, rowA);
check(opened.join() === 'b,a', 'Up opens the previous thread');
listKey('End', rowA, rowC);
check(opened.join() === 'b,a,c', 'End opens the last thread');
listKey('ArrowDown', rowC, null);
check(opened.length === 3, 'at the bottom of the list nothing opens');
listKey('ArrowUp', rowC, rowB, { repeat: true });
listKey('ArrowUp', rowB, rowA, { repeat: true });
check(opened.length === 3, 'a held key only moves the keyboard');
letGo('ArrowUp');
check(opened.join() === 'b,a,c,a' && doc.activeElement === rowA, 'letting go opens the last row');
letGo('ArrowUp');
check(opened.length === 4, 'one more let-go opens nothing');

// a row drawn again while it opens: the new row with the same key gets the keyboard
const rowD = listRow('d');
const rowDAgain = listRow('d');
rowDAgain.isConnected = true;
rowD.click = () => {
  opened.push('d');
  rowD.isConnected = false;
  listRows.splice(listRows.indexOf(rowD), 1);
  doc.activeElement = away;
};
listKey('ArrowDown', rowC, rowD);
check(doc.activeElement === rowDAgain, 'a row drawn again gets the keyboard back by its key');

// the prompt box and other fields keep their arrows
const promptBox = { closest: () => null };
listKey('ArrowDown', promptBox, rowA);
check(opened.length === 5, 'arrows from the prompt box never open a thread');

// 3d. All threads: Left / Right, the previous / next card
const moved = [];
window.TnaiAllThreads = {
  on: true,
  go: by => {
    moved.push(by);
    return true;
  },
};
const owner = kind => ({ closest: selector => (selector.split(', ').includes(kind) ? {} : null) });
const page = owner('none');

function sideKey(key, target, opts = {}) {
  const event = {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: !!opts.shift,
    repeat: !!opts.repeat,
    target,
    defaultPrevented: !!opts.taken,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
  };
  handlers.keydown.forEach(fn => fn(event));
  return event;
}

const right = sideKey('ArrowRight', page);
check(right.prevented && moved.join() === '1', 'Right shows the next card');
sideKey('ArrowLeft', page);
check(moved.join() === '1,-1', 'Left shows the previous card');
const held = sideKey('ArrowRight', page, { repeat: true });
check(held.prevented && moved.length === 2, 'a held key moves once');
for (const kind of ['textarea', 'input', '.xterm', '[role="menu"]', '[role="tablist"]']) {
  const kept = sideKey('ArrowRight', owner(kind));
  check(!kept.prevented && moved.length === 2, kind + ' keeps its arrows');
}
sideKey('ArrowRight', page, { taken: true });
check(moved.length === 2, 'a key another part took (a column edge) is left to it');
sideKey('ArrowRight', page, { shift: true });
check(moved.length === 2, 'Shift+Right is left alone');
dialogs = [{ getClientRects: () => [1] }];
sideKey('ArrowRight', page);
check(moved.length === 2, 'with a dialog open the arrows stay in it');
dialogs = [];
window.TnaiAllThreads.on = false;
const off = sideKey('ArrowRight', page);
check(!off.prevented && moved.length === 2, 'off All threads Left / Right do nothing');

// 4. the list and the page
const list = source('src/scripts/32-theme-and-shortcuts.js');
check(
  /open the previous \/ next thread/.test(list) && /no text box has the keyboard/.test(list),
  'the shortcut list names the plain arrows'
);
check(
  /group: 'Threads'/.test(list) && /Previous \/ next thread/.test(list),
  'the shortcut list has the Threads group'
);
check(/175-thread-keys\.js/.test(source('index.html')), 'index.html loads it');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
