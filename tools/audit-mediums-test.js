// Technically Not tools · audit-mediums-test.js — three Medium findings of the security audit of
// 2026-10-07 (docs/notes/audit-2026-10-07/SUMMARY.md), checked on the real renderer files with a
// small stand-in page and a hand-driven clock, no window:
//   5  (71-needs-you.js) a second "needs you" question in the same panel chimes again;
//   12 (45-agent-permissions.js) the permission card that swaps to the next prompt takes no click
//      for a moment, so a click meant for the old prompt does not answer the new one;
//   13 (90-powershell-link.js) an OSC 8 tnai://powershell link whose words are not its command
//      asks first and runs nothing on No.
// Each check also runs once on a copy of the file with its fix taken out, and must fail there.
// Run: node tools/audit-mediums-test.js
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

const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', name), 'utf8');

// The file with one piece of its fix replaced; stops the run when the piece is no longer there,
// so this test cannot quietly check nothing after the file changes.
function withoutFix(text, piece, replacement, name) {
  if (!text.includes(piece)) throw new Error(name + ': the fix text was not found: ' + piece);
  return text.replace(piece, replacement);
}

// ---------- a stand-in page ----------

// A clock the test moves by hand: setTimeout callbacks run only inside advance().
function makeClock() {
  let now = 1000000;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { at: now + (ms || 0), fn });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

// An element that answers the calls these three files make. Buttons written into innerHTML with
// a data-d attribute become real stand-in buttons (45's card); every other selector gets one
// stand-in element of its own.
function makeElement(tag) {
  const listeners = {};
  const bySelector = new Map();
  let buttons = [];
  let html = '';

  // Three stand-in children, made once: enough for the head rows and chips these files fill in.
  let kids = null;
  const inner = () =>
    (kids = kids || [makeElement('span'), makeElement('span'), makeElement('span')]);
  const element = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {},
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: '',
    title: '',
    offsetWidth: 0,
    listeners,
    get children() {
      return inner();
    },
    get firstChild() {
      return inner()[0];
    },
    get lastChild() {
      return inner()[2];
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(key, value) {
      element['@' + key] = String(value);
    },
    getAttribute: key => element['@' + key] ?? null,
    removeAttribute(key) {
      delete element['@' + key];
    },
    append() {},
    appendChild: child => child,
    prepend() {},
    remove() {},
    focus() {},
    contains: () => false,
    closest: selector =>
      selector.startsWith('button[data-d]') && element.dataset.d ? element : null,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    removeEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'button[data-d]') return buttons;
      return [];
    },
    querySelector(selector) {
      const wanted = /^\[data-d="(\w+)"\]$/.exec(selector);
      if (wanted) return buttons.find(b => b.dataset.d === wanted[1]) || null;
      if (!bySelector.has(selector)) bySelector.set(selector, makeElement('span'));
      return bySelector.get(selector);
    },
  };
  Object.defineProperty(element, 'innerHTML', {
    get: () => html,
    set(value) {
      html = String(value);
      buttons = [...html.matchAll(/data-d="(\w+)"/g)].map(match => {
        const button = makeElement('button');
        button.dataset.d = match[1];
        return button;
      });
    },
  });
  return element;
}

// A page context for one script file: window is the context itself, as in a browser.
function makePage(extra) {
  const clock = makeClock();
  const page = {
    clock,
    console,
    Date: { now: clock.now },
    Math,
    Number,
    String,
    Array,
    Object,
    JSON,
    Map,
    Set,
    Promise,
    RegExp,
    Error,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    innerHeight: 900,
    CSS: { escape: text => String(text) },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    tnaiKeys: keys => keys,
    document: {
      title: 'Technically Not',
      activeElement: null,
      head: makeElement('head'),
      body: makeElement('body'),
      createElement: makeElement,
      getElementById: () => makeElement('div'),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
    },
    ...extra,
  };
  page.window = page;
  vm.createContext(page);
  return page;
}

const run = (page, text, name) => vm.runInContext(text, page, { filename: name });

// ---------- 5 · 71-needs-you.js: the second question in a panel chimes again ----------

function chimesFor(text) {
  let chimes = 0;
  let push = null;
  const page = makePage({
    TnaiNotify: {
      play: () => {
        chimes++;
      },
    },
    tnaiNative: {
      attention: {
        list: () => Promise.resolve(null),
        on: handler => {
          push = handler;
        },
        notify: () => Promise.resolve(true),
      },
      pty: { write: () => Promise.resolve(true) },
    },
  });
  run(page, text, '71-needs-you.js');
  const question = since => ({
    items: [{ id: 'menu:p1', paneId: 'p1', kind: 'menu', detail: '1. Yes 2. No', since }],
    held: [],
  });
  push(question(page.clock.now()));
  page.clock.advance(3000);
  const first = chimes;
  push({ items: [], held: [] });
  push(question(page.clock.now()));
  page.clock.advance(3000);
  return { first, second: chimes };
}

