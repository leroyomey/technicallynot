/*
 * Technically Not · 74-trust-ask.js — Desktop only: "Trust this folder for <CLI>?" (main.js
 * askInPane, before a sub-agent or a composer New agent starts) asked inside the panel it belongs
 * to — that agent's Overview card and its Terminal page pane — never as a window over the whole
 * app. The pane gets the in-panel confirm (11 .tnai-panel-confirm); the Overview tile, too small
 * for that, shows the question in place of its content. Answering in either place answers both; the
 * question is painted again when the tree rebuilds a card, and a reloaded window asks main for the
 * open ones. On the Threads page the open thread shows the same question in its own row, with the
 * same answer call (121-thread-asks.js); the old Agents and history page, which showed it over its
 * live terminal, is gone (2026-10-12).
 */
(() => {
  const native = window.tnaiNative?.trust;
  if (!native) return;
  const style = document.createElement('style');
  style.textContent = `
.tnai-card[data-trust-asking]>:not(.tnai-trust-inline){display:none!important}
.tnai-card[data-trust-asking]{display:flex!important;flex-direction:column;justify-content:center}
.tnai-trust-inline{display:flex;flex-direction:column;gap:8px;min-width:0;text-align:left}
.tnai-trust-inline b{color:#20211f;font-size:12px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tnai-trust-inline .tnai-ws-close-actions{display:flex;flex-wrap:wrap;justify-content:flex-start;gap:6px;margin:0}
.tnai-trust-inline button:focus-visible{outline:var(--pg-ring,2px) solid #8da56c;outline-offset:2px}`;
  document.head.append(style);

  const asks = new Map(); // id -> { id, paneId, title, body, ok, cancel }
  const card = paneId =>
    document.querySelector('.tnai-card[data-pane="' + CSS.escape(paneId) + '"]');
  const pane = paneId =>
    document.querySelector('.terminal-pane[data-pane-id="' + CSS.escape(paneId) + '"]');
  const BUTTONS =
    '<div class="tnai-ws-close-actions"><button type="button" class="tnai-ws-close-cancel"></button><button type="button" class="tnai-ws-close-confirm"></button></div>';

  function wire(el, ask) {
    el.dataset.trustAsk = ask.id;
    el.querySelector('.tnai-ws-close-cancel').textContent = ask.cancel || "Don't allow";
    el.querySelector('.tnai-ws-close-confirm').textContent = ask.ok || 'Trust folder';

    // Clicks stay here so the card or pane under it does not react; only the two buttons answer (an
    // important question, so no click-away).
    ['mousedown', 'pointerdown'].forEach(type =>
      el.addEventListener(type, e => e.stopPropagation())
    );
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (e.target.closest('.tnai-ws-close-confirm')) answer(ask.id, true);
      else if (e.target.closest('.tnai-ws-close-cancel')) answer(ask.id, false);
    });
    return el;
  }

  function paneLayer(ask) {
    const layer = document.createElement('div');
    layer.className = 'tnai-panel-confirm';
    layer.innerHTML =
      '<section class="tnai-panel-confirm-box" role="alertdialog"><h3></h3><p></p>' +
      BUTTONS +
      '</section>';
    const box = layer.firstChild,
      h = box.querySelector('h3');
    h.id = 'tnaiTrust-' + ask.id;
    box.setAttribute('aria-labelledby', h.id);
    h.textContent = ask.title;
    box.querySelector('p').textContent = ask.body || '';
    box.querySelector('p').hidden = !ask.body;
    return wire(layer, ask);
  }

  function cardInline(ask) {
    const box = document.createElement('div');
    box.className = 'tnai-trust-inline';
    box.setAttribute('role', 'alertdialog');
    box.innerHTML = '<b></b>' + BUTTONS;
    box.querySelector('b').textContent = ask.title;
    box.title = ask.title + (ask.body ? '\n' + ask.body : '');
    return wire(box, ask);
  }

  function paint() {
    for (const ask of asks.values()) {
      const p = pane(ask.paneId),
        c = card(ask.paneId),
        sel = ':scope > [data-trust-ask="' + CSS.escape(ask.id) + '"]';
      if (p && !p.querySelector(sel)) {
        if (getComputedStyle(p).position === 'static') p.style.position = 'relative';
        p.append(paneLayer(ask));
      }
      if (c && !c.querySelector(sel)) {
        c.setAttribute('data-trust-asking', '');
        c.append(cardInline(ask));
      }
    }
  }

  function clear(id) {
    document.querySelectorAll('[data-trust-ask="' + CSS.escape(id) + '"]').forEach(n => {
      const host = n.parentElement;
      n.remove();
      if (host?.matches('.tnai-card') && !host.querySelector(':scope > .tnai-trust-inline'))
        host.removeAttribute('data-trust-asking');
    });
  }

  function answer(id, yes) {
    if (!asks.delete(id)) return;
    clear(id);
    watch();
    native.answer(id, yes).catch(() => {});
  }

  // Cards are rebuilt when the tree re-renders or the workspace switches: repaint while a question
  // is open (no observer otherwise).
  let queued = 0;
  const observer = new MutationObserver(() => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0;
        paint();
      });
  });
  const watch = () => {
    observer.disconnect();
    if (asks.size) observer.observe(document.body, { childList: true, subtree: true });
  };
  const add = ask => {
    if (!ask?.id || !ask.paneId) return;
    asks.set(ask.id, ask);
    paint();
    watch();
  };

  native.onAsk(add);
  native.onDone(({ id } = {}) => {
    if (asks.delete(id)) {
      clear(id);
      watch();
    }
  });
  native
    .pending()
    .then(list => (list || []).forEach(add))
    .catch(() => {});
})();
