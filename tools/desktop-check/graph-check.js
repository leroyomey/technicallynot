// Technically Not tools · desktop-check/graph-check.js — Custom agents' task graph
// (desktop/agent-graph.js) in plain Node with a fake terminal and window: tools only for custom
// agents, delegation checks (reason, duplicates, idle reuse, limits, depth), task delivered on
// ready, report handed to an idle parent or a tnai_wait, close after the grace period unless kept,
// follow-ups, parent exit; lifecycle (identity / instance / task): reuse, hide, revive, clone,
// create, recycle, suspend, restore after restart. No CLI runs and no prompt reaches any agent.
// Usage: node tools/desktop-check/graph-check.js
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-graph-'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => tmp } } : load(req, ...rest);
const graph = require('../../desktop/agent-graph');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const typed = [],
  stopped = [],
  events = [];

// list(): every pane not stopped counts as running (agent-graph only types into a running pane).
const ptys = {
  write: (paneId, data) => typed.push([paneId, data]),
  stop: paneId => stopped.push(paneId),
  list: () =>
    ['root', 'sub9', ...Array.from({ length: paneN }, (_, i) => 'sub' + (i + 1))].map(paneId => ({
      paneId,
      running: !stopped.includes(paneId),
      pid: 1,
    })),
};
let paneN = 0;

// prompt-submit.js stand-in: paste then Enter into a running pane.
const submit = async (paneId, body) => {
  if (!ptys.list().some(s => s.paneId === paneId && s.running)) return { ok: false, state: 'gone' };
  ptys.write(paneId, '\x1b[200~' + body + '\x1b[201~');
  ptys.write(paneId, '\r');
  return { ok: true, state: 'sent' };
};

// The fake window: opens a pane for each spawn request, like 43-agent-graph.js does, then "starts"
// it (attach).
graph.init(
  (channel, payload) => {
    events.push([channel, payload]);
    if (channel === 'graph:spawn')
      setTimeout(() => {
        const p = 'sub' + ++paneN;
        if (graph.attach(payload.nodeId, p, payload.name || 'Sub' + paneN))
          graph.started(p, payload.resumeId || 'sess-' + paneN);
      }, 5);
  },
  { ptys, submit }
);
const text = r => r.content.map(c => c.text).join('\n');
const typedTo = paneId =>
  typed
    .filter(t => t[0] === paneId)
    .map(t => t[1])
    .join('');

