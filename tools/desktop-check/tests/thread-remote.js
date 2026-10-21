// Technically Not tools · desktop-check/tests/thread-remote.js — another computer's agent as a
// thread (src/scripts/138-thread-history.js, 116-remote-agents.js) in the real app with a
// throwaway profile. Nothing is paired: the states and the live-view picture are made up by this
// test and pushed the way the main process pushes real ones (remote-agents.main.js), and the one
// thread of this computer is a recorded start, not a process. Covered: a press on such an agent's
// row of the thread list shows its detail in the thread's main area in place of the open thread,
// and that row is the one marked open; the live view is asked for once and its picture is drawn
// there; Send composer tasks here, Interrupt, Stop (which asks first), Follow up and the numbered
// options of its question do what they did on the old page; an agent that takes nothing from here
// has no button; a press on a thread of this computer, and "go to this agent", bring that thread
// back; the press works from another page; an agent that left says so; and the layout never gets
// the class `agents-mode`. Late join: the conversation section (read only, its one button
// Show earlier), the "On" group's line of why agents are not listed, and "Keep on" on Devices.
// Pictures: thread-remote-wren, -moss, -light, -small,
// thread-remote-talk-(1440|1024|tablet)-(dark|light), thread-remote-why-(dark|light),
// devices-keep-on-(1440|1024|tablet)-(dark|light). Returns {ok, log}.
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

const layout = document.querySelector('.layout');
const agents = window.TnaiAgents;
const threads = window.TnaiThreads;
const remote = window.TnaiRemoteAgents;
const history = window.TnaiThreadHistory;
const rect = node => node.getBoundingClientRect();
const round = value => Math.round(value * 10) / 10;
const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;

// The layout must never show the old Agents and history page.
let sawOldPage = layout.classList.contains('agents-mode');
const watchPage = new MutationObserver(() => {
  if (layout.classList.contains('agents-mode')) sawOldPage = true;
});
watchPage.observe(layout, { attributes: true, attributeFilter: ['class'] });

// What the app says in passing is written down.
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}

const mainSlot = () => threads.slot('main');
const listSlot = () => threads.slot('list');
const host = () => mainSlot()?.querySelector(':scope > .tnh-view');
const ownView = () => mainSlot()?.querySelector(':scope > .tnt-view');

// The live screen's section. The conversation (152) stands above it in the same parts, so it is
// told apart by its own section class.
const LIVE = '.ap-term-sec:not(.ap-talk-sec)';
const far = () => {
  const box = host()?.querySelector('.ap-far');
  return box && onScreen(box) ? box : null;
};
const farName = () => far()?.querySelector('h2')?.textContent || '';
const button = text =>
  [...(far()?.querySelectorAll('.ap-actions button') || [])].find(
    one => onScreen(one) && one.textContent === text
  ) || null;

// The thread's "..." (164) stands in the head while its agent is listed, also for one that takes
// nothing from here (its rows are greyed with their reason); it leaves with the agent.
const moreShown = () => onScreen(far()?.querySelector('.ap-actions .tnr-more'));
const shownButtons = () =>
  [...(far()?.querySelectorAll('.ap-actions button:not(.tnr-more)') || [])]
    .filter(onScreen)
    .map(one => one.textContent);
const facts = () =>
  Object.fromEntries(
    [...(far()?.querySelectorAll('[data-sec=now] dt') || [])].map(term => [
      term.textContent,
      term.nextElementSibling?.textContent || '',
    ])
  );
const remoteRows = () => [...listSlot().querySelectorAll('.tnt-th[data-remote]')];
const rowNamed = name => remoteRows().find(row => row.querySelector('b').textContent === name);
const marked = () =>
  [...listSlot().querySelectorAll('.tnt-th[aria-selected="true"]')].map(
    row => row.dataset.remote || row.dataset.pane
  );
const calm = () => until(() => !window.TnaiDevices.quiet(), 3000);
const pressRow = async name => {
  await calm();
  rowNamed(name).click();
};
const calls = async channel => (await main('calls')).filter(call => call.ch === channel);

