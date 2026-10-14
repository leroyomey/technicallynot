// Technically Not tools · release-notes-test.js: the grouping rule of tools/release-notes.js, and
// that the website's changelog builder groups the same way (when the website repo sits beside this
// one). node tools/release-notes-test.js
const path = require('path'),
  fs = require('fs');
const { group, groupList, kindOf, problems } = require('./release-notes.js');
let passed = 0,
  failed = 0;
const check = (name, ok, got) => {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
};
const mixed = [
  '- New: one',
  '- Changed: two',
  '- New: three',
  '- Fixed: four',
  '- Faster: five',
  '- Removed: six',
  '- Something with no kind',
  '- Fixed: seven',
  '- Added: eight',
  '- Improved: nine',
];
const want = [
  '- New: one',
  '- New: three',
  '- Added: eight',
  '- Changed: two',
  '- Faster: five',
  '- Improved: nine',
  '- Removed: six',
  '- Fixed: four',
  '- Fixed: seven',
  '- Something with no kind',
];
check(
  'a mixed list comes out New, Changed, Removed, Fixed, no kind',
  JSON.stringify(groupList(mixed)) === JSON.stringify(want),
  groupList(mixed)
);
check(
  'lines inside a kind keep their order',
  groupList(['- Fixed: b', '- Fixed: a']).join() === '- Fixed: b,- Fixed: a'
);
check('a grouped list is left as it is', group(want.join('\n')) === want.join('\n'));
check(
  'grouping twice changes nothing more',
  group(group(mixed.join('\n'))) === group(mixed.join('\n'))
);
check(
  'text before and after the list stays where it is',
  group('Technically Not 9.9.9\n\n- Fixed: a\n- New: b\n\nThanks for testing.') ===
    'Technically Not 9.9.9\n\n- New: b\n- Fixed: a\n\nThanks for testing.',
  group('Technically Not 9.9.9\n\n- Fixed: a\n- New: b\n\nThanks for testing.')
);
check(
  'a line that continues a change travels with it',
  group('- Fixed: a\n  more about a\n- New: b') === '- New: b\n- Fixed: a\n  more about a',
  group('- Fixed: a\n  more about a\n- New: b')
);
check(
  'text with no list is left alone',
  group('Technically Not 9.9.9') === 'Technically Not 9.9.9'
);
check(
  'the kind is the first word, also in bold',
  kindOf('- **Fixed:** x') === 'fix' &&
    kindOf('New: x') === 'new' &&
    kindOf('- Faster: x') === 'changed' &&
    kindOf('- The app no longer crashes') === 'other'
);
check(
  'a mixed list is reported, with the line that is out of place',
  problems(mixed.join('\n')).some(p => /out of order/.test(p)) &&
    problems(mixed.join('\n')).some(p => /no kind/.test(p))
);
check(
  'a grouped list with kinds has nothing to report',
  problems(want.slice(0, 9).join('\n')).length === 0,
  problems(want.slice(0, 9).join('\n'))
);

// The website's own copy of the rule (changelog.js) must give the same order.
const site = path.join(__dirname, '..', '..', 'Project TN.ai Landing Page', 'changelog.js');
if (fs.existsSync(site)) {
  const strip = l => l.map(x => x.replace(/^- /, ''));
  let web = null;
  try {
    web = require(site).grouped;
  } catch (e) {
    check('the website changelog builder loads', false, String(e.message).slice(0, 120));
  }
  if (web)
    check(
      'the website changelog builder groups the same way',
      JSON.stringify(web(strip(mixed))) === JSON.stringify(strip(want)),
      web(strip(mixed))
    );
} else
  console.log(
    'note the website repo is not beside this one: its changelog builder was not compared'
  );
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
