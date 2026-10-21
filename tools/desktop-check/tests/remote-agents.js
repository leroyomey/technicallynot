// Technically Not tools · desktop-check/tests/remote-agents.js — another computer's agents in the
// thread view (src/scripts/116-remote-agents.js, shown by 138, hooks in 11). Moved here from the
// old Agents and history page on 2026-10-12: "the page" below is the Threads page, and the detail
// stands in the thread's main area
// in the real app with a throwaway profile. Nothing is paired
// here: the states and the live-view pictures are made up by this test and pushed the way the main
// process pushes real ones (remote-agents.main.js); a press goes to the real service, which has
// nobody to send to and answers "not sent". Proven here: with nothing known the page is as it was;
// a computer's agents known to be in this project are rows of the thread list beside the page (the
// page has no list of its own); a press on one shows the detail with what is known and asks for the
// live view by itself, once; the picture is drawn into the terminal box as text; what cannot be
// watched says why; only the buttons with a path are offered, off for a moment after the rows
// moved; the composer's hint says where a prompt goes, and a command or a prompt that did not leave
// stays in the box. What crosses between two computers is the two-copies check's. Returns {ok,
// log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const frame = () =>
  Promise.race([
    new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))),
    wait(1500).then(() => false),
  ]);
const shot = async name => {
  await frame();
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = 'm' + ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
const layout = document.querySelector('.layout'),
  R = window.tnaiNative.remote;

// The layout must never show the old Agents and history page.
let sawOldPage = layout.classList.contains('agents-mode');
new MutationObserver(() => {
  if (layout.classList.contains('agents-mode')) sawOldPage = true;
}).observe(layout, { attributes: true, attributeFilter: ['class'] });

// The thread's main area, and in it the box of another computer's agent (138).
const mainSlot = () => window.TnaiThreads.slot('main'),
  host = () => mainSlot()?.querySelector(':scope > .tnh-view') || null;

// How many threads of this computer the list shows: what the old page's count said.
const ownCount = () =>
  String(
    window.TnaiThreads.slot('list').querySelectorAll('.tnt-th:not([data-remote]):not(.tnt-sub)')
      .length
  );
const box = n => n.getBoundingClientRect(),
  inside = (n, outer) => {
    const a = box(n),
      b = box(outer);
    return (
      a.left >= b.left - 1 &&
      a.right <= b.right + 1 &&
      a.top >= b.top - 1 &&
      a.bottom <= b.bottom + 1
    );
  };
const go = async view => {
  if (view === 'threads') {
    window.TnaiThreads.open();
    await until(() => window.TnaiThreads.visible());
  } else {
    window.TnaiRoute(view);
    await until(() => layout.classList.contains(view + '-mode'));
  }
  await frame();
};

// The page has no list of its own: another computer's agents are rows of the thread list beside
// it (119), and a press there selects one on the page.
const threadList = () => window.TnaiThreads.slot('list'),
  farRows = () => [...threadList().querySelectorAll('.tnt-th[data-remote]')],
  markedRows = () => [...threadList().querySelectorAll('.tnt-th[aria-selected="true"]')],
  far = () => host()?.querySelector('.ap-agent.ap-far') || null;

// This computer's own thread in the main area: "hidden" while another computer's agent fills it.
const own = () => {
  const view = mainSlot()?.querySelector(':scope > .tnt-view');
  return view ? { hidden: view.getClientRects().length === 0 } : null;
};
const shownFar = () => {
  const f = far();
  return f && !f.hidden && f.getClientRects().length > 0 ? f : null;
};
const btn = word =>
  [...(shownFar()?.querySelectorAll('button') || [])].find(
    b => b.textContent.trim() === word && !b.hidden
  ) || null;
const kv = () =>
  Object.fromEntries(
    [...(shownFar()?.querySelectorAll('[data-sec=now] dt') || [])].map(dt => [
      dt.textContent,
      dt.nextElementSibling?.textContent || '',
    ])
  );

// The live screen's box. The conversation (152) stands above it in the same parts, so it is
// told apart by its own section class.
const LIVE = '.ap-term-sec:not(.ap-talk-sec)';
const term = () => shownFar()?.querySelector(LIVE + ' .ap-term') || null;

// The thread's "..." (164) stands in the head while its agent is listed, also for one that takes
// nothing from here (its rows are greyed with their reason); it leaves with the agent.
const moreShown = () => {
  const more = shownFar()?.querySelector('.ap-actions .tnr-more');
  return !!more && !more.hidden && more.getClientRects().length > 0;
};
const hintEl = () => document.querySelector('.composer .tnai-route-hint'),
  hint = () => {
    const t = hintEl()?.textContent || '';
    return /^On .+ → /.test(t) && !hintEl().hidden ? t : '';
  };
const calm = () => until(() => !window.TnaiDevices.quiet(), 3000),
  clickRow = async i => {
    await calm();
    farRows()[i].click();
  };
const views = list => list.filter(c => c.ch === 'remote:view');

check(
  !!window.TnaiThreadHistory?.remote && !!window.TnaiRemoteAgents?.mount,
  "the thread view's place for another computer's agents and its hooks exist"
);
const real = (await R.state()).value,
  nowMs = Date.now(),
  ended = nowMs - 120000;
const answer = 'Here is what I did.\nLine two of the answer, with <b>markup as text</b>.';
const agents = [
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
  }, // the text itself is read through `remote:reportText` (the main side stands in for it)
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
  {
    id: 'p4',
    name: 'In another project or unknown',
    cli: 'Codex',
    status: 'idle',
    since: 0,
    sure: false,
    can: true,
    mark: 'm4',
  },
];
const odd = [
  ...agents,
  {
    id: 'p5',
    name: 'Odd',
    cli: 'constructor',
    status: 'idle',
    since: 0,
    sure: true,
    can: false,
    mark: '',
  },
  {
    id: 'p6',
    name: 'Odder',
    cli: '__proto__',
    status: 'idle',
    since: 0,
    sure: true,
    can: false,
    mark: '',
  },
];
const pc = {
  id: 'sample-computer-1',
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
  canWatch: true,
  canStart: [],
  ops: [],
  finished: null,
  agents,
};
const state = (more, list) => ({
  ...real,
  on: true,
  computers: [{ ...pc, ...more, agents: list || agents }],
  others: [],
  watching: [],
});
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

