// Technically Not tools · packaged-node.js — What a finished build says about "run as Node": the
// state of Electron's runAsNode fuse in the built program, and the Node runtime shipped at
// resources/node/node(.exe) that takes over the app's small scripts once that fuse is off.
// Used by tools/check-package.js; kept apart from it so these
// functions can be tested without a build (tools/packaged-node-test.js).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Electron marks where its fuses sit in the program with this text. After it come one byte for the
// format version, one byte for how many fuses there are, then one byte per fuse.
const FUSE_MARK = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';

// What one fuse byte means: the characters "0" and "1", "r" for a fuse this Electron no longer
// has, and 0x90 for "as the program was compiled".
const FUSE_STATES = { 48: 'off', 49: 'on', 114: 'removed', 144: 'inherit' };

// The fuses in the order Electron stores them (format version 1). runAsNode is the first.
const FUSE_NAMES = [
  'runAsNode',
  'enableCookieEncryption',
  'enableNodeOptionsEnvironmentVariable',
  'enableNodeCliInspectArguments',
  'enableEmbeddedAsarIntegrityValidation',
  'onlyLoadAppFromAsar',
  'loadBrowserProcessSpecificV8Snapshot',
  'grantFileProtocolExtraPrivileges',
];

// The fuses in a program's bytes. → { runAsNode: 'on' | 'off' | …, … }, or null when the bytes
// hold no fuses (not an Electron program).
function readFuses(program) {
  const mark = program.indexOf(FUSE_MARK, 0, 'latin1');
  if (mark < 0) return null;
  const start = mark + FUSE_MARK.length;
  const count = program[start + 1];
  const fuses = {};
  for (let index = 0; index < count && index < FUSE_NAMES.length; index++) {
    fuses[FUSE_NAMES[index]] = FUSE_STATES[program[start + 2 + index]] || 'unknown';
  }
  return fuses;
}

// The file that holds a build's fuses, with what they say. folder: the unpacked build
// (dist/win-unpacked, dist/linux-unpacked). macApp: the .app folder of a Mac build, else null.
// → { file, fuses } or null when none is found.
function findFuses(folder, macApp) {
  const candidates = [];
  if (macApp) {
    // on a Mac the fuses are in Electron's framework, not in the small program that starts it
    candidates.push(
      path.join(
        macApp,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Electron Framework'
      )
    );
  } else if (fs.existsSync(folder)) {
    // Windows: the .exe. Linux: the program has no extension. Biggest first: it is the app.
    const programs = fs
      .readdirSync(folder)
      .filter(name => /\.exe$/i.test(name) || !path.extname(name))
      .map(name => path.join(folder, name))
      .filter(file => fs.statSync(file).isFile())
      .sort((first, second) => fs.statSync(second).size - fs.statSync(first).size);
    candidates.push(...programs);
  }
  for (const file of candidates) {
    let fuses = null;
    try {
      fuses = readFuses(fs.readFileSync(file));
    } catch {
      // unreadable: try the next one
    }
    if (fuses) return { file, fuses };
  }
  return null;
}

// The Node runtime in a build's resources folder. → null when the build ships none, else
// { file, megabytes, node, hasNote, rightVersion, verified }: node is the version from the note
// the fetch script wrote (tools/fetch-node-runtime.js), hasNote whether that note is there, and
// verified how the program was matched:
//   'pinned': it hashes to a program value pinned in git (Windows, where the release lists one).
//     The note is not trusted there: it lies beside the program, so whoever swaps one can swap
//     the other.
//   'note': a program named `node` (Mac, Linux) whose note names an archive with the archive
//     hash pinned in git, and the hash this program has. The release lists no hash for a program
//     inside an archive, so the note written at fetch time is the record.
//   '': neither.
// licence says whether Node's licence text lies beside the program: 'pinned' (it hashes to the
// value pinned in git), 'changed' (a file is there, but not that one) or 'missing'.
//   pins: { version, programHashes, vouches, licenceName, licenceSha256 }, replaceable in tests.
function shippedRuntime(resources, pins = pinnedRuntime()) {
  const folder = path.join(resources, 'node');
  const file = ['node.exe', 'node']
    .map(name => path.join(folder, name))
    .find(candidate => fs.existsSync(candidate));
  if (!file) return null;
  const program = fs.readFileSync(file);
  let note = null;
  try {
    note = JSON.parse(fs.readFileSync(path.join(folder, 'runtime.json'), 'utf8'));
  } catch {
    // no note: the program was put there by hand
  }
  const hash = crypto.createHash('sha256').update(program).digest('hex');

  // A Windows program (node.exe) is never matched through a note: it has a pinned value, and a
  // note that claims to come from a Mac or Linux archive must not get around it.
  const fromArchive = path.basename(file) === 'node' && pins.vouches(note, hash);

  let licence = 'missing';
  try {
    const text = fs.readFileSync(path.join(folder, pins.licenceName || 'LICENSE'));
    const textHash = crypto.createHash('sha256').update(text).digest('hex');
    licence = textHash === pins.licenceSha256 ? 'pinned' : 'changed';
  } catch {
    // no licence file beside the program
  }
  return {
    licence,
    file,
    megabytes: Number((program.length / 1048576).toFixed(1)),
    node: note ? String(note.node || '') : '',
    hasNote: !!note,
    rightVersion: !!note && note.node === pins.version,
    verified: pins.programHashes.includes(hash) ? 'pinned' : fromArchive ? 'note' : '',
  };
}

