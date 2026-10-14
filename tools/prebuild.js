// Technically Not tools · prebuild.js — Runs before every build (`npm run dist` calls it first):
// writes the small files a build ships from build-resources/, a folder git ignores. Nothing here
// reads a key, a secret or a private setting, so anyone can build the app with it.
//
//   build-info.json           the mark of a release build (desktop/build-info.js reads it)
//   auth-config.json          an empty one, only when none is there: the build lists the file, and
//                             an empty one means no sign-in client is set up
//   THIRD-PARTY-NOTICES.txt   the licence of every package the build packs
//                             (tools/third-party-notices.js)
//
// Run:  node tools/prebuild.js
'use strict';
const fs = require('fs');
const path = require('path');

const BUILD_RESOURCES = path.join(__dirname, '..', 'build-resources');

// The two small settings files. An auth-config.json that is already there is left alone.
// → the names of the files it wrote.
function writeBuildFiles(folder = BUILD_RESOURCES) {
  const written = [];
  fs.mkdirSync(folder, { recursive: true });

  // The release mark: the installed app then ignores developer overrides and keeps DevTools
  // closed. A copy run from source never reads it.
  fs.writeFileSync(path.join(folder, 'build-info.json'), JSON.stringify({ release: true }) + '\n');
  written.push('build-info.json');

  const authConfig = path.join(folder, 'auth-config.json');
  if (!fs.existsSync(authConfig)) {
    fs.writeFileSync(authConfig, '{}\n');
    written.push('auth-config.json');
  }
  return written;
}

function prebuild() {
  const written = writeBuildFiles();
  console.log('prebuild: ' + written.join(', ') + ' → build-resources/');

  // writes build-resources/THIRD-PARTY-NOTICES.txt and says so itself
  require('./third-party-notices');
}

if (require.main === module) prebuild();

module.exports = { writeBuildFiles, prebuild };
