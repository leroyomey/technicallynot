// Technically Not · 37-agent-mesh.js — Desktop only: agent CLIs started by hand in a terminal pane
// (claude / codex / cursor-agent typed into PowerShell) show as live agent sessions of that
// provider everywhere TnaiAgents.sessions() is read (Overview tree, Agents page, composer, hooks),
// and go back to a plain terminal when the CLI exits. Every agent session in the same open project
// is connected through the `tnai` command (desktop/agent-mesh.js); cards and the Agents page show
// "connected · N agents in this project". Push only (mesh:changed, TnaiAgents.onChange).
// window.TnaiMesh (state, peers).
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.mesh || !agents) return;

  const style = document.createElement('style');
  style.textContent = `
.tnai-mesh-note{display:block;margin-top:2px;overflow:hidden;color:#6f8a57;font:9px/1.3 var(--pg-sans);text-overflow:ellipsis;white-space:nowrap}
.tnai-mesh-note[data-alone]{color:#9aa093}
.tnai-live-sessions[data-density] .tnai-mesh-note{display:none}
`;
  document.head.append(style);

  let members = new Map(); // paneId -> { provider, project, hand, startedAt } from the desktop side
  let lastState = '',
    lastNames = '';

  // A hand-started CLI makes its terminal pane an agent session of that provider while it runs.
  const baseSessions = agents.sessions.bind(agents),
    baseSend = agents.send.bind(agents);
  const handOf = s => {
    const m = members.get(s.paneId);
    return m?.hand && s.agent === 'Terminal' && s.running ? m : null;
  };
  agents.sessions = () =>
    baseSessions().map(s => {
      const m = handOf(s);
      if (!m) return s;

      // PowerShell's own window title is not the agent's task; the CLI sets its own title once it
      // runs.
      return {
        ...s,
        agent: m.provider,
        shell: 'Terminal',
        startedByHand: true,
        startedAt: m.startedAt || s.startedAt,
        title:
          /powershell|^administrator:|^[a-z]:\\|^-?(zsh|bash|fish|sh)$|^[\w.-]+@[\w.-]+:|^[~/]/i.test(
            s.title || ''
          )
            ? ''
            : s.title,
      };
    });

  // Text for a hand-started agent goes in as one bracketed paste (like any agent pane), not as a
  // flattened shell line.
  agents.send = (paneId, text) => {
    const s = baseSessions().find(x => x.paneId === paneId);
    const m = s && handOf(s);
    return m ? baseSend(paneId, text, { paste: true, agent: m.provider }) : baseSend(paneId, text);
  };

  async function refresh() {
    let state;
    try {
      state = await native.mesh.state();
    } catch {
      return;
    }
    const key = JSON.stringify(state.panes);
    if (key === lastState) return;
    lastState = key;
    members = new Map(state.panes.map(p => [p.paneId, p]));
    agents.changed?.();
    paintNotes();
  }

  // The names and tasks the UI shows, so `tnai agents` and `tnai send NAME` match what the user
  // sees.
  function publishNames() {
    // offline: an agent pane with no process (left over from the last Technically Not session, or
    // stopped): `tnai agents` lists it and `tnai close` may close it. quietSince: when an idle
    // agent last printed (the cards' "Quiet N min"); 0 while working, so streaming output doesn't
    // republish the list.
    const list = agents.sessions().map(s => {
      const idle = s.running && s.status === 'waiting';
      return {
        paneId: s.paneId,
        name: s.name,
        task:
          window.TnaiLiveTasks?.title?.(s) ||
          window.TnaiLiveTasks?.get?.(s.paneId)?.text ||
          s.title ||
          '',
        agent: s.agent,
        offline: !s.running && s.agent !== 'Terminal' && s.mode !== 'login',
        idle,
        onAgents: s.status === 'waiting-agents',
        background: s.status === 'background',
        quietSince: idle ? s.lastOutputAt || 0 : 0,
        kept: !!(s.ownedByUser || s.customAgentId),
        cwd: s.cwd || '',
      };
    });
    const key = JSON.stringify(list);
    if (key !== lastNames) {
      lastNames = key;
      native.mesh.names(list).catch(() => {});
    }
  }

  const peers = paneId => {
    const m = members.get(paneId);
    return m?.project ? [...members.values()].filter(x => x.project === m.project).length : 0;
  };

  // Waits and links (desktop/agent-links.js, in mesh:state): "waiting on Bench" is a fact from the
  // tnai command; "working with Bench" is inferred from their messages. A waited-on agent that
  // needs the user says so, so the chain ends at the user: "waiting on Bench, which needs you".
  let peerNames = new Map(),
    peerNeeds = new Set(); // filled once per paint (sessions() is expensive)
  const linked = m => !!(m.waitsOn?.length || m.with?.length);
  const list = ids => {
    const n = ids.map(p => peerNames.get(p) || 'another agent');
    return n.slice(0, 2).join(', ') + (n.length > 2 ? ' +' + (n.length - 2) : '');
  };

  function linkText(m) {
    const parts = [];
    if (m.waitsOn?.length)
      parts.push(
        (m.ring ? 'waiting on each other: ' : 'waiting on ') +
          list(m.waitsOn) +
          (!m.ring && m.waitsOn.some(p => peerNeeds.has(p)) ? ', which needs you' : '')
      );
    if (m.with?.length) parts.push('working with ' + list(m.with));
    return parts.length ? parts.join(' · ') + ' · ' : '';
  }

  function noteText(paneId) {
    const m = members.get(paneId);
    if (!m) return null;
    const how = linkText(m) + (m.hand ? 'started by hand · ' : '');
    if (!m.project) return [how + 'not in an open project · not connected', true];
    const n = peers(paneId);
    return n > 1
      ? [how + 'connected · ' + n + ' agents in this project', false]
      : [how + 'connected · no other agents in this project yet', true];
  }

  function note(host, paneId) {
    if (!host) return;
    let el = host.querySelector(':scope > .tnai-mesh-note');
    const text = noteText(paneId);
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('small');
      el.className = 'tnai-mesh-note';
      host.append(el);
    }
    if (el.textContent !== text[0]) el.textContent = text[0];
    const title =
      (linked(members.get(paneId))
        ? 'Waiting on: it asked that agent a question and has no answer yet. Working with: they sent each other messages (inferred). Both end by themselves. '
        : '') +
      'Agents in the same project reach each other with the tnai command: tnai agents, tnai send NAME message, tnai read NAME';
    if (el.title !== title) el.title = title;
    el.toggleAttribute('data-alone', text[1]);
  }

  // Cards re-render; the note is re-applied from the data above after any change.
  let frame = 0;

  function paintNotes() {
    frame = 0;
    if ([...members.values()].some(linked)) {
      const all = agents.sessions();
      peerNames = new Map(all.map(s => [s.paneId, s.name]));
      peerNeeds = new Set(all.filter(s => s.status === 'needs-you').map(s => s.paneId));
    }
    document
      .querySelectorAll('.tnai-card[data-pane]')

      // under the task's Now line: the grid panel head keeps to name + "CLI · role"
      .forEach(card => note(card.querySelector('.agent-node-task'), card.dataset.pane));
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(paintNotes);
  };

  // Row redraws inside a terminal (.xterm, every frame while it streams) and the live activity
  // feed (53, a row per event) don't change the notes: skipped.
  const observer = new MutationObserver(list => {
    if (list.some(r => !r.target.closest?.('.xterm,.tnai-feed'))) schedule();
  });
  const cardsHost = document.getElementById('agentPage');
  if (cardsHost) observer.observe(cardsHost, { childList: true, subtree: true });

  native.mesh.onChange(refresh);
  let pending = 0;
  agents.onChange(() => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = 0;
      refresh();
      publishNames();
    }, 60);
  });
  window.addEventListener('tnai:terminal-pane-renamed', () => setTimeout(publishNames, 0));
  refresh();
  publishNames();

  window.TnaiMesh = {
    state: () => [...members.entries()].map(([paneId, m]) => ({ paneId, ...m })),
    peers,

    // The panels this agent asked a question with the tnai command and has no answer from yet
    // (desktop/agent-links.js). The thread list gives such a thread its own tone (119).
    waitsOn: paneId => members.get(paneId)?.waitsOn || [],
  };
})();
