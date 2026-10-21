// Technically Not tools · desktop-check/tests/agent-team.js — Lead agent + sub-agents. A real
// Claude Code session starts with Technically Not's hooks; its MCP connection to Technically Not
// (the ready signal) is checked (no prompt is sent, so no usage). Then Claude Code's hook payloads
// for a two-sub-agent task are played into that session's hook URL, and each sub-agent's row under
// its lead in the thread list must show its name, task and state; the turn record must carry the
// task's clock and tokens. Finally the composer, used from the Threads page, must reach the open
// thread's agent (a PowerShell thread, so no prompt reaches Claude). What the Details tab shows of
// a sub-agent (task, output, tool calls) is thread-details' job. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const G = window.TnaiAgents,
  T = window.TnaiTeam,
  N = window.tnaiNative;
const windows = /Windows/.test(navigator.userAgent),
  sep = windows ? '\\' : '/'; // hook payloads carry the OS's own absolute paths
check(!!T, 'TnaiTeam present');

// keep finished sub-agents visible while this test inspects them; retirement is checked at the end
T.retireAfter = 600000;

// 1. The composer's auto-start (startLead) opens a real Claude Code lead with Technically Not's
// hooks, quietly: the page the user is on stays. The test folder is new
// to Claude Code, so Technically Not asks "Trust this folder?" inside the new panel (main.js
// askInPane) before Claude Code starts; answering it starts the lead already trusted, and its task
// can go in.
window.TnaiRoute('settings');
await wait(200);
const since = Date.now();
const leadStart = T.startLead();
const ask = await until(async () => (await N.trust.pending())?.[0], 30000);
check(
  !!ask && /Trust/.test(ask.title || ''),
  'folder trust asked inside the new panel (' +
    (Date.now() - since) +
    ' ms): ' +
    (ask?.title || 'none')
);

// The page shown is read from the layout's page class (the old navigation is never on screen).
const settingsShown = () =>
  document.querySelector('.layout')?.classList.contains('settings-mode') &&
  !window.TnaiThreads.visible();
check(
  settingsShown(),
  'starting the lead left the page alone (Settings still shown: ' + settingsShown() + ')'
);
if (ask) await N.trust.answer(ask.id, true);
const lead = await leadStart;
const paneId =
  lead?.paneId ||
  G.sessions()
    .filter(s => s.agent === 'Claude Code')
    .pop()?.paneId;
check(
  !!lead?.paneId,
  'Claude Code lead pane opened and ready after the trust answer' +
    (lead?.error ? ': ' + lead.error : '')
);
const info = (await N.pty.list()).find(s => s.paneId === paneId);
check(
  /--settings /.test(info?.commandLine || '') && /--mcp-config /.test(info?.commandLine || ''),
  'launched with per-session --settings and --mcp-config'
);
const sysPrompt = info?.appendPrompt || ''; // the text of its --append-system-prompt-file
check(
  /--append-system-prompt-file /.test(info?.commandLine || '') &&
    /How to work in every Technically Not session/.test(sysPrompt) &&
    /smallest complete change/.test(sysPrompt) &&
    /Sub-agents \(if your tool has them\) only when truly needed/.test(sysPrompt) &&
    /fix known issues without being asked/.test(sysPrompt),
  'built-in work rules passed per session (not from a skill file)'
);
check(
  !/difficulty|report_plan/.test(sysPrompt),
  'no difficulty rating or plan step: sub-agents are the agent’s own call'
);
check(
  /\[(?:TN|TechnicallyNot)\.ai\]/.test(sysPrompt),
  'lead-agent rules appended to the system prompt'
);
check(
  /first line of its prompt "Summary: "/.test(sysPrompt),
  'lead asked to open each sub-agent prompt with a plain Summary line'
);
const ready = await T.whenReady(paneId, since, 30000);
window.TnaiThreads.open();
check(
  ready,
  'Claude Code connected to Technically Not’s MCP server = ready (' +
    (Date.now() - since) +
    ' ms after launch, incl. trust answer)'
);

// 2. Play a two-sub-agent task in Claude Code's hook payload shapes.
const url = await N.agentEvents.endpoint(paneId);
const post = (to, body) =>
  window.TnaiTest.request(to, { method: 'POST', body: JSON.stringify(body) });
const base = { session_id: 's', transcript_path: 't', cwd: 'c' };
const hook = body => post(url.hook, { ...base, ...body });
await hook({
  hook_event_name: 'UserPromptSubmit',
  prompt: '[TN.ai] Add a dark mode toggle and document it',
});
const t0 = performance.now();
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu1',
  tool_input: {
    description: 'Build dark mode toggle',
    prompt: 'Add a toggle in settings that switches the theme.',
    subagent_type: 'general-purpose',
  },
});

