// Technically Not · 41-pane-compact.js — Desktop app only: the ↻ button in a terminal pane header
// runs the agent CLI's own /compact (Claude Code, Codex and OpenCode have it), which summarizes the
// conversation so far and frees context. Grayed out, with the reason in its tooltip, for
// PowerShell, Cursor Agent (no /compact command), and stopped sessions. Replaces the browser
// prototype's pretend summary (05).
(() => {
  const agents = window.TnaiAgents,
    pty = window.tnaiNative?.pty;
  if (!agents || !pty) return;

  // OpenCode: /compact is in its docs' TUI command list; not yet typed into a real panel
  // (2026-10-06)
  const COMPACTS = new Set(['Claude Code', 'Codex', 'OpenCode']);
  const BUTTON =
    '.terminal-pane-tools button[title^="Compact"], .terminal-pane-tools button[data-compact]';

  function reason(s) {
    if (!s || !s.running) return 'Compact · start the session first';
    if (s.agent === 'Terminal')
      return 'Compact applies to agent sessions, not ' + window.tnaiShell();
    if (!COMPACTS.has(s.agent)) return 'Compact · ' + s.agent + ' has no /compact command';
    return '';
  }

  function paint() {
    const byPane = new Map(agents.sessions().map(s => [s.paneId, s]));
    document.querySelectorAll(BUTTON).forEach(b => {
      const why = reason(byPane.get(b.closest('.terminal-pane')?.dataset.paneId));

      // Written only when changed: this runs on every session change of every pane.
      const title =
        why || 'Compact: run /compact so the agent summarizes this conversation and frees context';
      if (b.dataset.compact !== '1') b.dataset.compact = '1';
      if (b.disabled !== !!why) b.disabled = !!why;
      if (b.title !== title) b.title = title;
      if (b.getAttribute('aria-label') !== title) b.setAttribute('aria-label', title);
    });
  }
  document.addEventListener(
    'click',
    e => {
      const b = e.target.closest?.(BUTTON);
      if (!b) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const paneId = b.closest('.terminal-pane')?.dataset.paneId,
        s = agents.sessions().find(x => x.paneId === paneId);
      if (reason(s)) return;
      pty.submit(paneId, '/compact', { paste: false }).catch(() => {});
      window.toast?.('Sent /compact to ' + s.name);
    },
    true
  );
  agents.onChange(paint);

  // A new pane has no session yet; the click handler ignores it until paint() runs on the session
  // change.
  paint();
})();
