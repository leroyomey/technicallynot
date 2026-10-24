// Technically Not tools · plain-words-test.js — what an agent is doing, in plain words
// (src/scripts/183-plain-words.js): a tool call becomes a few words, the folder a command runs in,
// and the raw call kept for the tip. Runs the real file in Node. Run: node
// tools/plain-words-test.js
'use strict';
const words = require('../src/scripts/183-plain-words.js');

let passed = 0;
let failed = 0;

function check(ok, name, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// a shell command: [command, words, folder]
const COMMANDS = [
  [
    'cd "/c/Users/me/Desktop/Muppet Avatar" && tracker/.venv/Scripts/python soak_test.py --minutes 30',
    'Running a test',
    'Muppet Avatar',
  ],
  ['node tools/thread-list-test.js', 'Running a test', ''],
  ['cd C:/work/app; npm test', 'Running a test', 'app'],
  ['npx vitest run', 'Running a test', ''],
  ['node tools/check-syntax.js', 'Running a check', ''],
  ['node tools/format-code.js src/a.js', 'Formatting code', ''],
  ['npm install', 'Installing packages', ''],
  ['pip install requests', 'Installing packages', ''],
  ['npm run dist', 'Building', ''],
  ['git status --short', 'Looking at changes', ''],
  ['git -C "C:/x y" commit -m "a"', 'Committing', ''],
  ['git push origin master', 'Pushing', ''],
  ['ls -la src', 'Listing files', ''],
  ['Get-ChildItem -Recurse', 'Listing files', ''],
  ['cd x && grep -rn foo .', 'Searching the code', 'x'],
  ['sed -n 1,40p src/a.js', 'Reading a file', ''],
  ["sed -i 's/a/b/' src/a.js", 'Editing a file', ''],
  ['tnai locks', 'Coordinating agents', ''],
  ['python make_sheet.py --out a.png', 'Running make_sheet.py', ''],
  ['npm run format:check', 'Running a check', ''],
  ['some-tool --flag', 'Running a command', ''],
];
COMMANDS.forEach(([command, text, folder]) => {
  const got = words.step('Bash', command);
  check(got.text === text, 'words for ' + command, got.text);
  check(got.folder === folder, 'folder for ' + command, got.folder);
  check(got.raw === command, 'raw for ' + command, got.raw);
});
check(words.step('PowerShell', 'npm test').text === 'Running a test', 'PowerShell is a shell too');

// other tools: [tool, detail, words]
const TOOLS = [
  ['Edit', 'C:/p/src/styles/41-thread-details.css', 'Editing 41-thread-details.css'],
  ['Write', 'docs/notes/a.md', 'Writing a.md'],
  ['Read', 'src\\scripts\\119-thread-list.js', 'Reading 119-thread-list.js'],
  ['Grep', 'splitPrompt', 'Searching for splitPrompt'],
  ['Glob', '**/*.css', 'Looking for files'],
  ['WebFetch', 'https://www.example.com/page', 'Reading example.com'],
  ['WebSearch', 'electron 38 release', 'Searching the web for electron 38 release'],
  ['Skill', 'tnai-threads', 'Using the tnai-threads skill'],
  ['TodoWrite', '', 'Updating its plan'],
  ['Agent', 'Review the diff', 'Starting a helper'],
  ['mcp__tnai__tnai_send', '', 'Coordinating agents'],
  ['mcp__claude-in-chrome__navigate', '', 'Using the browser'],
  ['mcp__github__create_issue', '', 'Using github'],
  ['', '', 'Thinking'],
  ['Frobnicate', '', 'Using Frobnicate'],
];
TOOLS.forEach(([tool, detail, text]) => {
  const got = words.step(tool, detail);
  check(got.text === text, 'words for ' + tool, got.text);
});
check(
  words.step('Edit', 'C:/p/a.css').raw === 'Edit C:/p/a.css',
  'a file step keeps its whole path in the raw text'
);

// a file step read from another CLI's output (13)
check(words.file('Edited', 'src/a/b.js').text === 'Editing b.js', 'file: edited');
check(words.file('Read', 'src/a/b.js').text === 'Reading b.js', 'file: read');
check(words.file('Created', 'src/a/b.js').text === 'Writing b.js', 'file: created');
check(words.file('Edited', 'src/a/b.js').raw === 'Edited src/a/b.js', 'file: raw');

console.log('plain-words: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
