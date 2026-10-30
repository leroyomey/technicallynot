// Technically Not · tools/agent-proposals-test.js — Plain Node test of desktop/agent-proposals.js:
// `tnai agent save` drafts become proposals that change no agent, and every refusal says why.
// Run: node tools/agent-proposals-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const proposals = require('../desktop/agent-proposals');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-proposals-'));
const project = path.join(scratch, 'project');
fs.mkdirSync(project);

const agents = [
  {
    id: 'agent-1',
    name: 'Fixer',
    base: 'Claude Code',
    role: 'Fixes bugs.',
    skillIds: ['project:.claude/skills/tnai-verification'],
    scope: 'project',
  },
  {
    id: 'agent-2',
    name: 'Writer',
    base: 'Codex',
    role: 'Writes docs.',
    skillIds: [],
    scope: 'personal',
  },
];
const skillRows = [
  { id: 'project:.claude/skills/tnai-verification', name: 'tnai-verification', source: 'project' },
  { id: 'project:.claude/skills/tnai-web-design', name: 'tnai-web-design', source: 'project' },
  { id: 'web-layout-css', name: 'web-layout-css', source: 'imported' },
  { id: 'user:mine', name: 'mine', source: 'user' },
];
let changes = 0;
proposals.init({
  file: path.join(scratch, 'agent-proposals.json'),
  agents: () => agents,
  skills: () => skillRows,
  clis: () => ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode', 'Copilot CLI'],
  supportsSkills: base => ['Claude Code', 'OpenCode', 'Cursor Agent'].includes(base),
  changed: () => changes++,
});
const context = { project, by: 'Nova', byCli: 'Claude Code' };
const refuses = (draft, words) =>
  assert.throws(
    () => proposals.propose(draft, context),
    error => {
      assert.ok(error.message.includes(words), 'expected "' + words + '" in: ' + error.message);
      return true;
    }
  );
const before = JSON.stringify(agents);

// 1. A new agent from a markdown draft: frontmatter + the role as its body.
const draftFile = path.join(scratch, 'marketing.md');
fs.writeFileSync(
  draftFile,
  '---\nname: Rechecks\ncli: claude\nskills: tnai-web-design, web-layout-css\n---\nRechecks marketing pages.\nReads docs/notes/website-handoff.md first.\n'
);
const made = proposals.propose(proposals.readDraft('marketing.md', scratch), context);
assert.strictEqual(made.proposal.kind, 'new');
assert.strictEqual(made.proposal.scope, 'project');
assert.strictEqual(made.proposal.after.base, 'Claude Code');
assert.strictEqual(
  made.proposal.after.role,
  'Rechecks marketing pages. Reads docs/notes/website-handoff.md first.'
);
assert.deepStrictEqual(made.proposal.after.skillIds, [
  'project:.claude/skills/tnai-web-design',
  'web-layout-css',
]);
assert.strictEqual(proposals.list(project).length, 1);
assert.strictEqual(
  proposals.list(path.join(scratch, 'other')).length,
  0,
  'a project proposal shows only in its project'
);

// 2. An edit from JSON: one more skill and a new role; before and after are kept.
const edit = proposals.propose(
  {
    edit: 'fixer',
    role: 'Fixes bugs. Runs the tests before reporting.',
    addSkills: ['tnai-web-design'],
  },
  context
);
assert.strictEqual(edit.proposal.kind, 'edit');
assert.strictEqual(edit.proposal.before.role, 'Fixes bugs.');
assert.ok(
  proposals.describe(edit.proposal).some(l => l.startsWith('Skills added: tnai-web-design'))
);

// 3. A newer draft for the same agent replaces the waiting one.
const again = proposals.propose({ edit: 'Fixer', role: 'Fixes bugs; tests first.' }, context);
assert.strictEqual(again.replaced, true);
assert.strictEqual(proposals.list(project).length, 2);

// 4. Refusals, each with its reason; nothing stored for them.
refuses({ edit: 'Nobody', role: 'x' }, 'No custom agent named');
refuses({ name: 'fixer' }, 'already exists');
refuses({ name: 'Long', role: 'x'.repeat(301) }, 'at most 300');
refuses({ name: 'Keys', role: 'Use api_key: abcdefghijkl to deploy' }, 'password or key');
refuses({ name: 'Bad', skills: 'mine' }, 'Unknown skill');
refuses({ name: 'Odd', cli: 'emacs' }, 'Unknown agent CLI');
refuses({ edit: 'Fixer', cli: 'Codex' }, 'cannot move to another CLI');
refuses({ edit: 'Writer', role: 'Writes docs.' }, 'Nothing would change');
assert.strictEqual(proposals.list(project).length, 2);

