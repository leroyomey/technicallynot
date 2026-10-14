/*
 * * Technically Not · 88-agent-teams — Team mode UI: the user groups separately started agents into
 * a
 * * team that shares file locks (desktop/agent-teams.js). Entry: the "Team" row of a thread's own
 * * "..." menu (137-thread-more.js calls `TnaiAgentTeams.open`; the old Agents and history page's
 * * Team button went with that page, 2026-10-12) opens a dialog in the shared dialog look (01:
 * .tnai-ws-close-*) listing the other agents in the same
 * * project with a checkbox each; Save sets the team (none checked = leave). Badge: a "Team" chip
 * on
 * * the agent's Overview card (11 asks `TnaiAgentTeams.chip`). State only from main's
 * `teams:changed`
 * * push. Desktop only. Offer: one composer prompt @mentioning 2+ agents of one project that aren't
 * * already one team (11 asks `offer`) opens the same dialog with them checked; Cancel remembers
 * that
 * * group for this session, so it is asked once. Only the user's Save makes a team.
 */
(function () {
  const native = window.tnaiNative;
  if (!native?.teams || !window.TnaiAgents) return;
  let teams = []; // [{ id, panes: [paneId] }]

  // groups the user said no to (sorted panel ids), asked once per session
  const declined = new Set();

  const sessions = () => window.TnaiAgents.sessions?.() || [];
  const nameOf = paneId => sessions().find(s => s.paneId === paneId)?.name || paneId;
  const mates = paneId =>
    (teams.find(t => t.panes.includes(paneId))?.panes || []).filter(p => p !== paneId);
  const projectOf = paneId =>
    (window.TnaiMesh?.state?.() || []).find(m => m.paneId === paneId)?.project || '';

  function apply(state) {
    teams = Array.isArray(state?.teams) ? state.teams : [];
    window.TnaiAgents.repaint?.(); // cards repaint their chips (11)

    // the thread list (119) and a thread's menu (137) read the teams again
    window.dispatchEvent(new CustomEvent('tnai:teams-changed'));
  }

  // ---------- dialog ----------
  function openDialog(paneId, opts = {}) {
    const project = projectOf(paneId);
    const peers = (window.TnaiMesh?.state?.() || []).filter(
      m => m.paneId !== paneId && m.project === project
    );
    const current = new Set(mates(paneId)),
      preset = new Set(opts.preset || current);
    const overlay = document.createElement('div');
    overlay.className = 'tnai-ws-close-overlay';
    overlay.innerHTML =
      '<section class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiTeamTitle" aria-describedby="tnaiTeamBody"><h2 id="tnaiTeamTitle"></h2><p id="tnaiTeamBody"></p><div class="set-card" style="margin-top:14px"></div><div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel" data-choice="leave" hidden>Leave team</button><button type="button" class="tnai-ws-close-cancel" data-choice="cancel">Cancel</button><button type="button" class="tnai-ws-close-confirm" data-choice="save">Save team</button></div></section>';
    overlay.querySelector('h2').textContent = 'Team for ' + nameOf(paneId);
    overlay.querySelector('p').textContent =
      (opts.intro || '') +
      (peers.length
        ? 'Agents on a team share file locks, so they can edit the same files instead of blocking each other. Each one is told who its teammates are and to split files with tnai send. A whole-file rewrite stays exclusive for 2 minutes. The team ends when you uncheck everyone or the panels close.'
        : 'No other agent is running in this project yet. Start another agent, then group them here.');
    const list = overlay.querySelector('.set-card');
    list.hidden = !peers.length;
    for (const m of peers) {
      const row = document.createElement('label');
      row.className = 'set-row';
      const text = document.createElement('span');
      text.className = 'set-text';
      const b = document.createElement('b');
      b.textContent = nameOf(m.paneId);
      const small = document.createElement('small');
      const other = mates(m.paneId).filter(p => p !== paneId);
      small.textContent =
        m.provider +
        (other.length && !current.has(m.paneId)
          ? ' · on a team with ' + other.map(nameOf).join(', ') + ' (moves to this one)'
          : '');
      text.append(b, small);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = m.paneId;
      box.checked = preset.has(m.paneId);
      box.setAttribute('aria-label', 'Team up with ' + nameOf(m.paneId));
      row.append(text, box);
      list.append(row);
    }
    const close = () => {
      overlay.remove();
      window.removeEventListener('keydown', onKey, true);
    };
    const cancel = () => {
      opts.onCancel?.();
      close();
    };

    async function save(leave) {
      const picked = leave ? [] : [...list.querySelectorAll('input:checked')].map(i => i.value);
      close();
      try {
        const r = await native.teams.set(paneId, picked);
        if (!r?.ok) throw new Error(r?.error || 'refused');
      } catch (e) {
        window.toast?.('Team not saved: ' + (e?.message || e));
        return;
      }
      window.toast?.(
        picked.length
          ? nameOf(paneId) + ' is on a team with ' + picked.map(nameOf).join(', ') + '.'
          : nameOf(paneId) + ' is off its team.'
      );
    }
    overlay.addEventListener('click', event => {
      const choice = event.target.closest('[data-choice]')?.dataset.choice;
      if (choice === 'save') save();
      else if (choice === 'leave') save(true);
      else if (choice === 'cancel' || event.target === overlay) cancel();
    });

    function onKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    }
    window.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (list.querySelector('input') || overlay.querySelector('.tnai-ws-close-confirm')).focus();
    const saveBtn = overlay.querySelector('[data-choice="save"]');
    saveBtn.hidden = !peers.length && !current.size;

    // on a team: one click takes this agent out of it
    overlay.querySelector('[data-choice="leave"]').hidden = !current.size;
  }

  // The Team chip on an Overview grid panel opens the dialog (change the team or leave it).
  document.addEventListener('click', event => {
    const chip = event.target.closest?.('.tnai-card .c-chips>span');
    const id = chip?.textContent === 'Team' ? chip.closest('.tnai-card').dataset.pane : '';
    if (id && mates(id).length) {
      event.stopPropagation();
      openDialog(id);
    }
  });

  native.teams.on(apply);
  native.teams
    .state()
    .then(apply)
    .catch(() => {});

  window.TnaiAgentTeams = {
    // [text, tooltip] for the Overview card's chip row (11), or null when the agent is on no team.
    chip(paneId) {
      const m = mates(paneId);
      if (!m.length) return null;
      return [
        'Team',
        'On a team with ' +
          m.map(nameOf).join(', ') +
          ': they share file locks and split files with tnai send. Click to change the team or leave it.',
      ];
    },
    // 11: a prompt just went to these panels (@mentions). Offer to team them up when 2+ are agents
    // of one project and not already one team.
    offer(paneIds) {
      const ids = [...new Set(paneIds || [])].filter(id => {
        const s = sessions().find(x => x.paneId === id);
        return s && s.agent !== 'Terminal' && projectOf(id);
      });
      if (ids.length < 2 || new Set(ids.map(projectOf)).size > 1) return false;
      const key = ids.slice().sort().join('|');
      if (declined.has(key) || document.querySelector('[aria-labelledby="tnaiTeamTitle"]'))
        return false;
      const t = teams.find(x => x.panes.includes(ids[0]));
      if (t && ids.every(id => t.panes.includes(id))) return false;
      const [first, ...rest] = ids;
      openDialog(first, {
        preset: [...new Set([...mates(first), ...rest])],
        onCancel: () => declined.add(key),
        intro: 'You sent one prompt to ' + ids.map(nameOf).join(' and ') + '. Team them up? ',
      });
      return true;
    },
    mates,
    open: openDialog,
    state: () => teams,
  };
})();