{
  const asked = await main('loadCalls');
  check(
    asked.includes('on') &&
      asked.includes('onView') &&
      !asked.includes('state') &&
      asked.every(a => a === 'on' || a === 'onView'),
    "review 16, 2.4: while it loads the page's script only listens; it asks the main process for nothing (the remote state touches secure storage): " +
      asked.join(', ')
  );
}
{
  const spied = await main('spy');
  check(
    spied.includes('remote:view') && spied.includes('remote:prompt'),
    'what the window asks the remote service is written down from here on: ' + spied.join(', ')
  );
}
await main('answerText', { at: ended, got: nowMs, text: answer, more: 0 });

// ---- nothing known: the page is as it was ----
await go('threads');
await main('show', { ...real, on: false, computers: [] });
await wait(300);
const before = {
  count: ownCount(),
  ownShown: !!own() && !own().hidden,
};
check(
  farRows().length === 0 && !shownFar(),
  'connecting off: no row of another computer in the thread list, no detail of one'
);
for (const [label, s] of [
  ['nothing paired', { ...real, on: true, computers: [] }],
  [
    'connecting off while a computer with agents of this project is still in the state',
    { ...state(), on: false },
  ],
  [
    'a paired computer whose rows are not known to be in this project (its first switch is off, or an older version)',
    state(
      {},
      agents.map(a => ({ ...a, sure: false }))
    ),
  ],
  ['a paired computer that is offline', state({ state: 'offline', session: false, online: false })],
  [
    'a paused pairing',
    state({ state: 'paused', asks: [{ id: 'x', name: 'Third', kind: 'forget' }] }),
  ],
]) {
  await main('show', s);
  await wait(250);
  check(
    farRows().length === 0 && ownCount() === before.count && !shownFar(),
    label + ': no row of another computer, and the count is exactly as before'
  );
}

// ---- a computer's agents of this project: rows of the thread list beside the page. How that
// group looks and where it stands is the test thread-list-remote's. ----
await main('show', state());
await until(() => farRows().length === 3);
const rows = farRows();
check(
  rows.length === 3 &&
    rows.map(r => r.querySelector('b').textContent).join() === 'Wren,Moss,Typed by hand' &&
    !/another project or unknown/.test(threadList().textContent),
  'its agents known to be in this project are rows of the thread list; one whose project is not known to be this one is not'
);
check(
  !mainSlot().querySelector('.ap-list, .ap-rows, .ap-far-group, .ap-far-row') &&
    ownCount() === before.count,
  "the page has no list of its own for them, and its count of this computer's agents is unchanged"
);

// A CLI name from the other computer that every object has: the detail's mark is drawn by 116.
await main('show', state({}, odd));
await until(() => farRows().length === 5);
{
  const marks = [];
  for (const at of [3, 4]) {
    await clickRow(at);
    const name = at === 3 ? 'Odd' : 'Odder';
    await until(() => shownFar()?.querySelector('h2').textContent === name, 3000);
    const mark = shownFar()?.querySelector('.ap-avatar');
    marks.push(mark ? mark.innerHTML : null);
  }
  check(
    marks.every(html => typeof html === 'string' && html.length === 1 && !/[<>]/.test(html)),
    'review 16, 2.8: a CLI name from the other computer that every object has ("constructor", "__proto__") gets a letter, never markup: ' +
      JSON.stringify(marks)
  );
  window.TnaiRemoteAgents.select('');
}
await main('show', state());
await until(() => farRows().length === 3);
await shot('remote-agents-list');

// ---- selecting one: the detail with what is known, and the live view asked by that selection ----
await clickRow(1);
const f = await until(shownFar);
check(
  !!f &&
    (!own() || own().hidden) &&
    f.querySelector('h2').textContent === 'Moss' &&
    f.querySelector('.ap-id small').textContent === 'Codex · on Sample laptop' &&
    !!(await until(() => markedRows().length === 1 && markedRows()[0] === farRows()[1], 3000)),
  "a press on such a row shows its detail in the page's layout (name, CLI, the computer); it is the one row marked open"
);
check(
  !!f &&
    [
      'ap-head',
      'ap-actions',
      'ap-grid',
      'ap-main',
      'ap-term-sec',
      'ap-term-bar',
      'ap-term',
      'ap-side',
    ].every(c => f.querySelector('.' + c)) &&
    f.querySelector(LIVE + ' .ap-term-bar span').textContent === 'LIVE SCREEN' &&
    inside(f, mainSlot()),
  "the detail is built from the page's own parts: head, actions, the live terminal box, the side sections"
);
check(
  kv().Status === 'Idle' &&
    /^Sample laptop \(sample-c\)$/.test(kv().Computer || '') &&
    !('Task' in kv()),
  'NOW says what is known: status and the computer it runs on: ' + JSON.stringify(kv())
);
await until(
  () => [...f.querySelectorAll('[data-sec=last] p')].some(p => p.textContent === answer),
  3000
); // read once, when this agent is shown
{
  const last = [...f.querySelectorAll('[data-sec=last] p')].map(p => p.textContent);
  check(
    !f.querySelector('[data-sec=last]').hidden &&
      last[0] === 'Finished ' + hhmm(ended) + ': Ran the tests; two failed' &&
      last[1] === 'Task: Run the tests' &&
      last[2] === answer &&
      last[3] === 'This is the whole answer, as Sample laptop sent it.' &&
      !f.querySelector('[data-sec=last] b'),
    'LAST RESULT shows the finished answer as that computer sent it, as text: ' + last[0]
  );
}
{
  const t0 = Date.now(),
    soon = term()?.textContent,
    v0 = views(await main('calls')).length;
  check(
    soon === 'Watching starts in a moment.' &&
      term().dataset.view === 'soon' &&
      v0 === 0 &&
      !btn('Watch again'),
    'review 16, 2.3: a row that was just selected is not asked for yet: ' +
      soon +
      ' (' +
      v0 +
      ' asked)'
  );
  const first = await until(async () => {
    const v = views(await main('calls'));
    return v.length ? v : null;
  }, 4000);
  check(
    !!first &&
      first.length === 1 &&
      first[0].at - t0 >= 800 &&
      first[0].args.join() === 'sample-computer-1,p2,m2',
    'it stayed selected: asked once, about a second later, for that agent with its mark: ' +
      (first ? first[0].at - t0 + ' ms, ' + first[0].args.join() : 'never')
  );
}
check(
  !!(await until(() =>
    /^(Asking Sample laptop|Not asked: Sample laptop is not connected)/.test(
      term()?.textContent || ''
    )
  )),
  'the selection itself asked for the live view (nothing is paired in this profile, so the box says: not asked): ' +
    (term()?.textContent || '')
);
check(
  term().querySelector('p').classList.contains('ap-none') && !term().querySelector('.dv-screen'),
  "without a picture the terminal box holds one line of the page's muted text"
);
const until1 = Date.now() + 9 * 60000,
  at1 = Date.now() - 3000;
