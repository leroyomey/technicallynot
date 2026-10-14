// Technically Not tools · desktop-check/tests/projects.js — Several open project folders: old
// single-folder state migrates to a one-project list, the rail switcher lists projects (active
// marked), Add project folder… (picker answered by projects.main.js), switching re-points the tree,
// a background project's live counts on its menu row and its needs-you feed row (chip, click
// switches back), watcher (fs:changes), search, git and new terminal panes while running panes keep
// their cwd, unsaved edits stay as the left project's draft and come back, drafts/tabs never mix
// between projects, unknown folders are refused, × removes from the list without touching disk. No
// agent prompts. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(50);
  }
  return null;
};
const shot = async name => {
  console.log('TNAI_SHOT:' + name);
  await wait(500);
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
const D = window.TnaiDesktop,
  N = window.tnaiNative;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const rail = path => document.querySelector('.repo-real-tree [data-real-path="' + path + '"]');
const switcher = () => document.querySelector('.repository-rail-head .repo-project-switch');
const menu = () => document.querySelector('.repo-project-menu');
const items = () => [...document.querySelectorAll('.repo-project-menu .repo-project-item')];
const text = () => document.querySelector('.repo-editor:not([hidden]) .repo-editor-text');
const activeTab = () => document.querySelector('.file-tab.active span')?.textContent;
const events = [];
window.addEventListener('tnai:project-changed', e => events.push(e.detail));
const changes = [];
N.fs.onChanges(list => changes.push(...list.map(c => c.path)));
const openMenu = async () => {
  if (menu().hidden) switcher().click();
  await wait(100);
  return !menu().hidden;
};

try {
  await until(() => rail('README.md'));
  window.TnaiRoute('files');
  await wait(300);
  const A = await N.fs.root();
  let info = await D.projects();
  check(
    info.projects.length === 1 && same(info.active, A) && info.projects[0].active,
    'old single-folder state migrated to a one-project list with it active'
  );
  check(
    !!switcher() && switcher().textContent.includes(info.projects[0].name),
    'project name under File Repository is the switcher'
  );
  check(
    (await openMenu()) &&
      items().length === 1 &&
      items()[0].classList.contains('active') &&
      !!menu().querySelector('.repo-project-add'),
    'menu lists the open project (active marked) and Add project folder…'
  );
  check(
    !menu().querySelector('.repo-project-live') &&
      items()[0].querySelector('small')?.textContent === info.projects[0].path,
    'one open project: its row looks as before (no live counts)'
  );
  await shot('projects-menu-one');

  // Add a second project through the switcher (native picker answered in the main process).
  const B = await main('make', 'proj-b');
  await main('pickNext', B);
  menu().querySelector('.repo-project-add').click();
  check(
    !!(await until(() => rail('lib') && rail('README.md'))),
    'Add project folder… opens the new project tree'
  );
  info = await D.projects();
  check(info.projects.length === 2 && same(info.active, B), 'second project added and active');
  let saved = await main('saved');
  check(
    saved.projects.length === 2 && same(saved.root, B),
    'project list and active project saved to disk'
  );
  check(
    events.length === 1 && same(events[0].root, B) && same(events[0].previous, A),
    'tnai:project-changed fired with root + previous'
  );
  check(switcher()?.textContent.includes('proj-b'), 'switcher shows the new active project');

  // Everything that depends on the root follows it.
  changes.length = 0;
  await main('write', B, 'new-b.txt', 'b');
  await main('write', A, 'only-a.txt', 'a');
  check(
    !!(await until(() => changes.includes('new-b.txt'), 4000)),
    'watcher reports changes in the active project'
  );
  await wait(500);
  check(!changes.includes('only-a.txt'), 'watcher ignores the inactive project');
  const git = await N.git.status();
  check(git.ok && same(git.value.root, B), 'git runs in the active project');
  const hit = await N.fs.search('proj-b.js'),
    miss = await N.fs.search('app.js');
  check(
    hit.ok &&
      hit.value.results.some(r => r.path === 'lib/proj-b.js') &&
      miss.ok &&
      !miss.value.results.length,
    'search covers only the active project'
  );
  check(
    !(await N.fs.read('../sample-project/README.md', 0, 10)).ok,
    'paths outside the active project are refused'
  );
  check(
    !(await N.fs.switchTo(await main('profile'))).ok && same(await N.fs.root(), B),
    'a folder not in the list cannot be made active'
  );

  // A running pane keeps its folder; new panes start in the active project.
  const opened = await window.TnaiTest.open('Terminal');
  const pane = await until(() =>
    window.TnaiAgents.sessions().find(s => s.agent === 'Terminal' && s.running && s.cwd)
  );
  check(
    !!pane && same(pane.cwd, B),
    'new terminal pane starts in the active project (' + (pane?.cwd || opened?.error || '?') + ')'
  );

  // Switching from the project menu (the File repository editor and its per-project drafts were
  // removed in the purple redesign).
  await openMenu();
  items()
    .find(i => same(i.dataset.projectPath, A))
    .querySelector('.repo-project-open')
    .click();
  check(
    !!(await until(async () => same(await N.fs.root(), A) && rail('src'))),
    'switching from the menu opens the other project tree'
  );
  const still = window.TnaiAgents.sessions().find(s => s.paneId === pane?.paneId);
  check(!!still?.running && same(still.cwd, B), 'running pane kept running in its own folder');
  await shot('projects-switched');

  // Live dots (09) + feed chip (53): proj-b now runs in the background. Its menu row counts its
  // panels' states from pushed session changes; a needs-you feed row names proj-b, and clicking it
  // switches there and opens the agent. No agent CLI runs (a hook event through the real emitter).
  const rowOf = p => items().find(i => same(i.dataset.projectPath, p)),
    liveOf = p => rowOf(p)?.querySelector('.repo-project-live')?.textContent ?? null;
  const cssColor = v => {
    const t = document.body.appendChild(document.createElement('i'));
    t.style.color = v;
    const c = getComputedStyle(t).color;
    t.remove();
    return c;
  };
  await openMenu();
  check(
    !rowOf(A)?.querySelector('.repo-project-live') && (await until(() => liveOf(B) === '')),
    'open project row has no live counts; a quiet background project shows none (' +
      JSON.stringify(liveOf(B)) +
      ')'
  );
  await main('event', pane.paneId, {
    kind: 'ask',
    questions: [
      { question: 'Which database?', options: [{ label: 'SQLite' }, { label: 'Postgres' }] },
    ],
  });
  check(
    !!(await until(() => liveOf(B) === '! 1 needs you · ')),
    'background row: "! 1 needs you" pushed (' + JSON.stringify(liveOf(B)) + ')'
  );
  const needsEl = rowOf(B)?.querySelector('.repo-project-live [data-k=needs]');
  check(
    !!needsEl &&
      getComputedStyle(needsEl).color ===
        cssColor(
          getComputedStyle(document.documentElement).getPropertyValue('--st-waiting-fg').trim()
        ),
    'needs-you count in the waiting status color'
  );
  const was = [innerWidth, innerHeight];
  await main('size', 1024, 720);
  await openMenu();
  await shot('projects-live-dots');
  await main('size', was[0], was[1]);
  await main('event', pane.paneId, { kind: 'ask-done' });
  check(!!(await until(() => liveOf(B) === '')), 'answered: the background row goes quiet');
  const windows = /Windows/.test(navigator.userAgent);
  const sent = window.TnaiAgents.send(
    pane.paneId,
    windows
      ? '1..24 | % { "tick $_"; Start-Sleep -Milliseconds 250 }'
      : 'for i in $(seq 24); do echo tick $i; sleep 0.25; done'
  );
  check(
    !!(await until(() => liveOf(B) === '● 1 working · ')),
    'background panel printing: "● 1 working" (' +
      JSON.stringify(liveOf(B)) +
      ', sent ' +
      sent +
      ', menu ' +
      (menu().hidden ? 'closed' : 'open') +
      ', status ' +
      window.TnaiAgents.sessions().find(s => s.paneId === pane.paneId)?.status +
      ')'
  );
  const workEl = rowOf(B)?.querySelector('.repo-project-live [data-k=working]');
  check(
    !!workEl &&
      getComputedStyle(workEl).color ===
        cssColor(
          getComputedStyle(document.documentElement).getPropertyValue('--st-working-fg').trim()
        ),
    'working count in the working status color'
  );
  check(!!(await until(() => liveOf(B) === '', 15000)), 'output stopped: the dots disappear');
  menu().hidden || document.body.click();
  window.TnaiRoute('agents');
  await wait(300);

  // The feed's rows (and their other-project chip) left the Agents page 2026-10-07; the event is
  // still recorded, and the switch is made directly.
  check(
    !!(await until(() =>
      window.TnaiLiveFeed.items().find(i => /asks you: Which database/.test(i.line))
    )),
    'the background needs-you event is recorded (TnaiLiveFeed.items)'
  );
  await window.TnaiProjects.switchTo(B);
  window.TnaiLiveTasks?.setTarget?.(pane.paneId);
  window.TnaiThreads.show(pane.paneId);
  check(
    !!(await until(
      async () =>
        same(await N.fs.root(), B) &&
        window.TnaiThreadView.shown() === pane.paneId &&
        window.TnaiThreads.visible()
    )),
    'switching to proj-b opens that agent’s thread'
  );

  // Back to the sample project for the steps below.
  await window.TnaiProjects.switchTo(A);
  check(
    !!(await until(async () => same(await N.fs.root(), A))),
    'switched back to the sample project'
  );
  window.TnaiRoute('files');
  await wait(300);

  await openMenu();
  check(
    items().length === 2 &&
      items().find(i => i.classList.contains('active')) &&
      same(items().find(i => i.classList.contains('active')).dataset.projectPath, A),
    'menu marks the new active project'
  );
  items()
    .find(i => same(i.dataset.projectPath, B))
    .querySelector('.repo-project-open')
    .click();
  check(
    !!(await until(async () => same(await N.fs.root(), B) && rail('lib'))),
    'switching back opens proj-b again (editor drafts went with the File repository page)'
  );

  // × removes a project from the list only; its files stay.
  await openMenu();
  items()
    .find(i => same(i.dataset.projectPath, A))
    .querySelector('.repo-project-remove')
    .click();
  check(
    !!(await until(async () => (await D.projects()).projects.length === 1)),
    '× removes the inactive project from the list'
  );
  check(await main('exists', A + '\\README.md'), 'removed project files are still on disk');
  check(
    same(await N.fs.root(), B) && !!(await until(() => items().length === 1)),
    'active project unchanged after removing another'
  );
  saved = await main('saved');
  check(saved.projects.length === 1 && same(saved.root, B), 'removal saved');

  // × on the active project (nothing unsaved there) leaves no project active; the list keeps the
  // others.
  const C = await main('make', 'proj-c');
  await main('pickNext', C);
  await openMenu();
  menu().querySelector('.repo-project-add').click();
  check(
    !!(await until(async () => same(await N.fs.root(), C) && rail('lib'))),
    'third project added and active'
  );
  await openMenu();
  items()
    .find(i => same(i.dataset.projectPath, C))
    .querySelector('.repo-project-remove')
    .click();
  check(
    !!(await until(async () => !(await N.fs.root()))),
    '× on the active project leaves none active'
  );
  info = await D.projects();
  check(
    info.projects.length === 1 &&
      same(info.projects[0].path, B) &&
      (await main('exists', C + '\\README.md')),
    'list keeps the other project; removed files stay on disk'
  );
  check(
    !!(await until(
      () => document.querySelector('.repo-connect')?.dataset.state === 'sample' && switcher()
    )),
    'rail shows not connected, switcher still offers the open project'
  );
  await N.pty.stop(pane?.paneId);
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
return { ok, log };
