/*
 * Technically Not tools · desktop-check/tests/real-opencode.main.js — Main-process side of
 * real-opencode: what the app itself holds about the one real OpenCode panel. It records the
 * options main.js hands to pty-service for an OpenCode start (read-only: the call goes on
 * unchanged), and reads the app's own modules: the hook server's events (ready signal, tool steps),
 * the task from agent-turns.js, OpenCode's record through opencode-store.js, Project context's
 * entries. Nothing here writes to a panel or to OpenCode.
 */
'use strict';
const fs = require('fs'),
  path = require('path');
module.exports = () => {
  const ptys = require('../../../desktop/pty-service'),
    hooks = require('../../../desktop/agent-hooks'),
    turns = require('../../../desktop/agent-turns');
  const registry = require('../../../desktop/agent-registry'),
    store = require('../../../desktop/opencode-store'),
    context = require('../../../desktop/agent-context');
  const FREE = /^opencode\/(big-pickle|.*-free)$/;
  const launches = new Map(); // paneId -> what the start was given
  const refused = []; // starts this test did not allow
  const realStart = ptys.start;
  ptys.start = function (options) {
    // Nothing that costs may start in this test: only a PowerShell panel, or OpenCode on a free
    // model (a sub-agent its lead starts included).
    if (
      options?.mode !== 'login' &&
      options?.agent !== 'Terminal' &&
      !(options?.agent === 'OpenCode' && FREE.test(options.model || ''))
    ) {
      refused.push({ agent: options?.agent, model: options?.model || '' });
      return Promise.reject(
        new Error(
          'real-opencode: only OpenCode on a free model may start in this test (asked for ' +
            options?.agent +
            ' ' +
            (options?.model || 'on its default model') +
            ')'
        )
      );
    }
    try {
      if (options?.agent === 'OpenCode' && options.mode !== 'login') {
        let conf = {};
        try {
          conf = JSON.parse(
            registry.handArgs('OpenCode', options).env.OPENCODE_CONFIG_CONTENT || '{}'
          );
        } catch {}
        launches.set(options.paneId, {
          at: Date.now(),
          model: options.model || '',
          access: options.access || '',
          ownedByUser: !!options.ownedByUser,
          cwd: options.cwd || '',
          rulesFile: options.rulesFile || '',
          hasMcpConfig: !!options.mcpConfig,
          config: {
            instructions: conf.instructions || [],
            tnai: conf.mcp?.tnai
              ? {
                  type: conf.mcp.tnai.type,
                  enabled: conf.mcp.tnai.enabled,
                  timeout: conf.mcp.tnai.timeout,
                  url: String(conf.mcp.tnai.url || '').replace(/\/mcp\/.*/, '/mcp/<token>'),
                }
              : null,
            plugin: (conf.plugin || []).map(p => path.basename(String(p))),
          },
        });
      }
    } catch {}
    return realStart.apply(this, arguments);
  };
  return {
    // The free model this run may use: big-pickle when OpenCode lists it, else the first *-free id
    // of its own provider. '' = none, the test stops.
    async pick() {
      const cat = await registry.models('OpenCode').catch(() => null),
        ids = (cat?.models || []).map(m => m.id);
      const id = ids.find(i => i === 'opencode/big-pickle') || ids.find(i => FREE.test(i)) || '';
      return { id, listed: ids.length, free: ids.filter(i => FREE.test(i)) };
    },
    launch(paneId) {
      const l = launches.get(paneId);
      if (!l) return null;
      let head = [],
        lead = false;
      try {
        const text = fs.readFileSync(l.rulesFile, 'utf8');
        head = text
          .split('\n')
          .slice(0, 2)
          .map(s => s.slice(0, 160));
        lead = /tnai_delegate/.test(text);
      } catch {}
      return { ...l, rulesHead: head, rulesNameDelegate: lead };
    },
    // Everything the app holds for the panel right now.
    seen(paneId) {
      const events = hooks.history().filter(e => e.paneId === paneId),
        l = launches.get(paneId);
      const session = ptys.list().find(s => s.paneId === paneId) || null;
      let record = null;
      try {
        const r = session?.sessionId ? store.lastTurn(session.sessionId) : null;
        if (r)
          record = {
            task: String(r.task || '').slice(0, 120),
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            endedBy: r.endedBy,
            error: r.error,
            tokens: r.tokens,
            model: r.model,
            result: String(r.result || '').slice(0, 120),
          };
      } catch (e) {
        record = { readError: e.message };
      }
      const turn = turns.state().find(t => t.paneId === paneId) || null;
      return {
        ready: events
          .filter(e => e.kind === 'ready')
          .map(e => ({ source: e.source, ms: l ? e.at - l.at : 0 })),
        tools: events
          .filter(e => e.kind === 'tool')
          .map(e => ({ tool: e.tool, detail: String(e.detail || '').slice(0, 120), at: e.at })),
        kinds: events.reduce((m, e) => {
          m[e.kind] = (m[e.kind] || 0) + 1;
          return m;
        }, {}),
        sessionId: session?.sessionId || '',
        record,
        turn: turn && {
          startedAt: turn.startedAt,
          endedAt: turn.endedAt,
          endedBy: turn.endedBy,
          tokens: turn.tokens,
          model: turn.model,
          task: String(turn.task || '').slice(0, 120),
          result: String(turn.result || '').slice(0, 200),
          source: turn.source,
          context: turn.context,
        },
      };
    },
    file(paneId, name) {
      const l = launches.get(paneId);
      try {
        return {
          path: path.join(l.cwd, name),
          text: fs.readFileSync(path.join(l.cwd, name), 'utf8'),
        };
      } catch (e) {
        return { path: l ? path.join(l.cwd, name) : '', error: e.code || e.message };
      }
    },
    mode: () => process.env.TNAI_OC_ONLY || '',
    // OpenCode's own sub-agents of a panel as the app recorded them (agent-hooks.js events), times
    // in ms after `since`.
    subs(paneId, since = 0) {
      return hooks
        .history()
        .filter(
          e =>
            e.paneId === paneId &&
            e.at >= since &&
            (['spawn', 'sub-start', 'sub-stop', 'spawn-result', 'spawn-refused'].includes(e.kind) ||
              (e.kind === 'tool' && e.agentId))
        )
        .map(e => ({
          kind: e.kind,
          ms: e.at - since,
          sub: String(e.agentId || '').slice(-6),
          ...(e.kind === 'tool'
            ? { tool: e.tool, detail: String(e.detail || '').slice(0, 60) }
            : {}),
          ...(e.kind === 'spawn' ? { type: e.type } : {}),
          ...(e.kind === 'sub-stop' ? { text: String(e.text || '').slice(0, 80) } : {}),
          ...(e.kind === 'spawn-result' ? { status: e.result?.status } : {}),
        }));
    },
    tools(paneId, since = 0) {
      return hooks
        .history()
        .filter(e => e.paneId === paneId && e.at >= since && e.kind === 'tool')
        .map(e => ({
          tool: e.tool,
          detail: String(e.detail || '').slice(0, 80),
          ms: e.at - since,
          sub: !!e.agentId,
        }));
    },
    // Technically Not's own sub-agents (agent-graph.js) and every start this test saw or refused.
    graph() {
      const s = require('../../../desktop/agent-graph').state();
      return (s?.nodes || []).map(n => ({
        name: n.name,
        agent: n.agent,
        status: n.status,
        paneId: n.paneId,
        parentPaneId: n.parentPaneId,
        root: n.root,
        purpose: String(n.purpose || '').slice(0, 40),
        report: String(n.report || '').slice(0, 160),
        createdAt: n.createdAt,
        doneAt: n.doneAt,
      }));
    },
    starts() {
      return {
        started: [...launches].map(([paneId, l]) => ({
          paneId,
          model: l.model,
          access: l.access,
          at: l.at,
        })),
        refused,
      };
    },
    // The panel's link to its own OpenCode server, as the app's state says (opencode-link.js
    // state(): no port, no password in it).
    link(paneId) {
      const s = require('../../../desktop/opencode-link').state(paneId);
      return (
        s && {
          connected: !!s.connected,
          hasSession: !!s.sessionId,
          status: s.status,
          permissions: s.permissions.length,
          questions: s.questions.length,
          children: s.children.length,
        }
      );
    },
    stop: paneId =>
      require('../../../desktop/opencode-link')
        .abort(String(paneId || ''))
        .then(
          r => r?.ok === true,
          () => false

          // OpenCode's own stop call (what nai intervene uses, agent-mesh.js); false = no link, no
          // session or refused
        ),
    // what prompt-submit.js did with the last prompt it put into the panel
    did: paneId => require('../../../desktop/prompt-submit').did(paneId),
    async entries() {
      try {
        const s = await context.state();
        return (s.entries || []).slice(0, 4).map(e => ({
          name: e.name,
          agent: e.agent,
          edited: e.edited || [],
          files: (e.files || []).slice(0, 6),
        }));
      } catch (e) {
        return [{ error: e.message }];
      }
    },
  };
};
