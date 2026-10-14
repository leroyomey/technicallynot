// Technically Not · 03-dock-workspace.js — Dock shell (header + content host for the Overview agent
// tree; its workspace-mode rules served the removed File repository page), sample repository rail,
// panel resizers, notification sound (window.TnaiNotify: stores the on/off choice; the checkbox is
// in Settings › Agents, 51)
/* Technically Not dock shell */
(() => {
  const layout = document.querySelector('.layout'),
    overview = document.getElementById('overviewView'),
    workspace = document.querySelector('.workspace');
  if (!layout || !overview || !workspace) return;
  const css = document.createElement('style');
  css.textContent = `.layout.overview-mode{grid-template-columns:205px minmax(0,1fr) minmax(340px,31vw);background:#f5f6f2}.layout.overview-mode .overview-view{grid-column:2;grid-row:1;min-width:0}.layout.overview-mode .workspace{grid-column:3;grid-row:1;display:grid!important;grid-template:1fr/1fr;min-width:0;border-left:1px solid #e2e5dd;border-right:0;background:#f2f3ef}.layout.overview-mode .workspace>.tabs,.layout.overview-mode .workspace>.code-area{display:none!important}.dock-zone{display:grid;grid-template-rows:48px minmax(0,1fr);min-height:0}.dock-head{display:flex;align-items:center;justify-content:space-between;padding:0 12px;background:#fff;border-bottom:1px solid #e3e6df}.dock-title{font-size:11px;font-weight:650;color:#4c5047}.dock-scroll{overflow:auto;min-height:0;padding:10px}.layout.overview-mode .preview{display:none}@media(max-width:1100px){.layout.overview-mode{grid-template-columns:158px minmax(290px,1fr) minmax(260px,34vw)}.dock-scroll{padding:7px}}@media(max-width:860px){.layout.overview-mode{grid-template-columns:150px minmax(275px,1fr) minmax(250px,34vw)}.overview-view{padding-left:10px!important;padding-right:10px!important}.dock-head{padding:0 7px}}`;
  document.head.append(css);
  const layoutFix = document.createElement('style');
  layoutFix.textContent = `.sidebar>.mini-brand{display:none!important}.layout.workspace-mode{display:grid!important;grid-template-columns:var(--nav-width,205px) minmax(0,1fr)!important;width:100%!important;min-width:0!important}.layout.workspace-mode>.sidebar{grid-column:1!important;grid-row:1!important}.layout.workspace-mode>.workspace{display:grid!important;grid-column:2!important;grid-row:1!important;width:100%!important;min-width:0!important;min-height:0!important;grid-template-rows:minmax(0,1fr)!important}.layout.workspace-mode>.preview,.layout.workspace-mode>.overview-view,.layout.workspace-mode>.tnai-resizer{display:none!important}.layout.workspace-mode .dock-zone{width:100%;min-width:0;min-height:0;grid-template-rows:50px minmax(0,1fr)}.layout.workspace-mode .dock-scroll{padding:12px 14px 14px}.layout.terminal-mode{grid-template-columns:var(--nav-width,205px) minmax(0,1fr)!important;width:100%!important}.layout.terminal-mode>.sidebar{grid-column:1!important}.layout.terminal-mode>.workspace{display:grid!important;grid-column:2!important;width:100%!important;min-width:0!important}.layout.terminal-mode .terminal-view{width:100%;min-width:0}.layout.workspace-mode .dock-zone{grid-template-rows:50px minmax(0,1fr);min-width:0}.layout.workspace-mode .dock-content{display:grid;grid-template-columns:minmax(0,1fr) clamp(230px,21vw,320px);min-width:0;min-height:0;overflow:hidden;border-radius:0 0 10px 10px}.dock-content{display:grid!important;grid-template-columns:minmax(0,1fr) clamp(240px,22vw,330px)!important;grid-template-rows:minmax(0,1fr);width:100%;height:100%;min-width:0;min-height:0;overflow:hidden}.dock-content>.dock-scroll{grid-column:1;grid-row:1;width:auto;max-width:100%;min-width:0;min-height:0}.dock-content>.repository-rail{grid-column:2;grid-row:1;width:100%;max-width:none;min-width:0;min-height:0;justify-self:stretch;align-self:stretch}.layout.workspace-mode .repository-rail{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:auto;padding:15px 12px;background:#fff;border-left:1px solid #e5e8e0}.repository-rail-head{display:flex;justify-content:space-between;align-items:center;gap:8px}.repository-rail-head>div{display:grid;gap:4px}.repository-rail-head strong{font:600 11px var(--pg-sans);color:#44493f}.repository-rail-head small,.repository-rail-note{font:9px/1.4 var(--pg-sans);color:#95998f}.repository-rail-head button{box-sizing:border-box;border:1px solid #e5e8e0;background:#fff;border-radius:6px;color:#73796c;width:24px;height:24px;padding:0;cursor:pointer}.repo-rail-search{height:31px;margin:12px 0 8px;padding:0 8px;border:1px solid #e5e8e0;border-radius:5px;font:10px var(--pg-sans)}.repo-rail-tree{display:grid;gap:2px;align-content:start;min-width:0}.repo-folder-children{display:grid;gap:1px;min-width:0}.repo-folder-children[hidden]{display:none}.repo-row{display:grid!important;grid-template-columns:14px 16px minmax(0,1fr);align-items:center;gap:6px;width:100%;min-width:0;min-height:30px!important;padding:4px 6px!important;border:0;border-radius:5px;background:transparent;text-align:left;color:#596052;font:10px var(--pg-sans);cursor:pointer}.repo-row[hidden]{display:none!important}.repo-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.repo-depth-1{padding-left:18px!important}.repo-depth-2{padding-left:37px!important}.repo-chevron{color:#899081;text-align:center}.repo-folder-icon{color:#8c9e71;text-align:center}.repo-file-icon{display:grid;place-items:center;width:15px;height:16px;border-radius:3px;background:#eff2ea;color:#71815a;font:700 7px var(--pg-sans)}.repo-file-icon.css{color:#6d8aad;background:#edf2f7}.repo-file-icon.json{color:#ad9360;background:#f5f1e7}.repo-file-icon.md{color:#858a82;background:#f0f1ee}.repo-rail-tree button{display:flex;align-items:center;gap:6px;min-height:30px;padding:5px 6px;border:0;border-radius:5px;background:transparent;text-align:left;color:#596052;font:10px var(--pg-sans);cursor:pointer}.repo-rail-tree button:hover{background:#f2f4ee}.repo-rail-tree button small{color:#92978c}.repo-rail-tree button[hidden]{display:none}.repository-rail-note{margin-top:10px;padding-top:9px;border-top:1px solid #edf0ea}.layout.workspace-mode .dock-scroll{padding:10px}.layout.workspace-mode .terminal-view{min-height:0}.layout.workspace-mode .dock-content{transition:grid-template-columns .2s ease}@media(max-width:1100px){.layout.workspace-mode .dock-content{grid-template-columns:minmax(0,1fr) 230px}.layout.workspace-mode .repository-rail{padding:11px 8px}}.layout.workspace-mode .dock-head{gap:14px;padding:0 18px}.composer{padding-left:24px!important;padding-right:24px!important}.composer>.activityline,.composer>.composebox,.composer>.hints{max-width:1500px;margin-left:auto;margin-right:auto}.composer>.activityline{width:100%}.composer>.composebox{width:100%}@media(min-width:1600px){.layout.workspace-mode .dock-scroll{padding-left:20px;padding-right:20px}}`;
  document.head.append(layoutFix);
  const dock = document.createElement('section');
  dock.className = 'dock-zone';
  dock.innerHTML =
    '<header class="dock-head"><b class="dock-title">Workspace</b></header><div class="dock-content"><div class="dock-scroll"></div><aside class="repository-rail"><div class="repository-rail-head"><div><strong>File Repository</strong><small>Project files</small></div><button type="button" id="repoRefresh" title="Refresh file list">↻</button></div><input class="repo-rail-search" id="repoRailSearch" placeholder="Filter files…" aria-label="Filter repository files"><div class="repo-rail-tree" role="tree"><button class="repo-row repo-folder" data-repo-folder="src" aria-expanded="true"><span class="repo-chevron">▾</span><span class="repo-folder-icon">▰</span><span class="repo-row-name">src</span></button><div class="repo-folder-children" data-folder-children="src"><button class="repo-row repo-folder repo-depth-1" data-repo-folder="app" aria-expanded="true"><span class="repo-chevron">▾</span><span class="repo-folder-icon">▰</span><span class="repo-row-name">app</span></button><div class="repo-folder-children" data-folder-children="app"><button class="repo-row repo-file repo-depth-2" data-repo-path="src/app/ProjectWorkspace.tsx"><span class="repo-file-icon ts">TS</span><span class="repo-row-name">ProjectWorkspace.tsx</span></button></div><button class="repo-row repo-folder repo-depth-1" data-repo-folder="components" aria-expanded="false"><span class="repo-chevron">›</span><span class="repo-folder-icon">▰</span><span class="repo-row-name">components</span></button><div class="repo-folder-children" data-folder-children="components" hidden><button class="repo-row repo-file repo-depth-2" data-repo-path="src/components/WorkspaceCard.tsx"><span class="repo-file-icon ts">TS</span><span class="repo-row-name">WorkspaceCard.tsx</span></button></div><button class="repo-row repo-folder repo-depth-1" data-repo-folder="styles" aria-expanded="false"><span class="repo-chevron">›</span><span class="repo-folder-icon">▰</span><span class="repo-row-name">styles</span></button><div class="repo-folder-children" data-folder-children="styles" hidden><button class="repo-row repo-file repo-depth-2" data-repo-path="src/styles/project.css"><span class="repo-file-icon css">#</span><span class="repo-row-name">project.css</span></button></div></div><button class="repo-row repo-file" data-repo-path="package.json"><span class="repo-file-icon json">{ }</span><span class="repo-row-name">package.json</span></button><button class="repo-row repo-file" data-repo-path="README.md"><span class="repo-file-icon md">M</span><span class="repo-row-name">README.md</span></button></div><p class="repository-rail-note">Sample structure · connect a project to browse its real files.</p></aside></div>';
  workspace.append(dock);
  const navSplit = document.createElement('div'),
    workSplit = document.createElement('div');
  navSplit.className = 'tnai-resizer nav-resizer';
  workSplit.className = 'tnai-resizer workspace-resizer';
  for (const [el, label] of [
    [navSplit, 'Resize navigation'],
    [workSplit, 'Resize workspace'],
  ]) {
    el.setAttribute('role', 'separator');
    el.setAttribute('aria-orientation', 'vertical');
    el.setAttribute('aria-label', label);
    el.tabIndex = 0;
    layout.append(el);
  }
  let widths = {};
  try {
    widths = JSON.parse(localStorage.getItem('tnai.panelWidths.v1') || '{}') || {};
  } catch {}
  if (widths.nav) layout.style.setProperty('--nav-width', widths.nav + 'px');
  if (widths.dock) layout.style.setProperty('--dock-width', widths.dock + 'px');

  function bindResizer(el, key, min, max, variable) {
    let start = 0,
      initial = 0;
    el.onpointerdown = e => {
      e.preventDefault();
      start = e.clientX;
      initial = parseFloat(getComputedStyle(layout).getPropertyValue(variable)) || initial;
      el.setPointerCapture(e.pointerId);
      const move = ev => {
        const delta = key === 'nav' ? ev.clientX - start : start - ev.clientX;
        const width = Math.max(min, Math.min(max, initial + delta));
        layout.style.setProperty(variable, width + 'px');
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        widths[key] = parseFloat(getComputedStyle(layout).getPropertyValue(variable));
        try {
          localStorage.setItem('tnai.panelWidths.v1', JSON.stringify(widths));
        } catch {}
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    el.onkeydown = e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const curr = parseFloat(getComputedStyle(layout).getPropertyValue(variable)) || initial;
      const sign = (e.key === 'ArrowRight' ? 1 : -1) * (key === 'dock' ? -1 : 1);
      const width = Math.max(min, Math.min(max, curr + sign * 20));
      layout.style.setProperty(variable, width + 'px');
      widths[key] = width;
      try {
        localStorage.setItem('tnai.panelWidths.v1', JSON.stringify(widths));
      } catch {}
    };
  }
  bindResizer(navSplit, 'nav', 150, 300, '--nav-width');
  bindResizer(workSplit, 'dock', 270, Math.max(360, innerWidth - 650), '--dock-width');
  document.getElementById('repoRailSearch').oninput = e =>
    document
      .querySelectorAll('.repo-rail-tree [data-repo-path]')
      .forEach(
        file =>
          (file.hidden = !file.textContent.toLowerCase().includes(e.target.value.toLowerCase()))
      );
  document.getElementById('repoRefresh').onclick = () => toast('Repository view refreshed');
  document.querySelectorAll('.repo-rail-tree [data-repo-folder]').forEach(
    folder =>
      (folder.onclick = () => {
        const key = folder.dataset.repoFolder,
          children = dock.querySelector(`[data-folder-children=\"${key}\"]`);
        if (!children) return;
        const open = children.hidden;
        children.hidden = !open;
        folder.setAttribute('aria-expanded', String(open));
        folder.querySelector('.repo-chevron').textContent = open ? '▾' : '›';
      })
  );
  document
    .querySelectorAll('.repo-rail-tree [data-repo-path]')
    .forEach(file => (file.onclick = () => toast('Sample path: ' + file.dataset.repoPath)));
  const soundKey = 'tnai.notificationSounds.v1';
  let soundOn = false,
    heldSound = false;

  /* a sound asked for while the mic records (69) is held and played once when the recording ends, so it is never recorded into a voice prompt */ window.addEventListener(
    'tnai:voice-recording-ended',
    () => {
      if (heldSound) {
        heldSound = false;
        window.TnaiNotify.play();
      }
    }
  );
  try {
    soundOn = localStorage.getItem(soundKey) === 'on';
  } catch {}
  window.TnaiNotify = {
    enabled: () => soundOn,
    setEnabled(on) {
      soundOn = !!on;
      try {
        localStorage.setItem(soundKey, soundOn ? 'on' : 'off');
      } catch {}
    },
    play() {
      if (!soundOn) return;
      if (window.TnVoiceRecorder && window.TnVoiceRecorder.recording) {
        heldSound = true;
        return;
      }
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)(),
          osc = ctx.createOscillator(),
          gain = ctx.createGain();
        osc.frequency.value = 660;
        gain.gain.setValueAtTime(0.025, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
        osc.onended = () => ctx.close();
      } catch {}
    },
  };
})();
