// Technically Not tools · workflow-card-test.js — the workflow card's data (171): the Claude Code
// reader finds a Workflow call, its run id and its end (desktop/thread-log-claude.js), the run's
// journal becomes one helper per started agent (desktop/workflow-runs.js), and a helper's own
// conversation is found inside the run's folder. Lines shaped like a real run of 2026-10-21.
// Run: node tools/workflow-card-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const claude = require('../desktop/thread-log-claude');
const runs = require('../desktop/workflow-runs');
const threadLog = require('../desktop/thread-log');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const SCRIPT =
  "export const meta = {\n  name: 'record-sample',\n  description: 'Tiny two-phase sample run',\n" +
  "  phases: [{ title: 'Map', detail: 'one helper' }, { title: \"Build\" }],\n}\nphase('Map')";

const callLine = JSON.stringify({
  type: 'assistant',
  isSidechain: false,
  timestamp: '2026-10-22T01:05:38.671Z',
  message: {
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'Workflow', input: { script: SCRIPT } }],
  },
});
const resultLine = JSON.stringify({
  type: 'user',
  isSidechain: false,
  message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'launched' }] },
  toolUseResult: {
    status: 'async_launched',
    taskId: 'w3vtfxm4y',
    taskType: 'local_workflow',
    runId: 'wf_50427182-00d',
  },
});
const endLine = JSON.stringify({
  type: 'user',
  isSidechain: false,
  timestamp: '2026-10-22T01:05:51.005Z',
  message: {
    content:
      '<task-notification>\n<task-id>w3vtfxm4y</task-id>\n<status>completed</status>\n</task-notification>',
  },
});

// 1. the reader
const [act, result, end] = claude.entries([callLine, resultLine, endLine]);
check(act?.kind === 'act' && act.tool === 'Workflow', 'the call is an action of the Workflow tool');
check(act?.verb === 'Started a workflow' && act.what === 'record-sample', 'its words name it');
check(act?.workflow?.description === 'Tiny two-phase sample run', 'the description is read');
check(
  JSON.stringify(act?.workflow?.phases) === '["Map","Build"]',
  'both quote kinds of phase title are read, in order'
);
check(
  result?.runId === 'wf_50427182-00d' && result.taskId === 'w3vtfxm4y',
  'the run id and task id'
);
check(
  end?.taskId === 'w3vtfxm4y' && end.status === 'completed',
  'the end names its task and status'
);
const odd = claude.entries([
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: '' }] },
    toolUseResult: { taskType: 'local_workflow', runId: '../../etc' },
  }),
]);
check(!odd[0]?.runId, 'a run id that is not wf_… is refused');
check(
  claude.entries([
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 't2', name: 'Workflow', input: { script: 'x()' } }],
      },
    }),
  ])[0]?.workflow?.phases?.length === 0,
  'a script without meta gives no phases and no error'
);

// 2. the journal
const journal = [
  '{"type":"launched"}',
  '{"type":"started","agentId":"a1","label":"map: sample","phase":"Map"}',
  '{"type":"result","agentId":"a1","result":"mapped"}',
  '{"type":"started","agentId":"a2","label":"build: sample","phase":"Build"}',
  'not json',
  '{"type":"result","agentId":"zz","result":"stray"}',
];
const helpers = runs.helpersOf(journal);
check(helpers.length === 2, 'one helper per started agent');
check(helpers[0].state === 'done' && helpers[1].state === 'working', 'states from the results');
check(helpers[0].label === 'map: sample' && helpers[1].phase === 'Build', 'labels and phases kept');

// 3. a run on disk: read, and a helper's conversation found by its id
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-wf-'));
const cwd = path.join(home, 'proj');
const record = { agent: 'Claude Code', sessionId: 'sess1', cwd, accountDir: home };
const folder = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
fs.mkdirSync(path.join(folder, 'sess1', 'subagents', 'workflows', 'wf_run1'), { recursive: true });
fs.writeFileSync(path.join(folder, 'sess1.jsonl'), callLine + '\n');
const runDir = path.join(folder, 'sess1', 'subagents', 'workflows', 'wf_run1');
fs.writeFileSync(
  path.join(runDir, 'journal.jsonl'),
  '{"type":"started","agentId":"a34833c11170cbed8","label":"map: sample","phase":"Map"}\n' +
    '{"type":"result","agentId":"a34833c11170cbed8","result":"mapped"}\n'
);
fs.writeFileSync(
  path.join(runDir, 'agent-a34833c11170cbed8.jsonl'),
  '{"type":"user","isSidechain":true,"timestamp":"2026-10-22T01:05:43.000Z","message":{"content":"go"}}\n' +
    '{"type":"assistant","isSidechain":true,"timestamp":"2026-10-22T01:05:45.000Z","message":{"content":[{"type":"text","text":"mapped"}]}}\n'
);

