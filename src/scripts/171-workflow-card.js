/*
 * Technically Not · 171-workflow-card.js — a Claude Code workflow as one card in the thread's
 * conversation: its name and what it does, its phases in order, one row per helper with its state
 * and time, and the script folded. A press on a row opens that helper's own conversation beside
 * the thread, as a helper of the Agent tool does (`tnai:thread-helper`, 123).
 * User 2026-10-21: "Lets add this feature aswell" (T3 Code's workflow card), then "Yes, build it
 * as shown" (mock docs/plans/design-concepts/workflow-card.html).
 *
 * Where it comes from (read from a real run, 2026-10-21): the conversation's Workflow call carries
 * the script, whose `meta` names the workflow and its phases (desktop/thread-log-claude.js); its
 * result carries the run id and the task id; the run's journal lists each helper as it starts and
 * ends (desktop/workflow-runs.js), and a watcher on it pushes `workflow:changed`, so nothing is
 * polled. The task's "<task-notification>" ends the run. Only Claude Code has workflows; other
 * CLIs show their helpers as today.
 *
 * Hooks from 122: `note` (an action), `result` (its result), `notice` (a note), `place` (the
 * moment designs are placed). Look: src/styles/52-workflow-card.css.
 * Test: `node tools/workflow-card-test.js`.
 */
