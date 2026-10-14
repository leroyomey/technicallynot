/*
 * Technically Not tools · desktop-check/tests/limit-switch.main.js — Main-process side of
 * limit-switch.js: a FAKE `claude` (a plain Node script, never the real CLI, so no usage and the
 * user's Claude Code sign-in is never touched) put first on PATH before Technically Not detects
 * CLIs. It reports every account as signed in (`auth status`). In a panel it says which account
 * folder it runs on and prints Claude Code's usage-limit line when it reads the line "limit".
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: (process.env.CLAUDE_CONFIG_DIR ? 'second' : 'first') + '@example.com', authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0); // Technically Not's own CLI detection runs it without a console
console.log('FAKE-claude ready dir=' + (process.env.CLAUDE_CONFIG_DIR || 'default'));
require('readline').createInterface({ input: process.stdin }).on('line', raw => {
  if (raw.trim().endsWith('limit')) console.log('5-hour ' + 'limit' + ' reached \\u2219 resets 11:58pm');
});
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-claude-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake-claude.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0fake-claude.js" %*\r\n');
  else
    fs.writeFileSync(
      path.join(bin, 'claude'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-claude.js" "$@"\n',
      { mode: 0o755 }
    );

  // Set before the renderer loads, so Technically Not's first lookup of `claude` finds this fake.
  // The lookup prefers an .exe over a .cmd, so the folders that hold the real claude.exe leave this
  // test process's PATH (only here; nothing on the PC changes).
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  const rest = process.env[key]
    .split(path.delimiter)
    .filter(dir => dir && !fs.existsSync(path.join(dir, 'claude.exe')));
  process.env[key] = [bin, ...rest].join(path.delimiter);
  return { bin: () => bin };
};
