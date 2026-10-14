/*
 * Technically Not desktop · shell-path.js — mac/Linux only: an app started from the Dock, Finder or
 * a desktop menu gets a minimal PATH (/usr/bin:/bin:...), so agent CLIs installed by Homebrew, npm
 * or ~/.local/bin look "not installed". Once at startup, before any CLI detection, the PATH of the
 * user's login shell is read and merged in front of the inherited one. Markers around the value
 * strip any rc-file output; a slow or broken shell times out and only the common install folders
 * are added. Windows: does nothing.
 */
'use strict';
if (process.platform !== 'win32') {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const path = require('path');
  const MARK = '__TNAI_PATH__';
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  let found = '';
  try {
    // printenv prints the exported, colon-joined PATH in every shell (sh, bash, zsh, fish).
    // detached: own session, so an interactive shell started from a terminal can't be stopped by
    // job control (SIGTTOU); SIGKILL: a stopped process ignores SIGTERM until resumed, which would
    // block this sync call forever.
    const out = execFileSync(
      shell,
      ['-ilc', `printf '%s' ${MARK}; printenv PATH; printf '%s' ${MARK}`],
      {
        encoding: 'utf8',
        timeout: 5000,
        killSignal: 'SIGKILL',
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );
    const parts = out.split(MARK);
    if (parts.length >= 3) found = parts[parts.length - 2].trim();
  } catch (error) {
    console.warn('[shell-path] login shell PATH not read:', error.code || error.message);
  }
  const home = os.homedir();
  const common = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ];
  const merged = [
    ...found.split(':'),
    ...String(process.env.PATH || '').split(':'),
    ...common,
  ].filter(Boolean);
  process.env.PATH = [...new Set(merged)].join(':');
}
