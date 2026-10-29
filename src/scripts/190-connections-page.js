/*
 * Technically Not · 190-connections-page.js — the Connections page (route `connections`,
 * `connections-mode`), opened from the three-dots menu right after Skills (user 2026-10-28: "Yes,
 * build it as shown" on docs/plans/design-concepts/connections-page.html; the row is
 * "Connections").
 *
 * Tools the user's agents can use (MCP servers), in one list that reaches Claude Code, Codex,
 * OpenCode and Cursor Agent alike: "On" (the user's own, with "Every session" or chosen threads),
 * "Suggested" (one press opens the add sheet, which adds it for every agent), "In one tool only"
 * (found in one tool's own setup, with "Add for every agent"). A detail panel shows what it
 * reaches, how it runs, its key (set or missing, never the value), the exact command and a switch
 * per thread. Drawn with the Skills page's own classes (18, 13-skills-purple.css); its own parts
 * are in src/styles/67-connections.css. The data comes from `window.tnaiNative.connections`
 * (desktop/connections.js, contract in docs/plans/plugin-mcp-manager.md 7.1). A change reaches a
 * thread when its next session starts. The thread's Details section is 191's.
 */
(() => {
  const layout = document.querySelector('.layout');
  if (!layout) return;
  const api = () => window.tnaiNative?.connections || null;
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const icon = (name, size = 14) => window.TnaiIcon?.(name, { size }) || '';
  const esc = text =>
    String(text ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const MODE = 'connections-mode';
  const visible = () => layout.classList.contains(MODE);

  // The tools a connection can reach, in the order the page names them.
  const TOOLS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent', 'GitHub Copilot'];
  const FILTERS = [
    ['all', 'All'],
    ['on', 'On'],
    ['suggested', 'Suggested'],
    ['one', 'In one tool only'],
  ];
  const GROUPS = {
    on: ['On', 'Your agents have these'],
    suggested: ['Suggested', 'One press adds it for every agent'],
    one: ['In one tool only', 'From that tool’s own setup'],
  };

  // ---------------------------------------------------------------- the page
  const page = document.createElement('section');
  page.className = 'skills-page cn-page';
  page.id = 'connectionsPage';
  page.setAttribute('aria-label', 'Connections');
  page.innerHTML = `<div class="skills-inner">
<header class="agent-page-header sk-head"><div class="sk-title"><h1>Connections</h1><p class="sk-sum">Tools your agents can use. One list for Claude Code, Codex, OpenCode, Cursor Agent and Copilot.</p></div>
<label class="sk-search">${icon('search', 15)}<input class="skills-filter" type="search" placeholder="Search connections" aria-label="Search connections"><kbd>/</kbd></label>
<div class="agent-page-actions"><button type="button" class="button dark" data-act="add-own">${icon('plus', 15)}<span>Add your own</span></button></div></header>
<div class="sk-bar"><div class="sk-chips" role="radiogroup" aria-label="Show"></div></div>
<div class="sk-body">
<section class="skills-library" aria-label="Connections"><div class="skills-groups"></div></section>
<aside class="sk-detail" aria-label="Connection details" hidden></aside>
</div></div>
<div class="cn-sheet-wrap" hidden></div>`;
  layout.append(page);
  const $ = selector => page.querySelector(selector);
  const groupsEl = $('.skills-groups');
  const chipsEl = $('.sk-chips');
  const filterEl = $('.skills-filter');
  const detailEl = $('.sk-detail');
  const bodyEl = $('.sk-body');
  const sheetWrap = $('.cn-sheet-wrap');

  // What main said last, the filter, the open card, and what the detail panel is asking.
  let data = null;
  let loadError = '';
  let filter = 'all';
  let selected = '';
  let confirmRemove = '';
  let editingKey = '';
  let threadRows = [];
  let busy = false;
  let renderKey = '';
  let detailKey = '';
  let sheetOpener = null;

  // ---------------------------------------------------------------- reading main
  // Asks main for the list; an older answer that comes back late is dropped.
  let asked = 0;

  async function refresh() {
    const connections = api();
    if (!connections?.state) {
      data = null;
      loadError = '';
      draw();
      return;
    }
    const mine = ++asked;
    try {
      const next = await connections.state();
      if (mine !== asked) return;
      data = next || null;
      loadError = '';
    } catch (error) {
      if (mine !== asked) return;
      loadError = String(error?.message || error);
    }
    await readThreads();
    if (mine === asked) draw();
  }

  // The threads that can take a connection: every live session but the user's own terminal, each
  // with the instance id main keeps its switches by.
  async function readThreads() {
    const connections = api();
    let sessions = [];
    try {
      sessions = window.TnaiAgents?.sessions?.() || [];
    } catch {}
    const own = paneId => {
      try {
        return !!window.TnaiOwnTerminal?.owns?.(paneId);
      } catch {
        return false;
      }
    };
    const rows = [];
    for (const session of sessions) {
      if (!session?.paneId || own(session.paneId) || !connections?.forThread) continue;
      try {
        const answer = await connections.forThread(session.paneId);
        if (answer?.instanceId)
          rows.push({
            paneId: session.paneId,
            name: session.name || 'Thread',
            tool: session.agent || '',
            instanceId: answer.instanceId,
          });
      } catch {}
    }
    threadRows = rows;
  }

  // ---------------------------------------------------------------- the items
  // One list of every card: the user's own (`c:`), suggested (`s:`) and one-tool ones (`o:`).
  function items() {
    if (!data) return [];
    const own = (data.connections || []).map(item => ({
      ...item,
      group: 'on',
      key: 'c:' + item.id,
    }));
    const suggested = (data.suggested || []).map(item => ({
      ...item,
      keys: (item.keys || []).map(name => (typeof name === 'string' ? { name, set: false } : name)),
      group: 'suggested',
      key: 's:' + item.id,
    }));
    const oneTool = (data.oneTool || []).map(item => ({
      ...item,
      group: 'one',
      // a key that also works inside a selector (no control characters)
      key: 'o:' + item.tool + '/' + item.name,
    }));
    return [...own, ...suggested, ...oneTool];
  }

  // What a connection reaches. A suggested or one-tool entry has no list of its own: it gets what
  // an added connection reaches, since every connection is passed the same way.
  function reachOf(item) {
    const reaches = item.reaches || data?.reaches || data?.connections?.[0]?.reaches || null;
    return TOOLS.map(tool => ({
      tool,
      state: !reaches ? 'unknown' : reaches[tool] === 'yes' ? 'yes' : 'no',
    }));
  }
  const reachCount = item => reachOf(item).filter(entry => entry.state === 'yes').length;
  const commandOf = item =>
    item.kind === 'url'
      ? item.url || ''
      : [item.command, ...(item.args || [])].filter(Boolean).join(' ');
  const kindBadge = item => (item.kind === 'url' ? 'Web address' : 'Program');
  const threadsOn = item => (item.threads || []).length;
  const isOn = item => item.group === 'on' && (item.every || threadsOn(item) > 0);
  const keysMissing = item => (item.keys || []).filter(key => !key.set).map(key => key.name);

  const search = item =>
    [item.name, item.desc, commandOf(item), item.tool, kindBadge(item)].join(' ').toLowerCase();
  const passes = (item, which) => which === 'all' || item.group === which;

  // ---------------------------------------------------------------- drawing
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function tags(item) {
    const list = [];
    const count = reachCount(item);
    if (count) list.push(count + (count === 1 ? ' tool' : ' tools'));
    if (item.group === 'on') {
      if (!item.every)
        list.push(
          threadsOn(item)
            ? 'on in ' + threadsOn(item) + (threadsOn(item) === 1 ? ' thread' : ' threads')
            : 'off'
        );
      if ((item.keys || []).length) list.push(keysMissing(item).length ? 'key missing' : 'key set');
      if (item.signIn) list.push('sign-in');
    } else if (item.group === 'suggested') {
      if ((item.keys || []).length) list.push('key');
      if (item.signIn) list.push('sign-in');
    }
    return list;
  }

  function card(item) {
    const row = make('article', 'skill-row');
    row.dataset.key = item.key;
    row.tabIndex = 0;
    row.setAttribute('aria-selected', String(selected === item.key));
    row.classList.toggle('in-use', isOn(item));
    const title = make('div', 'skill-title');
    title.append(
      make('span', 'skill-dot'),
      make('b', '', item.name),
      make('span', 'skill-badge scope', item.group === 'one' ? item.tool : kindBadge(item))
    );
    const missing = item.group === 'on' ? keysMissing(item) : [];
    if (missing.length) {
      const flag = make('span', 'sk-flag warn');
      flag.innerHTML = icon('triangle-alert', 13);
      flag.title = 'Key missing: ' + missing.join(', ');
      title.append(flag);
    }
    title.title = item.name;
    const words =
      item.group === 'one'
        ? 'Found in ' + item.tool + '’s own setup; the other tools do not have it.'
        : item.desc || (item.kind === 'url' ? item.url : commandOf(item));
    const desc = make('p', 'sk-desc', words);
    desc.title = words;
    const kw = make('div', 'sk-kw');
    tags(item).forEach(word => kw.append(make('span', '', word)));
    const foot = make('div', 'sk-foot');
    const who = make('div', 'skill-agents');
    if (item.group === 'on' && item.every) {
      const every = make('span', 'sk-every');
      every.title = 'On in every session Technically Not starts';
      every.innerHTML = icon('zap', 12) + '<span>Every session</span>';
      who.append(every);
    } else if (item.group !== 'on') {
      const add = make('button', 'button cn-add-btn');
      add.type = 'button';
      add.dataset.act = item.group === 'one' ? 'adopt' : 'add-suggested';
      add.innerHTML =
        icon('plus', 14) +
        '<span>' +
        (item.group === 'one' ? 'Add for every agent' : 'Add') +
        '</span>';
      add.setAttribute(
        'aria-label',
        (item.group === 'one' ? 'Add for every agent: ' : 'Add ') + item.name
      );
      add.disabled = busy;
      who.append(add);
    }
    foot.append(who);
    row.append(title, desc, kw, foot);
    return row;
  }

  function emptyLine(group, query) {
    if (query) return 'No matches.';
    if (group === 'on') return 'None yet. Add a suggested one below, or add your own.';
    if (group === 'suggested') return 'Every suggested connection is added.';
    return 'Nothing found in the tools’ own setup that the others lack.';
  }

  function draw() {
    if (!visible()) return;
    const all = items();
    const query = filterEl.value.trim().toLowerCase();
    const hits = all.filter(item => !query || search(item).includes(query));
    if (selected && !all.some(item => item.key === selected)) {
      selected = '';
      confirmRemove = '';
      editingKey = '';
    }
    drawDetail();
    const key = JSON.stringify([data, loadError, filter, query, selected, busy]);
    if (key === renderKey) return;
    renderKey = key;

    // Summary line and filter chips (counts follow the search).
    // The tools named are the ones main passes connections to today (connections.js REACHES).
    const reached = TOOLS.filter(tool =>
      reachOf({}).some(entry => entry.tool === tool && entry.state === 'yes')
    );
    const names = reached.length ? reached : TOOLS.slice(0, 4);
    $('.sk-sum').textContent = !api()
      ? 'Connections are not available in this build.'
      : loadError
        ? 'Could not read the connections: ' + loadError
        : 'Tools your agents can use. One list for ' +
          names.slice(0, -1).join(', ') +
          ' and ' +
          names[names.length - 1] +
          '.';
    chipsEl.replaceChildren(
      ...FILTERS.map(([id, label]) => {
        const count = hits.filter(item => passes(item, id)).length;
        const chip = make('button', 'sk-chip');
        chip.type = 'button';
        chip.dataset.act = 'filter';
        chip.dataset.filter = id;
        chip.setAttribute('role', 'radio');
        chip.setAttribute('aria-checked', String(filter === id));
        if (!count && id !== 'all') chip.dataset.empty = '1';
        chip.append(make('span', '', label), make('em', '', String(count)));
        return chip;
      })
    );

    // The three groups, each a grid of cards. On All an empty group still says why it is empty;
    // under a filter only its own group shows.
    const groups = [];
    for (const group of ['on', 'suggested', 'one']) {
      if (filter !== 'all' && filter !== group) continue;
      const rows = hits.filter(item => item.group === group);
      if (group === 'one' && !rows.length && filter === 'all' && !query) continue;
      const section = make('section', 'skills-group');
      section.dataset.group = group;
      const head = make('header');
      head.append(
        make('b', '', GROUPS[group][0]),
        make('span', '', rows.length ? String(rows.length) : ''),
        make('small', '', GROUPS[group][1])
      );
      section.append(head);
      if (rows.length) {
        const grid = make('div', 'sk-grid');
        rows.forEach(item => grid.append(card(item)));
        section.append(grid);
      } else if (api() && data) section.append(make('p', 'skills-empty', emptyLine(group, query)));
      groups.push(section);
    }
    if (!api() || !data)
      groups.unshift(
        make(
          'p',
          'skills-empty sk-none',
          !api()
            ? 'Connections need the desktop app of this build.'
            : loadError
              ? 'Could not read the connections: ' + loadError
              : 'Reading the connections…'
        )
      );
    groupsEl.replaceChildren(...groups);
  }

  // ---------------------------------------------------------------- the detail panel
  function drawDetail() {
    const item = selected && items().find(entry => entry.key === selected);
    const open = !!item;
    if (open === detailEl.hidden) {
      const flip = () => {
        detailEl.hidden = !open;
        bodyEl.classList.toggle('has-detail', open);
        if (!open) detailEl.replaceChildren();
      };
      detailKey = '';
      if (window.TnaiMotion && visible())
        window.TnaiMotion.swap(() => {
          flip();
          if (item) paintDetail(item);
        }, 'skill');
      else {
        flip();
        if (item) paintDetail(item);
      }
      return;
    }
    if (item) paintDetail(item);
  }

  const fact = (label, value) =>
    value ? '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>' : '';
  const btn = (act, iconName, label, extra = '') =>
    '<button type="button" class="sk-btn ' +
    extra +
    '" data-act="' +
    act +
    '"' +
    (busy ? ' disabled' : '') +
    '>' +
    icon(iconName, 15) +
    '<span>' +
    label +
    '</span></button>';

  function reachHtml(item) {
    return (
      '<div class="cn-reach">' +
      reachOf(item)
        .map(entry => {
          const short = entry.tool === 'GitHub Copilot' ? 'Copilot' : entry.tool;
          const words = entry.state === 'no' ? short + ' · not yet' : short;

          // Copilot: a GitHub account whose Copilot policy turns outside MCP servers off starts
          // without them (agent-registry.js), so its chip says so on hover
          const tip =
            entry.state === 'no'
              ? ' title="Technically Not does not pass connections to ' + esc(entry.tool) + ' yet"'
              : entry.tool === 'GitHub Copilot' && entry.state === 'yes'
                ? ' title="Not used when your GitHub account’s Copilot policy turns off outside MCP servers"'
                : '';
          return (
            '<span class="cn-tool" data-state="' +
            entry.state +
            '"' +
            tip +
            '><i></i>' +
            esc(words) +
            '</span>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  // The key row: set or missing, never the value. A missing key, or "Change", shows a field that
  // writes through setKey.
  function keyHtml(item) {
    if (!(item.keys || []).length) return '';
    const why = data?.keysAvailable || '';
    return (item.keys || [])
      .map(key => {
        const state = key.set
          ? '<span class="cn-key cn-ok">' +
            icon('check', 13) +
            '<b>' +
            esc(key.name) +
            ' set</b></span>'
          : '<span class="cn-key cn-miss">' +
            icon('triangle-alert', 13) +
            '<b>' +
            esc(key.name) +
            ' missing</b></span>';
        if (item.group !== 'on')
          return fact(
            'Key',
            '<span class="cn-key"><b>' +
              esc(key.name) +
              '</b></span><span class="cn-key-note">Needed; asked for when you add it</span>'
          );
        const change =
          key.set && editingKey !== key.name && !why
            ? '<button type="button" class="sk-x sm" data-act="key-edit" data-key-name="' +
              esc(key.name) +
              '" aria-label="Change ' +
              esc(key.name) +
              '" title="Change the key">' +
              icon('pencil', 13) +
              '</button>'
            : '';
        const field =
          !why && (!key.set || editingKey === key.name)
            ? '<span class="cn-key-field"><input class="cn-input" type="password" autocomplete="off" spellcheck="false" data-key-name="' +
              esc(key.name) +
              '" placeholder="Paste ' +
              esc(key.name) +
              '" aria-label="' +
              esc(key.name) +
              '"><button type="button" class="sk-btn primary" data-act="key-save" data-key-name="' +
              esc(key.name) +
              '">Save</button></span>'
            : '';
        const note = why || 'Kept encrypted on this PC, never in a settings file';
        return fact(
          'Key',
          state + change + field + '<span class="cn-key-note">' + esc(note) + '</span>'
        );
      })
      .join('');
  }

  function threadsHtml(item) {
    if (item.group !== 'on') return '';
    const rows = threadRows
      .map(thread => {
        const on = !!item.every || (item.threads || []).includes(thread.instanceId);
        return (
          '<div class="cn-thread"><span>' +
          esc(thread.name) +
          (thread.tool ? '<small>' + esc(thread.tool) + '</small>' : '') +
          '</span><button type="button" class="sk-switch" role="switch" data-act="thread" data-instance="' +
          esc(thread.instanceId) +
          '" aria-checked="' +
          on +
          '" aria-label="' +
          esc(item.name) +
          ' in ' +
          esc(thread.name) +
          '"' +
          (item.every || busy ? ' disabled' : '') +
          (item.every
            ? ' title="On in every session; switch Every session off to choose threads"'
            : '') +
          '><i></i></button></div>'
        );
      })
      .join('');
    return (
      '<section class="sk-d-sec"><h3>Threads</h3>' +
      (rows ||
        '<p class="sk-d-note">No thread is open. Each new thread gets it when it is on for every session.</p>') +
      (rows
        ? '<p class="sk-d-note">A change takes effect when that thread’s next session starts.</p>'
        : '') +
      '</section>'
    );
  }

  function paintDetail(item) {
    const key = JSON.stringify([
      item,
      confirmRemove,
      editingKey,
      threadRows,
      busy,
      data?.keysAvailable,
    ]);
    if (key === detailKey) return;
    detailKey = key;

    // a field the user is typing in keeps its words through a redraw
    const typing = detailEl.querySelector('.cn-input');
    const typed = typing ? [typing.dataset.keyName, typing.value] : null;
    const scroll =
      detailEl.dataset.key === item.key
        ? detailEl.querySelector('.sk-d-scroll')?.scrollTop || 0
        : 0;
    detailEl.dataset.key = item.key;
    const own = item.group === 'on';
    const badge = own ? 'Connection' : item.group === 'one' ? item.tool : 'Suggested';
    const words =
      item.group === 'one'
        ? 'Found in ' +
          item.tool +
          '’s own setup; the other tools do not have it. Add it for every agent to give it to all of them.'
        : item.desc || 'No description.';
    const actions = own
      ? '<button type="button" class="sk-switch" role="switch" data-act="every" aria-checked="' +
        !!item.every +
        '"' +
        (busy ? ' disabled' : '') +
        ' title="On in every session Technically Not starts (takes effect when a session starts)"><i></i><span>Every session</span></button>' +
        '<button type="button" class="button" data-act="remove"' +
        (busy ? ' disabled' : '') +
        '>Remove</button>'
      : item.group === 'one'
        ? btn('adopt', 'plus', 'Add for every agent', 'primary')
        : btn('add-suggested', 'plus', 'Add', 'primary');
    const confirm =
      own && confirmRemove === item.key
        ? '<div class="sk-confirm" role="alertdialog" aria-label="Remove connection"><p>Remove “' +
          esc(item.name) +
          '” for every agent? Threads lose it at their next session' +
          ((item.keys || []).some(entry => entry.set) ? ', and its key is deleted' : '') +
          '.</p><div><button type="button" class="sk-btn danger" data-act="remove-yes">Remove</button><button type="button" class="sk-btn" data-act="remove-no">Cancel</button></div></div>'
        : '';
    const runs = item.kind === 'url' ? 'Over the web, at its address' : 'On this PC, as a program';
    detailEl.innerHTML =
      '<header class="sk-d-head"><span class="skill-dot' +
      (isOn(item) ? ' on' : '') +
      '"></span><div class="sk-d-name"><h2 title="' +
      esc(item.name) +
      '">' +
      esc(item.name) +
      '</h2><span class="skill-badge scope">' +
      esc(badge) +
      '</span>' +
      (own && item.every
        ? '<span class="skill-badge on">' + icon('zap', 11) + 'Every session</span>'
        : '') +
      '</div><button type="button" class="sk-x" data-act="close" aria-label="Close details" title="Close (Esc)">' +
      icon('x', 16) +
      '</button></header><div class="sk-d-scroll"><p class="sk-d-desc">' +
      esc(words) +
      '</p><div class="sk-d-actions">' +
      actions +
      '</div>' +
      confirm +
      '<section class="sk-d-sec"><h3>Reaches</h3>' +
      reachHtml(item) +
      '</section><section class="sk-d-sec"><h3>Details</h3><dl class="sk-d-facts">' +
      fact('Runs', esc(runs)) +
      keyHtml(item) +
      (item.signIn
        ? fact('Sign-in', 'Each tool asks you to sign in the first time an agent uses it')
        : '') +
      '</dl><code class="cn-code">' +
      esc(commandOf(item)) +
      '</code></section>' +
      threadsHtml(item) +
      '</div>';
    if (scroll) detailEl.querySelector('.sk-d-scroll').scrollTop = scroll;
    if (typed) {
      const again = detailEl.querySelector(
        '.cn-input[data-key-name="' + CSS.escape(typed[0]) + '"]'
      );
      if (again) {
        again.value = typed[1];
        if (document.activeElement === document.body || !document.activeElement)
          again.focus({ preventScroll: true });
      }
    }
  }

  function select(key, focusPanel) {
    if (selected === key) return;
    selected = key;
    confirmRemove = '';
    editingKey = '';
    detailKey = '';
    page
      .querySelectorAll('.skill-row')
      .forEach(row => row.setAttribute('aria-selected', String(row.dataset.key === key)));
    drawDetail();
    if (focusPanel && key) detailEl.querySelector('.sk-x')?.focus({ preventScroll: true });
  }

  function closeDetail() {
    const back =
      selected && page.querySelector('.skill-row[data-key="' + CSS.escape(selected) + '"]');
    select('');
    back?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- changes
  // Runs one change in main and says what went wrong; the list is read again either way.
  async function run(call, done) {
    if (busy) return false;

    // the control pressed is drawn again; the keyboard goes back to its new copy afterwards
    const pressed = document.activeElement;
    const again = pressed?.dataset?.act
      ? '[data-act="' +
        pressed.dataset.act +
        '"]' +
        (pressed.dataset.instance
          ? '[data-instance="' + CSS.escape(pressed.dataset.instance) + '"]'
          : '')
      : '';
    const inDetail = !!pressed?.closest?.('.sk-detail');
    busy = true;
    draw();
    let ok = false;
    try {
      const result = await call();
      ok = !!result && result.ok !== false;
      if (!ok) say(result?.error || 'Could not change it.');
      else if (done) say(done);
    } catch (error) {
      say('Could not change it: ' + (error?.message || error));
    }
    busy = false;
    await refresh();
    if (again && inDetail) detailEl.querySelector(again)?.focus({ preventScroll: true });
    return ok;
  }

  // ---------------------------------------------------------------- the add sheet
  // "Add your own" (a name and a command or a web address) or a suggested one: the exact command,
  // the tools it reaches, the safety line and Every session, before anything is saved.
  function openSheet(item) {
    const own = !item;
    const reachItem = item || {};
    const startsOff = !!item?.note;
    sheetOpener = document.activeElement;
    sheetWrap.innerHTML =
      '<div class="cn-sheet" role="dialog" aria-modal="true" aria-label="' +
      esc(own ? 'Add your own connection' : 'Add ' + item.name) +
      '"><h2>' +
      esc(own ? 'Add your own connection' : 'Add ' + item.name) +
      '</h2>' +
      (own
        ? '<p>A program on this PC or a web address that speaks MCP. Every agent tool gets it in its next session.</p>'
        : '<p>' + esc(item.desc || '') + '</p>') +
      '<div class="cn-safe">' +
      icon('triangle-alert', 14) +
      '<span>It runs on your PC with your rights. Only you can add a connection; an agent can suggest one, never add it.</span></div>' +
      (own
        ? '<label>Name<input class="cn-input" data-field="name" type="text" maxlength="60" autocomplete="off" spellcheck="false" placeholder="My database"></label>' +
          '<label>Command or web address<input class="cn-input" data-field="target" type="text" autocomplete="off" spellcheck="false" placeholder="npx -y my-mcp-server  or  https://…"></label>' +
          '<label>It runs this<code class="cn-code" data-field="preview">Nothing yet</code></label>'
        : '<label>' +
          (item.kind === 'url' ? 'It connects to this address' : 'It runs this command') +
          '<code class="cn-code">' +
          esc(commandOf(item)) +
          '</code></label>' +
          (item.keys || [])
            .map(
              key =>
                '<label>' +
                esc(key.name) +
                (data?.keysAvailable ? '' : ' (you can also add it later)') +
                '<input class="cn-input" type="password" autocomplete="off" spellcheck="false" data-key-name="' +
                esc(key.name) +
                '" placeholder="Paste ' +
                esc(key.name) +
                '"' +
                (data?.keysAvailable ? ' disabled' : '') +
                '></label>'
            )
            .join('') +
          (item.signIn
            ? '<p>Each tool asks you to sign in the first time an agent uses it.</p>'
            : '')) +
      '<label>For<span class="cn-reach cn-sheet-reach">' +
      reachHtml(reachItem).replace(/^<div class="cn-reach">|<\/div>$/g, '') +
      '</span></label>' +
      '<label>Turn on for<span class="cn-reach cn-sheet-reach"><button type="button" class="sk-switch" role="switch" data-field="every" aria-checked="' +
      !startsOff +
      '"><i></i><span>Every session</span></button><span class="cn-or">or choose threads after adding</span></span></label>' +
      (item?.note ? '<p>' + esc(item.note) + '</p>' : '') +
      '<p class="cn-sheet-error" role="alert" hidden></p>' +
      '<div class="cn-row"><button type="button" class="button" data-act="sheet-cancel">Cancel</button><button type="button" class="button dark" data-act="sheet-add">Add it</button></div></div>';
    sheetWrap.dataset.catalog = item ? item.id : '';
    const show = () => {
      sheetWrap.hidden = false;
    };
    if (window.TnaiMotion) window.TnaiMotion.swap(show, 'fold');
    else show();
    sheetWrap
      .querySelector('input:not(:disabled), [data-act="sheet-add"]')
      ?.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (sheetWrap.hidden) return;
    const hide = () => {
      sheetWrap.hidden = true;
      sheetWrap.replaceChildren();
    };
    if (window.TnaiMotion) window.TnaiMotion.swap(hide, 'fold');
    else hide();
    if (sheetOpener?.isConnected) sheetOpener.focus({ preventScroll: true });
    sheetOpener = null;
  }

  // "npx -y server" → { command, args }; "https://…" → { url }.
  function readTarget(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return { url: value };
    const words = value.match(/"[^"]*"|\S+/g) || [];
    const parts = words.map(word => word.replace(/^"(.*)"$/, '$1'));
    return { command: parts[0], args: parts.slice(1) };
  }

  function sheetError(text) {
    const line = sheetWrap.querySelector('.cn-sheet-error');
    if (!line) return;
    line.textContent = text;
    line.hidden = !text;
  }

  async function sheetAdd() {
    const connections = api();
    if (!connections?.add || busy) return;
    const every =
      sheetWrap.querySelector('[data-field="every"]')?.getAttribute('aria-checked') === 'true';
    const catalogId = sheetWrap.dataset.catalog;
    let request;
    if (catalogId) request = { catalogId, every };
    else {
      const name = sheetWrap.querySelector('[data-field="name"]')?.value.trim() || '';
      const target = readTarget(sheetWrap.querySelector('[data-field="target"]')?.value);
      if (!name) return sheetError('Give it a name.');
      if (!target) return sheetError('Give the command it runs, or its web address.');
      request = { name, ...target, every };
    }
    const keys = [...sheetWrap.querySelectorAll('.cn-input[data-key-name]')]
      .map(field => [field.dataset.keyName, field.value.trim()])
      .filter(([, value]) => value);
    busy = true;
    sheetError('');
    let result = null;
    try {
      result = await connections.add(request);
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    busy = false;
    if (!result?.ok) {
      sheetError(result?.error || 'Could not add it.');
      return;
    }
    for (const [name, value] of keys) {
      try {
        const saved = await connections.setKey(result.id, name, value);
        if (saved?.ok === false) say('Added, but the key was not kept: ' + (saved.error || ''));
      } catch (error) {
        say('Added, but the key was not kept: ' + (error?.message || error));
      }
    }
    closeSheet();
    say('Added · every agent tool gets it in its next session');
    await refresh();
    select('c:' + result.id);
  }

  sheetWrap.addEventListener('input', event => {
    if (event.target.dataset.field !== 'target') return;
    const target = readTarget(event.target.value);
    const preview = sheetWrap.querySelector('[data-field="preview"]');
    if (preview)
      preview.textContent = !target
        ? 'Nothing yet'
        : target.url || [target.command, ...target.args].join(' ');
    sheetError('');
  });
  sheetWrap.addEventListener('click', event => {
    if (event.target === sheetWrap) return closeSheet();
    const toggle = event.target.closest('[data-field="every"]');
    if (toggle)
      toggle.setAttribute('aria-checked', String(toggle.getAttribute('aria-checked') !== 'true'));
    const act = event.target.closest('button[data-act]')?.dataset.act;
    if (act === 'sheet-cancel') closeSheet();
    if (act === 'sheet-add') sheetAdd();
  });
  sheetWrap.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSheet();
    }
    if (event.key === 'Enter' && event.target.matches?.('input')) {
      event.preventDefault();
      sheetAdd();
    }

    // the keyboard stays inside the sheet while it is open
    if (event.key === 'Tab') {
      const stops = [...sheetWrap.querySelectorAll('input:not(:disabled), button:not(:disabled)')];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });

  // ---------------------------------------------------------------- presses on the page
  page.addEventListener('click', async event => {
    if (sheetWrap.contains(event.target)) return;
    const button = event.target.closest('button[data-act]');
    if (!button) {
      const row = event.target.closest('.skill-row');
      if (row) select(row.dataset.key === selected ? '' : row.dataset.key);
      return;
    }
    const act = button.dataset.act;
    const inDetail = !!button.closest('.sk-detail');
    const key = inDetail ? selected : button.closest('.skill-row')?.dataset.key;
    const item = key ? items().find(entry => entry.key === key) : null;
    const connections = api();
    if (act === 'filter') {
      filter = button.dataset.filter;
      draw();
      return;
    }
    if (act === 'close') return closeDetail();
    if (act === 'add-own') return openSheet(null);
    if (act === 'add-suggested' && item) return openSheet(item);
    if (act === 'adopt' && item && connections?.adopt) {
      // A server several tools have is named by each; the first of them is asked.
      const tool = String(item.tool || '').split(', ')[0];
      const added = await run(
        () => connections.adopt(tool, item.name),
        'Added for every agent · from the next session'
      );
      if (added) select('');
      return;
    }
    if (!item || item.group !== 'on' || !connections) return;
    if (act === 'every')
      return run(
        () => connections.setEvery(item.id, !item.every),
        '“' +
          item.name +
          '” ' +
          (item.every ? 'off' : 'on') +
          ' for every session · takes effect when a session starts'
      );
    if (act === 'thread') {
      const on = button.getAttribute('aria-checked') !== 'true';
      return run(() => connections.setThread(item.id, button.dataset.instance, on));
    }
    if (act === 'key-edit') {
      editingKey = button.dataset.keyName;
      detailKey = '';
      drawDetail();
      detailEl.querySelector('.cn-input')?.focus({ preventScroll: true });
      return;
    }
    if (act === 'key-save') return saveKey(item, button.dataset.keyName);
    if (act === 'remove') {
      confirmRemove = item.key;
      detailKey = '';
      drawDetail();
      detailEl.querySelector('[data-act="remove-yes"]')?.focus({ preventScroll: true });
      return;
    }
    if (act === 'remove-no') {
      confirmRemove = '';
      detailKey = '';
      drawDetail();
      return;
    }
    if (act === 'remove-yes') {
      confirmRemove = '';
      if (await run(() => connections.remove(item.id), 'Removed “' + item.name + '”')) select('');
    }
  });

  // The key goes one way, to main; the field is emptied at once and only "set" comes back.
  async function saveKey(item, name) {
    const field = detailEl.querySelector('.cn-input[data-key-name="' + CSS.escape(name) + '"]');
    const value = field?.value.trim() || '';
    if (!value) {
      field?.focus({ preventScroll: true });
      return;
    }
    if (field) field.value = '';
    editingKey = '';
    await run(() => api().setKey(item.id, name, value), name + ' kept');
  }

  page.addEventListener('keydown', event => {
    if (sheetWrap.contains(event.target)) return;
    const row = event.target.closest?.('.skill-row');
    if (row && event.target === row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      select(row.dataset.key, true);
    }
    if (event.key === 'Enter' && event.target.matches?.('.cn-input[data-key-name]')) {
      event.preventDefault();
      const item = items().find(entry => entry.key === selected);
      if (item) saveKey(item, event.target.dataset.keyName);
    }
    if (event.key === 'Escape' && selected) {
      event.preventDefault();
      closeDetail();
    }
  });

  // "/" jumps to the search while the page is shown and nothing else takes typing.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || !visible() || !sheetWrap.hidden) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)))
      return;
    event.preventDefault();
    filterEl.focus();
    filterEl.select();
  });
  filterEl.addEventListener('input', draw);

  // ---------------------------------------------------------------- live updates
  // Drawn only while shown: a change from main (any window, any agent's next session) is read
  // when it arrives and the page is up, and again each time the page is opened.
  window.addEventListener('tnai:connections-page-shown', () => {
    renderKey = '';
    draw();
    refresh();
  });
  try {
    api()?.onChanged?.(() => {
      if (visible()) refresh();
    });
  } catch {}

  // The sheet does not stay over another page.
  new MutationObserver(() => {
    if (!visible()) closeSheet();
  }).observe(layout, { attributes: true, attributeFilter: ['class'] });

  window.TnaiConnectionsPage = {
    open: () => window.TnaiRoute?.('connections'),
    visible,
    refresh,
    // for checks: what the page shows now
    state: () => ({
      cards: [...page.querySelectorAll('.skill-row')].map(row => row.dataset.key),
      selected,
      sheet: !sheetWrap.hidden,
    }),
    openSheet: key => {
      const item = key ? items().find(entry => entry.key === key) : null;
      openSheet(item || null);
    },
    select,
  };
})();
