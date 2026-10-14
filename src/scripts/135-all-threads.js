/*
 * Technically Not · 135-all-threads.js — Desktop only: the "All threads" page. It stands where the
 * terminals' slideshow stood (the Terminal page in 105's mode `pages`, with Live preview beside
 * it), and shows the project's threads side by side as conversations: three at the full height of
 * the page (two or one when the width does not hold three), each with its name, its tool and its
 * state over the conversation 122 reads from the tool's own record. A thread whose tool keeps no
 * such record (PowerShell) says so in one line, with a button to its screen.
 *
 * One step moves ONE thread: an arrow at each side, Ctrl+Alt+Left and Right, a sideways slide on
 * a trackpad, and a dot per thread under the row. A press on a thread makes it the one the prompt
 * box under the row sends to; the button in its top row opens it on the Threads page.
 *
 * A question an agent waits on (a tool permission, "Trust this folder?") stands as a card at the
 * foot of its thread, answered there (121 `TnaiThreadAsks.mount`); a question the agent asks with
 * its own tool is a box in the conversation (122). The page's top row has "New thread", which
 * presses the thread list's own button; the buttons that add or arrange terminal panels are not
 * shown here (38).
 *
 * The terminal panels of the page are still there underneath, unseen (their sessions run in them);
 * 126, which laid them out as pages, stands down while this view is on. Window tests use 105's
 * mode `terminals`, which this file leaves alone.
 *
 * `window.TnaiAllThreads` (`on`, `state`, `go`, `show`). Look: src/styles/38-all-threads.css.
 * Tests `all-threads`, `all-threads-asks`.
 */
