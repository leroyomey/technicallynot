/*
 * Technically Not · 185-open-decisions.js — one list of every thread's open decisions, answered
 * from the open thread (user, 2026-10-28: "Build the one list of every thread's open decisions,
 * as shown in the mockup", docs/plans/design-concepts/decisions-at-once.html).
 *
 * When two or more running threads wait on a "- Decide:" line, a small bar in the open thread's
 * "Questions for you" row (120 `.tnt-asks`, between the conversation and the prompt box) says
 * "4 decisions · 3 threads". Pressing it opens the list above it: each thread with its open
 * decisions, drawn in the thread's own decision style (.tnt-decide). Each press goes to the thread
 * that asked at once, through the same path as a press in that thread (49 `decideInThread`); the
 * rest stay open. A decision the agent marked "(after Decision N: why)" says so while both are
 * open (49 `dependsOn`), as in the thread.
 *
 * Which decisions count: those the app already treats as waiting, so the bar, the thread list's
 * "Needs you" and the window title agree (51 `deciding`: the newest report of a running agent that
 * has not moved on since). A stopped thread's decisions are answered in that thread.
 */
(() => {
  'use strict';

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // The bar shows only with this many threads waiting: one thread's decisions are in that thread.
  const MIN_THREADS = 2;

  // ---------- what waits ----------
  // [{ paneId, name, tool, at, decisions: [{ question, options, n }] }], oldest report first
  function waiting() {
    const context = window.TnaiContext;
    const next = window.TnaiNextActions;
    if (!context?.openDecisions || !next?.deciding) return [];
    const sessions = safe(() => window.TnaiAgents.sessions(), []);
    const entries = safe(() => context.entries(), []);
    const groups = [];
    for (const session of sessions) {
      const first = safe(() => next.deciding(session.paneId), null);
      if (!first) continue;
      const entryId = String(first.id || '').split('#')[0];
      const entry = entries.find(one => one.id === entryId);
      const decisions = entry ? safe(() => context.openDecisions(entry), []) : [];
      if (!decisions.length) continue;
      groups.push({
        paneId: session.paneId,
        name: session.name || 'Agent',
        tool: session.agent || '',
        at: Number(entry.at) || 0,
        decisions,
      });
    }
    return groups.sort((a, b) => a.at - b.at);
  }

  // ---------- the bar and the list ----------
  const bar = make('button', 'tod-bar');
  bar.type = 'button';
  bar.hidden = true;
  bar.setAttribute('aria-expanded', 'false');
  bar.append(make('i'), make('span'), make('small', '', 'Answer here'));

  const list = make('section', 'tod');
  list.hidden = true;
  list.setAttribute('aria-label', 'Open decisions of every thread');
  const head = make('div', 'tod-head');
  const title = make('b', '', 'Open decisions');
  const count = make('small');
  const close = make('button', 'tod-close', 'Close');
  close.type = 'button';
  head.append(title, count, close);
  const body = make('div', 'tod-body tnt-talk-list');
  const foot = make(
    'p',
    'tod-foot',
    'Each press goes to its thread at once; skip any you are not ready for.'
  );
  list.append(head, body, foot);

  let open = false;

  function setOpen(want) {
    open = want;
    bar.setAttribute('aria-expanded', String(open));
    paint();
    if (open) list.querySelector('.tnt-decide-options button')?.focus({ preventScroll: true });
  }

  bar.addEventListener('click', () => setOpen(!open));
  close.addEventListener('click', () => {
    setOpen(false);
    bar.focus({ preventScroll: true });
  });
  list.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    setOpen(false);
    bar.focus({ preventScroll: true });
  });

  // The open thread's "Questions for you" row (120). Both parts stay last in it, after 121's cards.
  function dock() {
    const row = safe(() => window.TnaiThreads?.slot?.('main')?.querySelector('.tnt-asks'), null);
    if (!row) return false;
    if (list.parentElement !== row || bar.parentElement !== row) row.append(list, bar);
    return true;
  }

  // A thread's question without an "(after Decision N: …)" mark: the mark shows as its own line.
  const shownQuestion = question =>
    String(question || '').replace(/\s*\(\s*after\s+Decision\s+\d+[^)]*\)/i, '');

  // decision N of a report: the one numbered N, else its N-th
  const numberOf = decision =>
    safe(() => window.TnaiContext.decisionNumber(decision.question), 0) || decision.n + 1;

  function decisionCard(group, decision) {
    const ask = make('div', 'tnt-decide');
    ask.dataset.open = 'true';
    ask.append(make('b', '', shownQuestion(decision.question)));

    // "Best answered after Decision N: why", while that one is open too
    const first = safe(() => window.TnaiContext.dependsOn(decision.question), null);
    const firstOpen =
      first &&
      group.decisions.some(other => other !== decision && numberOf(other) === first.number);
    if (firstOpen)
      ask.append(
        make(
          'small',
          'tnt-decide-after',
          'Best answered after Decision ' + first.number + (first.why ? ': ' + first.why : '')
        )
      );

    const options = make('div', 'tnt-decide-options');
    (decision.options || []).forEach((option, at) => {
      const label = String(option.label || '');
      const button = make('button', '', label + (option.recommended ? ' (recommended)' : ''));
      button.type = 'button';
      button.title = option.detail || '';
      button.addEventListener('click', () => press(group, decision, ask, button, label, at));
      options.append(button);
    });
    ask.append(options);
    return ask;
  }

  // Pressed recently: shown as "your choice" for a moment before the list drops it.
  const SHOW_SENT_MS = 1400;

  function press(group, decision, ask, button, label, at) {
    const sent = safe(
      () => window.TnaiContext.decideInThread(group.paneId, decision.question, at, label, group.at),
      false
    );
    if (!sent) {
      foot.textContent = group.name + ' could not take the answer. Open its thread to answer it.';
      return;
    }
    button.classList.add('tnt-decide-chosen');
    ask.querySelectorAll('button').forEach(other => {
      other.disabled = true;
    });
    ask.dataset.open = 'false';
    ask.querySelector('.tnt-decide-after')?.remove();
    foot.textContent =
      sent === 'composer'
        ? group.name + ' is not running: your answer is in the prompt box.'
        : 'Sent to ' + group.name + ': ' + label + '.';
    setTimeout(paint, SHOW_SENT_MS);
  }

  function threadRow(group) {
    const row = make('div', 'tod-thread');
    const mark = make('i', '', (group.name.trim()[0] || '?').toUpperCase());
    const color = safe(() => window.TnaiAgentMarks.agentColor(group.name), '');
    if (color) mark.style.setProperty('--tone', color);
    const name = make('b', '', group.name);
    const tool = make('span', '', group.tool ? '· ' + group.tool : '');
    const go = make('button', 'tod-go', 'Go to thread');
    go.type = 'button';
    go.addEventListener('click', () => {
      setOpen(false);
      safe(() => window.TnaiThreads.show(group.paneId), null);
    });
    row.append(mark, name, tool, go);
    return row;
  }

  // ---------- paint ----------
  let painted = '';

  function paint() {
    if (!dock()) return;
    const groups = waiting();
    const decisions = groups.reduce((sum, group) => sum + group.decisions.length, 0);
    const show = groups.length >= MIN_THREADS;
    bar.hidden = !show;
    if (!show && open) open = false;
    list.hidden = !show || !open;
    if (!show) {
      painted = '';
      return;
    }
    const label =
      decisions +
      (decisions === 1 ? ' decision' : ' decisions') +
      ' · ' +
      groups.length +
      ' threads';
    if (bar.children[1].textContent !== label) bar.children[1].textContent = label;
    bar.title = open ? 'Close the list' : 'Answer the decisions every thread waits on, from here';
    count.textContent = decisions + ' in ' + groups.length + ' threads';
    if (!open) return;

    // Drawn again only when what waits changed, so a press's "your choice" and the keyboard's
    // place are not thrown away by an unrelated repaint.
    const key = JSON.stringify(
      groups.map(group => [group.paneId, group.decisions.map(decision => decision.question)])
    );
    if (key === painted && body.childElementCount) return;
    painted = key;
    const parts = [];
    for (const group of groups) {
      parts.push(threadRow(group));
      for (const decision of group.decisions) parts.push(decisionCard(group, decision));
    }
    body.replaceChildren(...parts);
  }

  // One paint for a burst of wake-ups. A short timer, not an animation frame: frames do not run
  // while the window is hidden, and the bar must be right when the window comes back.
  const PAINT_AFTER_MS = 40;
  let queued = 0;
  const schedule = () => {
    if (queued) return;
    queued = setTimeout(() => {
      queued = 0;
      paint();
    }, PAINT_AFTER_MS);
  };

  safe(() => window.TnaiAgents.onChange(schedule), null);
  window.addEventListener('tnai:context-data', schedule);
  window.addEventListener('tnai:threads-built', schedule);
  window.addEventListener('tnai:threads-shown', schedule);
  window.addEventListener('tnai:threads-select', schedule);
  schedule();

  window.TnaiOpenDecisions = { waiting, open: () => setOpen(true), close: () => setOpen(false) };
})();
