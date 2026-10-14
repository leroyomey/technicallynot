/*
 * Technically Not tools · desktop-check/file-lock-check.js — Agent file locks
 * (desktop/file-locks.js) in plain Node with a fake clock and fake notify/family deps: one lock per
 * project + file (path normalized, lowercased on Windows), owned by one terminal panel; refused for
 * anyone else unless family() says the two panes share a lead tree; refusal notifies the holder at
 * most once per file+requester every 10 minutes; a lock expires 20 minutes after the holder's last
 * edit; shared ledgers (a project's issue, suggestion, release and state lists)
 * are always exempt; release/releasePane free locks; list() reports holders;
 * send('locks:changed', {project}) fires on every change; different projects never collide; team
 * mode (agent-teams.js) shares locks only between agents the user grouped, a whole-file rewrite
 * stays exclusive for WHOLE_MS inside a team, and ungrouping or closing a panel restores blocking.
 * No CLI runs. Usage: node tools/desktop-check/file-lock-check.js
 */
'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-locks-'));
const load = Module._load;
Module._load = (req, ...rest) =>
  req === 'electron'
    ? { app: { getPath: () => tmp }, shell: { openPath: async () => '' } }
    : load(req, ...rest);
const locks = require('../../desktop/file-locks');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};

const proj1 = path.join(tmp, 'proj1');
const proj2 = path.join(tmp, 'proj2');
fs.mkdirSync(path.join(proj1, 'src'), { recursive: true });
fs.mkdirSync(path.join(proj1, 'docs'), { recursive: true });
fs.mkdirSync(path.join(proj2, 'src'), { recursive: true });

const events = [];
let t = Date.parse('2026-09-26T12:00:00Z');
const notifyCalls = [];
let notifyImpl = (paneId, text) => {
  notifyCalls.push([paneId, text]);
  return Promise.resolve();
};
const familyPairs = new Set(); // 'A|B' both directions marked family
let familyImpl = (a, b) => familyPairs.has(a + '|' + b) || familyPairs.has(b + '|' + a);

// team mode block below wires desktop/agent-teams.js the way main.js does
let teamImpl = () => false;
let treeImpl = () => false; // lead tree block below: main.js passes sameTree
let waitingImpl = () => false; // main.js passes agent-links.js waiting(holder, requester)

locks.init((channel, payload) => events.push([channel, payload]), {
  notify: (paneId, text) => notifyImpl(paneId, text),
  family: (a, b) => familyImpl(a, b),
  team: (a, b) => teamImpl(a, b),
  tree: (a, b) => treeImpl(a, b),
  waiting: (a, b) => waitingImpl(a, b),
  now: () => t,
});

const A = { paneId: 'A', name: 'Nova', provider: 'Claude Code' };
const B = { paneId: 'B', name: 'Kai', provider: 'Claude Code' };
const changesFor = project =>
  events.filter(([c, p]) => c === 'locks:changed' && p && p.project === project).length;

// --- Basic acquire / refuse ---
{
  const r1 = locks.acquire(proj1, 'src/a.js', A);
  check(r1 && r1.ok === true, 'A acquires src/a.js');
  const r2 = locks.acquire(proj1, 'src/a.js', A);
  check(r2 && r2.ok === true, 'A acquires src/a.js again (refresh)');
  const r3 = locks.acquire(proj1, 'src/a.js', B);
  check(
    r3 && r3.ok === false && r3.holder && r3.holder.paneId === 'A' && /Nova/.test(r3.text),
    'B is refused src/a.js; holder is A, text names Nova'
  );
}

// --- Path normalization: absolute vs relative vs case, on Windows ---
{
  locks.acquire(proj1, path.join(proj1, 'src', 'B.js'), A);
  const rel = locks.acquire(proj1, 'src/b.js', B);
  check(
    rel && rel.ok === false && rel.holder.paneId === 'A',
    'relative path collides with the absolute path A took'
  );
  const cased = locks.acquire(proj1, path.join(proj1, 'SRC', 'b.JS'), B);
  check(
    cased && cased.ok === false && cased.holder.paneId === 'A',
    'a different case of the same path is still the same lock (Windows)'
  );
}

