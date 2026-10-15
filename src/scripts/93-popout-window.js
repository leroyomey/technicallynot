/*
 * Technically Not · 93-popout-window.js — Desktop only: moves a floating panel into its own OS
 * window and back, so it can sit on another monitor next to Technically Not (a page can't draw
 * outside its own window). Same mechanism as the Overview grid panels (79): a same-origin child
 * window named tnai-panel-<id> (desktop/panel-windows.js), the page's styles and theme copied in,
 * Technically Not's window buttons in the panel's header (66), its place and size remembered per
 * panel. The panel comes back when its window closes or Technically Not reloads. The owner keeps
 * its own element and listeners; it adds the `.out` class while popped out. Users: 44 Result.
 */
(() => {
  const native = window.tnaiNative;
  const outs = new Map(); // id -> { win, node, unframe, onBack }
  const key = id => 'tnai.popout.' + id + '.v1';
  const load = id => {
    try {
      return JSON.parse(localStorage.getItem(key(id)) || '{}') || {};
    } catch {
      return {};
    }
  };
  const saveBounds = (id, w) => {
    try {
      if (w && !w.closed && w.outerWidth > 0)
        localStorage.setItem(
          key(id),
          JSON.stringify({ x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight })
        );
    } catch {}
  };

  const style = document.createElement('style');
  style.textContent =
    'body.tnai-popout-win{display:block;box-sizing:border-box;min-width:0;width:auto;margin:0;height:100vh;overflow:hidden;background:var(--panel,#fff);color:#3f453a;font:12px var(--pg-sans)}';
  document.head.append(style);

  function copyHead(doc) {
    doc.head.querySelectorAll('[data-tnai-copy]').forEach(n => n.remove());
    document.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(n => {
      const c = n.cloneNode(true);
      if (c.tagName === 'LINK') c.href = n.href;
      c.dataset.tnaiCopy = '';
      doc.head.append(c);
    });
    const theme = document.documentElement.dataset.theme;
    theme
      ? (doc.documentElement.dataset.theme = theme)
      : doc.documentElement.removeAttribute('data-theme');
    doc.documentElement.dataset.accent = document.documentElement.dataset.accent || 'purple';
  }
  window.addEventListener('tnai:theme-changed', () => {
    for (const o of outs.values()) if (!o.win.closed) copyHead(o.win.document);
  });

  // id: short name (letters, digits, '-'); node: the panel element; head: the row that gets the
  // window buttons; size: first-open width/height in CSS px of this window (scaled by its zoom,
  // which the pop-out takes too); onBack: called after the panel is back in Technically Not.
  function open(id, node, { title, head, width = 480, height = 640, onBack } = {}) {
    if (!native?.panels) return null;
    const cur = outs.get(id);
    if (cur && !cur.win.closed) {
      cur.win.focus();
      return cur.win;
    }
    const b = load(id);
    const at =
      Number.isFinite(b.x) && Number.isFinite(b.y)
        ? ',left=' + Math.round(b.x) + ',top=' + Math.round(b.y)
        : '';
    const zoom =
      window.innerWidth > 0 && window.outerWidth > 0
        ? Math.round((window.outerWidth / window.innerWidth) * 20) / 20
        : 1;
    const win = window.open(
      'about:blank',
      'tnai-panel-' + id,
      'width=' +
        Math.round(b.w > 0 ? b.w : width * zoom) +
        ',height=' +
        Math.round(b.h > 0 ? b.h : height * zoom) +
        at
    );
    if (!win) return null;
    const doc = win.document;
    copyHead(doc);
    doc.title = (title || 'Technically Not') + ' · Technically Not';
    doc.body.className = 'tnai-popout-win';
    node.classList.add('out');
    doc.body.replaceChildren(node);
    const o = { win, node, onBack, unframe: window.TnaiWindowFrame?.attach(win, head) };
    outs.set(id, o);
    win.addEventListener('resize', () => {
      if (outs.get(id) === o) saveBounds(id, win);
    });
    win.addEventListener('pagehide', () => {
      if (outs.get(id) === o) back(id);
    }); // the user closed the window

    // 70 binds the voice key there
    window.dispatchEvent(new CustomEvent('tnai:panel-popout', { detail: { id, win } }));
    saveBounds(id, win);
    win.focus();
    return win;
  }

  function back(id) {
    const o = outs.get(id);
    if (!o) return false;
    outs.delete(id);
    o.unframe?.();
    saveBounds(id, o.win);
    o.node.classList.remove('out');
    document.body.append(o.node);
    if (!o.win.closed) o.win.close();
    o.onBack?.();
    return true;
  }
  window.addEventListener('pagehide', () => {
    for (const o of outs.values()) if (!o.win.closed) o.win.close();
  }); // Technically Not reloading or closing

  window.TnaiPopout = {
    available: () => !!native?.panels,
    open,
    back,
    isOut: id => outs.has(id),
    window: id => outs.get(id)?.win || null,
  };
})();
