/*
 * Technically Not tools · desktop-check/tests/tnai-new-opencode.main.js — Main-process side of the
 * tnai-new-opencode test: a fake `opencode` (plain Node, never the real CLI, no credits) first on
 * PATH that starts like OpenCode 1.18 on Windows (measured live 2026-09-26: a little output at
 * once, ~1.9 s of silence, then its screen; input typed or pasted before the screen is drawn is
 * lost, not queued).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const FAKE = `// Fake OpenCode: detection calls (no console) answer and exit; the interactive start is silent for a while, then draws, then takes pasted text + Enter.
const [, , ...argv] = process.argv;
if (argv[0] === '--version') { console.log('1.18.32'); process.exit(0); }
if (argv[0] === 'auth') { console.log('0 credentials'); process.exit(0); }
if (argv[0] === 'models') { console.log('opencode/big-pickle'); process.exit(0); }
if (!process.stdin.isTTY) process.exit(0);
const SILENT_MS = Number(process.env.FAKE_OPENCODE_SILENT_MS || 1900);
let ready = false, input = '';
process.stdout.write('\\x1b[?1049h\\x1b[?25l'); // at once, like the real one (alternate screen, cursor off)
process.stdin.setRawMode(true); process.stdin.resume();
process.stdin.on('data', d => {
  if (!ready) return; // before its screen is drawn the real one drops input
  const s = String(d).replace(/\\x1b\\[20[01]~/g, '');
  for (const ch of s) {
    if (ch === '\\r') { if (input.trim()) { process.stdout.write('\\r\\nFAKE-opencode got: ' + JSON.stringify(input) + '\\r\\n'); input = ''; } }
    else if (ch === '\\x03') process.exit(0);
    else if (ch >= ' ' || ch === '\\n') input += ch;
  }
});
setTimeout(() => { process.stdout.write('\\x1b[2J\\x1b[HFAKE-opencode screen: Ask anything\\r\\nFAKE-opencode args: ' + JSON.stringify(argv) + '\\r\\n'); ready = true; }, SILENT_MS);
`;

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'fake-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'fake-opencode.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'opencode.cmd'), '@node "%~dp0fake-opencode.js" %*\r\n');
  else
    fs.writeFileSync(
      path.join(bin, 'opencode'),
      '#!/bin/sh\nexec node "$(dirname "$0")/fake-opencode.js" "$@"\n',
      { mode: 0o755 }
    );

  // Before the window loads, so agent detection (and the path it caches) finds this fake, never a
  // real opencode.
  const key = Object.keys(process.env).find(k => k.toUpperCase() === 'PATH');
  process.env[key] = bin + path.delimiter + process.env[key];
  return { paths: () => ({ bin }) };
};
