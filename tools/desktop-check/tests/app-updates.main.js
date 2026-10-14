/*
 * Technically Not tools · desktop-check/tests/app-updates.main.js — Main-process side of the
 * app-updates test: a local release feed (latest.yml + a dummy installer with a real sha512) on
 * 127.0.0.1, then the real updater pointed at it (release name "Technically Not 9.9.9 build 99", a
 * notes-page URL). The update is downloaded but never installed; its download cache is deleted
 * afterwards. Releases are public: nobody is signed in here, the feed serves the installer to
 * everyone, and it notes the Authorization header of each installer request so the test can show
 * that the app sent none.
 */
'use strict';
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const updater = require('../../../desktop/updater');

module.exports = (win, profile) => {
  // Windows: latest.yml + the NSIS installer. Linux: latest-linux.yml + an AppImage;
  // electron-updater downloads it only for a running AppImage ($APPIMAGE), so a dummy stands in.
  const windows = process.platform === 'win32',
    feedFile = windows ? 'latest.yml' : 'latest-linux.yml',
    asset = windows ? 'TechnicallyNot.ai-Setup-9.9.9.exe' : 'TechnicallyNot.ai-9.9.9.AppImage';
  if (!windows && !process.env.APPIMAGE) {
    process.env.APPIMAGE = require('path').join(profile, 'TechnicallyNot.ai-0.0.0.AppImage');
    fs.writeFileSync(process.env.APPIMAGE, 'old');
  }
  const installer = crypto.randomBytes(4096),
    sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  let broken = false;
  const authCalls = [];
  let notesFrom = '';
  const yml = () =>
    `version: 9.9.9\nfiles:\n  - url: ${asset}\n    sha512: ${broken ? 'AAAA' + sha512.slice(4) : sha512}\n    size: ${installer.length}\npath: ${asset}\nsha512: ${sha512}\nreleaseDate: '2026-09-23T00:00:00.000Z'\nreleaseName: 'Technically Not 9.9.9 build 99'\nreleaseNotes: 'Faster terminals and a fixed dialog.'\n`;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/' + feedFile)) {
      res.writeHead(200, { 'content-type': 'text/yaml' });
      return res.end(yml());
    }

    // Skipped versions' notes (the feed's /updates/notes): 9.9.9 and 9.9.8 are newer
    // than the app; 0.0.1 is not and must not show.
    if (req.url.startsWith('/notes?from=')) {
      notesFrom = decodeURIComponent(req.url.slice('/notes?from='.length));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify([
          { version: '9.9.9', notes: 'Faster terminals and a fixed dialog.' },
          {
            version: '9.9.8',
            notes:
              'Skipped release: calmer agent tree.\n- Fixed: bravo\n- New: alpha\n- Changed: charlie\n- Fixed: delta' /* written mixed on purpose: the dialog must show New, Changed, Fixed */,
          },
          { version: '0.0.1', notes: 'Ancient.' },
        ])
      );
    }
    if (req.url.startsWith('/' + asset)) {
      authCalls.push(req.headers.authorization || '');
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': installer.length,
      });
      return res.end(installer);
    }
    res.writeHead(404);
    res.end();
  });
  return {
    start: () =>
      new Promise(resolve =>
        server.listen(0, '127.0.0.1', () => {
          process.env.TNAI_UPDATE_URL = 'http://127.0.0.1:' + server.address().port + '/';
          process.env.TNAI_UPDATE_NOTES_URL =
            'https://example.invalid/tnai/releases/tag/v{version}'; // never opened by the test
          updater.init(state => {
            if (!win.isDestroyed()) win.webContents.send('update:state', state);
          });
          resolve(updater.state());
        })
      ),
    // The installer was asked for, and no request for it carried an Authorization header.
    installerAsked: () => ({ times: authCalls.length, headers: authCalls.filter(Boolean) }),
    // The public repository's releases page, as the updater works it out from one repository name.
    releasesPage: () => ({
      ofRepo: updater.releasesPageOf('example-owner/example-repo'),
      ofNone: updater.releasesPageOf(''),
      feed: updater.feedOfRepo('example-owner/example-repo'),
    }),
    // The notes request named this build's version (so the feed lists only newer releases).
    notesFrom: () => ({ asked: notesFrom, own: require('electron').app.getVersion() }),
    // Feed conventions: GitHub release page for a GitHub feed, build number from the release name.
    helpers: () => ({
      github: updater.notesUrlFor(
        'https://github.com/example-owner/tnai-releases/releases/latest/download/',
        '0.3.14',
        ''
      ),
      plain: updater.notesUrlFor('https://example.com/feed/', '1.0.0', ''),
      build: updater.buildOf({ releaseName: 'Technically Not 0.3.14 build 19' }),
    }),
    cleanup: () => {
      const cache = require('electron-updater').autoUpdater.downloadedUpdateHelper?.cacheDir;
      if (cache && /tnai/i.test(cache)) fs.rmSync(cache, { recursive: true, force: true });
      server.close();
      return cache || '';
    },
  };
};
