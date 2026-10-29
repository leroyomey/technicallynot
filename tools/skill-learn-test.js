// Technically Not tools · skill-learn-test.js — the learning check (desktop/skill-stats.js
// `edited`, `learnCheck`; held in agent-hooks.js at a task's Stop): a task that fixed a bug, was
// corrected or added new code, and changed no skill, is asked once to decide which skill learns
// from it; a task that changed a skill, said why none needed it, or did nothing of the kind is not;
// the Write skills setting switches it off. Run: node tools/skill-learn-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('../desktop/skill-stats.js');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-skill-learn-'));
stats.init({ dir: folder });
const project = 'C:\\work\\shop\\';

// 1. a bug fixed in code, no skill touched: asked once
stats.prompted('a', 'The send button is broken, fix it');
stats.edited('a', project + 'src\\scripts\\11-agents-live.js', 'Edit');
check(/fixed a bug/.test(stats.learnCheck('a', 'Fixed it.')), 'a bug fix is asked');
check(stats.learnCheck('a', 'Fixed it.') === '', 'only once per task');

// 2. the same, but a skill was improved: not asked
stats.prompted('a', 'Another bug: the list is wrong');
stats.edited('a', project + 'src\\scripts\\119-thread-list.js', 'Edit');
stats.edited('a', project + '.claude\\skills\\tnai-threads\\SKILL.md', 'Edit');
check(stats.learnCheck('a', 'Fixed.') === '', 'a skill edit answers it');

// 3. the reply already says why no skill needs it
stats.prompted('a', 'fix the crash');
stats.edited('a', project + 'desktop\\main.js', 'Edit');
check(stats.learnCheck('a', 'Done. No skill needed: a one-off typo.') === '', 'said in the reply');

// 4. a correction, even without code
stats.prompted('a', "No, that's not what I asked");
check(/corrected you/.test(stats.learnCheck('a', 'Changed the wording.')), 'a correction is asked');

// 5. new code files
stats.prompted('a', 'Add a page that lists the backups');
stats.edited('a', project + 'src\\scripts\\192-backups.js', 'Write');
check(/new code files/.test(stats.learnCheck('a', 'Built it.')), 'new code is asked');

// 6. an ordinary task: a question, docs only, an edit to an existing file without a bug
stats.prompted('a', 'What does this function do?');
check(stats.learnCheck('a', 'It reads the file.') === '', 'a question is not asked');
stats.prompted('a', 'Update the README wording');
stats.edited('a', project + 'README.md', 'Edit');
check(stats.learnCheck('a', 'Updated.') === '', 'a docs edit is not asked');
stats.prompted('a', 'Make the button blue');
stats.edited('a', project + 'src\\styles\\29-thread-view.css', 'Edit');
check(stats.learnCheck('a', 'Done.') === '', 'a plain change is not asked');

// 7. app hidden skills, library skills and CLAUDE.md count as skills
for (const file of [
  project + 'desktop\\hidden-skills\\50-decisions.md',
  'C:\\Users\\me\\AppData\\Roaming\\TechnicallyNot.ai\\skills\\x\\SKILL.md',
  project + 'CLAUDE.md',
  project + '.agents\\skills\\y\\SKILL.md',
]) {
  stats.prompted('b', 'fix the bug');
  stats.edited('b', project + 'desktop\\main.js', 'Edit');
  stats.edited('b', file, 'Edit');
  check(stats.learnCheck('b', 'Fixed.') === '', 'a skill file: ' + path.basename(file));
}

// 8. Write skills off: never asked
stats.prompted('c', 'fix the bug');
stats.edited('c', project + 'desktop\\main.js', 'Edit');
check(stats.learnCheck('c', 'Fixed.', false) === '', 'off with the setting');

// 9. panes are apart
stats.prompted('d', 'fix the bug');
stats.prompted('e', 'fix the bug');
stats.edited('d', project + 'desktop\\main.js', 'Edit');
check(stats.learnCheck('e', 'Fixed.') === '', 'another pane’s edits do not count');
check(/fixed a bug/.test(stats.learnCheck('d', 'Fixed.')), 'its own do');

stats.flush();
fs.rmSync(folder, { recursive: true, force: true });
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
