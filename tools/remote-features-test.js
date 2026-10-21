// Technically Not · remote-features-test.js — plain-Node tests of desktop/remote-features.js (plan
// item 45): the three read-only asks another computer may make (a thread's Changes, its CLI's
// skills for the "$" list, the CLIs' sign-in and usage), and every rule of answering and asking.
// Run: node tools/remote-features-test.js
'use strict';
const assert = require('assert');
const {
  createFeatureAnswerer,
  createFeatureReader,
  shapeChanges,
  shapeSkills,
  shapeClis,
  clisFrom,
  ASKS_MIN,
  READ_MS,
  REPLY_MS,
} = require('../desktop/remote-features.js');
const { MAX_PLAIN } = require('../desktop/remote-noise.js');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// A clock and timers the test moves by hand.
function fakeTime() {
  let t = 1_000_000;
  let next = 1;
  const pending = new Map();
  return {
    now: () => t,
    timers: {
      set(fn, ms) {
        const id = next++;
        pending.set(id, { fn, at: t + ms });
        return id;
      },
      clear(id) {
        pending.delete(id);
      },
    },
    advance(ms) {
      t += ms;
      for (const [id, p] of [...pending]) {
        if (p.at <= t) {
          pending.delete(id);
          p.fn();
        }
      }
    },
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

const CHANGES = {
  repo: true,
  folder: 'C:\\Users\\someone\\secret\\project',
  branch: 'feature/x',
  detached: false,
  base: 'main',
  onBase: false,
  since: 'main',
  uncommitted: 2,
  unpushed: 0,
  ahead: 3,
  behind: 1,
  added: 40,
  removed: 7,
  files: 5,
  gh: 'ok',
  pr: {
    number: 12,
    title: 'Add x',
    url: 'https://github.com/a/b/pull/12',
    state: 'open',
    draft: false,
    checks: { total: 3, passed: 2, failed: 1, pending: 0, failedNames: ['lint'] },
  },
};

function answerer(over = {}) {
  const time = fakeTime();
  const sent = [];
  const reads = { changes: 0, skills: 0, clis: 0 };
  const rights = { on: true };
  const a = createFeatureAnswerer({
    now: time.now,
    timers: time.timers,
    may: () => rights.on,
    row: (peer, id) => (id === 'p1' ? { cli: 'Codex' } : null),
    read: {
      changes: () => {
        reads.changes++;
        return CHANGES;
      },
      skills: (id, cli) => {
        reads.skills++;
        return {
          cli,
          skills: [
            { name: 'deploy', insert: '$deploy', about: 'Ship it', from: 'project' },
            { name: 'bad name', about: 'spaces are not one word' },
          ],
        };
      },
      clis: () => {
        reads.clis++;
        return [{ cli: 'Claude Code', installed: true, signedIn: true, plan: 'Max', gauges: [] }];
      },
    },
    send: (to, obj) => sent.push({ to, obj }),
    ...over,
  });
  return { a, time, sent, reads, rights };
}

const N = i => String(i).padStart(16, '0');

// ---------------------------------------------------------------- shaping

test('changes: no folder path, no pull request address, fields shaped', () => {
  const v = shapeChanges(CHANGES);
  assert.strictEqual(v.folder, undefined);
  assert.strictEqual(v.pr.url, undefined);
  assert.strictEqual(v.pr.checks.failedNames, undefined);
  assert.strictEqual(v.pr.state, 'OPEN');
  assert.strictEqual(v.ahead, 3);
  assert.strictEqual(v.branch, 'feature/x');
});

test('changes: a folder that is no repository says only that', () => {
  assert.deepStrictEqual(shapeChanges({ repo: false, folder: 'x' }), { repo: false });
  assert.strictEqual(shapeChanges(null), null);
});

test('changes: bad numbers read 0, unknown words read empty', () => {
  const v = shapeChanges({ repo: true, ahead: -1, behind: 1.5, added: 'x', gh: 'evil' });
  assert.strictEqual(v.ahead, 0);
  assert.strictEqual(v.behind, 0);
  assert.strictEqual(v.added, 0);
  assert.strictEqual(v.gh, '');
});

test('changes: control and direction characters are cleaned out of text', () => {
  const v = shapeChanges({ repo: true, branch: 'a\u202eb\nc' });
  assert.ok(!/[\u202e\n]/.test(v.branch));
});

test('skills: the words that use a skill are made from the CLI sign and the name only', () => {
  const v = shapeSkills({
    cli: 'Codex',
    skills: [{ name: 'deploy', insert: 'rm -rf /', about: 'x', from: 'project' }],
  });
  assert.strictEqual(v.sign, '$');
  assert.strictEqual(v.skills[0].insert, '$deploy');
  const c = shapeSkills({ cli: 'Claude Code', skills: [{ name: 'deploy' }] });
  assert.strictEqual(c.skills[0].insert, '/deploy');
});

test('skills: an unknown CLI is no answer, a name with a space is left out', () => {
  assert.strictEqual(shapeSkills({ cli: 'Evil', skills: [] }), null);
  const v = shapeSkills({ cli: 'Codex', skills: [{ name: 'two words' }, { name: 'ok' }] });
  assert.deepStrictEqual(
    v.skills.map(s => s.name),
    ['ok']
  );
});

test('skills: a long list is cut to fit one sealed message and says how many were left out', () => {
  const skills = Array.from({ length: 400 }, (_, i) => ({
    name: 'skill-' + i,
    about: 'x'.repeat(130),
    from: 'user',
  }));
  const v = shapeSkills({ cli: 'Claude Code', skills });
  const bytes = Buffer.byteLength(JSON.stringify({ t: 'feat', n: N(1), k: 'skills', w: 'ok', v }));
  assert.ok(bytes <= MAX_PLAIN, 'fits: ' + bytes);
  assert.strictEqual(v.skills.length + v.more, 400);
  assert.ok(v.more > 0);
});

test('clis: no e-mail or account crosses; signed in is true, false or not known', () => {
  const v = shapeClis([
    {
      cli: 'Codex',
      installed: true,
      signedIn: 'yes',
      account: 'me@example.com',
      gauges: [{ minutes: 300, used: 140, resetsAt: 5 }],
    },
    { cli: 'Codex', installed: false },
    { cli: 'Evil', installed: true },
  ]);
  assert.strictEqual(v.clis.length, 1);
  assert.strictEqual(v.clis[0].signedIn, null);
  assert.strictEqual(v.clis[0].account, undefined);
  assert.strictEqual(v.clis[0].gauges[0].used, 100);
});

test('clisFrom: detect plus plan limits, Claude signed out from its own file', () => {
  const rows = clisFrom(
    [
      { id: 'Claude Code', installed: true, loggedIn: null, account: 'me@example.com' },
      { id: 'Codex', installed: true, loggedIn: true },
      { id: 'OpenCode', installed: false, loggedIn: null },
    ],
    {
      accounts: [{ agentId: 'Claude Code', status: 'signedout' }],
      codexFile: {
        status: 'ok',
        plan: 'Plus',
        windows: [{ minutes: 300, used: 20, resetsAt: 9 }],
      },
    }
  );
  assert.strictEqual(rows[0].signedIn, false);
  assert.strictEqual(rows[1].plan, 'Plus');
  assert.strictEqual(rows[1].gauges.length, 1);
  assert.strictEqual(rows[2].installed, false);
  assert.ok(!JSON.stringify(shapeClis(rows)).includes('example.com'));
});

// ---------------------------------------------------------------- answering

test('answers a good ask with the shaped value', async () => {
  const { a, sent } = answerer();
  assert.ok(a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p1' }));
  await tick();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].obj.w, 'ok');
  assert.strictEqual(sent[0].obj.v.folder, undefined);
});

test('a computer that may not see details gets nothing, not even a refusal', async () => {
  const { a, sent, rights, reads } = answerer();
  rights.on = false;
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(reads.clis, 0);
});

test('the switch going off during a read sends nothing', async () => {
  let finish;
  const { a, sent, rights } = answerer({
    read: { clis: () => new Promise(resolve => (finish = resolve)) },
  });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  rights.on = false;
  finish([]);
  await tick();
  await tick();
  assert.strictEqual(sent.length, 0);
});

test('an agent this computer does not list to that computer is "none", nothing is read', async () => {
  const { a, sent, reads } = answerer();
  a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p9' });
  a.receive('pc2', { t: 'fask', n: N(2), k: 'skills', id: '' });
  await tick();
  assert.deepStrictEqual(
    sent.map(s => s.obj.w),
    ['none', 'none']
  );
  assert.strictEqual(reads.changes + reads.skills, 0);
});

test('a row id that cleaning would change is refused', async () => {
  const { a, sent, reads } = answerer({ row: () => ({ cli: 'Codex' }) });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p1\u200b' });
  await tick();
  assert.strictEqual(sent[0].obj.w, 'none');
  assert.strictEqual(reads.changes, 0);
});

test('every ask counts before it is read: past 6 a minute nothing is answered', async () => {
  const { a, sent, time } = answerer();
  for (let i = 0; i < ASKS_MIN + 3; i++) a.receive('pc2', { t: 'fask', n: 'bad', k: 'clis' });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  assert.strictEqual(sent.length, 0, 'wrong-shaped asks counted too');
  time.advance(61 * 1000);
  a.receive('pc2', { t: 'fask', n: N(2), k: 'clis' });
  await tick();
  assert.strictEqual(sent.length, 1);
});

test('one computer past its limit does not silence another', async () => {
  const { a, sent } = answerer();
  for (let i = 0; i < ASKS_MIN; i++) a.receive('pc2', { t: 'fask', n: N(i + 10), k: 'clis' });
  await tick();
  const before = sent.length;
  a.receive('pc3', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  assert.strictEqual(sent.length, before + 1);
  assert.strictEqual(sent[sent.length - 1].to, 'pc3');
});

test('a one-time number is answered once', async () => {
  const { a, sent } = answerer();
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  assert.strictEqual(sent.length, 1);
});

test('one read at a time for all computers: the second asker hears "busy"', async () => {
  let finish;
  const { a, sent } = answerer({
    read: {
      changes: () => new Promise(resolve => (finish = resolve)),
      clis: () => [],
    },
  });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p1' });
  a.receive('pc3', { t: 'fask', n: N(2), k: 'clis' });
  assert.strictEqual(sent[0].obj.w, 'busy');
  assert.strictEqual(sent[0].to, 'pc3');
  finish(CHANGES);
  await tick();
  await tick();
  assert.strictEqual(sent[1].obj.w, 'ok');
});

test('a kept answer is served from memory: the asking computer cannot make this one read often', async () => {
  const { a, reads } = answerer();
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  a.receive('pc3', { t: 'fask', n: N(2), k: 'clis' });
  await tick();
  assert.strictEqual(reads.clis, 1);
});

test('a read that never ends frees its place after its time limit', async () => {
  const { a, sent, time } = answerer({
    read: { clis: () => new Promise(() => {}), changes: () => CHANGES },
  });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  time.advance(READ_MS + 1);
  await tick();
  await tick();
  assert.strictEqual(sent[0].obj.w, 'none');
  a.receive('pc2', { t: 'fask', n: N(2), k: 'changes', id: 'p1' });
  await tick();
  assert.strictEqual(sent[1].obj.w, 'ok');
});

// Review 23, L2: an answer that comes late is checked against the row again.
test('a late answer about an agent that left the open project is "none"', async () => {
  let finish;
  const here = { row: { cli: 'Codex', who: 'agent-1' } };
  const { a, sent } = answerer({
    row: (peer, id) => (id === 'p1' ? here.row : null),
    read: { changes: () => new Promise(resolve => (finish = resolve)) },
  });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p1' });
  here.row = null;
  finish(CHANGES);
  await tick();
  await tick();
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].obj.w, 'none');
  assert.strictEqual(sent[0].obj.v, undefined);
});

