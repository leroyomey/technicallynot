// Test of the "/" and "$" list above the prompt box: node tools/prompt-picker-test.js
//
// Two parts. (1) desktop/cli-commands.js against a made-up project folder and a made-up home
// folder: each CLI's built-in list, the command files and skills each CLI reads, and the sign
// each CLI is told a skill with. (2) src/scripts/160-prompt-picker.js in a Node sandbox with a
// stand-in prompt box: when the list opens, what Enter, Tab and Esc do, and that a closed or
// empty list never takes a key from the prompt box. No window opens and no CLI starts.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? ' · ' + detail : ''));
  }
}

// ---------- a made-up project and home ----------

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-picker-'));
const project = path.join(scratch, 'project');
const home = path.join(scratch, 'home');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

write(
  path.join(project, '.claude', 'commands', 'deploy-check.md'),
  '---\ndescription: Check the build before a deploy\n---\nRun the checks.'
);
write(path.join(project, '.claude', 'commands', 'ops', 'restart.md'), '# Restart the server\n');
write(
  path.join(project, '.claude', 'skills', 'release-train', 'SKILL.md'),
  '---\nname: release-train\ndescription: Hand finished work to one release\n---\n'
);
write(
  path.join(project, '.agents', 'skills', 'shared-skill', 'SKILL.md'),
  '---\nname: shared-skill\ndescription: A skill every CLI can read\n---\n'
);
write(path.join(project, '.cursor', 'commands', 'tidy.md'), 'Tidy the imports');
write(path.join(project, '.opencode', 'command', 'ship.md'), '---\ndescription: Ship it\n---\n');
write(path.join(home, '.claude', 'commands', 'mine.md'), '---\ndescription: My own\n---\n');
write(path.join(home, '.copilot', 'skills', 'gh-skill', 'SKILL.md'), '---\nname: gh-skill\n---\n');

process.env.USERPROFILE = home;
process.env.HOME = home;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.CODEX_HOME;

const commands = require(path.join(__dirname, '..', 'desktop', 'cli-commands.js'));

const RUNNING = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode', 'GitHub Copilot'];

async function testLists() {
  for (const cli of RUNNING) {
    const list = commands.BUILT_IN[cli];
    check(cli + ' has built-in commands', Array.isArray(list) && list.length >= 15);
    const names = list.map(([name]) => name);
    check(
      cli + ' names start with /',
      names.every(name => /^\/[a-z][\w-]*$/.test(name))
    );
    check(cli + ' names are not repeated', new Set(names).size === names.length);
    check(
      cli + ' lines are short',
      list.every(([, about]) => about && about.length <= 60),
      list.find(([, about]) => !about || about.length > 60)?.[0]
    );
  }

  const claude = await commands.list('Claude Code', project);
  const own = claude.commands.filter(command => command.kind === 'own').map(c => c.name);
  check('Claude Code: project command', own.includes('/deploy-check'), own.join(' '));
  check('Claude Code: command in a subfolder', own.includes('/restart'));
  check('Claude Code: user command', own.includes('/mine'));
  check(
    'Claude Code: command line from front matter',
    claude.commands.find(c => c.name === '/deploy-check')?.about ===
      'Check the build before a deploy'
  );
  check(
    'Claude Code: line from the first heading',
    claude.commands.find(c => c.name === '/restart')?.about === 'Restart the server'
  );
  check('Claude Code: skills with /', claude.skillSign === '/');
  check(
    'Claude Code: project skill',
    claude.skills.some(s => s.insert === '/release-train' && s.from === 'project')
  );
  check('Claude Code: no .agents skill', !claude.skills.some(s => s.name === 'shared-skill'));

  const codex = await commands.list('Codex', project);
  check('Codex: skills with $', codex.skillSign === '$');
  check(
    'Codex: .agents skill as $name',
    codex.skills.some(s => s.insert === '$shared-skill')
  );
  check('Codex: no .claude skill', !codex.skills.some(s => s.name === 'release-train'));
  check('Codex: no command files', !codex.commands.some(c => c.kind === 'own'));

  const cursor = await commands.list('Cursor Agent', project);
  check(
    'Cursor Agent: its command',
    cursor.commands.some(c => c.name === '/tidy')
  );
  check(
    'Cursor Agent: reads .claude and .agents skills',
    cursor.skills.some(s => s.insert === '/release-train') &&
      cursor.skills.some(s => s.insert === '/shared-skill')
  );

  const opencode = await commands.list('OpenCode', project);
  check(
    'OpenCode: its command',
    opencode.commands.some(c => c.name === '/ship')
  );

  const copilot = await commands.list('GitHub Copilot', project);
  check(
    'Copilot CLI: user skill',
    copilot.skills.some(s => s.insert === '/gh-skill')
  );

  const unknown = await commands.list('Gemini CLI', project);
  check('a CLI with no list says so', unknown.known === false && !unknown.commands.length);

  const noProject = await commands.list('Claude Code', '');
  check(
    'no project: built-in and user files only',
    noProject.commands.some(c => c.name === '/mine') &&
      !noProject.commands.some(c => c.name === '/deploy-check')
  );
}

