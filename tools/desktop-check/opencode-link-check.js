/*
 * Technically Not tools · desktop-check/opencode-link-check.js — desktop/opencode-link.js against a
 * stand-in OpenCode server (no real CLI, no model): the version gate at connect (the server's own
 * /doc), the events it emits, its calls, reconnect with a fresh read of what is waiting, a refused
 * password, a dead server, closing with the panel, and the launch arguments in agent-registry.js.
 * The password must appear in no event and no state. Run: node
 * tools/desktop-check/opencode-link-check.js
 */
'use strict';
const { standIn } = require('./opencode-stand-in'); // the stand-in server
const fs = require('fs'),
  os = require('os'),
  path = require('path');
const link = require('../../desktop/opencode-link');
const registry = require('../../desktop/agent-registry');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const events = [];
link.on(e => events.push(e));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await sleep(20);
  }
  return null;
};
const seen = (paneId, type, more = () => true) =>
  events.find(e => e.paneId === paneId && e.type === type && more(e));

(async () => {
  link.tune(
    {
      first: 20,
      retryMin: 40,
      retryMax: 200,
      call: 1500,
      connect: 1500,
      neverUp: 900,
      lostFor: 60000,
      version: 500,
    },
    []
  );

  // 1. Starting a panel with the link's flags
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-oc-link-'));
  link.init({ version: async () => '9.9.9', dir });
  process.env.TNAI_OPENCODE_LINK = 'off';
  check(
    (await link.launch('gate')) === null,
    'TNAI_OPENCODE_LINK=off: launch gives nothing, the panel starts as before'
  );
  delete process.env.TNAI_OPENCODE_LINK;
  const launched = await link.launch('gate');
  check(
    launched &&
      launched.port > 1023 &&
      /^[0-9a-f]{48}$/.test(launched.env.OPENCODE_SERVER_PASSWORD) &&
      launched.env.OPENCODE_SERVER_USERNAME === 'opencode',
    'a version not in the shipped list still gets a port and a 48-character password (the gate is at connect)'
  );
  const again = await link.launch('gate');
  check(
    again && again.env.OPENCODE_SERVER_PASSWORD !== launched.env.OPENCODE_SERVER_PASSWORD,
    'every start gets a new password'
  );
  check(
    !JSON.stringify(link.state('gate')).includes(again.env.OPENCODE_SERVER_PASSWORD) &&
      !('port' in link.state('gate')),
    'state() holds no password and no port'
  );
  link.close('gate', launched.id);
  check(
    link.state('gate') !== null,
    'an older process’s exit (other id) does not close the newer link'
  );
  link.close('gate', again.id);
  check(
    link.state('gate') === null && !seen('gate', 'off'),
    'closed before its process ran: forgotten, no event'
  );

  // 2. Connect: greeting, then what is already waiting
  const A = await standIn('secret-A').listen();
  A.permissions = [
    {
      id: 'per_1',
      sessionID: 'ses_top',
      permission: 'edit',
      patterns: ['a.txt'],
      metadata: { filepath: 'a.txt' },
      always: ['*'],
      tool: { messageID: 'msg_1', callID: 'call_1' },
    },
  ];
  A.status = { ses_top: { type: 'busy' } };
  const idA = link.attach('A', A.port, 'secret-A');
  const up = await until(() => seen('A', 'connected'));
  check(
    up && up.version === '9.9.9' && A.docReads === 1,
    'a version not known yet: its own /doc is read once, the contract test passes, connected'
  );
  const saved = () => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(dir, 'opencode-link.json'), 'utf8')
      ).good.includes('9.9.9');
    } catch {
      return false;
    }
  }; // written in the background
  check(
    link.known().good.includes('9.9.9') && (await until(saved)),
    'the passed version is remembered on this PC'
  );
  const p1 = await until(() => seen('A', 'permission', e => e.id === 'per_1'));
  check(
    p1 &&
      p1.permission === 'edit' &&
      p1.patterns[0] === 'a.txt' &&
      p1.callId === 'call_1' &&
      p1.sessionId === 'ses_top',
    'a permission already waiting is read at connect'
  );
  check(
    await until(() => seen('A', 'status', e => e.status === 'busy' && e.sessionId === 'ses_top')),
    'a session already busy is read at connect'
  );
  await until(() => link.state('A').sessionId); // known once the server said it is no child session
  check(
    link.state('A').connected &&
      link.state('A').status === 'busy' &&
      link.state('A').sessionId === 'ses_top' &&
      link.state('A').permissions.length === 1,
    'state(): connected, busy, one permission waiting'
  );

  // 3. Pushed events
  A.send('permission.replied', { sessionID: 'ses_top', requestID: 'per_1', reply: 'once' });
  check(
    (await until(() =>
      seen('A', 'permission-replied', e => e.id === 'per_1' && e.reply === 'once')
    )) && link.state('A').permissions.length === 0,
    'permission replied'
  );
  A.send('message.part.delta', { sessionID: 'ses_top', delta: 'text' });
  A.send('message.updated', {
    sessionID: 'ses_top',
    info: {
      id: 'msg_1',
      sessionID: 'ses_top',
      role: 'assistant',
      providerID: 'opencode',
      modelID: 'big-pickle',
    },
  });
  A.send('message.part.updated', {
    sessionID: 'ses_top',
    part: { id: 'prt_1', sessionID: 'ses_top', messageID: 'msg_1', type: 'text', text: 'hi' },
    time: 1,
  });
  A.send('message.part.updated', {
    sessionID: 'ses_top',
    part: {
      id: 'prt_2',
      sessionID: 'ses_top',
      messageID: 'msg_1',
      type: 'step-finish',
      reason: 'stop',
      cost: 0.0125,
      tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 7, write: 3 } },
    },
    time: 2,
  });
  const step = await until(() => seen('A', 'step'));
  check(
    step &&
      step.cost === 0.0125 &&
      step.tokens.input === 100 &&
      step.tokens.output === 20 &&
      step.tokens.cacheRead === 7 &&
      step.tokens.cacheWrite === 3 &&
      step.reason === 'stop',
    'step: cost and tokens'
  );
  check(
    events.filter(e => e.paneId === 'A' && e.type === 'step').length === 1,
    'text parts and streamed text give no event'
  );
  A.send('session.status', {
    sessionID: 'ses_top',
    status: { type: 'retry', attempt: 2, message: 'Rate limited', next: 123 },
  });
  const retry = await until(() => seen('A', 'status', e => e.status === 'retry'));
  check(
    retry && retry.attempt === 2 && retry.message === 'Rate limited',
    'status retry with its attempt and message'
  );
  A.send('session.error', {
    sessionID: 'ses_top',
    error: { name: 'APIError', data: { message: 'Usage limit reached' } },
  });
  check(
    await until(() =>
      seen('A', 'error', e => e.name === 'APIError' && e.message === 'Usage limit reached')
    ),
    'error with its name and message'
  );
  A.send('session.status', { sessionID: 'ses_top', status: { type: 'idle' } });
  A.send('session.idle', { sessionID: 'ses_top' });
  await until(() => seen('A', 'status', e => e.status === 'idle'));
  check(
    events.filter(e => e.paneId === 'A' && e.type === 'status' && e.status === 'idle').length === 1,
    'idle once (status idle and session.idle are one change)'
  );
  A.send('session.created', {
    sessionID: 'ses_kid',
    info: { id: 'ses_kid', parentID: 'ses_top', title: 'explore' },
  });
  check(
    await until(() =>
      seen('A', 'child', e => e.sessionId === 'ses_kid' && e.parentId === 'ses_top')
    ),
    'child session'
  );
  A.send('session.status', { sessionID: 'ses_kid', status: { type: 'busy' } });
  const kidBusy = await until(() => seen('A', 'status', e => e.sessionId === 'ses_kid'));
  check(
    kidBusy && kidBusy.child === true && link.state('A').sessionId === 'ses_top',
    'a child’s status is marked child and does not become the panel’s session'
  );
  A.send('permission.asked', {
    id: 'per_2',
    sessionID: 'ses_kid',
    permission: 'bash',
    patterns: ['rm x'],
    metadata: {},
    always: [],
  });
  const p2 = await until(() => seen('A', 'permission', e => e.id === 'per_2'));
  check(
    p2 && p2.child === true && p2.permission === 'bash',
    'a child’s permission request is marked child'
  );
  A.send('question.asked', {
    id: 'que_1',
    sessionID: 'ses_top',
    questions: [
      {
        question: 'Which one?',
        header: 'Pick',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' },
        ],
      },
    ],
  });
  const q1 = await until(() => seen('A', 'question', e => e.id === 'que_1'));
  check(q1 && q1.questions[0].options[1].label === 'B', 'question asked with its options');
  A.send('session.compacted', { sessionID: 'ses_top' });
  const c1 = await until(() => seen('A', 'compacted'));
  check(c1 && !('context' in c1), 'compacted; no size when the summary’s own step was not seen');
  A.send('message.updated', {
    sessionID: 'ses_top',
    info: {
      id: 'msg_sum',
      sessionID: 'ses_top',
      role: 'assistant',
      summary: true,
      mode: 'compaction',
      providerID: 'opencode',
      modelID: 'big-pickle',
    },
  });
  A.send('message.part.updated', {
    sessionID: 'ses_top',
    part: {
      id: 'prt_9',
      sessionID: 'ses_top',
      messageID: 'msg_sum',
      type: 'step-finish',
      reason: 'stop',
      cost: 0,
      tokens: { total: 591, input: 465, output: 120, reasoning: 6, cache: { read: 0, write: 0 } },
    },
    time: 3,
  });
  A.send('session.compacted', { sessionID: 'ses_top' });
  const c2 = await until(() => events.filter(e => e.paneId === 'A' && e.type === 'compacted')[1]);
  check(
    c2 &&
      c2.context &&
      c2.context.total === 591 &&
      c2.context.input === 465 &&
      c2.context.output === 120,
    'compacted with the size after it, from the summary answer’s last step: ' +
      JSON.stringify(c2 && c2.context)
  );

  // 4. Calls
  check(
    (await link.reply('A', 'per_2', 'sometimes')).ok === false && A.calls.length === 0,
    'an answer other than once / always / reject is refused here, nothing sent'
  );
  const r1 = await link.reply('A', 'per_2', 'once');
  check(
    r1.ok &&
      A.calls.at(-1).url === '/permission/per_2/reply' &&
      A.calls.at(-1).body.reply === 'once',
    'reply("once") reaches POST /permission/per_2/reply'
  );
  await link.reply('A', 'per_2', 'reject', 'not that file');
  check(
    A.calls.at(-1).body.reply === 'reject' && A.calls.at(-1).body.message === 'not that file',
    'reply("reject") with a message'
  );
  await link.answer('A', 'que_1', ['B']);
  check(
    A.calls.at(-1).url === '/question/que_1/reply' &&
      JSON.stringify(A.calls.at(-1).body) === '{"answers":[["B"]]}',
    'answer: one array of labels per question'
  );
  await link.rejectQuestion('A', 'que_1');
  check(A.calls.at(-1).url === '/question/que_1/reject', 'rejectQuestion');
  await link.abort('A');
  check(A.calls.at(-1).url === '/session/ses_top/abort', 'abort() stops the panel’s own session');
  await link.summarize('A');
  check(
    A.calls.at(-1).url === '/session/ses_top/summarize' &&
      A.calls.at(-1).body.providerID === 'opencode' &&
      A.calls.at(-1).body.modelID === 'big-pickle',
    'summarize() with the model the session last answered with'
  );
  await link.summarize('A', '', 'anthropic/claude-x');
  check(
    A.calls.at(-1).body.providerID === 'anthropic' && A.calls.at(-1).body.modelID === 'claude-x',
    'summarize() with a named model'
  );
  await link.appendPrompt('A', 'hello there');
  const ap = A.calls.at(-1);
  await link.submitPrompt('A');
  check(
    ap.url === '/tui/append-prompt' &&
      ap.body.text === 'hello there' &&
      A.calls.at(-1).url === '/tui/submit-prompt',
    'appendPrompt and submitPrompt'
  );
  const kids = await link.children('A');
  check(
    kids.ok && kids.data[0].sessionId === 'ses_kid' && kids.data[0].parentId === 'ses_top',
    'children()'
  );

  // 5. Reconnect: the stream drops, a permission is answered and another asked meanwhile
  events.length = 0;
  A.send('permission.asked', {
    id: 'per_3',
    sessionID: 'ses_top',
    permission: 'edit',
    patterns: ['b.txt'],
    metadata: {},
    always: [],
  });
  await until(() => seen('A', 'permission', e => e.id === 'per_3'));
  A.permissions = [
    {
      id: 'per_4',
      sessionID: 'ses_top',
      permission: 'edit',
      patterns: ['c.txt'],
      metadata: {},
      always: [],
    },
  ];
  A.status = {};
  A.drop();
  check(await until(() => seen('A', 'disconnected')), 'the stream ended: disconnected');
  check(
    (await until(
      () => events.filter(e => e.paneId === 'A' && e.type === 'connected').length === 1
    )) && A.docReads === 1,
    'connected again by itself, without reading /doc again'
  );
  check(
    await until(() => seen('A', 'permission-replied', e => e.id === 'per_3' && e.reply === '')),
    'a permission answered while away is cleared after the reconnect'
  );
  check(
    await until(() => seen('A', 'permission', e => e.id === 'per_4')),
    'a permission asked while away is found after the reconnect'
  );
  check(
    await until(() => seen('A', 'status', e => e.sessionId === 'ses_kid' && e.status === 'idle')),
    'a session no longer listed as busy is idle after the reconnect'
  );
  check(!seen('A', 'off'), 'the link is still on');

  // 6. Closing with the panel
  link.close('A', 'some-other-id');
  check(link.state('A') !== null, 'close with another id does nothing');
  link.close('A', idA);
  check(
    link.state('A') === null && seen('A', 'off', e => e.reason === 'closed'),
    'close: off, forgotten'
  );
  check(await until(() => A.streams.size === 0), 'its event connection is closed');
  check((await link.reply('A', 'per_4', 'once')).ok === false, 'a call after close fails quietly');
  const before = A.requests;
  await sleep(400);
  check(A.requests === before, 'no request after close');

  // 7. A refused password (another program on the port)
  link.attach('B', A.port, 'wrong-password');
  check(
    (await until(() => seen('B', 'error', e => e.name === 'LinkRefused'))) &&
      (await until(() => seen('B', 'off', e => e.reason === 'refused'))),
    '401: an error, then off for good'
  );
  const refusedAt = A.requests;
  await sleep(500);
  check(A.requests === refusedAt && link.state('B') === null, 'no retry after a refused password');

  // 8. A server that is not OpenCode (no greeting)
  A.greet = false;
  link.attach('C', A.port, 'secret-A');
  await sleep(500);
  check(
    !seen('C', 'connected') && link.state('C') && link.state('C').connected === false,
    'a stream without OpenCode’s greeting is never treated as connected'
  );
  link.close('C');
  await A.close();

  // 8b. The version gate at connect
  const G = await standIn('secret-G').listen();
  G.version = '2.0.0';
  delete G.doc.paths['/permission/{requestID}/reply'];
  G.doc.components.schemas.E0.properties.type.enum = ['renamed.event'];
  link.attach('G', G.port, 'secret-G');
  const bad = await until(() => seen('G', 'error', e => e.name === 'LinkContract'));
  check(
    bad &&
      /2\.0\.0 lacks: /.test(bad.message) &&
      /route POST \/permission\/\{requestID\}\/reply/.test(bad.message) &&
      /event server\.connected/.test(bad.message),
    'a version whose /doc lacks a route and an event: an error that names them'
  );
  check(
    (await until(() => seen('G', 'off', e => e.reason === 'contract'))) &&
      !seen('G', 'connected') &&
      link.state('G') === null,
    'then off, never connected: the panel runs on without the link'
  );
  const gAt = G.requests;
  await sleep(400);
  check(G.requests === gAt, 'no retry after a failed contract test');
  check(link.known().bad.includes('2.0.0'), 'the failed version is remembered');
  link.init({ version: async () => '2.0.0', dir });
  await link.launch('warm');
  link.close('warm'); // the first start reads the installed version
  check(
    (await link.launch('gate2')) === null,
    'a panel of a version known to fail starts without the link’s flags'
  );
  G.version = '1.5.0';
  G.docReads = 0;
  link.tune(null, ['1.5.0']);
  link.attach('H', G.port, 'secret-G');
  check(
    (await until(() => seen('H', 'connected'))) && G.docReads === 0,
    'a version in the shipped list is used without reading /doc, whatever /doc says'
  );
  link.close('H');
  G.version = '3.0.0';
  G.doc = 'not json at all';
  link.attach('I', G.port, 'secret-G');
  check(
    (await until(() => seen('I', 'off', e => e.reason === 'contract'))) &&
      !link.known().bad.includes('3.0.0'),
    'no API description: off for this panel, not remembered as failed'
  );
  await G.close();
  link.tune({ version: 1500 }, []);
  link.init({ version: async () => '4.0.0', dir });
  await link.launch('warm');
  link.close('warm');
  const early = await link.launch('early');
  link.started('early', early.id);
  link.close('early', early.id, 1);
  check(
    (await link.launch('early2')) === null && link.known().badNow.includes('4.0.0'),
    'a panel that ended with an error before its server answered: no flags for that version until the app restarts'
  );

  // 9. A dead server
  link.attach('D', A.port, 'secret-A'); // nothing listens there now
  const t0 = Date.now();
  check((await link.abort('D', 'ses_x')).ok === false, 'a call to a dead server fails quietly');
  check(
    (await until(() => seen('D', 'off', e => e.reason === 'never answered'), 4000)) &&
      link.state('D') === null,
    'never answered: given up and forgotten (' +
      (Date.now() - t0) +
      ' ms with the check’s short limit)'
  );
  check(
    !seen('D', 'connected') && !seen('D', 'disconnected'),
    'no connected or disconnected event for a server that never answered'
  );

  // 10. No password in any event
  const all = JSON.stringify(events);
  check(
    !all.includes('secret-A') && !all.includes('wrong-password') && !/Basic /.test(all),
    'no password or auth header in any event'
  );

  // 11. Launch arguments (agent-registry.js)
  let spec = null,
    plain = null;
  try {
    spec = await registry.spec('OpenCode', 'run', { serverPort: 45678, resumeId: 'ses_abc' });
    plain = await registry.spec('OpenCode', 'run', {});
  } catch {}
  if (!spec) console.log('skip launch arguments: OpenCode is not installed here');
  else {
    // a .cmd launch is one quoted cmd.exe line
    const words = x => x.args.join(' ').replace(/[\^"]/g, '');
    const line = words(spec),
      plainLine = words(plain);
    check(
      /--port 45678/.test(line) &&
        /--hostname 127\.0\.0\.1/.test(line) &&
        /--session ses_abc/.test(line),
      'with a link: --port, --hostname 127.0.0.1, and the resume argument kept'
    );
    check(!/--port|--hostname/.test(plainLine), 'without a link: no --port, no --hostname');
    check(
      !/mdns/.test(line) &&
        !/PASSWORD/i.test(line) &&
        !('OPENCODE_SERVER_PASSWORD' in (spec.env || {})),
      'never --mdns; the password is not an argument and not set by the registry'
    );
    const hand = registry.handArgs('OpenCode', { workRules: 'x', rulesFile: __filename });
    check(
      !/--port|--hostname/.test(words(hand)) && !('OPENCODE_SERVER_PASSWORD' in hand.env),
      'a hand-typed opencode gets no port and no password'
    );
  }

  console.log(ok ? 'PASS' : 'FAILED');
  process.exit(ok ? 0 : 1);
})().catch(e => {
  console.log('FAIL', e);
  process.exit(1);
});
