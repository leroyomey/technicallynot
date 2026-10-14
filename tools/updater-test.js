// Test of desktop/updater.js: node tools/updater-test.js (plain Node, no window, no network).
// Updates come from the GitHub releases of the public repository named in package.json
// "tnaiPublicRepo", for everyone: no sign-in decides anything and no header of the app is sent.
// With the setting empty the app says it cannot check and asks nothing of anyone.
//
// Electron and electron-updater are replaced by stand-ins that note what the updater does with
// them; package.json is replaced by a made-up one, so the test does not depend on today's value.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

const updaterFile = path.join(__dirname, '..', 'desktop', 'updater.js');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-updater-test-'));

// What the stand-ins hand to the updater, and what they saw it do.
const world = {
  packageJson: {},
  packaged: true,
  opened: [],
  asked: [],
  fakeUpdater: null,
};

// A stand-in for electron-updater's autoUpdater: it notes each call and the headers set on it.
function makeFakeUpdater() {
  const fake = new EventEmitter();
  fake.calls = [];
  fake.feed = null;
  fake.setFeedURL = options => {
    fake.feed = options;
  };
  fake.checkForUpdates = () => {
    fake.calls.push('check');

    // the real library says so first, as an event
    fake.emit('checking-for-update');
    return Promise.resolve();
  };
  fake.downloadUpdate = () => {
    fake.calls.push('download');
    return Promise.resolve();
  };
  fake.quitAndInstall = () => fake.calls.push('install');
  return fake;
}

const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request === 'electron') {
    return {
      app: {
        getPath: () => profile,
        getVersion: () => '1.0.0',
        get isPackaged() {
          return world.packaged;
        },
      },
      shell: { openExternal: url => world.opened.push(url) },
    };
  }
  if (request === 'electron-updater') {
    world.asked.push('electron-updater');
    return { autoUpdater: world.fakeUpdater };
  }
  if (request === '../package.json' && parent && parent.filename === updaterFile) {
    return world.packageJson;
  }

  // The sign-in module must not be needed by the updater at all.
  if (/user-auth/.test(request) && parent && parent.filename === updaterFile) {
    world.asked.push('user-auth');
    return { appToken: () => 'A-TOKEN', publicState: () => ({ signedIn: false }) };
  }
  return realLoad.call(this, request, parent, ...rest);
};

