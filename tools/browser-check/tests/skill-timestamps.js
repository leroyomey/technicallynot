// Technically Not browser check · skill-timestamps.js — the badges of a Skills page row
// (18-skills-page.js, 13-skills-purple.css) are told apart in Light and Dark: where the skill comes
// from (scope), "Every session" (on, the accent), "Last used" (used, the quietest words) and "In
// use" (live, the green working color on a green tint). Each look prints PASS or FAIL lines.
// (Rewritten 2026-10-28 for the thread layout: the old test also checked an "Edited" badge that no
// script makes any more, and only printed colors.)
// Run: .\tools\browser-check\check.ps1 -Test skill-timestamps
(async () => {
  const { log, wait } = check;
  const pass = (ok, text) => log(ok ? 'PASS' : 'FAIL', text);
  try {
    await wait(600);
    const box = document.createElement('div');
    box.className = 'skill-title';
    box.innerHTML =
      '<span class="skill-badge scope">Library</span>' +
      '<span class="skill-badge on">Every session</span>' +
      '<span class="skill-badge used">Last used today 10:02</span>' +
      '<span class="skill-badge live">In use · Lead</span>';
    document.body.append(box);
    for (const theme of ['light', 'dark']) {
      window.TnaiTheme.set(theme);
      await wait(300);
      const looks = Object.fromEntries(
        [...box.children].map(badge => {
          const style = getComputedStyle(badge);
          return [
            badge.className.replace('skill-badge', '').trim(),
            style.backgroundColor + ' / ' + style.color,
          ];
        })
      );
      const distinct = new Set(Object.values(looks)).size;
      pass(distinct === 4, theme + ': the four badges look different (' + distinct + ' of 4)');
      pass(
        !/rgba\(0, 0, 0, 0\)/.test(looks.live.split(' / ')[0]),
        theme + ': "In use" has its tint: ' + looks.live
      );
      Object.entries(looks).forEach(([name, look]) => log('  ', name, look));
    }
    pass(
      document.documentElement.classList.contains('tnt-on'),
      'measured on the thread layout (html.tnt-on)'
    );
    window.TnaiTheme.set('dark');
  } catch (error) {
    log('FAIL threw:', error.message);
  }
  check.done();
})();
