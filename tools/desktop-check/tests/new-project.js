/*
 * Technically Not tools · desktop-check/tests/new-project.js — A new project from just a name (09
 * newProject, fs-service.js create). The folders are made inside the test profile
 * (new-project.main.js), never in the user's Documents. The name dialog is answered "Named by test"
 * by run.js. Run: .\tools\desktop-check\check.ps1 -Test new-project
 */
const log = [],
  t = (name, pass, extra) => {
    log.push((pass ? 'ok   ' : 'FAIL ') + name + (extra ? ' · ' + extra : ''));
    return pass;
  };
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 6000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(100);
  }
};
let callId = 0;
const main = (cmd, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++callId;
    window.__tnaiMainDone = window.__tnaiMainDone || {};
    window.__tnaiMainDone[id] = r => {
      delete window.__tnaiMainDone[id];
      r?.ok ? resolve(r.value) : reject(new Error(r?.error || 'main call failed'));
    };
    console.log('TNAI_MAIN:' + JSON.stringify({ id, cmd, args }));
  });
try {
  window.TnaiThreads.open();
  await wait(700);
  const P = window.TnaiProjects,
    before = P.list().length;
  const more = document.querySelector('.repo-connect-more');
  t('the folder menu button is there', !!more);
  more.click();
  await wait(200);
  const rows = [...document.querySelectorAll('.repo-connect-menu [role="menuitem"]')],
    labels = rows.map(b => b.textContent.trim());
  t(
    'the menu lists New project… between Add project folder… and Disconnect',
    labels.join(' | ') === 'Add project folder… | New project… | Disconnect',
    labels.join(' | ')
  );
  const cls = rows.map(b => b.className),
    box = rows.map(b => b.getBoundingClientRect());
  t(
    'the new row has the same class, height and left edge as its neighbors',
    cls[1] === cls[0] &&
      Math.abs(box[1].height - box[0].height) < 0.5 &&
      Math.abs(box[1].left - box[0].left) < 0.5 &&
      Math.abs(box[1].height - box[2].height) < 0.5,
    cls[1] + ' ' + box.map(b => Math.round(b.height * 10) / 10).join('/')
  );
  document.body.click();
  await wait(100);

  // The command palette is where "Add project folder…" is on screen in the current design (the
  // folder menu above is in the page but not shown): the new row sits under it.
  window.TnaiPalette.open();
  await wait(400);
  const input = [...document.querySelectorAll('input')].find(
    i =>
      i.getBoundingClientRect().width > 0 &&
      /palette|command/i.test(i.closest('[class]')?.className + ' ' + (i.placeholder || ''))
  );
  if (input) {
    input.value = 'project';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(300);
  }
  const hits = [
      ...document.querySelectorAll(
        '[role="option"], [class*="palette"] button, [class*="palette"] li'
      ),
    ].filter(e => e.getBoundingClientRect().height > 0),
    names = hits.map(e => e.textContent.trim());
  const iAdd = names.findIndex(n => n.startsWith('Add project folder…')),
    iNew = names.findIndex(n => n.startsWith('New project…'));

  // With a project open, "Show project folder" stands between the two (39 lists it there).
  const between = names.slice(iAdd + 1, Math.max(iAdd + 1, iNew));
  t(
    'the command palette lists New project… under Add project folder…, with the open folder at most between',
    !!input &&
      iAdd >= 0 &&
      iNew > iAdd &&
      between.every(name => name.startsWith('Show project folder')) &&
      between.length <= 1,
    'rows: ' + names.slice(Math.max(0, iAdd), iAdd + 3).join(' | ')
  );
  if (iAdd >= 0 && iNew >= 0) {
    const a = hits[iAdd].getBoundingClientRect(),
      b = hits[iNew].getBoundingClientRect();
    t(
      'the two rows have the same height, left edge and width',
      Math.abs(a.height - b.height) < 0.5 &&
        Math.abs(a.left - b.left) < 0.5 &&
        Math.abs(a.width - b.width) < 0.5,
      [a, b].map(r => [r.left, r.width, r.height].map(Math.round).join(',')).join(' / ')
    );
  }
  console.log('TNAI_SHOT:new-project-menu');
  await wait(500);
  (iNew >= 0 ? hits[iNew] : rows[1]).click();
  const made = await until(() => P.list().find(p => p.active && p.name === 'Named by test'));
  t(
    'the named project is open and active',
    !!made,
    JSON.stringify(P.list().map(p => p.name + (p.active ? '*' : '')))
  );
  t('one project more in the list', P.list().length === before + 1);
  t(
    'its folder is on disk under the new-projects folder, and empty',
    (await main('onDisk')).join('|') === 'Named by test' &&
      (await main('entries', 'Named by test')) === 0 &&
      String(made?.path || '').startsWith(await main('base')),
    made?.path
  );
  await until(
    () =>
      /Named by test/.test(
        document.querySelector('.repo-connect-bar, .repository-rail-head')?.textContent || ''
      ),
    3000
  );
  t(
    'the rail names the new project',
    /Named by test/.test(
      document.querySelector('.repository-rail-head')?.textContent || document.body.textContent
    )
  );

  await P.create();
  await wait(600); // the dialog answers the same name again
  t(
    'the same name again is refused: no second folder, no second list entry',
    (await main('onDisk')).length === 1 && P.list().length === before + 1
  );

  const fsn = window.tnaiNative.fs,
    bad = [
      '',
      '   ',
      '..',
      '../up',
      'a/b',
      'a\\b',
      'C:',
      'con',
      'NUL.txt',
      '.hidden',
      'what?',
      'x'.repeat(61),
    ];
  const refused = [];
  for (const name of bad) {
    const r = await fsn.create(name);
    if (!r?.ok) refused.push(name);
  }
  t(
    'names that are no plain folder name are all refused',
    refused.length === bad.length,
    'refused ' + refused.length + ' of ' + bad.length
  );
  t('and nothing else was made on disk', (await main('onDisk')).join('|') === 'Named by test');
  const tidy = await fsn.create('  Trim   me. ');
  t(
    'spaces are tidied and a trailing dot dropped',
    tidy?.ok && (await main('onDisk')).join('|') === 'Named by test|Trim me',
    JSON.stringify(tidy?.error || '')
  );
  await wait(300);
} catch (e) {
  t('threw: ' + e.message, false);
}
return { ok: log.every(l => l.startsWith('ok')), log };
