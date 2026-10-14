// Technically Not · 17-custom-agents.js — Desktop app only: custom agents (a name the user chooses,
// a base CLI, an account, a role, and attached skills) and the skill library API. Exposes
// window.TnaiCustomAgents and window.TnaiSkills; renders "+ Custom agent" and the Custom agents
// strip on Overview.
(() => {
  const native = window.tnaiNative,
    agentsApi = window.TnaiAgents,
    page = document.getElementById('agentPage');
  if (!native?.skills || !agentsApi || !page) return;
  const header = page.querySelector('.agent-page-header');
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  let skills = [],
    agents = [],
    problems = [],
    // skillClis: CLIs that can load skills per session (from the registry); problems: agent files
    // that could not be read
    skillClis = ['Claude Code'];
  const listeners = new Set();
  const changed = () => {
    listeners.forEach(fn => {
      try {
        fn();
      } catch {}
    });
    window.dispatchEvent(new CustomEvent('tnai:custom-agents-changed'));
    renderStrip();
  };
  const unwrap = result => {
    if (!result?.ok) throw new Error(result?.error?.message || 'The desktop app did not answer.');
    return result.value;
  };

  async function refresh() {
    try {
      const data = unwrap(await native.skills.list());
      skills = data.skills;
      agents = data.agents;
      problems = data.agentProblems || [];
      skillClis = data.skillClis || skillClis;
    } catch (error) {
      console.warn('Technically Not skills:', error.message);
    }
    changed();
  }

  // ---- Names: exactly what the user typed (trimmed), never auto-suffixed, unique across custom
  // agents and open panes ----
  function paneNames(exceptAgentId) {
    return agentsApi
      .sessions()
      .filter(s => !exceptAgentId || s.customAgentId !== exceptAgentId)
      .map(s => s.name)
      .concat(
        [...document.querySelectorAll('.terminal-pane')]
          .filter(p => !exceptAgentId || !paneOfAgent(exceptAgentId, p))
          .map(p => p.querySelector('.terminal-pane-title')?.textContent || '')
      );
  }
  const paneOfAgent = (agentId, pane) =>
    agentsApi.sessions().some(s => s.paneId === pane.dataset.paneId && s.customAgentId === agentId);

  function checkPaneClash(name, exceptAgentId) {
    const clean = String(name || '')
      .trim()
      .toLowerCase();
    const clash = paneNames(exceptAgentId).find(n => n.trim().toLowerCase() === clean);
    if (clash)
      throw new Error('A thread is already named “' + clash + '”. Choose a different name.');
  }

  // Pane title shown on Terminal and stored with the pane (04 saves `tnai.terminals.v1`).
  function titlePanes(agentId, name) {
    agentsApi
      .sessions()
      .filter(s => s.customAgentId === agentId)
      .forEach(s => {
        const pane = document.querySelector(
          '.terminal-pane[data-pane-id="' + CSS.escape(s.paneId) + '"]'
        );
        const title = pane?.querySelector('.terminal-pane-title'),
          previous = title?.textContent || '';
        if (title) title.textContent = name;
        const record = window.TnaiTerminalPaneRecords?.find(r => r.id === s.paneId);
        if (record) record.name = name;
        try {
          const saved = JSON.parse(localStorage.getItem('tnai.terminals.v1') || '[]');
          const item = saved.find(p => p.id === s.paneId);
          if (item) {
            item.name = name;
            localStorage.setItem('tnai.terminals.v1', JSON.stringify(saved));
          }
        } catch {}

        // Everything that names panels (the mesh's `tnai agents`/`tnai send` names, 37; mirrors and
        // chips) follows at once.
        if (previous !== name)
          window.dispatchEvent(
            new CustomEvent('tnai:terminal-pane-renamed', {
              detail: { paneId: s.paneId, name, previous },
            })
          );
      });
  }

  const paneFor = agentId => {
    const mine = agentsApi.sessions().filter(s => s.customAgentId === agentId);
    return mine.find(s => s.running) || mine[0] || null;
  };
  const withPane = agent => {
    const s = paneFor(agent.id);
    return { ...agent, paneId: s?.paneId || null, running: !!s?.running };
  };

  // Skills load when the CLI starts. A custom agent is the user's: Technically Not never restarts
  // it by itself. A running one gets the change on its next start, and a small note offers "Restart
  // now" (same pane, conversation resumed when the CLI saved one).
  const restartNote = document.createElement('div');
  restartNote.className = 'tnai-restart-note';
  restartNote.hidden = true;
  restartNote.setAttribute('role', 'status');
  restartNote.innerHTML =
    '<span></span><button type="button" data-act="restart">Restart now</button><button type="button" data-act="dismiss" title="Dismiss" aria-label="Dismiss">×</button>';
  document.body.append(restartNote);
  let noteTimer = 0;
  const hideNote = () => {
    restartNote.hidden = true;
    clearTimeout(noteTimer);
  };

  async function restartNow(paneId) {
    const s = agentsApi.sessions().find(x => x.paneId === paneId);
    if (!s) return { ok: false, error: 'That agent is no longer open.' };
    const result = await agentsApi.restart(paneId, { resume: true });
    say(
      result?.ok
        ? s.name +
            ' restarted · ' +
            (result.resumed
              ? 'conversation resumed'
              : 'started fresh (no saved conversation to resume)')
        : 'Could not restart ' + s.name + ': ' + (result?.error || 'unknown error')
    );
    return result;
  }

  function needsRestart(agentId) {
    const s = agentsApi.sessions().find(x => x.customAgentId === agentId && x.running);
    if (!s) return null;
    restartNote.querySelector('span').textContent =
      s.name + ': skills change applies on next start';
    restartNote.dataset.pane = s.paneId;
    restartNote.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(hideNote, 15000);
    return { pending: true, paneId: s.paneId };
  }
  restartNote.addEventListener('click', event => {
    const act = event.target.closest('button')?.dataset.act;
    if (!act) return;
    const paneId = restartNote.dataset.pane;
    hideNote();
    if (act === 'restart' && paneId) restartNow(paneId);
  });

  // Start without ever making a second copy: running → nothing; a stopped pane of this agent →
  // started again there (conversation resumed when saved); else Deploy.
  async function startOne(id) {
    const s = paneFor(id);
    if (s?.running) return { ok: true, paneId: s.paneId, already: true };
    if (
      s &&
      document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(s.paneId) + '"]')
    ) {
      const result = await agentsApi.restart(s.paneId, { resume: true });
      if (result?.ok) return { ok: true, paneId: s.paneId, restarted: true };
    }
    return window.TnaiCustomAgents.deploy(id);
  }

  window.TnaiCustomAgents = {
    list: () => agents.map(withPane),
    get: id => agents.find(a => a.id === id) || null,
    forPane: paneId => {
      const s = agentsApi.sessions().find(x => x.paneId === paneId);
      return s?.customAgentId ? agents.find(a => a.id === s.customAgentId) || null : null;
    },
    refresh,
    async create(data = {}) {
      checkPaneClash(data.name);
      const agent = unwrap(await native.skills.createAgent(data));
      await refresh();
      return agent;
    },
    async rename(id, name) {
      checkPaneClash(name, id);
      const agent = unwrap(await native.skills.renameAgent(id, name));
      await refresh();
      titlePanes(id, agent.name);
      changed();
      return agent;
    },
    async update(id, fields) {
      const agent = unwrap(await native.skills.updateAgent(id, fields));
      await refresh();
      return agent;
    },
    async attach(id, skillIds) {
      const agent = unwrap(await native.skills.attach(id, skillIds));
      await refresh();
      return { agent, restart: needsRestart(id) };
    },
    async detach(id, skillIds) {
      const agent = unwrap(await native.skills.detach(id, skillIds));
      await refresh();
      return { agent, restart: needsRestart(id) };
    },
    async deploy(id) {
      const agent = agents.find(a => a.id === id);
      if (!agent) return { ok: false, error: 'That agent no longer exists.' };
      const existing = paneFor(id);
      if (existing?.running) {
        say(agent.name + ' is already running');
        return { ok: true, paneId: existing.paneId, already: true };
      }

      // A panel may carry this agent's name while the agent has no panel of its own (21
      // renamePane): two panels never share a name, so the agent is not deployed
      // beside it.
      try {
        checkPaneClash(agent.name, id);
      } catch (error) {
        const text = error.message.replace(
          ' Choose a different name.',
          ' Rename that thread or this agent, then deploy.'
        );
        say(text);
        return { ok: false, error: text };
      }
      const result = await agentsApi.open(agent.base, {
        accountId: agent.accountId,
        customAgentId: id,
      });
      if (result?.ok) {
        titlePanes(id, agent.name);
        changed();
        say(
          agent.name +
            ' deployed · ' +
            agent.base +
            (agent.skillIds.length
              ? ' with ' + agent.skillIds.length + ' skill' + (agent.skillIds.length > 1 ? 's' : '')
              : '')
        );
      } else say('Could not deploy ' + agent.name + ': ' + (result?.error || 'unknown error'));
      return result;
    },
    // Same agent in the other scope ('project' | 'personal') under its own name (names are unique
    // across both).
    async copy(id, scope, name) {
      const agent = unwrap(await native.skills.copyAgent(id, scope, name));
      await refresh();
      return agent;
    },
    // "Start with this project" (project agents): deployed once per app session when that project
    // opens.
    async setAutoStart(id, on) {
      const agent = unwrap(await native.skills.updateAgent(id, { autoStart: !!on }));
      await refresh();
      return agent;
    },
    start: startOne,
    // Every listed agent not running yet, project agents first (the list order).
    async startAll() {
      const results = [];
      for (const a of agents)
        if (!paneFor(a.id)?.running) results.push({ id: a.id, ...(await startOne(a.id)) });
      return results;
    },
    async remove(id) {
      if (paneFor(id)?.running) throw new Error('Stop this agent before deleting it.');
      unwrap(await native.skills.removeAgent(id));
      await refresh();
      return true;
    },
    restartNow, // only when the user asks (the "Restart now" note)
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // input: FileList/array of File (SKILL.md files), 'folder' (native picker), or {
  // files:[{name,text}], folders:[path] }.
  async function importSkills(input) {
    let result;
    if (input === 'folder') result = unwrap(await native.skills.pickFolder());
    else if (input && (input.files || input.folders) && !(input instanceof FileList))
      result = unwrap(await native.skills.import(input));
    else {
      const files = await Promise.all(
        [...(input || [])]
          .filter(f => /\.md$/i.test(f.name))
          .map(async f => ({ name: f.name, text: await f.text() }))
      );
      if (!files.length) {
        say('Choose SKILL.md files (.md)');
        return { imported: [], errors: [] };
      }
      result = unwrap(await native.skills.import({ files }));
    }
    await refresh();
    const warned = result.imported.filter(s => s.warnings?.length);
    if (result.errors.length) say('Not imported: ' + result.errors.join(' · '));
    else if (result.imported.length)
      say(
        'Imported ' +
          result.imported.map(s => s.name + (s.replaced ? ' (updated)' : '')).join(', ') +
          (warned.length ? ' · ' + warned[0].warnings[0] : '')
      );

    // Running agents that use a re-imported skill pick up the new version on their next start.
    const ids = new Set(result.imported.filter(s => s.replaced).map(s => s.id));
    for (const agent of agents.filter(a => a.skillIds.some(id => ids.has(id))))
      needsRestart(agent.id);
    return result;
  }

  window.TnaiSkills = {
    list: () => skills,
    clis: () => skillClis, // CLIs that can take skills (101 refuses the others)
    refresh,
    import: importSkills,
    async remove(id) {
      const result = unwrap(await native.skills.remove(id));
      await refresh();
      for (const agentId of result.agentIds) needsRestart(agentId);
      return result;
    },
    // On for every session of a skill-capable CLI (not only custom agents); sessions pick it up on
    // their next start.
    async everywhere(id, on) {
      const result = unwrap(await native.skills.everywhere(id, !!on));
      await refresh();
      return result;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  // Project skills and project agents (.tnai/, e.g. after a git pull) appear or disappear as files
  // change in the connected folder.
  let skillTimer = null;
  native.fs.onChanges?.(changes => {
    // a lane (agent worktree) batch: its paths are not the connected folder's (watch-service)
    if (changes?.[0]?.lane) return;
    if (
      !changes.some(
        c =>
          /(^|\/)\.(claude|agents|codex)\/skills(\/|$)/.test(c.path) ||
          /(^|\/)\.tnai\/(agents\.json$|agent-skills(\/|$))/.test(c.path)
      )
    )
      return;
    clearTimeout(skillTimer);
    skillTimer = setTimeout(refresh, 250);
  });

  // ---- UI: "+ Custom agent" panel and the Custom agents strip on Overview ----
  const style = document.createElement('style');
  style.textContent = `
.tnai-custom-panel,.tnai-custom-strip{margin:0 0 14px;padding:15px 16px;border:1px solid #e2e6de;border-radius:9px;background:#fff;box-shadow:0 3px 12px #20211f07}
.tnai-custom-panel[hidden],.tnai-custom-strip[hidden]{display:none}
.tnai-custom-panel h2,.tnai-custom-strip h2{margin:0 0 3px;color:#40463a;font:600 12px var(--pg-sans)}
.tnai-custom-sub{margin:0 0 12px;color:#969b91;font:9px/1.5 var(--pg-sans)}
.tnai-custom-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.tnai-custom-grid label{display:grid;gap:5px;min-width:0;color:#7f8579;font:9px var(--pg-sans)}
.tnai-custom-grid label.wide{grid-column:span 2}
.tnai-custom-grid input,.tnai-custom-grid select{box-sizing:border-box;width:100%;height:30px;padding:0 9px;border:1px solid #e0e4da;border-radius:6px;background:#fbfcf9;color:#34382f;font:11px var(--pg-sans);outline:none}
.tnai-custom-grid input:focus,.tnai-custom-grid select:focus{border-color:#bec9ad;background:#fff}
.tnai-skill-drop{display:grid;gap:8px;margin-top:12px;padding:12px;border:1px dashed #d5ddca;border-radius:7px;background:#fafbf8;transition:background .12s,border-color .12s}
.tnai-skill-drop.over{background:#f1f6ea;border-color:#9fb386}
.tnai-skill-drop.disabled{opacity:.6}
.tnai-skill-drop-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;color:#7f8579;font:9px var(--pg-sans)}
.tnai-skill-drop-head b{color:#4e5548;font:600 10px var(--pg-sans)}
.tnai-skill-drop-actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.tnai-skill-drop-actions select{height:26px;border:1px solid #dfe3d9;border-radius:5px;background:#fff;color:#5b6353;font:9px var(--pg-sans)}
.tnai-mini-button{padding:5px 9px;border:1px solid #dfe3d9;border-radius:5px;background:#fff;color:#5b6353;font:9px var(--pg-sans);cursor:pointer}
.tnai-mini-button:hover{background:#f2f4ee}.tnai-mini-button.primary{background:#3d4a33;border-color:#3d4a33;color:#f3f7ec}.tnai-mini-button.primary:hover{background:#4a5a3e}
.tnai-mini-button:disabled{opacity:.45;cursor:default}
.tnai-chosen-skills{display:flex;flex-wrap:wrap;gap:6px;min-height:22px}
.tnai-chosen-skills .empty{color:#a0a49b;font:9px var(--pg-sans);align-self:center}
.tnai-skill-chip{display:inline-flex;align-items:center;gap:6px;max-width:240px;padding:4px 5px 4px 8px;border:1px solid #e3e8dc;border-radius:99px;background:#fff;color:#56604c;font:9px var(--pg-sans)}
.tnai-skill-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-skill-chip button{width:16px;height:16px;padding:0;border:0;border-radius:50%;background:#eef1ea;color:#6d7466;font:10px/16px var(--pg-sans);cursor:pointer}
.tnai-skill-chip button:hover{background:#e2e7da}
.tnai-custom-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px}
.tnai-custom-error{color:#a45750;font:10px var(--pg-sans);min-height:13px}
.tnai-custom-foot>div{display:flex;gap:7px}
.tnai-custom-list{display:grid;gap:6px}
.tnai-custom-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) auto auto;align-items:center;gap:12px;padding:8px 10px;border:1px solid #edf0ea;border-radius:7px;background:#fbfcf9}
.tnai-custom-row b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#40463a;font:600 11px var(--pg-sans)}
.tnai-custom-row small{display:block;margin-top:3px;color:#969b91;font:9px var(--pg-sans)}
.tnai-custom-state{display:inline-flex;align-items:center;gap:5px;color:#7c8178;font:9px var(--pg-sans);white-space:nowrap}
.tnai-custom-state i{width:6px;height:6px;border-radius:50%;background:#b5b9b0}.tnai-custom-state.running i{background:#82a95f}
.tnai-custom-row .actions{display:flex;gap:6px}
@media(max-width:1100px){.tnai-custom-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.tnai-custom-row{grid-template-columns:minmax(0,1fr) auto}.tnai-custom-row .tnai-custom-meta{display:none}}
.tnai-restart-note{position:fixed;right:18px;bottom:18px;z-index:950;display:flex;align-items:center;gap:8px;max-width:min(460px,calc(100vw - 36px));padding:8px 8px 8px 12px;border:1px solid #e1e6da;border-radius:8px;background:#fff;color:#4e5547;font:10px/1.4 var(--pg-sans);box-shadow:0 8px 24px #20211f14}
.tnai-restart-note[hidden]{display:none}
.tnai-restart-note span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tnai-restart-note button{box-sizing:border-box;flex:none;height:24px;padding:0 8px;border:1px solid #d6e2c6;border-radius:6px;background:#f0f5e9;color:#46603a;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}
.tnai-restart-note button:hover{background:#e7efdc}
.tnai-restart-note button[data-act="dismiss"]{width:24px;padding:0;border-color:transparent;background:none;color:#8a8f84;font-size:12px}
`;
  document.head.append(style);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'button';
  newButton.id = 'newCustomAgent';
  newButton.textContent = '＋ Custom agent';
  newButton.title = 'Create an agent with your own name and skills';

  // The Custom agents strip opens and closes from this button (and its ×); closed by default, the
  // choice is remembered.
  const stripButton = document.createElement('button');
  stripButton.type = 'button';
  stripButton.className = 'button';
  stripButton.id = 'customAgentsToggle';
  stripButton.hidden = true;
  stripButton.title = 'Show or hide your custom agents';
  const STRIP_KEY = 'tnai.customAgentsStrip.open';
  let stripOpen = false;
  try {
    stripOpen = localStorage.getItem(STRIP_KEY) === '1';
  } catch {}
  const setStripOpen = open => {
    stripOpen = !!open;
    try {
      localStorage.setItem(STRIP_KEY, stripOpen ? '1' : '0');
    } catch {}
    renderStrip();
  };
  stripButton.onclick = () => setStripOpen(!stripOpen);
  header?.querySelector('.agent-page-actions')?.append(stripButton, newButton);

  const panel = document.createElement('section');
  panel.className = 'tnai-custom-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'New custom agent');
  panel.innerHTML = `<h2>New custom agent</h2><p class="tnai-custom-sub">Give it your own name, choose the CLI it runs on, and attach skills. Skills load only for this agent's sessions.</p>
<div class="tnai-custom-grid">
<label>Name<input data-f="name" maxlength="60" placeholder="e.g. Nova" autocomplete="off"></label>
<label>Runs on<select data-f="base"></select></label>
<label>Account<select data-f="account"></select></label>
<label>Role (optional)<input data-f="role" maxlength="300" placeholder="e.g. Frontend reviewer" autocomplete="off"></label>
<label>Save to<select data-f="scope"><option value="personal">Personal · every project</option><option value="project">This project (.tnai folder)</option></select></label>
</div>
<div class="tnai-skill-drop" data-f="drop">
<div class="tnai-skill-drop-head"><span><b>Skills</b> · drop SKILL.md files here</span><span class="tnai-skill-drop-actions">
<button type="button" class="tnai-mini-button" data-act="files">Choose files</button><button type="button" class="tnai-mini-button" data-act="folder">Choose folder</button>
<select data-f="library" aria-label="Add a skill from the library"><option value="">From library…</option></select></span></div>
<div class="tnai-chosen-skills" data-f="chosen"></div>
<p class="tnai-custom-sub" data-f="skillNote" style="margin:0" hidden></p>
</div>
<input type="file" data-f="file" accept=".md" multiple hidden>
<div class="tnai-custom-foot"><span class="tnai-custom-error" data-f="error" role="status"></span><div>
<button type="button" class="tnai-mini-button" data-act="cancel">Cancel</button><button type="button" class="tnai-mini-button" data-act="save">Save without starting</button><button type="button" class="tnai-mini-button primary" data-act="deploy">Deploy</button></div></div>`;

  const strip = document.createElement('section');
  strip.className = 'tnai-custom-strip';
  strip.hidden = true;
  strip.setAttribute('aria-label', 'Custom agents');
  strip.innerHTML =
    '<div class="tnai-custom-foot" style="margin:0 0 3px"><h2 style="margin:0">Custom agents</h2><div><button type="button" class="tnai-mini-button" data-act="start-all" title="Start every agent listed here that is not running (project agents first)">Start all</button><button type="button" class="tnai-mini-button" data-act="close-strip" title="Close" aria-label="Close custom agents">×</button></div></div>' +
    '<p class="tnai-custom-sub">Your named agents and the skills they carry. Deploy starts one in a terminal panel. Project agents are saved in this project’s .tnai folder and travel with it; personal ones stay on this computer for every project.</p>' +
    '<p class="tnai-custom-error" data-f="problems" role="status" style="margin:0 0 8px" hidden></p><div class="tnai-custom-list"></div>';

  // Place both above the live agent tree (11 inserts it right after the header).
  const anchor = page.querySelector('.tnai-live-panel') || header?.nextElementSibling;
  anchor
    ? anchor.before(panel, strip)
    : page.querySelector('.agent-page-inner')?.append(panel, strip);

  const f = name => panel.querySelector('[data-f="' + name + '"]');
  let chosen = [];

  const skillName = id => skills.find(s => s.id === id)?.name || id;

  function fillBase() {
    const current = f('base').value;

    // A paused CLI (10 PAUSED) is not offered for a new custom agent; one already picked on the
    // form being edited stays listed.
    const installed = agentsApi
      .info()
      .filter(a => a.installed && (!agentsApi.paused?.(a.id) || a.id === current))
      .map(a => a.id);
    f('base').innerHTML =
      installed.map(id => '<option value="' + esc(id) + '">' + esc(id) + '</option>').join('') ||
      '<option value="">No agent CLI installed</option>';
    if (installed.includes(current)) f('base').value = current;
    else if (installed.includes('Claude Code')) f('base').value = 'Claude Code';
    fillAccounts();
  }

  function fillAccounts() {
    const base = f('base').value,
      entry = window.TnaiAccounts?.list?.().find(d => d.agentId === base);
    const accounts = entry?.accounts || [{ id: '', label: 'Default account' }];
    const active =
      f('account').dataset.base === base
        ? f('account').value
        : window.TnaiAccounts?.activeFor?.(base) || '';
    f('account').dataset.base = base;
    f('account').innerHTML = accounts
      .map(
        a =>
          '<option value="' +
          esc(a.id) +
          '">' +
          esc(
            (window.tnaiMaskEmails || String)(
              a.label + (a.status?.account ? ' · ' + a.status.account : '')
            )
          ) +
          '</option>'
      )
      .join('');
    f('account').value = accounts.some(a => a.id === active) ? active : '';
    f('account').disabled = accounts.length < 2;
    renderChosen();
  }

  function renderChosen() {
    const base = f('base').value,
      ok = skillClis.includes(base);
    f('drop').classList.toggle('disabled', !ok);
    panel.querySelectorAll('[data-act="files"],[data-act="folder"]').forEach(b => {
      b.disabled = !ok;
    });
    f('library').disabled = !ok;
    f('skillNote').hidden = ok;
    f('skillNote').textContent = ok
      ? ''
      : base + ' cannot load skills per session yet, so this agent gets its name (and role) only.';
    f('chosen').innerHTML = chosen.length
      ? chosen
          .map(
            id =>
              '<span class="tnai-skill-chip" title="' +
              esc(skills.find(s => s.id === id)?.description || '') +
              '"><span>' +
              esc(skillName(id)) +
              '</span><button type="button" data-remove="' +
              esc(id) +
              '" aria-label="Remove ' +
              esc(skillName(id)) +
              '">×</button></span>'
          )
          .join('')
      : '<span class="empty">No skills yet · the agent still works without them</span>';
    const inProject = f('scope').value === 'project';
    const imported = skills.filter(
      s =>
        (s.source === 'imported' || (inProject && s.source === 'project')) && !chosen.includes(s.id)
    );
    f('library').innerHTML =
      '<option value="">From library…</option>' +
      imported
        .map(
          s =>
            '<option value="' +
            esc(s.id) +
            '">' +
            esc(s.name + (s.source === 'project' ? ' · this project' : '')) +
            '</option>'
        )
        .join('');
  }

  function openPanel() {
    chosen = [];
    f('name').value = '';
    f('role').value = '';
    f('error').textContent = '';
    f('account').dataset.base = '';
    const hasProject = !!window.TnaiProjectFiles?.connected?.();
    f('scope').querySelector('[value="project"]').disabled = !hasProject;
    if (!hasProject) f('scope').value = 'personal';
    fillBase();
    panel.hidden = false;
    f('name').focus();
  }
  const closePanel = () => {
    panel.hidden = true;
  };
  newButton.onclick = () => (panel.hidden ? openPanel() : closePanel());

  // Settings › Agents › Custom agents › New agent (22): the form opens right there. The redesigned
  // Overview has no custom agents strip, so the old route (go to Overview, click ＋ Custom agent)
  // showed nothing.
  window.TnaiCustomAgents.openForm = host => {
    if (host && panel.parentElement !== host) host.append(panel);
    openPanel();
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  async function addFiles(input) {
    try {
      const result = await importSkills(input);
      result.imported.forEach(s => {
        if (!chosen.includes(s.id)) chosen.push(s.id);
      });
      if (result.errors.length) f('error').textContent = result.errors[0];
      renderChosen();
    } catch (error) {
      f('error').textContent = error.message;
    }
  }

  async function submit(deploy) {
    f('error').textContent = '';
    const base = f('base').value;
    try {
      const agent = await window.TnaiCustomAgents.create({
        name: f('name').value,
        base,
        accountId: f('account').value,
        role: f('role').value,
        skillIds: skillClis.includes(base) ? chosen : [],
        scope: f('scope').value,
      });
      closePanel();
      if (deploy) await window.TnaiCustomAgents.deploy(agent.id);
      else {
        setStripOpen(true);
        say(
          agent.name +
            ' saved' +
            (agent.scope === 'project' ? ' to this project' : '') +
            ' · deploy it from Custom agents'
        );
      }
    } catch (error) {
      f('error').textContent = error.message;
      f('name').focus();
    }
  }

  panel.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      chosen = chosen.filter(id => id !== remove.dataset.remove);
      renderChosen();
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'files') f('file').click();
    if (act === 'folder') addFiles('folder');
    if (act === 'cancel') closePanel();
    if (act === 'save') submit(false);
    if (act === 'deploy') submit(true);
  });
  f('file').onchange = () => {
    addFiles(f('file').files);
    f('file').value = '';
  };
  f('base').onchange = fillAccounts;
  f('scope').onchange = () => {
    if (f('scope').value !== 'project') chosen = chosen.filter(id => !id.startsWith('project:'));
    renderChosen();
  };
  f('library').onchange = () => {
    const id = f('library').value;
    if (id && !chosen.includes(id)) chosen.push(id);
    renderChosen();
  };
  f('name').addEventListener('keydown', event => {
    if (event.key === 'Enter') submit(true);
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  const drop = f('drop');
  drop.addEventListener('dragover', event => {
    if (drop.classList.contains('disabled') || !event.dataTransfer?.types?.includes('Files'))
      return;
    event.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('over');
    if (!drop.classList.contains('disabled')) addFiles(event.dataTransfer.files);
  });

  function renderStrip() {
    const list = window.TnaiCustomAgents.list(),
      hasProject = !!window.TnaiProjectFiles?.connected?.();
    const hasContent = !!(list.length || problems.length);
    stripButton.hidden = !hasContent;
    stripButton.textContent = 'Custom agents' + (list.length ? ' (' + list.length + ')' : '');
    stripButton.setAttribute('aria-pressed', stripOpen && hasContent ? 'true' : 'false');
    strip.hidden = !hasContent || !stripOpen;
    const note = strip.querySelector('[data-f="problems"]'),
      noteText = problems.join(' · ');
    if (note.textContent !== noteText) note.textContent = noteText;
    note.hidden = !noteText;
    strip.querySelector('[data-act="start-all"]').disabled = !list.some(a => !a.running);

    // Called on every session change (many a second while agents work): the rows are rebuilt only
    // when what they show changed, so hover and clicks survive.
    const html = list
      .map(a => {
        const skillText = !a.supportsSkills
          ? 'Skills not supported by ' + a.base
          : a.skillIds.length
            ? a.skillIds.map(skillName).join(', ')
            : 'No skills';
        const account =
          window.TnaiAccounts?.label?.(a.base, a.accountId) ||
          (a.accountId ? a.accountId : 'Default account');
        return `<div class="tnai-custom-row" data-agent="${esc(a.id)}"><div><b>${esc(a.name)}</b><small>${esc((a.scope === 'project' ? 'Project' : 'Personal') + ' · ' + a.base + ' · ' + account + (a.role ? ' · ' + a.role : ''))}</small></div>
<div class="tnai-custom-meta"><small title="${esc(skillText)}" style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.supportsSkills ? a.skillIds.length + ' skill' + (a.skillIds.length === 1 ? '' : 's') + (a.skillIds.length ? ' · ' + skillText : '') : skillText)}</small></div>
<span class="tnai-custom-state${a.running ? ' running' : ''}"><i></i>${a.running ? 'Running' : a.paneId ? 'Stopped' : 'Saved'}</span>
<span class="actions"><button type="button" class="tnai-mini-button${a.running ? '' : ' primary'}" data-act="${a.running ? 'open' : 'deploy'}">${a.running ? 'Open' : 'Deploy'}</button>${a.scope === 'project' ? `<button type="button" class="tnai-mini-button" data-act="autostart" aria-pressed="${a.autoStart ? 'true' : 'false'}" title="Start with this project: deploy it once per app session when this project opens">Auto-start: ${a.autoStart ? 'On' : 'Off'}</button>` : ''}${a.scope === 'project' || hasProject ? `<button type="button" class="tnai-mini-button" data-act="copy" title="${a.scope === 'project' ? 'Copy this agent and its skills to your personal agents (every project)' : 'Copy this agent and its skills into this project (.tnai folder)'}">${a.scope === 'project' ? 'Copy to personal' : 'Copy to project'}</button>` : ''}<button type="button" class="tnai-mini-button" data-act="rename">Rename</button><button type="button" class="tnai-mini-button" data-act="delete"${a.running ? ' disabled title="Stop it first"' : ''}>Delete</button></span></div>`;
      })
      .join('');
    const box = strip.querySelector('.tnai-custom-list');
    if (box.dataset.key !== html) {
      box.dataset.key = html;
      box.innerHTML = html;
    }
  }
  strip.addEventListener('click', async event => {
    const act = event.target.closest('[data-act]')?.dataset.act,
      id = event.target.closest('[data-agent]')?.dataset.agent;
    if (act === 'close-strip') {
      setStripOpen(false);
      return;
    }
    if (act === 'start-all') {
      event.target.closest('button').disabled = true;
      try {
        const results = await window.TnaiCustomAgents.startAll(),
          failed = results.filter(r => !r?.ok).length;
        if (failed) say(failed + ' custom agent' + (failed > 1 ? 's' : '') + ' could not start');
        else if (results.length)
          say('Started ' + results.length + ' custom agent' + (results.length > 1 ? 's' : ''));
      } finally {
        renderStrip();
      }
      return;
    }
    if (!act || !id) return;
    const agent = window.TnaiCustomAgents.get(id);
    try {
      if (act === 'deploy') await window.TnaiCustomAgents.deploy(id);
      if (act === 'open') {
        const s = paneFor(id);
        document.querySelector('.side-item[data-view="terminal"]')?.click();
        setTimeout(
          () =>
            document
              .querySelector(
                '.terminal-pane[data-pane-id="' +
                  CSS.escape(s?.paneId || '') +
                  '"] .tnai-xterm textarea'
              )
              ?.focus(),
          120
        );
      }
      if (act === 'autostart') {
        const on = !agent.autoStart;
        await window.TnaiCustomAgents.setAutoStart(id, on);
        say(
          agent.name + (on ? ' starts with this project' : ' no longer starts with this project')
        );
      }
      if (act === 'copy') {
        const to = agent.scope === 'project' ? 'personal' : 'project';
        const name = prompt(
          'Copy “' +
            agent.name +
            '” to ' +
            (to === 'project' ? 'this project' : 'your personal agents') +
            ' as (names are unique across personal and project agents):',
          agent.name + (to === 'project' ? ' (project)' : ' (personal)')
        );
        if (name && name.trim()) {
          const copy = await window.TnaiCustomAgents.copy(id, to, name);
          say(
            copy.name +
              (to === 'project' ? ' saved to this project' : ' saved to your personal agents')
          );
        }
      }
      if (act === 'rename') {
        const name = prompt('Rename “' + agent.name + '”:', agent.name);
        if (name && name.trim() !== agent.name) {
          await window.TnaiCustomAgents.rename(id, name);
          say('Renamed to ' + name.trim());
        }
      }
      if (
        act === 'delete' &&
        confirm(
          'Delete the custom agent “' +
            agent.name +
            '”? ' +
            (agent.scope === 'project'
              ? 'It is removed from this project’s .tnai folder, with skill copies no other project agent uses.'
              : 'Its skills stay in the library.')
        )
      ) {
        await window.TnaiCustomAgents.remove(id);
        say(agent.name + ' deleted');
      }
    } catch (error) {
      say(error.message);
    }
  });

  agentsApi.onChange(() => {
    if (!strip.hidden || agents.length) renderStrip();
    if (!panel.hidden) fillBase();
  });
  window.addEventListener('tnai:accounts-changed', () => {
    if (!panel.hidden) fillAccounts();
    renderStrip();
  });

  // "Auto-start" project agents: started once per app session when their project is open (desktop
  // only, after the folder is connected and the last session's panes are restored, so a running
  // copy is found and never doubled). Pushed by project switches (09) and file changes above.
  const autoStarted = new Set(); // project root + agent id, this app session
  let sessionReady = false;

  async function autoStart() {
    if (!sessionReady) return;
    const root = String((await native.fs.root?.()) || '');
    if (!root) return;
    for (const a of agents.filter(x => x.scope === 'project' && x.autoStart)) {
      const key = root.toLowerCase() + '|' + a.id;
      if (autoStarted.has(key)) continue;
      autoStarted.add(key);
      if (!paneFor(a.id)?.running) {
        const result = await startOne(a.id);
        if (result?.ok && !result.already) say(a.name + ' started with this project');
      }
    }
  }

  // Restored panes reattach asynchronously after 61's start choice; one short settle lets their
  // running state arrive before anything is started.
  Promise.resolve(window.TnaiSessionStart?.ready).then(() =>
    setTimeout(() => {
      sessionReady = true;
      refresh().then(autoStart);
    }, 1500)
  );
  window.addEventListener('tnai:project-changed', () => {
    refresh().then(autoStart);
  });
  refresh();
})();
