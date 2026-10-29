// Technically Not browser check · smoke.js — the thread layout loads, every page of the
// three-dots menu opens from it, and no JS error happens on the way. The desktop bridge is an empty
// stand-in (tools/browser-check/stand-in.js, shared by every test), so this is a fresh app with no
// agents, files or threads. The old frame's Overview and its Agents and history page are deleted:
// the last line says FAIL if one of their modes ever shows. (`terminal-mode` is All threads' own
// mode now, not the old Terminal page.) Run: .\tools\browser-check\check.ps1
(async () => {
  const { log, wait, until, q } = check;
  const layout = () => q('.layout');
  const OLD_MODES = ['overview-mode', 'agents-mode'];
  const modes = () =>
    [...(layout()?.classList || [])].filter(name => name.endsWith('-mode')).join(' ') || 'none';
  const oldShown = () => OLD_MODES.filter(mode => layout()?.classList.contains(mode));

  // Pages whose rows do something other than open a page, or need a running agent.
  const SKIP = ['Stop all agents', 'Command menu', 'Worktrees without a panel'];

  try {
    const threads = await until(() => layout()?.classList.contains('threads-mode'), 8000);
    log('threads page:', !!threads, '| modes:', modes());
    log('thread list:', !!q('.tnt-list, .tnl-list, [class*="thread-list"]'));
    log('desktop-only page shown:', !!q('.browser-only'));

    const button = await until(() => q('.tnt-menu-btn'), 4000);
    log('three-dots button:', !!button);
    if (!button) throw new Error('no three-dots button');

    // The menu's page rows, read once.
    window.TnaiThreadMenu.open(button);
    await wait(200);
    const labels = [...document.querySelectorAll('.tnt-menu .tnt-menu-row')]
      .map(
        row => row.querySelector('.tnt-menu-label')?.textContent?.trim() || row.textContent.trim()
      )
      .filter(label => label && !SKIP.includes(label));
    window.TnaiThreadMenu.close();
    log('menu rows:', labels.join(', '));

    const old = new Set();
    for (const label of labels) {
      window.TnaiThreadMenu.open(button);
      await wait(150);
      const row = [...document.querySelectorAll('.tnt-menu .tnt-menu-row')].find(item =>
        (item.querySelector('.tnt-menu-label')?.textContent || item.textContent)
          .trim()
          .startsWith(label)
      );
      if (!row) {
        log(label + ': row missing');
        continue;
      }
      row.click();
      await wait(350);
      oldShown().forEach(mode => old.add(mode));
      log(label + ':', modes());
      if (window.TnaiThreadMenu.isOpen()) window.TnaiThreadMenu.close();

      // Escape to the focused field, as a key press goes: a popover (Projects) listens on its own
      // search field, not on the page.
      (document.activeElement || document.body).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
      await wait(100);
    }

    // Back to Threads from the menu.
    window.TnaiThreadMenu.open(button);
    await wait(150);
    [...document.querySelectorAll('.tnt-menu .tnt-menu-row')]
      .find(item => item.textContent.trim().startsWith('Threads'))
      ?.click();
    await wait(350);
    log('back to threads:', layout()?.classList.contains('threads-mode'));
    log(old.size ? 'FAIL old pages shown: ' + [...old].join(', ') : 'old pages shown: none');
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
