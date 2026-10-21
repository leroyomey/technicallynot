// Technically Not desktop · skill-service.js — Skill library and custom agents: imported SKILL.md
// skills, per-agent plugin folders loaded with the agent's CLI, project skill discovery.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app, dialog } = require('electron');
const registry = require('./agent-registry');
const store = require('./custom-agent-store');
const stats = require('./skill-stats');
const overlap = require('./skill-overlap');

// one skill folder; bigger imports are refused, not truncated
const COPY_LIMIT = { files: 500, bytes: 20 * 1024 * 1024 };
const SKIP = new Set(['.git', 'node_modules']);
const PROJECT_SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills'];

const dataDir = () => app.getPath('userData');
const libraryDir = () => path.join(dataDir(), 'skills');
const pluginDir = agentId => path.join(dataDir(), 'custom-agents', agentId, 'plugin');

// Starter skills ship inside the app (desktop/builtin-skills, packaged in app.asar): general agent
// habits, public library skills (see seedStarters). Technically Not's own program skills are not
// library skills: desktop/hidden-skills/*.md (hidden-skills.js), always on via agent-hooks.js,
// never listed. Anything carrying their `tnai-hidden: true` mark is skipped by every list here and
// refused on import (filtered at the source, readSkillDir/storeSkill).
const { isHidden } = require('./hidden-skills');
const STARTER_DIR = path.join(__dirname, 'builtin-skills');
const starterIds = () => {
  try {
    return fs
      .readdirSync(STARTER_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return [];
  }
};

// Library skills that load in every session of a skill-capable CLI (not only custom agents): { on:
// [ids], seeded: [starter ids already offered once] }.
const everywhereFile = () => path.join(dataDir(), 'skills-everywhere.json');

// `agents`: keys of the starter agents already offered once (seedStarterAgents).
function loadEverywhere() {
  try {
    const d = JSON.parse(fs.readFileSync(everywhereFile(), 'utf8'));
    return {
      on: Array.isArray(d.on) ? d.on : [],
      seeded: Array.isArray(d.seeded) ? d.seeded : [],
      agents: Array.isArray(d.agents) ? d.agents : [],
    };
  } catch {
    return { on: [], seeded: [], agents: [] };
  }
}
const saveEverywhere = d => {
  writeAtomic(everywhereFile(), JSON.stringify(d, null, 1));
  everywherePlugins.clear();
  scanCache.clear();
  try {
    syncHomeSkills();
  } catch {}
};

// A skill new to the library is on for every session from the start (a
// saved skill nobody switched on was never loaded). One that was already in the library keeps the
// user's choice.
function turnOnNew(ids) {
  if (!ids.length) return;
  const every = loadEverywhere();
  saveEverywhere({ ...every, on: [...new Set([...every.on, ...ids])] });
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

// Puts a finished staging folder in the place of dest. The old dest is moved aside first and
// deleted only after the swap, so a failed rename (a file held open on Windows) puts it back
// instead of leaving no folder at all.
function swapFolder(staging, dest) {
  const aside = dest + '.old-' + process.pid;
  fs.rmSync(aside, { recursive: true, force: true });
  const had = fs.existsSync(dest);
  let movedAside = false;
  try {
    if (had) fs.renameSync(dest, aside);
    movedAside = had;
    fs.renameSync(staging, dest);
  } catch (error) {
    if (movedAside) fs.renameSync(aside, dest);
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  if (had) fs.rmSync(aside, { recursive: true, force: true });
}

// ---- SKILL.md parsing ----
// Claude Code needs `name` and `description` frontmatter; missing values are derived and reported
// as warnings.
const slug = text =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

// A skill's folder id. A name with no Latin letters or digits (all Japanese, say) has an empty
// slug; it gets a short hash of the name instead, so two such skills never share the id "skill" and
// overwrite each other.
const skillId = name => {
  const fromName = slug(name);
  if (fromName) return fromName;
  const text = String(name || '').trim();
  if (!text) return '';
  return 'skill-' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
};

function parseSkill(text, hint) {
  const src = String(text || '').replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  const meta = {};
  if (match) {
    // Top-level `key: value` pairs. Indented lines continue the previous value: block scalars (`>-`
    // folds, `|` keeps newlines) and wrapped plain values.
    let key = '',
      block = '',
      parts = [];
    const finish = () => {
      if (key && block)
        meta[key] = block.startsWith('|')
          ? parts.join('\n').trim()
          : parts.join(' ').replace(/\s+/g, ' ').trim();
      key = '';
      block = '';
      parts = [];
    };
    for (const line of match[1].split(/\r?\n/)) {
      const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
      if (m) {
        finish();
        const value = m[2].trim();
        key = m[1].toLowerCase();
        if (/^[>|][+-]?$/.test(value)) block = value;
        else {
          meta[key] = value.replace(/^(['"])(.*)\1$/, '$2');
          block = 'plain';
          parts = [meta[key]];
        }
      } else if (key && /^\s+\S/.test(line)) parts.push(line.trim());
    }
    finish();
  }
  const body = match ? src.slice(match[0].length) : src;
  const warnings = [];
  let name = meta.name || '';
  if (!name) {
    const heading = (/^#\s+(.+)$/m.exec(body) || [])[1];
    name = heading || (hint && !/^skill$/i.test(hint) ? hint : '');
    warnings.push(
      match
        ? 'No `name` in the frontmatter; named “' + (name || 'skill') + '”.'
        : 'No frontmatter; Technically Not added `name` and `description`.'
    );
  }
  let description = meta.description || '';
  if (!description) {
    description = (
      body
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l && !l.startsWith('#')) || ''
    ).slice(0, 300);
    if (meta.name || match)
      warnings.push('No `description` in the frontmatter; used the first line of the skill.');
  }
  const id = skillId(name) || 'skill';
  return { id, name: name || id, description, body, hasFrontmatter: !!match, meta, warnings };
}

// The SKILL.md written to the library: the original when it is valid, otherwise the original body
// under complete frontmatter.
function normalizedSkill(text, parsed) {
  if (parsed.hasFrontmatter && parsed.meta.name && parsed.meta.description) return String(text);
  const esc = v => JSON.stringify(String(v));
  const extra = Object.entries(parsed.meta)
    .filter(([k]) => k !== 'name' && k !== 'description')
    .map(([k, v]) => k + ': ' + v)
    .join('\n');
  return (
    '---\nname: ' +
    parsed.id +
    '\ndescription: ' +
    esc(parsed.description || parsed.name) +
    (extra ? '\n' + extra : '') +
    '\n---\n' +
    parsed.body
  );
}

// ---- Library ----
function readSkillDir(dir, source, idPrefix = '') {
  const file = path.join(dir, 'SKILL.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseSkill(text, path.basename(dir));
  if (isHidden(parsed.meta)) return null;
  return {
    id: idPrefix + path.basename(dir),
    name: parsed.meta.name || parsed.name,
    description: parsed.description,
    keywords: parsed.meta.keywords || '',
    paths: parsed.meta.paths || '',
    source,
    path: dir,
    editedAt: mtimeOf(file) || null,
    warnings: source === 'imported' ? readWarnings(dir) : parsed.warnings,
  };
}
const warningsFile = dir => path.join(dir, '.tnai-import.json');

function readWarnings(dir) {
  try {
    return JSON.parse(fs.readFileSync(warningsFile(dir), 'utf8')).warnings || [];
  } catch {
    return [];
  }
}

function listDirSkills(root, source, idPrefix) {
  let names = [];
  try {
    names = fs
      .readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() || e.isSymbolicLink())
      .map(e => e.name);
  } catch {
    return [];
  }
  return names.map(n => readSkillDir(path.join(root, n), source, idPrefix)).filter(Boolean);
}

function countTree(dir, total = { files: 0, bytes: 0 }) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) countTree(full, total);
    else if (e.isFile()) {
      total.files++;
      total.bytes += fs.statSync(full).size;
    }
    if (total.files > COPY_LIMIT.files || total.bytes > COPY_LIMIT.bytes)
      throw new Error(
        'Skill folder is too large to import (limit ' + COPY_LIMIT.files + ' files / 20 MB): ' + dir
      );
  }
  return total;
}

// Writes one skill into the library. Same name = same skill: a re-import replaces it (and updates
// every agent using it).
function storeSkill(text, hint, sourceDir, record = {}) {
  const parsed = parseSkill(text, hint);
  if (isHidden(parsed.meta))
    throw new Error('is one of Technically Not’s built-in program files, not an importable skill');
  const dest = path.join(libraryDir(), parsed.id);
  const replaced = fs.existsSync(dest);
  const staging = dest + '.importing-' + process.pid;
  fs.rmSync(staging, { recursive: true, force: true });
  if (sourceDir) {
    countTree(sourceDir);
    fs.cpSync(sourceDir, staging, {
      recursive: true,
      filter: src => !SKIP.has(path.basename(src)),
    });
  } else fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(staging, 'SKILL.md'), normalizedSkill(text, parsed));
  fs.writeFileSync(
    warningsFile(staging),
    JSON.stringify({
      warnings: parsed.warnings,
      importedAt: Date.now(),
      from: sourceDir || hint || '',
      ...record,
    })
  );
  swapFolder(staging, dest);
  return {
    id: parsed.id,
    name: parsed.meta.name || parsed.name,
    replaced,
    warnings: parsed.warnings,
  };
}

// A folder may be one skill (has SKILL.md) or hold several skill folders.
function skillFoldersIn(dir) {
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) return [dir];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map(e => path.join(dir, e.name));
}

function importSkills({ files = [], folders = [] } = {}) {
  const imported = [],
    errors = [],
    had = new Set(
      libraryEntries()
        .filter(e => e.isDirectory())
        .map(e => e.name)
    );
  for (const f of files) {
    try {
      const hint = String(f.name || '').replace(/\.md$/i, '');
      if (!String(f.text || '').trim()) throw new Error('is empty');
      imported.push(storeSkill(f.text, hint));
    } catch (error) {
      errors.push((f.name || 'file') + ': ' + error.message);
    }
  }
  for (const folder of folders) {
    try {
      const found = skillFoldersIn(folder);
      if (!found.length) throw new Error('no SKILL.md in this folder or its subfolders');
      for (const dir of found)
        imported.push(
          storeSkill(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), path.basename(dir), dir)
        );
    } catch (error) {
      errors.push(folder + ': ' + error.message);
    }
  }

  // Agents using a replaced skill get the new version in their plugin folder.
  const ids = new Set(imported.map(s => s.id));
  everywherePlugins.clear();
  for (const agent of loadAgents()) if (agent.skillIds.some(id => ids.has(id))) buildPlugin(agent);
  turnOnNew([...ids].filter(id => !had.has(id)));
  return { imported, errors };
}

