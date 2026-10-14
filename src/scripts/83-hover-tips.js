/*
 * Technically Not · 83-hover-tips.js — Calm tooltips for every `title` in the app
 * (helpful, never invasive). The browser's own title tooltip pops up on anything the
 * pointer brushes past; this replaces it app-wide without touching a call site:
 * - A tip shows only after the pointer has RESTED on a titled control for 800 ms. Any movement over
 * 4 px restarts the wait, so sweeping across the UI never shows one. Once a tip was shown, the next
 * one within 700 ms appears after 250 ms (you are clearly reading tips).
 * - Mouse/pen-hover only: touch never shows tips. Keyboard focus (Tab, :focus-visible) shows the
 * same tip after the same wait, except in text fields (it would cover what you type).
 * - Hidden at once by a press, a key, the wheel, scrolling, the window losing focus or the control
 * leaving the page; after a click the control stays quiet until the pointer leaves it. Escape hides
 * it. The tip is role="tooltip" and never takes the pointer (pointer-events:none), so it can't
 * cover or block the control next to it.
 * - While the pointer is on a control its title attribute is parked (that is what stops the
 * browser's own tip) and put back when it leaves; titles other scripts set meanwhile are picked up
 * live (a MutationObserver on that one element only). A title that was the control's only name is
 * kept as a temporary aria-label, and the shown tip is its aria-describedby.
 * - Big targets (agent cards, rows) anchor the tip under the pointer like the native one; small
 * controls get it above (else below), centered. No polling; listeners are passive document-level
 * delegates. `data-tnai-native-tip` on an element opts it out.
 */
