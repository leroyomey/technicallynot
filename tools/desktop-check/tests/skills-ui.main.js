/*
 * Technically Not tools · desktop-check/tests/skills-ui.main.js — Before the window loads: an old
 * unchanged Technically Not copy of the starter skill `ground-truth` in the library (no hash, as
 * older Technically Not versions seeded it; Technically Not must update it) and a user-edited
 * starter copy of `failure-memory` (hash mismatch; Technically Not must keep it), both on for every
 * session. TNAI_MAIN launch() returns the skills in the every-session plugin a Claude Code session
 * on an extra account would load (the user's own Claude skills come from a temp CLAUDE_CONFIG_DIR
 * standing in for ~/.claude, never the real one).
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = (win, profile) => {
  const data = path.join(profile, 'user-data'),
    legacy = path.join(data, 'skills', 'ground-truth');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(
    path.join(legacy, 'SKILL.md'),
    '---\nname: ground-truth\ndescription: Old starter copy.\n---\nOld text.\n'
  );
  fs.writeFileSync(
    path.join(legacy, '.tnai-import.json'),
    JSON.stringify({ warnings: [], importedAt: 1, from: 'Technically Not starter skills' })
  );
  const edited = path.join(data, 'skills', 'failure-memory');
  fs.mkdirSync(edited, { recursive: true });
  fs.writeFileSync(
    path.join(edited, 'SKILL.md'),
    '---\nname: failure-memory\ndescription: Edited by the user.\n---\nUser edit.\n'
  );
  fs.writeFileSync(
    path.join(edited, '.tnai-import.json'),
    JSON.stringify({
      warnings: [],
      importedAt: 1,
      from: 'Technically Not starter skills',
      hash: 'hash-of-the-shipped-text',
    })
  );
  fs.writeFileSync(
    path.join(data, 'skills-everywhere.json'),
    JSON.stringify({
      on: ['ground-truth', 'failure-memory'],
      seeded: ['ground-truth', 'failure-memory'],
    })
  );
  const home = path.join(profile, 'claude-home'),
    mine = path.join(home, 'skills', 'my-own-skill');
  fs.mkdirSync(mine, { recursive: true });
  fs.writeFileSync(
    path.join(mine, 'SKILL.md'),
    '---\nname: my-own-skill\ndescription: A skill the user keeps in ~/.claude/skills.\n---\nHi.\n'
  );
  process.env.CLAUDE_CONFIG_DIR = home;
  const emptyConfig = path.join(profile, 'empty-claude-config');
  fs.mkdirSync(emptyConfig, { recursive: true });
  return {
    // What `tnai skill save PATH` does in main (agent-mesh.js → saveAgentSkill): a skill an agent
    // wrote, saved into the library.
    agentSave: name => {
      const dir = path.join(profile, 'agent-skill-src', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        '---\nname: ' +
          name +
          '\ndescription: Xylophone tuning steps an agent wrote down.\nkeywords: xylophone, tuning\n---\nTune it.\n'
      );
      const s = require('../../../desktop/skill-service.js').saveAgentSkill(dir, '', '', {
        distinct: true,
      });
      return { id: s.id, everywhere: s.everywhere, replaced: !!s.replaced };
    },
    launch: async () => {
      const opts = await require('../../../desktop/skill-service.js').launchOptions(
        '',
        'Claude Code',
        emptyConfig
      );
      const dir = opts.pluginDirs?.[0];
      return dir
        ? fs.readdirSync(path.join(dir, 'skills')).map(id => ({
            id,
            text: fs.readFileSync(path.join(dir, 'skills', id, 'SKILL.md'), 'utf8').slice(0, 400),
          }))
        : [];
    },
  };
};
