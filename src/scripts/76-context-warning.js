/*
 * Technically Not · 76-context-warning.js — Desktop app only: warns when an agent's conversation
 * context grows large, because every new message re-sends the whole context, so long conversations
 * cost more tokens per prompt. A small chip ("Context 420k · 42%") appears in the terminal panel
 * header (before its tools) and on the agent's Overview card (after its turn meter), amber from
 * WARN and red from HIGH; its tooltip says why and what to do.
 * Clicking the chip in a terminal panel runs the panel's own ↻ Compact button (41;
 * same rules: Claude Code, Codex and OpenCode only). Crossing into HIGH shows one toast per panel;
 * it re-arms once the context drops below WARN (after /compact or /clear). Size is real:
 * turn.context.tokens pushed by desktop/agent-turns.js via 42 (TnaiTurns); window = the turn's
 * reported window, else 54's TnaiContextUpkeep.limits().window. Known window: WARN 50% / HIGH 80%
 * of it. Unknown window: the same percentages of REF_WINDOW (375k, so 80% = 300k, 11's fixed
 * budget). Settings › Agents › Agent context (54's group): "Show context size warnings" + both
 * percentages; stored per viewer, only when changed. Unknown size (other CLIs, no usage yet) = no
 * chip, never guessed. Painted on pushed events only (tnai:turn, session changes).
 */