// `tnai skill save PATH` (agent-mesh.js): an agent adds a procedure it learned to the library,
// marked `by: 'agent'` in .tnai-import.json. Same checks as an import, plus complete frontmatter. A
// new one is on for every session (turnOnNew); the user can switch it off on the Skills page. A
// library skill of the same name is replaced only when an agent wrote it too; the user's own and
// Technically Not's starter skills are never overwritten.
const readRecord = dir => {
  try {
    return JSON.parse(fs.readFileSync(warningsFile(dir), 'utf8')) || {};
  } catch {
    return {};
  }
};
const AGENT_FILE_MAX = 256 * 1024;

// The SKILL.md an agent points at (a folder holding one, or the file): { target, dir, text, parsed
// }.
function readAgentSkill(inputPath, cwd) {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('Give the folder (or SKILL.md file) to save.');
  const target = path.resolve(path.isAbsolute(raw) || !cwd ? '' : String(cwd), raw);
  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new Error('Not found: ' + target);
  }
  const dir = stat.isDirectory() ? target : null;
  const file = dir ? path.join(dir, 'SKILL.md') : target;
  if (!dir && !/\.md$/i.test(file))
    throw new Error('Expected a folder with SKILL.md in it, or a SKILL.md file: ' + target);
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    throw new Error('No SKILL.md in ' + target);
  }
  if (size > AGENT_FILE_MAX) throw new Error('SKILL.md is too large (limit 256 KB).');
  const text = fs.readFileSync(file, 'utf8');
  return { target, dir, text, parsed: parseSkill(text, dir ? path.basename(dir) : '') };
}

// `distinct`: the agent read the overlapping skills and this one is a different topic (`tnai skill
// save PATH --distinct`).
function saveAgentSkill(inputPath, cwd, projectRoot, { distinct = false } = {}) {
  const { target, dir, text, parsed } = readAgentSkill(inputPath, cwd);
  if (isHidden(parsed.meta))
    throw new Error('That file is one of Technically Not’s built-in program files, not a skill.');
  if (!parsed.hasFrontmatter || !parsed.meta.name || !parsed.meta.description)
    throw new Error(
      'SKILL.md needs frontmatter with `name:` and `description:` (between --- lines at the top).'
    );

  // A project skill or the user's own Claude skill with the same name: the agent should improve
  // that one, not add a library copy that shadows it.
  const same = s =>
    s.path !== (dir && path.resolve(dir)) &&
    (skillId(s.name) === parsed.id || slug(path.basename(s.path)) === parsed.id);
  const clash = [
    ...(projectRoot
      ? PROJECT_SKILL_DIRS.flatMap(rel => listDirSkills(path.join(projectRoot, rel), 'project', ''))
      : []),
    ...listDirSkills(
      path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills'),
      'user',
      ''
    ),
  ].find(same);
  if (clash)
    throw new Error(
      (clash.source === 'project'
        ? 'This project already has a skill “' + clash.name + '”'
        : 'The user’s own Claude skills already have “' + clash.name + '”') +
        ' (' +
        clash.path +
        '). ' +
        (clash.source === 'project'
          ? 'Improve that one instead, or choose a different name.'
          : 'Choose a different name (the user’s own skills are not changed by agents).')
    );
  const dest = path.join(libraryDir(), parsed.id);
  if (fs.existsSync(dest) && readRecord(dest).by !== 'agent')
    throw new Error(
      'The library already has a skill “' +
        parsed.id +
        '” that the user added; it was not replaced. Choose a different name.'
    );

  // A near-duplicate of another library skill (skill-overlap.js) is refused: the agent merges into
  // that skill instead, or says it is a different topic.
  const near = overlap.against(
    {
      name: parsed.meta.name,
      description: parsed.meta.description,
      keywords: parsed.meta.keywords,
      paths: parsed.meta.paths,
      source: 'imported',
    },
    listDirSkills(libraryDir(), 'imported', '').filter(s => path.basename(s.path) !== parsed.id)
  );
  if (near.length && !distinct)
    throw new Error(
      '“' +
        parsed.meta.name +
        '” covers the same topic as ' +
        (near.length > 1 ? 'these library skills' : 'this library skill') +
        ':\n' +
        nearLines(near) +
        '\n' +
        "Merge instead of adding a near-duplicate: put every rule and step of the new skill into the one that fits, add its keywords, and save it under that skill's name " +
        '(only a skill an agent wrote can be replaced; for one the user added, ask the user). Then remove superseded agent-written ones with `tnai skill remove NAME`. ' +
        'If you read them and it really is a different topic, run `tnai skill save ' +
        String(inputPath).trim() +
        ' --distinct`.'
    );
  const isNew = !fs.existsSync(dest);
  const saved = storeSkill(text, parsed.id, dir, { by: 'agent', from: target });
  everywherePlugins.clear();
  scanCache.clear();
  if (isNew) turnOnNew([saved.id]);
  else
    try {
      syncHomeSkills();
    } catch {}
  for (const agent of loadAgents()) if (agent.skillIds.includes(saved.id)) buildPlugin(agent);
  try {
    agentSaved?.({ id: saved.id, name: saved.name, replaced: !!saved.replaced });
  } catch {}
  return {
    ...saved,
    path: dest,
    everywhere: loadEverywhere().on.includes(saved.id),
    overlaps: near.map(r => r.skill.name),
  };
}
const whoWrote = s => {
  if (s.source === 'project') return 'project skill';
  const r = readRecord(s.path);
  return r.by === 'agent'
    ? 'agent-written'
    : r.from === STARTER_FROM
      ? 'Technically Not starter skill, ask before changing'
      : 'added by the user, ask before changing';
};
const nearLines = near =>
  near
    .map(
      r =>
        '  - ' +
        r.skill.name +
        ' (' +
        whoWrote(r.skill) +
        ', ' +
        stats.of(r.skill.name).read +
        '× read) — ' +
        r.why +
        ' [' +
        r.skill.path +
        ']'
    )
    .join('\n');

