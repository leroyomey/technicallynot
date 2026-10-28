// Test of desktop/script-guard.js: node tools/script-guard-test.js (plain Node). Which requests of
// the app's window may go ahead: script files only from the app's own code folders, everything
// that cannot run code untouched, and no way around it with "..", another drive or odd spelling.
const path = require('path');
const { pathToFileURL } = require('url');
const { mayLoad, guard } = require('../desktop/script-guard.js');

let passed = 0,
  failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const root = path.resolve(__dirname, '..');
const url = (...parts) => pathToFileURL(path.join(...parts)).href;

// ---- what the app loads today ----
for (const file of [
  ['src', 'scripts', '10-live-terminals.js'],
  ['src', 'vendor', 'floating-ui', 'floating-ui.core.umd.min.js'],
  ['node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'],
  ['desktop', 'snapshot-frame.js'],
])
  check('a script of the app: ' + file.join('/'), mayLoad(url(root, ...file), 'script', root));
check(
  "a frame showing one of the app's own small pages",
  mayLoad(url(root, 'desktop', 'snapshot-frame.html'), 'subFrame', root)
);

// ---- what must not run ----
const outside = path.resolve(root, '..', 'some-other-project');
const refused = [
  ['a script in another folder', url(outside, 'x.js'), 'script'],
  ['a script in the app root itself (not a code folder)', url(root, 'x.js'), 'script'],
  ['a script in docs', url(root, 'docs', 'x.js'), 'script'],
  [
    'a script in a folder whose name starts like a code folder',
    url(root, 'src-evil', 'x.js'),
    'script',
  ],
  ['".." out of a code folder', pathToFileURL(root).href + '/src/../x.js', 'script'],
  ['".." written with percent signs', pathToFileURL(root).href + '/src/%2e%2e/x.js', 'script'],
  ['a page from disk in a frame', url(outside, 'page.html'), 'subFrame'],
  ['a plug-in object from disk', url(outside, 'thing.swf'), 'object'],
  ['a script on a network share', 'file://some-server/share/x.js', 'script'],
  ['an address that is not one', 'file://%zz', 'script'],
];
for (const [name, address, kind] of refused)
  check('refused: ' + name, mayLoad(address, kind, root) === false, address);

if (process.platform === 'win32') {
  check(
    'Windows: the same folder in other capitals is the same folder',
    mayLoad(url(root.toUpperCase(), 'src', 'scripts', 'a.js'), 'script', root.toLowerCase())
  );
  check(
    'Windows: another drive is another place',
    mayLoad('file:///Z:/src/scripts/a.js', 'script', root) === false
  );
}

// ---- what is left alone ----
for (const kind of ['image', 'stylesheet', 'font', 'media', 'mainFrame', 'xhr', 'other'])
  check('not judged, it cannot run code: ' + kind, mayLoad(url(outside, 'a.bin'), kind, root));

// ---- kinds Electron may give a worker's file or an import(): judged by the file's name ----
for (const kind of ['other', 'xhr', 'webbundle', 'a-kind-a-later-electron-adds']) {
  for (const name of ['worker.js', 'module.mjs', 'old.cjs', 'thing.wasm', 'CAPITALS.JS']) {
    check(
      'refused: a code file outside the code folders asked for as "' + kind + '": ' + name,
      mayLoad(url(outside, name), kind, root) === false
    );
  }
  check(
    'the app\'s own code file asked for as "' + kind + '" goes ahead',
    mayLoad(url(root, 'src', 'scripts', 'a.js'), kind, root)
  );
  check(
    'a file that is not code by its name asked for as "' + kind + '" is left alone',
    mayLoad(url(outside, 'data.json'), kind, root) &&
      mayLoad(url(outside, 'picture.png'), kind, root)
  );
}
for (const kind of ['image', 'stylesheet', 'font', 'media', 'mainFrame', 'ping', 'cspReport'])
  check(
    'not judged even for a .js name, it cannot run code: ' + kind,
    mayLoad(url(outside, 'x.js'), kind, root)
  );

// ---- one listener per session: a second one would silently replace the guard ----
{
  const fs = require('fs');
  const desktop = path.join(root, 'desktop');
  const listeners = fs
    .readdirSync(desktop)
    .filter(name => name.endsWith('.js'))
    .filter(name =>
      /\.\s*onBeforeRequest\s*\(/.test(fs.readFileSync(path.join(desktop, name), 'utf8'))
    );

  // file-viewer.js keeps its own listener on its own session (the "tnai-file-viewer" partition,
  // which blocks outside loads from a shown file): a different session, so it cannot replace this
  // guard. Any other file with a listener can.
  const viewer = fs.readFileSync(path.join(desktop, 'file-viewer.js'), 'utf8');
  const viewerOwnSession = /fromPartition\(\s*'tnai-file-viewer'\s*\)/.test(viewer);
  const others = listeners.filter(name => !(name === 'file-viewer.js' && viewerOwnSession));
  check(
    'only script-guard.js puts an onBeforeRequest listener on the app session',
    JSON.stringify(others) === '["script-guard.js"]',
    listeners
  );
}

check("http is not this guard's business", mayLoad('http://127.0.0.1:5173/app.js', 'script', root));
check('nor https', mayLoad('https://example.com/app.js', 'script', root));

// ---- an installed app: the root is the archive ----
{
  const asar = path.join(
    path.sep === '\\' ? 'C:\\' : '/',
    'Programs',
    'App',
    'resources',
    'app.asar'
  );
  check(
    'installed: a script inside the archive',
    mayLoad(url(asar, 'src', 'scripts', 'a.js'), 'script', asar)
  );
  check(
    'installed: a script beside the archive is refused',
    mayLoad(url(path.dirname(asar), 'x.js'), 'script', asar) === false
  );
}

// ---- the listener ----
{
  let filter = null,
    listener = null;
  guard({ webRequest: { onBeforeRequest: (f, l) => ((filter = f), (listener = l)) } }, root);
  check(
    'the guard listens to requests over file: only',
    JSON.stringify(filter) === '{"urls":["file://*/*"]}',
    filter
  );
  const answer = details => {
    let out;
    listener(details, value => (out = value));
    return out;
  };
  check(
    "the listener lets the app's script through",
    answer({ url: url(root, 'src', 'scripts', 'a.js'), resourceType: 'script' }).cancel === false
  );
  check(
    'and cancels a script from elsewhere',
    answer({ url: url(outside, 'x.js'), resourceType: 'script' }).cancel === true
  );
}

console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed ? 1 : 0);
