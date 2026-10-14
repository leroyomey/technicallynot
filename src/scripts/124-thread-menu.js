/*
 * Technically Not · 124-thread-menu.js — the thread layout's three-dots menu.
 * Desktop app only, and only while the thread
 * layout's setting is on (118). With the setting off this file builds nothing and listens to
 * nothing but the setting's own event.
 *
 * The menu is how every page other than Threads is found: a search field (it also answers
 * Ctrl+K; Enter opens the first match) and two groups of rows, "Work" and "This app". Dark or
 * Light and the accent are chosen in Settings, and the bell stands in the top bar, so neither
 * has a place in the menu. Every row opens something the app really has;
 * the last row of "Work", "Stop all agents", is there only while an agent runs and asks first. One
 * more row, the command menu, shows only while a search finds it. The old frame's Overview and
 * its Agents and history page have no row: the thread layout is the app, and what that page
 * showed is in a thread's own top row.
 *
 * The button is 118's (`.tnt-menu-btn` in the top bar); 118 calls TnaiThreadMenu.toggle(button).
 * The panel keeps 118's class names (`.tnt-menu`, `.tnt-menu-row`, `.tnt-menu-label`). This file
 * also adds the Dark / Light choice to Settings › General › Color while the setting is on.
 *
 * Look: src/styles/31-thread-pages.css. `window.TnaiThreadMenu`. Tests: `thread-pages`,
 * `thread-stop-all`.
 */
