/*
 * Technically Not tools · desktop-check/tests/cli-screen-capture.main.js — Main-process side of
 * cli-screen-capture.js (loaded by run.js): reads a capture folder the app wrote, writes the replay
 * files into it, and diffs a replay with the screen (tools/terminal-capture-compare.js).
 * TNAI_CAPTURE names a folder to replay instead of making a capture (the compare tool sets it).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { diffRows, report } = require('../../terminal-capture-compare');

const read = (folder, f) => {
  try {
    return fs.readFileSync(path.join(folder, f), 'utf8');
  } catch {
    return null;
  }
};

module.exports = () => ({
  mode: () => process.env.TNAI_CAPTURE || '',
  load(folder) {
    const meta = JSON.parse(read(folder, 'capture.json') || 'null');
    return {
      meta,
      log: read(folder, 'pty-tail.log'),
      screen: read(folder, 'screen.txt'),
      visible: read(folder, 'visible.txt'),
      files: fs.existsSync(folder) ? fs.readdirSync(folder) : [],
      inCaptures: path
        .resolve(folder)
        .startsWith(path.join(app.getPath('userData'), 'captures') + path.sep),
    };
  },
  writeReplay(folder, name, text) {
    if (!['replay-app.txt', 'replay-plain.txt'].includes(name))
      throw new Error('not a replay file: ' + name);
    fs.writeFileSync(path.join(folder, name), String(text));
    return name;
  },
  diff(folder, replayText) {
    const d = diffRows(read(folder, 'screen.txt'), replayText, 400);
    return { differ: d.differ, rows: d.a.length, lines: report(d).slice(0, 30) };
  },
});