// 5. A CLI without per-session skills keeps the name and role and says the skills were left out;
// account and auto-start fields never travel in a proposal.
const codex = proposals.propose(
  { name: 'Codex helper', cli: 'codex', skills: 'web-layout-css', autoStart: true },
  context
);
assert.deepStrictEqual(codex.proposal.after.skillIds, []);
assert.ok(codex.proposal.notes.some(n => n.includes('takes the name and role only')));
assert.ok(codex.proposal.notes.some(n => n.includes('Left out autoStart')));
assert.ok(!('autoStart' in codex.proposal.after));

// 6. A personal draft takes library skills only, and is listed in every project.
refuses({ name: 'Solo', scope: 'personal', skills: 'tnai-verification' }, 'library skills only');
proposals.propose({ name: 'Solo', scope: 'personal', skills: 'web-layout-css' }, context);
assert.ok(proposals.list(path.join(scratch, 'other')).some(p => p.after.name === 'Solo'));

// 7. Settling: accepted or declined proposals leave the pending list and stay in the settled one.
proposals.settle(made.proposal.id, 'accepted');
proposals.settle(again.proposal.id, 'declined');
assert.ok(!proposals.list(project).some(p => p.id === made.proposal.id));
assert.strictEqual(proposals.get(made.proposal.id).state, 'accepted');
assert.strictEqual(proposals.list(project, { settled: true }).length, 4);
assert.throws(() => proposals.settle('missing', 'accepted'), /no longer there/);

// 8. Nothing here wrote an agent; every stored change was told to the window.
assert.strictEqual(JSON.stringify(agents), before);
assert.ok(changes >= 5);

// 9. End to end: the real `tnai` command (desktop/agent-shim.js) talks to the real mesh
// (desktop/agent-mesh.js), as tools/mesh-rename-test.js does. The panel list and the window are
// stand-ins; no CLI or agent runs and no window opens.
async function endToEnd() {
  const Module = require('module');
  const { execFile } = require('child_process');
  const userData = path.join(scratch, 'userData');
  const realLoad = Module._load;
  Module._load = (request, ...rest) =>
    request === 'electron'
      ? { app: { getPath: () => userData }, dialog: {} }
      : realLoad(request, ...rest);
  const mesh = require('../desktop/agent-mesh');
  Module._load = realLoad;

  const sessions = [
    {
      paneId: 'pane-F',
      running: true,
      agent: 'Claude Code',
      mode: 'run',
      lastOutputAt: 0,
      startedAt: Date.now(),
    },
  ];
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
    skills: {
      agents: { list: () => agents.map(a => ({ ...a, supportsSkills: a.base !== 'Codex' })) },
    },
    proposals,
  });

  // The panel runs as the custom agent Fixer (its panel carries the agent's name).
  mesh.setNames([{ paneId: 'pane-F', name: 'Fixer', agent: 'Claude Code' }]);
  const add = await mesh.prepare('pane-F', project, project);
  const env = { ...process.env };
  add(env);
  const shim = path.join(__dirname, '..', 'desktop', 'agent-shim.js');
  const tnai = (...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [shim, 'tnai', ...argv],
        { cwd: project, env, windowsHide: true, timeout: 60000 },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );

  let r = await tnai('agent', 'list');
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(
    /Custom agents \(2;/.test(r.out) && /Fixer {2}·  Claude Code {2}·  project/.test(r.out),
    r.out
  );
  r = await tnai('agent', 'show');
  assert.ok(/^Fixer \(this panel\)/m.test(r.out) && /Role: Fixes bugs\./.test(r.out), r.out);
  r = await tnai('agent', 'show', 'Writer');
  assert.ok(/Codex does not load attached skills/.test(r.out), r.out);
  r = await tnai('agent', 'show', 'Nobody');
  assert.ok(r.code !== 0 && /No custom agent named/.test(r.out), r.out);

  // A correction of the agent itself becomes a proposal by the panel's own name; the agent list
  // is unchanged.
  fs.writeFileSync(
    path.join(project, 'fixer.md'),
    '---\nedit: Fixer\n---\nFixes bugs. Always runs the tests before reporting.\n'
  );
  r = await tnai('agent', 'save', 'fixer.md');
  assert.strictEqual(r.code, 0, r.out);
  assert.ok(
    /waits for the user in the bell/.test(r.out) &&
      /Role after: Fixes bugs\. Always runs/.test(r.out),
    r.out
  );
  const waiting = proposals.list(project).find(p => p.targetId === 'agent-1');
  assert.strictEqual(waiting.by, 'Fixer');
  r = await tnai('agent', 'save', 'missing.md');
  assert.ok(
    r.code !== 0 &&
      /Proposal not saved: Not found/.test(r.out) &&
      /try: fix what it names/.test(r.out),
    r.out
  );
  assert.strictEqual(JSON.stringify(agents), before);
  mesh.stop();
}