// A lead's sub-agents are read where the thread layout shows them: their rows under the lead in
// the thread list (119), and the record behind those rows (`TnaiTeam`).
const kidRows = () => [
  ...document.querySelectorAll('.tnt-th.tnt-sub[data-pane="' + CSS.escape(paneId) + '"]'),
];
const kid = key => kidRows().find(one => one.dataset.key.endsWith(key));
const kidNow = key => kid(key)?.querySelector('.tnt-th-now')?.textContent || '';
const subOf = key => T.get(paneId)?.subs.find(one => one.key === key);
const row = await until(() => kid('tu1'), 3000);
check(
  !!row,
  'sub-agent row under its lead in the thread list ' +
    Math.round(performance.now() - t0) +
    ' ms after the hook'
);
const subName = subOf('tu1')?.alias || '';
check(
  window.TnaiPaneNames.list().includes(subName) &&
    row?.querySelector('b')?.textContent === subName + ' · Build dark mode toggle',
  'sub-agent named "' + subName + '" with its task (' + row?.querySelector('b')?.textContent + ')'
);
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu2',
  tool_input: {
    description: 'Document dark mode',
    prompt: 'Summary: Writes the dark mode help page.\nWrite the docs section.',
    subagent_type: 'general-purpose',
  },
});
await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag2', agent_type: 'general-purpose' });
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Edit',
  tool_use_id: 'e1',
  agent_id: 'ag1',
  agent_type: 'general-purpose',
  tool_input: { file_path: 'src/settings.js' },
});
await until(() => subOf('tu1')?.status === 'running', 3000);
check(
  !!(await until(() => kidRows().length === 2, 3000)),
  'two sub-agent rows under the lead (' + kidRows().length + ')'
);
check(
  !!(await until(() => /Edit · src\/settings\.js/.test(kidNow('tu1')), 3000)) &&
    subOf('tu1')?.status === 'running',
  'first sub-agent running, its row says what it does now (' + kidNow('tu1') + ')'
);
await hook({
  hook_event_name: 'SubagentStop',
  agent_id: 'ag2',
  agent_type: 'general-purpose',
  agent_transcript_path: 'x',
  last_assistant_message: 'Added a Dark mode section to docs/USER_GUIDE.md.',
});
await hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu2',
  tool_input: {},
  tool_response: {
    status: 'completed',
    content: [
      { type: 'text', text: 'Added a Dark mode section to docs/USER_GUIDE.md.\nagentId: ag2' },
    ],
  },
});
await until(() => subOf('tu2')?.status === 'done', 3000);
check(
  subOf('tu2')?.status === 'done' &&
    /USER_GUIDE/.test(subOf('tu2').result || '') &&
    !!(await until(() => /Done/.test(kidNow('tu2')), 3000)),
  'second sub-agent done with its output (SubagentStop matched by agent id; row: ' +
    kidNow('tu2') +
    ')'
);
console.log('TNAI_SHOT:agent-team');
await wait(600);

// File repository: a sub-agent's file tools reach Technically Not only through hooks (not the
// lead's terminal), and tag the file with its name.
check((await N.fs.write('sub-tag.txt', new TextEncoder().encode('x')))?.ok, 'wrote sub-tag.txt');
window.TnaiProjectFiles.reload();
await until(() => document.querySelector('[data-real-path="sub-tag.txt"]'), 4000);
const root = String((await N.fs.root()) || '').replace(/\//g, sep);
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_use_id: 'r1',
  agent_id: 'ag1',
  agent_type: 'general-purpose',
  tool_input: { file_path: root + sep + 'sub-tag.txt' },
});

// The file rail is not on screen in any route of the current design, and 13 paints its tags only
// while it is: the state is what is read here.
const subKey = paneId + String.fromCharCode(0) + 'ag1';
const tagged = await until(
  () => window.TnaiFileActivity.forPane(subKey).includes('sub-tag.txt'),
  3000
);
check(
  !!tagged && !window.TnaiFileActivity.forPane(paneId).includes('sub-tag.txt'),
  'File repository: the file a sub-agent reads is held under that sub-agent, not its lead: ' +
    JSON.stringify(window.TnaiFileActivity.forPane(subKey))
);

// Shown (here by force), the rail paints the tag once, with the sub-agent's name. Where the forced
// rail gets no box, only the state is checked.
{
  const rail = document.querySelector('.repository-rail'),
    tree = window.TnaiProjectFiles.tree;
  rail?.style.setProperty('display', 'flex', 'important');
  await wait(300);
  if (tree.offsetParent) {
    const fileTag = await until(
      () => document.querySelector('[data-real-path="sub-tag.txt"] .repo-agent-tag'),
      3000
    );
    check(
      !!fileTag && fileTag.textContent === subName && /sub-agent of/.test(fileTag.title),
      'File repository: shown, the rail paints the sub-agent tag on the file: ' +
        (fileTag ? fileTag.textContent + ' · ' + fileTag.title : 'none')
    );
  } else
    log.push(
      'info File repository: the rail could not be put on screen here, tag painting not checked'
    );
  rail?.style.removeProperty('display');
}
console.log('TNAI_SHOT:files-sub-tag');
await wait(400);

