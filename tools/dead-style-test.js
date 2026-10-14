// Technically Not tools · dead-style-test.js — the test of tools/dead-style.js, in plain Node:
// which names count as written by a script, and which rules go from a sheet. It reads made-up
// sheets and scripts written here and changes no file. Run: node tools/dead-style-test.js
const path = require('path');
const {
  namesInSheets,
  producersOf,
  joinersOf,
  splitSelectors,
  outsideOptionalParts,
  withoutDeadRules,
} = require('./dead-style.js');

let passed = 0;
let failed = 0;

function check(label, condition, got) {
  if (condition) passed++;
  else {
    failed++;
    console.log('FAIL ' + label + (got === undefined ? '' : '  got ' + JSON.stringify(got)));
  }
}

// ---- names ----
{
  const sheets = [
    [
      path.join('styles', 'a.css'),
      '.ap-row{color:red}\n#agentsPage .ap-team{color:blue}\n.apple{}',
    ],
    [path.join('styles', 'b.css'), '.tpg-nav{display:none}'],
  ];
  const found = namesInSheets(sheets, ['ap-', 'tpg-', 'agentsPage']);
  check(
    'the names of the asked beginnings are found, and no other',
    [...found.keys()].sort().join() === 'agentsPage,ap-row,ap-team,tpg-nav',
    [...found.keys()].sort()
  );
  check('each with its sheets', [...found.get('ap-row')].join() === 'a.css', [
    ...found.get('ap-row'),
  ]);

  const code = [
    ['one.js', "const row = el('div', 'ap-row');"],
    ['two.js', "document.querySelector('.ap-team'); const css = '#agentsPage .ap-team{top:0}';"],
    ['three.js', 'box.className = `tpg-${kind}`;'],
  ];
  check('a name a script writes is alive', producersOf('ap-row', code).join() === 'one.js');
  check(
    'a name that only stands after a dot or a hash is looked for, not written: dead',
    producersOf('ap-team', code).length === 0 && producersOf('agentsPage', code).length === 0,
    producersOf('ap-team', code)
  );
  check('a longer name is not the shorter one', producersOf('ap', code).length === 0);
  check(
    'a script that joins a name from parts is named for a check by hand',
    joinersOf(['ap-', 'tpg-'], code).join() === 'three.js',
    joinersOf(['ap-', 'tpg-'], code)
  );
}

// ---- selectors ----
check(
  'a list is split at its own commas only',
  splitSelectors('.a:is(.b, .c), .d[data-x="1,2"]').length === 2,
  splitSelectors('.a:is(.b, .c), .d[data-x="1,2"]')
);
check(
  'what stands in :not(), :is() and :where() is left out',
  outsideOptionalParts('.a:not(.dead) :is(.dead, .b) > .c:where(.dead)') === '.a  > .c',
  outsideOptionalParts('.a:not(.dead) :is(.dead, .b) > .c:where(.dead)')
);

// ---- rules ----
{
  const sheet = [
    '/* kept: a live rule */',
    '.live {',
    '  color: red;',
    '}',
    '',
    '/* goes with its rule */',
    '#gone .live {',
    '  color: blue;',
    '}',
    '',
    '.live,',
    '.dead-one {',
    '  color: green;',
    '}',
    '.live:not(.dead-one) {',
    '  color: gray;',
    '}',
    '.dead-one-more {',
    '  color: black;',
    '}',
    '@media (max-width: 600px) {',
    '  .dead-one {',
    '    top: 0;',
    '  }',
    '}',
    '@media (max-width: 900px) {',
    '  .dead-one {',
    '    top: 0;',
    '  }',
    '  .live {',
    '    top: 1px;',
    '  }',
    '}',
    '.live {',
    '  > .dead-one {',
    '    left: 0;',
    '  }',
    '  content: "} .dead-one {";',
    '}',
    '@keyframes dead-one {',
    '  to {',
    '    opacity: 0;',
    '  }',
    '}',
    '',
  ].join('\n');
  const result = withoutDeadRules(sheet, ['gone', 'dead-one']);
  const text = result.text;
  check('four rules go', result.removed.length === 4, result.removed);
  check(
    'a rule whose every selector needs a dead name goes, with the comment over it',
    !text.includes('#gone') && !text.includes('goes with its rule')
  );
  check('a list with one live selector stays whole', text.includes('.live,\n.dead-one {'));
  check('a dead name inside :not() does not take the rule', text.includes('.live:not(.dead-one)'));
  check('a longer name that only starts like a dead one stays', text.includes('.dead-one-more {'));
  check('an @media left empty goes', !text.includes('max-width: 600px'));
  check(
    'an @media with a live rule stays, without its dead rule',
    text.includes('max-width: 900px') && /900px\) \{\s*\.live \{/.test(text),
    text.slice(text.indexOf('@media'), text.indexOf('@media') + 80)
  );
  check(
    'a rule nested in a live rule goes alone, and a brace inside a string does not count',
    !text.includes('> .dead-one') && text.includes('content: "} .dead-one {";'),
    text.slice(text.lastIndexOf('.live {'))
  );
  check('keyframes are never touched', text.includes('@keyframes dead-one'));
  check('the first rule and its comment stay', text.startsWith('/* kept: a live rule */\n.live {'));
  check(
    'with no dead name nothing changes',
    withoutDeadRules(sheet, []).text === sheet &&
      withoutDeadRules(sheet, ['nowhere']).removed.length === 0
  );
}

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
