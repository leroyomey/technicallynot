/*
 * Technically Not · 120-thread-view.js — the thread layout's middle island: the open thread.
 * Desktop app only; fills the `main` slot of 118
 * (`window.TnaiThreads`) and does nothing while the thread layout is off or its page is hidden.
 *
 * A thread is its session's real terminal. The view here is one more view of that session, made
 * the way the Overview focus view makes its own (99): its own xterm from TnaiAgents.createTerm(),
 * fed by the session's replay and then its live output, typing sent to the session, and part of
 * the shared sizing in 10 (`ptySize`): while it is the view on screen it sets the session's size,
 * otherwise it follows. It is never a second process, and the Terminal page's own panel is not
 * moved or changed. Views are kept, not rebuilt: the last three stay parked off screen.
 *
 * The prompt box under the thread is the app's own (118 leaves it where 94 puts it); opening a
 * thread aims it at that thread (11 `TnaiLiveTasks.setTarget`). The prompt box grows and shrinks
 * with the draft, and an agent CLI redraws on every resize, so the terminal is resized only once
 * the prompt box has been still for a moment (the rule of the focus view).
 *
 * The top row names the thread: its name, its tool and model, its project and its state in words,
 * all read from the list (119 `TnaiThreadList.thread`). A thread opens as its conversation (drawn
 * by 122 from the tool's own record). The tool's own screen, the CLI screen, is reached only from
 * the row "CLI screen" of the thread's "..." menu (137), whose button is the last of the top row.
 * A tool with no such record has its screen only. Under the terminal is a row for the
 * app's question cards, filled by 121. Look: src/styles/29-thread-view.css.
 * `window.TnaiThreadView` (`shown`, `term`, `mode`, `setMode`) for 137, 122 and the tests.
 */
