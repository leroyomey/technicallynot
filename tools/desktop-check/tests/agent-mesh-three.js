// Technically Not tools · desktop-check/tests/agent-mesh-three.js — Waits and links among three
// agents (desktop/agent-links.js), moved out of agent-mesh.js (its step 4d) so neither test comes
// near the runner's time limit. Three FAKE CLIs from agent-mesh-three.main.js (the same stand-ins
// as agent-mesh, never the real CLIs, no credits), typed by hand into plain panels: A a Claude
// Code, B and F two Codex. Real `tnai send` lines make a ring of questions (every agent's mesh
// state says "waiting on each other", the last sender is told), one answer breaks it, and an agent
// that exchanged messages both ways with two others shows "working with X, Y"; when the third
// leaves, B no longer names it. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

// report what failed instead of hitting the runner's time limit
const deadline = Date.now() + 300000;
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
const { bin } = await main('paths');

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

// The three agents: A a Claude Code, B and F two Codex.
const A = await shell();
type(A, 'claude');
check(await until(() => session(A)?.agent === 'Claude Code'), 'A (claude) registers');
const B = await shell();
type(B, 'codex');
check(await until(() => session(B)?.agent === 'Codex'), 'B (codex) registers');
const F = await shell();
type(F, 'codex');
check(await until(() => session(F)?.agent === 'Codex'), 'third agent (a second codex) registers');
const nameA = session(A)?.name || '',
  nameB = session(B)?.name || '',
  nameF = session(F)?.name || '';
window.TnaiThreads.open();

// The old Overview card's note is gone with the old frame. The thread layout reads the same waits
// and links from TnaiMesh (37): the thread list tones a waiting thread and says "Waiting on NAME".
// So the checks read that state and spell it the way the note did.
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

// A stand-in Claude Code never says it took a prompt, and an unconfirmed delivery is not counted:
// say it the way the real CLI does (its prompt hook).
const url = await N.agentEvents.endpoint(A);
check(!!url?.hook, 'A has its own hook URL');
const hookA = body =>
  window.TnaiTest.request(url.hook, {
    method: 'POST',
    body: JSON.stringify({ session_id: 's', transcript_path: 't', cwd: 'c', ...body }),
  });
const flat = s => String(s || '').replace(/\s+/g, '');
const hasFlat = (paneId, needle, ms = 30000) =>
  until(async () => flat(await text(paneId)).includes(flat(needle)), ms);
const toA = async text => {
  await has(A, text, 30000);
  await hookA({ hook_event_name: 'UserPromptSubmit', prompt: text });
};

// A ring of three questions.
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
  'a ring of three questions: every agent says "waiting on each other": ' +
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
  'one answer breaks the ring: no agent says "each other": ' + [A, B, F].map(noteOf).join(' | ')
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
for (const p of [A, B]) type(p, 'quit');
await wait(300);
return { ok, log };
