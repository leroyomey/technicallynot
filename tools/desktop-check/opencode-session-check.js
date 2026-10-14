/*
 * Technically Not tools · desktop-check/opencode-session-check.js — Which OpenCode session belongs
 * to which panel (desktop/opencode-store.js findSession) and its task end reaching agent-turns.js,
 * against a fixture OpenCode database (no real CLI). Regression: an idle OpenCode panel started
 * earlier in the same folder took a sub-agent's session, so the sub-agent's panel never got its
 * turn end and its lead waited forever in tnai_wait. Run: node
 * tools/desktop-check/opencode-session-check.js
 */
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-opencode-'));
process.env.XDG_DATA_HOME = tmp;
const { DatabaseSync } = require('node:sqlite');
const store = require('../../desktop/opencode-store');
const turns = require('../../desktop/agent-turns');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const cwd = 'C:\\work\\proj',
  t0 = Date.now() - 60000;
const paste = s => '\x1b[200~' + s + '\x1b[201~';
const PIXEL =
  'You are "Pixel", a sub-agent that Nyx started in Technically Not. Current job: opencode reply test.\nWork only on the current job.\n\n[TN.ai] Task from Nyx: reply with the word OPENCODE-OK and nothing else';

const events = [];
turns.init((channel, payload) => events.push([channel, payload]));

// idle panel, started first; its own task never reached OpenCode
turns.started('cinder', 'OpenCode', '', '', cwd);
turns.started('pixel', 'OpenCode', '', '', cwd); // the sub-agent
turns.wrote('cinder', paste('Say hello to the team'));
turns.wrote('cinder', '\r');
turns.wrote('pixel', paste(PIXEL));
turns.wrote('pixel', '\r');

// OpenCode's record: only Pixel's session exists (a session appears with its first prompt),
// answered and finished; then one typed by hand.
fs.mkdirSync(path.join(tmp, 'opencode'), { recursive: true });
const db = new DatabaseSync(store.dbFile());
db.exec(
  'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_created INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);'
);
const J = JSON.stringify;
db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
  'ses_pixel',
  cwd.replace(/\\/g, '/'),
  t0 + 20000
);
db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
  'msg_u1',
  'ses_pixel',
  t0 + 20001,
  J({ role: 'user' })
);
db.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
  'prt_1',
  'msg_u1',
  J({ type: 'text', text: PIXEL })
);
db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
  'msg_a1',
  'ses_pixel',
  t0 + 20002,
  J({
    role: 'assistant',
    parentID: 'msg_u1',
    finish: 'stop',
    time: { created: t0 + 20002, completed: t0 + 23000 },
    modelID: 'big-pickle',
    providerID: 'opencode',
    tokens: { input: 10, output: 5 },
  })
);
db.prepare('INSERT INTO part VALUES (?, ?, ?)').run('prt_2', 'msg_a1', J({ type: 'step-start' }));
db.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
  'prt_3',
  'msg_a1',
  J({ type: 'text', text: 'OPENCODE-OK\n\nTechnically Not report\n- Did: replied.' })
);
db.close();

check(
  store.findSession(t0, cwd, new Set(), 'cinder') === '',
  'an idle OpenCode panel never takes the session another panel sent the first prompt of'
);
check(
  store.findSession(t0, cwd, new Set(), 'pixel') === 'ses_pixel',
  'the panel that sent the prompt gets its session'
);
check(
  store.findSession(t0, cwd, new Set()) === 'ses_pixel',
  'without a panel id: the first session in the folder, as before'
);

const w = new DatabaseSync(store.dbFile());
w.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
  'ses_typed',
  cwd.replace(/\\/g, '/'),
  t0 + 30000
);
w.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
  'msg_u2',
  'ses_typed',
  t0 + 30001,
  J({ role: 'user' })
);
w.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
  'prt_4',
  'msg_u2',
  J({ type: 'text', text: 'typed by hand in the TUI' })
);
w.close();
check(
  store.findSession(t0, cwd, new Set(['ses_pixel']), 'cinder') === 'ses_typed',
  'a session nobody pasted the prompt of (typed by hand) can still be found'
);

