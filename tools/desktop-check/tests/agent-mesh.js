// Technically Not tools · desktop-check/tests/agent-mesh.js — Agent CLIs typed by hand into plain
// PowerShell panes (37 + desktop/agent-mesh.js + agent-shim.js), using FAKE `claude` / `codex` CLIs
// from agent-mesh.main.js (never the real CLIs, no credits): `claude` / `codex` register as live
// agent sessions of that provider (Overview card, mesh note), get Technically Not's launch
// additions (Claude: --settings/--mcp-config/hint in an --append-system-prompt-file; Codex: hint in
// developer_instructions of a `-p tnai` profile file; Cursor Agent: work rules as an alwaysApply
// rule in a --plugin-dir folder), a real console (TTY), Claude hook events reach the pane's team
// view; `tnai agents` / `tnai send` / `tnai read` work between the two fakes in the project; a fake
// started outside every open project is not connected and is refused; a bad or missing token is
// refused; control characters in a message can't break out of the paste; `claude -p` passes through
// unregistered; quitting the CLI returns the pane to a plain terminal. Returns {ok, log}.
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
window.TnaiRoute('overview');
const cardA = await until(() => document.querySelector('.tnai-card[data-pane="' + A + '"]'));

// the card can be drawn a moment before the session is known as Claude Code's (failed 2 of 3 runs
// on a busy PC, 2026-10-06)
await until(() => /Claude Code/.test(cardA?.querySelector('.c-sub')?.textContent || ''), 5000);
check(
  /Claude Code/.test(cardA?.querySelector('.c-sub')?.textContent || ''),
  'Overview card labelled with its provider: ' + cardA?.querySelector('.c-sub')?.textContent
);

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
const note = await until(() => {
  const n = document.querySelector('.tnai-card[data-pane="' + A + '"] .tnai-mesh-note');
  return n && /2 agents/.test(n.textContent) && n;
});
check(!!note, 'card note: ' + note?.textContent);

