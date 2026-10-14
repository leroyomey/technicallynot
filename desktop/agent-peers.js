/*
 * Technically Not desktop · agent-peers.js — Live team awareness: every agent knows who else is
 * working in its project right now, on what, and whose work crosses its own, so agents started at
 * different times stay on the same page without the user relaying anything. Complements
 * agent-context.js (finished work) and file-locks.js (edits). SOURCE: the mesh roster
 * (agent-mesh.js `roster`: the names, tasks and working/waiting status `tnai agents` shows, for
 * every CLI), the file locks each agent holds (what it is editing now), and a Claude Code agent's
 * own prompt (agent-context.js `taskOf`). CROSSING (inferred, deterministic, cautious): two tasks
 * cross when they name a file in common and share a keyword, or share 3+ significant keywords. A
 * lead and its own sub-agents never count as crossing (they are one team: `family`). DELIVERY
 * (bounded, once per change):
 * - Claude Code, new prompt (UserPromptSubmit): the live team, only when it changed since this
 * agent last got it, with crossings marked; each agent whose task crosses the new one is queued a
 * short "crossing" notice.
 * - Claude Code, mid-task (PostToolUse of the main agent): queued notices at once; every SCAN_MS a
 * fresh look at the roster for newly started tasks that cross its own. Each (agent, other agent,
 * task) pair is told once.
 * - Every CLI: plain `tnai context` ends with the live team and crossings (agent-mesh.js), which
 * the work rules tell agents to run before starting. Nothing here is typed into a terminal and no
 * agent is interrupted; what agents do with it is in hidden-skills/36-live-team.md.
 */
'use strict';

// how often a working Claude Code agent re-checks the roster for new crossing tasks
const SCAN_MS = 20000;
const SHOW_MAX = 6; // agents listed in the live team

// agents quiet longer than this many minutes are left out of the live team (still in `tnai agents`)
const QUIET_MAX = 60;
const PENDING_MAX = 4; // crossing notices waiting for one agent

let deps = {
  roster: async () => [],
  locks: null,
  lifecycle: null,
  context: null,
  family: () => false,
  team: () => false,
};
const seenTeam = new Map(); // paneId -> fingerprint of the live team it last got
const told = new Map(); // receiverPane + '|' + otherPane -> the other's task it was told about
const pending = new Map(); // paneId -> [notice lines] queued by another agent's new prompt
const lastScan = new Map(); // paneId -> ms

const clip = (s, n) => {
  s = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const words = text => new Set(deps.context?.keywords ? deps.context.keywords(text, 24) : []);
const filesIn = (text, root) =>
  new Set(
    (deps.context?.mentionedFiles ? deps.context.mentionedFiles(text, root) : []).map(f =>
      f.toLowerCase()
    )
  );

function editing(project, paneId) {
  try {
    return (deps.locks?.list(project) || []).filter(h => h.paneId === paneId).map(h => h.file);
  } catch {
    return [];
  }
}

// Do two task texts cross? -> '' or a short reason.
function crossing(a, b, root, aFiles = [], bFiles = []) {
  if (!a || !b) return '';
  const wa = words(a),
    shared = [...words(b)].filter(w => wa.has(w));
  const fa = new Set([...filesIn(a, root), ...aFiles.map(f => f.toLowerCase())]);
  const sameFile = [...filesIn(b, root), ...bFiles.map(f => f.toLowerCase())].find(f => fa.has(f));
  if (sameFile && shared.length >= 1) return 'same file ' + sameFile;
  if (shared.length >= 3) return 'related: ' + shared.slice(0, 3).join(', ');
  return '';
}

function describe(r, project, why) {
  const files = editing(project, r.pane);
  return (
    '• ' +
    r.name +
    ' (' +
    r.provider +
    ', id ' +
    r.id +
    ', ' +
    r.status +
    (r.quietMin ? ', quiet ' + r.quietMin + ' min' : '') +
    ')' +
    (r.task ? ' — "' + clip(r.task, 140) + '"' : '') +
    (files.length
      ? ' | editing: ' +
        files.slice(0, 4).join(', ') +
        (files.length > 4 ? ' +' + (files.length - 4) : '')
      : '') +
    (why ? ' | CROSSES YOUR TASK (' + why + ', inferred)' : '')
  );
}

// Team mode (agent-teams.js): the user grouped this agent with others; they share file locks, so
// they must split files between them.
const TEAM_RULE =
  'You share file locks with them: you can both edit the same file, so before you edit a file a teammate may touch, agree who takes which files with one `tnai send` (say "No reply needed." when you only inform). Small edits (Edit) can run side by side; a whole-file rewrite (Write) is exclusive for 2 min, so prefer Edit on shared files. `tnai team` shows your team.';

function teamLine(paneId, list) {
  const mates = list.filter(r => safe(() => deps.team(paneId, r.pane))).map(r => r.name);
  return mates.length
    ? 'You are on a team the user set up with ' + mates.join(', ') + '. ' + TEAM_RULE
    : '';
}
const mark = (paneId, r, line) =>
  safe(() => deps.team(paneId, r.pane))
    ? line.replace('• ' + r.name + ' (', '• ' + r.name + ' (TEAMMATE, ')
    : line;

// The roster minus the caller, its own lead / sub-agents, and agents quiet for long.
function others(paneId, list) {
  return list.filter(
    r =>
      !r.you &&
      r.pane !== paneId &&
      !safe(() => deps.family(paneId, r.pane)) &&
      (r.quietMin == null || r.quietMin <= QUIET_MAX)
  );
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return false;
  }
}

