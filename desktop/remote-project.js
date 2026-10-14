// Technically Not · remote-project.js — "same project, seen" (piece
// P2). Read-only. Which project is open on this computer
// as two commit ids, and how far a paired computer's copy of the same project is from this one,
// counted in commits. Uncommitted work is not compared. Pure Node: git's runner is handed in
// (git-service.js: execFile, no shell, the project folder, a time limit), so are the clock and the
// timers.
// - A project is known by the id of its repository's first commit, never by its folder or name
// ("Handing work between computers", 1). A copy cut short (a shallow clone) or a
// history joined from two beginnings can read as another project.
// - The other computer's ids arrive over the link and are untrusted: they are used only after
// shapeProject (lower-case hex of a fixed length) and only as one argument of one read-only git
// command.
// - A paired computer decides how often its ids change, so it must not decide how often git runs
// here: createRelater below.
const path = require('path');
const crypto = require('crypto');
const { shapeProject, projectKey } = require('./remote-api.js');

const RELATE_MS = 3 * 1000; // per computer: at most one comparison that runs git in this time

// a folder named by its name (no git project yet) is asked again after this, when its key is next
// needed
const KEY_AGAIN_MS = 60 * 1000;

// git(args, { okCodes }) → Promise<{ stdout, stderr, code }>, probe() → Promise<{ repo, top, gitDir
// }> (both git-service.js `internal`). watch(gitDir) starts git-service's watcher on the
// repository's own files, so a new commit is pushed (`git:changed`), not polled.
function createProjectReader({ git, probe, watch = () => {} }) {
  // What does not change while one folder stays open is asked for once (tnai-best-practices: cache
  // git probes until the root changes): that the folder is its own repository, and the repository's
  // first commit. Only the current commit is read on every change.
  let facts = null,
    root = '',
    gen = 0;

  // Another folder was opened (or none): what was known belongs to the old one.
  function reset() {
    facts = null;
    root = '';
    gen++;
  }

  // → { root, head }, or null: no folder, a folder that is not its own git repository, git missing,
  // or no commit yet.
  async function read() {
    const g = gen;
    try {
      if (!facts) {
        const f = await probe();

        // the folder changed while git answered: this answer is about the old one
        if (g !== gen) return null;
        if (!f || !f.repo) return null;
        facts = f;
      }
      try {
        watch(facts.gitDir);
      } catch {
        /* without the watcher the ids are read when a session starts */
      }
      const head = (
        await git(['rev-parse', '--verify', '--quiet', 'HEAD'], { okCodes: [0, 1, 128] })
      ).stdout.trim();
      if (g !== gen) return null;
      if (!head) {
        facts = null;
        root = '';
        return null;
      } // no commit, or no repository any more: looked at afresh next time
      if (!root) {
        const roots = (await git(['rev-list', '--max-parents=0', 'HEAD'])).stdout
          .split(/\r?\n/)
          .filter(Boolean);
        if (g !== gen) return null;
        root = roots.length ? roots[roots.length - 1] : ''; // several beginnings: the oldest
      }
      return root ? shapeProject({ root, head }) : null;
    } catch {
      if (g === gen) {
        facts = null;
        root = '';
      }
      return null;
    }
  }

  // mine: this computer's project, theirs: a paired computer's. → null when it is not the same
  // project (nothing is said about another one), else { rel } as seen from here: 'same' commit ·
  // 'behind' { n }: it lacks n commits this computer has · 'ahead' { n }: it has n more, all of
  // them also in this copy · 'apart' { behind, ahead }: each has commits the other lacks ·
  // 'missing': its commit is not in this copy, so it has work this computer does not have (how much
  // cannot be counted here) · 'unknown': could not be compared.
  async function relate(mine, theirs) {
    mine = shapeProject(mine);
    theirs = shapeProject(theirs);
    if (!mine || !theirs || mine.root !== theirs.root) return null;
    if (!mine.head || !theirs.head) return { rel: 'unknown' };
    if (mine.head === theirs.head) return { rel: 'same' };
    let r;
    try {
      r = await git(['rev-list', '--left-right', '--count', mine.head + '...' + theirs.head], {
        okCodes: [0, 128],
      });
    } catch {
      return { rel: 'unknown' };
    }
    if (r.code !== 0)
      return /not a git repository/i.test(r.stderr) ? { rel: 'unknown' } : { rel: 'missing' };
    const m = /^(\d+)\s+(\d+)\s*$/.exec(r.stdout);
    if (!m) return { rel: 'unknown' };
    const here = +m[1],
      there = +m[2];
    return here && there
      ? { rel: 'apart', behind: here, ahead: there }
      : here
        ? { rel: 'behind', n: here }
        : there
          ? { rel: 'ahead', n: there }
          : { rel: 'same' };
  }
  return { read, relate, reset };
}