(async () => {
  graph.setSettings({ maxDepth: 1, maxActivePerAgent: 2, maxActiveTotal: 3, graceSeconds: 10 });
  check(graph.tools('plain').length === 0, 'a session that is not a custom agent gets no tools');
  check(
    /not a custom agent/.test(text(await graph.call('plain', 'tnai_delegate', {}))),
    'and its calls are refused'
  );
  graph.rootStarted('root', 'custom-1', 'Nova');
  check(
    graph
      .tools('root')
      .map(t => t.name)
      .join() === 'tnai_delegate,tnai_subagents,tnai_wait,tnai_assign',
    'custom agent gets the 4 delegation tools'
  );

  const task =
    'Write unit tests for the settings page density checks and run them with the desktop runner.';
  check(
    /explain why/.test(
      text(await graph.call('root', 'tnai_delegate', { purpose: 'Settings tests', task, why: 'x' }))
    ),
    'no real reason → refused'
  );
  let r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Settings tests',
    task,
    why: 'Runs in parallel while I refactor the page itself.',
  });
  check(
    !r.isError && /Started a new sub-agent Sub1/.test(text(r)),
    'delegation starts a sub-agent in its own pane: ' + text(r).slice(0, 60)
  );
  check(
    graph.tools('sub1').length === 0,
    'sub-agent at the depth limit gets no tools (no recursive spawning)'
  );

  // `tnai new` is held to the same limits.
  check(
    /sub-agent does not start new agents/.test(graph.refuseNew('sub1', 0)),
    "`tnai new` from a sub-agent's panel is refused"
  );
  check(
    graph.refuseNew('root', 2) === '' && graph.refuseNew('plain', 2) === '',
    '`tnai new` from a lead or a plain panel passes under the limit'
  );
  check(
    /3 agents started with `tnai new` are already open/.test(graph.refuseNew('root', 3)),
    '`tnai new` is refused once as many are open as sub-agents may work in total: ' +
      graph.refuseNew('root', 3).slice(0, 70)
  );
  check(
    /already working on the same task/.test(
      text(
        await graph.call('root', 'tnai_delegate', {
          purpose: 'Settings tests',
          task,
          why: 'Another copy to run in parallel with the first.',
        })
      )
    ),
    'duplicate task refused'
  );

  graph.onEvent('sub1', { kind: 'ready' });
  check(
    /\[(?:TN|TechnicallyNot)\.ai\] Task from Nova: Write unit tests/.test(typedTo('sub1')),
    'task typed into the sub-agent once it is ready'
  );
  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Docs for updater',
    task: 'Rewrite docs/UPDATES.md for the new release flow and the one-time setup steps.',
    why: 'Independent of the code work, can run alongside.',
  });
  check(!r.isError, 'second sub-agent allowed');
  check(
    /2 working sub-agents/.test(
      text(
        await graph.call('root', 'tnai_delegate', {
          purpose: 'Lint pass',
          task: 'Run eslint over desktop and fix every warning it reports in there.',
          why: 'Mechanical and separate from the rest of it.',
        })
      )
    ),
    'per-agent active limit enforced'
  );

  // Parent is busy (inside a tool call), so the report waits; tnai_wait receives it.
  const waiting = graph.call('root', 'tnai_wait', { timeout_seconds: 30 });
  graph.onEvent('sub1', {
    kind: 'stop',
    text: 'Added 3 tests, all pass. Not verified at tablet width.',
  });
  r = await waiting;
  check(
    /Sub1 .*finished "Settings tests":\nAdded 3 tests/.test(text(r)),
    'tnai_wait returns the finished report'
  );
  check(!/Added 3 tests/.test(typedTo('root')), 'a report taken by tnai_wait is not typed again');

  // The lead's MCP client gives up on a tnai_wait (Claude Code's request timeout): the wait ends at
  // once and takes no report with it.
  const gaveUp = new AbortController();
  const cancelled = graph.call('root', 'tnai_wait', { timeout_seconds: 30 }, gaveUp.signal);
  await wait(5);
  check(
    graph.state().nodes.find(n => n.paneId === 'root').inWait,
    'a running tnai_wait shows as waiting'
  );
  gaveUp.abort();
  r = await cancelled;
  check(
    r.isError &&
      /Cancelled/.test(text(r)) &&
      !graph.state().nodes.find(n => n.paneId === 'root').inWait,
    'a tnai_wait whose client gave up is cancelled (no waiter left to swallow a later report)'
  );
  r = await graph.call('root', 'tnai_wait', { timeout_seconds: 0.001 });
  check(
    /No sub-agent finished yet\. Still working: .*Call tnai_wait again/.test(text(r)),
    'a wait that times out says who is still working and to call tnai_wait again'
  );
  let s = graph.state().nodes.find(n => n.paneId === 'sub1');
  check(
    s.status === 'done' && s.closesAt > Date.now(),
    'finished sub-agent whose report reached its lead closes after the grace period, also while the lead works'
  );

  // Related new task while Sub1 is idle → REUSE (same conversation), no refusal.
  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Micro density test',
    task: 'Add a micro density test to the settings page tests and run it.',
    why: 'Keeps testing going while I refactor.',
  });
  s = graph.state().nodes.find(n => n.paneId === 'sub1');
  check(
    !r.isError &&
      /idle sub-agent Sub1/.test(text(r)) &&
      s.status === 'working' &&
      !s.closesAt &&
      /New task from Nova \(related/.test(typedTo('sub1')),
    'related task → REUSE the idle sub-agent: ' + text(r).slice(0, 50)
  );

  // tnai_assign by id: refused while it works.
  check(
    /still working/.test(
      text(
        await graph.call('root', 'tnai_assign', {
          id: s.id.slice(0, 8),
          task: 'Also check the tablet width.',
        })
      )
    ),
    'tnai_assign refused while that sub-agent is working'
  );

  // An id prefix counts only from 6 characters: a short word (a name like "bad" or "a" is also a
  // hex prefix) never reaches a sub-agent by its id.
  for (const n of [1, 3, 5])
    check(
      !/still working/.test(
        text(
          await graph.call('root', 'tnai_assign', {
            id: s.id.slice(0, n),
            task: 'Also check the tablet width.',
          })
        )
      ),
      'tnai_assign with a ' + n + '-character id prefix reaches no sub-agent'
    );
  check(
    /still working/.test(
      text(
        await graph.call('root', 'tnai_assign', {
          id: s.id.slice(0, 6),
          task: 'Also check the tablet width.',
        })
      )
    ),
    'tnai_assign with a 6-character id prefix reaches it'
  );

  // Parent idle (its Stop): a report arriving now is typed into it.
  graph.onEvent('root', { kind: 'stop', text: '' });
  graph.onEvent('sub2', { kind: 'ready' });
  graph.onEvent('sub2', { kind: 'stop', text: 'UPDATES.md rewritten.' });
  check(
    /\[(?:TN|TechnicallyNot)\.ai\] Sub-agent Sub2 [\s\S]*UPDATES\.md rewritten/.test(
      typedTo('root')
    ),
    'idle parent gets the report typed in'
  );
  const id2 = graph.state().nodes.find(n => n.paneId === 'sub2').id;
  graph.keep(id2, true);
  check(
    graph.state().nodes.find(n => n.id === id2).persistent &&
      !graph.state().nodes.find(n => n.id === id2).closesAt,
    'kept sub-agent has no close timer'
  );
  const before = typedTo('root').length;
  graph.onEvent('sub2', { kind: 'prompt', text: 'also add a FAQ' });
  graph.onEvent('sub2', { kind: 'stop', text: 'FAQ added.' });
  check(
    !/FAQ added/.test(typedTo('root').slice(before)),
    "user's own follow-up in a kept sub-agent is not sent to the parent"
  );

  // Sub1 finishes; the user closes its pane → HIDDEN, conversation saved → reusable.
  graph.onEvent('sub1', { kind: 'stop', text: 'Micro test added.' });
  const sub1 = () => graph.state().nodes.find(n => n.paneId === 'sub1');
  check(
    !sub1().closesAt,
    'its report went to the lead, which works on it: the finished sub-agent stays'
  );
  graph.onEvent('root', { kind: 'stop', text: '' });
  check(
    /Micro test added/.test(typedTo('root')) && sub1().closesAt > Date.now(),
    "the lead's turn ends and it gets the waiting report: the sub-agent closes after the grace period"
  );
  graph.onEvent('root', { kind: 'stop', text: '' });
  check(
    sub1().closesAt > Date.now(),
    "the lead's task is over and no sub-agent works: the unkept finished one is scheduled to close"
  );
  graph.onEvent('root', { kind: 'prompt', text: 'one more thing' });
  check(
    sub1().closesAt > Date.now(),
    'the lead starts a new task: the countdown goes on, its report already reached the lead'
  );
  graph.onEvent('root', { kind: 'stop', text: '' });
  check(sub1().closesAt > 0, 'and starts again when that task ends');
  graph.removed('sub1');
  s = graph.state().nodes.find(n => n.id === s.id);
  check(
    s.state === 'HIDDEN' && s.reusable && !s.paneId,
    'closed → HIDDEN and reusable (conversation kept): ' + s.state
  );

  // Related work again → REVIVE that same instance (its conversation resumed) in a new pane.
  graph.setSettings({ maxActivePerAgent: 3 });
  const spawnsBefore = events.filter(e => e[0] === 'graph:spawn').length;
  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Settings tests for tablet',
    task: 'Write unit tests for the settings page at tablet width and run them with the desktop runner.',
    why: 'Parallel with my refactor of the page.',
  });
  const spawn = events.filter(e => e[0] === 'graph:spawn')[spawnsBefore]?.[1];
  const revived = graph.state().nodes.find(n => n.id === s.id);
  check(
    !r.isError &&
      /Revived/.test(text(r)) &&
      spawn?.resumeId === 'sess-1' &&
      revived.paneId === 'sub3' &&
      revived.name === 'Sub1',
    'related work → REVIVE the hidden instance (same id, conversation sess-1 resumed, new pane)'
  );
  graph.onEvent('sub3', { kind: 'ready' });
  check(
    /Revived for a related task/.test(typedTo('sub3')),
    'revived instance told it is a related task'
  );

  // Related but the identity is busy → CLONE: a second instance of the same identity, fresh
  // conversation, unique id.
  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Settings account rows',
    task: 'Test the settings page account rows: add, rename and remove, then run the desktop runner.',
    why: 'Separate area of the page, runs alongside.',
  });
  const clone = graph.state().nodes.find(n => n.paneId === 'sub4');
  check(
    !r.isError &&
      /fresh copy/.test(text(r)) &&
      clone &&
      clone.identityId === revived.identityId &&
      clone.instance === 2 &&
      clone.id !== revived.id,
    'identity busy → CLONE "Sub1 #2" with its own id: ' + text(r).slice(0, 60)
  );
  graph.onEvent('sub4', { kind: 'ready' });

  // Unrelated work, no free identity → CREATE a new identity.
  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Changelog draft',
    task: 'Draft release notes from the git log since the last tag into a scratch file.',
    why: 'Independent writing job, parallel.',
  });
  check(
    /per-agent|3 working/.test(text(r)) || /Started a new sub-agent/.test(text(r)),
    'unrelated → CREATE (or the limit): ' + text(r).slice(0, 50)
  );

  // Parent ends: unkept sub-agents close (mid-task → SUSPENDED), kept ones stay.
  // …including one whose pane is still opening: it is never started (attach refuses it, so main
  // refuses its pty:start).
  graph.setSettings({ maxActivePerAgent: 6, maxActiveTotal: 11 });
  graph.call('root', 'tnai_delegate', {
    purpose: 'Lint config audit',
    task: 'Audit the eslint configuration files for rules that conflict with prettier formatting.',
    why: 'Separate audit, parallel.',
  });
  const late = graph.state().nodes.find(n => n.purpose === 'Lint config audit');
  graph.exited('root');
  await wait(50);
  check(
    late &&
      !graph.state().nodes.find(n => n.id === late.id).paneId &&
      graph.attach(late.id, 'late', 'Late') === null,
    'parent ended while a sub-agent pane was opening → it is never started'
  );
  graph.setSettings({ maxActivePerAgent: 3, maxActiveTotal: 6 });
  const after = graph.state().nodes;
  check(
    after.find(n => n.id === revived.id).state === 'SUSPENDED' && stopped.includes('sub3'),
    'parent ended → working sub-agent SUSPENDED, process stopped'
  );
  check(after.find(n => n.id === id2).paneId === 'sub2', 'kept sub-agent stays');
  check(
    events.some(e => e[0] === 'graph:close' && e[1].paneId === 'sub3'),
    'window told to close its pane'
  );

  // Persistence: identities and hidden/suspended instances survive a restart; the root gets its
  // family back.
  await wait(400);
  delete require.cache[require.resolve('../../desktop/agent-graph')];
  const again = require('../../desktop/agent-graph');
  again.init(() => {}, { ptys, submit });
  const st = again.state();
  check(
    st.identities.length >= 2 && st.nodes.some(n => n.id === revived.id && n.state === 'SUSPENDED'),
    'restart: ' + st.identities.length + ' identities and the suspended instance restored'
  );
  again.rootStarted('root', 'custom-1', 'Nova');
  check(
    /Sub1/.test(text(await again.call('root', 'tnai_subagents', {}))),
    'the custom agent sees its earlier sub-agents after restart'
  );

  // Unrelated work with a free identity → RECYCLE it: fresh conversation, old job listed by name
  // only.
  let prompt = '';
  again.init(
    (channel, payload) => {
      if (channel === 'graph:spawn')
        setTimeout(() => {
          prompt = again.attach(payload.nodeId, 'sub9', payload.name)?.appendPrompt || '';
          again.started('sub9', '');
          spawnMsg = payload;
        }, 5);
    },
    { ptys, submit }
  );
  let spawnMsg = null;
  r = await again.call('root', 'tnai_delegate', {
    purpose: 'Icon export',
    task: 'Export the app icon as 16, 32 and 256 px PNG files into the build folder.',
    why: 'Independent asset job, parallel to mine.',
  });
  check(
    /Reused your sub-agent identity \(fresh context/.test(text(r)) &&
      !spawnMsg?.resumeId &&
      /Earlier jobs of this role/.test(prompt) &&
      !/Added 3 tests/.test(prompt),
    'unrelated + free identity → RECYCLE: no resumed conversation, old jobs by name only: ' +
      text(r).slice(0, 60)
  );

  // tnai_delegate `worktree`: inherit (default) / own / none go to main through attach() with the
  // lead's pane; anything else is refused; setLane puts the branch on the node.
  let where = null,
    wn = 0;
  again.setSettings({ maxDepth: 2, maxActivePerAgent: 6, maxActiveTotal: 11 });
  again.init(
    (channel, payload) => {
      if (channel === 'graph:spawn')
        setTimeout(() => {
          const p = 'lane' + ++wn;
          where = again.attach(payload.nodeId, p, 'Lane' + wn);
          again.started(p, '');
        }, 5);
    },
    { ptys, submit }
  );
  again.rootStarted('lead', 'custom-2', 'Iris');
  const schema = again.tools('lead').find(t => t.name === 'tnai_delegate');
  check(
    schema.inputSchema.properties.worktree?.enum.join() === 'inherit,own,none' &&
      /worktree "own"/.test(schema.description),
    'tnai_delegate offers worktree inherit/own/none and says so'
  );
  check(
    /worktree must be one of inherit, own, none/.test(
      text(
        await again.call('lead', 'tnai_delegate', {
          purpose: 'Bad lane',
          task: 'Paint the fence around the orchard in three coats.',
          why: 'Separate outdoor chore, parallel.',
          worktree: 'elsewhere',
        })
      )
    ),
    'unknown worktree value refused'
  );
  const lanes = [
    [
      undefined,
      'inherit',
      'Pottery glaze notes',
      'Summarise kiln glaze recipes for celadon and tenmoku finishes.',
    ],
    [
      'own',
      'own',
      'Violin rosin survey',
      'Compare violin rosin brands by grip, dust and temperature behaviour.',
    ],
    [
      'NONE',
      'none',
      'Tide chart parser',
      'Parse harbour tide tables into hourly water heights per weekday.',
    ],
  ];
  for (const [asked, want, purpose, task] of lanes) {
    where = null;
    r = await again.call('lead', 'tnai_delegate', {
      purpose,
      task,
      why: 'Independent side job that runs alongside mine.',
      ...(asked ? { worktree: asked } : {}),
    });
    const node = again.state().nodes.find(n => n.purpose === purpose);
    check(
      !r.isError &&
        where?.worktree === want &&
        where.parentPaneId === 'lead' &&
        node?.worktree === want,
      'worktree ' +
        (asked || '(default)') +
        ' → attach says ' +
        where?.worktree +
        ', node ' +
        node?.worktree
    );
  }
  again.setLane('lane1', 'tnai/claude-code-abc123');
  check(
    again.state().nodes.find(n => n.paneId === 'lane1')?.lane === 'tnai/claude-code-abc123' &&
      again.state().nodes.find(n => n.paneId === 'lane3')?.lane === '',
    'setLane puts the worktree branch on the node (the project folder stays empty)'
  );

  // Team estimate: real tokens of each sub-agent's first task turn (agent-turns payload), median
  // once 3 have finished; a later turn doesn't change it.
  const turn = (paneId, out, at = Date.now()) =>
    again.onTurn({
      paneId,
      startedAt: at,
      endedAt: at + 1,
      tokens: { input: 10000, cacheRead: 50000, cacheWrite: 0, output: out },
    });
  check(
    again.state().estimate.all === null &&
      !/Cost:/.test(again.tools('lead').find(t => t.name === 'tnai_delegate').description),
    'no estimate before any sub-agent task finished'
  );
  turn('lane1', 20000);
  turn('lane2', 40000);
  check(again.state().estimate.all === null, 'still no estimate after 2 finished tasks');
  turn('lane3', 90000);
  const est = again.state().estimate;
  check(
    est.all?.perTask === 50000 &&
      est.all.samples === 3 &&
      est.byCli['Claude Code']?.perTask === 50000,
    'estimate = median of input + cache writes + output (cache reads left out): ' +
      JSON.stringify(est.all)
  );
  turn('lane1', 900000, Date.now() + 60000);
  check(
    again.state().estimate.all.perTask === 50000,
    'a later turn in the same panel (user follow-up) does not change the task’s tokens'
  );
  check(
    /Cost: .*~50k tokens per sub-agent task \(median of the last 3/.test(
      again.tools('lead').find(t => t.name === 'tnai_delegate').description
    ),
    'the lead sees the estimate in tnai_delegate before it starts more'
  );

  // Codex: the share of its own plan window per task (agent-turns `plan`), only from tasks that ran
  // alone on the account.
  const codexPane = async (purpose, task) => {
    const res = await again.call('lead', 'tnai_delegate', {
      purpose,
      task,
      why: 'Independent side job that runs alongside mine.',
      agent: 'Codex',
    });
    return [res, again.state().nodes.find(n => n.purpose === purpose)?.paneId];
  };
  again.setSettings({ maxActivePerAgent: 6, maxActiveTotal: 11 });
  for (const p of ['lane1', 'lane2', 'lane3']) {
    again.onEvent(p, { kind: 'ready' });
    again.onEvent(p, { kind: 'stop', text: 'Done.' });
  }

  // The window can't start it (43 spawn → spawnFailed): the lead gets that reason at once, not the
  // timeout's guess.
  again.init(
    (channel, payload) => {
      if (channel === 'graph:spawn')
        setTimeout(
          () =>
            again.spawnFailed(
              payload.nodeId,
              'OpenCode is not signed in: start a thread with it and sign in, then delegate again'
            ),
          5
        );
    },
    { ptys, submit }
  );
  const t0 = Date.now();
  r = await again.call('lead', 'tnai_delegate', {
    purpose: 'Glacier photo captions',
    task: 'Write captions for the glacier photo set in the gallery folder.',
    why: 'Independent side job that runs alongside mine.',
    agent: 'OpenCode',
  });
  const signedOut = again.state().nodes.find(n => n.purpose === 'Glacier photo captions');
  check(
    r.isError &&
      /Not started: OpenCode is not signed in: start a thread with it and sign in, then delegate again\. Do this part yourself\./.test(
        text(r)
      ) &&
      !/workspace may be full/.test(text(r)) &&
      Date.now() - t0 < 2000 &&
      signedOut?.status === 'failed',
    'signed-out CLI: the lead is told "not signed in" at once: ' + text(r)
  );
  again.init(
    (channel, payload) => {
      if (channel === 'graph:spawn')
        setTimeout(() => {
          const p = 'lane' + ++wn;
          again.attach(payload.nodeId, p, 'Lane' + wn);
          again.started(p, '');
        }, 5);
    },
    { ptys, submit }
  );

  const cx = [];
  for (const [purpose, task] of [
    ['Codex docs pass', 'Proofread every heading in the docs folder and fix the typos.'],
    ['Codex lint sweep', 'Run the linter over the tools folder and fix what it flags.'],
    ['Codex icon names', 'Rename the icon files in assets to kebab-case and fix references.'],
  ])
    cx.push((await codexPane(purpose, task))[1]);
  const plan = (used, shared = false) => ({ used, window: 300, plan: 'plus', left: 60, shared });
  const cturn = (paneId, p) => {
    again.onEvent(paneId, { kind: 'ready' });
    const at = Date.now();
    again.onTurn({
      paneId,
      startedAt: at,
      endedAt: at + 1,
      tokens: { input: 8000, output: 2000 },
      plan: p,
    });
  };
  check(cx.every(Boolean), 'three Codex sub-agents started: ' + cx.join());
  cturn(cx[0], plan(3));
  cturn(cx[1], plan(4, true));
  cturn(cx[2], plan(5));
  check(
    again.state().estimate.byCli.Codex?.planPct === undefined,
    'a shared task is left out: only 2 measured, no Codex plan share yet'
  );
  const [r4] = await codexPane(
    'Codex test names',
    'Rename the test files in tools to match the feature they check.'
  );
  const cx4 = again.state().nodes.find(n => n.purpose === 'Codex test names')?.paneId;
  cturn(cx4, plan(6));
  const ce = again.state().estimate.byCli.Codex;
  check(
    ce?.planPct === 5 && ce.planSamples === 3 && ce.planWindow === 300 && ce.plan === 'plus',
    'Codex plan share = median of the tasks that ran alone: ' + JSON.stringify(ce)
  );
  const [r5] = await codexPane(
    'Codex readme links',
    'Check every link in the README files and fix the broken ones.'
  );
  check(
    /Codex ones ≈ 5% of the 5-hour plan window/.test(text(r5)) &&
      /about 5% of the user’s Codex 5-hour plan window each/.test(text(r5)),
    'the lead is told the Codex team share: ' + text(r5).slice(-260)
  );
  check(!r4.isError, 'fourth Codex sub-agent started');

  // tnai_delegate model / effort (desktop/model-pick.js): only names from the CLI's own list; the
  // pick reaches the window with graph:spawn.
  let picked = null,
    mn = 0;
  again.init(
    (channel, payload) => {
      if (channel === 'graph:spawn')
        setTimeout(() => {
          picked = payload;
          const p = 'model' + ++mn;
          again.attach(payload.nodeId, p, 'Model' + mn);
          again.started(p, '');
        }, 5);
    },
    { ptys, submit }
  );
  again.rootStarted('opal', 'custom-9', 'Opal');
  const mschema = again.tools('opal').find(t => t.name === 'tnai_delegate');
  check(
    mschema.inputSchema.properties.model && mschema.inputSchema.properties.effort,
    'tnai_delegate offers model and effort'
  );
  check(
    /Refused: Claude Code has no model "gpt-9"/.test(
      text(
        await again.call('opal', 'tnai_delegate', {
          purpose: 'Model lane',
          task: 'Sort the spice rack by region and label every jar.',
          why: 'Separate kitchen chore, parallel.',
          model: 'gpt-9',
        })
      )
    ),
    'unknown model refused'
  );
  r = await again.call('opal', 'tnai_delegate', {
    purpose: 'Model lane',
    task: 'Sort the spice rack by region and label every jar.',
    why: 'Separate kitchen chore, parallel.',
    model: 'Opus 5.5',
    effort: 'extra high',
  });
  check(
    /on Opus 5.5, xhigh effort/.test(text(r)) &&
      picked?.model === 'claude-opus-5-5' &&
      picked?.effort === 'xhigh',
    'model + effort reach graph:spawn: ' + text(r).slice(0, 90)
  );

  // tnai_delegate `name` (the user named the sub-agent): shown exactly, even though the window
  // would pick another; a related task under another name never goes to that sub-agent (a new one
  // of that name starts instead).
  check(!!mschema.inputSchema.properties.name, 'tnai_delegate offers name');
  r = await again.call('opal', 'tnai_delegate', {
    name: '  bug   reporter ',
    purpose: 'Bug report',
    task: 'Collect every open bug in the tracker and write a short report of them.',
    why: 'Separate reading job, parallel.',
  });
  const br = again.state().nodes.find(n => n.name === 'bug reporter');
  check(
    !r.isError && picked?.name === 'bug reporter' && !!br,
    'named sub-agent: graph:spawn and the node carry "bug reporter": ' + text(r).slice(0, 70)
  );
  again.onEvent(br.paneId, { kind: 'ready' });
  again.onEvent(br.paneId, { kind: 'stop', text: 'Found 4 bugs.' });
  r = await again.call('opal', 'tnai_delegate', {
    name: 'YouTube',
    purpose: 'Bug report follow-up',
    task: 'Collect every open bug in the tracker again and write the report of them.',
    why: 'Separate reading job, parallel.',
  });
  check(
    !r.isError &&
      picked?.name === 'YouTube' &&
      again.state().nodes.some(n => n.name === 'YouTube') &&
      again.state().nodes.find(n => n.id === br.id).status === 'done',
    'a related task under another name starts "YouTube", the idle "bug reporter" stays idle'
  );

  // A parent's `tnai send` to its own sub-agent (agent-mesh.js) is more work from the parent: the
  // result comes back to the parent, with the sub-agent's panel still open (sentByParent) and
  // after it was closed (resend). Seen 2026-10-10: three sub-agents sent back to work this way
  // finished and their lead never heard.
  const sent = [];
  const sentTo = paneId =>
    sent
      .filter(x => x[0] === paneId)
      .map(x => x[1])
      .join('\n');
  let reopened = null,
    rn = 0;
  again.init(
    (channel, payload) => {
      if (channel !== 'graph:spawn') return;
      reopened = payload;
      setTimeout(() => {
        const p = 'resend' + ++rn;
        if (again.attach(payload.nodeId, p, payload.name || 'Helper'))
          again.started(p, 'conversation-' + rn);
      }, 5);
    },
    {
      ptys,
      submit: async (paneId, body) => {
        sent.push([paneId, body]);
        return { ok: true, state: 'sent' };
      },
    }
  );
  again.rootStarted('quartz', 'custom-10', 'Quartz');
  r = await again.call('quartz', 'tnai_delegate', {
    purpose: 'Launch posts',
    task: 'Draft the three launch posts and the note to the early accounts.',
    why: 'Separate writing job, parallel.',
  });
  const helperId = again.state().nodes.find(n => n.paneId === 'resend1')?.id;
  const helper = () => again.state().nodes.find(n => n.id === helperId);
  again.onEvent('resend1', { kind: 'ready' });
  again.onEvent('quartz', { kind: 'stop', text: '' });
  again.onEvent('resend1', { kind: 'stop', text: 'Posts drafted.' });
  check(!r.isError && /Posts drafted/.test(sentTo('quartz')), 'a delegated task reports back');
  again.onEvent('quartz', { kind: 'stop', text: '' });

  // its panel is still open
  check(
    again.sentByParent('quartz', 'resend1') === true &&
      again.sentByParent('resend1', 'quartz') === false,
    'only a message from its own parent is marked as the parent’s work'
  );
  again.onEvent('resend1', {
    kind: 'prompt',
    text: '[from Claude Code · Quartz] make them shorter',
  });
  check(helper().status === 'working', 'the sub-agent a parent sent more work is working again');
  again.onEvent('resend1', { kind: 'stop', text: 'Shorter now.' });
  check(
    /Shorter now/.test(sentTo('quartz')),
    'the result of work its parent sent with `tnai send` comes back to the parent'
  );
  again.onEvent('quartz', { kind: 'stop', text: '' });
  again.onEvent('resend1', { kind: 'prompt', text: 'the user asks for a title' });
  again.onEvent('resend1', { kind: 'stop', text: 'Title for the user.' });
  again.sentByParent('quartz', 'resend1');
  again.sentByParent('quartz', 'resend1', false);
  again.onEvent('resend1', { kind: 'prompt', text: 'typed by the user after a failed send' });
  again.onEvent('resend1', { kind: 'stop', text: 'Second thing for the user.' });
  check(
    !/for the user/.test(sentTo('quartz')),
    'what the user typed there stays the user’s, also after a message that was not delivered'
  );

  // its panel was closed
  again.removed('resend1');
  check(
    again.resend('nobody', 'Helper', 'x') === null &&
      again.resend('quartz', 'Stranger', 'x') === null,
    'a name that is not a closed sub-agent of the sender is left to the general revive'
  );
  const back = again.resend('quartz', 'helper', 'Add a fourth post for the forum.');
  const came = back ? await back : null;
  check(
    came?.ok === true && reopened?.resumeId === 'conversation-1' && helper().paneId === 'resend2',
    'a closed sub-agent its parent messages comes back as its sub-agent, on its old conversation'
  );
  again.onEvent('resend2', { kind: 'ready' });
  check(
    /Revived for a related task from Quartz: Add a fourth post/.test(sentTo('resend2')),
    'the message is its task'
  );
  again.onEvent('quartz', { kind: 'stop', text: '' });
  again.onEvent('resend2', { kind: 'stop', text: 'Fourth post drafted.' });
  check(
    /Fourth post drafted/.test(sentTo('quartz')),
    'the result of a closed sub-agent sent back to work comes back to the parent'
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})();
