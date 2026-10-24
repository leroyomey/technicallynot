/*
 * Technically Not · 177-since-you-left.js — "New since you left" (user 2026-10-23, mock
 * docs/plans/design-concepts/since-you-left.html): opening a thread that got something new while
 * another thread was open (174's unread dot) puts a quiet line in the accent where its new part
 * starts, and the view opens there instead of at the very end. The line stays until the user sends
 * something in that thread.
 *
 * 122 calls the three hooks with its own state of the conversation:
 * - `leave(state)` when the thread leaves the view: the last line read is remembered, and when;
 * - `arrive(state)` when it comes back: with the dot on, the line goes right after that last line;
 * - `hold(state)` after a read: when new lines came in under the line, the view goes to the line
 *   (true), so 122 does not move to the end.
 *
 * Test: node tools/since-you-left-test.js
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

  // Threads that had the dot since they were last opened here (174 clears its own on opening, so
  // the fact is kept here until the thread arrives).
  const flagged = new Set();
  window.addEventListener('tnai:unread-changed', () => {
    for (const paneId of safe(() => window.TnaiUnread?.panes?.() || [], [])) flagged.add(paneId);
  });

  // paneId → the line shown now
  const lines = new Map();

  function removeLine(paneId) {
    lines.get(paneId)?.remove();
    lines.delete(paneId);
  }

  // The last thing read in a conversation: its last block before the live line.
  function lastRead(state) {
    let node = state.list.lastElementChild;
    while (node && (node === state.live || node.classList.contains('tnt-since'))) {
      node = node.previousElementSibling;
    }
    return node;
  }

  function leave(state) {
    if (!state || state.sub) return;
    state.sinceMark = lastRead(state);
    state.sinceLeftAt = Date.now();
  }

  function arrive(state) {
    if (!state || state.sub) return;
    const paneId = state.paneId;
    const had = flagged.delete(paneId);
    state.sinceHold = false;
    if (!had || !state.sinceMark?.isConnected) return;
    removeLine(paneId);
    const line = document.createElement('div');
    line.className = 'tnt-since';
    line.setAttribute('role', 'separator');
    const at = state.sinceLeftAt;
    const clock = safe(() => window.TnaiTimes?.clock?.(at), '');
    line.textContent = 'New since you left' + (clock ? ' · ' + clock : '');
    state.sinceMark.after(line);
    lines.set(paneId, line);
    state.sinceHold = true;
  }

  // After a read: the view goes to the line when new lines stand under it.
  function hold(state) {
    if (!state?.sinceHold) return false;
    state.sinceHold = false;
    const line = lines.get(state.paneId);
    if (!line?.isConnected) return false;
    const next = line.nextElementSibling;
    if (!next || next === state.live) {
      // nothing new came in after all: no line
      removeLine(state.paneId);
      return false;
    }
    const host = state.host;
    if (!host) return false;
    host.scrollTop = Math.max(0, line.offsetTop - host.offsetTop - 12);
    return true;
  }

  // The user wrote in that thread: the line has done its job.
  window.addEventListener('tnai:prompt-sent', event => {
    const paneId = event.detail?.paneId;
    if (paneId) removeLine(paneId);
  });

  window.TnaiSinceYouLeft = { leave, arrive, hold, shown: paneId => lines.has(paneId) };
})();
