// Technically Not · 133-thread-side-size.js — Desktop only: the side column of the Threads page
// (Files, helpers; 131, 123) can be dragged wider or narrower.
//
// A thin handle stands just inside the column's left edge. Dragging it sets
// the column's width (the style sheet reads --tnt-side-w on the layout, 27), between MIN_W and
// what leaves the thread MIN_THREAD_W of room. The left and right arrow keys move it while the
// handle has the keyboard, a double press puts the width back to the app's own, and the width is
// remembered (`tnai.thread-side-w.v1`). Look: src/styles/35-thread-side.css. Test `thread-side`.
(() => {
  'use strict';
  if (!window.tnaiNative) return;
  const layout = document.querySelector('.layout');
  if (!layout) return;

  const KEY = 'tnai.thread-side-w.v1';
  const MIN_W = 320;
  const MIN_THREAD_W = 420;
  const STEP = 24;

  let handle = null;

  // The widest the column may be now: the layout's width less the list, the gaps and the room the
  // thread keeps.
  function widest() {
    const list = layout.querySelector(':scope > .tnt-list');
    const room = layout.clientWidth - (list?.offsetWidth || 0) - MIN_THREAD_W - 48;
    return Math.max(MIN_W, room);
  }

  function apply(width, keep) {
    if (!(width > 0)) {
      layout.style.removeProperty('--tnt-side-w');
      if (keep) {
        try {
          localStorage.removeItem(KEY);
        } catch {}
      }
      return;
    }
    const set = Math.round(Math.max(MIN_W, Math.min(widest(), width)));
    layout.style.setProperty('--tnt-side-w', set + 'px');
    handle?.setAttribute('aria-valuenow', String(set));
    if (keep) {
      try {
        localStorage.setItem(KEY, String(set));
      } catch {}
    }
  }

  function build() {
    const side = layout.querySelector(':scope > .tnt-side');
    if (!side || handle?.parentNode === side) return;
    handle = document.createElement('div');
    handle.className = 'tnt-side-grip';
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Width of the side column');
    handle.title = 'Drag to make the column wider or narrower · double press: the usual width';
    side.append(handle);

    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      layout.classList.add('tnt-side-sizing');
      const startX = event.clientX;
      const startWidth = side.getBoundingClientRect().width;
      const move = moved => apply(startWidth + (startX - moved.clientX), false);
      const end = ended => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
        layout.classList.remove('tnt-side-sizing');
        apply(startWidth + (startX - ended.clientX), true);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
    handle.addEventListener('dblclick', () => apply(0, true));
    handle.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const now = side.getBoundingClientRect().width;
      apply(now + (event.key === 'ArrowLeft' ? STEP : -STEP), true);
    });

    let saved = 0;
    try {
      saved = Number(localStorage.getItem(KEY)) || 0;
    } catch {}
    if (saved) apply(saved, false);
  }

  // The column is made when the thread layout is built, and shown when something opens it.
  window.addEventListener('tnai:threads-side', build);
  window.addEventListener('tnai:threads-shown', build);
  build();

  window.TnaiThreadSideSize = { set: width => apply(width, true), build };
})();
