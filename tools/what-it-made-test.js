// Test of "What it made" (src/scripts/170-what-it-made.js and desktop/what-it-made.js):
// node tools/what-it-made-test.js
//
// What is found from a conversation's record, in the shapes each CLI's reader writes (Claude Code,
// Codex, OpenCode, Cursor Agent, Copilot CLI): a picture, video, document, data file or page the
// agent wrote; a file a command named (with its start time; commands that only look are left out);
// a site from `tnai preview` / `tnai server claim` or an address a command printed. How a data file
// is read (CSV with quotes, TSV, JSON) and drawn honestly (bar, line, or a table). And the main
// process's side on a real temp folder: a file inside the thread's folder only, changed since a
// command's start, a document's text with its cut, a video's size, and whether a local
// address answers (a real local server, a closed port, an address that is not local). No window
// opens, no CLI starts.
'use strict';

const fs = require('fs');
const net = require('net');
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- the window's pure part: the script without the bridge keeps only what can be tested ----
const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'scripts', '170-what-it-made.js'),
  'utf8'
);
const sandbox = { window: {}, console, URL };
vm.runInNewContext(source, sandbox, { filename: '170-what-it-made.js' });
const made = sandbox.window.TnaiWhatItMade;
check('the pure part is there without the bridge', !!made && typeof made.find === 'function');

const act = (verb, what, extra = {}) => ({ kind: 'act', id: 'a1', verb, what, ...extra });
const kinds = list => list.map(item => item.kind + ':' + item.file + ':' + item.how);

// Claude Code and Copilot CLI write one file with "Wrote"
check(
  'Claude Code / Copilot: a picture it wrote',
  same(kinds(made.find(act('Wrote', 'public/hero.png'))), ['picture:public/hero.png:wrote'])
);
check(
  'a document and a data file it wrote',
  same(kinds(made.find(act('Wrote', 'PRICING.md'))), ['document:PRICING.md:wrote']) &&
    same(kinds(made.find(act('Wrote', 'data/sales.csv'))), ['data:data/sales.csv:wrote'])
);
check(
  'a page it wrote, and a video',
  same(kinds(made.find(act('Wrote', 'mock.html'))), ['page:mock.html:wrote']) &&
    same(kinds(made.find(act('Wrote', 'out/demo.mp4'))), ['video:out/demo.mp4:wrote'])
);
check(
  'a code file it wrote is no "thing made"',
  made.find(act('Wrote', 'src/App.jsx')).length === 0
);
check('an edit is a change, not a thing made', made.find(act('Edited', 'README.md')).length === 0);

// Codex names the files of one patch joined by ", "
check(
  'Codex: a patch of several files',
  same(kinds(made.find(act('Wrote', 'notes.md, src/a.js, chart.json'))), [
    'document:notes.md:wrote',
    'data:chart.json:wrote',
  ])
);

// Cursor Agent's image tool
check(
  'Cursor Agent: "Made an image" counts as a picture whatever its name',
  same(kinds(made.find(act('Made an image', 'a cat on a sofa'))), ['picture:a cat on a sofa:wrote'])
);

// a command that names files: only with a start time, only when it is not one that only looks
const ran = (command, at) => act('Ran', command, { full: command, at });
check(
  'a command that named a picture and a video it made (inferred, with its start time)',
  same(
    made
      .find(ran('ffmpeg -i in.mov -vf scale=640 out/clip.mp4 && magick a.png b.png', 1000))
      .map(item => item.kind + ':' + item.file + ':' + item.since),
    ['video:in.mov:1000', 'video:out/clip.mp4:1000', 'picture:a.png:1000', 'picture:b.png:1000']
  )
);
check(
  'a script run with node may make a chart picture',
  made.find(ran('node tools/plot.js > out/plot.png', 5)).length === 1
);
check(
  'a command with no start time adds nothing',
  made.find(ran('magick a.png b.png', 0)).length === 0
);
check('a command that only looks adds nothing', made.find(ran('cat notes.md', 9)).length === 0);
check(
  'at most six files from one command',
  made.find(ran('zip ' + Array.from({ length: 9 }, (_, i) => 'p' + i + '.png').join(' '), 7))
    .length === 6
);

// sites
const sites = (entry, result) => made.sitesIn(entry, result).map(site => site.how + ' ' + site.url);
check(
  'a site it showed with tnai preview',
  same(sites(ran('tnai preview http://localhost:5173 desktop', 1), null), [
    'showed http://localhost:5173/',
  ])
);
check(
  'a site it claimed with tnai server claim',
  same(sites(ran('tnai.cmd server claim "http://127.0.0.1:3000/app"', 1), null), [
    'showed http://127.0.0.1:3000/app',
  ])
);
check(
  'a local address a dev server printed',
  same(
    sites(ran('npm run dev', 1), { text: '  VITE ready\n  ➜  Local:   http://localhost:5173/\n' }),
    ['started http://localhost:5173/']
  )
);
check(
  'an address on another computer is not a site here',
  sites(ran('curl https://example.com', 1), { text: 'see http://example.com:8080/' }).length === 0
);
check(
  'a site needs a command',
  made.sitesIn(act('Wrote', 'http://localhost:1/'), null).length === 0
);

