// Connect → lazy tree → a file click shows the desktop-only viewer toast; filter; reload restore.
// Run: .\tools\browser-check\check.ps1 -Test project-folder -Phases 1,2
(async () => {
  const { log, wait, q, until } = check;
  const row = path => q('[data-real-path="' + path + '"]');
  try {
    await wait(300);
    log('bar:', q('.repo-connect p').textContent);
    if (check.phase === '1') {
      [...document.querySelectorAll('.repo-connect-button')]
        .find(b => b.textContent === 'Connect project folder')
        .click();
      await until(() => row('src'));
      log(
        'root rows:',
        [...document.querySelectorAll('.repo-real-tree > [data-real-path]')]
          .map(r => r.dataset.realPath)
          .join(',')
      );
      log(
        'sample hidden:',
        q('.repo-rail-tree:not(.repo-real-tree)').hidden,
        '| children before expand:',
        row('src').nextElementSibling.children.length
      );
      row('src').click();
      const file = await until(() => row('src/app.ts'));
      log('lazy child after expand:', Boolean(file));
      row('big-folder').click();
      await until(() => row('big-folder').nextElementSibling.dataset.loaded);
      log(
        'big folder rows:',
        row('big-folder').nextElementSibling.querySelectorAll('[data-real-path]').length,
        '|',
        row('big-folder').nextElementSibling.querySelector('.repo-info-row')?.textContent
      );
      row('big-folder').click();

      // Since 2026-10-01 a file click opens the file in its own viewer window (desktop only);
      // the browser build shows a toast saying so and opens no editor in the center.
      const toastBox = q('#toast');
      toastBox.textContent = '';
      file.click();
      await until(() => toastBox.textContent);
      log(
        'file click in browser:',
        toastBox.textContent,
        '| editor opened:',
        q('.dock-scroll')?.classList.contains('repo-editor-open') || Boolean(q('.repo-editor-text'))
      );
      const disk = await (
        await (
          await (await (await window.__seed).getDirectoryHandle('src')).getFileHandle('app.ts')
        ).getFile()
      ).text();
      log('disk untouched:', JSON.stringify(disk));
      const search = q('#repoRailSearch');
      search.value = 'app';
      search.dispatchEvent(new Event('input'));
      log(
        'filter "app":',
        [...document.querySelectorAll('.repo-real-tree [data-real-path]')]
          .filter(r => !r.hidden)
          .map(r => r.dataset.realPath)
          .join(',')
      );
      search.value = '';
      search.dispatchEvent(new Event('input'));
    } else {
      await until(() => q('.repo-real-tree [data-real-path]'), 3000);
      log(
        'after reload:',
        q('.repo-connect').dataset.state,
        '| rows:',
        document.querySelectorAll('.repo-real-tree [data-real-path]').length
      );
    }
  } catch (e) {
    log('ERROR', e.name, e.message);
  }
  check.done();
})();
