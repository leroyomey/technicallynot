// Technically Not desktop · branch-changes.js — What an agent changed in its working folder, for
// the "Changes" section of a thread's Details tab (src/scripts/139-thread-details.js): the branch,
// lines added and removed and files changed since the default branch (uncommitted changes
// included), commits ahead and behind, uncommitted files, and the branch's pull request with its
// checks when the GitHub CLI (`gh`) is installed and signed in.
//
// The folder is the thread's own (an agent may work in its own git worktree), not always the
// project folder. Git runs through git-service.js's runner (no shell, never prompts, read-only
// commands take no locks). `gh` missing, signed out or pointed at a non-GitHub remote is not an
// error: the answer simply has no pull request. No token or key is ever read here.
'use strict';
const fs = require('fs');
const path = require('path');
const processStarter = require('./process-starter');

const GH_MS = 15000;

// Answers kept this long, and asks for the same folder that arrive together share one run. The
// window decides when to ask (when Details opens, when a turn ends, at most once a minute while
// the agent works); this only stops two copies of Details from running everything twice.
const KEEP_MS = 5000;

// A check run's ending, as GitHub names it, in three groups.
const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const PENDING_STATES = new Set(['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING']);

// The pull request's checks (`statusCheckRollup` of `gh pr view --json`) counted: a check run
// (GitHub Actions and other apps) has status and conclusion, an old-style status has state.
function countChecks(rollup) {
  const counts = { total: 0, passed: 0, failed: 0, pending: 0, failedNames: [] };
  (Array.isArray(rollup) ? rollup : []).forEach(item => {
    if (!item || typeof item !== 'object') return;
    counts.total++;
    const isStatus = item.__typename === 'StatusContext' || (item.state && !item.status);
    let group = 'failed';
    if (isStatus) {
      const state = String(item.state || '').toUpperCase();
      if (state === 'SUCCESS') group = 'passed';
      else if (PENDING_STATES.has(state)) group = 'pending';
    } else if (String(item.status || '').toUpperCase() !== 'COMPLETED') {
      group = 'pending';
    } else if (PASSED.has(String(item.conclusion || '').toUpperCase())) {
      group = 'passed';
    }
    counts[group]++;
    if (group === 'failed' && counts.failedNames.length < 5)
      counts.failedNames.push(String(item.name || item.context || 'A check').slice(0, 120));
  });
  return counts;
}

