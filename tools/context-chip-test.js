// Test of the context chip under the prompt box (src/scripts/168-context-chip.js):
// node tools/context-chip-test.js
//
// What the chip shows for the open thread (hidden below the amber share, for an unknown size, for a
// CLI without a compact command, off the Threads page and while another computer's agent is open;
// "142k of 200k · Compact" past it), where it stands in the row (right before "↵ send", so that
// hint stays the second-last child), and what a press does (54's compactNow first, the CLI's own
// /compact when that is not taken, nothing while the agent works). The script runs in a Node
// sandbox with a small stand-in for the page: no window opens, no CLI starts.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'scripts', '168-context-chip.js'),
  'utf8'
);

// ---- a very small page: elements with children, attributes, text and click handlers ----
class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.className = '';
    this.hidden = false;
    this.title = '';
    this.type = '';
    this.text = '';
    this.handlers = {};
    this.inner = '';
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map(child => child.textContent).join('');
  }
  set innerHTML(html) {
    this.inner = html;
    this.children = [];

    // the chip's own markup: an icon and one empty span
    if (/<span><\/span>/.test(html)) this.append(new Node('span'));
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(type, fn) {
    this.handlers[type] = fn;
  }
  click() {
    this.handlers.click?.({ preventDefault() {} });
  }
  append(child) {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
  }
  remove() {
    if (!this.parentElement) return;
    const list = this.parentElement.children;
    list.splice(list.indexOf(this), 1);
    this.parentElement = null;
  }
  before(child) {
    child.remove();
    const list = this.parentElement.children;
    list.splice(list.indexOf(this), 0, child);
    child.parentElement = this.parentElement;
  }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const list = this.parentElement.children;
    return list[list.indexOf(this) + 1] || null;
  }
  querySelector(selector) {
    if (selector === 'span') return this.children.find(child => child.tagName === 'SPAN') || null;
    return null;
  }
  querySelectorAll(selector) {
    if (selector === ':scope>.hint')
      return this.children.filter(child => /\bhint\b/.test(child.className));
    return [];
  }
}

function hint(words) {
  const node = new Node('span');
  node.className = 'hint';
  node.textContent = words;
  return node;
}

// One fresh copy of the script with its own page, sessions, sizes and sends.
// setup(world), when given, changes the world before the script runs.
function load(setup) {
  const row = new Node('div');
  row.className = 'hints';
  row.append(hint('Ctrl+K commands'));
  const route = hint('→ Kestrel');
  route.className = 'hint tnai-route-hint';
  row.append(route);
  const send = hint('↵ send · Ctrl+↵ new agent');
  row.append(send);
  row.append(hint('Shift+↵ new line'));

  const world = {
    row,
    send,
    visible: true,
    selected: 'p1',
    remote: '',
    sessions: [{ paneId: 'p1', name: 'Kestrel', agent: 'Claude Code', status: 'idle' }],
    size: { tokens: 142000, win: 200000, pct: 71, lv: 'warn' },
    compactTaken: true,
    compactCalls: [],
    submits: [],
    toasts: [],
    listeners: {},
    frames: [],
  };
  const window = {
    TnaiAgents: {
      sessions: () => world.sessions,
      onChange: fn => {
        world.listeners.agents = fn;
      },
    },
    tnaiNative: {
      pty: {
        submit: (paneId, text, options) => {
          world.submits.push([paneId, text, options]);
          return Promise.resolve();
        },
      },
    },
    TnaiThreads: { visible: () => world.visible, selected: () => world.selected },
    TnaiThreadHistory: { remote: () => world.remote },
    TnaiTurns: { format: { tokens: n => Math.round(n / 1000) + 'k' } },
    TnaiContextWarning: {
      level: paneId => {
        const session = world.sessions.find(item => item.paneId === paneId);
        if (!session || !world.size) return null;
        return { s: session, ...world.size };
      },
    },
    TnaiContextUpkeep: {
      compactNow: (paneId, typed) => {
        world.compactCalls.push([paneId, typed]);
        return world.compactTaken;
      },
    },
    TnaiIcon: () => '<svg></svg>',
    toast: words => world.toasts.push(words),
    addEventListener: (type, fn) => {
      world.listeners[type] = fn;
    },
  };
  const document = {
    createElement: tag => new Node(tag),
    querySelector: selector => (selector === '.composer .hints' ? row : null),
  };
  const sandbox = {
    window,
    document,
    requestAnimationFrame: fn => world.frames.push(fn),
    console,
  };
  if (setup) setup(world);
  vm.runInNewContext(source, sandbox, { filename: '168-context-chip.js' });

  // the paint the script asked for, and any after it
  world.flush = () => {
    while (world.frames.length) world.frames.shift()();
  };
  world.chip = () => row.children.find(child => child.className === 'tnai-ctx-chip') || null;
  world.api = window.TnaiContextChip;
  world.flush();
  return world;
}

