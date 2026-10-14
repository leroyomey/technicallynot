// Technically Not tools · fetch-node-runtime.js — Downloads the official Node.js runtime that the
// installer ships at resources/node/node(.exe), into build-resources/node/<os>-<arch>/ (a folder
// git ignores). The app runs its small Node scripts with it: the `tnai` and agent command stand-ins
// in every terminal panel, the watcher that makes sure the app quits, and the helper that lists a
// closed panel's processes (desktop/node-helper.js).
//
// Usage: node tools/fetch-node-runtime.js            this computer's runtime
//        node tools/fetch-node-runtime.js --all      every runtime the builds need
//        node tools/fetch-node-runtime.js mac-arm64 linux-x64
//
// Every download, and the file already on disk, is checked against the SHA-256 pinned in this file
// (TARGETS below); a file that does not match is not written and the script exits 1. Node's own
// licence text is placed beside the program as LICENSE, pinned the same way (LICENCE below).
// Running it twice downloads nothing the second time. Plain Node, no dependencies.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const crypto = require('crypto');

// The Node version inside the app's Electron, so a script behaves the same under either program.
// Electron 44.4.5 embeds Node 24.21.0. After an Electron update, read the new one with
// ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe -e
// "console.log(process.versions.node)" and change this line. If nodejs.org has no release with that
// exact number, take the nearest released patch of the same major version.
const NODE_VERSION = '24.21.0';

// One entry per build target, named as electron-builder names them (${os}-${arch} in
// package.json). published: the file's name in the release folder and in SHASUMS256.txt.
// Windows has the bare program as its own download; Mac and Linux have it inside an archive.
//
// The SHA-256 values are pinned here, in git, on purpose. The folder the program is fetched into
// is git-ignored, so a file swapped there shows in no diff; a value changed here does.
//   publishedSha256: of the downloaded file, as SHASUMS256.txt of the release lists it. Read from
//     https://nodejs.org/dist/v24.21.0/SHASUMS256.txt on 2026-10-10. Every download is compared
//     with it before anything is taken out of it or written.
//   programSha256: of the program that ships, where the release lists it. On Windows the download
//     is the program, so it is the same value, and the file on disk and the program in a finished
//     build are compared with it every time. On Mac and Linux the program is bin/node inside the
//     archive, and the release lists no value for it (''): there the note written when the
//     verified archive was unpacked (runtime.json) says what the program must hash to. That note
//     lies beside the program, so on Mac and Linux a swap of both is not caught; the fetch runs on
//     the machine that builds for that platform, right before the build.
// For a new NODE_VERSION: open SHASUMS256.txt of that release, copy its five values into
// publishedSha256, and set win-x64's programSha256 to the same value as its publishedSha256.
const TARGETS = {
  'win-x64': {
    published: 'win-x64/node.exe',
    program: 'node.exe',
    publishedSha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
    programSha256: 'ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32',
  },
  'mac-x64': {
    published: 'node-v' + NODE_VERSION + '-darwin-x64.tar.gz',
    program: 'node',
    publishedSha256: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097',
    programSha256: '',
  },
  'mac-arm64': {
    published: 'node-v' + NODE_VERSION + '-darwin-arm64.tar.gz',
    program: 'node',
    publishedSha256: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
    programSha256: '',
  },
  'linux-x64': {
    published: 'node-v' + NODE_VERSION + '-linux-x64.tar.gz',
    program: 'node',
    publishedSha256: '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff',
    programSha256: '',
  },
  'linux-arm64': {
    published: 'node-v' + NODE_VERSION + '-linux-arm64.tar.gz',
    program: 'node',
    publishedSha256: '724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5',
    programSha256: '',
  },
};

// Node's own licence text, which must travel with every copy of the program. It is placed beside
// the program as LICENSE, for every target, and ships with it in resources/node. Taken from the
// tag of this release in Node's repository; its SHA-256 is pinned here like the program's (read
// from that address on 2026-10-10). For a new NODE_VERSION: download the file of the new tag,
// read it, and put its SHA-256 here.
const LICENCE = {
  name: 'LICENSE',
  url: 'https://raw.githubusercontent.com/nodejs/node/v' + NODE_VERSION + '/LICENSE',
  sha256: '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace',
};

