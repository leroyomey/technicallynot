// Technically Not tools · desktop-check/tests/thread-late-answer.main.js — main-process side of
// thread-late-answer.js: the helpers of thread-helpers.main.js (a made-up Claude Code transcript
// written where the app looks for a panel's session, the window's size), plus one of its own:
// more lines appended to that transcript later, the way the tool itself adds them. Nothing here
// sends a prompt.
'use strict';
const fs = require('fs');
const helpers = require('./thread-helpers.main.js');

module.exports = win => {
  const base = helpers(win);

  // panel id -> { file, cwd } of the transcript this test wrote for it
  const files = new Map();
  return {
    ...base,
    writeTranscript(paneId, lines) {
      const file = base.writeTranscript(paneId, lines);
      if (file) files.set(String(paneId), { file, cwd: base.record(paneId).cwd });
      return file;
    },

    // Appends `lines` (objects) to the transcript written for that panel. False when this test
    // wrote none for it: no other file is ever touched.
    appendTranscript(paneId, lines) {
      const known = files.get(String(paneId));
      if (!known) return false;
      fs.appendFileSync(
        known.file,
        lines.map(line => JSON.stringify({ cwd: known.cwd, ...line })).join('\n') + '\n'
      );
      return true;
    },
  };
};