// --- Outside the project: not locked ---
{
  const outside = path.join(tmp, 'outside.js');
  const o1 = locks.acquire(proj1, outside, A);
  const o2 = locks.acquire(proj1, outside, B);
  check(
    o1 && o1.ok === true && o2 && o2.ok === true,
    'a file outside the project is never locked; both owners get ok'
  );

  // A folder whose name only starts with two dots is inside the project, and its files lock like
  // any other.
  const dotty = path.join(proj1, '..cache', 'x.js');
  const d1 = locks.acquire(proj1, dotty, A),
    d2 = locks.acquire(proj1, dotty, B);
  check(
    d1 && d1.ok === true && d2 && d2.ok === false,
    'a file in a project folder named "..cache" is locked: the second owner is refused'
  );
  locks.release?.(proj1, dotty, A);
}

// --- family() allows a related pane through ---
{
  locks.acquire(proj1, 'src/family.js', A);
  const blocked = locks.acquire(proj1, 'src/family.js', B);
  check(blocked.ok === false, 'B refused src/family.js before family is declared');
  familyPairs.add('A|B');
  const allowed = locks.acquire(proj1, 'src/family.js', B);
  check(allowed && allowed.ok === true, 'family(A,B) true lets B acquire the same file A holds');
  familyPairs.delete('A|B');
}

// --- Exempt shared ledgers ---
{
  check(
    locks.exempt(proj1, 'docs/RELEASE_QUEUE.md') === true,
    'exempt() true for docs/RELEASE_QUEUE.md'
  );
  check(locks.exempt(proj1, 'docs/ISSUES.md') === true, 'exempt() true for docs/ISSUES.md');
  check(
    locks.exempt(proj1, 'docs/SUGGESTIONS.md') === true,
    'exempt() true for docs/SUGGESTIONS.md'
  );
  check(
    locks.exempt(proj1, 'docs/CURRENT_STATE.md') === true,
    'exempt() true for docs/CURRENT_STATE.md'
  );
  check(locks.exempt(proj1, 'src/a.js') === false, 'exempt() false for an ordinary file');
  const e1 = locks.acquire(proj1, 'docs/RELEASE_QUEUE.md', A);
  const e2 = locks.acquire(proj1, 'docs/RELEASE_QUEUE.md', B);
  check(
    e1.ok === true && e2.ok === true,
    'a shared ledger is never exclusive, no matter who holds it'
  );
}

// --- Refusal notifies the holder, deduped 10 minutes, no self-block from family gaps ---
{
  familyPairs.clear();
  notifyCalls.length = 0;
  locks.acquire(proj1, 'src/notify.js', A);
  locks.acquire(proj1, 'src/notify.js', B); // refusal #1
  check(
    notifyCalls.length === 1 && notifyCalls[0][0] === 'A',
    'a refusal notifies the holder once'
  );
  locks.acquire(proj1, 'src/notify.js', B); // same requester, same file, within 10 min
  check(
    notifyCalls.length === 1,
    'a second refusal for the same file+requester inside 10 minutes does not notify again'
  );
  t += 11 * 60 * 1000;

  // still refused (A has not exceeded 20-min expiry via acquire refreshes below); notify again
  locks.acquire(proj1, 'src/notify.js', B);
  check(
    notifyCalls.length === 2,
    'after 10 minutes, a refusal for the same file+requester notifies again'
  );
  check(
    !/You are waiting on an answer/.test(notifyCalls[1][1]),
    'a holder that waits on nobody gets the plain notice'
  );

  // The holder waits on an answer from the agent its lock blocks (agent-links.js): the notice says
  // so.
  waitingImpl = (holder, requester) => holder === 'A' && requester === 'B';
  t += 11 * 60 * 1000;
  locks.acquire(proj1, 'src/notify.js', A); // the holder keeps its lock
  locks.acquire(proj1, 'src/notify.js', B);
  check(
    notifyCalls.length === 3 &&
      /You are waiting on an answer from/.test(notifyCalls[2][1]) &&
      /unlock it now/.test(notifyCalls[2][1]),
    'a holder waiting on the refused agent is told its file is what stops the answer'
  );
  waitingImpl = () => false;
}