const lines = [
  { t: 'moss is working', r: [[0, 4, 2, -1, 1]] },
  { t: '<img src=x onerror="window.__raHit=1"> https://example.com', r: [] },
  { t: '> an input row', r: [[2, 2, -1, -1, 2]] },
];
const model = more => ({
  peer: 'sample-computer-1',
  agent: 'p2',
  name: 'Moss',
  state: 'on',
  why: '',
  until: until1,
  left: 77,
  picture: { cols: 80, rows: 3, cut: 0, at: at1, incomplete: false, lines },
  ...more,
});
await main('view', model());
const scr = await until(() => term()?.querySelector('.dv-screen'));
check(
  !!scr &&
    scr.children.length === 3 &&
    [...scr.children].map(r => r.textContent).join('|') === lines.map(l => l.t).join('|') &&
    scr.querySelector('span')?.className === 'f2 b' &&
    !scr.querySelector('img, a, button') &&
    !window.__raHit &&
    term().dataset.view === 'on',
  'the picture is drawn into the terminal box: rows of text, a style run as a class, markup and a web address as text, nothing pressable'
);
check(
  /^Live\. Last change .+\. Ends at .+ unless you press Keep watching\. 77 minutes of today's 120 are left\.$/.test(
    kv()['Live terminal'] || ''
  ) &&
    !!btn('Keep watching') &&
    !btn('Watch again'),
  "NOW says where the view stands, and Keep watching is offered in the terminal box's bar: " +
    kv()['Live terminal']
);
if (scr) {
  const t = box(term()),
    s = box(scr);
  check(
    s.left >= t.left - 1 &&
      s.right <= t.right + 1 &&
      s.height > 40 &&
      host().scrollWidth <= host().clientWidth + 1 &&
      inside(btn('Keep watching'), f),
    'the picture fills the terminal box and nothing runs out of the page (' +
      Math.round(s.width) +
      ' x ' +
      Math.round(s.height) +
      ')'
  );
}
{
  const d = box(host()),
    h = box(f.querySelector('.ap-head')),
    dd = f.querySelector('.ap-kv dd');
  check(
    h.top - d.top < 24 &&
      d.bottom - box(f).bottom < 24 &&
      getComputedStyle(dd).textAlign !== 'center',
    "the detail fills its box from the top like this computer's own (no centered block, no centered text): head " +
      Math.round(h.top - d.top) +
      " px below the box's top"
  );
}
await shot('remote-agents-detail');
await main(
  'view',
  model({
    peer: 'sample-computer-1',
    agent: 'p1',
    picture: {
      cols: 5,
      rows: 1,
      cut: 0,
      at: at1,
      incomplete: false,
      lines: [{ t: 'other agent', r: [] }],
    },
  })
);
await wait(250);
check(
  !/other agent/.test(term().textContent),
  "a picture of another agent's view is not drawn into this detail"
);
await main('view', model({ state: 'ended', why: 'timeout' }));
check(
  !!(await until(() => btn('Watch again'))) &&
    !btn('Keep watching') &&
    term().dataset.view === 'ended' &&
    /^Ended after 10 minutes without Keep watching\./.test(kv()['Live terminal'] || '') &&
    term().querySelector('.dv-screen')?.children.length === 3,
  'the view ended: its last picture stays with the reason, Watch again is offered'
);
await main('show', state({ heard: nowMs + 1 }));
await main('show', state({ heard: nowMs + 2 }));
await wait(900);
check(
  term().dataset.view === 'ended' && !!btn('Watch again'),
  'it is not asked again by itself when the list repaints: only Watch again asks'
);
await main('show', state({ canWatch: false }));

// nothing new may be asked from here on, so only the selection itself can take the picture away
await wait(250);
await clickRow(0);
await until(() => shownFar()?.querySelector('h2').textContent === 'Wren');
await clickRow(1);
await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
await wait(200);
check(
  !term().querySelector('.dv-screen') && term().dataset.view === 'no',
  "another row was selected: the ended view's kept picture is gone, also when its row is selected again and nothing new may be asked"
);
await main('show', state());
await wait(250);
check(
  term().textContent === 'Not watched yet.' &&
    term().dataset.view === 'ended' &&
    !!btn('Watch again'),
  'review 16, 2.7d: the row was selected before that computer let this one watch: the box says nothing was asked, and offers Watch again: ' +
    term().textContent
);

// ---- another row is selected, the page is left ----
await main('view', model());
await until(() => term()?.dataset.view === 'on');
await clickRow(0);
check(
  !!(await until(() => shownFar()?.querySelector('h2').textContent === 'Wren')) &&
    !term().querySelector('.dv-screen') &&
    kv().Task === 'Fix the login page' &&
    /^Working since /.test(kv().Status || '') &&
    shownFar().querySelector('[data-sec=last]').hidden,
  "another row of that computer is selected: nothing of the last view's picture is shown for it; it has its own status and task and no last result"
);
await main('view', model());
await wait(250);
check(
  !term().querySelector('.dv-screen'),
  'a late picture of the agent that is no longer selected is not drawn'
);
await main('view', model({ agent: 'p1', name: 'Wren' }));
await until(() => term()?.dataset.view === 'on');
await go('skills');
await go('threads');
check(
  !!shownFar() &&
    shownFar().querySelector('h2').textContent === 'Wren' &&
    term().dataset.view === 'ended' &&
    term().textContent === 'Watching stopped when you left this page.' &&
    !!btn('Watch again'),
  'the page was left while a view ran: it ended, and coming back does not start one: ' +
    (term()?.textContent || '')
);

// ---- what cannot be watched says why; only the buttons with a path are offered ----
const offered = () =>
  [...(shownFar()?.querySelectorAll('.ap-actions button:not(.tnr-more)') || [])]
    .filter(b => !b.hidden)
    .map(b => b.textContent.trim())
    .join();
