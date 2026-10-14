/*
 * Technically Not desktop · custom-agent-store.js — Where custom agents are kept, and keeping them
 * safe. Personal agents: <userData>/custom-agents.json (machine-wide, survive updates, not tied to
 * sign-in). Every save first copies the last good file to custom-agents.backup.json; a file that no
 * longer parses is moved aside as custom-agents.broken-<time>.json and the backup is restored, so
 * an unreadable file is never overwritten with an empty list. A file that exists but cannot be read
 * (locked) makes saves refuse instead. Project agents: <project>/.tnai/agents.json (human-readable,
 * commit-friendly) with their skills copied into <project>/.tnai/agent-skills/<id>/. Account
 * choices are per machine, so they live in <userData>/project-agent-accounts.json keyed by project
 * folder + agent id, never in the project.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const dataDir = () => app.getPath('userData');
const personalFile = () => path.join(dataDir(), 'custom-agents.json');
const backupFile = () => path.join(dataDir(), 'custom-agents.backup.json');
const accountsFile = () => path.join(dataDir(), 'project-agent-accounts.json');
const PROJECT_DIR = '.tnai';
const projectFile = root => path.join(root, PROJECT_DIR, 'agents.json');
const projectSkillsDir = root => path.join(root, PROJECT_DIR, 'agent-skills');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const valid = a =>
  a &&
  typeof a === 'object' &&
  typeof a.id === 'string' &&
  /^[\w-]{1,80}$/.test(a.id) &&
  typeof a.name === 'string' &&
  typeof a.base === 'string';
const tidy = a => ({
  ...a,
  role: String(a.role || ''),
  autoStart: a.autoStart === true,
  skillIds: Array.isArray(a.skillIds) ? a.skillIds.filter(s => typeof s === 'string') : [],
});

function parsePersonal(text) {
  const list = JSON.parse(text);
  if (!Array.isArray(list)) throw new Error('not a list of agents');
  return list.filter(valid).map(tidy);
}

function readBackup() {
  try {
    return parsePersonal(fs.readFileSync(backupFile(), 'utf8'));
  } catch {
    return null;
  }
}

// { list, ok, error?, recovered? } — ok false: the file exists but could not be read; saving must
// refuse so nothing is lost.
function readPersonal() {
  let text;
  try {
    text = fs.readFileSync(personalFile(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { list: [], ok: true };
    return {
      list: readBackup() || [],
      ok: false,
      error: 'Could not read your custom agents file (' + (error.code || error.message) + ')',
    };
  }
  try {
    return { list: parsePersonal(text), ok: true };
  } catch (error) {
    const aside = path.join(dataDir(), 'custom-agents.broken-' + stamp() + '.json');
    try {
      fs.renameSync(personalFile(), aside);
    } catch {
      return {
        list: readBackup() || [],
        ok: false,
        error: 'Your custom agents file is damaged and could not be moved aside',
      };
    }
    const backup = readBackup() || [];
    writeAtomic(personalFile(), JSON.stringify(backup, null, 1));
    console.warn(
      'Technically Not custom agents: the file could not be read (' +
        error.message +
        '); kept it as ' +
        aside +
        ' and restored ' +
        backup.length +
        ' agent(s) from the backup.'
    );
    return { list: backup, ok: true, recovered: aside };
  }
}

function savePersonal(list) {
  try {
    const current = fs.readFileSync(personalFile(), 'utf8');
    parsePersonal(current);
    writeAtomic(backupFile(), current);
  } catch {} // only a good file becomes the backup
  writeAtomic(
    personalFile(),
    JSON.stringify(
      list.map(({ scope, supportsSkills, ...a }) => a),
      null,
      1
    )
  );
}

// ---- Project agents ----
const accountKey = (root, id) => path.resolve(root).toLowerCase() + '|' + id;
const readMap = file => {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch {
    return {};
  }
};
const readAccounts = () => readMap(accountsFile());

// "Start with this project" counts only on a computer where it was turned on:
// .tnai/agents.json comes with the project, so a cloned repository could
// otherwise start an agent by itself, with its own name, role and skills in that agent's
// instructions. writeProject (this computer's own saves) notes what was allowed, as a hash of
// exactly those fields, in <userData>/project-agent-autostart.json; readProject reports autoStart
// only when the file's agent still matches it. An agent whose file says autoStart but is not
// allowed here reads as off, with autoStartElsewhere so a save here does not turn it off for
// everyone else.
const autoStartFile = () => path.join(dataDir(), 'project-agent-autostart.json');
const autoMark = a =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([a.name, a.base, String(a.role || ''), a.skillIds || []]))
    .digest('hex');

function readProject(root) {
  if (!root) return { list: [], ok: true };
  let text;
  try {
    text = fs.readFileSync(projectFile(root), 'utf8');
  } catch (error) {
    return error.code === 'ENOENT'
      ? { list: [], ok: true }
      : {
          list: [],
          ok: false,
          error: 'Could not read .tnai/agents.json (' + (error.code || error.message) + ')',
        };
  }
  try {
    const data = JSON.parse(text),
      raw = Array.isArray(data) ? data : data?.agents;
    if (!Array.isArray(raw)) throw new Error('no "agents" list');
    const accounts = readAccounts(),
      allowed = readMap(autoStartFile());
    const list = raw.filter(valid).map(a =>
      tidy({
        ...a,
        skillIds: Array.isArray(a.skills) ? a.skills : a.skillIds,
        accountId: accounts[accountKey(root, a.id)] || '',
      })
    );
    list.forEach(a => {
      delete a.skills;
      delete a.autoStartElsewhere;
      if (a.autoStart && allowed[accountKey(root, a.id)] !== autoMark(a)) {
        a.autoStart = false;
        a.autoStartElsewhere = true;
      }
    });
    return { list, ok: true };
  } catch (error) {
    return {
      list: [],
      ok: false,
      error:
        '.tnai/agents.json in this project could not be read (' +
        error.message +
        '). Fix or remove it; Technically Not left it unchanged',
    };
  }
}

function writeProject(root, list) {
  const accounts = readAccounts();
  let changed = false;
  const agents = list.map(a => {
    const key = accountKey(root, a.id),
      account = String(a.accountId || '');
    if ((accounts[key] || '') !== account) {
      if (account) accounts[key] = account;
      else delete accounts[key];
      changed = true;
    }
    return {
      id: a.id,
      name: a.name,
      base: a.base,
      role: a.role || '',
      skills: a.skillIds || [],
      autoStart: a.autoStart === true || a.autoStartElsewhere === true,
      createdAt: a.createdAt || Date.now(),
    };
  });
  if (changed) writeAtomic(accountsFile(), JSON.stringify(accounts, null, 1));

  // What this computer allows to start with the project: the agents saved here with it on, as they
  // are now; removed agents leave the list.
  const allowed = readMap(autoStartFile()),
    before = JSON.stringify(allowed),
    mine = path.resolve(root).toLowerCase() + '|';
  for (const key of Object.keys(allowed)) if (key.startsWith(mine)) delete allowed[key];
  for (const a of list)
    if (a.autoStart === true)
      allowed[accountKey(root, a.id)] = autoMark({
        ...a,
        role: a.role || '',
        skillIds: a.skillIds || [],
      });
  if (JSON.stringify(allowed) !== before)
    writeAtomic(autoStartFile(), JSON.stringify(allowed, null, 1));
  writeAtomic(
    projectFile(root),
    JSON.stringify(
      {
        about:
          'Custom agents saved to this project by Technically Not. Their skills are in agent-skills/. Accounts are chosen per machine and not stored here.',
        version: 1,
        agents,
      },
      null,
      2
    ) + '\n'
  );
}

function forgetAccount(root, id) {
  const accounts = readAccounts(),
    key = accountKey(root, id);
  if (key in accounts) {
    delete accounts[key];
    writeAtomic(accountsFile(), JSON.stringify(accounts, null, 1));
  }
}

// Copied skills no project agent uses any more are removed (everything under .tnai/agent-skills is
// Technically Not's own copy).
function pruneProjectSkills(root, list) {
  const used = new Set(list.flatMap(a => a.skillIds).filter(id => !id.startsWith('project:')));
  let names = [];
  try {
    names = fs
      .readdirSync(projectSkillsDir(root), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return;
  }
  for (const name of names)
    if (!used.has(name))
      fs.rmSync(path.join(projectSkillsDir(root), name), { recursive: true, force: true });
}

module.exports = {
  readPersonal,
  savePersonal,
  readProject,
  writeProject,
  forgetAccount,
  pruneProjectSkills,
  projectFile,
  projectSkillsDir,
  personalFile,
  backupFile,
  PROJECT_DIR,
};