// Skills page: a sub-agent's Skill tool call lights the skill's row up in real time; the lead's
// turn ending clears it.
await window.TnaiSkills.import({
  files: [
    {
      name: 'SKILL.md',
      text: '---\nname: hook-skill\ndescription: Lit by a hook event.\n---\nHi.\n',
    },
  ],
});
window.TnaiRoute('skills');
const skillRow = () => document.querySelector('#skillsPage .skill-row[data-skill-id="hook-skill"]');
await until(() => skillRow(), 3000);
check(!skillRow()?.classList.contains('in-use'), 'skill row idle before use');
const s0 = performance.now();
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Skill',
  tool_use_id: 'sk1',
  agent_id: 'ag1',
  agent_type: 'general-purpose',
  tool_input: { skill: 'hook-skill' },
});
const lit = await until(() => skillRow()?.classList.contains('in-use') && skillRow(), 3000);
check(
  !!lit &&
    lit.classList.contains('lit-new') &&
    getComputedStyle(lit).backgroundColor !== 'rgba(0, 0, 0, 0)',
  'Skill hook lights the row ' +
    Math.round(performance.now() - s0) +
    ' ms later (' +
    (lit?.textContent.match(/In use · [^A-Z]*\w+/)?.[0] || '') +
    ')'
);
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_use_id: 'sk2',
  tool_input: {
    file_path: windows
      ? 'C:\\p\\.claude\\skills\\hook-skill\\SKILL.md'
      : '/p/.claude/skills/hook-skill/SKILL.md',
  },
});
await wait(300);
check(
  skillRow()?.classList.contains('in-use') && skillRow() === lit,
  'reading its SKILL.md keeps it lit (same row, no re-flash)'
);
console.log('TNAI_SHOT:skills-lit');
await wait(600);

// Composer → busy Claude Code lead (turn open per its hooks): the task is framed to fold in or
// become a sub-agent. send is stubbed, so nothing reaches Claude Code.
check(T.busy(paneId), 'lead is busy between its prompt and Stop hooks');
window.TnaiThreads.select(paneId);
await wait(100);
const realSend = G.send,
  sent = [];
G.send = (id, text) => {
  sent.push({ id, text });
  return true;
};
const busyPrompt = document.getElementById('prompt');
busyPrompt.value = 'Fix the footer typo';
busyPrompt.dispatchEvent(new Event('input', { bubbles: true }));
document.getElementById('send').click();
await wait(300);
G.send = realSend;
check(
  sent.length === 1 &&
    sent[0].id === paneId &&
    /^\[(?:TN|TechnicallyNot)\.ai\] \[New task while you work on "Add a dark mode toggle and document it"\] .*fold it in.*judge best.*New task: Fix the footer typo$/.test(
      sent[0].text
    ),
  'busy lead gets the task framed to fold in or handle as it judges: ' +
    JSON.stringify(sent[0]?.text || '').slice(0, 140)
);
check(
  window.TnaiLiveTasks.get(paneId)?.text !== 'Fix the footer typo',
  'a folded-in task does not replace the lead’s recorded task'
);

// Claude Code wraps a long bracketed paste as <pasted_content id="…">…</pasted_content id="…">:
// that folded-in note still keeps the lead's task, and the next busy note quotes only the task's
// words (it used to quote the wrapper, which Claude Code then escaped as <\pasted_content …> and
// nested).
await hook({
  hook_event_name: 'UserPromptSubmit',
  prompt:
    '\n\n<pasted_content id="8a8a">\n' + (sent[0]?.text || '') + '\n</pasted_content id="8a8a">\n',
});
await wait(300);
check(
  T.get(paneId)?.task?.text === 'Add a dark mode toggle and document it',
  'a pasted_content-wrapped busy note keeps the lead’s task: ' +
    JSON.stringify(T.get(paneId)?.task?.text || '').slice(0, 120)
);
G.send = (id, text) => {
  sent.push({ id, text });
  return true;
};
busyPrompt.value = 'Fix the header typo';
busyPrompt.dispatchEvent(new Event('input', { bubbles: true }));
document.getElementById('send').click();
await wait(300);
G.send = realSend;
check(
  sent.length === 2 &&
    /^\[(?:TN|TechnicallyNot)\.ai\] \[New task while you work on "Add a dark mode toggle and document it"\] .*New task: Fix the header typo$/.test(
      sent[1].text
    ),
  'second busy note quotes the task alone, no stray wrapper: ' +
    JSON.stringify(sent[1]?.text || '').slice(0, 140)
);
check(
  window.TnaiResults.cleanTask(
    '<pasted_content id="8a8a">\n[TN.ai] [New task while you work on "\n\n<\\pasted_content id="8a8a">\n[TN.ai] Old"] If it belongs to that work, fold it in. New task: Screenshot 1 — [Attached image: C:\\a.png]\nMake it modern.\n</pasted_content id="8a8a">'
  ) === 'Screenshot 1 —\nMake it modern.',
  'cleanTask drops escaped <\\pasted_content> wrappers and the nested busy note'
);