// Overlap is checked in Technically Not's library and the project's skill folders. Never the user's
// ~/.claude/skills (not ours to merge) or the hidden program skills (readSkillDir skips them).
const overlapScope = root => [
  ...listDirSkills(libraryDir(), 'imported', ''),
  ...(root
    ? PROJECT_SKILL_DIRS.flatMap(rel =>
        listDirSkills(path.join(root, rel), 'project', 'project:' + rel + '/')
      )
    : []),
];

// `tnai skill overlaps`: groups of skills about the same topic, each with its counts and who wrote
// it; `keep` = the most-read name (then most suggested), the name a merge keeps.
function skillOverlaps(root) {
  return overlap.groups(overlapScope(root)).map(g => {
    const skills = g.skills.map(s => ({ ...s, stats: stats.of(s.name), by: whoWrote(s) }));
    const keep = [...skills].sort(
      (a, b) =>
        b.stats.read - a.stats.read ||
        b.stats.suggested - a.stats.suggested ||
        a.name.localeCompare(b.name)
    )[0].name;
    return { ...g, skills, keep };
  });
}

// `tnai skill overlaps PATH`: one SKILL.md (a draft, or a skill already in place) against the
// others of its kind. Inside the project's skill folders it is a project skill; anywhere else a
// library draft.
function overlapsFor(inputPath, cwd, root) {
  const { target, parsed } = readAgentSkill(inputPath, cwd);
  const inside = (dir, p) => {
    const r = path.relative(dir, p);
    return !!r && !r.startsWith('..') && !path.isAbsolute(r);
  };
  const inProject = !!root && PROJECT_SKILL_DIRS.some(rel => inside(path.join(root, rel), target));
  const me = {
    name: parsed.meta.name || parsed.name,
    description: parsed.description,
    keywords: parsed.meta.keywords,
    paths: parsed.meta.paths,
    source: inProject ? 'project' : 'imported',
  };
  const near = overlap.against(
    me,
    overlapScope(root).filter(
      s => path.resolve(s.path) !== target && !inside(path.resolve(s.path), target)
    )
  );
  return {
    name: me.name,
    scope: inProject ? 'project' : 'library',
    near,
    text: near.length ? nearLines(near) : '',
  };
}

// `tnai skill remove NAME`: an agent removes a library skill a merge made redundant. Only
// agent-written ones; the user removes their own.
function removeAgentSkill(name) {
  const want = skillId(name);
  const hit =
    want &&
    listDirSkills(libraryDir(), 'imported', '').find(
      s => path.basename(s.path) === want || skillId(s.name) === want
    );
  if (!hit)
    throw new Error(
      'No library skill “' +
        name +
        '”. Project skills are files in the project: delete the folder and fix what links to it.'
    );
  if (readRecord(hit.path).by !== 'agent')
    throw new Error(
      '“' +
        hit.name +
        '” was added by the user, so an agent does not remove it. Ask the user; they remove it on the Skills page.'
    );
  const everywhere = loadEverywhere().on.includes(hit.id);
  return { name: hit.name, everywhere, ...removeSkill(hit.id) };
}

// ---- Custom agents ----
// Personal agents live in userData, project agents in the open project's .tnai/ folder
// (custom-agent-store.js: backups, recovery, file layout). Project agents carry their skills:
// library skills are copied into .tnai/agent-skills/<id>/, the project's own skills
// (PROJECT_SKILL_DIRS) are referenced as `project:<dir>/<name>`. Names are unique across both
// scopes while the project is open.
let projectRoot = () => '';

// agentSaved: told { id, name, replaced } each time an agent saves a skill (main pushes it to the
// window, so the user sees it: bell + Skills page mark).
let agentSaved = null;

function init({ root, agentSaved: told } = {}) {
  if (typeof root === 'function') projectRoot = root;
  if (typeof told === 'function') agentSaved = told;
}

// personal agents only: the library's bookkeeping (skill users, rebuilds after an import)
const loadAgents = () => store.readPersonal().list;

// CLIs that load a plugin folder per session (`--plugin-dir`: Claude Code's customArgs).
const takesPlugins = base => !!registry.capabilities().find(c => c.id === base)?.skills;

// CLIs a custom agent's attached skills reach: those, plus OpenCode (the folder's skills/ in its
// session config `skills.paths`) and Cursor Agent (the same folder as a local plugin through its
// repeatable `--plugin-dir`, cursor-agent 2026.10.01 `--help`; a plugin's skills/<name>/SKILL.md,
// cursor.com/docs/plugins). Codex and Copilot have no per-session skills route.
const ATTACH_SKILLS = new Set(['OpenCode', 'Cursor Agent']);
const supportsSkills = base => takesPlugins(base) || ATTACH_SKILLS.has(base);
const withMeta = (agent, scope) => ({
  ...agent,
  scope,
  supportsSkills: supportsSkills(agent.base),
});

function allAgents(root = projectRoot()) {
  const project = root ? store.readProject(root).list.map(a => ({ ...a, scope: 'project' })) : [];
  return [...project, ...loadAgents().map(a => ({ ...a, scope: 'personal' }))];
}

function checkName(name, list, exceptId) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Give the agent a name.');
  if (clean.length > 60) throw new Error('Keep the name under 60 characters.');
  const clash = list.find(a => a.id !== exceptId && a.name.toLowerCase() === clean.toLowerCase());
  if (clash)
    throw new Error(
      'An agent named “' +
        clash.name +
        '” already exists' +
        (clash.scope === 'project' ? ' in this project' : '') +
        '. Choose a different name.'
    );
  return clean;
}

// The folder a skill of this agent is read from.
function skillSource(agent, id, root = projectRoot()) {
  if (agent.scope !== 'project') return path.join(libraryDir(), path.basename(String(id)));
  if (!root) return '';
  if (id.startsWith('project:')) {
    const dir = path.resolve(root, id.slice('project:'.length)),
      top = path.resolve(root);
    return dir.toLowerCase().startsWith(top.toLowerCase() + path.sep) ? dir : '';
  }
  return path.join(store.projectSkillsDir(root), path.basename(id));
}
const hasSkill = dir => !!dir && fs.existsSync(path.join(dir, 'SKILL.md'));

// Validates (and for a project agent, copies) the skills to attach; returns the ids to store.
function checkSkills(ids, scope = 'personal', root = projectRoot()) {
  const out = [];
  for (const raw of ids) {
    const id = String(raw || '');
    if (scope === 'project' && id.startsWith('project:')) {
      if (!hasSkill(skillSource({ scope }, id, root)))
        throw new Error('That project skill is not in this project: ' + id);
      out.push(id);
      continue;
    }
    const lib = path.join(libraryDir(), path.basename(id));
    if (scope === 'project') {
      const copy = path.join(store.projectSkillsDir(root), path.basename(id));
      if (!hasSkill(copy)) {
        if (!hasSkill(lib))
          throw new Error(
            'Only skills in the Technically Not library or this project can be attached: ' + id
          );

        // the project keeps its own copy (commit it to share the agent); later library edits do not
        // change it
        copyTree(lib, copy);
      }
    } else if (!hasSkill(lib))
      throw new Error(
        'Only skills in the Technically Not library can be attached (import a copy first): ' + id
      );
    out.push(path.basename(id));
  }
  return [...new Set(out)];
}

