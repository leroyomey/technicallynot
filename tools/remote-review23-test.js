// Technically Not · remote-review23-test.js — plain-Node checks for the Low findings of security
// review 23 (docs/notes/remote-full-control-review-2026-10-21.md) that live in window scripts,
// which no other plain-Node test loads: L1 (111's words under "show details") and L3 (116's
// promptShown keeps the thread the menu was opened for). The window scripts run here against a
// stand-in window with no real page, so nothing opens.
// Run: node tools/remote-review23-test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- a stand-in page

// An element that takes every call and every property: the scripts draw into it and nothing is
// looked at, except what a test reads back.
function fakeNode() {
  const store = { children: [], textContent: '', className: '', style: {}, dataset: {} };
  const node = new Proxy(store, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'isConnected') return true;
      if (key === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (key === Symbol.toPrimitive) return () => '';
      if (key === 'querySelector') return () => null;
      if (key === 'querySelectorAll') return () => [];
      if (key === 'append' || key === 'appendChild' || key === 'prepend')
        return (...items) => {
          target.children.push(...items);
          return items[0];
        };
      if (key === 'getBoundingClientRect') return () => ({ top: 0, left: 0, width: 0, height: 0 });
      return () => node;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  });
  return node;
}

// Runs one window script with a stand-in window; native: what window.tnaiNative.remote offers.
function runWindowScript(file, native, extra = {}) {
  const said = [];
  const listeners = new Map();
  const window = {
    tnaiNative: { remote: native },
    toast: message => said.push(message),
    addEventListener(type, fn) {
      listeners.set(type, fn);
    },
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
    TnaiThreads: { visible: () => false },
    ...extra,
  };
  const document = {
    getElementById: () => null,
    querySelector: selector => (selector === '.layout' ? fakeNode() : null),
    querySelectorAll: () => [],
    createElement: () => fakeNode(),
    createTextNode: () => fakeNode(),
    addEventListener() {},
    body: fakeNode(),
    activeElement: null,
  };
  const context = vm.createContext({
    window,
    document,
    console,
    CustomEvent: class {
      constructor(type) {
        this.type = type;
      }
    },
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: () => 0,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Promise,
    Date,
    Math,
    JSON,
    Map,
    Set,
  });
  vm.runInContext(source(file), context, { filename: file });
  return { window, said };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// ---------------------------------------------------------------- L1

test('L1: the line under "show details" names the branch, skills and CLI sign-in that cross', () => {
  const text = source('src/scripts/111-devices-page.js');
  const start = text.indexOf('function detailNote(pc)');
  assert.ok(start > 0, 'detailNote is there');
  const body = text.slice(start, text.indexOf('\n  }\n', start));
  for (const word of ['branch', 'pull request', 'skills', 'signed in', 'usage'])
    assert.ok(body.includes(word), 'the line names "' + word + '"');
});

// ---------------------------------------------------------------- L3

function remoteAgents() {
  const prompts = [];
  let take = null;
  const native = {
    on: fn => {
      take = fn;
    },
    view: () => ({ ok: true }),
    prompt: (...args) => {
      prompts.push(args);
      return Promise.resolve({ ok: true, value: { sent: 'asked' } });
    },
  };
  const page = runWindowScript('src/scripts/116-remote-agents.js', native);
  const row = (id, name) => ({
    id,
    name,
    cli: 'Claude Code',
    sure: true,
    can: true,
    mark: 'mark-' + id,
    status: 'idle',
  });
  take({
    on: true,
    computers: [
      {
        id: 'pc-b',
        name: 'B',
        state: 'live',
        session: true,
        control: true,
        agents: [row('a1', 'First'), row('a2', 'Second')],
      },
    ],
  });
  const api = page.window.TnaiRemoteAgents;
  return { api, prompts, said: page.said, row };
}

test('L3: a thread action goes to the agent the menu was opened for', async () => {
  const { api, prompts, row } = remoteAgents();
  const key = 'pc-b\na1';
  api.select(key);
  const expected = { key, pc: { id: 'pc-b', name: 'B' }, ag: row('a1', 'First') };
  const answer = await api.promptShown('Review the changes', expected);
  await tick();
  assert.strictEqual(prompts.length, 1);
  assert.strictEqual(prompts[0][1], 'a1');
  assert.strictEqual(answer && answer.sent, 'asked');
});

test('L3: when another thread is shown by the press, nothing is sent', async () => {
  const { api, prompts, said, row } = remoteAgents();
  const first = 'pc-b\na1';
  api.select(first);
  const expected = { key: first, pc: { id: 'pc-b', name: 'B' }, ag: row('a1', 'First') };

  // the shown thread changes while the menu is open
  api.select('pc-b\na2');
  const answer = await api.promptShown('Review the changes on branch x', expected);
  await tick();
  assert.strictEqual(prompts.length, 0, 'no prompt left for the second agent');
  assert.strictEqual(answer, null);
  assert.ok(said.length >= 1, 'the user is told why nothing was sent');
});

test('L3: a call without the thread it was meant for sends nothing', async () => {
  const { api, prompts } = remoteAgents();
  api.select('pc-b\na1');
  assert.strictEqual(await api.promptShown('Review'), null);
  assert.strictEqual(prompts.length, 0);
});

// ---------------------------------------------------------------- L7

test('L7: a delivery between its paste and its Enter is seen by remote typing', () => {
  const attention = require('../desktop/attention-service.js');
  const panel = 'review23-pane';
  assert.strictEqual(attention.deliveryOpen(panel), false, 'nothing in flight');
  attention.localDelivery(panel, 1);
  assert.strictEqual(attention.deliveryOpen(panel), true, "this computer's own delivery");
  attention.localDelivery(panel, -1);
  assert.strictEqual(attention.deliveryOpen(panel), false, 'over after it returned');
});

(async () => {
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
    } catch (error) {
      console.error('FAIL ' + name + '\n  ' + (error && error.stack ? error.stack : error));
    }
  }
  console.log(passed + ' of ' + tests.length + ' passed');

  // attention-service.js keeps timers of its own; the run ends here
  process.exit(passed === tests.length ? 0 : 1);
})();
