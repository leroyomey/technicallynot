// Technically Not · 06-repository-sample-and-terminal-launcher.js — Sample repository rail
// details/search + terminal connection picker (a popover anchored to the button that opened it)

(() => {
  const rail = document.querySelector('.repository-rail'),
    tree = rail?.querySelector('.repo-rail-tree');
  if (rail && tree) {
    const detail = document.createElement('section');
    detail.className = 'repo-file-detail';
    detail.id = 'repoFileDetail';
    detail.hidden = true;
    rail.append(detail);
    const note = rail.querySelector('.repository-rail-note');
    if (note) rail.append(note);
    const header = rail.querySelector('.repository-rail-head');
    if (header) {
      const sub = header.querySelector('small');
      if (sub)
        sub.textContent =
          'Sample project · ' + tree.querySelectorAll('[data-repo-path]').length + ' files';
    }
    tree.querySelectorAll('[data-repo-path]').forEach(file => {
      const path = file.dataset.repoPath,
        name = file.querySelector('.repo-row-name')?.textContent || path.split('/').pop(),
        ext = (name.split('.').pop() || '').toLowerCase(),
        kind =
          {
            tsx: 'TypeScript JSX',
            ts: 'TypeScript',
            jsx: 'JavaScript JSX',
            js: 'JavaScript',
            css: 'Stylesheet',
            json: 'JSON',
            md: 'Markdown',
          }[ext] || 'File';
      file.title = path;
      if (!file.querySelector('.repo-file-kind')) {
        const type = document.createElement('span');
        type.className = 'repo-file-kind';
        type.textContent = kind;
        const location = document.createElement('span');
        location.className = 'repo-file-path';
        location.textContent = path;
        location.title = path;
        file.append(type, location);
      }
    });

    function selectFile(file) {
      tree
        .querySelectorAll('[data-repo-path]')
        .forEach(row => row.classList.toggle('selected', row === file));
      const path = file.dataset.repoPath,
        name = path.split('/').pop(),
        kind = file.querySelector('.repo-file-kind')?.textContent || 'Sample file';
      rail.classList.add('has-file-selection');
      detail.hidden = false;
      detail.replaceChildren();
      const top = document.createElement('div');
      top.className = 'repo-detail-top';
      const copy = document.createElement('div');
      const eyebrow = document.createElement('small');
      eyebrow.textContent = 'FILE DETAILS';
      const title = document.createElement('h2');
      title.textContent = name;
      const location = document.createElement('p');
      location.textContent = path;
      copy.append(eyebrow, title, location);
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'repo-detail-close';
      close.textContent = '×';
      close.title = 'Close file details';
      close.onclick = () => {
        detail.hidden = true;
        rail.classList.remove('has-file-selection');
        tree.querySelectorAll('.selected').forEach(row => row.classList.remove('selected'));
      };
      top.append(copy, close);
      const meta = document.createElement('div');
      meta.className = 'repo-detail-meta';
      meta.innerHTML = '<span>Type</span><b></b><span>Source</span><b>Sample structure</b>';
      meta.querySelector('b').textContent = kind;
      const empty = document.createElement('div');
      empty.className = 'repo-detail-empty';
      empty.innerHTML =
        '<span class="repo-detail-file-icon">▤</span><b>File content is not mounted</b><p>This prototype shows a sample project tree. Connect a repository to inspect and edit the real file.</p>';
      const ask = document.createElement('button');
      ask.type = 'button';
      ask.className = 'button';
      ask.textContent = 'Ask AI about this file';
      ask.onclick = () => {
        const prompt = document.getElementById('prompt');
        prompt.value = 'Review ' + path;
        prompt.focus();
        toast('File path added to the project composer');
      };
      detail.append(top, meta, empty, ask);
    }
    tree
      .querySelectorAll('[data-repo-path]')
      .forEach(file => (file.onclick = () => selectFile(file)));
    const search = rail.querySelector('#repoRailSearch');
    if (search)
      search.oninput = () => {
        const query = search.value.trim().toLowerCase();
        tree
          .querySelectorAll('[data-repo-path]')
          .forEach(
            file =>
              (file.hidden = !(file.dataset.repoPath + ' ' + file.textContent)
                .toLowerCase()
                .includes(query))
          );
        tree.querySelectorAll('[data-repo-folder]').forEach(folder => {
          const label = folder.textContent.toLowerCase(),
            children = folder.parentElement.querySelector(
              '[data-folder-children="' + CSS.escape(folder.dataset.repoFolder) + '"]'
            ),
            hasMatch =
              children &&
              [...children.querySelectorAll('[data-repo-path]')].some(file => !file.hidden);
          folder.hidden = Boolean(query && !label.includes(query) && !hasMatch);
        });
      };
    const refresh = document.getElementById('repoRefresh');
    if (refresh)
      refresh.onclick = () => {
        if (search) search.value = '';
        search?.dispatchEvent(new Event('input'));
        detail.hidden = true;
        rail.classList.remove('has-file-selection');
        tree.querySelectorAll('.selected').forEach(row => row.classList.remove('selected'));
        toast('Sample repository view refreshed');
      };
  }
  const css = document.createElement('style');
  css.textContent =
    '.repo-row{grid-template-columns:16px 18px minmax(150px,1fr) minmax(100px,.55fr) minmax(150px,1fr)!important;min-height:34px!important;padding:5px 10px!important;border-bottom:1px solid #f0f1ee!important;border-radius:0!important}.repo-row.selected{background:#f1f4eb!important;color:#455239!important}.repo-file-kind,.repo-file-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8a8f84;font:9px var(--pg-sans)}.repo-folder .repo-row-name{font-weight:600}.repo-file-detail{grid-column:2;grid-row:3;min-width:0;overflow:auto;padding:18px 22px;background:#fff;border:1px solid #e7eae3;border-radius:8px}.repo-file-detail[hidden]{display:none!important}.repository-rail{container-type:inline-size}.repo-detail-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:14px;border-bottom:1px solid #eceee9}.repo-detail-top>div{min-width:0}.repo-detail-top small{font:8px var(--pg-sans);letter-spacing:.1em;color:#969a90}.repo-detail-top h2{margin:7px 0 5px;font:600 16px var(--pg-sans);color:#393d35}.repo-detail-top p{margin:0;overflow-wrap:anywhere;color:#858a7f;font:10px var(--pg-sans)}.repo-detail-close{width:28px;height:28px;border:1px solid #e5e8e0;border-radius:5px;background:#fff;color:#777d70;cursor:pointer}.repo-detail-meta{display:grid;grid-template-columns:70px minmax(0,1fr);gap:9px 12px;margin:15px 0;padding:12px;background:#f7f8f5;border-radius:6px;font:10px var(--pg-sans);color:#8a8f84}.repo-detail-meta b{color:#4e5547;font-weight:500}.repo-detail-empty{display:grid;justify-items:center;gap:8px;max-width:420px;margin:10vh auto 24px;text-align:center;color:#6e7467}.repo-detail-file-icon{display:grid;place-items:center;width:42px;height:48px;border:1px solid #e1e5dc;border-radius:7px;background:#f7f8f5;color:#879874;font-size:18px}.repo-detail-empty b{font:600 12px var(--pg-sans);color:#53594d}.repo-detail-empty p{margin:0;color:#93988e;font:10px/1.55 var(--pg-sans)}.repository-rail-note{grid-row:4}@container (max-width:430px){.repo-row{grid-template-columns:16px 18px minmax(0,1fr)!important}.repo-file-kind,.repo-file-path{display:none}}';
  document.head.append(css);

  const terminalView = document.getElementById('terminalView'),
    terminalContent = terminalView?.querySelector('.terminal-content'),
    addButton = document.getElementById('newTerminalWindow');
  if (!terminalView || !terminalContent) return;
  const providers = [
    ['Claude Code', '✳', 'Coding agent'],
    ['Codex', '⌬', 'Coding agent'],
    ['Cursor Agent', '◈', 'Coding agent'],
    ['Gemini CLI', '✦', 'Coding agent'],
    ['Droid', '⚙', 'Coding agent'],
    ['OpenCode', '◫', 'Coding agent'],
    ['GitHub Copilot', '◔', 'Coding agent'],
    ['DeepSeek Harness', '◉', 'Coding agent'],
    ['Grok Build', '×', 'Coding agent'],
    ['Kimi Code', '↗', 'Coding agent'],
    ['Antigravity', '△', 'Coding agent'],
    ['Muse Code', '✧', 'Coding agent'],
    ['Terminal', '›_', 'Shell'],
  ];
  let targetPane = null,
    createNew = false,
    pickFor = null;
  const overlay = document.createElement('div');
  overlay.className = 'terminal-launcher-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<section class="terminal-launcher" role="dialog" aria-modal="false" aria-labelledby="terminalLauncherTitle"><header><div><h2 id="terminalLauncherTitle">Choose what to open</h2><p>Select an agent or shell for this terminal panel.</p></div><button type="button" class="terminal-launcher-close" aria-label="Close connection picker">×</button></header><div class="terminal-launcher-grid"></div><div class="terminal-launcher-foot"><span>Connections open inside Technically Not terminal panels. A local runtime connector is required to start a live process.</span></div></section>';
  document.body.append(overlay);
  const cards = overlay.querySelector('.terminal-launcher-grid');
  providers.forEach(([name, icon, kind]) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'terminal-provider-card';
    card.dataset.provider = name;
    const mark = document.createElement('span');
    mark.className = 'terminal-provider-mark';
    mark.textContent = icon;
    const copy = document.createElement('span');
    copy.className = 'terminal-provider-copy';
    const label = document.createElement('b');
    label.textContent = name;
    const subtitle = document.createElement('small');
    subtitle.textContent = kind;
    copy.append(label, subtitle);
    const arrow = document.createElement('span');
    arrow.className = 'terminal-provider-arrow';
    arrow.textContent = '↗';
    card.append(mark, copy, arrow);
    cards.append(card);
  });
  const css2 = document.createElement('style');
  css2.textContent =
    '.terminal-pane{grid-template-rows:38px minmax(0,1fr) 42px}.terminal-pane .terminal-output{position:relative}.terminal-start-state{display:grid;place-content:center;justify-items:center;gap:10px;min-height:100%;padding:20px;text-align:center;color:#9da395;font:10px/1.5 var(--pg-sans)}.terminal-start-state .start-mark{display:grid;place-items:center;width:36px;height:36px;border:1px solid #444940;border-radius:8px;color:#c5d6a8;font-size:17px}.terminal-start-state b{color:#e4e9df;font:600 12px var(--pg-sans)}.terminal-start-state button{margin-top:2px;box-sizing:border-box;height:30px;padding:0 10px;border:1px solid #546149;border-radius:7px;background:#2c3228;color:#d6e5be;font:11px var(--pg-sans);white-space:nowrap;cursor:pointer}.terminal-start-state button:hover{background:#384332}.terminal-launcher-overlay{display:contents}.terminal-launcher-overlay[hidden]{display:none}.terminal-launcher{position:fixed;z-index:1000;top:0;left:0;box-sizing:border-box;width:min(580px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;overscroll-behavior:contain;padding:14px;border:1px solid #e1e5dc;border-radius:10px;background:#fbfcf9;box-shadow:0 14px 38px #16191430,0 2px 6px #1619140f}.terminal-launcher>header{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding-bottom:10px}.terminal-launcher h2{margin:0;color:#34382f;font:600 13px var(--pg-sans)}.terminal-launcher header p:last-child{margin:4px 0 0;color:#858a80;font:10px var(--pg-sans)}.terminal-launcher-close{flex:none;box-sizing:border-box;width:24px;height:24px;padding:0;border:1px solid #e5e8e0;border-radius:6px;background:#fff;color:#777d72;cursor:pointer}.terminal-launcher-close:hover{background:#f2f4ee}.terminal-launcher-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.terminal-provider-card{display:flex;align-items:center;gap:10px;min-width:0;height:46px;padding:0 14px 0 10px;border:1px solid #e3e7de;border-radius:8px;background:#fff;color:#444a3f;text-align:left;cursor:pointer;transition:border-color .14s,background .14s,transform .14s}.terminal-provider-card:hover,.terminal-provider-card:focus-visible{border-color:#bec9ad;background:#f8faf5}.terminal-provider-card:focus-visible{outline:var(--pg-ring,2px) solid #bccaa9;outline-offset:1px}.terminal-provider-mark{display:grid;place-items:center;flex:none;width:29px;height:29px;border:1px solid #edf0e9;border-radius:7px;background:#f5f7f2;color:#718451;font:600 14px var(--pg-sans)}.terminal-provider-card[data-provider="Terminal"] .terminal-provider-mark{font:12px Consolas}.terminal-provider-copy{display:grid;gap:4px;min-width:0}.terminal-provider-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 10px var(--pg-sans)}.terminal-provider-copy small{color:#969b91;font:8px var(--pg-sans)}.terminal-provider-arrow{margin-left:auto;color:#abb09f;font:12px var(--pg-sans)}.terminal-launcher-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;padding-top:9px;border-top:1px solid #eaede6}.terminal-launcher-foot>span{max-width:340px;color:#92978c;font:9px/1.45 var(--pg-sans)}.terminal-mode .terminal-pane-state{max-width:120px}.terminal-mode .terminal-pane-state span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}';
  document.head.append(css2);
  const launcher = overlay.querySelector('.terminal-launcher');
  let opener = null;

  // Popover placement: TnaiFloat (100) puts it centered under the opener, always below it (no flip:
  // the same spot every time), shifted inside the window and as tall as the room
  // below allows (it scrolls inside). No visible opener (scripts, TnaiAgents.open): centered in the
  // window. In the panel: opened from an empty Terminal panel's own ＋ Add
  // connection, the same picker sits inside that panel's body (21's .tnai-launcher start state;
  // shaped by the panel's size in 21's style block) instead of floating over it. Every other opener
  // keeps the popover.
  let docked = null;

  // It goes beside the start state, not into it: the start state's own button rule would restyle
  // the cards and the close button.
  function dock(start) {
    undock();
    start = start?.parentElement;
    if (!start) return;
    docked = start;
    window.TnaiFloat?.detach(launcher);
    launcher.style.left = launcher.style.top = launcher.style.maxHeight = '';
    start.classList.add('tnai-picking');
    start.append(overlay);
  }

  function undock() {
    if (!docked) return;
    docked.classList.remove('tnai-picking');
    docked = null;
    document.body.append(overlay);
  }

  function place() {
    if (overlay.hidden || docked) return;
    if (opener?.isConnected && opener.getClientRects().length && window.TnaiFloat) {
      const r = opener.getBoundingClientRect(),
        below = innerHeight - r.bottom,
        above = r.top;
      window.TnaiFloat.attach(opener, launcher, {
        placement: below < 360 && above > below ? 'top' : 'bottom',
        flip: false,
      });
      return;
    }

    /* below the button; above it only when there is too little room below (bottom-row panels) */ window.TnaiFloat?.detach(
      launcher
    );
    const M = 8,
      vw = innerWidth,
      vh = innerHeight,
      h = Math.min(launcher.scrollHeight + 2, vh - 2 * M);
    launcher.style.maxHeight = vh - 2 * M + 'px';
    launcher.style.left = Math.round(Math.max(M, (vw - launcher.offsetWidth) / 2)) + 'px';
    launcher.style.top = Math.round(Math.max(M, (vh - h) / 2)) + 'px';
  }

  function enabledCards() {
    return [...cards.querySelectorAll('.terminal-provider-card:not(:disabled)')];
  }

  function showLauncher(pane, isNew, anchor) {
    targetPane = pane || null;
    createNew = Boolean(isNew);
    if (opener && opener !== anchor) opener.removeAttribute('aria-expanded');
    opener = anchor instanceof Element ? anchor : null;
    opener?.setAttribute('aria-expanded', 'true');
    dock(
      pane && !isNew
        ? pane.querySelector('.terminal-output>.terminal-start-state.tnai-launcher')
        : null
    );
    overlay.hidden = false;
    place();
    (enabledCards()[0] || overlay.querySelector('.terminal-launcher-close')).focus({
      preventScroll: true,
    });
  }

  function paneLabel(pane) {
    const t = pane?.querySelector('.terminal-pane-title')?.textContent;
    return t ? t + ' · ' : '';
  }

  function hideLauncher(returnFocus) {
    const was = opener;
    overlay.hidden = true;
    undock();
    targetPane = null;
    createNew = false;
    pickFor = null;
    opener = null;
    was?.removeAttribute('aria-expanded');
    if (returnFocus === true && was?.isConnected && was.getClientRects().length)
      was.focus({ preventScroll: true });
  }

  function dismiss() {
    hideLauncher(true);
  }

  function setPaneProvider(pane, name) {
    if (!pane) return;
    const select = pane.querySelector('.terminal-provider-select');
    if (!select) return;
    select.value = name;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    dropStartState(pane);
  }

  // Takes the start state out, with the class 21 put on its box to hide what stood beside it.
  function dropStartState(pane) {
    const start = pane.querySelector('.terminal-start-state');
    if (!start) return;
    start.parentElement?.classList.remove('tnai-launching');
    start.remove();
  }

  function showStartState(pane) {
    const select = pane.querySelector('.terminal-provider-select'),
      output = pane.querySelector('.terminal-output');
    if (!select || select.value || !output || output.querySelector('.terminal-start-state')) return;
    output.querySelectorAll('.output-line').forEach(line => line.remove());
    const start = document.createElement('div');
    start.className = 'terminal-start-state';
    const mark = document.createElement('span');
    mark.className = 'start-mark';
    mark.textContent = '✦';
    const title = document.createElement('b');
    title.textContent = 'Start in this terminal';
    const description = document.createElement('span');
    description.textContent = 'Choose a coding agent or local shell to open here.';
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = 'Choose a connection';
    action.setAttribute('aria-haspopup', 'dialog');
    action.onclick = () => showLauncher(pane, false, action);
    start.append(mark, title, description, action);
    output.append(start);
    window.TnaiTerminalPage?.decorateStart(pane, start);
  }

  function refreshStartStates() {
    terminalContent.querySelectorAll('.terminal-pane').forEach(pane => {
      const select = pane.querySelector('.terminal-provider-select');
      if (select && !select.value) showStartState(pane);
      else dropStartState(pane);
    });
  }
  window.TnaiConnectionPicker = {
    /* a new panel with the picked connection, the picker anchored to anchor (07's empty workspace) */ openNew(
      anchor
    ) {
      showLauncher(null, true, anchor);
      window.TnaiAgents?.detect?.();
    },
    open(done, anchor) {
      const a =
        anchor || (document.activeElement?.matches?.('button') ? document.activeElement : null);
      showLauncher(null, false, a);
      pickFor = done;
      window.TnaiAgents?.detect?.();
    },
  };
  const createPane = addButton?.onclick;
  if (addButton) {
    addButton.setAttribute('aria-haspopup', 'dialog');
    addButton.onclick = () => showLauncher(null, true, addButton);
  }

  // One delegated listener (capture, so a non-bubbling change counts too) instead of one per
  // provider select, added or not yet added.
  terminalContent.addEventListener(
    'change',
    e => {
      if (e.target.closest?.('.terminal-provider-select')) setTimeout(refreshStartStates, 0);
    },
    true
  );

  // xterm redraws and status text (every second while a pane prints) aren't start-state changes:
  // only records that add or remove a pane, a provider select or its options, a pane's output or
  // start state trigger the refresh (the same cases that can change what it shows).
  const START_NODES =
    '.terminal-pane,.terminal-provider-select,.terminal-provider-select option,.terminal-output,.terminal-start-state';
  const touchesStart = nodes => {
    for (const n of nodes)
      if (n.nodeType === 1 && (n.matches(START_NODES) || n.querySelector(START_NODES))) return true;
    return false;
  };
  const paneObserver = new MutationObserver(all => {
    if (
      all.some(
        r =>
          !r.target.closest?.('.xterm') &&
          (r.target.closest?.('.terminal-provider-select') ||
            touchesStart(r.addedNodes) ||
            touchesStart(r.removedNodes))
      )
    )
      refreshStartStates();
  });
  paneObserver.observe(terminalContent, { childList: true, subtree: true });
  refreshStartStates();
  cards.addEventListener('click', e => {
    const card = e.target.closest('.terminal-provider-card');
    if (!card) return;
    const name = card.dataset.provider;
    if (pickFor) {
      const done = pickFor;
      hideLauncher();
      done(name);
      return;
    }
    let pane = targetPane;
    if (createNew) {
      if (!window.TnaiPaneLimit.makeRoom()) {
        hideLauncher();
        toast(window.TnaiPaneLimit.message);
        return;
      }
      createPane?.call(addButton);
      setTimeout(() => {
        const panes = [...terminalContent.querySelectorAll('.terminal-pane')].filter(
          p => p.dataset.workspaceId === (window.TnaiActiveTerminalWorkspaceId || 'workspace-1')
        );
        pane = panes[panes.length - 1];
        setPaneProvider(pane, name);
        hideLauncher();
        pane?.querySelector('.terminal-input input')?.focus();
        toast(
          paneLabel(pane) +
            name +
            (window.tnaiNative
              ? ' starting…'
              : ' selected · agents run in the Technically Not desktop app')
        );
      }, 0);
      return;
    }
    setPaneProvider(pane, name);
    hideLauncher();
    toast(
      paneLabel(pane) +
        name +
        (window.tnaiNative
          ? ' starting…'
          : ' selected · agents run in the Technically Not desktop app')
    );
  });
  overlay.querySelector('.terminal-launcher-close').onclick = dismiss;

  // Outside press closes (the opener's own press is left to its click, which re-anchors); focus
  // leaving the popover closes it without stealing focus back.
  document.addEventListener(
    'pointerdown',
    e => {
      if (!overlay.hidden && !launcher.contains(e.target) && !(opener && opener.contains(e.target)))
        hideLauncher();
    },
    true
  );
  launcher.addEventListener('focusout', e => {
    if (
      !overlay.hidden &&
      e.relatedTarget &&
      !launcher.contains(e.relatedTarget) &&
      e.relatedTarget !== opener
    )
      hideLauncher();
  });

  // Arrow keys move between the enabled cards (grid order); Home/End jump to the ends.
  launcher.addEventListener('keydown', e => {
    const list = enabledCards(),
      i = list.indexOf(document.activeElement);
    if (i < 0 || !/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key)) return;
    const all = [...cards.children],
      cols = getComputedStyle(cards).gridTemplateColumns.split(' ').length || 1,
      pos = all.indexOf(list[i]);
    let next = null;
    if (e.key === 'Home') next = list[0];
    else if (e.key === 'End') next = list[list.length - 1];
    else {
      const step =
        e.key === 'ArrowDown'
          ? cols
          : e.key === 'ArrowUp'
            ? -cols
            : e.key === 'ArrowRight'
              ? 1
              : -1;
      for (let j = pos + step; j >= 0 && j < all.length; j += step)
        if (!all[j].disabled) {
          next = all[j];
          break;
        }
    }
    e.preventDefault();
    next?.focus();
  });
  document.addEventListener(
    'keydown',
    e => {
      if (e.key === 'Escape' && !overlay.hidden) {
        e.stopPropagation();
        dismiss();
      }
    },
    true
  );
})();
