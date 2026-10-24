// Technically Not · 154-thread-actions.js — Desktop app only: the thread actions. A row of the open
// thread's "..." menu (137, "Commit, pull request, review…"; it was an icon button of the top row
// until the user chose fewer buttons there, 2026-10-24, tab 5 of app-polish.html), and an icon
// button in an All threads card's head (135 makes it, this file paints it). It is
// shown only for a thread whose folder is in a git repository (153's facts), never for a plain
// terminal thread.
//
// A press opens the thread's menu (137 `openList`, the same panel, keys and closing) with a label
// row "This thread's work · branch <branch>" and one row per action: Commit, Commit and push, Open
// pull request, Review the changes, Fix review comments, Resolve conflicts, Write a recap, and
// "Edit these prompts…". A row sends its ready prompt to the thread's agent the way the prompt box
// does (10 `TnaiAgents.send`, held while the agent works, then 11 `record`), for every agent CLI,
// and the conversation stays where the user reads (122 `quietly`). {branch}, {base} and {pull} are
// filled from 153's facts.
//
// Under the prompts, for the thread's pull request (desktop/pr-watch.js through
// `tnaiNative.prWatch`): "Watch pull request #N" while it is open (GitHub is asked every 3 minutes
// while watched; a change is told to the agent as one "[from GitHub · pull request #N]" message),
// "Stop watching" while watched, and "Merge pull request #N" only when it is open, not a draft and
// its checks passed; Merge asks first in the same menu, then gh merges it on the desktop side.
//
// The prompts are edited in Settings › Agents › After finishing ("Thread actions"), one field per
// prompt with "Reset to default"; kept on this computer in localStorage `tnai.thread-actions.v1`
// (only the ones changed from the default).
// window.TnaiThreadActions = { open(anchor, paneId), paintCard(paneId, button), shows(paneId),
// prompts() }.
(() => {
  'use strict';

  // ---------------------------------------------------------------- the actions and their prompts
  const ACTIONS = [
    {
      id: 'commit',
      label: 'Commit',
      icon: 'git-branch',
      prompt:
        'Commit the changes you made on branch {branch} with a clear commit message. Commit only the files you changed for this task and leave any other changes alone. Do not push.',
    },
    {
      id: 'commit-push',
      label: 'Commit and push',
      icon: 'git-branch',
      prompt:
        'Commit the changes you made on branch {branch} with a clear commit message, then push the branch to its remote. Commit only the files you changed for this task and leave any other changes alone.',
    },
    {
      id: 'pull-request',
      label: 'Open pull request',
      icon: 'file-text',
      prompt:
        'Open a pull request from branch {branch} into {base}. Push the branch first if it is not pushed yet. Give it a short title and a description of what changed and how it was checked. Use the GitHub CLI (gh) if it is installed, and tell me the address of the pull request.',
    },
    {
      id: 'review',
      label: 'Review the changes',
      icon: 'eye',
      prompt:
        'Review the changes on branch {branch} since {base} (git diff {base}...HEAD, and anything not committed yet). List real problems first: bugs, missing checks, risky or unclear changes. Do not change any files; report what you found.',
    },
    {
      id: 'fix-review',
      label: 'Fix review comments',
      icon: 'pencil',
      prompt:
        'Read the review comments on {pull} and fix what they ask for. Commit the fixes, then tell me which comments you handled and which you left open, and why.',
    },
    {
      id: 'conflicts',
      label: 'Resolve conflicts',
      icon: 'git-branch',
      prompt:
        'Bring branch {branch} up to date with {base} and resolve any merge conflicts, keeping what both sides meant. If a conflict is unclear, stop and ask me. Run the checks afterwards and tell me what you changed.',
    },
    {
      id: 'recap',
      label: 'Write a recap',
      icon: 'sparkles',
      prompt:
        'Write a short recap of the work on branch {branch}: what changed since {base}, why, how it was checked, and what is left to do. Plain words, a few lines.',
    },
  ];

  // The words that stand in a prompt for the thread's own facts (153's answer for its folder).
  function fill(text, changes) {
    const branch = changes?.branch || 'the current branch';
    const base = changes?.base || 'the default branch';
    const pr = changes?.pr;
    const pull = pr
      ? 'pull request #' + pr.number + ' (' + pr.url + ')'
      : 'the pull request of branch ' + branch;
    const words = { branch, base, pull };
    return String(text || '').replace(/\{(branch|base|pull)\}/g, (whole, name) => words[name]);
  }

  // The button shows for a thread with an agent CLI whose folder is in a git repository.
  const shows = (session, changes) =>
    !!session && session.agent !== 'Terminal' && changes?.repo === true;

  // The prompt of one action: the user's own when one is kept, else the default.
  function promptOf(id, own) {
    const action = ACTIONS.find(one => one.id === id);
    if (!action) return '';
    const text = own && typeof own[id] === 'string' ? own[id].trim() : '';
    return text || action.prompt;
  }

  // The label row over the menu's rows.
  const labelOf = changes =>
    "This thread's work" + (changes?.branch ? ' · branch ' + changes.branch : '');

  // Watch shows for an open pull request; Merge only when it is open, not a draft and its checks
  // passed (153's facts; the desktop side looks again right before it merges).
  const canWatch = changes => changes?.pr?.state === 'OPEN';

  function canMerge(changes) {
    const pr = changes?.pr;
    const checks = pr?.checks;
    return (
      !!pr &&
      pr.state === 'OPEN' &&
      !pr.draft &&
      !!checks &&
      checks.total > 0 &&
      checks.failed === 0 &&
      checks.pending === 0
    );
  }

  // What the agent is told for a change of a watched pull request: one "[from ...]" message, so
  // the conversation shows it as one quiet line (122 "From ...") for every agent CLI.
  const watchMessage = event =>
    '[from GitHub · pull request #' +
    event.number +
    '] ' +
    String(event.message || event.line || '');

  // For tools/thread-actions-test.js (plain Node): the parts that hold no page.
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { ACTIONS, fill, shows, promptOf, labelOf, canWatch, canMerge, watchMessage };
  if (typeof window === 'undefined' || !window.tnaiNative) return;

  // ---------------------------------------------------------------- kept prompts
  const STORE = 'tnai.thread-actions.v1';

  function loadOwn() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function saveOwn(own) {
    try {
      if (Object.keys(own).length) localStorage.setItem(STORE, JSON.stringify(own));
      else localStorage.removeItem(STORE);
    } catch {}
  }

  // ---------------------------------------------------------------- the thread's facts
  const kit = () => window.TnaiThreadChanges || null;
  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(session => session.paneId === paneId) || null;

  // Facts for the thread's folder; asked once the first time a folder is seen.
  function changesFor(session) {
    const folder = session?.cwd || '';
    if (!folder || !kit()) return null;
    if (!kit().known(folder)) kit().ask(folder, 0);
    return kit().get(folder);
  }

  // ---------------------------------------------------------------- sending
  function say(message) {
    try {
      window.toast?.(message);
    } catch {}
  }

  // The prompt box's way for one thread: held while the agent works, recorded as its last task,
  // and the conversation does not move (only a typed prompt moves it).
  function send(paneId, actionId) {
    const session = sessionOf(paneId);
    const action = ACTIONS.find(one => one.id === actionId);
    if (!session || !action) return false;
    const text = fill(promptOf(actionId, loadOwn()), changesFor(session));
    const deliver = () => {
      const sent = window.TnaiAgents?.send?.(paneId, text, { userText: text, holdIfBusy: true });
      if (sent)
        window.TnaiLiveTasks?.record?.(paneId, text, session.name + ' (' + session.agent + ')');
      return sent;
    };
    const quiet = window.TnaiThreadReadable?.quietly;
    const sent = quiet ? quiet(deliver) : deliver();
    say(
      sent
        ? action.label + ' sent to ' + session.name
        : session.name + ' is not running. Start it, then try again.'
    );
    return !!sent;
  }

  // ---------------------------------------------------------------- the menu
  function editPrompts() {
    window.TnaiSettings?.open?.('agents');
    document.getElementById('saTab-finish')?.click();
    const group = document.getElementById('threadActionsSet');

    // after the page and its topic are shown
    setTimeout(() => group?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }

  // ---------------------------------------------------------------- watch and merge
  // The watched pull requests, pushed by the desktop side (desktop/pr-watch.js): paneId → entry.
  const watched = new Map();
  const prWatch = window.tnaiNative.prWatch;

  function takeList(list) {
    watched.clear();
    (Array.isArray(list) ? list : []).forEach(entry => watched.set(entry.paneId, entry));

    // Details' Changes section says while a thread's pull request is watched (153)
    window.dispatchEvent(new CustomEvent('tnai:thread-changes', { detail: { folder: '' } }));
  }

  // A watched pull request changed: its agent is told, the way the prompt box sends (held while
  // it works), and the conversation shows the message as one quiet line.
  function onWatchEvent(event) {
    const session = sessionOf(event?.paneId);
    if (!session) return;
    const text = watchMessage(event);
    const deliver = () =>
      window.TnaiAgents?.send?.(session.paneId, text, { userText: text, holdIfBusy: true });
    const quiet = window.TnaiThreadReadable?.quietly;
    const sent = quiet ? quiet(deliver) : deliver();
    if (!sent) say(session.name + ' is not running, so it was not told: ' + event.line);
    if (session.cwd) kit()?.ask(session.cwd, 0);
  }

  async function watch(paneId, number) {
    let answer = null;
    try {
      answer = await prWatch.watch(paneId, number);
    } catch {}
    say(
      answer?.ok
        ? 'Watching pull request #' +
            answer.number +
            ' · asked of GitHub every ' +
            answer.everyMin +
            ' minutes'
        : answer?.error || 'Could not watch the pull request.'
    );
  }

  async function unwatch(paneId) {
    let answer = null;
    try {
      answer = await prWatch.unwatch(paneId);
    } catch {}
    if (answer?.was) say('Stopped watching pull request #' + answer.was);
  }

  async function merge(paneId, number, base) {
    let answer = null;
    try {
      answer = await prWatch.merge(paneId, number);
    } catch {}
    const session = sessionOf(paneId);
    if (answer?.ok) {
      const branch = changesFor(session)?.branch;
      say(
        '#' +
          answer.number +
          ' merged into ' +
          base +
          (branch ? ' · branch ' + branch + ' can be deleted' : '')
      );
    } else say(answer?.error || 'GitHub did not merge #' + number + '.');
    if (session?.cwd) kit()?.ask(session.cwd, 0);
  }

  // Merge asks first, in the menu: the same menu shows the question and two rows.
  function askMerge(paneId, changes) {
    const more = window.TnaiThreadMore;
    const anchor = lastAnchor;
    const number = changes.pr.number;
    const base = changes.base || 'the default branch';
    if (!more?.openList || !anchor?.isConnected) return;
    more.openList(anchor, paneId, {
      name: 'Merge pull request #' + number,
      label: 'Merge #' + number + ' into ' + base + '? Its checks passed and it is not a draft.',
      rows: [
        { id: 'merge-yes', label: 'Merge', icon: 'check', go: () => merge(paneId, number, base) },
        { id: 'merge-no', label: 'Not now', icon: 'x', go: () => {} },
      ],
    });
  }

  // The watch and merge rows for the thread's pull request, from 153's facts.
  function prRows(paneId, changes) {
    const rows = [];
    if (!prWatch || !changes?.pr) return rows;
    const number = changes.pr.number;
    if (watched.has(paneId))
      rows.push({
        id: 'pr-unwatch',
        label: 'Stop watching pull request #' + watched.get(paneId).number,
        icon: 'bell',
        go: () => unwatch(paneId),
      });
    else if (canWatch(changes))
      rows.push({
        id: 'pr-watch',
        label: 'Watch pull request #' + number,
        icon: 'bell',
        go: () => watch(paneId, number),
      });
    if (canMerge(changes))
      rows.push({
        id: 'pr-merge',
        label: 'Merge pull request #' + number,
        icon: 'check',
        keepFocus: true,
        go: () => askMerge(paneId, changes),
      });
    return rows;
  }

  if (prWatch) {
    prWatch.onEvent?.(onWatchEvent);
    prWatch.onChanged?.(takeList);
    new Promise(resolve => resolve(prWatch.list?.())).then(takeList).catch(() => {});
  }

  function rowsFor(paneId) {
    const rows = ACTIONS.map(action => ({
      id: action.id,
      label: action.label,
      icon: action.icon,
      go: () => send(paneId, action.id),
    }));
    rows.push(...prRows(paneId, changesFor(sessionOf(paneId))));
    rows.push({ id: 'edit', label: 'Edit these prompts…', icon: 'settings', go: editPrompts });
    return rows;
  }

  // The button the menu was last opened from (Merge asks its question under the same one).
  let lastAnchor = null;

  // Opens the menu under `anchor` for the thread `paneId`; a second press on the same button
  // closes it.
  function open(anchor, paneId) {
    const more = window.TnaiThreadMore;
    if (!more?.openList || !anchor || !paneId) return;
    if (more.isOpen()) {
      const same = more.anchor?.() === anchor;
      more.close(same);
      if (same) return;
    }
    const session = sessionOf(paneId);
    const changes = changesFor(session);
    lastAnchor = anchor;

    // a fresh branch name for the next opening, at most every 10 s
    if (session?.cwd) kit()?.ask(session.cwd, kit().OPEN_MS);
    more.openList(anchor, paneId, {
      name: 'Actions for this thread’s work',
      label: labelOf(changes),
      rows: rowsFor(paneId),
    });
  }

  // ---------------------------------------------------------------- the thread's "..." menu row
  // The open thread's actions are a row of its "..." menu (137, "Commit, pull request, review…"),
  // no longer a button of the top row (user 2026-10-24, tab 5 of app-polish.html): the row shows
  // when this would, and opens this menu under the "..." button.
  function showsFor(paneId) {
    const session = sessionOf(paneId);
    return shows(session, changesFor(session));
  }

  // An All threads card's button (135 makes it hidden and calls this when it paints the card).
  function paintCard(paneId, cardButton) {
    if (!cardButton) return;
    const hide = !showsFor(paneId);
    if (cardButton.hidden !== hide) cardButton.hidden = hide;
  }

  function paintAll() {
    document.querySelectorAll('.tat-card[data-pane] .tat-act-work').forEach(cardButton => {
      paintCard(cardButton.closest('.tat-card').dataset.pane, cardButton);
    });
  }

  // Painted on pushed changes only: new git facts.
  window.addEventListener('tnai:thread-changes', paintAll);

  // ---------------------------------------------------------------- Settings
  // Settings › Agents › After finishing: one field per prompt, with Reset to default.
  const escape = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      character =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]
    );

  function buildSettings() {
    const mount = document.getElementById('agentsColA');
    if (!mount || document.getElementById('threadActionsSet')) return;
    const group = document.createElement('section');
    group.className = 'set-group tnai-actions-set';
    group.id = 'threadActionsSet';
    const rows = ACTIONS.map(
      action =>
        '<div class="set-row"><span class="set-text"><b>' +
        escape(action.label) +
        '</b><small>Sent to the thread’s agent.</small></span><span class="set-ctl">' +
        '<input type="text" class="set-input set-text-input" spellcheck="false" data-ta="' +
        action.id +
        '" aria-label="' +
        escape(action.label) +
        ' prompt">' +
        '<button type="button" class="sa-btn" data-ta-reset="' +
        action.id +
        '">Reset to default</button></span></div>'
    ).join('');
    group.innerHTML =
      '<header class="set-group-head"><div><h3>Thread actions</h3><p>The prompts the git-branch ' +
      'button of a thread sends to its agent. {branch}, {base} and {pull} are filled in from ' +
      'the thread’s folder.</p></div></header><div class="set-card">' +
      rows +
      '</div>';

    // Shows each prompt as it is now; Reset is off while a prompt is the default.
    const sync = () => {
      const own = loadOwn();
      group.querySelectorAll('[data-ta]').forEach(input => {
        const text = promptOf(input.dataset.ta, own);
        if (document.activeElement !== input) input.value = text;
        input.title = text;
      });
      group.querySelectorAll('[data-ta-reset]').forEach(reset => {
        reset.disabled = !own[reset.dataset.taReset];
      });
    };
    group.addEventListener('change', event => {
      const id = event.target.dataset?.ta;
      if (!id) return;
      const own = loadOwn();
      const text = event.target.value.trim();
      const action = ACTIONS.find(one => one.id === id);
      if (!text || text === action.prompt) delete own[id];
      else own[id] = text;
      saveOwn(own);
      sync();
    });
    group.addEventListener('click', event => {
      const id = event.target.closest?.('[data-ta-reset]')?.dataset.taReset;
      if (!id) return;
      const own = loadOwn();
      delete own[id];
      saveOwn(own);
      sync();
    });
    sync();
    mount.append(group);
  }

  buildSettings();

  window.TnaiThreadActions = {
    open,
    paintCard,

    // whether the thread has a git folder its actions can work on (137 shows its menu row then)
    shows: showsFor,

    // the watched pull request of a thread ({ number, url, everyMin }) or null (153's Details note)
    watching: paneId => watched.get(paneId) || null,

    // one action sent to one thread, as its menu row does (the Board page's Ready for review
    // cards, 157: 'pull-request' and 'review')
    send,

    // the actions with the prompt each sends now (before filling), for tests
    prompts: () => {
      const own = loadOwn();
      return ACTIONS.map(action => ({
        id: action.id,
        label: action.label,
        prompt: promptOf(action.id, own),
      }));
    },
  };
})();
