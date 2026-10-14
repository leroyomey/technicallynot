// Technically Not tools · desktop-check/tests/worktrees.js — Per-agent git worktrees (35 +
// worktree-service) on the temp project: the prompt box offers "Own worktree" for a new agent
// only in a repo with commits; a PowerShell thread started with it runs in userData/worktrees/…
// (never the project folder) on branch tnai/terminal-<id>, the app maps the thread to that
// branch and keeps its file and commit counts up to date by push, and a restart keeps it there.
// The ⎇ popover (35 land()): commits to merge and uncommitted changes (never merged), Keep
// working changes nothing, 0 commits ahead disables Merge; Merge refused on a dirty main tree,
// merges with --no-ff, conflicts reported and aborted cleanly; Discard disabled while running,
// asks Yes / No, deletes the folder and branch. A clean merged worktree removes without asking;
// names that aren't Technically Not worktrees are refused; detached HEAD / deleted branch
// handled. Reattach: a closed thread leaves its worktree free, and a new thread asked to continue
// in it starts in the same folder and branch. Worktrees without a thread: listed at the bottom
// of the ⎇ popover (Open switches to it) and reachable from the row "Worktrees without a panel"
// of the three-dots menu, which can merge and discard them. One opt-in for every start path (35
// want); tnai_delegate worktree inherit / none / own (sub-agents run as PowerShell via
// worktrees.main.js). A new worktree's node_modules links to the project folder's ignored one
// and Remove leaves it intact. git is isolated from the user's global config
// (git-remote.main.js). No prompt is sent to any agent. Returns {ok, log}.
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
    await wait(60);
  }
  return null;
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
const native = window.tnaiNative,
  W = window.TnaiWorktrees;
const text = async rel => {
  const r = await native.fs.read(rel, 0, 65536);
  return r.ok ? new TextDecoder().decode(r.value) : null;
};
const started = [];
const windows = /Windows/.test(navigator.userAgent),
  sep = windows ? '\\' : '/'; // off Windows the panel shell is bash
const sessionOf = async id => (await native.pty.list()).find(s => s.paneId === id);
const itemOf = async branch =>
  (await native.git.worktrees()).value?.items.find(i => i.branch === branch);

// Starts a PowerShell thread; `own` true gives it a worktree of its own, { branch } continues in
// that free worktree (what the prompt box and `tnai` hand to the same start). Returns its id.
async function newShell(own) {
  let id = '';
  try {
    const options = own ? { tool: 'Terminal', worktree: own } : { tool: 'Terminal' };
    id = (await window.TnaiTest.startThread(options)).paneId;
  } catch (error) {
    log.push('info ' + (error?.message || error));
  }
  if (id) started.push(id);
  await wait(2000);
  return id;
}

// What the app holds about a thread and its worktree: the branch it is mapped to, and that
// branch with its counts in the list the app keeps up to date by push.
const branchOf = id => W.panes()[id] || '';
const countsOf = branch => (W.list()?.items || []).find(item => item.branch === branch) || null;

// The ⎇ popover (35): open for a branch, its buttons, its note line.
const pop = () => document.querySelector('.wt-pop');
const popOpen = branch =>
  !!pop() && !pop().hidden && pop().querySelector('h4')?.textContent === '⎇ ' + branch;
const popBtn = act => pop()?.querySelector('button[data-act="' + act + '"]');
const popNote = () => pop()?.querySelector('.wt-note')?.textContent || '';
const closePop = () => {
  if (pop() && !pop().hidden)
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
};

async function openPop(branch) {
  closePop();
  await wait(50);
  W.land(branch, null);
  return until(() => popOpen(branch) && popBtn('merge') && popBtn('discard'));
}

