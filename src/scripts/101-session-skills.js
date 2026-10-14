/*
 * Technically Not · 101-session-skills.js — Desktop app only in effect: skills given to one running
 * agent session for its whole life. A Skills button (+ up to 2 attached-skill chips and "+N") in
 * each agent terminal panel's header and the Overview focus view bar opens a small popup
 * (TnaiFloat): search, the library as draggable cards (click = give it to this agent), and what
 * this agent already has (✕ takes it off). Skill cards from this popup and from the Skills page can
 * be dropped on terminal panels, Agent Tree rows (94), focus view chips and the focus view (99);
 * only agents that can take skills light up, others say why. How it works (no CLI reloads skills
 * mid-session): the SKILL.md text is sent to the running session once through TnaiAgents.send,
 * framed as "follow this for the rest of this session", and the attachment is recorded per panel +
 * session start (localStorage) so every later composer prompt (11) ends with a one-line reminder
 * naming it. A new start of the panel's session, or closing the panel, ends it. Only CLIs listed as
 * skill-capable (TnaiSkills.clis, from the registry) take drops. Exposes window.TnaiSessionSkills.
 * Styles: src/styles/22-session-skills-purple.css. How long: the popup's
 * "Give for" choice, This task (default) or Whole session, applies to clicks and drops. A task
 * skill is armed by the first composer prompt after it was given (note()) and ends by itself when
 * the turn that prompt started finishes normally (42's pushed turns, exact for Claude Code);
 * nothing is sent then: the next prompt carries one "stop following it" line. A task skill whose
 * task is typed straight into the terminal is never armed, so it stays until taken off or the
 * session ends. "Clear all" takes every skill off with one message.
 */
