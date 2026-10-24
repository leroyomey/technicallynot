/*
 * Technically Not · 162-thread-popout.js — Desktop only: a thread popped out of the app into a
 * window of its own, still worked in: its conversation, its questions and decisions, and a prompt
 * box that always sends to that thread (user, 2026-10-21: "Yes, build it as shown",
 * docs/plans/design-concepts/thread-popout.html).
 *
 * Ways out: "Pop out into its own window" in the thread's "..." menu (137), or the thread dragged
 * from the list out of the app's window. Ways back: "Back into the app" in the window or the menu,
 * or closing the window. Several threads can be out at once, each on any monitor; each window
 * remembers where it was.
 *
 * Built from the app's own parts: the window is the pop-out of 93 (`TnaiPopout`: a same-origin
 * window, the app's style sheets copied in, its window buttons, its place kept); the conversation
 * is 122's (`TnaiThreadReadable.mount`), the questions 121's (`TnaiThreadAsks.mount`), and the
 * prompt box sends through the composer's own path (11 `sendFrom`), so a prompt from a window is
 * routed, held and marked exactly like one from the main box. A conversation lives in one place at
 * a time: while a thread is out, the app and its All threads card say where it is (122 asks
 * `elsewhere` and draws `placeholder`), and show it again when it comes back (122 `retry`).
 *
 * `window.TnaiThreadPopout` (`can`, `open`, `back`, `isOut`, `focus`, `elsewhere`, `placeholder`).
 * Look: `src/styles/48-thread-popout.css`. Test: desktop `thread-popout`.
 */
