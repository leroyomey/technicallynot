/*
 * Technically Not desktop · acp-bridge.js — the ACP connector's program in a thread's terminal.
 *
 * An agent tool that speaks the Agent Client Protocol (ACP, agentclientprotocol.com) has no screen
 * of its own: it runs as a child process and talks JSON-RPC over stdin and stdout. This program
 * sits in the thread's real terminal in its place (acp-connector.js starts it, with the app's own
 * Node helper) and is that tool's client:
 * - it starts the agent, asks it for a session (`session/new`, or `session/load` to reopen one),
 *   and signs in through the agent's own `authenticate` when the agent asks for that;
 * - what is typed or pasted into the terminal (the app's prompt box pastes the same way) becomes a
 *   `session/prompt`; Esc or Ctrl+C sends `session/cancel`;
 * - the agent's words, tool calls and the end of each task are drawn as plain text on the
 *   terminal (the thread's CLI screen) and written, one JSON line each, to the session's record
 *   (<settings folder>/acp-sessions/<session id>.jsonl), which thread-log-acp.js and
 *   agent-turns.js read for the thread's conversation and its status;
 * - each tool call goes to the panel's step address (agent-hooks.js `/step/`), and each permission
 *   question to its `/acp/` address, which holds it open until the user answers in the thread;
 *   when the window does not answer there, the question is asked here, with the agent's own
 *   choices numbered;
 * - the agent may read and write text files through the client, only inside the session's folder.
 *
 * Nothing in this file is shared with the app's code: it is copied out of the app as it is and
 * run on its own. Its options come in one environment variable, TNAI_ACP (JSON), never given on
 * to the agent. Checks: tools/acp-bridge-test.js (a stand-in ACP agent), and
 * tools/acp-real-check.js (OpenCode's ACP mode on its free model).
 */
'use strict';
process.on('uncaughtException', error => {
  try {
    process.stdout.write(
      '\r\n[Technically Not] The ACP connector stopped: ' + error.message + '\r\n'
    );
  } catch {}
  process.exit(1);
});

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const options = readOptions();
const cwd = process.cwd();
const recordFile = path.join(options.record, options.session + '.jsonl');
const AGENT = options.agent;

// ---------- the record ----------

function readOptions() {
  let parsed = {};
  try {
    parsed = JSON.parse(process.env.TNAI_ACP || '{}');
  } catch {}
  delete process.env.TNAI_ACP;
  const session = String(parsed.session || '');
  if (!/^[\w-]{1,80}$/.test(session) || !parsed.command || !parsed.record) {
    process.stdout.write(
      '[Technically Not] The ACP connector was started without its options.\r\n'
    );
    process.exit(2);
  }
  return {
    agent: String(parsed.agent || 'ACP agent'),
    command: String(parsed.command),
    args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
    session,
    resume: parsed.resume === true,
    record: String(parsed.record),
    rules: String(parsed.rules || ''),
    stepUrl: String(parsed.stepUrl || ''),
    askUrl: String(parsed.askUrl || ''),
    mcpUrl: String(parsed.mcpUrl || ''),
  };
}

function writeRecord(line) {
  try {
    fs.mkdirSync(options.record, { recursive: true });
    fs.appendFileSync(recordFile, JSON.stringify({ at: Date.now(), ...line }) + '\n');
  } catch {}
}

// The ACP session id this record was written for (its first `meta` line), or ''.
function savedAcpSession() {
  try {
    const head = fs.readFileSync(recordFile, 'utf8').slice(0, 65536);
    for (const row of head.split('\n')) {
      const line = row.trim() ? JSON.parse(row) : null;
      if (line?.type === 'meta' && line.acpSession) return String(line.acpSession);
    }
  } catch {}
  return '';
}

// ---------- the screen ----------

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const show = text => process.stdout.write(String(text).replace(/\r?\n/g, '\r\n'));
const IDLE_LINE =
  '\r\n' + DIM + '› Type your message · Enter sends · Esc stops a running task' + RESET + '\r\n';

// ---------- the agent ----------

const agent = spawn(options.command, options.args, {
  cwd,
  shell: /\.(cmd|bat)$/i.test(options.command),
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  env: (() => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    return env;
  })(),
});
let agentErrors = '';
agent.stderr.on('data', chunk => (agentErrors = (agentErrors + chunk).slice(-4000)));
agent.on('error', error => ended('could not start: ' + error.message, 1));
agent.on('exit', code => ended('ended (code ' + code + ')', code || 0));

