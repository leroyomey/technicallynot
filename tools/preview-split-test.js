// Technically Not tools · preview-split-test.js — a page beside the thread
// (src/scripts/179-preview-split.js): the split icon opens the page in the side column's Live
// preview tab at half the room, the same icon or Esc pushes it back to the width and state the
// column had, another page swaps it, and the user's own width is never overwritten. Runs the real
// file with a small stand-in for the page. Run: node tools/preview-split-test.js
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

function element(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    innerHTML: '',
    title: '',
    type: '',
    children: [],
    attributes: {},
    listeners: {},
    isConnected: true,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    append(...items) {
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    remove() {
      this.removed = (this.removed || 0) + 1;
    },
    addEventListener(type, fn) {
      this.listeners[type] = fn;
    },
    querySelector(selector) {
      const want = selector.replace(/^\./, '');
      const walk = list => {
        for (const child of list) {
          if (child.className && child.className.split(' ').includes(want)) return child;
          const deeper = walk(child.children || []);
          if (deeper) return deeper;
        }
        return null;
      };
      return walk(this.children);
    },
    click() {
      return this.listeners.click?.({ stopPropagation() {} });
    },
  };
  node.classList = {
    add: name => (node.className += ' ' + name),
  };
  return node;
}

const styleProps = { '--tnt-side-w': '410px' };
const layout = {
  clientWidth: 1600,
  classList: { add() {}, remove() {} },
  style: {
    getPropertyValue: name => styleProps[name] || '',
    setProperty: (name, value) => (styleProps[name] = value),
    removeProperty: name => delete styleProps[name],
  },
  querySelector: () => ({ offsetWidth: 300 }),
};
const previews = [];
let sideShown = false;
let sideClosed = 0;
const side = {
  preview: (node, show) => previews.push({ node, show }),
  state: () => ({ shown: sideShown }),
  close: () => sideClosed++,
};
const selected = [];
let keydown = null;
const context = {
  window: {
    TnaiThreadSide: side,
    TnaiLivePreview: {
      addUrl: url => ({ ok: true, id: 'tab-' + url }),
      select: id => selected.push(id),
      mount() {},
    },
    TnaiIcon: () => '<svg></svg>',
  },
  document: {
    querySelector: () => layout,
    createElement: element,
    addEventListener: (type, fn) => {
      if (type === 'keydown') keydown = fn;
    },
  },
  setTimeout: () => 0,
  Promise,
  Math,
};
vm.runInNewContext(source('src/scripts/179-preview-split.js'), context);
const split = context.window.TnaiPreviewSplit;
const settle = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // 1. a card's icon opens the page beside the thread at half the room
  const card = element('button');
  const cell = split.cell(card, () => 'http://127.0.0.1:5000/', 'Site');
  check(
    cell.children[0] === card && cell.children[1].className.includes('tnt-split-push'),
    'the card keeps its place, the icon beside it'
  );
  await cell.children[1].click();
  await settle();
  check(split.shown() === 'http://127.0.0.1:5000/', 'the page is beside the thread');
  check(selected.includes('tab-http://127.0.0.1:5000/'), 'Live preview shows that address');
  check(previews.at(-1)?.show === true, 'the side column shows its preview tab');
  check(
    styleProps['--tnt-side-w'] === '650px',
    'the column takes half the room: ' + styleProps['--tnt-side-w']
  );
  check(cell.children[1].attributes['aria-pressed'] === 'true', 'the icon says its page is open');

  // 2. another page swaps it; the width the column had is still remembered
  const page = split.button(
    () => Promise.resolve('http://127.0.0.1:5000/s/abc/page.html'),
    'page.html'
  );
  await page.click();
  await settle();
  check(split.shown().endsWith('page.html'), 'another page swaps what shows');
  check(cell.children[1].attributes['aria-pressed'] === 'false', 'the first icon lets go');

  // 3. Esc pushes it back to the width and state it had (the column was closed before)
  keydown({ key: 'Escape', target: { closest: () => null }, defaultPrevented: false });
  check(split.shown() === '', 'Esc pushes the page back');
  check(styleProps['--tnt-side-w'] === '410px', 'the column returns to the width the user had');
  check(sideClosed === 1, 'and closes, since it was closed before');

  // 4. Esc in a text box is left alone
  await page.click();
  await settle();
  keydown({ key: 'Escape', target: { closest: () => ({}) }, defaultPrevented: false });
  check(split.shown() !== '', 'Esc while typing does not close it');
  await page.click();
  check(split.shown() === '', 'the same icon again pushes it back');

  // 5. no address: nothing happens
  const none = split.button(() => '', 'gone');
  await none.click();
  await settle();
  check(split.shown() === '', 'a page with no address opens nothing');

  // 5b. a chart's icon pushes the chart beside the thread, drawn large; a page swaps it out
  const big = element('figure');
  const chart = split.chartButton('chart:["Sizes"]', 'Sizes', () => big);
  check(chart.className.includes('tnt-split-push'), 'a chart gets the same split icon');
  await chart.click();
  check(split.shown() === 'chart:["Sizes"]', 'the chart is beside the thread');
  const chartView = previews.at(-1).node;
  check(
    chartView.querySelector('.tnt-split-body').children[0] === big,
    'drawn large in the column'
  );
  check(chartView.querySelector('.tnt-split-name').textContent === 'Sizes', 'named in its bar');
  check(
    chart.attributes['aria-label'] === 'Push the chart back',
    'its icon says it pushes the chart back'
  );
  await page.click();
  await settle();
  check(
    split.shown().endsWith('page.html') && chartView.removed >= 1,
    'a page swaps the chart out'
  );
  await page.click();
  check(
    split.shown() === '' && styleProps['--tnt-side-w'] === '410px',
    'and back to the width it had'
  );
  await chart.click();
  await chart.click();
  check(split.shown() === '', 'the chart icon again pushes it back');

  // 6. the hooks and the page
  const made = source('src/scripts/170-what-it-made.js');
  check(
    /withSplit\(\s*siteThumb/.test(made) && /withSplit\(\s*fileThumb/.test(made),
    'site and page cards get the icon'
  );
  check(
    /split \? \[split, open\]/.test(made) && /splitButton\(\(\) => site\.url/.test(made),
    'and their previews'
  );
  check(
    /179-preview-split\.js/.test(source('index.html')) &&
      /57-preview-split\.css/.test(source('index.html')),
    'index.html loads both'
  );
  check(
    /prefers-reduced-motion/.test(source('src/styles/57-preview-split.css')),
    'the slide stops under reduced motion'
  );

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