// Route preview (no send): busy with 1 sub-agent → fold in; with 3 running → a new lead; Ctrl+Enter
// → always a new lead.
const hintText = () => document.querySelector('.composer .tnai-route-hint')?.textContent || '';
const r1 = window.TnaiLiveTasks.route();
check(
  r1.kind === 'fold' && r1.paneId === paneId && /busy: it folds this in/.test(hintText()),
  'composer hint: busy lead folds in (' + hintText() + ')'
);
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu3',
  tool_input: { description: 'Third part', prompt: 'x', subagent_type: 'general-purpose' },
});
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu4',
  tool_input: { description: 'Fourth part', prompt: 'y', subagent_type: 'general-purpose' },
});

// The handoff is Auto's: a lead the user clicked keeps the task even when busy. With several agents
// signed in, Auto starts the picked one.
const clicked = window.TnaiLiveTasks.target(),
  pickBefore = window.TnaiLiveTasks.startPick();
window.TnaiLiveTasks.setTarget(null);
if ((window.TnaiLiveTasks.startOptions?.() || []).length > 1)
  window.TnaiLiveTasks.startPick('Claude Code|');
await until(() => window.TnaiLiveTasks.route().kind === 'handoff', 3000);
await wait(2100); // the hint repaints on team changes and every 2 s
const r2 = window.TnaiLiveTasks.route();
check(
  r2.kind === 'handoff' &&
    r2.from === paneId &&
    /new Claude Code lead · .* busy with 3 sub-agents/.test(hintText()),
  'lead with 3 sub-agents running: next task goes to a new lead (' + hintText() + ')'
);
check(
  window.TnaiLiveTasks.route(true).kind === 'new' &&
    /Ctrl\+↵ new agent/.test(document.querySelector('.composer .hints')?.textContent || ''),
  'Ctrl+Enter route: new lead, shown in the hints'
);
window.TnaiLiveTasks.startPick(pickBefore);
window.TnaiLiveTasks.setTarget(clicked);
check(
  window.TnaiLiveTasks.route().kind === 'fold',
  'a lead the user clicked keeps the task while busy, even with 3 sub-agents'
);
await hook({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
check(
  !!(await until(() => skillRow() && !skillRow().classList.contains('in-use'), 3000)),
  'turn end clears the highlight'
);
check(!!(await until(() => !T.busy(paneId), 2000)), 'lead not busy after its Stop hook');

// Background sub-agent (Claude Code's default Agent call): PostToolUse returns at once with only a
// launch notice, so it stays running until its SubagentStop, which carries the real output.
const bg = () => T.state(paneId)?.subs.find(s => s.key === 'tu5');
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu5',
  tool_input: { description: 'Audit docs', prompt: 'z', subagent_type: 'Explore' },
});
await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag5', agent_type: 'Explore' });
await hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu5',
  tool_input: {},
  tool_response: {
    isAsync: true,
    status: 'async_launched',
    agentId: 'ag5',
    description: 'Audit docs',
    prompt: 'z',
  },
});
await wait(400);
check(
  bg()?.status === 'running' && !bg()?.result && !bg()?.endedAt,
  'background sub-agent stays running after its launch notice: ' +
    JSON.stringify({ status: bg()?.status, result: bg()?.result })
);
await hook({
  hook_event_name: 'SubagentStop',
  agent_id: 'ag5',
  agent_type: 'Explore',
  last_assistant_message: 'Docs audit: 2 stale files.',
});
check(
  !!(await until(
    () => bg()?.status === 'done' && bg().result === 'Docs audit: 2 stale files.',
    3000
  )),
  'background sub-agent done with its output on SubagentStop'
);

// Its hand-back reaches the lead as a "<task-notification>" turn: not a new task, so the task text,
// plan and sub-agents stay.
const taskBefore = T.state(paneId)?.task?.text;
await hook({
  hook_event_name: 'UserPromptSubmit',
  prompt:
    '<task-notification>\n<task-id>ag5</task-id>\n<tool-use-id>tu5</tool-use-id>\n<status>completed</status>\n<summary>Agent "Audit docs" completed</summary>\n<result>Docs audit: 2 stale files.</result>\n</task-notification>',
});
await wait(400);
check(
  !!taskBefore &&
    T.state(paneId)?.task?.text === taskBefore &&
    T.busy(paneId) &&
    !!bg() &&
    T.state(paneId)?.task?.text === taskBefore &&
    !!bg(),
  'task-notification is a sub-agent hand-back, not a new task: ' +
    JSON.stringify(T.state(paneId)?.task?.text || '').slice(0, 80)
);

