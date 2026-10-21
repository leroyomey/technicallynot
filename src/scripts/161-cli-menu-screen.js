/*
 * Technically Not · 161-cli-menu-screen.js — a command that opens a menu of the CLI itself
 * (/model, /resume, /config …) shows the thread's CLI screen in the conversation's place, with one
 * line on top and "Back to the thread"; when the menu closes, the conversation comes back by
 * itself (user, 2026-10-21: "Yes, build all three", part 3 of
 * docs/plans/design-concepts/thread-commands.html).
 *
 * Such a menu is drawn only on the CLI's own screen: sent from the prompt box, the conversation
 * sat still and nothing seemed to happen. The command is known exactly (the agent event `command`
 * that desktop/main.js `pty:submit` sends for a slash command the CLI took). That the menu has
 * closed is read from the screen, as the thread list's status is: while the menu is open its
 * last lines name Esc ("Enter to confirm · Esc to exit"); once that line is gone for a moment,
 * the menu is closed. A command that prints its answer without a menu (/context) keeps the
 * screen until "Back to the thread" or the next prompt from the box.
 *
 * `window.TnaiCliMenus` (`opensScreen`, `active`, `back`). The prompt box's list (160) asks
 * `opensScreen` to say "opens the CLI screen". Look: `src/styles/29-thread-view.css`
 * (`.tnt-term-bar`). Tests: `node tools/cli-menu-screen-test.js`, desktop `cli-menu-screen`.
 */
