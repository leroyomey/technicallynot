// Technically Not · 123-thread-helpers.js — the thread layout's lead and its helpers.
// Desktop app only; does nothing while the thread
// layout is off or its page is hidden.
//
// A lead's helpers are shown where its own record places them: each sub-agent the lead started is
// a card in the lead's conversation (122 draws it), and a press opens that helper's own
// conversation beside the lead's, in the frame's side island. Lead and helper are then readable
// side by side. This file owns the side island and two small things in the thread's top part:
//
// - "Helpers" in the top row, when the open thread has any: it opens the side island.
// - The side island: one chip per helper, and under them the chosen helper's own conversation,
//   read from its own record. A helper is either a sub-agent Claude Code started inside its own
//   session (19 `TnaiTeam`; it has a record but no terminal), or an agent the lead started in a
//   panel of its own (43's graph; it is a thread too, and one press opens it as one).
// - The shared files: a row under the top row with every file that the open thread or one of its
//   helpers holds, who holds it, and who was last refused it and so waits (the app's file locks,
//   desktop/file-locks.js). Folded to one summary line until the user presses it.
//
// Real state only, on the app's own pushes; no timer. Look: the end of
// src/styles/30-thread-readable.css. `window.TnaiThreadHelpers` (`open`, `close`, `state`).
// Test: `real-thread`.
(() => {
  'use strict';
  const native = window.tnaiNative;
  const threads = () => window.TnaiThreads;
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const safe = (read, fallback) => {
    try {
      const value = read();
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const icon = (name, size) => safe(() => window.TnaiIcon?.(name, { size }), '');

  // ---------- the parts ----------
  const button = make('button', 'tnt-helpers-btn');
  button.type = 'button';
  button.hidden = true;
  button.innerHTML = icon('users', 14) + '<span></span>';
  button.title = 'Show this thread’s helpers beside it';

  const shared = make('div', 'tnt-shared');
  shared.hidden = true;
  shared.setAttribute('aria-label', 'Files held by this thread and its helpers');

  const panel = make('div', 'tnt-side-panel');
  panel.innerHTML =
    '<header class="tnt-side-head"><h2>Helpers</h2><button type="button" class="tnt-icon-btn" ' +
    'aria-label="Close helpers" title="Close">' +
    icon('x', 16) +
    '</button></header><div class="tnt-side-chips" role="tablist" aria-label="Helpers"></div>' +
    '<p class="tnt-side-note" hidden></p><div class="tnt-side-talk tnt-talk"></div>';
  const chips = panel.querySelector('.tnt-side-chips');
  const sideNote = panel.querySelector('.tnt-side-note');
  const sideTalk = panel.querySelector('.tnt-side-talk');

  // Whose helper it is, its state, and Keep or Release (43 draws and updates the line): under the
  // chips for the chosen helper, and under the top row of a helper opened as its own thread.
  const sideLine = make('div', 'tnt-helper-line');
  sideLine.hidden = true;
  chips.after(sideLine);
  const ownLine = make('div', 'tnt-helper-line');
  ownLine.hidden = true;

  // The helpers as bubbles in the top row, beside the name, to view a helper
  // and come back easily. A press shows that helper in the side island, beside the
  // lead's conversation, which stays where it was; a press on the chosen bubble, or the island's
  // ×, closes it again. Up to three bubbles, then "+N", which opens the first of the rest.
  const HEAD_CHIPS = 3;
  const headChips = make('div', 'tnt-head-helpers');
  headChips.hidden = true;
  headChips.setAttribute('aria-label', 'Helpers of this thread');

  function paintLine(host, paneId) {
    safe(() => window.TnaiGraph?.paintLine?.(host, paneId || ''), null);
    host.hidden = !host.querySelector('.tnai-graph-line:not([hidden])');
  }

  let pane = '';
  let chosen = '';
  let opened = false;

  // paneId -> Map(call id -> helper), from the cards the user pressed
  const fromCards = new Map();

  // ---------- who the helpers are ----------
  // One list for both kinds. A helper's key is its sub-agent call id, or "pane:" and its panel id.
  function helpersOf(paneId) {
    if (!paneId) return [];
    const inSession = safe(() => window.TnaiTeam?.get?.(paneId)?.subs, []).map(sub => ({
      key: String(sub.toolUseId || sub.key || ''),
      sub: String(sub.toolUseId || sub.agentId || sub.key || ''),
      name: (sub.alias ? sub.alias + ' · ' : '') + (sub.description || sub.type || 'Sub-agent'),
      tone: sub.status === 'failed' ? 'err' : sub.status === 'done' ? 'idle' : 'work',
    }));
    const inPanels = safe(() => window.TnaiThreadList?.kids(paneId), []).map(kid => ({
      key: 'pane:' + kid.id,
      paneId: kid.id,
      tool: kid.tool,
      name: kid.name + ' · ' + kid.tool,
      tone: kid.tone,
    }));
    const known = [...inSession, ...inPanels].filter(helper => helper.key);

    // A helper whose card was pressed is kept even when the app no longer follows it live (after
    // a restart only the lead's record knows it): its conversation can still be read.
    for (const helper of fromCards.get(paneId)?.values() || [])
      if (!known.some(other => other.key === helper.key)) known.push(helper);
    return known;
  }

  // A helper's short name: what comes before the first " · " ("Indigo · Claude Code" is Indigo).
  const shortName = name => String(name || '').split(' · ')[0] || 'Helper';

  // One helper's bubble, the side island's chip: its state dot and its short name. All threads
  // (135) makes its bubbles here too, so the two pages draw them alike.
  function helperChip(helper, pressed) {
    const chip = make('button', 'tnt-side-chip');
    chip.type = 'button';
    chip.dataset.key = helper.key;
    chip.dataset.tone = helper.tone || 'idle';
    chip.setAttribute('aria-pressed', String(!!pressed));
    chip.title = 'View the conversation of ' + helper.name;
    chip.append(make('i'), make('span', '', shortName(helper.name)));
    return chip;
  }

  // "+N" after the first bubbles: its tip names the rest, and a press opens the first of them.
  function moreChip(rest) {
    const chip = make('button', 'tnt-side-chip tnt-chip-more', '+' + rest.length);
    chip.type = 'button';
    chip.dataset.key = rest[0].key;
    chip.dataset.more = '1';
    chip.title = 'More helpers: ' + rest.map(helper => shortName(helper.name)).join(', ');
    return chip;
  }

  function paintHead() {
    const list = helpersOf(pane);
    headChips.hidden = !list.length;
    const key =
      list.map(helper => helper.key + '\n' + helper.name + '\n' + helper.tone).join('\n\n') +
      '|' +
      (opened ? chosen : '');
    if (headChips.dataset.key === key || window.TnaiPress?.defer(headChips, paintHead)) return;
    headChips.dataset.key = key;
    const bubbles = list
      .slice(0, HEAD_CHIPS)
      .map(helper => helperChip(helper, opened && helper.key === chosen));
    if (list.length > HEAD_CHIPS) bubbles.push(moreChip(list.slice(HEAD_CHIPS)));
    headChips.replaceChildren(...bubbles);
  }

  // ---------- the shared files ----------
  // Folded by default to one line: how many files, the busiest holders and who waits. A press
  // opens the full list of files, so a long list takes little room until it is wanted.
  // Open or folded holds for every thread
  // until the user presses again.
  let locks = [];
  let sharedOpen = false;
  const HOLDERS_SHOWN = 3;

  const sharedSum = make('button', 'tnt-shared-sum');
  sharedSum.type = 'button';
  sharedSum.setAttribute('aria-expanded', 'false');
  const sharedList = make('div', 'tnt-shared-list');
  sharedList.hidden = true;
  shared.append(sharedSum, sharedList);
  sharedSum.addEventListener('click', () => {
    sharedOpen = !sharedOpen;
    paintFold();
  });

  function paintFold() {
    sharedSum.setAttribute('aria-expanded', String(sharedOpen));
    sharedSum.title = sharedOpen ? 'Fold the list of held files' : 'Show every held file';
    sharedList.hidden = !sharedOpen;
  }

  // "12 files held · Nimbus 6 · Pulse 3 · Fern 2 · +2" and, in amber, how many files someone waits
  // for
  function paintSum(held) {
    const counts = new Map();
    for (const lock of held) counts.set(lock.name, (counts.get(lock.name) || 0) + 1);
    const holders = [...counts].sort((a, b) => b[1] - a[1]);
    const shown = holders
      .slice(0, HOLDERS_SHOWN)
      .map(([name, count]) => name + ' ' + count)
      .join(' · ');
    const rest = holders.length - HOLDERS_SHOWN;
    const waiting = held.filter(lock => lock.wanted?.name).length;
    const label = make(
      'span',
      '',
      held.length + (held.length === 1 ? ' file held' : ' files held')
    );
    const who = make('em', '', shown + (rest > 0 ? ' · +' + rest : ''));
    sharedSum.replaceChildren(label, who);
    if (waiting) sharedSum.append(make('b', '', waiting + ' waiting'));
    sharedSum.insertAdjacentHTML('beforeend', icon('chevron-right', 14));
  }

  function paintShared() {
    const mine = new Set([
      pane,
      ...safe(() => window.TnaiThreadList?.kids(pane), []).map(k => k.id),
    ]);
    const held = pane ? locks.filter(lock => mine.has(lock.paneId)) : [];
    const key = held
      .map(lock => lock.file + '\n' + lock.name + '\n' + (lock.wanted?.name || ''))
      .join('\n\n');
    if (shared.dataset.key !== key) {
      shared.dataset.key = key;
      paintSum(held);
      sharedList.replaceChildren(
        ...held.map(lock => {
          const chip = make('span', 'tnt-shared-file');
          const waits = lock.wanted?.name || '';
          chip.title =
            lock.file +
            ' is held by ' +
            lock.name +
            ': no other agent edits it meanwhile' +
            (waits ? '. ' + waits + ' asked for it and waits' : '');
          chip.append(
            make('code', '', String(lock.file).split(/[\\/]/).pop()),
            make('em', '', lock.name)
          );
          if (waits) chip.append(make('b', '', waits + ' waits'));
          return chip;
        })
      );
    }
    paintFold();
    shared.hidden = !held.length;
  }

  function readLocks() {
    if (!native?.locks) return;
    native.locks
      .list()
      .then(list => {
        locks = Array.isArray(list) ? list : [];
        paintShared();
      })
      .catch(() => {});
  }

  // ---------- the side island ----------
  function showHelper(helper) {
    const readable = window.TnaiThreadReadable;
    sideNote.hidden = true;
    sideTalk.hidden = false;
    if (!helper) {
      readable?.unmount(sideTalk);
      sideTalk.replaceChildren();
      return;
    }
    if (helper.sub) {
      readable.mount(sideTalk, pane, helper.sub);
      return;
    }

    // a helper in a panel of its own: its conversation when its tool keeps one this app can read
    if (readable.can(helper.tool)) readable.mount(sideTalk, helper.paneId);
    else {
      readable.unmount(sideTalk);
      sideTalk.hidden = true;
      sideNote.hidden = false;
      sideNote.textContent =
        helper.tool +
        ' keeps no record of the conversation that this app can read. Open its thread to see its CLI screen.';
    }
  }

  function paintSide() {
    const list = helpersOf(pane);
    if (!list.some(helper => helper.key === chosen)) chosen = list[0]?.key || '';
    const key = list.map(h => h.key + '\n' + h.name + '\n' + h.tone).join('\n\n') + '|' + chosen;

    // The chips are built anew when a helper's name or tone changes: with a press in progress on
    // one of them, that waits until right after the press, so the pressed chip still gets its
    // click.
    if (chips.dataset.key !== key && !window.TnaiPress?.defer(chips, paintSide)) {
      chips.dataset.key = key;
      chips.replaceChildren(
        ...list.map(helper => {
          const chip = make('button', 'tnt-side-chip');
          chip.type = 'button';
          chip.setAttribute('role', 'tab');
          chip.setAttribute('aria-selected', String(helper.key === chosen));
          chip.dataset.key = helper.key;
          chip.dataset.tone = helper.tone;
          chip.append(make('i'), make('span', '', helper.name));
          if (helper.paneId) {
            chip.title = 'Press again to open it as its own thread';
            chip.dataset.pane = helper.paneId;
          }
          return chip;
        })
      );
    }
    const now = list.find(helper => helper.key === chosen) || null;
    paintLine(sideLine, now?.paneId);
    const shownKey = now ? now.key : '';
    if (sideTalk.dataset.helper !== shownKey) {
      sideTalk.dataset.helper = shownKey;
      showHelper(now);
    }
    paintHead();
  }

  function setOpen(want, key) {
    const frame = threads();
    const slot = frame?.slot('side');
    if (!slot) return;
    opened = !!want && helpersOf(pane).length > 0;
    if (opened && key) chosen = key;

    // The side column has tabs (131) and this panel is one of them; without that file the panel
    // is the whole column.
    const column = window.TnaiThreadSide;
    if (column) column.helpers(panel, opened);
    else {
      if (opened && panel.parentNode !== slot) slot.replaceChildren(panel);
      frame.side(opened);
    }
    button.setAttribute('aria-pressed', String(opened));
    if (opened) paintSide();
    else {
      sideTalk.dataset.helper = '';
      window.TnaiThreadReadable?.unmount(sideTalk);
    }
    paintHead();
  }

  headChips.addEventListener('click', event => {
    const chip = event.target.closest('.tnt-side-chip');
    if (!chip) return;

    // the bubble of the helper on show is the way back: the island closes, the lead stays
    if (opened && !chip.dataset.more && chip.dataset.key === chosen) setOpen(false);
    else setOpen(true, chip.dataset.key);
  });

  chips.addEventListener('click', event => {
    const chip = event.target.closest('.tnt-side-chip');
    if (!chip) return;

    // a second press on a helper that has a panel of its own opens it as its own thread
    if (chip.dataset.key === chosen && chip.dataset.pane) {
      threads().select(chip.dataset.pane);
      return;
    }
    chosen = chip.dataset.key;
    paintSide();
  });
  panel.querySelector('.tnt-side-head button').addEventListener('click', () => setOpen(false));
  button.addEventListener('click', () => setOpen(!opened));

  // ---------- following the open thread ----------
  function paint() {
    const count = helpersOf(pane).length;
    button.hidden = !count;
    button.querySelector('span').textContent = count === 1 ? '1 helper' : count + ' helpers';
    if (opened && !count) setOpen(false);
    else if (opened) paintSide();
    paintHead();
    paintShared();
    paintLine(ownLine, pane);

    // the side column shows its Helpers tab only while there are helpers
    window.TnaiThreadSide?.refresh();
  }

  // The button and the shared files row are put into the thread view's own top part (120 builds
  // it): the button before the Readable / Terminal switch, the row right under the top row.
  function place() {
    const view = threads()?.slot('main')?.querySelector('.tnt-view');
    const acts = view?.querySelector('.tnt-head-acts');
    if (!acts) return false;
    if (button.parentNode !== acts) acts.prepend(button);

    // the bubbles stand between the name and the state, in the room the top row has spare
    const state = view.querySelector('.tnt-head-state');
    if (state && headChips.nextSibling !== state) state.before(headChips);
    if (shared.parentNode !== view) view.querySelector('.tnt-head').after(shared);
    if (ownLine.parentNode !== view) view.querySelector('.tnt-head').after(ownLine);
    return true;
  }

  let stops = [];

  function onThread(event) {
    const next = event.detail?.paneId || '';
    if (!place()) return;
    if (next !== pane) {
      pane = next;
      chosen = '';
      setOpen(false);
    }
    if (!stops.length) {
      const listen = (name, handler) => {
        window.addEventListener(name, handler);
        stops.push(() => window.removeEventListener(name, handler));
      };
      listen('tnai:team-changed', paint);
      listen('tnai:threads-painted', paint);
      listen('tnai:thread-helper', helperEvent => {
        const detail = helperEvent.detail || {};
        if (detail.paneId !== pane || !detail.sub) return;
        if (!fromCards.has(pane)) fromCards.set(pane, new Map());
        fromCards
          .get(pane)
          .set(detail.sub, { key: detail.sub, sub: detail.sub, name: detail.title, tone: 'idle' });
        setOpen(true, detail.sub);
      });
      const offLocks = native?.locks?.onChange?.(readLocks);
      if (typeof offLocks === 'function') stops.push(offLocks);
    }
    readLocks();
    paint();
  }

  function leave() {
    setOpen(false);
    stops.forEach(stop => safe(stop, null));
    stops = [];
    pane = '';
  }
  window.addEventListener('tnai:thread-view', onThread);
  window.addEventListener('tnai:threads-hidden', leave);
  window.addEventListener('tnai:threads-removed', leave);

  window.TnaiThreadHelpers = {
    open: key => setOpen(true, key),
    close: () => setOpen(false),
    state: () => ({ pane, opened, chosen, helpers: helpersOf(pane).map(helper => helper.key) }),

    // for All threads (135): any thread's helpers, and their bubbles drawn as here
    list: paneId => helpersOf(paneId),
    chip: helperChip,
    moreChip,
    shortName,
  };
})();
