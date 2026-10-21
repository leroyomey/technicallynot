/*
 * Technically Not desktop · skill-stats.js — How each skill is doing, from Claude Code's hooks
 * (agent-hooks.js): how often it was suggested (prompt keywords or a file it owns,
 * skill-triggers.js), how often a session actually read it (Skill tool, or a Read of its SKILL.md),
 * and what the user's next prompt said after a turn that read it (a correction such as "no, that's
 * wrong" or an approval such as "thanks, works"; inferred from the prompt's words, so the Skills
 * page labels it as inferred). Kept in userData/skill-stats.json, keyed by skill name, and shown on
 * the Skills page (18-skills-page.js). Other CLIs have no hooks, so their sessions are not counted.
 * Plain Node: the folder comes from Electron lazily, or from init({ dir }) in tests.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let dataDir = () => {
  try {
    return require('electron').app.getPath('userData');
  } catch {
    return '';
  }
};
let data = null,
  timer = null;

// paneId -> { offered: Set, read: Set, pending: Set (read since the user's last prompt) }
const panes = new Map();

const key = name =>
  String(name || '')
    .trim()
    .toLowerCase()
    .split(':')
    .pop();
const file = () => {
  const d = dataDir();
  return d ? path.join(d, 'skill-stats.json') : '';
};

function load() {
  if (data) return data;
  try {
    data = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  if (!data || typeof data.skills !== 'object' || !data.skills)
    data = { since: Date.now(), skills: {} };

  // The table has no prototype, so a skill named `__proto__` (any folder name an agent read) is an
  // ordinary row and never reaches Object.prototype (audit app-5 #5).
  if (Object.getPrototypeOf(data.skills) !== null)
    data.skills = Object.assign(Object.create(null), data.skills);
  return data;
}

function flush() {
  clearTimeout(timer);
  timer = null;
  const f = file();
  if (!f || !data) return;
  try {
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  } catch {}
}
process.on('exit', flush); // the last counts within the save delay still land at quit

function save() {
  if (!timer) {
    timer = setTimeout(flush, 1500);
    timer.unref?.();
  }
}

function bump(name, field) {
  const k = key(name);
  if (!k) return;
  const s = load().skills[k] || (load().skills[k] = {});
  s[field] = (s[field] || 0) + 1;
  s[field + 'At'] = Date.now();
  save();
}

function pane(id) {
  let p = panes.get(id);
  if (!p)
    panes.set(
      id,
      (p = {
        offered: new Set(),
        read: new Set(),
        pending: new Set(),
        required: new Set(),
        held: false,
      })
    );
  return p;
}

// Only clear signals count; anything else (a new task, a question) says nothing about the skill. A
// correction wins over an approval ("thanks, but that's wrong").
const CORRECTED =
  /^\s*(no|nope|wrong|undo|revert)\b|\b(that'?s (not|wrong|incorrect)|not what i (asked|wanted|meant)|(doesn'?t|didn'?t|does not|did not|still not) work|still (broken|wrong|failing)|you (broke|forgot|missed|ignored)|why did you|stop doing)\b/i;
const APPROVED =
  /^\s*(yes|yep|yeah|thanks|thank you|perfect|great|nice|awesome|lgtm|looks good|works( now)?|good job)\b/i;

function verdict(prompt) {
  const t = String(prompt || '').slice(0, 2000);
  return CORRECTED.test(t) ? 'corrected' : APPROVED.test(t) ? 'approved' : '';
}

// A new user prompt: judges the skills read since the last one, then starts fresh.
function prompted(paneId, prompt) {
  const p = pane(paneId),
    v = verdict(prompt);
  if (v) for (const name of p.pending) bump(name, v);
  p.pending.clear();
  p.required.clear();
  p.held = false; // a new task: what the last one required no longer applies
}

// The finish check: skills this task was told to read — two or more
// keywords in its prompt, or it edited a file the skill owns.
function require_(paneId, names) {
  const p = pane(paneId);
  for (const n of names || []) {
    const k = key(n);
    if (k) p.required.add(k);
  }
}

// At the end of the turn: the required skills the session still has not read, once per task ([]
// afterwards, so an agent is held one time only).
function hold(paneId) {
  const p = pane(paneId);
  if (p.held) return [];
  const missing = [...p.required].filter(n => !p.read.has(n));
  if (missing.length) {
    p.held = true;
    for (const n of missing) bump(n, 'held');
  }
  return missing;
}

function offered(paneId, names) {
  const p = pane(paneId);
  for (const n of names || []) {
    p.offered.add(key(n));
    bump(n, 'suggested');
  }
}

// PostToolUse: the Skill tool, or a Read of a SKILL.md, is a read (counted once per session;
// re-reads still count toward the next verdict).
function readBy(h) {
  const input = h.tool_input || {};
  if (h.tool_name === 'Skill') return input.skill || input.name || '';
  if (h.tool_name === 'Read' && /(^|[\\/])SKILL\.md$/i.test(String(input.file_path || '')))
    return path.basename(path.dirname(String(input.file_path)));
  return '';
}

function tool(paneId, h) {
  const name = key(readBy(h));
  if (!name) return;
  const p = pane(paneId);
  if (!p.read.has(name)) {
    p.read.add(name);
    bump(name, 'read');
  }
  p.pending.add(name);
}

// Names this session already has in context (skip re-suggesting them for a prompt) and those also
// already offered (skip for a file).
const readIn = paneId => new Set(pane(paneId).read);
const known = paneId => {
  const p = pane(paneId);
  return new Set([...p.read, ...p.offered]);
};
const forget = paneId => panes.delete(paneId);

// { suggested, read, corrected, approved, *At, since } for a skill name (zeros when never seen).
function of(name) {
  const d = load();
  return {
    suggested: 0,
    read: 0,
    corrected: 0,
    approved: 0,
    ...(d.skills[key(name)] || {}),
    since: d.since,
  };
}

function init({ dir } = {}) {
  if (dir) {
    dataDir = () => dir;
    data = null;
    panes.clear();
  }
}

module.exports = {
  init,
  prompted,
  offered,
  require: require_,
  hold,
  tool,
  readIn,
  known,
  forget,
  of,
  flush,
  _test: { verdict },
};
