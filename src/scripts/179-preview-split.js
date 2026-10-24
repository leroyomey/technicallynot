/*
 * Technically Not · 179-preview-split.js — a page beside the thread (user 2026-10-23, mock
 * docs/plans/design-concepts/preview-split.html: "an icon on particular live preview thread windows
 * ... pushed over and basically create like a dual layout where user can see the thread and the
 * live preview. Making everything flow super smoothly").
 *
 * A split icon on a page or site card of "What it made" (170) and beside "Open large" on its
 * preview. Pressed, the page opens working in the side column's Live preview tab (131 `preview`,
 * Live preview's own view with its address bar, 31 `mount`), and the column slides out to half of
 * the space beside the thread list; the thread keeps the other half. The column's own handle (133)
 * still drags the line between them. The split icon in the page's bar, the card's icon again, or
 * Esc (when no text box has the keyboard) push it back: the column returns to the width it had,
 * or closes when it was closed. Another card's icon swaps the page. The width the user dragged to
 * is never overwritten by the split.
 *
 * A chart card (178) has the same icon (`chartButton`): the card is drawn again, large, in the
 * column the same way (user 2026-10-23: "allow the graphs to be pushed over like live previews").
 * The column holds one view at a time, so a chart and a page swap each other.
 *
 * Test: node tools/preview-split-test.js
 */
