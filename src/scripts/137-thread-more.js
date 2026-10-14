/*
 * Technically Not · 137-thread-more.js — the open thread's own "..." menu.
 * Desktop app only. The button is the last one of the thread's top row (120 builds it,
 * `.tnt-head-menu`); this file opens the menu under it and does what its rows say.
 *
 * The rows are what one agent's row of buttons was on the old Agents page, each done through the
 * same function that page uses, for the thread that is open:
 *   Rename        the name is edited in place in the top row (21 `inlineEdit`, `TnaiPaneNames`)
 *   Team          the team box of 88 (`TnaiAgentTeams.open`); an agent in a project only
 *   CLI screen    the tool's own terminal for this thread (120 `setMode`); while it is shown the
 *                 row reads "Back to the conversation". Only for a tool with a conversation.
 *   Stop / Start  Stop while the session runs (it asks first, as the old page does), Start while
 *                 it is stopped (10 `TnaiAgents.stop` / `start`)
 *   Close thread  11 `TnaiLiveTasks.close`, which asks first while the session runs
 *
 * The menu is the app's three-dots menu in small: the same panel and rows (`.tnt-menu`,
 * `.tnt-menu-row`, 27-thread-frame.css), a press outside or Escape closes it, the arrow keys move
 * through the rows and the keyboard goes back to the button. Its few own rules are at the end of
 * src/styles/29-thread-view.css. `window.TnaiThreadMore`. Test: `thread-more`.
 */