(() => {
  const KEY = 'tnai.session-skills.v1',
    SCOPE_KEY = 'tnai.session-skills-scope.v1',
    DRAG_TYPE = 'application/x-tnai-skill',
    INLINE_MAX = 48 * 1024;
  let scope = 'task';
  try {
    if (localStorage.getItem(SCOPE_KEY) === 'session') scope = 'session';
  } catch {}
  const forWhat = how => (how === 'task' ? 'this task' : 'this session');
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
    );
  const icon = (name, size = 14) => window.TnaiIcon?.(name, { size }) || '';
  const sessions = () => {
    try {
      return window.TnaiAgents?.sessions?.() || [];
    } catch {
      return [];
    }
  };
  const sessionOf = paneId => sessions().find(s => s.paneId === paneId) || null;
  const library = () => {
    try {
      return (window.TnaiSkills?.list?.() || []).filter(k => k.source !== 'seen');
    } catch {
      return [];
    }
  };
  const clis = () => {
    try {
      return window.TnaiSkills?.clis?.() || ['Claude Code'];
    } catch {
      return ['Claude Code'];
    }
  };
  const describe = k =>
    /^[>|][+-]?\d*$/.test(String(k.description || '').trim()) ? '' : String(k.description || '');

  // ---- Records: paneId -> { startedAt, skills: [{ id, name, path }] }, valid only for the session
  // start it was made in ----
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    store = {};
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {}
  };

  function list(paneId) {
    const s = sessionOf(paneId),
      rec = store[paneId];
    if (!s || !rec || !s.running || rec.startedAt !== s.startedAt) return [];
    return rec.skills;
  }

  // Drop records whose session has ended or started again (a new start is a new life); kept while
  // the replay after a reload is pending.
  function prune() {
    let dirty = false;
    for (const id of Object.keys(store)) {
      const s = sessionOf(id);
      if (
        s &&
        s.startedAt &&
        (s.startedAt !== store[id].startedAt || (!s.running && s.status !== 'starting'))
      ) {
        delete store[id];
        dirty = true;
      }
    }
    if (dirty) save();
    return dirty;
  }

  // Why this agent can't take a skill now, or '' when it can.
  function refusal(paneId) {
    const s = sessionOf(paneId);
    if (!s) return 'No agent is running in this thread.';
    if (s.agent === 'Terminal')
      return 'A plain shell can’t take skills. Start an agent CLI here first.';
    if (!clis().includes(s.agent))
      return s.agent + ' has no skill support in Technically Not yet, so it can’t take skills.';
    if (!s.running) return 'Start ' + s.name + ' first: skills go to a running session.';
    return '';
  }

  async function attach(paneId, skillId, how = scope) {
    how = how === 'session' ? 'session' : 'task';
    const why = refusal(paneId);
    if (why) {
      say(why);
      return false;
    }
    const s = sessionOf(paneId),
      k = library().find(x => x.id === skillId);
    if (!k) {
      say('That skill is no longer in the library.');
      return false;
    }
    if (list(paneId).some(x => x.id === k.id)) {
      say(s.name + ' already has ' + k.name + '.');
      return true;
    }
    let text = '',
      truncated = false,
      file = (k.path || '') + '\\SKILL.md';
    try {
      const r = await window.tnaiNative?.skills?.read?.(k.id);
      if (!r?.ok) throw new Error(r?.error?.message || 'the desktop app did not answer');
      text = String(r.value?.text || '');
      truncated = !!r.value?.truncated;

      // the real path main read (a "\" join is no path on Linux or macOS)
      if (r.value?.file) file = r.value.file;
    } catch (error) {
      say('Could not read ' + k.name + ': ' + error.message);
      return false;
    }
    const body =
      text && !truncated && text.length <= INLINE_MAX
        ? 'Its full text is below. Other files it mentions are in ' +
          k.path +
          '.\n\n<skill name="' +
          k.name +
          '">\n' +
          text.trim() +
          '\n</skill>'
        : 'Read ' + file + ' now (it is too long to paste here) and any files it points to.';
    const message =
      '[TN.ai] The user attached the skill "' +
      k.name +
      '" to you ' +
      (how === 'task'
        ? 'for one task: the next task they send you. Follow it on that task until it is finished and reported; you will be told when to stop. '
        : 'for the rest of this session. Follow it on every task from now until this session ends, also after a compaction. ') +
      body;
    if (!window.TnaiAgents?.send?.(paneId, message)) {
      say(s.name + ' is not running.');
      return false;
    }
    const rec =
      store[paneId]?.startedAt === s.startedAt
        ? store[paneId]
        : (store[paneId] = { startedAt: s.startedAt, skills: [] });

    // given again: no "stop following it" line is owed for it any more
    if (rec.ended) rec.ended = rec.ended.filter(n => n !== k.name);
    rec.skills.push({ id: k.id, name: k.name, path: k.path || '', scope: how });
    save();
    changed();
    say('Gave ' + k.name + ' to ' + s.name + ' for ' + forWhat(how));
    return true;
  }

  // A record with nothing attached and no "stop following" line still owed is dropped.
  const tidy = paneId => {
    const rec = store[paneId];
    if (rec && !rec.skills.length && !rec.ended?.length) delete store[paneId];
  };

  function detach(paneId, skillId) {
    const rec = store[paneId],
      k = rec?.skills.find(x => x.id === skillId);
    if (!k) return false;
    rec.skills = rec.skills.filter(x => x.id !== skillId);
    tidy(paneId);
    save();
    changed();
    const s = sessionOf(paneId);
    if (s?.running)
      window.TnaiAgents.send(
        paneId,
        '[TN.ai] The user took the skill "' + k.name + '" off you. Stop following it from now on.'
      );
    say('Took ' + k.name + ' off ' + (s?.name || 'the agent'));
    return true;
  }

  // Clear all: every skill off with one message (one turn for the agent, not one per skill).
  function detachAll(paneId) {
    const rec = store[paneId],
      names = (rec?.skills || []).map(k => k.name);
    if (!names.length) return false;
    rec.skills = [];
    tidy(paneId);
    save();
    changed();
    const s = sessionOf(paneId);
    if (s?.running)
      window.TnaiAgents.send(
        paneId,
        '[TN.ai] The user took ' +
          (names.length === 1 ? 'the skill "' + names[0] + '"' : 'these skills') +
          ' off you' +
          (names.length === 1 ? '' : ': ' + names.join(', ')) +
          '. Stop following ' +
          (names.length === 1 ? 'it' : 'them') +
          ' from now on.'
      );
    say(
      'Took ' +
        (names.length === 1 ? names[0] : names.length + ' skills') +
        ' off ' +
        (s?.name || 'the agent')
    );
    return true;
  }

  // The line every later composer prompt ends with (11). It also arms this-task skills: the turn
  // this prompt starts is their task.
  function note(paneId) {
    const have = list(paneId),
      rec = store[paneId];
    const stay = have.filter(k => k.scope !== 'task').map(k => k.name),
      once = have.filter(k => k.scope === 'task');
    const ended = rec && sessionOf(paneId)?.startedAt === rec.startedAt ? rec.ended || [] : [];
    let dirty = false;
    for (const k of once)
      if (!k.armedAt) {
        k.armedAt = Date.now();
        dirty = true;
      }
    if (ended.length) {
      delete rec.ended;
      tidy(paneId);
      dirty = true;
    }
    if (dirty) save();
    const lines = [
      stay.length
        ? 'Skills attached to you for this session: ' + stay.join(', ') + '. Keep following them.'
        : '',
      once.length
        ? 'Skills attached to you for this task only: ' +
          once.map(k => k.name).join(', ') +
          '. Follow them until this task is finished and reported.'
        : '',
      ended.length
        ? (ended.length === 1
            ? 'The skill ' + ended[0] + ' was'
            : 'The skills ' + ended.join(', ') + ' were') +
          ' for an earlier task only. Stop following ' +
          (ended.length === 1 ? 'it' : 'them') +
          '.'
        : '',
    ].filter(Boolean);
    return lines.length ? '\n\n(' + lines.join(' ') + ')' : '';
  }

  // A this-task skill ends when the turn its prompt started has finished normally (not on an
  // interrupt: the user will send the task again).
  function settle(paneId) {
    const rec = store[paneId],
      t = window.TnaiTurns?.get?.(paneId);
    if (
      !rec ||
      !t?.endedAt ||
      t.endedBy === 'interrupted' ||
      sessionOf(paneId)?.startedAt !== rec.startedAt
    )
      return;
    const done = rec.skills.filter(
      k =>
        k.scope === 'task' && k.armedAt && t.startedAt >= k.armedAt - 3000 && t.endedAt >= k.armedAt
    );
    if (!done.length) return;
    rec.skills = rec.skills.filter(k => !done.includes(k));
    rec.ended = [...(rec.ended || []), ...done.map(k => k.name)];
    save();
    changed();
    say(
      (done.length === 1 ? done[0].name : done.length + ' skills') +
        ' ended with ' +
        (sessionOf(paneId)?.name || 'the agent') +
        '’s task'
    );
  }
  window.addEventListener('tnai:turn', e => {
    if (e.detail?.paneId && store[e.detail.paneId]) settle(e.detail.paneId);
  });

  // ---- Loaded: every skill a running session has, with a number for the total.
  // Three real sources, each name counted once: attached here, library skills on
  // for every session (only for the CLIs that load them, 18's EVERY_CLIS), and skills the agent was
  // seen using by itself (13's in-use names, kept here for the session's life; in memory, so they
  // count from when the app opened). ----
  const EVERY_CLIS = ['Claude Code', 'OpenCode', 'Codex', 'GitHub Copilot'];
  const nameKey = n =>
    String(n || '')
      .toLowerCase()
      .trim()
      .split(':')
      .pop();
  const usedBy = new Map(); // paneId -> { startedAt, names: Map(key -> name) }

  function loaded(paneId) {
    const s = sessionOf(paneId),
      none = { total: 0, attached: [], always: [], used: [] };
    if (!s || !s.running || s.agent === 'Terminal') return none;
    let rec = usedBy.get(paneId);
    if (!rec || rec.startedAt !== s.startedAt)
      usedBy.set(paneId, (rec = { startedAt: s.startedAt, names: new Map() }));
    try {
      for (const u of window.TnaiFileActivity?.skills?.(paneId) || [])
        rec.names.set(nameKey(u.name), u.name);
    } catch {}
    const seen = new Set(),
      take = names =>
        names.filter(n => {
          const k = nameKey(n);
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
    const attached = take(list(paneId).map(k => k.name));
    const always = EVERY_CLIS.includes(s.agent)
      ? take(
          library()
            .filter(k => k.everywhere)
            .map(k => k.name)
        )
      : [];
    const used = take([...rec.names.values()]);
    return { total: seen.size, attached, always, used };
  }
  const loadedTip = L =>
    L.total +
    ' skill' +
    (L.total === 1 ? '' : 's') +
    ' loaded this session: ' +
    [
      L.attached.length ? L.attached.length + ' attached' : '',
      L.always.length ? L.always.length + ' on for every session' : '',
      L.used.length ? L.used.length + ' it picked up by itself' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  window.addEventListener('tnai:skill-activity', () => {
    for (const id of usedBy.keys()) if (!sessionOf(id)?.running) usedBy.delete(id);

    // record what is in use now, before 13 clears it at the end of the turn
    sessions().forEach(s => loaded(s.paneId));
    schedule();
  });

  // ---- Chips: at most 2 names (Agent Tree rows: 1, max) + "+N"; hover shows the name, description
  // and how it works; ✕ detaches ----
  function chipsHtml(paneId, { button = false, max = 2 } = {}) {
    const have = list(paneId),
      why = refusal(paneId),
      s = sessionOf(paneId),
      L = button ? loaded(paneId) : null;
    if (!button && !have.length) return '';
    const info = k => {
      const full = library().find(x => x.id === k.id);
      return (
        k.name +
        (full && describe(full) ? ' · ' + describe(full) : '') +
        '\nAttached to ' +
        (s?.name || 'this agent') +
        (k.scope === 'task'
          ? ' for one task: it ends by itself when that task is finished.'
          : ' until its session ends.')
      );
    };
    const chip = k =>
      '<span class="tn-skl-chip" title="' +
      esc(info(k)) +
      '"><span>' +
      esc(k.name) +
      '</span><button type="button" data-skl-off="' +
      esc(k.id) +
      '" data-skl-pane="' +
      esc(paneId) +
      '" aria-label="Take ' +
      esc(k.name) +
      ' off">' +
      icon('x', 11) +
      '</button></span>';
    const more =
      have.length > max
        ? '<button type="button" class="tn-skl-more" data-skl-open="' +
          esc(paneId) +
          '" title="' +
          esc(
            have
              .slice(max)
              .map(k => k.name)
              .join(', ')
          ) +
          '">+' +
          (have.length - max) +
          '</button>'
        : '';
    const btn = button
      ? '<button type="button" class="tn-skl-btn" data-skl-open="' +
        esc(paneId) +
        '"' +
        (why ? ' aria-disabled="true"' : '') +
        ' title="' +
        esc(
          why ||
            'Skills for ' +
              (s?.name || 'this agent') +
              ': give it a skill for the rest of this session' +
              (L.total ? '\n' + loadedTip(L) : '')
        ) +
        '" aria-label="Skills' +
        (L.total ? ', ' + L.total + ' loaded' : '') +
        '">' +
        icon('sparkles', 14) +
        '<span>Skills</span>' +
        (L.total ? '<i>' + L.total + '</i>' : '') +
        '</button>'
      : '';
    return btn + have.slice(0, max).map(chip).join('') + more;
  }

  // ---- Terminal panel headers and the focus view bar ----
  const keys = new WeakMap();

  function paintPanels() {
    for (const pane of document.querySelectorAll('.terminal-pane[data-pane-id]')) {
      const head = pane.querySelector('.terminal-pane-head');
      if (!head) continue;
      const id = pane.dataset.paneId,
        s = sessionOf(id),
        show = !!s && s.agent !== 'Terminal';
      let group = head.querySelector(':scope>.tn-skl');
      if (!show) {
        if (group) {
          group.remove();
          keys.delete(head);
        }
        continue;
      }
      if (!group) {
        group = document.createElement('span');
        group.className = 'tn-skl';
        const state = head.querySelector(':scope>.terminal-pane-state'),
          tools = head.querySelector(':scope>.terminal-pane-tools');
        state || tools ? (state || tools).before(group) : head.append(group);
      }
      const html = chipsHtml(id, { button: true });
      if (keys.get(head) !== html) {
        keys.set(head, html);
        group.innerHTML = html;
      }
    }
    const bar = document.querySelector('.tf .tf-bar'),
      id = focusPane();
    if (bar) {
      let group = bar.querySelector(':scope>.tn-skl');
      if (!group) {
        group = document.createElement('span');
        group.className = 'tn-skl tn-skl-bar';
        const tp = bar.querySelector('.tf-tp');
        tp ? tp.before(group) : bar.append(group);
      }
      const s = id && sessionOf(id),
        html = s && s.agent !== 'Terminal' ? chipsHtml(id, { button: true }) : '';
      if (keys.get(bar) !== html) {
        keys.set(bar, html);
        group.innerHTML = html;
      }
    }
  }
  const focusPane = () =>
    document.querySelector('.tf:not([hidden]) .tf-head .pgo-row[data-pane]')?.dataset.pane || '';

  // ---- Popup ----
  const pop = document.createElement('div');
  pop.className = 'tn-skp';
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  document.body.append(pop);
  let popPane = '',
    popAnchor = null,
    popQuery = '';

  function renderPop() {
    const s = sessionOf(popPane),
      have = list(popPane),
      why = refusal(popPane);
    const q = popQuery.trim().toLowerCase();
    const all = library(),
      hits = all.filter(
        k =>
          !q ||
          [k.name, describe(k), k.keywords].some(x =>
            String(x || '')
              .toLowerCase()
              .includes(q)
          )
      );
    const shown = hits.slice(0, 60);
    pop.setAttribute('aria-label', 'Skills for ' + (s?.name || 'this agent'));
    const had = pop.querySelector('.tn-skp-q');
    const listHtml = shown
      .map(k => {
        const on = have.some(x => x.id === k.id);
        return (
          '<button type="button" class="tn-skp-item' +
          (on ? ' on' : '') +
          '" draggable="true" data-skill-id="' +
          esc(k.id) +
          '" aria-pressed="' +
          on +
          '" title="' +
          esc(
            (on
              ? 'Attached · click to take it off. '
              : 'Click to give it to ' +
                (s?.name || 'this agent') +
                ' for ' +
                forWhat(scope) +
                ', or drag it onto any agent. ') + describe(k)
          ) +
          '"><b>' +
          esc(k.name) +
          (on ? icon('check', 12) : '') +
          '</b><small>' +
          esc(describe(k) || 'No description') +
          '</small></button>'
        );
      })
      .join('');
    const pick = (how, label, tip) =>
      '<button type="button" class="tn-skl-more" data-skl-scope="' +
      how +
      '" aria-pressed="' +
      (scope === how) +
      '" title="' +
      esc(tip) +
      '">' +
      label +
      '</button>';
    const body =
      '<div class="tn-skp-have">' +
      (have.length
        ? have
            .map(
              k =>
                '<span class="tn-skl-chip" title="' +
                esc(
                  k.scope === 'task'
                    ? 'For one task: ends by itself when that task is finished'
                    : 'For the whole session'
                ) +
                '"><span>' +
                esc(k.name) +
                '</span><button type="button" data-skl-off="' +
                esc(k.id) +
                '" data-skl-pane="' +
                esc(popPane) +
                '" aria-label="Take ' +
                esc(k.name) +
                ' off">' +
                icon('x', 11) +
                '</button></span>'
            )
            .join('')
        : '<small>None yet</small>') +
      (have.length > 1
        ? '<button type="button" class="tn-skl-more tn-skp-clear" data-skl-clear="' +
          esc(popPane) +
          '" title="Take every skill off ' +
          esc(s?.name || 'this agent') +
          '">Clear all</button>'
        : '') +
      '</div>' +
      '<div class="tn-skp-scope" role="group" aria-label="How long a skill stays"><span>Give for</span>' +
      pick(
        'task',
        'This task',
        'The skill ends by itself when the agent finishes the next task you send from the prompt box'
      ) +
      pick(
        'session',
        'Whole session',
        'The skill stays until this agent’s session ends or you take it off'
      ) +
      '</div>' +
      (why ? '<p class="tn-skp-why">' + esc(why) + '</p>' : '') +
      '<div class="tn-skp-list" role="list">' +
      (listHtml ||
        '<p class="tn-skp-none">' +
          (all.length
            ? 'No skills match “' + esc(popQuery) + '”.'
            : 'No skills in the library yet. Import some on the Skills page.') +
          '</p>') +
      '</div>' +
      (hits.length > shown.length
        ? '<p class="tn-skp-none">' +
          (hits.length - shown.length) +
          ' more · search to narrow it down</p>'
        : '') +
      '<p class="tn-skp-foot">' +
      (scope === 'task'
        ? 'Ends by itself when the agent finishes the next task you send from the prompt box.'
        : 'Stays with this agent until its session ends. Each later prompt reminds it.') +
      ' ✕ tells the agent to stop; it is fully gone after its next compact.</p>';
    if (!had) {
      pop.innerHTML =
        '<div class="tn-skp-head"><b>Skills</b><small></small></div><label class="tn-skp-search">' +
        icon('search', 14) +
        '<input class="tn-skp-q" type="search" placeholder="Search skills" aria-label="Search skills"></label><div class="tn-skp-body"></div>';
      pop.querySelector('.tn-skp-q').addEventListener('input', e => {
        popQuery = e.target.value;
        renderPop();
      });
    }
    pop.querySelector('.tn-skp-head small').textContent =
      (s?.name || 'this agent') + ' · this session';

    // A repaint replaces the body: keep keyboard focus on the same control (a session change can
    // repaint while the user tabs through it).
    const at = document.activeElement,
      bodyEl = pop.querySelector('.tn-skp-body');
    const keep = !bodyEl.contains(at)
      ? ''
      : at.dataset.sklScope
        ? '[data-skl-scope="' + at.dataset.sklScope + '"]'
        : at.dataset.sklClear
          ? '[data-skl-clear]'
          : at.dataset.sklOff
            ? '[data-skl-off="' + CSS.escape(at.dataset.sklOff) + '"]'
            : at.dataset.skillId
              ? '.tn-skp-item[data-skill-id="' + CSS.escape(at.dataset.skillId) + '"]'
              : '';
    bodyEl.innerHTML = body;
    if (keep) bodyEl.querySelector(keep)?.focus({ preventScroll: true });
    pop.classList.toggle('off', !!why);
  }

  function openPop(anchor, paneId) {
    if (!pop.hidden && popPane === paneId && popAnchor === anchor) {
      closePop();
      return;
    }
    popPane = paneId;
    popAnchor = anchor;
    popQuery = '';
    pop.querySelector('.tn-skp-q') && (pop.querySelector('.tn-skp-q').value = '');
    renderPop();
    pop.hidden = false;
    window.TnaiFloat?.attach(anchor, pop, { placement: 'bottom-end' });
    Promise.resolve(window.TnaiSkills?.refresh?.())
      .then(() => {
        if (!pop.hidden) renderPop();
      })
      .catch(() => {});
    pop.querySelector('.tn-skp-q')?.focus();
  }

  function closePop() {
    if (pop.hidden) return;
    pop.hidden = true;
    pop.classList.remove('dragging');
    window.TnaiFloat?.detach(pop);
    if (popAnchor?.isConnected) popAnchor.focus?.({ preventScroll: true });
    popAnchor = null;
  }
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && !pop.hidden) {
        e.stopPropagation();
        closePop();
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    e => {
      if (!pop.hidden && !pop.contains(e.target) && !popAnchor?.contains(e.target)) closePop();
    },
    true
  );

  // Clicks (capture: a tree row or panel head under the chip must not also react).
  window.addEventListener(
    'click',
    e => {
      const off = e.target.closest?.('[data-skl-off]'),
        open = e.target.closest?.('[data-skl-open]'),
        item = e.target.closest?.('.tn-skp-item');
      const how = e.target.closest?.('[data-skl-scope]'),
        clear = e.target.closest?.('[data-skl-clear]');
      if (how && pop.contains(how)) {
        e.stopPropagation();
        e.preventDefault();
        scope = how.dataset.sklScope === 'session' ? 'session' : 'task';
        try {
          localStorage.setItem(SCOPE_KEY, scope);
        } catch {}
        renderPop();
        pop.querySelector('[data-skl-scope="' + scope + '"]')?.focus();
        return;
      }
      if (clear && pop.contains(clear)) {
        e.stopPropagation();
        e.preventDefault();
        detachAll(clear.dataset.sklClear);
        return;
      }
      if (off) {
        e.stopPropagation();
        e.preventDefault();
        detach(off.dataset.sklPane, off.dataset.sklOff);
        return;
      }
      if (open) {
        e.stopPropagation();
        e.preventDefault();
        openPop(open, open.dataset.sklOpen);
        return;
      }
      if (item && pop.contains(item)) {
        const id = item.dataset.skillId;
        list(popPane).some(k => k.id === id) ? detach(popPane, id) : attach(popPane, id);
      }
    },
    true
  );
  window.addEventListener(
    'dblclick',
    e => {
      if (e.target.closest?.('.tn-skl')) e.stopPropagation();
    },
    true
  );

  // ---- Drag and drop: popup cards and Skills page cards onto agents ----
  pop.addEventListener('dragstart', e => {
    const item = e.target.closest?.('.tn-skp-item');
    if (!item) return;
    e.dataTransfer.setData(DRAG_TYPE, item.dataset.skillId);
    e.dataTransfer.setData('text/plain', item.querySelector('b')?.textContent || '');
    e.dataTransfer.effectAllowed = 'copy';

    // see-through while dragging, so agents under it can take the drop
    setTimeout(() => pop.classList.add('dragging'), 0);
  });
  const isSkillDrag = e => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE);

  // The agent under the pointer: a terminal panel, an Agent Tree row, a focus view chip, or the
  // focus view itself.
  function targetAt(el) {
    if (!el?.closest || el.closest('#skillsPage, .skills-target, .tn-skp')) return null;
    const t = el.closest(
      '.tf-chip[data-pane], .pgo-row[data-pane], .terminal-pane[data-pane-id], .tf:not([hidden])'
    );
    if (!t) return null;
    const paneId =
      t.dataset.pane || t.dataset.paneId || (t.classList.contains('tf') ? focusPane() : '');
    return paneId
      ? { el: t.classList.contains('pgo-row') && t.closest('.tf') ? t.closest('.tf') : t, paneId }
      : null;
  }
  let over = null,
    dragging = false;
  const clearOver = () => {
    if (over) {
      over.removeAttribute('data-skl-drop');
      over.removeAttribute('data-skl-why');
      over = null;
    }
  };

  function startDrag() {
    if (dragging) return;
    dragging = true;
    document.body.classList.add('tn-skl-dragging');
    document
      .querySelectorAll('.terminal-pane[data-pane-id], .pgo-row[data-pane], .tf-chip[data-pane]')
      .forEach(el => {
        if (!refusal(el.dataset.paneId || el.dataset.pane)) el.setAttribute('data-skl-can', '');
      });
  }

  function endDrag() {
    dragging = false;
    clearOver();
    document.body.classList.remove('tn-skl-dragging');
    document.querySelectorAll('[data-skl-can]').forEach(el => el.removeAttribute('data-skl-can'));
    pop.classList.remove('dragging');
  }
  window.addEventListener(
    'dragover',
    e => {
      if (!isSkillDrag(e)) return;
      startDrag();
      const t = targetAt(e.target);
      if (!t) {
        clearOver();
        return;
      }
      e.stopPropagation(); // not a panel reorder (04/07) or a file drop
      const why = refusal(t.paneId);
      if (over !== t.el) {
        clearOver();
        over = t.el;
      }
      over.setAttribute('data-skl-drop', why ? 'no' : 'ok');
      over.setAttribute(
        'data-skl-why',
        why ||
          'Drop to give it to ' +
            (sessionOf(t.paneId)?.name || 'this agent') +
            ' for ' +
            forWhat(scope)
      );
      if (why) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    true
  );
  window.addEventListener(
    'dragleave',
    e => {
      if (dragging && !e.relatedTarget) clearOver();
    },
    true
  );
  window.addEventListener(
    'drop',
    e => {
      if (!isSkillDrag(e)) return;
      const t = targetAt(e.target),
        skillId = e.dataTransfer.getData(DRAG_TYPE);
      if (!t) {
        endDrag();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      endDrag();
      const why = refusal(t.paneId);
      if (why) {
        say(why);
        return;
      }
      attach(t.paneId, skillId);
    },
    true
  );
  window.addEventListener('dragend', endDrag, true);

  // ---- Live updates: pushed session changes, library changes, panels closing ----
  let raf = 0;
  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (prune()) changed(true);
      paintPanels();
      if (!pop.hidden) {
        if (!sessionOf(popPane)) closePop();
        else {
          reanchor();
          renderPop();
        }
      }
    });
  };

  // A repaint replaced the button the popup hangs from: hang it from the new one (or close when
  // that agent's button is gone).
  function reanchor() {
    if (popAnchor?.isConnected) return;
    const next = [
      ...document.querySelectorAll('[data-skl-open="' + CSS.escape(popPane) + '"]'),
    ].find(b => b.getClientRects().length);
    if (!next) {
      closePop();
      return;
    }
    popAnchor = next;
    window.TnaiFloat?.attach(next, pop, { placement: 'bottom-end', fade: false });
  }

  function changed(quiet) {
    if (!quiet) schedule();
    window.dispatchEvent(new CustomEvent('tnai:session-skills-changed'));
  }
  let hooked = false;
  const hook = () => {
    if (!hooked && window.TnaiAgents?.onChange) {
      window.TnaiAgents.onChange(schedule);
      hooked = true;
    }
  };
  hook();
  ['tnai:custom-agents-changed', 'tnai:skills-changed', 'tnai:terminal-pane-renamed'].forEach(n =>
    window.addEventListener(n, () => {
      hook();
      schedule();
    })
  );
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (id && store[id]) {
      delete store[id];
      save();
      changed();
    } else schedule();
  });

  // The focus view shows another agent: its bar group follows (99 swaps the head row).
  const tfHead = document.querySelector('.tf .tf-head');
  if (tfHead) new MutationObserver(schedule).observe(tfHead, { childList: true });
  schedule();

  window.TnaiSessionSkills = {
    list,
    loaded,
    attach,
    detach,
    detachAll,
    scope: () => scope,
    refusal,
    note,
    chipsHtml,
    open: openPop,
    close: closePop,
    repaint: schedule,
    DRAG_TYPE,
  };
})();