// A background command (Bash run_in_background) keeps running after its launch: listed by
// TnaiTeam.background (the "Working in background" status) until its own "<task-notification>"
// hand-back; TaskStop ends one too.
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_use_id: 'bs1',
  tool_input: {
    command: 'npm run dev',
    description: 'Start the dev server',
    run_in_background: true,
  },
});
await hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_use_id: 'bs1',
  tool_input: {
    command: 'npm run dev',
    description: 'Start the dev server',
    run_in_background: true,
  },
  tool_response: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bgsh1' },
});
await hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_use_id: 'bs2',
  tool_input: { command: 'npm test', description: 'Run the tests', run_in_background: true },
  tool_response: { stdout: '', backgroundTaskId: 'bgsh2' },
});
check(
  !!(await until(() => T.background(paneId).length === 2, 3000)) &&
    T.background(paneId)[0].label === 'Start the dev server',
  'background commands listed while they run: ' +
    JSON.stringify(T.background(paneId).map(b => b.taskId))
);
await hook({ hook_event_name: 'Stop', last_assistant_message: 'Started the dev server.' });
await wait(300);
check(T.background(paneId).length === 2, 'background commands outlive the turn');
await hook({
  hook_event_name: 'UserPromptSubmit',
  prompt:
    '<task-notification>\n<task-id>bgsh1</task-id>\n<tool-use-id>bs1</tool-use-id>\n<status>completed</status>\n<summary>Background command "Start the dev server" completed</summary>\n</task-notification>',
});
await hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'TaskStop',
  tool_use_id: 'ts1',
  tool_input: { task_id: 'bgsh2' },
  tool_response: {},
});
check(
  !!(await until(() => T.background(paneId).length === 0, 3000)),
  'a background command leaves the list on its hand-back or TaskStop: ' +
    JSON.stringify(T.background(paneId).map(b => b.taskId))
);

// A finished sub-agent reported back, so it leaves its lead's rows in the thread list and its file
// tags; the lead stays.
T.retireAfter = 300;
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tu6',
  tool_input: { description: 'Short job', prompt: 'q', subagent_type: 'Plan' },
});
await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag6', agent_type: 'Plan' });
await until(() => T.state(paneId)?.subs.some(s => s.key === 'tu6' && s.status === 'running'), 3000);
await hook({
  hook_event_name: 'SubagentStop',
  agent_id: 'ag6',
  agent_type: 'Plan',
  last_assistant_message: 'Short job done.',
});
check(
  !!(await until(
    () => T.state(paneId)?.subs.some(s => s.key === 'tu6' && s.status === 'done'),
    2000
  )),
  'finished sub-agent shows Done first'
);
check(
  !!(await until(() => !T.state(paneId)?.subs.some(s => s.key === 'tu6'), 3000)) &&
    G.sessions().some(s => s.paneId === paneId && s.running),
  'finished sub-agents leave the view after reporting back; the lead stays'
);
T.retireAfter = 3000;
check(
  /Last used today/.test(skillRow()?.textContent || '') &&
    window.TnaiFileActivity.lastUsed().some(u => u.name === 'hook-skill' && u.by),
  'Skills page: last-used time and agent kept after the turn ends'
);
await window.TnaiSkills.remove?.('hook-skill');

