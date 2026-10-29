/*
 * Technically Not · 151-snapshot-shelf.js — Desktop only: the Snapshots box. The last five pictures
 * and the last five clips taken with the snapshot key (desktop/snapshot-shelf.js keeps them while
 * the app runs), each with Copy and Delete (a clip also Play), and Clear all. It opens from the
 * three-dots menu's row "Snapshots" (124) as a popover under the menu's button, in the look of the
 * worktree box (`.pgo-qpop`, src/styles/34-popover-parts.css). Escape or a press outside closes it.
 * `window.TnaiSnapshotShelf` (`toggle`, `open`, `close`, `shown`).
 *
 * A picture also has "Mark up and send": the second part of this file opens it in a dialog in the
 * look of the Devices page's dialogs (`.dv-scrim`, `.dv-dlg`), where the user draws boxes, arrows
 * and freehand lines, types short notes, undoes, picks a thread and writes a line of text. Send
 * puts the marked copy into the prompt box as a pasted screenshot and sends it the usual way (11),
 * so every agent CLI gets it exactly as it gets a pasted picture. `window.TnaiSnapshotMarkup`
 * (`open`, `close`, `shown`).
 */
(() => {
  'use strict';
  const native = window.tnaiNative;
  if (!native?.snapshots) return;

  const icon = (name, size = 14) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  const pop = make('div', 'pgo-qpop snap-shelf');
  pop.hidden = true;
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Snapshots');
  document.body.append(pop);

  // The box as last told by the main process, the key that takes a snapshot, and whether the next
  // press of Clear all is the confirming one.
  let shelf = { max: 5, pictures: [], clips: [] };
  let keyLabel = 'Ctrl+Shift+Alt+S';
  let anchor = null;
  let confirming = false;
  let noteTimer = 0;

  // One icon button with its words for screen readers and on hover.
  function iconButton(name, words, action, kind, id) {
    const button = make('button', 'pgo-btn snap-act');
    button.type = 'button';
    button.innerHTML = icon(name);
    button.title = words;
    button.setAttribute('aria-label', words);
    button.dataset.act = action;
    button.dataset.kind = kind;
    button.dataset.id = id;
    return button;
  }

  // One tile: the picture (or the clip's first frame), the time it was taken and its buttons.
  function tile(item, kind) {
    const card = make('div', 'snap-tile');
    card.dataset.kind = kind;
    card.dataset.id = item.id;
    const picture = make('div', 'snap-pic');
    const source = kind === 'clip' ? item.still : item.thumb;
    if (source) {
      const image = make('img');
      image.src = source;
      image.alt = '';
      image.draggable = false;
      picture.append(image);
    }
    if (kind === 'clip') picture.append(make('span', 'snap-badge', 'Clip'));
    const foot = make('div', 'snap-foot');
    const when = make('small', '', TIME.format(item.at));
    if (kind === 'picture' && item.width) when.title = item.width + ' × ' + item.height + ' px';
    const actions = make('span', 'snap-acts');
    if (kind === 'clip') actions.append(iconButton('play', 'Play', 'play', kind, item.id));
    if (kind === 'picture' && window.TnaiSnapshotMarkup)
      actions.append(iconButton('pencil', 'Mark up and send', 'markup', kind, item.id));
    actions.append(
      iconButton('copy', 'Copy again', 'copy', kind, item.id),
      iconButton('trash-2', 'Delete', 'remove', kind, item.id)
    );
    foot.append(when, actions);
    card.append(picture, foot);
    return card;
  }

  // A group: its title with the count, then its tiles or one quiet line when it is empty.
  function group(title, items, kind, empty) {
    const part = make('div', 'grp');
    const head = make('div', 'who');
    head.append(make('b', '', title), make('span', '', items.length + ' of ' + shelf.max));
    part.append(head);
    if (!items.length) {
      part.append(make('div', 'pgo-empty', empty));
      return part;
    }
    const grid = make('div', 'snap-grid');
    grid.append(...items.map(item => tile(item, kind)));
    part.append(grid);
    return part;
  }

  function paint() {
    if (pop.hidden) return;
    const keepFocus = document.activeElement && pop.contains(document.activeElement);
    const focused = keepFocus
      ? [document.activeElement.dataset.act, document.activeElement.dataset.id].join(':')
      : '';
    const title = make('h4', '', 'Snapshots');
    const lead = make(
      'p',
      'note snap-lead',
      'Press ' +
        keyLabel +
        ' on any screen to take one. The last ' +
        shelf.max +
        ' pictures and ' +
        shelf.max +
        ' clips stay here until the app closes.'
    );
    const pictures = group(
      'Pictures',
      shelf.pictures,
      'picture',
      'No pictures yet. Each one you take is also kept here.'
    );
    const clips = group(
      'Clips',
      shelf.clips,
      'clip',
      'No clips yet. In the snapshot screen, press C to record one.'
    );
    const row = make('div', 'qa');
    const total = shelf.pictures.length + shelf.clips.length;
    if (confirming && total) {
      const yes = make('button', 'pgo-btn stop', 'Delete all ' + total);
      yes.type = 'button';
      yes.dataset.act = 'clear';
      const no = make('button', 'pgo-btn', 'Keep them');
      no.type = 'button';
      no.dataset.act = 'keep';
      row.append(yes, no);
    } else {
      const clear = make('button', 'pgo-btn stop', 'Clear all');
      clear.type = 'button';
      clear.dataset.act = 'ask-clear';
      clear.disabled = !total;
      row.append(clear);
    }
    const note = make('p', 'note snap-note');
    note.setAttribute('aria-live', 'polite');
    note.textContent = pop.querySelector('.snap-note')?.textContent || '';
    pop.replaceChildren(title, lead, pictures, clips, row, note);
    if (focused) {
      const [act, id] = focused.split(':');
      const again =
        pop.querySelector(`button[data-act="${act}"][data-id="${id}"]`) ||
        pop.querySelector('button:not(:disabled)');
      again?.focus({ preventScroll: true });
    }
  }

  // A short line under the buttons that goes away by itself.
  function say(text) {
    const note = pop.querySelector('.snap-note');
    if (!note) return;
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      note.textContent = '';
    }, 2400);
  }

  async function act(button) {
    const action = button.dataset.act;
    const kind = button.dataset.kind;
    const id = button.dataset.id;
    if (action === 'ask-clear') {
      confirming = true;
      paint();
      pop.querySelector('button[data-act="keep"]')?.focus({ preventScroll: true });
      return;
    }
    if (action === 'keep') {
      confirming = false;
      paint();
      return;
    }
    if (action === 'clear') {
      confirming = false;
      await native.snapshots.clear();
      say('Cleared.');
      return;
    }
    if (action === 'markup') {
      // The box closes first, so the dialog is the only thing over the page; Escape there brings
      // the focus back to the menu's button.
      const opener = anchor;
      close();
      window.TnaiSnapshotMarkup?.open(id, opener);
      return;
    }
    if (action === 'play') {
      const name = shelf.clips.find(one => one.id === id)?.name;
      if (name) window.TnaiClips?.play?.(name);
      return;
    }
    if (action === 'copy') {
      const result = await native.snapshots.copy(kind, id);
      say(
        result?.ok
          ? kind === 'clip'
            ? 'Clip copied. Paste it with Ctrl+V.'
            : 'Picture copied. Paste it with Ctrl+V.'
          : result?.error?.message || 'Could not copy it.'
      );
      return;
    }
    if (action === 'remove') {
      await native.snapshots.remove(kind, id);
      say(kind === 'clip' ? 'Clip deleted.' : 'Picture deleted.');
    }
  }

  pop.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (button && !button.disabled) act(button);
  });

  async function open(at) {
    anchor = at || document.querySelector('.top .tnt-menu-btn');
    confirming = false;

    // The list and the key come first, so the box never shows empty for a moment.
    try {
      shelf = (await native.snapshots.list()) || shelf;
    } catch {}
    try {
      keyLabel = (await native.snapshot?.state?.())?.accelerator || keyLabel;
    } catch {}

    // A line left from the last time the box was open does not come back with it.
    clearTimeout(noteTimer);
    pop.querySelector('.snap-note')?.replaceChildren();
    pop.hidden = false;
    paint();
    if (anchor) window.TnaiFloat?.attach(anchor, pop, { placement: 'bottom-end' });
    pop.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    confirming = false;
    window.TnaiFloat?.detach(pop);
    if (pop.contains(document.activeElement) && anchor?.isConnected) anchor.focus();
  }

  const toggle = at => (pop.hidden ? open(at) : close());

  native.snapshots.onChange(list => {
    if (!list) return;
    shelf = list;
    paint();
  });

  document.addEventListener(
    'keydown',
    event => {
      if (event.key === 'Escape' && !pop.hidden) {
        event.stopPropagation();
        close();
      }
    },
    true
  );
  document.addEventListener(
    'pointerdown',
    event => {
      if (!pop.hidden && !pop.contains(event.target)) close();
    },
    true
  );

  window.TnaiSnapshotShelf = { toggle, open, close, shown: () => !pop.hidden };
})();

