// Technically Not · 04-terminal-panes.js — Terminal page and panes: create, layout grid, prototype
// run output (tnai.terminals.v1)

(() => {
  /* The one pane limit per terminal workspace (Terminal page, Overview tabs, every path that opens a pane) and the message when it is reached. */ const PANE_LIMIT = 12,
    paneFullMessage =
      'This workspace has ' + PANE_LIMIT + ' threads. Create another workspace to continue.';
  window.TnaiPaneLimit = {
    max: PANE_LIMIT,
    message: paneFullMessage,
    count: ws =>
      document.querySelectorAll(
        '.terminal-pane[data-workspace-id="' +
          CSS.escape(ws || window.TnaiActiveTerminalWorkspaceId || 'workspace-1') +
          '"]'
      ).length,
    full: ws =>
      window.TnaiPaneLimit.count(ws) >= PANE_LIMIT &&
      !window.TnaiTerminalWorkspaces?.canOverflow?.(),
    /* a full workspace overflows into a new one (07) unless workspaces can't be added */ makeRoom:
      () =>
        window.TnaiPaneLimit.count() < PANE_LIMIT || !!window.TnaiTerminalWorkspaces?.overflow?.(),
  };
  const layout = document.querySelector('.layout'),
    view = document.getElementById('terminalView'),
    content = view?.querySelector('.terminal-content'),
    sessions = view?.querySelector('.terminal-sessions'),
    sampleOutput = document.getElementById('terminalOutput'),
    primaryInput = view?.querySelector('.terminal-input');
  if (!layout || !view || !content || !sampleOutput || !primaryInput) return;
  const style = document.createElement('style');
  style.textContent = `.layout.terminal-mode>.workspace{display:grid!important;grid-template-rows:minmax(0,1fr)!important;min-width:0!important;min-height:0!important}.layout.terminal-mode .terminal-view{display:grid!important;grid-template-rows:54px minmax(0,1fr)!important;grid-row:1!important;grid-column:1!important;min-width:0;min-height:0;padding:0 14px 12px!important;gap:0}.layout.terminal-mode .terminal-toolbar{height:54px;padding:0 2px}.layout.terminal-mode .terminal-sessions,.layout.terminal-mode .terminal-sideinfo,.layout.terminal-mode .dock-zone{display:none!important}.layout.terminal-mode .terminal-content.terminal-grid{display:grid!important;grid-template-columns:repeat(var(--term-cols,1),minmax(0,1fr))!important;grid-template-rows:repeat(var(--term-rows,1),minmax(0,1fr))!important;align-content:stretch;gap:10px;padding:0;border:0;background:transparent;overflow:auto;min-width:0;min-height:0}.terminal-pane{position:relative;display:grid;grid-template-rows:37px minmax(0,1fr) 42px;min-width:0;min-height:0;overflow:hidden;border:1px solid var(--pg-line);border-radius:8px;background:var(--pg-panel);box-shadow:none;view-transition-name:var(--pane-transition)}.terminal-pane-head{display:flex;align-items:center;gap:8px;padding:0 10px;border-bottom:1px solid var(--pg-line);background:var(--pg-panel);cursor:grab;user-select:none}.terminal-pane-head:active{cursor:grabbing}.terminal-pane-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 10px var(--pg-sans);color:var(--pg-text-2)}.terminal-agent-bind{flex:none;max-width:108px;height:23px;border:1px solid var(--pg-line);border-radius:4px;background:var(--pg-panel);color:var(--pg-text-2);font:8px var(--pg-sans)}.terminal-pane-state{display:flex;align-items:center;gap:5px;margin-left:auto;color:var(--pg-text-3);font:8px var(--pg-sans);white-space:nowrap}.terminal-pane-state i{width:6px;height:6px;border-radius:50%;background:var(--pg-idle)}.terminal-pane[data-state=working] .terminal-pane-state i{background:var(--pg-work);box-shadow:none}.terminal-pane[data-state=error] .terminal-pane-state i{background:var(--pg-err);box-shadow:none}.terminal-pane-tools{display:flex;gap:4px}.terminal-pane-tools button{box-sizing:border-box;width:24px;height:24px;padding:0;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--pg-text-3);cursor:pointer}.terminal-pane-tools button:hover{border-color:var(--pg-line-2);background:var(--pg-panel-2)}.terminal-pane>.terminal-output{min-height:0;padding:13px 15px;font-size:var(--terminal-font,13px);line-height:1.65;overflow:auto}.terminal-pane .terminal-input{height:36px;min-width:0;margin:0 8px 7px;padding:0 8px}.terminal-pane .terminal-input input{min-width:0;font-size:10px}.terminal-pane .terminal-input button{height:26px;font-size:9px}.terminal-pane-count{color:var(--pg-text-3);font:9px var(--pg-sans)}.terminal-pane-drop{outline:2px solid var(--pg-accent);outline-offset:-3px}.terminal-route{display:none;flex:none;height:30px;max-width:160px;border:1px solid var(--pg-line);border-radius:5px;background:var(--pg-panel);color:var(--pg-text-2);padding:0 6px;font:9px var(--pg-sans)}.layout.terminal-mode~.composer .terminal-route{display:block}.terminal-mode .terminal-route{display:block}.terminal-route-note{color:var(--pg-text-3);font:8px var(--pg-sans)}@media(max-width:1120px){.layout.terminal-mode .terminal-tools .terminal-sample-label{display:none}.layout.terminal-mode .terminal-pane-state{display:none}}`;
  document.head.append(style);
  const oldAdd = view.querySelector('#newTerminalSession');
  if (oldAdd) oldAdd.hidden = true;
  const toolbar = view.querySelector('.terminal-tools');
  if (!toolbar) return;
  const count = document.createElement('span');
  count.className = 'terminal-pane-count';
  count.id = 'terminalPaneCount';
  const add = document.createElement('button');
  add.className = 'start-agent-btn';
  add.id = 'newTerminalWindow';
  add.type = 'button';
  add.textContent = '＋ New terminal';
  toolbar.insertBefore(add, toolbar.querySelector('#openRuntimeLauncher'));
  toolbar.append(count);
  if (sessions) sessions.hidden = true;
  const info = content.querySelector('.terminal-sideinfo');
  info?.remove();
  content.classList.add('terminal-grid');
  content.replaceChildren();
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]');
  } catch {}
  if (!Array.isArray(saved)) saved = [];
  let serial = Math.max(1, ...saved.map((x, i) => Number(x.serial) || i + 1));
  const panes = [];

  function save() {
    try {
      localStorage.setItem(
        'tnai.terminals.v1',
        JSON.stringify(
          panes
            .slice()
            .sort((a, b) =>
              a.pane.isConnected && b.pane.isConnected
                ? a.pane.compareDocumentPosition(b.pane) & 4
                  ? -1
                  : 1
                : 0
            )
            .map(({ id, name, agent, serial, workspaceId }) => ({
              id,
              name,
              agent,
              serial,
              workspaceId: window.TnaiTerminalWorkspaceByPane?.[id] || workspaceId,
            }))
        )
      );
    } catch {}
  }

  function log(output, text, kind = 'dim') {
    const row = document.createElement('div');
    row.className = 'output-line ' + kind;
    row.textContent = text;
    output.append(row);
    output.scrollTop = output.scrollHeight;
  }

  function createPane(meta = {}, isMain = false) {
    const pane = document.createElement('article');
    pane.className = 'terminal-pane';
    pane.dataset.paneId =
      meta.id || 'terminal-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    pane.dataset.workspaceId =
      meta.workspaceId || window.TnaiActiveTerminalWorkspaceId || 'workspace-1';
    pane.dataset.state = 'idle';
    pane.style.viewTransitionName =
      'terminal-' + pane.dataset.paneId.replace(/[^a-zA-Z0-9_-]/g, '');
    const head = document.createElement('header');
    head.className = 'terminal-pane-head';
    const title = document.createElement('b');
    title.className = 'terminal-pane-title';
    title.textContent = meta.name || '';
    const state = document.createElement('span');
    state.className = 'terminal-pane-state';
    state.innerHTML = '<i></i><span>Ready</span>';
    const tools = document.createElement('div');
    tools.className = 'terminal-pane-tools';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.title = 'Clear output';
    clear.textContent = '⌫';
    tools.append(clear);
    const close = document.createElement('button');
    close.type = 'button';
    close.title = 'Close terminal';
    close.textContent = '×';
    tools.append(close);
    const agentSelect = document.createElement('select');
    agentSelect.className = 'terminal-agent-bind';
    agentSelect.setAttribute('aria-label', 'Assign terminal to an agent');
    agentSelect.innerHTML = '<option value="">Shared shell</option>';
    (window.TnaiAgentTasks || []).forEach(t => {
      const o = document.createElement('option');
      o.value = t.agentName;
      o.textContent = t.agentName;
      agentSelect.append(o);
    });
    agentSelect.value = meta.agent || '';
    head.append(title, agentSelect, state, tools);
    let output;
    if (isMain) {
      output = sampleOutput;
      output.querySelectorAll('.output-line').forEach(row => (row.dataset.sample = 'true'));
    } else {
      output = document.createElement('div');
      output.className = 'terminal-output';
      output.tabIndex = 0;
      const metaRow = document.createElement('div');
      metaRow.className = 'output-meta';
      const metaLabel = document.createElement('span');
      metaLabel.textContent = 'Terminal ready · no process running';
      const sampleLabel = document.createElement('span');
      sampleLabel.textContent = 'Waiting';
      metaRow.append(metaLabel, sampleLabel);
      output.append(metaRow);
      const prompt = document.createElement('div');
      prompt.className = 'output-line dim';
      prompt.textContent = '$';
      output.append(prompt);
    }
    if (!isMain) {
      const paneSerial = Number(meta.serial);
      if (Number.isFinite(paneSerial) && paneSerial > 0) serial = Math.max(serial, paneSerial);
      else serial++;
      if (!meta.name) title.textContent = '';
    }
    if (meta.autoName) pane.dataset.autoName = 'true';
    const input = isMain ? primaryInput : document.createElement('div');
    if (!isMain) {
      input.className = 'terminal-input';
      const prompt = document.createElement('span');
      prompt.className = 'input-prompt';
      prompt.textContent = '$';
      const text = document.createElement('input');
      text.placeholder = 'Type a command…';
      text.setAttribute('aria-label', 'Terminal command');
      const run = document.createElement('button');
      run.type = 'button';
      run.textContent = 'Run ↵';
      run.onclick = () => runInPane(pane, output, text);
      text.addEventListener('keydown', e => {
        if (e.key === 'Enter') run.click();
      });
      input.append(prompt, text, run);
    } else {
      input.remove();
      input.querySelector('input').placeholder = 'Type a command in Main terminal…';
      input.querySelector('input').setAttribute('aria-label', 'Command for Main terminal');
    }
    pane.append(head, output, input);
    content.append(pane);
    const record = {
      id: pane.dataset.paneId,
      name: title.textContent,
      agent: meta.agent || '',
      serial: isMain ? 1 : serial,
      workspaceId: pane.dataset.workspaceId,
      pane,
      output,
    };
    window.TnaiTerminalPaneRecords = window.TnaiTerminalPaneRecords || [];
    window.TnaiTerminalPaneRecords.push(record);
    agentSelect.onchange = () => {
      record.agent = agentSelect.value;
      save();
    };
    panes.push(record);
    clear.onclick = () => {
      output.replaceChildren();
      const m = document.createElement('div');
      m.className = 'output-meta';
      m.textContent = 'Output cleared';
      output.append(m);
    };
    close.onclick = () => {
      const workspaceId =
        window.TnaiTerminalWorkspaceByPane?.[record.id] || record.workspaceId || 'workspace-1';
      pane.remove();
      const index = panes.indexOf(record);
      if (index >= 0) panes.splice(index, 1);
      window.TnaiTerminalPaneRecords = (window.TnaiTerminalPaneRecords || []).filter(
        item => item !== record
      );
      if (window.TnaiTerminalWorkspaceByPane) delete window.TnaiTerminalWorkspaceByPane[record.id];
      try {
        const context = JSON.parse(localStorage.getItem('tnai.terminal-context.v1') || '{}');
        delete context[record.id];
        localStorage.setItem('tnai.terminal-context.v1', JSON.stringify(context));
      } catch {}
      save();
      layoutGrid();
      window.dispatchEvent(
        new CustomEvent('tnai:terminal-pane-closed', { detail: { paneId: record.id, workspaceId } })
      );
    };
    pane.addEventListener('dragover', e => {
      e.preventDefault();
      pane.classList.add('terminal-pane-drop');
    });
    pane.addEventListener('dragleave', () => pane.classList.remove('terminal-pane-drop'));
    pane.addEventListener('drop', e => {
      e.preventDefault();
      pane.classList.remove('terminal-pane-drop');
      const id = e.dataTransfer.getData('text/plain'),
        dragged = panes.find(x => x.id === id);
      if (dragged && dragged !== record) {
        content.insertBefore(dragged.pane, pane);
        save();
      }
    });
    head.draggable = true;
    head.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', record.id));
    return record;
  }

  let rowsFrame = 0;

  function layoutGrid() {
    const n = panes.length,
      w = content.clientWidth || innerWidth,
      h = content.clientHeight || innerHeight,
      aspect = w / Math.max(1, h);
    let best = { cols: 1, score: Infinity };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols),
        cellAspect = (aspect * rows) / cols,
        score = Math.abs(Math.log(cellAspect / 1.45)) + (cols * rows - n) * 0.11;
      if (score < best.score) best = { cols, score };
    }

    /* Written only on change: this runs on every window resize event, and a rewritten custom property restyles every terminal under it before the next layout read (measured 2026-10-05, desktop test resize-drag). */ const put =
        (k, v) => {
          v = String(v);
          if (content.style.getPropertyValue(k) !== v) content.style.setProperty(k, v);
        },
      label = n + ' ' + (n === 1 ? 'terminal' : 'terminals');
    put('--term-cols', best.cols);
    put('--term-rows', Math.ceil(n / best.cols));
    if (count.textContent !== label) count.textContent = label;

    // One waiting frame at most: a minimized window runs none, and every pane opened or closed
    // meanwhile added one more that waited until the window was shown (test thread-stream-leak).
    if (rowsFrame) return;
    rowsFrame = requestAnimationFrame(() => {
      rowsFrame = 0;
      const cols = Number(content.style.getPropertyValue('--term-cols')) || 1;
      put('--term-rows', Math.ceil(panes.length / cols));
    });
  }

  function runInPane(pane, output, input) {
    const command = input.value.trim();
    if (!command) return;
    log(output, '$ ' + command, 'dim');
    if (
      /^(build|make|create|change|add|remove|fix|update|refactor|why|how|implement|design|please)\b/i.test(
        command
      )
    ) {
      const composer = document.getElementById('prompt');
      composer.value = command;
      composer.focus();
      log(output, 'Recognized as a task request and moved to the AI composer.', 'info');
    } else {
      log(output, 'Queued · connect a project runtime to execute terminal commands.', 'info');
    }
    pane.dataset.state = 'idle';
    const status = pane.querySelector('.terminal-pane-state span');
    if (status) status.textContent = 'Ready';
    input.value = '';
  }
  let main = null;
  const hasSavedTerminalState = localStorage.getItem('tnai.terminals.v1') !== null;

  // 130 reads this: the one panel of a fresh settings folder is new, not left over.
  window.TnaiPaneLimit.firstRun = !hasSavedTerminalState;
  if (!hasSavedTerminalState) main = createPane({ id: 'terminal-main', name: '', serial: 1 }, true);
  else
    saved.forEach(meta => {
      const savedWorkspace = meta.workspaceId || 'workspace-1';
      const countIn = id =>
        panes.filter(p => (window.TnaiTerminalWorkspaceByPane?.[p.id] || p.workspaceId) === id)
          .length;

      // A workspace saved with more panels than the limit keeps every one: the extras go to a
      // further workspace, which 07 adds and files under the project its panels work in.
      let workspaceId = savedWorkspace;
      for (let extra = 1; countIn(workspaceId) >= PANE_LIMIT; extra++)
        workspaceId = savedWorkspace + '-more-' + extra;
      const created = createPane({ ...meta, workspaceId }, meta.id === 'terminal-main');
      if (meta.id === 'terminal-main') main = created;
    });
  if (!main) main = panes[0] || null;

  // An empty slot: a pane in that workspace with no connection chosen yet. Taking one reserves it
  // for 15s so two agents starting at once never get the same pane.
  const wsOf = p => window.TnaiTerminalWorkspaceByPane?.[p.id] || p.workspaceId;

  function takeEmpty(ws) {
    ws = ws || window.TnaiActiveTerminalWorkspaceId || 'workspace-1';
    const hit = panes.find(
      p =>
        wsOf(p) === ws &&
        p.pane.isConnected &&
        Date.now() - (Number(p.pane.dataset.reservedAt) || 0) > 15000 &&
        (s => s && !s.value)(p.pane.querySelector('.terminal-provider-select'))
    );
    if (hit) hit.pane.dataset.reservedAt = Date.now();
    return hit || null;
  }
  window.TnaiTakeEmptyPane = takeEmpty;

  function newPane(o) {
    /* o: {workspaceId, name, quiet, reuseEmpty} adds the pane to that (maybe hidden) workspace without switching to it (43: sub-agent panes). reuseEmpty: a new agent fills an empty pane already there before a pane is added; an unnamed one takes o.name. */ o =
      o && typeof o === 'object' ? o : {};
    let ws = o.workspaceId || window.TnaiActiveTerminalWorkspaceId || 'workspace-1';
    const empty = o.reuseEmpty && takeEmpty(ws);
    if (empty) {
      const title = empty.pane.querySelector('.terminal-pane-title');
      if (o.name && title && !title.textContent) {
        title.textContent = empty.name = o.name;
        save();
        window.dispatchEvent(
          new CustomEvent('tnai:terminal-pane-renamed', {
            detail: { paneId: empty.id, name: o.name, previous: '' },
          })
        );
      }
      return empty;
    }
    if (
      panes.filter(p => (window.TnaiTerminalWorkspaceByPane?.[p.id] || p.workspaceId) === ws)
        .length >= PANE_LIMIT
    ) {
      /* full: continue in a new workspace, shown only when the full one was. o.noOverflow (47: a start asked by a paired computer): never a new workspace, so no pane. */ const next =
        o.noOverflow
          ? null
          : window.TnaiTerminalWorkspaces?.overflow?.({
              activate: ws === (window.TnaiActiveTerminalWorkspaceId || 'workspace-1'),
            });
      if (!next) {
        if (!o.quiet) toast(paneFullMessage);
        return null;
      }
      ws = next;
    }
    serial++;
    const record = createPane({ name: o.name || '', serial, workspaceId: ws }, false);
    if (o.quiet) record.pane.dataset.reservedAt = Date.now();
    layoutGrid();
    save();
    return record;
  }
  add.onclick = () => {
    newPane();
  };
  window.TnaiNewTerminalPane = newPane;
  document
    .querySelectorAll('.side-item[data-view=terminal]')
    .forEach(item => item.addEventListener('click', () => setTimeout(layoutGrid, 0)));

  // the old page-wide command bar: only a pane may keep it
  if (!primaryInput.closest('.terminal-pane')) primaryInput.remove();
  const runButton = document.getElementById('runCommand');
  if (runButton)
    runButton.onclick = () => {
      const target = main || panes[0];
      if (!target) return;
      const field =
        target.pane.querySelector('.terminal-input input') || primaryInput.querySelector('input');
      if (field) runInPane(target.pane, target.output, field);
    };
  layoutGrid();
  window.addEventListener('resize', layoutGrid);
  save();
})();
