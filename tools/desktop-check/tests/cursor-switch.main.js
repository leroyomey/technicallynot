/*
 * Technically Not tools · desktop-check/tests/cursor-switch.main.js — Main-process side of
 * cursor-switch.js: a FAKE `cursor-agent` (a plain Node script, never the real CLI, so the user's
 * real Cursor sign-in is never touched) put first on PATH before Technically Not detects CLIs. It
 * keeps a fake sign-in in state.json and appends every call's arguments to calls.log. `login`
 * behaves per mode: 'ok' signs in as next@example.com, 'fail' prints an error and exits 1, 'hang'
 * waits (a sign-in the user abandons).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `const fs = require('fs'), path = require('path');
const dir = __dirname, state = path.join(dir, 'state.json'), args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\\n');
const s = JSON.parse(fs.readFileSync(state, 'utf8'));
const save = () => fs.writeFileSync(state, JSON.stringify(s));
if (args[0] === '--version') console.log('2026.09.01-fake');
else if (args[0] === 'status' || args[0] === 'whoami') console.log(s.email ? '\\u2713 Logged in as ' + s.email : 'Not logged in');
else if (args[0] === 'logout') { s.email = ''; save(); console.log('FAKE-CURSOR logged out'); }
else if (args[0] === 'login') {
  console.log('FAKE-CURSOR login mode=' + s.mode);
  if (s.mode === 'fail') { console.log('FAKE-CURSOR login failed'); process.exit(1); }
  if (s.mode === 'hang') setInterval(() => {}, 1000);
  else { s.email = 'next@example.com'; save(); console.log('\\u2713 Logged in as next@example.com'); }
}
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-cursor-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake-cursor.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'cursor-agent.cmd'), '@node "%~dp0fake-cursor.js" %*\r\n');
  else
    fs.writeFileSync(
      path.join(bin, 'cursor-agent'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-cursor.js" "$@"\n',
      { mode: 0o755 }
    );
  const reset = (email, mode) => {
    fs.writeFileSync(path.join(bin, 'state.json'), JSON.stringify({ email, mode }));
    fs.writeFileSync(path.join(bin, 'calls.log'), '');
    return true;
  };
  reset('first@example.com', 'ok');

  // Set before the renderer loads, so Technically Not's first `where cursor-agent` finds this fake
  // first (the real one is also a .cmd, later on PATH).
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  process.env[key] = bin + path.delimiter + process.env[key];
  return {
    bin: () => bin,
    reset,
    // Only the calls a switch makes (detection's --version/status/--list-models left out), in
    // order.
    calls: () =>
      fs
        .readFileSync(path.join(bin, 'calls.log'), 'utf8')
        .split(/\r?\n/)
        .filter(l => /^(logout|login)\b/.test(l)),
    state: () => JSON.parse(fs.readFileSync(path.join(bin, 'state.json'), 'utf8')),
  };
};
