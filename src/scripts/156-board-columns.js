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

  const api = { COLUMNS, columnOf, sameDay, WORKING };
  if (typeof window !== 'undefined') window.TnaiBoardColumns = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
