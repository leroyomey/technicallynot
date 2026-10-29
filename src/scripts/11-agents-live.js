// Technically Not · 11-agents-live.js — Desktop app only: the agent tree on Overview shows real
// sessions as status-highlighted cards (current task, latest action, files, account), and the
// composer sends tasks to a chosen running agent. Replaces the sample agent tree (08) and header
// status in the desktop app.
(() => {
  const agents = window.TnaiAgents,
    page = document.getElementById('agentPage');

  // Overview on screen: the route classes (08) first, so a hidden Overview never forces a layout;
  // offsetParent only when it may be shown.
  const layoutEl = document.querySelector('.layout');

  // The page is shown by exactly these classes (08 MODES); no offsetParent read, which forced a
  // layout per render.
  const shownNow = () => !!layoutEl && layoutEl.classList.contains('overview-mode');
  if (!agents || !page) return;

  // On Overview the purple page (94) covers this grid: 08-overview-purple.css hides #agentPage
  // there (`.layout.overview-mode:not(.workspace-mode) .workspace .dock-content>#agentPage`).
  // Measuring a hidden grid returns zeros but still lays the whole page out (fitKey 274 ms in
  // perf-background-switch, 2026-10-05), so the measuring paths treat it like a hidden Overview;
  // card data stays current. Read from the classes that rule uses, never from layout. A card in an
  // Overview pop-out is outside #agentPage and measures as before.
  const gridHidden = () =>
    !!page.parentElement?.matches('.workspace .dock-content') &&
    !layoutEl.classList.contains('workspace-mode');
  const measurable = () => shownNow() && !gridHidden();
  const inner = page.querySelector('.agent-page-inner'),
    header = page.querySelector('.agent-page-header');
  if (!inner || !header) return;
  const TASKS_KEY = 'tnai.agent-tasks.v1';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(TASKS_KEY)) || {};
    } catch {
      return {};
    }
  };
  const tasks = read();
  const saveTasks = () => {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
    } catch {}
  };
  let target = null; // paneId the composer sends to

  // kept: the composer (with this line) may be in its pop-out window (38)
  const workerLabel = document.getElementById('activeWorkerLabel');
  const CARD_TIP =
    'Click to open this agent’s page; it also becomes the agent the composer sends tasks to';
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const ago = at => {
    if (!at) return '';
    const s = Math.max(0, Math.round((Date.now() - at) / 1000));
    return s < 60
      ? s + 's ago'
      : s < 3600
        ? Math.round(s / 60) + ' min ago'
        : Math.round(s / 3600) + ' h ago';
  };
  const setText = (el, value) => {
    if (el.textContent !== value) el.textContent = value;
  };

  // A line as segments ([text, droppable]): the text reads the same, and a narrow card hides the
  // droppable ones (.c-drop) instead of cutting words.
  const setParts = (el, parts) => {
    const key = JSON.stringify(parts);
    if (el.dataset.parts === key) return;
    el.dataset.parts = key;
    el.replaceChildren(
      ...parts
        .filter(([text]) => text)
        .map(([text, drop, cls]) => {
          const span = document.createElement('span');
          span.textContent = text;
          if (drop || cls) span.className = cls || 'c-drop';
          return span;
        })
    );
  };

  const style = document.createElement('style');
  style.textContent = `
html[data-runtime=desktop] #agentPage>.agent-page-inner>#agentMetrics,html[data-runtime=desktop] #agentPage .agent-tree-panel:not(.tnai-live-panel),
html[data-runtime=desktop] #agentPage .agent-demo-flag:not(.tnai-live-flag),html[data-runtime=desktop] #addSavedAgent,html[data-runtime=desktop] .agent-status-legend small{display:none!important}
.tnai-live-panel{min-height:0;padding:0;border:0;border-radius:0;background:none;box-shadow:none} /* sits on the page: one surface, no box around the tree */
html[data-runtime=desktop] #agentPage .agent-status-legend{display:none} /* the legend is the metrics' tooltip */
/* Header: title, then the counts as one line of text ("1 live · 0 working · …"), numbers in the status colors. */
#agentPage .agent-page-header>div:first-child{display:flex;align-items:baseline;gap:14px;min-width:0}
#agentPage .agent-page-header>div:first-child>p{display:none}#agentPage .agent-page-header h1{flex:none;white-space:nowrap}
.tnai-live-metrics{display:block;min-width:0;margin:0;overflow:hidden;color:#858a80;font:11px Arial;white-space:nowrap;text-overflow:ellipsis;cursor:default}
.tnai-live-metrics .agent-metric{display:inline;min-height:0;padding:0;border:0;background:none}
.tnai-live-metrics .agent-metric b{font:600 12px Arial}
.tnai-live-metrics .agent-metric[data-zero] b{color:#9a9e94!important;font-weight:400} /* a 0 count stays quiet; only real counts take their status color */
.tnai-live-metrics>i{margin:0 6px;color:#c3c7bd;font-style:normal}
/* One toolbar row: workspace tabs · latest task (one truncated line) · working folder. */
.tnai-live-panel .agent-tree-toolbar{justify-content:flex-start;gap:10px;min-height:32px;padding:0 0 8px}
.tnai-live-latest{flex:1 1 140px;min-width:0;margin:0;overflow:hidden;color:#969b91;font:10px Arial;white-space:nowrap;text-overflow:ellipsis}
.tnai-live-latest .tnai-live-task{color:#444a3f;font:600 11px Arial}.tnai-live-latest .tnai-live-task-meta{margin-left:8px;color:#a0a49b;font:9px Arial}
.tnai-live-panel .agent-local-state{box-sizing:border-box;height:24px;max-width:220px;padding:0 9px;overflow:hidden;text-overflow:ellipsis}
.tnai-live-panel .agent-local-state>span{overflow:hidden;text-overflow:ellipsis}
/* No root row above the cards (more room for the panels), so no rail or stubs connect up to it. */
.tnai-live-panel .tnai-live-sessions{margin-top:12px;padding-top:0;gap:14px;align-items:start}
.tnai-live-panel .tnai-live-sessions:before,.tnai-live-panel .tnai-live-sessions>.agent-tree-node:before{display:none}
.tnai-live-panel .tnai-live-sessions:has(>.tnai-live-empty:not([hidden])){margin-top:6px;padding-top:0}
.tnai-live-empty{grid-column:1/-1;margin:0;padding:14px 4px 0;color:#8d9288;font:10px/1.55 Arial;text-align:center}
.tnai-live-empty[hidden]{display:none}
.tnai-card{display:grid;grid-template-columns:minmax(0,1fr);gap:0;padding:14px 15px 12px;cursor:pointer;transition:border-color .18s ease,box-shadow .18s ease}
/* Composer target: neutral, so color on a card only ever means status. */
.tnai-card.tnai-target{position:relative;outline:2px solid #8e9286;outline-offset:-1px}
.tnai-card.tnai-target::after{content:"Composer sends here";position:absolute;top:2px;left:50%;transform:translateX(-50%);padding:0 6px;border-radius:0 0 4px 4px;color:#6e7467;font:8px/12px Arial;letter-spacing:.02em;white-space:nowrap;pointer-events:none}
.tnai-card.tnai-target:focus-visible{outline-color:#5f6358}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card.tnai-target::after{content:none} /* too little room: the outline alone marks it */
/* The working dot's pulse is the shared one in 05-status-colors.css. */
.tnai-card .agent-status-pill.agent-status-pill{overflow:clip;overflow-clip-margin:5px} /* beats the pill's overflow:hidden below, which cut the ring at the dot */
.tnai-card .agent-node-identity small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-card .agent-node-task{gap:6px;margin-top:12px;padding-top:11px}
.tnai-card .c-title{display:block;flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:600 12px/1.4 Arial}
/* Task text: one truncated line (a huge prompt never changes a card's or the toolbar's height); ⌄ shows all of it in a bounded box. */
.tnai-card .c-title-row{display:flex;align-items:center;gap:3px;min-width:0}
.tnai-task-more{flex:none;box-sizing:border-box;width:16px;height:14px;padding:0;border:0;border-radius:4px;background:transparent;color:#8a9084;font:10px/14px Arial;cursor:pointer}
.tnai-task-more:hover{background:#eef1ea;color:#3f453a}.tnai-task-more[hidden]{display:none}.tnai-task-more[aria-expanded=true]{transform:rotate(180deg)}
.tnai-task-full{box-sizing:border-box;max-height:160px;overflow:auto;padding:7px 9px;border:1px solid #e6e9e1;border-radius:6px;background:#fbfcf9;color:#444a3f;font:10px/1.5 Arial;white-space:pre-wrap;overflow-wrap:anywhere;cursor:text;user-select:text}
.tnai-task-full[hidden]{display:none}
.tnai-live-panel .agent-tree-toolbar{position:relative}
.tnai-latest-full{position:absolute;z-index:6;top:calc(100% - 4px);left:0;width:min(640px,100%);max-height:220px;box-shadow:0 8px 24px #20211f14}
.tnai-card .c-now{color:#858b80}.tnai-card[data-tone=working] .c-now{color:#5c7d43}
.tnai-card .agent-skill-list:empty{display:none}
.tnai-card .agent-skill-list span{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-card-limit{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;padding:8px 10px;border:1px solid #eee3c9;border-radius:6px;background:#faf6ec;color:#8a6a2c;font:9px/1.45 Arial}
.tnai-card-limit[hidden]{display:none}
/* An open decision sits first in the body: in a fixed-size Grid card it is what shows while the agent waits (the task scrolls below). */
.tnai-card-decide{flex-wrap:wrap;justify-content:flex-start;gap:6px;margin:0 0 8px}.tnai-card-decide .c-decide{flex:1 1 100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.tnai-card-decide .c-decide-opts{display:flex;flex-wrap:wrap;gap:6px;min-width:0}.tnai-live-panel .tnai-card-decide button[data-act]{max-width:100%;overflow:hidden;text-overflow:ellipsis}
.tnai-card .agent-node-foot{align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid #f0f1ed}
.tnai-live-panel .agent-node-actions{display:flex;flex:none;gap:6px}
.tnai-live-panel button[data-act]{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #dfe3d9;border-radius:6px;background:#fff;color:#5b6353;font:10px Arial;white-space:nowrap;cursor:pointer}
.tnai-live-panel button[data-act]:hover{background:#f2f4ee}.tnai-live-panel button[data-act][hidden]{display:none}
.tnai-card-skills{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:9px}
.tnai-card-skills[hidden]{display:none}
.c-skill{display:inline-flex;align-items:center;gap:5px;max-width:190px;padding:3px 4px 3px 7px;border:1px solid #dfe5d6;border-radius:99px;background:#fff;color:#5f6d52;font:8px Arial}
.c-skill>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.c-skill i{flex:none;width:6px;height:6px;box-sizing:border-box;border-radius:50%;border:1px solid #a9b99a;background:transparent}
.c-skill[data-state=in-use]{border-color:#cfe0c0;background:#edf4e8;color:#4f6b3a}
.c-skill[data-state=in-use] i{border-color:#82a95f;background:#82a95f}
.c-skill em{flex:none;padding:1px 4px;border-radius:3px;background:#f3f1ea;color:#8a7a52;font:7px Arial;font-style:normal;letter-spacing:.04em}
.c-skill:not(:has(button)){padding-right:7px}
.tnai-live-panel .c-skill button{display:grid;place-items:center;flex:none;width:13px;height:13px;padding:0;border:0;border-radius:50%;background:none;color:#97a08c;font:10px/1 Arial}
.tnai-live-panel .c-skill button:hover{background:#e7ecdf;color:#4f6b3a}
.tnai-live-panel button.c-skill-add{padding:3px 8px;border-style:dashed;border-radius:99px;color:#6f7f5d;font:8px Arial}
.tnai-card.tnai-drop-ok{border-color:#9fb386;box-shadow:0 0 0 3px #e3ead9}
.tnai-card.tnai-drop-no{border-color:#e6d3cf}
.tnai-card>*,.tnai-card .agent-node-head{min-width:0}.tnai-card .agent-node-identity{flex:1 1 auto}
.tnai-card .agent-status-pill{flex:0 1 auto;min-width:0;max-width:52%;overflow:hidden;padding:0;border:0;background:none}.tnai-card .agent-status-pill>span{display:none}
/* Each grid card fits its own width: below 330px the status pill is its dot (the word is its tooltip, the edge color the tone) and
   the lines drop their optional segments (.c-drop: account, folder, "last line…") rather than cut words; the meter shortens in 42. */
.tnai-live-sessions>.tnai-card{container:tnai-card/inline-size}
@container tnai-card (max-width:330px){
.tnai-card .agent-status-pill{flex:none;padding:0;border:0;background:none}.tnai-card .agent-status-pill>span{display:none}
.tnai-card .c-drop{display:none}}
/* "· ↔ NAME" (agents messaging) stays visible at every card size: the status text before it ellipsizes first. */
.tnai-card .c-now:has(>.c-talk){display:flex}.tnai-card .c-now:has(>.c-talk)>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:pre}.tnai-card .c-now>.c-talk{flex:0 0 auto;max-width:60%}
/* Many sessions: more, narrower columns and tighter cards. compact = 4–8 sessions, dense = 9+ (secondary rows show on the selected or focused card). */
.tnai-live-panel .tnai-live-sessions[data-density]{gap:10px}
.tnai-live-sessions[data-density=compact]{grid-template-columns:repeat(auto-fit,minmax(min(100%,218px),1fr))}
.tnai-live-sessions[data-density=dense]{grid-template-columns:repeat(auto-fit,minmax(min(100%,196px),1fr))}
.tnai-live-sessions[data-density] .tnai-card{padding:11px 12px 10px}
.tnai-live-sessions[data-density] .agent-avatar{width:26px;height:26px}
.tnai-live-sessions[data-density] .tnai-card .agent-node-task{gap:4px;margin-top:9px;padding-top:8px}
.tnai-live-sessions[data-density] .tnai-card .c-title{-webkit-line-clamp:1;font-size:11px}
.tnai-live-sessions[data-density] .tnai-card .c-now{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-live-sessions[data-density] .tnai-card .agent-skill-list,.tnai-live-sessions[data-density] .tnai-card-skills{margin-top:7px}
.tnai-live-sessions[data-density] .tnai-card .agent-node-foot{flex-wrap:wrap;margin-top:9px;padding-top:8px}
.tnai-live-sessions[data-density] .agent-node-actions{flex:1 1 auto;flex-wrap:wrap;justify-content:flex-end}
/* Grid cards: the process line and the action buttons are centered, so the outer buttons sit the same distance from both card edges. */
.tnai-live-sessions .tnai-card .agent-node-foot{flex-wrap:wrap;justify-content:center;row-gap:10px;text-align:center}
.tnai-live-sessions .tnai-card .agent-node-actions{flex:1 1 100%;flex-wrap:wrap;justify-content:center}
/* Bubbles: the tree mirrors one terminal workspace, so it shrinks with that workspace's pane count (compact 4–6, dense 7–12).
   Every grid card always shows its full details (task, now, files, sub-agents, actions); there is no Expand. */
.tnai-live-sessions[data-density=dense]{grid-template-columns:repeat(auto-fill,minmax(min(100%,168px),1fr))}
.tnai-live-sessions[data-density=compact]{grid-template-columns:repeat(auto-fill,minmax(min(100%,200px),1fr))}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card{padding:8px 10px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .agent-avatar{width:22px;height:22px;font-size:10px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .agent-node-head{gap:7px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .c-name{font-size:11px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .c-sub{font-size:8px}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .agent-status-pill{padding:0}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .agent-node-task{margin-top:6px;padding-top:6px}
.tnai-tree-bar{display:flex;flex:0 1 auto;align-items:center;min-width:0;margin:0;overflow-x:auto}
.tnai-tree-bar[hidden]{display:none}
.tnai-ws-tabs{display:flex;align-items:center;gap:10px}
/* Full size (1–3 agents): cards keep a readable width and sit centered under the root instead of stretching across the tree. */
.tnai-live-panel .tnai-live-sessions:not([data-density])>.tnai-card{justify-self:center;width:100%;max-width:400px}
.tnai-live-sessions>.tnai-card:not(.tnai-card-empty){display:flex;flex-direction:column}
.tnai-live-sessions>.tnai-card:not(.tnai-card-empty)>*{flex:none;min-width:0}
.tnai-tree-bar small{display:none}
.tnai-ws-tab{box-sizing:border-box;flex:none;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 12px;border:1px solid #e2e5dd;border-radius:6px;background:#fff;color:#5b6353;font:10px Arial;cursor:pointer}
.tnai-ws-tab:hover{background:#f6f8f3}
.composer .tnai-route-hint{max-width:46ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.composer .tnai-route-hint[hidden],.composer .tnai-route-hint.tnai-fit-out{display:none}.composer .tnai-route-hint.tnai-new{color:#4e6b38;font-weight:600}
.tnai-ws-tab[aria-selected=true]{border-color:#c9d6ba;background:#eef3e8;color:#3f5230;font-weight:600}
.tnai-ws-tab i{padding:0 5px;border-radius:99px;background:#f0f2ec;color:#7c8274;font:9px/15px Arial;font-style:normal}
.tnai-ws-tab[aria-selected=true] i{background:#dfe8d3;color:#4f6b3a}
.tnai-ws-tab b{width:6px;height:6px;border-radius:50%;background:#82a95f}
.tnai-ws-item{position:relative;display:inline-flex;flex:none}
.tnai-ws-item>.tnai-ws-tab{padding-right:28px}
.tnai-ws-close{position:absolute;top:50%;right:5px;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:#9a9f93;font:12px/1 Arial;cursor:pointer;transform:translateY(-50%)}
.tnai-ws-close:hover{background:#f6e9e6;color:#9a4a3c}
.tnai-ws-close:focus-visible{outline:var(--pg-ring,2px) solid #8da56c;outline-offset:0}
.tnai-card.tnai-card-empty{cursor:default;border-style:dashed;box-shadow:none;background:#fcfcfa}
.tnai-card-empty .agent-avatar{background:#f4f5f1;color:#9aa093}
.tnai-card-empty .c-name{color:#6d7367}
.tnai-card-empty .tnai-card-connect{justify-self:start;margin-top:10px}
.tnai-card .tnai-card-close[data-act]{flex:none;width:18px;height:18px;margin-left:2px;padding:0;border:0;border-radius:5px;background:none;color:#8a9083;font:13px/18px Arial;cursor:pointer;opacity:.5;transition:opacity .12s}
.tnai-card:is(:focus-within,.tnai-target) .tnai-card-close,.tnai-card .tnai-card-close:focus-visible{opacity:1}
.tnai-card .tnai-card-close[data-act]:hover{background:#f3ece9;color:#9a4a3c}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card-empty .tnai-card-connect{margin-top:6px}
/* Grid cards: an empty pane's name + Add connection sit in the middle of the box, its × in the top-right corner. */
.tnai-live-sessions:not([data-density=micro])>.tnai-card-empty{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:left}
.tnai-live-sessions:not([data-density=micro])>.tnai-card-empty>.agent-node-head{justify-content:center;max-width:100%;padding:0 22px}
.tnai-live-sessions:not([data-density=micro])>.tnai-card-empty .agent-node-identity{flex:0 1 auto}
.tnai-live-sessions:not([data-density=micro])>.tnai-card-empty .tnai-card-connect{margin-top:0}
.tnai-live-sessions:not([data-density=micro])>.tnai-card-empty .tnai-card-close[data-act]{position:absolute;top:8px;right:8px;margin:0}
html[data-runtime=desktop] .tnai-toolbar-end{display:flex;flex:none;align-items:center;gap:8px}
.layout.overview-mode:not(.workspace-mode) .repository-rail{position:relative}
.layout.overview-mode:not(.workspace-mode) .repository-rail-head{padding-left:26px}
.tnai-files-collapse{display:none;position:absolute;top:20px;left:9px;box-sizing:border-box;width:24px;height:24px;place-items:center;padding:0;border:1px solid var(--line);border-radius:6px;background:#f7f8f4;color:#4f5a45;font:inherit;font-size:16px;font-weight:600;line-height:1;cursor:pointer;z-index:2}
.layout.overview-mode:not(.workspace-mode) .tnai-files-collapse{display:grid}
.tnai-files-collapse:hover,.tnai-files-collapse:focus-visible{background:#eef1e8;border-color:#c9cfbf;color:#3f4a36;outline:0}
.tnai-files-restore{display:none}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .agent-status-pill{flex:none;padding:0;border:0;background:none}
.tnai-live-sessions:is([data-density=dense],[data-density=micro]) .tnai-card .agent-status-pill>span{display:none}
/* Scale (render → fit): the tier starts from the pane count and steps tighter until the tree fits the page without scrolling.
   micro = one-line bubbles (also used by the All tab). Only if even micro can't fit does the list scroll inside itself. */
.tnai-live-panel .tnai-live-sessions{overflow-y:auto;margin-inline:-6px;padding-inline:6px;padding-bottom:4px}
.tnai-live-panel .tnai-live-sessions:is([data-density=dense],[data-density=micro]){margin-top:8px}
.tnai-live-sessions[data-density=micro]{grid-template-columns:repeat(auto-fill,minmax(min(100%,136px),1fr))}
.tnai-live-panel .tnai-live-sessions[data-density=micro]{gap:6px}
.tnai-live-sessions[data-density=micro] .tnai-card{padding:6px 8px}
.tnai-live-sessions[data-density=micro] .agent-avatar{width:18px;height:18px;border-radius:5px;font-size:9px}
.tnai-live-sessions[data-density=micro] .tnai-card .agent-node-head{gap:6px}
.tnai-live-sessions[data-density=micro] .tnai-card .c-name{font-size:10px}
.tnai-live-sessions[data-density=micro] .tnai-card .agent-node-task{margin-top:4px;padding-top:4px}
.tnai-live-sessions[data-density=micro] .tnai-card .c-title{font:9px/1.35 Arial;color:#6f7669}
.tnai-live-sessions[data-density=micro] .tnai-card :is(.c-sub,.t-subs,.t-detail,.agent-node-task,.c-chips,.tnai-card-skills,.agent-node-foot),
.tnai-live-sessions.tnai-fitting[data-density=micro] .tnai-card :is(.c-sub,.t-subs,.t-detail,.agent-node-task,.c-chips,.tnai-card-skills,.agent-node-foot){display:none!important} /* micro (All tab) stays one line */
/* Grid panels, Overview's only layout (fit() → grid() sets data-cols and the tier): a fixed 4 per row (a full 12-panel workspace is 4 × 3), fewer only when too narrow, every
   panel one size (--tnai-card-h per tier), rows filled left to right. Redesigned 2026-09-25 (less crowded, even padding, symmetric):
   one inner edge (--tnai-pad) for every row, and the panel reads top to bottom in four bands with the same gap between them:
   head (status dot · name · Result · status pill · ×, then "CLI · role" under the name), the task in one monospace line with the Now line
   and the mesh note under it, the body extras (usage limit, sub-agents, chips, skills) scrolling inside the fixed panel, and the
   actions sharing the footer evenly under a hairline. A thin meter runs along the bottom while it works. A lead's sub-agent panels
   (43's task graph) follow it in the same grid, no separate rows or connector (same look with or without sub-agents). */
.tnai-live-panel .tnai-live-sessions[data-cols]{--tnai-card-h:206px;--tnai-pad:16px;position:relative;grid-template-columns:repeat(var(--tnai-tracks),minmax(0,var(--tnai-track)));grid-auto-rows:var(--tnai-card-h);row-gap:16px;justify-content:safe center;margin-top:4px;padding-top:8px} /* minmax(0,…): when a scrollbar narrows the list after grid() measured it, the columns shrink evenly instead of spilling past its edges */
.tnai-live-panel .tnai-live-sessions[data-cols][data-density=compact]{--tnai-card-h:196px;--tnai-pad:14px;row-gap:14px}
.tnai-live-panel .tnai-live-sessions[data-cols][data-density=dense]{--tnai-card-h:184px;--tnai-pad:12px;row-gap:12px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card{grid-column-end:span 2} /* two half-tracks per card, so grid() can center a short row by starting it half a card in */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card{box-sizing:border-box;display:flex;flex-direction:column;align-self:start;justify-self:stretch;width:auto;max-width:none;height:var(--tnai-card-h);min-height:0;padding:var(--tnai-pad) var(--tnai-pad) 12px;overflow:visible;border-radius:var(--surface-r);font-family:inherit}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card>*{flex:none;min-width:0}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card.tnai-target::after{top:-8px;padding:0 8px;border:1px solid var(--line);border-radius:99px;background:var(--white);color:var(--ac-sage-fg);font:600 9px/14px Arial;font-family:inherit}
/* Head: a 20px name row and the sub line under the name. Column gaps are margins, so a hidden Result chip or pill leaves no hole. */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-head{display:grid;grid-template-columns:auto minmax(40px,1fr) minmax(0,max-content) minmax(0,max-content) auto auto;grid-template-rows:20px auto;align-items:center;gap:2px 0;margin:0;padding:0;max-width:none}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-identity{display:contents}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card:not(.tnai-card-empty) .c-avatar{display:none}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-status-pill.agent-status-pill{display:contents}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-status-pill>i{grid-area:1/1;flex:none;width:8px;height:8px;margin-right:10px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-name{grid-area:1/2;min-width:0;overflow:hidden;color:var(--ink);font-family:inherit;font-size:13px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-head>.tnai-result-chip{grid-area:1/3;min-width:0;max-width:100%;margin:0 0 0 8px;overflow:hidden}
/* Small grid panels: the name keeps its room; the head Result chip drops to its icon, the status word ellipsizes. */
@container tnai-card (max-width:330px){.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-head>.tnai-result-chip>:is(span,.r-go){display:none}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-head>.tnai-result-chip{padding:0 6px}}
@container tnai-card (max-width:260px){.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-head:has(>.tnai-result-chip:not([hidden]))>.agent-status-pill>span{display:none}} /* no room for both: the dot keeps the state, the word is in the status tooltip */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-status-pill>span{grid-area:1/4;display:inline-block;justify-self:end;min-width:0;max-width:none;height:20px;margin-left:8px;overflow:hidden;padding:0 9px;box-sizing:border-box;border-radius:99px;background:inherit;font-family:inherit;font-size:10.5px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-card-close[data-act]{grid-area:1/6;position:static;width:20px;height:20px;margin:0 -4px 0 6px;font-size:14px;line-height:20px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-sub{grid-area:2/2/3/7;min-width:0;overflow:hidden;color:var(--muted);font-family:inherit;font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.tnai-card .c-narrow{display:none}
@container tnai-card (max-width:190px){.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-status-pill>span{display:none}}
@container tnai-card (max-width:250px){.tnai-card .c-wide{display:none}.tnai-card .c-narrow{display:inline}}
/* Task band and body: one scroll area under the head; its scrollbar shows on hover, with a soft fade at the bottom edge. */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card>.tnai-card-body{flex:1 1 0;min-height:0;margin-top:12px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;scrollbar-color:var(--line) transparent;-webkit-mask-image:linear-gradient(#000 max(18px,calc(100% - 10px)),transparent);mask-image:linear-gradient(#000 max(18px,calc(100% - 10px)),transparent)} /* the fade never covers the first task line (18px) */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card:hover>.tnai-card-body{scrollbar-width:thin}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-task{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;border:0}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-title-row{gap:6px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-title{color:var(--ink);font:500 12px/18px "SFMono-Regular",Consolas,monospace}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-task-more{width:18px;height:18px;font-size:11px;line-height:18px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-task-full{margin-top:4px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-now{margin:0;overflow:hidden;font-family:inherit;font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-turn{margin-top:2px;font-family:inherit;font-size:10.5px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-mesh-note{margin-top:2px;font-family:inherit;font-size:10.5px;line-height:15px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card :is(.tnai-card-limit,.c-chips,.tnai-card-skills){margin-top:8px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-card-decide{margin-top:0;padding:6px 8px;row-gap:5px}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .tnai-card-decide .c-decide{-webkit-line-clamp:1}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-decide-opts{flex-wrap:wrap}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-decide-opts{flex:1 1 100%}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-decide-opts button{flex:1 1 auto;min-width:0;max-width:100%}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-decide-opts .tnai-rec{display:none}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-chips{gap:4px}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .c-chips span{padding:0 7px;border-radius:5px;font-family:inherit;font-size:10px;line-height:18px}
/* Footer: a hairline, then the actions sharing the width evenly, the button centered in its band (12px above and below). */
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-foot{display:flex;flex-wrap:nowrap;justify-content:stretch;margin:10px 0 0;padding:12px 0 0;border-top:1px solid var(--line);text-align:left}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-actions{display:flex;flex:1 1 auto;flex-wrap:nowrap;justify-content:stretch;gap:6px;min-width:0}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-actions>button[data-act]:not([hidden]){flex:1 1 0;min-width:0;height:24px;padding:0 8px;overflow:hidden;font-family:inherit;font-size:11px;font-weight:500;text-overflow:ellipsis}
/* Action text colors: Stop red, Start green, Open terminal purple; tokens, so Dark follows. */
.tnai-live-panel .tnai-live-sessions>.tnai-card .agent-node-actions>button[data-act=stop]{color:var(--st-error-fg)}
.tnai-live-panel .tnai-live-sessions>.tnai-card .agent-node-actions>button[data-act=start]{color:var(--ac-sage-fg)}
.tnai-live-panel .tnai-live-sessions>.tnai-card .agent-node-actions>button[data-act=open]{color:var(--ac-plum-fg)}
@container tnai-card (max-width:250px){.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-actions{gap:4px}.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card .agent-node-actions>button[data-act]:not([hidden]){flex:1 1 auto;padding:0 4px;font-size:10px}} /* narrow panels: each button as wide as its label, the spare room shared, so no label is cut */
.tnai-live-panel .tnai-live-sessions[data-cols][data-density=dense]>.tnai-card .c-title{font-size:11.5px}
/* Grid panel with no connection yet: the same head (hollow dot · name, "No connection yet", ×), a centered hint in the middle band, and
   ＋ Add connection across the footer where an agent panel has its actions, so every panel in a row lines up band for band. */
.tnai-card-hint,.tnai-card-foot{display:contents}.tnai-card-hint{display:none}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty{align-items:stretch;justify-content:flex-start;gap:0;border-style:solid;background:var(--white);box-shadow:none;text-align:left;cursor:default}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty>.agent-node-head{grid-template-columns:auto minmax(0,1fr) auto}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .c-avatar{grid-area:1/1;display:block;box-sizing:border-box;width:8px;height:8px;min-width:0;margin-right:10px;padding:0;border:1.5px solid var(--st-idle-dot);border-radius:50%;background:none;font-size:0}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .c-sub{grid-area:2/2/3/4}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .tnai-card-close[data-act]{grid-area:1/3}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .tnai-card-hint{display:flex;flex:1 1 0;align-items:center;justify-content:center;min-height:0;margin:12px 0 0;overflow:hidden;color:var(--muted);font-family:inherit;font-size:11px;line-height:16px;text-align:center}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .tnai-card-foot{display:flex;margin:10px 0 0;padding:12px 0 0;border-top:1px solid var(--line)}
.tnai-live-panel .tnai-live-sessions[data-cols]:not([data-density=micro])>.tnai-card.tnai-card-empty .tnai-card-connect{flex:1 1 auto;min-width:0;height:24px;margin:0;font-family:inherit;font-size:11px;font-weight:500}
.tnai-card>.c-meter{display:none}
.tnai-live-panel .tnai-live-sessions[data-cols]>.tnai-card>.c-meter{display:block;position:absolute;left:0;right:0;bottom:0;height:9px;overflow:hidden;border-radius:0 0 calc(var(--surface-r) - 1px) calc(var(--surface-r) - 1px);pointer-events:none}
.tnai-card>.c-meter>i{position:absolute;left:0;bottom:0;width:40%;height:2px;border-radius:2px;background:var(--st-working-dot);opacity:0;transform:translateX(-100%)}
.tnai-card[data-tone=working]>.c-meter>i{opacity:.8;animation:tnaiCardScan 1.8s linear infinite}
@keyframes tnaiCardScan{to{transform:translateX(260%)}}
@media (prefers-reduced-motion:reduce){.tnai-card[data-tone=working]>.c-meter>i{width:100%;opacity:.45;animation:none;transform:none}}
.tnai-live-sessions.tnai-fitting .tnai-card .t-detail{display:none} /* transient boxes never decide the card size */
.tnai-live-sessions[data-density=micro] .tnai-card-team{margin-top:5px}
.tnai-live-sessions[data-density=micro] .tnai-card-empty{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px}
.tnai-live-sessions[data-density=micro] .tnai-card-empty .agent-avatar{display:none}
.tnai-live-sessions[data-density=micro] .tnai-card-empty .tnai-card-connect{margin-top:0;padding:2px 6px;font-size:0}
.tnai-live-sessions[data-density=micro] .tnai-card-empty .tnai-card-connect:before{content:'＋ Add';font:8px Arial}
/* All tab: every workspace's agents under small workspace headings (no connector rail). */
.tnai-live-sessions[data-all]:before,.tnai-live-sessions[data-all]>.agent-tree-node:before{display:none!important}
.tnai-ws-group{grid-column:1/-1;display:flex;align-items:baseline;gap:8px;margin-top:4px;padding:0 2px;color:#5b6353;font:600 9px Arial;letter-spacing:.04em}
.tnai-ws-group:first-child{margin-top:0}
.tnai-ws-group small{color:#92978c;font:400 8px Arial;letter-spacing:0}
.tnai-live-panel .tnai-live-sessions[data-all]{padding-top:4px}
/* File Repository rail slides out to the right edge on Overview (the agent tree takes the room); a small arrow tab stays at the edge to bring it back. */
.layout.overview-mode:not(.workspace-mode) .dock-content{transition:grid-template-columns .18s ease}
html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .dock-content{grid-template-columns:minmax(0,1fr) 18px!important}
html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .repository-rail{padding:0!important;overflow:hidden!important}
html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .repository-rail>:not(.tnai-files-restore){visibility:hidden}
html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .repository-rail .tnai-files-restore{display:flex;position:absolute;inset:0;width:100%;align-items:flex-start;justify-content:center;padding:24px 0 0;border:0;background:#f3f5ef;color:#3f4a36;font:inherit;font-size:17px;font-weight:700;line-height:1;cursor:pointer}
html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .repository-rail .tnai-files-restore:hover,html.tnai-files-hidden .layout.overview-mode:not(.workspace-mode) .repository-rail .tnai-files-restore:focus-visible{background:#f3f5ef;color:#5f7a45;outline:0}
/* In-panel confirm (TnaiPanelConfirm): laid over the one panel it asks about, the panel dimmed behind it. */
/* Above everything inside a terminal panel: xterm layers go up to 11 (overview ruler 8, scrollbar 10-11), the Latest button is 7. */
.tnai-panel-confirm{position:absolute;inset:0;z-index:20;display:grid;place-items:center;box-sizing:border-box;padding:10px;overflow:auto;border-radius:inherit;background:#fafaf8d6;backdrop-filter:blur(3px);cursor:default;animation:tnaiPanelConfirmFade .18s ease}
.tnai-panel-confirm-box{box-sizing:border-box;width:min(300px,100%);padding:14px 16px 13px;border:1px solid #e5e8e0;border-radius:9px;background:#fbfcf9;box-shadow:0 12px 34px #16191424;text-align:left;animation:tnaiPanelConfirmRise .2s ease}
.tnai-panel-confirm-box h3{margin:0;color:#20211f;font-size:13px;font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.tnai-panel-confirm-box p{margin:4px 0 0;color:#6e7467;font-size:11px;line-height:1.5;overflow-wrap:anywhere}
.tnai-panel-confirm .tnai-ws-close-actions{margin-top:12px}
.tnai-panel-confirm button:focus-visible{outline:var(--pg-ring,2px) solid #8da56c;outline-offset:2px}
.tnai-panel-confirm-box.floating{position:fixed;z-index:1001;width:280px;box-shadow:0 16px 44px #1619143b}
@keyframes tnaiPanelConfirmFade{from{opacity:0}}
@keyframes tnaiPanelConfirmRise{from{opacity:0;transform:translateY(4px) scale(.98)}}
@media (prefers-reduced-motion:reduce){.tnai-panel-confirm,.tnai-panel-confirm-box{animation:none}}
`;
  document.head.append(style);

  const startButton = document.createElement('button');
  startButton.className = 'button';
  startButton.type = 'button';
  startButton.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' Start agent';
  header.querySelector('.agent-page-actions')?.prepend(startButton);

  // Hide/show the File Repository rail on Overview (arrow-collapse, mirrored from the left nav's «
  // / » in 29-nav-collapse.js); remembered per viewer.
  const rail = document.querySelector('.repository-rail');
  const railCollapse = document.createElement('button');
  railCollapse.type = 'button';
  railCollapse.className = 'tnai-files-collapse';
  railCollapse.innerHTML = window.TnaiIcon('chevrons-right', { size: 16 });
  railCollapse.setAttribute('aria-label', 'Hide the file rail');
  railCollapse.title = railCollapse.title || 'Hide the file rail';
  railCollapse.title = 'Hide the File Repository so the agent tree gets the room';
  railCollapse.setAttribute('aria-label', 'Hide files');
  const railRestore = document.createElement('button');
  railRestore.type = 'button';
  railRestore.className = 'tnai-files-restore';
  railRestore.innerHTML = window.TnaiIcon('chevrons-left', { size: 16 });
  railRestore.setAttribute('aria-label', 'Show the file rail');
  railRestore.title = railRestore.title || 'Show the file rail';
  railRestore.title = 'Show the File Repository next to the agent tree';
  railRestore.setAttribute('aria-label', 'Show files');
  rail?.prepend(railCollapse, railRestore);
  const FILES_KEY = 'tnai.overview-files-hidden';

  function setFilesHidden(hidden) {
    document.documentElement.classList.toggle('tnai-files-hidden', hidden);
    try {
      localStorage.setItem(FILES_KEY, hidden ? '1' : '');
    } catch {}
  }
  let filesHidden = false;
  try {
    filesHidden = localStorage.getItem(FILES_KEY) === '1';
  } catch {}
  setFilesHidden(filesHidden);
  railCollapse.onclick = () => setFilesHidden(true);
  railRestore.onclick = () => setFilesHidden(false);
  const metrics = document.createElement('div');
  metrics.className = 'agent-metrics tnai-live-metrics';
  metrics.setAttribute('aria-live', 'polite');
  const panel = document.createElement('section');
  panel.className = 'agent-tree-panel tnai-live-panel';
  panel.innerHTML = `<header class="agent-tree-toolbar"><nav class="tnai-tree-bar" hidden><small>WORKSPACE</small><span class="tnai-ws-tabs" role="tablist" aria-label="Terminal workspace shown in the tree"></span></nav><p class="tnai-live-latest">Latest task: <b class="tnai-live-task"></b><small class="tnai-live-task-meta"></small></p><button type="button" class="tnai-task-more" data-more="latest" hidden aria-expanded="false" title="Show the whole task" aria-label="Show the whole task">${window.TnaiIcon('chevron-down', { size: 14 })}</button><div class="tnai-task-full tnai-latest-full" hidden></div><span class="tnai-toolbar-end"><span class="agent-local-state"><i></i><span class="tnai-live-folder"></span></span></span></header>
<div class="agent-tree-children tnai-live-sessions" role="list"><p class="tnai-live-empty">No terminal panels are connected to an agent. Start one with ＋ Start agent or from Terminal; it appears here with its live status.</p></div>`;
  (header.firstElementChild || header).append(metrics);
  header.after(panel);
  const $ = selector => panel.querySelector(selector);
  const list = $('.tnai-live-sessions'),
    empty = $('.tnai-live-empty');

  function openTerminalPage() {
    document.querySelector('.side-item[data-view="terminal"]')?.click();
  }
  const wsOf = paneId =>
    window.TnaiTerminalWorkspaceByPane?.[paneId] ||
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]')?.dataset
      .workspaceId ||
    'workspace-1';
  const showWorkspace = id =>
    document.querySelector('[data-workspace-tab="' + CSS.escape(id) + '"]:not(.active)')?.click();

  // Spotlight the pane the user came for so it stands out among many; it clears on the next click
  // outside that pane. One outside-click listener at a time: the previous spotlight's is removed
  // (its pane lost the spotlight above), so repeated spotlights don't stack listeners.
  let unspot = null;
  const spotlight = pane => {
    document
      .querySelectorAll('.terminal-pane.pane-spotlight')
      .forEach(p => p !== pane && p.classList.remove('pane-spotlight'));
    pane.classList.add('pane-spotlight');
    pane.scrollIntoView({ block: 'nearest' });
    if (unspot) document.removeEventListener('pointerdown', unspot, true);
    const clear = event => {
      if (pane.contains(event.target)) return;
      pane.classList.remove('pane-spotlight');
      document.removeEventListener('pointerdown', clear, true);
      if (unspot === clear) unspot = null;
    };
    unspot = clear;
    document.addEventListener('pointerdown', clear, true);
  };

  // An agent's thread, and the Threads page itself when that agent has no thread (its panel was
  // closed): a "Go to it" that does nothing reads as a broken button.
  const openThread = paneId => {
    if (!window.TnaiThreads?.show?.(paneId)) window.TnaiThreads?.open?.();
  };

  // Always ends somewhere true. An agent with no panel to show (its panel was closed, or its
  // workspace has no tab in the open project) is opened as its thread instead.
  const focusPane = (paneId, onTerminalPage) => {
    // In the thread layout an agent is gone to by opening its thread (118). The thread's own
    // "Terminal page" button asks for the page instead (120 passes true).
    if (!onTerminalPage && window.TnaiThreads?.show?.(paneId)) return;
    const find = () =>
      document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');
    if (!find()) {
      openThread(paneId);
      return;
    }
    openTerminalPage();
    showWorkspace(wsOf(paneId));
    setTimeout(() => {
      const pane = find();
      if (!pane || pane.closest('.terminal-workspace-view[hidden]')) {
        openThread(paneId);
        return;
      }
      window.TnaiDigest?.open?.(paneId);
      spotlight(pane);
      pane.querySelector('.tnai-xterm textarea')?.focus();
    }, 120);
  };
  startButton.onclick = () => {
    if (window.TnaiPaneLimit?.full()) {
      say(window.TnaiPaneLimit.message);
      return;
    }
    openTerminalPage();
    setTimeout(() => document.getElementById('newTerminalWindow')?.click(), 80);
  };

  // Tone = color: green working/starting, blue ready (waiting for input), amber
  // needs you, red error/stopped, gray idle.
  const TONE = {
    working: ['working', 'Working'],
    waiting: ['ready', 'Waiting for input'],
    'waiting-agents': ['agents', 'Waiting on agents'],
    background: ['background', 'Working in background'],
    'needs-you': ['waiting', 'Needs you'],
    starting: ['working', 'Starting'],
    'not-started': ['idle', 'Not started'],
    exited: ['stopped', 'Exited'],
    error: ['error', 'Error'],
  };

  // What each status means and how Technically Not knows it (working/waiting are inferred from
  // terminal output, not reported by the CLI).
  const STATUS_TIP = {
    working:
      'Working: the process printed output in the last few seconds (inferred from terminal output)',
    waiting:
      'Waiting for input: the process is running but has printed nothing for a few seconds, so it is probably waiting for you (inferred from terminal output)',
    background:
      'Working in background: its turn has ended, but tasks it started in the background (a command, a watcher, a workflow) are still running; it picks up again when they finish (from Claude Code hooks)',
    'waiting-agents':
      'Waiting on agents: its own sub-agents are still running and it is blocked on them (a foreground Claude Code sub-agent, or tnai_wait) or has gone quiet while they work (from Claude Code hooks and the Technically Not delegation graph; quiet is inferred from terminal output)',
    'needs-you':
      'Needs you: the CLI is stopped on a question (a tool permission, a numbered menu, folder trust, or a prompt left unsent in its input) and waits for your answer. Ctrl+Shift+J jumps to it',
    starting: 'Starting: Technically Not launched the CLI and is waiting for it to come up',
    'not-started': 'Not started: this panel has a connection but no process yet; press Start',
    exited: 'Exited: the process ended; press Start to run it again',
    error:
      'Error: the process could not start or ended with an error; open the terminal to see why',
  };
  const ACTIONS = [
    [/^(read|reading|readfile|viewed)$/i, 'Reading'],
    [/^(write|writing|wrote|writefile|create|created|creating|added)$/i, 'Writing'],
    [/^(delete|deleted)$/i, 'Deleting'],
    [/^changed$/i, 'Changed'],
  ];
  const actionLabel = verb => (ACTIONS.find(([re]) => re.test(verb)) || [0, 'Editing'])[1];

  // A CLI's terminal title is its task summary (Claude Code sets one); plain app names or shell
  // paths are not tasks. Gemini CLI 0.61's idle/waiting titles ("◇ Ready (<folder>)", "✋ Action
  // Required (<folder>)") and GitHub Copilot 1.0.88's "GitHub Copilot" aren't tasks either.
  const APP_TITLE =
    /^(claude( code)?|codex|gemini( cli)?|opencode|droid|cursor( agent)?|(github )?copilot|(ready|action required) (.*)|(administrator: )?windows powershell|powershell|-?(zsh|bash|fish|sh))$/i;

  function cliTitle(s) {
    if (s.agent === 'Terminal' || !s.title) return '';
    const t = String(s.title)
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim();
    return t && !APP_TITLE.test(t) && !/\.exe$/i.test(t) ? t : '';
  }

  // Task text is one truncated line; ⌄ appears when there is more (cut off or several lines) and
  // shows it all in a bounded box.
  const expanded = new Set(); // 'latest' or paneIds whose whole task is shown

  // Measuring forces a layout per card, so it runs only when the text, its open state or the tree's
  // size (layoutEpoch, bumped when fitKey changes) changed since the last measure, and never while
  // Overview is hidden (showing it renders again).
  const measured = new Map(); // key -> what it was last measured with
  let layoutEpoch = 0;

  function fullText(line, button, box, key, text = line.textContent) {
    // a line in the hidden grid has no width to measure
    if (!shownNow() || (gridHidden() && page.contains(line))) return;
    const stamp = text + '\u0000' + layoutEpoch + (expanded.has(key) ? '\u0001' : '');
    if (measured.get(key) === stamp) return;
    measured.set(key, stamp);
    const more = !!text && (/\n/.test(text) || line.scrollWidth > line.clientWidth + 1);
    const open = expanded.has(key) && (more || !box.hidden);

    // Writes only on change: every card measures here, so a no-op write would force a fresh layout
    // for the next card (freezes while agents work).
    if (button.hidden !== (!more && !open)) button.hidden = !more && !open;
    if (box.hidden !== !open) box.hidden = !open;
    if (button.getAttribute('aria-expanded') !== String(open))
      button.setAttribute('aria-expanded', String(open));
    const tip = open ? 'Hide the whole task' : 'Show the whole task';
    if (button.title !== tip) button.title = tip;
    if (open) setText(box, text);
    else if (!more) expanded.delete(key);
  }

  // Cards are built once per pane and updated field by field, so hover and focus survive
  // re-renders.
  const cards = new Map(); // paneId -> { el, refs }

  function createCard(paneId) {
    const el = document.createElement('article');
    el.className = 'agent-tree-node tnai-card';
    el.setAttribute('role', 'listitem');
    el.dataset.pane = paneId;
    el.title = CARD_TIP;
    el.innerHTML = `<div class="agent-node-head"><span class="agent-avatar c-avatar"></span><div class="agent-node-identity"><b class="c-name"></b><small class="c-sub"></small></div><span class="agent-status-pill"><i></i><span class="c-status"></span></span><button type="button" class="tnai-card-close" data-act="close" title="Close this terminal" aria-label="Close terminal">${window.TnaiIcon('x', { size: 14 })}</button></div>
<div class="tnai-card-body"><div class="tnai-card-limit tnai-card-decide" hidden><span class="c-decide"></span><span class="c-decide-opts"></span></div><div class="agent-node-task"><div class="c-title-row"><b class="c-title"></b><button type="button" class="tnai-task-more" hidden aria-expanded="false" title="Show the whole task" aria-label="Show the whole task">${window.TnaiIcon('chevron-down', { size: 14 })}</button></div><div class="tnai-task-full" hidden></div><p class="c-now"></p><span class="tnai-turn c-turn" hidden></span></div>
<div class="tnai-card-limit" hidden><span class="c-limit"></span><button type="button" data-act="switch-account">Switch account</button></div>
<div class="tnai-card-team"></div>
<div class="agent-skill-list c-chips"></div>
<div class="tnai-card-skills" hidden></div>
</div>
<div class="agent-node-foot"><span class="agent-node-actions"><button type="button" data-act="open" aria-label="Open terminal"><span class="c-wide">Open terminal</span><span class="c-narrow">Terminal</span></button><button type="button" data-act="stop">Stop</button><button type="button" data-act="start">Start</button></span></div>
<span class="c-meter" aria-hidden="true"><i></i></span>`;
    const q = sel => el.querySelector(sel);
    const refs = {
      avatar: q('.c-avatar'),
      name: q('.c-name'),
      sub: q('.c-sub'),
      pill: q('.agent-status-pill'),
      status: q('.c-status'),
      title: q('.c-title'),
      more: q('.c-title-row>.tnai-task-more'),
      full: q('.agent-node-task>.tnai-task-full'),
      now: q('.c-now'),
      chips: q('.c-chips'),
      team: q('.tnai-card-team'),
      skills: q('.tnai-card-skills'),
      limitBox: q('.tnai-card-limit:not(.tnai-card-decide)'),
      decideBox: q('.tnai-card-decide'),
      decide: q('.c-decide'),
      decideOpts: q('.c-decide-opts'),
      limit: q('.c-limit'),
      switchButton: q('[data-act="switch-account"]'),
      turn: q('.c-turn'),
      stop: q('[data-act="stop"]'),
      start: q('[data-act="start"]'),
    };
    const card = { el, refs, empty: false };
    cards.set(paneId, card);
    return card;
  }

  // role: 'lead' for an agent that leads (started with New agent, or one whose sub-agents are open
  // here), shown as "CLI · lead".
  function updateCard({ el, refs }, s, info, role) {
    const [tone, word] = TONE[s.status] || ['idle', s.status];
    const statusText =
      s.status === 'needs-you' &&
      /^Needs your decision/.test(window.TnaiNeedsYou?.label(s.paneId) || '')
        ? 'Needs your decision'
        : word; // 71: waiting on a decision, not a prompt

    // Attribute writes only on change (a same-value write still invalidates style; this runs for
    // every card on every render).
    if (el.dataset.tone !== tone) el.dataset.tone = tone;
    el.toggleAttribute('data-needs-you', s.status === 'needs-you');
    el.classList.toggle('tnai-target', s.paneId === target);
    setText(refs.avatar, (s.agent || '?').trim().charAt(0).toUpperCase());
    const cli = (s.agent || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (refs.avatar.dataset.cli !== cli) refs.avatar.dataset.cli = cli; // CLI tint (04-accents.css)
    setText(refs.name, s.name);
    const account =
      s.accountId !== undefined ? window.TnaiAccounts?.label?.(s.agent, s.accountId) : '';
    const acct = (window.tnaiMaskEmails || String)(account || info?.account || '');
    setParts(refs.sub, [
      [s.agent],
      [role ? ' · ' + role : ''],
      [acct && (s.agent ? ' · ' : '') + acct, true],
    ]);
    if (refs.sub.title !== refs.sub.textContent) refs.sub.title = refs.sub.textContent;
    if (refs.pill.className !== 'agent-status-pill ' + tone)
      refs.pill.className = 'agent-status-pill ' + tone;
    setText(refs.status, s.mode === 'login' && s.running ? 'Signing in' : statusText);
    const statusTip =
      s.mode === 'login' && s.running
        ? 'Signing in: the CLI is running its own sign-in flow in the terminal'
        : STATUS_TIP[s.status] || statusText;
    if (refs.pill.title !== statusTip) refs.pill.title = statusTip;
    const tip = (node, text) => {
      if (node.title !== text) node.title = text;
    };

    // The task line: the CLI's own title, else the last task Technically Not sent, else none yet
    // (the source is in the label's tooltip).
    const task = tasks[s.paneId],
      title = cliTitle(s);
    setText(
      refs.title,
      title ||
        (task?.text && (window.TnaiResults?.cleanTask?.(task.text) || task.text)) ||
        (s.agent === 'Terminal' ? window.tnaiShell() + ' · no agent task' : 'No task yet')
    );
    const source = title
      ? 'Task summary the CLI set as its terminal title'
      : task
        ? 'The last task Technically Not sent to this agent from the composer, ' + ago(task.at)
        : s.agent === 'Terminal'
          ? 'A plain shell: it runs what you type, it has no agent task'
          : 'Nothing sent yet: send it a task from the prompt box';

    // the source was the TASK label's tooltip
    tip(refs.title, refs.title.textContent + '\n\n' + source);
    fullText(refs.title, refs.more, refs.full, s.paneId);
    const action = window.TnaiFileActivity?.now?.(s.paneId),
      fresh = action && Date.now() - action.at < 120000;

    // 53: the open turn's latest tool call (hooks) or a permission prompt
    const doing = s.running ? window.TnaiLiveFeed?.doing?.(s.paneId) : null;
    el.toggleAttribute('data-perm', doing?.tone === 'waiting');

    // 53: a question waits for the user's answer ("Your answer" tag on the Now line)
    el.toggleAttribute('data-ask', !!doing?.ask);
    let now, nowTip;
    if (doing) {
      now = [['Now · ' + doing.text], [' · ' + ago(doing.since).replace(/ ago$/, ''), true]];
      nowTip = doing.tip;
    } else if (!s.running) {
      now = [[s.exitText || 'Not running · press Start']];
      nowTip = s.exitText
        ? 'Why the process ended, from its exit code'
        : 'No process is running in this panel';
    } else if (fresh) {
      const cut = action.path.lastIndexOf('/') + 1;
      now = [
        ['Now · ' + actionLabel(action.verb) + ' '],
        [action.path.slice(0, cut), true],
        [action.path.slice(cut)],
        [' · ' + ago(action.at), true],
      ];
      nowTip =
        'Latest file this agent touched (from Claude Code’s hook events, or inferred from other CLIs’ output)';
    } else if (s.status === 'needs-you') {
      now = [[window.TnaiNeedsYou?.label(s.paneId) || 'Needs you']];
      nowTip = window.tnaiKeys(
        'Stopped on a question for you. Click the card, or press Ctrl+Shift+J, to answer it in its thread.'
      );
    } else if (s.status === 'waiting-agents') {
      const n = window.TnaiTeam?.open?.(s.paneId),
        g = window.TnaiGraph,
        node = g?.node?.(s.paneId),
        k =
          (n ? n.fg + n.bg : 0) +
          (node
            ? g
                .state()
                .nodes.filter(
                  x => x.parentId === node.id && (x.status === 'starting' || x.status === 'working')
                ).length
            : 0);
      now = [['Waiting on ' + (k === 1 ? '1 sub-agent' : k + ' sub-agents')]];
      nowTip = STATUS_TIP['waiting-agents'];
    } else if (s.status === 'background') {
      const b = window.TnaiTeam?.background?.(s.paneId) || [],
        first = b[0];
      now = [
        ['Running ' + (b.length === 1 ? '1 background task' : b.length + ' background tasks')],
        [first ? ' · ' + (first.label || first.detail || first.tool) : '', true],
        [first ? ' · ' + ago(first.startedAt).replace(/ ago$/, '') : '', true],
      ];
      nowTip =
        STATUS_TIP.background +
        (b.length ? '\n' + b.map(x => '• ' + (x.label || x.detail || x.tool)).join('\n') : '');
    } else if (s.status === 'working') {
      now = [['Printing output'], [' · last line ' + ago(s.lastOutputAt), true]];
      nowTip = 'The agent is producing terminal output right now';
    } else if (s.status === 'waiting') {
      now = [
        ['Idle ' + ago(s.lastOutputAt).replace(/ ago$/, '')],
        [' · probably', true],
        [' waiting for you'],
        [task ? ' · task sent ' + ago(task.at) : '', true],
      ];
      nowTip =
        'No output for a while. It has likely finished or is asking a question; open its terminal to answer.';
    } else {
      now = [[statusText]];
      nowTip = statusTip;
    }

    // agents messaging each other (tnai send), fades TALK_MS after the last message; the optional
    // parts give way so one ellipsis cuts the status, never the tail
    const talk = s.running && talkLine(s.paneId);
    if (talk) {
      now = [
        [
          now
            .filter(([, drop]) => !drop)
            .map(([text]) => text)
            .join(''),
        ],
        [' · ↔ ' + talk.label, false, 'c-talk'],
      ];
      nowTip += '\n\n' + talk.tip;
    }
    setParts(refs.now, now);
    tip(refs.now, refs.now.textContent + '\n' + nowTip);

    const chips = [];
    if (s.agent === 'Terminal')
      chips.push([
        window.tnaiShell(),
        window.tnaiPlatform.win
          ? 'Windows PowerShell shell session'
          : window.tnaiShell() + ' shell session',
      ]);
    else if (info?.version) chips.push([info.version, 'Installed ' + s.agent + ' CLI version']);
    const model = window.TnaiAgentModel?.text?.(s);

    // 108: the model its replies run on, before the version
    if (model) chips.unshift([model, window.TnaiAgentModel.tip(s)]);
    const browser = window.TnaiChromeBrowser?.active?.(s.paneId);

    // 87: using Claude in Chrome now
    if (browser) chips.push([browser.label || 'Browser', browser.tip]);
    const team = window.TnaiAgentTeams?.chip?.(s.paneId);

    // 88: on a team the user set up (shares file locks); first, so it shows on the smallest cards
    if (team) chips.unshift(team);
    (window.TnaiFileActivity?.forPane?.(s.paneId) || [])
      .slice(0, 3)
      .forEach(f =>
        chips.push([
          '✎ ' + f.split('/').pop(),
          'File this agent is working on (inferred from its activity): ' + f,
        ])
      );
    const chipKey = JSON.stringify(chips);
    if (refs.chips.dataset.key !== chipKey) {
      refs.chips.dataset.key = chipKey;
      refs.chips.replaceChildren(
        ...chips.map(([text, tip]) => {
          const span = document.createElement('span');
          span.textContent = text;
          if (tip) span.title = tip;
          return span;
        })
      );
    }

    updateSkills(refs.skills, s);
    window.TnaiTeam?.paint(refs.team, s);
    window.TnaiTurns?.paint(refs.turn, s); // 42: task clock + real tokens
    window.TnaiResults?.paintCard(el, s); // 44: Result chip after the meter
    window.TnaiGraph?.paintCard(el, s); // 43: "↳ sub-agent of …" line + Keep

    // Hover summary: a one-line (micro) card still shows everything it hides.
    const meter = refs.turn.hidden ? '' : refs.turn.textContent;
    const live = s.running
      ? 'Process started ' +
        ago(s.startedAt) +
        (s.lastOutputAt ? ' · last output ' + ago(s.lastOutputAt) : '')
      : s.exitText || 'Process not started'; // was the card's footer line
    el.dataset.tip = [
      s.name +
        ' · ' +
        refs.status.textContent +
        (refs.sub.textContent ? ' · ' + refs.sub.textContent : ''),
      refs.title.textContent,
      refs.now.textContent,
      meter,
      live,
      '',
      CARD_TIP,
    ]
      .filter((line, i) => line || i === 5)
      .join('\n');
    if (!el.classList.contains('tnai-drop-ok') && !el.classList.contains('tnai-drop-no'))
      tip(el, el.dataset.tip);

    const limit = window.TnaiAccounts?.limitFor?.(s.paneId);
    refs.limitBox.hidden = !limit;
    if (limit) {
      setText(refs.limit, limit.text || 'This account reached its usage limit.');
      const id = suggestionId(limit),
        label = id != null ? limit.suggestLabel || window.TnaiAccounts?.label?.(s.agent, id) : '';
      refs.switchButton.hidden = id == null;
      setText(refs.switchButton, label ? 'Switch to ' + label : 'Switch account');
      if (id == null)
        setText(
          refs.limit,
          (limit.text || 'This account reached its usage limit.') +
            ' · No other signed-in account for this CLI; add one in Settings.'
        );
    }

    // An open "- Decide:" question (51) of an agent waiting on it: answer from the card; the choice
    // is sent to it (49 decide). A picker question or a question from main (71 items) is answered
    // in the terminal (click the card, or Ctrl+Shift+J).
    const dc =
      s.status === 'needs-you' && !window.TnaiNeedsYou?.items?.().some(i => i.paneId === s.paneId)
        ? window.TnaiNextActions?.deciding?.(s.paneId)
        : null;
    refs.decideBox.hidden = !dc?.options?.length;
    const decideKey = dc?.options?.length ? JSON.stringify([dc.id, dc.question, dc.options]) : '';
    if (refs.decideBox.dataset.key !== decideKey) {
      refs.decideBox.dataset.key = decideKey;
      refs.decideBox.dataset.id = dc?.id || '';
      setText(refs.decide, dc ? String(dc.question || 'Pick an option').trim() : '');
      refs.decide.title = refs.decide.textContent;

      // a Grid card gives each option an equal share of one row
      refs.decideOpts.style.setProperty('--n', dc?.options?.length || 1);
      refs.decideOpts.replaceChildren(
        ...(dc?.options || []).map((o, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.dataset.act = 'decide';
          b.dataset.i = i;
          b.textContent = o.label;
          b.title =
            o.label +
            '\nSend this choice to ' +
            s.name +
            (o.recommended ? ' (recommended by the agent)' : '');
          if (o.recommended) {
            const r = document.createElement('span');
            r.className = 'tnai-rec';
            r.textContent = 'Recommended';
            b.append(r);
          }
          return b;
        })
      );
    }

    refs.stop.hidden = !s.running;
    refs.start.hidden = !!s.running;
  }

  // Skills row: attached skills (outlined), skills seen in use right now (green dot); project/your
  // skills get a marker.
  const customFor = s => {
    const ca = window.TnaiCustomAgents;
    try {
      return (
        ca?.forPane?.(s.paneId) ||
        (s.customAgentId ? ca?.list?.().find(a => a.id === s.customAgentId) : null) ||
        null
      );
    } catch {
      return null;
    }
  };
  const SKILL_MARK = { project: 'project', user: 'yours' };
  const library = () => {
    try {
      return window.TnaiSkills?.list?.() || [];
    } catch {
      return [];
    }
  };

  function updateSkills(box, s) {
    const custom = customFor(s),
      skills = library();
    const matches =
      window.TnaiSkillsUI?.matches ||
      ((k, n) => String(k.name).toLowerCase() === String(n).toLowerCase());
    const used = s.running ? window.TnaiFileActivity?.skills?.(s.paneId) || [] : [];
    const chips = [];
    (custom?.skillIds || []).forEach(id => {
      const k = skills.find(x => x.id === id) || { id, name: id };
      const last = (window.TnaiFileActivity?.lastUsed?.() || [])
        .filter(u => matches(k, u.name))
        .sort((a, b) => b.at - a.at)[0];
      chips.push({
        id,
        name: k.name,
        state: used.some(u => matches(k, u.name)) ? 'in-use' : 'attached',
        mark: '',
        removable: true,
        tip:
          (k.description && !/^[>|][+-]?\d*$/.test(String(k.description).trim())
            ? k.description + ' · '
            : '') +
          'Attached to ' +
          custom.name +
          ' · ' +
          (last
            ? 'last used ' + new Date(last.at).toLocaleString() + (last.by ? ' by ' + last.by : '')
            : 'not used yet'),
      });
    });
    used.forEach(u => {
      if (chips.some(c => c.state === 'in-use' && matches({ id: c.id, name: c.name }, u.name)))
        return;
      const k = skills.find(x => matches(x, u.name));
      chips.push({
        id: k?.id || '',
        name: k?.name || u.name,
        state: 'in-use',
        mark: SKILL_MARK[k?.source] || (k ? '' : 'project'),
        removable: false,
        tip: 'In use now (seen in ' + s.name + '’s output)' + (k?.path ? ' · ' + k.path : ''),
      });
    });
    const canAdd = !!custom && custom.supportsSkills !== false && !!window.TnaiSkillsUI;
    const key = JSON.stringify([chips, canAdd, custom?.id]);
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren(
      ...chips.map(c => {
        const chip = document.createElement('span'),
          name = document.createElement('span');
        chip.className = 'c-skill';
        chip.dataset.state = c.state;
        chip.title = c.tip;
        name.textContent = c.name;
        chip.append(document.createElement('i'), name);
        if (c.mark) {
          const em = document.createElement('em');
          em.textContent = c.mark;
          chip.append(em);
        }
        if (c.removable) {
          const x = document.createElement('button');
          x.type = 'button';
          x.dataset.act = 'skill-detach';
          x.dataset.skillId = c.id;
          x.title = 'Take ' + c.name + ' off this agent';
          x.innerHTML = window.TnaiIcon('x', { size: 12 });
          x.setAttribute('aria-label', 'Take ' + c.name + ' off this agent');
          chip.append(x);
        }
        return chip;
      })
    );
    if (canAdd) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'c-skill-add';
      add.dataset.act = 'skill-add';
      add.innerHTML = window.TnaiIcon('plus', { size: 12 }) + ' Skill';
      add.title = 'Give this agent a skill from the library';
      box.append(add);
    }
    box.hidden = !box.childElementCount;
  }

  // 15 reports the suggested account as `suggest` (accountId, '' = default account, null = none
  // signed in).
  const suggestionId = limit => {
    const sg = limit?.suggest ?? limit?.suggestion;
    return sg && typeof sg === 'object' ? (sg.accountId ?? sg.id) : sg;
  };

  // Workspace tabs (only with 2+ workspaces): pick which terminal workspace the tree shows.
  // Defaults to Terminal's active one.
  let shownWs = null,
    followedWs = null,
    pickedWs = false;
  const bar = $('.tnai-tree-bar'),
    tabs = $('.tnai-ws-tabs');
  const ALL = 'all';

  function paintTabs(workspaces, sessions) {
    bar.hidden = workspaces.length < 2;
    const data = workspaces.map(w => {
      const panes = document.querySelectorAll(
        '.terminal-pane[data-workspace-id="' + CSS.escape(w.id) + '"]'
      ).length;
      return [
        w.id,
        w.name,
        panes,
        sessions.filter(s => s.running && wsOf(s.paneId) === w.id).length,
      ];
    });
    if (workspaces.length > 1)
      data.unshift([
        ALL,
        'All',
        data.reduce((n, d) => n + d[2], 0),
        data.reduce((n, d) => n + d[3], 0),
      ]);
    const key = JSON.stringify([data, shownWs]);
    if (tabs.dataset.key === key) return;
    tabs.dataset.key = key;
    tabs.replaceChildren(
      ...data.map(([id, name, panes, running]) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tnai-ws-tab';
        tab.dataset.ws = id;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(id === shownWs));
        tab.title =
          (id === ALL ? 'Every workspace’s agents' : name) +
          ' · ' +
          running +
          ' running of ' +
          panes +
          ' terminal' +
          (panes === 1 ? '' : 's');
        const label = document.createElement('span');
        label.textContent = name;
        const count = document.createElement('i');
        count.textContent = running + '/' + panes;
        if (running) tab.append(document.createElement('b'));
        tab.append(label, count);
        if (id === ALL || !window.TnaiTerminalWorkspaces?.close) return tab;
        const item = document.createElement('span');
        item.className = 'tnai-ws-item';
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'tnai-ws-close';
        close.dataset.wsClose = id;
        close.innerHTML = window.TnaiIcon('x', { size: 14 });
        close.setAttribute('aria-label', 'Close workspace');
        close.title = 'Close ' + name;
        close.setAttribute('aria-label', 'Close ' + name);
        item.append(tab, close);
        return item;
      })
    );
  }
  tabs.addEventListener('click', event => {
    const close = event.target.closest('.tnai-ws-close');
    if (close) {
      window.TnaiTerminalWorkspaces?.close?.(close.dataset.wsClose);
      return;
    }
    const tab = event.target.closest('.tnai-ws-tab');
    if (tab) pickedWs = true;
    if (tab && tab.dataset.ws !== shownWs) {
      shownWs = tab.dataset.ws;
      render();
    }
  });

  // A pane with no connection yet: a small placeholder with ＋ Add connection (opens the connection
  // dialog for that pane).
  const paneEl = paneId =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');

  function createEmptyCard(paneId) {
    const el = document.createElement('article');
    el.className = 'agent-tree-node tnai-card tnai-card-empty';
    el.setAttribute('role', 'listitem');
    el.dataset.pane = paneId;
    el.dataset.tone = 'empty';
    el.innerHTML = `<div class="agent-node-head"><span class="agent-avatar c-avatar">${window.TnaiIcon('plus', { size: 16 })}</span><div class="agent-node-identity"><b class="c-name"></b><small class="c-sub">No connection yet</small></div><button type="button" class="tnai-card-close" data-act="close" title="Close this terminal" aria-label="Close terminal">${window.TnaiIcon('x', { size: 14 })}</button></div>
<p class="tnai-card-hint">Choose an agent or a shell to run here.</p>
<div class="tnai-card-foot"><button type="button" class="tnai-card-connect" data-act="connect" title="Add a connection to this terminal">＋ Add connection</button></div>`;
    const card = { el, refs: { name: el.querySelector('.c-name') }, empty: true };
    cards.set(paneId, card);
    return card;
  }
  const updateEmptyCard = ({ refs }, paneId) =>
    setText(
      refs.name,
      paneEl(paneId)?.querySelector('.terminal-pane-title')?.textContent.trim() || 'New terminal'
    );

  // Asks inside the panel it is about (an agent card, the Agents page detail) instead of a
  // window-wide native confirm(): the panel dims and a small card offers Cancel / the action.
  // Resolves true or false; Escape, Cancel or a click on the dimmed panel cancel; focus starts on
  // Cancel, stays on the two buttons and returns to the opener. One ask per panel.
  function panelConfirm(host, { title, body = '', ok = 'OK', danger = false } = {}) {
    if (!host?.isConnected || host.querySelector(':scope > .tnai-panel-confirm'))
      return Promise.resolve(false);
    return new Promise(resolve => {
      const back = document.activeElement,
        layer = document.createElement('div');
      layer.className = 'tnai-panel-confirm';
      layer.innerHTML =
        '<section class="tnai-panel-confirm-box" role="alertdialog" aria-modal="true"><h3></h3><p></p><div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel">Cancel</button><button type="button" class="tnai-ws-close-confirm"></button></div></section>';
      const box = layer.firstChild,
        id = 'tnaiPanelConfirm' + Date.now();
      box.querySelector('h3').id = id;
      box.setAttribute('aria-labelledby', id);
      box.querySelector('h3').textContent = title;
      box.querySelector('p').textContent = body;
      box.querySelector('p').hidden = !body;
      const yes = box.querySelector('.tnai-ws-close-confirm');
      yes.textContent = ok;
      if (danger) yes.dataset.danger = '';
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

      // A panel too short for the card (a one-line chip in a busy workspace): the panel still dims,
      // and the card floats over it at full size (fixed, so no scroll box clips it), kept on the
      // panel while the page scrolls or resizes.
      const floating = host.clientHeight < 110;

      // The panel went away while asking (closed elsewhere): cancel, so the floating card, the
      // pending answer and these listeners don't linger.
      const place = () => {
        if (!host.isConnected) return done(false);
        const r = host.getBoundingClientRect(),
          w = box.offsetWidth,
          h = box.offsetHeight;
        box.style.left =
          Math.round(Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)) +
          'px';
        box.style.top = Math.round(Math.min(Math.max(8, r.top - 6), innerHeight - h - 8)) + 'px';
      };

      // A scrolled panel: cover what is visible and hold the scroll while asking.
      const overflow = host.style.overflow;
      if (host.scrollHeight > host.clientHeight) {
        Object.assign(layer.style, {
          top: host.scrollTop + 'px',
          bottom: 'auto',
          height: host.clientHeight + 'px',
        });
        host.style.overflow = 'hidden';
      }
      const done = answer => {
        layer.remove();
        box.remove();
        host.style.overflow = overflow;
        removeEventListener('scroll', place, true);
        removeEventListener('resize', place);
        window.removeEventListener('keydown', onKey, true);
        try {
          if (back?.isConnected) back.focus();
        } catch {}
        resolve(answer);
      };

      function onKey(event) {
        if (!host.isConnected) return done(false);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          done(false);
          return;
        }
        if (event.key !== 'Tab') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const bs = [...box.querySelectorAll('button')],
          i = bs.indexOf(document.activeElement);
        bs[(i + (event.shiftKey ? -1 : 1) + bs.length) % bs.length].focus();
      }

      // Clicks stay in the layer so the panel under it (open pane, select row) does not react.
      [layer, box].forEach(el => {
        ['mousedown', 'pointerdown'].forEach(type =>
          el.addEventListener(type, e => e.stopPropagation())
        );
        el.addEventListener('click', e => {
          e.stopPropagation();
          if (!host.isConnected) done(false);
          else if (e.target === layer || e.target.closest('.tnai-ws-close-cancel')) done(false);
          else if (e.target.closest('.tnai-ws-close-confirm')) done(true);
        });
      });
      window.addEventListener('keydown', onKey, true);
      host.append(layer);
      if (floating) {
        box.classList.add('floating');
        document.body.append(box);
        place();
        addEventListener('scroll', place, true);
        addEventListener('resize', place);
      }
      box.querySelector('.tnai-ws-close-cancel').focus();
    });
  }
  window.TnaiPanelConfirm = panelConfirm;
  let queued = 0;
  let queuedFrame = 0;
  let queuedTimer = 0;

  // Next frame, or 100 ms if the window isn't painting (hidden or covered windows get no animation
  // frames). Every trigger in the same frame merges into this one render. Declared before the
  // observers below use it (render is hoisted). Whichever of the two runs first cancels the other:
  // a minimized window runs no frames, and each render left one waiting there.
  const schedule = () => {
    if (queued) return;
    queued = 1;
    const run = () => {
      cancelAnimationFrame(queuedFrame);
      clearTimeout(queuedTimer);
      if (queued) {
        queued = 0;
        render();
      }
    };
    queuedFrame = requestAnimationFrame(run);
    queuedTimer = setTimeout(run, 100);
  };

  // What is still going on in a thread, as short sentences for the close question: the agent at
  // work, a background task, helpers that still run. Read from the thread list's own record (119),
  // so the question says what the thread itself shows.
  const BUSY_STATUS = new Set(['working', 'starting', 'background', 'waiting-agents']);

  function stillGoing(paneId, session) {
    if (!session?.running) return [];
    const list = window.TnaiThreadList;
    const thread = list?.thread?.(paneId);
    const said = [];
    if (thread?.status === 'working' || thread?.status === 'starting')
      said.push('It is working on a task.');
    if (thread?.status === 'background') said.push('It has a background task running.');
    const helpers = (list?.kids?.(paneId) || []).filter(kid => BUSY_STATUS.has(kid.status));
    if (helpers.length)
      said.push(
        helpers.length === 1
          ? '1 of its helpers is still working.'
          : helpers.length + ' of its helpers are still working.'
      );
    else if (thread?.status === 'waiting-agents') said.push('It is waiting on its helpers.');
    return said;
  }

  // Closes a thread's terminal (its × in the thread list, Delete there, Close thread in its "..."
  // menu): removes it, 10 stops the process. It always asks first, also for a thread that is not
  // running, so a thread is never closed by a stray click; the question says what would be
  // stopped.
  async function closePane(paneId, host) {
    const s = agents.sessions().find(x => x.paneId === paneId);
    const going = stillGoing(paneId, s);
    const body = going.length
      ? going.join(' ') + ' Closing stops it.'
      : s?.running
        ? 'Its session will end.'
        : 'It leaves the thread list.';
    if (
      !(await panelConfirm(host, {
        title: 'Close ' + (s?.name || 'this thread') + '?',
        body,
        ok: 'Close',
        danger: true,
      }))
    )
      return;
    paneEl(paneId)?.querySelector('.terminal-pane-tools button[title="Close terminal"]')?.click();
    schedule();
  }

  function connectPane(paneId) {
    openTerminalPage();
    showWorkspace(wsOf(paneId));
    setTimeout(
      () =>
        paneEl(paneId)
          ?.querySelector('.tnai-add-connection, .terminal-start-state button')
          ?.click(),
      120
    );
  }

  // Push updates for pane/workspace changes on the Terminal page (grids' direct children only:
  // xterm rows change constantly).
  const terminalContent = document.querySelector('#terminalView .terminal-content');
  if (terminalContent) {
    const seen = new WeakSet(),
      panesChanged = new MutationObserver(() => schedule());
    const watch = () =>
      terminalContent.querySelectorAll('.terminal-workspace-grid').forEach(grid => {
        if (!seen.has(grid)) {
          seen.add(grid);
          panesChanged.observe(grid, { childList: true });
        }
      });
    new MutationObserver(() => {
      watch();
      schedule();
    }).observe(terminalContent, { childList: true });
    watch();
  }
  const workspaceTabs = document.querySelector('.terminal-workspace-tabs');

  // 07 rewrites a tab's counts only when they change (a pane started or stopped), so every
  // notification here is a real change.
  if (workspaceTabs)
    new MutationObserver(() => schedule()).observe(workspaceTabs, {
      childList: true,
      subtree: true,
      characterData: true,
    });

  const heads = new Map(); // wsId -> heading element (All tab)
  let leads = new Set(); // this render's paneIds that have sub-agent panels here (one workspace)

  // The pane of the agent that delegated this pane's sub-agent (43), or ''.
  const parentPaneOf = paneId => {
    const g = window.TnaiGraph,
      n = g?.node?.(paneId);
    if (!n?.parentId) return '';
    return n.parentPaneId || g.state?.()?.nodes?.find(p => p.id === n.parentId)?.paneId || '';
  };

  // Fitted without transient boxes (.tnai-fitting, target ring off) so selecting a card never
  // changes the size; the list then gets the remaining height and scrolls inside itself only if the
  // cards need more. Grid: see grid(); All tab: micro.
  const setDensity = d => {
    if ((list.dataset.density || '') !== d) {
      if (d) list.dataset.density = d;
      else delete list.dataset.density;
    }
  };

  // Overview zoom (64) is CSS zoom on the page: rects come zoomed, client/offset sizes and
  // max-height do not, so rects are divided back.
  const rectH = el => el.getBoundingClientRect().height;

  function slack() {
    const top = page.getBoundingClientRect().top;
    const bottom = [...inner.children].reduce(
      (m, el) => (el.offsetParent ? Math.max(m, el.getBoundingClientRect().bottom) : m),
      top
    );
    return (
      page.clientHeight -
      (bottom - top + page.scrollTop + (parseFloat(getComputedStyle(page).paddingBottom) || 0))
    );
  }

  // Micro (All tab) keeps its auto-filled grid.
  function unshape() {
    delete list.dataset.cols;
    ['--tnai-tracks', '--tnai-track', '--tnai-card-h'].forEach(k => list.style.removeProperty(k));
    for (const el of list.children) if (el.style.gridColumnStart) el.style.gridColumnStart = '';
  }

  // Grid layout (the website's Overview look): a fixed workspace grid, GRID_COLS panels per row
  // whatever the count (fewer only when a column would be narrower than GRID_MIN), so a full
  // workspace (TnaiPaneLimit.max = 12) is always the same 4 × 3 and every panel keeps its slot.
  // Every card one size and at most GRID_MAX wide; rows fill left to
  // right, a sub-agent right after its lead (render). The grid has two half-tracks per card (CSS
  // span 2). The tier follows the column width, never micro.
  const GRID_COLS = 4,
    GRID_MIN = 170,
    GRID_MAX = 340,
    // 170: a card's actions fit on one line; 136: head, task and actions still show
    GRID_MIN_H = 136;

  function grid() {
    const css = getComputedStyle(list),
      width =
        list.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0),
      gap = parseFloat(css.columnGap) || 14;
    const els = [...list.children].filter(el => el.classList.contains('tnai-card'));
    let cols = GRID_COLS;
    while (cols > 1 && cols * GRID_MIN + (cols - 1) * gap > width) cols--;
    const colWidth = Math.min(GRID_MAX, (width - (cols - 1) * gap) / cols);
    setDensity(colWidth >= 250 ? '' : colWidth >= 200 ? 'compact' : 'dense');
    list.dataset.cols = cols;
    list.style.setProperty('--tnai-tracks', cols * 2);
    list.style.setProperty(
      '--tnai-track',
      Math.max(0, (colWidth - gap) / 2 - 0.01).toFixed(2) + 'px'
    ); // exact half-columns: flexible tracks were sized by card content
    for (const el of els) if (el.style.gridColumnStart) el.style.gridColumnStart = '';

    // Shorter windows: when the rows (at most a full workspace's 3) don't
    // fit the room at the tier's height, every panel shrinks by the same amount, never below
    // GRID_MIN_H (the body extras scroll inside it); past that the list scrolls.
    list.style.removeProperty('--tnai-card-h');
    const room = rectH(list) + slack(),
      nRows = Math.min(3, Math.ceil(els.length / cols));
    const tierH = parseFloat(css.getPropertyValue('--tnai-card-h')) || 206,
      rowGap = parseFloat(css.rowGap) || 16;
    const fitH = Math.floor(
      (room -
        (parseFloat(css.paddingTop) || 0) -
        (parseFloat(css.paddingBottom) || 0) -
        (nRows - 1) * rowGap) /
        Math.max(1, nRows)
    );
    if (nRows && fitH < tierH)
      list.style.setProperty('--tnai-card-h', Math.max(GRID_MIN_H, fitH) + 'px');

    // Unrounded cap: cards that need more room scroll inside the list, not the page.
    list.style.maxHeight = Math.max(room, 120).toFixed(2) + 'px';
  }

  function fit(count, all) {
    if (!measurable()) {
      setDensity(all ? 'micro' : count >= 7 ? 'dense' : count >= 4 ? 'compact' : '');
      return;
    } // provisional by count until Overview is shown and measured
    if (!count) {
      setDensity('');
      unshape();
      list.style.maxHeight = '';
      return;
    }
    const scrolled = list.scrollTop;
    list.style.maxHeight = '';
    list.classList.add('tnai-fitting');
    if (all) {
      setDensity('micro');
      unshape();
      const height = rectH(list),
        room = height + slack();

      // Unrounded cap (a floored one scrolls by a sub-pixel).
      list.style.maxHeight = (room >= height ? room : Math.max(room, 120)).toFixed(2) + 'px';
    } else grid();
    list.classList.remove('tnai-fitting');
    list.scrollTop = scrolled;
  }

  // Anything that sizes the tree (page, list, what sits above it, each card) bumps sizeEpoch after
  // layout, without forcing one; a render measures (fitKey, a forced layout) only when that epoch
  // or the card set changed, not on every render during a burst.
  let sizeEpoch = 0;
  const sized = new Set();
  const sizeRO = new ResizeObserver(() => {
    sizeEpoch++;
    schedule();
  });
  const watchSize = els => {
    const now = new Set(els);
    for (const el of sized)
      if (!now.has(el)) {
        sizeRO.unobserve(el);
        sized.delete(el);
      }
    for (const el of now)
      if (!sized.has(el)) {
        sizeRO.observe(el);
        sized.add(el);
      }
  };
  sizeRO.observe(page);
  sizeRO.observe(list);
  [...(list.parentElement?.children || [])].forEach(el => el !== list && sizeRO.observe(el));

  // Blocks above the tree in the page column, including ones other scripts add later (17's custom
  // agent form and strip): hiding one frees room without resizing anything watched above, so
  // without this the tree stayed shrunk after the form closed.
  const watchInner = () => {
    for (const el of inner?.children || []) sizeRO.observe(el);
  };
  watchInner();
  if (inner) new MutationObserver(watchInner).observe(inner, { childList: true });

  // What the fitted tier depends on, read without writing (one layout at most); '' while Overview
  // is hidden.
  let lastFit = '',
    lastWidth = '',
    lastCheap = '';

  function fitKey(count, all) {
    if (!measurable()) return '';
    const els = [...list.children].filter(
      el => el.classList.contains('tnai-card') || el.classList.contains('tnai-ws-group')
    );
    return [
      count,
      all ? 1 : 0,
      [...leads].join('+'),
      page.clientWidth,
      page.clientHeight,
      Math.round(list.getBoundingClientRect().top),
      els.map(el => (el.dataset.pane || el.dataset.ws || '') + ':' + el.offsetHeight).join(),
    ].join('|');
  }

  const METRIC_TIP = {
    'Live sessions': 'Threads with a running process (agent CLIs and ' + window.tnaiShell() + ')',
    Working: 'Sessions that printed output in the last few seconds (inferred from terminal output)',
    'Waiting on agents':
      'Agents waiting on their own sub-agents to finish (blocked on them, or quiet while they run)',
    'Waiting for input':
      'Running sessions that have been quiet for a few seconds, probably waiting for you (inferred)',
    'Needs you':
      'Agents stopped on a question for you: a tool permission, a numbered menu, folder trust, or a prompt left unsent (' +
      window.tnaiKeys('Ctrl+Shift+J') +
      ' jumps to the oldest)',
    'Needs attention': 'Sessions that failed to start or ended with an error',
  };

  // The status legend lives in the tooltip (it was a row under the tree).
  const LEGEND =
    'Status colors: green = working or starting · blue = finished, waiting for input · amber = needs you (pulsing) · red = error or stopped · gray = not started';
  const metric = (label, value, status, word) =>
    `<span class="agent-metric" data-status="${status}"${value ? '' : ' data-zero'} title="${label}: ${METRIC_TIP[label] || ''}&#10;${LEGEND}"><b>${value}</b> ${word}</span>`;
  let rootPath = '',
    rootAt = 0;
  window.addEventListener('tnai:project-changed', () => {
    rootAt = 0;
    schedule();
  }); // another project became active (09)

  // All tab only (one workspace keeps Terminal order): active agents float to the top so none is
  // missed below the fold: working, then needs you / error, then waiting or starting, then idle
  // (not started, exited), then empty terminals. Working holds its rank for HOLD_MS after the last
  // output, so a card that pauses between lines doesn't jump down and back up. Sort is stable:
  // Terminal order within a rank.
  const HOLD_MS = 8000,
    activeUntil = new Map();
  const RANK = {
    working: 0,
    'needs-you': 1,
    error: 1,
    waiting: 2,
    'waiting-agents': 2,
    background: 2,
    starting: 2,
    'not-started': 3,
    exited: 3,
  };

  function byActivity(ids, bySession) {
    const now = Date.now();
    const rank = id => {
      const s = bySession.get(id);
      if (!s) {
        activeUntil.delete(id);
        return 4;
      }
      if (s.status === 'working') activeUntil.set(id, now + HOLD_MS);
      const r = RANK[s.status] ?? 3;
      return r > 0 && s.running && (activeUntil.get(id) || 0) > now ? 0 : r;
    };
    const ranks = new Map(ids.map(id => [id, rank(id)]));
    return ids
      .map((id, i) => [id, i])
      .sort((a, b) => ranks.get(a[0]) - ranks.get(b[0]) || a[1] - b[1])
      .map(([id]) => id);
  }

  // Reorders the tree and slides the cards that moved from their old spot (FLIP), so a reshuffle
  // reads as movement, not a jump.
  const calm = matchMedia('(prefers-reduced-motion: reduce)');

  function slideTo(order, current) {
    const animate = measurable() && !calm.matches && current.length > 0;
    const before = animate ? new Map(current.map(el => [el, el.getBoundingClientRect()])) : null;

    // Moves only the cards that are out of place (re-appending all of them restarted every card's
    // pulse and re-laid the whole tree).
    let prev = null;
    order.forEach(el => {
      if (prev) {
        if (prev.nextElementSibling !== el) prev.after(el);
      } else if (current[0] && el !== current[0]) current[0].before(el);
      else if (!current[0]) list.append(el);
      prev = el;
    });
    if (!animate) return;
    order.forEach(el => {
      const a = before.get(el);
      if (!a) return;
      const b = el.getBoundingClientRect(),
        dx = a.left - b.left,
        dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], {
        duration: 260,
        easing: 'cubic-bezier(.2,.7,.2,1)',
      });
    });
  }

  let renderedAt = -1e9;

  async function render() {
    renderedAt = performance.now();
    const sessions = agents.sessions(),
      info = new Map(agents.info().map(a => [a.id, a]));
    if (target && !sessions.some(s => s.paneId === target)) target = null;
    const running = sessions.filter(s => s.running),
      count = st => sessions.filter(s => s.status === st).length;
    const signedIn = agents.info().filter(a => a.loggedIn === true).length;

    // The tree is the deleted Overview's, never on screen in the thread design (118 takes the
    // Overview route to Threads): only the header line and the composer's worker line, which live
    // outside it, are kept current. Its cards were built on every agent change for nothing (speed
    // lead 8, docs/notes/speed-numbers.md). Should the tree be shown again, the .layout class
    // observer below renders it in full.
    if (!shownNow() && !window.TnaiOverviewPopout?.ids?.().length) {
      paintHeader(running.filter(s => s.agent !== 'Terminal').length, signedIn);

      // Cards built in the moment at start when the old Overview class is on (02 sets it before
      // 118 opens Threads) go too: a later thread can take that empty panel's id.
      for (const card of cards.values()) card.el.remove();
      cards.clear();
      measured.clear();
      return;
    }
    const metricsHtml = [
      metric('Live sessions', running.length, '', 'live'),
      metric('Working', count('working') + count('background'), 'working', 'working'),
      metric('Waiting for input', count('waiting'), 'waiting', 'waiting'),
      metric('Waiting on agents', count('waiting-agents'), 'waiting-agents', 'on agents'),
      metric('Needs you', count('needs-you'), 'needs-you', 'need you'),
      metric('Needs attention', count('error'), 'error', 'attention'),
    ].join('<i aria-hidden="true">·</i>');
    if (metrics.dataset.key !== metricsHtml) {
      metrics.dataset.key = metricsHtml;
      metrics.innerHTML = metricsHtml;
    }
    const latest = Object.entries(tasks).sort((a, b) => b[1].at - a[1].at)[0];
    setText($('.tnai-live-task'), latest ? latest[1].text : 'No task sent yet');
    setText(
      $('.tnai-live-task-meta'),
      latest
        ? 'Sent to ' + latest[1].to + ' · ' + ago(latest[1].at)
        : 'Choose an agent below, then describe a task in the composer.'
    );
    const latestTip = latest
      ? 'Latest task sent from Technically Not: ' +
        latest[1].text +
        '\n' +
        $('.tnai-live-task-meta').textContent
      : 'No task sent from Technically Not yet';
    if ($('.tnai-live-latest').title !== latestTip) $('.tnai-live-latest').title = latestTip;
    fullText(
      $('.tnai-live-latest'),
      $('.tnai-task-more[data-more=latest]'),
      $('.tnai-latest-full'),
      'latest',
      latest ? latest[1].text : ''
    );

    // Not awaited: an await here split the render's DOM writes across tasks. A changed folder
    // renders again.
    if (Date.now() - rootAt > 3000) {
      rootAt = Date.now();
      Promise.resolve(window.TnaiDesktop?.rootPath?.())
        .then(p => {
          p = p || '';
          if (p !== rootPath) {
            rootPath = p;
            schedule();
          }
        })
        .catch(() => {});
    }

    // Document-wide: 94 moves .tnai-toolbar-end (with this chip) out of the panel in Rows.
    setText(
      document.querySelector('.tnai-live-folder'),
      rootPath
        ? 'Working folder · ' + rootPath.split(/[\\/]/).pop()
        : 'No project folder · agents start in your user folder'
    );

    // The tree mirrors one terminal workspace: its panes in Terminal order (each panel in the same
    // row and column as on Terminal), connected ones as agent cards, empty ones as small
    // placeholders.
    const workspaces = window.TnaiTerminalWorkspaces?.list?.() || [];
    const activeWs = window.TnaiTerminalWorkspaces?.activeId?.();
    if (activeWs && activeWs !== followedWs) {
      followedWs = activeWs;
      shownWs = activeWs;
      pickedWs = false;
    } // switching on Terminal switches the tree too

    // A full workspace overflowed into a new one while agents run in both: show All, so the tree
    // doesn't hide the agents the header counts behind the new workspace's one panel. Only until
    // the user picks a tab here or switches workspace on Terminal.
    const full = w =>
      w.id !== shownWs &&
      (window.TnaiPaneLimit?.count?.(w.id) ?? 0) >= (window.TnaiPaneLimit?.max ?? Infinity);
    if (
      !pickedWs &&
      shownWs !== ALL &&
      workspaces.some(full) &&
      new Set(sessions.filter(s => s.running).map(s => wsOf(s.paneId))).size > 1
    ) {
      shownWs = ALL;
      pickedWs = true;
    }
    const all = shownWs === ALL && workspaces.length > 1;
    if (!all && !workspaces.some(w => w.id === shownWs))
      shownWs = activeWs || workspaces[0]?.id || 'workspace-1';
    paintTabs(workspaces, sessions);
    const bySession = new Map(sessions.map(s => [s.paneId, s]));
    const paneIds = ws => {
      const ids = [...document.querySelectorAll('.terminal-pane[data-pane-id]')]
        .filter(p => wsOf(p.dataset.paneId) === ws)
        .map(p => p.dataset.paneId);
      sessions
        .filter(s => wsOf(s.paneId) === ws && !ids.includes(s.paneId))
        .forEach(s => ids.push(s.paneId));

      // a tab never shows more than its workspace can hold (its panes come first)
      return ids.slice(0, window.TnaiPaneLimit?.max ?? ids.length);
    };

    // One workspace: its panes (empty ones as placeholders). All: each workspace's connected agents
    // under a heading.
    const groups = all
      ? workspaces.map(w => {
          const ids = paneIds(w.id);
          return {
            w,
            panes: ids.length,
            ids: byActivity(
              ids.filter(id => bySession.has(id)),
              bySession
            ),
          };
        })
      : // All tab: activity order; one workspace: Terminal order
        [{ ids: paneIds(shownWs) }];

    // Sub-agents next to their lead (one workspace): Terminal order, each sub-agent (43's task
    // graph) moved right after the agent that started it, nested sub-agents after theirs. Same grid
    // as without sub-agents; the card's "sub-agent of" line names the lead.
    leads = new Set();
    if (!all) {
      const ids = groups[0].ids,
        parent = new Map(ids.map(id => [id, parentPaneOf(id)]));
      const hasLead = id => {
        const p = parent.get(id);
        return !!p && p !== id && ids.includes(p) && bySession.has(p);
      };
      const out = new Set(),
        add = id => {
          if (out.has(id)) return;
          out.add(id);
          ids
            .filter(k => parent.get(k) === id && hasLead(k))
            .forEach(k => {
              leads.add(id);
              add(k);
            });
        };
      ids.filter(id => !hasLead(id)).forEach(add);
      ids.forEach(add); // the second pass keeps any id a loop left out
      groups[0].ids = [...out];
    }
    const shown = groups.flatMap(g => g.ids);
    const ids = new Set(shown);
    for (const [paneId, card] of cards) {
      if (ids.has(paneId) && card.empty === !bySession.has(paneId)) continue;
      card.el.remove();
      cards.delete(paneId);
      measured.delete(paneId);
    }
    shown.forEach(paneId => {
      const s = bySession.get(paneId);
      if (s) {
        const card = cards.get(paneId) || createCard(paneId);
        updateCard(card, s, info.get(s.agent), leads.has(paneId) || s.ownedByUser ? 'lead' : '');
      } else updateEmptyCard(cards.get(paneId) || createEmptyCard(paneId), paneId);
    });
    for (const [wsId, head] of heads)
      if (!all || !workspaces.some(w => w.id === wsId)) {
        head.remove();
        heads.delete(wsId);
      }
    const order = groups.flatMap(g => {
      const els = g.ids.map(id => cards.get(id).el);
      if (!all) return els;
      let head = heads.get(g.w.id);
      if (!head) {
        head = document.createElement('div');
        head.className = 'tnai-ws-group';
        head.dataset.ws = g.w.id;
        head.innerHTML = '<span></span><small></small>';
        heads.set(g.w.id, head);
      }
      const running = g.ids.filter(id => bySession.get(id)?.running).length;
      setText(head.firstChild, g.w.name);
      setText(
        head.lastChild,
        running +
          ' running / ' +
          g.panes +
          ' terminal' +
          (g.panes === 1 ? '' : 's') +
          (g.ids.length ? '' : ' · no agents connected')
      );
      return [head, ...els];
    });
    const current = [...list.children].filter(
      el => el.classList.contains('tnai-card') || el.classList.contains('tnai-ws-group')
    );
    if (order.length !== current.length || order.some((el, i) => el !== current[i]))
      slideTo(order, current);
    if (all) list.dataset.all = '';
    else delete list.dataset.all;
    empty.hidden = shown.length > 0;

    // plain PowerShell panels are not agents
    paintHeader(running.filter(s => s.agent !== 'Terminal').length, signedIn);

    // Measuring the tier forces several full layouts, and renders come many times a second while
    // agents work (the composer froze while typing). It re-measures only when something that sizes
    // the tree changed (pane set, room, card heights, layout); a card that got shorter changes its
    // height in fitKey, so no periodic refit is needed (a forced 2 s refit caused lag spikes with
    // many agents).
    watchSize(order);
    const cheap = measurable()
      ? [
          shown.length,
          all ? 1 : 0,
          [...leads].join('+'),
          sizeEpoch,
          order.map(el => el.dataset.pane || el.dataset.ws || '').join(),
        ].join('|')
      : '';
    const reuse = !!(cheap && cheap === lastCheap && lastFit),
      // nothing resized since the last measure: reuse it
      fitNow = reuse ? lastFit : fitKey(shown.length, all);
    lastCheap = cheap;
    const refit = !measurable() || fitNow !== lastFit;

    // Overview hidden: a provisional tier by count, nothing measured
    if (refit) fit(shown.length, all);

    // nothing was written since fitNow: measuring again was a second full layout per render
    const fitAfter = !measurable() ? '' : refit ? fitKey(shown.length, all) : fitNow;

    // The column width changed: the task lines measure again in one more render (fullText ran
    // before this fit). Card heights alone don't change how much of a line fits, so they don't
    // re-measure every card (that was N forced layouts per height change). Nothing resized and
    // nothing refitted: the width is the one read last time, and reading clientWidth after this
    // render's writes was a forced layout.
    const widthNow =
      fitAfter &&
      (reuse && !refit
        ? lastWidth
        : [list.dataset.cols, list.dataset.density, list.clientWidth, all ? 1 : 0].join('|'));
    if (widthNow && widthNow !== lastWidth) {
      lastWidth = widthNow;
      layoutEpoch++;
      schedule();
    }
    lastFit = fitAfter;

    // Overview hidden: the cards stay current, but nothing is measured (slack forces a layout).
    // Showing Overview again renders and measures once (the .layout class observer and the page
    // ResizeObserver below schedule it).
  }
  new MutationObserver(schedule).observe(document.querySelector('.layout'), {
    attributes: true,
    attributeFilter: ['class'],
  }); // Overview shown → render and refit

  // Header status and activity line reflect real sessions instead of the prototype text.
  // The activity line above the composer asks for the old Agents and history page, and the
  // router (08) answers that with the Threads page: every session is a thread there.
  document
    .getElementById('activityToggle')
    ?.addEventListener('click', () =>
      document.querySelector('.side-item[data-view="agents"]')?.click()
    );

  function paintHeader(running, signedIn) {
    const top = document.querySelector('.top-right .status');

    // Writes only on change: this runs on every render, and a same-value innerHTML still rebuilds
    // nodes and invalidates style.
    const topHtml =
      '<i class="dot"></i>' +
      (running ? running + ' agent' + (running > 1 ? 's' : '') + ' running' : 'No agents running') +
      ' · ' +
      signedIn +
      ' signed in';
    if (top && (top.dataset.key !== topHtml || !top.querySelector('.dot'))) {
      top.dataset.key = topHtml;
      top.innerHTML = topHtml;
      top.querySelector('.dot').style.background = running ? '#6f9a4f' : '#b4b8ad';
    }
    const navCount = document.querySelector('.side-item[data-view="overview"] .agent-nav-count');
    if (navCount) setText(navCount, String(running || ''));
    const worker = workerLabel;
    if (worker)
      setText(
        worker,
        running
          ? 'Technically Not · ' +
              running +
              ' agent' +
              (running > 1 ? 's' : '') +
              ' running' +
              (target ? ' · tasks go to the selected agent' : '')
          : 'Technically Not ready · no agents running'
      );
  }

  // Card clicks.
  panel.addEventListener('click', cardClick);

  function cardClick(event) {
    // reading or selecting the whole task never opens the Agents page
    if (event.target.closest('.tnai-task-full')) return;
    const more = event.target.closest('.tnai-task-more');
    if (more) {
      event.stopPropagation();
      const key = more.dataset.more || more.closest('[data-pane]')?.dataset.pane;
      if (key) {
        expanded.has(key) ? expanded.delete(key) : expanded.add(key);
        render();
      }
      return;
    }
    if (event.target.closest('.tnai-card-team')) return;
    const button = event.target.closest('button[data-act]'),
      card = event.target.closest('[data-pane]');
    if (button) {
      event.stopPropagation();
      const act = button.dataset.act,
        paneId = card?.dataset.pane;
      if (act === 'connect') {
        connectPane(paneId);
        return;
      }
      if (act === 'close') {
        closePane(paneId, card);
        return;
      }
      if (act === 'open') focusPane(paneId);
      if (act === 'stop')
        panelConfirm(card, {
          title: 'Stop this agent session?',
          body: 'Its process will be ended.',
          ok: 'Stop',
          danger: true,
        }).then(ok => ok && agents.stop(paneId));
      if (act === 'start') agents.start(paneId);
      if (act === 'skill-add' || act === 'skill-detach') {
        const s = agents.sessions().find(x => x.paneId === paneId),
          custom = s && customFor(s);
        if (custom && act === 'skill-add')
          window.TnaiSkillsUI?.openApply(button, { agentId: custom.id });
        if (custom && act === 'skill-detach')
          window.TnaiSkillsUI?.detach(custom.id, [button.dataset.skillId]).then(schedule);
        return;
      }
      if (act === 'decide') {
        const id = button.closest('.tnai-card-decide')?.dataset.id;
        if (id) window.TnaiContext?.decide?.(id, button.dataset.i, 'send');
      }
      if (act === 'switch-account')
        window.TnaiAccounts?.switchPane?.(
          paneId,
          suggestionId(window.TnaiAccounts?.limitFor?.(paneId))
        );
      setTimeout(render, 300);
      return;
    }
    if (
      !card ||
      card.classList.contains('tnai-card-empty') ||
      event.target.closest('a, input, textarea, select, .tnai-card-limit')
    )
      return;
    setTarget(card.dataset.pane);
    openThread(card.dataset.pane);
  }

  // Cards take dropped skills (the Skills page drag type) and SKILL.md files from Explorer
  // (imported, then attached).
  const DRAG_TYPE = 'application/x-tnai-skill';
  const dropCard = event => event.target.closest?.('.tnai-card');
  const dropInfo = card => {
    const s = agents.sessions().find(x => x.paneId === card.dataset.pane),
      custom = s && customFor(s);
    return {
      custom,
      ok: !!custom && custom.supportsSkills !== false,
      why: !custom
        ? 'Only custom agents take skills. Create one in Settings › Agents › Custom agents.'
        : custom.base + ' can’t load skills per session yet.',
    };
  };
  const skillDrag = event => {
    const types = [...(event.dataTransfer?.types || [])];
    return types.includes(DRAG_TYPE) || types.includes('Files');
  };
  const clearDrop = card => {
    card.classList.remove('tnai-drop-ok', 'tnai-drop-no');
    card.title = card.dataset.tip || CARD_TIP;
  };
  list.addEventListener('dragover', event => {
    const card = dropCard(event);
    if (!card || !skillDrag(event)) return;
    const { ok, why } = dropInfo(card);
    card.classList.toggle('tnai-drop-ok', ok);
    card.classList.toggle('tnai-drop-no', !ok);
    card.title = ok ? 'Drop to give this agent the skill' : why;
    if (ok) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    }
  });
  list.addEventListener('dragleave', event => {
    const card = dropCard(event);
    if (card && !card.contains(event.relatedTarget)) clearDrop(card);
  });
  list.addEventListener('drop', async event => {
    const card = dropCard(event);
    if (!card || !skillDrag(event)) return;
    event.preventDefault();
    clearDrop(card);
    const { custom, ok, why } = dropInfo(card);
    if (!ok) {
      say(why);
      return;
    }
    const skillId = event.dataTransfer.getData(DRAG_TYPE);
    if (skillId) {
      await window.TnaiSkillsUI?.attach(custom.id, [skillId]);
      schedule();
      return;
    }
    if (event.dataTransfer.files?.length && window.TnaiSkills?.import) {
      const before = new Set(library().map(k => k.id));
      await window.TnaiSkillsUI?.importSkills(event.dataTransfer.files);
      const added = library()
        .filter(k => !before.has(k.id))
        .map(k => k.id);
      if (added.length) await window.TnaiSkillsUI?.attach(custom.id, added);
      schedule();
    }
  });

  // Tasks Technically Not sent to a session from the composer, shown on its card and in the
  // toolbar.
  function record(paneId, text, to) {
    tasks[paneId] = { text, at: Date.now(), to };
    saveTasks();
    schedule();

    // the thread that got it goes to its newest line (122)
    window.dispatchEvent(new CustomEvent('tnai:prompt-sent', { detail: { paneId } }));
  }

  function setTarget(paneId) {
    target = paneId || null;
    render();
    window.dispatchEvent(new CustomEvent('tnai:target-changed', { detail: { paneId: target } }));
  }

  // Shared with the Agents page (25): latest task per pane, the CLI's own task title, composer
  // target, open in Terminal.
  window.TnaiLiveTasks = {
    record,
    get: paneId => (tasks[paneId] ? { ...tasks[paneId] } : null),
    title: cliTitle,
    target: () => target,
    setTarget,
    sendFrom,
    focusPane,
    close: closePane,
    cardClick,
    render: schedule,
    popOut: paneId =>
      !!(
        cards.get(paneId) &&
        !cards.get(paneId).empty &&
        window.TnaiOverviewPopout?.open(paneId, cards.get(paneId).el) &&
        (schedule(), true)
      ),
  };

  // Composer → lead agent, from any page. The task always lands on Overview. The lead is the
  // selected running agent, else the only running Claude Code (or only running agent); with none
  // running, Technically Not starts a Claude Code lead. A Claude Code lead gets the task marked
  // "[TN.ai]"; it decides for itself whether to use sub-agents (19 shows them under its card). A
  // busy agent: only it can judge whether the new task belongs to its work. A Claude Code lead
  // mid-turn takes it and folds it in or starts a sub-agent for it, unless it already runs
  // MAX_BUSY_SUBS sub-agents; another CLI (no sub-agents) keeps working. In both of those cases a
  // new Claude Code lead takes the task. route() decides; the composer's hint line shows its answer
  // before sending, and dispatch() follows it. Custom agents and agents the user started with New
  // agent (ownedByUser) are never picked automatically: they get composer tasks only when the user
  // selected them (card click, Send composer tasks here). New agent (the composer toggle next to
  // Send, or Ctrl+Enter): the task goes to a brand-new Claude Code in a new pane of the active
  // terminal workspace, started user-owned (it has Technically Not's delegation tools and starts
  // sub-agents only when it judges they help).
  const MAX_BUSY_SUBS = 3;

  // Context budget: an agent whose CURRENT context (the latest turn's input + cache tokens, pushed
  // by desktop/agent-turns.js as turn.context.tokens: Claude Code = last main-transcript assistant
  // message's input + cache_read + cache_creation; Codex = last_token_usage.input_tokens) is at or
  // over the budget gets no more Auto-routed composer tasks: Technically Not starts a fresh agent
  // of the same CLI and account (model/effort: the remembered new-agent picks, 46) in a new pane
  // and hands the task over with a short note. Unknown size = no action (never guessed). A
  // user-picked agent, an @mention, a Build lead or a task that quotes that agent's result still
  // goes to it, with a warning in the hint. A full workspace keeps it too. Remembered per viewer;
  // TnaiLiveTasks.contextBudget(n) reads/sets it. `tnai send` between agents goes through the CLI
  // mesh, not here. The limit is relative to that agent's own model window when Technically Not
  // knows it (54 TnaiContextUpkeep.limits().window: Codex's reported model_context_window; Claude
  // Code 1M once over 200k, or 200k on a known non-Max plan): near full = CONTEXT_NEAR_FULL (80%)
  // of it. Unknown window (other CLIs report no size at all, so they are skipped) → the fixed
  // budget. A budget the user set is used as is. Sub-agents: a Claude Code sub-agent's own turns
  // live in its own transcript and never enter the lead's context; what it hands back (the Agent
  // tool result) does, and the lead's next request counts it, so the lead's size already includes
  // its sub-agents' share.
  const CONTEXT_BUDGET_DEFAULT = 300000,
    CONTEXT_BUDGET_KEY = 'tnai.context-budget.v1',
    CONTEXT_NEAR_FULL = 0.8;
  let contextBudget = CONTEXT_BUDGET_DEFAULT,
    budgetSet = false;
  try {
    const v = Math.round(+localStorage.getItem(CONTEXT_BUDGET_KEY));
    if (v >= 10000) {
      contextBudget = v;
      budgetSet = true;
    }
  } catch {}
  const COLD_IDLE_MS = 3600000,
    COLD_TOKENS = 150000,
    coldAsked = new Set(); // cold agent offer (send, below): paneId:endedAt already asked

  // the cache lifetime in words ("an hour", "5 minutes")
  const coldSpan = ms => (ms >= 3600000 ? 'an hour' : Math.round(ms / 60000) + ' minutes');
  const ctxTokens = s => {
    const n = window.TnaiTurns?.get?.(s.paneId)?.context?.tokens;
    return s.agent !== 'Terminal' && n > 0 ? n : 0;
  };
  const kTok = n => window.TnaiTurns?.format?.tokens?.(n) || Math.round(n / 1000) + 'k';
  const ctxWindow = s =>
    window.TnaiTurns?.get?.(s.paneId)?.context?.window ||
    window.TnaiContextUpkeep?.limits?.(s.paneId)?.window ||
    0;
  const overBudget = s => {
    const n = ctxTokens(s);
    if (!n) return null;
    const win = ctxWindow(s),
      budget = !budgetSet && win > 0 ? Math.round(win * CONTEXT_NEAR_FULL) : contextBudget;
    if (n < budget) return null;
    const pct = win > 0 ? Math.min(100, Math.round((n / win) * 100)) : 0;
    return {
      tokens: n,
      budget,
      window: win,
      pct,
      why:
        s.name +
        ' is near its context limit (' +
        (pct ? pct + '% of ' + kTok(win) : kTok(n) + ' tokens, limit ' + kTok(budget)) +
        ')',
    };
  };

  // Short handoff for the fresh agent: who had it, its task, its latest Project Context summary
  // (desktop/agent-context.js), where to read more.
  async function budgetHandoff(r) {
    let e = null;
    try {
      e =
        ((await window.TnaiContextState?.())?.entries || [])
          .filter(x => x.paneId === r.from.paneId && !x.chatter)
          .sort((a, b) => b.at - a.at)[0] || null;
    } catch {}
    const s = e?.summary || {},
      clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
    const sum = ['did', 'remains', 'next', 'blockers']
      .filter(k => s[k]?.length)
      .map(
        k =>
          k[0].toUpperCase() +
          k.slice(1) +
          ': ' +
          s[k]
            .slice(0, 2)
            .map(x => clip(String(x), 160))
            .join(' / ')
      )
      .join(' · ');
    return (
      '[TN.ai handoff: ' +
      r.from.name +
      ' (' +
      r.from.agent +
      ') has ' +
      kTok(r.full.tokens) +
      ' tokens of context (' +
      (r.full.cold
        ? 'idle over ' + coldSpan(r.full.coldAfter || COLD_IDLE_MS)
        : r.full.pct
          ? r.full.pct + '% of its ' + kTok(r.full.window) + ' window'
          : 'limit ' + kTok(r.full.budget)) +
      '), so you take this task fresh in a new terminal. ' +
      (r.busyTask ? 'Its task: "' + clip(r.busyTask, 160) + '". ' : '') +
      (sum ? 'Its latest result: ' + sum + '. ' : '') +
      'If this builds on its work, check `tnai read ' +
      r.from.name +
      '` or `tnai context` first.] '
    );
  }
  const autoPick = s => !s.customAgentId && !s.ownedByUser;

  // Which agent Technically Not starts when it must start one: every signed-in CLI, one entry per
  // signed-in account (15). With exactly one, Technically Not starts it; with several, the one
  // picked in the composer's agent dropdown (46, remembered; key "CLI|accountId"), else the first.
  const START_KEY = 'tnai.start-agent.v1',
    // every CLI that can lead (desktop/agent-graph.js LEADS: any agent
    // for any role)
    START_AGENTS = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

  // Auto / a new lead starts Claude Code, or Codex only when its ChatGPT
  // plan is a clearly higher tier than the Claude plan (both read from the CLIs' own sign-ins,
  // 15/account-service.js; unknown plan = no switch, tie = Claude Code). Never Cursor Agent.
  // startPick only chooses which Claude Code account; picking Codex or Cursor Agent in the Agent
  // menu starts that one agent. Another CLI joins when named (73).
  let startPick = '';
  try {
    startPick = localStorage.getItem(START_KEY) || '';
  } catch {}

  function startOptions() {
    const info = agents.info(),
      out = [];
    for (const id of START_AGENTS) {
      const a = info.find(x => x.id === id);
      if (!a?.installed) continue;
      const cli = window.TnaiAccounts?.list?.().find(d => d.agentId === id);
      const accts = cli?.supported
        ? cli.accounts.filter(
            x => (x.status?.loggedIn ?? (x.isDefault ? a.loggedIn : false)) === true
          )
        : a.loggedIn === false
          ? []
          : [{ id: '' }];
      accts.forEach(x =>
        out.push({
          key: id + '|' + x.id,
          agent: id,
          accountId: x.id,
          label: id + (accts.length > 1 ? ' · ' + window.TnaiAccounts.label(id, x.id) : ''),
        })
      );
    }
    return out;
  }

  // Plan tiers per CLI (free 0 < entry paid 1 < top 2); names from the CLI's own credential file,
  // lowercase; -1 = unknown.
  const TIERS = {
    'Claude Code': { free: 0, pro: 1, team: 1, enterprise: 1, max: 2 },
    Codex: { free: 0, plus: 1, team: 1, business: 1, enterprise: 1, edu: 1, pro: 2 },
  };

  function tierOf(o) {
    const cli = window.TnaiAccounts?.list?.().find(d => d.agentId === o.agent);
    const acct =
      cli?.accounts?.find(x => x.id === o.accountId) ||
      (!o.accountId ? cli?.accounts?.find(x => x.isDefault) : null);
    const plan = String(acct?.status?.plan || '').toLowerCase(),
      t = TIERS[o.agent] || {};
    const k = Object.keys(t).find(
      n => plan === n || plan.startsWith(n + ' ') || plan.startsWith(n + '_')
    );
    return k === undefined ? -1 : t[k];
  }

  // null: nothing signed in (Technically Not tries Claude Code and says why it can't).
  function autoStartChoice(opts) {
    const claude =
      (startPick && opts.find(o => o.key === startPick && o.agent === 'Claude Code')) ||
      opts.find(o => o.agent === 'Claude Code') ||
      null;
    const codex = opts.filter(o => o.agent === 'Codex').sort((x, y) => tierOf(y) - tierOf(x))[0];
    if (claude && codex) {
      const a = tierOf(claude),
        b = tierOf(codex);
      if (a >= 0 && b > a) return codex;
    }
    return claude;
  }

  function startChoice() {
    return autoStartChoice(startOptions());
  }

  function setStartPick(key) {
    startPick = key || '';
    try {
      localStorage.setItem(START_KEY, startPick);
    } catch {}
    paintRoute();
  }

  // A new lead Technically Not starts on its own (nothing running, or the running one is busy): the
  // picked agent/account.
  function newLead(r, busyLabel) {
    const pick = startChoice();
    return {
      ...r,
      start: pick,
      label: '→ new ' + (pick?.label || 'Claude Code') + ' lead' + (busyLabel || ''),
    };
  }

  function route(forceNew) {
    // @mentions (50) come first: a prompt naming running agents goes to exactly those ({ kind:
    // 'mention', targets }) or is blocked.
    const mention = window.TnaiMentions?.route?.(promptInput?.value || '');
    if (mention) {
      // named agents always get it; one over the context budget is flagged in the hint and the
      // toast
      const over =
        mention.kind === 'mention'
          ? (mention.targets || [])
              .map(overBudget)
              .filter(Boolean)
              .map(o => o.why)
              .join(' · ')
          : '';
      return over
        ? { ...mention, over, label: (mention.label ? mention.label + ' · ' : '') + over }
        : mention;
    }

    // A model or CLI the prompt asks for (73: "use Opus 5.5 to …", "have Codex …") gets it: an idle
    // agent already on it, else a new one started on it.
    const named = window.TnaiModelRoute?.route?.(promptInput?.value || '', {
      forceNew: forceNew || !!newAgent,
    });
    if (named) return named;
    if (forceNew || newAgent)
      return window.TnaiTeam
        ? {
            kind: 'new',
            explicit: true,
            agent: newAgent || 'Claude Code',
            accountId: newAgent ? newAccount : undefined,
            label:
              '→ new agent · ' +
              (newAgent || 'Claude Code') +
              (newAgent && newAccount && window.TnaiAccounts
                ? ' · ' + window.TnaiAccounts.label(newAgent, newAccount)
                : '') +
              ' in a new panel',
          }
        : { kind: 'blocked', why: 'New agent needs the Technically Not desktop app.', label: '' };

    // The prompt quotes an agent's earlier result (47): the task goes back to that agent: reused
    // when its pane is open, revived when it was closed.
    const origin = window.TnaiLifecycle?.origin?.() || null;
    if (origin && (origin.state === 'hidden' || origin.state === 'stopped') && window.TnaiTeam)
      return {
        kind: 'revive',
        origin,
        label: '→ ' + origin.name + ' · revived: this came from its result',
      };

    // Auto only hands tasks to running agents of the user's default CLI; agents of other CLIs get
    // them only when the user picks one (target) or names it. A stopped agent the user picked
    // (composer Agent dropdown, tree row): it starts again and gets the task (10 wake).
    const asleep =
      target && agents.wake
        ? agents.sessions().find(s => s.paneId === target && !s.running && s.mode !== 'login')
        : null;
    if (asleep)
      return {
        kind: 'wake',
        chosen: asleep,
        label: '→ ' + asleep.name + ' · starts and gets this',
      };
    const defaultCli = startChoice()?.agent || 'Claude Code';
    const running = agents.sessions().filter(s => s.running && s.mode !== 'login'),
      pool = running.filter(s => autoPick(s) && s.agent === defaultCli),
      claude = pool.filter(s => s.agent === 'Claude Code');
    const chosen =
      running.find(s => origin && s.paneId === origin.paneId) ||
      running.find(s => s.paneId === target) ||
      (claude.length === 1 ? claude[0] : pool.length === 1 ? pool[0] : null);
    const own = origin && chosen?.paneId === origin.paneId ? ' · this came from its result' : '';
    if (!chosen) {
      if (!window.TnaiTeam)
        return {
          kind: 'blocked',
          why: 'No agent is running. Start one with New thread.',
          label: '',
        };
      if (!pool.length) return newLead({ kind: 'new' });
      return {
        kind: 'blocked',
        why: 'Several agents are running. Click the one that should lead this task, then send again.',
        label: '→ click an agent card to choose',
      };
    }
    const lead = chosen.agent === 'Claude Code' && !!window.TnaiTeam;

    // An agent the user chose (Agent dropdown under the prompt, card click) keeps the task even
    // when busy; only Auto hands it to a new lead.
    const picked = !!target && chosen.paneId === target;

    // Quoted in the busy note, so only the task's own words on one line: no paste wrappers,
    // attachment refs or an earlier busy note (44 cleanTask).
    const busyTask = (t => (window.TnaiResults?.cleanTask?.(t) ?? t).replace(/\s+/g, ' ').trim())(
      window.TnaiTeam?.get?.(chosen.paneId)?.task?.text ||
        cliTitle(chosen) ||
        tasks[chosen.paneId]?.text ||
        ''
    );

    // Context budget (above): Auto starts a fresh agent of the same CLI/account; everything the
    // user or provenance chose keeps it, with the warning.
    const full = overBudget(chosen);
    if (full && !picked && !own && window.TnaiTeam) {
      if (!window.TnaiPaneLimit?.full?.())
        return {
          kind: 'handoff',
          from: chosen,
          busyTask,
          full,
          start: {
            agent: chosen.agent,
            accountId: chosen.accountId ?? undefined,
            label: chosen.agent,
          },
          label: '→ new ' + chosen.agent + ' · ' + full.why,
        };
      full.why += ' · this workspace is full, so it keeps this';
    }
    const warn = r => (full ? { ...r, over: full.why, label: r.label + ' · ' + full.why } : r);
    if (lead && window.TnaiTeam.busy?.(chosen.paneId)) {
      const subs = (window.TnaiTeam.get?.(chosen.paneId)?.subs || []).filter(
        s => s.status === 'running' || s.status === 'starting'
      ).length;
      if (subs >= MAX_BUSY_SUBS && !picked)
        return newLead(
          { kind: 'handoff', from: chosen, busyTask },
          ' · ' + chosen.name + ' is busy with ' + subs + ' sub-agents'
        );
      return warn({
        kind: 'fold',
        chosen,
        busyTask,
        picked,
        origin: own && origin,
        label: '→ ' + chosen.name + (own || ' · busy: it folds this in or starts a sub-agent'),
      });
    }
    if (
      !lead &&
      !picked &&
      chosen.agent !== 'Terminal' &&
      chosen.status === 'working' &&
      window.TnaiTeam
    )
      // a plain shell just runs what it is sent
      return newLead({ kind: 'handoff', from: chosen, busyTask }, ' · ' + chosen.name + ' is busy');
    return warn({
      kind: 'direct',
      chosen,
      lead,
      picked,
      origin: own && origin,
      label:
        '→ ' +
        chosen.name +
        (lead
          ? ''
          : ' · ' +
            chosen.agent +
            (picked && chosen.status === 'working' ? ' · busy: it takes this next' : '')) +
        own,
    });
  }

  // Offline agents (left over from the last Technically Not session, or stopped) and idle ones
  // Technically Not picked: the lead that gets a composer task decides whether the task reuses one
  // (`tnai send` resumes its conversation) or closes it (`tnai close`; its results stay in `tnai
  // context`). Told once per agent and state, so later prompts don't repeat it. Never lists agents
  // the user started or set up, or delegated sub-agents (their lead manages them).
  const offered = new Map(); // paneId -> state already told to a lead

  function leftoverNote(leadPane) {
    // Only agents of the lead's own CLI are offered for reuse: a lead never pulls in another CLI
    // the user didn't ask for.
    const leadCli = agents.sessions().find(s => s.paneId === leadPane)?.agent;
    const rows = agents
      .sessions()
      .filter(
        s =>
          s.paneId !== leadPane &&
          s.agent !== 'Terminal' &&
          (!leadCli || s.agent === leadCli) &&
          s.mode !== 'login' &&
          autoPick(s) &&
          (!s.running || s.status === 'waiting') &&
          !window.TnaiGraph?.node?.(s.paneId)?.parentId
      )
      .map(s => ({
        s,
        state: s.running
          ? 'idle'
          : s.saved
            ? 'left over from the last Technically Not session'
            : 'stopped',
      }))
      .filter(({ s, state }) => offered.get(s.paneId) !== state);
    if (!rows.length) return '';
    rows.forEach(({ s, state }) => offered.set(s.paneId, state));
    const list = rows
      .map(
        ({ s, state }) =>
          s.name +
          ' (' +
          s.agent +
          ', ' +
          state +
          (tasks[s.paneId]?.text || s.title
            ? ', last task: "' + String(tasks[s.paneId]?.text || s.title).slice(0, 100) + '"'
            : '') +
          ')'
      )
      .join('; ');
    return (
      '\n\n[Technically Not: agents not working right now in this project: ' +
      list +
      ". You lead: first decide which of them this task needs. Reuse one whose earlier work it builds on with `tnai send NAME message` (an offline one resumes its conversation; ask it to /compact first if its context is long). Close the ones this task and the running work don't need with `tnai close NAME`: their finished results stay in `tnai context`. When unsure, leave it.]"
    );
  }

  let sending = false,
    newAgent = '',
    // '' or the CLI the next send starts as a new agent (Claude Code, or another from the To menu,
    // 46); newAccount: its account (undefined = the CLI's active one)
    newAccount;

  // kept: the composer may live in its pop-out window (38)
  const promptInput = document.getElementById('prompt');

  // The prompt leaves the composer as soon as its route is decided (deliver clears it before any
  // await); a send that fails puts it back, unless the user already started a new draft.
  async function dispatch(forceNew) {
    const input = promptInput;
    if (!input || sending) return;
    const draft = input.value;
    let delivered = false;
    try {
      delivered = await deliver(forceNew, input);
    } finally {
      if (!delivered && !input.value && draft) {
        input.value = draft;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }

  // A second prompt box (a thread in its own window, 162) sends the way this one does, to its own
  // thread only: the composer's target is that thread for this one send and is put back after.
  // The main box's attachments stay with the main box.
  async function sendFrom(input, paneId) {
    if (!input || !paneId || sending) return false;
    const before = target;
    const draft = input.value;
    let delivered = false;
    setTarget(paneId);
    try {
      delivered = await deliver(false, input, { noFiles: true });
    } finally {
      if (target === paneId && before !== paneId) setTarget(before);
      if (!delivered && !input.value && draft) input.value = draft;
    }
    return !!delivered;
  }

  async function deliver(forceNew, input, { noFiles = false } = {}) {
    // Attachments (27) may be sent without text; they are saved first and referenced on the same
    // line. A second prompt box (sendFrom) sends without the main box's attachments.
    const files = noFiles ? null : window.TnaiAttachments,
      text = input.value.trim();
    if (!text && !files?.count()) return;

    // "Same prompt" on All threads (135): the main box's prompt goes to every picked thread there,
    // and only there. Ctrl+Enter and a second prompt box send as before.
    if (!forceNew && !noFiles && input === promptInput && window.TnaiAllThreads?.sameRoute?.())
      return window.TnaiAllThreads.sendSame(input);

    // Where the prompt came from (47), checked again now in case Enter came before the typing check
    // finished.
    const full = window.TnaiPastedText?.expand(text) ?? text;

    // An agent on another computer is the chosen target (116):
    // the prompt leaves as a remote prompt or not at all, and the draft stays unless it left.
    // Attachments are not sent there, and it says so before anything is sent. An @mention, New
    // agent and Ctrl+Enter go their own ways as before. "New agent" was set to a CLI on another
    // computer (the Model pill's menu, 46; rules in 116): this prompt starts that agent there with
    // the existing start operation, or nothing leaves and the draft stays. Never unseen, as for a
    // prompt to another computer: when the line that says so is not drawn, this Enter only says it.
    // After a start the choice is back to this computer's own.
    const startFar = !forceNew && newFar && !window.TnaiMentions?.route?.(text) ? newFar : null;
    if (startFar) {
      if (files?.count()) {
        say(
          'Not started: attachments are not sent to another computer. Remove them, or start the agent on this computer.'
        );
        return;
      }
      if (sending) return;
      paintRoute();
      fitRoute();
      if (!hintSeen(startLabel(startFar))) {
        const k = 'start\n' + startFar.key + '\n' + full;
        if (farAsked !== k) {
          farAsked = k;
          say(
            'This starts a new ' +
              startFar.name +
              ' agent on ' +
              startFar.computer +
              ' with this prompt. Press Enter again to start it there.'
          );
          return;
        }
      }
      let res = null;
      sending = true;
      try {
        res = await window.TnaiRemoteAgents.start(startFar.key, full);
      } catch {
        res = null;
      } finally {
        sending = false;
      }
      if (!res || res.ok !== true) {
        say((res && res.words) || 'Not started · your prompt is still in the box');
        return;
      }
      farAsked = '';
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setNewFar(null);
      say(res.words);

      // it left: the box stays empty, and the next prompt starts no second agent by habit
      return true;
    }
    const far =
      !forceNew && !newAgent && !newFar && !window.TnaiMentions?.route?.(text)
        ? window.TnaiRemoteAgents?.target?.()
        : null;
    if (far) {
      if (sending) return;

      // Attachments for an agent on another computer: pictures
      // are made small here, in the page, and plain text files are read; anything else is refused
      // with the reason and the draft stays. The first Enter only says what would be sent and how
      // big; the next one, with the same draft and the same files, sends.
      let withFiles = null;
      if (files?.count()) {
        if (typeof files.forRemote !== 'function') {
          say(
            'Not sent: attachments are not sent to another computer. Remove them, or choose an agent on this computer.'
          );
          return;
        }
        sending = true;
        try {
          withFiles = await files.forRemote();
        } catch {
          withFiles = null;
        } finally {
          sending = false;
        }
        if (!withFiles || withFiles.ok !== true) {
          say(
            (withFiles && withFiles.words) ||
              'Not sent: the attachments could not be prepared for another computer. Your prompt is still in the box.'
          );
          return;
        }
        const k = 'files\n' + far.key + '\n' + full + '\n' + withFiles.sig;
        if (farAsked !== k) {
          farAsked = k;
          say(
            'Enter again sends ' +
              withFiles.words +
              ' to ' +
              far.agent +
              ' on ' +
              far.computer +
              '.'
          );
          return;
        } // short: the toast shows one line (what, how big as sent, about how long, to whom)
      }

      // Never sent unseen: when the hint that names the
      // other computer is not drawn right now (a narrow composer, no room in its row), this Enter
      // only says where the prompt would go; the next one, with the same draft, sends.
      paintRoute();
      fitRoute();
      if (!withFiles && !farSeen(far)) {
        const k = far.key + '\n' + full;
        if (farAsked !== k) {
          farAsked = k;
          say(
            'This goes to ' +
              far.agent +
              ' on ' +
              far.computer +
              '. Press Enter again to send it there.'
          );
          return;
        }
      }
      let res = null;
      sending = true;
      try {
        res = await window.TnaiRemoteAgents.send(full, withFiles ? withFiles.files : null);
      } catch {
        res = null;
      } finally {
        sending = false;
      }
      if (!res || res.ok !== true) {
        say((res && res.words) || 'Not sent · your prompt is still in the box');
        return;
      }
      if (withFiles) files.clear?.(); // they left with the prompt
      farAsked = '';
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      say(res.words);

      // delivered: dispatch does not put the draft back (the
      // next Enter sent it again)
      return true;
    }
    if (
      !forceNew &&
      !newAgent &&
      !window.TnaiMentions?.route?.(text) &&
      window.TnaiLifecycle?.pending(full)
    ) {
      sending = true;
      try {
        await window.TnaiLifecycle.check(full);
      } finally {
        sending = false;
      }
    }
    const r = route(!!forceNew);
    if (r.kind === 'blocked') {
      say(r.why);
      if (r.deploy) {
        sending = true;
        try {
          for (const id of r.deploy) await window.TnaiCustomAgents?.start?.(id);
        } finally {
          sending = false;
        }
      }
      return;
    } // deploy: stopped @mentioned custom agents (50)

    // A /compact typed for an idle agent (54): it writes down what must survive first, the command
    // runs after that reply, and it gets the summary back once the compact is done. Not taken (a
    // working agent, Summarize first off): the prompt goes as typed.
    if (
      r.kind === 'direct' &&
      /^\/compact(\s|$)/i.test(full) &&
      !files?.count() &&
      window.TnaiContextUpkeep?.compactNow?.(r.chosen.paneId, full)
    ) {
      window.TnaiPromptRecall?.sent(text, full);
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // A dialog below can stay open for any time. When the agents changed meanwhile (the busy one
    // finished, the idle one started working), the answer was given for a route that is gone:
    // nothing is sent, the draft stays and Enter asks again on the new route (audit app-4 #4).
    const routeKey = x => x.kind + '|' + (x.chosen?.paneId || '');
    const routeChanged = before => {
      if (routeKey(route(!!forceNew)) === before) return false;
      say('The agents changed while you chose · press Enter again to send');
      return true;
    };

    // A busy lead + a prompt with nothing in common with its task (77): the user picks sub-agent /
    // new agent / send anyway; Cancel keeps the draft.
    if (r.kind === 'fold' && window.TnaiOffTopic?.unrelated(r.busyTask, full)) {
      const asked = routeKey(r);
      const canNew = !!window.TnaiTeam && !window.TnaiPaneLimit?.full?.();
      let pick = null;
      sending = true;
      try {
        pick = await window.TnaiOffTopic.ask({ name: r.chosen.name, task: r.busyTask, canNew });
      } finally {
        sending = false;
      }
      if (!pick) {
        say('Not sent · your prompt is still in the box');
        return;
      }
      if (routeChanged(asked)) return;
      if (pick === 'new')
        Object.assign(
          r,
          newLead(
            { kind: 'handoff', from: r.chosen, busyTask: r.busyTask },
            ' · ' + r.chosen.name + ' is busy'
          )
        );
      else if (pick === 'sub') r.sub = true;
    }

    // A cold agent: idle longer than its prompt cache lives, with at least COLD_TOKENS of context.
    // The lifetime is the one Claude Code's transcript reported (context.cacheTtlMs from
    // desktop/agent-turns.js: an hour on a subscription, 5 minutes on an API key or on usage
    // credits); unknown (Codex, no cache write seen yet) = COLD_IDLE_MS. Its prompt cache has
    // expired, so this prompt would re-read it all at full price: the user may compact it first
    // (the prompt waits in the CLI's queue behind /compact) or hand the task to a fresh agent.
    // Asked once per idle spell; Send anyway sends as before, Cancel keeps the draft. Claude Code
    // and Codex only (the CLIs with /compact); a Build lead is never asked.
    const coldTurn =
      r.kind === 'direct' &&
      ['Claude Code', 'Codex', 'OpenCode'].includes(r.chosen?.agent) &&
      r.chosen.status !== 'working'
        ? window.TnaiTurns?.get?.(r.chosen.paneId)
        : null;
    const coldKey = coldTurn?.endedAt && r.chosen.paneId + ':' + coldTurn.endedAt,
      coldAfter = coldTurn?.context?.cacheTtlMs > 0 ? coldTurn.context.cacheTtlMs : COLD_IDLE_MS;
    if (
      coldKey &&
      !coldAsked.has(coldKey) &&
      Date.now() - coldTurn.endedAt >= coldAfter &&
      ctxTokens(r.chosen) >= COLD_TOKENS &&
      window.TnaiOffTopic?.askCold
    ) {
      coldAsked.add(coldKey);
      const asked = routeKey(r);
      const tokens = ctxTokens(r.chosen),
        win = ctxWindow(r.chosen),
        canNew = !!window.TnaiTeam && !r.origin && !window.TnaiPaneLimit?.full?.();
      let pick = null;
      sending = true;
      try {
        pick = await window.TnaiOffTopic.askCold({
          name: r.chosen.name,
          tokens: kTok(tokens),
          idleMin: Math.round((Date.now() - coldTurn.endedAt) / 60000),
          after: coldSpan(coldAfter),
          canNew,
        });
      } finally {
        sending = false;
      }
      if (!pick) {
        coldAsked.delete(coldKey);
        say('Not sent · your prompt is still in the box');
        return;
      }
      if (routeChanged(asked)) return;
      if (pick === 'compact') {
        try {
          await window.tnaiNative.pty.submit(r.chosen.paneId, '/compact', { paste: false });
          say('Compacting ' + r.chosen.name + ' first · your prompt goes in right after');
        } catch {
          say('Could not compact ' + r.chosen.name + ' · sending as is');
        }
      } else if (pick === 'new') {
        const pct = win > 0 ? Math.min(100, Math.round((tokens / win) * 100)) : 0;
        Object.assign(r, {
          kind: 'handoff',
          from: r.chosen,
          busyTask: r.busyTask || '',
          start: {
            agent: r.chosen.agent,
            accountId: r.chosen.accountId ?? undefined,
            label: r.chosen.agent,
          },
          full: {
            cold: true,
            coldAfter,
            tokens,
            budget: COLD_TOKENS,
            window: win,
            pct,
            why: r.chosen.name + ' was idle with ' + kTok(tokens) + ' tokens of context',
          },
        });
      }
    }

    // 114: Arrow Up in an empty box brings this prompt back
    window.TnaiPromptRecall?.sent(text, full);

    // no input event yet: that would drop the stored text of "[Pasted text #N]" tokens (27) before
    // it is expanded below
    input.value = '';

    // 46 shrinks the box back now, not only after the send finishes
    input.dispatchEvent(new Event('tnai:refit'));

    // Attachment chips clear at this same instant, not only after they're saved/sent below; snap
    // keeps the data (restored on any failure further down, alongside the draft text dispatch()
    // restores).
    const snap = files?.count() ? files.beginSend() : null;

    // Sending never changes the page: the user keeps watching whatever they were on.
    // New agents open in the active terminal workspace.
    let chosen = r.chosen,
      lead = r.kind === 'direct' ? r.lead : true,
      busyNote = '';
    if (r.kind === 'new' || r.kind === 'handoff') {
      const who = r.start?.label || 'Claude Code';
      sending = true;
      say(
        r.explicit
          ? 'Starting a new agent (' + r.agent + ') for this task…'
          : r.full
            ? r.full.why + ' · starting a new ' + who + ' for this task…'
            : r.from
              ? r.from.name + ' is busy · starting ' + who + ' for this task…'
              : 'Starting ' + who + ' to lead this task…'
      );
      if (r.model?.model)
        window.TnaiLaunchPrefs?.once(r.model.agent, {
          model: r.model.model,
          effort: r.model.effort,
        }); // 73: the new pane starts on the model the prompt named

      // A new agent the user asked for (New thread, New agent, Ctrl+Enter) opens as its thread as
      // soon as its panel exists, while the tool is still starting: waiting for it to be ready
      // first kept the user looking at the old thread for 2 to 3 s. On any other page the page
      // stays as it is.
      const openNewThread = paneId => {
        const askedForNew = r.kind === 'new' && (r.explicit || forceNew || !!newAgent);
        if (!askedForNew || !window.TnaiThreads?.visible?.()) return;
        if (window.TnaiThreads.show?.(paneId)) return;

        // The list may not have the new agent's row yet: open it at the list's next paint (an
        // event, no polling), and stop listening after a few seconds.
        const onPainted = () => {
          if (window.TnaiThreads?.show?.(paneId)) stop();
        };
        const stop = () => {
          window.removeEventListener('tnai:threads-painted', onPainted);
          clearTimeout(giveUp);
        };
        const giveUp = setTimeout(stop, 5000);
        window.addEventListener('tnai:threads-painted', onPainted);
      };
      try {
        chosen = await window.TnaiTeam.startLead({
          ...(r.explicit
            ? { here: true, agent: r.agent, accountId: r.accountId }
            : r.start
              ? { agent: r.start.agent, accountId: r.start.accountId }
              : {}),
          onOpened: openNewThread,
        });
      } finally {
        sending = false;
        if (r.model?.model) window.TnaiLaunchPrefs?.once(r.model.agent, null);
      }
      const stillUp = agents.sessions().find(s => s.paneId === r.from?.paneId && s.running);
      if (!chosen?.paneId && r.full && stillUp) {
        // over the budget but no new agent could start: the old one still takes it, and the user is
        // told why
        r.over =
          r.full.why +
          ' · a new ' +
          who +
          ' could not start (' +
          (chosen?.error || 'unknown error') +
          '), so it got this';
        chosen = stillUp;
        lead = stillUp.agent === 'Claude Code' && !!window.TnaiTeam;
        r.kind = 'direct';
        r.full = null;
      } else if (!chosen?.paneId) {
        snap?.restore();
        say(
          (r.from
            ? r.from.name +
              (r.full
                ? r.full.cold
                  ? ' was idle with a big context'
                  : ' is over its context budget'
                : ' is busy') +
              ', and a new lead could not start: '
            : '') + (chosen?.error || 'Claude Code could not start.')
        );
        return;
      } else {
        target = chosen.paneId;
        lead = chosen.agent === 'Claude Code';
      }

      // held, so a prompt sent in this gap waits instead of routing before this one has its target
      if (r.full) {
        sending = true;
        try {
          busyNote = await budgetHandoff(r);
        } finally {
          sending = false;
        }
      } else if (r.from && r.kind === 'handoff')
        busyNote =
          '[' +
          r.from.name +
          ' (' +
          r.from.agent +
          ') is busy in this project' +
          (r.busyTask ? ' with "' + r.busyTask.slice(0, 160) + '"' : '') +
          '. If this task depends on its work, check it with `tnai read ' +
          r.from.name +
          '` first.] ';
    } else if (r.kind === 'revive') {
      // The agent that wrote what the prompt quotes was closed: its conversation comes back in a
      // new pane; if it can't, a fresh agent takes the task.
      sending = true;
      say('Reviving ' + r.origin.name + ' for this task: it builds on its earlier result…');
      try {
        chosen = await window.TnaiLifecycle.revive(r.origin);
      } finally {
        sending = false;
      }
      if (!chosen?.paneId) {
        say(
          'Could not revive ' +
            r.origin.name +
            ' (' +
            (chosen?.error || 'unknown error') +
            ') · starting a fresh agent…'
        );
        const p = startChoice();
        sending = true;
        try {
          chosen = await window.TnaiTeam.startLead(
            p ? { agent: p.agent, accountId: p.accountId } : {}
          );
        } finally {
          sending = false;
        }
        if (!chosen?.paneId) {
          snap?.restore();
          say(chosen?.error || 'Claude Code could not start.');
          return;
        }
        r.origin = null;
      }
      target = chosen.paneId;
      lead = chosen.agent === 'Claude Code';
    } else if (r.kind === 'fold') {
      busyNote = r.sub
        ? '[New task, unrelated to your current work on "' +
          (r.busyTask || 'your current task').slice(0, 160) +
          '"] The user chose to run it as a sub-agent: start one for it (tnai_delegate), keep working on your current task, and report its result when it is done. New task: '
        : '[New task while you work on "' +
          (r.busyTask || 'your current task').slice(0, 160) +
          '"] If it belongs to that work, fold it in. If it is unrelated, handle it the way you judge best without dropping your current work. New task: ';
    }
    let refs = '',
      shots = [];
    if (snap) {
      sending = true;
      try {
        const saved = await files.prepare(snap.items);
        if (saved.error) {
          snap.restore();
          say(saved.error);
          return;
        }
        refs = saved.refs;
        shots = saved.shots || [];
      } finally {
        sending = false;
      }
    }

    // @-picked files/folders (50): " [Mentioned file: src/app.js]"
    const mentionRefs = window.TnaiMentions?.refs?.(text) || '';
    refs += mentionRefs;

    // "@1 … @2 …" (27 TnaiShotRefs): each attachment's own instructions sit under it; otherwise the
    // refs trail the text as before.
    const withRefs = body =>
      window.TnaiShotRefs?.organize(body, shots, mentionRefs) ??
      (body || (refs ? '(no instructions)' : '')) + refs;

    // A long paste in the composer is a "[Pasted text #N +L lines]" token (27); the agent gets the
    // full text back, clearly delimited, while `text` stays the short token form — that's what
    // record() below keeps as the task title, so a later busyNote quoting it never carries the huge
    // paste. Per-attachment notes (68 TnaiShotNotes) come back as "@N <note>" lines here, so
    // organize() files each under its attachment.
    const expandedText = (s => window.TnaiShotNotes?.apply(s, snap?.items) ?? s)(
      window.TnaiPastedText?.expand(text) ?? text
    );

    // Its own earlier result came back to it (reused or revived): it keeps that context and is told
    // so.
    const ownNote = r.origin
      ? '[This task builds on your own earlier result, from "' + r.origin.task + '"] '
      : '';
    const message = ownNote + withRefs(expandedText);
    if (r.kind === 'mention') {
      // @mentions (50): each named agent gets the prompt addressed to it (50 `message`), nothing
      // else is routed
      const sent = [];
      for (const s of r.targets) {
        const body = withRefs(window.TnaiMentions.message(expandedText, s, r.targets));
        if (
          agents.send(
            s.paneId,
            (s.agent === 'Claude Code' && window.TnaiTeam ? '[TN.ai] ' + body : body) +
              (window.TnaiSessionSkills?.note(s.paneId) || ''),
            { userText: text, holdIfBusy: true }
          )
        ) {
          sent.push(s.name);
          record(
            s.paneId,
            window.TnaiMentions.strip(text) || '(attachments only)',
            s.name + ' (' + s.agent + ')'
          );
        }
      }
      if (!sent.length) {
        snap?.restore();
        say(
          r.targets.map(s => s.name).join(', ') +
            (r.targets.length > 1 ? ' are' : ' is') +
            ' not running.'
        );
        return;
      }
      if (refs) snap?.commit();

      // the box was cleared above; no second clear: it would wipe what the user typed or dictated
      // during the send
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const missed = r.targets.filter(s => !sent.includes(s.name)).map(s => s.name);
      say(
        'Sent to ' +
          sent.join(', ') +
          (missed.length ? ' · not running: ' + missed.join(', ') : '') +
          (r.over ? ' · ' + r.over : '')
      );
      paintRoute();
      window.TnaiAgentTeams?.offer?.(
        r.targets.filter(s => sent.includes(s.name)).map(s => s.paneId)
      ); // 88: two or more agents got it: offer a team (asked once)
      return true;
    }

    // A prompt that is one slash command (/model, /usage …) goes to the CLI exactly as typed, also
    // to a thread that has to wake first: with the app's mark around it the CLI read it as plain
    // words and the command never ran (learned 2026-10-28: "/usage" to a sleeping thread).
    const slashOnly = !refs && /^\/[\w:-]+(?:[ \t][^\n]*)?$/.test(String(text || '').trim());

    // A command the app answers with a card in the thread (184: /usage, /cost, /stats) is not sent
    // to the CLI at all: Claude Code opens a menu on its own screen for it that waits for a key,
    // and the thread looked stuck (user 2026-10-28)
    let answeredHere = false;
    try {
      answeredHere = slashOnly && !!window.TnaiCommandCards?.answer?.(chosen.paneId, text);
    } catch {}
    if (answeredHere) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      say('Answered in the thread');
      return true;
    }
    if (r.kind === 'wake') {
      const wakeText = slashOnly
        ? String(text).trim()
        : (chosen.agent === 'Claude Code' && window.TnaiTeam ? '[TN.ai] ' : '') +
          message +
          (window.TnaiSessionSkills?.note(chosen.paneId) || '');
      if (!agents.wake(chosen.paneId, wakeText)) {
        snap?.restore();
        say(chosen.name + ' could not start.');
        return;
      }
      record(chosen.paneId, text || '(attachments only)', chosen.name + ' (' + chosen.agent + ')');
      if (refs) snap?.commit();
      input.dispatchEvent(new Event('input', { bubbles: true }));
      say('Starting ' + chosen.name + ' · it gets this once it is ready');
      paintRoute();
      return true;
    }

    // A CLI without a prompt hook (Codex, OpenCode, Cursor Agent) gets what the project's past
    // tasks taught at the end of the prompt (desktop/task-learning.js, report-repeats.js); Claude
    // Code gets it from its hook. Never waits more than 400 ms.
    let learnedNote = '';
    if (!slashOnly && chosen.agent !== 'Claude Code' && window.tnaiNative?.learning?.note) {
      learnedNote = await Promise.race([
        Promise.resolve(window.tnaiNative.learning.note(chosen.paneId, text)).catch(() => ''),
        new Promise(done => setTimeout(() => done(''), 400)),
      ]);
    }
    sending = true;
    try {
      await window.TnaiLifecycle?.sent(chosen.paneId, r.origin);
    } finally {
      sending = false;
    }

    // A prompt that is one slash command (/model, /clear …) goes to the CLI exactly as typed
    // (`slashOnly` above): the app's mark or a note around it made it plain words for the agent,
    // and the command never ran (found 2026-10-21 while building the prompt box's / list, 160).
    if (
      !agents.send(
        chosen.paneId,
        slashOnly
          ? String(text).trim()
          : (lead
              ? '[TN.ai] ' + busyNote + message + leftoverNote(chosen.paneId)
              : (r.full ? busyNote : '') + message) +
              (learnedNote || '') +
              (window.TnaiSessionSkills?.note(chosen.paneId) || ''),
        { userText: text, holdIfBusy: true }
      )
    ) {
      snap?.restore();
      say(chosen.name + ' is not running.');
      return;
    }
    if (r.kind !== 'fold')
      // a folded-in task keeps the card on the lead's current task
      record(chosen.paneId, text || '(attachments only)', chosen.name + ' (' + chosen.agent + ')');
    if (r.full && r.from)
      window.TnaiLiveFeed?.note?.(
        r.from.paneId,
        r.full.cold
          ? 'was idle with ' +
              kTok(r.full.tokens) +
              ' tokens of context — sent to a new agent: ' +
              chosen.name
          : 'is near its context limit (' +
              (r.full.pct ? r.full.pct + '%' : kTok(r.full.tokens) + ' tokens') +
              ') — sent to a new agent: ' +
              chosen.name
      );
    if (refs) snap?.commit();

    // one task per click: the next send follows the usual target again (now this agent)
    if (r.explicit) setNewAgent(false);

    // The new agent's thread was opened when its panel appeared (startLead's onOpened above); this
    // is the fallback for a start path that does not call it.
    const askedForNew = r.kind === 'new' && (r.explicit || forceNew || !!newAgent);
    if (
      askedForNew &&
      window.TnaiThreads?.visible?.() &&
      window.TnaiThreads.selected?.() !== chosen.paneId
    )
      window.TnaiThreads.show?.(chosen.paneId);

    // cleared above, before the awaits: text typed or dictated since then stays
    input.dispatchEvent(new Event('input', { bubbles: true }));
    say(
      (r.explicit
        ? 'Sent to ' + chosen.name + ' · a new agent (' + r.agent + ')'
        : r.origin
          ? (r.kind === 'revive' ? 'Revived ' + chosen.name : 'Sent back to ' + chosen.name) +
            ' · the task builds on its earlier result, so it keeps that context'
          : r.kind === 'handoff'
            ? r.full
              ? r.full.why + ' — sent to a new agent: ' + chosen.name + ' (' + chosen.agent + ')'
              : r.from.name +
                ' is busy' +
                ' · started ' +
                chosen.name +
                ' (' +
                chosen.agent +
                ') for this task'
            : r.kind === 'fold'
              ? 'Sent to ' +
                chosen.name +
                ' while it works · ' +
                (r.sub
                  ? 'it starts a sub-agent for this'
                  : 'it will fold this in or start a sub-agent for it')
              : 'Sent to ' + chosen.name + (lead ? '' : ' · ' + chosen.agent)) +
        (r.over && r.kind !== 'handoff' ? ' · ' + r.over : '')
    );
    paintRoute();
    return true;
  }

  // Where the next send goes, shown in the composer's hint row (it moves with the composer into its
  // pop-out, 38).
  const routeHint = document.createElement('span');
  routeHint.className = 'hint tnai-route-hint';
  let fitQueued = 0,
    fitWatch = null; // fitRoute below
  routeHint.title = window.tnaiKeys(
    'Where Enter sends this prompt. Click an agent card on Overview to choose another; New agent (or Ctrl+Enter) starts a new Claude Code for it.'
  );
  const sendHint = [...document.querySelectorAll('.composer .hints .hint')].find(h =>
    /to send/.test(h.textContent)
  );
  if (sendHint) {
    sendHint.before(routeHint);
    setText(sendHint, window.tnaiKeys('↵ send · Ctrl+↵ new agent'));
  }

  // New agent: one toggle next to Send. On, the next send starts a new Claude Code for the task
  // (then it turns off again).
  const newAgentButton = document.createElement('button');
  newAgentButton.type = 'button';
  newAgentButton.className = 'tnai-new-agent';
  newAgentButton.innerHTML = window.TnaiIcon('plus', { size: 14 }) + ' New agent';
  newAgentButton.setAttribute('aria-pressed', 'false');
  newAgentButton.title =
    'Send this task to a brand-new agent (pick its AI tool and model under the prompt); it starts in a new panel of the active terminal workspace and gets the task. Click again to turn it off. It can start its own sub-agents when it needs them. (' +
    window.tnaiKeys('Ctrl+Enter') +
    ' starts the default one.)';
  document.getElementById('send')?.before(newAgentButton);

  // right next to Send, after the pop-out ⧉ (38) is added
  const nextToSend = () => document.getElementById('send')?.before(newAgentButton);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nextToSend);
  else setTimeout(nextToSend, 0);

  // newFar: "New agent" set to a CLI on another paired computer ({ key, pc, cli, name, computer },
  // made by 116 `starts`), or null. One choice at a time: any choice of a new agent on this
  // computer, and turning New agent off, ends it. The same button shows it as on.
  let newFar = null;

  function setNewFar(o) {
    newAgent = '';
    newAccount = undefined;
    newFar = o && typeof o === 'object' && o.key ? o : null;
    const on = !!newFar,
      k = on ? 'c' : 'p';
    newAgentButton.setAttribute('aria-pressed', String(on));
    if (newAgentButton.dataset.ico !== k) {
      newAgentButton.dataset.ico = k;
      newAgentButton.innerHTML =
        (on ? window.TnaiIcon('check', { size: 14 }) : window.TnaiIcon('plus', { size: 14 })) +
        ' New agent';
    }
    newAgentButton.closest('.composebox')?.classList.toggle('tnai-new-on', on);
    paintRoute();
    window.dispatchEvent(new CustomEvent('tnai:new-agent-changed'));
  }

  function setNewAgent(on, accountId) {
    newFar = null;
    newAgent = on ? (typeof on === 'string' ? on : 'Claude Code') : '';
    newAccount = newAgent ? accountId : undefined;
    newAgentButton.setAttribute('aria-pressed', String(!!newAgent));
    {
      const k = newAgent ? 'c' : 'p';
      if (newAgentButton.dataset.ico !== k) {
        newAgentButton.dataset.ico = k;
        newAgentButton.innerHTML =
          (newAgent
            ? window.TnaiIcon('check', { size: 14 })
            : window.TnaiIcon('plus', { size: 14 })) + ' New agent';
      }
    }
    newAgentButton.closest('.composebox')?.classList.toggle('tnai-new-on', !!newAgent);
    paintRoute();
    window.dispatchEvent(new CustomEvent('tnai:new-agent-changed'));
  }
  const newAgentStyle = document.createElement('style');
  newAgentStyle.textContent =
    '.tnai-new-agent{flex:none;box-sizing:border-box;height:30px;padding:0 10px;border:1px solid #e1e5dc;border-radius:7px;background:#fff;color:#6b7164;font:11px Arial;white-space:nowrap;cursor:pointer}.tnai-new-agent:hover{background:#f4f6f0}.tnai-new-agent[aria-pressed=true]{border-color:#5f7f45;background:#5f7f45;color:#fff;font-weight:600}.tnai-new-agent[aria-pressed=true]:hover{background:#557340}.composebox.tnai-new-on{border-color:#82a95f!important;box-shadow:0 0 0 3px #82a95f2e!important}.tnai-new-agent:focus-visible{outline:var(--pg-ring,2px) solid #8da56c;outline-offset:1px}';
  document.head.append(newAgentStyle);

  // An agent on another computer as the target: the computer first and both short, so a hint that
  // is cut never loses the computer's name and always fits its 46 characters. farSeen: that very
  // hint is drawn, whole, at this moment.
  const farCut = (s, n) => {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  };
  const farLabel = far => 'On ' + farCut(far.computer, 18) + ' → ' + farCut(far.agent, 20);
  const hintSeen = label =>
    !!sendHint &&
    !routeHint.hidden &&
    routeHint.textContent === label &&
    routeHint.getClientRects().length > 0 &&
    routeHint.clientWidth + 1 >= routeHint.scrollWidth;
  const farSeen = far => hintSeen(farLabel(far));

  // A new agent on another computer: the same form, the computer first ("On Laptop → new Claude
  // Code agent"), at most 45 characters.
  const startLabel = f =>
    'On ' + farCut(f.computer, 18) + ' → new ' + farCut(f.name, 11) + ' agent';

  // the draft (with its target) that was already answered with "Press Enter again"
  let farAsked = '';

  // With the Agent dropdown (46) the hint says whether the user chose the agent or Auto did.
  function paintRoute() {
    if (!sendHint) return;

    // Files on their way to another computer (116): the line says
    // which one and how far.
    const going = window.TnaiRemoteAgents?.progress?.() || '';
    if (going) {
      setText(routeHint, going);
      routeHint.hidden = false;
      routeHint.classList.remove('tnai-new', 'tnai-far');
      fitRouteIfChanged();
      return;
    }

    // "Same prompt" on All threads (135): the hint names every thread the prompt goes to.
    const same = window.TnaiAllThreads?.sameRoute?.() || '';
    if (same) {
      setText(routeHint, same);
      routeHint.hidden = false;
      routeHint.classList.remove('tnai-new', 'tnai-far', 'tnai-elsewhere');
      fitRouteIfChanged();
      return;
    }

    // A chosen agent on another computer (116): the hint says where the prompt goes before it is
    // sent.
    const mention = !!window.TnaiMentions?.route?.((promptInput?.value || '').trim());

    // "New agent" on another computer (116, 46): the hint says where the agent starts, from the
    // same conditions as the send.
    if (newFar && !mention) {
      setText(routeHint, startLabel(newFar));
      routeHint.hidden = false;
      routeHint.classList.add('tnai-new', 'tnai-far');
      fitRouteIfChanged();
      return;
    }

    // the send's own conditions (deliver)
    const far = !newAgent && !newFar && !mention ? window.TnaiRemoteAgents?.target?.() : null;
    if (far) {
      setText(routeHint, farLabel(far));
      routeHint.hidden = false;
      routeHint.classList.remove('tnai-new');
      routeHint.classList.add('tnai-far');
      fitRouteIfChanged();
      return;
    }
    const r = route(false);
    let label = r.label || '';
    if (window.TnaiLaunchPrefs && !r.explicit && !r.model && r.kind !== 'mention')
      label = (r.picked ? 'Chosen ' : 'Auto ') + label;

    // Aimed at another agent than the open thread (a letter under the prompt box, a press on All
    // threads, a spoken name): the hint says so plainly, so a question meant for the open thread's
    // agent does not go to another one unnoticed.
    const elsewhere = elsewhereName(r);
    if (elsewhere) label = '→ ' + elsewhere + ', not this thread';
    setText(routeHint, label);
    routeHint.hidden = !label;
    routeHint.classList.toggle('tnai-new', !!newAgent);
    routeHint.classList.toggle('tnai-elsewhere', !!elsewhere);
    routeHint.classList.remove('tnai-far');
    fitRouteIfChanged();
  }

  // The name of the agent the next send reaches when that is not the open thread's agent, else ''.
  // Only on the Threads page with one thread open: "All threads" shows several, and its chosen card
  // is the target.
  function elsewhereName(r) {
    const threads = window.TnaiThreads;
    if (!r.chosen || !threads?.visible?.() || window.TnaiAllThreads?.on) return '';
    const open = threads.selected?.() || '';
    if (!open || r.chosen.paneId === open) return '';
    if (!agents.sessions().some(session => session.paneId === open)) return '';
    return r.chosen.name || 'another agent';
  }

  // The hint leaves whole when the row has no room for all of it, and comes back when it has (the
  // fit rule, 109: nothing half-shown; it was cut to "Chosen → Sol · Ter…" in a 768 px window). A
  // text longer than its own 46ch cap keeps its "…" as before, and on Overview it takes the free
  // room and ends in "…" by design (08). Measured when its text, the row or the pickers change
  // size; no timer. Next in rank, when the pickers are still squeezed with the hint out ("Access"
  // sat 4 px over "Ctrl+K commands", "Default model" lost 2 px): the two low key hints leave whole,
  // the same two as at the 640 px step (07, `tnai-fit-keys`).
  function fitRoute() {
    fitQueued = 0;
    const row = routeHint.parentElement,
      pickers = row?.querySelector(':scope>.tnai-pickers');

    // 46 adds them later; observing twice is the same as once
    if (pickers && fitWatch) fitWatch.observe(pickers);
    routeHint.classList.remove('tnai-fit-out');
    row?.classList.remove('tnai-fit-keys', 'tnai-fit-all', 'tnai-fit-far');
    if (
      !row ||
      routeHint.ownerDocument !== document ||
      row.closest('#pgOverview') ||
      !row.getClientRects().length
    )
      return;
    if (!routeHint.hidden && routeHint.getClientRects().length) {
      const cap = parseFloat(getComputedStyle(routeHint).maxWidth) || Infinity;
      const cut = () => routeHint.clientWidth + 1 < Math.min(routeHint.scrollWidth, cap);

      // A line that names another computer is the last to leave: the key hints give their room
      // first (07, `tnai-fit-far`). Under a thread the row is as wide as the conversation, the
      // line was taken out, and a start on another computer then needed two Sends.
      // A line that says the prompt goes to another agent than the open thread is kept the same
      // way.
      const mustStay =
        routeHint.classList.contains('tnai-far') || routeHint.classList.contains('tnai-elsewhere');
      if (cut() && mustStay) {
        row.classList.add('tnai-fit-far');
        if (!cut()) return;
        row.classList.remove('tnai-fit-far');
      }
      if (cut()) routeHint.classList.add('tnai-fit-out');
    }
    if (!pickers) return;

    // Squeezed: the pickers spill out of their group, or grow as soon as the key hints give their
    // room.
    const spills = pickers.scrollWidth > pickers.clientWidth + 1,
      before = pickers.getBoundingClientRect().width;
    row.classList.add('tnai-fit-keys');
    if (!spills && pickers.getBoundingClientRect().width <= before + 0.5) {
      row.classList.remove('tnai-fit-keys');
      return;
    }

    // Last in rank: with those two out the pickers still reach into the key hint that is left (a
    // thread beside a wide side column; "Access" lay over "send"), so that one leaves whole too.
    // A picker's words can stand outside its own box, so the words are measured, not the box.
    // The context chip (168) sits before "↵ send" and is not a key hint: it is the first thing the
    // pickers would reach, so it counts as the edge, and the key hints leave to give it room.
    const keyHint = [...row.querySelectorAll(':scope>.hint, :scope>.tnai-ctx-chip')].find(
      hint => hint.getClientRects().length
    );
    if (!keyHint) return;
    let pickersEnd = 0;
    for (const part of pickers.querySelectorAll('*'))
      pickersEnd = Math.max(pickersEnd, part.getBoundingClientRect().right);
    if (pickersEnd > keyHint.getBoundingClientRect().left + 1) row.classList.add('tnai-fit-all');
  }

  function fitRouteSoon() {
    if (!fitQueued) fitQueued = requestAnimationFrame(fitRoute);
  }

  // The painter asks for a fit only when the hint itself changed (its words, shown or not, its
  // kind). It runs on every team change and every 2 s, and a fit on each of those laid the page
  // out again while agents worked, also with the same words as before (measured 2026-10-13,
  // `perf-background-switch`). A change of the row's size reaches the fit by its ResizeObserver.
  let hintFitKey = '';

  function fitRouteIfChanged() {
    const key =
      routeHint.textContent +
      '\n' +
      routeHint.hidden +
      routeHint.classList.contains('tnai-new') +
      routeHint.classList.contains('tnai-far') +
      routeHint.classList.contains('tnai-elsewhere');
    if (key === hintFitKey) return;
    hintFitKey = key;
    fitRouteSoon();
  }
  if (sendHint && window.ResizeObserver) {
    fitWatch = new ResizeObserver(fitRouteSoon);
    fitWatch.observe(sendHint.parentElement);
  }

  // Send button and Enter (Ctrl+Enter: new agent), in Technically Not's window and in the
  // composer's pop-out window (38 binds its document).
  function bindComposer(doc) {
    doc.addEventListener(
      'click',
      event => {
        {
          const nb = event.target.closest?.('.tnai-new-agent');
          if (nb) {
            if (newFar) {
              setNewAgent(false);
              return;
            }

            /* set to a CLI on another computer: the button turns New agent off, as for any other choice */ const c =
              newAgent ? null : startChoice();
            setNewAgent(newAgent ? false : c?.agent || true, c?.accountId);
            return;
          }
        }

        /* a plain toggle: on as the default CLI; the Model pill under the composer (46) picks another CLI, model and effort */ if (
          event.target.closest?.('#send')
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          dispatch(false);
        }
      },
      true
    );
    doc.addEventListener(
      'keydown',
      event => {
        if (
          event.target.id === 'prompt' &&
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.isComposing
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();
          dispatch(window.tnaiPlatform.mod(event));
        }
      },
      true
    );
  }
  bindComposer(document);
  window.TnaiLiveTasks.bindComposer = bindComposer;
  window.TnaiLiveTasks.route = forceNew => {
    const r = route(!!forceNew);
    return {
      kind: r.kind,
      explicit: !!r.explicit,
      label: r.label,
      paneId: r.chosen?.paneId || '',
      from: r.from?.paneId || '',
      start: r.start?.agent || '',
      full: r.full
        ? { tokens: r.full.tokens, budget: r.full.budget, window: r.full.window, pct: r.full.pct }
        : null,
      over: r.over || '',
    };
  };
  window.TnaiLiveTasks.contextBudget = n => {
    if (n !== undefined) {
      contextBudget = Math.max(10000, Math.round(+n) || CONTEXT_BUDGET_DEFAULT);
      budgetSet = true;
      try {
        localStorage.setItem(CONTEXT_BUDGET_KEY, String(contextBudget));
      } catch {}
      paintRoute();
    }
    return contextBudget;
  };
  window.TnaiLiveTasks.paintRoute = paintRoute; // 50 repaints the hint as @mentions are typed
  window.TnaiLiveTasks.newAgent = (on, accountId) => {
    if (on !== undefined) setNewAgent(on, accountId);
    return newAgent;
  };
  window.TnaiLiveTasks.newFar = o => {
    if (o !== undefined) setNewFar(o);
    return newFar;
  }; // 116 sets and ends it; 46 reads it for its menu
  Object.assign(window.TnaiLiveTasks, {
    newAccount: () => newAccount,
    startOptions,
    startChoice,
    startPick: key => {
      if (key !== undefined) setStartPick(key);
      return startPick;
    },
  });

  window.addEventListener('tnai:terminal-pane-closed', event => {
    delete tasks[event.detail?.paneId];
    offered.delete(event.detail?.paneId);
    saveTasks();
  });

  // Background pushes (status flips, finished turns, file / skill / team activity) render at most
  // once per BG_MS, trailing, so the last state always renders; the .layout class observer, resizes
  // and user actions keep the immediate schedule, so a clicked page paints first.
  const BG_MS = 120;
  let bgTimer = 0;
  const scheduleBg = () => {
    if (queued || bgTimer) return;
    const wait = BG_MS - (performance.now() - renderedAt);
    if (wait <= 0) schedule();
    else
      bgTimer = setTimeout(() => {
        bgTimer = 0;
        schedule();
      }, wait);
  };
  agents.onChange(scheduleBg);

  // Pushed triggers merge into one repaint per 150 ms: tnai:turn and status changes arrive many
  // times a second from every busy agent, and route() runs both routers plus sessions() (the hint
  // only needs to be current, not per event). User actions still paint at once.
  let routeQueued = 0;
  const paintRouteSoon = () => {
    if (!routeQueued)
      routeQueued = setTimeout(() => {
        routeQueued = 0;
        paintRoute();
      }, 150);
  };
  agents.onChange(paintRouteSoon);
  [
    'tnai:target-changed',
    'tnai:team-changed',
    'tnai:provenance',
    'tnai:accounts-changed',
    'tnai:turn',
    // tnai:turn (42): context size vs the budget

    // another thread opened (120): the "not this thread" warning follows it
    'tnai:thread-view',
  ].forEach(name => window.addEventListener(name, paintRouteSoon));

  // Agents messaging each other (`tnai send`; desktop/agent-mesh.js mesh-in / mesh-out, exact
  // sender and recipient): the card's Now line gets "· ↔ NAME" ("↔ N agents" for several) while
  // messages flow, gone TALK_MS after the last one; its tooltip holds the last message each way.
  // Failed or still-queued sends are left out (53's feed shows failures). No new row or chip: the
  // UI stays uncluttered.
  const TALK_MS = 180000,
    talks = new Map(); // paneId -> Map(peer name -> { at, sent, got })
  const CUT_MS = 8000,
    // paneId -> { by, at, text }: another agent interrupted it (tnai intervene); shown on its row
    // for CUT_MS
    cuts = new Map();
  window.TnaiLiveTasks.interrupted = paneId => {
    const c = cuts.get(paneId);
    if (c && Date.now() - c.at >= CUT_MS) {
      cuts.delete(paneId);
      return null;
    }
    return c ? { ...c } : null;
  };
  const clipTalk = t => {
    t = String(t || '')
      .replace(/\s+/g, ' ')
      .trim();
    return t.length > 90 ? t.slice(0, 89) + '…' : t;
  };

  function onMesh(e) {
    const out = e?.kind === 'mesh-out';
    if (
      !e?.paneId ||
      (!out && e?.kind !== 'mesh-in') ||
      (out && /^(Not delivered|Not started|Queued)\b/.test(e.text || ''))
    )
      return;
    const peer = String((out ? e.to : e.from) || '')
        .split(' · ')
        .pop()
        .trim(),
      at = e.at || Date.now(),
      left = at + TALK_MS - Date.now();
    if (!peer || left <= 0) return;

    // `tnai intervene` (agent-mesh.js): the interrupted agent's row says who stopped it for CUT_MS,
    // then the note is gone (the thread list, 119, reads interrupted()).
    if (!out && e.interrupt === true && at + CUT_MS > Date.now()) {
      cuts.set(e.paneId, {
        by: peer,
        at,
        text: clipTalk(String(e.text || '').replace(/^Interrupted its task:\s*/, '')),
      });
      const repaint = () => window.dispatchEvent(new CustomEvent('tnai:live-activity'));
      repaint();
      setTimeout(repaint, at + CUT_MS - Date.now() + 50);

      // the thread list (119) shows the note on the agent's row and takes it off when it ends
      setTimeout(
        () => window.dispatchEvent(new CustomEvent('tnai:agent-talk')),
        at + CUT_MS - Date.now() + 60
      );
    }
    const m = talks.get(e.paneId) || new Map(),
      t = m.get(peer) || { at: 0 };
    t.at = Math.max(t.at, at);
    t[out ? 'sent' : 'got'] = clipTalk(
      String(e.text || '').replace(/^Delivered after waiting:\s*/, '')
    );
    m.set(peer, t);
    talks.set(e.paneId, m);
    setTimeout(scheduleBg, left + 50);
    scheduleBg(); // repaint now, and once more when it fades

    // The thread list (119) draws the same mark on the agent's row: told now, and when it fades.
    const tellList = () => window.dispatchEvent(new CustomEvent('tnai:agent-talk'));
    tellList();
    setTimeout(tellList, left + 50);
  }

  function talkLine(paneId) {
    const m = talks.get(paneId);
    if (!m) return null;
    for (const [peer, t] of m) if (Date.now() - t.at > TALK_MS) m.delete(peer);
    if (!m.size) {
      talks.delete(paneId);
      return null;
    }
    const list = [...m].sort((a, b) => b[1].at - a[1].at);
    return {
      label: list.length === 1 ? list[0][0] : list.length + ' agents',
      tip:
        'Messaging with other agents (tnai send, exact):' +
        list
          .map(
            ([peer, t]) =>
              '\n' +
              peer +
              ' · ' +
              ago(t.at) +
              (t.sent ? '\n  → ' + t.sent : '') +
              (t.got ? '\n  ← ' + t.got : '')
          )
          .join(''),
    };
  }

  // 119, the thread list: { label, tip } while this agent and another exchange messages, else null.
  window.TnaiLiveTasks.talk = paneId => talkLine(paneId);
  window.addEventListener('tnai:terminal-pane-closed', event => {
    talks.delete(event.detail?.paneId);
    cuts.delete(event.detail?.paneId);
  });
  window.tnaiNative?.agentEvents?.on?.(onMesh);
  window.tnaiNative?.agentEvents
    ?.history?.()
    .then(list => (list || []).forEach(onMesh))
    .catch(() => {});
  [
    'tnai:file-activity',
    'tnai:accounts-changed',
    'tnai:account-limit',
    'tnai:skill-activity',
    'tnai:skills-changed',
    'tnai:custom-agents-changed',
    'tnai:team-changed',
    'tnai:live-activity',
  ].forEach(name => window.addEventListener(name, scheduleBg));

  // Ticks only the time-based text on the visible tree ("… ago", working → waiting). The header
  // status, nav count and activity line are push-driven (agents.onChange / tnai:* events →
  // schedule), and showing Overview re-renders via the .layout class observer. Skipped while the
  // window is hidden or minimized; it ticks once as soon as the window is shown again, so nothing
  // is stale.
  const tickTimes = () => {
    if (document.hidden) return;
    if (shownNow() || window.TnaiOverviewPopout?.ids().length) schedule();
    paintRouteSoon();
  };
  setInterval(tickTimes, 2000);
  document.addEventListener('visibilitychange', tickTimes);
  render();
  paintRoute();
})();
