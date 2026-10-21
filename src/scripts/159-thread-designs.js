/*
 * Technically Not · 159-thread-designs.js — a page or picture the agent wrote or showed, as a card
 * in the thread's conversation. Desktop app only.
 *
 * What counts is read from the conversation's own entries (desktop/thread-log-*.js), so it works
 * for every CLI that has a reader: a page (.html) the agent wrote, a page it showed with `tnai show
 * FILE.html`, a picture (.png .jpg .webp .gif .svg) it wrote, and a picture a command it ran named
 * and changed while it ran (inferred from the file's change time, and said so on hover).
 *
 * The card comes after the reply that made it: designs of a stretch of actions wait until the
 * agent's next words, the end of the task, or the user's next prompt (122 calls `place`). One card
 * per page: its name, "Open large", "Live preview", the page drawn small and still (a picture taken
 * once in a hidden window, desktop/thread-designs.js); pictures of the same stretch sit under it
 * as a row with their names, or have a card of their own. Nothing runs inside a card: the still
 * picture is an image, and it is asked for only when the card comes into view.
 *
 * Open large lays the page over the window in a frame cut off from the app and the network, the
 * way `tnai show` pages are (show-file.js, and the preview frame's name so WebRTC is taken away
 * too), or a picture at its full size. Live preview opens the page there, by the same request `tnai
 * show` sends.
 *
 * Look: src/styles/46-thread-designs.css. `window.TnaiThreadDesigns` (`find`, `note`, `place`,
 * `close`, and `openLarge` for 170's "What it made").
 * Tests: `node tools/thread-designs-test.js`, desktop test `thread-designs`.
 */
