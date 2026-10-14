// Technically Not desktop · updater.js — Automatic updates (electron-updater): checks the release
// feed (at start + every 4 h when "Check automatically" is on), offers a new version with its build
// number and release-notes link, downloads it when asked (or automatically when the user chose
// that), verifies it (sha512, plus the Windows publisher when the build is signed), then installs
// and restarts. Per-user choices live in update-settings.json.
//
// Releases are the GitHub releases of the public repository named in package.json "tnaiPublicRepo"
// ("owner/repo"). Checking and downloading are open to everyone: no sign-in, and no token or other
// header of the app is ever sent with a request. While that setting is empty the app has nowhere
// to look: updates are "not set up", nothing is requested and no error is shown.
'use strict';
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

// The one setting that says where this app's releases are: "owner/repo" on GitHub, in
// package.json "tnaiPublicRepo". The release workflow writes the repository it runs in over it, so
// the value in the source may be empty. → "owner/repo", or '' when it is empty or not of that
// shape.
function publicRepo() {
  let value = '';
  try {
    value = require('../package.json').tnaiPublicRepo || '';
  } catch {}
  value = String(value).trim();
  return /^[\w.-]+\/[\w.-]+$/.test(value) ? value : '';
}

// True in a Mac build made without an Apple signature: the release workflow writes
// "tnaiMacUnsigned": true into its package.json. Such a build only updates by a new download.
function macUnsigned() {
  try {
    // The build's command line may hand the value over as the text "true".
    return String(require('../package.json').tnaiMacUnsigned) === 'true';
  } catch {
    return false;
  }
}

// The folder electron-updater reads latest.yml and the installer from: the files of the newest
// release of that repository.
function feedOfRepo(repo) {
  return repo ? 'https://github.com/' + repo + '/releases/latest/download/' : '';
}

// The page that lists every release of that repository; the "What's new" dialog links to it.
function releasesPageOf(repo) {
  return repo ? 'https://github.com/' + repo + '/releases' : '';
}

// update-config.json in the profile: {"url": feed, "notesUrl": "https://…/{version}"} (both
// optional).
function config() {
  try {
    return (
      JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'update-config.json'), 'utf8')
      ) || {}
    );
  } catch {
    return {};
  }
}

// Where releases are published (a folder holding latest.yml + the installer). First match wins:
// TNAI_UPDATE_URL (testing, run from source only) → update-config.json {"url"} → the public
// repository of package.json (publicRepo above). "owner/repo" is shorthand for that GitHub repo's
// latest release: https://github.com/owner/repo/releases/latest/download/ Installed builds take an
// update-config.json feed only when it is that same public repository (the file is user-writable,
// and an unsigned installer has no publisher check, so any other repo or server could hand out
// someone else's installer); from source any feed works.
function overrideAllowed(url) {
  if (!app.isPackaged) return true;
  const repo = publicRepo();
  if (!repo) return false;
  const full = /^[\w.-]+\/[\w.-]+$/.test(url) ? feedOfRepo(url) : url;

  // GitHub names are not case-sensitive, and the trailing slash is optional
  const plain = text => String(text).toLowerCase().replace(/\/+$/, '');
  return plain(full) === plain(feedOfRepo(repo));
}

function feedUrl() {
  // An environment variable could silently repoint an installed app's updates, so TNAI_UPDATE_URL
  // works only when run from source.
  let override = String(config().url || '').trim();
  if (override && !overrideAllowed(override)) {
    console.warn(
      '[updater] update-config.json url ignored: an installed build takes only its public repository'
    );
    override = '';
  }
  let url = (!app.isPackaged && process.env.TNAI_UPDATE_URL) || override || '';

  // The self-test (run from source) never contacts the real feed.
  if (!url && !(process.env.TNAI_SELFTEST && !app.isPackaged)) url = publicRepo();
  url = String(url).trim();
  return /^[\w.-]+\/[\w.-]+$/.test(url) ? feedOfRepo(url) : url;
}

// Release-notes page for a version: update-config.json "notesUrl" ({version} is replaced), else the
// GitHub release page when the feed is a GitHub repo. https only. TNAI_UPDATE_NOTES_URL counts only
// in a copy run from source, like TNAI_UPDATE_URL.
function notesUrlFor(
  feed,
  version,
  template = (!app.isPackaged && process.env.TNAI_UPDATE_NOTES_URL) || config().notesUrl || ''
) {
  const v = encodeURIComponent(String(version || ''));
  let url = '';
  if (template) url = String(template).replace(/\{version\}/g, v);
  else {
    const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\b/i.exec(feed || '');
    if (m) url = 'https://github.com/' + m[1] + '/releases/tag/v' + v;
  }
  return /^https:\/\/[^\s]+$/i.test(url) ? url : '';
}

// Build number of a release: CI names releases "Technically Not <version> build <N>" (latest.yml
// releaseName); the notes are the fallback.
const buildOf = info => {
  const m =
    /\bbuild\s*#?\s*(\d+)/i.exec(String(info?.releaseName || '')) ||
    /\bbuild\s*#?\s*(\d+)/i.exec(notes(info));
  return m ? Number(m[1]) : null;
};
const ownBuild = (() => {
  try {
    return require('../package.json').tnaiBuild ?? null;
  } catch {
    return null;
  }
})();