(() => {
  'use strict';
  const native = window.tnaiNative;

  // paneId -> { id, win, node, head, talk, asks, input, onTop }
  const outs = new Map();

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const icon = (name, size = 16) => safe(() => window.TnaiIcon(name, { size }), '') || '';
  const threadOf = paneId => safe(() => window.TnaiThreadList?.thread?.(paneId), null);
  const popout = () => window.TnaiPopout;
  const readable = () => window.TnaiThreadReadable;
  const asks = () => window.TnaiThreadAsks;

  // The pop-out's window id (93 names the window tnai-panel-<id>).
  const idOf = paneId => 'thread-' + String(paneId).replace(/[^\w-]/g, '_');

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  // A thread that can have a window of its own: a live thread of this computer whose
  // conversation the app can read (a plain terminal thread lives on its CLI screen).
  // Read from the live sessions (one lookup), not the thread list's own reading: that builds every
  // thread's line, and this runs on each repaint (learned 2026-10-21, perf-page-switch).
  function can(paneId) {
    if (!paneId || !popout()?.available?.()) return false;
    const session = safe(
      () => window.TnaiAgents?.sessions?.().find(one => one.paneId === paneId),
      null
    );
    return !!session && !!safe(() => readable()?.can?.(session.agent), false);
  }

  // ---------- the window ----------
  function build(paneId, thread) {
    const node = make('div', 'tpo');
    const head = make('header', 'tpo-head');
    const dot = make('i', 'tpo-dot');
    const name = make('b', 'tpo-name', thread.name);
    const state = make('span', 'tpo-state');
    const grow = make('span', 'tpo-grow');
    const onTop = make('button', 'tpo-top');
    onTop.type = 'button';
    onTop.title = 'Keep this window on top of other windows';
    onTop.setAttribute('aria-label', onTop.title);
    onTop.setAttribute('aria-pressed', 'false');
    onTop.innerHTML = icon('chevrons-up', 15);
    const backButton = make('button', 'tpo-back', 'Back into the app');
    backButton.type = 'button';
    head.append(dot, name, state, grow, onTop, backButton);

    const talk = make('div', 'tnt-talk tpo-talk');
    talk.setAttribute('role', 'log');
    talk.setAttribute('aria-label', 'Conversation of ' + thread.name);
    const asksHost = make('div', 'tnt-asks tpo-asks');
    asksHost.hidden = true;

    const compose = make('div', 'tpo-compose');
    const input = make('textarea', 'tpo-input');
    input.rows = 1;
    input.placeholder = 'Message ' + thread.name + '…';
    const to = make('small', 'tpo-to', '→ ' + thread.name);
    const send = make('button', 'tpo-send');
    send.type = 'button';
    send.title = 'Send to ' + thread.name;
    send.setAttribute('aria-label', send.title);
    send.innerHTML = icon('arrow-right', 16);
    compose.append(input, to, send);

    node.append(head, talk, asksHost, compose);
    node.dataset.pane = paneId;
    return {
      node,
      head,
      dot,
      name,
      state,
      onTop,
      backButton,
      talk,
      asks: asksHost,
      input,
      send,
      to,
    };
  }

  // The prompt box grows with what is typed, up to a few lines.
  function fit(input) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  }

  async function sendNow(paneId) {
    const out = outs.get(paneId);
    if (!out || !out.input.value.trim()) return;
    const sent = await safe(
      () => window.TnaiLiveTasks?.sendFrom?.(out.input, paneId),
      Promise.resolve(false)
    );
    fit(out.input);
    if (sent) out.input.focus();
  }

  function open(paneId, at) {
    if (outs.has(paneId)) return focus(paneId);
    if (!can(paneId)) return false;
    const thread = threadOf(paneId);
    const id = idOf(paneId);

    // Dragged out of the list: the window opens where it was dropped (93 reads its kept place).
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y))
      safe(() => {
        const key = 'tnai.popout.' + id + '.v1';
        const kept = JSON.parse(localStorage.getItem(key) || '{}') || {};
        localStorage.setItem(key, JSON.stringify({ ...kept, x: at.x - 60, y: at.y - 20 }));
      }, null);

    const parts = build(paneId, thread);
    const out = { id, ...parts, win: null };

    // registered first, so 122 lets this window's host have the conversation
    outs.set(paneId, out);
    const win = popout().open(id, parts.node, {
      title: thread.name,
      head: parts.head,
      width: 520,
      height: 720,
      onBack: () => cleanup(paneId),
    });
    if (!win) {
      outs.delete(paneId);
      return false;
    }
    out.win = win;

    // the thread look's own marks on the window's page (93 copies the theme and the accent)
    safe(() => {
      for (const name of document.documentElement.classList)
        win.document.documentElement.classList.add(name);
      win.document.body.classList.add('tpo-page');
    }, null);

    parts.backButton.addEventListener('click', () => back(paneId));
    parts.onTop.addEventListener('click', () => {
      const on = parts.onTop.getAttribute('aria-pressed') !== 'true';
      parts.onTop.setAttribute('aria-pressed', String(on));
      safe(() => native?.panels?.setOnTop?.('tnai-panel-' + id, on), null);
    });
    parts.send.addEventListener('click', () => sendNow(paneId));
    parts.input.addEventListener('input', () => fit(parts.input));
    parts.input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendNow(paneId);
      }
    });

    // A press in the window (a decision, a report's button) answers this thread; the paths it
    // goes through point the main prompt box at the thread they answer (49 `decideInThread`). The
    // main box keeps its own thread: whatever it was before the press, it is again right after.
    const keepMainTarget = () => {
      const before = safe(() => window.TnaiLiveTasks?.target?.(), null);
      setTimeout(() => {
        const now = safe(() => window.TnaiLiveTasks?.target?.(), null);
        if (now !== before) safe(() => window.TnaiLiveTasks?.setTarget?.(before), null);
      }, 0);
    };
    parts.talk.addEventListener('click', keepMainTarget, true);
    parts.asks.addEventListener('click', keepMainTarget, true);

    safe(() => readable()?.mount?.(parts.talk, paneId), null);
    parts.asks.hidden = !safe(() => asks()?.mount?.(parts.asks, paneId), false);
    paintOne(paneId);
    paintAll();
    setTimeout(() => parts.input.focus(), 0);
    return true;
  }

  // The window closed (by its own buttons, "Back into the app", or the app reloading): the
  // conversation and the questions are let go, and every place that asked for them shows them.
  function cleanup(paneId) {
    const out = outs.get(paneId);
    if (!out) return;
    outs.delete(paneId);
    safe(() => readable()?.unmount?.(out.talk), null);
    safe(() => asks()?.unmount?.(out.asks), null);
    out.node.remove();
    safe(() => readable()?.retry?.(paneId), null);
    paintAll();
  }

  function back(paneId) {
    const out = outs.get(paneId);
    if (!out) return false;
    if (!popout()?.back?.(out.id)) cleanup(paneId);
    return true;
  }

  function focus(paneId) {
    const win = outs.get(paneId)?.win;
    if (!win || win.closed) return false;
    win.focus();
    return true;
  }

  // ---------- what the window shows, kept current ----------
  function paintOne(paneId) {
    const out = outs.get(paneId);
    const thread = threadOf(paneId);
    if (!out) return;

    // the thread was closed: its window goes too
    if (!thread) {
      back(paneId);
      return;
    }
    out.dot.dataset.tone = thread.tone || 'idle';
    if (out.name.textContent !== thread.name) {
      out.name.textContent = thread.name;
      out.input.placeholder = 'Message ' + thread.name + '…';
      out.to.textContent = '→ ' + thread.name;
      safe(() => (out.win.document.title = thread.name + ' · Technically Not'), null);
    }
    const line = [thread.tool, thread.label].filter(Boolean).join(' · ');
    if (out.state.textContent !== line) out.state.textContent = line;
  }

  // ---------- in the app: the list and the place it left ----------
  // (The pop-out icon of the top row went into the thread's "..." menu, which already had the
  // row: user 2026-10-24, tab 5 of app-polish.html.)

  // The thread list: a popped-out thread is marked, a press brings its window to the front, and a
  // thread can be dragged out of the app to pop it out.
  function paintList() {
    document.querySelectorAll('.tnt-list .tnt-th[data-pane]:not(.tnt-sub)').forEach(row => {
      if (!row.dataset.remote && !row.draggable) row.draggable = true;
      const isOut = outs.has(row.dataset.pane);
      if (row.classList.contains('tnt-th-is-out') !== isOut)
        row.classList.toggle('tnt-th-is-out', isOut);
      let mark = row.querySelector(':scope > .tnt-th-out');
      if (isOut && !mark) {
        mark = make('i', 'tnt-th-out');
        mark.title = 'In its own window';
        mark.innerHTML = icon('external-link', 13);
        row.append(mark);
      } else if (!isOut && mark) mark.remove();
    });
  }

  function paintAll() {
    for (const paneId of [...outs.keys()]) paintOne(paneId);
    paintList();
  }

  // How far past the window's edge a dragged thread must be let go to pop out.
  const POP_MARGIN = 40;

  function droppedOutside(event, margin = POP_MARGIN) {
    return (
      event.screenX < window.screenX - margin ||
      event.screenX > window.screenX + window.outerWidth + margin ||
      event.screenY < window.screenY - margin ||
      event.screenY > window.screenY + window.outerHeight + margin
    );
  }

  let dragged = '';
  document.addEventListener('dragstart', event => {
    const row = event.target?.closest?.('.tnt-list .tnt-th[data-pane]');
    dragged = row && !row.dataset.remote ? row.dataset.pane : '';
    if (dragged) {
      event.dataTransfer.setData('text/plain', row.querySelector('b')?.textContent || '');
      event.dataTransfer.effectAllowed = 'move';
    }
  });
  document.addEventListener('dragend', event => {
    const paneId = dragged;
    dragged = '';
    if (!paneId) return;

    // Dropped clearly outside the app's window: it becomes a window there. A drop on or just
    // past the edge (a slipped click) opens nothing.
    if (droppedOutside(event)) open(paneId, { x: event.screenX, y: event.screenY });
  });
  document.addEventListener(
    'click',
    event => {
      const row = event.target?.closest?.('.tnt-list .tnt-th[data-pane]');
      if (row && outs.has(row.dataset.pane)) focus(row.dataset.pane);
    },
    true
  );

  // Where a popped-out thread's conversation would be (the open thread, an All threads card).
  function elsewhere(paneId, host) {
    const out = outs.get(paneId);
    return !!out && host !== out.talk;
  }

  function placeholder(host, paneId) {
    const thread = threadOf(paneId);
    const box = make('div', 'tpo-away');
    box.append(
      make('b', '', (thread?.name || 'This thread') + ' is in its own window'),
      make('span', '', 'Everything you do there reaches the same agent; the list keeps its status.')
    );
    const row = make('div', 'tpo-away-acts');
    const show = make('button', 'tpo-back', 'Show its window');
    show.type = 'button';
    show.addEventListener('click', () => focus(paneId));
    const home = make('button', 'tpo-back', 'Back into the app');
    home.type = 'button';
    home.addEventListener('click', () => back(paneId));
    row.append(show, home);
    box.append(row);
    host.replaceChildren(box);
  }

  window.addEventListener('tnai:threads-painted', paintAll);

  window.TnaiThreadPopout = {
    can,
    open,
    back,
    focus,
    isOut: paneId => outs.has(paneId),
    isHost: host => [...outs.values()].some(out => out.talk === host),
    elsewhere,
    placeholder,
    droppedOutside,
    list: () => [...outs.keys()],
  };
})();
