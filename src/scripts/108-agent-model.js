/*
 * Technically Not · 108-agent-model.js — which model each agent runs on, as one readable name for
 * every view, so that the user knows which model each agent uses.
 * The model is the one the agent's latest reply actually ran on (desktop/agent-turns.js
 * reads it from the CLI's own transcript → 42 `TnaiTurns`), else the one picked for that panel (46
 * `TnaiLaunchPrefs.pane`); the effort the same way. Never the CLI-wide default: an agent whose
 * model is not known shows nothing. The name comes from the CLI's own model list
 * (`tnaiNative.agents.models`, as in 46: "claude-opus-5-5" → "Opus 5.5"); a Claude id the list does
 * not hold yet is spelled out from the id itself. No look of its own: each view puts the text in
 * the line that already names the AI tool (94 Agent Tree row, 11 Grid card chip, 25 Agents page
 * head, 10 terminal panel status tooltip). `window.TnaiAgentModel`: `of(session)` → { id, name,
 * effort, ran } | null, `text(session)` ("Opus 5.5 · high" or ''), `tip(session)`, `name(agent, id,
 * models?)`. Fires `tnai:agent-model` when a CLI's list arrives and names may read better. Test:
 * browser `agent-model`.
 */
(() => {
  const native = window.tnaiNative;

  // Each CLI's model list, asked once and again after 10 min (the main process keeps it fresh; a
  // menu or a row never waits on it).
  const lists = {},
    loading = {},
    loadedAt = {};

  function listOf(agent) {
    if (
      native?.agents?.models &&
      !loading[agent] &&
      (!lists[agent] || Date.now() - loadedAt[agent] > 10 * 60e3)
    )
      loading[agent] = native.agents
        .models(agent)
        .then(
          r => r,
          () => null
        )
        .then(r => {
          const before = JSON.stringify(lists[agent] || null);
          loadedAt[agent] = Date.now();
          delete loading[agent];
          if (r?.models || !lists[agent]) lists[agent] = r?.models || [];
          if (JSON.stringify(lists[agent]) !== before)
            window.dispatchEvent(new CustomEvent('tnai:agent-model', { detail: { agent } }));
        });
    return lists[agent] || [];
  }

  // a dated id ("claude-haiku-4-5-20251001") is the same model as its undated one
  const DATE = /-\d{8}$/;

  // A Claude id spelled out when no list names it: "claude-opus-5-5" → "Opus 5.5",
  // "claude-opus-4-20250514" → "Opus 4".
  function spell(id) {
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
    return m ? m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] ? '.' + m[3] : '') : id;
  }

  function name(agent, id, models) {
    id = String(id || '').trim();
    if (!id) return '';
    const base = id.replace(/\[[^\]]*\]$/, ''),
      bare = base.replace(DATE, ''),
      rows = models || listOf(agent); // "[1m]" marks the 1M context window, not another model
    const hit =
      rows.find(m => m.id === id) ||
      rows.find(m => m.id === base) ||
      rows.find(m => String(m.id).replace(DATE, '') === bare);
    return String(hit?.label || '').trim() || spell(base);
  }

  function of(s) {
    if (!s?.paneId || !s.agent || s.agent === 'Terminal') return null;
    const turn = window.TnaiTurns?.get?.(s.paneId),
      pick = window.TnaiLaunchPrefs?.pane?.(s.paneId, s.agent);
    const id = turn?.model || pick?.model || '';
    if (!id) return null;
    return {
      id,
      name: name(s.agent, id),
      effort: turn?.effort || pick?.effort || '',
      ran: !!turn?.model,
    };
  }
  const text = s => {
    const m = of(s);
    return m ? [m.name, m.effort].filter(Boolean).join(' · ') : '';
  };

  function tip(s) {
    const m = of(s);
    if (!m) return '';
    return (
      'Model: ' +
      m.name +
      (m.name !== m.id ? ' (' + m.id + ')' : '') +
      (m.effort ? ' · effort ' + m.effort : '') +
      '. ' +
      (m.ran
        ? 'The model its latest reply ran on.'
        : 'Set for this agent; its next reply confirms it.')
    );
  }
  window.TnaiAgentModel = { of, text, tip, name };
})();
