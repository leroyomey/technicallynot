// Technically Not tools · desktop-check/tests/worktrees.main.js — Main-process side of the
// worktrees self-test: git-remote.main.js's helpers (isolated git config, exists, userData), plus
// `age` (backdates a worktree record, for the stale line), `read` (a file's text, or null), `size`
// (window content size, for the 1024 px review screenshot) and `delegate`: a PowerShell pane
// becomes a lead in the task graph and calls tnai_delegate with a `worktree` choice. The
// sub-agent's Claude Code start is swapped for PowerShell in pty-service (and its folder-trust
// check answered "not needed"), so the real pty:start picks the folder and no prompt ever reaches
// an agent.
'use strict';
const base = require('./git-remote.main.js');

module.exports = (win, profile) => {
  const api = base(win, profile);

  // Claude Code reads as installed and signed in, whatever this machine's real sign-in is: a
  // signed-out CLI would open a sign-in panel instead (10), and every Claude Code start here is
  // stubbed (composer) or swapped for PowerShell (delegate), so nothing real runs.
  const registry = require('../../../desktop/agent-registry'),
    detectAll = registry.detectAll;
  registry.detectAll = async () =>
    (await detectAll()).map(a =>
      a.id === 'Claude Code' ? { ...a, installed: true, loggedIn: true } : a
    );
  const graph = require('../../../desktop/agent-graph'),
    ptys = require('../../../desktop/pty-service'),
    trust = require('../../../desktop/trust-service');
  let patched = false;

  function patch() {
    if (patched) return;
    patched = true;
    const start = ptys.start,
      needs = trust.needs;
    ptys.start = opts =>
      graph.isNode(opts.paneId) && opts.agent === 'Claude Code'
        ? start({
            ...opts,
            agent: 'Terminal',
            appendPrompt: '',
            appendPromptFile: '',
            resumeId: '',
            sessionId: '',
            mcpConfig: '',
            settingsFile: '',
            pluginDirs: [],
            addDirs: [],
          })
        : start(opts);
    trust.needs = (agent, ...rest) =>
      agent === 'Claude Code' ? Promise.resolve({ needed: false }) : needs(agent, ...rest);
  }
  return {
    ...api,
    size: (w, h) => {
      win.setContentSize(w, h);
      return true;
    }, // the review screenshot at a fixed width

    // Ages a worktree record (made and panel-closed `ms` ago) for the stale line on the Changes
    // page.
    age(branch, ms) {
      const fs = require('fs'),
        file = require('path').join(
          require('../../../desktop/worktree-service').baseDir(),
          'worktrees.json'
        ),
        at = Date.now() - ms;
      fs.writeFileSync(
        file,
        JSON.stringify(
          JSON.parse(fs.readFileSync(file, 'utf8')).map(r =>
            r.branch === branch ? { ...r, createdAt: at, releasedAt: at } : r
          ),
          null,
          1
        )
      );
      return true;
    },
    read: file => {
      try {
        return require('fs').readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    },
    async delegate(leadPane, worktree, purpose, task) {
      patch();
      graph.setSettings({ maxDepth: 2, maxActivePerAgent: 6, maxActiveTotal: 11 });
      if (!graph.isNode(leadPane)) graph.rootStarted(leadPane, '', 'Lead', 'Claude Code');
      const res = await graph.call(leadPane, 'tnai_delegate', {
        purpose,
        task,
        why: 'Runs alongside the lead for the worktrees self-test.',
        ...(worktree ? { worktree } : {}),
      });
      const node = graph.state().nodes.find(n => n.purpose === purpose);
      return {
        text: res.content.map(c => c.text).join('\n'),
        error: !!res.isError,
        paneId: node?.paneId || '',
        lane: node?.lane || '',
        worktree: node?.worktree || '',
      };
    },
  };
};
