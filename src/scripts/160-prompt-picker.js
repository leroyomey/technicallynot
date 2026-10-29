/*
 * Technically Not · 160-prompt-picker.js — the list above the prompt box for "/" and "$" (user,
 * 2026-10-21: "Yes, build all three", part 2 of docs/plans/design-concepts/thread-commands.html).
 *
 * "/" at the start of the prompt lists the open thread's CLI commands: the CLI's own (each says
 * "runs here" or, when 161 `TnaiCliMenus.opensScreen` knows it opens a menu, "opens the CLI
 * screen"), the command files the user and the project wrote for that CLI ("your command"), and
 * the skills it can be told to use with "/". "$" anywhere in the prompt lists the skills that CLI
 * reads, and picking one writes it the way that CLI understands: "$name" for Codex, "/name" for
 * the others ("/tnai-skills:name" for a library skill in Claude Code, which loads the library
 * as a plugin). The lists come from desktop/cli-commands.js when the list opens, never per key.
 *
 * "@" stays with 50-composer-mentions.js, which already lists the project's files and folders
 * (and running agents, report items and attachments); this list never opens for "@".
 *
 * Keys while the list is open: ↑ ↓ move, Enter or Tab pick, Esc closes. They are read in the
 * window's capture phase, before 11 sends on Enter, and only while the list is open and has a
 * row: a closed or empty list never takes a key from the prompt box. Look:
 * src/styles/47-prompt-picker.css. Tests: `node tools/prompt-picker-test.js`, desktop
 * `prompt-picker`.
 */
