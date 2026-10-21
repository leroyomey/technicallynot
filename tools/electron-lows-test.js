// Technically Not · tools/electron-lows-test.js — plain-Node checks for four Low findings of the
// Electron security audit (docs/notes/audit-2026-10-07/app-1-electron-security.md):
//   #4  a Live preview page opens only a few links (fixed earlier, no test before),
//   #7  a release build ignores the tests' fake microphone (TN_VOICE_FAKE),
//   #8  saving onto the project folder (or any folder) is refused before a temp file is made,
//   #9  the inside-the-project check keeps letter case on Linux and macOS,
//   #10 the view-only file window loads nothing from the web.
// Each check fails on the code from before the fix. Run: node tools/electron-lows-test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const DESKTOP = path.join(__dirname, '..', 'desktop');
let passed = 0;
let failed = 0;

function check(ok, label) {
  if (ok) passed++;
  else failed++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-electron-lows-'));
const userData = path.join(temp, 'userData');
fs.mkdirSync(userData);

// A stand-in for Electron: only what fs-service.js and file-viewer.js touch when they load.
const electron = {
  app: { getPath: () => userData },
  dialog: {},
  shell: {},
  net: {},
  protocol: { registerSchemesAsPrivileged: () => {} },
  session: {},
  BrowserWindow: function () {},
  WebContentsView: function () {},
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? electron : realLoad.call(this, request, ...rest);
};

// Runs a few lines in a fresh Node and returns what they print.
const runNode = (code, env) =>
  execFileSync(process.execPath, ['-e', code], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  }).trim();

async function main() {
  // #7: the fake microphone. From source it is honored; in a release copy it is not. A
  // build-info.js without voiceFake() is the code before the fix, where every reader took the
  // variable itself.
  const readFake = file =>
    'const info = require(' +
    JSON.stringify(file) +
    '); const fake = typeof info.voiceFake === "function" ? info.voiceFake()' +
    ' : process.env.TN_VOICE_FAKE || ""; console.log(info.release + "|" + fake)';
  const fromSource = runNode(readFake(path.join(DESKTOP, 'build-info.js')), {
    TN_VOICE_FAKE: 'beep',
  }).split('|')[1];
  check(fromSource === 'beep', '#7 a run from source still uses the fake microphone');

  // A release copy: build-info.js beside a package.json carrying the release mark.
  const releaseCopy = path.join(temp, 'release');
  fs.mkdirSync(path.join(releaseCopy, 'desktop'), { recursive: true });
  fs.copyFileSync(
    path.join(DESKTOP, 'build-info.js'),
    path.join(releaseCopy, 'desktop', 'build-info.js')
  );
  fs.writeFileSync(path.join(releaseCopy, 'package.json'), '{"tnaiRelease":true}');
  const fromRelease = runNode(readFake(path.join(releaseCopy, 'desktop', 'build-info.js')), {
    TN_VOICE_FAKE: 'beep',
  });
  check(fromRelease === 'true|', '#7 a release copy ignores TN_VOICE_FAKE (' + fromRelease + ')');

  // Nothing else reads the variable itself, so the release rule cannot be passed by.
  const directReaders = ['main.js', 'voice-hold.js', 'voice-service.js'].filter(file =>
    /process\.env\.TN_VOICE_FAKE/.test(fs.readFileSync(path.join(DESKTOP, file), 'utf8'))
  );
  check(
    directReaders.length === 0,
    '#7 no app file reads TN_VOICE_FAKE past build-info.js (' + directReaders.join(', ') + ')'
  );

  // A project folder for #8 and #9.
  const projects = path.join(temp, 'projects');
  const project = path.join(projects, 'app');
  fs.mkdirSync(path.join(project, 'sub'), { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'project-folder.json'),
    JSON.stringify({ root: project, projects: [project] })
  );
  const fsService = require(path.join(DESKTOP, 'fs-service.js'));
  await fsService.loadRoot();
  check(fsService.root() === project, 'test setup: the project folder is connected');

  // #8: saving onto the project folder itself, and onto a folder inside it.
  const bytes = new Uint8Array([104, 105]);
  const ontoProject = await fsService.write('', bytes);
  const leftBeside = fs.readdirSync(projects).filter(name => name.endsWith('.tmp'));
  check(
    !ontoProject.ok && ontoProject.error.name === 'TypeMismatchError',
    '#8 saving onto the project folder is refused as a folder (' +
      JSON.stringify(ontoProject.error) +
      ')'
  );
  check(leftBeside.length === 0, '#8 no temp file is left beside the project folder');
  const ontoFolder = await fsService.write('sub', bytes);
  check(
    !ontoFolder.ok && ontoFolder.error.name === 'TypeMismatchError',
    '#8 saving onto a folder inside the project is refused'
  );
  const normal = await fsService.write('note.txt', bytes);
  check(
    normal.ok && fs.readFileSync(path.join(project, 'note.txt'), 'utf8') === 'hi',
    '#8 an ordinary save still works'
  );

  // #9: as on Linux, the folder "App" beside the project "app" is another folder.
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  let otherCase;
  let sameCase;
  try {
    otherCase = await fsService.stat(path.join('..', 'App', 'secret.txt'));
    sameCase = await fsService.stat('note.txt');
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
  }
  check(
    !otherCase.ok && otherCase.error.name === 'SecurityError',
    '#9 on Linux a path into "App" is outside the project "app" (' +
      JSON.stringify(otherCase.error || otherCase.value) +
      ')'
  );
  check(sameCase.ok, '#9 on Linux a file of the project itself is still inside');

  // #4 (fixed earlier, checked here because it had no test): a Live preview page that keeps asking
  // opens at most a few links, and only web ones.
  const { openOutside, MAX_OPENS } = require(path.join(DESKTOP, 'open-outside.js'));
  const openedLinks = [];
  for (let n = 0; n < 20; n++)
    openOutside(link => openedLinks.push(link), 'https://example.com/?n=' + n, 'frame:test');
  check(
    openedLinks.length === MAX_OPENS && MAX_OPENS <= 3,
    '#4 twenty asks from one page open ' + openedLinks.length + ' links'
  );
  openOutside(link => openedLinks.push(link), 'file:///C:/x.exe', 'frame:other');
  check(openedLinks.length === MAX_OPENS, '#4 a link that is not http(s) never opens');

  // #10: the viewer loads only its own file and Chromium's PDF viewer.
  const viewer = require(path.join(DESKTOP, 'file-viewer.js'));
  const mayLoad = viewer.viewerMayLoad || (() => true);
  check(mayLoad('tnai-view://abc/picture.svg'), '#10 the shown file itself loads');
  check(mayLoad('data:image/png;base64,AAAA'), '#10 in-page data loads');
  check(
    mayLoad('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html'),
    '#10 the PDF viewer loads'
  );
  check(!mayLoad('https://tracker.example/pixel.png'), '#10 a web address is refused');
  check(!mayLoad('http://127.0.0.1:5000/x'), '#10 a local web address is refused');
  check(!mayLoad('file:///C:/Users/secret.txt'), '#10 another file on disk is refused');
  const viewerText = fs.readFileSync(path.join(DESKTOP, 'file-viewer.js'), 'utf8');
  check(
    /webRequest\.onBeforeRequest\([\s\S]{0,120}viewerMayLoad/.test(viewerText),
    '#10 the viewer session cancels every request the rule refuses'
  );
}

main()
  .catch(error => {
    failed++;
    console.log('FAIL ' + (error.stack || error));
  })
  .finally(() => {
    fs.rmSync(temp, { recursive: true, force: true });
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exitCode = failed ? 1 : 0;
  });
