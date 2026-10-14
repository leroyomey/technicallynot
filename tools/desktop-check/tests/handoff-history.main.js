/*
 * Technically Not tools · desktop-check/tests/handoff-history.main.js — Main-process side of
 * handoff-history.js: the finished-turn feed of context-upkeep.main.js (PowerShell panes, no agent
 * CLI), plus a started (unfinished) turn, a clean handoff history, and the window size for the
 * screenshots.
 */
'use strict';
const lifecycle = require('../../../desktop/agent-lifecycle');
const files = require('../../../desktop/fs-service');
const history = require('../../../desktop/handoff-history');

module.exports = win => ({
  ...require('./context-upkeep.main.js')(win),
  // A turn that started and has not finished (the agent is working).
  start(paneId, name, tokens) {
    lifecycle.started({
      paneId,
      agent: 'Claude Code',
      name,
      root: files.root(),
      cwd: files.root(),
      sessionId: 'test-handoff-' + paneId,
    });
    const t = {
      paneId,
      agent: 'Claude Code',
      source: 'test',
      startedAt: Date.now(),
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task: '[TN.ai] handoff test',
      result: '',
      context: tokens ? { tokens, at: Date.now() } : null,
      queued: [],
    };
    lifecycle.onTurn(t);
    win.webContents.send('agent:turn', t);
    return true;
  },
  reset() {
    history._test.reset();
    return true;
  },
  stored() {
    return history.state();
  },
  async size(w, h) {
    if (win.isMaximized()) win.unmaximize();
    win.setContentSize(w, h);
    await new Promise(r => setTimeout(r, 450));
    return win.getContentSize();
  },
});