// Task meter (42 + desktop/agent-turns.js): the clock starts on UserPromptSubmit and stops on Stop;
// tokens come only from the session transcript's message.usage (one count per message id), pushed
// by a file watcher, with a finished sub-agent's transcript added.
{
  const rootDir = String((await N.fs.root()) || '').replace(/\//g, sep);
  const usage = (id, input, output, cw, cr, extra = {}) =>
    JSON.stringify({
      type: 'assistant',
      ...extra,
      message: {
        id,
        role: 'assistant',
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_creation_input_tokens: cw,
          cache_read_input_tokens: cr,
        },
      },
    });
  const before = usage('old', 5000, 5000, 0, 0) + '\n'; // an earlier turn: must not count
  await N.fs.write('turn-t.jsonl', new TextEncoder().encode(before));
  const turnOf = () => window.TnaiTurns.get(paneId);
  const used = () => {
    const tokens = turnOf()?.tokens;
    return tokens ? tokens.input + tokens.output + tokens.cacheWrite : 0;
  };

  // The task-notification turn above is still running (no Stop): end it, or this prompt would count
  // as queued into that task.
  await hook({ hook_event_name: 'Stop', last_assistant_message: 'Noted.' });
  window.TnaiThreads.open();
  await hook({
    hook_event_name: 'UserPromptSubmit',
    prompt: '[TN.ai] Measure this task',
    transcript_path: rootDir + sep + 'turn-t.jsonl',
  });
  const m0 = performance.now();
  const on = await until(() => turnOf()?.startedAt && !turnOf().endedAt && turnOf(), 3000);
  check(
    !!on && !on.tokens,
    'task clock running right after the prompt hook (' +
      Math.round(performance.now() - m0) +
      ' ms), no token count before usage exists: ' +
      JSON.stringify(on?.tokens || null)
  );
  const t1 = window.TnaiTurns.elapsed(paneId);
  await wait(1100);
  check(
    t1 != null && window.TnaiTurns.elapsed(paneId) >= t1 + 1000,
    'clock runs while working: ' + t1 + ' → ' + window.TnaiTurns.elapsed(paneId) + ' ms'
  );

  // Two lines for one message (one per content block: counted once, latest wins) and a second
  // message; no hook, only the file grows.
  const turnLines =
    [
      usage('m1', 3, 100, 2000, 9000),
      usage('m1', 3, 400, 2000, 9000),
      usage('m2', 2, 600, 1000, 11000),
    ].join('\n') + '\n';
  const w0 = performance.now();
  await N.fs.write('turn-t.jsonl', new TextEncoder().encode(before + turnLines));
  check(
    !!(await until(() => used() === 4005, 3000)),
    'tokens pushed by the transcript watcher ' +
      Math.round(performance.now() - w0) +
      ' ms after the write: ' +
      used() +
      ' (3+400+2000 + 2+600+1000)'
  );
  check(
    turnOf()?.tokens?.cacheRead === 20000,
    'cache reads kept apart from the count: ' + JSON.stringify(turnOf()?.tokens || null)
  );

  // A finished sub-agent's own transcript adds its usage.
  const subSays = JSON.stringify({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      id: 's0',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking at the footer.' },
        { type: 'tool_use', name: 'Read', input: { file_path: 'footer.js' } },
      ],
    },
  });
  await N.fs.write(
    'turn-sub.jsonl',
    new TextEncoder().encode(subSays + '\n' + usage('s1', 10, 990, 0, 500) + '\n')
  );
  await hook({
    hook_event_name: 'SubagentStop',
    agent_id: 'agT',
    agent_type: 'Explore',
    agent_transcript_path: rootDir + sep + 'turn-sub.jsonl',
    last_assistant_message: 'ok',
  });
  check(
    !!(await until(() => used() === 5005, 3000)) && turnOf()?.subTokens?.agT === 1000,
    'sub-agent transcript usage added: ' +
      used() +
      ', of it the sub-agent ' +
      JSON.stringify(turnOf()?.subTokens || null)
  );
  const subLog = window.TnaiTurns.get(paneId)?.subLog?.agT || [];
  check(
    subLog.map(x => x.kind + ':' + x.text).join('|') ===
      'text:Looking at the footer.|tool:Read · footer.js',
    'sub-agent activity from its own transcript: ' +
      JSON.stringify(subLog.map(x => x.kind + ':' + x.text))
  );
  await hook({ hook_event_name: 'Stop', last_assistant_message: 'Measured.' });
  const done = await until(() => turnOf()?.endedAt && turnOf(), 3000);
  const frozen = window.TnaiTurns.elapsed(paneId);
  await wait(1600);
  check(
    !!done &&
      done.endedBy === 'stop' &&
      window.TnaiTurns.elapsed(paneId) === frozen &&
      used() === 5005,
    'Stop hook ends the task: ended by ' + done?.endedBy + ', clock frozen, tokens kept'
  );
  check(
    window.TnaiTurns.get(paneId)?.source === 'claude-transcript',
    'turn source recorded as the Claude Code transcript'
  );
}

// A question waiting for the user (53): Claude Code's numbered picker (AskUserQuestion hooks), and
// a reply that ends on a question (inferred).
{
  window.TnaiThreads.open();
  const now = () =>
    document.querySelector(
      '.tnt-th[data-pane="' + CSS.escape(paneId) + '"]:not(.tnt-sub) .tnt-th-now'
    )?.textContent || '';
  const asking = () => window.TnaiLiveFeed.asking(paneId);
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: '[TN.ai] Pick a database' });
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: 'q1',
    tool_input: {
      questions: [
        {
          question: 'Which database?',
          header: 'DB',
          multiSelect: false,
          options: [
            { label: 'Postgres', description: '' },
            { label: 'SQLite', description: '' },
            { label: 'MongoDB', description: '' },
          ],
        },
      ],
    },
  });
  check(
    !!(await until(
      () =>
        asking() &&
        !asking().inferred &&
        /Which database\?/.test(now()) &&
        /Postgres.*SQLite.*MongoDB/.test(JSON.stringify(asking())),
      3000
    )),
    'picker question on the thread’s row, its three options kept: ' +
      now() +
      ' / ' +
      JSON.stringify(asking()).slice(0, 160)
  );
  console.log('TNAI_SHOT:ask-card');
  await wait(500);
  await hook({
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_use_id: 'q1',
    tool_input: {},
    tool_response: {},
  });
  check(
    !!(await until(() => !asking() && !/Which database/.test(now()), 3000)),
    'answering the picker clears it on the row (' + now() + ')'
  );
  await hook({
    hook_event_name: 'Stop',
    last_assistant_message: 'Two ways:\n\n1. Keep it\n2. Replace it\n\nWhich do you want?',
  });
  check(
    !!(await until(
      () => window.TnaiLiveFeed.asking(paneId)?.inferred && /Which do you want\?/.test(now()),
      3000
    )),
    'reply ending on a question waits for an answer (inferred): ' + now()
  );
  await hook({ hook_event_name: 'UserPromptSubmit', prompt: '1' });
  check(
    !!(await until(() => !asking() && !/Which do you want/.test(now()), 3000)),
    'the reply clears it (' + now() + ')'
  );
  await hook({ hook_event_name: 'Stop', last_assistant_message: 'Kept it. Done.' });
  check(
    !!(await until(() => !window.TnaiLiveFeed.asking(paneId), 2000)),
    'a reply without a question does not ask'
  );
}

