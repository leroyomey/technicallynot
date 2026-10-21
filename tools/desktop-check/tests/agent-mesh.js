// Technically Not tools · desktop-check/tests/agent-mesh.js — Agent CLIs typed by hand into plain
// PowerShell panes (37 + desktop/agent-mesh.js + agent-shim.js), using FAKE `claude` / `codex` CLIs
// from agent-mesh.main.js (never the real CLIs, no credits): `claude` / `codex` register as live
// agent sessions of that provider (thread list row, mesh state), get Technically Not's launch
// additions (Claude: --settings/--mcp-config/hint in an --append-system-prompt-file; Codex: hint in
// developer_instructions of a `-p tnai` profile file; Cursor Agent: work rules as an alwaysApply
// rule in a --plugin-dir folder), a real console (TTY), Claude hook events reach the pane's team
// view; `tnai agents` / `tnai send` / `tnai read` work between the two fakes in the project; a fake
// started outside every open project is not connected and is refused; a bad or missing token is
// refused; control characters in a message can't break out of the paste; `claude -p` passes through
// unregistered; quitting the CLI returns the pane to a plain terminal. Waits and links among three
// agents (a ring of questions) are their own test, agent-mesh-three.js. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

// report what failed instead of hitting the runner's time limit
const deadline = Date.now() + 380000;
const until = async (fn, ms = 10000) => {
  const end = Math.min(deadline, Date.now() + ms);
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(60);
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
  });
const N = window.tnaiNative,
  G = window.TnaiAgents;