function queue(pane, text) {
  const q = pending.get(pane) || [];
  q.push(text);
  while (q.length > PENDING_MAX) q.shift();
  pending.set(pane, q);
}

function myTask(paneId, roster) {
  return (
    (deps.context?.taskOf?.(paneId) || '') +
    ' ' +
    (roster?.find(r => r.pane === paneId)?.task || '')
  );
}

// Claude Code, new prompt: the live team when it changed, crossings marked, and the crossed agents
// queued a notice.
async function forPrompt(paneId, prompt) {
  const me = deps.lifecycle?.info(paneId);
  if (!me || !me.project) return '';
  const project = me.project,
    list = others(paneId, await deps.roster(project, paneId));
  if (!list.length) {
    seenTeam.delete(paneId);
    return '';
  }
  const mine = editing(project, paneId),
    lines = [];
  let crossed = 0;
  for (const r of list
    .sort((a, b) => (b.status === 'working') - (a.status === 'working'))
    .slice(0, SHOW_MAX)) {
    const why = crossing(
      prompt,
      r.task + ' ' + (deps.context?.taskOf?.(r.pane) || ''),
      project,
      mine,
      editing(project, r.pane)
    );
    if (why) {
      crossed++;
      told.set(paneId + '|' + r.pane, r.task);
      if (told.get(r.pane + '|' + paneId) !== clip(prompt, 200)) {
        told.set(r.pane + '|' + paneId, clip(prompt, 200));
        queue(
          r.pane,
          '• ' +
            (me.name || me.agent) +
            ' (' +
            me.agent +
            ', id ' +
            String(me.id).slice(0, 8) +
            ') just started: "' +
            clip(prompt, 160) +
            '" (' +
            why +
            ', inferred)'
        );
      }
    }
    lines.push(mark(paneId, r, describe(r, project, why)));
  }
  const team = teamLine(paneId, list),
    print = (team ? team + '\n' : '') + lines.join('\n');
  if (!crossed && seenTeam.get(paneId) === print) return '';
  seenTeam.set(paneId, print);
  return (
    'Technically Not live team — other agents in this project right now (live; `tnai agents` lists all). Do not redo a task another agent is on. ' +
    (crossed
      ? 'Where one CROSSES your task, agree with it who takes which files (one `tnai send`) before you edit them, and check its result against your work when it finishes.'
      : 'None crosses your task.') +
    '\n' +
    print
  );
}