check(
  offered() === 'Send composer tasks here,Interrupt,Stop',
  'a working agent that takes operations: Send composer tasks here, Interrupt and Stop, and nothing else: ' +
    offered()
);
check(
  !shownFar().querySelector(
    '[data-act=open], [data-act=start], [data-act=close], [data-act=rename], .ap-rename, .ap-font[data-tnai-font]'
  ),
  'Open in Terminal, Start, Close, rename and text size are not offered for it'
);
await clickRow(1);
await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
check(
  offered() === 'Send composer tasks here,Follow up,Stop',
  'an idle one with a finished answer: Follow up instead of Interrupt: ' + offered()
);
await clickRow(2);
await until(() => shownFar()?.querySelector('h2').textContent === 'Typed by hand');
check(
  offered() === '' &&
    /takes nothing from this computer/.test(term().textContent) &&
    term().dataset.view === 'no' &&
    !btn('Watch again') &&
    !btn('Keep watching'),
  'an agent that takes nothing from here: no button at all, and the box says why: ' +
    term().textContent
);
await main('show', state({ canWatch: false }));
await clickRow(0);
await until(() => shownFar()?.querySelector('h2').textContent === 'Wren');
check(
  /does not let this computer watch yet/.test(term().textContent) &&
    term().dataset.view === 'no' &&
    !btn('Watch again') &&
    offered() === 'Send composer tasks here,Interrupt,Stop',
  'a computer that does not let this one watch: the box says so and asks for nothing; the buttons that have a path stay: ' +
    term().textContent
);
await main('show', state());

// the quiet time, and a press
const early = await until(() => btn('Stop'));
check(
  !!early &&
    early.disabled &&
    btn('Interrupt').disabled &&
    btn('Send composer tasks here').disabled,
  "right after that computer's rows moved, the buttons take no press"
);
check(
  !!(await until(() => {
    const b = btn('Stop');
    return b && !b.disabled ? b : null;
  }, 3000)),
  'and come back by themselves'
);
check(
  btn('Stop').getAttribute('aria-label') === 'Stop Wren on Sample laptop' &&
    getComputedStyle(btn('Stop')).color !== getComputedStyle(btn('Interrupt')).color,
  "Stop names its agent and computer and has the look of the page's Stop"
);
btn('Stop').click();
const confirm = await until(() =>
  [...host().querySelectorAll('*')].find(
    n => n.children.length === 0 && n.textContent === 'Stop Wren on Sample laptop?'
  )
);
check(!!confirm, 'Stop asks first, in the page\'s own confirmation: "Stop Wren on Sample laptop?"');
{
  const cancel = [...host().querySelectorAll('button')].find(
    b => /^(Cancel|No|Keep)/.test(b.textContent.trim()) && b.offsetParent
  );
  cancel?.click();
  await wait(200);
}
await main(
  'show',
  state({
    ops: [{ n: 'a1', kind: 'act', id: 'p1', do: 'interrupt', state: 'done', at: Date.now() }],
  })
);
check(
  !!(await until(() => kv()['Sent from here'] === 'Interrupted')),
  "what became of something sent from here is said in NOW, in the page's words: " +
    (kv()['Sent from here'] || '')
);

const said = [];
{
  const t0 = window.toast;
  window.toast = m => {
    said.push(String(m));
    return typeof t0 === 'function' ? t0(m) : undefined;
  };
}
const opsNow = {
  ops: [{ n: 'a1', kind: 'act', id: 'p1', do: 'interrupt', state: 'done', at: Date.now() }],
};
await main('show', state(opsNow));
await wait(900);

// A row that is not shown here moved (another project's agent on that computer): this page does not
// repaint, so its buttons look ready.
await main(
  'show',
  state(
    opsNow,
    agents.map(a => (a.id === 'p4' ? { ...a, mark: 'm4-moved' } : a))
  )
);
await wait(120);
{
  const b = btn('Interrupt');
  check(
    !!b && !b.disabled,
    'a row of that computer that is not shown here moved: the buttons were not repainted'
  );
  b?.click();
  await wait(250);
  check(
    said.at(-1) === 'The list had just changed, so nothing was sent. Look again, then press.',
    "a press right after that computer's rows moved sends nothing and says so, also when the button looked ready: " +
      said.at(-1)
  );
}
await wait(900);
said.length = 0;
btn('Stop').click();
await until(() =>
  [...host().querySelectorAll('*')].find(
    n => n.children.length === 0 && n.textContent === 'Stop Wren on Sample laptop?'
  )
);
await main(
  'show',
  state(
    opsNow,
    agents.map(a => (a.id === 'p1' ? { ...a, name: 'Someone else', mark: 'm1-other' } : a))
  )
);
await wait(900);
{
  const yes = [...host().querySelectorAll('button')].find(
    b => b.textContent.trim() === 'Stop' && !b.closest('.ap-actions') && b.offsetParent
  );
  check(!!yes, 'the question is still open after the row changed');
  yes?.click();
  await wait(400);
  check(
    said.length === 1 &&
      said[0] === 'Wren changed or closed on Sample laptop meanwhile, so nothing was sent.',
    'the row holds another agent by the time Stop is confirmed: nothing is sent, and it says so: ' +
      JSON.stringify(said)
  );
}

// ---- the composer ----
await main('show', state());
await clickRow(1);
await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
check(
  !window.TnaiRemoteAgents.target() && hint() === '',
  "selecting a row of another computer does not make it the composer's target"
);
await until(() => {
  const b = btn('Send composer tasks here');
  return b && !b.disabled ? b : null;
}, 3000);
btn('Send composer tasks here').click();
check(
  !!(await until(() => btn('Composer sends tasks here'))) &&
    btn('Composer sends tasks here').getAttribute('aria-pressed') === 'true' &&
    window.TnaiRemoteAgents.target()?.agent === 'Moss' &&
    !window.TnaiLiveTasks?.target?.(),
  'its own press makes it the target: the button says so, and no agent of this computer is the target any more'
);
check(
  !!(await until(
    () => hint() === 'On Sample laptop → Moss' && hintEl().getClientRects().length > 0,
    2500
  )),
  "the composer's hint says where the prompt goes, the computer first: " + hint()
);
await shot('remote-agents-composer');
const input = document.querySelector('.composer textarea, .composer [contenteditable], #prompt'),
  sendB = document.getElementById('send');
