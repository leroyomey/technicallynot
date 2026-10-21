/*
 * Technically Not tools · desktop-check/skill-save-check.js — `tnai skill save | list` end to end
 * in plain Node: the real tnai shim (desktop/agent-shim.js) talks to the real agent mesh
 * (desktop/agent-mesh.js, fake terminal list) which saves into skill-service's library under a temp
 * userData folder. Covers save of a folder and of a file, relative paths, refused input (no
 * frontmatter, tnai-hidden, a user-imported skill of the same name), update of an agent-written
 * skill, the `by: 'agent'` mark, on for every session when new, the marked copies for Codex and
 * Copilot, the starter agents, and the list. Same-topic skills (desktop/skill-overlap.js):
 * detection, save refused unless --distinct, `tnai skill overlaps [PATH]`, `tnai skill remove`, the
 * Skills page's overlaps field. No CLI or agent runs. Usage: node
 * tools/desktop-check/skill-save-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-skillsave-'));
const userData = path.join(tmp, 'userData'),
  project = path.join(tmp, 'project'),
  scratch = path.join(project, 'scratch');

// the user's ~/.claude/skills stand-in
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');

// the user's ~/.agents/skills stand-in (never the real one)
process.env.TNAI_HOME_SKILLS_DIR = path.join(tmp, 'home-agents-skills');
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron' ? { app: { getPath: () => userData }, dialog: {} } : load(req, ...rest);
const skills = require('../../desktop/skill-service');
const mesh = require('../../desktop/agent-mesh');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const skillMd = (name, desc, extra = '') =>
  '---\nname: ' +
  name +
  '\ndescription: ' +
  desc +
  '\n' +
  extra +
  '---\n# ' +
  name +
  '\n\nSteps.\n';
const lib = id => path.join(userData, 'skills', id);
const record = id => JSON.parse(fs.readFileSync(path.join(lib(id), '.tnai-import.json'), 'utf8'));
const SHIM = path.join(__dirname, '..', '..', 'desktop', 'agent-shim.js');

(async () => {
  write(
    path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'user-one', 'SKILL.md'),
    skillMd('user-one', "A skill in the user's own folder.")
  );
  write(
    path.join(project, '.claude', 'skills', 'proj-one', 'SKILL.md'),
    skillMd('proj-one', 'A project skill.')
  );
  write(
    path.join(scratch, 'deploy-steps', 'SKILL.md'),
    skillMd('deploy-steps', 'How to deploy this app.')
  );
  write(path.join(scratch, 'deploy-steps', 'notes.txt'), 'extra file');
  write(path.join(scratch, 'single.md'), skillMd('single-file', 'Saved from one file.'));
  write(path.join(scratch, 'bare', 'SKILL.md'), '# No frontmatter\n\nJust text.\n');
  write(
    path.join(scratch, 'hidden', 'SKILL.md'),
    skillMd('sneaky', 'Hidden one.', 'tnai-hidden: true\n')
  );
  write(path.join(scratch, 'clash', 'SKILL.md'), skillMd('mine', 'Agent copy of a user skill.'));
  write(path.join(scratch, 'mine-src', 'SKILL.md'), skillMd('mine', "The user's imported skill."));

  // imported by the user on the Skills page
  skills.importSkills({ folders: [path.join(scratch, 'mine-src')] });

  mesh.init(() => {}, {
    ptys: { list: () => [], replay: () => null },
    projects: async () => [project],
    skills,
    hooks: { note() {} },
  });
  const addEnv = await mesh.prepare('pane-1', project, project);
  const env = { ...process.env };
  addEnv(env);
  const tnai = (...argv) =>
    new Promise(resolve =>
      execFile(
        process.execPath,
        [SHIM, 'tnai', ...argv],
        { cwd: project, env, windowsHide: true },
        (error, stdout, stderr) =>
          resolve({ code: error ? error.code : 0, out: String(stdout) + String(stderr) })
      )
    );

  let r = await tnai('skill', 'save', 'scratch/deploy-steps'); // relative to the caller's cwd
  check(
    r.code === 0 &&
      /^Saved skill deploy-steps \(id deploy-steps\) in Technically Not's skill library: .+\nIt is on for every session/.test(
        r.out
      ),
    'save a folder (relative path): ' + r.out.split('\n')[0]
  );
  check(
    fs.existsSync(path.join(lib('deploy-steps'), 'notes.txt')) &&
      record('deploy-steps').by === 'agent',
    'folder copied with its files and marked by: agent'
  );
  check(
    skills.listSkills(project).find(s => s.id === 'deploy-steps').everywhere === true &&
      skills.listSkills(project).find(s => s.id === 'mine').everywhere === true,
    'a new skill (agent-saved or imported) is on for every session'
  );
  skills.setEverywhere('deploy-steps', false);
  write(
    path.join(scratch, 'deploy-steps', 'SKILL.md'),
    skillMd('deploy-steps', 'How to deploy this app, updated.')
  );
  r = await tnai('skill', 'save', 'scratch/deploy-steps');
  check(
    r.code === 0 &&
      /It is off: the user switched it off/.test(r.out) &&
      !skills.listSkills(project).find(s => s.id === 'deploy-steps').everywhere,
    'updating a skill the user switched off leaves it off'
  );
  skills.setEverywhere('deploy-steps', true);

  // Codex and GitHub Copilot: marked copies in the personal skills folder (TNAI_HOME_SKILLS_DIR
  // stands in for ~/.agents/skills).
  const homeDir = process.env.TNAI_HOME_SKILLS_DIR,
    marked = id => {
      try {
        return (
          JSON.parse(fs.readFileSync(path.join(homeDir, id, '.tnai-managed.json'), 'utf8')).from ===
          'Technically Not'
        );
      } catch {
        return false;
      }
    };
  check(
    !fs.existsSync(path.join(homeDir, 'deploy-steps')),
    'no copy before a Codex or Copilot session starts'
  );
  write(path.join(homeDir, 'mine', 'SKILL.md'), "the user's own skill of the same name");
  await skills.launchOptions('', 'Claude Code', '');
  check(
    !fs.existsSync(path.join(homeDir, 'deploy-steps')),
    'a Claude Code start copies nothing there'
  );
  await skills.launchOptions('', 'Codex', '');
  check(
    marked('deploy-steps') && fs.existsSync(path.join(homeDir, 'deploy-steps', 'notes.txt')),
    'a Codex start copies the every-session skills there, marked'
  );
  check(
    fs.readFileSync(path.join(homeDir, 'mine', 'SKILL.md'), 'utf8') ===
      "the user's own skill of the same name" && !marked('mine'),
    "the user's own skill of the same name is left untouched"
  );

  // A change to a side file alone refreshes the copy (not only a SKILL.md change), and a Cursor
  // Agent start keeps the copies too (it loads ~/.agents/skills).
  write(path.join(userData, 'skills', 'deploy-steps', 'notes.txt'), 'side file changed');
  await skills.launchOptions('', 'Cursor Agent', '');
  check(
    fs.readFileSync(path.join(homeDir, 'deploy-steps', 'notes.txt'), 'utf8') ===
      'side file changed' && marked('deploy-steps'),
    'a side-file change refreshes the marked copy at the next Cursor Agent start'
  );
  skills.setEverywhere('deploy-steps', false);
  fs.rmSync(path.join(homeDir, 'deploy-steps'), { recursive: true, force: true });
  skills.setEverywhere('deploy-steps', true);
  await skills.launchOptions('', 'Cursor Agent', '');
  check(marked('deploy-steps'), 'a Cursor Agent start adds the marked copies');
  skills.setEverywhere('deploy-steps', false);
  check(
    !fs.existsSync(path.join(homeDir, 'deploy-steps')) &&
      fs.existsSync(path.join(homeDir, 'mine', 'SKILL.md')),
    "turning a skill off removes its marked copy, never the user's own"
  );
  skills.setEverywhere('deploy-steps', true);
  check(
    !fs.existsSync(path.join(homeDir, 'deploy-steps')),
    'turning it on again adds no copy until the next Codex or Copilot start'
  );
  skills.setEverywhere('deploy-steps', false);

  // Starter agents: offered once as personal agents; a removed one stays removed.
  const starters = skills.agents
    .list()
    .filter(a => ['Builder', 'Fixer', 'Reviewer'].includes(a.name));
  check(
    starters.length === 3 &&
      starters.every(
        a => a.scope === 'personal' && a.base === 'Claude Code' && a.role && !a.skillIds.length
      ),
    'three starter agents seeded as personal agents: ' + starters.map(a => a.name).join(', ')
  );
  skills.agents.remove(starters[0].id);
  check(
    !skills.agents.list().some(a => a.name === starters[0].name) &&
      JSON.parse(fs.readFileSync(path.join(userData, 'skills-everywhere.json'), 'utf8')).agents
        .length === 3,
    'a removed starter agent stays removed (its key is kept as offered)'
  );
  check(
    skills.listSkills(project).find(s => s.id === 'deploy-steps').by === 'agent',
    'listSkills exposes by: agent for the Skills page'
  );

  r = await tnai('skill', 'save', path.join(scratch, 'single.md'));
  check(
    r.code === 0 &&
      /Saved skill single-file \(id single-file\)/.test(r.out) &&
      fs.existsSync(path.join(lib('single-file'), 'SKILL.md')),
    'save a single SKILL.md file (absolute path)'
  );

  r = await tnai('skill', 'save', 'scratch/bare');
  check(
    r.code === 1 && /needs frontmatter with `name:` and `description:`/.test(r.out),
    'missing frontmatter refused'
  );
  r = await tnai('skill', 'save', 'scratch/hidden');
  check(
    r.code === 1 && /built-in program files/.test(r.out) && !fs.existsSync(lib('sneaky')),
    'tnai-hidden refused'
  );
  r = await tnai('skill', 'save', 'scratch/clash');
  check(
    r.code === 1 &&
      /already has a skill “mine” that the user added/.test(r.out) &&
      /user's imported/.test(fs.readFileSync(path.join(lib('mine'), 'SKILL.md'), 'utf8')),
    'duplicate of a user-imported skill refused, original kept'
  );
  r = await tnai('skill', 'save', 'scratch/nowhere');
  check(r.code === 1 && /Not found/.test(r.out), 'missing path refused');

  write(
    path.join(scratch, 'deploy-steps', 'SKILL.md'),
    skillMd('deploy-steps', 'How to deploy this app, v2.')
  );
  r = await tnai('skill', 'save', 'scratch/deploy-steps');
  check(
    r.code === 0 &&
      /^Updated skill deploy-steps/.test(r.out) &&
      /v2/.test(fs.readFileSync(path.join(lib('deploy-steps'), 'SKILL.md'), 'utf8')),
    'agent-written skill updated in place'
  );

  write(
    path.join(scratch, 'proj-one', 'SKILL.md'),
    skillMd('proj-one', 'A copy of the project skill.')
  );
  r = await tnai('skill', 'save', 'scratch/proj-one');
  check(
    r.code === 1 &&
      /This project already has a skill/.test(r.out) &&
      !fs.existsSync(lib('proj-one')),
    'same name as a project skill refused (improve that one)'
  );
  write(
    path.join(scratch, 'user-one', 'SKILL.md'),
    skillMd('user-one', 'A copy of the user skill.')
  );
  r = await tnai('skill', 'save', 'scratch/user-one');
  check(
    r.code === 1 && /own Claude skills already have/.test(r.out) && !fs.existsSync(lib('user-one')),
    "same name as the user's own Claude skill refused"
  );

  // Same-topic detection (plain function): two UI skills overlap; a deploy skill does not; a
  // library and a project skill are never compared.
  const overlap = require('../../desktop/skill-overlap');
  const ui1 = {
    name: 'ui-polish',
    description: 'Makes interface styling consistent: spacing, buttons and colors.',
    keywords: 'ui, css, styling, button, spacing',
    source: 'imported',
    path: 'a',
  };
  const ui2 = {
    name: 'interface-look',
    description: 'Keeps the interface styling tidy: button colors and spacing.',
    keywords: 'ui, interface, css, style, colors',
    source: 'imported',
    path: 'b',
  };
  const dep = {
    name: 'deploy-steps',
    description: 'How to deploy this app.',
    keywords: 'deploy, release, hosting',
    source: 'imported',
    path: 'c',
  };
  const pair = overlap.compare(ui1, ui2);
  check(
    pair.score >= overlap.THRESHOLD && pair.terms.includes('ui') && pair.terms.includes('css'),
    'two UI skills overlap (score ' + pair.score + '): ' + overlap.reason(pair)
  );
  check(
    overlap.compare(ui1, dep).score < overlap.THRESHOLD,
    'UI and deploy skills do not overlap (score ' + overlap.compare(ui1, dep).score + ')'
  );
  check(
    overlap.against({ ...ui2, source: 'project' }, [ui1, dep]).length === 0,
    'a project skill is not compared with library skills'
  );
  const gs = overlap.groups([
    ui1,
    ui2,
    dep,
    { ...ui1, name: 'ui-copy', source: 'project', path: 'd' },
  ]);
  check(
    gs.length === 1 &&
      gs[0].skills
        .map(s => s.name)
        .sort()
        .join() === 'interface-look,ui-polish' &&
      gs[0].pairs[0].why,
    'groups: one group of the two library UI skills, with why'
  );

  // Save of a near-duplicate is refused and names the skill to merge into; --distinct saves it; an
  // update of the same skill is not blocked by itself.
  write(
    path.join(scratch, 'ui-polish', 'SKILL.md'),
    skillMd('ui-polish', ui1.description, 'keywords: ' + ui1.keywords + '\n')
  );
  write(
    path.join(scratch, 'interface-look', 'SKILL.md'),
    skillMd('interface-look', ui2.description, 'keywords: ' + ui2.keywords + '\n')
  );
  r = await tnai('skill', 'save', 'scratch/ui-polish');
  check(r.code === 0 && /Saved skill ui-polish/.test(r.out), 'first UI skill saved');
  r = await tnai('skill', 'save', 'scratch/interface-look');
  check(
    r.code === 1 &&
      /covers the same topic as this library skill/.test(r.out) &&
      /ui-polish \(agent-written, 0× read\)/.test(r.out) &&
      /Merge instead/.test(r.out) &&
      /--distinct/.test(r.out) &&
      !fs.existsSync(lib('interface-look')),
    'near-duplicate refused with the overlapping skill, why, and how to merge'
  );
  console.log('     ' + r.out.split('\n').slice(0, 2).join('\n     '));
  r = await tnai('skill', 'save', 'scratch/ui-polish');
  check(
    r.code === 0 && /^Updated skill ui-polish/.test(r.out),
    'updating the same skill is not blocked by itself'
  );
  r = await tnai('skill', 'overlaps', 'scratch/interface-look');
  check(
    r.code === 0 &&
      /interface-look \(library\) covers the same topic as:/.test(r.out) &&
      /ui-polish/.test(r.out),
    'overlaps PATH checks a draft against the library'
  );
  r = await tnai('skill', 'save', 'scratch/interface-look', '--distinct');
  check(
    r.code === 0 &&
      /Saved skill interface-look/.test(r.out) &&
      /different topic from: ui-polish/.test(r.out),
    '--distinct saves it and notes the overlap'
  );
  r = await tnai('skill', 'overlaps');
  check(
    r.code === 0 &&
      /\d\. library: (ui-polish, interface-look|interface-look, ui-polish) — keep the name/.test(
        r.out
      ) &&
      /why (ui-polish ~ interface-look|interface-look ~ ui-polish): /.test(r.out),
    'overlaps lists the group, the name to keep and why'
  );
  if (!/\d\. library: (ui-polish|interface-look)/.test(r.out)) console.log(r.out);
  check(
    (skills.listSkills(project).find(s => s.id === 'ui-polish').overlaps || []).some(
      o => o.name === 'interface-look'
    ),
    'listSkills gives the Skills page the overlap'
  );

  // A project draft is checked against the project's skills, not the library.
  write(
    path.join(project, '.claude', 'skills', 'proj-ui', 'SKILL.md'),
    skillMd('proj-ui', ui1.description, 'keywords: ' + ui1.keywords + '\n')
  );
  write(
    path.join(project, '.claude', 'skills', 'proj-ui-2', 'SKILL.md'),
    skillMd('proj-ui-2', ui2.description, 'keywords: ' + ui2.keywords + '\n')
  );
  r = await tnai('skill', 'overlaps', '.claude/skills/proj-ui-2');
  check(
    r.code === 0 &&
      /proj-ui-2 \(project\)/.test(r.out) &&
      /proj-ui \(project skill/.test(r.out) &&
      !/ui-polish/.test(r.out),
    'overlaps PATH for a project skill compares project skills only'
  );

  // Match: the app's own prompt matcher, for a sentence the user might say (project skills, and
  // library skills that are on).
  write(
    path.join(project, '.claude', 'skills', 'invoice-export', 'SKILL.md'),
    skillMd('invoice-export', 'Exports invoices as PDF files.', 'keywords: invoice, pdf export\n')
  );
  r = await tnai('skill', 'match', 'make a pdf export of every invoice');
  check(
    r.code === 0 &&
      /^> make a pdf export of every invoice\n {2}match {5}invoice-export \(matched: /.test(r.out),
    'match names a skill with 2+ keyword hits as "match"'
  );
  if (!/invoice-export/.test(r.out)) console.log(r.out);
  r = await tnai('skill', 'match', 'send the invoice');
  check(
    r.code === 0 && / {2}may match invoice-export \(matched: invoice\)/.test(r.out),
    'one keyword hit is "may match"'
  );
  r = await tnai('skill', 'match', 'zzz qqq nothing here');
  check(
    r.code === 0 && /\(no skill picked up\)/.test(r.out),
    'match says when no skill is picked up'
  );
  r = await tnai('skill', 'match');
  check(r.code !== 0, 'match without a sentence is refused with the usage');

  // Remove: an agent-written library skill goes; the user's imported one stays.
  r = await tnai('skill', 'remove', 'interface-look');
  check(
    r.code === 0 &&
      /Removed library skill interface-look/.test(r.out) &&
      !fs.existsSync(lib('interface-look')),
    'remove an agent-written library skill'
  );
  r = await tnai('skill', 'remove', 'mine');
  check(
    r.code === 1 && /added by the user/.test(r.out) && fs.existsSync(lib('mine')),
    'remove refuses a skill the user added'
  );
  r = await tnai('skill', 'remove', 'proj-ui');
  check(
    r.code === 1 && /Project skills are files/.test(r.out),
    'remove refuses a project skill (the agent edits the files)'
  );

  r = await tnai('skill', 'list');
  const has = (name, src) => r.out.split('\n').some(l => l.includes(name) && l.includes(src));
  check(
    r.code === 0 &&
      has('deploy-steps', 'library, agent-written, off') &&
      has('mine', 'library, on') &&
      has('proj-one', 'project') &&
      has('user-one', 'user'),
    'list shows library (agent-written marked), project and user skills'
  );
  console.log(r.out.split('\n').slice(0, 3).join('\n'));

  mesh.stop();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(ok ? 'All skill save checks passed.' : 'Some skill save checks FAILED.');

  // launchOptions leaves skill-folder watchers open (the app keeps them for its lifetime)
  process.exit(ok ? 0 : 1);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
