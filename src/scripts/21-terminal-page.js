// Technically Not · 21-terminal-page.js — Terminal page: ＋ Terminal (empty pane with an inline
// connection picker), renaming panes and workspaces (workspace tabs: click only switches; ✎ or F2
// renames), closing a workspace (× on its tab, in-app confirm when sessions are live;
// window.TnaiTerminalWorkspaces.close), AI-agent style pane names (window.TnaiPaneNames), and a
// pane grid that stays readable from 1 to 12 panes (window.TnaiTerminalGrid).
(() => {
  const view = document.getElementById('terminalView'),
    content = view?.querySelector('.terminal-content');
  if (!view || !content) return;

  const PANES_KEY = 'tnai.terminals.v1';
  const NAMES = [
    'Nova',
    'Atlas',
    'Orion',
    'Vega',
    'Juno',
    'Echo',
    'Sable',
    'Lyra',
    'Iris',
    'Onyx',
    'Rook',
    'Pike',
    'Wren',
    'Finch',
    'Ember',
    'Quill',
    'Sage',
    'Ash',
    'Cedar',
    'Flint',
    'Hazel',
    'Indigo',
    'Jade',
    'Kite',
    'Lumen',
    'Mica',
    'Nimbus',
    'Opal',
    'Pixel',
    'Quartz',
    'Rune',
    'Sol',
    'Talon',
    'Umber',
    'Vale',
    'Willow',
    'Zephyr',
    'Aria',
    'Bolt',
    'Cinder',
    'Dash',
    'Fern',
    'Glint',
    'Halo',
    'Ion',
    'Jett',
    'Kestrel',
    'Lark',
    'Moss',
    'Nyx',
    'Oak',
    'Pulse',
    'Remy',
    'Spark',
    'Tern',
    'Vesper',
    'Wisp',
    'Yarrow',
    'Zinc',
    'Comet',
    'Ridge',
  ];

  const style = document.createElement('style');
  style.textContent = `
/* The composer is hidden on Terminal; give its row back to the panes. */
.app:has(>.layout.terminal-mode){grid-template-rows:58px minmax(0,1fr) 0!important}
.terminal-workspace-grid{gap:var(--workspace-gap,10px)!important}
/* One header row: title, workspace tabs + ＋ Workspace (scroll sideways when many), then ＋ Terminal / A− / A+ (＋ Add connection lives in each empty panel).
   #newTerminalWindow stays for scripts (TnaiAgents.open), never shown. */
#newTerminalWindow{display:none!important}
/*
   The workspace bar (07) moves into the toolbar below; its old second row is gone. */
.layout.terminal-mode .terminal-view{grid-template-rows:44px minmax(0,1fr)!important;padding:var(--page-pad)!important;padding-top:0!important}
.layout.terminal-mode .terminal-toolbar{box-sizing:border-box;height:44px;gap:12px;min-width:0;padding:0 2px;border-bottom:1px solid #edf0ea}
.layout.terminal-mode .terminal-toolbar>div:first-child{flex:none;white-space:nowrap}
.layout.terminal-mode .terminal-toolbar .terminal-workspaces{flex:1 1 0;min-width:0;height:100%;padding:0;border:0;background:none}
.layout.terminal-mode .terminal-toolbar .terminal-workspace-tabs{min-width:120px}
.layout.terminal-mode .terminal-toolbar .terminal-tools{flex:none}
/* Narrow window (768 px, a Windows Snap half at 125%): the tab strip (it scrolls) gives way so ＋ Terminal / ＋ Workspace stay inside the bar, not under ＋ Add connection. */
@media (max-width:900px){.layout.terminal-mode .terminal-toolbar .terminal-workspace-tabs{min-width:60px}.layout.terminal-mode .terminal-toolbar .terminal-workspaces{gap:6px}}
@media (max-width:1280px){.layout.terminal-mode .terminal-subtitle{display:none}}
/* Keep pane tops clear of the header line above them. */
.layout.terminal-mode .terminal-content.terminal-grid{box-sizing:border-box;padding-top:10px!important}
.terminal-workspace-tab[hidden]{display:none!important}
.terminal-pane-title{cursor:text}
.terminal-pane-title:empty:before{content:'New terminal';color:#a7ac9f;font-weight:400}
/* Narrow panes: the header's labels shrink and ellipsize so the pane tools (close ×) always stay visible. */
.terminal-pane-head{min-width:0;container-type:inline-size}
.terminal-pane-head>:not(.terminal-pane-tools){min-width:0;flex-shrink:1}
.terminal-pane-head>.terminal-pane-title{flex:0 1 auto;min-width:28px}
.terminal-pane-head>.terminal-provider-select{flex:0 1 auto;min-width:64px;text-overflow:ellipsis}
.terminal-pane-head>.terminal-pane-state{flex:0 1 auto;overflow:hidden}
.terminal-pane-head>.terminal-pane-state>span{overflow:hidden;text-overflow:ellipsis}
.terminal-pane-head>.terminal-pane-tools{flex:none;margin-left:auto}
.terminal-pane-head>.terminal-pane-state~.terminal-pane-tools{margin-left:0}
@container (max-width:300px){.terminal-pane-head>.terminal-pane-state>span{display:none}}
.tnai-rename-input{flex:0 1 150px;min-width:70px;height:23px;padding:0 7px;border:1px solid #bccaa9;border-radius:5px;background:#fff;color:#3e4438;font:600 10px var(--pg-sans);outline:none;box-shadow:0 0 0 3px #eef3e7}
.terminal-workspaces .tnai-rename-input{flex:none;width:150px;height:30px}
/* Close-workspace confirm (.tnai-ws-close-*): its look is the shared dialog in src/styles/01-base.css. */
.terminal-pane .terminal-output:has(>.tnai-launcher){padding:0!important;background:#fbfcf9;container-type:size}
.terminal-pane .terminal-output.tnai-launching>:not(.tnai-launcher,.terminal-launcher-overlay){display:none!important}
.terminal-start-state.tnai-launcher{display:flex;align-items:center;justify-content:center;min-height:100%;padding:12px}
.terminal-pane:has(.tnai-launcher) .terminal-provider-select{display:none}
.tnai-launcher .tnai-add-connection{box-sizing:border-box;height:30px;margin:0;padding:0 10px;white-space:nowrap;border:1px solid #d7ddcf;border-radius:7px;background:#fff;color:#5f7447;font:600 11px var(--pg-sans);cursor:pointer;transition:border-color .14s,background .14s}
.tnai-launcher .tnai-add-connection:hover{border-color:#bec9ad;background:#f6f9f2}
/* Connection picker inside an empty panel. 06 moves the same picker into
   the panel's body, beside this start state (.tnai-picking on the body), when it is opened from the panel's own Add connection: it fills the panel's body instead of floating, and takes
   its shape from the panel's size (the body is a size container, above): three columns from 900 px, two by default, one under 380 px with what can
   be opened first; a small panel drops the explanations and keeps every choice. Opened from anywhere else, the popover is unchanged. */
:root:not(#pg) .terminal-output.tnai-picking>.tnai-launcher{display:none}
:root:not(#pg) .tnai-picking .terminal-launcher{position:absolute!important;inset:0!important;z-index:1;width:auto;max-height:none!important;margin:0;padding:14px max(14px,calc((100% - 1100px)/2));border:0;border-radius:0;background:transparent;box-shadow:none;backdrop-filter:none;text-align:left}
@container (min-width:900px){
  :root:not(#pg) .tnai-picking .terminal-launcher-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@container (max-width:439px) or (max-height:429px){
  :root:not(#pg) .tnai-picking .terminal-launcher{padding:10px}
  :root:not(#pg) .tnai-picking .terminal-launcher>header{padding-bottom:8px}
  :root:not(#pg) .tnai-picking .terminal-launcher :is(header p,.terminal-launcher-foot,.wt-option small){display:none}
  :root:not(#pg) .tnai-picking .wt-option{margin-bottom:8px;padding:6px 9px}
  :root:not(#pg) .tnai-picking .terminal-launcher-grid{gap:4px}
  :root:not(#pg) .tnai-picking .terminal-provider-card{height:38px}
}
@container (max-width:379px){
  :root:not(#pg) .tnai-picking .terminal-launcher-grid{grid-template-columns:minmax(0,1fr)}
  :root:not(#pg) .tnai-picking .terminal-provider-card:disabled{order:1}
}
/* Compact and dense grids: smaller chrome so the terminal and its input keep the space. */
.terminal-workspace-grid[data-density=compact] .terminal-pane,.terminal-workspace-grid[data-density=dense] .terminal-pane{grid-template-rows:30px minmax(0,1fr) 36px!important;border-radius:7px}
.terminal-workspace-grid[data-density=compact] .terminal-pane.tnai-live,.terminal-workspace-grid[data-density=dense] .terminal-pane.tnai-live{grid-template-rows:30px minmax(0,1fr)!important}
.terminal-workspace-grid[data-density] .terminal-pane-head{gap:6px;padding:0 6px 0 8px}
.terminal-workspace-grid[data-density=compact] .terminal-provider-select,.terminal-workspace-grid[data-density=dense] .terminal-provider-select{height:21px;max-width:112px;font-size:9px}
.terminal-workspace-grid[data-density=compact] .terminal-pane-tools button,.terminal-workspace-grid[data-density=dense] .terminal-pane-tools button{width:20px;height:20px;padding:0}
.terminal-workspace-grid[data-density=compact] .terminal-pane .terminal-input,.terminal-workspace-grid[data-density=dense] .terminal-pane .terminal-input{height:28px;margin:0 6px 6px;padding:0 6px}
.terminal-workspace-grid[data-density=compact] .terminal-pane .terminal-input button,.terminal-workspace-grid[data-density=dense] .terminal-pane .terminal-input button{height:21px}
.terminal-workspace-grid[data-density=compact] .terminal-context-state,.terminal-workspace-grid[data-density=dense] .terminal-context-state{display:none}
.terminal-workspace-grid[data-density=compact] .terminal-pane>.terminal-output,.terminal-workspace-grid[data-density=dense] .terminal-pane>.terminal-output{padding:8px 10px}
.terminal-workspace-grid[data-density=compact] .tnai-xterm,.terminal-workspace-grid[data-density=dense] .tnai-xterm{padding:4px 2px 2px 7px}
.terminal-workspace-grid[data-density=dense] .terminal-pane-state span{display:none}
.terminal-workspace-grid[data-density=dense] .terminal-provider-select{max-width:92px}
/* Maximized pane (double-click its header): it fills the grid; the others wait as chips in a slim strip below. */
.terminal-workspace-grid.tnai-maxed{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr) auto!important;overflow:hidden!important}
.terminal-workspace-grid.tnai-maxed>.terminal-pane:not(.tnai-max-pane){display:none!important}
.terminal-workspace-grid.tnai-maxed>.tnai-max-pane{grid-row:1;grid-column:1}
.tnai-max-strip{grid-row:2;grid-column:1;display:flex;align-items:center;gap:6px;min-width:0;height:30px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none}
.tnai-max-strip[hidden]{display:none}
.tnai-max-strip>button{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex:none;height:26px;max-width:180px;margin:0;padding:0 10px;border:1px solid #e1e5dc;border-radius:7px;background:#fff;color:#5b6254;font:600 11px var(--pg-sans);cursor:pointer;transition:border-color .14s,background .14s}
.tnai-max-strip>button:hover{border-color:#bec9ad;background:#f6f9f2}
.tnai-max-strip>button>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-max-chip>i{flex:none;width:7px;height:7px;border-radius:50%;background:var(--st-idle-dot,#b5b9b0)}
.tnai-max-chip[data-status=working]>i{background:var(--st-working-dot,#7fa855)}
.tnai-max-chip[data-status=needs-you]>i{background:var(--st-waiting-dot,#c7a24e)}.tnai-max-chip[data-status=waiting]>i{background:var(--st-done-dot,#5b8fd6)}.tnai-max-chip[data-status=starting]>i{background:var(--st-working-dot,#7fa855)}
.tnai-max-chip[data-status=waiting-agents]>i{background:var(--st-agents-dot)}
.tnai-max-chip[data-status=background]>i{background:var(--st-background-dot)}
.tnai-max-chip[data-status=error]>i{background:var(--st-error-dot,#bd6b5f)}
.tnai-max-strip>.tnai-max-restore{margin-left:auto;color:#5f7447}
/* Maximize / restore button in each pane header (same look as ✎ ↻ ×); only when the workspace has another pane to hide. */
.terminal-pane-tools>[data-tnai-max]{display:inline-grid;place-items:center}
.terminal-pane-tools>[data-tnai-max] svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
.terminal-workspace-grid:not(:has(>.terminal-pane~.terminal-pane)) [data-tnai-max]{display:none}
`;
  document.head.append(style);

  const toastSafe = text => {
      try {
        toast(text);
      } catch {}
    },
    say = toastSafe;
  const titleOf = pane => pane?.querySelector('.terminal-pane-title');
  const nameOf = pane => titleOf(pane)?.textContent.trim() || '';
  const allPanes = () => [...content.querySelectorAll('.terminal-pane')];
  const sessionOf = pane =>
    window.TnaiAgents?.sessions?.().find(s => s.paneId === pane.dataset.paneId) || null;

  // ---- Names: short agent-style names, unique among open panes and custom agents ----
  function namesInUse(exceptPane, exceptAgentId) {
    const panes = allPanes()
      .filter(p => p !== exceptPane)
      .map(nameOf);
    const agents = (window.TnaiCustomAgents?.list?.() || [])
      .filter(a => a.id !== exceptAgentId)
      .map(a => a.name);
    return panes.concat(agents).filter(Boolean);
  }

  function pick() {
    // Sub-agents shown inside a panel (19) have names from the same list: a new panel must not
    // repeat one.
    const used = new Set(
      namesInUse()
        .concat(window.TnaiTeam?.aliases?.() || [])
        .map(n => n.toLowerCase())
    );
    const free = NAMES.filter(n => !used.has(n.toLowerCase()));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    for (let i = 2; ; i++)
      for (const n of NAMES) if (!used.has((n + ' ' + i).toLowerCase())) return n + ' ' + i;
  }

  // Same record 04 and 07 persist: in-memory pane record + `tnai.terminals.v1`.
  function storeName(paneId, name) {
    const record = window.TnaiTerminalPaneRecords?.find(r => r.id === paneId);
    if (record) record.name = name;
    try {
      const saved = JSON.parse(localStorage.getItem(PANES_KEY) || '[]');
      const item = Array.isArray(saved) && saved.find(p => p.id === paneId);
      if (item) {
        item.name = name;
        localStorage.setItem(PANES_KEY, JSON.stringify(saved));
      }
    } catch {}
  }

  function setName(pane, name) {
    const title = titleOf(pane);
    if (!title) return;
    const previous = title.textContent;
    title.textContent = name;
    storeName(pane.dataset.paneId, name);
    window.dispatchEvent(
      new CustomEvent('tnai:terminal-pane-renamed', {
        detail: { paneId: pane.dataset.paneId, name, previous },
      })
    );
  }

  // Names are kept exactly as typed (trimmed); empty keeps the old name; a clash is refused, never
  // suffixed.
  async function renamePane(pane, raw, quiet) {
    // quiet: a name the app gives (90), no toast for it
    const toastSafe = quiet ? () => {} : say;
    const old = nameOf(pane),
      name = String(raw || '').trim();
    if (!name || name === old) return { ok: false, unchanged: true };
    const session = sessionOf(pane);
    if (session?.customAgentId && window.TnaiCustomAgents?.rename) {
      // A custom agent's pane carries the agent's name: rename the agent (17 re-titles its panes).
      try {
        await window.TnaiCustomAgents.rename(session.customAgentId, name);
      } catch (error) {
        toastSafe(error.message);
        return { ok: false, error: error.message };
      }
      window.dispatchEvent(
        new CustomEvent('tnai:terminal-pane-renamed', {
          detail: { paneId: pane.dataset.paneId, name, previous: old },
        })
      );
      toastSafe('Custom agent ' + old + ' renamed to ' + name);
      return { ok: true, name, customAgent: true };
    }

    // Only a name the user can see on a panel blocks a rename (before, "Fixer"
    // was refused with no Fixer in sight; a saved custom agent held it). A custom agent with no
    // panel open no longer reserves its name; 17 refuses to deploy it beside a panel of that name
    // instead. New panels still never get a custom agent's name by themselves (pick, above).
    const clash = allPanes()
      .filter(p => p !== pane)
      .map(nameOf)
      .filter(Boolean)
      .find(n => n.toLowerCase() === name.toLowerCase());
    if (clash) {
      const error = 'A thread is already named “' + clash + '”. Choose a different name.';
      toastSafe(error);
      return { ok: false, error };
    }
    setName(pane, name);
    toastSafe(old ? old + ' renamed to ' + name : 'Thread named ' + name);
    return { ok: true, name };
  }

  // Inline editor: Enter or leaving the field saves, Esc cancels.
  // withCancel: a small × stands beside the field, so backing out does not depend on knowing
  // that Esc does it (the user: "We need a way to cancel or close if user wants to back out").
  function inlineEdit(anchor, value, label, commit, onEnd, withCancel) {
    const input = document.createElement('input');
    input.className = 'tnai-rename-input';
    input.value = value;
    input.maxLength = 40;
    input.setAttribute('aria-label', label);
    input.title = 'Enter saves, Esc cancels';
    anchor.hidden = true;
    anchor.after(input);
    let cancel = null;
    if (withCancel) {
      cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'tnai-rename-cancel';
      cancel.innerHTML = window.TnaiIcon?.('x', { size: 13 }) || '×';
      cancel.title = 'Cancel (Esc)';
      cancel.setAttribute('aria-label', 'Cancel renaming');

      // the press must not take the keyboard from the field first: leaving the field saves
      cancel.addEventListener('mousedown', e => e.preventDefault());
      cancel.addEventListener('click', e => {
        e.stopPropagation();
        finish(false);
      });
      input.after(cancel);
    }
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
      if (done) return;
      done = true;
      const text = input.value;
      input.remove();
      cancel?.remove();
      anchor.hidden = false;
      onEnd?.();
      if (save) commit(text);
    };
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    ['click', 'dblclick', 'mousedown', 'pointerdown'].forEach(type =>
      input.addEventListener(type, e => e.stopPropagation())
    );
    return input;
  }

  function editPane(pane) {
    const title = titleOf(pane),
      head = pane.querySelector('.terminal-pane-head');
    if (!title || title.hidden) return null;
    const wasDraggable = head?.draggable;
    if (head) head.draggable = false;
    return inlineEdit(
      title,
      nameOf(pane),
      'Rename terminal',
      text => renamePane(pane, text),
      () => {
        if (head) head.draggable = wasDraggable;
      }
    );
  }

  function editWorkspace(tab) {
    const id = tab?.dataset.workspaceTab,
      api = window.TnaiTerminalWorkspaces;
    if (!id || !api || tab.hidden) return null;
    if (id !== api.activeId()) {
      tab.click();
      tab = view.querySelector('[data-workspace-tab="' + CSS.escape(id) + '"]');
      if (!tab) return null;
    }
    const current = api.list().find(w => w.id === id)?.name || '';
    return inlineEdit(
      tab,
      current,
      'Rename workspace',
      text => {
        const result = api.rename(id, text);
        if (result.ok) toastSafe(current + ' renamed to ' + result.name);
        else if (result.error) toastSafe(result.error);
      },
      null,
      true
    );
  }

  // Panes start unnamed; the first connection started in one (picker, dialog, composer lead,
  // restore) gives it an agent-style name.
  function nameIfUnnamed(pane) {
    if (pane && !nameOf(pane)) setName(pane, pick());
  }
  content.addEventListener(
    'change',
    e => {
      if (e.target.matches?.('.terminal-provider-select') && e.target.value)
        nameIfUnnamed(e.target.closest('.terminal-pane'));
    },
    true
  );
  const nameSessions = () =>
    (window.TnaiAgents?.sessions?.() || []).forEach(s =>
      nameIfUnnamed(
        content.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(s.paneId) + '"]')
      )
    );
  window.TnaiAgents?.onChange?.(nameSessions);

  content.addEventListener('dblclick', e => {
    const title = e.target.closest('.terminal-pane-title');
    if (!title) return;
    e.preventDefault();
    editPane(title.closest('.terminal-pane'));
  });
  content.addEventListener('click', e => {
    const button = e.target.closest('[data-tnai-rename]');
    if (!button) return;
    e.stopPropagation();
    editPane(button.closest('.terminal-pane'));
  });

  // Workspace tabs: a click (single or double) only switches (07); rename via the tab's ✎ or F2,
  // close via its ×.
  const wsTabs = view.querySelector('.terminal-workspace-tabs');
  wsTabs?.addEventListener('click', e => {
    const rename = e.target.closest('[data-ws-rename]'),
      close = e.target.closest('[data-ws-close]');
    if (rename) {
      e.stopPropagation();
      editWorkspace(rename.closest('.terminal-workspace-tab'));
    } else if (close) {
      e.stopPropagation();
      closeWorkspace(close.dataset.wsClose);
    }
  });
  wsTabs?.addEventListener('keydown', e => {
    const tab = e.target.closest?.('.terminal-workspace-tab');
    if (tab && e.key === 'F2') {
      e.preventDefault();
      editWorkspace(tab);
    }
  });

  // ---- Close a workspace: ask only when it has live sessions; closing uses each pane's own × (04
  // → 10 stops the process) ----
  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

  function workspaceActivity(id) {
    const section = [...content.querySelectorAll('.terminal-workspace-view')].find(
      v => v.dataset.workspaceId === id
    );
    const panes = section ? [...section.querySelectorAll('.terminal-pane')] : [];
    const ids = new Set(panes.map(p => p.dataset.paneId));
    const live = (window.TnaiAgents?.sessions?.() || []).filter(
      s => ids.has(s.paneId) && (s.running || s.status === 'starting')
    );
    return {
      panes,
      live: live.length,
      working: live.filter(s => s.status === 'working' || s.status === 'starting').length,
    };
  }
  const closeDialog = document.createElement('div');
  closeDialog.className = 'tnai-ws-close-overlay';
  closeDialog.hidden = true;
  closeDialog.innerHTML =
    '<section class="tnai-ws-close-modal" role="dialog" aria-modal="true" aria-labelledby="tnaiWsCloseTitle" aria-describedby="tnaiWsCloseBody"><h2 id="tnaiWsCloseTitle"></h2><p id="tnaiWsCloseBody"></p><div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel">Cancel</button><button type="button" class="tnai-ws-close-confirm"></button></div></section>';
  document.body.append(closeDialog);
  const [dlgTitle, dlgBody, dlgCancel, dlgConfirm] = [
    'h2',
    'p',
    '.tnai-ws-close-cancel',
    '.tnai-ws-close-confirm',
  ].map(q => closeDialog.querySelector(q));
  let settle = null,
    returnFocus = null;

  function ask(title, body, confirmText, danger) {
    settle?.(false);
    dlgTitle.textContent = title;
    dlgBody.textContent = body;
    dlgConfirm.textContent = confirmText;
    dlgConfirm.toggleAttribute('data-danger', !!danger);
    returnFocus = document.activeElement;
    closeDialog.hidden = false;
    dlgCancel.focus();
    return new Promise(resolve => {
      settle = yes => {
        settle = null;
        closeDialog.hidden = true;
        try {
          if (returnFocus?.isConnected) returnFocus.focus();
        } catch {}
        resolve(yes);
      };
    });
  }
  dlgCancel.onclick = () => settle?.(false);
  dlgConfirm.onclick = () => settle?.(true);
  closeDialog.addEventListener('click', e => {
    if (e.target === closeDialog) settle?.(false);
  });
  closeDialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      settle?.(false);
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    (document.activeElement === dlgCancel ? dlgConfirm : dlgCancel).focus();
  });

  // ---- Close one panel with its own ×: always asked first, so that a slip of the mouse does not
  // close a terminal at once ---- The Overview card's Close and a workspace's × already ask; the
  // panel's own × did not. Only the user's own click is caught (isTrusted): every other close in
  // the app goes through this same button by script after it has asked or decided (11 closePane,
  // closeWorkspace above, `tnai close`, handoff, the tests), and must not ask twice. A panel with
  // no connection yet has nothing to lose and closes at once.
  content.addEventListener(
    'click',
    async e => {
      const btn = e.isTrusted
          ? e.target.closest?.('.terminal-pane-tools button[title="Close terminal"]')
          : null,
        // null, not false, for a scripted click: `false?.closest()` throws
        pane = btn?.closest('.terminal-pane');
      if (!pane) return;
      const s = sessionOf(pane);
      if (!s) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const name = '“' + (nameOf(pane) || 'this terminal') + '”',
        working = s.status === 'working' || s.status === 'starting';
      const yes = working
        ? await ask(
            'Close ' + name + '?',
            'It is still working. Closing stops it mid-task.',
            'Stop and close',
            true
          )
        : s.running
          ? await ask('Close ' + name + '?', 'Its session will end.', 'Close', true)
          : await ask('Close ' + name + '?', 'Its thread leaves this workspace.', 'Close', false);
      if (yes && pane.isConnected) btn.click();
    },
    true
  );

  async function closeWorkspace(id, { force = false } = {}) {
    const api = window.TnaiTerminalWorkspaces,
      workspace = api?.list().find(w => w.id === id);
    if (!workspace) return { ok: false, error: 'No workspace ' + id };
    const { panes, live, working } = workspaceActivity(id),
      quoted = '“' + workspace.name + '”';
    if (!force && live) {
      const yes = working
        ? await ask(
            'Close ' + quoted + '?',
            plural(working, 'agent') +
              (working === 1 ? ' is' : ' are') +
              ' still working in this workspace. Closing it stops ' +
              (working === 1 ? 'it' : 'them') +
              ' mid-task.',
            working === 1 ? 'Stop agent and close' : 'Stop agents and close',
            true
          )
        : await ask(
            'Close ' + quoted + ' with ' + plural(live, 'agent') + '?',
            (live === 1 ? 'Its session' : 'Their sessions') + ' will end.',
            'Close workspace',
            false
          );
      if (!yes) return { ok: false, cancelled: true };
    }

    // Each pane's own close: removes it, forgets its record, and fires tnai:terminal-pane-closed
    // (10 stops the process).
    panes.forEach(p =>
      p.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.click()
    );
    const result = api.remove(id);
    if (result.ok)
      toastSafe(
        workspace.name + ' closed' + (live ? ' · ' + plural(live, 'session') + ' ended' : '')
      );
    return { ...result, stopped: live };
  }

  function decoratePane(pane) {
    if (pane.dataset.renameReady) return;
    pane.dataset.renameReady = 'true';
    const title = titleOf(pane);
    if (title) title.title = 'Double-click to rename';
    const head = pane.querySelector('.terminal-pane-head');
    if (head && !head.title) head.title = 'Double-click to maximize or restore';
    const tools = pane.querySelector('.terminal-pane-tools');
    if (tools && !tools.querySelector('[data-tnai-rename]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tnaiRename = '';
      button.title = 'Rename terminal';
      button.setAttribute('aria-label', 'Rename terminal');
      button.innerHTML = window.TnaiIcon('pencil', { size: 14 });
      tools.prepend(button);
    }
    if (tools && !tools.querySelector('[data-tnai-max]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tnaiMax = '';
      const close = tools.querySelector('button[title="Close terminal"]');
      close ? close.before(button) : tools.append(button);
      paintMax(pane);
    }
  }

  // The header's maximize button shows what a click does: fill the workspace with this pane, or
  // bring the grid back.
  const MAX_ICON = {
    expand: '<path d="M7.5 1.5h3v3M4.5 10.5h-3v-3M10.5 1.5 7 5M1.5 10.5 5 7"/>',
    restore: '<path d="M10.5 5h-3.5v-3.5M1.5 7h3.5v3.5M7 5l3.5-3.5M5 7l-3.5 3.5"/>',
  };

  function paintMax(pane) {
    const button = pane?.querySelector('.terminal-pane-tools>[data-tnai-max]');
    if (!button) return;
    const maxed = pane.classList.contains('tnai-max-pane'),
      state = maxed ? 'restore' : 'expand';
    if (button.dataset.tnaiMax === state) return;
    button.dataset.tnaiMax = state;
    button.title = maxed
      ? 'Restore the grid (show all terminals)'
      : 'Maximize this terminal (other terminals keep running)';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-pressed', String(maxed));
    button.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true">' + MAX_ICON[state] + '</svg>';
  }

  // ---- Empty pane: one "＋ Add connection" button; the connection dialog (06) holds the list (06
  // calls decorateStart) ----
  function decorateStart(pane, start) {
    if (!pane || !start || start.classList.contains('tnai-launcher')) return;

    // 06's button: opens the dialog targeting this pane
    const button = start.querySelector('button');
    if (!button) return;
    start.classList.add('tnai-launcher');

    // A class and not :has() hides what stands beside the button: a :has() in front of a rule
    // that fits any element made every change anywhere in the window work out the styles of
    // the whole window again (measured 2026-10-13: 10 ms a change instead of 0.04). 06 takes
    // the class off where it removes the start state.
    start.parentElement?.classList.add('tnai-launching');
    button.className = 'tnai-add-connection';
    button.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' Add connection';
    button.title = 'Choose an agent or shell for ' + nameOf(pane);
    start.replaceChildren(button);
  }

  // ---- Grid: columns/rows for 1–12 panes, tuned to the space available; density shrinks chrome,
  // never the input ----
  const MIN_W = 260,
    MIN_H = 150,
    TARGET_ASPECT = 1.3;

  function fit(grid) {
    const n = grid.querySelectorAll(':scope>.terminal-pane').length;
    if (!n) {
      setVar(grid, '--workspace-cols', '1');
      setVar(grid, '--workspace-rows', '1');
      if ('density' in grid.dataset) delete grid.dataset.density;
      return;
    }
    if (grid.classList.contains('tnai-maxed')) {
      if ('density' in grid.dataset) delete grid.dataset.density;
      return;
    } // one pane fills it: roomy chrome

    const w = grid.clientWidth,
      // read only when needed: a forced layout (maximize from a hidden page paid it for nothing)
      h = grid.clientHeight;
    if (!w || !h) return; // hidden workspace: fitted when it is shown (ResizeObserver)
    const gap = n > 4 ? 6 : 10;
    let best = null;
    for (let cols = 1; cols <= Math.min(n, 6); cols++) {
      const rows = Math.ceil(n / cols),
        cw = (w - gap * (cols - 1)) / cols,
        ch = (h - gap * (rows - 1)) / rows;
      const short = Math.max(0, MIN_W - cw) / MIN_W + Math.max(0, MIN_H - ch) / MIN_H;
      const score =
        Math.abs(Math.log(cw / ch / TARGET_ASPECT)) + (cols * rows - n) * 0.3 + short * 6;
      if (!best || score < best.score) best = { cols, rows, cw, ch, score };
    }
    const density =
      best.ch < 190 || best.cw < 300 ? 'dense' : best.ch < 270 || best.cw < 400 ? 'compact' : '';
    setVar(grid, '--workspace-cols', String(best.cols));
    setVar(grid, '--workspace-rows', String(best.rows));
    setVar(grid, '--workspace-gap', gap + 'px');
    if (density) {
      if (grid.dataset.density !== density) grid.dataset.density = density;
    } else if ('density' in grid.dataset) delete grid.dataset.density;
  }

  // Writes only on change: the grid is fitted again each time the Terminal page is shown, and an
  // unchanged grid must not restyle its panes.
  function setVar(el, name, value) {
    if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
  }

  // One header row: the workspace bar sits in the toolbar between the title and the tools.
  const toolbar = view.querySelector('.terminal-toolbar'),
    wsBar = view.querySelector('.terminal-workspaces');
  if (toolbar && wsBar) toolbar.insertBefore(wsBar, toolbar.querySelector('.terminal-tools'));

  // ---- Maximize: double-clicking a pane's header bar (not its title, which renames, nor its
  // controls) fills the grid with that pane; the others wait as chips (name + status dot) in a
  // strip below. A chip switches the maximized pane; Restore, Esc (outside a terminal or field —
  // there Esc belongs to the CLI) or double-clicking the header again brings the grid back as it
  // was (DOM order is never touched). Per workspace: each has its own grid. Dropped when that pane
  // closes; a new pane restores the grid so it shows. The xterm and its pty follow the new size
  // through 10's ResizeObserver on the pane's terminal box.
  const gridOf = pane =>
    pane?.parentElement?.classList.contains('terminal-workspace-grid') ? pane.parentElement : null;
  const gridPanes = grid => [...grid.querySelectorAll(':scope>.terminal-pane')];
  const maxCounts = new WeakMap();
  const statusWatch = new MutationObserver(records =>
    new Set(
      records.filter(r => r.target.matches?.('.terminal-pane')).map(r => gridOf(r.target))
    ).forEach(g => g && renderStrip(g))
  );

  function watchStatus() {
    statusWatch.disconnect();
    content.querySelectorAll('.terminal-workspace-grid.tnai-maxed').forEach(g =>
      statusWatch.observe(g, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-status'],
      })
    );
  }

  function renderStrip(grid) {
    const maxed = grid.querySelector(':scope>.tnai-max-pane');
    let strip = grid.querySelector(':scope>.tnai-max-strip');
    if (!maxed) {
      strip?.remove();
      return;
    }
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'tnai-max-strip';
      strip.setAttribute('role', 'toolbar');
      strip.setAttribute('aria-label', 'Minimized terminals');
      grid.append(strip);
    }
    const others = gridPanes(grid).filter(p => p !== maxed);
    const key = others
      .map(p => p.dataset.paneId + '|' + (p.dataset.status || '') + '|' + nameOf(p))
      .join('\n');
    if (strip.dataset.key === key && strip.childElementCount) return;
    strip.dataset.key = key;
    const chips = others.map(p => {
      const chip = document.createElement('button'),
        label = document.createElement('span'),
        name = nameOf(p) || 'New terminal';
      chip.type = 'button';
      chip.className = 'tnai-max-chip';
      chip.dataset.paneId = p.dataset.paneId;
      chip.dataset.status = p.dataset.status || '';
      const state = p.querySelector('.terminal-pane-state span')?.textContent.trim();
      chip.title = 'Maximize ' + name + (state ? ' · ' + state : '');
      label.textContent = name;
      chip.append(document.createElement('i'), label);
      return chip;
    });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tnai-max-restore';
    back.innerHTML = window.TnaiIcon('layout-grid', { size: 14 }) + ' Restore grid';
    back.title = 'Show all terminals again (Esc)';
    strip.replaceChildren(...chips, back);
  }

  function maximize(pane) {
    const grid = gridOf(pane);
    if (!grid || gridPanes(grid).length < 2) return false;
    grid.querySelector(':scope>.tnai-max-pane')?.classList.remove('tnai-max-pane');
    pane.classList.add('tnai-max-pane');
    grid.classList.add('tnai-maxed');
    maxCounts.set(grid, gridPanes(grid).length);
    renderStrip(grid);
    watchStatus();
    fit(grid);
    gridPanes(grid).forEach(paintMax);
    return true;
  }

  function restore(grid) {
    if (!grid?.classList.contains('tnai-maxed')) return false;
    grid.classList.remove('tnai-maxed');
    grid.querySelector(':scope>.tnai-max-pane')?.classList.remove('tnai-max-pane');
    renderStrip(grid);
    watchStatus();
    fit(grid);
    gridPanes(grid).forEach(paintMax);
    return true;
  }

  function checkMax(grid) {
    if (!grid.classList.contains('tnai-maxed')) return;
    const n = gridPanes(grid).length;
    if (!grid.querySelector(':scope>.tnai-max-pane') || n < 2 || n > (maxCounts.get(grid) || 0))
      restore(grid);
    else {
      maxCounts.set(grid, n);
      renderStrip(grid);
    }
  }
  content.addEventListener('dblclick', e => {
    const head = e.target.closest('.terminal-pane-head');
    if (
      !head ||
      e.target.closest(
        '.terminal-pane-title,.tnai-rename-input,button,select,input,textarea,a,[contenteditable],.terminal-pane-tools'
      )
    )
      return;
    const pane = head.closest('.terminal-pane'),
      grid = gridOf(pane);
    if (!grid) return;
    e.preventDefault();
    window.getSelection?.()?.removeAllRanges(); // a double-click also selects header text
    if (pane.classList.contains('tnai-max-pane')) restore(grid);
    else maximize(pane);
  });
  content.addEventListener('click', e => {
    const button = e.target.closest('.terminal-pane-tools>[data-tnai-max]');
    if (!button) return;
    e.stopPropagation();
    const pane = button.closest('.terminal-pane'),
      grid = gridOf(pane);
    if (!grid) return;
    if (pane.classList.contains('tnai-max-pane')) restore(grid);
    else maximize(pane);
  });
  content.addEventListener('click', e => {
    const chip = e.target.closest('.tnai-max-chip'),
      back = e.target.closest('.tnai-max-restore'),
      grid = e.target.closest('.terminal-workspace-grid');
    if (!grid || (!chip && !back)) return;
    e.stopPropagation();
    if (back) restore(grid);
    else
      maximize(
        grid.querySelector(
          ':scope>.terminal-pane[data-pane-id="' + CSS.escape(chip.dataset.paneId) + '"]'
        )
      );
  });
  document.addEventListener('keydown', e => {
    if (
      e.key !== 'Escape' ||
      e.defaultPrevented ||
      !view.getClientRects().length ||
      !closeDialog.hidden
    )
      return;
    if (e.target.closest?.('.xterm,input,textarea,select,[contenteditable]')) return;
    const grid = content.querySelector(
      '.terminal-workspace-view:not([hidden]) .terminal-workspace-grid.tnai-maxed'
    );
    if (grid) {
      e.preventDefault();
      restore(grid);
    }
  });
  window.addEventListener('tnai:terminal-pane-renamed', () =>
    content.querySelectorAll('.terminal-workspace-grid.tnai-maxed').forEach(renderStrip)
  );

  const watched = new WeakSet();
  const resize = new ResizeObserver(entries => entries.forEach(entry => fit(entry.target)));
  const panesChanged = new MutationObserver(records => {
    const grids = new Set(records.map(r => r.target));
    grids.forEach(grid => {
      checkMax(grid);
      fit(grid);
      grid.querySelectorAll(':scope>.terminal-pane').forEach(decoratePane);
    });
  });

  function watchGrids() {
    content.querySelectorAll('.terminal-workspace-grid').forEach(grid => {
      if (watched.has(grid)) return;
      watched.add(grid);
      resize.observe(grid);
      panesChanged.observe(grid, { childList: true });
      grid.querySelectorAll(':scope>.terminal-pane').forEach(decoratePane);
      fit(grid);
    });
  }

  // A closed workspace's grid is let go: the observer lives as long as the page and would keep
  // the removed grid in memory (07 `remove`).
  function forgetGrids(records) {
    for (const record of records)
      for (const node of record.removedNodes) {
        if (!node.querySelectorAll) continue;
        node.querySelectorAll('.terminal-workspace-grid').forEach(grid => {
          resize.unobserve(grid);
          watched.delete(grid);
        });
      }
  }

  // New workspaces add grids; switching workspace toggles `hidden` on their sections (no subtree
  // childList: xterm rows change constantly).
  new MutationObserver(records => {
    forgetGrids(records);
    watchGrids();
  }).observe(content, { childList: true });
  content.querySelectorAll('.terminal-pane').forEach(decoratePane);
  watchGrids();
  nameSessions();

  // Panes made before this file loaded (the first one) got 06's start state undecorated.
  content
    .querySelectorAll('.terminal-start-state')
    .forEach(start => decorateStart(start.closest('.terminal-pane'), start));

  if (window.TnaiTerminalWorkspaces)
    Object.assign(window.TnaiTerminalWorkspaces, {
      close: closeWorkspace,
      startRename: id =>
        editWorkspace(view.querySelector('[data-workspace-tab="' + CSS.escape(id) + '"]')),
    });
  window.TnaiPaneNames = {
    pick,
    list: () => NAMES.slice(),
    rename: (paneId, name, quiet) => {
      const pane = content.querySelector(
        '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]'
      );
      return pane
        ? renamePane(pane, name, quiet)
        : Promise.resolve({ ok: false, error: 'No terminal panel ' + paneId });
    },
  };
  const paneById = id =>
    content.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]');
  const activeGrid = () =>
    content.querySelector('.terminal-workspace-view:not([hidden]) .terminal-workspace-grid');
  window.TnaiTerminalGrid = {
    fit,
    maximize: paneId => maximize(paneById(paneId)),
    restore: () => restore(activeGrid()),
    maximized: () => activeGrid()?.querySelector(':scope>.tnai-max-pane')?.dataset.paneId || null,
  };
  window.TnaiTerminalPage = { decorateStart, editPane, editWorkspace, inlineEdit };
})();
