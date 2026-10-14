// Technically Not · 08-routing-and-agents-page.js — Page routing
// (overview/agents/files/workspace/terminal/skills/settings), the Agent Tree shown on Overview,
// task assignments

(() => {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  const agentPage = document.createElement('section');
  agentPage.className = 'agent-page';
  agentPage.id = 'agentPage';
  agentPage.setAttribute('aria-label', 'Agent Tree');
  agentPage.innerHTML = `<div class="agent-page-inner"><header class="agent-page-header"><div><p class="agent-eyebrow">TECHNICALLY NOT / OVERVIEW</p><h1>Agent Tree</h1><p>See who owns each task, what they are doing, and which agents are available.</p></div><div class="agent-page-actions"><span class="agent-demo-flag"><i></i>Prototype state · no live runtimes connected</span></div></header><div class="agent-metrics" id="agentMetrics" aria-live="polite"></div><section class="agent-tree-panel"><header class="agent-tree-toolbar"><div><span class="agent-eyebrow">CURRENT PROJECT TASK</span><b id="agentCurrentTask">No task staged</b><small id="agentUpdatedAt">Describe a task in Overview to create local assignments.</small></div><span class="agent-local-state"><i></i>Local prototype state</span></header><div class="agent-tree-root"><span class="agent-root-mark">T</span><div><small>PROJECT COORDINATION</small><b id="agentRootTask">Waiting for a project task</b><span id="agentRootStatus">No connected agents</span></div></div><div class="agent-tree-children" id="agentTreeNodes" role="list"></div></section><section class="agent-status-legend"><span><i class="agent-status-dot ready"></i>Ready</span><span><i class="agent-status-dot working"></i>Working</span><span><i class="agent-status-dot waiting"></i>Waiting</span><span><i class="agent-status-dot idle"></i>Idle</span><span><i class="agent-status-dot error"></i>Error</span><small>Status colors update from project agent state when a runtime is connected.</small></section></div>`;
  (document.querySelector('.workspace .dock-content') || layout).prepend(agentPage);
  const style = document.createElement('style');
  style.textContent = `
.layout.overview-mode{grid-template-columns:var(--nav-width,205px) minmax(0,1fr)!important;background:#f5f6f2}.layout .sidebar>.mini-brand{display:none!important}
.layout.overview-mode>.sidebar{grid-column:1;grid-row:1;min-width:0}
.layout.overview-mode>.overview-view,.layout.overview-mode>.preview,.layout.overview-mode>.tnai-resizer{display:none!important}
.layout.overview-mode>.workspace{display:grid!important;grid-column:2;grid-row:1;grid-template: minmax(0,1fr)/minmax(0,1fr)!important;min-width:0;min-height:0;border:0;background:#f5f6f2}
.layout.overview-mode>.workspace>.dock-zone{display:grid!important;grid-template-rows:50px minmax(0,1fr);min-width:0;min-height:0;width:100%;height:100%}
.layout.overview-mode>.workspace>.terminal-view{display:none!important}
.layout.overview-mode .dock-head{padding:0 18px}
.layout.overview-mode .dock-title{font-size:12px;color:#34382f}
.layout.overview-mode .dock-content{display:grid!important;grid-template-columns:minmax(0,1fr) clamp(270px,23vw,360px)!important;grid-template-rows:minmax(0,1fr);min-width:0;min-height:0;overflow:hidden}
.layout.overview-mode .dock-scroll{min-width:0;min-height:0;padding:12px 14px;overflow:auto}
.layout.overview-mode .dock-content>.repository-rail{display:flex!important;grid-column:2!important;grid-row:1!important;flex-direction:column;min-width:0;min-height:0;width:100%;max-width:none;justify-self:stretch;align-self:stretch;overflow:auto;padding:15px 12px!important;border-left:1px solid #e5e8e0!important;background:#fff}
.layout.overview-mode .repository-rail .repo-file-detail{display:block;flex:none;grid-column:auto!important;grid-row:auto!important;min-height:160px;margin-top:10px;padding:13px!important;background:#fbfcf9;border:1px solid #e7eae3;border-radius:7px}
.layout.overview-mode .repository-rail .repo-file-detail[hidden]{display:none!important}
.layout.overview-mode .repo-row{grid-template-columns:16px 18px minmax(0,1fr) minmax(0,68px) minmax(0,88px)!important;min-width:0!important}
.layout.overview-mode .repository-rail{container-type:inline-size}
@container (max-width:400px){.layout.overview-mode .repo-row{grid-template-columns:16px 18px minmax(0,1fr)!important}.layout.overview-mode .repo-file-kind,.layout.overview-mode .repo-file-path{display:none!important}}
.layout.overview-mode:not(.workspace-mode)>.workspace>.dock-zone{grid-template-rows:minmax(0,1fr)!important}.layout.overview-mode:not(.workspace-mode) .dock-head{display:none!important}
.layout.overview-mode:not(.workspace-mode) .dock-content>.dock-scroll{display:none!important}
.layout.overview-mode:not(.workspace-mode) .dock-content>.agent-page{display:block;grid-column:1;grid-row:1;min-width:0;min-height:0;overflow:auto}
.agent-page{display:none;min-width:0;min-height:0;padding:var(--page-pad);background:#f6f7f3;overflow:auto}
.agent-page-inner{max-width:1500px;min-height:100%;margin:0 auto}
.agent-page-header{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:36px;margin-bottom:10px}
.agent-eyebrow{display:none}
.agent-page-header h1{margin:0;color:#34382f;font:600 16px var(--pg-sans);letter-spacing:-.2px}
.agent-page-header>div:first-child>p:last-child{display:none}
.agent-page-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end}
.agent-demo-flag,.agent-local-state{display:inline-flex;align-items:center;gap:7px;padding:7px 9px;border:1px solid #e7e8e1;border-radius:6px;background:#fff;color:#81867a;font:9px var(--pg-sans);white-space:nowrap}
.agent-demo-flag i,.agent-local-state i{width:6px;height:6px;border-radius:50%;background:#c3a35b}
.agent-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin-bottom:14px}
.agent-metric{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:61px;padding:11px 13px;border:1px solid #e4e8df;border-radius:8px;background:#fff}
.agent-metric span{color:#858a80;font:10px var(--pg-sans)}.agent-metric b{color:#4d5545;font:600 18px var(--pg-sans)}.agent-metric[data-status=working] b{color:#65814b}.agent-metric[data-status=waiting] b{color:#a88237}.agent-metric[data-status=error] b{color:#a85c55}
.agent-tree-panel{min-height:300px;padding:15px;border:1px solid #e2e6de;border-radius:9px;background:#fff;box-shadow:0 3px 12px #20211f07}
.agent-tree-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:2px 2px 15px;border-bottom:1px solid #edf0ea}
.agent-tree-toolbar>div{display:grid;gap:5px;min-width:0}.agent-tree-toolbar>div>b{overflow-wrap:anywhere;color:#444a3f;font:600 12px var(--pg-sans)}.agent-tree-toolbar>div>small{color:#969b91;font:9px var(--pg-sans)}
.agent-local-state{background:#f8f9f6}.agent-local-state i{background:#a4b582}
.agent-tree-root{position:relative;display:flex;align-items:center;gap:12px;width:min(720px,100%);min-height:76px;margin:20px auto 0;padding:13px 16px;border:1px solid #dfe5d8;border-radius:8px;background:#f8faf5}
.agent-tree-root:after{content:'';position:absolute;left:50%;top:100%;height:25px;border-left:1px solid #d5ddca}
.agent-root-mark{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:8px;background:#30352c;color:#d5edab;font:700 10px var(--pg-sans)}
.agent-tree-root>div{display:grid;gap:5px;min-width:0}.agent-tree-root small{color:#92988c;font:8px var(--pg-sans);letter-spacing:.1em}.agent-tree-root b{overflow-wrap:anywhere;color:#40463a;font:600 12px var(--pg-sans)}.agent-tree-root span:last-child{color:#858b7d;font:9px var(--pg-sans)}
.agent-tree-children{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;padding-top:25px}
.agent-tree-children:before{content:'';position:absolute;top:0;left:0;right:0;border-top:1px solid #d5ddca}
.agent-tree-node{position:relative;min-width:0;padding:13px;border:1px solid #e5e9e2;border-radius:8px;background:#fff}
.agent-tree-node:before{content:'';position:absolute;left:50%;bottom:100%;height:25px;border-left:1px solid #d5ddca}
.agent-node-head{display:flex;align-items:center;gap:9px;min-width:0}.agent-avatar{display:grid;place-items:center;flex:none;width:30px;height:30px;border-radius:8px;background:#eef2e7;color:#63794b;font:600 10px var(--pg-sans)}
.agent-node-identity{display:grid;gap:4px;min-width:0}.agent-node-identity b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#454a40;font:600 11px var(--pg-sans)}.agent-node-identity small{color:#94998f;font:9px var(--pg-sans)}
.agent-status-pill{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:5px 7px;border-radius:99px;background:#f0f2ed;color:#747a6e;font:8px var(--pg-sans);white-space:nowrap}.agent-status-pill i,.agent-status-dot{width:6px;height:6px;border-radius:50%;background:#b6b9b0}.agent-status-pill.ready{background:#eff3e9;color:#687a4f}.agent-status-pill.ready i,.agent-status-dot.ready{background:#8da56b}.agent-status-pill.working{background:#edf4e8;color:#5c7d43}.agent-status-pill.working i,.agent-status-dot.working{background:#82a95f;box-shadow:0 0 0 3px #edf4e8}.agent-status-pill.waiting{background:#f7f2e5;color:#967331}.agent-status-pill.waiting i,.agent-status-dot.waiting{background:#c7a24e}.agent-status-pill.error{background:#f8eeec;color:#a45750}.agent-status-pill.error i,.agent-status-dot.error{background:#bd7068}.agent-status-pill.idle{background:#f1f2ef;color:#7c8178}.agent-status-pill.idle i,.agent-status-dot.idle{background:#b5b9b0}
.agent-node-task{display:grid;gap:5px;margin-top:12px;padding-top:10px;border-top:1px solid #f0f1ed}.agent-node-task small{color:#9a9e94;font:8px var(--pg-sans);letter-spacing:.08em}.agent-node-task b{color:#4a4f46;font:600 10px/1.45 var(--pg-sans)}.agent-node-task p{margin:0;color:#858b80;font:9px/1.5 var(--pg-sans);overflow-wrap:anywhere}
.agent-skill-list{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.agent-skill-list span{padding:4px 6px;border:1px solid #ebeee7;border-radius:4px;background:#fafbf9;color:#7d8377;font:8px var(--pg-sans)}
.agent-node-foot{display:flex;justify-content:space-between;gap:8px;margin-top:10px;color:#a0a49b;font:8px var(--pg-sans)}.agent-node-foot span:last-child{text-align:right}
.agent-empty{display:grid;place-items:center;min-height:190px;padding:24px;color:#858a80;text-align:center;font:11px var(--pg-sans)}.agent-empty b{color:#4e5548}
.agent-status-legend{display:flex;align-items:center;flex-wrap:wrap;gap:14px;margin-top:12px;padding:10px 3px;color:#7f8579;font:9px var(--pg-sans)}.agent-status-legend span{display:inline-flex;align-items:center;gap:6px}.agent-status-legend .agent-status-dot{display:inline-block}.agent-status-legend small{margin-left:auto;color:#999e94;font:8px var(--pg-sans)}
@media(min-width:1500px){.layout.overview-mode .dock-scroll{padding-left:18px;padding-right:18px}}
`;
  document.head.append(style);
  const repoRail = document.querySelector('.repository-rail'),
    terminalView = document.getElementById('terminalView');
  const idFor = (kind, value) =>
    kind +
    '-' +
    String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50);
  const newId = kind =>
    kind +
    '-' +
    (crypto.randomUUID
      ? crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const namePool = [
    'Avery',
    'Jordan',
    'Casey',
    'Riley',
    'Quinn',
    'Morgan',
    'Taylor',
    'Cameron',
    'Rowan',
    'Jamie',
    'Parker',
    'Reese',
    'Drew',
    'Skyler',
    'Hayden',
    'Finley',
    'Robin',
    'Sam',
    'Alex',
    'Bailey',
    'Charlie',
    'Devon',
    'Ellis',
    'Frankie',
    'Harper',
    'Indigo',
    'Jules',
    'Kendall',
    'Lennon',
    'Micah',
    'Noel',
    'Oakley',
    'Peyton',
    'Remy',
    'Shea',
    'Tatum',
    'Val',
    'Wren',
    'Arden',
    'Emerson',
    'Flynn',
    'Gray',
    'Kai',
    'Lane',
    'Marlowe',
    'Sage',
    'Shiloh',
    'Teagan',
  ];

  function randomName(existing = []) {
    const used = new Set(existing.map(x => x.agentName));
    const options = namePool.filter(n => !used.has(n));
    return options.length
      ? options[Math.floor(Math.random() * options.length)]
      : 'Agent ' + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  function normalizeStatus(status) {
    const value = String(status || 'idle').toLowerCase();
    if (['working', 'running'].includes(value)) return 'working';
    if (['waiting', 'planning', 'queued', 'blocked'].includes(value)) return 'waiting';
    if (['error', 'failed'].includes(value)) return 'error';
    if (['ready', 'complete', 'completed'].includes(value)) return 'ready';
    return 'idle';
  }
  const storeKey = 'tnai.agent-hierarchy.v1';
  let state = null;
  try {
    state = JSON.parse(localStorage.getItem(storeKey) || 'null');
  } catch {}
  const seedTasks = Array.isArray(window.TnaiAgentTasks) ? window.TnaiAgentTasks : [];
  if (!state || !Array.isArray(state.savedAgents) || !Array.isArray(state.workers)) {
    const savedAgents = seedTasks.map(task => {
      const name = task.agentName || randomName([]),
        role = task.role || task.stage || 'Project agent';
      return {
        id: idFor('agent', name + '-' + role),
        agentName: name,
        role,
        skills: Array.isArray(task.skills) ? task.skills : ['Project work'],
      };
    });
    while (savedAgents.length < 3) {
      const role = ['Planner', 'Builder', 'Reviewer'][savedAgents.length],
        agentName = randomName(savedAgents);
      savedAgents.push({
        id: idFor('agent', agentName + '-' + role),
        agentName,
        role,
        skills: [
          role === 'Planner'
            ? 'Task planning'
            : role === 'Builder'
              ? 'Implementation'
              : 'Verification',
        ],
      });
    }
    state = {
      source: 'sample',
      currentTask: seedTasks[0]?.title || seedTasks[0]?.description || '',
      currentTaskId: '',
      savedAgents,
      workers: seedTasks.map((task, index) => ({
        ...task,
        id: savedAgents[index]?.id || idFor('agent', task.agentName),
        agentId: savedAgents[index]?.id || idFor('agent', task.agentName),
        agentName: savedAgents[index]?.agentName || task.agentName || randomName(savedAgents),
        role: savedAgents[index]?.role || task.role || 'Project agent',
        title: task.title || task.description || 'Available for project work',
        status: normalizeStatus(task.status),
        skills: task.skills || savedAgents[index]?.skills || [],
        description: task.description || '',
      })),
      runs: [],
      updatedAt: new Date().toISOString(),
    };
  }

  function persist() {
    state.updatedAt = new Date().toISOString();
    window.TnaiAgentTasks = state.workers;
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {}
    renderAgentPage();
  }

  function statusLabel(status) {
    return { ready: 'Ready', working: 'Working', waiting: 'Waiting', idle: 'Idle', error: 'Error' }[
      normalizeStatus(status)
    ];
  }

  function makeMetric(label, value, status) {
    const card = document.createElement('div');
    card.className = 'agent-metric';
    card.dataset.status = status || '';
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('b');
    v.textContent = String(value);
    card.append(l, v);
    return card;
  }

  function renderAgentPage() {
    // Desktop app: 11 draws the real agent tree and owns the Overview nav count; the prototype tree
    // and metrics are hidden there, so only the count's slot is made.
    if (document.documentElement.dataset.runtime === 'desktop') {
      const nav = document.querySelector('.side-item[data-view="overview"]');
      if (nav && !nav.querySelector('.agent-nav-count')) {
        const count = document.createElement('small');
        count.className = 'agent-nav-count';
        nav.append(count);
      }
      return;
    }
    const metrics = document.getElementById('agentMetrics'),
      nodes = document.getElementById('agentTreeNodes');
    if (!metrics || !nodes) return;
    metrics.replaceChildren();
    nodes.replaceChildren();
    const assigned = new Map((state.workers || []).map(w => [w.agentId || w.id, w]));
    const all = (state.savedAgents || []).map(
      agent =>
        assigned.get(agent.id) || {
          ...agent,
          title: 'Available for the next task',
          description: 'Saved agent · not currently assigned',
          status: 'idle',
        }
    );
    const counts = { ready: 0, working: 0, waiting: 0, idle: 0, error: 0 };
    all.forEach(agent => counts[normalizeStatus(agent.status)]++);
    metrics.append(
      makeMetric('Saved agents', state.savedAgents.length),
      makeMetric('Working', counts.working, 'working'),
      makeMetric('Waiting', counts.waiting, 'waiting'),
      makeMetric('Needs attention', counts.error, 'error')
    );
    const current = document.getElementById('agentCurrentTask'),
      rootTask = document.getElementById('agentRootTask'),
      rootStatus = document.getElementById('agentRootStatus'),
      updated = document.getElementById('agentUpdatedAt');
    const hasTask = Boolean(state.currentTask);
    current.textContent = hasTask ? state.currentTask : 'No task staged';
    rootTask.textContent = hasTask
      ? state.currentTask
      : 'Describe a task in Overview to create local assignments.';
    rootStatus.textContent = hasTask
      ? state.source === 'sample'
        ? 'Illustrative sample · no agents connected'
        : 'Task staged locally · connect a runtime to start agents'
      : 'No task assigned';
    updated.textContent = hasTask
      ? state.source === 'sample'
        ? 'Sample task · illustrative only'
        : 'Updated ' +
          new Date(state.updatedAt || Date.now()).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          }) +
          ' · prototype assignments only'
      : 'No live runtime data';
    if (!all.length) {
      const empty = document.createElement('div');
      empty.className = 'agent-empty';
      empty.innerHTML =
        '<div><b>No saved agents yet</b><br>Describe a task in Overview or add a saved agent to start the tree.</div>';
      nodes.append(empty);
      return;
    }
    all.forEach(agent => {
      const status = normalizeStatus(agent.status),
        card = document.createElement('article');
      card.className = 'agent-tree-node';
      card.setAttribute('role', 'listitem');
      card.dataset.agentId = agent.id || '';
      const head = document.createElement('div');
      head.className = 'agent-node-head';
      const avatar = document.createElement('span');
      avatar.className = 'agent-avatar';
      avatar.textContent = (agent.agentName || 'A')
        .split(/\s+/)
        .map(s => s[0])
        .slice(0, 2)
        .join('')
        .toUpperCase();
      const identity = document.createElement('div');
      identity.className = 'agent-node-identity';
      const name = document.createElement('b');
      name.textContent = agent.agentName || 'Unnamed agent';
      const role = document.createElement('small');
      role.textContent = agent.role || 'Saved agent';
      identity.append(name, role);
      const badge = document.createElement('span');
      badge.className = 'agent-status-pill ' + status;
      const dot = document.createElement('i');
      const label = document.createElement('span');
      label.textContent = statusLabel(status);
      badge.append(dot, label);
      head.append(avatar, identity, badge);
      const task = document.createElement('div');
      task.className = 'agent-node-task';
      const taskLabel = document.createElement('small');
      taskLabel.textContent = 'CURRENT TASK';
      const taskTitle = document.createElement('b');
      taskTitle.textContent = agent.title || agent.description || 'Available for the next task';
      const description = document.createElement('p');
      description.textContent =
        agent.description ||
        (status === 'idle'
          ? 'Saved agent · available for the next request'
          : 'Local task assignment · no runtime connected');
      task.append(taskLabel, taskTitle, description);
      const skillList = document.createElement('div');
      skillList.className = 'agent-skill-list';
      (Array.isArray(agent.skills) ? agent.skills : []).slice(0, 5).forEach(skill => {
        const chip = document.createElement('span');
        chip.textContent = skill;
        skillList.append(chip);
      });
      const foot = document.createElement('div');
      foot.className = 'agent-node-foot';
      const left = document.createElement('span');
      left.textContent = agent.updatedAt
        ? 'Updated ' +
          new Date(agent.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : 'Saved agent';
      const right = document.createElement('span');
      right.textContent = agent.runtimeConnected ? 'Connected runtime' : 'Simulation only';
      foot.append(left, right);
      card.append(head, task, skillList, foot);
      nodes.append(card);
    });
    const nav = document.querySelector('.side-item[data-view="overview"]');
    if (nav) {
      let count = nav.querySelector('.agent-nav-count');
      if (!count) {
        count = document.createElement('small');
        count.className = 'agent-nav-count';
        nav.append(count);
      }
      count.textContent =
        document.documentElement.dataset.runtime === 'desktop'
          ? String(state.savedAgents.length)
          : '';
    }
  }

  // Overview shows the agent tree (overview-mode).
  // Only the mode classes that differ are touched: every .layout class change wakes the pages'
  // class observers (11, 24, 25, 33, 53 …), so routing to the page already shown (an agent selected
  // on the Agents page, Overview re-routed) changes nothing and costs nothing.
  const MODES = {
      overview: ['overview-mode'],
      terminal: ['code-mode', 'terminal-mode'],
      skills: ['skills-mode'],
      settings: ['settings-mode'],
      devices: ['devices-mode'],
    },
    ALL_MODES = [...new Set(Object.values(MODES).flat())];

  function setModes(view) {
    const want = MODES[view] || [];
    ALL_MODES.forEach(c => {
      const on = want.includes(c);
      if (layout.classList.contains(c) !== on) layout.classList.toggle(c, on);
    });
  }

  function route(view) {
    // The Agents and history page is gone (2026-10-12): what it showed is in a thread's own top
    // row. A route to it ends on the Threads page, and the layout never gets that page's class,
    // so nothing of it shows for a moment. Outside the desktop app it ends where a route to the
    // old Overview ends.
    if (view === 'agents') {
      if (window.TnaiThreads?.enabled?.()) {
        window.TnaiThreads.open();
        return;
      }
      view = 'overview';
    }

    // The Live preview page shows itself (65) and has no entry in MODES. A route to it by name
    // left the layout with no page's class at all: a narrow list with no names and an empty
    // middle (seen at 768 px by the size tests). It is handed to the page's own open.
    if (view === 'live-preview' && window.TnaiLivePreviewPage?.open) {
      window.TnaiLivePreviewPage.open();
      return;
    }
    setModes(view);
    document
      .querySelectorAll('.side-item')
      .forEach(item =>
        item.classList.toggle(
          'active',
          view === 'overview'
            ? item.dataset.view === 'overview'
            : view === 'skills'
              ? item.dataset.aiTool === 'skills'
              : view === 'settings'
                ? item.dataset.view === 'settings'
                : view === 'devices'
                  ? item.dataset.view === 'devices'
                  : item.dataset.view === 'terminal'
        )
      );
    if (view === 'overview') renderAgentPage();
    else if (view === 'skills') window.dispatchEvent(new CustomEvent('tnai:skills-page-shown'));
    else if (view === 'settings') window.dispatchEvent(new CustomEvent('tnai:settings-page-shown'));
    else if (view === 'devices') window.dispatchEvent(new CustomEvent('tnai:devices-page-shown'));
  }
  window.TnaiRoute = route;

  // On Overview the repository rail is for navigating: folders expand in place, and a file opens in
  // the view-only file window (TnaiFileViewer, 09).
  repoRail?.addEventListener(
    'click',
    event => {
      const row = event.target.closest('.repo-real-tree .repo-file[data-real-path]');
      if (!row || !layout.classList.contains('overview-mode')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.TnaiFileViewer?.open(row.dataset.realPath);
    },
    true
  );
  document.addEventListener(
    'click',
    event => {
      const item = event.target.closest('.side-item');
      if (!item) return;
      const view =
        item.dataset.view === 'overview'
          ? 'overview'
          : item.dataset.view === 'terminal'
            ? 'terminal'
            : item.dataset.aiTool === 'skills'
              ? 'skills'
              : item.dataset.view === 'settings'
                ? 'settings'
                : item.dataset.view === 'agents'
                  ? 'agents'
                  : item.dataset.view === 'devices'
                    ? 'devices'
                    : null;
      if (!view) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      route(view);
    },
    true
  );
  const openAgentsButton = document.getElementById('openAgents');
  if (openAgentsButton) openAgentsButton.onclick = () => route('overview');
  document.getElementById('openBuild')?.addEventListener('click', event => {
    event.preventDefault();
    route('overview');
  });
  document.getElementById('projectOpenBuild')?.addEventListener('click', event => {
    event.preventDefault();
    route('overview');
  });

  function createTaskAssignments(text) {
    const id = newId('task'),
      parts = [
        ['Scope and plan the request', 'Task planning · connector required', 'ready'],
        ['Implement the requested change', 'Waiting for a connected coding runtime', 'waiting'],
        [
          'Review the result after implementation',
          'Idle until implementation is available',
          'idle',
        ],
      ];
    while (state.savedAgents.length < parts.length) {
      const role = ['Planner', 'Builder', 'Reviewer'][state.savedAgents.length],
        agentName = randomName(state.savedAgents);
      state.savedAgents.push({
        id: newId('agent'),
        agentName,
        role,
        skills: [
          role === 'Planner'
            ? 'Task planning'
            : role === 'Builder'
              ? 'Implementation'
              : 'Verification',
        ],
      });
    }
    const workers = state.savedAgents.slice(0, parts.length).map((agent, index) => ({
      id: agent.id,
      agentId: agent.id,
      agentName: agent.agentName,
      role: agent.role,
      title: parts[index][0],
      description: parts[index][1] + ' · Request: ' + text.slice(0, 180),
      skills: agent.skills,
      status: parts[index][2],
      taskId: id,
      updatedAt: new Date().toISOString(),
      runtimeConnected: false,
    }));
    state.source = 'local-prototype';
    state.currentTask = text;
    state.currentTaskId = id;
    state.workers = workers;
    state.runs = [
      ...(state.runs || []),
      {
        id,
        title: text,
        createdAt: new Date().toISOString(),
        agentIds: workers.map(w => w.agentId),
        status: 'staged',
      },
    ].slice(-20);
    persist();
    const title = document.querySelector('.dock-title');
    if (title) title.childNodes[0].textContent = 'Overview workspace ';
    toast(
      'Task staged · ' +
        workers.length +
        ' saved agents assigned locally; connect a runtime to start them'
    );
    window.dispatchEvent(
      new CustomEvent('tnai:agent-state', { detail: { taskId: id, agents: workers } })
    );
  }
  window.TnaiStartOverviewTask = createTaskAssignments;
  window.TnaiRefreshAgentTree = renderAgentPage;
  window.addEventListener('tnai:agent-state', event => {
    if (Array.isArray(event.detail?.agents)) {
      state.workers = event.detail.agents;
      persist();
    } else renderAgentPage();
  });
  const send = document.getElementById('send'),
    prompt = document.getElementById('prompt');
  if (send && prompt)
    send.onclick = () => {
      const text = prompt.value.trim();
      if (!text) return;
      if (layout.classList.contains('overview-mode')) {
        createTaskAssignments(text);
        prompt.value = '';
        return;
      }
      toast('Task request captured · connect an AI runtime to execute it');
      prompt.value = '';
    };
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.workspaceId;
    document.querySelectorAll('.terminal-workspace-view').forEach(view => {
      view.querySelector('.terminal-workspace-empty')?.remove();
      if (!view.querySelector('.terminal-pane')) {
        const empty = document.createElement('div');
        empty.className = 'terminal-workspace-empty';
        const name =
          document.querySelector(
            '[data-workspace-tab="' + CSS.escape(view.dataset.workspaceId) + '"]>span:first-child'
          )?.textContent || 'this workspace';
        const title = document.createElement('b');
        title.textContent = 'No terminals in ' + name;
        const copy = document.createElement('span');
        copy.textContent =
          'Add a connection to start a terminal here. The panel can be closed again at any time.';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '＋ Add connection';
        button.onclick = () => {
          document
            .querySelector('[data-workspace-tab="' + CSS.escape(view.dataset.workspaceId) + '"]')
            ?.click();
          document.getElementById('newTerminalWindow')?.click();
        };
        empty.append(title, copy, button);
        view.querySelector('.terminal-workspace-grid')?.append(empty);
      }
    });
    if (id)
      document
        .querySelector('[data-workspace-tab="' + CSS.escape(id) + '"]')
        ?.classList.add('active');
  });
  window.addEventListener('tnai:terminal-pane-closed', () => {
    document.querySelectorAll('.terminal-workspace-view').forEach(view => {
      const grid = view.querySelector('.terminal-workspace-grid');
      if (!grid) return;
      const panes = [...grid.querySelectorAll('.terminal-pane')],
        n = panes.length,
        width = grid.clientWidth || innerWidth,
        height = grid.clientHeight || innerHeight,
        aspect = width / Math.max(1, height);
      let best = { cols: 1, score: Infinity };
      for (let cols = 1; cols <= Math.max(1, n); cols++) {
        const rows = Math.ceil(n / cols),
          cellAspect = (aspect * rows) / cols,
          score = Math.abs(Math.log(cellAspect / 1.5)) + (cols * rows - n) * 0.1;
        if (score < best.score) best = { cols, score };
      }
      grid.style.setProperty('--workspace-cols', n ? best.cols : 1);
      grid.style.setProperty('--workspace-rows', n ? Math.ceil(n / best.cols) : 1);
      const tab = document.querySelector(
          '[data-workspace-tab="' + CSS.escape(view.dataset.workspaceId) + '"]'
        ),
        counter = tab?.querySelector('.terminal-workspace-counts');
      if (counter) {
        counter.replaceChildren();
        const running = panes.filter(p => ['working', 'running'].includes(p.dataset.state)).length,
          selected = panes.filter(p =>
            Boolean(p.querySelector('.terminal-provider-select')?.value)
          ).length;
        const r = document.createElement('span');
        r.textContent = running + ' running';
        r.className = running ? 'is-running' : '';
        const c = document.createElement('span');
        c.textContent = selected + ' selected';
        counter.append(r, c);
      }
    });
  });
  renderAgentPage();
  if (layout.classList.contains('overview-mode')) route('overview');
})();
