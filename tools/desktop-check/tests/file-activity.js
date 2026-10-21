// Technically Not tools · desktop-check/tests/file-activity.js — which files an agent works on
// (13 TnaiFileActivity), read where the thread layout shows it: a real shell thread writing files
// has them credited live and its row in the thread list names the latest one; a shell in its own
// worktree gets lane file activity (never the project folder's file). Moved 2026-10-12 from the
// old Overview, whose "Files in motion" list (the rows, the click that opened a file, the list
// clearing when the agent went idle) went with that page and has no place yet. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
  }
  return null;
};
const layout = document.querySelector('.layout'),
  row = p => document.querySelector('.repo-real-tree [data-real-path="' + p + '"]');
const tagsOn = p =>
  [...(row(p)?.querySelectorAll('.repo-agent-tag') || [])].map(t => t.textContent);

const act = window.TnaiFileActivity,
  threadRow = id => document.querySelector('.tnt-th[data-pane="' + id + '"]:not(.tnt-sub)'),
  nowText = id => threadRow(id)?.querySelector('.tnt-th-now')?.textContent || '';
check(window.TnaiThreads?.visible() === true, 'starts on Threads');
check(!!(await until(() => row('src'))), 'project folder restored, src listed');

// A real shell thread that writes into the project folder.
const started = await window.TnaiTest.startThread({ tool: 'Terminal' });
const paneId = started.paneId;
check(!!started.session?.running, 'shell started as a thread');
await wait(2500);

let t0 = Date.now();
window.TnaiAgents.send(paneId, "Set-Content -Path src/app.js -Value 'changed by agent'");
check(
  !!(await until(() => act.forPane(paneId).includes('src/app.js'), 6000)),
  'src/app.js is credited to the thread that wrote it (' + (Date.now() - t0) + ' ms)'
);
check(
  !!(await until(() => /src\/app\.js/.test(nowText(paneId)), 6000)),
  'its thread row names the file ("' + nowText(paneId) + '")'
);
console.log('TNAI_SHOT:file-activity-thread-row');

// A project switch keeps the files of agents still running: their panels go on working in
// their own folder (here the same folder is opened again, so nothing else changes).
window.dispatchEvent(
  new CustomEvent('tnai:project-changed', { detail: { root: await window.tnaiNative.fs.root() } })
);
await wait(300);
check(
  act.forPane(paneId).includes('src/app.js') && act.now(paneId)?.path === 'src/app.js',
  "a project switch keeps the running thread's file and Now line (" +
    act.forPane(paneId).join(', ') +
    ')'
);
await wait(400);
t0 = Date.now();
window.TnaiAgents.send(paneId, "Set-Content -Path src/added.js -Value 'new'");
check(
  !!(await until(() => act.forPane(paneId)[0] === 'src/added.js', 6000)),
  'a new file is credited, newest first (' +
    (Date.now() - t0) +
    ' ms: ' +
    act.forPane(paneId).join(', ') +
    ')'
);
check(
  !!(await until(
    () => row('src/added.js') || row('src')?.getAttribute('aria-expanded') !== 'true',
    5000
  )),
  'the project tree still learns about the new file'
);

// Lane: a shell in its own git worktree ("Own worktree") changes src/app.js there. It is credited
// as a lane file (⎇<lane id>/src/app.js), never as the project folder's src/app.js: no rail tag,
// the project file is untouched.
const native = window.tnaiNative,
  agents = window.TnaiAgents;
agents.send(
  paneId,
  'git init -q; git config user.email tnai-test@example.com; git config user.name Tnai-Test; git config commit.gpgsign false; git add -A; git commit -qm initial'
);

// The last status seen is printed when the step fails, so a failure names which part is off.
let lastStatus = null;
check(
  !!(await until(async () => {
    const s = (await native.git.status()).value;
    lastStatus = s;
    return s?.repo && !s.initial && !s.files.length;
  }, 15000)),
  'lane: repo with a first commit'
);
if (!(lastStatus?.repo && !lastStatus.initial && !lastStatus.files.length))
  log.push(
    'info git status: ' +
      JSON.stringify({
        repo: lastStatus?.repo,
        initial: lastStatus?.initial,
        branch: lastStatus?.branch,
        files: (lastStatus?.files || []).slice(0, 8),
      })
  );
await window.TnaiGit?.refresh?.();

// A second thread started in its own worktree: the start's own option, the one the prompt box's
// "Own worktree" box sets for a new agent (35).
const lanePane = await window.TnaiTest.startThread({ tool: 'Terminal', worktree: true }).then(
  made => made.paneId,
  error => {
    log.push('info ' + error.message);
    return '';
  }
);
const laneSession = await until(() =>
  agents
    .sessions()
    .find(s => s.paneId === lanePane && s.running && /[\\/]worktrees[\\/]/i.test(s.cwd || ''))
);
check(!!laneSession, 'lane thread runs in its worktree: ' + laneSession?.cwd);
await wait(2500);
const laneId = (laneSession?.cwd || '').split(/[\\/]/).pop(),
  laneFile = '⎇' + laneId + '/src/app.js';
agents.send(lanePane, "Set-Content -Path src/app.js -Value 'lane edit'");
t0 = Date.now();
check(
  !!(await until(() => act.forPane(lanePane).includes(laneFile), 5000)),
  'lane change credited as ' + laneFile + ' (' + (Date.now() - t0) + ' ms)'
);
check(
  !act.forPane(lanePane).includes('src/app.js') && act.now(lanePane)?.path === laneFile,
  'not taken for the project folder file; Now line names the lane file'
);
const parsed = act.lane(laneFile);
check(
  parsed.lane?.id === laneId && /worktrees/i.test(parsed.lane.dir) && parsed.path === 'src/app.js',
  'lane() maps it back to the lane and its path'
);
check(
  !act.forPane(paneId).includes(laneFile),
  'the lane file is not credited to the thread in the project folder (' +
    act.forPane(paneId).join(', ') +
    ')'
);
const main = await native.fs.read('src/app.js', 0, 4096);
check(
  main.ok && /changed by agent/.test(new TextDecoder().decode(main.value)),
  'project folder file untouched'
);
agents.stop(lanePane);
window.TnaiAgents.stop(paneId);
await wait(300);
return { ok, log };
