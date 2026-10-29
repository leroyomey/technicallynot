// Technically Not desktop · prompt-library.js — the prompt and workflow library: prompts the user
// saved by name, and recipes (an ordered list of steps, each sent to the same thread when the step
// before it ended). The window side, the recipe runner and every screen are
// src/scripts/194-prompt-library.js; this file only keeps the list.
//
// - Kept in <userData>/prompt-library.json, written atomically. Every save first copies the last
//   good file to prompt-library.backup.json; a file that no longer parses is moved aside as
//   prompt-library.broken-<time>.json and the backup is read instead; a file that exists but
//   cannot be read makes saves refuse, so nothing is lost (the same rules as prompt-schedules.js).
// - Every field the window sends is checked again here: names are one line and unique (ignoring
//   case), texts and steps have a size cap, and a recipe step may not be a lone slash command,
//   because Technically Not cannot tell when a CLI's own command ends.
// - Each change is pushed to the window as `library:state`.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'prompt-library.json';
const BACKUP = 'prompt-library.backup.json';

const NAME_MAX = 60;
const TEXT_MAX = 20000;
const MIN_STEPS = 2;
const MAX_STEPS = 20;
const MAX_ITEMS = 200;
const KINDS = ['prompt', 'recipe'];

// A prompt that is one slash command (/model, /compact …), as the prompt box tells it (11).
const SLASH_ONLY = /^\/[\w:-]+(?:[ \t][^\n]*)?$/;

const text = (value, max) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .slice(0, max);
const oneLine = (value, max) =>
  text(value, max * 2)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// ---------------------------------------------------------------- one item

// The item as it may be kept, or null when it cannot be one (used for the file and for saves).
function fromFile(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : '';
  const id = oneLine(raw.id, 40);
  const name = oneLine(raw.name, NAME_MAX);
  if (!kind || !id || !name) return null;
  const item = { id, kind, name, updatedAt: Number(raw.updatedAt) || 0 };
  if (kind === 'prompt') {
    item.text = text(raw.text, TEXT_MAX).trim();
    if (!item.text) return null;
  } else {
    const steps = Array.isArray(raw.steps) ? raw.steps : [];
    item.steps = steps
      .map(step => text(step, TEXT_MAX).trim())
      .filter(Boolean)
      .slice(0, MAX_STEPS);
    if (!item.steps.length) return null;
  }
  return item;
}

// What is wrong with an item the window asks to save, in the user's words; '' when it is fine.
// `others` are the items already kept (the one being edited left out).
function problem(raw, others) {
  const kind = raw?.kind;
  if (!KINDS.includes(kind)) return 'Choose a prompt or a recipe.';
  const name = oneLine(raw.name, NAME_MAX + 1);
  if (!name) return 'Give it a name.';
  if (name.length > NAME_MAX) return 'Keep the name under ' + NAME_MAX + ' characters.';
  const lower = name.toLowerCase();
  if (others.some(other => other.name.toLowerCase() === lower))
    return 'You already have one named "' + name + '".';
  if (kind === 'prompt') {
    const body = String(raw.text ?? '').trim();
    if (!body) return 'Write the prompt.';
    if (body.length > TEXT_MAX) return 'The prompt is longer than ' + TEXT_MAX + ' characters.';
    return '';
  }
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .map(step => String(step ?? '').trim())
    .filter(Boolean);
  if (steps.length < MIN_STEPS)
    return 'A recipe has two or more steps. One step is a saved prompt.';
  if (steps.length > MAX_STEPS) return 'A recipe has at most ' + MAX_STEPS + ' steps.';
  const long = steps.findIndex(step => step.length > TEXT_MAX);
  if (long >= 0) return 'Step ' + (long + 1) + ' is longer than ' + TEXT_MAX + ' characters.';
  const slash = steps.findIndex(step => SLASH_ONLY.test(step));
  if (slash >= 0)
    return (
      'Step ' +
      (slash + 1) +
      ' is a slash command. A recipe cannot tell when a command ends, so each step is a task.'
    );
  return '';
}

// ---------------------------------------------------------------- the saved file

