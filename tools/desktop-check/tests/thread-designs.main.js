// Technically Not tools · desktop-check/tests/thread-designs.main.js — main-process side of
// thread-designs.js: the helpers of thread-helpers.main.js (a made-up Claude Code transcript, the
// window's size), plus the files that transcript names: a page and two pictures, written into a
// folder of their own inside the session's folder and removed again by cleanup.
'use strict';
const fs = require('fs');
const path = require('path');
const sessionStore = require('../../../desktop/session-store');
const helpers = require('./thread-helpers.main.js');

const FOLDER = 'tnai-designs-test';

module.exports = win => {
  const base = helpers(win);
  const folders = [];
  return {
    ...base,

    // files: { name: { text } | { base64 } }, written into FOLDER in the panel's session folder.
    // Answers the folder's name, as the transcript writes its paths.
    writeFiles(paneId, files) {
      const record = sessionStore.get(String(paneId));
      if (!record?.cwd) return '';
      const folder = path.join(record.cwd, FOLDER);
      if (fs.existsSync(folder)) return '';
      fs.mkdirSync(folder, { recursive: true });
      folders.push(folder);
      for (const [name, content] of Object.entries(files || {})) {
        const bytes = content.base64
          ? Buffer.from(content.base64, 'base64')
          : Buffer.from(String(content.text || ''), 'utf8');
        fs.writeFileSync(path.join(folder, path.basename(name)), bytes);
      }
      return FOLDER;
    },
    cleanup() {
      for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
      return base.cleanup();
    },
  };
};
