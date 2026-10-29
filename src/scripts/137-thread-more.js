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
 *   Smaller text / Larger text   the CLI screen's text size, while it shows (10 `stepFont`)
 *   Pop out into its own window / Back into the app   (162)
 *   Past conversations, Handoff history, Blur this thread, Commit, pull request, review…
 *                 were icons of the top row until 2026-10-24 (user, tab 5 of app-polish.html:
 *                 the top row keeps Preview, Split, Stop or Start and "..."); each is done by the
 *                 file that owns it (138, 102, 120 `TnaiThreadBlur`, 154)
 *   Agent uses preview: off / on   whether this thread's agent may use Live preview (196)
 *   Stop / Start  Stop while the session runs (it asks first, as the old page does), Start while
 *                 it is stopped (10 `TnaiAgents.stop` / `start`)
 *   Open in VS Code / Cursor / File Explorer   the thread's own folder (its worktree when it has
 *                 one) in each editor found on this computer (desktop/open-in-editor.js)
 *   Hand off to a fresh agent   54 `TnaiContextUpkeep.handOff`, shown only while the agent is
 *                 idle and can be handed off
 *   Close thread  11 `TnaiLiveTasks.close`, which always asks first
 *
 * Two quicker ways in: the on/off button just before "..." on the top row does Stop / Start in one
 * press (`.tnt-head-power`), and a right press on a thread in the list (119) opens that thread
 * with this menu at its row.
 *
 * The menu is the app's three-dots menu in small: the same panel and rows (`.tnt-menu`,
 * `.tnt-menu-row`, 27-thread-frame.css), a press outside or Escape closes it, the arrow keys move
 * through the rows and the keyboard goes back to the button. Its few own rules are at the end of
 * src/styles/29-thread-view.css. `window.TnaiThreadMore`. Test: `thread-more`.
 *
 * The same menu also shows another list of rows (`openList`): the thread actions of 154 (commit,
 * pull request, review), with a label row over them.
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

  // The question is asked over the thread it is about, in the words of the old page: the open
  // thread's island, or the All threads card the menu was opened from.
  function stop(paneId, over) {
    const ask = window.TnaiPanelConfirm;
    const host = over || hostOf(paneId);
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
  const closeThread = paneId => window.TnaiLiveTasks?.close?.(paneId, hostOf(paneId));

  // Stop while the session runs (it asks first), Start while it is stopped: the on/off button of
  // the top row and of every All threads card (135).
  function stopOrStart(paneId, over) {
    const session = sessionOf(paneId);
    if (!session) return;
    if (session.running) stop(paneId, over);
    else start(paneId);
  }
  const team = paneId => window.TnaiAgentTeams?.open?.(paneId);

  // The old agent writes a hand-off letter, a fresh one takes over with it, and the old one stays
  // open for its questions until the user confirms the new one's summary (54).
  const handOff = paneId => window.TnaiContextUpkeep?.handOff?.(paneId);

  // Shown while the agent is idle and can be handed off. A working agent's row would only refuse.
  function canHandOff(paneId) {
    const why = window.TnaiContextUpkeep?.handOffWhy?.(paneId);
    return why === '';
  }

  // From an All threads card the CLI screen is shown where it lives: the thread opens on Threads.
  function showScreen(paneId) {
    const setTerm = () => window.TnaiThreadView?.setMode?.('term');
    if (card) {
      if (!window.TnaiThreads?.show?.(paneId)) return;

      // the thread view may draw the thread a moment later: the screen follows when it does
      if (window.TnaiThreadView?.shown?.() !== paneId) {
        const onView = event => {
          if (event.detail?.paneId !== paneId) return;
          window.removeEventListener('tnai:thread-view', onView);
          setTerm();
        };
        window.addEventListener('tnai:thread-view', onView);
        setTimeout(() => window.removeEventListener('tnai:thread-view', onView), 2000);
        return;
      }
    }
    setTerm();
  }
  const showConversation = () => window.TnaiThreadView?.setMode?.('read');

  function teamLabel(paneId) {
    const mates = window.TnaiAgentTeams?.mates?.(paneId) || [];
    return mates.length ? 'Team · ' + (mates.length + 1) + ' agents' : 'Team';
  }

  // The editors found on this computer, the file manager last (desktop/open-in-editor.js), asked
  // once: [{ id, label }]. Opening uses the thread's own folder, looked up by the desktop side.
  let editors = [];
  new Promise(resolve => resolve(window.tnaiNative.editors?.list?.()))
    .then(found => {
      if (Array.isArray(found)) editors = found;
    })
    .catch(() => {});

  async function openInEditor(editor, paneId) {
    let answer = null;
    try {
      answer = await window.tnaiNative.editors.open(editor.id, paneId);
    } catch {}
    if (!answer?.ok)
      window.toast?.(
        'Could not open it in ' +
          editor.label +
          (answer?.error?.message ? ': ' + answer.error.message : '.')
      );
  }

  // ---------- the rows that were icons of the top row ----------
  // A popover of its own opens under the "..." button the menu stood under (`button`, still set
  // after the menu closed): the past conversations (138) and the thread actions' menu (154).
  const openPast = () => window.TnaiThreadHistory?.open?.(button || menuButton());
  const openActions = paneId => window.TnaiThreadActions?.open?.(button || menuButton(), paneId);
  const openHandoffs = paneId => window.TnaiHandoffHistory?.open?.(paneId || '');
  const openLibrary = paneId => window.TnaiPromptLibrary?.open?.(button || menuButton(), paneId);

  // Smaller and Larger text for the CLI screen (10's text size of the thread view, "focus"): a
  // row is greyed at its limit, and says the size it is at now.
  function fontRows() {
    const terminals = window.TnaiAgents;
    if (!terminals?.stepFont || !terminals.fontFor) return [];
    const size = terminals.fontFor('focus');
    const step = by => () => terminals.stepFont('focus', by);
    return [
      { id: 'font-down', label: 'Smaller text · ' + size + ' px', icon: 'minus', go: step(-1) },
      {
        id: 'font-up',
        label: 'Larger text',
        icon: 'plus',
        go: step(1),
        off: size >= terminals.maxFont ? 'at its largest' : '',
      },
    ];
  }

  // The rows for one thread, as it is now. `keepFocus` rows put the keyboard somewhere themselves
  // (the name's field); after every other row it goes back to the menu's button.
  function rowsFor(paneId) {
    const session = sessionOf(paneId);
    if (!session) return [];
    const renameRow = card?.rename || rename;
    const rows = [
      { id: 'rename', label: 'Rename', icon: 'pencil', go: renameRow, keepFocus: true },
    ];
    if (canTeam(paneId))
      rows.push({ id: 'team', label: teamLabel(paneId), icon: 'users', go: team });
    if (hasConversation(paneId)) {
      if (!card && screenShown())
        rows.push({
          id: 'conversation',
          label: 'Back to the conversation',
          icon: 'arrow-left',
          go: showConversation,
        });
      else
        rows.push({ id: 'screen', label: 'CLI screen', icon: 'square-terminal', go: showScreen });
    }

    // the CLI screen's text size, while it shows (the A− and A+ of the top row until 2026-10-24)
    if (!card && screenShown()) rows.push(...fontRows());

    // a window of its own for this thread, and the way back (162)
    const popout = window.TnaiThreadPopout;
    if (popout?.isOut?.(paneId))
      rows.push({
        id: 'popback',
        label: 'Back into the app',
        icon: 'arrow-left',
        go: id => popout.back(id),
      });
    else if (popout?.can?.(paneId))
      rows.push({
        id: 'popout',
        label: 'Pop out into its own window',
        icon: 'external-link',
        go: id => popout.open(id),
      });

    // What were icons of the top row until 2026-10-24 (user, tab 5 of app-polish.html: fewer
    // buttons there, the rest named here), each done by the file that owns it. An All threads
    // card has its own buttons for the handoffs, the blur and the thread actions.
    if (!card && window.TnaiPastThreads)
      rows.push({ id: 'past', label: 'Past conversations', icon: 'file-text', go: openPast });
    if (!card && window.TnaiHandoffHistory?.open)
      rows.push({ id: 'handoffs', label: 'Handoff history', icon: 'clock', go: openHandoffs });
    if (!card && window.TnaiThreadBlur) {
      const blurred = !!window.TnaiThreadBlur.on(paneId);
      rows.push({
        id: 'blur',
        label: blurred ? 'Show this thread again' : 'Blur this thread',
        icon: blurred ? 'eye-off' : 'eye',
        go: id => window.TnaiThreadBlur.toggle(id),
      });
    }

    // whether this thread's agent may click, type and take pictures in Live preview (196); off
    // until the user turns it on, the row says which
    if (window.TnaiPreviewControl && hasConversation(paneId)) {
      const lets = window.TnaiPreviewControl.on(paneId);
      rows.push({
        id: 'preview-control',
        label: 'Agent uses preview: ' + (lets ? 'on' : 'off'),
        icon: 'monitor-play',
        go: id => window.TnaiPreviewControl.toggle(id),
      });
    }
    if (!card && window.TnaiThreadActions?.shows?.(paneId))
      rows.push({
        id: 'actions',
        label: 'Commit, pull request, review…',
        icon: 'git-branch',
        go: openActions,
      });

    // the prompt and workflow library (194): saved prompts and recipes for this thread
    if (!card && window.TnaiPromptLibrary && session.agent !== 'Terminal')
      rows.push({
        id: 'library',
        label: 'Saved prompts and recipes…',
        icon: 'library',
        go: openLibrary,
      });

    // the thread's own folder in an editor found on this computer, or the file manager
    if (session.cwd)
      for (const editor of editors)
        rows.push({
          id: 'editor-' + editor.id,
          label: 'Open in ' + editor.label,
          icon: editor.id === 'files' ? 'folder' : 'file-text',
          go: id => openInEditor(editor, id),
        });
    if (session.running) rows.push({ id: 'stop', label: 'Stop', icon: 'square-stop', go: stop });
    else rows.push({ id: 'start', label: 'Start', icon: 'play', go: start });

    // under Stop / Start: only where a hand-off can happen now
    if (canHandOff(paneId))
      rows.push({
        id: 'handoff',
        label: 'Hand off to a fresh agent',
        icon: 'rotate-cw',
        go: handOff,
      });
    rows.push({ id: 'close', label: 'Close thread', icon: 'x', go: closeThread });
    return rows;
  }

  // ---------- the menu ----------
  let menu = null;
  let button = null;
  let pane = '';
  let shownRows = [];

  // Set while the menu was opened from an All threads card (135): { host, rename(paneId) }.
  let card = null;

  // Set while the menu shows another list of rows than this thread's own (154, the thread
  // actions): { name, label, rows: [{ id, label, icon, go(paneId) }] }.
  let list = null;

  // Where a question about the thread is asked: its card, or the open thread's island.
  const hostOf = paneId => (card && pane === paneId ? card.host : island());

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
    shownRows = list ? list.rows : rowsFor(pane);
    menu.setAttribute('aria-label', list ? list.name : 'This thread');
    const label = document.createElement('div');
    label.className = 'tnt-menu-label';
    label.textContent = list?.label || '';
    menu.replaceChildren(
      ...(list?.label ? [label] : []),
      ...shownRows.map(row => {
        const rowButton = document.createElement('button');
        rowButton.type = 'button';
        rowButton.className = 'tnt-menu-row';
        rowButton.setAttribute('role', 'menuitem');
        rowButton.dataset.row = row.id;
        rowButton.innerHTML = icon(row.icon, 16) + '<span></span>';
        rowButton.querySelector('span').textContent = row.label;

        // A row that cannot work for this thread (another computer's thread, 164): greyed by
        // 12-inactive-ui.js, with its reason in its own words beside the label.
        if (row.off) {
          rowButton.dataset.off = row.off;
          rowButton.querySelector('span').textContent = row.label + ' · ' + row.off;
        }
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

  // `forPane` and `fromCard` are given by an All threads card: the menu is then about that card's
  // thread, not the open one.
  function open(anchor, forPane, fromCard, rowList) {
    const paneId = forPane || openPane();
    const from = anchor || menuButton();
    if (!paneId || !from || isOpen()) return;
    build();
    card = forPane && fromCard ? fromCard : null;
    list = rowList || null;
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

  // ---------- the on/off button, beside the "..." ----------
  // The menu's Stop / Start row, one press away on the top row: a square while the session runs
  // (it asks first, as the row does), a play mark while it is stopped.
  const power = document.createElement('button');
  power.type = 'button';
  power.className = 'tnt-icon-btn tnt-head-power';
  power.hidden = true;
  let powerShows = '';

  function paintPower() {
    const session = sessionOf(openPane());
    power.hidden = !session;
    if (!session) return;
    const shows = session.running ? 'stop' : 'start';
    if (shows === powerShows) return;
    powerShows = shows;

    // 44-page-colors.css reads it: green for Start, red for Stop
    power.dataset.shows = shows;
    const label = shows === 'stop' ? 'Stop this agent' : 'Start this agent again';
    power.innerHTML = icon(shows === 'stop' ? 'square-stop' : 'play', 16);
    power.title = label;
    power.setAttribute('aria-label', label);
  }

  power.addEventListener('click', () => stopOrStart(openPane(), island()));

  // Other files put their own buttons into the top row after 120 built it (123 at the start, 131
  // at the end). The "..." stays the last one, where a menu of more is looked for, with the on/off
  // button just before it.
  function keepLast() {
    const more = menuButton();
    const acts = more?.parentNode;
    if (!acts) return;
    if (acts.lastElementChild !== more) acts.append(more);
    if (more.previousElementSibling !== power) more.before(power);
    paintPower();
  }
  window.TnaiAgents?.onChange?.(paintPower);

  // ---------- a right press on a thread in the list ----------
  // Opens that thread and its menu at the row, so a thread can be stopped, started, renamed or
  // closed without opening it first. Another computer's agent: its own rows (164).
  document.addEventListener('contextmenu', event => {
    const row = event.target.closest?.('.tnt-lst .tnt-th');
    if (row?.dataset.remote && window.TnaiRemoteThreadMore?.menuAtRow) {
      event.preventDefault();
      close();
      window.TnaiRemoteThreadMore.menuAtRow(row);
      return;
    }
    if (!row || row.dataset.remote || !row.dataset.pane) return;
    event.preventDefault();
    close();
    row.click();

    // A short timer, not an animation frame: a window that is covered draws no frames.
    setTimeout(() => {
      if (openPane() === row.dataset.pane && row.isConnected) open(row);
    }, 30);
  });

  // Another thread was opened, or none: the menu and a name being edited belong to the one before.
  let lastPane = openPane();
  window.addEventListener('tnai:thread-view', event => {
    keepLast();
    const now = event.detail?.paneId || '';
    if (isOpen() && !card && now !== pane) close();
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

    // the name becomes a field where it stands (the pencil beside the name, 120, calls it too)
    rename: paneId => rename(paneId || openPane()),

    // the on/off button of an All threads card (135): asks over that card before a stop
    stopOrStart,

    // The same menu with other rows, under `anchor`, about the thread `paneId` (154, the thread
    // actions): list = { name, label, rows: [{ id, label, icon, go(paneId), keepFocus }] }.
    openList: (anchor, paneId, rowList) => open(anchor, paneId, null, rowList),

    // the button the open menu stands under, or null
    anchor: () => (isOpen() ? button : null),

    // the rows the menu has for a thread now (the open one when none is named): [{ id, label }]
    rows: paneId => rowsFor(paneId || openPane()).map(row => ({ id: row.id, label: row.label })),
  };
  keepLast();
})();