const nowMs = Date.now();
const ended = nowMs - 120000;
const PC = 'sample-computer-1';
const KEY = id => PC + '\n' + id;
const answer = 'Here is what I did.\nLine two of the answer, with <b>markup as text</b>.';
const farAgents = [
  {
    id: 'p1',
    name: 'Wren',
    cli: 'Claude Code',
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
    cli: 'Codex',
    status: 'idle',
    since: 0,
    sure: true,
    can: true,
    mark: 'm2',
    last: {
      at: ended,
      task: 'Run the tests',
      did: 'Ran the tests; two failed',
      has: true,
      more: 0,
      got: nowMs,
    },
  },
  {
    id: 'p3',
    name: 'Typed by hand',
    cli: 'Codex',
    status: 'idle',
    since: 0,
    sure: true,
    can: false,
    mark: '',
  },
];
const question = {
  id: 'question:q1',
  kind: 'menu',
  agent: 'Moss',
  since: nowMs,
  inferred: false,
  detail: 'Which database?',
  opts: ['Postgres', '<i>SQLite</i>'],
  row: 'p2',
  kof: 'DDDDDDDDDDDDDDDD',
};
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
  items: [question],
  elsewhere: 0,
  project: null,
  answer: false,
  control: false,
  commands: false,
  watchable: false,
  canControl: true,
  canWatch: true,
  canStart: [],
  ops: [],
  finished: null,
  agents: farAgents,
};

