// Connect → lazy tree → open → edit → Save → byte-exact reread; view-only files; reload restore.
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
      file.click();
      const area = await until(() => q('.repo-editor-text'));
      log(
        'editor in center:',
        q('.dock-scroll').classList.contains('repo-editor-open'),
        '| path:',
        q('.repo-editor-path').textContent,
        '| state:',
        q('.repo-editor-state').textContent,
        '| save disabled:',
        q('.repo-editor-save').disabled
      );
      area.value = area.value.replace('a = 1', 'a = 42');
      area.dispatchEvent(new Event('input'));
      log(
        'after edit:',
        q('.repo-editor-state').textContent,
        '| save disabled:',
        q('.repo-editor-save').disabled,
        '| row dirty:',
        row('src/app.ts').classList.contains('repo-dirty')
      );
      q('.repo-editor-save').click();
      await until(() => q('.repo-editor-message').dataset.tone);
      log('save:', q('.repo-editor-message').dataset.tone, q('.repo-editor-message').textContent);
      const disk = await (
        await (
          await (await (await window.__seed).getDirectoryHandle('src')).getFileHandle('app.ts')
        ).getFile()
      ).text();
      log('independent disk read:', JSON.stringify(disk));
      row('logo.png').click();
      await until(() => q('.repo-editor-state').textContent === 'View only');
      log(
        'binary:',
        q('.repo-editor-state').textContent,
        '| textarea shown:',
        Boolean(q('.repo-editor-text'))
      );
      row('latin1.txt').click();
      await wait(300);
      log('non-utf8:', q('.repo-editor-state').textContent);
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
