/*
 * Technically Not desktop · agent-tasks.js — `tnai tasks [list] | add TEXT | take ID | release ID |
 * done ID` (agent-mesh.js): a shared to-do board per project, so agents split work without messages
 * back and forth. Saved per project in userData/agent-tasks/<hash>.json (survives restarts); a task
 * is owned by the agent's conversation (instance id), so a revived agent keeps its tasks. Done
 * tasks are kept 7 days, then dropped.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEXT_MAX = 300,
  OPEN_MAX = 200,
  DONE_KEEP_MS = 7 * 24 * 3600 * 1000;
let dir = '';

const fileOf = project =>
  path.join(
    dir,
    crypto
      .createHash('sha1')
      .update(path.resolve(project).toLowerCase())
      .digest('hex')
      .slice(0, 16) + '.json'
  );

function load(project) {
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(fileOf(project), 'utf8'));
  } catch {}
  const tasks = Array.isArray(data?.tasks)
    ? data.tasks.filter(t => t && Number.isInteger(t.id) && typeof t.text === 'string')
    : [];
  return {
    next: Number.isInteger(data?.next)
      ? data.next
      : tasks.reduce((n, t) => Math.max(n, t.id + 1), 1),
    tasks: tasks.filter(t => !t.doneAt || Date.now() - t.doneAt < DONE_KEEP_MS),
  };
}

function save(project, data) {
  fs.mkdirSync(dir, { recursive: true });
  const file = fileOf(project),
    tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ project, ...data }));
  fs.renameSync(tmp, file);
}

const idOf = raw => Number(String(raw || '').replace(/^#/, '')) | 0;

// me: { instance, name } of the caller; liveNames(): instance -> current name of agents running in
// the project.
function run(project, me, args, liveNames) {
  const [action = 'list', ...rest] = args;
  const data = load(project),
    live = liveNames();
  const who = t =>
    t.by ? (live.get(t.by) || t.byName) + (live.has(t.by) ? '' : ' (not running)') : '';
  if (action === 'list') {
    const open = data.tasks.filter(t => !t.doneAt);
    if (!open.length)
      return { ok: true, text: 'No open tasks in this project. `tnai tasks add TEXT` adds one.' };
    return {
      ok: true,
      text:
        'Open tasks (' +
        open.length +
        '):\n' +
        open
          .map(t => '  #' + t.id + '  ' + (t.by ? '[' + who(t) + '] ' : '[free] ') + t.text)
          .join('\n'),
    };
  }
  if (action === 'add') {
    const text = rest.join(' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);
    if (!text) return { ok: false, error: 'Nothing to add: tnai tasks add TEXT.' };
    if (data.tasks.filter(t => !t.doneAt).length >= OPEN_MAX)
      return {
        ok: false,
        error: 'This project already has ' + OPEN_MAX + ' open tasks; finish or remove some first.',
      };
    const t = { id: data.next++, text, addedBy: me.name, at: Date.now() };
    data.tasks.push(t);
    save(project, data);
    return { ok: true, text: 'Added #' + t.id + '.' };
  }
  const t = data.tasks.find(x => x.id === idOf(rest[0]));
  if (!['take', 'release', 'done'].includes(action))
    return {
      ok: false,
      error: 'Use tnai tasks [list] | add TEXT | take ID | release ID | done ID.',
    };
  if (!t)
    return {
      ok: false,
      error: 'No task #' + idOf(rest[0]) + ' here. `tnai tasks` lists the open ones.',
    };
  if (t.doneAt) return { ok: false, error: '#' + t.id + ' is already done.' };
  const mine = t.by === me.instance,
    othersLive = t.by && !mine && live.has(t.by);
  if (action === 'take') {
    if (mine) return { ok: true, text: 'You already have #' + t.id + '.' };
    if (othersLive)
      return {
        ok: false,
        error: '#' + t.id + ' is taken by ' + who(t) + '. Pick a free task or ask it.',
      };
    Object.assign(t, { by: me.instance, byName: me.name, takenAt: Date.now() });
    save(project, data);
    return { ok: true, text: 'You have #' + t.id + ': ' + t.text };
  }
  if (othersLive) return { ok: false, error: '#' + t.id + ' belongs to ' + who(t) + '.' };
  if (action === 'release') {
    delete t.by;
    delete t.byName;
    delete t.takenAt;
    save(project, data);
    return { ok: true, text: '#' + t.id + ' is free again.' };
  }
  Object.assign(t, { doneAt: Date.now(), doneBy: me.name });
  save(project, data);
  return { ok: true, text: 'Done #' + t.id + '.' };
}

module.exports = {
  init(folder) {
    dir = folder;
  },
  run,
};
