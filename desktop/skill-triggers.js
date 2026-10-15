/*
 * Technically Not desktop · skill-triggers.js — Keyword-matched skills: with each prompt, names the
 * project's skills (and library skills turned on for every session) whose name words or `keywords:`
 * frontmatter appear in it (a skill with "ui" in its name for a prompt about the UI), so the agent
 * reads them before starting. Claude Code gets the line through its UserPromptSubmit hook
 * (agent-hooks.js); every CLI also gets the same rule as a hidden skill
 * (hidden-skills/15-skill-keywords.md). A skill's `paths:` globs name the files it owns: when a
 * Claude Code session reads or edits one of them, forFile offers that skill after the tool call (so
 * an Edit, which needs a Read first, gets it before the change). Plain Node (no Electron).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SKILL_DIRS = ['.claude/skills', '.agents/skills', '.codex/skills'];
const MAX = 3; // most skills named per prompt, best matches first

// Name words too common in prompts to mean anything alone ("tnai-agent-orchestration" must not
// match every prompt that says "agent").
const STOP = new Set([
  'tnai',
  'tnai',
  'agent',
  'agents',
  'new',
  'best',
  'practices',
  'self',
  'development',
  'code',
  'organization',
  'the',
  'and',
  'for',
  'skill',
  'skills',
  'build',
  'desktop',
  'modern',
  'web',
  'project',
  'setup',
  // 2026-10-01, from skill-stats: these name words alone offered a skill hundreds of times that no
  // session then read. Every skill keeps at least one name word or keyword that can still match
  // ("split", "durable" stay).
  'file',
  'repository',
  'safe',
  'data',
  'design',
  'start',
  'cold',
  'media',
  'issue',
  'watch',
  // 2026-10-14, skills audit: everyday words in skill names ("what's open before the release" named
  // tnai-open-source, "the work is done" tnai-cloud-work). Those skills keep their keywords
  // ("open source", "cloud session", "public copy") and one other name word.
  'open',
  'source',
  'work',
  'copy',
  // Same audit: name words that offered a skill on everyday sentences ("run the window test",
  // "the app is slow", "one more thing, look at the layout", "deploy the website"). Each of these
  // skills keeps phrase keywords that still match ("bench test", "mock of the app", "css layout").
  'test',
  'run',
  'app',
  'one',
  'look',
  'layout',
  'css',
  'deploy',
  'performance',
  // tnai-bug-sweep's name words fired on "fix this bug"; it keeps "bug sweep" and its phrases.
  'bug',
  'sweep',
]);
const cache = new Map(); // SKILL.md path -> { mtime, skill }

// Top-level `key: value` frontmatter; indented lines continue the previous value (folded `>-`
// descriptions), and so do `- item` lines of a YAML list, which may start at the first column.
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text).replace(/^﻿/, '')),
    meta = {};
  let key = '';
  if (m)
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
      if (kv) {
        key = kv[1].toLowerCase();
        meta[key] = /^[>|][+-]?$/.test(kv[2].trim())
          ? ''
          : kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
      } else if (key && /^(\s+\S|-\s)/.test(line))
        meta[key] = (meta[key] + ' ' + line.trim()).trim();
    }
  return meta;
}

// The items of a frontmatter list, in any of its forms: `[a, b]`, `a, b`, or one `- a` per line
// (frontmatter() joins those lines into "- a - b"). A multi-word keyword keeps its inner spaces.
function listItems(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .split(/,|\s+-\s+/)
    .map(item =>
      item
        .trim()
        .replace(/^-\s*/, '')
        .replace(/^(['"])(.*)\1$/, '$2')
    )
    .filter(Boolean);
}

function readSkill(file) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === st.mtimeMs) return hit.skill;
  let skill = null;
  try {
    const meta = frontmatter(fs.readFileSync(file, 'utf8'));
    if (String(meta['tnai-hidden'] || '').toLowerCase() !== 'true') {
      const name = meta.name || path.basename(path.dirname(file));
      const terms = new Set(
        name
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(w => w.length > 1 && !STOP.has(w))
      );
      for (const k of listItems(meta.keywords)) terms.add(k.toLowerCase());
      const globs = listItems(meta.paths);
      skill = {
        name,
        description: String(meta.description || '').slice(0, 240),
        file,
        terms: [...terms],
        paths: globs.map(globRegex),
      };
    }
  } catch {}
  cache.set(file, { mtime: st.mtimeMs, skill });
  return skill;
}

