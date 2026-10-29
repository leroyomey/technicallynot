// Technically Not tools · acp-bridge-test.js — the ACP connector end to end with a stand-in ACP
// agent (this same file, started with --agent), no real tool and no model: the real bridge
// (desktop/acp-bridge.js, started the way acp-connector.js starts it), the real agent-hooks.js
// server (steps, the /acp/ permission route and answerPermission, as the thread's card answers),
// the real agent-turns.js (task start and end from the record) and the real reader
// (thread-log-acp.js). Covers: start, a pasted prompt with a line break, the work rules on the
// first prompt only, words, a tool step, a permission answered in the thread, answered in the
// terminal, handed to the terminal from the card, files written only inside the folder, Esc to
// stop, a prompt held while one runs, reopening a conversation (its replay not recorded again),
// signing in through the agent, the agent ending mid-task, and the registry's launch for the real
// Mistral Vibe (built, not started). Run: node tools/acp-bridge-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- the stand-in ACP agent ----------

// The stand-in's answer to one prompt: what it does depends on words in the prompt.
async function standInPrompt(ctx, message) {
  const blocks = message.params.prompt;
  ctx.note({ got: 'prompt', blocks });
  const text = blocks[blocks.length - 1].text;
  const done = stopReason => ctx.out({ id: message.id, result: { stopReason } });
  if (/exit/.test(text)) {
    ctx.update(ctx.session, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'bye' },
    });
    setTimeout(() => process.exit(3), 100);
    return;
  }
  if (/slow/.test(text)) {
    ctx.update(ctx.session, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'thinking' },
    });
    await new Promise(resolve => (ctx.cancelled = resolve));
    return done('cancelled');
  }
  if (/edit/.test(text)) {
    ctx.update(ctx.session, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Working on it. ' },
    });
    const where = path.join(process.cwd(), 'hello.txt');
    ctx.update(ctx.session, {
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Write hello.txt',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: where }],
    });
    const reply = await ctx.ask('session/request_permission', {
      sessionId: ctx.session,
      toolCall: { toolCallId: 't1', title: 'Write hello.txt', kind: 'edit' },
      options: [
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    ctx.note({ got: 'permission', reply });
    const inside = await ctx.ask('fs/write_text_file', {
      sessionId: ctx.session,
      path: where,
      content: 'hi',
    });
    const outside = await ctx.ask('fs/write_text_file', {
      sessionId: ctx.session,
      path: path.join(process.cwd(), '..', 'outside.txt'),
      content: 'no',
    });
    ctx.note({ got: 'writes', inside, outside });
    ctx.update(ctx.session, {
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      status: 'completed',
    });
    ctx.update(ctx.session, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Done.' },
    });
    return done('end_turn');
  }
  if (/run/.test(text)) {
    const id = 'r' + ctx.nextId();
    ctx.update(ctx.session, {
      sessionUpdate: 'tool_call',
      toolCallId: id,
      title: 'npm test',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'npm test' },
    });
    const reply = await ctx.ask('session/request_permission', {
      sessionId: ctx.session,
      toolCall: {
        toolCallId: id,
        title: 'npm test',
        kind: 'execute',
        rawInput: { command: 'npm test' },
      },
      options: [
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });
    ctx.note({ got: 'permission', reply });
    ctx.update(ctx.session, {
      sessionUpdate: 'tool_call_update',
      toolCallId: id,
      status: reply.outcome?.optionId === 'once' ? 'completed' : 'failed',
    });
    return done('end_turn');
  }
  ctx.update(ctx.session, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'echo: ' + text },
  });
  done('end_turn');
}

