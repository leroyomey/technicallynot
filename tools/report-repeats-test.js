// Technically Not tools · report-repeats-test.js — dead ends from agents' reports
// (desktop/report-repeats.js): the same problem in two different task reports becomes one group,
// one report alone or a problem marked done does not, old reports are left out, and a prompt about
// the problem names it once per session. Also: the note a CLI without a prompt hook gets at the
// end of its prompt stays out of the user's words in the thread (thread-log-text.js).
// Run: node tools/report-repeats-test.js
'use strict';
const repeats = require('../desktop/report-repeats.js');
const { splitPrompt } = require('../desktop/thread-log-text.js');

let passed = 0;
let failed = 0;

function check(ok, name) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name);
  }
}

const NOW = Date.parse('2026-10-28T12:00:00Z');
const DAY = 864e5;
const result = (id, name, daysAgo, summary) => ({ id, name, at: NOW - daysAgo * DAY, summary });

// 1. the issue part of a report item
check(
  repeats.issueOf('Electron binary missing after npm install → fix: run install.js (fix 90%)') ===
    'Electron binary missing after npm install',
  'the fix part is cut off'
);

// 2. the same problem in two reports: one group, with its count and the latest report
{
  const entries = [
    result('a1', 'Sol', 3, {
      blockers: ['Electron binary missing after npm install → fix: run install.js (fix 90%)'],
    }),
    result('b2', 'Kestrel', 1, {
      found: [
        'npm install left the Electron binary missing again → fix: node install.js (fix 85%)',
      ],
    }),
    result('c3', 'Rook', 2, { found: ['The thread list flickers on resize'] }),
  ];
  const groups = repeats.find(entries, () => false, NOW);
  check(groups.length === 1, 'one repeated problem');
  check(groups[0]?.count === 2, 'named by two reports');
  check(groups[0]?.last.name === 'Kestrel', 'the latest report');

  // the same report twice is not a repeat
  const once = repeats.find([entries[0], { ...entries[0] }], () => false, NOW);
  check(once.length === 0, 'one report alone is no repeat');

  // marked claimed or done: left out
  const marked = repeats.find(entries, id => id === 'a1', NOW);
  check(marked.length === 0, 'a marked item is left out');

  // too old: left out
  const old = entries.map(entry => ({ ...entry, at: NOW - 60 * DAY }));
  check(repeats.find(old, () => false, NOW).length === 0, 'old reports are left out');

  // chatter is not a report
  const chatter = entries.map(entry => ({ ...entry, chatter: true }));
  check(repeats.find(chatter, () => false, NOW).length === 0, 'chatter is left out');

  // in words for tnai context
  const text = repeats.contextText(groups);
  check(/Came up in 2 task reports: Electron binary missing/.test(text), 'tnai context words');
  check(/Kestrel, Oct 27/.test(text), 'who and when');

  // a prompt about it: named once per session
  const said = new Set();
  const first = repeats.promptText(groups, 'Fix the Electron binary after npm install', said);
  check(/this task touches a problem that came up in 2 task reports/.test(first), 'with a prompt');
  check(repeats.promptText(groups, 'Electron binary npm install', said) === '', 'once');
  check(repeats.promptText(groups, 'Make the page blue', new Set()) === '', 'not when unrelated');
}

// 3. the note at the end of a prompt is not the user's words in the thread
{
  const sent =
    'Fix the Electron binary after npm install' +
    "\n\n[Technically Not: learned from this project's past tasks (measured; follow it unless your task needs otherwise): Slow commands here: `npm test` median 1m 30s.]" +
    '\n\n(Skills attached to you for this session: tnai-verification)';
  const split = splitPrompt(sent);
  check(split.words === 'Fix the Electron binary after npm install', 'the user words only');
  check(
    split.added.some(part => /learned from this project/.test(part)),
    'the note kept beside'
  );
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