// 2b. A launch held on a permission prompt reads "Waiting for approval"; a sub-agent whose tool
// call comes before (or without) its SubagentStart takes its waiting call of the same type, so its
// card runs instead of staying on Starting.
{
  window.TnaiThreads.open();
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: 'tu9',
    tool_input: {
      description: 'Scan the settings files',
      prompt: 'Find the theme setting.',
      subagent_type: 'Explore',
    },
  });
  hook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'Agent',
    tool_input: {
      description: 'Scan the settings files',
      prompt: 'Find the theme setting.',
      subagent_type: 'Explore',
    },
  }); // held open until answered
  const perm = await until(
    async () =>
      (await N.permissions.pending()).find(q => q.paneId === paneId && q.tool === 'Agent'),
    3000
  );
  const sub9 = () => T.state(paneId)?.subs.find(s => s.key === 'tu9');
  const meta9 = () => kidNow('tu9');
  check(
    !!perm && !!(await until(() => /Waiting for approval/.test(meta9()), 3000)),
    'launch held on a permission prompt reads "Waiting for approval" (' + meta9() + ')'
  );
  if (perm) await N.permissions.answer(perm.id, 'terminal');
  check(
    !!(await until(() => sub9() && !sub9().asking && /Starting/.test(meta9()), 3000)),
    'prompt answered: back to Starting until it runs (' + meta9() + ')'
  );
  await hook({
    hook_event_name: 'PreToolUse',
    tool_name: 'Grep',
    tool_use_id: 'g9',
    agent_id: 'ag9',
    agent_type: 'Explore',
    tool_input: { pattern: 'theme' },
  });
  const s9 = await until(() => sub9()?.status === 'running' && sub9(), 3000);
  check(
    !!s9 &&
      s9.agentId === 'ag9' &&
      s9.tools === 1 &&
      s9.asked &&
      s9.spawnAt &&
      s9.firstToolAt >= s9.spawnAt,
    'tool call before SubagentStart runs its card and keeps the timing (' +
      JSON.stringify(
        s9 && {
          id: s9.agentId,
          tools: s9.tools,
          asked: s9.asked,
          spawnAt: !!s9.spawnAt,
          firstToolAt: !!s9.firstToolAt,
        }
      ) +
      ')'
  );
  await hook({ hook_event_name: 'SubagentStart', agent_id: 'ag9', agent_type: 'Explore' });
  check(
    T.state(paneId)?.subs.filter(s => s.agentId === 'ag9').length === 1,
    'its late SubagentStart adds no second card'
  );
  await hook({
    hook_event_name: 'SubagentStop',
    agent_id: 'ag9',
    agent_type: 'Explore',
    agent_transcript_path: 'x',
    last_assistant_message: 'Theme is in settings.js.',
  });
}

// 2b. A name the user chose wins (hidden skill 00): a "Name: …" line under the Summary, or the
// call's own `name`; no line → a picked name.
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tn1',
  tool_input: {
    description: 'Collect bugs',
    prompt: 'Summary: Lists the open bugs.\nName: bug reporter\nRead the tracker.',
    subagent_type: 'general-purpose',
  },
});
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tn2',
  tool_input: {
    description: 'Video notes',
    prompt: 'Write notes.',
    name: 'YouTube',
    subagent_type: 'general-purpose',
  },
});
await hook({
  hook_event_name: 'PreToolUse',
  tool_name: 'Agent',
  tool_use_id: 'tn3',
  tool_input: {
    description: 'Plain job',
    prompt: 'Summary: Does a job.\nThe name: is not on its own line here.',
    subagent_type: 'general-purpose',
  },
});
const named = key => T.get(paneId)?.subs.find(s => s.key === key)?.alias || '';
check(
  !!(await until(() => named('tn3'), 3000)) &&
    named('tn1') === 'bug reporter' &&
    named('tn2') === 'YouTube' &&
    window.TnaiPaneNames.list().includes(named('tn3')),
  'user-chosen names shown exactly: ' + [named('tn1'), named('tn2'), named('tn3')].join(' / ')
);
for (const [id, type] of [
  ['agn1', 'general-purpose'],
  ['agn2', 'general-purpose'],
  ['agn3', 'general-purpose'],
])
  await hook({ hook_event_name: 'SubagentStart', agent_id: id, agent_type: type });