function standIn() {
  const log = process.env.ACP_STANDIN_LOG;
  const mode = process.env.ACP_STANDIN_MODE || 'normal';
  const note = item => fs.appendFileSync(log, JSON.stringify(item) + '\n');
  const out = message =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const update = (sessionId, change) =>
    out({ method: 'session/update', params: { sessionId, update: change } });
  let nextId = 1000;
  const waiting = new Map();
  const ask = (method, params) =>
    new Promise(resolve => {
      const id = nextId++;
      waiting.set(id, resolve);
      out({ id, method, params });
    });
  let authed = false;
  const session = 'acp-sess-1';

  // what the prompt handler (standInPrompt) uses
  const ctx = { note, out, update, ask, session, cancelled: null, nextId: () => nextId };

  function received(message) {
    if (message.id !== undefined && !message.method && waiting.has(message.id)) {
      waiting.get(message.id)(message.error ? { error: message.error } : message.result);
      waiting.delete(message.id);
      return;
    }
    note({ got: message.method, params: message.params });
    if (message.method === 'initialize')
      return out({
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true },
          authMethods:
            mode === 'auth' ? [{ id: 'test-auth', name: 'Sign in to the stand-in' }] : [],
          agentInfo: { name: 'stand-in', version: '9.9' },
        },
      });
    if (message.method === 'authenticate') {
      authed = true;
      return out({ id: message.id, result: {} });
    }
    if (message.method === 'session/new') {
      if (mode === 'auth' && !authed)
        return out({ id: message.id, error: { code: -32000, message: 'Missing API key' } });
      return out({ id: message.id, result: { sessionId: session } });
    }
    if (message.method === 'session/load') {
      update(message.params.sessionId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'OLD HISTORY' },
      });
      return out({ id: message.id, result: {} });
    }
    if (message.method === 'session/cancel') return ctx.cancelled && ctx.cancelled();
    if (message.method === 'session/prompt') return standInPrompt(ctx, message);
    if (message.id !== undefined) out({ id: message.id, error: { code: -32601, message: 'no' } });
  }

  let inbox = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    inbox += chunk;
    let end;
    while ((end = inbox.indexOf('\n')) >= 0) {
      const line = inbox.slice(0, end).trim();
      inbox = inbox.slice(end + 1);
      if (line) received(JSON.parse(line));
    }
  });
}

if (process.argv[2] === '--agent') {
  standIn();
  return;
}

// ---------- the check ----------

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

// a check builds its environment: none of the panel's own TNAI_* variables
for (const name of Object.keys(process.env)) if (name.startsWith('TNAI_')) delete process.env[name];

const folder = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-acp-')));
const work = path.join(folder, 'project');
const settings = path.join(folder, 'settings');
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(settings, { recursive: true });
const standInLog = path.join(folder, 'standin.jsonl');

const Module = require('module');
const load = Module._load;
Module._load = (request, ...rest) =>
  request === 'electron'
    ? {
        app: {
          getPath: () => settings,
          whenReady: () => new Promise(() => {}),
          on: () => {},
          getVersion: () => '0.0.0',
        },
        shell: { openPath: async () => '' },
        dialog: {},
      }
    : load(request, ...rest);

const acp = require('../desktop/acp-connector');
acp.setBase(settings);
const hooks = require('../desktop/agent-hooks');
const turns = require('../desktop/agent-turns');
const reader = require('../desktop/thread-log-acp');
const registry = require('../desktop/agent-registry');

// every bridge run started, so each one is ended at the end whatever happened
const launched = [];
const events = [];
hooks.init((channel, payload) => events.push({ channel, payload }));
turns.init((channel, payload) => events.push({ channel, payload }));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(test, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = test();
    if (value) return value;
    await wait(25);
  }
  return null;
}

const readJsonLines = file => {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
};
const standInSaw = () => readJsonLines(standInLog);

