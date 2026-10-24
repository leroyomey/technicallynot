// Test of the Board page's data (src/scripts/156-board-columns.js, desktop/board-ideas.js and the
// run history of desktop/prompt-schedules.js): node tools/board-test.js
//
// Which column a thread stands in by its live status, the ideas kept per project (atomic file,
// backup, a broken file moved aside), each schedule's run history (done, skipped, failed, missed,
// kept 30 days), a one-time schedule from an idea dropped on a day, and an idea started as a
// thread through the schedules' own start. Plain Node with a fake clock and stand-ins for the
// window and the agents: no window opens, no CLI starts.
'use strict';
process.env.TZ = 'America/New_York';
for (const key of Object.keys(process.env)) if (/^TNAI_/.test(key)) delete process.env[key];

const fs = require('fs');
const os = require('os');
const path = require('path');
const columns = require('../src/scripts/156-board-columns.js');
const { createIdeas } = require('../desktop/board-ideas');
const { createSchedules, nextRun, cleanWhen } = require('../desktop/prompt-schedules');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------- status → column
{
  const now = local(2026, 10, 16, 15, 0);
  const col = facts => columns.columnOf(facts, now);
  check(
    'five columns in order',
    columns.COLUMNS.map(c => c.id).join() === 'next,work,needs,review,done'
  );
  check('working', col({ status: 'working' }) === 'work');
  check('starting counts as working', col({ status: 'starting' }) === 'work');
  check('waiting on agents counts as working', col({ status: 'waiting-agents' }) === 'work');
  check('a question → Needs you', col({ status: 'working', needs: true }) === 'needs');
  check(
    'an open decision → Needs you',
    col({ status: 'done', decision: { question: 'Keep it?' } }) === 'needs'
  );
  check(
    'finished with changes → Ready for review',
    col({ status: 'done', changes: { files: 2 }, endedAt: now - 1000 }) === 'review'
  );
  check(
    'merged pull request is not for review',
    col({ status: 'done', changes: { files: 2, pr: { state: 'MERGED' } }, endedAt: now }) === 'done'
  );
  check(
    'ended today → Done today',
    col({ status: 'waiting', endedAt: local(2026, 10, 16, 8) }) === 'done'
  );
  check('ended yesterday → no column', col({ status: 'waiting', endedAt: now - DAY }) === '');
  check(
    'started today, never ended → Done today',
    col({ status: 'exited', startedAt: now - 3600000 }) === 'done'
  );
  check('nothing → no column', col(null) === '');
}

// ---------------------------------------------------------------- the ideas store
const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-board-'));
const projectA = path.join(tmp, 'project-a');
const projectB = path.join(tmp, 'project-b');
fs.mkdirSync(projectA);
fs.mkdirSync(projectB);
{
  const dir = path.join(tmp, 'ideas');
  const ideas = createIdeas(dir);
  check('empty at first', ideas.list(projectA).length === 0);
  check('empty idea refused', !ideas.add(projectA, '   ').ok);
  const one = ideas.add(projectA, 'Dark mode for the settings form');
  const two = ideas.add(projectA, '  Retry   the upload\nqueue ');
  ideas.add(projectB, 'Only in B');
  check('added', one.ok && two.ok);
  check('newest first, cleaned', ideas.list(projectA)[0].text === 'Retry the upload queue');
  check('per project', ideas.list(projectB).length === 1 && ideas.list(projectA).length === 2);
  check('same folder written another way', ideas.list(projectA + path.sep).length === 2);
  check('removed', ideas.remove(projectA, one.idea.id).ok && ideas.list(projectA).length === 1);

  // read back by a new store, backup kept, a broken file moved aside
  const again = createIdeas(dir);
  check('read back', again.list(projectA)[0]?.text === 'Retry the upload queue');
  check('backup kept', fs.existsSync(path.join(dir, 'board-ideas.backup.json')));
  fs.writeFileSync(path.join(dir, 'board-ideas.json'), '{ broken');
  const broken = createIdeas(dir);
  check('broken file: backup read', broken.list(projectB).length === 1);
  check(
    'broken file kept aside',
    fs.readdirSync(dir).some(f => f.startsWith('board-ideas.broken-'))
  );
  check('no temp files left', !fs.readdirSync(dir).some(f => f.endsWith('.tmp')));
}

