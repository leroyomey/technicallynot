// Technically Not · 55-quiet-scrollbars.js — Quiet scrollbars app-wide: every scrollbar is
// invisible until you scroll that box, then a thin muted-green pill shows on it alone and hides
// ~0.9s after you stop, so side-by-side panels never stack a row of bars. Pointing at a bar's edge
// also shows it (to grab and drag). Terminal (xterm) sliders get the same pill look.
(() => {
  const style = document.createElement('style');
  style.textContent = `
::-webkit-scrollbar{width:8px;height:8px;background:transparent}
::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}
::-webkit-scrollbar-track:hover{background:#f1f3ee}
::-webkit-scrollbar-thumb{min-height:28px;min-width:28px;border:2px solid transparent;border-radius:8px;background:transparent;background-clip:padding-box}
.tnai-scrolling::-webkit-scrollbar-thumb,::-webkit-scrollbar-thumb:hover{background-color:#bcc6ad}
::-webkit-scrollbar-thumb:active{background-color:#9aab85}
.xterm .xterm-scrollable-element>.scrollbar.vertical>.slider{width:4px!important;left:auto!important;right:2px!important;border-radius:4px;background:#bcc6ad!important}
.xterm .xterm-scrollable-element>.scrollbar.vertical>.slider:hover,.xterm .xterm-scrollable-element>.scrollbar.vertical>.slider.active{width:6px!important;background:#9aab85!important}
.xterm .xterm-scrollable-element>.shadow{display:none}`;
  document.head.append(style);

  // Only scrolls the user caused light a bar; a feed or terminal scrolling itself stays quiet.
  let lastInput = 0;
  const touched = () => {
    lastInput = performance.now();
  };
  for (const type of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
    window.addEventListener(type, touched, { capture: true, passive: true });

  const timers = new WeakMap();
  document.addEventListener(
    'scroll',
    event => {
      if (performance.now() - lastInput > 1000) return;
      const el = event.target === document ? document.scrollingElement : event.target;
      if (!(el instanceof Element)) return;
      el.classList.add('tnai-scrolling');
      clearTimeout(timers.get(el));
      timers.set(
        el,
        setTimeout(() => el.classList.remove('tnai-scrolling'), 900)
      );
    },
    { capture: true, passive: true }
  );
})();
