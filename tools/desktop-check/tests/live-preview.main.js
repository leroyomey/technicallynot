// Technically Not tools · desktop-check/tests/live-preview.main.js — Main-process side of the
// live-preview self-test: git isolated from the user's own config (git-remote.main.js, for the
// worktree part) and `size` (window content size, for the 1024 px screenshot of a project tab and a
// worktree tab).
'use strict';
const base = require('./git-remote.main.js');

module.exports = (win, profile) => ({
  ...base(win, profile),
  size: (w, h) => {
    win.setContentSize(w, h);
    return true;
  },
  write: (rel, text) => {
    require('fs').writeFileSync(
      require('path').join(profile, 'sample-project', String(rel)),
      String(text)
    );
    return true;
  },
}); // like an agent's edit (live-preview-live.main.js)
