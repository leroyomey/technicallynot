/*
 * Technically Not tools · desktop-check/skill-list-check.js — The Skills page's list read off the
 * main loop (skill-service.js listSkillsLater, behind skills:list) gives exactly what listSkills
 * gives: the same skills, fields and order. Plain Node, a temp userData, project and Claude home
 * with library skills (a record with `by`, warnings, a broken record, a hidden program skill, a
 * folder with no SKILL.md), project skills in two of the three folders (two on the same topic, so
 * "overlaps" is filled) and the user's own skill. Also counts the files each form reads at once
 * (blocking the main process) and prints how long each holds it. About 1 s. Usage: node
 * tools/desktop-check/skill-list-check.js node tools/desktop-check/skill-list-check.js --from <a
 * userData folder> --project <a project folder> The second form compares on real folders: the
 * library is COPIED to a temp folder first (listing may update starter skills), the project and the
 * Claude home are only read.
 */
'use strict';
const Module = require('module');
const { monitorEventLoopDelay } = require('perf_hooks');
const os = require('os');
const path = require('path');
const fs = require('fs');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const arg = name => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-skill-list-'));
const userData = path.join(tmp, 'user');
let project = path.join(tmp, 'proj');
const from = arg('--from');

if (from) {
  project = arg('--project') || '';
  fs.mkdirSync(userData, { recursive: true });
  if (fs.existsSync(path.join(from, 'skills')))
    fs.cpSync(path.join(from, 'skills'), path.join(userData, 'skills'), { recursive: true });
  for (const f of ['skills-everywhere.json', 'custom-agents.json', 'skill-stats.json'])
    if (fs.existsSync(path.join(from, f)))
      fs.copyFileSync(path.join(from, f), path.join(userData, f));
} else {
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');
  const skill = (name, description, extra = '') =>
    '---\nname: ' +
    name +
    '\ndescription: ' +
    description +
    '\n' +
    extra +
    '---\n# ' +
    name +
    '\nBody of ' +
    name +
    '.\n';
  const lib = path.join(userData, 'skills');
  write(
    path.join(lib, 'release-notes', 'SKILL.md'),
    skill(
      'release-notes',
      'Write release notes for a new version from the commit list.',
      'keywords: release, notes, changelog\n'
    )
  );
  write(
    path.join(lib, 'release-notes', '.tnai-import.json'),
    JSON.stringify({ warnings: [], importedAt: 1, by: 'Lead' })
  );
  write(
    path.join(lib, 'no-frontmatter', 'SKILL.md'),
    '# Plain skill\nFirst line used as the description.\n'
  );
  write(
    path.join(lib, 'no-frontmatter', '.tnai-import.json'),
    JSON.stringify({
      warnings: ['No frontmatter; Technically Not added `name` and `description`.'],
    })
  );
  write(
    path.join(lib, 'broken-record', 'SKILL.md'),
    skill('broken-record', 'A skill whose import record cannot be read.')
  );
  write(path.join(lib, 'broken-record', '.tnai-import.json'), '{ not json');
  write(
    path.join(lib, 'program-skill', 'SKILL.md'),
    skill(
      'program-skill',
      "One of the app's own program files, never listed.",
      'tnai-hidden: true\n'
    )
  );
  write(path.join(lib, 'empty-folder', 'notes.txt'), 'no SKILL.md here');
  write(
    path.join(userData, 'skills-everywhere.json'),
    JSON.stringify({ on: ['release-notes'], seeded: [], agents: [] })
  );
  write(
    path.join(userData, 'custom-agents.json'),
    JSON.stringify([
      {
        id: 'agent-1',
        name: 'Writer',
        base: 'Claude Code',
        accountId: '',
        role: '',
        skillIds: ['release-notes'],
        autoStart: false,
        createdAt: 1,
      },
    ])
  );
  write(
    path.join(project, '.claude', 'skills', 'deploy-site', 'SKILL.md'),
    skill(
      'deploy-site',
      'Deploy the website to production and check the live pages after the deploy.',
      'keywords: deploy, website, production, release\npaths: site/**\n'
    )
  );
  write(
    path.join(project, '.claude', 'skills', 'website-deploy', 'SKILL.md'),
    skill(
      'website-deploy',
      'Deploy the website to production: build, upload, then check the live pages.',
      'keywords: deploy, website, production, upload\npaths: site/**\n'
    )
  );
  write(
    path.join(project, '.claude', 'skills', 'folded', 'SKILL.md'),
    '---\nname: folded\ndescription: >-\n  A description that is\n  folded over two lines.\n---\nBody.\n'
  );
  write(
    path.join(project, '.agents', 'skills', 'review-code', 'SKILL.md'),
    skill('review-code', 'Review a diff for bugs before it is merged.')
  );
  write(
    path.join(process.env.CLAUDE_CONFIG_DIR, 'skills', 'my-own', 'SKILL.md'),
    skill('my-own', "The user's own skill in the Claude home folder.")
  );
}

