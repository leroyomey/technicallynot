/*
 * Technically Not tools · desktop-check/tests/stopped-resume.main.js — Main-process side of
 * stopped-resume.js: a FAKE `claude` (a plain Node script, never the real CLI, so no usage and the
 * user's Claude Code sign-in is never touched) put first on PATH before Technically Not detects
 * CLIs. It keeps its conversations in a throwaway folder (CLAUDE_CONFIG_DIR inside the test
 * profile, never the user's ~/.claude): `--session-id ID` writes the transcript Technically Not
 * looks for, `--resume ID` says so on screen, and the line "refuse" makes its next resume fail at
 * once with exit code 1.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `const fs = require('fs'), path = require('path');
const args = process.argv.slice(2), home = process.env.CLAUDE_CONFIG_DIR;
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') { console.log(JSON.stringify({ loggedIn: true, email: 'first@example.com', authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0); // Technically Not's own CLI detection runs it without a console
if (!home) { console.log('FAKE-claude has no throwaway home'); process.exit(1); }
const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : ''; };
const fresh = at('--session-id'), resumed = at('--resume'), marker = path.join(home, 'refuse-next');
if (resumed && fs.existsSync(marker)) { fs.rmSync(marker); console.log('No conversation found with session ID: ' + resumed); process.exit(1); }
if (fresh) { const dir = path.join(home, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-')); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, fresh + '.jsonl'), '{"type":"user"}\\n'); }
console.log('FAKE-claude ' + (resumed ? 'resumed=' + resumed : 'fresh=' + fresh) + ' .');
if (fresh) console.log('first-run row 2\\nfirst-run row 3\\nfirst-run row 4\\x1b[2A\\r'); // the cursor ends above the last rows, like a CLI's input box with a rule and a status line under it; // rows only the first run draws: a view that keeps them under a later run's header was not cleared
require('readline').createInterface({ input: process.stdin }).on('line', raw => {
  if (raw.trim().endsWith('refuse')) { fs.writeFileSync(marker, '1'); console.log('FAKE-claude will refuse .'); }
  else if (raw.trim()) console.log('FAKE-claude got ' + raw.trim().slice(-20) + ' .');
});
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

  // Set before the renderer loads, so Technically Not's first lookup of `claude` finds this fake.
  // The lookup prefers an .exe over a .cmd, so the folders that hold the real claude.exe leave this
  // test process's PATH (only here; nothing on the PC changes).
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  const rest = process.env[key]
    .split(path.delimiter)
    .filter(dir => dir && !fs.existsSync(path.join(dir, 'claude.exe')));
  process.env[key] = [bin, ...rest].join(path.delimiter);

  // the fake's transcripts, and where Technically Not looks for them (session-store claudeHomes)
  process.env.CLAUDE_CONFIG_DIR = home;
  return { bin: () => bin };
};