test('another agent in the same panel id never gets the old one’s answer', async () => {
  const here = { row: { cli: 'Codex', who: 'agent-1' } };
  const { a, sent, reads } = answerer({ row: (peer, id) => (id === 'p1' ? here.row : null) });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'changes', id: 'p1' });
  await tick();
  assert.strictEqual(reads.changes, 1);

  // the agent changed while the read ran: the answer about the old one does not leave
  let finish;
  const late = answerer({
    row: (peer, id) => (id === 'p1' ? here.row : null),
    read: { changes: () => new Promise(resolve => (finish = resolve)) },
  });
  late.a.receive('pc2', { t: 'fask', n: N(2), k: 'changes', id: 'p1' });
  here.row = { cli: 'Codex', who: 'agent-2' };
  finish(CHANGES);
  await tick();
  await tick();
  assert.strictEqual(late.sent[0].obj.w, 'none');

  // and a kept answer is not served to the next agent in that panel
  a.receive('pc2', { t: 'fask', n: N(3), k: 'changes', id: 'p1' });
  await tick();
  assert.strictEqual(reads.changes, 2, 'read again for the new agent, not served from memory');
  assert.strictEqual(sent[1].obj.w, 'ok');
});

test('a read that throws is "none" and never throws out of receive', async () => {
  const { a, sent } = answerer({
    read: {
      clis: () => {
        throw new Error('x');
      },
    },
  });
  a.receive('pc2', { t: 'fask', n: N(1), k: 'clis' });
  await tick();
  assert.strictEqual(sent[0].obj.w, 'none');
  assert.strictEqual(a.receive('pc2', null), false);
  assert.strictEqual(a.receive('pc2', { t: 'fask', n: N(3), k: '__proto__' }), false);
});

