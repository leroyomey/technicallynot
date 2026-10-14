// Test of tools/packaged-node.js and tools/fetch-node-runtime.js: node tools/packaged-node-test.js
// (plain Node, no build, no network). Reading the runAsNode fuse out of a program, what a build
// must hold once that fuse is off, and fetching the Node runtime: the hash check, the archive
// reader and running twice.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const packagedNode = require('./packaged-node');
const fetcher = require('./fetch-node-runtime');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// A made-up program: some bytes, Electron's mark, the format version, the count, then the fuses.
function programWith(fuseText) {
  return Buffer.concat([
    Buffer.from('MZ some program bytes '),
    Buffer.from(packagedNode.FUSE_MARK, 'latin1'),
    Buffer.from([1, fuseText.length]),
    Buffer.from(fuseText, 'latin1'),
    Buffer.from(' more bytes'),
  ]);
}

// One file as a tar archive: a 512-byte header, the content, padding, two empty blocks.
function tarWith(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(content.length.toString(8).padStart(11, '0'), 124, 'ascii');
  header.write('0', 156, 'ascii');
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding, Buffer.alloc(1024)]);
}

async function run() {
  // ---- reading the fuses ----
  {
    const today = packagedNode.readFuses(programWith('110011'));
    check('fuse on: read as on', today.runAsNode === 'on', today);
    check(
      'the other fuses come out in their order',
      today.enableCookieEncryption === 'on' &&
        today.enableNodeOptionsEnvironmentVariable === 'off' &&
        today.onlyLoadAppFromAsar === 'on',
      today
    );
    const closed = packagedNode.readFuses(programWith('010011'));
    check('fuse off: read as off', closed.runAsNode === 'off', closed);
    check(
      'a program with no fuses in it: null',
      packagedNode.readFuses(Buffer.from('not Electron')) === null
    );

    // the Electron this project runs from source: its fuses are never changed, so runAsNode is on
    const devElectron = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
    if (fs.existsSync(devElectron)) {
      const found = packagedNode.findFuses(devElectron, null);
      check(
        'the real Electron in node_modules: fuses found, runAsNode on',
        found && found.fuses.runAsNode === 'on',
        found
      );
    } else console.log('skip: no Electron in node_modules to read fuses from');
  }

  // ---- when is the fuse expected off ----
  {
    const expects = packagedNode.expectsFuseOff;
    const packageOn = { build: { electronFuses: { runAsNode: true } } };
    const packageOff = { build: { electronFuses: { runAsNode: false } } };
    check(
      'today (package says on, no flag): not expected off',
      !expects({ packageJson: packageOn })
    );
    check(
      'the flag: expected off',
      expects({ argv: ['dist/x', '--expect-run-as-node-off'], packageJson: packageOn })
    );
    check(
      'the environment variable: expected off',
      expects({ env: { TNAI_EXPECT_RUN_AS_NODE_OFF: '1' }, packageJson: packageOn })
    );
    check('package.json says off: expected off', expects({ packageJson: packageOff }));
  }

  // ---- what fails a build ----
  {
    const problems = packagedNode.runAsNodeProblems;
    const fuseOn = { file: 'app.exe', fuses: { runAsNode: 'on' } };
    const fuseOff = { file: 'app.exe', fuses: { runAsNode: 'off' } };
    const runtime = {
      file: 'node.exe',
      megabytes: 85,
      node: '24.21.0',
      hasNote: true,
      rightVersion: true,
      verified: 'pinned',
      licence: 'pinned',
    };
    check(
      "today's build (fuse on, no runtime, not expected off): passes",
      problems({ found: fuseOn, runtime: null, expectOff: false }).length === 0
    );
    check(
      'fuse on with the runtime shipped ahead: passes',
      problems({ found: fuseOn, runtime, expectOff: false }).length === 0
    );
    check(
      'expected off but on: fails',
      problems({ found: fuseOn, runtime, expectOff: true }).length === 1
    );
    check(
      'expected off and no fuses found: fails',
      problems({ found: null, runtime, expectOff: true }).length === 1
    );
    check(
      'off with the runtime: passes',
      problems({ found: fuseOff, runtime, expectOff: true }).length === 0
    );
    check(
      'off without the runtime (every tnai command would break): fails, even unasked',
      problems({ found: fuseOff, runtime: null, expectOff: false }).length === 1
    );
    const problemsWith = change =>
      problems({ found: fuseOn, runtime: { ...runtime, ...change }, expectOff: false });
    check(
      'a runtime whose hash is not a pinned one: fails',
      problemsWith({ verified: '' }).length === 1 &&
        /pinned/.test(problemsWith({ verified: '' })[0])
    );
    check(
      'a runtime with no note beside it: fails',
      problemsWith({ hasNote: false, rightVersion: false }).length === 1
    );
    check(
      'a note that names another Node version: fails',
      problemsWith({ rightVersion: false, node: '18.0.0' }).length === 1
    );
    check(
      'a runtime with no licence text beside it: fails',
      problemsWith({ licence: 'missing' }).length === 1 &&
        /LICENSE is missing/.test(problemsWith({ licence: 'missing' })[0]),
      problemsWith({ licence: 'missing' })
    );
    check(
      'a runtime with another text as its licence: fails',
      problemsWith({ licence: 'changed' }).length === 1 &&
        /not the Node licence text/.test(problemsWith({ licence: 'changed' })[0]),
      problemsWith({ licence: 'changed' })
    );
    const line = packagedNode.runAsNodeSummary({ found: fuseOn, runtime: null });
    check(
      'the report line names the fuse and the missing runtime',
      /fuse on .*no Node runtime/.test(line),
      line
    );
  }

  // ---- fetching: checksums, the archive reader, a mismatch, running twice ----
  {
    // the values in git: every target has the hash of its download, and Windows, whose download
    // is the program, has the same value for the program
    const pins = Object.entries(fetcher.TARGETS);
    check(
      'every target pins the SHA-256 of its download',
      pins.length === 5 &&
        pins.every(([, target]) => /^[0-9a-f]{64}$/.test(target.publishedSha256)),
      pins.map(([name, target]) => name + ' ' + target.publishedSha256)
    );
    check(
      'Windows pins the program itself',
      fetcher.TARGETS['win-x64'].programSha256 === fetcher.TARGETS['win-x64'].publishedSha256
    );
    check(
      'this computer: named as the build names it',
      /^(win|mac|linux)-/.test(fetcher.ownTarget())
    );
    check('Windows on x64 is win-x64', fetcher.ownTarget('win32', 'x64') === 'win-x64');
    check('a Mac on arm64 is mac-arm64', fetcher.ownTarget('darwin', 'arm64') === 'mac-arm64');

    // 700 bytes: more than one block, so the padding is exercised
    const program = Buffer.alloc(700, 7);
    const tar = Buffer.concat([
      tarWith('node-v1-linux-x64/README.md', Buffer.from('read me')).subarray(0, 1024),
      tarWith('node-v1-linux-x64/bin/node', program),
    ]);
    const taken = fetcher.fileFromTar(tar, '/bin/node');
    check('tar: bin/node comes out whole', taken && taken.equals(program), taken && taken.length);
    check('tar: a file that is not there is null', fetcher.fileFromTar(tar, '/bin/npm') === null);

    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai fetch node '));
    const quiet = () => {};
    let downloads = 0;
    const archive = zlib.gzipSync(tar);

    // a made-up licence text with its own address and pinned value, in the shape of the real one
    const licenceText = Buffer.from('A made-up licence text.\n');
    const licence = {
      name: 'LICENSE',
      url: 'https://example.invalid/LICENSE',
      sha256: fetcher.sha256(licenceText),
    };
    let licenceDownloads = 0;
    const get = async url => {
      if (url === licence.url) {
        licenceDownloads++;
        return licenceText;
      }
      downloads++;
      return archive;
    };

    // a table of pinned values for the made-up archive, in the shape of the real one
    const real = fetcher.TARGETS['linux-x64'];
    const pinnedAs = (publishedSha256, programSha256) => ({
      'linux-x64': { ...real, publishedSha256, programSha256 },
    });
    const rightPins = pinnedAs(fetcher.sha256(archive), fetcher.sha256(program));
    const fetchWith = (targets, licencePin = licence) =>
      fetcher.fetchTarget('linux-x64', {
        outputRoot,
        get,
        log: quiet,
        targets,
        licence: licencePin,
      });
    const programFile = path.join(outputRoot, 'linux-x64', 'node');
    const licenceFile = path.join(outputRoot, 'linux-x64', 'LICENSE');
    const noteFile = path.join(outputRoot, 'linux-x64', fetcher.NOTE_NAME);

    let refused = '';
    try {
      await fetchWith(pinnedAs('c'.repeat(64), fetcher.sha256(program)));
    } catch (error) {
      refused = error.message;
    }
    check('a download that is not the pinned one is refused', /mismatch/.test(refused), refused);
    check('and nothing is written', !fs.existsSync(programFile));

    refused = '';
    try {
      await fetchWith(pinnedAs(fetcher.sha256(archive), 'd'.repeat(64)));
    } catch (error) {
      refused = error.message;
    }
    check(
      'a pinned archive holding a program that is not the pinned one is refused',
      /not the pinned one/.test(refused) && !fs.existsSync(programFile),
      refused
    );

    await fetchWith(rightPins);
    check(
      'the pinned download: the program is written',
      fs.readFileSync(programFile).equals(program)
    );
    const note = JSON.parse(fs.readFileSync(noteFile, 'utf8'));
    check(
      'with a note of the version and both hashes',
      note.node === fetcher.NODE_VERSION &&
        note.publishedSha256 === fetcher.sha256(archive) &&
        note.programSha256 === fetcher.sha256(program),
      note
    );

    check(
      'and the licence text lies beside the program',
      fs.existsSync(licenceFile) &&
        fs.readFileSync(licenceFile).equals(licenceText) &&
        licenceDownloads === 1,
      licenceDownloads
    );

    let before = downloads;
    const again = await fetchWith(rightPins);
    check(
      'run twice: nothing is downloaded again',
      downloads === before && licenceDownloads === 1 && /already/.test(again),
      again
    );

    // the licence text: pinned like the program, and put right when it is gone or changed
    check(
      'the real licence text is pinned, from the tag of the pinned Node version',
      /^[0-9a-f]{64}$/.test(fetcher.LICENCE.sha256) &&
        fetcher.LICENCE.url.includes('/v' + fetcher.NODE_VERSION + '/'),
      fetcher.LICENCE
    );
    fs.rmSync(licenceFile, { force: true });
    await fetchWith(rightPins);
    check(
      'a deleted licence text is fetched again, the program is not',
      downloads === before && licenceDownloads === 2 && fs.existsSync(licenceFile)
    );
    fs.writeFileSync(licenceFile, 'another text');
    await fetchWith(rightPins);
    check(
      'a changed licence text is replaced by the pinned one',
      licenceDownloads === 3 && fs.readFileSync(licenceFile).equals(licenceText)
    );
    fs.rmSync(licenceFile, { force: true });
    let refusedLicence = '';
    try {
      await fetchWith(rightPins, { ...licence, sha256: 'a'.repeat(64) });
    } catch (error) {
      refusedLicence = error.message;
    }
    check(
      'a licence text that is not the pinned one is refused and not written',
      /mismatch for the licence text/.test(refusedLicence) && !fs.existsSync(licenceFile),
      refusedLicence
    );
    await fetchWith(rightPins);

    // The swap a review found: another program and a note that vouches for it, put into the
    // git-ignored folder. The file on disk is compared with the pinned value, so it is replaced.
    const swapped = Buffer.from('not node at all');
    fs.writeFileSync(programFile, swapped);
    fs.writeFileSync(noteFile, JSON.stringify({ ...note, programSha256: fetcher.sha256(swapped) }));
    before = downloads;
    await fetchWith(rightPins);
    check(
      'a swapped program with a matching note: not "already there", fetched again and put right',
      downloads === before + 1 && fs.readFileSync(programFile).equals(program)
    );

    fs.rmSync(noteFile);
    before = downloads;
    await fetchWith(rightPins);
    check(
      'a deleted note is written again without a download',
      downloads === before &&
        JSON.parse(fs.readFileSync(noteFile, 'utf8')).node === fetcher.NODE_VERSION
    );

    // Mac and Linux as they really are: the release lists a hash for the archive only, so the
    // program has no pinned value and the note from its fetch is the record.
    const archivePins = pinnedAs(fetcher.sha256(archive), '');
    fs.rmSync(path.join(outputRoot, 'linux-x64'), { recursive: true });
    before = downloads;
    const firstFetch = await fetchWith(archivePins);
    check(
      'archive only pinned: the archive is checked, bin/node taken out and its hash noted',
      downloads === before + 1 &&
        fs.readFileSync(programFile).equals(program) &&
        JSON.parse(fs.readFileSync(noteFile, 'utf8')).programSha256 === fetcher.sha256(program),
      firstFetch
    );
    let wrongArchive = '';
    try {
      fs.rmSync(path.join(outputRoot, 'linux-x64'), { recursive: true });
      await fetchWith(pinnedAs('e'.repeat(64), ''));
    } catch (error) {
      wrongArchive = error.message;
    }
    check(
      'archive only pinned: an archive that is not the pinned one is refused, nothing taken out',
      /mismatch/.test(wrongArchive) && !fs.existsSync(programFile),
      wrongArchive
    );
    await fetchWith(archivePins);
    before = downloads;
    const secondFetch = await fetchWith(archivePins);
    check(
      'archive only pinned: run twice, nothing is downloaded again',
      downloads === before && /already there/.test(secondFetch),
      secondFetch
    );
    fs.writeFileSync(programFile, swapped);
    before = downloads;
    await fetchWith(archivePins);
    check(
      'archive only pinned: a program that no longer matches its note is fetched again',
      downloads === before + 1 && fs.readFileSync(programFile).equals(program)
    );
    const goodNote = fs.readFileSync(noteFile, 'utf8');
    fs.writeFileSync(noteFile, JSON.stringify({ ...note, publishedSha256: 'f'.repeat(64) }));
    before = downloads;
    await fetchWith(archivePins);
    check(
      'archive only pinned: a note that names another archive hash does not count',
      downloads === before + 1
    );
    fs.writeFileSync(noteFile, goodNote);

    // the check of a build reads the same folder shape: resources/node/node + runtime.json
    fs.renameSync(path.join(outputRoot, 'linux-x64'), path.join(outputRoot, 'node'));
    const buildPins = {
      version: fetcher.NODE_VERSION,
      programHashes: [fetcher.sha256(program)],
      vouches: () => false,
      licenceName: licence.name,
      licenceSha256: licence.sha256,
    };
    const builtLicence = path.join(outputRoot, 'node', 'LICENSE');
    const builtProgram = path.join(outputRoot, 'node', 'node');
    const builtNote = path.join(outputRoot, 'node', fetcher.NOTE_NAME);
    const shipped = packagedNode.shippedRuntime(outputRoot, buildPins);
    check(
      'a build holding it: found, version read, note there, hash a pinned one',
      shipped &&
        shipped.node === fetcher.NODE_VERSION &&
        shipped.hasNote &&
        shipped.rightVersion &&
        shipped.verified === 'pinned' &&
        shipped.licence === 'pinned',
      shipped
    );
    const problemsOf = () =>
      packagedNode.runAsNodeProblems({
        found: { file: 'app', fuses: { runAsNode: 'on' } },
        runtime: packagedNode.shippedRuntime(outputRoot, buildPins),
        expectOff: false,
      });
    check('and the build passes', problemsOf().length === 0, problemsOf());

    fs.rmSync(builtLicence, { force: true });
    check(
      'a build with the program but no licence text: fails',
      problemsOf().length === 1 && /LICENSE is missing/.test(problemsOf()[0]),
      problemsOf()
    );
    fs.writeFileSync(builtLicence, 'another text');
    check(
      'a build with another text as the licence: fails',
      problemsOf().length === 1 && /not the Node licence text/.test(problemsOf()[0]),
      problemsOf()
    );
    fs.writeFileSync(builtLicence, licenceText);
    check('and with the pinned text back, it passes', problemsOf().length === 0, problemsOf());

    fs.writeFileSync(builtProgram, swapped);
    fs.writeFileSync(
      builtNote,
      JSON.stringify({ ...note, programSha256: fetcher.sha256(swapped) })
    );
    check(
      'a build with a swapped program and a note that vouches for it: fails',
      problemsOf().length === 1 && /pinned/.test(problemsOf()[0]),
      problemsOf()
    );
    fs.writeFileSync(builtProgram, program);
    fs.rmSync(builtNote);
    check(
      'a build with the right program but no note: fails',
      problemsOf().length === 1 && /runtime\.json is missing/.test(problemsOf()[0]),
      problemsOf()
    );
    fs.writeFileSync(builtNote, JSON.stringify({ ...note, node: '18.0.0' }));
    check(
      'a build whose note names another version: fails',
      problemsOf().length === 1 && /18\.0\.0/.test(problemsOf()[0]),
      problemsOf()
    );
    check(
      'the real pinned values are what a build is checked with by default',
      packagedNode.shippedRuntime(outputRoot).verified === ''
    );

    // A Mac or Linux build: no pinned value for the program, so the note from the fetch counts,
    // but only a note that names the pinned archive and this program's hash.
    const archiveTarget = archivePins['linux-x64'];
    const archiveBuildPins = {
      version: fetcher.NODE_VERSION,
      programHashes: [],
      vouches: (someNote, hash) => fetcher.noteVouches(someNote, archiveTarget, hash),
      licenceName: licence.name,
      licenceSha256: licence.sha256,
    };
    const verifiedAs = () => packagedNode.shippedRuntime(outputRoot, archiveBuildPins).verified;
    fs.writeFileSync(builtNote, goodNote);
    check(
      'a build from an archive: matched through the note of its fetch',
      verifiedAs() === 'note'
    );
    fs.writeFileSync(builtProgram, swapped);
    check('a build from an archive: a program its note does not name fails', verifiedAs() === '');
    fs.writeFileSync(builtProgram, program);
    fs.writeFileSync(builtNote, JSON.stringify({ ...note, publishedSha256: 'f'.repeat(64) }));
    check(
      'a build from an archive: a note of an archive that is not pinned fails',
      verifiedAs() === ''
    );

    // a Windows program must hash to its pinned value; a note cannot stand in for that
    fs.writeFileSync(builtNote, goodNote);
    fs.renameSync(builtProgram, builtProgram + '.exe');
    check(
      'a node.exe is never matched through a note, whatever the note says',
      verifiedAs() === ''
    );
    check(
      'a build without it: null',
      packagedNode.shippedRuntime(path.join(outputRoot, 'nowhere')) === null
    );
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
}

run();
