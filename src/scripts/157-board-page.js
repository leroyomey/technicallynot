// Technically Not · 157-board-page.js — the Board page (route `board`, `board-mode`), opened from
// the three-dots menu under Work, after All threads (124). User decision 2026-10-16 ("Build it like
// this", the mock docs/plans/design-concepts/app-board.html). Desktop app only.
//
// - Board view: five columns (156 decides which): Up next holds the project's ideas (typed in
//   place with "+ Idea", kept per project by desktop/board-ideas.js, deletable) and its scheduled
//   prompts (desktop/prompt-schedules.js) with their next time; Working, Needs you, Ready for
//   review and Done today hold the project's real threads by their live status (119 reads it).
//   Needs you shows the open decision's options and sends a press through 49 `decideInThread`,
//   the way the thread's report card does (122). Ready for review shows 153's lines, files and
//   branch, with Open pull request and Review from the thread actions (154). A press or Enter on a
//   thread's card opens its thread (`TnaiThreads.show`).
// - Dragging an idea or a schedule into Working starts a new thread on it (the schedules' start,
// main's `schedules:startPrompt` / Run now); a started idea leaves Up next. Each Up next card also
// has buttons for the same, for the keyboard.
// - Week view: seven days from two days ago, today marked; each schedule's runs at their times:
//   coming ones outlined, past ones with their outcome (done → its thread, failed, missed → Run
//   now). An idea dropped on a day becomes a one-time schedule at 09:00 that day; a press on a
//   coming run opens it in Settings › Agents › Scheduled prompts (155 `edit`).
// - Drawn only while the page shows, from pushed events (no polling); the view switch fades
//   (TnaiMotion, off under reduced motion). Look: src/styles/45-board.css.
// window.TnaiBoard = { open, visible, view(name), state() } (the desktop test `board`).
(() => {
  'use strict';
  const native = window.tnaiNative;
  const layout = document.querySelector('.layout');
  const columnsKit = window.TnaiBoardColumns;
  if (!native?.schedules || !native.board || !layout || !columnsKit) return;

  const MODE = 'board-mode';
  const VIEW_KEY = 'tnai.board-view.v1';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // The CLIs a new thread can start with, in the app's order (140, `tnai new`); the schedules'
  // answer narrows it to the ones in the registry.
  const STARTABLE = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

  // The events the thread list redraws on (119), the Changes answers (153) and the shared project
  // context with its decisions (49).
  const EVENTS = [
    'tnai:account-limit',
    'tnai:account-limit-cleared',
    'tnai:turn',
    'tnai:held',
    'tnai:live-activity',
    'tnai:agent-state',
    'tnai:terminal-pane-renamed',
    'tnai:terminal-pane-closed',
    'tnai:terminal-workspace-closed',
    'tnai:project-changed',
    'tnai:graph-changed',
    'tnai:thread-changes',
    'tnai:context-data',

    // another computer's threads changed (116; their cards are 165's)
    'tnai:remote-agents-changed',
  ];

  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const icon = (name, size = 14) => safe(() => window.TnaiIcon?.(name, { size }), '');
  const say = text => safe(() => window.toast?.(text), null);
  const normal = folder =>
    String(folder || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .toLowerCase();
  const clock = at =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayLabel = at => new Date(at).toLocaleDateString([], { weekday: 'short' });
  const dateLabel = at => new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
  const isoDate = at => {
    const date = new Date(at);
    const pad = n => String(n).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  };
  const startOfDay = at => {
    const date = new Date(at);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };

  // ---------------------------------------------------------------- the page's frame
  const page = document.createElement('section');
  page.className = 'bd-page';
  page.id = 'boardPage';
  page.setAttribute('aria-label', 'Board');
  page.innerHTML =
    '<main class="bd-island">' +
    '<div class="bd-head"><h1>Board</h1>' +
    '<div class="bd-views" role="group" aria-label="View">' +
    '<button type="button" data-view="board" aria-pressed="true">Board</button>' +
    '<button type="button" data-view="week" aria-pressed="false">Week</button></div>' +
    '<span class="bd-head-note" aria-live="polite"></span>' +
    `<button type="button" class="bd-add">${icon('plus')}<span>Idea</span></button></div>` +
    // The empty screen: a project with nothing on its board yet (no thread, idea or schedule).
    '<section class="bd-empty set-empty" hidden><p>Nothing on the board yet: add an idea or schedule a prompt.</p>' +
    `<div class="bd-empty-acts"><button type="button" class="bd-add">${icon('plus')}<span>Idea</span></button>` +
    '<button type="button" class="bd-link" data-go="schedules">Scheduled prompts</button></div></section>' +
    '<section class="bd-board" aria-label="Board columns"></section>' +
    '<section class="bd-week" aria-label="Week" hidden></section>' +
    '</main>';
  layout.append(page);
  const boardEl = page.querySelector('.bd-board');
  const weekEl = page.querySelector('.bd-week');
  const headNote = page.querySelector('.bd-head-note');
  const emptyEl = page.querySelector('.bd-empty');

  // One column element per column, made once; their cards are drawn into `[data-cards]`.
  boardEl.innerHTML = columnsKit.COLUMNS.map(
    column =>
      `<div class="bd-col" data-col="${column.id}" role="group" aria-label="${esc(column.title)}">` +
      `<div class="bd-col-head">${esc(column.title)} <em data-count></em></div>` +
      // what a start from here costs, said where it happens (tnai-modern-ui 5d.7)
      (column.id === 'next'
        ? '<p class="bd-col-note">Starting one opens a new thread and uses your plan.</p>'
        : '') +
      '<div data-cards></div></div>'
  ).join('');
  const cardsOf = id => boardEl.querySelector(`[data-col="${id}"] [data-cards]`);

  // ---------------------------------------------------------------- what the page knows
  let shown = false;
  let view = safe(() => localStorage.getItem(VIEW_KEY), 'board') === 'week' ? 'week' : 'board';
  let root = '';
  let ideas = [];
  let schedules = null;
  let ideaInput = null;

  // A drag under way: { kind: 'idea' | 'schedule', id }.
  let dragged = null;

  // Ideas and schedules being started now (their cards say so until the answer).
  const startingIdeas = new Set();

  // Each thread's status the last time the page drew, so a turn that just ended asks for its
  // folder's Changes once.
  const lastStatus = new Map();

  // ---------------------------------------------------------------- reading the threads
  const sameProject = thread => !!root && normal(thread.project?.path) === normal(root);

  // The open decision of a thread's newest finished task (49), or null.
  function openDecision(paneId) {
    const context = window.TnaiContext;
    if (!context?.entries || !context.openChoice) return null;
    const entry = safe(() => context.entries(), [])
      .filter(one => one.paneId === paneId)
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (!entry) return null;
    const choice = safe(() => context.openChoice(entry), null);
    if (!choice?.options?.length) return null;
    return { question: choice.question, options: choice.options, at: entry.at || 0 };
  }

  // Changes of a thread's folder (153): asked when first seen and when its turn ended.
  function changesOf(thread) {
    const kit = window.TnaiThreadChanges;
    const folder = thread.session?.cwd || '';
    if (!kit || !folder) return null;
    const was = lastStatus.get(thread.id);
    const working = columnsKit.WORKING.has(thread.status);
    if (!kit.known(folder)) kit.ask(folder, 0);
    else if (was && columnsKit.WORKING.has(was) && !working) kit.ask(folder, kit.TURN_MS);
    lastStatus.set(thread.id, thread.status);
    return kit.get(folder);
  }

  function threadCards() {
    const now = Date.now();
    const list = safe(() => window.TnaiThreadList?.all?.(), []).filter(sameProject);
    const endedOf = thread => safe(() => window.TnaiTurns?.get?.(thread.id)?.endedAt, 0) || 0;

    // Changes belong to a folder, not to a thread. Threads that share a folder (the project's own,
    // not a worktree of their own) would all show the same changes, so they go only to the one
    // that finished a task there last (inferred, as the thread list labels its guesses).
    const lastInFolder = new Map();
    for (const thread of list) {
      const folder = normal(thread.session?.cwd);
      const best = lastInFolder.get(folder);
      if (!best || endedOf(thread) > endedOf(best)) lastInFolder.set(folder, thread);
    }
    return list.map(thread => {
      const owner = lastInFolder.get(normal(thread.session?.cwd)) === thread;
      const changes = changesOf(thread);
      const facts = {
        needs: thread.needs,
        status: thread.status,
        decision: openDecision(thread.id),
        changes: owner ? changes : null,
        endedAt: endedOf(thread),
        startedAt: thread.session?.startedAt || 0,
      };
      return { thread, facts, column: columnsKit.columnOf(facts, now) };
    });
  }

  // The schedules of the open project.
  const projectSchedules = () =>
    (schedules?.schedules || []).filter(item => normal(item.folder) === normal(root));

  // The CLI an idea starts with: the one of the newest thread started in this project, else the
  // first one that can start a thread here.
  function ideaAgent() {
    const allowed = (schedules?.agents || STARTABLE).filter(agent => STARTABLE.includes(agent));
    const newest = safe(() => window.TnaiThreadList?.all?.(), [])
      .filter(sameProject)
      .filter(thread => allowed.includes(thread.tool))
      .sort((a, b) => (b.session?.startedAt || 0) - (a.session?.startedAt || 0))[0];
    return newest?.tool || allowed[0] || 'Claude Code';
  }

  // ---------------------------------------------------------------- cards
  function cardTop(tone, name, tool) {
    return (
      `<div class="bd-card-top"><i class="bd-dot" data-tone="${tone}"></i><b>${esc(name)}</b></div>` +
      (tool ? `<small class="bd-tool">${esc(tool)}</small>` : '')
    );
  }

  function ideaCard(idea) {
    const busy = startingIdeas.has(idea.id);
    return (
      `<article class="bd-card" draggable="${busy ? 'false' : 'true'}" tabindex="0" data-kind="idea" data-id="${esc(idea.id)}">` +
      cardTop('idle', idea.text, '') +
      `<p>${busy ? 'Starting a thread…' : 'Idea · no agent yet'}</p>` +
      '<div class="bd-opts">' +
      `<button type="button" data-act="start"${busy ? ' disabled' : ''}>Start now</button>` +
      '<button type="button" data-act="delete">Delete</button></div></article>'
    );
  }

  function scheduleCard(item) {
    const next = item.nextAt ? 'next ' + dayLabel(item.nextAt) + ' ' + clock(item.nextAt) : 'off';
    return (
      `<article class="bd-card" draggable="true" tabindex="0" data-kind="schedule" data-id="${esc(item.id)}">` +
      cardTop('idle', item.name, item.agent) +
      `<span class="bd-when">${icon('clock', 12)}${esc(item.summary + ' · ' + next)}</span>` +
      '<div class="bd-opts">' +
      `<button type="button" data-act="run"${item.running ? ' disabled' : ''}>Run now</button>` +
      '</div></article>'
    );
  }

  // A thread's card, by its column.
  function threadCard({ thread, facts, column }) {
    const tone =
      column === 'needs'
        ? 'needs'
        : column === 'work'
          ? 'work'
          : column === 'review'
            ? 'ready'
            : 'idle';
    const tool = thread.tool + (thread.time ? ' · ' + thread.time : '');
    let body = '';
    if (column === 'needs') {
      const decision = facts.decision;
      body = `<p>${esc(decision?.question || thread.now || 'Waiting for you')}</p>`;
      if (decision)
        body +=
          '<div class="bd-opts">' +
          decision.options
            .map(
              (option, index) =>
                `<button type="button" data-act="decide" data-index="${index}">${esc(option.label)}</button>`
            )
            .join('') +
          '</div>';
    } else if (column === 'review') {
      const changes = facts.changes;
      const branch = changes.detached ? 'no branch' : changes.branch || '';
      body =
        `<p>${esc(thread.task || thread.now || 'Finished')}</p>` +
        `<div class="bd-meta"><span class="bd-plus">+${changes.added || 0}</span> ` +
        `<span class="bd-minus">−${changes.removed || 0}</span> · ${changes.files} file${changes.files === 1 ? '' : 's'}` +
        (branch ? ' · ' + esc(branch) : '') +
        '</div><div class="bd-opts">' +
        '<button type="button" data-act="pull-request">Open pull request</button>' +
        '<button type="button" data-act="review">Review</button></div>';
    } else {
      body = `<p>${esc(thread.task || thread.label || '')}</p>`;
      if (column === 'work' && thread.now)
        body += `<div class="bd-meta">Now: ${esc(thread.now)}${thread.inferred ? ' (inferred)' : ''}</div>`;
      const by = projectSchedules().find(item => item.lastRun?.paneId === thread.id);
      if (by && column === 'work')
        body += `<span class="bd-when">${icon('clock', 12)}Started by its schedule, ${esc(clock(by.lastRun.at))}</span>`;
    }
    return (
      `<article class="bd-card" tabindex="0" data-kind="thread" data-pane="${esc(thread.id)}"${facts.decision ? ` data-since="${facts.decision.at}"` : ''}>` +
      cardTop(tone, thread.name, tool) +
      body +
      '</article>'
    );
  }

  // ---------------------------------------------------------------- drawing
  let queued = 0;

  // What each box was last drawn with: a box is drawn again only when its markup changed.
  const drawn = new WeakMap();

  function refresh() {
    if (!shown || queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      paint();
    });
  }

  function paint() {
    if (!shown) return;

    // A drag under way keeps the cards where they are; the drop draws again.
    if (dragged) return;
    const focusKey = document.activeElement?.closest?.('.bd-card')
      ? cardKey(document.activeElement.closest('.bd-card'))
      : '';
    const cards = threadCards();
    const html = { next: [], work: [], needs: [], review: [], done: [] };
    ideas.forEach(idea => html.next.push(ideaCard(idea)));
    projectSchedules().forEach(item => html.next.push(scheduleCard(item)));
    cards.forEach(card => {
      if (card.column) html[card.column].push(threadCard(card));
    });

    // Another computer's threads in the open project, after this computer's own (165): each
    // { column, html } in Working, Needs you or Done today.
    const remoteCards = safe(() => window.TnaiRemoteFeatures?.boardCards?.() || [], []);
    remoteCards.forEach(card => html[card.column]?.push(card.html));
    for (const column of columnsKit.COLUMNS) {
      const box = cardsOf(column.id);
      const markup = html[column.id].join('');
      if (drawn.get(box) !== markup) {
        // the idea being typed keeps its place and the keyboard
        const typing = !!ideaInput && document.activeElement === ideaInput;
        drawn.set(box, markup);
        box.innerHTML = markup;
        if (column.id === 'next' && ideaInput) box.prepend(ideaInput);
        if (typing) ideaInput.focus({ preventScroll: true });
      }
      const count = boardEl.querySelector(`[data-col="${column.id}"] [data-count]`);
      const total = String(html[column.id].length);
      if (count.textContent !== total) count.textContent = total;
    }

    // Nothing at all on the board: its own screen instead of five empty columns. The idea being
    // typed counts as something, so "+ Idea" brings the columns in.
    const nothing =
      !ideaInput &&
      !ideas.length &&
      !projectSchedules().length &&
      !cards.some(card => card.column) &&
      !remoteCards.length;
    emptyEl.hidden = !(nothing && view === 'board');
    boardEl.hidden = nothing && view === 'board';
    if (view === 'week') paintWeek(cards);
    if (focusKey) restoreFocus(focusKey);
  }

  const cardKey = card =>
    (card.dataset.kind || '') + ':' + (card.dataset.pane || card.dataset.id || '');

  function restoreFocus(key) {
    if (document.activeElement?.closest?.('.bd-card')) return;
    const card = [...page.querySelectorAll('.bd-card')].find(node => cardKey(node) === key);
    card?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- Week
  const TONE = {
    done: 'idle',
    missed: 'needs',
    failed: 'err',
    skipped: 'err',
    work: 'work',
    future: 'idle',
  };

  // Every run of this project's schedules in the seven days: past runs from their history, coming
  // ones from their next times.
  function weekRuns(days, cards) {
    const from = days[0];
    const to = days[days.length - 1] + DAY_MS;
    const working = new Set(
      cards.filter(card => card.column === 'work').map(card => card.thread.id)
    );
    const runs = [];
    for (const item of projectSchedules()) {
      for (const run of item.runs || []) {
        if (run.at < from || run.at >= to) continue;
        const state = run.state === 'done' && working.has(run.paneId) ? 'work' : run.state;
        runs.push({ item, at: run.at, state, run });
      }
      for (const at of item.upcoming || [])
        if (at >= from && at < to) runs.push({ item, at, state: 'future', run: null });
    }
    return runs.sort((a, b) => a.at - b.at);
  }

  function runNote(entry) {
    const { item, state, run } = entry;
    if (state === 'future') return item.agent;
    if (state === 'missed') return 'Missed · Run now';
    if (state === 'work') return 'Working · thread ' + (run.thread || item.name);
    if (state === 'done') return 'Done · thread ' + (run.thread || item.name);
    return run.text || 'Failed';
  }

  function paintWeek(cards) {
    const today = startOfDay(Date.now());
    const days = [];
    for (let offset = -2; offset <= 4; offset++)
      days.push(startOfDay(today + offset * DAY_MS + DAY_MS / 2));
    const runs = weekRuns(days, cards);

    // No schedule and no idea to drop: one sentence and the way to make one, not seven empty days.
    if (!projectSchedules().length && !ideas.length) {
      const empty =
        '<div class="bd-empty set-empty"><p>No scheduled prompts in this project yet: their runs show here by day.</p>' +
        '<div class="bd-empty-acts"><button type="button" class="bd-link" data-go="schedules">Scheduled prompts</button></div></div>';
      if (drawn.get(weekEl) !== empty) {
        drawn.set(weekEl, empty);
        weekEl.innerHTML = empty;
      }
      return;
    }
    const markup = days
      .map(day => {
        const isToday = day === today;
        const mine = runs.filter(entry => startOfDay(entry.at) === day);
        return (
          `<div class="bd-day${isToday ? ' today' : ''}" data-day="${esc(isoDate(day))}" role="group" aria-label="${esc(dayLabel(day) + ' ' + dateLabel(day))}">` +
          `<div class="bd-day-head">${esc(dayLabel(day))}${isToday ? ' · today' : ''}<span>${esc(dateLabel(day))}</span></div>` +
          mine
            .map(
              entry =>
                `<button type="button" class="bd-run ${entry.state}" data-id="${esc(entry.item.id)}" data-state="${entry.state}" data-pane="${esc(entry.run?.paneId || '')}">` +
                `<span class="t"><i class="bd-dot" data-tone="${TONE[entry.state] || 'idle'}"></i>${esc(clock(entry.at))}</span>` +
                `<b>${esc(entry.item.name)}</b><small>${esc(runNote(entry))}</small></button>`
            )
            .join('') +
          '</div>'
        );
      })
      .join('');
    if (drawn.get(weekEl) !== markup) {
      drawn.set(weekEl, markup);
      weekEl.innerHTML = markup;
    }
  }

  // ---------------------------------------------------------------- the two views
  function applyView() {
    page.dataset.view = view;
    page.querySelectorAll('[data-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view));
    });
    weekEl.hidden = view !== 'week';
    headNote.textContent =
      view === 'week'
        ? 'Drag an idea onto a day to schedule it. Missed runs wait for "Run now". Each run opens a new thread and uses your plan.'
        : 'Cards are your threads; they move by themselves as each agent works.';
    paint();
  }

  function setView(next) {
    if (next === view) return;
    view = next;
    safe(() => localStorage.setItem(VIEW_KEY, view), null);
    if (window.TnaiMotion) window.TnaiMotion.swap(applyView, 'page');
    else applyView();
  }

  page.querySelector('.bd-views').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });

  // ---------------------------------------------------------------- ideas
  function loadIdeas() {
    if (!root) {
      ideas = [];
      refresh();
      return Promise.resolve();
    }
    const asked = root;
    return native.board
      .ideas(asked)
      .then(answer => {
        if (asked !== root) return;
        ideas = answer?.ideas || [];
        refresh();
      })
      .catch(() => {});
  }

  function newIdea() {
    if (view !== 'board') setView('board');
    if (ideaInput) {
      ideaInput.focus();
      return;
    }
    ideaInput = document.createElement('input');
    ideaInput.className = 'bd-idea-input';
    ideaInput.placeholder = 'What should an agent do? Enter to add';
    ideaInput.setAttribute('aria-label', 'New idea');
    ideaInput.maxLength = 2000;
    cardsOf('next').prepend(ideaInput);
    paint();
    ideaInput.focus();
    ideaInput.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        ideaInput.remove();
        ideaInput = null;
        return;
      }
      if (event.key !== 'Enter' || !ideaInput.value.trim()) return;
      const words = ideaInput.value;
      native.board
        .addIdea(root, words)
        .then(answer => {
          if (!answer?.ok) return say(answer?.error || 'Couldn’t save the idea.');
          ideaInput?.remove();
          ideaInput = null;
          loadIdeas();
        })
        .catch(() => say('Couldn’t save the idea.'));
    });
  }

  function removeIdea(id) {
    return native.board
      .removeIdea(root, id)
      .then(answer => {
        if (!answer?.ok) say(answer?.error || 'Couldn’t delete the idea.');
        loadIdeas();
      })
      .catch(() => say('Couldn’t delete the idea.'));
  }

  // An idea into Working: a new thread on its words; the idea leaves Up next once it started.
  function startIdea(id) {
    const idea = ideas.find(one => one.id === id);
    if (!idea || startingIdeas.has(id)) return;
    startingIdeas.add(id);
    refresh();
    const agent = ideaAgent();
    say('Starting a new ' + agent + ' thread on "' + idea.text.slice(0, 60) + '"');
    native.schedules
      .startPrompt({ folder: root, agent, prompt: idea.text })
      .then(answer => {
        if (!answer?.ok) {
          say(answer?.error || 'It did not start.');
          return;
        }
        return removeIdea(id);
      })
      .catch(() => say('It did not start.'))
      .finally(() => {
        startingIdeas.delete(id);
        refresh();
      });
  }

  function runSchedule(id) {
    native.schedules
      .runNow(id)
      .then(answer => {
        if (!answer?.ok) say(answer?.error || 'It did not start.');
      })
      .catch(() => say('It did not start.'));
  }

  // An idea dropped on a day: a one-time schedule at 09:00, then the idea leaves Up next.
  function scheduleIdea(id, date) {
    const idea = ideas.find(one => one.id === id);
    if (!idea) return;
    native.schedules
      .createOnce({
        name: idea.text.slice(0, 40),
        folder: root,
        agent: ideaAgent(),
        prompt: idea.text,
        date,
        time: '09:00',
      })
      .then(answer => {
        if (!answer?.ok) return say(answer?.error || 'It could not be scheduled.');
        say('Scheduled for ' + date + ' 09:00 (press it to change the time).');
        return removeIdea(id);
      })
      .catch(() => say('It could not be scheduled.'));
  }

  // ---------------------------------------------------------------- presses and keys
  function openThread(paneId) {
    if (!window.TnaiThreads?.show?.(paneId)) say('That thread is closed.');
  }

  function decide(card, button) {
    const paneId = card.dataset.pane;
    const decision = openDecision(paneId);
    if (!decision || !window.TnaiContext?.decideInThread) return;
    const index = Number(button.dataset.index);
    const option = decision.options[index];
    const done = safe(
      () =>
        window.TnaiContext.decideInThread(
          paneId,
          decision.question,
          index,
          option.label,
          decision.at
        ),
      false
    );
    if (done) say('Sent: ' + option.label);
    refresh();
  }

  function onCardButton(card, button) {
    const act = button.dataset.act;
    const id = card.dataset.id;
    if (act === 'start') startIdea(id);
    else if (act === 'delete') removeIdea(id);
    else if (act === 'run') runSchedule(id);
    else if (act === 'decide') decide(card, button);
    else if (act === 'pull-request' || act === 'review')
      window.TnaiThreadActions?.send?.(card.dataset.pane, act);
  }

  function onRunPress(button) {
    const state = button.dataset.state;
    const id = button.dataset.id;
    if (state === 'missed') runSchedule(id);
    else if (state === 'future') window.TnaiPromptSchedules?.edit?.(id);
    else if (state === 'done' || state === 'work') openThread(button.dataset.pane);
    else say(button.querySelector('small')?.textContent || '');
  }

  page.addEventListener('click', event => {
    // "+ Idea" (head and empty screen) and the link to Settings › Agents › Scheduled prompts
    if (event.target.closest('.bd-add')) return newIdea();
    if (event.target.closest('[data-go="schedules"]'))
      return window.TnaiPromptSchedules?.edit?.('');
    const run = event.target.closest('.bd-run');
    if (run) return onRunPress(run);
    const card = event.target.closest('.bd-card');
    if (!card) return;
    const button = event.target.closest('button[data-act]');
    if (button) return onCardButton(card, button);
    if (card.dataset.kind === 'thread') openThread(card.dataset.pane);

    // another computer's thread opens as a press on its row of the thread list does (165)
    else if (card.dataset.kind === 'remote')
      window.TnaiRemoteFeatures?.openThread?.(card.dataset.remote);
    else say('Drag it into Working to start an agent on it, or onto a day in Week to schedule it.');
  });
  page.addEventListener('keydown', event => {
    const card = event.target.closest?.('.bd-card');
    if (!card || event.target !== card) return;
    if (event.key === 'Enter' && card.dataset.kind === 'thread') {
      event.preventDefault();
      openThread(card.dataset.pane);
    }
    if (event.key === 'Enter' && card.dataset.kind === 'remote') {
      event.preventDefault();
      window.TnaiRemoteFeatures?.openThread?.(card.dataset.remote);
    }
    if (event.key === 'Delete' && card.dataset.kind === 'idea') removeIdea(card.dataset.id);
  });

  // ---------------------------------------------------------------- dragging
  page.addEventListener('dragstart', event => {
    const card = event.target.closest?.('.bd-card[draggable="true"]');
    if (!card) return;
    dragged = { kind: card.dataset.kind, id: card.dataset.id };
    card.classList.add('bd-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', card.dataset.id);
  });
  page.addEventListener('dragend', () => {
    dragged = null;
    page.querySelectorAll('.bd-dragging, .bd-drop-on').forEach(node => {
      node.classList.remove('bd-dragging', 'bd-drop-on');
    });
    refresh();
  });

  // Where a drag may land: Working takes both, a day of the Week takes ideas only.
  const dropTarget = event => {
    if (!dragged) return null;
    const working = event.target.closest?.('[data-col="work"]');
    if (working) return working;
    const day = event.target.closest?.('.bd-day');
    return day && dragged.kind === 'idea' ? day : null;
  };
  page.addEventListener('dragover', event => {
    const target = dropTarget(event);
    if (!target) return;
    event.preventDefault();
    target.classList.add('bd-drop-on');
  });
  page.addEventListener('dragleave', event => {
    const target = dropTarget(event);
    if (target && !target.contains(event.relatedTarget)) target.classList.remove('bd-drop-on');
  });
  page.addEventListener('drop', event => {
    const target = dropTarget(event);
    if (!target) return;
    event.preventDefault();
    const what = dragged;
    dragged = null;
    target.classList.remove('bd-drop-on');
    if (target.classList.contains('bd-day')) scheduleIdea(what.id, target.dataset.day);
    else if (what.kind === 'idea') startIdea(what.id);
    else runSchedule(what.id);
    refresh();
  });

  // ---------------------------------------------------------------- showing and hiding
  const stops = [];

  function start() {
    if (shown) return;
    shown = true;
    EVENTS.forEach(name => {
      window.addEventListener(name, refresh);
      stops.push(() => window.removeEventListener(name, refresh));
    });
    const offSessions = safe(() => window.TnaiAgents?.onChange?.(refresh), null);
    if (typeof offSessions === 'function') stops.push(offSessions);
    const offSchedules = native.schedules.onState(answer => {
      schedules = answer || schedules;
      refresh();
    });
    if (typeof offSchedules === 'function') stops.push(offSchedules);

    // A panel's status (10 writes data-status only when it changes), as the thread list watches it.
    const host = document.querySelector('#terminalView .terminal-content');
    if (host) {
      const watch = new MutationObserver(refresh);
      watch.observe(host, { attributes: true, attributeFilter: ['data-status'], subtree: true });
      stops.push(() => watch.disconnect());
    }
    native.schedules
      .view()
      .then(answer => {
        schedules = answer;
        refresh();
      })
      .catch(() => {});
    Promise.resolve(native.fs?.root?.())
      .then(folder => {
        root = folder || '';
        return loadIdeas();
      })
      .catch(() => {});
    applyView();
  }

  function stop() {
    if (!shown) return;
    shown = false;
    stops.splice(0).forEach(off => safe(off, null));
    if (queued) cancelAnimationFrame(queued);
    queued = 0;
  }

  window.addEventListener('tnai:board-page-shown', start);
  window.addEventListener('tnai:project-changed', event => {
    root = event.detail?.root || '';
    ideaInput?.remove();
    ideaInput = null;
    if (shown) loadIdeas();
  });
  new MutationObserver(() => {
    if (!layout.classList.contains(MODE)) stop();
  }).observe(layout, { attributes: true, attributeFilter: ['class'] });

  window.TnaiBoard = {
    open: () => window.TnaiRoute?.('board'),
    visible: () => shown,
    view: next => (next ? setView(next) : view),
    state: () => ({
      view,
      root,
      ideas: ideas.length,
      columns: Object.fromEntries(
        columnsKit.COLUMNS.map(column => [
          column.id,
          cardsOf(column.id).querySelectorAll('.bd-card').length,
        ])
      ),
    }),
  };
})();