for (const id of ['agn1', 'agn2', 'agn3'])
  await hook({
    hook_event_name: 'SubagentStop',
    agent_id: id,
    agent_type: 'general-purpose',
    agent_transcript_path: 'x',
    last_assistant_message: 'Done.',
  });

// 3. Composer on the Threads page → the open thread's agent (PowerShell, so nothing reaches
// Claude Code).
const shell = await window.TnaiTest.open('Terminal');
check(shell?.ok, 'PowerShell thread opened');
const shellRow = () =>
  document.querySelector('.tnt-th[data-pane="' + CSS.escape(shell.paneId) + '"]:not(.tnt-sub)');
await until(() => shellRow(), 3000);
window.TnaiThreads.open();
window.TnaiThreads.select(shell.paneId);
check(
  !!(await until(() => window.TnaiThreadHelpers.state().pane === shell.paneId, 3000)),
  'the PowerShell thread is the open one (' + window.TnaiThreadHelpers.state().pane + ')'
);

// The page before the send: the Threads page with this thread open (the old Files page is gone).
const pageNow = () =>
  [...document.querySelector('.layout').classList].filter(c => /-mode$/.test(c)).join(' ') +
  ' · threads ' +
  window.TnaiThreads.visible() +
  ' · open ' +
  window.TnaiThreadHelpers.state().pane;
const pageBefore = pageNow();
const prompt = document.getElementById('prompt');
prompt.value = 'echo tnai-composer-ok';
prompt.dispatchEvent(new Event('input', { bubbles: true }));
document.getElementById('send').click();
await wait(300);
check(
  pageNow() === pageBefore,
  'composer send left the page alone (the same page and thread: ' + pageNow() + ')'
);
check(
  !!(await until(
    async () => /tnai-composer-ok/.test((await N.pty.replay(shell.paneId))?.buffer || ''),
    5000
  )),
  'task reached the selected agent'
);
check(
  !/tnai-composer-ok/.test((await N.pty.replay(paneId))?.buffer || ''),
  'nothing was typed into Claude Code'
);

// A live step from another CLI's own event source (agent-hooks.js /step; OpenCode's plugin posts
// this shape).
await post(url.step, { event: 'tool', tool: 'bash', input: { command: 'echo tnai-step-ok' } });
await post(url.step, { event: 'tool', tool: 'edit', input: { filePath: 'src/steps.js' } });
const stepped = await until(async () => {
  const h = ((await N.agentEvents.history()) || []).filter(
    e => e.paneId === paneId && e.kind === 'tool'
  );
  return (
    h.some(e => e.tool === 'Bash' && e.detail === 'echo tnai-step-ok') &&
    h.some(e => e.tool === 'Edit' && e.detail === 'src/steps.js')
  );
}, 3000);
check(
  !!stepped,
  'steps posted to /step become tool events under Claude Code’s tool names (bash → Bash, edit with filePath → Edit)'
);

// Codex posts its own PreToolUse hook payload there (agent-hooks.js codexStep); a sub-agent’s call
// (agent_id) is left out.
await post(url.step, {
  hook_event_name: 'PreToolUse',
  session_id: 's',
  tool_name: 'Bash',
  tool_input: { command: 'echo tnai-codex-step' },
});
await post(url.step, {
  hook_event_name: 'PreToolUse',
  session_id: 's',
  agent_id: 'sub1',
  tool_name: 'Bash',
  tool_input: { command: 'echo tnai-codex-sub' },
});
const codexStepped = await until(
  async () =>
    ((await N.agentEvents.history()) || []).some(
      e => e.paneId === paneId && e.kind === 'tool' && e.detail === 'echo tnai-codex-step'
    ),
  3000
);
const subLeft = !((await N.agentEvents.history()) || []).some(
  e => e.detail === 'echo tnai-codex-sub'
);
check(
  !!codexStepped && subLeft,
  'a Codex PreToolUse payload posted to /step becomes a tool event; its sub-agent call is left out (' +
    !!codexStepped +
    ', ' +
    subLeft +
    ')'
);

G.stop(shell.paneId);
G.stop(paneId);
check(
  !!(await until(
    () => subOf('tu1')?.status === 'failed' || /Stopped with its lead/.test(kidNow('tu1')),
    3000
  )),
  'unfinished sub-agent shown as stopped when its lead stops (' +
    JSON.stringify({ sub: subOf('tu1')?.status, row: kidNow('tu1') }) +
    ')'
);
return { ok, log };
