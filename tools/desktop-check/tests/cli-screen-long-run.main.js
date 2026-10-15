// Technically Not tools · desktop-check/tests/cli-screen-long-run.main.js — Main-process side of
// cli-screen-long-run.js: a fake `claude` on PATH (never the real CLI, no credits) that draws its
// screen at the start and again whenever its terminal is resized, a record of every size sent to
// a pty, and a stand-in for the replay that shapes it like a long-running agent's: only spinner
// updates, the screen itself cut off.
'use strict';
const fs = require('fs'),
  path = require('path');
const ptys = require('../../../desktop/pty-service');

// The fake CLI. It draws a small screen (a title and an input box) at the start and on every
// resize, the way Claude Code answers a resize, and stays until it reads "quit".
const FAKE = `// Technically Not's own CLI detection runs it without a console: answer and end
if (!process.stdin.isTTY || process.argv.includes('--version')) { console.log('1.0.0 (Claude Code)'); process.exit(0); }
const draw = why => {
  const cols = process.stdout.columns, rows = process.stdout.rows;
  process.stdout.write('\\x1b[H\\x1b[2J' + 'LONG-CLI screen ' + why + ' ' + cols + 'x' + rows + '\\r\\n> input box\\r\\n');
};
draw('start');
process.stdout.on('resize', () => draw('redrawn'));
// raw mode, as Claude Code reads its input: on Windows a resize reaches node only while it reads so
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
let typed = '';
process.stdin.on('data', text => { typed += text; if (/quit/.test(typed)) process.exit(0); });
setInterval(() => {}, 60000);
`;

// What a long wait leaves in the kept tail: about 250 KB of spinner and clock updates.
function spinnerTail() {
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
  let text = '';
  for (let second = 0; text.length < 250 * 1024; second++)
    text +=
      '\r' + frames[second % frames.length] + ' Working… (' + second + 's · esc to interrupt)';
  return text;
}

module.exports = (_win, profile) => {
  const bin = path.join(profile, 'long-run-bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'long.js'), FAKE);
  if (process.platform === 'win32')
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@node "%~dp0long.js" %*\r\n');
  else
    fs.writeFileSync(path.join(bin, 'claude'), '#!/bin/sh\nexec node "$(dirname "$0")/long.js"\n', {
      mode: 0o755,
    });

  // Panes copy this PATH when they start: Technically Not's shim folder goes in front of it, so a
  // hand-typed `claude` reaches the shim, then this fake.
  const key = Object.keys(process.env).find(name => name.toUpperCase() === 'PATH');
  process.env[key] = bin + path.delimiter + process.env[key];

  // Every size sent to a pty.
  const realResize = ptys.resize,
    calls = [];
  ptys.resize = (paneId, cols, rows) => {
    calls.push({ paneId, size: cols + 'x' + rows });
    return realResize(paneId, cols, rows);
  };

  // The replay of the panel named by cut(): its buffer is the spinner tail alone.
  const realReplay = ptys.replayAsync;
  let cutPane = '';
  ptys.replayAsync = async paneId => {
    const answer = await realReplay(paneId);
    if (paneId !== cutPane || !answer) return answer;
    return { ...answer, buffer: spinnerTail() };
  };

  return {
    paths: () => ({ bin }),
    cut(paneId) {
      cutPane = paneId;
      return true;
    },
    // The end of the panel's real output, escape sequences left out.
    raw: async paneId =>
      String((await realReplay(paneId))?.buffer || '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, '')
        .slice(-600),
    resizes: paneId => calls.filter(call => call.paneId === paneId).map(call => call.size),
    clear() {
      calls.length = 0;
      return true;
    },
  };
};
