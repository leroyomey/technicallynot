/*
 * Technically Not · 174-thread-unread.js — where did something happen (user 2026-10-23, mock
 * docs/plans/design-concepts/unread-and-count.html): a dot on a thread that finished a task while
 * the user was looking at another thread or at another app, and the count in the window title
 * and on the taskbar icon.
 *
 * A thread turns unread when its task ends (42's `tnai:turn`, `TnaiTurns.get(paneId).endedAt`) and
 * it is not the open thread of a focused window. Opening the thread, or coming back to the window
 * while it is open, clears it. Tasks that ended before this window started do not count, so a
 * restart does not light every thread. Unread is not kept across a restart.
 *
 * The thread list (119) draws the dot (`TnaiUnread.has`, `.tip`); 71 adds these threads to the
 * "(N)" of the window title, each once, and hands the total to `badge`, which draws the number on
 * the taskbar icon through main (`tnaiNative.attention.badge`, Windows only).
 *
 * Test: node tools/thread-unread-test.js
 */
(() => {
  'use strict';

  // ends before this moment are history, not news (with a little room for a restore)
  const startedAt = Date.now();

  // paneId → { at: when the task ended }
  const unread = new Map();

  // the newest end already handled per thread, so one end is news once
  const handled = new Map();
  let open = '';
  let badgeShown = -1;

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  const looking = paneId => paneId === open && document.hasFocus() && !document.hidden;

  const changed = () => window.dispatchEvent(new CustomEvent('tnai:unread-changed'));

  function clear(paneId) {
    if (!paneId || !unread.delete(paneId)) return;
    changed();
  }

  // A task ended: news, unless the user is looking at that thread right now.
  window.addEventListener('tnai:turn', event => {
    const paneId = event.detail?.paneId;
    if (!paneId) return;
    const turn = safe(() => window.TnaiTurns?.get?.(paneId), null);
    const endedAt = Number(turn?.endedAt) || 0;
    if (!endedAt || endedAt < startedAt || endedAt <= (handled.get(paneId) || 0)) return;
    if ((Number(turn.startedAt) || 0) > endedAt) return;
    handled.set(paneId, endedAt);
    if (looking(paneId)) return;
    unread.set(paneId, { at: endedAt });
    changed();
  });

  // Opening a thread reads it; coming back to the window reads the open one.
  window.addEventListener('tnai:thread-view', event => {
    open = event.detail?.paneId || '';
    if (looking(open)) clear(open);
  });
  window.addEventListener('focus', () => clear(open));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.hasFocus()) clear(open);
  });

  // A thread that closed has nothing left to read.
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const paneId = event.detail?.paneId;
    handled.delete(paneId);
    clear(paneId);
  });

  // ---------- the taskbar's count ----------
  // A round badge in the accent with the number, drawn here, shown by Windows over the app's icon.
  function picture(count) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const pen = canvas.getContext('2d');
    if (!pen) return '';
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--pg-accent').trim() ||
      '#a855f7';
    pen.fillStyle = accent;
    pen.beginPath();
    pen.arc(16, 16, 15, 0, Math.PI * 2);
    pen.fill();
    pen.fillStyle = '#fff';
    pen.font = '700 ' + (count > 9 ? 15 : 19) + 'px sans-serif';
    pen.textAlign = 'center';
    pen.textBaseline = 'middle';
    pen.fillText(count > 99 ? '99+' : String(count), 16, 17);
    return canvas.toDataURL('image/png');
  }

  function badge(count) {
    const total = Math.max(0, Number(count) || 0);
    if (total === badgeShown) return;
    badgeShown = total;
    const native = window.tnaiNative?.attention;
    if (!native?.badge) return;
    Promise.resolve(native.badge(total ? picture(total) : '', total)).catch(() => {});
  }

  // A tooltip for a row: what happened, and when.
  function tip(paneId) {
    const item = unread.get(paneId);
    if (!item) return '';
    const when = safe(() => window.TnaiTimes?.clock?.(item.at), '');
    return 'Finished a task' + (when ? ' at ' + when : '') + ' while you were elsewhere';
  }

  window.TnaiUnread = {
    has: paneId => unread.has(paneId),
    panes: () => [...unread.keys()],
    tip,
    badge,
  };
})();