(() => {
  'use strict';
  const agents = window.TnaiAgents;
  const native = window.tnaiNative;
  const threads = () => window.TnaiThreads;
  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const icon = (name, size) => safe(() => window.TnaiIcon?.(name, { size }), '');
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };

  // ---------- the island's parts ----------
  const root = document.createElement('div');
  root.className = 'tnt-view';
  root.innerHTML =
    '<header class="tnt-head"><div class="tnt-head-text"><div class="tnt-head-line"><h1></h1>' +
    '<button type="button" class="tnt-icon-btn tnt-head-rename" title="Rename this agent" ' +
    'aria-label="Rename this agent">' +
    icon('pencil', 14) +
    '</button>' +
    '<span class="tnt-head-age" hidden></span>' +
    '<span class="tnt-head-topic"></span></div><p><span class="tnt-head-tool"></span>' +
    '<span class="tnt-head-more"></span></p></div><span class="tnt-head-state" data-tone="idle"><i></i>' +
    '<span></span></span><div class="tnt-head-acts">' +
    '<button type="button" class="tnt-icon-btn" data-tnai-font="-1" data-tnai-font-place="focus" ' +
    'title="Smaller text" aria-label="Smaller text">A−</button>' +
    '<button type="button" class="tnt-icon-btn" data-tnai-font="1" data-tnai-font-place="focus" ' +
    'title="Larger text" aria-label="Larger text">A+</button>' +
    '<button type="button" class="tnt-icon-btn tnt-head-handoff" ' +
    'title="Handoff history: every time this agent was retired and a fresh one took over" ' +
    'aria-label="Handoff history">' +
    icon('clock', 16) +
    '</button>' +
    '<button type="button" class="tnt-icon-btn tnt-head-page" ' +
    'title="Show this thread on All threads" aria-label="Show on All threads">' +
    icon('square-terminal', 16) +
    '</button>' +
    '<button type="button" class="tnt-icon-btn tnt-head-menu" aria-haspopup="menu" ' +
    'aria-expanded="false" title="More for this thread" aria-label="More for this thread">' +
    icon('ellipsis', 16) +
    '</button></div></header>' +
    '<div class="tnt-talk" role="log" aria-label="Conversation of this thread" hidden></div>' +
    '<p class="tnt-plain" hidden></p>' +
    '<div class="tnt-term"><div class="tnt-term-box" role="region" aria-label="CLI screen of this thread"></div>' +
    '<div class="tnt-term-note" hidden>Saved screen · press Enter to redraw</div></div>' +
    '<div class="tnt-asks" aria-label="Questions for you"></div>' +
    '<div class="tnt-none"><b>No thread open</b><span>Press New thread to start an agent, or pick a ' +
    'thread from the list.</span></div>';
  const headEl = root.querySelector('.tnt-head');
  const termEl = root.querySelector('.tnt-term');
  const box = root.querySelector('.tnt-term-box');
  const savedNote = root.querySelector('.tnt-term-note');
  const noneEl = root.querySelector('.tnt-none');
  const talkEl = root.querySelector('.tnt-talk');
  const plainEl = root.querySelector('.tnt-plain');
  let pane = '';

  // ---------- the conversation or the CLI screen ----------
  // A thread is shown as its conversation (122 draws it, from the tool's own record) or as the
  // tool's own screen, its real terminal. The conversation is what a thread opens as for a tool
  // whose record this app can read; every other tool, and a plain terminal, has its screen only,
  // and the island says so. Nothing in the top row changes the mode: the row "CLI screen" of the
  // thread's menu (137) does, through setMode.
  const modes = new Map();
  const canRead = tool => safe(() => !!window.TnaiThreadReadable?.can(tool), false);
  const modeOf = (paneId, tool) => (canRead(tool) ? modes.get(paneId) || 'read' : 'term');

  function setMode(mode) {
    if (!pane || (mode !== 'read' && mode !== 'term')) return;
    modes.set(pane, mode);
    show();
  }

  // What is shown under the top row, for the thread's tool and the chosen mode.
  function paintMode(thread) {
    const mode = thread ? modeOf(pane, thread.tool) : '';
    const readable = !!thread && canRead(thread.tool);
    talkEl.hidden = mode !== 'read';
    termEl.hidden = mode !== 'term';

    // the text size buttons belong to the CLI screen: they show only while it does
    headEl.querySelectorAll('[data-tnai-font]').forEach(button => {
      button.hidden = mode !== 'term';
    });

    // said plainly: why this thread has no readable view
    const plain = !!thread && !readable && thread.tool !== 'Terminal';
    plainEl.hidden = !plain;
    if (plain)
      setText(
        plainEl,
        thread.tool +
          ' keeps no record of the conversation that this app can read, so this thread shows its CLI screen.'
      );
    return mode;
  }

  // ---------- the top row ----------
  function paintHead() {
    const thread = pane ? safe(() => window.TnaiThreadList?.thread(pane), null) : null;
    headEl.hidden = !thread;
    noneEl.hidden = !!thread;
    const mode = paintMode(thread);
    if (!thread) return '';
    setText(headEl.querySelector('h1'), thread.name);
    const toolEl = headEl.querySelector('.tnt-head-tool');
    const mark = safe(() => window.TnaiCliIcons?.svg?.(thread.tool), '');
    if (toolEl.dataset.tool !== thread.tool) {
      toolEl.dataset.tool = thread.tool;
      toolEl.innerHTML = mark + '<span></span>';
      toolEl.querySelector('span').textContent = thread.tool;
    }
    const model = safe(() => window.TnaiAgentModel?.text?.(pane), '');
    const more = [model, thread.project?.name].filter(Boolean).join(' · ');
    setText(headEl.querySelector('.tnt-head-more'), more ? ' · ' + more : '');
    const stateEl = headEl.querySelector('.tnt-head-state');
    if (stateEl.dataset.tone !== thread.tone) stateEl.dataset.tone = thread.tone;
    setText(stateEl.querySelector('span'), thread.label || '');
    stateEl.hidden = !thread.label;
    paintAge(headEl.querySelector('.tnt-head-age'), pane);
    return mode;
  }

  // ---------- how long the agent's session has been open ----------
  // A clock beside the name. Its color says when a session has run long: a long
  // session fills the agent's context, and a fresh agent (the "..." menu's Hand off) works better.
  // Under 2 hours quiet, 2 to 4 hours plain, 4 to 6 hours amber, from 6 hours red.
  const HOUR = 60 * 60 * 1000;

  function ageText(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return minutes + 'm';
    const rest = minutes % 60;
    return Math.floor(minutes / 60) + 'h ' + (rest < 10 ? '0' : '') + rest + 'm';
  }

  function ageStep(ms) {
    if (ms >= 6 * HOUR) return 'longest';
    if (ms >= 4 * HOUR) return 'longer';
    if (ms >= 2 * HOUR) return 'long';
    return 'fresh';
  }

  // Paints one clock (the top row's, or an All threads card's, 135) for one thread. Hidden while
  // its session does not run: the clock counts from the moment the session started.
  function paintAge(node, paneId) {
    if (!node) return;
    const session =
      paneId && safe(() => agents.sessions().find(one => one.paneId === paneId), null);
    const startedAt = session?.running ? session.startedAt || 0 : 0;
    node.hidden = !startedAt;
    if (!startedAt) return;
    const ms = Math.max(0, Date.now() - startedAt);
    setText(node, ageText(ms));
    const step = ageStep(ms);
    if (node.dataset.age !== step) node.dataset.age = step;
    const title =
      'This agent session has been open for ' +
      ageText(ms).replace('h', ' h').replace(/m$/, ' min') +
      (step === 'fresh'
        ? ''
        : '. A long session fills its context: Hand off in "..." starts a fresh agent.');
    if (node.title !== title) node.title = title;
  }

  // The clocks move once a minute (every 30 s, so a new minute shows within half a minute), and
  // not while the window is hidden. 135 paints its cards' clocks on the same tick.
  setInterval(() => {
    if (document.hidden) return;
    if (pane) paintAge(headEl.querySelector('.tnt-head-age'), pane);
    window.dispatchEvent(new CustomEvent('tnai:thread-age-tick'));
  }, 30000);

  // The pencil beside the name: the name becomes a field where it stands (137's Rename). The new
  // name is saved by the panel's own rename, so the list, the cards and the agents follow it.
  headEl.querySelector('.tnt-head-rename').addEventListener('click', () => {
    if (pane) window.TnaiThreadMore?.rename?.(pane);
  });

  headEl.querySelector('.tnt-head-page').addEventListener('click', () => {
    if (pane) window.TnaiLiveTasks?.focusPane?.(pane, true);
  });

  // Handoff history (102), opened at this thread's own chain of handoffs. It was a button of the
  // old Overview; a thread's top row is where the actions of one agent stand now.
  headEl.querySelector('.tnt-head-handoff').addEventListener('click', () => {
    window.TnaiHandoffHistory?.open?.(pane || '');
  });

  // ---------- the terminal: one more view of the session (as 99 and 25 make theirs) ----------
  const KEEP = 3;
  const FLUSH_HIDDEN = 128 * 1024;

  // How long a terminal that comes on screen is kept unseen while it settles. It was 250 ms; the
  // user felt that as lag when changing threads (2026-10-12).
  const VEIL_MS = 120;
  const VEIL_MAX_MS = 2000;
  const STILL_MS = 1200;

  // paneId -> view, least recently shown first
  const views = new Map();
  const parked = document.createElement('div');
  parked.className = 'ap-term-parked';
  parked.setAttribute('aria-hidden', 'true');
  let view = null;

  const isReport = data =>
    agents?.isReport
      ? agents.isReport(data)
      : /^(\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3})+$/.test(data);
  const running = () =>
    !!view && agents.sessions().some(session => session.paneId === view.paneId && session.running);
  const fontSize = term =>
    agents.compactFontFor ? agents.compactFontFor('focus') : term.options.fontSize;

  // The terminal is drawn on the island itself, so its background is the island's color.
  function termTheme() {
    const island = getComputedStyle(root).getPropertyValue('--tnt-island').trim();
    const base = agents.xtermTheme?.() || {};
    return island ? { ...base, background: island } : base;
  }

  // Keeping the newest line in sight. xterm's own scrollToBottom does nothing right after a
  // resize, so it is asked again on the next frames.
  const pin = new WeakMap();

  function toBottom(term, frames = 12) {
    const holding = pin.get(term) > 0;
    pin.set(term, frames);
    if (holding) return;
    const step = () => {
      const left = pin.get(term) || 0;
      if (!(left > 0)) return;
      const buffer = term.buffer.active;
      if (term.element?.isConnected && buffer.viewportY < buffer.baseY) {
        try {
          term._core?._viewport?.queueSync?.();
        } catch {}
        term.scrollToBottom();
      }
      pin.set(term, left - 1);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function keepBottom(term, resize) {
    const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
    resize();
    if (atBottom) toBottom(term);
  }

  // the user scrolled up: stop pulling the view down
  box.addEventListener(
    'wheel',
    () => {
      if (view?.term) pin.set(view.term, 0);
    },
    { capture: true, passive: true }
  );

  // Another view sets the session's size: take its columns and rows.
  function follow() {
    const term = view?.term;
    const now = term && agents.ptySize?.get?.(view.paneId);
    if (term && now && view.host.offsetParent && agents.ptySize.followFont) {
      const before = term.options.fontSize;
      agents.ptySize.followFont(term, view.fit, fontSize(term), now.cols, now.rows, true);
      if (term.options.fontSize !== before) toBottom(term);
    }
    if (term && now && (now.cols !== term.cols || now.rows !== term.rows))
      keepBottom(term, () => term.resize(now.cols, now.rows));
  }

  // A stopped session's saved screen. The CLI broke its lines itself for the width it last ran
  // at, so stretched to a wide box its text sat in the left third beside an empty field (and as
  // a narrow column in the middle it left two empty fields, which the user turned down). 132
  // reads that screen once and writes it again for the width of this box, with the lines the
  // CLI broke put back together; a line under the terminal says it is a saved screen. True
  // means the saved screen was placed and nothing else is to fit.
  function showSaved(current, font) {
    const term = current.term;
    const runs = running();
    if (runs) current.saved = null;
    const keep = !!current.saved && !runs;
    savedNote.hidden = !keep;
    if (keep) current.host.dataset.saved = '1';
    else delete current.host.dataset.saved;
    if (!keep) return false;
    if (term.options.fontSize !== font) term.options.fontSize = font;
    let room = null;
    try {
      room = current.fit.proposeDimensions();
    } catch {}
    if (!(room?.cols > 0 && room?.rows > 0)) return true;
    if (term.cols !== room.cols || term.rows !== room.rows) term.resize(room.cols, room.rows);

    // written again only when the width changed: a taller or lower box keeps what is drawn
    if (current.saved.drawnAt !== room.cols) {
      current.saved.drawnAt = room.cols;
      window.TnaiSavedReflow.draw(term, current.saved.screen).then(() => {
        // the report's colors (75) at once, not 150 ms later
        window.TnaiReportHighlight?.scanNow?.(term);
        if (view === current) toBottom(term);
      });
    } else toBottom(term);
    return true;
  }

  // Fits the terminal to its box. claim: this view sets the session's size (it was shown, resized,
  // focused or typed in); otherwise it offers its size and follows when another view has it.
  function fit(claim) {
    const current = view;
    const term = current?.term;
    if (!term || current.restoring || !current.host.offsetParent) return;

    // A question card takes room under the terminal for a moment. Resizing for it would make the
    // CLI redraw twice, in the middle of its own question, and leave empty rows under its input
    // box afterwards (seen with a real Claude Code, 2026-10-11). So a view that has its size keeps
    // its rows and is only moved up, so the newest rows stay in sight.
    if (current.fitted && asksEl.offsetHeight) {
      lift(current);
      return;
    }
    current.fitted = true;
    const font = fontSize(term);
    const size = agents.ptySize;
    promptHeight = readPromptHeight();
    lift(current, true);
    delete current.host.dataset.wait;
    if (showSaved(current, font)) return;
    if (size?.mayDrive && running() && !size.mayDrive(current.paneId, current.owner)) {
      if (term.options.fontSize !== font) term.options.fontSize = font;
      follow();
      return;
    }
    keepBottom(term, () => {
      if (term.options.fontSize !== font) term.options.fontSize = font;
      try {
        current.fit.fit();
      } catch {}
    });
    if (size && running()) {
      if (claim) size.claim(current.paneId, current.owner, term.cols, term.rows);
      else if (!size.offer(current.paneId, current.owner, term.cols, term.rows)) follow();
    }
  }

  // ---------- the prompt box under the terminal grows: wait until it is still ----------
  const promptEl = document.querySelector('footer.composer');
  const asksEl = root.querySelector('.tnt-asks');

  // The row of question cards (121) sits between the terminal and the prompt box. While it has
  // a card the terminal is not resized at all (see fit).
  const readPromptHeight = () => promptEl?.offsetHeight || 0;
  let promptHeight = readPromptHeight();
  let waitHeight = 0;
  let stillTimer = 0;

  function boxResized(current) {
    if (view !== current) return;
    if (current.fitted && asksEl.offsetHeight) {
      lift(current);
      return;
    }
    const height = readPromptHeight();

    // A change of width is never the prompt box growing under typing: the window, the list or
    // the side column moved. It is fitted at once, also when the narrower box wrapped the prompt
    // box's own text and so changed its height (the terminal stood 1.2 s behind a dragged side
    // column, its rows cut at the edge and moved up).
    const width = current.host.clientWidth;
    const widthChanged = current.boxWidth !== undefined && current.boxWidth !== width;
    current.boxWidth = width;
    if (widthChanged) {
      clearTimeout(stillTimer);
      stillTimer = 0;
      fit(true);
      return;
    }

    // the box changed and the prompt box did not: fit at once
    if (height === promptHeight && !stillTimer) {
      fit(true);
      return;
    }
    lift(current);

    // the same prompt box height again: the wait runs on
    if (stillTimer && height === waitHeight) return;
    hold(current, height);
  }

  // The prompt box is read again when the wait ends, because its resize note can come late in a
  // window that is not in front; changed means the wait goes on.
  function hold(current, height) {
    waitHeight = height;
    clearTimeout(stillTimer);
    current.host.dataset.wait = '1';
    stillTimer = setTimeout(() => {
      stillTimer = 0;
      if (view !== current) {
        delete current.host.dataset.wait;
        lift(current, true);
        return;
      }
      if (readPromptHeight() !== waitHeight) {
        lift(current);
        hold(current, readPromptHeight());
        return;
      }
      fit(true);
    }, STILL_MS);
  }

  // While it waits, a terminal taller than its box is moved up by what does not fit, so the rows
  // that are cut are the oldest, at the top.
  function lift(current, off) {
    const screen = current.host.querySelector('.xterm-screen');
    if (!screen) return;
    screen.style.transform = '';
    if (off) return;
    const over =
      Math.ceil(
        screen.getBoundingClientRect().bottom - current.host.getBoundingClientRect().bottom
      ) + 4;
    if (over > 4) screen.style.transform = 'translateY(-' + over + 'px)';
  }

  // ---------- keeping, hiding and catching up ----------
  function drop(current) {
    current.dead = true;
    clearTimeout(current.veilTimer);
    current.unwatch?.();
    current.term?.dispose();
    current.host.remove();
    if (views.get(current.paneId) === current) views.delete(current.paneId);
    if (view === current) view = null;
  }

  // Output that arrived while the view was parked, written in order.
  function drain(current) {
    if (current.draining || !current.pending || current.dead)
      return current.draining || Promise.resolve();
    const chunk = current.pending;
    current.pending = '';
    current.draining = current.write(chunk).then(() => {
      current.draining = null;
    });
    return current.draining;
  }

  // A view that comes back paints its older text first; it stays unseen until it has drawn its
  // newest lines.
  function veil(current, ms = VEIL_MS) {
    current.veiled = true;
    current.host.style.visibility = 'hidden';
    current.term.refresh(0, current.term.rows - 1);
    veilFor(current, ms);
  }

  function veilFor(current, ms) {
    if (!current.veiled) return;
    clearTimeout(current.veilTimer);
    current.veilTimer = setTimeout(() => unveil(current), ms);
  }

  function unveil(current) {
    if (!current.veiled) return;
    current.veiled = false;
    clearTimeout(current.veilTimer);
    current.host.style.visibility = '';
  }

  function goLive(current) {
    current.restoring = false;
    veilFor(current, VEIL_MS);
    if (!current.pending) return;
    const rest = current.pending;
    current.pending = '';
    current.term.write(rest);
  }

  function park() {
    const current = view;
    if (!current) return;
    view = null;
    savedNote.hidden = true;
    unveil(current);
    if (!current.ready) {
      drop(current);
      return;
    }

    // Where the user was reading when the screen went out of sight: 0 at the newest line, else
    // the line at the top of the view. reshow brings it back there unless output came meanwhile.
    const lines = current.term.buffer.active;
    current.leftAt = lines.viewportY < lines.baseY ? lines.viewportY : 0;
    current.leftUp = lines.viewportY < lines.baseY;
    current.newWhileAway = false;
    if (!parked.isConnected) document.body.append(parked);
    parked.append(current.host);
    for (const [, old] of views) {
      if (views.size <= KEEP) break;
      drop(old);
    }
  }

  // A screen that comes back. It comes back where the user left it: at the newest line when they
  // were there, and at the line they had scrolled up to when they were reading older output and
  // nothing new was printed while it was away. With new output it comes back at the newest line,
  // since that is what the user came to see (before, it always came back at the newest line and
  // a place being read was lost by a look at another thread).
  async function reshow(current) {
    view = current;
    box.replaceChildren(current.host);
    veil(current);
    const stay = current.leftUp && !current.newWhileAway && !current.pending && !current.draining;
    if (!stay) toBottom(current.term);
    if (current.restoring || current.pending || current.draining) veilFor(current, VEIL_MAX_MS);
    if (current.restoring || (!current.pending && !current.draining)) {
      fit(true);
      if (stay) backToPlace(current);
      return;
    }
    current.restoring = true;
    await current.draining;
    await drain(current);
    if (current.dead) return;
    if (current !== view) {
      current.restoring = false;
      return;
    }
    goLive(current);
    fit(true);
    toBottom(current.term);
  }

  // Puts a screen back at the line the user was reading, and stops anything from pulling it down.
  // Moving the terminal between boxes, or fitting it, can leave its view somewhere else.
  function backToPlace(current) {
    const term = current.term;
    pin.set(term, 0);
    const lines = term.buffer.active;
    const top = Math.min(current.leftAt, lines.baseY);
    if (lines.viewportY !== top) term.scrollToLine(top);
  }

  async function make(current) {
    const made = await agents.createTerm();
    if (current.dead) {
      made.term.dispose();
      return;
    }
    const { paneId, host } = current;
    const term = (current.term = made.term);
    term.tnaiPaneId = paneId;
    term.options.theme = termTheme();
    term.options.minimumContrastRatio = agents.contrastFor?.(paneId) || 4.5;
    current.fit = made.fit;
    current.write = made.replay;
    term.onData(data => {
      if (view !== current) return;

      // a stopped session: Enter starts it again with the typed text (10)
      if (!agents.sessions().some(session => session.paneId === paneId && session.running)) {
        agents.stoppedInput?.(paneId, data, term);
        return;
      }
      if (agents.ptySize?.driver?.(paneId) !== current.owner && !isReport(data)) fit(true);
      agents.noteReport?.(paneId, data);
      native.pty.write(paneId, data);
    });
    term.open(host);
    term.onRender(() => {
      const buffer = term.buffer.active;
      if (current.veiled && current.ready && !current.restoring && buffer.viewportY >= buffer.baseY)
        unveil(current);
    });
    veil(current, VEIL_MAX_MS);
    term.textarea?.addEventListener('focus', () => {
      if (view === current) fit(true);
    });
    current.unwatch = agents.watchFit?.(host, () => boxResized(current)) || null;
    if (view === current) fit(false);
    const replay = await native.pty.replay(paneId).catch(() => null);
    if (current.dead) return;
    current.ready = true;
    current.restoring = true;
    await current.write(replay?.buffer);
    if (current.dead) return;

    // the replay leaves the terminal at the width the session last ran at: read there (132)
    const screen = replay?.running ? null : window.TnaiSavedReflow?.read(term);
    if (screen) current.saved = { screen, drawnAt: 0 };
    if (current !== view) {
      current.restoring = false;
      return;
    }
    goLive(current);
    toBottom(term);
    fit(true);
    if (replay?.running) agents.ptySize?.repaint(paneId, term);
  }

  function showTerm(paneId) {
    if (!native?.pty || !agents?.createTerm) return;
    if ((view?.paneId || '') === paneId && view.host.parentNode === box) return;
    park();
    const kept = views.get(paneId);
    if (kept) {
      // moved to the end: the most recently shown
      views.delete(paneId);
      views.set(paneId, kept);
      reshow(kept);
      return;
    }
    const current = {
      paneId,
      term: null,
      fit: null,
      write: null,
      host: document.createElement('div'),
      owner: null,
      unwatch: null,
      ready: false,
      dead: false,
      pending: '',
      draining: null,
      restoring: false,
      veiled: false,
      veilTimer: 0,
      wasRunning: false,
      fitted: false,
      leftUp: false,
      leftAt: 0,
      newWhileAway: false,
    };
    current.host.className = 'tnt-term-host';
    current.owner = { visible: () => view === current && !!current.host.offsetParent };
    views.set(paneId, current);
    view = current;
    box.replaceChildren(current.host);
    make(current);
  }

  // ---------- live output and the app's own events (listening only while the layout is on)
  // ----------
  function onPtyData({ paneId, data }) {
    const current = views.get(paneId);
    if (!current?.ready || current.dead) return;
    if (current === view && !current.restoring) {
      current.term.write(data);
      return;
    }
    current.pending += data;

    // printed while the screen was out of sight: it comes back at the newest line (reshow)
    if (current !== view) current.newWhileAway = true;
    if (current !== view && !current.restoring && current.pending.length > FLUSH_HIDDEN)
      drain(current);
  }

  // A stopped session starts again: the old screen scrolls up out of the way first, as in its own
  // panel (10 startClear), in order with the output.
  function onPtyStarting(event) {
    const current = views.get(event.detail?.paneId);
    if (!current?.ready || current.dead || !agents?.startClear) return;
    if (current === view && !current.restoring) current.term.write(agents.startClear(current.term));
    else {
      current.pending += agents.startClear(current.term, true);
      if (current !== view) current.newWhileAway = true;
    }
  }

  function onPtySize(event) {
    const detail = event.detail || {};
    if (view?.term && detail.paneId === view.paneId && detail.owner !== view.owner) fit(false);
  }

  // Started, or restored as running, while shown: size the session to this view now (no size note
  // comes for a panel restored hidden).
  //
  // Stopped while its terminal is kept here (shown, or put aside for another thread): what the
  // terminal holds now is the session's saved screen, at the width it is drawn at. It is read
  // once what was still on its way has been written, so the line under the terminal says "Saved
  // screen" as it does for a thread opened after the stop (it said nothing, and a later change
  // of width had no saved screen to write again).
  function onSessions() {
    const sessions = agents.sessions();
    views.forEach(current => {
      if (!current.term || current.dead) return;
      const runs = sessions.some(session => session.paneId === current.paneId && session.running);
      if (runs === current.wasRunning) return;
      current.wasRunning = runs;
      if (runs) {
        if (current === view) fit(true);
        return;
      }
      current.term.write('', () => {
        if (current.dead || current.wasRunning) return;
        const screen = window.TnaiSavedReflow?.read(current.term);
        if (screen) current.saved = { screen, drawnAt: current.term.cols };
        if (current === view) fit(false);
      });
    });
  }

  function onTheme() {
    views.forEach(current => {
      if (!current.term) return;
      current.term.options.theme = termTheme();
      current.term.options.minimumContrastRatio = agents.contrastFor?.(current.paneId) || 4.5;
    });
  }

  function onFont(event) {
    const place = event.detail?.place;
    if (!place || place === 'focus') fit(true);
  }

  function onPanelClosed(event) {
    const current = views.get(event.detail?.paneId);
    if (current) drop(current);
    if (event.detail?.paneId === pane) show();
  }

  // ---------- showing the open thread ----------
  function show() {
    const frame = threads();
    const slot = frame?.slot('main');
    if (!slot || !frame.visible()) return;
    if (root.parentNode !== slot) {
      slot.replaceChildren(root);
      agents?.paintFonts?.();
    }
    const want = frame.selected() || '';
    const live =
      want && safe(() => agents.sessions().some(session => session.paneId === want), false);
    pane = live ? want : '';
    const mode = paintHead();
    if (pane) window.TnaiLiveTasks?.setTarget?.(pane);

    // the terminal view exists only while the terminal is what is shown
    if (pane && mode === 'term') showTerm(pane);
    else park();
    window.dispatchEvent(
      new CustomEvent('tnai:thread-view', { detail: { paneId: pane, mode, host: talkEl } })
    );
  }

  // The list was redrawn: sessions may have come or gone. After a restart the picked thread is
  // remembered before its session is restored, so the view opens it once the session is there
  // (found with a real restored session, 2026-10-11); otherwise only the top row is repainted.
  function onListPainted() {
    const want = threads()?.selected() || '';
    if (want !== pane) show();
    else paintHead();
  }

  let stops = [];

  function start() {
    if (!stops.length && agents && native?.pty) {
      const listen = (name, handler) => {
        window.addEventListener(name, handler);
        stops.push(() => window.removeEventListener(name, handler));
      };
      listen('tnai:pty-starting', onPtyStarting);
      listen('tnai:pty-size', onPtySize);
      listen('tnai:theme-changed', onTheme);
      listen('tnai:terminal-font', onFont);
      listen('tnai:terminal-pane-closed', onPanelClosed);
      listen('tnai:threads-select', show);
      listen('tnai:threads-painted', onListPainted);
      const offData = native.pty.onData(onPtyData);
      if (typeof offData === 'function') stops.push(offData);
      const offSessions = agents.onChange?.(onSessions);
      if (typeof offSessions === 'function') stops.push(offSessions);
      stops.push(() => {});
    }
    show();
  }

  function hidden() {
    park();
  }

  function removed() {
    park();
    [...views.values()].forEach(drop);
    stops.forEach(off => safe(off, null));
    stops = [];
    clearTimeout(stillTimer);
    stillTimer = 0;
    pane = '';
    parked.remove();
  }
  window.addEventListener('tnai:threads-shown', start);
  window.addEventListener('tnai:threads-hidden', hidden);
  window.addEventListener('tnai:threads-removed', removed);

  window.TnaiThreadView = {
    shown: () => pane,
    term: () => view?.term || null,
    mode: () => (pane ? modes.get(pane) || (talkEl.hidden ? 'term' : 'read') : ''),
    setMode,

    // the session clock beside a name, for an All threads card (135)
    paintAge,
  };
  if (safe(() => threads()?.visible(), false)) start();
})();