(() => {
  const agents = window.TnaiAgents;
  if (!window.tnaiNative?.agentTurns || !agents) return;

  const STORE = 'tnai.context-warning.v1',
    DEFAULTS = { on: true, warn: 50, high: 80 },
    REF_WINDOW = 375000;
  let prefs = { ...DEFAULTS };
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (v && typeof v === 'object') prefs = { ...DEFAULTS, ...v };
  } catch {}
  const pctOk = (v, d) => {
    const n = Math.round(+v);
    return n >= 10 && n <= 100 ? n : d;
  };
  const limits = () => {
    const high = pctOk(prefs.high, DEFAULTS.high);
    return {
      on: prefs.on !== false,
      high: high / 100,
      warn: Math.min(pctOk(prefs.warn, DEFAULTS.warn), high) / 100,
    };
  };

  function save() {
    try {
      const own = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => v !== DEFAULTS[k]));
      Object.keys(own).length
        ? localStorage.setItem(STORE, JSON.stringify(own))
        : localStorage.removeItem(STORE);
    } catch {}
  }
  const style = document.createElement('style');
  style.textContent = `
.tnai-ctx{flex:none;display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border:1px solid var(--st-waiting-border);border-radius:9px;background:var(--st-waiting-bg);color:var(--st-waiting-fg);font:600 9px/1.4 var(--pg-sans);font-variant-numeric:tabular-nums;white-space:nowrap;cursor:default}
.tnai-ctx[hidden]{display:none!important}
.tnai-ctx i{width:5px;height:5px;border-radius:50%;background:var(--st-waiting-dot)}
.tnai-ctx[data-level=high]{border-color:var(--st-error-border);background:var(--st-error-bg);color:var(--st-error-fg)}
.tnai-ctx[data-level=high] i{background:var(--st-error-dot)}
button.tnai-ctx{cursor:pointer}
.tnai-card .c-ctx{justify-self:start;margin-top:3px}
@container (max-width:300px){.terminal-pane-head .tnai-ctx .x-label{display:none}}
`;
  document.head.append(style);

  const fmt = n => window.TnaiTurns?.format?.tokens?.(n) || Math.round(n / 1000) + 'k';
  const NUM = new Intl.NumberFormat();
  const sessionOf = paneId => agents.sessions().find(s => s.paneId === paneId);

  function level(paneId) {
    const L = limits();
    if (!L.on) return null;

    // Cheap test first: sessionOf builds every session, and this runs per chip on every paint (most
    // panes carry no context count).
    const c = window.TnaiTurns?.get?.(paneId)?.context,
      tokens = c?.tokens || 0;
    if (!(tokens > 0)) return null;
    const s = sessionOf(paneId);
    if (!s || s.agent === 'Terminal' || !s.running) return null;
    const win = c.window || window.TnaiContextUpkeep?.limits?.(paneId)?.window || 0;
    const pct = win > 0 ? Math.min(100, Math.round((tokens / win) * 100)) : 0;
    const ref = win > 0 ? win : REF_WINDOW,
      lv = tokens >= ref * L.high ? 'high' : tokens >= ref * L.warn ? 'warn' : '';
    return { s, tokens, win, pct, lv };
  }
  const canCompact = paneId => {
    const b = document.querySelector(
      '.terminal-pane[data-pane-id="' +
        CSS.escape(paneId) +
        '"] .terminal-pane-tools button[data-compact]'
    );
    return b && !b.disabled ? b : null;
  };

  function tip(r, clickable) {
    return (
      r.s.name +
      ' carries ' +
      NUM.format(r.tokens) +
      ' tokens of conversation context' +
      (r.pct ? ' (' + r.pct + '% of its ' + fmt(r.win) + ' window)' : '') +
      '.\n' +
      'Every new message re-sends this context, so each prompt uses more tokens the longer the conversation goes' +
      (r.lv === 'high' ? ', and the agent may auto-compact or lose earlier details soon.' : '.') +
      '\n' +
      (clickable
        ? 'Click to run /compact (summarizes the conversation and frees context).'
        : 'Compact it (↻ in its terminal panel), or start a fresh agent for unrelated work.')
    );
  }

  function draw(el, paneId, clickable, short) {
    const r = level(paneId);
    if (!r?.lv) {
      if (!el.hidden) el.hidden = true;
      return '';
    }
    const text = short
        ? r.pct
          ? r.pct + '%'
          : fmt(r.tokens)
        : fmt(r.tokens) + (r.pct ? ' · ' + r.pct + '%' : ''),
      t = tip(r, clickable);
    if (el.hidden) el.hidden = false;
    if (el.dataset.level !== r.lv) el.dataset.level = r.lv;
    if (el.dataset.text !== text) {
      el.dataset.text = text;
      el.innerHTML = '<i></i><span class="x-label">Context </span><span></span>';
      el.lastChild.textContent = text;
    }
    if (el.title !== t) {
      el.title = t;
      el.setAttribute('aria-label', t);
    }
    return r.lv;
  }

  // paneIds that got the HIGH toast; cleared when their context drops below WARN
  const warned = new Set();

  function notify(paneId) {
    const r = level(paneId);
    if (!r?.lv) {
      warned.delete(paneId);
      return;
    }
    if (r.lv !== 'high' || warned.has(paneId)) return;
    warned.add(paneId);
    window.toast?.(
      r.s.name +
        '’s context is large (' +
        fmt(r.tokens) +
        (r.pct ? ', ' + r.pct + '% full' : '') +
        '): every message now costs more tokens. Compact it or start a fresh agent for new work.'
    );
  }

  function paint() {
    document.querySelectorAll('.terminal-pane[data-pane-id]>.terminal-pane-head').forEach(head => {
      const paneId = head.parentElement.dataset.paneId,
        tools = head.querySelector(':scope>.terminal-pane-tools');
      if (!tools) return;
      let el = head.querySelector(':scope>.tnai-ctx');
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'tnai-ctx';
        el.hidden = true;
        tools.before(el);
      }
      el.dataset.pane = paneId;
      draw(el, paneId, !!canCompact(paneId));
    });
    document.querySelectorAll('.tnai-card .c-turn[data-pane]').forEach(turn => {
      let el = turn.parentElement.querySelector(':scope>.c-ctx');
      if (!el) {
        el = document.createElement('span');
        el.className = 'tnai-ctx c-ctx';
        el.hidden = true;
        turn.after(el);
      }
      draw(el, turn.dataset.pane, false);
    });
    agents.sessions().forEach(s => notify(s.paneId));
  }

  // Settings › Agents › Agent context (54 builds the group; these rows join its card).
  const card = document.querySelector('.tnai-upkeep-set .set-card');
  if (card) {
    const num = k =>
      `<span class="set-ctl"><input type="number" class="set-input set-num" min="10" max="100" step="5" data-cw="${k}"><em>% full</em></span>`;
    const box = document.createElement('div');
    box.className = 'tnai-ctx-set';
    box.innerHTML = `<label class="set-row"><span class="set-text"><b>Show context size warnings</b><small title="A chip on the agent's terminal panel, Overview card and Agents page row. Every new message re-sends the whole conversation, so a large context costs more tokens per prompt. When the CLI does not report its window, 375k tokens is used (80% = 300k).">Large conversations cost more tokens per message.</small></span><input type="checkbox" class="set-switch" data-cw="on"></label>
<div class="set-sub cw-nums">
<label class="set-row"><span class="set-text"><b>Amber at</b><small>Of the agent's context window.</small></span>${num('warn')}</label>
<label class="set-row"><span class="set-text"><b>Red at</b><small>Also shows one notice per thread.</small></span>${num('high')}</label>
</div>`;
    const sync = () => {
      const L = limits();
      box.querySelector('[data-cw=on]').checked = L.on;
      box.querySelector('[data-cw=warn]').value = Math.round(L.warn * 100);
      box.querySelector('[data-cw=high]').value = Math.round(L.high * 100);
      box.querySelector('.cw-nums').classList.toggle('off', !L.on);
    };
    box.addEventListener('change', e => {
      const k = e.target.dataset.cw;
      if (!k) return;
      if (k === 'on') prefs.on = e.target.checked;
      else prefs[k] = pctOk(e.target.value, DEFAULTS[k]);
      if (+prefs.warn > +prefs.high) prefs.warn = prefs.high;
      save();
      sync();
      schedule();
    });
    sync();
    card.append(box);
  }
  let queued = false;
  const schedule = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        paint();
      });
    }
  };

  document.addEventListener(
    'click',
    e => {
      const chip = e.target.closest?.('.terminal-pane-head>.tnai-ctx');
      if (!chip) return;
      e.preventDefault();
      e.stopPropagation();
      canCompact(chip.dataset.pane)?.click(); // 41 sends /compact and toasts
    },
    true
  );
  window.addEventListener('tnai:turn', schedule);
  window.addEventListener('tnai:terminal-pane-renamed', schedule);
  agents.onChange(schedule);
  schedule();
  window.TnaiContextWarning = {
    level,
    paint: schedule,
    prefs: () => ({ ...prefs }),
    set(patch) {
      Object.assign(prefs, patch);
      save();
      schedule();
    },
  };
})();
