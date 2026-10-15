// Technically Not desktop · worktree-service.js — Per-agent git worktrees, so several agents can
// edit at once: a pane may start in its own worktree (new branch tnai/<agent>-<id> from HEAD) in
// userData/worktrees/<repo-hash>/, never inside the project folder. Lists Technically Not's
// worktrees (git's own list is the truth; worktrees.json only adds which pane/agent), change +
// commit counts, merge into the current branch (--no-ff, refused on a dirty tree, conflicts
// aborted), remove (confirmations for uncommitted work and unmerged branches). Pushes `git:changed`
// when a worktree's files change, and the same `fs:changes` batches as the project watcher tagged
// with the lane (watch-service watchLane). A branch deleted outside Technically Not is reported
// (branchMissing) and Remove still works. A resumed conversation that ran in a worktree starts in
// it again (paneCwd resumeId). A sub-agent that inherits its lead's worktree is recorded on it too
// (share: the record's `shared` pane ids), so it keeps that worktree after an app restart. A new
// worktree links each package folder's node_modules to the project folder's (a junction, kept only
// when git doesn't see it; unlinked before Remove), so it runs without a reinstall. A worktree no
// panel holds is free: free() lists them (newest first, the asking agent's first) and a pane
// started with worktree { branch } continues in one as its owner instead of minting a branch;
// list() marks a free one untouched for STALE_MS as stale.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const ptys = require('./pty-service');
const { watchLane } = require('./watch-service');
const { git, root, fail, wrap, requireRepo, parseStatus, numstat, WRITE_MS } =
  require('./git-service').internal;

let send = () => {},
  timer = null;
const watchers = new Map(); // worktree dir -> fs.FSWatcher

const baseDir = () => path.join(app.getPath('userData'), 'worktrees');
const recordsFile = () => path.join(baseDir(), 'worktrees.json');
const key = p => path.resolve(p).toLowerCase();
const inside = dir => key(dir).startsWith(key(baseDir()) + path.sep);
const laneOf = dir => ({
  id: path.basename(dir),
  dir: path.resolve(dir),
  branch: (readRecords().find(r => key(r.dir) === key(dir)) || {}).branch || '',
});
const repoHash = top => crypto.createHash('sha256').update(key(top)).digest('hex').slice(0, 12);
const slug = agent =>
  String(agent || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'agent';

// free and untouched this long: stale (older than today's and yesterday's sessions)
const STALE_MS = 3 * 24 * 3600 * 1000;
const changed = () => {
  clearTimeout(timer);
  timer = setTimeout(() => send('git:changed', { at: Date.now(), worktrees: true }), 300);
};

// Which pane and agent a worktree was made for, keyed by its branch (a worktree's branch is
// unique). shared: other panes working in it (inheriting sub-agents). The parsed file is kept until
// it changes (its time and size; writeRecords drops it): agent-lifecycle.js asks known() once per
// closed worktree agent on every turn start and end, and each call read and parsed the file.
// Callers get their own array of the same (never changed) records. Only this module writes the
// file, so its time is looked at again at most once a second (a publish asked 50 times: 50 stats).
let recordsCache = null,
  recordsSeen = 0; // { mtimeMs, size, list }; when the file's time was last looked at

function readRecords() {
  const now = Date.now();
  if (recordsCache && now - recordsSeen < 1000 && now >= recordsSeen)
    return recordsCache.list.slice();
  recordsSeen = now;
  let st;
  try {
    st = fs.statSync(recordsFile(), { throwIfNoEntry: false });
  } catch {} // no file yet (no worktree was ever made) costs no thrown error
  if (!st) {
    recordsCache = null;
    return [];
  }
  if (recordsCache && recordsCache.mtimeMs === st.mtimeMs && recordsCache.size === st.size)
    return recordsCache.list.slice();
  let list;
  try {
    const data = JSON.parse(fs.readFileSync(recordsFile(), 'utf8'));
    list = Array.isArray(data) ? data.filter(r => r && r.branch && r.dir) : [];
  } catch {
    recordsCache = null;
    return [];
  }
  recordsCache = { mtimeMs: st.mtimeMs, size: st.size, list };
  return list.slice();
}

function writeRecords(list) {
  fs.mkdirSync(baseDir(), { recursive: true });
  const temp = recordsFile() + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(list, null, 1));
  fs.renameSync(temp, recordsFile());
  recordsCache = null;
}
const running = dir =>
  ptys
    .list()
    .some(
      s =>
        s.running &&
        s.cwd &&
        (key(s.cwd) === key(dir) || key(s.cwd).startsWith(key(dir) + path.sep))
    );

