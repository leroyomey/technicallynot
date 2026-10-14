/*
 * Technically Not tools · desktop-check/tests/composer-access.main.js — Main-process side of
 * composer-access.js: a FAKE `claude` (a plain Node script, never the real CLI, so no usage and the
 * user's sign-in is never touched) put first on PATH; it prints the --permission-mode it was
 * started with.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'first@example.com', authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0);
const at = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : 'none'; };
console.log('FAKE-claude permission=' + at('--permission-mode') + ' resume=' + at('--resume') + ' .');
require('readline').createInterface({ input: process.stdin }).on('line', () => {});
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-claude-bin'),
    home = path.join(profile, 'fake-claude-home');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake-claude.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0fake-claude.js" %*\r\n');
  else
    fs.writeFileSync(
      path.join(bin, 'claude'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-claude.js" "$@"\n',
      { mode: 0o755 }
    );
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  const rest = process.env[key]
    .split(path.delimiter)
    .filter(dir => dir && !fs.existsSync(path.join(dir, 'claude.exe')));
  process.env[key] = [bin, ...rest].join(path.delimiter);
  process.env.CLAUDE_CONFIG_DIR = home;
  return {};
};
