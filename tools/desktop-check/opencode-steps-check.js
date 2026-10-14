/*
 * Technically Not tools · desktop-check/opencode-steps-check.js — OpenCode's step plugin on the
 * app's side (desktop/agent-hooks.js stepPlugin, onStep, openCodeEvent, gateDenied;
 * desktop/agent-turns.js openCodeEvent), plain Node, no CLI and no model call. Payloads are the
 * shapes opencode 1.18.35 sent in one real run (2026-10-06). Checks: busy reads the record at once
 * and gives the panel its session; an error then idle ends a task OpenCode wrote no answer row for;
 * a task ended on an error works again when OpenCode goes busy again; a tool's end feeds the loop
 * check and the shell timing; the waiting route refuses an edit of a held file and a guarded git
 * command, and lets everything else run; permission requests, questions, child sessions and the
 * server address are recorded; another CLI's panel is untouched. Usage: node
 * tools/desktop-check/opencode-steps-check.js. Exit code 1 when a check fails.
 */
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  Module = require('module');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-opencode-steps-'));
fs.mkdirSync(path.join(tmp, 'user'));
process.env.XDG_DATA_HOME = tmp; // OpenCode's database for this check (opencode-store.js)
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? {
        app: {
          getPath: () => path.join(tmp, 'user'),
          whenReady: () => new Promise(() => {}),
          on: () => {},
        },
        shell: { openPath: async () => '' },
        dialog: {},
      }
    : load(req, ...rest);
const { DatabaseSync } = require('node:sqlite');
const store = require('../../desktop/opencode-store');
const turns = require('../../desktop/agent-turns');
const loops = require('../../desktop/agent-loops');
const hooks = require('../../desktop/agent-hooks');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const sent = [],
  shell = [];
const send = (channel, payload) => sent.push([channel, payload]);

// Stand-in file locks: one held file, and the shell timing calls written down. The real decisions
// are file-lock-check.js's.
const locks = {
  acquire: (project, file) =>
    /locked\.txt$/.test(file)
      ? { ok: false, text: path.basename(file) + ' is held by Rook (Claude Code).' }
      : { ok: true },
  shellStart: (paneId, id) => shell.push('start ' + id),
  shellEnd: (paneId, id) => shell.push('end ' + id),
  shellStop: () => shell.push('stop'),
  diskChanges() {},
};
const cwd = path.join(tmp, 'proj');
turns.init(send);
hooks.init(send, {
  root: () => cwd,
  locks,
  owner: async paneId => ({ project: cwd, paneId, name: 'Oc' }),
});
let clock = Date.now();
loops.init(null, { now: () => clock });
const post = (url, body) =>
  new Promise(resolve => {
    const r = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      res => {
        let t = '';
        res.on('data', c => (t += c));
        res.on('end', () => {
          let j = null;
          try {
            j = JSON.parse(t);
          } catch {}
          resolve({ status: res.statusCode, body: j });
        });
      }
    );
    r.on('error', () => resolve({ status: 0, body: null }));
    r.end(JSON.stringify(body));
  });
const turnOf = id => sent.filter(([c, p]) => c === 'agent:turn' && p.paneId === id).at(-1)?.[1];
const J = JSON.stringify;

