/*
 * Technically Not tools · desktop-check/session-temp-check.js — desktop/session-store.js init()
 * removes temp files a cut-off write left in its scrollback folder, and nothing else. Plain Node,
 * no Electron (the electron module is replaced by a stub whose userData is a temp folder): a .tmp
 * older than a day goes; a fresh .tmp (a write in progress), every .log (also one with no record)
 * and a .tmp outside scrollback/ stay. Run: node tools/desktop-check/session-temp-check.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-session-temp-'));
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron'
    ? { app: { getPath: () => tmp } }
    : realLoad.call(this, request, ...rest);
};
const store = require('../../desktop/session-store');

let ok = true;
const check = (cond, label) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label);
  if (!cond) ok = false;
};
const scroll = path.join(tmp, 'scrollback');
fs.mkdirSync(scroll);
const twoDaysAgo = (Date.now() - 2 * 86400000) / 1000;
const make = (file, old) => {
  fs.writeFileSync(file, 'x');
  if (old) fs.utimesSync(file, twoDaysAgo, twoDaysAgo);
  return file;
};
const oldTemp = make(path.join(scroll, 'pane-1.log.1234.tmp'), true),
  oldTempA = make(path.join(scroll, 'pane-2.log.1234.a.tmp'), true);
const freshTemp = make(path.join(scroll, 'pane-3.log.99.a.tmp'), false);
const oldLog = make(path.join(scroll, 'pane-gone.log'), true),
  rootTemp = make(path.join(tmp, 'other.json.1234.tmp'), true);
fs.writeFileSync(
  path.join(tmp, 'sessions.json'),
  JSON.stringify([{ paneId: 'pane-1', agent: 'claude-code' }])
);

(async () => {
  store.init();
  for (let i = 0; i < 40 && (fs.existsSync(oldTemp) || fs.existsSync(oldTempA)); i++)
    await new Promise(r => setTimeout(r, 50));
  check(
    !fs.existsSync(oldTemp) && !fs.existsSync(oldTempA),
    'temp files older than a day are removed from scrollback/'
  );
  check(fs.existsSync(freshTemp), 'a fresh temp file (a write in progress) stays');
  check(fs.existsSync(oldLog), 'a log with no record stays');
  check(fs.existsSync(rootTemp), 'a temp file outside scrollback/ stays');
  check(store.get('pane-1')?.agent === 'claude-code', 'the records still load');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('RESULT: ' + (ok ? 'PASS' : 'FAIL'));
  process.exit(ok ? 0 : 1);
})();
