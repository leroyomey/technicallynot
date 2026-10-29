// Settings: the section list sits in the same left spot on every tab. Run:
// .\tools\browser-check\check.ps1 -Test settings-nav-left
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const lefts = new Set();
    let overflow = false;
    for (const tab of window.TnaiSettings.tabs()) {
      window.TnaiSettings.open(tab);
      await wait(150);
      const nav = document.querySelector('.settings-tabs').getBoundingClientRect(),
        p = document.getElementById('settingsPanel-' + tab).getBoundingClientRect();
      const page = document.getElementById('settingsPage');
      lefts.add(Math.round(nav.left));
      overflow = overflow || page.scrollWidth > page.clientWidth;
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
    log(
      lefts.size === 1 && !overflow ? 'PASS' : 'FAIL',
      'the section list stands at one left edge on every tab (' +
        [...lefts].join(', ') +
        ' px) and no tab scrolls sideways, on the thread layout:',
      document.documentElement.classList.contains('tnt-on')
    );

    // back to the first tab (Appearance moved into General on 2026-10-12)
    window.TnaiSettings.open(window.TnaiSettings.tabs()[0]);
    await wait(200);
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
