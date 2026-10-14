// Technically Not · 02-command-center.js — Command center: saved workspace controls and demo-only
// agent presentation
/* Technically Not command center: saved workspace controls and demo-only agent presentation */
(() => {
  const layout = document.querySelector('.layout'),
    overview = document.getElementById('overviewView');
  if (!layout || !overview) return;
  layout.classList.add('overview-mode');
  document
    .querySelectorAll('.side-item')
    .forEach(item => item.classList.toggle('active', item.dataset.view === 'overview'));
  const css = document.createElement('style');
  css.textContent = `.app{min-height:560px;grid-template-rows:58px minmax(0,1fr) 132px}.composer{min-height:132px;padding-top:9px;padding-bottom:10px}.activityline{height:20px}.composebox{height:58px}.hints{margin-top:5px}.overview-header{display:flex!important;max-width:1450px;margin:0 auto 16px!important}.overview-header>div p:first-child{margin:0 0 6px}.overview-header h1{font-size:23px!important}.overview-header>div p:last-child{margin:0}.overview-header .button{display:none}.overview-grid{display:none!important}.overview-view{padding:24px 28px!important;background:#f6f7f3!important}.overview-header:after{content:'DEMO DATA · no agents connected';font-size:9px;color:#927c4e;background:#f3f0e7;border:1px solid #e9e2cf;border-radius:5px;padding:7px 9px;margin-left:auto;align-self:center}.command-center{max-width:1450px;margin:auto;background:#fff;border:1px solid #e4e7df;border-radius:10px;min-height:calc(100% - 62px);display:grid;grid-template-rows:46px minmax(0,1fr);box-shadow:0 8px 28px #20211f08}.command-content{min-height:0;overflow:auto;padding:22px}.command-view{display:none}.command-view.active{display:block}.command-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:15px;gap:16px}.command-section-head h2{font-size:15px;margin:0 0 4px}.command-section-head p{font-size:10px;color:#92968a;margin:0}.state-key{font-size:9px;color:#898d83}.state-dot{width:7px;height:7px;border-radius:50%;display:inline-block;margin:0 4px 0 8px;background:#b4b8ad}.state-dot.working{background:#88a96a}.state-dot.waiting{background:#c9a958}.state-dot.planning{background:#83a2bc}.state-dot.error{background:#bd7771}.agent-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.agent-grid .agent-entry{position:relative;border:1px solid #e8ebe4;border-radius:8px;padding:0 12px}.agent-grid .agent-entry:after{content:'DEMO';position:absolute;right:12px;bottom:8px;font-size:7px;letter-spacing:.5px;color:#a1a599}.agent-grid .agent-entry summary{grid-template-columns:9px minmax(0,1fr) auto;padding:13px 0;gap:10px}.agent-grid .agent-name{font-size:11px}.agent-grid .agent-task-short{font-size:9px}.agent-grid .agent-status{font-size:9px;padding:4px 7px;background:#f3f5ef;border-radius:10px}.agent-grid .agent-detail{font-size:9px;padding:10px 0 17px}.agent-grid .agent-detail span,.agent-grid .agent-detail b{font-size:9px}.agent-grid .agent-skills span{font-size:8px}.agent-grid .agent-note{font-size:9px}.empty-agent-state{padding:40px;text-align:center;color:#92968b}.agent-graph{min-height:380px;border:1px solid #eceee8;border-radius:9px;background:radial-gradient(#e1e5dc 1px,transparent 1px) 0 0/18px 18px #fbfcfa;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:27px;padding:28px}.layout.overview-mode~.composer{padding-left:23px}.layout.overview-mode~.composer .activityline,.layout.overview-mode~.composer .composebox,.layout.overview-mode~.composer .hints{max-width:1450px}@media(max-width:1100px){.overview-view{padding:18px!important}.agent-grid{grid-template-columns:1fr}.state-key{display:none}}@media(max-width:860px){.layout.overview-mode{grid-template-columns:158px minmax(0,1fr)}.overview-view{padding:14px!important}.overview-header h1{font-size:19px!important}}`;
  document.head.append(css);
  const heading = overview.querySelector('.overview-header');
  heading.innerHTML =
    '<div><p class="eyebrow">TECHNICALLY NOT / PROJECT</p><h1>Master control center</h1><p>See what every worker is doing, then open the tools you need.</p></div><div class="command-actions"><span class="sample-state">No live agents connected</span></div>';
  const grid = document.createElement('div');
  grid.className = 'command-center';
  grid.innerHTML = `<div class="command-content"><section class="command-view active" data-command-panel="agents"><div class="command-section-head"><div><h2>Project agents</h2><p>Role, task and current state at a glance. Demo workers are separated from real execution.</p></div><span class="state-key"><i class="state-dot working"></i>Working <i class="state-dot waiting"></i>Waiting <i class="state-dot planning"></i>Planning <i class="state-dot error"></i>Error</span></div><div class="agent-grid" id="commandAgentGrid"></div></section><section class="command-view" data-command-panel="graph"><div class="command-section-head"><div><h2>Agent hierarchy</h2><p>Parent and child relationships for this project.</p></div></div><div class="agent-graph" id="agentGraph"></div></section></div>`;
  overview.insertBefore(grid, overview.querySelector('.overview-grid'));
  const topStatus = document.querySelector('.top-right .status');
  if (topStatus) {
    topStatus.innerHTML = '<i class="dot"></i>Prototype · no agents connected';
    topStatus.querySelector('.dot').style.background = '#b4b8ad';
  }
  document.getElementById('activeWorkerLabel').textContent =
    'Technically Not ready · no agents connected';
  const list = document.getElementById('agentList'),
    cardGrid = document.getElementById('commandAgentGrid');
  if (list) {
    while (list.firstChild) cardGrid.append(list.firstChild);
    list.closest('.active-work').style.display = 'none';
  }
  const demoTasks = window.TnaiAgentTasks || [];
  const viewStateKey = 'tnai.commandCenter.v1';
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(viewStateKey) || '{}');
  } catch {}
  const persist = () => {
    try {
      localStorage.setItem(viewStateKey, JSON.stringify(saved));
    } catch {}
  };

  function setView(name) {
    grid
      .querySelectorAll('[data-command-panel]')
      .forEach(v => v.classList.toggle('active', v.dataset.commandPanel === name));
    saved.view = name;
    persist();
  }
  setView(saved.view || 'graph');
  const hierarchySig = () =>
      JSON.stringify(
        (window.TnaiAgentTasks || demoTasks).map(t => [
          t.agentName,
          t.status,
          t.title,
          t.description,
        ])
      ),
    syncedText = () =>
      'Synced ' +
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function renderAgentHierarchy(target) {
    if (!target) {
      document
        .querySelectorAll('#agentGraph,[data-hierarchy-mount]')
        .forEach(node => renderAgentHierarchy(node));
      return;
    }
    const tasks = window.TnaiAgentTasks || demoTasks,
      root = target;
    root.dataset.sig = hierarchySig();
    root.replaceChildren();
    const heading = document.createElement('div');
    heading.className = 'hierarchy-live-head';
    heading.innerHTML =
      '<strong>Agent assignments</strong><span class="hierarchy-live-indicator"><i></i> Live status</span>';
    root.append(heading);
    if (!tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'hierarchy-empty';
      empty.textContent = 'No agents assigned yet. New agents and their tasks will appear here.';
      root.append(empty);
      return;
    }
    tasks.forEach((task, index) => {
      const card = document.createElement('article');
      card.className = 'hierarchy-agent';
      card.dataset.status = String(task.status || 'idle').toLowerCase();
      const identity = document.createElement('div');
      identity.className = 'hierarchy-agent-identity';
      const dot = document.createElement('i');
      dot.className = 'hierarchy-status-dot';
      const name = document.createElement('b');
      name.textContent = task.agentName || 'Unassigned agent';
      const state = document.createElement('span');
      state.className = 'hierarchy-status-label';
      state.textContent = String(task.status || 'idle').toUpperCase();
      identity.append(dot, name, state);
      const assignment = document.createElement('div');
      assignment.className = 'hierarchy-assignment';
      const label = document.createElement('small');
      label.textContent = 'CURRENT TASK';
      const title = document.createElement('strong');
      title.textContent = task.title || task.description || 'No task assigned';
      const detail = document.createElement('span');
      detail.textContent = task.description && task.title ? task.description : '';
      assignment.append(label, title, detail);
      card.append(identity, assignment);
      if (index > 0) {
        const connector = document.createElement('span');
        connector.className = 'hierarchy-connector';
        connector.setAttribute('aria-hidden', 'true');
        card.prepend(connector);
      }
      root.append(card);
    });
    const updated = document.createElement('small');
    updated.className = 'hierarchy-updated';
    updated.textContent = syncedText();
    root.append(updated);
  }
  renderAgentHierarchy();
  window.TnaiAgentState = {
    renderInto(root) {
      renderAgentHierarchy(root);
    },
    update(agentName, patch) {
      const tasks = window.TnaiAgentTasks || [];
      const task = tasks.find(item => item.agentName === agentName || item.id === agentName);
      if (!task) return false;
      Object.assign(task, patch);
      renderAgentHierarchy();
      document.dispatchEvent(new CustomEvent('tnai:agent-updated', { detail: { agent: task } }));
      return true;
    },
    refresh: renderAgentHierarchy,
  };
  document.addEventListener('tnai:agent-updated', () => renderAgentHierarchy());
  setInterval(() => {
    if (document.hidden) return;
    document.querySelectorAll('#agentGraph,[data-hierarchy-mount]').forEach(node => {
      if (!(node.checkVisibility ? node.checkVisibility() : node.offsetParent)) return;
      if (node.dataset.sig !== hierarchySig()) renderAgentHierarchy(node);
      else {
        const u = node.querySelector(':scope>.hierarchy-updated');
        if (u) u.textContent = syncedText();
      }
    });
  }, 1000);
  document.querySelectorAll('.side-item').forEach(item => {
    const panel = item.dataset.panel;
    if (panel)
      item.onclick = () => {
        document.querySelectorAll('.side-item').forEach(x => x.classList.remove('active'));
        item.classList.add('active');
        if (panel === 'agent-graph' || panel === 'activity') {
          layout.classList.add('overview-mode');
          setView(panel === 'agent-graph' ? 'graph' : 'activity');
        }
        if (panel === 'preview') {
          layout.classList.add('overview-mode');
        }
      };
    if (item.dataset.view === 'overview')
      item.onclick = () => {
        layout.classList.remove('code-mode', 'terminal-mode');
        layout.classList.add('overview-mode');
        document
          .querySelectorAll('.side-item')
          .forEach(x => x.classList.toggle('active', x === item));
        setView('agents');
      };
    if (item.dataset.view === 'build')
      item.onclick = () => {
        layout.classList.remove('overview-mode', 'terminal-mode', 'code-mode');
        document
          .querySelectorAll('.side-item')
          .forEach(x => x.classList.toggle('active', x === item));
      };
  });
  document
    .getElementById('openBuild')
    ?.addEventListener('click', () => document.querySelector('[data-panel="preview"]')?.click());
  document
    .getElementById('projectOpenBuild')
    ?.addEventListener('click', () => document.querySelector('[data-panel="preview"]')?.click());
  document.getElementById('openAgents').onclick = () => {
    layout.classList.add('overview-mode');
    setView('agents');
  };
  document
    .querySelectorAll('.side-item[data-view="projects"]')
    .forEach(
      x => (x.onclick = () => toast('Project switching requires a connected project store.'))
    );
})();
