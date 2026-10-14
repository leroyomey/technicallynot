/*
 * Technically Not tools · desktop-check/remote-check-preload.js — TEST ONLY, loaded by
 * remote-check.js with `electron -r`. run.js makes a new random profile folder on every start and
 * deletes it when the test ends; the two-app check has to quit one app and start it again with the
 * same profile (its sign-in, device id and pairing). With TNAI_REMOTE_CHECK_PROFILE set, run.js's
 * "tnai-desktop-check-" folder is that fixed folder instead, and run.js's delete of it at the end
 * of a run does nothing (remote-check.js deletes it when the whole check is over). Nothing else is
 * changed, and nothing in the app loads this file.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const fixed = process.env.TNAI_REMOTE_CHECK_PROFILE;
if (fixed) {
  const real = fs.mkdtempSync,
    realRm = fs.rmSync;
  fs.mkdtempSync = (prefix, ...rest) => {
    if (path.basename(String(prefix)) !== 'tnai-desktop-check-') return real(prefix, ...rest);
    fs.mkdirSync(fixed, { recursive: true });
    return fixed;
  };
  fs.rmSync = (target, ...rest) =>
    path.resolve(String(target)) === path.resolve(fixed) ? undefined : realRm(target, ...rest);
}
