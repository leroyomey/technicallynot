/*
 * Technically Not tools · desktop-check/tests/context-upkeep.main.js — Main-process side of
 * context-upkeep.js: feeds a finished turn for a given (PowerShell) pane through the real
 * agent-lifecycle.js + agent-context.js as main.js does, and pushes `agent:turn` with a `context`
 * size like agent-turns.js does. `entry: false` skips the Project Context entry (stale context);
 * `queued` adds prompts waiting in the CLI. `compacted` re-pushes the last turn with a
 * post-/compact size. No agent CLI is launched and no prompt is sent.
 */
'use strict';
const lifecycle = require('../../../desktop/agent-lifecycle');
const context = require('../../../desktop/agent-context');
const files = require('../../../desktop/fs-service');

let n = 0;
const last = new Map(); // paneId -> the last finished turn pushed
module.exports = win => ({
  finish(paneId, name, result, tokens, opts) {
    const {
      entry = true,
      queued = [],
      agent = 'Claude Code',
      window: ctxWindow = 0,
      calls = 0,
      fresh = false,
    } = opts || {}; // an omitted argument arrives as null over TNAI_MAIN
    lifecycle.started({
      paneId,
      agent,
      name,
      root: files.root(),
      cwd: files.root(),
      sessionId: 'test-upkeep-' + paneId,
    });

    // a distinct turn each call; fresh = it started just now (the reply to a prompt just sent)
    const startedAt = Date.now() - (fresh ? 0 : 30000) - ++n * (fresh ? 0 : 1);
    const t = {
      paneId,
      agent,
      source: 'test',
      startedAt,
      endedAt: 0,
      endedBy: '',
      tokens: null,
      task: '[TN.ai] upkeep test ' + n,
      result: '',
      context: null,
      queued: [],
    };
    lifecycle.onTurn(t);
    if (entry) context.onTurn(t);
    const done = {
      ...t,
      endedAt: Date.now(),
      endedBy: 'stop',
      result,
      context:
        tokens == null
          ? null
          : {
              tokens,
              at: Date.now(),
              ...(ctxWindow ? { window: ctxWindow } : {}),
              ...(calls ? { calls } : {}),
            },
      queued: queued.map(text => ({ text, at: Date.now() })),
    };
    lifecycle.onTurn(done);
    if (entry) context.onTurn(done);
    win.webContents.send('agent:turn', done);
    last.set(paneId, done);
    return true;
  },
  // A /compact finished on that same turn: agent-turns.js re-pushes it with the compact_boundary's
  // post-compact size and the call count reset.
  compacted(paneId, tokens) {
    const t = last.get(paneId);
    if (!t) return false;
    win.webContents.send('agent:turn', { ...t, context: { tokens, calls: 0, at: Date.now() } });
    return true;
  },
});
