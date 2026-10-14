// Technically Not · 40-agent-sounds.js — Desktop app only: the "Notification sounds" setting
// (checkbox in Settings › Agents › After an agent finishes, 51; 03 stores it;
// window.TnaiNotify.play) chimes when a Claude Code agent finishes its turn (its own Stop hook, via
// desktop/agent-hooks.js), when an OpenCode agent's turn ends by itself (desktop/agent-turns.js),
// or when any agent CLI session exits. Plain terminals never chime.
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.agentEvents || !agents || !window.TnaiNotify) return;

  const since = Date.now();
  let last = 0;
  const chime = () => {
    const now = Date.now();
    if (now - last < 1500) return;
    last = now;
    window.TnaiNotify.play();
  };

  // Only live events: the hook history replayed at start is older than this page.
  native.agentEvents.on(e => {
    if (e?.kind === 'stop' && (!e.at || e.at >= since)) chime();
  });

  // OpenCode has no Stop hook: its turn that ended by itself (desktop/agent-turns.js, from its own
  // record) is its finish. Once per turn; a turn is pushed again when its tokens settle.
  const chimed = new Map(); // paneId -> endedAt of the turn already chimed
  native.agentTurns?.on?.(t => {
    if (
      t?.agent !== 'OpenCode' ||
      !t.endedAt ||
      t.endedBy !== 'stop' ||
      t.endedAt < since ||
      chimed.get(t.paneId) === t.endedAt
    )
      return;
    chimed.set(t.paneId, t.endedAt);
    chime();
  });

  const running = new Map();
  window.addEventListener('tnai:terminal-pane-closed', e => {
    running.delete(e.detail?.paneId);
    chimed.delete(e.detail?.paneId);
  });
  agents.onChange(() => {
    for (const s of agents.sessions()) {
      const was = running.get(s.paneId);
      running.set(s.paneId, s.running);
      if (was && !s.running && s.agent && s.agent !== 'Terminal') chime();
    }
  });
})();
