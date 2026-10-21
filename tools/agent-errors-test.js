// Test of the error codes agents get back (desktop/agent-errors.js): node
// tools/agent-errors-test.js
//
// Every failure of the `tnai` command and of the tnai_* tools keeps its readable sentence first and
// ends with one line in a fixed shape, "code: CODE · try: HINT", so an agent of any CLI can run the
// fix instead of guessing. The real `tnai` shim (desktop/agent-shim.js) talks to the real mesh
// (agent-mesh.js) with the real file locks, project context, task board and sub-agent graph; the
// terminal list and the window are stand-ins. Exit codes are as before (1 for a refused command, 2
// for a wrong one). Plain Node, no CLI or agent runs, no window opens.
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');

// Nothing of the Technically Not terminal this test may run in reaches the shim.
for (const key of Object.keys(process.env)) if (/^TNAI_/.test(key)) delete process.env[key];

const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-errors-'));
const userData = path.join(tmp, 'userData');
const project = path.join(tmp, 'project');
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => userData }, dialog: {}, shell: { openPath: async () => '' } }
    : load(req, ...rest);
const errors = require('../desktop/agent-errors');
const mesh = require('../desktop/agent-mesh');
const locks = require('../desktop/file-locks');
const lifecycle = require('../desktop/agent-lifecycle');
const context = require('../desktop/agent-context');
const graph = require('../desktop/agent-graph');
Module._load = load;

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const SHIM = path.join(__dirname, '..', 'desktop', 'agent-shim.js');

// The last line a failure prints, and whether it has the fixed shape.
const lastLine = out => out.trim().split(/\r?\n/).pop();
const SHAPE =
  /^code: (not_found|invalid|busy|locked|full|refused|unreachable|internal)( · try: .+)?$/;

