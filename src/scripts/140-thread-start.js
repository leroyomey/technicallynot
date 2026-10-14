/*
 * * Technically Not · 140-thread-start.js — the New thread start screen.
 * * Desktop app only. The thread design's start screen for a new thread: while "New thread" is on
 * (the prompt box's New agent switch, 11
 * * `TnaiLiveTasks.newAgent`), the open thread's island (120, `.tnt-view`) shows this screen in
 * * place of a conversation, over the prompt box that stays where it is:
 * * the question "What should we build in <project>?"
 * * Who works on it one button per tool that can start here (each signed-in account its own),
 * * plus tools that are not installed or not signed in, greyed with the reason,
 * * and "Your terminal", which opens the plain terminal in the side column (131)
 * * Where This folder / Own worktree, the composer's own worktree box (35), shown only
 * * when the project can make a worktree
 * * one sentence what happens on Enter, and Cancel, which turns New thread off
 * * A press on a tool chooses it the way the Agent picker under the prompt box does (46): the same
 * * two calls, `startPick` and `newAgent`, so the picker and this screen always agree. The first
 * * prompt starts the agent as its own thread (11), which turns New thread off and hides the
 * screen.
 * * Opening another thread from the list while this screen shows turns New thread off as well: the
 * * user went somewhere else. Look: src/styles/43-thread-start.css. Test: `thread-start`.
 * * `window.TnaiThreadStart` (`shown`, `paint`).
 */