// The output of `gh pr view --json number,title,url,state,isDraft,statusCheckRollup` made into
// the plain facts the window shows; null when it is not a pull request with a GitHub address.
function parsePullRequest(text) {
  let data;
  try {
    data = JSON.parse(String(text || ''));
  } catch {
    return null;
  }
  if (!data || !/^https:\/\//i.test(String(data.url || ''))) return null;
  return {
    number: Number(data.number) || 0,
    title: String(data.title || '').slice(0, 300),
    url: String(data.url),
    state: String(data.state || '').toUpperCase(),
    draft: !!data.isDraft,
    checks: countChecks(data.statusCheckRollup),
  };
}

// Why gh gave no pull request, from its error: 'missing' (not installed), 'none' (this branch
// has none), 'signed-out', or 'unavailable' (no GitHub remote, offline, anything else).
function ghReason(error, stderr) {
  if (error && error.code === 'ENOENT') return 'missing';
  const words = String(stderr || error?.message || '');
  if (/no (open )?pull requests? found/i.test(words)) return 'none';
  if (/gh auth login|not logged in|authentication/i.test(words)) return 'signed-out';
  return 'unavailable';
}

// Runs gh in the folder from a worker thread, never asking anything and never updating itself.
function runGhHere(args, cwd) {
  const env = {
    ...process.env,
    GH_PROMPT_DISABLED: '1',
    GH_NO_UPDATE_NOTIFIER: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
  return processStarter.start(
    'gh',
    args,
    { cwd, env, timeout: GH_MS, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
    { rerun: true }
  );
}

// git: git-service.js's runner, git(args, { cwd, okCodes }) → { stdout }.
// parseStatus and numstat: git-service.js's readers. runGh(args, cwd) → { error, stdout, stderr }.
function createBranchChanges({ git, parseStatus, numstat, runGh = runGhHere, now = Date.now }) {
  const kept = new Map();

  // The default branch: what origin/HEAD points at, else main, else master. The local branch of
  // that name is compared with when it exists (agent worktrees branch from it), else origin's.
  async function defaultBranch(cwd) {
    const wanted = [
      'refs/remotes/origin/HEAD',
      'refs/heads/main',
      'refs/heads/master',
      'refs/remotes/origin/main',
      'refs/remotes/origin/master',
    ];
    const { stdout } = await git(['for-each-ref', '--format=%(refname)%09%(symref)', ...wanted], {
      cwd,
      okCodes: [0, 128],
    });
    const refs = new Map();
    stdout.split(/\r?\n/).forEach(line => {
      const [name, target] = line.split('\t');

      // for-each-ref also lists refs under these names (refs/heads/main/x): exact names only
      if (wanted.includes(name)) refs.set(name, target || '');
    });
    let name = '';
    const originHead = refs.get('refs/remotes/origin/HEAD') || '';
    if (originHead.startsWith('refs/remotes/origin/')) name = originHead.slice(20);
    else if (refs.has('refs/heads/main') || refs.has('refs/remotes/origin/main')) name = 'main';
    else if (refs.has('refs/heads/master') || refs.has('refs/remotes/origin/master'))
      name = 'master';
    if (!name) return null;
    if (refs.has('refs/heads/' + name)) return { name, ref: 'refs/heads/' + name };

    // origin/HEAD may name a branch that is not one of the five asked for (develop, trunk)
    const local = await git(['rev-parse', '--verify', '--quiet', 'refs/heads/' + name], {
      cwd,
      okCodes: [0, 1, 128],
    });
    if (local.stdout.trim()) return { name, ref: 'refs/heads/' + name };
    return { name, ref: 'refs/remotes/origin/' + name };
  }

  // The branch's pull request, or the reason there is none.
  async function pullRequest(cwd) {
    let answer;
    try {
      answer = await runGh(
        ['pr', 'view', '--json', 'number,title,url,state,isDraft,statusCheckRollup'],
        cwd
      );
    } catch (error) {
      return { pr: null, gh: ghReason(error, '') };
    }
    if (answer.error) return { pr: null, gh: ghReason(answer.error, answer.stderr) };
    const pr = parsePullRequest(answer.stdout);
    return { pr, gh: pr ? 'ok' : 'unavailable' };
  }

  async function readNow(cwd) {
    let top = '';
    try {
      top = (await git(['rev-parse', '--show-toplevel'], { cwd, okCodes: [0, 128] })).stdout.trim();
    } catch (error) {
      if (error.code === 'NoGit') return { repo: false };
      throw error;
    }
    if (!top) return { repo: false };
    const status = parseStatus(
      (
        await git(['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'], {
          cwd,
        })
      ).stdout
    );
    const base = await defaultBranch(cwd);
    const onBase = !!base && !status.detached && status.branch === base.name;
    const result = {
      repo: true,
      folder: cwd,
      branch: status.branch,
      detached: status.detached,
      base: base ? base.name : '',
      onBase,
      uncommitted: status.files.length,
      unpushed: status.upstream ? status.ahead : 0,
      ahead: 0,
      behind: 0,
      since: '',
      added: 0,
      removed: 0,
      files: 0,
      pr: null,
      gh: '',
    };

    // A repository with no commit yet has nothing to compare.
    if (status.initial) return result;

    // Lines are counted from where the branch left the default branch to the files on disk, so
    // what the agent has not committed yet counts too. On the default branch itself (or with
    // none), that is from the last commit: the uncommitted changes only.
    let from = 'HEAD';
    if (base && !onBase) {
      const counts = await git(['rev-list', '--left-right', '--count', base.ref + '...HEAD'], {
        cwd,
        okCodes: [0, 128],
      });
      const match = /^(\d+)\s+(\d+)/.exec(counts.stdout.trim());
      if (match) {
        result.behind = +match[1];
        result.ahead = +match[2];
      }
      const fork = await git(['merge-base', base.ref, 'HEAD'], { cwd, okCodes: [0, 1, 128] });
      if (fork.stdout.trim()) {
        from = fork.stdout.trim();
        result.since = base.name;
      }
    }
    const lines = await numstat([from], cwd);
    result.added = lines.added;
    result.removed = lines.removed;
    result.files = Object.keys(lines.files).length;

    // Only a branch of its own can have a pull request worth showing.
    if (result.branch && !onBase) Object.assign(result, await pullRequest(cwd));
    return result;
  }

  // The facts for one folder; { repo: false } for a folder that is not in a git repository.
  function read(folder) {
    const text = String(folder || '');
    if (!text || !path.isAbsolute(text)) return Promise.resolve({ repo: false });
    const cwd = path.resolve(text);
    let isFolder = false;
    try {
      isFolder = fs.statSync(cwd).isDirectory();
    } catch {}
    if (!isFolder) return Promise.resolve({ repo: false });
    const last = kept.get(cwd);
    if (last && now() - last.at < KEEP_MS) return last.answer;
    const entry = { at: now(), answer: readNow(cwd) };
    kept.set(cwd, entry);

    // a run that failed is not kept, and the list never outgrows the folders asked for lately
    entry.answer.catch(() => {
      if (kept.get(cwd) === entry) kept.delete(cwd);
    });
    if (kept.size > 50) kept.delete(kept.keys().next().value);
    return entry.answer;
  }

  return { read };
}

// pr-watch.js reads and merges a thread's pull request with the same gh runner and readers.
module.exports = { createBranchChanges, countChecks, parsePullRequest, ghReason, runGhHere };
