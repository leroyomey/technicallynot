// Test of scheduled prompts (desktop/prompt-schedules.js): node tools/prompt-schedules-test.js
//
// Next run times (every N minutes, hourly, daily, weekdays, chosen days) in local time across both
// summer time changes, the missed-run mark, no second run while the last thread still works, the
// start mark that gives pty:start the schedule's folder, and the saved file (atomic write, backup,
// a broken file moved aside). Plain Node with a fake clock and stand-ins for the window and the
// agents: no window opens, no CLI starts.
'use strict';

// A zone with summer time, set before any date is made, so the test means the same on every PC.
process.env.TZ = 'America/New_York';
for (const key of Object.keys(process.env)) if (/^TNAI_/.test(key)) delete process.env[key];

const fs = require('fs');
const os = require('os');
const path = require('path');
const schedules = require('../desktop/prompt-schedules');
const { nextRun, lastDue, cleanWhen, createSchedules, GRACE_MS } = schedules;

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
const show = ms => new Date(ms).toString();
const HOUR = 3600000;

// ---------------------------------------------------------------- next run times

// The zone really is New York (a summer time change on 2026-03-08 and 2026-11-01).
check(
  'test zone has summer time',
  local(2026, 3, 8, 8, 30) - local(2026, 3, 7, 8, 30) === 23 * HOUR,
  'TZ is not honored on this Node'
);

// Weekdays at 08:30, asked on Friday 2026-10-16 at 09:00 → Monday 08:30.
{
  const due = nextRun({ kind: 'weekdays', time: '08:30' }, local(2026, 10, 16, 9, 0));
  check('weekdays skips the weekend', due === local(2026, 10, 19, 8, 30), show(due));
  const sameDay = nextRun({ kind: 'weekdays', time: '08:30' }, local(2026, 10, 16, 8, 0));
  check('weekdays later the same day', sameDay === local(2026, 10, 16, 8, 30), show(sameDay));
}

// Chosen days: Tuesday and Saturday at 18:00, from Wednesday.
{
  const when = { kind: 'days', days: [2, 6], time: '18:00' };
  const due = nextRun(when, local(2026, 10, 14, 12, 0));
  check('chosen days', due === local(2026, 10, 17, 18, 0), show(due));
  check('no days means never', nextRun({ kind: 'days', days: [], time: '18:00' }, 0) === 0);
}

// Daily at 08:30 across the spring change: 23 hours apart, still 08:30 local.
{
  const when = { kind: 'daily', time: '08:30' };
  const first = nextRun(when, local(2026, 3, 6, 9, 0));
  const second = nextRun(when, first);
  check('daily spring first', first === local(2026, 3, 7, 8, 30), show(first));
  check('daily spring 23 h', second - first === 23 * HOUR, show(second));
  check('daily spring stays 08:30', new Date(second).getHours() === 8);
}

// Daily at 08:30 across the autumn change: 25 hours apart.
{
  const when = { kind: 'daily', time: '08:30' };
  const first = nextRun(when, local(2026, 10, 30, 9, 0));
  const second = nextRun(when, first);
  check('daily autumn 25 h', second - first === 25 * HOUR, show(first) + ' → ' + show(second));
}

// Daily at 02:30, a time the spring change skips: it runs once that day (03:30) and at 02:30 after.
{
  const when = { kind: 'daily', time: '02:30' };
  const before = nextRun(when, local(2026, 3, 6, 3, 0));
  const skipped = nextRun(when, before);
  const after = nextRun(when, skipped);
  check('skipped hour runs once', skipped > before && after > skipped, show(skipped));
  check('skipped hour moves on', new Date(skipped).getHours() === 3, show(skipped));
  check('next day back at 02:30', new Date(after).getHours() === 2, show(after));
}

// Daily at 01:30 on the autumn day, when 01:30 happens twice: only one run.
{
  const when = { kind: 'daily', time: '01:30' };
  const first = nextRun(when, local(2026, 10, 31, 12, 0));
  const second = nextRun(when, first);
  check('repeated hour runs once', second - first >= 24 * HOUR, show(first) + ' → ' + show(second));
}

