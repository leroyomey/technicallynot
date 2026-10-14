// Technically Not tools · desktop-check/tests/composer-stop.main.js — main-process side of
// composer-stop.js: the window size and the cleanup, as thread-helpers.main.js has them, and touch
// on and off, as thread-tablet.main.js has it.
'use strict';
const helpers = require('./thread-helpers.main.js');
const tablet = require('./thread-tablet.main.js');

module.exports = win => {
  const touchParts = tablet(win);
  return { ...helpers(win), touch: touchParts.touch };
};