// ---------- the list in a sandbox ----------

function fakeElement(doc) {
  const listeners = {};
  const attributes = {};
  return {
    ownerDocument: doc,
    className: '',
    id: '',
    innerHTML: '',
    dataset: {},
    style: {},
    setAttribute: (name, value) => (attributes[name] = String(value)),
    getAttribute: name => attributes[name] ?? null,
    removeAttribute: name => delete attributes[name],
    addEventListener: (type, fn) => (listeners[type] = listeners[type] || []).push(fn),
    fire(type, event = {}) {
      for (const fn of listeners[type] || []) fn(event);
    },
    remove() {
      doc.body.children = doc.body.children.filter(child => child !== this);
    },
    querySelector: () => ({ scrollIntoView() {} }),
    closest: () => null,
    focus() {
      doc.activeElement = this;
    },
    dispatchEvent(event) {
      this.fire(event.type, event);
    },
  };
}

function sandbox(cli, answer, library = [], saved = null) {
  const windowListeners = [];
  const doc = { body: { children: [], append: el => doc.body.children.push(el) } };
  doc.createElement = () => fakeElement(doc);
  const prompt = fakeElement(doc);
  prompt.value = '';
  prompt.selectionStart = 0;
  prompt.selectionEnd = 0;
  prompt.setSelectionRange = (start, end) => {
    prompt.selectionStart = start;
    prompt.selectionEnd = end;
  };
  doc.activeElement = prompt;
  doc.getElementById = id => (id === 'prompt' ? prompt : null);
  const window = {
    addEventListener: (type, fn) => windowListeners.push(fn),
    tnaiNative: { cliCommands: { list: async () => ({ ok: true, value: answer }) } },
    TnaiLiveTasks: { target: () => 'pane-1' },
    TnaiAgents: { sessions: () => [{ paneId: 'pane-1', agent: cli }], onChange() {} },
    TnaiCliMenus: { opensScreen: (name, command) => command === '/model' },
    TnaiSkills: { list: () => library },
    TnaiFloat: { attach() {} },
  };
  doc.defaultView = window;
  const context = {
    window,
    document: doc,
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    setTimeout,
    console,
  };

  // Saved prompts and recipes (194, the real file) beside the list: a made-up list on disk, a
  // running thread that keeps what it was sent.
  const sent = [];
  if (saved) {
    window.tnaiNative.promptLibrary = {
      view: async () => ({ ok: true, items: saved }),
      onState() {},
    };
    window.TnaiAgents.sessions = () => [
      { paneId: 'pane-1', agent: cli, name: 'Nova', running: true },
    ];
    window.TnaiAgents.send = (paneId, text) => sent.push({ paneId, text }) > 0;
    window.TnaiTurns = { get: () => null };
    window.toast = () => {};
    vm.runInNewContext(
      fs.readFileSync(
        path.join(__dirname, '..', 'src', 'scripts', '194-prompt-library.js'),
        'utf8'
      ),
      context
    );
  }
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', '160-prompt-picker.js'), 'utf8'),
    context
  );

  // Types text as the user would: the caret at its end, one input event.
  const type = text => {
    prompt.value = text;
    prompt.selectionStart = prompt.selectionEnd = text.length;
    prompt.fire('input');
  };

  // A key in the window's capture phase; true when the list took it.
  const key = (name, extra = {}) => {
    let taken = false;
    const event = {
      key: name,
      target: prompt,
      preventDefault() {},
      stopImmediatePropagation() {
        taken = true;
      },
      ...extra,
    };
    windowListeners.forEach(fn => fn(event));
    return taken;
  };
  return {
    window,
    prompt,
    type,
    key,
    sent,
    picker: () => window.TnaiPromptPicker,
    listHtml: () => doc.body.children[0]?.innerHTML || '',
  };
}

