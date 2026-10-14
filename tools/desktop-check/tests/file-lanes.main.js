// Technically Not tools · desktop-check/tests/file-lanes.main.js — Main-process side of the
// file-lanes self-test: the worktrees test's helpers (isolated git config, userData, `read` a
// file's text by full path, `size` for the 1024 px screenshot).
'use strict';
module.exports = (win, profile) => require('./worktrees.main.js')(win, profile);