let nextId = 1;
let inbox = '';
const waiting = new Map();

function call(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

const notify = (method, params) =>
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
const answer = (id, result) =>
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const refuse = (id, code, message) =>
  agent.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');

agent.stdout.on('data', chunk => {
  inbox += chunk;
  let end;
  while ((end = inbox.indexOf('\n')) >= 0) {
    const line = inbox.slice(0, end).trim();
    inbox = inbox.slice(end + 1);
    let message = null;
    try {
      message = line ? JSON.parse(line) : null;
    } catch {}
    if (message) received(message);
  }
});

function received(message) {
  if (message.method && message.id !== undefined) return agentAsks(message);
  if (message.method === 'session/update') return update(message.params || {});
  const handlers = waiting.get(message.id);
  if (!handlers) return;
  waiting.delete(message.id);
  if (message.error)
    handlers.reject(Object.assign(new Error(message.error.message || 'error'), message.error));
  else handlers.resolve(message.result || {});
}

// What the agent asks of the client.
function agentAsks(message) {
  const params = message.params || {};
  if (message.method === 'session/request_permission') return askPermission(message.id, params);
  if (message.method === 'fs/read_text_file') return readText(message.id, params);
  if (message.method === 'fs/write_text_file') return writeText(message.id, params);
  refuse(message.id, -32601, 'Method not supported by Technically Not');
}

// A path the agent may read or write: inside the session's folder only.
function insideFolder(file) {
  const full = path.resolve(cwd, String(file || ''));
  const relative = path.relative(cwd, full);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? full : '';
}

function readText(id, params) {
  const file = insideFolder(params.path);
  if (!file) return refuse(id, -32602, 'Only files inside the session folder can be read');
  fs.readFile(file, 'utf8', (error, text) => {
    if (error) return refuse(id, -32002, error.message);
    let content = text;
    if (params.line || params.limit) {
      const lines = text.split('\n');
      const from = Math.max(0, (params.line || 1) - 1);
      content = lines.slice(from, params.limit ? from + params.limit : undefined).join('\n');
    }
    answer(id, { content });
  });
}

function writeText(id, params) {
  const file = insideFolder(params.path);
  if (!file) return refuse(id, -32602, 'Only files inside the session folder can be written');
  fs.mkdir(path.dirname(file), { recursive: true }, () =>
    fs.writeFile(file, String(params.content ?? ''), error =>
      error ? refuse(id, -32002, error.message) : answer(id, null)
    )
  );
}

// ---------- what the agent tells while it works ----------

let acpSession = '';
let loading = false;
let working = null;
let saidId = 0;
let said = '';
let saidTimer = null;
const tools = new Map();

// The agent's words so far, written as one `say` line that a later write of the same id replaces.
function flushSaid() {
  clearTimeout(saidTimer);
  saidTimer = null;
  if (said.trim()) writeRecord({ type: 'say', id: saidId, text: said });
}

function newSaid() {
  flushSaid();
  saidId++;
  said = '';
}

function update(params) {
  if (loading || (params.sessionId && params.sessionId !== acpSession)) return;
  const change = params.update || {};
  const kind = change.sessionUpdate;
  if (kind === 'agent_message_chunk') {
    const text = change.content?.type === 'text' ? String(change.content.text || '') : '';
    if (!text) return;
    said += text;
    show(text);
    if (!saidTimer) saidTimer = setTimeout(flushSaid, 1000);
    return;
  }
  if (kind === 'tool_call' || kind === 'tool_call_update') return toolChange(change);
  if (kind === 'plan') {
    const items = (change.entries || []).map(item => ({
      text: String(item.content || '').slice(0, 300),
      status: String(item.status || ''),
    }));
    writeRecord({ type: 'plan', items });
  }
}

// A tool call as the step the app shows (agent-hooks.js onStep names it like Claude Code's).
function stepOf(tool) {
  const where = tool.locations?.[0]?.path || '';
  const input = tool.rawInput && typeof tool.rawInput === 'object' ? tool.rawInput : {};
  const command = input.command || input.cmd || tool.title || '';
  switch (tool.kind) {
    case 'execute':
      return { tool: 'Bash', input: { command: String(command) } };
    case 'edit':
      return { tool: 'Edit', input: { file_path: where || String(tool.title || '') } };
    case 'delete':
      return { tool: 'Delete', input: { file_path: where || String(tool.title || '') } };
    case 'read':
      return { tool: 'Read', input: { file_path: where || String(tool.title || '') } };
    case 'search':
      return { tool: 'Grep', input: { pattern: String(input.pattern || tool.title || '') } };
    case 'fetch':
      return { tool: 'WebFetch', input: { url: String(input.url || tool.title || '') } };
    default:
      return { tool: String(tool.title || 'Tool').slice(0, 60), input: {} };
  }
}

function toolChange(change) {
  const id = String(change.toolCallId || '');
  if (!id) return;
  const known = tools.get(id);
  const tool = { ...(known || {}), ...change };
  tools.set(id, tool);
  if (!known) {
    newSaid();
    show('\r\n' + DIM + '▸ ' + (tool.title || tool.kind || 'tool') + RESET + '\r\n');
    post(options.stepUrl, { event: 'tool', ...stepOf(tool), call: id }).catch(() => {});
  }
  writeRecord({
    type: 'tool',
    id,
    title: String(tool.title || '').slice(0, 400),
    kind: String(tool.kind || 'other'),
    status: String(tool.status || 'pending'),
    path: String(tool.locations?.[0]?.path || ''),
  });
  if (change.status === 'completed') show(DIM + '  done' + RESET + '\r\n');
  if (change.status === 'failed') show(DIM + '  failed' + RESET + '\r\n');
}

// ---------- permission questions ----------

let menu = null;

function post(url, body, onRequest) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('no address'));
    const text = JSON.stringify(body);
    const request = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      response => {
        let reply = '';
        response.setEncoding('utf8');
        response.on('data', chunk => (reply += chunk));
        response.on('end', () => {
          try {
            resolve(reply ? JSON.parse(reply) : {});
          } catch {
            resolve({});
          }
        });
      }
    );
    request.on('error', reject);
    if (onRequest) onRequest(request);
    request.end(text);
  });
}

