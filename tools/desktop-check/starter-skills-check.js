/*
 * Technically Not tools · desktop-check/starter-skills-check.js — Starter skill upkeep in
 * skill-service's seedStarters (run by listSkills), plain Node under a temp userData folder: a
 * fresh install gets every shipped starter; an unchanged older starter copy is updated to the
 * shipped text; a starter Technically Not no longer ships (low-usage-sessions, merged into
 * agent-efficiency 2026-09-25) leaves the library and the every-session list when unchanged, and
 * stays when the user changed it; the user's own skill is never touched. Usage: node
 * tools/desktop-check/starter-skills-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const STARTERS = path.join(__dirname, '..', '..', 'desktop', 'builtin-skills');
const shippedIds = fs
  .readdirSync(STARTERS, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name);

// One skill-service per userData folder (it caches that it seeded once per run).
function fresh(userData) {
  const load = Module._load,
    key = require.resolve('../../desktop/skill-service');
  delete require.cache[key];
  Module._load = (req, ...rest) =>
    req === 'electron' ? { app: { getPath: () => userData }, dialog: {} } : load(req, ...rest);
  try {
    return require(key);
  } finally {
    Module._load = load;
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-starters-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude-home');

try {
  // 1. Fresh install: no library folder yet.
  {
    const ud = path.join(tmp, 'fresh');
    fresh(ud).listSkills(null);
    const lib = path.join(ud, 'skills'),
      every = JSON.parse(fs.readFileSync(path.join(ud, 'skills-everywhere.json'), 'utf8'));
    check(
      shippedIds.every(id => fs.existsSync(path.join(lib, id, 'SKILL.md'))) &&
        shippedIds.every(id => every.on.includes(id)),
      'fresh install: every shipped starter (' + shippedIds.join(', ') + ') added and on'
    );
    check(
      !shippedIds.includes('low-usage-sessions'),
      'low-usage-sessions no longer ships (merged into agent-efficiency)'
    );
  }

  // 2. An existing library: starter records with an old shipped text, the merged starter unchanged
  // and changed, and the user's own skill.
  {
    const ud = path.join(tmp, 'existing'),
      lib = path.join(ud, 'skills');
    const starter = (id, text, hash = sha(text)) => {
      write(path.join(lib, id, 'SKILL.md'), text);
      write(
        path.join(lib, id, '.tnai-import.json'),
        JSON.stringify({
          warnings: [],
          importedAt: 1,
          updatedAt: 1,
          from: 'Technically Not starter skills',
          hash,
        })
      );
    };
    const oldAE = '---\nname: agent-efficiency\ndescription: old text\n---\n# old\n';
    starter('agent-efficiency', oldAE);
    starter(
      'low-usage-sessions',
      '---\nname: low-usage-sessions\ndescription: Keeps usage low.\n---\n# Low-usage sessions\n'
    );
    const changedText = '---\nname: failure-memory\ndescription: kept\n---\n# mine now\n';
    starter('retired-but-edited', changedText + 'User edit.\n', sha(changedText));
    write(
      path.join(lib, 'mine', 'SKILL.md'),
      "---\nname: mine\ndescription: the user's own\n---\n# mine\n"
    );
    write(
      path.join(ud, 'skills-everywhere.json'),
      JSON.stringify({
        on: ['agent-efficiency', 'low-usage-sessions', 'retired-but-edited', 'mine'],
        seeded: [...shippedIds, 'low-usage-sessions', 'retired-but-edited'],
      })
    );
    fresh(ud).listSkills(null);
    const every = JSON.parse(fs.readFileSync(path.join(ud, 'skills-everywhere.json'), 'utf8'));
    const rec = id => {
      try {
        return JSON.parse(fs.readFileSync(path.join(lib, id, '.tnai-import.json'), 'utf8'));
      } catch {
        return null;
      }
    };
    check(
      fs.readFileSync(path.join(lib, 'agent-efficiency', 'SKILL.md'), 'utf8') ===
        fs.readFileSync(path.join(STARTERS, 'agent-efficiency', 'SKILL.md'), 'utf8'),
      'unchanged older agent-efficiency updated to the shipped (merged) text'
    );
    check(
      !fs.existsSync(path.join(lib, 'low-usage-sessions')) &&
        !every.on.includes('low-usage-sessions'),
      'unchanged low-usage-sessions removed from the library and the every-session list'
    );
    check(
      fs.existsSync(path.join(lib, 'retired-but-edited', 'SKILL.md')) &&
        every.on.includes('retired-but-edited'),
      'a no-longer-shipped starter the user changed is kept'
    );
    check(
      fs.existsSync(path.join(lib, 'mine', 'SKILL.md')) &&
        !rec('mine') &&
        every.on.includes('mine'),
      "the user's own skill is untouched"
    );
  }
} catch (error) {
  check(false, 'stopped: ' + error.message);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(ok ? 'All starter skill checks passed.' : 'Starter skill checks FAILED.');
process.exit(ok ? 0 : 1);
