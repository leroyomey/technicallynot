/*
 * Technically Not · 105-terminal-preview.js — Desktop only: the Live preview column of the
 * "All threads" page. The page is threads | Live preview, beside the thread list (135 draws the
 * threads). This file adds the preview, one more view of 31's tabs and servers
 * (`TnaiLivePreview.mount`, browser toolbar), and the divider to drag between the two (30% to 70%
 * of their width; under 860 px the page is stacked and the preview is closed there, 38). The
 * preview column can be put away (127 has the button; `previewOpen`, `setPreview`). The terminal
 * panel of the agent whose page is shown is marked `tp-owner` (109 reads it). Saved in
 * `tnai.terminal-preview.v1` (the divider, the preview shown or not).
 *
 * This file once held three views of a Terminal page (a list of agents with one terminal, tall
 * terminals side by side, a plain grid). The app is threads only since 2026-10-12, and the list
 * and the grid were taken out on 2026-10-13: nothing can show the terminal panels as a page.
 *
 * `window.TnaiTerminalPreview`: `pick(paneId)` (a press on a thread in the thread list while this
 * page is shown, 118: the prompt box talks to that agent and 135 brings its thread onto the
 * page), `picked()`, `previewOpen()`, `setPreview(open)`.
 * Look: src/styles/11-terminal-purple.css. Tests `all-threads-preview`, `thread-terminal`.
 */
(() => {
  const view = document.getElementById('terminalView');
  const livePreview = window.TnaiLivePreview;
  const content = view?.querySelector('.terminal-content');
  if (!view || !content || !livePreview?.mount || !window.tnaiNative) return;

  const KEY = 'tnai.terminal-preview.v1';
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const clamp = share => Math.max(30, Math.min(70, share));
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {}

  // Whether the preview column is open (127 has its button), the threads' share of the width,
  // and the thread last pressed in the thread list.
  let previewOpen = saved.preview !== false;
  let left = clamp(+saved.left || 43);
  let picked = '';

  const save = () => {
    try {
      // `view` and `v` are kept as older builds wrote them, so a step back reads the same record
      localStorage.setItem(
        KEY,
        JSON.stringify({ left, view: 'pages', preview: previewOpen, v: 2 })
      );
    } catch {}
  };

  // ---------- the pieces: divider and preview ----------
  const divider = element('div', 'tp-divider');
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.title = 'Drag to resize';
  divider.tabIndex = 0;
  const host = element('div', 'tp-preview');
  const blank = box => {
    if (!box.firstChild)
      box.append(
        element(
          'p',
          'lp-note',
          'Type a localhost address above, or ask an agent to show its page. A page an agent shows opens here by itself.'
        )
      );
  };
  content.after(divider, host);
  const mounted = livePreview.mount(host, { browser: true, blank });

  // The page's width is read once and then kept by the ResizeObserver below: asking the page on
  // every refresh forced a layout each time (3.7 s of a fast agent switch run, 2026-10-05).
  let viewWidth = view.clientWidth;
  const stacked = () => viewWidth < 860;

  function layout() {
    view.classList.add('tp-on', 'tp-pages');
    view.classList.toggle('tp-noprev', !previewOpen);
    view.classList.toggle('tp-stack', stacked());
    view.style.setProperty('--tp-a', left + 'fr');
    view.style.setProperty('--tp-b', 100 - left + 'fr');

    // the preview's share as a part of the page's width (32: the page caps it)
    view.style.setProperty('--tp-right', 100 - left + '%');
    divider.setAttribute('aria-valuenow', String(Math.round(left)));
  }

  // The preview column, shown or put away (127's button). The threads take its room at once:
  // one change of width, so each one is fitted once.
  function setPreview(open) {
    if (previewOpen === !!open) return;
    previewOpen = !!open;
    save();
    layout();
    if (previewOpen) mounted.shown?.();
    window.dispatchEvent(new CustomEvent('tnai:terminal-preview-open', { detail: { open } }));
  }

  // Divider: drag, or ← → with it focused. The preview ignores the pointer while dragging so its
  // page never swallows the drag.
  divider.addEventListener('pointerdown', event => {
    if (stacked()) return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    view.classList.add('tp-dragging');
    const start = content.getBoundingClientRect().left;
    const width = host.getBoundingClientRect().right - start;
    const move = moved => {
      left = clamp((100 * (moved.clientX - start)) / width);
      layout();
    };
    const up = () => {
      divider.removeEventListener('pointermove', move);
      view.classList.remove('tp-dragging');
      save();
      mounted.shown?.();
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', up, { once: true });
    divider.addEventListener('pointercancel', up, { once: true });
  });
  divider.addEventListener('keydown', event => {
    if (stacked() || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    left = clamp(left + (event.key === 'ArrowLeft' ? -2 : 2));
    layout();
    save();
    mounted.shown?.();
  });

  // A press on a thread in the thread list while this page is shown (118): the prompt box talks
  // to that agent, and 135 hears the change and brings its thread onto the page.
  function pick(paneId) {
    picked = paneId || '';
    if (picked) window.TnaiLiveTasks?.setTarget?.(picked);
  }

  // The panel of the agent whose page is on screen is marked (31 knows who showed each tab).
  function markOwner() {
    const owner = livePreview.tabs().find(tab => tab.active)?.byPane || '';
    content.querySelectorAll('.terminal-pane.tp-owner').forEach(pane => {
      if (pane.dataset.paneId !== owner) pane.classList.remove('tp-owner');
    });
    if (owner)
      content
        .querySelector('.terminal-pane[data-pane-id="' + CSS.escape(owner) + '"]')
        ?.classList.add('tp-owner');
  }
  livePreview.onChange(markOwner);

  let queued = 0;

  function refresh() {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0;
      layout();
      markOwner();
    });
  }

  // Panels and workspaces coming and going (the owner's mark), and the page's width (stacked or
  // not). Never the terminals' own output: that subtree is not watched.
  new MutationObserver(refresh).observe(content, { childList: true });
  window.addEventListener('tnai:terminal-pane-closed', refresh);
  new ResizeObserver(entries => {
    const last = entries[entries.length - 1];
    viewWidth = last.borderBoxSize?.[0]?.inlineSize ?? view.clientWidth;
    refresh();
  }).observe(view);

  window.TnaiTerminalPreview = {
    pick,
    picked: () => picked,
    previewOpen: () => previewOpen,
    setPreview,
  };
  layout();
  markOwner();
  mounted.shown?.();
})();
