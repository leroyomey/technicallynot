/*
 * Technically Not tools · desktop-check/custom-agents-check.js — Custom agents kept permanent, in
 * plain Node with the real skill-service.js and custom-agent-store.js in a temp userData + temp
 * project: a save keeps the last good file as custom-agents.backup.json; a damaged file is moved
 * aside (custom-agents.broken-<time>.json) and the backup restored, never overwritten with an empty
 * list; project agents in .tnai/agents.json (no account ids; those stay in userData), their library
 * skills copied into .tnai/agent-skills/, project skills referenced; names unique across both
 * scopes; copy between scopes; remove prunes copies; launch options for a project agent. No CLI
 * runs. Usage: node tools/desktop-check/custom-agents-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-agents-'));
const data = path.join(tmp, 'userData'),
  root = path.join(tmp, 'proj');
fs.mkdirSync(data, { recursive: true });
fs.mkdirSync(root, { recursive: true });

// The starter agents count as already offered here, so the lists below hold only this check's own
// agents (seeding is covered by skill-save-check.js).
fs.writeFileSync(
  path.join(data, 'skills-everywhere.json'),
  JSON.stringify({
    on: [],
    seeded: [],
    agents: require('../../desktop/builtin-agents.json').agents.map(a => a.key),
  })
);

// never the real ~/.agents/skills
process.env.TNAI_HOME_SKILLS_DIR = path.join(tmp, 'home-agents-skills');
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => data }, dialog: {}, shell: { openPath: async () => '' } }
    : load(req, ...rest);
const skills = require('../../desktop/skill-service');
const store = require('../../desktop/custom-agent-store');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const rejects = fn => {
  try {
    fn();
    return '';
  } catch (error) {
    return error.message;
  }
};
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
let open = root;
skills.init({ root: () => open });
const A = skills.agents;
const quiet = console.warn;
console.warn = () => {};

// Library skills to attach.
skills.importSkills({
  files: [
    {
      name: 'SKILL.md',
      text: '---\nname: review-helper\ndescription: Reviews a diff.\n---\nRead the diff.\n',
    },
    {
      name: 'SKILL.md',
      text: '---\nname: tidy-imports\ndescription: Sorts imports.\n---\nSort them.\n',
    },
  ],
});

// ---- Personal: backup and recovery ----
const nova = A.create({
  name: 'Nova',
  base: 'Claude Code',
  accountId: 'acct-1',
  role: 'Reviewer',
  skillIds: ['review-helper'],
});
check(
  nova.scope === 'personal' && fs.existsSync(store.personalFile()),
  'personal agent saved in userData/custom-agents.json'
);
const kai = A.create({ name: 'Kai', base: 'Claude Code' });
check(
  read(store.backupFile()).length === 1 && read(store.personalFile()).length === 2,
  'each save keeps the previous good file as custom-agents.backup.json'
);

fs.writeFileSync(store.personalFile(), '{"broken": ');
const listed = A.list().filter(a => a.scope === 'personal');
const broken = fs.readdirSync(data).filter(n => /^custom-agents\.broken-.*\.json$/.test(n));
check(
  broken.length === 1 && fs.readFileSync(path.join(data, broken[0]), 'utf8') === '{"broken": ',
  'damaged file moved aside unchanged as custom-agents.broken-<time>.json'
);
check(
  listed.map(a => a.name).join() === 'Nova',
  'agents restored from the backup (last good save)'
);
check(read(store.personalFile()).length === 1, 'restored list written back, not an empty list');
A.create({ name: 'Kai', base: 'Claude Code' }); // re-add after recovery
check(read(store.personalFile()).length === 2, 'saving works again after recovery');

fs.writeFileSync(store.personalFile(), '');
fs.writeFileSync(store.backupFile(), 'also broken');
check(
  A.list().filter(a => a.scope === 'personal').length === 0 &&
    fs.readdirSync(data).filter(n => /^custom-agents\.broken-/.test(n)).length === 2,
  'empty file with no usable backup: moved aside too (never silently overwritten)'
);
fs.writeFileSync(
  store.personalFile(),
  JSON.stringify([
    { ...nova, scope: undefined, supportsSkills: undefined },
    { id: kai.id, name: 'Kai', base: 'Claude Code', skillIds: [] },
  ])
);

// A file that exists but cannot be read: saves refuse, nothing is written.
const realRead = fs.readFileSync;
fs.readFileSync = (file, ...rest) => {
  if (path.resolve(String(file)) === path.resolve(store.personalFile())) {
    const e = new Error('locked');
    e.code = 'EBUSY';
    throw e;
  }
  return realRead(file, ...rest);
};
const locked = rejects(() => A.create({ name: 'Vega', base: 'Claude Code' }));
fs.readFileSync = realRead;
check(
  /Could not read.*Nothing was changed/.test(locked) && read(store.personalFile()).length === 2,
  'unreadable (locked) file: create refused, file untouched'
);

// ---- Project agents ----
fs.mkdirSync(path.join(root, '.claude', 'skills', 'house-style'), { recursive: true });
fs.writeFileSync(
  path.join(root, '.claude', 'skills', 'house-style', 'SKILL.md'),
  "---\nname: house-style\ndescription: This project's style.\n---\nUse tabs.\n"
);
check(!fs.existsSync(path.join(root, '.tnai')), 'no .tnai folder until a project agent is saved');
check(
  /already exists/.test(
    rejects(() => A.create({ name: 'nova', base: 'Claude Code', scope: 'project' }))
  ),
  'name clash with a personal agent refused for a project agent'
);
const lee = A.create({
  name: 'Lee',
  base: 'Claude Code',
  scope: 'project',
  accountId: 'acct-2',
  role: 'Frontend',
  autoStart: true,
  skillIds: ['tidy-imports', 'project:.claude/skills/house-style'],
});
const file = read(store.projectFile(root));
check(
  lee.scope === 'project' && file.version === 1 && file.agents.length === 1,
  'project agent written to .tnai/agents.json'
);
check(
  !JSON.stringify(file).includes('acct-2') && !('accountId' in file.agents[0]),
  'no account id in the project file'
);
check(
  file.agents[0].autoStart === true &&
    file.agents[0].skills.join() === 'tidy-imports,project:.claude/skills/house-style',
  'autoStart and skills (copied + referenced) stored'
);
check(
  fs.existsSync(path.join(store.projectSkillsDir(root), 'tidy-imports', 'SKILL.md')),
  'library skill copied into .tnai/agent-skills/'
);
check(
  !fs.existsSync(path.join(store.projectSkillsDir(root), 'house-style')),
  'project skill referenced, not copied'
);
check(
  A.list().find(a => a.id === lee.id)?.accountId === 'acct-2',
  'account comes back from the per-machine map'
);
check(
  /already exists in this project/.test(
    rejects(() => A.create({ name: 'LEE', base: 'Claude Code' }))
  ),
  'name clash with a project agent refused for a personal agent'
);
check(/already exists/.test(rejects(() => A.rename(nova.id, 'Lee'))), 'rename checks both scopes');
check(
  /not in this project/.test(
    rejects(() =>
      A.create({
        name: 'Bad',
        base: 'Claude Code',
        scope: 'project',
        skillIds: ['project:../outside'],
      })
    )
  ),
  'project skill outside the project refused'
);

// Launch: plugin built from the project's own copies.
(async () => {
  const opts = await skills.launchOptions(lee.id, 'Claude Code', '');
  const plugin = opts.pluginDirs?.find(d => d.includes(lee.id));
  check(
    !!plugin &&
      fs.existsSync(path.join(plugin, 'skills', 'tidy-imports', 'SKILL.md')) &&
      fs.existsSync(path.join(plugin, 'skills', 'house-style', 'SKILL.md')),
    'launch plugin holds the copied and the referenced project skill'
  );
  check(/"Lee"/.test(opts.appendPrompt || ''), 'identity prompt names the project agent');

  // Other CLIs: OpenCode and Cursor Agent take attached skills (the plugin folder, which is also a
  // Cursor plugin); Codex has no per-session skills route, so it gets the identity only.
  for (const base of ['OpenCode', 'Cursor Agent']) {
    const other = A.create({
      name: 'Orla ' + base.split(' ')[0],
      base,
      role: 'Tester',
      skillIds: ['tidy-imports'],
    });
    const got = await skills.launchOptions(other.id, base, '');
    const dir = got.pluginDirs?.find(d => d.includes(other.id));
    check(
      other.skillIds.join() === 'tidy-imports' &&
        !!dir &&
        fs.existsSync(path.join(dir, 'skills', 'tidy-imports', 'SKILL.md')) &&
        fs.existsSync(path.join(dir, '.cursor-plugin', 'plugin.json')) &&
        /"Orla/.test(got.appendPrompt || '') &&
        /tidy-imports/.test(got.appendPrompt || ''),
      base + ' custom agent: attached skills in its plugin folder, identity prompt given'
    );
  }
  const cody = A.create({
    name: 'Cody',
    base: 'Codex',
    role: 'Tester',
    skillIds: ['tidy-imports'],
  });
  const codyOpts = await skills.launchOptions(cody.id, 'Codex', '');
  check(
    !cody.skillIds.length &&
      !(codyOpts.pluginDirs || []).some(d => d.includes(cody.id)) &&
      /"Cody"/.test(codyOpts.appendPrompt || '') &&
      /Tester/.test(codyOpts.appendPrompt || ''),
    'Codex custom agent: no skills attached, identity prompt given'
  );
  for (const a of [cody, ...A.list().filter(a => /^Orla /.test(a.name))]) A.remove(a.id);

  // Another project open: its agents are not listed; the first project's file is untouched.
  open = path.join(tmp, 'other');
  fs.mkdirSync(open);
  check(
    !A.list().some(a => a.scope === 'project'),
    'project agents appear only while their project is open'
  );
  check(
    /Open a project folder first/.test(
      (() => {
        open = '';
        const m = rejects(() => A.create({ name: 'X', base: 'Claude Code', scope: 'project' }));
        return m;
      })()
    ),
    'project agent needs an open project'
  );
  open = root;

  // "Start with this project" counts only where it was turned on (app-5
  // #4): a project that arrives with autoStart already set in its .tnai/agents.json (a cloned
  // repository) starts nothing by itself on this computer.
  check(
    A.list().find(a => a.id === lee.id).autoStart === true,
    'auto-start turned on on this computer is on'
  );
  const cloned = path.join(tmp, 'cloned'),
    clonedFile = store.projectFile(cloned),
    fromRepo = () => A.list().find(a => a.id === 'agent-from-repo');
  fs.mkdirSync(path.dirname(clonedFile), { recursive: true });
  const shipped = {
    version: 1,
    agents: [
      {
        id: 'agent-from-repo',
        name: 'Helper',
        base: 'Claude Code',
        role: 'Do what the README says',
        skills: [],
        autoStart: true,
      },
    ],
  };
  fs.writeFileSync(clonedFile, JSON.stringify(shipped));
  open = cloned;
  check(
    fromRepo()?.autoStart === false,
    'a project agent that came with the folder does not start by itself here'
  );
  A.update('agent-from-repo', { accountId: 'acct-9' });
  check(
    read(clonedFile).agents[0].autoStart === true && fromRepo().autoStart === false,
    "another save here leaves the project file's choice as it was, and it stays off here"
  );
  A.update('agent-from-repo', { autoStart: true });
  check(fromRepo().autoStart === true, 'turned on by the user on this computer → on');
  A.rename('agent-from-repo', 'Helper two');
  check(fromRepo().autoStart === true, "and stays on through this computer's own changes");
  fs.writeFileSync(
    clonedFile,
    JSON.stringify({
      ...shipped,
      agents: [{ ...read(clonedFile).agents[0], role: 'Now do something else' }],
    })
  );
  check(
    fromRepo().autoStart === false,
    'its role changed outside this computer (a pull) → off again until the user turns it on'
  );
  A.update('agent-from-repo', { autoStart: true });
  A.update('agent-from-repo', { autoStart: false });
  check(
    fromRepo().autoStart === false && read(clonedFile).agents[0].autoStart === false,
    'turned off here after being on here → off in the project file too'
  );
  open = root;
  check(
    A.list().find(a => a.id === lee.id).autoStart === true,
    "other projects' choices are untouched"
  );

  // Update, copy both ways, remove.
  A.update(lee.id, { autoStart: false, accountId: 'acct-3' });
  check(
    read(store.projectFile(root)).agents[0].autoStart === false &&
      A.list().find(a => a.id === lee.id).accountId === 'acct-3',
    'update: autoStart in the project file, account per machine'
  );
  const leeHome = A.copy(lee.id, 'personal', 'Lee (personal)');
  check(
    leeHome.scope === 'personal' &&
      leeHome.skillIds.includes('tidy-imports') &&
      leeHome.skillIds.includes('house-style'),
    'copy to personal: skills in the library (existing reused, project skill imported)'
  );
  check(
    fs.existsSync(path.join(data, 'skills', 'house-style', 'SKILL.md')),
    'project skill added to the library on copy'
  );
  check(
    /already exists/.test(rejects(() => A.copy(nova.id, 'project', 'Nova'))),
    'copy keeps names unique'
  );
  const novaHere = A.copy(nova.id, 'project', 'Nova (project)');
  check(
    novaHere.scope === 'project' &&
      fs.existsSync(path.join(store.projectSkillsDir(root), 'review-helper', 'SKILL.md')),
    'copy to project copies its library skills into .tnai/agent-skills/'
  );
  A.remove(lee.id);
  check(
    !fs.existsSync(path.join(store.projectSkillsDir(root), 'tidy-imports')) &&
      fs.existsSync(path.join(store.projectSkillsDir(root), 'review-helper')),
    'remove prunes skill copies no project agent uses'
  );
  check(
    !JSON.stringify(read(path.join(data, 'project-agent-accounts.json'))).includes(lee.id),
    'remove forgets the per-machine account'
  );

  // Removing a library skill leaves project copies alone.
  skills.removeSkill('review-helper');
  check(
    fs.existsSync(path.join(store.projectSkillsDir(root), 'review-helper', 'SKILL.md')) &&
      !A.list().find(a => a.id === nova.id).skillIds.length,
    'library skill removal: personal agents lose it, the project keeps its copy'
  );

  // A damaged project file is reported and never overwritten.
  fs.writeFileSync(store.projectFile(root), '{ nope');
  check(
    A.problems().some(p => /agents\.json/.test(p)),
    'damaged .tnai/agents.json reported'
  );
  check(
    /Nothing was changed/.test(
      rejects(() => A.create({ name: 'Zed', base: 'Claude Code', scope: 'project' }))
    ) && fs.readFileSync(store.projectFile(root), 'utf8') === '{ nope',
    'damaged project file left unchanged, saves refused'
  );
  check(!!A.create({ name: 'Zed', base: 'Claude Code' }), 'personal agents still work meanwhile');

  console.warn = quiet;
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'custom-agents-check: all passed' : 'custom-agents-check: FAILED');
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