(async () => {
  const oc = 'terminal-opencode-1',
    cur = 'terminal-cursor-1',
    ses = 'ses_check0001',
    t0 = Date.now() - 5000;
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(tmp, 'opencode'), { recursive: true });
  const db = new DatabaseSync(store.dbFile());
  db.exec(
    'CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT, parent_id TEXT, time_created INTEGER); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT);'
  );
  const row = (id, at, data) =>
    db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(id, ses, at, J(data));

  const o = await hooks.launchOptions(oc, 'OpenCode');
  await hooks.launchOptions(cur, 'Cursor Agent');
  turns.started(oc, 'OpenCode', '', '', cwd);
  turns.started(cur, 'Cursor Agent', '', '', cwd);
  const at = hooks.endpoint(oc),
    step = at.step,
    gate = step.replace('/step/', '/gate/'),
    curStep = hooks.endpoint(cur).step;
  const plugin = fs.readFileSync(path.join(path.dirname(o.rulesFile), 'opencode-steps.js'), 'utf8');
  check(
    /'tool\.execute\.after'/.test(plugin) &&
      /AbortSignal\.timeout\(2000\)/.test(plugin) &&
      /replace\('\/step\/', '\/gate\/'\)/.test(plugin) &&
      !/output\.output\s*[,}]\s*\)/.test(plugin.replace(/mark\(output && output\.output\)/, '')),
    'the plugin file reports tool ends by a mark only and waits on one call, 2 s at most'
  );
  const say = (event, more = {}) => post(step, { event, session: ses, child: false, ...more });
  const status = type =>
    say('session.status', { properties: { sessionID: ses, status: { type } } });

  // Task start, and a task that fails before OpenCode writes any answer row (real shape: a model it
  // does not have).
  db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run(ses, cwd.replace(/\\/g, '/'), t0);
  row('msg_u1', t0 + 10, { role: 'user', time: { created: t0 + 10 } });
  db.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_u1',
    'msg_u1',
    J({ type: 'text', text: 'Say hi.' })
  );
  check(
    (await post(step, { event: 'server', url: 'http://127.0.0.1:47049/' })).status === 204 &&
      hooks.openCode(oc)?.server === 'http://127.0.0.1:47049/',
    "the plugin's own server address is kept for the panel"
  );
  await status('busy');
  await wait(30);
  check(
    !!turnOf(oc) && turnOf(oc).startedAt === t0 + 10 && !turnOf(oc).endedAt,
    "busy: the panel takes the event's session and its task shows as started at once (no watch, no redraw)"
  );
  await say('session.error', {
    properties: {
      sessionID: ses,
      error: {
        name: 'UnknownError',
        data: {
          message:
            'Model not found: opencode/no-such-model-xyz. Did you mean: gpt-5-nano?\n    at <anonymous>',
        },
      },
    },
  });
  await say('session.idle', { properties: { sessionID: ses } });
  await status('idle');
  await wait(30);
  const failed = turnOf(oc);
  check(
    !!failed &&
      failed.endedAt > 0 &&
      failed.endedBy === 'error' &&
      /^Model not found: opencode\/no-such-model-xyz/.test(failed.error) &&
      !/anonymous/.test(failed.error),
    'error then idle with no answer row: the task ends as an error with its first line as the reason: ' +
      J(failed && { endedBy: failed.endedBy, error: failed.error })
  );
  check(shell.at(-1) === 'stop', 'idle ends the shell timing of the turn, once: ' + J(shell));

  // OpenCode tries again by itself: busy on the same prompt reopens the task; then it answers and
  // ends normally.
  await status('busy');
  await wait(700);
  check(
    !!turnOf(oc) &&
      !turnOf(oc).endedAt &&
      turnOf(oc).startedAt === t0 + 10 &&
      turnOf(oc).error === '',
    'busy again on the same prompt: the task that ended on an error works again'
  );

  // Steps while it works: a to-do list, a shell command with its end, an edit, and a repeated call
  // for the loop check.
  await say('todo.updated', {
    properties: {
      sessionID: ses,
      todos: [
        { content: 'write files', status: 'in_progress' },
        { content: 'run echo', status: 'pending' },
      ],
    },
  });
  await post(step, {
    event: 'tool',
    tool: 'bash',
    input: { command: 'echo probe-done' },
    call: 'call_b1',
  });
  await post(step, { event: 'tool-end', tool: 'bash', call: 'call_b1', result: '1mi30qi:11' });
  await wait(200);
  check(
    shell.slice(-2).join(', ') === 'start call_b1, end call_b1',
    "a shell command's start and end reach the file locks' run timing: " + J(shell.slice(-2))
  );
  check(
    turnOf(oc)?.steps?.index === 1 &&
      turnOf(oc).steps.total === 2 &&
      turnOf(oc).steps.text === 'write files',
    'todo.updated is the checklist: ' + J(turnOf(oc)?.steps)
  );
  const tools = () =>
      sent.filter(([c, p]) => c === 'agent:event' && p.kind === 'tool' && p.paneId === oc).length,
    nTools = tools();

  // a refused call was never a step: its end is dropped
  await post(step, { event: 'tool-end', tool: 'write', call: 'call_refused', failed: true });
  const limit = loops.LIMITS.SAME_CALL + 2;
  for (let i = 0; i < limit; i++) {
    clock += Math.ceil(loops.LIMITS.MIN_SPAN_MS / (limit - 2)) + 1000;
    await post(step, {
      event: 'tool',
      tool: 'read',
      input: { filePath: path.join(cwd, 'a.js') },
      call: 'call_r' + i,
    });
    await post(step, { event: 'tool-end', tool: 'read', call: 'call_r' + i, result: 'same:5' });
  }
  await wait(60);
  const loop = sent.filter(([c, p]) => c === 'agent:loop' && p.paneId === oc && p.on).at(-1)?.[1];
  check(
    tools() === nTools + limit && !!loop,
    'the same call with the same result mark, over and over, gives the stuck-loop notice (' +
      limit +
      ' calls): ' +
      J(loop && { kind: loop.kind })
  );

  // The waiting route: the same decisions Claude Code's PreToolUse gets.
  const ask = (tool, input, url = gate) => post(url, { tool, input, call: 'call_g', child: false });
  const heldWrite = await ask('write', { filePath: path.join(cwd, 'locked.txt'), content: 'hi' });
  check(
    heldWrite.status === 200 &&
      /^File lock \(Technically Not\): locked\.txt is held by Rook/.test(
        heldWrite.body?.deny || ''
      ),
    'a write of a file another agent holds is refused with the reason: ' + J(heldWrite.body)
  );
  check(
    J((await ask('write', { filePath: path.join(cwd, 'ok.txt'), content: 'hi' })).body) === '{}' &&
      J((await ask('edit', { filePath: path.join(cwd, 'b.js') })).body) === '{}',
    'a free file is allowed'
  );
  const patch = await ask('apply_patch', {
    patchText:
      '*** Begin Patch\n*** Update File: src/ok.js\n@@\n-a\n+b\n*** Update File: sub/locked.txt\n@@\n-a\n+b\n*** End Patch',
  });
  check(
    /locked\.txt is held/.test(patch.body?.deny || ''),
    "a patch that names a held file is refused (its files are read from the patch text, from the panel's folder)"
  );
  const stash = await ask('bash', { command: 'git stash' });
  check(
    /blocked `git stash`/.test(stash.body?.deny || '') &&
      J((await ask('bash', { command: 'git status' })).body) === '{}',
    'a shell command the git guard blocks is refused, a harmless one is not'
  );
  check(
    J((await ask('read', { filePath: path.join(cwd, 'locked.txt') })).body) === '{}' &&
      J(
        (
          await ask(
            'write',
            { filePath: path.join(cwd, 'locked.txt') },
            curStep.replace('/step/', '/gate/')
          )
        ).body
      ) === '{}',
    'a tool that changes nothing, and a panel that is not OpenCode, are never refused here'
  );
  check(
    (await post(gate.replace(/[0-9a-f]{32}$/, 'f'.repeat(32)), { tool: 'write', input: {} }))
      .status === 404,
    'an unknown address answers 404 (the plugin then lets the tool run)'
  );

  // OpenCode's own sub-agent (its task tool → a child session; payloads as one real run sent them,
  // opencode 1.18.35): told with the events Claude Code's hooks give for a sub-agent. Its answer
  // and tokens come from the record.
  const kid = 'ses_child1',
    evs = () => sent.filter(([c, p]) => c === 'agent:event' && p.paneId === oc).map(([, p]) => p),
    nEv = evs().length;
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?)').run(
    kid,
    cwd.replace(/\\/g, '/'),
    ses,
    t0 + 500
  );
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
    'msg_ku',
    kid,
    t0 + 510,
    J({ role: 'user', agent: 'general', time: { created: t0 + 510 } })
  );
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(
    'msg_ka',
    kid,
    t0 + 520,
    J({
      role: 'assistant',
      parentID: 'msg_ku',
      finish: 'stop',
      agent: 'general',
      modelID: 'big-pickle',
      providerID: 'opencode',
      tokens: { input: 12350, output: 12, reasoning: 224, cache: { read: 98, write: 0 } },
      time: { created: t0 + 520, completed: t0 + 900 },
    })
  );
  db.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_ka',
    'msg_ka',
    J({ type: 'text', text: 'alpha.txt\nbeta.txt' })
  );
  const taskIn = {
    description: 'List files in current folder',
    prompt:
      'List the files in the current working directory. Then report the file names back to me.',
    subagent_type: 'general',
  };
  await post(step, {
    event: 'tool',
    tool: 'task',
    input: taskIn,
    call: 'call_task1',
    session: ses,
    child: false,
  });
  await post(step, {
    event: 'session.created',
    session: kid,
    parent: ses,
    agent: 'general',
    title: 'List files in current folder (@general subagent)',
  });
  await post(step, {
    event: 'session.status',
    session: kid,
    child: true,
    properties: { sessionID: kid, status: { type: 'busy' } },
  });
  await post(step, {
    event: 'tool',
    tool: 'glob',
    input: { pattern: '*' },
    call: 'call_kid1',
    session: kid,
    child: true,
  });
  await post(step, {
    event: 'tool-end',
    tool: 'glob',
    call: 'call_kid1',
    result: 'z2m4dl:118',
    session: kid,
    child: true,
  });
  await post(step, {
    event: 'tool',
    tool: 'todowrite',
    input: { todos: [{ content: 'child step', status: 'in_progress' }] },
    call: 'call_kid2',
    session: kid,
    child: true,
  });
  await post(step, {
    event: 'session.status',
    session: kid,
    child: true,
    properties: { sessionID: kid, status: { type: 'idle' } },
  });
  await post(step, {
    event: 'session.idle',
    session: kid,
    child: true,
    properties: { sessionID: kid },
  });
  await post(step, {
    event: 'tool-end',
    tool: 'task',
    call: 'call_task1',
    result: '25s853:116',
    session: ses,
    child: false,
    sub: kid,
  });
  await wait(200);
  const sub = evs().slice(nEv),
    kinds = sub.map(e => e.kind).join(' '),
    by = k => sub.find(e => e.kind === k);
  check(
    kinds === 'spawn sub-start tool tool sub-stop spawn-result',
    'a task call and its child session become: ' + kinds
  );
  check(
    by('spawn').toolUseId === 'call_task1' &&
      by('spawn').type === 'general' &&
      by('spawn').description === taskIn.description &&
      by('spawn').prompt === taskIn.prompt &&
      by('spawn').background === false &&
      !by('spawn').agentId,
    'spawn carries the call id, type, description and prompt of the task call'
  );
  check(
    by('sub-start').agentId === kid &&
      by('sub-start').agentType === 'general' &&
      by('tool').agentId === kid &&
      by('tool').agentType === 'general' &&
      by('tool').tool === 'Glob' &&
      by('tool').detail === '*',
    "sub-start and the child's tool call carry the child session as agentId and its agent name as agentType"
  );
  check(
    by('sub-stop').agentId === kid &&
      by('sub-stop').text === 'alpha.txt\nbeta.txt' &&
      sub.filter(e => e.kind === 'sub-stop').length === 1,
    "sub-stop comes once (OpenCode says idle twice) with the child's last text from the record"
  );
  check(
    by('spawn-result').toolUseId === 'call_task1' &&
      by('spawn-result').result.agentId === kid &&
      by('spawn-result').result.status === 'completed' &&
      by('spawn-result').result.text === 'alpha.txt\nbeta.txt' &&
      by('spawn-result').result.async === false,
    'spawn-result ties the call to its child session'
  );
  check(
    turnOf(oc).subAgents === 1 &&
      turnOf(oc).subTokens?.[kid] === 12350 + 12 + 224 &&
      turnOf(oc).steps?.text === 'write files',
    "its tokens are counted on the task like a Claude Code sub-agent's (" +
      turnOf(oc).subTokens?.[kid] +
      "), and its own to-do list is not the panel's checklist"
  );
  await post(step, {
    event: 'tool',
    tool: 'task',
    input: taskIn,
    call: 'call_task2',
    session: ses,
    child: false,
  });
  await post(step, {
    event: 'tool-end',
    tool: 'task',
    call: 'call_task2',
    failed: true,
    session: ses,
    child: false,
  });
  await wait(60);
  check(
    evs().at(-1).kind === 'spawn-refused' && evs().at(-1).toolUseId === 'call_task2',
    'a task call that failed without a child session is a refused launch'
  );
  const kidWrite = await post(gate, {
    tool: 'write',
    input: { filePath: path.join(cwd, 'locked.txt') },
    call: 'call_kid3',
    child: true,
  });
  check(
    /locked\.txt is held/.test(kidWrite.body?.deny || ''),
    "a child session's edit goes through the same lock gate as its parent's"
  );

  // Recorded only (nothing answers or draws them yet): permission requests and questions.
  await say('permission.asked', {
    properties: {
      id: 'per_1',
      sessionID: ses,
      permission: 'edit',
      patterns: ['src/a.js'],
      metadata: {},
    },
  });
  await say('question.asked', {
    properties: {
      id: 'que_1',
      sessionID: ses,
      questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }],
    },
  });
  await wait(30);
  const rec = hooks.openCode(oc);
  check(
    rec.permissions.length === 1 &&
      rec.permissions[0].permission === 'edit' &&
      rec.questions[0]?.questions[0]?.options.join() === 'A,B' &&
      rec.children[0]?.parent === ses,
    'a waiting permission request, a question and a child session are kept for the panel'
  );
  await say('permission.replied', {
    properties: { sessionID: ses, requestID: 'per_1', reply: 'once' },
  });
  await wait(30);
  check(
    hooks.openCode(oc).permissions.length === 0 &&
      sent.some(([c, p]) => c === 'agent:opencode' && p.kind === 'permission' && p.done),
    'an answered permission request is no longer waiting'
  );
  check(
    !sent.some(([c, p]) => c === 'agent:event' && /permission|question|child/.test(p.kind || '')),
    'none of these is sent to the window as an agent event'
  );

  // A child session's status is not the panel's.
  await post(step, {
    event: 'session.idle',
    session: 'ses_child1',
    child: true,
    properties: { sessionID: 'ses_child1' },
  });
  await wait(30);
  check(!turnOf(oc).endedAt, "a child session going idle does not end the panel's task");

  // The normal end: the answer row is written, idle reads it at once.
  row('msg_a1', t0 + 2000, {
    role: 'assistant',
    parentID: 'msg_u1',
    finish: 'stop',
    time: { created: t0 + 2000, completed: t0 + 4000 },
    modelID: 'big-pickle',
    providerID: 'opencode',
    tokens: { input: 10, output: 5 },
  });
  db.prepare('INSERT INTO part VALUES (?, ?, ?)').run(
    'prt_a1',
    'msg_a1',
    J({ type: 'text', text: 'hi' })
  );
  await status('idle');
  await say('session.idle', { properties: { sessionID: ses } });
  await wait(30);
  const end = turnOf(oc);
  check(
    !!end &&
      end.endedAt === t0 + 4000 &&
      end.endedBy === 'stop' &&
      end.result === 'hi' &&
      end.error === '',
    'idle after the answer row: the task ends at once from the record, as a normal finish'
  );
  check(
    loops.list().every(l => l.paneId !== oc) &&
      shell.filter(x => x === 'stop').length === 2 &&
      hooks.openCode(oc).questions.length === 0,
    "the turn's end clears the loop notice, the shell timing and what was waiting"
  );

  // Another CLI's panel: the same events do nothing.
  const before = sent.length;
  await post(curStep, {
    event: 'session.status',
    session: ses,
    child: false,
    properties: { sessionID: ses, status: { type: 'busy' } },
  });
  await post(curStep, { event: 'tool-end', tool: 'bash', call: 'call_b1', result: 'x' });
  await wait(30);
  check(
    sent.length === before && hooks.openCode(cur) === null,
    'the same events posted for a Cursor Agent panel change nothing'
  );

  db.close();
  turns.forget(oc);
  turns.forget(cur);
  hooks.forget(oc);
  hooks.forget(cur);
  hooks.stop();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '\nopencode-steps-check: all passed' : '\nopencode-steps-check: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.log('FAIL threw: ' + (error.stack || error.message));
  process.exit(1);
});
