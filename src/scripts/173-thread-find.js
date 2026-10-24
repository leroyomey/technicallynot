/*
 * Technically Not · 173-thread-find.js — find in the open thread's conversation (user 2026-10-22,
 * mock docs/plans/design-concepts/thread-small-features.html: "Find in thread").
 *
 * Ctrl+F while a thread shows its conversation opens a small bar at the conversation's top right,
 * under the thread's head row. Every match lights up and the current one stands out in the accent;
 * Enter and Shift+Enter (or the arrows) step through them, "2 of 5" says where you are, and Esc
 * closes the bar and hands the keyboard back. It searches the whole conversation, not only what is
 * on screen.
 *
 * Matches are drawn with the CSS Custom Highlight API (`::highlight(tnt-find)` in
 * src/styles/54-thread-find.css), so the conversation's own nodes are never changed: 122 keeps
 * updating them while the bar is open, and the matches are found again a moment later. On the CLI
 * screen (a terminal) Ctrl+F is left to the terminal.
 *
 * Test: node tools/thread-small-features-test.js
 */
(() => {
  'use strict';

  // how long after the conversation changes the matches are found again
  const AGAIN_MS = 250;

  // the most matches lit at once: enough for any search worth stepping through
  const MAX_HITS = 2000;

  const canHighlight = typeof Highlight === 'function' && !!window.CSS?.highlights;
  let bar = null;
  let field = null;
  let count = null;
  let hits = [];
  let now = 0;
  let list = null;
  let watcher = null;
  let againTimer = 0;
  let before = null;

  const icon = name => {
    try {
      return window.TnaiIcon?.(name, { size: 15 }) || '';
    } catch {
      return '';
    }
  };

  // The open thread's view, and its conversation list while the conversation is what shows.
  const view = () =>
    [...document.querySelectorAll('.tnt-view')].find(
      node => node.isConnected && node.getClientRects().length > 0
    ) || null;
  const listOf = root => root?.querySelector('.tnt-talk:not([hidden]) .tnt-talk-list') || null;

  function button(name, label, onPress, extraClass) {
    const press = document.createElement('button');
    press.type = 'button';
    press.className = 'tnt-icon-btn' + (extraClass ? ' ' + extraClass : '');
    press.title = label;
    press.setAttribute('aria-label', label);
    press.innerHTML = icon(name);
    press.addEventListener('click', onPress);
    return press;
  }

  function build() {
    bar = document.createElement('div');
    bar.className = 'tnt-find';
    bar.setAttribute('role', 'search');
    bar.hidden = true;
    field = document.createElement('input');
    field.type = 'search';
    field.placeholder = 'Find in this thread';
    field.setAttribute('aria-label', 'Find in this thread');
    field.spellcheck = false;
    count = document.createElement('span');
    count.className = 'tnt-find-count';
    count.setAttribute('aria-live', 'polite');
    bar.append(
      field,
      count,
      // the icon set has no chevron-up: the down one, turned over (54)
      button('chevron-down', 'Previous match (Shift+Enter)', () => step(-1), 'tnt-find-up'),
      button('chevron-down', 'Next match (Enter)', () => step(1)),
      button('x', 'Close (Esc)', close)
    );
    field.addEventListener('input', () => {
      now = 0;
      search(true);
    });
    field.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        step(event.shiftKey ? -1 : 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });
  }

  // ---------- finding ----------
  function clearLights() {
    if (!canHighlight) return;
    CSS.highlights.delete('tnt-find');
    CSS.highlights.delete('tnt-find-now');
  }

  // Every place the words occur in the conversation's text, as ranges (within one text node).
  function findAll(root, words) {
    const found = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && found.length < MAX_HITS; node = walker.nextNode()) {
      const text = node.nodeValue.toLowerCase();
      let at = text.indexOf(words);
      while (at >= 0 && found.length < MAX_HITS) {
        const range = new Range();
        range.setStart(node, at);
        range.setEnd(node, at + words.length);
        found.push(range);
        at = text.indexOf(words, at + words.length);
      }
    }
    return found;
  }

  // `go`: move the view to the current match (a press or typing), not when the conversation grew.
  function search(go) {
    const words = field.value.trim().toLowerCase();
    hits = words && list ? findAll(list, words) : [];
    if (now >= hits.length) now = Math.max(0, hits.length - 1);
    paint(go);
  }

  function paint(go) {
    clearLights();
    count.textContent = !field.value.trim()
      ? ''
      : hits.length
        ? now + 1 + ' of ' + hits.length + (hits.length >= MAX_HITS ? '+' : '')
        : 'No match';
    bar.dataset.none = String(!!field.value.trim() && !hits.length);
    if (!hits.length) return;
    if (canHighlight) {
      CSS.highlights.set('tnt-find', new Highlight(...hits));
      CSS.highlights.set('tnt-find-now', new Highlight(hits[now]));
    }
    if (go) {
      const holder = hits[now].startContainer.parentElement;
      const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      holder?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    }
  }

  function step(by) {
    if (!hits.length) return;
    now = (now + by + hits.length) % hits.length;
    paint(true);
  }

  // The conversation changes while the bar is open (new lines, a reply that grows): its matches
  // are found again a moment later, the view stays where the reader is.
  function watch(target) {
    watcher?.disconnect();
    list = target;
    if (!target) return;
    watcher = new MutationObserver(() => {
      clearTimeout(againTimer);
      againTimer = setTimeout(() => search(false), AGAIN_MS);
    });
    watcher.observe(target, { childList: true, subtree: true, characterData: true });
  }

  // ---------- opening and closing ----------
  function open(root) {
    if (!bar) build();
    if (bar.parentNode !== root) root.append(bar);

    // under the thread's head row, so its buttons stay free
    const head = root.querySelector('.tnt-head');
    bar.style.top = (head && !head.hidden ? head.offsetTop + head.offsetHeight : 0) + 6 + 'px';
    if (bar.hidden) before = document.activeElement;
    bar.hidden = false;
    watch(listOf(root));
    field.focus();
    field.select();
    search(true);
  }

  function close() {
    if (!bar || bar.hidden) return;
    bar.hidden = true;
    watch(null);
    clearTimeout(againTimer);
    hits = [];
    clearLights();
    const back = before;
    before = null;
    if (back?.isConnected) back.focus?.();
  }

  document.addEventListener(
    'keydown',
    event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== 'f') return;

      // the CLI screen and Your terminal keep their own keys
      if (event.target?.closest?.('.xterm')) return;
      const root = view();
      if (!root || !listOf(root)) return;
      event.preventDefault();
      open(root);
    },
    true
  );

  // Another thread opened, or the same one switched to its CLI screen: the bar follows the
  // conversation that shows, or closes when none does.
  window.addEventListener('tnai:thread-view', () => {
    if (!bar || bar.hidden) return;
    const root = view();
    const target = listOf(root);
    if (!target) {
      close();
      return;
    }
    if (target !== list) {
      watch(target);
      now = 0;
      search(true);
    }
  });

  window.TnaiThreadFind = { open: () => view() && open(view()), close, count: () => hits.length };
})();
