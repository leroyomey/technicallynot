// Test of the developer self-test switch in desktop/build-info.js: node
// tools/selftest-switch-test.js (plain Node). The environment variable TNAI_SELFTEST must mean
// nothing in a release build, and the app's files must ask build-info.js for it instead of reading
// the variable themselves (an installed app with the variable set
// started a second copy on the same settings folder, registered no snapshot shortcut and skipped
// CLI update checks).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const desktop = path.join(__dirname, '..', 'desktop');
const buildInfoFile = path.join(desktop, 'build-info.js');

// What build-info.js answers in a fresh process. resourcesFolder: the folder it takes for the
// app's resources (a build-info.json there with "release": true makes the copy a release build).
function buildInfoWith(variable, resourcesFolder) {
  const env = { ...process.env };
  delete env.TNAI_SELFTEST;
  if (variable !== null) env.TNAI_SELFTEST = variable;
  const program =
    'process.resourcesPath = process.argv[1];' +
    ' console.log(JSON.stringify(require(process.argv[2])));';
  const run = spawnSync(process.execPath, ['-e', program, resourcesFolder, buildInfoFile], {
    env,
    encoding: 'utf8',
  });
  return JSON.parse(run.stdout);
}

// ---- the switch itself ----
{
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai selftest switch '));
  const sourceResources = path.join(scratch, 'source');
  const releaseResources = path.join(scratch, 'release');
  fs.mkdirSync(sourceResources);
  fs.mkdirSync(releaseResources);
  fs.writeFileSync(path.join(releaseResources, 'build-info.json'), '{"release":true}');

  const off = buildInfoWith(null, sourceResources);
  check(
    'from source, variable not set: off',
    off.release === false && off.selfTest === false && off.selfTestName === '',
    off
  );
  const on = buildInfoWith('agent-mesh', sourceResources);
  check(
    'from source, variable set: on, with the name of the test',
    on.selfTest === true && on.selfTestName === 'agent-mesh',
    on
  );
  const release = buildInfoWith('agent-mesh', releaseResources);
  check(
    'a release build with the variable set: off, and no test name',
    release.release === true && release.selfTest === false && release.selfTestName === '',
    release
  );
  fs.rmSync(scratch, { recursive: true, force: true });
}

// ---- nobody else reads the variable ----
{
  // These files read it themselves and each pairs it with its own "not a release build" or "not a
  // packaged app" condition on the same statement. Every other file must ask build-info.js.
  const MAY_READ_IT = ['build-info.js', 'discord-alerts.js', 'updater.js', 'user-auth.js'];
  const readers = fs
    .readdirSync(desktop)
    .filter(name => name.endsWith('.js'))
    .filter(name =>
      /process\s*\.\s*env\s*\.\s*TNAI_SELFTEST/.test(
        fs.readFileSync(path.join(desktop, name), 'utf8')
      )
    )
    .sort();
  check(
    'only the named files read TNAI_SELFTEST from the environment',
    JSON.stringify(readers) === JSON.stringify(MAY_READ_IT),
    readers
  );

  // the four files that read it now take the switch from build-info.js
  for (const name of ['main.js', 'snapshot-service.js', 'cli-updates.js', 'fs-service.js']) {
    const text = fs.readFileSync(path.join(desktop, name), 'utf8');
    check(
      name + ' takes the switch from build-info.js',
      /selfTest[^;]*=\s*require\(\s*'\.\/build-info'\s*\)/.test(text),
      name
    );
  }
}

console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
process.exit(failed ? 1 : 0);