// ---------------------------------------------------------------- the markup dialog
// A picture from the box, drawn on in the page and sent to a thread with a line of text. The kept
// picture never changes: the marks go on a copy, and that copy is what the agent gets.
(() => {
  'use strict';
  const native = window.tnaiNative;
  if (!native?.snapshots?.picture) return;

  // The snapshot overlay's four inks (desktop/snapshot-overlay.html `INKS`), so a mark looks the
  // same wherever it was drawn. They are colors inside the picture, not in the app's own look.
  const INKS = [
    { name: 'Red', color: '#ff4d4f' },
    { name: 'Yellow', color: '#ffd60a' },
    { name: 'Green', color: '#c7f36b' },
    { name: 'Blue', color: '#3b9eff' },
  ];

  // A note's dark edge, so it reads on any background, and the overlay's font for it.
  const OUTLINE = '#1b1c19';
  const FONT = 'Inter, ui-sans-serif, system-ui, "Segoe UI", sans-serif';
  const TOOLS = [
    { tool: 'box', words: 'Box' },
    { tool: 'arrow', words: 'Arrow' },
    { tool: 'pen', words: 'Pen' },
    { tool: 'text', words: 'Note' },
  ];
  const NOTE_MAX = 120;
  const LINE_MAX = 2000;

  // The dialog while it is open: its parts, the picture, the marks and the chosen tool, ink and
  // thread. Null while it is closed.
  let open = null;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function button(words, className, onPress) {
    const node = make('button', 'dv-btn' + (className ? ' ' + className : ''), words);
    node.type = 'button';
    node.addEventListener('click', onPress);
    return node;
  }

  // One choice in a row of choices (tools, inks, threads): the Devices page's chosen look
  // (`.dv-btn[aria-checked='true']`).
  function choice(words, checked, onPress) {
    const node = button(words, 'dv-sm', onPress);
    node.setAttribute('role', 'radio');
    node.setAttribute('aria-checked', String(checked));
    return node;
  }

  function check(row, chosen) {
    for (const node of row.children) node.setAttribute('aria-checked', String(node === chosen));
  }

  // ------------------------------------------------------------ drawing

  // A pointer position in picture pixels, kept inside the picture.
  function pointAt(event) {
    const canvas = open.canvas;
    const box = canvas.getBoundingClientRect();
    const keep = (value, max) => Math.min(max, Math.max(0, value));
    return {
      x: keep(((event.clientX - box.left) * canvas.width) / box.width, canvas.width),
      y: keep(((event.clientY - box.top) * canvas.height) / box.height, canvas.height),
    };
  }

  // Picture pixels per screen pixel as the picture is shown now, so a line is 3 screen pixels wide
  // however large the picture is. Each mark keeps the value it was drawn with.
  function unitNow() {
    const shown = open.canvas.getBoundingClientRect().width;
    return shown > 0 ? Math.max(1, open.canvas.width / shown) : 1;
  }

  const span = op => ({
    x: Math.min(op.ax, op.bx),
    y: Math.min(op.ay, op.by),
    w: Math.abs(op.bx - op.ax),
    h: Math.abs(op.by - op.ay),
  });

  // A drag too short to be meant is dropped, as in the overlay.
  function worth(op) {
    if (op.pts) return op.pts.length >= 4;
    if (op.tool === 'arrow') return Math.hypot(op.bx - op.ax, op.by - op.ay) >= 6 * op.unit;
    const size = span(op);
    return size.w >= 3 * op.unit && size.h >= 3 * op.unit;
  }

  function drawOne(ctx, op) {
    const unit = op.unit;
    ctx.save();
    ctx.lineWidth = 3 * unit;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = op.color;
    ctx.fillStyle = op.color;
    if (op.tool === 'box') {
      const size = span(op);
      ctx.strokeRect(size.x, size.y, size.w, size.h);
    } else if (op.tool === 'arrow') {
      const angle = Math.atan2(op.by - op.ay, op.bx - op.ax);
      const head = Math.min(14 * unit, Math.hypot(op.bx - op.ax, op.by - op.ay));
      const side = turn => [
        op.bx - Math.cos(angle + turn) * head,
        op.by - Math.sin(angle + turn) * head,
      ];
      ctx.beginPath();
      ctx.moveTo(op.ax, op.ay);
      ctx.lineTo(op.bx - Math.cos(angle) * head * 0.7, op.by - Math.sin(angle) * head * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(op.bx, op.by);
      ctx.lineTo(...side(0.42));
      ctx.lineTo(...side(-0.42));
      ctx.closePath();
      ctx.fill();
    } else if (op.pts) {
      ctx.beginPath();
      ctx.moveTo(op.pts[0], op.pts[1]);
      for (let index = 2; index < op.pts.length; index += 2)
        ctx.lineTo(op.pts[index], op.pts[index + 1]);
      ctx.stroke();
    } else if (op.tool === 'text') {
      ctx.font = '600 ' + 16 * unit + 'px ' + FONT;
      ctx.textBaseline = 'top';
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(op.text, op.x, op.y);
      ctx.fillText(op.text, op.x, op.y);
    }
    ctx.restore();
  }

  function paint() {
    if (!open) return;
    const ctx = open.ctx;
    ctx.drawImage(open.base, 0, 0);
    for (const op of open.ops) drawOne(ctx, op);
    if (open.draft) drawOne(ctx, open.draft);
    open.undo.disabled = !open.ops.length;
  }

  // One paint a frame while the pointer moves.
  function paintSoon() {
    if (!open || open.queued) return;
    open.queued = true;
    requestAnimationFrame(() => {
      if (!open) return;
      open.queued = false;
      paint();
    });
  }

  // A note still being typed is what Undo takes back first; then the newest mark.
  function undo() {
    if (!open) return;
    if (open.note) {
      closeNote(false);
      return;
    }
    open.draft = null;
    open.ops.pop();
    paint();
  }

  function onPointerDown(event) {
    if (!open || event.button > 0) return;
    event.preventDefault();
    const point = pointAt(event);
    const unit = unitNow();
    if (open.tool === 'text') {
      openNote(point, event, unit);
      return;
    }
    closeNote(true);
    const color = INKS[open.ink].color;
    open.draft =
      open.tool === 'pen'
        ? { tool: 'pen', color, unit, pts: [point.x, point.y] }
        : { tool: open.tool, color, unit, ax: point.x, ay: point.y, bx: point.x, by: point.y };

    // A pointer the page no longer knows (a pen lifted early) cannot be captured; the drag then
    // ends at the canvas's edge, which is fine.
    try {
      open.canvas.setPointerCapture(event.pointerId);
    } catch {}
    paintSoon();
  }

  function onPointerMove(event) {
    if (!open?.draft) return;
    const point = pointAt(event);
    if (open.draft.pts) open.draft.pts.push(point.x, point.y);
    else {
      open.draft.bx = point.x;
      open.draft.by = point.y;
    }
    paintSoon();
  }

  function onPointerUp() {
    if (!open?.draft) return;
    const done = open.draft;
    open.draft = null;
    if (worth(done)) open.ops.push(done);
    paint();
  }

  // ------------------------------------------------------------ notes

  // A short text field at the pressed point; Enter or a press elsewhere keeps the note, Escape
  // drops it.
  function openNote(point, event, unit) {
    closeNote(true);
    const field = make('input', 'dv-name snap-mark-note');
    field.type = 'text';
    field.maxLength = NOTE_MAX;
    field.setAttribute('aria-label', 'Note on the picture');
    field.placeholder = 'Note';
    field.style.color = INKS[open.ink].color;
    const stage = open.stage.getBoundingClientRect();
    field.style.left = Math.round(event.clientX - stage.left) + 'px';
    field.style.top = Math.round(event.clientY - stage.top) + 'px';
    open.note = { field, point, unit, color: INKS[open.ink].color };
    field.addEventListener('keydown', press => {
      if (press.key === 'Enter') {
        press.preventDefault();
        closeNote(true);
      } else if (press.key === 'Escape') {
        press.preventDefault();
        press.stopPropagation();
        closeNote(false);
      }
    });
    field.addEventListener('blur', () => closeNote(true));
    open.stage.append(field);
    requestAnimationFrame(() => field.focus({ preventScroll: true }));
  }

  function closeNote(keep) {
    const note = open?.note;
    if (!note) return;
    open.note = null;
    const text = note.field.value.trim().slice(0, NOTE_MAX);
    note.field.remove();
    if (keep && text)
      open.ops.push({
        tool: 'text',
        color: note.color,
        unit: note.unit,
        x: note.point.x,
        y: note.point.y,
        text,
      });
    paint();
  }

  // ------------------------------------------------------------ threads and sending

  // The threads a picture can go to: this computer's agent threads, the open one first.
  function threads() {
    let list = [];
    try {
      list = window.TnaiThreadList?.all?.() || [];
    } catch {}
    const agents = list.filter(thread => thread.tool && thread.tool !== 'Terminal');
    let selected = null;
    try {
      selected = window.TnaiThreads?.selected?.() || null;
    } catch {}
    agents.sort((one, two) => (two.id === selected) - (one.id === selected));
    return agents.map(thread => ({ id: thread.id, name: thread.name, tool: thread.tool }));
  }

  // The marked copy as a file, named the way a pasted picture is, so the prompt box shows it as
  // "Screenshot N" and saves it in the attachments folder when it is sent.
  function markedFile() {
    return new Promise(done => {
      open.canvas.toBlob(blob => {
        done(blob ? new File([blob], 'image.png', { type: 'image/png' }) : null);
      }, 'image/png');
    });
  }

  // Into the prompt box of the chosen thread. An empty box sends at once, through the box's own
  // Send (11), so each CLI gets the picture the way it gets a pasted screenshot and a refusal (not
  // running, another computer) says why as usual. A box that already holds the user's own words
  // or files is never sent unseen: the picture and the line join them and the user sends.
  function deliver(paneId, file, words) {
    const prompt = document.getElementById('prompt');
    const files = window.TnaiAttachments;
    if (!prompt || !files)
      return { ok: false, why: 'Bring the prompt box back to this window first.' };
    const hadDraft = !!prompt.value.trim() || files.count() > 0;
    try {
      window.TnaiThreads?.show?.(paneId);
    } catch {}
    window.TnaiLiveTasks?.setTarget?.(paneId);
    if (!files.add([file], 'paste')) return { ok: false, why: '' };
    if (hadDraft) {
      if (words)
        prompt.value = prompt.value.replace(/\s+$/, '') + (prompt.value.trim() ? ' ' : '') + words;
      prompt.dispatchEvent(new Event('input', { bubbles: true }));
      prompt.focus({ preventScroll: true });
      return { ok: true, held: true };
    }
    prompt.value = words;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    const send = document.getElementById('send');
    if (!send) {
      prompt.focus({ preventScroll: true });
      return { ok: true, held: true };
    }
    send.click();
    return { ok: true, held: false };
  }

  async function sendNow() {
    if (!open || open.sending) return;
    closeNote(true);
    const target = open.thread;
    if (!target) return say('Open a thread first, then send the picture to it.');
    open.sending = true;
    open.send.disabled = true;
    const file = await markedFile();
    if (!open) return;
    if (!file) {
      open.sending = false;
      open.send.disabled = false;
      return say('Could not make the picture. Try again.');
    }
    const words = open.line.value.trim().slice(0, LINE_MAX);
    const result = deliver(target.id, file, words);
    if (!result.ok) {
      open.sending = false;
      open.send.disabled = false;
      if (result.why) say(result.why);
      return;
    }
    close(false);
    if (result.held && typeof toast === 'function')
      toast('The picture is in the prompt box with your draft. Press Enter to send it.');
  }

  // A short line under the form, in the Devices dialog's hint look.
  function say(text) {
    if (!open) return;
    open.hint.textContent = text;
    open.hint.classList.toggle('dv-warn', !!text);
  }

  // ------------------------------------------------------------ the dialog

  function threadRow(list) {
    const row = make('div', 'dv-pick snap-mark-threads');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Send to');
    for (const thread of list) {
      const node = choice(thread.name, thread === open.thread, () => {
        open.thread = thread;
        check(row, node);
      });
      node.title = thread.name + ' · ' + thread.tool;
      row.append(node);
    }
    return row;
  }

  function toolRow() {
    const row = make('div', 'dv-pick snap-mark-tools');
    const tools = make('div', 'dv-pick');
    tools.setAttribute('role', 'radiogroup');
    tools.setAttribute('aria-label', 'Tool');
    for (const one of TOOLS) {
      const node = choice(one.words, one.tool === open.tool, () => {
        closeNote(true);
        open.tool = one.tool;
        open.canvas.style.cursor = one.tool === 'text' ? 'text' : 'crosshair';
        check(tools, node);
      });
      tools.append(node);
    }
    const inks = make('div', 'dv-pick');
    inks.setAttribute('role', 'radiogroup');
    inks.setAttribute('aria-label', 'Color');
    INKS.forEach((ink, index) => {
      const node = choice('', index === open.ink, () => {
        open.ink = index;
        check(inks, node);
        if (open.note) open.note.field.style.color = ink.color;
      });
      node.classList.add('snap-mark-ink');
      node.style.setProperty('--snap-ink', ink.color);
      node.setAttribute('aria-label', ink.name);
      node.title = ink.name;
      inks.append(node);
    });
    open.undo = button('Undo', 'dv-sm', undo);
    open.undo.title = 'Undo (Ctrl+Z)';
    open.undo.disabled = true;
    row.append(tools, inks, open.undo);
    return row;
  }

  function onKey(event) {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const typing = event.target === open.line || event.target === open.note?.field;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      undo();
    }
  }

  async function start(id, opener) {
    if (open) close(false);
    let answer = null;
    try {
      answer = await native.snapshots.picture(id);
    } catch {}
    const value = answer?.ok ? answer.value : null;
    if (!value?.png) {
      if (typeof toast === 'function')
        toast(answer?.error?.message || 'This snapshot is no longer in the box.');
      return;
    }
    let base = null;
    try {
      base = await createImageBitmap(new Blob([value.png], { type: 'image/png' }));
    } catch {}
    if (!base) {
      if (typeof toast === 'function') toast('Could not open this snapshot.');
      return;
    }

    const scrim = make('div', 'dv-scrim');
    const box = make('div', 'dv-dlg dv-wide snap-mark');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'snapMarkTitle');
    const title = make('h2', '', 'Mark up and send');
    title.id = 'snapMarkTitle';

    const stage = make('div', 'snap-mark-stage');
    const canvas = make('canvas');
    canvas.width = base.width;
    canvas.height = base.height;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'The snapshot. Drag on it to draw.');
    stage.append(canvas);

    const list = threads();
    open = {
      id,
      scrim,
      stage,
      canvas,
      ctx: canvas.getContext('2d'),
      base,
      ops: [],
      draft: null,
      note: null,
      tool: 'box',
      ink: 0,
      thread: list[0] || null,
      opener,
      queued: false,
      sending: false,
    };

    const tools = toolRow();
    const line = make('input', 'dv-name');
    line.type = 'text';
    line.maxLength = LINE_MAX;
    line.placeholder = 'What should the agent do with it?';
    line.setAttribute('aria-label', 'Text sent with the picture');
    line.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendNow();
      }
    });
    open.line = line;
    const to = make(
      'p',
      'dv-hint',
      list.length ? 'Send to' : 'No thread is open on this computer.'
    );
    const hint = make('p', 'dv-hint snap-mark-hint');
    hint.setAttribute('aria-live', 'polite');
    open.hint = hint;
    const acts = make('div', 'dv-acts');
    open.send = button('Send', 'dv-pri', sendNow);
    open.send.disabled = !list.length;
    acts.append(
      button('Cancel', '', () => close(true)),
      open.send
    );

    box.append(title, tools, stage, to);
    if (list.length) box.append(threadRow(list));
    box.append(line, hint, acts);
    scrim.append(box);

    // Only Cancel and Escape close it: a press beside the dialog would throw the marks away.
    scrim.addEventListener('keydown', onKey);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    document.body.append(scrim);
    paint();
    line.focus({ preventScroll: true });
  }

  // back: the focus goes back to what opened the dialog (Cancel, Escape); after a send it stays
  // in the prompt box.
  function close(back) {
    if (!open) return;
    const was = open;
    open = null;
    was.scrim.remove();
    was.base.close?.();
    if (back && was.opener?.isConnected) was.opener.focus({ preventScroll: true });
  }

  window.TnaiSnapshotMarkup = { open: start, close: () => close(true), shown: () => !!open };
})();