(() => {
  'use strict';

  const layout = document.querySelector('.layout');

  // how long the column takes to slide (matches 57's transition)
  const SLIDE_MS = 380;

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };
  const icon = (name, size = 16) => safe(() => window.TnaiIcon?.(name, { size }) || '', '');
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  let openKey = '';
  let before = null;
  let view = null;

  // a view for each other kind beside the thread ('chart' from 178, 'step' from 181), made once
  const nodeViews = {};
  const pushers = new Set();

  // Every split icon says whether its page is the one beside the thread now.
  function paintPushers() {
    for (const button of pushers) {
      if (!button.isConnected) {
        pushers.delete(button);
        continue;
      }
      const on = !!openKey && button.tntSplitUrl === openKey;
      button.setAttribute('aria-pressed', String(on));
      const what = String(button.tntSplitUrl || '').startsWith('chart:') ? 'chart' : 'page';
      const label = on ? 'Push the ' + what + ' back' : 'Open beside the thread';
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  }

  // The column slides between widths instead of jumping (no hard cuts; off under reduced motion).
  function slide(change) {
    if (!layout) return change();
    layout.classList.add('tnt-split-moving');
    change();
    setTimeout(() => layout.classList.remove('tnt-split-moving'), SLIDE_MS + 60);
  }

  function halfWidth() {
    const list = layout?.querySelector(':scope > .tnt-list');
    const room = (layout?.clientWidth || 0) - (list?.offsetWidth || 0);
    return Math.max(320, Math.round(room / 2));
  }

  // A view for the side column: its name, the push-back icon, and a body under them.
  function makeView(what) {
    const holder = make('div', 'tnt-split');
    const bar = make('div', 'tnt-split-bar');
    const name = make('b', 'tnt-split-name');
    const back = make('button', 'tnt-split-back');
    back.type = 'button';
    back.innerHTML = icon('columns-2');
    back.title = 'Push the ' + what + ' back (Esc)';
    back.setAttribute('aria-label', 'Push the ' + what + ' back');
    back.setAttribute('aria-pressed', 'true');
    back.addEventListener('click', close);
    bar.append(name, back);
    holder.append(bar, make('div', 'tnt-split-body'));
    return holder;
  }

  function named(holder, title, fallback) {
    const name = holder.querySelector('.tnt-split-name');
    name.textContent = title || fallback;
    name.title = title || '';
  }

  // The view that holds a page: Live preview's own view, made once.
  function viewFor(title) {
    if (!view) {
      view = makeView('page');
      const host = view.querySelector('.tnt-split-body');
      safe(() => window.TnaiLivePreview?.mount?.(host, { browser: true }), null);
    }
    named(view, title, 'Page');
    return view;
  }

  // The view that holds a node of another file: a chart card drawn again large (178), a step of
  // the agent's work (181). `what` names it in the push-back button.
  function nodeViewFor(what, title, node) {
    if (!nodeViews[what]) nodeViews[what] = makeView(what);
    const holder = nodeViews[what];
    named(holder, title, what[0].toUpperCase() + what.slice(1));
    const body = holder.querySelector('.tnt-split-body');
    body.classList.add('tnt-split-chart');
    body.replaceChildren(node);
    return holder;
  }

  // Others (181) follow what is beside the thread: the key now shown, '' when nothing is.
  const changed = () =>
    safe(
      () =>
        window.dispatchEvent(new CustomEvent('tnai:split-changed', { detail: { key: openKey } })),
      null
    );

  // Puts a view beside the thread; the column's width before the first one is kept for the way
  // back.
  function place(key, holder) {
    const side = window.TnaiThreadSide;
    if (!openKey) {
      before = {
        width: layout?.style.getPropertyValue('--tnt-side-w') || '',
        shown: safe(() => side.state().shown, false),
      };
    }
    openKey = key;

    // the side column shows one view at a time: the other one leaves
    for (const other of [view, ...Object.values(nodeViews)]) {
      if (other && other !== holder) safe(() => other.remove(), null);
    }
    side.preview(holder, true);
    slide(() => layout?.style.setProperty('--tnt-side-w', halfWidth() + 'px'));
    paintPushers();
    changed();
  }

  function open(url, title) {
    const preview = window.TnaiLivePreview;
    const side = window.TnaiThreadSide;
    if (!url || !preview?.addUrl || !side?.preview) return false;
    const added = safe(() => preview.addUrl(url), null);
    if (!added?.ok) return false;
    safe(() => preview.select(added.id), null);
    place(url, viewFor(title));
    return true;
  }

  // A node beside the thread: `draw` makes it, `key` names it for its icon, `what` is its kind.
  function openNode(key, title, draw, what = 'chart') {
    if (!key || !window.TnaiThreadSide?.preview) return false;
    const node = safe(() => draw(), null);
    if (!node) return false;
    place(key, nodeViewFor(what, title, node));
    return true;
  }
  const openChart = (key, title, draw) => openNode(key, title, draw, 'chart');

  // The split icon in a chart card's head.
  function chartButton(key, title, draw) {
    const press = make('button', 'tnt-split-push tnt-chart-push');
    press.type = 'button';
    press.innerHTML = icon('columns-2');
    press.tntSplitUrl = key;
    pushers.add(press);
    paintPushers();
    press.addEventListener('click', event => {
      event.stopPropagation();
      if (openKey === key) close();
      else openChart(key, title, draw);
    });
    return press;
  }

  function close() {
    if (!openKey) return;
    const side = window.TnaiThreadSide;
    const was = before || { width: '', shown: true };
    openKey = '';
    before = null;
    slide(() => {
      if (was.width) layout?.style.setProperty('--tnt-side-w', was.width);
      else layout?.style.removeProperty('--tnt-side-w');
      safe(() => side?.preview?.(null, false), null);
      if (!was.shown) safe(() => side?.close?.(), null);
    });
    paintPushers();
    changed();
  }

  // A split icon for a page: `getUrl` gives its address (it may have to be asked for).
  function button(getUrl, title, className = 'tnt-split-push') {
    const press = make('button', className);
    press.type = 'button';
    press.innerHTML = icon('columns-2');
    pushers.add(press);
    paintPushers();
    press.addEventListener('click', async event => {
      event.stopPropagation();
      if (press.tntSplitUrl && press.tntSplitUrl === openKey) {
        close();
        return;
      }
      const url = await Promise.resolve(safe(() => getUrl(), '')).catch(() => '');
      if (!url) return;
      press.tntSplitUrl = url;
      open(url, title);
    });
    return press;
  }

  // A card with its split icon: a card is a button itself, so the icon stands beside it in a cell.
  function cell(card, getUrl, title) {
    if (!window.TnaiThreadSide?.preview || !window.TnaiLivePreview?.addUrl) return card;
    const box = make('div', 'tnt-split-cell');
    box.append(card, button(getUrl, title, 'tnt-split-push tnt-split-oncard'));
    return box;
  }

  // Esc pushes the page back, unless a text box or a terminal has the keyboard (they use Esc).
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !openKey || event.defaultPrevented) return;
    if (event.target?.closest?.('input, textarea, [contenteditable="true"], .xterm')) return;
    close();
  });

  window.TnaiPreviewSplit = {
    open,
    openChart,
    openNode,
    close,
    button,
    chartButton,
    cell,
    shown: () => openKey,
  };
})();
