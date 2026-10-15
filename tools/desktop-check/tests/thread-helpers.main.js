// Technically Not tools · desktop-check/tests/thread-helpers.main.js — main-process side of
// thread-helpers.js. It stands in for three things the test cannot have for free: a conversation
// (it writes a made-up Claude Code transcript where the app looks for that panel's session, and
// deletes it again), a lead that started a helper in a panel of its own (it pushes a graph state
// to the window, as desktop/agent-graph.js does), and a file one agent holds while another asks
// for it (the app's real lock module). It also sizes the test window. Nothing here sends a prompt.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const sessionStore = require('../../../desktop/session-store');
const fileLocks = require('../../../desktop/file-locks');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const slug = folder => String(folder || '').replace(/[^a-zA-Z0-9]/g, '-');

module.exports = win => {
  const written = [];
  return {
    minimum: () => win.getMinimumSize(),
    content: () => win.getContentSize(),
    setMinimum(width, height) {
      win.setMinimumSize(width, height);
      return win.getMinimumSize();
    },
    async size(width, height) {
      if (win.isMaximized()) win.unmaximize();
      win.setContentSize(width, height);
      await sleep(450);
      return win.getContentSize();
    },

    // The saved session record of a panel: its tool, its session id, its working folder.
    record(paneId) {
      const record = sessionStore.get(String(paneId)) || {};
      return {
        agent: record.agent || '',
        sessionId: record.sessionId || '',
        cwd: record.cwd || '',
      };
    },

    // Writes `lines` (objects) as the transcript of that panel's Claude Code session, in the place
    // desktop/thread-log-claude.js looks for it.
    writeTranscript(paneId, lines) {
      const record = sessionStore.get(String(paneId));
      if (!record?.sessionId || !record.cwd) return '';
      const home =
        record.accountDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
      const folder = path.join(home, 'projects', slug(record.cwd));
      const file = path.join(folder, record.sessionId + '.jsonl');
      if (fs.existsSync(file)) return '';
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(
        file,
        lines.map(line => JSON.stringify({ cwd: record.cwd, ...line })).join('\n') + '\n'
      );
      written.push(file);
      return file;
    },
    // more lines at the end of a transcript writeTranscript made (a turn that follows)
    appendTranscript(paneId, lines) {
      const record = sessionStore.get(String(paneId));
      const file = written.find(each => record?.sessionId && each.includes(record.sessionId));
      if (!file) return false;
      fs.appendFileSync(
        file,
        lines.map(line => JSON.stringify({ cwd: record.cwd, ...line })).join('\n') + '\n'
      );
      return true;
    },
    cleanup() {
      for (const file of written.splice(0)) fs.rmSync(file, { force: true });
      return true;
    },

    // A graph state as the app's own graph pushes it: who started whom.
    graph(state) {
      win.webContents.send('graph:state', state);
      return true;
    },

    // One agent takes a file, another asks for it and is refused: the app's real lock rules.
    lock(project, file, holder, asker) {
      const taken = fileLocks.acquire(project, path.join(project, file), holder);
      const refused = asker ? fileLocks.acquire(project, path.join(project, file), asker) : null;
      return { taken: taken?.ok === true, refused: refused ? refused.ok === false : null };
    },
    unlock(paneId) {
      fileLocks.releasePane(paneId);
      return true;
    },
  };
};
