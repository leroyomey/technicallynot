/*
 * Technically Not tools · thread-log-test.js — the thread log (desktop/thread-log.js) and its
 * Claude Code reader (desktop/thread-log-claude.js) in plain Node, no window and no CLI:
 * `node tools/thread-log-test.js`.
 *
 * The lines below are made up, in the shapes a real Claude Code 2.1 transcript has (read from a
 * real one on 2026-10-11): the prompt with the app's mark, a slash command, the agent's words, an
 * edit with its patch, a new file, a command that fails, a question, a sub-agent's own lines, the
 * task's length. Then the reading of the file: only whole lines, only what is new, a file that got
 * shorter, and a long old conversation of which only the end is read, timed.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../desktop/thread-log');
const claude = require('../desktop/thread-log-claude');

let failed = 0;
let count = 0;
const check = (cond, label) => {
  count++;
  if (!cond) failed++;
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
};

const CWD = 'C:\\work\\shop';
const at = second => new Date(Date.UTC(2026, 9, 11, 12, 0, second)).toISOString();
const user = (content, more = {}) => ({
  type: 'user',
  cwd: CWD,
  timestamp: at(1),
  message: { role: 'user', content },
  ...more,
});
const assistant = (content, second = 2) => ({
  type: 'assistant',
  cwd: CWD,
  timestamp: at(second),
  message: { id: 'msg_1', model: 'claude-haiku-5-5', role: 'assistant', content },
});
const result = (id, more, toolUseResult) =>
  user([{ type: 'tool_result', tool_use_id: id, content: 'done', ...more }], { toolUseResult });

const LINES = [
  { type: 'permission-mode', permissionMode: 'default' },
  user('<local-command-caveat>The command below was run directly.</local-command-caveat>', {
    isMeta: true,
  }),
  user(
    '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>haiku</command-args>'
  ),
  user('<local-command-stdout>Set model to Haiku</local-command-stdout>'),
  user('[TN.ai] Fix the cart total.\n<system-reminder>ignore me</system-reminder>'),
  { type: 'ai-title', aiTitle: 'Fix the cart total' },
  assistant([{ type: 'thinking', thinking: 'private' }]),
  assistant([{ type: 'text', text: 'I will look at **cart.js** first.' }]),
  assistant([
    { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: CWD + '\\src\\cart.js' } },
  ]),
  result('t1', {}, { type: 'text', file: { filePath: CWD + '\\src\\cart.js' } }),
  assistant([
    {
      type: 'tool_use',
      id: 't2',
      name: 'Edit',
      input: { file_path: CWD + '\\src\\cart.js', old_string: 'a', new_string: 'b' },
    },
  ]),
  result(
    't2',
    {},
    {
      filePath: CWD + '\\src\\cart.js',
      structuredPatch: [
        { lines: [' keep', '-old one', '-old two', '+new one', '+new two', '+new three'] },
      ],
    }
  ),
  assistant([
    {
      type: 'tool_use',
      id: 't3',
      name: 'Write',
      input: { file_path: CWD + '\\notes.txt', content: 'a\nb\n' },
    },
  ]),
  result(
    't3',
    {},
    { type: 'create', filePath: CWD + '\\notes.txt', content: 'a\nb\n', structuredPatch: [] }
  ),
  assistant([
    {
      type: 'tool_use',
      id: 't4',
      name: 'Bash',
      input: { command: 'npm test\necho done', description: 'Run the tests' },
    },
  ]),
  result(
    't4',
    { is_error: true },
    { stdout: 'line one\n2 failed, 12 passed\n', stderr: '', interrupted: false }
  ),
  assistant([
    {
      type: 'tool_use',
      id: 't5',
      name: 'AskUserQuestion',
      input: {
        questions: [
          { question: 'Which total?', options: [{ label: 'With tax' }, { label: 'Without tax' }] },
        ],
      },
    },
  ]),
  assistant([
    {
      type: 'tool_use',
      id: 't6',
      name: 'Agent',
      input: { description: 'Check the tests', prompt: 'p' },
    },
  ]),
  { ...assistant([{ type: 'text', text: 'inner step of the sub-agent' }]), isSidechain: true },
  result('t6', {}, { isAsync: true, status: 'async_launched' }),
  assistant([{ type: 'tool_use', id: 't7', name: 'mcp__tnai__tnai_delegate', input: {} }]),
  user('[from Moss · Claude Code] The build is red.'),
  user('[Request interrupted by user]'),
  assistant([{ type: 'text', text: 'Done.\n\nTechnically Not report\n- Did: fixed the total' }], 9),
  { type: 'system', subtype: 'turn_duration', durationMs: 9571, timestamp: at(10) },
  { type: 'system', subtype: 'stop_hook_summary' },
  'this line is not JSON',
].map(line => (typeof line === 'string' ? line : JSON.stringify(line)));

// ---------- the reader ----------
const got = claude.entries(LINES);

// A sub-agent's answer to its lead comes as a tool call, not as text: it is shown as its words.
{
  const handed = claude.entries(
    [
      assistant([
        {
          type: 'tool_use',
          id: 'h1',
          name: 'SubagentHandback',
          input: { message: 'All three ran.' },
        },
      ]),
      result('h1'),
    ].map(line => (typeof LINES[0] === 'string' ? JSON.stringify(line) : line))
  );
  check(
    handed.some(entry => entry.kind === 'say' && entry.text === 'All three ran.') &&
      !handed.some(entry => entry.kind === 'act'),
    "a sub-agent's handed-back message is its own words, not an action (" +
      handed.map(entry => entry.kind).join(' ') +
      ')'
  );
}
const kinds = got.map(entry => entry.kind).join(' ');
check(
  kinds ===
    'note note you title say act result act result act result act result ask act result act from note say worked',
  'every line becomes the right kind of entry, in order: ' + kinds
);
const byId = id => got.filter(entry => entry.id === id);
check(
  got[0].text === 'You ran /model haiku',
  'a slash command is a small note: "' + got[0].text + '"'
);
check(
  got[1].kind === 'note' && got[1].text === 'Set model to Haiku',
  'what a command such as /model answered is one quiet note: "' + got[1].text + '"'
);
check(
  got[2].text === 'Fix the cart total.',
  "the prompt is the user's words: the app's mark and the CLI's reminder are taken off (\"" +
    got[2].text +
    '")'
);
check(
  got[3].kind === 'title' && got[3].text === 'Fix the cart total',
  "the tool's own title is kept"
);
check(
  got[4].text === 'I will look at **cart.js** first.' && got[4].model === 'claude-haiku-5-5',
  "the agent's words are kept as written, with the model that wrote them"
);
check(
  !got.some(entry => /private/.test(JSON.stringify(entry))),
  'its thinking is never handed over'
);
check(
  !got.some(entry => /inner step/.test(JSON.stringify(entry))),
  "a sub-agent's own inner lines are left out"
);
{
  const [act] = byId('t1');
  check(
    act.verb === 'Read' && act.what === 'src/cart.js',
    'Read names the file from the project folder on: ' + act.what
  );
}
{
  const [act, res] = byId('t2');
  check(
    act.verb === 'Edited' && res.added === 3 && res.removed === 2 && !res.failed,
    'an edit counts its lines from the recorded patch: +' + res.added + ' -' + res.removed
  );
}
{
  const [act, res] = byId('t3');
  check(
    act.verb === 'Wrote' && act.what === 'notes.txt' && res.created && res.added === 2,
    'a new file counts every line of it: +' + res.added
  );
}
{
  const [act, res] = byId('t4');
  check(
    act.verb === 'Ran' && act.what === 'npm test' && act.note === 'Run the tests',
    'a command shows its first line and its description'
  );
  check(
    res.failed && res.text === '2 failed, 12 passed',
    'a failed command says so, with its last line: "' + res.text + '"'
  );
  check(
    typeof act.full === 'string' && act.full.startsWith(act.what),
    'the whole command is kept beside its first line, for the view that shows it behind a press'
  );
  check(
    res.more === undefined || (res.more.endsWith(res.text) && res.more.length > res.text.length),
    'what a command printed is kept whole only when it is more than its last line (' +
      (res.more === undefined ? 'one line here' : res.more.split('\n').length + ' lines') +
      ')'
  );
}

// ---------- what the app adds around a prompt ----------
{
  const { promptEntries } = require('../desktop/thread-log-text');
  const LEFTOVER =
    '[Technically Not: agents not working right now in this project: Ash (Claude Code, left over from the last Technically Not session, last task: "Claude Code"). You lead: first decide which of them this task needs. When unsure, leave it.]';
  const SKILLS = '(Skills attached to you for this session: tnai-modern-ui. Keep following them.)';
  const BUSY =
    '[New task while you work on "the cart"] If it belongs to that work, fold it in. If it is unrelated, handle it the way you judge best without dropping your current work. New task: ';
  const OWN = '[This task builds on your own earlier result, from "Fix the cart total"] ';

  // an attached picture is a tile under the words, not its path in them (182, 2026-10-24)
  const [withPicture] = promptEntries(
    '[TN.ai] Look here [Attached image: C:\\Users\\me\\attachments\\shot-1.png] please',
    0
  );
  check(
    withPicture.text === 'Look here please' &&
      withPicture.pictures?.join() === 'C:\\Users\\me\\attachments\\shot-1.png',
    'an attached picture is kept apart from the words: ' + JSON.stringify(withPicture)
  );

  // a helper's report handed back to its lead is a report, not the user's words (182)
  const handBack = {
    type: 'attachment',
    timestamp: '2026-10-24T10:00:00Z',
    attachment: {
      type: 'queued_command',
      commandMode: 'prompt',
      prompt:
        '<agent-message from="aa3d92409b">\n[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  **Done:** the guide.\n  1. One (https://example.com/a)\n     - nested\n</agent-message>',
    },
  };
  const [report] = claude.entries([JSON.stringify(handBack)], null);
  check(
    report?.kind === 'report' &&
      report.fromId === 'aa3d92409b' &&
      report.text === '**Done:** the guide.\n1. One (https://example.com/a)\n   - nested',
    'a hand-back is a report without its frame and indent: ' + JSON.stringify(report)
  );

  const [plain] = promptEntries('[TN.ai] test\n\n' + LEFTOVER, 0);
  check(
    plain.kind === 'you' && plain.text === 'test' && plain.added.join() === LEFTOVER,
    'the note about agents that are not working is kept apart from the user\'s word ("' +
      plain.text +
      '", ' +
      plain.added.length +
      ' added)'
  );
  const [full] = promptEntries(
    '[TN.ai] ' + BUSY + OWN + 'Fix [the] total.\n\n' + LEFTOVER + '\n\n' + SKILLS,
    0
  );
  check(
    full.text === 'Fix [the] total.' &&
      full.added.length === 4 &&
      full.added[0] === BUSY.trim() &&
      full.added[1] === OWN.trim() &&
      full.added[2] === LEFTOVER &&
      full.added[3] === SKILLS,
    'four additions around one prompt are taken off in their order, and the user\'s own square brackets stay ("' +
      full.text +
      '", ' +
      full.added.length +
      ' added)'
  );
  const [own] = promptEntries('Why [Technically Not: is this] here? (Skills are fun)', 0);
  check(
    own.text === 'Why [Technically Not: is this] here? (Skills are fun)' && own.added === undefined,
    'words the user typed that only look like an addition are left alone'
  );
  const [from] = promptEntries('[from Moss · Claude Code] The build is red.\n\n' + SKILLS, 0);
  check(
    from.kind === 'from' && from.text === 'The build is red.' && from.added.length === 1,
    'a message from another agent keeps its words, with the addition beside them'
  );
  const only = promptEntries('[TN.ai] \n\n' + LEFTOVER, 0);
  check(
    only.length === 1 && only[0].text === '' && only[0].added.length === 1,
    'a prompt that holds only an addition has no words of the user'
  );

  // Two decisions pressed on a result, pasted as one block
  const [two] = promptEntries(
    '<pasted_content id="9cf4">\n[TN.ai] [This task builds on your own earlier result, from "[TN.ai] Wake up."] ' +
      'Decision on "Decision 1 of 2: Make a new share picture whose words match the page title ("One workspace")?" ' +
      'from Rook’s result 8b1f0a8e (task: Wake up.): go with Yes, new picture under a new file name\n' +
      'Full result: `tnai context show 8b1f0a8e`\n\n' +
      'Decision on "Decision 2 of 2: Rebuild the 404 page (it would lose the old menu search)?" ' +
      'from Rook’s result 8b1f0a8e (task: Wake up.): go with Not now, its links are fixed\n' +
      'Full result: `tnai context show 8b1f0a8e`\n</pasted_content id="9cf4">',
    0
  );
  check(
    two.text ===
      'Decision 1 of 2: Yes, new picture under a new file name\n\nDecision 2 of 2: Not now, its links are fixed' &&
      two.added.length === 2 &&
      two.added[1].includes('Full result: `tnai context show 8b1f0a8e`'),
    'pressed decisions show only their choices, the rest is kept apart ("' + two.text + '")'
  );

  // A decision whose source task was itself a decision, with brackets inside
  const [nested] = promptEntries(
    '[TN.ai] Decision on "Push one commit (the README), then start the Mac check?" from Launch Lead’s result 23e54d58 ' +
      '(task: Decision on "What should I do next?" from Launch Lead’s result b276d58e (task: (no instructions)): go with Look into why): ' +
      'go with Yes, once the other agents are idle\nFull result: `tnai context show 23e54d58`',
    0
  );
  check(
    nested.text === 'Yes, once the other agents are idle',
    'a decision about a decision shows only the choice ("' + nested.text + '")'
  );
  const [fix] = promptEntries(
    'Fix this issue from Ash’s result 1a2b3c4d (task: the cart): total is wrong\nFull result: `tnai context show 1a2b3c4d`',
    0
  );
  check(
    fix.text === 'Fix this issue: total is wrong',
    'a pressed follow-up loses where it came from ("' + fix.text + '")'
  );
  const [typed] = promptEntries('Decision on "lunch": pizza, from Ash’s result as I said', 0);
  check(
    typed.text === 'pizza, from Ash’s result as I said',
    'a decision typed by hand still shows its choice ("' + typed.text + '")'
  );
}
{
  const [ask] = byId('t5');
  check(
    ask.kind === 'ask' &&
      ask.questions[0].question === 'Which total?' &&
      ask.questions[0].options.join('|') === 'With tax|Without tax',
    'a question keeps its words and its choices'
  );
}
check(
  byId('t6')[1].text === 'Runs in the background',
  'a sub-agent started in the background says so'
);
check(
  byId('t7')[0].what === 'tnai · tnai_delegate',
  'an unknown tool is named plainly: ' + byId('t7')[0].what
);
{
  const from = got.find(entry => entry.kind === 'from');
  check(
    from.who === 'Moss · Claude Code' && from.text === 'The build is red.',
    'a message from another agent is its own kind, with who sent it'
  );
}
check(
  got.some(entry => entry.kind === 'note' && entry.text === 'You interrupted it'),
  'an interrupt is a note'
);
check(
  got[got.length - 1].ms === 9571,
  "the task's length is the CLI's own number: " + got[got.length - 1].ms + ' ms'
);

// ---------- the Codex reader ----------
// Made-up lines in the shapes of real Codex rollouts read on 2026-10-11: the newer form
// (`item_completed` items) and the older one (`user_message` / `agent_message` events).
{
  const codex = require('../desktop/thread-log-codex');
  const event = (payload, second = 1) =>
    JSON.stringify({ timestamp: at(second), type: 'event_msg', payload });
  const item = (body, second) => event({ type: 'item_completed', item: body }, second);
  const said = text => [{ type: 'Text', text }];
  const rollout = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'abc', cwd: CWD } }),
    event({ type: 'task_started', turn_id: 't' }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'developer',
        content: [{ type: 'input_text', text: 'rules' }],
      },
    }),
    item({
      type: 'UserMessage',
      id: 'u1',
      content: [{ type: 'text', text: '[TN.ai] Run the tests.' }],
    }),
    item({ type: 'Reasoning', id: 'r1', summary_text: ['private'] }),
    item({
      type: 'CommandExecution',
      id: 'c1',
      command: ['pwsh.exe', '-Command', 'npm test'],
      parsed_cmd: [{ type: 'unknown', cmd: 'npm test' }],
      aggregated_output: 'line one\r\n2 failed, 12 passed\r\n',
      exit_code: 1,
      status: 'completed',
    }),
    item({
      type: 'McpToolCall',
      id: 'm1',
      server: 'tnai',
      tool: 'tnai_subagents',
      status: 'completed',
      result: { content: [{ type: 'text', text: 'No sub-agents.' }] },
    }),
    item({
      type: 'AgentMessage',
      id: 'a1',
      content: said('Two tests fail.'),
      phase: 'final_answer',
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Two tests fail.' }],
      },
    }),
    event({ type: 'task_complete', duration_ms: 7147 }, 9),
    event({ type: 'user_message', message: '[from Moss · Claude Code] ping' }),
    event({ type: 'agent_message', message: 'pong' }),
  ];
  const got = codex.entries(rollout);
  const kinds = got.map(entry => entry.kind).join(' ');
  check(
    kinds === 'you act result act result say worked from say',
    'Codex: every line becomes the right kind of entry, in order: ' + kinds
  );
  check(got[0].text === 'Run the tests.', 'Codex: the prompt is the words the user wrote');
  check(
    got[1].verb === 'Ran' && got[1].what === 'npm test' && got[2].id === got[1].id,
    'Codex: a command is shown in its short form, and its result carries the same id'
  );
  check(
    got[2].failed && got[2].text === '2 failed, 12 passed',
    'Codex: a command that ends with a code other than 0 says so, with its last line'
  );
  check(
    got[3].what === 'tnai · tnai_subagents' && got[4].text === 'No sub-agents.',
    'Codex: a tool of a connected server is named with what it answered'
  );
  check(
    got.filter(entry => entry.text === 'Two tests fail.').length === 1,
    'Codex: the words Codex repeats for the model are not shown twice'
  );
  check(
    !got.some(entry => /private|rules/.test(JSON.stringify(entry))),
    'Codex: reasoning and its own rules are left out'
  );
  check(got[6].ms === 7147, 'Codex: the length of the task is the number Codex recorded');
  check(
    got[7].kind === 'from' && got[8].text === 'pong',
    'Codex: the older form of the two sides is read too'
  );

  // where the rollout is: by the session id at the end of its name, newest folders first
  const codexHome = path.join(os.tmpdir(), 'tnai-thread-log-codex-' + process.pid);
  const day = path.join(codexHome, 'sessions', '2026', '10', '11');
  fs.mkdirSync(day, { recursive: true });
  const file = path.join(day, 'rollout-2026-10-11T12-00-00-abc-123.jsonl');
  fs.writeFileSync(file, rollout.join('\n') + '\n');
  const record = { agent: 'Codex', sessionId: 'abc-123', accountDir: codexHome };
  check(
    codex.fileFor(record, { env: {}, home: codexHome }) === file,
    'Codex: the rollout is found from the session id in its file name'
  );
  check(
    codex.fileFor({ ...record, sessionId: 'none' }, { env: {}, home: codexHome }) === '',
    'Codex: a session with no rollout yet has none'
  );
  fs.rmSync(codexHome, { recursive: true, force: true });

  // shapes read in real rollouts on 2026-10-12: a patch keyed by file path, a web search, a compact
  const real = [
    item({
      type: 'FileChange',
      id: 'p1',
      status: 'completed',
      changes: {
        [CWD + '\\src\\cart.js']: {
          type: 'update',
          unified_diff: '@@ -1,2 +1,3 @@\n-old\n+new\n+more\n same\n',
          move_path: null,
        },
        [CWD + '\\notes.txt']: { type: 'add', content: 'one\ntwo\n' },
      },
    }),
    item({
      type: 'FileChange',
      id: 'p2',
      status: 'completed',
      changes: { [CWD + '\\notes.txt']: { type: 'add', content: 'one\ntwo\n' } },
    }),
    item({
      type: 'Extension',
      kind: 'web.search',
      id: 'w1',
      query: 'cart tax rules',
      action: { type: 'search', query: null, queries: ['cart tax rules'] },
      results: [{ title: 'x' }, { title: 'y' }],
    }),
    item({ type: 'ContextCompaction', id: 'c1' }),
    event({ type: 'turn_aborted' }),
  ];
  const seen = codex.entries(real, { cwd: CWD });
  check(
    seen.map(entry => entry.kind).join(' ') === 'act result act result act result note note',
    'Codex: a patch, a web search, a compact and a stopped task each become entries'
  );
  check(
    seen[0].verb === 'Edited' && seen[0].what === 'src/cart.js, notes.txt',
    'Codex: a patch keyed by file path names its files: ' + seen[0].what
  );
  check(
    seen[1].added === 4 && seen[1].removed === 1,
    'Codex: a patch counts its lines from the diff and from the content of a new file'
  );
  check(
    seen[2].verb === 'Wrote' && seen[3].created === true,
    'Codex: a patch that only adds files is "Wrote" and created'
  );
  check(
    seen[4].verb === 'Searched the web for' &&
      seen[4].what === 'cart tax rules' &&
      seen[5].text === '2 results',
    'Codex: a web search names its words and how many results'
  );
}

// ---------- the Cursor Agent reader ----------
// Made-up lines in the shapes of the real Cursor Agent transcripts read on 2026-10-11: the prompt
// wrapped in Cursor's tags, text and tool calls in one assistant line, no result of any call.
{
  const cursor = require('../desktop/thread-log-cursor');
  const use = (name, input) => ({ type: 'tool_use', name, input });
  const said = content => JSON.stringify({ role: 'assistant', message: { content } });
  const chat = [
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: '<timestamp>now</timestamp>\n<user_query>\nFix the total.\n</user_query>',
          },
        ],
      },
    }),
    said([
      { type: 'text', text: 'Looking.' },
      use('UpdateCurrentStep', { current_step: 'Reading' }),
      use('Read', { path: CWD + '\\src\\cart.js' }),
      use('StrReplace', {
        path: CWD + '\\src\\cart.js',
        old_string: 'a\nb',
        new_string: 'a\nb\nc',
      }),
      use('Write', { path: CWD + '\\notes.txt', contents: 'one\ntwo\n' }),
      use('Shell', { command: 'npm test' }),
      use(
        'ApplyPatch',
        '*** Begin Patch\n*** Update File: ' +
          CWD +
          '\\src\\tax.js\n-old\n+new\n+more\n*** End Patch'
      ),
      use('AskQuestion', {
        questions: [{ prompt: 'Which total?', options: [{ label: 'With tax' }] }],
      }),
    ]),
    JSON.stringify({ type: 'turn_ended', status: 'success' }),
    JSON.stringify({ type: 'turn_ended', status: 'error', error: 'x' }),
  ];
  const got = cursor.entries(chat, { cwd: CWD });
  const kinds = got.map(entry => entry.kind).join(' ');
  check(
    kinds === 'you say act result act result act result act result act result ask worked note',
    'Cursor Agent: every line becomes the right kind of entry, in order: ' + kinds
  );
  check(
    got[0].text === 'Fix the total.',
    'Cursor Agent: the prompt is taken out of the tags Cursor adds'
  );
  const acts = got.filter(entry => entry.kind === 'act');
  const results = got.filter(entry => entry.kind === 'result');
  check(
    acts.map(act => act.verb + ' ' + act.what).join(' | ') ===
      'Read src/cart.js | Edited src/cart.js | Wrote notes.txt | Ran npm test | Edited src/tax.js',
    'Cursor Agent: actions name the file from the project folder on, or the command'
  );
  check(
    acts.every((act, index) => results[index].id === act.id) &&
      new Set(acts.map(act => act.id)).size === acts.length,
    'Cursor Agent: every action is closed by its own entry (the transcript holds no result to show)'
  );
  check(
    results[1].added === 3 &&
      results[1].removed === 2 &&
      results[2].added === 2 &&
      results[4].added === 2 &&
      results[4].removed === 1,
    'Cursor Agent: line counts are the ones the input states (a replacement, a written file, a patch)'
  );
  check(
    results[3].text === undefined && results[3].failed === false,
    'Cursor Agent: a command has no output to show, and is not called failed'
  );
  check(
    !got.some(entry => /Reading/.test(JSON.stringify(entry))),
    'Cursor Agent: calls it makes for itself are left out'
  );
  check(
    got.find(entry => entry.kind === 'ask').questions[0].question === 'Which total?',
    'Cursor Agent: a question keeps its words'
  );
  check(
    got[got.length - 2].ms === 0,
    'Cursor Agent: a task ends with no length, because none is recorded'
  );

  // shapes read in real transcripts on 2026-10-12: tools called through CallDynamicTool, rg, and a
  // stopped task
  const dynamic = (namespace, toolName, args) =>
    use('CallDynamicTool', { namespace, toolName, arguments: args });
  const more = cursor.entries(
    [
      said([
        dynamic('cursor', 'WebSearch', { search_term: 'tax rules' }),
        dynamic('cursor', 'TodoWrite', { todos: [{ status: 'completed' }, { status: 'pending' }] }),
        dynamic('cursor-ide-browser', 'browser_navigate', { url: 'x' }),
        dynamic('cursor', 'UpdateCurrentStep', {}),
        dynamic('unused', 'unused', {}),
        use('rg', { pattern: 'total' }),
        use('ReadLints', { paths: ['a.js'] }),
        use('CreatePlan', { name: 'Fix total', plan: 'x', todos: [] }),
      ]),
      JSON.stringify({ type: 'turn_ended', status: 'aborted' }),
    ],
    { cwd: CWD }
  );
  const moreActs = more
    .filter(entry => entry.kind === 'act')
    .map(entry => entry.verb + '|' + entry.what);
  check(
    moreActs.join(';') ===
      'Searched the web for|tax rules;Updated its checklist|1 of 2 done;Used|browser_navigate;Searched for|total;Checked for problems|a.js;Made a plan|Fix total',
    'Cursor Agent: tools called through CallDynamicTool and rg are shown as their own tools: ' +
      moreActs.join(';')
  );
  check(
    more[more.length - 1].text === 'The task was stopped',
    'Cursor Agent: a stopped task says it was stopped, not that it failed'
  );
}

// ---------- the GitHub Copilot reader ----------
// Made-up events in the shapes of the schema Copilot CLI 1.0.101 ships
// (schemas/session-events.schema.json), read 2026-10-21: no real conversation on this PC yet.
{
  const copilot = require('../desktop/thread-log-copilot');
  let number = 0;
  const event = (type, data, more = {}) =>
    JSON.stringify({ type, data, id: 'e' + ++number, timestamp: at(number), ...more });
  const events = [
    event('session.start', { sessionId: 's1', context: { cwd: CWD } }),
    event('user.message', { content: 'Make a landing page.' }),
    event('assistant.message', { messageId: 'm1', content: 'Writing it.', model: 'gpt-5.5' }),
    event('tool.execution_start', { toolCallId: 't0', toolName: 'report_intent', arguments: {} }),
    event('tool.execution_start', {
      toolCallId: 't1',
      toolName: 'create',
      arguments: { path: CWD + '\\index.html', file_text: '<h1>Hi</h1>\n<p>x</p>\n' },
    }),
    event('tool.execution_complete', {
      toolCallId: 't1',
      success: true,
      result: { content: 'Created file' },
    }),
    event('tool.execution_start', {
      toolCallId: 't2',
      toolName: 'powershell',
      arguments: { command: 'npm test' },
    }),
    event('tool.execution_complete', {
      toolCallId: 't2',
      success: false,
      error: { message: 'exit code 1' },
    }),
    event('tool.execution_start', {
      toolCallId: 't3',
      toolName: 'view',
      arguments: { path: CWD + '\\a.js' },
      parentToolCallId: 'task-1',
    }),
    event('assistant.message', { messageId: 'm2', content: 'Inside a helper.' }, { agentId: 'a1' }),
    event('user.message', { content: 'skill text', source: 'skill-pdf' }),
    event('tool.execution_start', {
      toolCallId: 't4',
      toolName: 'ask_user',
      arguments: { question: 'Which color?', choices: ['Blue', 'Green'] },
    }),
    event('tool.execution_start', {
      toolCallId: 't5',
      toolName: 'tnai_delegate',
      mcpServerName: 'tnai',
      mcpToolName: 'tnai_delegate',
      arguments: {},
    }),
    event('abort', { reason: 'user_initiated' }),
  ];
  const seen = copilot.entries(events, { cwd: CWD });
  const kinds = seen.map(entry => entry.kind).join(',');
  check(
    kinds === 'you,say,act,result,act,result,ask,act,note',
    'Copilot: prompt, words, actions with results, a question, a stop: ' + kinds
  );
  const wrote = seen.find(entry => entry.kind === 'act' && entry.id === 't1');
  const wroteResult = seen.find(entry => entry.kind === 'result' && entry.id === 't1');
  check(
    wrote?.verb === 'Wrote' &&
      wrote.what === 'index.html' &&
      wroteResult?.added === 2 &&
      wroteResult.created === true,
    'Copilot: a new file is Wrote, from the session folder, with its line count'
  );
  const ran = seen.find(entry => entry.kind === 'result' && entry.id === 't2');
  check(
    ran?.failed === true && ran.text === 'exit code 1',
    'Copilot: a failed command says so, with its error'
  );
  check(
    seen[1].model === 'gpt-5.5' && seen[1].text === 'Writing it.',
    'Copilot: the words carry their model'
  );
  check(
    !seen.some(entry => entry.text === 'Inside a helper.' || entry.id === 't3'),
    'Copilot: its own sub-agents’ steps are left out'
  );
  check(
    !seen.some(entry => String(entry.text || '').includes('skill text')),
    'Copilot: text a skill put in is no prompt'
  );
  check(
    seen.find(entry => entry.kind === 'ask')?.questions[0].options.join() === 'Blue,Green',
    'Copilot: ask_user is a question with its choices'
  );
  check(
    seen.find(entry => entry.id === 't5')?.what === 'tnai · tnai_delegate',
    'Copilot: a connected server’s tool is named by its server'
  );

  // where the file is: <COPILOT_HOME>/session-state/<id>/events.jsonl
  const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-thread-log-copilot-'));
  const folder = path.join(copilotHome, 'session-state', 's1');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'events.jsonl'), events.join('\n') + '\n');
  const record = { agent: 'GitHub Copilot', sessionId: 's1', accountDir: copilotHome };
  check(
    log.readable('GitHub Copilot') &&
      log.fileFor(record) === path.join(folder, 'events.jsonl') &&
      log.fileFor({ ...record, sessionId: '..' }) === '' &&
      log.fileFor({ ...record, sessionId: 'none' }) === '',
    'Copilot: the record is found from the account folder and session id, never from a path'
  );
  fs.rmSync(copilotHome, { recursive: true, force: true });
}

// ---------- a prompt sent while the agent worked ----------
// Claude Code records it as a "queued_command" attachment inside the running turn, not as a user
// line; a background task's notice comes the same way and is not the user's prompt.
{
  const queued = (prompt, commandMode) =>
    JSON.stringify({
      type: 'attachment',
      isSidechain: false,
      timestamp: at(30),
      attachment: { type: 'queued_command', prompt, commandMode, origin: { kind: 'human' } },
    });
  const sent = claude.entries([
    queued(
      '[TN.ai] [New task while you work on "the cart"] If it belongs to that work, fold it in. New task: Is Obsidian needed?',
      'prompt'
    ),
    queued('<task-notification>done</task-notification>', 'task-notification'),
    JSON.stringify({
      type: 'attachment',
      timestamp: at(31),
      attachment: { type: 'todo_reminder' },
    }),
  ]);
  check(
    sent.length === 1 && sent[0].kind === 'you' && sent[0].text === 'Is Obsidian needed?',
    "a prompt sent while the agent worked shows as the user's prompt, and only that (" +
      JSON.stringify(sent) +
      ')'
  );
}

// ---------- where the file is ----------
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-thread-log-'));
const home = path.join(scratch, 'home');
const folder = path.join(home, '.claude', 'projects', 'C--work-shop');
fs.mkdirSync(folder, { recursive: true });
const file = path.join(folder, 'abc.jsonl');
fs.writeFileSync(file, LINES.join('\n') + '\n');
const record = { agent: 'Claude Code', sessionId: 'abc', cwd: CWD };
const options = { home, env: {} };
check(
  log.fileFor(record, options) === file,
  'the transcript is found from the session record (folder and session id)'
);
check(
  log.fileFor({ ...record, sessionId: 'none' }, options) === '',
  'a session with no file yet has none'
);
check(
  log.fileFor({ ...record, agent: 'Gemini CLI' }, options) === '' && !log.readable('Gemini CLI'),
  'a tool with no reader has no file'
);
check(log.readable('Claude Code'), 'Claude Code is readable');

// The OpenCode reader, against a database made here with OpenCode's own tables (their columns and
// the shapes of `data` were read in the real database on 2026-10-11).
async function openCodeChecks() {
  const { DatabaseSync } = require('node:sqlite');
  const opencode = require('../desktop/thread-log-opencode');
  const file = path.join(os.tmpdir(), 'tnai-thread-log-opencode-' + process.pid + '.db');
  fs.rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(
    'CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT, title TEXT, time_created INTEGER);' +
      'CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);' +
      'CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);'
  );
  const addMessage = (id, time, data) =>
    db
      .prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)')
      .run(id, 's1', time, time, JSON.stringify(data));
  const addPart = (id, message, time, data) =>
    db
      .prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, message, 's1', time, time, JSON.stringify(data));
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?)').run(
    's1',
    null,
    CWD,
    'Fix the cart total',
    1000
  );
  addMessage('m1', 1000, { role: 'user', time: { created: 1000 } });
  addPart('p1', 'm1', 1000, { type: 'text', text: '[TN.ai] Fix the total.' });
  addMessage('m2', 1100, {
    role: 'assistant',
    parentID: 'm1',
    modelID: 'big-pickle',
    time: { created: 1100 },
  });
  addPart('p2', 'm2', 1100, { type: 'step-start' });
  addPart('p3', 'm2', 1200, { type: 'reasoning', text: 'private' });
  addPart('p4', 'm2', 1300, { type: 'text', text: 'Looking' });
  addPart('p5', 'm2', 1400, {
    type: 'tool',
    tool: 'bash',
    callID: 'c1',
    state: { status: 'running', input: { command: 'npm test' }, time: { start: 1400 } },
  });
  const record = { agent: 'OpenCode', sessionId: 's1', cwd: CWD };
  const first = await opencode.read(record, -1, { file });
  const kinds = entries => entries.map(entry => entry.kind).join(' ');
  check(
    first.found && kinds(first.entries) === 'title you say act',
    'OpenCode: a first read gives the title, the prompt, the words so far and a running action: ' +
      kinds(first.entries)
  );
  check(
    first.entries[1].text === 'Fix the total.' && first.entries.slice(1).every(entry => entry.id),
    'OpenCode: the prompt is the words the user wrote, and every entry carries its own id'
  );
  check(!/private/.test(JSON.stringify(first.entries)), 'OpenCode: reasoning is left out');

  // the same parts change while the agent works, and a new one comes
  const change = (id, time, data) =>
    db
      .prepare('UPDATE part SET time_updated = ?, data = ? WHERE id = ?')
      .run(time, JSON.stringify(data), id);
  change('p4', 1500, { type: 'text', text: 'Looking at the cart.' });
  change('p5', 1600, {
    type: 'tool',
    tool: 'bash',
    callID: 'c1',
    state: {
      status: 'completed',
      input: { command: 'npm test' },
      output: 'x',
      metadata: { output: 'line\n2 failed, 12 passed\n', exit: 1 },
      time: { start: 1400, end: 1600 },
    },
  });
  addPart('p6', 'm2', 1700, {
    type: 'tool',
    tool: 'edit',
    callID: 'c2',
    state: {
      status: 'completed',
      input: { filePath: CWD + '\\src\\cart.js', oldString: 'a', newString: 'b' },
      metadata: { filediff: { additions: 3, deletions: 2 } },
      time: { start: 1650, end: 1700 },
    },
  });
  db.prepare('UPDATE message SET data = ? WHERE id = ?').run(
    JSON.stringify({
      role: 'assistant',
      parentID: 'm1',
      modelID: 'big-pickle',
      finish: 'stop',
      time: { created: 1100, completed: 8000 },
    }),
    'm2'
  );
  addPart('p7', 'm2', 1800, { type: 'step-finish', reason: 'stop' });
  const second = await opencode.read(record, first.next, { file });
  check(
    kinds(second.entries) === 'say act result act result worked',
    'OpenCode: a second read gives what changed since: ' + kinds(second.entries)
  );
  const say = second.entries.find(entry => entry.kind === 'say');
  check(
    say.id === first.entries[2].id && say.text === 'Looking at the cart.',
    'OpenCode: words that grew come again under the same id, so the window updates them in place'
  );
  const ran = second.entries.find(entry => entry.kind === 'result' && entry.text);
  check(
    ran.failed && ran.text === '2 failed, 12 passed',
    'OpenCode: a command that ends with a code other than 0 says so, with its last line'
  );
  const edited = second.entries.find(entry => entry.kind === 'result' && entry.added === 3);
  check(
    !!edited &&
      edited.removed === 2 &&
      second.entries.some(entry => entry.kind === 'act' && entry.what === 'src/cart.js'),
    'OpenCode: an edit names its file and the lines OpenCode itself counted'
  );
  const worked = second.entries[second.entries.length - 1];
  check(
    worked.kind === 'worked' && worked.ms === 7000,
    'OpenCode: the task took from its prompt to its end: ' + worked.ms + ' ms'
  );
  const third = await opencode.read(record, second.next, { file });
  check(
    third.entries.every(entry => entry.id) && third.next === second.next,
    'OpenCode: a read with nothing new only repeats the newest parts, which the window knows by their id'
  );
  const cut = await opencode.read(record, -1, { file, maxParts: 2 });
  check(
    cut.cut && cut.entries.some(entry => entry.kind === 'worked'),
    'OpenCode: of a long session only the newest parts are read, and it says so'
  );
  const none = await opencode.read({ ...record, sessionId: 'nope' }, -1, { file });
  check(
    none.found === false && none.entries.length === 0,
    'OpenCode: a session that is not in the record has nothing'
  );
  db.close();
}

// ---------- a record that was read is watched, and a change is pushed ----------
// The answer of a short task can be written after the tool reported the task's end: the window
// must be told, or the answer stands unseen until the next prompt.
async function watchChecks() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const grown = path.join(folder, 'grown.jsonl');
  const line = (type, role, text) =>
    JSON.stringify({
      type,
      cwd: CWD,
      message: { id: 'm_' + text, role, content: [{ type: 'text', text }] },
    }) + '\n';
  fs.writeFileSync(grown, line('user', 'user', 'say ok'));
  const shown = { ...record, sessionId: 'grown', paneId: 'pane-1' };
  const told = [];
  log.setNotify(what => told.push(what));
  check(log.watched() === 0, 'nothing is watched before a conversation is read');
  await log.read({ ...record, sessionId: 'grown' }, -1, options);
  check(log.watched() === 0, 'a read that names no panel watches nothing');
  const start = await log.read(shown, -1, options);
  check(
    log.watched() === 1 && start.entries.length === 1,
    'a conversation that is read is watched: one watcher'
  );
  await sleep(400);
  check(told.length === 0, 'a file that is still pushes nothing');
  fs.appendFileSync(grown, line('assistant', 'assistant', 'ok'));
  fs.appendFileSync(
    grown,
    JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 2000 }) + '\n'
  );
  await sleep(700);
  check(
    told.length === 1 && told[0].paneId === 'pane-1' && told[0].sub === '',
    'two lines written in one moment are one push, naming the panel: ' + JSON.stringify(told)
  );
  const more = await log.read(shown, start.next, options);
  check(
    more.entries.map(entry => entry.kind).join() === 'say,worked' && log.watched() === 1,
    'the read that follows brings the answer and the end, and the watch stays (still one)'
  );
  fs.appendFileSync(grown, line('user', 'user', 'again'));
  await sleep(700);
  check(told.length === 2, 'a later change is pushed again');
  await sleep(log.UNREAD_MS + 500);
  check(
    log.watched() === 0,
    'no read followed that push: nothing shows the conversation, and the watch ended by itself'
  );
  fs.appendFileSync(grown, line('assistant', 'assistant', 'unseen'));
  await sleep(600);
  check(told.length === 2, 'and nothing is pushed for a conversation that is not watched');
  for (let pane = 0; pane < 14; pane++)
    await log.read({ ...shown, paneId: 'p' + pane }, -1, options);
  check(log.watched() === 12, 'at most twelve conversations are watched at once');
  log.endWatches();
  check(log.watched() === 0, 'every watch can be ended');
  fs.rmSync(grown, { force: true });
}

// ---------- a read for another computer (late join) ----------
// It never watches a file and never tells the window, so another computer cannot take this
// computer's own watches away; it reads at most the tail, from a position it handed out itself;
// and every reader's entries pass the one shaping of remote-log.js with only the allowed keys.
async function peerChecks() {
  const { shapeLogEntry } = require('../desktop/remote-log.js');
  const told = [];
  log.setNotify(what => told.push(what));
  for (let pane = 0; pane < 12; pane++)
    await log.read({ ...record, paneId: 'own' + pane }, -1, options);
  for (let i = 0; i < 20; i++)
    await log.readForPeer({ ...record, paneId: 'far' + i }, {}, { ...options, sub: 'helper' });
  check(
    log.watched() === 12 &&
      log.watchedPanels().every(paneId => paneId.startsWith('own')) &&
      told.length === 0,
    'twelve own watches, then twenty reads for another computer: still twelve, nothing pushed'
  );
  log.endWatches();

  const all = await log.readForPeer(record, {}, options);
  check(
    all.readable && all.found && all.entries.length > 5 && all.entries.every(e => e.pos >= 0),
    'a read for another computer gives entries, each with where its line starts'
  );
  check(all.more === false && all.fresh === true, 'a short record: nothing older, a fresh read');
  const lastPos = all.entries[all.entries.length - 1].pos;
  const earlier = await log.readForPeer(record, { before: lastPos }, options);
  check(
    earlier.entries.length > 0 && earlier.entries.every(e => e.pos < lastPos),
    'Show earlier: only lines before the position that was handed out'
  );
  for (const odd of [-1, 1e15, 'x', lastPos + 3]) {
    const got = await log.readForPeer(record, { before: odd }, options);
    check(
      got.entries.every(e =>
        typeof e.pos === 'number' && e.text !== undefined ? !String(e.text).startsWith('{') : true
      ),
      'a cursor of ' + JSON.stringify(odd) + ' reads whole lines of the same record only'
    );
  }
  const after = await log.readForPeer(record, { after: all.next }, options);
  check(after.entries.length === 0 && after.next === all.next, 'what is new: nothing yet');

  // the four readers' entries through the one shaping
  const ALLOWED = {
    you: ['at', 'cut', 'k', 'text'],
    say: ['at', 'cut', 'k', 'text'],
    note: ['at', 'cut', 'k', 'text'],
    title: ['cut', 'k', 'text'],
    act: ['at', 'cut', 'k', 'verb', 'what'],
    ask: ['at', 'k', 'questions'],
    worked: ['at', 'k', 'ms'],
  };
  const codex = require('../desktop/thread-log-codex');
  const cursor = require('../desktop/thread-log-cursor');
  const opencode = require('../desktop/thread-log-opencode');
  const samples = {
    'Claude Code': all.entries,
    Codex: codex.entries(
      [
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'hi' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'ok' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', duration_ms: 9 } }),
      ],
      { cwd: CWD }
    ),
    'Cursor Agent': cursor.entries(
      [
        JSON.stringify({
          role: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'hello' },
              { type: 'tool_use', name: 'Read', input: { path: 'C:/Users/someone/a.txt' } },
            ],
          },
        }),
        JSON.stringify({ type: 'turn_ended', status: 'success' }),
      ],
      { cwd: CWD }
    ),
    OpenCode: [
      ...opencode.partEntries(
        { id: '1', time_created: 5, data: { type: 'text', text: 'hi' } },
        { role: 'user' },
        CWD
      ),
      ...opencode.partEntries(
        {
          id: '2',
          time_created: 6,
          data: {
            type: 'tool',
            tool: 'bash',
            state: { status: 'completed', input: { command: 'ls' }, output: 'x' },
          },
        },
        { role: 'assistant' },
        CWD
      ),
    ],
  };
  for (const [tool, entries] of Object.entries(samples)) {
    const shaped = entries.map(shapeLogEntry).filter(Boolean);
    check(
      shaped.length > 0 &&
        shaped.every(e => ALLOWED[e.k] && Object.keys(e).every(key => ALLOWED[e.k].includes(key))),
      tool + ': every entry shaped has only the allowed keys (' + shaped.length + ')'
    );
    check(
      !JSON.stringify(shaped).includes('C:/Users/someone'),
      tool + ': no path outside the project names a user folder'
    );
  }
}

(async () => {
  await openCodeChecks();
  await watchChecks();
  await peerChecks();

  // ---------- reading: whole lines, only what is new ----------
  const first = await log.read(record, -1, options);
  check(
    first.readable && first.found && first.entries.length === got.length && !first.cut,
    'a first read gives the whole short conversation (' + first.entries.length + ' entries)'
  );
  const again = await log.read(record, first.next, options);
  check(
    again.entries.length === 0 && again.next === first.next,
    'a second read with nothing new gives nothing'
  );

  // a line the CLI is still writing is not handed over until it is whole
  const more = JSON.stringify(assistant([{ type: 'text', text: 'One more thing.' }]));
  fs.appendFileSync(file, more.slice(0, 40));
  const half = await log.read(record, first.next, options);
  check(
    half.entries.length === 0 && half.next === first.next,
    'half a line is left for the next read'
  );
  fs.appendFileSync(file, more.slice(40) + '\n');
  const whole = await log.read(record, half.next, options);
  check(
    whole.entries.length === 1 && whole.entries[0].text === 'One more thing.',
    'once the line is whole it comes, and only it'
  );

  // a file that got shorter is read again from its start
  fs.writeFileSync(file, LINES.slice(0, 6).join('\n') + '\n');
  const shorter = await log.read(record, whole.next, options);
  check(
    shorter.reset && shorter.entries.length === 4,
    'a file that got shorter is read again, and says so'
  );

  const other = await log.read({ ...record, agent: 'Gemini CLI' }, -1, options);
  check(
    other.readable === false && other.entries.length === 0,
    'a tool with no reader answers "not readable"'
  );

  // ---------- a long old conversation: only its end is read ----------
  const big = path.join(folder, 'big.jsonl');
  const say = n =>
    JSON.stringify(assistant([{ type: 'text', text: 'Message ' + n + ' ' + 'x'.repeat(900) }]));
  const stream = fs.createWriteStream(big);
  const total = 40000;
  for (let n = 1; n <= total; n++) stream.write(say(n) + '\n');
  await new Promise(done => stream.end(done));
  const size = fs.statSync(big).size;
  const started = process.hrtime.bigint();
  const tail = await log.read({ ...record, sessionId: 'big' }, -1, options);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  check(
    tail.cut && tail.entries.length > 500 && tail.entries.length < total / 4,
    'of a ' +
      Math.round(size / 1e6) +
      ' MB conversation only the end is read: ' +
      tail.entries.length +
      ' of ' +
      total +
      ' messages, marked as cut'
  );
  check(
    tail.entries[tail.entries.length - 1].text.startsWith('Message ' + total + ' ') &&
      tail.next === size,
    "the end is the newest message, and the next read starts at the file's end"
  );
  check(
    /^Message \d+ x/.test(tail.entries[0].text),
    'the first entry is a whole message, not the middle of a line'
  );
  check(ms < 400, 'it takes ' + Math.round(ms) + ' ms (limit 400)');

  fs.rmSync(scratch, { recursive: true, force: true });
  console.log(failed ? 'FAILED ' + failed + ' of ' + count : 'PASS ' + count + ' checks');
  process.exit(failed ? 1 : 0);
})();
