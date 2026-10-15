/*
 * Technically Not · 151-snapshot-shelf.js — Desktop only: the Snapshots box. The last five pictures
 * and the last five clips taken with the snapshot key (desktop/snapshot-shelf.js keeps them while
 * the app runs), each with Copy and Delete (a clip also Play), and Clear all. It opens from the
 * three-dots menu's row "Snapshots" (124) as a popover under the menu's button, in the look of the
 * worktree box (`.pgo-qpop`, src/styles/34-popover-parts.css). Escape or a press outside closes it.
 * `window.TnaiSnapshotShelf` (`toggle`, `open`, `close`, `shown`).
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
