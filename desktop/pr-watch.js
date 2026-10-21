// Technically Not desktop · pr-watch.js — "Watch pull request #N" and "Merge pull request #N" for
// a thread (the thread actions menu, src/scripts/154-thread-actions.js, and `tnai pr` for agents).
//
// Watching: GitHub cannot push to a desktop app, so while a thread's pull request is watched this
// asks GitHub (`gh pr view`) every EVERY_MS. This is the one labeled poll of the thread features:
// it runs only while a pull request is watched, and it stops when the thread closes, the pull
// request is merged or closed, or the user or the agent stops watching. A change (checks finished,
// a check failed, a new comment, merged or closed) is handed to `deliver(paneId, event)`; main.js
// passes it to the window, which tells the thread's agent in one quiet line (154).
//
// Merging: `gh pr merge` in the thread's own folder, only after a fresh look shows the pull request
// open, not a draft and its checks passed, and only for the commit that was checked
// (`--match-head-commit`). The merge method is the first the repository allows: merge commit,
// squash, rebase. The branch is never deleted here (an agent's worktree may stand on it).
//
// gh runs with no shell, never prompts and never updates itself (branch-changes.js `runGhHere`).
// No token or key is read here.
'use strict';
const branchChanges = require('./branch-changes');

// How often a watched pull request is asked about: 3 minutes, what the thread says.
const EVERY_MS = 180000;

// The fields one look asks for.
const FIELDS = 'number,title,url,state,isDraft,statusCheckRollup,comments,reviews,headRefOid';

// ---------------------------------------------------------------- reading one look

// One look at a pull request as plain facts: branch-changes.js' facts, plus the comment count and
// the commit its checks ran on. null when it is not a pull request with a GitHub address.
function parseLook(text) {
  const facts = branchChanges.parsePullRequest(text);
  if (!facts) return null;
  let data = {};
  try {
    data = JSON.parse(String(text || ''));
  } catch {}
  const comments = Array.isArray(data.comments) ? data.comments.length : 0;

  // a review counts as a comment when it says something
  const reviews = Array.isArray(data.reviews)
    ? data.reviews.filter(review => String(review?.body || '').trim()).length
    : 0;
  return {
    ...facts,
    comments: comments + reviews,
    head: /^[0-9a-f]{7,64}$/i.test(String(data.headRefOid || '')) ? String(data.headRefOid) : '',
  };
}

// Open, not a draft, at least one check and every check passed: the only time Merge shows.
function mergeable(look) {
  const checks = look?.checks;
  return (
    !!look &&
    look.state === 'OPEN' &&
    !look.draft &&
    !!checks &&
    checks.total > 0 &&
    checks.failed === 0 &&
    checks.pending === 0
  );
}

const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

// What changed between two looks, as one line ("#42: a check failed · lint"), or '' when nothing
// worth telling changed. `done` is true when watching should stop (merged or closed).
function compare(before, after) {
  if (!before || !after) return { line: '', done: false };
  const parts = [];
  let done = false;
  if (after.state === 'MERGED' && before.state !== 'MERGED') {
    parts.push('merged');
    done = true;
  } else if (after.state === 'CLOSED' && before.state !== 'CLOSED') {
    parts.push('closed without merging');
    done = true;
  }
  const was = before.checks || {};
  const now = after.checks || {};
  const newFailed = (now.failedNames || []).filter(name => !(was.failedNames || []).includes(name));
  if (now.failed > (was.failed || 0) || newFailed.length) {
    const names = (newFailed.length ? newFailed : now.failedNames || []).join(', ');
    parts.push(
      (now.failed === 1 ? 'a check failed' : now.failed + ' checks failed') +
        (names ? ' · ' + names : '')
    );
  } else if (
    now.total > 0 &&
    now.pending === 0 &&
    now.failed === 0 &&
    (was.pending > 0 || was.failed > 0 || was.total !== now.total)
  ) {
    parts.push('checks passed');
  }
  const added = (after.comments || 0) - (before.comments || 0);
  if (added > 0) parts.push(plural(added, 'new comment'));
  return { line: parts.length ? '#' + after.number + ': ' + parts.join(' · ') : '', done };
}

