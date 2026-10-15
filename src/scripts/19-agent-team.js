// Technically Not · 19-agent-team.js — Desktop app only: each sub-agent the lead agent chose to
// start, with live status, current tool, and final output, drawn under the lead's card on Overview.
// Data comes from Claude Code's own hooks (desktop/agent-hooks.js), not terminal text.
// `window.TnaiTeam` (paint, whenReady, startLead, read-only get/onChange for the Agents page).
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.agentEvents || !agents) return;

  // paneId -> { task, subs: [], lead, readyAt, bg: [] (background tasks still running: shells,
  // monitors, workflows) }
  const panes = new Map();
  const open = new Set(); // sub keys whose details are expanded
  const waiters = []; // { paneId, since, resolve }
  let lastSeq = 0,
    loading = true;
  const queued = [];
  const pane = id => {
    if (!panes.has(id))
      panes.set(id, { task: null, subs: [], lead: null, readyAt: 0, bg: [], gone: new Map() });
    return panes.get(id);
  };

  // Every hook event of every agent lands here (a tool call each): listeners (11 route, 23, 53)
  // repaint once per frame, not once per event. A hidden window has no frames, so it uses a short
  // timer instead.
  let pendingChange = false;
  const changed = () => {
    if (pendingChange) return;
    pendingChange = true;
    const run = () => {
      pendingChange = false;
      window.dispatchEvent(new CustomEvent('tnai:team-changed'));
    };
    document.hidden ? setTimeout(run, 50) : requestAnimationFrame(run);
  };

  // A finished sub-agent has handed its report to the lead (Claude Code returns its final message
  // as the Agent result, also kept in the lead's timeline on the Agents page), so it leaves the
  // view shortly after, long enough to see it finish. The lead stays.
  let retireAfter = 3000;

  function retire(p, s) {
    setTimeout(() => {
      const i = p.subs.indexOf(s);
      if (i < 0 || (s.status !== 'done' && s.status !== 'failed')) return;
      p.subs.splice(i, 1);
      open.delete(s.key);
      keep(p, s);
      changed();
    }, retireAfter);
  }

  // ended sub-agents kept per pane, newest last, in case one picks up again (revive)
  const GONE_MAX = 30;

  function keep(p, s) {
    if (!s.agentId) return;
    p.gone.delete(s.agentId);
    p.gone.set(s.agentId, s);
    if (p.gone.size > GONE_MAX) p.gone.delete(p.gone.keys().next().value);
  }

  // Claude Code reports a background sub-agent "completed" whenever its reply ends, but one that is
  // waiting on its own background task picks up again when that task hands back, with no new
  // SubagentStart. A tool call of it after it ended brings it back as running.
  function revive(p, id, at) {
    let s = p.subs.find(x => x.agentId === id);
    if (!s) {
      s = p.gone.get(id);
      if (!s) return null;
      p.gone.delete(id);
      p.subs.push(s);
    }
    if ((s.status === 'done' || s.status === 'failed') && !s.stopped && at >= (s.endedAt || 0))
      Object.assign(s, { status: 'running', endedAt: 0 });
    return s;
  }

  // 'spawn' comes from PreToolUse, before Claude Code's permission check. A launch it refused never
  // runs: its PostToolUseFailure ('spawn-refused') removes the card. Safety net if that hook
  // doesn't come: an accepted call has its result (foreground: done; background: running) or its
  // SubagentStart before the lead's Stop, so a card still starting at Stop was never launched and
  // goes too.
  function dropUnstarted(p, toolUseId) {
    const gone = s =>
      s.status === 'starting' && !s.agentId && (!toolUseId || s.toolUseId === toolUseId);
    for (const s of p.subs) if (gone(s)) open.delete(s.key);
    p.subs = p.subs.filter(s => !gone(s));
  }

  // Where a sub-agent's "Starting" time goes, from Claude Code's own hook times (spawnAt: its Agent
  // call; startAt: SubagentStart; firstToolAt: its first tool call): logged once per live sub-agent
  // to the developer console, kept on the card (state()).
  function logTiming(s) {
    if (loading || !s.spawnAt) return;
    const gap = (a, b) => (a && b ? b - a + ' ms' : 'n/a');
    console.info(
      '[tnai] sub-agent start · ' +
        (s.description || s.type) +
        ' · call → SubagentStart ' +
        gap(s.spawnAt, s.startAt) +
        ' · SubagentStart → first tool ' +
        gap(s.startAt, s.firstToolAt) +
        (s.asked ? ' · waited on a permission prompt' : '')
    );
  }

  function apply(e) {
    if (e.seq && e.seq <= lastSeq) return;
    if (e.seq) lastSeq = e.seq;
    const p = pane(e.paneId);
    const bySub = id => id && p.subs.find(s => s.agentId === id);
    switch (e.kind) {
      case 'ready':
        p.readyAt = e.at;
        p.busy = false;
        for (let i = waiters.length - 1; i >= 0; i--)
          if (waiters[i].paneId === e.paneId && e.at >= waiters[i].since)
            waiters.splice(i, 1)[0].resolve(true);
        break;
      case 'prompt': {
        // a new task: the previous task's finished sub-agents make way for this one's
        p.busy = true;

        // a turn is open until Claude Code's Stop hook (or an interrupt/exit, endTurn below)
        p.busyAt = e.at;

        // Claude Code wraps a long bracketed paste as <pasted_content id="…">…</pasted_content
        // id="…"> (a nested one escaped as <\pasted_content …>): not the task.
        const said = String(e.text || '')
          .replace(/<[\/\\]?pasted_content\b[^<>]*>/g, '')
          .trim();

        // folded into the open turn: keep its task and sub-agents
        if (/^\[(?:TN|TechnicallyNot)\.ai\] \[New task while you work/.test(said)) break;
        p.task = {
          text: said.replace(/^\[(?:TN|TechnicallyNot)\.ai\]\s*/, ''),
          at: e.at,
          fromTnai: /^\[(?:TN|TechnicallyNot)\.ai\]/.test(said),
        };
        p.subs = p.subs.filter(
          s => s.status === 'running' || s.status === 'starting' || void keep(p, s)
        );
        break;
      }
      case 'spawn':
        p.subs.push({
          key: e.toolUseId || 'k' + e.seq,
          toolUseId: e.toolUseId,
          type: e.type,
          name: e.name,
          description: e.description || e.type,
          prompt: e.prompt,
          background: e.background,
          parent: e.agentId || '',
          status: 'starting',
          startedAt: e.at,
          spawnAt: e.at,
          endedAt: 0,
          now: null,
          tools: 0,
          result: '',
          agentId: '',
        });
        break;
      case 'sub-start': {
        // SubagentStart names the agent type, not the call: the oldest waiting call of that type is
        // this sub-agent.
        if (bySub(e.agentId)) {
          const known = bySub(e.agentId);
          if (known.status === 'starting') known.status = 'running';
          break;
        } // its call already named it
        const waiting = p.subs.filter(s => s.status === 'starting' && !s.agentId);
        let s = waiting.find(x => x.type === e.agentType) || waiting[0];
        if (!s) {
          s = {
            key: 'a' + e.agentId,
            type: e.agentType,
            description: e.agentType || 'Sub-agent',
            prompt: '',
            parent: '',
            tools: 0,
            result: '',
            now: null,
            endedAt: 0,
          };
          p.subs.push(s);
        }
        Object.assign(s, { agentId: e.agentId, status: 'running', startedAt: e.at, startAt: e.at });
        break;
      }
      case 'tool': {
        let s = e.agentId && revive(p, e.agentId, e.at);

        // A sub-agent calling tools before its SubagentStart reached us (or without one): it runs,
        // so it takes the oldest waiting call of its own type, as sub-start does (inferred),
        // instead of its activity being dropped while its card still says Starting.
        if (!s && e.agentId && e.agentType) {
          s = p.subs.find(x => x.status === 'starting' && !x.agentId && x.type === e.agentType);
          if (s)
            Object.assign(s, {
              agentId: e.agentId,
              status: 'running',
              startedAt: e.at,
              startAt: e.at,
              asking: '',
            });
        }
        const now = { tool: e.tool, detail: e.detail, label: e.label || '', at: e.at };
        if (s) {
          if (!s.tools) {
            s.firstToolAt = e.at;
            logTiming(s);
          }
          s.now = now;
          s.tools++;
        } else if (!e.agentId) p.lead = now;
        break;
      }
      case 'sub-stop': {
        const s = bySub(e.agentId);
        if (s) {
          Object.assign(s, { status: 'done', endedAt: e.at, result: e.text || s.result });
          retire(p, s);
        }
        break;
      }

      // a background task it started (desktop/agent-hooks.js): runs on after the turn ends, until
      // its hand-back or a TaskStop
      case 'bg-start':
        if (!p.bg.some(b => b.taskId === e.taskId))
          p.bg.push({
            taskId: e.taskId,
            toolUseId: e.toolUseId,
            tool: e.tool,
            detail: e.detail,
            label: e.label,
            startedAt: e.at,
            agentId: e.agentId || '',
          });
        break;
      case 'bg-end': {
        p.bg = p.bg.filter(b => b.taskId !== e.taskId);

        // the same id can be a background sub-agent: its hand-back taken into a running reply, or
        // listed "completed" after a compact (desktop/agent-turns.js), comes with no SubagentStop
        const s = bySub(e.taskId);
        if (s && s.status !== 'done' && s.status !== 'failed') {
          Object.assign(s, {
            status: /fail|error|kill/i.test(e.status || '') ? 'failed' : 'done',
            endedAt: e.at,
          });
          retire(p, s);
        }
        break;
      }

      // After a compact Claude Code lists every background task it still runs
      // (desktop/agent-turns.js): the lead's own background commands and background sub-agents from
      // before the compact that it no longer lists have ended. Entries of a sub-agent are not in
      // the lead's list, so they stay.
      case 'bg-sweep': {
        const running = new Set(e.running || []);
        const ended = x => (x.startedAt || 0) <= e.before && !running.has(x.agentId || x.taskId);
        p.bg = p.bg.filter(b => b.agentId || !ended(b));
        for (const s of p.subs)
          if (
            s.background &&
            !s.parent &&
            s.agentId &&
            (s.status === 'running' || s.status === 'starting') &&
            ended(s)
          ) {
            Object.assign(s, { status: 'done', endedAt: e.at });
            retire(p, s);
          }
        break;
      }
      case 'sub-note': {
        // a background sub-agent (or background task) handed back to the lead, which now works on
        // in the same task
        p.busy = true;
        p.busyAt = e.at;
        p.bg = p.bg.filter(
          b => b.taskId !== e.agentId && !(b.toolUseId && b.toolUseId === e.toolUseId)
        );
        const s = p.subs.find(x => x.toolUseId && x.toolUseId === e.toolUseId) || bySub(e.agentId);
        if (!s) break;
        if (s.status !== 'done' && s.status !== 'failed')
          Object.assign(s, {
            status: /fail|error|kill/i.test(e.status || '') ? 'failed' : 'done',
            endedAt: e.at,
          });
        if (!s.result && e.text) s.result = e.text;
        retire(p, s);
        break;
      }
      case 'spawn-result': {
        const s =
          p.subs.find(x => x.toolUseId && x.toolUseId === e.toolUseId) || bySub(e.result?.agentId);
        if (!s) break;
        const id = e.result?.agentId;
        if (id && s.agentId !== id) {
          // the call's own id wins over SubagentStart's by-type guess; a sub that took it swaps
          const other = bySub(id),
            displaced = s.agentId;

          // the card that took this id by guess gets the displaced one; with none it never really
          // started: back to starting (not a "Running" card with no agent behind it), so its own
          // result, spawn-refused or the lead's Stop settles it
          if (other) {
            other.agentId = displaced || '';
            if (!displaced && other.status === 'running') other.status = 'starting';
          } else if (displaced) {
            const w = p.subs.find(x => x !== s && !x.agentId && x.status === 'starting');
            if (w) Object.assign(w, { agentId: displaced, status: 'running' });
          }
          s.agentId = id;
        }

        // launched in the background: it finishes later, with SubagentStop
        if (e.result?.async) s.background = true;
        if (/error|fail/i.test(e.result?.status || ''))
          Object.assign(s, { status: 'failed', endedAt: e.at, result: e.result.text || s.result });
        else if (s.background) {
          if (s.status === 'starting') s.status = 'running';
        } else
          Object.assign(s, {
            status: 'done',
            endedAt: s.endedAt || e.at,
            result: s.result || e.result?.text || '',
          });
        if (s.status === 'done' || s.status === 'failed') retire(p, s);
        break;
      }
      case 'spawn-refused':
        if (e.toolUseId) dropUnstarted(p, e.toolUseId);
        break;
      case 'stop':
        p.lead = null;
        p.busy = false;
        dropUnstarted(p);
        break;
    }
  }

  function receive(e) {
    if (loading) queued.push(e);
    else {
      apply(e);
      changed();
    }
  }
  native.agentEvents.on(receive);

  // Claude Code sends no Stop hook when the user interrupts it (Esc) or it exits;
  // desktop/agent-turns.js ends the turn then (endedBy 'interrupted' / 'exit') and pushes it. A
  // turn that ended at or after the open prompt closes it: not busy, no current tool.
  function endTurn(t) {
    const p = t?.paneId && t.endedAt && panes.get(t.paneId);
    if (!p || !(p.busy || p.lead) || t.endedAt < (p.busyAt || 0)) return false;
    p.busy = false;
    p.lead = null;
    return true;
  }

  // Sub-agents of a Claude Code process that exited can't still run: once the pane's process
  // stopped, or a newer one started (restart/resume), they end as "Stopped with its lead" and no
  // longer count as busy (11 route's MAX_BUSY_SUBS).
  function sweep() {
    let any = false;
    for (const s of agents.sessions()) {
      const p = panes.get(s.paneId);
      if (!p) continue;
      const older = at => !s.running || (s.startedAt && at < s.startedAt);
      for (const x of p.subs)
        if ((x.status === 'running' || x.status === 'starting') && older(x.startedAt || 0)) {
          Object.assign(x, { status: 'failed', stopped: true, endedAt: x.endedAt || Date.now() });
          any = true;
        }
      if ((p.busy || p.lead) && older(p.busyAt || 0)) {
        p.busy = false;
        p.lead = null;
        any = true;
      }
      const bg = p.bg.filter(b => !older(b.startedAt || 0));
      if (bg.length !== p.bg.length) {
        p.bg = bg;
        any = true;
      } // they end with its process
    }
    return any;
  }
  native.agentEvents
    .history()
    .then(list => {
      (list || []).sort((a, b) => a.seq - b.seq).forEach(apply);
    })
    .catch(() => {})
    .then(() => native.agentTurns?.state?.())
    .then(
      list => {
        (list || []).forEach(endTurn);
      },
      () => {}
    )
    .finally(() => {
      loading = false;
      queued.splice(0).forEach(apply);
      sweep();
      changed();
      native.permissions?.pending?.().then(
        list => (list || []).forEach(onPermission),
        () => {}
      );
    });
  native.agentTurns?.on?.(t => {
    if (loading) return;
    let any = endTurn(t);

    // OpenCode sends no "stop" event: its ended turn is the same safety net, a card still starting
    // then was never launched.
    const p = t?.agent === 'OpenCode' && t.endedAt && panes.get(t.paneId);
    if (
      p &&
      p.subs.some(s => s.status === 'starting' && !s.agentId && (s.startedAt || 0) <= t.endedAt)
    ) {
      dropUnstarted(p);
      any = true;
    }
    if (any) changed();
  });

  // A launch held on a permission prompt (desktop/agent-hooks.js PermissionRequest, answered in 45
  // or its terminal): its card says "Waiting for approval" until the prompt closes. Matched by the
  // call's description; with several identical ones, the oldest.
  function onPermission(q) {
    const p = panes.get(q?.paneId);
    if (!p) return;
    if (q.done) {
      const s = p.subs.find(x => x.asking === q.id);
      if (s) {
        s.asking = '';
        changed();
      }
      return;
    }

    // OpenCode names the tool "task" and its request carries no description of the call: the oldest
    // call still waiting to start is the one asked about.
    const oc =
      q.tool === 'task' && agents.sessions().find(x => x.paneId === q.paneId)?.agent === 'OpenCode';
    if (q.tool !== 'Agent' && q.tool !== 'Task' && !oc) return;
    const s = p.subs.find(
      x =>
        x.status === 'starting' &&
        !x.agentId &&
        !x.asking &&
        (oc || x.description === (q.description || x.type))
    );
    if (s) {
      s.asking = q.id;
      s.asked = true;
      changed();
    }
  }
  native.permissions?.on?.(onPermission);
  agents.onChange?.(() => {
    if (!loading && sweep()) changed();
  });
  window.addEventListener('tnai:terminal-pane-closed', event => {
    panes.delete(event.detail?.paneId);
    changed();
  });

  // Resolves true once the pane's Claude Code session is ready (it connected to Technically Not's
  // MCP server) after `since`, false after `ms`.
  function whenReady(paneId, since, ms = 20000) {
    if ((panes.get(paneId)?.readyAt || 0) >= since) return Promise.resolve(true);
    return new Promise(resolve => {
      const w = { paneId, since, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) {
          waiters.splice(i, 1);
          resolve(false);
        }
      }, ms);
    });
  }

  // Terminal output as plain text: the CLI positions words with cursor codes, so they are replaced
  // by spaces.
  const screenText = buffer =>
    String(buffer || '')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
      .replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]/g, ' ')
      .replace(/\s+/g, ' ');

  // A starting pane's recent output, pushed: its replay once, then its live output (a replay per
  // check re-sent up to 320 KB over IPC and re-parsed all of it every 400 ms). text() is the screen
  // text of the last KEEP characters; stop() ends the subscription.
  function outputTail(paneId, KEEP = 64 * 1024) {
    let raw = '',
      ready = false;
    const off = native.pty.onData(e => {
      if (ready && e.paneId === paneId) raw = (raw + e.data).slice(-KEEP);
    });

    // IPC keeps order: output sent before the reply is in its buffer, output after it arrives as
    // pty:data.
    native.pty
      .replay(paneId)
      .then(
        r => {
          raw = (String(r?.buffer || '') + raw).slice(-KEEP);
        },
        () => {}
      )
      .finally(() => {
        ready = true;
      });
    return { text: () => screenText(raw), stop: () => off?.() };
  }

  // A new pane in the active terminal workspace with Claude Code started there, without leaving the
  // current page (the composer's New agent, 11). ownedByUser: main registers it as a user-owned
  // root, so it gets Technically Not's delegation tools (desktop/agent-graph.js). own: the user
  // started it themselves (composer New agent): a user-owned root that Auto never hands tasks to
  // (11 autoPick). A lead Auto starts (own false) stays in Auto's pool; both get Technically Not's
  // in-panel folder-trust question before the CLI starts (askTrust, main.js).
  async function openHere(agent = 'Claude Code', accountId, own = true) {
    let name = window.TnaiPaneNames?.pick?.() || '';

    // an empty pane in the workspace is filled first
    const record = window.TnaiNewTerminalPane?.({ name, quiet: true, reuseEmpty: true });
    if (!record) return { ok: false, error: window.TnaiPaneLimit.message };
    name = record.name || name;

    // 05 gives the pane its connection select; 07 moves it into its workspace grid
    await new Promise(resolve => setTimeout(resolve, 0));

    // the composer's Own worktree box (35)
    const worktree = window.TnaiWorktrees?.want?.({ agent, from: 'composer' }) === true;
    return agents.openIn(
      record.id,
      agent,
      ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent'].includes(agent)
        ? {
            ownedByUser: own,
            askTrust: true,
            name,
            accountId,
            worktree,
          } /* agents that can lead (desktop/agent-graph.js LEADS) */
        : { name, accountId, worktree }
    ); // accountId undefined: the CLI's active account
  }

  // Codex / Cursor Agent as the composer's new agent (46 menu): no hooks, so it is ready once it
  // has drawn its prompt and gone quiet.
  async function startOther(agent, accountId, own = true) {
    const info = agents.info().find(a => a.id === agent);
    if (!info?.installed) return { error: agent + ' is not installed.' };
    if (info.loggedIn === false && !accountId)
      return {
        error: agent + ' is not signed in. Start a thread with it and sign in, then send again.',
      };
    const opened = await openHere(agent, accountId, own);
    if (!opened?.ok) return { error: opened?.error || agent + ' could not start.' };
    const end = Date.now() + 30000,
      tail = outputTail(opened.paneId);
    try {
      while (Date.now() < end) {
        await new Promise(r => setTimeout(r, 400));
        const s = agents.sessions().find(x => x.paneId === opened.paneId);
        if (!s || s.status === 'error' || s.status === 'exited')
          return { error: agent + ' stopped while starting.' };
        if (/trust/i.test(tail.text().slice(-1500))) {
          document.querySelector('.side-item[data-view="terminal"]')?.click();
          return {
            error:
              agent +
              ' is asking whether to trust this project folder. Answer it on its CLI screen, then send your task again.',
          };
        }
        if (s.running && s.lastOutputAt && Date.now() - s.lastOutputAt > 1500) return s;
      }
    } finally {
      tail.stop();
    }
    return { error: agent + ' started but is not ready yet. Check its thread, then send again.' };
  }

  // Starts a Claude Code lead in a new pane (opts.accountId, else the active account; opts.agent:
  // another CLI, the composer's pick in 11/46) and waits until it can take a prompt. opts.here: the
  // composer's New agent (openHere above); otherwise the Terminal page's own new-pane path.
  async function startLead(opts = {}) {
    await agents.detect();
    if (opts.agent && opts.agent !== 'Claude Code')
      return startOther(opts.agent, opts.accountId, !!opts.here);
    const claude = agents.info().find(a => a.id === 'Claude Code');
    const why = opts.here
      ? 'A new agent needs Claude Code'
      : 'No agent is running, and Claude Code is';
    if (!claude?.installed)
      return {
        error: opts.here
          ? why + ', which is not installed.'
          : why + ' not installed to lead tasks. Start one with New thread.',
      };
    if (claude.loggedIn === false && !opts.accountId)
      return {
        error: opts.here
          ? why + ', which is not signed in. Start a thread with it and sign in, then send again.'
          : why + ' not signed in. Start a thread with it and sign in, then send again.',
      };
    const since = Date.now();

    // Opens quietly in the active terminal workspace: the user stays on whatever page they sent
    // from.
    const opened = await openHere('Claude Code', opts.accountId, !!opts.here);
    if (!opened?.ok) return { error: opened?.error || 'Claude Code could not start.' };

    // Claude Code asks once per folder whether to trust it, and runs no hooks until answered: that
    // question is the user's to answer.
    let asking = false;
    const trust = (async () => {
      const end = Date.now() + 20000,
        tail = outputTail(opened.paneId);
      try {
        while (Date.now() < end && !asking) {
          if (/trust\s*this\s*folder/i.test(tail.text())) return true;
          await new Promise(r => setTimeout(r, 400));
        }
        return false;
      } finally {
        tail.stop();
      }
    })();
    const first = await Promise.race([
      whenReady(opened.paneId, since).then(r => (r ? 'ready' : 'timeout')),
      trust.then(t => (t ? 'trust' : 'timeout')),
    ]);
    asking = true;
    if (first === 'trust') {
      document.querySelector('.side-item[data-view="terminal"]')?.click();
      return {
        error:
          'Claude Code is asking whether to trust this project folder. Answer it on its CLI screen, then send your task again.',
      };
    }
    if (first !== 'ready')
      return {
        error: 'Claude Code started but is not ready yet. Check its thread, then send again.',
      };
    await new Promise(r => setTimeout(r, 300));
    return (
      agents.sessions().find(s => s.paneId === opened.paneId) || {
        error: 'Claude Code stopped while starting.',
      }
    );
  }

  // ---------- view: drawn into a slot in the lead's card (11 calls paint on every card update)
  // ----------
  const style = document.createElement('style');
  style.textContent = `
.tnai-card-team{margin-top:10px}.tnai-card-team:empty{display:none}
.t-head{margin:0 0 4px;color:#9a9f95;font:7px/1.4 var(--pg-sans);letter-spacing:.06em;text-transform:uppercase}.t-head b{color:#5c7d43;font-weight:600}
.t-subs{display:grid;gap:3px;margin:0 0 0 3px;padding:0 0 0 10px;border-left:1px solid #d5dccd;list-style:none}
.t-sub{position:relative}.t-sub .t-row{padding-right:22px}
.t-go{position:absolute;top:2px;right:2px;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:none;color:#9aa093;cursor:pointer;opacity:.55}
.t-go:hover,.t-go:focus-visible{background:#eef2e8;color:#5c7d43;opacity:1}.t-sub:hover .t-go{opacity:1}.t-sub::before{content:'';position:absolute;left:-10px;top:10px;width:8px;border-top:1px solid #d5dccd}
.t-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px;width:100%;padding:4px 6px;border:0;border-radius:5px;background:none;color:#4f5549;font:9px/1.35 var(--pg-sans);text-align:left;cursor:pointer}
.t-row:hover,.t-sub.open .t-row{background:#f4f6f1}
.t-row>i{width:6px;height:6px;border-radius:50%;background:#c9cdc3}
.t-sub[data-status=running] .t-row>i{background:#82a95f} /* pulse: shared, 05-status-colors.css */
.t-sub[data-status=starting] .t-row>i{background:#c7a24e}.t-sub[data-status=done] .t-row>i{background:#9fb386}.t-sub[data-status=failed] .t-row>i{background:#bd7068}
.t-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.t-label b{font-weight:600}
.t-row small{max-width:11em;overflow:hidden;color:#8d9288;font-size:8px;text-overflow:ellipsis;white-space:nowrap}
.t-detail{display:grid;gap:6px;margin:2px 0 4px;padding:7px 8px;border:1px solid #edf0ea;border-radius:5px;background:#fbfbf9;color:#5b6353;font:9px/1.45 var(--pg-sans);cursor:auto}
.t-detail[hidden]{display:none}
.t-detail small{display:block;margin-bottom:1px;color:#9a9f95;font-size:7px;letter-spacing:.06em}
.t-detail pre{max-height:160px;margin:0;overflow:auto;font:9px/1.45 var(--pg-sans);white-space:pre-wrap;word-break:break-word}
`;
  document.head.append(style);

  const secs = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function stateText(s, live) {
    if (s.status === 'done') return 'Done · ' + secs(s.endedAt - s.startedAt);
    if (s.status === 'failed') return s.stopped ? 'Stopped with its lead' : 'Failed';
    if (!live) return 'Stopped with its lead';
    return s.status === 'starting'
      ? s.asking
        ? 'Waiting for approval'
        : 'Starting'
      : 'Running · ' + secs(Date.now() - s.startedAt);
  }

  // Sub-agents get agent-style names like panes: picked from the call id, so replaying history
  // after a reload gives the same name. A name the user chose always wins, shown as is: the call's
  // own `name`, or a "Name: …" line the lead put at the top of the prompt (hidden skill 00).
  const chosenName = s =>
    String(
      s.name || /^\s*(?:Summary:.*\n\s*)?Name:[ \t]*([^\n]{1,40})/i.exec(s.prompt || '')?.[1] || ''
    )
      .replace(/\s+/g, ' ')
      .trim();

  function aliasFor(s) {
    if (s.alias) return s.alias;
    const chosen = chosenName(s);
    if (chosen) return (s.alias = chosen);
    const names = window.TnaiPaneNames?.list?.() || [];
    if (!names.length) return '';
    const used = new Set(
      [...document.querySelectorAll('.terminal-pane-title')].map(t =>
        t.textContent.trim().toLowerCase()
      )
    );
    for (const p of panes.values()) p.subs.forEach(x => x.alias && used.add(x.alias.toLowerCase()));
    let h = 0;
    for (const c of String(s.key)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    for (let round = 1; ; round++)
      for (let i = 0; i < names.length; i++) {
        const name = names[(h + i) % names.length] + (round > 1 ? ' ' + round : '');
        if (!used.has(name.toLowerCase())) return (s.alias = name);
      }
  }

  // The ↗ icon, parsed once and cloned per row.
  const GO_ICON = document.createElement('template');
  GO_ICON.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2H2.5v7.5H10V7M7 2h3v3M10 2 5.5 6.5"/></svg>';

  function paint(box, session) {
    const p = panes.get(session.paneId);
    if (!p || !p.subs.length) {
      if (box.childElementCount) box.replaceChildren();
      return;
    }
    const live = session.running;

    // 42 / desktop/agent-turns.js: each sub-agent's own tokens
    const subTok = window.TnaiTurns?.get?.(session.paneId)?.subTokens || {};
    const tokOf = s =>
      s.agentId && subTok[s.agentId]
        ? window.TnaiTurns.format.tokens(subTok[s.agentId]) + ' tok · '
        : '';
    const metaText = s =>
      (s.type && s.type !== 'general-purpose' ? s.type + ' · ' : '') +
      tokOf(s) +
      stateText(s, live);

    // The key leaves out the clock and the token counts (pushed several times a second while
    // sub-agents work): both are updated in place, so the rows are rebuilt only when a sub-agent
    // starts, ends, gets its output or is opened.
    const tokTip = s =>
      tokOf(s)
        ? subTok[s.agentId].toLocaleString() +
          ' tokens used by this sub-agent (input, cache writes, output), from ' +
          (session.agent === 'OpenCode'
            ? 'OpenCode’s own session record'
            : 'its own Claude Code transcript')
        : '';
    const shape = JSON.stringify([
      p.subs.map(s => [s.key, s.status, s.result.length, open.has(s.key)]),
      live,
      session.name,
    ]);
    if (box.dataset.key === shape) {
      box.querySelectorAll(':scope>.t-subs>.t-sub').forEach((item, i) => {
        const meta = item.querySelector(':scope>.t-row>small'),
          s = p.subs[i],
          text = s && metaText(s);
        if (!meta || !text) return;
        if (meta.textContent !== text) meta.textContent = text;
        const tip = tokTip(s);
        if (meta.title !== tip) meta.title = tip;
      });
      return;
    }
    box.dataset.key = shape;
    const lead = session.name || 'this agent';

    // Header names the parent, so "Flint" reads as Wren's sub-agent, not a peer; each row hangs off
    // the rail with a branch tick (CSS).
    const working = live
      ? p.subs.filter(s => s.status === 'running' || s.status === 'starting').length
      : 0;
    const head = el('div', 't-head', 'Sub-agents of ');
    head.append(el('b', '', lead), working ? ' · ' + working + ' working' : '');
    const parts = [head];
    {
      const list = el('ol', 't-subs');
      p.subs.forEach(s => {
        const item = el('li', 't-sub' + (open.has(s.key) ? ' open' : ''));
        item.dataset.status =
          live || s.status === 'done' || s.status === 'failed' ? s.status : 'failed';
        item.dataset.key = s.key;
        const row = el('button', 't-row');
        row.type = 'button';
        row.title =
          'Sub-agent of ' +
          lead +
          ', started by it for part of its task. Click to show the task and output.';
        const label = el('span', 't-label'),
          alias = aliasFor(s);
        if (alias) label.append(el('b', '', alias), ' · ');
        label.append(s.description || s.type || 'Sub-agent');
        label.title =
          (alias ? alias + ' · ' : '') +
          'sub-agent of ' +
          lead +
          (s.description ? ' · ' + s.description : '');
        const meta = el('small', '', metaText(s));
        meta.title = tokTip(s);
        row.append(el('i'), label, meta);
        const go = el('button', 't-go');
        go.type = 'button';
        go.dataset.pane = session.paneId;
        go.title = 'Open ' + (alias || 'this sub-agent') + ' beside its lead’s thread';
        go.setAttribute('aria-label', go.title);
        go.append(GO_ICON.content.firstChild.cloneNode(true));
        item.append(row, go);
        const detail = el('div', 't-detail');
        detail.hidden = !open.has(s.key);
        if (open.has(s.key))
          [
            ['TASK FROM THE LEAD', s.prompt],
            [
              'OUTPUT',
              s.result ||
                (s.status === 'done'
                  ? 'No output returned.'
                  : s.tools
                    ? s.tools + ' tool call' + (s.tools > 1 ? 's' : '') + ' so far'
                    : 'Nothing yet'),
            ],
          ].forEach(([label, text]) => {
            if (!text) return;
            const block = el('div'),
              pre = el('pre', '', text);
            pre.dataset.k = s.key + ':' + label;
            block.append(el('small', '', label), pre);
            detail.append(block);
          });
        item.append(detail);
        list.append(item);
      });
      parts.push(list);
    }

    // A rebuild must not reset a scrolled task/output box.
    const scrolled = new Map(
      [...box.querySelectorAll('pre[data-k]')]
        .filter(x => x.scrollTop)
        .map(x => [x.dataset.k, x.scrollTop])
    );
    box.replaceChildren(...parts);
    scrolled.forEach((top, k) => {
      const pre = box.querySelector('pre[data-k="' + CSS.escape(k) + '"]');
      if (pre) pre.scrollTop = top;
    });
  }

  // "Go to this sub-agent": a sub-agent has no thread of its own, so its lead's thread opens with
  // the side column on Helpers and that helper chosen (123). The Threads page itself when the lead
  // has no thread (its panel was closed).
  function openHelper(paneId, subKey) {
    if (!window.TnaiThreads?.show?.(paneId)) {
      window.TnaiThreads?.open?.();
      return;
    }
    const helpers = window.TnaiThreadHelpers;
    const sub = (window.TnaiTeam?.get?.(paneId)?.subs || []).find(one => one.key === subKey);

    // 123 knows a helper by its tool call's id where it has one.
    const helperKey = String(sub?.toolUseId || subKey || '');
    if (!helpers || !helperKey) return;
    if (helpers.state().pane === paneId) {
      helpers.open(helperKey);
      return;
    }

    // The thread was not the open one: 123 follows it once the thread view has drawn it.
    window.addEventListener(
      'tnai:thread-view',
      drawn => {
        if (drawn.detail?.paneId === paneId) helpers.open(helperKey);
      },
      { once: true }
    );
  }

  document.addEventListener('click', event => {
    const go = event.target.closest('.tnai-card-team .t-go');
    if (go) {
      event.stopPropagation();
      openHelper(go.dataset.pane, go.parentElement.dataset.key);
      return;
    }
    const row = event.target.closest('.tnai-card-team .t-row');
    if (!row) return;
    const key = row.parentElement.dataset.key;
    open.has(key) ? open.delete(key) : open.add(key);
    changed();
  });

  window.TnaiTeam = {
    paint,
    whenReady,
    startLead,
    // Names already shown on in-panel sub-agents: a new panel never takes one of them (21 pick).
    aliases() {
      const out = [];
      for (const p of panes.values()) p.subs.forEach(s => s.alias && out.push(s.alias));
      return out;
    },
    // Claude Code is mid-turn (between its prompt and Stop hooks); the composer (11) routes new
    // tasks around a busy lead.
    busy: paneId => !!panes.get(paneId)?.busy,
    // Its sub-agents still open (hooks): fg = foreground Agent calls the lead is blocked on, bg =
    // background ones (10: "Waiting on agents").
    open(paneId) {
      const o = { fg: 0, bg: 0 };
      for (const s of panes.get(paneId)?.subs || [])
        if (s.status === 'running' || s.status === 'starting') o[s.background ? 'bg' : 'fg']++;
      return o;
    },
    // Background tasks it started that are still running (bg-start until their hand-back): 10
    // "Working in background", 11 the card's Now line.
    background: paneId => (panes.get(paneId)?.bg || []).map(b => ({ ...b })),
    // Developer self-test only: how long a finished sub-agent stays visible (ms).
    set retireAfter(ms) {
      retireAfter = ms;
    },
    get retireAfter() {
      return retireAfter;
    },
    // The user's Close on a sub-agent stuck "Starting" (Agents page, 25): Claude Code never
    // reported it started, so nothing runs behind it.
    dismiss(paneId, key) {
      const p = panes.get(paneId),
        s = p?.subs.find(x => x.key === key);
      if (!s || s.status !== 'starting') return false;
      p.subs.splice(p.subs.indexOf(s), 1);
      open.delete(key);
      changed();
      return true;
    },
    state: paneId => {
      const p = panes.get(paneId);
      return p ? JSON.parse(JSON.stringify(p)) : null;
    },
    // Read-only copy for the Agents page (25): the pane's task, lead tool, and sub-agents with
    // their names (alias).
    get(paneId) {
      const p = panes.get(paneId);
      if (!p) return null;
      const copy = JSON.parse(JSON.stringify(p));
      copy.subs.forEach((s, i) => {
        s.alias = aliasFor(p.subs[i]) || '';
      });
      return copy;
    },
    onChange(fn) {
      const h = () => fn();
      window.addEventListener('tnai:team-changed', h);
      return () => window.removeEventListener('tnai:team-changed', h);
    },
  };
})();
