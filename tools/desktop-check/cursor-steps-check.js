/*
 * Technically Not tools · desktop-check/cursor-steps-check.js — Cursor Agent live steps
 * (desktop/agent-hooks.js cursorStep, cursorPlugin, onStep), plain Node, no CLI and no model call:
 * every Cursor panel gets its own plugin folder whose preToolUse hook posts to that panel's step
 * address; a payload shaped like cursor-agent 2026.10.01's (byte order mark first, "preToolUse",
 * tool "Shell") becomes a tool event; the hook's own script, run the way the hook names it,
 * delivers one too; only a lead's plugin holds mcp.json and a later start that does not lead
 * removes it; with SHELL set on Windows there is no tool hook (Cursor would hand its PowerShell
 * text to that shell and refuse every tool); forget() removes the folder. Usage: node
 * tools/desktop-check/cursor-steps-check.js. Exit code 1 when a check fails.
 */
'use strict';
const fs = require('fs'),
  os = require('os'),
  path = require('path'),
  http = require('http'),
  Module = require('module');
const { spawnSync } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-cursor-steps-'));
fs.mkdirSync(path.join(tmp, 'user'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? {
        app: {
          getPath: () => path.join(tmp, 'user'),
          whenReady: () => new Promise(() => {}),
          on: () => {} /* attachment-service.js listens for will-quit when it is loaded */,
        },
        shell: { openPath: async () => '' },
        dialog: {},
      }
    : load(req, ...rest);
const savedShell = process.env.SHELL;

// a Git Bash shell running this check sets it; the app's own start does not
delete process.env.SHELL;
const hooks = require('../../desktop/agent-hooks');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const events = [];
hooks.init((channel, payload) => {
  if (channel === 'agent:event') events.push(payload);
});
const post = (url, body) =>
  new Promise(resolve => {
    const r = http.request(
      url,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    r.on('error', () => resolve(0));
    r.end(body);
  });
const read = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};
const tools = () => events.filter(e => e.kind === 'tool');

(async () => {
  const pane = 'terminal-cursor-1',
    win = process.platform === 'win32';
  const o = await hooks.launchOptions(pane, 'Cursor Agent');
  const step = hooks.endpoint(pane)?.step || '',
    root = o.rulesPlugin || '';
  const hookFile = () => {
    try {
      return JSON.parse(read(path.join(root, 'hooks', 'hooks.json'))).hooks;
    } catch {
      return {};
    }
  };
  const script = path.join(root, 'hooks', win ? 'step.cmd' : 'step');
  check(
    /terminal-cursor-1\.cursor-plugin$/.test(root) &&
      !o.mcpConfig &&
      !fs.existsSync(path.join(root, 'mcp.json')),
    'a Cursor panel that does not lead has its own plugin folder, no MCP file handed to it: ' +
      path.basename(root)
  );
  const cmd = hookFile().preToolUse?.[0]?.command || '';
  check(
    hookFile().sessionStart?.length === 1 &&
      cmd === (win ? 'cmd /d /c "' + script + '"' : '"' + script + '"'),
    'hooks.json keeps the rules hook and adds one preToolUse hook: ' + cmd
  );
  check(
    /^http:\/\/127\.0\.0\.1:\d+\/step\/[0-9a-f]{32}$/.test(step) &&
      read(script).includes('"' + step + '"'),
    "the hook script posts to this panel's step address"
  );

  const payload = tool =>
    '\uFEFF' +
    JSON.stringify({
      conversation_id: 'c',
      tool_name: tool.name,
      tool_input: tool.input,
      tool_use_id: 't',
      hook_event_name: 'preToolUse',
      cursor_version: '2026.10.01',
    });
  const status = await post(
    step,
    payload({ name: 'Shell', input: { command: 'echo hi', cwd: '', timeout: 30000 } })
  );
  await wait(50);
  const first = tools()[0];
  check(
    status === 204 &&
      first &&
      first.paneId === pane &&
      first.tool === 'Bash' &&
      /echo hi/.test(first.detail || ''),
    'a Cursor payload (byte order mark, "preToolUse", Shell) becomes a Bash step: ' +
      JSON.stringify(first && { tool: first.tool, detail: first.detail })
  );
  await post(
    step,
    payload({ name: 'Write', input: { file_path: 'C:\\proj\\b.txt', content: 'x' } })
  );
  await wait(50);
  check(
    tools()[1]?.tool === 'Write' && /b\.txt/.test(tools()[1].detail || ''),
    'a Write call keeps its name and shows its file: ' + JSON.stringify(tools()[1]?.detail)
  );

  // Since cursor-agent 2026.10.17 the hook also fires inside a sub-agent; such a call carries
  // parent_tool_call_id (the lead's Task call). It is the helper's step, never the lead's own.
  const leadSteps = tools().length;
  await post(
    step,
    '\uFEFF' +
      JSON.stringify({
        conversation_id: 'c',
        parent_tool_call_id: 'toolu_task_1',
        tool_name: 'Read',
        tool_input: { file_path: 'C:\\proj\\c.txt' },
        tool_use_id: 't2',
        hook_event_name: 'preToolUse',
        cursor_version: '2026.10.22',
      })
  );
  await wait(50);
  const helperStep = tools()[leadSteps];
  check(
    helperStep?.tool === 'Read' &&
      helperStep.agentId === 'toolu_task_1' &&
      tools()
        .slice(0, leadSteps)
        .every(e => !e.agentId),
    "a call inside a Cursor sub-agent is the helper's step (agentId from parent_tool_call_id), " +
      'the lead keeps its own: ' +
      JSON.stringify(helperStep && { tool: helperStep.tool, agentId: helperStep.agentId })
  );

  // A body that arrives in two pieces, cut in the middle of a character of several bytes, is still
  // read whole (the hook server decodes the stream, not each piece).
  const word = String.fromCharCode(0x4e2d, 0x6587),
    bad = String.fromCharCode(0xfffd),
    bytes = Buffer.from(
      payload({ name: 'Shell', input: { command: 'echo ' + word, cwd: '', timeout: 30000 } })
    );
  const cut = bytes.indexOf(Buffer.from(word)) + 1,
    nBefore = tools().length;
  await new Promise(resolve => {
    const r = http.request(
      step,
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      res => {
        res.resume();
        res.on('end', resolve);
      }
    );
    r.on('error', resolve);
    r.setNoDelay(true);
    r.write(bytes.subarray(0, cut));
    setTimeout(() => r.end(bytes.subarray(cut)), 150);
  });
  await wait(50);
  const split = tools()[nBefore]?.detail || '';
  check(
    split.includes(word) && !split.includes(bad),
    'a body cut inside a character of several bytes arrives whole: ' + JSON.stringify(split)
  );

  // The script itself, run as the hook names it, with the payload on stdin (needs curl, which
  // Windows 10+, macOS and most Linux ship).
  const before = tools().length;
  const run = win
    ? spawnSync('cmd.exe', ['/d', '/c', script], {
        input: payload({ name: 'Read', input: { file_path: 'C:\\proj\\a.txt' } }),
        timeout: 8000,
      })
    : spawnSync(script, [], {
        input: payload({ name: 'Read', input: { file_path: '/proj/a.txt' } }),
        timeout: 8000,
      });
  await wait(300);
  check(
    run.status === 0 &&
      !String(run.stdout || '').trim() &&
      tools().length === before + 1 &&
      tools()[before].tool === 'Read',
    'the hook script exits 0, prints nothing and delivers the step (exit ' +
      run.status +
      ', steps ' +
      (tools().length - before) +
      ')'
  );

  const lead = await hooks.launchOptions(pane, 'Cursor Agent', '', { lead: true });
  const step2 = hooks.endpoint(pane)?.step || '';
  check(
    lead.mcpConfig &&
      lead.rulesPlugin === root &&
      /"tnai"/.test(read(path.join(root, 'mcp.json'))) &&
      step2 !== step &&
      read(script).includes('"' + step2 + '"'),
    "as a lead the same folder also holds mcp.json, and the script has the new start's address"
  );
  check(
    (await post(step, payload({ name: 'Shell', input: { command: 'old' } }))) === 404,
    "the earlier start's address no longer answers"
  );
  await hooks.launchOptions(pane, 'Cursor Agent');
  check(
    !fs.existsSync(path.join(root, 'mcp.json')),
    'started again without leading: mcp.json is gone'
  );

  if (win) {
    process.env.SHELL = 'C:\\Program Files\\Git\\usr\\bin\\bash.exe';
    await hooks.launchOptions(pane, 'Cursor Agent');
    check(
      !hookFile().preToolUse && hookFile().sessionStart?.length === 1,
      'with SHELL set on Windows there is no tool hook (no steps, nothing refused); the rules hook stays'
    );
    delete process.env.SHELL;
  }
  const other = await hooks.launchOptions('terminal-codex-1', 'Codex');
  check(
    !/cursor-plugin$/.test(other.rulesPlugin || '') &&
      !fs.existsSync(path.join(other.rulesPlugin || '', 'hooks', win ? 'step.cmd' : 'step')),
    'another CLI still gets the shared rules folder, with no step script in it'
  );

  // OpenCode (same step address, its own plugin posts { event: 'tool', tool, input }): its own
  // rules file with the lead lines that are true for it, a timeout on Technically Not's MCP server,
  // and an edit step noted as a file of this task. A Cursor or Codex step is not.
  const oc = 'terminal-opencode-1',
    turnsOc = require('../../desktop/agent-turns'),
    contextOc = require('../../desktop/agent-context');
  const edited = [],
    realHook = contextOc.hook;
  contextOc.hook = (p, h) => {
    edited.push([p, h.tool_name, h.tool_input?.file_path]);
  };
  const ol = await hooks.launchOptions(oc, 'OpenCode'),
    rulesText = read(ol.rulesFile || '');
  check(
    /work-rules-opencode\.md$/.test(ol.rulesFile || '') &&
      rulesText.startsWith('You are running inside Technically Not') &&
      /tnai_delegate/.test(rulesText.split('\n')[1] || ''),
    'OpenCode gets its own rules file, lead lines first: ' + path.basename(ol.rulesFile || '')
  );
  check(
    !/"Summary: "|"Name: "/.test(rulesText) && rulesText.includes(read(other.rulesFile).trim()),
    "it leaves out Claude Code's sub-agent prompt lines and holds the same work rules as the other CLIs"
  );
  check(
    /work-rules\.md$/.test(other.rulesFile || '') &&
      !read(other.rulesFile).startsWith('You are running inside'),
    'Codex keeps the shared rules file, unchanged'
  );

  // Codex's lead lines travel in its profile text (workRules → developer_instructions), in front of
  // the same work rules.
  check(
    (other.workRules || '').startsWith('You are running inside Technically Not') &&
      /tnai_delegate/.test(other.workRules) &&
      !/"Summary: "|"Name: "/.test(other.workRules) &&
      other.workRules.endsWith(read(other.rulesFile).trim().split('\n').join(' ')),
    'Codex gets its lead lines first in its profile text, then the same work rules'
  );
  let conf = {};
  try {
    conf = JSON.parse(
      require('../../desktop/agent-registry').handArgs('OpenCode', ol).env.OPENCODE_CONFIG_CONTENT
    );
  } catch {}
  check(
    conf.instructions?.[0] === ol.rulesFile &&
      conf.mcp?.tnai?.timeout === 660000 &&
      /opencode-steps\.js$/.test(conf.plugin?.[0] || ''),
    'its session config names that file, the step plugin, and a 660 s timeout on the tnai server: ' +
      JSON.stringify(conf.mcp?.tnai && { timeout: conf.mcp.tnai.timeout })
  );
  turnsOc.started(oc, 'OpenCode', '', '', tmp);
  const ocStep = hooks.endpoint(oc)?.step || '',
    nOc = tools().length;
  await post(
    ocStep,
    JSON.stringify({
      event: 'tool',
      tool: 'edit',
      input: { filePath: 'C:\\proj\\src\\a.js', oldString: 'a', newString: 'b' },
    })
  );
  await post(
    ocStep,
    JSON.stringify({ event: 'tool', tool: 'read', input: { filePath: 'C:\\proj\\src\\b.js' } })
  );
  await post(
    hooks.endpoint(pane)?.step || '',
    payload({ name: 'Write', input: { file_path: 'C:\\proj\\c.txt', content: 'x' } })
  );
  await wait(80);
  check(
    tools().length === nOc + 3 &&
      tools()[nOc].tool === 'Edit' &&
      /a\.js/.test(tools()[nOc].detail || ''),
    'an OpenCode edit step is shown as an Edit of its file'
  );
  check(
    edited.length === 1 &&
      edited[0][0] === oc &&
      edited[0][1] === 'Edit' &&
      /a\.js$/.test(edited[0][2] || ''),
    "only OpenCode's edit is noted as a file of its task (not its read, not a Cursor step): " +
      JSON.stringify(edited)
  );
  contextOc.hook = realHook;
  turnsOc.forget(oc);
  hooks.forget(oc);

  hooks.forget(pane);
  check(!fs.existsSync(root), 'closing the panel removes its plugin folder');

  hooks.stop();
  if (savedShell !== undefined) process.env.SHELL = savedShell;
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.log('FAIL threw: ' + (error.stack || error.message));
  process.exit(1);
});