// --- Expiry: 20 minutes after the holder's last edit ---
{
  const project = proj1;
  locks.acquire(project, 'src/expire.js', A);
  t += 19 * 60 * 1000;
  const still = locks.acquire(project, 'src/expire.js', B);
  check(still.ok === false, 'still held 19 minutes after the last edit');
  t += 2 * 60 * 1000; // total 21 minutes since A's last acquire/edit
  const now = locks.acquire(project, 'src/expire.js', B);
  check(now.ok === true, "B can acquire 21 minutes after the holder's last edit (expired)");
}

// --- release / releasePane ---
{
  const project = proj1;
  locks.acquire(project, 'src/rel1.js', A);
  locks.acquire(project, 'src/rel2.js', A);
  const byOther = locks.release(project, ['src/rel1.js'], 'B');
  check(byOther && byOther.released.length === 0, 'release by a non-holder frees nothing');
  const still = locks.acquire(project, 'src/rel1.js', B);
  check(still.ok === false, "the lock survives the non-holder's release attempt");
  const freed = locks.release(project, ['src/rel1.js'], 'A');
  check(
    freed && freed.released.includes('src/rel1.js'),
    'release(project, [file], A) frees that file'
  );
  const now = locks.acquire(project, 'src/rel1.js', B);
  check(now.ok === true, 'B can now acquire the freed file');

  locks.acquire(project, 'src/rel3.js', A);
  const freedAll = locks.release(project, null, 'A');
  check(
    freedAll &&
      freedAll.released.includes('src/rel2.js') &&
      freedAll.released.includes('src/rel3.js'),
    "release(project, null, A) frees all of A's locks in that project"
  );

  locks.acquire(project, 'src/pane1.js', A);
  locks.acquire(project, 'src/pane2.js', A);
  locks.releasePane('A');
  const p1 = locks.acquire(project, 'src/pane1.js', B);
  const p2 = locks.acquire(project, 'src/pane2.js', B);
  check(p1.ok === true && p2.ok === true, "releasePane(A) frees all of A's locks everywhere");
  locks.releasePane('B'); // clean up for later sections
}

// --- list() ---
{
  const project = proj1;
  locks.acquire(project, 'src/listed.js', A);
  const rows = locks.list(project);
  const row = rows.find(r => r.file === 'src/listed.js');
  check(
    !!row && row.paneId === 'A' && row.name === 'Nova' && row.provider === 'Claude Code',
    "list() reports the holder's name and provider"
  );
  locks.release(project, ['src/listed.js'], 'A');
}

// --- send('locks:changed', {project}) fires on changes ---
{
  const project = proj1;
  const before = changesFor(project);
  locks.acquire(project, 'src/change.js', A);
  check(changesFor(project) > before, 'send("locks:changed") fires when a lock is taken');
  const before2 = changesFor(project);
  locks.release(project, ['src/change.js'], 'A');
  check(changesFor(project) > before2, 'send("locks:changed") fires when a lock is released');
}

// --- Different projects don't collide ---
{
  locks.acquire(proj1, 'src/shared.js', A);
  const other = locks.acquire(proj2, 'src/shared.js', B);
  check(
    other && other.ok === true,
    'the same relative path in a different project is a separate lock'
  );
}

