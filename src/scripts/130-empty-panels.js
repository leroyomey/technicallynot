// Technically Not · 130-empty-panels.js — Desktop only: a terminal panel with no connection does
// not stay behind. The thread layout shows a panel only once it has a connection (the pages view
// leaves the others out, and no list shows them), so an empty one would be hidden state: it holds
// nothing, yet it counted toward its workspace's twelve (a workspace of four agents could hold
// eight such panels).
//
// An empty panel lives from "+ Terminal" until it gets a connection or is closed. The ones left
// over are closed here, through each panel's own close button (so the saved list, the counts and
// every listener hear of it as of any close): once when the app has loaded its workspaces, and
// whenever a workspace is shown.
//
// Kept, always: a panel with a connection chosen, running or not; a panel with something to
// resume (a session, a saved conversation, a compact summary, or a saved connection the app
// cannot offer right now); a panel made or reserved in the last 15 seconds (04 `reservedAt`); a
// panel whose connection picker is open; and the one panel a fresh settings folder starts with,
// until its workspace is next shown.
// `window.TnaiEmptyPanels` (`list`, `sweep`). Test `empty-panels`.
(() => {
  const content = document.querySelector('#terminalView .terminal-content');
  const native = window.tnaiNative;
  if (!content || !native?.pty) return;

  // How long a new or reserved panel is left alone: an agent being started gets its connection
  // within this time (04 reserves a slot for as long).
  const SETTLE_MS = 15000;

  // panel → when it was added to the page after the app started
  const born = new WeakMap();

  const idOf = pane => pane.dataset.paneId;

  const isEmpty = pane => {
    const select = pane.querySelector('.terminal-provider-select');
    return !!select && !select.value && !pane.classList.contains('tnai-live');
  };

  const inUse = pane =>
    Date.now() - (born.get(pane) || 0) < SETTLE_MS ||
    Date.now() - (Number(pane.dataset.reservedAt) || 0) < SETTLE_MS ||
    pane.hasAttribute('data-first-run') ||
    !!pane.querySelector('.tnai-picking');

  // What the page itself knows of a conversation: the connection 04 saved for the panel (the
  // box can be empty while the saved name is not, when that tool is not offered now) and the
  // compact summary 05 keeps.
  function keptLocally(pane) {
    const record = (window.TnaiTerminalPaneRecords || []).find(item => item.id === idOf(pane));
    if (record?.agent) return true;
    try {
      const context = JSON.parse(localStorage.getItem('tnai.terminal-context.v1') || '{}');
      const state = context[idOf(pane)];
      return !!(state && (state.summary || state.turns?.length));
    } catch {
      return false;
    }
  }

  // What the main process holds for the panel: a running process or a saved record. A question
  // that fails is read as "something is there", so a panel is never closed on a guess.
  async function keptByMain(pane) {
    try {
      return !!(await native.pty.replay(idOf(pane)));
    } catch {
      return true;
    }
  }

  // The panels that look empty now, in one workspace view or in all of them. `sweep` asks the
  // main process about each before it closes one.
  const candidates = space =>
    [...(space || content).querySelectorAll('.terminal-pane[data-pane-id]')].filter(
      pane => isEmpty(pane) && !inUse(pane) && !keptLocally(pane)
    );

  // Closes them and answers how many. The panel's own button is pressed by script, which closes
  // without the question a person's press gets (21 asks only for a real press).
  async function sweep(space) {
    let closed = 0;
    for (const pane of candidates(space)) {
      if (await keptByMain(pane)) continue;

      // The answer took a moment: the panel may have got a connection or left meanwhile.
      if (!pane.isConnected || !isEmpty(pane) || inUse(pane)) continue;
      const close = pane.querySelector('button[title="Close terminal"]');
      if (!close) continue;
      close.click();
      closed++;
    }

    // 07 saves the list, shows a workspace's empty state and counts again.
    if (closed) window.TnaiTerminalWorkspaces?.reordered?.();
    return closed;
  }

  // A workspace is shown (another tab, another project), and panels are added to a workspace.
  const watched = new WeakSet();
  const shown = new MutationObserver(records => {
    for (const record of records) {
      if (record.target.hidden) continue;
      record.target
        .querySelectorAll('.terminal-pane[data-first-run]')
        .forEach(pane => pane.removeAttribute('data-first-run'));
      sweep(record.target);
    }
  });
  const added = new MutationObserver(records => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node.nodeType === 1 && node.matches('.terminal-pane')) born.set(node, Date.now());
  });

  function watch() {
    content.querySelectorAll('.terminal-workspace-view').forEach(space => {
      if (watched.has(space)) return;
      watched.add(space);
      shown.observe(space, { attributes: true, attributeFilter: ['hidden'] });
    });
    content.querySelectorAll('.terminal-workspace-grid').forEach(grid => {
      if (watched.has(grid)) return;
      watched.add(grid);
      added.observe(grid, { childList: true });
    });
  }
  new MutationObserver(watch).observe(content, { childList: true });
  watch();

  window.TnaiEmptyPanels = { list: space => candidates(space).map(idOf), sweep };

  // At start: every panel was made from the saved list by now (04, 07), each with its saved
  // connection or none. With no saved list this is a fresh settings folder: its one panel is
  // new, as one from "+ Terminal" is, and has no time of birth to protect it.
  const first = content.querySelectorAll('.terminal-pane[data-pane-id]');
  if (window.TnaiPaneLimit?.firstRun && first.length === 1) first[0].dataset.firstRun = '1';
  sweep();
})();