(() => {
  'use strict';
  if (!window.tnaiNative) return;

  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const live = () => window.TnaiLiveTasks;
  const icon = (name, size) => safe(() => window.TnaiIcon?.(name, { size }), '');
  const logo = name => safe(() => window.TnaiCliIcons?.svg(name), '');

  // The tools a new thread can start with, in the order the rest of the app lists them (11).
  const TOOLS = ['Claude Code', 'Codex', 'Cursor Agent', 'OpenCode'];

  // ---------- the screen's parts ----------
  const root = document.createElement('section');
  root.className = 'tnt-start';
  root.hidden = true;
  root.setAttribute('aria-label', 'New thread');
  root.innerHTML =
    '<h2>What should we build in <em></em>?</h2>' +
    '<div class="tnt-start-row" role="group" aria-label="Who works on it">' +
    '<span class="tnt-start-label">Who works on it</span>' +
    '<div class="tnt-start-tools"></div></div>' +
    '<div class="tnt-start-row tnt-start-where" role="group" aria-label="Where it works">' +
    '<span class="tnt-start-label">Where</span>' +
    '<div class="tnt-menu-seg">' +
    '<button type="button" data-where="here" aria-pressed="true"' +
    ' title="The agent works right in the project folder">This folder</button>' +
    '<button type="button" data-where="own" aria-pressed="false"' +
    ' title="The agent works in a separate copy of the project on its own branch,' +
    ' so its edits stay apart from other agents until you merge them">Own worktree</button>' +
    '</div></div>' +
    '<p class="tnt-start-note"><span></span>' +
    '<button type="button" class="tnt-start-cancel">Cancel</button></p>';
  const projectEl = root.querySelector('h2 em');
  const toolsEl = root.querySelector('.tnt-start-tools');
  const whereRow = root.querySelector('.tnt-start-where');
  const noteText = root.querySelector('.tnt-start-note span');

  // ---------- what is true now ----------
  const armed = () => safe(() => !!live()?.newAgent?.(), false);

  function projectName() {
    const active = safe(() => window.TnaiProjects?.active?.(), '');
    const projects = safe(() => window.TnaiProjects?.list?.(), []);
    const lower = path => String(path || '').toLowerCase();
    const found = projects.find(entry => lower(entry.path) === lower(active));
    const lastPart = String(active || '')
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop();
    return found?.name || lastPart || 'this project';
  }

  // One entry per button: a signed-in account of a tool, or a tool that cannot start, with why.
  function toolChoices() {
    const options = safe(() => live()?.startOptions?.(), []);
    const info = safe(() => window.TnaiAgents?.info?.(), []);
    const choices = [];
    for (const tool of TOOLS) {
      const mine = options.filter(option => option.agent === tool);
      if (mine.length) {
        mine.forEach(option => choices.push({ ...option, ok: true }));
        continue;
      }
      const known = info.find(entry => entry.id === tool);
      const why = known?.installed ? 'not signed in' : 'not installed';
      choices.push({ key: tool + '|', agent: tool, accountId: '', label: tool, ok: false, why });
    }
    return choices;
  }

  // The composer's own worktree box (35); hidden there while the project cannot make one.
  const worktreeBox = () => document.getElementById('wtCompose');
  const worktreeOffered = () => {
    const box = worktreeBox();
    return !!box && !box.closest('label')?.hidden;
  };

  // ---------- painting ----------
  function paintTools() {
    const chosenAgent = safe(() => live()?.newAgent?.(), '');
    const chosenAccount = safe(() => live()?.newAccount?.(), '') || '';
    const buttons = toolChoices().map(choice => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tnt-start-tool';
      button.dataset.key = choice.key;
      const pressed =
        choice.ok &&
        choice.agent === chosenAgent &&
        (choice.accountId || '') === (choice.accountId ? chosenAccount : '');
      button.setAttribute('aria-pressed', String(pressed));
      button.disabled = !choice.ok;
      button.innerHTML = '<i class="tnt-start-logo"></i><span></span>';
      button.querySelector('i').innerHTML = logo(choice.agent);
      button.querySelector('span').textContent = choice.ok
        ? choice.label
        : choice.label + ' · ' + choice.why;
      button.title = choice.ok
        ? 'Start this thread with ' + choice.label
        : choice.agent +
          ' is ' +
          choice.why +
          (choice.why === 'not signed in' ? ': sign in from Settings › Accounts' : '');
      return button;
    });

    // The plain terminal: no agent, the user types the commands.
    const terminal = document.createElement('button');
    terminal.type = 'button';
    terminal.className = 'tnt-start-tool';
    terminal.dataset.key = 'terminal';
    terminal.setAttribute('aria-pressed', 'false');
    terminal.title = 'A plain PowerShell terminal in this folder, for your own commands';
    terminal.innerHTML = '<i class="tnt-start-logo"></i><span>Your terminal</span>';
    terminal.querySelector('i').innerHTML = icon('square-terminal', 16);
    buttons.push(terminal);

    // Kept when nothing changed, so the keyboard stays on the button it was on.
    const before = toolsEl.innerHTML;
    const next = document.createElement('div');
    next.append(...buttons);
    if (next.innerHTML === before) return;
    const focusedKey = toolsEl.contains(document.activeElement)
      ? document.activeElement.dataset.key
      : null;
    toolsEl.replaceChildren(...buttons);
    if (focusedKey) toolsEl.querySelector(`[data-key="${CSS.escape(focusedKey)}"]`)?.focus();
  }

  function paintWhere() {
    const offered = worktreeOffered();
    whereRow.hidden = !offered;
    const own = offered && !!worktreeBox()?.checked;
    whereRow.querySelectorAll('[data-where]').forEach(button => {
      const pressed = (button.dataset.where === 'own') === own;
      button.setAttribute('aria-pressed', String(pressed));
    });
  }

  function paintNote() {
    const tool = safe(() => live()?.newAgent?.(), '') || 'The agent';
    const own = worktreeOffered() && !!worktreeBox()?.checked;
    const place = own ? ' in its own worktree' : '';
    const text =
      'Type the task below and press Enter: ' +
      tool +
      ' starts' +
      place +
      ' as its own thread. Model and effort are under the prompt box.';
    if (noteText.textContent !== text) noteText.textContent = text;
  }

  function paint() {
    const island = document.querySelector('.tnt-view');
    const frame = window.TnaiThreads;
    const show = !!island && armed() && safe(() => frame?.visible?.(), false);
    if (island && root.parentNode !== island) island.append(root);
    island?.classList.toggle('tnt-starting', show);
    root.hidden = !show;
    if (!show) return;
    projectEl.textContent = projectName();
    paintTools();
    paintWhere();
    paintNote();
  }

  // ---------- what the user does ----------
  function chooseTool(button) {
    const key = button.dataset.key;
    if (key === 'terminal') {
      live()?.newAgent?.(false);
      window.TnaiThreadSide?.open?.('terminal');
      return;
    }
    const [agent, accountId] = key.split('|');
    live()?.startPick?.(agent + '|' + accountId);
    live()?.newAgent?.(agent, accountId || undefined);
    paint();
    document.getElementById('prompt')?.focus({ preventScroll: true });
  }

  function chooseWhere(button) {
    const box = worktreeBox();
    if (!box) return;
    const own = button.dataset.where === 'own';
    if (box.checked !== own) {
      box.checked = own;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    paint();
  }

  root.addEventListener('click', event => {
    const tool = event.target.closest('.tnt-start-tool');
    if (tool && !tool.disabled) {
      chooseTool(tool);
      return;
    }
    const where = event.target.closest('[data-where]');
    if (where) {
      chooseWhere(where);
      return;
    }
    if (event.target.closest('.tnt-start-cancel')) live()?.newAgent?.(false);
  });

  // A thread opened from the list while this screen shows: New thread is no longer wanted. In the
  // capture phase, before the list opens the thread, so the screen is gone when the thread shows.
  window.addEventListener(
    'click',
    event => {
      if (root.hidden) return;
      const row = event.target.closest?.('.tnt-lst .tnt-th');
      if (row && !row.dataset.remote) live()?.newAgent?.(false);
    },
    true
  );

  // ---------- following the app ----------
  [
    'tnai:new-agent-changed',
    'tnai:thread-view',
    'tnai:threads-shown',
    'tnai:threads-hidden',
    'tnai:project-changed',
  ].forEach(name => window.addEventListener(name, paint));

  // A tool signed in or out, or installed, while the screen shows.
  window.TnaiAgents?.onChange?.(() => {
    if (!root.hidden) paint();
  });
  document.addEventListener('change', event => {
    if (event.target === worktreeBox()) paint();
  });

  window.TnaiThreadStart = {
    shown: () => !root.hidden,
    paint,
  };
  paint();
})();