(() => {
  'use strict';
  if (!window.tnaiNative) return;

  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  // ---------- the open thread ----------
  const openPane = () => window.TnaiThreadView?.shown?.() || '';
  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(session => session.paneId === paneId) || null;
  const threadOf = paneId => {
    try {
      return window.TnaiThreadList?.thread(paneId) || null;
    } catch {
      return null;
    }
  };
  const island = () => document.querySelector('.tnt-view');
  const menuButton = () => document.querySelector('.tnt-view .tnt-head-menu');

  // The tool keeps a record this app can read, so the thread has a conversation to go back to.
  const hasConversation = paneId => {
    try {
      return !!window.TnaiThreadReadable?.can(threadOf(paneId)?.tool);
    } catch {
      return false;
    }
  };
  const screenShown = () => window.TnaiThreadView?.mode?.() === 'term';

  // A team is for an agent that works in a project (88 has the same rule for its own button).
  function canTeam(paneId) {
    const session = sessionOf(paneId);
    if (!session || session.agent === 'Terminal' || !window.TnaiAgentTeams?.open) return false;
    const mesh = window.TnaiMesh?.state?.() || [];
    return !!mesh.find(member => member.paneId === paneId)?.project;
  }

  // ---------- what each row does ----------
  let renaming = null;

  // The name becomes a field where it stands: Enter or leaving the field saves, Escape cancels.
  // The new name is saved by the panel's own rename (21), so it shows everywhere.
  function rename(paneId) {
    const title = document.querySelector('.tnt-view .tnt-head h1');
    const edit = window.TnaiTerminalPage?.inlineEdit;
    if (!title || title.hidden || !edit || renaming) return;
    const name = threadOf(paneId)?.name || sessionOf(paneId)?.name || '';
    renaming = edit(
      title,
      name,
      'Rename this thread',
      text => window.TnaiPaneNames?.rename(paneId, text),
      () => {
        renaming = null;
      }
    );
  }

  // Leaves the name as it was (the field's own Escape).
  function cancelRename() {
    renaming?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  }

  // The question is asked over the thread it is about, in the words of the old page.
  function stop(paneId) {
    const ask = window.TnaiPanelConfirm;
    const host = island();
    if (!ask || !host) return;
    ask(host, {
      title: 'Stop this agent session?',
      body: 'Its process will be ended.',
      ok: 'Stop',
      danger: true,
    }).then(yes => {
      if (yes) window.TnaiAgents?.stop?.(paneId);
    });
  }

  const start = paneId => window.TnaiAgents?.start?.(paneId);
  const closeThread = paneId => window.TnaiLiveTasks?.close?.(paneId, island());
  const team = paneId => window.TnaiAgentTeams?.open?.(paneId);
  const showScreen = () => window.TnaiThreadView?.setMode?.('term');
  const showConversation = () => window.TnaiThreadView?.setMode?.('read');

  function teamLabel(paneId) {
    const mates = window.TnaiAgentTeams?.mates?.(paneId) || [];
    return mates.length ? 'Team · ' + (mates.length + 1) + ' agents' : 'Team';
  }

  // The rows for one thread, as it is now. `keepFocus` rows put the keyboard somewhere themselves
  // (the name's field); after every other row it goes back to the menu's button.
  function rowsFor(paneId) {
    const session = sessionOf(paneId);
    if (!session) return [];
    const rows = [{ id: 'rename', label: 'Rename', icon: 'pencil', go: rename, keepFocus: true }];
    if (canTeam(paneId))
      rows.push({ id: 'team', label: teamLabel(paneId), icon: 'users', go: team });
    if (hasConversation(paneId)) {
      if (screenShown())
        rows.push({
          id: 'conversation',
          label: 'Back to the conversation',
          icon: 'arrow-left',
          go: showConversation,
        });
      else
        rows.push({ id: 'screen', label: 'CLI screen', icon: 'square-terminal', go: showScreen });
    }
    if (session.running) rows.push({ id: 'stop', label: 'Stop', icon: 'square-stop', go: stop });
    else rows.push({ id: 'start', label: 'Start', icon: 'play', go: start });
    rows.push({ id: 'close', label: 'Close thread', icon: 'x', go: closeThread });
    return rows;
  }

  // ---------- the menu ----------
  let menu = null;
  let button = null;
  let pane = '';
  let shownRows = [];

  function build() {
    if (menu) return;
    menu = document.createElement('div');
    menu.className = 'tnt-menu tnt-menu-thread';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'This thread');
    document.body.append(menu);
    menu.addEventListener('click', onRowPress);
    menu.addEventListener('keydown', onKey);
  }

  // Drawn again at every opening: which rows there are depends on the thread's state.
  function paint() {
    shownRows = rowsFor(pane);
    menu.replaceChildren(
      ...shownRows.map(row => {
        const rowButton = document.createElement('button');
        rowButton.type = 'button';
        rowButton.className = 'tnt-menu-row';
        rowButton.setAttribute('role', 'menuitem');
        rowButton.dataset.row = row.id;
        rowButton.innerHTML = icon(row.icon, 16) + '<span></span>';
        rowButton.querySelector('span').textContent = row.label;
        return rowButton;
      })
    );
  }

  const rowButtons = () => [...menu.querySelectorAll('.tnt-menu-row')];

  function onRowPress(event) {
    const pressed = event.target.closest('.tnt-menu-row');
    const row = pressed && shownRows.find(one => one.id === pressed.dataset.row);
    if (!row) return;
    const paneId = pane;
    close(!row.keepFocus);
    row.go(paneId);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }

    // Tab leaves the menu, so the menu closes: nothing stays open behind the keyboard.
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    const buttons = rowButtons();
    const at = buttons.indexOf(document.activeElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (at + 1) % buttons.length;
    if (event.key === 'ArrowUp') next = (at - 1 + buttons.length) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next]?.focus({ preventScroll: true });
  }

  // A press anywhere else closes the menu. On window in the capture phase, because some parts of
  // the app keep their presses to themselves.
  function onOutsidePress(event) {
    if (menu.contains(event.target) || button?.contains(event.target)) return;
    close();
  }

  const isOpen = () => !!menu && !menu.hidden;

  function open(anchor) {
    const paneId = openPane();
    const from = anchor || menuButton();
    if (!paneId || !from || isOpen()) return;
    build();
    pane = paneId;
    button = from;
    paint();
    if (!shownRows.length) return;
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    window.TnaiFloat?.attach(button, menu, { placement: 'bottom-end', offset: 6 });

    // placed first, focused after, and never scrolling the page
    rowButtons()[0]?.focus({ preventScroll: true });
    window.addEventListener('pointerdown', onOutsidePress, true);
  }

  function close(returnFocus) {
    if (!isOpen()) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    window.TnaiFloat?.detach?.(menu);
    window.removeEventListener('pointerdown', onOutsidePress, true);
    if (returnFocus && button?.isConnected) button.focus({ preventScroll: true });
  }

  // ---------- the button, and following the open thread ----------
  document.addEventListener('click', event => {
    const pressed = event.target.closest?.('.tnt-view .tnt-head-menu');
    if (!pressed) return;
    if (isOpen()) close();
    else open(pressed);
  });

  // Other files put their own buttons into the top row after 120 built it (123 at the start, 131
  // at the end). The "..." stays the last one, where a menu of more is looked for.
  function keepLast() {
    const more = menuButton();
    const acts = more?.parentNode;
    if (acts && acts.lastElementChild !== more) acts.append(more);
  }

  // Another thread was opened, or none: the menu and a name being edited belong to the one before.
  let lastPane = openPane();
  window.addEventListener('tnai:thread-view', event => {
    keepLast();
    const now = event.detail?.paneId || '';
    if (isOpen() && now !== pane) close();
    if (renaming && now !== lastPane) cancelRename();
    lastPane = now;
  });

  ['tnai:threads-hidden', 'tnai:threads-removed'].forEach(name =>
    window.addEventListener(name, () => {
      close();
      cancelRename();
    })
  );

  window.TnaiThreadMore = {
    open,
    close,
    isOpen,

    // the rows the menu has for a thread now (the open one when none is named): [{ id, label }]
    rows: paneId => rowsFor(paneId || openPane()).map(row => ({ id: row.id, label: row.label })),
  };
  keepLast();
})();
