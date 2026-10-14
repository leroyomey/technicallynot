// Skills row timestamps are tinted apart: Edited (slate blue), Last used (lavender), In use (green)
// — distinct in light and dark. Run: .\tools\browser-check\check.ps1 -Test skill-timestamps
(async () => {
  const { log, wait } = check;
  try {
    await wait(600);
    const box = document.createElement('div');
    box.className = 'skill-title';
    box.innerHTML =
      '<span class="skill-badge">Imported</span><span class="skill-badge edited">Edited today 09:15</span><span class="skill-badge used">Last used today 10:02</span><span class="skill-badge live">In use</span>';
    document.body.append(box);
    for (const theme of ['light', 'dark']) {
      window.TnaiTheme.set(theme);
      await wait(300);
      const c = [...box.children].map(b => {
        const s = getComputedStyle(b);
        return (
          (b.className.replace('skill-badge', '').trim() || 'source') +
          ' ' +
          s.backgroundColor +
          ' / ' +
          s.color
        );
      });
      log(
        theme,
        'distinct:',
        new Set(c.map(x => x.split(' ').slice(1).join(' '))).size,
        'of',
        c.length
      );
      c.forEach(x => log('  ', x));
    }
    window.TnaiTheme.set('light');
  } catch (e) {
    log('ERROR', e.message);
  }
  check.done();
})();
