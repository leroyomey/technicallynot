/*
 * Technically Not tools · desktop-check/tests/opencode-turn.js — An OpenCode task played through
 * the app's screens with what the main process sends for one: an open agent:turn with source
 * opencode-db (desktop/agent-turns.js readOpenCode), tool steps in the shape agent-hooks.js onStep
 * emits (kind tool, no prompt or stop event), a checklist on the turn, and the turn ending by stop,
 * interrupted and error. Checks what the thread's row in the thread list says it does now
 * (Thinking, then the tool), no inferred file row once steps arrive, one chime per finished turn
 * and none for a stopped one, skills in use cleared, the context chip percent, the checklist count
 * and the sub-agents as helpers and as their rows in the thread list. No real CLI and no prompt:
 * a PowerShell panel stands in for the OpenCode session (session list stubbed). Returns {ok, log}.
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
  F = window.TnaiLiveFeed,
  N = window.tnaiNative,
  CLI = 'OpenCode';
const go = async view => {
  view === 'overview' ? window.TnaiThreads.open() : window.TnaiRoute(view);
  await wait(300);
};
const realSessions = G.sessions,
  realPlay = window.TnaiNotify?.play;
try {
  await wait(300);
  let chimes = 0,
    status = 'waiting';
  const opened = await window.TnaiTest.open('Terminal');
  check(!!opened?.ok, 'stand-in panel opened');
  const paneId = opened.paneId;
  await until(() => realSessions().find(x => x.paneId === paneId && x.running), 15000);
  G.sessions = () =>
    realSessions().map(x => (x.paneId === paneId ? { ...x, agent: CLI, status } : x));
  if (window.TnaiNotify)
    window.TnaiNotify.play = () => {
      chimes++;
    };
  const root = String((await main('root')) || '').replace(/\\/g, '/');

  // What the agent does now is read on its own row in the thread list (the old Overview card and
  // its "Now ·" line are deleted).
  const nowLine = () =>
    document.querySelector(
      '.tnt-th[data-pane="' + CSS.escape(paneId) + '"]:not(.tnt-sub) .tnt-th-now'
    )?.textContent || '';

  // A sub-agent's own row under its lead in the thread list (its key is the lead's id, a NUL, and
  // the call's id).
  const subRow = key =>
    [...document.querySelectorAll('.tnt-th.tnt-sub')].find(
      row => row.dataset.key === paneId + String.fromCharCode(0) + key
    );
  const mine = () => F.items().filter(i => i.paneId === paneId);
  const type = text => N.pty.submit(paneId, text, { paste: false }).catch(() => {});
  const turn = async (t, extra = {}) => {
    await main('turn', {
      paneId,
      agent: CLI,
      source: 'opencode-db',
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task: 'Fix the login bug',
      result: '',
      queued: [],
      ...t,
      ...extra,
    });
    await until(() => {
      const k = window.TnaiTurns.get(paneId);
      return (
        k && k.startedAt === t.startedAt && (k.endedAt || 0) === (extra.endedAt || t.endedAt || 0)
      );
    }, 3000);
  };
  const step = (tool, detail) => main('event', paneId, { kind: 'tool', tool, detail, label: '' });
  await go('overview');

  // 1. Before any step: a file named in its output is an inferred row (13 reads the output), as for
  // every CLI without steps.
  await type("echo 'Edited src/app.js'");
  const firstAct = await until(() => window.TnaiFileActivity.now(paneId), 8000);
  const inferredBefore = await until(() => mine().filter(i => i.inferred).length, 4000);
  check(
    !!firstAct && inferredBefore >= 1,
    'no steps yet: a file in its output gives an inferred feed row (' +
      JSON.stringify({ act: firstAct?.path, inferred: inferredBefore }) +
      ')'
  );

  // 2. The turn opens (its own record): Thinking on its row, with no prompt event.
  const t1 = { startedAt: Date.now() };
  status = 'working';
  await turn(t1, {
    context: { tokens: 100000, window: 200000, at: Date.now() },
    steps: { index: 2, total: 3, done: 1, text: 'Write the fix' },
  });
  check(
    !window.TnaiTeam.busy(paneId),
    'no prompt event was sent: the hook-based busy flag stays off'
  );
  check(
    F.doing(paneId)?.text === 'Thinking' && /OpenCode/.test(F.doing(paneId)?.tip || ''),
    'open turn: Thinking, tooltip names OpenCode (' + JSON.stringify(F.doing(paneId)) + ')'
  );
  check(
    !!(await until(() => /Thinking/.test(nowLine()), 4000)),
    'its row in the thread list: Thinking (' + nowLine() + ')'
  );

  // 3. Steps: the tool on its row; a file step; a skill step.
  await step('Bash', 'npm test');
  check(
    !!(await until(() => /Running npm test/.test(nowLine()), 4000)),
    'its row in the thread list: the step’s tool (' + nowLine() + ')'
  );
  check(
    /step events/.test(F.doing(paneId)?.tip || ''),
    'tool tooltip says where it came from (' + (F.doing(paneId)?.tip || '') + ')'
  );
  await step('Edit', root + '/src/app.js');
  check(
    !!(await until(() => mine().some(i => /edits src\/app\.js/.test(i.text) && !i.inferred), 4000)),
    'file step in the feed, not marked inferred'
  );
  await step('Skill', 'tnai-demo-skill');
  check(
    !!(await until(
      () => window.TnaiFileActivity.skills(paneId).some(k => k.name === 'tnai-demo-skill'),
      3000
    )),
    'skill step: skill shown in use'
  );

  // 4. No second, inferred row for a file once steps arrive.
  const inferredMid = mine().filter(i => i.inferred).length,
    actAt = window.TnaiFileActivity.now(paneId)?.at;
  await wait(1100);
  await type("echo 'Edited src/app.js'");
  const parsed = await until(() => {
    const a = window.TnaiFileActivity.now(paneId);
    return a && a.at !== actAt;
  }, 8000);
  await wait(400);
  check(
    !!parsed && mine().filter(i => i.inferred).length === inferredMid,
    'steps arrived: the same file in its output adds no inferred row (parsed ' +
      !!parsed +
      ', inferred rows ' +
      inferredMid +
      ' → ' +
      mine().filter(i => i.inferred).length +
      ')'
  );

  // 5. Context chip percent from the turn's own window; checklist count kept on the turn.
  const lv = window.TnaiContextWarning.level(paneId);
  check(
    lv?.pct === 50 && lv.win === 200000,
    'context chip: 50% of the reported 200k window (' +
      JSON.stringify(lv && { pct: lv.pct, win: lv.win }) +
      ')'
  );

  // The checklist count: kept on the turn, and read by a user on the agent's row in the thread
  // list, after what the agent does now (the old Overview row that showed "· 2/3" is deleted).
  const steps = await until(() => window.TnaiTurns.get(paneId)?.steps, 4000);
  check(
    steps?.index === 2 && steps?.total === 3,
    'turn keeps the checklist step 2/3 (' + JSON.stringify(steps) + ')'
  );
  window.TnaiThreadList?.refresh?.();
  const rowNow = () =>
    document.querySelector('.tnt-th[data-pane="' + CSS.escape(paneId) + '"] .tnt-th-now')
      ?.textContent || '';
  check(
    !!(await until(() => / · 2\/3$/.test(rowNow()), 4000)),
    'its row in the thread list ends with the count 2/3 (' + rowNow() + ')'
  );

  // 7. The turn ends by itself: one chime (also when the turn is pushed again), Now line and skills
  // cleared, "finished" row.
  status = 'waiting';
  const end1 = Date.now();
  await turn(t1, {
    endedAt: end1,
    endedBy: 'stop',
    result: 'Done.',
    tokens: { input: 1200, output: 300, cacheRead: 0, cacheWrite: 0 },
    context: { tokens: 100000, window: 200000, at: end1 },
  });
  await turn(t1, {
    endedAt: end1,
    endedBy: 'stop',
    result: 'Done.',
    tokens: { input: 1200, output: 320, cacheRead: 0, cacheWrite: 0 },
    context: { tokens: 100000, window: 200000, at: end1 },
  });
  await wait(300);
  check(
    chimes === 1,
    'finished turn: one chime, none for the second push of the same turn (' + chimes + ')'
  );
  check(
    !F.doing(paneId) && !/Thinking|Running npm test/.test(nowLine()),
    'finished turn: its row no longer shows a tool (' + nowLine() + ')'
  );
  check(
    window.TnaiFileActivity.skills(paneId).length === 0,
    'finished turn: skills in use cleared (' + window.TnaiFileActivity.skills(paneId).length + ')'
  );
  check(
    mine().some(i => /^finished · took/.test(i.text)),
    'finished row in the feed'
  );

  // 8. Interrupted, then failed: no chime, Now line cleared, "stopped after" row.
  for (const by of ['interrupted', 'error']) {
    await wait(1600); // past the chime's own 1.5 s gap, so a wrong chime would sound
    const before = chimes,
      t = { startedAt: Date.now() };
    status = 'working';
    await turn(t);
    await step('Bash', 'npm run build');
    const shown = await until(() => F.doing(paneId)?.text === 'Building', 3000);
    status = 'waiting';
    await turn(t, { endedAt: Date.now(), endedBy: by });
    await wait(300);
    check(
      !!shown &&
        !F.doing(paneId) &&
        chimes === before &&
        mine().some(i => /^stopped after/.test(i.text) && i.at >= t.startedAt),
      by +
        ' turn: tool shown, then cleared, no chime, "stopped after" row (' +
        JSON.stringify({
          shown: !!shown,
          doing: F.doing(paneId)?.text || '',
          chimes: chimes - before,
          hidden: document.hidden,
          turn: [
            window.TnaiTurns.get(paneId)?.startedAt === t.startedAt,
            window.TnaiTurns.get(paneId)?.endedBy,
          ],
        }) +
        ')'
    );
  }

  // 9. Sub-agents: the six event kinds the main process sends for an OpenCode panel (the Claude
  // Code hook shapes; name is '', no subLog).
  // They are read where the thread layout shows them: the chips of the Helpers tab of the lead's
  // thread, and the record behind them (`TnaiTeam`).
  const team = window.TnaiTeam,
    helpers = window.TnaiThreadHelpers,
    oldRetire = team.retireAfter;
  team.retireAfter = 600000; // finished sub-agents stay for the checks below
  const chips = () => [...document.querySelectorAll('.tnt-side-panel .tnt-side-chip')];
  const chip = key => chips().find(one => one.dataset.key === key);
  const subOf = (id, key) => team.get(id)?.subs.find(one => one.key === key);
  const sideTalk = () => document.querySelector('.tnt-side-panel .tnt-side-talk');

  // Opens a thread and its Helpers tab (the tab exists only while the thread has helpers).
  const showHelpers = async (id, key) => {
    window.TnaiThreads.open();
    window.TnaiThreads.select(id);
    await until(() => helpers.state().pane === id && helpers.state().helpers.length > 0, 4000);
    helpers.open(key);
  };
  const child = 'ses_child1',
    t4 = { startedAt: Date.now() };
  status = 'working';
  await turn(t4);
  await main('event', paneId, {
    kind: 'spawn',
    toolUseId: 'oc-tu1',
    type: 'general',
    name: '',
    description: 'Check the docs',
    prompt: 'Read docs/guide.md and list its headings',
    background: false,
  });
  await main('event', paneId, {
    kind: 'spawn',
    toolUseId: 'oc-tu2',
    type: 'general',
    name: '',
    description: 'Refused helper',
    prompt: 'Never runs',
    background: false,
  });
  await showHelpers(paneId);
  check(
    !!(await until(() => chips().length === 2, 4000)),
    'Helpers tab: the OpenCode thread shows both calls as helpers (' + chips().length + ')'
  );
  const firstName = subOf(paneId, 'oc-tu1')?.alias || '';
  check(
    subOf(paneId, 'oc-tu1')?.status === 'starting' &&
      !!firstName &&
      (chip('oc-tu1')?.textContent || '').startsWith(firstName + ' · '),
    'a sub-agent without a name gets one from the name list (' +
      (chip('oc-tu1')?.textContent || 'none') +
      ')'
  );
  await main('event', paneId, { kind: 'spawn-refused', toolUseId: 'oc-tu2' });
  check(
    !!(await until(() => !chip('oc-tu2') && chips().length === 1, 3000)),
    'refused call: its helper is removed'
  );
  await main('event', paneId, { kind: 'sub-start', agentId: child, agentType: 'general' });
  await main('event', paneId, {
    kind: 'tool',
    agentId: child,
    agentType: 'general',
    tool: 'Read',
    detail: root + '/src/app.js',
    label: '',
  });
  check(
    !!(await until(
      () =>
        subOf(paneId, 'oc-tu1')?.status === 'running' &&
        /app\.js/.test(subOf(paneId, 'oc-tu1').now?.detail || '') &&
        subOf(paneId, 'oc-tu1').tools === 1 &&
        chip('oc-tu1')?.dataset.tone === 'work',
      4000
    )),
    'started sub-agent: running, its tool as what it does now, one tool call, its helper shown as working (' +
      JSON.stringify(subOf(paneId, 'oc-tu1')?.now || null).slice(0, 120) +
      ', tone ' +
      chip('oc-tu1')?.dataset.tone +
      ')'
  );
  check(
    F.doing(paneId)?.text === 'Thinking',
    'a sub-agent’s tool does not become the lead’s Now line (' +
      (F.doing(paneId)?.text || 'none') +
      ')'
  );
  await turn(t4, { subAgents: 0, subTokens: { [child]: 4321 } });

  // The sub-agent's row under its lead in the thread list. (The old agent card's token tooltip that
  // named OpenCode's record went with the Overview; the number itself is checked below.)
  await go('overview');
  window.TnaiThreadList?.refresh?.();
  const listSub = await until(() => subRow('oc-tu1'), 3000);
  check(
    !!listSub && /Check the docs/.test(listSub.textContent),
    'thread list: the sub-agent has its row under its lead (' +
      (listSub?.textContent.trim().slice(0, 80) || 'none') +
      ')'
  );
  await main('event', paneId, {
    kind: 'sub-stop',
    agentId: child,
    agentType: 'general',
    text: 'Found 3 headings.',
  });
  await main('event', paneId, {
    kind: 'spawn-result',
    toolUseId: 'oc-tu1',
    result: { text: 'Found 3 headings.', agentId: child, status: 'completed', async: false },
  });
  await showHelpers(paneId, 'oc-tu1');
  check(
    !!(await until(
      () =>
        subOf(paneId, 'oc-tu1')?.status === 'done' &&
        /Found 3 headings\./.test(subOf(paneId, 'oc-tu1').result || '') &&
        chip('oc-tu1')?.dataset.tone === 'idle',
      4000
    )),
    'finished sub-agent: done, with its end text kept, its helper shown as finished (' +
      chip('oc-tu1')?.dataset.tone +
      ')'
  );

  // The sub-agent's tokens, as the turn carries them.
  check(
    window.TnaiTurns.get(paneId)?.subTokens?.[child] === 4321,
    'sub-agent tokens from the turn (' +
      JSON.stringify(window.TnaiTurns.get(paneId)?.subTokens) +
      ')'
  );

  // Its own conversation has no transcript to draw (no subLog): a plain note, no dead control.
  const viewText = await until(() => {
    const note = sideTalk()?.querySelector('.tnt-talk-empty');
    return note && !note.hidden && note.textContent;
  }, 5000);

  // A control counts only when it is on screen: the view's own jump button ("Latest")
  // exists in every conversation and stays hidden while there is nothing to jump to.
  const shownControls = [...sideTalk().querySelectorAll('button:not([disabled])')].filter(
    button => !button.closest('[hidden]') && button.getClientRects().length > 0
  );
  check(
    /OpenCode keeps no separate record/.test(viewText || '') &&
      /Details tab/.test(viewText || '') &&
      shownControls.length === 0,
    'helper’s conversation: a plain note that OpenCode keeps no record of it and where its work is, no control (' +
      (viewText || 'none') +
      '; controls on screen: ' +
      (shownControls.map(button => button.textContent.trim()).join(', ') || 'none') +
      ')'
  );

  // A call that never started is dropped when the turn ends (OpenCode sends no stop event).
  await main('event', paneId, {
    kind: 'spawn',
    toolUseId: 'oc-tu3',
    type: 'general',
    name: '',
    description: 'Never started',
    prompt: 'x',
    background: false,
  });
  check(
    !!(await until(() => chip('oc-tu3')?.dataset.tone === 'work', 3000)) &&
      subOf(paneId, 'oc-tu3')?.status === 'starting',
    'a third call shows as a starting helper'
  );

  // A permission request for OpenCode's own task tool (lower case, no description): the waiting
  // call's row says so, as Claude Code's does.
  await main('permission', {
    id: 'per_task1',
    paneId,
    tool: 'task',
    detail: 'general',
    description: '',
    sessionScope: null,
    at: Date.now(),
  });

  // the sub-agent's row in the thread list (119 subNow) carries the wording (the same for Claude
  // Code)
  await go('overview');
  const tu3 = () => {
    window.TnaiThreadList?.refresh?.();
    return subRow('oc-tu3')?.textContent || '';
  };
  check(
    !!(await until(
      () =>
        /Waiting for approval/.test(tu3()) &&
        team.get(paneId)?.subs.find(x => x.key === 'oc-tu3')?.asking === 'per_task1',
      3000
    )),
    'task permission request: the row reads Waiting for approval (' + tu3().slice(0, 80) + ')'
  );
  await main('permission', { id: 'per_task1', paneId, done: true, decision: 'once' });
  check(
    !!(await until(
      () =>
        /Starting/.test(tu3()) &&
        !/Waiting for approval/.test(tu3()) &&
        document.querySelector('.tnai-perm')?.hidden,
      3000
    )),
    'answered: the row is back to Starting and the card is put away (' + tu3().slice(0, 80) + ')'
  );
  await showHelpers(paneId);
  status = 'waiting';
  await turn(t4, {
    endedAt: Date.now(),
    endedBy: 'stop',
    subAgents: 1,
    subTokens: { [child]: 4321 },
  });
  check(
    !!(await until(() => !chip('oc-tu3') && !subOf(paneId, 'oc-tu3'), 3000)) && !!chip('oc-tu1'),
    'turn ended: the never-started helper is removed, the finished one stays'
  );

  // 10. A Claude Code panel in the same run renders as before (same events, plus its prompt and
  // stop).
  const cc = await window.TnaiTest.open('Terminal'),
    ccId = cc.paneId,
    CC = 'Claude Code';
  await until(() => realSessions().find(x => x.paneId === ccId && x.running), 15000);
  G.sessions = () =>
    realSessions().map(x =>
      x.paneId === paneId
        ? { ...x, agent: CLI, status }
        : x.paneId === ccId
          ? { ...x, agent: CC }
          : x
    );
  await main('event', ccId, { kind: 'prompt', text: '[TN.ai] Check the build' });
  await main('event', ccId, {
    kind: 'spawn',
    toolUseId: 'cc-tu1',
    type: 'general-purpose',
    name: '',
    description: 'Run the tests',
    prompt: 'Run npm test',
    background: false,
  });
  await main('event', ccId, { kind: 'sub-start', agentId: 'cc-a1', agentType: 'general-purpose' });
  await main('event', ccId, {
    kind: 'tool',
    agentId: 'cc-a1',
    agentType: 'general-purpose',
    tool: 'Bash',
    detail: 'npm test',
    label: '',
  });
  await showHelpers(ccId);
  check(
    !!(await until(
      () =>
        subOf(ccId, 'cc-tu1')?.status === 'running' &&
        /npm test/.test(subOf(ccId, 'cc-tu1').now?.detail || '') &&
        chip('cc-tu1')?.dataset.tone === 'work',
      4000
    )) && team.busy(ccId),
    'Claude Code thread: its helper runs with its tool, lead busy from the prompt event'
  );
  await main('event', ccId, {
    kind: 'sub-stop',
    agentId: 'cc-a1',
    agentType: 'general-purpose',
    text: 'All green.',
  });
  await main('event', ccId, {
    kind: 'spawn-result',
    toolUseId: 'cc-tu1',
    result: { text: 'All green.', agentId: 'cc-a1', status: 'completed', async: false },
  });
  check(
    !!(await until(
      () =>
        subOf(ccId, 'cc-tu1')?.status === 'done' &&
        /All green\./.test(subOf(ccId, 'cc-tu1').result || '') &&
        chip('cc-tu1')?.dataset.tone === 'idle',
      4000
    )),
    'Claude Code thread: finished helper with its output'
  );
  const ccView = await until(() => {
    const note = sideTalk()?.querySelector('.tnt-talk-empty');
    return note && !note.hidden && note.textContent;
  }, 5000);
  check(
    !!ccView && !/OpenCode/.test(ccView),
    'Claude Code helper’s conversation keeps its own empty note (' + (ccView || 'none') + ')'
  );
  await main('event', ccId, { kind: 'stop', text: 'Done.', question: null });
  check(
    !!(await until(() => !team.busy(ccId), 3000)),
    'Claude Code panel: stop event ends its turn'
  );
  team.retireAfter = oldRetire;
  G.sessions = realSessions;
  if (window.TnaiNotify) window.TnaiNotify.play = realPlay;
  G.stop(paneId);
  G.stop(ccId);

  // Let the shells finish closing: leaving the app in the middle of that crashed it
  // (0xC0000409) after RESULT: PASS.
  await until(() => !G.sessions().some(session => session.running), 10000);
  await wait(300);
} catch (error) {
  check(false, 'test threw: ' + (error?.stack || error));
  G.sessions = realSessions;
  if (window.TnaiNotify && realPlay) window.TnaiNotify.play = realPlay;
}
return { ok, log };