(() => {
  const REST_MS = 800,
    WARM_MS = 250,
    WARM_WINDOW_MS = 700,
    MOVE_PX = 4;

  const style = document.createElement('style');
  style.textContent = `
.tnai-tip{position:fixed;left:0;top:0;z-index:2147483100;max-width:min(340px,calc(100vw - 16px));padding:6px 9px;border:1px solid var(--line);border-radius:6px;background:var(--white);color:var(--ink);box-shadow:var(--shadow),0 1px 3px #20211f14;font:500 11px/1.45 var(--pg-sans);white-space:pre-line;overflow-wrap:anywhere;opacity:0;transform:translateY(2px);transition:opacity .15s ease,transform .15s ease;pointer-events:none;visibility:hidden}
.tnai-tip.is-on{opacity:1;transform:none;visibility:visible}
@media (prefers-reduced-motion:reduce){.tnai-tip{transition:none;transform:none}}`;
  document.head.append(style);

  const tip = document.createElement('div');
  tip.className = 'tnai-tip';
  tip.id = 'tnaiHoverTip';
  tip.setAttribute('role', 'tooltip');
  const mount = () => {
    if (!tip.isConnected) document.body.append(tip);
  };

  let owner = null; // element whose title is parked
  let text = ''; // its title while parked
  let addedLabel = false; // we added a temporary aria-label
  let prevDescribed = null;
  let shown = false,
    lastHide = 0,
    timer = 0;
  let rest = { x: 0, y: 0 },
    via = 'pointer',
    quietEl = null;

  // Titled elements around the parked one (an agent row around its "Doing now" text): with the
  // inner title off, the browser shows the next title up the tree as its own white tooltip beside
  // ours (two tooltips at once on an Overview list row). They are parked too and
  // put back on release; a title another script sets on one of them meanwhile is parked again.
  let outer = []; // [element, title]
  const outerWatch = new MutationObserver(list => {
    for (const m of list) {
      const pair = outer.find(p => p[0] === m.target),
        t = m.target.getAttribute('title');
      if (pair && t !== null) {
        pair[1] = t;
        m.target.removeAttribute('title');
      }
    }
  });

  const watch = new MutationObserver(() => {
    if (!owner) return;
    const t = owner.getAttribute('title');
    if (t === null) return; // our own removal
    text = t;
    owner.removeAttribute('title');
    if (!text.trim()) hide();
    else if (shown) {
      tip.textContent = text;
      place();
    }

    // The title came back while the pointer still rests on the control: a terminal link's title
    // is emptied and set again 5 ms after the first hover (xterm sends leave, then hover), and
    // emptying it had stopped the wait above. The wait starts again.
    else if (via === 'pointer') arm();
  });

  const findOwner = el => {
    // Inside the parked control: its title is off while parked, so closest('[title]') would miss it
    // when it repaints its children under the pointer.
    if (owner && el instanceof Node && owner.contains(el)) return owner;
    const o = el?.closest?.('[title]');
    if (
      !o ||
      o === document.documentElement ||
      o === document.body ||
      o.closest('[data-tnai-native-tip]') ||
      o.tagName === 'IFRAME'
    )
      return null;
    return o;
  };

  function park(el) {
    if (owner === el) return;
    release();
    owner = el;
    text = el.getAttribute('title') || '';
    el.removeAttribute('title');
    if (
      !el.hasAttribute('aria-label') &&
      !el.hasAttribute('aria-labelledby') &&
      !el.textContent.trim() &&
      text
    ) {
      el.setAttribute('aria-label', text);
      addedLabel = true;
    }
    watch.observe(el, { attributes: true, attributeFilter: ['title'] });
    for (let a = el.parentElement?.closest('[title]'); a; a = a.parentElement?.closest('[title]')) {
      outer.push([a, a.getAttribute('title')]);
      a.removeAttribute('title');
      outerWatch.observe(a, { attributes: true, attributeFilter: ['title'] });
    }
  }

  function release() {
    clearTimeout(timer);
    if (shown) hide();
    if (!owner) return;
    watch.disconnect();
    outerWatch.disconnect();
    for (const [a, t] of outer)
      if (a.getAttribute('title') === null && t) a.setAttribute('title', t);
    outer = [];
    if (owner.getAttribute('title') === null && text) owner.setAttribute('title', text);
    if (addedLabel && owner.getAttribute('aria-label') === text)
      owner.removeAttribute('aria-label');
    owner = null;
    text = '';
    addedLabel = false;
  }

  // TnaiFloat (100) flips below / shifts at the edges. A big owner reached by pointer gets the tip
  // under the pointer instead.
  function place() {
    if (!owner) return;
    const r = owner.getBoundingClientRect();
    if (via === 'pointer' && (r.height > 64 || r.width > 380)) {
      const x = rest.x,
        y = rest.y;
      window.TnaiFloat?.attach(
        {
          contextElement: owner,
          getBoundingClientRect: () => ({
            x,
            y,
            left: x,
            top: y,
            right: x,
            bottom: y,
            width: 0,
            height: 0,
          }),
        },
        tip,
        { placement: 'bottom', offset: 18, fade: false }
      );
    } else window.TnaiFloat?.attach(owner, tip, { placement: 'top', offset: 8, fade: false });
  }

  function show() {
    if (!owner || !owner.isConnected || !text.trim() || document.hidden) return release();
    mount();
    tip.textContent = text;
    place();
    tip.classList.add('is-on');
    shown = true;
    prevDescribed = owner.getAttribute('aria-describedby');
    owner.setAttribute('aria-describedby', prevDescribed ? prevDescribed + ' ' + tip.id : tip.id);
  }

  function hide() {
    clearTimeout(timer);
    if (!shown) return;
    shown = false;
    lastHide = Date.now();
    tip.classList.remove('is-on');
    window.TnaiFloat?.detach(tip);
    if (owner) {
      if (prevDescribed) owner.setAttribute('aria-describedby', prevDescribed);
      else owner.removeAttribute('aria-describedby');
    }
    prevDescribed = null;
  }
  const arm = () => {
    clearTimeout(timer);
    if (!shown)
      timer = setTimeout(show, Date.now() - lastHide < WARM_WINDOW_MS ? WARM_MS : REST_MS);
  };

  // Pointer (mouse and pen only).
  document.addEventListener(
    'pointerover',
    e => {
      if (e.pointerType === 'touch') return;
      const o = findOwner(e.target);
      if (o === owner) return;
      release();
      if (!o) return;
      via = 'pointer';
      rest = { x: e.clientX, y: e.clientY };
      park(o);

      // a just-clicked control stays parked (no native tip either) but quiet
      if (o !== quietEl) arm();
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'pointerout',
    e => {
      if (e.pointerType === 'touch') return;
      const to = e.relatedTarget;

      // quiet lasts until the pointer leaves that control
      if (quietEl && !(to && quietEl.contains(to))) quietEl = null;
      if (!owner || (to && owner.contains(to))) return;
      release();
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'pointermove',
    e => {
      if (e.pointerType === 'touch' || !owner || shown || via !== 'pointer' || owner === quietEl)
        return;
      if (!owner.isConnected) return release();
      if (Math.abs(e.clientX - rest.x) > MOVE_PX || Math.abs(e.clientY - rest.y) > MOVE_PX) {
        rest = { x: e.clientX, y: e.clientY };
        arm();
      }
    },
    { capture: true, passive: true }
  );

  document.addEventListener(
    'pointerdown',
    e => {
      if (owner && owner.contains(e.target)) quietEl = owner;
      release();
    },
    { capture: true, passive: true }
  );

  // Keyboard focus.
  const typing = el =>
    el.isContentEditable ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    (el.tagName === 'INPUT' &&
      !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type));
  document.addEventListener(
    'focusin',
    e => {
      const el = e.target;
      if (!(el instanceof Element) || typing(el)) return;
      let visible = false;
      try {
        visible = el.matches(':focus-visible');
      } catch {}
      if (!visible) return;
      const o = findOwner(el);
      if (!o || o === owner) return;
      release();
      via = 'focus';
      park(o);
      arm();
    },
    true
  );
  document.addEventListener(
    'focusout',
    () => {
      if (via === 'focus') release();
    },
    true
  );

  document.addEventListener(
    'keydown',
    e => {
      if (!owner) return;
      if (e.key === 'Escape' && via === 'pointer') quietEl = owner;
      hide();
    },
    true
  );
  document.addEventListener(
    'wheel',
    () => {
      if (owner) release();
    },
    { capture: true, passive: true }
  );

  // Only a scroll that moves the control counts (a terminal streaming elsewhere must not dismiss
  // the tip).
  document.addEventListener(
    'scroll',
    e => {
      if (owner && e.target.contains?.(owner)) release();
    },
    { capture: true, passive: true }
  );
  document.addEventListener('dragstart', release, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });
  window.addEventListener('blur', release);
  window.addEventListener('resize', release);

  window.TnaiHoverTips = {
    hide: release,
    get shown() {
      return shown;
    },
    get owner() {
      return owner;
    },
    REST_MS,
  };
})();
