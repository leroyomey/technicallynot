/*
 * Technically Not · 106-background-shells.js — Desktop only: the background commands an agent
 * started (a shells count on the header, showing what each shell is
 * doing). A terminal panel whose agent has background tasks running (19 `TnaiTeam.background`,
 * from Claude Code's hooks: Bash / PowerShell run in the background, Monitor, Workflow) gets a
 * small "N shells" chip in its header, left of the status. Clicking it lists each one: the agent's
 * own one-line summary of the task, the command, how long it has run, and its newest output line
 * (read from Claude Code's output file by the desktop process, `agentEvents.bgTail`, only while the
 * list is open). There is no percent: a command reports none, so none is invented. Claude Code
 * only; other CLIs report no background tasks, so they show no chip. Look:
 * src/styles/11-terminal-purple.css. `window.TnaiBgShells` (`count`, `open`, `close`). Test
 * `background-shells`.
 */
(() => {
  const team = () => window.TnaiTeam,
    native = window.tnaiNative;
  if (!native?.agentEvents) return;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const ago = ms => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60
      ? s + ' s'
      : s < 3600
        ? Math.floor(s / 60) + ' min ' + (s % 60) + ' s'
        : Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
  };
  const list = paneId => team()?.background?.(paneId) || [];
  const KIND = { Bash: 'Shell', PowerShell: 'Shell', Monitor: 'Watcher', Workflow: 'Workflow' };

  let pop = null,
    popPane = '',
    timer = 0;
  const tails = new Map(); // task id -> { line, exit, bytes }

  function close() {
    clearInterval(timer);
    timer = 0;
    pop?.remove();
    pop = null;
    popPane = '';
    document
      .querySelectorAll('.tnai-bg-chip[aria-expanded=true]')
      .forEach(c => c.setAttribute('aria-expanded', 'false'));
  }

  function paintPop() {
    if (!pop) return;
    const tasks = list(popPane);
    if (!tasks.length) {
      close();
      return;
    }
    pop.replaceChildren(
      el('h4', '', 'Running in the background'),
      ...tasks.map(b => {
        const row = el('div', 'tnai-bg-row'),
          t = tails.get(b.taskId);
        const head = el('div', 'tnai-bg-head'),
          dot = el('i', 'bw-dot');
        dot.dataset.s = 'working';
        head.append(
          dot,
          el('b', '', b.label || KIND[b.tool] || 'Background task'),
          el('span', 'tnai-bg-time', ago(Date.now() - (b.startedAt || Date.now())))
        );
        row.append(head);
        if (b.detail) {
          const cmd = el('code', 'tnai-bg-cmd', b.detail);
          cmd.title = b.detail;
          row.append(cmd);
        }
        row.append(
          el(
            'div',
            'tnai-bg-out',
            t === undefined
              ? 'Reading its output…'
              : t === null
                ? (KIND[b.tool] || b.tool) + ' · no output file to read'
                : t.line
                  ? t.line
                  : 'No output yet'
          )
        );
        return row;
      })
    );
  }

  async function refresh() {
    for (const b of list(popPane)) {
      try {
        tails.set(b.taskId, await native.agentEvents.bgTail(b.taskId));
      } catch {
        tails.set(b.taskId, null);
      }
    }
    paintPop();
  }

  function open(paneId, chip) {
    const again = pop && popPane === paneId;
    close();
    if (again) return;
    popPane = paneId;
    pop = el('div', 'tnai-bg-pop');
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Background tasks');
    document.body.append(pop);
    chip?.setAttribute('aria-expanded', 'true');
    paintPop();
    const r = chip?.getBoundingClientRect();
    if (r) {
      pop.style.top = Math.round(r.bottom + 6) + 'px';
      pop.style.left =
        Math.round(Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))) + 'px';
    }
    refresh();
    timer = setInterval(refresh, 3000); // only while the list is open
  }
  document.addEventListener(
    'pointerdown',
    e => {
      if (pop && !e.target.closest('.tnai-bg-pop, .tnai-bg-chip')) close();
    },
    true
  );
  document.addEventListener('keydown', e => {
    if (pop && e.key === 'Escape') close();
  });

  // ---------- the chip in each panel header ----------
  function paintChips() {
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const id = pane.dataset.paneId,
        n = list(id).length,
        state = pane.querySelector('.terminal-pane-state');
      let chip = pane.querySelector('.tnai-bg-chip');
      if (!n || !state) {
        chip?.remove();
        if (popPane === id && !n) close();
        return;
      }
      if (!chip) {
        chip = el('button', 'tnai-bg-chip');
        chip.type = 'button';
        chip.setAttribute('aria-expanded', 'false');
        chip.addEventListener('pointerdown', e => e.stopPropagation());
        chip.addEventListener('click', e => {
          e.stopPropagation();
          open(id, chip);
        });
        state.before(chip);
      }
      const text = n + (n === 1 ? ' shell' : ' shells');
      if (chip.textContent !== text) chip.textContent = text;
      chip.title =
        'This agent has ' +
        n +
        ' background ' +
        (n === 1 ? 'task' : 'tasks') +
        ' running. Click to see what each one is doing.';
    });
    if (pop) paintPop();
  }
  let queued = 0;
  const schedule = () => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0;
        paintChips();
      });
  };
  window.addEventListener('tnai:team-changed', schedule);
  window.TnaiAgents?.onChange?.(schedule);
  window.addEventListener('tnai:terminal-pane-closed', schedule);
  schedule();

  window.TnaiBgShells = {
    count: paneId => list(paneId).length,
    open: paneId =>
      open(
        paneId,
        document.querySelector(
          '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"] .tnai-bg-chip'
        )
      ),
    close,
    paint: paintChips,
  };
})();
