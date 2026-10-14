// Technically Not · 118-thread-frame.js: the thread layout's frame.
// Desktop app only.
//
// The thread layout is the app. There is no setting and no switch: the app opens on the Threads
// page, and nothing in the interface leads to the old frame. The old frame's files are still
// loaded where other scripts call them; this file keeps them unseen:
// the old left navigation's items are hidden and the thread list stands in its place on every
// page, and a route to the old Overview or the old Agents page lands on Threads.
//
// The page shows itself the way the Live preview page does: its own mode class on .layout
// (threads-mode), and it lets go when another page's mode is set. The router is not touched.
//
// It makes three slots that are children of .layout: the thread list, the open thread and the
// side column. The app's own top bar and prompt box stay where they are, and the three-dots
// button in the top bar opens every other page (the panel is 124-thread-menu.js).
//
// Look: src/styles/27-thread-frame.css. `window.TnaiThreads`. Test: `thread-frame`.
(() => {
  'use strict';
  const STATE_KEY = 'tnai.thread-frame.v1';
  const MODE = 'threads-mode';

  // The page modes of every other page (08's MODES and 65's own). While one of them is set, another
  // page is showing.
  // The old frame's Overview and its Agents and history page. A route to either lands on Threads.
  // The router (08) no longer sets the second one's class at all; it is named here so that
  // anything that still sets it by hand ends on Threads too.
  const OLD_PAGES = ['overview-mode', 'agents-mode'];
  const OTHER_MODES = [
    'overview-mode',
    'terminal-mode',
    'code-mode',
    'skills-mode',
    'settings-mode',
    'agents-mode',
    'devices-mode',
    'preview-mode',
  ];

  const layout = document.querySelector('.layout');
  const topBar = document.querySelector('.top');
  const oldNav = layout?.querySelector('.sidebar') || null;
  const root = document.documentElement;
  const inApp = !!window.tnaiNative && !!layout && !!topBar;

  const read = (key, fallback) => {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {}
  };
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  // Always on in the desktop app. A settings folder that still holds the old switch's "off" is not
  // read any more.
  const enabled = inApp;
  let shown = false;
  let sideOpen = false;
  let selected = null;
  try {
    const saved = JSON.parse(read(STATE_KEY, '{}')) || {};
    if (typeof saved.selected === 'string') selected = saved.selected;
  } catch {}

  // ---------- the slots and the menu ----------
  const slots = { list: null, main: null, side: null };
  let menuButton = null;
  let menu = null;

  function makeSlot(tag, name, label) {
    const slot = document.createElement(tag);
    slot.className = 'tnt-slot tnt-' + name;
    slot.id = 'tnt' + name[0].toUpperCase() + name.slice(1);
    slot.setAttribute('aria-label', label);
    return slot;
  }

  // The rows of the three-dots menu. Each one opens a page the app has today, as it is.
  const MENU = [
    { group: 'Work' },
    { label: 'Threads', icon: 'panels-top-left', go: () => open() },
    {
      label: 'Usage and accounts',
      icon: 'chart-pie',
      go: () => window.TnaiSettings?.open('usage'),
    },
    { label: 'All threads', icon: 'square-terminal', go: () => window.TnaiRoute?.('terminal') },
    { label: 'Terminal', icon: 'terminal', go: () => window.TnaiOwnTerminal?.open() },
    { label: 'Live preview', icon: 'monitor-play', go: () => window.TnaiLivePreviewPage?.open() },
    { label: 'Skills', icon: 'sparkles', go: () => window.TnaiRoute?.('skills') },
    { group: 'This app' },
    {
      label: 'Devices and own relay',
      icon: 'monitor-smartphone',
      go: () => window.TnaiRoute?.('devices'),
    },
    { label: 'Settings', icon: 'settings', go: () => window.TnaiSettings?.open() },
    { label: 'Keyboard shortcuts', icon: 'command', go: () => window.TnaiShortcuts?.open() },
    {
      label: 'Command menu',
      icon: 'search',
      keys: 'Ctrl K',
      go: () => document.getElementById('topCommand')?.click(),
    },
  ];

  function makeMenu() {
    menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'tnt-menu-btn';
    menuButton.title = 'Pages and settings';
    menuButton.setAttribute('aria-label', 'Pages and settings');
    menuButton.setAttribute('aria-haspopup', 'menu');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.innerHTML = icon('ellipsis', 16);

    // The window buttons (66) stay the last thing in the bar.
    const right = topBar.querySelector('.top-right') || topBar;
    right.insertBefore(menuButton, right.querySelector('.win-ctrls'));

    // The panel that opens is another file's when there is one (124-thread-menu.js: the menu of
    // the mock, with its search field and Appearance). This file's own short list is the fallback
    // and is only built when it is first needed.
    menuButton.addEventListener('click', () => {
      const other = window.TnaiThreadMenu;
      if (other) {
        other.toggle(menuButton);
        return;
      }
      if (!menu) makeOwnMenu();
      setMenu(menu.hidden);
    });
  }

  function makeOwnMenu() {
    menu = document.createElement('div');
    menu.className = 'tnt-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Pages and settings');
    MENU.forEach((entry, index) => {
      if (entry.group) {
        const label = document.createElement('div');
        label.className = 'tnt-menu-label';
        label.textContent = entry.group;
        menu.append(label);
        return;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'tnt-menu-row';
      row.setAttribute('role', 'menuitem');
      row.dataset.row = String(index);
      row.innerHTML = icon(entry.icon, 16) + '<span></span>' + (entry.keys ? '<kbd></kbd>' : '');
      row.querySelector('span').textContent = entry.label;
      if (entry.keys)
        row.querySelector('kbd').textContent = window.tnaiKeys?.(entry.keys) || entry.keys;
      menu.append(row);
    });

    document.body.append(menu);
    menu.addEventListener('click', event => {
      const row = event.target.closest('.tnt-menu-row');
      if (!row) return;
      setMenu(false);
      MENU[Number(row.dataset.row)]?.go();
    });
    menu.addEventListener('keydown', onMenuKey);
  }

  function setMenu(open) {
    if (!open) window.TnaiThreadMenu?.close?.();
    if (!menu || menu.hidden === !open) return;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) {
      window.TnaiFloat?.attach(menuButton, menu, { placement: 'bottom-end', offset: 6 });

      // Placed first, focused after, and never scrolling the page (tnai-modern-ui, section 4).
      menu.querySelector('.tnt-menu-row')?.focus({ preventScroll: true });
      window.addEventListener('pointerdown', onOutsidePress, true);
    } else {
      window.TnaiFloat?.detach?.(menu);
      window.removeEventListener('pointerdown', onOutsidePress, true);
    }
  }

  // A press anywhere else closes the menu. The listener is on window in the capture phase, because
  // some parts of the app keep their clicks to themselves.
  function onOutsidePress(event) {
    if (menu.contains(event.target) || menuButton.contains(event.target)) return;
    setMenu(false);
  }

  function onMenuKey(event) {
    const rows = [...menu.querySelectorAll('.tnt-menu-row')];
    const at = rows.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = rows[(at + 1) % rows.length];
    else if (event.key === 'ArrowUp') next = rows[(at - 1 + rows.length) % rows.length];
    else if (event.key === 'Home') next = rows[0];
    else if (event.key === 'End') next = rows[rows.length - 1];
    else if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      setMenu(false);
      menuButton.focus({ preventScroll: true });
      return;
    }
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
  }

  // The thread list is on every page. On the Threads page it is a slot of the layout; on every
  // other page it stands where the old left navigation was, whose own items are hidden (27).
  function placeList(onThreadsPage) {
    const home = onThreadsPage ? layout : oldNav;
    if (!slots.list || !home || slots.list.parentElement === home) return;
    home.append(slots.list);
  }

  // A press on a thread, or on "New thread", from another page comes back to the Threads page.
  // The Terminal page is the exception: the thread list is its list of agents too (its own list is
  // not shown, 31), so a press on a thread of this project shows that panel's terminal there,
  // in whichever workspace it is.
  // A press in the list on another page brings the Threads page in with the app's page cross-fade
  // instead of at once (at once under reduced motion or in a window that is not shown).
  const openWithFade = () => (window.TnaiMotion ? window.TnaiMotion.swap(open, 'page') : open());

  function onListPress(event) {
    if (shown) return;
    const row = event.target.closest('.tnt-th');
    const paneId = row?.dataset.pane || '';
    const pane =
      paneId && layout.classList.contains('terminal-mode')
        ? [
            ...document.querySelectorAll('.terminal-workspace-view .terminal-pane[data-pane-id]'),
          ].find(node => node.dataset.paneId === paneId)
        : null;
    if (pane && window.TnaiTerminalPreview?.pick) {
      // A thread of another workspace: that workspace's tab is shown first (the thread
      // list is the list, so every agent in it is reached from here).
      const home = pane.closest('.terminal-workspace-view');
      if (home.hidden && !window.TnaiTerminalWorkspaces?.activate?.(home.dataset.workspaceId)) {
        openWithFade();
        return;
      }
      window.TnaiTerminalPreview.pick(paneId);
      return;
    }
    if (row || event.target.closest('.tnt-new')) openWithFade();
  }

  function build() {
    if (slots.list) return;
    slots.list = makeSlot('aside', 'list', 'Threads');
    slots.main = makeSlot('section', 'main', 'Thread');
    slots.side = makeSlot('aside', 'side', 'Code');
    slots.side.hidden = !sideOpen;
    layout.append(slots.list, slots.main, slots.side);

    // The prompt box is a part of the layout on every page: under the thread here, under the
    // content column elsewhere (27, 07). The page's markup has it beside the layout, and the old
    // Overview used to move it in; that file is gone, so it is moved in here, once.
    const promptBox = document.querySelector('.app > footer.composer');
    if (promptBox) layout.append(promptBox);
    slots.list.addEventListener('click', onListPress);
    makeMenu();

    // On the page root on every page (tnt-open is only on while the Threads page shows): the hook
    // for styles that give the other pages the new look.
    root.classList.add('tnt-on');
    watch.observe(layout, { attributes: true, attributeFilter: ['class'] });
    emit('tnai:threads-built');
  }

  // ---------- showing and hiding the page ----------
  // The layout's classes changed. A route to a page of the old frame lands on Threads; another
  // page's mode lets this page go.
  const watch = new MutationObserver(() => {
    if (OLD_PAGES.some(mode => layout.classList.contains(mode))) open();
    else if (shown && OTHER_MODES.some(mode => layout.classList.contains(mode))) hide();
  });

  function open() {
    if (!enabled) return;
    build();
    layout.classList.remove(...OTHER_MODES);
    layout.classList.add(MODE);
    root.classList.add('tnt-open');
    placeList(true);
    if (shown) return;
    shown = true;
    emit('tnai:threads-shown');
  }

  function hide() {
    if (!shown) return;
    shown = false;
    setMenu(false);
    layout.classList.remove(MODE);
    root.classList.remove('tnt-open');
    placeList(false);
    emit('tnai:threads-hidden');
  }

  function select(paneId) {
    const next = paneId == null ? null : String(paneId);
    if (next === selected) return;
    selected = next;
    write(STATE_KEY, JSON.stringify({ selected }));
    emit('tnai:threads-select', { paneId: selected });
  }

  window.TnaiThreads = {
    enabled: () => enabled,
    open,
    visible: () => shown,
    slot: name => slots[name] || null,
    selected: () => selected,
    select,

    // "Go to this agent", from anywhere in the app (a notice, Needs you, a loop, the live feed, a
    // team card): its thread is chosen and the Threads page shown. True when that agent has a
    // thread; false when it has none (a past conversation, a closed panel), and then nothing
    // changes on screen: the caller decides what to show.
    show(paneId) {
      const id = paneId == null ? '' : String(paneId);
      if (!enabled || !id || !window.TnaiThreadList?.thread?.(id)) return false;
      select(id);
      open();
      return true;
    },

    // The code column. It has no content yet (stage 4 and later), so nothing on screen opens it.
    side(wantOpen) {
      if (wantOpen === undefined || !!wantOpen === sideOpen) return sideOpen;
      sideOpen = !!wantOpen;
      if (slots.side) slots.side.hidden = !sideOpen;
      layout?.classList.toggle('tnt-has-side', sideOpen);
      emit('tnai:threads-side', { open: sideOpen });
      return sideOpen;
    },
  };

  // The start page, once every script has loaded (119 and 120 listen for the shown event).
  if (!enabled) return;
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', () => open(), { once: true });
  else setTimeout(open, 0);
})();
