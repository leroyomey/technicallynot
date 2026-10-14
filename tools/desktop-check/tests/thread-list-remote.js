// Technically Not tools · desktop-check/tests/thread-list-remote.js — two things of the thread
// list (src/scripts/119-thread-list.js), in the real app with a throwaway profile, with one
// PowerShell panel and no agent CLI.
// (1) A session that has not reported its folder stands in the project of its panel's workspace,
// not under "Other folders". There is no waiting for the right moment: the test hands the list
// the same session with no folder, and with a folder outside every project.
// (2) Other computers' agents: one group per computer after this computer's groups. Nothing is
// paired here: the states are made up by this test and pushed the way the main process pushes
// real ones (thread-list-remote.main.js). No group while nothing is known; only what was reported
// is shown; drawing and the arrow keys ask the other computer nothing; a press opens the agent in
// the thread's main area beside the list (138), never on the old Agents and history page. Measured
// and pictured at four window sizes in Dark and in Light, with the list open and hidden. Returns
// {ok, log}.
const log = [],
  wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
const shot = async name => {
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  console.log('TNAI_SHOT:' + name);
  await wait(600);
};

const threads = window.TnaiThreads,
  agents = window.TnaiAgents,
  threadList = window.TnaiThreadList,
  layout = document.querySelector('.layout');
const shown = el => !!el && el.getClientRects().length > 0;

// What the app says in passing is written down.
const said = [];
{
  const toast = window.toast;
  window.toast = message => {
    said.push(String(message));
    return typeof toast === 'function' ? toast(message) : undefined;
  };
}
const box = el => el.getBoundingClientRect();
const round = value => Math.round(value * 10) / 10;

// The list is drawn once per frame at most: ask for a draw and wait until it happened.
const painted = () =>
  new Promise(resolve => {
    const done = () => {
      window.removeEventListener('tnai:threads-painted', done);
      resolve(true);
    };
    window.addEventListener('tnai:threads-painted', done);
    threadList.refresh();
    setTimeout(done, 1500);
  });