// ---------------------------------------------------------------- asking

function reader(over = {}) {
  const time = fakeTime();
  const sent = [];
  let changes = 0;
  let i = 0;
  const r = createFeatureReader({
    now: time.now,
    timers: time.timers,
    may: () => true,
    send: (to, obj) => sent.push({ to, obj }),
    random: () => Buffer.from(String(++i).padStart(8, '0')),
    on: { changed: () => changes++ },
    ...over,
  });
  return { r, time, sent, changed: () => changes };
}

test('asks once, reads only the answer to its own ask from the computer it asked', () => {
  const { r, sent } = reader();
  assert.strictEqual(r.ask('pc2', 'changes', 'p1').state, 'asked');
  const n = sent[0].obj.n;
  assert.strictEqual(r.receive('pc3', { t: 'feat', n, k: 'changes', w: 'ok', v: CHANGES }), false);
  assert.strictEqual(r.receive('pc2', { t: 'feat', n, k: 'clis', w: 'ok', v: [] }), false);
  assert.strictEqual(r.receive('pc2', { t: 'feat', n, k: 'changes', w: 'ok', v: CHANGES }), true);
  const got = r.get('pc2', 'changes', 'p1');
  assert.strictEqual(got.state, 'ok');
  assert.strictEqual(got.value.folder, undefined, 'shaped again on receipt');
  assert.strictEqual(r.receive('pc2', { t: 'feat', n, k: 'changes', w: 'ok', v: CHANGES }), false);
});