const strip = s =>
  String(s || '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '');
const text = async paneId => strip((await N.pty.replay(paneId))?.buffer);
const session = paneId => G.sessions().find(s => s.paneId === paneId);
const has = (paneId, needle, ms = 15000) =>
  until(async () => (await text(paneId)).includes(needle), ms);
const type = (paneId, line) => N.pty.write(paneId, line + '\r');
const { outside, bin } = await main('paths');

// off Windows the panel shell is bash (prompt ends in $)
const windows = /Windows/.test(navigator.userAgent);

async function shell() {
  const r = await window.TnaiTest.open('Terminal');
  check(r?.ok, 'PowerShell pane opened');

  // Any prompt (the user's profile may style it): wait for PowerShell's first output, then for it
  // to go quiet.
  await until(async () => (await text(r.paneId)).includes(windows ? '>' : '$'), 20000);
  await until(() => Date.now() - (session(r.paneId)?.lastOutputAt || 0) > 1200, 8000);

  // bash login files may put ~/.local/bin (a real `claude`) ahead of the fakes; the shim folder
  // stays first, the fakes go right after it.
  if (!windows) {
    type(r.paneId, 'export PATH="${TNAI_SHIM%/*}:' + bin + ':$PATH"');
    await wait(300);
    await until(() => Date.now() - (session(r.paneId)?.lastOutputAt || 0) > 800, 5000);
  }
  return r.paneId;
}

// 1. `claude` typed by hand in a plain PowerShell pane in the project.
const A = await shell();
let t0 = Date.now();
type(A, 'claude');
check(
  await until(() => session(A)?.agent === 'Claude Code'),
  'hand-typed claude registers as a Claude Code session (' + (Date.now() - t0) + ' ms)'
);
check(
  await has(A, 'FAKE-claude start settings=true mcp=true prompt-hint=true'),
  'Claude got Technically Not hooks (--settings, --mcp-config) and the mesh hint in an --append-system-prompt-file'
);
check(
  await has(A, 'env-hint=true tty=true node-mode=false'),
  'CLI runs on the pane console (TTY), hint in TNAI_AGENTS_HINT, no ELECTRON_RUN_AS_NODE leak'
);
check(
  session(A)?.startedByHand && session(A)?.running,
  'session marked started by hand and running'
);
window.TnaiThreads.open();

// The old Overview card is gone with the old frame: the thread list names the provider. The row can
// be drawn a moment before the session is known as Claude Code's.
const threadOf = paneId => window.TnaiThreadList.thread(paneId);
check(
  await until(() => threadOf(A)?.tool === 'Claude Code', 5000),
  'thread list row names its provider: ' + threadOf(A)?.tool
);

// The old card's mesh note: the thread layout reads the same waits and links from TnaiMesh (37),
// so the checks read that state and spell it the way the note did.
const noteOf = paneId => {
  const member = (window.TnaiMesh?.state() || []).find(m => m.paneId === paneId);
  if (!member) return '';
  const names = ids => ids.map(id => session(id)?.name || 'another agent').join(', ');
  const parts = [];
  if (member.waitsOn?.length)
    parts.push((member.ring ? 'waiting on each other: ' : 'waiting on ') + names(member.waitsOn));
  if (member.with?.length) parts.push('working with ' + names(member.with));
  const peers = window.TnaiMesh.peers(paneId);
  if (!member.project) parts.push('not in an open project');
  else
    parts.push(peers > 1 ? peers + ' agents in this project' : 'no other agents in this project');
  return parts.join(' · ');
};

// 2. `codex` in a second pane.
const B = await shell();
t0 = Date.now();
type(B, 'codex');
check(
  await until(() => session(B)?.agent === 'Codex'),
  'hand-typed codex registers as a Codex session (' + (Date.now() - t0) + ' ms)'
);
check(
  await has(B, 'codex-hint=true'),
  'Codex got the mesh hint in developer_instructions (its -p tnai profile file)'
);
const nameA = session(A).name,
  nameB = session(B).name;
check(await until(() => /2 agents/.test(noteOf(A))), 'mesh state of A: ' + noteOf(A));

// 3. Claude Code hook events from the hand-started session reach the pane (sub-agent under its
// card).
const url = await N.agentEvents.endpoint(A);
check(!!url?.hook, 'hand-started Claude has its own hook URL');
if (url?.hook) {
  const post = body =>
    window.TnaiTest.request(url.hook, {
      method: 'POST',
      body: JSON.stringify({ session_id: 's', transcript_path: 't', cwd: 'c', ...body }),
    });
  await post({
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_use_id: 'tu1',
    tool_input: { description: 'Scan the files', prompt: 'scan', subagent_type: 'general-purpose' },
  });
  await post({ hook_event_name: 'SubagentStart', agent_id: 'ag1', agent_type: 'general-purpose' });
  check(
    await until(() => (window.TnaiTeam?.get?.(A)?.subs || []).length >= 1),
    'sub-agent shows under the hand-started session'
  );
}

// 4. The mesh between the two fakes.
type(A, 'tnai agents');
check(
  await until(async () => {
    const t = await text(A);
    return (
      t.includes('Agents in ') && t.includes(nameB) && t.includes('Codex') && t.includes('(you)')
    );
  }),
  '`tnai agents` from Claude lists ' + nameB + ' (Codex) and itself'
);
t0 = Date.now();
type(A, 'tnai send ' + nameB + ' hello-from-claude');
check(
  await has(B, 'hello-from-claude'),
  'Codex pane received the message (' + (Date.now() - t0) + ' ms)'
);
check(
  await has(B, 'FAKE-codex got: "[from Claude Code · ' + nameA + '] hello-from-claude"'),
  'message prefixed with its sender and submitted with Enter as one line'
);
check(await has(A, 'Sent to ' + nameB), 'sender told it was delivered');

// 4b. The user has half-typed text in the target's input (bug seen 2026-09-26: a message merged
// into it and both went as one prompt): the message is held, never typed into that text, and goes
// as its own prompt once the user sends theirs.
N.pty.write(B, 'half typed');
await wait(300);
type(A, 'tnai send ' + nameB + ' after-draft');
check(
  await has(A, 'Queued for ' + nameB),
  'sender told the message is queued (unsent text in its input)'
);
await wait(1500);
check(!(await text(B)).includes('after-draft'), 'nothing typed into the half-typed input');
N.pty.write(B, '\r');
check(await has(B, 'FAKE-codex got: "half typed"'), "the user's own text is sent alone");
check(
  await has(B, 'FAKE-codex got: "[from Claude Code · ' + nameA + '] after-draft"'),
  '…then the held message arrives as its own prompt'
);
type(A, 'tnai close ' + nameB);
const refused = await until(
  async () =>
    /wasstartedbytheuser|typedbyhand|Canbeclosed:none/.test((await text(A)).replace(/\s+/g, '')),
  15000
); // wrapped lines can repeat a character at the break
if (!refused) log.push('   A tail: ' + (await text(A)).slice(-400).replace(/\s+/g, ' '));
check(refused, '`tnai close` refuses an agent the user started (hand-launched ' + nameB + ')');
check(!!threadOf(B), '…and its thread stays open');
type(A, 'tnai close NoSuchAgent');
check(await has(A, 'No agent "NoSuchAgent"'), '`tnai close` of an unknown name is refused');
const history = await N.agentEvents.history();
check(
  history.some(e => e.paneId === B && e.kind === 'mesh-in') &&
    history.some(e => e.paneId === A && e.kind === 'mesh-out'),
  'relayed message is an activity event on both agents'
);

// 4c. Waits and links (desktop/agent-links.js): a question shows "waiting on NAME" in the asker's
// mesh state, on its thread list row and in `tnai agents`; the answer ends the wait and shows both
// as working with each other.
type(A, 'tnai send ' + nameB + ' which-file-is-yours?');

// The wait is recorded once the message is delivered, which for a stand-in CLI (it never confirms a
// prompt) takes the submit's own wait: 30 s here.
t0 = Date.now();
check(
  await until(() => noteOf(A).startsWith('waiting on ' + nameB), 30000),
  'a question to ' +
    nameB +
    " shows on the asker's card (" +
    (Date.now() - t0) +
    ' ms): ' +
    noteOf(A)
);
check(!/waiting on/.test(noteOf(B)), 'the asked agent shows no wait: ' + noteOf(B));

// What the user sees: the asker's row in the thread list says it while the agent is not working
// itself (119).
check(
  await until(() => threadOf(A)?.label === 'Waiting on ' + nameB, 10000),
  "the asker's thread list row: " + threadOf(A)?.label + ' (status ' + threadOf(A)?.status + ')'
);
type(A, 'tnai agents');
check(
  await until(async () => (await text(A)).replace(/\s+/g, '').includes('waitingon' + nameB), 15000),
  '`tnai agents` says who it waits on'
); // a wrapped line breaks the words
t0 = Date.now();
type(B, 'tnai send ' + nameA + ' main-js-is-mine');

// A stand-in Claude Code never says it took a prompt, and an unconfirmed delivery is not counted:
// say it the way the real CLI does (its prompt hook).
const hookA = body =>
  window.TnaiTest.request(url.hook, {
    method: 'POST',
    body: JSON.stringify({ session_id: 's', transcript_path: 't', cwd: 'c', ...body }),
  });
await has(A, 'main-js-is-mine');
await hookA({
  hook_event_name: 'UserPromptSubmit',
  prompt: '[from Codex · ' + nameB + '] main-js-is-mine',
});
check(
  await until(
    () =>
      noteOf(A).startsWith('working with ' + nameB) &&
      noteOf(B).startsWith('working with ' + nameA),
    30000
  ),
  'the answer ends the wait and both say who they work with (' +
    (Date.now() - t0) +
    ' ms): ' +
    noteOf(A) +
    ' | ' +
    noteOf(B)
);
check(/2 agents/.test(noteOf(A)), 'the connected count stays');
await hookA({ hook_event_name: 'Stop' }); // the stand-in's task is over, as before this step
type(B, 'tnai read ' + nameA + ' 80');
const readOk = await has(B, 'FAKE-claude start');
if (!readOk) log.push('   B tail: ' + (await text(B)).slice(-600).replace(/\s+/g, ' '));
check(readOk, '`tnai read` from Codex returns Claude’s recent output');
type(B, 'inject ' + nameA);

// Off Windows the fake reads the tty in cooked mode, so the message's line break ends a line there:
// what counts is the echoed paste, one ^[[200~ … ^[[201~ with the injected end marker left as plain
// "X[201~" and no ^G / ^C in between.
const injected = windows
  ? await has(A, 'X[201~INJECTED')
  : await until(
      async () => /\^\[\[200~\[from [^\]]+\] X\[201~\s+INJECTED\^\[\[201~/.test(await text(A)),
      15000
    );
if (!injected)
  log.push(
    '   A tail: ' +
      JSON.stringify((await text(A)).slice(-300)) +
      ' · B tail: ' +
      JSON.stringify((await text(B)).slice(-300))
  );
check(injected, 'control characters stripped: the message stays one pasted line');

// 5. A fake started outside every open project: registered, but not connected and refused.
const D = await shell();
type(
  D,
  windows
    ? "Set-Location -LiteralPath '" + outside.replace(/'/g, "''") + "'; claude"
    : "cd '" + outside.replace(/'/g, "'\\''") + "' && claude"
);
check(
  await until(() => session(D)?.agent === 'Claude Code'),
  'claude outside the project still registers as a session'
);
check(
  await until(() => /not in an open project/.test(noteOf(D))),
  'its mesh state says it is not connected: ' + noteOf(D)
);
type(D, 'tnai send ' + nameA + ' cross-folder-hello');
check(
  await has(D, 'not inside an open Technically Not project'),
  'send from another folder refused'
);
type(B, 'tnai send ' + session(D).name + ' should-not-arrive');
check(await has(B, 'No agent'), 'send to an agent in another folder refused');
check(
  !(await text(A)).includes('cross-folder-hello') && !(await text(D)).includes('should-not-arrive'),
  'nothing crossed folders'
);

// 6. Plain terminal: `claude -p` passes through; bad / missing token refused.
const C = await shell();
type(C, 'claude -p hi');
check(await has(C, 'FAKE-claude one-off'), '`claude -p` runs the CLI');
check(
  session(C)?.agent === 'Terminal' && (await text(C)).includes('settings=false'),
  '…without registering or adding Technically Not flags'
);
type(
  C,
  (windows ? '$env:TNAI_PANE_TOKEN=' : 'export TNAI_PANE_TOKEN=') +
    "'0123456789abcdef0123456789abcdef'; tnai agents"
);
check(await has(C, 'Refused'), 'a wrong token is refused');
type(
  C,
  windows ? 'Remove-Item Env:TNAI_PANE_TOKEN; tnai agents' : 'unset TNAI_PANE_TOKEN; tnai agents'
);
check(await has(C, 'not started by Technically Not'), 'no token: refused before connecting');

// 7. Quitting the CLI returns the pane to a plain terminal.
t0 = Date.now();
type(A, 'quit');
check(
  await until(() => session(A)?.agent === 'Terminal'),
  'claude exited → pane is a plain terminal again (' + (Date.now() - t0) + ' ms)'
);
check(
  await until(async () => (windows ? />\s*$/ : /\$\s*$/).test((await text(A)).trimEnd())),
  'PowerShell prompt is back'
);
check(
  await until(() => !/working with|waiting on/.test(noteOf(B))),
  'the CLI that left is no longer shown as working with the other: ' + noteOf(B)
);
check(!(await text(A)).includes('Terminate batch job'), 'no cmd "Terminate batch job" question');
check(await until(() => /no other agents/.test(noteOf(B))), 'Codex mesh state now: ' + noteOf(B));

// 7b. The other CLIs with a shim (here a fake `gemini`): a one-off (`--version`) stays a plain
// terminal; the CLI itself registers under its own name.
type(A, 'gemini --version');
check(await has(A, 'FAKE-gemini start'), 'gemini --version ran (through the shim)');
await wait(1500);
check(session(A)?.agent === 'Terminal', '…as a one-off: the pane stays a plain terminal');
type(A, 'quit');
await until(async () => (windows ? />\s*$/ : /\$\s*$/).test((await text(A)).trimEnd()));
type(A, 'gemini');
check(
  await until(() => session(A)?.agent === 'Gemini CLI'),
  'hand-typed gemini registers as a Gemini CLI session'
);
window.TnaiThreads.open();
check(
  await until(() => window.TnaiThreadList.thread(A)?.tool === 'Gemini CLI', 15000),
  'its row in the thread list names Gemini CLI, not PowerShell (' +
    window.TnaiThreadList.thread(A)?.tool +
    ')'
);
type(A, 'quit');
check(
  await until(() => session(A)?.agent === 'Terminal', 15000),
  'gemini exited → plain terminal again (' + session(A)?.agent + ')'
);

// 8. `cursor-agent` typed by hand gets Technically Not's hidden work rules (always-applied plugin
// rule via --plugin-dir).
const E = await shell();
type(E, 'cursor-agent');
check(
  await until(() => session(E)?.agent === 'Cursor Agent'),
  'hand-typed cursor-agent registers as a Cursor Agent session'
);
check(
  await has(E, 'FAKE-cursor-agent rules=true'),
  'Cursor Agent got the work rules (Technically Not report, tnai commands) as an alwaysApply plugin rule'
);
window.TnaiThreads.open();
await TnaiTest.shot('agent-mesh-threads');

// 8b. `tnai rename NAME` (the user asked the agent to rename itself): its panel takes the name; a
// name another agent has is refused.
type(E, 'tnai rename ' + nameB);
check(
  await has(E, 'is already named ' + nameB),
  '`tnai rename` to a name another agent has is refused'
);
type(E, 'tnai rename Funds ledger');
check(await has(E, 'to Funds ledger'), '`tnai rename NAME` answers with the new name');
check(
  await until(() => threadOf(E)?.name === 'Funds ledger', 5000),
  '…and its thread shows it: ' + threadOf(E)?.name
);

// Cursor Agent runs no prompt hook, so the app types the rename notice in as a prompt of its own
// (main.js tellRenames). A stand-in never confirms a prompt, so that submit waits its full time; a
// line typed meanwhile would join the notice. Wait until the notice was submitted alone.
check(
  await until(async () => {
    const flat = (await text(E)).replace(/\s+/g, '');
    return (
      flat.includes('got:"[fromTechnicallyNot]theuserrenamedyou') && /Noreplyneeded\."/.test(flat)
    );
  }, 45000),
  'the renamed agent is told its new name, as a prompt of its own'
);

// 9. `tnai close --self` (the user told the agent to close itself): the reply prints, then its
// panel closes like the Close button. With --successor the agent retires: a successor that isn't a
// live agent here is refused and nothing closes; a real one takes its messages (agent-lifecycle.js
// retire).
type(E, 'tnai close --self --successor NoSuchAgent');

// The refusal is a long line, so it wraps in the panel: match it with the white space taken out.
const handOverRefused = await until(
  async () => (await text(E)).replace(/\s+/g, '').includes('tohandoverto'),
  15000
);
if (!handOverRefused) log.push('   E tail: ' + (await text(E)).slice(-500).replace(/\s+/g, ' '));
check(handOverRefused, '`--successor` naming no live agent is refused');
check(!!threadOf(E), '…and its thread stays open');
type(E, 'tnai close --self --successor ' + nameB);
check(await has(E, 'Closed yourself'), '`tnai close --self` answers before closing');
check(
  await has(E, 'messages sent to you go to ' + nameB),
  '…and with --successor says who gets its messages from now on'
);
check(await until(() => !threadOf(E), 8000), '…and its own thread closes a moment later');
for (const p of [B, D]) type(p, 'quit');
await wait(300);
return { ok, log };
