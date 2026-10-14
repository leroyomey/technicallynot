/*
 * Technically Not · 18-skills-page.js — Skills page (replaces Context): a searchable gallery of
 * every skill Technically Not knows (imported library, the connected project, your own Claude
 * skills, and names seen in use without a file), with filter chips (All · Library · Project · Yours
 * · Always on · In use · Overlaps · Unused), an agent drop strip (drag a card onto a custom agent,
 * or onto a running session for its whole life through 101; click an agent for its skill menu), a
 * right-side detail panel (rendered SKILL.md via skills:read, keywords, paths, location, health,
 * who uses it, overlaps, actions: Apply to…, Every session, Open, Show in folder, Remove with an
 * inline confirm) and overlap groups drawn as linked stacks. Live "in use now" cards are lit from
 * Claude Code hooks or agent output. Also the shared Apply menu used by agent cards (11) through
 * window.TnaiSkillsUI. Styles: src/styles/13-skills-purple.css.
 */
(() => {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const skillsApi = () => window.TnaiSkills,
    agentsApi = () => window.TnaiCustomAgents,
    native = () => window.tnaiNative?.skills;
  const DRAG_TYPE = 'application/x-tnai-skill';
  const icon = (name, size = 14) => window.TnaiIcon?.(name, { size }) || '';
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  // ---- Matching a name seen in agent output to a library skill (case-insensitive; `plugin:skill`
  // matches `skill`) ----
  const norm = n =>
    String(n || '')
      .toLowerCase()
      .trim();
  const base = n => norm(n).split(':').pop();
  const matches = (skill, used) =>
    [skill.name, skill.id].some(x => x && (norm(x) === norm(used) || base(x) === base(used)));
  const SOURCES = {
    imported: {
      group: 'Imported into Technically Not',
      badge: 'Library',
      note: 'Imported skills and the starters Technically Not comes with. Turn one on for every session or give it to custom agents.',
    },
    project: {
      group: 'From this project',
      badge: 'Project',
      note: 'In the connected project folder. Read-only here; edit them in the project.',
    },
    user: {
      group: 'Your Claude skills',
      badge: 'Yours',
      note: 'In your own Claude skills folder. Read-only here.',
    },
    seen: {
      group: 'Seen in use, not in the library',
      badge: 'Seen',
      note: 'An agent used these (from its output), but Technically Not has no file for them.',
    },
  };
  const FILTERS = [
    ['all', 'All'],
    ['imported', 'Library'],
    ['project', 'Project'],
    ['user', 'Yours'],
    ['everywhere', 'Always on'],
    ['live', 'In use'],
    ['overlaps', 'Overlaps'],
    ['unused', 'Unused'],
  ];

  // Which agent CLIs a skill reaches without anyone applying it (the "Reaches" fact in the detail
  // panel). Library skills on for every session: desktop/skill-service.js (Claude Code plugin,
  // OpenCode skills.paths, marked copies in ~/.agents/skills for Codex and GitHub Copilot). Project
  // folders: what each CLI loads by itself, measured with tools/agent-cli-check.js (2026-10-01).
  // Cursor Agent loads none of them.
  const EVERY_CLIS = 'Claude Code, OpenCode, Codex, GitHub Copilot';

  function reach(k) {
    const p = String(k.path || '').replace(/\\/g, '/');
    if (k.source === 'imported')
      return k.everywhere
        ? {
            text: EVERY_CLIS,
            title:
              'Loads when a session starts. Codex and GitHub Copilot read a copy in your personal skills folder (~/.agents/skills); a skill of your own with the same name there is used instead. Cursor Agent does not load library skills.',
          }
        : {
            text: 'Only agents you apply it to',
            title: 'Turn on Every session to load it in ' + EVERY_CLIS + '.',
          };
    if (k.source === 'user')
      return { text: 'Claude Code', title: 'Your own Claude skills folder.' };
    if (k.source !== 'project') return null;
    const own = /\/\.claude\/skills\//.test(p)
      ? 'Claude Code, OpenCode, GitHub Copilot'
      : /\/\.agents\/skills\//.test(p)
        ? 'Codex, OpenCode, GitHub Copilot'
        : /\/\.codex\/skills\//.test(p)
          ? 'Codex'
          : '';
    return own
      ? {
          text: own,
          title:
            'These load it by themselves in this project. Other agents open it when a task matches its name or keywords.',
        }
      : null;
  }

  // Skills an agent saved (`tnai skill save`) that the user has not opened yet (such
  // a skill stays on for every session, but the user must see it). 60 adds the id
  // when main reports the save and shows the bell notice; the card carries a "New · agent-written"
  // chip until its details are opened here. Kept across restarts; only a skill the library marks
  // `by: 'agent'` counts.
  const NEW_STORE = 'tnai.skills.agent-new.v1';
  const agentNew = new Set(
    (() => {
      try {
        const v = JSON.parse(localStorage.getItem(NEW_STORE) || '[]');
        return Array.isArray(v) ? v.map(String) : [];
      } catch {
        return [];
      }
    })()
  );
  const keepNew = () => {
    try {
      localStorage.setItem(NEW_STORE, JSON.stringify([...agentNew]));
    } catch {}
  };
  const isAgentNew = k => !!k && k.by === 'agent' && agentNew.has(k.id);

  // A YAML block marker (`>-`, `|`) left as the description means the text was multi-line; show it
  // as missing rather than the marker.
  const describe = k =>
    /^[>|][+-]?\d*$/.test(String(k.description || '').trim()) ? '' : k.description || '';

  // `keywords:` / `paths:` frontmatter as a list: "a, b" or "[a, b]".
  const listOf = v =>
    (Array.isArray(v)
      ? v
      : String(v || '')
          .replace(/^\s*\[|\]\s*$/g, '')
          .split(',')
    )
      .map(x =>
        String(x)
          .trim()
          .replace(/^['"]|['"]$/g, '')
      )
      .filter(Boolean);
  const list = () => {
    try {
      return skillsApi()?.list?.() || [];
    } catch {
      return [];
    }
  };
  const customAgents = () => {
    try {
      return agentsApi()?.list?.() || [];
    } catch {
      return [];
    }
  };
  const sessions = () => {
    try {
      return window.TnaiAgents?.sessions?.() || [];
    } catch {
      return [];
    }
  };
  const usedIn = paneId => {
    try {
      return window.TnaiFileActivity?.skills?.(paneId) || [];
    } catch {
      return [];
    }
  };
  const colorOf = name => {
    try {
      return window.TnaiAgentMarks?.agentColor?.(name) || '';
    } catch {
      return '';
    }
  };
  const avatar = (name, cls = 'sk-av') =>
    '<span class="' +
    cls +
    '" style="--av:' +
    esc(colorOf(name) || 'var(--pg-accent)') +
    '" title="' +
    esc(name) +
    '" aria-hidden="true">' +
    esc(
      String(name || '?')
        .trim()
        .charAt(0)
        .toUpperCase() || '?'
    ) +
    '</span>';

  // When a skill was last used (13 keeps it across restarts): the latest use whose name matches it,
  // or null.
  const lastUseOf = k => {
    let best = null;
    try {
      for (const u of window.TnaiFileActivity?.lastUsed?.() || [])
        if (matches(k, u.name) && (!best || u.at > best.at)) best = u;
    } catch {}
    return best;
  };

  // Clock time today, else the date: absolute, so it never goes stale between re-renders.
  const when = at => {
    const d = new Date(at),
      today = new Date().toDateString() === d.toDateString();
    return today
      ? 'today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
          ', ' +
          d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Skill name -> running panes using it now, and names seen in use that match no library skill.
  function inUse(skills) {
    const bySkill = new Map(),
      seen = new Map();
    for (const s of sessions()) {
      if (!s.running) continue;
      for (const u of usedIn(s.paneId)) {
        const hit = skills.find(k => matches(k, u.name));
        if (hit) {
          if (!bySkill.has(hit.id)) bySkill.set(hit.id, []);
          bySkill.get(hit.id).push(s.name);
        } else {
          const key = base(u.name);
          if (!seen.has(key))
            seen.set(key, {
              id: 'seen:' + key,
              name: u.name,
              description: '',
              source: 'seen',
              agentIds: [],
              users: [],
            });
          seen.get(key).users.push(s.name);
        }
      }
    }
    return { bySkill, seen: [...seen.values()] };
  }

  // Same-topic skills (desktop/skill-overlap.js pairs, listed per skill as `overlaps`) joined into
  // groups: each group is one linked stack.
  function overlapGroups(skills) {
    const byName = new Map(skills.map(k => [norm(k.name), k])),
      parent = new Map();
    const find = id => {
      while (parent.get(id) !== id) id = parent.get(id);
      return id;
    };
    const add = id => {
      if (!parent.has(id)) parent.set(id, id);
    };
    for (const k of skills)
      if (k.overlaps?.length) {
        add(k.id);
        for (const o of k.overlaps) {
          const other = byName.get(norm(o.name));
          if (other) {
            add(other.id);
            parent.set(find(k.id), find(other.id));
          }
        }
      }
    const groups = new Map();
    for (const id of parent.keys()) {
      const root = find(id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(skills.find(k => k.id === id));
    }
    return [...groups.values()]
      .filter(g => g.length > 1)
      .map(g => g.sort((a, b) => a.name.localeCompare(b.name)));
  }

  async function attach(agentId, skillIds) {
    const agent = customAgents().find(a => a.id === agentId);
    if (!agentsApi()?.attach) {
      say('Custom agents are not available in this build.');
      return false;
    }
    if (agent && agent.supportsSkills === false) {
      say(agent.name + ' (' + agent.base + ') can’t load skills per session yet.');
      return false;
    }
    try {
      const result = await agentsApi().attach(agentId, skillIds);
      if (result && result.ok === false) {
        say(result.error?.message || result.error || 'Could not add the skill.');
        return false;
      }
      return true;
    } catch (error) {
      say('Could not add the skill: ' + error.message);
      return false;
    }
  }

  async function detach(agentId, skillIds) {
    try {
      const result = await agentsApi()?.detach?.(agentId, skillIds);
      if (result && result.ok === false) {
        say(result.error?.message || result.error || 'Could not remove the skill.');
        return false;
      }
      return true;
    } catch (error) {
      say('Could not remove the skill: ' + error.message);
      return false;
    }
  }

  async function importSkills(input) {
    if (!skillsApi()?.import) {
      say('Importing skills is not available in this build.');
      return;
    }
    try {
      const result = await skillsApi().import(input);
      if (result && result.ok === false)
        say(result.error?.message || result.error || 'Could not import those skills.');
    } catch (error) {
      say('Could not import: ' + error.message);
    }
  }
  const unwrap = r => {
    if (r && r.ok === false) throw new Error(r.error?.message || r.error || 'failed');
    return r && typeof r === 'object' && 'value' in r ? r.value : r;
  };

  // ---- Page shell ----
  const STORE = 'tnai.skills-page.v1';
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE) || '{}') || {};
    } catch {
      return {};
    }
  })();
  let filter = FILTERS.some(f => f[0] === saved.filter) ? saved.filter : 'all';
  const remember = () => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ filter }));
    } catch {}
  };

  const page = document.createElement('section');
  page.className = 'skills-page';
  page.id = 'skillsPage';
  page.setAttribute('aria-label', 'Skills library');
  page.innerHTML = `<div class="skills-inner">
<header class="agent-page-header sk-head"><div class="sk-title"><h1>Skills</h1><p class="sk-sum">Every skill Technically Not knows about, in one place.</p></div>
<label class="sk-search">${icon('search', 15)}<input class="skills-filter" type="search" placeholder="Search skills, keywords, paths" aria-label="Search skills"><kbd>/</kbd></label>
<div class="agent-page-actions"><button type="button" class="button" data-act="import-folder">${icon('folder-input', 15)}<span>Import folder</span></button><button type="button" class="button dark" data-act="import-files">${icon('file-plus', 15)}<span>Import SKILL.md</span></button></div></header>
<div class="sk-bar"><div class="sk-chips" role="radiogroup" aria-label="Show"></div></div>
<section class="sk-agents skills-agents" aria-label="Agents"><span class="sk-agents-label">${icon('users', 14)}<span>Drop on an agent</span></span><div class="skills-agent-list"></div></section>
<div class="sk-body">
<section class="skills-library" aria-label="Skill library"><div class="skills-groups"></div></section>
<aside class="sk-detail" aria-label="Skill details" hidden></aside>
</div></div>
<div class="skills-drop" aria-hidden="true"><span><b>Drop SKILL.md files to import them</b>Several at once is fine; each becomes its own skill.</span></div>`;
  layout.append(page);
  const fileInput = Object.assign(document.createElement('input'), {
    type: 'file',
    multiple: true,
    accept: '.md,text/markdown',
    hidden: true,
  });
  page.append(fileInput);
  const $ = sel => page.querySelector(sel);
  const groupsEl = $('.skills-groups'),
    agentListEl = $('.skills-agent-list'),
    filterEl = $('.skills-filter'),
    dropOverlay = $('.skills-drop');
  const chipsEl = $('.sk-chips'),
    sumEl = $('.sk-sum'),
    detailEl = $('.sk-detail'),
    bodyEl = $('.sk-body');

  // ---- Rendering (keyed, and paused while a card is being dragged so the drag source stays in the
  // DOM) ----
  let dragging = null,
    renderKey = '',
    detailKey = '',
    frame = 0,
    selected = '',
    confirmRemove = '';
  const GROUP_CAP = 12,
    FLAT_CAP = 150,
    expanded = new Set();
  const visible = () => layout.classList.contains('skills-mode');

  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!dragging) render();
      });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const search = k =>
    [k.name, describe(k), listOf(k.keywords).join(' '), listOf(k.paths).join(' ')]
      .join(' ')
      .toLowerCase();
  const passes = (k, f, users) =>
    f === 'all'
      ? true
      : f === 'everywhere'
        ? !!k.everywhere
        : f === 'live'
          ? users.length > 0
          : f === 'overlaps'
            ? !!k.overlaps?.length
            : f === 'unused'
              ? k.source !== 'seen' && !users.length && !lastUseOf(k)
              : (SOURCES[k.source] ? k.source : 'imported') === f;

  let litBefore = new Set(),
    litNow = new Set(); // skill ids in use at the previous / current render
  let state = { all: [], bySkill: new Map(), names: new Map() };

  function render() {
    const skills = list(),
      agents = customAgents(),
      live = sessions(),
      { bySkill, seen } = inUse(skills);
    const query = norm(filterEl.value),
      all = [...skills, ...seen];
    const usersOf = k => bySkill.get(k.id) || k.users || [];
    const hits = all.filter(k => !query || search(k).includes(query));

    // One total of skills loaded by the running agents (101 `loaded`: attached, on for every
    // session, picked up by itself), each name once.
    const loadedNames = new Set();
    for (const s of live) {
      const L = s.running && window.TnaiSessionSkills?.loaded?.(s.paneId);
      if (L) for (const n of [...L.attached, ...L.always, ...L.used]) loadedNames.add(base(n));
    }
    const key = JSON.stringify([
      loadedNames.size,
      [...expanded],
      filter,
      hits.map(k => [
        k.id,
        k.name,
        k.description,
        k.keywords,
        k.paths,
        k.source,
        k.warnings,
        k.agentIds,
        k.everywhere,
        bySkill.get(k.id),
        k.users,
        k.stats,
        k.overlaps,
        k.editedAt,
        isAgentNew(k),
      ]),
      agents.map(a => [a.id, a.name, a.base, a.paneId, a.supportsSkills, a.skillIds]),
      live.map(s => [
        s.paneId,
        s.name,
        s.running,
        s.customAgentId,
        (window.TnaiSessionSkills?.list(s.paneId) || []).map(k => k.id),
      ]),
      !!skillsApi(),
      query,
    ]);
    state = { all, bySkill, names: new Map(agents.map(a => [a.id, a.name])) };
    if (selected && !all.some(k => k.id === selected)) {
      selected = '';
      confirmRemove = '';
    }
    renderDetail();
    if (key === renderKey) return;
    renderKey = key;
    litBefore = litNow;
    litNow = new Set();

    // Summary line and filter chips (counts follow the search).
    const liveCount = hits.filter(k => usersOf(k).length).length,
      everyCount = skills.filter(k => k.everywhere).length,
      groupsAll = overlapGroups(skills);
    sumEl.textContent = !skillsApi()
      ? 'The skill library is not available in this build.'
      : [
          skills.length + ' skill' + (skills.length === 1 ? '' : 's'),
          liveCount ? liveCount + ' in use now' : '',
          loadedNames.size ? loadedNames.size + ' loaded by running agents' : '',
          everyCount ? everyCount + ' on for every session' : '',
          groupsAll.length
            ? groupsAll.length + ' overlap group' + (groupsAll.length === 1 ? '' : 's')
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
    chipsEl.replaceChildren(
      ...FILTERS.map(([id, label]) => {
        const n =
          id === 'overlaps'
            ? overlapGroups(hits.filter(k => k.source !== 'seen')).length
            : hits.filter(k => passes(k, id, usersOf(k))).length;
        const b = el('button', 'sk-chip');
        b.type = 'button';
        b.dataset.act = 'filter';
        b.dataset.filter = id;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(filter === id));
        if (!n && id !== 'all') b.dataset.empty = '1';
        if (id === 'everywhere') b.insertAdjacentHTML('beforeend', icon('zap', 12));
        else if (id === 'live') b.append(el('i', 'sk-chip-dot'));
        else if (id === 'overlaps') b.insertAdjacentHTML('beforeend', icon('link', 12));
        b.append(el('span', '', label), el('em', '', String(n)));
        if (id === 'overlaps')
          b.title = 'Groups of skills on the same topic, candidates to merge into one';
        if (id === 'everywhere')
          b.title = 'Library skills that load in every session (' + EVERY_CLIS + ')';
        if (id === 'unused')
          b.title =
            'No agent session has used these since Technically Not started recording skill use';
        return b;
      })
    );

    // Gallery: grouped by where the skill lives; overlaps are drawn as linked stacks.
    if (filter === 'overlaps') renderStacks(hits, usersOf);
    else {
      const groups = [];
      for (const source of ['imported', 'project', 'user', 'seen']) {
        const rows = hits.filter(
          k =>
            (SOURCES[k.source] ? k.source : 'imported') === source && passes(k, filter, usersOf(k))
        );
        if ((source === 'seen' || filter !== 'all') && !rows.length) continue;
        const group = el('section', 'skills-group'),
          head = el('header');
        head.append(
          el('b', '', SOURCES[source].group),
          el('span', '', rows.length ? String(rows.length) : ''),
          el('small', '', SOURCES[source].note)
        );
        group.append(head);
        if (!rows.length)
          group.append(
            el(
              'p',
              'skills-empty',
              !skillsApi()
                ? 'The skill library is not available in this build.'
                : query
                  ? 'No matches.'
                  : source === 'imported'
                    ? 'Nothing imported yet. Use Import SKILL.md above, or drop files anywhere on this page.'
                    : source === 'project'
                      ? 'No skills in the connected project folder (looked in its skills folders).'
                      : 'No skills in your Claude skills folder.'
            )
          );

        // In use first, then by name. On All, long groups cap at GROUP_CAP cards until expanded; a
        // search or a filter shows up to FLAT_CAP.
        const ordered = [...rows].sort(
          (a, b) =>
            (usersOf(b).length > 0) - (usersOf(a).length > 0) ||
            String(a.name).localeCompare(String(b.name))
        );
        const cap = expanded.has(source)
          ? Infinity
          : !query && filter === 'all'
            ? GROUP_CAP
            : FLAT_CAP;
        if (rows.length) {
          const grid = el('div', 'sk-grid');
          ordered.slice(0, cap).forEach(k => grid.append(card(k, usersOf(k))));
          group.append(grid);
        }
        if (ordered.length > Math.min(cap, expanded.has(source) ? GROUP_CAP : cap)) {
          const more = el(
            'button',
            'skills-more',
            expanded.has(source) ? 'Show fewer' : 'Show all ' + ordered.length
          );
          more.type = 'button';
          more.dataset.act = 'toggle-group';
          more.dataset.source = source;
          group.append(more);
        }
        groups.push(group);
      }
      if (!groups.length)
        groups.push(
          el(
            'p',
            'skills-empty sk-none',
            query ? 'No skills match “' + filterEl.value + '”.' : 'Nothing here for this filter.'
          )
        );
      groupsEl.replaceChildren(...groups);
    }

    // Agent drop strip: custom agents take skills; plain running sessions take a skill for the rest
    // of their session (101), except CLIs without skill support.
    const targets = agents.map(a => {
      const running = a.paneId && live.some(s => s.paneId === a.paneId && s.running);
      const t = el('button', 'skills-target');
      t.type = 'button';
      t.dataset.act = 'agent-menu';
      t.dataset.agentId = a.id;
      t.dataset.accept = a.supportsSkills === false ? '0' : '1';
      t.dataset.running = running ? '1' : '0';
      t.title =
        a.supportsSkills === false
          ? a.base + ' can’t load skills per session yet, so this agent keeps its name only.'
          : 'Drop a skill to give it to ' + a.name + ', or click to choose its skills';
      const count = (a.skillIds || []).length;
      t.insertAdjacentHTML('beforeend', avatar(a.name));
      const txt = el('span', 'sk-t-txt');
      txt.append(
        el('b', '', a.name),
        el(
          'small',
          '',
          [
            a.base,
            running ? 'running' : 'not running',
            count + ' skill' + (count === 1 ? '' : 's'),
          ].join(' · ')
        )
      );
      t.append(txt, el('i'));
      return t;
    });
    live
      .filter(s => s.running && !s.customAgentId && !agents.some(a => a.paneId === s.paneId))
      .forEach(s => {
        // 101: a running session takes a skill for the rest of its life (sent to it now, reminded
        // on each composer prompt).
        const why = window.TnaiSessionSkills
          ? window.TnaiSessionSkills.refusal(s.paneId)
          : 'Needs the desktop app.';
        const t = el('div', 'skills-target');
        t.dataset.paneId = s.paneId;
        t.dataset.accept = why ? '0' : '1';
        t.dataset.running = '1';
        t.title = why || 'Drop a skill to give it to ' + s.name + ' for the rest of this session';
        t.insertAdjacentHTML('beforeend', avatar(s.name));
        const txt = el('span', 'sk-t-txt');
        txt.append(
          el('b', '', s.name),
          el(
            'small',
            '',
            s.agent +
              ' · ' +
              (n => (n ? n + ' skill' + (n > 1 ? 's' : '') + ' this session' : 'plain session'))(
                (window.TnaiSessionSkills?.list(s.paneId) || []).length
              )
          )
        );
        t.append(txt, el('i'));
        targets.push(t);
      });
    agentListEl.replaceChildren(
      ...(targets.length
        ? targets
        : [
            el(
              'p',
              'skills-empty',
              agentsApi()
                ? 'No custom agents yet. Create one in Settings › Agents › Custom agents, then drop skills on it here.'
                : 'Custom agents are not available in this build.'
            ),
          ])
    );
  }

  // Use stamp: in use now (who), else when it was last used, so an unused skill is easy to spot for
  // removal or rework.
  function stamp(k, users) {
    if (users.length) {
      const u = el('span', 'skill-badge live', 'In use · ' + [...new Set(users)].join(', '));
      u.title = 'Seen in agent output just now';
      return u;
    }
    const last = lastUseOf(k),
      since = window.TnaiFileActivity?.lastUsedSince?.();
    const u = el(
      'span',
      'skill-badge used',
      last ? 'Last used ' + when(last.at) : since ? 'Not used since ' + when(since) : 'Not used yet'
    );
    u.title = last
      ? 'Last used ' + new Date(last.at).toLocaleString() + (last.by ? ' by ' + last.by : '')
      : 'No agent session in Technically Not has used it' +
        (since
          ? ' since ' +
            new Date(since).toLocaleString() +
            ', when Technically Not started recording skill use'
          : '');
    return u;
  }

  function card(k, users) {
    const names = state.names;
    const row = el('article', 'skill-row');
    row.dataset.skillId = k.id;
    row.dataset.source = SOURCES[k.source] ? k.source : 'imported';
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(selected === k.id));
    if (k.source !== 'seen') row.draggable = true;
    row.classList.toggle('in-use', users.length > 0);

    // A skill that just started being used lights up briefly; one that stays in use keeps its
    // steady highlight across re-renders.
    if (users.length) {
      litNow.add(k.id);
      row.classList.toggle('lit-new', !litBefore.has(k.id));
    }
    const title = el('div', 'skill-title');
    title.append(
      el('span', 'skill-dot'),
      el('b', '', k.name),
      el('span', 'skill-badge scope', SOURCES[k.source]?.badge || 'Library')
    );
    const warnings = Array.isArray(k.warnings) ? k.warnings : k.warnings ? [k.warnings] : [];
    if (warnings.length) {
      const w = el('span', 'sk-flag warn');
      w.innerHTML = icon('triangle-alert', 13);
      w.title = warnings.join('\n');
      title.append(w);
    }
    if (k.overlaps?.length) {
      const o = el('span', 'sk-flag');
      o.innerHTML = icon('link', 13) + '<em>' + k.overlaps.length + '</em>';
      o.title =
        'Covers the same topic as:\n' +
        k.overlaps.map(x => '• ' + x.name + ' — ' + x.why).join('\n');
      title.append(o);
    }
    title.title = k.path || k.name;
    const text = describe(k),
      desc = el(
        'p',
        'sk-desc',
        text ||
          (k.source === 'seen'
            ? 'Used by an agent; no SKILL.md for it in Technically Not’s library.'
            : 'No one-line description in its SKILL.md.')
      );
    desc.title = text;
    row.append(title, desc);
    const kws = listOf(k.keywords),
      kw = el('div', 'sk-kw');
    if (isAgentNew(k)) {
      const n = el('span', 'new', 'New · agent-written');
      n.title =
        'An agent saved this skill' +
        (k.everywhere ? ' and it loads in every new session' : '') +
        '. Open it to read it; you can switch it off or remove it there.';
      kw.append(n);
    }
    kws.slice(0, 3).forEach(w => kw.append(el('span', '', w)));
    if (kws.length > 3) {
      const m = el('span', 'more', '+' + (kws.length - 3));
      m.title = kws.slice(3).join(', ');
      kw.append(m);
    }
    row.append(kw);
    const foot = el('div', 'sk-foot'),
      who = el('div', 'skill-agents');
    if (k.everywhere) {
      const all = el('span', 'sk-every');
      all.dataset.everywhere = '1';
      all.title = 'Loads in every session Technically Not starts: ' + EVERY_CLIS;
      all.innerHTML = icon('zap', 12) + '<span>Every session</span>';
      who.append(all);
    }
    (k.agentIds || []).forEach(id => {
      if (names.has(id)) {
        const a = el('span', 'sk-who');
        a.innerHTML =
          avatar(names.get(id)) + '<span class="sk-sr">' + esc(names.get(id)) + '</span>';
        a.title = names.get(id);
        who.append(a);
      }
    });
    foot.append(who, stamp(k, users));
    const actions = el('div', 'skill-actions');
    if (k.source !== 'seen') {
      const apply = el('button');
      apply.type = 'button';
      apply.dataset.act = 'apply';
      apply.title = 'Apply to…';
      apply.setAttribute('aria-label', 'Apply ' + k.name + ' to…');
      apply.innerHTML = icon('plus', 14);
      actions.append(apply);
    }
    if (k.source === 'imported') {
      const remove = el('button');
      remove.type = 'button';
      remove.dataset.act = 'remove';
      remove.title = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + k.name);
      remove.innerHTML = icon('trash-2', 14);
      actions.append(remove);
    }
    foot.append(actions);
    row.append(foot);
    return row;
  }

  // Overlaps view: each group of same-topic skills is a stack of linked mini cards, with why they
  // match.
  function renderStacks(hits, usersOf) {
    const groups = overlapGroups(hits.filter(k => k.source !== 'seen'));
    if (!groups.length) {
      groupsEl.replaceChildren(
        el(
          'p',
          'skills-empty sk-none',
          'No overlapping skills. Skills that cover the same topic (shared keywords and description words) show up here as candidates to merge.'
        )
      );
      return;
    }
    const intro = el(
      'p',
      'sk-stacks-note',
      'Skills on the same topic, found by shared keywords and description words. Each group is a candidate to merge into one skill; agents can do it with tnai skill overlaps.'
    );
    const grid = el('div', 'sk-stacks');
    groups.forEach(g => {
      const stack = el('section', 'sk-stack'),
        head = el('header');
      head.innerHTML = icon('link', 14) + '<b>' + g.length + ' skills on one topic</b>';
      stack.append(head);
      g.forEach(k => {
        const m = el('button', 'sk-link');
        m.type = 'button';
        m.dataset.act = 'select';
        m.dataset.id = k.id;
        m.setAttribute('aria-pressed', String(selected === k.id));
        const why = [
          ...new Set(
            (k.overlaps || [])
              .filter(o => g.some(x => norm(x.name) === norm(o.name)))
              .map(o => o.why)
              .filter(Boolean)
          ),
        ];
        m.innerHTML =
          '<span class="sk-link-dot"></span><span class="sk-link-txt"><span class="sk-link-top"><b>' +
          esc(k.name) +
          '</b><span class="skill-badge scope">' +
          esc(SOURCES[k.source]?.badge || 'Library') +
          '</span>' +
          (usersOf(k).length ? '<span class="skill-badge live">In use</span>' : '') +
          '</span><small>' +
          esc(describe(k) || 'No one-line description.') +
          '</small>' +
          (why.length ? '<em>' + esc(why.join(' · ')) + '</em>' : '') +
          '</span>';
        stack.append(m);
      });
      grid.append(stack);
    });
    groupsEl.replaceChildren(intro, grid);
  }

  // ---- Detail panel ----
  const bodies = new Map(); // id -> { stamp, loading, html | error, truncated }

  function loadBody(k) {
    const stampKey = k.id + '|' + (k.editedAt || '');
    const have = bodies.get(k.id);
    if (have && have.stamp === stampKey) return have;
    const entry = { stamp: stampKey, loading: true };
    bodies.set(k.id, entry);
    if (k.source === 'seen') {
      entry.loading = false;
      entry.error = 'Technically Not has no SKILL.md for this skill.';
      return entry;
    }
    if (!native()?.read) {
      entry.loading = false;
      entry.error = 'Reading SKILL.md needs the desktop app.';
      return entry;
    }
    Promise.resolve(native().read(k.id))
      .then(unwrap)
      .then(r => {
        const text = String(r?.text || '').replace(
          /^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/,
          ''
        );
        entry.html = window.TnaiResults?.markdown
          ? window.TnaiResults.markdown(text)
          : '<pre>' + esc(text) + '</pre>';
        entry.truncated = !!r?.truncated;
      })
      .catch(error => {
        entry.error = 'Could not read SKILL.md: ' + error.message;
      })
      .finally(() => {
        entry.loading = false;
        detailKey = '';
        renderDetail();
      });
    return entry;
  }

  function renderDetail() {
    const k = selected && state.all.find(x => x.id === selected);
    const open = !!k;
    if (open === detailEl.hidden) {
      const flip = () => {
        detailEl.hidden = !open;
        bodyEl.classList.toggle('has-detail', open);
        if (!open) {
          detailEl.replaceChildren();
          delete detailEl.dataset.skillId;
        }
      };
      if (!open) {
        if (window.TnaiMotion && visible()) window.TnaiMotion.swap(flip, 'skill');
        else flip();
        detailKey = '';
        return;
      }
      if (window.TnaiMotion && visible()) {
        detailKey = '';
        window.TnaiMotion.swap(() => {
          flip();
          paintDetail(k);
        }, 'skill');
        return;
      }
      flip();
    }
    if (k) paintDetail(k);
  }

  function paintDetail(k) {
    const users = state.bySkill.get(k.id) || k.users || [];
    const body = loadBody(k),
      last = lastUseOf(k);
    const key = JSON.stringify([
      k,
      users,
      [...state.names],
      confirmRemove,
      body.loading,
      body.error,
      !!body.html,
      last?.at,
    ]);
    if (key === detailKey) return;
    detailKey = key;
    const sameSkill = detailEl.dataset.skillId === k.id,
      scroll = sameSkill ? detailEl.querySelector('.sk-d-scroll')?.scrollTop || 0 : 0;
    detailEl.dataset.skillId = k.id;
    detailEl.dataset.source = k.source;
    const src = SOURCES[k.source] ? k.source : 'imported',
      warnings = Array.isArray(k.warnings) ? k.warnings : k.warnings ? [k.warnings] : [];
    const kws = listOf(k.keywords),
      paths = listOf(k.paths),
      h = k.stats;
    const agentsWith = (k.agentIds || []).filter(id => state.names.has(id));
    const byName = new Map(state.all.map(x => [norm(x.name), x]));
    const btn = (act, ic, label, cls = '') =>
      '<button type="button" class="sk-btn ' +
      cls +
      '" data-act="' +
      act +
      '">' +
      icon(ic, 15) +
      '<span>' +
      label +
      '</span></button>';
    const fact = (label, value, title) =>
      value
        ? '<div><dt>' +
          label +
          '</dt><dd' +
          (title ? ' title="' + esc(title) + '"' : '') +
          '>' +
          value +
          '</dd></div>'
        : '';
    detailEl.innerHTML =
      '<header class="sk-d-head"><span class="skill-dot' +
      (users.length ? ' on' : '') +
      '"></span><div class="sk-d-name"><h2 title="' +
      esc(k.name) +
      '">' +
      esc(k.name) +
      '</h2><span class="skill-badge scope">' +
      esc(SOURCES[src].badge) +
      '</span>' +
      (k.everywhere
        ? '<span class="skill-badge on">' + icon('zap', 11) + 'Every session</span>'
        : '') +
      '</div>' +
      '<button type="button" class="sk-x" data-act="close" aria-label="Close details" title="Close (Esc)">' +
      icon('x', 16) +
      '</button></header>' +
      '<div class="sk-d-scroll">' +
      '<p class="sk-d-desc">' +
      esc(
        describe(k) ||
          (k.source === 'seen'
            ? 'Used by an agent; no SKILL.md for it in Technically Not’s library.'
            : 'No one-line description in its SKILL.md.')
      ) +
      '</p>' +
      (k.source !== 'seen'
        ? '<div class="sk-d-actions">' +
          btn('apply', 'plus', 'Apply to…', 'primary') +
          (src === 'imported' && skillsApi()?.everywhere
            ? '<button type="button" class="sk-switch" data-act="everywhere" role="switch" aria-checked="' +
              !!k.everywhere +
              '" title="Load it in every session Technically Not starts: ' +
              EVERY_CLIS +
              ' (takes effect when a session starts)"><i></i><span>Every session</span></button>'
            : '') +
          (native()?.open
            ? btn('open', 'external-link', 'Open') + btn('reveal', 'folder', 'Show in folder')
            : '') +
          (src === 'imported' ? btn('remove', 'trash-2', 'Remove', 'danger') : '') +
          '</div>'
        : '') +
      (confirmRemove === k.id
        ? '<div class="sk-confirm" role="alertdialog" aria-label="Remove skill"><p>Remove “' +
          esc(k.name) +
          '” from Technically Not?' +
          (agentsWith.length
            ? ' It is attached to ' +
              agentsWith.length +
              ' agent' +
              (agentsWith.length > 1 ? 's' : '') +
              ' and will be taken off them.'
            : '') +
          '</p><div><button type="button" class="sk-btn danger" data-act="remove-yes">Remove</button><button type="button" class="sk-btn" data-act="remove-no">Cancel</button></div></div>'
        : '') +
      '<section class="sk-d-sec"><h3>Used by</h3><div class="sk-d-users">' +
      [...new Set(users)]
        .map(
          n =>
            '<div class="sk-d-user live">' +
            avatar(n) +
            '<b>' +
            esc(n) +
            '</b><small>in use now</small></div>'
        )
        .join('') +
      (k.everywhere
        ? '<div class="sk-d-user"><span class="sk-av every">' +
          icon('zap', 13) +
          '</span><b>Every session</b><small>loads when a session starts</small></div>'
        : '') +
      agentsWith
        .map(
          id =>
            '<div class="sk-d-user">' +
            avatar(state.names.get(id)) +
            '<b>' +
            esc(state.names.get(id)) +
            '</b><small>custom agent</small><button type="button" class="sk-x sm" data-act="detach" data-agent-id="' +
            esc(id) +
            '" aria-label="Take it off ' +
            esc(state.names.get(id)) +
            '" title="Take it off ' +
            esc(state.names.get(id)) +
            '">' +
            icon('x', 13) +
            '</button></div>'
        )
        .join('') +
      (!users.length && !k.everywhere && !agentsWith.length
        ? '<p class="sk-d-note">No agent has it yet. Apply it to a custom agent, drop the card on one, or turn it on for every session.</p>'
        : '') +
      '</div></section>' +
      '<section class="sk-d-sec"><h3>Details</h3><dl class="sk-d-facts">' +
      (k.source !== 'seen'
        ? fact(
            'Last used',
            users.length
              ? 'Now'
              : last
                ? esc(when(last.at)) + (last.by ? ' · ' + esc(last.by) : '')
                : esc(stamp(k, users).textContent),
            last ? new Date(last.at).toLocaleString() : stamp(k, users).title
          )
        : '') +
      fact(
        'Edited',
        k.editedAt ? esc(when(k.editedAt)) : '',
        k.editedAt ? new Date(k.editedAt).toLocaleString() : ''
      ) +
      (h && k.source !== 'seen'
        ? fact(
            'Health',
            esc(
              h.suggested +
                '× suggested · ' +
                h.read +
                '× read' +
                (h.corrected ? ' · ' + h.corrected + '× corrected' : '')
            ),
            'Counted in Claude Code sessions since ' +
              new Date(h.since).toLocaleString() +
              ' (other CLIs have no hooks, so they are not counted).\nSuggested: offered for a prompt’s keywords or a file it owns. Read: a session opened it.\nCorrected / approved (inferred from the words of the next prompt after a turn that read it): ' +
              (h.corrected || 0) +
              ' / ' +
              (h.approved || 0)
          )
        : '') +
      (reach(k) ? fact('Reaches', esc(reach(k).text), reach(k).title) : '') +
      fact(
        'Where',
        k.path
          ? '<code>' +
              esc(k.path) +
              '</code><button type="button" class="sk-x sm" data-act="copy-path" aria-label="Copy the path" title="Copy the path">' +
              icon('copy', 13) +
              '</button>'
          : ''
      ) +
      '</dl></section>' +
      (kws.length
        ? '<section class="sk-d-sec"><h3>Keywords</h3><div class="sk-kw">' +
          kws.map(w => '<span>' + esc(w) + '</span>').join('') +
          '</div></section>'
        : '') +
      (paths.length
        ? '<section class="sk-d-sec"><h3>Suggested for files</h3><div class="sk-kw mono">' +
          paths.map(w => '<span>' + esc(w) + '</span>').join('') +
          '</div></section>'
        : '') +
      (warnings.length
        ? '<section class="sk-d-sec"><h3>Warnings</h3>' +
          warnings
            .map(
              w =>
                '<p class="sk-d-warn">' +
                icon('triangle-alert', 14) +
                '<span>' +
                esc(w) +
                '</span></p>'
            )
            .join('') +
          '</section>'
        : '') +
      (k.overlaps?.length
        ? '<section class="sk-d-sec"><h3>Overlaps</h3><div class="sk-d-links">' +
          k.overlaps
            .map(o => {
              const other = byName.get(norm(o.name));
              return (
                '<button type="button" class="sk-link sm" data-act="select" data-id="' +
                esc(other?.id || '') +
                '"' +
                (other ? '' : ' disabled') +
                '><span class="sk-link-dot"></span><span class="sk-link-txt"><b>' +
                esc(o.name) +
                '</b><em>' +
                esc(o.why || '') +
                '</em></span></button>'
              );
            })
            .join('') +
          '</div><p class="sk-d-note">A candidate to merge into one skill.</p></section>'
        : '') +
      '<section class="sk-d-sec sk-d-md"><h3>' +
      icon('file-text', 13) +
      'SKILL.md</h3>' +
      (body.loading
        ? '<p class="sk-d-note">Loading…</p>'
        : body.error
          ? '<p class="sk-d-note">' + esc(body.error) + '</p>'
          : '<div class="sk-md">' +
            body.html +
            '</div>' +
            (body.truncated
              ? '<p class="sk-d-note">Showing the first 256 KB. Open the file to read the rest.</p>'
              : '')) +
      '</section></div>';
    if (scroll) detailEl.querySelector('.sk-d-scroll').scrollTop = scroll;
  }

  function select(id, focusPanel) {
    if (selected === id) return;
    selected = id;
    confirmRemove = '';
    detailKey = '';
    if (id && agentNew.delete(id)) {
      keepNew();
      schedule();
      window.dispatchEvent(new CustomEvent('tnai:agent-skill-opened', { detail: { id } }));
    } // opened: no longer new (60 takes its bell notice away)
    page
      .querySelectorAll('.skill-row')
      .forEach(r => r.setAttribute('aria-selected', String(r.dataset.skillId === id)));
    page
      .querySelectorAll('.sk-link[data-id]')
      .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    renderDetail();
    if (focusPanel && id) requestAnimationFrame(() => detailEl.querySelector('.sk-x')?.focus());
  }

  function closeDetail() {
    const back =
      selected && page.querySelector('.skill-row[data-skill-id="' + CSS.escape(selected) + '"]');
    select('');
    back?.focus();
  }

  // ---- Apply menu (also used by agent cards in 11 through window.TnaiSkillsUI) ----
  let menu = null;

  function closeMenu() {
    menu?.remove();
    menu = null;
  }

  function openApply(anchor, { skillId, agentId }) {
    closeMenu();
    menu = el('div', 'tnai-skill-menu');
    menu.setAttribute('role', 'menu');

    // `stay`: the list stays open after a pick, so several can be chosen in a row; it closes on a
    // click outside it or Escape (listen below).
    const item = (label, note, disabled, onPick, tip, withAvatar, stay) => {
      const b = el('button');
      b.type = 'button';
      b.disabled = !!disabled;
      b.setAttribute('role', 'menuitem');
      if (tip) b.title = tip;
      if (withAvatar) b.insertAdjacentHTML('beforeend', avatar(label));
      b.append(el('span', '', label));
      if (note || stay) b.append(el('em', '', note || ''));
      b.onclick = async () => {
        if (!stay) closeMenu();
        await onPick(b);
        schedule();
      };
      menu.append(b);
      return b;
    };
    if (skillId) {
      const skill = list().find(k => k.id === skillId),
        agents = customAgents();
      menu.append(el('small', '', 'Give “' + (skill?.name || skillId) + '” to:'));

      // Library skills can also load in every session of a skill-capable CLI, not only custom
      // agents.
      if (skill?.source === 'imported' && skillsApi()?.everywhere)
        item(
          'Every session',
          skill.everywhere ? '✓ on · click to turn off' : 'off · click to turn on',
          false,
          () => setEverywhere(skill)
        );
      if (!agents.length)
        menu.append(
          el('small', '', 'No custom agents yet. Create one in Settings › Agents › Custom agents.')
        );
      agents.forEach(a => {
        const has = (a.skillIds || []).includes(skillId);
        item(
          a.name,
          has ? '✓ added · click to remove' : a.base,
          a.supportsSkills === false && !has,
          () => (has ? detach(a.id, [skillId]) : attach(a.id, [skillId])),
          a.supportsSkills === false ? a.base + ' can’t load skills per session yet' : '',
          true
        );
      });
    } else {
      const agent = customAgents().find(a => a.id === agentId),
        skills = list();
      menu.append(el('small', '', 'Skills for ' + (agent?.name || 'this agent') + ':'));
      if (!skills.length)
        menu.append(el('small', '', 'The library is empty. Import skills on the Skills page.'));

      // The list stays open, since someone may want to add five skills in
      // a row: each row turns to its new state when its own change went through, and can be
      // pressed again to take it back.
      skills.forEach(k => {
        let has = (agent?.skillIds || []).includes(k.id);
        const note = () => (has ? '✓ added · click to remove' : SOURCES[k.source]?.badge || '');
        item(
          k.name,
          note(),
          false,
          async b => {
            if (b.dataset.busy) return;
            b.dataset.busy = '1';
            try {
              if (await (has ? detach(agentId, [k.id]) : attach(agentId, [k.id]))) {
                has = !has;
                b.querySelector('em').textContent = note();
              }
            } finally {
              delete b.dataset.busy;
            }
          },
          '',
          false,
          true
        );
      });
    }

    // In the anchor's own window (a card popped out into its own window opens the menu there).
    const home = anchor.ownerDocument || document;
    home.body.append(menu);
    listen(home);
    window.TnaiFloat?.attach(anchor, menu, { placement: 'bottom-start' });

    // preventScroll: the menu is placed a moment later (TnaiFloat); until then it sits at the end
    // of the page, and a plain focus() would scroll the whole app up to reach it, leaving the
    // bottom half blank (seen 2026-10-01 after clicking an agent on the Skills page).
    menu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  async function setEverywhere(skill) {
    try {
      await skillsApi().everywhere(skill.id, !skill.everywhere);
      say(
        '“' +
          skill.name +
          '” ' +
          (skill.everywhere ? 'turned off' : 'turned on') +
          ' for every session · takes effect when a session starts'
      );
    } catch (error) {
      say('Could not change it: ' + error.message);
    }
  }
  const listened = new WeakSet();

  function listen(doc) {
    if (listened.has(doc)) return;
    listened.add(doc);
    doc.addEventListener(
      'mousedown',
      event => {
        if (menu && !menu.contains(event.target)) closeMenu();
      },
      true
    );
    doc.addEventListener(
      'keydown',
      event => {
        if (menu && event.key === 'Escape') {
          event.stopPropagation();
          closeMenu();
        }
      },
      true
    );
  }
  listen(document);
  window.addEventListener('resize', closeMenu);

  // ---- Page actions ----
  page.addEventListener('click', async event => {
    const button = event.target.closest('button[data-act]');
    if (!button) {
      const row = event.target.closest('.skill-row');
      if (row) select(row.dataset.skillId === selected ? '' : row.dataset.skillId);
      return;
    }
    const act = button.dataset.act,
      inDetail = !!button.closest('.sk-detail');
    const skillId = inDetail ? selected : button.closest('[data-skill-id]')?.dataset.skillId;
    const skill = list().find(k => k.id === skillId);
    if (act === 'toggle-group') {
      expanded.has(button.dataset.source)
        ? expanded.delete(button.dataset.source)
        : expanded.add(button.dataset.source);
      schedule();
      return;
    }
    if (act === 'filter') {
      filter = button.dataset.filter;
      remember();
      schedule();
      return;
    }
    if (act === 'select') {
      if (button.dataset.id) select(button.dataset.id);
      return;
    }
    if (act === 'close') {
      closeDetail();
      return;
    }
    if (act === 'import-files') fileInput.click();
    if (act === 'import-folder') importSkills('folder');
    if (act === 'apply') openApply(button, { skillId });
    if (act === 'agent-menu') openApply(button, { agentId: button.dataset.agentId });
    if (act === 'everywhere' && skill) {
      await setEverywhere(skill);
      schedule();
    }
    if (act === 'detach' && skillId) {
      if (await detach(button.dataset.agentId, [skillId])) schedule();
    }
    if ((act === 'open' || act === 'reveal') && skillId) {
      try {
        unwrap(await native().open(skillId, act === 'reveal'));
      } catch (error) {
        say('Could not open it: ' + error.message);
      }
    }
    if (act === 'copy-path' && skill?.path) {
      try {
        await navigator.clipboard.writeText(skill.path);
        say('Path copied');
      } catch {
        say('Could not copy the path');
      }
    }

    // Remove asks first, inside the detail panel (no browser confirm box).
    if (act === 'remove' && skillId) {
      select(skillId);
      confirmRemove = skillId;
      detailKey = '';
      renderDetail();
      requestAnimationFrame(() => detailEl.querySelector('[data-act="remove-yes"]')?.focus());
    }
    if (act === 'remove-no') {
      confirmRemove = '';
      detailKey = '';
      renderDetail();
    }
    if (act === 'remove-yes' && skillId) {
      confirmRemove = '';
      try {
        const result = await skillsApi()?.remove?.(skillId);
        if (result && result.ok === false)
          say(result.error?.message || result.error || 'Could not remove it.');
        else {
          say('Removed “' + (skill?.name || skillId) + '”');
          select('');
        }
      } catch (error) {
        say('Could not remove it: ' + error.message);
      }
    }
  });
  page.addEventListener('keydown', event => {
    const row = event.target.closest?.('.skill-row');
    if (row && event.target === row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select(row.dataset.skillId, true);
    }
    if (event.key === 'Escape' && selected && !menu) {
      event.preventDefault();
      closeDetail();
    }
  });

  // "/" jumps to the search while the page is shown and nothing else takes typing.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || !visible() || event.ctrlKey || event.metaKey || event.altKey) return;
    const t = event.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    event.preventDefault();
    filterEl.focus();
    filterEl.select();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.length) importSkills(fileInput.files);
    fileInput.value = '';
  });
  filterEl.addEventListener('input', schedule);

  // Cards drag onto agent targets; files from Explorer drop anywhere on the page to import (an
  // overlay shows while they are over it).
  page.addEventListener('dragstart', event => {
    const row = event.target.closest?.('.skill-row[draggable=true]');
    if (!row) return;
    dragging = row.dataset.skillId;
    row.classList.add('dragging');
    page.classList.add('skill-drag');
    event.dataTransfer.setData(DRAG_TYPE, dragging);
    event.dataTransfer.setData(
      'text/plain',
      row.querySelector('.skill-title b')?.textContent || dragging
    );
    event.dataTransfer.effectAllowed = 'copy';
  });
  page.addEventListener('dragend', () => {
    dragging = null;
    page.classList.remove('file-over', 'skill-drag');
    page
      .querySelectorAll('.dragging,.drop-ok,.drop-no')
      .forEach(e => e.classList.remove('dragging', 'drop-ok', 'drop-no'));
    renderKey = '';
    schedule();
  });
  const isSkillDrag = event => [...(event.dataTransfer?.types || [])].includes(DRAG_TYPE);
  const isFileDrag = event => [...(event.dataTransfer?.types || [])].includes('Files');
  page.addEventListener('dragover', event => {
    const target = event.target.closest?.('.skills-target');
    page.querySelectorAll('.drop-ok,.drop-no').forEach(e => {
      if (e !== target) e.classList.remove('drop-ok', 'drop-no');
    });
    if (target && isSkillDrag(event)) {
      const ok = target.dataset.accept === '1';
      target.classList.toggle('drop-ok', ok);
      target.classList.toggle('drop-no', !ok);
      if (ok) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
      return;
    }
    if (!isFileDrag(event)) return;
    if (!page.classList.contains('file-over')) {
      const r = page.getBoundingClientRect();
      Object.assign(dropOverlay.style, {
        left: r.left + 8 + 'px',
        top: r.top + 8 + 'px',
        width: r.width - 16 + 'px',
        height: r.height - 16 + 'px',
      });
      page.classList.add('file-over');
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  page.addEventListener('dragleave', event => {
    if (!page.contains(event.relatedTarget)) {
      page.classList.remove('file-over');
      page
        .querySelectorAll('.drop-ok,.drop-no')
        .forEach(e => e.classList.remove('drop-ok', 'drop-no'));
    }
  });
  page.addEventListener('drop', async event => {
    const target = event.target.closest?.('.skills-target');
    if (target && isSkillDrag(event)) {
      event.preventDefault();
      const skillId = event.dataTransfer.getData(DRAG_TYPE);
      target.classList.remove('drop-ok', 'drop-no');
      if (target.dataset.accept !== '1') {
        say(target.title);
        return;
      }
      if (target.dataset.paneId) {
        window.TnaiSessionSkills?.attach(target.dataset.paneId, skillId);
        return;
      }
      if (await attach(target.dataset.agentId, [skillId]))
        say(
          'Added ' +
            (list().find(k => k.id === skillId)?.name || 'skill') +
            ' to ' +
            target.querySelector('b').textContent
        );
      return;
    }
    if (isFileDrag(event)) {
      event.preventDefault();
      page.classList.remove('file-over');
      if (event.dataTransfer.files?.length) importSkills(event.dataTransfer.files);
    }
  });

  // ---- Live updates: library, agents, sessions, and skills seen in output ----
  const changed = () => {
    window.dispatchEvent(new CustomEvent('tnai:skills-changed'));
    schedule();
  };
  const subscribed = { skills: false, agents: false };

  function subscribe() {
    if (!subscribed.skills && skillsApi()?.onChange) {
      skillsApi().onChange(changed);
      subscribed.skills = true;
    }
    if (!subscribed.agents && agentsApi()?.onChange) {
      agentsApi().onChange(() => {
        window.dispatchEvent(new CustomEvent('tnai:skills-changed'));
        if (visible()) schedule();
      });
      subscribed.agents = true;

      // the event stays for 11, 25 and 101; the page itself is drawn only while shown
      // (tnai:skills-page-shown draws it on return)
    }
  }
  subscribe();
  [
    'tnai:custom-agents-changed',
    'tnai:skill-activity',
    'tnai:skills-page-shown',
    'tnai:session-skills-changed',
  ].forEach(name =>
    window.addEventListener(name, () => {
      subscribe();
      schedule();
    })
  );

  // Skill health counts change in the main process as sessions work; fetch them fresh whenever the
  // page is opened.
  window.addEventListener('tnai:skills-page-shown', () => {
    try {
      Promise.resolve(skillsApi()?.refresh?.()).catch(() => {});
    } catch {}
  });
  window.TnaiAgents?.onChange?.(() => {
    if (visible()) schedule();
  });
  schedule();

  window.TnaiSkillsUI = {
    openApply,
    closeMenu,
    matches,
    attach,
    detach,
    importSkills,
    DRAG_TYPE,
    sourceBadge: source => SOURCES[source]?.badge || '',
    select,
    // 60: an agent saved this skill (new or updated) → marked until opened; isAgentNew(skill) says
    // whether its mark is still on.
    agentSaved: id => {
      if (!id) return;
      agentNew.add(String(id));
      keepNew();
      schedule();
    },
    isAgentNew,
  };
})();