// The comparisons, kept ready for the Devices page. set(peerId, mine, theirs) whenever either
// side's ids change; get(peerId) → the answer for the page, or null (not the same project). One git
// comparison at a time for all computers, at most one per computer every `gap` with the newest ids
// winning, none when the ids alone answer it, and an answer is kept until one of the two commits
// changes. While a comparison waits or runs the answer is 'unknown': an old count is never shown
// beside new commits. on(peerId) fires when an answer arrives.
function createRelater({
  relate,
  on = () => {},
  now = Date.now,
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h) },
  gap = RELATE_MS,
}) {
  // peer id → { key, value, want: { key, mine, theirs } | null, timer, running, last }
  const peers = new Map();
  let chain = Promise.resolve(),
    stopped = false;
  const end = id => {
    const e = peers.get(id);
    if (e && e.timer) timers.clear(e.timer);
    peers.delete(id);
  };

  function plan(id, e) {
    if (stopped || e.running || e.timer || !e.want) return;
    const wait = e.last + gap - now();
    if (wait > 0) {
      e.timer = timers.set(() => {
        e.timer = null;
        plan(id, e);
      }, wait);
      return;
    }
    const job = e.want;
    e.want = null;
    e.running = true;
    e.last = now();

    // Its turn in the line may come late: git is not run for a computer that left, after a stop, or
    // for ids that are no longer the newest.
    chain = chain
      .then(() =>
        stopped || peers.get(id) !== e || e.key !== job.key ? null : relate(job.mine, job.theirs)
      )
      .catch(() => null)
      .then(value => {
        e.running = false;
        if (stopped || peers.get(id) !== e) return;
        if (e.key === job.key) {
          e.value = value && typeof value.rel === 'string' ? value : { rel: 'unknown' };
          try {
            on(id);
          } catch {
            /* a listener's error is not ours */
          }
        }
        plan(id, e);
      });
  }
  return {
    set(id, mine, theirs) {
      mine = shapeProject(mine);
      theirs = shapeProject(theirs);
      if (stopped || !mine || !theirs || mine.root !== theirs.root) return end(id);
      const key = mine.head + '|' + theirs.head;
      let e = peers.get(id);
      if (!e)
        peers.set(
          id,
          (e = { key: null, value: null, want: null, timer: null, running: false, last: -Infinity })
        );
      if (e.key === key) return;
      e.key = key;
      e.want = null;
      if (!mine.head || !theirs.head) {
        e.value = { rel: 'unknown' };
        return;
      }
      if (mine.head === theirs.head) {
        e.value = { rel: 'same' };
        return;
      }
      e.value = { rel: 'unknown' };
      e.want = { key, mine, theirs };
      plan(id, e);
    },
    get(id) {
      const e = peers.get(id);
      return e && e.value ? { ...e.value } : null;
    },
    forget: end,
    stop() {
      stopped = true;
      for (const id of [...peers.keys()]) end(id);
    },
  };
}

// Which project a folder is, as one key of a fixed form (section 6e): what lets a computer list
// only the agents another computer runs in the project that is open here. keyOf(folder) →
// Promise<key>, peek(folder) → the key if it is already known, else ''.
// - A folder that is its own git repository with a commit: the id of the first commit, the same id
// `read` above names it by.
// - Any other folder (no git, no commit yet, a folder inside someone else's repository): the letter
// n and 40 hex characters of a hash of the folder's own name in lower case. The name never leaves;
// two folders of the same name read as one project.
// - Asked once per folder: a first commit never changes. A name key is asked again after `again`,
// since the folder can become a git project. git runs with the folder as one argument and no shell,
// read-only, at most twice per folder and time.
function createProjectKeys({
  git,
  now = Date.now,
  again = KEY_AGAIN_MS,
  fold = p => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p),
}) {
  const known = new Map(),
    // folded folder → { key, firm, at } · → the Promise of a question that is out
    asking = new Map();
  const place = dir =>
    typeof dir === 'string' && dir && path.isAbsolute(dir) ? path.resolve(dir) : '';
  const nameKey = dir =>
    'n' +
    crypto
      .createHash('sha256')
      .update((path.basename(dir) || dir).normalize('NFC').toLowerCase())
      .digest('hex')
      .slice(0, 40);

  async function ask(dir) {
    try {
      const top = (
        await git(['rev-parse', '--show-toplevel'], { cwd: dir, okCodes: [0, 128] })
      ).stdout.split(/\r?\n/)[0];
      if (top && fold(path.resolve(top)) === fold(dir)) {
        const roots = (
          await git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: dir, okCodes: [0, 128] })
        ).stdout
          .split(/\r?\n/)
          .filter(Boolean);

        // several beginnings: the oldest, as `read` does
        const root = roots.length ? projectKey(roots[roots.length - 1]) : '';
        if (root && root[0] !== 'n') return { key: root, firm: true, at: now() };
      }
    } catch {
      // no git, a folder that is gone, a time limit: named by its name below, and asked again later
    }
    return { key: nameKey(dir), firm: false, at: now() };
  }
  const fresh = e => !!e && (e.firm || now() - e.at < again);
  return {
    keyOf(folder) {
      const dir = place(folder);
      if (!dir) return Promise.resolve('');
      const k = fold(dir),
        e = known.get(k);
      if (fresh(e)) return Promise.resolve(e.key);
      if (!asking.has(k))
        asking.set(
          k,
          ask(dir).then(v => {
            known.set(k, v);
            asking.delete(k);
            return v.key;
          })
        );
      return asking.get(k);
    },
    peek(folder) {
      const dir = place(folder),
        e = dir ? known.get(fold(dir)) : null;
      return e ? e.key : '';
    },
    // The folder's own git files changed (a first commit may exist now): a name key is asked for
    // again at the next keyOf. → true when there was such a key, so the caller builds again what it
    // made from it.
    changed(folder) {
      const dir = place(folder),
        e = dir ? known.get(fold(dir)) : null;
      if (!e || e.firm) return false;
      e.at = -Infinity;
      return true;
    },
  };
}

module.exports = { createProjectReader, createRelater, createProjectKeys, RELATE_MS, KEY_AGAIN_MS };
