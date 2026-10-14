// Technically Not tools · desktop-check/tests/projects.main.js — Main-process side of the projects
// self-test (loaded by run.js): makes extra project folders in the throwaway profile, answers the
// native folder picker with a chosen folder (the picker cannot be automated), and reads the saved
// project list. Called from projects.js via TNAI_MAIN.
'use strict';
const fs = require('fs');
const path = require('path');
const { app, dialog } = require('electron');

module.exports = (win, profile) => {
  let next = null;
  dialog.showOpenDialog = async () =>
    next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
  return {
    make(name) {
      const dir = path.join(profile, name);
      fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'README.md'), '# ' + name + '\n');
      fs.writeFileSync(path.join(dir, 'lib', name + '.js'), '// ' + name + '\n');
      return dir;
    },
    pickNext(dir) {
      next = dir;
      return true;
    },
    saved() {
      return JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'project-folder.json'), 'utf8')
      );
    },
    write(dir, rel, text) {
      fs.writeFileSync(path.join(dir, rel), text);
      return true;
    },
    exists(p) {
      return fs.existsSync(p);
    },
    profile() {
      return profile;
    },
    event(paneId, e) {
      require('../../../desktop/agent-hooks').note(paneId, e);
      return true;
    }, // a Claude Code-shaped hook event through the real emitter (no CLI runs)
    async size(w, h) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(w, h);
      await new Promise(r => setTimeout(r, 400));
      return win.getContentSize();
    },
  };
};