test('an answer nobody asked for is dropped', () => {
  const { r } = reader();
  assert.strictEqual(
    r.receive('pc2', { t: 'feat', n: N(5), k: 'clis', w: 'ok', v: { clis: [] } }),
    false
  );
  assert.strictEqual(r.get('pc2', 'clis', ''), null);
});

test('no second ask while one is on its way or within 5 s', () => {
  const { r, sent, time } = reader();
  r.ask('pc2', 'clis');
  assert.strictEqual(r.ask('pc2', 'clis').state, 'wait');
  r.receive('pc2', { t: 'feat', n: sent[0].obj.n, k: 'clis', w: 'ok', v: { clis: [] } });
  assert.strictEqual(r.ask('pc2', 'clis').state, 'wait');
  time.advance(5001);
  assert.strictEqual(r.ask('pc2', 'clis').state, 'asked');
});

test('no answer in time says so', () => {
  const { r, time, changed } = reader();
  r.ask('pc2', 'skills', 'p1');
  time.advance(REPLY_MS + 1);
  assert.strictEqual(r.get('pc2', 'skills', 'p1').state, 'no_reply');
  assert.ok(changed() > 0);
});

test('busy and none keep an older value, and nothing is asked without a session', () => {
  const { r, sent, time } = reader();
  r.ask('pc2', 'clis');
  r.receive('pc2', {
    t: 'feat',
    n: sent[0].obj.n,
    k: 'clis',
    w: 'ok',
    v: { clis: [{ cli: 'Codex' }] },
  });
  time.advance(6000);
  r.ask('pc2', 'clis');
  r.receive('pc2', { t: 'feat', n: sent[1].obj.n, k: 'clis', w: 'busy' });
  assert.strictEqual(r.get('pc2', 'clis').value.clis[0].cli, 'Codex');
  const off = reader({ may: () => false });
  assert.strictEqual(off.r.ask('pc2', 'clis').state, 'not_sent');
  assert.strictEqual(off.sent.length, 0);
});

