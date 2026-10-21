// Technically Not · 155-prompt-schedules.js — Settings › Agents › Scheduled prompts (the "sched"
// topic 22 makes, #agentsSched): the window side of desktop/prompt-schedules.js.
//
// - One card per schedule: its name, when it runs, the agent CLI and the project, an on/off switch,
//   the last run (and the thread it started, which opens on a press), the next run, and Run now,
//   Edit and Delete.
// - "New schedule" and Edit open one form above the list: name, project folder (one of the user's
//   projects, the open one first), agent CLI, model (optional), when (every N minutes, hourly,
// daily, weekdays or chosen days, local time) and the prompt. A new schedule is saved switched off.
// - A run the app missed (closed, or the computer asleep) shows once in the bell (51
//   `TnaiNextActions.notify`) with Run now; closing the notice clears the mark in main.
// Only existing Settings styles (06, 19); the one addition is the prompt box's height in 06.
// window.TnaiPromptSchedules = { state(), edit(id) } (22 reads `state` for the topic's state line;
// the Board page, 157, opens a schedule with `edit`). "Once, on a day" is the kind a Board idea
// dropped on a day makes.
(() => {
  'use strict';
  const mount = document.getElementById('agentsSched');
  if (!mount) return;
  const native = window.tnaiNative?.schedules;

  // The browser build: a plain note, like the other desktop-only topics.
  if (!native) {
    mount.innerHTML =
      '<p class="set-empty">Scheduled prompts run in the Technically Not desktop app.</p>';
    return;
  }

  const esc = value =>
    String(value ?? '').replace(
      /[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
  const icon = (name, size = 14) => window.TnaiIcon?.(name, { size }) || '';
  const folderName = folder =>
    String(folder || '')
      .split(/[\\/]+/)
      .filter(Boolean)
      .pop() || String(folder || '');
  const DAYS = [
    [1, 'Mon'],
    [2, 'Tue'],
    [3, 'Wed'],
    [4, 'Thu'],
    [5, 'Fri'],
    [6, 'Sat'],
    [0, 'Sun'],
  ];
  const KINDS = [
    ['every', 'Every N minutes'],
    ['hourly', 'Every hour'],
    ['daily', 'Every day'],
    ['weekdays', 'Weekdays'],
    ['days', 'Chosen days'],
    ['once', 'Once, on a day'],
  ];

  // When something happened or will happen, in the user's own words: "Today 08:30", "Mon 08:30".
  function when(at) {
    if (!at) return '';
    const date = new Date(at);
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return 'Today ' + time;
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow ' + time;
    return (
      date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time
    );
  }

  mount.innerHTML =
    '<section class="set-group tnai-sched-set">' +
    '<header class="set-group-head"><div><h3>Scheduled prompts</h3>' +
    '<p>A prompt starts a new thread at the times you set, while the app is open. Each run spends your agent usage.</p></div>' +
    `<button type="button" class="sa-btn" data-sched="new">${icon('plus')}<span>New schedule</span></button>` +
    '</header>' +
    '<p class="set-foot" data-sched="status" aria-live="polite"></p>' +
    '<div class="set-group tnai-sched-list" role="list" aria-label="Scheduled prompts"></div>' +
    '</section>';
  const status = mount.querySelector('[data-sched=status]');

  // The form: a card of its own, put above the list only while it is open (Settings › Agents draws
  // every card as a block, so a hidden attribute alone would not hide it).
  const editor = document.createElement('div');
  editor.className = 'set-card tnai-sched-edit';
  const listEl = mount.querySelector('.tnai-sched-list');

  let state = null;

  // The schedule the form edits ('' = a new one), or null while the form is closed.
  let editing = null;

  // Delete asks once more: the id whose Delete button now says "Delete?".
  let confirmDelete = '';

  // Missed notices this window put in the bell, by schedule id.
  const notified = new Set();

  const say = words => {
    status.textContent = words || '';
  };

  // ---------------------------------------------------------------- the list

  function threadOpen(paneId) {
    return !!paneId && !!window.TnaiThreadList?.thread?.(paneId);
  }

  function lastLine(item) {
    const last = item.lastRun;
    if (item.running) return 'Starting a run now…';
    if (!last) return 'Not run yet.';
    return when(last.at) + ' · ' + last.text;
  }

  function card(item) {
    const where = folderName(item.folder);
    const meta = [item.summary, item.agent + (item.model ? ' · ' + item.model : ''), where].join(
      ' · '
    );
    const next = item.enabled && item.nextAt ? 'Next: ' + when(item.nextAt) + '.' : 'Off.';
    const open = threadOpen(item.lastRun?.paneId)
      ? `<button type="button" class="settings-keys-button" data-sched-act="thread">Open thread</button>`
      : '';
    const deleting = confirmDelete === item.id;
    return (
      `<article class="set-card" role="listitem" data-sched-id="${esc(item.id)}">` +
      `<label class="set-row"><span class="set-text"><b>${esc(item.name)}</b>` +
      `<small>${esc(meta)}</small></span>` +
      `<input type="checkbox" class="set-switch" data-sched-act="enable" aria-label="Run ${esc(item.name)} on its schedule"${item.enabled ? ' checked' : ''}></label>` +
      `<div class="set-row"><span class="set-text"><b>Last run</b>` +
      `<small>${esc(lastLine(item))} ${esc(next)}</small></span>` +
      '<span class="set-ctl">' +
      open +
      `<button type="button" class="settings-keys-button" data-sched-act="run"${item.running ? ' disabled' : ''}>Run now</button>` +
      `<button type="button" class="settings-keys-button" data-sched-act="edit">Edit</button>` +
      `<button type="button" class="settings-keys-button" data-sched-act="delete">${deleting ? 'Delete?' : 'Delete'}</button>` +
      '</span></div></article>'
    );
  }

  function paintList() {
    if (!state) return;
    const items = state.schedules || [];
    listEl.innerHTML = items.length
      ? items.map(card).join('')
      : editing === null
        ? '<p class="set-empty">No scheduled prompts yet. "New schedule" makes one; it starts switched off.</p>'
        : '';

    // 22's topic state line reads it again
    mount.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------------------------------------------------------------- missed runs in the bell

  function paintMissed() {
    const bell = window.TnaiNextActions;
    if (!bell?.notify || !state) return;
    const now = new Set();
    for (const item of state.schedules || []) {
      if (!item.missedAt) continue;
      now.add(item.id);
      notified.add(item.id);
      bell.notify({
        key: 'schedule-missed:' + item.id,
        source: 'Scheduled prompts',
        tag: 'Missed',
        title:
          'Scheduled prompt ' +
          item.name +
          ' was missed at ' +
          when(item.missedAt).replace(/^Today /, ''),
        text: 'The app was closed or the computer was asleep. ' + item.summary + '.',
        action: { label: 'Run now', run: () => runNow(item.id) },
        onRemove: () => native.dismissMissed(item.id).catch(() => {}),
      });
    }
    for (const id of [...notified]) {
      if (now.has(id)) continue;
      notified.delete(id);
      bell.unnotify('schedule-missed:' + id);
    }
  }

  function apply(view) {
    if (!view) return;
    state = view;
    if (view.error) say(view.error);
    paintList();
    paintMissed();
  }

  const load = () =>
    native
      .view()
      .then(apply)
      .catch(() => say('Couldn’t read your scheduled prompts.'));
  native.onState(apply);
  load();
  window.addEventListener('tnai:settings-page-shown', load);

  // ---------------------------------------------------------------- the form

  function option(value, label, selected, title = '') {
    return `<option value="${esc(value)}"${selected ? ' selected' : ''}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</option>`;
  }

  function openEditor(id) {
    const item = id ? (state?.schedules || []).find(s => s.id === id) : null;
    editing = item ? item.id : '';
    const projects = state?.projects || [];
    const folder = item?.folder || state?.openProject || projects[0] || '';
    const agents = state?.agents || [];
    const w = item?.when || { kind: 'weekdays', time: '08:30' };
    const days = new Set(w.days || [1, 2, 3, 4, 5]);
    editor.innerHTML =
      `<div class="set-row"><span class="set-text"><b>${item ? 'Edit ' + esc(item.name) : 'New schedule'}</b><small>It starts a new thread named after it, at this project's normal access level.</small></span></div>` +
      `<div class="set-row"><span class="set-text"><b>Name</b></span><input type="text" class="set-input set-text-input" data-f="name" maxlength="40" spellcheck="false" value="${esc(item?.name || '')}" placeholder="Morning issue triage"></div>` +
      `<div class="set-row"><span class="set-text"><b>Project</b><small>The thread works in this folder, also while another project is open.</small></span><select class="set-input" data-f="folder">${projects.map(p => option(p, folderName(p), p === folder, p)).join('')}</select></div>` +
      `<div class="set-row"><span class="set-text"><b>Agent</b></span><select class="set-input" data-f="agent">${agents.map(a => option(a, a, a === (item?.agent || agents[0]))).join('')}</select></div>` +
      `<div class="set-row"><span class="set-text"><b>Model</b><small>Optional. Empty: the model you use for this CLI.</small></span><input type="text" class="set-input set-text-input" data-f="model" spellcheck="false" value="${esc(item?.model || '')}" placeholder="The CLI's default"></div>` +
      `<div class="set-row"><span class="set-text"><b>When</b><small>Your computer's local time.</small></span><span class="set-ctl">` +
      `<select class="set-input" data-f="kind">${KINDS.map(([k, l]) => option(k, l, k === w.kind)).join('')}</select>` +
      `<input type="number" class="set-input set-num" data-f="minutes" min="${state?.minEvery || 15}" step="5" value="${esc(w.minutes || 60)}" aria-label="Minutes between runs">` +
      `<input type="number" class="set-input set-num" data-f="minute" min="0" max="59" value="${esc(w.minute || 0)}" aria-label="Minute of the hour">` +
      `<input type="date" class="set-input" data-f="date" value="${esc(w.date || '')}" aria-label="Day">` +
      `<input type="time" class="set-input" data-f="time" value="${esc(w.time || '08:30')}" aria-label="Time of day">` +
      '</span></div>' +
      `<div class="set-sub" data-f="days-row"><div class="set-row"><span class="set-text"><b>Days</b></span><span class="set-chips">${DAYS.map(([d, l]) => `<label class="set-chip"><input type="checkbox" data-day="${d}"${days.has(d) ? ' checked' : ''}>${l}</label>`).join('')}</span></div></div>` +
      `<div class="set-row"><span class="set-text"><b>Prompt</b><textarea class="set-input" data-f="prompt" rows="4" spellcheck="true" placeholder="Go through the new issues and sort them by how urgent they are." aria-label="Prompt">${esc(item?.prompt || '')}</textarea></span></div>` +
      `<div class="set-row"><span class="set-text"><small data-f="error" aria-live="polite"></small></span><span class="set-ctl">` +
      `<button type="button" class="settings-keys-button" data-sched="cancel">Cancel</button>` +
      `<button type="button" class="settings-keys-button" data-sched="save">Save</button></span></div>`;
    listEl.before(editor);
    showKind();
    paintList();
    editor.querySelector('[data-f=name]').focus();
  }

  function closeEditor() {
    editing = null;
    editor.remove();
    editor.innerHTML = '';
    paintList();
  }

  // Only the fields the chosen "when" uses are shown.
  function showKind() {
    const kind = editor.querySelector('[data-f=kind]')?.value;
    if (!kind) return;
    editor.querySelector('[data-f=minutes]').hidden = kind !== 'every';
    editor.querySelector('[data-f=minute]').hidden = kind !== 'hourly';
    editor.querySelector('[data-f=date]').hidden = kind !== 'once';
    editor.querySelector('[data-f=time]').hidden = !['daily', 'weekdays', 'days', 'once'].includes(
      kind
    );
    editor.querySelector('[data-f=days-row]').classList.toggle('off', kind !== 'days');
  }

  function readEditor() {
    const field = name => editor.querySelector(`[data-f=${name}]`);
    return {
      id: editing || undefined,
      name: field('name').value,
      folder: field('folder').value,
      agent: field('agent').value,
      model: field('model').value,
      prompt: field('prompt').value,
      when: {
        kind: field('kind').value,
        minutes: Number(field('minutes').value),
        minute: Number(field('minute').value),
        time: field('time').value,
        date: field('date').value,
        days: [...editor.querySelectorAll('[data-day]:checked')].map(c => Number(c.dataset.day)),
      },
    };
  }

  function saveEditor() {
    const error = editor.querySelector('[data-f=error]');
    const button = editor.querySelector('[data-sched=save]');
    button.disabled = true;
    native
      .save(readEditor())
      .then(result => {
        if (result?.ok) {
          closeEditor();
          say('Saved. Switch it on to let it run.');
        } else error.textContent = result?.error || 'Couldn’t save it.';
      })
      .catch(() => {
        error.textContent = 'Couldn’t save it.';
      })
      .finally(() => {
        button.disabled = false;
      });
  }

  editor.addEventListener('change', event => {
    if (event.target.matches('[data-f=kind]')) showKind();

    // the form's own fields are not settings: 22's state line has nothing to read here
    event.stopPropagation();
  });
  editor.addEventListener('click', event => {
    const act = event.target.closest('[data-sched]')?.dataset.sched;
    if (act === 'cancel') closeEditor();
    if (act === 'save') saveEditor();
  });
  editor.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeEditor();
  });
  mount.querySelector('[data-sched=new]').addEventListener('click', () => openEditor(''));

  // ---------------------------------------------------------------- the cards' controls

  function runNow(id) {
    say('');
    return native
      .runNow(id)
      .then(result => {
        if (!result?.ok) say(result?.error || 'It did not start.');
      })
      .catch(() => say('It did not start.'));
  }

  listEl.addEventListener('change', event => {
    const box = event.target.closest('[data-sched-act=enable]');
    if (!box) return;
    const id = box.closest('[data-sched-id]').dataset.schedId;
    native
      .enable(id, box.checked)
      .then(result => {
        if (!result?.ok) {
          say(result?.error || 'Couldn’t change it.');
          load();
        }
      })
      .catch(() => load());
  });
  listEl.addEventListener('click', event => {
    const button = event.target.closest('button[data-sched-act]');
    if (!button) return;
    const id = button.closest('[data-sched-id]').dataset.schedId;
    const act = button.dataset.schedAct;
    if (act === 'run') {
      button.disabled = true;
      runNow(id);
    }
    if (act === 'edit') openEditor(id);
    if (act === 'thread') {
      const item = (state?.schedules || []).find(s => s.id === id);
      if (!window.TnaiThreads?.show?.(item?.lastRun?.paneId)) say('That thread is closed.');
    }
    if (act === 'delete') {
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
        .then(result => {
          if (!result?.ok) say(result?.error || 'Couldn’t delete it.');
          if (editing === id) closeEditor();
        })
        .catch(() => say('Couldn’t delete it.'));
    }
  });

  window.TnaiPromptSchedules = {
    // 22's topic state line: "2 on of 3", "None yet"
    state() {
      if (!state) return '—';
      const items = state.schedules || [];
      if (!items.length) return 'None yet';
      return items.filter(s => s.enabled).length + ' of ' + items.length + ' on';
    },

    // Opens Settings › Agents › Scheduled prompts with that schedule's form open (the Board's Week
    // view, 157: a press on a coming run, to change its time, switch it off or run it now).
    // With no id ('') only the topic opens (the Board's empty screens).
    edit(id) {
      window.TnaiSettings?.open?.('agents');
      document.querySelector('#settingsPanel-agents [data-sa-sec="sched"]')?.click();
      const show = () => {
        if ((state?.schedules || []).some(item => item.id === id)) openEditor(id);
      };
      if (state) show();
      else load().then(show);
    },
  };
})();