const RELEASE_URL = 'https://nodejs.org/dist/v' + NODE_VERSION + '/';
const OUTPUT_ROOT = path.join(__dirname, '..', 'build-resources', 'node');

// The note written next to the program: which release it is and what it must hash to.
// tools/check-package.js reads it in a finished build.
const NOTE_NAME = 'runtime.json';

// The target for the computer this script runs on, e.g. "win-x64".
function ownTarget(platform = process.platform, arch = process.arch) {
  const osNames = { win32: 'win', darwin: 'mac', linux: 'linux' };
  return (osNames[platform] || platform) + '-' + arch;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// One file out of a tar archive (already unzipped), by the end of its name. A tar file is a row of
// 512-byte blocks: a header block with the name and size, then the content rounded up to whole
// blocks. → the file's bytes, or null when no entry has that name.
function fileFromTar(tar, nameEnd) {
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');

    // two empty blocks end the archive
    if (!name) return null;
    const size = parseInt(header.toString('ascii', 124, 136).replace(/[\0 ]/g, ''), 8) || 0;
    const kind = header.toString('ascii', 156, 157);
    const isFile = kind === '0' || kind === '\0';
    if (isFile && name.endsWith(nameEnd)) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return null;
}

// Downloads a URL into memory. Follows a redirect only to another https address.
function download(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      const status = response.statusCode;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url);
        if (next.protocol !== 'https:' || redirectsLeft < 1) {
          reject(new Error('refused a redirect from ' + url));
          return;
        }
        resolve(download(next.href, redirectsLeft - 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(url + ' answered ' + status));
        return;
      }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);

    // a stalled connection must not hang a build
    request.setTimeout(120000, () => request.destroy(new Error(url + ' timed out')));
  });
}

// The note that lies beside a fetched program. It only says what the file is, for a person and for
// the report of tools/check-package.js. On Windows no check trusts it; for a program taken out of
// a Mac or Linux archive it is the record of what that program hashed to (noteVouches below).
function writeNote(folder, target) {
  const note = {
    node: NODE_VERSION,
    from: RELEASE_URL + target.published,
    published: target.published,
    publishedSha256: target.publishedSha256,
    programSha256: target.programSha256,
  };
  fs.writeFileSync(path.join(folder, NOTE_NAME), JSON.stringify(note, null, 2) + '\n');
}

// Does this note vouch for a program with this hash, taken out of this target's archive? It must
// name this Node version, this target's archive with the archive hash pinned in git, and the
// program's hash. Used only where the release lists no hash for the program itself.
function noteVouches(note, target, programHash) {
  return (
    !!note &&
    note.node === NODE_VERSION &&
    note.published === target.published &&
    note.publishedSha256 === target.publishedSha256 &&
    note.programSha256 === programHash
  );
}

// True when the folder already holds this target's program. The file on disk is hashed on every
// run and compared with the pinned value where there is one (Windows), else with the note written
// when the verified archive was unpacked (Mac and Linux).
function alreadyFetched(folder, target) {
  try {
    const programHash = sha256(fs.readFileSync(path.join(folder, target.program)));
    if (target.programSha256) return programHash === target.programSha256;
    const note = JSON.parse(fs.readFileSync(path.join(folder, NOTE_NAME), 'utf8'));
    return noteVouches(note, target, programHash);
  } catch {
    return false;
  }
}

// Places Node's licence text beside a fetched program. The file on disk is hashed on every run; a
// missing or changed one is downloaded again and compared with the pinned value before it is
// written. → a few words for the report line. Throws on a mismatch, writing nothing.
async function fetchLicence(folder, { get, log, licence }) {
  const licenceFile = path.join(folder, licence.name);
  let onDisk = '';
  try {
    onDisk = sha256(fs.readFileSync(licenceFile));
  } catch {
    // not there yet
  }
  if (onDisk === licence.sha256) return 'licence text already there';

  log('downloading ' + licence.url);
  const downloaded = await get(licence.url);
  const actual = sha256(downloaded);
  if (actual !== licence.sha256) {
    throw new Error(
      'SHA-256 mismatch for the licence text ' +
        licence.url +
        ' (pinned ' +
        licence.sha256 +
        ', got ' +
        actual +
        '); it was not written'
    );
  }
  fs.writeFileSync(licenceFile, downloaded);
  return 'licence text fetched, SHA-256 is the pinned one';
}

