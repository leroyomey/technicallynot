// Technically Not · 194-prompt-library.js — Desktop app only: the prompt and workflow library
// (feature build 2026-10-28, feature 3). Saved prompts and recipes, run with one press on any
// thread. The list is kept on disk by desktop/prompt-library.js (`tnaiNative.promptLibrary`).
//
// - A saved prompt is a named text. A recipe is an ordered list of steps ("Review the changes",
//   "Fix what you found", "Run the tests"): each step is sent to the same thread when the step
//   before it ended, told by the real task end of 42 (`TnaiTurns`, pushed by
//   desktop/agent-turns.js), never by a timer. A step that ended interrupted, stopped, with an
//   error or because the agent closed stops the recipe, and the bell says which step and why.
// - Where they are picked: the "/" list of the prompt box (160 asks `pickerRows`; a saved prompt
//   is written into the box, a recipe starts on the open thread), and the thread's "..." menu
//   (137's row "Saved prompts and recipes…" opens this file's list in the same menu, 137
//   `openList`), which also saves the prompt box's text under a name and stops a running recipe.
// - Where they are managed: Settings › Agents › Saved prompts (the "library" topic 22 makes,
//   #agentsLibrary), with New prompt, New recipe, Run, Edit and Delete, in the Settings styles
//   the Scheduled prompts topic (155) uses.
// - A step goes the way the prompt box sends (10 `TnaiAgents.send`, held while the agent works;
//   a stopped thread is woken for the first step, 10 `wake`), with the same "[TN.ai]" mark and
//   skill note as 11's wake path, and the conversation stays where the user reads (122
//   `quietly`). Recipes need a CLI whose task end Technically Not reads (`TURN_CLIS`); for the
//   others the recipe rows are greyed with the reason.
// window.TnaiPromptLibrary = { items(), state(), pickerRows(cli), pick(row, paneId), open(anchor,
// paneId), run(id, paneId), send(id, paneId), running(paneId), stop(paneId), edit(id) }.
(() => {
  'use strict';

  // ---------------------------------------------------------------- the parts that hold no page

  // The CLIs whose task start and end desktop/agent-turns.js reads (tnai-cli-parity): Copilot
  // CLI's are not built yet, so a recipe cannot follow its steps.
  const TURN_CLIS = ['Claude Code', 'Codex', 'OpenCode', 'Cursor Agent'];

  // How a step's task can end without finishing, in the words the bell uses.
  const FAILED = {
    interrupted: 'was interrupted',
    aborted: 'was stopped',
    error: 'ended with an error',
    exit: 'ended because the agent closed',
  };

  // A task that started up to this long before the step was sent is still the step's own: the
  // CLI's clock and the window's can differ by a moment.
  const SLACK_MS = 2000;

  // A prompt that is one slash command, as the prompt box tells it (11): sent exactly as typed.
  const SLASH_ONLY = /^\/[\w:-]+(?:[ \t][^\n]*)?$/;

  // Follows one recipe run per thread. deps: {
  //   send(paneId, text, first): true when the step left (sync),
  //   turn(paneId): 42's turn { startedAt, endedAt, endedBy } or null,
  //   now(): the time,
  //   told(run, what, words): a run changed (what: 'sent', 'done', 'stopped', 'cancelled') }
  function createRunner(deps) {
    const runs = new Map();

    function finish(run, what, words) {
      if (runs.get(run.paneId) !== run) return;
      runs.delete(run.paneId);
      run.phase = what;
      deps.told(run, what, words);
    }

    function stepWords(run) {
      return 'step ' + (run.at + 1) + ' of ' + run.steps.length;
    }

    // Sends the step `run.at` and waits for its task.
    function sendStep(run) {
      const before = deps.turn(run.paneId);
      run.before = before?.startedAt || 0;
      run.sentAt = deps.now();
      run.startedAt = 0;
      run.phase = 'waiting';
      const sent = deps.send(run.paneId, run.steps[run.at], run.at === 0);
      if (!sent) {
        finish(run, 'stopped', stepWords(run) + ' could not be sent: the thread is not running');
        return false;
      }
      deps.told(run, 'sent', stepWords(run) + ' sent');
      return true;
    }

    function start(paneId, recipe) {
      if (!paneId) return { ok: false, error: 'Open a thread first.' };
      if (runs.has(paneId)) return { ok: false, error: 'A recipe already runs on this thread.' };
      const steps = (recipe?.steps || []).filter(step => String(step || '').trim());
      if (!steps.length) return { ok: false, error: 'That recipe has no steps.' };
      const run = {
        paneId,
        id: recipe.id,
        name: recipe.name,
        steps,
        at: 0,
        phase: 'waiting',
        before: 0,
        sentAt: 0,
        startedAt: 0,
        seenRunning: false,
      };
      runs.set(paneId, run);

      // A first step that could not leave was already told (finish): no second message.
      return sendStep(run) ? { ok: true, run } : { ok: false, error: '' };
    }

    // Called on every pushed turn of a thread (42's `tnai:turn`).
    function check(paneId) {
      const run = runs.get(paneId);
      if (!run) return;
      const turn = deps.turn(paneId);
      if (!turn?.startedAt) return;

      // The step's task is the first one that started after it was sent; the task that ran while
      // it was held is not it.
      if (run.phase === 'waiting') {
        const older = turn.startedAt === run.before || turn.startedAt < run.sentAt - SLACK_MS;
        if (older) return;
        run.phase = 'working';
        run.startedAt = turn.startedAt;
      }

      // A newer task started while the step's task was followed: the step's task is over (the
      // user sent something of their own meanwhile), and the next step waits behind it.
      const newer = turn.startedAt !== run.startedAt;
      if (!newer && !turn.endedAt) return;
      const failed = newer ? '' : FAILED[turn.endedBy];
      if (failed) {
        const left = run.steps.length - run.at - 1;
        finish(
          run,
          'stopped',
          stepWords(run) +
            ' ' +
            failed +
            (left ? '; ' + left + (left === 1 ? ' step was' : ' steps were') + ' not sent' : '')
        );
        return;
      }
      run.at += 1;
      if (run.at >= run.steps.length) {
        finish(run, 'done', 'all ' + run.steps.length + ' steps finished');
        return;
      }
      sendStep(run);
    }

    // The thread's state changed (10 `onChange`): a closed or stopped thread ends its recipe.
    function session(paneId, live) {
      const run = runs.get(paneId);
      if (!run) return;
      if (!live) {
        finish(run, 'stopped', 'the thread closed at ' + stepWords(run));
        return;
      }
      if (live.running) run.seenRunning = true;
      else if (run.seenRunning) finish(run, 'stopped', 'the thread stopped at ' + stepWords(run));
    }

    function stop(paneId) {
      const run = runs.get(paneId);
      if (run) finish(run, 'cancelled', 'stopped by you at ' + stepWords(run));
      return !!run;
    }

    return {
      start,
      check,
      session,
      stop,
      get: paneId => runs.get(paneId) || null,
      panes: () => [...runs.keys()],
    };
  }

  // One line about an item, for a card, a row's tip or the "/" list.
  function summary(item) {
    if (!item) return '';
    if (item.kind === 'recipe')
      return item.steps.map(step => step.split('\n')[0].trim().slice(0, 40)).join(' → ');
    return String(item.text || '')
      .split('\n')[0]
      .trim()
      .slice(0, 140);
  }

  // For tools/prompt-library-test.js (plain Node).
  if (typeof module !== 'undefined' && module.exports)
    module.exports = { createRunner, summary, TURN_CLIS, FAILED, SLASH_ONLY };
  if (typeof window === 'undefined') return;
  const native = window.tnaiNative?.promptLibrary;
  if (!native) return;

  // ---------------------------------------------------------------- the list

  let items = [];
  let loadError = '';

  const sessionOf = paneId =>
    (window.TnaiAgents?.sessions?.() || []).find(one => one.paneId === paneId) || null;
  const byId = id => items.find(item => item.id === id) || null;

  function toast(words) {
    try {
      window.toast?.(words);
    } catch {}
  }

  // Why a recipe cannot run on this thread's CLI, or ''.
  function recipeOff(session) {
    if (!session) return 'open a running thread';
    if (session.agent === 'Terminal') return 'not in a plain terminal';
    if (!TURN_CLIS.includes(session.agent))
      return session.agent + ' does not tell when a task ends';
    return '';
  }

  // ---------------------------------------------------------------- sending

  // The words the agent gets for a step: the prompt box's wake path (11), so a step reads to the
  // agent as a typed prompt does.
  function forAgent(session, words) {
    const plain = String(words || '').trim();
    if (SLASH_ONLY.test(plain)) return plain;
    const mark = session.agent === 'Claude Code' && window.TnaiTeam ? '[TN.ai] ' : '';
    let skills = '';
    try {
      skills = window.TnaiSessionSkills?.note?.(session.paneId) || '';
    } catch {}
    return mark + plain + skills;
  }

  // Sends one text to one thread, held while its agent works; a stopped thread is woken when
  // `first` (a press, not a step that follows another). True when it left.
  function deliver(paneId, words, first) {
    const session = sessionOf(paneId);
    if (!session || session.agent === 'Terminal') return false;
    const agents = window.TnaiAgents;
    const message = forAgent(session, words);
    const go = () => {
      let sent = false;
      if (session.running)
        sent = agents.send(paneId, message, { userText: words, holdIfBusy: true });
      else if (first) sent = !!agents.wake?.(paneId, message);
      if (sent)
        window.TnaiLiveTasks?.record?.(paneId, words, session.name + ' (' + session.agent + ')');
      return sent;
    };
    const quiet = window.TnaiThreadReadable?.quietly;
    return !!(quiet ? quiet(go) : go());
  }

  // ---------------------------------------------------------------- the recipe runs

  function tell(run, what, words) {
    const session = sessionOf(run.paneId);
    const thread = session?.name || 'the thread';
    const line = 'Recipe ' + run.name + ': ' + words;
    if (what === 'sent') {
      toast(line + ' to ' + thread);
      return;
    }
    toast(line);

    // The end of a run is kept in the bell: it can come long after the press.
    window.TnaiNextActions?.notify?.({
      key: 'recipe:' + run.paneId + ':' + run.sentAt,
      group: 'recipe:' + run.paneId,
      source: 'Saved prompts',
      tag: what === 'done' ? 'Done' : 'Stopped',
      title:
        what === 'done'
          ? 'Recipe ' + run.name + ' finished on ' + thread
          : 'Recipe ' + run.name + ' stopped on ' + thread,
      text: words.charAt(0).toUpperCase() + words.slice(1) + '.',
      action: session
        ? { label: 'Open thread', run: () => window.TnaiThreads?.show?.(run.paneId) }
        : undefined,
    });
  }

  const runner = createRunner({
    send: deliver,
    turn: paneId => window.TnaiTurns?.get?.(paneId) || null,
    now: () => Date.now(),
    told: tell,
  });

  window.addEventListener('tnai:turn', event => runner.check(event.detail?.paneId));
  window.TnaiAgents?.onChange?.(() => {
    for (const paneId of runner.panes()) runner.session(paneId, sessionOf(paneId));
  });

  function run(id, paneId) {
    const item = byId(id);
    if (!item || item.kind !== 'recipe') return toast('That recipe is gone.');
    const off = recipeOff(sessionOf(paneId));
    if (off) return toast('Recipe ' + item.name + ' cannot run: ' + off + '.');
    const started = runner.start(paneId, item);
    if (!started.ok && started.error) toast(started.error);
  }

  // A saved prompt sent at once to a thread (the "..." menu, Settings' Run).
  function sendPrompt(id, paneId) {
    const item = byId(id);
    const session = sessionOf(paneId);
    if (!item || item.kind !== 'prompt') return toast('That saved prompt is gone.');
    if (!session) return toast('Open a thread first.');
    const sent = deliver(paneId, item.text, true);
    toast(
      sent
        ? item.name + ' sent to ' + session.name
        : session.name + ' is not running. Start it, then try again.'
    );
  }

  // ---------------------------------------------------------------- the prompt box's "/" list

  // The Saved group of 160's "/" list, for the thread's CLI. Each row says what a press does.
  function pickerRows(cli) {
    const runs = TURN_CLIS.includes(cli);
    return items.map(item => ({
      name: item.name,
      insert: '',
      about: summary(item),
      label:
        item.kind === 'prompt'
          ? 'saved prompt'
          : runs
            ? 'recipe · ' + item.steps.length + ' steps'
            : 'recipe · not for ' + cli,
      saved: { id: item.id, kind: item.kind },
    }));
  }

  // A Saved row was picked in the "/" list: a prompt is written into the box in place of the typed
  // word (the user sends it), a recipe starts on the thread. Returns the text for the box.
  function pick(row, paneId) {
    const item = byId(row?.saved?.id);
    if (!item) {
      toast('That saved item is gone.');
      return null;
    }
    if (item.kind === 'prompt') return item.text;
    run(item.id, paneId);
    return '';
  }

  // ---------------------------------------------------------------- the "..." menu's list

  const promptBox = () => document.getElementById('prompt');

  // Saves the prompt box's text under a name asked in the app's own dialog (00's prompt).
  function saveFromBox() {
    const words = String(promptBox()?.value || '').trim();
    if (!words) return toast('Type a prompt first, then save it.');
    const name = window.prompt('Name for this saved prompt', words.split('\n')[0].slice(0, 40));
    if (name === null || name === undefined) return;
    native
      .save({ kind: 'prompt', name, text: words })
      .then(answer =>
        toast(
          answer?.ok
            ? 'Saved as ' + answer.item.name + '. Type / in the prompt box to find it.'
            : answer?.error || 'Could not save it.'
        )
      )
      .catch(() => toast('Could not save it.'));
  }

  function menuRows(paneId) {
    const session = sessionOf(paneId);
    const rows = [];
    if (runner.get(paneId))
      rows.push({
        id: 'lib-stop',
        label: 'Stop the recipe',
        icon: 'square-stop',
        go: () => runner.stop(paneId),
      });
    const off = recipeOff(session);
    for (const item of items) {
      if (item.kind === 'prompt')
        rows.push({
          id: 'lib-p-' + item.id,
          label: item.name,
          icon: 'file-text',
          go: () => sendPrompt(item.id, paneId),
        });
      else
        rows.push({
          id: 'lib-r-' + item.id,
          label: item.name + ' · ' + item.steps.length + ' steps',
          icon: 'play',
          ...(off ? { off } : {}),
          go: () => run(item.id, paneId),
        });
    }
    if (String(promptBox()?.value || '').trim())
      rows.push({
        id: 'lib-save',
        label: 'Save the typed prompt…',
        icon: 'file-plus',
        go: saveFromBox,
      });
    rows.push({ id: 'lib-manage', label: 'Manage saved prompts…', icon: 'settings', go: edit });
    return rows;
  }

  function menuLabel(paneId) {
    const going = runner.get(paneId);
    if (going)
      return 'Recipe ' + going.name + ' · step ' + (going.at + 1) + ' of ' + going.steps.length;
    if (!items.length) return 'Nothing saved yet. Type a prompt, then save it here.';
    return 'Saved prompts and recipes';
  }

  // Opens the list under `anchor` (the "..." button) for the thread `paneId`.
  function open(anchor, paneId) {
    const more = window.TnaiThreadMore;
    if (!more?.openList || !anchor || !paneId) return;
    if (more.isOpen()) {
      const same = more.anchor?.() === anchor;
      more.close(same);
      if (same) return;
    }
    more.openList(anchor, paneId, {
      name: 'Saved prompts and recipes',
      label: menuLabel(paneId),
      rows: menuRows(paneId),
    });
  }

  // ---------------------------------------------------------------- Settings › Agents › Saved
  // prompts

  const mount = document.getElementById('agentsLibrary');
  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const icon = (name, size = 14) => window.TnaiIcon?.(name, { size }) || '';

  // The item the form edits: null while closed, else { id ('' = new), kind }.
  let editing = null;

  // Delete asks once more: the id whose Delete button now says "Delete?".
  let confirmDelete = '';

  let listEl = null;
  let status = null;
  const editor = document.createElement('div');
  editor.className = 'set-card tnai-lib-edit';

  const say = words => {
    if (status) status.textContent = words || '';
  };

  function buildTopic() {
    if (!mount) return;
    mount.innerHTML =
      '<section class="set-group tnai-lib-set">' +
      '<header class="set-group-head"><div><h3>Saved prompts and recipes</h3>' +
      '<p>Pick one from / in the prompt box or from a thread’s "..." menu. A recipe sends its steps to the same thread, each when the step before it ended, and stops when a step fails or is interrupted.</p></div>' +
      '<span class="set-ctl">' +
      `<button type="button" class="sa-btn" data-lib="new-prompt">${icon('plus')}<span>New prompt</span></button>` +
      `<button type="button" class="sa-btn" data-lib="new-recipe">${icon('plus')}<span>New recipe</span></button>` +
      '</span></header>' +
      '<p class="set-foot" data-lib="status" aria-live="polite"></p>' +
      '<div class="set-group tnai-lib-list" role="list" aria-label="Saved prompts and recipes"></div>' +
      '</section>';
    listEl = mount.querySelector('.tnai-lib-list');
    status = mount.querySelector('[data-lib=status]');
    mount.querySelector('[data-lib=new-prompt]').addEventListener('click', () => {
      openEditor('', 'prompt');
    });
    mount.querySelector('[data-lib=new-recipe]').addEventListener('click', () => {
      openEditor('', 'recipe');
    });
    listEl.addEventListener('click', onCardPress);
  }

  // The thread a Run press goes to: the prompt box's thread.
  const openThread = () => window.TnaiLiveTasks?.target?.() || '';

  function card(item) {
    const kind = item.kind === 'recipe' ? 'Recipe · ' + item.steps.length + ' steps' : 'Prompt';
    const thread = sessionOf(openThread());
    const runTip = thread
      ? (item.kind === 'recipe' ? 'Runs on ' : 'Sends to ') + thread.name
      : 'Open a thread first';
    const deleting = confirmDelete === item.id;
    return (
      `<article class="set-card" role="listitem" data-lib-id="${esc(item.id)}">` +
      `<div class="set-row"><span class="set-text"><b>${esc(item.name)}</b>` +
      // no title on the line: 22 would turn it into a "?" tip beside the name
      `<small>${esc(kind + ': ' + summary(item))}</small></span>` +
      '<span class="set-ctl">' +
      `<button type="button" class="settings-keys-button" data-lib-act="run" title="${esc(runTip)}"${thread ? '' : ' disabled'}>${item.kind === 'recipe' ? 'Run' : 'Send'}</button>` +
      '<button type="button" class="settings-keys-button" data-lib-act="edit">Edit</button>' +
      `<button type="button" class="settings-keys-button" data-lib-act="delete">${deleting ? 'Delete?' : 'Delete'}</button>` +
      '</span></div></article>'
    );
  }

  function paintList() {
    if (!listEl) return;
    let empty = '';
    if (editing === null)
      empty =
        '<p class="set-empty">Nothing saved yet. "New prompt" saves one prompt; "New recipe" saves steps that run one after another.</p>';
    listEl.innerHTML = items.length ? items.map(card).join('') : empty;
    if (loadError) say(loadError);

    // 22's topic state line reads it again
    mount.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function stepRow(words, at, count) {
    return (
      `<div class="set-row" data-step="${at}"><span class="set-text"><b>Step ${at + 1}</b>` +
      `<textarea class="set-input" rows="3" spellcheck="true" aria-label="Step ${at + 1}" placeholder="${at === 0 ? 'Review the changes and list the problems.' : 'Fix what you found.'}">${esc(words)}</textarea></span>` +
      `<span class="set-ctl"><button type="button" class="settings-keys-button" data-lib="remove-step"${count <= 1 ? ' disabled' : ''}>Remove</button></span></div>`
    );
  }

  function stepsHtml(steps) {
    return steps.map((words, at) => stepRow(words, at, steps.length)).join('');
  }

  const readSteps = () =>
    [...editor.querySelectorAll('[data-step] textarea')].map(field => field.value);

  function openEditor(id, kind) {
    const item = id ? byId(id) : null;
    const type = item ? item.kind : kind;
    editing = { id: item ? item.id : '', kind: type };
    let title = 'New prompt';
    if (item) title = 'Edit ' + esc(item.name);
    else if (type === 'recipe') title = 'New recipe';
    const about =
      type === 'recipe'
        ? 'Each step is sent to the same thread when the step before it ended.'
        : 'Sent as it is written, to the thread you pick it on.';
    let body;
    if (type === 'recipe')
      body =
        `<div data-f="steps">${stepsHtml(item ? item.steps : ['', ''])}</div>` +
        `<div class="set-row"><span class="set-text"><small>Up to 20 steps.</small></span><span class="set-ctl"><button type="button" class="settings-keys-button" data-lib="add-step">Add step</button></span></div>`;
    else
      body = `<div class="set-row"><span class="set-text"><b>Prompt</b><textarea class="set-input" data-f="text" rows="5" spellcheck="true" placeholder="Review the changes on this branch and list the problems first." aria-label="Prompt">${esc(item?.text || '')}</textarea></span></div>`;
    editor.innerHTML =
      `<div class="set-row"><span class="set-text"><b>${title}</b><small>${about}</small></span></div>` +
      `<div class="set-row"><span class="set-text"><b>Name</b></span><input type="text" class="set-input set-text-input" data-f="name" maxlength="60" spellcheck="false" value="${esc(item?.name || '')}" placeholder="${type === 'recipe' ? 'Review, fix, test' : 'Review the branch'}"></div>` +
      body +
      '<div class="set-row"><span class="set-text"><small data-f="error" aria-live="polite"></small></span><span class="set-ctl">' +
      '<button type="button" class="settings-keys-button" data-lib="cancel">Cancel</button>' +
      '<button type="button" class="settings-keys-button" data-lib="save">Save</button></span></div>';
    listEl.before(editor);
    paintList();
    editor.querySelector('[data-f=name]').focus({ preventScroll: true });
  }

  function closeEditor() {
    editing = null;
    editor.remove();
    editor.innerHTML = '';
    paintList();
  }

  function saveEditor() {
    const error = editor.querySelector('[data-f=error]');
    const button = editor.querySelector('[data-lib=save]');
    const entry = {
      kind: editing.kind,
      name: editor.querySelector('[data-f=name]').value,
      ...(editing.id ? { id: editing.id } : {}),
    };
    if (editing.kind === 'recipe') entry.steps = readSteps();
    else entry.text = editor.querySelector('[data-f=text]').value;
    button.disabled = true;
    native
      .save(entry)
      .then(answer => {
        if (answer?.ok) {
          closeEditor();
          say('Saved. Type / in the prompt box to find it.');
        } else error.textContent = answer?.error || 'Couldn’t save it.';
      })
      .catch(() => {
        error.textContent = 'Couldn’t save it.';
      })
      .finally(() => {
        button.disabled = false;
      });
  }

  editor.addEventListener('click', event => {
    const act = event.target.closest('[data-lib]')?.dataset.lib;
    if (act === 'cancel') closeEditor();
    if (act === 'save') saveEditor();
    if (act === 'add-step' || act === 'remove-step') {
      const steps = readSteps();
      if (act === 'add-step' && steps.length < 20) steps.push('');
      if (act === 'remove-step')
        steps.splice(Number(event.target.closest('[data-step]').dataset.step), 1);
      editor.querySelector('[data-f=steps]').innerHTML = stepsHtml(steps);
      if (act === 'add-step') editor.querySelector('[data-step]:last-child textarea')?.focus();
    }
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeEditor();
  });

  // The form's own fields are not settings: 22's state line has nothing to read here.
  editor.addEventListener('change', event => event.stopPropagation());

  function onCardPress(event) {
    const button = event.target.closest('button[data-lib-act]');
    if (!button) return;
    const id = button.closest('[data-lib-id]').dataset.libId;
    const item = byId(id);
    const act = button.dataset.libAct;
    if (act === 'edit') openEditor(id);
    if (act === 'run' && item) {
      if (item.kind === 'recipe') run(id, openThread());
      else sendPrompt(id, openThread());
    }
    if (act !== 'delete') return;
    if (confirmDelete !== id) {
      confirmDelete = id;
      paintList();
      setTimeout(() => {
        if (confirmDelete !== id) return;
        confirmDelete = '';
        paintList();
      }, 4000);
      return;
    }
    confirmDelete = '';
    native
      .remove(id)
      .then(answer => {
        if (!answer?.ok) say(answer?.error || 'Couldn’t delete it.');
        if (editing?.id === id) closeEditor();
      })
      .catch(() => say('Couldn’t delete it.'));
  }

  // Opens Settings › Agents › Saved prompts.
  function edit() {
    window.TnaiSettings?.open?.('agents');
    document.querySelector('#settingsPanel-agents [data-sa-sec="library"]')?.click();
  }

  // ---------------------------------------------------------------- the list from disk

  function apply(view) {
    if (!view) return;
    items = Array.isArray(view.items) ? view.items : [];
    loadError = view.error || '';
    paintList();
  }

  const load = () =>
    native
      .view()
      .then(apply)
      .catch(() => say('Couldn’t read your saved prompts.'));

  buildTopic();
  native.onState(apply);
  load();

  // Run buttons name the open thread: drawn again when Settings is shown.
  window.addEventListener('tnai:settings-page-shown', paintList);

  window.TnaiPromptLibrary = {
    items: () => items.map(item => ({ ...item })),

    // 22's topic state line: "2 prompts · 1 recipe", "None yet"
    state() {
      if (!items.length) return 'None yet';
      const recipes = items.filter(item => item.kind === 'recipe').length;
      const prompts = items.length - recipes;
      const parts = [];
      if (prompts) parts.push(prompts + (prompts === 1 ? ' prompt' : ' prompts'));
      if (recipes) parts.push(recipes + (recipes === 1 ? ' recipe' : ' recipes'));
      return parts.join(' · ');
    },
    pickerRows,
    pick,
    open,
    run,
    send: sendPrompt,
    running: paneId => {
      const going = runner.get(paneId);
      return going ? { name: going.name, step: going.at + 1, of: going.steps.length } : null;
    },
    stop: paneId => runner.stop(paneId),
    edit,
  };
})();
