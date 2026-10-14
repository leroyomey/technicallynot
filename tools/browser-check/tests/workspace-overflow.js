// Workspace overflow (04, 07): a pane opened in a full workspace (12) continues in a new workspace
// instead of being refused. Run: .\tools\browser-check\check.ps1 -Test workspace-overflow
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const ws = window.TnaiTerminalWorkspaces,
      first = ws.activeId(),
      before = ws.list().length;
    while (window.TnaiTakeEmptyPane()); // reserve the empty first-run pane so it isn't reused
    while (window.TnaiPaneLimit.count(first) < window.TnaiPaneLimit.max)
      window.TnaiNewTerminalPane({ quiet: true });
    log(
      'first workspace full:',
      window.TnaiPaneLimit.count(first) === 12,
      '| full() says room can be made:',
      window.TnaiPaneLimit.full() === false
    );
    const record = window.TnaiNewTerminalPane({ name: 'Nova', quiet: true, reuseEmpty: true });
    await wait(100);
    const second = ws.activeId();
    log(
      'pane created:',
      !!record,
      '| new workspace:',
      ws.list().length === before + 1,
      '| switched to it:',
      second !== first,
      '| pane is in it:',
      record?.pane.dataset.workspaceId === second,
      '| first still 12:',
      window.TnaiPaneLimit.count(first) === 12
    );

    // A sub-agent pane aimed at the (hidden) full workspace overflows without switching away from
    // the shown one.
    const sub = window.TnaiNewTerminalPane({ workspaceId: first, quiet: true });
    await wait(100);
    log(
      'hidden overflow:',
      !!sub,
      '| shown workspace unchanged:',
      ws.activeId() === second,
      '| third workspace:',
      ws.list().length === before + 2
    );
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
