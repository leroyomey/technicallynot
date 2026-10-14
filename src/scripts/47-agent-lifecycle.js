// Technically Not · 47-agent-lifecycle.js — Desktop app only: window side of
// desktop/agent-lifecycle.js. Finds which agent's earlier result the composer prompt quotes
// (debounced while typing, and again on send) so 11's route() gives the task back to that agent:
// reused if its pane is open, revived if it was closed, otherwise the usual route with a fresh
// agent. The route hint says so; picking an agent yourself (Send to menu, 46, or a card), before or
// after pasting, overrides the match. Reopens a closed agent's conversation when main asks
// (lifecycle:revive: a new pane in the active terminal workspace with the CLI's resume, or a
// restart in its own pane) and closes an agent Technically Not revived once it finished that task
// (lifecycle:close). `window.TnaiLifecycle` (origin, check, revive, sent, state).
(() => {
  const native = window.tnaiNative;
  if (!native?.lifecycle || !window.TnaiAgents) return;
  const agents = window.TnaiAgents;
  const say = text => {
    try {
      toast(text);
    } catch {}
  };
  const paneEl = paneId =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');
  const expand = text => window.TnaiPastedText?.expand(text) ?? text;
  const MIN_TEXT = 40; // shorter prompts never quote a result

  // ---------- Provenance of the composer prompt ----------
  let current = null,
    checked = '',
    picked = '',
    seq = 0,
    timer = 0,
    lastState = { instances: [], tasks: [] };
  const announce = () =>
    window.dispatchEvent(new CustomEvent('tnai:provenance', { detail: current }));

  async function check(text) {
    text = String(text || '').trim();
    if (text === checked) return origin();
    const mine = ++seq;
    const hit =
      text.length < MIN_TEXT ? null : await native.lifecycle.origin(text).catch(() => null);
    if (mine !== seq) return origin();
    checked = text;
    current = hit && hit.state !== 'gone' ? hit : null;
    announce();
    return origin();
  }

  // The agent whose result the current prompt quotes, unless the user picked another agent as the
  // composer's target (before or after pasting): an explicit pick always wins over what the pasted
  // text suggests. 11 retargets silently after an Auto send; that is no pick.
  const picks = () => !!picked && window.TnaiLiveTasks?.target?.() === picked;
  const origin = () => (current && !(picks() && picked !== current.paneId) ? current : null);
  const prompt = document.getElementById('prompt');
  prompt?.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => check(expand(prompt.value)), 250);
  });

  // Choosing an agent yourself (the Agent dropdown under the prompt, 46, or an agent card)
  // overrides a quoted result, whether picked before or after the paste; Auto gives it back.
  window.addEventListener('tnai:target-changed', event => {
    const next = event.detail?.paneId || '';
    if (next === picked) return;
    picked = next;
    if (!current) return;
    announce();
    if (picked && picked !== current.paneId)
      say(
        'Your choice wins: this prompt quotes ' +
          current.name +
          '’s result, but it goes to the agent you picked.'
      );
  });

  // Technically Not routed this send itself (with or without an origin): the agent's prompt hook
  // adds no provenance hint on top.
  const sent = (paneId, from) =>
    native.lifecycle
      .note(paneId, {
        originId: from?.instanceId || '',
        originTaskId: from?.taskId || '',
        source: 'composer',
      })
      .catch(() => {});

  // The composer revives an origin through main (one path for the composer and `tnai send`);
  // resolves to its session.
  async function revive(from) {
    const r = await native.lifecycle
      .revive(from.instanceId)
      .catch(error => ({ error: error.message }));
    if (!r?.paneId) return { error: r?.error || 'It did not come back.' };
    return (
      agents.sessions().find(s => s.paneId === r.paneId && s.running) || {
        error: 'It stopped while starting.',
      }
    );
  }

  // ---------- Reopen a conversation (main's lifecycle:revive) ----------
  async function whenReady(paneId, agent, since) {
    if (agent === 'Claude Code' && window.TnaiTeam?.whenReady)
      return window.TnaiTeam.whenReady(paneId, since, 60000);

    // Other CLIs have no ready event: output since the start, then QUIET_MS of quiet
    // (agent-graph.js readyByScreen's rule). OpenCode 1.18 on Windows prints a little at once, is
    // silent ~1.9 s, then draws its screen, and drops a paste sent before that (measured
    // 2026-09-26): 1.5 s of quiet counted that silence as ready, so `tnai new opencode` pasted its
    // task into nothing. A TUI that keeps redrawing counts as ready after DRAWN_MS.
    const end = Date.now() + 30000,
      QUIET_MS = 2500,
      DRAWN_MS = 10000;

    // OpenCode asks Technically Not's MCP server for its tools once its screen is drawn
    // (agent-hooks.js emits `ready`): measured 2026-10-06 with the real 1.18.35 screen in a pty,
    // three starts, no prompt: tools/list at 3.9 s, 1.1 s after its last drawing, and text pasted
    // at that moment landed in its input each time, while the quiet rule below answered at 6.4 s.
    // When that event comes it ends the wait early; without it (no MCP link, another version) the
    // quiet rule decides as before.
    let listed = false;
    if (agent === 'OpenCode' && window.TnaiTeam?.whenReady)
      window.TnaiTeam.whenReady(paneId, since, 30000).then(ok => {
        listed = ok;
      });
    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, 400));
      const s = agents.sessions().find(x => x.paneId === paneId);
      if (!s || s.status === 'error' || s.status === 'exited') return false;
      if (listed && s.running) return true;

      // 10 sets lastOutputAt = startedAt when the process starts: only later output shows it drew
      // something.
      if (
        s.running &&
        s.lastOutputAt > s.startedAt &&
        (Date.now() - s.lastOutputAt > QUIET_MS || Date.now() - since > DRAWN_MS)
      )
        return true;
    }
    return false;
  }

  async function reopen(req) {
    const since = Date.now();
    let paneId = req.paneId;

    // A pane left over from the last Technically Not session that still shows this conversation:
    // resume there instead of opening a duplicate.
    if (!paneId && req.contextId)
      paneId =
        agents.sessions().find(s => !s.running && s.sessionId === req.contextId && paneEl(s.paneId))
          ?.paneId || '';
    if (paneId && paneEl(paneId))
      // its pane is still open: restart there with the same conversation
      await agents.start(paneId, { resume: true });
    else {
      const taken = agents
        .sessions()
        .some(s => (s.name || '').toLowerCase() === String(req.name || '').toLowerCase());
      let name =
        req.name && (!taken || req.chosen)
          ? req.name
          : // chosen: the user's name for a `tnai new` agent, always kept
            window.TnaiPaneNames?.pick?.() || req.name || req.agent;

      // req.remote: a start asked by a paired computer (desktop/agent-lifecycle.js spawnRemote).
      // It never opens a new workspace (a full one
      // means no panel), starts at "Ask first" whatever this project's level is, and its request id
      // goes to main with the start as the mark of that one panel. Nothing else about a request
      // changes.
      const record = window.TnaiNewTerminalPane?.({
        name,
        quiet: true,
        reuseEmpty: true,
        ...(req.remote ? { noOverflow: true } : null),
      }); // an empty pane in the workspace is filled first
      if (!record) return { error: window.TnaiPaneLimit.message };
      name = record.name || name;

      // 05 gives the pane its connection select; 07 moves it into its workspace grid
      await new Promise(resolve => setTimeout(resolve, 0));

      // `tnai new --model --effort` (desktop/model-pick.js checked them): the fresh pane starts on
      // that pick (46 once), like a model named in the composer (73).
      const pick = req.remote
        ? { access: 'ask' }
        : !req.contextId && (req.model || req.effort)
          ? { model: req.model || '', effort: req.effort || '' }
          : null;
      if (pick) window.TnaiLaunchPrefs?.once(req.agent, pick);
      let opened;
      try {
        opened = await agents.openIn(record.id, req.agent, {
          name,
          resumeId: req.contextId,
          accountId: req.accountId || '',
          customAgentId: req.customAgentId || '',
          ownedByUser: !!req.ownedByUser,
          ...(req.remote ? { remote: req.requestId } : null),
        });
      } finally {
        if (pick) window.TnaiLaunchPrefs?.once(req.agent, null);
      }
      if (!opened?.ok) return { error: opened?.error || req.agent + ' could not start.' };
      paneId = record.id;
      if (name !== req.name && req.name)
        say(req.name + ' is back as ' + name + ' (another agent has that name now).');
    }
    return (await whenReady(paneId, req.agent, since))
      ? { paneId }
      : {
          error: (req.name || req.agent) + ' started but is not ready. Check its thread.',
          openedPaneId: paneId,
        };
  }
  native.lifecycle.onRevive(async req => {
    let result;
    try {
      result = await reopen(req || {});
    } catch (error) {
      result = { error: error.message };
    }
    native.lifecycle.revived(req?.requestId, result);
  });

  // ---------- `tnai rename NAME`: an agent renames its own panel when the user asks (same path as
  // the user's rename, 21) ----------
  native.lifecycle.onRename?.(({ paneId, name } = {}) => {
    if (paneId && name) window.TnaiPaneNames?.rename(String(paneId), String(name));
  });

  // ---------- Close an agent Technically Not revived, once it finished that task (its conversation
  // stays revivable) ----------
  native.lifecycle.onClose(async ({ paneId, name, reason, by } = {}) => {
    const pane = paneId && paneEl(paneId);
    if (!pane) return;
    await agents.stop(paneId);
    setTimeout(() => {
      pane.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.click();
      if (reason === 'self') {
        say(
          (name || 'The agent') +
            ' closed itself as you asked. Its conversation and results are kept.'
        );
        return;
      }
      if (reason === 'user') {
        say(
          (by || 'An agent') +
            ' closed ' +
            (name || 'an agent') +
            ' as you asked. Its conversation and results are kept.'
        );
        return;
      }
      if (reason === 'lead') {
        say(
          (by || 'The lead agent') +
            ' closed ' +
            (name || 'an agent') +
            ': not needed for the current work. Its conversation and results are kept.'
        );
        return;
      }
      say(
        (name || 'An agent') +
          ' finished the task it was revived for and was closed. Its conversation is kept: a task that builds on its work brings it back.'
      );
    }, 400);
  });

  native.lifecycle.onState(s => {
    lastState = s || lastState;
  });
  native.lifecycle
    .state()
    .then(s => {
      lastState = s || lastState;
    })
    .catch(() => {});

  // A prompt long enough to quote a result that hasn't been checked yet (11 waits for the check
  // only then).
  const pending = text => {
    text = String(text || '').trim();
    return text.length >= MIN_TEXT && text !== checked;
  };
  window.TnaiLifecycle = { origin, check, pending, revive, sent, state: () => lastState };
})();
