/*
 * Technically Not tools · desktop-check/graph-codex-check.js — A Claude Code lead delegating to a
 * Codex sub-agent (desktop/agent-graph.js `agent`), in plain Node with a fake terminal and window:
 * the window is asked for a Codex pane, no system-prompt addition, ready once the screen settles,
 * the role intro rides in front of the first task, the report comes from Codex's turn end
 * (agent-turns.js), and a Codex job never reuses a Claude Code sub-agent. Run: node
 * tools/desktop-check/graph-codex-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-graph-codex-'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => tmp } } : load(req, ...rest);
const graph = require('../../desktop/agent-graph');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const typed = [],
  events = [],
  prompts = {};
let paneN = 0,
  declineNext = false; // declineNext: main.js's folder-trust dialog answered Don't allow

// paneId -> when the first text was typed into it (speed audit item 4: how soon after the quiet)
const firstTypedAt = new Map();
const ptys = {
  write: (paneId, data) => {
    if (!firstTypedAt.has(paneId)) firstTypedAt.set(paneId, Date.now());
    typed.push([paneId, data]);
  },
  stop: () => {},
  list: () =>
    ['root', ...Array.from({ length: paneN }, (_, i) => 'sub' + (i + 1))].map(paneId => ({
      paneId,
      running: true,
      pid: 1,
    })),
};
const submit = async (paneId, body) => {
  ptys.write(paneId, body);
  return { ok: true, state: 'sent' };
};
graph.init(
  (channel, payload) => {
    events.push([channel, payload]);
    if (channel === 'graph:spawn')
      setTimeout(() => {
        const p = 'sub' + ++paneN;
        prompts[p] = graph.attach(payload.nodeId, p, 'Sub' + paneN);
        if (!declineNext) graph.started(p, '');
        else
          setTimeout(
            () =>
              graph.notStarted(
                p,
                "The user didn't allow " + payload.agent + ' to work in this folder.'
              ),
            50
          );
      }, 5);
  },
  { ptys, submit }
);
const text = r => r.content.map(c => c.text).join('\n');
const typedTo = paneId =>
  typed
    .filter(t => t[0] === paneId)
    .map(t => t[1])
    .join('');

(async () => {
  graph.setSettings({ maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 10 });
  graph.rootStarted('root', '', 'Lumen');
  check(
    graph.tools('root')[0].inputSchema.properties.agent?.enum.join() ===
      'Claude Code,Codex,OpenCode,Cursor Agent',
    'tnai_delegate offers an agent choice: Claude Code, Codex, OpenCode, Cursor Agent'
  );
  check(
    /agent must be one of/.test(
      text(
        await graph.call('root', 'tnai_delegate', {
          purpose: 'Test',
          task: 'Reply with one short line to confirm you got this.',
          why: 'The user asked for a separate agent.',
          agent: 'Gemini',
        })
      )
    ),
    'an unknown CLI is refused'
  );

  let r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Codex message test',
    task: 'Reply with one short line to confirm you got this message.',
    why: 'The user asked for a Codex agent to test messaging.',
    agent: 'codex',
  });
  check(
    !r.isError && /\(Codex, id/.test(text(r)),
    'delegation to Codex starts a Codex sub-agent: ' + text(r).slice(0, 70)
  );
  check(
    events.find(e => e[0] === 'graph:spawn')?.[1].agent === 'Codex',
    'the window is asked to open a Codex pane'
  );
  check(
    prompts.sub1 && prompts.sub1.appendPrompt === '',
    'no Claude system-prompt addition for Codex'
  );
  await wait(600);
  graph.output([{ paneId: 'sub1', data: 'Codex banner' }]);
  const bannerAt = Date.now();
  await wait(1500);
  check(!typedTo('sub1'), 'no task while its screen is still drawing');
  await wait(2500);
  check(
    /You are "Sub1", a sub-agent[\s\S]*\[(?:TN|TechnicallyNot)\.ai\] Task from Lumen: Reply with one short line/.test(
      typedTo('sub1')
    ),
    'once the screen settles: role intro + task typed into Codex'
  );
  const afterQuiet = (firstTypedAt.get('sub1') || 0) - bannerAt;
  check(
    afterQuiet > 2500 && afterQuiet < 2650,
    'the task goes the moment 2.5 s of quiet is over, not up to 500 ms later (' +
      afterQuiet +
      ' ms after the last drawing)'
  );

  // the lead finished its own turn: idle, so reports are typed in
  graph.onEvent('root', { kind: 'stop', text: '' });
  graph.onTurn({ paneId: 'sub1', agent: 'Codex', startedAt: 1, endedAt: 0 });
  graph.onTurn({
    paneId: 'sub1',
    agent: 'Codex',
    startedAt: 1,
    endedAt: 2,
    result: 'Codex here: message received.',
  });
  await wait(20);
  check(
    /Sub1 .*finished "Codex message test":\nCodex here: message received\./.test(typedTo('root')),
    'Codex turn end → report typed into the Claude lead'
  );
  graph.onTurn({
    paneId: 'sub1',
    agent: 'Codex',
    startedAt: 1,
    endedAt: 2,
    result: 'Codex here: message received.',
  });
  check(typedTo('root').split('Codex here').length === 2, 'the same turn end is reported once');

  r = await graph.call('root', 'tnai_delegate', {
    purpose: 'Codex message follow-up',
    task: 'Reply with one short line to confirm you got this message again.',
    why: 'Checks the reuse path for the same CLI.',
    agent: 'Claude Code',
  });
  check(
    !r.isError && !/idle sub-agent Sub1/.test(text(r)) && /\(Claude Code, id/.test(text(r)),
    'a Claude Code job never reuses the Codex sub-agent'
  );

  // A Codex lead: same tools over MCP; busy/idle from its own turns (rollout), so a report waits
  // until its task ends.
  graph.rootStarted('croot', '', 'Rook', 'Codex');
  check(
    graph
      .tools('croot')
      .map(t => t.name)
      .join() === 'tnai_delegate,tnai_subagents,tnai_wait,tnai_assign',
    'a Codex lead gets the 4 delegation tools'
  );
  graph.onTurn({ paneId: 'croot', agent: 'Codex', startedAt: 5, endedAt: 0 });
  r = await graph.call('croot', 'tnai_delegate', {
    purpose: 'Codex lead test',
    task: 'Summarize the README in two lines and report them back.',
    why: 'The user asked a Codex lead to use a sub-agent.',
  });
  check(
    !r.isError && /\(Claude Code, id/.test(text(r)),
    'a Codex lead starts a sub-agent: ' + text(r).slice(0, 60)
  );
  await wait(50);
  const sub = 'sub' + paneN;
  graph.onEvent(sub, { kind: 'ready' });
  graph.onEvent(sub, { kind: 'stop', text: 'README: two lines.' });
  await wait(20);
  check(
    !/README: two lines/.test(typedTo('croot')),
    'the report waits while the Codex lead is busy'
  );
  graph.onTurn({ paneId: 'croot', agent: 'Codex', startedAt: 5, endedAt: 6, result: 'ok' });
  await wait(20);
  check(
    /finished "Codex lead test":\nREADME: two lines\./.test(typedTo('croot')),
    'the Codex lead gets the report once its task ends'
  );

  // Folder trust declined (main.js dialog → pty:start throws → graph.notStarted): the lead's
  // tnai_delegate says so instead of "process ended".
  declineNext = true;
  r = await graph.call('croot', 'tnai_delegate', {
    purpose: 'Trust decline test',
    task: 'List the files in the src folder and report them back.',
    why: 'The user asked for a Codex sub-agent here.',
    agent: 'Codex',
  });
  declineNext = false;
  const declined = graph.state().nodes.find(n => n.purpose === 'Trust decline test');
  check(
    r.isError &&
      /^Not started: The user didn't allow Codex to work in this folder\. Do this part yourself\.\ncode: unreachable · try: do this part yourself/.test(
        text(r)
      ) &&
      declined?.status === 'failed' &&
      !declined.paneId,
    'folder not allowed → tnai_delegate: ' + text(r)
  );

  // agent-registry.js: a Codex launch with Technically Not's MCP file connects to it, with a tool
  // timeout long enough for tnai_wait.
  const mcp = path.join(tmp, 'p.mcp.json');
  fs.writeFileSync(
    mcp,
    JSON.stringify({ mcpServers: { tnai: { type: 'http', url: 'http://127.0.0.1:1/mcp/abc' } } })
  );
  const spec = await require('../../desktop/agent-registry').spec('Codex', 'run', {
    workRules: 'rules',
    codexHome: tmp,
    mcpConfig: mcp,
  });
  const args = JSON.stringify(spec); // cmd.exe-quoted through the codex.cmd shim
  check(
    args.includes('mcp_servers.tnai.url=http://127.0.0.1:1/mcp/abc') &&
      args.includes('mcp_servers.tnai.tool_timeout_sec=660') &&
      args.includes('mcp_servers.tnai.default_tools_approval_mode=approve'),
    "Codex launch args connect Technically Not's MCP server"
  );

  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})();
