// Technically Not · 156-board-columns.js — which Board column a thread stands in (the Board page,
// 157). One plain rule, kept apart so tools/board-test.js can run it in Node:
//
// - Needs you: the thread waits on the user (a question, a permission, a report with an open
//   decision), whatever else is true.
// - Working: its status is one of the working ones (the thread list's own words, 119).
// - Ready for review: it is not working and its folder has changes that are not merged (153's
//   facts: files changed, and no merged pull request).
// - Done today: none of the above, and its last task ended today (or it started today).
// - Anything else (idle since an earlier day) stands in no column; the thread list still has it.
// window.TnaiBoardColumns = { COLUMNS, columnOf, sameDay }.
(() => {
  'use strict';

  const COLUMNS = [
    { id: 'next', title: 'Up next' },
    { id: 'work', title: 'Working' },
    { id: 'needs', title: 'Needs you' },
    { id: 'review', title: 'Ready for review' },
    { id: 'done', title: 'Done today' },
  ];

  // The statuses 10 writes on a panel that mean its agent is at work (119's TONE "work" and
  // "agents").
  const WORKING = new Set(['working', 'starting', 'running', 'background', 'waiting-agents']);

  // Two times on the same local calendar day.
  function sameDay(a, b) {
    if (!a || !b) return false;
    return new Date(a).toDateString() === new Date(b).toDateString();
  }

  // thread: { needs, status, decision (an open decision or null), changes (153's answer or null),
  // endedAt, startedAt }. now: the time. → a column id, or '' for none.
  function columnOf(thread, now = Date.now()) {
    if (!thread) return '';
    if (thread.needs || thread.decision) return 'needs';
    if (WORKING.has(thread.status)) return 'work';
    const changes = thread.changes;
    const merged = changes?.pr?.state === 'MERGED';
    if (changes && changes.files > 0 && !merged) return 'review';
    if (sameDay(thread.endedAt, now) || sameDay(thread.startedAt, now)) return 'done';
    return '';
  }

  // Board round 2 (user 2026-10-23, mock docs/plans/design-concepts/board-r2.html): the columns
  // in the order the user dragged their tabs into. Unknown ids are dropped and missing ones are
  // added in their usual place, so a saved order never loses a column.
  function ordered(savedIds) {
    const known = new Map(COLUMNS.map(column => [column.id, column]));
    const list = [];
    for (const id of Array.isArray(savedIds) ? savedIds : []) {
      if (known.has(id) && !list.includes(known.get(id))) list.push(known.get(id));
    }
    COLUMNS.forEach((column, at) => {
      if (list.includes(column)) return;
      const before = COLUMNS.slice(0, at)
        .filter(earlier => list.includes(earlier))
        .pop();
      list.splice(before ? list.indexOf(before) + 1 : 0, 0, column);
    });
    return list;
  }

  // A column's thread cards in groups. `by`: 'team' (a lead and its helpers in this column),
  // 'tool' (each agent CLI), or 'none'. cards: [{ thread: { id, name, tool, lead } }].
  // → [{ key, label, cards }] where a group of one has key '' and is drawn as a plain card.
  function groupsOf(cards, by) {
    if (by !== 'team' && by !== 'tool')
      return cards.map(card => ({ key: '', label: '', cards: [card] }));
    const ids = new Set(cards.map(card => card.thread.id));
    const keyOf = card => {
      if (by === 'tool') return card.thread.tool || '';
      if (card.thread.lead && ids.has(card.thread.lead)) return card.thread.lead;
      return cards.some(other => other.thread.lead === card.thread.id) ? card.thread.id : '';
    };
    const groups = [];
    const byKey = new Map();
    for (const card of cards) {
      const key = keyOf(card);
      if (!key) {
        groups.push({ key: '', label: '', cards: [card] });
        continue;
      }
      if (!byKey.has(key)) {
        const lead = cards.find(other => other.thread.id === key);
        const label = by === 'tool' ? key : (lead?.thread.name || 'Lead') + ' and helpers';
        const group = { key, label, cards: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      byKey.get(key).cards.push(card);
    }

    // a team's lead comes first in its group
    if (by === 'team') {
      for (const group of byKey.values()) {
        group.cards.sort((a, b) => (b.thread.id === group.key) - (a.thread.id === group.key));
      }
    }

    // a group of one is just its card
    return groups.flatMap(group =>
      group.key && group.cards.length < 2 ? [{ key: '', label: '', cards: group.cards }] : [group]
    );
  }

  const api = { COLUMNS, columnOf, sameDay, WORKING, ordered, groupsOf };
  if (typeof window !== 'undefined') window.TnaiBoardColumns = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
