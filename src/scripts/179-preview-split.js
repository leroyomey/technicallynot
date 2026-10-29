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
 * Charts stack (user 2026-10-28: "keep adding them below the next graph, formatting neatly ...
 * that can be viewed by scrolling down"): each chart's icon adds its chart under the ones already
 * there, the column scrolls and the newest slides into view. Each large card has its own close.
 * A chart already there is not added again: it is scrolled to and flashes. The stack belongs to
 * the thread it was made in: another thread shows its own stack or none, and coming back shows it
 * again. Pushing the column back keeps the stack; the next chart opens it with the new one added.
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

  // a view for each other kind beside the thread ('step' from 181, 'picture' from 182), made once
  const nodeViews = {};
  const pushers = new Set();

  // The charts each thread pushed beside it: thread id → { holder, items (chart key → its large
  // card), reopen (it was shown when the user left the thread) }. `openKey` is STACK + thread id
  // while a stack is shown.
  const STACK = 'charts:';
  const stacks = new Map();
  const threadNow = () => String(safe(() => window.TnaiThreads?.selected?.(), '') || '');
  const shownStack = () =>
    openKey.startsWith(STACK) ? stacks.get(openKey.slice(STACK.length)) : null;

  // Every split icon says whether its page or chart is beside the thread now.
  function paintPushers() {
    const stack = shownStack();
    for (const button of pushers) {
      // an icon is made before it is put on the page: it is let go only once it was on the page
      // and left it (a message drawn again), never while it is still waiting to be placed
      if (!button.isConnected) {
        if (button.tntPlaced) pushers.delete(button);
        continue;
      }
      button.tntPlaced = true;
      const key = button.tntSplitUrl;
      const isChart = String(key || '').startsWith('chart:');
      const on = !!openKey && (key === openKey || (isChart && !!stack?.items.has(key)));
      button.setAttribute('aria-pressed', String(on));
      let label = 'Open beside the thread';
      if (on) label = isChart ? 'Show it beside the thread' : 'Push the page back';
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
    const stackHolders = [...stacks.values()].map(stack => stack.holder);
    for (const other of [view, ...Object.values(nodeViews), ...stackHolders]) {
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
  // Charts go to the thread's stack.
  function openNode(key, title, draw, what = 'chart') {
    if (what === 'chart') return openChart(key, title, draw);
    if (!key || !window.TnaiThreadSide?.preview) return false;
    const node = safe(() => draw(), null);
    if (!node) return false;
    place(key, nodeViewFor(what, title, node));
    return true;
  }

  const reducedMotion = () =>
    safe(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, false);
  const later = (run, ms) => safe(() => setTimeout(run, ms), null);
  const nextFrame = run =>
    safe(() => (window.requestAnimationFrame || (fn => setTimeout(fn, 16)))(run), null);

  // The thread's stack of charts, made the first time one of its charts is pushed over.
  function stackFor(thread) {
    let stack = stacks.get(thread);
    if (stack) return stack;
    const holder = makeView('charts');
    const body = holder.querySelector('.tnt-split-body');
    body.classList.add('tnt-split-chart');
    body.classList.add('tnt-split-stack');
    stack = { holder, body, items: new Map(), reopen: false };
    stacks.set(thread, stack);
    return stack;
  }

  // The bar names the one chart, or says how many there are.
  function nameStack(stack) {
    const cards = [...stack.items.values()];
    if (cards.length === 1) named(stack.holder, cards[0].tntTitle, 'Chart');
    else named(stack.holder, cards.length + ' charts', 'Charts');
  }

  // Scrolls the stack so `item` is in view; again once the column has finished sliding, since
  // the cards change height while it widens.
  function reveal(stack, item, flash) {
    const scroll = () => {
      if (!item.isConnected) return;
      const top = Math.max(0, item.offsetTop - 4);
      const bottom = top + item.offsetHeight - stack.body.clientHeight + 8;
      const now = stack.body.scrollTop;
      const to = now > top ? top : now < bottom ? Math.min(top, bottom) : now;
      if (to === now) return;
      const behavior = reducedMotion() ? 'auto' : 'smooth';
      if (typeof stack.body.scrollTo === 'function') stack.body.scrollTo({ top: to, behavior });
      else stack.body.scrollTop = to;
    };
    nextFrame(scroll);
    later(scroll, SLIDE_MS + 80);
    if (flash) {
      item.classList.remove('tnt-split-flash');
      nextFrame(() => item.classList.add('tnt-split-flash'));
      later(() => item.classList.remove('tnt-split-flash'), 1300);
    }
  }

  // One large card in the stack, with its own close in the card's head.
  function stackItem(stack, key, title, node) {
    const item = make('div', 'tnt-split-item');
    item.tntKey = key;
    item.tntTitle = title;
    const drop = make('button', 'tnt-split-push tnt-chart-push tnt-split-drop');
    drop.type = 'button';
    drop.innerHTML = icon('x');
    drop.title = 'Close this chart';
    drop.setAttribute('aria-label', 'Close this chart');
    drop.addEventListener('click', event => {
      event.stopPropagation();
      dropChart(stack, key);
    });
    const head = node.querySelector?.('.tnt-chart-head');
    if (head) head.append(drop);
    else item.append(drop);
    item.append(node);
    return item;
  }

  // A chart's own close: it fades out and leaves; the last one pushes the column back.
  function dropChart(stack, key) {
    const item = stack.items.get(key);
    if (!item) return;
    stack.items.delete(key);
    const gone = () => safe(() => item.remove(), null);
    if (reducedMotion()) gone();
    else {
      item.classList.add('tnt-split-leaving');
      later(gone, 180);
    }
    if (!stack.items.size) {
      if (shownStack() === stack) close();
      stack.reopen = false;
    } else nameStack(stack);
    paintPushers();
  }

  // A chart beside the thread: added under the ones already there, or, when it is there already,
  // scrolled to and flashed.
  function openChart(key, title, draw) {
    if (!key || !window.TnaiThreadSide?.preview) return false;
    const thread = threadNow();
    const known = stacks.get(thread)?.items.get(key);
    let item = known;
    if (!known) {
      const node = safe(() => draw(), null);
      if (!node) return false;
      const stack = stackFor(thread);
      item = stackItem(stack, key, title || 'Chart', node);
      if (!reducedMotion()) item.classList.add('tnt-split-new');
      stack.items.set(key, item);
      stack.body.append(item);
      later(() => item.classList.remove('tnt-split-new'), 400);
    }
    const stack = stacks.get(thread);
    nameStack(stack);
    stack.reopen = false;
    if (shownStack() !== stack) place(STACK + thread, stack.holder);
    else {
      // already beside the thread: bring its tab forward in case the user picked another one
      safe(() => window.TnaiThreadSide.preview(stack.holder, true), null);
      paintPushers();
    }
    reveal(stack, item, !!known);
    return true;
  }

  // The split icon in a chart card's head: adds the chart beside the thread, or finds it there.
  function chartButton(key, title, draw) {
    const press = make('button', 'tnt-split-push tnt-chart-push');
    press.type = 'button';
    press.innerHTML = icon('columns-2');
    press.tntSplitUrl = key;
    pushers.add(press);
    paintPushers();

    // painted again once 178 has put it in the card (a message drawn again while its chart is
    // beside the thread shows it lit)
    nextFrame(paintPushers);
    press.addEventListener('click', event => {
      event.stopPropagation();
      openChart(key, title, draw);
    });
    return press;
  }

  // Another thread is opened: its own stack takes the column when it was shown there, a stack of
  // the thread left goes and comes back with it. A page or a step beside the thread stays.
  function threadChanged() {
    const thread = threadNow();
    for (const id of [...stacks.keys()]) {
      const gone =
        id &&
        id !== thread &&
        window.TnaiThreadList?.thread &&
        !safe(() => window.TnaiThreadList.thread(id), true);
      if (gone && shownStack() !== stacks.get(id)) stacks.delete(id);
    }
    const left = shownStack();
    const next = stacks.get(thread);
    if (left && left === next) return;
    if (left) left.reopen = true;
    if (next?.reopen && next.items.size && (left || !openKey)) {
      next.reopen = false;
      nameStack(next);
      place(STACK + thread, next.holder);
      return;
    }
    if (left) close();
  }
  window.addEventListener?.('tnai:threads-select', threadChanged);

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
