// Empty pane reuse (04): a new agent fills an empty pane in its workspace before a pane is added; a
// taken pane is reserved. Run: .\tools\browser-check\check.ps1 -Test empty-pane-reuse
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const count = () => window.TnaiPaneLimit.count();
    while (window.TnaiTakeEmptyPane()); // reserve panes already empty (the first-run pane)
    const blank = window.TnaiNewTerminalPane({ quiet: true });
    delete blank.pane.dataset.reservedAt; // as if the user added it with + New terminal
    await wait(50);
    log(
      'empty pane has a select:',
      !!blank.pane.querySelector('.terminal-provider-select'),
      '| value empty:',
      !blank.pane.querySelector('.terminal-provider-select')?.value
    );
    const before = count();
    const reused = window.TnaiNewTerminalPane({ name: 'Nova', quiet: true, reuseEmpty: true });
    log(
      'reused the empty pane:',
      reused === blank,
      '| no pane added:',
      count() === before,
      '| took the name:',
      reused?.pane.querySelector('.terminal-pane-title')?.textContent
    );
    const next = window.TnaiNewTerminalPane({ name: 'Orion', quiet: true, reuseEmpty: true });
    log(
      'reserved pane not handed out twice:',
      next !== blank,
      '| new pane added:',
      count() === before + 1
    );
    log('fresh quiet pane reserved:', window.TnaiTakeEmptyPane() === null);
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