// a data file as a table, and its chart
const csv = 'month,"sales, total",notes\nJan,120,"a ""good"" start"\nFeb,180,\nMar,90,dip\n';
const table = made.readTable(csv, 'sales.csv');
check(
  'CSV: quoted cells, a quote inside quotes, an empty cell',
  same(table.head, ['month', 'sales, total', 'notes']) &&
    same(table.rows[0], ['Jan', '120', 'a "good" start']) &&
    same(table.rows[1], ['Feb', '180', ''])
);
const chart = made.chartOf(table);
check(
  'its chart: a bar of the first number column, named by the first word column',
  chart.type === 'bar' &&
    chart.label === 'sales, total' &&
    same(
      chart.values.map(point => point.name + '=' + point.value),
      ['Jan=120', 'Feb=180', 'Mar=90']
    )
);
check('TSV', made.chartOf(made.readTable('a\tb\nx\t1\ny\t2\n', 'f.tsv')).values.length === 2);
check(
  'JSON: a list of objects',
  made.chartOf(made.readTable('[{"day":"Mon","visits":3},{"day":"Tue","visits":5}]', 'v.json'))
    .label === 'visits'
);
check(
  'JSON: a list of numbers',
  made.chartOf(made.readTable('[1.5, 2, 3]', 'n.json')).values.length === 3
);
check(
  'JSON: an object holding a list',
  made.readTable('{"rows":[{"a":1},{"a":2}]}', 'o.json').rows.length === 2
);
check(
  'a column that only counts rows (1, 2, 3 …) is not drawn',
  made.chartOf(made.readTable('id,name\n1,a\n2,b\n3,c\n', 'ids.csv')).type === 'table'
);
check(
  'no number column: shown as a table',
  made.chartOf(made.readTable('name,city\nAna,Oslo\nBo,Rome\n', 'p.csv')).type === 'table'
);
const long = 'x,y\n' + Array.from({ length: 30 }, (_, i) => 'r' + i + ',' + i * 2).join('\n');
check('more than 24 rows: a line', made.chartOf(made.readTable(long, 'l.csv')).type === 'line');
check(
  'numbers with a currency sign or a thousands comma',
  made.chartOf(made.readTable('k,v\na,"$1,200"\nb,"$900"\n', 'm.csv')).type === 'bar'
);
check('not a table: nothing to draw', made.readTable('just one line', 'x.csv') === null);
check('broken JSON: nothing to draw', made.readTable('{nope', 'x.json') === null);

// ---- the main process's side, on a real folder ----
const designs = require(path.join(__dirname, '..', 'desktop', 'thread-designs.js'));
const main = require(path.join(__dirname, '..', 'desktop', 'what-it-made.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-made-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-made-out-'));
fs.mkdirSync(path.join(root, 'docs'));
fs.writeFileSync(path.join(root, 'docs', 'PLAN.md'), '# Plan\n\nThree steps.\n');
fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(main.TEXT_MAX + 10));
fs.writeFileSync(path.join(root, 'clip.mp4'), Buffer.alloc(64));
fs.writeFileSync(path.join(outside, 'secret.md'), 'no');
designs.init({
  sessionOf: paneId => (paneId === 'p1' ? { cwd: root } : null),
  worktreeOf: () => null,
  projectRoot: () => root,
});

async function mainChecks() {
  const there = main.check('p1', 'docs/PLAN.md', 0);
  check('check: a file in the thread’s folder', there.ok === true && there.name === 'PLAN.md');
  check(
    'check: a file outside the thread’s folders is refused',
    main.check('p1', path.join(outside, 'secret.md'), 0).ok === false
  );
  check(
    'check: a file older than the command that named it was not made by it',
    main.check('p1', 'docs/PLAN.md', { since: Date.now() + 60000 }).ok === false
  );
  check(
    'check: the same file counts when it changed after the command started',
    main.check('p1', 'docs/PLAN.md', { since: Date.now() - 1000 }).ok === true
  );
  check(
    'check: a thread with no folder of its own reads only the open project',
    main.check('nobody', 'docs/PLAN.md').ok === true &&
      main.check('nobody', path.join(outside, 'secret.md')).ok === false
  );
  check(
    'check: a network path is refused',
    main.check('p1', '\\\\server\\share\\a.md', 0).ok === false
  );

  const doc = await main.text('p1', 'docs/PLAN.md');
  check('text: a document’s words', doc.ok && doc.text.startsWith('# Plan') && doc.cut === false);
  const big = await main.text('p1', 'big.txt');
  check(
    'text: a long file is cut and says so',
    big.ok && big.cut === true && big.text.length === main.TEXT_MAX
  );
  check('text: a video is not read as text', (await main.text('p1', 'clip.mp4')).ok === false);

  const clip = main.check('p1', 'clip.mp4');
  check('check: a video is found with its size (it plays on the PC)', clip.ok && clip.size === 64);

  // a real local server answers; a closed port and a non-local address do not
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  check(
    'alive: a local server that answers',
    (await main.alive('http://127.0.0.1:' + port + '/')) === true
  );
  await new Promise(resolve => server.close(resolve));
  check(
    'alive: the same port once it closed',
    (await main.alive('http://127.0.0.1:' + port + '/')) === false
  );
  check(
    'alive: an address that is not on this computer is never asked',
    (await main.alive('http://example.com:80/')) === false
  );
  check(
    'alive: an address with a user name is refused',
    (await main.alive('http://a:b@localhost:' + port)) === false
  );
  check('alive: not an address', (await main.alive('localhost')) === false);
}

mainChecks()
  .catch(error => check('main checks threw: ' + error.message, false))
  .finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    check('the temp folders are gone', !fs.existsSync(root) && !fs.existsSync(outside));
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