// What tools/fetch-node-runtime.js pins in git: the Node version, the program hashes the release
// lists, and for programs taken out of an archive whether a note vouches for a hash.
function pinnedRuntime() {
  const fetcher = require('./fetch-node-runtime');
  const targets = Object.values(fetcher.TARGETS);
  const archives = targets.filter(target => !target.programSha256);
  return {
    version: fetcher.NODE_VERSION,
    programHashes: targets.map(target => target.programSha256).filter(Boolean),
    vouches: (note, hash) => archives.some(target => fetcher.noteVouches(note, target, hash)),
    licenceName: fetcher.LICENCE.name,
    licenceSha256: fetcher.LICENCE.sha256,
  };
}

// Whether this build is expected to have the fuse off. The flag and the environment variable are
// for a trial build; the package setting makes every build after the switch check itself with no
// change to the release steps.
function expectsFuseOff({ argv = [], env = {}, packageJson = {} } = {}) {
  if (argv.includes('--expect-run-as-node-off')) return true;
  if (env.TNAI_EXPECT_RUN_AS_NODE_OFF === '1') return true;
  return packageJson.build?.electronFuses?.runAsNode === false;
}

// What is wrong with a build, as a list of sentences (empty: nothing).
//   found: findFuses()'s answer. runtime: shippedRuntime()'s answer. expectOff: expectsFuseOff().
function runAsNodeProblems({ found, runtime, expectOff }) {
  const problems = [];
  if (runtime && !runtime.verified) {
    problems.push(
      'resources/node: the Node runtime is not a program pinned in tools/fetch-node-runtime.js (its SHA-256 is none of the pinned values, and no note from a pinned archive vouches for it)'
    );
  }
  if (runtime && !runtime.hasNote) {
    problems.push(
      'resources/node: runtime.json is missing, so the program was not put there by the fetch script'
    );
  }
  if (runtime && runtime.hasNote && !runtime.rightVersion) {
    problems.push(
      'resources/node: runtime.json names Node ' +
        (runtime.node || '?') +
        ', not the pinned version'
    );
  }

  // Node's licence asks that its text goes with every copy of the program.
  if (runtime && runtime.licence !== 'pinned') {
    problems.push(
      runtime.licence === 'changed'
        ? 'resources/node: LICENSE is not the Node licence text pinned in tools/fetch-node-runtime.js'
        : 'resources/node: LICENSE is missing; the Node program must ship with its licence text (run tools/fetch-node-runtime.js)'
    );
  }
  const state = found ? found.fuses.runAsNode : 'not found';
  if (expectOff && state !== 'off') {
    problems.push('the runAsNode fuse is ' + state + ', but this build is expected to have it off');
  }

  // With the fuse off the app can no longer run its own scripts; without the runtime every `tnai`
  // and agent command in a terminal panel would stop working.
  if (state === 'off' && !runtime) {
    problems.push(
      'the runAsNode fuse is off but the build ships no Node runtime in resources/node'
    );
  }
  return problems;
}

// One line for the report, e.g. "run as Node: fuse on (TechnicallyNot.ai.exe); Node runtime
// 24.21.0, 85.1 MB".
function runAsNodeSummary({ found, runtime }) {
  const fuse = found
    ? 'fuse ' + found.fuses.runAsNode + ' (' + path.basename(found.file) + ')'
    : 'fuse not found';
  const shipped = runtime
    ? 'Node runtime ' + (runtime.node || 'of unknown version') + ', ' + runtime.megabytes + ' MB'
    : 'no Node runtime shipped (the app runs its small scripts itself, as Node)';
  return 'run as Node: ' + fuse + '; ' + shipped;
}

module.exports = {
  FUSE_MARK,
  readFuses,
  findFuses,
  shippedRuntime,
  expectsFuseOff,
  runAsNodeProblems,
  runAsNodeSummary,
};
