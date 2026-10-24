// Technically Not tools · decision-press-test.js — a Decide card's press sends the option pressed
// (src/scripts/49-context-data.js `decideInThread`). The card shows the options as the agent wrote
// them; the saved result has the recommended one moved first, so a button's place must never pick
// the saved option (user report 2026-10-21: "Yes, run it now" was pressed and the agent got the
// recommended "Later ..."). Runs the real file with a small stand-in for the page and the app.
// Run: node tools/decision-press-test.js
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

const QUESTION =
  'Run the 3D job for your three picks now? It loads the graphics card hard for a few minutes, then stops.';

// What the saved result holds: the recommended option moved to the front (agent-context.js).
function savedResult(id, question, options) {
  return {
    id,
    paneId: 'p1',
    name: 'Muppet',
    at: 1000,
    summary: { choices: { question, options } },
  };
}

async function load(entries, routing) {
  const sent = [];
  const prompt = {
    value: '',
    dispatchEvent() {},
    focus() {},
    setSelectionRange() {},
  };
  const store = new Map();
  const window = {
    addEventListener() {},
    dispatchEvent() {},
    tnaiNative: {
      context: {
        state: async () => ({ entries, marks: {}, notes: [], brief: '' }),
        onChange() {},
        mark: async () => {},
      },
      fs: {},
    },
    TnaiAgents: {
      sessions: () => [{ paneId: 'p1', running: true, name: 'Muppet', agent: 'Claude Code' }],
      send: (paneId, text) => {
        sent.push(text);
        return true;
      },
    },
    TnaiDecisionRouting: routing,
  };
  const context = {
    window,
    document: {
      head: { append() {} },
      createElement: () => ({}),
      getElementById: id => (id === 'prompt' ? prompt : null),
    },
    localStorage: {
      getItem: key => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key),
    },
    CustomEvent: class {},
    Event: class {},
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Date,
    Math,
    toast() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../src/scripts/49-context-data.js'), 'utf8'),
    context
  );
  await window.TnaiContext.refresh();
  return { api: window.TnaiContext, sent, prompt };
}

const sendsItself = { sendsItself: () => true, targetOf: () => '', sendPlain: () => true };

(async () => {
  // 1. the user's case: the card's first button is "Yes, run it now"; saved, it is second
  {
    const entries = [
      savedResult('r1', QUESTION, [
        {
          label: "Later, I'll say when",
          detail: "recommended while you're using the PC",
          recommended: true,
        },
        { label: 'Yes, run it now', detail: '' },
      ]),
    ];
    const { api, sent } = await load(entries, sendsItself);
    api.decideInThread('p1', QUESTION, 0, 'Yes, run it now', 0);
    check(sent.length === 1, 'the press sends one message');
    check(
      /go with Yes, run it now\./.test(sent[0] || ''),
      'it names the option pressed: ' + sent[0]
    );
    check(!/Later/.test(sent[0] || ''), 'never the recommended one in its place');
    check(api.choiceFor('p1', QUESTION) === 'Yes, run it now', 'the card marks the option pressed');
  }

  // 2. the button's label carries the recommendation in brackets; the saved label does not
  {
    const entries = [
      savedResult('r2', QUESTION, [
        { label: "Later, I'll say when", detail: '', recommended: true },
        { label: 'Yes, run it now', detail: '' },
      ]),
    ];
    const { api, sent } = await load(entries, sendsItself);
    api.decideInThread(
      'p1',
      QUESTION,
      1,
      "Later, I'll say when (recommended while you're using the PC)",
      0
    );
    check(
      /go with Later, I'll say when\./.test(sent[0] || ''),
      'a label with its reason still finds its option'
    );
  }

  // 3. words that match no saved option, or two: the pressed words go as they are
  {
    const plain = [];
    const routing = {
      sendsItself: () => true,
      targetOf: () => '',
      sendPlain: (paneId, question, label) => {
        plain.push(label);
        return true;
      },
    };
    const entries = [
      savedResult('r3', QUESTION, [
        { label: 'Run it', detail: '', recommended: true },
        { label: 'Run it later', detail: '' },
      ]),
    ];
    const { api, sent } = await load(entries, routing);
    api.decideInThread('p1', QUESTION, 0, 'Something else entirely', 0);
    check(
      sent.length === 0 && plain[0] === 'Something else entirely',
      'no match: the pressed words, not option 1'
    );
  }

  // 4. the agent is not running: the answer waits in the prompt box and nothing is marked chosen
  {
    const entries = [
      savedResult('r4', QUESTION, [
        { label: "Later, I'll say when", detail: '', recommended: true },
        { label: 'Yes, run it now', detail: '' },
      ]),
    ];
    const routing = { sendsItself: () => false, targetOf: () => '', sendPlain: () => false };
    const { api, sent, prompt } = await load(entries, routing);
    const answer = api.decideInThread('p1', QUESTION, 0, 'Yes, run it now', 0);
    check(answer === 'composer', 'the press says the answer went to the prompt box');
    check(sent.length === 0, 'nothing is sent to the stopped agent');
    check(
      /go with Yes, run it now\./.test(prompt.value),
      'the prompt box holds the pressed answer'
    );
    check(
      api.choiceFor('p1', QUESTION) === '',
      'the card does not call it chosen before it is sent'
    );
    check(
      !(api.findDecision('p1', QUESTION) || {}).done,
      'the decision stays open, so it can be pressed again'
    );
  }

  // 5. the code: the place is never used to pick
  const source = fs.readFileSync(path.join(__dirname, '../src/scripts/49-context-data.js'), 'utf8');
  check(/function optionIndexFor/.test(source), 'the saved option is found by its words');

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