// One run of the bridge with the stand-in agent, as a thread's terminal would start it.
async function bridge(paneId, sessionId, { resume = false, mode = 'normal' } = {}) {
  const options = await hooks.launchOptions(paneId, 'Mistral Vibe');
  const mcpUrl = JSON.parse(fs.readFileSync(options.mcpConfig, 'utf8')).mcpServers.tnai.url;
  const launch = await acp.launch({
    agent: 'Mistral Vibe',
    command: process.execPath,
    args: [__filename, '--agent'],
    sessionId: resume ? '' : sessionId,
    resumeId: resume ? sessionId : '',
    rules: 'RULE-MARK',
    mcpUrl,
  });
  turns.started(paneId, 'Mistral Vibe', '', sessionId, work);

  // a verbatim launch (cmd.exe on Windows) is one command line, as pty-service.js passes it
  const child = spawn(launch.file, launch.verbatim ? [launch.args.join(' ')] : launch.args, {
    cwd: work,
    env: { ...process.env, ...launch.env, ACP_STANDIN_LOG: standInLog, ACP_STANDIN_MODE: mode },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsVerbatimArguments: !!launch.verbatim,
  });
  const run = { child, screen: '', exited: null };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', text => (run.screen += text));
  child.stderr.on('data', text => (run.screen += text));
  child.on('exit', code => (run.exited = code));
  run.type = text => child.stdin.write(text);

  // the whole tree: cmd.exe, the bridge under it and the stand-in agent (a plain kill ends only
  // cmd.exe and left the other two running, learned 2026-10-28)
  run.end = () =>
    process.platform === 'win32'
      ? require('child_process').spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        })
      : child.kill();
  launched.push(run);
  run.record = () => readJsonLines(acp.recordFile(sessionId));
  return run;
}

const permissionAsked = after =>
  until(() =>
    events
      .slice(after)
      .find(e => e.channel === 'agent:permission' && !e.payload.done && e.payload.id)
  );
const ends = run => run.record().filter(line => line.type === 'end' || line.type === 'error');

// 1 to 5: one session, its prompts, permission questions, a stop and a held prompt
async function firstRun(sessionId) {
  const pane = 'acp-pane-1';
  const run = await bridge(pane, sessionId);

  // 1. start
  check(await until(() => /Ready\./.test(run.screen)), 'the session starts');
  check(/Type your message/.test(run.screen), 'the idle line the attention check knows');
  const meta = run.record().find(line => line.type === 'meta');
  check(meta?.acpSession === 'acp-sess-1' && meta.how === 'new', 'meta line with the agent’s id');

  // 2. a pasted prompt with a line break, a step, a permission answered in the thread
  let mark = events.length;
  run.type('\x1b[200~please edit\nsecond line\x1b[201~');
  run.type('\r');
  const asked = await permissionAsked(mark);
  check(asked && asked.payload.tool === 'Edit', 'the permission card names the tool');
  check(asked && asked.payload.sessionScope === '', 'Allow for session offered (allow_always)');
  hooks.answerPermission(asked?.payload.id, 'once');
  check(await until(() => ends(run).length === 1), 'the task ends');
  const prompts = standInSaw().filter(item => item.got === 'prompt');
  check(
    prompts[0]?.blocks.length === 2 && /RULE-MARK/.test(prompts[0].blocks[0].text),
    'work rules with the first prompt'
  );
  check(prompts[0]?.blocks[1].text === 'please edit\nsecond line', 'the line break kept');
  const answered = standInSaw().find(item => item.got === 'permission');
  check(answered?.reply?.outcome?.optionId === 'once', 'Allow once reached the agent');
  const writes = standInSaw().find(item => item.got === 'writes');
  check(fs.readFileSync(path.join(work, 'hello.txt'), 'utf8') === 'hi', 'a file written inside');
  check(
    writes?.outside?.error && !fs.existsSync(path.join(folder, 'outside.txt')),
    'outside refused'
  );
  check(
    events.some(
      e =>
        e.channel === 'agent:event' &&
        e.payload?.paneId === pane &&
        e.payload.kind === 'tool' &&
        e.payload.tool === 'Edit' &&
        /hello\.txt/.test(e.payload.detail || '')
    ),
    'the tool call reached the app as a step'
  );
  const turn = await until(() =>
    events
      .filter(e => e.channel === 'agent:turn' && e.payload.paneId === pane && e.payload.endedAt)
      .pop()
  );
  check(turn && /please edit/.test(turn.payload.task), 'the turn tracker saw the task');
  check(
    turn && /Done\./.test(turn.payload.result) && turn.payload.endedBy === 'stop',
    'and its end'
  );

  // 3. answered in the terminal while the card waits: the card closes
  mark = events.length;
  run.type('run tests\r');
  const card = await permissionAsked(mark);
  check(
    card && card.payload.tool === 'Bash' && card.payload.detail === 'npm test',
    'a command card'
  );
  check(card && card.payload.sessionScope === null, 'no Allow for session without allow_always');
  run.type('2');
  check(await until(() => ends(run).length === 2), 'answered in the terminal');
  check(
    await until(() =>
      events.slice(mark).some(e => e.channel === 'agent:permission' && e.payload.done)
    ),
    'the card closed'
  );
  const second = standInSaw().filter(item => item.got === 'permission')[1];
  check(second?.reply?.outcome?.optionId === 'reject', 'Reject reached the agent');
  check(
    standInSaw().filter(item => item.got === 'prompt')[1]?.blocks.length === 1,
    'rules only once'
  );

  // 4. "Answer in terminal" on the card: the terminal's question stays and is answered there
  mark = events.length;
  run.type('run again\r');
  const handed = await permissionAsked(mark);
  hooks.answerPermission(handed?.payload.id, 'terminal');
  await wait(200);
  check(ends(run).length === 2, 'still waiting in the terminal');
  run.type('1');
  check(await until(() => ends(run).length === 3), 'then answered there');
  check(
    standInSaw().filter(item => item.got === 'permission')[2]?.reply?.outcome?.optionId === 'once',
    'Allow once'
  );

  // 5. Esc stops a task; a prompt typed meanwhile waits and goes after
  run.type('slow one\r');
  await until(() => /thinking/.test(run.screen));
  run.type('held prompt\r');
  check(await until(() => /queued/.test(run.screen)), 'a prompt held while one runs');
  run.type('\x1b');
  check(await until(() => ends(run).length === 5), 'stopped, then the held one ran');
  const stopped = ends(run)[3];
  check(
    stopped?.stopReason === 'cancelled' && standInSaw().some(item => item.got === 'session/cancel'),
    'Esc sent session/cancel'
  );
  return run;
}