// Claude Code plugin: .claude-plugin/plugin.json + skills/<id>/SKILL.md, loaded per session with
// --plugin-dir. Rebuilt whole, from where the skills live.
function buildPlugin(agent, root = projectRoot()) {
  const dir = pluginDir(agent.id);
  if (!supportsSkills(agent.base) || !agent.skillIds.length) {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
    return '';
  }
  const staging = dir + '.building-' + process.pid;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(staging, '.claude-plugin', 'plugin.json'), pluginManifest(agent));

  // The same folder is a Cursor Agent plugin: its manifest needs only a name.
  fs.mkdirSync(path.join(staging, '.cursor-plugin'), { recursive: true });
  fs.writeFileSync(path.join(staging, '.cursor-plugin', 'plugin.json'), pluginManifest(agent));
  for (const id of agent.skillIds) {
    const src = skillSource(agent, id, root);
    if (hasSkill(src)) copyTree(src, path.join(staging, 'skills', path.basename(src)));
  }
  swapFolder(staging, dir);
  return dir;
}
const pluginManifest = agent =>
  JSON.stringify(
    {
      name: 'tnai-' + (slug(agent.name) || 'agent').slice(0, 40),
      version: '1.0.0',
      description: 'Skills Technically Not attached to the custom agent “' + agent.name + '”.',
    },
    null,
    2
  );

// Panel starts (launchOptions) delete and copy skill folders with fs.promises, so a start no longer
// holds the main process for them: the same steps as their plain twins, one start's staging after
// another's (inTurn), in the order the starts asked. The sources are folders on disk (the library,
// the project, the user's own skills), never the packaged app, so plain fs.promises reads work.
const fsp = fs.promises;
let stagingTurn = Promise.resolve();
const inTurn = fn => {
  const run = stagingTurn.then(fn);
  stagingTurn = run.catch(() => {});
  return run;
};

async function copyTreeLater(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, e.name),
      to = path.join(dest, e.name);
    if (e.name === '.tnai-import.json') continue;
    if (e.isDirectory()) await copyTreeLater(from, to);
    else if (e.isFile()) await fsp.writeFile(to, await fsp.readFile(from));
  }
}

// swapFolder with fs.promises.
async function swapFolderLater(staging, dest) {
  const aside = dest + '.old-' + process.pid;
  await fsp.rm(aside, { recursive: true, force: true });
  const had = fs.existsSync(dest);
  let movedAside = false;
  try {
    if (had) await fsp.rename(dest, aside);
    movedAside = had;
    await fsp.rename(staging, dest);
  } catch (error) {
    if (movedAside) await fsp.rename(aside, dest);
    await fsp.rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (had) await fsp.rm(aside, { recursive: true, force: true });
}

// The newest change anywhere in a skill folder (SKILL.md and its reference files) and how many
// files it holds, so a cached copy is rebuilt when any of them changes, not only SKILL.md.
async function folderStamp(dir) {
  let newest = 0;
  let count = 0;

  async function walk(folder) {
    let entries;
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(folder, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        count++;
        newest = Math.max(newest, mtimeOf(full));
      }
    }
  }
  await walk(dir);
  return newest + '.' + count;
}

// buildPlugin for a panel start. Its own staging folder name: a build from the Skills page
// (buildPlugin, not awaited) can run between two steps here.
async function buildPluginLater(agent, root = projectRoot()) {
  const dir = pluginDir(agent.id);
  if (!supportsSkills(agent.base) || !agent.skillIds.length) {
    await fsp.rm(path.dirname(dir), { recursive: true, force: true });
    return '';
  }
  const staging = dir + '.starting-' + process.pid;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(path.join(staging, '.claude-plugin'), { recursive: true });
  await fsp.writeFile(path.join(staging, '.claude-plugin', 'plugin.json'), pluginManifest(agent));
  await fsp.mkdir(path.join(staging, '.cursor-plugin'), { recursive: true });
  await fsp.writeFile(path.join(staging, '.cursor-plugin', 'plugin.json'), pluginManifest(agent));
  for (const id of agent.skillIds) {
    const src = skillSource(agent, id, root);
    if (hasSkill(src)) await copyTreeLater(src, path.join(staging, 'skills', path.basename(src)));
  }
  await swapFolderLater(staging, dir);
  return dir;
}

// fn(ctx) edits ctx.personal / ctx.project in place after ctx.use(scope) (which refuses when that
// file could not be read); only used files are saved.
function mutateAgents(fn, root = projectRoot()) {
  const p = store.readPersonal(),
    j = store.readProject(root);
  const ctx = {
    root,
    personal: p.list.map(a => ({ ...a, scope: 'personal' })),
    project: j.list.map(a => ({ ...a, scope: 'project' })),
    used: new Set(),
    use(scope) {
      if (scope === 'project' && !root)
        throw new Error('Open a project folder first to keep agents in it.');
      const state = scope === 'project' ? j : p;
      if (!state.ok) throw new Error(state.error + '. Nothing was changed.');
      ctx.used.add(scope);
      return ctx[scope];
    },
    find(id) {
      const scope = ctx.project.some(a => a.id === id)
        ? 'project'
        : ctx.personal.some(a => a.id === id)
          ? 'personal'
          : '';
      if (!scope) throw new Error('That agent no longer exists.');
      return ctx.use(scope).find(a => a.id === id);
    },
    all: () => [...ctx.project, ...ctx.personal],
  };
  const result = fn(ctx);
  if (ctx.used.has('personal')) store.savePersonal(ctx.personal);
  if (ctx.used.has('project')) {
    store.writeProject(root, ctx.project);
    store.pruneProjectSkills(root, ctx.project);
  }
  return result;
}

