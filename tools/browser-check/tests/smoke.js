// Loads Technically Not, visits each page of the purple redesign (Live preview is desktop-only:
// desktop tests cover it), and reports JS errors. Run: .\tools\browser-check\check.ps1
(async () => {
  const { log, wait, q } = check;
  const side = match => [...document.querySelectorAll('.side-item')].find(match);
  try {
    await wait(400);
    log(
      'overview:',
      q('.layout').classList.contains('overview-mode'),
      '| agent tree shown:',
      !!q('#pgOverview')?.offsetParent
    );
    for (const [name, match, mode] of [
      ['agents', x => x.dataset.view === 'agents', 'agents-mode'],
      ['build', x => x.dataset.openWorkspace, 'build-mode'],
      ['terminal', x => x.dataset.view === 'terminal', 'terminal-mode'],
      ['skills', x => x.dataset.aiTool === 'skills', 'skills-mode'],
      ['settings', x => x.dataset.view === 'settings', 'settings-mode'],
    ]) {
      side(match)?.click();
      await wait(300);
      log(name + ' page:', q('.layout').classList.contains(mode));
    }
    log('terminal panes:', document.querySelectorAll('.terminal-pane').length);
    side(x => x.dataset.view === 'overview')?.click();
    await wait(300);
    log('back to overview:', q('.layout').classList.contains('overview-mode'));
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