// Per-user choices (Settings › Updates).
const DEFAULTS = { autoCheck: true, notify: true, autoDownload: false };
const prefsFile = () => path.join(app.getPath('userData'), 'update-settings.json');
let prefs = { ...DEFAULTS };

function loadPrefs() {
  try {
    prefs = { ...DEFAULTS, ...pick(JSON.parse(fs.readFileSync(prefsFile(), 'utf8'))) };
  } catch {
    prefs = { ...DEFAULTS };
  }
}
const pick = o =>
  Object.fromEntries(
    Object.keys(DEFAULTS)
      .filter(k => typeof o?.[k] === 'boolean')
      .map(k => [k, o[k]])
  );

// Checking is the one timed request here: a release server can't push to every installed copy, so
// Technically Not asks at start and every 4 hours.
const CHECK_EVERY = 4 * 60 * 60 * 1000;

let state = { status: 'off', version: app.getVersion() },
  send = () => {},
  updater = null,
  timer = null,
  feed = '',
  offer = null;

// offer: the release being offered (next, nextBuild, notes, notesUrl), carried through
// downloading/ready/error. releasesUrl: the public repository's releases page ('' while the
// repository is not set), for the "What's new" dialog's link.
const set = patch => {
  state = {
    version: app.getVersion(),
    build: ownBuild,
    prefs,
    releasesUrl: releasesPageOf(publicRepo()),
    ...(offer || {}),
    ...patch,
  };
  send(state);
};

function init(push) {
  send = push;
  loadPrefs();
  feed = feedUrl();

  // An unsigned Mac build (the release workflow sets package.json "tnaiMacUnsigned") cannot
  // replace itself: macOS only lets a signed app install its own update. Its release carries no
  // Mac update file, so a check could only fail; it says once where new versions are instead.
  if (process.platform === 'darwin' && macUnsigned())
    return set({
      status: 'manual',
      message:
        'This Mac version cannot update itself yet. Download new versions from the releases page.',
    });

  // No public repository set: there is nowhere to look. Said once, as a state; nothing is
  // requested, no timer runs and no error is shown.
  if (!feed)
    return set({
      status: 'unconfigured',
      message: 'Technically Not cannot check for updates yet: no release address is set.',
    });
  if (
    !/^https:\/\//i.test(feed) &&
    !(process.env.TNAI_SELFTEST && !app.isPackaged && /^http:\/\/127\.0\.0\.1[:/]/.test(feed))
  )
    return set({ status: 'error', message: 'The update feed must use https://.' });
  if (!app.isPackaged && !process.env.TNAI_SELFTEST)
    return set({
      status: 'dev',
      message: 'Updates apply to the installed app, not to a copy run from source.',
    });
  ({ autoUpdater: updater } = require('electron-updater'));
  updater.removeAllListeners();

  // electron-updater also reads its cache folder name from app-update.yml; write our own so it
  // never depends on the build's copy.
  const configPath = path.join(app.getPath('userData'), 'app-update.yml');

  // publisherName (baked in by a signed CI build): electron-updater then refuses an installer not
  // signed by that publisher.
  const publisher = require('../package.json').tnaiPublisherName || '';
  fs.writeFileSync(
    configPath,
    [
      'provider: generic',
      'url: ' + JSON.stringify(feed),
      'updaterCacheDirName: tnai-updater',
      ...(publisher ? ['publisherName:', '  - ' + JSON.stringify(publisher)] : []),
      '',
    ].join('\n')
  );
  updater.updateConfigPath = configPath;
  updater.setFeedURL({ provider: 'generic', url: feed });

  // Releases are public: no header of the app's own goes out with a check or a download.
  updater.requestHeaders = null;
  updater.forceDevUpdateConfig = !app.isPackaged; // self-test only (guarded above)

  // downloads start from download(): the user's choice, or "Download updates automatically"
  updater.autoDownload = false;

  // the feed only serves the newest release, so old blockmaps aren't there
  updater.disableDifferentialDownload = true;

  // a downloaded update also installs the next time Technically Not is closed normally
  updater.autoInstallOnAppQuit = true;
  updater.logger = null;
  updater.on('checking-for-update', () => set({ status: 'checking' }));
  updater.on('update-not-available', () => {
    offer = null;
    set({ status: 'current', checkedAt: Date.now() });
  });
  updater.on('update-available', info => {
    offer = {
      next: info.version,
      nextBuild: buildOf(info),
      notes: offer?.next === info.version && offer.notes ? offer.notes : notes(info),
      notesUrl: notesUrlFor(feed, info.version),
    };
    set({ status: 'available', checkedAt: Date.now() });
    if (prefs.autoDownload) download();
    skippedNotes(info).then(all => {
      if (all && offer?.next === info.version && offer.notes !== all) {
        offer.notes = all;
        state = { ...state, notes: all };
        send(state);
      }
    });
  });
  updater.on('download-progress', p =>
    set({ status: 'downloading', percent: Math.round(p.percent) })
  );
  updater.on('update-downloaded', () => set({ status: 'ready' }));
  updater.on('error', error => set({ status: 'error', message: friendly(error) }));
  schedule();
  if (prefs.autoCheck) check();
  else set({ status: 'idle' });
}

