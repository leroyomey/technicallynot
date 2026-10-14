// Technically Not · remote-view — the watched computer's part of the live view, in the window
// (the rules are desktop/remote-view.js). Two things. (1) While the
// main process asks for a panel, because a paired computer with full control watches it, that
// panel's active screen is read from its terminal's own buffer as plain rows with style runs and
// handed over: on the terminal's write and resize events, at most once a second, and never on a
// timer while the screen is still. No control code, link or title is read: only each cell's
// characters, one of the sixteen standard colors or the default, bold and inverse. (2) The mark
// "(name) is watching" in the watched panel's header, in the look of the header's chip
// (11-terminal-purple.css); a press ends that view. Fit rule: 109 (`watching`, the last item to
// leave). Nothing here draws another computer's screen: that is the Devices page's dialog (111).
(() => {
  const native = window.tnaiNative?.remote,
    agents = window.TnaiAgents;
  if (!native?.onScreen || !agents?.views) return; // browser, or a build without the feature

  // ---- (1) the screen of a watched panel ----
  const FLOOR_MS = 1000,
    COLS = 300,
    ROWS = 100,
    RUNS = 100;
  const watched = new Map(); // paneId → { term, subs, timer, sentAt, last }

  // The panel's own view when it has one (it is written to even while its page is hidden), else any
  // view of that session.
  const termOf = paneId => {
    const all = agents.views().filter(v => v.paneId === paneId && v.term?.buffer);
    return (all.find(v => v.where === 'Terminal page panel') || all[0])?.term || null;
  };
  const MARK = /\p{M}/u;

  // How many characters a cell's text is for the other side: every code point that is no combining
  // mark (the main process counts the same way).
  const count = chars => {
    let n = 0;
    for (const ch of chars) if (!MARK.test(ch)) n++;
    return n || 1;
  };

  function read(term) {
    const b = term.buffer.active,
      rows = term.rows,
      lines = [],
      cell = b.getNullCell ? b.getNullCell() : undefined;
    for (let y = Math.max(0, rows - ROWS); y < rows; y++) {
      const line = b.getLine(b.baseY + y),
        runs = []; // the active screen: not where the user scrolled to, not the scrollback
      let text = '',
        n = 0,
        run = null;
      if (line)
        for (let x = 0; x < term.cols && n < COLS; x++) {
          const c = line.getCell(x, cell);
          if (!c || c.getWidth() === 0) continue; // the second half of a wide character

          // What this computer's own screen hides is not read out:
          // a cell drawn invisible, or with the same color in front and behind, is a space.
          const hidden =
            c.isInvisible() ||
            (!c.isFgDefault() &&
              !c.isBgDefault() &&
              c.getFgColorMode() === c.getBgColorMode() &&
              c.getFgColor() === c.getBgColor());
          const chars = hidden ? ' ' : c.getChars() || ' ',
            k = count(chars);
          const fg = c.isFgPalette() && c.getFgColor() < 16 ? c.getFgColor() : -1,
            bg = c.isBgPalette() && c.getBgColor() < 16 ? c.getBgColor() : -1,
            flags = (c.isBold() ? 1 : 0) | (c.isInverse() ? 2 : 0);
          if (fg !== -1 || bg !== -1 || flags) {
            if (run && run[0] + run[1] === n && run[2] === fg && run[3] === bg && run[4] === flags)
              run[1] += k;
            else if (runs.length < RUNS) runs.push((run = [n, k, fg, bg, flags]));
          }
          text += chars;
          n += k;
        }
      lines.push(runs.length ? [text, runs] : [text]);
    }
    return { cols: Math.min(term.cols, COLS), rows: lines.length, lines };
  }

  function send(paneId) {
    const w = watched.get(paneId);
    if (!w) return;
    w.timer = 0;
    w.sentAt = performance.now();

    // that view was let go: read another one of the session, or say there is none
    if (w.term.tnaiDisposed) return start(paneId);
    let raw = null;
    try {
      raw = read(w.term);
    } catch {
      return;
    }
    const key = JSON.stringify(raw);
    if (key === w.last) return; // the same picture: nothing is handed over
    w.last = key;
    Promise.resolve(native.screenRows(paneId, raw)).catch(() => {});
  }

  // One read at most a second, started by the terminal's own events: a still screen starts none.
  const soon = paneId => {
    const w = watched.get(paneId);
    if (!w || w.timer) return;
    w.timer = setTimeout(() => send(paneId), Math.max(0, w.sentAt + FLOOR_MS - performance.now()));
  };

  function stop(paneId) {
    const w = watched.get(paneId);
    if (!w) return;
    watched.delete(paneId);
    clearTimeout(w.timer);
    for (const d of w.subs) {
      try {
        d.dispose();
      } catch {
        /* already gone */
      }
    }
  }

  function start(paneId) {
    stop(paneId);
    const term = termOf(paneId);
    if (!term) {
      Promise.resolve(native.screenRows(paneId, null)).catch(() => {});
      return;
    } // no terminal is mounted for that panel: the view is refused
    const w = { term, subs: [], timer: 0, sentAt: -Infinity, last: '' };
    watched.set(paneId, w);
    try {
      w.subs.push(
        term.onWriteParsed(() => soon(paneId)),
        term.onResize(() => soon(paneId)),
        term.buffer.onBufferChange(() => soon(paneId))
      );
    } catch {
      /* an event this terminal does not have */
    }
    send(paneId);
  }
  native.onScreen(m => {
    if (!m || typeof m.paneId !== 'string' || !m.paneId) return;
    if (m.on === true) start(m.paneId);
    else stop(m.paneId);
  });
  window.addEventListener('tnai:terminal-pane-closed', e => {
    const id = e.detail?.paneId;
    if (id) stop(id);
  });
  agents.onChange?.(() => {
    for (const [id, w] of watched) if (w.term.tnaiDisposed) start(id);
  });

  // ---- (2) the mark on the watched panel ----
  let watching = [],
    key = '',
    queued = 0;
  const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  function paint() {
    document.querySelectorAll('.terminal-pane[data-pane-id]').forEach(pane => {
      const w = watching.find(x => x.panelId === pane.dataset.paneId),
        state = pane.querySelector('.terminal-pane-state'),
        head = pane.querySelector('.terminal-pane-head');
      let chip = pane.querySelector('.tnai-rv-chip');
      if (!w || !(state || head)) {
        chip?.remove();
        return;
      }
      if (!chip) {
        chip = document.createElement('button');
        chip.className = 'tnai-rv-chip';
        chip.type = 'button';
        chip.addEventListener('pointerdown', e => e.stopPropagation());
        chip.addEventListener('click', e => {
          e.stopPropagation();
          const peer = chip.dataset.peer,
            name = chip.dataset.name;
          if (peer)
            Promise.resolve(native.stopView(peer))
              .then(() =>
                window.toast?.(
                  'Watching by ' +
                    name +
                    ' was ended. It gets no view of this computer for 10 minutes.'
                )
              )
              .catch(() => {});
        });
        chip.append(document.createElement('span'), document.createElement('span'));
        chip.firstChild.className = 'l';
        chip.lastChild.className = 's';
        chip.lastChild.textContent = 'Watched';
        if (state) state.before(chip);
        else head.append(chip);
      }

      // The name is the one this computer gives that computer, with the end of its id (the main
      // process makes it); set as text.
      const text = w.name + ' is watching',
        tip =
          w.name +
          ' sees this terminal panel as text since ' +
          clock(w.since) +
          '. Press to end it.';

      // the long form; "Watched" beside it shows instead when the header is tight (11)
      if (chip.firstChild.textContent !== text) chip.firstChild.textContent = text;
      if (chip.title !== tip) {
        chip.title = tip;
        chip.setAttribute('aria-label', text + '. Press to end it.');
      }
      chip.dataset.peer = w.peer;
      chip.dataset.name = w.name;
    });
  }
  const schedule = () => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0;
        paint();
      });
  };
  native.on?.(s => {
    const next =
      s?.on && Array.isArray(s.watching)
        ? s.watching.filter(
            x =>
              x &&
              typeof x.panelId === 'string' &&
              typeof x.peer === 'string' &&
              typeof x.name === 'string' &&
              Number.isFinite(x.since)
          )
        : [];
    const k = JSON.stringify(next);
    if (k === key) return;
    key = k;
    watching = next;
    schedule();
  });

  // A panel that is drawn again gets its mark again: the state is in `watching`, the chip is only
  // its view.
  window.addEventListener('tnai:team-changed', () => {
    if (watching.length) schedule();
  });
  agents.onChange?.(() => {
    if (watching.length) schedule();
  });
  window.TnaiRemoteView = { read, watched: () => [...watched.keys()], paint };
})();