(() => {
  'use strict';
  const native = window.tnaiNative;

  const PAGE = /\.html?$/i;
  const PICTURE = /\.(png|jpe?g|webp|gif|svg)$/i;

  // a picture named in a command: a path of plain characters ending in a picture's extension
  const PICTURE_IN_COMMAND =
    /(?:^|[\s"'=(,])((?:[A-Za-z]:)?[\w./\\-]+\.(?:png|jpe?g|webp|gif|svg))\b/gi;

  // `tnai show FILE.html`, as typed in any shell (the name may be quoted)
  const SHOW_COMMAND = /\btnai(?:\.cmd|\.exe)?\s+show\s+("[^"]+"|'[^']+'|[^\s;&|]+)/i;

  // commands that only look at or remove a file, so a picture they name was not made by them
  const LOOKS_ONLY =
    /^\s*(?:cat|type|less|more|head|tail|ls|dir|stat|file|git|rm|del|erase|Remove-Item|Get-Content|Get-Item|Get-ChildItem|Test-Path|start|explorer|code)\b/i;
  const MAX_FROM_COMMAND = 6;

  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const icon = (name, size) => {
    try {
      return window.TnaiIcon?.(name, { size }) || '';
    } catch {
      return '';
    }
  };
  const baseName = file =>
    String(file || '')
      .split(/[\\/]/)
      .pop();
  const unquote = text => String(text || '').replace(/^["']|["']$/g, '');

  // ---------- which entries are designs ----------
  // An action entry → the designs in it: [{ kind: 'page' | 'picture', file, how, since }]. `how`:
  // 'showed' (tnai show), 'wrote' (the agent's own write), 'made' (a command changed it, inferred).
  function find(entry) {
    if (!entry || entry.kind !== 'act') return [];
    const verb = String(entry.verb || '');
    const what = String(entry.what || '');
    const found = [];
    if (verb === 'Wrote' || verb === 'Edited' || verb === 'Made an image') {
      // a patch of several files names them joined by ", " (thread-log-codex.js)
      for (const file of what.split(/,\s+/)) {
        const name = file.trim();
        if (PICTURE.test(name)) found.push({ kind: 'picture', file: name, how: 'wrote' });

        // A page only when written whole: an edit of a site's index.html is part of the
        // site, not a design to look at.
        else if (verb === 'Wrote' && PAGE.test(name))
          found.push({ kind: 'page', file: name, how: 'wrote' });
      }
      return found;
    }
    if (verb !== 'Ran') return found;
    const command = String(entry.full || what);
    const shown = SHOW_COMMAND.exec(command);
    if (shown && PAGE.test(unquote(shown[1])))
      found.push({ kind: 'page', file: unquote(shown[1]), how: 'showed' });

    // A picture a command made can only be told by its change time, so a command without a
    // recorded start time adds none.
    if (!entry.at || LOOKS_ONLY.test(command)) return found;
    const seen = new Set();
    PICTURE_IN_COMMAND.lastIndex = 0;
    for (let match; (match = PICTURE_IN_COMMAND.exec(command));) {
      const file = match[1];
      if (seen.has(file.toLowerCase()) || seen.size >= MAX_FROM_COMMAND) continue;
      seen.add(file.toLowerCase());
      found.push({ kind: 'picture', file, how: 'made', since: entry.at });
    }
    return found;
  }

  // ---------- designs waiting for their place ----------
  // state (122's, one per conversation) → { items, add }: what the current stretch of actions made
  const waiting = new WeakMap();
  const waitingStates = new Set();

  // 122: an action was drawn
  function note(state, entry, add) {
    // the browser page has no files to show
    if (!native?.designs) return;
    const items = find(entry);
    if (!items.length) return;
    let wait = waiting.get(state);
    if (!wait) {
      wait = { items: [], add };
      waiting.set(state, wait);
      waitingStates.add(state);
    }
    wait.add = add;
    for (const item of items) {
      // the same file twice in one stretch (written, then shown) is one design; showing it says
      // more than writing it
      const same = wait.items.find(
        other => other.kind === item.kind && other.file.toLowerCase() === item.file.toLowerCase()
      );
      if (!same) wait.items.push(item);
      else if (item.how === 'showed') same.how = 'showed';
    }
  }

  // 122: the agent's next words, the end of the task or the user's prompt comes now, so what
  // waits goes in before it
  function place(state, add) {
    const wait = waiting.get(state);
    if (!wait?.items.length) return;
    waiting.delete(state);
    waitingStates.delete(state);
    const put = add || wait.add;
    const pages = wait.items.filter(item => item.kind === 'page');
    const pictures = wait.items.filter(item => item.kind === 'picture');
    pages.forEach((item, index) =>
      put(pageCard(state, item, index === pages.length - 1 ? pictures : []))
    );
    if (!pages.length && pictures.length) put(pictureCard(state, pictures));
  }

  // A task that ended right after its last design (no words after it) still gets its card.
  window.addEventListener('tnai:turn', event => {
    const paneId = event.detail?.paneId;
    let ended = 0;
    try {
      ended = window.TnaiTurns?.get?.(paneId)?.endedAt || 0;
    } catch {}
    if (!ended) return;
    for (const state of [...waitingStates]) if (state.paneId === paneId) place(state);
  });

  // ---------- the cards ----------
  const HOW = {
    page: { showed: 'a page it showed', wrote: 'a page it wrote' },
    picture: { wrote: 'a picture it wrote', made: 'a picture a command made' },
  };
  const INFERRED = 'Inferred: the file changed while the command that names it ran';

  function button(label, title, onPress) {
    const press = make('button', '', label);
    press.type = 'button';
    press.title = title;
    press.addEventListener('click', event => {
      event.stopPropagation();
      onPress(press);
    });
    return press;
  }

  function cardTop(iconName, name, how, actions) {
    const top = make('div', 'tnt-design-top');
    const glyph = make('span', 'tnt-design-icon');
    glyph.innerHTML = icon(iconName, 14);
    const title = make('b', '', name);
    title.title = name;
    const what = make('span', 'tnt-design-how', '· ' + how);
    const row = make('div', 'tnt-design-actions');
    row.append(...actions);
    top.append(glyph, title, what, make('span', 'tnt-design-grow'), row);
    return top;
  }

  // Asks for the card's pictures once it is close to the screen, so an old conversation full of
  // designs reads none of them until the user scrolls there.
  const nearScreen = new IntersectionObserver(
    entries =>
      entries.forEach(({ target, isIntersecting }) => {
        if (!isIntersecting) return;
        nearScreen.unobserve(target);
        target.tntDesignLoad?.();
      }),
    { rootMargin: '600px 0px' }
  );

  function pageCard(state, item, pictures) {
    const card = make('div', 'tnt-design');
    card.dataset.kind = 'page';
    card.dataset.state = 'loading';

    // hidden until the file is known to be there and to be a page that holds itself
    card.hidden = true;
    const frame = make('button', 'tnt-design-frame');
    frame.type = 'button';
    frame.title = 'The page itself, small and still: Open large to use it';
    const live = button('Live preview', 'Open this page in Live preview', press =>
      toPreview(state, item, press)
    );
    const large = button('Open large', 'Open this page large, over the thread', () =>
      openLarge({ kind: 'page', state, item, opener: large })
    );
    frame.addEventListener('click', () => openLarge({ kind: 'page', state, item, opener: frame }));
    card.append(
      cardTop('file-text', baseName(item.file), HOW.page[item.how], [large, live]),
      frame
    );
    if (pictures.length)
      foundPictures(state, pictures).then(list => {
        if (list.length) card.append(pictureRow(state, list));
      });
    native?.designs
      ?.page?.(state.paneId, item.file, { shot: false })
      .then(found => {
        // a written page that asks for other files belongs to a site and would not draw on its own
        if (!found?.ok || (item.how === 'wrote' && found.refs?.length)) {
          if (pictures.length) card.replaceWith(pictureCard(state, pictures));
          else card.remove();
          return;
        }
        card.hidden = false;
        card.tntDesignLoad = () => paintShot(state, item, card, frame);
        nearScreen.observe(card);
      })
      .catch(() => card.remove());
    return card;
  }

  function paintShot(state, item, card, frame) {
    native.designs
      .page(state.paneId, item.file)
      .then(found => {
        card.dataset.state = found?.image ? 'ready' : 'none';
        if (!found?.image) {
          frame.replaceChildren(make('span', 'tnt-design-none', 'No still picture of this page'));
          return;
        }
        const image = make('img');
        image.alt = 'The page ' + baseName(item.file) + ', small';
        image.decoding = 'async';
        image.src = found.image;
        frame.replaceChildren(image);
      })
      .catch(() => {
        card.dataset.state = 'none';
      });
  }

  // The pictures that are there to show. One a command only named is left out: the app shows it
  // only when the file changed while that command ran.
  function foundPictures(state, pictures) {
    return Promise.all(
      pictures.map(item =>
        (
          native?.designs?.picture?.(state.paneId, item.file, { since: item.since, check: true }) ||
          Promise.resolve(null)
        ).catch(() => null)
      )
    ).then(results => pictures.filter((_item, index) => results[index]?.ok));
  }

  // Pictures without a page: one shown as itself, several as a row with their names. The card
  // stays hidden until the app knows which of them are there, and goes when none is.
  function pictureCard(state, pictures) {
    const card = make('div', 'tnt-design');
    card.dataset.kind = 'picture';
    card.hidden = true;
    foundPictures(state, pictures).then(list => {
      if (!list.length) {
        card.remove();
        return;
      }
      const first = list[0];
      const made = list.every(item => item.how === 'made');
      const actions = [];
      if (list.length === 1) {
        const large = button('Open large', 'Open this picture at its full size', () =>
          openLarge({ kind: 'picture', state, item: first, opener: large })
        );
        actions.push(large);
      }
      let how = made ? 'pictures a command made' : 'pictures it wrote';
      if (list.length === 1) how = HOW.picture[first.how];
      const name = list.length === 1 ? baseName(first.file) : list.length + ' pictures';
      const top = cardTop('file', name, how, actions);
      if (made) top.querySelector('.tnt-design-how').title = INFERRED;
      card.append(top);
      if (list.length === 1) {
        const frame = make('button', 'tnt-design-frame tnt-design-picture');
        frame.type = 'button';
        frame.title = 'Open this picture at its full size';
        frame.addEventListener('click', () =>
          openLarge({ kind: 'picture', state, item: first, opener: frame })
        );
        card.append(frame);
        card.tntDesignLoad = () => paintThumb(state, first, frame);
        nearScreen.observe(card);
      } else card.append(pictureRow(state, list));
      card.hidden = false;
    });
    return card;
  }

  // Pictures as a row, each with its name; a press opens one at its full size.
  function pictureRow(state, pictures) {
    const row = make('div', 'tnt-design-shots');
    for (const item of pictures) {
      const shot = make('button', 'tnt-design-shot');
      shot.type = 'button';
      shot.title =
        (item.how === 'made' ? INFERRED + '. ' : '') +
        'Open ' +
        baseName(item.file) +
        ' at its full size';
      const box = make('span', 'tnt-design-thumb');
      shot.append(box, make('b', '', baseName(item.file)));
      shot.addEventListener('click', () =>
        openLarge({ kind: 'picture', state, item, opener: shot })
      );
      row.append(shot);
      shot.tntDesignLoad = () => paintThumb(state, item, box);
      nearScreen.observe(shot);
    }
    return row;
  }

  function paintThumb(state, item, box) {
    native.designs
      .picture(state.paneId, item.file, { since: item.since })
      .then(found => {
        if (!found?.image) {
          box.replaceChildren(make('span', 'tnt-design-none', 'Too large to show small'));
          return;
        }
        const image = make('img');
        image.alt = baseName(item.file);
        image.decoding = 'async';
        image.src = found.image;
        box.replaceChildren(image);
      })
      .catch(() => {});
  }

  // ---------- Live preview ----------
  function toPreview(state, item, press) {
    press.disabled = true;
    native.designs
      .preview(state.paneId, item.file)
      .then(result => {
        if (result?.ok) window.TnaiLivePreviewPage?.open?.();
        else press.title = 'Not shown: ' + (result?.error || 'the page could not be opened');
      })
      .catch(() => {})
      .finally(() => {
        press.disabled = false;
      });
  }

  // ---------- Open large ----------
  // One layer over the window: the page in a walled frame (the preview frame's name, so the app
  // takes WebRTC away from it as from a Live preview page), or the picture at its full size. Esc,
  // the close button or a press beside it closes the layer and gives the keyboard back.
  let layer = null;

  function closeLarge() {
    if (!layer) return;
    const { node, opener, onKey } = layer;
    layer = null;
    document.removeEventListener('keydown', onKey, true);
    node.dataset.on = 'false';
    const gone = () => node.remove();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) gone();
    else setTimeout(gone, 180);
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }

  function openLarge({ kind, state, item, opener }) {
    closeLarge();
    const node = make('div', 'tnt-design-layer');
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-label', baseName(item.file));
    const box = make('div', 'tnt-design-layer-box');
    const head = make('div', 'tnt-design-layer-head');
    const close = make('button', 'tnt-design-close');
    close.type = 'button';
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
    close.innerHTML = icon('x', 16);
    close.addEventListener('click', closeLarge);
    const actions = make('div', 'tnt-design-actions');
    if (kind === 'page')
      actions.append(
        button('Live preview', 'Open this page in Live preview', press => {
          toPreview(state, item, press);
          closeLarge();
        })
      );
    head.append(
      make('b', '', baseName(item.file)),
      make('span', 'tnt-design-grow'),
      actions,
      close
    );
    const body = make('div', 'tnt-design-layer-body');
    body.append(make('span', 'tnt-design-none', 'Opening…'));
    box.append(head, body);
    node.append(box);
    node.addEventListener('click', event => {
      if (event.target === node) closeLarge();
    });
    const onKey = event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeLarge();
        return;
      }

      // the keyboard stays inside the layer while it is open
      if (event.key !== 'Tab') return;
      const stops = [...node.querySelectorAll('button, iframe')];
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey, true);
    layer = { node, opener, onKey };
    document.body.append(node);
    requestAnimationFrame(() => {
      node.dataset.on = 'true';
    });
    close.focus({ preventScroll: true });
    const ask =
      kind === 'page'
        ? native.designs.page(state.paneId, item.file, { shot: false })
        : native.designs.picture(state.paneId, item.file, { since: item.since, large: true });
    ask
      .then(found => {
        if (layer?.node !== node) return;
        if (!found?.ok) {
          body.replaceChildren(make('span', 'tnt-design-none', 'This file is no longer there'));
          return;
        }
        if (kind === 'page') {
          const frame = make('iframe');
          frame.name = 'tnai-lp-design';
          frame.title = baseName(item.file);
          frame.setAttribute('sandbox', 'allow-scripts allow-forms');
          frame.referrerPolicy = 'no-referrer';
          frame.src = found.url;
          body.replaceChildren(frame);
          return;
        }
        const image = make('img');
        image.alt = baseName(item.file);
        image.src = found.image;
        body.replaceChildren(image);
      })
      .catch(() => {});
  }

  // openLarge: 170 opens a picture or page it lists the same way
  window.TnaiThreadDesigns = { find, note, place, close: closeLarge, openLarge };
})();
