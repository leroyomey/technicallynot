// Technically Not · 66-window-controls.js — Desktop only (Windows): the app has no OS title bar
// (desktop/main.js titleBarStyle hidden). Its own minimize / maximize / close buttons sit at the
// right end of the top bar: compact (40×30), CSS :hover with no transition so the highlight is
// instant, calling tnaiNative.frame.control. The top bar's empty space and the logo drag the window
// (double-click maximizes; Windows edge-drag snapping still works) and its controls stay clickable.
// Pop-out windows have no OS title bar either (desktop/panel-windows.js):
// `TnaiWindowFrame.attach(child, head)` puts the same buttons at the right end of the pop-out's own
// top row and makes that row drag its window (its controls stay clickable); the styles reach the
// pop-out with the head copy every pop-out makes.
(() => {
  const native = window.tnaiNative,
    top = document.querySelector('.top'),
    right = document.querySelector('.top-right');
  if (!native?.frame?.control || !top || !right || /Mac/i.test(navigator.platform)) return;

  const style = document.createElement('style');
  style.textContent = `
html.tnai-frameless .top{-webkit-app-region:drag;padding-right:8px}
html.tnai-frameless .top-left>:not(.brand),html.tnai-frameless .top-right>*,html.tnai-frameless .top button,html.tnai-frameless .top a,html.tnai-frameless .top input,html.tnai-frameless .top select{-webkit-app-region:no-drag}
html.tnai-frameless .top .brand img{-webkit-user-drag:none;user-select:none}
html.tnai-frameless [role=dialog],html.tnai-frameless [role=menu],html.tnai-frameless [role=listbox],html.tnai-frameless [aria-modal=true]{-webkit-app-region:no-drag}
.win-ctrls{display:flex;align-items:center;gap:2px;margin-left:4px}
.win-ctrl{width:40px;height:30px;padding:0;border:0;border-radius:6px;background:transparent;color:#6d7069;display:grid;place-items:center;cursor:default;transition:none}
.win-ctrl svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.75}
.win-ctrl:hover{background:#f1f2ed;color:var(--ink)}
.win-ctrl:active{background:#e9eae4}
.win-ctrl.close:hover{background:var(--st-error-dot);color:#fff}
.win-ctrl.close:active{background:var(--st-error-fg);color:#fff}
.win-ctrl:focus-visible{outline:var(--pg-ring,2px) solid #a7bd81;outline-offset:-2px}
.tnai-popbar{-webkit-app-region:drag}
.tnai-popbar :is(button,a,input,select,textarea,label,[role=button],[role=tab],[contenteditable]),.tnai-popbar .win-ctrls{-webkit-app-region:no-drag}
.tnai-popbar>.win-ctrls{flex:none;margin-left:auto;padding-left:4px}
/* A pop-out's top row styles its own buttons (the composer's are bordered): its window buttons keep the main window's look. */
.win-ctrl[hidden]{display:none}
.tnai-popbar .win-ctrl{width:40px;height:30px;min-width:0;padding:0;border:0;border-radius:6px;background:transparent;box-shadow:none;color:#6d7069}
.tnai-popbar .win-ctrl:hover{background:#f1f2ed;color:var(--ink)}
.tnai-popbar .win-ctrl:active{background:#e9eae4}
.tnai-popbar .win-ctrl.close:hover{background:var(--st-error-dot);color:#fff}
.tnai-popbar .win-ctrl.close:active{background:var(--st-error-fg);color:#fff}
`;

  // The dark-theme copy (32) would darken the close glyph's white; keep it white on the red.
  const darkFix = document.createElement('style');
  darkFix.dataset.tnaiDark = '';
  darkFix.textContent =
    'html[data-theme="dark"] .win-ctrl.close:hover,html[data-theme="dark"] .win-ctrl.close:active{color:#fff}html[data-theme="dark"] .tnai-popbar .win-ctrl.close:hover,html[data-theme="dark"] .tnai-popbar .win-ctrl.close:active{color:#fff}';
  document.head.append(style, darkFix);
  document.documentElement.classList.add('tnai-frameless');

  const BUTTONS = () =>
    '<button type="button" class="win-ctrl" data-act="minimize" aria-label="Minimize" title="Minimize">' +
    window.TnaiIcon('minus', { size: 14 }) +
    '</button>' +
    '<button type="button" class="win-ctrl" data-act="maximize" aria-label="Maximize" title="Maximize">' +
    MAX +
    '</button>' +
    '<button type="button" class="win-ctrl close" data-act="close" aria-label="Close" title="Close">' +
    window.TnaiIcon('x', { size: 14 }) +
    '</button>';
  const MAX = window.TnaiIcon('square', { size: 14 });
  const RESTORE = window.TnaiIcon('copy', { size: 14 });
  const box = document.createElement('div');
  box.className = 'win-ctrls';
  box.innerHTML = BUTTONS();
  right.append(box);
  const maxBtn = box.querySelector('[data-act=maximize]');
  const showMaximized = on => {
    maxBtn.innerHTML = on ? RESTORE : MAX;
    maxBtn.title = on ? 'Restore' : 'Maximize';
    maxBtn.setAttribute('aria-label', maxBtn.title);
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('.win-ctrl');
    if (b) native.frame.control(b.dataset.act).catch(() => {});
  });
  box.addEventListener('dblclick', e => e.stopPropagation());
  native.frame.onMaximized(on => showMaximized(!!on));

  // A pop-out window (child: the window.open result, named tnai-…; head: its top row). Returns
  // detach(), for when the row goes back into Technically Not's window (a docked Build panel keeps
  // its header). The composer can't maximize: that button is left out.
  window.TnaiWindowFrame = {
    attach(child, head) {
      const name = child?.name,
        api = native.panels?.control;
      if (!api || !name || !head) return () => {};
      const doc = head.ownerDocument,
        ctrls = doc.createElement('div');
      ctrls.className = 'win-ctrls';
      ctrls.innerHTML = BUTTONS();
      const max = ctrls.querySelector('[data-act=maximize]');
      const paint = st => {
        if (!st) {
          ctrls.remove();
          head.classList.remove('tnai-popbar');
          return;
        } // still framed (macOS): no buttons of ours
        max.hidden = st.maximizable === false;
        ctrls.querySelector('[data-act=minimize]').hidden = st.minimizable === false;
        max.innerHTML = st.maximized ? RESTORE : MAX;
        max.title = st.maximized ? 'Restore' : 'Maximize';
        max.setAttribute('aria-label', max.title);
      };
      const refresh = () =>
        api(name, 'state')
          .then(paint)
          .catch(() => {});
      ctrls.addEventListener('click', e => {
        const b = e.target.closest('.win-ctrl');
        if (b)
          api(name, b.dataset.act)
            .then(r => {
              if (r && !r.closed) refresh();
            })
            .catch(() => {});
      });
      ctrls.addEventListener('dblclick', e => e.stopPropagation());

      // not a drag of the row it sits in
      ctrls.addEventListener('pointerdown', e => e.stopPropagation());
      head.classList.add('tnai-popbar');
      head.append(ctrls);

      // A row that rebuilds its children (Live preview's tab strip on every render) gets the
      // buttons back at its end.
      const keep = new child.MutationObserver(() => {
        if (ctrls.isConnected && ctrls.parentNode === head && head.lastElementChild === ctrls)
          return;
        head.append(ctrls);
      });
      keep.observe(head, { childList: true });
      child.addEventListener('resize', refresh);
      refresh();
      return () => {
        keep.disconnect();
        child.removeEventListener('resize', refresh);
        ctrls.remove();
        head.classList.remove('tnai-popbar');
      };
    },
  };
  native.frame
    .control('state')
    .then(state => {
      if (state) {
        showMaximized(state.maximized);
        return;
      }
      box.remove();
      style.remove();
      darkFix.remove();
      document.documentElement.classList.remove('tnai-frameless'); // a framed pop-out
    })
    .catch(() => {});
})();
