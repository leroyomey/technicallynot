/*
 * Technically Not · 80-plan-limits.js — Desktop app only: plan limits (% of each plan usage window
 * used + reset time) for every signed-in Claude Code and Codex account, shown as fuel gauges on
 * each account card in Settings › Accounts (15 reads get() and paints them with 98; it re-renders
 * on the `tnai:plan-limits` event) and on the Overview's AI accounts card (98). No composer chip
 * (removed); a top bar chip after the System chip (81) follows the agent the user last clicked
 * into and shows its shortest window; the longer one is a row of the System chip's popover
 * (paintChip below). Claude Code: window.tnaiNative.usage.limits()
 * (desktop/plan-limits.js asks Anthropic per account folder, cached 60 s in main). Codex: live from
 * each panel's token_count rate_limits (agent-turns `limits`, pushed on agent:turn) keyed by the
 * panel's account; before any reply this session, the newest session-file reading goes to the
 * default account only while Codex has no other account (extra accounts share its sessions folder,
 * so a file can't be tied to one). No polling: asked at start, on window focus, when a Claude Code
 * task ends, on Accounts › Refresh, and once when the earliest known reset time passes. Row look
 * (.tnai-usage-lim-row / .tnai-usage-track) comes from 59-usage-stats.js's stylesheet.
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.usage?.limits) return;

  let state = null,
    loading = null,
    lastAsk = 0,
    resetTimer = 0;

  // accountId -> { status, plan, at, windows } from a panel's latest token_count
  const codexLive = new Map();

  // Codex rate_limits (primary/secondary { used_percent, window_minutes, resets_at s }) → windows,
  // same shape as desktop/plan-limits.js.
  function codexWindows(rl, now = Date.now()) {
    return [rl?.primary, rl?.secondary]
      .filter(w => w && Number.isFinite(+w.used_percent))
      .map(w => {
        const resetsAt = (+w.resets_at || 0) * 1000,
          reset = resetsAt > 0 && resetsAt <= now;
        return {
          minutes: +w.window_minutes || 0,
          used: reset ? 0 : Math.max(0, Math.min(100, +w.used_percent)),
          resetsAt: reset ? 0 : resetsAt,
          resetSinceReading: reset,
        };
      });
  }
  const title = s =>
    String(s || '')
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map(w => w[0].toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  const codexAccounts = () =>
    (window.TnaiAccounts?.list?.() || []).find(c => c.agentId === 'Codex')?.accounts || [];

  // The reading for one account: { status, plan, at, windows, live } or null (not a CLI with plan
  // limits).
  function get(agentId, accountId = '') {
    if (agentId === 'Claude Code')
      return state?.accounts?.find(a => a.accountId === (accountId || '')) || null;
    if (agentId !== 'Codex') return null;
    const live = codexLive.get(accountId || '');
    if (live) return live;
    if (!accountId && codexAccounts().length <= 1 && state?.codexFile) return state.codexFile;
    return state ? { status: 'noreading' } : null;
  }

  function changed() {
    window.dispatchEvent(new CustomEvent('tnai:plan-limits'));

    // Ask again once when the earliest known window resets (its bar is stale from then on).
    clearTimeout(resetTimer);
    const next = [...(state?.accounts || []), ...codexLive.values()]
      .flatMap(r => r?.windows || [])
      .map(w => w.resetsAt)
      .filter(t => t > Date.now())
      .sort((a, b) => a - b)[0];
    if (next)
      resetTimer = setTimeout(
        () => {
          for (const [id, r] of codexLive)
            codexLive.set(id, {
              ...r,
              windows: r.windows.map(w =>
                w.resetsAt && w.resetsAt <= Date.now()
                  ? { ...w, used: 0, resetsAt: 0, resetSinceReading: true }
                  : w
              ),
            });
          load(true);
        },
        Math.min(next - Date.now() + 5000, 2 ** 31 - 1)
      );
  }

  function load(force) {
    if (loading) return loading;
    if (!force && Date.now() - lastAsk < 20000) return Promise.resolve(state);
    lastAsk = Date.now();
    loading = Promise.resolve(native.usage.limits(!!force))
      .then(r => {
        if (r && Array.isArray(r.accounts)) state = r;
      })
      .catch(() => {})
      .finally(() => {
        loading = null;
        changed();
      });
    return loading;
  }

  native.agentTurns?.on?.(t => {
    if (!t?.paneId) return;
    if (t.agent === 'Codex' && t.limits?.primary) {
      const s = window.TnaiAgents?.sessions?.().find(x => x.paneId === t.paneId);
      const windows = codexWindows(t.limits);
      if (s && windows.length) {
        codexLive.set(s.accountId || '', {
          status: 'ok',
          plan: title(t.limits.plan_type),
          at: Date.now(),
          windows,
        });
        changed();
      }
    }
    if (t.agent === 'Claude Code' && t.endedAt) load();
  });
  window.addEventListener('focus', () => load());
  document.addEventListener('click', event => {
    if (event.target.closest('#tnaiAccountsMount button[data-acct=refresh]')) load(true);
  });

  // ---------- top bar chip, after 81's System chip: the plan usage of the account behind the agent
  // the user last clicked into (a terminal panel, or the agent picked in the composer), so it
  // switches with the agent. The chip shows the shortest window (Claude's 5 hours), because that
  // one decides when work stops; a longer window (the week) is a row of the System chip's popover
  // (user 2026-10-24, tab 4 of app-polish.html). Both go for an agent with no plan reading (a
  // PowerShell panel, a CLI without plan limits).
  let chipPane = '';
  const level = pct => (pct >= 95 ? 'full' : pct >= 80 ? 'high' : 'ok');
  const span = m =>
    m >= 10080
      ? 'wk'
      : m >= 1440
        ? Math.round(m / 1440) + 'd'
        : m >= 60
          ? Math.round(m / 60) + 'h'
          : (m || '?') + 'm';
  const when = t =>
    t > Date.now()
      ? ', resets ' +
        new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
      : '';

  function paintChip() {
    const system = window.TnaiSystemChip;
    if (!system) return;
    let chip = document.querySelector('.top-right > .pg-chip[data-m="plan"]');
    const s = window.TnaiAgents?.sessions?.().find(
      x => x.paneId === (chipPane || window.TnaiLiveTasks?.target?.())
    );
    const r = s ? get(s.agent, s.accountId) : null,
      windows = (r?.windows || []).slice(0, 2).sort((a, b) => a.minutes - b.minutes);
    if (!windows.length) {
      chip?.remove();
      system.meter('plan-week', null);
      return;
    }
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'pg-chip';
      chip.dataset.m = 'plan';
      chip.innerHTML = '<span class="k"></span><span class="v"></span>';
      system.button.after(chip);
    }
    const name = s.agent === 'Claude Code' ? 'Claude' : s.agent;
    const [first, longer] = windows;
    chip.querySelector('.k').textContent = name;
    chip.querySelector('.v').innerHTML =
      Math.round(first.used) + '% <small>' + span(first.minutes) + '</small>';
    chip.dataset.level = level(first.used);
    if (longer)
      system.meter('plan-week', {
        label: name + ' ' + (longer.minutes >= 10080 ? 'week' : span(longer.minutes)),
        pct: longer.used,
        value: Math.round(longer.used) + '%',
        title:
          span(longer.minutes) +
          ' window: ' +
          Math.round(longer.used) +
          '% used' +
          when(longer.resetsAt),
      });
    else system.meter('plan-week', null);
    chip.title =
      s.agent +
      (s.accountId ? ' · account ' + s.accountId : ' · default account') +
      (r.plan ? ' · ' + r.plan : '') +
      ' (the agent you last clicked: ' +
      s.name +
      ')\n' +
      windows
        .map(w => span(w.minutes) + ' window: ' + Math.round(w.used) + '% used' + when(w.resetsAt))
        .join('\n');
  }
  const follow = paneId => {
    if (paneId && paneId !== chipPane) {
      chipPane = paneId;
      paintChip();
    }
  };
  document.addEventListener(
    'pointerdown',
    event => follow(event.target.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId),
    true
  );
  document.addEventListener('focusin', event =>
    follow(event.target.closest?.('.terminal-pane[data-pane-id]')?.dataset.paneId)
  );
  window.addEventListener('tnai:target-changed', event => {
    if (event.detail?.paneId) follow(event.detail.paneId);
    else paintChip();
  });
  window.addEventListener('tnai:plan-limits', paintChip);

  // The System chip (81) is made after this file runs; a reading that came before it is painted
  // once every script has run.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paintChip);
  window.addEventListener('tnai:terminal-pane-closed', event => {
    if (event.detail?.paneId === chipPane) {
      chipPane = '';
      paintChip();
    }
  });

  window.TnaiPlanLimits = {
    get,
    refresh: () => load(true),
    state: () => state,
    chipPane: () => chipPane,
  };
  load(true);
})();
