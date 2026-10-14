// Parses every script in src/scripts and desktop/ without running it and checks that index.html
// references each src/scripts file. Run: node tools/check-syntax.js
const fs = require('fs'),
  path = require('path');
const root = path.join(__dirname, '..'),
  dir = path.join(root, 'src', 'scripts');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failed = 0;
for (const name of fs
  .readdirSync(dir)
  .filter(f => f.endsWith('.js'))
  .sort()) {
  const rel = 'src/scripts/' + name;
  try {
    new Function(fs.readFileSync(path.join(dir, name), 'utf8'));
  } catch (e) {
    failed++;
    console.log('SYNTAX', rel, e.message);
  }
  if (!html.includes('src="' + rel + '"')) {
    failed++;
    console.log('NOT LOADED by index.html:', rel);
  }
}

// Main-process files (a syntax error there stops the desktop app at launch) and the auth relay in
// server/. Checked as CommonJS module bodies.
for (const folder of ['desktop', 'server']) {
  const dirPath = path.join(root, folder);
  if (!fs.existsSync(dirPath)) continue;
  for (const name of fs
    .readdirSync(dirPath)
    .filter(f => f.endsWith('.js'))
    .sort()) {
    const src = fs.readFileSync(path.join(dirPath, name), 'utf8').replace(/^#!.*/, '');
    try {
      new Function('require', 'module', 'exports', '__dirname', '__filename', src);
    } catch (e) {
      failed++;
      console.log('SYNTAX', folder + '/' + name, e.message);
    }
  }
}

// The desktop checks' own files (a syntax error in one opens Electron's error box on the user's
// screen and the run waits on it: seen 2026-10-07 and again 2026-10-09). The checks and the
// main-process halves (tests/*.main.js) as CommonJS module bodies, the window halves (tests/*.js,
// run by run.js inside an async function) as async function bodies.
{
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor,
    base = path.join(root, 'tools', 'desktop-check');
  const list = sub =>
    fs.existsSync(path.join(base, sub))
      ? fs
          .readdirSync(path.join(base, sub))
          .filter(f => f.endsWith('.js'))
          .sort()
          .map(f => (sub ? sub + '/' : '') + f)
      : [];
  for (const rel of [...list(''), ...list('tests')]) {
    const src = fs.readFileSync(path.join(base, rel), 'utf8').replace(/^#!.*/, ''),
      body = rel.startsWith('tests/') && !rel.endsWith('.main.js');
    try {
      body
        ? new AsyncFunction(src)
        : new Function('require', 'module', 'exports', '__dirname', '__filename', src);
    } catch (e) {
      failed++;
      console.log('SYNTAX', 'tools/desktop-check/' + rel, e.message);
    }
  }
}

// Technically Not's hidden program skills (desktop/hidden-skills/*.md): the app refuses to start if
// one is malformed, so check them here.
try {
  const h = require(path.join(root, 'desktop', 'hidden-skills.js'));
  h.lines('every-agent', { 'tnai-mesh-hint': 'x' });
  h.lines('claude-code', { 'tnai-mesh-hint': 'x' });
  h.lines('opencode', { 'tnai-mesh-hint': 'x' });
} catch (e) {
  failed++;
  console.log('HIDDEN SKILLS', e.message);
}
for (const [, ref] of html.matchAll(/(?:src|href)="(src\/[^"]+)"/g)) {
  if (!fs.existsSync(path.join(root, ref))) {
    failed++;
    console.log('MISSING file referenced by index.html:', ref);
  }
}

// The loading cover is taken away by 56-startup-loader.js, so that script is the last one of the
// page. It stood in the middle once, with 65 scripts after it, and a reload showed the old frame
// for a third of a second before the thread layout was built (2026-10-12).
const loaded = [...html.matchAll(/<script src="src\/scripts\/([^"]+)"/g)].map(match => match[1]);
if (loaded.length && loaded[loaded.length - 1] !== '56-startup-loader.js') {
  failed++;
  console.log(
    'ORDER: 56-startup-loader.js must be the last script of index.html; a new script goes before it. Last now:',
    loaded[loaded.length - 1]
  );
}
console.log(
  failed ? failed + ' problem(s)' : 'OK: all scripts parse and every src/ reference resolves'
);
process.exit(failed ? 1 : 0);