// ---- what it shows ----
{
  const w = load();
  const chip = w.chip();
  check('past the amber share: a chip is in the row', !!chip && !chip.hidden);
  check(
    'it reads "142k of 200k · Compact"',
    chip && chip.textContent === '142k of 200k · Compact',
    chip && chip.textContent
  );
  check('it stands right before "↵ send"', chip && chip.nextElementSibling === w.send);
  check(
    '"↵ send" is still the second-last child of the row (the fit rules count on it)',
    w.row.children[w.row.children.length - 2] === w.send
  );
  check(
    'its title names the thread and the share',
    /Kestrel/.test(chip.title) && /71%/.test(chip.title)
  );
  check(
    'its title is its label for a screen reader',
    chip.getAttribute('aria-label') === chip.title
  );
  check(
    'a tight row may shorten it, whole, in steps: "142k of 200k · Compact", "142k · Compact", "142k"',
    JSON.stringify(w.api.decide('p1').steps) ===
      JSON.stringify(['142k of 200k · Compact', '142k · Compact', '142k']),
    JSON.stringify(w.api.decide('p1').steps)
  );
  check('it takes a press while the agent is idle', chip.getAttribute('aria-disabled') === 'false');
}
{
  const w = load();
  w.size = { tokens: 60000, win: 200000, pct: 30, lv: '' };
  w.listeners['tnai:turn']();
  w.flush();
  check('below the amber share: hidden', w.chip().hidden === true);
}
{
  const w = load();
  w.size = null;
  w.listeners['tnai:turn']();
  w.flush();
  check('size not known: hidden', w.chip().hidden === true);
}
{
  const w = load();
  w.size = { tokens: 300000, win: 0, pct: 0, lv: 'warn' };
  w.listeners['tnai:turn']();
  w.flush();
  check(
    'window not known: only the size ("300k · Compact")',
    w.chip().textContent === '300k · Compact',
    w.chip().textContent
  );
}
{
  const w = load();
  w.sessions[0].agent = 'Cursor Agent';
  w.listeners['tnai:turn']();
  w.flush();
  check('a CLI without a compact command: hidden', w.chip().hidden === true);
}
{
  const w = load();
  w.visible = false;
  w.listeners['tnai:threads-hidden']();
  w.flush();
  check('another page: hidden', w.chip().hidden === true);
}
{
  const w = load();
  w.remote = 'pc1\np3';
  w.listeners['tnai:remote-agents-changed']();
  w.flush();
  check("another computer's agent fills the main area: hidden", w.chip().hidden === true);
}
{
  const w = load();
  w.selected = '';
  w.listeners['tnai:threads-select']();
  w.flush();
  check('no open thread: hidden', w.chip().hidden === true);
}
{
  // remote off, a small conversation: the row is exactly as it was (nothing added)
  const w = load(world => {
    world.size = null;
  });
  check('nothing to show at the start: no chip is added at all', w.chip() === null);
  check('the row keeps its four hints', w.row.children.length === 4);
  check('the decision for an unknown size is null', w.api.decide('p1') === null);
  check('the decision for no thread is null', w.api.decide('') === null);
}

// ---- a press ----
{
  const w = load();
  w.chip().click();
  check(
    'idle: a press asks 54 for the careful compact, with "/compact"',
    w.compactCalls.length === 1 &&
      w.compactCalls[0][0] === 'p1' &&
      w.compactCalls[0][1] === '/compact'
  );
  check('taken by 54: nothing is typed into the terminal', w.submits.length === 0);
}
{
  const w = load();
  w.compactTaken = false;
  w.chip().click();
  check(
    "not taken by 54 (Summarize first off): the CLI's own /compact is typed, not pasted",
    w.submits.length === 1 &&
      w.submits[0][0] === 'p1' &&
      w.submits[0][1] === '/compact' &&
      w.submits[0][2].paste === false
  );
  check('and it says so', /Sent \/compact to Kestrel/.test(w.toasts.join('\n')));
}
{
  const w = load();
  w.sessions[0].status = 'working';
  w.listeners['tnai:turn']();
  w.flush();
  check(
    'working: the chip is shown without a press',
    w.chip().getAttribute('aria-disabled') === 'true'
  );
  check(
    'working: its title says to compact once the task is done',
    /once it has finished/.test(w.chip().title)
  );
  w.chip().click();
  check('working: a press sends nothing', w.compactCalls.length === 0 && w.submits.length === 0);
  check('working: a press says why', /is working/.test(w.toasts.join('\n')));
}
{
  const w = load();

  // the open thread changed between the paint and the press: nothing goes to the old one
  w.selected = 'p2';
  w.chip().click();
  check(
    'a press after another thread was opened sends nothing',
    w.compactCalls.length === 0 && w.submits.length === 0
  );
}

// ---- where it stands, again ----
{
  const w = load();

  // the composer's pop-out (38) moves the row's nodes: the chip keeps its place before "↵ send"
  const other = new Node('div');
  other.className = 'hints';
  for (const child of [...w.row.children]) other.append(child);
  w.row.children = other.children;
  for (const child of w.row.children) child.parentElement = w.row;
  w.listeners['tnai:turn']();
  w.flush();
  const chips = w.row.children.filter(child => child.className === 'tnai-ctx-chip');
  check('a paint again adds no second chip', chips.length === 1);
  check('still right before "↵ send"', chips[0] && chips[0].nextElementSibling === w.send);
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