const needs = source('71-needs-you.js');
const needsFixed = chimesFor(needs);
check(needsFixed.first === 1, '5: the first question in a panel chimes once');
check(needsFixed.second === 2, '5: the next question in the same panel chimes again');
const needsBroken = chimesFor(withoutFix(needs, 'seen.delete(id);', '', '71-needs-you.js'));
check(
  needsBroken.second === 1,
  '5: without the fix the second question stays silent (the check notices)'
);

// ---------- 12 · 45-agent-permissions.js: a swapped card takes no click for a moment ----------

function cardOf(text) {
  // The card is the first div 45 creates (it then writes the four buttons into it); catch it at
  // creation.
  let card = null;
  const answers = [];
  let send = null;
  const page = makePage({
    tnaiNative: {
      permissions: {
        on: handler => {
          send = handler;
        },
        pending: () => Promise.resolve([]),
        answer: (id, decision) => answers.push(id + ':' + decision),
      },
    },
  });
  const create = page.document.createElement;
  page.document.createElement = tag => {
    const element = create(tag);
    if (tag === 'div' && !card) card = element;
    return element;
  };
  run(page, text, '45-agent-permissions.js');
  const click = decision => {
    const button = card.querySelector('[data-d="' + decision + '"]');
    card.listeners.click.forEach(handler => handler({ target: button }));
  };
  return { page, card, answers, send, click };
}

function swapRun(text) {
  const t = cardOf(text);
  t.send({ id: 'a', paneId: 'p1', tool: 'Bash', detail: 'npm test' });
  t.send({ id: 'b', paneId: 'p1', tool: 'Bash', detail: 'rm -rf build' });
  const shownFirst = t.card.dataset.promptId;

  // Prompt A ends by itself (answered on the CLI screen); the card repaints with B under the
  // pointer, and the click that was meant for A lands now.
  t.send({ id: 'a', done: true });
  const shownAfter = t.card.dataset.promptId;
  t.click('once');
  const answeredInSwap = t.answers.slice();
  t.page.clock.advance(600);
  t.click('deny');
  return { shownFirst, shownAfter, answeredInSwap, answers: t.answers };
}

const perms = source('45-agent-permissions.js');
const permsFixed = swapRun(perms);
check(permsFixed.shownFirst === 'a', '12: the card shows the oldest prompt first');
check(permsFixed.shownAfter === 'b', '12: after A ends the card shows B');
check(permsFixed.answeredInSwap.length === 0, '12: a click right after the swap answers nothing');
check(
  permsFixed.answers.join() === 'b:deny',
  '12: once the pause is over a click answers B (got ' + permsFixed.answers.join() + ')'
);
const permsBroken = swapRun(withoutFix(perms, 'hold(swapped);', 'hold(false);', '45'));
check(
  permsBroken.answeredInSwap.join() === 'b:once',
  '12: without the fix the click meant for A allows B (the check notices)'
);

// ---------- 13 · 90-powershell-link.js: an OSC 8 link that hides its command asks first ----------

function linkRun(text, words, uri, yes) {
  const asked = [];
  let ran = 0;
  const page = makePage({
    confirm: message => {
      asked.push(message);
      return yes;
    },
    tnaiPlatform: { win: true },
    TnaiThreads: {
      open: () => {
        ran++;
      },
    },
    TnaiAgents: {
      sessions: () => [{ paneId: 'agent-1', agent: 'Claude Code' }],
      open: () => Promise.resolve({ ok: false }),
      send: () => true,
    },
    tnaiNative: {
      pty: { onData: () => () => {}, replay: () => Promise.resolve({ buffer: '' }) },
    },
  });
  run(page, text, '90-powershell-link.js');
  const term = {
    options: {},
    tnaiPaneId: 'agent-1',
    element: makeElement('div'),
    registerLinkProvider() {},
    buffer: { active: { getLine: () => ({ translateToString: () => words }) } },
  };
  page.TnaiPowerShellLink.attach(term);
  const range = { start: { x: 1, y: 1 }, end: { x: words.length, y: 1 } };
  term.options.linkHandler.activate({}, uri, range);
  return { asked: asked.length, ran, shown: asked[0] || '' };
}

const link = source('90-powershell-link.js');
const command = 'Remove-Item important.txt';
const uri = 'tnai://powershell?cmd=' + encodeURIComponent(command);

const hidden = linkRun(link, 'open the docs', uri, false);
check(hidden.asked === 1, '13: a link reading "open the docs" asks first');
check(hidden.shown.includes(command), '13: the question shows the command it runs');
check(hidden.ran === 0, '13: answered No, nothing runs');
check(linkRun(link, 'run it here', uri, true).ran === 1, '13: answered Yes, it runs');
const plain = linkRun(link, command, uri, false);
check(plain.asked === 0 && plain.ran === 1, '13: a link whose words are the command runs at once');
const prompt = linkRun(link, 'PS> ' + command, uri, false);
check(prompt.asked === 0 && prompt.ran === 1, '13: a link reading "PS> command" runs at once');
const linkBroken = linkRun(
  withoutFix(link, '!showsCommand(shownText(term, range), cmd, uri) &&', 'false &&', '90'),
  'open the docs',
  uri,
  false
);
check(
  linkBroken.ran === 1 && linkBroken.asked === 0,
  '13: without the fix the hidden command runs on one click (the check notices)'
);

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
