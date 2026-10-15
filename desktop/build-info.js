/*
 * * Technically Not desktop · build-info.js — Whether this copy is a release build. A release build
 * * ignores every TNAI_* developer override (TNAI_ACCOUNTS_URL, test keys and endpoints, the
 * * self-test hook, the web bridge) and keeps DevTools closed, whatever the exe is called.
 * * Release = any of these (each can only turn release ON; nothing outside the
 * * integrity-checked app.asar can turn it off):
 * * - the app code runs from an app.asar (every installed or built copy; the Electron fuses in
 * * package.json `build.electronFuses` make the exe load only its app.asar and refuse one whose
 * * contents changed, so renaming the exe to electron.exe or editing files cannot give a dev copy);
 * * - package.json `tnaiRelease: true`, written into the packaged package.json by electron-builder
 * * (`build.extraMetadata`), so even code extracted from an app.asar and run with a stock Electron
 * is
 * * still a release build;
 * * - resources/build-info.json { "release": true } (written before a release build), kept as an
 * extra
 * * signal only. A copy run from source (npm start, desktop self-tests) has none of them, so
 * * developer overrides keep working there.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const fromAsar = /\.asar([\\/]|$)/i.test(__dirname);
let file = false;
try {
  file =
    JSON.parse(fs.readFileSync(path.join(process.resourcesPath || '', 'build-info.json'), 'utf8'))
      ?.release === true;
} catch {}
let baked = false;
try {
  baked = require('../package.json').tnaiRelease === true;
} catch {}
const release = fromAsar || baked || file;

// Release as the app's own code says it, without the file in the resources folder. For a decision
// that picks a program to run: in a run from source the resources folder is inside the project
// (Electron's own), and a file put there must not be what makes a program beside it trusted.
const releaseByCode = fromAsar || baked;

// The developer self-test switch (the environment variable TNAI_SELFTEST, whose value is the name
// of the test being run). It is read here and nowhere else, so that a release build never follows
// it: an installed app with the variable set in the user's environment would otherwise start a
// second copy on the same settings folder, register no snapshot shortcut and skip CLI update
// checks.
const selfTestName = release ? '' : process.env.TNAI_SELFTEST || '';
const selfTest = selfTestName !== '';

module.exports = { release, releaseByCode, fromAsar, selfTest, selfTestName };
