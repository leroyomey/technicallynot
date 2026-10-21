// Technically Not · 46-composer-target.js — Composer prompt that wraps and grows (Shift+Enter new
// line), a narrower centered composer, and (desktop) Agent · Model · Effort · Access dropdowns
// under the prompt (pill buttons with the app's own menu over hidden <select>s): Auto, a running
// agent (model/effort switched live through its CLI's /model, /effort, or Codex/Cursor's own
// picker) or a new Claude Code / Codex / Cursor Agent per signed-in account; for new agents the
// picked model/effort per CLI is remembered and passed at start (`window.TnaiLaunchPrefs`, used by
// 10). Access: one level per project, passed when a session
// starts, with its default in Settings › Agents › While agents work.
(() => {
  const prompt = document.getElementById('prompt');
  if (!prompt) return;

  // ---------- wrapping prompt + width (browser and desktop) ----------
  // Long prompts read as a paragraph: the box grows to ~6 lines or 25% of the window (whichever is
  // smaller), then scrolls, so the workspace stays visible.
  const LINE_PX = 21,
    MAX_LINES = 6;
  const maxPx = () =>
    Math.max(
      LINE_PX * 3,
      Math.min(
        LINE_PX * MAX_LINES,
        Math.floor((prompt.ownerDocument.defaultView || window).innerHeight * 0.25)
      )
    );
  const style = document.createElement('style');
  style.textContent = `
.app{grid-template-rows:58px minmax(0,1fr) auto}
.composer>.activityline,.composer>.composebox,.composer>.hints{max-width:920px!important;margin-left:auto;margin-right:auto}
body.tnai-composer-popout>.composer>.activityline,body.tnai-composer-popout>.composer>.composebox,body.tnai-composer-popout>.composer>.hints{max-width:none!important}
.composebox{height:auto;min-height:58px}
.composebox textarea.prompt{resize:none;align-self:center;min-height:21px;padding:0;margin:0;font-family:inherit;font-size:13px;line-height:${LINE_PX}px;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.composebox.tnai-prompt-long{align-items:flex-start}.composebox.tnai-prompt-long textarea.prompt{align-self:stretch}
.composer .hints{position:relative;align-items:center}`;
  document.head.append(style);

  // Grows with its text up to maxPx(); past 2 lines the box aligns to the top so the text reads as
  // a block. Code that sets the value fires 'input' (11 after sending, 27 pastes), drafts are
  // restored at load.
  function fit() {
    // Measuring at height:auto clamps scrollTop to 0; put it back so the view stays where the user
    // was typing.
    const top = prompt.scrollTop;
    prompt.style.height = 'auto';

    // Decided at height:auto, else the old tall height keeps an emptied box top-aligned.
    const long = prompt.value.includes('\n') || prompt.scrollHeight > LINE_PX * 2 + 8;
    prompt.closest('.composebox')?.classList.toggle('tnai-prompt-long', long);
    const full = prompt.scrollHeight,
      width = prompt.clientWidth; // both read before the write below: no second layout
    prompt.style.height = Math.min(full, maxPx()) + 'px';
    prompt.scrollTop = top;
    const k = emptyKey();
    emptyFit =
      !prompt.value && full > 0 && full <= LINE_PX
        ? { w: emptyFit?.k === k ? Math.min(emptyFit.w, width) : width, k }
        : null;
  }

  // Set while the box was last fitted empty and came out as one line: the narrowest width that gave
  // one line, with what else the result depends on (the placeholder wraps in a narrow box and then
  // adds lines; the zoom changes where it wraps).
  let emptyFit = null;
  const emptyKey = () =>
    prompt.placeholder + '|' + (prompt.ownerDocument.defaultView || window).devicePixelRatio;
  prompt.addEventListener('input', fit);
  prompt.addEventListener('focus', fit);

  // 11 clears the box at send without an 'input' event (that would drop pasted-text tokens, 27):
  // refit only the size.
  prompt.addEventListener('tnai:refit', fit);

  // A window resize refits only when the height limit (25% of the window) changed: the observer
  // below already refits on every width change, and both together fitted the box twice on each step
  // of a window drag (measured 2026-10-05).
  let lastMax = maxPx();
  window.addEventListener('resize', () => {
    const m = maxPx();
    if (m !== lastMax) {
      lastMax = m;
      fit();
    }
  });

  // Attachment chips (27) narrow the prompt: refit on width changes only (fit itself changes the
  // height). Not for an empty box at a width no narrower than one where it already measured one
  // line (same placeholder and zoom): it is one line there too, and each fit sets the height to
  // auto and back, two layouts of the whole page on every step of a window drag (117 to 178 ms of a
  // drag, measured 2026-10-05). A draft, or an empty box narrower than any measured so far, still
  // refits.
  let lastWidth = 0;
  new ResizeObserver(() => {
    const w = prompt.clientWidth;
    if (w !== lastWidth) {
      lastWidth = w;
      if (!(emptyFit && !prompt.value && w >= emptyFit.w && emptyFit.k === emptyKey())) fit();
    }
  }).observe(prompt);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit);
  else setTimeout(fit, 0);

  // ---------- Agent · Model · Effort dropdowns under the prompt (desktop) ----------
  const native = window.tnaiNative,
    agents = window.TnaiAgents,
    live = window.TnaiLiveTasks;
  if (!native || !agents || !live) return;
  const hints = document.querySelector('.composer .hints');
  if (!hints) return;

  const EFFORT = {
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
    ultra: 'Ultra',
  };

  // every CLI that can lead (11 START_AGENTS)
  const NEW_AGENTS = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

  // Model/effort for new agents, per CLI, remembered. 10 applies them when it starts a fresh (not
  // resumed) session of that CLI.
  const PREFS_KEY = 'tnai.launch-prefs.v1';
  let prefs = {};
  try {
    prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {}

  // the last models picked per CLI, newest first: shown first in the picker's model column (user
  // request 2026-09-30)
  const RECENT_MAX = 3;

  function setPref(agent, key, value) {
    prefs[agent] = { ...prefs[agent], [key]: value };
    if (key === 'model' && value)
      prefs[agent].recent = [
        value,
        ...(prefs[agent].recent || []).filter(id => id !== value),
      ].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }

  // Each agent's own model/effort (per pane): set by a live pick here and by the model its turns
  // actually ran on (desktop/agent-turns.js), so a /model typed in its terminal sticks too. 10
  // passes it when that pane starts again (resume or restart); a new pane uses the CLI's pick
  // above. `once`: the next fresh pane of that CLI starts on this pick (54 hands a retired agent's
  // model to its successor).
  const PANE_KEY = 'tnai.agent-models.v1',
    PANE_MAX = 200;
  let panePicks = {},
    once = {};
  try {
    panePicks = JSON.parse(localStorage.getItem(PANE_KEY) || '{}') || {};
  } catch {}

  function setPanePick(paneId, agent, key, value) {
    const cur = panePicks[paneId]?.agent === agent ? panePicks[paneId] : {};
    if (cur[key] === value) return;
    delete panePicks[paneId];
    panePicks[paneId] = { ...cur, agent, [key]: value, at: Date.now() };
    const ids = Object.keys(panePicks);

    // oldest first
    ids.slice(0, Math.max(0, ids.length - PANE_MAX)).forEach(id => delete panePicks[id]);
    try {
      localStorage.setItem(PANE_KEY, JSON.stringify(panePicks));
    } catch {}
  }
  const paneFor = (paneId, agent) =>
    panePicks[paneId]?.agent === agent ? panePicks[paneId] : null;

  // Access: how much a new agent may do without asking. One level
  // per project, picked on the Access pill; projects without a pick use the Settings default
  // (`tnai.access-default.v1`, initial "CLI default", which adds nothing). The flags per CLI are in
  // desktop/agent-registry.js; a level the CLI has no flag for is greyed out with the registry's
  // reason, and that CLI starts on its own settings.
  const ACCESS = ['default', 'ask', 'edits', 'auto', 'full', 'plan'];
  const ACCESS_LABEL = {
    default: 'CLI default',
    ask: 'Ask first',
    edits: 'Allow edits',
    auto: 'Auto review',
    full: 'Full access',
    plan: 'Plan only',
  };
  const ACCESS_HINT = {
    default: 'its own settings',
    ask: 'asks before edits and commands',
    edits: 'edits without asking',
    auto: 'its reviewer approves routine steps',
    full: 'runs commands without asking',
    plan: 'reads and proposes, changes nothing',
  };

  // a sub-agent never ranks above its lead
  const ACCESS_RANK = { plan: 0, ask: 1, edits: 2, auto: 3, full: 4 };
  const ACCESS_KEY = 'tnai.access.v1',
    ACCESS_DEFAULT_KEY = 'tnai.access-default.v1',
    ACCESS_MAX = 200;
  let accessByProject = {},
    accessDefault = 'default',
    root = '';
  try {
    const v = JSON.parse(localStorage.getItem(ACCESS_KEY) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) accessByProject = v;
  } catch {}
  try {
    const v = localStorage.getItem(ACCESS_DEFAULT_KEY);
    if (ACCESS.includes(v)) accessDefault = v;
  } catch {}
  const levelNow = () =>
    ACCESS.includes(accessByProject[root]) ? accessByProject[root] : accessDefault;

  function setLevel(level) {
    delete accessByProject[root];
    accessByProject[root] = level;
    const keys = Object.keys(accessByProject);

    // oldest first
    keys.slice(0, Math.max(0, keys.length - ACCESS_MAX)).forEach(k => delete accessByProject[k]);
    try {
      localStorage.setItem(ACCESS_KEY, JSON.stringify(accessByProject));
    } catch {}
  }
  const accessInfo = {}; // CLI -> { levels, why } (agent-registry.js capabilities)
  const hasLevel = (agent, level) =>
    level === 'default' || !!accessInfo[agent]?.levels?.includes(level);
  const accessFor = agent => (hasLevel(agent, levelNow()) ? levelNow() : 'default');

  // paneId -> the level its session started with ('default' after a resume: no flag was passed)
  const paneAccess = {};

  // panels main holds at "Ask first" because another computer started them (`held` below)
  const heldPanes = new Set();
  window.TnaiLaunchPrefs = {
    for: agent => ({ model: prefs[agent]?.model || '', effort: prefs[agent]?.effort || '' }),
    pane: (paneId, agent) => ({
      model: paneFor(paneId, agent)?.model || '',
      effort: paneFor(paneId, agent)?.effort || '',
    }),
    // What a pane starts on: its own pick; a resumed conversation without one keeps the CLI's
    // default; a fresh pane: `once`, else the CLI's pick.
    start(paneId, agent, resumed) {
      const own = paneFor(paneId, agent);

      // Access is set when a session starts: a fresh one gets the project's level (a sub-agent its
      // capped level from `once`), a resumed one the CLI's own. OpenCode's levels are rules in its
      // launch config, not part of the conversation: without them a resumed OpenCode panel would
      // run at OpenCode's own defaults, which allow everything. So it gets its level again: the one
      // it started with in this run (a Switch account or hand-off restart), else the project's, as
      // a fresh panel would.
      const access = resumed
        ? agent === 'OpenCode'
          ? paneAccess[paneId] || accessFor(agent)
          : 'default'
        : once[agent]?.access || accessFor(agent);
      paneAccess[paneId] = access;
      if (own) return { model: own.model || '', effort: own.effort || '', access };
      if (resumed) return access === 'default' ? null : { model: '', effort: '', access };
      const next = once[agent];
      delete once[agent];
      const pick = next?.model || next?.effort ? next : window.TnaiLaunchPrefs.for(agent);
      if (pick === next) {
        if (pick.model) setPanePick(paneId, agent, 'model', pick.model);
      }
      if (pick.effort) {
        setPanePick(paneId, agent, 'effort', pick.effort);
        setPanePick(paneId, agent, 'effortAt', Date.now());

        // the effort it starts on shows under the composer until its first reply confirms it;
        // stamped like a live pick, so a reply written before this start cannot replace it
      }
      return { model: pick.model || '', effort: pick.effort || '', access };
    },
    once: (agent, pick) => {
      if (pick?.model || pick?.effort || pick?.access)
        once[agent] = {
          model: pick.model || '',
          effort: pick.effort || '',
          access: pick.access || '',
        };
      else delete once[agent];
    },
    // The project's level now, and the level a pane's session started with.
    access: () => levelNow(),
    // The normal level of another project folder, for that CLI (a scheduled prompt's run, 47):
    // the one chosen for that project, else the default, and 'default' when the CLI lacks it.
    accessIn(folder, agent) {
      const chosen = accessByProject[String(folder || '')];
      const level = ACCESS.includes(chosen) ? chosen : accessDefault;
      return hasLevel(agent, level) ? level : 'default';
    },
    paneAccess: paneId => paneAccess[paneId] || '',
    // 10, after each start: main's word that the panel is held at "Ask first" (another computer
    // started it), whatever level this window asked for.
    held(paneId, on) {
      if (on) {
        heldPanes.add(paneId);
        paneAccess[paneId] = 'ask';
      } else heldPanes.delete(paneId);
      paint();
    },
    // Checks only: what the main process said about a panel's effort (effortTruth), put in place of
    // asking it.
    effortSeen(paneId, v) {
      effortSeen[paneId] = { at: Infinity, pending: false, v: v || null };
      paint();
    },
    // A sub-agent (43, tnai_delegate) starts at the lower of the project's level and its lead's,
    // never higher; a level its CLI lacks steps down to the next one it has. Nothing at or below
    // it: that level goes through, and main refuses the start with the reason (agent-registry.js
    // spec).
    subAccess(parentPaneId, agent) {
      const lead = paneAccess[parentPaneId] || 'default',
        want = levelNow();
      const level =
        lead === 'default'
          ? want
          : want === 'default' || ACCESS_RANK[want] > ACCESS_RANK[lead]
            ? lead
            : want;
      if (level === 'default') return 'default';
      const lower = Object.keys(ACCESS_RANK)
        .filter(l => ACCESS_RANK[l] <= ACCESS_RANK[level])
        .sort((a, b) => ACCESS_RANK[b] - ACCESS_RANK[a]);
      return lower.find(l => hasLevel(agent, l)) || level;
    },
  };

  // Each CLI's own model list (desktop agent-registry.js: Claude Code aliases, Codex
  // models_cache.json, cursor-agent --list-models). Asked again after 10 min (the main process
  // re-reads the CLI or server list in the background), so a new model shows without a restart.
  const catalog = {},
    loading = {},
    loadedAt = {};

  function modelsOf(agent) {
    if (
      (!catalog[agent] || Date.now() - loadedAt[agent] > 10 * 60e3) &&
      !loading[agent] &&
      native.agents.models
    )
      loading[agent] = native.agents
        .models(agent)
        .then(
          r => r,
          () => null
        )
        .then(r => {
          const before = JSON.stringify(catalog[agent] || null);
          loadedAt[agent] = Date.now();
          delete loading[agent];
          if (r || !catalog[agent]) catalog[agent] = r || { models: [], efforts: [] };
          if (JSON.stringify(catalog[agent]) !== before) {
            paint();
            paintSide();
          } // paint leaves an open menu alone; its model column fills in here
        });
    return catalog[agent] || null;
  }

  // OpenCode's list follows its saved credentials: when its sign-in state changes (a sign-in panel
  // ended, a provider added or removed; the main process drops its own copy in the same detection),
  // the list is asked again at once instead of after the 10 minutes. the action row at the end of
  // OpenCode's models (paintSide), never a model id
  const ADD_PROVIDER = 'add-provider';

  // A running OpenCode panel's effort as the main process knows it (opencode-link.js effortState):
  // { linked, model, want, set: true | false | null (still being set), now: the level OpenCode has
  // saved for that model }. Asked again after 5 s; a changed answer repaints.
  const effortSeen = {}; // paneId -> { at, pending, v }

  function effortTruth(paneId) {
    const c = effortSeen[paneId] || (effortSeen[paneId] = { at: 0, pending: false, v: null });
    if (!c.pending && Date.now() - c.at > 5000 && native.agents.effortState) {
      c.pending = true;
      native.agents
        .effortState(paneId)
        .then(
          v => v,
          () => null
        )
        .then(v => {
          const before = JSON.stringify(c.v);
          c.v = v || null;
          c.pending = false;
          c.at = Date.now();
          if (JSON.stringify(c.v) !== before) paint();
        });
    }
    return c.v;
  }
  let openCodeSign = null;
  agents.onChange(() => {
    const a = agents.info().find(x => x.id === 'OpenCode'),
      sign = a ? [a.installed, a.loggedIn, a.account].join('|') : '';
    if (openCodeSign !== null && sign !== openCodeSign && catalog.OpenCode) {
      loadedAt.OpenCode = 0;
      modelsOf('OpenCode');
    }
    openCodeSign = sign;
  });

  // Each dropdown is a pill button + a floating menu drawn by the app; the hidden <select> under it
  // stays the source of truth (its value, options, disabled, title and 'change' event are what this
  // file and the tests use).
  const pickStyle = document.createElement('style');
  pickStyle.textContent = `
.tnai-pickers{display:flex;align-items:center;gap:6px;margin-right:auto;min-width:0}
.tnai-pick{position:relative;display:inline-flex;min-width:0;max-width:190px}
.tnai-pick>select{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;pointer-events:none}
.tnai-pick-btn{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;width:100%;min-width:0;height:24px;padding:0 7px 0 9px;border:1px solid var(--line);border-radius:7px;background:var(--white);color:var(--ink);font:inherit;font-size:11px;font-weight:500;line-height:1;white-space:nowrap;cursor:pointer;transition:background-color .18s ease,border-color .18s ease}
.tnai-pick-btn>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left}
.tnai-pick-btn>svg{flex:none;color:var(--muted);transition:transform .18s ease}
.tnai-pick-btn[aria-expanded=true]>svg{transform:rotate(180deg)}
.tnai-pick-btn:hover:not(:disabled),.tnai-pick-btn[aria-expanded=true]{background:color-mix(in srgb,var(--ink) 4%,var(--white));border-color:color-mix(in srgb,var(--ink) 14%,var(--line))}
.tnai-pick-btn:active:not(:disabled){background:color-mix(in srgb,var(--ink) 7%,var(--white))}
.tnai-pick-btn:focus-visible{outline:var(--pg-ring,2px) solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:1px}
.tnai-pick-btn:disabled{opacity:.5;cursor:not-allowed}
.tnai-pick-menu{position:fixed;z-index:1000;box-sizing:border-box;min-width:180px;max-width:min(360px,calc(100vw - 16px));overflow-y:auto;padding:4px;background:var(--white);border:1px solid var(--line);border-radius:var(--surface-r);box-shadow:var(--shadow);color:var(--ink);font-size:11px;outline:0;scrollbar-width:thin;animation:tnai-pick-in .15s ease}
.tnai-pick-menu h4{margin:7px 8px 3px;font-size:10px;font-weight:600;color:var(--muted)}
.tnai-pick-menu h4:first-child{margin-top:3px}
.tnai-pick-opt{display:grid;grid-template-columns:12px minmax(0,1fr) auto;align-items:center;gap:7px;min-height:26px;padding:4px 9px 4px 7px;border-radius:6px;white-space:nowrap;cursor:pointer}
.tnai-pick-opt>b{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.tnai-pick-opt>small{font-size:10px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;max-width:170px}
.tnai-pick-opt>svg{color:var(--green);visibility:hidden}
.tnai-pick-opt[aria-selected=true]>svg{visibility:visible}
.tnai-pick-opt[aria-selected=true]>b{font-weight:600}
.tnai-pick-opt.active{background:color-mix(in srgb,var(--ink) 5%,var(--white))}
.tnai-pick-opt[aria-disabled=true]{color:var(--muted);cursor:default}
.tnai-pick-opt[aria-disabled=true].active{background:none}
.tnai-pick-menu.tnai-pick-two{display:flex;flex-direction:column;width:540px;max-width:min(540px,calc(100vw - 16px));overflow:hidden}
.tnai-pick-find{flex:none;padding:3px 3px 5px}
.tnai-pick-find input{box-sizing:border-box;width:100%;height:26px;padding:0 9px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;font:inherit;outline:0}
.tnai-pick-find input:focus-visible{border-color:color-mix(in srgb,var(--green) 55%,var(--line))}
.tnai-pick-cols{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,200px) minmax(0,1fr);gap:4px}
.tnai-pick-list,.tnai-pick-side{min-height:0;max-height:min(320px,46vh);overflow-y:auto;scrollbar-width:thin}
.tnai-pick-side{padding-left:4px;border-left:1px solid var(--line)}
.tnai-pick-mopt{display:grid;grid-template-columns:12px minmax(0,1fr) auto 18px;align-items:center;gap:7px;min-height:26px;padding:4px 9px 4px 7px;border-radius:6px;white-space:nowrap;cursor:pointer}
.tnai-pick-mopt>b{font-weight:500;overflow:hidden;text-overflow:ellipsis}
.tnai-pick-mopt>small{font-size:10px;color:var(--muted)}
.tnai-pick-mopt>svg{color:var(--green);visibility:hidden}
.tnai-pick-mopt[aria-selected=true]>svg{visibility:visible}
.tnai-pick-mopt[aria-selected=true]>b{font-weight:600}
.tnai-pick-mopt:hover,.tnai-pick-mopt.active{background:color-mix(in srgb,var(--ink) 5%,var(--white))}
.tnai-pick-mopt[aria-disabled=true]{color:var(--muted);cursor:default}
.tnai-pick-mopt[aria-disabled=true]:hover,.tnai-pick-mopt[aria-disabled=true].active{background:none}
.tnai-pick-mopt>small{grid-column:3}
.tnai-pick-fav{grid-column:4;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:5px;background:none;color:var(--muted);cursor:pointer;opacity:0;transition:opacity .15s ease,color .15s ease}
.tnai-pick-mopt:hover>.tnai-pick-fav,.tnai-pick-mopt.active>.tnai-pick-fav,.tnai-pick-fav[aria-pressed=true]{opacity:1}
.tnai-pick-fav:hover{color:inherit}
.tnai-pick-fav[aria-pressed=true]{color:var(--pg-accent-2)}
.tnai-pick-fav[aria-pressed=true]>svg{fill:currentColor}
.tnai-pick-mopt>.tnai-pick-fav>svg{visibility:visible;color:inherit}
.tnai-pick-more{display:block;width:100%;min-height:26px;padding:4px 9px 4px 26px;border:0;border-radius:6px;background:none;color:var(--muted);font:inherit;text-align:left;cursor:pointer}
.tnai-pick-more:hover{background:color-mix(in srgb,var(--ink) 5%,var(--white));color:inherit}
.tnai-pick-note{margin:8px;color:var(--muted)}
.tnai-pick-effs{display:flex;flex-wrap:wrap;gap:4px;padding:6px 7px 3px}
.tnai-pick-eff{height:22px;padding:0 9px;border:1px solid var(--line);border-radius:11px;background:none;color:var(--muted);font:inherit;font-size:10px;cursor:pointer}
.tnai-pick-eff:hover{color:inherit}
.tnai-pick-eff[aria-pressed=true]{color:inherit;border-color:color-mix(in srgb,var(--green) 55%,var(--line));background:color-mix(in srgb,var(--green) 12%,transparent)}
.tnai-pick-more:focus-visible,.tnai-pick-eff:focus-visible{outline:var(--pg-ring,2px) solid color-mix(in srgb,var(--green) 45%,transparent);outline-offset:1px}
@media (max-width:560px){.tnai-pick-cols{grid-template-columns:minmax(0,1fr)}.tnai-pick-side{padding-left:0;border-left:0;border-top:1px solid var(--line)}}
@keyframes tnai-pick-in{from{opacity:0;transform:translateY(2px)}}
@media (prefers-reduced-motion:reduce){.tnai-pick-menu{animation:none}.tnai-pick-btn,.tnai-pick-btn>svg{transition:none}}`;
  document.head.append(pickStyle);
  const CHEVRON = window.TnaiIcon('chevron-down', { size: 14 });
  const CHECK =
    '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.3 5 8.7 9.5 3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const STAR =
    // Lucide "star", inline like CHECK
    '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
  const box = document.createElement('span');
  box.className = 'tnai-pickers';
  box.innerHTML = ['agent', 'model', 'effort', 'access']
    .map(
      k =>
        `<span class="tnai-pick" data-pick="${k}"><select aria-label="${k[0].toUpperCase() + k.slice(1)}" tabindex="-1" aria-hidden="true"></select><button type="button" class="tnai-pick-btn" aria-haspopup="listbox" aria-expanded="false">${k === 'agent' ? '<i class="tnai-pick-av" aria-hidden="true"></i>' : ''}<span></span>${k === 'agent' ? '<small class="tnai-pick-pj"></small>' : ''}${CHEVRON}</button></span>`
    )
    .join('');
  hints.prepend(box);
  const [agentSel, modelSel, effortSel, accessSel] = box.querySelectorAll('select');
  const selects = [agentSel, modelSel, effortSel, accessSel];

  // The new-agent CLI menu (the agent pill is hidden, 07, so new agents could only
  // start as the default CLI). A detached select like the pickers' (same menu), opened from the
  // Model pill (openModels): installed CLIs only, one row per signed-in account, a signed-out one
  // grayed ("not signed in"); the default (what Auto starts) is marked. 11's ＋ New agent button is
  // a plain toggle.
  const newSel = document.createElement('select');
  newSel.setAttribute('aria-label', 'New agent');

  // ---------- the pill buttons and their menu ----------
  const menu = document.createElement('div');
  menu.className = 'tnai-pick-menu';
  menu.id = 'tnaiPickMenu';
  menu.setAttribute('role', 'listbox');
  menu.tabIndex = -1;
  let menuSel = null,
    rows = [],
    active = -1,
    picking = false;
  const btnOf = sel => sel._btn || sel.nextElementSibling; // newSel's button is the Model pill
  const farCount = () => {
    try {
      return (window.TnaiRemoteAgents?.starts?.() || []).length;
    } catch {
      return 0;
    }
  }; // entries for a new agent on another computer; 0 with connecting off

  // The button mirrors its select: the chosen option's text, disabled state and title (tooltip).
  function sync(sel) {
    if (sel === newSel) return;
    const b = btnOf(sel),
      text = sel.options[sel.selectedIndex]?.textContent || '';

    // The Model pill shows the friendly name only; the exact id the CLI gets is in its tooltip
    // (the long form "Opus 5.5 · claude-opus-…" was cut off).
    const cut = sel === modelSel ? text.indexOf(' · ') : -1;
    b.querySelector('span').textContent =
      // data-pill: the Access pill's short name
      sel.options[sel.selectedIndex]?.dataset.pill || (cut > 0 ? text.slice(0, cut) : text);
    if (sel === agentSel) paintPill(b, text);

    // farOnly: the Model pill has nothing of this computer's to offer, but a paired computer can
    // start an agent from here (116 `starts`): the pill stays pressable and opens the New agent
    // menu on those entries (openModels). With none, as it always was.
    const farOnly = sel === modelSel && sel.disabled && !sel._busyOnly && farCount() > 0;
    b.disabled = sel.disabled && !sel._busyOnly && !farOnly;
    b.title = farOnly
      ? 'New agent on another computer'
      : (sel.title || '') + (cut > 0 ? ' · ' + text.slice(cut + 3) : '');
    b.setAttribute('aria-label', sel.getAttribute('aria-label') + (text ? ': ' + text : ''));
    if (menuSel === sel && sel.disabled) close(false);
  }

  // The agent pill like the picture's .to: letter avatar in the agent's color, its name, "·
  // project", then the chevron. With no agent picked (Auto / a new agent) the avatar shows the CLI
  // Auto would start and the project is the open folder.
  function paintPill(b, text) {
    const sub = subject(),
      av = b.querySelector('.tnai-pick-av'),
      pj = b.querySelector('.tnai-pick-pj'),
      pg = window.TnaiAgentMarks;
    const name = sub.kind === 'live' ? sub.session.name : text;
    b.querySelector('span').textContent = name;
    av.textContent = (sub.kind === 'live' ? sub.session.name : sub.agent || '?')
      .trim()
      .charAt(0)
      .toUpperCase();
    av.style.background =
      sub.kind === 'live' && pg?.agentColor
        ? pg.agentColor(sub.session.name)
        : pg?.cliColor
          ? pg.cliColor(sub.agent)
          : ''; // a running agent keeps its own color (94)
    const proj =
      sub.kind === 'live'
        ? pg?.projectName?.(sub.session.paneId)
        : document.getElementById('projectCrumb')?.textContent;
    pj.textContent = proj ? '· ' + proj : '';
  }
  const syncAll = () => selects.forEach(sync);

  function setActive(i, scroll) {
    rows[active]?.classList.remove('active');
    active = i;
    const row = rows[i];
    if (!row) {
      menu.removeAttribute('aria-activedescendant');
      return;
    }
    row.classList.add('active');
    menu.setAttribute('aria-activedescendant', row.id);
    if (scroll) row.scrollIntoView({ block: 'nearest' });
  }

  // Next enabled row from `from` in direction `dir` (stays put at the ends).
  function step(from, dir) {
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir)
      if (!rows[i]._opt.disabled) return i;
    return from;
  }

  // Placed by TnaiFloat (100): opens upward (flips down when there is no room); the composer
  // pop-out (38) grows for it.
  function place() {
    if (!menuSel) return;
    const b = btnOf(menuSel);
    menu.style.minWidth = Math.max(180, Math.round(b.getBoundingClientRect().width)) + 'px';
    window.TnaiFloat?.attach(b, menu, { placement: 'top-start', offset: 4 });
  }

  function open(sel) {
    if (sel.disabled) return;
    if (menuSel) close(false);
    menuSel = sel;
    const doc = box.ownerDocument; // the composer may be in its pop-out window (38)
    const parts = [];
    let n = 0;
    const row = o => {
      const t = o.textContent,
        cut = t.indexOf(' · ');
      return `<div class="tnai-pick-opt" role="option" id="tnaiPickOpt${n++}" aria-selected="${o.selected}"${o.disabled ? ' aria-disabled="true"' : ''} title="${esc(o.title || t)}">${CHECK}<b>${esc(cut > 0 ? t.slice(0, cut) : t)}</b>${cut > 0 ? '<small>' + esc(t.slice(cut + 3)) + '</small>' : ''}</div>`;
    };
    const opts = [];
    [...sel.children].forEach(c => {
      if (c.tagName === 'OPTGROUP') {
        parts.push(`<h4 role="presentation">${esc(c.label)}</h4>`);
        [...c.children].forEach(o => {
          opts.push(o);
          parts.push(row(o));
        });
      } else {
        opts.push(c);
        parts.push(row(c));
      }
    });

    // The agent pill's menu also carries the composer's extra buttons (the picture's box is only
    // pill, ＋, prompt, mic, Send): ＋ New agent (11) and pop out / dock (38). Their own buttons stay
    // in the box, hidden by 07; these click them.
    if (sel === agentSel) {
      const fresh = null /* ＋ New agent sits next to Send again (07) */,
        pop = doc.querySelector('.tnai-composer-pop');
      const extra = [
        fresh &&
          !fresh.hidden &&
          `<button type="button" class="tnai-pick-extra" data-extra="new" aria-pressed="${esc(fresh.getAttribute('aria-pressed') || 'false')}" title="${esc(fresh.title)}"${fresh.disabled ? ' disabled' : ''}>${esc(fresh.textContent)}</button>`,
        pop &&
          !pop.hidden &&
          `<button type="button" class="tnai-pick-extra" data-extra="pop" title="${esc(pop.title)}">${esc(pop.textContent)} ${esc(pop.title.replace(/ (into|back into) .*$/, ''))}</button>`,
      ].filter(Boolean);
      if (extra.length)
        parts.push(
          '<div class="tnai-pick-tray" role="group" aria-label="Composer">' +
            extra.join('') +
            '</div>'
        );
    }

    // ＋ New agent: the CLIs on the left, the highlighted CLI's models
    // (and effort) on the right, a search over every CLI's models on top. A CLI row picks that CLI
    // as before; a model row picks its CLI and that model in one click.
    const two = sel === newSel;
    menu.classList.toggle('tnai-pick-two', two);
    menu.setAttribute('role', two ? 'dialog' : 'listbox');
    menu.innerHTML = two
      ? '<div class="tnai-pick-find"><input type="text" placeholder="Search models" aria-label="Search models in every CLI" autocomplete="off" spellcheck="false"></div><div class="tnai-pick-cols"><div class="tnai-pick-list" role="listbox" aria-label="CLI">' +
        parts.join('') +
        '</div><div class="tnai-pick-side" role="listbox" aria-label="Model"></div></div>'
      : parts.join('');
    sideAt = -1;
    rows = [...menu.querySelectorAll('.tnai-pick-opt')];
    rows.forEach((r, i) => {
      r._opt = opts[i];
    });

    // every CLI's list, for the search
    if (two) [...new Set(rows.map(agentOfRow).filter(Boolean))].forEach(modelsOf);
    menu.setAttribute('aria-label', sel.getAttribute('aria-label'));
    const b = btnOf(sel);
    b.setAttribute('aria-expanded', 'true');
    b.setAttribute('aria-controls', menu.id);
    doc.body.append(menu);
    active = -1;
    place();
    const cur = rows.findIndex(r => r._opt.selected);
    setActive(cur >= 0 && !rows[cur]._opt.disabled ? cur : step(-1, 1), true);
    if (two) {
      paintSide();
      place();
      menu.querySelector('.tnai-pick-find input').focus({ preventScroll: true });
    } else menu.focus({ preventScroll: true });
  }

  // ---------- the model column of the ＋ New agent menu ----------
  let redrawing = false,
    // sideAt: the highlighted model row while the keyboard is in the model column (-1 = in the CLI
    // list)
    sideAt = -1;

  // The Model pill opens this same menu (its own list showed only the
  // models of the CLI that gets the prompt). menuSub: what the pill acts on (subject()) while the
  // menu is open from it. A model of that CLI does what the pill's list did (a running agent
  // switches live, else the model new agents of that CLI start on); a model of another CLI starts a
  // new agent, like ＋ New agent.
  let menuSub = null;
  const liveModelOf = s =>
    window.TnaiTurns?.get(s.paneId)?.model ||
    window.TnaiLaunchPrefs.pane(s.paneId, s.agent).model ||
    window.TnaiLaunchPrefs.for(s.agent).model ||
    '';

  function openModels() {
    const sub = subject();
    fillNew();
    const i = [...newSel.options].findIndex(
      o => !o.disabled && o.value.startsWith('new:' + sub.agent + '|')
    );

    // This CLI has no row there: the pill's own list. Unless a paired computer can start an agent
    // from here: then the menu opens all the same, so those entries can be reached on a computer
    // with no CLI of its own signed in (no row is marked as chosen).
    const far = i < 0 && [...newSel.options].some(o => !o.disabled && o.value.startsWith('far:'));
    if (i < 0 && !far) return false;
    if (menuSel) close(false);
    const farKey = live.newFar?.()?.key || '',
      // New agent is set to another computer: the menu opens on that row
      f = farKey ? [...newSel.options].findIndex(o => o.value === 'far:' + farKey) : -1;
    newSel.selectedIndex = f >= 0 ? f : i;
    newSel._btn = btnOf(modelSel);
    menuSub = sub;
    open(newSel);
    return true;
  }
  const agentOfRow = r => {
    const v = r?._opt?.value || '';
    return v.startsWith('new:') ? v.slice(4).split('|')[0] : '';
  };
  const findText = () =>
    (menu.querySelector('.tnai-pick-find input')?.value || '').trim().toLowerCase();
  const sideRows = () => [...menu.querySelectorAll('.tnai-pick-mopt')];

  function paintSide() {
    const side = menu.querySelector('.tnai-pick-side');
    if (!side || menuSel !== newSel) return;
    const q = findText(),
      agents2 = [
        ...new Set(
          rows
            .filter(r => !r._opt.disabled)
            .map(agentOfRow)
            .filter(Boolean)
        ),
      ];

    // the running agent the Model pill acts on
    const liveS = menuSub?.kind === 'live' ? menuSub.session : null;
    const held =
      liveS && busy(liveS.paneId)
        ? 'Wait until ' + liveS.name + ' finishes its task to switch.'
        : ''; // its own rows are grayed; other CLIs' stay usable

    // The model rows of one CLI: the last picks first (once there are two), then the short list or,
    // opened, the whole list by family; each model once.
    const body = (agent, all, cur, off) => {
      const short = shortList(all, agent),
        open2 = showAll[agent] || short.length >= all.length,
        one = m => mrow(agent, m, m.id === cur, false, off);
      const fav = (Array.isArray(favs[agent]) ? favs[agent] : [])
        .map(id => all.find(m => m.id === id))
        .filter(Boolean); // starred models lead, each model still listed once
      const recent = (prefs[agent]?.recent || [])
          .map(id => all.find(m => m.id === id))
          .filter(m => m && !fav.includes(m)),
        top = recent.length > 1 ? recent : [];
      const rest = (
          open2 ? all : [...short, ...all.filter(m => m.id === cur && !short.includes(m))]
        ).filter(m => !top.includes(m) && !fav.includes(m)),
        grouped = open2 && all.some(m => m.group);
      return (
        (fav.length
          ? '<h4 role="presentation">Favorites</h4>' +
            fav.map(one).join('') +
            (top.length || grouped ? '' : '<h4 role="presentation">Models</h4>')
          : '') +
        (top.length
          ? '<h4 role="presentation">Recent</h4>' +
            top.map(one).join('') +
            (grouped ? '' : '<h4 role="presentation">Models</h4>')
          : '') +
        (grouped
          ? [...new Set(rest.map(m => m.group || 'Other'))]
              .map(
                g =>
                  `<h4 role="presentation">${esc(g)}</h4>` +
                  rest
                    .filter(m => (m.group || 'Other') === g)
                    .map(one)
                    .join('')
              )
              .join('')
          : rest.map(one).join('')) +
        // OpenCode only: the last row of its list is an action, not a
        // model. It opens the sign-in that already exists (15 openSignIn) and is never picked,
        // starred or found.
        (agent === 'OpenCode' && !off && window.TnaiAccounts?.openSignIn
          ? mrow(agent, { id: ADD_PROVIDER, label: 'Add a provider…' }, false)
          : '') +
        (short.length < all.length
          ? `<button type="button" class="tnai-pick-more" data-agent="${esc(agent)}">${showAll[agent] ? 'Fewer models' : 'All models… (' + all.length + ')'}</button>`
          : '')
      );
    };
    const mrow = (agent, m, on, cli, off) =>
      `<div class="tnai-pick-mopt" role="option" data-agent="${esc(agent)}" data-model="${esc(m.id)}" aria-selected="${!!on}"${off ? ' aria-disabled="true"' : ''} title="${esc(off ? held : m.id === ADD_PROVIDER ? 'Opens OpenCode’s own sign-in (opencode auth login) in a terminal panel; its models are listed here once it is done' : m.id === 'picker' ? 'Opens ' + agent + '’s own model picker in its terminal' : m.id ? (m.label === m.id ? m.id : m.label + ' · ' + m.id) + (m.note ? ' · ' + m.note : '') : 'The model ' + agent + ' picks itself')}">${CHECK}<b>${esc(m.label || m.id)}</b>${cli ? '<small>' + esc(liveS?.agent === agent ? liveS.name : agent) + '</small>' : ''}${m.id && m.id !== 'picker' && m.id !== ADD_PROVIDER ? `<button type="button" class="tnai-pick-fav" tabindex="-1" aria-pressed="${isFav(agent, m.id)}" aria-label="${isFav(agent, m.id) ? 'Remove from favorites' : 'Add to favorites'}" title="${isFav(agent, m.id) ? 'Remove from favorites' : 'Add to favorites'}">${STAR}</button>` : ''}</div>`;
    let html = '';
    if (q) {
      // every CLI's models that match
      let loading = false;
      for (const agent of agents2) {
        const cat = modelsOf(agent);
        if (!cat) {
          loading = true;
          continue;
        }
        const mine = menuSub?.agent === agent,
          cur = mine && liveS ? liveModelOf(liveS) : prefs[agent]?.model || '';
        html += cat.models
          .filter(m => (m.label + ' ' + m.id).toLowerCase().includes(q))
          .slice(0, 12)
          .map(m =>
            mrow(
              agent,
              m,
              m.id === cur && (mine || live.newAgent() === agent),
              true,
              mine && !!held
            )
          )
          .join('');
      }
      if (!html)
        html =
          '<p class="tnai-pick-note">' +
          (loading ? 'Loading models…' : 'No model matches “' + esc(q) + '”') +
          '</p>';
    } else {
      const agent = agentOfRow(rows[active]),
        cat = agent ? modelsOf(agent) : null;
      if (!agent)
        html = String(rows[active]?._opt?.value || '').startsWith('far:')
          ? '<p class="tnai-pick-note">A new agent on that computer, for this project. That computer picks its model, and the agent asks before it runs commands there. Your next prompt starts it.</p>'
          : '<p class="tnai-pick-note">Sign in to this CLI to pick its model.</p>';
      else if (!cat) html = '<p class="tnai-pick-note">Loading models…</p>';
      else if (liveS?.agent === agent) {
        // the running agent: its model switches now, as in the pill's own list (effort stays on the
        // Effort pill)
        html =
          `<h4 role="presentation">Model for ${esc(liveS.name)}</h4>` +
          (held ? '<p class="tnai-pick-note">' + esc(held) + '</p>' : '') +
          (agent !== 'Claude Code'
            ? // Codex and Cursor Agent switch in their own picker
              mrow(
                agent,
                { id: 'picker', label: 'Choose on its CLI screen…' },
                false,
                false,
                !!held
              )
            : body(agent, cat.models, liveModelOf(liveS), !!held));
      } else {
        const all = cat.models,
          cur = prefs[agent]?.model || '';
        html =
          `<h4 role="presentation">Model for a new ${esc(agent)} agent</h4>` +
          mrow(agent, { id: '', label: 'Default model' }, !cur) +
          body(agent, all, cur) +
          (all.length
            ? ''
            : '<p class="tnai-pick-note">' + esc(agent) + ' lists no models right now.</p>');
        const model = all.find(m => m.id === cur),
          efforts = model?.efforts?.length ? model.efforts : cat.efforts || [],
          eff = prefs[agent]?.effort || '';
        if (efforts.length)
          html +=
            '<h4 role="presentation">Effort</h4><div class="tnai-pick-effs" role="group" aria-label="Effort">' +
            efforts
              .map(
                e =>
                  `<button type="button" class="tnai-pick-eff" data-agent="${esc(agent)}" data-effort="${esc(e)}" aria-pressed="${e === eff}">${esc(EFFORT[e] || e)}</button>`
              )
              .join('') +
            '</div>';
      }
    }
    redrawing = true;
    side.innerHTML = html;
    redrawing = false; // a focused All models… / effort button is replaced: not a reason to close
    sideRows().forEach((r, i) => {
      r.id = 'tnaiPickModel' + i;
    });
    setSide(q ? 0 : -1);
  }

  function setSide(i) {
    const list = sideRows();
    list.forEach(r => r.classList.remove('active'));
    sideAt = list[i] ? i : -1;
    if (sideAt >= 0) {
      list[sideAt].classList.add('active');
      list[sideAt].scrollIntoView({ block: 'nearest' });
    }
  }

  // A model row: that CLI (the highlighted account row when it is this CLI's, else its first usable
  // one) starts on that model.
  function pickModel(agent, model) {
    if (model === ADD_PROVIDER) {
      close(true);
      window.TnaiAccounts?.openSignIn?.(agent, { accountId: '' });
      return;
    } // the action row: nothing is picked or saved
    const sub = menuSub;

    // another computer's agent, its own CLI: switched there (164, plan item 44)
    if (sub?.kind === 'remote' && sub.agent === agent) {
      close(true);
      if (!sub.far.why.model) window.TnaiRemoteThreadMore?.pick?.(sub.far, 'model', model);
      return;
    }
    if (sub?.kind === 'live' && sub.agent === agent) {
      if (busy(sub.session.paneId)) return;

      /* grayed: it is working */ close(true);
      switchLive(sub.session, 'model', agent === 'Claude Code' ? model : 'picker');
      return;
    }
    const i =
      agentOfRow(rows[active]) === agent && !rows[active]._opt.disabled
        ? active
        : rows.findIndex(r => agentOfRow(r) === agent && !r._opt.disabled);
    if (i < 0) return;
    setPref(agent, 'model', model);

    // a model with its own effort levels (Codex) drops an effort it does not offer
    const m = catalog[agent]?.models.find(x => x.id === model);
    if (m?.efforts?.length && prefs[agent]?.effort && !m.efforts.includes(prefs[agent].effort))
      setPref(agent, 'effort', '');
    if (sub?.agent === agent) {
      close(true);
      paint();
    } // the Model pill, its own CLI: only the model changes, as before
    else choose(i);
  }

  function close(focusBtn) {
    const sel = menuSel;
    if (!sel) return;
    menuSel = null;
    menuSub = null;
    window.TnaiFloat?.detach(menu);
    menu.remove();
    rows = [];
    active = -1;
    btnOf(sel).setAttribute('aria-expanded', 'false');
    if (focusBtn) btnOf(sel).focus();
    if (!picking) setTimeout(paint, 0); // updates held back while it was open
  }

  function choose(i) {
    const sel = menuSel,
      o = rows[i]?._opt;
    if (!sel || !o || o.disabled) return;
    picking = true;
    try {
      close(true);
      if (sel.selectedIndex !== o.index || sel === newSel) {
        /* a New agent pick always turns it on, the preselected default too */ sel.selectedIndex =
          o.index;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } finally {
      picking = false;
    }
    sync(sel);
  }
  let typed = '',
    typedAt = 0;
  menu.addEventListener('keydown', e => {
    if (!menuSel) return;
    const k = e.key;

    // ＋ New agent's two columns: the search box has the focus. ↑/↓ move in the CLI list, or in the
    // model column once → entered it (or while a search shows results); ← goes back; Enter picks
    // the highlighted row; every other key types into the search.
    if (menuSel === newSel) {
      const inSide = sideAt >= 0,
        list = sideRows(),
        box2 = menu.querySelector('.tnai-pick-find input'),
        atEnd = box2.selectionStart === box2.value.length;
      if (e.target.closest?.('.tnai-pick-more,.tnai-pick-eff') && (k === 'Enter' || k === ' '))
        return; // its own click
      if (k === 'ArrowDown' || k === 'ArrowUp') {
        if (inSide)
          setSide(Math.max(0, Math.min(list.length - 1, sideAt + (k === 'ArrowDown' ? 1 : -1))));
        else {
          setActive(step(active, k === 'ArrowDown' ? 1 : -1), true);
          paintSide();
        }
      } else if (k === 'ArrowRight' && !inSide && atEnd && list.length)
        setSide(
          Math.max(
            0,
            list.findIndex(r => r.getAttribute('aria-selected') === 'true')
          )
        );
      else if (k === 'ArrowLeft' && inSide && !findText()) setSide(-1);
      else if (k === 'Enter') {
        if (inSide && list[sideAt])
          pickModel(list[sideAt].dataset.agent, list[sideAt].dataset.model);
        else choose(active);
      } else if (k === 'Escape') close(true);
      else if (k === 'Tab')
        return; // on to All models… / the effort chips; leaving the menu closes it (focusout)
      else return;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp')
      setActive(step(active, k === 'ArrowDown' ? 1 : -1), true);
    else if (k === 'Home') setActive(step(-1, 1), true);
    else if (k === 'End') setActive(step(rows.length, -1), true);
    else if (k === 'PageDown' || k === 'PageUp') {
      let i = active;
      for (let n = 0; n < 8; n++) i = step(i, k === 'PageDown' ? 1 : -1);
      setActive(i, true);
    } else if (k === 'Enter' || k === ' ') choose(active);
    else if (k === 'Escape') close(true);
    else if (k === 'Tab') {
      close(true);
      return;
    } // focus is back on the button; Tab then moves on from it
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type to jump
      typed = (Date.now() - typedAt > 700 ? '' : typed) + k.toLowerCase();
      typedAt = Date.now();
      const name = r => r._opt.textContent.replace(/^＋\s*/, '').toLowerCase();
      const i = rows.findIndex(
        (r, j) =>
          !r._opt.disabled &&
          j >= (typed.length > 1 ? active : active + 1) &&
          name(r).startsWith(typed)
      );
      const wrap = i >= 0 ? i : rows.findIndex(r => !r._opt.disabled && name(r).startsWith(typed));
      if (wrap >= 0) setActive(wrap, true);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });
  menu.addEventListener('mousedown', e => {
    if (!e.target.closest('.tnai-pick-find')) e.preventDefault();
  }); // keeps focus in the menu while clicking a row (the search box takes its own clicks)
  menu.addEventListener('input', e => {
    if (e.target.closest('.tnai-pick-find')) paintSide();
  });
  menu.addEventListener('click', e => {
    const m = e.target.closest('.tnai-pick-mopt'),
      more = e.target.closest('.tnai-pick-more'),
      eff = e.target.closest('.tnai-pick-eff');
    if (m && e.target.closest('.tnai-pick-fav')) {
      toggleFav(m.dataset.agent, m.dataset.model);
      const side = menu.querySelector('.tnai-pick-side'),
        at = side?.scrollTop || 0;
      paintSide();
      if (side && findText()) side.scrollTop = at;
    } // the star: keep the menu open, pick nothing
    else if (m) pickModel(m.dataset.agent, m.dataset.model);
    else if (more) {
      showAll[more.dataset.agent] = !showAll[more.dataset.agent];
      paintSide();
      menu.querySelector('.tnai-pick-more')?.focus({ preventScroll: true });
      place();
    } else if (eff) {
      const a = eff.dataset.agent,
        v = eff.dataset.effort;
      setPref(a, 'effort', prefs[a]?.effort === v ? '' : v);
      paintSide();
      menu
        .querySelector('.tnai-pick-eff[data-effort="' + CSS.escape(v) + '"]')
        ?.focus({ preventScroll: true });
    }
  });
  menu.addEventListener('click', e => {
    const x = e.target.closest('.tnai-pick-extra');
    if (!x) return;
    const real = menu.ownerDocument.querySelector(
      x.dataset.extra === 'new' ? '.tnai-new-agent' : '.tnai-composer-pop'
    );
    close(false);
    real?.click();
  });

  // The two-column menu changes its CLI on a click only (hovering must not
  // swap it on a slight movement): a click on another CLI row highlights it and shows its models; a
  // click on the highlighted row picks that CLI.
  menu.addEventListener('click', e => {
    const r = e.target.closest('.tnai-pick-opt'),
      i = rows.indexOf(r);
    if (!r) return;
    if (menuSel === newSel && i !== active && !r._opt.disabled && !findText()) {
      setActive(i, false);
      setSide(-1);
      paintSide();
      return;
    }
    choose(i);
  });
  menu.addEventListener('mousemove', e => {
    // one-column menus: the highlight follows the pointer, as in any menu
    if (menuSel === newSel) return;
    const r = e.target.closest('.tnai-pick-opt'),
      i = rows.indexOf(r);
    if (i >= 0 && i !== active && !r._opt.disabled) setActive(i, false);
  });
  menu.addEventListener('focusout', e => {
    if (!redrawing && !menu.contains(e.relatedTarget)) close(false);
  });
  selects.forEach(sel => {
    const b = btnOf(sel);
    const isOpen = () => menuSel === sel || (sel === modelSel && !!menuSub);
    const show = () => {
      if (sel === modelSel && (!sel.disabled || sel._busyOnly || farCount() > 0) && openModels())
        return;
      open(sel);
    };
    b.addEventListener('mousedown', e => {
      if (isOpen()) e.preventDefault();
    }); // a click on the open one's button closes it
    b.addEventListener('click', () => {
      if (isOpen()) close(true);
      else show();
    });
    b.addEventListener('keydown', e => {
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !isOpen()) {
        e.preventDefault();
        show();
      }
    });
    sel.addEventListener('change', () => sync(sel)); // also a value set in code
  });

  const esc = s =>
    String(s ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // A select is refilled only when its options changed: this repaints on every agent session change
  // while agents work.
  const fill = (sel, html) => {
    if (sel._html === html && sel.selectedIndex === sel._idx) return;
    sel._html = html;
    sel.innerHTML = html;
    sel._idx = sel.selectedIndex;
  }; // a pick that was refused still snaps back
  const opt = (value, label, selected, disabled) =>
    `<option value="${esc(value)}"${selected ? ' selected' : ''}${disabled ? ' disabled' : ''}>${esc(label)}</option>`;
  const busy = paneId => {
    const t = window.TnaiTurns?.get(paneId);
    return !!(t && t.startedAt && !t.endedAt);
  };

  // "Your terminal" (136) is the user's own shell, never an agent to send a prompt to: it is left
  // out of the picker's lists and of the row of agents' marks.
  const notOwnTerminal = s => !window.TnaiOwnTerminal?.owns?.(s.paneId);
  const running = () =>
    agents.sessions().filter(s => s.running && s.mode !== 'login' && notOwnTerminal(s));

  // What the model/effort dropdowns act on: a running agent (switched live through its own /model,
  // /effort) or the CLI of the next new agent.
  function subject() {
    const next = live.newAgent(),
      opts = live.startOptions?.() || [];
    if (next) return { kind: 'new', agent: next };

    // An agent on another computer is the composer's target (164, plan item 44): its model and
    // effort are switched there; `far` holds its name, computer and the reasons for what cannot be.
    const far = window.TnaiRemoteThreadMore?.subject?.() || null;
    if (far && far.agent) return { kind: 'remote', agent: far.agent, far };
    const s = running().find(x => x.paneId === live.target());
    if (s) return { kind: 'live', agent: s.agent, session: s };
    const pick = live.startChoice?.() || null;
    return { kind: 'new', agent: pick?.agent || 'Claude Code', auto: true };
  }

  function paintAgent() {
    const next = live.newAgent(),
      target = live.target(),
      opts = live.startOptions?.() || [],
      info = agents.info();
    const nextKey = next
      ? next + '|' + (live.newAccount?.() || opts.find(o => o.agent === next)?.accountId || '')
      : '';
    const rows = running();

    // running or stopped (listed below)
    const onPane =
      !next &&
      agents.sessions().some(s => s.paneId === target && s.mode !== 'login' && notOwnTerminal(s));
    let html = opt(
      'auto',
      'Auto · ' + (live.startChoice?.()?.agent || 'Claude Code'),
      !next && !onPane
    ); // shows the CLI Auto starts
    if (rows.length)
      html +=
        '<optgroup label="Running">' +
        rows
          .map(s => opt('pane:' + s.paneId, s.name + ' · ' + s.agent, !next && s.paneId === target))
          .join('') +
        '</optgroup>';

    // Stopped agents too, as a place to pick one specific agent to talk to:
    // picked, the send starts it and it gets the prompt (11 'wake').
    const asleep = agents
      .sessions()
      .filter(
        s =>
          !s.running &&
          s.mode !== 'login' &&
          notOwnTerminal(s) &&
          !s.error?.includes('not installed')
      );
    if (asleep.length)
      html +=
        '<optgroup label="Stopped · starts when you send">' +
        asleep
          .map(s => opt('pane:' + s.paneId, s.name + ' · ' + s.agent, !next && s.paneId === target))
          .join('') +
        '</optgroup>';
    html +=
      '<optgroup label="New agent">' +
      NEW_AGENTS.map(id => {
        const mine = opts.filter(o => o.agent === id);
        if (mine.length)
          return mine.map(o => opt('new:' + o.key, '＋ ' + o.label, o.key === nextKey)).join('');
        const a = info.find(x => x.id === id);
        return opt(
          '',
          '＋ ' + id + (!a?.installed ? ' · not installed' : ' · not signed in'),
          false,
          true
        );
      }).join('') +
      '</optgroup>';
    fill(agentSel, html);
    agentSel.title =
      'Which agent gets this prompt. Auto: the selected agent, else the only running one, else it starts ' +
      subject().agent +
      '.';
  }

  // The short list, rule-based from the CLI's own list: the newest model of each family (the CLI's
  // group, else the id without its version numbers; also when the CLI's list has one group only),
  // the base model over its variants (shortest label on a tie), at most SHORT_MAX families (the
  // biggest ones).
  const SHORT_MAX = 8;
  const versionOf = id =>
    (id.match(/\d+(?:\.\d+)*/g) || [])
      .filter(n => n.length < 8)
      .flatMap(n => n.split('.').map(Number)); // 8-digit dates left out
  const newer = (a, b) => {
    const x = versionOf(a.id),
      y = versionOf(b.id);
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) > (y[i] ?? -1);
    return a.label.trim().length < b.label.trim().length;
  }; // the base model: its label has no effort/speed words

  function shortList(models, agent) {
    const families = new Map();
    const oneGroup = new Set(models.map(m => m.group)).size < 2;
    if (agent === 'OpenCode' && !oneGroup) return openCodeShort(models);
    models.forEach(m => {
      const f = (!oneGroup && m.group) || m.id.replace(/\d+(?:\.\d+)*/g, '');
      if (!families.has(f)) families.set(f, []);
      families.get(f).push(m);
    });
    const kept = [...families.values()]
      .sort((a, b) => b.length - a.length)
      .slice(0, SHORT_MAX)
      .map(list => list.reduce((best, m) => (newer(m, best) ? m : best)));
    return models.filter(m => kept.includes(m));
  }

  // OpenCode with more than one provider (its groups are providers, and a gateway lists hundreds of
  // unrelated models, so "the newest of the biggest families" says nothing): each provider's newest
  // models that are not deprecated, by release date, one provider after the other, up to SHORT_MAX.
  // Favorites and the last picks already lead the list. With one provider (its free models) the
  // list above is unchanged.
  function openCodeShort(models) {
    const live = models.some(m => !m.deprecated) ? models.filter(m => !m.deprecated) : models,
      by = new Map();
    live.forEach(m => {
      if (!by.has(m.group)) by.set(m.group, []);
      by.get(m.group).push(m);
    });
    const lists = [...by.values()].map(list =>
      list.slice().sort((a, b) => (b.released || '').localeCompare(a.released || ''))
    );
    const kept = [];
    for (let i = 0; kept.length < SHORT_MAX && lists.some(list => list[i]); i++)
      for (const list of lists) if (list[i] && kept.length < SHORT_MAX) kept.push(list[i]);
    return models.filter(m => kept.includes(m));
  }
  const showAll = {}; // CLI -> the full list is open (All models…), for this run

  // Favorite models (Cursor Agent lists hundreds): the star on a model row
  // keeps it in a Favorites group on top of that CLI's list. Kept per CLI in this browser profile;
  // ids a CLI no longer lists just don't show.
  const FAV_KEY = 'tnai.model-favorites.v1';
  let favs = {};
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || '{}');
    if (v && typeof v === 'object' && !Array.isArray(v)) favs = v;
  } catch {}
  const isFav = (agent, id) => Array.isArray(favs[agent]) && favs[agent].includes(id);

  function toggleFav(agent, id) {
    const list = Array.isArray(favs[agent]) ? favs[agent] : [];
    favs[agent] = list.includes(id) ? list.filter(x => x !== id) : [...list, id].slice(-50);
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    } catch {}
  }

  // Friendly name plus the exact id the CLI gets; the short list first, "All models…" opens the
  // full list grouped by family/provider.
  function modelOptions(agent, all, current) {
    const one = m => opt(m.id, m.label === m.id ? m.id : m.label + ' · ' + m.id, m.id === current);
    const short = shortList(all, agent);
    if (!showAll[agent] && short.length < all.length) {
      // a model picked earlier stays visible
      const picked = all.find(m => m.id === current && !short.includes(m));
      return (
        [...short, ...(picked ? [picked] : [])].map(one).join('') +
        unlisted(all, current) +
        opt('all', 'All models… (' + all.length + ')')
      );
    }
    return (
      groupedOptions(all, one) +
      unlisted(all, current) +
      (short.length < all.length ? opt('fewer', 'Fewer models') : '')
    );
  }

  // The last pick stays shown even when the CLI's list no longer has it (a renamed or retired id),
  // instead of falling back to "Default model".
  function unlisted(all, current) {
    return current && !all.some(m => m.id === current) ? opt(current, current, true) : '';
  }

  function groupedOptions(models, one) {
    if (!models.some(m => m.group)) return models.map(one).join('');
    const groups = new Map();
    models.forEach(m => {
      const g = m.group || 'Other';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    });
    return [...groups]
      .map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(one).join('')}</optgroup>`)
      .join('');
  }

  // Model and Effort for an agent on another computer (164, plan item 44): the CLI's list as this
  // computer knows it, nothing shown as picked (that computer's own choice is not sent here), and
  // what that CLI cannot switch from here greyed with the reason.
  function paintRemote(sub, cat) {
    const far = sub.far;
    const models = cat?.models || [];
    const efforts = cat?.efforts || [];
    modelSel._busyOnly = false;
    if (far.why.model || !models.length) {
      fill(modelSel, opt('', 'Model…', true));
      modelSel.disabled = true;
    } else {
      fill(modelSel, opt('', 'Model…', true) + modelOptions(sub.agent, models, ''));
      modelSel.disabled = false;
    }
    modelSel.title = far.why.model || 'Switch ' + far.name + '’s model on ' + far.pc + ' (/model)';
    if (far.why.effort || !efforts.length) {
      fill(effortSel, opt('', 'Effort…', true));
      effortSel.disabled = true;
    } else {
      fill(effortSel, opt('', 'Effort…', true) + efforts.map(e => opt(e, EFFORT[e] || e)).join(''));
      effortSel.disabled = false;
    }
    effortSel.title =
      far.why.effort || 'Switch ' + far.name + '’s effort on ' + far.pc + ' (/effort)';
  }

  function paintModel() {
    const sub = subject(),
      cat = modelsOf(sub.agent),
      prefsNow = window.TnaiLaunchPrefs.for(sub.agent);
    if (sub.kind === 'remote') return paintRemote(sub, cat);
    const models = cat?.models || [];
    const current = sub.kind === 'live' ? '' : prefsNow.model;
    const livePick =
      sub.kind === 'live' ? window.TnaiLaunchPrefs.pane(sub.session.paneId, sub.agent) : null;
    const liveNote =
      sub.kind === 'live'
        ? window.TnaiTurns?.get(sub.session.paneId)?.model || livePick.model || prefsNow.model
        : '';
    const wait =
      sub.kind === 'live' && busy(sub.session.paneId)
        ? 'Wait until ' + sub.session.name + ' finishes its task to switch.'
        : '';

    // Codex and Cursor Agent switch in their own picker
    const picker = sub.kind === 'live' && sub.agent !== 'Claude Code';
    if (!cat) {
      fill(modelSel, opt('', 'Model…', true));
      modelSel.disabled = true;
    } else if (picker) {
      fill(
        modelSel,
        opt('', 'Model' + (liveNote ? ': ' + liveNote : '') + '…', true) +
          opt('picker', 'Choose on its CLI screen…')
      );
      modelSel.disabled = !!wait;
    } else {
      fill(
        modelSel,
        (sub.kind === 'live'
          ? opt('', liveNote ? 'Model: ' + liveNote : 'Model…', true)
          : opt('', 'Default model', !current)) +
          modelOptions(sub.agent, models, sub.kind !== 'live' && current)
      );
      modelSel.disabled = !!wait || !models.length;
    }

    // Disabled only because its agent is working: the pill stays clickable for the other CLIs'
    // models, its own rows are grayed in the menu.
    modelSel._busyOnly = !!wait && !!cat && (picker || models.length > 0);
    modelSel.title =
      (wait && modelSel._busyOnly ? wait + ' Models for a new agent can still be picked.' : wait) ||
      (sub.kind === 'live'
        ? 'Switch ' +
          sub.session.name +
          '’s model now (' +
          sub.agent +
          (picker ? '’s own model picker)' : ' /model)')
        : 'Model new ' + sub.agent + ' agents start on');

    // Effort: the chosen model's levels when the CLI lists them per model (Codex), else the CLI's
    // levels; Cursor has none (it is in the model id).
    const model = models.find(m => m.id === (sub.kind === 'live' ? liveNote : current));
    const efforts = model?.efforts?.length ? model.efforts : cat?.efforts || [];
    const effortNow = sub.kind === 'live' ? '' : prefsNow.effort;
    if (!cat || !efforts.length) {
      fill(effortSel, opt('', 'Effort…', true));
      effortSel.disabled = true;
      effortSel.title = !cat
        ? ''
        : sub.agent === 'OpenCode'
          ? cat.effortWhy === 'off'
            ? 'OpenCode sets effort inside its own terminal (Ctrl+T); Technically Not does not set it'
            : cat.effortWhy === 'nolink'
              ? 'Technically Not’s link to OpenCode is off, so its effort is set on its CLI screen (Ctrl+T)'
              : model
                ? (model.label || model.id) + ' has no effort levels'
                : 'OpenCode’s effort levels belong to a model: pick a model that has them'
          : sub.agent + ' sets effort through its model choice';
      return;
    }

    // A running OpenCode panel: what its own link and OpenCode's saved level say (effortTruth), not
    // only what was picked. Link off for this panel or the stepping failed: the picked level is not
    // claimed, and the hint says so.
    const truth = picker && sub.agent === 'OpenCode' ? effortTruth(sub.session.paneId) : null;
    const unset = truth
      ? truth.linked === false
        ? 'Technically Not’s link to this OpenCode thread is off, so no effort was set from here: it runs at the level OpenCode itself has (Ctrl+T on its CLI screen)'
        : truth.set === false
          ? 'The picked effort (' +
            (EFFORT[truth.want] || truth.want) +
            ') could not be set in OpenCode: it runs at ' +
            (truth.now ? EFFORT[truth.now] || truth.now : 'the level OpenCode itself has') +
            ' (Ctrl+T on its CLI screen)'
          : ''
      : '';
    const liveEffort = truth
      ? unset
        ? truth.now || ''
        : truth.now || livePick.effort
      : livePick?.effort;
    if (picker) {
      fill(
        effortSel,
        opt(
          '',
          liveEffort ? 'Effort: ' + (EFFORT[liveEffort] || liveEffort) + '…' : 'Effort…',
          true
        ) + opt('picker', 'Choose on its CLI screen…')
      );
      effortSel.disabled = !!wait;
    } else {
      fill(
        effortSel,
        (sub.kind === 'live'
          ? opt(
              '',
              livePick.effort
                ? 'Effort: ' + (EFFORT[livePick.effort] || livePick.effort)
                : 'Effort…',
              true
            )
          : opt('', 'Default effort', !effortNow)) +
          efforts.map(e => opt(e, EFFORT[e] || e, sub.kind !== 'live' && e === effortNow)).join('')
      );
      effortSel.disabled = !!wait;
    }
    effortSel.title =
      wait ||
      unset ||
      (sub.kind === 'live'
        ? 'Switch ' +
          sub.session.name +
          '’s effort now' +
          (picker ? ' (its own picker)' : ' (/effort)')
        : 'Effort new ' + sub.agent + ' agents start with') +
        (!wait && cat.effortNote ? '. ' + cat.effortNote : '');
  }

  // Access: the project's level for the CLI the next agent starts as; levels that CLI has no flag
  // for are greyed out with the reason. On a running agent a pick is still the project's level:
  // that agent keeps what it started with until it next starts a new conversation.
  function paintAccess() {
    // another computer's agent: access is that computer's own (164, plan item 44)
    if (subject().kind === 'remote') {
      const far = subject().far;
      fill(accessSel, opt('', 'Access', true));
      accessSel.disabled = true;
      accessSel.title = far.why.access;
      return;
    }
    const sub = subject(),
      info = accessInfo[sub.agent],
      now = levelNow(),
      // a running agent held at "Ask first" shows its own level, not the project's
      held = sub.kind === 'live' && heldPanes.has(sub.session.paneId),
      shown = held ? 'ask' : hasLevel(sub.agent, now) ? now : 'default';
    fill(
      accessSel,
      ACCESS.map(l => {
        const ok = hasLevel(sub.agent, l);
        return `<option value="${l}" data-pill="${esc(l === 'default' ? 'Access' : ACCESS_LABEL[l])}" title="${esc(ok ? ACCESS_LABEL[l] + ': ' + ACCESS_HINT[l] : info?.why?.[l] || '')}"${l === shown ? ' selected' : ''}${ok ? '' : ' disabled'}>${esc(ACCESS_LABEL[l] + ' · ' + (ok ? ACCESS_HINT[l] : 'not in ' + sub.agent))}</option>`;
      }).join('')
    );
    accessSel.disabled = !info; // the levels are not read yet
    const started = sub.kind === 'live' ? paneAccess[sub.session.paneId] : '';
    if (held) {
      accessSel.title =
        sub.session.name +
        ' was started from another computer, so it always runs at Ask first. A pick here changes the project’s level for new agents.';
      return;
    }
    accessSel.title =
      (now !== shown
        ? ACCESS_LABEL[now] +
          ' is not available here: ' +
          (info?.why?.[now] || '') +
          '. ' +
          sub.agent +
          ' starts with its own settings. '
        : '') +
      (sub.kind === 'live'
        ? sub.session.name +
          (started
            ? ' started with ' + ACCESS_LABEL[started]
            : ' keeps the access it started with') +
          '. A change takes effect when it next starts a new conversation.'
        : 'How much new agents in this project may do without asking. Set when an agent starts.');
  }

  function paint() {
    paintTo();

    // Leave an open menu alone; it repaints when it closes.
    if (menuSel) return;
    paintAgent();
    paintModel();
    paintAccess();
    syncAll();
  }

  // Your agents as small avatars at the start of the hint row, a way to pick an
  // agent directly without changing the model or Auto: a click sends the next prompt to that
  // agent (a stopped one starts, 11 'wake'); clicking the picked one goes back to Auto. Only the
  // target changes: the model, effort and new-agent picks stay as they are.
  const toRow = document.createElement('div');
  toRow.className = 'tnai-to';
  toRow.setAttribute('role', 'group');
  toRow.setAttribute('aria-label', 'Send to agent');
  hints.prepend(toRow);
  let toKey = '';

  function paintTo() {
    // One agent order everywhere (91): the tiles follow the Terminal page's panel order, like the
    // Agent Tree (94) and the Agents list (25).
    const order = new Map(
      [...document.querySelectorAll('.terminal-pane[data-pane-id]')].map((p, i) => [
        p.dataset.paneId,
        i,
      ])
    );
    const list = agents
        .sessions()
        .filter(s => s.mode !== 'login' && notOwnTerminal(s))
        .sort((a, b) => (order.get(a.paneId) ?? 1e9) - (order.get(b.paneId) ?? 1e9)),
      // a new agent, here or on another computer: no chip is the target
      t = live.newAgent() || live.newFar?.() ? '' : live.target() || '';
    const col = name => window.TnaiAgentMarks?.agentColor?.(name) || 'var(--pg-accent)';
    const html = list
      .map(s => {
        const on = s.paneId === t;
        return `<button type="button" class="tnai-to-av${on ? ' on' : ''}${s.running ? '' : ' off'}" data-to="${esc(s.paneId)}" aria-pressed="${on}" style="--c:${col(s.name)}" title="${esc(s.name)} · ${esc(s.agent)}${s.running ? '' : ' · stopped: starts when you send'}. ${on ? 'Click again: back to Auto' : 'Click: send your next prompt to it'}">${esc((String(s.name || '?').trim()[0] || '?').toUpperCase())}</button>`;
      })
      .join('');
    if (html === toKey) return;
    toKey = html;
    toRow.innerHTML = html;
    toRow.hidden = !list.length;
  }
  toRow.addEventListener('click', e => {
    const b = e.target.closest('[data-to]');
    if (!b) return;
    live.newAgent(false);
    live.setTarget(b.classList.contains('on') ? null : b.dataset.to);
    document.getElementById('prompt')?.focus({ preventScroll: true });
  });

  function fillNew() {
    const opts = live.startOptions?.() || [],
      info = agents.info(),
      def = live.startChoice?.()?.key || '';
    let far = [];
    try {
      far = window.TnaiRemoteAgents?.starts?.() || [];
    } catch {
      far = [];
    }
    const chosen = live.newFar?.()?.key || '';
    newSel.innerHTML =
      NEW_AGENTS.map(id => {
        if (!info.find(x => x.id === id)?.installed) return '';
        const mine = opts.filter(o => o.agent === id);
        return mine.length
          ? mine
              .map(o =>
                opt('new:' + o.key, o.label + (o.key === def ? ' · default' : ''), o.key === def)
              )
              .join('')
          : opt('', id + ' · not signed in', false, true);
      }).join('') +
      // A new agent on another paired computer (116 `starts`: only where that computer says it can
      // start that CLI for the project open here; none with connecting off, so the menu is then
      // exactly as before). Names are that computer's text: `opt` sets them as text.
      (far.length
        ? '<optgroup label="On another computer">' +
          far.map(o => opt('far:' + o.key, o.label + ' · asks first', o.key === chosen)).join('') +
          '</optgroup>'
        : '');
  }
  newSel.addEventListener('change', () => {
    const v = newSel.value;
    if (v.startsWith('far:')) {
      window.TnaiRemoteAgents?.chooseStart?.(v.slice(4));
      paint();
      prompt.focus();
      return;
    } // 116 checks it again and tells the composer (11 `newFar`)
    if (!v.startsWith('new:')) return;
    const [agent, accountId] = v.slice(4).split('|');
    live.startPick?.(agent + '|' + accountId);
    live.newAgent(agent, accountId); // same as the agent menu's New agent rows
    paint();
    prompt.focus();
  });

  // Typed like the user would, so the CLI treats it as its own slash command.
  function slash(s, command) {
    native.pty.submit(s.paneId, command, { paste: false }).catch(() => {});
  }

  agentSel.addEventListener('change', () => {
    const v = agentSel.value;
    if (v === 'auto') {
      live.newAgent(false);
      live.setTarget(null);
    } else if (v.startsWith('pane:')) {
      live.newAgent(false);
      live.setTarget(v.slice(5));
    } else if (v.startsWith('new:')) {
      const [agent, accountId] = v.slice(4).split('|');
      live.startPick?.(agent + '|' + accountId);
      live.newAgent(agent, accountId);
    }
    agentSel.blur();
    paint();
    prompt.focus();
  });

  // A running agent's model or effort, switched now through its own slash command (also from the
  // Model pill's two-column menu).
  function switchLive(s, key, v) {
    if (!v || !s.running || busy(s.paneId)) return paint();
    if (v === 'picker') {
      slash(s, s.agent === 'OpenCode' ? (key === 'effort' ? '/variants' : '/models') : '/model');

      /* OpenCode's own lists: its TUI commands model.list and variant.list */ window.TnaiLiveTasks?.focusPane?.(
        s.paneId
      );
      window.toast?.(s.name + ': choose on its CLI screen');
    } else {
      slash(s, '/' + key + ' ' + v);
      window.toast?.(s.name + ' → ' + (key === 'effort' ? (EFFORT[v] || v) + ' effort' : v));
      setPanePick(s.paneId, s.agent, key, v);

      // this agent keeps it, and it is the composer's last pick for new ones
      setPref(s.agent, key, v);

      // an older reply's effort must not undo this pick
      if (key === 'effort') setPanePick(s.paneId, s.agent, 'effortAt', Date.now());
    }
    setTimeout(paint, 300);
  }

  function onPick(sel, key) {
    const sub = subject(),
      v = sel.value;
    sel.blur();
    if (sub.kind === 'live') return switchLive(sub.session, key, v);

    // another computer's agent: switched there (164, plan item 44)
    if (sub.kind === 'remote') {
      window.TnaiRemoteThreadMore?.pick?.(sub.far, key, v);
      return paint();
    }
    setPref(sub.agent, key, v);

    // A model with its own effort levels (Codex) drops an effort it does not offer.
    if (key === 'model') {
      const m = catalog[sub.agent]?.models.find(x => x.id === v);
      if (
        m?.efforts?.length &&
        prefs[sub.agent].effort &&
        !m.efforts.includes(prefs[sub.agent].effort)
      )
        setPref(sub.agent, 'effort', '');
    }
    paint();
  }
  modelSel.addEventListener('change', () => {
    const v = modelSel.value;
    if (v !== 'all' && v !== 'fewer') return onPick(modelSel, 'model');

    // Open or close the full list.
    showAll[subject().agent] = v === 'all';
    paintModel();
    syncAll();
    if (v === 'all' && picking) open(modelSel); // picked in the menu: it reopens on the full list
  });
  effortSel.addEventListener('change', () => onPick(effortSel, 'effort'));
  accessSel.addEventListener('change', () => {
    const v = accessSel.value,
      sub = subject();
    accessSel.blur();
    if (!ACCESS.includes(v)) return paint();
    setLevel(v);
    if (sub.kind === 'live')
      window.toast?.(
        'Access set to ' +
          ACCESS_LABEL[v] +
          '. It takes effect when ' +
          sub.session.name +
          ' next starts a new conversation.'
      );
    paint();
  });

  // Settings › Agents › While agents work: the level for projects without their own pick (beside
  // the other start-time rows: 63, 84, 89).
  const workCard = document.getElementById('agentsWorkCard');
  if (workCard) {
    workCard.insertAdjacentHTML(
      'beforeend',
      `<label class="set-row tnai-access-row"><span class="set-text"><b>Access for new agents</b><small title="Set when an agent starts. A level an agent's CLI has no flag for is greyed out under the composer, and that CLI starts with its own settings. Technically Not's own tools keep working at every level.">How much agents may do without asking. A project you picked a level for under the composer keeps its own. Applies to new agents.</small></span><span class="set-ctl"><select class="set-input" aria-label="Access for new agents">${ACCESS.map(l => `<option value="${l}">${esc(ACCESS_LABEL[l] + ' · ' + ACCESS_HINT[l])}</option>`).join('')}</select></span></label>`
    );
    const def = workCard.querySelector('.tnai-access-row select');
    def.value = accessDefault;
    def.addEventListener('change', () => {
      accessDefault = ACCESS.includes(def.value) ? def.value : 'default';
      try {
        localStorage.setItem(ACCESS_DEFAULT_KEY, accessDefault);
      } catch {}
      paint();
    });
  }
  native.agents
    .access?.()
    .then(list => {
      (Array.isArray(list) ? list : []).forEach(c => {
        if (c?.id)
          accessInfo[c.id] = {
            levels: Array.isArray(c.levels) ? c.levels : ['default'],
            why: c.why || {},
          };
      });
      paint();
    })
    .catch(() => {});
  native.fs
    ?.root?.()
    .then(r => {
      root = r || '';
      paint();
    })
    .catch(() => {});
  window.addEventListener('tnai:project-changed', e => {
    root = e.detail?.root || '';
    paint();
  });

  // The model an agent's turn actually ran on is its model from now on (covers a /model typed in
  // its own terminal).
  native.agentTurns?.on?.(t => {
    if (!t?.paneId || !t.agent || t.cleared) return;
    if (t.model) setPanePick(t.paneId, t.agent, 'model', t.model);

    // The effort its replies actually ran at (covers /effort typed in its terminal and the CLI's
    // own default), unless picked here since.
    if (t.effort && !((paneFor(t.paneId, t.agent)?.effortAt || 0) > (t.effortAt || 0)))
      setPanePick(t.paneId, t.agent, 'effort', t.effort);
    soon();
  });

  // Pushed changes arrive in bursts (several agents at once): at most one repaint per frame.
  let frame = 0;
  const soon = () => {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
  };
  agents.onChange(soon);
  [
    'tnai:target-changed',
    'tnai:accounts-changed',
    'tnai:new-agent-changed',
    'tnai:terminal-panes-reordered',
    'tnai:remote-starts' /* 116: what another computer can start from here changed */,
  ].forEach(name => window.addEventListener(name, paint));
  agents
    .detect?.()
    .then(paint)
    .catch(() => {});
  paint();
})();
