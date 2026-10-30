// Technically Not · 10-live-terminals.js — Desktop app only: each terminal pane runs its chosen
// agent CLI or shell as a real process (xterm.js + node-pty), with sign-in, status, restart, replay
// after reload, and resume of sessions saved before a close or crash. Exposes window.TnaiAgents
// (sessions, send, restart, open).
(() => {
  const native = window.tnaiNative;

  // A− / A+ size live terminals only; the browser build has none.
  if (!native) {
    ['fontDown', 'fontUp'].forEach(id => {
      const b = document.getElementById(id);
      if (b) {
        b.disabled = true;
        b.title = 'Terminal text size needs the Technically Not desktop app';
      }
    });
    return;
  }

  // paneId -> session view { pane, agent, term, fit, host, running, mode, exitCode, lastOutputAt,
  // startedAt, error, pid, accountId, sessionId, resumable, title, saved }
  const live = new Map();
  const closedPanes = new Set(); // paneIds whose panel was closed (ids are never reused)

  // paneId -> latest mount() call; an older one (superseded, or its pane closed) stops at its next
  // await
  const mounts = new Map();
  let pendingOpen = null; // TnaiAgents.open() request waiting for its new pane to mount

  // paneId -> TnaiAgents.openIn() request for that exact pane (43: sub-agent panes)
  const pendingByPane = new Map();
  let detected = new Map(); // agent id -> detect result from the desktop process
  let detectedAt = 0,
    detecting = null;
  const listeners = new Set();

  // what xterm sends for mouse events while a program asks for them (SGR or X10)
  const MOUSE_REPORT = /^(\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[M[\s\S]{3})+$/;

  // One dispatch builds sessions() once: its ~38 listeners each ask per panel or chip, and every
  // build runs status() for every session. The list is kept only while listeners run and dropped by
  // anything that changes it (a notify, a queued one, a view added or removed).
  let dispatching = 0,
    sessionsCache = null;
  const notify = () => {
    sessionsCache = null;
    dispatching++;
    try {
      listeners.forEach(fn => {
        try {
          fn();
        } catch {}
      });
    } finally {
      if (!--dispatching) sessionsCache = null;
    }
  };

  // Hot paths (status flips per output chunk, the 1 s status tick, title changes) merge into one
  // notify per 50 ms: with many busy agents they fired every onChange listener (Overview, meters,
  // routing, activity…) several times a second, a cause of lag spikes.
  let notifyQueued = 0;
  const notifySoon = () => {
    sessionsCache = null;
    if (!notifyQueued)
      notifyQueued = setTimeout(() => {
        notifyQueued = 0;
        notify();
      }, 50);
  };

  const style = document.createElement('style');
  style.textContent = `
.terminal-pane.tnai-live{grid-template-rows:38px minmax(0,1fr)!important}
.terminal-pane.tnai-live>.terminal-output,.terminal-pane.tnai-live>.terminal-input,.terminal-pane.tnai-live .terminal-start-state{display:none!important}
.tnai-xterm{box-sizing:content-box;min-width:0;min-height:0;overflow:hidden;padding:6px 4px 4px 10px;background:#fbfcf9}
.tnai-xterm .xterm{height:100%}.tnai-xterm .xterm-viewport{background:#fbfcf9!important}
.tnai-term-latest{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);white-space:nowrap;z-index:7;height:22px;padding:0 10px;border:1px solid #d9dcd2;border-radius:11px;background:#fff;box-shadow:0 1px 4px #0000001a;color:#4f6b3a;font:600 10px var(--pg-sans);cursor:pointer}
.tnai-term-latest:hover{background:#f2f4ee}.tnai-term-latest[hidden]{display:none}
.terminal-provider-card:disabled{opacity:.45;cursor:not-allowed;transform:none!important}
.terminal-provider-select:disabled{opacity:.6;cursor:not-allowed}
`;
  document.head.append(style);

  const theme = {
    background: '#fbfcf9',
    foreground: '#20211f',
    cursor: '#294c3d',
    cursorAccent: '#fbfcf9',
    selectionBackground: '#c7f36b59',
    black: '#34382f',
    red: '#b0473f',
    green: '#4f7a35',
    yellow: '#94701f',
    blue: '#3a6891',
    magenta: '#8a4f86',
    cyan: '#2f7c80',
    white: '#8a8f84',
    brightBlack: '#6e7467',
    brightRed: '#c2584f',
    brightGreen: '#5e8c43',
    brightYellow: '#a8842c',
    brightBlue: '#4a7ba6',
    brightMagenta: '#9c5e98',
    brightCyan: '#3a8f94',
    brightWhite: '#5b6353',
  };

  // xterm.js ships with the desktop app in node_modules; load it only here so the browser build
  // stays dependency-free.
  const loadScript = src =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.append(s);
    });
  const assets = (async () => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'node_modules/@xterm/xterm/css/xterm.css';
    document.head.append(css);
    await loadScript('node_modules/@xterm/xterm/lib/xterm.js');
    await loadScript('node_modules/@xterm/addon-fit/lib/addon-fit.js');

    // optional: without it terminals use the DOM renderer
    await loadScript('node_modules/@xterm/addon-webgl/lib/addon-webgl.js').catch(() => {});
  })();

  // GPU renderer: xterm's DOM renderer measured every glyph's width in the DOM on each redraw,
  // resize and restore from minimized (a 1.5 s freeze with a streaming Claude Code pane). Chromium
  // keeps ~16 WebGL contexts per page and drops the oldest past that, so at most WEBGL_MAX
  // terminals use it; the rest, and any whose context is lost or fails to start, use the DOM
  // renderer. 14 leaves headroom under Chromium's 16 for pop-out windows. At 8, a 9th pane on
  // screen (a new task with 8 agents running) got the DOM renderer, whose per-glyph width measuring
  // (a forced layout per character) was a 150 ms freeze on every pane added (new-pane profile).
  const WEBGL_MAX = 14;
  let webglCount = 0;

  // Terminals on screen that got the DOM renderer because every context was taken: upgraded when
  // one frees (a view parked or closed).
  const webglWaiting = new Set();
  try {
    if (localStorage.getItem('tnai.test.dom-renderer')) window.__tnaiDomRenderer = true;
  } catch {} // set only by desktop tests

  function upgradeWaiting() {
    for (const t of [...webglWaiting]) {
      if (webglCount >= WEBGL_MAX) return;
      if (t.tnaiDisposed) {
        webglWaiting.delete(t);
        continue;
      }
      if (t.element?.isConnected) useWebgl(t);
    }
  }

  // Lending: a terminal on screen that finds every context taken borrows one from a terminal with
  // nothing to draw (its box is 0×0: its page or workspace is hidden, or it is a parked view),
  // which draws nothing meanwhile. The lender takes one back (borrowing in turn) when its box gets
  // a size again, from a ResizeObserver (after layout, before paint), so it is never drawn by the
  // DOM renderer on screen. With more than 8 terminals the Agents page mirror otherwise got the DOM
  // renderer (stress-switch: fast agent switch 232 ms long tasks). Only on demand: hidden terminals
  // giving their contexts up as they hide measured far slower (every page switch remade them).
  const webglHolders = new Set();
  const boxHidden = t => {
    const e = t.element;
    return !e?.isConnected || !(e.clientWidth > 0 && e.clientHeight > 0);
  };

  function lend(borrower) {
    // A holder still in the page (hidden page or workspace, parked view) lends first; a detached
    // one only as a last resort: it may be mid-move within the window and would come back on screen
    // needing a context again.
    const order = [...webglHolders]
      .filter(t => t !== borrower && boxHidden(t))
      .sort((a, b) => !a.element?.isConnected - !b.element?.isConnected);
    for (const t of order) {
      giveUp(t, false);
      return true;
    }
    return false;
  }

  // A hidden terminal gives its context up and takes one back when its box gets a size again.
  // upgrade=false: lent to a terminal taking it at once.
  function giveUp(t, upgrade) {
    // Paused first: xterm pauses a hidden terminal only when its IntersectionObserver fires, after
    // the next paint, so one hidden this frame would draw every row with the DOM renderer swapped
    // in, measuring each glyph at width 0 (never cached): 1.5 s per page switch.
    const rs = t._core?._renderService,
      seen = isIntersecting => {
        try {
          rs?._handleIntersectionChange?.({
            isIntersecting,
            intersectionRatio: isIntersecting ? 1 : 0,
          });
        } catch {}
      };
    seen(false);
    t.tnaiWebglOff?.(upgrade);

    // The DOM renderer swapped in still redraws every row on each resize (xterm runs a paused
    // terminal's resize when idle), measuring each glyph at width 0 while hidden: it draws nothing
    // until the terminal is shown again, and then only if no context is free. Its own drawing
    // (quietHiddenRows' wrapper) is kept to be put back, not deleted.
    const dom = rs?._renderer?.value;
    const ownDraw = dom?.renderRows;
    if (dom && typeof ownDraw === 'function') dom.renderRows = () => {};
    const el = t.element;
    if (!el || t.tnaiDisposed) return;
    const ro = new (el.ownerDocument.defaultView || window).ResizeObserver(() => {
      if (t.tnaiDisposed || t.element !== el) {
        ro.disconnect();
        return;
      }
      if (boxHidden(t)) return;
      ro.disconnect();
      useWebgl(t);

      // no context for it: it draws with the DOM renderer again
      if (!t.tnaiWebglOff && dom && typeof ownDraw === 'function') dom.renderRows = ownDraw;
      seen(true); // shown again before its observer saw it hidden, it would stay paused
    });
    ro.observe(el);
  }

  // Hidden terminals hold no GPU context (speed lead 6, 2026-10-14). Since the app is threads only,
  // the agents' panels are never shown, and each one held a context that the first CLI screen
  // opened then had to take back. A terminal opened out of sight takes none (openRenderer), and one
  // whose box stays hidden (a parked CLI screen, Your terminal behind another tab) gives its
  // context back after GL_IDLE_MS. Not the moment it hides: going back to a thread seen a moment
  // ago would make a new context each time (terminals giving contexts up on every page switch
  // measured far slower, see lend). It takes one again when shown (giveUp's observer). A hidden
  // terminal draws nothing meanwhile (quietHiddenRows), so the DOM renderer costs it nothing.
  const GL_IDLE_MS = 20000;

  function giveUpWhenHidden(term) {
    const el = term.element;
    if (!el) return null;
    let timer = 0;
    const observer = new (el.ownerDocument.defaultView || window).ResizeObserver(() => {
      clearTimeout(timer);
      timer = 0;
      if (!boxHidden(term)) return;
      timer = setTimeout(() => {
        timer = 0;
        if (!term.tnaiDisposed && term.tnaiWebglOff && boxHidden(term)) giveUp(term);
      }, GL_IDLE_MS);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }

  // The renderer of a terminal being opened: a context now when its box is on screen, else when
  // its box first gets a size.
  function openRenderer(term) {
    wrapDispose(term);
    if (term.element && boxHidden(term)) retryWhenShown(term);
    else useWebgl(term);
  }

  // A disposed terminal gives its context back and stops waiting for one.
  function wrapDispose(term) {
    if (term.tnaiDisposeWrapped) return;
    term.tnaiDisposeWrapped = true;
    const origDispose = term.dispose.bind(term);
    term.dispose = () => {
      term.tnaiDisposed = true;
      webglWaiting.delete(term);
      term.tnaiWebglRetry?.disconnect();
      term.tnaiWebglRetry = null;
      if (term.tnaiWebglLater) clearTimeout(term.tnaiWebglLater);
      term.tnaiWebglLater = 0;
      term.tnaiWebglOff?.();
      origDispose();
    };
  }

  // The flicker of terminal text while a window edge or a divider is dragged (found 2026-10-12).
  // The GPU renderer draws on a canvas, and a canvas is emptied the moment its size is set. The
  // renderer sets the size at once on every change of columns, rows or text size, but draws the
  // rows again only on the next animation frame. Between the two the window can show the empty
  // canvas: one blank frame per step of a drag, which reads as the text flashing. So the rows are
  // drawn in the same step that sized the canvas, and no frame ever shows it empty. This is what
  // lets a terminal follow a drag as it happens (watchFit) without flicker. Internals of
  // addon-webgl 0.19, guarded: without them the terminal draws a frame later, as before.
  function drawWithResize(term, renderer) {
    if (!renderer || renderer.tnaiDrawWithResize || typeof renderer.handleResize !== 'function')
      return;
    renderer.tnaiDrawWithResize = true;
    const sizeCanvas = renderer.handleResize.bind(renderer);
    renderer.handleResize = (cols, rows) => {
      sizeCanvas(cols, rows);
      try {
        if (!term.tnaiDisposed && term.element?.isConnected) renderer.renderRows(0, term.rows - 1);
      } catch {}
    };
  }

  function useWebgl(term) {
    if (term.tnaiWebglOff || term.tnaiDisposed || !window.WebglAddon || window.__tnaiDomRenderer)
      return; // __tnaiDomRenderer: desktop tests (tools/desktop-check/run.js)
    wrapDispose(term);
    if (webglCount >= WEBGL_MAX && !(term.element && !boxHidden(term) && lend(term))) {
      webglWaiting.add(term);
      retryWhenShown(term);
      return;
    }
    webglWaiting.delete(term);
    let addon,
      counted = false,
      gl = null,
      stopHiddenWatch = null;

    // The addon's dispose leaves its GL context alive until garbage collection, so lending (dispose
    // + new) piled up live contexts until Chromium dropped the oldest, often a terminal on screen,
    // which then drew with the DOM renderer for good (stress-switch: 9 lost in 24 agent switches, 8
    // of 12 panes on the DOM renderer). The context is freed at once instead.
    const freeContext = () => {
      try {
        if (gl && !gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch {}
      gl = null;
    };

    // upgrade=false: the slot is lent to a terminal taking it at once, not offered to the waiting
    // ones.
    const release = (upgrade = true) => {
      const freed = counted;
      stopHiddenWatch?.();
      stopHiddenWatch = null;
      if (counted) {
        counted = false;
        webglCount--;
        webglHolders.delete(term);
      }
      try {
        addon?.dispose();
      } catch {}
      freeContext();
      if (term.tnaiWebglOff === release) term.tnaiWebglOff = null;
      if (freed && upgrade !== false) setTimeout(upgradeWaiting, 0);
    };
    try {
      addon = new window.WebglAddon.WebglAddon();

      // Lost anyway (GPU reset): a new one the next time its box is shown. One on screen would wait
      // on the DOM renderer until a page switch, so it asks again on the next frame (useWebgl keeps
      // the limit), at most once per 5 s so a GPU that stays down is not asked each frame. Lost
      // again within those 5 s, it asks when they are up, not never (learned 2026-10-28: a second
      // loss left it on the DOM renderer until the next page switch).
      addon.onContextLoss(() => {
        const held = counted,
          now = performance.now(),
          since = now - term.tnaiWebglLostAt;
        if (held) term.tnaiWebglLostAt = now;
        release();
        retryWhenShown(term);
        if (held && !boxHidden(term)) retryOnScreen(term, since < WEBGL_RETRY_MS ? since : 0);
      });
      term.loadAddon(addon);
      counted = true;
      webglCount++;
      webglHolders.add(term);
      gl = addon._renderer?._gl || null; // addon-webgl 0.19 internals
      drawWithResize(term, addon._renderer);
      term.tnaiWebglOff = release;
      stopHiddenWatch = giveUpWhenHidden(term);
    } catch {
      release();
    }
  }

  // A terminal on screen whose context was lost asks for a new one on a frame, once `waited` ms
  // since its last loss reach WEBGL_RETRY_MS (0: at once). One waiting retry per terminal; it is
  // cancelled when the terminal is disposed (wrapDispose) and does nothing once the terminal holds
  // a context again or its box is hidden (retryWhenShown then takes over).
  const WEBGL_RETRY_MS = 5000;

  function retryOnScreen(term, waited) {
    if (term.tnaiWebglLater) return;
    const view = term.element?.ownerDocument.defaultView || window;
    const ask = () => {
      if (!term.tnaiDisposed && !term.tnaiWebglOff && !boxHidden(term)) useWebgl(term);
    };
    const onFrame = () => (term.tnaiFrame ? term.tnaiFrame(ask) : view.requestAnimationFrame(ask));
    if (!waited) {
      onFrame();
      return;
    }

    // the main window's timer, so wrapDispose's clearTimeout finds it
    term.tnaiWebglLater = setTimeout(() => {
      term.tnaiWebglLater = 0;
      onFrame();
    }, WEBGL_RETRY_MS - waited);
  }

  // A terminal that found every context taken while its box was hidden (a new agent's panel made
  // while another page is shown) can't borrow then, and a freed slot is the only other way out:
  // shown later it drew with the DOM renderer for good (perf-page-switch: one more per new agent, a
  // 120–240 ms task on each page switch that showed it). It tries again each time its box gets a
  // size, from a ResizeObserver (after layout, before paint), until it holds a context. Same for
  // one whose context was lost.
  function retryWhenShown(term) {
    const el = term.element;
    if (!el || term.tnaiWebglRetry || term.tnaiDisposed) return;
    let hidden = boxHidden(term);
    const ro = (term.tnaiWebglRetry = new (el.ownerDocument.defaultView || window).ResizeObserver(
      () => {
        const was = hidden;
        hidden = boxHidden(term);
        if (term.tnaiDisposed || term.element !== el || term.tnaiWebglOff) {
          ro.disconnect();
          term.tnaiWebglRetry = null;
          return;
        }
        if (was && !hidden) {
          ro.disconnect();
          term.tnaiWebglRetry = null;
          useWebgl(term);
        }
      }
    ));
    ro.observe(el);
  }

  // xterm asks its renderer to redraw the selection on every scroll, even with no selection and
  // while paused off screen; the DOM renderer (terminals past WEBGL_MAX) then redraws every row,
  // measuring each character in a hidden box, which never caches (width 0): a forced layout per
  // character per line of output (typing-lag stress profile). A redraw with no selection before or
  // after changes nothing: skipped.
  function quietSelection(term) {
    const rs = term._core?._renderService;
    if (!rs || rs.tnaiQuietSelection || typeof rs.handleSelectionChanged !== 'function') return;
    const orig = rs.handleSelectionChanged.bind(rs);
    let had = true;
    rs.tnaiQuietSelection = true;
    rs.handleSelectionChanged = (start, end, columnSelectMode) => {
      const has = !!(start && end);
      if (!has && !had) return;
      had = has;
      orig(start, end, columnSelectMode);
    };
  }

  // The DOM renderer never draws rows into a box that is not on screen. xterm pauses a terminal it
  // cannot see, but it learns that a moment after the terminal is opened; until then the first
  // resize and the first selection redraw go straight to the renderer, which measures every
  // character of every row in the hidden box. A hidden box gives every width as 0, which is never
  // kept, so each character is measured again: 3 to 8 seconds of frozen window per new terminal
  // (agent-soak profile, 2026-10-13). Every agent's panel is hidden since the app is threads
  // only, so this was paid on each new thread whose panel has no GPU context. The skipped draw is
  // noted the way xterm notes its own, so the rows are drawn in full when the box is first shown.
  // xterm 5 internals, guarded: without them the renderer draws as before.
  function quietHiddenRows(term) {
    const rs = term._core?._renderService;
    const wrap = renderer => {
      const isDom = !!renderer?._widthCache && typeof renderer.renderRows === 'function';
      if (!isDom || renderer.tnaiQuietHidden) return;
      renderer.tnaiQuietHidden = true;
      const draw = renderer.renderRows.bind(renderer);
      renderer.renderRows = (start, end) => {
        if (!term.tnaiDisposed && boxHidden(term)) {
          rs._needsFullRefresh = true;
          return;
        }
        draw(start, end);
      };
    };
    if (!rs || rs.tnaiQuietHidden || typeof rs.setRenderer !== 'function') return;
    rs.tnaiQuietHidden = true;
    wrap(rs._renderer?.value);

    // a terminal that gives its GPU context back gets a new DOM renderer
    const setRenderer = rs.setRenderer.bind(rs);
    rs.setRenderer = renderer => {
      wrap(renderer);
      setRenderer(renderer);
    };
  }

  // A view kept off screen (Build panels' parked terminals, 33) gives its context back; it takes
  // one again when placed.
  const releaseWebgl = term => {
    webglWaiting.delete(term);
    term.tnaiWebglOff?.();
  };

  // Moves an opened terminal into a host, possibly in another window (Build panel pop-outs, 33):
  // xterm 6 follows the element's new window when its own open() is called again. A GL canvas
  // doesn't move between windows, so the renderer is remade there. xterm's render debouncer keeps
  // the animation frame it asked the old window for and asks for no other while one is pending. A
  // frame asked for by a pop-out that is closing never comes (the window stopped drawing: its
  // terminal lost focus, output landed), so the docked terminal never drew again (build-panels:
  // output in the pty, not on screen). That frame is dropped and a full redraw asked here.
  function reopen(term, host) {
    const from = term.element.ownerDocument.defaultView,
      moved = term.element.ownerDocument !== host.ownerDocument;
    if (moved) term.tnaiWebglOff?.();
    if (term.element.parentNode !== host) host.replaceChildren(term.element);
    window.Terminal.prototype.open.call(term, host);
    if (!moved) return;
    const debouncer = term._core?._renderService?._renderDebouncer; // xterm 6 internals
    if (debouncer?._animationFrame) {
      try {
        from?.cancelAnimationFrame(debouncer._animationFrame);
      } catch {}
      debouncer._animationFrame = undefined;
    }
    useWebgl(term);
    term.refresh(0, term.rows - 1);
  }

  // One xterm setup for every view of a session (Terminal page panes here, the Live preview
  // drawer's terminal in 33). Ctrl+C copies when text is selected (else it goes to the program as
  // an interrupt), Ctrl+Shift+C always copies; Ctrl+V / Ctrl+Shift+V paste through the browser.
  // Terminal text size (A− / A+, 10–48 px, remembered; 20 before 2026-09-30, 26 before 2026-10-01,
  // 36 before 2026-10-06: more room was asked for three times). One size per place
  // terminals are read in (the sizes of the different
  // pages stay separate, e.g. small with many panels on the Terminal page, large for one agent
  // elsewhere; one size everywhere before, 2026-09-29): the Terminal page's panels, the Agents
  // page, the Overview focus view, the Live preview drawer with its pop-outs. A size changes only
  // by the user's own A− / A+ in that place, never with a box's size (that made text jump around as
  // panels moved).
  const MAX_FONT = 48,
    MIN_FONT = 10;
  const FONT_KEY = 'tnai.terminal-font.v1'; // the Terminal page's; the other places add their name
  const fontKey = place =>
    place === 'terminal' ? FONT_KEY : 'tnai.terminal-font.' + place + '.v1';
  const fonts = {};

  // A place with no size of its own yet takes the Terminal page's and keeps it, so nothing changes
  // until A− / A+ is pressed there.
  for (const place of ['terminal', 'agents', 'focus', 'preview']) {
    let saved = 0;
    try {
      saved = +localStorage.getItem(fontKey(place));
    } catch {}
    const ok = saved >= MIN_FONT && saved <= MAX_FONT;
    fonts[place] = ok ? saved : fonts.terminal || 12;
    if (!ok && place !== 'terminal') {
      try {
        localStorage.setItem(fontKey(place), String(fonts[place]));
      } catch {}
    }
  }
  const placeOf = where => (typeof where === 'string' && where in fonts ? where : 'terminal');

  // ('agents' | 'focus' | 'preview'); anything else: the Terminal page's
  const fontFor = where => fonts[placeOf(where)];
  const compactFontFor = fontFor;

  function paintFontButtons() {
    const paint = (b, up, place) => {
      const f = fonts[place];
      b.disabled = up ? f >= MAX_FONT : f <= MIN_FONT;
      b.title = (up ? 'Larger' : 'Smaller') + ' terminal text (' + f + ' px)';
    };
    const down = document.getElementById('fontDown'),
      up = document.getElementById('fontUp');
    if (down) paint(down, false, 'terminal');
    if (up) paint(up, true, 'terminal');
    document
      .querySelectorAll('[data-tnai-font]')
      .forEach(b => paint(b, +b.dataset.tnaiFont > 0, placeOf(b.dataset.tnaiFontPlace)));
  }

  // The place's views refit (and resize their pty) at the new size. detail.place says whose size
  // changed; a listener refits only its own place's views (no place: every view, as the tests send
  // it).
  function setFont(place, size) {
    place = placeOf(place);
    size = Math.max(MIN_FONT, Math.min(MAX_FONT, Math.round(size)));
    if (size === fonts[place]) return;
    fonts[place] = size;
    try {
      localStorage.setItem(fontKey(place), String(size));
    } catch {}
    paintFontButtons();
    window.dispatchEvent(new CustomEvent('tnai:terminal-font', { detail: { size, place } }));
  }

  // (place, -1 | 1): a view's own A− / A+ (33, also in a pop-out window)
  const stepFont = (place, by) => setFont(place, fontFor(place) + by);
  document.getElementById('fontDown')?.addEventListener('click', () => stepFont('terminal', -1));
  document.getElementById('fontUp')?.addEventListener('click', () => stepFont('terminal', 1));

  // The same A− / A+ elsewhere: any button with data-tnai-font="-1" / "1" and data-tnai-font-place
  // (Agents page 25, focus view 99).
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-tnai-font]');
    if (b && !b.disabled) stepFont(b.dataset.tnaiFontPlace, Number(b.dataset.tnaiFont));
  });
  paintFontButtons();

  // Refits a terminal when its box changes size, for every reason (window resize/maximize, grid
  // reflow, Build panel resize/maximize/zoom, a page or workspace shown again). Observed from the
  // box's own window (a Build panel can move into a pop-out, 23), debounced, and skipped while the
  // box is hidden (0×0). Returns a disposer. A box shown again (page or workspace switch) refits at
  // once, inside the observer callback (after layout, before paint), so its first frame is not
  // drawn at the stale size and text size. Debounced refits of one window run from a shared queue,
  // a few per frame (FIT_BUDGET_MS), never all in one task: a pane added to a grid of streaming
  // agents resizes every pane at once, and each resize reflows that terminal's whole scrollback
  // (tens of ms per pane), which in one go froze the Terminal page for 150–400 ms (perf-new-task).
  // The shown-again refit below stays synchronous.
  const FIT_LIVE_MS = 50,
    FIT_BUDGET_MS = 8,
    fitQueues = new WeakMap(); // window -> { items: Set of run, frame }

  function queueFit(view, run) {
    let q = fitQueues.get(view);
    if (!q) fitQueues.set(view, (q = { items: new Set(), frame: 0 }));
    q.items.add(run);
    if (!q.frame) q.frame = view.requestAnimationFrame(() => drainFits(view, q));
  }

  function drainFits(view, q) {
    q.frame = 0;
    const t0 = performance.now();
    for (const run of q.items) {
      q.items.delete(run);
      try {
        run();
      } catch {}
      if (performance.now() - t0 > FIT_BUDGET_MS) break;
    }
    if (q.items.size) q.frame = view.requestAnimationFrame(() => drainFits(view, q));
  }

  // A terminal follows its box as the box changes, not once the resizing is done: while sizes keep
  // coming it is fitted every FIT_LIVE_MS, and once more at the last size. That is steady to look
  // at because the rows are drawn in the very step that sizes the canvas (drawWithResize above);
  // the flicker of a drag was the empty canvas shown between the two, never the fitting itself. The
  // program in the terminal is told the new size less often (RESIZE_MS below), so it does not draw
  // itself again at every step. (Tried the same day and turned down: fitting only when the box was
  // still. The text then stood cut off through the drag and jumped at the end.)
  function watchFit(host, refit, onShown) {
    const view = host.ownerDocument.defaultView || window;
    let timer = 0,
      shown = false,
      // when this view was last fitted
      fittedAt = 0;
    const unqueue = () => fitQueues.get(view)?.items.delete(run);

    // While the left nav slides (Ctrl+B, 29: .tnai-nav-anim for ~0.6 s) the box resizes every
    // frame: each refit reflowed the scrollback and resized the pty, so the CLI redrew a dozen
    // times and the text twitched. Wait for the slide to end, then refit once at the final size.
    const sliding = () => !!host.ownerDocument.querySelector('.layout.tnai-nav-anim');
    const run = () => {
      if (timer) view.clearTimeout(timer);
      timer = 0;
      unqueue();
      if (sliding()) {
        timer = view.setTimeout(() => queueFit(view, run), 60);
        return;
      }
      fittedAt = performance.now();
      if (host.isConnected && host.clientWidth > 0 && host.clientHeight > 0) refit();
    };
    const observer = new view.ResizeObserver(() => {
      const was = shown;
      shown = host.clientWidth > 0 && host.clientHeight > 0;
      if (shown !== was) onShown?.(shown);
      if (shown && !was) {
        if (timer) view.clearTimeout(timer);
        run();
        return;
      }

      // A fit is already on its way: it reads the box when it runs, so it takes this change too.
      if (timer) return;
      timer = view.setTimeout(
        () => queueFit(view, run),
        Math.max(0, FIT_LIVE_MS - (performance.now() - fittedAt))
      );
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (timer) view.clearTimeout(timer);
      timer = 0;
      unqueue();
    };
  }

  // Every terminal view made here, and the last SIZE_LOG size changes per pane (views and pty
  // sends), for the screen capture (110). Written only when a size changes; nothing runs between
  // changes.
  const views = new Set(),
    sizeLog = new Map(),
    SIZE_LOG = 40;

  // The name of the place a terminal stands in, as the screen capture writes it. A thread's CLI
  // screen (120, `.tnt-term-host`) is the terminal a user sees now, so it has a name of its own.
  const CLI_SCREEN = 'Thread CLI screen';
  const whereOf = term => {
    const e = term?.element;
    if (!e) return 'not shown';
    return e.closest('.tf-host')
      ? 'Overview focus view'
      : e.closest('.bw-term-host')
        ? 'Live preview drawer'
        : e.closest('.tnt-term-host')
          ? CLI_SCREEN
          : e.closest('[data-pane-id]')
            ? 'Terminal page panel'
            : 'other view';
  };

  function noteSize(paneId, entry) {
    if (!paneId) return;
    let list = sizeLog.get(paneId);
    if (!list) sizeLog.set(paneId, (list = []));
    list.push({ at: Date.now(), ...entry });
    if (list.length > SIZE_LOG) list.shift();
  }

  async function createTerm() {
    await assets;
    const term = new window.Terminal({
      fontFamily: 'Consolas, "Cascadia Mono", monospace',
      fontSize: fonts.terminal,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      scrollOnUserInput: false,
      allowProposedApi: true /* 75: decorations */,
      theme: window.TnaiTheme?.xterm?.() || theme,
      // Text below this contrast against its own cell background is lifted (xterm; half for dim
      // text). 4.5 (WCAG AA): a CLI drawing in its own dark-theme colors on the light theme (Claude
      // Code's default theme: #f8f8f2 diff context lines) stays readable; the light theme's
      // brightest ANSI colors get slightly darker. A session started under the other theme gets
      // more (contrastFor).
      minimumContrastRatio: 4.5,
      // The pty is ConPTY: without this, a resize that adds rows pulls scrollback into view while
      // ConPTY adds empty rows at the bottom, so the CLI's cursor-relative redraws (Claude Code's
      // spinner and input box) land on the wrong rows after every view/size switch.
      ...(native.windowsBuild
        ? { windowsPty: { backend: 'conpty', buildNumber: native.windowsBuild } }
        : {}),
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    views.add(term);

    // A minimized window runs no animation frames, so a frame still waiting for a closed terminal
    // kept all of it (its rows, page elements and listeners) until the window was shown again
    // (test thread-stream-leak). Frames asked for a terminal go through tnaiFrame and are cancelled
    // when it is disposed, and so is the one xterm 6's selection asks for on every buffer switch
    // and never cancels itself.
    const frames = new Set();
    term.tnaiFrame = callback => {
      const id = requestAnimationFrame(time => {
        frames.delete(id);
        callback(time);
      });
      frames.add(id);
      return id;
    };
    const disposeTerm = term.dispose.bind(term);
    term.dispose = () => {
      views.delete(term);
      term.tnaiDisposed = true;
      frames.forEach(id => cancelAnimationFrame(id));
      frames.clear();
      const selection = term._core?._selectionService; // xterm 6.0 internals
      if (selection?._refreshAnimationFrame) {
        selection._coreBrowserService?.window?.cancelAnimationFrame(
          selection._refreshAnimationFrame
        );
        selection._refreshAnimationFrame = undefined;
      }

      // xterm's scrollbar fades out (a CSS transition) as it is disposed, and a transition still
      // running is held by the page's timeline until a frame is drawn, and the terminal with it.
      // The scrollbar parts are taken out of the terminal, so that a fade still held reaches only
      // them, not the terminal through their parent.
      const scrollbarParts = [
        ...(term.element?.querySelectorAll('.xterm-scrollable-element > *') || []),
      ];
      disposeTerm();
      scrollbarParts.forEach(part => part.remove());
    };
    term.onResize(({ cols, rows }) => {
      const box = term.element?.parentElement;
      noteSize(term.tnaiPaneId, {
        kind: 'view',
        where: whereOf(term),
        cols,
        rows,
        box: box ? box.clientWidth + '×' + box.clientHeight : '',
        window: innerWidth + '×' + innerHeight,
      });
    });

    // Color queries (OSC 4 / 10 / 11 / 12 with "?") are answered once per pty by colorReplies()
    // below, never by a view: every view (panel, Agents mirror, Build, focus view) answered them
    // itself, so a second view, or a replay of saved output, sent the reply again and the CLI
    // (OpenCode) took it as typed text (`]4;0;rgb:2c2c/3434/4f4f\` in its input). Setting a color
    // ("4;1;#ff0000") still reaches xterm.
    for (const id of [4, 10, 11, 12])
      term.parser.registerOscHandler(id, data => data.includes('?'));

    // Every view's output (live, held, replay) passes through tintGrays() below, so a CLI's
    // neutral-gray backgrounds take the theme's hue. A color sequence cut in two by a write
    // boundary (replay slices, pty chunks) is held back and joined to the next write.
    const writeRaw = term.write.bind(term);
    let carry = '';
    term.write = (data, cb) => {
      if (typeof data !== 'string') return writeRaw(data, cb);
      data = carry + data;
      carry = '';
      const cut = data.lastIndexOf('\x1b[');
      if (cut >= 0 && data.length - cut < 64 && /^\x1b\[[\d;]*$/.test(data.slice(cut))) {
        carry = data.slice(cut);
        data = data.slice(0, cut);
      }
      return writeRaw(tintGrays(data, term.options.theme), cb);
    };

    // 75: tints the agent's "Technically Not report" block
    window.TnaiReportHighlight?.attach(term);

    // 90: "PowerShell" in agent output opens a PowerShell terminal panel
    window.TnaiPowerShellLink?.attach(term);

    // 113: a snapshot clip's file name is a link that shows its first frame and plays it
    window.TnaiClips?.attach(term);

    // xterm counts every mouse report as user input and snaps to the bottom, so with Claude Code's
    // any-motion reporting just moving the mouse over a pane scrolled up jumped it to the latest
    // output. Only typing and paste return to the bottom (not mouse or focus reports).
    term.onData(data => {
      if (!MOUSE_REPORT.test(data) && !/^\x1b\[[IO]$/.test(data)) term.scrollToBottom();
    });

    // Copy/paste through the clipboard of the window the terminal is in (a panel can live in a
    // pop-out). paste() brackets the text when the program asks.
    const clip = () => (term.element?.ownerDocument?.defaultView || window).navigator.clipboard;

    // The last terminal copy is remembered so the composer (27) pastes it as plain text, not as a
    // "[Pasted text #N]" token.
    const copy = () => {
      const text = term.getSelection();
      if (text) {
        window.TnaiTerminalCopy = text;
        clip()
          ?.writeText(text)
          .catch(() => {});
      }
      term.clearSelection();
    };

    // An image on the clipboard (a snapshot, Ctrl+Shift+Alt+S) is saved to Technically Not's
    // attachments folder and its path pasted, which agent CLIs read as an attached image; so clip →
    // paste → clip → paste works in a pane as in the composer. Text on the clipboard wins.
    const pasteImage = async () => {
      const save = window.tnaiNative?.attachments?.save;
      const items = save
        ? await clip()
            ?.read?.()
            .catch(() => null)
        : null;
      const item = items?.find(i => i.types.includes('image/png'));
      if (!item) return;
      const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
      const result = await save(
        'snapshot-' + stamp + '.png',
        await (await item.getType('image/png')).arrayBuffer()
      ).catch(error => ({ ok: false, error }));
      if (!result?.ok)
        return toast(
          'Could not paste the image: ' + (result?.error?.message || result?.error || 'save failed')
        );
      term.paste(/\s/.test(result.value) ? '"' + result.value + '"' : result.value);
    };
    const paste = () => {
      if (!term.options.disableStdin)
        clip()
          ?.readText()
          .then(text => {
            if (!text) return pasteImage();
            window.TnaiAttachments?.pasted?.(text);
            term.paste(
              window.TnaiClips?.forTerminal(text, live.get(term.tnaiPaneId)?.agent) ?? text
            );
          })
          .catch(() => {});
    };

    // Backspace/Delete with a selection on the input line deletes the selected text (a terminal
    // only knows keystrokes, so it would otherwise remove one letter): move the cursor to the
    // selection's end with arrow keys, then send one Backspace per selected cell. Only a selection
    // on the cursor's own row; blank cells past the typed text are ignored. Selecting part of the
    // prompt ("> ") is harmless, the program stops at the start of its input.
    let deleting = false,
      // typedOver: letters typed over a selection, sent once it is deleted (null = no replace under
      // way)
      typedOver = null;

    // A program that asked for bracketed paste (Claude Code, Codex) reads a large write whole, so
    // the keys of a delete go in one write and the selection goes in one step (before,
    // runs of 64 keys with a wait after each took over half a second and showed the
    // text going in pieces). PowerShell does not ask for it and keeps the runs of 64 (it drops keys
    // otherwise).
    const bulk = () => !!term.modes.bracketedPasteMode;
    const sendTypedOver = () => {
      const text = typedOver;
      typedOver = null;
      if (text && !term.options.disableStdin) term.input(text);
    };
    const deleteSelection = event => {
      if (
        (event.key !== 'Backspace' && event.key !== 'Delete') ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return false;

      // a multi-row delete is still stepping: an extra press would land mid-way
      if (deleting) return true;
      return removeSelection();
    };

    // Typing over a selection on the input line replaces it, as in any text box (select
    // one mistyped letter, type the right one): the selection is deleted as for
    // Backspace, then the letter is sent; letters typed while a long delete is still stepping wait
    // for it. A selection outside the input (earlier output) types as before.
    const replaceSelection = event => {
      if (
        event.key.length !== 1 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing
      )
        return false;
      if (deleting) {
        if (typedOver === null) return false;
        typedOver += event.key;
        return true;
      }
      if (!term.hasSelection() || !removeSelection()) return false;
      typedOver = event.key;
      if (!deleting) sendTypedOver();
      return true;
    };
    const removeSelection = () => {
      // 0-based columns, end exclusive, absolute rows
      const sel = term.hasSelection() && term.getSelectionPosition();
      const buf = term.buffer.active,
        row = buf.baseY + buf.cursorY;
      if (!sel || term.options.disableStdin || buf.type !== 'normal') return false;
      if (sel.start.y !== row || sel.end.y !== row) return deleteWrappedSelection(sel, row);
      const end = Math.min(sel.end.x, buf.getLine(row)?.translateToString(true).length ?? 0),
        start = sel.start.x;
      term.clearSelection();
      if (end <= start) return true;
      const move = end - buf.cursorX,
        csi = term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[';
      const keys = [
        ...Array(Math.abs(move)).fill(csi + (move > 0 ? 'C' : 'D')),
        ...Array(end - start).fill('\x7f'),
      ];
      if (keys.length <= 64 || bulk()) {
        term.input(keys.join(''));
        return true;
      }

      // A wide row: runs of 64 keys, each once the program has taken the last (its cursor moved,
      // then held still 100 ms), as in reach() below: PowerShell (ConPTY + PSReadLine) drops keys
      // of a large write or of one that lands while it is still redrawing.
      deleting = true;
      const at = () => {
        const b = term.buffer.active;
        return b.baseY + b.cursorY + ':' + b.cursorX;
      };
      (async () => {
        for (let i = 0; i < keys.length; i += 64) {
          const from = at();
          if (term.options.disableStdin) return;
          term.input(keys.slice(i, i + 64).join(''));
          let last = from,
            still = 0,
            moved = false;
          for (let t = 0; t < 1200 && !(moved && still >= 100); t += 25) {
            await new Promise(r => setTimeout(r, 25));
            const c = at();
            if (c !== last) {
              last = c;
              still = 0;
              moved = true;
            } else still += 25;
          }
          if (!moved) return; // the program ignored the keys: send no more
        }
      })()
        .catch(() => {})
        .finally(() => {
          deleting = false;
          sendTypedOver();
        });
      return true;
    };

    // The same for a selection across the rows of a wrapped input, or on another row of it than the
    // cursor. The program wraps the text itself (Claude Code: 2-cell indent, the space at a word
    // break has no cell), so cells don't map 1:1 to characters: send a first batch of keys that
    // never goes past the target, then single keys, checked each time against the cursor the
    // program puts back at its caret (Claude Code does), until it reaches the selection's end, then
    // its start. Only inside the cursor's input block: between the box rules around it when there
    // are both (Claude Code; blank rows of a multi-paragraph input stay inside), else the rows up
    // to a blank or rule line. A selection that runs past the block (a drag that overshoots onto
    // the rule above) is cut to the block; one wholly in earlier output still reaches the program
    // as a plain key. With `move` set (a plain click, below) it only moves the caret to sel.end and
    // deletes nothing.
    const deleteWrappedSelection = (sel, row, move) => {
      const buf = () => term.buffer.active,
        text = y => buf().getLine(y)?.translateToString(true) ?? '';
      const rule = y => /^[\s─-╿-]*[─-╿-][\s─-╿-]*$/.test(text(y)); // a box rule (─ ━ ═ …)
      const edge = y => rule(y) || !text(y).trim();
      let top = row,
        bottom = row;
      while (top > 0 && row - top < 200 && !rule(top - 1)) top--;
      while (bottom < buf().length - 1 && bottom - row < 200 && !rule(bottom + 1)) bottom++;
      if (rule(row) || top === 0 || !rule(top - 1) || !rule(bottom + 1)) {
        // no rules around it: blank rows end the block
        top = bottom = row;
        while (top > 0 && row - top < 200 && !edge(top - 1)) top--;
        while (bottom < buf().length - 1 && bottom - row < 200 && !edge(bottom + 1)) bottom++;
        if (edge(row)) return false;
      }
      let start = { ...sel.start },
        end = { ...sel.end };

      // a drag to the start of the next row
      if (end.x === 0 && end.y > start.y) end = { y: end.y - 1, x: Infinity };
      if (end.y < top || start.y > bottom) return false;
      if (start.y < top) start = { y: top, x: 0 };
      if (end.y > bottom) end = { y: bottom, x: Infinity };
      end.x = Math.min(end.x, text(end.y).length);
      const lead = y => text(y).length - text(y).trimStart().length;

      // in a continuation row's indent: from its first letter
      if (start.y > top && start.x < lead(start.y)) start.x = lead(start.y);
      const cmp = (p, q) => p.y - q.y || p.x - q.x;

      // a click in a continuation row's indent: its first letter
      if (move && end.y > top && end.x < lead(end.y)) end.x = lead(end.y);
      if (!move && cmp(end, start) <= 0) {
        term.clearSelection();
        return true;
      }
      const seg = new Intl.Segmenter(),
        count = s => [...seg.segment(s)].length;

      // Characters from a to b (a before b), never more than there are: indents and word-break
      // spaces are left out.
      const between = (a, b) => {
        if (a.y === b.y) return count(buf().getLine(a.y)?.translateToString(false, a.x, b.x) ?? '');
        let n = count(buf().getLine(a.y)?.translateToString(true, a.x) ?? '');
        for (let y = a.y + 1; y < b.y; y++) n += count(text(y).trimStart());
        return n + count((buf().getLine(b.y)?.translateToString(false, 0, b.x) ?? '').trimStart());
      };
      const cursor = () => ({ y: buf().baseY + buf().cursorY, x: buf().cursorX });
      const pause = ms => new Promise(r => setTimeout(r, ms));

      // Waits until the cursor moved and then held still for 50 ms (checked every 10 ms; 3x the 16
      // ms output batch, so a redraw split across two batches never reads as settled); false if it
      // never moved within `limit` ms (the program ignored the keys).
      const settle = async (from, limit = 1200) => {
        let last = from,
          still = 0,
          moved = false;
        for (let t = 0; t < limit; t += 10) {
          await pause(10);
          const c = cursor();
          if (cmp(c, last)) {
            last = c;
            still = 0;
            moved = moved || !!cmp(c, from);
          } else if (moved && (still += 10) >= 50) return true;
        }
        return moved;
      };
      const csi = term.modes.applicationCursorKeysMode ? '\x1bO' : '\x1b[';
      const send = (key, n) => {
        if (n > 0 && !term.options.disableStdin) term.input(key.repeat(n));
      };

      // Moves the caret (arrows) or deletes back (Backspace) until the cursor reaches `target` from
      // the side `dir` says. The first batch goes in runs of 64 keys: PowerShell (ConPTY +
      // PSReadLine) drops all but one key of a single 333-key write (100 work).
      // `ahead`: keys of an earlier run the program may still take late (see the key-by-key loop).
      const reach = async (target, key, dir, first, ahead = 0) => {
        // Each run must move the caret about as far as it had keys (a few short: word-break spaces
        // have no cell); less means the input ended early (a prompt above it counted in `first`) or
        // something else changed it: finish key by key, so no leftover run of keys lands on what
        // the user types next. Cells the caret went in `dir` (a wrapped row counts full width, so
        // this never counts short; deleted letters can't be counted).
        const moved = (from, to) => ((to.y - from.y) * term.cols + to.x - from.x) * dir;

        // One write (bulk): what is still left is counted again after it and sent as one more
        // write, a few times at most, so the word-break spaces the first count left out are not
        // stepped one key (and one wait) at a time.
        const one = bulk(),
          run = one ? Infinity : 64;
        const rest = () => {
          const c = cursor();
          return cmp(c, target) * dir >= 0 ? 0 : dir > 0 ? between(c, target) : between(target, c);
        };
        for (
          let left = first, writes = 1;
          left > 0;
          left = one ? (writes++ < 6 ? rest() : 0) : left - 64
        ) {
          const n = Math.min(run, left),
            from = cursor();
          send(key, n);
          if (!(await settle(from))) return false;
          if (cmp(cursor(), from) * dir <= 0) return false;

          // A pause inside the run is not the end of the input: on a busy PC PowerShell takes part
          // of the keys and the rest a moment later. Wait for the rest while it keeps coming, or
          // the delete goes on one key at a time (20 s for a long input) and the late rest reads
          // as "not ours" below and stops it half-way (learned 2026-10-29,
          // tools/cli-screen-delete-test.js).
          while (moved(from, cursor()) < n - 8 && (await settle(cursor(), 300)));
          if (moved(from, cursor()) < n - 8) {
            ahead = n - Math.max(0, moved(from, cursor()));
            break;
          }
        }
        for (let i = 0; i < 400; i++) {
          const c = cursor(),
            d = cmp(c, target);
          if (dir > 0 ? d >= 0 : d <= 0) return true;
          send(key, 1);
          if (!(await settle(c))) return false;

          // it moved the other way: the user is typing, so stop before a key eats a letter
          if (cmp(cursor(), c) * dir < 0) return false;

          // More than one key's move, but no more than the run's keys still out: the program took
          // them after a longer pause. They are ours, so go on in runs from here.
          const now = cursor(),
            late = moved(c, now) - 2;
          if (late > 0 && late <= ahead) return reach(target, key, dir, rest(), ahead - late);

          // one key moves one letter (a wide one is 2 cells), or to the next/previous row: more is
          // not ours (Esc, a paste …)
          if (Math.abs(now.y - c.y) > 1 || (now.y === c.y && moved(c, now) > 2)) return false;
        }
        return false;
      };
      term.clearSelection();
      deleting = true;
      (async () => {
        const c = cursor(),
          d = cmp(c, end);
        const atEnd =
          !d ||
          (d < 0
            ? await reach(end, csi + 'C', 1, between(c, end))
            : await reach(end, csi + 'D', -1, between(end, c)));

        // the program doesn't show its caret with the cursor: delete nothing
        if (move || !atEnd || cmp(cursor(), end) !== 0) return;
        await reach(start, '\x7f', -1, between(start, cursor()));
      })()
        .catch(() => {})
        .finally(() => {
          deleting = false;
          sendTypedOver();
        });
      return true;
    };

    // A plain click in the input moves the caret there: a terminal only
    // knows keystrokes, so the caret is stepped with arrow keys as for a deleted selection above.
    // Only a left click with no drag, no modifier (Alt+click stays xterm's own) and no link under
    // it, inside the cursor's input block, on the normal screen (full-screen programs get their own
    // clicks).
    const clickMovesCaret = () => {
      const el = term.element,
        screen = el?.querySelector('.xterm-screen');
      if (!screen) return;
      let down = null;
      el.addEventListener(
        'mousedown',
        e => {
          down =
            e.button === 0 && e.detail === 1 && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey
              ? { x: e.clientX, y: e.clientY }
              : null;
        },
        true
      );
      el.addEventListener(
        'mouseup',
        e => {
          const d = down;
          down = null;
          if (
            !d ||
            e.button !== 0 ||
            Math.abs(e.clientX - d.x) > 3 ||
            Math.abs(e.clientY - d.y) > 3
          )
            return;
          if (
            deleting ||
            term.hasSelection() ||
            term.options.disableStdin ||
            term.buffer.active.type !== 'normal'
          )
            return;
          if (!screen.contains(e.target) || e.target.closest?.('.xterm-cursor-pointer')) return;
          const r = screen.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const buf = term.buffer.active,
            row = buf.baseY + buf.cursorY;
          let x = Math.max(
            0,
            Math.min(term.cols, Math.round((e.clientX - r.left) / (r.width / term.cols)))
          );
          const y =
            buf.viewportY +
            Math.max(
              0,
              Math.min(term.rows - 1, Math.floor((e.clientY - r.top) / (r.height / term.rows)))
            );

          // Dim text after the caret is a suggestion or placeholder, not typed text (Claude Code):
          // a key past it could accept it.
          if (y === row)
            for (let i = buf.cursorX, line = buf.getLine(row); i < x; i++)
              if (line?.getCell(i)?.isDim()) {
                x = i;
                break;
              }
          if (y === row && x === buf.cursorX) return;
          deleteWrappedSelection({ start: { x, y }, end: { x, y } }, row, true);
        },
        true
      );
    };
    term.attachCustomKeyEventHandler(event => {
      // On a Mac, Cmd+C / Cmd+V copy and paste and every Ctrl key goes to the program (Ctrl+C
      // always interrupts).
      const mac = !!window.tnaiPlatform?.mac;
      if (event.type === 'keydown' && (deleteSelection(event) || replaceSelection(event))) {
        event.preventDefault();
        return false;
      }
      if (
        event.type !== 'keydown' ||
        !(mac ? event.metaKey : event.ctrlKey) ||
        event.altKey ||
        (mac ? event.ctrlKey : event.metaKey)
      )
        return true;
      const key = event.key.toLowerCase();
      if (key === 'c' && (mac || event.shiftKey || term.hasSelection())) {
        copy();
        event.preventDefault();
        return false;
      }
      if (key === 'v') {
        if (!event.repeat) paste();
        event.preventDefault();
        return false;
      } // holding Ctrl+V pastes once, not on every auto-repeat
      return true;
    });

    // Mouse wheel over a program that turned on mouse reporting (Claude Code does) while it draws
    // on the normal screen: scroll this terminal's own scrollback instead of reporting the wheel.
    // Reported wheel input interrupted what the CLI was doing (a running /compact) and every notch
    // redrew the pane. Full-screen programs (alternate screen: vim, less …) still get the wheel.
    let wheelRest = 0;
    term.attachCustomWheelEventHandler(event => {
      // Ctrl+wheel does nothing (blocked in the capture listener below)
      if (event.ctrlKey) return false;
      if (
        term.modes.mouseTrackingMode === 'none' ||
        term.buffer.active.type !== 'normal' ||
        event.shiftKey
      )
        return true;
      const px =
        event.deltaMode === 1
          ? event.deltaY * 17
          : event.deltaMode === 2
            ? event.deltaY * 17 * term.rows
            : event.deltaY;
      wheelRest += px / Math.max(8, term.options.fontSize * term.options.lineHeight);
      const lines = Math.trunc(wheelRest);
      wheelRest -= lines;
      if (lines) term.scrollLines(lines);
      event.preventDefault();
      return false;
    });

    // Right-click: copy the selection if there is one, otherwise paste (Windows Terminal's
    // behavior). Callers open() the term themselves. No paste while this terminal is the voice
    // target (70 marks it data-voice while listening/transcribing): a stray right-click would land
    // in front of the spoken prompt.
    const origOpen = term.open.bind(term);
    term.open = parent => {
      origOpen(parent);
      quietSelection(term);
      quietHiddenRows(term);
      openRenderer(term);
      latestButton(term);

      // Ctrl+wheel over a terminal does nothing: no text zoom, no window zoom, no scrolling (xterm
      // 6's inner scroller ignores the custom handler, so block it first).
      term.element?.addEventListener(
        'wheel',
        event => {
          if (event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        { capture: true, passive: false }
      );
      term.element?.addEventListener('contextmenu', event => {
        event.preventDefault();
        if (term.hasSelection()) copy();
        else if (!term.element.closest('[data-voice]')) {
          paste();
          term.focus();
        }
      });
      holdViewWhileSelecting(term);
      clickMovesCaret();
    };

    // Selecting while output arrives: a selection is kept in buffer lines,
    // so when new output scrolled the view during a drag, the same mouse spot pointed at newer
    // lines and the selection jumped to text the user never chose. From the press until the
    // selection is gone the view holds still, as if scrolled up by hand (xterm's own "user is
    // scrolling"; the "↓ Latest" button shows what arrives); a view that was at the newest line
    // goes back there once the selection is copied or cleared.
    function holdViewWhileSelecting(t) {
      const el = t.element,
        bs = t._core?._bufferService;
      if (!el || !bs) return;
      let dragging = false,
        held = null;
      const release = () => {
        const back = held?.bottom;
        held = null;
        if (back) {
          t.scrollToBottom();
          bs.isUserScrolling = false;
        }
      }; // scrollToBottom at the bottom already leaves the flag on
      el.addEventListener(
        'mousedown',
        e => {
          if (
            e.button !== 0 ||
            t.buffer.active.type !== 'normal' ||
            e.target.closest?.('.tnai-term-latest')
          )
            return;
          const b = t.buffer.active;
          if (!held) held = { bottom: b.viewportY >= b.baseY };
          dragging = true;
          bs.isUserScrolling = true;

          // The release is watched in the window the terminal is in now (a panel can move to a
          // pop-out, 33).
          (e.view || window).addEventListener(
            'mouseup',
            () => {
              dragging = false;

              // a plain click: nothing selected, back to following the output
              if (!t.hasSelection()) release();
            },
            { capture: true, once: true }
          );
        },
        true
      );
      t.onSelectionChange(() => {
        if (!dragging && held && !t.hasSelection()) release();
      });
    }

    // Scrolled up from the newest line: a "↓ Latest" button centred at the bottom brings the
    // terminal back to its live output in one click (it says "New output" once more has arrived
    // below). Hidden again at the bottom, whether reached by the button, the wheel or typing.
    function latestButton(t) {
      const el = t.element;
      if (!el || el.querySelector('.tnai-term-latest')) return;
      const btn = el.ownerDocument.createElement('button');
      btn.type = 'button';
      btn.className = 'tnai-term-latest';
      btn.hidden = true;
      btn.title = 'Jump to the newest output';

      // keep the terminal's focus and selection
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => {
        t.scrollToBottom();
        t.focus();
        sync();
      });
      el.append(btn);
      let seenBase = 0;
      const sync = () => {
        const b = t.buffer.active,
          up = b.viewportY < b.baseY;
        if (!up) seenBase = b.baseY;
        const text = b.baseY > seenBase ? '↓ New output · Latest' : '↓ Latest';
        if (btn.hidden === up || btn.textContent !== text) {
          btn.hidden = !up;
          btn.textContent = text;
        }
      };
      t.onScroll(sync);
      t.onWriteParsed(sync);
      t.buffer.onBufferChange(sync);
    }

    // A reply or report shown twice after a panel resize (cause read from a
    // panel's saved output). Claude Code answers a resize by erasing every row on screen from the
    // top (CSI H, then CSI 2K + CSI 1B per row, CSI H) and printing the end of its conversation
    // again for the new size. Rows that had already left the screen (moved into scrollback when the
    // panel lost rows, or scrolled out of the shorter screen) are printed again too, and the old
    // ones stayed above as a second copy, wrapped for the other width. Once such a redraw is
    // parsed, the scrollback rows right above it are dropped while their text (spaces, wraps and
    // rule lines aside) is found in the redrawn rows below: only rows repeated word for word go,
    // everything older stays. Only after a resize, on the normal screen, for that erase-every-row
    // redraw; a shell's or ConPTY's own repaint is left alone. Sizing is untouched (ptySize). xterm
    // internals (buffer lines), guarded. Test: terminal-regrow-duplicate.
    const DUP_SKIP = /[\s─-╿]+/g,
      DUP_ROWS = 240,
      DUP_MIN = 8,
      DUP_TRIES = 12,
      DUP_MS = 5000;

    // after a resize: { at, phase: 0 waiting | 1 erasing | 2 printing, erased, mark, tries }
    let redrawn = null;
    const endRedraw = () => {
      redrawn?.mark?.dispose();
      redrawn = null;
    };
    const rowText = (b, y) => (b.getLine(y)?.translateToString(true) || '').replace(DUP_SKIP, '');

    // A table is laid out again for the new width: its cells wrap in other places, so the old
    // copy's rows are never found word for word in the new one and stayed above it, re-wrapped by
    // xterm into broken borders (Overview focus view). Rows of a table
    // right above the redraw go when every word of each is in a redrawn table row; rows joined
    // where xterm wrapped them. A row that is no table row, or holds a word the redraw lacks, ends
    // it, so older tables and other text stay. In a narrow view Claude Code draws the same table as
    // records ("Issue: …" rows per table row, a rule between them), so after a resize between a
    // narrow and a wide view one copy is records and the other a table.
    // A table row then also goes when every word is anywhere in the redraw (`all`, a
    // key's colon aside), and record rows (no cell bar) go when every word is in a redrawn table
    // row and at least one of them starts with a key; without a key row only table rows go.
    const DUP_CELL = /[│┃║]/,
      DUP_EDGE = /[┌-╿]/,
      DUP_SPLIT = /[\s─-╿]+/,
      DUP_KEY = /^\s*[^\s:][^:]{0,40}:(\s|$)/,
      DUP_COLON = /:$/;
    const tableAbove = (b, top, cells, all) => {
      const scan = records => {
        let from = top,
          size = 0,
          plain = 0,
          keys = 0;
        for (let y = top - 1; y >= 0 && top - y <= DUP_ROWS;) {
          let s = y,
            line = '';
          while (s > 0 && b.getLine(s)?.isWrapped) s--;
          for (let i = s; i <= y; i++) line += b.getLine(i)?.translateToString(i === y) || '';
          const words = line.split(DUP_SPLIT).filter(Boolean);
          if (words.length) {
            if (DUP_CELL.test(line)) {
              if (!words.every(w => cells.has(w) || all.has(w))) break;
            } else if (
              records &&
              cells.size &&
              words.every(w => cells.has(w) || cells.has(w.replace(DUP_COLON, '')))
            ) {
              plain++;
              if (DUP_KEY.test(line)) keys++;
            } else break;
            from = s;
            size += words.join('').length;
          } else if (DUP_EDGE.test(line) || (records && line.trim())) {
            // a border or a rule: the top one goes with its rows, the bottom one with what is above
            // it
            if (size) from = s;
          } else if (line.trim()) break;
          y = s - 1;
        }
        return { count: size >= DUP_MIN ? top - from : 0, sure: !plain || keys > 0 };
      };
      const r = scan(true);
      return r.sure ? r.count : scan(false).count;
    };

    // A redraw that starts in the middle of a row xterm re-wrapped: the row above the dropped
    // repeat holds older words and then the redraw's first words, so it stayed with those words
    // shown twice. The row is cut at the first word from which the rest of the row, followed by the
    // repeat dropped below it, is found in the redraw; the older words before it stay.
    const cutRowEnd = (b, y, text, shown) => {
      const line = b.getLine(y),
        len = line?.translateToString(true).length || 0;
      for (let x = 1; x < len; x++) {
        const before = line.getCell(x - 1)?.getChars() || ' ',
          here = line.getCell(x)?.getChars() || ' ';
        if (before !== ' ' || here === ' ') continue;
        const end = line.translateToString(true, x).replace(DUP_SKIP, '');
        if (!end || !shown.includes(end + text)) continue;
        if (!line.translateToString(true, 0, x).replace(DUP_SKIP, '')) return;
        term._core.buffer.lines.get(y).replaceCells(x, term.cols, term._core.buffer.getNullCell());
        return;
      }
    };
    const dropRepeats = () => {
      const r = redrawn,
        b = term.buffer.active;
      if (r?.phase !== 2) return;
      if (r.mark.isDisposed || b.type !== 'normal' || ++r.tries > DUP_TRIES) return endRedraw();
      try {
        const core = term._core.buffer,
          cells = new Set(),
          all = new Set();
        let shown = '',
          dropped = 0;
        for (let y = r.mark.line, end = Math.min(b.length, y + DUP_ROWS); y < end; y++) {
          shown += rowText(b, y);
          const raw = b.getLine(y)?.translateToString(true) || '',
            cell = DUP_CELL.test(raw);
          for (const w of raw.split(DUP_SPLIT))
            if (w) {
              if (cell) cells.add(w);
              all.add(w);
              all.add(w.replace(DUP_COLON, ''));
            }
        }
        for (;;) {
          const top = r.mark.line;
          let from = top,
            text = '';
          for (let y = top - 1; y >= 0 && top - y <= DUP_ROWS; y--) {
            const more = rowText(b, y) + text;
            if (!shown.includes(more)) break;
            text = more;
            from = y;
          }
          let count = top - from;
          if (text.length < DUP_MIN) {
            count = all.size ? tableAbove(b, top, cells, all) : 0;
            from = top - count;
          } else cutRowEnd(b, from - 1, text, shown);
          if (!count) break;
          core.lines.splice(from, count);
          core.ybase -= count;
          core.ydisp = Math.min(
            core.ybase,
            core.ydisp >= top ? core.ydisp - count : Math.min(core.ydisp, from)
          );
          dropped += count;
          if (r.mark.isDisposed) break;
        }
        if (!dropped) return;
        try {
          term._core._viewport?.queueSync?.();
        } catch {}
        term.refresh(0, term.rows - 1);
      } catch {}
      endRedraw();
    };
    const noteResize = (cols, rows) => {
      if (cols === term.cols && rows === term.rows) return;
      dropRepeats();

      // a redraw still open (resizes in a row, replay) is settled at the size it was drawn for
      endRedraw();

      // Made lower, xterm takes away the rows under the cursor first and keeps the top rows on
      // screen, while Claude Code redraws as if those top rows had gone into the scrollback: it
      // erases them and does not print them again, so they were lost until the panel grew again.
      // `kept` is how many top rows that is; they go into the scrollback when the redraw starts
      // erasing (CSI K below). Only for a change of rows on the normal screen.
      const b = term.buffer.active,
        lower = cols === term.cols && b.type === 'normal' ? term.rows - rows : 0,
        kept = Math.max(0, Math.min(lower, term.rows - 1 - b.cursorY));
      redrawn = { at: Date.now(), phase: 0, erased: 0, mark: null, tries: 0, kept };
    };

    // Moves the top `count` screen rows into the scrollback (a scroll up, as a newline at the
    // bottom row would) and puts the redraw's mark on the new top row. Internals, guarded.
    const keepTopRows = (r, count) => {
      try {
        const core = term._core,
          b = core.buffer;
        if (b.scrollTop !== 0 || b.scrollBottom !== term.rows - 1) return;
        const erase = core._inputHandler._eraseAttrData();
        for (let i = 0; i < count; i++) core._bufferService.scroll(erase);
        r.mark?.dispose();
        r.mark = term.registerMarker(-term.buffer.active.cursorY);
      } catch {}
    };

    // Cursor Agent answers a change of width the other way round: it erases every row from the
    // bottom up (CSI 2K, then CSI 1A, read from its saved output 2026-10-15) and prints its whole
    // output again from the top row; the rows already in the scrollback stayed above as a second
    // copy. A run of erases one row above the other that reaches the top row with every row of
    // the screen erased is that redraw: the mark goes on the top row and the repeat is dropped as
    // for Claude Code's. Codex and OpenCode draw on the alternate screen, which has no scrollback.
    const eraseUpward = r => {
      const y = term.buffer.active.cursorY,
        up = r.up;
      if (Date.now() - r.at > DUP_MS || term.buffer.active.type !== 'normal') {
        endRedraw();
        return false;
      }
      if (up && (y === up.row - 1 || (y === 0 && up.row === 0))) {
        up.row = y;
        up.count++;
      } else r.up = { row: y, count: 1 };
      if (y === 0 && r.up.count >= term.rows - 1) {
        r.mark = term.registerMarker(0);
        r.up = null;
        r.phase = r.mark ? 2 : 0;
      }
      return false;
    };
    term.parser.registerCsiHandler({ final: 'H' }, params => {
      const r = redrawn;
      if (!r || r.phase === 2 || (params[0] || 1) !== 1 || (params[1] || 1) !== 1) return false;
      r.up = null;
      if (r.phase === 1 && r.erased >= term.rows - 1) {
        r.phase = 2;
        return false;
      }
      if (Date.now() - r.at > DUP_MS || term.buffer.active.type !== 'normal') {
        endRedraw();
        return false;
      }
      r.mark?.dispose();
      r.mark = term.registerMarker(-term.buffer.active.cursorY);
      r.erased = 0;
      r.phase = r.mark ? 1 : 0;
      return false;
    });
    term.parser.registerCsiHandler({ final: 'K' }, params => {
      const r = redrawn;
      if (!r || params[0] !== 2) return false;
      if (r.phase === 0) return eraseUpward(r);
      if (r.phase !== 1) return false;

      // the first erase of the top row: the redraw is Claude Code's, keep the rows it skips
      if (!r.erased && r.kept && term.buffer.active.cursorY === 0) keepTopRows(r, r.kept);
      r.kept = 0;
      r.erased++;
      return false;
    });

    // Settled as soon as the redraw ends (Claude Code shows the cursor again, CSI ?25h): in a
    // replay the next parsed write can be 16 KB later, after newer output has rewritten the redrawn
    // rows. Each parsed write is the fallback for a CLI that never hides the cursor.
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      if (redrawn?.phase === 2 && params[0] === 25) dropRepeats();
      return false;
    });
    term.onWriteParsed(dropRepeats);

    // replay(buffer): writes a session's saved output at the sizes it was drawn for (the size notes
    // desktop/pty-service.js puts in it), so in-place redraws land on the right lines; resolves
    // when written, and the caller then refits to its box. Live notes are ignored. A CLI's
    // full-width rule (Claude Code's `────` above and below its input) is exactly as wide as the
    // terminal it was drawn for. Made narrower, xterm's reflow wraps it onto a second row, so every
    // old input box in the scrollback (and all of a restored, stopped panel, which never redraws)
    // turned into doubled rule lines. Before a narrowing resize, a row
    // made only of box-drawing characters is cut to the new width instead (not when the row below
    // continues it). Internals, guarded.
    // Rows on the screen are cut only while no program runs in the panel, and never in a replay:
    // a running CLI erases every screen row and prints back only what fits, and a cut rule row is
    // one row where xterm's reflow makes two, so more reply rows stayed on the screen instead of
    // moving into the scrollback and the redraw wiped them (learned 2026-10-29 from two saved
    // logs, 11 and 1 rows lost; check `node tools/cli-screen-replay-test.js`).
    const isRuleCp = cp => cp >= 0x2500 && cp <= 0x257f;
    const resizeTerm = term.resize.bind(term);
    term.resize = (cols, rows) => {
      if (cols < term.cols)
        try {
          const b = term._core.buffer,
            nul = b.getNullCell(),
            stopped = !restoring && live.get(term.tnaiPaneId)?.running === false,
            end = stopped ? b.lines.length : b.ybase;
          for (let i = 0; i < end; i++) {
            const line = b.lines.get(i),
              len = line?.getTrimmedLength() || 0;
            if (len <= cols || line.isWrapped || b.lines.get(i + 1)?.isWrapped) continue;
            let rule = true;
            for (let x = 0; x < len && rule; x++) rule = isRuleCp(line.getCodePoint(x));
            if (rule) line.replaceCells(cols, line.length, nul);
          }
        } catch {}
      noteResize(cols, rows);
      const out = resizeTerm(cols, rows);
      term.tnaiSettle();
      return out;
    };

    // A stopped session's screen keeps its newest lines at the bottom (stopped
    // panels showed their last lines at the top with empty rows under them). With ConPTY set
    // (windowsPty above) xterm adds the rows of a taller box empty at the bottom, and a CLI that
    // ends can leave erased rows under its last line; a running program draws for the new size, a
    // stopped one never does. So the empty rows under its last line (and under the cursor) are
    // swapped for the lines above the screen, as far as there are any. Only while no program runs
    // in the pane (it would draw at the old rows), on the normal screen, and never during a replay
    // (its in-place redraws count rows from the top). Internals, guarded.
    term.tnaiSettle = () => {
      try {
        if (
          restoring ||
          live.get(term.tnaiPaneId)?.running !== false ||
          term.buffer.active.type !== 'normal'
        )
          return;
        const b = term._core.buffer;
        if (!(b.ybase > 0) || b.lines.length !== b.ybase + term.rows) return;
        let used = b.ybase + b.y;
        for (let i = b.lines.length - 1; i > used; i--)
          if (b.lines.get(i)?.getTrimmedLength()) {
            used = i;
            break;
          }
        const pull = Math.min(b.lines.length - 1 - used, b.ybase);
        if (!(pull > 0)) return;
        const atBottom = b.ydisp >= b.ybase;
        for (let i = 0; i < pull; i++) b.lines.pop();
        b.ybase -= pull;
        b.y += pull;
        b.ydisp = atBottom ? b.ybase : Math.min(b.ydisp, b.ybase);
        try {
          term._core._viewport?.queueSync?.(b.ydisp);
        } catch {}
        term.refresh(0, term.rows - 1);
      } catch {}
    };

    // The other direction, only for a stopped session's saved screen (it never redraws; a running
    // CLI draws its rules again itself): shown in a wider box, a rule kept the width of the
    // terminal it was drawn for, so two stopped agents' screens differed.
    // Called after a widening resize with the old width (25 rewrapSaved): a row that is one
    // repeated rule character, exactly that wide, is continued to the new width with its own cells
    // (same color). Internals, guarded.
    term.tnaiWidenRules = from => {
      try {
        const b = term._core.buffer,
          to = term.cols;
        if (!(from > 0 && to > from)) return;
        for (let i = 0; i < b.lines.length; i++) {
          const line = b.lines.get(i);
          if (
            !line ||
            line.isWrapped ||
            b.lines.get(i + 1)?.isWrapped ||
            line.getTrimmedLength() !== from
          )
            continue;
          const cp = line.getCodePoint(0);
          let rule = isRuleCp(cp);
          for (let x = 1; x < from && rule; x++) rule = line.getCodePoint(x) === cp;
          if (!rule) continue;
          for (let x = from; x < to; x += from)
            line.copyCellsFrom(line, 0, x, Math.min(from, to - x), false);
        }
        term.refresh(0, term.rows - 1);
      } catch {}
    };

    // A CLI's own near-black backgrounds (OpenCode's #0a0a0a screen and #141414/#1e1e1e boxes, in
    // saved screens from before it drew on the terminal's background) become the terminal's own, so
    // every panel has one surface. Only SGR 48;2 truecolor with every
    // channel ≤ 40 and 48;5 blacks (0, 16, 232–235); every other color stays. Covers every view
    // (all use createTerm).
    const darkBg = (a, i) =>
      a[i + 1] === '2'
        ? Math.max(+a[i + 2] || 0, +a[i + 3] || 0, +a[i + 4] || 0) <= 40
          ? 5
          : 0
        : a[i + 1] === '5' && /^(0|16|23[2-5])$/.test(a[i + 2])
          ? 3
          : 0;
    const calmBg = s =>
      typeof s !== 'string' || !s.includes('48;')
        ? s
        : s.replace(/\x1b\[([\d;]*)m/g, (m, p) => {
            if (!p.includes('48;')) return m;
            const a = p.split(';');
            for (let i = 0; i < a.length; i++) {
              if (a[i] === '48') {
                const n = darkBg(a, i);
                if (n) {
                  a.splice(i, n, '49');
                  continue;
                }
              }
              if (
                (a[i] === '38' || a[i] === '48' || a[i] === '58') &&
                (a[i + 1] === '2' || a[i + 1] === '5')
              )
                i += a[i + 1] === '2' ? 4 : 2;
            }
            return '\x1b[' + a.join(';') + 'm';
          });
    const writeTerm = term.write.bind(term);
    term.write = (data, cb) => writeTerm(calmBg(data), cb);

    // A CLI that clears its scrollback (ED3: a compact, Claude Code's full redraw of its
    // conversation) takes away the lines a scrolled-up view was on. xterm keeps "the user is
    // scrolling" then, so the view stayed at the top of the redraw, hundreds of lines up (user
    // report 2026-09-29). The spot is gone: follow the new output instead. Runs before xterm's own
    // handler (false), internals guarded.
    term.parser.registerCsiHandler({ final: 'J' }, params => {
      if (params[0] === 3 && term.buffer.active.type === 'normal')
        try {
          term._core._bufferService.isUserScrolling = false;
        } catch {}
      return false;
    });
    let restoring = false;
    term.parser.registerOscHandler(7717, data => {
      const [cols, rows] = data.split(';').map(Number);
      if (restoring && cols >= 20 && rows >= 5 && (cols !== term.cols || rows !== term.rows))
        term.resize(cols, rows);
      return true;
    });

    // Size notes with no output between them (views taking the size in turn) collapse to the last
    // one: each resize reflows the whole scrollback already written, which made opening a view of a
    // long session (Agents page, Build panel) slow.
    const replay = buffer =>
      new Promise(done => {
        if (!buffer) return done();
        buffer = buffer.replace(/(?:\x1b\]7717;\d+;\d+\x07){2,}/g, run =>
          run.slice(run.lastIndexOf('\x1b]7717;'))
        );

        // Written in 16 KB slices: xterm parses one write() in one go but yields between queued
        // writes, so a long session's replay (up to ~320 KB) paints progressively instead of
        // stalling the page it opens on. The parser keeps its state across slices.
        restoring = true;
        const SLICE = 16384;
        for (let at = 0; at < buffer.length; at += SLICE) {
          const last = at + SLICE >= buffer.length;
          term.write(
            buffer.slice(at, at + SLICE),
            last
              ? () => {
                  restoring = false;
                  term.tnaiSettle();
                  done();
                }
              : undefined
          );
        }
      });
    return { term, fit, replay };
  }

  // A pty has one size, but a session can show in several views (its Terminal page pane, the Live
  // preview drawer, the Agents page). The view the user last focused, typed in, resized, or brought
  // on screen drives the size (claim); other views follow it (tnai:pty-size). A plain refit (offer)
  // takes over only when the driving view is hidden (other pages are not on screen). Exactly one
  // driver per pty; a hidden view (off page, 0×0) never claims or offers. The pty itself is resized
  // once per burst (RESIZE_MS, last size wins, unchanged sizes skipped): every resize makes a
  // full-screen CLI (Claude Code, Codex) redraw everything, so page switches, font changes and
  // several views refitting together cost one redraw, not one per view. Views follow
  // (tnai:pty-size) at once, so they always show the size in effect.
  const sizing = new Map(); // paneId -> { owner: { visible() }, cols, rows }
  const sentSize = new Map(),
    resizeTimers = new Map(); // paneId -> 'cols×rows' last sent to the pty / pending resize timer

  // RESIZE_MS is the quiet time after the last new size, not a rate: while sizes keep coming (a
  // window edge being dragged) the timer starts again, at most RESIZE_MAX_MS in all. As a fixed 40
  // ms rate a one-second drag sent each pty 20 to 24 sizes (measured 2026-10-05, desktop test
  // resize-drag), and the CLIs were still redrawing after the drag ended (user report: lag that
  // stays after a resize).
  const RESIZE_MS = 200,
    // the quiet time is longer than a fit burst's wait (FIT_LIVE_MS): at 100 ms each
    // trailing fit of a drag ended a burst, 11 sizes per drag
    RESIZE_MAX_MS = 600;
  const resizeFirst = new Map(),
    // paneId -> when its pending burst began / paneIds whose timer is a nudge's way back
    nudging = new Set();
  const shownOwner = owner => {
    try {
      return !!owner?.visible();
    } catch {
      return false;
    }
  };

  function flushResize(paneId) {
    resizeTimers.delete(paneId);
    resizeFirst.delete(paneId);
    const s = sizing.get(paneId);
    if (!s) return;
    const key = s.cols + '×' + s.rows;

    // Back at the size the pty has, after a smaller one it was never told about (within RESIZE_MS):
    // the views were resized there and back, and xterm dropped the rows under the cursor and added
    // empty ones at the bottom, so the program's input sat above empty rows until its next full
    // redraw. One row less and back makes it draw its screen again. Not
    // for a shell: it has nothing under its cursor, and ConPTY's repaint would only repeat its
    // rows. The public sessions() is asked, so a CLI started by hand in a shell panel (37 reports
    // it as that agent) counts as an agent CLI too.
    if (sentSize.get(paneId) === key) {
      if (
        shrunk.delete(paneId) &&
        window.TnaiAgents?.sessions?.().find(x => x.paneId === paneId)?.agent !== 'Terminal'
      )
        nudge(paneId, s.cols, s.rows);
      return;
    }
    shrunk.delete(paneId);
    sentSize.set(paneId, key);
    native.pty.resize(paneId, s.cols, s.rows);
    noteSize(paneId, {
      kind: 'pty',
      cols: s.cols,
      rows: s.rows,
      by: isMain(paneId, s.owner) ? 'Terminal page panel' : 'another view',
    });
  }

  // paneIds whose views went below the size last sent to the pty, and it has not been sent a size
  // since
  const shrunk = new Set();

  // A replay this long has been cut to its tail by the main process (SCROLLBACK, 256 KB, in
  // desktop/pty-service.js; a trimmed buffer stays within a line or so of it): see repaint.
  const REPLAY_CUT_CHARS = 192 * 1024;

  function nudge(paneId, cols, rows) {
    if (!(rows > 5)) return;
    native.pty.resize(paneId, cols, rows - 1);
    noteSize(paneId, {
      kind: 'pty-nudge',
      cols,
      rows: rows - 1,
      by: 'redraw request (one row less and back)',
    });
    nudging.add(paneId);
    resizeTimers.set(
      paneId,
      setTimeout(() => {
        resizeTimers.delete(paneId);
        nudging.delete(paneId);
        native.pty.resize(paneId, cols, rows);
        noteSize(paneId, { kind: 'pty-nudge', cols, rows, by: 'redraw request (back)' });
        flushResize(paneId);
      }, 80)
    );
  }

  // Size owner = the visible view. The main view (the session's Terminal
  // page panel) owns the size while it is on screen once it has set it there (2026-09-28): the
  // other views (Agents page mirror, Overview focus view, Build panels) then follow it and never
  // resize the pty, so two views on screen never take turns (that made the program redraw on every
  // switch). While the main view is NOT on screen, a shown other view sizes the pty to its own box
  // (a running session no longer stays at the size it started with, e.g. 80×24 for an agent started
  // while Terminal was hidden), and the main view takes the size back when it is shown again (its
  // watchFit refit + claim). Until the main view has been on screen at all, the other views size it
  // as before.
  const mainSized = new Set(); // paneIds whose main view has set the size while shown
  const isMain = (paneId, owner) => !!owner && live.get(paneId)?.owner === owner;
  const mayDrive = (paneId, owner) => {
    const main = live.get(paneId);
    return isMain(paneId, owner) || !mainSized.has(paneId) || !main || !shownOwner(main.owner);
  };

  // A view following that size: the Terminal page's text size (A−/A+) when cols × rows fit its box,
  // else smaller until they do, so the program's bottom rows (its input) are never cut off. Never
  // larger than that size (one text size for all terminals; the earlier
  // grow-to-fill made text change size between views). The caller then resizes the terminal to cols
  // × rows. grow (mirrors of a screen they can't resize: a stopped session's saved screen, or one
  // another view drives): the font also grows, up to ×1.8, so that screen fills the box instead of
  // sitting small in it.
  function followFont(term, fit, font, cols, rows, grow) {
    // the caller's place size (fontFor)
    if (!(font >= MIN_FONT && font <= MAX_FONT)) font = fonts.terminal;
    if (term.options.fontSize !== font) term.options.fontSize = font;
    if (grow) {
      let d = null;
      try {
        d = fit.proposeDimensions();
      } catch {}
      const s = d?.cols > 0 && d?.rows > 0 ? Math.min(d.cols / cols, d.rows / rows) : 0;
      if (s > 1.05) term.options.fontSize = Math.min(font * 1.8, Math.floor(font * s * 4) / 4);
    }
    for (let i = 0; i < 4; i++) {
      let d = null;
      try {
        d = fit.proposeDimensions();
      } catch {}
      if (!(d?.cols > 0 && d?.rows > 0)) return;
      const scale = Math.min(d.cols / cols, d.rows / rows);
      if (scale >= 1) return;
      const next = Math.max(4, Math.floor(term.options.fontSize * scale * 4) / 4 - (i ? 0.25 : 0));
      if (next >= term.options.fontSize) return;
      term.options.fontSize = next;
    }
  }

  function applySize(paneId, owner, cols, rows) {
    if (isMain(paneId, owner)) mainSized.add(paneId);
    const cur = sizing.get(paneId);
    sizing.set(paneId, { owner, cols, rows });
    const resized = !cur || cur.cols !== cols || cur.rows !== rows;
    if (resized) {
      const [sc, sr] = (sentSize.get(paneId) || '').split('×').map(Number);
      if (cols < sc || rows < sr) shrunk.add(paneId);
    }
    if (resized && !nudging.has(paneId)) {
      // a nudge on its way back flushes the newest size itself
      const now = performance.now(),
        first = resizeFirst.get(paneId) ?? now;
      resizeFirst.set(paneId, first);
      clearTimeout(resizeTimers.get(paneId));
      resizeTimers.set(
        paneId,
        setTimeout(
          () => flushResize(paneId),
          Math.max(0, Math.min(RESIZE_MS, first + RESIZE_MAX_MS - now))
        )
      );
    }

    // Views that don't drive the size follow it (tnai:pty-size), so their lines wrap where the
    // program wrapped them.
    if (resized || cur.owner !== owner)
      window.dispatchEvent(
        new CustomEvent('tnai:pty-size', { detail: { paneId, owner, cols, rows } })
      );
  }
  const ptySize = {
    // false: this view may not set the size (it follows the main view's; tnai:pty-size / get()).
    claim(paneId, owner, cols, rows) {
      if (!mayDrive(paneId, owner)) return false;
      if (cols > 0 && rows > 0 && shownOwner(owner)) applySize(paneId, owner, cols, rows);
      return true;
    },
    mayDrive,
    followFont,
    offer(paneId, owner, cols, rows) {
      const cur = sizing.get(paneId);
      if (!(cols > 0 && rows > 0) || !shownOwner(owner) || !mayDrive(paneId, owner)) return false;
      if (cur && cur.owner !== owner && shownOwner(cur.owner)) return false;
      applySize(paneId, owner, cols, rows);
      return true;
    },
    get: paneId => {
      const s = sizing.get(paneId);
      return s ? { cols: s.cols, rows: s.rows } : null;
    },
    driver: paneId => sizing.get(paneId)?.owner || null,
    // A new process starts at this size (native.pty.start got it), so nothing is pending or sent
    // for it yet.
    started(paneId, owner, cols, rows) {
      clearTimeout(resizeTimers.get(paneId));
      resizeTimers.delete(paneId);
      resizeFirst.delete(paneId);
      nudging.delete(paneId);
      sentSize.set(paneId, cols + '×' + rows);
      noteSize(paneId, {
        kind: 'pty-start',
        cols,
        rows,
        by: isMain(paneId, owner) ? 'Terminal page panel' : 'another view',
      });
      if (isMain(paneId, owner) && shownOwner(owner)) mainSized.add(paneId);
      else mainSized.delete(paneId); // started hidden: its size is a guess
      sizing.set(paneId, { owner, cols, rows });
      window.dispatchEvent(
        new CustomEvent('tnai:pty-size', { detail: { paneId, owner, cols, rows } })
      );
    },
    forget(paneId) {
      clearTimeout(resizeTimers.get(paneId));
      resizeTimers.delete(paneId);
      resizeFirst.delete(paneId);
      nudging.delete(paneId);
      sentSize.delete(paneId);
      sizing.delete(paneId);
      mainSized.delete(paneId);
      sizeLog.delete(paneId);
    },
    // A full-screen program (alternate screen: OpenCode) sends only the cells that change, so a
    // view that replayed just the tail of its output has gaps (the terminal's own background shows
    // through its dark screen). One row less and back makes it redraw everything.
    // An agent CLI on the normal screen needs the same once its replay was cut off: a working
    // Claude Code writes about 850 bytes a second for its spinner alone, so after a few minutes the
    // kept tail (desktop/pty-service.js SCROLLBACK, 256 KB) holds no screen, only spinner updates,
    // and a new view stayed almost empty until the CLI drew again. replayLength is the replay's
    // size; a shell is never asked (its repaint would only repeat its rows).
    repaint(paneId, term, replayLength = 0) {
      const key = sentSize.get(paneId);
      if (!key) return;
      const alternate = term?.buffer.active.type === 'alternate';
      const cutOff =
        replayLength >= REPLAY_CUT_CHARS &&
        window.TnaiAgents?.sessions?.().find(x => x.paneId === paneId)?.agent !== 'Terminal';
      if (!alternate && !cutOff) return;

      // A size still on its way: a new size makes the program draw anyway, and the size the pty
      // already has is sent as one row less and back (flushResize, the same as after a bounce)
      if (resizeTimers.has(paneId)) {
        if (!nudging.has(paneId)) shrunk.add(paneId);
        return;
      }
      const [cols, rows] = key.split('×').map(Number);
      nudge(paneId, cols, rows);
    },
  };

  // Input that is not the user typing: mouse reports and focus in/out reports (\e[I / \e[O, sent
  // when a CLI asks for focus events). They go to the program but never take over the pty size; a
  // focus-out from a view that isn't driving used to resize the pty.
  const FOCUS_REPORT = /^\x1b\[[IO]$/;
  const isReport = data => MOUSE_REPORT.test(data) || FOCUS_REPORT.test(data);

  // A CLI's answer to a report (Claude Code redraws on focus-in, i.e. when its panel is clicked) is
  // not work either: see onData. Typing is noted too (every input path calls this: 10, 25 mirror,
  // 33 Build): the CLI echoes each key, and that echo is not work. Enter (or a paste that ends in
  // one) submits, so the output after it counts again.
  const noteReport = (paneId, data) => {
    const v = live.get(paneId);
    if (!v) return;
    if (isReport(data)) v.reportedAt = Date.now();
    else v.typedAt = /[\r\n]/.test(data) ? 0 : Date.now();
  };

  // ---- Agent CLI detection (installed, version, signed-in account) ----
  function detect(force) {
    if (!force && detecting) return detecting;
    if (!force && Date.now() - detectedAt < 60000) return Promise.resolve(detected);
    detecting = native.agents.detect().then(
      list => {
        detected = new Map(list.map(a => [a.id, a]));
        detectedAt = Date.now();
        detecting = null;
        applyAvailability();
        notify();
        return detected;
      },
      () => {
        detecting = null;
        return detected;
      }
    );
    return detecting;
  }

  // Paused CLIs (grayed out and waiting): they run in a panel but have no
  // work rules, tools or resume (Antigravity), lost their personal sign-in (Gemini CLI) or were
  // never verified here (Droid), so no new connection can be started on them until full support is
  // ready. Take an id out of
  // this list to bring it back.
  const PAUSED = new Set(['Gemini CLI', 'Antigravity', 'Droid']);

  // Why a connection cannot be used right now, or '' if it can.
  function blocker(id) {
    if (!id || id === 'Terminal') return '';
    if (PAUSED.has(id)) return 'Paused: not fully supported yet';
    if (!detectedAt) return detected.size ? '' : 'Checking…';
    const info = detected.get(id);
    if (!info) return 'No connector yet';
    if (info.incomplete) return 'Not installed completely';
    return info.installed ? '' : 'Not installed';
  }

  function describe(id) {
    if (id === 'Terminal')
      return window.tnaiPlatform?.win === false
        ? 'Terminal · ' + window.tnaiPlatform.shell
        : 'Windows PowerShell';
    const reason = blocker(id);
    if (reason) return reason;
    const info = detected.get(id);
    if (info.loggedIn === true)
      return (
        'Signed in' + (info.account ? ' · ' + (window.tnaiMaskEmails || String)(info.account) : '')
      );
    if (info.loggedIn === false) return 'Installed · sign-in required';
    return 'Installed' + (info.version ? ' · ' + info.version : '');
  }

  function applyAvailability() {
    document.querySelectorAll('.terminal-provider-card[data-provider]').forEach(card => {
      const id = card.dataset.provider,
        reason = blocker(id);
      card.disabled = !!reason;
      card.title = reason ? id + ': ' + reason.toLowerCase() : id + ': ' + describe(id);
      const small = card.querySelector('.terminal-provider-copy small');
      if (small) small.textContent = describe(id);
    });
    document.querySelectorAll('.terminal-provider-select').forEach(select => {
      [...select.options].forEach(option => {
        if (option.value) option.disabled = !!blocker(option.value);
      });
      const view = live.get(select.closest('.terminal-pane')?.dataset.paneId);
      select.disabled = !!view?.running;
    });
  }

  // ---- Pane status shown in the pane header and counted by 07 ----
  // Its sub-agents, from pushed state only: Claude Code hooks (19 TnaiTeam.open) and the delegation
  // graph (43 TnaiGraph, inWait from main).
  function onAgents(paneId) {
    const team = window.TnaiTeam?.open?.(paneId) || { fg: 0, bg: 0 },
      graph = window.TnaiGraph,
      node = graph?.node?.(paneId);
    const kids = node
      ? graph
          .state()
          .nodes.filter(
            n => n.parentId === node.id && (n.status === 'starting' || n.status === 'working')
          ).length
      : 0;
    return {
      blocked: team.fg > 0 || (!!node?.inWait && kids > 0),
      open: team.fg + team.bg + kids > 0,
    };
  }

  // A task the CLI itself reported as ended (42's turns: Claude Code's Stop hook, Codex's and
  // OpenCode's own records) is over at once: the panel does not stay "Working" for the 2.5 to 3.5 s
  // it takes to notice the quiet while every task clock already says "Took" (the
  // statuses did not match between views). The CLI's last redraw right after the end is not work;
  // output later than that counts as before (a slash command, a task the CLI reports no start for),
  // and a new task's start clears it.
  const TURN_END_REDRAW_MS = 1500;
  const endedQuiet = view =>
    !!view.turnEndedAt && view.lastOutputAt <= view.turnEndedAt + TURN_END_REDRAW_MS;

  function status(view) {
    if (view.error) return 'error';
    if (view.running === 'starting') return 'starting';

    // Needs you: the CLI sits on a question main detected (71 TnaiNeedsYou: permission, menu,
    // unsent prompt, folder trust), not just quiet.
    if (view.running === true && view.mode !== 'login' && window.TnaiNeedsYou?.has(view.paneId))
      return 'needs-you';
    if (view.running) {
      // Waiting on agents: blocked on its own sub-agents (tnai_wait, or Claude Code foreground
      // Agent calls: the spinner is not its work), or quiet while any of its sub-agents still run
      // (19 hooks, 43 graph). Needs you above still wins.
      const on = onAgents(view.paneId);
      if (view.running === true && on.blocked) return 'waiting-agents';
      const quiet = Date.now() - view.lastOutputAt >= 2500 || endedQuiet(view);

      // Working in background: quiet, but tasks it started in the background (shells, monitors,
      // workflows; 19 hooks) still run.
      return quiet
        ? on.open
          ? 'waiting-agents'
          : window.TnaiTeam?.background?.(view.paneId)?.length
            ? 'background'
            : 'waiting'
        : 'working';
    }
    return view.exitCode === null || view.exitCode === undefined
      ? 'not-started'
      : view.exitCode === 0 || view.stoppedByUser
        ? 'exited'
        : 'error';
  }

  // Why a process ended, in plain words, from its exit code (Windows NTSTATUS codes arrive signed
  // or unsigned). '' for a clean exit.
  function exitReason(code, mode, stoppedByUser) {
    if (code === null || code === undefined || code === 0) return '';
    if (stoppedByUser) return 'stopped by you';
    const u = code >>> 0;
    if (mode === 'login') return u === 1 ? 'sign-in canceled or failed' : 'sign-in failed';
    const known = {
      1: 'ended with an error',
      2: 'bad command or arguments',
      126: 'could not run the program',
      127: 'command not found',
      9009: 'command not found',
      130: 'interrupted (Ctrl+C)',
      137: 'killed',
      143: 'terminated',
      255: 'ended with an error',
      0xc000013a: 'interrupted (Ctrl+C or window closed)',
      0xc0000005: 'crashed (memory access violation)',
      0xc0000135: 'missing a required DLL or runtime',
      0xc0000409: 'crashed (fail-fast)',
      0xc00000fd: 'crashed (stack overflow)',
      0xc0000017: 'ran out of memory',
      0xc0000142: 'failed to start (DLL init)',
      0xc000001d: 'crashed (illegal instruction)',
    };
    return known[u] || (u >= 0xc0000000 ? 'crashed' : 'ended with an error');
  }

  // One line for a stopped process: "Stopped by you", "Exited · command not found (code 127)"; ''
  // while running or never started.
  function exitText(v) {
    if (v.running || v.exitCode === null || v.exitCode === undefined) return '';
    if (v.stoppedByUser) return 'Stopped by you';
    if (!v.exitCode) return 'Exited';
    const u = v.exitCode >>> 0,
      code = u >= 0xc0000000 ? '0x' + u.toString(16).toUpperCase() : v.exitCode;
    return 'Exited · ' + exitReason(v.exitCode, v.mode) + ' (code ' + code + ')';
  }
  const labels = {
    starting: 'Starting…',
    working: 'Working',
    waiting: 'Waiting for input',
    'waiting-agents': 'Waiting on agents',
    background: 'Working in background',
    'not-started': 'Not started · press Enter',
    exited: 'Exited',
    error: 'Stopped with an error',
  };

  // Runs every second: writes only what changed, so observers of data-state and the text (07, 11,
  // 25) aren't woken for nothing. Returns true when the status changed.
  function paint(view) {
    const s = status(view),
      text = view.pane.querySelector('.terminal-pane-state span'),
      data = view.pane.dataset;
    const state = view.running ? 'working' : s === 'error' ? 'error' : 'idle';
    if (data.state !== state) data.state = state;
    const moved = data.status !== s;
    if (moved) data.status = s; // full status for the status colors (05-status-colors.css)
    const label =
      view.mode === 'login' && view.running
        ? 'Signing in…'
        : s === 'error' && view.exitCode
          ? exitText(view)
          : s === 'needs-you'
            ? window.TnaiNeedsYou.label(view.paneId)
            : labels[s];
    if (text && text.textContent !== label) text.textContent = label;

    // The status tooltip also carries the context label: narrow panels show only the status dot and
    // hide the context label (11). It also names the agent's model (108), so every panel answers
    // "which model is this?" without a new item in its header.
    const box = text?.parentElement,
      ctx = view.pane.querySelector('.terminal-context-state')?.textContent,
      model = window.TnaiAgentModel?.tip?.(view),
      tip = label + (ctx ? ' · ' + ctx : '') + (model ? '\n' + model : '');
    if (box && box.title !== tip) box.title = tip;
    const select = view.pane.querySelector('.terminal-provider-select');
    if (select && select.disabled !== !!view.running) select.disabled = !!view.running;
    return moved;
  }

  // Working → waiting (no output for 2.5 s) is found here; a status change notifies, so Overview
  // and the other views update at once instead of on their own slower timers. A view with no
  // process (saved, exited, not started) cannot change status by itself: every change to it paints
  // at once (start, exit, mount, repaint()), so the 1 s tick skips it. Every 15th tick still paints
  // all: the tooltip's context label and model can arrive late.
  let paintTick = 0;
  const paintAll = () => {
    let moved = false;
    const all = ++paintTick % 15 === 0;
    live.forEach(v => {
      if ((all || v.running) && paint(v)) moved = true;
    });
    if (moved) notifySoon();
  };
  setInterval(paintAll, 1000);

  // Waiting on agents follows sub-agent state as it is pushed (hooks via 19, graph from main; 43
  // applies it first, so after a tick).
  window.addEventListener('tnai:team-changed', paintAll);
  native?.graph?.onState?.(() => setTimeout(paintAll, 0));

  // …and the task's own end or start as 42 pushes it (endedQuiet). Painted a moment later: a task
  // that ends with a prompt waiting is followed at once by the next task's start, and the panel
  // must not read "Waiting for input" in between.
  let turnPaint = 0;
  window.addEventListener('tnai:turn', event => {
    const view = live.get(event.detail?.paneId);
    if (!view) return;
    const at = window.TnaiTurns?.get?.(view.paneId)?.endedAt || 0;
    if ((view.turnEndedAt || 0) === at) return; // the same task again (its tokens, its steps)
    view.turnEndedAt = at;
    if (!turnPaint)
      turnPaint = setTimeout(() => {
        turnPaint = 0;
        paintAll();
      }, 120);
  });

  const cleanTitle = raw =>
    String(raw || '')
      .replace(/^[\s⠀-⣿✳✻✶✢✽·*•●◐◓◑◒|\\/-]+/u, '')
      .trim();

  // Technically Not's own notes in a terminal are yellow (errors red) and broken at words into
  // short lines: a note written as one long line ran off the edge in any view
  // narrower than the terminal it was written in (a saved session keeps its recorded width until
  // its box has a size; a view that follows another's size clips). Short lines fit every panel
  // width.
  const NOTE_COLS = 44;
  const wrapNote = (text, width) => {
    const out = [];
    let line = '';
    for (const w of String(text).split(' ')) {
      if (line && line.length + 1 + w.length > width) {
        out.push(line);
        line = w;
      } else line = line ? line + ' ' + w : w;
    }
    if (line) out.push(line);
    return out;
  };

  // A stopped session's screen is laid out again for its panel's width (reflowSaved), so a note
  // under it is written for the terminal's real width and follows the panel from then on (at 44
  // columns it stood as a narrow block whatever the width). A note
  // into a running or full-screen program's screen keeps the short lines, for the reason above.
  const noteWidth = view =>
    !view.running && view.term.buffer.active.type === 'normal' && window.TnaiSavedReflow
      ? Math.min(view.term.cols || NOTE_COLS, 160) - 2
      : Math.min(view.term.cols || NOTE_COLS, NOTE_COLS);
  const say = (view, text, tone) =>
    view.term.writeln(
      '\r\n\x1b[' +
        (tone === 'error' ? '31' : '33') +
        'm' +
        wrapNote(text, Math.max(20, noteWidth(view))).join('\r\n') +
        '\x1b[0m'
    );

  // A CLI on PATH whose install did not finish is never shown as working.
  // The same texts as INCOMPLETE in desktop/agent-registry.js, where detection reads them from the
  // CLI's `--version`; here they are caught in a panel's first output, for a CLI that broke after
  // detection ran.
  const INCOMPLETE =
    /native binary not installed|not compatible with the version of Windows|not a valid (Win32 )?application|Cannot find module|spawn UNKNOWN|Cannot create process, error code: (193|216)\b/i;

  // Says in the panel's own note (and view.error, the thread's blocked reason) that the install is
  // incomplete, with the reinstall command as one PS> line of its own, never wrapped.
  function sayIncomplete(view) {
    const repair = detected.get(view.agent)?.repair || '';
    view.error = view.agent + ' is not installed completely, so it does not start.';
    say(
      view,
      view.error + (repair ? ' Reinstall it in PowerShell, then press Enter:' : ''),
      'error'
    );
    if (repair)
      view.term.writeln(
        '\x1b[31m' + (window.tnaiPlatform?.win === false ? '$ ' : 'PS> ') + repair + '\x1b[0m'
      );
  }

  // Notes under a restored session go below its last drawn line in plain colors: a full-screen CLI
  // (Claude Code's input box, OpenCode) leaves its cursor mid-screen and its own background set, so
  // notes written there landed on top of its screen. A session that ends
  // while the app is open gets its note the same way (it used to be
  // written at the cursor, over Claude Code's input box and status line). Then every view of the
  // pane settles (createTerm tnaiSettle).
  // A pane closed or remounted meanwhile (its restore or exit note was still waiting on a write)
  // gets nothing: its terminal is disposed, and writing into it touched a dead buffer and renderer.
  const sayBelow = (view, notes, tone) => {
    const gone = () => live.get(view.paneId) !== view || view.term.tnaiDisposed;
    if (gone()) return;
    view.term.write('', () => {
      if (gone()) return;
      const b = view.term.buffer.active;
      let y = b.length - 1;
      while (y > b.baseY && !b.getLine(y)?.translateToString(true).trim()) y--;
      view.term.write('\x1b[0m\x1b[' + Math.max(1, y - b.baseY + 1) + ';1H');
      notes.forEach(text => say(view, text, tone));
      for (const t of views) if (t.tnaiPaneId === view.paneId) t.write('', () => t.tnaiSettle?.());

      // the screen has new lines: it is read again before it is next laid out (reflowSaved)
      view.term.write('', () => {
        if (gone()) return;
        view.reflow = null;
        reflowSaved(view);
      });
    });
  };

  // A stopped session's screen in its Terminal page panel, laid out for the panel's width (132).
  // The CLI broke its lines for the width it last ran at; in a panel of another width the
  // terminal could only cut those lines at its edge, in the middle of words, and the rules round
  // the input box kept their old length. The screen is read once
  // (view.reflow; read again after the app writes a note into it) and written again whenever the
  // columns change: its last REFLOW_LIVE_ROWS rows at once, so it follows a drag, and the whole
  // of it when the width has been still for REFLOW_STILL_MS. Not while a program runs (it draws
  // itself), not on a full-screen program's screen, and not while the user has typed text
  // standing in the screen (drawTyped keeps count of those rows).
  const REFLOW_LIVE_ROWS = 300,
    REFLOW_STILL_MS = 250;

  // A look at a panel's terminal a moment after it was fitted: is it on screen with nothing to see?
  // The user's clips showed stopped agents' panels standing empty for a second or more while the
  // divider beside the Live preview was dragged; no test made it happen (six stopped panels,
  // panels restored from a saved record, a pointer moved at every frame, the GPU renderer). So the
  // app checks itself where it runs: at most every DRAW_CHECK_MS per panel, one frame after a fit,
  // it compares what the terminal holds with what can be seen, writes a line to the console when
  // the two disagree (with what it needs to tell why), and draws the terminal again. The line is
  // read from the app's log; nothing is shown to the user.
  const DRAW_CHECK_MS = 150;

  function checkDrawn(view) {
    const term = view.term;
    if (!term?.element || term.tnaiDisposed || view.drawCheck) return;
    view.drawCheck = setTimeout(() => {
      view.drawCheck = 0;
      if (term.tnaiDisposed) return;
      term.tnaiFrame(() => {
        if (term.tnaiDisposed || !term.element?.isConnected) return;
        const box = term.element.getBoundingClientRect();
        if (!(box.width > 0 && box.height > 0)) return;
        const buffer = term.buffer.active;
        let lines = 0;
        for (let y = 0; y < term.rows; y++)
          if (
            buffer
              .getLine(buffer.viewportY + y)
              ?.translateToString(true)
              .trim()
          )
            lines++;
        if (!lines) return;
        const faults = [];

        // hidden by a style somewhere between the terminal and the page
        for (let node = term.element; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (
            style.visibility === 'hidden' ||
            style.display === 'none' ||
            Number(style.opacity) < 0.05
          ) {
            faults.push(
              'hidden by <' +
                node.tagName.toLowerCase() +
                ' class="' +
                node.className +
                '"> (visibility ' +
                style.visibility +
                ', display ' +
                style.display +
                ', opacity ' +
                style.opacity +
                ')'
            );
            break;
          }
        }
        const service = term._core?._renderService;
        const renderer = service?._renderer?.value;
        const gl = renderer?._gl;
        if (service?._isPaused) faults.push('the renderer is paused (it counts as off screen)');
        if (gl) {
          if (gl.isContextLost()) faults.push('the GPU context is lost');
          else {
            // drawn now, and read in the same step: an empty canvas here cannot show text
            try {
              renderer.renderRows(0, term.rows - 1);
              const width = Math.min(gl.drawingBufferWidth, 64);
              const height = Math.min(gl.drawingBufferHeight, 64);
              const pixels = new Uint8Array(width * height * 4);
              gl.readPixels(
                0,
                gl.drawingBufferHeight - height,
                width,
                height,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                pixels
              );
              let drawn = 0;
              for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) drawn++;
              if (!drawn) faults.push('the canvas stays empty after a draw');
            } catch (error) {
              faults.push('drawing threw: ' + (error?.message || error));
            }
          }
        }
        if (!faults.length) return;
        const pane = term.element.closest('.terminal-pane');
        console.warn(
          '[tnai draw] a terminal with ' +
            lines +
            ' lines of text shows nothing: ' +
            faults.join('; ') +
            ' · ' +
            term.cols +
            ' x ' +
            term.rows +
            ', box ' +
            Math.round(box.width) +
            ' x ' +
            Math.round(box.height) +
            ', ' +
            (gl ? 'GPU' : 'DOM') +
            ' renderer, running ' +
            view.running +
            ', panel classes "' +
            (pane?.className || '') +
            '", grid classes "' +
            (pane?.parentElement?.className || '') +
            '"'
        );
        try {
          term.clearTextureAtlas?.();
          term.refresh(0, term.rows - 1);
        } catch {}
      });
    }, DRAW_CHECK_MS);
  }

  function reflowSaved(view) {
    const api = window.TnaiSavedReflow,
      term = view.term;
    checkDrawn(view);
    if (!api || !term || term.tnaiDisposed) return;
    if (view.running || view.restoring || view.replaying) {
      view.reflow = null;
      return;
    }
    if (view.typed || view.typedRows || term.buffer.active.type !== 'normal') return;
    if (!view.reflow) view.reflow = { screen: api.read(term), cols: 0, timer: 0 };
    const kept = view.reflow;
    if (!kept.screen || kept.cols === term.cols) return;
    kept.cols = term.cols;
    const whole = kept.screen.rows.length <= REFLOW_LIVE_ROWS;

    // the report's colors (75) are read again as soon as the screen stands, not 150 ms later
    const recolor = () => window.TnaiReportHighlight?.scanNow?.(term);
    api.draw(term, kept.screen, whole ? 0 : REFLOW_LIVE_ROWS).then(recolor);
    clearTimeout(kept.timer);
    if (whole) return;
    kept.timer = setTimeout(() => {
      if (view.reflow !== kept || view.running || view.typed || term.tnaiDisposed) return;
      const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
      api.draw(term, kept.screen, 0).then(recolor);
      if (atBottom) term.scrollToBottom();
    }, REFLOW_STILL_MS);
  }

  // opts: { accountId, resumeId, customAgentId, login: { email, method } for the sign-in dialog
  // (15), subagentOf + name for a delegated sub-agent (43), ownedByUser for an agent the user
  // started from the composer's New agent (11; main makes it a user-owned root with delegation
  // tools) }. A pane keeps its account, custom agent (name + skills) and ownedByUser; a new pane
  // uses the account chosen in Accounts. A new process draws through ConPTY, whose own screen
  // starts empty with the cursor at the top: it paints at those rows without erasing, so the
  // panel's own lines there ("Press Enter to start", a saved session and its notes) showed through
  // its header as overlapping text. Those rows scroll up into the history
  // first, leaving the screen blank, cursor home. Every view of the pane needs it, not only this
  // panel: the Overview focus view (99) and the Live preview drawer (33) keep their own terminal
  // with the old screen, and the new run drew its header over the old input box there (user
  // screenshot 2026-10-02). They get `tnai:pty-starting` before the process starts and write
  // startClear(their term) themselves. blind: for a view whose earlier output is still queued, so
  // its screen can't be read yet: the whole screen scrolls up, empty rows included.
  function startClear(term, blind) {
    const b = term.buffer.active,
      // a saved full-screen CLI: back to the normal screen, all of it scrolled up
      alt = blind || b.type !== 'normal';
    let y = term.rows - 1;
    if (!alt)
      while (
        y >= 0 &&
        !b
          .getLine(b.baseY + y)
          ?.translateToString(true)
          .trim()
      )
        y--;
    return (
      (alt ? '\x1b[0m\x1b[?1049l' : '') +
      '\x1b[0m' +
      (y >= 0 ? '\x1b[' + term.rows + ';1H' + '\n'.repeat(y + 1) : '') +
      '\x1b[H'
    );
  }

  function clearForStart(view) {
    view.term.write(startClear(view.term));
    window.dispatchEvent(new CustomEvent('tnai:pty-starting', { detail: { paneId: view.paneId } }));
  }

  // The conversation a stopped pane's next start resumes. view.saved is the record from before
  // Technically Not closed; a session that stopped while Technically Not stayed open has no
  // view.saved, only its own sessionId + resumable (kept current by pty:session), and starting it
  // without them opened a new conversation in a panel whose screen still showed the old one (user
  // report 2026-10-02). view.resumeFailed: its last resume ended at once with an error, so the next
  // start is a new session instead of the same failure.
  function resumeOf(view) {
    const s = view.saved || (view.mode === 'run' && !view.resumeFailed ? view : null);
    return s?.resumable && s.sessionId ? { resumeId: s.sessionId } : {};
  }

  async function start(view, mode, opts = {}) {
    if (view.running) return;
    if (view.blocked) {
      recheckBlocked(view, true);
      return;
    } // a panel whose CLI wasn't installed: mounted afresh once it is

    // A saved panel never shown has no terminal yet (lazyMount): built now, with its saved screen
    // and notes, before the start draws.
    if (view.lazy) {
      view.running = 'starting';
      paint(view);
      await view.ready();
      if (live.get(view.paneId) !== view || !view.term) return;
    }

    // Starting from the first moment: a second Enter (or a Build panel Start) during the checks
    // below is ignored, not a second CLI.
    view.running = 'starting';
    view.error = '';
    view.lateExit = null;
    view.startCalledAt = Date.now();
    paint(view);
    const accountId =
      opts.accountId ?? view.accountId ?? window.TnaiAccounts?.activeFor?.(view.agent) ?? '';
    view.accountId = accountId;
    view.customAgentId = opts.customAgentId ?? view.customAgentId ?? '';
    view.ownedByUser = !!(opts.ownedByUser ?? view.ownedByUser);
    if (view.agent !== 'Terminal') {
      await detect();
      if (live.get(view.paneId) !== view) return; // the panel closed meanwhile
      const info = detected.get(view.agent);
      if (info?.incomplete) {
        view.running = false;
        sayIncomplete(view);
        paint(view);
        return;
      }
      if (!info?.installed) {
        view.running = false;
        view.error = view.agent + ' is not installed.';
        say(view, view.error + ' Install it, then press Enter to try again.', 'error');
        paint(view);
        return;
      }

      // Only the default account's sign-in state is detected here; extra accounts sign in from
      // Accounts.
      if (!mode) mode = !accountId && info.loggedIn === false ? 'login' : 'run';

      // A delegated sub-agent never starts a sign-in flow nobody watches: it fails at once and its
      // lead is told why (43 → agent-graph spawnFailed).
      if (mode === 'login' && opts.subagentOf) {
        view.running = false;
        view.error =
          view.agent + ' is not signed in: start a thread with it and sign in, then delegate again';
        say(
          view,
          view.agent +
            ' is not signed in, so this sub-agent did not start. Start a thread with it and sign in.',
          'error'
        );
        paint(view);
        return;
      }
    }
    view.mode = mode || 'run';
    view.error = '';
    view.exitCode = null;
    view.stoppedByUser = false;
    view.running = 'starting';
    paint(view);
    if (view.mode === 'login')
      say(view, view.agent + ' is not signed in. Starting its own sign-in flow…');
    try {
      view.fit.fit();
    } catch {}
    clearForStart(view);

    // worktree: the user chose "Own worktree" for this start (35 want: picker, composer, or a
    // caller's worktree: true); the desktop side makes it once and reuses it for the pane's later
    // starts. Sub-agents: main picks (tnai_delegate `worktree`).
    const choice = window.TnaiWorktrees?.want?.({
      agent: view.agent,
      mode: view.mode,
      worktree: opts.worktree,
      subagentOf: opts.subagentOf,
    });
    const worktree =
      // { branch }: continue in that free worktree (35 "Continue in ⎇ …")
      choice === true || (choice?.branch ? { branch: String(choice.branch) } : false);
    const startTheme = window.TnaiTheme?.resolved?.() || 'light';

    // The size the process starts at. The box can resize while it starts (the grid reflows for a
    // new panel, digests apply), and the size read after the start was recorded as the pty's: the
    // program then drew for fewer rows than the terminal has, which left empty rows under its
    // input, and the real size was never sent ("same size", flushResize).
    const startCols = view.term.cols,
      startRows = view.term.rows;
    const result = await native.pty.start({
      paneId: view.paneId,
      agent: view.agent,
      mode: view.mode,
      cols: startCols,
      rows: startRows,
      theme: startTheme,
      accountId,
      resumeId: opts.resumeId || '',
      customAgentId: view.customAgentId,
      login: view.mode === 'login' ? opts.login || null : null,
      worktree,
      ...(view.mode === 'run'
        ? window.TnaiLaunchPrefs?.start(view.paneId, view.agent, !!opts.resumeId)
        : null),
      // The pane's name (a custom agent's own name) goes to main's task graph; subagentOf ties a
      // delegated sub-agent's pane to its node (desktop/agent-graph.js).
      name:
        opts.name ||
        (view.customAgentId && window.TnaiCustomAgents?.get?.(view.customAgentId)?.name) ||
        view.pane.querySelector('.terminal-pane-title')?.textContent ||
        '',
      subagentOf: opts.subagentOf || '',
      ownedByUser: view.ownedByUser,
      askTrust: opts.askTrust === true,
      // A start asked by a paired computer (47 reopen): its request's mark goes along, and main
      // starts that one panel at "Ask first" (desktop/remote-actions.js startOptions). No other
      // start carries the field.
      ...(opts.remote ? { remote: String(opts.remote) } : null),
      // A scheduled prompt's run (47 reopen): its start mark, which main turns into the schedule's
      // project folder (desktop/prompt-schedules.js takeFolder).
      ...(opts.schedule ? { schedule: String(opts.schedule) } : null),
    });

    // closed while starting: main started nothing for it (pty-service cancel generation)
    if (live.get(view.paneId) !== view) return;
    if (!result.ok && result.error?.code === 'cancelled') {
      view.running = false;
      say(view, 'Stopped before it started · press Enter to start again');
      paint(view);
      return;
    } // stopped while starting
    if (!result.ok && INCOMPLETE.test(result.error?.message || '')) {
      view.running = false;
      sayIncomplete(view);
      paint(view);
      return;
    }
    if (!result.ok) {
      view.running = false;
      view.error = result.error.message;

      // main's word that the panel is still one another computer started (47 keeps it)
      view.heldOnFail = result.held === true;
      say(view, 'Could not start: ' + view.error + ' Press Enter to try again.', 'error');
      paint(view);
      return;
    }
    Object.assign(view, {
      running: true,
      startedAt: Date.now(),
      lastOutputAt: Date.now(),
      pid: result.value.pid,
      cwd: result.value.cwd || '',
      sessionId: result.value.sessionId || '',
      resumable: !!result.value.resumable,
      title: '',
      saved: null,
      worktree: result.value.worktree || '',
      typed: '',
      resumedId: opts.resumeId || '',
      resumeFailed: false,
    });
    view.startTheme = startTheme;

    // main's word on a panel another computer started: it runs at "Ask first" (46 shows that)
    window.TnaiLaunchPrefs?.held?.(view.paneId, result.value.held === true);
    view.term.options.minimumContrastRatio = contrastFor(view.paneId);

    // a visible extra view (33) re-offers its own size on the change below
    ptySize.started(view.paneId, view.owner, startCols, startRows);

    // resized while starting: the pty gets the box's size now
    if (view.term.cols !== startCols || view.term.rows !== startRows) view.claim?.();
    paint(view);
    notify();

    // the ready PowerShell may just have been taken (or this was the session's first PowerShell):
    // the next one starts in a moment
    if (view.agent === 'Terminal') {
      shellUsed = true;
      warmShell();
    }

    // Its process ended before this reply arrived (it failed at once): handled now that the pid is
    // known.
    const early = view.lateExit;
    view.lateExit = null;
    if (early && early.pid === view.pid) handleExit(early);
  }

  // Typing into a stopped agent's panel (this pane, an extra view 33, the Agents page view 25): the
  // text is kept and shown, and Enter starts the agent again (its conversation resumed when the CLI
  // saved one) and sends the text once the agent is ready. A bare Enter only starts it, as before.
  // Backspace edits, Esc or Ctrl+C drops the typed text.
  const PASTE_MARK = /\x1b\[20[01]~/g,
    KEY_SEQ = /\x1b(\[[0-9;?<>=]*[ -\/]*[@-~]|O.)/g;

  function stoppedInput(paneId, data, term, begin) {
    const view = live.get(paneId);
    if (!view || view.running || isReport(data)) return;
    term = term || view.term;
    if (!term && data !== '\r') {
      view.ready?.();
      return;
    } // no terminal yet (lazyMount) to show typed text in: built first
    const typed = view.typed || '';
    if (data === '\r') {
      // the hint goes; the typed text stays above the new session
      if (typed) drawTyped(view, term, false, typed);
      view.typed = '';
      view.typedRows = 0;
      view.typedBox = null;
      (begin || (() => start(view, undefined, resumeOf(view))))();
      if (typed.trim()) {
        (view.queued ||= []).push(typed.trim());
        flushQueued(view);
      }
      return;
    }
    if (data === '\x7f' || data === '\b') {
      if (!typed) return;
      const chars = [...typed];
      chars.pop();
      view.typed = chars.join('');
      drawTyped(view, term, !!view.typed);
      return;
    }
    if (data === '\x1b' || data === '\x03') {
      if (typed) {
        view.typed = '';
        drawTyped(view, term, false);
      }
      return;
    }
    const text = data
      .replace(PASTE_MARK, '')
      .replace(KEY_SEQ, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
    if (!text) return;
    view.typed = typed + text;
    drawTyped(view, term, true);
  }

  // What was typed into a stopped session, drawn as one block under its last line and redrawn whole
  // on every change, so Backspace works across wrapped lines (a pasted path is often two rows) and
  // a hint says what Enter does (a paste into a stopped panel could not be
  // removed or changed). view.typedRows: rows the block took last time (moved up over to
  // redraw). A saved agent screen usually ends in its CLI's own empty input box (a prompt mark, a
  // rule under it, a status line). The text goes into that box, at its mark, and the rows under the
  // mark move down below the text; drawn under the screen's last line it sat outside the box the
  // user was typing into. view.typedBox: the box's rows as they were, put
  // back on clear.
  function drawTyped(view, term, hint, shown) {
    const cols = term.cols || 80,
      text = shown ?? view.typed ?? '';
    let out = '\x1b[0m',
      box = view.typedBox || null;
    if (view.typedRows)
      out += '\r' + (view.typedRows > 1 ? '\x1b[' + (view.typedRows - 1) + 'A' : '') + '\x1b[J';
    else if (text) {
      // first key: in the saved screen's input box, else below its last drawn line; never wherever
      // its CLI left the cursor
      const b = term.buffer.active;
      let y = b.length - 1;
      while (y > b.baseY && !b.getLine(y)?.translateToString(true).trim()) y--;
      box = view.typedBox = savedBox(term, y);
      out +=
        '\x1b[' + Math.max(1, (box ? box.y : y) - b.baseY + 1) + ';1H' + (box ? '\x1b[J' : '\r\n');
    }
    if (!text) {
      term.write(out + (box ? box.rows.join('\r\n') : ''));
      view.typedRows = 0;
      view.typedBox = null;
      return;
    }
    const mark = box ? box.mark : '›',
      pad = ' '.repeat(mark.length + 1);
    const lines = (mark + ' ' + text).split('\n').map((l, i) => (i ? pad : '') + l),
      tail = box ? box.rows.slice(1) : [];
    const note = hint
      ? '  Enter starts ' + view.agent + ' and sends this · Backspace edits · Esc clears'
      : '';
    view.typedRows =
      lines.concat(note || []).reduce((n, l) => n + Math.max(1, Math.ceil(l.length / cols)), 0) +
      tail.length;
    lines[0] = (box ? box.markAnsi : '\x1b[90m›\x1b[0m') + lines[0].slice(mark.length);
    out += lines.concat(tail, note ? '\x1b[90m' + note + '\x1b[0m' : []).join('\r\n');
    term.write(out);
  }

  // The input row of the CLI screen saved in `term`, within its last rows on screen: a row that
  // holds only a prompt mark, or a mark and the CLI's own placeholder (dim or colored text; text a
  // user typed there is plain, and such a row is left alone). { y, mark, markAnsi, rows }: its
  // buffer row, the mark with its indent (plain, and as drawn), and every row from it to `last` as
  // drawn.
  function savedBox(term, last) {
    const b = term.buffer.active;
    for (let y = last; y >= Math.max(b.baseY, last - 8); y--) {
      const line = b.getLine(y),
        found = /^(\s*[❯›>])(.*)$/.exec(line?.translateToString(true) || '');
      if (!found) continue;
      let cell,
        placeholder = true;
      for (let x = found[1].length; placeholder && x < term.cols; x++) {
        cell = line.getCell(x, cell);
        if (cell && cell.getChars().trim() && !cell.isDim() && cell.isFgDefault())
          placeholder = false;
      }

      // the lowest mark row decides: rows above it are earlier messages, not the input
      if (!placeholder) return null;
      const rows = [];
      for (let r = y; r <= last; r++) rows.push(rowAnsi(b.getLine(r), 0, term.cols));
      return { y, mark: found[1], markAnsi: rowAnsi(line, 0, found[1].length), rows };
    }
    return null;
  }

  // One buffer row from column `from` up to `to` as text with its colors and styles, trailing
  // blanks dropped.
  function rowAnsi(line, from, to) {
    let out = '',
      keep = 0,
      last = '',
      cell;
    const color = (n, rgb, palette, value) =>
      rgb
        ? [n + ';2;' + ((value >> 16) & 255) + ';' + ((value >> 8) & 255) + ';' + (value & 255)]
        : !palette
          ? []
          : value < 8
            ? [n - 8 + value]
            : value < 16
              ? [n + 44 + value]
              : [n + ';5;' + value]; // 30-37 / 90-97 (40-47 / 100-107), then 38;5;n
    for (let x = from; line && x < to; x++) {
      cell = line.getCell(x, cell);
      if (!cell) break;
      if (!cell.getWidth()) continue; // the second half of a wide character
      const sgr = [
        0,
        ...(cell.isBold() ? [1] : []),
        ...(cell.isDim() ? [2] : []),
        ...(cell.isItalic() ? [3] : []),
        ...(cell.isUnderline() ? [4] : []),
        ...(cell.isInverse() ? [7] : []),
        ...color(38, cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor()),
        ...color(48, cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor()),
      ].join(';');
      if (sgr !== last) {
        out += '\x1b[' + sgr + 'm';
        last = sgr;
      }
      const chars = cell.getChars() || ' ';
      out += chars;
      if (chars.trim() || !cell.isBgDefault() || cell.isInverse()) keep = out.length;
    }
    return out.slice(0, keep) + '\x1b[0m';
  }

  // Sends what was typed while stopped once the new process is up and ready: Claude Code when it
  // connects to Technically Not (19), other CLIs once they have drawn their prompt and gone quiet.
  // A sign-in that runs first is waited out.
  async function flushQueued(view) {
    if (view.flushing) return;
    view.flushing = true;
    const gone = () => live.get(view.paneId) !== view;
    try {
      let stoppedAt = 0;
      const until = Date.now() + 5 * 60000;
      while (Date.now() < until && !gone() && !(view.running === true && view.mode !== 'login')) {
        if (view.running) stoppedAt = 0;
        else if (!stoppedAt) stoppedAt = Date.now();
        else if (Date.now() - stoppedAt > 4000) break; // it did not start (or the sign-in failed)
        await new Promise(r => setTimeout(r, 250));
      }
      if (gone()) return;
      const ready =
        view.running === true &&
        view.mode !== 'login' &&
        (await readyFor(view, view.startCalledAt || 0));
      const text = (view.queued || []).join('\n\n');
      view.queued = [];
      if (!text || gone()) return;
      if (!ready || !window.TnaiAgents.send(view.paneId, text, { userText: text }))
        say(
          view,
          'Not sent (' +
            view.agent +
            ' is not running): ' +
            (text.length > 200 ? text.slice(0, 199) + '…' : text),
          'error'
        );
    } finally {
      view.flushing = false;
    }
  }

  async function readyFor(view, since) {
    if (
      view.agent === 'Claude Code' &&
      window.TnaiTeam?.whenReady &&
      (await window.TnaiTeam.whenReady(view.paneId, since, 60000))
    )
      return true;
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      if (live.get(view.paneId) !== view || view.running !== true) return false;

      // 2.5 s of quiet after its first output (47 whenReady / agent-graph readyByScreen): OpenCode
      // 1.18 is silent ~1.9 s mid-start and drops input sent then.
      if (view.lastOutputAt > view.startedAt && Date.now() - view.lastOutputAt > 2500) return true;
      await new Promise(r => setTimeout(r, 300));
    }
    return view.running === true;
  }

  // The facts of a session's record (pty:replay) a view keeps.
  const recFields = r => ({
    startTheme: r.theme || '',
    mode: r.mode,
    running: r.running,
    exitCode: r.exitCode,
    lastOutputAt: r.lastOutputAt,
    startedAt: r.startedAt,
    pid: r.pid,
    cwd: r.cwd || '',
    accountId: r.accountId || '',
    customAgentId: r.customAgentId || '',
    ownedByUser: !!r.ownedByUser,
    sessionId: r.sessionId || '',
    resumable: !!r.resumable,
  });

  // A saved, not-running panel restored while its box is hidden (another page, workspace or
  // project) gets no terminal: an xterm with 5,000 rows, a replay of up to 256 KB and a GPU context
  // each, for 15 offline agents at every app start, drawn for nobody. It is a
  // view with the record's facts and term: null, so its status, name and resume are reported as
  // before; the terminal is built by mount(…, from) when its box is first shown or it is started
  // (view.ready: start, restart, tail). The other views of the session (25, 99, 33) read the saved
  // screen from pty:replay themselves and never needed this one.
  function lazyMount(pane, agent, rec) {
    const paneId = pane.dataset.paneId,
      host = document.createElement('div');
    host.className = 'tnai-xterm';
    const output = pane.querySelector('.terminal-output');
    output ? output.after(host) : pane.append(host);
    pane.classList.add('tnai-live');

    // Stands in for xterm's own textarea: focus sent to the panel before its terminal exists (11
    // focusPane) is handed on to it.
    const hold = document.createElement('textarea');
    hold.tabIndex = -1;
    hold.setAttribute('aria-hidden', 'true');
    hold.style.cssText =
      'position:absolute;width:0;height:0;padding:0;border:0;opacity:0;resize:none';
    host.append(hold);

    // The title its CLI set last, as xterm's onTitleChange would leave it after the replay.
    let title = '';
    for (const m of String(rec.buffer || '').matchAll(/\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g))
      title = cleanTitle(m[1]);
    const view = {
      paneId,
      pane,
      agent,
      term: null,
      fit: { fit() {} },
      host,
      hold,
      owner: { visible: () => !!host.offsetParent },
      error: '',
      replaying: false,
      lazy: true,
      title,
      ...recFields(rec),
      running: false,
      saved: rec,
    };
    live.set(paneId, view);
    sessionsCache = null;
    view.ready = () => (view.readying ||= mount(pane, agent, false, view));
    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) view.ready();
    });
    ro.observe(host);
    view.unwatch = () => ro.disconnect();
    paint(view);
    notify();
  }

  // restore(): the panes with a process, so a hidden running pane's record is not read twice
  let restoreList = null;

  // from: a lazyMount view getting its terminal now; the same object stays the pane's view.
  async function mount(pane, agent, autostart, from) {
    const paneId = pane.dataset.paneId;
    if (!paneId || !agent) return;

    // closed before this (deferred) mount ran: no process for it
    if (closedPanes.has(paneId)) return;
    const existing = live.get(paneId);
    if (from ? existing !== from : existing && existing.agent === agent) return;
    const call = {};
    mounts.set(paneId, call);
    const stale = () => mounts.get(paneId) !== call;
    if (existing && !from) {
      retire(existing.pid);
      existing.stoppedByUser = true;
      await native.pty.stop(paneId);
      if (stale()) return;
      unmount(paneId);
    }

    // A request waiting for a new pane (TnaiAgents.open) belongs to this pane from now on, so
    // closing it answers the request.
    if (autostart && pendingOpen?.agent === agent && !pendingByPane.has(paneId)) {
      pendingByPane.set(paneId, pendingOpen);
      pendingOpen = null;
    }
    if (pendingByPane.has(paneId) && pendingByPane.get(paneId).agent !== agent)
      settlePending(paneId, 'The thread was switched to another connection.');
    if (!from && blocker(agent) && blocker(agent) !== 'Checking…') {
      settlePending(paneId, agent + ': ' + blocker(agent).toLowerCase());
      showBlocked(pane, agent);
      return;
    }
    if (!from && !autostart && restoreList && !pane.offsetParent) {
      const withProcess = await restoreList;
      if (stale()) return;
      const rec = withProcess.has(paneId) ? null : await native.pty.replay(paneId);
      if (stale()) return;
      if (rec && rec.agent === agent && rec.saved && !rec.running) {
        lazyMount(pane, agent, rec);
        return;
      }
    }
    const host = from?.host || document.createElement('div');
    host.className = 'tnai-xterm';
    const { term, fit, replay: writeReplay } = await createTerm();
    if (stale()) {
      term.dispose();
      return;
    } // the pane closed or another connection was picked meanwhile
    if (from) {
      from.unwatch?.();
      const focused = host.contains(document.activeElement);
      from.hold?.remove();
      from.hold = null;
      term.open(host);
      if (focused) term.focus();
    } else {
      const output = pane.querySelector('.terminal-output');
      output ? output.after(host) : pane.append(host);
      pane.classList.add('tnai-live');
      term.open(host);
    }
    const owner = from?.owner || { visible: () => !!host.offsetParent };
    term.tnaiPaneId = paneId; // 90: no PowerShell links in a PowerShell session's own views
    const view = from
      ? Object.assign(from, { term, fit, replaying: true })
      : {
          paneId,
          pane,
          agent,
          term,
          fit,
          host,
          owner,
          running: false,
          mode: 'run',
          exitCode: null,
          lastOutputAt: 0,
          startedAt: 0,
          error: '',
          replaying: true,
        };
    live.set(paneId, view);
    sessionsCache = null;
    view.refit = () => {
      if (!host.offsetParent || view.restoring) return;
      const size = fonts.terminal,
        wasBottom = view.lostBottom || view.atBottom;
      keepBottom(view, () => {
        if (term.options.fontSize !== size) term.options.fontSize = size;
        try {
          fit.fit();
        } catch {}
        reflowSaved(view);
      });

      // Resized while hidden (following another view), hidden at all (the page left: its viewport
      // lost its height and xterm moved the view up the scrollback), or refit on screen, while it
      // was at the newest output: kept there. xterm's viewport syncs to the new size a frame or
      // more later and can move the view up then (window resized while the page was hidden), so
      // pinned, not checked once. Held again from its first draw: xterm draws a shown-again pane
      // only once its IntersectionObserver fires, which can be many frames on. Scrolled up when it
      // was hidden: held at the line that was at its top (view.top), so coming back to the page
      // finds the same spot.
      const mark = wasBottom
        ? null
        : view.wasHidden && view.top && !view.top.isDisposed
          ? view.top
          : undefined;
      view.wasHidden = false;
      if (mark !== undefined) {
        view.lostBottom = false;
        toBottom(view, 12, mark);
        view.drawHold?.dispose();
        view.drawHold = term.onRender(() => {
          view.drawHold?.dispose();
          view.drawHold = null;
          toBottom(view, 12, mark);
        });
      }
    };

    // The line at the top of the view while scrolled up on screen, as a marker: it stays on that
    // line as output arrives, the scrollback trims or a resize reflows it. Not taken while hidden
    // (the collapsed viewport's scroll) or held (toBottom).
    const keepTop = () => {
      const b = term.buffer.active;
      if (
        b.type !== 'normal' ||
        (view.top && !view.top.isDisposed && view.top.line === b.viewportY)
      )
        return;
      view.top?.dispose();
      view.top = term.registerMarker(b.viewportY - (b.baseY + b.cursorY)) || null;
    };

    // At the newest output or scrolled up, as last seen on screen (scrolls while hidden are the
    // collapsed viewport's, not the user's, and so are those while toBottom holds the view at the
    // newest line). A wheel over the pane ends that hold: the user scrolls.
    view.atBottom = true;

    // Read once a frame, not per line of output, and not at all while the box is hidden (boxShown,
    // from watchFit's observer, stands in for offsetParent, which forces a layout: fast output
    // scrolls many times a frame on every page; typing-lag and stress-switch profiles).
    let scrollRead = 0;
    term.onScroll(() => {
      if (!scrollRead && view.boxShown !== false)
        scrollRead = term.tnaiFrame(() => {
          scrollRead = 0;
          if (view.boxShown !== false && !(view.pinFrames > 0)) {
            const b = term.buffer.active,
              at = b.viewportY >= b.baseY;
            if ((!at || at !== view.atBottom) && !host.clientHeight) return;
            view.atBottom = at;
            if (!at) keepTop();
          }
        });
    });

    // Wheel, a press (scrollbar drag, click) or a key (Shift+PgUp) in the pane ends the hold: the
    // user scrolls.
    const letGo = () => {
      if (!(view.pinFrames > 0)) return;
      view.pinFrames = 0;
      view.drawHold?.dispose();
      view.drawHold = null;
      const b = term.buffer.active;
      view.atBottom = b.viewportY >= b.baseY;
    };
    ['wheel', 'pointerdown', 'keydown'].forEach(type =>
      host.addEventListener(type, letGo, { capture: true, passive: true })
    );

    // This view drives the pty size: fitted to its own box first (it may have been following
    // another view's size).
    const claim = () => {
      if (view.running !== true || !host.offsetParent || view.restoring) return;
      view.refit();
      ptySize.claim(paneId, owner, term.cols, term.rows);
    };
    view.claim = claim;

    // Enter on a saved session (Technically Not closed or crashed while it ran) resumes its
    // conversation when the CLI kept one; text typed first is sent to it (stoppedInput). Mouse
    // reports (moves, clicks) go to the program but don't take over the pty size; only typing does.
    term.onData(data => {
      if (view.running === true) {
        if (ptySize.driver(paneId) !== owner && !isReport(data)) claim();
        noteReport(paneId, data);
        native.pty.write(paneId, data);
      } else if (!view.running) stoppedInput(paneId, data, term);
    });
    term.textarea?.addEventListener('focus', claim);

    // CLIs such as Claude Code set the terminal title to what they are working on; drop the spinner
    // glyphs.
    term.onTitleChange(raw => {
      const title = cleanTitle(raw);
      if (title !== view.title) {
        view.title = title;
        notifySoon();
      }
    });

    // Only this view's own refits offer a size; following another view's size (tnai:pty-size below)
    // must never offer it back.
    term.onResize(({ cols, rows }) => {
      if (view.running === true && !view.restoring && !view.following)
        ptySize.offer(paneId, owner, cols, rows);
    });

    // Resized or shown again (window maximized, grid reflow, back on the Terminal page): refit, and
    // this pane drives the pty size, so the program never keeps drawing for a smaller box than the
    // one on screen. Its GPU context follows the box (giveUpWhenHidden, openRenderer).
    view.unwatch = watchFit(
      host,
      () => {
        view.refit();
        claim();
      },
      shown => {
        view.boxShown = shown;
        if (!shown) view.wasHidden = true;
      },
      () => !view.running
    );
    view.refit();

    // A pane opened for a waiting request (TnaiAgents.open / openIn) starts its process whatever
    // the record says (the request branch below never reads it), so the round trip to the main
    // process is not made for it: it stood between the click and the start (35 ms measured
    // 2026-10-03, more while the main process is busy).
    const waiting = autostart && pendingByPane.get(paneId)?.agent === agent;

    // from: the record lazyMount read, so its screen is written in the task that shows it
    const replay = waiting ? null : from?.saved || (await native.pty.replay(paneId));
    if (stale()) {
      if (live.get(paneId) === view) unmount(paneId);
      return;
    } // never start a process for a pane that closed meanwhile
    view.replaying = false; // output that arrived before the reply is already in its buffer
    const request =
      autostart && pendingByPane.get(paneId)?.agent === agent ? pendingByPane.get(paneId) : null;
    if (request) pendingByPane.delete(paneId);
    let restored = null;
    if (replay && replay.agent === agent && !request) {
      // Written at its recorded sizes, then fitted back to this box (and, if running, this pane
      // drives the pty again).
      view.restoring = true;
      restored = writeReplay(replay.buffer).then(() => {
        view.restoring = false;
        view.refit();
        claim();
        if (replay.running) ptySize.repaint(paneId, term);
      });

      // start() asked for this terminal and goes on when it is ready
      const starting = from && view.running === 'starting';
      Object.assign(view, recFields(replay));
      if (starting) view.running = 'starting';
      view.term.options.minimumContrastRatio = contrastFor(paneId);
      if (replay.saved) {
        // No process: this is the pane's saved session from before Technically Not closed, crashed,
        // or reloaded.
        view.saved = replay;
        if (!starting) view.running = false;
        restored.then(() =>
          sayBelow(view, [
            replay.interrupted
              ? 'Technically Not closed while this session was running. Its output above was saved.'
              : 'Saved output from the last session.',
            replay.resumable
              ? 'Previous session saved · type a prompt and press Enter (or just Enter) to resume the conversation'
              : 'Type a prompt and press Enter (or just Enter) to start a new session (no saved conversation to resume)',
          ])
        );
      } else if (!replay.running)
        restored.then(() =>
          sayBelow(view, [
            (exitText(view) || 'Exited') + ' · type a prompt and press Enter to start again',
          ])
        );
      paint(view);
      notify();

      // A terminal built late is ready once its saved screen and the notes under it are written
      // (sayBelow writes from a write callback).
      if (from) {
        await new Promise(done => restored.then(() => term.write('', () => term.write('', done))));
        view.lazy = false;
      }
    } else if (request)
      start(view, request.mode, {
        accountId: request.accountId,
        customAgentId: request.customAgentId || '',
        login: request.login || null,
        worktree:
          request.worktree === true ||
          (request.worktree?.branch ? { branch: String(request.worktree.branch) } : false),
        subagentOf: request.subagentOf || '',
        name: request.name || '',
        resumeId: request.resumeId || '',
        ownedByUser: request.ownedByUser === true,
        askTrust: request.askTrust === true,
        ...(request.remote ? { remote: request.remote } : null),
        ...(request.schedule ? { schedule: request.schedule } : null),
      }).then(() =>
        request.resolve({
          ok: view.running === true,
          paneId,
          error: view.error || undefined,
          held: view.running !== true && view.heldOnFail === true,
        })
      );
    else if (autostart) start(view);
    else {
      term.writeln('\x1b[33m' + agent + ' · ' + describe(agent) + '\x1b[0m');
      term.writeln('\x1b[33mPress Enter to start.\x1b[0m');
      paint(view);
      notify();
    }
  }

  // A request (TnaiAgents.open / openIn) waiting for this pane gets its answer when the pane closes
  // or can't start, never hangs.
  function settlePending(paneId, error) {
    const request = pendingByPane.get(paneId);
    if (!request) return;
    pendingByPane.delete(paneId);
    try {
      request.resolve({ ok: false, paneId, error });
    } catch {}
  }

  // A saved panel whose CLI is not installed: a live panel that says so, not the prototype input.
  // Enter checks again.
  async function showBlocked(pane, agent) {
    const paneId = pane.dataset.paneId,
      call = mounts.get(paneId);
    const { term } = await createTerm();
    if (mounts.get(paneId) !== call || live.has(paneId) || !pane.isConnected) {
      term.dispose();
      return;
    }
    const host = document.createElement('div');
    host.className = 'tnai-xterm';
    const output = pane.querySelector('.terminal-output');
    output ? output.after(host) : pane.append(host);
    pane.classList.add('tnai-live');
    term.open(host);
    const view = {
      paneId,
      pane,
      agent,
      term,
      fit: { fit() {} },
      host,
      owner: { visible: () => false },
      running: false,
      mode: 'run',
      exitCode: null,
      lastOutputAt: 0,
      startedAt: 0,
      error: agent + ' is ' + blocker(agent).toLowerCase() + '.',
      replaying: false,
      blocked: true,
    };
    live.set(paneId, view);
    sessionsCache = null;
    if (detected.get(agent)?.incomplete) sayIncomplete(view);
    else say(view, view.error + ' Install it, then press Enter to try again.', 'error');
    term.onData(data => {
      if (data === '\r') recheckBlocked(view, true);
    });
    paint(view);
    notify();
  }

  function recheckBlocked(view, autostart) {
    detect(true).then(() => {
      if (live.get(view.paneId) !== view) return;
      if (blocker(view.agent)) {
        say(view, view.agent + ' is still ' + blocker(view.agent).toLowerCase() + '.', 'error');
        return;
      }
      mounts.delete(view.paneId);
      unmount(view.paneId);
      mount(view.pane, view.agent, autostart);
    });
  }

  function unmount(paneId) {
    const view = live.get(paneId);
    if (!view) return;
    live.delete(paneId);
    view.unwatch?.();
    view.term?.dispose();
    view.host.remove();
    view.pane.classList.remove('tnai-live');
    notify();
  }

  // A CLI picks light or dark blocks once, when it starts (COLORFGBG from the app theme,
  // pty-service), and keeps them after a Light/Dark switch: Cursor Agent's light input bar then
  // holds light text. A session started under the other theme gets a stronger contrast floor (7,
  // 3.5 for dim text) in every view of it (10, 25, 33) until it restarts in the current theme.
  const contrastFor = paneId => {
    const t = live.get(paneId)?.startTheme;
    return t && t !== (window.TnaiTheme?.resolved?.() || 'light') ? 7 : 4.5;
  };

  // Theme switch (32): recolor open terminals in place.
  // A PowerShell kept ready for the next PowerShell panel (main pty:warm; Settings › General).
  // Asked a moment after anything that changes which one is needed: a PowerShell panel started
  // (and may have taken the ready one), the project, the theme or the setting changed.
  // Main keeps the one it has when it still fits, and ends it when the setting is off.
  // None is started while the app loads: creating its console held the
  // main process for up to 0.9 s at start. The first PowerShell of each app session starts at
  // its normal speed; from then on one is kept ready, so every later one opens at once.
  let warmTimer = 0;
  let shellUsed = false;
  const warmShell = (wait = 1500) => {
    if (!native.pty.warm || !window.tnaiPlatform?.win) return;
    const on = window.TnaiSettings?.get?.('readyShell') !== false;

    // Turning it off is always passed on; starting one waits for the first PowerShell.
    if (on && !shellUsed) return;
    clearTimeout(warmTimer);
    warmTimer = setTimeout(
      () =>
        native.pty
          .warm({
            on,
            theme: window.TnaiTheme?.resolved?.() || 'light',
          })
          .catch(() => {}),
      wait
    );
  };
  window.addEventListener('tnai:project-changed', () => warmShell());
  window.addEventListener('tnai:theme-changed', () => warmShell());
  window.addEventListener('tnai:setting-changed', event => {
    if (event.detail?.key === 'readyShell') warmShell(0);
  });
  window.addEventListener('tnai:theme-changed', () => {
    for (const v of live.values()) {
      if (!v.term) continue;
      v.term.options.theme = window.TnaiTheme?.xterm?.() || theme;
      v.term.options.minimumContrastRatio = contrastFor(v.paneId);
    }
  });

  // A− / A+: visible panes refit at the new text size and drive their pty; hidden ones refit when
  // shown (watchFit).
  window.addEventListener('tnai:terminal-font', event => {
    const from = event.detail?.from,
      place = event.detail?.place;
    if (place && place !== 'terminal') return; // another page's size: these panels keep theirs
    for (const v of live.values()) {
      const run = (v.fontFit ||= () => {
        v.refit?.();
        v.claim?.();
      });
      if (!from || v.host.contains(from)) run();
      else queueFit(window, run);
    }
  });

  // Another view (33, maybe in a pop-out window) drives the size: show the program's own width and
  // height.
  window.addEventListener('tnai:pty-size', event => {
    const d = event.detail || {},
      v = live.get(d.paneId);
    if (!v || !v.term || d.owner === v.owner || (v.term.cols === d.cols && v.term.rows === d.rows))
      return;
    v.following = true;
    try {
      keepBottom(v, () => v.term.resize(d.cols, d.rows));
    } finally {
      v.following = false;
    }
  });

  // xterm 6: a resize that removes rows leaves the view above the newest line, and scrollToBottom()
  // right after a resize does nothing (the viewport's scroll range updates next frame). Worse, a
  // pane refit when it's shown again (window resized while the page was hidden) is resized before
  // xterm un-pauses drawing: the renderer applies the new size only on un-pause, but the viewport
  // has already taken its scroll range from the old one and never retakes it, so the bottom row
  // can't be scrolled to — the view sits a row or more up and new output no longer follows. So a
  // view at the newest output before a resize is held there for the next frames, retaking the
  // viewport's range (its own queueSync, xterm 6.0 internals, guarded) whenever it's off the
  // bottom; a hidden one when it's shown (refit). mark: held at that marker's line instead (a pane
  // scrolled up, shown again; refit in mount).
  function toBottom(view, frames = 12, mark = null) {
    const holding = view.pinFrames > 0;
    view.pinFrames = frames;
    view.pinMark = mark;
    if (holding) return;

    // through the terminal's own frames, cancelled when it is disposed (createTerm)
    const nextFrame = () =>
      view.term?.tnaiFrame ? view.term.tnaiFrame(step) : requestAnimationFrame(step);
    const step = () => {
      if (!(view.pinFrames > 0)) return; // the user scrolls (letGo in mount)
      const t = view.term,
        b = t.buffer.active,
        m = view.pinMark;
      const want = !m ? b.baseY : m.isDisposed ? -1 : Math.min(m.line, b.baseY);
      if (t.element?.isConnected && want >= 0 && b.viewportY !== want) {
        try {
          t._core?._viewport?.queueSync?.();
        } catch {}
        if (m) t.scrollToLine(want);
        else t.scrollToBottom();
      }
      if (--view.pinFrames > 0) nextFrame();
      else {
        view.pinMark = null;
        view.atBottom = !t.element?.isConnected || b.viewportY >= b.baseY;
      }
    };
    nextFrame();
  }

  function keepBottom(view, resize) {
    const b = view.term.buffer.active,
      at = b.viewportY >= b.baseY;
    resize();
    if (view.pinFrames > 0 && view.pinMark) return; // held at a scrolled-up line, not the bottom
    if (at) {
      if (view.host?.offsetParent) toBottom(view);
      else if (b.viewportY < b.baseY) view.lostBottom = true;
    }
  }

  // First output after a quiet spell (a prompt was just sent): the pane turns Working now, not on
  // the next 1 s paint. A resize is not work: its size note (pty-service marks every resize with
  // OSC 7717) and the redraw right after it (ConPTY repaints the screen, CLIs redraw for the new
  // size) must not turn the panel Working. Output that keeps coming after that does.
  const SIZE_NOTE = '\x1b]7717;',
    RESIZE_REDRAW_MS = 400,
    TYPING_ECHO_MS = 600;

  // A CLI repainting its own idle chrome is not work either: Claude Code redraws "Checking for
  // updates" over and over while it sits idle, which kept idle agents Working for hours (and `tnai
  // close` refused them). Only chunks whose visible text is nothing but that are ignored.
  const ANSI = /\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
  const idleChrome = data =>
    data.length < 4096 &&
    /^(?:checking for updates\W*)+$/i.test(
      data
        .replace(ANSI, '')
        .replace(/[^\x20-\x7e]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );

  // The one answer to a program's color query (see createTerm): the palette of the terminal theme
  // in use, in xterm's own reply format (rgb:rrrr/gggg/bbbb, ended like the query). Live output
  // only, one reply per query, whether or not any view shows the session.
  const OSC_COLOR = /\x1b\](4|1[0-2]);([^\x07\x1b]*)(\x07|\x1b\\)/g;
  const BASE16 = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const DEFAULT16 = [
    '#000000',
    '#cd3131',
    '#0dbc79',
    '#e5e510',
    '#2472c8',
    '#bc3fbc',
    '#11a8cd',
    '#e5e5e5',
    '#666666',
    '#f14c4c',
    '#23d18b',
    '#f5f543',
    '#3b8eea',
    '#d670d6',
    '#29b8db',
    '#ffffff',
  ];
  const rgbOf = value => {
    const s = String(value || '').trim(),
      h = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(s);
    if (h) {
      const x = h[1].length === 3 ? h[1].replace(/./g, c => c + c) : h[1];
      return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
    }
    const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  };

  function paletteColor(t, n) {
    if (n < 16)
      return (
        rgbOf(
          t[n > 7 ? 'bright' + BASE16[n - 8][0].toUpperCase() + BASE16[n - 8].slice(1) : BASE16[n]]
        ) || rgbOf(DEFAULT16[n])
      );
    if (n < 232) {
      const v = [0, 95, 135, 175, 215, 255],
        i = n - 16;
      return [v[Math.floor(i / 36)], v[Math.floor(i / 6) % 6], v[i % 6]];
    }
    if (n < 256) {
      const g = 8 + 10 * (n - 232);
      return [g, g, g];
    }
    return null;
  }

  // CLIs paint some backgrounds in fixed neutral grays made for a plain black terminal (Claude
  // Code's prompt bar and input rules), which showed as off-color blocks on the tinted dark theme.
  // On a dark theme each neutral-gray background (truecolor or 256-color gray) is re-mixed from the
  // terminal's own background and text colors at the same lightness: it keeps its lift but takes
  // the theme's hue, and a gray at or below the background's lightness becomes the background.
  // Colors with a hue, palette 0-15 and the light theme pass unchanged.
  const SGR = /\x1b\[([\d;]*)m/g;

  function tintGrays(data, t) {
    if (!data.includes('48;')) return data;
    const bg = rgbOf(t?.background),
      fg = rgbOf(t?.foreground);
    if (!bg || !fg) return data;
    const avg = c => (c[0] + c[1] + c[2]) / 3,
      lb = avg(bg),
      lf = avg(fg);
    if (lb > 110 || lf <= lb) return data;
    const mix = c => {
      const k = Math.min(1, Math.max(0, (avg(c) - lb) / (lf - lb)));
      return bg.map((b, i) => String(Math.round(b + (fg[i] - b) * k)));
    };
    return data.replace(SGR, (seq, body) => {
      if (!body.includes('48;')) return seq;
      const p = body.split(';');
      let hit = false;
      for (let i = 0; i < p.length; i++) {
        if (p[i] === '38' || p[i] === '58') {
          i += p[i + 1] === '2' ? 4 : p[i + 1] === '5' ? 2 : 0;
          continue;
        }
        if (p[i] !== '48') continue;
        const n = p[i + 1] === '2' ? 5 : p[i + 1] === '5' ? 3 : 0;
        const c =
          n === 5
            ? [+p[i + 2], +p[i + 3], +p[i + 4]]
            : n === 3 && +p[i + 2] >= 16
              ? paletteColor(t, +p[i + 2])
              : null;
        if (c && c.every(v => v >= 0 && v <= 255) && Math.max(...c) - Math.min(...c) <= 10) {
          p.splice(i, n, '48', '2', ...mix(c));
          hit = true;
          i += 4;
        } else if (n) i += n - 1;
      }
      return hit ? '\x1b[' + p.join(';') + 'm' : seq;
    });
  }
  const rgbText = c =>
    'rgb:' +
    c
      .map(v => {
        const h = v.toString(16).padStart(2, '0');
        return h + h;
      })
      .join('/');

  function colorReplies(paneId, data) {
    if (!data.includes('\x1b]') || !data.includes('?')) return;
    const t = window.TnaiTheme?.xterm?.() || theme;
    let out = '';
    for (const [, id, body, end] of data.matchAll(OSC_COLOR)) {
      const parts = body.split(';');
      if (id === '4') {
        for (let i = 0; i + 1 < parts.length; i += 2) {
          const c = parts[i + 1] === '?' && paletteColor(t, +parts[i]);
          if (c) out += '\x1b]4;' + +parts[i] + ';' + rgbText(c) + end;
        }
        continue;
      }
      parts.forEach((p, k) => {
        // 10 foreground, 11 background, 12 cursor; "10;?;?" asks for 10 and 11
        const code = +id + k,
          c =
            p === '?' &&
            code <= 12 &&
            rgbOf(
              code === 10 ? t.foreground : code === 11 ? t.background : t.cursor || t.foreground
            );
        if (c) out += '\x1b]' + code + ';' + rgbText(c) + end;
      });
    }
    if (out) native.pty.write(paneId, out);
  }
  native.pty.onData(({ paneId, data }) => {
    colorReplies(paneId, data);
    const view = live.get(paneId);
    if (!view) return;
    if (!view.replaying) view.term?.write(data);
    const now = Date.now();

    // An agent's first 15 s of output, read by handleExit when it ends at once (an install that
    // did not finish, INCOMPLETE).
    if (view.agent !== 'Terminal' && now - (view.startedAt || 0) < 15000)
      view.firstOutput = ((view.firstOutput || '') + data).slice(-4096);
    if (data.includes(SIZE_NOTE)) view.resizedAt = now;
    if (now - Math.max(view.resizedAt || 0, view.reportedAt || 0) < RESIZE_REDRAW_MS) return;
    if (idleChrome(data)) return;

    // the CLI's last redraw of a task it reported as ended
    if (view.turnEndedAt && now - view.turnEndedAt < TURN_END_REDRAW_MS) return;

    // The echo of the user's own typing (noteReport) is not work, so writing a prompt doesn't turn
    // the panel Working. While a Claude Code turn runs (19 hooks: prompt → Stop) its output counts
    // as usual, keys or not.
    if (now - (view.typedAt || 0) < TYPING_ECHO_MS && !window.TnaiTeam?.busy?.(paneId)) return;
    view.lastOutputAt = now;
    if (view.running === true && view.pane.dataset.status !== 'working' && paint(view))
      notifySoon();
  });
  native.pty.onSession?.(({ paneId, pid, sessionId, resumable }) => {
    const view = live.get(paneId);
    if (!view || (pid && view.pid && pid !== view.pid)) return;
    view.sessionId = sessionId || '';
    view.resumable = !!resumable;
    notify();
  });

  // Processes this panel stopped to replace (connection switch, restart): their late exit is not
  // the new session's. Kept briefly: Windows reuses pids, so an entry whose exit never came must
  // not hide a later process's exit.
  const retiredPids = new Set();
  const retire = pid => {
    if (!pid) return;
    retiredPids.add(pid);
    setTimeout(() => retiredPids.delete(pid), 15000);
  };
  native.pty.onExit(event => {
    if (event.pid && retiredPids.delete(event.pid)) return;
    const view = live.get(event.paneId);
    if (!view) return;

    // Starting: the new process's pid isn't known yet; kept until start() has it (an older
    // process's exit is then dropped).
    if (view.running === 'starting') {
      view.lateExit = event;
      return;
    }
    handleExit(event);
  });

  async function handleExit({ paneId, pid, exitCode }) {
    const view = live.get(paneId);
    if (!view) return;

    // a process this pane already replaced (restart)
    if (pid && view.pid && pid !== view.pid) return;
    const wasLogin = view.mode === 'login';

    // Ended within seconds, its first output saying the install did not finish: said as that in
    // the panel and the thread (sayIncomplete, with the reinstall line), not as a plain exit, and
    // detection runs again so the pickers stop offering the CLI. Read only at an early exit, so a
    // resumed conversation that merely quotes such a text is never taken for one.
    const firstOutput = view.firstOutput || '';
    view.firstOutput = '';
    if (exitCode && Date.now() - (view.startedAt || 0) < 15000 && INCOMPLETE.test(firstOutput)) {
      view.running = false;
      view.exitCode = exitCode;
      sayIncomplete(view);
      paint(view);
      notify();
      detect(true)
        .then(notify)
        .catch(() => {});
      return;
    }

    // A resume that ended with an error within seconds (the CLI refused the conversation): not
    // tried again by the next start (resumeOf).
    if (
      view.resumedId &&
      exitCode &&
      !view.stoppedByUser &&
      Date.now() - (view.startedAt || 0) < 15000
    )
      view.resumeFailed = true;
    view.running = false;
    view.exitCode = exitCode;
    paint(view);
    notify();
    if (wasLogin && view.accountId) {
      if (!exitCode) {
        say(view, 'Sign-in finished. Starting ' + view.agent + '…');
        view.term.reset();
        start(view, 'run');
        return;
      }
      say(
        view,
        'Sign-in did not complete: ' +
          exitReason(exitCode, 'login') +
          ' (exit code ' +
          exitCode +
          '). Press Enter to try again.',
        'error'
      );
      return;
    }
    if (wasLogin) {
      const info = (await detect(true)).get(view.agent);
      if (live.get(paneId) !== view) return; // the panel closed while sign-in was checked
      if (info?.loggedIn) {
        say(
          view,
          'Signed in' +
            (info.account ? ' as ' + (window.tnaiMaskEmails || String)(info.account) : '') +
            '. Starting ' +
            view.agent +
            '…'
        );
        view.term.reset();
        start(view, 'run');
        return;
      }
      say(
        view,
        'Sign-in did not complete: ' +
          exitReason(exitCode, 'login') +
          ' (exit code ' +
          exitCode +
          '). Press Enter to try again.',
        'error'
      );
      return;
    }
    sayBelow(
      view,
      [
        view.stoppedByUser
          ? 'Stopped · type a prompt and press Enter to start again'
          : exitText(view) + ' · type a prompt and press Enter to start again',
      ],
      exitCode && !view.stoppedByUser ? 'error' : ''
    );
  }

  // A connection chosen in the picker (06 dispatches `change` on the pane's select) starts that CLI
  // in the pane.
  document.addEventListener(
    'change',
    event => {
      const select = event.target.closest?.('.terminal-provider-select');
      if (!select) return;
      const pane = select.closest('.terminal-pane');
      setTimeout(() => {
        if (select.value) mount(pane, select.value, true);
        else {
          native.pty.stop(pane.dataset.paneId);
          unmount(pane.dataset.paneId);
        }
      }, 0);
    },
    true
  );

  // A renamed pane (21) shows its new name on Overview cards right away.
  window.addEventListener('tnai:terminal-pane-renamed', notify);
  window.addEventListener('tnai:terminal-pane-closed', event => {
    const id = event.detail?.paneId;
    if (!id) return;
    closedPanes.add(id);
    mounts.delete(id);
    settlePending(id, 'The thread was closed before it started.');
    ptySize.forget(id);
    (native.pty.forget || native.pty.stop)(id);
    unmount(id);
  });
  document.getElementById('newTerminalWindow')?.addEventListener(
    'click',
    () => {
      applyAvailability();
      detect();
    },
    true
  );

  // Panes restored from the last session: reattach to a still-running process, otherwise wait for
  // Enter.
  function restore() {
    restoreList = Promise.resolve(native.pty.list?.()).then(
      list => new Set((list || []).map(s => s.paneId)),
      () => new Set()
    );
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const value = pane.querySelector('.terminal-provider-select')?.value;
      if (value) mount(pane, value, false);
    });
  }

  // A custom agent's pane is named after the agent (17 keeps the pane title in sync on rename).
  function buildSessions() {
    return [...live.values()].map(v => ({
      paneId: v.paneId,
      agent: v.agent,
      name:
        (v.customAgentId && window.TnaiCustomAgents?.get?.(v.customAgentId)?.name) ||
        v.pane.querySelector('.terminal-pane-title')?.textContent ||
        v.paneId,
      status: status(v),
      mode: v.mode,
      startedAt: v.startedAt,
      cwd: v.cwd || '',
      lastOutputAt: v.lastOutputAt,
      exitCode: v.exitCode,
      exitText: exitText(v),
      running: v.running === true,
      title: v.title || '',
      worktree: v.worktree || '',
      accountId: v.accountId || '',
      customAgentId: v.customAgentId || '',
      ownedByUser: !!v.ownedByUser,
      sessionId: v.sessionId || '',
      resumable: !!v.resumable,
      saved: !!v.saved,
      canResume: !v.running && !!resumeOf(v).resumeId,
      error: v.error || '',
    }));
  }

  window.TnaiAgents = {
    detect,
    info: () => [...detected.values()],
    describe,
    paused: id => PAUSED.has(id),
    // While onChange listeners run, every caller gets its own copy of one build (see notify): same
    // content, a fresh array and objects.
    sessions: () =>
      dispatching ? (sessionsCache ||= buildSessions()).map(s => ({ ...s })) : buildSessions(),
    // Stops the pane's process and starts it again with `accountId`, resuming its conversation when
    // the CLI saved one.
    async restart(paneId, { accountId, resume = true } = {}) {
      const view = live.get(paneId);
      if (!view) return { ok: false, resumed: false, error: 'No terminal panel ' + paneId };
      if (view.running === 'starting')
        return { ok: false, resumed: false, error: view.agent + ' is still starting' };
      if (view.lazy) await view.ready(); // its notes below need the terminal

      // its exit arrives after the new start began: not an error of the new session
      if (view.running) retire(view.pid);
      await native.pty.stop(paneId);

      // the stopped session's record says whether a conversation exists
      const saved = await native.pty.replay(paneId);
      const resumeId = resume && saved?.resumable && saved.sessionId ? saved.sessionId : '';
      if (accountId !== undefined) view.accountId = accountId;
      view.running = false;
      view.exitCode = null;
      view.error = '';
      const who =
        view.agent + (view.accountId ? ' · account ' + view.accountId : ' · default account');
      say(
        view,
        resumeId
          ? 'Restarting ' + who + ' · resuming the same conversation…'
          : 'Restarting ' +
              who +
              ' · new session' +
              (view.agent === 'Terminal' ? '' : ' (no saved conversation to resume)')
      );
      await start(view, 'run', { accountId: view.accountId, resumeId });
      return {
        ok: view.running === true,
        resumed: !!resumeId && view.running === true,
        error: view.error || undefined,
      };
    },
    // Opens a new pane on the Terminal page with this connection and starts it (mode 'login' runs
    // the CLI's sign-in; customAgentId deploys a custom agent). Waits for CLI detection first:
    // right after launch the picker cards are still disabled ("Checking…"). One new panel at a
    // time. A call made while an earlier one is still getting its panel waits for it (at most 15 s,
    // so one that never answers cannot hold the rest): the step below keeps a single request in
    // `pendingOpen`, and a second call used to take its place, so the first caller never got a
    // panel and the second got the first one's (two CLI updates pressed one after the other: one
    // update never ran, or both commands went to one terminal). Each caller gets a
    // panel of its own.
    open(agent, opts) {
      const t = window.TnaiAgents,
        before = t._opening || Promise.resolve();
      const mine = Promise.race([before, new Promise(r => setTimeout(r, 15000))]).then(() =>
        t._open(agent, opts)
      );
      t._opening = mine.catch(() => {});
      return mine;
    },
    async _open(agent, { accountId, mode, customAgentId, login, worktree } = {}) {
      if (PAUSED.has(agent))
        // says why, and never opens the picker for it
        return { ok: false, error: agent + ': ' + blocker(agent).toLowerCase() };

      // An empty pane already in the active workspace is filled first instead of adding another.
      const empty = window.TnaiTakeEmptyPane?.();
      if (empty) {
        document.querySelector('.side-item[data-view="terminal"]')?.click();
        return window.TnaiAgents.openIn(empty.id, agent, {
          accountId,
          mode,
          customAgentId,
          login,
          worktree,
        });
      }

      // the active workspace is full: the launcher would refuse and never resolve
      if (window.TnaiPaneLimit?.full()) return { ok: false, error: window.TnaiPaneLimit.message };
      if (agent !== 'Terminal') await detect();
      return new Promise(resolve => {
        pendingOpen = { agent, accountId, mode, customAgentId, login, worktree, resolve };
        document.querySelector('.side-item[data-view="terminal"]')?.click();

        // Each step goes on the moment the page has what it needs (the Terminal page shown, the
        // picker's card enabled), and waits at most the 80 ms it used to wait every time: two fixed
        // waits put 160 ms before every new panel (measured 2026-10-03, powershell-link-speed).
        const when = (ready, then) => {
          const end = performance.now() + 80,
            step = () => {
              if (ready() || performance.now() >= end) then();
              else setTimeout(step, 8);
            };
          step();
        };
        const card = () =>
          document.querySelector(
            '.terminal-provider-card[data-provider="' + CSS.escape(agent) + '"]'
          );
        when(
          () => !!document.getElementById('terminalView')?.offsetParent,
          () => {
            document.getElementById('newTerminalWindow')?.click();
            when(
              () => {
                const c = card();
                return !!c && !c.disabled;
              },
              () => {
                const c = card();
                if (c && !c.disabled) c.click();
                else {
                  pendingOpen = null;
                  resolve({ ok: false, error: agent + ' is not available on this PC.' });
                }
              }
            );
          }
        );
      });
    },
    // Starts a connection in an existing empty pane without leaving the current page or workspace
    // (the pane may be in a hidden workspace). opts: { accountId, customAgentId, subagentOf, name,
    // resumeId, ownedByUser }. Used for the sub-agent panes a custom agent delegates to (43;
    // resumeId revives a hidden sub-agent's conversation) and the composer's New agent (19
    // startLead).
    async openIn(paneId, agent, opts = {}) {
      if (agent !== 'Terminal') await detect();
      const pane = document.querySelector(
          '.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]'
        ),
        select = pane?.querySelector('.terminal-provider-select');
      if (!select) return { ok: false, error: 'No terminal panel ' + paneId };
      if (live.has(paneId) || select.value)
        return { ok: false, error: 'That thread already has a connection' };
      if (blocker(agent)) return { ok: false, error: agent + ': ' + blocker(agent).toLowerCase() };
      return new Promise(resolve => {
        pendingByPane.set(paneId, { ...opts, agent, resolve });
        select.value = agent;

        // the picker's path: 05 saves the connection, this file mounts + starts
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    },
    // Sends text to a running session followed by Enter. Agent CLIs get it as a bracketed paste so
    // multi-line tasks arrive as one message. The main process presses Enter and checks the CLI
    // took it (prompt-submit.js); a prompt left sitting in its input is said, not hidden. Agent
    // CLIs: a CLI sitting on a question holds the prompt in main until it is answered
    // (holdIfBlocked); 71 shows the held notice and, for a prompt left unsent, a one-click Enter.
    // opts.userText: the composer's own words, put back if the user cancels a held prompt.
    send(paneId, text, opts = {}) {
      const v = live.get(paneId);
      if (!v || v.running !== true) return false;
      const { userText, ...rest } = opts,
        agentCli = v.agent !== 'Terminal',
        ny = window.TnaiNeedsYou;
      if (agentCli) ny?.sent(paneId);
      native.pty
        .submit(paneId, text, {
          paste: agentCli,
          ...(agentCli && ny ? { holdIfBlocked: true } : {}),
          ...rest,
        })
        .then(r => {
          if (r && r.state === 'held' && ny)
            ny.held({
              paneId,
              heldId: r.heldId,
              reason: r.reason,
              detail: r.detail,
              userText: userText ?? text,
            });
          else if (r && r.state === 'not-submitted') {
            if (ny) ny.notSubmitted(paneId, r.error);
            else window.toast?.((v.name || v.agent) + ' did not start the message. ' + r.error);
          }
        })
        .catch(() => {});
      return true;
    },
    // Paints every pane's status now (71: a pushed needs-you change), instead of on the next 1 s
    // tick.
    repaint() {
      live.forEach(v => paint(v));
      notify();
    },
    // A stop the user asked for is not an error, even though Windows reports exit code 1 for a
    // killed process.
    stop: paneId => {
      const v = live.get(paneId);
      if (v) v.stoppedByUser = true;
      return native.pty.stop(paneId);
    },
    // Same as Enter in the pane: a saved session resumes its conversation when the CLI kept one,
    // unless resume is false (new session).
    start: (paneId, { resume = true } = {}) => {
      const v = live.get(paneId);
      if (!v || v.running) return Promise.resolve();
      return start(v, undefined, resume ? resumeOf(v) : {});
    },
    // For other views of a session (33, 25): the shared xterm setup and the pty size arbitration.
    // (paneId, text): a stopped session picked in the composer (11 'wake') starts, resuming its
    // conversation when the CLI saved one, and gets `text` once it is ready (flushQueued). false
    // when it isn't stopped.
    wake(paneId, text) {
      const v = live.get(paneId);
      if (!v || v.running || v.blocked) return false;
      (v.queued ||= []).push(text);
      start(v, undefined, resumeOf(v));
      flushQueued(v);
      return true;
    },
    // (term, blind?): the text another view of a pane writes to its own terminal on
    // `tnai:pty-starting` (33, 99)
    startClear,
    // (paneId, data, term, begin?): typing into a stopped session's view keeps the text; Enter
    // starts it and sends the text (25, 33)
    stoppedInput,
    createTerm,
    // Every open terminal view with its pane and where it sits, and a pane's recent size changes
    // (oldest first): the screen capture (110).
    views: () =>
      [...views]
        .filter(t => !t.tnaiDisposed)
        .map(term => ({ term, paneId: term.tnaiPaneId || '', where: whereOf(term) })),
    sizeHistory: paneId => (sizeLog.get(paneId) || []).slice(),
    reopen, // (term, host): move an opened terminal, possibly into another window (33)
    releaseWebgl, // (term): a parked view gives its GPU context back (33)
    useWebgl, // (term): it takes one again when shown (or waits for one to free)
    ptySize,
    watchFit,
    fontFor,
    stepFont,
    // after adding data-tnai-font buttons (33, 99): their limits and px in the tip
    paintFonts: paintFontButtons,
    maxFont: MAX_FONT, // A+ stops here (25 greys its A+ at it)
    compactFontFor,
    // mouse / focus reports: sent to the program, but they never take over the pty size (25, 33)
    isReport,
    // call before writing a view's input: the CLI's redraw answering a report doesn't turn the pane
    // Working (25, 33)
    noteReport,
    minFont: MIN_FONT,
    xtermTheme: () => window.TnaiTheme?.xterm?.() || theme,
    // minimumContrastRatio for a view of this pane (25, 33): higher when its CLI started under the
    // other theme
    contrastFor,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // a session's facts changed outside this file (37: a CLI started by hand in a terminal pane)
    changed: notify,
    // The newest n lines with words on this pane's screen, oldest first, read from its own xterm
    // buffer (104: digest rows). Rule and prompt-box lines are skipped.
    tail(paneId, n = 4) {
      const v = live.get(paneId),
        out = [];
      if (!v) return out;
      if (!v.term) {
        // a saved panel never shown (lazyMount): built now, its change notice brings the caller
        // back
        v.ready?.();
        return out;
      }
      const b = v.term.buffer.active,
        last = b.baseY + v.term.rows - 1;
      for (let y = last; y >= 0 && y > last - 120 && out.length < n; y--) {
        const text = b.getLine(y)?.translateToString(true).trim();
        if (text && /[\p{L}\p{N}]/u.test(text)) out.unshift(text);
      }
      return out;
    },
  };

  applyAvailability();
  detect(true);

  // After every script has run and the start-of-launch choice (61: restore the last session's
  // panes, or start clean) is made.
  const restoreWhenChosen = () => Promise.resolve(window.TnaiSessionStart?.ready).then(restore);
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', restoreWhenChosen, { once: true });
  else setTimeout(restoreWhenChosen, 0);
})();