// ---------------------------------------------------------------- one-time schedules
{
  const when = cleanWhen({ kind: 'once', date: '2026-10-19', time: '09:00' });
  check('once accepted', !when.error && when.date === '2026-10-19', JSON.stringify(when));
  check('bad day refused', !!cleanWhen({ kind: 'once', date: '2026-02-30', time: '09:00' }).error);
  const due = nextRun(when, local(2026, 10, 16, 12));
  check('once runs on its day', due === local(2026, 10, 19, 9, 0));
  check('once never again', nextRun(when, due) === 0);
}

// ---------------------------------------------------------------- run history and idea starts
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
};

(async () => {
  const h = { clock: local(2026, 10, 14, 8, 0), spawns: [], submits: [], busy: new Set() };
  let pane = 0;
  const s = createSchedules({
    dir: path.join(tmp, 'schedules'),
    send: () => {},
    projects: async () => [projectA, projectB],
    openProject: () => projectA,
    agents: () => ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'],
    resolveModel: async (agent, model) => ({ model }),
    spawn: async (agent, pick, name, extra) => {
      h.spawns.push({ agent, name, extra, folder: s.takeFolder(extra.schedule, agent) });
      pane++;
      return { paneId: 'pane-' + pane };
    },
    submit: async (paneId, text) => {
      h.submits.push({ paneId, text });
      return { ok: true };
    },
    note: () => {},
    busy: paneId => h.busy.has(paneId),
    now: () => h.clock,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
  });
  s.start();
  const saved = await s.save({
    name: 'Triage new issues',
    folder: projectA,
    agent: 'Claude Code',
    prompt: 'Go through the new issues.',
    when: { kind: 'daily', time: '08:30' },
  });
  s.setEnabled(saved.id, true);
  const item = () => s.list().find(one => one.id === saved.id);

  // Wed 08:30: done.
  h.clock = local(2026, 10, 14, 8, 30) + 1000;
  s.tick();
  await settle();
  check(
    'done run in history',
    item().runs.at(-1)?.state === 'done' && item().runs.at(-1).paneId === 'pane-1'
  );

  // Thu 08:30: its thread still works → skipped.
  h.busy.add('pane-1');
  h.clock = local(2026, 10, 15, 8, 30) + 1000;
  s.tick();
  await settle();
  check('skipped run in history', item().runs.at(-1)?.state === 'skipped');
  h.busy.clear();

  // Closed from Thu evening to Sun noon: Fri, Sat, Sun 08:30 missed, each in the history.
  h.clock = local(2026, 10, 18, 12, 0);
  s.tick();
  await settle();
  const missed = item()
    .runs.filter(run => run.state === 'missed')
    .map(run => run.at);
  check(
    'every missed time recorded',
    missed.length === 3 &&
      missed[0] === local(2026, 10, 16, 8, 30) &&
      missed[2] === local(2026, 10, 18, 8, 30),
    JSON.stringify(missed.map(at => new Date(at).toString()))
  );
  check('missed mark is the newest', item().missedAt === local(2026, 10, 18, 8, 30));

  // A run that fails is recorded as failed.
  const brokenFolder = await s.save({
    name: 'Gone project',
    folder: projectB,
    agent: 'Codex',
    prompt: 'x',
    when: { kind: 'daily', time: '10:00' },
  });
  const gone = s.list().find(one => one.id === brokenFolder.id);
  gone.folder = path.join(tmp, 'removed');
  await s.runNow(brokenFolder.id);
  check('failed run in history', gone.runs.at(-1)?.state === 'failed');

  // The view lists coming times for the Week.
  const view = await s.view();
  const shown = view.schedules.find(one => one.id === saved.id);
  check(
    'coming runs listed',
    shown.upcoming.length >= 7 && shown.upcoming[0] === local(2026, 10, 19, 8, 30),
    String(shown.upcoming[0] && new Date(shown.upcoming[0]))
  );

  // History older than 30 days is dropped.
  h.clock = local(2026, 11, 20, 8, 30) + 1000;
  await s.runNow(saved.id);
  check(
    'history keeps 30 days',
    item().runs.every(run => run.at >= h.clock - 30 * DAY),
    String(item().runs.length)
  );

  // An idea dropped on a day: a one-time schedule, switched on.
  const once = await s.createOnce({
    name: 'Dark mode for the settings form',
    folder: projectA,
    agent: 'Codex',
    prompt: 'Dark mode for the settings form',
    date: '2026-11-23',
  });
  const made = s.list().find(one => one.id === once.id);
  check(
    'one-time schedule made and on',
    once.ok && made.enabled && made.when.kind === 'once' && made.when.time === '09:00'
  );

  // An idea dragged into Working: a new thread in its project, through the schedules' start.
  const before = h.spawns.length;
  const started = await s.startPrompt({ folder: projectB, agent: 'OpenCode', prompt: 'Only in B' });
  const spawn = h.spawns[before];
  check('idea starts a thread', started.ok && spawn?.agent === 'OpenCode' && spawn.name === '');
  check('in its own project folder', spawn?.folder === projectB);
  check('idea words typed in', h.submits.at(-1)?.text === 'Only in B');
  const refused = await s.startPrompt({
    folder: path.join(tmp, 'elsewhere'),
    agent: 'Codex',
    prompt: 'x',
  });
  check('folder outside projects refused', !refused.ok);
  const noCli = await s.startPrompt({ folder: projectA, agent: 'GitHub Copilot', prompt: 'x' });
  check('a CLI that cannot start a thread refused', !noCli.ok);

  // The history survives a restart.
  const again = createSchedules({
    dir: path.join(tmp, 'schedules'),
    projects: async () => [projectA],
    now: () => h.clock,
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {},
  });
  again.start();
  check(
    'history read back',
    (again.list().find(one => one.id === saved.id)?.runs || []).length > 0
  );

  // Board round 2: the column order the user dragged, and groups in a column.
  const ids = list => list.map(column => column.id).join(',');
  check('no saved order: the usual one', ids(columns.ordered()) === 'next,work,needs,review,done');
  check(
    'a saved order is kept',
    ids(columns.ordered(['done', 'work', 'next', 'needs', 'review'])) ===
      'done,work,next,needs,review'
  );
  check(
    'unknown and doubled ids dropped, a missing column comes back in its place',
    ids(columns.ordered(['work', 'gone', 'work', 'done', 'next'])) === 'work,needs,review,done,next'
  );
  const thread = (id, name, tool, lead = '') => ({ thread: { id, name, tool, lead } });
  const working = [
    thread('h1', 'Ion', 'Claude Code', 'L'),
    thread('L', 'Lead', 'Claude Code'),
    thread('h2', 'Pulse', 'Claude Code', 'L'),
    thread('p', 'Pinball', 'Claude Code'),
    thread('n', 'Nyx', 'Codex'),
  ];
  const team = columns.groupsOf(working, 'team');
  check('a lead and its helpers make one group', team[0].label === 'Lead and helpers');
  check(
    'the lead comes first in its group',
    team[0].cards.map(card => card.thread.name).join(',') === 'Lead,Ion,Pulse'
  );
  check('threads on their own stay single cards', team.length === 3 && !team[1].key);
  const helperAlone = columns.groupsOf([thread('h1', 'Ion', 'Claude Code', 'L')], 'team');
  check('a helper whose lead is elsewhere is a single card', !helperAlone[0].key);
  const tools = columns.groupsOf(working, 'tool');
  check(
    'by tool: one group of four, Codex alone',
    tools[0].cards.length === 4 && tools[0].label === 'Claude Code' && !tools[1].key
  );
  check(
    'none: every card on its own',
    columns.groupsOf(working, 'none').every(g => !g.key)
  );

  // the page uses them, and keeps the layout per user
  const pageCode = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'scripts', '157-board-page.js'),
    'utf8'
  );
  check(
    'the page draws columns in the saved order and groups their cards',
    /columnsKit\s*\.ordered\(board\.order\)/.test(pageCode) &&
      /columnsKit\.groupsOf\(list, board\.groupBy\)/.test(pageCode) &&
      /LAYOUT_KEY/.test(pageCode)
  );

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log((failed ? 'FAILED' : 'OK') + ': ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('FAIL ' + (error?.stack || error));
  process.exit(1);
});