// Fetches one target: the program, then Node's licence text beside it. get: the download
// function, targets and licence: the pinned values, all replaceable in tests. → a line saying
// what happened. Throws on a mismatch.
async function fetchTarget(name, options = {}) {
  const { outputRoot = OUTPUT_ROOT, get = download, log = console.log } = options;
  const { targets = TARGETS, licence = LICENCE } = options;
  const target = targets[name];
  if (!target) {
    throw new Error('unknown target ' + name + ' (known: ' + Object.keys(targets).join(', ') + ')');
  }
  const folder = path.join(outputRoot, name);
  const programLine = await fetchProgram(name, target, folder, { get, log });
  return programLine + '; ' + (await fetchLicence(folder, { get, log, licence }));
}

// The program of one target. Throws on a mismatch, leaving nothing new.
async function fetchProgram(name, target, folder, { get, log }) {
  if (alreadyFetched(folder, target)) {
    if (!target.programSha256) {
      return name + ': already there, Node ' + NODE_VERSION + ', as the note from its fetch says';
    }

    // the note is written again, so a note that was changed or deleted is put right
    writeNote(folder, target);
    return name + ': already there, Node ' + NODE_VERSION + ', SHA-256 is the pinned one';
  }

  log(name + ': downloading ' + RELEASE_URL + target.published);
  const downloaded = await get(RELEASE_URL + target.published);
  const actual = sha256(downloaded);
  if (actual !== target.publishedSha256) {
    throw new Error(
      name +
        ': SHA-256 mismatch for ' +
        target.published +
        ' (pinned ' +
        target.publishedSha256 +
        ', got ' +
        actual +
        '); nothing was written'
    );
  }

  // Windows: the download is the program. Mac and Linux: the program is bin/node in the archive.
  const program = target.published.endsWith('.tar.gz')
    ? fileFromTar(zlib.gunzipSync(downloaded), '/bin/node')
    : downloaded;
  if (!program) throw new Error(name + ': no bin/node inside ' + target.published);
  const programHash = sha256(program);
  if (target.programSha256 && programHash !== target.programSha256) {
    throw new Error(
      name +
        ': the program inside ' +
        target.published +
        ' is not the pinned one; nothing was written'
    );
  }

  fs.mkdirSync(folder, { recursive: true });
  const programFile = path.join(folder, target.program);

  // written under another name first, so a stopped run never leaves half a program in place
  fs.writeFileSync(programFile + '.part', program, { mode: 0o755 });
  fs.renameSync(programFile + '.part', programFile);
  writeNote(folder, { ...target, programSha256: programHash });
  const megabytes = (program.length / 1048576).toFixed(1);
  const pinned = target.programSha256
    ? 'SHA-256 is the pinned one'
    : 'the archive is the pinned one; bin/node taken out of it, SHA-256 ' + programHash;
  return name + ': Node ' + NODE_VERSION + ', ' + megabytes + ' MB, ' + pinned;
}

async function main(words) {
  const names = words.includes('--all')
    ? Object.keys(TARGETS)
    : words.length
      ? words
      : [ownTarget()];
  const unknown = names.filter(name => !TARGETS[name]);
  if (unknown.length) {
    console.error(
      'Unknown target: ' + unknown.join(', ') + '. Known: ' + Object.keys(TARGETS).join(', ')
    );
    return 1;
  }
  for (const name of names) console.log(await fetchTarget(name));
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error('FAIL ' + error.message);
      process.exitCode = 1;
    }
  );
}

module.exports = {
  NODE_VERSION,
  TARGETS,
  LICENCE,
  NOTE_NAME,
  ownTarget,
  noteVouches,
  fileFromTar,
  fetchTarget,
  sha256,
};