// `src/styles/**` -> any file under src/styles; `*` stays inside one folder; a bare folder
// (`tools/`) means everything under it. Case-insensitive (Windows paths).
function globRegex(glob) {
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '/**');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i++;
      if (g[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

function projectSkills(root) {
  if (!root) return [];
  return SKILL_DIRS.flatMap(rel => {
    const dir = path.join(root, rel);
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() || e.isSymbolicLink())
        .map(e => readSkill(path.join(dir, e.name, 'SKILL.md')))
        .filter(Boolean);
    } catch {
      return [];
    }
  });
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term matches as a whole word ("ui" in "the UI", not in "build"); a multi-word term matches as a
// phrase.
const hits = (text, terms) =>
  terms.filter(t => new RegExp('(^|[^a-z0-9])' + escape(t) + '($|[^a-z0-9])', 'i').test(text));

// The project's skills as last scanned, for the file hook only (forFile): every Read/Edit/Write of
// a Claude Code session asks twice, and each scan lists three folders and stats every skill
// (measured 2026-10-05: 2.1 ms per tool call with 37 skills, on a quiet PC). Kept until a skill
// file changes (changed(): the project watcher's batches through agent-hooks.js, and forFile itself
// when the file is a SKILL.md), and for at most SCAN_MS in case no watcher runs. A prompt (match)
// always scans anew.
const SCAN_MS = 2000;
let scan = null; // { root, at, list }

function projectSkillsKept(root) {
  if (!scan || scan.root !== root || Date.now() - scan.at > SCAN_MS)
    scan = { root, at: Date.now(), list: projectSkills(root) };
  return scan.list;
}

// The watcher's batch (paths relative to the project), or nothing: a skill file may have changed,
// so the next file hook scans again.
function changed(batch) {
  if (
    !Array.isArray(batch) ||
    batch.many ||
    batch.some(c => /(^|[\\/])skills([\\/]|$)/i.test(String(c?.path || '')))
  )
    scan = null;
}

// Extra SKILL.md paths (library skills on for every session, skill-service.js); a project skill of
// the same name wins.
function allSkills(root, extraFiles, kept) {
  const seen = new Set();
  return [
    ...(kept ? projectSkillsKept(root) : projectSkills(root)),
    ...(extraFiles || []).map(readSkill).filter(Boolean),
  ].filter(s => !seen.has(s.name) && seen.add(s.name));
}

// Matching skills for a prompt: [{ name, description, file, matched: [terms] }], most matched terms
// first. `skip`: names already read this session (in context already). Only the user's own words
// are matched. Left out: Technically Not's own notices to an agent ("[from Technically Not] FILE
// changed on disk…" named a marketing skill for a file path), the attachment labels the app adds
// ("[Image #1]", "[Image: source: PATH]": every screenshot named the website-speed skill for its
// keyword "image", 2026-10-02) and pasted addresses ("https" named the deploy skill).
function userWords(prompt) {
  const text = String(prompt || '').slice(0, 8000);
  if (/^\s*(\[TN\.ai\]\s*|\[TechnicallyNot\.ai\]\s*)?\[from Technically Not\]/.test(text))
    return '';
  return text
    .replace(/\[Image #\d+\]/g, ' ')
    .replace(/\[(?:Image: source|Attached image):[^\]\n]*\]/g, ' ')
    .replace(/\bhttps?:\/\/\S+/gi, ' ');
}

// One word in two forms ("image" and "images", both keywords of one skill) is one hit, so a single
// common word cannot make a skill required.
const distinct = terms => {
  const seen = new Set();
  return terms.filter(t => {
    const k = t.replace(/s$/, '');
    return !seen.has(k) && seen.add(k);
  });
};

function match(prompt, root, extraFiles, skip) {
  const text = userWords(prompt);
  if (!text.trim()) return [];
  return allSkills(root, extraFiles)
    .filter(s => !skip?.has(s.name.toLowerCase()))
    .map(s => ({ ...s, matched: distinct(hits(text, s.terms)) }))
    .filter(s => s.matched.length)
    .sort((a, b) => b.matched.length - a.matched.length || a.name.localeCompare(b.name))
    .slice(0, MAX);
}

// Project skills show relative to the project; library skills live outside it, so they show their
// full path.
const shown = (root, file) => {
  const rel = root ? path.relative(root, file) : '';
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file).replace(/\\/g, '/');
};

// The additionalContext text for Claude Code's UserPromptSubmit hook ('' when nothing matches).
function forPrompt(prompt, root, extraFiles, skip) {
  return forPromptWith(prompt, root, extraFiles, skip).text;
}

// { text, names }: the hook text and the skills it named (counted as suggested in skill-stats.js).
function forPromptWith(prompt, root, extraFiles, skip) {
  const found = match(prompt, root, extraFiles, skip);
  if (!found.length) return { text: '', names: [], strong: [] };

  // A single keyword hit is often a common word ("file", "domain"), so only skills with 2+ hits are
  // to be read up front; the rest are read only if their description fits the task (reading an
  // unneeded skill costs its size again on every later request of the session).
  const line = s =>
    '  - ' +
    s.name +
    ' (matched: ' +
    s.matched.join(', ') +
    ') — ' +
    s.description +
    ' [' +
    shown(root, s.file) +
    ']';
  const strong = found.filter(s => s.matched.length >= 2),
    weak = found.filter(s => s.matched.length < 2);
  return {
    names: found.map(s => s.name),
    strong: strong.map(s => s.name),
    text: [
      // strong: the ones the finish check requires (skill-stats.js)
      strong.length
        ? 'Skills that match this prompt (2+ keywords). Read each one before you start, and follow it (Skill tool, or the file):\n' +
          strong.map(line).join('\n')
        : '',
      weak.length
        ? 'Skills that may match this prompt (one keyword). Read one only if its description fits the task; otherwise skip it:\n' +
          weak.map(line).join('\n')
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

// { text, names } for a file the session just read or edited: skills whose `paths:` globs own it,
// minus `skip` (already offered or read this session).
function forFile(file, root, extraFiles, skip) {
  const rel =
    root && file ? path.relative(root, path.resolve(root, String(file))).replace(/\\/g, '/') : '';
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { text: '', names: [] };
  if (/(^|\/)SKILL\.md$/i.test(rel)) changed(); // the session may just have written this skill
  const found = allSkills(root, extraFiles, true)
    .filter(s => !skip?.has(s.name.toLowerCase()) && s.paths.some(re => re.test(rel)))
    .slice(0, MAX);
  if (!found.length) return { text: '', names: [] };
  const many = found.length > 1;
  return {
    names: found.map(s => s.name),
    text:
      (many ? 'Skills that own ' : 'Skill that owns ') +
      rel +
      '. Read ' +
      (many ? 'them' : 'it') +
      ' before you change this file, and follow ' +
      (many ? 'them' : 'it') +
      ' (Skill tool, or the file):\n' +
      found
        .map(s => '  - ' + s.name + ' — ' + s.description + ' [' + shown(root, s.file) + ']')
        .join('\n'),
  };
}

module.exports = {
  match,
  forPrompt,
  forPromptWith,
  forFile,
  changed,
  _test: { frontmatter, hits, globRegex },
};
