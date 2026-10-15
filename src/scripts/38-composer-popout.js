// Technically Not · 38-composer-popout.js — Desktop app only: pops the composer (activity line,
// prompt, ＋ attachments, lead chip, Send, hints) out into its own OS window the user can drag
// anywhere and keep on top. The same live nodes move into an empty same-origin child window named
// tnai-composer (desktop/panel-windows.js), so every handler keeps working: 11 binds Send/Enter in
// that document, 27 opens its ＋ menu there. The window's height is always its content's (locked, no
// dead space; it grows while the ＋ menu needs room and shrinks back); only its position and width
// are remembered. Technically Not's composer row collapses to a "Composer is popped out · Bring
// back" chip; closing the window or Dock puts everything back exactly where it was. Bounds and "On
// top" are remembered (tnai.composer-popout.v1); after a reload the composer starts docked.
// window.TnaiComposerPopout (popOut, dock, isOut, window, setOnTop, bounds).
(() => {
  const native = window.tnaiNative;
  const app = document.querySelector('.app'),
    composer = document.querySelector('.composer');
  const box = composer?.querySelector('.composebox'),
    prompt = document.getElementById('prompt');

  // browser build: no separate windows
  if (!native?.panels || !app || !composer || !box || !prompt) return;

  const NAME = 'tnai-composer',
    KEY = 'tnai.composer-popout.v1',
    WIDTH = 720,
    MIN_WIDTH = 560;
  const say = message => (typeof toast === 'function' ? toast(message) : console.info(message));
  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const store = patch => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
    } catch {}
  };

  const style = document.createElement('style');
  style.textContent = `
.tnai-composer-pop{box-sizing:border-box;width:30px;height:30px;padding:0;border:0;border-radius:7px;background:transparent;color:#8e9088;font-size:14px;line-height:1;flex:none;cursor:pointer}
.tnai-composer-pop:hover{background:#f1f3ee;color:#3e4438}
.app.tnai-composer-out:not(:has(>.layout.terminal-mode)){grid-template-rows:58px minmax(0,1fr) 44px!important}
.app.tnai-composer-out>.composer{min-height:0!important;padding-top:7px!important;padding-bottom:7px!important}
.tnai-composer-away{display:flex;align-items:center;gap:8px;max-width:1500px;height:30px;margin:0 auto;color:#8a8f84;font:10px var(--pg-sans)}
.tnai-composer-away b{color:#4e5547;font:600 11px var(--pg-sans)}
.tnai-composer-away button{box-sizing:border-box;height:30px;padding:0 10px;border:1px solid #e1e6da;border-radius:7px;background:#fff;color:#4e5547;font:11px var(--pg-sans);white-space:nowrap;cursor:pointer}
.tnai-composer-away button:hover{background:#eff4e7;border-color:#cdd9bc}
.tnai-composer-away button.primary{border-color:#d6e2c6;background:#f0f5e9;color:#46603a}
body.tnai-composer-popout{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:36px auto auto;align-content:start;height:100vh;min-width:0;margin:0;overflow:hidden;background:#f6f7f3;color:#3a3f35}
.acp-head{display:flex;align-items:center;gap:8px;min-width:0;padding:0 10px 0 16px;border-bottom:1px solid #eceee9;background:#fbfcf9}
.acp-head b{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#3e4438;font:600 11px var(--pg-sans)}
.acp-head label{display:flex;align-items:center;gap:8px;color:#6e7467;font:10px var(--pg-sans);cursor:pointer;white-space:nowrap}
.acp-head input{margin:0;accent-color:#879d69}
.acp-head button{box-sizing:border-box;height:24px;padding:0 8px;border:1px solid #e1e6da;border-radius:6px;background:#fff;color:#4e5547;font:10px var(--pg-sans);white-space:nowrap;cursor:pointer}
.acp-head button:hover{background:#eff4e7;border-color:#cdd9bc}
body.tnai-composer-popout>.composer{min-height:0!important;padding:14px 16px 12px!important;border-top:0;background:#fff;box-shadow:0 1px 0 #eceee9}
body.tnai-composer-popout>.composer>.activityline,body.tnai-composer-popout>.composer>.composebox,body.tnai-composer-popout>.composer>.hints{max-width:none}
.acp-status{min-height:14px;padding:8px 16px;color:#8a8f84;font:10px var(--pg-sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;
  document.head.append(style);

  // The pop-out / dock button sits in the box, just before Send, so it travels with it.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tnai-composer-pop';
  toggle.addEventListener('click', event => {
    event.preventDefault();
    win ? dock(true) : popOut();
  });
  box.insertBefore(toggle, document.getElementById('send'));

  // What Technically Not's window shows in the composer's place while it is out.
  const away = document.createElement('div');
  away.className = 'tnai-composer-away';
  const awayLabel = document.createElement('b');
  awayLabel.textContent = 'Composer is popped out';
  const showBtn = document.createElement('button');
  showBtn.type = 'button';
  showBtn.textContent = 'Show window';
  showBtn.onclick = () => win?.focus();
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'primary';
  backBtn.textContent = 'Bring back';
  backBtn.onclick = () => dock(true);
  away.append(awayLabel, '·', showBtn, backBtn);

  let win = null,
    doc = null,
    parts = [],
    onTopBox = null,
    status = null,
    holder = null,
    watchers = [];

  function paint() {
    toggle.textContent = win ? '⇲' : '⧉';
    toggle.title = win
      ? 'Dock the composer back into Technically Not'
      : 'Pop out the composer into its own window';
    toggle.setAttribute('aria-label', toggle.title);
  }
  paint();

  function copyHead(target) {
    target.head.querySelectorAll('[data-tnai-copy]').forEach(n => n.remove());
    document.querySelectorAll('head style, head link[rel="stylesheet"]').forEach(n => {
      const copy = n.cloneNode(true);
      if (copy.tagName === 'LINK') copy.href = n.href;
      copy.dataset.tnaiCopy = '';
      target.head.append(copy);
    });
    const root = document.documentElement,
      theme = root.dataset.theme;
    theme
      ? (target.documentElement.dataset.theme = theme)
      : target.documentElement.removeAttribute('data-theme');
    target.documentElement.dataset.accent = document.documentElement.dataset.accent || 'purple';
    if (root.dataset.runtime) target.documentElement.dataset.runtime = root.dataset.runtime;
  }
  window.addEventListener('tnai:theme-changed', () => {
    if (win && !win.closed) {
      copyHead(doc);
      fit(true);
    }
  });

  function saveBounds(w) {
    try {
      if (w && !w.closed && w.outerWidth > 0)
        store({ x: w.screenX, y: w.screenY, w: w.outerWidth, h: w.outerHeight });
    } catch {}
  }

  // The CSS px the window's content needs: title bar + the composer at its natural height + a
  // status line; and, while the ＋ menu is open, room for it under the ＋ (27 re-places the menu when
  // the window grows).
  function need() {
    const head = doc.querySelector('.acp-head');
    let height = head.offsetHeight + holder.scrollHeight + status.scrollHeight;
    const menu = doc.querySelector('.tnai-attach-menu'),
      plus = doc.getElementById('attachFiles');
    const r = plus?.getBoundingClientRect();
    if (menu && r && r.top - 6 < menu.scrollHeight + 4)
      height = Math.max(height, Math.ceil(r.bottom + 6 + menu.scrollHeight + 8));
    const at = doc.querySelector('.tnai-at-menu'),
      p = prompt.getBoundingClientRect(); // the @mention picker (50), under the prompt
    if (at && at.style.display !== 'none' && p.top - 6 < at.scrollHeight + 4)
      height = Math.max(height, Math.ceil(p.bottom + 6 + at.scrollHeight + 8));
    const pm = doc.querySelector('.tnai-pick-menu'),
      // an Agent/Model/Effort menu (46)
      pb = doc.querySelector('.tnai-pick-btn[aria-expanded="true"]')?.getBoundingClientRect();
    const pmH = pm ? Math.min(360, pm.scrollHeight) : 0;
    if (pm && pb && pb.top - 12 < pmH) height = Math.max(height, Math.ceil(pb.bottom + 16 + pmH));
    return Math.ceil(height);
  }

  // The narrowest a flex row can get without its items overlapping or being cut: fixed items
  // (flex:none) at their own width, shrinkable ones at their min-width (nested flex rows measured
  // the same way), plus gaps, padding and border. Independent of the window's current width, so the
  // minimum never ratchets up.
  function rowMin(el) {
    const view = el.ownerDocument.defaultView,
      cs = view.getComputedStyle(el);
    if (cs.display === 'none' || !el.getClientRects().length) return 0;
    const px = v => parseFloat(v) || 0,
      edge =
        px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
    if (!/flex/.test(cs.display)) return Math.ceil(el.getBoundingClientRect().width);
    const sizes = [...el.children]
      .filter(c => c.getClientRects().length)
      .map(c => {
        const s = view.getComputedStyle(c);
        if (px(s.flexShrink) === 0) return c.getBoundingClientRect().width;
        return Math.max(px(s.minWidth), /flex/.test(s.display) ? rowMin(c) : 0);
      });
    const wraps = cs.flexWrap !== 'nowrap';
    const inner = wraps
      ? Math.max(0, ...sizes)
      : sizes.reduce((n, w) => n + w, 0) + px(cs.columnGap) * Math.max(0, sizes.length - 1);
    return Math.ceil(inner + edge);
  }

  // The CSS px wide the window must be: the hint row (sounds, Agent/Model/Effort pickers, hints) at
  // its narrowest, inside the holder's padding; never under MIN_WIDTH (which the prompt box always
  // fits; its chips scroll).
  function needWidth() {
    const cs = win.getComputedStyle(holder),
      pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const hints = holder.querySelector(':scope>.hints');
    return Math.max(MIN_WIDTH, Math.ceil(pad + (hints ? rowMin(hints) : 0)));
  }
  let fitted = ''; // the size last given to the window

  function fit(force) {
    if (!win || win.closed) return Promise.resolve(null);
    const height = need(),
      width = needWidth(),
      key = width + 'x' + height;
    if (!force && key === fitted) return Promise.resolve(null);
    fitted = key;
    return native.panels.fit(NAME, width, height).catch(() => null);
  }

  // Technically Not's messages (toast) also show in the window, which may be covering Technically
  // Not.
  const toastEl = document.getElementById('toast');
  const mirror = toastEl
    ? new MutationObserver(() => {
        if (status)
          status.textContent = toastEl.classList.contains('show') ? toastEl.textContent : '';
      })
    : null;

  function popOut() {
    if (win && !win.closed) {
      win.focus();
      return true;
    }
    const saved = load();

    // the height is then fitted to the content
    const size = 'width=' + Math.round(saved.w > 0 ? saved.w : WIDTH) + ',height=220';
    const at =
      Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? ',left=' + Math.round(saved.x) + ',top=' + Math.round(saved.y)
        : '';
    const child = window.open('about:blank', NAME, size + at);
    if (!child) {
      say('Could not open a separate window');
      return false;
    }
    win = child;
    doc = child.document;
    copyHead(doc);
    doc.title = 'Composer · Technically Not';
    const head = doc.createElement('header');
    head.className = 'acp-head';
    const title = doc.createElement('b');
    title.textContent = 'Composer';
    const label = doc.createElement('label');
    onTopBox = doc.createElement('input');
    onTopBox.type = 'checkbox';
    onTopBox.className = 'tnai-switch';
    onTopBox.setAttribute('role', 'switch');
    onTopBox.checked = !!saved.onTop;
    label.title = 'Keep this window above other windows';
    label.append('On top', onTopBox);
    onTopBox.addEventListener('change', () => setOnTop(onTopBox.checked));
    const dockBtn = doc.createElement('button');
    dockBtn.type = 'button';
    dockBtn.textContent = 'Dock';
    dockBtn.title = 'Put the composer back into Technically Not';
    dockBtn.onclick = () => dock(true);
    head.append(title, label, dockBtn);

    // The same nodes (activity line, box, hints): their listeners, draft, attachments and lead chip
    // come along. A .composer holder keeps their styles.
    holder = doc.createElement('footer');
    holder.className = 'composer';
    status = doc.createElement('div');
    status.className = 'acp-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    parts = [...composer.childNodes];
    composer.replaceChildren(away);
    holder.append(...parts);
    doc.body.className = 'tnai-composer-popout';
    doc.body.replaceChildren(head, holder, status);
    window.TnaiWindowFrame?.attach(child, head); // window buttons in its top row (66)
    window.TnaiLiveTasks?.bindComposer?.(doc); // Send + Enter (11)
    app.classList.add('tnai-composer-out');
    mirror?.observe(toastEl, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      characterData: true,
      subtree: true,
    });

    // Content that grows (hints wrapping, the ＋ menu) grows the window.
    // After a grow for the @mention picker, let it place itself again in the new room (50
    // re-renders on input).
    const grow = () =>
      fit().then(b => {
        if (b && doc?.querySelector('.tnai-at-menu'))
          prompt.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const ro = new child.ResizeObserver(grow);
    ro.observe(holder);
    const mo = new child.MutationObserver(grow);
    mo.observe(doc.body, { childList: true });
    watchers = [ro, mo];

    // Stretched anyway (Windows snap, a resize the size lock missed): back to the content's height.
    let snap = 0;
    child.addEventListener('resize', () => {
      saveBounds(child);
      clearTimeout(snap);
      snap = setTimeout(() => {
        if (win === child && Math.abs(child.innerHeight - need()) > 2) fit(true);
      }, 150);
    });
    child.addEventListener('pagehide', () => {
      if (win === child) dock();
    }); // the user closed the window
    if (saved.onTop) setOnTop(true);
    paint();
    fit(true).then(() => {
      if (win === child) saveBounds(child);
    });
    child.focus();
    prompt.focus();
    window.dispatchEvent(new CustomEvent('tnai:composer-popout', { detail: { out: true } }));
    return true;
  }

  function dock(focus) {
    const child = win;
    if (!child) return false;
    saveBounds(child);
    watchers.forEach(w => w.disconnect());
    watchers = [];
    win = null;
    doc = null;
    onTopBox = null;
    status = null;
    holder = null;
    fitted = '';
    mirror?.disconnect();
    composer.replaceChildren(...parts, ...[...composer.childNodes].filter(n => n !== away));
    parts = [];
    app.classList.remove('tnai-composer-out');
    if (!child.closed) child.close();
    paint();
    if (focus) {
      window.focus();
      prompt.focus();
    }
    window.dispatchEvent(new CustomEvent('tnai:composer-popout', { detail: { out: false } }));
    return true;
  }

  async function setOnTop(on) {
    store({ onTop: !!on });
    if (onTopBox) onTopBox.checked = !!on;
    return win ? !!(await native.panels.setOnTop(NAME, !!on)) : false;
  }

  // Technically Not reloading or closing: remember where the window was and close it (after a
  // reload the composer starts docked).
  window.addEventListener('pagehide', () => {
    const child = win;
    if (!child) return;
    saveBounds(child);
    win = null;
    if (!child.closed) child.close();
  });

  window.TnaiComposerPopout = {
    popOut,
    dock,
    isOut: () => !!win,
    window: () => win,
    setOnTop,
    bounds: () => ({ ...load() }),
    fit: () => fit(),
  };
})();