const agentApi = {
  list: () => {
    seedStarters();
    return allAgents().map(a => withMeta(a, a.scope));
  },
  // Files that could not be read (shown on the strip, so a missing agent is never silent).
  problems: () =>
    [store.readPersonal(), store.readProject(projectRoot())].filter(s => !s.ok).map(s => s.error),
  create: ({
    name,
    base,
    accountId = '',
    role = '',
    skillIds = [],
    scope = 'personal',
    autoStart = false,
  } = {}) =>
    mutateAgents(ctx => {
      if (!registry.ids().includes(base))
        throw new Error('Choose which agent CLI this agent runs on.');
      const where = scope === 'project' ? 'project' : 'personal',
        list = ctx.use(where);
      const agent = {
        id: 'agent-' + crypto.randomUUID(),
        name: checkName(name, ctx.all()),
        base,
        accountId: String(accountId || ''),
        role: String(role || '')
          .trim()
          .slice(0, 300),
        skillIds: supportsSkills(base) ? checkSkills(skillIds, where, ctx.root) : [],
        autoStart: autoStart === true,
        createdAt: Date.now(),
        scope: where,
      };
      list.push(agent);
      buildPlugin(agent, ctx.root);
      return withMeta(agent, where);
    }),
  rename: (id, name) =>
    mutateAgents(ctx => {
      const agent = ctx.find(id);
      agent.name = checkName(name, ctx.all(), id);
      buildPlugin(agent, ctx.root);
      return withMeta(agent, agent.scope);
    }),
  update: (id, fields = {}) =>
    mutateAgents(ctx => {
      const agent = ctx.find(id);
      if ('accountId' in fields) agent.accountId = String(fields.accountId || '');
      if ('role' in fields)
        agent.role = String(fields.role || '')
          .trim()
          .slice(0, 300);
      if ('autoStart' in fields) agent.autoStart = fields.autoStart === true;
      buildPlugin(agent, ctx.root);
      return withMeta(agent, agent.scope);
    }),
  remove: id =>
    mutateAgents(ctx => {
      const agent = ctx.all().find(a => a.id === id);
      if (!agent) return false;
      const list = ctx.use(agent.scope);
      list.splice(list.indexOf(agent), 1);
      if (agent.scope === 'project') store.forgetAccount(ctx.root, id);
      fs.rmSync(path.join(dataDir(), 'custom-agents', id), { recursive: true, force: true });
      return true;
    }),
  attach: (id, skillIds = []) =>
    mutateAgents(ctx => {
      const agent = ctx.find(id);
      if (!supportsSkills(agent.base))
        throw new Error(
          agent.base +
            ' cannot load skills per session yet, so Technically Not does not attach them.'
        );
      agent.skillIds = [
        ...new Set([...agent.skillIds, ...checkSkills(skillIds, agent.scope, ctx.root)]),
      ];
      buildPlugin(agent, ctx.root);
      return withMeta(agent, agent.scope);
    }),
  detach: (id, skillIds = []) =>
    mutateAgents(ctx => {
      const agent = ctx.find(id);
      agent.skillIds = agent.skillIds.filter(s => !skillIds.includes(s));
      buildPlugin(agent, ctx.root);
      return withMeta(agent, agent.scope);
    }),
  // A copy in the other scope, under its own name (names are unique across both). Personal →
  // project copies the library skills into the project; project → personal adds the project's
  // skills to the library, reusing a library skill of the same name (the user's library is never
  // overwritten).
  copy: (id, scope, name) =>
    mutateAgents(ctx => {
      const source = ctx.find(id),
        where = scope === 'project' ? 'project' : 'personal';
      if (source.scope === where)
        throw new Error(
          source.name +
            ' is already ' +
            (where === 'project' ? 'in this project' : 'a personal agent') +
            '.'
        );
      const list = ctx.use(where);
      let skillIds = source.skillIds;
      if (where === 'personal')
        skillIds = source.skillIds
          .map(sid => {
            const src = skillSource(source, sid, ctx.root);
            if (!hasSkill(src)) return null;
            const own = slug(path.basename(src));
            if (hasSkill(path.join(libraryDir(), own))) return own;
            return storeSkill(
              fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'),
              path.basename(src),
              src,
              { from: 'project agent ' + source.name }
            ).id;
          })
          .filter(Boolean);
      const agent = {
        id: 'agent-' + crypto.randomUUID(),
        name: checkName(name, ctx.all()),
        base: source.base,
        accountId: source.accountId || '',
        role: source.role || '',
        skillIds: supportsSkills(source.base) ? checkSkills(skillIds, where, ctx.root) : [],
        autoStart: source.autoStart === true,
        createdAt: Date.now(),
        scope: where,
      };
      list.push(agent);
      buildPlugin(agent, ctx.root);
      if (where === 'personal') {
        everywherePlugins.clear();
        scanCache.clear();
      }
      return withMeta(agent, where);
    }),
};

// Removing a skill from the library also removes it from every personal agent (project agents keep
// their own copies); returns the agents that changed.
function removeSkill(id) {
  // only slug-shaped ids: never '.', '..' (the library or its parent)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(id))) return { removed: false, agentIds: [] };
  const dir = path.join(libraryDir(), path.basename(String(id)));
  if (!fs.existsSync(dir)) return { removed: false, agentIds: [] };
  const changed = mutateAgents(ctx =>
    ctx
      .use('personal')
      .filter(a => a.skillIds.includes(id))
      .map(a => {
        a.skillIds = a.skillIds.filter(s => s !== id);
        buildPlugin(a);
        return a.id;
      })
  );
  fs.rmSync(dir, { recursive: true, force: true });
  const every = loadEverywhere();
  if (every.on.includes(id)) saveEverywhere({ ...every, on: every.on.filter(s => s !== id) });
  else {
    everywherePlugins.clear();
    scanCache.clear();
  }
  return { removed: true, agentIds: changed };
}

// Plain read/write copy: Electron's asar support covers readdir/readFile, not fs.cp.
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, e.name),
      to = path.join(dest, e.name);
    if (e.name === '.tnai-import.json') continue;
    if (e.isDirectory()) copyTree(from, to);
    else if (e.isFile()) fs.writeFileSync(to, fs.readFileSync(from));
  }
}

// The starter skills Technically Not ships (general agent habits) are public library skills: copied
// into the library once each and on for every session; the user sees them on the Skills page, turns
// them off or gives them to custom agents, or removes them (a removed one is never added back).
// Technically Not updates them: a Technically Not copy the user has not changed (its SKILL.md still
// matches the hash Technically Not recorded) is replaced by the newer shipped one. A skill the user
// imported under the same name has no starter mark and is never touched.
const STARTER_FROM = 'Technically Not starter skills';
const sha = text => crypto.createHash('sha1').update(text).digest('hex');
const readText = file => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};
const libraryEntries = () => {
  try {
    return fs.readdirSync(libraryDir(), { withFileTypes: true });
  } catch {
    return [];
  }
}; // none yet on a fresh install
let seededThisRun = false;

function seedStarters() {
  if (seededThisRun) return;
  seededThisRun = true;
  try {
    const every = loadEverywhere();
    let changed = false;
    for (const id of starterIds()) {
      const shipped = readText(path.join(STARTER_DIR, id, 'SKILL.md'));
      if (shipped == null) continue;
      const dest = path.join(libraryDir(), id),
        current = readText(path.join(dest, 'SKILL.md'));
      let meta = null;
      try {
        meta = JSON.parse(fs.readFileSync(warningsFile(dest), 'utf8'));
      } catch {}
      const fresh = !every.seeded.includes(id);
      if (current == null) {
        if (!fresh) continue;
      } // removed by the user: stays removed
      else if (meta?.from !== STARTER_FROM) {
        if (fresh) {
          every.seeded.push(id);
          changed = true;
        }
        continue;
      } // the user's own skill by that name
      // up to date, or changed by the user
      else if (current === shipped || (meta.hash && meta.hash !== sha(current))) continue;
      const staging = dest + '.copying-' + process.pid;
      fs.rmSync(staging, { recursive: true, force: true });
      copyTree(path.join(STARTER_DIR, id), staging);
      fs.writeFileSync(
        warningsFile(staging),
        JSON.stringify({
          warnings: [],
          importedAt: meta?.importedAt || Date.now(),
          updatedAt: Date.now(),
          from: STARTER_FROM,
          hash: sha(shipped),
        })
      );
      swapFolder(staging, dest);
      if (fresh) {
        every.seeded.push(id);
        if (!every.on.includes(id)) every.on.push(id);
      }
      changed = true;
    }

    // A starter Technically Not no longer ships (merged into another: low-usage-sessions →
    // agent-efficiency, 2026-09-25) leaves the library too, unless the user changed it (then it is
    // theirs). Skipped when the shipped folder can't be read, so a bad read never empties the
    // library.
    const shipped = new Set(starterIds());
    if (shipped.size)
      for (const e of libraryEntries()) {
        if (!e.isDirectory() || shipped.has(e.name)) continue;
        const dest = path.join(libraryDir(), e.name);
        let meta = null;
        try {
          meta = JSON.parse(fs.readFileSync(warningsFile(dest), 'utf8'));
        } catch {}
        const current = readText(path.join(dest, 'SKILL.md'));
        if (
          meta?.from !== STARTER_FROM ||
          !meta.hash ||
          current == null ||
          meta.hash !== sha(current)
        )
          continue;
        fs.rmSync(dest, { recursive: true, force: true });
        every.on = every.on.filter(id => id !== e.name);
        changed = true;
      }
    if (seedStarterAgents(every)) changed = true;

    // also drops the cached every-session plugins, so updated copies reach new sessions
    if (changed) saveEverywhere(every);

    // superseded pre-release folder
    fs.rmSync(path.join(dataDir(), 'builtin-plugin'), { recursive: true, force: true });
  } catch (error) {
    console.warn('Technically Not starter skills not added:', error.message);
  }
}

