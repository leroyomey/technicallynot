/*
 * Technically Not · 102-handoff-history.js — Desktop app only: makes agent handoffs
 * (54-context-upkeep.js "Retire & hand off") visible and keeps their history. LIVE STATUS (pushed,
 * no polling): 54's retire() pushes `tnai:handoff` { phase: start | started | done | failed } at
 * each real step. While it lasts, the old agent's Agent Tree row (94 asks status(): word on the
 * status line, sub under it) says "Handing off → <new name>" and the new one "Taking over" (teal,
 * --pg-handoff) until its first finished turn (agent:turn, its one-line confirmation), then its
 * normal status. A failed handoff leaves the old agent working: its row shows "Handoff failed" in
 * the Problem color, the reason on hover, until its next turn starts or its panel closes. MARKER:
 * after the name of an agent that took over (94 asks markHtml()), a small ↪: hover "Took over from
 * <old> at <N>k tokens · <time>", click opens the history on that agent's chain. Agents that never
 * took over show nothing. HISTORY: one entry per attempt in the main process
 * (desktop/handoff-history.js, userData/handoff-history.json, last 200, pushed `handoffs:changed`);
 * id = the old agent's paneId + session start. Context sizes are real readings only (54's
 * turn.context; the new agent's first reported size), else "unknown": only Claude Code and Codex
 * report their context, so only they are handed off. The dialog (shared in-app modal look, taller,
 * scrolls; Esc / outside click close) opens from the marker, the Agent Tree ? menu ("Handoff
 * history") and the Ctrl+K palette (39). window.TnaiHandoffHistory (status, markHtml, open, close,
 * list).
 */