// What the agent is told with the line: what to do about it.
function messageFor(line, look) {
  const number = look.number;
  const asks = [];
  if (/check(s)? failed/.test(line))
    asks.push('look at the failing check (gh pr checks ' + number + '), fix the cause and push');
  if (/new comment/.test(line))
    asks.push(
      'read the new comments (gh pr view ' + number + ' --comments) and answer or handle them'
    );
  const ask = asks.length
    ? ' Please ' + asks.join(', then ') + '. If a fix needs the user, ask them instead.'
    : ' Nothing is asked of you; tell the user in one line if it matters to your task.';
  return line + ' (' + look.url + ').' + ask;
}

// ---------------------------------------------------------------- the watcher

// cwdOf(paneId) → the thread's own folder or ''; deliver(paneId, event) where event =
// { number, url, line, message, done }; changed() after the watched list changed.
function createPrWatch({
  cwdOf,
  deliver,
  changed = () => {},
  runGh = branchChanges.runGhHere,
  setTimer = setInterval,
  clearTimer = clearInterval,
  every = EVERY_MS,
}) {
  // paneId → { number, url, title, folder, last, timer, asking }
  const watched = new Map();

  async function look(folder, number) {
    const args = ['pr', 'view'];
    if (number) args.push(String(number));
    args.push('--json', FIELDS);
    let answer;
    try {
      answer = await runGh(args, folder);
    } catch (error) {
      return { error: branchChanges.ghReason(error, '') };
    }
    if (answer.error) return { error: branchChanges.ghReason(answer.error, answer.stderr) };
    const facts = parseLook(answer.stdout);
    return facts ? { look: facts } : { error: 'unavailable' };
  }

  const WHY = {
    missing: 'The GitHub CLI (gh) is not installed on this computer.',
    'signed-out': 'The GitHub CLI (gh) is not signed in. Run gh auth login in Your terminal.',
    none: 'This branch has no pull request yet.',
    unavailable: 'GitHub did not answer about this branch (no GitHub remote, or offline).',
  };
  const fail = reason => ({ ok: false, error: WHY[reason] || WHY.unavailable });

  async function tick(paneId) {
    const entry = watched.get(paneId);
    if (!entry || entry.asking) return;
    entry.asking = true;
    let answer;
    try {
      answer = await look(entry.folder, entry.number);
    } finally {
      entry.asking = false;
    }

    // unwatched while it asked, or GitHub did not answer this time: try at the next tick
    if (watched.get(paneId) !== entry || !answer.look) return;
    const { line, done } = compare(entry.last, answer.look);
    entry.last = answer.look;
    if (done) unwatch(paneId);
    if (line)
      deliver(paneId, {
        number: entry.number,
        url: entry.url,
        line,
        message: messageFor(line, answer.look),
        done,
      });
  }

  // Starts watching the thread's pull request (its branch's, or `number`).
  async function watch(paneId, number) {
    const folder = cwdOf(String(paneId || ''));
    if (!folder) return { ok: false, error: 'That thread has no folder.' };
    const wanted = Number(number) > 0 ? Math.floor(Number(number)) : 0;
    const answer = await look(folder, wanted);
    if (!answer.look) return fail(answer.error);
    const pr = answer.look;
    if (pr.state !== 'OPEN')
      return { ok: false, error: 'Pull request #' + pr.number + ' is not open.' };
    unwatch(paneId, true);
    const entry = {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      folder,
      last: pr,
      asking: false,
      timer: null,
    };
    entry.timer = setTimer(() => tick(paneId), every);
    entry.timer?.unref?.();
    watched.set(paneId, entry);
    changed();
    return { ok: true, number: pr.number, url: pr.url, everyMin: Math.round(every / 60000) };
  }

  function unwatch(paneId, quiet) {
    const entry = watched.get(String(paneId || ''));
    if (!entry) return { ok: true, was: 0 };
    clearTimer(entry.timer);
    watched.delete(String(paneId));
    if (!quiet) changed();
    return { ok: true, was: entry.number };
  }

  // The watched pull requests, for the window: [{ paneId, number, url, everyMin }].
  const list = () =>
    [...watched].map(([paneId, entry]) => ({
      paneId,
      number: entry.number,
      url: entry.url,
      everyMin: Math.round(every / 60000),
    }));

  // The repository's first allowed merge method.
  async function mergeMethod(folder) {
    try {
      const answer = await runGh(
        ['repo', 'view', '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed'],
        folder
      );
      const data = JSON.parse(String(answer.stdout || '{}'));
      if (data.mergeCommitAllowed) return '--merge';
      if (data.squashMergeAllowed) return '--squash';
      if (data.rebaseMergeAllowed) return '--rebase';
    } catch {}
    return '--merge';
  }

  // Merges the thread's pull request `number` after a fresh look shows it still may be merged.
  async function merge(paneId, number) {
    const folder = cwdOf(String(paneId || ''));
    if (!folder) return { ok: false, error: 'That thread has no folder.' };
    const wanted = Number(number) > 0 ? Math.floor(Number(number)) : 0;
    if (!wanted) return { ok: false, error: 'Which pull request?' };
    const answer = await look(folder, wanted);
    if (!answer.look) return fail(answer.error);
    const pr = answer.look;
    if (!mergeable(pr))
      return {
        ok: false,
        error:
          'Pull request #' +
          pr.number +
          ' cannot be merged now: it must be open, not a draft, and its checks must have passed.',
      };
    const args = ['pr', 'merge', String(pr.number), await mergeMethod(folder)];
    if (pr.head) args.push('--match-head-commit', pr.head);
    let result;
    try {
      result = await runGh(args, folder);
    } catch (error) {
      result = { error };
    }
    if (result.error) {
      const words = String(result.stderr || result.error?.message || '')
        .trim()
        .split(/\r?\n/)[0];
      return {
        ok: false,
        error: 'GitHub did not merge #' + pr.number + (words ? ': ' + words.slice(0, 200) : '.'),
      };
    }
    unwatch(paneId);
    return { ok: true, number: pr.number, url: pr.url };
  }

  // A thread closed: its watch ends with it.
  const forget = paneId => unwatch(paneId);

  // Everything stops (the app quits).
  function stop() {
    for (const paneId of [...watched.keys()]) unwatch(paneId, true);
  }

  // `tnai pr [watch [NUMBER] | unwatch]` from the thread's own agent (agent-mesh.js).
  async function command(paneId, action, number) {
    if (action === 'watch') {
      const result = await watch(paneId, number);
      return result.ok
        ? {
            ok: true,
            text:
              'Watching pull request #' +
              result.number +
              ' (' +
              result.url +
              '). Technically Not asks GitHub every ' +
              result.everyMin +
              ' minutes and tells you when checks finish, a check fails or a comment comes in.',
          }
        : result;
    }
    if (action === 'unwatch') {
      const result = unwatch(paneId);
      return {
        ok: true,
        text: result.was
          ? 'Stopped watching pull request #' + result.was + '.'
          : 'No pull request was watched.',
      };
    }
    const entry = watched.get(String(paneId || ''));
    return {
      ok: true,
      text: entry
        ? 'Watching pull request #' +
          entry.number +
          ' (' +
          entry.url +
          '), asked every ' +
          Math.round(every / 60000) +
          ' minutes.'
        : 'No pull request is watched for you. tnai pr watch [NUMBER] starts it.',
    };
  }

  return { watch, unwatch, list, merge, forget, stop, command, _tick: tick };
}

module.exports = { createPrWatch, parseLook, mergeable, compare, messageFor, EVERY_MS };