// Starter agents (builtin-agents.json): general roles every user gets once as personal agents.
// They carry no attached skills: the starter skills already load in every
// session. Each key is offered once, so one the user removed or renamed stays that way, and a name
// the user already uses is left alone.
const STARTER_AGENTS = path.join(__dirname, 'builtin-agents.json');

function seedStarterAgents(every) {
  let defs;
  try {
    defs = JSON.parse(fs.readFileSync(STARTER_AGENTS, 'utf8')).agents;
  } catch {
    return false;
  }
  const fresh = (Array.isArray(defs) ? defs : []).filter(
    d => d && d.key && d.name && !every.agents.includes(d.key)
  );
  if (!fresh.length) return false;
  const personal = store.readPersonal();
  if (!personal.ok) return false; // unreadable file: tried again next start, nothing overwritten
  const list = [...personal.list],
    taken = new Set(allAgents().map(a => String(a.name).toLowerCase()));
  for (const d of fresh) {
    every.agents.push(d.key);
    if (taken.has(d.name.toLowerCase()) || !registry.ids().includes(d.base)) continue;
    list.push({
      id: 'agent-' + crypto.randomUUID(),
      name: d.name,
      base: d.base,
      accountId: '',
      role: String(d.role || '')
        .trim()
        .slice(0, 300),
      skillIds: [],
      autoStart: false,
      createdAt: Date.now(),
    });
  }
  if (list.length !== personal.list.length) store.savePersonal(list);
  return true;
}

// Codex and GitHub Copilot have no per-session skills setting; both load the personal folder
// ~/.agents/skills (tools/agent-cli-check.js, 2026-10-01). Cursor Agent loads it too
// (cursor.com/docs/context/skills, read 2026-10-15; no model-free listing to prove it). The
// every-session library skills are copied there, each copy marked as Technically Not's (HOME_MARK).
// A folder without the mark is the user's own skill and is never touched; a marked copy follows the
// library (updated when any file of its skill folder changes, removed when the skill is turned off
// or leaves the library; the uninstaller removes the marked copies, build/installer.nsh). `add`:
// only a launch of one of these CLIs adds new copies; other calls just keep existing copies in
// step.
const HOME_SKILL_CLIS = new Set(['Codex', 'GitHub Copilot', 'Cursor Agent']);
const HOME_MARK = '.tnai-managed.json';
const homeSkillsDir = () =>
  process.env.TNAI_HOME_SKILLS_DIR || path.join(os.homedir(), '.agents', 'skills');
const homeMark = dir => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, HOME_MARK), 'utf8'));
  } catch {
    return null;
  }
};
const homeMarkText = hash =>
  JSON.stringify({
    from: 'Technically Not',
    hash,
    note: 'A copy of a Technically Not library skill. Turn it off on the Skills page to remove it; edits here are overwritten.',
  });

// Marked copies no longer wanted (looked up after the copies, as before: a missing folder lists
// nothing).
function homeSkillsGone(root, on) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {}
  return entries
    .filter(
      e =>
        e.isDirectory() &&
        !on.has(e.name) &&
        homeMark(path.join(root, e.name))?.from === 'Technically Not'
    )
    .map(e => path.join(root, e.name));
}

