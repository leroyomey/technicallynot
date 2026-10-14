// Technically Not · 33-build-terminal.js — Desktop app only: an extra working terminal view of one
// session (the Live preview page's terminal drawer, 65): live output, typing/paste/Ctrl+C to the
// process, scrollback from the replay buffer, selection/copy, start or resume when stopped, or
// start a new session. window.TnaiBuildTerminal (mount, startNew). The name is kept from the Build
// workspace page, removed 2026-10-01; the shared dot, pop-out and note styles that page used to
// define live here now.
(() => {
  const native = window.tnaiNative;
  if (!native?.pty) return;
  const agents = () => window.TnaiAgents;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));

  const style = document.createElement('style');
  style.textContent = `
/* Shared by the Live preview page (31, 65): status dots, the popped-out window body and its "Show window / Bring back" box, notes, badges. */
.bw-dot{width:8px;height:8px;border-radius:50%;background:#c5c9bf}
.bw-dot[data-s=working]{background:#6f9a4c;box-shadow:0 0 0 3px #6f9a4c22}
.bw-dot[data-s=waiting]{background:#c49a3a}.bw-dot[data-s=starting]{background:#8aa0b8}.bw-dot[data-s=error]{background:#b0473f}.bw-dot[data-s=ok]{background:#6f9a4c}
.bw-away{grid-row:1/-1;display:grid;place-content:center;justify-items:center;gap:8px;padding:12px;text-align:center;background:#fbfcf9;color:#8a8f84;font:10px/1.5 var(--pg-sans)}
.bw-away b{color:#3e4438;font:600 11px var(--pg-sans)}
.bw-away div{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.bw-away button{height:26px;padding:0 10px;border:1px solid #e1e6da;border-radius:6px;background:#fff;color:#4e5547;font:10px var(--pg-sans);cursor:pointer}
.bw-away button:hover{background:#eff4e7;border-color:#cdd9bc}
.bw-away button.primary{border-color:#d6e2c6;background:#f0f5e9;color:#46603a}
body.bw-popout-body{display:grid;min-width:0;width:auto;height:100vh;margin:0;overflow:hidden;background:#f6f7f3;color:#3a3f35}
.bw-note{margin:0;padding:14px 12px;color:#8d9288;font:10px/1.55 var(--pg-sans)}
.bw-note b{color:#53594d;font-weight:600}
.bw-note button{margin-top:8px}
.bw-badge{flex:none;padding:2px 7px;border-radius:99px;background:#f0f2ed;color:#747a6e;font:9px var(--pg-sans);white-space:nowrap}
.bw-badge[data-tone=live]{background:#eef4e6;color:#56773a}
.bw-term{position:absolute;inset:0;z-index:0;display:grid;grid-template-rows:minmax(0,1fr) auto;background:#fbfcf9}
/* The inset sits on .xterm, not the host: the fit addon subtracts the terminal element's padding but reads the host's border-box height. */
.bw-term-host{min-width:0;min-height:0;overflow:hidden}
.bw-term-host .xterm{box-sizing:border-box;height:100%;padding:6px 4px 4px 10px}.bw-term-host .xterm-viewport{background:transparent!important}
.bw-term-bar{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:7px 10px;border-top:1px solid #eceee9;background:#fff;color:#6e7467;font:10px var(--pg-sans)}
.bw-term-bar[hidden]{display:none}
.bw-term-bar b{color:#3e4438;font-weight:600}
.bw-term-bar[data-tone=error] b{color:#a45750}
.bw-term-bar button,.bw-term-new button{box-sizing:border-box;height:24px;padding:0 8px;white-space:nowrap;border:1px solid #e1e6da;border-radius:6px;background:#fff;color:#4e5547;font:10px var(--pg-sans);cursor:pointer}
.bw-term-bar button:hover,.bw-term-new button:hover{background:#eff4e7;border-color:#cdd9bc}
.bw-term-bar button.primary{border-color:#d6e2c6;background:#f0f5e9;color:#46603a}
.bw-term-bar small{color:#9a9f93}
.bw-term-new{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.bw-term-new button:disabled{opacity:.5;cursor:not-allowed}
/* Empty terminal panel: title, text and ＋ Add connection centered in the panel. */
.bw-term-chooser{box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:100%;text-align:center}
.bw-term-chooser .bw-term-new{justify-content:center}
`;
  document.head.append(style);

  // Output pushed by the desktop process goes only to the terminals showing that pane (panels and
  // parked terminals, below), looked up by pane id; dropped while a panel waits for its replay
  // (already in that buffer).
  const panes = new Set(); // mounted panels
  const sinks = new Map(); // paneId -> Set of { term, replaying }

  function sink(paneId, rec, on) {
    let set = sinks.get(paneId);
    if (on) {
      if (!set) sinks.set(paneId, (set = new Set()));
      set.add(rec);
    } else if (set) {
      set.delete(rec);
      if (!set.size) sinks.delete(paneId);
    }
  }

  // Live output that arrives while a panel writes its replay waits (backlog) and is written right
  // after it, then the panel refits: a resize or live chunk never lands in the middle of the
  // replay. Past BACKLOG_MAX the backlog is dropped and the panel replays afresh (stale). (Hidden
  // and parked terminals are written at once: xterm doesn't draw them, and holding their output
  // back lost the viewport's place and order against pty resizes.)
  const BACKLOG_MAX = 262144;
  const held = r => r.holding || r.flushing;

  function deliver(r, data) {
    if (!r.term || r.replaying) return;
    if (!held(r)) {
      r.term.write(data);
      return;
    }
    if (r.stale) return;
    r.pending.push(data);
    r.pendingSize += data.length;
    if (r.pendingSize > BACKLOG_MAX) {
      r.pending = [];
      r.pendingSize = 0;
      r.stale = true;
    }
  }

  // A pty resize meanwhile goes into the backlog too, so output before it is parsed at the old size
  // and output after it at the new one. xterm parses writes later but resizes at once, so each
  // resize runs in the write callback of the text before it.
  function resizeTo(r, cols, rows) {
    if (!r.term) return;
    if (!held(r) || r.stale) {
      fitTo(r.term, cols, rows);
      return;
    }
    const list = r.pending,
      last = list[list.length - 1];
    if (last && typeof last === 'object') {
      last.cols = cols;
      last.rows = rows;
    } else list.push({ cols, rows });
  }

  // While the backlog is parsed (flushing) new output and resizes queue behind it; r.caughtUp runs
  // when it is done.
  function catchUp(r) {
    const list = r.pending,
      term = r.term;
    r.pending = [];
    r.pendingSize = 0;
    if (!term || !list.length) {
      r.caughtUp?.();
      return;
    }
    r.flushing = true;
    let text = '';
    const flush = (size, last) => {
      term.write(text, () => {
        if (size) fitTo(term, size.cols, size.rows);
        if (!last || r.term !== term) return;
        r.flushing = false;
        if (r.pending.length && !r.stale && !held(r)) catchUp(r);
        else r.caughtUp?.();
      });
      text = '';
    };
    list.forEach(item => {
      if (typeof item === 'string') text += item;
      else flush(item, false);
    });
    flush(null, true);
  }
  native.pty.onData(({ paneId, data }) => sinks.get(paneId)?.forEach(r => deliver(r, data)));

  // A stopped session starts again: the old screen scrolls up out of the way first, as in its
  // Terminal page panel (10 startClear), in order with the output.
  window.addEventListener('tnai:pty-starting', e =>
    sinks.get(e.detail?.paneId)?.forEach(r => {
      if (r.term && !r.replaying && window.TnaiAgents?.startClear)
        deliver(r, window.TnaiAgents.startClear(r.term, held(r)));
    })
  );

  // A view's terminal outlives the view for a while (re-pointed at another session and back):
  // kept detached, still fed live output and following the pty size, and handed to the next panel
  // in this window that shows that session, so switching layouts reuses it instead of building a
  // new terminal and replaying the whole buffer.
  const PARK_MS = 90000,
    PARK_MAX = 6,
    parked = [];

  function park(rec) {
    rec.timer = setTimeout(() => drop(rec), PARK_MS);
    parked.push(rec);
    sink(rec.paneId, rec, true);
    while (parked.length > PARK_MAX) drop(parked[0]);
  }

  function drop(rec) {
    const i = parked.indexOf(rec);
    if (i >= 0) parked.splice(i, 1);
    clearTimeout(rec.timer);
    sink(rec.paneId, rec, false);
    rec.term.dispose();
  }

  function unpark(paneId, doc) {
    const rec = parked.find(r => r.paneId === paneId && r.term.element?.ownerDocument === doc);
    if (!rec) return null;
    parked.splice(parked.indexOf(rec), 1);
    clearTimeout(rec.timer);
    sink(paneId, rec, false);
    return rec;
  }
  const fitTo = (term, cols, rows) => {
    if (cols > 0 && rows > 0 && (term.cols !== cols || term.rows !== rows)) term.resize(cols, rows);
  };

  // Put an opened terminal into a host, possibly in another window (pop-out, 23): xterm 6 follows
  // the element's new window when open() is called again (the prototype's open, not 10's wrapper,
  // which would add a second context menu handler).
  function place(term, host) {
    // 10: also remakes the GPU renderer in a new window
    if (agents()?.reopen) return agents().reopen(term, host);
    if (term.element.parentNode !== host) host.replaceChildren(term.element);
    window.Terminal.prototype.open.call(term, host);
  }

  window.addEventListener('tnai:pty-size', event => {
    const d = event.detail || {};
    panes.forEach(p => {
      if (p.paneId === d.paneId) p.sized(d);
    });
    parked.forEach(r => {
      if (r.paneId === d.paneId) resizeTo(r, d.cols, d.rows);
    });
  });
  window.addEventListener('tnai:terminal-font', e => {
    const place = e.detail?.place;
    if (!place || place === 'preview') panes.forEach(p => p.drive?.(true));
  });
  window.addEventListener('tnai:theme-changed', () => {
    if (!agents()?.xtermTheme) return;

    // stronger for a CLI started under the other theme (10)
    const ratio = id => agents().contrastFor?.(id) || 4.5;
    panes.forEach(p => {
      if (p.term) {
        p.term.options.theme = agents().xtermTheme();
        p.term.options.minimumContrastRatio = ratio(p.paneId);
      }
    });
    parked.forEach(r => {
      r.term.options.theme = agents().xtermTheme();
      r.term.options.minimumContrastRatio = ratio(r.paneId);
    });
  });

  const agentLabel = id => (id === 'Terminal' ? window.tnaiShell() : id);

  // Sessions shown in the pickers: every agent or shell from every terminal workspace, even ones
  // whose tab is not open.
  function workspaceName(paneId) {
    const id = window.TnaiTerminalWorkspaceByPane?.[paneId];
    if (!id) return '';
    return window.TnaiTerminalWorkspaces?.list?.().find(w => w.id === id)?.name || '';
  }

  // A new session starts as a new pane in the current terminal workspace, then the panel follows
  // it. Started in the background (the composer's New agent path, 19 openHere): the user stays on
  // the page they are on instead of flashing to the Terminal page and back.
  async function startNew(agent) {
    const api = agents();
    if (!api?.openIn) return { ok: false, error: 'Agents are not available.' };

    // the picker's Own worktree / Continue in ⎇ … option (35)
    const choice = window.TnaiWorktrees?.want?.({ agent });
    const worktree =
      choice === true || (choice?.branch ? { branch: String(choice.branch) } : false);
    const name = window.TnaiPaneNames?.pick?.() || '';

    // an empty pane in the workspace is filled first
    const record = window.TnaiNewTerminalPane?.({ name, quiet: true, reuseEmpty: true });
    if (!record)
      return {
        ok: false,
        error: window.TnaiPaneLimit?.message || 'Could not open a thread.',
      };

    // 05 gives the pane its connection select; 07 moves it into its workspace grid
    await new Promise(resolve => setTimeout(resolve, 0));
    const result = await Promise.race([
      api.openIn(record.id, agent, { name: record.name || name, worktree }),
      new Promise(r =>
        setTimeout(
          () =>
            r({
              ok: false,
              error: agentLabel(agent) + ' did not start in time. Check its thread.',
            }),
          30000
        )
      ),
    ]);
    return result || { ok: false, error: 'Could not start ' + agentLabel(agent) };
  }

  // view (65's terminal drawer): { panel: { config: { paneId } }, body, slot, head, kind }. ctx: {
  // save, schedule, STATUS }.
  function mount(view, ctx) {
    const box = el('div', 'bw-term'),
      host = el('div', 'bw-term-host'),
      bar = el('div', 'bw-term-bar');
    bar.hidden = true;
    box.append(host, bar);
    const badge = el('span', 'bw-badge');
    badge.hidden = true;
    view.slot.append(badge);

    // A− / A+: this drawer's own text size (10, place "preview": a size
    // per page). 10 paints and handles them.
    const fontBtns = [
      [-1, 'A−', 'Smaller'],
      [1, 'A+', 'Larger'],
    ].map(([by, label, word]) => {
      const b = el('button', 'lp-btn bw-font', label);
      b.type = 'button';
      b.title = word + ' terminal text';
      b.dataset.tnaiFont = String(by);
      b.dataset.tnaiFontPlace = 'preview';
      b.hidden = true;
      view.slot.append(b);
      return b; // shown with a session, as the badge
    });
    agents()?.paintFonts?.();

    // Concept header row: agent letter avatar in the agent's own color (94 agentColor) with a
    // status dot, before the title (10-build-purple.css).
    const av = el('span', 'bw-av'),
      avDot = el('i', 'bw-sdot');
    av.hidden = true;
    av.append(document.createTextNode(''), avDot);
    view.head.querySelector('.bw-panel-title')?.before(av);
    const owner = { visible: () => !!host.offsetParent };
    const p = {
      paneId: '',
      term: null,
      fit: null,
      replaying: false,
      holding: false,
      flushing: false,
      pending: [],
      pendingSize: 0,
      stale: false,
      binding: null,
      driving: false,
      sized: () => {},
    };
    panes.add(p);
    const session = () =>
      p.paneId
        ? agents()
            ?.sessions?.()
            .find(s => s.paneId === p.paneId)
        : null;
    const size = () => agents()?.ptySize;

    // The pty size: this panel drives it when the user focuses or types in it, or when the view
    // that drove it is off screen. The panel's size is measured first (proposeDimensions) and the
    // terminal resized once to what it will show: its own size when it drives, the driver's when it
    // follows. (Fitting and then snapping back to the driver's size reflowed the whole scrollback
    // twice per update.)
    function drive(force) {
      if (!p.term) return;
      if (p.flushing) {
        p.wantDrive = true;
        p.redrive = p.redrive || !!force;
        return;
      } // after the backlog (caughtUp)
      if (!host.offsetParent || p.restoring) return;
      const fontSize = agents().compactFontFor('preview');
      if (p.term.options.fontSize !== fontSize) p.term.options.fontSize = fontSize;
      let dims = null;
      try {
        dims = p.fit.proposeDimensions();
      } catch {}

      // 2×1 is the fit addon's floor for a box with no size yet (a pop-out before its styles
      // apply): fitting to it pushed the whole screen into scrollback, so a popped-out terminal
      // showed blank rows until new output. watchFit (observe) drives it once it has a size.
      if (!(dims?.cols > 2 && dims?.rows > 1)) return;
      const sz = session()?.running ? size() : null;
      if (sz?.mayDrive && !sz.mayDrive(p.paneId, owner)) {
        p.driving = false;
        follow();
        return;
      } // the Terminal page panel owns the size (10)
      if (sz && !force && !sz.offer(p.paneId, owner, dims.cols, dims.rows)) {
        p.driving = false;
        follow();
        return;
      }
      fitTo(p.term, dims.cols, dims.rows);
      if (!sz) return;
      if (force) sz.claim(p.paneId, owner, dims.cols, dims.rows);
      p.driving = true;
    }

    // Another view drives the size: show the program's own width and height (clipped when larger
    // than this panel).
    function follow() {
      const now = size()?.get(p.paneId);
      if (p.term && now && host.offsetParent && size().followFont)
        // smaller text, never cut off (10)
        size().followFont(p.term, p.fit, agents().compactFontFor('preview'), now.cols, now.rows);
      if (p.term && now) resizeTo(p, now.cols, now.rows);
    }
    p.sized = detail => {
      if (detail.owner === owner) return;
      p.driving = false;
      follow();
    };
    p.drive = drive;

    // Resized, maximized, restored, zoomed, shown again: refit, and this panel drives the pty size
    // (the others follow), so the program never draws for a smaller box than the one on screen (10
    // debounces pty resizes, so views resized together don't thrash it). Observed from the host's
    // own window: the panel can move into a pop-out (23).
    let unwatch = null;
    const observe = () => {
      unwatch?.();
      unwatch = agents().watchFit(host, () => drive(true));
    };

    // Done replaying: write the backlog, or replay afresh if it grew past BACKLOG_MAX.
    function release() {
      if (!p.term || held(p)) return;
      if (p.stale) {
        unbind(false);
        bind().then(() => drive(false));
        return;
      }
      catchUp(p);
    }
    p.caughtUp = () => {
      if (p.stale || p.pending.length) {
        release();
        return;
      }
      if (p.wantDrive) {
        const force = p.redrive;
        p.wantDrive = p.redrive = false;
        drive(force);
      }
    };
    observe();

    // Input wiring for the terminal this panel shows (taken off again when the terminal is parked
    // or handed to another panel).
    let unwire = null;

    function wire(term, paneId) {
      const input = term.onData(data => {
        const s = session();
        if (!s) return;
        if (s.running) {
          if (!p.driving && !agents().isReport?.(data)) drive(true);
          agents().noteReport?.(paneId, data);
          native.pty.write(paneId, data);
        } // mouse / focus reports don't take over the size or turn it Working (10)
        else if (s.status !== 'starting')
          // typed text is kept; Enter starts it and sends the text (10)
          agents().stoppedInput(paneId, data, term, () => startSession(true));
      });
      const focused = () => drive(true),
        area = term.textarea;
      area?.addEventListener('focus', focused);
      unwire = () => {
        input.dispose();
        area?.removeEventListener('focus', focused);
      };
    }

    // keep: park the terminal for the next panel of this session (only a fully replayed one in the
    // main window whose session exists).
    function unbind(keep = true) {
      unwire?.();
      unwire = null;
      const term = p.term;
      if (term) {
        sink(p.paneId, p, false);
        if (
          keep &&
          !p.binding &&
          !p.replaying &&
          !p.restoring &&
          !p.flushing &&
          term.element &&
          host.ownerDocument === document &&
          session()
        ) {
          term.element.remove();
          agents()?.releaseWebgl?.(term);
          park({
            paneId: p.paneId,
            term,
            fit: p.fit,
            replaying: false,
            pending: [],
            pendingSize: 0,
          });
        } else term.dispose();
      }
      Object.assign(p, {
        binding: null,
        term: null,
        fit: null,
        paneId: '',
        driving: false,
        replaying: false,
        restoring: false,
        holding: false,
        flushing: false,
        wantDrive: false,
        redrive: false,
        pending: [],
        pendingSize: 0,
        stale: false,
      });
      host.replaceChildren();
    }

    function take(term, fit) {
      p.term = term;
      p.fit = fit;
      sink(p.paneId, p, true);
      term.tnaiPaneId = p.paneId; // 90: no PowerShell links in a PowerShell session's own views
      wire(term, p.paneId);
    }

    function bind() {
      const want = view.panel.config.paneId || '';
      if (want === p.paneId && (p.term || p.binding)) return p.binding || Promise.resolve();
      unbind();
      p.paneId = want;
      if (want) host.dataset.pane = want;
      else delete host.dataset.pane; // 44: seeing this panel counts as seeing the agent's result
      if (!want || !session()) return Promise.resolve();
      const reuse = unpark(want, host.ownerDocument);
      if (reuse) {
        take(reuse.term, reuse.fit);
        place(reuse.term, host);
        agents()?.useWebgl?.(reuse.term);
        drive(false); // the context it gave back when parked
        return Promise.resolve();
      }
      const run = (p.binding = (async () => {
        const made = await agents().createTerm();
        if (p.binding !== run) {
          made.term.dispose();
          return;
        }
        const { term, fit } = made;

        // stronger for a CLI started under the other theme (10)
        term.options.minimumContrastRatio = agents().contrastFor?.(want) || 4.5;
        p.replaying = true;
        term.open(host);
        take(term, fit); // opened first: the focus handler needs its textarea
        drive(false);
        const replay = await native.pty.replay(want).catch(() => null);
        if (p.term !== term) return;

        // IPC keeps order: output sent before the reply is in its buffer, output after it arrives
        // as pty:data
        p.replaying = false;
        p.binding = null;

        // live output meanwhile waits as backlog, written after the replay
        p.restoring = p.holding = true;

        // at its recorded sizes (10 writes it in slices), then fitted to this panel
        await made.replay(replay?.buffer);
        if (p.term !== term) return;
        p.restoring = p.holding = false;
        release();
        drive(false);

        // a full-screen CLI (OpenCode) redraws what the replayed tail lacks
        if (replay?.running) agents().ptySize?.repaint(want, term);
      })());
      return run;
    }

    function startSession(resume) {
      const s = session();
      if (!s || s.running) return;
      agents()
        .start(p.paneId, { resume })
        .then(() => {
          ctx.schedule(view.kind);
          p.term?.focus();
        });
      ctx.schedule(view.kind);
    }

    // Stopped, exited, saved (Technically Not closed while it ran), failed, or never started: real
    // start/resume controls, not a dead box.
    function paintBar(s) {
      if (s.running) {
        bar.hidden = true;
        return;
      }
      const parts = [],
        button = (label, fn, primary) => {
          const b = el('button', primary ? 'primary' : '', label);
          b.type = 'button';
          b.onclick = fn;
          parts.push(b);
        };
      bar.dataset.tone = s.status === 'error' ? 'error' : '';
      if (s.status === 'starting') parts.push(el('b', '', 'Starting ' + agentLabel(s.agent) + '…'));
      else {
        parts.push(
          el(
            'b',
            '',
            s.saved
              ? 'Saved session'
              : s.status === 'not-started'
                ? 'Not started'
                : s.status === 'error'
                  ? s.error || s.exitText || 'Stopped with an error'
                  : 'Exited'
          )
        );

        // canResume: also a session that stopped while Technically Not stayed open; "Start again"
        // alone opened a new conversation (10 resumeOf).
        if (s.canResume) {
          button('Resume conversation', () => startSession(true), true);
          button('New session', () => startSession(false));
        } else
          button(
            s.status === 'not-started' ? 'Start ' + agentLabel(s.agent) : 'Start again',
            () => startSession(false),
            true
          );
        parts.push(el('small', '', 'or press Enter in the terminal'));
      }
      const key = parts.map(n => n.textContent).join('|');
      if (bar.dataset.key !== key) {
        bar.dataset.key = key;
        bar.replaceChildren(...parts);
      }
      bar.hidden = false;
    }

    // No session chosen, or the chosen one's terminal panel was closed: pick one above, or start a
    // new one here.
    function chooser(title, text) {
      const box = el('div', 'bw-note bw-term-chooser');
      box.append(el('b', '', title), el('span', '', text));
      const row = el('div', 'bw-term-new');

      // One button; the agent or shell is chosen in the same connection picker the Terminal page
      // uses (06).
      const b = el('button', 'bw-add-connection', '＋ Add connection');
      b.type = 'button';
      b.title = 'Choose an agent or ' + window.tnaiShell() + ' and show its new session here';
      b.onclick = () =>
        window.TnaiConnectionPicker?.open(async id => {
          b.disabled = true;
          const result = await startNew(id);
          if (!result.ok) {
            b.disabled = false;
            say(result.error || 'Could not start ' + agentLabel(id));
            ctx.schedule(view.kind);
            return;
          }
          view.panel.config.paneId = result.paneId;
          ctx.save();
          bind();
          ctx.schedule(view.kind);
        }, b);
      row.append(b);
      box.append(row);
      view.body.replaceChildren(box);
    }

    return {
      rebind: bind,
      update() {
        const s = view.panel.config.paneId
          ? agents()
              ?.sessions?.()
              .find(x => x.paneId === view.panel.config.paneId)
          : null;
        av.hidden = !s;
        if (s) {
          av.firstChild.textContent = (s.name || s.agent || '?').trim().charAt(0).toUpperCase();
          av.style.background = window.TnaiAgentMarks?.agentColor?.(s.name || s.agent) || '';
          avDot.dataset.s =
            {
              working: 'work',
              background: 'work',
              starting: 'work',
              'waiting-agents': 'wait',
              waiting: 'wait',
              'needs-you': 'wait',
              error: 'err',
              exited: 'idle',
              'not-started': 'idle',
            }[s.status] || 'ready';
        }
        fontBtns.forEach(b => {
          b.hidden = !s;
        });
        badge.hidden = !s;
        if (s) {
          badge.textContent = ctx.STATUS[s.status] || s.status;
          badge.dataset.tone = s.running ? 'live' : '';
        }
        if (!view.panel.config.paneId) {
          unbind();
          chooser(
            'Choose a session',
            'Pick any agent or shell above (from any workspace), or start a new one:'
          );
          return;
        }
        if (!s) {
          unbind();
          chooser('This thread was closed', 'Choose another session above, or start a new one:');
          return;
        }
        if (box.parentNode !== view.body) view.body.replaceChildren(box);
        paintBar(s);
        bind().then(() => drive(false));
      },
      shown: () => drive(false),
      // Moved to or from a pop-out window (23 moves the panel body, terminal included): the same
      // xterm follows it into that window, keeps its scrollback and live output (no new terminal,
      // no replay), and drives the pty size there. Not opened yet: bound again there.
      moved() {
        observe();
        if (p.term?.element && host.contains(p.term.element)) {
          place(p.term, host);
          drive(true);
        } else unbind(false);
        ctx.schedule(view.kind);
      },
      focus: () => p.term?.focus(),
      destroy() {
        panes.delete(p);
        unwatch?.();
        unwatch = null;
        unbind();
        badge.remove();
        av.remove();
        fontBtns.forEach(b => b.remove());
      },
    };
  }

  // Parked terminals of sessions that are gone (pane closed) are let go at once.
  function pruneParked() {
    if (!parked.length) return;
    const live = new Set((agents()?.sessions?.() || []).map(s => s.paneId));
    parked.filter(r => !live.has(r.paneId)).forEach(drop);
  }
  const hook = () => agents()?.onChange?.(pruneParked);
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', hook, { once: true })
    : hook();

  // startNew: 65's terminal drawer ＋ too
  window.TnaiBuildTerminal = { mount, workspaceName, agentLabel, startNew };
})();