(async () => {
  // ---- the helper itself ----
  check(
    'the line has its fixed shape',
    errors.line('not_found', 'tnai agents') === 'code: not_found · try: tnai agents'
  );
  check('a code with no fix is the code alone', errors.line('internal') === 'code: internal');
  const f = errors.fail('busy', 'Wait.', 'tnai wait');
  check(
    'fail keeps the sentence and adds code and hint',
    f.ok === false && f.error === 'Wait.' && f.code === 'busy' && f.hint === 'tnai wait',
    f
  );
  check('an unknown code becomes internal', errors.fail('oops', 'x').code === 'internal');
  check(
    'pass keeps the code of a failure handed on, else takes the one given',
    errors.pass({ error: 'a', code: 'locked', hint: 'h' }, 'invalid', 'x').hint === 'h' &&
      errors.pass({ error: 'a' }, 'invalid', 'x').code === 'invalid'
  );
  check(
    'ensure gives an untagged failure a code and leaves answers alone',
    errors.ensure({ ok: false, error: 'x' }).code === 'refused' &&
      errors.ensure({ ok: true }).code === undefined &&
      errors.ensure({ ok: false, error: 'x', code: 'full' }).code === 'full'
  );
  const t = errors.toolFail('No.', 'refused', 'do it yourself');
  check(
    'a tool failure: the sentence, then the line, and the fields',
    t.isError === true &&
      t.content[0].text === 'No.\ncode: refused · try: do it yourself' &&
      t.code === 'refused' &&
      t.hint === 'do it yourself',
    t
  );
  check('withoutLine gives the sentence back', errors.withoutLine(t.content[0].text) === 'No.');

  // ---- the real mesh, locks, context and graph ----
  const names = new Map([
    ['pane-A', 'Alpha'],
    ['pane-B', 'Beta'],
  ]);
  const publish = () => mesh.setNames([...names].map(([paneId, name]) => ({ paneId, name })));
  const sessions = ['pane-A', 'pane-B'].map(paneId => ({
    paneId,
    running: true,
    agent: 'Claude Code',
    mode: 'run',
    lastOutputAt: 0,
    startedAt: Date.now(),
  }));
  locks.init(() => {}, {});
  lifecycle.init(() => {}, { canResume: () => true, root: () => project });
  context.init(() => {}, { root: () => project, ptys: { replay: () => null } });
  graph.init(() => {}, {
    ptys: { list: () => [], write() {}, stop() {} },
    submit: async () => ({ ok: true }),
  });
  graph.setSettings({ maxDepth: 1, maxActivePerAgent: 2, maxActiveTotal: 3, graceSeconds: 10 });
  mesh.init(() => {}, {
    ptys: { list: () => sessions, replay: () => null, write: () => {} },
    turns: { stopped: () => 'reply', busy: () => true },
    attention: { blocker: () => null, hasDraft: () => false },
    projects: async () => [project],
    hooks: { note() {}, launchOptions: async () => ({}) },
    lifecycle: {
      note() {},
      instanceOf: p => 'inst-' + p,
      lookup: () => null,
      info: () => ({ subagent: false }),
      startedOpen: () => 0,
    },
    submit: async () => ({ ok: true, state: 'sent' }),
    locks,
    context,
    graph,
  });
  publish();
  const envOf = async paneId => {
    const add = await mesh.prepare(paneId, project, project);
    const env = { ...process.env };
    add(env);
    return env;
  };
  const env = { A: await envOf('pane-A') };
  const run = (environment, ...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env: environment, windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );
  const tnai = (...argv) => run(env.A, ...argv);

  // One failing command: its sentence first, unchanged; the code line last; the exit code as
  // before.
  async function expect(name, argv, sentence, code, hint, exit = 1) {
    const r = await tnai(...argv);
    const last = lastLine(r.out);
    check(
      name,
      r.code === exit &&
        sentence.test(r.out.split(/\r?\n/)[0]) &&
        SHAPE.test(last) &&
        last.startsWith('code: ' + code) &&
        (hint ? last.includes(hint) : true) &&
        r.out.split('code: ').length === 2,
      r
    );
  }

  await expect(
    'send to an unknown agent: not_found, try tnai agents',
    ['send', 'Nobody', 'hello'],
    /^tnai: No agent "Nobody" in this project/,
    'not_found',
    'try: tnai agents'
  );
  await expect(
    'rename to a name another agent has: invalid, with the command',
    ['rename', 'Beta'],
    /^tnai: Another agent is already named Beta/,
    'invalid',
    'tnai rename OTHER_NAME'
  );
  await expect(
    'intervene yourself: invalid',
    ['intervene', 'Alpha', 'stop'],
    /^tnai: That is you\./,
    'invalid',
    'tnai agents'
  );
  await expect(
    'preview of an address that is not local: invalid, with the right form',
    ['preview', 'ftp://example.com'],
    /^tnai: Live preview shows addresses on this computer only/,
    'invalid',
    'tnai preview http://localhost:PORT'
  );

  // A port nothing listens on: taken and closed again here.
  const closed = await new Promise(resolve => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
  await expect(
    'preview of a dev server that is not running: unreachable, start it first',
    ['preview', 'http://127.0.0.1:' + closed],
    /^tnai: Nothing answers at/,
    'unreachable',
    'start the dev server'
  );

  // A file another agent holds.
  const held = path.join(project, 'shared.js');
  fs.writeFileSync(held, '// shared\n');
  locks.acquire(project, held, { paneId: 'pane-B', name: 'Beta', provider: 'Codex' });
  await expect(
    'lock a file another agent holds: locked, try tnai locks and a message to the holder',
    ['lock', 'shared.js'],
    /^tnai: Refused:/,
    'locked',
    'try: tnai locks, then tnai send Beta MESSAGE'
  );
  const direct = locks.acquire(project, held, { paneId: 'pane-A', name: 'Alpha' });
  check(
    'the lock refusal itself (which the edit hooks of Claude Code and OpenCode print) carries code and hint',
    direct.ok === false && direct.code === 'locked' && /tnai send Beta/.test(direct.hint),
    direct
  );

  // A full notes list: 20 notes, then a new key.
  for (let i = 0; i < 20; i++) context.query('pane-A', project, ['note', 'add', 'note ' + i]);
  await expect(
    'a new note on a full list: full, change an existing one instead',
    ['context', 'note', 'set', 'goal', 'ship it'],
    /^tnai: Use: tnai context note set KEY TEXT \(20 notes max\)\./,
    'full',
    'tnai context note list, then tnai context note set KEY TEXT with an existing KEY'
  );
  await expect(
    'add on a full list: full as well',
    ['context', 'note', 'add', 'one more'],
    /^tnai: The project has 20 notes; remove one first\./,
    'full',
    'tnai context note list'
  );
  await expect(
    'remove a note that does not exist: not_found',
    ['context', 'note', 'remove', 'nope'],
    /^tnai: No such note\./,
    'not_found',
    'try: tnai context note list'
  );
  await expect(
    'take a task that does not exist: not_found, try tnai tasks',
    ['tasks', 'take', '99'],
    /^tnai: No task #99 here\./,
    'not_found',
    'try: tnai tasks'
  );

  // A sub-agent asked for by an agent that is not a custom agent: the graph's own line is taken
  // off and printed once, from the reply's code and hint.
  await expect(
    'delegate from a session that is not a custom agent: refused, do it yourself',
    ['delegate', 'write the release notes for the next build please'],
    /^tnai: This session is not a custom agent/,
    'refused',
    'do the work yourself'
  );

  // A wrong command and no Technically Not at all: the exit codes 2 and 1 as before.
  await expect(
    'a command that does not exist: invalid, exit 2',
    ['frobnicate'],
    /^tnai: talk to the other AI agents/,
    'invalid',
    'the usage above',
    2
  );
  const bare = { ...process.env };
  let r = await run(bare, 'agents');
  check(
    'a shell Technically Not did not start: refused, exit 2',
    r.code === 2 &&
      lastLine(r.out).startsWith(
        'code: refused · try: run it in a terminal Technically Not started'
      ),
    r
  );
  r = await run({ ...env.A, TNAI_MESH_PORT: String(closed) }, 'agents');
  check(
    'Technically Not not answering: unreachable, exit 1',
    r.code === 1 &&
      lastLine(r.out).startsWith('code: unreachable · try: run the same command again'),
    r
  );

  // Straight to the mesh: an unknown request and a token it does not know.
  const raw = message =>
    new Promise(resolve => {
      const socket = net.connect(Number(env.A.TNAI_MESH_PORT), '127.0.0.1');
      let buffer = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
      socket.on('data', chunk => {
        buffer += chunk;
      });
      socket.on('close', () => resolve(JSON.parse(buffer.split('\n')[0] || '{}')));
    });
  let reply = await raw({ token: env.A.TNAI_PANE_TOKEN, op: 'nope', cwd: project });
  check(
    'an unknown request: invalid, as JSON fields',
    reply.ok === false && reply.code === 'invalid' && !!reply.hint,
    reply
  );
  reply = await raw({ token: '0'.repeat(32), op: 'agents' });
  check(
    'a token the mesh does not know: refused',
    reply.ok === false && reply.code === 'refused',
    reply
  );

  // ---- the tnai_* tools (MCP), the same graph ----
  const text = res => res.content.map(c => c.text).join('\n');
  let res = await graph.call('plain', 'tnai_delegate', {});
  check(
    'tool: not a custom agent is refused, the line under the sentence, code and hint as fields',
    res.isError &&
      /not a custom agent/.test(text(res)) &&
      SHAPE.test(lastLine(text(res))) &&
      res.code === 'refused' &&
      !!res.hint,
    res
  );
  graph.rootStarted('root', 'custom-1', 'Nova');
  res = await graph.call('root', 'tnai_delegate', { purpose: 'x', task: 'short', why: '' });
  check(
    'tool: a task too thin to hand over is invalid',
    res.code === 'invalid' && /self-contained task/.test(text(res)),
    res
  );
  res = await graph.call('root', 'tnai_delegate', {
    purpose: 'Release notes',
    task: 'Write the release notes for the next build from the git log.',
    why: 'short',
  });
  check(
    'tool: no reason why delegating is better is invalid, with the fix',
    res.code === 'invalid' &&
      /explain why delegating/.test(text(res)) &&
      /tnai_delegate with why/.test(res.hint),
    res
  );
  res = await graph.call('root', 'tnai_assign', { id: 'zzzz', task: 'a follow-up task here' });
  check(
    'tool: assign to no such sub-agent is not_found',
    res.code === 'not_found' && SHAPE.test(lastLine(text(res))),
    res
  );
  res = await graph.call('root', 'tnai_nothing', {});
  check('tool: an unknown tool is invalid', res.code === 'invalid', res);

  mesh.stop?.();
  console.log(passed + ' passed, ' + failed + ' failed (Node ' + process.versions.node + ')');
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('FAIL the test itself: ' + (error?.stack || error));
  process.exit(1);
});