function writeAtomic(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, body);
  fs.renameSync(temp, file);
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function parseList(body) {
  const data = JSON.parse(body);
  const list = Array.isArray(data) ? data : data?.items;
  if (!Array.isArray(list)) throw new Error('not a list of saved prompts');
  return list.map(fromFile).filter(Boolean).slice(0, MAX_ITEMS);
}

// { list, ok, error? }: ok false means the file is there but could not be read, so saves refuse.
function readFile(dir) {
  const file = path.join(dir, FILE);
  const readBackup = () => {
    try {
      return parseList(fs.readFileSync(path.join(dir, BACKUP), 'utf8'));
    } catch {
      return null;
    }
  };
  let body;
  try {
    body = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { list: [], ok: true };
    return {
      list: readBackup() || [],
      ok: false,
      error: 'Could not read your saved prompts (' + (error.code || error.message) + ').',
    };
  }
  try {
    return { list: parseList(body), ok: true };
  } catch {
    // Broken: kept aside for the user, and the last good copy is read instead.
    try {
      fs.renameSync(file, path.join(dir, 'prompt-library.broken-' + stamp() + '.json'));
    } catch {
      return { list: readBackup() || [], ok: false, error: 'Your saved prompts file is broken.' };
    }
    return { list: readBackup() || [], ok: true, recovered: true };
  }
}

function writeFile(dir, list) {
  const file = path.join(dir, FILE);

  // The last good file becomes the backup before it is replaced.
  try {
    parseList(fs.readFileSync(file, 'utf8'));
    fs.copyFileSync(file, path.join(dir, BACKUP));
  } catch {
    // no good file yet: nothing to back up
  }
  writeAtomic(file, JSON.stringify({ version: 1, items: list }, null, 2));
}

// ---------------------------------------------------------------- the library

// deps: { dir: the folder the file lives in (userData), send(channel, payload): to the window,
// now(): the time (tests set it) }
function createLibrary(deps) {
  const now = deps.now || (() => Date.now());
  let list = null;
  let readable = true;
  let loadError = '';

  function load() {
    if (list) return;
    const read = readFile(deps.dir);
    list = read.list;
    readable = read.ok;
    loadError = read.error || '';
  }

  function view() {
    load();
    return {
      ok: true,
      items: list.map(item => ({ ...item, steps: item.steps ? item.steps.slice() : undefined })),
      ...(loadError ? { error: loadError } : {}),
    };
  }

  function push() {
    try {
      deps.send?.('library:state', view());
    } catch {
      // the window is gone: it reads the list again when it opens
    }
  }

  function store(next) {
    if (!readable) return loadError || 'Your saved prompts could not be read, so nothing is saved.';
    try {
      writeFile(deps.dir, next);
    } catch (error) {
      return 'Could not save (' + (error.code || error.message) + ').';
    }
    list = next;
    push();
    return '';
  }

  function save(raw) {
    load();
    const id = oneLine(raw?.id, 40);
    const old = id ? list.find(item => item.id === id) : null;
    if (id && !old) return { ok: false, error: 'That saved prompt is gone.' };
    const others = list.filter(item => item !== old);
    const wrong = problem(raw, others);
    if (wrong) return { ok: false, error: wrong };
    if (!old && list.length >= MAX_ITEMS)
      return { ok: false, error: 'You have ' + MAX_ITEMS + ' saved. Delete one first.' };
    const item = fromFile({
      ...raw,
      id: old ? old.id : crypto.randomUUID(),
      updatedAt: now(),
    });
    if (!item) return { ok: false, error: 'Could not save it.' };
    const next = old ? list.map(one => (one === old ? item : one)) : [...list, item];
    const failed = store(next);
    return failed ? { ok: false, error: failed } : { ok: true, item };
  }

  function remove(id) {
    load();
    const key = oneLine(id, 40);
    if (!list.some(item => item.id === key)) return { ok: true, gone: true };
    const failed = store(list.filter(item => item.id !== key));
    return failed ? { ok: false, error: failed } : { ok: true };
  }

  return { view, save, remove };
}

module.exports = {
  createLibrary,
  fromFile,
  problem,
  readFile,
  writeFile,
  SLASH_ONLY,
  NAME_MAX,
  TEXT_MAX,
  MAX_STEPS,
};