try {
  check(
    !!remote?.mount && !!remote.pick && !!history?.remote && !!window.TnaiDevices?.quiet,
    "another computer's agents, their place in the thread view and the Devices helpers exist"
  );
  const real = (await window.tnaiNative.remote.state()).value;
  const state = (more, list) => ({
    ...real,
    on: true,
    computers: [{ ...computer, ...more, agents: list || farAgents }],
    others: [],
    watching: [],
  });
  const push = async value => {
    await main('show', value);
    await wait(250);
  };
  await main('install');
  await main('size', 1440, 900);
  const spied = await main('spy');
  check(
    ['remote:view', 'remote:prompt', 'remote:act'].every(channel => spied.includes(channel)),
    'what the window asks the remote service is written down: ' + spied.join(', ')
  );
  await main('answerText', { at: ended, got: nowMs, text: answer, more: 0 });

  // one thread of this computer, as the open thread
  threads.open();
  await until(() => threads.visible(), 5000);
  const before = new Set(agents.sessions().map(session => session.paneId));
  const opened = await window.TnaiTest.open('Terminal');
  const home =
    opened?.paneId ||
    (await until(() => agents.sessions().find(session => !before.has(session.paneId))))?.paneId;
  await until(() => agents.sessions().find(session => session.paneId === home && session.running));
  threads.show(home);
  check(
    !!(await until(() => window.TnaiThreadView?.shown?.() === home && onScreen(ownView()), 6000)),
    'setup: a thread of this computer is the open thread'
  );

  // ---- the rows ----
  await push(state());
  check(
    !!(await until(() => remoteRows().length === 3, 5000)),
    "the thread list shows that computer's three agents of this project"
  );
  check(
    !onScreen(host()) && history.remote() === '',
    'nothing of another computer is in the main area before a press'
  );

  // ---- a press on a row: the detail in the thread's main area ----
  await pressRow('Wren');
  check(
    !!(await until(() => farName() === 'Wren', 5000)),
    "a press on Wren's row shows its detail: " + farName()
  );
  await frame();
  {
    const slot = rect(mainSlot());
    const box = rect(host());
    check(
      host().parentElement === mainSlot() &&
        far().parentElement === host() &&
        !onScreen(ownView()) &&
        Math.abs(box.left - slot.left) <= 1.5 &&
        Math.abs(box.right - slot.right) <= 1.5 &&
        Math.abs(box.top - slot.top) <= 1.5 &&
        box.height > 300,
      "it fills the thread's main area in place of the open thread: " +
        round(box.left) +
        ' to ' +
        round(box.right) +
        ', ' +
        round(box.height) +
        ' high'
    );
    const composer = rect(document.querySelector('footer.composer'));
    check(
      threads.visible() &&
        !layout.classList.contains('agents-mode') &&
        box.bottom <= composer.top + 1,
      'the Threads page stays the page, and the prompt box stays under it'
    );
  }
  check(
    far().querySelector('.ap-id small').textContent === 'Claude Code · on Sample laptop',
    'it names the tool and the computer: ' + far().querySelector('.ap-id small').textContent
  );
  check(
    history.remote() === KEY('p1') && remote.selected() === KEY('p1'),
    'that agent is the one selected'
  );
  check(
    !!(await until(() => marked().join() === KEY('p1'), 3000)),
    'its row is the one marked open in the thread list: ' + JSON.stringify(marked())
  );
  check(
    facts().Task === 'Fix the login page' &&
      /^Working since /.test(facts().Status || '') &&
      /^Sample laptop/.test(facts().Computer || ''),
    'what that computer reports is shown: ' + JSON.stringify(facts())
  );
  await until(() => button('Stop') && !button('Stop').disabled, 3000);
  check(
    shownButtons().join('|') === 'Send composer tasks here|Interrupt|Stop',
    'a working agent that takes prompts has its three buttons: ' + shownButtons().join(', ')
  );
  {
    const head = rect(far().querySelector('.ap-head'));
    const all = [...far().querySelectorAll('.ap-actions button')].filter(onScreen);
    const heights = new Set(all.map(one => round(rect(one).height)));
    check(
      all.every(one => rect(one).right <= head.right && rect(one).top >= head.top) &&
        heights.size === 1,
      'the buttons stand in the top row, one height: ' + [...heights].join(', ')
    );
  }

  // ---- the live view: asked once, drawn into the box ----
  check(
    !!(await until(async () => (await calls('remote:view')).length === 1, 4000)),
    'the live view is asked for once the agent has stayed selected for a moment'
  );
  {
    const asked = (await calls('remote:view'))[0];
    check(
      asked?.args?.[0] === PC && asked.args[1] === 'p1' && asked.args[2] === 'm1',
      "for that agent, with its row's mark: " + JSON.stringify(asked?.args)
    );
  }
  await main('view', {
    peer: PC,
    agent: 'p1',
    name: 'Wren',
    state: 'on',
    why: '',
    until: Date.now() + 60000,
    left: 77,
    picture: {
      cols: 80,
      rows: 3,
      cut: 0,
      at: Date.now() - 3000,
      incomplete: false,
      lines: [
        { t: 'wren is working', r: [[0, 4, 2, -1, 1]] },
        { t: '<img src=x onerror="window.__farHit=1"> https://example.com', r: [] },
        { t: '> an input row', r: [[2, 2, -1, -1, 2]] },
      ],
    },
  });
  const screen = await until(() => far()?.querySelector(LIVE + ' .ap-term > .dv-screen'), 4000);
  check(
    !!screen &&
      /wren is working/.test(screen.textContent) &&
      !screen.querySelector('img, a') &&
      !window.__farHit,
    'its picture is drawn into the box as text: nothing of it is an element or runs'
  );
  {
    const term = rect(far().querySelector(LIVE + ' .ap-term'));
    const box = rect(host());
    check(
      term.left >= box.left && term.right <= box.right && term.bottom <= box.bottom + 0.5,
      'the picture stands inside the main area: ' + round(term.left) + ' to ' + round(term.right)
    );
  }
  check(
    onScreen(far().querySelector('[data-act=keep]')),
    'Keep watching is offered while the view runs'
  );
  await wait(1500);
  check((await calls('remote:view')).length === 1, 'and nothing more is asked by itself');
  await shot('thread-remote-wren');

  // ---- the buttons do what they did ----
  await calm();
  button('Send composer tasks here').click();
  check(
    !!(await until(() => remote.target()?.key === KEY('p1'), 3000)) &&
      !!button('Composer sends tasks here') &&
      button('Composer sends tasks here').getAttribute('aria-pressed') === 'true',
    'Send composer tasks here makes it the agent the prompt box sends to, and says so'
  );
  await calm();
  button('Composer sends tasks here').click();
  check(
    !!(await until(() => !remote.target(), 3000)) && !!button('Send composer tasks here'),
    'a second press takes that back'
  );
  await calm();
  button('Interrupt').click();
  check(
    !!(await until(async () => (await calls('remote:act')).length === 1, 4000)),
    'Interrupt asks that computer to interrupt it'
  );
  {
    const act = (await calls('remote:act'))[0];
    check(
      act?.args?.[0] === PC && act.args[1] === 'p1' && act.args[2] === 'interrupt',
      'for that agent: ' + JSON.stringify(act?.args?.slice(0, 3))
    );
  }
  await calm();
  button('Stop').click();
  const question1 = await until(() =>
    [...host().querySelectorAll('*')].find(
      node => node.children.length === 0 && node.textContent === 'Stop Wren on Sample laptop?'
    )
  );
  check(!!question1, 'Stop asks first, inside the main area: "Stop Wren on Sample laptop?"');
  host().querySelector('.tnai-ws-close-cancel')?.click();
  await wait(300);
  check(
    (await calls('remote:act')).length === 1,
    'answered with no, nothing is sent to that computer'
  );
  await calm();
  button('Stop').click();
  (await until(() => host().querySelector('.tnai-ws-close-confirm'), 3000))?.click();
  check(
    !!(await until(async () => (await calls('remote:act')).length === 2, 4000)) &&
      (await calls('remote:act'))[1].args[2] === 'stop',
    'answered with yes, Stop asks that computer to stop it'
  );

  // ---- another agent: its last result, Follow up, the options of its question ----
  await pressRow('Moss');
  check(
    !!(await until(() => farName() === 'Moss' && marked().join() === KEY('p2'), 5000)),
    'a press on another of its rows shows that agent, and marks that row: ' + farName()
  );
  check(
    !far().querySelector('.ap-term > .dv-screen'),
    'the picture of the agent before is not shown for this one'
  );
  await until(() => button('Follow up') && !button('Follow up').disabled, 3000);
  check(
    shownButtons().join('|') === 'Send composer tasks here|Follow up|Stop',
    'an idle agent with a finished task has Follow up and no Interrupt: ' +
      shownButtons().join(', ')
  );
  check(
    !!(await until(
      () => /Line two of the answer/.test(far().querySelector('[data-sec=last]').textContent),
      4000
    )) &&
      !far().querySelector('[data-sec=last] b') &&
      /Task: Run the tests/.test(far().querySelector('[data-sec=last]').textContent),
    'its last result is shown, the answer as text'
  );
  const picks = () => [...far().querySelectorAll('.ap-picks button')].filter(onScreen);
  check(
    !!(await until(() => picks().length === 2, 3000)) &&
      picks()[1].title === '<i>SQLite</i>' &&
      facts().Asks === 'Which database? · 1 Postgres · 2 <i>SQLite</i>',
    'its question is shown with one numbered button for each option: ' + (facts().Asks || '')
  );
  await until(() => picks().every(one => !one.disabled), 3000);
  said.length = 0;
  picks()[1].click();
  check(
    !!(await until(() => said.some(text => /^Not sent: Sample laptop/.test(text)), 3000)),
    'a press on an option sends it (nothing is paired here, so it says it was not sent): ' +
      JSON.stringify(said)
  );
  await calm();
  button('Follow up').click();
  check(
    !!(await until(async () => (await calls('remote:prompt')).length === 1, 4000)),
    'Follow up sends a prompt to that computer'
  );
  {
    const prompt = (await calls('remote:prompt'))[0];
    check(
      prompt?.args?.[1] === 'p2' &&
        /^Follow up on your last task \("Run the tests"\)/.test(prompt.args[2]),
      'for that agent, about its last task: ' + String(prompt?.args?.[2]).slice(0, 60)
    );
  }
  await shot('thread-remote-moss');
  window.TnaiTheme?.set?.('light');
  await wait(500);
  await shot('thread-remote-light');
  window.TnaiTheme?.set?.('dark');
  await wait(300);

  // ---- an agent that takes nothing from this computer ----
  await pressRow('Typed by hand');
  await until(() => farName() === 'Typed by hand', 5000);
  check(
    farName() === 'Typed by hand' &&
      !shownButtons().length &&
      /takes nothing from this computer/.test(far().querySelector(LIVE + ' .ap-term').textContent),
    'an agent that takes nothing from here has no button, and the box says why'
  );

  // ---- back to a thread of this computer ----
  listSlot()
    .querySelector('.tnt-th[data-pane="' + CSS.escape(home) + '"]')
    .click();
  check(
    !!(await until(() => onScreen(ownView()) && !onScreen(host()), 4000)) &&
      remote.selected() === '' &&
      history.remote() === '',
    'a press on a thread of this computer brings that thread back, and lets the agent go'
  );
  check(
    !!(await until(() => marked().join() === home, 3000)),
    'the open thread is the one marked again: ' + JSON.stringify(marked())
  );
  await pressRow('Wren');
  await until(() => farName() === 'Wren', 5000);
  threads.show(home);
  check(
    !!(await until(() => onScreen(ownView()) && !onScreen(host()), 4000)) && farName() === '',
    '"go to this agent" for the thread that was open already brings it back too'
  );

  // ---- from another page ----
  window.TnaiRoute('skills');
  await until(() => !threads.visible(), 4000);
  await pressRow('Moss');
  check(
    !!(await until(() => threads.visible() && farName() === 'Moss', 6000)) &&
      !layout.classList.contains('agents-mode'),
    'from another page the press opens the Threads page with that agent in its main area'
  );

  // ---- the smallest window ----
  const small = await main('size', 768, 680);
  await frame();
  await wait(300);
  {
    const slot = rect(mainSlot());
    const inside = [...far().querySelectorAll('.ap-head, .ap-actions button, .ap-term, .ap-sec')]
      .filter(onScreen)
      .every(node => rect(node).left >= slot.left - 0.5 && rect(node).right <= slot.right + 0.5);
    check(
      inside && host().scrollWidth <= host().clientWidth + 1,
      'at the smallest window (' + small.join(' by ') + ') every part stands inside the main area'
    );
  }
  await shot('thread-remote-small');
  await main('size', 1440, 900);
  await frame();

  // ---- late join: its conversation, read only, and the line of why agents are not listed ----
  // A held conversation (made up, as the main process would hand it to `remote:log`) with a
  // report that asks a decision, a question and a helper's start: the section shows it marked as
  // that computer's, with "Show earlier" as its one button, and the pictures are taken in Dark and
  // Light at 1440, 1024 and a tablet size.
  {
    const held = {
      state: 'held',
      more: true,
      full: false,
      older: false,
      rev: 1,
      at: nowMs,
      entries: [
        { k: 'you', text: 'Fix the login page', at: nowMs - 9000 },
        {
          k: 'say',
          text: 'Done.\n\nTechnically Not report\n- Did: fixed it\n- Decide: Ship it? | 1. Yes | 2. No',
          at: nowMs - 8000,
        },
        { k: 'act', verb: 'Edited', what: 'src/login.js', at: nowMs - 7000 },
        { k: 'act', verb: 'Started a sub-agent', what: 'look around', at: nowMs - 6000 },
        {
          k: 'ask',
          questions: [{ q: 'Which file?', options: ['a.js', 'b.js'] }],
          at: nowMs - 5000,
        },
        { k: 'worked', ms: 65000, at: nowMs - 4000 },
      ],
    };
    await main('logStub', held);
    const talkRows = farAgents.map(a =>
      a.id === 'p1' ? { ...a, talk: true, rev: 1, log: { rev: 1, at: nowMs, state: 'held' } } : a
    );
    await push(state({}, talkRows));
    await pressRow('Wren');
    const section = () => host()?.querySelector('.ap-talk-sec');
    const drawn = await until(
      () =>
        section() && !section().hidden && section().querySelectorAll('.tnt-talk-list > *').length,
      5000
    );
    check(
      !!drawn &&
        /As Sample laptop reported it/.test(
          section().querySelector('.ap-term-tools em').textContent
        ),
      'late join: the conversation is drawn above the live picture, marked as that computer’s'
    );
    const buttons = [...section().querySelectorAll('button')].filter(onScreen);
    check(
      buttons.length === 1 && buttons[0].textContent.trim() === 'Show earlier',
      'late join: its only button is Show earlier (' +
        buttons.map(b => b.textContent).join(', ') +
        ')'
    );
    check(
      !section().querySelector('a[href], img, .tnt-decide-options, .tnt-ask-option, .tnt-helper'),
      'late join: no link, picture, decision, option or helper button in it'
    );
    const asksBefore = await main('logAsks');
    buttons[0].click();
    check(
      !!(await until(async () => (await main('logAsks')) > asksBefore, 3000)),
      'late join: Show earlier asks once'
    );
    for (const [width, height, label] of [
      [1440, 900, '1440'],
      [1024, 768, '1024'],
      [820, 1180, 'tablet'],
    ]) {
      await main('size', width, height);
      for (const look of ['dark', 'light']) {
        window.TnaiTheme?.set?.(look);
        await wait(400);
        const slot = rect(mainSlot());
        check(
          rect(section()).left >= slot.left - 0.5 && rect(section()).right <= slot.right + 0.5,
          'late join: the section stands inside the main area at ' + label + ' in ' + look
        );
        await shot('thread-remote-talk-' + label + '-' + look);
      }
    }
    window.TnaiTheme?.set?.('dark');
    await main('size', 1440, 900);

    // a computer none of whose agents work in this project: its group and the line why
    await push(
      state(
        { elsewhere: 2 },
        farAgents.map(a => ({ ...a, sure: false }))
      )
    );
    const why = await until(() => listSlot()?.querySelector('.tnt-why'), 4000);
    check(
      !!why && /2 agents in other projects\..*Open the same git project/.test(why.textContent),
      'late join: the "On" group says why its agents are not listed: ' +
        (why?.textContent || 'none')
    );
    for (const look of ['dark', 'light']) {
      window.TnaiTheme?.set?.(look);
      await wait(400);
      await shot('thread-remote-why-' + look);
    }
    window.TnaiTheme?.set?.('dark');

    // the Devices card of a pairing whose first switch was on before the new sentence
    // The page reads the service's own state when it opens (off in this profile), so the made-up
    // one is pushed again once it is open, as the service pushes a change.
    window.TnaiRoute?.('devices');
    await until(() => document.querySelector('#devicesPage .dv-off, #devicesPage .dv-card'), 4000);
    await push(state({ reads: false }));
    const keep = await until(
      () =>
        [...document.querySelectorAll('#devicesPage .dv-muted button')].find(
          b => b.textContent.trim() === 'Keep on'
        ),
      5000
    );
    check(
      !!keep,
      'late join: "Keep on" stands in the first switch’s line: ' +
        (document.getElementById('devicesPage')?.textContent || 'no page').slice(0, 700) +
        ' / layout ' +
        document.querySelector('.layout')?.className
    );
    for (const [width, height, label] of [
      [1440, 900, '1440'],
      [1024, 768, '1024'],
      [820, 1180, 'tablet'],
    ]) {
      await main('size', width, height);
      for (const look of ['dark', 'light']) {
        window.TnaiTheme?.set?.(look);
        await wait(400);
        await shot('devices-keep-on-' + label + '-' + look);
      }
    }
    window.TnaiTheme?.set?.('dark');
    await main('size', 1440, 900);
    threads.open();
    await until(() => threads.visible(), 4000);
    await push(state({}));
    await main('logStub', null);
  }

  // ---- the agent leaves ----
  // The late join part above ended with no agent of that computer listed: Moss is shown again
  // first.
  await pressRow('Moss');
  await until(() => farName() === 'Moss', 5000);
  await push(state({}, farAgents.slice(0, 1)));
  check(
    !!(await until(
      () => /Moss on Sample laptop is no longer listed here\./.test(host().textContent),
      4000
    )) &&
      !shownButtons().length &&
      !moreShown(),
    'an agent that left the list says so in the main area, and has no button: ' +
      (host()?.textContent || 'no view').slice(0, 300) +
      ' / buttons ' +
      shownButtons().join(', ') +
      ' / more ' +
      moreShown()
  );
  await pressRow('Wren');
  check(
    !!(await until(() => farName() === 'Wren' && shownButtons().length > 0, 5000)),
    'a press on another agent shows that agent again'
  );
  await push({ ...real, on: false, computers: [] });
  check(
    !!(await until(() => !remoteRows().length, 4000)),
    'connecting off: no agent of another computer is listed'
  );
  check(!sawOldPage, 'the layout never had the class agents-mode');
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
watchPage.disconnect();
return { ok, log };
