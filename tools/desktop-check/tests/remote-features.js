// Technically Not tools · desktop-check/tests/remote-features.js — this week's thread features for
// another computer's thread (src/scripts/165-remote-features.js, plan item 45) in the real app with
// a throwaway profile. Nothing is paired: the state, its Changes, skills and CLIs are made up by
// this test and handed over the way the main process would (remote-features.main.js). Covered:
// the CHANGES and ITS CLIS sections in the thread's detail; "This thread's work" opens the thread
// actions and a press sends the filled prompt as a remote prompt; no work button without full
// control; the "$" list shows that computer's skills while its agent is the composer's target, and
// "/" lists nothing; the copy icon on a code block of its conversation; its threads on the Board.
// Pictures: remote-features-(1440|1024)-(dark|light), remote-features-board. Returns {ok, log}.
// Written 2026-10-21 with the batch and not run yet (the lead runs the window tests once).
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(50);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  await wait(400);
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = result => {
      delete window.__tnaiMainDone[id];
      result?.ok ? resolve(result.value) : reject(new Error(result?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });

const threads = window.TnaiThreads;
const remote = window.TnaiRemoteAgents;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;
const listSlot = () => threads.slot('list');
const host = () => threads.slot('main')?.querySelector(':scope > .tnh-view');
const far = () => {
  const box = host()?.querySelector('.ap-far');
  return box && onScreen(box) ? box : null;
};
const section = name => far()?.querySelector(`[data-sec=${name}]`) || null;
const factsOf = name =>
  Object.fromEntries(
    [...(section(name)?.querySelectorAll('dt') || [])].map(term => [
      term.textContent,
      term.nextElementSibling?.textContent || '',
    ])
  );
const workButton = () => far()?.querySelector('.ap-actions button[data-act=work]') || null;
const remoteRows = () => [...listSlot().querySelectorAll('.tnt-th[data-remote]')];
const rowNamed = name => remoteRows().find(row => row.querySelector('b').textContent === name);
const pressRow = async name => {
  await until(() => !window.TnaiDevices.quiet(), 3000);
  rowNamed(name).click();
};
const calls = async channel => (await main('calls')).filter(call => call.ch === channel);
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}

const nowMs = Date.now();
const PC = 'sample-computer-1';
const farAgents = [
  {
    id: 'p1',
    name: 'Wren',
    cli: 'Codex',
    status: 'working',
    since: nowMs - 60000,
    task: 'Fix the login page',
    sure: true,
    can: true,
    mark: 'm1',
  },
  {
    id: 'p2',
    name: 'Moss',
    cli: 'Claude Code',
    status: 'idle',
    since: 0,
    sure: true,
    can: false,
    mark: '',
    last: { at: nowMs - 30000, task: 'Run the tests', did: 'Ran them', has: false, got: nowMs },
  },
];
const computer = {
  id: PC,
  name: 'Sample laptop',
  since: nowMs,
  online: true,
  session: true,
  state: 'live',
  heard: nowMs,
  detail: true,
  update: false,
  asks: [],
  keepsAsking: 0,
  items: [],
  elsewhere: 0,
  project: null,
  answer: false,
  control: false,
  commands: false,
  watchable: false,
  canControl: true,
  canWatch: false,
  canStart: [],
  ops: [],
  finished: null,
  agents: farAgents,
};

// What that computer answered, made up (as desktop/remote-features.js holds it).
const held = {
  changes: {
    state: 'ok',
    at: nowMs,
    value: {
      repo: true,
      branch: 'login-fix',
      detached: false,
      base: 'main',
      onBase: false,
      since: 'main',
      uncommitted: 1,
      unpushed: 0,
      ahead: 2,
      behind: 0,
      added: 30,
      removed: 4,
      files: 3,
      gh: 'none',
      pr: null,
    },
  },
  clis: {
    state: 'ok',
    at: nowMs,
    value: {
      clis: [
        {
          cli: 'Codex',
          installed: true,
          signedIn: true,
          plan: 'Plus',
          gauges: [{ minutes: 300, model: '', used: 40, resetsAt: nowMs + 3600000 }],
        },
        { cli: 'Claude Code', installed: true, signedIn: false, plan: '', gauges: [] },
      ],
    },
  },
  skills: {
    state: 'ok',
    at: nowMs,
    value: {
      cli: 'Codex',
      sign: '$',
      more: 0,
      skills: [{ name: 'deploy-site', insert: '$deploy-site', about: 'Ship it', from: 'project' }],
    },
  },
};