// 10. The bell: src/scripts/60-bell-notices.js runs in a sandbox with a stand-in bell, the
// proposals bridge and 17's custom agent API. Each pending proposal is one notice with Accept and
// Decline; Accept saves through the custom agent API only, and never over a change the user made
// since the proposal.
// Values made inside the sandbox have its own Array and Object, so compare them as JSON.
const sameJson = (actual, expected) =>
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));

async function bell() {
  const vm = require('vm');
  const notices = new Map(),
    calls = [],
    settled = [],
    toasts = [],
    listeners = {};
  let pending = proposals.list(project);
  const stored = { 'agent-1': { ...agents[0] } };
  const custom = {
    refresh: async () => calls.push('refresh'),
    get: id => stored[id] || null,
    create: async data => calls.push(['create', data]),
    rename: async (id, name) => calls.push(['rename', id, name]),
    update: async (id, fields) => calls.push(['update', id, fields]),
    attach: async (id, ids) => calls.push(['attach', id, ids]),
    detach: async (id, ids) => calls.push(['detach', id, ids]),
  };
  const window = {
    tnaiNative: {
      agentProposals: {
        list: async () => ({ ok: true, value: pending }),
        settle: async (id, state) => settled.push([id, state]),
        onChanged: fn => (listeners.changed = fn),
      },
    },
    TnaiNextActions: {
      notify: n => notices.set(n.key, n),
      unnotify: key => notices.delete(key),
    },
    TnaiCustomAgents: custom,
    toast: message => toasts.push(message),
    addEventListener: (name, fn) => (listeners[name] = fn),
  };
  window.window = window;
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scripts', '60-bell-notices.js'),
    'utf8'
  );
  vm.runInNewContext(code, { window, console, document: { querySelector: () => null } });
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  await settle();

  const edit = [...notices.values()].find(n => /proposes a change to “Fixer”/.test(n.title));
  assert.ok(edit, 'one notice for the waiting Fixer proposal');
  assert.strictEqual(edit.full, true);
  assert.ok(
    /Role now: Fixes bugs\.\nRole after: Fixes bugs\. Always runs/.test(edit.text),
    edit.text
  );
  sameJson(
    edit.actions.map(a => a.label),
    ['Accept', 'Decline']
  );

  // Accept: role saved through update, the proposal settled as accepted.
  edit.actions[0].run();
  await settle();
  const fixerProposal = pending.find(p => p.targetId === 'agent-1');
  sameJson(
    calls.filter(c => c[0] === 'update'),
    [['update', 'agent-1', { role: 'Fixes bugs. Always runs the tests before reporting.' }]]
  );
  sameJson(settled.pop(), [fixerProposal.id, 'accepted']);

  // The user changed Fixer in the meantime: Accept refuses and saves nothing.
  stored['agent-1'].role = 'Changed by the user.';
  calls.length = 0;
  edit.actions[0].run();
  await settle();
  assert.ok(!calls.some(c => c[0] === 'update') && !settled.length, JSON.stringify(calls));
  assert.ok(
    toasts.some(t => /was changed since this was proposed/.test(t)),
    toasts.join(' | ')
  );

  // A new agent: Accept creates it with exactly the proposed fields; Decline only settles.
  const fresh = proposals.propose(
    { name: 'Scout', role: 'Looks around.', skills: 'web-layout-css' },
    context
  ).proposal;
  pending = proposals.list(project);
  listeners.changed();
  await settle();
  const scout = notices.get('agent-proposal:' + fresh.id);
  scout.actions[0].run();
  await settle();
  sameJson(
    calls.find(c => c[0] === 'create'),
    [
      'create',
      {
        name: 'Scout',
        base: 'Claude Code',
        role: 'Looks around.',
        skillIds: ['web-layout-css'],
        scope: 'project',
      },
    ]
  );
  scout.actions[1].run();
  await settle();
  sameJson(settled.pop(), [fresh.id, 'declined']);

  // A proposal that is no longer pending leaves the bell.
  pending = [];
  listeners.changed();
  await settle();
  assert.ok(![...notices.keys()].some(k => k.startsWith('agent-proposal:')));
}

endToEnd()
  .then(bell)
  .then(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log('agent-proposals-test: OK (10 groups)');
  })
  .catch(error => {
    console.log('FAIL ' + (error.stack || error));
    process.exit(1);
  });
