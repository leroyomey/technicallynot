/*
 * Technically Not tools · desktop-check/compact-tasks-check.js — After a compact, a Claude Code
 * agent's finished sub-agents and background commands leave its list (issue sweep 2026-10-14, item
 * 12). Plain Node, no window, no CLI: part 1 feeds desktop/agent-turns.js a lead transcript excerpt
 * in the shape Claude Code 2.1.x writes at a compact (a compact_boundary line, then one
 * task_status attachment per background task it still holds) and checks the events it sends; part
 * 2 loads src/scripts/19-agent-team.js with a stub window and checks that those events end the
 * right entries and keep the rest. Usage: node tools/desktop-check/compact-tasks-check.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const turns = require('../../desktop/agent-turns');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// Part 2's stand-in for the window: just enough for 19 to load and keep its lists. Every DOM call
// returns a harmless stub.
function loadTeam() {
  const stub = new Proxy(function () {}, {
    get: (target, key) => (key === Symbol.toPrimitive ? () => '' : stub),
    apply: () => stub,
    construct: () => stub,
  });
  let receive = null;
  const window = {
    tnaiNative: {
      agentEvents: {
        on: cb => {
          receive = cb;
        },
        history: () => Promise.resolve([]),
      },
      agentTurns: { state: () => Promise.resolve([]) },
    },
    TnaiAgents: { sessions: () => [] },
    addEventListener() {},
    dispatchEvent() {},
  };
  const context = {
    window,
    document: stub,
    CustomEvent: function () {},
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: cb => setTimeout(cb, 0),
    Promise,
    Map,
    Set,
    Date,
    JSON,
    Math,
  };
  const file = path.join(__dirname, '..', '..', 'src', 'scripts', '19-agent-team.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { team: window.TnaiTeam, send: e => receive(e) };
}

(async () => {
  // Part 1. The lead's transcript at a compact. Shapes copied from real logs of 2026-09/10 (ids
  // and paths shortened): one background command still running, one background sub-agent whose
  // hand-back came while it compacted ("completed").
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-compact-'));
  const tx = path.join(tmp, 'lead.jsonl');
  fs.writeFileSync(tx, '');
  const sent = [];
  turns.init(() => {}, { compactTasks: (paneId, event) => sent.push({ paneId, ...event }) });
  const P = 'c1';
  const hook = h => turns.claudeHook(P, { transcript_path: tx, ...h });
  const compactAt = '2026-10-06T09:00:00.000Z';
  const task = (taskId, taskType, status, description) => ({
    parentUuid: 'x',
    isSidechain: false,
    attachment: {
      type: 'task_status',
      taskId,
      taskType,
      description,
      status,
      deltaSummary: null,
      outputFilePath: 'C:\\Temp\\claude\\tasks\\' + taskId + '.output',
    },
    type: 'attachment',
    timestamp: compactAt,
  });
  const excerpt = [
    {
      parentUuid: null,
      isSidechain: false,
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      level: 'info',
      compactMetadata: { trigger: 'manual', preTokens: 626574, postTokens: 12489 },
      timestamp: compactAt,
    },
    {
      type: 'user',
      isSidechain: false,
      message: { role: 'user', content: 'This session is being continued from a previous ...' },
    },
    task('bkeep01', 'local_bash', 'running', 'Watch the build'),
    task('adone0000000000001', 'local_agent', 'completed', 'Prove readers on real records'),
    // a sub-agent's own record is never the lead's list
    { ...task('aside00000000000001', 'local_agent', 'completed', 'x'), isSidechain: true },
  ];
  turns.started(P, 'Claude Code', '', '');
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'Keep going' });
  fs.appendFileSync(tx, excerpt.map(r => JSON.stringify(r)).join('\n') + '\n');
  hook({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
  await wait(100);
  const ends = sent.filter(e => e.kind === 'bg-end');
  check(
    ends.length === 1 && ends[0].taskId === 'adone0000000000001' && ends[0].status === 'completed',
    'a task listed "completed" after the compact ends at once (bg-end), sidechain lines ignored'
  );
  check(!sent.some(e => e.kind === 'bg-sweep'), 'the full list waits for the burst to be in');
  await wait(2300);
  const sweep = sent.find(e => e.kind === 'bg-sweep');
  check(
    !!sweep &&
      sweep.paneId === P &&
      sweep.running.join() === 'bkeep01' &&
      sweep.before === Date.parse(compactAt),
    'then one bg-sweep with the tasks still running and the compact time (' +
      JSON.stringify(sweep || null) +
      ')'
  );
  turns.forget(P);
  fs.rmSync(tmp, { recursive: true, force: true });

  // Part 2. The list in 19: entries from before the compact, then the events part 1 produced.
  const { team, send } = loadTeam();
  team.retireAfter = 0;
  await wait(10);
  const L = 'lead1',
    before = Date.parse(compactAt) - 3600e3,
    after = Date.parse(compactAt) + 60e3;
  let seq = 0;
  const ev = (at, e) => send({ paneId: L, seq: ++seq, at, ...e });
  const spawn = (id, toolUseId, at) => {
    ev(at, {
      kind: 'spawn',
      toolUseId,
      type: 'general-purpose',
      description: id,
      background: true,
    });
    ev(at, { kind: 'sub-start', agentId: id, agentType: 'general-purpose' });
    ev(at, { kind: 'spawn-result', toolUseId, result: { agentId: id, async: true } });
  };

  // the case of the user report: two background sub-agents and two background commands, all
  // finished during the compact, plus ones that still run and ones started after it
  spawn('aold1', 't1', before);
  spawn('aold2', 't2', before);
  spawn('arun1', 't3', before);
  spawn('adone0000000000001', 't4', before);
  for (const id of ['bold1', 'bold2', 'bkeep01'])
    ev(before, { kind: 'bg-start', taskId: id, tool: 'Bash', detail: id });
  ev(before, { kind: 'bg-start', taskId: 'bsub1', agentId: 'arun1', tool: 'Bash', detail: 'sub' });
  spawn('anew1', 't5', after);
  ev(after, { kind: 'bg-start', taskId: 'bnew1', tool: 'Bash', detail: 'new' });
  check(team.open(L).bg === 5, 'before: 5 background sub-agents open (' + team.open(L).bg + ')');

  // a mid-turn hand-back of a sub-agent (taskNote's bg-end) ends the sub-agent too
  ev(after, { kind: 'bg-end', taskId: 'adone0000000000001', status: 'completed' });
  check(team.open(L).bg === 4, 'bg-end with a sub-agent id ends that sub-agent');
  ev(after, { kind: 'bg-sweep', running: ['bkeep01', 'arun1'], before: Date.parse(compactAt) });
  await wait(20);
  const left = team
    .background(L)
    .map(b => b.taskId)
    .sort()
    .join();
  check(team.open(L).bg === 2, 'after the sweep: the running and the new sub-agent stay (2)');
  check(
    left === 'bkeep01,bnew1,bsub1',
    'background commands: the finished ones end; running, new and a sub-agent’s own stay (' +
      left +
      ')'
  );

  console.log(ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})();
