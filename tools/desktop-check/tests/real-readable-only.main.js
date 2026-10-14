// Technically Not tools · desktop-check/tests/real-readable-only.main.js — main-process side of
// real-readable-only.js: which page the run is for (TNAI_READABLE_PAGE=all for the All threads
// page, the Threads page otherwise), and whether a file exists in the test's throwaway project,
// with what is in it. Nothing outside that project folder is read.
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

module.exports = () => {
  // the folder run.js made for this run and wrote into the profile
  const project = () =>
    JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'project-folder.json'), 'utf8'))
      .root;

  return {
    page: () => (process.env.TNAI_READABLE_PAGE === 'all' ? 'all' : 'threads'),

    // A file directly in the project folder: { there, text }. A name with a folder in it is
    // refused.
    file(name) {
      const plain = path.basename(String(name || ''));
      if (!plain || plain !== name) return { there: false, text: '' };
      const full = path.join(project(), plain);
      if (!fs.existsSync(full)) return { there: false, text: '' };
      return { there: true, text: fs.readFileSync(full, 'utf8').slice(0, 200) };
    },
  };
};