const type = async text => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await frame();
};
if (input && sendB) {
  await type('/help');
  sendB.click();
  await wait(500);
  check(input.value === '/help', 'a command is not sent to another computer, and stays in the box');
  {
    const r1 = await window.TnaiRemoteAgents.send('/help'),
      r2 = await window.TnaiRemoteAgents.send('  !del x');
    check(
      r1.ok === false &&
        /starts with a letter or a number\. Commands are not sent to another computer\.$/.test(
          r1.words
        ) &&
        r2.ok === false &&
        /starts with a letter or a number/.test(r2.words),
      'the reason is said: a prompt for another computer starts with a letter or a number: ' +
        r1.words
    );
  }
  await type('Run the tests again');
  sendB.click();
  await wait(1200);
  check(
    input.value === 'Run the tests again',
    'a prompt that did not leave this computer (nothing is paired here) stays in the box'
  );

  // A prompt that left (the page's send is stood in for here: nothing is paired)
  // leaves the box empty for good
  {
    const own1 = window.TnaiRemoteAgents.send;
    let sends = 0;
    window.TnaiRemoteAgents.send = async () => {
      sends++;
      return { ok: true, words: 'Sent to Moss on Sample laptop' };
    };
    await type('Run them once');
    sendB.click();
    await wait(500);
    const after = input.value;
    sendB.click();
    await wait(400);
    check(
      after === '' &&
        input.value === '' &&
        sends === 1 &&
        said.at(-1) === 'Sent to Moss on Sample laptop',
      'review 16, 2.1: once the prompt left, the box is empty and stays empty: a second Enter has nothing to send (sent ' +
        sends +
        ' time(s), box: "' +
        after +
        '")'
    );

    // The hint is not drawn (a composer too narrow even with the key hints gone, which leave
    // first for a line that names another computer): the first Enter only says where it would go
    const foot = document.querySelector('footer.composer'),
      w0 = foot.style.width;
    foot.style.width = '300px';
    await frame();
    await wait(150);
    check(
      hintEl().getClientRects().length === 0,
      '(the composer is narrow: its hint is not drawn)'
    );
    said.length = 0;
    sends = 0;
    await type('Deploy it');
    sendB.click();
    await wait(400);
    check(
      sends === 0 &&
        input.value === 'Deploy it' &&
        said.length === 1 &&
        said[0] === 'This goes to Moss on Sample laptop. Press Enter again to send it there.',
      'review 16, 2.2: with no hint on screen the first Enter sends nothing and says where the prompt would go: ' +
        JSON.stringify(said)
    );
    sendB.click();
    await wait(400);
    check(sends === 1 && input.value === '', 'the next Enter, with the same text, sends it');
    said.length = 0;
    await type('Deploy it');
    await type('Deploy it again');
    sendB.click();
    await wait(400);
    check(
      sends === 1 && said.length === 1 && /^This goes to Moss on Sample laptop\./.test(said[0]),
      'another text is asked about again'
    );
    foot.style.width = w0;
    await frame();
    await wait(200);
    said.length = 0;
    sendB.click();
    await wait(400);
    check(
      sends === 2 && input.value === '' && hintEl().getClientRects().length > 0,
      'with the hint drawn, Enter sends at once: ' + JSON.stringify(said)
    );
    window.TnaiRemoteAgents.send = own1;
    await type('');
  }
  const A = window.TnaiAttachments;
  if (A?.add) {
    A.add(
      [new File(['a made-up note of this test'], 'sample-note.txt', { type: 'text/plain' })],
      'upload'
    );
    await until(() => A.count() === 1, 3000);
    await wait(900);
    said.length = 0;
    await type('Read the note');
    sendB.click();
    await wait(600);

    // Since 2026-10-10 an attachment IS sent with a prompt to another computer
    // ("A, the composer"): the first Enter sends nothing and says
    // what would go and how long it takes; the next Enter, with the same draft and files, sends.
    check(
      A.count() === 1 &&
        input.value === 'Read the note' &&
        said.length === 1 &&
        said[0].startsWith('Enter again sends 1 file (') &&
        said[0].includes(
          ' to Moss on Sample laptop'
        ) /* the words since the first Enter's line was shortened, 2026-10-10 */,
      'an attachment for another computer: the first Enter sends nothing and says what would go, to which agent on which computer; the draft and the attachment stay: ' +
        JSON.stringify(said)
    );
    A.clear();
    await wait(100);
  } else check(false, "the composer's attachments were found");
  await type('');
} else check(false, "the composer's input and Send button were found");

// ---- rows that are only passed ask nothing; asked too often says so ----
await calm();
{
  const n0 = views(await main('calls')).length;
  farRows()[0].click();
  await wait(120);
  farRows()[1].click();
  await wait(120);
  farRows()[0].click();
  await wait(350);
  const mid = views(await main('calls')).length - n0,
    words = term().textContent;
  check(
    mid === 0 &&
      words === 'Watching starts in a moment.' &&
      shownFar().querySelector('h2').textContent === 'Wren',
    'review 16, 2.3: three rows clicked through in half a second: nothing was asked of the other computer: ' +
      mid +
      ' asked, "' +
      words +
      '"'
  );
  await wait(1300);
  const got = views(await main('calls')).slice(n0);
  check(
    got.length === 1 && got[0].args[1] === 'p1' && got[0].args[2] === 'm1',
    'only the row that stayed selected is asked for, once: ' + got.map(c => c.args[1]).join()
  );
  for (
    let i = 0;
    i < 6 && term().textContent !== 'Asked too often. Watch again in a minute.';
    i++
  ) {
    const b = await until(() => btn('Watch again'), 3000);
    if (!b) break;
    b.click();
    await wait(300);
  }
  const all = views(await main('calls')),
    minute = all.filter(c => Date.now() - c.at < 60000).length;
  check(
    term().textContent === 'Asked too often. Watch again in a minute.' &&
      minute >= 3 &&
      minute <= 4 &&
      !!btn('Watch again'),
    'review 16, 2.3: the fifth ask inside a minute is not sent, and the box says why: ' +
      minute +
      ' asked in the last minute, "' +
      term().textContent +
      '"'
  );
  btn('Watch again')?.click();
  await wait(300);
  check(
    views(await main('calls')).length === all.length &&
      term().textContent === 'Asked too often. Watch again in a minute.',
    'and pressing again inside that minute asks nothing'
  );
}
await clickRow(1);
await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
await main(
  'show',
  state(
    {},
    agents.map(a => (a.id === 'p2' ? { ...a, mark: 'other-mark', name: 'Another agent' } : a))
  )
);
check(
  !!(await until(() => !window.TnaiRemoteAgents.target() && hint() === '')) &&
    said.some(m =>
      /^Moss on Sample laptop: It changed, closed or is no longer listed here/.test(m)
    ),
  "the chosen agent's row holds another agent now: that one is not the composer's target (a prompt never goes to an agent that was not chosen), and it says so: " +
    JSON.stringify(said.slice(-1))
);
{
  const r = await window.TnaiRemoteAgents.send('Hello');
  check(
    r.ok === false && /changed, closed or is no longer listed/.test(r.words),
    'and a send for it sends nothing: ' + r.words
  );
}

