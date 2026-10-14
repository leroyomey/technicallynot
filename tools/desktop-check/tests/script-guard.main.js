// Technically Not tools · desktop-check/tests/script-guard.main.js — Main-process side of
// script-guard.js: writes down what kind Electron gives each file request and what the guard
// answered, and makes two small worker files that say so when they run.
//
// Why: a worker that was refused and a worker that ran without a word look the same from the
// page. The probe file posts a message when it runs, and the list kept here says whether the
// guard was asked about the file at all.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { mayLoad } = require('../../../desktop/script-guard.js');

const appRoot = path.join(__dirname, '..', '..', '..');
const PROBE = "self.postMessage('probe ran');\n";

module.exports = win => {
  const requests = [];

  // Electron keeps one listener per session, so this one takes the guard's place. It asks the
  // app's own rule (mayLoad) and answers what the guard would, and keeps a note of each request.
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['file://*/*'] }, (details, done) => {
    const cancel = !mayLoad(details.url, details.resourceType, appRoot);
    requests.push({ url: details.url, kind: details.resourceType, cancel });
    done({ cancel });
  });

  // one probe inside a code folder, one outside every code folder
  const insideFile = path.join(appRoot, 'node_modules', '.tnai-script-guard-probe.js');
  const outsideFile = path.join(os.tmpdir(), 'tnai-script-guard-probe-' + process.pid + '.js');

  const clean = () => {
    for (const file of [insideFile, outsideFile]) fs.rmSync(file, { force: true });
    return true;
  };
  require('electron').app.once('will-quit', clean);

  return {
    probes() {
      fs.writeFileSync(insideFile, PROBE);
      fs.writeFileSync(outsideFile, PROBE);
      return {
        inside: pathToFileURL(insideFile).href,
        outside: pathToFileURL(outsideFile).href,
      };
    },

    // The requests whose address holds `mark`, as "kind, let through" or "kind, cancelled".
    seen(mark) {
      return requests
        .filter(request => request.url.includes(mark))
        .map(request => request.kind + (request.cancel ? ', cancelled' : ', let through'));
    },
    clean,
  };
};
