// Test of the "does the CLI really start" check in desktop/agent-registry.js (startProblem, used by
// detection and by health for cli-updates.js) and the matching panel check in
// src/scripts/10-live-terminals.js: node tools/cli-start-check-test.js (plain Node, Windows, a
// throwaway folder in the temp folder, nothing downloaded or installed).
//
// A half-finished npm install of Claude Code leaves a 500-byte text stub as bin/claude.exe behind
// a working npm shim, so `where.exe claude` finds it. The test builds that shape, and next to it a
// working CLI, and checks that only the broken one is called not installed, with its repair.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
let failed = 0;

function check(name, ok, got) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (got !== undefined ? '  got ' + JSON.stringify(got) : ''));
  }
}

// The texts a half-finished install gives, as seen on 2026-10-15 with Claude Code 2.1.300.
const BROKEN_TEXTS = [
  'Error: claude native binary not installed.',
  "This version of C:\\x\\claude.exe is not compatible with the version of Windows you're running.",
  'spawn UNKNOWN',
  'Cannot create process, error code: 216',
];
const WORKING_TEXTS = ['2.1.300 (Claude Code)', 'codex-cli 0.46.0', 'Process exited with code 1'];

// The npm shim npm 11 writes for a package whose bin is an .exe.
const NPM_SHIM =
  '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\n' +
  'CALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n';
const STUB = '#!/bin/sh\necho "Error: claude native binary not installed." >&2\nexit 1\n';

function matcherFrom(file) {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const found = text.match(/const INCOMPLETE =\s*\/(.+)\/i;/);
  return found ? new RegExp(found[1], 'i') : null;
}

async function main() {
  // The registry's and the panel's matchers are the same, and they catch every broken text and
  // none of the working ones.
  const inRegistry = matcherFrom('desktop/agent-registry.js');
  const inPanel = matcherFrom('src/scripts/10-live-terminals.js');
  check('matcher in agent-registry.js', !!inRegistry);
  check('matcher in 10-live-terminals.js', !!inPanel);
  check(
    'both matchers are the same',
    inRegistry && inPanel && inRegistry.source === inPanel.source
  );
  for (const text of BROKEN_TEXTS) check('broken text caught: ' + text, inRegistry?.test(text));
  for (const text of WORKING_TEXTS) check('working text passed: ' + text, !inRegistry?.test(text));

  if (process.platform !== 'win32') {
    console.log('(the install shapes below are Windows only; skipped)');
    return;
  }

  // A broken install (npm shim + text stub) and a working one, each alone on PATH.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tnai-cli-start-'));
  const broken = path.join(root, 'broken');
  const working = path.join(root, 'working');
  const bin = path.join(broken, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'claude.exe'), STUB);
  fs.writeFileSync(path.join(broken, 'claude.cmd'), NPM_SHIM);
  fs.mkdirSync(working);
  fs.writeFileSync(path.join(working, 'claude.cmd'), '@echo 2.1.300 (Claude Code)\r\n');

  const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const realPath = process.env.PATH;

  // USERPROFILE points away from the user's real ~/.local/bin, so the fallback never finds it.
  process.env.USERPROFILE = root;
  const agents = require('../desktop/agent-registry');
  try {
    process.env.PATH = broken + ';' + system;
    const health = await agents.health('Claude Code');
    check('broken: health names a problem', /incomplete/.test(health.problem), health);
    check(
      'broken: repair is the npm reinstall',
      health.repair === 'npm install -g @anthropic-ai/claude-code',
      health.repair
    );
    const info = await agents.detectAccount('Claude Code', null);
    check('broken: detection says not installed', info.installed === false, info);
    check('broken: detection says incomplete', info.incomplete === true, info);
    check('broken: note says why', /does not start/.test(info.note), info.note);

    process.env.PATH = working + ';' + system;
    const fine = await agents.health('Claude Code');
    check('working: no problem', fine.problem === '', fine);
    check('working: version read', fine.version === '2.1.300 (Claude Code)', fine.version);
  } finally {
    process.env.PATH = realPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main()
  .catch(error => {
    failed++;
    console.log('FAIL thrown: ' + (error?.stack || error));
  })
  .finally(() => {
    console.log(passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