// 6. the reader: the record as thread entries
async function readerChecks(sessionId) {
  const lines = fs.readFileSync(acp.recordFile(sessionId), 'utf8').split('\n');
  const entries = reader.entries(lines, { cwd: work });
  const kinds = entries.map(entry => entry.kind);
  check(
    entries.find(entry => entry.kind === 'you')?.text === 'please edit\nsecond line',
    'reader: the prompt'
  );
  check(
    entries.some(entry => entry.kind === 'say' && entry.text === 'Working on it. ') &&
      entries.some(entry => entry.kind === 'say' && entry.text === 'Done.'),
    'reader: the words, split at the tool call'
  );
  check(
    entries.some(
      entry => entry.kind === 'act' && entry.verb === 'Edited' && entry.what === 'hello.txt'
    ),
    'reader: the edit'
  );
  check(
    entries.some(
      entry => entry.kind === 'act' && entry.verb === 'Ran' && entry.what === 'npm test'
    ),
    'reader: the command'
  );
  check(
    entries.some(entry => entry.kind === 'result' && entry.failed),
    'reader: the refused command failed'
  );
  check(
    entries.some(entry => entry.kind === 'note' && entry.text === 'You stopped it'),
    'reader: the stop'
  );
  check(kinds.filter(kind => kind === 'worked').length === 5, 'reader: five tasks');
  check(!JSON.stringify(entries).includes('RULE-MARK'), 'reader: no work rules shown');
  check(
    reader.fileFor({ agent: 'Mistral Vibe', sessionId }) === acp.recordFile(sessionId),
    'reader: the file'
  );
  check(acp.sessionExists(sessionId) && (await acp.sessionExistsAsync(sessionId)), 'reopenable');
}