try {
  check(
    !!window.TnaiRemoteFeatures?.paint && !!remote?.promptShown,
    'the remote features and their hook in 116 exist'
  );
  const real = (await window.tnaiNative.remote.state()).value;
  const state = list => ({
    ...real,
    on: true,
    computers: [{ ...computer, agents: list || farAgents }],
    others: [],
    watching: [],
  });
  const push = async value => {
    await main('show', value);
    await wait(250);
  };
  await main('install');
  await main('size', 1440, 900);
  await main('spy');
  await main('featureStub', held);
  threads.open();
  await until(() => threads.visible(), 5000);
  await push(state());
  await until(() => remoteRows().length === 2, 5000);

  // ---- the detail: Changes and its CLIs ----
  await pressRow('Wren');
  await until(() => far() && section('changes') && !section('changes').hidden, 5000);
  await push(state());
  const changes = await until(() => factsOf('changes').Branch && factsOf('changes'), 5000);
  check(
    !!changes && changes.Branch === 'login-fix' && /\+30 −4 · 3 files/.test(changes.Lines),
    'CHANGES shows that computer’s branch and lines: ' + JSON.stringify(changes)
  );
  const clis = factsOf('clis');
  check(
    /Signed in · Plus · 5-hour: 40% used/.test(clis.Codex || '') &&
      /Signed out/.test(clis['Claude Code'] || ''),
    'ITS CLIS shows sign-in and usage: ' + JSON.stringify(clis)
  );
  const asks = await main('featureAsks');
  check(asks.changes >= 1 && asks.clis >= 1, 'opening the thread asked once for each');
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
  ])
    for (const look of ['dark', 'light']) {
      await main('size', width, height);
      document.documentElement.dataset.theme = look;
      await shot('remote-features-' + width + '-' + look);
    }
  await main('size', 1440, 900);

  // ---- the thread actions ----
  check(onScreen(workButton()), "This thread's work shows with full control and a git folder");
  workButton().click();
  const rows = await until(() => {
    const found = [...document.querySelectorAll('.tnt-menu-thread .tnt-menu-row')].filter(onScreen);
    return found.length ? found : null;
  }, 3000);
  check(
    !!rows && rows.some(row => row.textContent === 'Commit'),
    'the work menu lists the thread actions'
  );
  rows.find(row => row.textContent === 'Commit').click();
  const prompt = await until(async () => (await calls('remote:prompt')).slice(-1)[0], 4000);
  check(
    !!prompt && /branch login-fix/.test(String(prompt.args[2] || '')) && prompt.args[1] === 'p1',
    'Commit went to that agent as a remote prompt, with its branch filled in'
  );
  await pressRow('Moss');
  await until(() => far()?.querySelector('h2')?.textContent === 'Moss', 4000);
  check(!onScreen(workButton()), 'no work button for an agent that takes nothing from here');

  // ---- the "$" list ----
  await pressRow('Wren');
  far()?.querySelector('[data-act=target]')?.click();
  const input = document.getElementById('prompt');
  input.focus();
  input.value = 'Use $dep';
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // The service pushes its state when that computer's answer arrives; the stand-in channels do
  // not, so the test pushes it as the service would.
  await until(async () => (await main('featureAsks')).skills >= 1, 3000);
  await push(state());
  const listed = await until(() => {
    const rowsNow = window.TnaiPromptPicker?.rows?.() || [];
    return rowsNow.length ? rowsNow : null;
  }, 4000);
  check(
    !!listed && listed[0].insert === '$deploy-site',
    'the "$" list shows that computer’s skills for its CLI'
  );
  input.value = '/';
  input.setSelectionRange(1, 1);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(300);
  check(!window.TnaiPromptPicker?.isOpen?.(), 'no "/" list for another computer’s agent');
  input.value = '';
  window.TnaiPromptPicker?.close?.();

  // ---- the copy icon in its conversation ----
  await main('logStub', {
    state: 'held',
    more: false,
    full: true,
    older: false,
    rev: 1,
    at: nowMs,
    entries: [
      { k: 'you', text: 'Show the command', at: nowMs - 5000 },
      { k: 'say', text: 'Run this:\n\n```\nnpm test\n```', at: nowMs - 4000 },
    ],
  });
  const talkRows = farAgents.map(a =>
    a.id === 'p1' ? { ...a, talk: true, rev: 1, log: { rev: 1, at: nowMs, state: 'held' } } : a
  );
  await push(state(talkRows));
  await pressRow('Wren');
  const copy = await until(() => host()?.querySelector('.ap-talk-sec .tnt-code-copy'), 5000);
  check(!!copy, 'a code block in its conversation has the copy icon');

  // ---- the Board ----
  window.TnaiBoard?.open?.();
  const card = await until(
    () => document.querySelector('.bd-card[data-kind="remote"][data-remote]'),
    5000
  );
  check(
    !!card && card.closest('[data-col="work"]') && /on Sample laptop/.test(card.textContent),
    'its working thread stands in Working on the Board, named with its computer'
  );
  check(
    !!document.querySelector('[data-col="done"] .bd-card[data-kind="remote"]'),
    'its thread that finished today stands in Done today'
  );
  await shot('remote-features-board');
  card?.click();
  check(
    !!(await until(() => threads.visible() && far()?.querySelector('h2')?.textContent === 'Wren')),
    'a press on its card opens that thread'
  );
  await push({ ...real, on: false, computers: [] });
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
