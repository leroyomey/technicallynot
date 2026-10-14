/*
 * Technically Not tools · desktop-check/tests/decision-steps.main.js — Main-process side of
 * decision-steps.js: a finished turn fed through the real agent-lifecycle.js + agent-context.js as
 * main.js does, then pushed to the window as `agent:turn`. The turn starts now (not before the
 * panel's own process, which 51 `deciding` would read as an older session's result). No process is
 * launched, no prompt is sent.
 */
'use strict';
const lifecycle = require('../../../desktop/agent-lifecycle');
const context = require('../../../desktop/agent-context');
const files = require('../../../desktop/fs-service');

module.exports = win => ({
  finish(paneId, name, task, result) {
    lifecycle.started({
      paneId,
      agent: 'Claude Code',
      name,
      root: files.root(),
      cwd: files.root(),
      sessionId: 'test-' + paneId,
    });
    const t = {
      paneId,
      agent: 'Claude Code',
      source: 'test',
      startedAt: Date.now() - 400,
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task,
      result: '',
    };
    lifecycle.onTurn(t);
    context.onTurn(t);
    win.webContents.send('agent:turn', t);
    const done = { ...t, endedAt: Date.now(), endedBy: 'stop', result };
    lifecycle.onTurn(done);
    context.onTurn(done);
    win.webContents.send('agent:turn', done);
    return true;
  },
});
