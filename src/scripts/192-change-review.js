// Technically Not · 192-change-review.js — Desktop only: keep or undo each file a task changed,
// right in the "Worked for" block's file list (122 `addWorked`, also inside 170's "files changed"
// preview). A press on a file's name shows what the task changed in it (before the agent's first
// edit → now, drawn with 26's line diff). Keep marks the file as looked at; Undo puts that one file
// back as it was before the task, after an inline "Put back as before?" (never a native dialog).
//
// The facts come from desktop/change-review.js: a copy taken before each agent edit (every CLI
// whose edits wait for the app), or git when the file was unchanged before the task. When Undo
// cannot be done safely (no copy, edited since the task ended, another agent holds the file, the
// task still running) the button is off and says why on hover and in the diff.
//
// window.TnaiChangeReview = { block }. Look: src/styles/68-change-review.css.
// Test: node tools/change-review-test.js (the main side).
(() => {
  'use strict';
  const review = window.tnaiNative?.changeReview;
  if (!review) {
    window.TnaiChangeReview = { block: () => {} };
    return;
  }

  // Most changed lines drawn in one diff; the rest is counted.
  const LINES_MAX = 400;

  // A block's rows are asked again at most this often when the pointer comes back to it.
  const ASK_AGAIN_MS = 30000;

  // While the task's end is still being noted (main runs a little after the conversation), ask
  // again this often, a few times.
  const RUNNING_RETRY_MS = 3000;
  const RUNNING_TRIES = 5;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const button = (label, title, onPress) => {
    const press = make('button', 'tnt-made-act', label);
    press.type = 'button';
    if (title) press.title = title;
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  };

  // ------------------------------------------------------------ asking the main process
  function folderOf(paneId) {
    const session = (window.TnaiAgents?.sessions?.() || []).find(one => one.paneId === paneId);
    return session?.cwd || '';
  }

  async function ask(files) {
    const query = files.tcrQuery;
    const names = [...files.querySelectorAll(':scope > .tnt-file')].map(row => row.dataset.tcrName);
    let rows = [];
    try {
      rows = await review.state({ ...query, folder: folderOf(query.paneId), files: names });
    } catch {
      return;
    }
    files.tcrAskedAt = Date.now();
    for (const row of files.querySelectorAll(':scope > .tnt-file')) {
      const facts = rows.find(one => one.name === row.dataset.tcrName);
      if (facts) paintRow(row, facts);
    }

    // the task's end not noted yet: ask again shortly
    const running = rows.some(one => /still running/.test(one.why));
    if (running && (files.tcrTries || 0) < RUNNING_TRIES) {
      files.tcrTries = (files.tcrTries || 0) + 1;
      setTimeout(() => ask(files), RUNNING_RETRY_MS);
    }
  }

  // ------------------------------------------------------------ one row
  function paintRow(row, facts) {
    row.tcrFacts = facts;
    let acts = row.querySelector(':scope > .tcr-acts');
    if (!acts) {
      acts = make('span', 'tcr-acts');
      row.append(acts);
    }

    // the inline confirm stays until it is answered
    if (acts.dataset.confirm) return;
    acts.replaceChildren();
    row.dataset.tcrDecision = facts.decision || '';
    if (facts.decision === 'undone') {
      acts.append(make('span', 'tcr-word', 'Undone'));
      return;
    }
    if (facts.decision === 'kept') acts.append(make('span', 'tcr-word', 'Kept'));
    else acts.append(button('Keep', 'Mark this file as looked at and kept', () => keep(row)));
    const undoTitle = facts.canUndo
      ? facts.created
        ? 'Remove this file: the task created it'
        : 'Put this file back as it was before the task'
      : 'Undo is off: ' + facts.why;
    const undoPress = button('Undo', undoTitle, () => confirmUndo(row));
    if (!facts.canUndo) {
      undoPress.disabled = true;
      undoPress.setAttribute('aria-disabled', 'true');
    }
    acts.append(undoPress);
  }

  async function keep(row) {
    const facts = row.tcrFacts;
    let answer;
    try {
      answer = await review.keep(facts.review);
    } catch {
      return;
    }
    if (answer?.ok) paintRow(row, { ...facts, decision: 'kept' });
  }

  function confirmUndo(row) {
    const facts = row.tcrFacts;
    const acts = row.querySelector(':scope > .tcr-acts');
    acts.dataset.confirm = '1';
    row.classList.add('tcr-asking');
    const question = make(
      'span',
      'tcr-word',
      facts.created ? 'Remove this new file?' : 'Put back as before?'
    );

    // Cancel (or Escape) puts the buttons back, and the keyboard back on Undo
    const back = () => {
      acts.removeEventListener('keydown', onKey);
      delete acts.dataset.confirm;
      row.classList.remove('tcr-asking');
      paintRow(row, facts);
      acts.querySelector('.tnt-made-act:last-child')?.focus({ preventScroll: true });
    };
    const onKey = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      back();
    };
    acts.addEventListener('keydown', onKey);
    const cancel = button('Cancel', '', back);
    const go = button(facts.created ? 'Remove' : 'Undo file', '', () => {
      acts.removeEventListener('keydown', onKey);
      runUndo(row);
    });
    go.classList.add('tcr-go');
    acts.replaceChildren(question, go, cancel);
    go.focus({ preventScroll: true });
  }

  async function runUndo(row) {
    const facts = row.tcrFacts;
    const acts = row.querySelector(':scope > .tcr-acts');
    let answer;
    try {
      answer = await review.undo(facts.id);
    } catch (error) {
      answer = { ok: false, why: String(error?.message || error) };
    }
    delete acts.dataset.confirm;
    row.classList.remove('tcr-asking');
    if (answer?.ok) {
      paintRow(row, { ...facts, decision: 'undone', canUndo: false });
      closeDiff(row);
      return;
    }

    // refused by the full check: the button goes off with the reason
    const why = answer?.why || 'It could not be undone.';
    paintRow(row, { ...facts, canUndo: false, why });
    const open = row.nextElementSibling?.classList.contains('tcr-diff')
      ? row.nextElementSibling
      : null;
    if (open) setNote(open, 'Undo is off: ' + why);
  }

  // ------------------------------------------------------------ the diff under a row
  function setNote(box, text) {
    let note = box.querySelector(':scope > .tcr-note');
    if (!note) {
      note = make('div', 'tcr-note');
      box.prepend(note);
    }
    note.textContent = text;
  }

  function holderOf(row) {
    return row.closest('.tnt-made-pbody');
  }

  function closeDiff(row) {
    const box = row.nextElementSibling;
    if (box?.classList.contains('tcr-diff')) box.remove();
    row.classList.remove('tcr-open');
    const holder = holderOf(row);
    if (holder && !holder.querySelector('.tcr-diff')) holder.classList.remove('tcr-open');
  }

  async function toggleDiff(row) {
    if (row.classList.contains('tcr-open')) {
      closeDiff(row);
      return;
    }
    row.classList.add('tcr-open');
    holderOf(row)?.classList.add('tcr-open');
    const box = make('div', 'tcr-diff');
    row.after(box);
    setNote(box, 'Reading…');

    // pressed before the block was first asked
    if (!row.tcrFacts && row.parentElement?.tcrQuery) await ask(row.parentElement);
    const facts = row.tcrFacts;
    if (!facts?.id) {
      setNote(box, facts?.why || 'No copy from before this task.');
      return;
    }
    let shown;
    try {
      shown = await review.diff(facts.id);
    } catch {
      shown = { ok: false, why: 'It could not be read.' };
    }
    if (!box.isConnected) return;
    if (!shown?.ok) {
      setNote(box, shown?.why || 'It could not be read.');
      return;
    }
    drawDiff(box, shown, facts);
  }

  function drawDiff(box, shown, facts) {
    const changes = window.TnaiFileDiff?.diff?.(shown.before, shown.after);
    const parts = [];
    const head = shown.created
      ? 'New in this task'
      : shown.removed
        ? 'Removed since the task started'
        : 'Before the task → now';
    parts.push(head);
    if (!facts.canUndo && facts.decision !== 'undone') parts.push('Undo is off: ' + facts.why);
    box.replaceChildren();
    setNote(box, parts.join(' · '));
    if (!changes || !changes.hunks.length) {
      box.append(make('div', 'tcr-note', 'No line differences.'));
      return;
    }
    let drawn = 0;
    let total = 0;
    changes.hunks.forEach((hunk, index) => {
      total += hunk.lines.length;
      if (drawn >= LINES_MAX) return;
      if (changes.hunks.length > 1 || index)
        box.append(make('div', 'tcr-hunk', 'line ' + hunk.lines[0].n));
      for (const line of hunk.lines) {
        if (drawn >= LINES_MAX) break;
        const lineRow = make('div', 'tcr-line ' + (line.t === '+' ? 'tcr-add' : 'tcr-del'));
        lineRow.append(
          make('i', '', String(line.n)),
          make('b', '', line.t === '+' ? '+' : '−'),
          make('code', '', line.text || ' ')
        );
        box.append(lineRow);
        drawn++;
      }
    });
    if (total > drawn)
      box.append(make('div', 'tcr-hunk', total - drawn + ' more changed lines not shown'));
    if (changes.approximate)
      box.append(make('div', 'tcr-hunk', 'Large change: shown as a whole-block replace'));
  }

  // ------------------------------------------------------------ the block
  const seen = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      seen.unobserve(target);
      ask(target);
    }
  });

  // 122 calls this for each "Worked for" block with its file list (`files`, `.tnt-files`).
  function block(state, entry, files) {
    if (!files || state.sub) return;
    files.tcrQuery = { paneId: state.paneId, at: entry.at || 0, ms: entry.ms || 0 };
    for (const row of files.querySelectorAll(':scope > .tnt-file')) {
      const name = row.querySelector(':scope > code');
      if (!name) continue;
      row.dataset.tcrName = name.textContent;
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.title = 'Show what this task changed in ' + name.textContent;
      name.addEventListener('click', event => {
        event.stopPropagation();
        toggleDiff(row);
      });
      name.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        toggleDiff(row);
      });
    }

    // asked once when it first comes on screen, again when the pointer comes back later
    seen.observe(files);
    files.addEventListener('pointerenter', () => {
      if (files.tcrAskedAt && Date.now() - files.tcrAskedAt > ASK_AGAIN_MS) ask(files);
    });
  }

  // ask is also for tools/change-review-check.js
  window.TnaiChangeReview = { block, ask };
})();
