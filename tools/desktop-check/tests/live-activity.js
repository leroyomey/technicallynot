/*
 * Technically Not tools · desktop-check/tests/live-activity.js — live activity
 * (53-live-activity.js) read where the thread layout shows it: a real PowerShell thread starts;
 * Claude Code-shaped hook events go through the real agent-hooks.js (live-activity.main.js), turns
 * and a permission prompt are pushed on their real channels. Each event is recorded newest first
 * with its time and agent name (TnaiLiveFeed.items); the agent's row in the thread list says what
 * it does now (the current tool, waiting for your OK) and carries the tone of its status; the
 * panel limit holds for the groups of panels underneath (a full group continues in a new one).
 * No prompt is sent.
 * Returns {ok, log}.
 */
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
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
    setTimeout(() => reject(new Error('main call ' + cmd + ' timed out')), 5000);
  });
const G = window.TnaiAgents,
  F = window.TnaiLiveFeed;

// A page is opened the way the three-dots menu opens it (124 calls TnaiRoute).
const go = async view => {
  window.TnaiRoute(view);
  await wait(300);
};
const band = () => document.querySelector('#agentsPage .tnai-feed'),
  // both removed 2026-10-07: checked to be gone
  pulse = () => document.querySelector('.tnai-pulse');

// The thread list is on every page; the Threads page is where the user reads it.
const threads = async () => {
  window.TnaiThreads.open();
  await wait(300);
};

