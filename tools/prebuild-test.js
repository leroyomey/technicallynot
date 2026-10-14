// Test of tools/prebuild.js: node tools/prebuild-test.js (plain Node, no build). The step before a
// build writes the release mark and, only when none is there, an empty sign-in settings file. It
// writes into a folder made for this test, never into the project.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeBuildFiles } = require('./prebuild');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-prebuild-test-')), 'out');
const read = name => fs.readFileSync(path.join(folder, name), 'utf8');

// a first run, into a folder that does not exist yet
const first = writeBuildFiles(folder);
check('the folder is made', fs.existsSync(folder));
check(
  'the release mark is written',
  JSON.parse(read('build-info.json')).release === true,
  read('build-info.json')
);
check(
  'with no sign-in settings there, an empty file is written',
  read('auth-config.json').trim() === '{}',
  read('auth-config.json')
);
check('it names both files', first.join() === 'build-info.json,auth-config.json', first);
check(
  'nothing else is written',
  fs.readdirSync(folder).sort().join() === 'auth-config.json,build-info.json',
  fs.readdirSync(folder)
);

// a second run, after another step put sign-in settings there
fs.writeFileSync(path.join(folder, 'auth-config.json'), '{"someClientId":"abc"}\n');
fs.writeFileSync(path.join(folder, 'build-info.json'), '{"release":false}\n');
const second = writeBuildFiles(folder);
check(
  'sign-in settings that are already there are left alone',
  JSON.parse(read('auth-config.json')).someClientId === 'abc',
  read('auth-config.json')
);
check('and are not named as written', second.join() === 'build-info.json', second);
check(
  'the release mark is always written again',
  JSON.parse(read('build-info.json')).release === true
);

fs.rmSync(path.dirname(folder), { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed ? 1 : 0);