(() => {
  const view = document.getElementById('terminalView');
  const content = view?.querySelector('.terminal-content');
  const layout = document.querySelector('.layout');
  if (!view || !content || !layout || !window.tnaiNative) return;

  // The room between two threads, the narrowest a thread is worth reading at, and how many stand
  // side by side when the width holds them.
  const GAP = 12;
  const MIN_W = 340;
  const PER = 3;

  // With more threads than this the dots would be a long row: the place is said in words.
  const MAX_DOTS = 14;

  // After a slide on a trackpad, this long without one before the next slide counts.
  const WHEEL_REST_MS = 450;

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
  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };

  // ---------- the parts ----------
  const box = make('div', 'tat');
  box.hidden = true;
  const strip = make('div', 'tat-strip');
  const none = make('p', 'tat-none', 'No threads yet. Start an agent with New thread.');
  none.hidden = true;

  function makeArrow(side, iconName, label, keys) {
    const button = make('button', 'tat-nav tat-' + side);
    button.type = 'button';
    button.innerHTML = icon(iconName);
    button.setAttribute('aria-label', label);
    button.title = window.tnaiKeys?.(label + ' (' + keys + ')') || label + ' (' + keys + ')';
    return button;
  }
  const previous = makeArrow('prev', 'chevron-left', 'Previous thread', 'Ctrl+Alt+Left');
  const next = makeArrow('next', 'chevron-right', 'Next thread', 'Ctrl+Alt+Right');
  const dots = make('div', 'tat-dots');
  dots.setAttribute('role', 'group');
  const placeWords = make('span');

  // the row is cut at the arrows, so a thread that slides out is not seen beside or under them
  const clip = make('div', 'tat-clip');
  clip.append(strip);
  box.append(previous, clip, next, none, dots);
  content.append(box);

  // ---------- what is shown ----------
  // The cards by thread, the order they stand in, and the first one on screen.
  const cards = new Map();
  let order = [];
  let first = 0;
  let per = PER;

  const preview = () => window.TnaiTerminalPreview;

  // Whether this page is the one shown is told from the route's classes, never from a read of
  // the view's box: that read lays the page out, and it was made at every change of the page's
  // classes and by every repaint of the cards (measured 2026-10-13, `perf-background-switch`).
  const isOn = () => !!preview() && layout.classList.contains('terminal-mode') && !view.hidden;
  const readable = () => window.TnaiThreadReadable;
  const questions = () => window.TnaiThreadAsks;
  const list = () => window.TnaiThreadList;
  const target = () => window.TnaiLiveTasks?.target?.() || '';

  // The project's own threads in the list's order (a helper shown inside its lead's row and an
  // agent of another computer have no conversation of their own here).
  function readOrder() {
    const rows = list()?.rows?.() || [];
    return rows.filter(row => row.paneId && !row.remote && !row.sub).map(row => row.paneId);
  }

  // While the page is shown its threads keep their places. The thread list moves a thread that
  // waits on the user to its top; here that would slide the asking thread out of sight and put
  // another card under the pointer. A thread that is new stands at the end; the list's own order
  // is taken again the next time the page is opened.
  function steadyOrder(listed) {
    const kept = order.filter(paneId => listed.includes(paneId));
    const added = listed.filter(paneId => !kept.includes(paneId));
    return [...kept, ...added];
  }

  function makeCard(paneId) {
    const el = make('section', 'tat-card');
    el.dataset.pane = paneId;
    el.tabIndex = 0;
    const head = make('header', 'tat-head');
    const dot = make('i', 'tat-dot');
    const text = make('div', 'tat-head-text');
    const name = make('b');
    const sub = make('small');
    text.append(name, sub);
    const open = make('button', 'tat-open');
    open.type = 'button';
    open.innerHTML = icon('maximize-2', 13);
    open.title = 'Open this thread on its own';
    open.setAttribute('aria-label', 'Open this thread on its own');
    head.append(dot, text, open);
    const body = make('div', 'tnt-talk tat-body');
    body.setAttribute('role', 'log');

    // A thread whose tool keeps no conversation to read (a PowerShell thread): one line of words
    // and one button to its screen.
    const plain = make('div', 'tat-plain');
    const plainWords = make('p', '', 'This thread is a terminal. Open its screen to type.');
    const plainOpen = make('button', 'terminal-tool tat-screen', 'Open its screen');
    plainOpen.type = 'button';
    plain.append(plainWords, plainOpen);
    plain.hidden = true;

    // the thread's questions for the user, under its conversation (121 fills it)
    const asks = make('div', 'tnt-asks tat-asks');
    asks.hidden = true;
    el.append(head, body, plain, asks);
    return { el, dot, name, sub, body, plain, asks, mounted: false, asking: false };
  }

  // A card's words and its state, from the thread list's own reading of the session.
  function paintCard(paneId, card) {
    const thread = list()?.thread?.(paneId);
    if (!thread) return;
    setText(card.name, thread.name || 'Thread');
    setText(card.sub, [thread.tool, thread.label].filter(Boolean).join(' · '));
    if (card.dot.dataset.tone !== (thread.tone || '')) card.dot.dataset.tone = thread.tone || '';
    card.el.setAttribute('aria-label', (thread.name || 'Thread') + ', ' + (thread.tool || ''));
    const can = !!readable()?.can?.(thread.tool);
    card.plain.hidden = can;
    card.body.hidden = !can;
    card.can = can;
  }

  // Only the threads on screen and one to each side are read; the others let go of their
  // conversation, so a project with twenty threads reads five.
  function mountNear() {
    order.forEach((paneId, index) => {
      const card = cards.get(paneId);
      const near = index >= first - 1 && index <= first + per;
      if (near && card.can && !card.mounted) {
        readable()?.mount?.(card.body, paneId);
        card.mounted = true;
      } else if ((!near || !card.can) && card.mounted) {
        readable()?.unmount?.(card.body);
        card.mounted = false;
      }

      // Questions only for the threads in sight: for one that is not, the app's own floating card
      // still asks (121 puts that card away for a question that stands in a thread here).
      const inSight = index >= first && index < first + per;
      if (inSight && !card.asking) card.asking = !!questions()?.mount?.(card.asks, paneId);
      else if (!inSight && card.asking) letGoOfAsks(card);
    });
  }

  function letGoOfAsks(card) {
    if (!card.asking) return;
    questions()?.unmount?.(card.asks);
    card.asking = false;
  }

  function paintNav() {
    const count = order.length;
    const last = Math.max(0, count - per);
    const many = count > per;
    previous.hidden = next.hidden = dots.hidden = !many;
    previous.disabled = first <= 0;
    next.disabled = first >= last;
    if (!many) return;
    const words = 'Threads ' + (first + 1) + ' to ' + Math.min(count, first + per) + ' of ' + count;
    dots.setAttribute('aria-label', words);
    if (count > MAX_DOTS) {
      setText(placeWords, words);
      if (dots.firstChild !== placeWords || dots.children.length > 1)
        dots.replaceChildren(placeWords);
      return;
    }
    if (placeWords.isConnected) placeWords.remove();
    while (dots.children.length > count) dots.lastChild.remove();
    while (dots.children.length < count) {
      const dot = make('button');
      dot.type = 'button';
      dots.append(dot);
    }
    [...dots.children].forEach((dot, index) => {
      const label = cards.get(order[index])?.name.textContent || 'Thread ' + (index + 1);
      dot.dataset.index = String(index);
      if (dot.title !== label) dot.title = label;
      dot.setAttribute('aria-label', label);
      const shown = index >= first && index < first + per;
      if (shown) dot.setAttribute('aria-current', 'true');
      else dot.removeAttribute('aria-current');

      // a thread that waits on the user says so on its dot (38 colors it while it is out of sight)
      const tone = cards.get(order[index])?.dot.dataset.tone === 'needs' ? 'needs' : '';
      if ((dot.dataset.tone || '') !== tone) dot.dataset.tone = tone;
    });
  }

  // Every card has one width; a step changes one number and the style sheet slides the row.
  // The row's width is read once a visit and again when its size changes (the observer below),
  // not at every repaint: the read lays the page out, and the cards are repainted at every
  // change of a thread while agents work (measured 2026-10-13, `perf-background-switch`).
  let room = 0;

  function layoutRow() {
    if (!room) room = clip.clientWidth;
    per = Math.max(1, Math.min(PER, Math.floor((room + GAP) / (MIN_W + GAP))));
    per = Math.min(per, Math.max(1, order.length));
    const width = Math.floor((room - GAP * (per - 1)) / per);
    first = Math.max(0, Math.min(first, order.length - per));
    strip.style.setProperty('--tat-w', width + 'px');
    strip.style.setProperty('--tat-gap', GAP + 'px');
    strip.style.setProperty('--tat-shift', -first * (width + GAP) + 'px');
  }

  function markTarget() {
    const now = target();
    for (const [paneId, card] of cards) {
      const on = paneId === now;
      if (card.el.classList.contains('tat-target') !== on)
        card.el.classList.toggle('tat-target', on);
    }
  }

  // ---------- the page's top row ----------
  // "New thread" is the thread list's own button, pressed from here: one way to start an agent,
  // whatever page it is asked from (119 arms the prompt box, 118 brings the Threads page in).
  const listNewButton = () => window.TnaiThreads?.slot?.('list')?.querySelector('.tnt-new') || null;
  const newButton = make('button', 'terminal-tool tat-new');
  newButton.type = 'button';
  newButton.innerHTML = icon('plus', 14) + '<span>New thread</span>';
  newButton.title = 'Start a new agent: type its task in the prompt box';
  newButton.addEventListener('click', () => listNewButton()?.click());
  view.querySelector('.terminal-tools')?.prepend(newButton);

  function paintNewButton() {
    const off = !listNewButton() || listNewButton().disabled;
    if (newButton.disabled !== off) newButton.disabled = off;
  }

  // The room the threads ask of the Live preview column beside them (38 works the width out of
  // these two numbers): up to three threads, and the arrows when there are more. It comes from
  // the number of threads only, never from a measured width, so the row is placed once.
  let roomAsked = '';

  function askRoom() {
    const wanted = Math.min(PER, Math.max(order.length, 1));
    const more = order.length > wanted ? '1' : '0';
    if (roomAsked === wanted + more) return;
    roomAsked = wanted + more;
    view.style.setProperty('--tat-wanted', String(wanted));
    view.style.setProperty('--tat-more', more);
  }

  let wasOn = false;

  // the page's own name says what it shows
  const title = view.querySelector('.terminal-title');
  const titleWas = title?.textContent || 'Terminal';

  // Whether the threads stand or the terminal panels do. Settled in the same step that showed
  // the page, never a frame later: until the class is set the terminal panels underneath are
  // laid out on the page, and a frame could be drawn with them.
  function turn() {
    // Nothing here reads the layout before the class below is set: read first, the page laid
    // out the ten terminal panels underneath on every visit, then the threads (measured
    // 2026-10-13, `perf-background-switch`: a visit took 47 to 75 ms to its first frame).
    const on = isOn();
    if (on === wasOn) return on;
    wasOn = on;
    room = 0;
    box.hidden = !on;
    view.classList.toggle('tat-on', on);
    if (title) setText(title, on ? 'All threads' : titleWas);
    layout.classList.toggle('tat-on', on);
    if (!on) {
      for (const card of cards.values()) {
        letGoOfAsks(card);
        if (card.mounted) {
          readable()?.unmount?.(card.body);
          card.mounted = false;
        }
      }
      return on;
    }

    // the page opens on the thread the prompt box sends to
    order = readOrder();
    askRoom();
    const at = order.indexOf(target());
    if (at >= 0) first = at;
    return on;
  }

  function render() {
    queued = 0;
    if (!turn()) return;
    order = steadyOrder(readOrder());
    askRoom();
    for (const [paneId, card] of cards)
      if (!order.includes(paneId)) {
        if (card.mounted) readable()?.unmount?.(card.body);
        letGoOfAsks(card);
        card.el.remove();
        cards.delete(paneId);
      }
    order.forEach((paneId, index) => {
      let card = cards.get(paneId);
      if (!card) {
        card = makeCard(paneId);
        cards.set(paneId, card);
      }
      if (strip.children[index] !== card.el) strip.insertBefore(card.el, strip.children[index]);
      paintCard(paneId, card);
    });
    none.hidden = order.length > 0;
    clip.hidden = !order.length;
    layoutRow();
    mountNear();
    paintNav();
    markTarget();
    paintNewButton();
  }

  let queued = 0;
  const soon = () => {
    if (!queued) queued = requestAnimationFrame(render);
  };

  // ---------- moving ----------
  // One step is one thread, whatever asked for it.
  function go(step) {
    if (!isOn()) return false;
    const last = Math.max(0, order.length - per);
    const to = Math.max(0, Math.min(last, first + step));
    if (to === first) return false;
    first = to;
    layoutRow();
    mountNear();
    paintNav();
    return true;
  }

  // Brings a thread on screen (and makes it the prompt box's thread when asked).
  function show(paneId) {
    const at = order.indexOf(paneId);
    if (at < 0) return false;
    if (at < first) first = at;
    else if (at >= first + per) first = at - per + 1;
    layoutRow();
    mountNear();
    paintNav();
    return true;
  }

  previous.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  dots.addEventListener('click', event => {
    const dot = event.target.closest('button[data-index]');
    if (!dot) return;
    first = Math.max(0, Math.min(order.length - per, Number(dot.dataset.index)));
    layoutRow();
    mountNear();
    paintNav();
  });

  // a held key moves once
  document.addEventListener(
    'keydown',
    event => {
      if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (!isOn()) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) go(event.key === 'ArrowLeft' ? -1 : 1);
    },
    true
  );

  // A sideways slide on a trackpad: one slide, one thread. The slide's own tail of small moves
  // does not count again.
  let wheelAt = 0;
  box.addEventListener(
    'wheel',
    event => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 12) return;
      event.preventDefault();
      const now = Date.now();
      const resting = now - wheelAt > WHEEL_REST_MS;
      wheelAt = now;
      if (resting) go(event.deltaX > 0 ? 1 : -1);
    },
    { passive: false }
  );

  strip.addEventListener('click', event => {
    const cardEl = event.target.closest('.tat-card');
    if (!cardEl) return;
    const paneId = cardEl.dataset.pane;
    if (event.target.closest('.tat-open, .tat-screen')) {
      window.TnaiThreads?.show?.(paneId);
      return;
    }
    window.TnaiLiveTasks?.setTarget?.(paneId);
  });

  // ---------- following the app ----------
  window.addEventListener('tnai:target-changed', event => {
    markTarget();
    const paneId = event.detail?.paneId;
    if (paneId && isOn()) show(paneId);
  });

  // a change of the page turns at once; the cards are painted in the next frame
  const turnNow = () => {
    turn();
    soon();
  };
  new MutationObserver(turnNow).observe(layout, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(turnNow).observe(view, {
    attributes: true,
    attributeFilter: ['class', 'hidden', 'data-view', 'data-mode'],
  });
  new ResizeObserver(() => {
    room = 0;
    soon();
  }).observe(content);
  new ResizeObserver(() => {
    room = 0;
    soon();
  }).observe(clip);

  // the thread list is the app's own reading of the sessions: when it changes, so does this
  function watchList() {
    const listSlot = window.TnaiThreads?.slot?.('list');
    if (!listSlot) return false;
    new MutationObserver(soon).observe(listSlot, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-tone', 'data-pane'],
    });
    return true;
  }
  if (!watchList()) window.addEventListener('tnai:threads-built', watchList, { once: true });
  window.addEventListener('tnai:threads-hidden', soon);
  window.addEventListener('tnai:threads-shown', soon);

  window.TnaiAllThreads = {
    get on() {
      return wasOn;
    },
    state: () => ({
      on: wasOn,
      first,
      per,
      order: [...order],
      shown: order.slice(first, first + per),
      mounted: order.filter(paneId => cards.get(paneId)?.mounted),
    }),
    go,
    show,
    render,
  };
  soon();
})();