// Hourly at :15 through the autumn change: always later, never the same moment twice, at :15.
{
  const when = { kind: 'hourly', minute: 15 };
  let at = local(2026, 10, 31, 22, 0);
  const seen = new Set();
  let ok = true;
  for (let i = 0; i < 10; i++) {
    const due = nextRun(when, at);
    if (!(due > at) || seen.has(due) || new Date(due).getMinutes() !== 15) ok = false;
    seen.add(due);
    at = due;
  }
  check('hourly through autumn change', ok);
}

// Every 15 minutes counts from its anchor; under 15 is refused.
{
  const anchor = local(2026, 10, 16, 9, 7);
  const due = nextRun({ kind: 'every', minutes: 15 }, anchor + 20 * 60000, anchor);
  check('every 15 from anchor', due === anchor + 30 * 60000, show(due));
  check('every 10 refused', !!cleanWhen({ kind: 'every', minutes: 10 }).error);
  check('every 15 allowed', cleanWhen({ kind: 'every', minutes: 15 }).minutes === 15);
  check('bad time refused', !!cleanWhen({ kind: 'daily', time: '25:00' }).error);
}

// lastDue: the latest due time in a span, or 0.
{
  const when = { kind: 'daily', time: '08:30' };
  const due = lastDue(when, local(2026, 10, 10, 9, 0), local(2026, 10, 16, 10, 0));
  check('last due of several', due === local(2026, 10, 16, 8, 30), show(due));
  check('none in span', lastDue(when, local(2026, 10, 16, 9, 0), local(2026, 10, 16, 10, 0)) === 0);
  const every = lastDue(
    { kind: 'every', minutes: 15 },
    local(2026, 10, 1, 0, 0),
    local(2026, 10, 16, 0, 7),
    local(2026, 10, 1, 0, 0)
  );
  check('every: last due by arithmetic', every === local(2026, 10, 16, 0, 0), show(every));
}

// ---------------------------------------------------------------- the scheduler

const tmp = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-schedules-'));
const project = path.join(tmp, 'project-b');
fs.mkdirSync(project);
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
};

