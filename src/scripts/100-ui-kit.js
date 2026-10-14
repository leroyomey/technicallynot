// Technically Not · ui-kit — one shared way to place popovers (Floating UI) and morph page switches
// (View Transitions); icons live in src/vendor/lucide/icons.js.
(() => {
  'use strict';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /*
   * ---------- --tnai-screen-px: one pixel of the screen, as a length ----------
   * The app is drawn a little smaller than 1:1 (desktop/main.js, fitZoom), so a length in px is
   * rarely a whole number of screen pixels, and the screen rounds each small shape by itself: of
   * a row of 9 px dots some came out a pixel larger than others. A style rounds such a size to
   * this length (`round(9px, var(--tnai-screen-px, 1px))`) and every copy is drawn the same.
   * Set again when the window is resized, which is when the scale can change.
   */
  const setScreenPixel = () => {
    const value = 1 / (window.devicePixelRatio || 1) + 'px';
    const style = document.documentElement.style;
    if (style.getPropertyValue('--tnai-screen-px') !== value)
      style.setProperty('--tnai-screen-px', value);
  };
  setScreenPixel();
  window.addEventListener('resize', setScreenPixel);

  /*
   * ---------- TnaiFloat: popovers, menus and tips next to an anchor ----------
   * TnaiFloat.attach(anchor, panel, { placement:'bottom-start', offset:6, flip:true, shift:8,
   * sameWidth:false, fade:true }) Places the panel at the anchor with flip/shift/offset and keeps
   * it there (autoUpdate) while it is shown. It stops by itself when the panel is hidden, closed or
   * removed, so callers don't have to call the returned cleanup (they may). No timers or observers
   * run while nothing is open. The panel stays where it is in the DOM.
   */
  const live = new Map(); // panel → stop()

  function attach(anchor, panel, opts = {}) {
    const F = window.FloatingUIDOM;
    if (!F || !anchor || !panel) return () => {};
    live.get(panel)?.();
    const o = {
      placement: 'bottom-start',
      offset: 6,
      flip: true,
      shift: 8,
      sameWidth: false,
      fade: true,
      ...opts,
    };
    const s = panel.style;
    s.position = 'fixed';
    s.inset = 'auto';
    s.margin = '0';
    s.transform = 'none';
    s.translate = 'none';
    const middleware = [F.offset(o.offset)];
    if (o.flip) middleware.push(F.flip({ padding: 8 }));
    if (o.shift !== false) middleware.push(F.shift({ padding: o.shift }));
    middleware.push(
      F.size({
        padding: 8,
        apply({ availableHeight, rects }) {
          s.maxHeight = Math.max(120, Math.floor(availableHeight)) + 'px';
          if (o.sameWidth) s.minWidth = Math.round(rects.reference.width) + 'px';
        },
      })
    );
    let first = true,
      cleanup = null;
    const shown = () =>
      panel.isConnected &&
      (anchor.contextElement || anchor).isConnected !== false &&
      !panel.hidden &&
      panel.getClientRects().length > 0;
    const update = () => {
      if (!shown()) {
        stop();
        return;
      }

      // the user is resizing it by hand (67): don't move it under the pointer
      if (panel.hasAttribute('data-tnai-resizing')) return;
      F.computePosition(anchor, panel, {
        strategy: 'fixed',
        placement: o.placement,
        middleware,
      }).then(({ x, y, placement }) => {
        s.left = Math.round(x) + 'px';
        s.top = Math.round(y) + 'px';
        panel.dataset.side = placement.split('-')[0];
        if (first) {
          first = false;
          if (o.fade && !reduced()) {
            const dy = panel.dataset.side === 'top' ? 4 : -4;
            panel.animate(
              [
                { opacity: 0, translate: `0 ${dy}px` },
                { opacity: 1, translate: '0 0' },
              ],
              { duration: 160, easing: 'cubic-bezier(.22,.9,.24,1)' }
            );
          }
        }
      });
    };

    function stop() {
      if (!cleanup) return;
      cleanup();
      cleanup = null;
      live.delete(panel);
    }
    cleanup = F.autoUpdate(anchor, panel, update, { animationFrame: false });
    live.set(panel, stop);
    return stop;
  }
  window.TnaiFloat = { attach, detach: panel => live.get(panel)?.() };

  // Icons: window.TnaiIcon(name, { size }) lives in src/vendor/lucide/icons.js (loaded before every
  // script).

  /*
   * ---------- TnaiMotion: View Transitions ---------- TnaiMotion.swap(fn, kind) runs fn (a DOM
   * change) inside document.startViewTransition, so the old and new page cross-fade (kind names a
   * CSS class on <html> for the duration, e.g. 'page', 'focus'). Plain fn() under reduced motion,
   * without the API, or when a transition is already running.
   */
  let running = null;

  function swap(fn, kind = 'page') {
    if (!document.startViewTransition || reduced() || running || document.hidden) {
      fn();
      return null;
    }
    const root = document.documentElement;
    root.classList.add('vt-' + kind);
    try {
      running = document.startViewTransition(fn);
    } catch {
      root.classList.remove('vt-' + kind);
      fn();
      return null;
    }
    running.finished.finally(() => {
      root.classList.remove('vt-' + kind);
      running = null;
    });
    return running;
  }
  window.TnaiMotion = { swap, reduced };

  // Page switches: a real click on a nav item replays itself inside a view transition, so every
  // page's own click handler (08, 30, 65, …) runs unchanged and the page change cross-fades. Window
  // capture runs before those handlers.
  window.addEventListener(
    'click',
    event => {
      if (
        !event.isTrusted ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const item = event.target.closest?.('.sidebar .side-item');
      if (
        !item ||
        item.classList.contains('active') ||
        item.closest('[aria-disabled="true"]') ||
        !document.startViewTransition ||
        reduced() ||
        running
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      swap(() => {
        item.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
        );
      }, 'page');
    },
    true
  );
})();

// ---------- Key hints light up: a hint such as "Ctrl+K" lights up like the mic when its key is
// pressed ---------- On a key press, every visible hint naming
// that combination glows in the mic's listening color until the keys are let go: the composer's
// hint row (each "·"-separated part on its own, e.g. "↵ send · Ctrl+↵ new agent") and <kbd> groups
// ("Ctrl + Space" in Settings). Hints are read at press time, so text other scripts rewrite is
// always current. Window capture phase: a handler that stops the event (palette, terminal,
// composer) can't hide it. Look: 21 .tnai-key-lit (a glow and ring, no layout change).
(() => {
  const SYM = { '↵': 'Enter', '⏎': 'Enter', 'Esc': 'Escape', 'Return': 'Enter' };
  const norm = tok =>
    tok
      .split('+')
      .map(p => p.trim())
      .filter(Boolean)
      .map(
        p =>
          SYM[p] ||
          (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1).toLowerCase())
      )
      .join('+');
  const isKey = tok => /\+/.test(tok) || /^(↵|⏎|\?|Esc|F\d{1,2})$/.test(tok);

  function comboOf(e) {
    let k = e.key;
    if (!k || ['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return '';
    k = k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k;
    const symbol = k.length === 1 && !/[A-Z0-9]/.test(k); // "?" is Shift+/ : the hint says "?"
    return [e.ctrlKey && 'Ctrl', e.shiftKey && !symbol && 'Shift', e.altKey && 'Alt', k]
      .filter(Boolean)
      .join('+');
  }
  const shown = el => !!el.offsetParent || el.getClientRects().length > 0;

  // A hint's "·" parts, wrapped once per text (a rewrite by its owner puts plain text back; it's
  // wrapped again on the next press).
  function parts(hint) {
    if (hint.dataset.kwrap === hint.textContent)
      return [...hint.querySelectorAll(':scope>.tnai-kseg')];
    if (hint.children.length) return [hint]; // hints with their own markup: lit whole
    const segs = hint.textContent.split(/\s+·\s+/);
    hint.replaceChildren(
      ...segs.flatMap((t, i) => {
        const s = document.createElement('span');
        s.className = 'tnai-kseg';
        s.textContent = t;
        return i ? [' · ', s] : [s];
      })
    );
    hint.dataset.kwrap = hint.textContent;
    return [...hint.querySelectorAll(':scope>.tnai-kseg')];
  }
  const keysOf = text => text.split(/\s+/).filter(isKey).map(norm);

  // <kbd> runs joined by "+" text are one combination (Ctrl + Shift + S); each run is lit as a
  // whole.
  function kbdGroups() {
    const out = [],
      done = new Set();
    for (const k of document.querySelectorAll('kbd')) {
      if (done.has(k) || !shown(k)) continue;
      const run = [k];
      done.add(k);
      let n = k.nextSibling;
      while (n) {
        if (n.nodeType === 3 && n.textContent.trim() === '+') {
          n = n.nextSibling;
          continue;
        }
        if (n.nodeType === 1 && n.tagName === 'KBD') {
          run.push(n);
          done.add(n);
          n = n.nextSibling;
          continue;
        }
        break;
      }
      out.push({ els: run, key: norm(run.map(x => x.textContent.trim()).join('+')) });
    }
    return out;
  }
  let lit = [],
    timer = 0;
  const clear = () => {
    clearTimeout(timer);
    lit.forEach(el => el.classList.remove('tnai-key-lit'));
    lit = [];
  };
  window.addEventListener(
    'keydown',
    e => {
      // window capture: before any document handler can stop the event
      if (e.repeat && lit.length) return;
      const combo = comboOf(e);
      if (!combo) return;
      clear();
      for (const hint of document.querySelectorAll('.hints .hint, .tnai-keyhint'))
        if (shown(hint))
          for (const seg of parts(hint)) if (keysOf(seg.textContent).includes(combo)) lit.push(seg);
      for (const g of kbdGroups()) if (g.key === combo) lit.push(...g.els);
      lit.forEach(el => el.classList.add('tnai-key-lit'));

      // a key-up lost to another window can't leave one lit
      if (lit.length) timer = setTimeout(clear, 1500);
    },
    true
  );
  window.addEventListener(
    'keyup',
    () => {
      if (lit.length) setTimeout(clear, 160);
    },
    true
  ); // a quick press still shows
  window.addEventListener('blur', clear);
})();
