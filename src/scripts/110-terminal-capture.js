/*
 * Technically Not · 110-terminal-capture.js — Desktop only: Ctrl+Shift+Alt+C (Cmd on a Mac), or the
 * command palette's "Capture terminal screen", saves the terminal view the user is in for the "rows
 * vanish from the middle of a reply" bug: every row xterm holds (scrollback and
 * screen), which rows were on screen, the view's size and the pane's recent size changes (10's ring
 * buffer), the other views of the same pane on screen, then main adds the raw pty output and the
 * CLI's version (desktop/terminal-capture.js). One toast line says where the folder is. The view is
 * read at the key press, before any round trip, so the text is what the user saw. Nothing runs
 * until the key is pressed: two listeners only remember which terminal view was last clicked or
 * focused. window.TnaiTerminalCapture (capture, target).
 */
(() => {
  const native = window.tnaiNative,
    agents = window.TnaiAgents;
  if (!native?.pty?.capture || !agents?.views) return;
  const mac = !!window.tnaiPlatform?.mac;

  // the terminal the user last clicked or focused (the palette takes focus away before its command
  // runs)
  let last = null;
  const viewOf = el => {
    const x = el?.closest?.('.xterm');
    return x ? agents.views().find(v => v.term.element === x) || null : null;
  };
  const remember = event => {
    const v = viewOf(event.target);
    if (v) last = v.term;
  };
  document.addEventListener('pointerdown', remember, true);
  document.addEventListener('focusin', remember, true);
  const shown = v => !!v.term.element?.offsetParent;

  // The view the user is in: the focused terminal, else the one last clicked while it is still on
  // screen, else the first on screen.
  function target() {
    const all = agents.views().filter(v => v.paneId),
      focused = viewOf(document.activeElement);
    if (focused?.paneId) return focused;
    const prev = all.find(v => v.term === last);
    return (prev && shown(prev) ? prev : null) || all.find(shown) || prev || null;
  }

  function read(v) {
    const t = v.term,
      b = t.buffer.active,
      rows = [],
      wrapped = [],
      box = t.element?.parentElement;
    for (let y = 0; y < b.length; y++) {
      const line = b.getLine(y);
      rows.push(line ? line.translateToString(true) : '');
      if (line?.isWrapped) wrapped.push(y);
    }
    return {
      where: v.where,
      shown: shown(v),
      cols: t.cols,
      rows: t.rows,
      buffer: b.type,
      length: b.length,
      baseY: b.baseY,
      viewportY: b.viewportY,
      cursorX: b.cursorX,
      cursorY: b.cursorY,
      wrapped,
      fontSize: t.options.fontSize,
      box: box ? box.clientWidth + '×' + box.clientHeight : '',
      text: rows.join('\n'),
    };
  }

  async function capture() {
    const v = target();
    if (!v) {
      window.toast?.('No terminal to capture: click into the terminal first.');
      return { ok: false, error: 'no terminal' };
    }
    const at = Date.now();
    const views = [
      v,
      ...agents.views().filter(o => o.term !== v.term && o.paneId === v.paneId && shown(o)),
    ].map(read);
    const s = agents.sessions().find(x => x.paneId === v.paneId);
    const info = {
      paneId: v.paneId,
      cli: s?.agent || '',
      at,
      views,
      sizes: agents.sizeHistory(v.paneId),
      window: {
        size: innerWidth + '×' + innerHeight,
        zoom: devicePixelRatio,
        focused: document.hasFocus(),
      },
    };
    let r;
    try {
      r = await native.pty.capture(info);
    } catch (e) {
      r = { ok: false, error: e?.message || String(e) };
    }
    const error = r?.error?.message || r?.error;
    window.toast?.(
      r?.ok
        ? 'Terminal screen saved: ' + r.folder
        : 'Terminal screen not saved: ' + (error || 'unknown error')
    );
    return r;
  }

  // Capture phase, so the terminal (xterm, the CLI) never gets the keys.
  window.addEventListener(
    'keydown',
    event => {
      if (
        event.code !== 'KeyC' ||
        !event.shiftKey ||
        !event.altKey ||
        !(mac ? event.metaKey : event.ctrlKey)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) capture();
    },
    true
  );
  window.TnaiTerminalCapture = {
    capture,
    target,
    keys: () => [mac ? 'Cmd' : 'Ctrl', 'Shift', mac ? 'Option' : 'Alt', 'C'],
  };
})();