// The agent's option that fits the user's answer in the thread, or null.
function optionFor(choices, decision) {
  const first = kinds => choices.find(choice => kinds.includes(choice.kind));
  if (decision === 'once') return first(['allow_once']) || null;
  if (decision === 'session') return first(['allow_always']) || null;
  if (decision === 'deny') return first(['reject_once', 'reject_always']) || null;
  return null;
}

function askPermission(id, params) {
  const tool = {
    ...(tools.get(String(params.toolCall?.toolCallId || '')) || {}),
    ...params.toolCall,
  };
  const choices = (params.options || []).map(choice => ({
    id: String(choice.optionId),
    name: String(choice.name || choice.optionId),
    kind: String(choice.kind || ''),
  }));
  const step = stepOf(tool);
  writeRecord({
    type: 'permission',
    id: String(tool.toolCallId || id),
    title: String(tool.title || ''),
  });
  let settled = false;
  let request = null;
  const settle = choice => {
    if (settled) return;
    settled = true;
    if (request) request.destroy();
    menu = null;
    writeRecord({
      type: 'answer',
      id: String(tool.toolCallId || id),
      option: choice ? choice.kind : 'cancelled',
    });
    answer(id, {
      outcome: choice ? { outcome: 'selected', optionId: choice.id } : { outcome: 'cancelled' },
    });
    show(DIM + '  ' + (choice ? choice.name : 'Not answered') + RESET + '\r\n');
  };

  // In the terminal at once, so it can be answered here too; the thread's card answers the same
  // question, and whichever comes first counts.
  show(
    '\r\n' + BOLD + AGENT + ' asks: ' + (tool.title || 'may it run this tool?') + RESET + '\r\n'
  );
  choices.forEach((choice, index) => show('  ' + (index + 1) + '. ' + choice.name + '\r\n'));
  menu = { choices, settle };
  post(
    options.askUrl,
    {
      title: String(tool.title || ''),
      kind: String(tool.kind || ''),
      tool: step.tool,
      input: step.input,
      always: choices.some(choice => choice.kind === 'allow_always'),
      options: choices,
    },
    made => (request = made)
  ).then(
    reply => {
      const choice = optionFor(choices, reply?.decision);
      if (choice) settle(choice);
    },
    () => {}
  );
}