function schedule() {
  clearInterval(timer);
  timer = null;
  if (updater && prefs.autoCheck) {
    timer = setInterval(check, CHECK_EVERY);
    timer.unref?.();
  }
}
const NOTES_CHARS = 8000;
const notes = info =>
  (Array.isArray(info?.releaseNotes)
    ? info.releaseNotes.map(n => n.note).join('\n')
    : String(info?.releaseNotes || '')
  )
    .replace(/<[^>]+>/g, '')
    .replace(/^Co-Authored-By:.*$/gim, '')
    .trim()
    .slice(0, NOTES_CHARS);

// X.Y.Z order (-1/0/1); published releases carry no pre-release part.
const cmpVersion = (a, b) => {
  const x = String(a).split(/[.-]/).map(Number),
    y = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
};

// What's new covers every version skipped since this build: latest.yml carries only the newest
// release's notes, so the feed's notes?from=<this version> lists each
// newer release. Several → "Version X.Y.Z" sections, newest first; null (latest.yml's notes stay)
// when the feed has no such endpoint (e.g. a GitHub feed), it fails, or only one version is new.
async function skippedNotes(info) {
  try {
    const url = new URL(
      'notes?from=' + encodeURIComponent(app.getVersion()),
      feed.endsWith('/') ? feed : feed + '/'
    );
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const list = (await res.json()).filter(
      r =>
        r &&
        typeof r.version === 'string' &&
        cmpVersion(r.version, app.getVersion()) > 0 &&
        cmpVersion(r.version, info.version) <= 0
    );
    if (!list.some(r => r.version === info.version))
      list.unshift({ version: info.version, notes: notes(info) });
    if (list.length < 2) return null;
    const text = list
      .map(
        r =>
          'Version ' +
          r.version +
          '\n' +
          (String(r.notes || '')
            .replace(/<[^>]+>/g, '')
            .replace(/^Co-Authored-By:.*$/gim, '')
            .trim() || 'No release notes were published for this version.')
      )
      .join('\n\n');
    return text.length > NOTES_CHARS
      ? text.slice(0, NOTES_CHARS).replace(/\s+\S*$/, '') + '\n…'
      : text;
  } catch {
    return null;
  }
}
const friendly = error =>
  /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::/i.test(String(error?.message))
    ? 'Could not reach the update server. Technically Not will try again later.'
    : /\b404\b|Cannot find .*latest/i.test(String(error?.message))
      ? 'No release was found at the release address yet. Technically Not will try again later.'
      : /sha512|checksum/i.test(String(error?.message))
        ? 'The downloaded update was damaged and was discarded.'
        : /publisher|signature|signed/i.test(String(error?.message))
          ? 'The downloaded update is not signed by Technically Not’s publisher and was discarded.'
          : 'Update failed: ' +
            String(error?.message || error)
              .split('\n')[0]
              .slice(0, 200);

function check() {
  if (!updater || ['downloading', 'ready'].includes(state.status)) return state;
  updater.checkForUpdates().catch(error => set({ status: 'error', message: friendly(error) }));
  return state;
}

function download() {
  if (!updater || state.status !== 'available') return state;

  // Check again first: an offer can be hours old, and a newer release since then should be the one
  // downloaded (not an older one, then a second update).
  updater
    .checkForUpdates()
    .then(() => {
      set({ status: 'downloading', percent: 0 });
      return updater.downloadUpdate();
    })
    .catch(error => set({ status: 'error', message: friendly(error) }));
  return state;
}

function install() {
  if (state.status !== 'ready') return false;

  // silent install into the same folder, then Technically Not starts again
  setImmediate(() => updater.quitAndInstall(true, true));
  return true;
}

// Saves the user's choices and applies them now: the timer follows autoCheck; turning on
// auto-download fetches an offered update.
function setPrefs(patch) {
  const before = prefs;
  prefs = { ...prefs, ...pick(patch) };
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs, null, 2));
  } catch {}
  schedule();
  state = { ...state, prefs };
  send(state);
  if (prefs.autoCheck && !before.autoCheck && state.status === 'idle') check();
  if (prefs.autoDownload && !before.autoDownload && state.status === 'available') download();
  return state;
}

// Opens the offered release's notes page in the browser (https only, from the feed; never a URL the
// page supplies).
function openNotes() {
  if (!/^https:\/\//i.test(state.notesUrl || '')) return false;
  shell.openExternal(state.notesUrl);
  return true;
}
module.exports = {
  init,
  state: () => state,
  check,
  download,
  install,
  setPrefs,
  openNotes,
  notesUrlFor,
  buildOf,
  publicRepo,
  feedOfRepo,
  releasesPageOf,
  friendly,
};