const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => userData, on: () => {} }, dialog: {} }
    : load(req, ...rest);
const skills = require('../../desktop/skill-service');

// Files read at once (blocking) while a list is made.
const counted = ['readFileSync', 'readdirSync', 'statSync', 'existsSync', 'openSync'],
  real = {};
let atOnce = 0;
for (const k of counted) {
  real[k] = fs[k];
  fs[k] = (...a) => {
    atOnce++;
    return real[k](...a);
  };
}
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

(async () => {
  try {
    // the starter check runs once per run, in both forms: done here so the two are compared on the
    // same library
    skills.listSkills(project || null);
    const a = JSON.stringify(skills.listSkills(project || null)),
      b = JSON.stringify(await skills.listSkillsLater(project || null));
    const list = JSON.parse(a);
    check(
      list.length > 0 && a === b,
      'the list read off the main loop is the same as the list read at once: ' +
        list.length +
        ' skills, ' +
        a.length +
        ' vs ' +
        b.length +
        ' bytes, order ' +
        (JSON.stringify(list.map(s => s.id)) === JSON.stringify(JSON.parse(b).map(s => s.id))
          ? 'the same'
          : 'DIFFERENT')
    );
    const by = src => list.filter(s => s.source === src).length;
    console.log(
      '     library ' +
        by('imported') +
        ', project ' +
        by('project') +
        ", the user's own " +
        by('user') +
        '; with overlaps ' +
        list.filter(s => s.overlaps.length).length
    );
    if (!from) {
      const get = id => list.find(s => s.id === id);
      const ids = list.map(s => s.id),
        lib = ids.filter(id => !id.includes(':'));
      check(
        ids.slice(lib.length).join() ===
          'project:.claude/skills/deploy-site,project:.claude/skills/folded,project:.claude/skills/website-deploy,project:.agents/skills/review-code,user:my-own' &&
          ['broken-record', 'no-frontmatter', 'release-notes'].every(id => lib.includes(id)) &&
          !lib.includes('program-skill') &&
          !lib.includes('empty-folder'),
        "library first, then the project folders in their fixed order, then the user's own; the hidden program skill and the folder with no SKILL.md are left out: " +
          ids.length
      );
      check(
        get('release-notes').by === 'Lead' &&
          get('release-notes').everywhere === true &&
          get('release-notes').agentIds.join() === 'agent-1' &&
          get('broken-record').warnings.length === 0 &&
          get('no-frontmatter').warnings.length === 1,
        'record fields kept: by, every session, the agents using it, warnings (none for a record that cannot be read)'
      );
      check(
        get('project:.claude/skills/deploy-site').overlaps.some(o => o.name === 'website-deploy') &&
          get('project:.claude/skills/folded').description ===
            'A description that is folded over two lines.',
        'same-topic project skills are marked as overlapping; a folded description is read whole'
      );
    }

    // Reads at once and time, a handful of runs each (no loop to load the PC).
    const sync = [],
      later = [],
      held = [],
      reads = { sync: 0, later: 0 };
    for (let i = 0; i < 5; i++) {
      atOnce = 0;
      let t0 = performance.now();
      skills.listSkills(project || null);
      sync.push(performance.now() - t0);
      reads.sync = atOnce;
      const h = monitorEventLoopDelay({ resolution: 1 });
      h.enable();
      atOnce = 0;
      t0 = performance.now();
      const p = skills.listSkillsLater(project || null);
      const first = performance.now() - t0;
      await p;
      later.push(performance.now() - t0);
      reads.later = atOnce;
      h.disable();
      held.push(Math.max(first, h.max / 1e6));
    }
    console.log(
      '     read at once (before): ' +
        reads.sync +
        ' blocking file calls, main process held ' +
        median(sync).toFixed(1) +
        ' ms (median of 5; ' +
        sync.map(v => v.toFixed(0)).join(', ') +
        ')'
    );
    console.log(
      '     read off the main loop (now): ' +
        reads.later +
        ' blocking file calls, done in ' +
        median(later).toFixed(1) +
        ' ms, main process held at most ' +
        median(held).toFixed(1) +
        ' ms at a time (median of 5; ' +
        held.map(v => v.toFixed(0)).join(', ') +
        ')'
    );
    check(
      reads.later <= 6 && reads.later < reads.sync / 4,
      'the list no longer reads each skill at once: ' +
        reads.later +
        ' blocking file calls, was ' +
        reads.sync
    );
  } catch (error) {
    console.error(error);
    ok = false;
  }
  for (const k of counted) fs[k] = real[k];
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {}
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  process.exit(ok ? 0 : 1);
})();
