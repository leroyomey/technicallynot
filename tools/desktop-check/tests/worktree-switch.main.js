/*
 * Technically Not tools · desktop-check/tests/worktree-switch.main.js — Main-process side of
 * worktree-switch.js: git isolated from the user's config (git-remote.main.js), the seeded project
 * made a repo with one commit, an agent worktree made for a pane id without starting any process, a
 * second project folder, the folder picker answered.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { dialog } = require('electron');
const base = require('./git-remote.main.js');

module.exports = (win, profile) => {
  const api = base(win, profile);
  let next = null;
  dialog.showOpenDialog = async () =>
    next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
  const git = (cwd, ...args) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd,
      stdio: 'pipe',
    });
  return {
    ...api,
    async setup() {
      const a = require('../../../desktop/fs-service').root();
      git(a, 'init', '-q');
      git(a, 'add', '-A');
      git(a, 'commit', '-q', '-m', 'first');
      const b = path.join(profile, 'proj-b');
      fs.mkdirSync(b, { recursive: true });
      fs.writeFileSync(path.join(b, 'README.md'), '# b\n');
      return { a, b };
    },
    async worktree(paneId) {
      return require('../../../desktop/worktree-service').paneCwd({
        paneId,
        agent: 'Terminal',
        worktree: true,
      });
    },
    pickNext(dir) {
      next = dir;
      return true;
    },
    write(dir, rel, text) {
      fs.writeFileSync(path.join(dir, rel), text);
      return true;
    },
  };
};
