// Technically Not · 12-inactive-ui.js — Grays out and blocks every control that has no real
// functionality yet. To enable a feature, remove its selector here once the feature works.
(() => {
  const desktop = document.documentElement.dataset.runtime === 'desktop';

  // Prototype-only in every build.
  const always = [
    '#openRuntimeLauncher',
    '#agentRecipient',
    '.terminal-route',
    '.repo-rail-tree:not(.repo-real-tree) [data-repo-path]',
    '.repo-rail-tree:not(.repo-real-tree) [data-repo-folder]',
    '#repoFileDetail .button',
    // a "..." row or button that cannot work for another computer's thread (164 sets data-off)
    '.tnt-menu-row[data-off]',
    '.tnr-past-one .tnh-resume[data-off]',
    '.repository-rail:not(:has(.repo-connect[data-state=connected])) #repoRefresh',
    '.repository-rail:not(:has(.repo-connect[data-state=connected])) #repoRailSearch',
  ];

  // Real only in the desktop app (agents, terminals, and account status need the desktop process).
  const browserOnly = [
    '#prompt',
    '#send',
    '.tnai-discord-alerts',
    '.terminal-pane-tools button[title^="Compact"]',
    '.terminal-pane-tools button[title="Clear output"]',
    '#activityToggle',
    '.side-item[data-view="projects"]',
    '.side-item[data-view="devices"]',
    '#attachFiles',
    '.terminal-provider-card',
    '.terminal-provider-select',
    '.terminal-input',
    '.terminal-start-state button',
    '.agent-tree-panel',
    '.side-item[data-ai-tool="skills"]',
    '.side-item[data-view="settings"]',
    '.side-item[data-settings-tab]',
    '.side-item[data-view="agents"]',
    '.side-item[data-view="live-preview"]',
    '#voicePrompt',
  ];
  const selector = (desktop ? always : always.concat(browserOnly)).join(',');

  const style = document.createElement('style');
  style.textContent = `${selector}{opacity:.42!important;filter:grayscale(1)!important;pointer-events:none!important;cursor:not-allowed!important;user-select:none}
.sidebar .side-item.active[aria-disabled="true"]{opacity:1!important;filter:none!important}`; // the page on screen always reads as active
  document.head.append(style);

  // Keyboard activation (Tab + Enter/Space) and shortcuts are blocked too, not just the mouse.
  const inactive = target => target instanceof Element && !!target.closest(selector);
  ['click', 'keydown', 'input', 'change', 'submit'].forEach(type =>
    document.addEventListener(
      type,
      event => {
        if (inactive(event.target) && !(type === 'keydown' && event.key === 'Tab')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      },
      true
    )
  );

  // mark() remembers what it changed, so a control that stops matching (e.g. the File Repository
  // filter once a folder is connected) gets its original disabled / aria-disabled / tabindex back.
  const marked = new Map(); // element -> original { aria, disabled, tabindex }
  const on = el => {
    if (!marked.has(el))
      marked.set(el, {
        aria: el.getAttribute('aria-disabled'),
        disabled: 'disabled' in el ? el.disabled : undefined,
        tabindex: el.getAttribute('tabindex'),
      });

    // Written only when different: this runs after any DOM change while agents work, and same-value
    // writes still invalidate style.
    if (el.getAttribute('aria-disabled') !== 'true') el.setAttribute('aria-disabled', 'true');
    if ('disabled' in el && el.tagName !== 'DIV' && !el.disabled) el.disabled = true;
    if (el.getAttribute('tabindex') !== '-1') el.tabIndex = -1;
  };
  const off = (el, orig) => {
    marked.delete(el);
    if (!el.isConnected) return;
    if (orig.aria === null) el.removeAttribute('aria-disabled');
    else el.setAttribute('aria-disabled', orig.aria);
    if (orig.disabled !== undefined && el.tagName !== 'DIV') el.disabled = orig.disabled;
    if (orig.tabindex === null) el.removeAttribute('tabindex');
    else el.setAttribute('tabindex', orig.tabindex);
  };
  const mark = () => {
    const now = new Set(document.querySelectorAll(selector));
    now.forEach(on);
    marked.forEach((orig, el) => {
      if (!now.has(el)) off(el, orig);
    });
  };
  mark();

  // Re-mark after DOM or state changes (new nodes, repo-connect state, route classes), at most once
  // per 150 ms — not on every click. Desktop app: a pass looks only inside what was added since the
  // last one and at the controls already marked; the whole-document query with every selector ran
  // up to 7 times a second while anything repainted. The whole document is read again at load, on a
  // route change, when a change touches what a :has() in the list looks at (it decides for controls
  // elsewhere), and after a large burst. A new selector that an existing element starts to match by
  // a class or attribute change alone needs its own full pass here. The browser keeps full passes.
  const wide = [...selector.matchAll(/:has\(([^()]*)\)/g)]
    .map(m => m[1].replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join(',');
  const inWide = n => !!wide && (n.matches(wide) || !!n.querySelector(wide));
  const touched = new Set(); // elements added or removed since the last pass
  let queued = 0,
    full = !desktop;
  const pass = () => {
    queued = 0;
    const nodes = [...touched];
    touched.clear();
    if (full || nodes.length > 200 || nodes.some(inWide)) {
      full = !desktop;
      mark();
      return;
    }
    nodes.forEach(n => {
      if (!n.isConnected) return;
      if (n.matches(selector)) on(n);
      n.querySelectorAll(selector).forEach(on);
    });
    marked.forEach((orig, el) => {
      if (el.isConnected && el.matches(selector)) on(el);
      else off(el, orig);
    }); // still inactive: kept marked; no longer: given back
  };
  const queue = () => {
    if (!queued) queued = setTimeout(pass, 150);
  };
  const fullPass = () => {
    full = true;
    queue();
  };

  // Terminal renderer rows (.xterm) and the live activity feed redraw constantly and never hold
  // these controls.
  const own = r => r.target.closest?.('.xterm,.tnai-feed');
  new MutationObserver(records => {
    let any = false;
    for (const r of records) {
      if (own(r)) continue;
      any = true;
      if (full) continue;
      if (r.type === 'attributes') {
        if (wide && r.target.matches(wide)) full = true;
        continue;
      }
      for (const n of r.addedNodes) if (n.nodeType === 1) touched.add(n);
      for (const n of r.removedNodes) if (n.nodeType === 1) touched.add(n);
      if (touched.size > 200) {
        full = true;
        touched.clear();
      } // a large burst (a tree load): one full pass, and nothing held meanwhile
    }
    if (any) queue();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });

  // a route change is a change of its mode classes (08 writes them only when they differ)
  const layout = document.querySelector('.layout');
  if (layout)
    new MutationObserver(fullPass).observe(layout, {
      attributes: true,
      attributeFilter: ['class'],
    });
  window.addEventListener('hashchange', fullPass);

  if (!desktop) {
    const prompt = document.getElementById('prompt');
    if (prompt) prompt.placeholder = 'Agents run in the Technically Not desktop app';
  }
})();
