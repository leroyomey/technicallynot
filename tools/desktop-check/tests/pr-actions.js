// Technically Not tools · desktop-check/tests/pr-actions.js — the pull request rows of the thread
// actions menu (src/scripts/154-thread-actions.js) and "Open in ..." in the thread's "..." menu
// (src/scripts/137-thread-more.js). One Claude Code thread is opened (no prompt is sent).
// 153's facts for its folder are stood in for (an open pull request whose checks passed), so gh
// never runs, nothing is watched and nothing is merged; no "Open in" row is pressed (it would open
// a window on the user's screen).
// Checked: Watch and Merge show for that pull request; Merge asks first in the same menu, and
// "Not now" merges nothing; a draft hides Merge; the "..." menu lists "Open in File Explorer" and
// only editors the desktop side found.
// Pictures: pr-actions-menu (Dark), pr-actions-ask (Light), pr-actions-more (Dark).
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};
const shot = async name => {
  await wait(400);
  await (window.TnaiTest?.shot?.(name) ?? wait(700));
};
const threads = window.TnaiThreads;
const sessionOf = paneId =>
  (window.TnaiAgents.sessions() || []).find(session => session.paneId === paneId) || null;
const menu = () => document.querySelector('.tnt-menu-thread');
const rowIds = () =>
  [...(menu()?.querySelectorAll('.tnt-menu-row') || [])].map(row => row.dataset.row);
const press = id =>
  menu()
    ?.querySelector('.tnt-menu-row[data-row="' + id + '"]')
    ?.click();

try {
  await window.TnaiAgents.detect(true);
  threads.open();
  await until(() => threads.visible(), 5000);
  const paneId = (await window.TnaiTest.open('Claude Code'))?.paneId || '';
  check(
    !!(await until(() => sessionOf(paneId)?.running, 30000)),
    'setup: a Claude Code thread runs'
  );
  threads.show(paneId);
  await until(() => window.TnaiThreadView?.shown?.() === paneId, 4000);

  // 153's facts stood in for: an open pull request, checks passed
  const kit = window.TnaiThreadChanges;
  const real = { get: kit.get, known: kit.known, ask: kit.ask };
  const pr = {
    number: 42,
    title: 'Dark mode toggle',
    url: 'https://github.com/owner/repo/pull/42',
    state: 'OPEN',
    draft: false,
    checks: { total: 2, passed: 2, failed: 0, pending: 0, failedNames: [] },
  };
  let facts = { repo: true, branch: 'tnai/kestrel', base: 'main', onBase: false, pr };
  kit.get = () => facts;
  kit.known = () => true;
  kit.ask = () => {};
  window.dispatchEvent(new CustomEvent('tnai:thread-changes', { detail: { folder: '' } }));

  // The thread actions are a row of the thread's "..." menu (137; an icon of the top row until
  // 2026-10-24): it shows for a thread with a git folder, and opens the actions' menu.
  const moreButton = document.querySelector('.tnt-view .tnt-head-menu');
  const actionsRow = () => {
    window.TnaiThreadMore.close();
    moreButton?.click();
    return document.querySelector('.tnt-menu-thread .tnt-menu-row[data-row="actions"]');
  };
  const work = await until(() => {
    const row = actionsRow();
    if (!row) window.TnaiThreadMore.close();
    return row;
  }, 4000);
  check(!!work, 'the thread actions row shows for a thread with a pull request');
  window.TnaiTheme?.set?.('dark');
  work?.click();
  await until(() => menu() && !menu().hidden, 2000);
  const ids = rowIds();
  check(ids.includes('pr-watch'), 'Watch pull request #42 is a row (' + ids.join(', ') + ')');
  check(ids.includes('pr-merge'), 'Merge pull request #42 is a row');
  check(
    ids.indexOf('pr-watch') > ids.indexOf('recap') && ids.indexOf('pr-merge') < ids.indexOf('edit'),
    'they stand under the prompts and above "Edit these prompts…"'
  );
  await shot('pr-actions-menu');

  press('pr-merge');
  await until(() => rowIds().includes('merge-yes'), 2000);
  const label = menu()?.querySelector('.tnt-menu-label')?.textContent || '';
  check(
    !menu().hidden && /Merge #42 into main\?/.test(label),
    'Merge asks first, in the menu: ' + label
  );
  check(rowIds().join() === 'merge-yes,merge-no', 'its answers are Merge and Not now');
  window.TnaiTheme?.set?.('light');
  await shot('pr-actions-ask');
  window.TnaiTheme?.set?.('dark');
  press('merge-no');
  await wait(200);
  check(menu().hidden, '"Not now" closes the menu and merges nothing');

  // a draft: Watch stays, Merge goes
  facts = { ...facts, pr: { ...pr, draft: true } };
  actionsRow()?.click();
  await until(() => menu() && !menu().hidden, 2000);
  check(
    rowIds().includes('pr-watch') && !rowIds().includes('pr-merge'),
    'a draft has Watch but no Merge'
  );
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(200);

  // the "..." menu: Open in the editors found here, the file manager always
  const found = (await window.tnaiNative.editors.list()) || [];
  const more = document.querySelector('.tnt-view .tnt-head-menu');
  more?.click();
  await until(() => menu() && !menu().hidden, 2000);
  const moreIds = rowIds();
  check(moreIds.includes('editor-files'), 'the "..." menu has Open in File Explorer');
  check(
    found.every(editor => moreIds.includes('editor-' + editor.id)) &&
      moreIds.filter(id => id.startsWith('editor-')).length === found.length,
    'it lists exactly the editors found here (' + found.map(editor => editor.label).join(', ') + ')'
  );
  check(
    moreIds.indexOf('editor-files') < moreIds.indexOf('stop'),
    'the Open rows stand before Stop, as in the mockup'
  );
  await shot('pr-actions-more');
  menu()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  Object.assign(kit, real);
} catch (error) {
  check(false, 'the test ran to its end: ' + (error?.message || error));
}
return { ok, log };
