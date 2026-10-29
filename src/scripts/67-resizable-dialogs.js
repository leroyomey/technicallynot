// Technically Not · resizable dialogs — every [role="dialog"] box gets a resize grip (shown on
// hover); dragging it resizes the box within the window and its main content grows or shrinks with
// it
(() => {
  'use strict';

  // Per-dialog exceptions: '' = not resizable, 'x' = width only. Owners can also opt out with
  // data-no-resize.
  const RULES = [];
  const Z = 14,
    EDGE = 7,
    M = 8,
    PROBE = 40;
  const style = document.createElement('style');
  style.textContent = `
:root{--tnai-grip:#8a8f8480}
[data-tnai-rz]:hover,[data-tnai-resizing]{background-repeat:no-repeat!important;background-size:10px 10px!important}
[data-tnai-rz=se]:hover,[data-tnai-rz=se][data-tnai-resizing]{background-image:linear-gradient(135deg,transparent 48%,var(--tnai-grip) 48% 56%,transparent 56% 70%,var(--tnai-grip) 70% 78%,transparent 78%)!important;background-position:right 3px bottom 3px!important}
[data-tnai-rz=sw]:hover,[data-tnai-rz=sw][data-tnai-resizing]{background-image:linear-gradient(225deg,transparent 48%,var(--tnai-grip) 48% 56%,transparent 56% 70%,var(--tnai-grip) 70% 78%,transparent 78%)!important;background-position:left 3px bottom 3px!important}
[data-tnai-rz=ne]:hover,[data-tnai-rz=ne][data-tnai-resizing]{background-image:linear-gradient(45deg,transparent 48%,var(--tnai-grip) 48% 56%,transparent 56% 70%,var(--tnai-grip) 70% 78%,transparent 78%)!important;background-position:right 3px top 3px!important}
[data-tnai-rz=nw]:hover,[data-tnai-rz=nw][data-tnai-resizing]{background-image:linear-gradient(315deg,transparent 48%,var(--tnai-grip) 48% 56%,transparent 56% 70%,var(--tnai-grip) 70% 78%,transparent 78%)!important;background-position:left 3px top 3px!important}
:is([data-tnai-rz=w],[data-tnai-rz=e]):is(:hover,[data-tnai-resizing]){background-image:linear-gradient(var(--tnai-grip),var(--tnai-grip))!important;background-size:2px 28px!important}
[data-tnai-rz=w]{background-position:left 2px center!important}[data-tnai-rz=e]{background-position:right 2px center!important}
:is([data-tnai-rz=s],[data-tnai-rz=n]):is(:hover,[data-tnai-resizing]){background-image:linear-gradient(var(--tnai-grip),var(--tnai-grip))!important;background-size:28px 2px!important}
[data-tnai-rz=s]{background-position:center bottom 2px!important}[data-tnai-rz=n]{background-position:center top 2px!important}
[data-tnai-rz-hot],[data-tnai-rz-hot] *{cursor:var(--tnai-rz-cursor)!important}
html[data-tnai-rz-drag],html[data-tnai-rz-drag] *{cursor:var(--tnai-rz-cursor)!important;user-select:none!important}
[data-tnai-resized]:not([hidden]),[data-tnai-grow-col]:not([hidden]){display:flex!important;flex-direction:column!important}
[data-tnai-resized]{overflow-y:auto!important}
[data-tnai-resized]>*,[data-tnai-grow-col]>*{flex:none}
:is([data-tnai-resized],[data-tnai-grow-col])>[data-tnai-grow]{flex:1 1 auto!important;min-height:0!important;max-height:none!important}
[data-tnai-grow]:not([data-tnai-grow-col]){overflow-y:auto!important;align-content:start}`;
  document.head.append(style);

  const CURSOR = {
    se: 'nwse-resize',
    nw: 'nwse-resize',
    sw: 'nesw-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    s: 'ns-resize',
    n: 'ns-resize',
  };
  const info = new WeakMap(); // dialog → { h: 'e'|'w'|'', v: 's'|'n'|'', kx, ky }
  const axesFor = el => {
    if (el.hasAttribute('data-no-resize')) return '';
    for (const [sel, ax] of RULES) if (el.matches(sel)) return ax;
    return 'xy';
  };
  const px = v => parseFloat(v) || 0;

  // Which edges move when the box grows, and how fast (a centered box grows on both sides: the grip
  // moves half as fast as its size).
  function probe(el, axes) {
    const st = el.style,
      keep = [
        st.width,
        st.height,
        st.maxWidth,
        st.maxHeight,
        st.minWidth,
        st.minHeight,
        st.transition,
      ];
    const cs = getComputedStyle(el),
      a = el.getBoundingClientRect();
    st.transition = 'none';
    if (axes.includes('x')) {
      st.minWidth = '0';
      st.maxWidth = 'none';
      st.width = px(cs.width) + PROBE + 'px';
    }
    if (axes.includes('y')) {
      st.minHeight = '0';
      st.maxHeight = 'none';
      st.height = px(cs.height) + PROBE + 'px';
    }
    const b = el.getBoundingClientRect();
    [st.width, st.height, st.maxWidth, st.maxHeight, st.minWidth, st.minHeight, st.transition] =
      keep;
    const side = (grow, shrink, hi, lo) => {
      const d = Math.max(hi, lo);
      return d < 1 ? ['', 0] : [hi >= lo ? grow : shrink, Math.min(2.5, Math.max(1, PROBE / d))];
    };
    const [h, kx] = side('e', 'w', b.right - a.right, a.left - b.left),
      [v, ky] = side('s', 'n', b.bottom - a.bottom, a.top - b.top);
    return { h, v, kx, ky };
  }

  function setup(el) {
    const axes = el.hasAttribute('data-tnai-resizing') ? null : axesFor(el);
    if (axes === null) return;
    const i = axes && el.getClientRects().length ? probe(el, axes) : null;
    if (!i || !(i.h || i.v)) {
      info.delete(el);
      el.removeAttribute('data-tnai-rz');
      return;
    }
    info.set(el, i);
    el.dataset.tnaiRz = i.v + i.h;
  }

  function inZone(el, i, x, y) {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
    const onX =
      i.h === 'e'
        ? x >= r.right - (i.v ? Z : EDGE)
        : i.h === 'w'
          ? x <= r.left + (i.v ? Z : EDGE)
          : false;
    const onY =
      i.v === 's'
        ? y >= r.bottom - (i.h ? Z : EDGE)
        : i.v === 'n'
          ? y <= r.top + (i.h ? Z : EDGE)
          : false;
    return i.h && i.v ? onX && onY : i.h ? onX : onY;
  }

  // Resized height: the box becomes a flex column; its largest body part (and a wrapper's dominant
  // child, a few levels down) fills the space and scrolls; headers and action rows keep their size.
  const FIXED = /(^|[-_\s])(head|header|foot|footer|actions|title|close|x|logo)([-_\s]|$)/i;

  function pick(node) {
    let best = null,
      bh = 0;
    for (const c of node.children) {
      if (
        !c.getClientRects().length ||
        /^(H[1-6]|HEADER|FOOTER|BUTTON|SCRIPT|STYLE|TEMPLATE)$/.test(c.tagName) ||
        FIXED.test(typeof c.className === 'string' ? c.className : '')
      )
        continue;
      const pos = getComputedStyle(c).position;
      if (pos === 'absolute' || pos === 'fixed') continue;
      if (c.offsetHeight > bh) {
        bh = c.offsetHeight;
        best = c;
      }
    }
    return best;
  }

  function markGrow(box) {
    box.querySelectorAll('[data-tnai-grow],[data-tnai-grow-col]').forEach(n => {
      n.removeAttribute('data-tnai-grow');
      n.removeAttribute('data-tnai-grow-col');
    });

    // A list laid out in several columns (the shortcuts list, `column-count: 2`) keeps its own
    // height and its columns: made a flex column, its sections spilled over each other after a
    // drag, and given the dialog's height it adds columns sideways instead of scrolling down
    // (learned 2026-10-28, bug sweep: the browser tests). The box around it scrolls instead.
    const multiColumn = node => {
      const cs = getComputedStyle(node);
      return cs.columnCount !== 'auto' || cs.columnWidth !== 'auto';
    };
    let g = pick(box);
    if (g && multiColumn(g)) return;
    for (let depth = 0; g && depth < 4; depth++) {
      g.setAttribute('data-tnai-grow', '');
      const cs = getComputedStyle(g),
        column =
          cs.display === 'block' ||
          (cs.display === 'flex' && cs.flexDirection.startsWith('column'));
      if (
        !column ||
        /^(P|UL|OL|TABLE|PRE|TEXTAREA|SELECT|IFRAME)$/.test(g.tagName) ||
        [...g.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      )
        break;
      const c = pick(g);
      if (!c || c.offsetHeight < g.clientHeight * 0.7 || multiColumn(c)) break;
      g.setAttribute('data-tnai-grow-col', '');
      g = c;
    }
  }

  let hot = null,
    drag = null;
  const setHot = (el, on) => {
    if (!el) return;
    if (on) {
      el.setAttribute('data-tnai-rz-hot', '');
      el.style.setProperty('--tnai-rz-cursor', CURSOR[el.dataset.tnaiRz]);
    } else if (el.hasAttribute('data-tnai-rz-hot')) el.removeAttribute('data-tnai-rz-hot');
  };
  document.addEventListener(
    'pointerover',
    event => {
      if (drag) return;
      const d = event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
      if (d === hot) return;
      setHot(hot, false);
      hot = d;
      if (d) setup(d);
    },
    true
  );
  document.addEventListener(
    'pointermove',
    event => {
      if (drag || !hot) return;
      const i = info.get(hot),
        on = !!i && inZone(hot, i, event.clientX, event.clientY);
      if (on !== hot.hasAttribute('data-tnai-rz-hot')) setHot(hot, on);
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    'pointerdown',
    event => {
      if (drag || !hot || event.button !== 0) return;
      const el = hot,
        i = info.get(el);
      if (!i || !inZone(el, i, event.clientX, event.clientY)) return;
      event.preventDefault();
      event.stopPropagation();
      const cs = getComputedStyle(el),
        r = el.getBoundingClientRect(),
        st = el.style,
        vw = innerWidth,
        vh = innerHeight;
      const w0 = px(cs.width),
        h0 = px(cs.height);
      const maxW = Math.max(
        w0,
        Math.min(vw * 0.96, w0 + (i.h === 'e' ? vw - M - r.right : r.left - M) * i.kx)
      );
      const maxH = Math.max(
        h0,
        Math.min(vh * 0.92, h0 + (i.v === 's' ? vh - M - r.bottom : r.top - M) * i.ky)
      );
      const minW = Math.min(w0, 280),
        minH = Math.min(h0, 140),
        x0 = event.clientX,
        y0 = event.clientY,
        transition = st.transition;
      const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v)));
      let x = x0,
        y = y0,
        raf = 0;
      const apply = () => {
        raf = 0;
        if (i.h) {
          st.maxWidth = '96vw';
          st.minWidth = '0';
          st.width = clamp(w0 + (x - x0) * (i.h === 'e' ? 1 : -1) * i.kx, minW, maxW) + 'px';
        }
        if (i.v) {
          st.maxHeight = '92vh';
          st.minHeight = '0';
          st.height = clamp(h0 + (y - y0) * (i.v === 's' ? 1 : -1) * i.ky, minH, maxH) + 'px';
        }
      };
      const move = e => {
        if (e.pointerId !== event.pointerId) return;
        x = e.clientX;
        y = e.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      };
      const end = e => {
        if (e.pointerId !== event.pointerId) return;
        if (raf) cancelAnimationFrame(raf);
        if (e.type === 'pointerup') {
          x = e.clientX;
          y = e.clientY;
          apply();
        }
        removeEventListener('pointermove', move, true);
        removeEventListener('pointerup', end, true);
        removeEventListener('pointercancel', end, true);
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {}
        st.transition = transition;
        el.removeAttribute('data-tnai-resizing');
        document.documentElement.removeAttribute('data-tnai-rz-drag');
        drag = null;
        setHot(el, false);
      };
      drag = el;
      st.transition = 'none';

      // Owners that auto-place their dialog (06 launcher, 44 result pop) leave it where it is while
      // data-tnai-resizing is set.
      el.setAttribute('data-tnai-resizing', '');
      document.documentElement.setAttribute('data-tnai-rz-drag', '');
      document.documentElement.style.setProperty('--tnai-rz-cursor', CURSOR[el.dataset.tnaiRz]);
      if (i.v) {
        el.setAttribute('data-tnai-resized', '');
        markGrow(el);
      }
      try {
        el.setPointerCapture(event.pointerId);
      } catch {}
      addEventListener('pointermove', move, true);
      addEventListener('pointerup', end, true);
      addEventListener('pointercancel', end, true);
    },
    true
  );
})();