// a long helper record (about 2 MB): only its two edges are read, and they still give both times
const filler = '{"type":"attachment","isSidechain":true,"x":"' + 'y'.repeat(200) + '"}\n';
fs.writeFileSync(
  path.join(runDir, 'agent-abbbbbbbbbbbbbbbb.jsonl'),
  '{"type":"user","isSidechain":true,"timestamp":"2026-10-22T02:00:00.000Z"}\n' +
    filler.repeat(10000) +
    '{"type":"assistant","isSidechain":true,"timestamp":"2026-10-22T02:10:00.000Z"}\n'
);
fs.appendFileSync(
  path.join(runDir, 'journal.jsonl'),
  '{"type":"started","agentId":"abbbbbbbbbbbbbbbb","label":"long","phase":"Map"}\n' +
    '{"type":"result","agentId":"abbbbbbbbbbbbbbbb","result":"x"}\n'
);

(async () => {
  const read = await runs.read(record, 'wf_run1');
  check(read.ok && read.helpers.length === 2, 'the run is read from the session folder');
  check(
    read.helpers[0]?.endedAt - read.helpers[0]?.startedAt === 2000,
    'times from its own record'
  );
  check(
    read.helpers[1]?.endedAt - read.helpers[1]?.startedAt === 600000,
    'a 2 MB record gives its times from its first and last bytes'
  );
  check(!(await runs.read(record, '../x')).ok, 'a bad run id reads nothing');
  check(
    (await runs.read(record, 'wf_none')).helpers?.length === 0,
    'a run with no journal yet has no helpers'
  );

  // watching never makes a folder in Claude Code's own record, and a refused watch says so
  check(
    runs.watch(record, 'wf_none', () => {}) === null,
    'a run folder that is not there is not watched'
  );
  check(!fs.existsSync(path.join(runDir, '..', 'wf_none')), 'and no folder is made for it');
  const stop = runs.watch(record, 'wf_run1', () => {});
  check(typeof stop === 'function', 'a run folder that is there is watched');
  stop?.();

  const subPath = threadLog.fileFor(record, { sub: 'a34833c11170cbed8' });
  check(
    subPath === path.join(runDir, 'agent-a34833c11170cbed8.jsonl'),
    "a workflow helper's record is found"
  );
  fs.rmSync(home, { recursive: true, force: true });

  // the meta block alone is read: a later "description:" and a "]" inside a phase's words
  const tricky = claude.entries([
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't3',
            name: 'Workflow',
            input: {
              script:
                "export const meta = {\n  name: 'tricky',\n  phases: [{ title: 'A', detail: 'list [x] here' }, { title: 'B' }],\n}\n" +
                "await agent('go', { description: 'not the workflow' })",
            },
          },
        ],
      },
    }),
  ])[0];
  check(tricky?.workflow?.description === '', 'a description after the meta block is not taken');
  check(
    JSON.stringify(tricky?.workflow?.phases) === '["A","B"]',
    'a "]" inside a phase\'s words does not cut the list'
  );

  // the card's code
  const source = fs.readFileSync(
    path.join(__dirname, '../src/scripts/171-workflow-card.js'),
    'utf8'
  );
  check(
    /tnai:thread-helper/.test(source),
    "a row opens the helper's conversation the way 123 does"
  );
  check(!/setInterval/.test(source), 'nothing is polled');
  check(
    /new WeakMap\(\)[\s\S]*byAct/.test(source) || /byAct = new WeakMap/.test(source),
    'cards are kept per conversation view'
  );
  const runsSource = fs.readFileSync(path.join(__dirname, '../desktop/workflow-runs.js'), 'utf8');
  check(!/mkdirSync/.test(runsSource), 'the run reader never makes a folder');
  check(!/readFileSync/.test(runsSource), 'the run reader reads nothing on the main loop');

  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
