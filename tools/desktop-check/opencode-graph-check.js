/*
 * Technically Not tools · desktop-check/opencode-graph-check.js — An OpenCode sub-agent whose task
 * ends on an error (desktop/agent-graph.js onTurn, openCodeFailure), plain Node, fake panes: its
 * lead gets a report that says it failed and why, not an empty one; when OpenCode then works again
 * by itself and truly ends, that end is reported too; a Codex task that ends the same way is told
 * as before. Run: node tools/desktop-check/opencode-graph-check.js (about 10 s: it waits for each
 * sub-agent's screen to settle).
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-graph-opencode-'));
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
  events = [];
let paneN = 0;
const ptys = {
  write: (paneId, data) => typed.push([paneId, data]),
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
        graph.attach(payload.nodeId, p, 'Sub' + paneN);
        graph.started(p, '');
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
const statusOf = paneId => graph.state().nodes?.find(n => n.paneId === paneId)?.status;

(async () => {
  graph.setSettings({ maxDepth: 1, maxActivePerAgent: 3, maxActiveTotal: 6, graceSeconds: 10 });
  graph.rootStarted('root', '', 'Lumen');
  const start = async (agent, purpose) => {
    const r = await graph.call('root', 'tnai_delegate', {
      purpose,
      task: 'Reply with one short line to confirm you got this message.',
      why: 'The user asked for a separate agent to test this.',
      agent,
    });
    await wait(600);
    graph.output([{ paneId: 'sub' + paneN, data: 'banner' }]);
    await wait(4000);
    return text(r);
  };
  check(
    /\(OpenCode, id/.test(await start('opencode', 'OpenCode failure test')) &&
      /Task from Lumen/.test(typedTo('sub1')),
    'an OpenCode sub-agent is started and gets its task'
  );
  graph.onEvent('root', { kind: 'stop', text: '' }); // the lead is idle, so reports are typed in

  graph.onTurn({ paneId: 'sub1', agent: 'OpenCode', startedAt: 1, endedAt: 0 });
  graph.onTurn({
    paneId: 'sub1',
    agent: 'OpenCode',
    startedAt: 1,
    endedAt: 2,
    endedBy: 'error',
    error: 'Model not found: opencode/no-such-model-xyz',
    result: '',
  });
  await wait(30);
  check(
    /Sub1 .*"OpenCode failure test":\nOpenCode stopped on an error before it finished this job and reported nothing: Model not found: opencode\/no-such-model-xyz\. Delegate it again, or do this part yourself\./.test(
      typedTo('root')
    ),
    'a task that ended on an error: the lead reads that it failed and why: ' +
      JSON.stringify(typedTo('root').slice(-150))
  );

  // OpenCode works again by itself on the same task, then truly ends.
  const before = typedTo('root').length;

  // the lead read the first report and is idle again
  graph.onEvent('root', { kind: 'stop', text: '' });
  graph.onTurn({ paneId: 'sub1', agent: 'OpenCode', startedAt: 1, endedAt: 0 });
  check(
    statusOf('sub1') === undefined || statusOf('sub1') === 'working',
    'working again on the same task: the sub-agent counts as working, not as a follow-up the user typed'
  );
  graph.onTurn({
    paneId: 'sub1',
    agent: 'OpenCode',
    startedAt: 1,
    endedAt: 9,
    endedBy: 'stop',
    result: 'OPENCODE-OK after the retry.',
  });
  await wait(30);
  check(
    /finished "OpenCode failure test":\nOPENCODE-OK after the retry\./.test(
      typedTo('root').slice(before)
    ),
    'its real end is reported to the lead too'
  );
  graph.onTurn({
    paneId: 'sub1',
    agent: 'OpenCode',
    startedAt: 1,
    endedAt: 9,
    endedBy: 'stop',
    result: 'OPENCODE-OK after the retry.',
  });
  check(
    typedTo('root').split('OPENCODE-OK after the retry').length === 2,
    'the same end is reported once'
  );

  // An interrupted OpenCode task says so; a normal answer is passed on as it is.
  graph.onEvent('root', { kind: 'stop', text: '' });
  const second = await start('opencode', 'Summarize the weather archive'),
    // a sub-agent of the same CLI may be reused for it: either way its panel is p2
    p2 = 'sub' + paneN;
  check(/OpenCode|Sub1/.test(second), 'a second OpenCode job: ' + second.slice(0, 60));
  graph.onEvent('root', { kind: 'stop', text: '' });
  graph.onTurn({ paneId: p2, agent: 'OpenCode', startedAt: 3, endedAt: 0 });
  graph.onTurn({
    paneId: p2,
    agent: 'OpenCode',
    startedAt: 3,
    endedAt: 4,
    endedBy: 'interrupted',
    result: '',
  });
  await wait(30);
  check(
    /"Summarize the weather archive":\nOpenCode was interrupted before it finished this job and reported nothing\./.test(
      typedTo('root')
    ),
    'an interrupted task: the lead reads that it was interrupted: ' +
      JSON.stringify(typedTo('root').slice(-160))
  );

  // Codex is told as before: an error end with no answer adds no failure text.
  graph.onEvent('root', { kind: 'stop', text: '' });
  check(/\(Codex, id/.test(await start('codex', 'Codex failure test')), 'a Codex sub-agent');
  const len = typedTo('root').length,
    p3 = 'sub' + paneN;
  graph.onTurn({ paneId: p3, agent: 'Codex', startedAt: 5, endedAt: 0 });
  graph.onTurn({
    paneId: p3,
    agent: 'Codex',
    startedAt: 5,
    endedAt: 6,
    endedBy: 'error',
    error: 'boom',
    result: '',
  });
  await wait(30);
  check(
    !/stopped on an error|boom/.test(typedTo('root').slice(len)),
    'a Codex task ending the same way is told exactly as before (no failure text added)'
  );

  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? '\nopencode-graph-check: all passed' : '\nopencode-graph-check: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.log('FAIL threw:', e.stack || e);
  process.exit(1);
});
