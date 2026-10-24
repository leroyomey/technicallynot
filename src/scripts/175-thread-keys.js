/*
 * Technically Not · 175-thread-keys.js — the keyboard set (user 2026-10-23, mock
 * docs/plans/design-concepts/keyboard-set.html, from the Monocode video review):
 * - Ctrl+Alt+Up / Ctrl+Alt+Down: the previous / next thread in the thread list (119's order),
 * opened the way a press on its row opens it (`TnaiThreads.show`).
 * - Ctrl+P: the side column's Files tab, with its file search ready to type (`#repoRailSearch`).
 * - Ctrl+J: Your terminal with the keyboard (136); pressed in Your terminal, back to the prompt
 * box.
 * - Up / Down (and Home / End) with the keyboard in the thread list, after a click in it: the
 * thread the keys reach opens at once, and the keyboard stays in the list (user 2026-10-23).
 * - Left / Right on All threads: the previous / next card, while no text box, terminal, menu or
 * dialog has the keyboard (user 2026-10-23).
 *
 * Inside the CLI screen or any other terminal these keys stay the terminal's, so a program there
 * keeps them. On a Mac the Cmd key stands for Ctrl, as everywhere in the app (`tnaiPlatform.mod`).
 * The keys are listed in the shortcut list (32, group "Threads").
 *
 * Test: node tools/thread-keys-test.js
 */
