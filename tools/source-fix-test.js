// Technically Not · tools/source-fix-test.js — plain Node test of desktop/source-fix.js ("Fix a
// Technically Not bug from its source…"): the copy is made at the version's tag in the settings
// folder, an untouched copy is used again and a touched one is not, a missing tag falls back to the
// latest public code, the thread starts under a mark only pty:start can turn into the folder, and
// its first prompt is the real playbook with every placeholder filled. git and the thread start are
// stand-ins: no network, no window. Run: node tools/source-fix-test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSourceFix, REPO } = require('../desktop/source-fix');
const hiddenSkills = require('../desktop/hidden-skills');

let failures = 0;

async function check(name, run) {
  try {
    await run();
    console.log('ok   ' + name);
  } catch (error) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (error?.stack || error));
  }
}

// A stand-in git. options.tags: the tags the public repo has; options.dirty: folders with changes;
// options.missing: git is not installed; options.cloneError: every clone fails with this text.
function fakeGit(options = {}) {
  const calls = [];
  const git = async (args, run = {}) => {
    calls.push({ args, cwd: run.cwd || '' });
    if (options.missing)
      return { ok: false, missing: true, stdout: '', stderr: 'spawn git ENOENT' };
    if (args[0] === '--version') return { ok: true, stdout: 'git version 2.47.0', stderr: '' };
    const clone = args.indexOf('clone');
    if (clone >= 0) {
      const ref = args[args.indexOf('--branch') + 1];
      const folder = args[args.length - 1];
      if (options.cloneError) return { ok: false, stdout: '', stderr: options.cloneError };
      if (ref !== 'main' && !(options.tags || []).includes(ref)) {
        // git makes the folder before it finds the ref is missing
        fs.mkdirSync(folder, { recursive: true });
        return {
          ok: false,
          stdout: '',
          stderr:
            'warning: Could not find remote branch ' +
            ref +
            ' to clone.\nfatal: Remote branch ' +
            ref +
            ' not found in upstream origin',
        };
      }
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, '.ref'), ref);
      return { ok: true, stdout: '', stderr: '' };
    }
    const ref = fs.existsSync(path.join(run.cwd, '.ref'))
      ? fs.readFileSync(path.join(run.cwd, '.ref'), 'utf8')
      : '';
    if (args[0] === 'status')
      return {
        ok: true,
        stdout: (options.dirty || []).includes(run.cwd) ? ' M src/a.js\n' : '',
        stderr: '',
      };
    if (args[0] === 'rev-parse') return { ok: true, stdout: 'HEAD\n', stderr: '' };
    if (args[0] === 'describe')
      return ref.startsWith('v')
        ? { ok: true, stdout: ref + '\n', stderr: '' }
        : { ok: false, stdout: '', stderr: 'fatal: no tag exactly matches' };
    return { ok: false, stdout: '', stderr: 'unexpected git ' + args.join(' ') };
  };
  return { git, calls };
}

