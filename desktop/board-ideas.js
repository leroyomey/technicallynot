// Technically Not desktop · board-ideas.js — the ideas of the Board page's Up next column
// (src/scripts/157-board-page.js): short lines the user types for work no agent has yet, kept per
// project folder in <userData>/board-ideas.json.
//
// - Written atomically; every save first copies the last good file to board-ideas.backup.json. A
//   file that no longer parses is moved aside as board-ideas.broken-<time>.json and the backup is
//   read instead; a file that exists but cannot be read makes saves refuse, so nothing is lost.
// - Only folders the user has as projects are asked about (main.js checks that before a call).
// Tested by tools/board-test.js.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'board-ideas.json';
const BACKUP = 'board-ideas.backup.json';
const TEXT_MAX = 2000;
const PER_PROJECT = 100;

// One key per folder, the same however its path was written.
const keyOf = folder => path.resolve(String(folder || '')).toLowerCase();

const clean = value =>
  String(value ?? '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);

function parse(body) {
  const data = JSON.parse(body);
  const projects = data && typeof data === 'object' ? data.projects : null;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects))
    throw new Error('not a board ideas file');
  const out = {};
  for (const [key, list] of Object.entries(projects)) {
    if (!Array.isArray(list)) continue;
    out[key] = list
      .filter(idea => idea && typeof idea.id === 'string' && /^[\w-]{1,80}$/.test(idea.id))
      .map(idea => ({ id: idea.id, text: clean(idea.text), at: Number(idea.at) || 0 }))
      .filter(idea => idea.text)
      .slice(0, PER_PROJECT);
  }
  return out;
}

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
}

// dir: the folder the file lives in (userData). now(): the time (tests set it).
function createIdeas(dir, now = () => Date.now()) {
  const file = path.join(dir, FILE);
  const backup = path.join(dir, BACKUP);
  let projects = {};
  let readable = true;
  let loaded = false;

  function readBackup() {
    try {
      return parse(fs.readFileSync(backup, 'utf8'));
    } catch {
      return {};
    }
  }

  function load() {
    loaded = true;
    let body;
    try {
      body = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      projects = readBackup();
      readable = false;
      return;
    }
    try {
      projects = parse(body);
    } catch {
      const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
      try {
        fs.renameSync(file, path.join(dir, 'board-ideas.broken-' + stamp + '.json'));
      } catch {
        readable = false;
      }
      projects = readBackup();
    }
  }

  function save() {
    if (!readable) return false;
    try {
      parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, backup);
    } catch {
      // no good file yet: nothing to back up
    }
    try {
      writeAtomic(file, JSON.stringify({ version: 1, projects }, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  const ready = () => {
    if (!loaded) load();
  };

  return {
    list(folder) {
      ready();
      return (projects[keyOf(folder)] || []).slice();
    },
    add(folder, words) {
      ready();
      const textNow = clean(words);
      if (!textNow) return { ok: false, error: 'Write the idea first.' };
      const key = keyOf(folder);
      const list = projects[key] || [];
      if (list.length >= PER_PROJECT)
        return { ok: false, error: 'At most ' + PER_PROJECT + ' ideas per project.' };
      const idea = { id: crypto.randomUUID(), text: textNow, at: now() };
      projects[key] = [idea, ...list];
      if (!save()) {
        projects[key] = list;
        return { ok: false, error: 'Could not save the idea.' };
      }
      return { ok: true, idea };
    },
    remove(folder, id) {
      ready();
      const key = keyOf(folder);
      const list = projects[key] || [];
      const left = list.filter(idea => idea.id !== String(id));
      if (left.length === list.length) return { ok: true };
      projects[key] = left;
      if (!left.length) delete projects[key];
      if (!save()) {
        projects[key] = list;
        return { ok: false, error: 'Could not delete the idea.' };
      }
      return { ok: true };
    },
  };
}

module.exports = { createIdeas, PER_PROJECT, TEXT_MAX };