// One hash of a whole skill folder (every file's relative path and content, in a fixed order), so a
// change to a side file refreshes the copy as a SKILL.md change does.
function folderHash(dir) {
  const hash = crypto.createHash('sha1');
  const walk = (folder, rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      // copyTree leaves the import record out, so it is no part of the copy either
      if (e.name === '.tnai-import.json') continue;
      const from = path.join(folder, e.name),
        name = rel + '/' + e.name;
      if (e.isDirectory()) walk(from, name);
      else if (e.isFile()) {
        hash.update(name + '\0');
        hash.update(fs.readFileSync(from));
        hash.update('\0');
      }
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

// What syncHomeSkills copies: [{ id, dest, hash }], and the set that is on.
function homeSkillsPlan(root, add) {
  const mark = homeMark,
    copies = [];
  const on = new Set(
    loadEverywhere()
      .on.map(id => path.basename(String(id)))
      .filter(id => fs.existsSync(path.join(libraryDir(), id, 'SKILL.md')))
  );
  for (const id of on) {
    const dest = path.join(root, id),
      had = mark(dest),
      exists = fs.existsSync(dest);
    if (exists ? had?.from !== 'Technically Not' : !add) continue;
    const hash = folderHash(path.join(libraryDir(), id));
    if (had?.hash === hash) continue;
    copies.push({ id, dest, hash });
  }
  return { copies, on };
}

function syncHomeSkills({ add = false } = {}) {
  const root = homeSkillsDir(),
    { copies, on } = homeSkillsPlan(root, add);
  for (const c of copies) {
    const staging = c.dest + '.copying-' + process.pid;
    fs.rmSync(staging, { recursive: true, force: true });
    copyTree(path.join(libraryDir(), c.id), staging);
    fs.writeFileSync(path.join(staging, HOME_MARK), homeMarkText(c.hash));
    swapFolder(staging, c.dest);
  }
  for (const dir of homeSkillsGone(root, on)) fs.rmSync(dir, { recursive: true, force: true });
}

// The same for a panel start (launchOptions), with fs.promises.
async function syncHomeSkillsLater({ add = false } = {}) {
  const root = homeSkillsDir(),
    { copies, on } = homeSkillsPlan(root, add);
  for (const c of copies) {
    const staging = c.dest + '.copying-' + process.pid;
    await fsp.rm(staging, { recursive: true, force: true });
    await copyTreeLater(path.join(libraryDir(), c.id), staging);
    await fsp.writeFile(path.join(staging, HOME_MARK), homeMarkText(c.hash));
    await swapFolderLater(staging, c.dest);
  }
  for (const dir of homeSkillsGone(root, on)) await fsp.rm(dir, { recursive: true, force: true });
}

// Turns one library skill on or off for every session (not only custom agents).
function setEverywhere(id, on) {
  const skillId = path.basename(String(id));
  if (on && !fs.existsSync(path.join(libraryDir(), skillId, 'SKILL.md')))
    throw new Error(
      'Only skills in the Technically Not library can be turned on for every session.'
    );
  const every = loadEverywhere();
  saveEverywhere({
    ...every,
    on: on ? [...new Set([...every.on, skillId])] : every.on.filter(s => s !== skillId),
  });
  return { id: skillId, everywhere: !!on };
}

// SKILL.md paths of the library skills on for every session (keyword matching in
// skill-triggers.js).
const everywhereSkillFiles = () =>
  loadEverywhere()
    .on.map(id => path.join(libraryDir(), path.basename(String(id)), 'SKILL.md'))
    .filter(f => fs.existsSync(f));

// The Skills page detail panel: one listed skill (library, project or the user's own) by id, and
// its SKILL.md text (capped). Only ids the listing itself produces resolve, so no other file can be
// read or opened through it.
function findSkill(projectRoot, id) {
  const want = String(id || '');
  const all = [
    ...listDirSkills(libraryDir(), 'imported', ''),
    ...(projectRoot
      ? PROJECT_SKILL_DIRS.flatMap(rel =>
          listDirSkills(path.join(projectRoot, rel), 'project', 'project:' + rel + '/')
        )
      : []),
    ...listDirSkills(path.join(defaultClaudeHome(), 'skills'), 'user', 'user:'),
  ];
  return all.find(k => k.id === want) || null;
}

function readSkillFile(projectRoot, id) {
  const hit = findSkill(projectRoot, id);
  if (!hit) throw new Error('That skill is no longer in the library.');
  const file = path.join(hit.path, 'SKILL.md'),
    cap = 256 * 1024;
  const text = fs.readFileSync(file, 'utf8');
  return {
    id: hit.id,
    file,
    text: text.length > cap ? text.slice(0, cap) : text,
    truncated: text.length > cap,
  };
}

function listSkills(projectRoot) {
  seedStarters();
  const agents = loadAgents(),
    every = new Set(loadEverywhere().on);
  const users = id => agents.filter(a => a.skillIds.includes(id)).map(a => a.id);
  const imported = listDirSkills(libraryDir(), 'imported', '').map(s => ({
    ...s,
    agentIds: users(s.id),
    everywhere: every.has(s.id),
    by: readRecord(s.path).by || '',
  }));
  const project = projectRoot
    ? PROJECT_SKILL_DIRS.flatMap(rel =>
        listDirSkills(path.join(projectRoot, rel), 'project', 'project:' + rel + '/')
      ).map(s => ({ ...s, agentIds: [] }))
    : [];
  const user = listDirSkills(
    path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills'),
    'user',
    'user:'
  ).map(s => ({ ...s, agentIds: [] }));

  // Suggested / read / corrected counts from Claude Code sessions (skill-stats.js), for the Skills
  // page's health line. Same-topic skills (skill-overlap.js; library and project only) for the
  // Skills page's "Overlaps" badge.
  const near = new Map(),
    add = (p, other) => near.set(p, [...(near.get(p) || []), other]);
  for (const g of overlap.groups([...imported, ...project]))
    for (const p of g.pairs) {
      const pa = g.skills.find(s => s.name === p.a).path,
        pb = g.skills.find(s => s.name === p.b).path;
      add(pa, { name: p.b, why: p.why });
      add(pb, { name: p.a, why: p.why });
    }
  return [...imported, ...project, ...user].map(s => ({
    ...s,
    stats: stats.of(s.name || s.id),
    overlaps: near.get(s.path) || [],
  }));
}

// listSkills for the Skills page (skills:list, asked at every start and after each skill change),
// with the files read off the main loop: the same folders, files, order and result, but the main
// process is free while the disk answers (stalls.log 2026-10-06/07 named `ipc skills:list` at 322,
// 393 and 423 ms with no CPU used: about 130 reads at once, most of them in the synced project
// folder). Checked against listSkills by tools/desktop-check/skill-list-check.js. Still read at
// once: the starter check (once per run) and two small state files.
const readTextLater = file =>
  fsp.readFile(file, 'utf8').then(
    text => text,
    () => null
  );
const readRecordLater = async dir => {
  try {
    return JSON.parse(await fsp.readFile(warningsFile(dir), 'utf8')) || {};
  } catch {
    return {};
  }
};

async function readSkillDirLater(dir, source, idPrefix = '') {
  const file = path.join(dir, 'SKILL.md');
  const text = await readTextLater(file);
  if (text == null) return null;
  const parsed = parseSkill(text, path.basename(dir));
  if (isHidden(parsed.meta)) return null;
  const [editedAt, record] = await Promise.all([
    fsp.stat(file).then(
      st => st.mtimeMs,
      () => 0
    ),
    source === 'imported' ? readRecordLater(dir) : null,
  ]);
  return {
    id: idPrefix + path.basename(dir),
    name: parsed.meta.name || parsed.name,
    description: parsed.description,
    keywords: parsed.meta.keywords || '',
    paths: parsed.meta.paths || '',
    source,
    path: dir,
    editedAt: editedAt || null,
    warnings: source === 'imported' ? record.warnings || [] : parsed.warnings,
  };
}

async function listDirSkillsLater(root, source, idPrefix) {
  let names = [];
  try {
    names = (await fsp.readdir(root, { withFileTypes: true }))
      .filter(e => e.isDirectory() || e.isSymbolicLink())
      .map(e => e.name);
  } catch {
    return [];
  }
  return (
    await Promise.all(names.map(n => readSkillDirLater(path.join(root, n), source, idPrefix)))
  ).filter(Boolean);
}

async function listSkillsLater(projectRoot) {
  seedStarters();
  const agents = loadAgents(),
    every = new Set(loadEverywhere().on);
  const users = id => agents.filter(a => a.skillIds.includes(id)).map(a => a.id);
  const [library, projectDirs, own] = await Promise.all([
    listDirSkillsLater(libraryDir(), 'imported', ''),
    Promise.all(
      projectRoot
        ? PROJECT_SKILL_DIRS.map(rel =>
            listDirSkillsLater(path.join(projectRoot, rel), 'project', 'project:' + rel + '/')
          )
        : []
    ),
    listDirSkillsLater(
      path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'skills'),
      'user',
      'user:'
    ),
  ]);
  const records = await Promise.all(library.map(s => readRecordLater(s.path))),
    t0 = performance.now();
  const imported = library.map((s, i) => ({
    ...s,
    agentIds: users(s.id),
    everywhere: every.has(s.id),
    by: records[i].by || '',
  }));
  const project = projectDirs.flat().map(s => ({ ...s, agentIds: [] }));
  const user = own.map(s => ({ ...s, agentIds: [] }));
  const near = new Map(),
    add = (p, other) => near.set(p, [...(near.get(p) || []), other]);
  for (const g of overlap.groups([...imported, ...project]))
    for (const p of g.pairs) {
      const pa = g.skills.find(s => s.name === p.a).path,
        pb = g.skills.find(s => s.name === p.b).path;
      add(pa, { name: p.b, why: p.why });
      add(pb, { name: p.a, why: p.why });
    }
  const out = [...imported, ...project, ...user].map(s => ({
    ...s,
    stats: stats.of(s.name || s.id),
    overlaps: near.get(s.path) || [],
  }));

  // a named section (stall-log.js): the part that runs after the reads
  require('./stall-log').ran('skills list compare', performance.now() - t0);
  return out;
}

// One plugin folder of the library skills turned on for every session and (for an extra account)
// the user's own Claude skills, rebuilt when that set or a skill in it changes. Precedence when
// names clash: the session's own config folder, then the library, then the user's ~/.claude/skills;
// a clashing lower one is left out, so no skill loads twice. Why the user's skills: an extra
// account runs with its own CLAUDE_CONFIG_DIR, where Claude Code does not see ~/.claude/skills at
// all.
const everywherePlugins = new Map();
const defaultClaudeHome = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const mtimeOf = file => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

async function buildEverywherePluginDir(configDir) {
  // a panel start only: staged with fs.promises (see inTurn)
  const home = defaultClaudeHome(),
    config = configDir || home;
  const own = new Set(listDirSkills(path.join(config, 'skills'), 'user', '').map(s => s.id));
  const inLibrary = id => fs.existsSync(path.join(libraryDir(), id, 'SKILL.md'));
  const ids = loadEverywhere()
    .on.filter(id => !own.has(id) && inLibrary(id))
    .sort();
  const mine =
    path.resolve(config).toLowerCase() === path.resolve(home).toLowerCase()
      ? []
      : listDirSkills(path.join(home, 'skills'), 'user', '')
          .filter(k => !own.has(k.id) && !ids.includes(k.id))
          .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!ids.length && !mine.length) return '';
  const mineStamps = [];
  for (const k of mine) mineStamps.push(k.id + ':' + (await folderStamp(k.path)));
  const libStamps = [];
  for (const id of ids) libStamps.push(id + ':' + (await folderStamp(path.join(libraryDir(), id))));
  const mineStamp = mineStamps.join(',');
  const libStamp = libStamps.join(',');
  const key = crypto
    .createHash('sha1')
    .update(libStamp + '|' + mineStamp)
    .digest('hex')
    .slice(0, 10);
  const root = path.join(dataDir(), 'everywhere-plugin'),
    dir = path.join(root, key);
  if (everywherePlugins.get(key)) return dir;
  const staging = dir + '.building-' + process.pid;
  await fsp.rm(staging, { recursive: true, force: true });
  await fsp.mkdir(path.join(staging, '.claude-plugin'), { recursive: true });
  await fsp.writeFile(
    path.join(staging, '.claude-plugin', 'plugin.json'),
    JSON.stringify(
      {
        name: 'tnai-skills',
        version: '1.0.0',
        description: 'Skills turned on for every session on Technically Not’s Skills page.',
      },
      null,
      2
    )
  );
  for (const id of ids)
    await copyTreeLater(path.join(libraryDir(), id), path.join(staging, 'skills', id));
  for (const k of mine) await copyTreeLater(k.path, path.join(staging, 'skills', k.id));

  // A session still reading the previous copy can block the swap on Windows; that copy is then used
  // as is.
  try {
    await swapFolderLater(staging, dir);
  } catch (error) {
    if (!fs.existsSync(path.join(dir, '.claude-plugin', 'plugin.json'))) throw error;
  }
  everywherePlugins.set(key, true);

  // Old builds of the plugin go after a week unused; newer ones may belong to another account's
  // running session (its skills load lazily from there).
  for (const old of await fsp.readdir(root))
    if (!everywherePlugins.has(old) && Date.now() - mtimeOf(path.join(root, old)) > 7 * 864e5)
      try {
        await fsp.rm(path.join(root, old), { recursive: true, force: true });
      } catch {}
  return dir;
}