(() => {
  'use strict';

  // Commands that open a menu or a panel on each CLI's own screen, from each vendor's docs
  // (2026-10-21). A command missing here still works; it only stays in the conversation.
  const MENUS = {
    'Claude Code': [
      '/model',
      '/resume',
      '/config',
      '/permissions',
      '/mcp',
      '/context',
      '/agents',
      '/hooks',
      '/memory',
      '/status',
      '/usage',
      '/help',
      '/doctor',
      '/export',
      '/theme',
      '/login',
      '/plugin',
      '/rewind',
      '/output-style',
    ],
    Codex: ['/model', '/permissions', '/status', '/mcp', '/diff', '/resume'],
    'Cursor Agent': ['/model', '/resume', '/help'],
    OpenCode: ['/models', '/sessions', '/themes', '/help', '/agents', '/variants'],
    'GitHub Copilot': ['/model', '/session', '/help', '/mcp'],
  };

  // A line that names Esc as the way out of a menu, as each CLI words it ("Esc to exit",
  // "Esc to cancel", "esc to go back"). "esc to interrupt" (a reply that runs) is not a menu.
  const MENU_MARK = [
    /\besc(?:ape)?\b[^\n]{0,24}?\b(?:exit|cancel|close|go back|back|dismiss)\b/i,
    /\b(?:exit|cancel|close|back|dismiss)\b[^\n]{0,12}?\besc(?:ape)?\b/i,
  ];

  // Lines only one CLI draws for its menus. OpenCode (read in its 1.19.3 program, 2026-10-21):
  // every dialog's top line is its title on the left and a bare "esc" on the right ("Select model
  // ... esc"), with nothing after it. Its own lines that are not menus put a word after "esc":
  // "esc interrupt", "esc again to interrupt" (a reply that runs), "esc normal" (shell mode).
  const MENU_MARK_OF = {
    OpenCode: [/(?:^|\s)esc(?=[ \t]*$|[ \t]{2,}\S|[ \t]*[│┃|])/im],
  };

  // How long the Esc line must be gone before the menu counts as closed (a menu redraws in
  // parts), and how long to try to hand the keyboard to the screen.
  const CLOSED_MS = 600;
  const FOCUS_TRIES_MS = 2000;

  let active = null;
  let bar = null;

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  const view = () => window.TnaiThreadView;

  function opensScreen(cli, command) {
    const name = String(command || '')
      .trim()
      .split(/\s/)[0]
      .toLowerCase();
    return !!MENUS[cli]?.includes(name);
  }

  // The line above the CLI screen, made once inside the thread view's screen box (120).
  function barEl() {
    if (bar?.isConnected) return bar;
    const term = document.querySelector('.tnt-view .tnt-term');
    if (!term) return null;
    bar = document.createElement('div');
    bar.className = 'tnt-term-bar';
    bar.hidden = true;
    bar.innerHTML =
      '<span class="tnt-term-bar-icon"></span><span class="tnt-term-bar-text"></span>' +
      '<button type="button" class="tnt-term-bar-back">Back to the thread</button>';
    bar.querySelector('.tnt-term-bar-icon').innerHTML = safe(
      () => window.TnaiIcon('square-terminal', { size: 15 }),
      ''
    );
    bar.querySelector('button').addEventListener('click', () => back());
    term.prepend(bar);
    return bar;
  }

  // The screen's last lines as text (only what is on screen now).
  function screenText(term) {
    const buffer = term?.buffer?.active;
    if (!buffer) return '';
    const lines = [];
    for (let row = 0; row < term.rows; row++)
      lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) || '');
    return lines.join('\n');
  }

  const menuOpen = (text, cli) =>
    [...MENU_MARK, ...(MENU_MARK_OF[cli] || [])].some(mark => mark.test(text));

  // The keyboard goes to the screen once it has taken its place (120 keeps a screen that has just
  // come on unseen for a moment, and a focus() before that does nothing).
  function focusScreen(paneId) {
    const until = Date.now() + FOCUS_TRIES_MS;
    const tryFocus = () => {
      if (active?.paneId !== paneId) return;
      const term = view()?.term?.();
      safe(() => term?.focus(), null);
      if (term?.element?.contains(document.activeElement)) return;
      if (Date.now() < until) setTimeout(tryFocus, 80);
    };
    tryFocus();
  }

  function start(paneId, command) {
    if (view()?.shown?.() !== paneId) return;
    const cli = safe(() => window.TnaiThreadList?.thread(paneId)?.tool, '');
    if (!opensScreen(cli, command)) return;
    stop();
    const wasMode = view().mode();
    active = {
      paneId,
      cli,
      command,
      wasMode,
      at: Date.now(),
      sawMenu: false,
      closedTimer: 0,
      off: null,
    };
    const line = barEl();
    if (line) {
      line.querySelector('.tnt-term-bar-text').innerHTML =
        '<b></b> runs on the CLI screen. Pick with ↑ ↓ and Enter, or Esc to leave it.';
      line.querySelector('b').textContent = command;
      line.hidden = false;
    }
    view().setMode('term');
    focusScreen(paneId);
    watch();
  }

  // Reads the screen each time the CLI has printed something (its output is pushed by the main
  // process, no timer). The thread view can hand the screen a new terminal a moment after the
  // switch, so the one it holds now is read each time, never one kept from the start (learned
  // 2026-10-21: a terminal kept from the start never saw the menu close).
  const READ_GAP_MS = 120;

  function check() {
    const entry = active;
    if (!entry) return;
    const shownText = () => screenText(view()?.term?.());
    if (menuOpen(shownText(), entry.cli)) {
      entry.sawMenu = true;
      clearTimeout(entry.closedTimer);
      entry.closedTimer = 0;
      return;
    }
    if (entry.sawMenu && !entry.closedTimer)
      entry.closedTimer = setTimeout(() => {
        if (active === entry && !menuOpen(shownText(), entry.cli)) finish(true);
        else if (active === entry) entry.closedTimer = 0;
      }, CLOSED_MS);
  }

  function watch() {
    const entry = active;
    if (!entry) return;
    let timer = 0;
    const off = window.tnaiNative?.pty?.onData?.(item => {
      if (active !== entry || item?.paneId !== entry.paneId || timer) return;

      // the terminal has drawn this output a moment later
      timer = setTimeout(() => {
        timer = 0;
        check();
      }, READ_GAP_MS);
    });
    entry.off = () => {
      clearTimeout(timer);
      if (typeof off === 'function') off();
    };
    setTimeout(check, READ_GAP_MS);
  }

  // Leaves the screen: the conversation comes back when it was shown before, and the prompt box
  // gets the keyboard.
  function finish(restore) {
    const entry = active;
    stop();
    if (!entry || !restore) return;
    if (view()?.shown?.() === entry.paneId && entry.wasMode === 'read') view().setMode('read');
    safe(() => document.getElementById('prompt')?.focus(), null);
  }

  // Ends the watch and hides the line, changing nothing else.
  function stop() {
    if (!active) return;
    clearTimeout(active.closedTimer);
    safe(() => active.off?.(), null);
    active = null;
    if (bar) bar.hidden = true;
  }

  // "Back to the thread": a menu still open is closed first (Esc, as the CLI itself asks), so
  // nothing waits unseen on the screen.
  function back() {
    const entry = active;
    if (!entry) return;
    const term = view()?.term?.();
    if (menuOpen(screenText(term), entry.cli))
      safe(() => window.tnaiNative?.pty?.write?.(entry.paneId, '\x1b'), null);
    finish(true);
  }

  safe(
    () =>
      window.tnaiNative?.agentEvents?.on?.(event => {
        if (event?.kind === 'command' && !event.agentId) start(event.paneId, event.command);
      }),
    null
  );

  // Another thread opened, or the user switched the view by hand: the line goes, nothing moves.
  window.addEventListener('tnai:thread-view', event => {
    if (!active) return;
    const detail = event.detail || {};
    if (detail.paneId !== active.paneId || detail.mode !== 'term') stop();
  });

  // A prompt typed in the box while the screen shows an answer: the conversation comes back. The
  // command that opened the screen is itself "a prompt sent", a moment around its start: that one
  // is not the next prompt.
  const OWN_SEND_MS = 2000;
  window.addEventListener('tnai:prompt-sent', event => {
    if (!active || event.detail?.paneId !== active.paneId) return;
    if (Date.now() - active.at < OWN_SEND_MS) return;
    finish(true);
  });

  window.TnaiCliMenus = {
    opensScreen,
    active: () => (active ? { paneId: active.paneId, command: active.command } : null),
    back,
    // for the test: whether a screen's text shows an open menu
    menuOpen,
  };
})();
