// Technically Not desktop · hidden-skills.js — Technically Not's program skills
// (desktop/hidden-skills/*.md, see its README): read once when the main process starts, handed to
// every agent CLI by agent-hooks.js, never listed to the user. Plain Node (no Electron), so
// tools/check-syntax.js loads it too.
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'hidden-skills');
const TARGETS = new Set(['every-agent', 'claude-code', 'opencode', 'codex']);

// [{ id, for, lines }] in file-name order. Throws on a missing folder, an unknown `for`, or a file
// without `tnai-hidden: true`: a broken build must not start agents without Technically Not's
// rules.
function load() {
  const skills = [];
  for (const file of fs
    .readdirSync(DIR)
    .filter(f => /\.md$/i.test(f) && f.toLowerCase() !== 'readme.md')
    .sort()) {
    const src = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
    const meta = {};
    if (m)
      for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([\w-]+):\s*(.*)$/.exec(line);
        if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
      }
    if (meta['tnai-hidden'] !== 'true')
      throw new Error('hidden-skills/' + file + ': needs `tnai-hidden: true` in its frontmatter');
    if (!TARGETS.has(meta.for))
      throw new Error(
        'hidden-skills/' + file + ': `for` must be every-agent, claude-code, opencode or codex'
      );
    const lines = src
      .slice(m[0].length)
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(Boolean);
    if (!lines.length) throw new Error('hidden-skills/' + file + ': empty');
    skills.push({
      id: meta.name || file.replace(/^\d+-|\.md$/gi, ''),
      for: meta.for,
      when: meta.when || '',
      lines,
    });
  }
  if (!skills.some(s => s.for === 'every-agent'))
    throw new Error('hidden-skills: no every-agent skill found in ' + DIR);
  return skills;
}
const skills = load();

// The instruction lines for one target, with {{name}} placeholders filled from vars (an unknown one
// throws). A skill with `when: <flag>` in its frontmatter is left out unless on[flag] is true (a
// user setting, e.g. write-skills).
function lines(target, vars = {}, on = {}) {
  return skills
    .filter(s => s.for === target && (!s.when || on[s.when] === true))
    .flatMap(s => s.lines)
    .map(l =>
      l.replace(/\{\{([\w-]+)\}\}/g, (_, k) => {
        if (!(k in vars)) throw new Error('hidden-skills: unknown placeholder {{' + k + '}}');
        return vars[k];
      })
    );
}

// True for skill frontmatter (lower-case keys) that marks one of these: skill-service.js never
// lists or imports it.
const isHidden = meta =>
  String(meta?.['tnai-hidden'] || '')
    .trim()
    .toLowerCase() === 'true';

module.exports = { ids: skills.map(s => s.id), lines, isHidden };