// Technically Not worktrees of the connected repository with live counts: changes (uncommitted in
// the worktree) and commits not yet in the current branch.
// The connected project as a key, or '' when there is none.
function projectKey() {
  try {
    return key(root());
  } catch {
    return '';
  }
}

async function list() {
  const facts = await requireRepo();

  // The git calls below take a while. When the user opens another project meanwhile, this
  // list belongs to the project before, and its worktrees must not be watched again.
  const startedIn = projectKey();
  const current = (await git(['branch', '--show-current'])).stdout.trim();
  const out = (await git(['worktree', 'list', '--porcelain'])).stdout;
  const records = readRecords(),
    items = [];
  for (const block of out.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/),
      head = /^worktree (.+)$/.exec(lines[0] || '');
    if (!head || !inside(head[1])) continue;
    const dir = path.resolve(head[1]);
    const ref = (lines.find(l => l.startsWith('branch ')) || '')
      .slice(7)
      .replace(/^refs\/heads\//, '');
    const sha = (lines.find(l => l.startsWith('HEAD ')) || '').slice(5).trim(),
      tip = /^0*$/.test(sha) ? '' : sha; // all zeros: its branch ref is gone
    const detached = lines.includes('detached');
    const missing = lines.some(l => l.startsWith('prunable')) || !fs.existsSync(dir);

    // A detached worktree has no branch line: its record (by folder), else the name it was made
    // with (tnai/<folder name>).
    const rec = records.find(r => (ref ? r.branch === ref : key(r.dir) === key(dir))) || {};
    const branch = ref || rec.branch || 'tnai/' + path.basename(dir);
    const branchMissing =
      (
        await git(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], {
          okCodes: [0, 1, 128],
        })
      ).code !== 0; // deleted outside Technically Not
    let changes = 0,
      commits = 0;
    if (!missing)
      changes = parseStatus(
        (await git(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: dir }))
          .stdout
      ).files.length;

    // Commits at the worktree's HEAD (a detached one too) that the project folder's HEAD doesn't
    // have yet (its current branch when it has one).
    if (tip)
      commits =
        +(
          await git(['rev-list', '--count', 'HEAD..' + tip], { okCodes: [0, 128] })
        ).stdout.trim() || 0;

    // +/− lines a merge would bring in (merge base → tip), for the worktree popover on the agent's
    // Agent Tree row (35 land()).
    let added = 0,
      removed = 0;
    if (tip && commits) ({ added, removed } = await numstat(['HEAD...' + tip]));

    // Last activity: made, its panel closed, or its newest own commit (one not in the current
    // branch yet); the folder's time when nothing is recorded.
    let lastActive = Math.max(rec.createdAt || 0, rec.releasedAt || 0);
    if (tip && commits)
      lastActive = Math.max(
        lastActive,
        1000 *
          (+(await git(['log', '-1', '--format=%ct', tip], { okCodes: [0, 128] })).stdout.trim() ||
            0)
      );
    if (!lastActive && !missing)
      try {
        lastActive = fs.statSync(dir).mtimeMs;
      } catch {}
    const isRunning = !missing && running(dir),
      held = !!rec.paneId || !!(rec.shared || []).length;
    const stale =
      !held && !isRunning && !missing && !!lastActive && Date.now() - lastActive > STALE_MS;
    items.push({
      branch,
      dir,
      agent: rec.agent || '',
      paneId: rec.paneId || '',
      createdAt: rec.createdAt || 0,
      changes,
      commits,
      added,
      removed,
      missing,
      detached,
      branchMissing,
      head: tip,
      running: isRunning,
      lastActive,
      stale,
    });
  }
  if (projectKey() === startedIn) {
    watch(items.filter(i => !i.missing).map(i => i.dir));
    pruneRecords(facts.top, out);
  }
  return { current, items };
}