(() => {
  'use strict';
  const native = window.tnaiNative;

  // per conversation view: cards waiting to be placed
  const waiting = new WeakMap();

  // per conversation view: its cards by action id; and the running cards of a run by
  // "paneId runId", for the pushed changes
  const byAct = new WeakMap();
  const byRun = new Map();

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // "23m 13s", "8s", "1h 4m"
  function took(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return hours + 'h ' + minutes + 'm';
    if (minutes) return minutes + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
    return seconds + 's';
  }

  function clockOf(at) {
    try {
      return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  // ---------- the card ----------
  function build(state, entry) {
    const flow = entry.workflow || {};
    const card = {
      state,
      entry,
      runId: '',
      taskId: '',
      done: false,
      failed: false,
      helpers: [],
      node: make('div', 'tnt-wf'),
    };
    card.node.dataset.state = 'working';
    const kicker = make('div', 'tnt-wf-kicker');
    card.label = make('span', '', 'Workflow started');
    card.count = make('span', 'tnt-wf-count', 'Starting…');
    kicker.append(card.label, make('span', 'tnt-wf-grow'), card.count);
    const name = make('div', 'tnt-wf-name', flow.name || entry.what || 'Workflow');
    card.node.append(kicker, name);
    if (flow.description) card.node.append(make('p', 'tnt-wf-desc', flow.description));
    card.list = make('div', 'tnt-wf-phases');
    card.node.append(card.list);
    if (flow.script) {
      const fold = make('details', 'tnt-wf-script');
      fold.append(make('summary', '', 'Show full script'), make('pre', '', flow.script));
      card.node.append(fold);
    }
    card.foot = make('div', 'tnt-wf-foot', entry.at ? 'Started ' + clockOf(entry.at) : '');
    card.node.append(card.foot);
    paint(card);
    return card;
  }

  function row(card, helper) {
    const press = make('button', 'tnt-wf-row');
    press.type = 'button';
    press.dataset.state = helper.state;
    press.title = 'Open this helper’s own conversation beside this one';
    const dot = make('i', 'tnt-wf-dot');
    const text = make('span', 'tnt-wf-text');
    text.append(make('b', '', helper.label || 'Helper'));
    let time = helper.state === 'done' ? 'done' : 'working';
    if (helper.state === 'done' && helper.startedAt && helper.endedAt)
      time = took(helper.endedAt - helper.startedAt);
    const open = make('span', 'tnt-wf-open');
    open.innerHTML = window.TnaiIcon?.('chevron-right', { size: 14 }) || '›';
    press.append(dot, text, make('span', 'tnt-wf-time', time), open);
    press.addEventListener('click', () =>
      window.dispatchEvent(
        new CustomEvent('tnai:thread-helper', {
          detail: { paneId: card.state.paneId, sub: helper.id, title: helper.label || 'Helper' },
        })
      )
    );
    return press;
  }

  function paint(card) {
    const phases = [...(card.entry.workflow?.phases || [])];
    for (const helper of card.helpers)
      if (helper.phase && !phases.includes(helper.phase)) phases.push(helper.phase);
    const groups = [];
    for (const title of phases)
      groups.push({ title, helpers: card.helpers.filter(helper => helper.phase === title) });
    const loose = card.helpers.filter(helper => !helper.phase || !phases.includes(helper.phase));
    if (loose.length) groups.push({ title: '', helpers: loose });

    const rows = [];
    for (const group of groups) {
      const done = group.helpers.filter(helper => helper.state === 'done').length;
      const head = make('div', 'tnt-wf-phase', group.title || 'Helpers');
      let state = 'not started';
      if (group.helpers.length) state = done + ' of ' + group.helpers.length;
      head.append(make('small', '', state));
      rows.push(head, ...group.helpers.map(helper => row(card, helper)));
    }
    card.list.replaceChildren(...rows);

    const working = card.helpers.filter(helper => helper.state !== 'done').length;
    const finished = card.helpers.length - working;
    const total = card.helpers.length;
    if (!total) card.count.textContent = card.done ? 'No helpers' : 'Starting…';
    else if (card.done || !working)
      card.count.textContent = total + (total === 1 ? ' helper' : ' helpers') + ' · all done';
    else
      card.count.textContent =
        total +
        (total === 1 ? ' helper' : ' helpers') +
        ' · ' +
        working +
        ' working · ' +
        finished +
        ' done';

    card.node.dataset.state = card.failed ? 'failed' : card.done ? 'done' : 'working';
    card.label.textContent = card.failed
      ? 'Workflow stopped'
      : card.done
        ? 'Workflow finished'
        : 'Workflow started';
    if (card.done) {
      const ends = card.helpers.map(helper => helper.endedAt).filter(Boolean);
      const last = ends.length ? Math.max(...ends) : 0;
      card.foot.textContent =
        last && card.entry.at ? 'Finished in ' + took(last - card.entry.at) : 'Finished';
    }
  }

  // ---------- reading the run ----------
  function refresh(card) {
    if (!card.runId || !native?.workflows) return;
    watchRun(card);
    native.workflows
      .read(card.state.paneId, card.runId)
      .then(found => {
        if (!found?.ok) return;
        card.helpers = Array.isArray(found.helpers) ? found.helpers : [];
        paint(card);
      })
      .catch(() => {});
  }

  function finish(card, status) {
    card.done = true;
    card.failed = !!status && status !== 'completed';
    const key = card.state.paneId + ' ' + card.runId;
    byRun.get(key)?.delete(card);

    // the watch ends when no card of this run is still running
    if (!byRun.get(key)?.size) {
      byRun.delete(key);
      native?.workflows?.unwatch?.(card.state.paneId, card.runId);
    }
    refresh(card);
    paint(card);
  }

  // A watch the app refused (the run's folder not there yet, or too many watched) is asked again
  // at the card's next read.
  function watchRun(card) {
    if (card.watching || card.done || !native?.workflows?.watch) return;
    Promise.resolve(native.workflows.watch(card.state.paneId, card.runId))
      .then(started => {
        card.watching = started === true;
      })
      .catch(() => {});
  }

  native?.workflows?.onChange?.(change => {
    const key = String(change?.paneId || '') + ' ' + String(change?.runId || '');
    for (const card of byRun.get(key) || []) refresh(card);
  });

  // ---------- hooks from 122 ----------
  // Cards are kept per conversation view (as 159's), so a view drawn again gets its own card.
  function cardsOf(state) {
    let map = byAct.get(state);
    if (!map) byAct.set(state, (map = new Map()));
    return map;
  }

  function note(state, entry, add) {
    if (entry?.kind !== 'act' || entry.tool !== 'Workflow' || !entry.id) return;
    const cards = cardsOf(state);
    if (cards.has(entry.id)) return;
    const card = build(state, entry);
    cards.set(entry.id, card);
    let list = waiting.get(state);
    if (!list) waiting.set(state, (list = []));
    list.push({ card, add });
  }

  function place(state, add) {
    const list = waiting.get(state);
    if (!list?.length) return;
    waiting.delete(state);
    for (const item of list) (add || item.add)(item.card.node);
  }

  function result(state, act, entry) {
    if (act?.tool !== 'Workflow' || !entry?.runId) return;
    const card = cardsOf(state).get(act.id);
    if (!card || card.runId) return;
    card.runId = entry.runId;
    card.taskId = entry.taskId || '';
    const key = state.paneId + ' ' + card.runId;
    if (!byRun.has(key)) byRun.set(key, new Set());
    byRun.get(key).add(card);
    refresh(card);
  }

  function notice(state, entry) {
    if (!entry?.taskId) return;
    for (const card of cardsOf(state).values())
      if (card.taskId === entry.taskId && !card.done) finish(card, entry.status);
  }

  window.TnaiWorkflowCard = { note, place, result, notice, took };
})();