// diskChanges asks the disk and git off the main process and applies the batch afterwards, so from
// here on each call is awaited.
(async () => {
  // --- Shell-command edits, caught after the fact from the project watcher (diskChanges) ---
  {
    locks._test.reset();
    notifyCalls.length = 0;
    familyPairs.clear();
    const P = proj1,
      C = { paneId: 'C', name: 'Ash', provider: 'Claude Code' };
    const own = o => ({ ...o, project: P }),
      tick = ms => {
        t += ms;
      };
    const to = id => notifyCalls.filter(([p]) => p === id).map(([, x]) => x);
    locks.acquire(P, 'src/held.js', { ...A, edit: true }); // A holds it through its edit hook
    tick(10e3);
    locks.shellStart('B', 'b1', own(B));
    await locks.diskChanges(P, [{ path: 'src/held.js', type: 'change', at: t }]);
    check(
      to('A').length === 1 &&
        /src\/held\.js/.test(to('A')[0]) &&
        /Kai/.test(to('A')[0]) &&
        /inferred/.test(to('A')[0]),
      "held file changed during B's shell command: holder A told it was Kai (inferred)"
    );
    check(
      to('B').length === 1 &&
        /may have changed src\/held\.js/.test(to('B')[0]) &&
        /Nova/.test(to('B')[0]),
      'B told its command may have changed a file Nova holds'
    );
    await locks.diskChanges(P, [{ path: 'src/held.js', type: 'change', at: t }]);
    check(to('A').length === 1 && to('B').length === 1, 'the same file alerts once per 10 min');
    locks.shellEnd('B', 'b1');

    // The holder's own edit (lock just refreshed) and the holder's own command stay quiet.
    notifyCalls.length = 0;
    locks.acquire(P, 'src/mine.js', { ...A, edit: true });
    await locks.diskChanges(P, [{ path: 'src/mine.js', type: 'change', at: t }]);
    tick(10e3);
    locks.shellStart('A', 'a1', own(A));
    await locks.diskChanges(P, [{ path: 'src/mine.js', type: 'change', at: t }]);
    locks.shellEnd('A', 'a1');
    check(
      notifyCalls.length === 0,
      "the holder's own edit or shell command changing its file tells nobody"
    );

    // Nobody's command ran: an edit-hook holder hears it wasn't its change; a `tnai lock` holder
    // (own edits unseen) hears nothing.
    tick(10e3);
    notifyCalls.length = 0;
    await locks.diskChanges(P, [{ path: 'src/mine.js', type: 'change', at: t }]);
    check(
      to('A').length === 1 && /not through your own edits/.test(to('A')[0]),
      'change with no command running: edit-hook holder told it was not its own'
    );
    locks.acquire(P, 'src/codex.js', C);
    tick(10e3);
    notifyCalls.length = 0;
    await locks.diskChanges(P, [{ path: 'src/codex.js', type: 'change', at: t }]);
    check(
      notifyCalls.length === 0,
      "a `tnai lock` holder's file changing with no command running tells nobody"
    );

    // A free file changed while exactly one agent's command runs is locked to it; two agents'
    // commands at once lock nothing.
    locks.shellStart('B', 'b2', own(B));
    await locks.diskChanges(P, [{ path: 'src/free.js', type: 'change', at: t }]);
    check(
      locks.list(P).find(l => l.file === 'src/free.js')?.paneId === 'B',
      "free file changed during B's command is locked to B"
    );
    locks.shellStart('C', 'c1', own(C));
    await locks.diskChanges(P, [{ path: 'src/both.js', type: 'change', at: t }]);
    check(
      !locks.list(P).some(l => l.file === 'src/both.js'),
      "two agents' commands running at once: no lock guessed"
    );
    locks.shellEnd('C', 'c1');
    tick(locks.SETTLE_MS);
    const many = Object.assign([{ path: 'src/gen.js', type: 'change', at: t }], { many: true });
    await locks.diskChanges(P, many);
    check(
      !locks.list(P).some(l => l.file === 'src/gen.js'),
      'a folded batch (install/build) locks nothing'
    );

    // Another agent's atomic-save temp file and a folder the watcher reports never lock to the
    // agent whose command runs.
    tick(locks.SETTLE_MS + 1);
    fs.mkdirSync(path.join(P, 'src', 'scripts'), { recursive: true });
    await locks.diskChanges(P, [
      { path: 'src/scripts/51-next.js.tmp.30400.dd40f7302885', type: 'rename', at: t },
      { path: 'src/scripts', type: 'change', at: t },
      { path: 'src/real.js', type: 'change', at: t },
    ]);
    check(
      !locks.list(P).some(l => /\.tmp\.|^src\/scripts$/.test(l.file)) &&
        locks.list(P).some(l => l.file === 'src/real.js' && l.paneId === 'B'),
      'editor temp files and folders lock nothing; the real file beside them still does'
    );

    // Only content edits count: Windows' watcher also reports reads (last-access time) and
    // attribute marks (OneDrive) as 'change'.
    const old = new Date(Date.now() - 3 * 3600e3),
      put = (f, s) => fs.writeFileSync(path.join(P, f), s);
    put('src/read.js', 'x');
    fs.utimesSync(path.join(P, 'src/read.js'), old, old);
    put('src/moved.js', 'x');
    fs.utimesSync(path.join(P, 'src/moved.js'), old, old);
    put('src/written.js', 'x');
    await locks.diskChanges(P, [
      { path: 'src/read.js', type: 'change', at: Date.now() },
      { path: 'src/written.js', type: 'change', at: Date.now() },
      { path: 'src/moved.js', type: 'rename', at: Date.now() },
    ]);
    check(
      !locks.list(P).some(l => l.file === 'src/read.js'),
      "a file only read (unchanged mtime, e.g. grep/cat) during B's command is not locked"
    );
    check(
      ['src/written.js', 'src/moved.js'].every(
        f => locks.list(P).find(l => l.file === f)?.paneId === 'B'
      ),
      "a file B's command wrote or moved in is still locked to B"
    );
    notifyCalls.length = 0;
    locks.acquire(P, 'src/aedit.js', { ...A, edit: true });
    put('src/aedit.js', 'y');
    await locks.diskChanges(P, [
      { path: 'src/aedit.js', type: 'rename', at: Date.now() },
      { path: 'src/aedit.js.tmp.32952.80648289bcbd', type: 'rename', at: Date.now() },
    ]);
    check(
      locks.list(P).find(l => l.file === 'src/aedit.js')?.paneId === 'A' &&
        !locks.list(P).some(l => /\.tmp\./.test(l.file)) &&
        notifyCalls.length === 0,
      "A's own Edit (and its temp file) during B's command stays A's, nobody told"
    );

    // Git-ignored generated output (test screenshots) never locks or notifies, even a file someone
    // holds.
    require('child_process').spawnSync('git', ['init', '-q'], { cwd: P, windowsHide: true });
    put('.gitignore', 'out/\n');
    fs.mkdirSync(path.join(P, 'out'), { recursive: true });
    put('out/shot.png', 'x');
    put('src/kept.js', 'x');
    await locks.diskChanges(P, [
      { path: 'out/shot.png', type: 'change', at: Date.now() },
      { path: 'src/kept.js', type: 'change', at: Date.now() },
    ]);
    check(
      !locks.list(P).some(l => l.file === 'out/shot.png') &&
        locks.list(P).find(l => l.file === 'src/kept.js')?.paneId === 'B',
      "a git-ignored file changed during B's command is not locked; a tracked one beside it still is"
    );
    locks.acquire(P, 'out/held.png', { ...A, edit: true });
    tick(10e3);
    put('out/held.png', 'y');
    notifyCalls.length = 0;
    await locks.diskChanges(P, [{ path: 'out/held.png', type: 'change', at: Date.now() }]);
    check(
      notifyCalls.length === 0,
      "a held git-ignored file changed during B's command tells nobody"
    );
    locks.release(P, ['out/held.png'], 'A');
    locks.shellEnd('B', 'b2');

    // Timing: a change just after the command ended still counts; later ones don't; a hung call
    // ends at its own timeout; Stop ends all.
    tick(500);
    notifyCalls.length = 0;
    await locks.diskChanges(P, [{ path: 'src/late.js', type: 'change', at: t }]);
    check(
      locks.list(P).find(l => l.file === 'src/late.js')?.paneId === 'B',
      'watcher event right after the command ended still counts'
    );
    tick(locks.SETTLE_MS);
    await locks.diskChanges(P, [{ path: 'src/after.js', type: 'change', at: t }]);
    check(
      !locks.list(P).some(l => l.file === 'src/after.js'),
      'change after the command settled is not attributed'
    );
    locks.shellStart('B', 'b3', own(B), 5000);
    tick(8000);
    await locks.diskChanges(P, [{ path: 'src/hung.js', type: 'change', at: t }]);
    check(
      !locks.list(P).some(l => l.file === 'src/hung.js'),
      'a command with no end event stops counting after its own timeout'
    );
    locks.shellStart('B', 'b4', own(B));
    locks.shellStop('B');
    tick(locks.SETTLE_MS);
    await locks.diskChanges(P, [{ path: 'src/stopped.js', type: 'change', at: t }]);
    check(
      !locks.list(P).some(l => l.file === 'src/stopped.js'),
      'turn end (Stop) ends its commands'
    );

    // Family (lead tree) shares; exempt ledgers, lanes and other projects are ignored.
    familyPairs.add('A|B');
    tick(20 * 60e3);
    notifyCalls.length = 0;
    locks.acquire(P, 'src/team.js', { ...A, edit: true });
    tick(10e3);
    locks.shellStart('B', 'b5', own(B));
    await locks.diskChanges(P, [
      { path: 'src/team.js', type: 'change', at: t },
      { path: 'docs/RELEASE_QUEUE.md', type: 'change', at: t },
    ]);
    await locks.diskChanges(P, [{ path: 'src/team.js', type: 'change', at: t, lane: { id: 'x' } }]);
    await locks.diskChanges(proj2, [{ path: 'src/team.js', type: 'change', at: t }]);
    check(
      notifyCalls.length === 0,
      'lead-tree command on a shared lock, exempt ledgers, lanes and other projects tell nobody'
    );
    check(
      !locks.list(P).some(l => /release_queue/i.test(l.file)),
      'exempt ledger never locked by a command'
    );
    locks.shellEnd('B', 'b5');
    familyPairs.clear();
    locks.releasePane('B');
    await locks.diskChanges(P, [{ path: 'src/gone.js', type: 'change', at: t }]);
    check(
      !locks.list(P).some(l => l.file === 'src/gone.js'),
      "a closed panel's commands are forgotten"
    );
  }

  // --- Team mode (desktop/agent-teams.js): only a user-set team shares locks; a whole-file rewrite
  // stays exclusive for WHOLE_MS ---
  {
    const teams = require('../../desktop/agent-teams'),
      tick = ms => {
        t += ms;
      };
    const peers = require('../../desktop/agent-peers');
    teams._test.reset();
    const changes = [];
    teams.init(st => changes.push(st));

    // main.js: family = lead tree OR same team; team = same team but not the same tree
    const tree = (a, b) => familyPairs.has(a + '|' + b) || familyPairs.has(b + '|' + a);
    const same = (a, b) => !!teams.teamOf(a) && teams.teamOf(a) === teams.teamOf(b) && !tree(a, b);
    familyImpl = (a, b) => tree(a, b) || same(a, b);
    teamImpl = same;
    tick(30 * 60e3);
    notifyCalls.length = 0;
    const P = proj1,
      E = { ...A, edit: true },
      F = { ...B, edit: true };
    check(locks.acquire(P, 'src/t1.js', E).ok, 'team: A edits src/t1.js');
    check(
      locks.acquire(P, 'src/t1.js', F).ok === false,
      "no team: separately started B is refused A's file"
    );
    check(notifyCalls.length === 1, 'no team: the holder hears once');
    notifyCalls.length = 0;
    teams.set('A', ['B']);
    check(
      changes.length === 1 && teams.mates('A').join() === 'B',
      "grouping A + B fires one change; A's teammate is B"
    );
    tick(1000);
    check(
      locks.acquire(P, 'src/t1.js', F).ok === true,
      'team: B may make a small edit to the file A holds'
    );
    check(
      locks.acquire(P, 'src/t1.js', E).ok === true,
      'team: A may edit it again after B (side by side)'
    );
    const rw = locks.acquire(P, 'src/t1.js', { ...F, whole: true });
    check(
      rw.ok === false && rw.team === true && /whole-file rewrite/.test(rw.text),
      "team: B's whole-file Write of a file A just edited is refused"
    );
    check(
      locks.acquire(P, 'src/t2.js', { ...E, whole: true }).ok,
      'team: A rewrites src/t2.js whole'
    );
    tick(30e3);
    const ed = locks.acquire(P, 'src/t2.js', F);
    check(
      ed.ok === false && /rewritten whole/.test(ed.text),
      "team: B's edit within 2 min of A's whole-file rewrite is refused"
    );
    check(
      locks.acquire(P, 'src/t2.js', { ...E, whole: true }).ok,
      'team: A may rewrite its own file again'
    );
    tick(locks.WHOLE_MS + 1000);
    check(
      locks.acquire(P, 'src/t2.js', F).ok === true,
      "team: after the window B's small edit goes through"
    );
    check(notifyCalls.length === 0, "team refusals and shared edits don't alert anyone");

    // what each member is told
    const note = peers.teamNotice('A', ['Kai']);
    check(
      /team with Kai/.test(note) && /tnai send/.test(note) && /Write/.test(note),
      'teammate notice names the teammate, tnai send and the Write rule'
    );

    // ungroup: blocking returns
    teams.set('A', []);
    check(
      teams.state().teams.length === 0 && changes.length === 2,
      'ungrouping ends the team (one change)'
    );
    tick(1000);
    check(
      locks.acquire(P, 'src/t2.js', E).ok === false,
      'after ungrouping, A is refused the file B now holds'
    );
    check(
      /off your team/.test(peers.teamNotice('A', [])),
      'leaving notice says locks are its own again'
    );

    // a closed panel leaves; a team of one ends
    teams.set('A', ['B']);
    teams.forget('B');
    check(
      teams.state().teams.length === 0 && !teams.teamOf('A'),
      "closing a member's panel ends a two-agent team"
    );
    teams.set('A', ['B', 'C']);
    teams.forget('C');
    check(teams.mates('A').join() === 'B', 'a three-agent team keeps the two left');
    teams.set('C', ['B']);
    check(
      teams.mates('A').length === 0 && teams.mates('B').join() === 'C',
      "a panel is on one team only (moving B ends A's team of one)"
    );
    teams._test.reset();
    familyImpl = tree;
    teamImpl = () => false;
    locks.releasePane('A');
    locks.releasePane('B');
  }

  // --- One lead tree in separate panels (a lead and its Technically Not sub-agents): shared locks,
  // but a whole-file rewrite stays exclusive for WHOLE_MS ---
  {
    const P = proj1,
      tick = ms => {
        t += ms;
      },
      S1 = { paneId: 'S1', name: 'Kite', provider: 'Claude Code' },
      S2 = { paneId: 'S2', name: 'Moss', provider: 'Claude Code' };
    familyPairs.add('S1|S2');
    treeImpl = (a, b) => familyPairs.has(a + '|' + b) || familyPairs.has(b + '|' + a);
    check(
      locks.acquire(P, 'src/shared.js', { ...S1, edit: true }).ok &&
        locks.acquire(P, 'src/shared.js', { ...S2, edit: true }).ok,
      'lead tree: small edits side by side'
    );
    let r = locks.acquire(P, 'src/shared.js', { ...S1, edit: true, whole: true });
    check(
      !r.ok &&
        /an agent of your own lead tree Moss/.test(r.text) &&
        /Within one lead tree small edits/.test(r.text),
      'lead tree: no whole-file rewrite of a file another agent of the tree just edited (' +
        (r.text || '').slice(0, 90) +
        ')'
    );
    tick(locks.WHOLE_MS || 2 * 60e3);
    check(
      locks.acquire(P, 'src/shared.js', { ...S1, edit: true, whole: true }).ok,
      'lead tree: the rewrite is allowed once the other edit is ' + 2 + ' min old'
    );
    r = locks.acquire(P, 'src/shared.js', { ...S2, edit: true });
    check(
      !r.ok && /was just rewritten whole by an agent of your own lead tree Kite/.test(r.text),
      'lead tree: no edit of a file just rewritten whole'
    );
    tick(2 * 60e3);
    check(
      locks.acquire(P, 'src/shared.js', { ...S2, edit: true }).ok,
      'lead tree: edits again after ' + 2 + ' min'
    );
    const O = { paneId: 'O', name: 'Opal', provider: 'Codex' };
    check(
      !locks.acquire(P, 'src/shared.js', { ...O, edit: true }).ok,
      'an agent outside the tree is still blocked'
    );
    familyPairs.clear();
    treeImpl = () => false;
    locks.releasePane('S1');
    locks.releasePane('S2');
  }

  // --- Who waits for a file: shown while it is true, gone when the agent stopped waiting ---
  {
    const P = proj1;
    const H = { paneId: 'WH', name: 'Holder', provider: 'Claude Code' };
    const W = { paneId: 'WW', name: 'Waiter', provider: 'Claude Code' };
    const X = { paneId: 'WX', name: 'Third', provider: 'Codex' };
    const waiterOf = file => locks.list(P).find(l => l.file === file)?.wanted?.name || '';
    const pushes = () => events.filter(e => e[0] === 'locks:changed').length;
    const tick = ms => {
      t += ms;
    };

    locks.acquire(P, 'src/wait-a.js', { ...H, edit: true });
    check(waiterOf('src/wait-a.js') === '', 'waiter: nobody waits for a file nobody was refused');
    check(!locks.acquire(P, 'src/wait-a.js', W).ok, 'waiter: the second agent is refused');
    check(waiterOf('src/wait-a.js') === 'Waiter', 'waiter: the refused agent is shown as waiting');

    // the holder goes on editing: the other agent still waits
    tick(60e3);
    locks.acquire(P, 'src/wait-a.js', { ...H, edit: true });
    check(
      waiterOf('src/wait-a.js') === 'Waiter',
      'waiter: still shown after the holder edited the file again'
    );

    // a rename reaches the waiting name too
    locks.setNames([{ paneId: 'WW', name: 'Waiter Two' }]);
    check(
      waiterOf('src/wait-a.js') === 'Waiter Two',
      'waiter: a renamed agent waits by its new name'
    );
    locks.setNames([{ paneId: 'WW', name: 'Waiter' }]);

    // it edits another file: it gave this one up
    let before = pushes();
    check(
      locks.acquire(P, 'src/wait-b.js', { ...W, edit: true }).ok,
      'waiter: it takes another file'
    );
    check(waiterOf('src/wait-a.js') === '', 'waiter: gone once the agent edits another file');
    check(pushes() > before, 'waiter: the views are told (locks:changed)');

    // its panel closes while it waits
    locks.acquire(P, 'src/wait-a.js', W);
    check(waiterOf('src/wait-a.js') === 'Waiter', 'waiter: refused again, shown again');
    before = pushes();
    locks.releasePane('WW');
    check(waiterOf('src/wait-a.js') === '', 'waiter: gone once the waiting agent’s panel closed');
    check(pushes() > before, 'waiter: the views are told when the panel closed');
    check(
      locks.list(P).some(l => l.file === 'src/wait-a.js' && l.paneId === 'WH'),
      'waiter: the holder keeps its lock when the waiting panel closes'
    );

    // it gets the file: the holder let it go, the waiter takes it, and nobody waits
    locks.acquire(P, 'src/wait-a.js', W);
    locks.release(P, ['src/wait-a.js'], 'WH');
    check(locks.acquire(P, 'src/wait-a.js', { ...W, edit: true }).ok, 'waiter: it gets the file');
    check(waiterOf('src/wait-a.js') === '', 'waiter: the new holder is not shown as waiting');

    // a wait in another project is not ended by a file taken in this one
    locks.acquire(proj2, 'src/far.js', { ...H, edit: true });
    locks.acquire(proj2, 'src/far.js', X);
    locks.acquire(P, 'src/wait-c.js', { ...X, edit: true });
    check(
      locks.list(proj2).find(l => l.file === 'src/far.js')?.wanted?.name === 'Third',
      'waiter: taking a file in one project does not end a wait in another'
    );

    // only the last refused agent is shown, and another agent’s edits do not end its wait
    locks.acquire(P, 'src/wait-d.js', { ...H, edit: true });
    locks.acquire(P, 'src/wait-d.js', X);
    locks.acquire(P, 'src/wait-e.js', { ...H, edit: true });
    check(
      waiterOf('src/wait-d.js') === 'Third',
      'waiter: the holder taking another file does not end the other agent’s wait'
    );

    // time alone never ends a wait: it goes with the lock
    tick(19 * 60e3);
    check(waiterOf('src/wait-d.js') === 'Third', 'waiter: still shown after 19 quiet minutes');
    locks.releasePane('WH');
    locks.releasePane('WW');
    locks.releasePane('WX');
    check(
      !locks.list(P).some(l => /^src\/wait-/.test(l.file)) && !locks.list(proj2).length,
      'waiter: nothing left after the panels closed'
    );
  }

  console.log(ok ? '\nAll file-lock checks passed.' : '\nSome file-lock checks FAILED.');
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  } catch {}
  process.exit(ok ? 0 : 1);
})();
