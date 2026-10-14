/*
 * Technically Not tools · desktop-check/tests/send-switch.main.js — Main-process side of
 * send-switch.js: main `[tnai stall]` capture + fake claude CLI (perf-new-task.main.js) and the
 * renderer/main CPU profile (typing-lag.main.js).
 */
'use strict';
module.exports = (win, profile) => {
  const perf = require('./perf-new-task.main.js')(win, profile);
  const lag = require('./typing-lag.main.js')(win);
  return {
    takeStalls: perf.takeStalls,
    profileStart: lag.profileStart,
    profileStop: lag.profileStop,
  };
};
