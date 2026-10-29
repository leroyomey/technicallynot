/*
 * Technically Not desktop · acp-connector.js — the main-process side of the ACP connector: one
 * way to run any agent tool that speaks the Agent Client Protocol as a thread (plan
 * docs/plans/agent-cli-expansion.md section 7; the user's feature list of 2026-10-28, item 8).
 *
 * Such a tool has no screen, so a thread's terminal runs acp-bridge.js in its place: this file
 * copies the bridge out of the app (it must run outside the app's archive), and builds the launch
 * line agent-registry.js `spec` uses for an entry that has `acp` (the tool's ACP command). The
 * bridge writes each session's record to <settings folder>/acp-sessions/<session id>.jsonl; the
 * session id is the one the app gives the panel at start (pty-service.js ID_AT_START), so a
 * conversation is found, read (thread-log-acp.js, agent-turns.js) and reopened by that id.
 * Checks: tools/acp-bridge-test.js.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { nodeHelper, helperEnv } = require('./node-helper');

let baseDir = '';

// The settings folder (the app's userData), or what a check set.
function base() {
  if (baseDir) return baseDir;
  try {
    return require('electron').app.getPath('userData');
  } catch {
    return require('os').tmpdir();
  }
}

const recordDir = () => path.join(base(), 'acp-sessions');
const cleanId = id => (/^[\w-]{1,80}$/.test(String(id || '')) ? String(id) : '');

// The record of one session, or '' for an id that is not one of ours.
function recordFile(sessionId) {
  const id = cleanId(sessionId);
  return id ? path.join(recordDir(), id + '.jsonl') : '';
}

// Whether a session has a conversation to reopen: its record names the agent's own session and
// holds at least one prompt. Only the first 64 KB are read.
const HEAD = 65536;
const reopenable = head =>
  /"type":"meta"[^\n]*"acpSession":"[^"]+"/.test(head) && /"type":"user"/.test(head);

function sessionExists(sessionId) {
  const file = recordFile(sessionId);
  if (!file) return false;
  let handle = null;
  try {
    handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(HEAD);
    const size = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return reopenable(buffer.toString('utf8', 0, size));
  } catch {
    return false;
  } finally {
    if (handle !== null) fs.closeSync(handle);
  }
}

// The same without blocking (pty-service.js's 2 s look for a conversation saved since the start).
async function sessionExistsAsync(sessionId) {
  const file = recordFile(sessionId);
  if (!file) return false;
  let handle = null;
  try {
    handle = await fs.promises.open(file, 'r');
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(HEAD), 0, HEAD, 0);
    return reopenable(buffer.toString('utf8', 0, bytesRead));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}

// The bridge, copied out of the app next to the records (rewritten only when it changed).
async function bridgeFile() {
  const target = path.join(base(), 'acp-bridge', 'acp-bridge.js');
  const text = await fs.promises.readFile(path.join(__dirname, 'acp-bridge.js'));
  const old = await fs.promises.readFile(target).catch(() => null);
  if (!old || !old.equals(text)) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    // written beside, then renamed: a thread starting at the same moment never runs half a file
    const part = target + '.' + process.pid + '.part';
    await fs.promises.writeFile(part, text);
    await fs.promises.rename(part, target);
  }
  return target;
}

// The launch of one ACP tool in a thread's terminal: { file, args, env, verbatim }.
// command: the tool's ACP program, already found on PATH; args: its ACP arguments.
async function launch({ agent, command, args = [], sessionId, resumeId, rules, mcpUrl }) {
  const session = cleanId(resumeId || sessionId);
  if (!session) throw new Error(agent + ' needs a session id to start through ACP.');
  const helper = nodeHelper();
  const step = mcpUrl ? mcpUrl.replace('/mcp/', '/step/') : '';
  const settings = {
    agent,
    command,
    args,
    session,
    resume: !!resumeId,
    record: recordDir(),
    rules: rules || '',
    stepUrl: step,
    askUrl: step ? step.replace('/step/', '/acp/') : '',
    mcpUrl: mcpUrl || '',
  };
  const env = { ...helperEnv(helper, {}), TNAI_ACP: JSON.stringify(settings) };
  const bridge = await bridgeFile();
  if (process.platform !== 'win32')
    return { file: helper.exe, args: [bridge], verbatim: false, env };

  // On Windows through cmd.exe, as agent-registry.js launchSpec starts a .cmd tool: the app's own
  // executable is a window program, and as a terminal's first process it gets no console, so
  // nothing it printed showed and no key reached it (learned 2026-10-28, tools/acp-real-check.js).
  // Started by cmd.exe it uses cmd's console.
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', '""' + helper.exe + '" "' + bridge + '""'],
    verbatim: true,
    env,
  };
}

module.exports = {
  launch,
  recordFile,
  sessionExists,
  sessionExistsAsync,
  // checks: point the records and the bridge copy at a scratch folder ('' = the settings folder)
  setBase(folder) {
    baseDir = folder || '';
  },
};