// newest first; no page lists them since 2026-10-07
const rows = () => F.items();
const hasRow = re => rows().find(i => re.test(i.line));
try {
  check(
    !!F && !band() && !pulse(),
    'TnaiLiveFeed present; no Live activity band and no counts row on the Agents page'
  );
  check(
    !document.querySelector(
      '#agentsPage :is(.tnai-feed-toggle,.tnai-feed-list,.tnai-feed-latest,.tnai-feed-hide,.tnai-feed-restore)'
    ) && !F.setOpen,
    'no feed toggle, list, newest-event line, hide or restore button'
  );

  // 1. A real PowerShell thread: its start is an event.
  const shell = await window.TnaiTest.startThread({ tool: 'Terminal' });
  const paneId = shell.paneId;
  const s = shell.session;
  check(!!s, 'PowerShell thread running');

  // 1b. The status follows the task's own end (10 `endedQuiet`): a panel still printing stops
  // reading Working when its CLI reports the task ended, without waiting for 2.5 s of quiet; output
  // after the CLI's last redraw counts as work again.
  const stat = () =>
    document.querySelector('.terminal-pane[data-pane-id="' + paneId + '"]')?.dataset.status;
  window.tnaiNative.pty.write(paneId, '1..48 | % { $_; Start-Sleep -Milliseconds 250 }\r');
  const run = {
    paneId,
    agent: 'Claude Code',
    source: 'claude-transcript',
    startedAt: Date.now(),
    endedAt: 0,
    endedBy: '',
    tokens: { input: 0, cacheWrite: 0, output: 0 },
    queued: [],
  };
  await main('turn', run);
  check(
    !!(await until(() => stat() === 'working', 4000)),
    'printing panel with an open task reads working (' + stat() + ')'
  );
  const endAt = performance.now();
  await main('turn', { ...run, endedAt: Date.now(), endedBy: 'stop' });
  const left = await until(
      () =>
        stat() !== 'working' && G.sessions().find(x => x.paneId === paneId)?.status !== 'working',
      2400
    ),
    leftMs = Math.round(performance.now() - endAt);
  check(
    !!left && leftMs < 1000,
    'task ended while printing: status leaves working in ' +
      leftMs +
      ' ms (' +
      stat() +
      '), not after 2.5 s of quiet'
  );
  check(
    !!(await until(() => stat() === 'working', 5000)),
    'output after the last redraw counts as work again (' + stat() + ')'
  );
  await main('turn', { ...run, startedAt: Date.now(), endedAt: 0 });
  await wait(300);
  check(
    stat() === 'working',
    'a new task start clears the ended mark: still working (' + stat() + ')'
  );
  await main('turn', { ...run, endedAt: Date.now(), endedBy: 'stop' });
  window.tnaiNative.pty.write(paneId, '\x03');
  await until(() => stat() !== 'working', 5000);

  // 1c. Working in background: the thread row has no dot of its own color for it, it carries
  // the working tone.
  await main('event', paneId, {
    kind: 'bg-start',
    taskId: 'bgc1',
    toolUseId: 'bgc1',
    tool: 'Bash',
    detail: 'npm run watch',
  });
  check(
    !!(await until(() => stat() === 'background', 6000)),
    'a quiet panel with a background task reads background (' + stat() + ')'
  );

  await threads();
  const row = () => document.querySelector('.tnt-th[data-pane="' + paneId + '"]:not(.tnt-sub)'),
    nowText = () => row()?.querySelector('.tnt-th-now')?.textContent || '';
  check(
    !!(await until(() => row()?.offsetParent && row().dataset.tone === 'work')),
    'the thread row of a panel working in background has the working tone (' +
      row()?.dataset.tone +
      ', "' +
      nowText() +
      '")'
  );
  await main('event', paneId, { kind: 'bg-end', taskId: 'bgc1' });
  check(
    !!(await until(() => stat() !== 'background', 4000)),
    'background task ended: status leaves background (' + stat() + ')'
  );
  check(!!(await until(() => hasRow(/started · Terminal/))), 'thread start shows in the feed');

  // 2. Hook events (the Claude Code shapes agent-hooks.js emits), through the real main-side
  // emitter.
  const root = String((await main('root')) || '').replace(/\\/g, '/');
  const t0 = performance.now();
  await main('event', paneId, { kind: 'prompt', text: '[TN.ai] Fix the login bug' });
  await main('event', paneId, { kind: 'tool', tool: 'Bash', detail: 'npm test' });
  const ranRow = await until(() => hasRow(/runs: npm test/));
  check(
    !!ranRow,
    'Bash tool call in the feed ' + Math.round(performance.now() - t0) + ' ms after the hook'
  );
  check(!!hasRow(/got a task: Fix the login bug/), 'new task in the feed, [TN.ai] tag stripped');
  check(
    ranRow?.at > 0 && String(ranRow?.line || '').startsWith(s.name),
    'event: time and agent name (' + s.name + ')'
  );
  check(rows()[0]?.id === ranRow?.id, 'newest first');
  check(
    !!(await until(() => /Running npm test/.test(nowText()))),
    'the thread row says what the agent does now, from the hook ("' + nowText() + '")'
  );
  await main('event', paneId, { kind: 'tool', tool: 'Edit', detail: root + '/src/app.js' });
  check(
    !!(await until(() => hasRow(/edits src\/app\.js/))),
    'edit shows with a project-relative path'
  );
  await main('event', paneId, {
    kind: 'spawn',
    toolUseId: 'ol1',
    type: 'general-purpose',
    description: 'Check the docs',
  });
  check(
    !!(await until(() => hasRow(/starts a sub-agent: Check the docs/))),
    'sub-agent start in the feed'
  );

  // 2b. Waiting on agents (10 status, purple): an open foreground sub-agent (hooks) blocks the lead
  // even while its pane prints; wins over Waiting for input.
  const paneStatus = () =>
    document.querySelector('.terminal-pane[data-pane-id="' + paneId + '"]')?.dataset.status;
  check(
    !!(await until(
      () =>
        paneStatus() === 'waiting-agents' &&
        G.sessions().find(x => x.paneId === paneId)?.status === 'waiting-agents'
    )),
    'open foreground sub-agent → status waiting-agents (' + paneStatus() + ')'
  );
  check(
    !!(await until(() => row()?.dataset.tone === 'work')),
    'the thread row of a lead waiting on its sub-agents keeps the working tone (' +
      row()?.dataset.tone +
      ', "' +
      nowText() +
      '")'
  );
  await main('event', paneId, {
    kind: 'spawn',
    toolUseId: 'ol2',
    type: 'Explore',
    description: 'Scan tests',
  });
  await main('event', paneId, { kind: 'sub-start', agentId: 'ag2', agentType: 'Explore' });
  check(
    !!(await until(() => window.TnaiTeam.open(paneId).fg === 2)),
    'two open sub-agents counted'
  );
  await main('event', paneId, { kind: 'sub-stop', agentId: 'ag2', text: 'done' });
  check(
    !!(await until(
      () => window.TnaiTeam.open(paneId).fg === 1 && paneStatus() === 'waiting-agents'
    )),
    'one finished, one still open: still waiting on agents'
  );

  // 2c. A launch the permission / auto-mode check refused never runs: its card goes
  // (PostToolUseFailure → 'spawn-refused'); one still starting at the lead's Stop was never
  // launched either. Accepted background and started sub-agents stay. Own pane id, so the steps
  // above are untouched.
  const gp = 'ghost-check-pane',
    subsOf = () => window.TnaiTeam.get(gp)?.subs || [],
    has = k => subsOf().some(x => x.key === k);
  await main('event', gp, { kind: 'prompt', text: 'lead task' });
  await main('event', gp, {
    kind: 'spawn',
    toolUseId: 'gr1',
    type: 'general-purpose',
    description: 'Refused one',
    background: true,
  });
  check(!!(await until(() => has('gr1'))), 'refused launch: card shows while the call is pending');
  await main('event', gp, { kind: 'spawn-refused', toolUseId: 'gr1' });
  check(!!(await until(() => !has('gr1'))), 'refused launch: card removed on spawn-refused');
  await main('event', gp, {
    kind: 'spawn',
    toolUseId: 'gr2',
    type: 'general-purpose',
    description: 'Never answered',
    background: true,
  });
  await main('event', gp, {
    kind: 'spawn',
    toolUseId: 'gr3',
    type: 'general-purpose',
    description: 'Accepted background',
    background: true,
  });
  await main('event', gp, {
    kind: 'spawn-result',
    toolUseId: 'gr3',
    result: { agentId: 'bg3', async: true, status: 'async_launched' },
  });
  await main('event', gp, {
    kind: 'spawn',
    toolUseId: 'gr4',
    type: 'Explore',
    description: 'Started',
  });
  await main('event', gp, { kind: 'sub-start', agentId: 'ag4', agentType: 'Explore' });
  await main('event', gp, { kind: 'stop' });
  check(
    !!(await until(() => !has('gr2') && has('gr3') && has('gr4'))),
    'lead Stop: never-answered launch removed; accepted background + started sub-agents kept (' +
      subsOf()
        .map(x => x.key + ':' + x.status)
        .join(', ') +
      ')'
  );

  // The Agents page's Close on a stuck "Starting" sub-agent (TnaiTeam.dismiss): removes only a
  // starting card, never a running one.
  await main('event', gp, {
    kind: 'spawn',
    toolUseId: 'gr5',
    type: 'general-purpose',
    description: 'Stuck starting',
  });
  check(!!(await until(() => has('gr5'))), 'stuck launch: card shows');
  check(
    window.TnaiTeam.dismiss(gp, 'gr3') === false && has('gr3'),
    'Close refuses a running sub-agent'
  );
  check(
    window.TnaiTeam.dismiss(gp, 'gr5') === true && !has('gr5'),
    'Close removes a stuck "Starting" sub-agent'
  );

  // 3. A permission prompt: on the agent's thread row, in the feed; answered → gone.
  await main('permission', {
    id: 'ol-perm-1',
    paneId,
    tool: 'Bash',
    detail: 'rm -rf build',
    at: Date.now(),
  });

  // The needs tone comes from the main process's own notice, which this test does not send: the
  // words are what is checked here.
  const asked = await until(() => /Waiting for your OK/.test(nowText()));
  check(
    !!asked,
    'the thread row says the agent waits for your OK (tone ' +
      row()?.dataset.tone +
      ', "' +
      nowText() +
      '")'
  );
  check(
    !!(await until(() => hasRow(/needs your OK for Bash: rm -rf build/))),
    'permission prompt in the feed'
  );
  console.log('TNAI_SHOT:live-activity-needs-you');
  await wait(600);
  await main('permission', { id: 'ol-perm-1', done: true });
  check(
    !!(await until(() => !/Waiting for your OK/.test(nowText()))),
    'an answered prompt leaves the thread row (' + row()?.dataset.tone + ', "' + nowText() + '")'
  );

  // 4. A turn with tokens and a queued prompt, then finished.
  const started = Date.now() - 42000;
  const turn = {
    paneId,
    agent: 'Claude Code',
    source: 'claude-transcript',
    startedAt: started,
    endedAt: 0,
    endedBy: '',
    tokens: { input: 1000, cacheWrite: 500, output: 2000 },
    queued: [{ text: 'also update the docs', at: Date.now() }],
  };
  await main('turn', turn);
  check(
    !!(await until(() => hasRow(/has a prompt queued: also update the docs \(1 waiting\)/))),
    'queued prompt recorded as an event'
  );
  await main('turn', { ...turn, queued: [], endedAt: Date.now(), endedBy: 'stop' });
  check(
    !!(await until(() => hasRow(/finished · took 4\ds · 3\.5k tokens/))),
    'finished with duration and tokens'
  );
  check(F.items().length <= 30 && F.items().every(i => i.at), 'feed items capped and timestamped');

  // 4b. Esc interrupt: Claude Code sends no Stop hook; desktop/agent-turns.js ends the turn
  // (endedBy 'interrupted'). Card, busy and question clear.
  await main('event', paneId, { kind: 'prompt', text: '[TN.ai] Refactor the router' });
  await main('event', paneId, { kind: 'tool', tool: 'Edit', detail: root + '/src/router.js' });
  await main('event', paneId, {
    kind: 'ask',
    questions: [{ question: 'Keep the old routes?', options: ['Yes', 'No'] }],
  });
  check(
    !!(await until(() => window.TnaiTeam?.busy?.(paneId) && F.asking(paneId))),
    'mid-turn: busy and waiting for an answer'
  );
  await wait(20);
  await main('turn', {
    paneId,
    agent: 'Claude Code',
    source: 'claude-transcript',
    startedAt: Date.now() - 5000,
    endedAt: Date.now(),
    endedBy: 'interrupted',
    tokens: null,
    queued: [],
  });
  check(
    !!(await until(
      () =>
        !window.TnaiTeam.busy(paneId) &&
        !F.asking(paneId) &&
        !F.doing(paneId) &&
        !/Editing src\/router|Your answer|Waiting for you|Keep the old routes/.test(nowText())
    )),
    'interrupted turn: not busy, no current tool or question on the thread row; the latest-file line may stay ("' +
      nowText() +
      '")'
  );

  G.stop(paneId);
  check(!!(await until(() => hasRow(/exited|stopped/))), 'pane exit shows in the feed');
  const oldSub = () => window.TnaiTeam.get(paneId)?.subs?.find(x => x.key === 'ol1');
  check(
    !!(await until(() => oldSub()?.status === 'failed' && oldSub()?.stopped)),
    'sub-agent still starting when its lead exited ends as stopped (' +
      JSON.stringify(oldSub()?.status) +
      ')'
  );

  // 6. Panel limit: one constant (04 TnaiPaneLimit). Fill the group, then nothing may go past it.
  const L = window.TnaiPaneLimit;
  check(
    !!L && L.max > 0 && L.message.includes(String(L.max)),
    'one pane limit: ' + L?.max + ' · "' + L?.message + '"'
  );

  // The threads' panels stand in groups underneath. The active group is filled with empty panels
  // through the app's own way of adding one (what a new thread, a revived one and a helper use).
  for (let i = 0; i < 20 && L.count() < L.max; i++) {
    window.TnaiNewTerminalPane({ quiet: true });
    await wait(60);
  }
  const W = window.TnaiTerminalWorkspaces,
    firstWs = W.activeId(),
    wsBefore = W.list().length;
  check(
    L.count() === L.max && !L.full(),
    'active group filled to the limit (' +
      L.count() +
      '); full() is false while a group can be added'
  );
  window.TnaiNewTerminalPane({ quiet: true });
  await wait(150);
  check(
    W.list().length === wsBefore + 1 &&
      W.activeId() !== firstWs &&
      L.count() === 1 &&
      L.count(firstWs) === L.max,
    'a panel past the limit opens in a new group (' +
      L.count() +
      ' there, ' +
      L.count(firstWs) +
      ' in the full one)'
  );

  // With adding groups switched off (a future plan gate; the app reads it from its own add
  // button, which no user sees), a full group refuses as before.
  document.querySelectorAll('.terminal-workspace-add').forEach(b => {
    b.disabled = true;
  });
  W.activate(firstWs);
  await wait(100);
  check(W.activeId() === firstWs && L.full(), 'back on the full group, adding off: full() is true');
  check(
    window.TnaiNewTerminalPane({ quiet: true }) === null,
    'the way a new thread, a revived one and a helper get their panel refuses a full group when no group can be added'
  );

  // The filler panels are empty, and TnaiAgents.open fills an empty one first (04 takeEmpty):
  // hold them all so the limit is what answers. It answers before it changes the page.
  document.querySelectorAll('.terminal-pane').forEach(p => {
    p.dataset.reservedAt = Date.now();
  });
  const tOpen = performance.now(),
    opened = await Promise.race([
      window.TnaiAgents.open('Terminal'),
      wait(3000).then(() => 'hung'),
    ]);
  check(
    opened?.ok === false && opened.error === L.message && L.count() === L.max,
    'TnaiAgents.open (custom agents, CLI updates) answers with the limit message in ' +
      Math.round(performance.now() - tOpen) +
      ' ms instead of hanging'
  );
} catch (error) {
  check(false, 'threw: ' + (error?.stack || error));
}
return { ok, log };