// The selection is let go by a push
check(
  /^Moss on Sample laptop changed, or another agent took its place\./.test(
    term()?.textContent || ''
  ) &&
    shownFar().querySelector('h2').textContent === 'Moss' &&
    offered() === '' &&
    !moreShown() &&
    !btn('Watch again') &&
    !btn('Keep watching') &&
    !term().querySelector('.dv-screen') &&
    window.TnaiRemoteAgents.selected() === '' &&
    !!(await until(() => markedRows().length === 0, 3000)),
  'review 16, 2.7c and 2.9: another agent sits under the selected row now: the box keeps the old name with one line and no button, and nothing of the new agent is shown as the old one: ' +
    (term()?.textContent || '')
);
await main('show', state());
await clickRow(1);
await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
await main('view', model());
await until(() => term()?.dataset.view === 'on');
await until(() => {
  const b = btn('Stop');
  return b && !b.disabled;
}, 3000);
btn('Stop').focus();
{
  const held = shownFar().contains(document.activeElement);
  await main(
    'show',
    state(
      {},
      agents.map(a =>
        a.id === 'p2' ? { ...a, mark: 'm2-next', name: 'Wren two', cli: 'Claude Code' } : a
      )
    )
  );
  check(
    held &&
      !!(await until(() => /another agent took its place/.test(term()?.textContent || ''))) &&
      !shownFar().contains(document.activeElement) &&
      !term().querySelector('.dv-screen') &&
      offered() === '' &&
      !moreShown(),
    'review 16, 2.9: the keyboard was on Stop when another agent took the row: the focus is off the box, the picture is gone, no button is left'
  );
}
await main('show', state());
await clickRow(0);
await until(() => shownFar()?.querySelector('h2').textContent === 'Wren');
await main(
  'show',
  state(
    {},
    agents.filter(a => a.id !== 'p1')
  )
);
check(
  !!(await until(
    () => term()?.textContent === 'Wren on Sample laptop is no longer listed here.'
  )) &&
    !!(await until(() => farRows().length === 2, 3000)) &&
    offered() === '' &&
    !moreShown() &&
    (!own() || own().hidden) &&
    window.TnaiRemoteAgents.selected() === '',
  "review 16, 2.5: the selected agent left the list: the box says so and has no button; this computer's own detail is not put in its place: " +
    (term()?.textContent || '')
);

// a row click inside the quiet time is no click
await main(
  'show',
  state(
    {},
    agents.map(a => (a.id === 'p4' ? { ...a, mark: 'm4-again' } : a))
  )
);
await until(() => farRows().length === 3);
await wait(60);
{
  const quiet = window.TnaiDevices.quiet();
  farRows()[1].click();
  await wait(150);
  check(
    quiet &&
      window.TnaiRemoteAgents.selected() === '' &&
      /no longer listed/.test(term()?.textContent || ''),
    "review 16, 2.5: a click on a row right after that computer's rows moved selects nothing"
  );
  await clickRow(1);
  check(
    !!(await until(() => shownFar()?.querySelector('h2').textContent === 'Moss', 2000)),
    'after the quiet time the click selects'
  );
}

// ---- back to nothing ----
await main('show', { ...real, on: false, computers: [] });
check(
  !!(await until(() => farRows().length === 0)) &&
    ownCount() === before.count &&
    /no longer listed here/.test(term()?.textContent || ''),
  'connecting off again: no row of another computer is left, and the box says the agent that was selected is no longer listed'
);
await go('skills');
await go('threads');
check(
  !shownFar() && (!own() || own().hidden !== before.ownShown),
  'the page left and opened again: nothing of another computer is left on it'
);

