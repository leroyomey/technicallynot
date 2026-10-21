// Technically Not tools · thread-actions-test.js — Plain Node checks for the thread actions
// (src/scripts/154-thread-actions.js): the prompts are filled from a thread's git facts, the
// button shows only for an agent thread whose folder is a git repository, the user's own prompt
// wins over the default and an empty one falls back, and the menu's label names the branch.
// No window: the file's page part does not run under Node.
// Run: node tools/thread-actions-test.js
'use strict';
const assert = require('assert');
const path = require('path');

const actions = require(path.join(__dirname, '..', 'src', 'scripts', '154-thread-actions.js'));

let passed = 0;

function check(name, run) {
  try {
    run();
    passed++;
    console.log('ok   ' + name);
  } catch (error) {
    console.error('FAIL ' + name + '\n     ' + (error.stack || error));
    process.exitCode = 1;
  }
}

const onBranch = {
  repo: true,
  branch: 'tnai/kestrel',
  base: 'master',
  pr: { number: 42, url: 'https://github.com/owner/repo/pull/42' },
};

check('the seven actions, in the order of the approved menu', () => {
  assert.deepStrictEqual(
    actions.ACTIONS.map(action => action.label),
    [
      'Commit',
      'Commit and push',
      'Open pull request',
      'Review the changes',
      'Fix review comments',
      'Resolve conflicts',
      'Write a recap',
    ]
  );
  actions.ACTIONS.forEach(action => assert.ok(action.prompt.length > 40, action.id));
});

check('{branch}, {base} and {pull} are filled, every time they stand', () => {
  const text = actions.fill('{branch} into {base}; {branch} again; see {pull}.', onBranch);
  assert.strictEqual(
    text,
    'tnai/kestrel into master; tnai/kestrel again; see pull request #42 ' +
      '(https://github.com/owner/repo/pull/42).'
  );
});

check('unknown facts read as plain words, never as a placeholder', () => {
  assert.strictEqual(
    actions.fill('{branch} / {base} / {pull}', null),
    'the current branch / the default branch / the pull request of branch the current branch'
  );
  assert.strictEqual(
    actions.fill('{pull}', { repo: true, branch: 'feature', base: 'main' }),
    'the pull request of branch feature'
  );

  // a word in braces that is not one of the three stays as written
  assert.strictEqual(actions.fill('{other} {branch}', onBranch), '{other} tnai/kestrel');
});

check('every default prompt has no placeholder left once filled', () => {
  actions.ACTIONS.forEach(action => {
    assert.ok(!/\{(branch|base|pull)\}/.test(actions.fill(action.prompt, onBranch)), action.id);
    assert.ok(!/\{(branch|base|pull)\}/.test(actions.fill(action.prompt, null)), action.id);
  });
});

check('the button shows only for an agent thread in a git repository', () => {
  const agent = { agent: 'Codex', cwd: 'C:\\work' };
  assert.strictEqual(actions.shows(agent, onBranch), true);
  assert.strictEqual(actions.shows({ agent: 'OpenCode' }, { repo: true }), true);
  assert.strictEqual(actions.shows(agent, { repo: false }), false);
  assert.strictEqual(actions.shows(agent, null), false);
  assert.strictEqual(actions.shows({ agent: 'Terminal' }, onBranch), false);
  assert.strictEqual(actions.shows(null, onBranch), false);
});

check("the user's own prompt wins; an empty one or an unknown action falls back", () => {
  const commit = actions.ACTIONS[0];
  assert.strictEqual(actions.promptOf('commit', {}), commit.prompt);
  assert.strictEqual(
    actions.promptOf('commit', { commit: '  Commit it all.  ' }),
    'Commit it all.'
  );
  assert.strictEqual(actions.promptOf('commit', { commit: '   ' }), commit.prompt);
  assert.strictEqual(actions.promptOf('commit', { commit: 7 }), commit.prompt);
  assert.strictEqual(actions.promptOf('nothing', { nothing: 'x' }), '');
});

check('the label names the branch, and leaves it off when unknown', () => {
  assert.strictEqual(actions.labelOf(onBranch), "This thread's work · branch tnai/kestrel");
  assert.strictEqual(
    actions.labelOf({ repo: true, detached: true, branch: '' }),
    "This thread's work"
  );
  assert.strictEqual(actions.labelOf(null), "This thread's work");
});

console.log(passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
