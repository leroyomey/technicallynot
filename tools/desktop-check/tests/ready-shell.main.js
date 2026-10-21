/*
 * Technically Not tools · desktop-check/tests/ready-shell.main.js — Main-process side of
 * ready-shell.js: says which PowerShell is kept ready right now (pty-service readyInfo), and ends
 * it at the end of the test.
 */
'use strict';
const ptys = require('../../../desktop/pty-service');

module.exports = () => ({
  // { id, cwd, theme } of the PowerShell kept ready, or null when there is none
  ready() {
    return ptys.readyInfo();
  },
  drop() {
    ptys.unwarm();
    return true;
  },
});
