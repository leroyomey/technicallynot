// Technically Not tools · desktop-check/tests/git-remote.main.js — A shared main-process helper
// with no test of its own (git-remote.js was deleted 2026-09-30); worktrees, worktree-switch,
// live-preview and file-activity load it from their own .main.js. It isolates git from the user's
// own global/system config (so no credential manager window can open and the user's settings are
// never touched), a local HTTP server that always answers 401 (a remote that needs sign-in), and a
// folder-exists check.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');

module.exports = (_win, profile) => {
  const globalConfig = path.join(profile, 'gitconfig-global');
  fs.writeFileSync(globalConfig, '');

  // Inherited by Technically Not's git runs and by shell panes started later.
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_NOSYSTEM: '1' });
  let server = null;
  return {
    async authServer() {
      if (server) return server.address().port;
      server = http.createServer((_req, res) => {
        res.writeHead(401, {
          'WWW-Authenticate': 'Basic realm="tnai-test"',
          'Content-Type': 'text/plain',
        });
        res.end('sign in required');
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    },
    exists: dir => fs.existsSync(dir),
    userData: () => require('electron').app.getPath('userData'),
  };
};
