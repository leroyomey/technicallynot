/*
 * Technically Not · 169-text-selection.js — a text selection stays in the area it started in, and
 * a thread's own text is what Ctrl+A selects (user screenshot 2026-10-21: moving around the app,
 * a drag from the conversation ran on through the side column's text and file list).
 *
 * At each press of the main button the window marks the area the press lands in (the thread
 * list, the open thread, the side column, an All threads card, the prompt box); the style sheet
 * (`src/styles/50-text-selection.css`) then lets no other area join the selection. Inside the
 * open thread the conversation and the CLI screen are kept apart the same way. Nothing changes
 * for a click: the mark only limits where a drag's selection may reach.
 *
 * Also: a selection left in a thread is let go when another thread opens, so a highlight never
 * stays behind on a page it no longer belongs to; and Ctrl+A with no text field focused selects
 * the open thread's conversation, not every word of the window (on All threads: the conversation
 * of the card under the pointer, or of the focused card). A right press over a control opens no
 * menu; over text the main process shows Copy, Cut, Paste and Select all (desktop/text-menu.js).
 *
 * Test: desktop `text-selection`.
 */
(() => {
  'use strict';

  const root = document.documentElement;

  // The areas a selection may not leave, the most precise first.
  const AREAS = '.tat-card, .tnt-slot, footer.composer';
  let marked = null;

  // The app's controls, which hold no words worth copying (the same list as 50's first rule).
  const NOT_TEXT = [
    '.tnt-list',
    '.tnt-head',
    '.tnt-sidebox-head',
    '.tnt-sidebox-tabs',
    '.tnt-menu',
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    'footer.composer .hints',
    '.top',
  ].join(', ');

  const editable = node =>
    !!node?.closest?.('input, textarea, [contenteditable=""], [contenteditable="true"], .xterm');

  // Marks the area a selection may stay in: the one `target` is in.
  function markAt(target) {
    const area = target?.closest?.(AREAS);
    if (marked && marked !== area) delete marked.dataset.selHere;
    marked = area || null;
    if (!area) {
      delete root.dataset.selFrom;
      return;
    }
    area.dataset.selHere = '';

    // An All threads card: the page around the cards takes no part either. Inside the open
    // thread: the conversation or the CLI screen.
    const inView = target.closest('.tnt-view');
    root.dataset.selFrom = area.matches('.tat-card')
      ? 'card'
      : !inView
        ? 'area'
        : target.closest('.tnt-term')
          ? 'term'
          : target.closest('.tnt-talk')
            ? 'talk'
            : 'area';
  }

  function mark(event) {
    if (event.button === 0) markAt(event.target);
  }

  document.addEventListener('pointerdown', mark, true);

  // Another thread opened: a selection inside the thread view belongs to the one that left.
  let shownPane = '';
  window.addEventListener('tnai:thread-view', event => {
    const paneId = event.detail?.paneId || '';
    if (paneId === shownPane) return;
    shownPane = paneId;
    const picked = window.getSelection();
    const anchor = picked?.anchorNode;
    const node = anchor?.nodeType === 1 ? anchor : anchor?.parentElement;
    if (node?.closest?.('.tnt-view')) picked.removeAllRanges();
  });

  // Where the pointer last was, so Ctrl+A on All threads can pick the card under it.
  let pointerX = -1;
  let pointerY = -1;
  document.addEventListener(
    'pointermove',
    event => {
      pointerX = event.clientX;
      pointerY = event.clientY;
    },
    { capture: true, passive: true }
  );

  const shows = node => !!node && node.getClientRects().length > 0;

  // On All threads: the card under the pointer, else the focused card, else the card the
  // prompt box sends to.
  function cardNow() {
    const under = pointerX >= 0 ? document.elementFromPoint(pointerX, pointerY) : null;
    return (
      under?.closest?.('.tat-card') ||
      document.activeElement?.closest?.('.tat-card') ||
      document.querySelector('.tat-card.tat-target')
    );
  }

  // An open dialog on screen: the one the keyboard or the press is in, else the last one shown
  // (the topmost). While one is open, Ctrl+A takes its words only (learned 2026-10-22: with a
  // dialog open, Select all took the conversation behind it as well).
  const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

  function dialogNow(target) {
    const own =
      document.activeElement?.closest?.(DIALOGS) ||
      (target?.nodeType === 1 ? target : target?.parentElement)?.closest?.(DIALOGS);
    if (shows(own)) return own;
    const open = [...document.querySelectorAll(DIALOGS)].filter(shows);
    return open[open.length - 1] || null;
  }

  // The conversation Ctrl+A selects: a card's on All threads, else the open thread's.
  // `null` on All threads with no card to pick: then nothing is selected, never the whole page.
  function conversationNow() {
    if (document.querySelector('.layout.tat-on')) {
      const card = cardNow();
      if (!card) return null;
      return [...card.querySelectorAll('.tnt-talk-list')].find(shows) || null;
    }
    return document.querySelector('.tnt-view .tnt-talk:not([hidden]) .tnt-talk-list');
  }

  // Ctrl+A outside a text field: a thread's conversation, not the whole window.
  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'a')
      return;
    if (editable(document.activeElement) || editable(event.target)) return;
    if (event.target?.closest?.('.tnt-code')) return;

    // A dialog is open: its own words, nothing behind it.
    const dialog = dialogNow(event.target);
    if (dialog) {
      event.preventDefault();
      markAt(dialog);
      const range = document.createRange();
      range.selectNodeContents(dialog);
      const picked = window.getSelection();
      picked.removeAllRanges();
      picked.addRange(range);
      return;
    }

    const onAllThreads = !!document.querySelector('.layout.tat-on');
    const list = conversationNow();
    if (!list && !onAllThreads) return;
    event.preventDefault();
    if (!list) return;

    // The conversation becomes the marked area, or a mark left by an earlier press elsewhere
    // would keep it unselectable and the selection would copy nothing.
    markAt(list);
    const range = document.createRange();
    range.selectNodeContents(list);
    const picked = window.getSelection();
    picked.removeAllRanges();
    picked.addRange(range);
  });

  // A right press: the main process shows Copy, Cut, Paste and Select all
  // (desktop/text-menu.js). Over a control or the app's own words (a button, a tab, the thread
  // list) there is nothing to copy, so no menu opens there. The thread list's own menu (137) and
  // the terminals' copy and paste (10) have already taken their presses.
  document.addEventListener('contextmenu', event => {
    if (event.defaultPrevented) return;
    const target = event.target;
    if (editable(target)) return;
    if (String(window.getSelection() || '').trim()) return;
    const element = target?.nodeType === 1 ? target : target?.parentElement;
    if (!element?.closest || element.closest(NOT_TEXT)) event.preventDefault();
  });

  window.TnaiTextSelection = { area: () => root.dataset.selFrom || '' };
})();