// Claude Code, mid-task (main agent's PostToolUse): notices queued for it, plus (every SCAN_MS)
// newly started tasks of others that cross its own.
async function forTool(paneId) {
  const q = pending.get(paneId) || [];
  pending.delete(paneId);
  const now = Date.now(),
    scan = now - (lastScan.get(paneId) || 0) >= SCAN_MS;
  if (scan) {
    lastScan.set(paneId, now);
    const me = deps.lifecycle?.info(paneId);
    if (me?.project) {
      const all = await deps.roster(me.project, paneId),
        list = others(paneId, all),
        task = myTask(paneId, all),
        mine = editing(me.project, paneId);
      for (const r of list) {
        if (!r.task || told.get(paneId + '|' + r.pane) === r.task) continue;
        const why = crossing(
          task,
          r.task + ' ' + (deps.context?.taskOf?.(r.pane) || ''),
          me.project,
          mine,
          editing(me.project, r.pane)
        );
        told.set(paneId + '|' + r.pane, r.task);
        if (why) q.push(describe(r, me.project, why));
      }
    }
  }
  if (!q.length) return '';
  return (
    'Technically Not crossing — another agent is working on something that crosses your task (inferred from tasks and files):\n' +
    q.join('\n') +
    '\nIf you will touch the same files, agree with it who takes which (one `tnai send`, say "No reply needed." when it only informs). If your work is clearly apart, carry on; no reply.'
  );
}

// Every CLI: the end of plain `tnai context`.
async function board(paneId, project) {
  const all = await deps.roster(project, paneId),
    list = others(paneId, all);
  if (!list.length) return '';
  const mine = editing(project, paneId),
    task = myTask(paneId, all);
  const team = teamLine(paneId, list);
  return (
    '\nLive team (other agents in this project now; crossings are inferred):\n' +
    (team ? '  ' + team + '\n' : '') +
    list
      .slice(0, SHOW_MAX)
      .map(
        r =>
          '  ' +
          mark(
            paneId,
            r,
            describe(
              r,
              project,
              crossing(
                task,
                r.task + ' ' + (deps.context?.taskOf?.(r.pane) || ''),
                project,
                mine,
                editing(project, r.pane)
              )
            )
          )
      )
      .join('\n') +
    '\n'
  );
}

// The user changed this agent's team (main.js): the notice text, also queued for a Claude Code
// agent's next tool call (forTool).
function teamNotice(paneId, mates) {
  const text = mates.length
    ? 'The user put you on a team with ' + mates.join(', ') + '. ' + TEAM_RULE + ' No reply needed.'
    : 'The user took you off your team: file locks are your own again, so a file another agent edits is refused to you. No reply needed.';
  queue(paneId, '• ' + text);
  seenTeam.delete(paneId); // the next prompt gets the live team again
  return text;
}

function forget(paneId) {
  for (const m of [seenTeam, pending, lastScan]) m.delete(paneId);
  for (const k of told.keys())
    if (k.startsWith(paneId + '|') || k.endsWith('|' + paneId)) told.delete(k);
}

module.exports = {
  // deps: { roster(project, paneId) → Promise<rows as `tnai agents`>, locks (file-locks.js),
  // lifecycle, context (keywords, mentionedFiles, taskOf), family(paneA, paneB) (lead tree),
  // team(paneA, paneB) (user team) }
  init(d = {}) {
    deps = { ...deps, ...d };
  },
  async forPrompt(paneId, prompt) {
    try {
      return await forPrompt(paneId, String(prompt || ''));
    } catch (e) {
      console.warn('[tnai] live team failed:', e?.message || e);
      return '';
    }
  },
  async forTool(paneId) {
    try {
      return await forTool(paneId);
    } catch (e) {
      console.warn('[tnai] crossing check failed:', e?.message || e);
      return '';
    }
  },
  async board(paneId, project) {
    try {
      return await board(paneId, project);
    } catch {
      return '';
    }
  },
  forget,
  teamNotice,
  _test: {
    crossing,
    reset() {
      for (const m of [seenTeam, told, pending, lastScan]) m.clear();
    },
  },
};