(() => {
  'use strict';

  const promptEl = document.getElementById('prompt');
  if (!promptEl || !window.tnaiNative?.cliCommands?.list) return;

  // The most rows one list shows; typing narrows it.
  const MAX_ROWS = 60;

  // What each row says happens.
  const RUNS_HERE = 'runs here';
  const OPENS_SCREEN = 'opens the CLI screen';
  const YOUR_COMMAND = 'your command';
  const SKILL_LABEL = { project: 'project skill', user: 'your skill', library: 'library skill' };

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );

  const safe = (fn, fallback) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  // The answer of cli-commands.js per CLI, kept so a list opened again paints at once while a
  // fresh answer is fetched.
  const known = new Map();

  const state = {
    el: null,
    // '/' or '$' while open
    sign: '',
    // where the typed word starts in the prompt
    start: -1,
    rows: [],
    active: 0,
    // where the Saved group starts in `rows` (194), -1 without one
    savedAt: -1,
    cli: '',
    // Esc closed the list for the word that starts here
    dismissedAt: -1,
    fetching: '',
  };

  // ---------- the open thread's CLI ----------

  function threadCli() {
    const paneId = safe(() => window.TnaiLiveTasks?.target?.(), '');
    if (!paneId) return '';
    const sessions = safe(() => window.TnaiAgents?.sessions?.() || [], []);
    return sessions.find(session => session.paneId === paneId)?.agent || '';
  }

  // ---------- the typed word ----------

  // The "/" or "$" word right before the caret: { sign, start, text } or null. A command only
  // runs when it starts the prompt, so "/" counts only there; "$" counts at the start of any word.
  function typedWord() {
    if (promptEl.selectionStart !== promptEl.selectionEnd) return null;
    const before = promptEl.value.slice(0, promptEl.selectionStart);
    const command = /^(\s*)(\/[^\s]*)$/.exec(before);
    if (command) return { sign: '/', start: command[1].length, text: command[2] };
    const skill = /(^|\s)(\$[^\s]*)$/.exec(before);
    if (skill) return { sign: '$', start: before.length - skill[2].length, text: skill[2] };
    return null;
  }

  // ---------- the rows ----------

  // Library skills switched on for every session (Skills page), which reach Claude Code as the
  // plugin "tnai-skills" and OpenCode through its skill paths. Codex, Cursor Agent and Copilot CLI
  // get marked copies in ~/.agents/skills, which cli-commands.js already finds.
  function librarySkills() {
    return safe(() => window.TnaiSkills?.list?.() || [], []).filter(
      skill => skill.source === 'imported' && skill.everywhere
    );
  }

  function skillRows(cli, answer) {
    const library = librarySkills();
    const libraryNames = new Set(library.map(skill => String(skill.name).toLowerCase()));
    const rows = answer.skills.map(skill => ({
      name: skill.insert,
      insert: skill.insert,
      about: skill.about,
      label: libraryNames.has(skill.name.toLowerCase())
        ? SKILL_LABEL.library
        : SKILL_LABEL[skill.from] || SKILL_LABEL.user,
    }));
    const listed = new Set(answer.skills.map(skill => skill.name.toLowerCase()));
    for (const skill of library) {
      const name = String(skill.name || skill.id);
      if (listed.has(name.toLowerCase())) continue;
      let insert = '';
      if (cli === 'Claude Code') insert = '/tnai-skills:' + name;
      else if (cli === 'OpenCode') insert = '/' + name;
      if (!insert) continue;
      rows.push({
        name: insert,
        insert,
        about: skill.description || '',
        label: SKILL_LABEL.library,
      });
    }
    return rows;
  }

  function commandRows(cli, answer) {
    const menus = window.TnaiCliMenus;
    const rows = answer.commands.map(command => {
      let label = YOUR_COMMAND;
      if (command.kind === 'built-in')
        label = safe(() => menus?.opensScreen?.(cli, command.name), false)
          ? OPENS_SCREEN
          : RUNS_HERE;
      return {
        name: command.name,
        insert: command.name,
        about: command.about,
        label,
        from: command.from,
      };
    });

    // Skills a CLI runs with "/" belong to its commands too.
    const skills = answer.skillSign === '/' ? skillRows(cli, answer) : [];
    return [...rows, ...skills];
  }

  // The rows that match the typed text: names that start with it first, the CLI's order kept.
  function matching(all, typed) {
    const needle = typed.slice(1).toLowerCase();
    const strip = row => row.name.replace(/^[/$]/, '').toLowerCase();
    const hits = all.filter(row => strip(row).includes(needle));
    const first = hits.filter(row => strip(row).startsWith(needle));
    const rest = hits.filter(row => !strip(row).startsWith(needle));
    return [...first, ...rest].slice(0, MAX_ROWS);
  }

  // ---------- the list on screen ----------

  function close() {
    state.el?.remove();
    state.el = null;
    state.sign = '';
    state.start = -1;
    state.rows = [];
    state.active = 0;
    state.savedAt = -1;
    promptEl.removeAttribute('aria-expanded');
    promptEl.removeAttribute('aria-activedescendant');
  }

  function listEl() {
    // The prompt box may sit in its pop-out window (38).
    const doc = promptEl.ownerDocument;
    if (state.el && state.el.ownerDocument === doc) return state.el;
    state.el?.remove();
    const el = doc.createElement('div');
    el.className = 'tnai-pp';
    el.id = 'tnaiPromptPicker';
    el.setAttribute('role', 'listbox');

    // The caret stays in the prompt box while a row is pressed.
    el.addEventListener('mousedown', event => event.preventDefault());
    el.addEventListener('click', event => {
      const row = event.target.closest('[data-at]');
      if (row) pick(Number(row.dataset.at));
    });
    doc.body.append(el);
    state.el = el;
    promptEl.setAttribute('aria-controls', el.id);
    return el;
  }

  function title(sign, cli) {
    if (sign === '$') return 'Skills for ' + cli;
    return 'Commands of ' + cli;
  }

  function rowHtml(row, at) {
    const tip = row.about ? row.name + ' · ' + row.about : row.name;
    return (
      '<button type="button" role="option" class="tnai-pp-item" id="tnaiPromptPick' +
      at +
      '" data-at="' +
      at +
      '" aria-selected="' +
      (at === state.active) +
      '" title="' +
      esc(tip) +
      '"><code>' +
      esc(row.name) +
      '</code><span>' +
      esc(row.about) +
      '</span><em>' +
      esc(row.label) +
      '</em></button>'
    );
  }

  function paint() {
    const el = listEl();

    // The CLI's own rows under their title, then the Saved group (194) under its own.
    const rowsHtml = state.rows.map((row, at) => {
      let head = '';
      if (at === state.savedAt) head = '<h4>Saved</h4>';
      return head + rowHtml(row, at);
    });
    const ownTitle =
      state.savedAt === 0 ? '' : '<h4>' + esc(title(state.sign, state.cli)) + '</h4>';
    el.innerHTML = ownTitle + rowsHtml.join('');
    window.TnaiFloat?.attach(promptEl.closest('.composebox') || promptEl, el, {
      placement: 'top-start',
      sameWidth: true,
      maxHeight: 300,
      fade: false,
    });
    promptEl.setAttribute('aria-expanded', 'true');
    promptEl.setAttribute('aria-activedescendant', 'tnaiPromptPick' + state.active);
    el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  // Asks cli-commands.js for the CLI's lists; the list is painted again when the answer comes.
  // One question per opening: an answer younger than FRESH_MS is used as it is.
  const FRESH_MS = 2000;
  const askedAt = new Map();

  async function fetchFor(cli) {
    if (state.fetching === cli) return;
    if (Date.now() - (askedAt.get(cli) || 0) < FRESH_MS) return;
    state.fetching = cli;
    askedAt.set(cli, Date.now());
    try {
      const result = await window.tnaiNative.cliCommands.list(cli);
      if (result?.ok && result.value?.known) known.set(cli, result.value);
    } catch {
      // No answer: the list stays as it was (or closed); nothing is made up.
    } finally {
      state.fetching = '';
    }

    // The word is still being typed: show the answer now.
    const typing = promptEl.ownerDocument.activeElement === promptEl;
    if (typing && typedWord() && threadCli() === cli) update();
  }

  // Opens, narrows or closes the list for what is typed now.
  // typing: true when a key changed the text; the highlight then goes back to the first row, as
  // in the approved mockup. Otherwise (an answer came in, another thread) it stays on its row.
  function update(typing) {
    const word = typedWord();
    if (!word) {
      state.dismissedAt = -1;
      return close();
    }
    if (word.start === state.dismissedAt) return close();
    state.dismissedAt = -1;

    // Another computer's agent is the composer's target (165): only "$", with that computer's
    // skills for its CLI ("/" commands are never sent to another computer). `far.label` names the
    // CLI and the computer ("Codex on Desk"); `far.rows` is null until that computer answered.
    const far = safe(() => window.TnaiRemoteFeatures?.picker?.(), null);
    if (far && word.sign === '/') return close();
    const cli = far ? far.label : threadCli();
    if (!cli) return close();
    const opening = state.sign !== word.sign || state.cli !== cli || state.start !== word.start;
    if (opening && !far) fetchFor(cli);

    const answer = far ? far.rows : known.get(cli);

    // The CLI's list is on its way: wait for it, so the first row (and Enter) stays the CLI's
    // own as before the Saved group existed.
    if (!answer && !far && state.fetching === cli) return close();

    // The Saved group (194, the prompt and workflow library) after the CLI's own rows, for "/"
    // on this computer's threads; it shows before the CLI's answer came in too.
    const saved =
      !far && word.sign === '/'
        ? matching(
            safe(() => window.TnaiPromptLibrary?.pickerRows?.(cli) || [], []),
            word.text
          )
        : [];
    if (!answer && !saved.length) return close();
    let all = [];
    if (far) all = far.rows;
    else if (answer) all = word.sign === '/' ? commandRows(cli, answer) : skillRows(cli, answer);
    const own = matching(all, word.text);
    const rows = [...own, ...saved];
    state.savedAt = saved.length ? own.length : -1;

    // Nothing matches: no list, so Enter sends the prompt as typed.
    if (!rows.length) return close();

    const before = state.rows[state.active]?.name;
    state.sign = word.sign;
    state.start = word.start;
    state.cli = cli;
    state.rows = rows;
    state.active = Math.max(
      0,
      rows.findIndex(row => row.name === before)
    );
    if (opening || typing === true) state.active = 0;
    paint();
  }

  function pick(at) {
    const row = state.rows[at];
    if (!row) return close();
    const value = promptEl.value;
    const caret = promptEl.selectionStart;
    let insert = row.insert + ' ';

    // A Saved row (194): a prompt's text takes the typed word's place, a recipe starts on the
    // thread and the typed word goes.
    if (row.saved) {
      const paneId = safe(() => window.TnaiLiveTasks?.target?.(), '');
      const text = safe(() => window.TnaiPromptLibrary?.pick?.(row, paneId), null);
      if (text === null || text === undefined) return close();
      insert = text;
    }
    promptEl.value = value.slice(0, state.start) + insert + value.slice(caret).replace(/^ /, '');
    const end = state.start + insert.length;
    close();
    promptEl.focus({ preventScroll: true });
    promptEl.setSelectionRange(end, end);
    promptEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // ---------- keys and pointer ----------

  function onKey(event) {
    if (!state.el || event.target !== promptEl || event.isComposing) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const count = state.rows.length;
    const key = event.key;
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (event.shiftKey || !count) return;
      state.active = (state.active + (key === 'ArrowDown' ? 1 : count - 1)) % count;
      paint();
    } else if ((key === 'Enter' || key === 'Tab') && !event.shiftKey) {
      pick(state.active);
    } else if (key === 'Escape') {
      state.dismissedAt = state.start;
      close();
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  promptEl.setAttribute('aria-autocomplete', 'list');
  promptEl.addEventListener('input', () => update(true));
  promptEl.addEventListener('click', update);
  promptEl.addEventListener('keyup', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update();
  });
  promptEl.addEventListener('blur', () =>
    setTimeout(() => {
      if (promptEl.ownerDocument.activeElement !== promptEl) close();
    }, 0)
  );

  function bind(doc) {
    doc.defaultView.addEventListener('keydown', onKey, true);
  }
  bind(document);

  // The pop-out prompt box (38) binds its window through 11's bindComposer; 46 and 50 wrap it the
  // same way.
  const tasks = window.TnaiLiveTasks;
  const bindBefore = tasks?.bindComposer;
  if (bindBefore)
    tasks.bindComposer = doc => {
      bindBefore(doc);
      if (doc !== document) bind(doc);
    };

  // Another thread opened while the list is up: its CLI's commands, not the old one's.
  window.TnaiAgents?.onChange?.(() => {
    if (state.el && threadCli() !== state.cli) update();
  });

  // Another computer answered with its skills while "$" is being typed (165): show them now.
  window.addEventListener('tnai:remote-skills', () => {
    const typing = promptEl.ownerDocument.activeElement === promptEl;
    if (typing && typedWord()) update();
  });

  window.TnaiPromptPicker = { isOpen: () => !!state.el, rows: () => state.rows.slice(), close };
})();