// 7 to 9: reopened, signed in, and the agent ending mid-task
async function laterRuns(sessionId) {
  // 7. reopened: session/load, its replay not recorded again, no rules again
  const saysBefore = readJsonLines(acp.recordFile(sessionId)).filter(
    line => line.type === 'say'
  ).length;
  const again = await bridge('acp-pane-2', sessionId, { resume: true });
  check(await until(() => /Conversation reopened/.test(again.screen)), 'reopened');
  check(
    standInSaw().some(
      item => item.got === 'session/load' && item.params.sessionId === 'acp-sess-1'
    ),
    'session/load with the agent’s id'
  );
  again.type('hello again\r');
  await until(() => ends(again).length === 6);
  const said = again.record().filter(line => line.type === 'say');
  check(
    said.length === saysBefore + 1 && !said.some(line => /OLD HISTORY/.test(line.text)),
    'replay not recorded'
  );
  check(
    standInSaw()
      .filter(item => item.got === 'prompt')
      .pop()?.blocks.length === 1,
    'no rules on a reopened one'
  );
  again.end();
  await until(() => again.exited !== null);

  // 8. sign-in through the agent
  const signedId = crypto.randomUUID();
  const auth = await bridge('acp-pane-3', signedId, { mode: 'auth' });
  check(await until(() => /needs you to sign in/.test(auth.screen)), 'sign-in offered');
  auth.type('\r');
  check(await until(() => /Ready\./.test(auth.screen)), 'signed in, then ready');
  check(
    standInSaw().some(item => item.got === 'authenticate' && item.params.methodId === 'test-auth'),
    'authenticate sent'
  );
  auth.end();
  await until(() => auth.exited !== null);

  // 9. the agent ends mid-task
  const goneId = crypto.randomUUID();
  const gone = await bridge('acp-pane-4', goneId);
  await until(() => /Ready\./.test(gone.screen));
  gone.type('exit now\r');
  check(await until(() => gone.exited !== null), 'the bridge ends with its agent');
  check(
    gone.record().some(line => line.type === 'exit'),
    'recorded'
  );
  const goneTurn = await until(() =>
    events
      .filter(
        e => e.channel === 'agent:turn' && e.payload.paneId === 'acp-pane-4' && e.payload.endedAt
      )
      .pop()
  );
  check(goneTurn?.payload.endedBy === 'error', 'its task ended as an error');
}

// 10. the real Mistral Vibe's launch, built by the registry (nothing started)
async function registryChecks() {
  const vibe = await registry.resolveCommand('vibe-acp');
  if (vibe) {
    const spec = await registry.spec('Mistral Vibe', 'run', {
      sessionId: 'abc-123',
      workRules: 'rules',
    });
    const settingsOut = JSON.parse(spec.env.TNAI_ACP);

    // the bridge copy is the last quoted path of the line (cmd.exe on Windows, the file elsewhere)
    const named = /"([^"]*acp-bridge\.js)"*$/.exec(spec.args.join(' '))?.[1] || spec.args[0];
    check(
      /acp-bridge\.js$/.test(named) &&
        fs.existsSync(named) &&
        (!spec.verbatim || /\/c$/.test(spec.args[2])),
      'registry: the bridge copy'
    );
    check(
      /vibe-acp/i.test(settingsOut.command) && settingsOut.session === 'abc-123',
      'registry: Vibe’s ACP program'
    );
  } else console.log('note: vibe-acp is not installed, the registry launch was not built');
  check(registry.isAcp('Mistral Vibe') && !registry.isAcp('Codex'), 'registry: isAcp');
}

async function main() {
  const sessionId = crypto.randomUUID();
  const run = await firstRun(sessionId);
  await readerChecks(sessionId);
  run.end();
  await until(() => run.exited !== null);
  await laterRuns(sessionId);
  await registryChecks();
}

main()
  .catch(error => check(false, 'the check broke: ' + error.stack))
  .finally(() => {
    for (const run of launched) if (run.exited === null) run.end();
    try {
      fs.rmSync(folder, { recursive: true, force: true });
    } catch {}
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
