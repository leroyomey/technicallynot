// Technically Not browser check · project-folder.js — the project folder in the Files tab of the
// thread layout (09's rail, moved into 131's side column): Connect project folder, the lazy tree,
// the big folder's limit, a file opened inside the column, the filter, and the folder found again
// after a reload. The folder is project-folder.head.js's, kept in memory behind the desktop
// bridge's `fs` calls, as the desktop app's main process answers them; nothing is written to it.
// (Moved to the thread layout 2026-10-28: it used to connect a folder through the plain browser's
// own picker and expect a "desktop only" note on a file click, a build the app no longer has.)
// Run: .\tools\browser-check\check.ps1 -Test project-folder -Phases 1,2
(async () => {
  const { log, wait, q, until } = check;
  const pass = (ok, text) => log(ok ? 'PASS' : 'FAIL', text);
  const row = path => q('[data-real-path="' + path + '"]');
  try {
    await wait(300);
    pass(
      document.documentElement.classList.contains('tnt-on'),
      'the page is the thread layout (html.tnt-on)'
    );
    if (check.phase === '1') {
      // a fresh app: no folder yet, and the rail says so
      pass(
        /Not connected/.test(q('.repo-connect p')?.textContent || ''),
        'no folder yet: "' + q('.repo-connect p')?.textContent + '"'
      );
      window.TnaiThreadSide.open('files');
      await wait(200);
      pass(
        window.TnaiThreadSide.state().tab === 'files' && !!q('.tnt-sidefiles .repo-connect'),
        'the rail stands in the Files tab of the side column'
      );
      [...document.querySelectorAll('.repo-connect-button')]
        .find(button => button.textContent === 'Connect project folder')
        .click();
      await until(() => row('src'), 4000);
      const rootRows = [...document.querySelectorAll('.repo-real-tree > [data-real-path]')]
        .map(item => item.dataset.realPath)
        .sort()
        .join(',');
      pass(
        rootRows === 'README.md,big-folder,latin1.txt,logo.png,src',
        'connected: the top level is listed: ' + rootRows
      );
      pass(
        window.__folder.calls.includes('pick') &&
          /demo-project/.test(document.getElementById('projectCrumb')?.textContent || ''),
        'through the picker, and the top bar names the project: "' +
          document.getElementById('projectCrumb')?.textContent +
          '"'
      );
      pass(
        q('.repo-rail-tree:not(.repo-real-tree)').hidden,
        'the sample tree is hidden once a real folder is open'
      );
      pass(
        row('src').nextElementSibling.children.length === 0,
        'a folder is not read before it opens'
      );
      row('src').click();
      const file = await until(() => row('src/app.ts'), 3000);
      pass(!!file, 'opening src lists its file (lazy)');
      row('big-folder').click();
      await until(() => row('big-folder').nextElementSibling.dataset.loaded, 4000);
      const shownRows =
        row('big-folder').nextElementSibling.querySelectorAll('[data-real-path]').length;
      const info =
        row('big-folder').nextElementSibling.querySelector('.repo-info-row')?.textContent;
      pass(
        shownRows < 1003 && /1003|more|not shown|first/i.test(info || ''),
        'a folder of 1003 files shows ' + shownRows + ' rows and says so: "' + info + '"'
      );
      row('big-folder').click();

      // a file opens inside the column, with Back
      file.click();
      const text = await until(() => {
        const shown = q('.tnt-fileview-text');
        return shown && /export const a = 1/.test(shown.textContent) && shown.textContent;
      }, 4000);
      pass(!!text, 'a file click shows the file in the column: ' + JSON.stringify(text || ''));
      q('.tnt-fileview-back')?.click();
      await wait(150);
      pass(!!row('src/app.ts')?.isConnected, 'Back shows the tree again');

      const search = q('#repoRailSearch');
      search.value = 'app';
      search.dispatchEvent(new Event('input'));

      // the search box lists hits of the whole project (24) in place of the tree
      const hits = await until(() => {
        const found = [...document.querySelectorAll('.repo-search-results .repo-search-hit')];
        return found.length && found.map(hit => hit.dataset.searchPath).join(',');
      }, 3000);
      pass(hits === 'src/app.ts', 'searching "app" lists src/app.ts: ' + hits);
      search.value = '';
      search.dispatchEvent(new Event('input'));
      pass(
        !window.__folder.calls.some(call => call.startsWith('write')),
        'nothing was written to the folder: ' + window.__folder.calls.join(', ')
      );
    } else {
      await until(() => q('.repo-real-tree [data-real-path]'), 4000);
      const rows = document.querySelectorAll('.repo-real-tree [data-real-path]').length;
      pass(
        q('.repo-connect').dataset.state === 'connected' && rows >= 5,
        'after a reload the folder is open again: ' +
          q('.repo-connect').dataset.state +
          ', ' +
          rows +
          ' rows'
      );
    }
  } catch (error) {
    log('FAIL threw:', error.name, error.message);
  }
  check.done();
})();