// 3. Claude Code hook events from the hand-started session reach the pane (sub-agent under its
// card).
const url = await N.agentEvents.endpoint(A);
check(!!url?.hook, 'hand-started Claude has its own hook URL');
if (url?.hook) {
  const post = body =>
    fetch(url.hook, {
      method: 'POST',
      mode: 'no-cors',
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
check(
  document.querySelector('.terminal-pane[data-pane-id="' + B + '"]'),
  '…and its pane stays open'
);
type(A, 'tnai close NoSuchAgent');
check(await has(A, 'No agent "NoSuchAgent"'), '`tnai close` of an unknown name is refused');
const history = await N.agentEvents.history();
check(
  history.some(e => e.paneId === B && e.kind === 'mesh-in') &&
    history.some(e => e.paneId === A && e.kind === 'mesh-out'),
  'relayed message is an activity event on both agents'
);

// 4c. Waits and links (desktop/agent-links.js): a question shows "waiting on NAME" on the asker's
// card and in `tnai agents`; the answer ends the wait and shows both as working with each other.
const noteOf = paneId =>
  document.querySelector('.tnai-card[data-pane="' + paneId + '"] .tnai-mesh-note')?.textContent ||
  '';
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
check(!/waiting on/.test(noteOf(B)), "the asked agent's card shows no wait: " + noteOf(B));
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
  fetch(url.hook, {
    method: 'POST',
    mode: 'no-cors',
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
  'the answer ends the wait and both cards say who they work with (' +
    (Date.now() - t0) +
    ' ms): ' +
    noteOf(A) +
    ' | ' +
    noteOf(B)
);
check(/2 agents/.test(noteOf(A)), 'the connected count stays on the card');
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

// 4d. Three agents (A Claude, B Codex, F a second Codex) with real `tnai send` lines: a ring of
// questions, one answer that breaks it, and an agent that exchanged messages both ways with two
// others.
const F = await shell();
type(F, 'codex');
check(await until(() => session(F)?.agent === 'Codex'), 'third agent (a second codex) registers');
const nameF = session(F)?.name || '';
const flat = s => String(s || '').replace(/\s+/g, '');
const hasFlat = (paneId, needle, ms = 30000) =>
  until(async () => flat(await text(paneId)).includes(flat(needle)), ms);
const toA = async text => {
  await has(A, text, 30000);
  await hookA({ hook_event_name: 'UserPromptSubmit', prompt: text });
}; // a stand-in Claude never confirms a prompt: say it via its hook
type(A, 'tnai send ' + nameB + ' ring-a-asks-b?');
check(
  await until(() => noteOf(A).startsWith('waiting on ' + nameB), 30000),
  'ring 1/3: A waits on B: ' + noteOf(A)
);
type(B, 'tnai send ' + nameF + ' ring-b-asks-f?');
check(
  await until(() => noteOf(B).startsWith('waiting on ' + nameF), 30000),
  'ring 2/3: B waits on the third agent: ' + noteOf(B)
);
type(F, 'tnai send ' + nameA + ' ring-f-asks-a?');
await toA('[from Codex · ' + nameF + '] ring-f-asks-a?');
const ringed = await until(
  () => [A, B, F].every(p => noteOf(p).startsWith('waiting on each other')),
  30000
);
if (!ringed) log.push('   notes: ' + [A, B, F].map(noteOf).join(' | '));
check(
  ringed,
  'a ring of three questions: every card says "waiting on each other": ' +
    [A, B, F].map(noteOf).join(' | ')
);
check(
  await hasFlat(F, 'leads back to you'),
  'the last sender is told in its terminal that the wait leads back to it'
);

// One answer (B answers A, no question) breaks the ring.
type(B, 'tnai send ' + nameA + ' ring-b-answers-a');
await toA('[from Codex · ' + nameB + '] ring-b-answers-a');
const broken = await until(() => ![A, B, F].some(p => /each other/.test(noteOf(p))), 30000);
if (!broken) log.push('   notes: ' + [A, B, F].map(noteOf).join(' | '));
check(
  broken,
  'one answer breaks the ring: no card says "each other": ' + [A, B, F].map(noteOf).join(' | ')
);

// B now also gets an answer from the third agent: B exchanged messages both ways with A and with
// it.
type(F, 'tnai send ' + nameB + ' f-answers-b');
const hub = await until(() => {
  const n = noteOf(B);
  return /^working with /.test(n) && n.includes(nameA) && n.includes(nameF) && n;
}, 30000);
if (!hub) log.push('   notes: ' + [A, B, F].map(noteOf).join(' | '));
check(
  !!hub,
  'an agent that exchanged messages both ways with two others shows "working with X, Y": ' +
    noteOf(B)
);

// before A's Stop: that tells F its question went unanswered, typed into F's input as text that
// would swallow the quit
type(F, 'quit');

// its own pending `tnai send` finishes first
await until(() => session(F)?.agent === 'Terminal', 40000);
await hookA({ hook_event_name: 'Stop' });
check(
  await until(() => /2 agents/.test(noteOf(B)) && !noteOf(B).includes(nameF), 30000),
  'the third agent left: B counts 2 agents and no longer names it (its link with A stays): ' +
    noteOf(B)
);

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
  await until(() =>
    /not in an open project/.test(
      document.querySelector('.tnai-card[data-pane="' + D + '"] .tnai-mesh-note')?.textContent || ''
    )
  ),
  'its card says it is not connected'
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
check(
  await until(() =>
    /no other agents/.test(
      document.querySelector('.tnai-card[data-pane="' + B + '"] .tnai-mesh-note')?.textContent || ''
    )
  ),
  'Codex card now: ' +
    document.querySelector('.tnai-card[data-pane="' + B + '"] .tnai-mesh-note')?.textContent
);

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
window.TnaiRoute('overview');
await wait(300);
console.log('TNAI_SHOT:agent-mesh-overview');
await wait(400);

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
  document.querySelector('.terminal-pane[data-pane-id="' + E + '"] .terminal-pane-title')
    ?.textContent === 'Funds ledger',
  '…and the panel shows it'
);

// 9. `tnai close --self` (the user told the agent to close itself): the reply prints, then its
// panel closes like the Close button. With --successor the agent retires: a successor that isn't a
// live agent here is refused and nothing closes; a real one takes its messages (agent-lifecycle.js
// retire).
type(E, 'tnai close --self --successor NoSuchAgent');
check(await has(E, 'to hand over to'), '`--successor` naming no live agent is refused');
check(
  !!document.querySelector('.terminal-pane[data-pane-id="' + E + '"]'),
  '…and the panel stays open'
);
type(E, 'tnai close --self --successor ' + nameB);
check(await has(E, 'Closed yourself'), '`tnai close --self` answers before closing');
check(
  await has(E, 'messages sent to you go to ' + nameB),
  '…and with --successor says who gets its messages from now on'
);
check(
  await until(() => !document.querySelector('.terminal-pane[data-pane-id="' + E + '"]'), 8000),
  '…and its own panel closes a moment later'
);
for (const p of [B, D]) type(p, 'quit');
await wait(300);
return { ok, log };
