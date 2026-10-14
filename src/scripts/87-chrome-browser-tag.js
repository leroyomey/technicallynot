/*
 * Technically Not · 87-chrome-browser-tag.js — Desktop only: a live "Browser" tag on the agent's
 * Overview card (11's chips row) and its terminal panel header (the look of 35's .wt-badge) while a
 * Claude Code agent or one of its sub-agents is really using Claude in Chrome. Source: its own
 * mcp__claude-in-chrome__* tool calls from the hook events (agent:event, desktop/agent-hooks.js),
 * whatever turned the browser on (Settings › Agents › Use Claude in Chrome, 84, or the CLI's own
 * setting). The tag goes when its turn ends (Stop), a new task starts, the process exits, or no
 * browser step came for IDLE (one expiry timer). Waiting: when the agent's latest event is a
 * browser step and nothing new came for WAIT, the tag says so with a pulsing dot and a rotating
 * "Technically not stuck · 14s" line (the panel counts the seconds; the card chip reads "Browser ·
 * thinking"), because Chrome itself shows nothing while Claude works out its next step. Finished:
 * when the lead's turn ends while it used the browser, main's Windows notification
 * (attention.notify, shown only while the window is unfocused, e.g. the user is watching Chrome);
 * skipped when the turn ended on a question (71 handles those). `window.TnaiChromeBrowser`
 * (`active(paneId)` → { tool, at, tip, label, waiting } | null).
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.agentEvents) return;
  const IDLE = 120000,
    WAIT = 6000,
    PREFIX = 'mcp__claude-in-chrome__';
  const LINES = ['Technically not stuck', 'Technically not frozen', 'Technically still thinking'];

  // paneId -> { tool, at } of its last browser step, + last/other: its latest event of any kind
  const using = new Map();
  let lastSeq = 0,
    timer = 0,
    tick = 0;

  // Same look as 35's worktree badge (.wt-badge); its own class, because 35 finds and rewrites
  // .wt-badge. The waiting dot reuses 05's working dot color and stPulse.
  const style = document.createElement('style');
  style.textContent =
    '.tnai-browser-tag{flex:none;max-width:180px;overflow:hidden;padding:2px 6px;border:1px solid #dfe6d5;border-radius:9px;background:#f3f6ee;color:#4f6b3a;font:8px var(--pg-sans);text-overflow:ellipsis;white-space:nowrap}' +
    '.tnai-browser-tag[data-wait]::before{content:"";display:inline-block;width:5px;height:5px;margin-right:4px;border-radius:50%;background:var(--st-working-dot,#6f8f55);vertical-align:1px;animation:stPulse 1.4s ease-in-out infinite}' +
    '@media (prefers-reduced-motion:reduce){.tnai-browser-tag[data-wait]::before{animation:none}}';
  document.head.append(style);

  const step = tool => tool.slice(PREFIX.length).replace(/_mcp$/, '').replace(/_/g, ' ');
  const waitSecs = u =>
    !u.other && Date.now() - u.last >= WAIT ? Math.floor((Date.now() - u.at) / 1000) : 0;
  const tip = u => {
    const last =
        'last browser step: ' + step(u.tool) + ' at ' + new Date(u.at).toLocaleTimeString(),
      s = waitSecs(u);
    return s
      ? 'No new browser step for ' +
          s +
          's: Claude is working out the next one (or that step is still running) · ' +
          last
      : 'Using Claude in Chrome (your Chrome, signed in as you) · ' + last;
  };
  const panelText = u => {
    const s = waitSecs(u);
    return s ? LINES[Math.floor(s / 8) % LINES.length] + ' · ' + s + 's' : 'Browser';
  };

  function changed() {
    // 11 repaints the cards (its chips ask active())
    window.dispatchEvent(new CustomEvent('tnai:live-activity'));
    paintPanels();
    arm();
  }

  function arm() {
    // one timer, for the next expiry only; plus the 1 s waiting tick while anything is tagged
    clearTimeout(timer);
    if (!using.size) {
      clearInterval(tick);
      tick = 0;
      return;
    }
    if (!tick) tick = setInterval(onTick, 1000);
    const next = Math.min(...[...using.values()].map(u => u.at)) + IDLE;
    timer = setTimeout(
      () => {
        const now = Date.now();
        let gone = false;
        for (const [id, u] of using)
          if (now - u.at >= IDLE) {
            using.delete(id);
            gone = true;
          }
        gone ? changed() : arm();
      },
      Math.max(0, next - Date.now()) + 50
    );
  }

  function onTick() {
    // the card chip repaints only when a waiting state flips; the panel tags count the seconds
    if (document.hidden) return;
    let flipped = false;
    for (const u of using.values()) {
      const w = !!waitSecs(u);
      if (w !== !!u.waiting) {
        u.waiting = w;
        flipped = true;
      }
    }
    flipped ? changed() : paintPanels();
  }

  function drop(paneId) {
    if (using.delete(paneId)) changed();
  }

  function onEvent(e, replay) {
    if (!e?.paneId || (e.seq && e.seq <= lastSeq)) return;
    if (e.seq) lastSeq = e.seq;
    const at = e.at || Date.now(),
      u = using.get(e.paneId);
    if (e.kind === 'tool' && String(e.tool || '').startsWith(PREFIX)) {
      using.set(e.paneId, { tool: e.tool, at, last: at, other: false, waiting: u?.waiting });
      if (!replay) u ? onTick() : changed();
    } else if ((e.kind === 'stop' || e.kind === 'prompt') && !e.agentId && u) {
      using.delete(e.paneId);
      if (replay) return;
      changed();
      if (e.kind === 'stop' && !e.question) finished(e.paneId);
    } else if (u) {
      u.last = at;
      u.other = true;
      if (!replay) onTick();
    } // any other step: the agent is busy with something else, not waiting on Chrome
  }

  function finished(paneId) {
    const name = agents?.sessions?.().find(s => s.paneId === paneId)?.name || 'Your agent';
    Promise.resolve()
      .then(() =>
        native.attention?.notify?.({
          paneId,
          title: name + ' finished in Chrome',
          body: 'Its browser task is done. Click to open its thread.',
        })
      )
      .catch(() => {});
  }
  native.agentEvents.on(e => onEvent(e));
  native.agentEvents
    .history?.()
    .then(list => {
      (list || []).sort((a, b) => a.seq - b.seq).forEach(e => onEvent(e, true));
      const now = Date.now(),
        live = new Set((agents?.sessions?.() || []).filter(s => s.running).map(s => s.paneId));
      for (const [id, u] of using) if (now - u.at >= IDLE || !live.has(id)) using.delete(id);
      if (using.size) changed();
    })
    .catch(() => {});

  // Terminal panel header: the tag after the title (and after a worktree badge, if any).
  function paintPanels() {
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const u = using.get(pane.dataset.paneId);
      let tag = pane.querySelector('.tnai-browser-tag');
      if (!u) {
        tag?.remove();
        return;
      }
      if (!tag) {
        tag = document.createElement('span');
        tag.className = 'tnai-browser-tag';
        (pane.querySelector('.wt-badge') || pane.querySelector('.terminal-pane-title'))?.after(tag);
      }
      const text = panelText(u),
        t = tip(u);
      if (tag.textContent !== text) tag.textContent = text;
      tag.toggleAttribute('data-wait', text !== 'Browser');
      if (tag.title !== t) tag.title = t;
    });
  }
  agents?.onChange?.(() => {
    const live = new Set(
      agents
        .sessions()
        .filter(s => s.running)
        .map(s => s.paneId)
    );
    let gone = false;
    for (const id of using.keys())
      if (!live.has(id)) {
        using.delete(id);
        gone = true;
      }
    gone ? changed() : paintPanels();
  });
  window.addEventListener('tnai:terminal-pane-closed', event => drop(event.detail?.paneId));

  window.TnaiChromeBrowser = {
    active: paneId => {
      const u = using.get(paneId);
      if (!u) return null;
      const waiting = !!waitSecs(u);
      return {
        tool: u.tool,
        at: u.at,
        tip: tip(u),
        waiting,
        label: waiting ? 'Browser · thinking' : 'Browser',
      };
    },
  };
})();
