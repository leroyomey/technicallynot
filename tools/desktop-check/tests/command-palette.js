// Technically Not tools · desktop-check/tests/command-palette.js — ⌘K palette (39): its own call
// and the top-bar button open it, pages/actions listed, typing filters, Enter runs (goes to a
// page), the menu row "Projects" opens it on the project list, a project file is found by name and
// opens in the view-only file window. Also the grayed-out-control cleanup: the activity line opens
// the Threads page, the removed prototype controls are gone, and no inactive control is left
// visible on Threads, All threads and Settings. No prompt is sent to any agent.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(100);
  }
  return null;
};
try {
  const overlay = document.querySelector('.tnai-pal-overlay'),
    input = overlay?.querySelector('input');
  const labels = () =>
    [...overlay.querySelectorAll('.tnai-pal-item')].map(b => b.firstChild.textContent);
  const key = (k, o = {}) =>
    (document.activeElement || document).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })
    );
  check(!!overlay && overlay.hidden, 'palette exists, closed');

  // Ctrl+K is the three-dots menu's search now (124-thread-menu.js takes the key first), so the
  // palette opens by its own call.
  window.TnaiPalette.open();
  await wait(100);
  check(
    !overlay.hidden && document.activeElement === input,
    'TnaiPalette.open() opens it with the input focused'
  );
  check(
    ['Agents', 'Terminal', 'Settings'].every(p => labels().includes(p)),
    'lists pages: ' + labels().slice(0, 9).join(', ')
  );
  check(
    labels().length > 5 && !labels().some(l => /light theme/i.test(l)),
    'lists actions (no light theme: purple glass only)'
  );
  input.value = 'setti';
  input.dispatchEvent(new Event('input'));
  await wait(60);
  check(labels()[0] === 'Settings', 'typing filters: first is ' + labels()[0]);
  key('Enter');
  await wait(300);
  check(
    overlay.hidden && document.querySelector('.layout').classList.contains('settings-mode'),
    'Enter runs it: Settings page shown'
  );
  document.getElementById('topCommand').click();
  await wait(100);
  check(!overlay.hidden, 'top-bar ⌘ K button opens it');
  key('Escape');
  await wait(60);
  check(overlay.hidden, 'Esc closes it');

  // What the row "Projects" of the three-dots menu does (124).
  window.TnaiPalette.open('Projects');
  await wait(150);
  check(
    !overlay.hidden &&
      labels().includes('Add project folder…') &&
      overlay.querySelectorAll('.tnai-pal-group').length === 1,
    'the menu row "Projects" opens it on the project list: ' + labels().join(', ')
  );
  window.TnaiPalette.close();

  // tnai commands: found by name and by what they do; picking one fills the composer, placeholders
  // left for the user.
  window.TnaiPalette.open();
  await wait(100);
  input.value = 'tnai';
  input.dispatchEvent(new Event('input'));
  await wait(60);
  check(
    labels().includes('tnai agents') &&
      labels().includes('tnai help') &&
      [...overlay.querySelectorAll('.tnai-pal-group')].some(
        g => g.firstChild.textContent === 'tnai commands'
      ),
    'typing "tnai" lists the tnai commands group'
  );
  console.log('TNAI_SHOT:palette-tnai');
  await wait(700);
  input.value = 'project notes';
  input.dispatchEvent(new Event('input'));
  await wait(60);
  check(
    labels()[0] === 'tnai context note list',
    'a tnai command is found by its description: first is ' + labels()[0]
  );
  input.value = 'tnai send';
  input.dispatchEvent(new Event('input'));
  await wait(60);
  key('Enter');
  await wait(150);
  const prompt = document.getElementById('prompt');
  check(
    overlay.hidden && prompt.value === 'tnai send ' && document.activeElement === prompt,
    'Enter puts "tnai send " in the composer, focused: ' + JSON.stringify(prompt.value)
  );
  prompt.value = '';
  prompt.dispatchEvent(new Event('input', { bubbles: true }));
  if (window.TnaiProjects?.active?.()) {
    window.TnaiPalette.open();
    await wait(150);
    check(
      !!overlay.querySelector('.tnai-pal-pill') &&
        overlay.querySelectorAll('.tnai-pal-keys kbd').length >= 2,
      'current project has a Current pill; shortcuts are keys'
    );
    console.log('TNAI_SHOT:palette-list');
    await wait(700);
    if (window.TnaiTheme) {
      window.TnaiTheme.set('dark');
      await wait(300);
      console.log('TNAI_SHOT:palette-list-dark');
      await wait(700);
    }
    input.value = 'READM';
    input.dispatchEvent(new Event('input'));
    const hit = await until(
      () =>
        [...overlay.querySelectorAll('.tnai-pal-item')].find(b => b.dataset.path === 'README.md'),
      5000
    );
    check(!!hit, 'a project file is found by name');
    check(
      !!hit?.closest('.tnai-pal-list')?.querySelector('.tnai-pal-folder') &&
        hit?.classList.contains('nested') &&
        !!hit?.querySelector('svg'),
      'file hits sit under a folder header with an icon'
    );
    console.log('TNAI_SHOT:palette-files');
    await wait(700);
    if (window.TnaiTheme) {
      window.TnaiTheme.set('dark');
      await wait(300);
      console.log('TNAI_SHOT:palette-files-dark');
      await wait(700);
    }

    // The File repository page was removed in the purple redesign: a hit opens in 09's view-only
    // window (stubbed: no extra window).
    const FV = window.TnaiFileViewer,
      realOpen = FV?.open,
      opens = [];
    if (FV)
      FV.open = p => {
        opens.push(p);
      };
    hit?.click();
    check(
      !!(await until(() => opens.includes('README.md'), 5000)),
      'choosing it opens the file in the view-only file window (' + JSON.stringify(opens) + ')'
    );
    if (FV) FV.open = realOpen;
  } else log.push('info no project connected; file search not checked');

  // Grayed-out control cleanup.
  window.TnaiThreads.open();
  await wait(200);
  check(
    !document.getElementById('chatDrawer') &&
      !document.getElementById('tryAlt') &&
      !document.querySelector('.composebox [title="Voice input"]') &&
      !document.querySelector('.activityline .checks'),
    'prototype activity drawer, fake checks, ♬ and preview-select hint are gone'
  );
  document.getElementById('activityToggle').click();
  await wait(250);

  // There is no Agents page any more: the router answers that route with the Threads page.
  check(window.TnaiThreads.visible(), 'activity line opens the Threads page');
  check(
    !document.querySelector('.composer #notificationSounds') &&
      !!document.querySelector('#settingsPanel-agents #notificationSounds') &&
      getComputedStyle(document.getElementById('notificationSounds')).pointerEvents !== 'none',
    'Notification sounds setting is on Settings › Agents (not the composer) and usable'
  );
  const css = [...document.querySelectorAll('style')]
    .map(s => s.textContent)
    .find(t => t.includes('grayscale(1)!important;pointer-events:none'));
  const sel = css.slice(0, css.indexOf('{opacity:.42')),
    seen = new Set();
  for (const [s, page] of [
    ['overview', 'overview'],
    ['terminal', 'terminal'],
    ['agents', 'agents'],
    ['settings', 'settings'],
  ]) {
    // All threads shares its route with the old Terminal page: it is opened as the menu opens it.
    if (s === 'terminal') await window.TnaiTest.openAllThreads();
    else window.TnaiRoute(s);
    await wait(300);
    for (const el of document.querySelectorAll(sel)) {
      if (el.matches('.pgo-pc.slot')) continue;

      /* Add PC: shown grayed on purpose (12: needs the sync service) */ const r =
        el.getBoundingClientRect();
      if (r.width && r.height && !el.closest('[hidden]'))
        seen.add(
          page +
            ':' +
            (el.id
              ? '#' + el.id
              : el.className +
                '[' +
                (el.dataset.view ||
                  el.dataset.aiTool ||
                  el.title ||
                  el.textContent.trim().slice(0, 12)) +
                ']')
        );
    }
  }
  check(
    !seen.size,
    'no grayed-out control left visible on Threads, All threads, Agents, Settings' +
      (seen.size ? ': ' + [...seen].join(', ') : '')
  );
  window.TnaiThreads.open();
  await wait(150);
} catch (error) {
  check(false, 'test threw: ' + error.stack);
}
return { ok, log };
