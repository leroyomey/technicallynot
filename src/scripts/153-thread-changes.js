// Technically Not · 153-thread-changes.js — Desktop app only: what a thread's agent changed in its
// own folder (desktop/branch-changes.js through `tnaiNative.git.changes`), kept by folder, and the
// "Changes" section of a thread's Details tab built from it (139 places and repaints it).
//
// Git and gh run only when something asks with `ask(folder, gap)`: Details when it opens, when the
// agent's turn ends and at most once a minute while it works (139), and the thread actions button
// once per folder and when its menu opens (154). A paint only reads what is kept here. Each new
// answer fires `tnai:thread-changes` with { folder } on window.
//
// The same section is the thread's git view (feature build 2026-10-28, feature 9): the last
// commits and the other local branches, all read only.
//
// window.TnaiThreadChanges = { ask, get, known, wantFor, build, OPEN_MS, TURN_MS }.
(() => {
  'use strict';
  const native = window.tnaiNative;

  // How old an answer may be before it is asked again, by the moment of asking.
  const EVERY_MS = 60000;
  const OPEN_MS = 10000;
  const TURN_MS = 5000;
  const WORKING = new Set(['working', 'background', 'waiting-agents']);

  // folder → { value, at, asking }
  const kept = new Map();

  // Asks again unless the last answer is younger than `gap` ms or an ask is on its way.
  function ask(folder, gap) {
    if (!folder || !native?.git?.changes) return;
    let entry = kept.get(folder);
    if (!entry) {
      entry = { value: null, at: 0, asking: false };
      kept.set(folder, entry);
    }
    if (entry.asking || (entry.at && Date.now() - entry.at < gap)) return;
    entry.asking = true;
    new Promise(resolve => resolve(native.git.changes(folder)))
      .then(answer => {
        if (answer?.ok) entry.value = answer.value;
      })
      .catch(() => {})
      .finally(() => {
        entry.asking = false;
        entry.at = Date.now();
        window.dispatchEvent(new CustomEvent('tnai:thread-changes', { detail: { folder } }));
      });
  }

  const get = folder => kept.get(folder)?.value || null;
  const known = folder => kept.has(folder);

  // Details' rule for one paint: the first time a folder is seen, when Details has just come on
  // screen (`opened`), or once a minute while the session works.
  function wantFor(session, opened) {
    const folder = session.cwd || '';
    if (!known(folder)) ask(folder, 0);
    else if (opened) ask(folder, OPEN_MS);
    else if (session.running && WORKING.has(session.status)) ask(folder, EVERY_MS);
  }

  // ---------------------------------------------------------------- the section's parts
  const plural = (count, word) => count + ' ' + word + (count === 1 ? '' : 's');

  // "Checks: 1 failed, 4 passed", with the failed checks' names on hover.
  function checksText(checks) {
    if (!checks?.total) return ['No checks', ''];
    const parts = [
      checks.failed ? checks.failed + ' failed' : '',
      checks.pending ? checks.pending + ' running' : '',
      checks.passed ? checks.passed + ' passed' : '',
    ].filter(Boolean);
    const failedNames = (checks.failedNames || []).join(', ');
    return ['Checks: ' + parts.join(', '), failedNames ? 'Failed: ' + failedNames : ''];
  }

  // The pull request as one row in the look of the rows under "Working with"; a press opens it
  // on GitHub in the user's browser (139 handles `data-pr`).
  function pullRequestRow(make, pr) {
    const box = make('div', 'ttd-links');
    const button = make('button', 'ttd-link');
    const state = pr.draft
      ? 'Draft'
      : { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed' }[pr.state] || pr.state;
    const [checks, failed] = checksText(pr.checks);
    button.type = 'button';
    button.dataset.pr = pr.url;
    button.title =
      'Open pull request #' + pr.number + ' on GitHub' + (failed ? ' · ' + failed : '');
    button.append(
      make('span', '', '#' + pr.number + ' ' + pr.title),
      make('small', '', state + ' · ' + checks)
    );
    box.append(button);
    return box;
  }

  // ---------------------------------------------------------------- the git view (feature 9)
  // Read only: the rows below show branches and commits; none of them switches, commits, stashes,
  // resets or checks out (refused in a folder agents share).

  // A commit's time: the clock today, the day this year, the day and year before that. A fixed
  // time, never "3 min ago", so a section left open does not grow stale.
  function commitTime(at) {
    const when = new Date(at);
    const today = new Date();
    if (when.toDateString() === today.toDateString())
      return when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const day = { month: 'short', day: 'numeric' };
    if (when.getFullYear() !== today.getFullYear()) day.year = 'numeric';
    return when.toLocaleDateString([], day);
  }

  // The last commits in the look of "Recent activity": time, a mark, the message over its author
  // and what it changed; the short id and full time on hover.
  function commitList(make, commits) {
    const list = make('ol', 'ttd-timeline ttd-commits');
    commits.forEach(commit => {
      const row = make('li');
      const time = make('time', '', commitTime(commit.at));
      time.dateTime = new Date(commit.at).toISOString();
      const mark = make('i', 'ttd-step');
      mark.innerHTML = window.TnaiIcon?.('git-branch', { size: 12 }) || '';
      const changed = commit.merge
        ? 'merge'
        : plural(commit.files, 'file') + ' · +' + commit.added + ' −' + commit.removed;
      row.title =
        commit.hash + ' · ' + commit.subject + '\n' + new Date(commit.at).toLocaleString();
      row.append(
        time,
        mark,
        make('b', '', commit.subject || '(no message)'),
        make('span', '', commit.author + ' · ' + changed)
      );
      list.append(row);
    });
    return list;
  }

  // The other local branches as names, newest first, with their last commit's time on hover;
  // the ones past the first few are counted.
  function branchChips(make, branches, count) {
    const box = make('div', 'ttd-chips');
    branches.forEach(branch => {
      const chip = make('span', 'ttd-chip');
      chip.title = branch.name + ' · last commit ' + new Date(branch.at).toLocaleString();
      chip.append(make('span', '', branch.name));
      box.append(chip);
    });
    if (count > branches.length)
      box.append(make('span', 'ttd-chip', '+' + (count - branches.length) + ' more'));
    return box;
  }

  // The git view's nodes, under the branch facts: the last commits and the other local branches.
  // Each list stands under a one-line remark, as lists in Details do.
  function gitView(parts, session, changes) {
    const { make, note } = parts;
    const out = [];
    const commits = Array.isArray(changes.commits) ? changes.commits : [];
    if (commits.length) {
      const group = make('div', 'ttd-git');
      group.append(
        note(commits.length === 1 ? 'Last commit' : 'Last ' + commits.length + ' commits'),
        commitList(make, commits)
      );
      out.push(group);
    }
    const branches = Array.isArray(changes.otherBranches) ? changes.otherBranches : [];
    if (branches.length) {
      const count = Math.max(changes.otherBranchCount || 0, branches.length);
      const group = make('div', 'ttd-git');
      group.append(
        note(count === 1 ? '1 other local branch' : count + ' other local branches'),
        branchChips(make, branches, count)
      );
      out.push(group);
    }
    return out;
  }

  // The section's nodes for one answer. `parts` are 139's own building blocks ({ make, facts,
  // note }), so the rows look and fold like every other section's.
  function build(parts, session, changes) {
    const { make, facts, note } = parts;
    const base = changes.base;
    const branch = changes.detached
      ? 'No branch (detached)'
      : changes.branch + (changes.onBase ? ' · the default branch' : '');
    const lines = changes.files
      ? '+' + changes.added + ' −' + changes.removed + ' · ' + plural(changes.files, 'file')
      : 'No changes';
    const commits = changes.onBase
      ? changes.unpushed
        ? plural(changes.unpushed, 'commit') + ' not pushed'
        : ''
      : base
        ? (changes.ahead ? plural(changes.ahead, 'commit') : 'None') +
          ' ahead of ' +
          base +
          (changes.behind ? ' · ' + changes.behind + ' behind' : '')
        : '';
    const out = [
      facts(
        [
          ['Branch', branch, base && !changes.onBase ? 'Compared with ' + base : ''],
          [
            'Lines',
            lines,
            changes.since
              ? 'Since the branch left ' + changes.since + ', uncommitted changes included'
              : 'Uncommitted changes since the last commit',
          ],
          ['Commits', commits],
          ['Uncommitted', changes.uncommitted ? plural(changes.uncommitted, 'file') : 'None'],
        ],
        session.paneId
      ),
    ];

    // gh missing, signed out or not on GitHub shows nothing; a branch with none says so once.
    if (changes.pr) out.push(pullRequestRow(make, changes.pr));
    else if (changes.gh === 'none') out.push(note('No pull request for this branch.'));

    // While it is watched (154): the one labeled poll, said as such.
    const watch = window.TnaiThreadActions?.watching?.(session.paneId);
    if (watch)
      out.push(
        note(
          'Watching #' +
            watch.number +
            ' · GitHub is asked every ' +
            watch.everyMin +
            ' minutes, because it cannot tell a desktop app when something changes.'
        )
      );

    // The git view: the last commits, the other local branches (read only).
    out.push(...gitView(parts, session, changes));
    return out;
  }

  window.TnaiThreadChanges = { ask, get, known, wantFor, build, OPEN_MS, TURN_MS };
})();
