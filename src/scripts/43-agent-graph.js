// Technically Not · 43-agent-graph.js — Desktop app only: the window side of custom agents' task
// graph (desktop/agent-graph.js). Opens a sub-agent's pane when a custom agent delegates
// (graph:spawn: a new pane in the parent's terminal workspace, Claude Code started with
// `subagentOf`, no page or workspace switch), removes it when main closes it (graph:close), tells
// main when the user closes a graph pane (removed). Shows "↳ sub-agent of Nova · purpose" + status
// + Keep / Release on the pane header, Overview cards (11 calls paintCard) and the Agents page
// detail (25 calls paintDetail, which also lists a parent's delegated sub-agents), and the
// Delegation limits in Settings › Agents. State is pushed by main (graph:state); the only timer is
// the 1 s close countdown, running only while a finished sub-agent is counting down.
// window.TnaiGraph (state, node, paintCard, paintDetail, paintLine). In the thread layout the line
// is shown by 123: under the helpers' chips and under the top row of a helper's own thread.
(() => {
  const native = window.tnaiNative;
  if (!native?.graph || !window.TnaiAgents) return;
  const agentsApi = window.TnaiAgents;

  let state = { settings: {}, nodes: [] };
  const byPane = paneId => state.nodes.find(n => n.paneId && n.paneId === paneId) || null;
  const kids = id => state.nodes.filter(n => n.parentId === id);
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const say = text => {
    try {
      toast(text);
    } catch {}
  };

  const style = document.createElement('style');
  style.textContent = `
.tnai-graph-line{display:flex;align-items:center;gap:6px;min-width:0;color:#7c8276;font:10px/1.4 var(--pg-sans)}
.tnai-graph-line[hidden]{display:none!important}
.tnai-graph-line .g-text{flex:0 1000 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-graph-line .g-text b{color:#4f5a45;font-weight:600}
.tnai-graph-line .g-state{flex:none;display:inline-flex;align-items:center;gap:5px;color:#8a8f84;white-space:nowrap;font-variant-numeric:tabular-nums}
.tnai-graph-line .g-state i,.tnai-graph-item .g-dot{flex:none;width:6px;height:6px;border-radius:50%;background:#c9ccc3}
.tnai-graph-line[data-status=working] .g-state i,.tnai-graph-line[data-status=starting] .g-state i,.tnai-graph-item[data-status=working] .g-dot,.tnai-graph-item[data-status=starting] .g-dot{background:#82a95f}
.tnai-graph-line[data-status=done] .g-state i,.tnai-graph-item[data-status=done] .g-dot{background:#9bb382}
.tnai-graph-line[data-status=failed] .g-state i,.tnai-graph-line[data-status=stopped] .g-state i,.tnai-graph-item[data-status=failed] .g-dot,.tnai-graph-item[data-status=stopped] .g-dot{background:#bd7771}
.tnai-graph-line[data-kept] .g-state{color:#5c7d43}
.tnai-graph-keep{box-sizing:border-box;flex:none;height:24px;padding:0 8px;border:1px solid #d6e2c6;border-radius:6px;background:#f0f5e9;color:#46603a;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}
.tnai-graph-keep:hover{background:#e7efdc}
.tnai-graph-keep[data-on]{border-color:#e1e6da;background:#fff;color:#6e7467}.tnai-graph-keep[data-on]:hover{background:#f3f6ee}
/* Terminal pane header: one line after the title, shrinks first. */
.terminal-pane-head>.tnai-graph-line{flex:1 1 0;min-width:0;overflow:hidden;contain:inline-size} /* takes the free room only, never widens the pane */
/* A sub-agent pane's header gives that room to the line: its status dot stays, the context badge and status words go (the line has the status). */
.terminal-pane-head.tnai-has-graph-line .terminal-context-state,.terminal-pane-head.tnai-has-graph-line .terminal-pane-state>span{display:none}
.terminal-pane-head>.tnai-graph-line .g-state{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.terminal-workspace-grid[data-density=dense] .terminal-pane-head>.tnai-graph-line .g-text{display:none}
/* Overview card: under the name row. */
.tnai-card>.tnai-graph-line{margin-top:6px}
/* Agents page detail. */
.ap-agent>.tnai-graph-line{padding:6px 16px;border-bottom:1px solid #edf0ea;background:#fbfcf9}
.tnai-graph-item{padding:8px 0;border-top:1px solid #f1f3ee}.tnai-graph-item:first-child{border-top:0;padding-top:0}
.tnai-graph-item .g-head{display:grid;grid-template-columns:7px minmax(0,1fr) auto auto;align-items:center;gap:8px;color:#40463a;font:10px/1.4 var(--pg-sans)}
.tnai-graph-item .g-head span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-graph-item .g-head small{color:#8a8f84;font:9px var(--pg-sans);white-space:nowrap;font-variant-numeric:tabular-nums}
.tnai-graph-item details{margin-top:6px}.tnai-graph-item summary{color:#6e7467;font:9px var(--pg-sans);cursor:pointer}
.tnai-graph-item pre{max-height:220px;margin:6px 0 0;padding:8px;overflow:auto;border:1px solid #edf0ea;border-radius:6px;background:#fbfcf9;color:#4e5547;font:10px/1.45 Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
/* Settings › Agents. */
`;
  document.head.append(style);

  // ---------- Text ----------
  const left = n => Math.max(0, Math.ceil((n.closesAt - Date.now()) / 1000));
  const counting = n => n.status === 'done' && !n.persistent && n.closesAt > Date.now();
  const STATUS = {
    starting: 'Starting',
    working: 'Working',
    done: 'Done',
    failed: 'Failed',
    stopped: 'Stopped',
    hidden: 'Hidden',
    closed: 'Closed',
  };
  const statusText = n =>
    counting(n)
      ? 'Done · closes in ' + left(n) + 's'
      : n.persistent && !['hidden', 'closed', 'stopped', 'failed'].includes(n.status)
        ? (STATUS[n.status] || n.status) + ' · Kept'
        : STATUS[n.status] || n.status;
  const title = n => n.name + (n.instance > 1 ? ' #' + n.instance : '');
  const STATE = {
    ACTIVE: 'Active',
    IDLE: 'Idle',
    HIDDEN: 'Hidden',
    SUSPENDED: 'Suspended',
    ARCHIVED: 'Archived',
  };
  const parentName = n =>
    agentsApi.sessions().find(s => s.paneId === n.parentPaneId)?.name ||
    state.nodes.find(p => p.id === n.parentId)?.name ||
    'its agent';
  const canKeep = n => !!n.paneId && ['starting', 'working', 'done'].includes(n.status);

  // One line: "↳ sub-agent of Nova · purpose", status, Keep / Release. Built once per host, updated
  // in place.
  function line(host, n, before) {
    let box = host.querySelector(':scope>.tnai-graph-line');

    // A class says the line is shown, for the rule that makes room for it in a panel's head. That
    // rule used :has(), which cost a style pass over the whole window on every change anywhere
    // (see tnai-best-practices, "Performance and low latency").
    host.classList.toggle('tnai-has-graph-line', !!n);
    if (!n) {
      if (box) box.hidden = true;
      return;
    }
    if (!box) {
      box = document.createElement('div');
      box.className = 'tnai-graph-line';
      box.innerHTML =
        '<span class="g-text"></span><span class="g-state"><i></i><span></span></span><button type="button" class="tnai-graph-keep"></button>';

      // Its own click only: an Overview card click opens the Agents page, a pane header is
      // draggable.
      box.addEventListener('click', event => {
        const b = event.target.closest('.tnai-graph-keep');
        if (!b) return;
        event.stopPropagation();
        keep(box.dataset.node, !b.hasAttribute('data-on'));
      });
      box.addEventListener('mousedown', event => {
        if (event.target.closest('.tnai-graph-keep')) event.stopPropagation();
      });
      before ? host.insertBefore(box, before) : host.append(box);
    }
    box.hidden = false;
    box.dataset.node = n.id;
    box.dataset.status = n.status;
    box.toggleAttribute('data-kept', !!n.persistent);
    const text = box.querySelector('.g-text'),
      html =
        '↳ sub-agent of <b>' +
        esc(parentName(n)) +
        '</b>' +
        (n.purpose ? ' · ' + esc(n.purpose) : '');
    if (text.innerHTML !== html) {
      text.innerHTML = html;
      text.title =
        'Started by ' +
        parentName(n) +
        ' for: ' +
        (n.purpose || '') +
        (n.task ? '\n\n' + n.task : '');
    }
    const st = box.querySelector('.g-state>span'),
      label = statusText(n);
    if (st.textContent !== label) st.textContent = label;
    const b = box.querySelector('.tnai-graph-keep');
    b.hidden = !canKeep(n);
    b.toggleAttribute('data-on', !!n.persistent);
    b.textContent = n.persistent ? 'Release' : 'Keep';
    b.title = n.persistent
      ? 'Let Technically Not close it after it finishes, as usual'
      : 'Keep it open for follow-up tasks; you close it yourself';
  }

  async function keep(nodeId, on) {
    if (!nodeId) return;
    try {
      apply(await native.graph.keep(nodeId, on));
    } catch (error) {
      say('Could not change it: ' + error.message);
    }
  }

  // ---------- Where it shows ----------
  function paintPanes() {
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const n = byPane(pane.dataset.paneId),
        head = pane.querySelector('.terminal-pane-head');
      if (!head) return;
      const sub = n?.parentId ? n : null;
      if (!sub && !head.querySelector(':scope>.tnai-graph-line')) return;
      line(head, sub, head.querySelector('.terminal-pane-title')?.nextSibling || null);
    });
  }

  // host element -> { kind, session } for repaints on pushed state and the countdown
  const painted = new Map();

  // A host that left the page (a card of a workspace no longer shown, a closed pane) is dropped
  // when a new one is added, so removed cards are not kept alive between repaints.
  const track = (el, v) => {
    if (!painted.has(el)) for (const k of painted.keys()) if (!k.isConnected) painted.delete(k);
    painted.set(el, v);
  };

  function paintCard(el, s) {
    if (!el || !s) return;
    track(el, { kind: 'card', s });
    const n = byPane(s.paneId);
    line(el, n?.parentId ? n : null, el.querySelector('.agent-node-head')?.nextSibling || null);
  }

  // The thread layout (123): the line alone, for the helper in the terminal panel `paneId`. The
  // host is kept for repaints like a card; with no sub-agent there the line is hidden.
  function paintLine(host, paneId) {
    if (!host) return;
    track(host, { kind: 'line', s: { paneId } });
    const n = byPane(paneId);
    line(host, n?.parentId ? n : null, null);
  }

  function paintDetail(box, s) {
    if (!box || !s) return;
    track(box, { kind: 'detail', s });
    const n = byPane(s.paneId);
    line(box, n?.parentId ? n : null, box.querySelector('.ap-head')?.nextSibling || null);

    // Its own delegated sub-agents (a custom agent, or a sub-agent that delegated further): open
    // ones in full, past ones (hidden, archived, no pane) as one small line each.
    const all = n ? kids(n.id) : [],
      list = all.filter(k => k.paneId && paneEl(k.paneId)),
      past = all.filter(k => !list.includes(k));
    let sec = box.querySelector('.tnai-graph-sec');
    if (!all.length) {
      if (sec) sec.hidden = true;
      return;
    }
    if (!sec) {
      sec = document.createElement('section');
      sec.className = 'ap-sec tnai-graph-sec';
      sec.innerHTML = '<h3>DELEGATED SUB-AGENTS <em></em></h3><div></div>';
      sec.addEventListener('click', event => {
        const b = event.target.closest('.tnai-graph-keep');
        if (b) keep(b.dataset.node, !b.hasAttribute('data-on'));
      });
      sec.addEventListener(
        'toggle',
        event => {
          const k = event.target.dataset?.open;
          if (k) event.target.open ? openParts.add(k) : openParts.delete(k);
        },
        true
      );
      const team = box.querySelector('[data-sec="team"]');
      team ? team.after(sec) : box.querySelector('.ap-main')?.append(sec);
    }
    sec.hidden = false;
    const active = list.filter(k => k.status === 'starting' || k.status === 'working').length;
    const em = sec.querySelector('h3 em'),
      est = teamEstimate(list.filter(k => k.status === 'starting' || k.status === 'working'));
    em.textContent =
      active + ' working · ' + list.length + ' open' + (est ? ' · ≈ ' + est.text + ' est.' : '');
    em.title = est ? est.why : '';
    const body = sec.lastElementChild,
      key = JSON.stringify([
        list.map(k => [
          k.id,
          k.name,
          k.instance,
          k.purpose,
          k.status,
          k.persistent,
          k.report,
          k.task,
          k.closesAt > 0,
        ]),
        past.map(k => [k.id, k.name, k.instance, k.purpose, k.status, k.state]),
      ]);
    if (body.dataset.key !== key) {
      body.dataset.key = key;
      body.innerHTML =
        (list.length ? '' : '<p class="ap-note">No sub-agent is open right now.</p>') +
        list
          .slice()
          .reverse()
          .map(
            k =>
              `<div class="tnai-graph-item" data-status="${esc(k.status)}"><div class="g-head"><i class="g-dot"></i><span title="${esc(k.purpose)}"><b>${esc(title(k))}</b> · ${esc(k.purpose)}</span><small data-node="${esc(k.id)}"></small>${canKeep(k) ? `<button type="button" class="tnai-graph-keep" data-node="${esc(k.id)}"${k.persistent ? ' data-on' : ''} title="${k.persistent ? 'Let Technically Not close it after it finishes, as usual' : 'Keep it open for follow-up tasks; you close it yourself'}">${k.persistent ? 'Release' : 'Keep'}</button>` : '<span></span>'}</div>` +
              [
                ['task', 'Task', k.task],
                ['report', 'Report', k.report],
              ]
                .filter(p => p[2])
                .map(
                  ([part, label, text]) =>
                    `<details data-open="${esc(k.id + ':' + part)}"${openParts.has(k.id + ':' + part) ? ' open' : ''}><summary>${label}</summary><pre>${esc(text)}</pre></details>`
                )
                .join('') +
              '</div>'
          )
          .join('') +
        (past.length
          ? '<h3 class="tnai-graph-past">PAST SUB-AGENTS</h3>' +
            past
              .slice()
              .reverse()
              .slice(0, 8)
              .map(
                k =>
                  `<div class="tnai-graph-item" data-status="${esc(k.status)}"><div class="g-head"><i class="g-dot"></i><span title="${esc(k.purpose)}"><b>${esc(title(k))}</b> · ${esc(k.purpose)}</span><small>${esc(STATE[k.state] || STATUS[k.status] || k.status)}</small><span></span></div></div>`
              )
              .join('')
          : '');
    }
    body.querySelectorAll('small[data-node]').forEach(el => {
      const k = list.find(x => x.id === el.dataset.node);
      if (k) {
        const t = statusText(k);
        if (el.textContent !== t) el.textContent = t;
      }
    });
  }
  const openParts = new Set();

  // Team estimate from main (desktop/agent-graph.js `estimate`): median real tokens of the last
  // finished sub-agent tasks, per CLI when it has enough. Nothing is shown until 3 tasks have
  // finished; it is an estimate from past tasks, labeled so, never a count of this task.
  const kTok = n =>
    n >= 1e6
      ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
      : Math.max(1, Math.round(n / 1e3)) + 'k';

  // Codex also reports its own plan window, so a Codex estimate carries the share of that window
  // per task (planPct of a planWindow-minute window).
  const windowName = m =>
    m === 300
      ? '5-hour'
      : m === 10080
        ? 'weekly'
        : m % 1440 === 0
          ? m / 1440 + '-day'
          : m % 60 === 0
            ? m / 60 + '-hour'
            : m + '-minute';
  const pct = n => (n < 1 ? '<1%' : Math.round(n * 10) / 10 + '%');
  const estFor = agent => state.estimate?.byCli?.[agent] || state.estimate?.all || null;

  function teamEstimate(working) {
    const per = working.map(k => estFor(k.agent || 'Claude Code'));
    if (!working.length || per.some(e => !e)) return null;
    const codex = per.filter(e => e.planPct !== undefined),
      share = codex.reduce((a, e) => a + e.planPct, 0);
    return {
      text:
        '~' +
        kTok(per.reduce((a, e) => a + e.perTask, 0)) +
        ' tokens' +
        (codex.length
          ? ' (' + pct(share) + ' of Codex ' + windowName(codex[0].planWindow) + ' window)'
          : ''),
      why:
        'Estimate for the working sub-agents: ' +
        per.map(e => '~' + kTok(e.perTask)).join(' + ') +
        ' tokens, the median of the last finished sub-agent tasks (' +
        per[0].samples +
        '). They all spend from your AI plan at the same time.' +
        (codex.length
          ? ' Codex sub-agents: about ' +
            pct(codex[0].planPct) +
            ' each of your Codex ' +
            windowName(codex[0].planWindow) +
            ' plan window, from Codex’s own usage percent measured over ' +
            codex[0].planSamples +
            ' tasks that ran alone on the account.'
          : ''),
    };
  }

  function repaint() {
    paintPanes();
    for (const [el, { kind, s }] of painted) {
      if (!el.isConnected) {
        painted.delete(el);
        continue;
      }
      if (kind === 'card') paintCard(el, s);
      else if (kind === 'line') paintLine(el, s.paneId);
      else paintDetail(el, s);
    }
    tickIfNeeded();
  }

  // ---------- Countdown: one 1 s timer, only while a finished sub-agent is counting down
  // ----------
  let ticker = 0;

  function tickIfNeeded() {
    const any = state.nodes.some(counting);
    if (any && !ticker)
      ticker = setInterval(() => {
        if (!document.hidden) repaint();
      }, 1000); // hidden window: skip; visibilitychange below catches up
    else if (!any && ticker) {
      clearInterval(ticker);
      ticker = 0;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (ticker && !document.hidden) repaint();
  });

  function apply(next) {
    if (!next || !Array.isArray(next.nodes)) return;
    state = next;
    repaint();
    paintSettings();

    // The thread list sets a helper in under its lead from this state, so it must hear of a change
    // at once and not at the next unrelated push.
    window.dispatchEvent(new CustomEvent('tnai:graph-changed'));
  }

  // ---------- Spawn: a new pane in the parent's workspace, Claude Code started there, nothing else
  // on screen changes ----------
  const paneEl = paneId =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');

  async function spawn({
    nodeId,
    parentPaneId,
    agent = 'Claude Code',
    name: given,
    resumeId,
    model,
    effort,
  } = {}) {
    // Every failure below goes to main with its reason (spawnFailed), so the lead's tnai_delegate
    // says why instead of waiting for a timeout.
    const failed = error => {
      if (nodeId) native.graph.spawnFailed?.(nodeId, error)?.catch?.(() => {});
      return { ok: false, error };
    };
    const parent = paneEl(parentPaneId || '');
    if (!nodeId || !parent) return failed('the lead agent’s panel is not open in the window');
    const ws =
      window.TnaiTerminalWorkspaceByPane?.[parentPaneId] ||
      parent.dataset.workspaceId ||
      'workspace-1';
    const session = agentsApi.sessions().find(s => s.paneId === parentPaneId);

    // main names a returning sub-agent
    let name = String(given || '').trim() || window.TnaiPaneNames?.pick?.() || 'Sub-agent';

    // An empty pane already in the workspace is filled first. Full with no empty pane: 04 continues
    // in a new workspace (shown only if the full one was); only when that fails too does main time
    // out and tell the agent to do the work itself.
    const record = window.TnaiNewTerminalPane?.({
      workspaceId: ws,
      name,
      quiet: true,
      reuseEmpty: true,
    });
    if (!record)
      return failed(
        'the terminal workspace is full (' +
          (window.TnaiPaneLimit?.max || 12) +
          ' panels) and no new workspace could be added'
      );
    name = record.name || name; // an empty pane the user named keeps its name

    // 05 gives the pane its connection select; 07 moves it into its workspace grid
    await new Promise(resolve => setTimeout(resolve, 0));

    // Its CLI is the one the parent chose (tnai_delegate `agent`); the parent's account only
    // carries over to the same CLI, else that CLI's default sign-in.
    const accountId = session?.agent === agent ? session?.accountId || '' : '';

    // tnai_delegate model / effort (desktop/model-pick.js checked them): the fresh pane starts on
    // that pick (46 once), like a model named in the composer (73). Access: never above the lead's
    // level (46 subAccess).
    const pick = !resumeId
      ? {
          model: model || '',
          effort: effort || '',
          access: window.TnaiLaunchPrefs?.subAccess?.(parentPaneId, agent) || '',
        }
      : null;
    if (pick) window.TnaiLaunchPrefs?.once(agent, pick);
    let result;
    try {
      result = await agentsApi.openIn(record.id, agent, {
        accountId,
        subagentOf: nodeId,
        name,
        resumeId: resumeId || '',
      });
    } finally {
      // resumeId: a hidden sub-agent's conversation revived
      if (pick) window.TnaiLaunchPrefs?.once(agent, null);
    }
    if (!result?.ok) {
      say(
        'Could not start a sub-agent for ' +
          (session?.name || 'a custom agent') +
          ': ' +
          (result?.error || 'unknown error')
      );
      failed(result?.error || agent + ' did not start in its panel');
    }
    return { ...result, paneId: record.id, workspaceId: ws, name };
  }

  // ---------- Close: main ended a finished sub-agent the user didn't keep; remove its pane like
  // the pane's own × ----------
  function close({ paneId } = {}) {
    const pane = paneId && paneEl(paneId);
    pane?.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.click();
    return !!pane;
  }

  // Any graph pane removed (its ×, an Overview card ×, a closed workspace, or the close above):
  // main forgets it.
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const paneId = event.detail?.paneId;
    if (paneId && byPane(paneId)) native.graph.removed(paneId);
  });

  // ---------- Settings › Agents: Delegation limits ----------
  const LIMITS = [
    ['maxDepth', 'Delegation depth', '1 = sub-agents can’t delegate further.', 1, 3, ''],
    ['maxActivePerAgent', 'Sub-agents working per agent', 'At the same time.', 1, 6, ''],
    ['maxActiveTotal', 'Sub-agents working in total', 'Across all custom agents.', 1, 11, ''],
    [
      'graceSeconds',
      'Close finished sub-agents after',
      "Once their lead's task is done, unless you keep them.",
      10,
      600,
      'seconds',
    ],
  ];
  const NO_LIMIT = new Set(['maxActivePerAgent', 'maxActiveTotal']),
    FREE_BACK = { maxActivePerAgent: 3, maxActiveTotal: 6 }; // desktop/agent-graph.js DEFAULTS
  let settingsBox = null;

  function paintSettings() {
    const mount = document.getElementById('tnaiDelegationMount');
    if (!mount) return;
    if (!settingsBox) {
      settingsBox = document.createElement('section');
      settingsBox.className = 'set-group tnai-deleg';
      settingsBox.innerHTML =
        '<header class="set-group-head"><div><h3>Delegation limits</h3><p title="A custom agent built on Claude Code can hand a separate part of its task to a sub-agent, which opens in its own panel in the same terminal workspace and reports back. Every delegation is checked against these limits; duplicates are refused.">How custom agents hand work to sub-agents.</p></div><span class="tnai-deleg-saved set-saved" aria-live="polite"></span></header><div class="set-card">' +
        // The two counts can also be "No limit" (0 in main: a user controls their own
        // spawning); depth and closing keep a number.
        LIMITS.map(([key, label, help, lo, hi, unit]) => {
          const free = NO_LIMIT.has(key);
          return `<div class="set-row tnai-deleg-row"><span class="set-text"><b>${label}</b><small>${help} (${lo}–${hi}${free ? ', or no limit' : ''})</small></span><span class="set-ctl"><input type="number" class="set-input set-num" data-limit="${key}" min="${lo}" max="${hi}" step="1" aria-label="${label}"><em>${unit}</em>${free ? `<label class="set-chip tnai-deleg-free"><input type="checkbox" data-nolimit="${key}"> No limit</label>` : ''}</span></div>`;
        }).join('') +
        '<div class="set-row tnai-deleg-est"><span class="set-text"><b>Estimated team usage</b><small></small></span><span class="set-ctl"><em></em></span></div></div>';
      settingsBox.addEventListener('change', async event => {
        const box = event.target.closest('input[data-nolimit]');
        if (box) {
          // No limit: 0; off again: back to the default count
          const key = box.dataset.nolimit,
            saved = settingsBox.querySelector('.tnai-deleg-saved');
          try {
            apply(await native.graph.settings({ [key]: box.checked ? 0 : FREE_BACK[key] }));
            saved.textContent = 'Saved';
            setTimeout(() => {
              if (saved.textContent === 'Saved') saved.textContent = '';
            }, 1600);
          } catch (error) {
            saved.textContent = 'Not saved: ' + error.message;
          }
          return paintSettings();
        }
        const input = event.target.closest('input[data-limit]');
        if (!input || input.value === '') return;
        const saved = settingsBox.querySelector('.tnai-deleg-saved');
        try {
          apply(await native.graph.settings({ [input.dataset.limit]: Number(input.value) }));
          saved.textContent = 'Saved';
          setTimeout(() => {
            if (saved.textContent === 'Saved') saved.textContent = '';
          }, 1600);
        } catch (error) {
          saved.textContent = 'Not saved: ' + error.message;
        }
        input.value = state.settings[input.dataset.limit] ?? input.value; // clamped by main
      });
      mount.replaceChildren(settingsBox);
    }
    settingsBox.querySelectorAll('input[data-limit]').forEach(input => {
      const k = input.dataset.limit,
        v = state.settings[k],
        free = NO_LIMIT.has(k) && v === 0,
        box = settingsBox.querySelector(`[data-nolimit="${k}"]`);
      if (box) box.checked = free;
      input.disabled = free;
      if (v !== undefined && document.activeElement !== input) input.value = free ? '' : v;
      input.placeholder = free ? '∞' : '';
    });

    // Before a team starts: what one sub-agent task has really used here, and a full team at the
    // per-agent limit.
    const e = state.estimate?.all,
      per = state.settings.maxActivePerAgent || 1;
    const cx = state.estimate?.byCli?.Codex,
      cxShare =
        cx?.planPct !== undefined
          ? ' Codex: about ' +
            pct(cx.planPct) +
            ' of your ' +
            windowName(cx.planWindow) +
            ' plan window per task, ≈ ' +
            pct(cx.planPct * per) +
            ' for ' +
            per +
            ' (Codex’s own usage percent' +
            (cx.plan ? ', plan ' + cx.plan : '') +
            ').'
          : '';
    const help = e
      ? 'Per sub-agent task: ~' +
        kTok(e.perTask) +
        ' tokens (median of your last ' +
        e.samples +
        '). Every working sub-agent spends from your AI plan at the same time.' +
        cxShare
      : 'Shown after 3 sub-agent tasks have finished, from the tokens they really used.';
    const value = e ? '≈ ~' + kTok(e.perTask * per) + ' for ' + per : '—';
    const est = settingsBox.querySelector('.tnai-deleg-est');
    if (est.querySelector('small').textContent !== help)
      est.querySelector('small').textContent = help;
    if (est.querySelector('em').textContent !== value) {
      est.querySelector('em').textContent = value;
      est.title = e ? 'A full team at your limit of ' + per + ' working per agent.' : '';
    }
  }

  native.graph.onState(apply);
  native.graph.onSpawn(spawn);
  native.graph.onClose(close);
  native.graph
    .state()
    .then(apply)
    .catch(() => {});

  // A pane's header is rebuilt or renamed, panes move between workspaces, sessions start: refresh
  // the header lines.
  agentsApi.onChange(() => paintPanes());
  window.addEventListener('tnai:terminal-pane-renamed', repaint);

  window.TnaiGraph = {
    state: () => state,
    node: byPane,
    paintCard,
    paintDetail,
    paintLine,
    spawn,
    close,
  };
})();
