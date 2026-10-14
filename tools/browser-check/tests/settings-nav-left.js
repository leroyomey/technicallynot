// Settings: the section list sits in the same left spot on every tab. Run:
// .\tools\browser-check\check.ps1 -Test settings-nav-left
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    for (const tab of window.TnaiSettings.tabs()) {
      window.TnaiSettings.open(tab);
      await wait(150);
      const nav = document.querySelector('.settings-tabs').getBoundingClientRect(),
        p = document.getElementById('settingsPanel-' + tab).getBoundingClientRect();
      log(
        tab,
        'nav left',
        Math.round(nav.left),
        '| panel',
        Math.round(p.left),
        '-',
        Math.round(p.right),
        '| page overflow',
        document.getElementById('settingsPage').scrollWidth >
          document.getElementById('settingsPage').clientWidth
      );
    }
    window.TnaiSettings.open('appearance');
    await wait(200);
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
