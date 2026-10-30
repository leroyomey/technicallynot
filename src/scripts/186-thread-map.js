/*
 * Technically Not · 186-thread-map.js — a map of the open thread's conversation beside its
 * scrollbar (user, 2026-10-28: "Yes, build all three as shown", visual 1 of
 * docs/plans/design-concepts/thread-visuals.html).
 *
 * Small marks just inside the scrollbar show where the user's prompts, the reports, open
 * decisions, failed steps and compacts sit in the conversation (122 draws them). Hovering or
 * focusing a mark says what it is; pressing it scrolls there and flashes the block. Nothing shows
 * for a conversation that fits on about one and a half screens, or with fewer than two marks.
 *
 * Positions come from the blocks' places in the list. Blocks far out of view are not laid out yet
 * (122 uses content-visibility), so their marks stand where the list's size estimate puts them and
 * move into place once those blocks have been seen; the map is drawn again when the list changes,
 * its size changes, or scrolling stops.
 */
(() => {
  'use strict';

  const safe = (run, fallback) => {
    try {
      return run();
    } catch {
      return fallback;
    }
  };

  // What the map marks, in the order a block is checked, and how each is named on hover.
  const KINDS = [
    { kind: 'decide', select: '.tnt-decide[data-open="true"]', label: 'Needs you' },
    { kind: 'failed', select: '.tnt-act[data-state="failed"]', label: 'Failed step' },
    { kind: 'report', select: '.tnt-report', label: 'Report' },
    { kind: 'you', select: '.tnt-you:not(.tnt-you-queued)', label: 'You' },
    { kind: 'compact', select: '.tnt-note', label: 'Compacted', text: /compacted/i },
  ];

  // A conversation shorter than this many screens needs no map.
  const MIN_SCREENS = 1.5;
  const MIN_MARKS = 2;
  const REDRAW_AFTER_MS = 250;
  const TEXT_MAX = 90;

  const map = document.createElement('div');
  map.className = 'tmap';
  map.hidden = true;
  map.setAttribute('role', 'navigation');
  map.setAttribute('aria-label', 'Map of this conversation');

  const tip = document.createElement('div');
  tip.className = 'tmap-tip';
  tip.hidden = true;
  tip.setAttribute('role', 'tooltip');
  document.body.append(tip);

  // the open thread's conversation (120 `.tnt-talk`, the scrolling box) and its list (122)
  const talkEl = () =>
    safe(() => window.TnaiThreads?.slot?.('main')?.querySelector('.tnt-view .tnt-talk'), null);

  // The block a mark points at: the list's own child that holds the found node, so a step inside
  // a folded group still has a place (the group's).
  function blockOf(list, node) {
    let block = node;
    while (block && block.parentElement !== list) block = block.parentElement;
    return block || node;
  }

  // A short text for the hover: the block's own words, on one line
  function textOf(node, kind) {
    let text = '';
    if (kind === 'decide') text = node.querySelector('b')?.textContent || '';
    else if (kind === 'failed')
      text =
        (node.querySelector('.tnt-act-what')?.textContent || '') +
        ' · ' +
        (node.querySelector('.tnt-act-result')?.textContent || 'failed');
    else if (kind === 'report')
      text = node.querySelector('.tnt-report-row div, .tnt-report-row ul')?.textContent || '';
    else text = node.textContent || '';
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > TEXT_MAX ? text.slice(0, TEXT_MAX - 1) + '…' : text;
  }

  // Every mark of a list: { kind, label, text, node, block }, top to bottom
  function marksOf(list) {
    const found = [];
    const seen = new Set();
    for (const one of KINDS) {
      list.querySelectorAll(one.select).forEach(node => {
        if (seen.has(node)) return;
        if (one.text && !one.text.test(node.textContent || '')) return;

        // a decision is also inside its report: the report keeps one mark, the decision its own
        seen.add(node);
        found.push({
          kind: one.kind,
          label: one.label,
          text: textOf(node, one.kind),
          node,
          block: blockOf(list, node),
        });
      });
    }
    return found;
  }

  // Where a node sits in the scrolling box, as a share of its whole height (0 to 1)
  function placeOf(talk, node) {
    const box = talk.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const middle = rect.top + rect.height / 2 - box.top + talk.scrollTop;
    return Math.min(1, Math.max(0, middle / talk.scrollHeight));
  }

  // The visible node for a mark: the found node, or its block when the node is folded away
  const shownNode = mark => (mark.node.getClientRects().length ? mark.node : mark.block);

  let current = null;

  // the block node each mark button stands for
  const markNode = new WeakMap();

  function draw() {
    const talk = talkEl();
    const list = talk?.querySelector('.tnt-talk-list');
    const usable = talk && list && !talk.hidden && talk.getClientRects().length;
    if (!usable || talk.scrollHeight < talk.clientHeight * MIN_SCREENS) {
      hide();
      return;
    }
    const marks = marksOf(list);
    if (marks.length < MIN_MARKS) {
      hide();
      return;
    }

    // The strip stands in the conversation's box, just inside its scrollbar, over the whole
    // scrolling height of the box (its own place does not scroll).
    const host = talk.parentElement;
    if (map.parentElement !== host) host.append(map);
    current = { talk, marks };

    // measured against the box the strip is placed in (its offset parent), shown first so it has
    // one
    map.hidden = false;
    const hostBox = (map.offsetParent || document.body).getBoundingClientRect();
    const talkBox = talk.getBoundingClientRect();
    const bar = talk.offsetWidth - talk.clientWidth;
    map.style.top = talkBox.top - hostBox.top + 'px';
    map.style.height = talkBox.height + 'px';
    map.style.left = talkBox.right - hostBox.left - bar - 13 + 'px';

    // The conversation keeps clear of the strip: in a narrow thread its blocks reach the box's
    // right edge and the marks lay over the bubbles (user screenshot 2026-10-28). Only the part
    // that would be under the strip is given back, so a wide thread looks as before.
    makeRoom(list, talkBox.right - bar - 13);

    // Each block keeps its own button from one drawing to the next, so a press under way
    // (mousedown, then mouseup) stays on one button while an agent writes and the map is drawn
    // again. A new button, or another block's, under the pointer between the two lost the click
    // (learned 2026-10-28: 122 also drops the oldest blocks of a long conversation, so places in
    // the list shift).
    const byNode = new Map([...map.children].map(button => [markNode.get(button), button]));
    const buttons = marks.map((mark, index) => {
      let button = byNode.get(mark.node);
      byNode.delete(mark.node);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'tmap-mark';
        markNode.set(button, mark.node);
      }
      button.dataset.kind = mark.kind;
      button.dataset.index = String(index);
      button.style.top = (placeOf(talk, shownNode(mark)) * 100).toFixed(2) + '%';
      button.setAttribute('aria-label', mark.label + (mark.text ? ': ' + mark.text : ''));
      return button;
    });
    byNode.forEach(button => button.remove());

    // in the marks' order, moving only a button that is out of place
    let place = map.firstChild;
    for (const button of buttons) {
      if (button === place) place = place.nextSibling;
      else map.insertBefore(button, place);
    }
    map.hidden = false;
  }

  function hide() {
    map.hidden = true;
    if (roomOn) {
      roomOn.style.paddingRight = '';
      roomOn = null;
    }
    current = null;
    hideTip();
  }

  // The list that was given room for the strip (undone when the strip hides or moves on).
  let roomOn = null;

  // The list's own right padding from the style sheets, read once while no room is set on it.
  const sheetPadding = new WeakMap();

  // Room on the right of the conversation's list so nothing in it reaches under the strip, whose
  // left edge is at `stripLeft` (screen x): as much as needed plus a 6 px gap, or none.
  // The list's box has a set width (30: border-box), so its right edge is the same with or
  // without the room and is measured as it stands. The room is never taken off to measure: that
  // made the list taller for a moment, the browser pulled a reader at the end up by the
  // difference, following the end scrolled back down, and that scroll drew the map again, so the
  // conversation twitched with no input (user clip 2026-10-29).
  function makeRoom(list, stripLeft) {
    if (roomOn && roomOn !== list) roomOn.style.paddingRight = '';
    if (!sheetPadding.has(list)) {
      const inline = list.style.paddingRight;
      if (!inline) sheetPadding.set(list, parseFloat(getComputedStyle(list).paddingRight) || 0);
    }
    const own = sheetPadding.get(list) || 0;
    const over = list.getBoundingClientRect().right - (stripLeft - 6);
    const wanted = over > own ? Math.ceil(over) + 'px' : '';

    // written only when it changes, so a drawing with nothing new moves nothing
    if (list.style.paddingRight !== wanted) list.style.paddingRight = wanted;
    roomOn = list;
  }

  // ---------- hover and press ----------
  function showTip(button) {
    const mark = current?.marks[Number(button.dataset.index)];
    if (!mark) return;
    const name = document.createElement('b');
    name.textContent = mark.label;
    const words = document.createElement('small');
    words.textContent = mark.text;
    const how = document.createElement('small');
    how.textContent = 'Press to go there.';
    tip.replaceChildren(name, ...(mark.text ? [words] : []), how);
    tip.hidden = false;

    // to the left of the strip, beside its mark, kept on screen
    const box = button.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    tip.style.left = Math.max(8, box.left - width - 12) + 'px';
    tip.style.top =
      Math.min(Math.max(8, box.top + box.height / 2 - height / 2), innerHeight - height - 8) + 'px';
  }

  function hideTip() {
    tip.hidden = true;
  }

  function jump(button) {
    const mark = current?.marks[Number(button.dataset.index)];
    if (!mark) return;
    const target = shownNode(mark);
    const talk = current.talk;
    const box = talk.getBoundingClientRect();
    const top =
      target.getBoundingClientRect().top - box.top + talk.scrollTop - talk.clientHeight / 3;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 122 must not follow the newest line back down while this scroll is on its way (an agent at
    // work adds lines all the time); a press that does not move the view changes nothing there
    const goal = Math.min(Math.max(0, top), talk.scrollHeight - talk.clientHeight);
    if (Math.abs(goal - talk.scrollTop) > 1)
      safe(() => window.TnaiThreadReadable?.leaveEnd?.(talk, goal), null);
    talk.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });

    // the block says "here" for a moment
    target.classList.remove('tmap-flash');
    void target.offsetWidth;
    target.classList.add('tmap-flash');
    setTimeout(() => target.classList.remove('tmap-flash'), 1500);
  }

  map.addEventListener('mouseover', event => {
    const button = event.target.closest('.tmap-mark');
    if (button) showTip(button);
  });
  map.addEventListener('focusin', event => {
    const button = event.target.closest('.tmap-mark');
    if (button) showTip(button);
  });
  map.addEventListener('mouseout', hideTip);
  map.addEventListener('focusout', hideTip);
  map.addEventListener('click', event => {
    const button = event.target.closest('.tmap-mark');
    if (button) jump(button);
  });

  // ---------- when to draw again ----------
  // At most one drawing per REDRAW_AFTER_MS, also while an agent writes without a pause
  let timer = 0;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      if (!pressing) draw();
    }, REDRAW_AFTER_MS);
  };

  // While a mark is pressed the map is not drawn again: an agent at work moves every mark a little
  // at each drawing (and 122 drops the oldest blocks), so another mark slid under the pointer
  // between mousedown and mouseup and the click was lost (learned 2026-10-28). It is drawn once
  // the press ends.
  let pressing = false;
  map.addEventListener('pointerdown', () => {
    pressing = true;
  });
  const pressEnded = () => {
    if (!pressing) return;
    pressing = false;
    schedule();
  };
  window.addEventListener('pointerup', pressEnded, true);
  window.addEventListener('pointercancel', pressEnded, true);

  // The list's blocks change (122 adds, folds, answers), the box's size changes, or scrolling
  // stops (blocks seen for the first time get their real height). One observer per box, made
  // again when the open thread's box is a new one.
  let watched = null;
  const changes = new MutationObserver(schedule);
  const sizes = new ResizeObserver(schedule);

  function watch() {
    const talk = talkEl();
    if (talk === watched) {
      schedule();
      return;
    }
    changes.disconnect();
    sizes.disconnect();
    watched = talk;
    if (talk) {
      changes.observe(talk, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-open', 'data-state', 'hidden'],
      });
      sizes.observe(talk);
      talk.addEventListener('scroll', () => {
        hideTip();
        schedule();
      });
    }
    schedule();
  }

  window.addEventListener('tnai:threads-built', watch);
  window.addEventListener('tnai:threads-shown', watch);
  window.addEventListener('tnai:threads-select', watch);
  window.addEventListener('tnai:threads-hidden', hide);
  watch();

  window.TnaiThreadMap = { draw, marksOf };
})();