turns.fromPty('pty:session', { paneId: 'pixel', sessionId: 'ses_pixel' });
const end = events.filter(([c, p]) => c === 'agent:turn' && p.paneId === 'pixel').at(-1)?.[1];
check(
  !!end && end.endedAt === t0 + 23000 && end.endedBy === 'stop',
  'the sub-agent panel gets its task end from the OpenCode record'
);
check(
  !!end && end.result.startsWith('OPENCODE-OK') && end.result.includes('Technically Not report'),
  'its answer (with the Technically Not report) is the result the lead gets'
);

// Real-shaped rows (OpenCode 1.18.32, the live Kestrel run 2026-09-26): its session is found
// mid-task, before the answer is written. The end is then written without the WAL watcher firing
// (this fixture has no WAL, like the reused WAL file Windows sent no event for); the panel's redraw
// re-reads it.
(async () => {
  const KESTREL =
    'You are "Kestrel", a sub-agent that Rook started in Technically Not. Current job: OpenCode reply check.\nWork only on the current job. When you are done, end with a short report for Rook: what you did, files changed, what you verified and what you did not. Technically Not hands your final message to it automatically.\nDo not start other agents or sub-agents; do the work yourself.\nYou may be given further tasks later. Treat each "[TN.ai] New task" as its own job; carry over only what is relevant to it.\n\n[TN.ai] Task from Rook: reply with the word OPENCODE-OK and nothing else';
  const k0 = t0 + 40000;
  turns.started('kestrel', 'OpenCode', '', '', cwd);
  turns.wrote('kestrel', paste(KESTREL));
  turns.wrote('kestrel', '\r');
  const k = new DatabaseSync(store.dbFile());
  k.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
    'ses_kestrel',
    cwd.replace(/\\/g, '/'),
    k0 + 3891
  );
  k.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
    'msg_ku',
    'ses_kestrel',
    k0 + 3909,
    J({
      role: 'user',
      time: { created: k0 + 3909 },
      agent: 'build',
      model: { providerID: 'opencode', modelID: 'big-pickle' },
      summary: { diffs: [] },
    })
  );
  k.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_k1',
    'msg_ku',
    J({ type: 'text', text: KESTREL + ' ' })
  ); // OpenCode keeps a trailing space
  const assistant = done =>
    J({
      parentID: 'msg_ku',
      role: 'assistant',
      mode: 'build',
      agent: 'build',
      path: { cwd, root: cwd },
      cost: 0,
      tokens: {
        total: 22235,
        input: 20264,
        output: 29,
        reasoning: 0,
        cache: { write: 0, read: 1942 },
      },
      modelID: 'big-pickle',
      providerID: 'opencode',
      time: { created: k0 + 3923, ...(done ? { completed: k0 + 7334 } : {}) },
      ...(done ? { finish: 'stop' } : {}),
    });
  k.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
    'msg_ka',
    'ses_kestrel',
    k0 + 3923,
    assistant(false)
  );
  k.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_k2',
    'msg_ka',
    J({ snapshot: 'daec', type: 'step-start' })
  );
  check(
    store.findSession(k0, cwd, new Set(['ses_pixel', 'ses_typed']), 'kestrel') === 'ses_kestrel',
    'real-shaped: the panel that pasted the intro + task gets its OpenCode session'
  );
  turns.fromPty('pty:session', { paneId: 'kestrel', sessionId: 'ses_kestrel' });
  const last = () =>
    events.filter(([c, p]) => c === 'agent:turn' && p.paneId === 'kestrel').at(-1)?.[1];
  check(
    !!last() && last().startedAt === k0 + 3909 && !last().endedAt,
    'real-shaped: found mid-task, its task shows as started'
  );
  k.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_k3',
    'msg_ka',
    J({
      type: 'text',
      text: 'OPENCODE-OK\n\nTechnically Not report\n- Did: Replied with the required word only, as instructed.\n- Changed: nothing.',
      time: { start: k0 + 6800, end: k0 + 7100 },
    })
  );
  k.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_k4',
    'msg_ka',
    J({
      reason: 'stop',
      snapshot: 'daec',
      type: 'step-finish',
      tokens: { total: 22235, input: 20264, output: 29 },
      cost: 0,
    })
  );
  k.prepare('UPDATE message SET data = ? WHERE id = ?').run(assistant(true), 'msg_ka');
  k.close();
  await new Promise(r => setTimeout(r, 700));
  check(
    !last().endedAt,
    'real-shaped: no WAL event, no output → the end is not seen yet (the live failure)'
  );

  // OpenCode redraws when its task ends
  turns.fromPty('pty:data', [{ paneId: 'kestrel', data: '\x1b[2J done' }]);
  await new Promise(r => setTimeout(r, 700));
  const e = last();
  check(
    !!e &&
      e.endedAt === k0 + 7334 &&
      e.endedBy === 'stop' &&
      e.result.startsWith('OPENCODE-OK') &&
      e.result.includes('Changed: nothing'),
    "real-shaped: the panel's redraw re-reads the record and the task end + answer arrive"
  );
  check(
    !!e &&
      e.tokens?.input === 20264 &&
      e.tokens?.cacheRead === 1942 &&
      e.model === 'opencode/big-pickle',
    'real-shaped: tokens and model read from the assistant message'
  );

  // The agent's own to-do list (its todowrite call, from the step plugin) is the task's checklist
  // while it works, and an interrupted task ends. The assistant row is the real shape of an
  // interrupted run (opencode 1.18.35, 2026-10-06): an error, time.completed, no finish, no parts.
  const a0 = t0 + 50000,
    turnOf = id => events.filter(([c, p]) => c === 'agent:turn' && p.paneId === id).at(-1)?.[1];
  turns.started('abort', 'OpenCode', '', '', cwd);
  turns.started('claude', 'Claude Code', '', '', cwd);
  turns.wrote('abort', paste('count slowly to one hundred'));
  turns.wrote('abort', '\r');
  const a = new DatabaseSync(store.dbFile());
  const row = (id, ses, at, data) =>
    a.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(id, ses, at, J(data));
  const aborted = over => ({
    parentID: 'msg_abu',
    role: 'assistant',
    mode: 'build',
    agent: 'build',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: 'big-pickle',
    providerID: 'opencode',
    time: { created: a0 + 300, ...(over ? { completed: a0 + 6000 } : {}) },
    ...(over ? { error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } } : {}),
  });
  a.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
    'ses_abort',
    cwd.replace(/\\/g, '/'),
    a0
  );
  row('msg_abu', 'ses_abort', a0 + 10, { role: 'user', time: { created: a0 + 10 } });
  a.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_ab1',
    'msg_abu',
    J({ type: 'text', text: 'count slowly to one hundred' })
  );
  row('msg_aba', 'ses_abort', a0 + 300, aborted(false));
  turns.fromPty('pty:session', { paneId: 'abort', sessionId: 'ses_abort' });
  check(
    !!turnOf('abort') && !turnOf('abort').endedAt,
    'interrupted run: the task shows as working before the interrupt'
  );
  const todos = [
    { content: 'Read the code', status: 'completed' },
    { content: 'Write the fix', status: 'in_progress' },
    { content: 'Dropped idea', status: 'cancelled' },
    { content: 'Run the check', status: 'pending' },
  ];
  check(
    turns.step('abort', 'todowrite', { todos }) === true &&
      turns.step('abort', 'edit', { filePath: 'C:\\work\\proj\\a.js' }) === true,
    "a step of an OpenCode panel is taken as OpenCode's"
  );
  check(
    turns.step('claude', 'todowrite', { todos }) === false &&
      turns.step('nobody', 'todowrite', { todos }) === false,
    'a step of a Claude Code panel or an unknown panel is not'
  );
  await new Promise(r => setTimeout(r, 300));
  const s = turnOf('abort')?.steps;
  check(
    !!s && s.index === 2 && s.total === 3 && s.done === 1 && s.text === 'Write the fix',
    "OpenCode's to-do list is the checklist: step 2 of 3, the cancelled item left out: " +
      JSON.stringify(s)
  );
  a.prepare('UPDATE message SET data = ? WHERE id = ?').run(J(aborted(true)), 'msg_aba');
  turns.fromPty('pty:data', [{ paneId: 'abort', data: '\x1b[2J interrupted' }]);
  await new Promise(r => setTimeout(r, 700));
  const ab = turnOf('abort');
  check(
    !!ab && ab.endedAt === a0 + 6000 && ab.endedBy === 'interrupted' && ab.result === '',
    'interrupted run: the task ends as interrupted, with no answer: ' +
      JSON.stringify(ab && { endedAt: ab.endedAt - a0, endedBy: ab.endedBy })
  );

  // Any other error on the last step ends the task as an error and keeps its message.
  a.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
    'ses_err',
    cwd.replace(/\\/g, '/'),
    a0 + 7000
  );
  row('msg_eu', 'ses_err', a0 + 7010, { role: 'user', time: { created: a0 + 7010 } });
  row('msg_ea', 'ses_err', a0 + 7300, {
    parentID: 'msg_eu',
    role: 'assistant',
    tokens: { input: 0, output: 0 },
    time: { created: a0 + 7300, completed: a0 + 7900 },
    error: { name: 'APIError', data: { message: 'Rate limit reached' } },
  });
  const er = store.lastTurn('ses_err');
  check(
    er.endedAt === a0 + 7900 &&
      er.endedBy === 'error' &&
      er.error === 'Rate limit reached' &&
      er.result === '',
    'failed run: the task ends as an error and keeps the reason: ' +
      JSON.stringify({ endedBy: er.endedBy, error: er.error })
  );

  // A step that only called tools and a normal finish are read as before.
  row('msg_ea2', 'ses_err', a0 + 8000, {
    parentID: 'msg_eu',
    role: 'assistant',
    finish: 'tool-calls',
    time: { created: a0 + 8000, completed: a0 + 8100 },
  });
  check(
    store.lastTurn('ses_err').endedAt === 0,
    'a later step that only called tools: the task is still working'
  );

  // Failed before OpenCode wrote any answer row (real shape: a model it does not have): only the
  // user message exists. The record cannot show that end, so it must not be made up here;
  // OpenCode's own events will (not built yet).
  a.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
    'ses_nomodel',
    cwd.replace(/\\/g, '/'),
    a0 + 9000
  );
  row('msg_nu', 'ses_nomodel', a0 + 9010, {
    role: 'user',
    time: { created: a0 + 9010 },
    agent: 'build',
    model: { providerID: 'opencode', modelID: 'no-such-model-xyz' },
  });
  const nm = store.lastTurn('ses_nomodel');
  check(
    !!nm && nm.endedAt === 0 && nm.endedBy === '' && nm.tokens === null,
    'failed before any answer was written: no end is made up from the record (known limit)'
  );

  // A /compact after a finished task (real shape, opencode 1.18.35, 2026-10-06): a user message
  // whose only part is { type: 'compaction' } and an answer with mode / agent 'compaction' and
  // summary: true. It is not a task: the task before it stays the latest, and its end is told once.
  const c0 = a0 + 12000,
    part = (id, msg, data) => a.prepare('INSERT INTO part VALUES (?, ?, ?)').run(id, msg, J(data));
  a.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(
    'ses_compact',
    cwd.replace(/\\/g, '/'),
    c0
  );
  row('msg_cu', 'ses_compact', c0 + 10, {
    role: 'user',
    time: { created: c0 + 10 },
    agent: 'build',
  });
  part('prt_cu', 'msg_cu', { type: 'text', text: 'Create hello.txt containing hi' });
  row('msg_ca', 'ses_compact', c0 + 20, {
    parentID: 'msg_cu',
    role: 'assistant',
    mode: 'build',
    agent: 'build',
    tokens: {
      total: 27431,
      input: 154,
      output: 3,
      reasoning: 10,
      cache: { write: 0, read: 27264 },
    },
    modelID: 'big-pickle',
    providerID: 'opencode',
    time: { created: c0 + 20, completed: c0 + 4000 },
    finish: 'stop',
  });
  part('prt_ca', 'msg_ca', { type: 'text', text: 'done' });
  turns.started('compact', 'OpenCode', '', '', cwd);
  turns.fromPty('pty:session', { paneId: 'compact', sessionId: 'ses_compact' });
  const ends = () =>
      events.filter(([c, p]) => c === 'agent:turn' && p.paneId === 'compact' && p.endedAt).length,
    before = turnOf('compact');
  check(
    !!before && before.result === 'done' && before.context?.tokens === 154 + 27264,
    "before a compaction: the task's answer and its context size (" + before?.context?.tokens + ')'
  );
  row('msg_xu', 'ses_compact', c0 + 7000, {
    role: 'user',
    model: { providerID: 'opencode', modelID: 'big-pickle' },
    agent: 'build',
    time: { created: c0 + 7000 },
    summary: { diffs: [] },
  });
  part('prt_xu', 'msg_xu', { type: 'compaction', auto: false });
  const mid = store.lastTurn('ses_compact');
  check(
    mid.id === 'msg_cu' && mid.context === null && mid.compactedAt === c0 + 7000,
    'while the summary is being written: the context size is unknown, not the old one'
  );
  row('msg_xa', 'ses_compact', c0 + 7010, {
    role: 'assistant',
    parentID: 'msg_xu',
    mode: 'compaction',
    agent: 'compaction',
    summary: true,
    cost: 0,
    tokens: { total: 883, input: 641, output: 237, reasoning: 5, cache: { write: 0, read: 0 } },
    modelID: 'big-pickle',
    providerID: 'opencode',
    time: { created: c0 + 7010, completed: c0 + 14000 },
    finish: 'stop',
  });
  part('prt_xa', 'msg_xa', { type: 'text', text: '## Objective\n- Create a file hello.txt' });
  const n0 = events.length;
  turns.fromPty('pty:data', [{ paneId: 'compact', data: '\x1b[2J compacted' }]);
  await new Promise(r => setTimeout(r, 700));
  const after = turnOf('compact'),
    ct = store.lastTurn('ses_compact');
  check(
    ct.id === 'msg_cu' &&
      ct.task === 'Create hello.txt containing hi' &&
      ct.result === 'done' &&
      ct.endedAt === c0 + 4000 &&
      ct.compactedAt === c0 + 14000,
    'after /compact: the task before it is still the latest one, the summary is not its result'
  );
  check(
    !!after &&
      after.startedAt === c0 + 10 &&
      after.endedAt === c0 + 4000 &&
      after.result === 'done' &&
      after.context?.tokens === 883 &&
      after.context.at === c0 + 14000,
    "the panel keeps that task; its context size is the finished summary answer's tokens.total (" +
      after?.context?.tokens +
      ')'
  );
  check(
    events.slice(n0).filter(([c, p]) => c === 'agent:turn' && p.paneId === 'compact').length ===
      1 && after.task !== '',
    'the compaction is told as one update of the same ended task, not as a new empty task (' +
      ends() +
      ' updates of the ended task in all)'
  );
  row('msg_nu2', 'ses_compact', c0 + 20000, {
    role: 'user',
    time: { created: c0 + 20000 },
    agent: 'build',
  });
  part('prt_nu2', 'msg_nu2', { type: 'text', text: 'next task' });
  row('msg_na2', 'ses_compact', c0 + 20010, {
    parentID: 'msg_nu2',
    role: 'assistant',
    tokens: { input: 900, output: 5, cache: { read: 0, write: 0 } },
    modelID: 'big-pickle',
    providerID: 'opencode',
    time: { created: c0 + 20010 },
  });
  const nx = store.lastTurn('ses_compact');
  check(
    nx.id === 'msg_nu2' && nx.compactedAt === 0 && nx.context?.tokens === 900,
    'the next task after a compaction is read as usual, with the new context size from its first answer'
  );
  a.close();
  turns.forget('compact');

  turns.forget('abort');
  turns.forget('claude');
  turns.forget('pixel');
  turns.forget('cinder');
  turns.forget('kestrel');
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '\nopencode-session-check: all passed' : '\nopencode-session-check: FAILED');
  process.exit(ok ? 0 : 1);
})();
