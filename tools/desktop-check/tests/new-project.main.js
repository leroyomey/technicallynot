/*
 * Technically Not tools · desktop-check/tests/new-project.main.js — Main-process side of
 * new-project.js: new projects are made in a folder inside the test profile, never in the user's
 * Documents, and the renderer can ask what is on disk there.
 */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = (win, profile) => {
  const base = path.join(profile, 'new-projects');
  const files = require('../../../desktop/fs-service.js');
  files.newProjectBase(base);
  return {
    // project-chip: the folder "Show folder" asked for (nothing opens on screen in a test)
    revealed: () => files.lastRevealed(),
    base: () => base,
    onDisk: () =>
      fs.existsSync(base)
        ? fs
            .readdirSync(base, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name)
            .sort()
        : [],
    entries: name => fs.readdirSync(path.join(base, name)).length,
    size: async (w, h) => {
      win.setContentSize(w, h);
      await new Promise(r => setTimeout(r, 500));
      return win.getContentSize();
    }, // project-chip: the menu in a narrow window
  };
};
