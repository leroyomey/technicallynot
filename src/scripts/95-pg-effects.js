/*
 * Technically Not · 95-pg-effects.js — Spotlight border on glass surfaces: while the pointer is
 * over one, writes its position into --mx/--my on that surface so the ::before border glow in
 * 07-purple-glass.css follows the cursor. One passive listener, at most one write per frame;
 * nothing runs while the pointer is still.
 */
(() => {
  const HOSTS = '.pg-glass,.set-card,.provider-card,.lpp-card,.terminal-provider-card';
  let pending = null,
    frame = 0;
  document.addEventListener(
    'pointermove',
    event => {
      pending = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const e = pending,
          host = e.target?.closest?.(HOSTS);
        if (!host) return;
        const r = host.getBoundingClientRect();
        host.style.setProperty('--mx', Math.round(e.clientX - r.left) + 'px');
        host.style.setProperty('--my', Math.round(e.clientY - r.top) + 'px');
      });
    },
    { passive: true }
  );
  window.TnaiPgEffects = { HOSTS };
})();