(() => {
  const native = window.tnaiNative;
  if (!native?.handoffs) return;

  const esc = text =>
    String(text ?? '').replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const k = n => (n >= 1000 ? Math.round(n / 1000) + 'k' : String(n));
  const when = at => {
    const d = new Date(at);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  };
  let list = []; // newest first, from main
  const live = new Map(); // paneId -> { kind: 'out' | 'in' | 'fail', text, tip }
  const attempts = new Map(); // old paneId -> { id, to? } of the handoff in progress
  const waiting = new Map(); // new paneId -> history id, until its first finished turn

  // A handoff started, ended or changed: said as an event, for any view that marks it. (The old
  // Overview drew the mark and is gone; no view of the thread layout draws one yet.)
  const repaint = () => window.dispatchEvent(new CustomEvent('tnai:handoff-changed'));

  function accountLabel(agent, accountId) {
    try {
      const l = window.TnaiAccounts?.label?.(agent, accountId || '');
      if (l) return l;
    } catch {}
    const a = window.TnaiAccounts?.list?.()
      ?.find?.(d => d.agentId === agent)
      ?.accounts?.find?.(x => x.id === (accountId || ''));
    return a ? (a.isDefault ? 'Default account' : a.label || '') : '';
  }

  // ---- the real retire() steps (54) ----
  window.addEventListener('tnai:handoff', ev => {
    const d = ev.detail || {},
      paneId = d.paneId;
    if (!paneId) return;
    if (d.phase === 'start') {
      const id = paneId + ':' + (d.sessionStartedAt || Date.now()),
        s = d.entry?.summary || {};
      attempts.set(paneId, { id, name: d.name || '' });
      live.set(paneId, {
        kind: 'out',
        text: 'Handing off…',
        word: 'Handing off',
        sub: 'starting…',
        tip: 'Starting a fresh ' + (d.agent || 'agent') + ' to take over',
      });
      native.handoffs
        .put({
          id,
          at: Date.now(),
          from: { paneId, name: d.name || '' },
          to: { paneId: '', name: '' },
          agent: d.agent || '',
          model: d.model || '',
          account: accountLabel(d.agent, d.accountId),
          reason: d.reason || { kind: 'manual' },
          before: d.tokens > 0 ? d.tokens : null,
          after: null,
          task: d.task || '',
          entryId: d.entryId || '',
          project: window.TnaiProjects?.active?.() || '',
          result: 'pending',
          error: '',
          summary: {
            did: s.did || [],
            next: [...(s.remains || []), ...(s.next || [])],
            files: (d.entry?.edited?.length ? d.entry.edited : d.entry?.files) || [],
          },
        })
        .catch(() => {});
    } else if (d.phase === 'started') {
      const a = attempts.get(paneId);
      if (!a) return;
      a.to = d.to;
      live.set(paneId, {
        kind: 'out',
        text: 'Handing off → ' + (d.to?.name || 'a fresh agent'),
        word: 'Handing off',
        sub: '→ ' + (d.to?.name || 'a fresh agent'),
        tip: 'Sending its summary to ' + (d.to?.name || 'the new agent'),
      });
      if (d.to?.paneId) {
        live.set(d.to.paneId, {
          kind: 'in',
          text: 'Taking over',
          word: 'Taking over',
          sub: a.name ? 'from ' + a.name : '',
          tip: 'Taking over from ' + (a.name || 'the old agent') + '; confirms with one line',
        });
        waiting.set(d.to.paneId, a.id);
      }
      native.handoffs.update(a.id, { to: d.to || {} }).catch(() => {});
    } else if (d.phase === 'done') {
      const a = attempts.get(paneId);
      attempts.delete(paneId);
      live.delete(paneId);
      if (a) native.handoffs.update(a.id, { to: d.to || a.to || {}, result: 'ok' }).catch(() => {});
    } else if (d.phase === 'failed') {
      const a = attempts.get(paneId);
      attempts.delete(paneId);
      if (a?.to?.paneId) {
        live.delete(a.to.paneId);
        waiting.delete(a.to.paneId);
      }
      live.set(paneId, {
        kind: 'fail',
        text: 'Handoff failed',
        word: 'Handoff',
        sub: 'failed',
        tip: 'Handoff failed: ' + (d.error || 'unknown reason') + ' It keeps working as before.',
      });
      if (a)
        native.handoffs.update(a.id, { result: 'failed', error: d.error || '' }).catch(() => {});
    }
    repaint();
  });

  // The new agent confirms with its first finished turn; its reported context size then is the
  // "after" reading. A failed handoff's note ends when the old agent starts a new turn.
  native.agentTurns?.on?.(t => {
    if (!t?.paneId) return;
    const id = waiting.get(t.paneId);
    if (id && t.endedAt) {
      waiting.delete(t.paneId);
      live.delete(t.paneId);
      native.handoffs
        .update(id, {
          after: t.context?.tokens > 0 ? t.context.tokens : null,
          confirmedAt: t.endedAt,
        })
        .catch(() => {});
      repaint();
    } else if (live.get(t.paneId)?.kind === 'fail' && !t.endedAt && !t.cleared) {
      live.delete(t.paneId);
      repaint();
    }
  });
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (!id) return;
    live.delete(id);
    waiting.delete(id);
    repaint();
  });

  // ---- data ----
  const apply = st => {
    list = Array.isArray(st?.handoffs) ? st.handoffs : [];
    repaint();
    if (!overlay.hidden) paint();
  };
  native.handoffs.onChange(apply);

  function tookOver(s) {
    // the newest successful handoff to this agent (same panel and name, since panel ids come back
    // after a restart)
    if (!s?.paneId) return null;
    return (
      list.find(
        e => e.result === 'ok' && e.to?.paneId === s.paneId && (!s.name || e.to.name === s.name)
      ) || null
    );
  }

  function markHtml(s) {
    const e = tookOver(s);
    if (!e) return '';
    const tip =
      'Took over from ' +
      (e.from?.name || 'an agent') +
      (e.before ? ' at ' + k(e.before) + ' tokens' : '') +
      ' · ' +
      when(e.at) +
      '. Click: its handoff history';
    return `<button type="button" class="tnai-ho-mark" data-ho-pane="${esc(s.paneId)}" title="${esc(tip)}" aria-label="${esc(tip)}">↪</button>`;
  }

  // Marker clicks open the history instead of selecting the row (captured before 94's row handler).
  document.addEventListener(
    'click',
    e => {
      const b = e.target.closest?.('.tnai-ho-mark');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      open(b.dataset.hoPane);
    },
    true
  );

  // ---- the dialog (shared modal look: 01-base .bw-confirm-overlay / .bw-file-modal) ----
  const overlay = document.createElement('div');
  overlay.className = 'bw-confirm-overlay tnai-hoh-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<section class="bw-file-modal tnai-hoh" role="dialog" aria-modal="true" aria-labelledby="tnaiHohTitle"><header><h2 id="tnaiHohTitle">Handoff history</h2><button type="button" class="bw-file-dialog-close" aria-label="Close handoff history">×</button></header><p class="tnai-hoh-top"></p><div class="tnai-hoh-list" tabindex="-1"></div></section>';
  document.body.append(overlay);
  const $ = sel => overlay.querySelector(sel);
  let focusChain = '',
    opener = null;
  const results = new Map(); // entryId -> text | '' (not found)

  const median = a => {
    const v = a.filter(n => n > 0).sort((x, y) => x - y);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : 0;
  };
  const reasonText = r =>
    r?.kind === 'context'
      ? 'context limit' + (r.n ? ' ' + k(r.n) : '')
      : r?.kind === 'age'
        ? 'age' + (r.n ? ' ' + r.n + ' h' : '')
        : r?.kind === 'requests'
          ? 'many requests' + (r.n ? ' (' + r.n + ')' : '')
          : r?.kind === 'limit'
            ? 'usage limit, continued with another agent'
            : 'manual Retire';
  const tokens = n => (n > 0 ? k(n) : 'unknown');

  function entryHtml(e) {
    const res =
      e.result === 'ok'
        ? '<span class="ok">took over ✓</span>'
        : e.result === 'failed'
          ? `<span class="fail" title="${esc(e.error)}">failed, old kept</span>`
          : '<span>in progress</span>';
    const sum = e.summary || {},
      part = (label, a) =>
        a?.length
          ? `<div><b>${label}</b><ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
          : '';
    const body = part('Done', sum.did) + part('Next steps', sum.next) + part('Files', sum.files);
    const r = results.get(e.entryId);
    return `<article class="tnai-hoh-e" data-id="${esc(e.id)}">
<div class="h"><b>${esc(e.from?.name || '?')} → ${esc(e.to?.name || '—')}</b>${res}<time datetime="${new Date(e.at).toISOString()}">${esc(when(e.at))}</time></div>
<div class="m">${esc([e.agent, e.model, e.account].filter(Boolean).join(' · ') || 'CLI unknown')}</div>
<div class="m">Reason: ${esc(reasonText(e.reason))} · Context ${esc(tokens(e.before))} → ${esc(tokens(e.after))}</div>
${e.task ? `<div class="t" title="${esc(e.task)}">Task: ${esc(e.task)}</div>` : ''}
${e.result === 'failed' && e.error ? `<div class="m err">${esc(e.error)}</div>` : ''}
<details><summary>Summary handed over</summary>${body || '<div class="m">No summary was saved.</div>'}</details>
${e.entryId ? `<button type="button" class="tnai-hoh-res" data-res="${esc(e.entryId)}" aria-expanded="${r !== undefined}">${r !== undefined ? 'Hide its results' : 'Open its results'}</button>${r !== undefined ? `<pre class="tnai-hoh-raw">${esc(r || 'Its saved results are not in the open project (result ' + e.entryId + ').')}</pre>` : ''}` : ''}
</article>`;
  }

  function paint() {
    const week = list.filter(e => e.result === 'ok' && e.at >= Date.now() - 7 * 864e5);
    const ok = list.filter(e => e.result === 'ok'),
      usual = median(ok.map(e => e.before)),
      start = median(ok.map(e => e.after));
    $('.tnai-hoh-top').textContent = list.length
      ? week.length +
        ' handoff' +
        (week.length === 1 ? '' : 's') +
        ' this week' +
        (usual ? ' · usually at ~' + k(usual) : '') +
        (start ? ', new agent starts at ~' + k(start) : '')
      : 'No handoffs yet. When an agent is retired and handed off (Settings › Agents › Agent context), it shows here.';
    const chains = new Map(); // chain id -> entries, newest first
    for (const e of list) {
      const c = e.chain || e.id;
      if (!chains.has(c)) chains.set(c, []);
      chains.get(c).push(e);
    }
    const shown =
      focusChain && chains.has(focusChain) ? [[focusChain, chains.get(focusChain)]] : [...chains];
    const names = es => {
      const seq = [...es].reverse();
      return [seq[0]?.from?.name, ...seq.filter(e => e.result === 'ok').map(e => e.to?.name)]
        .filter(Boolean)
        .join(' → ');
    };
    $('.tnai-hoh-list').innerHTML =
      (focusChain && chains.size > 1
        ? '<button type="button" class="tnai-hoh-all">Show all handoffs</button>'
        : '') +
      shown
        .map(
          ([id, es]) =>
            `<section class="tnai-hoh-chain" data-chain="${esc(id)}"><h3>${esc(names(es))}</h3>${es.map(entryHtml).join('')}</section>`
        )
        .join('');
  }

  function open(paneId) {
    const e = paneId
      ? list.find(x => x.to?.paneId === paneId && x.result === 'ok') ||
        list.find(x => x.from?.paneId === paneId)
      : null;
    focusChain = e ? e.chain || e.id : '';
    opener = document.activeElement;
    overlay.hidden = false;
    paint();
    $('.bw-file-dialog-close').focus();
    return true;
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    try {
      opener?.focus?.();
    } catch {}
  }
  overlay.addEventListener('click', async e => {
    if (e.target === overlay || e.target.closest('.bw-file-dialog-close')) {
      close();
      return;
    }
    if (e.target.closest('.tnai-hoh-all')) {
      focusChain = '';
      paint();
      return;
    }
    const b = e.target.closest('.tnai-hoh-res');
    if (!b) return;
    const id = b.dataset.res;
    if (results.has(id)) {
      results.delete(id);
      paint();
      return;
    }
    let text = '';
    try {
      text = (await native.handoffs.results(id))?.text || '';
    } catch {}
    results.set(id, text);
    paint();
  });
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && !overlay.hidden) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );

  // Opened from a thread's top row (120, at that agent's own chain) and from the command menu
  // (39, the whole list).

  native.handoffs
    .state()
    .then(apply)
    .catch(() => {});
  window.TnaiHandoffHistory = {
    status: paneId => (live.get(paneId) ? { ...live.get(paneId) } : null),
    markHtml,
    open,
    close,
    isOpen: () => !overlay.hidden,
    list: () => list.map(e => ({ ...e })),
  };
})();