// The Saved group (194): saved prompts and recipes after the CLI's own rows.
async function testSaved() {
  const claude = await commands.list('Claude Code', project);
  const saved = [
    { id: 'p1', kind: 'prompt', name: 'Zqx review the branch', text: 'Review the branch, please.' },
    { id: 'r1', kind: 'recipe', name: 'Zqx review fix test', steps: ['Review.', 'Fix.', 'Test.'] },
  ];
  const box = sandbox('Claude Code', claude, [], saved);
  await settle();
  box.type('/zqx');
  await settle();
  const rows = box.picker().rows();
  check('"/" lists saved items', rows.length === 2, JSON.stringify(rows.map(row => row.name)));
  check('a saved prompt says so', rows[0]?.label === 'saved prompt', rows[0]?.label);
  check('a recipe says its steps', rows[1]?.label === 'recipe · 3 steps', rows[1]?.label);
  check('the Saved heading shows', box.listHtml().includes('<h4>Saved</h4>'));
  check(
    'no empty CLI heading above it',
    !box.listHtml().includes('Commands of'),
    box.listHtml().slice(0, 80)
  );

  box.type('/mo');
  check('the CLI rows stay first', box.picker().rows()[0]?.name === '/model');

  box.type('/zqx');
  check('Enter picks the saved prompt', box.key('Enter'));
  check('its text replaces the word', box.prompt.value === 'Review the branch, please.');
  check('a saved prompt is not sent by itself', box.sent.length === 0);

  box.type('/zqx');
  box.key('ArrowDown');
  check('Enter picks the recipe', box.key('Enter'));
  check('the typed word goes', box.prompt.value === '', JSON.stringify(box.prompt.value));
  check(
    'step 1 is sent to the thread',
    box.sent.length === 1 && box.sent[0].text.includes('Review.'),
    JSON.stringify(box.sent)
  );
  check('only step 1 so far', !box.sent.some(one => one.text.includes('Fix.')));

  const copilot = sandbox(
    'GitHub Copilot',
    await commands.list('GitHub Copilot', project),
    [],
    saved
  );
  await settle();
  copilot.type('/zqx');
  await settle();
  check(
    'a CLI without task ends says so on the recipe',
    copilot.picker().rows()[1]?.label === 'recipe · not for GitHub Copilot',
    copilot.picker().rows()[1]?.label
  );
}

const settle = () => new Promise(resolve => setTimeout(resolve, 5));

async function testList() {
  const claude = await commands.list('Claude Code', project);
  const box = sandbox('Claude Code', claude, [
    {
      source: 'imported',
      everywhere: true,
      name: 'agent-efficiency',
      description: 'Keep usage low',
    },
    { source: 'imported', everywhere: false, name: 'not-on' },
  ]);

  box.type('/mo');
  await settle();
  check('"/" at the start opens the list', box.picker().isOpen());
  const rows = box.picker().rows();
  check('first row is /model', rows[0]?.name === '/model', rows[0]?.name);
  check('/model says it opens the CLI screen', rows[0]?.label === 'opens the CLI screen');

  box.type('/comp');
  check('a built-in that runs says so', box.picker().rows()[0]?.label === 'runs here');

  box.type('/dep');
  check('a project command says your command', box.picker().rows()[0]?.label === 'your command');

  box.type('/mo');
  check('Enter picks while open', box.key('Enter'));
  check('the pick is written with a space', box.prompt.value === '/model ', box.prompt.value);
  check('the list closed after the pick', !box.picker().isOpen());
  check('Enter is not taken once closed', !box.key('Enter'));

  box.type('please look at /etc');
  check('"/" in the middle opens nothing', !box.picker().isOpen());

  box.type('/zzzz');
  check('nothing matches: no list', !box.picker().isOpen());
  check('nothing matches: Enter is not taken', !box.key('Enter'));

  box.type('/cl');
  check('Shift+Enter is not taken', !box.key('Enter', { shiftKey: true }));
  check('Ctrl+Space is not taken', !box.key(' ', { ctrlKey: true }));
  check('↓ moves', box.key('ArrowDown'));
  check('Esc closes', box.key('Escape') && !box.picker().isOpen());
  box.type('/cle');
  check('the word Esc closed stays closed', !box.picker().isOpen());
  box.type('');
  box.type('/cl');
  check('a new word opens again', box.picker().isOpen());
  check('Tab picks', box.key('Tab') && /^\/cl\w* $/.test(box.prompt.value), box.prompt.value);

  box.type('use $rel');
  check('"$" in a word opens the skills', box.picker().isOpen());
  check('Claude Code skill is written with /', box.picker().rows()[0]?.insert === '/release-train');
  box.type('use $agent');
  check(
    'library skill in Claude Code goes through its plugin',
    box.picker().rows()[0]?.insert === '/tnai-skills:agent-efficiency'
  );
  box.type('use $not-on');
  check('a library skill that is off is not offered', !box.picker().isOpen());
  box.type('mail @x');
  check('"@" is left to the mentions list', !box.picker().isOpen());

  const codex = await commands.list('Codex', project);
  const codexBox = sandbox('Codex', codex);
  codexBox.type('try $sha');
  await settle();
  check('Codex skill is written with $', codexBox.picker().rows()[0]?.insert === '$shared-skill');
  codexBox.key('Enter');
  check('Codex pick in the text', codexBox.prompt.value === 'try $shared-skill ');
  codexBox.type('/rel');
  check('Codex "/" offers no skills', !codexBox.picker().isOpen());
}

(async () => {
  try {
    await testLists();
    await testList();
    await testSaved();
  } catch (error) {
    failed++;
    console.log('FAIL threw · ' + error.stack);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
