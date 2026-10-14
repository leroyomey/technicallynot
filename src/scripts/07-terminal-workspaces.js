// Technically Not · 07-terminal-workspaces.js — Named terminal workspaces, 12-pane limit, grid fit,
// running counts (tnai.terminal-workspaces.v1)

(() => {
  const view = document.getElementById('terminalView'),
    content = view?.querySelector('.terminal-content'),
    addButton = document.getElementById('newTerminalWindow');
  if (!view || !content) return;
  const workspaceKey = 'tnai.terminal-workspaces.v1',
    paneKey = 'tnai.terminals.v1';
  let store;
  try {
    store = JSON.parse(localStorage.getItem(workspaceKey) || 'null');
  } catch {}
  if (!store || !Array.isArray(store.workspaces))
    store = { activeId: 'workspace-1', workspaces: [{ id: 'workspace-1', name: 'Workspace 1' }] };
  let paneMeta = [];
  try {
    paneMeta = JSON.parse(localStorage.getItem(paneKey) || '[]');
  } catch {}
  if (!Array.isArray(paneMeta)) paneMeta = [];
  const contextKey = 'tnai.terminal-context.v1';
  let context = {};
  try {
    context = JSON.parse(localStorage.getItem(contextKey) || '{}');
  } catch {}

  /* pane id → workspace id; made even with no panes at startup, or adoptNewPanes throws and new panes stay stuck below the grid */ window.TnaiTerminalWorkspaceByPane =
    window.TnaiTerminalWorkspaceByPane || {};
  const paneNodes = [...content.querySelectorAll('.terminal-pane')],
    metaById = new Map(paneMeta.map(item => [item.id, item]));
  for (const pane of paneNodes) {
    const id = pane.dataset.paneId,
      meta = metaById.get(id),
      workspaceId =
        pane.dataset.workspaceId || meta?.workspaceId || context[id]?.workspaceId || 'workspace-1';
    pane.dataset.workspaceId = workspaceId;
    window.TnaiTerminalWorkspaceByPane[id] = workspaceId;
    if (!store.workspaces.some(w => w.id === workspaceId))
      store.workspaces.push({
        id: workspaceId,
        name: 'Workspace ' + (store.workspaces.length + 1),
      });
  }
  if (!store.workspaces.length) store.workspaces = [{ id: 'workspace-1', name: 'Workspace 1' }];
  if (!store.workspaces.some(w => w.id === store.activeId)) store.activeId = store.workspaces[0].id;
  let activeId = store.activeId;
  window.TnaiActiveTerminalWorkspaceId = activeId;

  // Workspaces are per project: each records `project` (normalized folder path) and Terminal shows
  // only the open project's; other projects' panes keep running, hidden. null = not known yet
  // (legacy data, before the first resolve).
  const norm = p =>
    String(p || '')
      .replace(/\//g, '\\')
      .replace(/\\+$/, '')
      .toLowerCase();
  if (!store.active || typeof store.active !== 'object') store.active = {};
  let project = store.project ?? null;
  const visible = w => project === null || w.project === project,
    mine = () => store.workspaces.filter(visible);
  {
    const own = mine();
    if (own.length && !own.some(w => w.id === activeId)) {
      activeId = store.activeId = own[0].id;
      window.TnaiActiveTerminalWorkspaceId = activeId;
    }
  }
  const panesByWorkspace = new Map(),
    views = new Map(),
    toolbar = view.querySelector('.terminal-toolbar');
  for (const workspace of store.workspaces) {
    panesByWorkspace.set(workspace.id, []);
    const section = document.createElement('section');
    section.className = 'terminal-workspace-view';
    section.dataset.workspaceId = workspace.id;
    section.hidden = workspace.id !== activeId;
    const paneGrid = document.createElement('div');
    paneGrid.className = 'terminal-workspace-grid';
    section.append(paneGrid);
    content.append(section);
    views.set(workspace.id, { section, grid: paneGrid });
  }
  content.replaceChildren(...[...views.values()].map(x => x.section));
  const firstGrid = views.get(activeId)?.grid;
  for (const pane of paneNodes) {
    const id = pane.dataset.workspaceId;
    if (!views.has(id)) {
      const section = document.createElement('section');
      section.className = 'terminal-workspace-view';
      section.dataset.workspaceId = id;
      section.hidden = true;
      const paneGrid = document.createElement('div');
      paneGrid.className = 'terminal-workspace-grid';
      section.append(paneGrid);
      content.append(section);
      views.set(id, { section, grid: paneGrid });
      store.workspaces.push({ id, name: 'Workspace ' + (store.workspaces.length + 1) });
      panesByWorkspace.set(id, []);
    }
    views.get(id).grid.append(pane);
    panesByWorkspace.get(id).push(pane);
  }
  const workspaceBar = document.createElement('div');
  workspaceBar.className = 'terminal-workspaces';
  workspaceBar.setAttribute('aria-label', 'Terminal workspaces');
  const tabList = document.createElement('div');
  tabList.className = 'terminal-workspace-tabs';
  const addWorkspace = document.createElement('button');
  addWorkspace.type = 'button';
  addWorkspace.className = 'terminal-workspace-add';
  addWorkspace.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' Workspace';
  addWorkspace.title = 'Create a separate workspace for more terminal sessions';
  workspaceBar.append(tabList, addWorkspace);
  view.insertBefore(workspaceBar, content);
  toolbar?.querySelector('.terminal-pane-count')?.setAttribute('hidden', '');
  if (addButton) {
    addButton.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' Add connection';
    addButton.title = 'Choose an agent or shell to open in a terminal panel';
  }
  const style = document.createElement('style');
  style.textContent =
    '.layout.terminal-mode .terminal-view{grid-template-rows:42px 44px minmax(0,1fr)!important;min-height:0!important}.layout.terminal-mode .terminal-content.terminal-grid{display:block!important;overflow:hidden!important;min-height:0!important}.terminal-workspaces{display:flex;align-items:center;gap:8px;min-width:0;height:44px;padding:0 2px;border-bottom:1px solid var(--pg-line);background:var(--pg-panel-2)}.terminal-workspace-tabs{display:flex;align-items:center;gap:5px;flex:1;min-width:0;overflow-x:auto}.terminal-workspace-tab{display:flex;align-items:center;gap:10px;flex:none;height:32px;padding:0 10px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--pg-text-2);text-align:left;cursor:pointer}.terminal-workspace-tab.active{border-color:var(--pg-line);background:var(--pg-panel);color:var(--pg-text-2);box-shadow:none}.terminal-workspace-tab>span:first-child{font:600 10px var(--pg-sans);white-space:nowrap}.terminal-workspace-counts{display:flex;gap:8px;color:var(--pg-text-3);font:8px var(--pg-sans);white-space:nowrap}.terminal-workspace-counts .is-running{color:var(--pg-text-2)}.terminal-workspace-add{flex:none;box-sizing:border-box;height:30px;padding:0 10px;border:1px solid var(--pg-line);border-radius:7px;background:var(--pg-panel);color:var(--pg-text-2);font:11px var(--pg-sans);white-space:nowrap;cursor:pointer}.terminal-workspace-add:hover{background:var(--pg-line-2);border-color:var(--pg-line)}.terminal-workspace-view{width:100%;height:100%;min-width:0;min-height:0}.terminal-workspace-view[hidden]{display:none!important}.terminal-workspace-grid{display:grid;grid-template-columns:repeat(var(--workspace-cols,1),minmax(0,1fr));grid-template-rows:repeat(var(--workspace-rows,1),minmax(0,1fr));align-content:stretch;gap:10px;width:100%;height:100%;padding:0;overflow:auto;min-width:0;min-height:0}.terminal-workspace-empty{display:grid;place-content:center;justify-items:center;gap:9px;min-height:100%;padding:24px;text-align:center;color:var(--pg-text-3);font:10px/1.5 var(--pg-sans)}.terminal-workspace-empty b{color:var(--pg-text-2);font:600 13px var(--pg-sans)}.terminal-workspace-empty button{margin-top:4px;padding:8px 12px;border:1px solid var(--pg-line);border-radius:6px;background:var(--pg-panel);color:var(--pg-text-2);font:10px var(--pg-sans);cursor:pointer}.terminal-workspace-full{animation:workspace-attention 1.1s ease 2}@keyframes workspace-attention{50%{box-shadow:none}}.terminal-workspace-tab{padding-right:4px}.terminal-workspace-tab>button{display:grid;place-items:center;flex:none;width:24px;height:24px;margin-left:-6px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--pg-text-3);font:12px/1 var(--pg-sans);cursor:pointer;opacity:0}.terminal-workspace-tab>.terminal-workspace-rename{margin-right:-4px;font-size:11px}.terminal-workspace-tab.active>button,.terminal-workspace-tab:hover>button,.terminal-workspace-tab:focus-within>button{opacity:1}.terminal-workspace-tab>button:hover{background:var(--pg-line-2);color:var(--pg-text-2)}.terminal-workspace-tab>.terminal-workspace-close:hover{background:var(--pg-line-2);color:var(--pg-text-2)}.terminal-workspace-tab>button:focus-visible{opacity:1;outline:var(--pg-ring,2px) solid var(--pg-line);outline-offset:0}.terminal-workspace-tab:focus-visible,.terminal-workspace-add:focus-visible{outline:var(--pg-ring,2px) solid var(--pg-line-2);outline-offset:2px}.terminal-pane-count[hidden]{display:none!important}';
  document.head.append(style);

  function persistWorkspaces() {
    store.activeId = activeId;
    if (project !== null) {
      store.project = project;
      store.active[project] = activeId;
    }
    try {
      localStorage.setItem(workspaceKey, JSON.stringify(store));
    } catch {}
  }

  function persistPaneList() {
    const existing = new Map(paneMeta.map(item => [item.id, item])),
      all = [...views.entries()].flatMap(([workspaceId, item]) =>
        [...item.grid.querySelectorAll('.terminal-pane')].map(pane => {
          const id = pane.dataset.paneId,
            old = existing.get(id) || {},
            name = pane.querySelector('.terminal-pane-title')?.textContent || old.name;
          pane.dataset.workspaceId = workspaceId;
          window.TnaiTerminalWorkspaceByPane[id] = workspaceId;
          return { ...old, id, name, workspaceId };
        })
      );
    try {
      localStorage.setItem(paneKey, JSON.stringify(all));
    } catch {}
  }

  function panesFor(id) {
    return views.get(id) ? [...views.get(id).grid.querySelectorAll('.terminal-pane')] : [];
  }

  function fitGrid(id) {
    const paneGrid = views.get(id)?.grid;
    if (!paneGrid) return;
    if (window.TnaiTerminalGrid) return window.TnaiTerminalGrid.fit(paneGrid);
    const n = panesFor(id).length;
    if (!n) {
      paneGrid.style.setProperty('--workspace-cols', 1);
      paneGrid.style.setProperty('--workspace-rows', 1);
      return;
    }
    const w = paneGrid.clientWidth || innerWidth,
      h = paneGrid.clientHeight || innerHeight,
      aspect = w / Math.max(1, h);
    let best = { cols: 1, score: Infinity };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols),
        cellAspect = (aspect * rows) / cols,
        score = Math.abs(Math.log(cellAspect / 1.5)) + (cols * rows - n) * 0.1;
      if (score < best.score) best = { cols, score };
    }
    paneGrid.style.setProperty('--workspace-cols', best.cols);
    paneGrid.style.setProperty('--workspace-rows', Math.ceil(n / best.cols));
  }

  function showEmpty(id) {
    const paneGrid = views.get(id)?.grid;
    if (!paneGrid) return;
    paneGrid.querySelector('.terminal-workspace-empty')?.remove();
    if (panesFor(id).length) return;
    const empty = document.createElement('div');
    empty.className = 'terminal-workspace-empty';
    const title = document.createElement('b');
    title.textContent =
      'No terminals in ' + (store.workspaces.find(w => w.id === id)?.name || 'this workspace');
    const copy = document.createElement('span');
    copy.textContent = 'Choose an agent connection or a shell to start a fresh workspace.';
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' Add connection';
    button.setAttribute('aria-haspopup', 'dialog');
    button.onclick = () => {
      if (id !== activeId) setActive(id);
      if (window.TnaiConnectionPicker?.openNew) window.TnaiConnectionPicker.openNew(button);
      else addButton?.click();
    };
    empty.append(title, copy, button);
    paneGrid.append(empty);
  }

  function updateCounts() {
    for (const workspace of store.workspaces) {
      const running = panesFor(workspace.id).filter(p =>
          ['working', 'running'].includes(p.dataset.state)
        ).length,
        selected = panesFor(workspace.id).filter(p =>
          Boolean(p.querySelector('.terminal-provider-select')?.value)
        ).length;
      const tab = tabList.querySelector('[data-workspace-tab="' + CSS.escape(workspace.id) + '"]');
      if (tab) {
        const counts = tab.querySelector('.terminal-workspace-counts'),
          key = running + '/' + selected;
        if (counts.dataset.key === key && counts.childElementCount) continue;
        counts.dataset.key = key;
        counts.innerHTML = '';
        const active = document.createElement('span');
        active.textContent = running + ' running';
        active.className = running ? 'is-running' : '';
        const configured = document.createElement('span');
        configured.textContent = selected + ' selected';
        counts.append(active, configured);
        tab.setAttribute(
          'aria-label',
          workspace.name + ', ' + running + ' agents running, ' + selected + ' connections selected'
        );
      }
    }
  }

  function renderTabs() {
    tabList.replaceChildren();
    for (const workspace of mine()) {
      const tab = document.createElement('div');
      tab.tabIndex = 0;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(workspace.id === activeId));
      tab.className = 'terminal-workspace-tab' + (workspace.id === activeId ? ' active' : '');
      tab.dataset.workspaceTab = workspace.id;
      const name = document.createElement('span');
      name.textContent = workspace.name;
      const counts = document.createElement('small');
      counts.className = 'terminal-workspace-counts';
      const rename = document.createElement('button'),
        close = document.createElement('button');
      rename.type = close.type = 'button';
      rename.className = 'terminal-workspace-rename';
      rename.dataset.wsRename = workspace.id;
      rename.innerHTML = window.TnaiIcon('pencil', { size: 14 });
      rename.title = 'Rename ' + workspace.name + ' (F2)';
      rename.setAttribute('aria-label', 'Rename ' + workspace.name);
      close.className = 'terminal-workspace-close';
      close.dataset.wsClose = workspace.id;
      close.innerHTML = window.TnaiIcon('x', { size: 14 });
      close.title = 'Close ' + workspace.name;
      close.setAttribute('aria-label', 'Close ' + workspace.name);
      tab.append(name, counts, rename, close);
      tab.onclick = e => {
        if (!e.target.closest('button') && workspace.id !== activeId) setActive(workspace.id);
      };
      tab.onkeydown = e => {
        if (e.target === tab && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          tab.click();
        }
      };
      tabList.append(tab);
    }
    updateCounts();
  }

  function setActive(id) {
    if (!views.has(id) || !mine().some(w => w.id === id)) return;
    activeId = id;
    window.TnaiActiveTerminalWorkspaceId = id;
    for (const [workspaceId, item] of views) item.section.hidden = workspaceId !== id;
    showEmpty(id);
    fitGrid(id);
    renderTabs();
    persistWorkspaces();
  }

  function ensureWorkspace(id) {
    if (views.has(id)) return;
    const n = Math.max(0, ...mine().map(w => Number((w.name.match(/\d+/) || [])[0]) || 0)) + 1,
      workspace = { id, name: 'Workspace ' + n, project },
      section = document.createElement('section'),
      paneGrid = document.createElement('div');
    section.className = 'terminal-workspace-view';
    section.dataset.workspaceId = id;
    section.hidden = true;
    paneGrid.className = 'terminal-workspace-grid';
    section.append(paneGrid);
    content.append(section);
    store.workspaces.push(workspace);
    views.set(id, { section, grid: paneGrid });
    panesByWorkspace.set(id, []);
  }

  function createWorkspace(o) {
    o = o && !(o instanceof Event) ? o : {};
    const n = Math.max(0, ...mine().map(w => Number((w.name.match(/\d+/) || [])[0]) || 0)) + 1,
      id = 'workspace-' + Date.now().toString(36);
    const workspace = { id, name: 'Workspace ' + n, project };
    store.workspaces.push(workspace);
    const section = document.createElement('section');
    section.className = 'terminal-workspace-view';
    section.dataset.workspaceId = id;
    section.hidden = true;
    const paneGrid = document.createElement('div');
    paneGrid.className = 'terminal-workspace-grid';
    section.append(paneGrid);
    content.append(section);
    views.set(id, { section, grid: paneGrid });
    if (o.activate !== false) setActive(id);
    else renderTabs();
    showEmpty(id);
    persistWorkspaces();
    persistPaneList();
    toast(
      o.full
        ? o.full +
            ' is full (' +
            window.TnaiPaneLimit.max +
            ' terminals) · new agents continue in ' +
            workspace.name
        : workspace.name + ' created · new terminals start with fresh context'
    );
    return id;
  }
  addWorkspace.onclick = createWorkspace;

  // One path for a panel changing workspace: the header drop below, and 91's Agents list drag under
  // another workspace's heading (movePanes).
  function placePane(pane, workspaceId, before) {
    pane.dataset.workspaceId = workspaceId;
    window.TnaiTerminalWorkspaceByPane[pane.dataset.paneId] = workspaceId;
    const record = window.TnaiTerminalPaneRecords?.find(p => p.id === pane.dataset.paneId);
    if (record) record.workspaceId = workspaceId;
    views.get(workspaceId)?.grid.insertBefore(pane, before || null);
  }
  window.TnaiTerminalWorkspaces = {
    /* the active workspace is full: open the next one (04 newPane, makeRoom) unless adding workspaces is switched off */ canOverflow:
      () => !addWorkspace.disabled && !addWorkspace.hidden,
    overflow({ activate = true } = {}) {
      if (addWorkspace.disabled || addWorkspace.hidden) return null;
      return createWorkspace({
        activate,
        full: mine().find(w => w.id === activeId)?.name || 'This workspace',
      });
    },
    list: ({ all } = {}) => (all ? store.workspaces : mine()).map(w => ({ ...w })),
    activeId: () => activeId,
    /* 90: show the workspace a clicked PS> command came from; false when it is not one of this project's */ activate(
      id
    ) {
      setActive(id);
      return activeId === id;
    },
    project: () => project,
    // Any open project's panes, shown or hidden (for per-project running/waiting counts):
    // panesFor(root) → pane elements; projectOfPane(id) → normalized folder key.
    panesFor: root =>
      store.workspaces.filter(w => w.project === norm(root)).flatMap(w => panesFor(w.id)),
    projectOfPane: id =>
      store.workspaces.find(w => w.id === window.TnaiTerminalWorkspaceByPane?.[id])?.project ??
      null,
    normalize: norm,
    rename(id, name) {
      const workspace = store.workspaces.find(w => w.id === id),
        clean = String(name || '').trim();
      if (!workspace) return { ok: false, error: 'No workspace ' + id };
      if (!clean || clean === workspace.name) return { ok: false, unchanged: true };
      const clash = mine().find(
        w => w !== workspace && w.name.toLowerCase() === clean.toLowerCase()
      );
      if (clash)
        return {
          ok: false,
          error: 'A workspace is already named “' + clash.name + '”. Choose a different name.',
        };
      workspace.name = clean;
      persistWorkspaces();
      renderTabs();
      showEmpty(id);
      return { ok: true, name: clean };
    },
    render: renderTabs,
    /* 86 drag: the panels of a grid were reordered in place; save the order and refit as the old drop does */ reordered() {
      persistPaneList();
      for (const id of views.keys()) {
        fitGrid(id);
        showEmpty(id);
      }
      updateCounts();
    },
    /* 91: move panels (a lead's, then its sub-agents', in that order) into a workspace of the open project, before panel `beforeId` or at its end. The caller checks the 12-panel limit (a swap is over it for a moment). */ movePanes(
      ids,
      workspaceId,
      beforeId
    ) {
      const grid = views.get(workspaceId)?.grid;
      if (!grid || !mine().some(w => w.id === workspaceId))
        return { ok: false, error: 'No workspace ' + workspaceId };
      const find = id =>
          [...content.querySelectorAll('.terminal-pane')].find(p => p.dataset.paneId === id),
        panes = (ids || []).map(find).filter(Boolean);
      if (!panes.length) return { ok: false, error: 'No terminal panel to move' };
      let before = beforeId ? find(beforeId) : null;
      if (before && (before.parentElement !== grid || panes.includes(before))) before = null;
      for (const pane of panes) placePane(pane, workspaceId, before);
      this.reordered();
      window.dispatchEvent(
        new CustomEvent('tnai:terminal-panes-reordered', {
          detail: { paneId: panes[0].dataset.paneId, workspaceId, source: 'workspace-move' },
        })
      );
      return { ok: true };
    },
    remove(id) {
      const i = store.workspaces.findIndex(w => w.id === id),
        at = mine().findIndex(w => w.id === id);
      if (i < 0) return { ok: false, error: 'No workspace ' + id };
      const [gone] = store.workspaces.splice(i, 1);
      views.get(id)?.section.remove();
      views.delete(id);
      panesByWorkspace.delete(id);
      if (!mine().length) ensureWorkspace('workspace-' + Date.now().toString(36));
      const own = mine(),
        next = activeId === id ? own[Math.min(Math.max(at, 0), own.length - 1)].id : activeId;
      setActive(next);
      persistPaneList();
      window.dispatchEvent(
        new CustomEvent('tnai:terminal-workspace-closed', {
          detail: { workspaceId: id, name: gone.name, activeId: next },
        })
      );
      return { ok: true, name: gone.name, activeId: next };
    },
  };

  function adoptNewPanes() {
    for (const pane of [...content.children].filter(node =>
      node.classList?.contains('terminal-pane')
    )) {
      const id = pane.dataset.paneId,
        workspaceId = pane.dataset.workspaceId || activeId;
      if (!views.has(workspaceId)) ensureWorkspace(workspaceId);
      pane.dataset.workspaceId = workspaceId;
      window.TnaiTerminalWorkspaceByPane[id] = workspaceId;
      const destination = views.get(workspaceId).grid;
      destination.append(pane);
    }
    for (const [id, item] of views) {
      showEmpty(id);
      fitGrid(id);
    }
    renderTabs();
    persistPaneList();
  }
  const observer = new MutationObserver(() => {
    adoptNewPanes();
  });
  observer.observe(content, { childList: true });
  content.addEventListener(
    'drop',
    e => {
      const target = e.target.closest('.terminal-pane'),
        draggedId = e.dataTransfer?.getData('text/plain'),
        dragged = content.querySelector(
          '.terminal-pane[data-pane-id="' + CSS.escape(draggedId || '') + '"]'
        );
      if (!target || !dragged || target === dragged) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      placePane(dragged, target.dataset.workspaceId, target);
      persistPaneList();
      for (const id of views.keys()) {
        fitGrid(id);
        showEmpty(id);
      }
      updateCounts();
    },
    true
  );
  content.addEventListener(
    'change',
    e => {
      if (e.target.matches('.terminal-provider-select')) updateCounts();
    },
    true
  );
  const statusObserver = new MutationObserver(updateCounts);
  statusObserver.observe(content, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });

  // Show one project's workspaces (09 fires `tnai:project-changed`); a project with none gets
  // "Workspace 1". Panes are only hidden, never stopped.
  function showProject(key) {
    if (project !== null) store.active[project] = activeId;
    project = key;
    if (!mine().length) ensureWorkspace('workspace-' + Date.now().toString(36));
    const own = mine(),
      next = [store.active[key], activeId].find(id => own.some(w => w.id === id)) || own[0].id;
    for (const id of views.keys()) showEmpty(id);
    setActive(next);
    persistPaneList();
  }

  // Migration: workspaces saved before projects had layouts (no `project`) go to the project their
  // panes run in — a live pane's cwd inside an open project, or a worktree lane
  // (userData/worktrees/<sha256(project)[0,12]>/…, worktree-service.js) of it — else the active
  // project. A workspace spanning projects is split under the same name.
  const hex = async text => {
    try {
      return [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
      ]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 12);
    } catch {
      return '';
    }
  };

  async function resolveProject(root) {
    let info = null;
    if (root === undefined || store.workspaces.some(w => w.project == null))
      try {
        info = await window.TnaiDesktop?.projects?.();
      } catch {}
    const active = norm(root !== undefined ? root : info?.active);
    if (store.workspaces.some(w => w.project == null)) {
      let ptys = [];
      try {
        ptys = (await window.tnaiNative?.pty?.list?.()) || [];
      } catch {}
      const roots = (info?.projects || []).map(p => norm(p.path)),
        lanes = new Map();
      for (const r of roots) lanes.set(await hex(r), r);
      const cwd = new Map(ptys.map(p => [p.paneId, norm(p.cwd)])),
        owner = id => {
          const c = cwd.get(id) || '',
            lane = c.match(/\\worktrees\\([0-9a-f]{12})\\/);
          if (lane && lanes.has(lane[1])) return lanes.get(lane[1]);
          return (
            roots
              .filter(r => c === r || c.startsWith(r + '\\'))
              .sort((a, b) => b.length - a.length)[0] ?? active
          );
        };
      for (const w of store.workspaces.filter(w => w.project == null)) {
        const groups = new Map();
        for (const pane of panesFor(w.id)) {
          const k = owner(pane.dataset.paneId);
          groups.set(k, [...(groups.get(k) || []), pane]);
        }
        const keys = [...groups.keys()];
        w.project = keys.includes(active) || !keys.length ? active : keys[0];
        for (const k of keys.filter(k => k !== w.project)) {
          const id =
            'workspace-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
          ensureWorkspace(id);
          Object.assign(store.workspaces.at(-1), { name: w.name, project: k });
          for (const pane of groups.get(k)) {
            pane.dataset.workspaceId = id;
            window.TnaiTerminalWorkspaceByPane[pane.dataset.paneId] = id;
            const record = window.TnaiTerminalPaneRecords?.find(p => p.id === pane.dataset.paneId);
            if (record) record.workspaceId = id;
            views.get(id).grid.append(pane);
          }
        }
      }
    }
    showProject(active);
  }
  window.addEventListener('tnai:project-changed', e => resolveProject(e.detail?.root || ''));
  resolveProject();
  showEmpty(activeId);
  for (const id of views.keys()) fitGrid(id);
  renderTabs();
  persistWorkspaces();
  persistPaneList();
  window.addEventListener('resize', () => {
    if (window.TnaiTerminalGrid) return;

    /* 21 fits each grid from its own ResizeObserver, after layout; fitting here too forced one more full layout per resize event (measured 2026-10-05, resize-drag) */ for (const id of views.keys())
      fitGrid(id);
  });
  addButton?.addEventListener('click', () => setTimeout(updateCounts, 0));
})();
