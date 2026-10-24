// Technically Not tools · live-progress-test.js — live progress in a thread
// (src/scripts/176-live-progress.js): the clock's words, the checklist's segments, and that the
// line gets a clock and a bar only while a task with a checklist runs. Runs the real file with a
// small stand-in for the page. Run: node tools/live-progress-test.js
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

// a small stand-in element: children, classes, text, hidden, dataset
function element(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    hidden: false,
    dataset: {},
    title: '',
    children: [],
    isConnected: true,
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(...items) {
      for (const item of items) {
        if (typeof item === 'string') this.textContent += item;
        else {
          this.children.push(item);
          this.textContent += item.textContent || '';
        }
      }
    },
    replaceChildren(...items) {
      this.children = [];
      this.textContent = '';
      this.append(...items);
    },
    querySelector(selector) {
      const want = selector.replace(':scope > ', '');
      if (want === 'span') return this.children.find(c => c.tag === 'span') || null;
      return this.children.find(c => '.' + c.className === want) || null;
    },
    closest: () => null,
  };
  return node;
}

let turn = null;
const context = {
  window: { TnaiTurns: { get: () => turn } },
  document: { createElement: element },
  Date,
  Math,
  Number,
  String,
  setInterval: () => 1,
  clearInterval() {},
};
vm.runInNewContext(source('src/scripts/176-live-progress.js'), context);
const live = context.window.TnaiLiveProgress;

// 1. the clock's words
check(live.clockText(0) === '0:00', 'zero');
check(live.clockText(134000) === '2:14', 'minutes and seconds');
check(live.clockText(3729000) === '1:02:09', 'hours');

// 2. the segments
const kinds = steps => live.segments(steps).join(',');
check(kinds({ index: 3, total: 6, done: 2 }) === 'done,done,now,,,', 'two done, the third now');
check(kinds(null) === '' && kinds({ total: 0 }) === '', 'no checklist: no segments');
check(
  live.segments({ index: 30, total: 40, done: 29 }).length === 12,
  'a long list is drawn as 12'
);
check(
  live.segments({ index: 30, total: 40, done: 29 }).filter(k => k === 'done').length === 8,
  'filled in proportion'
);

// 3. painting the line
function line(tone, words) {
  const node = element('div');
  node.dataset.tone = tone;
  const say = element('span');
  say.textContent = words;
  node.children.push(say);
  return node;
}
turn = {
  startedAt: Date.now() - 134000,
  endedAt: 0,
  steps: { index: 3, total: 6, done: 2, text: 'Write the test' },
};
const working = line('work', 'Working · Editing a file · 3/6');
live.paint({ live: working, paneId: 'p1' });
const clock = working.querySelector('.tnt-live-clock');
const bar = working.querySelector('.tnt-live-check');
check(
  clock && !clock.hidden && /^2:1[45]$/.test(clock.textContent),
  'a running task shows its clock: ' + clock?.textContent
);
check(
  bar && !bar.hidden && /Step 3 of 6: Write the test/.test(bar.textContent),
  'and its checklist with the item'
);
check(working.children[0].textContent === 'Working · Editing a file', 'the count leaves the words');

turn = { startedAt: Date.now() - 5000, endedAt: 0, steps: null };
const plain = line('work', 'Working');
live.paint({ live: plain, paneId: 'p1' });
check(plain.querySelector('.tnt-live-check').hidden, 'no checklist: no bar');

turn = { startedAt: Date.now() - 5000, endedAt: Date.now(), steps: null };
const needs = line('needs', 'Needs you');
live.paint({ live: needs, paneId: 'p1' });
check(
  needs.querySelector('.tnt-live-clock').hidden,
  'a line that is not a running task has no clock'
);

// 4. the hooks
const readable = source('src/scripts/122-thread-readable.js');
check(/TnaiLiveProgress\?\.paint/.test(readable), '122 paints the progress after the line');
check(
  /tnt-fresh/.test(readable) && /redrawing/.test(readable),
  'new lines are marked, a redraw is not'
);
const css = source('src/styles/55-live-progress.css');
check(/prefers-reduced-motion/.test(css), 'the motion stops under reduced motion');
check(
  /176-live-progress\.js/.test(source('index.html')) &&
    /55-live-progress\.css/.test(source('index.html')),
  'index.html loads both'
);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
