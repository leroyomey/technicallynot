/*
 * Technically Not tools · desktop-check/tests/live-preview-live.main.js — Main-process side of
 * live-preview-live: writes a project file with plain fs, like an agent's edit (the window's own
 * fs.write is Technically Not's Save, which the watcher leaves out of fs:changes on purpose).
 */
'use strict';
const fs = require('fs'),
  path = require('path');

module.exports = (win, profile) => ({
  write: (rel, text) => {
    fs.writeFileSync(path.join(profile, 'sample-project', String(rel)), String(text));
    return true;
  },
});