// Records of this repository's worktrees that git no longer lists and whose folder is gone (removed
// outside Technically Not, or by a `git worktree prune`) are dropped, so worktrees.json does not
// grow forever. A worktree git still lists stays recorded even when its folder is missing: Remove
// needs its record. `listing` is the `git worktree list --porcelain` text list() just read.
function pruneRecords(top, listing) {
  const listed = new Set();
  for (const line of listing.split(/\r?\n/)) {
    const head = /^worktree (.+)$/.exec(line);
    if (head) listed.add(key(path.resolve(head[1])));
  }
  const records = readRecords();
  const kept = records.filter(
    r => key(r.repo) !== key(top) || listed.has(key(r.dir)) || fs.existsSync(r.dir)
  );
  if (kept.length !== records.length) writeRecords(kept);
}

// Worktree files live outside the project folder, so watch them too: the worktree counts (35's
// panel badges and ⎇ popover) stay live without polling, and the lane's fs:changes batches drive
// worktree agents' file activity (13). Pane starts watch the recorded worktrees (no git call);
// list() re-syncs from git's own list.
function watchRecorded() {
  let top;
  try {
    top = root();
  } catch {
    watch([]);
    return;
  } // no project: nothing of an earlier one stays watched
  watch(
    readRecords()
      .filter(r => key(r.repo) === key(top) && inside(r.dir) && fs.existsSync(r.dir))
      .map(r => r.dir)
  );
}

function watch(dirs) {
  const wanted = new Set(dirs.map(key));
  for (const [dir, w] of watchers)
    if (!wanted.has(key(dir))) {
      try {
        w.close();
      } catch {}
      watchers.delete(dir);
    }
  for (const dir of dirs) {
    if ([...watchers.keys()].some(d => key(d) === key(dir))) continue;
    try {
      // skips .git, node_modules, build output (watch-service IGNORED)
      const w = watchLane(dir, laneOf(dir), changed);
      w.on('error', () => {
        try {
          w.close();
        } catch {}
        watchers.delete(dir);
      });
      watchers.set(dir, w);
    } catch {}
  }
}

// Each tracked package.json (depth ≤ 2) whose project-folder node_modules exists gets
// <worktree>/<dir>/node_modules → that folder (a junction: no admin on Windows). Kept only when git
// in the worktree doesn't report it (ignored), so it never counts as a change; any failure means no
// link, never a failed create.
async function linkModules(top, dir) {
  try {
    const files = (
      await git(['ls-files', '-z', '--', 'package.json', '*/package.json', '*/*/package.json'], {
        cwd: top,
      })
    ).stdout
      .split('\0')
      .filter(f => /^([^/]+\/){0,2}package\.json$/.test(f));
    for (const rel of files.map(f => path.posix.join(path.posix.dirname(f), 'node_modules'))) {
      const target = path.join(top, rel),
        link = path.join(dir, rel);
      try {
        if (
          !fs.lstatSync(target).isDirectory() ||
          fs.existsSync(link) ||
          !fs.existsSync(path.dirname(link))
        )
          continue;
        fs.symlinkSync(target, link, 'junction');
        if (
          (
            await git(['status', '--porcelain', '--untracked-files=all', '--', rel], { cwd: dir })
          ).stdout.trim()
        )
          unlinkModules(dir, [rel]);
      } catch {
        try {
          unlinkModules(dir, [rel]);
        } catch {}
      }
    }
  } catch {}
}

