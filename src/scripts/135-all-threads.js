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

  // One icon button of a card's head, in the look of the "open on its own" button beside it.
  function headButton(className, iconName, label) {
    const button = make('button', 'tat-act ' + className);
    button.type = 'button';
    button.innerHTML = icon(iconName, 14);
    button.title = label;
    button.setAttribute('aria-label', label);
    return button;
  }

  // The on/off button follows the session: a square while it runs, a play mark while it is
  // stopped, hidden while there is no session.
  function paintPower(paneId, card) {
    const session = (window.TnaiAgents?.sessions?.() || []).find(one => one.paneId === paneId);
    card.power.hidden = !session;
    if (!session) return;
    const shows = session.running ? 'stop' : 'start';
    if (shows === card.powerShows) return;
    card.powerShows = shows;

    // 44-page-colors.css reads it: green for Start, red for Stop
    card.power.dataset.shows = shows;
    const label = shows === 'stop' ? 'Stop this agent' : 'Start this agent again';
    card.power.innerHTML = icon(shows === 'stop' ? 'square-stop' : 'play', 14);
    card.power.title = label;
    card.power.setAttribute('aria-label', label);
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

    // the name and the pencil beside it, which turns the name into a field where it stands
    const nameLine = make('div', 'tat-name-line');
    const pencil = make('button', 'tat-rename');
    pencil.type = 'button';
    pencil.innerHTML = icon('pencil', 12);
    pencil.title = 'Rename this agent';
    pencil.setAttribute('aria-label', 'Rename this agent');
    pencil.addEventListener('click', () => renameCard(paneId, name));

    // how long the session has been open, colored as it runs long (120 paints it)
    const age = make('span', 'tnt-head-age tat-age');
    age.hidden = true;
    nameLine.append(name, pencil, age);
    text.append(nameLine, sub);
    const open = make('button', 'tat-open');
    open.type = 'button';
    open.innerHTML = icon('maximize-2', 13);
    open.title = 'Open this thread on its own';
    open.setAttribute('aria-label', 'Open this thread on its own');

    // the thread's helpers as bubbles, in the head's spare room (filled by paintHelpers)
    const chips = make('div', 'tat-helpers');
    chips.hidden = true;
    chips.setAttribute('aria-label', 'Helpers of this thread');

    // The open thread's own top-row controls, for this card's thread: handoff
    // history, the side column, Stop / Start and the "..." menu. The strip's click handler below
    // does what each one says.
    const handoff = headButton('tat-act-handoff', 'clock', 'Handoff history');
    const side = headButton('tat-act-side', 'panel-right', 'Open with Files, Helpers and Details');
    const power = headButton('tat-act-power', 'square-stop', 'Stop this agent');
    power.hidden = true;

    // the blur (120 keeps which threads are blurred and paints this button)
    const blur = headButton('tat-act-blur', 'eye', 'Blur this thread');
    blur.dataset.iconSize = '14';
    blur.setAttribute('aria-pressed', 'false');
    const more = headButton('tat-act-more', 'ellipsis', 'More for this thread');
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    head.append(dot, text, chips, handoff, side, power, blur, more, open);
    const body = make('div', 'tnt-talk tat-body');
    body.setAttribute('role', 'log');

    // A helper's conversation, shown in the card's place while its bubble is pressed. The lead's
    // own conversation is only put aside meanwhile, never let go of, so the way back finds it as
    // it was, at the same place.
    const helperBody = make('div', 'tnt-talk tat-body');
    helperBody.setAttribute('role', 'log');
    helperBody.hidden = true;
    const helperNote = make('p', 'tat-helper-note');
    helperNote.hidden = true;

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
    el.append(head, body, helperBody, helperNote, plain, asks);
    return {
      el,
      dot,
      name,
      sub,
      age,
      power,
      powerShows: '',
      blur,
      body,
      plain,
      asks,
      chips,
      helperBody,
      helperNote,
      mounted: false,
      asking: false,
      viewing: '',
      leadScroll: 0,
    };
  }

  // ---------- a thread's helpers ----------
  // Bubbles in the card's head, one per helper (123 knows them and draws the bubble). A press
  // shows that helper's conversation in the card; while one is shown, a "← lead" bubble comes
  // first and is the way back, as is Escape. A second press on a helper that has a panel of its
  // own opens it as its own thread, as in the side island.
  const helpers = () => window.TnaiThreadHelpers;
  const CARD_CHIPS = 3;

  function helpersOf(paneId) {
    try {
      return helpers()?.list?.(paneId) || [];
    } catch {
      return [];
    }
  }

  function paintHelpers(paneId, card) {
    const list = helpersOf(paneId);

    // a helper the app no longer knows: back to the lead
    if (card.viewing && !list.some(helper => helper.key === card.viewing))
      leaveHelper(paneId, card);
    card.chips.hidden = !list.length || !helpers()?.chip;
    if (card.chips.hidden) return;
    const key =
      list.map(helper => helper.key + '\n' + helper.name + '\n' + helper.tone).join('\n\n') +
      '|' +
      card.viewing +
      '|' +
      card.name.textContent;
    if (card.chips.dataset.key === key) return;
    if (window.TnaiPress?.defer(card.chips, () => paintHelpers(paneId, card))) return;
    card.chips.dataset.key = key;
    const bubbles = [];
    if (card.viewing) {
      const lead = card.name.textContent || 'the thread';
      const back = make('button', 'tnt-side-chip tat-back');
      back.type = 'button';
      back.dataset.back = '1';
      back.title = 'Back to ' + lead + ' (Esc)';
      back.setAttribute('aria-label', 'Back to ' + lead);
      back.innerHTML = icon('arrow-left', 12);
      back.append(make('span', '', lead));
      bubbles.push(back);
    }
    list
      .slice(0, CARD_CHIPS)
      .forEach(helper => bubbles.push(helpers().chip(helper, helper.key === card.viewing)));
    if (list.length > CARD_CHIPS) bubbles.push(helpers().moreChip(list.slice(CARD_CHIPS)));
    card.chips.replaceChildren(...bubbles);
  }

  function viewHelper(paneId, card, key) {
    const helper = helpersOf(paneId).find(one => one.key === key);
    const reader = readable();
    if (!helper || !reader) return;
    if (card.viewing) reader.unmount?.(card.helperBody);
    else card.leadScroll = card.body.scrollTop;
    card.viewing = key;
    card.helperBody.hidden = false;
    card.helperNote.hidden = true;
    if (helper.sub) reader.mount?.(card.helperBody, paneId, helper.sub);
    else if (reader.can?.(helper.tool)) reader.mount?.(card.helperBody, helper.paneId);
    else {
      card.helperBody.hidden = true;
      card.helperNote.hidden = false;
      card.helperNote.textContent =
        helpers().shortName(helper.name) +
        ' runs ' +
        helper.tool +
        ', which keeps no conversation this app can read. Press its bubble again to open its thread.';
    }
    card.body.hidden = true;
    card.plain.hidden = true;
    card.el.classList.add('tat-viewing');
    paintHelpers(paneId, card);
  }

  function leaveHelper(paneId, card) {
    if (!card.viewing) return;
    readable()?.unmount?.(card.helperBody);
    card.viewing = '';
    card.helperBody.hidden = true;
    card.helperNote.hidden = true;
    card.el.classList.remove('tat-viewing');
    card.body.hidden = !card.can;
    card.plain.hidden = !!card.can;

    // the lead's conversation where the user left it
    card.body.scrollTop = card.leadScroll;
    paintHelpers(paneId, card);
  }

  function pressHelper(paneId, card, chip) {
    if (chip.dataset.back) {
      leaveHelper(paneId, card);
      return;
    }
    const key = chip.dataset.key;
    const helper = helpersOf(paneId).find(one => one.key === key);
    if (!chip.dataset.more && key === card.viewing && helper?.paneId) {
      window.TnaiThreads?.show?.(helper.paneId);
      return;
    }
    viewHelper(paneId, card, key);
  }

  // The card's name becomes a field where it stands (21's inlineEdit): Enter or leaving the field
  // saves, Escape or the × cancels. The panel's own rename saves it, so the list, the open thread
  // and the agents follow the new name.
  let renaming = null;

  function renameCard(paneId, nameEl) {
    const edit = window.TnaiTerminalPage?.inlineEdit;
    if (!edit || renaming || nameEl.hidden) return;
    renaming = edit(
      nameEl,
      nameEl.textContent,
      'Rename this agent',
      text => window.TnaiPaneNames?.rename(paneId, text),
      () => {
        renaming = null;
      },
      true
    );
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

    // while a helper is shown, the lead's own parts stay put aside
    card.plain.hidden = can || !!card.viewing;
    card.body.hidden = !can || !!card.viewing;
    card.can = can;
    paintHelpers(paneId, card);
    paintPower(paneId, card);
    paintBlur(paneId, card);
    window.TnaiThreadView?.paintAge?.(card.age, paneId);
  }

  // A blurred thread (120) is blurred on its card too, with the card head kept sharp.
  function paintBlur(paneId, card) {
    const store = window.TnaiThreadBlur;
    card.el.classList.toggle('tat-blurred', !!store?.on(paneId));
    store?.paintButton(card.blur, paneId);
  }

  // Only the threads on screen and one to each side are read; the others let go of their
  // conversation, so a project with twenty threads reads five.
  function mountNear() {
    order.forEach((paneId, index) => {
      const card = cards.get(paneId);

      // The page can be lined up (show) before render has built a new thread's card.
      if (!card) return;
      const near = index >= first - 1 && index <= first + per;
      if (near && card.can && !card.mounted) {
        readable()?.mount?.(card.body, paneId);
        card.mounted = true;
      } else if ((!near || !card.can) && card.mounted) {
        readable()?.unmount?.(card.body);
        card.mounted = false;
      }

      // a card out of reach lets go of a helper it showed, too
      if (!near && card.viewing) leaveHelper(paneId, card);

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
    chooseInList(target());
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
        if (card.viewing) readable()?.unmount?.(card.helperBody);
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

  // Many pushes in one moment are one redraw. The timer beside the frame is for a window the user's
  // other windows cover: it draws no frames, and the cards must still follow the thread list, which
  // redraws the same way (119). Found 2026-10-14 (issue 20): a rename reached the list but not the
  // card, and the cards were not laid out, in a test window that drew no frames.
  let queued = 0;
  const soon = () => {
    if (queued) return;
    const run = () => {
      cancelAnimationFrame(queued.frame);
      clearTimeout(queued.timer);
      render();
    };
    queued = { frame: requestAnimationFrame(run), timer: setTimeout(run, 120) };
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

  // The head's own controls, each through the function the open thread's top row uses. True when
  // the press was one of them.
  function pressCardButton(target, paneId, card) {
    const pressed = target.closest(
      '.tat-act-handoff, .tat-act-side, .tat-act-power, .tat-act-blur, .tat-act-more'
    );
    if (!pressed || !card) return false;
    const more = window.TnaiThreadMore;
    if (pressed.classList.contains('tat-act-handoff')) {
      window.TnaiHandoffHistory?.open?.(paneId);
    } else if (pressed.classList.contains('tat-act-side')) {
      // the side column stands on Threads: the thread opens there with it shown
      if (window.TnaiThreads?.show?.(paneId)) window.TnaiThreadSide?.open?.();
    } else if (pressed.classList.contains('tat-act-power')) {
      more?.stopOrStart?.(paneId, card.el);
    } else if (pressed.classList.contains('tat-act-blur')) {
      window.TnaiThreadBlur?.toggle(paneId);
    } else if (more?.isOpen?.()) {
      more.close(true);
    } else {
      more?.open?.(pressed, paneId, {
        host: card.el,
        rename: () => renameCard(paneId, card.name),
      });
    }
    return true;
  }

  strip.addEventListener('click', event => {
    const cardEl = event.target.closest('.tat-card');
    if (!cardEl) return;
    const paneId = cardEl.dataset.pane;
    const card = cards.get(paneId);
    if (pressCardButton(event.target, paneId, card)) return;
    if (event.target.closest('.tat-open, .tat-screen')) {
      window.TnaiThreads?.show?.(paneId);
      return;
    }

    // a helper's bubble: the prompt box still follows the card (the lead), so no return here
    const chip = event.target.closest('.tat-helpers .tnt-side-chip');
    if (chip && card) pressHelper(paneId, card, chip);
    window.TnaiLiveTasks?.setTarget?.(paneId);
  });

  // Escape in a card that shows a helper goes back to the lead (a name being edited keeps its own
  // Escape).
  strip.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || renaming) return;
    const cardEl = event.target.closest('.tat-card');
    const card = cardEl && cards.get(cardEl.dataset.pane);
    if (!card?.viewing) return;
    event.preventDefault();
    leaveHelper(cardEl.dataset.pane, card);
  });

  // a thread was blurred or shown again, here or in its top row: its card follows
  window.addEventListener('tnai:thread-blur', event => {
    const paneId = event.detail?.paneId;
    const card = paneId && cards.get(paneId);
    if (card) paintBlur(paneId, card);
  });

  // a helper started, ended or changed its state: the bubbles follow
  window.addEventListener('tnai:team-changed', soon);

  // a session stopped or started: only the on/off buttons follow, nothing else is drawn again
  window.TnaiAgents?.onChange?.(() => {
    for (const [paneId, card] of cards) paintPower(paneId, card);
  });

  // the session clocks move on 120's tick, only while this page is shown
  window.addEventListener('tnai:thread-age-tick', () => {
    if (!isOn()) return;
    for (const [paneId, card] of cards) window.TnaiThreadView?.paintAge?.(card.age, paneId);
  });

  // ---------- following the app ----------
  // One choice, shown in two places: the card the prompt box sends to is also the thread list's
  // chosen row (found 2026-10-14: the list kept the thread last opened on Threads). Only a thread
  // with a card is chosen in the list; anything else leaves the list as it is.
  function chooseInList(paneId) {
    const frame = window.TnaiThreads;
    if (!paneId || !order.includes(paneId) || frame?.selected?.() === paneId) return;
    frame?.select?.(paneId);
  }

  window.addEventListener('tnai:target-changed', event => {
    markTarget();
    const paneId = event.detail?.paneId;
    if (paneId && isOn()) {
      show(paneId);
      chooseInList(paneId);
    }
  });

  // A row pressed in the thread list while this page shows: its card becomes the chosen one and
  // comes on screen. A row with no card here (a helper's own row) changes nothing on this page.
  window.addEventListener('tnai:threads-select', event => {
    const paneId = event.detail?.paneId;
    if (!paneId || !isOn() || !order.includes(paneId) || paneId === target()) return;
    window.TnaiLiveTasks?.setTarget?.(paneId);
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