// ---------- prompts ----------

const queue = [];
let rulesGiven = false;

function sendPrompt(text) {
  if (working) {
    queue.push(text);
    show(DIM + '  (queued until the current task ends)' + RESET + '\r\n');
    return;
  }
  newSaid();
  writeRecord({ type: 'user', text });
  const blocks = [];
  if (!rulesGiven && options.rules)
    blocks.push({ type: 'text', text: '[TN.ai work rules]\n' + options.rules });
  rulesGiven = true;
  blocks.push({ type: 'text', text });
  const started = Date.now();
  working = { started };
  call('session/prompt', { sessionId: acpSession, prompt: blocks }).then(
    result => finishTask(started, result.stopReason || 'end_turn', ''),
    error => finishTask(started, 'error', error.message)
  );
}

function finishTask(started, stopReason, error) {
  flushSaid();
  const ms = Date.now() - started;
  writeRecord(
    error ? { type: 'error', text: error.slice(0, 600), ms } : { type: 'end', stopReason, ms }
  );
  show(
    '\r\n' +
      DIM +
      (error
        ? 'Error: ' + error
        : '— ' + stopReason.replace(/_/g, ' ') + ' after ' + (ms / 1000).toFixed(1) + ' s') +
      RESET +
      '\r\n'
  );
  working = null;
  if (queue.length) return sendPrompt(queue.shift());
  show(IDLE_LINE);
}

function cancelTask() {
  if (!working || !acpSession) return;
  notify('session/cancel', { sessionId: acpSession });
  show(DIM + '  stopping…' + RESET + '\r\n');
}

// ---------- the keyboard ----------

let typed = '';
let pasting = false;
let pendingKeys = '';
let signIn = null;
let lastCtrlC = 0;

function submit() {
  const text = typed.replace(/\r\n?/g, '\n').trim();
  typed = '';
  if (signIn) return signIn();
  if (!text || !acpSession) return;
  show('\r\n');
  sendPrompt(text);
}