// A fresh copy of the updater with the given package.json, started, and the states it pushed.
function startUpdater(packageJson, { packaged = true } = {}) {
  delete require.cache[updaterFile];
  world.packageJson = packageJson;
  world.packaged = packaged;
  world.asked = [];
  world.opened = [];
  world.fakeUpdater = makeFakeUpdater();
  for (const name of ['update-config.json', 'update-settings.json', 'app-update.yml']) {
    fs.rmSync(path.join(profile, name), { force: true });
  }
  const updater = require(updaterFile);
  const states = [];
  updater.init(state => states.push(state));
  return { updater, states, fake: world.fakeUpdater };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

async function run() {
  // No test here may reach a network: any real request fails the run.
  const realFetch = global.fetch;
  let fetched = 0;
  global.fetch = async () => {
    fetched++;
    throw new Error('no network in this test');
  };
  delete process.env.TNAI_SELFTEST;
  delete process.env.TNAI_UPDATE_URL;
  delete process.env.TNAI_UPDATE_NOTES_URL;

  // ---- the one setting ----
  {
    const { updater } = startUpdater({ tnaiPublicRepo: 'some-owner/some-repo' });
    check(
      'the repository is read from tnaiPublicRepo',
      updater.publicRepo() === 'some-owner/some-repo'
    );
    check(
      'its feed is the files of its newest GitHub release',
      updater.feedOfRepo('some-owner/some-repo') ===
        'https://github.com/some-owner/some-repo/releases/latest/download/'
    );
    check(
      'its releases page is the list of all its releases',
      updater.releasesPageOf('some-owner/some-repo') ===
        'https://github.com/some-owner/some-repo/releases'
    );
    check(
      'no repository: no feed and no page',
      updater.feedOfRepo('') === '' && updater.releasesPageOf('') === ''
    );
    for (const wrong of ['https://example.com/feed/', 'owner', 'a/b/c', 'owner/repo?x=1', ' ']) {
      startUpdater({ tnaiPublicRepo: wrong });
      check(
        'a value that is not owner/repo counts as empty: ' + JSON.stringify(wrong),
        require(updaterFile).publicRepo() === ''
      );
    }
    startUpdater({ tnaiUpdateUrl: 'https://old-feed.example.com/updates/' });
    check(
      'the old feed setting is not read any more',
      require(updaterFile).state().status === 'unconfigured',
      require(updaterFile).state()
    );
  }

  // ---- the setting empty: the app says it cannot check, and does nothing else ----
  {
    const { updater, states, fake } = startUpdater({ tnaiPublicRepo: '' });
    const state = updater.state();
    check('empty setting: the state is "unconfigured"', state.status === 'unconfigured', state);
    check(
      'and it says in plain words that it cannot check',
      /cannot check for updates/i.test(state.message || ''),
      state.message
    );
    check(
      'one state is pushed, and it is not an error',
      states.length === 1 && states[0].status !== 'error'
    );
    check('the update library is not even loaded', !world.asked.includes('electron-updater'));
    updater.check();
    updater.download();
    await settle();
    check(
      'Check and Download do nothing: no request, no new state',
      fake.calls.length === 0 && states.length === 1 && fetched === 0,
      { calls: fake.calls, states: states.length, fetched }
    );
    check('there is no releases page to link to', state.releasesUrl === '', state.releasesUrl);
    check(
      '"What\'s new" opens nothing',
      updater.openNotes() === false && world.opened.length === 0
    );
    check('install is refused', updater.install() === false);
  }

  // ---- a repository set: the feed, for everyone, with nothing of the app sent along ----
  {
    const { updater, states, fake } = startUpdater({ tnaiPublicRepo: 'some-owner/some-repo' });
    await settle();
    check(
      "the updater is pointed at the repository's newest release",
      fake.feed &&
        fake.feed.provider === 'generic' &&
        fake.feed.url === 'https://github.com/some-owner/some-repo/releases/latest/download/',
      fake.feed
    );
    check('the first check runs by itself', fake.calls.join() === 'check', fake.calls);
    check(
      'no header of the app is set on the updater',
      fake.requestHeaders === null || fake.requestHeaders === undefined,
      fake.requestHeaders
    );
    check(
      'the sign-in module is never asked for anything',
      !world.asked.includes('user-auth'),
      world.asked
    );
    check(
      'the state carries the releases page',
      updater.state().releasesUrl === 'https://github.com/some-owner/some-repo/releases',
      updater.state().releasesUrl
    );
    check(
      'differential downloads stay off and nothing downloads by itself',
      fake.disableDifferentialDownload === true && fake.autoDownload === false
    );

    // an update is offered: its notes page is the release's own page on GitHub
    fake.emit('update-available', {
      version: '2.0.0',
      releaseName: 'Technically Not 2.0.0 build 7',
      releaseNotes: 'New: something.',
    });
    await settle();
    const offered = updater.state();
    check(
      "an offer: version, build and the release's page",
      offered.status === 'available' &&
        offered.next === '2.0.0' &&
        offered.nextBuild === 7 &&
        offered.notesUrl === 'https://github.com/some-owner/some-repo/releases/tag/v2.0.0',
      offered
    );

    // Download: nobody is signed in (there is no sign-in), and it still goes ahead
    fake.calls.length = 0;
    updater.download();
    await settle();
    check(
      'Download works with nobody signed in: checked again, then downloaded',
      fake.calls.join() === 'check,download',
      fake.calls
    );
    check(
      'and no error about a subscription or a sign-in was shown',
      !states.some(state => /subscri|sign in/i.test(state.message || '')),
      states.map(state => state.message).filter(Boolean)
    );
    check(
      'still no header of the app on the updater after a download',
      fake.requestHeaders === null || fake.requestHeaders === undefined,
      fake.requestHeaders
    );
    fake.emit('update-downloaded');
    check('downloaded: ready to install', updater.state().status === 'ready');
    check('"What\'s new" opens the release\'s page', updater.openNotes() === true, world.opened);
    check(
      'and only that page',
      world.opened.join() === 'https://github.com/some-owner/some-repo/releases/tag/v2.0.0',
      world.opened
    );
  }

  // ---- what protects an update is unchanged ----
  {
    const signed = startUpdater({
      tnaiPublicRepo: 'some-owner/some-repo',
      tnaiPublisherName: 'Some Publisher',
    });
    const written = fs.readFileSync(path.join(profile, 'app-update.yml'), 'utf8');
    check(
      'a signed build still names its publisher for the signature check',
      /publisherName:\n {2}- "Some Publisher"/.test(written),
      written
    );
    check(
      'a damaged download is still reported as discarded',
      /damaged and was discarded/.test(
        signed.updater.friendly(new Error('sha512 checksum mismatch'))
      )
    );
    check(
      'an installer of another publisher is still reported as discarded',
      /not signed by/.test(signed.updater.friendly(new Error('not signed by the publisher')))
    );
    check(
      'a repository with no release yet: a calm sentence, not a raw error',
      /No release was found/.test(
        signed.updater.friendly(new Error('Cannot find latest.yml in the latest release: 404'))
      )
    );

    // update-config.json in the profile can be written by anyone on the PC: an installed build
    // takes a feed from it only on GitHub's or Technically Not's hosts
    startUpdater({ tnaiPublicRepo: 'some-owner/some-repo' });
    fs.writeFileSync(
      path.join(profile, 'update-config.json'),
      JSON.stringify({ url: 'https://evil.example.com/feed/' })
    );
    const realWarn = console.warn;
    console.warn = () => {};
    delete require.cache[updaterFile];
    world.fakeUpdater = makeFakeUpdater();
    require(updaterFile).init(() => {});
    console.warn = realWarn;
    check(
      'a feed on another host in update-config.json is ignored by an installed build',
      world.fakeUpdater.feed &&
        world.fakeUpdater.feed.url ===
          'https://github.com/some-owner/some-repo/releases/latest/download/',
      world.fakeUpdater.feed
    );
    fs.rmSync(path.join(profile, 'update-config.json'), { force: true });
  }

  // ---- a copy run from source never updates itself ----
  {
    const { updater } = startUpdater(
      { tnaiPublicRepo: 'some-owner/some-repo' },
      { packaged: false }
    );
    check(
      'run from source: status "dev", the library is not loaded',
      updater.state().status === 'dev'
    );
  }

  // the skipped-versions request of an offer is the only fetch, and it carries no header of ours
  check('no request left this test', fetched <= 1, fetched);

  global.fetch = realFetch;
  Module._load = realLoad;
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed (Node ${process.versions.node})`);
  process.exit(failed ? 1 : 0);
}

run();
