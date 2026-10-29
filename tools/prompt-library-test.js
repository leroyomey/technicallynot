// Test of the prompt and workflow library: node tools/prompt-library-test.js
//
// Three parts. (1) desktop/prompt-library.js against a made-up settings folder: saving prompts
// and recipes, the checks on every field, a second library on the same folder (an app restart)
// reading what the first saved, a broken file kept aside with the backup read instead, and the
// push to the window. (2) The recipe runner of src/scripts/194-prompt-library.js with made-up
// task starts and ends (42's turns): the next step leaves only when the step before it ended,
// never on the task that ran while the first step was held, and an interrupted, stopped,
// failed or closed step stops the recipe and says which step. (3) The one-line summaries. No
// window opens and no CLI starts.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

const library = require(path.join(__dirname, '..', 'desktop', 'prompt-library.js'));
const window194 = require(path.join(__dirname, '..', 'src', 'scripts', '194-prompt-library.js'));

// ---------------------------------------------------------------- (1) the saved file

function testStore() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'tnai-library-'));
  const pushed = [];
  try {
    const first = library.createLibrary({
      dir,
      send: (channel, payload) => pushed.push({ channel, payload }),
      now: () => 1000,
    });
    check('starts empty', first.view().items.length === 0);

    const prompt = first.save({
      kind: 'prompt',
      name: '  Review  the branch ',
      text: 'Review it.',
    });
    check('a prompt saves', prompt.ok && prompt.item.name === 'Review the branch', prompt.error);
    check('the window is told', pushed.at(-1)?.channel === 'library:state');
    check('the push holds the list', pushed.at(-1)?.payload.items.length === 1);

    const recipe = first.save({
      kind: 'recipe',
      name: 'Review, fix, test',
      steps: ['Review the changes.', '', 'Fix what you found.', 'Run the tests.'],
    });
    check('a recipe saves', recipe.ok, recipe.error);
    check(
      'empty steps are left out',
      recipe.item?.steps.length === 3 && recipe.item.steps[1] === 'Fix what you found.'
    );

    const same = first.save({ kind: 'prompt', name: 'review THE branch', text: 'x' });
    check('a name is unique, any case', !same.ok && /already/.test(same.error), same.error);
    const noName = first.save({ kind: 'prompt', name: '   ', text: 'x' });
    check('a name is needed', !noName.ok && /name/.test(noName.error));
    const noText = first.save({ kind: 'prompt', name: 'Empty', text: '  ' });
    check('a prompt needs its text', !noText.ok && /Write the prompt/.test(noText.error));
    const oneStep = first.save({ kind: 'recipe', name: 'One', steps: ['Only this.'] });
    check('a recipe needs two steps', !oneStep.ok && /two or more/.test(oneStep.error));
    const slash = first.save({ kind: 'recipe', name: 'Slash', steps: ['Do it.', '/compact'] });
    check(
      'a slash command is no recipe step',
      !slash.ok && /Step 2 is a slash command/.test(slash.error),
      slash.error
    );
    const tooMany = first.save({
      kind: 'recipe',
      name: 'Many',
      steps: Array.from({ length: 21 }, (_, at) => 'Step ' + at),
    });
    check('at most 20 steps', !tooMany.ok && /at most 20/.test(tooMany.error));
    const longName = first.save({ kind: 'prompt', name: 'n'.repeat(61), text: 'x' });
    check('a long name is refused', !longName.ok && /under 60/.test(longName.error));
    const kind = first.save({ kind: 'macro', name: 'Odd', text: 'x' });
    check('only prompts and recipes', !kind.ok);
    const gone = first.save({ id: 'nope', kind: 'prompt', name: 'Gone', text: 'x' });
    check('editing a missing item says so', !gone.ok && /gone/.test(gone.error));

    // Editing keeps the id and may keep its own name.
    const edited = first.save({
      id: prompt.item.id,
      kind: 'prompt',
      name: 'Review the branch',
      text: 'Review it again.',
    });
    check('an edit keeps its id', edited.ok && edited.item.id === prompt.item.id, edited.error);

    // An app restart: a new library on the same folder reads what was saved.
    const second = library.createLibrary({ dir, send: () => {} });
    const after = second.view().items;
    check('the list survives a restart', after.length === 2, JSON.stringify(after));
    check('the edit survived', after[0]?.text === 'Review it again.');
    check('the steps survived in order', after[1]?.steps.join('|') === recipe.item.steps.join('|'));

    // Remove, then a restart again.
    check('remove works', second.remove(prompt.item.id).ok);
    check('removing twice is fine', second.remove(prompt.item.id).ok);
    const third = library.createLibrary({ dir, send: () => {} });
    check('the removal survives a restart', third.view().items.length === 1);

    // A broken file is kept aside and the last good copy is read.
    fs.writeFileSync(path.join(dir, 'prompt-library.json'), '{ not json');
    const fourth = library.createLibrary({ dir, send: () => {} });

    // the file is read on the first view, not when the library is made
    check('the backup is read instead', fourth.view().items.length >= 1);
    const kept = fs.readdirSync(dir).some(name => name.startsWith('prompt-library.broken-'));
    check('a broken file is kept aside', kept, fs.readdirSync(dir).join(' '));
    check('saves work again after', fourth.save({ kind: 'prompt', name: 'New', text: 'x' }).ok);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- (2) the recipe runner

// A made-up thread: what was sent, its current task, and what the runner said.
function thread() {
  let clock = 10000;
  const sent = [];
  const told = [];
  let turn = null;
  let refuse = false;
  const runner = window194.createRunner({
    send: (paneId, text, first) => {
      if (refuse) return false;
      sent.push({ paneId, text, first });
      return true;
    },
    turn: () => turn,
    now: () => clock,
    told: (run, what, words) => told.push({ what, words, at: run.at }),
  });
  return {
    runner,
    sent,
    told,
    tick: ms => (clock += ms),
    // a task starts (`ended` empty) or ends
    begin: () => {
      turn = { startedAt: clock, endedAt: 0, endedBy: '' };
      runner.check('p1');
    },
    end: (endedBy = 'stop') => {
      turn = { ...turn, endedAt: clock, endedBy };
      runner.check('p1');
    },
    refuse: () => (refuse = true),
    setTurn: value => (turn = value),
  };
}

const RECIPE = { id: 'r1', name: 'Review, fix, test', steps: ['Review.', 'Fix.', 'Test.'] };

function testRunner() {
  // The ordinary way: each step leaves only once the one before it ended.
  const ok = thread();
  const started = ok.runner.start('p1', RECIPE);
  check('a recipe starts', started.ok);
  check('step 1 left at once', ok.sent.length === 1 && ok.sent[0].text === 'Review.');
  check('step 1 may wake the thread', ok.sent[0].first === true);
  ok.tick(500);
  ok.begin();
  check('step 2 waits while step 1 works', ok.sent.length === 1);
  ok.tick(30000);
  ok.end('stop');
  check('step 2 leaves when step 1 ended', ok.sent.length === 2 && ok.sent[1].text === 'Fix.');
  check('later steps never wake a thread', ok.sent[1].first === false);
  ok.runner.check('p1');
  check('the same end is not counted twice', ok.sent.length === 2);
  ok.tick(200);
  ok.begin();
  ok.tick(9000);
  ok.end('stop');
  ok.tick(200);
  ok.begin();
  ok.tick(9000);
  ok.end('stop');
  check('all three steps left', ok.sent.length === 3);
  check('it says it finished', ok.told.at(-1)?.what === 'done', JSON.stringify(ok.told.at(-1)));
  check('it is no longer running', ok.runner.get('p1') === null);

  // The thread was busy when the recipe started: the task that was running then is not step 1.
  const busy = thread();
  busy.setTurn({ startedAt: 9000, endedAt: 0, endedBy: '' });
  busy.runner.start('p1', RECIPE);
  busy.tick(4000);
  busy.setTurn({ startedAt: 9000, endedAt: 14000, endedBy: 'stop' });
  busy.runner.check('p1');
  check('the older task ending does not count', busy.sent.length === 1);
  busy.tick(100);
  busy.begin();
  busy.tick(5000);
  busy.end('stop');
  check('step 1 own end sends step 2', busy.sent.length === 2);

  // A task that started and ended before the runner heard of it still counts once.
  const quick = thread();
  quick.runner.start('p1', RECIPE);
  quick.tick(300);
  quick.setTurn({ startedAt: 10300, endedAt: 12000, endedBy: 'stop' });
  quick.runner.check('p1');
  check('a quick step is followed', quick.sent.length === 2);

  // Every way a step can fail stops the recipe and names the step.
  for (const [endedBy, words] of [
    ['interrupted', 'step 2 of 3 was interrupted; 1 step was not sent'],
    ['aborted', 'step 2 of 3 was stopped; 1 step was not sent'],
    ['error', 'step 2 of 3 ended with an error; 1 step was not sent'],
    ['exit', 'step 2 of 3 ended because the agent closed; 1 step was not sent'],
  ]) {
    const bad = thread();
    bad.runner.start('p1', RECIPE);
    bad.tick(100);
    bad.begin();
    bad.end('stop');
    bad.tick(100);
    bad.begin();
    bad.end(endedBy);
    check(endedBy + ': nothing more is sent', bad.sent.length === 2);
    check(
      endedBy + ': it says which step',
      bad.told.at(-1)?.what === 'stopped' && bad.told.at(-1)?.words === words,
      JSON.stringify(bad.told.at(-1))
    );
    check(endedBy + ': the run ended', bad.runner.get('p1') === null);
  }

  // Stopped by the user, by a closed thread, or a stopped thread.
  const mine = thread();
  mine.runner.start('p1', RECIPE);
  check('Stop the recipe works', mine.runner.stop('p1'));
  check('it says you stopped it', mine.told.at(-1)?.what === 'cancelled');
  mine.begin();
  mine.end('stop');
  check('nothing leaves after a stop', mine.sent.length === 1);

  const closed = thread();
  closed.runner.start('p1', RECIPE);
  closed.runner.session('p1', null);
  check(
    'a closed thread ends it',
    closed.told.at(-1)?.words === 'the thread closed at step 1 of 3'
  );

  const waking = thread();
  waking.runner.start('p1', RECIPE);
  waking.runner.session('p1', { running: false });
  check('a thread still waking keeps it', waking.runner.get('p1') !== null);
  waking.runner.session('p1', { running: true });
  waking.runner.session('p1', { running: false });
  check(
    'a thread that stopped ends it',
    waking.told.at(-1)?.words === 'the thread stopped at step 1 of 3'
  );

  // One recipe per thread, and a step that could not leave.
  const twice = thread();
  twice.runner.start('p1', RECIPE);
  const again = twice.runner.start('p1', RECIPE);
  check('one recipe per thread', !again.ok && /already/.test(again.error));
  const down = thread();
  down.refuse();
  const notSent = down.runner.start('p1', RECIPE);
  check('a step that cannot leave stops it', !notSent.ok && down.runner.get('p1') === null);
  check(
    'and says why, once',
    down.told.length === 1 && /could not be sent/.test(down.told[0].words),
    JSON.stringify(down.told)
  );

  // The user sent a prompt of their own while a step worked: that task's start ends the step.
  const own = thread();
  own.runner.start('p1', RECIPE);
  own.tick(100);
  own.begin();
  own.tick(1000);
  own.setTurn({ startedAt: 11200, endedAt: 0, endedBy: '' });
  own.runner.check('p1');
  check('a newer task ends the followed step', own.sent.length === 2);
}

// ---------------------------------------------------------------- (3) summaries

function testSummary() {
  const recipe = window194.summary({ kind: 'recipe', steps: ['Review\nmore', 'Fix', 'Test'] });
  check('a recipe reads as its steps', recipe === 'Review → Fix → Test', recipe);
  const prompt = window194.summary({ kind: 'prompt', text: 'First line\nsecond' });
  check('a prompt reads as its first line', prompt === 'First line');
  check(
    'recipes run on the CLIs whose task end is read',
    window194.TURN_CLIS.join() === 'Claude Code,Codex,OpenCode,Cursor Agent'
  );
}

try {
  testStore();
  testRunner();
  testSummary();
} catch (error) {
  failed++;
  console.log('FAIL threw · ' + error.stack);
}
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