(() => {
  'use strict';
  if (!window.tnaiNative) return;

  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  // A change of the whole page never jumps: the page before fades into the page after (the
  // cross-fade the app has for page changes). Under reduced motion, or in a window that is not
  // shown, the change is made at once. Only for rows that change the page: a row that opens a
  // question, a box or a panel runs as it is.
  const fade = (change, kind) =>
    window.TnaiMotion ? window.TnaiMotion.swap(change, kind) : change();
  const page = open => () => fade(open, 'page');
  const settings = tab => page(() => window.TnaiSettings?.open(tab));
  const route = view => page(() => window.TnaiRoute?.(view));

  // Dark and Light swap the same way, so the whole window does not flip in one frame.
  const setLook = look => fade(() => theme()?.set(look), 'fold');

  // ---------- Stop all agents ----------
  // Every session whose process runs now, plain terminal panels included.
  function runningSessions() {
    try {
      return (window.TnaiAgents?.sessions?.() || []).filter(session => session.running === true);
    } catch {
      return [];
    }
  }

  // The part of the window the page shown now fills: the largest thing on screen in the layout.
  // The layout itself cannot hold the question, since the Threads page hides every child of it
  // that is not one of its own islands.
  function pageArea() {
    const area = el => el.offsetWidth * el.offsetHeight;
    return [...(document.querySelector('.layout')?.children || [])]
      .filter(el => el.getClientRects().length > 0 && !el.matches('footer.composer'))
      .sort((a, b) => area(b) - area(a))[0];
  }

  // One question for all of them, laid over the page that shows. Only "Stop all" stops anything;
  // the agents asked about are the ones that ran when the question came up.
  function stopAll() {
    const running = runningSessions();
    const host = pageArea();
    if (!running.length || !host || !window.TnaiPanelConfirm) return;

    // The question gives the keyboard back to where it was when it closes: the menu's button,
    // since the row that was pressed is hidden by then.
    document.querySelector('.top .tnt-menu-btn')?.focus({ preventScroll: true });
    const many = running.length === 1 ? '' : 's';
    window
      .TnaiPanelConfirm(host, {
        title: 'Stop all ' + running.length + ' running agent' + many + '?',
        body:
          'Every running agent process is ended: ' +
          running.map(session => session.name).join(', ') +
          '. Each can be started again later, resuming its conversation where its program ' +
          'saved one. Queued prompts are not sent.',
        ok: 'Stop all',
        danger: true,
      })
      .then(yes => {
        if (yes) running.forEach(session => window.TnaiAgents?.stop?.(session.paneId));
      });
  }

  // The rows. `words` are what a search also finds the row by; `key` is a shortcut shown at the
  // row's end; `searchOnly` rows are not in the list until a search finds them.
  const GROUPS = [
    {
      name: 'Work',
      rows: [
        {
          label: 'Threads',
          icon: 'panels-top-left',
          words: 'home agents conversations list back',
          go: page(() => window.TnaiThreads?.open()),
        },
        {
          label: 'All threads',
          icon: 'square-terminal',
          words: 'panels powershell workspace grid',
          go: route('terminal'),
        },
        {
          // The one plain terminal for the user's own commands (136): the Threads page with its
          // side column on the Terminal tab. From another page that is a change of page; on the
          // Threads page only the column opens.
          label: 'Terminal',
          icon: 'terminal',
          words: 'powershell commands shell console command line own',
          go: () => {
            const open = () => window.TnaiOwnTerminal?.open();
            if (window.TnaiThreads?.visible()) open();
            else fade(open, 'page');
          },
        },
        {
          label: 'Live preview',
          icon: 'monitor-play',
          words: 'devices side by side localhost browser phone tablet',
          go: page(() => window.TnaiLivePreviewPage?.open()),
        },
        {
          label: 'Projects',
          icon: 'folder',
          words: 'folders open another switch add',
          go: () => window.TnaiPalette?.open('Projects'),
        },
        {
          // Project housekeeping (35): agent worktrees whose panel is closed. The row is in the
          // list only while there are any; a press opens their Merge, Keep working, Discard box.
          label: 'Worktrees without a panel',
          icon: 'git-branch',
          words: 'worktree branch merge discard free closed',
          when: () => (window.TnaiWorktrees?.free?.() || []).length > 0,
          go: () => {
            const free = window.TnaiWorktrees?.free?.() || [];
            if (free[0])
              window.TnaiWorktrees.land(
                free[0].branch,
                document.querySelector('.top .tnt-menu-btn')
              );
          },
        },
        {
          label: 'Skills',
          icon: 'sparkles',
          words: 'library project rules custom agents',
          go: route('skills'),
        },
        {
          // The one way to end every running agent at once. In the list only while an agent
          // runs, and it asks before anything is stopped.
          label: 'Stop all agents',
          icon: 'square',
          words: 'end halt kill running every process',
          when: () => runningSessions().length > 0,
          go: stopAll,
        },
      ],
    },
    {
      name: 'This app',
      rows: [
        {
          label: 'Usage and accounts',
          icon: 'gauge',
          words: 'tokens limits plan claude codex cursor',
          go: settings('usage'),
        },
        {
          label: 'Devices and own relay',
          icon: 'monitor-smartphone',
          words: 'computers pair phone',
          go: route('devices'),
        },
        {
          label: 'Settings',
          icon: 'settings',
          words: 'general appearance look dark light accent color terminal layout',
          go: settings('general'),
        },
      ],
    },
    {
      // Found by the search only. The three tabs of Settings are not listed: Settings has its
      // own row, and a list of shortcuts into one page made the menu read as unsorted. Typing
      // what one is about still opens it at once.
      name: 'More',
      searchOnly: true,
      rows: [
        {
          label: 'Keyboard shortcuts',
          icon: 'command',
          key: '?',
          words: 'keys',
          go: settings('keyboard'),
        },
        {
          label: 'Voice and snapshot',
          icon: 'zap',
          words: 'microphone hold to talk screen picture',
          go: settings('voice'),
        },
        {
          label: 'Updates and what is new',
          icon: 'rotate-cw',
          words: 'version release notes',
          go: settings('updates'),
        },
        {
          label: 'Command menu',
          icon: 'search',
          words: 'actions commands palette file tnai',
          go: () => window.TnaiPalette?.open(),
        },
      ],
    },
  ];

  // The two looks. They are chosen in Settings › General › Color (the row this file adds there,
  // beside the accent picker), not in the menu: the menu is for going somewhere.
  const LOOKS = [
    ['dark', 'Dark'],
    ['light', 'Light'],
  ];

  let menu = null;
  let button = null;
  let search = null;
  let none = null;
  let lastFocus = null;
  const actions = [];

  // row number → its `when`, for the rows that are in the list only while something is true
  const conditions = new Map();

  const theme = () => window.TnaiTheme;
  const enabled = () => !!window.TnaiThreads?.enabled();

  // ---------- building ----------
  function rowHtml(row, index) {
    // Plain small text, not the app's key chip: one chip at a row's end would stand out of the
    // list.
    const key = row.key ? '<small class="tnt-menu-key">' + row.key + '</small>' : '';
    const words = (row.label + ' ' + row.words).toLowerCase();
    return (
      '<button type="button" class="tnt-menu-row" role="menuitem" data-row="' +
      index +
      '" data-words="' +
      words +
      '">' +
      icon(row.icon, 16) +
      '<span>' +
      row.label +
      '</span>' +
      key +
      '</button>'
    );
  }

  function groupHtml(group) {
    const rows = group.rows
      .map(row => {
        actions.push(row.go);
        if (row.when) conditions.set(actions.length - 1, row.when);
        return rowHtml(row, actions.length - 1);
      })
      .join('');
    const only = group.searchOnly ? ' data-search-only hidden' : '';
    return (
      '<div class="tnt-menu-group" role="group" aria-label="' +
      group.name +
      '"' +
      only +
      '><div class="tnt-menu-label">' +
      group.name +
      '</div>' +
      rows +
      '</div>'
    );
  }

  function build() {
    if (menu) return;
    actions.length = 0;
    menu = document.createElement('div');
    menu.className = 'tnt-menu tnt-menu-full';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Pages and settings');
    const keys = window.tnaiKeys?.('Ctrl K') || 'Ctrl K';
    menu.innerHTML =
      '<label class="tnt-menu-search">' +
      icon('search', 16) +
      '<input type="text" placeholder="Find a page or a setting…" autocomplete="off" ' +
      'spellcheck="false" aria-label="Find a page or a setting"><kbd>' +
      keys +
      '</kbd></label>' +
      GROUPS.map(groupHtml).join('') +
      '<p class="tnt-menu-none" hidden>Nothing by that name.</p>';
    document.body.append(menu);
    search = menu.querySelector('.tnt-menu-search input');
    none = menu.querySelector('.tnt-menu-none');

    menu.addEventListener('click', onClick);
    menu.addEventListener('keydown', onKey);
    search.addEventListener('input', () => filter(search.value));
  }

  function remove() {
    close();
    menu?.remove();
    menu = search = none = button = null;
  }

  // ---------- the list ----------
  const visibleRows = () =>
    [...menu.querySelectorAll('.tnt-menu-row')].filter(row => row.getClientRects().length);

  // Typing leaves only the rows that match. A group with no match leaves whole, label included.
  function filter(text) {
    const want = text.trim().toLowerCase();
    let found = 0;
    menu.querySelectorAll('.tnt-menu-group:not(.tnt-menu-look)').forEach(group => {
      let inGroup = 0;
      group.querySelectorAll('.tnt-menu-row').forEach(row => {
        // A match starts at the start of a word, so "phone" does not find "microphone".
        const when = conditions.get(Number(row.dataset.row));
        const hit =
          (!when || when()) &&
          (want
            ? (' ' + row.dataset.words).includes(' ' + want)
            : !group.hasAttribute('data-search-only'));
        row.hidden = !hit;
        inGroup += hit ? 1 : 0;
      });
      group.hidden = !inGroup;
      found += inGroup;
    });
    none.hidden = found > 0;
  }

  function run(row) {
    const go = actions[Number(row.dataset.row)];
    close();
    go?.();
  }

  function onClick(event) {
    const row = event.target.closest('.tnt-menu-row');
    if (row) run(row);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    const rows = visibleRows();
    if (event.key === 'Enter' && event.target === search) {
      event.preventDefault();
      if (rows[0]) run(rows[0]);
      return;
    }

    // The arrow keys walk the search field and the rows as one list.
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const stops = [search, ...rows];
    const at = stops.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    stops[(at + step + stops.length) % stops.length].focus({ preventScroll: true });
  }

  // ---------- the look that is chosen, marked on the row in Settings ----------
  function paintAppearance() {
    const choice = theme()?.get?.() === 'light' ? 'light' : 'dark';
    document.querySelectorAll('[data-look]').forEach(el => {
      el.setAttribute('aria-pressed', String(el.dataset.look === choice));
    });
  }

  // ---------- opening and closing ----------
  // A press anywhere else closes the menu. On window in the capture phase, because some parts of
  // the app keep their clicks to themselves.
  function onOutsidePress(event) {
    if (menu.contains(event.target) || button?.contains(event.target)) return;
    close();
  }

  function open(anchor, focusSearch) {
    if (!enabled()) return;
    build();
    button = anchor || button || document.querySelector('.top .tnt-menu-btn');
    if (!button || !menu.hidden) return;

    // Closed with Escape, the focus goes back to where it was: the place the user was typing when
    // Ctrl+K opened the menu, or the button when a press on it did.
    const before = document.activeElement;
    lastFocus = focusSearch && before && before !== document.body ? before : button;
    search.value = '';
    filter('');
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    window.TnaiFloat?.attach(button, menu, { placement: 'bottom-end', offset: 6 });

    // Placed first, focused after, and never scrolling the page (tnai-modern-ui, section 4).
    const first = focusSearch ? search : visibleRows()[0] || search;
    first.focus({ preventScroll: true });
    window.addEventListener('pointerdown', onOutsidePress, true);
  }

  function close(returnFocus) {
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
    window.TnaiFloat?.detach?.(menu);
    window.removeEventListener('pointerdown', onOutsidePress, true);
    if (returnFocus) (lastFocus?.isConnected ? lastFocus : button)?.focus({ preventScroll: true });
  }

  const isOpen = () => !!menu && !menu.hidden;

  // Ctrl+K is the menu's search while the setting is on. Inside a terminal the keys belong to the
  // program there, and an open command menu closes itself with them (39).
  function onShortcut(event) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    if (event.key.toLowerCase() !== 'k' || !enabled()) return;
    if (window.TnaiPalette?.isOpen?.()) return;
    const inTerminal = event.target?.closest?.('.xterm, [contenteditable="true"]');
    if (inTerminal && !(window.tnaiPlatform?.mac && event.metaKey)) return;
    event.preventDefault();
    event.stopPropagation();
    if (isOpen()) close(true);
    else open(null, true);
  }

  // ---------- Settings › General › Color: Dark or Light, only while the setting is on ----------
  let lookRow = null;

  function addLookRow() {
    const card = document.querySelector('#tnaiAppearanceMount .set-card');
    if (lookRow || !card) return;
    lookRow = document.createElement('div');
    lookRow.className = 'set-row tnt-look-row';
    lookRow.innerHTML =
      '<span class="set-text"><b>Look</b><small>Dark is a clean neutral dark. Light is an ' +
      'off-white.</small></span><div class="tnt-menu-seg">' +
      LOOKS.map(
        ([value, label]) =>
          '<button type="button" data-look="' +
          value +
          '" aria-pressed="false">' +
          label +
          '</button>'
      ).join('') +
      '</div>';
    card.prepend(lookRow);
    lookRow.addEventListener('click', event => {
      const look = event.target.closest('[data-look]');
      if (look) setLook(look.dataset.look);
    });
    paintAppearance();
  }

  function removeLookRow() {
    lookRow?.remove();
    lookRow = null;
  }

  // ---------- the setting ----------
  let listening = false;

  function start() {
    if (listening) return;
    listening = true;
    window.addEventListener('keydown', onShortcut, true);
    window.addEventListener('tnai:theme-changed', paintAppearance);
    window.addEventListener('tnai:settings-page-shown', addLookRow);
    addLookRow();
  }

  function stop() {
    if (!listening) return;
    listening = false;
    window.removeEventListener('keydown', onShortcut, true);
    window.removeEventListener('tnai:theme-changed', paintAppearance);
    window.removeEventListener('tnai:settings-page-shown', addLookRow);
    removeLookRow();
    remove();
  }

  window.TnaiThreadMenu = {
    open,
    close,
    isOpen,
    toggle: anchor => (isOpen() ? close() : open(anchor)),
  };

  window.addEventListener('tnai:threads-setting', event => {
    if (event.detail?.on) start();
    else stop();
  });

  // 118 reads the setting when it loads; this file loads after it.
  if (enabled()) {
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})();
