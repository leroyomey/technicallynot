// Technically Not · 42-agent-turn-meter.js — Desktop app only: a quiet "Cooking 1m 48s · 12.4k
// tokens" meter for each agent's current task, on Overview cards (11), the Agents page detail and
// list rows (25, "Working 3m 12s" / "Took 34s"), and (time only, while a task runs) next to the
// status on Terminal page pane headers. Start/end and tokens are real, pushed from
// desktop/agent-turns.js (Claude Code hooks + session transcript, Codex rollout); a CLI without
// such a source shows no meter. While a task runs, an "N queued" pill counts prompts sent to it
// meanwhile (the CLI holds them; tooltip lists them). The clock ticks locally once a second.
// `window.TnaiTurns` (get, paint); each pushed turn also fires `tnai:turn` {paneId}.
(() => {
  const native = window.tnaiNative;
  if (!native?.agentTurns) return;

  const turns = new Map(); // paneId -> { startedAt, endedAt, endedBy, tokens, source, subAgents }
  const style = document.createElement('style');
  style.textContent = `
.tnai-turn{display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;color:#8a9084;font:10px/1.4 var(--pg-sans);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden}
.tnai-turn[hidden]{display:none!important}
.tnai-turn .t-dot{flex:none;width:5px;height:5px;border-radius:50%;background:#c9ccc3}
.tnai-turn[data-state=running] .t-dot{background:#82a95f} /* pulse: shared, 05-status-colors.css */
.tnai-turn[data-state=running] .t-verb{color:#5c7d43}
.tnai-turn[data-state=paused] .t-dot{background:#d2b45c}.tnai-turn[data-state=paused] .t-verb{color:#a08232}
.tnai-turn .t-time{color:#4f5549;font:inherit;font-weight:600}
.tnai-turn .t-verb{min-width:0;overflow:hidden;text-overflow:ellipsis}
.tnai-turn .t-tok{flex:none;color:#9a9f93} /* never clipped: "7.6k tokens" stays whole; the verb gives way first */
.tnai-turn .t-tok:before{content:"·";margin-right:5px;color:#c3c6bd}
.tnai-turn .t-q{flex:none;padding:0 6px;border-radius:8px;background:#eef3e8;color:#5c7d43;font-weight:600}
.tnai-turn .t-q[hidden]{display:none}
.tnai-card .c-turn{justify-self:start}
/* Narrow cards (container from 11): "Cooked for" goes (the dot keeps the state; all of it is the tooltip). */
@container tnai-card (max-width:240px){.tnai-turn .t-verb{display:none}}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .c-turn{font-size:9px}
/* Terminal pane header: "Working · 3m 12s" (the status words are 10's, the time is this meter). */
.terminal-pane-state>.t-pane{gap:0;font:inherit;color:inherit}
.terminal-pane-state>.t-pane .t-dot,.terminal-pane-state>.t-pane .t-verb{display:none}
.terminal-pane-state>.t-pane .t-time{font-weight:400;color:inherit}
.terminal-pane-state>.t-pane .t-time:before{content:"·";margin:0 4px;color:#c3c6bd}
.terminal-pane-state>.t-pane .t-q{margin-left:6px;font-size:9px}
`;
  document.head.append(style);

  const pad = n => String(n).padStart(2, '0');

  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + pad(s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + pad(Math.floor(s / 60) % 60) + 'm';
  }
  const short = n =>
    n < 1000
      ? String(n)
      : n < 999500
        ? (n / 1000).toFixed(n < 9950 ? 1 : 0).replace(/\.0$/, '') + 'k'
        : (n / 1e6).toFixed(n < 9.95e6 ? 1 : 0).replace(/\.0$/, '') + 'M';
  const NUM = new Intl.NumberFormat(),
    full = n => NUM.format(Number(n || 0));

  // Shown count: tokens the task added (input, cache writes, output). Re-reads of cached context
  // are in the tooltip only.
  const used = k => (k ? (k.input || 0) + (k.cacheWrite || 0) + (k.output || 0) : 0);
  const SOURCE = {
    'claude-transcript': ['Claude Code’s hooks', 'Claude Code’s session transcript'],
    'codex-rollout': ['Codex’s session file', 'Codex’s session file'],
    'opencode-db': ['OpenCode’s session record', 'OpenCode’s session record'],
  };
  const CLOCK = new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // one formatter: toLocaleTimeString builds a new one per call (slow in feeds repainted while
    // agents work)
  });
  const clock = at => CLOCK.format(at);

  function build(el) {
    el.replaceChildren();
    const make = (tag, cls) => {
      const n = document.createElement(tag);
      n.className = cls;
      el.append(n);
      return n;
    };
    make('i', 't-dot');
    make('span', 't-verb');
    make('b', 't-time');
    make('span', 't-tok');
    make('span', 't-q');
  }
  const set = (node, text) => {
    if (node && node.textContent !== text) node.textContent = text;
  };

  // Usage limit (15 detects it, 15 clearLimit ends it): the clock stops where it is and resumes
  // after the reset. A task the limit cut short and 72 continued runs as a new turn, which starts
  // from the time the old one had reached.
  const paused = new Map(); // paneId -> { at, startedAt } while its CLI is at its usage limit

  // paneId -> { startedAt, ms }: time not counted (a pause, >0) or carried over from the cut-off
  // turn (<0)
  const offset = new Map();

  // paneId -> { ms, from, at }: a resumed task's time, for the turn the resume starts
  const carry = new Map();
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    turns.delete(id);
    paused.delete(id);
    offset.delete(id);
    carry.delete(id);
  });
  const offMs = (paneId, t) => {
    const o = offset.get(paneId);
    return o && o.startedAt === t.startedAt ? o.ms : 0;
  };
  const active = (paneId, t, now = Date.now()) => {
    const p = paused.get(paneId),
      end = t.endedAt || (p && p.startedAt === t.startedAt ? p.at : now);
    return Math.max(0, end - t.startedAt - offMs(paneId, t));
  };
  const redraw = paneId =>
    meters().forEach(el => {
      if (el.dataset.pane === paneId) draw(el);
    });
  window.addEventListener('tnai:account-limit', e => {
    const paneId = e.detail?.paneId,
      t = turns.get(paneId);
    if (!t || t.endedAt || paused.has(paneId)) return;
    paused.set(paneId, { at: e.detail.at || Date.now(), startedAt: t.startedAt });
    redraw(paneId);
  });
  window.addEventListener('tnai:account-limit-cleared', e => {
    const paneId = e.detail?.paneId,
      p = paused.get(paneId);
    if (!p) return;
    paused.delete(paneId);
    const t = turns.get(paneId);
    if (t && t.startedAt === p.startedAt) {
      const ms = active(paneId, t, p.at); // time reached when the limit hit
      offset.set(paneId, { startedAt: t.startedAt, ms: offMs(paneId, t) + (Date.now() - p.at) });
      if (e.detail.resumed) carry.set(paneId, { ms, from: t.startedAt, at: Date.now() });
    }
    redraw(paneId);
  });

  // Paints one meter from the stored turn; `live` = the pane's process is running (a stopped pane
  // never shows Cooking).
  function draw(el) {
    const t = turns.get(el.dataset.pane),
      live = el.dataset.live === '1';
    if (!t || (el.dataset.only === 'running' && (t.endedAt || !live))) {
      if (!el.hidden) el.hidden = true;
      if ('state' in el.dataset) delete el.dataset.state;
      return;
    }
    if (!el.querySelector('.t-time')) build(el);
    const running = !t.endedAt && live,
      isPaused = running && paused.get(el.dataset.pane)?.startedAt === t.startedAt,
      took = active(el.dataset.pane, t);
    const state = isPaused
      ? 'paused'
      : running
        ? 'running'
        : t.endedBy === 'stop'
          ? 'done'
          : 'stopped';
    if (el.hidden) el.hidden = false;

    // no same-value writes: this runs every second per running meter
    if (el.dataset.state !== state) el.dataset.state = state;
    const mini = el.classList.contains('t-pane');
    set(
      el.querySelector('.t-verb'),
      mini
        ? ''
        : isPaused
          ? 'Paused · usage limit'
          : running
            ? 'Cooking'
            : state === 'done'
              ? 'Cooked for'
              : 'Stopped after'
    );
    set(el.querySelector('.t-time'), duration(took));
    const tok = el.querySelector('.t-tok');
    if (tok.hidden !== (mini || !t.tokens)) tok.hidden = mini || !t.tokens;
    const tokText = t.tokens && !mini ? short(used(t.tokens)) : '';
    if (tok.textContent !== (tokText && tokText + ' tokens')) {
      // "4k" + " tokens" as its own span, so a narrow card can shorten it
      tok.replaceChildren();
      if (tokText) {
        const unit = document.createElement('span');
        unit.className = 't-unit';
        unit.textContent = ' tokens';
        tok.append(tokText, unit);
      }
    }
    const [when, from] = SOURCE[t.source] || ['the CLI', 'the CLI'];
    const lines = [
      (isPaused
        ? 'Paused at its usage limit after '
        : running
          ? 'Working on this task for '
          : state === 'done'
            ? 'This task took '
            : 'This task stopped after ') +
        duration(took) +
        ' · started ' +
        clock(t.startedAt) +
        (t.endedAt ? ', ended ' + clock(t.endedAt) : '') +
        ' (from ' +
        when +
        ')',
    ];
    if (t.tokens)
      lines.push(
        'Tokens this task: ' +
          full(used(t.tokens)) +
          ' — input ' +
          full(t.tokens.input) +
          ' · cache writes ' +
          full(t.tokens.cacheWrite) +
          ' · output ' +
          full(t.tokens.output) +
          (t.tokens.cacheRead
            ? '\nPlus ' + full(t.tokens.cacheRead) + ' cached context tokens re-read'
            : '') +
          '\nFrom ' +
          from +
          (t.subAgents
            ? ', incl. ' + t.subAgents + ' finished sub-agent' + (t.subAgents === 1 ? '' : 's')
            : '')
      );
    else lines.push('No token usage recorded for this task yet');

    // Prompts sent while it works: the CLI holds them and runs them next (desktop/agent-turns.js).
    const queued = running ? t.queued || [] : [],
      q = el.querySelector('.t-q');
    if (q.hidden !== !queued.length) q.hidden = !queued.length;
    set(q, queued.length ? queued.length + ' queued' : ''); // no "0 queued" text when nothing waits
    if (queued.length)
      lines.push(
        '\n' +
          queued.length +
          ' prompt' +
          (queued.length === 1 ? '' : 's') +
          ' queued — the agent takes ' +
          (queued.length === 1 ? 'it' : 'them') +
          ' next:\n' +
          queued
            .map(
              (x, i) => i + 1 + '. ' + (x.text.length > 120 ? x.text.slice(0, 120) + '…' : x.text)
            )
            .join('\n')
      );
    const tip = lines.join('\n');
    if (el.title !== tip) el.title = tip;
  }

  const meters = () => document.querySelectorAll('.tnai-turn[data-pane]');

  function paint(el, session) {
    if (!el || !session) return;
    if (el.dataset.pane !== session.paneId) el.dataset.pane = session.paneId;
    const live = session.running ? '1' : '0';
    if (el.dataset.live !== live) el.dataset.live = live;
    draw(el);
  }

  function apply(t) {
    if (!t?.paneId) return;
    if (t.subLogSame) {
      t.subLog = turns.get(t.paneId)?.subLog || {};
      delete t.subLogSame;
    } // main left the unchanged sub-agent logs out (desktop/agent-turns.js push)
    if (t.cleared) turns.delete(t.paneId);
    else turns.set(t.paneId, t);

    // the turn a usage-limit resume started continues the cut-off task's clock
    const c = carry.get(t.paneId);
    if (c && !t.cleared && t.startedAt !== c.from) {
      carry.delete(t.paneId);
      if (t.startedAt >= c.at - 5000) offset.set(t.paneId, { startedAt: t.startedAt, ms: -c.ms });
    }
    meters().forEach(el => {
      if (el.dataset.pane === t.paneId) draw(el);
    });

    // other views of the same turn (25's queued list)
    window.dispatchEvent(new CustomEvent('tnai:turn', { detail: { paneId: t.paneId } }));
  }

  // Terminal page pane headers: one meter per pane, shown only while its task runs. Painted on
  // session changes (pushed by 10).
  function paintPanes() {
    // one lookup per pane header, not a search of every session
    const sessions = new Map((window.TnaiAgents?.sessions?.() || []).map(x => [x.paneId, x]));
    document
      .querySelectorAll('.terminal-pane[data-pane-id] .terminal-pane-state')
      .forEach(state => {
        const paneId = state.closest('.terminal-pane').dataset.paneId,
          s = sessions.get(paneId);
        let el = state.querySelector(':scope>.t-pane');
        if (!s) {
          if (el) el.hidden = true;
          return;
        }
        if (!el) {
          el = document.createElement('span');
          el.className = 'tnai-turn t-pane';
          el.dataset.only = 'running';
          el.hidden = true;
          state.append(el);
        }
        paint(el, s);
      });
  }

  // Once per frame: several session changes in one frame each read every session and every pane
  // header.
  let panesFrame = 0;
  const panesSoon = () => {
    if (!panesFrame)
      panesFrame = requestAnimationFrame(() => {
        panesFrame = 0;
        paintPanes();
      });
  };
  window.TnaiAgents?.onChange?.(panesSoon);
  window.addEventListener('tnai:terminal-pane-renamed', panesSoon);
  native.agentTurns.on(apply);
  native.agentTurns
    .state()
    .then(list => (list || []).forEach(apply))
    .catch(() => {});

  // The only timer: the visible clock of running tasks, once a second.
  // Only meters on the visible page tick (hidden pages' meters were redrawn too); all reads first,
  // then the writes, so it costs one layout. On screen or not is told by one IntersectionObserver:
  // offsetParent per running meter forced a layout on every tick (18 ms per 6 s on Overview,
  // measured 2026-10-04). A meter the observer has not answered for yet is asked the old way, once.
  const onScreen = new WeakMap();
  const io = new IntersectionObserver(list =>
    list.forEach(e => {
      onScreen.set(e.target, e.isIntersecting);
      if (e.isIntersecting && !document.hidden && e.target.dataset.state === 'running')
        draw(e.target);
    })
  );
  const shown = el => {
    const v = onScreen.get(el);
    if (v !== undefined) return v;
    io.observe(el);
    return !!el.offsetParent;
  };
  setInterval(() => {
    if (!document.hidden)
      [...document.querySelectorAll('.tnai-turn[data-state=running]')].filter(shown).forEach(draw);
  }, 1000); // a hidden window catches up on its next tick, a hidden page when it is shown

  window.TnaiTurns = {
    get: paneId => (turns.has(paneId) ? { ...turns.get(paneId) } : null),
    paused: paneId => paused.has(paneId),
    paint,
    // The task clock every view shows (ms; a usage-limit pause is not counted, a resumed task
    // carries its time), or null with no task.
    elapsed: paneId => {
      const t = turns.get(paneId);
      return t?.startedAt ? active(paneId, t) : null;
    },
    format: { duration, tokens: short },
  };
})();