(() => {
  'use strict';

  const mod = event =>
    window.tnaiPlatform?.mod ? window.tnaiPlatform.mod(event) : event.ctrlKey || event.metaKey;

  const inTerminal = target => !!target?.closest?.('.xterm');

  // Your terminal's own box (136): Ctrl+J there goes back to the prompt box.
  const inOwnTerminal = target => {
    const term = (() => {
      try {
        return window.TnaiOwnTerminal?.term?.() || null;
      } catch {
        return null;
      }
    })();
    return !!term?.element && !!target && term.element.contains(target);
  };

  // The threads in the list's order, without a helper's small row (it opens its lead).
  // With the list hidden (Ctrl+B) its rows are not on screen: then every row counts.
  function threadIds() {
    const rows = [...document.querySelectorAll('.tnt-th[data-pane]:not(.tnt-sub)')];
    const shown = rows.filter(row => row.getClientRects().length > 0);
    return (shown.length ? shown : rows)
      .map(row => row.dataset.pane)
      .filter((id, at, all) => id && all.indexOf(id) === at);
  }

  function step(by) {
    const ids = threadIds();
    if (!ids.length) return false;
    const now = window.TnaiThreads?.selected?.() || '';
    const at = ids.indexOf(now);
    const next =
      at < 0 ? ids[by > 0 ? 0 : ids.length - 1] : ids[(at + by + ids.length) % ids.length];
    return !!window.TnaiThreads?.show?.(next);
  }

  // The next thread after the open one with something for the user: a dot (174) or a question
  // (71), in the list's order, wrapping (Ctrl+Alt+Shift+Down; user 2026-10-23, mock
  // docs/plans/design-concepts/since-you-left.html).
  function nextForYou() {
    const ids = threadIds();
    if (!ids.length) return false;
    const now = window.TnaiThreads?.selected?.() || '';
    const start = Math.max(0, ids.indexOf(now));
    const hasSomething = id => {
      try {
        return !!window.TnaiUnread?.has?.(id) || !!window.TnaiNeedsYou?.has?.(id);
      } catch {
        return false;
      }
    };
    for (let step = 1; step <= ids.length; step++) {
      const id = ids[(start + step) % ids.length];
      if (id !== now && hasSomething(id)) return !!window.TnaiThreads?.show?.(id);
    }
    try {
      // nothing to jump to: said, so the press is not taken for a fault (01's toast)
      if (typeof toast === 'function') toast('Nothing new and nothing waiting for you');
    } catch {}
    return true;
  }

  function findFile() {
    window.TnaiThreads?.open?.();
    window.TnaiThreadSide?.open?.('files');

    // the file rail comes into the tab when the tab shows: the box is looked for after that
    requestAnimationFrame(() => {
      const box = document.getElementById('repoRailSearch');
      if (!box) return;
      box.focus();
      box.select?.();
    });
    return true;
  }

  function terminalOrBack(target) {
    if (inOwnTerminal(target)) {
      const prompt = document.getElementById('prompt');
      prompt?.focus();
      return !!prompt;
    }
    if (!window.TnaiOwnTerminal?.open) return false;
    window.TnaiOwnTerminal.open();
    return true;
  }

  document.addEventListener(
    'keydown',
    event => {
      if (!mod(event) || event.repeat) return;
      const key = event.key;
      const target = event.target;
      const shift = event.shiftKey;
      const alt = event.altKey;
      let done = false;

      if (alt && shift && key === 'ArrowDown') {
        if (inTerminal(target)) return;
        done = nextForYou();
      } else if (alt && !shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
        if (inTerminal(target)) return;
        done = step(key === 'ArrowUp' ? -1 : 1);
      } else if (!alt && !shift && key.toLowerCase() === 'p') {
        if (inTerminal(target)) return;
        done = findFile();
      } else if (!alt && !shift && key.toLowerCase() === 'j') {
        // in another terminal (a thread's CLI screen) Ctrl+J stays the program's
        if (inTerminal(target) && !inOwnTerminal(target)) return;
        done = terminalOrBack(target);
      }
      if (!done) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true
  );

  // ---------- the thread list: Up / Down open the thread they reach ----------
  // 119 moves the keyboard between the list's rows (Up, Down, Home, End) and takes the key. This
  // runs after it, on the way out of the page: the row that has the keyboard now is opened the way
  // a press on it opens it (119 and 138 take that press), and gets the keyboard back so the user
  // can keep flipping. A held key only moves the keyboard; the thread under it opens when the key
  // is let go, so a long hold does not open every thread on the way.
  const LIST_KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
  let heldInList = false;

  function listRow(node) {
    const row = node?.closest?.('.tnt-th');
    const list = window.TnaiThreads?.slot?.('list');
    return row && list && list.contains(row) ? row : null;
  }

  function openRow(row) {
    const key = row.dataset.key;
    row.click();

    // Opening may hand the keyboard elsewhere (Your terminal giving its place back), and the list
    // may draw its rows again: the same row, found by its key, gets the keyboard back.
    const back = () => {
      const list = window.TnaiThreads?.slot?.('list');
      let again = row.isConnected ? row : null;
      if (!again && list && key != null) {
        again = [...list.querySelectorAll('.tnt-th')].find(other => other.dataset.key === key);
      }
      if (again && document.activeElement !== again) again.focus({ preventScroll: true });
    };
    back();
    requestAnimationFrame(() => {
      if (!listRow(document.activeElement)) back();
    });
    return true;
  }

  document.addEventListener('keydown', event => {
    if (!LIST_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;

    // 119 took the key only when it moved the keyboard (not at the top or the bottom of the list)
    if (!event.defaultPrevented) return;
    const from = listRow(event.target);
    const to = listRow(document.activeElement);
    if (!from || !to || to === from) return;
    if (event.repeat) {
      heldInList = true;
      return;
    }
    openRow(to);
  });

  document.addEventListener('keyup', event => {
    if (!heldInList || !LIST_KEYS.includes(event.key)) return;
    heldInList = false;
    const row = listRow(document.activeElement);
    if (row) openRow(row);
  });

  // ---------- All threads: Left / Right, the previous / next card ----------
  // The arrows stay with whatever uses them itself: a text box (the prompt box too), a terminal,
  // a menu or a list of choices, and an open dialog. A held key moves once, like the Ctrl+Alt
  // keys of 135.
  const OWNS_ARROWS = [
    'input',
    'textarea',
    'select',
    '[contenteditable]:not([contenteditable="false"])',
    '.xterm',
    '[role="menu"]',
    '[role="menubar"]',
    '[role="listbox"]',
    '[role="tablist"]',
    '[role="radiogroup"]',
    '[role="slider"]',
    '[role="tree"]',
    '[role="grid"]',
  ].join(', ');
  const DIALOGS = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]';

  const dialogOpen = () =>
    [...document.querySelectorAll(DIALOGS)].some(node => node.getClientRects().length > 0);

  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (event.defaultPrevented) return;
    const allThreads = window.TnaiAllThreads;
    if (!allThreads?.on || typeof allThreads.go !== 'function') return;
    if (event.target?.closest?.(OWNS_ARROWS) || dialogOpen()) return;
    event.preventDefault();
    if (!event.repeat) allThreads.go(event.key === 'ArrowLeft' ? -1 : 1);
  });

  window.TnaiThreadKeys = { step, nextForYou, findFile, threadIds };
})();
