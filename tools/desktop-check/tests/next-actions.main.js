/*
 * Technically Not tools · desktop-check/tests/next-actions.main.js — Main-process side of
 * next-actions.js: registers a fake agent instance with the real agent-lifecycle.js and feeds a
 * finished turn through the real agent-lifecycle.js + agent-context.js exactly as main.js does,
 * then pushes `agent:turn` to the window. No process is launched, no prompt is sent.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lifecycle = require('../../../desktop/agent-lifecycle');
const context = require('../../../desktop/agent-context');
const files = require('../../../desktop/fs-service');

module.exports = win => ({
  finish(paneId, name, task, result, agoMs = 0, edit = true) {
    // agoMs: finished that long ago; edit false: no file edited
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
      startedAt: Date.now() - 42000 - agoMs,
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task,
      result: '',
    };
    lifecycle.onTurn(t);
    context.onTurn(t);
    win.webContents.send('agent:turn', t);

    // the file the fake agent "edits" exists, as a real edit leaves it (missing files drop off
    // Changed files)
    const edited = path.join(files.root(), 'src', 'login-form.js');
    if (!fs.existsSync(edited)) {
      fs.mkdirSync(path.dirname(edited), { recursive: true });
      fs.writeFileSync(edited, '// test\n');
    }
    if (edit)
      context.hook(paneId, {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: edited },
      });
    const done = { ...t, endedAt: Date.now() - agoMs, endedBy: 'stop', result };
    lifecycle.onTurn(done);
    context.onTurn(done);
    win.webContents.send('agent:turn', done);
    return true;
  },
});