// Every Claude Code launch asks for this; the folder scan + SKILL.md stats run again only after a
// change in a scanned skills folder (watched below) or the every-session set. Cached only while all
// three folders are watched, so an unwatched change can never be missed.
const scanCache = new Map(); // config folder -> plugin dir ('' = none)
const scanWatchers = new Map(); // skills folder -> fs.watch handle

function watchSkills(folder) {
  if (scanWatchers.has(folder)) return true;
  try {
    const w = fs.watch(folder, { recursive: true }, () => scanCache.clear());
    w.unref?.();
    w.on('error', () => {
      try {
        w.close();
      } catch {}
      scanWatchers.delete(folder);
      scanCache.clear();
    });
    scanWatchers.set(folder, w);
    return true;
  } catch {
    return false;
  } // missing folder: tried again next launch
}

async function everywherePluginDir(configDir) {
  const home = defaultClaudeHome(),
    config = path.resolve(configDir || home),
    key = config.toLowerCase();
  const kept = () => {
    const hit = scanCache.get(key);
    return hit !== undefined &&
      (!hit || fs.existsSync(path.join(hit, '.claude-plugin', 'plugin.json')))
      ? { dir: hit }
      : null;
  };
  const hit = kept();
  if (hit) return hit.dir;
  return inTurn(async () => {
    const built = kept();
    if (built) return built.dir; // a start ahead of this one built it meanwhile
    const watched = [libraryDir(), path.join(config, 'skills'), path.join(home, 'skills')]
      .map(watchSkills)
      .every(Boolean);

    // A change seen while the copy runs clears scanCache, and this mark with it: the result is then
    // not kept, so the next start scans again.
    const mark = {},
      markKey = 'building|' + key;
    scanCache.set(markKey, mark);
    try {
      const dir = await buildEverywherePluginDir(configDir);
      if (watched && scanCache.get(markKey) === mark) scanCache.set(key, dir);
      else scanCache.delete(key);
      return dir;
    } finally {
      scanCache.delete(markKey);
    }
  });
}

// Launch additions: { pluginDirs, appendPrompt }: the skills turned on for every session of a CLI
// that loads skills (accountDir = its config folder), plus a custom agent's own skills and
// identity. OpenCode has no customArgs, but loads extra skill folders named in its session config
// (`skills.paths`, agent-registry.js `rules`; checked with `opencode debug skill`, opencode
// 1.18.33): it gets the every-session skills the same way. A custom agent's attached skills reach
// the CLIs of supportsSkills (Cursor Agent: its plugin folder through `--plugin-dir`); its identity
// text reaches every CLI as appendPrompt (the other CLIs take it as an instructions file,
// agent-registry.js `rules`).
const SKILL_PATHS = new Set(['OpenCode']);

async function launchOptions(customAgentId, agentId, accountDir) {
  let every = '';
  if (takesPlugins(agentId) || SKILL_PATHS.has(agentId))
    try {
      seedStarters();
      every = await everywherePluginDir(takesPlugins(agentId) ? accountDir : '');
    } catch (error) {
      console.warn('Technically Not skills for every session not loaded:', error.message);
    }
  if (HOME_SKILL_CLIS.has(agentId))
    try {
      seedStarters();
      await inTurn(() => syncHomeSkillsLater({ add: true }));
    } catch (error) {
      console.warn('Technically Not skills for Codex and Copilot not copied:', error.message);
    }
  const base = every ? { pluginDirs: [every] } : {};
  if (!customAgentId) return base;
  const agent = allAgents().find(a => a.id === customAgentId);
  if (!agent || agent.base !== agentId) return base;

  // A CLI without a per-session skills route gets the identity only.
  const skills = supportsSkills(agent.base)
    ? agent.skillIds
        .map(id => skillSource(agent, id))
        .filter(Boolean)
        .map(dir => readSkillDir(dir, 'imported'))
        .filter(Boolean)
    : [];
  let dir = pluginDir(agent.id);

  // A project agent's plugin is rebuilt at every start: its skills are files in the project that a
  // pull or an edit may have changed. A plugin built before it carried Cursor's manifest is built
  // again once.
  const built = ['.claude-plugin', '.cursor-plugin'].every(folder =>
    fs.existsSync(path.join(dir, folder, 'plugin.json'))
  );
  if (skills.length && (agent.scope === 'project' || !built))
    dir = await inTurn(() => buildPluginLater(agent));
  const prompt =
    'You are "' +
    agent.name +
    '", a custom agent the user set up in Technically Not.' +
    (agent.role ? ' Your role: ' + agent.role : '') +
    (skills.length
      ? ' Skills attached for you: ' +
        skills.map(s => s.name).join(', ') +
        '. Use them when they fit the task.'
      : '');
  return {
    customAgentId,
    pluginDirs: [...(base.pluginDirs || []), ...(skills.length ? [dir] : [])],
    appendPrompt: prompt,
  };
}

// `claude plugin validate <dir>`: checks the plugin folder without starting a session or sending a
// prompt.
function validatePlugin(customAgentId) {
  const dir = pluginDir(customAgentId);
  if (!fs.existsSync(dir))
    return Promise.resolve({
      ok: false,
      out: 'No plugin folder (the agent has no skills or its CLI cannot load them).',
    });
  if (process.platform !== 'win32')
    return registry.resolveCommand('claude').then(exe =>
      !exe
        ? { ok: false, out: 'claude not found on PATH' } // mac/Linux: `which`
        : new Promise(resolve =>
            execFile(exe, ['plugin', 'validate', dir], { timeout: 30000 }, (err, stdout, stderr) =>
              resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') })
            )
          )
    );
  return new Promise(resolve =>
    execFile('where.exe', ['claude'], { windowsHide: true }, (error, out) => {
      const exe = String(out || '')
        .split(/\r?\n/)
        .map(s => s.trim())
        .find(p => /\.exe$/i.test(p));
      if (error || !exe) return resolve({ ok: false, out: 'claude.exe not found on PATH' });
      execFile(
        exe,
        ['plugin', 'validate', dir],
        { windowsHide: true, timeout: 30000 },
        (err, stdout, stderr) =>
          resolve({ ok: !err, out: String(stdout || '') + String(stderr || '') })
      );
    })
  );
}

async function pickFolder(win) {
  const result = await dialog.showOpenDialog(win, {
    title: 'Import skill folder',
    properties: ['openDirectory', 'multiSelections'],
  });
  return result.canceled
    ? { imported: [], errors: [] }
    : importSkills({ folders: result.filePaths });
}

module.exports = {
  init,
  launchOptions,
  listSkills,
  listSkillsLater,
  findSkill,
  readSkillFile,
  importSkills,
  saveAgentSkill,
  skillOverlaps,
  overlapsFor,
  removeAgentSkill,
  removeSkill,
  setEverywhere,
  everywhereSkillFiles,
  pickFolder,
  validatePlugin,
  agents: agentApi,
  pluginDir,
};