test('a send that did not leave is "not_sent" and leaves no wait behind', () => {
  const { r } = reader({ send: () => false });
  assert.strictEqual(r.ask('pc2', 'clis').state, 'not_sent');
  assert.strictEqual(r.get('pc2', 'clis'), null);
});

test('drop forgets everything of that computer only', () => {
  const { r, sent } = reader();
  r.ask('pc2', 'clis');
  r.ask('pc3', 'clis');
  r.receive('pc2', { t: 'feat', n: sent[0].obj.n, k: 'clis', w: 'ok', v: { clis: [] } });
  r.receive('pc3', { t: 'feat', n: sent[1].obj.n, k: 'clis', w: 'ok', v: { clis: [] } });
  r.drop('pc2');
  assert.strictEqual(r.get('pc2', 'clis'), null);
  assert.ok(r.get('pc3', 'clis'));
});

test('a bad kind or row id is never sent', () => {
  const { r, sent } = reader();
  assert.strictEqual(r.ask('pc2', 'files', 'p1').state, 'not_sent');
  assert.strictEqual(r.ask('pc2', 'changes', '').state, 'not_sent');
  assert.strictEqual(r.ask('pc2', 'changes', 'a\nb').state, 'not_sent');
  assert.strictEqual(sent.length, 0);
});

// ---------------------------------------------------------------- the window's words (165)
const win = require('../src/scripts/165-remote-features.js');

test('window: Changes read as 153 words them, with no link for the pull request', () => {
  const rows = Object.fromEntries(win.changesRows(shapeChanges(CHANGES)));
  assert.strictEqual(rows.Branch, 'feature/x');
  assert.strictEqual(rows.Lines, '+40 −7 · 5 files');
  assert.strictEqual(rows.Commits, '3 commits ahead of main · 1 behind');
  assert.ok(/^#12 Add x · open · checks 2 passed, 1 failed$/.test(rows['Pull request']));
  assert.ok(!JSON.stringify(rows).includes('https'));
  assert.deepStrictEqual(win.changesRows({ repo: false }), [['Folder', 'Not a git repository']]);
});

test('window: a thread action’s prompt names the pull request by number only', () => {
  const text = win.fill('Fix {pull} on {branch} into {base}', shapeChanges(CHANGES));
  assert.strictEqual(text, 'Fix pull request #12 on feature/x into main');
  assert.strictEqual(
    win.fill('{branch}', null),
    'the current branch',
    'no facts yet: plain words, never a blank'
  );
});

test('window: the CLIs line says signed in or out, the plan and each gauge', () => {
  const rows = win.clisRows(
    shapeClis([
      {
        cli: 'Codex',
        installed: true,
        signedIn: true,
        plan: 'Plus',
        gauges: [{ minutes: 300, used: 40 }],
      },
      { cli: 'Claude Code', installed: true, signedIn: null },
      { cli: 'OpenCode', installed: false },
    ])
  );
  assert.deepStrictEqual(rows[0], ['Codex', 'Signed in · Plus · 5-hour: 40% used']);
  assert.strictEqual(rows[1][1], 'Installed, sign-in not known');
  assert.strictEqual(rows[2][1], 'Not installed');
  assert.strictEqual(
    win.gaugeWords({ minutes: 10080, model: 'Opus', used: 5, resetsAt: 0 }),
    'Weekly Opus: 5% used'
  );
});

test('window: Board columns for another computer’s threads', () => {
  const now = Date.now();
  assert.strictEqual(win.boardColumn({ status: 'working' }, now), 'work');
  assert.strictEqual(win.boardColumn({ status: 'needs' }, now), 'needs');
  assert.strictEqual(win.boardColumn({ status: 'idle', done: now - 1000 }, now), 'done');
  assert.strictEqual(win.boardColumn({ status: 'idle', done: now - 3 * 86400000 }, now), '');
  assert.strictEqual(win.boardColumn({ status: 'idle', done: 0 }, now), '');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
    } catch (error) {
      console.error('FAIL ' + t.name + '\n  ' + (error && error.message));
      process.exitCode = 1;
    }
  }
  console.log(passed + ' of ' + tests.length + ' passed');
})();