// A source fix with stand-ins; `seen` records what the thread start and the prompt got.
function make(dir, gitOptions = {}, extra = {}) {
  const seen = { spawns: [], prompts: [], notes: [], folderAtStart: null, otherCli: null };
  const { git, calls } = fakeGit(gitOptions);
  let clock = 1000;
  const fix = createSourceFix({
    dir,
    version: '1.2.3',
    agents: () => ['Claude Code', 'Codex', 'Terminal'],
    git,
    now: () => clock,
    playbook: vars => hiddenSkills.lines('source-fix', vars),
    note: (paneId, info) => seen.notes.push({ paneId, info }),
    spawn: async (agent, pick, name, extraStart) => {
      seen.spawns.push({ agent, pick, name, extra: extraStart });

      // what pty:start does with the mark (extra.wrongCli: a start of another CLI comes first and
      // spends it without getting the folder; extra.lateMs: the start comes that much later)
      clock += extra.lateMs || 0;
      if (extra.wrongCli) seen.otherCli = fix.takeFolder(extraStart.schedule, extra.wrongCli);
      seen.folderAtStart = fix.takeFolder(extraStart.schedule, agent);
      seen.again = fix.takeFolder(extraStart.schedule, agent);
      return extra.spawnAnswer || { paneId: 'pane-1' };
    },
    submit: async (paneId, text, options) => {
      seen.prompts.push({ paneId, text, options });
      return extra.submitAnswer || { ok: true };
    },
  });
  return { fix, seen, calls };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-source-fix-'));
  try {
    await check('the playbook has every placeholder this module fills', async () => {
      const lines = hiddenSkills.lines('source-fix', {
        folder: 'F',
        draft: 'D',
        version: 'V',
        os: 'O',
        repo: 'R',
        source: 'S',
        issues: 'I',
        compare: 'C',
      });
      assert.ok(lines.length > 5, 'playbook lines');
      assert.ok(!lines.join('\n').includes('{{'), 'no placeholder left');

      // the playbook is never part of what every agent is told
      for (const target of ['every-agent', 'claude-code', 'opencode', 'codex'])
        assert.ok(
          !hiddenSkills
            .lines(target, new Proxy({}, { has: () => true, get: () => '' }))
            .some(l => l.includes('Fix a Technically Not bug from its source')),
          target
        );
    });

    await check('a thread with no agent tool, or an unknown one, starts nothing', async () => {
      const { fix, seen, calls } = make(path.join(root, 'a'));
      assert.strictEqual((await fix.start({ agent: 'Terminal' })).ok, false);
      assert.strictEqual((await fix.start({ agent: 'Nope' })).ok, false);
      assert.strictEqual(seen.spawns.length, 0);
      assert.strictEqual(calls.length, 0, 'git was not run');
    });

    await check('without git it says so', async () => {
      const { fix, seen } = make(path.join(root, 'b'), { missing: true });
      const answer = await fix.start({ agent: 'Claude Code' });
      assert.strictEqual(answer.ok, false);
      assert.match(answer.error, /Git is needed/);
      assert.strictEqual(seen.spawns.length, 0);
    });

    await check('copies the tag into the settings folder and starts a thread there', async () => {
      const dir = path.join(root, 'c');
      const { fix, seen, calls } = make(dir, { tags: ['v1.2.3'] });
      const answer = await fix.start({
        agent: 'Claude Code',
        details: {
          thread: 'Nova',
          agent: 'Claude Code',
          model: 'opus',
          state: 'idle',
          error: 'Could not start:\nboom',
        },
      });
      const folder = path.join(dir, 'source-fix', 'v1.2.3');
      assert.deepStrictEqual(answer, { ok: true, paneId: 'pane-1', folder, fromTag: true });
      const clone = calls.find(call => call.args.includes('clone')).args;
      assert.ok(
        clone.includes(REPO) && clone.includes('v1.2.3') && clone.includes('--depth'),
        clone.join(' ')
      );
      assert.strictEqual(seen.spawns[0].agent, 'Claude Code');
      assert.strictEqual(seen.spawns[0].extra.folder, folder);
      assert.strictEqual(seen.folderAtStart, folder, 'pty:start gets the folder');
      assert.strictEqual(seen.again, '', 'the mark is taken once');
      assert.deepStrictEqual(seen.notes[0], { paneId: 'pane-1', info: { source: 'user' } });
      const prompt = seen.prompts[0].text;
      assert.ok(prompt.includes(folder), 'folder named');
      assert.ok(prompt.includes(folder + '.draft.md'), 'draft beside the copy');
      assert.ok(prompt.includes(REPO + '/issues/new'), 'issue page');
      assert.ok(prompt.includes(REPO + '/compare/main...'), 'compare page');
      assert.ok(prompt.includes('the tag v1.2.3'), 'source named');
      assert.ok(
        prompt.includes('- Thread: Nova') &&
          prompt.includes('- Error shown: Could not start: boom'),
        'details, one line each'
      );
      assert.ok(prompt.includes('ask first'), 'asks when the user said nothing');
      assert.ok(!prompt.includes('{{'), 'no placeholder left');
    });

    await check('an untouched copy is used again, a touched one is not', async () => {
      const dir = path.join(root, 'd');
      const first = make(dir, { tags: ['v1.2.3'] });
      await first.fix.start({ agent: 'Codex' });
      const folder = path.join(dir, 'source-fix', 'v1.2.3');

      const again = make(dir, { tags: ['v1.2.3'] });
      const reused = await again.fix.start({ agent: 'Codex' });
      assert.strictEqual(reused.folder, folder);
      assert.strictEqual(reused.fromTag, true);
      assert.ok(!again.calls.some(call => call.args.includes('clone')), 'no second clone');

      const touched = make(dir, { tags: ['v1.2.3'], dirty: [folder] });
      const fresh = await touched.fix.start({ agent: 'Codex' });
      assert.strictEqual(fresh.folder, folder + '-2');

      // a draft written next to a copy also counts as touched
      fs.writeFileSync(folder + '-2.draft.md', 'draft');
      const drafted = make(dir, { tags: ['v1.2.3'], dirty: [folder] });
      assert.strictEqual((await drafted.fix.start({ agent: 'Codex' })).folder, folder + '-3');
    });

    await check('a missing tag falls back to the latest public code and says so', async () => {
      const dir = path.join(root, 'e');
      const { fix, seen } = make(dir, { tags: [] });
      const answer = await fix.start({
        agent: 'Claude Code',
        details: { words: 'the reply showed twice' },
      });
      assert.strictEqual(answer.ok, true);
      assert.strictEqual(answer.fromTag, false);
      const prompt = seen.prompts[0].text;
      assert.ok(
        prompt.includes('latest public code on main') && prompt.includes('v1.2.3 was not found'),
        'says the tag was missing'
      );
      assert.ok(prompt.includes("The user's words: the reply showed twice"), 'the words go along');
    });

    await check('a clone that fails leaves no folder and says why', async () => {
      const dir = path.join(root, 'f');
      const { fix, seen } = make(dir, {
        cloneError: 'fatal: unable to access: Could not resolve host: github.com',
      });
      const answer = await fix.start({ agent: 'Claude Code' });
      assert.strictEqual(answer.ok, false);
      assert.match(answer.error, /Could not resolve host/);
      assert.ok(!fs.existsSync(path.join(dir, 'source-fix', 'v1.2.3')), 'no half copy');
      assert.strictEqual(seen.spawns.length, 0);
    });

    await check('a thread that does not come up, or a prompt not sent, is said', async () => {
      const notUp = make(
        path.join(root, 'g'),
        { tags: ['v1.2.3'] },
        { spawnAnswer: { error: 'Codex did not become ready in time.' } }
      );
      const first = await notUp.fix.start({ agent: 'Codex' });
      assert.strictEqual(first.ok, false);
      assert.match(first.error, /did not become ready/);
      const notSent = make(
        path.join(root, 'h'),
        { tags: ['v1.2.3'] },
        { submitAnswer: { ok: false, error: 'busy' } }
      );
      const second = await notSent.fix.start({ agent: 'Codex' });
      assert.strictEqual(second.ok, false);
      assert.strictEqual(second.paneId, 'pane-1');
    });

    await check('a stale mark gives no folder', async () => {
      const { fix } = make(path.join(root, 'i'), { tags: ['v1.2.3'] });
      assert.strictEqual(fix.takeFolder('unknown', 'Codex'), '');
      assert.strictEqual(fix.takeFolder(undefined, 'Codex'), '');

      // another CLI's start gets no folder, and the mark is spent
      const wrong = make(path.join(root, 'j'), { tags: ['v1.2.3'] }, { wrongCli: 'Codex' });
      await wrong.fix.start({ agent: 'Claude Code' });
      assert.strictEqual(wrong.seen.otherCli, '');
      assert.strictEqual(wrong.seen.folderAtStart, '');

      // a mark older than 15 minutes gives no folder
      const slow = make(path.join(root, 'k'), { tags: ['v1.2.3'] }, { lateMs: 15 * 60 * 1000 + 1 });
      await slow.fix.start({ agent: 'Claude Code' });
      assert.strictEqual(slow.seen.folderAtStart, '');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(failures ? failures + ' failed' : 'all passed');
  process.exit(failures ? 1 : 0);
})();
