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

// 178 makes an icon before it puts it in its card: off the page at first
let connectedAtFirst = true;

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
    isConnected: connectedAtFirst,
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    append(...items) {
      for (const item of items) {
        if (item && typeof item === 'object') item.parent = this;
      }
      this.children.push(...items);
    },
    replaceChildren(...items) {
      this.children = items;
    },
    remove() {
      this.removed = (this.removed || 0) + 1;
      if (this.parent) {
        this.parent.children = this.parent.children.filter(child => child !== this);
        this.parent = null;
      }
    },

    // a stack's cards are 280 px tall, 300 px apart; the stack shows 400 px
    get offsetTop() {
      return this.parent ? this.parent.children.indexOf(this) * 300 : 0;
    },
    offsetHeight: 280,
    clientHeight: 400,
    scrollTop: 0,
    scrollTo(options) {
      this.scrolledTo = options.top;
      this.scrollTop = options.top;
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
    remove: name =>
      (node.className = node.className
        .split(' ')
        .filter(part => part !== name)
        .join(' ')),
    contains: name => node.className.split(' ').includes(name),
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
let threadId = 't1';
let reduceMotion = false;
const windowListeners = {};
const context = {
  window: {
    TnaiThreads: { selected: () => threadId },
    addEventListener: (type, fn) => (windowListeners[type] = fn),
    dispatchEvent() {},
    requestAnimationFrame: fn => fn(),
    matchMedia: () => ({ matches: reduceMotion }),
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

  // 5b. a chart's icon pushes the chart beside the thread, drawn large, in the thread's stack
  const drawn = {};
  const bigChart = name => () => {
    drawn[name] = (drawn[name] || 0) + 1;
    const figure = element('figure');
    figure.className = 'tnt-chart tnt-chart-big';
    const head = element('figcaption');
    head.className = 'tnt-chart-head';
    figure.append(head);
    figure.chartName = name;
    return figure;
  };
  const chartIcon = name => split.chartButton('chart:["' + name + '"]', name, bigChart(name));
  const chart = chartIcon('Sizes');
  check(chart.className.includes('tnt-split-push'), 'a chart gets the same split icon');
  await chart.click();
  check(split.shown() === 'charts:t1', 'the chart is beside the thread, in thread t1 stack');
  const chartView = previews.at(-1).node;
  const stackBody = chartView.querySelector('.tnt-split-body');
  const cardsIn = body => body.children.map(item => item.children.at(-1).chartName);
  check(cardsIn(stackBody).join() === 'Sizes', 'drawn large in the column');
  check(chartView.querySelector('.tnt-split-name').textContent === 'Sizes', 'named in its bar');
  check(chart.attributes['aria-pressed'] === 'true', 'its icon says the chart is there');
  check(
    chart.attributes['aria-label'] === 'Show it beside the thread',
    'its icon says a press finds it'
  );
  const firstHead = stackBody.children[0].children[0].querySelector('.tnt-chart-head');
  check(
    firstHead.children.some(child => child.className.includes('tnt-split-drop')),
    'the large card has its own close in its head'
  );

  // 5c. a second chart goes under the first, the bar counts them, the newest is scrolled into view
  const speeds = chartIcon('Speeds');
  await speeds.click();
  check(cardsIn(stackBody).join() === 'Sizes,Speeds', 'the second chart is added below the first');
  check(previews.at(-1).node === chartView, 'in the same view, not a new one');
  check(chartView.querySelector('.tnt-split-name').textContent === '2 charts', 'the bar counts');
  check(
    chart.attributes['aria-pressed'] === 'true' && speeds.attributes['aria-pressed'] === 'true',
    'both icons say their chart is there'
  );
  check(stackBody.scrolledTo === 184, 'the newest card scrolls into view: ' + stackBody.scrolledTo);
  check(styleProps['--tnt-side-w'] === '650px', 'the column keeps half the room');

  // 5d. the same chart again is not added twice: it is scrolled to and flashes
  await chart.click();
  check(drawn.Sizes === 1 && stackBody.children.length === 2, 'the same chart is not added twice');
  check(stackBody.scrolledTo === 0, 'the stack scrolls back to it: ' + stackBody.scrolledTo);
  check(stackBody.children[0].classList.contains('tnt-split-flash'), 'and it flashes');

  // 5e. a page swaps the stack out; the next chart brings the stack back as it was
  await page.click();
  await settle();
  check(split.shown().endsWith('page.html') && chartView.removed >= 1, 'a page swaps it out');
  check(chart.attributes['aria-pressed'] === 'false', 'the chart icons let go');
  await speeds.click();
  check(
    split.shown() === 'charts:t1' && cardsIn(stackBody).join() === 'Sizes,Speeds',
    'the stack comes back whole'
  );
  check(drawn.Speeds === 1, 'without drawing its charts again');

  // 5f. each card closes on its own; the last one pushes the column back to the width it had
  reduceMotion = true;
  stackBody.children[0].children[0].querySelector('.tnt-chart-head').children.at(-1).click();
  check(cardsIn(stackBody).join() === 'Speeds', 'one card closes, the other stays');
  check(chartView.querySelector('.tnt-split-name').textContent === 'Speeds', 'the bar names it');
  check(chart.attributes['aria-pressed'] === 'false', 'its icon lets go');
  stackBody.children[0].children[0].querySelector('.tnt-chart-head').children.at(-1).click();
  check(
    split.shown() === '' && styleProps['--tnt-side-w'] === '410px',
    'the last close pushes the column back to the width it had'
  );
  reduceMotion = false;

  // 5g. the stack belongs to its thread
  await chart.click();
  threadId = 't2';
  windowListeners['tnai:threads-select']();
  check(split.shown() === '', 'another thread without charts: the column goes back');
  const costs = chartIcon('Costs');
  await costs.click();
  const otherBody = previews.at(-1).node.querySelector('.tnt-split-body');
  check(
    split.shown() === 'charts:t2' && cardsIn(otherBody).join() === 'Costs',
    'its own chart shows, not the first thread one'
  );
  check(chart.attributes['aria-pressed'] === 'false', 'the first thread chart icon is not lit');
  threadId = 't1';
  windowListeners['tnai:threads-select']();
  check(
    split.shown() === 'charts:t1' && previews.at(-1).node === chartView,
    'back on the first thread, its stack shows again'
  );
  check(cardsIn(stackBody).join() === 'Sizes', 'with its own chart');
  threadId = 't2';
  windowListeners['tnai:threads-select']();
  check(split.shown() === 'charts:t2', 'and the second thread gets its own back too');
  threadId = 't1';
  windowListeners['tnai:threads-select']();

  // 5h. the bar's push-back keeps the stack; the next chart opens it with the new one added
  chartView.querySelector('.tnt-split-back').click();
  check(split.shown() === '' && styleProps['--tnt-side-w'] === '410px', 'the bar pushes it back');
  await speeds.click();
  check(cardsIn(stackBody).join() === 'Sizes,Speeds', 'the next chart opens the kept stack');
  keydown({ key: 'Escape', target: { closest: () => null }, defaultPrevented: false });
  check(split.shown() === '', 'Esc pushes the charts back');

  // 5h2. an icon made off the page (as 178 makes it) still lights once it is placed
  connectedAtFirst = false;
  const placedLater = chartIcon('Placed later');
  connectedAtFirst = true;
  placedLater.isConnected = true;
  await placedLater.click();
  check(
    placedLater.attributes['aria-pressed'] === 'true',
    'an icon placed after it was made says its chart is there'
  );
  split.close();

  // 5i. a step or picture still takes the column on its own
  const picture = element('img');
  check(
    split.openNode('picture:a.png', 'a.png', () => picture, 'picture'),
    'a picture opens'
  );
  check(
    previews.at(-1).node.querySelector('.tnt-split-body').children[0] === picture,
    'alone in its view'
  );
  split.close();

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
