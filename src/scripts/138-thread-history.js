// Technically Not · 138-thread-history.js — Desktop only: the two things of the old "Agents and
// history" page that are not an agent of this computer, in the thread view.
//
// - Past conversations. A row of the thread's "..." menu (137) and a button at the foot of the
//   thread list, which is there on every page and with no thread open.
//   It opens a popover in the app's menu material (`.tnt-menu`, 27): the open project's past
//   conversations, newest first, each with its tool, its first words and its date. A press on one
//   shows it inside the same popover, read-only: what is known about it and the short parts that
//   were read of it, with a way back to the list and Resume. Resume and the reading are 117's
//   (`TnaiPastThreads`); the resumed agent's thread is opened by it. Escape and a press outside
//   close the popover.
// - Another computer's agent as a thread. A press on its row of the thread list (119 draws the
//   rows) is taken here, before 119's own handler: the agent is selected (116 `pick`) and its
//   detail, with the same buttons doing the same things, fills the thread's main area in place
//   of the open thread, in a box of this file that 116 draws into (`mount`). A press on a thread
//   of this computer, or "go to this agent" from anywhere, brings that thread back.
//
// Neither needs the old page: the layout never gets the class `agents-mode` from here.
// `window.TnaiThreadHistory` (`open`, `close`, `isOpen`, `remote`, `closeRemote`). Look:
// src/styles/40-thread-history.css. Tests: `thread-history`, `thread-remote`.
(() => {
  'use strict';
  const layout = document.querySelector('.layout');
  if (!layout || !window.tnaiNative) return;

  const threads = () => window.TnaiThreads;
  const past = () => window.TnaiPastThreads;
  const remote = () => window.TnaiRemoteAgents;
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };
  const say = message =>
    typeof window.toast === 'function' ? window.toast(message) : console.info(message);
  const reducedMotion = () => !!window.TnaiMotion?.reduced?.();

  // A change of what the main area holds, made by a press, fades as a change of page does (at
  // once under reduced motion or in a window that is not drawn).
  const fade = change =>
    window.TnaiMotion?.swap ? window.TnaiMotion.swap(change, 'page') : change();

  const WHEN = new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const when = at => (at > 0 ? WHEN.format(new Date(at)) : '');

  function sizeWords(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes > 0 ? bytes + ' bytes' : '';
  }

  // ====================================================================== past conversations
  const NAME = 'Past conversations';
  const TIP = 'Past conversations of this project: read one, or continue it';

  // ---------- the button at the foot of the thread list ----------
  function makeButton(className, withWords) {
    const button = make('button', className);
    button.type = 'button';
    button.title = TIP;
    button.setAttribute('aria-label', NAME);
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = icon('file-text', 16) + (withWords ? '<span></span>' : '');
    if (withWords) button.querySelector('span').textContent = NAME;
    button.addEventListener('click', () => toggle(button));
    return button;
  }
  const footButton = makeButton('tnh-foot-btn', true);
  const foot = make('div', 'tnh-foot');
  foot.append(footButton);

  // The list slot is filled by 119, which puts its own island in once; looked at again whenever
  // it was drawn. (The top row's button went into the thread's "..." menu, 137, user 2026-10-24.)
  function placeButtons() {
    if (!past()) return;
    const frame = threads();
    const list = frame?.slot('list');
    if (list && (foot.parentNode !== list || list.lastElementChild !== foot)) list.append(foot);
  }

  // ---------- the popover ----------
  let pop = null;
  let ui = null;
  let opener = null;
  let shownKey = '';
  const rows = new Map();
  const isOpen = () => !!pop && !pop.hidden;
  const onScreen = node => !!node && node.isConnected && node.getClientRects().length > 0;

  function build() {
    if (pop) return;
    pop = make('div', 'tnt-menu tnh-pop');
    pop.hidden = true;
    pop.tabIndex = -1;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', NAME);
    pop.innerHTML =
      '<div class="tnh-list"><div class="tnt-menu-label">Past conversations</div>' +
      '<p class="tnh-note" role="status"></p>' +
      '<div class="tnh-rows" role="listbox" aria-label="Past conversations"></div></div>' +
      '<div class="tnh-one" hidden><div class="tnh-one-head">' +
      '<button type="button" class="tnh-back" aria-label="All past conversations" ' +
      'title="All past conversations">' +
      icon('arrow-left', 16) +
      '</button><b class="tnh-one-title"></b></div>' +
      '<p class="tnh-one-sub"></p><p class="tnh-one-note"></p><dl class="tnh-kv"></dl>' +
      '<div class="tnh-excerpt"></div><div class="tnh-one-acts">' +
      '<button type="button" class="tnh-resume"></button></div></div>';
    const find = selector => pop.querySelector(selector);
    ui = {
      list: find('.tnh-list'),
      note: find('.tnh-note'),
      rows: find('.tnh-rows'),
      one: find('.tnh-one'),
      back: find('.tnh-back'),
      title: find('.tnh-one-title'),
      sub: find('.tnh-one-sub'),
      oneNote: find('.tnh-one-note'),
      facts: find('.tnh-kv'),
      excerpt: find('.tnh-excerpt'),
      resume: find('.tnh-resume'),
    };
    ui.rows.addEventListener('click', event => {
      const row = event.target.closest('.tnh-row');
      if (row) past()?.pick(row.dataset.thread);
    });
    ui.back.addEventListener('click', () => past()?.back());
    ui.resume.addEventListener('click', () => {
      if (!ui.resume.disabled) past()?.resume(shownKey);
    });
    pop.addEventListener('keydown', onKey);
    document.body.append(pop);
  }

  // The mark of a conversation's tool, as the thread list's rows and the top row name a tool.
  function setMark(node, tool) {
    if (node.dataset.tool === tool) return;
    node.dataset.tool = tool;
    const mark = window.TnaiCliIcons?.svg?.(tool) || '';
    if (mark) node.innerHTML = mark;
    else node.textContent = (tool || '?').trim().charAt(0).toUpperCase();
  }

  function rowFor(key) {
    let row = rows.get(key);
    if (row) return row;
    const button = make('button', 'tnh-row');
    button.type = 'button';
    button.tabIndex = -1;
    button.dataset.thread = key;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.innerHTML =
      '<span class="tnh-mark" aria-hidden="true"></span>' +
      '<span class="tnh-row-text"><b></b><small></small></span>';
    row = {
      button,
      mark: button.querySelector('.tnh-mark'),
      title: button.querySelector('b'),
      line: button.querySelector('small'),
    };
    rows.set(key, row);
    return row;
  }

  // The list: one row per conversation, in the order the main process gave (newest first). Every
  // text from a file is put in as a text node.
  function paintList(known) {
    const count = known.threads.length;
    let note = count ? '' : 'None in this project yet.';
    if (known.state === 'reading' && !count) note = 'Reading…';
    else if (known.state === 'failed') note = 'They could not be read.';
    else if (count)
      note =
        count +
        (known.more ? ' newest' : '') +
        ' in this project, saved on this computer. Newest first.';
    setText(ui.note, note);
    const wanted = [];
    const alive = new Set();
    for (const thread of known.threads) {
      const row = rowFor(thread.key);
      const inPanel = !!past().panelOf(thread.key);
      const line = [inPanel ? 'In a thread now' : '', thread.cli, thread.name, when(thread.at)]
        .filter(Boolean)
        .join(' · ');
      alive.add(thread.key);
      setMark(row.mark, thread.cli);
      setText(row.title, thread.title || 'No first words');
      setText(row.line, line);
      const tip = (thread.title || '') + '\n' + line;
      if (row.button.title !== tip) row.button.title = tip;
      wanted.push(row.button);
    }
    for (const [key, row] of rows)
      if (!alive.has(key)) {
        row.button.remove();
        rows.delete(key);
      }

    // The same rows in the same order are left alone, so the keyboard's place stays.
    const current = [...ui.rows.children];
    if (wanted.length !== current.length || wanted.some((node, at) => node !== current[at]))
      ui.rows.replaceChildren(...wanted);
    setTabStop();
  }

  // One row takes Tab: the focused one, else the first.
  function setTabStop() {
    const all = [...ui.rows.children];
    const stop = all.find(row => row === document.activeElement) || all[0];
    all.forEach(row => {
      const want = row === stop ? 0 : -1;
      if (row.tabIndex !== want) row.tabIndex = want;
    });
  }

  const fact = (list, name, value) => {
    if (value) list.append(make('dt', '', name), make('dd', '', value));
  };

  // The short parts that were read of the conversation: the first thing asked, the last thing
  // asked and how it ended, as far as the parts that are looked at hold them.
  function excerptParts(read) {
    if (read === 'reading' || !read) return [make('p', '', 'Reading…')];
    const parts = [];
    if (read.first) parts.push(make('p', '', 'First asked'), make('p', 'tnh-text', read.first));
    if (read.asked) parts.push(make('p', '', 'Last asked'), make('p', 'tnh-text', read.asked));
    if (read.answer) parts.push(make('p', '', 'Last answer'), make('p', 'tnh-text', read.answer));
    parts.push(
      make(
        'p',
        '',
        parts.length
          ? 'Short parts only. The whole conversation shows after Resume.'
          : 'Nothing readable was found in the parts of this conversation that are looked at. ' +
              'The whole conversation shows after Resume.'
      )
    );
    return parts;
  }

  // One conversation, read-only: what is known about it, the excerpt, and Resume.
  function paintOne(thread, known) {
    const inPanel = !!past().panelOf(thread.key);
    const held = thread.remote === true;
    setText(ui.title, thread.title || 'No first words');
    ui.title.title = thread.title || '';
    setText(
      ui.sub,
      [thread.cli, thread.name ? 'agent ' + thread.name : '', when(thread.at)]
        .filter(Boolean)
        .join(' · ')
    );
    setText(
      ui.oneNote,
      inPanel
        ? 'This conversation is in a thread now.'
        : 'This conversation is not running. Resume opens a thread that continues it' +
            (held
              ? ', at "Ask first": its agent was started from another computer, so it asks ' +
                'before it runs commands or edits files.'
              : '.')
    );
    const facts = make('dl');
    fact(facts, 'Last active', when(thread.at));
    fact(facts, 'Started', when(thread.started));
    fact(facts, 'Tool', thread.cli);
    fact(facts, 'Agent', thread.name || '');
    fact(facts, 'Saved size', sizeWords(thread.bytes));
    fact(facts, 'On resume', held ? 'Ask first (started from another computer)' : '');
    fact(facts, 'Conversation', thread.id);
    const factsKey = JSON.stringify([...facts.children].map(node => node.textContent));
    if (ui.facts.dataset.key !== factsKey) {
      ui.facts.dataset.key = factsKey;
      ui.facts.replaceChildren(...facts.children);
    }
    const excerptKey = JSON.stringify([thread.key, known.excerpt]);
    if (ui.excerpt.dataset.key !== excerptKey) {
      ui.excerpt.dataset.key = excerptKey;
      ui.excerpt.replaceChildren(...excerptParts(known.excerpt));
    }
    ui.resume.disabled = known.busy;
    setText(ui.resume, known.busy ? 'Resuming…' : inPanel ? 'Open its thread' : 'Resume');
    ui.resume.title = inPanel
      ? 'This conversation is in a thread now: open it'
      : 'Open a thread that continues this conversation' + (held ? ', at "Ask first"' : '');
    ui.resume.setAttribute(
      'aria-label',
      (inPanel ? 'Open the thread of ' : 'Resume ') + (thread.title || 'this conversation')
    );
  }

  // The part that comes in fades in briefly; the popover itself keeps its place and size rules.
  function fadeIn(node) {
    if (reducedMotion() || !node.animate) return;
    node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
  }

  function paint() {
    if (!isOpen()) return;
    const known = past().state();
    const thread = known.selected
      ? known.threads.find(one => one.key === known.selected) || null
      : null;
    const wasKey = shownKey;
    const hadFocus = pop.contains(document.activeElement);
    shownKey = thread ? thread.key : '';
    paintList(known);
    if (thread) paintOne(thread, known);
    ui.list.hidden = !!thread;
    ui.one.hidden = !thread;

    // another computer's past conversations, under this computer's (164, plan item 44)
    window.TnaiRemoteThreadMore?.paintPast?.(pop, ui);
    if (wasKey === shownKey) {
      // the list came in while the popover had the keyboard: its first row takes it
      if (!thread && document.activeElement === pop) focusList('');
      return;
    }
    fadeIn(thread ? ui.one : ui.list);
    if (!hadFocus) return;
    if (thread) ui.resume.focus({ preventScroll: true });
    else focusList(wasKey);
  }

  // The keyboard goes to the row of the conversation that was read, else to the first row, else
  // to the popover itself (an empty list).
  function focusList(key) {
    const row = (key && rows.get(key)?.button) || ui.rows.firstElementChild;
    (row?.isConnected ? row : pop).focus({ preventScroll: true });
    setTabStop();
  }

  // What Tab moves through: the list's one tab stop, or the detail's two buttons.
  function tabStops() {
    // another computer's part of the popover (164): its rows, or its one conversation alone
    const far = window.TnaiRemoteThreadMore?.pastStops?.() || null;
    if (far?.only) return far.buttons;
    if (ui.one.hidden)
      return [...ui.rows.children].filter(row => row.tabIndex === 0).concat(far ? far.buttons : []);
    return [ui.back, ui.resume].filter(button => !button.disabled);
  }

  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }

    // Tab stays inside while the popover is open: nothing is left open behind the keyboard.
    if (event.key === 'Tab') {
      const stops = tabStops();
      event.preventDefault();
      if (!stops.length) return;
      const at = stops.indexOf(document.activeElement);
      const step = event.shiftKey ? -1 : 1;
      stops[(at + step + stops.length) % stops.length].focus({ preventScroll: true });
      return;
    }
    if (!ui.one.hidden) return;
    const all = [...ui.rows.children];
    const at = all.indexOf(document.activeElement);
    let next = null;
    if (event.key === 'ArrowDown') next = all[Math.min(all.length - 1, at + 1)];
    else if (event.key === 'ArrowUp') next = all[Math.max(0, at - 1)];
    else if (event.key === 'Home') next = all[0];
    else if (event.key === 'End') next = all[all.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus({ preventScroll: true });
    setTabStop();
  }

  // A press anywhere else closes the popover. On window in the capture phase, because some parts
  // of the app keep their presses to themselves. A press on something that takes no focus would
  // leave the keyboard nowhere, so it goes back to the button then.
  function onOutsidePress(event) {
    const target = event.target;
    if (pop.contains(target) || opener?.contains(target) || footButton.contains(target)) return;
    const back = opener;
    close(false);
    setTimeout(() => {
      // nowhere: on the page itself, or still on a row of the popover that is closed now
      const at = document.activeElement;
      if (!at || at === document.body || pop.contains(at)) focusButton(back);
    }, 0);
  }

  // The button the popover was opened from, or the one that is on screen now.
  function focusButton(wanted) {
    const button = [wanted, footButton].find(onScreen);
    button?.focus({ preventScroll: true });
  }

  function showPop() {
    build();
    if (isOpen()) return;
    if (!onScreen(opener)) opener = onScreen(footButton) ? footButton : null;
    const anchor = opener || document.querySelector('.top .tnt-menu-btn');

    // nothing to stand at: the list is not left asked for behind a popover that never showed
    if (!anchor) {
      past().close();
      return;
    }
    shownKey = '';
    pop.hidden = false;
    footButton.setAttribute('aria-expanded', String(footButton === opener));
    window.TnaiFloat?.attach(anchor, pop, {
      placement: opener === footButton ? 'top-start' : 'bottom-end',
      offset: 6,
      // the same 600 px cap as 40-thread-history.css: the placement's own height wins over CSS
      maxHeight: 600,
    });

    // placed first, focused after, and never scrolling the page
    pop.focus({ preventScroll: true });
    window.addEventListener('pointerdown', onOutsidePress, true);
    paint();
  }

  function hidePop(returnFocus) {
    if (!isOpen()) return;
    const back = opener;
    pop.hidden = true;
    window.TnaiRemoteThreadMore?.pastClosed?.();
    footButton.setAttribute('aria-expanded', 'false');
    window.TnaiFloat?.detach?.(pop);
    window.removeEventListener('pointerdown', onOutsidePress, true);
    if (returnFocus) focusButton(back);
  }

  // Opening and closing go through 117: it asks for the list, and tells this file what to show.
  function open(button) {
    if (!past()) return;
    opener = button || opener;
    past().show();
  }

  function close(returnFocus) {
    hidePop(returnFocus);
    past()?.close();
  }

  function toggle(button) {
    if (isOpen()) close(true);
    else open(button);
  }

  window.addEventListener('tnai:past-threads-changed', () => {
    const known = past()?.state();
    if (!known?.shown) {
      hidePop(pop?.contains(document.activeElement));
      return;
    }
    if (!isOpen()) showPop();
    else paint();
  });

  // ====================================================================== another computer's agent
  // The box in the thread's main area that 116 draws its detail into. It stands beside 120's own
  // island there, which is not shown meanwhile (40).
  const host = make('div', 'tnh-view');
  host.hidden = true;
  host.setAttribute('role', 'region');
  host.setAttribute('aria-label', 'Agent on another computer');
  let remoteOn = false;

  // The agent of another computer that fills the main area now, or ''.
  const remoteKey = () => (remoteOn ? remote()?.selected?.() || '' : '');

  function showRemote() {
    const frame = threads();
    if (!frame || !remote()?.mount) return false;

    // From another page: the Threads page first, so 120 has put its island into the slot.
    if (!frame.visible()) frame.open();
    const slot = frame.slot('main');
    if (!slot) return false;
    if (host.parentNode !== slot) slot.append(host);
    remoteOn = true;
    host.hidden = false;
    slot.classList.add('tnh-on');
    remote().mount(host);
    markRows();
    return true;
  }

  // letGo: the agent is no longer selected either (a thread of this computer was chosen). Without
  // it only the box goes, and the selection stays for when the Threads page comes back.
  function hideRemote(letGo) {
    if (!remoteOn) {
      if (letGo && (remote()?.selected?.() || remote()?.lost?.())) remote().select('');
      return;
    }
    remoteOn = false;
    host.hidden = true;
    threads()?.slot('main')?.classList.remove('tnh-on');
    remote()?.mount(null);
    if (letGo) remote()?.select?.('');
    window.TnaiThreadList?.refresh?.();
  }

  // The thread list marks the open thread of this computer (119). While another computer's agent
  // is the open one, its row carries the mark instead, set again after every draw of the list.
  function markRows() {
    const key = remoteKey();
    const list = threads()?.slot('list');
    if (!key || !list) return;
    list.querySelectorAll('.tnt-th').forEach(row => {
      const want = String(row.dataset.remote === key);
      if (row.getAttribute('aria-selected') !== want) row.setAttribute('aria-selected', want);
    });
  }

  // A press on a row of the thread list, taken before 119's and 118's own handlers. Another
  // computer's agent: it is selected and shown here, and those handlers do not see the press. A
  // thread of this computer: the other computer's agent steps aside, and the press goes on.
  document.addEventListener(
    'click',
    event => {
      const row = event.target.closest?.('.tnt-th');
      if (!row || !threads()?.slot('list')?.contains(row)) return;
      const key = row.dataset.remote || '';
      if (!key) {
        hideRemote(true);
        return;
      }
      if (!remote()?.pick || !remote().mount) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      // False: that computer's rows moved a moment ago, so the row under the pointer may be
      // another agent's by now.
      if (!remote().pick(key)) {
        say('That list just changed. Press the agent again.');
        return;
      }
      past()?.close();
      fade(showRemote);
    },
    true
  );

  // The selection ended somewhere else (the agent's computer left, 116 let it go): the box goes.
  window.addEventListener('tnai:remote-agents-changed', () => {
    if (remoteOn && !remote()?.selected?.() && !remote()?.lost?.()) hideRemote(false);
  });

  // Another thread of this computer became the open one without a press on the list (a new agent
  // was started, a helper's chip was pressed): it is shown. Not when the list only chose another
  // thread because the open one was closed: that is not the user's choice.
  let lastSelected = threads()?.selected?.() || '';
  window.addEventListener('tnai:threads-select', event => {
    const before = lastSelected;
    lastSelected = event.detail?.paneId || '';
    if (!remoteOn) return;
    const sessions = window.TnaiAgents?.sessions?.() || [];
    const beforeIsGone = !!before && !sessions.some(session => session.paneId === before);
    if (!beforeIsGone) hideRemote(true);
  });

  // "Go to this agent" from anywhere (118 `show`) says nothing when that thread is the chosen one
  // already, so it is followed here: a thread that is asked for is the one shown.
  function followShow() {
    const frame = threads();
    if (!frame || frame.show.tnhFollowed) return;
    const show = frame.show;
    frame.show = paneId => {
      const shown = show(paneId);
      if (shown) hideRemote(true);
      return shown;
    };
    frame.show.tnhFollowed = true;
  }

  // Another page: the live view ends (116 `leave`, by itself) and the box is taken out; the
  // selection stays, so the agent is the open one again when the Threads page comes back.
  let wasOn = false;
  window.addEventListener('tnai:threads-hidden', () => {
    wasOn = remoteOn;
    hideRemote(false);
  });
  window.addEventListener('tnai:threads-shown', () => {
    placeButtons();
    if (wasOn && (remote()?.selected?.() || remote()?.lost?.())) showRemote();
    wasOn = false;
  });

  // 120 drew the open thread (and puts its island into the slot the first time): the button and
  // the box are put back where they belong.
  window.addEventListener('tnai:thread-view', () => {
    placeButtons();
    const slot = threads()?.slot('main');
    if (remoteOn && slot && host.parentNode !== slot) slot.append(host);
  });
  window.addEventListener('tnai:threads-built', placeButtons);
  window.addEventListener('tnai:threads-painted', () => {
    placeButtons();
    markRows();
  });

  window.TnaiThreadHistory = {
    open,
    close: () => close(false),
    isOpen,

    // the agent of another computer that fills the thread's main area now, or ''
    remote: remoteKey,
    closeRemote: () => hideRemote(true),
  };
  followShow();
  placeButtons();
})();