// Removes node_modules links (never what they point to) in a worktree: at the given rel paths, else
// at the root and two folder levels down. Remove runs this first.
function unlinkModules(dir, rels) {
  if (!rels) {
    rels = ['node_modules'];
    const sub = d => {
      try {
        return fs
          .readdirSync(path.join(dir, d), { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git')
          .map(e => path.posix.join(d, e.name));
      } catch {
        return [];
      }
    };
    for (const a of sub('')) {
      rels.push(a + '/node_modules');
      for (const b of sub(a)) rels.push(b + '/node_modules');
    }
  }
  for (const rel of rels) {
    const link = path.join(dir, rel);
    let st;
    try {
      st = fs.lstatSync(link);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      try {
        fs.unlinkSync(link);
      } catch {
        fs.rmdirSync(link);
      }
    }
  }
}

async function create(paneId, agent) {
  const facts = await requireRepo();
  if (
    (await git(['rev-parse', '--verify', '--quiet', 'HEAD'], { okCodes: [0, 1, 128] })).code !== 0
  )
    throw fail(
      'Make a first commit before giving an agent its own worktree (a worktree starts from the current commit).',
      'NoCommits'
    );
  const id = crypto.randomBytes(3).toString('hex'),
    name = slug(agent) + '-' + id,
    branch = 'tnai/' + name;
  const dir = path.join(baseDir(), repoHash(facts.top), name);
  if (!inside(dir))
    throw fail('Worktree folder is outside Technically Not’s app data.', 'SecurityError');
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    await git(['worktree', 'add', '-b', branch, dir, 'HEAD'], { timeout: WRITE_MS });
    await linkModules(facts.top, dir);
    writeRecords([
      ...readRecords()
        .filter(r => r.paneId !== paneId)
        .map(r => (r.shared ? { ...r, shared: r.shared.filter(id => id !== paneId) } : r)),
      {
        branch,
        dir,
        paneId: String(paneId || ''),
        agent: String(agent || ''),
        repo: facts.top,
        createdAt: Date.now(),
      },
    ]);
  } catch (error) {
    // Nothing half-made stays behind: without its record the worktree and its new branch would be
    // left with no owner, and nothing would ever offer to remove them.
    await undoCreate(dir, branch);
    throw error;
  }
  changed();
  watchRecorded();
  return { cwd: dir, branch };
}

// Undoes a create() that failed part way: the links first (nothing below may reach the project
// folder's node_modules), then the worktree, its folder and its branch. The branch was made just
// now with a random name, so no other work is on it. Each step runs on its own and never throws.
async function undoCreate(dir, branch) {
  try {
    if (inside(dir) && fs.existsSync(dir)) unlinkModules(dir);
  } catch {}
  try {
    await git(['worktree', 'remove', '--force', dir], { timeout: WRITE_MS, okCodes: [0, 128] });
  } catch {}
  try {
    if (inside(dir) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
  try {
    await git(['worktree', 'prune'], { timeout: WRITE_MS, okCodes: [0, 1] });
    await git(['branch', '-D', branch], { timeout: WRITE_MS, okCodes: [0, 1] });
  } catch {}
}

const holds = (r, paneId) =>
  !!paneId && (r.paneId === paneId || (Array.isArray(r.shared) && r.shared.includes(paneId)));
const ofRepo = (r, top) => key(r.repo) === key(top) && inside(r.dir) && fs.existsSync(r.dir);

// The pane's worktree for the connected repository (its own or one it shares), if it still exists
// on disk.
function forPane(paneId) {
  let top;
  try {
    top = root();
  } catch {
    return null;
  }
  const rec = readRecords().find(r => holds(r, paneId) && ofRepo(r, top));
  return rec ? { cwd: rec.dir, branch: rec.branch } : null;
}

// Records `paneId` as a second pane working in the worktree of `branch` (a sub-agent inheriting its
// lead's worktree); the owner stays the record's pane.
function share(paneId, branch) {
  let top;
  try {
    top = root();
  } catch {
    return null;
  }
  paneId = String(paneId || '');
  const records = readRecords(),
    rec = paneId && records.find(r => r.branch === branch && ofRepo(r, top));
  if (!rec) return null;
  if (!holds(rec, paneId)) {
    writeRecords(
      records.map(r =>
        r === rec
          ? { ...r, shared: [...(r.shared || []), paneId] }
          : { ...r, shared: (r.shared || []).filter(id => id !== paneId) }
      )
    );
    changed();
  }
  watchRecorded();
  return { cwd: rec.dir, branch: rec.branch };
}

// pty:start: { worktree: true } makes the pane's worktree (once); later starts of that pane
// (restart, resume) reuse it. A resumed conversation (resumeId) that ran in a worktree no pane
// holds now goes back into it: the CLI's conversation belongs to that folder. continueIn (worktree
// { branch } from the start picker's "Continue in ⎇ …"): the pane becomes the owner of that free
// worktree; no new branch.
async function paneCwd({ paneId, agent, worktree, resumeId, continueIn }) {
  const existing =
    forPane(paneId) ||
    (resumeId ? reattach(paneId, require('./agent-lifecycle').cwdOf(agent, resumeId)) : null);
  if (existing) {
    watchRecorded();
    return existing;
  }
  if (continueIn) return adopt(paneId, continueIn);
  if (!worktree) return null;
  return create(paneId, agent);
}
const isFree = r => !r.paneId && !(r.shared || []).length && !running(r.dir);

// The connected repository's worktrees no panel holds (still on disk), newest first (panel closed,
// else made); `agent`'s own first. No git calls.
function free(agent) {
  let top;
  try {
    top = root();
  } catch {
    return [];
  }
  const a = String(agent || ''),
    when = r => r.releasedAt || r.createdAt || 0;
  return readRecords()
    .filter(r => ofRepo(r, top) && isFree(r))
    .sort((x, y) => (y.agent === a) - (x.agent === a) || when(y) - when(x))
    .map(r => ({
      branch: r.branch,
      agent: r.agent || '',
      dir: r.dir,
      releasedAt: r.releasedAt || 0,
      createdAt: r.createdAt || 0,
    }));
}

// A pane continues in the free worktree of `branch` as its owner. Refused (never a silent new
// worktree) when it is gone or another panel took it.
function adopt(paneId, branch) {
  let top;
  try {
    top = root();
  } catch {
    throw fail('Open a project first.', 'NoProject');
  }
  const rec = readRecords().find(r => r.branch === branch && ofRepo(r, top));
  if (!rec)
    throw fail(
      'The worktree ' + branch + ' is no longer there (it was removed). Pick again.',
      'NoWorktree'
    );
  if (!isFree(rec))
    throw fail(
      'Another thread is working in the worktree ' + branch + ' now. Pick again.',
      'NotFree'
    );
  writeRecords(
    readRecords().map(r =>
      r.branch === rec.branch
        ? { ...r, paneId: String(paneId || ''), shared: [] }
        : { ...r, shared: (r.shared || []).filter(id => id !== paneId) }
    )
  );
  changed();
  watchRecorded();
  return { cwd: rec.dir, branch: rec.branch };
}

// The Technically Not worktree record (still on disk) of the repository `repo` (default: the
// connected one) at `dir`, or null.
function known(dir, repo) {
  let top = repo;
  if (!top)
    try {
      top = root();
    } catch {
      return null;
    }
  if (!dir || !top) return null;

  // once, and each record's own key is kept with it (50 asks over 50 records resolved 5,000 paths
  // per publish)
  const k = key(dir);
  return readRecords().find(r => dirKey(r) === k && ofRepo(r, top)) || null;
}
const dirKeys = new WeakMap(),
  dirKey = r => {
    let k = dirKeys.get(r);
    if (k === undefined) dirKeys.set(r, (k = key(r.dir)));
    return k;
  };

// The connected repository's Technically Not worktrees still on disk, oldest first, as { id (folder
// name), dir, branch }: the file rail's Main | ⎇ … toggle (09). No git call (records only), so it
// can follow every git:changed.
function lanes() {
  let top;
  try {
    top = root();
  } catch {
    return [];
  }
  return readRecords()
    .filter(r => ofRepo(r, top))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map(r => ({ id: path.basename(r.dir), dir: path.resolve(r.dir), branch: r.branch }));
}

// A resumed pane goes back into the worktree at `dir`: as its owner when no pane owns it now, else
// as a pane sharing it.
function reattach(paneId, dir) {
  const rec = known(dir);
  if (!rec) return null;
  if (rec.paneId) return share(paneId, rec.branch);
  writeRecords(
    readRecords().map(r =>
      r.branch === rec.branch && key(r.dir) === key(rec.dir)
        ? {
            ...r,
            paneId: String(paneId || ''),
            shared: (r.shared || []).filter(id => id !== paneId),
          }
        : r
    )
  );
  changed();
  return { cwd: rec.dir, branch: rec.branch };
}

// paneId → branch for every pane with a worktree in the connected repository (no git calls; for the
// pane badges).
function panes() {
  let top;
  try {
    top = root();
  } catch {
    return {};
  }
  const map = {};
  for (const r of readRecords())
    if (key(r.repo) === key(top) && fs.existsSync(r.dir))
      for (const id of [r.paneId, ...(r.shared || [])]) if (id) map[id] = r.branch;
  return map;
}

// A closed pane gives up its worktree, owned or shared (the worktree and its work stay; "Continue
// in ⎇" in the picker starts an agent in it again).
function release(paneId) {
  const records = readRecords();
  if (!paneId || !records.some(r => holds(r, paneId))) return true;
  writeRecords(
    records.map(r =>
      holds(r, paneId)
        ? {
            ...r,
            paneId: r.paneId === paneId ? '' : r.paneId,
            shared: (r.shared || []).filter(id => id !== paneId),
            releasedAt: Date.now(),
          }
        : r
    )
  );
  changed();
  return true;
}

async function find(branch) {
  const { current, items } = await list();
  const item = items.find(i => i.branch === String(branch || ''));
  if (!item)
    throw fail(
      '“' + branch + '” is not one of Technically Not’s worktrees in this repository.',
      'NoWorktree'
    );
  return { current, item };
}
const gitSaid = text =>
  String(text || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(0, 6)
    .join('\n');

// Merges the worktree's branch into the current branch with a merge commit. Uncommitted work in the
// worktree is not included (reported back).
async function merge(branch) {
  const { current, item } = await find(branch);
  if (!current)
    throw fail('HEAD is detached in the project folder. Switch to a branch first.', 'Detached');
  if (item.branchMissing && !item.detached)
    throw fail(
      'The branch ' +
        item.branch +
        ' of this worktree no longer exists (it was deleted outside Technically Not), so there is nothing to merge. Remove clears the worktree.',
      'BranchMissing'
    );
  const main = parseStatus(
    (await git(['status', '--porcelain=v2', '-z', '--untracked-files=no'])).stdout
  );
  if (main.files.length)
    throw fail(
      'The project folder has uncommitted changes (' +
        main.files.length +
        ' file' +
        (main.files.length > 1 ? 's' : '') +
        '). Commit or stash them first, so the merge can be undone cleanly.',
      'DirtyTree'
    );
  if (!item.commits) return { upToDate: true, into: current, uncommitted: item.changes };

  // a detached worktree: its own HEAD commit
  const target = item.detached ? item.head : 'refs/heads/' + item.branch;
  try {
    await git(
      [
        'merge',
        '--no-ff',
        '--no-edit',
        '-m',
        'Merge Technically Not worktree ' + item.branch + ' into ' + current,
        target,
      ],
      { timeout: WRITE_MS }
    );
  } catch (error) {
    const conflicts = (
      await git(['diff', '--name-only', '--diff-filter=U'], { okCodes: [0, 1, 128] })
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    const merging =
      (await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { okCodes: [0, 1, 128] })).code ===
      0;
    if (merging) await git(['merge', '--abort'], { timeout: WRITE_MS });
    if (conflicts.length)
      throw fail(
        'Merging ' +
          item.branch +
          ' into ' +
          current +
          ' conflicts in ' +
          conflicts.length +
          ' file' +
          (conflicts.length > 1 ? 's' : '') +
          ': ' +
          conflicts.slice(0, 8).join(', ') +
          (conflicts.length > 8 ? ', …' : '') +
          '. The merge was aborted; nothing changed. Merge ' +
          current +
          ' into the worktree and resolve the conflicts there, then try again.',
        'Conflict'
      );
    throw fail(
      'The merge did not happen' +
        (merging ? ' and was aborted' : '') +
        '; nothing changed.\n\ngit said: ' +
        gitSaid(error.message),
      error.code
    );
  }
  return { merged: item.commits, into: current, uncommitted: item.changes };
}

// Removes a worktree. Asks first ({ needsConfirm }) when it has uncommitted changes (discard) or
// its branch isn't merged (deleteBranch true/false).
async function remove(branch, options = {}) {
  const { current, item } = await find(branch);
  if (item.running)
    throw fail('A thread is still running in this worktree. Stop it first.', 'Busy');
  const merged =
    !item.commits ||
    (!!item.head &&
      (await git(['merge-base', '--is-ancestor', item.head, 'HEAD'], { okCodes: [0, 1, 128] }))
        .code === 0);
  const ask = {
    changes: item.changes && !options.discard ? item.changes : 0,
    unmerged: !merged && typeof options.deleteBranch !== 'boolean' ? item.commits : 0,
  };
  if (ask.changes || ask.unmerged)
    return { needsConfirm: true, branch: item.branch, current, ...ask };

  // links first: nothing below can reach the project folder's node_modules
  if (inside(item.dir) && fs.existsSync(item.dir)) unlinkModules(item.dir);
  if (item.missing) await git(['worktree', 'prune'], { timeout: WRITE_MS });
  else
    await git(['worktree', 'remove', ...(item.changes ? ['--force'] : []), item.dir], {
      timeout: WRITE_MS,
    });
  const w = watchers.get(item.dir);
  if (w) {
    try {
      w.close();
    } catch {}
    watchers.delete(item.dir);
  }
  if (inside(item.dir) && fs.existsSync(item.dir))
    fs.rmSync(item.dir, { recursive: true, force: true });
  await git(['worktree', 'prune'], { timeout: WRITE_MS, okCodes: [0, 1] });
  let branchDeleted = false;

  // A branch deleted outside Technically Not has nothing left to delete. A merged detached HEAD can
  // leave its branch unmerged: -d then keeps it (no error).
  if (!item.branchMissing && (merged || options.deleteBranch === true))
    branchDeleted =
      (
        await git(['branch', merged ? '-d' : '-D', item.branch], {
          timeout: WRITE_MS,
          okCodes: merged ? [0, 1] : [0],
        })
      ).code === 0;
  writeRecords(readRecords().filter(r => r.branch !== item.branch));
  changed();
  return { removed: true, branch: item.branch, branchDeleted, branchMissing: item.branchMissing };
}

module.exports = {
  init(sender) {
    send = sender;
  },
  stop() {
    watch([]);
    clearTimeout(timer);
  },
  // The project folder changed (main.js rootChanged): the old project's worktree watchers stop, the
  // new project's recorded worktrees are watched.
  rootChanged() {
    clearTimeout(timer);
    watchRecorded();
  },
  paneCwd,
  known: (dir, repo) => !!known(dir, repo),
  forPane: paneId => forPane(String(paneId || '')),
  share: (paneId, branch) => share(String(paneId || ''), String(branch || '')),
  list: wrap(list),
  merge: wrap(merge),
  remove: wrap(remove),
  panes: () => panes(),
  lanes: () => lanes(),
  free: agent => free(agent),
  release: paneId => release(String(paneId || '')),
  baseDir,
};