// ---- one agent of this computer beside them (recorded, no process is started) ----
{
  const G = window.TnaiAgents,
    WS = window.TnaiTerminalWorkspaces,
    type2 = async text => {
      const i = document.getElementById('prompt');
      i.value = text;
      i.dispatchEvent(new Event('input', { bubbles: true }));
      await frame();
    };
  await main('install');
  const started = await window.TnaiTest.open('Terminal', { name: 'Local one' });
  const mine = started.paneId;
  check(
    !!started?.ok && !!(await until(() => G.sessions().some(x => x.paneId === mine))),
    'one agent of this computer started (recorded, no process)'
  );
  await go('threads');
  await wait(300);
  const c0 = ownCount();
  await main('show', state());
  const ownRow = () =>
    threadList().querySelector('.tnt-th[data-pane="' + CSS.escape(mine) + '"]:not(.tnt-sub)');
  await until(() => farRows().length === 3 && ownRow());
  check(
    !!ownRow() &&
      farRows().length === 3 &&
      !!(ownRow().compareDocumentPosition(farRows()[0]) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      ownCount() === c0,
    "this computer's own agent comes first, the other computer's rows after it; the count is of this computer's agents: " +
      ownCount()
  );
  check(
    !!own() && !own().hidden && !shownFar(),
    "nothing of another computer is selected by itself: this computer's own detail shows"
  );
  await clickRow(1);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
  check(
    !!shownFar() &&
      own().hidden &&
      !!(await until(
        () =>
          ownRow().getAttribute('aria-selected') !== 'true' &&
          markedRows().length === 1 &&
          markedRows()[0] === farRows()[1],
        3000
      )),
    'a row of the other computer selected: its detail shows instead, and it is the one row marked open'
  );
  await shot('remote-agents-beside-own');
  ownRow().click();
  await frame();
  await wait(200);
  check(
    !shownFar() &&
      !own().hidden &&
      window.TnaiRemoteAgents.selected() === '' &&
      window.TnaiThreads.visible() &&
      !layout.classList.contains('agents-mode') &&
      !!(await until(() => ownRow().getAttribute('aria-selected') === 'true', 3000)),
    "a row of this computer selected: the other computer's agent is let go and this computer's detail is back"
  );
  await clickRow(1);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
  window.TnaiThreads.show(mine);
  await frame();
  await wait(200);
  check(
    !shownFar() && !own().hidden && window.TnaiRemoteAgents.selected() === '',
    "this computer's agent opened from elsewhere in the app (Overview, a notice): the same"
  );
  await clickRow(1);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
  await until(() => {
    const b = btn('Send composer tasks here');
    return b && !b.disabled ? b : null;
  }, 3000);
  btn('Send composer tasks here')?.click();
  check(
    !!(await until(() => window.TnaiRemoteAgents.target()?.agent === 'Moss')) &&
      !window.TnaiLiveTasks.target(),
    "the other computer's agent is the composer's target: no agent of this computer is"
  );
  check(
    hint() === 'On Sample laptop → Moss',
    "the hint names the other computer at once, not at the composer's next repaint: " + hint()
  );
  {
    const name = ownRow().querySelector('b').textContent,
      tries = [
        '@' + name + ' look at this',
        '@' + name.replace(/\s+/g, '-') + ' look at this',
        '@' + name.split(/\s+/)[0] + ' look at this',
      ],
      text = tries.find(t => window.TnaiMentions?.route?.(t));
    if (text) {
      await type2(text);
      window.TnaiLiveTasks.paintRoute();
      await frame();
      check(
        hint() === '',
        'review 16, 2.7a: a prompt that @mentions an agent of this computer goes to that agent, and the hint no longer names the other computer: "' +
          (hintEl()?.textContent || '') +
          '"'
      );
      await type2('');
      window.TnaiLiveTasks.paintRoute();
    } else
      check(
        false,
        "an @mention of this computer's agent could be written (" + tries.join(' | ') + ')'
      );
  }
  window.TnaiLiveTasks.setTarget(mine);
  check(
    hint() === '',
    'review 16, 2.7b: an agent of this computer was chosen: in the same moment the hint no longer names the other computer'
  );
  await frame();
  await wait(200);
  check(
    !window.TnaiRemoteAgents.target() && window.TnaiLiveTasks.target() === mine && hint() === '',
    "an agent of this computer chosen for the composer: the other computer's agent is no longer the target, and the hint says so"
  );
  await main('show', { ...real, on: false, computers: [] });
  await until(() => farRows().length === 0);
}

// ---- the options of its question. WRITTEN 2026-10-10, NOT YET RUN. ----
{
  const ask = {
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
  await main('show', state({ items: [ask] }));
  await clickRow(1);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
  const pk = () => [...(shownFar()?.querySelectorAll('.ap-picks button') || [])];
  check(
    !!(await until(() => pk().length === 2, 3000)) &&
      pk()
        .map(b => b.textContent)
        .join() === '1,2' &&
      pk()[1].title === '<i>SQLite</i>' &&
      pk().every(b => b.classList.contains('ap-font')) &&
      inside(pk()[0], shownFar().querySelector(LIVE + ' .ap-term-bar')) &&
      !shownFar().querySelector('.ap-picks i'),
    "an agent whose question came with its options shows one small numbered button for each in the terminal box's bar, in that bar's own button style"
  );
  check(
    kv().Asks === 'Which database? · 1 Postgres · 2 <i>SQLite</i>',
    'and NOW says the question with its options, as text: ' + (kv().Asks || '')
  );
  await until(() => pk().length === 2 && pk().every(b => !b.disabled), 3000);
  said.length = 0;
  pk()[1].click();
  await wait(500);
  check(
    said.length === 1 &&
      /^Not sent: Sample laptop is not connected, or the question changed there\.$/.test(said[0]),
    'a press sends "option 2" (here nothing is paired: it says it was not sent): ' +
      JSON.stringify(said)
  );
  await shot('remote-agents-pick');
  await clickRow(0);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Wren');
  check(
    pk().length === 0 && !('Asks' in kv()),
    'another agent of that computer has no such buttons: the question belongs to one row'
  );
  await main('show', state({ items: [{ ...ask, kof: undefined }] }));
  await clickRow(1);
  await until(() => shownFar()?.querySelector('h2').textContent === 'Moss');
  await wait(300);
  check(pk().length === 0, 'options without a binding show no button');
}

// ---- a new agent on another computer from the composer (the gap
// fix of 2026-10-10). WRITTEN 2026-10-10, NOT YET RUN. ----
{
  const RA = window.TnaiRemoteAgents,
    live = window.TnaiLiveTasks,
    box2 = document.getElementById('prompt'),
    sendB2 = document.getElementById('send'),
    newB = document.querySelector('.tnai-new-agent');
  const typeC = async text => {
    box2.value = text;
    box2.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
  };
  const KEY = 'sample-computer-1|claude',
    LINE = 'On Sample laptop → new Claude Code agent';
  await main('show', { ...real, on: false, computers: [] });
  await wait(300);
  check(
    RA.starts().length === 0 && !live.newFar(),
    'connecting off: no entry for another computer, nothing chosen'
  );
  await main('show', state({ canStart: ['claude', 'codex', 'cursor', 'opencode', 'constructor'] }));
  await calm();
  check(
    RA.starts()
      .map(o => o.label)
      .join('|') === 'Claude Code on Sample laptop|OpenCode on Sample laptop',
    'only Claude Code and OpenCode are offered, whatever that computer says it can start: ' +
      RA.starts()
        .map(o => o.label)
        .join('|')
  );
  const pill = [...document.querySelectorAll('.tnai-pick-btn')].find(b =>
      /^Model/.test(b.getAttribute('aria-label') || '')
    ),
    menuEl = () => {
      const m = document.getElementById('tnaiPickMenu');
      return m && m.isConnected ? m : null;
    };
  check(
    !!pill && !pill.disabled,
    'the Model pill can be pressed while such an entry exists (also with no CLI signed in on this computer)'
  );
  pill?.click();
  if (!(await until(menuEl, 1500))) {
    pill?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    pill?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    pill?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }
  const menu = await until(menuEl, 2000),
    farM = () =>
      [...(menuEl()?.querySelectorAll('.tnai-pick-opt') || [])].filter(r =>
        / on Sample laptop$/.test(r.querySelector('b')?.textContent || '')
      );
  check(
    !!menu &&
      farM().length === 2 &&
      farM()[0].querySelector('b').textContent === 'Claude Code on Sample laptop' &&
      farM()[0].querySelector('small')?.textContent === 'asks first' &&
      [...menu.querySelectorAll('h4')].some(h => h.textContent === 'On another computer'),
    'the New agent menu has a group "On another computer" with one entry for each CLI: ' +
      farM()
        .map(r => r.textContent)
        .join(' | ')
  );
  await shot('remote-agents-new-menu');

  // The menu's own way, for every CLI row: a first click on another row
  // highlights it and shows its side, a click on the highlighted row picks it.
  farM()[0]?.click();
  await wait(300);
  check(
    !!menuEl() &&
      !live.newFar() &&
      farM()[0]?.classList.contains('active') &&
      /That computer picks its model, and the agent asks before it runs commands there\./.test(
        menuEl().querySelector('.tnai-pick-side')?.textContent || ''
      ),
    "a first click on the entry highlights it and says, where a CLI's models stand, that the other computer picks the model and the agent asks first; nothing is chosen yet"
  );
  farM()[0]?.click();
  await wait(400);
  check(
    live.newFar()?.key === KEY &&
      !live.newAgent() &&
      newB.getAttribute('aria-pressed') === 'true' &&
      !menuEl(),
    'a press on the entry sets New agent to that computer: the button is on and the menu is closed'
  );
  check(
    !!(await until(() => hintEl()?.textContent === LINE && !hintEl().hidden, 1500)),
    'the line under the box says where the agent starts, the computer first: ' +
      (hintEl()?.textContent || '')
  );

  // Under a thread the row is as wide as the conversation. A line that names another computer is
  // the last to leave it (11 fitRoute: the key hints give their room first), so it is drawn
  // whole here and one Send starts the agent. Only where even that is not enough does the first
  // Send say where the agent would start.
  await wait(300);
  const lineDrawn =
    hintEl().getClientRects().length > 0 && hintEl().clientWidth + 1 >= hintEl().scrollWidth;
  check(
    lineDrawn,
    'under a thread the line is drawn whole (' +
      Math.round(hintEl().getBoundingClientRect().width) +
      ' px in a row of ' +
      Math.round(hintEl().parentElement.getBoundingClientRect().width) +
      ' px)'
  );
  const sendFar = async () => {
    sendB2.click();
    await wait(400);
    if (!/Press Enter again to start it there\.$/.test(said.at(-1) || '')) return false;
    sendB2.click();
    return true;
  };
  await shot('remote-agents-new-chosen');
  said.length = 0;
  await typeC('/model opus');
  const askedFirst = await sendFar();
  check(
    askedFirst === !lineDrawn &&
      (lineDrawn ||
        said[0] ===
          'This starts a new Claude Code agent on Sample laptop with this prompt. Press Enter again to start it there.'),
    lineDrawn
      ? 'with the line drawn, Send goes at once'
      : 'with the line not drawn, the first Send only says where the agent would start, and nothing leaves'
  );
  await wait(600);
  check(
    box2.value === '/model opus' &&
      /^Not started: the first prompt for a new agent on Sample laptop starts with a letter or a number\./.test(
        said.at(-1) || ''
      ) &&
      live.newFar()?.key === KEY,
    'a command is not sent to another computer: it says so, the text stays, the choice stays: ' +
      JSON.stringify(said.slice(-1))
  );
  const A2 = window.TnaiAttachments;
  if (A2?.add) {
    A2.add(
      [new File(['a made-up note of this test'], 'sample-note.txt', { type: 'text/plain' })],
      'upload'
    );
    await until(() => A2.count() === 1, 3000);
    said.length = 0;
    await typeC('Read the note');
    sendB2.click();
    await wait(600);
    check(
      A2.count() === 1 &&
        box2.value === 'Read the note' &&
        /^Not started: attachments are not sent to another computer\./.test(said[0] || ''),
      'attachments are not sent: it says so before anything is sent'
    );
    A2.clear();
    await wait(100);
  }
  await typeC('Write the tests');
  await sendFar();
  await wait(1500);
  check(
    box2.value === 'Write the tests' &&
      /^Not started: /.test(said.at(-1) || '') &&
      live.newFar()?.key === KEY,
    'a start that did not leave this computer (nothing is paired here) keeps the text and the choice: ' +
      JSON.stringify(said.slice(-1))
  );

  // a start that leaves: the page's own start is stood in for, because nothing is paired here
  const own = RA.start;
  let starts = 0;
  RA.start = async () => {
    starts++;
    return {
      ok: true,
      words: 'Asked Sample laptop to start a new Claude Code agent with this prompt.',
    };
  };
  said.length = 0;
  sendB2.click();
  await wait(600);
  check(
    starts === 1 &&
      box2.value === '' &&
      !live.newFar() &&
      newB.getAttribute('aria-pressed') === 'false' &&
      hint() === '' &&
      /^Asked Sample laptop to start/.test(said.at(-1) || ''),
    'once the start left: the box is empty, the composer says the other computer was asked, and New agent is back to this computer'
  );
  sendB2.click();
  await typeC('Another prompt');
  await wait(300);
  check(
    starts === 1 && !live.newFar(),
    'the next Enter and the next prompt start no second agent there'
  );
  await typeC('');
  await calm();
  check(RA.chooseStart(KEY) === true && live.newFar()?.key === KEY, '(chosen again)');
  const foot = document.querySelector('footer.composer'),
    w0 = foot.style.width;
  foot.style.width = '300px';
  await frame();
  await wait(150);
  said.length = 0;
  await typeC('Deploy it');
  sendB2.click();
  await wait(400);
  check(
    hintEl().getClientRects().length === 0 &&
      starts === 1 &&
      box2.value === 'Deploy it' &&
      said[0] ===
        'This starts a new Claude Code agent on Sample laptop with this prompt. Press Enter again to start it there.',
    'with the line under the box not drawn the first Enter starts nothing and says where it would start: ' +
      JSON.stringify(said)
  );
  sendB2.click();
  await wait(400);
  check(starts === 2 && box2.value === '', 'the next Enter, with the same text, starts it');
  foot.style.width = w0;
  await frame();
  RA.start = own;

  // the entry is not pressable right after that computer's rows moved; the choice ends when the
  // computer no longer offers it; the button ends it
  await main(
    'show',
    state(
      { canStart: ['claude'] },
      agents.map(a => (a.id === 'p4' ? { ...a, mark: 'm4-start' } : a))
    )
  );
  await wait(60);
  {
    const quiet = window.TnaiDevices.quiet(),
      took = RA.chooseStart(KEY);
    check(
      quiet && took === false && !live.newFar(),
      "a press on the entry right after that computer's rows moved chooses nothing"
    );
  }
  await calm();
  RA.chooseStart(KEY);
  await wait(100);
  said.length = 0;
  await main('show', state({ canStart: [] }));
  check(
    !!(await until(() => !live.newFar(), 2000)) &&
      newB.getAttribute('aria-pressed') === 'false' &&
      said.some(m => /no longer starts agents for this computer/.test(m)),
    'that computer no longer offers it: the choice ends by itself, with a line: ' +
      JSON.stringify(said)
  );
  await main('show', state({ canStart: ['claude'] }));
  await calm();
  RA.chooseStart(KEY);
  await wait(100);
  newB.click();
  await wait(100);
  check(
    !live.newFar() && !live.newAgent() && newB.getAttribute('aria-pressed') === 'false',
    'the New agent button turns the choice off, as for any other'
  );
  await main('show', { ...real, on: false, computers: [] });
  await until(() => RA.starts().length === 0);
  check(RA.chooseStart(KEY) === false, 'with connecting off nothing can be chosen');
}
check(!sawOldPage, 'the layout never had the class agents-mode');
return { ok, log };
