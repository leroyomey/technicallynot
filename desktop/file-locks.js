/*
 * Technically Not · desktop/file-locks.js — One agent edits a file at a time. A lock is per project
 * + file (path relative to the project root, lowercased on Windows) and owned by one terminal
 * panel. Claude Code takes it automatically before Edit/Write (agent-hooks.js PreToolUse, a refused
 * edit is denied); other CLIs take it with `tnai lock FILE...` (agent-mesh.js; cooperative).
 * Released by `tnai unlock`, the holder's task ending (taskEnded), the panel exiting or closing, or
 * LOCK_MS after the holder's last edit of that file. The same lead tree (deps.family) shares locks;
 * shared ledgers every agent appends to are exempt. Team mode (agent-teams.js): agents the user
 * grouped share locks too (deps.team), except a whole-file rewrite, exclusive for WHOLE_MS; the
 * same holds between separate panels of one lead tree (deps.tree: a lead and its Technically Not
 * sub-agents), whose edits would otherwise overwrite each other. A refusal tells the holder once
 * per file + requester every ALERT_MS (deps.notify), so agents talk instead of overwriting each
 * other. Shell-command edits (sed, scripts) skip the edit hook, so they are caught after the fact
 * (inferred from timing): agent-hooks.js reports each Claude Code Bash/PowerShell call
 * (shellStart/shellEnd) and the project watcher's changes arrive in diskChanges(). A held file that
 * changes while another agent's shell command runs tells both agents; one the holder didn't change
 * itself tells the holder; a free file changed while exactly one agent's (lead tree's) shell
 * command runs is locked to that agent. Only content edits count (edited()): reads, attribute
 * marks, temp files, folders and git-ignored files (generated output, ignoredFiles()) never do.
 * Main process only.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LOCK_MS = 20 * 60e3,
  ALERT_MS = 10 * 60e3,
  WHOLE_MS = 2 * 60e3; // WHOLE_MS: a whole-file rewrite stays exclusive inside a team
const SHELL_MS = 120e3,
  SHELL_MAX_MS = 10 * 60e3,
  SETTLE_MS = 1500,
  // Bash's default/max timeout; late watcher events; the holder's own edit landing
  OWN_EDIT_MS = 5000;

// paneId → { owner: { paneId, name, provider, project }, runs: Map(tool use id → until), ended }
const shells = new Map();
const EXEMPT = new Set([
  'docs/release_queue.md',
  'docs/issues.md',
  'docs/suggestions.md',
  'docs/current_state.md',
]);
const locks = new Map(); // project key → Map(rel key → { file, paneId, name, provider, at, last })
const alerted = new Map(); // project key + file + requester paneId → last alert time
let send = () => {},
  deps = {};

const now = () => (deps.now ? deps.now() : Date.now());

// Windows and macOS disks ignore case by default, so `Src/App.js` and `src/app.js` are one file and
// one lock there (app-3 #13). Linux disks tell them apart.
const CASE_BLIND = process.platform === 'win32' || process.platform === 'darwin';
const fold = s => (CASE_BLIND ? s.toLowerCase() : s);
const projectKey = project => fold(path.resolve(String(project || '')));

// The file relative to the project with forward slashes, or '' when it is outside the project.
function rel(project, file) {
  const root = path.resolve(String(project || '')),
    abs = path.resolve(root, String(file || ''));
  const r = path.relative(root, abs);
  return !r || r === '..' || r.startsWith('..' + path.sep) || path.isAbsolute(r)
    ? ''
    : r.split(path.sep).join('/');
}
const exempt = (project, file) => EXEMPT.has(rel(project, file).toLowerCase());
const ago = t => {
  const m = Math.round((now() - t) / 60e3);
  return m < 1 ? 'just now' : m + ' min ago';
};
const who = h => h.name + (h.provider ? ' (' + h.provider + ')' : '');

function table(project) {
  const k = projectKey(project),
    m = locks.get(k);
  if (!m) return null;

  // expired: the holder stopped editing it
  for (const [f, h] of m) if (now() - h.last >= LOCK_MS) m.delete(f);
  if (!m.size) {
    locks.delete(k);
    return null;
  }
  return m;
}
const changed = project => {
  try {
    send('locks:changed', { project: path.resolve(String(project)) });
  } catch {}
};

// owner: { paneId, name, provider, edit?, whole? }. Taking a lock you (or your lead tree) hold
// refreshes it.
function acquire(project, file, owner) {
  const r = rel(project, file);
  if (!r || !owner?.paneId || EXEMPT.has(r.toLowerCase())) return { ok: true };
  const k = projectKey(project),
    key = fold(r),
    m = table(project),
    h = m?.get(key);

  // Team mode (agent-teams.js, set up by the user): teammates share locks like a lead tree, but a
  // whole-file rewrite (owner.whole: Write, NotebookEdit) is exclusive for WHOLE_MS: no teammate's
  // rewrite of a file edited in that window, and no teammate's edit of a file rewritten in it. The
  // same between separate panels of one lead tree (deps.tree): a lead and its Technically Not
  // sub-agents (tnai_delegate / tnai new), sibling sub-agents. Claude Code's own in-panel
  // sub-agents share the lead's panel, so they never meet this.
  const mates = !!(
    h &&
    h.paneId !== owner.paneId &&
    deps.team &&
    deps.team(h.paneId, owner.paneId)
  );
  const kin =
    !mates && !!(h && h.paneId !== owner.paneId && deps.tree && deps.tree(h.paneId, owner.paneId));
  const team = mates || kin,
    mate = mates ? 'your teammate ' : 'an agent of your own lead tree ',
    inside = mates ? 'Inside a team' : 'Within one lead tree';
  const rewrite =
    team &&
    ((owner.whole && now() - h.last < WHOLE_MS) || (h.wholeAt && now() - h.wholeAt < WHOLE_MS));
  if (rewrite) {
    const theirs = h.wholeAt && now() - h.wholeAt < WHOLE_MS;
    return {
      ok: false,
      team: true,
      code: 'locked',
      hint: 'tnai locks, then tnai send ' + h.name + ' MESSAGE to split the files',
      holder: { paneId: h.paneId, name: h.name, provider: h.provider, at: h.at },
      text:
        r +
        (theirs
          ? ' was just rewritten whole by ' +
            mate +
            who(h) +
            '. Wait ' +
            WHOLE_MS / 60e3 +
            ' min after a whole-file rewrite, then re-read it and make your change with a small edit (Edit), not a rewrite; `tnai send ' +
            h.name +
            '` if you need it sooner.'
          : ' is being edited by ' +
            mate +
            who(h) +
            ' (last edit ' +
            ago(h.last) +
            '). ' +
            inside +
            ' small edits (Edit) may run side by side, but a whole-file rewrite (Write) is not allowed while ' +
            (mates ? 'a teammate' : 'another agent of it') +
            ' edited the file in the last ' +
            WHOLE_MS / 60e3 +
            ' min: re-read it and use Edit, or `tnai send ' +
            h.name +
            '` to split the file.'),
    };
  }
  if (
    h &&
    h.paneId !== owner.paneId &&
    !team &&
    !(deps.family && deps.family(h.paneId, owner.paneId))
  ) {
    const text =
      r +
      ' is being edited by ' +
      who(h) +
      ' (last edit ' +
      ago(h.last) +
      '). Do not edit it now: `tnai send ' +
      h.name +
      '` to split the work (who takes which files), or work on something else and try again later. The lock ends when ' +
      h.name +
      ' runs `tnai unlock`, finishes its task, stops, or leaves the file alone for ' +
      LOCK_MS / 60e3 +
      ' min. You are next in line: if you are still working when it ends, the file passes to you and you are told.';

    // Who was last refused this file, kept on the lock itself so a view can say "X waits" beside
    // the holder (the thread layout's shared files row). It goes with the lock when that ends, and
    // earlier when that agent is known to have stopped waiting (stopWaiting below).
    h.wanted = {
      paneId: owner.paneId,
      name: owner.name || '',
      provider: owner.provider || '',
      at: now(),
    };
    changed(project);
    const ak = k + '\n' + key + '\n' + owner.paneId,
      last = alerted.get(ak);
    if (!last || now() - last >= ALERT_MS) {
      alerted.set(ak, now());
      try {
        Promise.resolve(
          deps.notify?.(
            h.paneId,
            '[from Technically Not] ' +
              who(owner) +
              ' wanted to edit ' +
              r +
              ', which you hold (file lock), and was told to wait. If you are done with it, run `tnai unlock ' +
              r +
              '` (it also ends by itself when your task ends); otherwise `tnai send ' +
              owner.name +
              '` to agree who does what. No reply needed if neither applies.' +
              // The holder sits idle on an answer from the very agent its lock blocks
              // (agent-links.js): neither can go on until the file is free.
              (deps.waiting?.(h.paneId, owner.paneId)
                ? ' You are waiting on an answer from ' +
                  owner.name +
                  ', and this file is what stops it: unlock it now unless you are mid-edit.'
                : '')
          )
        ).catch(() => {});
      } catch {}
    }
    return {
      ok: false,
      code: 'locked',
      hint: 'tnai locks, then tnai send ' + h.name + ' MESSAGE to split the files',
      holder: { paneId: h.paneId, name: h.name, provider: h.provider, at: h.at },
      text,
    };
  }
  const map = m || new Map();
  if (!m) locks.set(k, map);
  const fresh = !h || h.paneId !== owner.paneId;

  // edit: taken by Claude Code's edit hook, whose own edits and shell commands are all seen, so a
  // change it didn't make is someone else's
  map.set(key, {
    file: r,
    paneId: owner.paneId,
    name: String(owner.name || owner.paneId),
    provider: String(owner.provider || ''),
    at: fresh ? now() : h.at,
    last: now(),
    edit: !!owner.edit || (!fresh && !!h.edit),

    // editing: the edit hook's call is still running (until editDone). The write can land well
    // after this moment (a permission prompt), and its change is the holder's own.
    ...(owner.edit ? { editing: now() } : !fresh && h.editing ? { editing: h.editing } : {}),
    wholeAt: owner.whole ? now() : h?.wholeAt || 0,

    // the holder edited its file again: whoever was refused it still waits
    ...(!fresh && h.wanted && h.wanted.paneId !== owner.paneId ? { wanted: h.wanted } : {}),
  });

  // An agent that takes a file is not waiting for one any more: it got this one, or it went on to
  // another.
  const left = stopWaiting(owner.paneId, k);
  if (fresh || left) changed(project);

  // taken: the file was free and this call took it, so an edit that then fails or is denied can
  // give it back (agent-hooks.js editEnded). Not when it refreshed a lock of its own lead tree.
  return { ok: true, taken: !h };
}

// The agent of this panel no longer waits for a file: its name leaves every lock that showed it as
// the one waiting (in one project, or in all of them when no project key is given). Only what is
// known ends a wait, never a guess from time passing: the agent took a file (acquire), its task
// ended (taskEnded) or its panel is gone (releasePane). Returns whether a lock changed.
function stopWaiting(paneId, onlyProjectKey) {
  let any = false;
  for (const [k, m] of locks) {
    if (onlyProjectKey && k !== onlyProjectKey) continue;
    for (const h of m.values())
      if (h.wanted && h.wanted.paneId === paneId) {
        delete h.wanted;
        any = true;
      }
  }
  return any;
}

// files: paths, or null for all of that panel's locks. Only the holder releases.
function release(project, files, paneId) {
  const m = table(project),
    released = [];
  if (m)
    for (const [key, h] of m)
      if (h.paneId === paneId && (!files || files.some(f => fold(rel(project, f)) === key))) {
        if (!handOn(m, key, h, 'unlocked it')) m.delete(key);
        released.push(h.file);
      }
  if (m && !m.size) locks.delete(projectKey(project));
  if (released.length) changed(project);
  return { released };
}

// A freed lock goes to the agent waiting for it (wanted) while that agent is still working
// (deps.busy): it is next in line, so a third agent cannot take the file first, and it is told
// once (a working Claude Code gets the notice after its next tool call). An idle waiter gets
// nothing: a notice would start a whole new task, and it takes the file by editing when it is
// back. Returns whether the lock was handed on.
function handOn(map, key, h, why) {
  const waiter = h.wanted;
  if (!waiter || waiter.paneId === h.paneId || !deps.busy?.(waiter.paneId)) return false;
  map.set(key, {
    file: h.file,
    paneId: waiter.paneId,
    name: waiter.name || waiter.paneId,
    provider: waiter.provider || '',
    at: now(),
    last: now(),
    edit: false,
    wholeAt: 0,
  });
  tell(
    waiter.paneId,
    '[from Technically Not] ' +
      h.file +
      ' is free now (' +
      h.name +
      ' ' +
      why +
      ') and held for you, as next in line: edit it when you are ready. If you no longer need it, run `tnai unlock ' +
      h.file +
      '`. No reply needed.'
  );
  return true;
}

// The agent's task ended (agent-turns.js onEnd: it finished, was stopped or interrupted, or waits
// for the user). An agent at rest edits nothing, so its locks end now instead of LOCK_MS later,
// each passed to the agent waiting for it; its next task takes them again by editing (user
// decision 2026-10-14: agents kept asking idle holders to unlock). An agent at rest also waits for
// no file: a freed lock never passes to an idle waiter (handOn), so its "waits" beside a held file
// would only stay there wrong.
function taskEnded(paneId) {
  for (const [k, m] of [...locks]) {
    let n = 0;
    for (const [key, h] of m)
      if (h.paneId === paneId) {
        if (!handOn(m, key, h, 'finished its task')) m.delete(key);
        n++;
      } else if (h.wanted && h.wanted.paneId === paneId) {
        delete h.wanted;
        n++;
      }
    if (!m.size) locks.delete(k);
    if (n) changed(k);
  }
}

function releasePane(paneId) {
  for (const [k, m] of [...locks]) {
    let n = 0;
    for (const [key, h] of m)
      if (h.paneId === paneId) {
        if (!handOn(m, key, h, 'was closed')) m.delete(key);
        n++;
      } else if (h.wanted && h.wanted.paneId === paneId) {
        // a closed panel waits for nothing
        delete h.wanted;
        n++;
      }
    if (!m.size) locks.delete(k);
    if (n) changed(k);
  }
  for (const ak of [...alerted.keys()]) if (ak.endsWith('\n' + paneId)) alerted.delete(ak);
  shells.delete(paneId);
}

// Claude Code's Edit/Write of this file finished (agent-hooks.js PostToolUse, also when it failed).
// Its write is on disk now: the holder's own edit counts from here, not from the hook before it,
// so a change the watcher reports a little later is not taken for someone else's.
function editDone(project, file, paneId) {
  const r = rel(project, file),
    h = r ? table(project)?.get(fold(r)) : null;
  if (!h || !kin(h.paneId, paneId)) return;
  h.last = now();
  delete h.editing;
}

// A Claude Code shell command (Bash/PowerShell, not run in the background) started / ended;
// timeoutMs is the call's own timeout. shellStop: the turn ended.
function shellStart(paneId, id, owner, timeoutMs) {
  if (!paneId || !owner?.project) return;
  const s = shells.get(paneId) || { owner, runs: new Map(), ended: 0 };
  s.owner = owner;
  s.runs.set(
    String(id || now()),
    now() + Math.min(Math.max(Number(timeoutMs) || SHELL_MS, 1000), SHELL_MAX_MS) + SETTLE_MS
  );
  shells.set(paneId, s);
}

function shellEnd(paneId, id) {
  const s = shells.get(paneId);
  if (s && s.runs.delete(String(id || ''))) s.ended = now();
}

function shellStop(paneId) {
  const s = shells.get(paneId);
  if (s && s.runs.size) {
    s.runs.clear();
    s.ended = now();
  }
}

// Agents of this project with a shell command running now (or that just ended: the watcher reports
// a moment late).
function shelling(project) {
  const k = projectKey(project),
    out = [];
  for (const s of shells.values()) {
    for (const [id, until] of s.runs) if (until < now()) s.runs.delete(id);
    if (projectKey(s.owner.project) === k && (s.runs.size || now() - s.ended < SETTLE_MS))
      out.push(s.owner);
  }
  return out;
}

// Whether the watcher's change c edited the file's content. Not: an editor's atomic-save temp file
// (Claude Code writes `<file>.tmp.<pid>.<hex>`, then renames it over the file, so it belongs to
// whichever agent saved, not to whoever's command runs); a folder (Windows' watcher also reports
// the folder a file changed in); or a 'change' to a file not written just now: Windows' watcher
// (libuv) also reports attribute and last-access changes, so a plain read (grep, cat, git ls-files)
// or OneDrive's sync marks look like changes. A write sets mtime to its moment; a deleted file
// (gone) and a create/move ('rename') count as edits.
const TEMP_SAVE = /\.tmp\.\d+\.[0-9a-f]+$/i,
  FRESH_MS = 5000; // FRESH_MS: write → watcher event, with room for a busy main process

// Async (measured 2026-10-05): the stat per changed path and the git call below held the main
// process about 20 ms per watcher batch.
async function edited(project, r, c) {
  if (TEMP_SAVE.test(r)) return false;
  let st;
  try {
    st = await fs.promises.stat(path.join(path.resolve(String(project)), r));
  } catch {
    return true;
  }
  if (st.isDirectory()) return false;
  return c.type === 'rename' || st.mtimeMs >= (Number(c.at) || Date.now()) - FRESH_MS;
}

// Git-ignored files (generated output such as test screenshots, logs, builds) are nobody's work, so
// they never lock or notify. One `git check-ignore` per batch for the paths not seen in the last
// IGNORE_MS; not a git repo or git missing → nothing is ignored.
const IGNORE_MS = 5 * 60e3,
  ignoredSeen = new Map(); // project key + '\n' + rel key → { ignored, at }

// The answer of `git check-ignore --stdin -z` for these paths: the ignored ones, folded. Anything
// but exit code 0 (1: none ignored; no git, not a repo, the 3 s timeout) → none. Started from a
// worker thread (process-starter.js): a process start held the main process 100 to 800 ms now and
// then on a busy PC, and this runs for every watcher batch with new paths while agents work.
const checkIgnore = (project, ask) =>
  require('./process-starter')
    .start(
      'git',
      ['check-ignore', '--stdin', '-z'],
      { cwd: path.resolve(String(project)), encoding: 'utf8', timeout: 3000, windowsHide: true },
      { rerun: true, input: ask.join('\0') + '\0' }
    )
    .then(
      ({ error, stdout }) =>
        error ? new Set() : new Set(String(stdout).split('\0').filter(Boolean).map(fold)),
      () => new Set()
    );

async function ignoredFiles(project, files) {
  const k = projectKey(project),
    out = new Set(),
    ask = [];
  for (const r of files) {
    const e = ignoredSeen.get(k + '\n' + fold(r));
    if (e && Date.now() - e.at < IGNORE_MS) {
      if (e.ignored) out.add(r);
    } else ask.push(r);
  }
  if (ask.length) {
    const hit = await checkIgnore(project, ask);
    if (ignoredSeen.size > 5000) ignoredSeen.clear();
    for (const r of ask) {
      const ig = hit.has(fold(r));
      ignoredSeen.set(k + '\n' + fold(r), { ignored: ig, at: Date.now() });
      if (ig) out.add(r);
    }
  }
  return out;
}
const kin = (a, b) => a === b || !!(deps.family && deps.family(a, b));
const tell = (paneId, text) => {
  try {
    Promise.resolve(deps.notify?.(paneId, text)).catch(() => {});
  } catch {}
};
const names = list => list.map(who).join(', ');

// The project watcher's batch (watch-service.js onChanges: paths relative to the project). Lanes
// are skipped; a folded batch (an install, a build) locks nothing. Whose command was running is
// read at once, when the batch arrives; the disk and git are asked off the main process, and the
// batch is applied when they have answered, one batch after the other in the order they came.
// Returns a promise for that (the check awaits it).
let applying = Promise.resolve();

function diskChanges(project, batch) {
  if (!project || !Array.isArray(batch) || !batch.length || batch.some(c => c?.lane))
    return Promise.resolve();
  const active = shelling(project),
    k = projectKey(project),
    arrived = now();
  if (!table(project) && !active.length) return Promise.resolve();
  const leads = active.filter((o, i) => !active.slice(0, i).some(p => kin(p.paneId, o.paneId)));
  const paths = [];
  for (const c of batch) {
    const r = typeof c?.path === 'string' && !c.dir ? rel(project, c.path) : '';
    if (r && !EXEMPT.has(r.toLowerCase())) paths.push([r, edited(project, r, c)]);
  }
  return (applying = applying
    .then(async () => {
      const edits = [];
      for (const [r, was] of paths) if (await was) edits.push(r);
      const ignored = edits.length ? await ignoredFiles(project, edits) : new Set();
      applyChanges(
        project,
        batch,
        edits.filter(r => !ignored.has(r)),
        active,
        leads,
        k,
        arrived
      );
    })
    .catch(e => {
      console.warn('[tnai] file lock disk changes failed:', e?.message || e);
    }));
}

// An alert time older than ALERT_MS no longer holds anything back, so it can go. The disk keys
// (ending in "disk") belong to no panel, so closing a panel never removed them.
function pruneAlerted() {
  for (const [ak, at] of alerted) {
    if (now() - at >= ALERT_MS) {
      alerted.delete(ak);
    }
  }
}

// arrived: when the watcher's batch came in. The disk and git are asked first, so applying can run
// seconds later; the holder's own edit is measured to the batch, not to that moment.
function applyChanges(project, batch, edits, active, leads, k, arrived) {
  pruneAlerted();
  const m = table(project); // as the locks stand now: one taken while the disk was asked is seen
  const toHolder = new Map(),
    toOthers = new Map(); // paneId → { files, others | holders }
  for (const r of edits) {
    const key = fold(r),
      h = m?.get(key);
    if (!h) {
      if (leads.length === 1 && !batch.many) acquire(project, r, leads[0]);
      continue;
    }

    // the holder's own edit (still running, or done within OWN_EDIT_MS before the batch or any time
    // after it) or command
    const ownEdit =
      (h.editing && now() - h.editing < SHELL_MAX_MS) || h.last > (arrived || now()) - OWN_EDIT_MS;
    if (ownEdit || active.some(o => kin(o.paneId, h.paneId))) continue;
    const others = active.filter(o => !kin(o.paneId, h.paneId));

    // locked by `tnai lock`: the holder's own edits aren't seen, so no guess
    if (!others.length && !h.edit) continue;
    const ak = k + '\n' + key + '\ndisk',
      last = alerted.get(ak);
    if (last && now() - last < ALERT_MS) continue;
    alerted.set(ak, now());
    const hh = toHolder.get(h.paneId) || { files: [], others: new Map() };
    toHolder.set(h.paneId, hh);
    hh.files.push(r);
    for (const o of others) hh.others.set(o.paneId, o);
    for (const o of others) {
      const t = toOthers.get(o.paneId) || { files: [], holders: new Map() };
      toOthers.set(o.paneId, t);
      t.files.push(r);
      t.holders.set(h.paneId, h);
    }
  }
  for (const [paneId, { files, others }] of toHolder) {
    const o = [...others.values()];
    tell(
      paneId,
      '[from Technically Not] ' +
        files.join(', ') +
        ', which you hold (file lock), changed on disk ' +
        (o.length
          ? 'while ' +
            names(o) +
            (o.length > 1 ? ' were' : ' was') +
            ' running a shell command (inferred from timing). Re-read before your next edit, check `git diff ' +
            files[0] +
            '`, and `tnai send ' +
            o[0].name +
            '` if it was theirs.'
          : "but not through your own edits or shell commands: maybe a background task of yours, another agent's script, or the user. Re-read before your next edit.") +
        ' No reply needed.'
    );
  }
  for (const [paneId, { files, holders }] of toOthers) {
    const hs = [...holders.values()];
    tell(
      paneId,
      '[from Technically Not] Your shell command may have changed ' +
        files.join(', ') +
        ', held by ' +
        names(hs) +
        ' (file lock; inferred from timing). If it did, check `git diff` and `tnai send ' +
        hs[0].name +
        "` to agree who keeps the change; don't edit files another agent holds through shell commands. No reply needed if it wasn't yours."
    );
  }
}

function list(project) {
  const m = table(project);
  return m ? [...m.values()].map(h => ({ ...h })).sort((a, b) => a.file.localeCompare(b.file)) : [];
}

// A renamed agent keeps its locks under the new name: holders are stored with the name they had
// when they took the lock, and that name is shown (`tnai locks`) and typed into `tnai send NAME`
// hints, so a stale one would send agents to a name that no longer exists. list: [{ paneId, name }]
// as the window publishes it (mesh:names).
function setNames(list) {
  const byPane = new Map(
    (Array.isArray(list) ? list : [])
      .filter(i => i && typeof i.paneId === 'string' && i.name)
      .map(i => [i.paneId, String(i.name)])
  );
  if (!byPane.size) return;
  for (const [project, map] of locks) {
    let any = false;
    for (const h of map.values()) {
      const n = byPane.get(h.paneId);
      if (n && n !== h.name) {
        h.name = n;
        any = true;
      }

      // the one waiting is shown by name too
      const waiter = h.wanted && byPane.get(h.wanted.paneId);
      if (waiter && waiter !== h.wanted.name) {
        h.wanted.name = waiter;
        any = true;
      }
    }
    if (any) changed(project);
  }
  for (const s of shells.values()) {
    const n = s.owner && byPane.get(s.owner.paneId);
    if (n) s.owner.name = n;
  }
}

module.exports = {
  // deps: { notify(paneId, text) → Promise, family(paneA, paneB) → bool (lead tree or team: shares
  // locks), team(paneA, paneB) → bool (user team, not the same tree), tree(paneA, paneB) → bool
  // (same lead tree), busy?(paneId) → bool (its task is running: a freed lock passes to it), now?()
  // → ms }
  init(sender, dependencies) {
    send = sender || send;
    deps = dependencies || {};
  },
  acquire,
  release,
  releasePane,
  taskEnded,
  editDone,
  list,
  setNames,
  exempt,
  rel,
  shellStart,
  shellEnd,
  shellStop,
  diskChanges,
  LOCK_MS,
  ALERT_MS,
  SETTLE_MS,
  OWN_EDIT_MS,
  WHOLE_MS,
  _test: {
    reset() {
      locks.clear();
      alerted.clear();
      shells.clear();
      ignoredSeen.clear();
    },
    alertedKeys: () => [...alerted.keys()],
  },
};
