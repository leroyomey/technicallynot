// Technically Not tools · comparison-hint-test.js — a prompt that compares
// (desktop/comparison-hint.js): which prompts make the agent answer with a chart, which do not, and
// that the line reaches Claude Code's prompt hook. Run: node tools/comparison-hint-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const hint = require('../desktop/comparison-hint');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

// 1. prompts that compare
const comparing = [
  'Compare the bundle size of the last five builds',
  'React vs Vue for this page?',
  'What is the difference between the two installers?',
  'Which page is the slowest now?',
  'Which of these folders takes more room?',
  'How much memory does each agent use?',
  'How many files changed per agent today?',
  'Rank the skills by how often they are read',
  'How has the installer size changed over the last six builds?',
  'Speed before and after the fix?',
  'Make a chart of the test times',
];
for (const prompt of comparing) check(hint.asks(prompt), 'compares: ' + prompt);

// 2. prompts that do not
const plain = [
  'Fix the bug in the thread list',
  'Rename the button to Save',
  'Release queue in a bulletin board style list.',
  'Yes, build it as shown',
  '',
];
for (const prompt of plain) check(!hint.asks(prompt), 'does not compare: ' + prompt);
check(
  !hint.asks('<task-notification>compare sizes</task-notification>'),
  'an app notice is not a question'
);
check(!hint.asks('[from Nyx] compare the two results'), 'another agent is not the user');
check(!hint.asks('Fix this:\n```\nconst a = compare(x, y);\n```'), 'words in code do not count');
check(!hint.asks('compare ' + 'x'.repeat(5000)), 'a pasted wall of text is not a question');

// 3. the line, and where it goes
check(/```chart/.test(hint.forPrompt('Compare the sizes')), 'the line names the chart block');
check(hint.forPrompt('Fix the bug') === '', 'no line for a plain prompt');
const hooks = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'agent-hooks.js'), 'utf8');
check(
  /require\('\.\/comparison-hint'\)\.forPrompt\(msg\.prompt/.test(hooks),
  'Claude Code gets it with the prompt'
);
const rule = fs.readFileSync(
  path.join(__dirname, '..', 'desktop', 'hidden-skills', '46-charts.md'),
  'utf8'
);
check(/for: every-agent/.test(rule) && /prompt compares/.test(rule), 'every CLI gets the rule');

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
