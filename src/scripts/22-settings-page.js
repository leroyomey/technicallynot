// Technically Not · 22-settings-page.js — Settings page (route `settings`): section list on the
// left, the selected section (title, one-line description, grouped setting cards) on the right;
// styles in src/styles/06-settings.css. Accounts: one card per agent CLI, its accounts as tiles
// with fuel gauges (15 into #tnaiAccountsMount). Usage: the token dashboard (#tnaiUsageMount,
// filled by 59). Insights, right after Usage: compare days and ways to use fewer tokens
// (#tnaiInsightsMount, filled by 197). Accounts and Usage were one section for a while; since
// 2026-09-29 they are separate again and each id opens its own section. Agents: a sub-nav of six
// topics (While working, After finishing, Custom agents, Delegation, Context, Scheduled prompts
// from 155), each with its live state read from its own controls, and one panel per topic; long
// explanations sit in a "?" tip, related rows under small captions, custom agents as a gallery of
// cards (17), Delegation limits from 43, Context from 54/76. General: the accent color (32),
// preferences for open files (live AI change cards, read by 26) and, on Windows, the PowerShell
// kept ready (10). Keyboard: the shortcut list (32), the snapshot key (62) and the hold-to-talk key
// (70) in one card (#tnaiKeyboardMount). Remembers the last section per viewer.
// window.TnaiSettings.open(tab) / get(key) / set(key, value); changes fire `tnai:setting-changed`
// {key, value}.
(() => {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  const desktop = !!window.tnaiNative?.accounts;
  const TAB_KEY = 'tnai.settings-tab.v1';

  // Per-viewer preferences: key -> { storage key, default }. Stored as 'on' / 'off'.
  const PREFS = {
    liveAiChanges: { store: 'tnai.live-ai-changes.v1', fallback: true },
    autoResumeLimit: { store: 'tnai.auto-resume-limit.v1', fallback: true },
    readyShell: { store: 'tnai.ready-shell.v1', fallback: true },
  };
  const getPref = key => {
    const p = PREFS[key];
    if (!p) return undefined;
    let v = null;
    try {
      v = localStorage.getItem(p.store);
    } catch {}
    return v === 'on' ? true : v === 'off' ? false : p.fallback;
  };
  const setPref = (key, value) => {
    const p = PREFS[key];
    if (!p) return;
    try {
      localStorage.setItem(p.store, value ? 'on' : 'off');
    } catch {}
    window.dispatchEvent(
      new CustomEvent('tnai:setting-changed', { detail: { key, value: !!value } })
    );
  };

  const icon = body =>
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const note = text => `<div class="set-empty">${text}</div>`;

  // Add a section here once it holds something that really works.
  const TABS = [
    {
      id: 'accounts',
      label: 'Accounts',
      about:
        'Your AI tools, the accounts and API keys each one uses, which one new sessions start with, and how much of each plan is used.',
      icon: icon(
        '<circle cx="8" cy="5.8" r="2.6"/><path d="M3 13.4c.9-2.3 2.8-3.5 5-3.5s4.1 1.2 5 3.5"/>'
      ),
      // One card per AI tool (15), its accounts as tiles with 98's fuel gauges; tools that aren't
      // installed sit in a strip at the end.
      html: desktop
        ? '<div id="tnaiAccountsMount"></div>'
        : note('Agent CLIs and their accounts are managed in the Technically Not desktop app.'),
    },
    {
      id: 'usage',
      label: 'Usage',
      about:
        'Tokens your agent CLIs used on this PC: over time, by weekday and hour, by model and project.',
      icon: icon(
        '<path d="M2.2 13.6h11.6"/><path d="M3.4 11.2 6.2 7.4l2.6 2.2 4-5.4"/><circle cx="12.8" cy="4.2" r=".9" fill="currentColor" stroke="none"/>'
      ),
      html: window.tnaiNative?.usage
        ? '<div id="tnaiUsageMount"></div>'
        : note('Token usage stats need the Technically Not desktop app.'),
    }, // filled by 59
    {
      id: 'insights',
      label: 'Insights',
      about:
        "Your token use, day by day, and where it could be lower. From the agent tools' own logs on this computer; nothing is sent anywhere.",
      icon: icon(
        '<path d="M8 1.8a4.2 4.2 0 0 0-2.5 7.6c.5.4.8.9.8 1.5v.6h3.4v-.6c0-.6.3-1.1.8-1.5A4.2 4.2 0 0 0 8 1.8Z"/><path d="M6.4 13.8h3.2"/>'
      ),
      html: window.tnaiNative?.usage
        ? '<div id="tnaiInsightsMount"></div>'
        : note('Token insights need the Technically Not desktop app.'),
    }, // filled by 197
    {
      id: 'agents',
      label: 'Agents',
      about:
        'How agents keep going, what happens when one finishes, how its context stays small, and your custom agents.',
      icon: icon(
        '<circle cx="8" cy="3.6" r="1.8"/><circle cx="3.6" cy="12.2" r="1.8"/><circle cx="12.4" cy="12.2" r="1.8"/><path d="M8 5.4v2.4M8 7.8 4.6 10.6M8 7.8l3.4 2.8"/>'
      ),
      // A sub-nav on the left (.sa-nav: one item per topic with its live state, built below) and
      // one panel per topic (.sa-pane). Mount ids kept for the scripts that fill them:
      // #agentsWorkCard (Write skills 63, Chrome 84, Discord 89 add rows), #agentsColA = After
      // finishing (51), #tnaiDelegationMount = Delegation (43), #agentsColB = Context (54; 76 adds
      // rows). Custom agents: a gallery of cards (list from 17). Look:
      // src/styles/19-settings-agents-purple.css.
      html:
        '<div class="sa-shell"><nav class="sa-nav" role="tablist" aria-orientation="vertical" aria-label="Agent settings"></nav><div class="sa-stage">' +
        `<div class="sa-pane" data-sa-pane="work" role="tabpanel"><section class="set-group tnai-work-set"><header class="set-group-head"><div><h3>While agents work</h3><p>Keep agents going through usage limits and let them learn.</p></div></header><div class="set-card" id="agentsWorkCard"><label class="set-row"><span class="set-text"><b>Continue agents when usage resets</b><small title="Technically Not reads the reset time from the CLI's own limit message and, a minute after it, tells the agent to carry on without repeating finished work. If no time is given it tries again every 30 minutes, up to 12 times. Switching account or restarting the panel cancels it.">Picks up where it stopped once the limit resets.${desktop ? '' : ' Needs the Technically Not desktop app.'}</small></span><input type="checkbox" class="set-switch" data-pref="autoResumeLimit"${desktop ? '' : ' disabled'}></label></div></section></div>` +
        '<div class="sa-pane" data-sa-pane="finish" id="agentsColA" role="tabpanel"></div>' +
        '<div class="sa-pane" data-sa-pane="custom" role="tabpanel"><section class="set-group sa-custom" id="agentsCustom"><header class="set-group-head"><div><h3>Custom agents</h3><p title="Each one runs on an agent CLI with its account, a role and the skills it loads. Deploy opens it in a terminal panel; a running one opens its panel. Rename, copy and delete are in the Custom agents strip on Overview.">Agents you made with a name, a role and skills.</p></div>' +
        (desktop
          ? `<button type="button" class="sa-btn" data-sa="skills">${window.TnaiIcon?.('library', { size: 14 }) || ''}<span>Skills library</span></button>`
          : '') +
        '</header>' +
        (desktop
          ? '<div class="sa-gallery" role="list" aria-label="Custom agents"></div>'
          : note('Custom agents run in the Technically Not desktop app.')) +
        '</section></div>' +
        '<div class="sa-pane" data-sa-pane="deleg" role="tabpanel">' +
        (window.tnaiNative?.graph
          ? '<div id="tnaiDelegationMount"></div>'
          : note('Custom agents and their sub-agents run in the Technically Not desktop app.')) +
        '</div>' +
        '<div class="sa-pane" data-sa-pane="context" id="agentsColB" role="tabpanel"></div>' +
        // Scheduled prompts: filled by 155 (desktop/prompt-schedules.js keeps them).
        '<div class="sa-pane" data-sa-pane="sched" id="agentsSched" role="tabpanel"></div>' +
        // Saved prompts and recipes: filled by 194 (desktop/prompt-library.js keeps them).
        '<div class="sa-pane" data-sa-pane="library" id="agentsLibrary" role="tabpanel">' +
        (desktop ? '' : note('Saved prompts and recipes run in the Technically Not desktop app.')) +
        '</div>' +
        '</div></div>',
    },
    // The small sections in one place (there were too many pages with one
    // setting): the accent color (#tnaiAppearanceMount, filled by 32), open files, and on Windows
    // the PowerShell kept ready. Until then they were the sections Appearance, Files and Terminal
    // (ALIAS below).
    {
      id: 'general',
      label: 'General',
      about: 'The accent color, how open files show changes, and how PowerShell starts.',
      icon: icon(
        '<path d="M2.4 4.6h6.1M11.7 4.6h1.9M2.4 11.4h1.9M7.5 11.4h6.1"/><circle cx="10.1" cy="4.6" r="1.6"/><circle cx="5.9" cy="11.4" r="1.6"/>'
      ),
      html:
        '<div id="tnaiAppearanceMount"></div>' +
        `<section class="set-group"><header class="set-group-head"><div><h3>Open files</h3></div></header><div class="set-card">
<label class="set-row"><span class="set-text"><b>Show live AI changes in open files</b><small>When an agent changes a file you have open, a small card beside the text shows the lines it added and removed. Open files still reload from disk when this is off.${desktop ? '' : ' Needs the Technically Not desktop app.'}</small></span><input type="checkbox" class="set-switch" data-pref="liveAiChanges"${desktop ? '' : ' disabled'}></label></div></section>` +
        // Windows desktop only: a PowerShell kept ready (10 → main pty:warm) exists only there.
        (window.tnaiNative?.pty?.warm && window.tnaiPlatform?.win
          ? `<section class="set-group"><header class="set-group-head"><div><h3>PowerShell</h3></div></header><div class="set-card">
<label class="set-row"><span class="set-text"><b>Keep a PowerShell ready</b><small title="Technically Not starts one hidden PowerShell in the project folder ahead of time and hands it to the next PowerShell thread, then starts the next one. It uses the memory of one idle PowerShell while the app is open. Off: every thread starts its own PowerShell, which takes about a second.">A new PowerShell thread opens at once instead of after about a second.</small></span><input type="checkbox" class="set-switch" data-pref="readyShell"></label></div></section>`
          : ''),
    },
    // Every key setting in one place: the shortcut list (32), the
    // snapshot key (62) and the hold-to-talk key (70) share one card.
    {
      id: 'keyboard',
      label: 'Keyboard',
      about: 'Every shortcut in one list, and the keys you can change.',
      icon: icon(
        '<rect x="1.6" y="3.9" width="12.8" height="8.2" rx="1.6"/><path d="M4.3 6.7h.01M6.8 6.7h.01M9.2 6.7h.01M11.7 6.7h.01M5.4 9.4h5.2"/>'
      ),
      html: '<div id="tnaiKeyboardMount"></div>',
    },
    {
      id: 'voice',
      label: 'Voice',
      about:
        'Talk to agents instead of typing: the language and the speech model. Your voice never leaves this PC. The hold-to-talk key is under Keyboard.',
      icon: icon(
        '<rect x="6" y="1.8" width="4" height="7.2" rx="2"/><path d="M3.6 7.6a4.4 4.4 0 0 0 8.8 0M8 12v2.2M5.8 14.2h4.4"/>'
      ),
      html: window.tnaiNative?.voice
        ? '<div id="tnaiVoiceMount"></div>'
        : note(
            'Voice prompts need the Technically Not desktop app, where your speech is turned into text on your PC.'
          ),
    }, // language, model and sounds, filled by 70
    {
      id: 'updates',
      label: 'Updates',
      about: 'The installed version and how Technically Not updates itself.',
      icon: icon('<path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.2 2.4v3.2H10"/>'),
      html: desktop
        ? '<div id="tnaiUpdatesMount"></div>'
        : note(
            'The browser version always loads the current files. Automatic updates apply to the Technically Not desktop app.'
          ),
    }, // filled by 36
  ];

  const page = document.createElement('section');
  page.className = 'settings-page';
  page.id = 'settingsPage';
  page.setAttribute('aria-label', 'Settings');
  page.innerHTML = `<div class="settings-inner">
<header class="agent-page-header"><div><p class="agent-eyebrow">TECHNICALLY NOT / SETTINGS</p><h1>Settings</h1><p>How Technically Not runs on this PC.</p></div></header>
<div class="settings-body"><nav class="settings-tabs" role="tablist" aria-orientation="vertical" aria-label="Settings sections"></nav>
<div class="settings-panels"></div></div></div>`;
  layout.append(page);
  const tabBar = page.querySelector('.settings-tabs'),
    panels = page.querySelector('.settings-panels');
  for (const tab of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.id = 'settingsTab-' + tab.id;
    button.dataset.tab = tab.id;
    button.innerHTML = tab.icon + '<span>' + tab.label + '</span>';
    button.setAttribute('aria-controls', 'settingsPanel-' + tab.id);
    tabBar.append(button);
    const panel = document.createElement('section');
    panel.className = 'settings-panel';
    panel.id = 'settingsPanel-' + tab.id;
    panel.dataset.tab = tab.id;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.innerHTML =
      `<header class="settings-section-head"><h2>${tab.label}</h2><p>${tab.about}</p></header>` +
      tab.html;
    panels.append(panel);
  }

  page.querySelectorAll('input[data-pref]').forEach(input => {
    input.checked = !!getPref(input.dataset.pref);
    input.addEventListener('change', () => setPref(input.dataset.pref, input.checked));
  });

  // section ids until 2026-10-09: a saved tab and older callers still land on the right page
  const ALIAS = { files: 'general', terminal: 'general', appearance: 'general' };

  function select(id) {
    id = ALIAS[id] || id;
    if (!TABS.some(t => t.id === id)) id = TABS[0].id;
    tabBar.querySelectorAll('button').forEach(b => {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panels.querySelectorAll('.settings-panel').forEach(p => {
      p.hidden = p.dataset.tab !== id;
    });
    try {
      localStorage.setItem(TAB_KEY, id);
    } catch {}
    return id;
  }
  let saved = null;
  try {
    saved = localStorage.getItem(TAB_KEY);
  } catch {}
  select(saved);
  tabBar.addEventListener('click', event => {
    const b = event.target.closest('button[data-tab]');
    if (b) {
      select(b.dataset.tab);
      page.scrollTop = 0;
    }
  });
  tabBar.addEventListener('keydown', event => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const buttons = [...tabBar.querySelectorAll('button')],
      i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    const next = buttons[(i + step + buttons.length) % buttons.length];
    select(next.dataset.tab);
    next.focus();
  });

  // ---- Settings › Agents: sub-nav, topic panels, "?" tips, group captions and the Custom agents
  // gallery ----
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const ico = (name, size = 16) => window.TnaiIcon?.(name, { size }) || '';
  const agentsPanel = page.querySelector('#settingsPanel-agents');
  const on = sel => !!agentsPanel.querySelector(sel)?.checked;
  const SEC_KEY = 'tnai.settings-agents-sec.v1';

  // Each item's state line reads the real state from its panel's own controls (built by 22, 51, 54,
  // 63, 84, 89, 43), so it can't drift from them.
  const SECS = [
    {
      id: 'work',
      icon: 'zap',
      title: 'While working',
      state: () => {
        const s = [...agentsPanel.querySelectorAll('#agentsWorkCard input.set-switch')];
        return s.length ? s.filter(i => i.checked).length + ' of ' + s.length + ' on' : '—';
      },
    },
    {
      id: 'finish',
      icon: 'circle-check',
      title: 'After finishing',
      state: () =>
        !agentsPanel.querySelector('.tnai-next-set')
          ? '—'
          : on('.tnai-next-set [data-k=auto]')
            ? 'Automatic mode on'
            : on('.tnai-next-set [data-k=cards]')
              ? 'Next-step cards'
              : 'Bell only',
    },
    {
      id: 'custom',
      icon: 'bot',
      title: 'Custom agents',
      state: () => {
        const list = window.TnaiCustomAgents?.list?.();
        if (!list) return desktop ? '—' : 'Desktop app';
        const running = list.filter(a => a.running).length;
        return list.length
          ? list.length +
              ' agent' +
              (list.length === 1 ? '' : 's') +
              (running ? ' · ' + running + ' running' : '')
          : 'None yet';
      },
    },
    {
      id: 'deleg',
      icon: 'network',
      title: 'Delegation',
      state: () => {
        const v = k =>
          agentsPanel.querySelector(`[data-nolimit=${k}]`)?.checked
            ? 'no limit'
            : agentsPanel.querySelector(`[data-limit=${k}]`)?.value; // 43: "No limit" = 0
        return !window.tnaiNative?.graph
          ? 'Desktop app'
          : v('maxActivePerAgent')
            ? v('maxActivePerAgent') + ' per agent · ' + v('maxActiveTotal') + ' in total'
            : '—';
      },
    },
    {
      id: 'context',
      icon: 'gauge',
      title: 'Context',
      state: () =>
        !agentsPanel.querySelector('.tnai-upkeep-set')
          ? '—'
          : on('.tnai-upkeep-set [data-k=on]')
            ? 'Suggests compacting'
            : 'No suggestions',
    },
    {
      id: 'sched',
      icon: 'clock',
      title: 'Scheduled prompts',
      // 155 fires a change on its pane whenever its list changes
      state: () => window.TnaiPromptSchedules?.state?.() || (desktop ? '—' : 'Desktop app'),
    },
    {
      id: 'library',
      icon: 'library',
      title: 'Saved prompts',
      // 194 fires a change on its pane whenever its list changes
      state: () => window.TnaiPromptLibrary?.state?.() || (desktop ? '—' : 'Desktop app'),
    },
  ];
  const secNav = agentsPanel.querySelector('.sa-nav');
  secNav.innerHTML = SECS.map(
    s =>
      `<button type="button" role="tab" class="sa-item" id="saTab-${s.id}" data-sa-sec="${s.id}"><span class="sa-ic">${ico(s.icon, 18)}</span><span class="sa-tx"><b>${s.title}</b><small></small></span></button>`
  ).join('');
  agentsPanel.querySelectorAll('.sa-pane').forEach(p => {
    if (!p.id) p.id = 'saPane-' + p.dataset.saPane;
    p.setAttribute('aria-labelledby', 'saTab-' + p.dataset.saPane);
  });
  secNav
    .querySelectorAll('.sa-item')
    .forEach(b =>
      b.setAttribute(
        'aria-controls',
        agentsPanel.querySelector(`[data-sa-pane="${b.dataset.saSec}"]`).id
      )
    );

  function paintStates() {
    SECS.forEach(s => {
      const el = secNav.querySelector(`[data-sa-sec="${s.id}"] small`),
        v = s.state();
      if (el.textContent !== v) el.textContent = v;
    });
  }

  function showSec(id, animate) {
    if (!SECS.some(s => s.id === id)) id = SECS[0].id;
    const apply = () => {
      secNav.querySelectorAll('.sa-item').forEach(b => {
        const sel = b.dataset.saSec === id;
        b.setAttribute('aria-selected', String(sel));
        b.tabIndex = sel ? 0 : -1;
      });
      agentsPanel.querySelectorAll('.sa-pane').forEach(p => {
        p.hidden = p.dataset.saPane !== id;
      });
    };
    if (animate && window.TnaiMotion) window.TnaiMotion.swap(apply, 'sa');
    else apply();
    try {
      localStorage.setItem(SEC_KEY, id);
    } catch {}
  }
  let savedSec = null;
  try {
    savedSec = localStorage.getItem(SEC_KEY);
  } catch {}
  showSec(savedSec);
  secNav.addEventListener('click', event => {
    const b = event.target.closest('[data-sa-sec]');
    if (b && b.getAttribute('aria-selected') !== 'true') showSec(b.dataset.saSec, true);
  });
  secNav.addEventListener('keydown', event => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const items = [...secNav.querySelectorAll('.sa-item')],
      i = items.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    const next = items[(i + step + items.length) % items.length];
    showSec(next.dataset.saSec, true);
    next.focus();
  });
  agentsPanel.addEventListener('change', () => requestAnimationFrame(paintStates));

  // Long explanations (a row's or a head's `title`) move into a "?" beside the setting's name,
  // shown at once on hover or focus.
  const tip = document.createElement('div');
  tip.className = 'sa-tip';
  tip.id = 'saTip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  page.append(tip);
  let tipFor = null;
  const hideTip = () => {
    if (tip.hidden) return;
    tip.hidden = true;
    tipFor?.removeAttribute('aria-describedby');
    tipFor = null;
  };
  const showTip = q => {
    if (tipFor === q) return;
    tipFor?.removeAttribute('aria-describedby');
    tipFor = q;
    tip.textContent = q.dataset.tip;
    tip.hidden = false;
    q.setAttribute('aria-describedby', tip.id);
    window.TnaiFloat?.attach(q, tip, { placement: 'top-start', offset: 8 });
  };

  function tipify() {
    agentsPanel.querySelectorAll('.set-text small[title], .set-group-head p[title]').forEach(s => {
      const text = s.getAttribute('title');
      const name = s.matches('p')
        ? s.closest('.set-group-head')?.querySelector('h3')
        : s.parentElement.querySelector('b');
      if (!name || name.querySelector('.sa-q')) return;
      s.removeAttribute('title');

      // A span, not a button: a button inside a row's <label> would become the label's control.
      name.insertAdjacentHTML(
        'beforeend',
        `<span class="sa-q" tabindex="0" role="button" aria-label="More about ${esc(name.textContent)}" data-tip="${esc(text)}">${ico('circle-help', 14)}</span>`
      );
    });
  }
  agentsPanel.addEventListener('pointerover', event => {
    const q = event.target.closest('.sa-q');
    if (q) showTip(q);
  });
  agentsPanel.addEventListener('pointerout', event => {
    const q = event.target.closest('.sa-q');
    if (q && !q.contains(event.relatedTarget)) hideTip();
  });
  agentsPanel.addEventListener('focusin', event => {
    const q = event.target.closest('.sa-q');
    if (q) showTip(q);
    else hideTip();
  });
  agentsPanel.addEventListener('focusout', event => {
    if (event.target.closest('.sa-q')) hideTip();
  });
  agentsPanel.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideTip();
  });

  // Clicking a "?" inside a row's label must not flip the row's switch.
  agentsPanel.addEventListener('click', event => {
    const q = event.target.closest('.sa-q');
    if (q) {
      event.preventDefault();
      showTip(q);
    }
  });

  // Related rows get a small caption, so each card reads as a few short groups (captions only; rows
  // never move, their scripts keep their references).
  function caption(card, sel, text) {
    let el = card?.querySelector(sel);
    while (el && el.parentElement !== card) el = el.parentElement;
    if (el && !el.previousElementSibling?.classList.contains('sa-cap'))
      el.insertAdjacentHTML('beforebegin', `<p class="sa-cap">${text}</p>`);
  }

  function captions() {
    const work = agentsPanel.querySelector('#agentsWorkCard'),
      next = agentsPanel.querySelector('.tnai-next-set .set-card'),
      ctx = agentsPanel.querySelector('.tnai-upkeep-set .set-card');
    caption(work, '[data-pref=autoResumeLimit]', 'Usage limits');
    caption(work, '.tnai-write-skills-row, .tnai-chrome-browser-row', 'What agents can use');
    caption(work, '.tnai-discord-row', 'Alerts');
    caption(next, '[data-k=nudge]', 'Bell and sounds');
    caption(next, '[data-k=closeMovedOn]', 'Next steps');
    caption(next, '[data-k=auto]', 'Automatic mode');
    caption(ctx, '[data-k=on]', 'Compacting');
    caption(ctx, '[data-cw=on]', 'Size warnings');
  }

  // Custom agents: one card per agent (avatar in its own color, CLI, account, skills, state, Deploy
  // / Open panel), then a New agent card.
  const gallery = agentsPanel.querySelector('.sa-gallery');

  function paintCustom() {
    if (!gallery) return;
    const api = window.TnaiCustomAgents,
      list = api?.list?.() || [];
    const cards = list.map(a => {
      const color = window.TnaiAgentMarks?.agentColor?.(a.name) || '',
        cli = window.TnaiAgentMarks?.cliColor?.(a.base) || '';
      const account =
        window.TnaiAccounts?.label?.(a.base, a.accountId) || a.accountId || 'Default account';
      const skills =
        a.supportsSkills === false
          ? 'Skills not supported'
          : a.skillIds?.length
            ? a.skillIds.length + ' skill' + (a.skillIds.length === 1 ? '' : 's')
            : 'No skills';
      const state = a.running ? 'Running' : a.paneId ? 'Stopped' : 'Saved';
      return (
        `<article class="sa-agent" role="listitem" data-custom="${esc(a.id)}"${color ? ` style="--av:${esc(color)}"` : ''}>` +
        `<header class="sa-agent-top"><span class="sa-av" aria-hidden="true">${esc(
          String(a.name || '?')
            .trim()
            .charAt(0)
            .toUpperCase()
        )}</span>` +
        `<span class="sa-agent-tx"><b title="${esc(a.name)}">${esc(a.name)}</b><small>${a.scope === 'project' ? 'Project agent' : 'Personal agent'}</small></span>` +
        `<span class="sa-state${a.running ? ' on' : ''}"><i></i>${state}</span></header>` +
        (a.role ? `<p class="sa-role" title="${esc(a.role)}">${esc(a.role)}</p>` : '') +
        `<dl class="sa-meta"><div><dt>CLI</dt><dd><i class="sa-cli"${cli ? ` style="--cli:${esc(cli)}"` : ''}></i>${esc(a.base || '—')}</dd></div><div><dt>Account</dt><dd title="${esc(account)}">${esc(account)}</dd></div><div><dt>Skills</dt><dd>${esc(skills)}</dd></div></dl>` +
        (a.running
          ? `<button type="button" class="sa-btn" data-sa="open">${ico('square-terminal', 14)}<span>Open panel</span></button>`
          : `<button type="button" class="sa-btn primary" data-sa="deploy">${ico('rocket', 14)}<span>Deploy</span></button>`) +
        '</article>'
      );
    });
    const html = !api
      ? ''
      : cards.join('') +
        `<button type="button" class="sa-new" data-sa="new">${ico('plus', 18)}<b>New agent</b><small>${list.length ? 'A name, a role and the skills it loads.' : 'No custom agents yet. Make one: a name, a role and the skills it loads.'}</small></button>`;
    if (gallery.dataset.key !== html) {
      gallery.dataset.key = html;
      gallery.innerHTML = html;
    }
    gallery.hidden = !api;
  }
  agentsPanel.addEventListener('click', async event => {
    const b = event.target.closest('button[data-sa]');
    if (!b) return;
    const id = b.closest('[data-custom]')?.dataset.custom;
    if (b.dataset.sa === 'skills') window.TnaiRoute?.('skills');
    else if (b.dataset.sa === 'new')
      // 17's form, opened here
      window.TnaiCustomAgents?.openForm?.(document.getElementById('agentsCustom'));
    else if (b.dataset.sa === 'deploy') {
      b.disabled = true;
      try {
        await window.TnaiCustomAgents?.deploy(id);
      } finally {
        b.disabled = false;
        paintCustom();
        paintStates();
      }
    } else if (b.dataset.sa === 'open') {
      // same as Open in 17's Custom agents strip
      const s = window.TnaiCustomAgents?.list?.().find(a => a.id === id);
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
  });
  window.addEventListener('tnai:custom-agents-changed', () => {
    paintCustom();
    paintStates();
  });

  // 51/54/63/76/84/89/43 add their groups and rows after this file: caption, tipify and paint once
  // everything is in.
  window.addEventListener('load', () => {
    captions();
    tipify();
    paintCustom();
    paintStates();
    window.TnaiAgents?.onChange?.(() => {
      if (!agentsPanel.hidden) {
        paintCustom();
        paintStates();
      }
    }); // a custom agent started or stopped
  });
  window.addEventListener('tnai:settings-page-shown', () => {
    tipify();
    paintCustom();
    paintStates();
  });

  // Sign-in states can change outside Technically Not (a CLI signed in from another terminal);
  // recheck when the page opens.
  let checkedAt = 0;
  window.addEventListener('tnai:settings-page-shown', () => {
    if (desktop && Date.now() - checkedAt > 15000) {
      checkedAt = Date.now();
      window.TnaiAccounts?.refresh?.(false);
    }
  });

  window.TnaiSettings = {
    open(tab) {
      window.TnaiRoute?.('settings');
      return select(tab);
    },
    tabs: () => TABS.map(t => t.id),
    get: getPref,
    set(key, value) {
      setPref(key, value);
      page.querySelectorAll('input[data-pref="' + key + '"]').forEach(i => {
        i.checked = !!getPref(key);
      });
    },
  };
})();