try {
  await until(() => threads?.visible(), 8000);
  check(
    !!threadList?.refresh && !!window.TnaiRemoteAgents?.shown && !!window.TnaiThreadHistory?.remote,
    "the thread list, the other computers and their place in the thread's main area are loaded"
  );
  await agents.detect(true);
  const first = await window.TnaiTest.open('Terminal');
  check(
    !!first?.ok && !!(await until(() => agents.sessions().some(s => s.running), 20000)),
    'setup: one PowerShell panel running'
  );
  threads.open();
  await until(() => threads.visible(), 3000);
  const list = threads.slot('list');
  const listBox = list.querySelector('.tnt-threads');

  // The list's children in order: "H:" a heading's words, "R:" a row's panel or remote key.
  const order = () =>
    [...listBox.children].map(node =>
      node.className === 'tnt-proj'
        ? 'H:' + node.firstChild.textContent
        : 'R:' + (node.dataset.remote ? 'remote ' + node.dataset.remote : node.dataset.pane)
    );
  const headingBefore = key => {
    const all = order();
    const at = all.indexOf(key);
    for (let index = at - 1; at > 0 && index >= 0; index--)
      if (all[index].startsWith('H:')) return all[index].slice(2);
    return '';
  };

  // ---------- (1) a session without a folder ----------
  const paneId = first.paneId;
  await until(() => agents.sessions().find(s => s.paneId === paneId)?.cwd, 8000);
  const projects = window.TnaiProjects?.list?.() || [];
  const workspaceKey = window.TnaiTerminalWorkspaces?.projectOfPane?.(paneId) || '';
  const slashes = text =>
    String(text || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const home = projects.find(project => slashes(project.path) === slashes(workspaceKey));
  const homeName = home ? home.name || home.path.split(/[\\/]/).pop() : '';
  check(!!home, "setup: the panel's workspace belongs to an open project (" + homeName + ')');

  const realSessions = agents.sessions;
  const withFolder = folder => {
    agents.sessions = () =>
      realSessions
        .call(agents)
        .map(session => (session.paneId === paneId ? { ...session, cwd: folder } : session));
  };
  withFolder('');
  check(
    agents.sessions().find(s => s.paneId === paneId)?.cwd === '',
    'the list is handed the same session with no folder, as it is while its process starts'
  );
  await painted();
  const starting = threadList.thread(paneId);
  check(
    starting?.project?.name === homeName && starting?.projectFrom === 'workspace',
    "with no folder the thread is in its workspace's project: " +
      (starting?.project?.name || 'none') +
      ', from its ' +
      starting?.projectFrom
  );
  check(
    !order().includes('H:Other folders') && headingBefore('R:' + paneId) === homeName,
    'its row stands under "' +
      homeName +
      '", and no "Other folders" is drawn: ' +
      order().join(' | ')
  );
  check(
    /from its workspace/.test(listBox.querySelector('.tnt-th[data-pane="' + paneId + '"]').title),
    "the row's tip says the project is taken from its workspace"
  );
  withFolder('C:\\Windows\\Temp');
  await painted();
  check(
    threadList.thread(paneId)?.project === null && headingBefore('R:' + paneId) === 'Other folders',
    'a session that reported a folder outside every project is still under "Other folders": ' +
      order().join(' | ')
  );
  agents.sessions = realSessions;
  await painted();
  check(
    headingBefore('R:' + paneId) === homeName &&
      threadList.thread(paneId)?.projectFrom === 'folder',
    'with its real folder it is in its project, from its folder'
  );

  // ---------- what the old agent cards carried: on the row, or on its tip ----------
  // The four sources are stood in for (their own tests prove them): this proves what the list
  // does with what they say, and that it says nothing while they say nothing.
  const rowTitle = () => listBox.querySelector('.tnt-th[data-pane="' + paneId + '"]').title;
  const rowLine = () =>
    listBox.querySelector('.tnt-th[data-pane="' + paneId + '"] .tnt-th-line').textContent;
  check(
    !/↔|Team:|Browser:|Context:/.test(rowLine() + rowTitle()),
    'nothing known: the row and its tip name no messages, team, browser or context'
  );
  const kept = {
    talk: window.TnaiLiveTasks.talk,
    mates: window.TnaiAgentTeams?.mates,
    active: window.TnaiChromeBrowser?.active,
    turn: window.TnaiTurns?.get,
  };
  const only = (value, fallback) => id => (id === paneId ? value : fallback);
  const ownName = agents.sessions().find(session => session.paneId === paneId).name;
  window.TnaiLiveTasks.talk = only(
    { label: 'Moss', tip: 'Messaging with other agents: Moss' },
    null
  );

  // The one session here stands in for its own team mate: only its name is read.
  if (kept.mates) window.TnaiAgentTeams.mates = only([paneId], []);
  if (kept.active)
    window.TnaiChromeBrowser.active = only({ label: 'Browser', tip: '', waiting: false }, null);
  if (kept.turn)
    window.TnaiTurns.get = only(
      { startedAt: Date.now() - 60000, context: { tokens: 420000, window: 1000000 } },
      null
    );
  window.dispatchEvent(new CustomEvent('tnai:agent-talk'));
  await painted();
  check(
    /^Terminal · ↔ Moss · /.test(rowLine()) || rowLine() === 'Terminal · ↔ Moss',
    'messages with another agent: "↔ Moss" stands in the row after the tool: ' + rowLine()
  );
  check(
    /Messaging with other agents: Moss/.test(rowTitle()) &&
      (!kept.mates || rowTitle().includes('Team: with ' + ownName)) &&
      (!kept.active || /Browser: Claude in Chrome, in use now/.test(rowTitle())) &&
      (!kept.turn || /Context: 420k tokens, 42% of its window/.test(rowTitle())),
    'the tip names who it messages, its team, the browser and its context: ' +
      rowTitle().replace(/\n+/g, ' / ')
  );
  {
    const row = listBox.querySelector('.tnt-th[data-pane="' + paneId + '"]');
    const line = row.querySelector('small');
    check(
      box(line).right <= box(row).right + 0.5 && Math.abs(box(row).height - 52) <= 0.6,
      'the row keeps its two lines and its height with the mark in it (' +
        round(box(row).height) +
        ')'
    );
  }
  await main('size', 768, 680);
  await shot('thread-list-remote-marks-smallest');
  await main('size', 1440, 900);
  window.TnaiLiveTasks.talk = kept.talk;
  if (kept.mates) window.TnaiAgentTeams.mates = kept.mates;
  if (kept.active) window.TnaiChromeBrowser.active = kept.active;
  if (kept.turn) window.TnaiTurns.get = kept.turn;
  window.dispatchEvent(new CustomEvent('tnai:agent-talk'));
  await painted();
  check(!/↔/.test(rowLine()), 'the mark is gone when the messages are: ' + rowLine());

  // ---------- (2) other computers ----------
  const spied = await main('spy');
  check(spied.includes('remote:view'), 'what the window asks the remote service is written down');
  const real = (await window.tnaiNative.remote.state()).value;
  const nowMs = Date.now();
  const rowsOf = [
    {
      id: 'p1',
      name: 'Wren',
      cli: 'Claude Code',
      status: 'working',
      since: nowMs - 60000,
      task: 'Fix the login page so that a long task line has to be cut short',
      sure: true,
      can: true,
      mark: 'm1',
    },
    {
      id: 'p2',
      name: 'Moss <img src=x onerror=1>',
      cli: 'Codex',
      status: 'idle',
      since: 0,
      sure: true,
      can: true,
      mark: 'm2',
    },
    { id: 'p3', name: 'Fern', cli: 'OpenCode', status: 'needs', since: 0, sure: true, can: true },
    { id: 'p4', name: 'In another project', cli: 'Codex', status: 'idle', since: 0, sure: false },
    { id: 'p5', name: 'Odd', cli: 'constructor', status: 'hasOwnProperty', since: 0, sure: true },
  ];
  const computer = (id, name, agentRows) => ({
    id,
    name,
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
    agents: agentRows,
  });
  const state = computers => ({ ...real, on: true, computers, others: [], watching: [] });
  const push = async value => {
    await main('show', value);
    await wait(250);
    await painted();
  };
  const remoteRows = () => [...listBox.querySelectorAll('.tnt-th[data-remote]')];
  const remoteHeads = () => order().filter(entry => /^H:On /.test(entry));

  for (const [label, value] of [
    ['connecting off', { ...real, on: false, computers: [] }],
    ['nothing paired', state([])],
    ['a paired computer with no agents', state([computer('sample-1', 'Sample laptop', [])])],
    [
      'a paired computer whose agents are not known to be in this project',
      state([computer('sample-1', 'Sample laptop', [rowsOf[3]])]),
    ],
    [
      'a computer that is not connected',
      state([
        { ...computer('sample-1', 'Sample laptop', rowsOf), state: 'offline', session: false },
      ]),
    ],
    [
      'connecting off with a computer still in the state',
      { ...state([computer('sample-1', 'Sample laptop', rowsOf)]), on: false },
    ],
  ]) {
    await push(value);
    check(
      !remoteHeads().length && !remoteRows().length,
      label + ': no group and no row of another computer (' + order().join(' | ') + ')'
    );
  }

  await push(state([computer('sample-1', 'Sample laptop', rowsOf)]));
  const all = order();
  const headAt = all.indexOf('H:On Sample laptop');
  check(
    headAt > all.indexOf('R:' + paneId) &&
      all.slice(headAt + 1).every(e => e.startsWith('R:remote')),
    'one group "On Sample laptop" after this computer\'s groups: ' + all.join(' | ')
  );
  const head = [...listBox.querySelectorAll('.tnt-proj')].find(node =>
    /^On Sample laptop/.test(node.textContent)
  );
  check(
    head.lastChild.textContent === '4 agents' && /what that computer reports/.test(head.title),
    'it counts its agents of this project (' +
      head.lastChild.textContent +
      ') and says whose word it is'
  );
  const words = remoteRows().map(row => row.textContent.replace(/\s+/g, ' ').trim());
  check(
    remoteRows().length === 4 && !words.some(text => /In another project/.test(text)),
    'four rows; the agent not known to be in this project is not listed'
  );
  const rowNamed = name =>
    remoteRows().find(row => row.querySelector('b').textContent.startsWith(name));
  check(
    rowNamed('Wren').dataset.tone === 'work' &&
      /Claude Code · Fix the login page/.test(rowNamed('Wren').textContent) &&
      /^\d\d:\d\d$/.test(rowNamed('Wren').querySelector('time').textContent),
    'a working agent: its tool, its task and since when, in the working color: ' + words[0]
  );
  check(
    rowNamed('Fern').dataset.tone === 'needs' &&
      /OpenCode · Needs you/.test(rowNamed('Fern').textContent),
    'an agent that waits for the user says "Needs you" in that color: ' + words[2]
  );
  check(
    rowNamed('Moss').dataset.tone === 'idle' && /Codex · Idle/.test(rowNamed('Moss').textContent),
    'an idle agent says so: ' + words[1]
  );
  check(
    rowNamed('Moss').querySelectorAll('img').length === 2 &&
      rowNamed('Moss').querySelector('b').children.length === 0 &&
      rowNamed('Moss').querySelector('b').textContent === 'Moss <img src=x onerror=1>',
    "a name is drawn as text: markup in it is shown as its characters (only the character's two pictures are in the row)"
  );
  check(
    rowNamed('Odd').dataset.tone === 'idle' &&
      /desktop-body/.test(rowNamed('Odd').querySelector('.tnt-face-body').src) &&
      /Idle/.test(rowNamed('Odd').textContent),
    'an unknown state is read as idle and an unknown tool gets the plain character: ' + words[3]
  );
  check(
    remoteRows().every(row => row.querySelector('.tnt-th-inf').hidden) &&
      remoteRows().every(row => /reports it\. It runs there/.test(row.title)),
    'no row says "inferred" (nothing is guessed here), and each tip says whose report it is'
  );

  // Two computers of one name are told apart.
  await push(
    state([
      computer('sample-aaaa', 'Sample laptop', rowsOf.slice(0, 1)),
      computer('sample-bbbb', 'Sample laptop', rowsOf.slice(1, 2)),
    ])
  );
  check(
    remoteHeads().length === 2 && new Set(remoteHeads()).size === 2,
    'two computers of one name are two groups with different words: ' + remoteHeads().join(' | ')
  );
  await push(state([computer('sample-1', 'Sample laptop', rowsOf)]));

  // ---------- the look: four sizes, Dark and Light, the list open and hidden ----------
  const ownRow = () => listBox.querySelector('.tnt-th[data-pane="' + paneId + '"]');
  const measure = label => {
    const area = box(list);
    const rows = remoteRows();
    const inside = rows.every(
      row => box(row).left >= area.left - 0.5 && box(row).right <= area.right + 0.5
    );
    const heights = rows.map(row => round(box(row).height));
    const gaps = rows.slice(1).map((row, index) => round(box(row).top - box(rows[index]).bottom));
    const groupHead = [...listBox.querySelectorAll('.tnt-proj')].find(node =>
      /^On /.test(node.textContent)
    );
    check(
      inside && listBox.scrollWidth <= listBox.clientWidth + 1,
      label + ': every row is inside the island and nothing scrolls sideways'
    );
    check(
      heights.every(height => Math.abs(height - round(box(ownRow()).height)) <= 0.6) &&
        gaps.every(gap => Math.abs(gap) <= 0.6),
      label +
        ": the rows are as tall as this computer's own (" +
        heights.join(', ') +
        ' against ' +
        round(box(ownRow()).height) +
        ') and follow each other with no gap (' +
        gaps.join(', ') +
        ')'
    );
    check(
      Math.abs(box(groupHead).height - 28) <= 0.6 &&
        Math.abs(box(groupHead).left - box(listBox.querySelector('.tnt-proj')).left) <= 0.6,
      label + ': its heading is a heading of 28 on the same inset as the others'
    );
    check(
      box(list).bottom <= window.innerHeight + 0.5 && box(list).top >= 0,
      label +
        ': the island ends inside the window (' +
        round(box(list).bottom) +
        ' of ' +
        window.innerHeight +
        ')'
    );
  };
  const SIZES = [
    [1440, 900, '1440'],
    [1280, 800, '1280'],
    [768, 680, 'smallest'],
    [1280, 680, 'low'],
  ];
  for (const look of ['dark', 'light']) {
    window.TnaiTheme.set(look);
    for (const [width, height, name] of SIZES) {
      await main('size', width, height);
      await painted();
      measure(name + ' ' + look);
      await shot('thread-list-remote-' + name + '-' + look);
      window.TnaiThreadCollapse.setList(false);
      await wait(350);
      check(
        !shown(list.querySelector('.tnt-th')),
        name + ' ' + look + ': the list hidden, no row left on screen'
      );
      if (name === '1280' || name === 'smallest')
        await shot('thread-list-remote-' + name + '-' + look + '-hidden');
      window.TnaiThreadCollapse.setList(true);
      await wait(350);
    }
  }
  window.TnaiTheme.set('dark');
  await main('size', 1440, 900);
  await painted();

  // ---------- drawing and the keys ask nothing; a press opens it ----------
  const asked = async () => (await main('calls')).filter(channel => channel === 'remote:view');
  const calm = () => until(() => !window.TnaiDevices?.quiet?.(), 3000);
  await calm();
  ownRow().focus();
  for (let step = 0; step < 4; step++) {
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    );
    await wait(60);
  }
  check(
    !!document.activeElement.dataset.remote &&
      document.activeElement.closest('.tnt-threads') === listBox,
    "the arrow keys move from this computer's rows onto another computer's"
  );
  await wait(1300);
  check(
    (await asked()).length === 0 && !window.TnaiRemoteAgents.selected() && threads.visible(),
    'drawing the group and moving over it with the keys asked the other computer nothing and selected nothing'
  );

  // A press right after that computer's rows moved is not taken: the row may be another agent's.
  await main(
    'show',
    state([computer('sample-1', 'Sample laptop', [rowsOf[1], rowsOf[0], rowsOf[2], rowsOf[4]])])
  );
  if (await until(() => window.TnaiDevices?.quiet?.(), 1500)) {
    await painted();
    said.length = 0;
    rowNamed('Wren').click();
    await wait(150);
    check(
      threads.visible() &&
        !window.TnaiRemoteAgents.selected() &&
        !window.TnaiThreadHistory.remote() &&
        said.some(text => /Press the agent again/.test(text)),
      'a press in the moment after the rows moved opens nothing and says to press again: ' +
        JSON.stringify(said)
    );
  } else
    log.push('note the quiet time after a move was not seen, so the refused press was NOT tried');
  await calm();
  await painted();

  const wren = rowNamed('Wren');
  const wrenKey = wren.dataset.remote;
  wren.click();
  const mainSlot = threads.slot('main');
  check(
    !!(await until(() => shown(mainSlot.querySelector('.tnh-view .ap-agent.ap-far')), 3000)) &&
      threads.visible() &&
      !layout.classList.contains('agents-mode'),
    "a press on Wren opens it in the thread's main area, and the Threads page stays the page"
  );
  await painted();
  const far = mainSlot.querySelector('.tnh-view .ap-agent.ap-far');
  check(
    window.TnaiRemoteAgents.selected() === wrenKey &&
      shown(far) &&
      far.querySelector('h2').textContent === 'Wren',
    'with Wren selected there, and its detail drawn: ' +
      (far?.querySelector('.ap-id small')?.textContent || '')
  );
  check(
    shown(list) && shown(rowNamed('Wren')) && box(mainSlot).left >= box(list).right - 0.5,
    'the thread list stays beside it (list ends ' +
      round(box(list).right) +
      ', the main area starts ' +
      round(box(mainSlot).left) +
      ')'
  );
  check(
    rowNamed('Wren').getAttribute('aria-selected') === 'true' &&
      [...listBox.querySelectorAll('.tnt-th[aria-selected="true"]')].length === 1,
    'Wren is the one row marked open in the list'
  );
  await wait(1300);
  check(
    (await asked()).length === 1,
    'the live view is asked for once, after the row stayed selected for a second (' +
      (await asked()).length +
      ')'
  );
  await shot('thread-list-remote-page-1440-dark');
  window.TnaiTheme.set('light');
  await main('size', 1280, 800);
  await shot('thread-list-remote-page-1280-light');
  await main('size', 768, 680);
  await shot('thread-list-remote-page-smallest-light');
  window.TnaiTheme.set('dark');
  await main('size', 1440, 900);

  // A press on a thread of this computer brings that thread back into the main area; nothing
  // stays marked for Wren.
  ownRow().click();
  check(
    !!(await until(
      () =>
        window.TnaiThreadView.shown() === paneId &&
        shown(mainSlot.querySelector(':scope > .tnt-view')) &&
        !window.TnaiRemoteAgents.selected(),
      3000
    )) &&
      !shown(mainSlot.querySelector('.tnh-view')) &&
      threads.visible(),
    'a press on a thread of this computer shows that thread again, and Wren is let go'
  );
  check(
    !!(await until(
      () =>
        ownRow().getAttribute('aria-selected') === 'true' &&
        rowNamed('Wren').getAttribute('aria-selected') === 'false',
      3000
    )),
    'that thread is marked open, and Wren no longer is'
  );
  check(
    (await main('calls')).filter(channel => channel === 'remote:prompt' || channel === 'remote:act')
      .length === 0,
    'nothing was sent to the other computer but the one view: no prompt, no action'
  );

  // The computer goes: its group goes with it, with no empty heading left.
  await push({ ...real, on: false, computers: [] });
  check(
    !remoteHeads().length && !remoteRows().length && order().includes('R:' + paneId),
    "connecting off: the group is gone and this computer's threads stay (" +
      order().join(' | ') +
      ')'
  );

  agents.sessions().forEach(session => agents.stop(session.paneId));
  await until(() => !agents.sessions().some(session => session.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'the test threw: ' + (error?.stack || error));
}
return { ok, log };
