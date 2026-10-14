/*
 * Technically Not · 13-agent-file-activity.js — Desktop app only: live name tags with a green
 * status dot on File Repository rows for every agent working on that file (tags stack side by side
 * and clear when the agent finishes), plus the skills each agent is using right now (Claude Code's
 * hook events, or other CLIs' output). Lanes (an agent's own git worktree, worktree-service.js): a
 * pane working in a lane gets its files from the lane's own fs:changes batches (tagged lane) and
 * its output, keyed "⎇<lane id>/<path in the lane>" (lanePath) so they are never taken for
 * project-folder files. What that shows: the agent's Now line and Working-with / file chips (11,
 * 23, 25) name the lane file; the File Repository rail shows a lane's files when its Main | ⎇
 * switch (09) picks that lane; live change cards (26) show no lane files.
 */
(() => {
  // One ANSI pass per pty chunk for both output parsers: 15's usage-limit detection (.limits) and
  // this file's (.files), whose pattern also blanks charset selections (ESC ( B). Stripping 15's
  // way, then blanking the charset selections still left, gives exactly this file's result; the
  // last chunk is cached so the second listener reuses it. Callers skip chunks without ESC (every
  // ANSI form starts with ESC).
  const ANSI_BASE = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g,
    CHARSET = /\x1b[()#][0-9A-Za-z]/g;
  let lastChunk = null,
    lastLimits = '',
    lastFiles = '';
  const strip = data => {
    if (data !== lastChunk) {
      lastChunk = data;
      lastLimits = data.replace(ANSI_BASE, ' ');
      lastFiles = lastLimits.includes('\x1b') ? lastLimits.replace(CHARSET, ' ') : lastLimits;
    }
  };
  window.TnaiPtyStrip = {
    files: data => (strip(data), lastFiles),
    limits: data => (strip(data), lastLimits),
  };

  const native = window.tnaiNative,
    agents = window.TnaiAgents,
    files = window.TnaiProjectFiles;
  if (!native?.fs?.onChanges || !agents || !files) return;

  const TAG_TTL = 30000; // a file stays tagged this long after the agent last touched it
  const IDLE_CLEAR = 6000; // an agent with no output for this long has finished; its tags clear

  // recent output kept per pane to match a changed file to the agent that named it
  const MENTION_WINDOW = 8000;
  const tree = files.tree;

  // actor -> Map(path -> last touch time); actor = paneId, or paneId + SUB + agentId for a Claude
  // Code sub-agent
  const activity = new Map();
  const SUB = '\u0000';
  const recent = new Map(); // paneId -> [{ at, text }] ANSI-free recent output
  const statCache = new Map(); // path -> { exists, at }
  const lastAction = new Map(); // paneId -> { verb, path, at } latest thing the agent did to a file

  // paneId -> Map(lowercased skill name -> { name, at }) skills seen in use
  const skillUse = new Map();

  // safety limit for a hook-reported skill whose turn-end event never arrives
  const HOOK_SKILL_TTL = 900000;

  // a skill stays "in use" this long after it was last seen, while the agent keeps working
  const SKILL_TTL = 120000;
  let rootPath = '',
    rootAt = 0;

  // lowercased lane folder (forward slashes) -> { id, dir, branch }: worktree-service's lanes,
  // learned from lane batches and git.worktrees()
  const lanes = new Map();

  // ⎇: an activity path in a lane is LANE + lane id + '/' + path inside the lane
  const LANE = '\u2387';
  const lanePath = (lane, rel) => LANE + lane.id + '/' + rel;

  // Output parsing: agent CLIs name the file they act on, e.g. "Update(src/app.js)", "Edited
  // src/app.js", "WriteFile src/app.js".
  const VERBS =
    'Read|Reading|Write|Writing|Wrote|Edit|Edited|Editing|MultiEdit|Update|Updated|Updating|Create|Created|Creating|Modified|Delete|Deleted|ReadFile|WriteFile|Replace|Patch|Patched|Added|Viewed';
  const MENTION = new RegExp(
    '\\b(' + VERBS + ')\\b[\\s(:"\'`]+@?([^\\s"\'`()<>|]+\\.[A-Za-z0-9]{1,8})',
    'g'
  );

  // Skills in use: Claude Code prints `Skill(name)` (plugin skills as `plugin:name`), some CLIs
  // print "Skill: name", and any agent reading a skill's instructions reads
  // `.../skills/<name>/SKILL.md`.
  const SKILL_PATTERNS = [
    /\bSkill\s*\(\s*["'`]?([A-Za-z0-9][\w.:@\/-]*)/g,
    /\bSkill:\s+["'`]?([A-Za-z0-9][\w.:@-]*)/g,
    /[\\/]skills[\\/]([A-Za-z0-9][\w.-]*)[\\/]SKILL\.md\b/gi,
  ];
  const SKILL_HINT = /skill/i; // cheap pre-check: output without it can't match any pattern above

  const style = document.createElement('style');
  style.textContent = `
.repo-row.has-agent-tags{position:relative}
.repo-row{--repo-tag-fade:#fff}.repo-rail-tree button:hover{--repo-tag-fade:#f2f4ee}:root .repo-row.selected{--repo-tag-fade:#f1f4eb}
.repo-agent-tags{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;gap:3px;max-width:75%;padding-left:10px;background:linear-gradient(90deg,transparent,var(--repo-tag-fade,#fff) 8px);pointer-events:none}
.repo-agent-tag{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:96px;padding:2px 6px 2px 5px;border-radius:99px;background:#edf4e8;color:#5c7d43;font:8px var(--pg-sans);white-space:nowrap;pointer-events:auto}
.repo-agent-tag span{overflow:hidden;text-overflow:ellipsis}
.repo-agent-tag i{flex:none;width:6px;height:6px;border-radius:50%;background:#82a95f} /* pulse: shared, 05-status-colors.css */
.repo-folder .repo-agent-tag{background:#f3f6ee;color:#6f8a57}
`;
  document.head.append(style);

  async function projectRoot() {
    if (Date.now() - rootAt > 3000) {
      rootPath = ((await native.fs.root()) || '').replace(/\\/g, '/');
      rootAt = Date.now();
    }
    return rootPath;
  }

  // A path as the agent printed it -> { key, lane } (key: path relative to the project folder, or
  // lanePath for a file in the pane's lane), or null if it is outside both. place: where the pane
  // works (placeOf): a relative path is relative to its folder (a subfolder of the project, or its
  // lane).
  async function relative(raw, place = { base: '' }) {
    let p = raw
      .replace(/[.,:;]+$/, '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '');
    const safe = q => !!q && !q.split('/').includes('..');
    if (/^[A-Za-z]:\//.test(p) || p.startsWith('/')) {
      const lane = place.lane,
        low = p.toLowerCase();
      if (lane && low.startsWith(lane.dir.toLowerCase() + '/')) {
        p = p.slice(lane.dir.length + 1);
        return safe(p) ? { key: lanePath(lane, p), lane } : null;
      }
      const root = await projectRoot();
      if (!root || !low.startsWith(root.toLowerCase() + '/')) return null;
      p = p.slice(root.length + 1);
      return safe(p) ? { key: p, lane: null } : null;
    }
    if (place.lane) return safe(p) ? { key: lanePath(place.lane, p), lane: place.lane } : null;
    if (place.base) p = place.base + '/' + p;
    return safe(p) ? { key: p, lane: null } : null;
  }

  // A lane file can't be stat-checked (it is outside the project folder): the path it printed or
  // its hook named is taken as is.
  const real = hit =>
    !hit ? Promise.resolve(false) : hit.lane ? Promise.resolve(true) : exists(hit.key);

  async function exists(rel) {
    const hit = statCache.get(rel);
    if (hit && Date.now() - hit.at < 10000) return hit.exists;
    const result = await native.fs.stat(rel);
    statCache.set(rel, { exists: !!result?.ok, at: Date.now() });
    return !!result?.ok;
  }

  let changed = false; // the set of (agent, file) pairs changed, not just a touch time

  function act(paneId, verb, path) {
    const prev = lastAction.get(paneId);
    if (!prev || prev.path !== path || prev.verb !== verb) changed = true;
    lastAction.set(paneId, { verb, path, at: Date.now() });
  }
  let skillsChanged = false;

  // When each skill was last used, by which agent (lowercased name -> { name, at, by }); kept
  // across restarts, per viewer.
  const LAST_KEY = 'tnai.skill-last-used.v1';
  let lastUsed = {};
  try {
    lastUsed = JSON.parse(localStorage.getItem(LAST_KEY)) || {};
  } catch {}

  // When this viewer started recording skill use, so "not used" can say since when.
  const SINCE_KEY = 'tnai.skill-last-used.since';
  let trackedSince = Math.min(
    Date.now(),
    ...Object.values(lastUsed)
      .map(u => u.at)
      .filter(Number.isFinite)
  );
  try {
    trackedSince =
      Number(localStorage.getItem(SINCE_KEY)) ||
      (localStorage.setItem(SINCE_KEY, String(trackedSince)), trackedSince);
  } catch {}
  let lastSaveTimer = 0;

  function noteLastUse(paneId, name) {
    const by = cachedSessions().find(s => s.paneId === paneId)?.name || '';
    lastUsed[name.toLowerCase()] = { name, at: Date.now(), by };
    if (!lastSaveTimer)
      lastSaveTimer = setTimeout(() => {
        lastSaveTimer = 0;
        try {
          localStorage.setItem(LAST_KEY, JSON.stringify(lastUsed));
        } catch {}
      }, 1000);
  }

  function useSkill(paneId, raw, exact) {
    const name = raw.replace(/[.,:;/]+$/, '');
    if (!name) return;
    let used = skillUse.get(paneId);
    if (!used) skillUse.set(paneId, (used = new Map()));
    const key = name.toLowerCase();
    if (!used.has(key)) skillsChanged = true;
    noteLastUse(paneId, name);

    // Exact (hook) uses last until the agent's turn ends; output-parsed ones fade when the output
    // goes quiet.
    used.set(key, { name, at: Date.now(), exact: !!exact || !!used.get(key)?.exact });
    schedule();
  }

  function touch(paneId, path) {
    let paths = activity.get(paneId);
    if (!paths) activity.set(paneId, (paths = new Map()));
    if (!paths.has(path)) changed = true;
    paths.set(path, Date.now());
    schedule();
  }

  const RECENT_MAX = 65536; // chars of recent output kept per pane, whatever the time window
  native.pty.onData(({ paneId, data }) => {
    const text = data.includes('\x1b') ? window.TnaiPtyStrip.files(data) : data,
      now = Date.now(); // every ANSI form starts with ESC
    let list = recent.get(paneId);
    if (!list) {
      recent.set(paneId, (list = []));
      list.size = 0;
    }
    const tail = list.length ? list[list.length - 1].text.slice(-160) : '';
    list.push({ at: now, text });
    list.size += text.length;
    list.joined = null; // credit()'s joined text is good until this pane's next output
    while (list.length && (now - list[0].at > MENTION_WINDOW || list.size > RECENT_MAX))
      list.size -= list.shift().text.length;
    const hay = tail + text;

    // Claude Code between turns prints file names that are not work: after /compact it lists what
    // it reloads ("Read src\x.css (49 lines)"), and a resumed conversation redraws old lines. Its
    // turns are known exactly (19, hooks), so its output counts only while a turn is open.
    if (
      window.TnaiTeam &&
      !window.TnaiTeam.busy(paneId) &&
      cachedSessions().find(s => s.paneId === paneId)?.agent === 'Claude Code'
    )
      return;
    if (SKILL_HINT.test(hay))
      // every pattern needs "skill"
      for (const re of SKILL_PATTERNS) for (const m of hay.matchAll(re)) useSkill(paneId, m[1]);
    const mentions = [...hay.matchAll(MENTION)],
      place = mentions.length && placeOf(paneId);
    if (!place) return;
    for (const m of mentions) {
      const verb = m[1];
      relative(m[2], place).then(hit =>
        real(hit).then(ok => {
          if (ok) {
            act(paneId, verb, hit.key);
            touch(paneId, hit.key);
          }
        })
      );
    }
  });

  // Panes keep the folder they started in when another project becomes active (09); only panes
  // working in the active project (its folder, a folder inside it, or one of its lanes) get tags.
  // agents.sessions() reads the panes; output chunks arrive many times a second, so reuse it
  // briefly (refreshed on any session change).
  let sessionsCache = null,
    sessionsAt = 0;
  const cachedSessions = () => {
    if (!sessionsCache || Date.now() - sessionsAt > 250) {
      sessionsCache = agents.sessions();
      sessionsAt = Date.now();
    }
    return sessionsCache;
  };
  agents.onChange(() => {
    sessionsCache = null;
  });
  const slash = p =>
    String(p || '')
      .replace(/\\/g, '/')
      .replace(/\/$/, '');

  function learnLane(lane) {
    if (!lane?.id || !lane.dir) return;
    const dir = slash(lane.dir),
      k = dir.toLowerCase();
    if (!lanes.has(k)) {
      lanes.set(k, { id: String(lane.id), dir, branch: String(lane.branch || '') });
      sessionsCache = null;
    }
  }

  // Lanes a pane may work in that no lane batch has named yet: asked once in a while, only when a
  // pane's folder is outside the project folder.
  let lanesAt = 0;

  function refreshLanes() {
    if (Date.now() - lanesAt < 5000 || !native.git?.worktrees) return;
    lanesAt = Date.now();
    native.git
      .worktrees()
      .then(r => {
        for (const w of r?.value?.items || [])
          learnLane({ id: slash(w.dir).split('/').pop(), dir: w.dir, branch: w.branch });
      })
      .catch(() => {});
  }

  // Where a pane works: { base, lane } (base: its folder inside the project, '' for the project
  // folder; lane: its lane, or null), or null when outside.
  const placeOf = paneId => {
    const cwd = slash(cachedSessions().find(s => s.paneId === paneId)?.cwd),
      low = cwd.toLowerCase(),
      root = rootPath.toLowerCase();
    if (!cwd || !rootPath || low === root) return { base: '', lane: null };
    if (low.startsWith(root + '/')) return { base: cwd.slice(rootPath.length + 1), lane: null };
    for (const [dir, lane] of lanes)
      if (low === dir || low.startsWith(dir + '/')) return { base: '', lane };
    refreshLanes();
    return null;
  };
  window.addEventListener('tnai:project-changed', () => {
    activity.clear();
    lastAction.clear();
    statCache.clear();
    lanes.clear();
    lanesAt = 0;
    changed = true;
    rootAt = 0;
    projectRoot().then(schedule);
  });
  projectRoot();

  // Folder changes: credit the agent whose recent output names the file; otherwise the only agent
  // producing output right now. A batch too large to attribute file by file (a build or install
  // churning the folder) only updates the tree.
  const ATTRIBUTE_MAX = 200;

  // Each changed file goes to the panes whose recent output names it (path, or a file name of 4+
  // characters), else to the only one producing output now.
  function credit(changes, running, keyOf, skip = () => false) {
    const now = Date.now(),
      active = running.filter(s => now - s.lastOutputAt < 2500);

    // Each pane's recent output, joined and cleaned (up to 64 KB each) only when the batch has a
    // file to attribute, and kept on the pane's list until its next output (the list changes
    // nowhere else): every folder-change batch joined every running pane's output again.
    const joined = s => {
      const list = recent.get(s.paneId);
      return !list
        ? ''
        : (list.joined ??
            (list.joined = list
              .map(c => c.text)
              .join('')
              .replace(/\\/g, '/')));
    };
    let texts = null;
    const said = (text, rel) => {
      const base = rel.split('/').pop();
      return text.includes(rel) || (base.length >= 4 && text.includes(base));
    };
    for (const c of changes) {
      if (skip(c.path)) continue;
      texts ||= running.map(s => [s, joined(s)]);
      const named = texts.filter(([, text]) => said(text, c.path)).map(([s]) => s);
      (named.length ? named : active.length === 1 ? active : []).forEach(s => {
        act(s.paneId, 'Changed', keyOf(c.path));
        touch(s.paneId, keyOf(c.path));
      });
    }
  }

  // A lane's batch (watch-service watchLane): paths inside the lane, credited only to panes working
  // in that lane. The rail shows the project folder, so no tree reload.
  function laneChanges(payload, tag) {
    learnLane(tag);
    const lane = [...lanes.values()].find(l => l.id === String(tag.id));

    // folded (folder entries) or huge (an install in the lane): nothing to attribute file by file
    if (!lane || payload.some(c => c?.dir) || payload.length > ATTRIBUTE_MAX) return;
    const running = agents.sessions().filter(s => s.running && placeOf(s.paneId)?.lane === lane);
    if (running.length)
      credit(
        payload.filter(c => c && typeof c.path === 'string'),
        running,
        rel => lanePath(lane, rel)
      );
  }
  native.fs.onChanges(payload => {
    const tag = Array.isArray(payload) && payload[0]?.lane;
    if (tag) {
      laneChanges(payload, tag);
      return;
    }

    // The watcher may send an overflow signal instead of (or along with) the paths: nothing to
    // attribute, re-list the tree once.
    if (
      !Array.isArray(payload) ||
      payload.overflow ||
      (!payload.many && payload.count > payload.length)
    ) {
      statCache.clear();
      files.reloadDirs?.(null);
      return;
    }

    // Folded batch (watch-service: > 200 paths): each folder entry stands for changes inside it;
    // re-list it and its parent in place, never the whole tree. Told by its folder entries (dir:
    // true): IPC drops the array's own many/count properties.
    if (payload.many || payload.some(c => c?.dir)) {
      statCache.clear();
      const dirs = new Set();
      for (const c of payload)
        if (c && typeof c.path === 'string') {
          const up = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '';
          dirs.add(up);
          if (c.dir) dirs.add(c.path);
        }
      files.reloadDirs ? files.reloadDirs(dirs) : files.reload();
      return;
    }
    const changes = payload.filter(c => c && typeof c.path === 'string');
    for (const c of changes) statCache.delete(c.path);

    // Folder rows, and every folder that contains a changed path: a folder reports a change when
    // something inside it changes; only files get tags.
    const folders = new Set(),
      loaded = new Set();
    tree.querySelectorAll('.repo-folder[data-real-path]').forEach(row => {
      folders.add(row.dataset.realPath);
      if (row.nextElementSibling?.dataset.loaded) loaded.add(row.dataset.realPath);
    });
    const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    for (const c of changes)
      for (let p = parentOf(c.path); p; p = parentOf(p)) {
        if (folders.has(p)) break;
        folders.add(p);
      } // a known folder's parents are known too
    if (changes.length <= ATTRIBUTE_MAX)
      credit(
        changes,
        agents.sessions().filter(s => s.running && placeOf(s.paneId) && !placeOf(s.paneId).lane),
        rel => rel,
        p => folders.has(p)
      );

    // An added or removed file inside a loaded folder: re-list that folder so it appears or
    // disappears (09 merges bursts into one pass).
    const dirs = new Set();
    for (const c of changes)
      if (c.type === 'rename') {
        const parent = parentOf(c.path);
        if (!parent || loaded.has(parent)) dirs.add(parent);
      }
    if (dirs.size) files.reloadDirs ? files.reloadDirs(dirs) : files.reload();
  });

  // Who a tag belongs to: the pane's agent, or one of its sub-agents (named and tracked by 19).
  // Null once the pane is gone. A file credited just now counts as activity too: output right after
  // a resize is not counted in lastOutputAt (10), so a pane whose command echo landed there would
  // otherwise look quiet and lose the file the moment it was credited.
  function actor(key, sessions, touchedAt = 0) {
    const [paneId, agentId] = key.split(SUB),
      s = sessions.get(paneId);
    if (!s) return null;
    if (!agentId)
      return {
        name: s.name,
        agent: s.agent,
        done: !s.running || Date.now() - Math.max(s.lastOutputAt, touchedAt) > IDLE_CLEAR,
      };
    const sub = window.TnaiTeam?.get?.(paneId)?.subs.find(x => x.agentId === agentId);
    return {
      name: sub?.alias || 'Sub-agent',
      agent: 'sub-agent of ' + s.name,
      done: !s.running || !sub || (sub.status !== 'running' && sub.status !== 'starting'),
    };
  }

  // Tags clear when the agent finishes (exits, goes quiet, or its sub-agent ends) or moves on from
  // the file. nextDue: when the earliest thing still kept ends by time alone (a tag's 30 s, a
  // pane's quiet time, a skill's time), for render's one timeout.
  let nextDue = Infinity;

  function prune() {
    const sessions = new Map(agents.sessions().map(s => [s.paneId, s])),
      now = Date.now();
    nextDue = Infinity;
    const due = t => {
      if (t < nextDue) nextDue = t;
    };
    for (const [key, paths] of activity) {
      const touched = Math.max(0, ...paths.values()),
        a = actor(key, sessions, touched),
        done = !a || a.done;
      for (const [path, at] of paths)
        if (done || now - at > TAG_TTL) {
          paths.delete(path);
          changed = true;
        } else due(at + TAG_TTL);
      if (!paths.size) activity.delete(key);
      else if (!key.includes(SUB))
        due(Math.max(sessions.get(key).lastOutputAt, touched) + IDLE_CLEAR);
    }
    for (const paneId of recent.keys()) if (!sessions.has(paneId)) recent.delete(paneId);
    for (const paneId of lastAction.keys())
      if (!sessions.has(paneId)) {
        lastAction.delete(paneId);
        changed = true;
      }
    for (const [paneId, used] of skillUse) {
      const s = sessions.get(paneId),
        done = !s || !s.running || now - s.lastOutputAt > IDLE_CLEAR;
      const gone = !s || !s.running;
      for (const [key, u] of used)
        if (u.exact ? gone || now - u.at > HOOK_SKILL_TTL : done || now - u.at > SKILL_TTL) {
          used.delete(key);
          skillsChanged = true;
        } else
          due(
            u.exact
              ? u.at + HOOK_SKILL_TTL
              : Math.min(u.at + SKILL_TTL, s.lastOutputAt + IDLE_CLEAR)
          );
      if (!used.size) skillUse.delete(paneId);
    }
    return sessions;
  }

  const rowFor = path => tree.querySelector('[data-real-path="' + CSS.escape(path) + '"]');
  const shown = row => row && !row.hidden && !row.closest('.repo-folder-children[hidden]');

  // The file's own row, or the nearest folder row that is visible (collapsed folders carry their
  // agents' tags). rows: path -> row, read once per render (one query per path and parent folder
  // was a full tree scan each, twice a second).
  function visibleRow(path, rows) {
    for (let p = path; p; p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') {
      const row = rows ? rows.get(p) : rowFor(p);
      if (shown(row)) return row;
    }
    return null;
  }

  let frame = 0,
    rowsCache = null,
    dueTimer = 0;

  function schedule() {
    if (!frame) frame = requestAnimationFrame(render);
  }

  function render() {
    frame = 0;
    const sessions = prune();

    // One timeout for the next end by time, set again on every render (it replaced a render every
    // 500 ms while any tag or skill was kept). A pane still printing moves its quiet time on
    // without an event, so the timeout then finds nothing ended and sets itself again.
    clearTimeout(dueTimer);
    dueTimer =
      nextDue < Infinity ? setTimeout(schedule, Math.max(16, nextDue - Date.now() + 5)) : 0;
    if (railShown !== false) paintTags(sessions);
    if (changed) {
      changed = false;
      window.dispatchEvent(new CustomEvent('tnai:file-activity'));
    }
    if (skillsChanged) {
      skillsChanged = false;
      window.dispatchEvent(new CustomEvent('tnai:skill-activity'));
    }
  }

  // The rail's tags are painted only while its tree is on screen, and once when it comes on screen:
  // the state above (activity) stays current either way. No route of the current design shows the
  // rail, so until one does (a pop-out, a route added later) nothing is painted. On screen or not
  // is told by one IntersectionObserver (no layout read); until it has answered, tags are painted
  // as before.
  let railShown;
  new IntersectionObserver(list => {
    const now = list[list.length - 1].isIntersecting;
    if (now === railShown) return;
    railShown = now;
    if (now) schedule();
  }).observe(tree);

  function paintTags(sessions) {
    const byRow = new Map();
    let rows = rowsCache;
    for (const [key, paths] of activity) {
      const a = actor(key, sessions);
      if (!a) continue;

      // The path -> row map is kept until the tree itself changes (observer below): this runs twice
      // a second while agents work.
      if (!rows) {
        rows = rowsCache = new Map();
        tree.querySelectorAll('[data-real-path]').forEach(r => {
          if (!rows.has(r.dataset.realPath)) rows.set(r.dataset.realPath, r);
        });
      }
      for (const path of paths.keys()) {
        const row = visibleRow(path, rows);
        if (!row) continue;
        let list = byRow.get(row);
        if (!list) byRow.set(row, (list = []));
        if (!list.some(x => x.paneId === key))
          list.push({ paneId: key, name: a.name, agent: a.agent, path });
      }
    }
    tree.querySelectorAll('.repo-row.has-agent-tags').forEach(row => {
      if (byRow.has(row)) return;
      row.classList.remove('has-agent-tags');
      delete row.dataset.agentKey;
      row.querySelector('.repo-agent-tags')?.remove();
    });
    byRow.forEach((list, row) => {
      list.sort((a, b) => a.name.localeCompare(b.name));
      const key = list.map(x => x.paneId).join('|');
      if (row.dataset.agentKey === key) return;
      row.dataset.agentKey = key;
      row.classList.add('has-agent-tags');
      const box =
        row.querySelector('.repo-agent-tags') ||
        row.appendChild(
          Object.assign(document.createElement('span'), { className: 'repo-agent-tags' })
        );
      box.replaceChildren(
        ...list.map(x => {
          const tag = document.createElement('span'),
            name = document.createElement('span');
          tag.className = 'repo-agent-tag';
          name.textContent = x.name;
          tag.title =
            x.name +
            ' (' +
            x.agent +
            ') is working ' +
            (row.classList.contains('repo-folder') ? 'inside this folder' : 'on this file') +
            ' (inferred from its output and file changes)';
          tag.append(document.createElement('i'), name);
          return tag;
        })
      );
    });
  }

  // Tree reloads, folder expands, and filtering replace rows; re-apply tags to the new rows.
  // Only the tree's own changes count: adding or refilling tag boxes (render) must not schedule
  // another render.
  const ownTags = n => n.nodeType === 1 && n.classList.contains('repo-agent-tags');
  new MutationObserver(records => {
    if (
      records.some(
        r =>
          r.type === 'attributes' ||
          !(
            r.target.closest?.('.repo-agent-tags') ||
            [...r.addedNodes, ...r.removedNodes].every(ownTags)
          )
      )
    ) {
      if (
        records.some(
          r =>
            r.type === 'childList' &&
            !r.target.closest?.('.repo-agent-tags') &&
            ![...r.addedNodes, ...r.removedNodes].every(ownTags)
        )
      )
        rowsCache = null; // rows added, removed or replaced

      // a tree not on screen has no tags to re-apply; it is painted when it is shown
      if (railShown !== false) schedule();
    }
  }).observe(tree, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden'],
  });

  // Claude Code reports skill use exactly through its hooks (agent-hooks.js), sub-agents included:
  // the Skill tool, or a Read of a SKILL.md. When its turn ends ("stop"), the skills it used are no
  // longer in use.
  const SKILL_FILE = /[\\/]skills[\\/]([A-Za-z0-9][\w.-]*)[\\/]SKILL\.md$/i;

  // Its file tools too: a sub-agent's reads and edits never reach the lead's terminal, so the hook
  // is the only way to tag them.
  const FILE_VERB = {
    Read: 'Read',
    Edit: 'Edited',
    MultiEdit: 'Edited',
    Write: 'Wrote',
    NotebookEdit: 'Edited',
  };
  native.agentEvents?.on?.(e => {
    if (!e?.paneId) return;
    const place = e.kind === 'tool' && FILE_VERB[e.tool] && e.detail && placeOf(e.paneId);
    if (place) {
      const key = e.agentId ? e.paneId + SUB + e.agentId : e.paneId;
      relative(e.detail, place).then(hit =>
        real(hit).then(ok => {
          if (!ok) return;
          if (!e.agentId) act(key, FILE_VERB[e.tool], hit.key);
          touch(key, hit.key);
        })
      );
    }
    if (e.kind === 'tool' && e.tool === 'Skill' && e.detail) useSkill(e.paneId, e.detail, true);
    else if (e.kind === 'tool' && e.tool === 'Read' && SKILL_FILE.test(e.detail || ''))
      useSkill(e.paneId, SKILL_FILE.exec(e.detail)[1], true);
    else if (e.kind === 'stop' && skillUse.delete(e.paneId)) {
      skillsChanged = true;
      schedule();
    }
  });

  // OpenCode sends the same steps (agent-hooks.js onStep) but no "stop": its ended turn
  // (desktop/agent-turns.js) is the end of its skill use.
  native.agentTurns?.on?.(t => {
    if (t?.agent === 'OpenCode' && t.endedAt && skillUse.delete(t.paneId)) {
      skillsChanged = true;
      schedule();
    }
  });
  agents.onChange(schedule);

  // A sub-agent's end: 19 fires tnai:team-changed for every change to its sub-agents (and for every
  // hook event, at most once a frame), so a render is asked for only when a sub-agent that still
  // holds tags is no longer running there (it replaced a look every 500 ms).
  window.addEventListener('tnai:team-changed', () => {
    for (const key of activity.keys()) {
      const [paneId, agentId] = key.split(SUB);
      if (!agentId) continue;
      const sub = window.TnaiTeam?.get?.(paneId)?.subs.find(x => x.agentId === agentId);
      if (!sub || (sub.status !== 'running' && sub.status !== 'starting')) {
        schedule();
        return;
      }
    }
  });

  window.TnaiFileActivity = {
    // Files an agent pane is working on right now, most recent first: project-folder paths, or
    // lanePath ("⎇<lane id>/<path>") for a file in its lane.
    forPane: paneId =>
      [...(activity.get(paneId) || new Map())].sort((a, b) => b[1] - a[1]).map(([path]) => path),
    // The agent's latest file action parsed from its output or credited from a folder change: {
    // verb, path, at } or null.
    now: paneId => {
      const a = lastAction.get(paneId);
      return a ? { ...a } : null;
    },
    // Skills this agent pane is using right now (seen in its output), most recent first: [{ name,
    // at }].
    skills: paneId =>
      [...(skillUse.get(paneId) || new Map()).values()]
        .sort((a, b) => b.at - a.at)
        .map(u => ({ ...u })),
    // Every skill ever seen in use, with when it was last used and by which agent: [{ name, at, by
    // }].
    lastUsed: () => Object.values(lastUsed).map(u => ({ ...u })),
    lastUsedSince: () => trackedSince,
    // A path from forPane/now -> { lane: { id, dir, branch } | null, path } (path inside the lane,
    // or in the project folder).
    lane: p => {
      const m = String(p || '').startsWith(LANE) && /^.([^/]+)\/(.*)$/su.exec(p);
      return m
        ? {
            lane: [...lanes.values()].find(l => l.id === m[1]) || { id: m[1], dir: '', branch: '' },
            path: m[2],
          }
        : { lane: null, path: String(p || '') };
    },
  };
})();
