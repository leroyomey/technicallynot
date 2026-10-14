// Technically Not tools · desktop-check/tests/files-code-colors.js — a file read in the Files
// column is colored by its language (134). A file of the sample project is opened by a press on
// its row and has colored parts; then the reader's own function is given small files of several
// languages: each is colored with more than one color, its text is unchanged, signs of HTML stay
// text, and a plain text file and an unknown kind are left as they are.
// Returns {ok, log}.
const log = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await wait(100);
  }
  return null;
};

try {
  window.TnaiThreads.open();
  window.TnaiThreadSide.open('files');
  const side = window.TnaiThreads.slot('side');
  const row = await until(() =>
    [...side.querySelectorAll('.repo-file[data-real-path]')].find(file =>
      /README\.md/.test(file.textContent)
    )
  );
  check(!!row, 'setup: the sample project shows README.md in the Files column');
  row?.click();
  const box = await until(() => {
    const text = side.querySelector('.tnt-fileview-text');
    return text && !text.hidden && text.textContent.trim() ? text : null;
  });
  check(
    !!box,
    'a press on the file opens it in the column (row: ' +
      row?.className +
      ', path: ' +
      (row?.dataset.realPath || 'none') +
      ', reader hidden: ' +
      side.querySelector('.tnt-fileview')?.hidden +
      ', note: ' +
      side.querySelector('.tnt-fileview-note')?.textContent +
      ')'
  );
  if (!box) return { ok, log };
  check(
    box?.dataset.language === 'markdown' && !!box.querySelector('[class^="hljs-"]'),
    'it is read as Markdown and has colored parts (' +
      (box?.querySelectorAll('[class^="hljs-"]').length || 0) +
      ')'
  );

  // The colors used in a box, as a count of different ones.
  const colorsIn = el =>
    new Set([...el.querySelectorAll('span')].map(part => getComputedStyle(part).color)).size;
  const paint = window.TnaiCodeColors.paint;
  const samples = {
    'app.js':
      '// adds two\nfunction add(a, b) {\n  return a + b + 1 + "<b>";\n}\nconst x = new Map();',
    'tool.py': '# adds two\ndef add(a, b):\n    return a + b + 1\nname = "x"\nclass Box:\n    pass',
    'data.json': '{ "name": "x", "count": 3, "on": true }',
    'look.css': '/* a card */\n.card > a:hover { color: #fff; margin: 4px; }',
    'page.html': '<!-- note -->\n<div class="a"><p>Hello</p></div>',
    'run.ps1': '# lists\nGet-ChildItem -Path $home | Where-Object { $_.Length -gt 10 }',
    'main.rs': '// adds\nfn add(a: i32) -> i32 { let b = 2; a + b }',
    'conf.yml': '# set\nname: x\ncount: 3',
  };
  for (const [name, text] of Object.entries(samples)) {
    const language = paint(box, text, name);
    check(
      !!language && box.textContent === text && colorsIn(box) >= 2,
      name + ': colored as ' + language + ' with ' + colorsIn(box) + ' colors, its text unchanged'
    );
  }
  paint(box, samples['app.js'], 'app.js');
  check(!box.querySelector('b'), 'signs of HTML in a file stay text');
  await wait(400);
  console.log('TNAI_SHOT:files-code-colors-look');
  await wait(800);
  const plain = 'function not(code) { return "text"; }';
  check(
    paint(box, plain, 'notes.txt') === '' && !box.children.length && box.textContent === plain,
    'a plain text file is left as it is'
  );
  check(
    paint(box, plain, 'thing.xyz') === '' && !box.children.length,
    'a kind that is not known is left as it is'
  );
} catch (error) {
  ok = false;
  log.push('ERROR ' + (error?.stack || error));
}
return { ok, log };