function key(data) {
  pendingKeys += data;
  while (pendingKeys) {
    if (pendingKeys.startsWith('\x1b[200~')) {
      pasting = true;
      pendingKeys = pendingKeys.slice(6);
      continue;
    }
    if (pendingKeys.startsWith('\x1b[201~')) {
      pasting = false;
      pendingKeys = pendingKeys.slice(6);
      continue;
    }

    // Esc alone (a terminal sends a key's whole sequence in one piece, so a lone Esc is the key)
    if (pendingKeys === '\x1b') {
      pendingKeys = '';
      if (!pasting) escape();
      return;
    }

    // an unfinished sequence waits for the rest of it
    if (/^\x1b\[[\d;?]*$/.test(pendingKeys)) return;
    const sequence = /^\x1b\[[\d;?]*[ -\/]*[@-~]/.exec(pendingKeys);
    if (sequence) {
      pendingKeys = pendingKeys.slice(sequence[0].length);
      continue;
    }
    const char = pendingKeys[0];
    pendingKeys = pendingKeys.slice(1);
    typeOne(char);
  }
}

function typeOne(char) {
  if (pasting) {
    typed += char;
    show(char === '\n' || char === '\r' ? '\r\n' : char);
    return;
  }
  if (menu && /[1-9]/.test(char)) {
    const choice = menu.choices[Number(char) - 1];
    if (choice) menu.settle(choice);
    return;
  }
  if (char === '\r' || char === '\n') return submit();
  if (char === '\x7f' || char === '\b') {
    if (typed) {
      typed = typed.slice(0, -1);
      show('\b \b');
    }
    return;
  }
  if (char === '\x03') {
    if (working) return cancelTask();
    if (Date.now() - lastCtrlC < 2000) return quit();
    lastCtrlC = Date.now();
    show('\r\n' + DIM + 'Press Ctrl+C again to end ' + AGENT + '.' + RESET + '\r\n');
    return;
  }
  if (char < ' ' && char !== '\t') return;
  typed += char;
  show(char);
}

function escape() {
  if (menu) return menu.settle(null);
  cancelTask();
}

// The keys. Run by the app's own executable as Node (a run from source, node-helper.js), stdin is
// not the terminal and no key arrives (measured 2026-10-28 in a pty through cmd.exe: isTTY
// undefined, nothing read), so the console's own input device is read instead. Run by a real
// Node (a release build's shipped runtime), stdin is the terminal.
function keyboard() {
  if (process.stdin.isTTY || !process.versions.electron || process.platform !== 'win32')
    return process.stdin;
  try {
    const handle = fs.openSync('\\\\.\\CONIN$', 'r+');
    if (require('tty').isatty(handle)) return new (require('tty').ReadStream)(handle);
  } catch {}
  return process.stdin;
}

const keys = keyboard();
if (keys.isTTY) keys.setRawMode(true);
keys.setEncoding('utf8');
keys.on('data', key);

// ---------- start and end ----------

let ending = false;

function ended(why, code) {
  if (ending) return;
  ending = true;
  flushSaid();
  if (menu) menu = null;
  for (const handlers of waiting.values()) handlers.reject(new Error(AGENT + ' ' + why));
  writeRecord({ type: 'exit', text: why });
  const last = agentErrors.trim().split('\n').slice(-3).join('\n');
  show(
    '\r\n' +
      BOLD +
      AGENT +
      ' ' +
      why +
      RESET +
      (last && code ? '\r\n' + DIM + last + RESET : '') +
      '\r\n'
  );
  setTimeout(() => process.exit(code ? 1 : 0), 300);
}

function quit() {
  ending = true;
  flushSaid();
  writeRecord({ type: 'exit', text: 'closed' });
  if (agent.pid)
    spawnSync('taskkill', ['/PID', String(agent.pid), '/T', '/F'], { stdio: 'ignore' });
  process.exit(0);
}

process.on('SIGHUP', quit);
process.on('SIGTERM', quit);

function mcpServers(capabilities) {
  if (!options.mcpUrl || !capabilities?.mcpCapabilities?.http) return [];
  return [{ type: 'http', name: 'tnai', url: options.mcpUrl, headers: [] }];
}

// A sign-in the agent offers: one press of Enter starts it (it usually opens a browser).
function offerSignIn(methods, retry) {
  const method = methods[0];
  show(
    '\r\n' +
      BOLD +
      AGENT +
      ' needs you to sign in.' +
      RESET +
      '\r\nPress Enter to ' +
      (method.name || 'sign in') +
      (method.description ? ' (' + method.description + ')' : '') +
      '.\r\n'
  );
  signIn = () => {
    signIn = null;
    show(DIM + 'Signing in…' + RESET + '\r\n');
    call('authenticate', { methodId: method.id }).then(retry, error => {
      show('Sign-in did not finish: ' + error.message + '\r\n');
      offerSignIn(methods, retry);
    });
  };
}

async function openSession(init) {
  const servers = mcpServers(init.agentCapabilities);
  const old = options.resume ? savedAcpSession() : '';
  if (old && init.agentCapabilities?.loadSession) {
    loading = true;
    try {
      await call('session/load', { sessionId: old, cwd, mcpServers: servers });
      acpSession = old;
      rulesGiven = true;
      return 'reopened';
    } catch (error) {
      writeRecord({
        type: 'note',
        text: AGENT + ' could not reopen the conversation: ' + error.message,
      });
    } finally {
      loading = false;
    }
  }
  const made = await call('session/new', { cwd, mcpServers: servers });
  acpSession = String(made.sessionId || '');
  return 'new';
}

async function start() {
  show(DIM + AGENT + ' · through ACP in Technically Not' + RESET + '\r\n');
  const init = await call('initialize', {
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false },
    clientInfo: { name: 'technically-not', title: 'Technically Not', version: '1' },
  });
  const methods = Array.isArray(init.authMethods) ? init.authMethods : [];
  const open = async () => {
    try {
      const how = await openSession(init);
      writeRecord({
        type: 'meta',
        agent: AGENT,
        acpSession,
        version: String(init.agentInfo?.version || ''),
        how,
      });
      show(DIM + (how === 'reopened' ? 'Conversation reopened.' : 'Ready.') + RESET + IDLE_LINE);
    } catch (error) {
      // -32000 is ACP's "authentication required" (Mistral Vibe 2.25.7: "Missing API key")
      if (methods.length && error.code === -32000 && !signIn) {
        show(DIM + error.message + RESET);
        return offerSignIn(methods, open);
      }
      ended('could not start a session: ' + error.message, 1);
    }
  };
  await open();
}

start().catch(error => ended('did not answer: ' + error.message, 1));
