// Technically Not tools · desktop-check/tests/code-highlight.js — 20's syntax colors per language
// (through 09's hidden editor, which drives TnaiCodeHighlight), big files colored, above 1 MB
// plain. Prints timings. native confirm stubbed. Returns {ok, log}.
const log = [],
  wait = ms => new Promise(r => setTimeout(r, ms));
let ok = true;
const check = (cond, label) => {
  log.push((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const until = async (fn, ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await wait(25);
  }
  return null;
};
const native = window.tnaiNative,
  hl = window.TnaiCodeHighlight;
const row = p => document.querySelector('.repo-real-tree [data-real-path="' + p + '"]');
const area = () => document.querySelector('.repo-editor-text');
const layer = () => document.querySelector('.repo-code-layer code');
const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const kinds = () =>
  new Set([...layer().querySelectorAll('span')].map(s => s.className.replace('tk-', '')));
const tokenText = (kind, text) =>
  [...layer().querySelectorAll('.tk-' + kind)].some(s => s.textContent.includes(text));
const layerText = () => layer().textContent.replace(/\n $/, '');

check(!!hl, 'TnaiCodeHighlight loaded');
check(!!(await until(() => row('src'))), 'project folder restored');

// Sample files in several languages, written to the real project folder on disk.
const enc = s => new TextEncoder().encode(s);
const samples = {
  'demo.py':
    '@cache\ndef greet(name: str) -> str:\n    """Say hi."""\n    return f"Hello {name}"  # comment\n\nclass Greeter(Base):\n    count = 42\n',
  'demo.css':
    '/* theme */\n.card:hover, #main > a {\n  color: #56773a;\n  margin: 1.5em 0;\n  --gap: 4px;\n}\n@media (max-width: 900px) { .card { width: calc(100% - 2px) } }\n',
  'demo.json':
    '{\n  "name": "tnai",\n  "version": 3,\n  "private": true,\n  "tags": ["a", null]\n}\n',
  'page.html':
    '<!doctype html>\n<html lang="en">\n<!-- note -->\n<head><style>body { color: #333 }</style></head>\n<body class="app">\n  <p id=x>Hi &amp; bye</p>\n  <script>const n = 1; console.log("x", n);</script>\n</body>\n</html>\n',
  'notes.md':
    '# Title\n\nSome **bold**, *em* and `code` with a [link](https://example.com).\n\n```js\nconst a = 1; // c\n```\n\n- item one\n',
  'run.ps1':
    '<# help #>\nparam([string]$Path = "C:\\temp")\n# comment\nif ($true) { Get-ChildItem -Path $Path | Write-Output }\n',
  'conf.yaml': '# settings\nname: tnai\nitems:\n  - id: 1\n    label: "first"\nenabled: true\n',
};
const unit =
  'export function row(index, value) {\n  // one line of a large generated file\n  const label = "row " + index;\n  return { index, value: value * 2.5, label, ok: true };\n}\n';

// ~300 KB: colored, tokenized every frame
samples['big.js'] = unit.repeat(Math.ceil(300000 / unit.length));

// ~900 KB: colored, tokenized after a typing pause
samples['bigger.js'] = unit.repeat(Math.ceil(900000 / unit.length));
samples['huge.js'] = unit.repeat(Math.ceil(1200000 / unit.length)); // above the 1 MB limit: plain
for (const [p, text] of Object.entries(samples)) {
  const r = await native.fs.write(p, enc(text));
  check(r?.ok, 'wrote ' + p + ' (' + text.length + ' chars)');
}

// 09 confirmDiscard: a native dialog would hang the run (seen 2026-09-30)
window.confirm = () => true;
window.TnaiRoute('files');
await wait(200);
window.TnaiProjectFiles.reload();
check(
  !!(await until(() => row('huge.js') && row('bigger.js') && row('demo.py'), 8000)),
  'sample files listed in the tree'
);

async function open(p) {
  window.TnaiProjectFiles.open(p);
  const t0 = performance.now();
  const done = await until(
    () =>
      area() && hl.last?.path === p && document.querySelector('.repo-code-wrap')?.contains(area()),
    10000
  );
  await frames();
  return done ? Math.round(performance.now() - t0) : -1;
}
const expect = {
  'demo.py': [
    'Python',
    { k: 'def', f: 'greet', s: 'Hello', c: '# comment', m: '@cache', t: 'Greeter', n: '42' },
  ],
  'demo.css': [
    'CSS',
    { c: 'theme', g: '.card:hover', p: 'color', n: '#56773a', v: '--gap', k: '@media', f: 'calc' },
  ],
  'demo.json': ['JSON', { p: '"name"', s: '"tnai"', n: 'true' }],
  'page.html': [
    'HTML',
    { g: '<html', a: 'lang', s: '"en"', c: 'note', m: 'doctype', n: '&amp;', k: 'const' },
  ],
  'notes.md': [
    'Markdown',
    { h: '# Title', v: '**bold**', s: '`code`', f: '[link]', k: 'const', c: '// c' },
  ],
  'run.ps1': [
    'PowerShell',
    {
      c: '# comment',
      k: 'param',
      v: '$Path',
      f: 'Get-ChildItem',
      p: '-Path',
      n: '$true',
      t: '[string]',
    },
  ],
  'conf.yaml': ['YAML', { c: '# settings', p: 'label', s: '"first"', n: 'true' }],
};
for (const [p, [name, tokens]] of Object.entries(expect)) {
  const ms = await open(p);
  const missing = Object.entries(tokens)
    .filter(([k, t]) => !tokenText(k, t))
    .map(([k, t]) => k + ':' + t);
  check(
    ms >= 0 && hl.last.mode === 'color',
    p + ' opened and colored (' + hl.last.ms + ' ms highlight)'
  );
  check(
    !missing.length,
    p + ' tokens colored' + (missing.length ? ' — missing ' + missing.join(', ') : '')
  );
  check(
    document.querySelector('.repo-code-lang')?.textContent === name &&
      !document.querySelector('.repo-code-lang').hidden,
    p + ' header shows language "' + name + '"'
  );
  check(layerText() === area().value, p + ' colored layer text equals the editor text');
}

// Large files: colored up to the limit (the editor's typing/Save/scroll-alignment checks were
// removed with the File repository page in the purple redesign; the hidden editor can't take focus,
// and 20 now serves 23's Build File viewer).
for (const p of ['big.js', 'bigger.js']) {
  await open(p);
  check(
    hl.last.mode === 'color' && !!layer().querySelector('.tk-k'),
    p + ' (' + hl.last.chars + ' chars) colored; tokenize ' + hl.last.ms + ' ms'
  );
}

await open('huge.js');
check(
  hl.last.mode === 'plain' && !document.querySelector('.repo-code-wrap').classList.contains('hl'),
  'huge.js (' + hl.last.chars + ' chars) above limit ' + hl.limit + ' stays plain'
);
check(
  /plain \(large file\)/.test(document.querySelector('.repo-code-lang').textContent) &&
    getComputedStyle(area()).color !== 'rgba(0, 0, 0, 0)',
  'plain mode: visible text, label says plain'
);

return { ok, log };