try {
  await until(() => document.querySelector('.repo-real-tree [data-real-path="README.md"]'));
  const userData = await main('userData');

  // 0. Not a repository yet: the prompt box does not offer "Own worktree" for a new agent.
  const ownPill = () => document.querySelector('.composer .wt-compose');
  window.TnaiLiveTasks.newAgent('Claude Code');
  await wait(200);
  check(!!ownPill() && ownPill().hidden, 'no "Own worktree" in the prompt box outside a git repo');
  window.TnaiLiveTasks.newAgent(false);
  await wait(50);

  const shellA = await newShell(false);
  const sh = (id, cmd) => window.TnaiAgents.send(id, cmd);
  check(!!shellA, 'main shell started');
  sh(
    shellA,
    (windows
      ? "Add-Content .gitignore 'node_modules/'; Set-Content package.json '{}'; New-Item -ItemType Directory node_modules | Out-Null; Set-Content node_modules/probe.txt from-main; "
      : "echo 'node_modules/' >> .gitignore; echo '{}' > package.json; mkdir node_modules; echo from-main > node_modules/probe.txt; ") +
      'git init -q; git config user.email tnai-test@example.com; git config user.name Technically Not-Test; git config commit.gpgsign false; git add -A; git commit -qm initial'
  );
  check(
    !!(await until(async () => {
      const s = (await native.git.status()).value;
      return s?.repo && !s.initial && !s.files.length;
    })),
    'repo with a first commit'
  );
  const root = (await native.git.status()).value.root;
  await W.refresh();

  // 1. Start a shell thread in its own worktree. In a repository the prompt box offers the
  // choice for a new agent, unchecked.
  window.TnaiLiveTasks.newAgent('Claude Code');
  await wait(200);
  check(
    !ownPill().hidden && !ownPill().querySelector('input').checked,
    'in a repository the prompt box offers Own worktree, unchecked by default'
  );
  window.TnaiLiveTasks.newAgent(false);
  await wait(50);
  const shellB = await newShell(true);
  const s1 = await sessionOf(shellB);
  const list1 = (await native.git.worktrees()).value,
    wt = list1?.items[0],
    current = list1?.current;
  check(
    !!wt && /^tnai\/terminal-[0-9a-f]{6}$/.test(wt.branch) && !!current,
    'worktree branch ' + wt?.branch + ' (project folder on ' + current + ')'
  );
  check(
    !!s1 &&
      s1.cwd.toLowerCase() === wt.dir.toLowerCase() &&
      s1.cwd.toLowerCase().startsWith((userData + sep + 'worktrees' + sep).toLowerCase()),
    'pane cwd is the worktree under userData: ' + s1?.cwd
  );
  check(
    !s1.cwd.toLowerCase().startsWith(root.toLowerCase()),
    'worktree is not inside the project folder'
  );
  check(
    (await main('read', wt.dir + sep + 'node_modules' + sep + 'probe.txt'))?.trim() ===
      'from-main' && wt.changes === 0,
    'worktree node_modules links to the project folder one, 0 changes: ' + wt.changes
  );
  check(
    !!(await until(() => branchOf(shellB) === wt.branch)),
    'the app maps the thread to its branch'
  );
  const countB = () => {
    const item = countsOf(wt.branch);
    return item ? item.changes + ' files, ' + item.commits + ' commits' : 'not listed';
  };
  check(
    !!(await until(() => countB() === '0 files, 0 commits')),
    'its counts start at nothing: ' + countB()
  );
  check(!branchOf(shellA), 'the thread in the project folder is mapped to no branch');

  // 2. Work in the worktree; the counts the app keeps follow by push.
  sh(
    shellB,
    (windows ? 'Set-Content wt.txt from-worktree' : 'echo from-worktree > wt.txt') +
      "; git add wt.txt; git commit -qm 'wt file'"
  );
  check(
    !!(await until(() => countB() === '0 files, 1 commits')),
    'the commit is counted by push: ' + countB()
  );
  sh(shellB, windows ? 'Set-Content scratch.txt draft' : 'echo draft > scratch.txt');
  check(
    !!(await until(() => countB() === '1 files, 1 commits')),
    'the changed file is counted by push: ' + countB()
  );
  check(!(await native.fs.stat('wt.txt')).ok, 'project folder untouched by the worktree agent');
  await window.TnaiAgents.restart(shellB, { resume: false });
  check(
    (await sessionOf(shellB))?.cwd.toLowerCase() === wt.dir.toLowerCase(),
    'restart keeps the thread in its worktree'
  );

  // 2a. Where a user finds it: the thread's Details name the worktree under Setup, and a press on
  // that row opens the popover. (The mark on the terminal panel's head is never on screen.)
  {
    window.TnaiThreads.show(shellB);
    window.TnaiThreadSide.open('details');
    const host = window.TnaiThreads.slot('side');
    const row = await until(() => host.querySelector('button.ttd-link[data-worktree]'), 6000);
    check(
      row?.dataset.worktree === wt.branch &&
        row.textContent.includes('⎇ ' + wt.branch.replace(/^tnai\//, '')) &&
        /1 file/.test(row.textContent),
      'the thread’s Details name its worktree and what is on it: "' +
        (row?.textContent || 'no row') +
        '"'
    );

    // the row stands at the foot of Details: every scrolling box above it is taken to its end
    for (let box = row?.parentElement; box; box = box.parentElement)
      if (box.scrollHeight > box.clientHeight + 1) box.scrollTop = box.scrollHeight;
    await wait(300);
    console.log('TNAI_SHOT:wt-details-row');
    await wait(700);
    closePop();
    await wait(50);
    row?.click();
    check(
      !!(await until(() => popOpen(wt.branch) && popBtn('merge'), 4000)),
      'a press on that row opens the ⎇ popover for its branch'
    );
    closePop();
    window.TnaiThreadSide.close();
  }

  // 2b. The ⎇ popover: commits to merge, the uncommitted change is not merged; Keep working
  // changes nothing.
  check(!!(await openPop(wt.branch)), 'the ⎇ popover opens for its branch');
  check(
    !!(await until(() =>
      /1 commit to merge into /.test(pop().querySelector('.wt-facts')?.textContent || '')
    )) && /1 uncommitted change in the worktree is not merged/.test(pop().textContent),
    'popover: 1 commit to merge, the uncommitted change is not merged'
  );
  check(
    !popBtn('merge').disabled && !!popBtn('keep') && popBtn('discard').disabled,
    'Merge enabled, Keep working, Discard disabled while its panel runs'
  );
  console.log('TNAI_SHOT:wt-pop');
  await wait(600);
  popBtn('keep').click();
  await wait(100);
  check(
    pop().hidden &&
      !(await native.fs.stat('wt.txt')).ok &&
      (await itemOf(wt.branch))?.commits === 1,
    'Keep working closes it and changes nothing'
  );

  // 3. Merge: refused on a dirty main tree, then merged with a merge commit.
  sh(shellA, windows ? "Add-Content README.md 'dirty main'" : "echo 'dirty main' >> README.md");
  check(
    !!(await until(async () => (await native.git.status()).value?.files.length)),
    'main tree dirty'
  );
  await openPop(wt.branch);
  await until(() => !popBtn('merge')?.disabled);
  popBtn('merge').click();
  check(
    !!(await until(
      () => /uncommitted changes/.test(popNote()) && pop().querySelector('.wt-note.error')
    )),
    'dirty main tree refused: ' + popNote()
  );
  sh(shellA, 'git checkout -- README.md');
  check(
    !!(await until(async () => !(await native.git.status()).value?.files.length)),
    'main tree clean again'
  );
  await openPop(wt.branch);
  await until(() => !popBtn('merge')?.disabled);
  popBtn('merge').click();
  check(
    !!(await until(() =>
      /^Merged 1 commit into .*1 uncommitted change stayed in the worktree\.$/.test(popNote())
    )),
    'merged from the popover: ' + popNote()
  );
  check((await text('wt.txt'))?.trim() === 'from-worktree', 'merged file is in the project folder');
  check(
    !!(await until(
      () =>
        /Nothing to merge/.test(pop().querySelector('.wt-facts')?.textContent || '') &&
        popBtn('merge').disabled
    )),
    '0 commits ahead: said plainly, Merge disabled'
  );
  closePop();

  // 4. Conflict: reported honestly, merge aborted, main tree unchanged.
  sh(
    shellB,
    (windows ? 'Set-Content README.md from-worktree' : 'echo from-worktree > README.md') +
      "; git commit -qam 'wt readme'"
  );
  sh(
    shellA,
    (windows ? 'Set-Content README.md from-main' : 'echo from-main > README.md') +
      "; git commit -qam 'main readme'"
  );
  check(
    !!(await until(
      async () =>
        (await itemOf(wt.branch))?.commits === 1 && !(await native.git.status()).value?.files.length
    )),
    'both sides changed README.md'
  );
  await wait(400);
  await openPop(wt.branch);
  await until(() => !popBtn('merge')?.disabled);
  popBtn('merge').click();
  check(
    !!(await until(() => /conflicts/.test(popNote()))),
    'conflict reported: ' + popNote().split('.')[0]
  );
  check(
    /README\.md/.test(popNote()) && /aborted/.test(popNote()),
    'names the file and says it was aborted'
  );
  const st = (await native.git.status()).value;
  check(
    st.files.length === 0 &&
      !(await native.fs.stat('.git/MERGE_HEAD')).ok &&
      (await text('README.md')).trim() === 'from-main',
    'main tree clean, no merge in progress, README unchanged'
  );
  closePop();

  // 5. Discard: blocked while running; asks Yes / No; deletes the folder and branch.
  window.TnaiAgents.stop(shellB);
  check(
    !!(await until(async () => (await itemOf(wt.branch))?.running === false)),
    'its pane stopped'
  );
  await openPop(wt.branch);
  check(
    !!(await until(() => popBtn('discard') && !popBtn('discard').disabled)),
    'Discard enabled once the pane stopped'
  );
  popBtn('discard').click();
  check(
    !!(await until(() => popBtn('discard-yes') && popBtn('discard-no'))) &&
      /Its 1 uncommitted change and 1 unmerged commit are deleted with it/.test(
        pop().querySelector('.wt-ask')?.textContent || ''
      ),
    'asks first, naming what is lost: ' + pop().querySelector('.wt-ask')?.textContent
  );
  popBtn('discard-no').click();
  await wait(50);
  check(!!popBtn('merge') && !!(await itemOf(wt.branch)), 'No keeps it');
  popBtn('discard').click();
  (await until(() => popBtn('discard-yes')))?.click();
  check(
    !!(await until(() => /^Removed ⎇ .* and its branch\.$/.test(popNote()))),
    'removed: ' + popNote()
  );
  check(!(await main('exists', wt.dir)), 'worktree folder deleted');
  check(!(await itemOf(wt.branch)), 'branch deleted');
  check(
    (await main('read', root + sep + 'node_modules' + sep + 'probe.txt'))?.trim() === 'from-main',
    'project folder node_modules survives Remove (link unlinked, not followed)'
  );
  check(!(await native.git.worktreePanes())[shellB], 'pane no longer mapped to it');
  closePop();

  // 6. A clean worktree with nothing to merge removes without asking.
  const shellC = await newShell(true);
  const wt2 = await until(async () =>
    (await native.git.worktrees()).value?.items.find(i => i.paneId === shellC)
  );
  window.TnaiAgents.stop(shellC);
  await until(async () => (await itemOf(wt2.branch))?.running === false);
  const rc = await native.git.worktreeRemove(wt2.branch, {});
  check(
    rc.ok && rc.value.removed && !(await main('exists', wt2.dir)),
    'clean worktree removed without asking ' + JSON.stringify(rc.error || '')
  );

  // 6b. A detached HEAD in a worktree: its commits are counted. Its branch deleted outside
  // Technically Not: reported (branchMissing), Remove still works.
  const itemAt = async dir =>
    (await native.git.worktrees()).value?.items.find(
      i => i.dir.toLowerCase() === dir.toLowerCase()
    );
  const shellD = await newShell(true);
  const wt3 = await until(async () =>
    (await native.git.worktrees()).value?.items.find(i => i.paneId === shellD)
  );
  sh(
    shellD,
    'git checkout -q --detach; ' +
      (windows ? 'Set-Content d.txt x' : 'echo x > d.txt') +
      '; git add d.txt; git commit -qm detached'
  );
  check(
    !!(await until(async () => {
      const i = await itemAt(wt3.dir);
      return i?.detached && i.commits === 1 && i.branch === wt3.branch;
    })),
    'detached HEAD: 1 commit counted, same branch name'
  );
  sh(shellA, 'git branch -D ' + wt3.branch);
  check(
    !!(await until(async () => (await itemAt(wt3.dir))?.branchMissing)),
    'branch deleted outside Technically Not: branchMissing'
  );
  window.TnaiAgents.stop(shellD);
  await until(async () => !(await itemAt(wt3.dir))?.running);
  const r3 = await native.git.worktreeRemove(wt3.branch, { deleteBranch: false });
  check(
    r3.ok &&
      r3.value.removed &&
      r3.value.branchMissing &&
      !r3.value.branchDeleted &&
      !(await main('exists', wt3.dir)),
    'detached, branch missing: removed without a git error ' + JSON.stringify(r3.error || '')
  );
  const shellE = await newShell(true);
  const wt4 = await until(async () =>
    (await native.git.worktrees()).value?.items.find(i => i.paneId === shellE)
  );
  window.TnaiAgents.stop(shellE);
  sh(shellA, 'git update-ref -d refs/heads/' + wt4.branch);
  check(
    !!(await until(async () => {
      const i = await itemAt(wt4.dir);
      return i?.branchMissing && !i.detached && i.commits === 0;
    })),
    'checked-out branch ref deleted: branchMissing'
  );
  const m4 = await native.git.worktreeMerge(wt4.branch);
  check(
    !m4.ok && m4.error.code === 'BranchMissing',
    'merge says the branch is missing: ' + m4.error?.message
  );
  await until(async () => !(await itemAt(wt4.dir))?.running);
  const r4 = await native.git.worktreeRemove(wt4.branch, { discard: true });
  check(
    r4.ok && r4.value.removed && r4.value.branchMissing && !(await main('exists', wt4.dir)),
    'branch missing: Remove works ' + JSON.stringify(r4.error || r4.value)
  );

  // 6c. Reattach: a closed thread leaves its worktree free; a new thread asked to continue in it
  // starts there on the same branch. A thread is closed the way the app closes one: the Close
  // button of its panel underneath, after its session was stopped.
  const closePane = id =>
    document
      .querySelector(
        '.terminal-pane[data-pane-id="' +
          id +
          '"] .terminal-pane-tools button[title="Close terminal"]'
      )
      ?.click();
  const freeHas = async branch =>
    (await native.git.worktreeFree('')).some(w => w.branch === branch);
  const shellF = await newShell(true);
  const wtF = await until(async () =>
    (await native.git.worktrees()).value?.items.find(i => i.paneId === shellF)
  );
  sh(
    shellF,
    (windows ? 'Set-Content f.txt kept' : 'echo kept > f.txt') +
      "; git add f.txt; git commit -qm 'f work'"
  );
  check(
    !!(await until(async () => (await itemAt(wtF.dir))?.commits === 1)),
    'worktree F has its own commit'
  );
  check(!(await freeHas(wtF.branch)), 'a held worktree is not free');
  window.TnaiAgents.stop(shellF);
  closePane(shellF);
  check(!!(await until(() => freeHas(wtF.branch))), 'closed panel: its worktree is free');
  const countF = (await native.git.worktrees()).value.items.length;

  // a new thread asked to continue in that free worktree
  const shellG = await newShell({ branch: wtF.branch });
  const sG = await sessionOf(shellG);
  check(
    !!sG &&
      sG.cwd.toLowerCase() === wtF.dir.toLowerCase() &&
      (await native.git.worktreePanes())[shellG] === wtF.branch,
    'continued in the same folder and branch: ' + sG?.cwd
  );
  check(
    (await native.git.worktrees()).value.items.length === countF &&
      (await itemAt(wtF.dir))?.commits === 1 &&
      (await itemAt(wtF.dir))?.paneId === shellG,
    'no new branch minted; its commit is still there; the new panel owns it'
  );
  check(
    !!(await until(() => branchOf(shellG) === wtF.branch)),
    'the app maps the new thread to the continued branch'
  );
  check(
    !!(await until(async () => !(await freeHas(wtF.branch)))),
    'a worktree a thread holds again is no longer free'
  );
  const shellH = await newShell(true);
  const wtH = await until(async () =>
    (await native.git.worktrees()).value?.items.find(i => i.paneId === shellH)
  );
  check(
    !!wtH &&
      wtH.branch !== wtF.branch &&
      (await native.git.worktrees()).value.items.length === countF + 1,
    'Own worktree still mints a new branch: ' + wtH?.branch
  );

  // 6d. Panel-less worktrees: landed from the ⎇ popover's list and from the row "Worktrees
  // without a panel" of the three-dots menu (124; it was a button of the old Overview's ? menu).
  // The row is in the menu only while there is such a worktree.
  const menuButton = () => document.querySelector('.top .tnt-menu-btn'),
    menuBox = () => document.querySelector('.tnt-menu.tnt-menu-full'),
    // A box with a fixed place has no offsetParent: it is open when it has a size.
    menuOpen = () =>
      !!menuBox() && !menuBox().hidden && menuBox().getBoundingClientRect().width > 0,
    closeMenu = () => window.TnaiThreadMenu?.close();
  const freeRow = async () => {
    closeMenu();
    await wait(120);
    menuButton().click();
    await until(menuOpen, 3000);
    return (
      [...(menuBox()?.querySelectorAll('.tnt-menu-row') || [])].find(
        menuRow =>
          menuRow.offsetParent !== null &&
          menuRow.querySelector('span')?.textContent.trim() === 'Worktrees without a panel'
      ) || null
    );
  };
  const noRow = !(await freeRow());
  check(
    menuOpen() && noRow && W.free().length === 0,
    'the menu has no worktree row while every worktree has a panel (menu open ' +
      menuOpen() +
      ', no row ' +
      noRow +
      ', free ' +
      W.free()
        .map(free => free.branch)
        .join(' ') +
      ')'
  );
  closeMenu();
  window.TnaiAgents.stop(shellG);
  closePane(shellG);
  window.TnaiAgents.stop(shellH);
  closePane(shellH);
  check(
    !!(await until(async () => (await freeHas(wtF.branch)) && (await freeHas(wtH.branch)))),
    'both free after their panels closed'
  );
  await until(() => W.free().length === 2);
  const offered = await freeRow();
  check(
    !!offered && W.free().length === 2,
    'the menu offers the row once two worktrees have no panel (' + W.free().length + ' free)'
  );
  offered?.click();
  const first = W.free()[0].branch,
    second = W.free()[1].branch;
  check(
    !!(await until(() => popOpen(first) && popBtn('merge'))),
    'a press on the row opens the ⎇ popover on the newest free worktree: ' + first
  );
  const freeRows = () => [...pop().querySelectorAll('.grp .qi')];
  check(
    freeRows().length === 1 &&
      freeRows()[0].textContent.includes(second) &&
      /Worktrees without a panel/.test(pop().querySelector('.grp .who')?.textContent || ''),
    'the popover lists the other panel-less worktree'
  );
  await wait(300);

  const pr = pop().getBoundingClientRect();
  console.log('TNAI_SHOT:wt-free-pop');
  await wait(600);
  freeRows()[0].querySelector('button[data-act="go"]').click();
  check(
    !!(await until(() => popOpen(second) && popBtn('discard') && !popBtn('discard').disabled)),
    'Open switches the popover to ' + second
  );
  check(
    freeRows().length === 1 && freeRows()[0].textContent.includes(first),
    'and lists the first one instead'
  );
  await openPop(wtF.branch);
  await until(() => !popBtn('merge')?.disabled);
  popBtn('merge').click();
  check(
    !!(await until(() => /^Merged 1 commit into /.test(popNote()))) &&
      (await text('f.txt'))?.trim() === 'kept',
    'a panel-less worktree merges from the popover: ' + popNote()
  );
  await openPop(wtH.branch);
  popBtn('discard').click();
  (await until(() => popBtn('discard-yes')))?.click();
  check(
    !!(await until(() => /^Removed ⎇ /.test(popNote()))) && !(await main('exists', wtH.dir)),
    'a panel-less worktree discards from the popover'
  );
  await until(() => W.free().length === 1);
  closePop();
  const stillOffered = !!(await freeRow());
  check(
    stillOffered && W.free().length === 1,
    'the row stays while one worktree has no panel (' + W.free().length + ' free)'
  );
  closeMenu();
  closePop();
  const rF = await native.git.worktreeRemove(wtF.branch, { discard: true, deleteBranch: true });

  // This removal goes past the app's own Discard, which reloads the list itself. The push from
  // the git watcher alone did not always arrive within 15 s (one run in four, 2026-10-13), so the
  // list is asked to reload as Discard does; what is checked here is the row, not the watcher.
  await W.refresh();
  await until(() => W.free().length === 0);
  const rowGone = !(await freeRow());
  check(
    rF.ok && rF.value.removed && rowGone,
    'worktree F removed; the row leaves the menu (' + W.free().length + ' free)'
  );
  closeMenu();
  document.body.click();
  await wait(100);

  // 7. Only Technically Not worktrees can be merged or removed.
  const r1 = await native.git.worktreeRemove(current),
    r2 = await native.git.worktreeMerge('../../outside');
  check(
    !r1.ok && r1.error.code === 'NoWorktree' && !r2.ok && r2.error.code === 'NoWorktree',
    'non-Technically Not names refused'
  );

  // 8. One opt-in for every start path (35 want): the composer's New agent checkbox, or explicit;
  // sub-agents and sign-ins are never decided here.
  const L = window.TnaiLiveTasks,
    compose = () => document.querySelector('.composer .wt-compose'),
    composeBox = () => compose()?.querySelector('input');
  L.newAgent(false);
  await wait(50);
  check(!!compose() && compose().hidden, 'composer Own worktree hidden while New agent is off');
  L.newAgent('Claude Code');
  await wait(50);
  check(
    !compose().hidden && !composeBox().checked,
    'composer Own worktree shown, unchecked, once New agent is on'
  );
  check(
    W.want({ agent: 'Claude Code', from: 'composer' }) === false,
    'composer unchecked → project folder'
  );

  // The prompt box shows on the Threads page.
  window.TnaiThreads.open();
  await wait(300);
  {
    const pill = compose().getBoundingClientRect();
    check(
      pill.height > 0 && pill.width > 0,
      'composer Own worktree is shown: ' + Math.round(pill.width) + '×' + Math.round(pill.height)
    );
  }
  console.log('TNAI_SHOT:wt-compose-off');
  await wait(400);
  composeBox().click();
  await wait(250);
  check(compose().classList.contains('on'), 'composer Own worktree shows it is on');
  console.log('TNAI_SHOT:wt-compose-on');
  await wait(400);
  check(
    W.want({ agent: 'Claude Code', from: 'composer' }) === true,
    'composer checked → own worktree'
  );
  check(
    W.want({ agent: 'Claude Code' }) === false &&
      W.want({ agent: 'Claude Code', worktree: true }) === true &&
      W.want({ agent: 'Claude Code', worktree: true, subagentOf: 'n1' }) === false &&
      W.want({ agent: 'Claude Code', worktree: true, mode: 'login' }) === false,
    'no picker choice → false; worktree: true → true; sub-agent / sign-in → false'
  );

  // The composer's New agent start (19 openHere) passes the box to the pane start; openIn is
  // stubbed so no CLI starts.
  const openIn = window.TnaiAgents.openIn;
  let asked = null;
  window.TnaiAgents.openIn = async (paneId, agent, opts) => {
    asked = { agent, ...opts };
    return { ok: false, error: 'stubbed' };
  };
  let leadResult = null;
  try {
    leadResult = await window.TnaiTeam.startLead({ here: true, agent: 'Claude Code' });
  } finally {
    window.TnaiAgents.openIn = openIn;
  }
  check(
    asked?.worktree === true && asked.ownedByUser === true,
    'composer New agent start asks for its own worktree: ' +
      JSON.stringify(asked && { worktree: asked.worktree }) +
      (asked ? '' : ' · ' + (leadResult?.error || ''))
  );
  L.newAgent(false);
  await wait(50);
  check(compose().hidden && !composeBox().checked, 'New agent off → checkbox hidden and reset');

  // 9. tnai_delegate worktree: a lead in its own worktree delegates (worktrees.main.js runs the
  // sub-agents as PowerShell, no prompt).
  const shellLead = await newShell(true);
  const leadBranch = (await native.git.worktreePanes())[shellLead],
    leadCwd = (await sessionOf(shellLead))?.cwd || '';
  check(!!leadBranch && !!leadCwd, 'lead in its own worktree ' + leadBranch);
  const lower = s => String(s || '').toLowerCase();
  const sub = async (worktree, purpose, task) => {
    const r = await main('delegate', shellLead, worktree, purpose, task);
    if (r.paneId) started.push(r.paneId);
    const cwd = await until(async () => (await sessionOf(r.paneId))?.cwd);
    return { ...r, cwd: cwd || '' };
  };
  const d1 = await sub(
    '',
    'Kiln glaze notes',
    'Summarise kiln glaze recipes for celadon and tenmoku finishes and report back.'
  );
  check(
    !d1.error && d1.worktree === 'inherit' && lower(d1.cwd) === lower(leadCwd),
    'default inherit: sub-agent runs in the lead worktree: ' +
      d1.cwd +
      (d1.error ? ' · ' + d1.text : '')
  );
  check(d1.lane === leadBranch, 'inherit: the node lane is the lead branch');
  await window.TnaiAgents.restart(d1.paneId, { resume: false });
  check(
    lower(
      (
        await until(async () => {
          const s = await sessionOf(d1.paneId);
          return s?.running && s;
        })
      )?.cwd
    ) === lower(leadCwd),
    'restarted sub-agent keeps the inherited worktree'
  );
  const d2 = await sub(
    'none',
    'Harbour tide parser',
    'Parse harbour tide tables into hourly water heights per weekday and report back.'
  );
  check(
    !d2.error &&
      d2.worktree === 'none' &&
      lower(d2.cwd) === lower(root) &&
      d2.lane === '' &&
      !branchOf(d2.paneId),
    'none: project folder, no lane, mapped to no branch: ' + d2.cwd
  );
  const d3 = await sub(
    'own',
    'Violin rosin survey',
    'Compare violin rosin brands by grip, dust and temperature behaviour and report back.'
  );
  check(
    !d3.error &&
      d3.worktree === 'own' &&
      /^tnai\/claude-code-[0-9a-f]{6}$/.test(d3.lane) &&
      lower(d3.cwd) !== lower(leadCwd) &&
      lower(d3.cwd).startsWith(lower(userData + sep + 'worktrees' + sep)),
    'own: a new worktree ' + d3.lane + ' at ' + d3.cwd
  );
  check(
    !!(await until(() => branchOf(d3.paneId) === d3.lane)),
    'own: the app maps the sub-agent to its own branch'
  );
  sh(d3.paneId, windows ? 'Set-Content rosin.txt notes' : 'echo notes > rosin.txt');
  check(
    !!(await until(() => countsOf(d3.lane)?.changes === 1)),
    'the changed file of the sub-agent is counted by push (' + countsOf(d3.lane)?.changes + ')'
  );
  check(!!(await openPop(d3.lane)), 'the ⎇ popover opens for the sub-agent branch');
  closePop();
} catch (error) {
  check(false, 'stopped: ' + error.message + ' · ' + error.stack.split('\n')[1]);
}
for (const id of started) window.TnaiAgents.stop(id);

// Let the shells finish closing: exiting the app mid-teardown crashes it (0xC0000409) after RESULT:
// PASS.
await until(async () => !(await native.pty.list()).some(s => s.running), 5000);
await wait(300);
return { ok, log };
