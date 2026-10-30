/*
 * Technically Not desktop · agent-proposals.js — Custom agents made or changed from a prompt.
 *
 * An agent the user asked ("make me an agent for marketing rechecks", "Fixer should always run the
 * tests first") writes a small draft file and runs `tnai agent save FILE` (agent-mesh.js). This
 * file checks the draft and keeps it as a proposal; it changes no agent. The window shows each
 * proposal in the bell with Accept and Decline (src/scripts/60-bell-notices.js). Accept saves it
 * through the existing custom agent API (17, skill-service.js, custom-agent-store.js with its
 * backup), then marks the proposal settled here. Custom agents are the user's: nothing here ever
 * writes one.
 *
 * Plain Node (no Electron): main.js hands in the file path and the readers, so
 * tools/agent-proposals-test.js runs it without the app. Plan:
 * docs/plans/custom-agents-by-prompt.md.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The store keeps at most 300 characters of a role (skill-service.js agents.update), so a longer
// one is refused here instead of being cut on Accept.
const ROLE_MAX = 300;
const NAME_MAX = 60;
const DRAFT_MAX = 64 * 1024;
const PENDING_MAX = 20;

// Settled proposals stay listed this long, so the agent that wrote one can see the outcome.
const KEEP_SETTLED_MS = 7 * 24 * 60 * 60 * 1000;

// Fields a draft may hold. Account and "Start with this project" stay the user's own choices.
const KNOWN = new Set([
  'name',
  'cli',
  'base',
  'role',
  'skills',
  'addSkills',
  'removeSkills',
  'scope',
  'edit',
  'agent',
]);
const USER_ONLY = new Set(['account', 'accountId', 'autoStart', 'autostart', 'start']);

// A proposal never carries a secret (plan: "A proposal never holds secrets or account choices").
const SECRET =
  /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[\w-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY|\b(password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S{6,})/i;

let deps = {
  file: '',
  agents: () => [],
  skills: () => [],
  clis: () => [],
  supportsSkills: () => false,
  changed: () => {},
};

function init(given = {}) {
  deps = { ...deps, ...given };
}

// ---------- The stored list ----------

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(deps.file, 'utf8'));
    return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string') : [];
  } catch {
    return [];
  }
}

function save(list) {
  const now = Date.now();
  const kept = list.filter(
    p => p.state === 'pending' || now - (p.settledAt || 0) < KEEP_SETTLED_MS
  );
  fs.mkdirSync(path.dirname(deps.file), { recursive: true });
  const temp = deps.file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(kept, null, 1));
  fs.renameSync(temp, deps.file);
  try {
    deps.changed();
  } catch {}
}

const sameFolder = (a, b) =>
  !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// The proposals the user can act on with this project open: personal ones, and project ones made
// for this project. settled: also the recently accepted or declined ones.
function list(root, { settled = false } = {}) {
  return load().filter(
    p =>
      (settled || p.state === 'pending') && (p.scope === 'personal' || sameFolder(p.project, root))
  );
}

function get(id) {
  return load().find(p => p.id === id) || null;
}

// The window saved it (Accept) or the user declined it.
function settle(id, state) {
  const all = load();
  const hit = all.find(p => p.id === id);
  if (!hit) throw new Error('That proposal is no longer there.');
  if (hit.state !== 'pending') return hit;
  hit.state = state === 'accepted' ? 'accepted' : 'declined';
  hit.settledAt = Date.now();
  save(all);
  return hit;
}

// ---------- Reading a draft ----------

const oneLine = text =>
  String(text ?? '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const asList = value => {
  if (Array.isArray(value)) return value.map(oneLine).filter(Boolean);
  return String(value ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map(s => oneLine(s).replace(/^["']|["']$/g, ''))
    .filter(Boolean);
};

// A .md draft: frontmatter (name, cli, skills, scope, edit…) and the role as its body. A .json
// draft: the same keys, role as a field.
function parseDraft(text, fileName = '') {
  const source = String(text).replace(/^﻿/, '');
  if (/\.json$/i.test(fileName) || /^\s*\{/.test(source)) {
    let data;
    try {
      data = JSON.parse(source);
    } catch (error) {
      throw new Error('The draft is not valid JSON (' + error.message + ').');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('The draft must be one JSON object.');
    return data;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match)
    throw new Error(
      'The draft needs frontmatter between --- lines (name, cli, skills, scope or edit), then the role.'
    );
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^\s*([\w-]+)\s*:\s*(.*)$/.exec(line);
    if (pair) data[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, '');
  }
  const body = source.slice(match[0].length).trim();
  if (body) data.role = body;
  return data;
}

function readDraft(inputPath, cwd) {
  const raw = String(inputPath || '').trim();
  if (!raw) throw new Error('Give the draft file: `tnai agent save FILE` (.md or .json).');
  const target = path.resolve(path.isAbsolute(raw) || !cwd ? '' : String(cwd), raw);
  let size;
  try {
    size = fs.statSync(target).size;
  } catch {
    throw new Error('Not found: ' + target);
  }
  if (size > DRAFT_MAX) throw new Error('The draft is too large (limit 64 KB).');
  return parseDraft(fs.readFileSync(target, 'utf8'), target);
}

// ---------- Checking a draft ----------

// "claude", "Claude Code", "cursor" → the registry's own name.
function findCli(value) {
  const want = oneLine(value).toLowerCase().replace(/\s+/g, ' ');
  if (!want) return '';
  const ids = deps.clis();
  return (
    ids.find(id => id.toLowerCase() === want) ||
    ids.find(id => id.toLowerCase().replace(/\s/g, '') === want.replace(/\s/g, '')) ||
    ids.find(id => id.toLowerCase().startsWith(want)) ||
    ''
  );
}

function findAgent(value, agents) {
  const want = oneLine(value).toLowerCase();
  if (!want) return null;
  return agents.find(a => a.id === value || a.name.toLowerCase() === want) || null;
}

// A skill name or id from the draft → the id the store keeps. Personal agents take library skills
// only; project agents also the project's own skills (project:<dir>/<name>).
function findSkill(value, rows, scope) {
  const want = oneLine(value).toLowerCase();
  const usable = rows.filter(
    s => s.source === 'imported' || (scope === 'project' && s.source === 'project')
  );
  const named = s =>
    s.id.toLowerCase() === want ||
    String(s.name || '').toLowerCase() === want ||
    path.basename(s.id).toLowerCase() === want;

  // the project's own copy first, as the project agents already use it
  const order = scope === 'project' ? ['project', 'imported'] : ['imported'];
  for (const source of order) {
    const hit = usable.find(s => s.source === source && named(s));
    if (hit) return hit.id;
  }
  return '';
}

function checkSkills(names, rows, scope) {
  const ids = [],
    missing = [];
  for (const name of names) {
    const id = findSkill(name, rows, scope);
    if (id) ids.push(id);
    else missing.push(name);
  }
  if (missing.length)
    throw new Error(
      'Unknown skill' +
        (missing.length > 1 ? 's' : '') +
        ': ' +
        missing.join(', ') +
        (scope === 'project'
          ? ' (a project agent takes skills from this project or the library; `tnai skill list`).'
          : ' (a personal agent takes library skills only; `tnai skill list`).')
    );
  return [...new Set(ids)];
}

function checkText(label, text) {
  if (SECRET.test(text))
    throw new Error(
      'The ' + label + ' looks like it holds a password or key. A custom agent never stores one.'
    );
}

const skillWord = list => (list.length ? list.map(id => path.basename(id)).join(', ') : 'none');

// draft → a stored proposal. context: { project, by, byCli }. Throws with a plain reason; nothing
// is stored then.
function propose(draft, context = {}) {
  const notes = [];
  const project = String(context.project || '');
  const agents = deps.agents();
  const keys = Object.keys(draft || {});
  const userOnly = keys.filter(k => USER_ONLY.has(k));
  const unknown = keys.filter(k => !KNOWN.has(k) && !USER_ONLY.has(k));
  if (userOnly.length)
    notes.push(
      'Left out ' +
        userOnly.join(', ') +
        ': the account and "Start with this project" are chosen by the user in Settings › Agents › Custom agents.'
    );
  if (unknown.length)
    notes.push(
      'Ignored unknown field' + (unknown.length > 1 ? 's' : '') + ': ' + unknown.join(', ') + '.'
    );

  const editName = draft.edit ?? draft.agent;
  const target = editName !== undefined ? findAgent(editName, agents) : null;
  if (editName !== undefined && !target)
    throw new Error('No custom agent named “' + oneLine(editName) + '” (`tnai agent list`).');

  // Where it is kept: an existing agent stays where it is; a new one goes into the open project
  // unless the draft says personal.
  const scopeAsked = oneLine(draft.scope).toLowerCase();
  let scope = target ? target.scope : project ? 'project' : 'personal';
  if (!target && scopeAsked === 'personal') scope = 'personal';
  if (!target && scopeAsked === 'project') scope = 'project';
  if (scope === 'project' && !project)
    throw new Error('Open a project folder first to keep an agent in it, or use scope: personal.');

  // The CLI: a new agent takes the named one, else the proposing agent's own; an existing agent
  // keeps its CLI (the store has no way to move one).
  const cliAsked = oneLine(draft.cli ?? draft.base);
  const base = target ? target.base : findCli(cliAsked) || findCli(context.byCli) || 'Claude Code';
  if (cliAsked && !findCli(cliAsked))
    throw new Error(
      'Unknown agent CLI “' + cliAsked + '”. Use one of: ' + deps.clis().join(', ') + '.'
    );
  if (target && cliAsked && findCli(cliAsked) !== target.base)
    throw new Error(
      target.name +
        ' runs on ' +
        target.base +
        ' and an existing agent cannot move to another CLI. Propose a new agent instead.'
    );

  // Name
  const nameAsked = draft.name !== undefined ? oneLine(draft.name) : '';
  const name = nameAsked || target?.name || '';
  if (!name) throw new Error('Give the new agent a name (name: …).');
  if (name.length > NAME_MAX) throw new Error('Keep the name under 60 characters.');
  const clash = agents.find(
    a => a.id !== target?.id && a.name.toLowerCase() === name.toLowerCase()
  );
  if (clash)
    throw new Error(
      'A custom agent named “' +
        clash.name +
        '” already exists. Choose another name, or use edit: ' +
        clash.name +
        '.'
    );
  checkText('name', name);

  // Role: one line, the store's limit
  const role = draft.role !== undefined ? oneLine(draft.role) : (target?.role ?? '');
  if (draft.role !== undefined && role.length > ROLE_MAX)
    throw new Error(
      'The role is ' +
        role.length +
        ' characters; a role holds at most 300. Keep it to who the agent is and what it reads first, and put rules in an attached skill.'
    );
  checkText('role', role);

  // Skills: a full list (skills), or changes to the agent's own (addSkills, removeSkills)
  const rows = deps.skills(project);
  let skillIds = target ? [...target.skillIds] : [];
  if (draft.skills !== undefined) skillIds = checkSkills(asList(draft.skills), rows, scope);
  if (draft.addSkills !== undefined)
    skillIds = [...new Set([...skillIds, ...checkSkills(asList(draft.addSkills), rows, scope)])];
  if (draft.removeSkills !== undefined) {
    const drop = asList(draft.removeSkills).map(s => s.toLowerCase());
    skillIds = skillIds.filter(
      id => !drop.includes(id.toLowerCase()) && !drop.includes(path.basename(id).toLowerCase())
    );
  }
  if (skillIds.length && !deps.supportsSkills(base)) {
    notes.push(
      base +
        ' takes the name and role only: the skills were left out (Claude Code, OpenCode and Cursor Agent load attached skills).'
    );
    skillIds = target ? [...target.skillIds] : [];
  }

  const after = { name, base, role, skillIds };
  const before = target
    ? {
        name: target.name,
        base: target.base,
        role: target.role || '',
        skillIds: [...target.skillIds],
      }
    : null;
  if (
    before &&
    before.name === after.name &&
    before.role === after.role &&
    JSON.stringify([...before.skillIds].sort()) === JSON.stringify([...after.skillIds].sort())
  )
    throw new Error('Nothing would change for ' + target.name + '.');

  const all = load();
  const key = target ? 'agent:' + target.id : 'new:' + name.toLowerCase();

  // A newer draft for the same agent replaces the one still waiting.
  const waiting = all.filter(p => p.state === 'pending' && p.key !== key);
  if (waiting.length >= PENDING_MAX)
    throw new Error(
      PENDING_MAX +
        ' proposals already wait for the user. Ask them to accept or decline some first.'
    );
  const proposal = {
    id: crypto.randomUUID().slice(0, 8),
    key,
    kind: target ? 'edit' : 'new',
    state: 'pending',
    targetId: target?.id || '',
    scope,
    project: scope === 'project' ? project : '',
    by: oneLine(context.by).slice(0, 80) || 'An agent',
    byCli: oneLine(context.byCli).slice(0, 40),
    at: Date.now(),
    before,
    after,
    notes,
  };
  const replaced = all.some(p => p.state === 'pending' && p.key === key);
  save([proposal, ...all.filter(p => !(p.state === 'pending' && p.key === key))]);
  return { proposal, replaced };
}

// What a proposal changes, in plain lines (the command's answer and the bell's text).
function describe(p) {
  const lines = [];
  const a = p.after,
    b = p.before;
  if (!b) {
    lines.push(
      'New ' + (p.scope === 'project' ? 'project' : 'personal') + ' agent on ' + a.base + '.'
    );
    lines.push('Role: ' + (a.role || '(none)'));
    lines.push('Skills: ' + skillWord(a.skillIds));
  } else {
    if (b.name !== a.name) lines.push('Name: ' + b.name + ' → ' + a.name);
    if (b.role !== a.role) {
      lines.push('Role now: ' + (b.role || '(none)'));
      lines.push('Role after: ' + (a.role || '(none)'));
    }
    const added = a.skillIds.filter(id => !b.skillIds.includes(id)),
      removed = b.skillIds.filter(id => !a.skillIds.includes(id));
    if (added.length) lines.push('Skills added: ' + skillWord(added));
    if (removed.length) lines.push('Skills removed: ' + skillWord(removed));
  }
  lines.push(
    p.scope === 'project'
      ? 'Saved in this project (.tnai/agents.json) on Accept.'
      : 'Saved with your personal agents on Accept.'
  );
  return lines;
}

module.exports = {
  init,
  readDraft,
  parseDraft,
  propose,
  describe,
  list,
  get,
  settle,
  findAgent,
  ROLE_MAX,
};