function harness(dir) {
  const h = {
    clock: local(2026, 10, 16, 8, 0),
    spawns: [],
    submits: [],
    folders: [],
    busy: new Set(),
    timers: [],
  };
  let pane = 0;
  h.s = createSchedules({
    dir,
    send: () => {},
    projects: async () => [project],
    openProject: () => project,
    agents: () => ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode', 'Gemini CLI'],
    resolveModel: async (agent, model) =>
      model === 'bad' ? { error: 'Unknown model' } : { model },
    spawn: async (agent, pick, name, extra) => {
      h.spawns.push({ agent, pick, name, extra });

      // what pty:start does: takes the mark once
      h.folders.push(h.s.takeFolder(extra.schedule, agent));
      h.folders.push(h.s.takeFolder(extra.schedule, agent));
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
    setTimer: (fn, ms) => {
      h.timers.push(ms);
      return { unref() {} };
    },
    clearTimer: () => {},
  });
  return h;
}

(async () => {
  const dir = path.join(tmp, 'userData');
  const h = harness(dir);
  h.s.start();

  // A new schedule is saved switched off; bad input is refused.
  const refused = await h.s.save({
    name: 'x',
    folder: path.join(tmp, 'elsewhere'),
    agent: 'Codex',
    prompt: 'p',
    when: { kind: 'daily', time: '08:30' },
  });
  check('folder outside projects refused', !refused.ok, JSON.stringify(refused));
  const badCli = await h.s.save({
    name: 'x',
    folder: project,
    agent: 'Gemini CLI',
    prompt: 'p',
    when: { kind: 'daily', time: '08:30' },
  });
  check('CLI that cannot start a thread refused', !badCli.ok);
  const badModel = await h.s.save({
    name: 'x',
    folder: project,
    agent: 'Codex',
    model: 'bad',
    prompt: 'p',
    when: { kind: 'daily', time: '08:30' },
  });
  check('unknown model refused', !badModel.ok);
  const saved = await h.s.save({
    name: 'Morning triage',
    folder: project,
    agent: 'Codex',
    prompt: 'Go through the new issues.',
    when: { kind: 'daily', time: '08:30' },
  });
  check('saved', saved.ok, JSON.stringify(saved));
  const id = saved.id;
  check('off by default', h.s.list()[0].enabled === false);

  // Switched on at 08:00; at 08:30 the timer fires and a run starts.
  h.s.setEnabled(id, true);
  check(
    'one timer for the next run',
    h.timers[h.timers.length - 1] === 30 * 60000,
    String(h.timers)
  );
  h.clock = local(2026, 10, 16, 8, 30, 0) + 5000;
  const started = h.s.tick();
  await settle();
  check('due run starts', started.length === 1 && h.spawns.length === 1);
  check(
    'started with that CLI and name',
    h.spawns[0]?.agent === 'Codex' && h.spawns[0]?.name === 'Morning triage'
  );
  check('start mark gives the folder once', h.folders[0] === project && h.folders[1] === '');
  check('prompt typed in', h.submits[0]?.text === 'Go through the new issues.');
  const last = h.s.list()[0].lastRun;
  check(
    'last run names the thread',
    last?.ok && last.paneId === 'pane-1' && last.thread === 'Morning triage'
  );
  check('mark only for its CLI', h.s.takeFolder('nonsense', 'Codex') === '');

  // The next day its thread still works: skipped, noted, nothing started.
  h.busy.add('pane-1');
  h.clock = local(2026, 10, 17, 8, 30) + 1000;
  h.s.tick();
  await settle();
  check('no second run while working', h.spawns.length === 1);
  check('skip is noted', /^Skipped/.test(h.s.list()[0].lastRun.text), h.s.list()[0].lastRun.text);
  check('skip keeps the thread', h.s.list()[0].lastRun.paneId === 'pane-1');
  const manualBusy = await h.s.runNow(id);
  check('Run now also refuses while working', !manualBusy.ok && h.spawns.length === 1);
  h.busy.delete('pane-1');

  // The app was closed (or the computer slept) over 08:30: missed, not run.
  h.clock = local(2026, 10, 18, 11, 0);
  h.s.tick();
  await settle();
  check('missed is not run', h.spawns.length === 1);
  check(
    'missed is marked',
    h.s.list()[0].missedAt === local(2026, 10, 18, 8, 30),
    show(h.s.list()[0].missedAt)
  );

  // A run reached a little late (within the grace) still runs.
  h.clock = local(2026, 10, 19, 8, 30) + GRACE_MS - 1000;
  h.s.tick();
  await settle();
  check('a little late still runs', h.spawns.length === 2);

  // Run now runs and clears the missed mark.
  const manual = await h.s.runNow(id);
  check('Run now runs', manual.ok && h.spawns.length === 3);
  check('Run now clears missed', h.s.list()[0].missedAt === 0);

  // Switched off: nothing runs.
  h.s.setEnabled(id, false);
  h.clock = local(2026, 10, 20, 8, 30) + 1000;
  h.s.tick();
  await settle();
  check('off does not run', h.spawns.length === 3);

  // ---- the saved file: read back by a new scheduler, backup kept, a broken file moved aside
  const file = path.join(dir, 'prompt-schedules.json');
  const backup = path.join(dir, 'prompt-schedules.backup.json');
  check('file written', fs.existsSync(file));
  check('backup kept', fs.existsSync(backup));
  const again = harness(dir);
  again.s.start();
  const back = again.s.list()[0];
  check(
    'read back',
    back?.id === id && back.name === 'Morning triage' && back.when.time === '08:30'
  );
  check('no temp files left', !fs.readdirSync(dir).some(f => f.endsWith('.tmp')));
  fs.writeFileSync(file, '{ broken');
  const broken = harness(dir);
  broken.s.start();
  check('broken file: backup read', broken.s.list().length === 1);
  check(
    'broken file kept aside',
    fs.readdirSync(dir).some(f => f.startsWith('prompt-schedules.broken-'))
  );

  // Removing it.
  const removed = await again.s.remove(id);
  check('removed', removed.ok && again.s.list().length === 0);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log((failed ? 'FAILED' : 'OK') + ': ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(error => {
  console.log('FAIL ' + (error?.stack || error));
  process.exit(1);
});
