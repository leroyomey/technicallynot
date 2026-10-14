// Technically Not · 136-own-terminal.js — Desktop only: the one plain terminal for the user's own
// commands, shown as the tab "Terminal" of the Threads page's side column (131).
//
// - What it is: one ordinary PowerShell session in the project's folder. It is started the first
//   time its tab is opened and keeps running after that, so what was typed is still there when
//   the column is closed and opened again. One per project: the panel that holds the session is
//   remembered by the project's folder (`tnai.own-terminal.v1`), and the app's session store
//   brings it back after a restart like any other panel.
// - What it is not: a thread. 119 leaves the session out of the thread list (`owns`), and the All
//   threads page (135) follows the list, so it is in neither.
// - How it is shown: a terminal view of its own, made the way the thread's Terminal view is made
//   (120): `createTerm`, the replay, then live output; fits from `watchFit`; the session's size
//   through `ptySize`.
//
// - Its shell: PowerShell unless the user chose another one that is on this computer (PowerShell
//   7, Command Prompt, Git Bash, WSL; the list is the main process's). The choice is remembered
//   per project (`tnai.own-terminal.shell.v1`) and told to the main process before every start.
//   The picker is 147's.
// - Command marks: PowerShell (and PowerShell 7) tells this terminal where each prompt starts
//   and how the command before it ended (the main process gives the shell that as a start
//   argument; the user's profile is not changed). A small dot at the right end of a command's
//   row says how it ended: quiet when it worked, in the error color when it failed, the exit
//   code in its tip. The other shells send no marks and get no dots.
// - Fill: the terminal can take the open thread's place in the middle of the page and go back
//   into its tab (`fill`). The thread is only not displayed meanwhile; choosing a thread in the
//   list brings it back. The row of controls over the terminal is 147's, its links are 146's.
//
// `window.TnaiOwnTerminal`: `open()` shows the Threads page with the side column on this tab,
// `paneId()` the open project's terminal ('' when it has none yet), `shown()` whether it is on
// screen, `owns(paneId)` whether a panel is any project's own terminal, and for 131: `show(box)`
// and `focus()`. Look: src/styles/35-thread-side.css. Test: `own-terminal`.
(() => {
  'use strict';
  const native = window.tnaiNative;
  if (!native?.pty) return;

  const KEY = 'tnai.own-terminal.v1';
  const NAME = 'Your terminal';
  const agents = () => window.TnaiAgents;

  // ---------- which panel holds each project's terminal ----------
  // { the project's folder: the panel's id }
  let store = {};
  try {
    store = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {}
  }

  const projectKey = () => {
    try {
      return String(window.TnaiTerminalWorkspaces?.project?.() || '');
    } catch {
      return '';
    }
  };
  const paneId = () => store[projectKey()] || '';

  // The panel a terminal is being started in right now. It counts as the user's terminal from the
  // moment its session exists, before it is remembered, so the prompt box never lists it (46).
  let beginning = '';
  const owns = id => !!id && (id === beginning || Object.values(store).includes(id));

  function sessionOf(id) {
    try {
      return (
        agents()
          .sessions()
          .find(session => session.paneId === id) || null
      );
    } catch {
      return null;
    }
  }

  // ---------- which shell it runs ----------
  // { the project's folder: the shell's id }; no entry means PowerShell
  const SHELL_KEY = 'tnai.own-terminal.shell.v1';
  const USUAL_SHELL = 'powershell';
  let shellStore = {};
  try {
    shellStore = JSON.parse(localStorage.getItem(SHELL_KEY) || '{}') || {};
  } catch {}

  // The shells found on this computer: [{ id, name }], empty until the main process answered and
  // where there is nothing to choose (not Windows).
  let shellList = [];
  const shellId = () => {
    const chosen = shellStore[projectKey()] || USUAL_SHELL;
    return shellList.some(shell => shell.id === chosen) ? chosen : USUAL_SHELL;
  };

  // The main process starts a panel's shell; it is told which one before every start.
  async function tellShell(id) {
    if (!id || !native.pty.shellFor) return;
    await native.pty.shellFor(id, shellId()).catch(() => {});
  }

  native.pty
    .shells?.()
    .then(list => {
      shellList = Array.isArray(list) ? list : [];
      window.dispatchEvent(new CustomEvent('tnai:own-terminal-shells'));
    })
    .catch(() => {});

  const panelOf = id =>
    id ? document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(id) + '"]') : null;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // ---------- what stands in the tab ----------
  const root = document.createElement('div');
  root.className = 'tnt-ownterm';
  root.innerHTML =
    '<p class="tnt-ownterm-note" role="status" hidden></p><div class="tnt-ownterm-box"></div>';

  // What the tab says while the terminal stands in the thread's place.
  const away = document.createElement('p');
  away.className = 'tnt-ownterm-note tnt-ownterm-away';
  away.textContent =
    'The terminal fills the thread’s place. Its Fill button there brings it back here.';
  const note = root.querySelector('.tnt-ownterm-note');
  const box = root.querySelector('.tnt-ownterm-box');

  function say(text) {
    if (note.textContent !== text) note.textContent = text;
    note.hidden = !text;
  }

  // ---------- the session ----------
  // A panel that is remembered but has no session yet: after a restart the session store is still
  // bringing it back. It is waited for, so a second terminal is never started beside it.
  async function restored(id) {
    const panel = panelOf(id);
    if (!panel?.querySelector('.terminal-provider-select')?.value) return null;
    for (let tries = 0; tries < 50; tries++) {
      const session = sessionOf(id);
      if (session) return session;
      await wait(100);
    }
    return null;
  }

  // A new PowerShell session in a panel of the open workspace, started without leaving the page
  // (the way the prompt box's New agent gets its panel, 19).
  async function begin() {
    const record = window.TnaiNewTerminalPane?.({ name: NAME, quiet: true, reuseEmpty: true });
    if (!record) {
      return {
        ok: false,
        error: window.TnaiPaneLimit?.message || 'Could not start a terminal.',
      };
    }

    // 05 gives the panel its connection select; 07 moves it into its workspace
    beginning = record.id;
    await wait(0);
    await tellShell(record.id);
    return agents().openIn(record.id, 'Terminal', { name: record.name || NAME });
  }

  let starting = null;

  // The open project's terminal: the remembered one, or a new one. Gives its panel's id, or ''
  // with the reason said in the tab. A remembered one that has stopped (the app was closed, the
  // window reloaded, the user typed "exit") is started again by show(), after its saved screen
  // is drawn.
  function ensure() {
    if (starting) return starting;
    starting = (async () => {
      const key = projectKey();
      const known = store[key] || '';
      const session = known ? sessionOf(known) || (await restored(known)) : null;
      if (session) return known;
      say('Starting PowerShell…');
      const made = await begin();
      if (!made?.ok || !made.paneId) {
        beginning = '';
        say(made?.error || 'PowerShell did not start.');
        return '';
      }
      store[key] = made.paneId;
      save();
      beginning = '';

      // the session is not a thread: the list draws without it
      window.TnaiThreadList?.refresh?.();
      return made.paneId;
    })().finally(() => {
      starting = null;
    });
    return starting;
  }

  // ---------- the terminal view ----------
  let view = null;

  // A press to type that came before the view was made: remembered until it is.
  let wantsFocus = false;
  const onScreen = () => !!view?.host.offsetParent;
  const running = () => !!view && !!sessionOf(view.paneId)?.running;

  // Drawn on the island itself. The side column's island is see-through (the window's ground
  // shows in it), so a filled terminal stood in it as a box of another tone. Its background is
  // the island's own color with no strength: nothing is painted, and the colors of the text are
  // still weighed against that color.
  function termTheme() {
    const island = getComputedStyle(root).getPropertyValue('--tnt-island').trim();
    const base = agents().xtermTheme?.() || {};
    const clear = /^#[0-9a-f]{6}$/i.test(island) ? island + '00' : 'rgba(0, 0, 0, 0)';
    return { ...base, background: clear };
  }

  // xterm's own scrollToBottom does nothing right after a resize, so it is asked again on the
  // next frames.
  function toBottom(term) {
    let frames = 6;
    const step = () => {
      if (view?.term !== term) return;
      term.scrollToBottom();
      frames -= 1;
      if (frames > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Another view of the session has its size (its panel on the Terminal page, while that page is
  // on screen): take its columns and rows.
  function follow() {
    const term = view.term;
    const now = agents().ptySize?.get?.(view.paneId);
    if (now && (now.cols !== term.cols || now.rows !== term.rows)) term.resize(now.cols, now.rows);
  }

  // Fits the terminal to its box and gives the session that size.
  function fit() {
    const current = view;
    const term = current?.term;
    if (!term || current.restoring || !onScreen()) return;
    const size = agents().ptySize;
    const font = agents().fontFor?.('terminal');
    if (font && term.options.fontSize !== font) term.options.fontSize = font;
    const runs = running();
    if (runs && size?.mayDrive && !size.mayDrive(current.paneId, current.owner)) {
      follow();
      return;
    }
    const atBottom = term.buffer.active.viewportY >= term.buffer.active.baseY;
    try {
      current.fit.fit();
    } catch {}
    if (atBottom) toBottom(term);
    if (runs) size?.claim(current.paneId, current.owner, term.cols, term.rows);
  }

  function drop() {
    const current = view;
    if (!current) return;
    view = null;
    current.dead = true;
    current.unwatch?.();
    current.term?.dispose();
    current.host.remove();
  }

  function typed(current, data) {
    if (view !== current) return;
    const api = agents();

    // a stopped session: Enter starts it again with the typed text (10)
    if (!sessionOf(current.paneId)?.running) {
      api.stoppedInput?.(current.paneId, data, current.term);
      return;
    }
    api.noteReport?.(current.paneId, data);
    native.pty.write(current.paneId, data);
  }

  // ---------- command marks ----------
  // The dot of one ended command, at the right end of the row it was typed on.
  function markCommand(term, marker, code) {
    const decoration = term.registerDecoration({ marker, anchor: 'right', x: 0, width: 1 });
    if (!decoration) return;

    // 1 stands for "failed" with no code of its own (agent-registry.js)
    const words =
      code === 0
        ? 'This command ended well'
        : code === 1
          ? 'This command failed'
          : 'This command failed (exit code ' + code + ')';
    decoration.onRender(element => {
      // the terminal library sets no place for "right, no cells in": it is said here
      if (element.style.right !== '0px') element.style.right = '0px';
      if (element.classList.contains('tnt-ownterm-mark')) return;
      element.classList.add('tnt-ownterm-mark');
      element.classList.toggle('tnt-ownterm-mark-failed', code !== 0);
      element.title = words;
      element.setAttribute('aria-label', words);
    });
  }

  // The folder each terminal's shell stands in now, as its prompt last said (PowerShell's
  // wrapper sends it; a shell that sends nothing has no entry, and the row then names the
  // folder it started in).
  const folders = new Map();

  function noteFolder(id, folder) {
    if (!id || folders.get(id) === folder) return;
    folders.set(id, folder);
    window.dispatchEvent(new CustomEvent('tnai:own-terminal-folder', { detail: { paneId: id } }));
  }

  // The shell's marks (OSC 133): "B" where a prompt ends and the user types, "D;code" how the
  // command typed at the prompt before it ended. They are read here and never drawn as text.
  // The dot goes on the row the command was typed on: a prompt's first row can be full of words
  // to its right end (a long folder in a narrow column), and the dot was under them there.
  function watchMarks(term, id) {
    let promptRow = null;
    let marked = false;
    term.parser.registerOscHandler(133, data => {
      const [kind, code] = String(data).split(';');

      // "P;Cwd=<folder>": where the shell stands now, sent with every prompt. The folder is
      // everything after the equals sign (a folder's name may hold a semicolon).
      if (String(data).startsWith('P;Cwd=')) noteFolder(id, String(data).slice(6));
      if (kind === 'D' && promptRow && !promptRow.isDisposed && !marked) {
        markCommand(term, promptRow, Number(code) || 0);
        marked = true;
      }
      if (kind === 'B') {
        // a prompt nothing was run at keeps no marker
        if (promptRow && !marked) promptRow.dispose();
        promptRow = term.registerMarker(0) || null;
        marked = false;
      }
      return true;
    });
  }

  // The order that keeps the screen right: what the session wrote so far (the replay), then what
  // arrived while that was written, then live output.
  async function make(id) {
    const current = {
      paneId: id,
      term: null,
      fit: null,
      write: null,
      host: document.createElement('div'),
      owner: null,
      unwatch: null,
      ready: false,
      restoring: false,
      pending: '',
      dead: false,
      wantsFocus,
    };
    wantsFocus = false;
    current.host.className = 'tnt-ownterm-host';
    current.owner = { visible: () => view === current && !!current.host.offsetParent };
    view = current;
    box.replaceChildren(current.host);
    const made = await agents().createTerm();
    if (current.dead) {
      made.term.dispose();
      return;
    }
    const term = (current.term = made.term);
    term.tnaiPaneId = id;

    // a background with no strength is only honored when this is set before the terminal opens
    term.options.allowTransparency = true;
    term.options.theme = termTheme();
    term.options.minimumContrastRatio = agents().contrastFor?.(id) || 4.5;
    current.fit = made.fit;
    current.write = made.replay;
    term.onData(data => typed(current, data));
    term.open(current.host);
    watchMarks(term, id);

    // what is built on this terminal (its links, 146) is told that there is a new one
    window.dispatchEvent(
      new CustomEvent('tnai:own-terminal-view', { detail: { term, paneId: id } })
    );
    current.unwatch = agents().watchFit?.(current.host, fit) || null;
    const replay = await native.pty.replay(id).catch(() => null);
    if (current.dead) return;
    current.ready = true;
    current.restoring = true;
    await current.write(replay?.buffer);
    if (current.dead) return;
    current.restoring = false;
    if (current.pending) {
      const rest = current.pending;
      current.pending = '';
      term.write(rest);
    }
    say('');
    fit();
    toBottom(term);
    if (current.wantsFocus) term.focus();
  }

  // ---------- live output and the app's own events ----------
  // Output is written also while the tab is not shown: xterm does not draw a hidden terminal, and
  // the screen is right the moment the tab comes back.
  function onPtyData({ paneId: from, data }) {
    const current = view;
    if (!current?.ready || from !== current.paneId) return;
    if (current.restoring) current.pending += data;
    else current.term.write(data);
  }

  // A stopped session starts again: the old screen scrolls up out of the way first, as in its own
  // panel (10 startClear), in order with the output.
  function onPtyStarting(event) {
    const current = view;
    const api = agents();
    if (!current?.ready || event.detail?.paneId !== current.paneId || !api.startClear) return;
    if (current.restoring) current.pending += api.startClear(current.term, true);
    else current.term.write(api.startClear(current.term));
  }

  function onPtySize(event) {
    const detail = event.detail || {};
    if (view?.term && detail.paneId === view.paneId && detail.owner !== view.owner && onScreen())
      follow();
  }

  function onTheme() {
    if (!view?.term) return;
    view.term.options.theme = termTheme();
    view.term.options.minimumContrastRatio = agents().contrastFor?.(view.paneId) || 4.5;
  }

  function onFont(event) {
    const place = event.detail?.place;
    if (!place || place === 'terminal') fit();
  }

  // Its panel was closed (on the Terminal page): the project has no terminal until the tab is
  // opened again.
  function onPanelClosed(event) {
    const closed = event.detail?.paneId;
    if (!owns(closed)) return;
    for (const key of Object.keys(store)) {
      if (store[key] === closed) delete store[key];
    }
    save();
    if (view?.paneId === closed) drop();
    if (home && !home.hidden && home.isConnected) show();
  }

  // ---------- never a place the app types a prompt into ----------
  // The prompt box sends to the session that is its target (11). The user's own terminal is a
  // session too, and the picker under the prompt box and the row of agents' marks (46) list every
  // session, so a press there could aim a prompt at it. Whatever makes it the target, it is taken
  // off again at once: the app never types a prompt into the user's terminal.
  window.addEventListener('tnai:target-changed', event => {
    if (owns(event.detail?.paneId)) window.TnaiLiveTasks?.setTarget?.(null);
  });

  // ---------- shown by the side column (131) ----------
  let home = null;
  let listening = false;

  function listen() {
    if (listening) return;
    listening = true;
    native.pty.onData(onPtyData);
    window.addEventListener('tnai:pty-starting', onPtyStarting);
    window.addEventListener('tnai:pty-size', onPtySize);
    window.addEventListener('tnai:theme-changed', onTheme);
    window.addEventListener('tnai:terminal-font', onFont);
    window.addEventListener('tnai:terminal-pane-closed', onPanelClosed);

    // another project was opened: its own terminal takes the tab
    window.addEventListener('tnai:project-changed', () => {
      if (home && !home.hidden && home.isConnected) show();
    });
  }

  // ---------- Fill: the thread's place in the middle of the page ----------
  let filled = false;
  const mainSlot = () => window.TnaiThreads?.slot?.('main') || null;

  // The terminal stands in its tab, or (filled) in the middle island, where the thread is then
  // not displayed. The terminal is moved, never made again: its session and its text stay.
  function place() {
    const slot = mainSlot();
    const inMain = filled && !!slot;
    const target = inMain ? slot : home;
    slot?.classList.toggle('tnt-ownterm-filled', inMain);
    root.classList.toggle('tnt-ownterm-wide', inMain);
    if (target && root.parentNode !== target) target.append(root);
    if (!home) return;
    if (inMain && away.parentNode !== home) home.append(away);
    if (!inMain) away.remove();
  }

  function fill(want) {
    const next = want === undefined ? !filled : !!want;
    if (next === filled || (next && (!mainSlot() || !view))) return filled;
    filled = next;
    place();
    window.dispatchEvent(new CustomEvent('tnai:own-terminal-fill', { detail: { filled } }));
    view?.term?.focus();
    return filled;
  }

  // A thread chosen in the list is asked for: it gets its place back.
  window.addEventListener('tnai:threads-select', () => fill(false));

  // ---------- Clear and Restart (the buttons are 147's) ----------
  // Only what is drawn here goes: the shell is told nothing and keeps its line.
  function clear() {
    view?.term?.clear();
    view?.term?.focus();
  }

  // A new shell in the same panel and folder. The caller asks the user first when it should.
  async function restart() {
    const id = view?.paneId || paneId();
    if (!id) return false;
    await tellShell(id);

    // the new shell starts in the project's folder again, and says so at its first prompt
    folders.delete(id);
    const result = await agents().restart(id, { resume: false });
    return !!result?.ok;
  }

  // 131 calls this every time the tab is painted, so it does nothing when all is in place.
  async function show(part) {
    if (part) home = part;
    if (!home || !agents()?.createTerm) return;
    place();
    listen();
    const id = await ensure();
    if (!id) return;
    if (view && view.paneId !== id) drop();
    if (!view) await make(id);

    // Stopped: started again only now, with its saved screen already drawn. The new shell's
    // prompt then comes under the earlier output (10 scrolls the old screen up at a start), where
    // a start before the view was made showed the new shell alone.
    const session = sessionOf(id);
    if (view?.ready && session && !session.running) {
      await tellShell(id);
      await agents().start(id, { resume: false });
    }
  }

  // The user chose another shell (147's picker): remembered for this project, and the terminal
  // starts again with it. The caller asks first when a shell is running.
  async function setShell(next) {
    if (!shellList.some(shell => shell.id === next)) return false;
    if (next === USUAL_SHELL) delete shellStore[projectKey()];
    else shellStore[projectKey()] = next;
    try {
      localStorage.setItem(SHELL_KEY, JSON.stringify(shellStore));
    } catch {}
    window.dispatchEvent(new CustomEvent('tnai:own-terminal-shells'));
    if (!(view?.paneId || paneId())) return true;
    return restart();
  }

  function focus() {
    if (view?.term) view.term.focus();
    else if (view) view.wantsFocus = true;
    else wantsFocus = true;
  }

  // The three-dots menu's row (124): the Threads page, its side column on this tab, the keyboard
  // in the terminal.
  function open() {
    window.TnaiThreads?.open?.();
    window.TnaiThreadSide?.open('terminal');
    focus();
  }

  window.TnaiOwnTerminal = {
    open,
    paneId,
    shown: onScreen,
    owns,
    show,
    focus,

    // the terminal that stands in the tab now, or null
    term: () => view?.term || null,

    // for the row of controls (147): where it is built in, and what its buttons do
    root: () => root,
    session: () => sessionOf(view?.paneId || paneId()),

    // where the shell stands now ('' when the shell does not say)
    folder: () => folders.get(view?.paneId || paneId()) || '',
    clear,
    restart,
    fill,

    // the shells to choose from, the one this project's terminal runs, and choosing another
    shells: () => shellList.slice(),
    shell: () => shellId(),
    setShell,
    filled: () => filled,
  };
})();
